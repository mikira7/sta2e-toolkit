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
} from "./shield-impact-vfx.js";

const MODULE = "sta2e-toolkit";
const VFX_Z_BASE = 920_000;
const PHASER_PRIMARY = 0xff9a33;
const PHASER_CORE = 0xfff2c0;
const DISABLE_WEAPON_AUTO_ROTATE_FLAG = "disableWeaponAutoRotate";
const ARRAY_CHARGE_WARNED = new Set();

export const NATIVE_WEAPON_VFX_DEFAULT_MODES = Object.freeze({
  "weapon-phaser-bank": "current",
  "weapon-phaser-array": "current",
});

export const NATIVE_WEAPON_VFX_MODE_ROWS = Object.freeze([
  { key: "weapon-phaser-bank", label: "Phaser Banks", hint: "Experimental: three TNG/VOY-style amber beam bursts." },
  { key: "weapon-phaser-array", label: "Phaser Arrays", hint: "Experimental: clean continuous TNG/VOY-style array beam." },
]);

const SUPPORTED_NATIVE_WEAPONS = new Set(Object.keys(NATIVE_WEAPON_VFX_DEFAULT_MODES));

// ── Beam appearance ─────────────────────────────────────────────────────────
// Every value below is the literal the beam draw functions used before this was
// configurable, so an unset world keeps the stock look.

export const BEAM_VFX_EASING_OPTIONS = Object.freeze(["linear", "inQuad", "outQuad", "inOutQuad"]);
export const BEAM_VFX_BLEND_OPTIONS = Object.freeze(["add", "normal"]);
// Which phaser era fires travelling bolts instead of a held beam. "off" disables.
export const BEAM_VFX_TRACER_ERA_OPTIONS = Object.freeze(["off", "ent", "tos", "tmp", "tng"]);

export const DEFAULT_BEAM_VFX_SETTINGS = Object.freeze({
  bank: Object.freeze({
    glowWidth: 14,
    glowAlpha: 0.26,
    coreWidth: 3,
    coreAlpha: 0.94,
    muzzleFillRadius: 7,
    muzzleFillAlpha: 0.88,
    muzzleRingRadius: 12,
    muzzleRingWidth: 2,
    muzzleRingAlpha: 0.55,
    impactFillRadius: 9,
    impactFillAlpha: 0.9,
    impactRingRadius: 20,
    impactRingWidth: 2,
    impactRingAlpha: 0.7,
    hitDuration: 360,
    missDuration: 360,
    burstGap: 95,
    targetGap: 520,
  }),
  array: Object.freeze({
    haloWidth: 18,
    haloAlpha: 0.22,
    railWidth: 8,
    railAlpha: 0.18,
    railOffset: 4,
    coreWidth: 4,
    coreAlpha: 0.96,
    sweepWidth: 2,
    sweepAlpha: 0.72,
    sweepColor: "#ffffff",
    impactFillRadius: 10,
    impactFillAlpha: 0.85,
    impactRingRadius: 24,
    impactRingWidth: 2,
    impactRingAlpha: 0.62,
    hitDuration: 760,
    missDuration: 420,
    shotGap: 160,
  }),
  shared: Object.freeze({
    holdPercent: 0.55,
    easing: "inQuad",
    blendMode: "add",
    cleanupDelay: 120,
    emitterPairDistance: 0.12,
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

// path → [min, max] clamp for every numeric beam field. Anything not listed is
// a string/enum and is validated separately.
const BEAM_VFX_RANGES = Object.freeze({
  "bank.glowWidth": [0, 60], "bank.glowAlpha": [0, 1],
  "bank.coreWidth": [0, 60], "bank.coreAlpha": [0, 1],
  "bank.muzzleFillRadius": [0, 60], "bank.muzzleFillAlpha": [0, 1],
  "bank.muzzleRingRadius": [0, 60], "bank.muzzleRingWidth": [0, 60], "bank.muzzleRingAlpha": [0, 1],
  "bank.impactFillRadius": [0, 60], "bank.impactFillAlpha": [0, 1],
  "bank.impactRingRadius": [0, 60], "bank.impactRingWidth": [0, 60], "bank.impactRingAlpha": [0, 1],
  "bank.hitDuration": [60, 4000], "bank.missDuration": [60, 4000],
  "bank.burstGap": [0, 2000], "bank.targetGap": [0, 2000],

  "array.haloWidth": [0, 60], "array.haloAlpha": [0, 1],
  "array.railWidth": [0, 60], "array.railAlpha": [0, 1], "array.railOffset": [0, 40],
  "array.coreWidth": [0, 60], "array.coreAlpha": [0, 1],
  "array.sweepWidth": [0, 60], "array.sweepAlpha": [0, 1],
  "array.impactFillRadius": [0, 60], "array.impactFillAlpha": [0, 1],
  "array.impactRingRadius": [0, 60], "array.impactRingWidth": [0, 60], "array.impactRingAlpha": [0, 1],
  "array.hitDuration": [60, 4000], "array.missDuration": [60, 4000],
  "array.shotGap": [0, 2000],

  "shared.holdPercent": [0.05, 0.95],
  "shared.cleanupDelay": [0, 2000],
  "shared.emitterPairDistance": [0, 0.5],

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

export async function fireNativeWeaponVFX(config, isHit, sourceToken, targets, options = {}) {
  const weaponKey = config?.nativeVfxKey;
  if (!shouldUseNativeWeaponVFX(weaponKey)) return false;
  const targetList = _normalizeTargets(targets);
  if (!_nativeAvailable(sourceToken, targetList)) return false;

  try {
    const opts = {
      ...options,
      repeatCount: _normalizeRepeatCount(options.repeatCount),
      soundPath: isHit ? config.sound : (config.missSound ?? config.sound),
      // Optional audio for the 2nd and later strikes of an array volley,
      // resolved by fireWeapon. Blank falls back to soundPath.
      repeatSoundPath: options.repeatSoundPath ?? null,
    };

    if (weaponKey === "weapon-phaser-bank") {
      await _firePhaserBank(isHit, sourceToken, targetList, opts);
      return true;
    }

    if (weaponKey === "weapon-phaser-array") {
      await _firePhaserArray(isHit, sourceToken, targetList, opts);
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
    const played = await _arrayCurveCharge(curveMatch, charge);
    if (played) return curveMatch.point ?? null;
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
  const isArray = isShipArrayWeapon(weapon);
  // Era tint is a bank-only feature; arrays keep their normal colour.
  const colors = _previewColors(weapon, settings, {
    ...options,
    eraColors: isArray ? null : _phaserEraColors(settings, beam),
  });
  if (isArray) {
    await playArrayCurveChargeVFX(sourceToken, weapon, targetPoint, {
      ...options,
      vfxSettings: settings,
      isHit: true,
      color: colors.color,
      coreColor: colors.coreColor,
    });
    const sourcePoint = _sourcePointForShot(sourceToken, weapon, targetPoint, 0, settings, options.selectedEmitter);
    _arrayBeam(sourcePoint, targetPoint, {
      hit: true,
      // Deliberately ignores options.beamDuration (a Sequencer-path timing) so
      // the preview shows exactly what live fire will look like.
      duration: beam.array.hitDuration,
      color: colors.color,
      coreColor: colors.coreColor,
      beam,
    });
    return true;
  }

  const sourcePoint = _sourcePointForShot(sourceToken, weapon, targetPoint, 0, settings, options.selectedEmitter);
  const shot = {
    hit: true,
    duration: beam.bank.hitDuration,
    color: colors.color,
    coreColor: colors.coreColor,
    layer: sourcePoint.layer,
    beam,
  };
  if (_usesTracer(settings?.phaserEra, beam)) _tracerVolley(sourcePoint, targetPoint, shot);
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
  const isArray = options.weaponKey === "weapon-phaser-array";
  // Era only affects banks, matching live fire.
  const era = isArray ? null : _phaserEraColors(null, beam, options.era);
  const shot = {
    hit: options.hit !== false,
    color: _parseHexColor(era?.color, PHASER_PRIMARY),
    coreColor: _parseHexColor(era?.core, PHASER_CORE),
    beam,
  };
  if (isArray) {
    _arrayBeam(sourcePoint, targetPoint, { ...shot, duration: beam.array.hitDuration });
  } else if (_usesTracer(options.era, beam)) {
    _tracerVolley(sourcePoint, targetPoint, { ...shot, duration: beam.bank.hitDuration });
  } else {
    _beamShot(sourcePoint, targetPoint, { ...shot, duration: beam.bank.hitDuration });
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

function _phaserEraColors(settings, beam, eraOverride = null) {
  const era = String(eraOverride ?? settings?.phaserEra ?? "").toLowerCase();
  if (!era) return null;
  const colors = beam?.eraColors ?? {};
  return { color: colors[`${era}Color`] || "", core: colors[`${era}Core`] || "" };
}

// Precedence: ship charge.colorOverride > era colour > weapon-name guess > amber.
// _parseHexColor falls through on anything that isn't #rrggbb, so blank values
// at any level simply defer to the next one down.
function _previewColors(weapon, settings, options = {}) {
  const name = `${weapon?.name ?? ""} ${weapon?.img ?? ""}`.toLowerCase();
  const fallback = name.includes("disruptor") ? 0x66ff99
    : name.includes("polaron") ? 0xaa66ff
    : name.includes("quantum") ? 0x66ccff
    : PHASER_PRIMARY;
  return {
    color: _parseHexColor(settings?.charge?.colorOverride,
      _parseHexColor(options.eraColors?.color, options.color ?? fallback)),
    coreColor: _parseHexColor(settings?.charge?.coreColorOverride,
      _parseHexColor(options.eraColors?.core, options.coreColor ?? PHASER_CORE)),
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

async function _firePhaserBank(isHit, sourceToken, targets, opts) {
  // Keep the signature triple-burst as a floor, scale beyond it with damage.
  const bursts = isHit ? Math.max(3, _normalizeRepeatCount(opts.repeatCount)) : 1;
  const beam = getBeamVfxSettings();
  const settings = getShipWeaponVfxSettings(sourceToken, opts.weapon);
  const colors = _previewColors(opts.weapon, settings, {
    color: PHASER_PRIMARY,
    coreColor: PHASER_CORE,
    eraColors: _phaserEraColors(settings, beam),
  });
  // TMP-era banks (by default) fire a stream of travelling bolts rather than a
  // held beam, so the burst and impact timings change with them.
  const useTracer = _usesTracer(settings?.phaserEra, beam);
  const impactDelay = useTracer ? beam.tracer.travelDuration : 300;
  for (const target of targets) {
    _playSound(opts.soundPath);
    for (let i = 0; i < bursts; i++) {
      const targetPoint = await _targetPointForShot(sourceToken, target, {
        isHit,
        targetSystem: opts.targetSystem,
        shotIndex: i,
      });
      const sourcePoint = _sourcePointForShot(sourceToken, opts.weapon, targetPoint, i, settings, opts.selectedEmitter);
      await _delay(i === 0 ? 0 : (useTracer ? beam.tracer.volleyGap : beam.bank.burstGap));
      const shot = {
        hit: isHit,
        duration: isHit ? beam.bank.hitDuration : beam.bank.missDuration,
        color: colors.color,
        coreColor: colors.coreColor,
        layer: sourcePoint.layer,
        beam,
      };
      if (useTracer) _tracerVolley(sourcePoint, targetPoint, shot);
      else _beamShot(sourcePoint, targetPoint, shot);
      if (isHit) {
        if (opts.hullImpact?.shieldsDown) scheduleHullImpactVFX(target, targetPoint, { ...opts.hullImpact, delayMs: impactDelay });
        else {
          scheduleShieldImpactVFX(sourceToken, target, targetPoint, {
            ..._shieldImpactForShot(opts.shieldImpact, i, bursts),
            delayMs: impactDelay,
          });
        }
      }
    }
    await _delay(beam.bank.targetGap);
  }
}

async function _firePhaserArray(isHit, sourceToken, targets, opts) {
  const repeats = isHit ? opts.repeatCount : 1;
  const beam = getBeamVfxSettings();
  const settings = getShipWeaponVfxSettings(sourceToken, opts.weapon);
  const colors = _previewColors(opts.weapon, settings, {
    color: PHASER_PRIMARY,
    coreColor: PHASER_CORE,
  });
  const repeatSoundPath = opts.repeatSoundPath || opts.soundPath;
  for (const target of targets) {
    // One walk per target: the opening strike charges up at the point on the
    // spine closest to the target, then each extra strike steps along it.
    const arrayWalk = { t: null };
    for (let i = 0; i < repeats; i++) {
      const targetPoint = await _targetPointForShot(sourceToken, target, {
        isHit,
        targetSystem: opts.targetSystem,
        shotIndex: i,
      });
      _playSound(i === 0 ? opts.soundPath : repeatSoundPath);
      // Only the opening strike charges: the array stays lit for the rest.
      if (i === 0) {
        await playArrayCurveChargeVFX(sourceToken, opts.weapon, targetPoint, {
          vfxSettings: settings,
          isHit,
          shotIndex: i,
          selectedEmitter: opts.selectedEmitter,
          color: colors.color,
          coreColor: colors.coreColor,
        });
      }
      const sourcePoint = _arrayWalkPointForShot(sourceToken, opts.weapon, targetPoint, arrayWalk, settings)
        ?? _sourcePointForShot(sourceToken, opts.weapon, targetPoint, i, settings, opts.selectedEmitter);
      const beamDuration = isHit ? beam.array.hitDuration : beam.array.missDuration;
      _arrayBeam(sourcePoint, targetPoint, {
        hit: isHit,
        duration: beamDuration,
        color: colors.color,
        coreColor: colors.coreColor,
        beam,
      });
      if (isHit) {
        if (opts.hullImpact?.shieldsDown) scheduleHullImpactVFX(target, targetPoint, { ...opts.hullImpact, delayMs: Math.max(180, beamDuration - 80) });
        else {
          scheduleShieldImpactVFX(sourceToken, target, targetPoint, {
            ..._shieldImpactForShot(opts.shieldImpact, i, repeats),
            delayMs: Math.max(180, beamDuration - 80),
          });
        }
      }
      await _delay(beamDuration + beam.array.shotGap);
    }
  }
}

function _arrayCurveCharge(curveMatch, opts = {}) {
  const layer = _effectLayer();
  if (!layer || !curveMatch?.canvasCurve || !curveMatch?.point) return Promise.resolve(false);

  const duration = Math.max(160, Number(opts.duration) || 420);
  const color = opts.color ?? PHASER_PRIMARY;
  const coreColor = opts.coreColor ?? PHASER_CORE;
  const curve = curveMatch.canvasCurve;
  const samples = curveMatch.samples?.length ? curveMatch.samples : [curve.start, curve.end].filter(Boolean);
  if (samples.length < 2) return Promise.resolve(false);
  const meetT = Math.max(0.04, Math.min(0.96, Number(curveMatch.t) || 0.5));

  try {
    const container = _sceneContainer(Math.max(...samples.map(point => point.y), curveMatch.point.y));
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
      if (flash) _arrayCurveMeetingFlash(curveMatch.point, color, coreColor, opts);
      _fadeContainer(container, opts.fadeDuration ?? 180, opts.cleanupDelay ?? 120);
      resolveDone?.(played);
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
        const tA = meetT * progress;
        const tB = 1 - ((1 - meetT) * progress);
        const pointA = _sampledCurvePoint(samples, tA);
        const pointB = _sampledCurvePoint(samples, tB);
        orbA.x = pointA.x;
        orbA.y = pointA.y;
        orbB.x = pointB.x;
        orbB.y = pointB.y;
        const tail = Math.max(0.01, Math.min(1, Number(opts.trailLength) || 0.18));
        _redrawSampledCurveTrail(trailA, samples, Math.max(0, tA - tail), tA, color, coreColor, opts);
        _redrawSampledCurveTrail(trailB, samples, Math.min(1, tB + tail), tB, color, coreColor, opts);
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
  const bank = cfg.bank;
  const shared = cfg.shared;
  const blend = _blendMode(shared.blendMode);
  const duration = opts.duration ?? bank.hitDuration;

  const container = _sceneContainer(Math.max(sourcePoint.y, targetPoint.y), opts.layer);
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
 * TMP-era phaser bank: a stream of short bolts travelling source → target,
 * launched `boltSpacing` apart so several are in flight at once.
 *
 * Everything is redrawn from scratch each frame into one Graphics, so bolts,
 * muzzle flares and impact sparks all fade on their own clocks without
 * accumulating draw calls. Follows the ticker/cleanup shape of
 * `_arrayCurveCharge`: a `finished` guard, `ticker.remove` in cleanup, and a
 * setTimeout backstop in case the ticker is unavailable.
 */
function _tracerVolley(sourcePoint, targetPoint, opts = {}) {
  const layer = _effectLayer();
  if (!layer) return;

  const cfg = opts.beam ?? getBeamVfxSettings();
  const tracer = cfg.tracer;
  const bank = cfg.bank;
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
  const array = cfg.array;
  const shared = cfg.shared;
  const blend = _blendMode(shared.blendMode);
  const duration = opts.duration ?? array.hitDuration;
  // Blank sweep colour means "follow the beam's own core colour".
  const sweepColor = _parseHexColor(array.sweepColor, opts.coreColor);

  const container = _sceneContainer(Math.max(sourcePoint.y, targetPoint.y));
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
