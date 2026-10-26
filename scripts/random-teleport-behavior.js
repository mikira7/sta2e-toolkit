/**
 * sta2e-toolkit | random-teleport-behavior.js
 *
 * Random Teleport — core's Teleport Token with a smarter pick. Core v14 already
 * keeps a list of destinations and picks one uniformly; this adds:
 *
 *   Avoid Occupied   skip destination Regions that already hold a token
 *                    (every one full → any destination)
 *   No Repeat        never the same destination twice in a row for a token
 *   Weights          per destination Region, the Teleport Weight field that
 *                    region-pad-config.js injects into Region Config
 *
 * The pick itself is random-teleport-pick.js (a leaf, tested under node). The
 * move is core's RegionDocument#teleportToken, so placement, snapping,
 * cross-scene token recreation and the pan transition all behave as core's.
 *
 * Core's selection lives in a private static handler, which is why this is a
 * separate type rather than a patch. It has no Choice / confirm dialog: a
 * player choosing contradicts a random pick, and core's confirm query is
 * hard-wired to the "teleportToken" type.
 *
 * Who teleports is core's rule: the mover, if every destination is on their
 * scene or they may create and delete tokens; otherwise the active GM. The last
 * pick is written onto the token IN the teleport's own update (`updateData`),
 * by whoever teleports — so no socket, and it follows a token across scenes.
 *
 * Registration needs the usual three agreeing pieces: module.json
 * documentTypes (re-read only when the world is LAUNCHED), the namespaced type
 * id, and i18n keys for the labels.
 */

import { getActiveGM, isActiveGM } from "./gm-authority.js";
import { pickDestination } from "./random-teleport-pick.js";
import {
  hasUsed, resetUses, injectUsedBy, startedInside,
  cooldownField, cooldownBlocked, startCooldown, injectCooldownStatus,
} from "./region-token-uses.js";

const MODULE = "sta2e-toolkit";
export const RANDOM_TELEPORT_BEHAVIOR = `${MODULE}.randomTeleport`;
export const TELEPORT_WEIGHT_FLAG = "teleportWeight";
const LAST_FLAG = "randomTeleportLast";
// {[behaviorId]: true} on a token that a Once Per Token behavior has teleported.
const USED_FLAG = "randomTeleportUsed";

const Base = foundry.data.regionBehaviors.RegionBehaviorType;

// ── Data model ───────────────────────────────────────────────────────────────

export class RandomTeleportBehaviorType extends Base {
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.base"];

  static defineSchema() {
    const f = foundry.data.fields;
    // Core's transition select, copied: a plain StringField renders a textbox.
    const transitionType = new f.StringField({
      required: true, nullable: true, blank: false, initial: null, label: "Transition",
      hint: "Scene transition played when the token lands on another scene.",
    });
    transitionType.toInput = function(config = {}) {
      config.blank ??= game.i18n.localize("COMMON.None");
      config.choices ??= Object.entries(CONFIG.Canvas.sceneTransitions ?? {}).reduce((types, [key, value]) => {
        types[key] = game.i18n.localize(value.label ?? `SCENE.Transition.Types.${key}`);
        return types;
      }, {});
      return Object.getPrototypeOf(this).toInput.call(this, config);
    };
    return {
      destinations: new f.SetField(
        new f.DocumentUUIDField({ type: "Region", nullable: false, relative: true, relativize: true }),
        { label: "Destinations",
          hint: "Regions a token entering this one may be sent to, on this scene or another. "
            + "Give a destination a Teleport Weight in its own Region Config to make it more likely." },
      ),
      placement: new f.StringField({
        required: true, initial: "random", label: "Placement",
        choices: {
          random:   "BEHAVIOR.TYPES.teleportToken.PLACEMENTS.random.label",
          center:   "BEHAVIOR.TYPES.teleportToken.PLACEMENTS.center.label",
          relative: "BEHAVIOR.TYPES.teleportToken.PLACEMENTS.relative.label",
        },
        hint: "Where the token lands inside the chosen destination.",
      }),
      snap: new f.BooleanField({ initial: true, label: "Snap to Grid" }),
      avoidOccupied: new f.BooleanField({
        initial: true, label: "Avoid Occupied",
        hint: "Skip destinations that already hold a token. If every one does, any destination may be picked.",
      }),
      noRepeat: new f.BooleanField({
        initial: true, label: "No Repeat",
        hint: "Never send a token to the destination it was sent to last time by this behavior "
          + "(unless it is the only one left).",
      }),
      delay: new f.NumberField({
        required: true, nullable: false, integer: true, initial: 0, min: 0, max: 30000, step: 100,
        label: "Teleport Delay (ms)",
        hint: "How long the token waits on this Region before it is teleported. The departure sound "
          + "plays when the wait starts. Moving the token off the Region during the wait cancels it.",
      }),
      oncePerToken: new f.BooleanField({
        initial: false, label: "Once Per Token",
        hint: "Each token is teleported only the first time it enters; after that it walks straight "
          + "through. Tokens that have used it are listed below, each with a Reset.",
      }),
      cooldown: cooldownField(
        "After a teleport, tokens entering are ignored (they walk straight through) for this long. "
        + "When it runs out, it is ready again only once every visible token has left the Region. "
        + "0 = no cooldown. With a cooldown the GM's client does the teleport."),
      departSound: new f.FilePathField({
        categories: ["AUDIO"], required: false, blank: true, initial: "", label: "Departure Sound",
        hint: "Played as the token leaves. Blank plays nothing.",
      }),
      arriveSound: new f.FilePathField({
        categories: ["AUDIO"], required: false, blank: true, initial: "", label: "Arrival Sound",
        hint: "Played once the token has landed at its destination. Blank plays nothing.",
      }),
      soundVolume: new f.NumberField({
        required: true, nullable: false, initial: 0.8, min: 0, max: 1, step: 0.05, label: "Sound Volume",
      }),
      soundAudience: new f.StringField({
        required: true, initial: "all", label: "Who Hears It",
        choices: { all: "Everyone", owners: "The token's owners" },
        hint: "GMs always hear it.",
      }),
      transition: new f.SchemaField({
        type: transitionType,
        duration: new f.NumberField({
          required: true, nullable: false, integer: true, initial: 1500, min: 500, max: 10000, step: 100,
          label: "Transition Duration",
        }),
      }),
    };
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: _onTokenMoveIn,
  };
}

// ── Teleport ─────────────────────────────────────────────────────────────────

/** `${behaviorId}|${tokenId}` for every token sitting out a Teleport Delay. */
const _pending = new Set();

/** @this {RandomTeleportBehaviorType} */
async function _onTokenMoveIn(event) {
  const movement = event.data.movement;
  // Displacement does not trigger teleportation (core's rule).
  if (movement.passed?.waypoints?.at(-1)?.action === "displace") return;

  const destinations = resolveDestinations(this.destinations, this.parent);
  if (!destinations.length) return;

  const token = event.data.token;
  const user = event.user;
  // Checked before stopMovement, so a token these turn away keeps walking.
  if (startedInside(token, this.region, movement)) return;   // moving about inside is not an entry
  if (this.oncePerToken && hasUsedRandomTeleport(token, this.parent.id)) return;
  if (this.cooldown > 0 && cooldownBlocked(this.parent, token, _countsForCooldown)) return;
  if (user.isSelf) token.stopMovement();
  if (!_shouldTeleport(token, destinations, user, this.cooldown > 0)) return;

  // Started when it triggers, so tokens arriving during the delay are blocked
  // too. Re-checked first: on this client another token may just have started it.
  if (this.cooldown > 0) {
    if (cooldownBlocked(this.parent, token, _countsForCooldown)) return;
    startCooldown(this.parent, this.cooldown);
  }

  const behaviorId = this.parent.id;
  await runRandomTeleport({
    key: behaviorId, config: this, destinations, region: this.region, token, movement, user,
    extraFlags: this.oncePerToken ? { [USED_FLAG]: { [behaviorId]: true } } : null,
  });
}

/** The destination Regions behind a list of (possibly relative) UUIDs; missing ones are skipped. */
export function resolveDestinations(uuids, relative) {
  const out = [];
  for (const uuid of uuids ?? []) {
    let region = null;
    try { region = fromUuidSync(uuid, { relative }); } catch { /* reported below */ }
    if (region instanceof foundry.documents.RegionDocument) out.push(region);
    else console.warn(`STA2e Toolkit | Random Teleport: ${uuid} does not exist`);
  }
  return out;
}

/**
 * The teleport itself, once a trigger has decided it should happen: wait for
 * the move to finish, sit out the Teleport Delay, pick a destination, move the
 * token and pull the users who follow it. Shared by Random Teleport and Region
 * Logic's Teleport node; the caller has already checked who teleports.
 * @param {object} p
 * @param {string} p.key          Names this teleport in the token's last-pick flag
 *                                (the behavior id; for a node, behavior + node).
 * @param {object} p.config       placement, snap, avoidOccupied, noRepeat, delay,
 *                                departSound, arriveSound, soundVolume, soundAudience, transition.
 * @param {RegionDocument[]} p.destinations
 * @param {RegionDocument} p.region   The Region the token entered.
 * @param {object} [p.extraFlags]     More module flags to write in the teleport's own update.
 * @returns {Promise<TokenDocument|null>} The token as it landed.
 */
export async function runRandomTeleport({
  key, config, destinations, region, token, movement, user, extraFlags = null, viewSelf = true,
}) {
  const originLevel = token._source.level;

  // Wait for the movement animation, unless the tab is hidden (core's rule).
  if (token.rendered && token.object?.movementAnimationPromise) {
    await game.raceWithWindowHidden(token.object.movementAnimationPromise);
  }

  const delay = Math.max(0, Number(config.delay) || 0);
  if (delay > 0) {
    // One wait per token: stepping off and back on mid-wait must not queue a
    // second teleport behind the first.
    const pendingKey = `${key}|${token.id}`;
    if (_pending.has(pendingKey)) return null;
    _pending.add(pendingKey);
    playRegionSound(config, config.departSound, token);
    try { await new Promise(resolve => setTimeout(resolve, delay)); }
    finally { _pending.delete(pendingKey); }
    if (token.parent?.tokens?.get(token.id) !== token) return null;   // deleted during the wait
    if (!token.regions.has(region)) return null;                      // moved off: cancelled
  }

  const lastUuid = config.noRepeat ? (token.getFlag(MODULE, LAST_FLAG)?.[key] ?? null) : null;
  const destination = pickDestination(destinations, {
    avoidOccupied: config.avoidOccupied,
    lastUuid,
    isOccupied: r => [...(r.tokens ?? [])].some(t => t !== token && t.id !== token.id),
    weightOf: r => r.getFlag(MODULE, TELEPORT_WEIGHT_FLAG),
  });
  if (!destination) return null;
  if (!token.regions.has(region)) return null;

  // Relative placement keeps the token's offset within this Region.
  const center = token.getCenterPoint(movement?.destination);
  const bounds = region.bounds;
  const offset = {
    x: (center.x - bounds.left) / bounds.width,
    y: (center.y - bounds.top) / bounds.height,
  };

  const transition = config.transition ?? {};
  const pan = transition.type
    ? { transitionType: transition.type, duration: transition.duration, force: true }
    : { duration: 0, force: true };
  const flags = { [LAST_FLAG]: { [key]: destination.uuid }, ...(extraFlags ?? {}) };
  const updateData = { flags: { [MODULE]: flags } };
  if (!(delay > 0)) playRegionSound(config, config.departSound, token);   // a delay played it already
  const landed = await destination.teleportToken(token, {
    placement: config.placement, snap: config.snap, offset, pan, updateData,
  });
  playRegionSound(config, config.arriveSound, landed);

  const destinationLevel = landed._source.level;
  if (token.parent === destination.parent && originLevel === destinationLevel) return landed;

  // Follow the token to its new scene or level — core's pull rules.
  const viewOptions = { level: destinationLevel, controlledTokens: [landed.id], transition };
  if (game.user.isGM) {
    if (token.parent !== destination.parent) {
      destination.parent.pullUsers(_usersToPull(token, user, game.user), viewOptions);
    } else if (!user.isSelf && !token.hidden && token.parent.id === user.viewedScene
      && originLevel === user.viewedLevel) {
      destination.parent.pullUsers([user], viewOptions);
    }
  }
  // viewSelf false: a teleport no one on this client moved (a Region Logic door
  // or button run) must not drag the GM's view to another scene.
  if (viewSelf && user.isSelf && token.parent.isView && canvas.level?.id === originLevel) {
    await destination.parent.view(viewOptions);
  }
  return landed;
}

/**
 * Play a departure / arrival sound from the client doing the teleport.
 * AudioHelper.play pushes it to the other clients and plays it here too, which
 * is why only the teleporting client calls this — every client receives the
 * Region event, and calling it on each would play the sound once per client.
 * "owners" sends it to the token's owners and the GMs. Never throws: a missing
 * file must not stop the teleport.
 */
export function playRegionSound(sys, src, token) {
  if (!src) return;
  try {
    const data = { src, volume: sys.soundVolume ?? 0.8, loop: false, channel: "environment" };
    let recipients = null;
    if (sys.soundAudience === "owners") {
      recipients = game.users
        .filter(u => u.active && u.id !== game.user.id && (u.isGM || token?.testUserPermission?.(u, "OWNER")))
        .map(u => u.id);
    }
    // No one else to tell: play here only rather than push an empty recipient list.
    const push = recipients ? (recipients.length ? { recipients } : false) : true;
    foundry.audio.AudioHelper.play(data, push);
  } catch (err) {
    console.warn("STA2e Toolkit | Random Teleport: could not play sound", src, err);
  }
}

/**
 * A hidden token parked in the Region (a GM's marker, an unseen NPC) must not
 * hold a cooldown's "wait for the Region to empty" open for good.
 */
const _countsForCooldown = t => !t.hidden;

/**
 * Core's #shouldTeleport, with the active GM standing in for core's
 * designated-user fallback. With a cooldown the active GM always teleports,
 * when one is connected: the cooldown is saved on the behavior, which a player
 * cannot update.
 */
function _shouldTeleport(token, destinations, user, gmOnly = false) {
  if (gmOnly && getActiveGM()) return isActiveGM();
  const canTeleport = user.isGM
    || destinations.every(d => token.parent === d.parent)
    || (user.can("TOKEN_CREATE") && user.can("TOKEN_DELETE")
      && (!getActiveGM() || !_usersToPull(token, user, user).length));
  if (canTeleport) return user.isSelf;
  return isActiveGM() && game.user.can("TOKEN_CREATE") && game.user.can("TOKEN_DELETE");
}

/** Core's #getUsersToPull: who follows the token to its destination scene. */
function _usersToPull(token, user, designatedUser) {
  if (token.hidden) return [];
  const scene = token.parent;
  const toPull = [];
  for (const u of game.users) {
    if (!u.active || u === designatedUser || u.isGM) continue;
    if (scene.id !== u.viewedScene || token._source.level !== u.viewedLevel) continue;
    if (u !== user) {
      if (!token.testUserPermission(u, "OBSERVER")) continue;
      if (scene.tokens.some(t => t !== token && !t.hidden && t.testUserPermission(u, "OWNER")
        && t._source.level === token._source.level && (!scene.tokenVision || t.sight.enabled))) continue;
    }
    toPull.push(u);
  }
  return toPull;
}

// ── Once Per Token ───────────────────────────────────────────────────────────
// The bookkeeping is region-token-uses.js, shared with Door & Light Control.

/** Has this token already been teleported by a Once Per Token behavior? */
export function hasUsedRandomTeleport(token, behaviorId) {
  return hasUsed(token, USED_FLAG, behaviorId);
}

/**
 * GM only. Let tokens trigger a Once Per Token Random Teleport again: one token
 * (a TokenDocument or its UUID), or every token that has used it when omitted.
 * @returns {Promise<number>} How many tokens were reset.
 */
export async function resetRandomTeleport(behaviorOrUuid, tokenOrUuid = null) {
  const behavior = typeof behaviorOrUuid === "string" ? await fromUuid(behaviorOrUuid) : behaviorOrUuid;
  if (behavior?.type !== RANDOM_TELEPORT_BEHAVIOR) {
    ui.notifications?.warn("STA2e Toolkit | Not a Random Teleport behavior.");
    return 0;
  }
  return resetUses(behavior, USED_FLAG, tokenOrUuid);
}

function _injectUsedBy(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (doc?.type !== RANDOM_TELEPORT_BEHAVIOR) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  injectUsedBy(root, doc, USED_FLAG);
  injectCooldownStatus(root, doc, _countsForCooldown);
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRandomTeleportBehavior() {
  Hooks.on("renderRegionBehaviorConfig", _injectUsedBy);
  const type = RANDOM_TELEPORT_BEHAVIOR;
  CONFIG.RegionBehavior.dataModels[type] = RandomTeleportBehaviorType;
  CONFIG.RegionBehavior.typeLabels[type] = `TYPES.RegionBehavior.${type}`;
  CONFIG.RegionBehavior.typeHints[type]  = `TYPES.HINTS.RegionBehavior.${type}`;
  CONFIG.RegionBehavior.typeIcons[type]  = "fa-solid fa-shuffle";

  // A type missing from game.model will never be offered — say so. Wrapped:
  // this runs in init.
  try {
    const known = getDocumentClass("RegionBehavior")?.TYPES ?? [];
    if (!known.includes(type)) {
      console.warn(
        `STA2e Toolkit | ${type} not in game.model.RegionBehavior — Random Teleport will not appear `
        + "in the Add Behavior list. Check module.json documentTypes.RegionBehavior, then fully restart the world.",
      );
    }
  } catch { /* diagnostic only */ }
}
