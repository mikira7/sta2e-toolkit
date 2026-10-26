/**
 * sta2e-toolkit | wearable-light.js
 *
 * A worn flashlight or beacon lights its wearer's token: a cone (120° by
 * default) thrown the way the token faces. Which items count is the world
 * setting `flashlightItems` (comma-separated names, trimmed and
 * case-insensitive, like `personalShieldItems`); range, arc and colour are the
 * `flashlight*` world settings.
 *
 * It is core's own token light, not an effect: `light.angle` is drawn centred
 * on `document.rotation`, so the cone turns with the token and every client
 * sees it from the document update — no socket, no renderer. Rotation 0 faces
 * south, the module's nose-south convention.
 *
 * The token's own light is saved in the token flag `lightBaseline` the first
 * time a flashlight goes on and written back when the last one comes off, is
 * broken (gear-damage.js) or is deleted. A linked character's light follows it
 * onto every scene; an unlinked token is lit on its own.
 *
 * Writes run on the active GM (token documents a player may not own); with no
 * GM connected, `setWorn` asks the toggling user to do it.
 *
 * Public API:
 *   isLightItem(item) / activeWornLight(actor)
 *   planTokenLight({wearing, current, baseline, want})   (pure, tested)
 *   refreshActorLight(actor, {force}) / registerWearableLight()
 */

import { WEARABLE_TYPES, WORN_FLAG, nameKey } from "./appearance-data.js";
import { isGearDamaged, gearDamageChanged } from "./gear-damage.js";
import { isActiveGM } from "./gm-authority.js";

const MODULE        = "sta2e-toolkit";
const BASELINE_FLAG = "lightBaseline";
const SETTING_KEYS  = ["flashlightItems", "flashlightBright", "flashlightDim", "flashlightAngle", "flashlightColor"];

// ── Which items, who wears one ───────────────────────────────────────────────

function _setting(key, fallback) {
  try { return game.settings.get(MODULE, key) ?? fallback; } catch { return fallback; }
}

function _lightNames() {
  const raw = String(_setting("flashlightItems", "Flashlight, Beacon, Wrist Beacon, Palm Beacon, Torch"));
  return new Set(raw.split(/[,;]/).map(nameKey).filter(Boolean));
}

export function isLightItem(item) {
  if (!item || !WEARABLE_TYPES.has(item.type)) return false;
  return _lightNames().has(nameKey(item.name));
}

/** The worn, working flashlight an actor carries, or null. A broken one is dark. */
export function activeWornLight(actor) {
  if (!actor?.items) return null;
  const names = _lightNames();
  return actor.items.find(i => WEARABLE_TYPES.has(i.type)
    && i.getFlag?.(MODULE, WORN_FLAG) === true
    && !isGearDamaged(i)
    && names.has(nameKey(i.name))) ?? null;
}

/** The light a flashlight throws, from the world settings. */
export function flashlightLightData() {
  const num = (k, d) => { const n = Number(_setting(k, d)); return Number.isFinite(n) ? n : d; };
  const color = _setting("flashlightColor", "#fff1d0");
  return {
    bright:      Math.max(0, num("flashlightBright", 3)),
    dim:         Math.max(0, num("flashlightDim", 6)),
    angle:       Math.min(360, Math.max(1, num("flashlightAngle", 120))),
    color:       color ? String(color) : "#fff1d0",
    alpha:       0.4,
    attenuation: 0.5,
    luminosity:  0.5,
  };
}

// ── The plan ─────────────────────────────────────────────────────────────────

function _differs(want, current) {
  return Object.entries(want).some(([k, v]) => String(current?.[k] ?? "") !== String(v ?? ""));
}

/**
 * What a token's light should become. Pure.
 * @param {boolean} wearing  the actor wears a working flashlight
 * @param {object}  current  the token's light as stored
 * @param {object?} baseline the saved own light, if the token is lit by us
 * @param {object}  want     the flashlight's light
 * @returns {{light: object, baseline: object|null|undefined}|null}
 *   `baseline: object` saves one, `null` deletes it, `undefined` leaves it.
 */
export function planTokenLight({ wearing, current, baseline, want }) {
  if (wearing) {
    if (!baseline) return { light: { ...want }, baseline: { ...(current ?? {}) } };
    return _differs(want, current) ? { light: { ...want }, baseline: undefined } : null;
  }
  if (baseline) return { light: { ...baseline }, baseline: null };
  return null;
}

function _unset(path) {
  const Del = foundry.data.operators?.ForcedDeletion;
  if (Del) return { [path]: new Del() };
  const i = path.lastIndexOf(".");
  return { [`${path.slice(0, i)}.-=${path.slice(i + 1)}`]: null };
}

/** The update data for a token, or null when nothing changes. */
function _tokenUpdate(tokenDoc, actor) {
  const src = tokenDoc._source ?? tokenDoc;
  const plan = planTokenLight({
    wearing:  !!activeWornLight(actor),
    current:  src.light,
    baseline: foundry.utils.getProperty(src, `flags.${MODULE}.${BASELINE_FLAG}`),
    want:     flashlightLightData(),
  });
  if (!plan) return null;
  const update = { light: plan.light };
  if (plan.baseline) update[`flags.${MODULE}.${BASELINE_FLAG}`] = plan.baseline;
  else if (plan.baseline === null) Object.assign(update, _unset(`flags.${MODULE}.${BASELINE_FLAG}`));
  return update;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Every placed token that shows this actor: its own for a synthetic actor, all scenes for a linked one. */
function _tokensOf(actor) {
  if (!actor) return [];
  if (actor.isToken) return actor.token ? [actor.token] : [];
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const td of scene.tokens) if (td.actorLink && td.actorId === actor.id) out.push(td);
  }
  return out;
}

async function _applyAll(pairs) {
  const byScene = new Map();
  for (const [td, actor] of pairs) {
    const upd = _tokenUpdate(td, actor);
    if (!upd || !td.parent) continue;
    if (!byScene.has(td.parent)) byScene.set(td.parent, []);
    byScene.get(td.parent).push({ _id: td.id, ...upd });
  }
  for (const [scene, updates] of byScene) {
    try { await scene.updateEmbeddedDocuments("Token", updates); }
    catch (err) { console.warn("STA2e Toolkit | Flashlight: could not update token light", err); }
  }
}

/** Re-light (or put out) every token of an actor. Active GM only unless forced. */
export async function refreshActorLight(actor, { force = false } = {}) {
  if (!actor || (!force && !isActiveGM())) return;
  await _applyAll(_tokensOf(actor).map(td => [td, actor]));
}

/** After a settings change: every token we lit, on every scene. */
async function _refreshLitTokens() {
  if (!isActiveGM()) return;
  const pairs = [];
  for (const scene of game.scenes ?? []) {
    for (const td of scene.tokens) {
      if (td.getFlag(MODULE, BASELINE_FLAG) || activeWornLight(td.actor)) pairs.push([td, td.actor]);
    }
  }
  await _applyAll(pairs);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function _wornChanged(changes) {
  const get = foundry.utils.getProperty;
  return get(changes, `flags.${MODULE}.${WORN_FLAG}`) !== undefined
      || get(changes, `flags.${MODULE}.-=${WORN_FLAG}`) !== undefined;
}

let _registered = false;

export function registerWearableLight() {
  if (_registered) return;
  _registered = true;

  // A renamed item may have become, or stopped being, a flashlight, so a name
  // change refreshes on any wearable; the plan is a no-op when nothing moved.
  Hooks.on("updateItem", (item, changes) => {
    if (!WEARABLE_TYPES.has(item.type)) return;
    if (!_wornChanged(changes) && !gearDamageChanged(changes) && changes?.name === undefined) return;
    refreshActorLight(item.parent);
  });
  for (const hook of ["createItem", "deleteItem"]) {
    Hooks.on(hook, (item) => { if (isLightItem(item)) refreshActorLight(item.parent); });
  }

  // A new token (placed, beamed in, carried to another scene) arrives lit —
  // or, when it was copied from a lit token whose wearer has since put the
  // flashlight away, with its own light back.
  Hooks.on("preCreateToken", (doc) => {
    try {
      const actor = doc.actor ?? game.actors.get(doc.actorId);
      const upd = _tokenUpdate(doc, actor);
      if (upd) doc.updateSource(upd);
    } catch (err) {
      console.warn("STA2e Toolkit | Flashlight: placement light failed", err);
    }
  });

  // A world's first write of a setting creates its document, firing only createSetting.
  const onSetting = (setting) => {
    const key = String(setting?.key ?? "");
    if (SETTING_KEYS.some(k => key === `${MODULE}.${k}`)) _refreshLitTokens();
  };
  Hooks.on("createSetting", onSetting);
  Hooks.on("updateSetting", onSetting);
}
