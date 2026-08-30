/**
 * Warp Viewscreen — saved look presets.
 *
 * Every environment in viewscreen-environments.js ships a tuned `defaults` block,
 * and picking one writes it. That is a *starting* point, though: a GM who has
 * dialled a slipstream to taste had no way to keep it, and redid the same dozen
 * sliders on every region and every scene. A preset is that work, saved.
 *
 * **A preset belongs to an environment.** It stores the look fields only — never
 * the phase, never the vanishing point, never the backdrop image — so applying
 * one changes how the screen looks and nothing about what that particular region
 * *is*. One preset per environment may be marked the default, and the panel then
 * applies it in place of the built-in tuning whenever that environment is picked,
 * which is the whole point of the feature.
 *
 * Stored in a single world setting, so the library is shared by every region on
 * every scene and by a co-GM. The shape is the `sfx-board.js` contract:
 *
 *   { entries: [ { id, label, environment, isDefault, look: {...} } ] }
 *
 * Deliberately **not** shared with Scene Warp. The two surfaces share most field
 * names but not all of them, and a half-applying preset is worse than none.
 *
 * Imports only `viewscreen-environments.js`, which is itself a leaf — so this
 * stays safe for the panel, the behavior and any future caller to pull in.
 */

import {
  environmentDefaults,
  isEnvironmentId,
  DEFAULT_ENVIRONMENT,
} from "./viewscreen-environments.js";

const MODULE = "sta2e-toolkit";

/** The world setting holding the whole library. */
export const VIEWSCREEN_PRESET_SETTING = "viewscreenLookPresets";

/**
 * The look fields a preset carries.
 *
 * Everything the panel's appearance controls write, and nothing else. The
 * exclusions are the point:
 *
 * - `phase` / `phaseAt` are live state, not a look.
 * - `warpFactor` is a control the GM rides during play.
 * - `vanishX` / `vanishY` / `inbound` / `aboveTokens` describe *this region* —
 *   where its screen points and what it sits behind. Carrying them between
 *   regions would aim one viewscreen at another's vanishing point.
 * - `images` / `activeImage` / `image*` are that region's own content.
 * - `environment` is the key a preset is filed under, not a field it stores.
 */
export const PRESET_FIELDS = Object.freeze([
  "intensity", "starMix", "lightning", "interference", "spread", "density",
  "starTint", "accentTint", "variety", "streakMul", "thickness",
  "backdrop", "backdropAlpha", "nebula", "flash", "sublightDrift",
]);

/** The three that arrive as a Color instance and have to be stored as a string. */
const COLOUR_FIELDS = new Set(["starTint", "accentTint", "backdrop"]);

// ── Reading ──────────────────────────────────────────────────────────────────

/** Keep only the preset fields, and only the ones actually present. */
export function pickPresetLook(source) {
  const out = {};
  if (!source) return out;
  for (const key of PRESET_FIELDS) {
    const v = source[key];
    if (v === undefined) continue;
    // A ColorField hands back a Color instance; its toString is #rrggbb, which
    // is what the schema and every colour input want back.
    out[key] = COLOUR_FIELDS.has(key) ? String(v) : v;
  }
  return out;
}

/** One stored entry, defended. Returns null for anything unusable. */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id:          String(raw.id || foundry.utils.randomID()),
    label:       String(raw.label ?? "").trim(),
    environment: isEnvironmentId(raw.environment) ? raw.environment : DEFAULT_ENVIRONMENT,
    isDefault:   raw.isDefault === true,
    look:        pickPresetLook(raw.look),
  };
}

/**
 * The whole library, normalized.
 *
 * Accepts a bare array as well as `{entries}` so a hand-edited setting or an
 * older shape still reads, exactly as `normalizeSfxEntries` does.
 */
export function normalizeViewscreenPresets(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
  const entries = [];
  const seenDefault = new Set();
  for (const item of list) {
    const entry = normalizeEntry(item);
    if (!entry) continue;
    // One default per environment is an invariant, not a hope — a setting edited
    // by hand, or two clients racing, must not be able to break it.
    if (entry.isDefault) {
      if (seenDefault.has(entry.environment)) entry.isDefault = false;
      else seenDefault.add(entry.environment);
    }
    entries.push(entry);
  }
  return { entries };
}

/** Every saved preset. Never throws — a broken setting reads as empty. */
export function getViewscreenPresets() {
  try {
    return normalizeViewscreenPresets(game.settings.get(MODULE, VIEWSCREEN_PRESET_SETTING));
  } catch (err) {
    console.warn("STA2e Toolkit | viewscreen presets: could not read the library:", err);
    return { entries: [] };
  }
}

/** The presets filed under one environment, in the order they were saved. */
export function presetsForEnvironment(environment) {
  return getViewscreenPresets().entries.filter(e => e.environment === environment);
}

/** One preset by id, or null. */
export function getViewscreenPreset(id) {
  if (!id) return null;
  return getViewscreenPresets().entries.find(e => e.id === String(id)) ?? null;
}

/** The preset marked default for an environment, or null. */
export function defaultPresetFor(environment) {
  return presetsForEnvironment(environment).find(e => e.isDefault) ?? null;
}

/** A readable name, so a nameless entry is never a blank dropdown row. */
export function presetLabel(entry) {
  const own = String(entry?.label ?? "").trim();
  return own || "Untitled preset";
}

/**
 * What picking an environment should write.
 *
 * The built-in tuning, with the GM's default preset for that environment laid
 * over it — so a saved default genuinely replaces the shipped one, while any
 * field the preset happens not to carry still lands on a sane value. This is the
 * single answer to "what does this environment look like", and every caller that
 * used to reach for `environmentDefaults` directly should use this instead.
 */
export function resolveEnvironmentLook(environment) {
  const base   = environmentDefaults(environment);
  const preset = defaultPresetFor(environment);
  return preset ? { ...base, ...preset.look } : base;
}

// ── Writing ──────────────────────────────────────────────────────────────────

async function _write(entries) {
  await game.settings.set(MODULE, VIEWSCREEN_PRESET_SETTING, { entries });
}

function _clearDefaults(entries, environment) {
  for (const e of entries) if (e.environment === environment) e.isDefault = false;
  return entries;
}

/** Save a look as a new preset. Returns the new entry's id. */
export async function saveViewscreenPreset({ label, environment, look, isDefault = false }) {
  const { entries } = getViewscreenPresets();
  const entry = normalizeEntry({
    id: foundry.utils.randomID(), label, environment, look, isDefault,
  });
  const next = isDefault ? _clearDefaults(entries, entry.environment) : entries;
  await _write([...next, entry]);
  return entry.id;
}

/** Patch one preset in place — its label, its look, or both. */
export async function updateViewscreenPreset(id, changes = {}) {
  const { entries } = getViewscreenPresets();
  const entry = entries.find(e => e.id === String(id));
  if (!entry) return false;
  if ("label" in changes) entry.label = String(changes.label ?? "").trim();
  if ("look"  in changes) entry.look  = pickPresetLook(changes.look);
  await _write(entries);
  return true;
}

/** Delete one preset. */
export async function deleteViewscreenPreset(id) {
  const { entries } = getViewscreenPresets();
  const next = entries.filter(e => e.id !== String(id));
  if (next.length === entries.length) return false;
  await _write(next);
  return true;
}

/**
 * Mark one preset the default for its environment, or clear the flag.
 *
 * Clearing every *other* default in the same environment happens here rather
 * than in the caller, because "one default per environment" is the rule the
 * whole feature rests on — `resolveEnvironmentLook` takes the first it finds.
 */
export async function setDefaultViewscreenPreset(id, on = true) {
  const { entries } = getViewscreenPresets();
  const entry = entries.find(e => e.id === String(id));
  if (!entry) return false;
  if (on) _clearDefaults(entries, entry.environment);
  entry.isDefault = !!on;
  await _write(entries);
  return true;
}
