/**
 * sta2e-toolkit | appearance.js
 *
 * Runtime for Appearances — the hooks and the document writes. The rules
 * themselves (what a figure should look like) are in appearance-data.js; this
 * file reads the documents, asks that module, and writes the answer back.
 *
 * Three ways the art changes:
 *
 * - **Placement.** `preCreateToken` rolls a look for a sidebar drag. The
 *   spawners never reach that roll — `buildSpawnTokenData` stamps the state
 *   flag first, and the hook leaves a token that already has one alone.
 * - **A pick** from the Token HUD (`applyLook`). The user who clicks writes it,
 *   relaying through the active GM only if they cannot update the documents.
 * - **A rule** — a status, a toolkit condition, or a worn item. Re-evaluated by
 *   the ACTIVE GM ONLY (`isActiveGM()`), off the document hooks every client
 *   receives, so a change is written once rather than once per connected GM.
 *   With no GM connected, the user who toggled Wear applies it themselves.
 *
 * `settle()` is the single writer, and it is serialised per figure: a suit
 * going on while a status lands would otherwise race two writes of the same
 * state flag, and the loser's baseline would be lost.
 */

import {
  MODULE, LIBRARY_FLAG, STATE_FLAG, WORN_FLAG, WEARABLE_TYPES,
  readLibrary, normalizeState, collectTriggers, matchRules, composeAppearance,
  sameVisual, visualUpdates, applyCreationAppearance, hasLooks, findLook, ringFromToken, normalizeMimic, ringUpdates,
  actorTraitNames, mayMimic, parseKeywords, stateIsDressed, storeMimicInLibrary,
} from "./appearance-data.js";
import { isActiveGM, getActiveGM } from "./gm-authority.js";

export const APPEARANCE_SOCKET_ACTION = "appearanceApply";

// ── Document plumbing ────────────────────────────────────────────────────────

/** The world actor behind a token (the library always lives there). */
export function baseActorOf(tokenDoc) {
  return tokenDoc?.baseActor ?? (tokenDoc?.actorId ? game.actors.get(tokenDoc.actorId) : null) ?? null;
}

/** Every linked token of a world actor, on every scene — they share one look. */
function _linkedTokens(actor) {
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const td of scene.tokens ?? []) {
      if (td.actorLink && td.actorId === actor.id) out.push(td);
    }
  }
  return out;
}

/**
 * Resolve what a settle acts on. A linked token and its world actor are the
 * same figure; an unlinked token is its own.
 */
function _figure(target) {
  if (!target) return null;
  if (target.documentName === "Token") {
    const base = baseActorOf(target);
    if (!base) return null;
    if (target.actorLink) return { linked: true, actor: base, ref: target, tokens: _linkedTokens(base) };
    return { linked: false, actor: target.actor ?? base, base, ref: target, tokens: [target] };
  }
  if (target.documentName === "Actor") {
    if (target.isToken && target.token) return _figure(target.token);
    const tokens = _linkedTokens(target);
    return { linked: true, actor: target, ref: tokens[0] ?? null, tokens };
  }
  return null;
}

function _stateDoc(fig) {
  return fig.linked ? fig.actor : fig.ref;
}

function _currentVisual(fig) {
  const tex = fig.ref?.texture ?? (fig.linked ? fig.actor.prototypeToken?.texture : null) ?? {};
  return {
    token:    tex.src ?? "",
    portrait: fig.linked ? (fig.actor.img ?? null) : (fig.ref?.delta?.img ?? null),
    scale:    Math.abs(Number(tex.scaleX ?? 1)) || 1,
    ring:     ringFromToken(fig.ref?.ring ?? (fig.linked ? fig.actor.prototypeToken?.ring : null)),
    name:     fig.ref?.name ?? (fig.linked ? fig.actor.prototypeToken?.name : null) ?? null,
  };
}

/**
 * A linked character's original token art IS its Prototype Token: one
 * character, one original. Its placed tokens are only copies, and core never
 * updates them when the prototype changes — so the art a placed token happened
 * to show when a look or gear went on is the wrong thing to restore. Changing
 * the original (Appearance Manager or Prototype Token) and then wearing gear
 * put the OLD art back when the gear came off.
 *
 * Returns the token, scale and ring the prototype draws, the ring following
 * the art when it names that art as its subject (as core stores it).
 */
function _prototypeArt(actor) {
  const proto = actor?.prototypeToken;
  if (!proto) return null;
  const token = proto.texture?.src ?? "";
  // A wildcard prototype names no one image — the placed token's roll is the original.
  if (!token || token.includes("*")) return null;
  const ring = ringFromToken(proto.ring);
  if (ring?.subjectTexture === token) ring.subjectTexture = "";
  return { token, scale: Math.abs(Number(proto.texture?.scaleX ?? 1)) || 1, ring };
}

/**
 * A linked character's prototype art changed: its placed tokens that are
 * showing their original art take the new one. A token in a look or gear is
 * left alone — its original is read from the prototype when that comes off.
 */
async function _followPrototype(actor) {
  if (!actor?.prototypeToken?.actorLink) return;
  const proto = _prototypeArt(actor);
  if (!proto) return;
  if (normalizeState(actor.getFlag(MODULE, STATE_FLAG)).baseline) return;   // dressed
  for (const td of _linkedTokens(actor)) {
    const now = {
      token: td.texture?.src ?? "",
      scale: Math.abs(Number(td.texture?.scaleX ?? 1)) || 1,
      ring:  ringFromToken(td.ring),
    };
    if (now.ring?.subjectTexture === now.token) now.ring.subjectTexture = "";
    if (now.token === proto.token && now.scale === proto.scale
        && JSON.stringify(now.ring) === JSON.stringify(proto.ring)) continue;
    const data = {
      "texture.src":    proto.token,
      "texture.scaleX": Math.sign(td.texture?.scaleX || 1) * proto.scale,
      "texture.scaleY": Math.sign(td.texture?.scaleY || 1) * proto.scale,
      ...ringUpdates(proto.ring, proto.token),
    };
    try { await td.update(data); }
    catch (err) { console.warn(`STA2e Toolkit | Appearance: could not update ${td.name}`, err); }
  }
}

function _triggers(fig) {
  const actor = fig.actor;
  const ref = fig.ref;
  let conditions = [];
  let defenseMode = null;
  try {
    conditions  = ref?.getFlag(MODULE, "conditions") ?? [];
    defenseMode = ref?.getFlag(MODULE, "defenseMode") ?? null;
  } catch { /* no token */ }
  return collectTriggers({
    statuses: actor?.statuses ?? [],
    conditions,
    defenseMode,
    items: (actor?.items?.contents ?? []).map(i => ({
      name: i.name, type: i.type, worn: i.getFlag?.(MODULE, WORN_FLAG) === true,
    })),
  });
}

function _canWrite(fig, user = game.user) {
  if (fig.linked) {
    if (!fig.actor.canUserModify(user, "update")) return false;
    return fig.tokens.every(t => t.canUserModify(user, "update"));
  }
  return fig.ref?.canUserModify(user, "update") ?? false;
}

// ── The writer ───────────────────────────────────────────────────────────────

const _queues = new Map();

/** Run `fn` after any settle already in flight for the same figure. */
function _serial(key, fn) {
  const prev = _queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _queues.set(key, next);
  next.finally(() => { if (_queues.get(key) === next) _queues.delete(key); });
  return next;
}

function _figureKey(fig) {
  return fig.linked ? `actor:${fig.actor.uuid}` : `token:${fig.ref.uuid}`;
}

/**
 * Bring a figure's art in line with its library, its triggers and (optionally)
 * a newly chosen look.
 *
 * @param {TokenDocument|Actor} target
 * @param {object} [opts]
 * @param {object|null} [opts.mimic]   A copied appearance (`captureMimic`), or
 *   null to end one; `undefined` leaves it alone.
 * @param {string|null} [opts.lookId]  A new chosen look. `null` means "original
 *   art"; `undefined` leaves the choice alone (a rule re-evaluation).
 * @returns {Promise<boolean>} true when anything was written
 */
export function settle(target, { lookId, mimic } = {}) {
  const fig = _figure(target);
  if (!fig) return Promise.resolve(false);
  return _serial(_figureKey(fig), () => _settle(_figure(target) ?? fig, lookId, mimic));
}

async function _settle(fig, lookId, mimic) {
  const library = readLibrary(fig.linked ? fig.actor : fig.base);
  const stateDoc = _stateDoc(fig);
  if (!stateDoc) return false;
  const stored = normalizeState(stateDoc.getFlag(MODULE, STATE_FLAG));
  // Nothing configured and nothing to undo — the common case for most tokens.
  if (!hasLooks(library) && !stored.baseline && !stored.mimic && lookId === undefined && !mimic) return false;

  const state = { ...stored };
  if (lookId !== undefined) state.lookId = lookId || null;
  if (mimic !== undefined) state.mimic = normalizeMimic(mimic);
  const { rule, gear } = matchRules(library, _triggers(fig));
  const current = _currentVisual(fig);
  // A linked character's original is its prototype (see _prototypeArt): both
  // the baseline it would capture now and one it captured earlier take the
  // prototype's art. Portrait and name stay as captured.
  let captureFrom = current;
  const proto = fig.linked ? _prototypeArt(fig.actor) : null;
  if (proto) {
    captureFrom = { ...current, ...proto };
    if (state.baseline) state.baseline = { ...state.baseline, ...proto };
  }
  const { visual, state: next } = composeAppearance({ library, state, rule, gear, current: captureFrom });

  const stateChanged = JSON.stringify(next) !== JSON.stringify(stored);
  const visualChanged = visual && !sameVisual(visual, current);
  if (!stateChanged && !visualChanged) return false;

  if (!_canWrite(fig)) {
    _relay(fig, lookId, mimic);
    return false;
  }

  const statePath = `flags.${MODULE}.${STATE_FLAG}`;
  const tokenUpdates = [];
  let actorUpdate = null;
  if (visual) {
    for (const td of fig.tokens) {
      const { token, actor } = visualUpdates(visual, {
        linked:       fig.linked,
        currentScale: { scaleX: td.texture?.scaleX ?? 1, scaleY: td.texture?.scaleY ?? 1 },
      });
      if (Object.keys(token).length) tokenUpdates.push([td, token]);
      if (actor) actorUpdate = actor;
    }
    // A linked figure with no token on any scene still gets its portrait.
    if (fig.linked && !fig.tokens.length) actorUpdate = visualUpdates(visual, { linked: true }).actor;
  }

  if (fig.linked) {
    await fig.actor.update({ ...(actorUpdate ?? {}), [statePath]: next });
  } else {
    // The state flag rides in the same token update as the art.
    if (tokenUpdates.length) tokenUpdates[0][1][statePath] = next;
    else tokenUpdates.push([fig.ref, { [statePath]: next }]);
  }
  for (const [td, data] of tokenUpdates) {
    try { await td.update(data); }
    catch (err) { console.warn(`STA2e Toolkit | Appearance: could not update ${td.name}`, err); }
  }
  return true;
}

// ── Relay ────────────────────────────────────────────────────────────────────

function _relay(fig, lookId, mimic) {
  const ref = fig.ref;
  game.socket.emit(`module.${MODULE}`, {
    action:  APPEARANCE_SOCKET_ACTION,
    userId:  game.user.id,
    actorId: fig.linked ? fig.actor.id : null,
    sceneId: !fig.linked ? (ref?.parent?.id ?? null) : null,
    tokenId: !fig.linked ? (ref?.id ?? null) : null,
    lookId:  lookId === undefined ? "__keep__" : (lookId ?? null),
    mimic:   mimic === undefined ? "__keep__" : (mimic ?? null),
  });
}

/**
 * Active-GM side of a relayed pick. Checks that the requesting user owns the
 * figure — table etiquette rather than security, as everywhere in this module,
 * since the payload names its own sender.
 */
export async function handleAppearanceRequest(msg) {
  if (!isActiveGM()) return;
  const user = game.users.get(msg.userId);
  if (!user) return;
  const target = msg.actorId
    ? game.actors.get(msg.actorId)
    : game.scenes.get(msg.sceneId)?.tokens?.get(msg.tokenId);
  if (!target) return;
  const owned = target.documentName === "Actor"
    ? target.testUserPermission(user, "OWNER")
    : (target.actor?.testUserPermission(user, "OWNER") ?? target.isOwner);
  if (!owned && !user.isGM) return;
  if (msg.op === "storeMimic") {
    const tokenDoc = target.documentName === "Token" ? target : { actor: target };
    if (!canUseMimic(tokenDoc, user)) return;
    const state = target.documentName === "Token"
      ? lookStateFor(target)
      : normalizeState(target.getFlag(MODULE, STATE_FLAG));
    const base = target.documentName === "Token" ? baseActorOf(target) : target;
    if (base && state.mimic) await _storeMimicOn(base, state.mimic, user);
    return;
  }
  const startsMimic = msg.mimic && msg.mimic !== "__keep__";
  if (startsMimic) {
    // canUseMimic reads only `.actor`, so a linked figure (the actor itself) checks directly.
    const tokenDoc = target.documentName === "Token" ? target : { actor: target };
    if (!tokenDoc || !canUseMimic(tokenDoc, user)) return;
  }
  await settle(target, {
    lookId: msg.lookId === "__keep__" ? undefined : msg.lookId,
    mimic:  msg.mimic === "__keep__" ? undefined : msg.mimic,
  });
}

// ── Public helpers ───────────────────────────────────────────────────────────

/** The library for a token or actor (always the world actor's). */
export function libraryFor(target) {
  const actor = target?.documentName === "Token" ? baseActorOf(target)
    : (target?.isToken ? baseActorOf(target.token) : target);
  return readLibrary(actor);
}

/** The look id a token is wearing by choice, and the one a rule imposes. */
export function lookStateFor(tokenDoc) {
  const fig = _figure(tokenDoc);
  if (!fig) return normalizeState(null);
  return normalizeState(_stateDoc(fig)?.getFlag(MODULE, STATE_FLAG));
}

/**
 * Put a look on a token (`null` = original art). A rule in force keeps showing
 * until its trigger clears; the pick is what returns afterwards.
 */
export async function applyLook(tokenDoc, lookId) {
  const doc = tokenDoc?.document ?? tokenDoc;
  if (!doc) return false;
  const library = libraryFor(doc);
  if (lookId && !findLook(library, lookId)) {
    ui.notifications.warn("STA2e Toolkit: that look no longer exists.");
    return false;
  }
  // Picking a look (or Original) drops a disguise — it is a deliberate change.
  const wrote = await settle(doc, { lookId: lookId ?? null, mimic: null });
  const st = lookStateFor(doc);
  if (lookId && st.ruleLookId && st.ruleLookId !== lookId) {
    ui.notifications.info("Look saved — it will show once the current gear or condition look ends.");
  }
  return wrote;
}

/** A random look with token art. */
export async function applyRandomLook(tokenDoc) {
  const doc = tokenDoc?.document ?? tokenDoc;
  const pool = libraryFor(doc).looks.filter(l => l.token && !l.mimicked);
  if (!pool.length) return false;
  return applyLook(doc, pool[Math.floor(Math.random() * pool.length)].id);
}

/**
 * Another token's current appearance, as a mimic layer: its art, scale, ring,
 * the portrait its sheet shows and its token name. Read from the token as
 * drawn, so copying a token that is itself wearing a look (or a mimic) copies
 * what it looks like right now.
 *
 * @param {TokenDocument} source
 */
export function captureMimic(source) {
  const doc = source?.document ?? source;
  if (!doc) return null;
  const tex = doc.texture ?? {};
  const portrait = doc.actorLink
    ? (doc.actor?.img ?? null)
    : (doc.delta?.img ?? doc.actor?.img ?? null);
  return normalizeMimic({
    token:     tex.src ?? "",
    portrait:  portrait ?? "",
    scale:     Math.abs(Number(tex.scaleX ?? 1)) || 1,
    ring:      ringFromToken(doc.ring),
    tokenName: doc.name ?? "",
    from:      doc.name ?? "",
  });
}

/**
 * Whether `user` may start a Mimic on this token — the world settings
 * `mimicAccess` and `mimicTraits` against the token's own actor (the synthetic
 * one for an unlinked token, so a changeling NPC's per-token traits count).
 */
export function canUseMimic(tokenDoc, user = game.user) {
  const doc = tokenDoc?.document ?? tokenDoc;
  if (!doc || !user) return false;
  const get = (k, d) => { try { return game.settings.get(MODULE, k) ?? d; } catch { return d; } };
  const actor = doc.actor;
  return mayMimic({
    isGM:        user.isGM,
    access:      get("mimicAccess", "trait"),
    traits:      parseKeywords(get("mimicTraits", "Changeling, Shapeshifter")),
    actorTraits: actorTraitNames({ items: actor?.items?.contents ?? [], traitsText: actor?.system?.traits ?? "" }),
  });
}

/** Copy `source`'s appearance and token name onto `target` (the changeling trick). */
export async function applyMimic(target, source) {
  const doc = target?.document ?? target;
  const src = source?.document ?? source;
  if (!doc || !src) return false;
  if (!canUseMimic(doc)) {
    ui.notifications.warn(`${doc.name} can't mimic — that needs a mimic trait (see the Appearances settings).`);
    return false;
  }
  if (doc.uuid === src.uuid) {
    ui.notifications.warn("A token can't mimic itself.");
    return false;
  }
  const mimic = captureMimic(src);
  if (!mimic) return false;
  return settle(doc, { mimic });
}

/**
 * Save the mimic a token is wearing as a look in its actor's library — a
 * "stored form" the changeling can take again later, without the original
 * token present. Stored looks are marked `mimicked` and never rolled for a new
 * token at random. A user who cannot update the base actor (an NPC token they
 * were handed) is relayed through the active GM, who re-checks the mimic rule.
 *
 * @returns {Promise<object|null>} the stored (or already-present) look
 */
export async function storeMimicForm(target) {
  const doc = target?.document ?? target;
  if (!doc) return null;
  const st = lookStateFor(doc);
  if (!st.mimic) {
    ui.notifications.warn("This token isn't mimicking anyone — nothing to store.");
    return null;
  }
  if (!canUseMimic(doc)) {
    ui.notifications.warn(`${doc.name} can't store forms — that needs a mimic trait.`);
    return null;
  }
  const base = baseActorOf(doc);
  if (!base) return null;
  if (!base.canUserModify(game.user, "update")) {
    const fig = _figure(doc);
    game.socket.emit(`module.${MODULE}`, {
      action:  APPEARANCE_SOCKET_ACTION,
      op:      "storeMimic",
      userId:  game.user.id,
      actorId: fig?.linked ? fig.actor.id : null,
      sceneId: fig?.linked ? null : (doc.parent?.id ?? null),
      tokenId: fig?.linked ? null : doc.id,
    });
    ui.notifications.info("Asked the GM to store this form.");
    return null;
  }
  return _storeMimicOn(base, st.mimic, game.user);
}

async function _storeMimicOn(base, mimic, user) {
  const { library, look, duplicate } = storeMimicInLibrary(readLibrary(base), mimic);
  // Notifications go to whoever asked; on a relay that is not this client.
  const tell = (msg) => {
    if (user?.id === game.user.id) ui.notifications.info(msg);
    else console.log(`STA2e Toolkit | ${msg}`);
  };
  if (duplicate) {
    tell(`${base.name} already has the form "${duplicate.name}".`);
    return duplicate;
  }
  await base.update({ [`flags.${MODULE}.${LIBRARY_FLAG}`]: library });
  tell(`Stored the form "${look.name}" for ${base.name}.`);
  return look;
}

/** End a mimic — back to the chosen look (or original art) and own name. */
export async function endMimic(target) {
  const doc = target?.document ?? target;
  if (!doc) return false;
  return settle(doc, { mimic: null });
}

export function isWearable(item) {
  return !!item && WEARABLE_TYPES.has(item.type);
}

export function isWorn(item) {
  return item?.getFlag?.(MODULE, WORN_FLAG) === true;
}

/**
 * Put an item on or take it off. The re-evaluation runs on the active GM off
 * the `updateItem` hook; with no GM connected the toggling user does it.
 */
export async function setWorn(item, worn) {
  if (!isWearable(item)) return;
  await item.update({ [`flags.${MODULE}.${WORN_FLAG}`]: !!worn });
  if (!getActiveGM() && item.parent) await refreshActor(item.parent, { force: true });
}

/** Re-evaluate every figure of an actor. */
export async function refreshActor(actor, { force = false } = {}) {
  if (!actor || (!force && !isActiveGM())) return;
  try {
    if (actor.isToken && actor.token) {
      await settle(actor.token);
      return;
    }
    // Linked figures share one state, so one settle covers all their tokens.
    await settle(actor);
  } catch (err) {
    console.warn("STA2e Toolkit | Appearance refresh failed:", err);
  }
}

/** Re-evaluate every unlinked token of a world actor on the viewed scene. */
async function _refreshUnlinkedOf(actor) {
  for (const td of canvas?.scene?.tokens ?? []) {
    if (!td.actorLink && td.actorId === actor.id) await settle(td);
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function _effectActor(effect) {
  const parent = effect?.parent;
  if (!parent) return null;
  if (parent.documentName === "Actor") return parent;
  return parent.parent?.documentName === "Actor" ? parent.parent : null;
}

function _onPreCreateToken(doc, data) {
  try {
    if (foundry.utils.getProperty(data, `flags.${MODULE}.${STATE_FLAG}`)) return;
    const actor = game.actors.get(doc.actorId);
    if (!actor) return;
    const library = readLibrary(actor);
    // A linked figure carries its look or mimic onto any scene, looks or not.
    const actorState = doc.actorLink ? actor.getFlag(MODULE, STATE_FLAG) : null;
    if (!hasLooks(library) && !stateIsDressed(actorState)) return;
    const scratch = {
      actorLink: doc.actorLink,
      name:      doc.name,
      texture:   { src: doc.texture.src, scaleX: doc.texture.scaleX, scaleY: doc.texture.scaleY },
      ring:      foundry.utils.deepClone(doc._source?.ring ?? {}),
      flags:     {},
    };
    if (!applyCreationAppearance(scratch, library, { actorState })) return;
    const patch = {
      "texture.src":    scratch.texture.src,
      "texture.scaleX": scratch.texture.scaleX,
      "texture.scaleY": scratch.texture.scaleY,
      name:             scratch.name,
    };
    if (scratch.delta && "img" in scratch.delta) patch["delta.img"] = scratch.delta.img;
    if (scratch.ring) patch.ring = scratch.ring;
    const st = scratch.flags[MODULE]?.[STATE_FLAG];
    if (st) patch[`flags.${MODULE}.${STATE_FLAG}`] = st;
    doc.updateSource(patch);
  } catch (err) {
    console.warn("STA2e Toolkit | Appearance: placement roll failed", err);
  }
}

const _CONDITION_KEY = /^(-=)?(conditions|defenseMode)$/;

export function registerAppearance() {
  Hooks.on("preCreateToken", _onPreCreateToken);

  for (const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
    Hooks.on(hook, (effect) => { refreshActor(_effectActor(effect)); });
  }

  Hooks.on("updateToken", (doc, changes) => {
    const ours = changes?.flags?.[MODULE];
    if (!ours || !Object.keys(ours).some(k => _CONDITION_KEY.test(k))) return;
    if (!isActiveGM()) return;
    settle(doc);
  });

  Hooks.on("updateItem", (item, changes) => {
    if (!isWearable(item)) return;
    const wornChanged = foundry.utils.hasProperty(changes, `flags.${MODULE}.${WORN_FLAG}`)
      || foundry.utils.hasProperty(changes, `flags.${MODULE}.-=${WORN_FLAG}`);
    if (!wornChanged && !("name" in (changes ?? {}))) return;
    refreshActor(item.parent);
  });
  for (const hook of ["createItem", "deleteItem"]) {
    Hooks.on(hook, (item) => { if (isWearable(item) && isWorn(item)) refreshActor(item.parent); });
  }

  // The GM edited the library — rules or looks may now resolve differently.
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, "prototypeToken") && isActiveGM() && !actor.isToken) {
      _followPrototype(actor).catch(err => console.warn("STA2e Toolkit | Appearance: could not follow the new prototype art", err));
    }
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE}.${LIBRARY_FLAG}`)) return;
    if (!isActiveGM() || actor.isToken) return;
    refreshActor(actor);
    _refreshUnlinkedOf(actor);
  });
}
