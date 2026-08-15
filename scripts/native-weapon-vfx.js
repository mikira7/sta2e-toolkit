/**
 * sta2e-toolkit | native-weapon-vfx.js
 *
 * Experimental Foundry canvas / PIXI weapon animations.
 */

import {
  advanceShipArrayCurveWalk,
  getClosestShipArrayCurveMatch,
  getShipWeaponVfxSettings,
  getShipHitLocationPointForShot,
  getShipWeaponEmitterArcSelection,
  getShipWeaponEmitterCluster,
  getShipWeaponEmitterAnchors,
  getTokenAlphaMask,
  isShipArrayWeapon,
  sampleShipArrayCurvePointAtT,
  shipWeaponAnchorToCanvasPoint,
  tokenAnchorToCanvasPoint,
  tokenTextureSource,
} from "./ship-vfx-anchors.js";
import {
  scheduleHullImpactVFX,
  scheduleShieldImpactVFX,
  shieldStopPoint,
} from "./shield-impact-vfx.js";

const MODULE = "sta2e-toolkit";
const VFX_Z_BASE = 920_000;
const PHASER_PRIMARY = 0xff9a33;
const PHASER_CORE = 0xfff2c0;
const DISABLE_WEAPON_AUTO_ROTATE_FLAG = "disableWeaponAutoRotate";
const ARRAY_CHARGE_WARNED = new Set();

// One native effect per energy weapon FAMILY, shared by every energy type. The
// bank/array keys predate the other families and still read "phaser" so a world
// that already opted into the experimental phaser VFX keeps its choice — they
// now cover every energy type, not just phasers.
export const NATIVE_VFX_KEY_BY_FAMILY = Object.freeze({
  bank: "weapon-phaser-bank",
  array: "weapon-phaser-array",
  lance: "weapon-energy-lance",
  cannon: "weapon-energy-cannon",
});

export const NATIVE_WEAPON_VFX_DEFAULT_MODES = Object.freeze({
  "weapon-phaser-bank": "current",
  "weapon-phaser-array": "current",
  "weapon-energy-lance": "current",
  "weapon-energy-cannon": "current",
});

const NATIVE_ENERGY_TYPES_HINT = "Covers phaser, phase-pulse, disruptor, polaron, antiproton, "
  + "tetryon, graviton, proton, free electron laser and ionic weapons.";

export const NATIVE_WEAPON_VFX_MODE_ROWS = Object.freeze([
  { key: "weapon-phaser-bank", label: "Energy Banks",
    hint: `Experimental: a burst of short beam bolts per target. ${NATIVE_ENERGY_TYPES_HINT}` },
  { key: "weapon-phaser-array", label: "Energy Arrays",
    hint: `Experimental: continuous strip beam with a charge-up along the array spine. ${NATIVE_ENERGY_TYPES_HINT}` },
  { key: "weapon-energy-lance", label: "Spinal Lances",
    hint: `Experimental: heavy strike drawn like the array beam, fired from an emitter with no spine charge-up. ${NATIVE_ENERGY_TYPES_HINT}` },
  { key: "weapon-energy-cannon", label: "Energy Cannons",
    hint: `Experimental: discrete bolts that travel to the target, one per shot. ${NATIVE_ENERGY_TYPES_HINT}` },
]);

const SUPPORTED_NATIVE_WEAPONS = new Set(Object.keys(NATIVE_WEAPON_VFX_DEFAULT_MODES));

// Which appearance group each family draws from, and which draw function it uses.
const NATIVE_FAMILY_BY_VFX_KEY = Object.freeze(
  Object.fromEntries(Object.entries(NATIVE_VFX_KEY_BY_FAMILY).map(([family, key]) => [key, family])),
);

// ── Beam appearance ─────────────────────────────────────────────────────────
// Every value below is the literal the beam draw functions used before this was
// configurable, so an unset world keeps the stock look.

export const BEAM_VFX_EASING_OPTIONS = Object.freeze(["linear", "inQuad", "outQuad", "inOutQuad"]);
export const BEAM_VFX_BLEND_OPTIONS = Object.freeze(["add", "normal"]);
// Which phaser era fires travelling bolts instead of a held beam. "off" disables.
export const BEAM_VFX_TRACER_ERA_OPTIONS = Object.freeze(["off", "ent", "tos", "tmp", "tng"]);

/**
 * Energy weapon types, matched against the weapon's NAME. Only phaser, disruptor
 * and polaron have icons in the system's compendium, so every other type is
 * recognised by what the GM called the item.
 *
 * ORDER MATTERS — each pattern is tried in turn and the first hit wins:
 *   "phasePulse" before "phaser"        ("Phase-Pulse Cannon")
 *   "phasedPolaron" before "polaron"    ("Phased Polaron Beam Array")
 *   "antiproton" before "proton"        (\bprotons?\b matches "anti-proton")
 * The \b anchors keep "proton" out of "Photon"/"Photonic", "tetryon" out of
 * "Tetryonic Torpedo" and "graviton" out of "Gravimetric Torpedo".
 */
export const ENERGY_VFX_TYPES = Object.freeze([
  { id: "phasePulse",        label: "Phase-Pulse",          pattern: /\bphase[-\s]?pulse\b/,        color: "#ffc14d", core: "#fff6d8" },
  { id: "phasedPolaron",     label: "Phased Polaron",       pattern: /\bphased[-\s]?polarons?\b/,   color: "#c77dff", core: "#f3e4ff" },
  { id: "antiproton",        label: "Antiproton",           pattern: /\banti[-\s]?protons?\b/,      color: "#b06bff", core: "#eddcff" },
  { id: "freeElectronLaser", label: "Free Electron Laser",  pattern: /\blasers?\b/,                 color: "#b6ff6b", core: "#f0ffd8" },
  { id: "electromagnetic",   label: "Electromagnetic / Ionic", pattern: /\b(electro[-\s]?magnetic|ionic|ion)\b/, color: "#4dd2ff", core: "#dff6ff" },
  { id: "disruptor",         label: "Disruptor",            pattern: /\bdisruptors?\b/,             color: "#66ff99", core: "#ddffe8" },
  { id: "polaron",           label: "Polaron",              pattern: /\bpolarons?\b/,               color: "#aa66ff", core: "#ecd9ff" },
  { id: "tetryon",           label: "Tetryon",              pattern: /\btetryons?\b/,               color: "#7fe3ff", core: "#e6faff" },
  { id: "graviton",          label: "Graviton",             pattern: /\bgravitons?\b/,              color: "#8a9bff", core: "#dfe4ff" },
  { id: "proton",            label: "Proton",               pattern: /\bprotons?\b/,                color: "#ffe066", core: "#fffbe0" },
  { id: "phaser",            label: "Phaser",               pattern: /\bphasers?\b/,                color: "#ff9a33", core: "#fff2c0" },
]);

/** Used when a preview has no weapon to read a type off. */
export const DEFAULT_ENERGY_VFX_TYPE = "phaser";

/** The energy type a piece of text names, or null when it names none. */
export function energyTypeFromName(name) {
  const text = String(name ?? "").toLowerCase();
  return ENERGY_VFX_TYPES.find(type => type.pattern.test(text))?.id ?? null;
}

/**
 * The energy type an item is. The NAME is authoritative — items routinely
 * borrow another type's icon, and a "Tetryon Beam Array" on a disruptor icon
 * must not come out green — with the icon slug as a fallback for items named
 * something evocative like "Forward Battery".
 */
export function energyTypeForWeapon(weapon) {
  // Only the icon's file name, never the folders it sits in — a custom art path
  // like "worlds/x/Ion Storm/beam.webp" must not type a Tractor Beam as ionic.
  const slug = String(weapon?.img ?? "").split("/").pop().replace(/\.[a-z0-9]+$/i, "");
  return energyTypeFromName(weapon?.name) ?? energyTypeFromName(slug);
}

const DEFAULT_ENERGY_COLORS = Object.freeze(Object.fromEntries(
  ENERGY_VFX_TYPES.flatMap(({ id, color, core }) => [[`${id}Color`, color], [`${id}Core`, core]]),
));

export const DEFAULT_BEAM_VFX_SETTINGS = Object.freeze({
  bank: Object.freeze({
    glowWidth: 2,
    glowAlpha: 0.26,
    coreWidth: 2,
    coreAlpha: 0.94,
    muzzleFillRadius: 2,
    muzzleFillAlpha: 0.88,
    muzzleRingRadius: 2,
    muzzleRingWidth: 0,
    muzzleRingAlpha: 0.56,
    impactFillRadius: 1,
    impactFillAlpha: 0.8,
    impactRingRadius: 1,
    impactRingWidth: 0,
    impactRingAlpha: 0.84,
    hitDuration: 360,
    missDuration: 360,
    burstGap: 95,
    targetGap: 520,
  }),
  array: Object.freeze({
    haloWidth: 0,
    haloAlpha: 0.18,
    railWidth: 0.5,
    railAlpha: 0.16,
    railOffset: 0,
    coreWidth: 1.5,
    coreAlpha: 0.96,
    sweepWidth: 0,
    sweepAlpha: 0.72,
    sweepColor: "#ffffff",
    impactFillRadius: 2,
    impactFillAlpha: 0.84,
    impactRingRadius: 1,
    impactRingWidth: 1.5,
    impactRingAlpha: 0.62,
    hitDuration: 760,
    missDuration: 360,
    shotGap: 160,
  }),
  // Spinal Lance — the array beam with a fatter core. Blank sweep colour so the
  // hot line follows the energy type's own core colour.
  lance: Object.freeze({
    haloWidth: 0,
    haloAlpha: 0.18,
    railWidth: 0.5,
    railAlpha: 0.16,
    railOffset: 0,
    coreWidth: 3.5,
    coreAlpha: 0.96,
    sweepWidth: 0,
    sweepAlpha: 0.72,
    sweepColor: "",
    impactFillRadius: 2,
    impactFillAlpha: 0.84,
    impactRingRadius: 1,
    impactRingWidth: 1.5,
    impactRingAlpha: 0.62,
    hitDuration: 760,
    missDuration: 360,
    shotGap: 160,
  }),
  // Energy cannons never draw a held line: every shot is a discrete bolt that
  // travels to the target, so a volley reads as a stream of droplets. Lifetime
  // is derived from the travel time, hence no hit/miss duration here.
  cannon: Object.freeze({
    glowWidth: 4,
    glowAlpha: 0.3,
    coreWidth: 2,
    coreAlpha: 0.94,
    boltCount: 1,
    boltLength: 18,
    boltSpacing: 70,
    travelDuration: 240,
    tailFade: 0.25,
    muzzleFillRadius: 3,
    muzzleFillAlpha: 0.88,
    muzzleRingRadius: 3,
    muzzleRingWidth: 0,
    muzzleRingAlpha: 0.56,
    impactFillRadius: 2,
    impactFillAlpha: 0.8,
    impactRingRadius: 2,
    impactRingWidth: 0,
    impactRingAlpha: 0.84,
    burstGap: 95,
    targetGap: 520,
  }),
  shared: Object.freeze({
    holdPercent: 0.55,
    easing: "inQuad",
    blendMode: "add",
    cleanupDelay: 120,
    emitterPairDistance: 0.12,
    // GlowFilter halo around every native energy effect. Size 0 skips the
    // filter entirely, which is also the escape hatch if the extra render pass
    // costs too much on a busy scene.
    glowSize: 8,
    glowStrength: 1.6,
    glowInnerStrength: 0,
    glowQuality: 0.25,
  }),
  // Per-era tint for phaser BANKS, keyed off the ship's phaserEra weapon
  // setting. Blank means "no era tint" — the beam keeps its normal colour.
  // Defaults follow the JB2A assets PHASER_ERA_EFFECTS already picks per era.
  eraColors: Object.freeze({
    entColor: "#ff9a33", entCore: "#fff2c0",
    tosColor: "#3fa9ff", tosCore: "#d8f0ff",
    tmpColor: "#ff3b30", tmpCore: "#ffd9c0",
    tngColor: "#ff9a33", tngCore: "#fff2c0",
  }),
  // Per-energy-type tint, applied to every family. Beaten by the ship's own
  // colour override and (for phaser banks) by the era tint above.
  energyColors: Object.freeze({ ...DEFAULT_ENERGY_COLORS }),
  tracer: Object.freeze({
    era: "tmp",
    boltLength: 46,
    boltCount: 5,
    boltSpacing: 55,
    travelDuration: 220,
    volleyGap: 180,
    glowWidth: 10,
    glowAlpha: 0.3,
    coreWidth: 3,
    coreAlpha: 0.95,
    tailFade: 0.5,
  }),
});

// Clamps shared by the held-line family (banks) and the two beam-style ones
// (arrays, lances). Spelled once and stamped per group so they cannot drift.
const BOLT_FAMILY_RANGES = Object.freeze({
  glowWidth: [0, 60], glowAlpha: [0, 1],
  coreWidth: [0, 60], coreAlpha: [0, 1],
  muzzleFillRadius: [0, 60], muzzleFillAlpha: [0, 1],
  muzzleRingRadius: [0, 60], muzzleRingWidth: [0, 60], muzzleRingAlpha: [0, 1],
  impactFillRadius: [0, 60], impactFillAlpha: [0, 1],
  impactRingRadius: [0, 60], impactRingWidth: [0, 60], impactRingAlpha: [0, 1],
  hitDuration: [60, 4000], missDuration: [60, 4000],
  burstGap: [0, 2000], targetGap: [0, 2000],
});

const BEAM_FAMILY_RANGES = Object.freeze({
  haloWidth: [0, 60], haloAlpha: [0, 1],
  railWidth: [0, 60], railAlpha: [0, 1], railOffset: [0, 40],
  coreWidth: [0, 60], coreAlpha: [0, 1],
  sweepWidth: [0, 60], sweepAlpha: [0, 1],
  impactFillRadius: [0, 60], impactFillAlpha: [0, 1],
  impactRingRadius: [0, 60], impactRingWidth: [0, 60], impactRingAlpha: [0, 1],
  hitDuration: [60, 4000], missDuration: [60, 4000],
  shotGap: [0, 2000],
});

// Cannons fire travelling bolts, so they carry the bolt's flight dials instead
// of a held-line lifetime.
const CANNON_RANGES = Object.freeze({
  glowWidth: [0, 60], glowAlpha: [0, 1],
  coreWidth: [0, 60], coreAlpha: [0, 1],
  boltCount: [1, 24], boltLength: [2, 400], boltSpacing: [5, 500],
  travelDuration: [40, 2000], tailFade: [0, 1],
  muzzleFillRadius: [0, 60], muzzleFillAlpha: [0, 1],
  muzzleRingRadius: [0, 60], muzzleRingWidth: [0, 60], muzzleRingAlpha: [0, 1],
  impactFillRadius: [0, 60], impactFillAlpha: [0, 1],
  impactRingRadius: [0, 60], impactRingWidth: [0, 60], impactRingAlpha: [0, 1],
  burstGap: [0, 2000], targetGap: [0, 2000],
});

function _groupRanges(group, ranges) {
  return Object.fromEntries(Object.entries(ranges).map(([field, range]) => [`${group}.${field}`, range]));
}

// path → [min, max] clamp for every numeric beam field. Anything not listed is
// a string/enum and is validated separately.
const BEAM_VFX_RANGES = Object.freeze({
  ..._groupRanges("bank", BOLT_FAMILY_RANGES),
  ..._groupRanges("cannon", CANNON_RANGES),
  ..._groupRanges("array", BEAM_FAMILY_RANGES),
  ..._groupRanges("lance", BEAM_FAMILY_RANGES),

  "shared.holdPercent": [0.05, 0.95],
  "shared.cleanupDelay": [0, 2000],
  "shared.emitterPairDistance": [0, 0.5],
  "shared.glowSize": [0, 40], "shared.glowStrength": [0, 8],
  "shared.glowInnerStrength": [0, 4], "shared.glowQuality": [0.05, 1],

  "tracer.boltLength": [4, 400], "tracer.boltCount": [1, 24],
  "tracer.boltSpacing": [5, 500], "tracer.travelDuration": [40, 2000],
  "tracer.volleyGap": [0, 2000],
  "tracer.glowWidth": [0, 60], "tracer.glowAlpha": [0, 1],
  "tracer.coreWidth": [0, 30], "tracer.coreAlpha": [0, 1],
  "tracer.tailFade": [0, 1],
});

function _clampHoldPercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.05, Math.min(0.95, numeric));
}

function _clampBeamValue(path, value, fallback) {
  const range = BEAM_VFX_RANGES[path];
  if (!range) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(range[0], Math.min(range[1], numeric));
}

/** Merge a stored/partial beam config over the defaults, clamping every field. */
export function normalizeBeamVfxSettings(raw = {}) {
  const out = {};
  for (const [group, defaults] of Object.entries(DEFAULT_BEAM_VFX_SETTINGS)) {
    const source = raw?.[group] ?? {};
    const merged = {};
    for (const [field, fallback] of Object.entries(defaults)) {
      const path = `${group}.${field}`;
      if (typeof fallback === "number") {
        merged[field] = _clampBeamValue(path, source[field], fallback);
        continue;
      }
      if (field === "easing") {
        merged[field] = BEAM_VFX_EASING_OPTIONS.includes(source[field]) ? source[field] : fallback;
        continue;
      }
      if (field === "blendMode") {
        merged[field] = BEAM_VFX_BLEND_OPTIONS.includes(source[field]) ? source[field] : fallback;
        continue;
      }
      if (field === "era") {
        merged[field] = BEAM_VFX_TRACER_ERA_OPTIONS.includes(source[field]) ? source[field] : fallback;
        continue;
      }
      // Colour fields: blank is meaningful (no tint — defer to the next colour
      // down), but only when the user actually cleared it. A key that was never
      // saved — an older world predating this group — takes the default.
      if (!(field in Object(source))) {
        merged[field] = fallback;
        continue;
      }
      const text = String(source[field] ?? "").trim();
      merged[field] = (text === "" || /^#[0-9a-f]{6}$/i.test(text)) ? text : fallback;
    }
    out[group] = merged;
  }
  return out;
}

/** World beam appearance, read live so edits apply without a reload. */
export function getBeamVfxSettings() {
  try { return normalizeBeamVfxSettings(game.settings.get(MODULE, "beamVfxAppearance") ?? {}); }
  catch { return normalizeBeamVfxSettings({}); }
}

export function normalizeWeaponAnimationModes(modes = {}) {
  const normalized = { ...NATIVE_WEAPON_VFX_DEFAULT_MODES };
  for (const key of Object.keys(normalized)) {
    normalized[key] = modes?.[key] === "experimental" ? "experimental" : "current";
  }
  return normalized;
}

export function getWeaponAnimationMode(weaponKey) {
  try {
    const modes = normalizeWeaponAnimationModes(game.settings.get(MODULE, "weaponAnimationModes") ?? {});
    return modes[weaponKey] ?? "current";
  } catch {
    return "current";
  }
}

export function shouldUseNativeWeaponVFX(weaponKey) {
  return SUPPORTED_NATIVE_WEAPONS.has(weaponKey) && getWeaponAnimationMode(weaponKey) === "experimental";
}

/**
 * The native effect a weapon config maps to. An explicit `nativeVfxKey` still
 * wins (nothing sets one today), otherwise the weapon's family picks the effect
 * — which is what makes every energy type native-capable at once.
 */
export function nativeVfxKeyForConfig(config) {
  return config?.nativeVfxKey ?? NATIVE_VFX_KEY_BY_FAMILY[config?.family] ?? null;
}

export async function fireNativeWeaponVFX(config, isHit, sourceToken, targets, options = {}) {
  const weaponKey = nativeVfxKeyForConfig(config);
  if (!shouldUseNativeWeaponVFX(weaponKey)) return false;
  const targetList = _normalizeTargets(targets);
  if (!_nativeAvailable(sourceToken, targetList)) return false;

  try {
    const family = NATIVE_FAMILY_BY_VFX_KEY[weaponKey];
    const opts = {
      ...options,
      family,
      repeatCount: _normalizeRepeatCount(options.repeatCount),
      soundPath: isHit ? config.sound : (config.missSound ?? config.sound),
      // Optional audio for the 2nd and later strikes of an array volley,
      // resolved by fireWeapon. Blank falls back to soundPath.
      repeatSoundPath: options.repeatSoundPath ?? null,
    };

    // Banks and cannons fire bolts; arrays and lances draw a held strip beam.
    if (family === "bank" || family === "cannon") {
      await _fireEnergyBolts(isHit, sourceToken, targetList, opts);
      return true;
    }

    if (family === "array" || family === "lance") {
      await _fireEnergyBeams(isHit, sourceToken, targetList, opts);
      return true;
    }

  } catch (err) {
    console.warn("STA2e Toolkit | Native weapon VFX failed; falling back to current animation:", err);
    return false;
  }

  return false;
}

export async function playArrayCurveChargeVFX(sourceToken, weapon, targetPoint, options = {}) {
  if (!globalThis.PIXI || !canvas?.ready) return null;
  const settings = getShipWeaponVfxSettings(sourceToken, weapon, options.vfxSettings);
  const charge = _chargeOptions(settings, options);
  const curveMatch = _arrayCurveMatchForShot(sourceToken, weapon, targetPoint, settings);
  if (curveMatch) {
    const meetPoint = await _arrayCurveCharge(curveMatch, charge);
    if (meetPoint) return meetPoint;
  }

  const sourcePoint = _sourcePointForShot(sourceToken, weapon, targetPoint, options.shotIndex ?? 0, settings, options.selectedEmitter);
  if (!sourcePoint) return null;
  await _arrayChargeSourcePulse(sourcePoint, targetPoint, charge);
  return sourcePoint;
}

export async function previewShipWeaponVFX(sourceToken, weapon, targetPoint, options = {}) {
  if (!globalThis.PIXI || !canvas?.ready || !sourceToken || !targetPoint) return false;
  const settings = getShipWeaponVfxSettings(sourceToken, weapon, options.vfxSettings);
  // The Beam VFX tab previews unsaved slider positions by passing them in here.
  const beam = options.beamSettings ? normalizeBeamVfxSettings(options.beamSettings) : getBeamVfxSettings();
  // Callers that know the weapon's config hand the family in; fall back to the
  // array test so an unannotated caller still gets the right shape.
  const family = NATIVE_VFX_KEY_BY_FAMILY[options.family]
    ? options.family
    : (isShipArrayWeapon(weapon) ? "array" : "bank");
  const shape = beam[family];
  const isBeamFamily = family === "array" || family === "lance";
  // Era tint is a phaser-bank feature; every other family and type keeps its
  // own energy colour.
  const eraApplies = family === "bank" && _eraAppliesToWeapon(weapon);
  const colors = _previewColors(weapon, settings, {
    ...options,
    beam,
    eraColors: eraApplies ? _phaserEraColors(settings, beam) : null,
  });
  if (isBeamFamily) {
    // Lances fire from an emitter, not along the array spine — no charge-up.
    if (family === "array") {
      await playArrayCurveChargeVFX(sourceToken, weapon, targetPoint, {
        ...options,
        vfxSettings: settings,
        isHit: true,
        color: colors.color,
        coreColor: colors.coreColor,
        beam,
      });
    }
    const sourcePoint = _sourcePointForShot(sourceToken, weapon, targetPoint, 0, settings, options.selectedEmitter);
    _arrayBeam(sourcePoint, targetPoint, {
      hit: true,
      // Deliberately ignores options.beamDuration (a Sequencer-path timing) so
      // the preview shows exactly what live fire will look like.
      duration: shape.hitDuration,
      color: colors.color,
      coreColor: colors.coreColor,
      beam,
      shape,
    });
    return true;
  }

  const sourcePoint = _sourcePointForShot(sourceToken, weapon, targetPoint, 0, settings, options.selectedEmitter);
  // Cannons always travel; banks only in the tracer era.
  const bolt = family === "cannon" ? shape
    : (eraApplies && _usesTracer(settings?.phaserEra, beam) ? beam.tracer : null);
  const shot = {
    hit: true,
    duration: shape.hitDuration,
    color: colors.color,
    coreColor: colors.coreColor,
    layer: sourcePoint.layer,
    beam,
    shape,
    bolt,
  };
  if (bolt) _tracerVolley(sourcePoint, targetPoint, shot);
  else _beamShot(sourcePoint, targetPoint, shot);
  return true;
}

/**
 * Draw one beam between two tokens using an explicit appearance config.
 *
 * Used by the Sounds & Animations → Beam VFX tab to preview unsaved slider
 * positions. Deliberately centre-to-centre and colour-agnostic of any ship's
 * emitter/anchor setup, so what you see is the appearance settings alone.
 */
export function previewBeamVfxAppearance(sourceToken, targetToken, options = {}) {
  if (!globalThis.PIXI || !canvas?.ready || !sourceToken || !targetToken) return false;
  const beam = normalizeBeamVfxSettings(options.beamSettings ?? {});
  const sourcePoint = _tokenCenter(sourceToken);
  const targetPoint = _tokenCenter(targetToken);
  const family = NATIVE_VFX_KEY_BY_FAMILY[options.family] ? options.family : "bank";
  const shape = beam[family];
  const energyType = options.energyType || DEFAULT_ENERGY_VFX_TYPE;
  // Era only tints PHASER banks, matching live fire — a tetryon bank never
  // carries an era, so the preview must not pretend it does.
  const eraApplies = family === "bank" && (energyType === "phaser" || energyType === "phasePulse");
  const era = eraApplies ? _phaserEraColors(null, beam, options.era) : null;
  const energy = _energyTypeColors(null, beam, energyType);
  // Cannons always travel; banks only in the tracer era.
  const bolt = family === "cannon" ? shape
    : (eraApplies && _usesTracer(options.era, beam) ? beam.tracer : null);
  const shot = {
    hit: options.hit !== false,
    color: _parseHexColor(era?.color, _parseHexColor(energy?.color, PHASER_PRIMARY)),
    coreColor: _parseHexColor(era?.core, _parseHexColor(energy?.core, PHASER_CORE)),
    beam,
    shape,
    bolt,
    duration: shape.hitDuration,
  };
  if (family === "array" || family === "lance") {
    _arrayBeam(sourcePoint, targetPoint, shot);
  } else if (bolt) {
    _tracerVolley(sourcePoint, targetPoint, shot);
  } else {
    _beamShot(sourcePoint, targetPoint, shot);
  }
  return true;
}

/**
 * Draw the module's native travelling tracer between two absolute canvas
 * points. Point Defense uses this small public surface so its emitters share
 * the global tracer shape and timing without pretending to be a ship weapon.
 */
export function playNativeTracerBetweenPoints(sourcePoint, targetPoint, options = {}) {
  if (!globalThis.PIXI || !canvas?.ready || !sourcePoint || !targetPoint) return false;
  const beam = normalizeBeamVfxSettings(options.beamSettings ?? getBeamVfxSettings());
  const color = _parseHexColor(options.color, PHASER_PRIMARY);
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const brighten = channel => Math.round(channel + ((255 - channel) * 0.72));
  const derivedCore = (brighten(r) << 16) | (brighten(g) << 8) | brighten(b);
  _tracerVolley(sourcePoint, targetPoint, {
    hit: options.hit !== false,
    color,
    coreColor: _parseHexColor(options.coreColor, derivedCore),
    layer: options.layer ?? sourcePoint.layer ?? "above",
    beam,
  });
  return true;
}

function _normalizeTargets(targets) {
  if (!targets) return [];
  if (Array.isArray(targets)) return targets.filter(Boolean);
  if (typeof targets[Symbol.iterator] === "function") return Array.from(targets).filter(Boolean);
  return [targets].filter(Boolean);
}

function _nativeAvailable(sourceToken, targets) {
  return !!globalThis.PIXI
    && !!canvas?.ready
    && !!sourceToken
    && targets.length > 0;
}

function _isWeaponAutoRotateDisabled(token) {
  const doc = token?.document ?? token;
  return !!doc?.getFlag?.(MODULE, DISABLE_WEAPON_AUTO_ROTATE_FLAG);
}

function _effectLayer() {
  const layer = canvas.tokens ?? canvas.interface ?? canvas.primary ?? canvas.stage;
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

function _addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

function _blendMode(mode) {
  if (mode === "normal") return typeof PIXI?.BLEND_MODES?.NORMAL === "number" ? PIXI.BLEND_MODES.NORMAL : "normal";
  return _addBlend();
}

function _parseHexColor(value, fallback) {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  return fallback;
}

function _chargeOptions(settings, options = {}) {
  const charge = settings?.charge ?? {};
  const isMiss = options.isHit === false;
  return {
    ...charge,
    duration: options.duration ?? (isMiss ? charge.missDuration : charge.hitDuration),
    color: _parseHexColor(charge.colorOverride, options.color ?? PHASER_PRIMARY),
    coreColor: _parseHexColor(charge.coreColorOverride, options.coreColor ?? PHASER_CORE),
    // Carried only so the charge-up's glow matches the beam it precedes —
    // including the unsaved slider positions the Beam VFX tab previews with.
    beam: options.beam ?? (options.beamSettings ? normalizeBeamVfxSettings(options.beamSettings) : null),
    // Where on the spine the orbs meet, and how far out they start. Callers ask
    // for a repeat rather than a raw spread so the weapon's own Repeat Spread
    // stays the single source of it.
    meetT: Number.isFinite(Number(options.meetT)) ? Number(options.meetT) : null,
    spreadT: options.repeat ? charge.repeatSpread : 0,
  };
}

/**
 * Era tint for a phaser BANK, from the ship's per-weapon `phaserEra` setting.
 * Returns null when the ship has no era set or the era's swatches are blank.
 */
/** True when this era's banks fire travelling bolts instead of a held beam. */
function _usesTracer(era, beam) {
  const key = String(era ?? "").toLowerCase();
  return !!key && beam?.tracer?.era !== "off" && key === beam?.tracer?.era;
}

/**
 * True when era treatment (tint, tracer fire) applies to this weapon. Era is a
 * phaser feature, and a per-weapon VFX row can be matched by icon — so a
 * "Proton Bank" sharing the phaser-bank icon could otherwise inherit a real
 * phaser's era and come out TOS blue.
 */
function _eraAppliesToWeapon(weapon) {
  const type = energyTypeForWeapon(weapon);
  return !type || type === "phaser" || type === "phasePulse";
}

function _phaserEraColors(settings, beam, eraOverride = null) {
  const era = String(eraOverride ?? settings?.phaserEra ?? "").toLowerCase();
  if (!era) return null;
  const colors = beam?.eraColors ?? {};
  return { color: colors[`${era}Color`] || "", core: colors[`${era}Core`] || "" };
}

/** The configured tint for a weapon's energy type, or null when it has none. */
function _energyTypeColors(weapon, beam, typeOverride = null) {
  const colors = beam?.energyColors ?? {};
  const id = typeOverride ?? energyTypeForWeapon(weapon);
  if (!id) return null;
  return { color: colors[`${id}Color`] || "", core: colors[`${id}Core`] || "" };
}

// Precedence: ship charge.colorOverride > era colour > energy type colour > amber.
// _parseHexColor falls through on anything that isn't #rrggbb, so blank values
// at any level simply defer to the next one down.
function _previewColors(weapon, settings, options = {}) {
  const energy = _energyTypeColors(weapon, options.beam ?? getBeamVfxSettings(), options.energyType);
  // Torpedoes have no energy-type entry; keep the old quantum tint for the
  // Ship VFX Anchors preview, which can be pointed at any weapon.
  if (!energy && /\bquantum\b/i.test(`${weapon?.name ?? ""} ${weapon?.img ?? ""}`)) {
    options = { ...options, color: options.color ?? 0x66ccff };
  }
  return {
    color: _parseHexColor(settings?.charge?.colorOverride,
      _parseHexColor(options.eraColors?.color,
        _parseHexColor(energy?.color, options.color ?? PHASER_PRIMARY))),
    coreColor: _parseHexColor(settings?.charge?.coreColorOverride,
      _parseHexColor(options.eraColors?.core,
        _parseHexColor(energy?.core, options.coreColor ?? PHASER_CORE))),
  };
}

function _easeProgress(raw, easing = "outQuad") {
  const t = Math.max(0, Math.min(1, Number(raw) || 0));
  if (easing === "linear") return t;
  if (easing === "inQuad") return t * t;
  if (easing === "inOutQuad") return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return 1 - Math.pow(1 - t, 2);
}

function _tokenCenter(token) {
  if (token?.center) return { x: token.center.x, y: token.center.y };
  const doc = token?.document ?? token;
  const { width, height } = _tokenDimensions(token);
  return {
    x: (doc?.x ?? token?.x ?? 0) + width / 2,
    y: (doc?.y ?? token?.y ?? 0) + height / 2,
  };
}

function _tokenDimensions(token) {
  const doc = token?.document ?? token;
  const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  return {
    width: token?.w ?? ((doc?.width ?? 1) * gridSize),
    height: token?.h ?? ((doc?.height ?? 1) * gridSize),
  };
}

function _tokenEdgePoint(token, towardPoint, mode = "source") {
  const center = _tokenCenter(token);
  const dx = (towardPoint?.x ?? center.x) - center.x;
  const dy = (towardPoint?.y ?? center.y) - center.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return center;

  const ux = dx / len;
  const uy = dy / len;
  const { width, height } = _tokenDimensions(token);
  const halfW = Math.max(1, width / 2);
  const halfH = Math.max(1, height / 2);
  const edgeX = Math.abs(ux) > 0.0001 ? halfW / Math.abs(ux) : Infinity;
  const edgeY = Math.abs(uy) > 0.0001 ? halfH / Math.abs(uy) : Infinity;
  const edgeDistance = Math.min(edgeX, edgeY);
  const direction = mode === "target" ? -1 : 1;

  return {
    x: center.x + ux * edgeDistance * direction,
    y: center.y + uy * edgeDistance * direction,
  };
}

function _sourcePointForShot(sourceToken, weapon, targetPoint, shotIndex = 0, vfxSettings = null, selectedEmitter = null) {
  if (isShipArrayWeapon(weapon)) {
    const curvePoint = _arrayCurveMatchForShot(sourceToken, weapon, targetPoint, vfxSettings)?.point;
    if (curvePoint) return curvePoint;
  }

  if (_isWeaponAutoRotateDisabled(sourceToken)) {
    const nearestPoint = _nearestShipWeaponEmitterPoint(sourceToken, weapon, targetPoint, vfxSettings);
    if (nearestPoint) return nearestPoint;
  }

  // Twin banks and paired cannons/launchers trade shots between companion
  // emitters. This has to come before the selectedEmitter branch below, which
  // pins every shot of the volley to the one emitter the ship turned to aim.
  const cluster = getShipWeaponEmitterCluster(sourceToken, weapon, targetPoint, selectedEmitter, vfxSettings);
  if (cluster?.length) return cluster[Math.abs(shotIndex) % cluster.length];

  if (selectedEmitter?.anchor && !isShipArrayWeapon(weapon)) {
    const point = shipWeaponAnchorToCanvasPoint(sourceToken, weapon, selectedEmitter.anchor, vfxSettings, targetPoint);
    if (point) return { ...point, layer: selectedEmitter.layer ?? selectedEmitter.anchor.layer ?? "above" };
  }

  const anchors = weapon ? getShipWeaponEmitterAnchors(sourceToken, weapon) : [];
  if (anchors.length && targetPoint) {
    if (!shotIndex) {
      const selection = getShipWeaponEmitterArcSelection(sourceToken, weapon, targetPoint, vfxSettings);
      if (selection?.point) return { ...selection.point, layer: selection.layer ?? selection.anchor?.layer ?? "above" };
    }
    const points = anchors
      .map(anchor => shipWeaponAnchorToCanvasPoint(sourceToken, weapon, anchor, vfxSettings, targetPoint))
      .filter(Boolean)
      .sort((a, b) => (
        Math.hypot(a.x - targetPoint.x, a.y - targetPoint.y)
        - Math.hypot(b.x - targetPoint.x, b.y - targetPoint.y)
      ));
    if (points.length) return points[Math.abs(shotIndex) % points.length];
  }
  return _tokenEdgePoint(sourceToken, targetPoint, "source");
}

// Emitter point for one strike of an array volley, walked along the spine.
// Returns null when the ship has no array curve so the caller falls back to the
// regular emitter/token-edge pick.
function _arrayWalkPointForShot(sourceToken, weapon, targetPoint, walk, vfxSettings = null) {
  if (!isShipArrayWeapon(weapon) || !targetPoint) return null;
  try {
    return advanceShipArrayCurveWalk(sourceToken, weapon, targetPoint, walk, vfxSettings);
  } catch (err) {
    _warnArrayChargeFailure("curve-walk", err);
    return null;
  }
}

function _arrayCurveMatchForShot(sourceToken, weapon, targetPoint, vfxSettings = null) {
  try {
    return getClosestShipArrayCurveMatch(sourceToken, weapon, targetPoint, undefined, vfxSettings);
  } catch (err) {
    _warnArrayChargeFailure("curve-match", err);
    return null;
  }
}

function _nearestShipWeaponEmitterPoint(sourceToken, weapon, targetPoint, vfxSettings = null) {
  const anchors = weapon ? getShipWeaponEmitterAnchors(sourceToken, weapon) : [];
  if (!anchors.length || !targetPoint) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    const point = shipWeaponAnchorToCanvasPoint(sourceToken, weapon, anchor, vfxSettings, targetPoint);
    if (!point) continue;
    const distance = Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { ...point, layer: anchor.layer ?? point.layer ?? "above" };
    }
  }
  return best;
}

async function _targetPointForShot(sourceToken, targetToken, { isHit, targetSystem = null, shotIndex = 0 } = {}) {
  const sourceCenter = _tokenCenter(sourceToken);
  if (!isHit) return _missPoint(sourceToken, targetToken, shotIndex);

  const systemPoint = targetSystem
    ? getShipHitLocationPointForShot(targetToken, targetSystem, sourceCenter, shotIndex)
    : null;
  if (systemPoint) return systemPoint;

  return await _randomOpaqueTokenPoint(targetToken) ?? _tokenCenter(targetToken);
}

function _missPoint(sourceToken, targetToken, shotIndex = 0) {
  const sourceCenter = _tokenCenter(sourceToken);
  const targetCenter = _tokenCenter(targetToken);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const { width, height } = _tokenDimensions(targetToken);
  const side = shotIndex % 2 === 0 ? 1 : -1;
  const missOffset = Math.max(width, height) * (0.55 + Math.min(2, shotIndex) * 0.12);

  return {
    x: targetCenter.x + (-uy * side * missOffset) + ux * missOffset * 0.25,
    y: targetCenter.y + (ux * side * missOffset) + uy * missOffset * 0.25,
  };
}

async function _randomOpaqueTokenPoint(token) {
  if (!_useAlphaAwareHitPoints()) return null;
  const mask = await getTokenAlphaMask(tokenTextureSource(token));
  if (!mask?.opaque?.length) return null;

  const pixel = mask.opaque[Math.floor(Math.random() * mask.opaque.length)];
  if (!pixel) return null;

  const u = (pixel.x + Math.random()) / mask.width;
  const v = (pixel.y + Math.random()) / mask.height;
  // Reuse the fit-aware transform so the hit pixel (image space) lands on the
  // visible hull, matching where the curve and emitters resolve to.
  return tokenAnchorToCanvasPoint(token, { x: u, y: v });
}

function _useAlphaAwareHitPoints() {
  try { return game.settings.get(MODULE, "alphaAwareWeaponHitPoints") !== false; }
  catch { return true; }
}

function _normalizeRepeatCount(repeatCount) {
  const count = Math.floor(Number(repeatCount) || 1);
  // Damage-scaled energy weapon counts can exceed the old 3-burst ceiling.
  return Math.min(12, Math.max(1, count));
}

function _shieldImpactForShot(shieldImpact, shotIndex = 0, shotCount = 1) {
  if (!shieldImpact?.preShields) return null;
  const count = Math.max(1, Number(shotCount) || 1);
  return {
    ...shieldImpact,
    shieldBroke: !!shieldImpact.shieldBroke && shotIndex >= count - 1,
  };
}

/**
 * Banks and cannons: a burst per target, drawn from the family's own appearance
 * group. Banks draw a held line (or travelling tracers in the tracer era);
 * cannons always fire discrete travelling bolts. Era tint and tracer fire are
 * bank-only phaser features; cannons never inherit them.
 */
async function _fireEnergyBolts(isHit, sourceToken, targets, opts) {
  const isCannon = opts.family === "cannon";
  // Banks keep the signature triple-burst as a floor and scale beyond it with
  // damage. Cannons have their own count config, so a floor would override it.
  const bursts = !isHit ? 1
    : isCannon ? _normalizeRepeatCount(opts.repeatCount)
    : Math.max(3, _normalizeRepeatCount(opts.repeatCount));
  const beam = getBeamVfxSettings();
  const shape = isCannon ? beam.cannon : beam.bank;
  const settings = getShipWeaponVfxSettings(sourceToken, opts.weapon);
  // Era tint and tracer fire belong to phaser banks alone.
  const eraApplies = !isCannon && _eraAppliesToWeapon(opts.weapon);
  const colors = _previewColors(opts.weapon, settings, {
    beam,
    eraColors: eraApplies ? _phaserEraColors(settings, beam) : null,
  });
  // Cannons always fire travelling bolts; TMP-era banks (by default) do too,
  // from the tracer group's dials. Everything else draws a held line.
  const bolt = isCannon ? shape : (eraApplies && _usesTracer(settings?.phaserEra, beam) ? beam.tracer : null);
  // A held beam is drawn complete on the frame it fires — muzzle flare, path
  // and the spark on the target hull all land together, nothing travels — so
  // the target's reaction belongs on that same frame. Only a travelling bolt
  // has real flight time to wait out. (This used to be a flat 300ms, which put
  // the shield hit near the END of a 360ms beam.)
  const impactDelay = bolt ? bolt.travelDuration : 0;
  // Banks pace their tracer bursts off the tracer group; cannons off their own.
  const shotGap = bolt && !isCannon ? beam.tracer.volleyGap : shape.burstGap;
  for (const target of targets) {
    _playSound(opts.soundPath);
    for (let i = 0; i < bursts; i++) {
      const hullPoint = await _targetPointForShot(sourceToken, target, {
        isHit,
        targetSystem: opts.targetSystem,
        shotIndex: i,
      });
      const sourcePoint = _sourcePointForShot(sourceToken, opts.weapon, hullPoint, i, settings, opts.selectedEmitter);
      // Shields that hold turn the burst away; a breach lets it through to the
      // hull. `capT` is how deep into the shield this one gets, rolled once and
      // shared with the bubble so the beam ends exactly where the glow lights.
      const shotImpact = _shieldImpactForShot(opts.shieldImpact, i, bursts);
      const capT = Math.random();
      const stopPoint = isHit ? shieldStopPoint(target, sourcePoint, hullPoint, shotImpact, capT) : null;
      const targetPoint = stopPoint ?? hullPoint;
      await _delay(i === 0 ? 0 : shotGap);
      const shot = {
        hit: isHit,
        duration: isHit ? shape.hitDuration : shape.missDuration,
        color: colors.color,
        coreColor: colors.coreColor,
        layer: sourcePoint.layer,
        beam,
        shape,
        bolt,
      };
      if (bolt) _tracerVolley(sourcePoint, targetPoint, shot);
      else _beamShot(sourcePoint, targetPoint, shot);
      if (isHit) {
        if (opts.hullImpact?.shieldsDown) scheduleHullImpactVFX(target, targetPoint, { ...opts.hullImpact, delayMs: impactDelay });
        else {
          scheduleShieldImpactVFX(sourceToken, target, targetPoint, {
            ...shotImpact,
            // The emitter this burst actually fired from, so the shields flare
            // on the side facing it rather than at the (random) hull pixel.
            sourcePoint,
            hullPoint,
            capT,
            delayMs: impactDelay,
          });
        }
      }
    }
    await _delay(shape.targetGap);
  }
}

/**
 * Arrays and spinal lances: a held strip beam per strike. Lances share the draw
 * but skip the spine — they fire from an emitter, so no charge-up and no walk
 * along the array curve.
 */
async function _fireEnergyBeams(isHit, sourceToken, targets, opts) {
  const isLance = opts.family === "lance";
  const repeats = isHit ? opts.repeatCount : 1;
  const beam = getBeamVfxSettings();
  const shape = isLance ? beam.lance : beam.array;
  const settings = getShipWeaponVfxSettings(sourceToken, opts.weapon);
  // Era tint is a phaser-bank feature; arrays and lances keep their type colour.
  const colors = _previewColors(opts.weapon, settings, { beam });
  const repeatSoundPath = opts.repeatSoundPath || opts.soundPath;
  for (const target of targets) {
    // One walk per target: the opening strike charges up at the point on the
    // spine closest to the target, then each extra strike steps along it.
    const arrayWalk = { t: null };
    for (let i = 0; i < repeats; i++) {
      const hullPoint = await _targetPointForShot(sourceToken, target, {
        isHit,
        targetSystem: opts.targetSystem,
        shotIndex: i,
      });
      // The walk advances first: a repeat charge has to converge on the point
      // this strike actually fires from, and the walk is what picks it.
      const sourcePoint = (isLance ? null : _arrayWalkPointForShot(sourceToken, opts.weapon, hullPoint, arrayWalk, settings))
        ?? _sourcePointForShot(sourceToken, opts.weapon, hullPoint, i, settings, opts.selectedEmitter);
      _playSound(i === 0 ? opts.soundPath : repeatSoundPath);
      // Every strike charges. The opening one sweeps the whole spine; the rest
      // charge locally around where they fire from, so the array reads as
      // reloading between strikes instead of staying lit. Aimed at the hull,
      // since the charge is about where the array points.
      if (!isLance) {
        await playArrayCurveChargeVFX(sourceToken, opts.weapon, hullPoint, {
          vfxSettings: settings,
          isHit,
          shotIndex: i,
          selectedEmitter: opts.selectedEmitter,
          color: colors.color,
          coreColor: colors.coreColor,
          beam,
          repeat: i > 0,
          meetT: Number.isFinite(arrayWalk.t) ? arrayWalk.t : null,
        });
      }
      // Shields that hold stop the strike; a breach gets through. `capT` is the
      // depth, shared with the bubble so beam and glow end together.
      const shotImpact = _shieldImpactForShot(opts.shieldImpact, i, repeats);
      const capT = Math.random();
      const stopPoint = isHit ? shieldStopPoint(target, sourcePoint, hullPoint, shotImpact, capT) : null;
      const targetPoint = stopPoint ?? hullPoint;
      const beamDuration = isHit ? shape.hitDuration : shape.missDuration;
      _arrayBeam(sourcePoint, targetPoint, {
        hit: isHit,
        duration: beamDuration,
        color: colors.color,
        coreColor: colors.coreColor,
        beam,
        shape,
      });
      if (isHit) {
        // `_arrayBeam` draws the rails, core and the impact spark on the target
        // in one frame, so the strike has already landed — the reaction cannot
        // wait for the beam to fade. (This used to be beamDuration - 80, i.e.
        // ~680ms into a 760ms beam.)
        if (opts.hullImpact?.shieldsDown) scheduleHullImpactVFX(target, targetPoint, { ...opts.hullImpact, delayMs: 0 });
        else {
          scheduleShieldImpactVFX(sourceToken, target, targetPoint, {
            ...shotImpact,
            // The point on the array spine this strike fired from — the walk
            // steps along it, so each strike lights a slightly different bearing.
            sourcePoint,
            hullPoint,
            capT,
            delayMs: 0,
          });
        }
      }
      await _delay(beamDuration + shape.shotGap);
    }
  }
}

function _arrayCurveCharge(curveMatch, opts = {}) {
  const layer = _effectLayer();
  if (!layer || !curveMatch?.canvasCurve || !curveMatch?.point) return Promise.resolve(false);

  const color = opts.color ?? PHASER_PRIMARY;
  const coreColor = opts.coreColor ?? PHASER_CORE;
  const curve = curveMatch.canvasCurve;
  const samples = curveMatch.samples?.length ? curveMatch.samples : [curve.start, curve.end].filter(Boolean);
  if (samples.length < 2) return Promise.resolve(false);

  // A repeat strike charges locally around the point it fires from; the opening
  // strike carries no spread and still sweeps in from both ends of the spine.
  const rawMeet = Number(opts.meetT);
  const meetT = Math.max(0.04, Math.min(0.96,
    Number.isFinite(rawMeet) ? rawMeet : (Number(curveMatch.t) || 0.5)));
  const spread = Number(opts.spreadT);
  const local = Number.isFinite(spread) && spread > 0;
  const startA = local ? Math.max(0, meetT - spread) : 0;
  const startB = local ? Math.min(1, meetT + spread) : 1;
  const meetPoint = _sampledCurvePoint(samples, meetT);

  // Scaled so the orbs cross the shorter span at the speed they cross the full
  // spine. A full sweep averages exactly 0.5 per orb, so this is a no-op for the
  // opening strike — and it stays honest when a spread clamps at either end.
  const reach = ((meetT - startA) + (startB - meetT)) / 2;
  const duration = Math.max(140, Math.round((Number(opts.duration) || 420) * (reach / 0.5)));

  try {
    const container = _sceneContainer(Math.max(...samples.map(point => point.y), meetPoint.y));
    _applyBeamGlow(container, color, opts.beam?.shared);
    const trailA = new PIXI.Graphics();
    const trailB = new PIXI.Graphics();
    const orbA = _arrayOrb(color, coreColor, opts);
    const orbB = _arrayOrb(color, coreColor, opts);
    for (const child of [trailA, trailB, orbA, orbB]) child.blendMode = _blendMode(opts.blendMode);
    container.addChild(trailA, trailB, orbA, orbB);
    layer.addChild(container);

    const ticker = canvas.app?.ticker;
    const start = performance.now();
    let finished = false;
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });

    const cleanup = (played, flash) => {
      if (finished) return;
      finished = true;
      try { ticker?.remove?.(tick); } catch { /* no-op */ }
      if (flash) _arrayCurveMeetingFlash(meetPoint, color, coreColor, opts);
      _fadeContainer(container, opts.fadeDuration ?? 180, opts.cleanupDelay ?? 120);
      // Resolves the point the orbs met on, which a `meetT` override moves off
      // curveMatch.point — callers use it as the charge's source point.
      resolveDone?.(played ? meetPoint : false);
    };

    const fail = err => {
      _warnArrayChargeFailure("runtime", err);
      cleanup(false, false);
    };

    const finish = () => cleanup(true, true);

    const tick = () => {
      try {
        const raw = Math.min(1, (performance.now() - start) / duration);
        const progress = _easeProgress(raw, opts.easing);
        const tA = startA + ((meetT - startA) * progress);
        const tB = startB + ((meetT - startB) * progress);
        const pointA = _sampledCurvePoint(samples, tA);
        const pointB = _sampledCurvePoint(samples, tB);
        orbA.x = pointA.x;
        orbA.y = pointA.y;
        orbB.x = pointB.x;
        orbB.y = pointB.y;
        const tail = Math.max(0.01, Math.min(1, Number(opts.trailLength) || 0.18));
        // Clamped to each orb's own start so a short local charge doesn't trail
        // back past where it began. The spine ends for the opening sweep.
        _redrawSampledCurveTrail(trailA, samples, Math.max(startA, tA - tail), tA, color, coreColor, opts);
        _redrawSampledCurveTrail(trailB, samples, Math.min(startB, tB + tail), tB, color, coreColor, opts);
        container.alpha = raw < 0.9 ? 1 : Math.max(0.18, 1 - ((raw - 0.9) / 0.1));
        if (raw >= 1) finish();
      } catch (err) {
        fail(err);
      }
    };

    tick();
    if (!finished) {
      if (ticker?.add) ticker.add(tick);
      else setTimeout(finish, duration);
      setTimeout(finish, duration + (Number(opts.cleanupDelay) || 120));
    }
    return done;
  } catch (err) {
    _warnArrayChargeFailure("runtime", err);
    return Promise.resolve(false);
  }
}

function _arrayChargeSourcePulse(sourcePoint, targetPoint, opts = {}) {
  const layer = _effectLayer();
  if (!layer || !sourcePoint) return Promise.resolve(false);

  try {
    const duration = Math.max(120, Math.min(520, Number(opts.duration) || 260));
    const color = opts.color ?? PHASER_PRIMARY;
    const coreColor = opts.coreColor ?? PHASER_CORE;
    const container = _sceneContainer(sourcePoint.y, sourcePoint.layer);
    _applyBeamGlow(container, color, opts.beam?.shared);
    const glow = new PIXI.Graphics();
    const core = new PIXI.Graphics();
    const ring = new PIXI.Graphics();
    for (const child of [glow, core, ring]) child.blendMode = _blendMode(opts.blendMode);

    const dx = targetPoint ? targetPoint.x - sourcePoint.x : 1;
    const dy = targetPoint ? targetPoint.y - sourcePoint.y : 0;
    const len = Math.max(1, Math.hypot(dx, dy));
    const lead = { x: sourcePoint.x + (dx / len) * 18, y: sourcePoint.y + (dy / len) * 18 };

    _fillCircle(glow, sourcePoint.x, sourcePoint.y, opts.flashRingRadius ?? 22, color, 0.18);
    _fillCircle(core, sourcePoint.x, sourcePoint.y, opts.flashFillRadius ?? 10, coreColor, 0.72);
    _strokeCircle(ring, sourcePoint.x, sourcePoint.y, opts.flashRingRadius ?? 22, opts.flashRingWidth ?? 2, color, 0.62);
    _drawLine(glow, sourcePoint, lead, opts.trailGlowWidth ?? 16, color, 0.18);
    _drawLine(core, sourcePoint, lead, opts.trailCoreWidth ?? 4, coreColor, 0.74);

    container.addChild(glow, ring, core);
    layer.addChild(container);
    _fadeContainer(container, duration, opts.cleanupDelay ?? 120);
    return _delay(duration).then(() => true);
  } catch (err) {
    _warnArrayChargeFailure("fallback", err);
    return Promise.resolve(false);
  }
}

function _arrayOrb(color, coreColor, opts = {}) {
  const orb = new PIXI.Container();
  const glow = new PIXI.Graphics();
  const core = new PIXI.Graphics();
  glow.blendMode = _blendMode(opts.blendMode);
  core.blendMode = _blendMode(opts.blendMode);
  _fillCircle(glow, 0, 0, opts.orbGlowRadius ?? 15, color, opts.orbGlowAlpha ?? 0.28);
  _fillCircle(glow, 0, 0, opts.orbInnerRadius ?? 9, color, opts.orbInnerAlpha ?? 0.5);
  _fillCircle(core, 0, 0, opts.coreRadius ?? 4, coreColor, opts.coreAlpha ?? 0.96);
  _strokeCircle(core, 0, 0, opts.ringRadius ?? 8, opts.ringWidth ?? 2, color, opts.ringAlpha ?? 0.78);
  orb.addChild(glow, core);
  return orb;
}

function _arrayCurveMeetingFlash(point, color, coreColor, opts = {}) {
  const layer = _effectLayer();
  if (!layer || !point) return;
  const container = _sceneContainer(point.y);
  _applyBeamGlow(container, color, opts.beam?.shared);
  const flash = new PIXI.Graphics();
  flash.blendMode = _blendMode(opts.blendMode);
  _fillCircle(flash, point.x, point.y, opts.flashFillRadius ?? 12, coreColor, opts.flashFillAlpha ?? 0.72);
  _strokeCircle(flash, point.x, point.y, opts.flashRingRadius ?? 22, opts.flashRingWidth ?? 2, color, opts.flashRingAlpha ?? 0.62);
  container.addChild(flash);
  layer.addChild(container);
  _fadeContainer(container, opts.flashFadeDuration ?? 220, opts.cleanupDelay ?? 120);
}

function _beamShot(sourcePoint, targetPoint, opts = {}) {
  const layer = _effectLayer();
  if (!layer) return;

  const cfg = opts.beam ?? getBeamVfxSettings();
  // `shape` lets cannons reuse the bank draw on their own dials.
  const bank = opts.shape ?? cfg.bank;
  const shared = cfg.shared;
  const blend = _blendMode(shared.blendMode);
  const duration = opts.duration ?? bank.hitDuration;

  const container = _sceneContainer(Math.max(sourcePoint.y, targetPoint.y), opts.layer);
  _applyBeamGlow(container, opts.color, shared);
  layer.addChild(container);

  const glow = new PIXI.Graphics();
  const beam = new PIXI.Graphics();
  const flare = new PIXI.Graphics();
  const spark = new PIXI.Graphics();
  for (const child of [glow, beam, flare, spark]) child.blendMode = blend;

  _drawLine(glow, sourcePoint, targetPoint, bank.glowWidth, opts.color, bank.glowAlpha);
  _drawLine(beam, sourcePoint, targetPoint, bank.coreWidth, opts.coreColor, bank.coreAlpha);
  _fillCircle(flare, sourcePoint.x, sourcePoint.y, bank.muzzleFillRadius, opts.coreColor, bank.muzzleFillAlpha);
  _strokeCircle(flare, sourcePoint.x, sourcePoint.y, bank.muzzleRingRadius, bank.muzzleRingWidth, opts.color, bank.muzzleRingAlpha);
  container.addChild(glow, beam, flare);
  if (opts.hit) {
    _fillCircle(spark, targetPoint.x, targetPoint.y, bank.impactFillRadius, opts.coreColor, bank.impactFillAlpha);
    _strokeCircle(spark, targetPoint.x, targetPoint.y, bank.impactRingRadius, bank.impactRingWidth, opts.color, bank.impactRingAlpha);
    if (opts.layer === "below") {
      const impactContainer = _sceneContainer(targetPoint.y);
      _applyBeamGlow(impactContainer, opts.color, shared);
      impactContainer.addChild(spark);
      layer.addChild(impactContainer);
      _fadeContainer(impactContainer, duration, shared.cleanupDelay, shared);
    } else {
      container.addChild(spark);
    }
  }

  _fadeContainer(container, duration, shared.cleanupDelay, shared);
}

/**
 * A stream of short bolts travelling source → target, launched `boltSpacing`
 * apart so several are in flight at once. Used by TMP-era phaser banks (bolt
 * config from the `tracer` group) and by every energy cannon, which fires
 * discrete travelling bolts rather than a held line (bolt config from the
 * `cannon` group).
 *
 * `opts.bolt` supplies the flight and stroke dials, `opts.shape` the muzzle
 * flare and impact spark. Everything is redrawn from scratch each frame into
 * one Graphics, so bolts, flares and sparks all fade on their own clocks
 * without accumulating draw calls. Follows the ticker/cleanup shape of
 * `_arrayCurveCharge`: a `finished` guard, `ticker.remove` in cleanup, and a
 * setTimeout backstop in case the ticker is unavailable.
 */
function _tracerVolley(sourcePoint, targetPoint, opts = {}) {
  const layer = _effectLayer();
  if (!layer) return;

  const cfg = opts.beam ?? getBeamVfxSettings();
  const tracer = opts.bolt ?? cfg.tracer;
  const bank = opts.shape ?? cfg.bank;
  const shared = cfg.shared;
  const blend = _blendMode(shared.blendMode);

  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const pathLength = Math.max(1, Math.hypot(dx, dy));
  // Work in normalised path space; cap the bolt so a point-blank shot still
  // reads as a bolt rather than a full-length beam.
  const boltT = Math.min(0.6, tracer.boltLength / pathLength);
  const bolts = Math.max(1, Math.round(tracer.boltCount));
  const travel = tracer.travelDuration;
  const flashMs = Math.max(80, travel * 0.35);
  const lifetime = ((bolts - 1) * tracer.boltSpacing) + travel + flashMs;

  const container = _sceneContainer(Math.max(sourcePoint.y, targetPoint.y), opts.layer);
  _applyBeamGlow(container, opts.color, shared);
  layer.addChild(container);
  const stream = new PIXI.Graphics();
  stream.blendMode = blend;
  container.addChild(stream);

  // Mirrors _beamShot: when the emitter draws below the token, impacts still
  // need to land above it, so they get their own container.
  const sparkG = new PIXI.Graphics();
  sparkG.blendMode = blend;
  let sparkContainer = container;
  if (opts.layer === "below") {
    sparkContainer = _sceneContainer(targetPoint.y);
    _applyBeamGlow(sparkContainer, opts.color, shared);
    layer.addChild(sparkContainer);
  }
  sparkContainer.addChild(sparkG);

  const pointAt = t => ({ x: sourcePoint.x + (dx * t), y: sourcePoint.y + (dy * t) });
  const ticker = canvas.app?.ticker;
  const start = performance.now();
  let finished = false;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    try { ticker?.remove?.(tick); } catch { /* no-op */ }
    const fadeMs = Math.max(120, flashMs);
    _fadeContainer(container, fadeMs, shared.cleanupDelay, shared);
    if (sparkContainer !== container) _fadeContainer(sparkContainer, fadeMs, shared.cleanupDelay, shared);
  };

  const tick = () => {
    try {
      const elapsed = performance.now() - start;
      stream.clear?.();
      sparkG.clear?.();
      for (let i = 0; i < bolts; i++) {
        const since = elapsed - (i * tracer.boltSpacing);
        if (since < 0) continue;
        const t = since / travel;

        // The bolt itself, dimming as it crosses.
        if (t <= 1) {
          const head = pointAt(t);
          const tail = pointAt(Math.max(0, t - boltT));
          const fade = 1 - (tracer.tailFade * t);
          _drawLine(stream, tail, head, tracer.glowWidth, opts.color, tracer.glowAlpha * fade);
          _drawLine(stream, tail, head, tracer.coreWidth, opts.coreColor, tracer.coreAlpha * fade);
        }

        // Muzzle flare, fading over its own short clock after launch.
        const flare = 1 - (since / flashMs);
        if (flare > 0) {
          _fillCircle(stream, sourcePoint.x, sourcePoint.y, bank.muzzleFillRadius, opts.coreColor, bank.muzzleFillAlpha * flare);
          _strokeCircle(stream, sourcePoint.x, sourcePoint.y, bank.muzzleRingRadius, bank.muzzleRingWidth, opts.color, bank.muzzleRingAlpha * flare);
        }

        // Impact spark, on the same clock but starting when the bolt lands.
        if (opts.hit) {
          const spark = 1 - ((since - travel) / flashMs);
          if (since >= travel && spark > 0) {
            _fillCircle(sparkG, targetPoint.x, targetPoint.y, bank.impactFillRadius, opts.coreColor, bank.impactFillAlpha * spark);
            _strokeCircle(sparkG, targetPoint.x, targetPoint.y, bank.impactRingRadius, bank.impactRingWidth, opts.color, bank.impactRingAlpha * spark);
          }
        }
      }
      if (elapsed >= lifetime) cleanup();
    } catch (err) {
      console.warn("STA2e Toolkit | Tracer volley VFX failed:", err);
      cleanup();
    }
  };

  tick();
  if (!finished) {
    if (ticker?.add) ticker.add(tick);
    setTimeout(cleanup, lifetime + 50);
  }
}

function _arrayBeam(sourcePoint, targetPoint, opts = {}) {
  const layer = _effectLayer();
  if (!layer) return;

  const cfg = opts.beam ?? getBeamVfxSettings();
  // `shape` lets spinal lances reuse the array draw on their own dials.
  const array = opts.shape ?? cfg.array;
  const shared = cfg.shared;
  const blend = _blendMode(shared.blendMode);
  const duration = opts.duration ?? array.hitDuration;
  // Blank sweep colour means "follow the beam's own core colour".
  const sweepColor = _parseHexColor(array.sweepColor, opts.coreColor);

  const container = _sceneContainer(Math.max(sourcePoint.y, targetPoint.y));
  _applyBeamGlow(container, opts.color, shared);
  layer.addChild(container);

  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const rail = array.railOffset;

  const glow = new PIXI.Graphics();
  const beam = new PIXI.Graphics();
  const sweep = new PIXI.Graphics();
  for (const child of [glow, beam, sweep]) child.blendMode = blend;

  _drawLine(glow, sourcePoint, targetPoint, array.haloWidth, opts.color, array.haloAlpha);
  _drawLine(glow, _offsetPoint(sourcePoint, nx, ny, rail), _offsetPoint(targetPoint, nx, ny, rail), array.railWidth, opts.color, array.railAlpha);
  _drawLine(glow, _offsetPoint(sourcePoint, nx, ny, -rail), _offsetPoint(targetPoint, nx, ny, -rail), array.railWidth, opts.color, array.railAlpha);
  _drawLine(beam, sourcePoint, targetPoint, array.coreWidth, opts.coreColor, array.coreAlpha);
  _drawLine(sweep, sourcePoint, targetPoint, array.sweepWidth, sweepColor, array.sweepAlpha);

  if (opts.hit) {
    const spark = new PIXI.Graphics();
    spark.blendMode = blend;
    _fillCircle(spark, targetPoint.x, targetPoint.y, array.impactFillRadius, opts.coreColor, array.impactFillAlpha);
    _strokeCircle(spark, targetPoint.x, targetPoint.y, array.impactRingRadius, array.impactRingWidth, opts.color, array.impactRingAlpha);
    container.addChild(spark);
  }

  container.addChild(glow, beam, sweep);
  _fadeContainer(container, duration, shared.cleanupDelay, shared);
}

function _sampledCurvePoint(samples, t) {
  return sampleShipArrayCurvePointAtT(samples, t) ?? { x: 0, y: 0 };
}

function _redrawSampledCurveTrail(g, samples, tFrom, tTo, color, coreColor, opts = {}) {
  if (!g || !Array.isArray(samples) || samples.length < 2) return;
  try { g.clear?.(); } catch { /* no-op */ }
  // Geometric resolution is decoupled from the cosmetic `trailSteps` setting.
  // A 1-2px stroke exposes the chord-cutting that a fat stroke hides, so the
  // polyline must sample the curve densely regardless of the user's value.
  const span = Math.abs(tTo - tFrom);
  const steps = Math.max(
    Math.round(Number(opts.trailSteps) || 9),
    Math.ceil(span * (samples.length - 1) * 2),
    12,
  );
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const pct = i / steps;
    points.push(_sampledCurvePoint(samples, tFrom + ((tTo - tFrom) * pct)));
  }
  _drawTrailBand(g, points, opts.trailGlowWidth ?? 16, color,
    opts.trailGlowAlphaStart ?? 0.08, opts.trailGlowAlphaEnd ?? 0.32);
  _drawTrailBand(g, points, opts.trailCoreWidth ?? 4, coreColor,
    opts.trailCoreAlphaStart ?? 0.22, opts.trailCoreAlphaEnd ?? 0.72);
}

// Draws a polyline as a few continuous alpha bands. Each band is a single
// stroke with round joins, so a thin line reads as one smooth curve instead of
// a string of disconnected round-capped segments.
function _drawTrailBand(g, points, width, color, alphaStart, alphaEnd) {
  if (!Array.isArray(points) || points.length < 2 || !(width > 0)) return;
  const bands = Math.min(6, points.length - 1);
  const per = (points.length - 1) / bands;
  for (let b = 0; b < bands; b++) {
    const from = Math.round(b * per);
    const to = Math.round((b + 1) * per);
    const alpha = alphaStart + ((alphaEnd - alphaStart) * (b + 1) / bands);
    _drawPolyline(g, points.slice(from, to + 1), width, color, alpha);
  }
}

function _drawPolyline(g, pts, width, color, alpha) {
  if (!Array.isArray(pts) || pts.length < 2) return;
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    return;
  }
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.stroke({ width, color, alpha, cap: "round", join: "round" });
}

function _bezierPoint(curve, t) {
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  const u = 1 - clamped;
  const uu = u * u;
  const tt = clamped * clamped;
  const uuu = uu * u;
  const ttt = tt * clamped;
  return {
    x: (uuu * curve.start.x)
      + (3 * uu * clamped * curve.control1.x)
      + (3 * u * tt * curve.control2.x)
      + (ttt * curve.end.x),
    y: (uuu * curve.start.y)
      + (3 * uu * clamped * curve.control1.y)
      + (3 * u * tt * curve.control2.y)
      + (ttt * curve.end.y),
  };
}

function _redrawCurveTrail(g, curve, tFrom, tTo, color, coreColor) {
  if (!g || !curve) return;
  try { g.clear?.(); } catch { /* no-op */ }
  const steps = 9;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const pct = i / steps;
    points.push(_bezierPoint(curve, tFrom + ((tTo - tFrom) * pct)));
  }
  for (let i = 0; i < points.length - 1; i++) {
    const alpha = 0.08 + (0.24 * (i + 1) / points.length);
    _drawLine(g, points[i], points[i + 1], 16, color, alpha);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const alpha = 0.22 + (0.5 * (i + 1) / points.length);
    _drawLine(g, points[i], points[i + 1], 4, coreColor, alpha);
  }
}

function _sceneContainer(y = 0, sourceLayer = "above") {
  const container = new PIXI.Container();
  container.zIndex = sourceLayer === "below"
    ? -VFX_Z_BASE + Math.round(y)
    : VFX_Z_BASE + Math.round(y);
  container.alpha = 1;
  return container;
}

/**
 * Halo an effect container with a single GlowFilter pass — one pass for the
 * whole container beats one per child, the same trade shield-bubble-vfx makes.
 *
 * `shared` is handed in rather than read here so the Beam VFX settings tab can
 * preview unsaved slider positions; callers without a config in hand pass null
 * and fall through to the saved world setting.
 */
function _applyBeamGlow(container, color, shared = null) {
  const cfg = shared ?? getBeamVfxSettings().shared;
  if (!(Number(cfg?.glowSize) > 0)) return;
  try {
    const GlowFilter = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (!GlowFilter) return;
    const filter = new GlowFilter({
      distance: cfg.glowSize,
      outerStrength: cfg.glowStrength,
      innerStrength: cfg.glowInnerStrength,
      color: Number.isFinite(color) ? color : PHASER_PRIMARY,
      quality: cfg.glowQuality,
      knockout: false,
    });
    // A filtered container renders to an offscreen target first, so the
    // children's additive blend stops reaching the scene. Compositing the
    // filter's own output on that blend mode keeps the beams as hot as before.
    try { filter.blendMode = _blendMode(cfg.blendMode); } catch { /* older pixi-filters */ }
    container.filters = [filter];
  } catch { /* glow is a bonus, never a requirement */ }
}

function _offsetPoint(point, nx, ny, amount) {
  return { x: point.x + nx * amount, y: point.y + ny * amount };
}

function _drawLine(g, from, to, width, color, alpha) {
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    return;
  }
  g.moveTo(from.x, from.y);
  g.lineTo(to.x, to.y);
  g.stroke({ width, color, alpha, cap: "round" });
}

function _fillCircle(g, x, y, radius, color, alpha) {
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
    g.drawCircle(x, y, radius);
    g.endFill();
    return;
  }
  g.circle(x, y, radius).fill({ color, alpha });
}

function _strokeCircle(g, x, y, radius, width, color, alpha) {
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.drawCircle(x, y, radius);
    return;
  }
  g.circle(x, y, radius).stroke({ width, color, alpha });
}

// `fade` lets the beams drive the hold/fade split and easing from the world
// Beam VFX settings. Charge-up callers omit it and keep the original curve.
function _fadeContainer(container, duration = 420, cleanupDelay = 120, fade = null) {
  container.alpha = 1;
  const hold = _clampHoldPercent(fade?.holdPercent, 0.55);
  const ease = BEAM_VFX_EASING_OPTIONS.includes(fade?.easing) ? fade.easing : "inQuad";
  _tween(container, { alpha: 0, duration: Math.max(120, duration * (1 - hold)), ease }, Math.max(90, duration * hold));
  setTimeout(() => {
    // destroy() does not take the filters with it, and a GlowFilter holds a
    // shader program.
    try { for (const f of container.filters ?? []) f?.destroy?.(); } catch { /* older pixi-filters */ }
    try { container.filters = null; } catch { /* already gone */ }
    try { container.destroy({ children: true }); } catch { /* no-op */ }
  }, duration + Math.max(0, Number(cleanupDelay) || 0));
}

function _tween(target, params, delayMs = 0) {
  const aj = globalThis.animejs;
  if (aj?.animate) {
    aj.animate(target, delayMs > 0 ? { ...params, delay: delayMs } : params);
    return;
  }
  setTimeout(() => {
    for (const [key, value] of Object.entries(params)) {
      if (key === "duration" || key === "ease" || key === "delay" || key === "onComplete") continue;
      target[key] = Array.isArray(value) ? value[value.length - 1] : value;
    }
    params.onComplete?.();
  }, delayMs + (Number(params.duration) || 0));
}

function _warnArrayChargeFailure(reason, err) {
  const key = String(reason || "runtime");
  if (ARRAY_CHARGE_WARNED.has(key)) return;
  ARRAY_CHARGE_WARNED.add(key);
  console.warn(`STA2e Toolkit | Array charge VFX failed; using source pulse fallback (${key}):`, err);
}

function _playSound(soundPath, volume = 1) {
  if (!soundPath) return;
  try {
    const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    if (helper?.play) {
      helper.play({ src: soundPath, volume, autoplay: true, loop: false }, true);
    }
  } catch (err) {
    console.warn("STA2e Toolkit | Native weapon VFX sound failed:", err);
  }
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
