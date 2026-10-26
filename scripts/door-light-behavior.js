/**
 * sta2e-toolkit | door-light-behavior.js
 *
 * Door & Light Control — a Region behavior with two states, ON and OFF, each
 * saying what to do to a picked list of doors, lights and ambient sounds:
 *
 *   doors    open / closed / locked   (core plays the door's own sound)
 *   lights   on / off, plus colour, colour intensity and animation
 *   sounds   on / off
 *
 * Three triggers:
 *   presence  a token entering switches ON; the last one leaving switches OFF
 *   toggle    every entry flips the state (a pressure plate, a switch)
 *   manual    only the GM's Switch On / Switch Off buttons on the behavior
 *             sheet, or game.sta2eToolkit.setDoorLightState() from a macro
 * The buttons work in every mode.
 *
 * A switch can be SEQUENCED (system.sequence): a start delay, then one change
 * at a time with a pause between, in list order, reversed on the way off, or
 * shuffled (orderUpdates). A step is N items, or (grouping "tagged") every
 * target sharing a Sequence Group number, set on the light / wall / sound's
 * own config sheet (groupUpdates). Each switch takes a generation number; a newer one
 * stops an older sequence at its next pause and plans from the documents as
 * they now stand.
 *
 * What a switch writes is door-light-plan.js (a leaf, tested under node),
 * including the rule that ON saves each light's look and an OFF with blank look
 * fields restores it. The current state and those saved looks live in the
 * behavior's flag `doorLight`; `saved` is an ARRAY so an update replaces it
 * rather than merging stale entries back in.
 *
 * Walls and lights are GM-only documents, so every write runs on the active GM
 * (isActiveGM). Region events reach every client; the others return at once.
 * Switches are queued per behavior, so two tokens arriving together cannot
 * both read the same OFF state and race.
 *
 * Registration needs the usual three agreeing pieces: module.json
 * documentTypes (re-read only when the world is LAUNCHED), the namespaced type
 * id, and i18n keys for the labels.
 */

import { isActiveGM } from "./gm-authority.js";
import { planDoorLight, orderUpdates, groupUpdates } from "./door-light-plan.js";
import {
  hasUsed, useMark, resetUses, injectUsedBy, startedInside,
  cooldownField, cooldownBlocked, startCooldown, injectCooldownStatus,
} from "./region-token-uses.js";

const MODULE = "sta2e-toolkit";
export const DOOR_LIGHT_BEHAVIOR = `${MODULE}.doorLightControl`;
const STATE_FLAG = "doorLight";
// On each light, wall and sound; written by its own config sheet (see
// _injectSequenceGroupField). Read only when a behavior's grouping is "tagged".
const SEQUENCE_GROUP_FLAG = "sequenceGroup";
// {[behaviorId]: true} on a token that has triggered a Once Per Token behavior.
const USED_FLAG = "doorLightUsed";

const TARGETS = [
  { key: "doors",  type: "Wall",         layer: () => canvas.walls,    label: "Doors",  noun: "door" },
  { key: "lights", type: "AmbientLight", layer: () => canvas.lighting, label: "Lights", noun: "light" },
  { key: "sounds", type: "AmbientSound", layer: () => canvas.sounds,   label: "Ambient Sounds", noun: "sound" },
];

const Base = foundry.data.regionBehaviors.RegionBehaviorType;

// ── Data model ───────────────────────────────────────────────────────────────

/** A select whose blank option reads `blankLabel`, like core's transition field. */
function _withBlank(field, blankLabel, choices) {
  field.toInput = function(config = {}) {
    config.blank ??= blankLabel;
    config.choices ??= typeof choices === "function" ? choices() : choices;
    return Object.getPrototypeOf(this).toInput.call(this, config);
  };
  return field;
}

/**
 * A plain number box instead of core's range slider. A NumberField with min,
 * max and step renders as a slider, which cannot be left blank, so a nullable
 * "no change" value failed validation with "must be a number" on save. A
 * number box submits "", which NumberField#_cast turns into null.
 */
function _numberBox(field) {
  field.toInput = function(config = {}) {
    config.type ??= "number";
    return Object.getPrototypeOf(this).toInput.call(this, config);
  };
  return field;
}

function _animationChoices() {
  const out = { none: "None" };
  for (const [key, cfg] of Object.entries(CONFIG.Canvas.lightAnimations ?? {})) {
    out[key] = game.i18n.localize(cfg.label ?? key);
  }
  return out;
}

function _stateSchema(side, defaults) {
  const f = foundry.data.fields;
  const onOff = { on: "On", off: "Off" };
  const look = side === "on" ? "No change" : "Restore";
  return new f.SchemaField({
    door: _withBlank(new f.StringField({ required: true, blank: true, initial: defaults.door,
      choices: { open: "Open", closed: "Closed", locked: "Locked" }, label: "Doors" }),
    "No change", { open: "Open", closed: "Closed", locked: "Locked" }),
    light: _withBlank(new f.StringField({ required: true, blank: true, initial: defaults.light,
      choices: onOff, label: "Lights" }), "No change", onOff),
    sound: _withBlank(new f.StringField({ required: true, blank: true, initial: defaults.sound,
      choices: onOff, label: "Ambient Sounds" }), "No change", onOff),
    color: new f.ColorField({ nullable: true, initial: null, label: "Light Colour",
      hint: side === "on"
        ? "Blank leaves each light's colour alone."
        : "Blank puts back the colour the light had before it was switched on." }),
    alpha: _numberBox(new f.NumberField({ nullable: true, initial: null, min: 0, max: 1, step: 0.05,
      label: "Colour Intensity",
      hint: side === "on" ? "0–1. Blank leaves it alone." : "0–1. Blank restores it." })),
    animation: _withBlank(new f.StringField({ required: true, blank: true, initial: "",
      label: "Light Animation" }), look, _animationChoices),
  }, { label: side === "on" ? "When Switched On" : "When Switched Off" });
}

export class DoorLightBehaviorType extends Base {
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.base"];

  static defineSchema() {
    const f = foundry.data.fields;
    const uuidSet = (type, label, hint) => new f.SetField(
      new f.DocumentUUIDField({ type, nullable: false, relative: true, relativize: true }),
      { label, hint },
    );
    return {
      trigger: new f.StringField({
        required: true, initial: "presence", label: "Trigger",
        choices: { presence: "Presence", toggle: "Toggle", manual: "Manual" },
        hint: "Presence: on while a token is inside, off when the last one leaves. "
          + "Toggle: every token entering flips it. Manual: only the Switch On / Switch Off buttons.",
      }),
      onLeave: new f.StringField({
        required: true, initial: "off", label: "When the Last Token Leaves",
        choices: { off: "Switch Off", keep: "Keep As Is" },
        hint: "Presence trigger only. Keep As Is leaves the doors and lights as they are until the "
          + "Switch Off button or a macro switches them off. To keep only the doors (or only the "
          + "lights), leave Switch Off and set that line to No change under When Switched Off.",
      }),
      triggerBy: new f.StringField({
        required: true, initial: "visible", label: "Triggered By",
        choices: {
          any:     "Any token",
          visible: "Any token not hidden",
          players: "Player-owned tokens only",
        },
      }),
      oncePerToken: new f.BooleanField({
        initial: false, label: "Once Per Token",
        hint: "Each token can trigger this only the first time it enters; after that, entering does "
          + "nothing. Under Presence a token that has used it still counts as inside, so the lights "
          + "stay on around it. Tokens that have used it are listed below, each with a Reset.",
      }),
      cooldown: cooldownField(
        "After a token triggers it, entries are ignored for this long. When it runs out, it is ready "
        + "again only once every token that counts (see Triggered By) has left the Region. 0 = no "
        + "cooldown. Leaving still switches it off; the Switch buttons ignore the cooldown."),
      doors:  uuidSet("Wall", "Doors",
        "Select doors on the Walls layer and press Add Selected. Walls that are not doors are ignored."),
      lights: uuidSet("AmbientLight", "Lights", "Select lights on the Lighting layer and press Add Selected."),
      sounds: uuidSet("AmbientSound", "Ambient Sounds", "Select sounds on the Sounds layer and press Add Selected."),
      sequence: new f.SchemaField({
        startDelay: new f.NumberField({ required: true, nullable: false, integer: true, initial: 0,
          min: 0, max: 30000, step: 100, label: "Start Delay (ms)",
          hint: "Switching on: wait this long after the trigger before the first change." }),
        endDelay: new f.NumberField({ required: true, nullable: false, integer: true, initial: 0,
          min: 0, max: 60000, step: 100, label: "End Delay (ms)",
          hint: "Switching off: wait this long before anything changes — the lights stay on and the "
            + "doors open for a while after the last token leaves. A token coming back in during the "
            + "wait cancels the switch-off." }),
        stepDelay: new f.NumberField({ required: true, nullable: false, integer: true, initial: 0,
          min: 0, max: 10000, step: 50, label: "Delay Between Each (ms)",
          hint: "0 changes everything at once. Above 0, doors, lights and sounds change a step at a "
            + "time in the order they were added (doors first, then lights, then sounds). A step "
            + "with nothing to change is skipped without a pause." }),
        grouping: new f.StringField({ required: true, initial: "count", label: "Grouping",
          choices: { count: "Items Per Step", tagged: "Sequence Group numbers" },
          hint: "Sequence Group numbers: open a light's, door's or sound's own config and give it a "
            + "Sequence Group. Everything sharing a number changes together, lowest number first; "
            + "anything without one takes its own step after them." }),
        perStep: new f.NumberField({ required: true, nullable: false, integer: true, initial: 1,
          min: 1, max: 20, step: 1, label: "Items Per Step",
          hint: "Items Per Step grouping only. How many change together before each delay. 2 = the "
            + "first two lights, pause, the next two… Groups follow the list order, counted "
            + "separately for doors, lights and sounds." }),
        offTiming: new f.StringField({ required: true, initial: "sequence", label: "Switching Off",
          choices: { sequence: "Same sequence", instant: "All at once" },
          hint: "All at once: switching off reverts everything together, however it was switched "
            + "on. The End Delay still applies." }),
        order: new f.StringField({ required: true, initial: "forward", label: "Sequence Order",
          choices: { forward: "List order", reverseOff: "Reversed when off", random: "Random" },
          hint: "Reversed when off: list order switching on, the other way switching off." }),
      }, { label: "Sequence" }),
      on:  _stateSchema("on",  { door: "open",   light: "on",  sound: "on" }),
      off: _stateSchema("off", { door: "closed", light: "off", sound: "off" }),
    };
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: _onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]:  _onTokenExit,
  };
}

// ── Triggers ─────────────────────────────────────────────────────────────────

function _qualifies(token, triggerBy) {
  if (!token) return false;
  if (triggerBy === "players") return !!token.hasPlayerOwner;
  if (triggerBy === "visible") return !token.hidden;
  return true;
}

/**
 * Wait until the token is SEEN inside (or outside) the Region.
 *
 * TOKEN_ENTER / TOKEN_EXIT fire when the move is written, at the start of the
 * token's slide, so the doors and lights used to switch before the token got
 * there. While a token animates, core merges the animated position into its
 * document (Token#_animate), so getCenterPoint() is where it is drawn now —
 * tested each frame until it crosses, or the slide ends. Nothing to wait for
 * when the token is not drawn on this client (the GM is on another scene) or
 * is not animating. Raced with the tab being hidden, as core's teleport does,
 * since the ticker stops in a background tab.
 */
export async function waitUntilSeen(token, region, inside) {
  const anim = token?.rendered ? token.object?.movementAnimationPromise : null;
  if (!anim) return;
  const crossed = () => {
    try {
      const c = token.getCenterPoint();
      return region.testPoint({ x: c.x, y: c.y, elevation: token.elevation ?? 0 }) === inside;
    } catch { return true; }
  };
  if (crossed()) return;
  const ticker = canvas.app.ticker;
  let tick, timer;
  const waited = new Promise(resolve => {
    timer = setTimeout(resolve, 30000);   // never hang a switch on a stuck animation
    tick = () => { if (crossed()) resolve(); };
    ticker.add(tick);
    anim.then(resolve, resolve);
  });
  try { await game.raceWithWindowHidden(waited); }
  finally { ticker.remove(tick); clearTimeout(timer); }
}

/** @this {DoorLightBehaviorType} */
async function _onTokenEnter(event) {
  if (!isActiveGM() || this.trigger === "manual") return;
  const token = event.data.token;
  if (!_qualifies(token, this.triggerBy)) return;
  if (startedInside(token, this.region, event.data.movement)) return;   // moving about inside
  const behaviorId = this.parent.id;
  if (this.oncePerToken && hasUsed(token, USED_FLAG, behaviorId)) return;
  const counts = t => _qualifies(t, this.triggerBy);
  if (this.cooldown > 0 && cooldownBlocked(this.parent, token, counts)) return;
  await waitUntilSeen(token, this.region, true);
  // Again after the wait: another token may have triggered it meanwhile.
  if (this.cooldown > 0) {
    if (cooldownBlocked(this.parent, token, counts)) return;
    startCooldown(this.parent, this.cooldown);
  }
  // Marked when it triggers, even if the state was already on: entering was its one use.
  if (this.oncePerToken) {
    try { await token.update(useMark(USED_FLAG, behaviorId)); }
    catch (err) { console.warn("STA2e Toolkit | Door & Light Control: could not mark token", err); }
  }
  if (this.trigger === "toggle") return setDoorLightState(this.parent, "toggle");
  return setDoorLightState(this.parent, true, { onlyIfChanged: true });
}

/** @this {DoorLightBehaviorType} */
async function _onTokenExit(event) {
  if (!isActiveGM() || this.trigger !== "presence" || this.onLeave === "keep") return;
  const leaving = event.data.token;
  await waitUntilSeen(leaving, this.region, false);
  // A path that only clipped the edge ends back inside: not a departure.
  if (leaving?.regions?.has(this.region)) return;
  // Checked after the wait: someone may have walked in while this one walked out.
  const stillInside = [...(this.region.tokens ?? [])]
    .some(t => t !== leaving && t.id !== leaving?.id && _qualifies(t, this.triggerBy));
  if (stillInside) return;
  return setDoorLightState(this.parent, false, { onlyIfChanged: true });
}

// ── Switching ────────────────────────────────────────────────────────────────

const _queues = new Map();
const _generations = new Map();
const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Sleep up to `ms`, waking within 100 ms of `stop()` turning true. */
async function _sleepUnless(ms, stop) {
  const end = Date.now() + ms;
  while (!stop()) {
    const left = end - Date.now();
    if (left <= 0) return;
    await _sleep(Math.min(100, left));
  }
}

/** The stored `{active, saved: [...]}` as `{active, saved: {[uuid]: look}}`. */
function _parseState(raw) {
  raw ??= {};
  const saved = {};
  for (const entry of Array.isArray(raw.saved) ? raw.saved : []) {
    if (entry?.uuid) saved[entry.uuid] = { color: entry.color ?? null, alpha: entry.alpha ?? null,
      animation: entry.animation ?? null };
  }
  return { active: !!raw.active, saved };
}

/** Is this behavior currently switched on? */
export function isDoorLightOn(behavior) {
  return _parseState(behavior.getFlag(MODULE, STATE_FLAG)).active;
}

function _resolve(relative, uuid) {
  try { return fromUuidSync(uuid, { relative }); } catch { return null; }
}

/**
 * The defaults of a switch's settings, matching the schema's initial values.
 * Region Logic's Doors & Lights node starts from these.
 */
export const SWITCH_DEFAULTS = Object.freeze({
  doors: [], lights: [], sounds: [],
  sequence: { startDelay: 0, endDelay: 0, stepDelay: 0, grouping: "count", perStep: 1,
    offTiming: "sequence", order: "forward" },
  on:  { door: "open",   light: "on",  sound: "on",  color: null, alpha: null, animation: "" },
  off: { door: "closed", light: "off", sound: "off", color: null, alpha: null, animation: "" },
});

/**
 * What a switch works on. A Door & Light Control behavior is one; a Region
 * Logic Doors & Lights node is another, with its state kept under the node.
 * @typedef {object} SwitchHost
 * @property {string} key          Queue and generation key — one per switch.
 * @property {Document} relative   What relative target UUIDs resolve against.
 * @property {object} config       {doors, lights, sounds, sequence, on, off}.
 * @property {() => object} read   The stored `{active, saved}`.
 * @property {(raw: object) => Promise} write
 */
function _behaviorHost(behavior) {
  return {
    key: behavior.uuid,
    relative: behavior,
    get config() { return behavior.system; },
    read: () => behavior.getFlag(MODULE, STATE_FLAG),
    write: raw => behavior.update({ [`flags.${MODULE}.${STATE_FLAG}`]: raw }),
  };
}

function _snapshot(kind, doc) {
  const src = doc._source;
  const group = doc.getFlag?.(MODULE, SEQUENCE_GROUP_FLAG) ?? null;
  if (kind === "door") return { uuid: doc.uuid, kind, group, isDoor: (src.door ?? 0) > 0, ds: src.ds ?? 0 };
  if (kind === "light") return {
    uuid: doc.uuid, kind, group, hidden: !!src.hidden,
    color: src.config?.color ?? null, alpha: src.config?.alpha ?? null,
    animation: src.config?.animation?.type ?? null,
  };
  return { uuid: doc.uuid, kind, group, hidden: !!src.hidden };
}

const _FIELD_PATHS = { color: "config.color", alpha: "config.alpha", animation: "config.animation.type" };

/**
 * Switch a Door & Light Control behavior on, off, or to the other state.
 * GM only; on any other client it warns and does nothing.
 * @param {RegionBehavior|string} behaviorOrUuid
 * @param {boolean|"toggle"} want
 * @param {{onlyIfChanged?: boolean}} [options]  Skip when already in that state
 *        (the token triggers); the buttons re-apply, which re-asserts a state
 *        someone changed by hand.
 */
export async function setDoorLightState(behaviorOrUuid, want, { onlyIfChanged = false } = {}) {
  const behavior = typeof behaviorOrUuid === "string" ? await fromUuid(behaviorOrUuid) : behaviorOrUuid;
  if (behavior?.type !== DOOR_LIGHT_BEHAVIOR) {
    ui.notifications?.warn("STA2e Toolkit | Not a Door & Light Control behavior.");
    return;
  }
  return runSwitch(_behaviorHost(behavior), want, { onlyIfChanged });
}

/**
 * Switch any {@link SwitchHost} on, off, or to the other state — the shared
 * engine under setDoorLightState and Region Logic's Doors & Lights node.
 * GM only; on any other client it warns and does nothing.
 */
export async function runSwitch(host, want, { onlyIfChanged = false } = {}) {
  if (!game.user.isGM) {
    ui.notifications?.warn("STA2e Toolkit | Only a GM can switch doors and lights.");
    return;
  }
  const key = host.key;
  // A newer switch cuts short a sequence still stepping (see _apply).
  const generation = (_generations.get(key) ?? 0) + 1;
  _generations.set(key, generation);
  const run = (_queues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => _apply(host, want, onlyIfChanged, () => _generations.get(key) !== generation));
  _queues.set(key, run);
  try { return await run; }
  finally { if (_queues.get(key) === run) _queues.delete(key); }
}

async function _apply(host, want, onlyIfChanged, superseded) {
  let current = _parseState(host.read());
  const activating = want === "toggle" ? !current.active : !!want;
  if (onlyIfChanged && activating === current.active) return activating;

  // End Delay: wait BEFORE anything is written, so the state still reads ON
  // throughout. A token coming back in calls setDoorLightState, which
  // supersedes this wait, and its own ON then finds the state already on and
  // changes nothing — the lights never blink. Writing OFF first (as the start
  // of a sequence does) would make that ON re-save the lit look as "original".
  const endDelay = activating ? 0 : (host.config.sequence?.endDelay ?? 0);
  if (endDelay > 0) {
    // Wakes early when superseded, so a returning token's switch is not stuck
    // in the queue behind the rest of a long End Delay.
    await _sleepUnless(endDelay, superseded);
    if (superseded()) return current.active;
    current = _parseState(host.read());
  }

  const sys = host.config;
  const docs = new Map();
  const targets = [];
  for (const { key, noun } of TARGETS) {
    for (const uuid of sys[key] ?? []) {
      const doc = _resolve(host.relative, uuid);
      if (!doc) { console.warn(`STA2e Toolkit | Door & Light Control: ${uuid} does not exist`); continue; }
      docs.set(doc.uuid, doc);
      targets.push(_snapshot(noun, doc));
    }
  }

  const { updates, saved } = planDoorLight({
    targets, state: activating ? sys.on : sys.off, activating, saved: current.saved,
  });

  // The state is written FIRST, so a trigger arriving mid-sequence reads where
  // the behavior is heading rather than where it started — a token leaving
  // while the lights are still coming up switches it off, not on again.
  await host.write({
    active: activating,
    saved: Object.entries(saved).map(([uuid, look]) => ({ uuid, ...look })),
  });

  const toRow = ({ uuid, changes }) => {
    const doc = docs.get(uuid);
    const flat = { _id: doc.id };
    for (const [k, v] of Object.entries(changes)) flat[_FIELD_PATHS[k] ?? k] = v;
    return { doc, flat };
  };

  const seq = sys.sequence ?? {};
  const { perStep = 1, grouping = "count", order = "forward" } = seq;
  // The Start Delay is for switching on; switching off had its End Delay above.
  // "All at once" on the way off drops the step delay, so everything reverts together.
  const instant = !activating && seq.offTiming === "instant";
  const startDelay = activating ? (seq.startDelay ?? 0) : 0;
  const stepDelay  = instant ? 0 : (seq.stepDelay ?? 0);
  if (startDelay > 0) {
    await _sleep(startDelay);
    if (superseded()) return activating;
  }

  if (stepDelay > 0) {
    // A group at a time. A newer switch stops the rest; it plans against the
    // documents as they now stand, so a half-done sequence is picked up cleanly.
    const grouped = groupUpdates(updates, targets, { perStep, byTag: grouping === "tagged" });
    const groups = orderUpdates(grouped, order, activating);
    for (let i = 0; i < groups.length; i++) {
      await _writeRows(groups[i].map(toRow));
      if (i < groups.length - 1) {
        await _sleep(stepDelay);
        if (superseded()) break;
      }
    }
    return activating;
  }

  await _writeRows(updates.map(toRow));
  return activating;
}

/** One update call per scene and document type, so a group lights together. */
async function _writeRows(rows) {
  const batches = new Map();
  for (const { doc, flat } of rows) {
    const batchKey = `${doc.parent?.uuid}|${doc.documentName}`;
    if (!batches.has(batchKey)) batches.set(batchKey, { parent: doc.parent, type: doc.documentName, rows: [] });
    batches.get(batchKey).rows.push(flat);
  }
  await Promise.all([...batches.values()].map(async ({ parent, type, rows: batch }) => {
    try { await parent.updateEmbeddedDocuments(type, batch); }
    catch (err) { console.error(`STA2e Toolkit | Door & Light Control: ${type} update failed`, err); }
  }));
}

// ── Behavior sheet controls ──────────────────────────────────────────────────

function _injectSheetControls(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (doc?.type !== DOOR_LIGHT_BEHAVIOR) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".sta2e-doorlight-switch")) return;   // idempotency guard

  // Switch On / Off, above the first field. Its own full-width block, not a
  // label + .form-fields row: the sheet's width is fixed by core, and a label
  // column plus a status and two buttons ran past it. The keys wrap.
  const on = isDoorLightOn(doc);
  const switchRow = document.createElement("div");
  switchRow.className = "form-group sta2e-doorlight-switch";
  switchRow.innerHTML = `
    <div style="flex:0 0 100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;">
      <span style="flex:0 0 auto;font-weight:bold;">State: ${on ? "ON" : "OFF"}
        <span style="opacity:0.65;font-weight:normal;">(STA Toolkit)</span></span>
      <button type="button" data-sta2e-switch="on" style="flex:1 1 9em;min-width:0;">
        <i class="fa-solid fa-lightbulb"></i> Switch On</button>
      <button type="button" data-sta2e-switch="off" style="flex:1 1 9em;min-width:0;">
        <i class="fa-regular fa-lightbulb"></i> Switch Off</button>
    </div>
    <p class="hint" style="overflow-wrap:anywhere;">Acts at once, using the settings last saved — save
      changes first. Works in every trigger mode. From a macro:
      game.sta2eToolkit.setDoorLightState("${doc.uuid}", "toggle").</p>`;
  const first = root.querySelector('[name="system.trigger"]')?.closest(".form-group");
  (first ?? root.querySelector(".form-group"))?.before(switchRow);
  for (const btn of switchRow.querySelectorAll("[data-sta2e-switch]")) {
    btn.addEventListener("click", () => setDoorLightState(doc, btn.dataset.sta2eSwitch === "on"));
  }

  // Add Selected, on its own line under each target list. Inside the list's
  // .form-fields it took width from the tag input and was pushed off the edge.
  for (const { key, layer, noun } of TARGETS) {
    const input = root.querySelector(`[name="system.${key}"]`);
    const group = input?.closest(".form-group");
    if (!group) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sta2e-doorlight-add";
    btn.style.cssText = "flex:0 0 auto;width:auto;margin-left:auto;";
    btn.innerHTML = `<i class="fa-solid fa-plus"></i> Add Selected ${noun}s`;
    btn.addEventListener("click", () => {
      let picked = [...(layer()?.controlled ?? [])].map(o => o.document);
      if (noun === "door") picked = picked.filter(d => (d.door ?? 0) > 0);
      if (!picked.length) {
        ui.notifications.info(`Select one or more ${noun}s on the canvas first.`);
        return;
      }
      const have = Array.isArray(input.value) ? input.value : [];
      input.value = [...new Set([...have, ...picked.map(d => d.uuid)])];
    });
    // .form-group wraps; a 100% row lands on a line of its own above the hint.
    const row = document.createElement("div");
    row.style.cssText = "flex:0 0 100%;display:flex;";
    row.appendChild(btn);
    const hint = group.querySelector(":scope > .hint");
    if (hint) hint.before(row);
    else group.appendChild(row);
  }
}

// ── Once Per Token ───────────────────────────────────────────────────────────

/**
 * GM only. Let tokens trigger a Once Per Token Door & Light Control again: one
 * token (document or UUID), or every token that has used it when omitted.
 * @returns {Promise<number>} How many tokens were reset.
 */
export async function resetDoorLightUses(behaviorOrUuid, tokenOrUuid = null) {
  const behavior = typeof behaviorOrUuid === "string" ? await fromUuid(behaviorOrUuid) : behaviorOrUuid;
  if (behavior?.type !== DOOR_LIGHT_BEHAVIOR) {
    ui.notifications?.warn("STA2e Toolkit | Not a Door & Light Control behavior.");
    return 0;
  }
  return resetUses(behavior, USED_FLAG, tokenOrUuid);
}

function _injectUsedBy(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (doc?.type !== DOOR_LIGHT_BEHAVIOR) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  injectUsedBy(root, doc, USED_FLAG);
  injectCooldownStatus(root, doc, t => _qualifies(t, doc.system.triggerBy));
}

// ── Sequence Group field on light, wall and sound sheets ─────────────────────

/**
 * A Sequence Group number on the light / wall / sound's own config. It uses the
 * native form path `flags.sta2e-toolkit.sequenceGroup`, so the sheet's ordinary
 * submit saves it — the same trick region-pad-config.js uses. The light sheet
 * has tabs (Basic first); the wall and sound sheets do not, so the field goes
 * after their last form group, which keeps it above the footer buttons.
 */
function _injectSequenceGroupField(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const name = `flags.${MODULE}.${SEQUENCE_GROUP_FLAG}`;
  if (root.querySelector(`input[name="${name}"]`)) return;   // idempotency guard
  const doc = app?.document ?? app?.object ?? null;
  const value = doc?.getFlag?.(MODULE, SEQUENCE_GROUP_FLAG) ?? "";

  const group = document.createElement("div");
  group.className = "form-group";
  group.innerHTML = `
    <label>Sequence Group <span style="opacity:0.65;">(STA Toolkit)</span></label>
    <div class="form-fields">
      <input type="number" name="${name}" value="${Number(value) || ""}" min="1" step="1" placeholder="None">
    </div>
    <p class="hint">Only read by a Door &amp; Light Control behavior whose Grouping is "Sequence Group
      numbers". Everything sharing a number changes together, lowest number first.</p>`;

  const tab = root.querySelector('.tab[data-tab="basic"]');
  if (tab) { tab.appendChild(group); return; }
  const groups = root.querySelectorAll(".form-group");
  const last = groups[groups.length - 1];
  if (last) last.after(group);
  else (root.querySelector("form") ?? root).appendChild(group);
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerDoorLightBehavior() {
  const type = DOOR_LIGHT_BEHAVIOR;
  CONFIG.RegionBehavior.dataModels[type] = DoorLightBehaviorType;
  CONFIG.RegionBehavior.typeLabels[type] = `TYPES.RegionBehavior.${type}`;
  CONFIG.RegionBehavior.typeHints[type]  = `TYPES.HINTS.RegionBehavior.${type}`;
  CONFIG.RegionBehavior.typeIcons[type]  = "fa-solid fa-door-open";

  // A type missing from game.model will never be offered — say so. Wrapped:
  // this runs in init.
  try {
    const known = getDocumentClass("RegionBehavior")?.TYPES ?? [];
    if (!known.includes(type)) {
      console.warn(
        `STA2e Toolkit | ${type} not in game.model.RegionBehavior — Door & Light Control will not appear `
        + "in the Add Behavior list. Check module.json documentTypes.RegionBehavior, then fully restart the world.",
      );
    }
  } catch { /* diagnostic only */ }

  Hooks.on("renderRegionBehaviorConfig", _injectSheetControls);
  Hooks.on("renderRegionBehaviorConfig", _injectUsedBy);
  Hooks.on("renderAmbientLightConfig", _injectSequenceGroupField);
  Hooks.on("renderAmbientSoundConfig", _injectSequenceGroupField);
  Hooks.on("renderWallConfig", _injectSequenceGroupField);
}
