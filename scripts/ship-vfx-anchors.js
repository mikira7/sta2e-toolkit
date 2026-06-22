/**
 * sta2e-toolkit | ship-vfx-anchors.js
 *
 * Actor-level image anchors for native ship VFX.
 */

const MODULE = "sta2e-toolkit";
const SHIP_VFX_ANCHORS_FLAG = "shipVfxAnchors";
const TOKEN_ALPHA_MASK_CACHE = new Map();
const TOKEN_ALPHA_MASK_MAX_SIZE = 96;
const TOKEN_ALPHA_THRESHOLD = 32;
const ARRAY_CURVE_SAMPLE_STEPS = 48;
const SHIP_VFX_ANCHORS_VERSION = 9;
const DEFAULT_WEAPON_EMITTER_FACING_DEG = 0;
const DEFAULT_WEAPON_EMITTER_ARC_WIDTH_DEG = 90;
const WEAPON_EMITTER_MIN_ARC_WIDTH_DEG = 60;
// Spinal Lance (-array-spread) is a tightly focused forward weapon and may aim
// down to a 0 deg arc, unlike normal beam emitters which floor at 60 deg.
const WEAPON_EMITTER_LANCE_MIN_ARC_WIDTH_DEG = 0;
const WEAPON_EMITTER_MAX_ARC_WIDTH_DEG = 180;
const WEAPON_EMITTER_LAYERS = Object.freeze(["above", "below"]);

// ── Engine trail emitters (impulse + warp nacelles) ─────────────────────────
// Per-ship placed emitter points that stream a PIXI particle trail during
// impulse and warp action animations. Facing is ship-local (0 fore,
// 90 starboard, 180 aft, 270 port) and biases the exhaust cone; layer puts the
// trail above or below the token sprite.
export const ENGINE_EMITTER_KINDS = Object.freeze(["impulse", "warp"]);
const ENGINE_BLEND_OPTIONS = Object.freeze(["add", "normal"]);
const ENGINE_COLOR_MODES = Object.freeze(["auto", "custom"]);
// Default facing for an engine emitter is aft (180) — exhaust points astern.
const DEFAULT_ENGINE_EMITTER_FACING_DEG = 180;
export const DEFAULT_ENGINE_MODE_SETTINGS = Object.freeze({
  impulse: Object.freeze({
    colorMode: "auto",
    customColor: "",
    lengthPx: 160,
    width: 16,
    rate: 80,
    alpha: 0.8,
    fade: 600,
    blendMode: "add",
  }),
  warp: Object.freeze({
    colorMode: "auto",
    customColor: "",
    lengthPx: 480,
    width: 9,
    rate: 150,
    alpha: 0.85,
    fade: 420,
    blendMode: "add",
  }),
});
// Legacy setting retained for existing actor data; action handlers now choose
// impulse vs warp directly instead of inferring it from movement distance.
const DEFAULT_ENGINE_TRAIL_SHARED = Object.freeze({
  enabled: true,
  warpThreshold: 4,
});
const PHASER_ERA_OPTIONS = Object.freeze([
  { value: "", label: "Current Default" },
  { value: "ent", label: "ENT" },
  { value: "tos", label: "TOS" },
  { value: "tmp", label: "TMP" },
  { value: "tng", label: "TNG/DS9/VOY" },
]);
const SHIELD_COLOR_OPTIONS = Object.freeze([
  { value: "", label: "Auto by Traits/Name" },
  { value: "blueWhite", label: "Blue-White" },
  { value: "teal", label: "Teal" },
  { value: "green", label: "Green" },
  { value: "red", label: "Red" },
  { value: "purple", label: "Purple" },
  { value: "orange", label: "Orange" },
  { value: "custom", label: "Custom Hex" },
]);
const SHIP_SYSTEMS = Object.freeze([
  { key: "communications", label: "Communications", color: "#66ccff" },
  { key: "computers",      label: "Computers",      color: "#99dd66" },
  { key: "engines",        label: "Engines",        color: "#ffaa33" },
  { key: "sensors",        label: "Sensors",        color: "#cc99ff" },
  { key: "structure",      label: "Structure",      color: "#ffcc66" },
  { key: "weapons",        label: "Weapons",        color: "#ff6666" },
]);
const SHIP_SYSTEM_KEYS = new Set(SHIP_SYSTEMS.map(system => system.key));
const DEFAULT_SOURCE_OFFSET = Object.freeze({
  x: 0,
  y: 0,
  adaptiveAlong: 0,
  adaptiveSide: 0,
  space: "shipLocal",
});
export const DEFAULT_ARRAY_CHARGE_SETTINGS = Object.freeze({
  hitDuration: 460,
  missDuration: 320,
  easing: "outQuad",
  blendMode: "add",
  colorOverride: "",
  coreColorOverride: "",
  orbGlowRadius: 15,
  orbGlowAlpha: 0.28,
  orbInnerRadius: 9,
  orbInnerAlpha: 0.5,
  coreRadius: 4,
  coreAlpha: 0.96,
  ringRadius: 8,
  ringWidth: 2,
  ringAlpha: 0.78,
  trailLength: 0.18,
  trailSteps: 9,
  trailGlowWidth: 16,
  trailGlowAlphaStart: 0.08,
  trailGlowAlphaEnd: 0.32,
  trailCoreWidth: 4,
  trailCoreAlphaStart: 0.22,
  trailCoreAlphaEnd: 0.72,
  flashFillRadius: 12,
  flashFillAlpha: 0.72,
  flashRingRadius: 22,
  flashRingWidth: 2,
  flashRingAlpha: 0.62,
  fadeDuration: 180,
  flashFadeDuration: 220,
  cleanupDelay: 120,
});
const CHARGE_EASING_OPTIONS = Object.freeze(["linear", "inQuad", "outQuad", "inOutQuad"]);
const CHARGE_BLEND_OPTIONS = Object.freeze(["add", "normal"]);

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function _clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function _number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function _clampNumber(value, fallback, min, max) {
  return _clamp(_number(value, fallback), min, max);
}

function _normalizeDegrees(value, fallback = 0) {
  const numeric = Number(value);
  const deg = Number.isFinite(numeric) ? numeric : fallback;
  return ((deg % 360) + 360) % 360;
}

function _shortestAngleDelta(fromDeg, toDeg) {
  return ((_normalizeDegrees(toDeg) - _normalizeDegrees(fromDeg) + 540) % 360) - 180;
}

function _angleDistanceDeg(a, b) {
  return Math.abs(_shortestAngleDelta(a, b));
}

function _canvasDirectionDeg(fromPoint, toPoint) {
  if (!fromPoint || !toPoint) return 0;
  return _normalizeDegrees(Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x) * (180 / Math.PI));
}

function _tokenRotationDeg(token) {
  const doc = token?.document ?? token;
  return _normalizeDegrees(doc?.rotation ?? token?.rotation ?? 0);
}

function _normalizeEmitterArcWidth(value, minArc = WEAPON_EMITTER_MIN_ARC_WIDTH_DEG) {
  return Math.round(_clampNumber(
    value,
    DEFAULT_WEAPON_EMITTER_ARC_WIDTH_DEG,
    minArc,
    WEAPON_EMITTER_MAX_ARC_WIDTH_DEG,
  ));
}

// Spinal Lance emitters may aim down to 0 deg; all other weapon emitters floor
// at the standard minimum arc width.
function _isLanceWeaponImg(weaponImg) {
  const img = String(weaponImg || "").split("/").pop().replace(/\.(svg|webp|png|jpg)$/i, "");
  return img.includes("-array-spread");
}

function _emitterArcMinForWeaponImg(weaponImg) {
  return _isLanceWeaponImg(weaponImg)
    ? WEAPON_EMITTER_LANCE_MIN_ARC_WIDTH_DEG
    : WEAPON_EMITTER_MIN_ARC_WIDTH_DEG;
}

function _normalizeEmitterLayer(value) {
  const layer = String(value ?? "").toLowerCase();
  return WEAPON_EMITTER_LAYERS.includes(layer) ? layer : "above";
}

function _defaultEmitterFacingDeg(anchor) {
  const dx = Number(anchor?.x ?? 0.5) - 0.5;
  const dy = Number(anchor?.y ?? 0.5) - 0.5;
  if (Math.hypot(dx, dy) < 0.0001) return DEFAULT_WEAPON_EMITTER_FACING_DEG;
  return _normalizeDegrees(Math.atan2(dx, -dy) * (180 / Math.PI));
}

function _normalizeHexColor(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /^#[0-9a-f]{6}$/i.test(text) ? text : "";
}

function _resolveActor(actorOrToken) {
  if (!actorOrToken) return null;
  if (actorOrToken.documentName === "Actor") return actorOrToken;
  return actorOrToken.actor ?? actorOrToken.document?.actor ?? null;
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

function _normalizeAnchor(anchor, fallbackLabel = "Tractor emitter") {
  const x = Number(anchor?.x);
  const y = Number(anchor?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: _clamp(x),
    y: _clamp(y),
    label: String(anchor?.label || fallbackLabel),
  };
}

function _normalizeCurvePoint(point) {
  const normalized = _normalizeAnchor(point, "");
  return normalized ? { x: normalized.x, y: normalized.y } : null;
}

function _normalizeWeaponEmitter(anchor) {
  const normalized = _normalizeAnchor(anchor, "Weapon emitter");
  if (!normalized) return null;
  return {
    ...normalized,
    weaponId: String(anchor?.weaponId || ""),
    weaponName: String(anchor?.weaponName || ""),
    weaponImg: String(anchor?.weaponImg || ""),
    facingDeg: _normalizeDegrees(anchor?.facingDeg, _defaultEmitterFacingDeg(normalized)),
    arcWidthDeg: _normalizeEmitterArcWidth(anchor?.arcWidthDeg, _emitterArcMinForWeaponImg(anchor?.weaponImg)),
    layer: _normalizeEmitterLayer(anchor?.layer),
  };
}

function _normalizeEngineKind(value) {
  const kind = String(value ?? "").toLowerCase();
  return ENGINE_EMITTER_KINDS.includes(kind) ? kind : "impulse";
}

function _normalizeEngineEmitter(anchor) {
  const normalized = _normalizeAnchor(anchor, "Engine emitter");
  if (!normalized) return null;
  return {
    ...normalized,
    kind: _normalizeEngineKind(anchor?.kind),
    facingDeg: _normalizeDegrees(anchor?.facingDeg, DEFAULT_ENGINE_EMITTER_FACING_DEG),
    layer: _normalizeEmitterLayer(anchor?.layer),
  };
}

function _normalizeEngineColorMode(value) {
  const mode = String(value ?? "").toLowerCase();
  return ENGINE_COLOR_MODES.includes(mode) ? mode : "auto";
}

function _normalizeEngineModeSettings(settings = {}, kind = "impulse") {
  const defaults = DEFAULT_ENGINE_MODE_SETTINGS[_normalizeEngineKind(kind)] ?? DEFAULT_ENGINE_MODE_SETTINGS.impulse;
  return {
    colorMode: _normalizeEngineColorMode(settings?.colorMode),
    customColor: _normalizeHexColor(settings?.customColor),
    lengthPx: Math.round(_clampNumber(settings?.lengthPx, defaults.lengthPx, 20, 2000)),
    width: Math.round(_clampNumber(settings?.width, defaults.width, 1, 200)),
    rate: Math.round(_clampNumber(settings?.rate, defaults.rate, 4, 600)),
    alpha: Math.round(_clampNumber(settings?.alpha, defaults.alpha, 0, 1) * 100) / 100,
    fade: Math.round(_clampNumber(settings?.fade, defaults.fade, 60, 4000)),
    blendMode: ENGINE_BLEND_OPTIONS.includes(settings?.blendMode) ? settings.blendMode : defaults.blendMode,
  };
}

export function normalizeShipEngineTrailSettings(settings = {}) {
  return {
    enabled: settings?.enabled !== false,
    warpThreshold: Math.round(_clampNumber(settings?.warpThreshold, DEFAULT_ENGINE_TRAIL_SHARED.warpThreshold, 1, 50) * 10) / 10,
    impulse: _normalizeEngineModeSettings(settings?.impulse, "impulse"),
    warp: _normalizeEngineModeSettings(settings?.warp, "warp"),
  };
}

function _normalizeSourceOffset(offset) {
  return {
    x: Math.round(_clampNumber(offset?.x, DEFAULT_SOURCE_OFFSET.x, -500, 500) * 100) / 100,
    y: Math.round(_clampNumber(offset?.y, DEFAULT_SOURCE_OFFSET.y, -500, 500) * 100) / 100,
    adaptiveAlong: Math.round(_clampNumber(offset?.adaptiveAlong, DEFAULT_SOURCE_OFFSET.adaptiveAlong, -500, 500) * 100) / 100,
    adaptiveSide: Math.round(_clampNumber(offset?.adaptiveSide, DEFAULT_SOURCE_OFFSET.adaptiveSide, -500, 500) * 100) / 100,
    space: "shipLocal",
  };
}

function _normalizePhaserEra(era) {
  const value = String(era ?? "").toLowerCase();
  return PHASER_ERA_OPTIONS.some(option => option.value === value) ? value : "";
}

function _normalizeShieldColorPreset(preset) {
  const value = String(preset ?? "");
  return SHIELD_COLOR_OPTIONS.some(option => option.value === value) ? value : "";
}

export function normalizeShipShieldImpactSettings(settings = {}) {
  return {
    colorPreset: _normalizeShieldColorPreset(settings?.colorPreset),
    customColor: _normalizeHexColor(settings?.customColor),
  };
}

export function normalizeShipArrayChargeSettings(settings = {}) {
  const defaults = DEFAULT_ARRAY_CHARGE_SETTINGS;
  return {
    hitDuration: Math.round(_clampNumber(settings.hitDuration, defaults.hitDuration, 80, 5000)),
    missDuration: Math.round(_clampNumber(settings.missDuration, defaults.missDuration, 80, 5000)),
    easing: CHARGE_EASING_OPTIONS.includes(settings.easing) ? settings.easing : defaults.easing,
    blendMode: CHARGE_BLEND_OPTIONS.includes(settings.blendMode) ? settings.blendMode : defaults.blendMode,
    colorOverride: _normalizeHexColor(settings.colorOverride),
    coreColorOverride: _normalizeHexColor(settings.coreColorOverride),
    orbGlowRadius: _clampNumber(settings.orbGlowRadius, defaults.orbGlowRadius, 1, 120),
    orbGlowAlpha: _clampNumber(settings.orbGlowAlpha, defaults.orbGlowAlpha, 0, 1),
    orbInnerRadius: _clampNumber(settings.orbInnerRadius, defaults.orbInnerRadius, 1, 120),
    orbInnerAlpha: _clampNumber(settings.orbInnerAlpha, defaults.orbInnerAlpha, 0, 1),
    coreRadius: _clampNumber(settings.coreRadius, defaults.coreRadius, 1, 80),
    coreAlpha: _clampNumber(settings.coreAlpha, defaults.coreAlpha, 0, 1),
    ringRadius: _clampNumber(settings.ringRadius, defaults.ringRadius, 1, 120),
    ringWidth: _clampNumber(settings.ringWidth, defaults.ringWidth, 0, 40),
    ringAlpha: _clampNumber(settings.ringAlpha, defaults.ringAlpha, 0, 1),
    trailLength: _clampNumber(settings.trailLength, defaults.trailLength, 0.01, 1),
    trailSteps: Math.round(_clampNumber(settings.trailSteps, defaults.trailSteps, 2, 40)),
    trailGlowWidth: _clampNumber(settings.trailGlowWidth, defaults.trailGlowWidth, 0, 80),
    trailGlowAlphaStart: _clampNumber(settings.trailGlowAlphaStart, defaults.trailGlowAlphaStart, 0, 1),
    trailGlowAlphaEnd: _clampNumber(settings.trailGlowAlphaEnd, defaults.trailGlowAlphaEnd, 0, 1),
    trailCoreWidth: _clampNumber(settings.trailCoreWidth, defaults.trailCoreWidth, 0, 60),
    trailCoreAlphaStart: _clampNumber(settings.trailCoreAlphaStart, defaults.trailCoreAlphaStart, 0, 1),
    trailCoreAlphaEnd: _clampNumber(settings.trailCoreAlphaEnd, defaults.trailCoreAlphaEnd, 0, 1),
    flashFillRadius: _clampNumber(settings.flashFillRadius, defaults.flashFillRadius, 0, 160),
    flashFillAlpha: _clampNumber(settings.flashFillAlpha, defaults.flashFillAlpha, 0, 1),
    flashRingRadius: _clampNumber(settings.flashRingRadius, defaults.flashRingRadius, 0, 200),
    flashRingWidth: _clampNumber(settings.flashRingWidth, defaults.flashRingWidth, 0, 60),
    flashRingAlpha: _clampNumber(settings.flashRingAlpha, defaults.flashRingAlpha, 0, 1),
    fadeDuration: Math.round(_clampNumber(settings.fadeDuration, defaults.fadeDuration, 20, 3000)),
    flashFadeDuration: Math.round(_clampNumber(settings.flashFadeDuration, defaults.flashFadeDuration, 20, 3000)),
    cleanupDelay: Math.round(_clampNumber(settings.cleanupDelay, defaults.cleanupDelay, 0, 2000)),
  };
}

export function normalizeShipWeaponVfxSetting(setting = {}, weapon = null) {
  return {
    weaponId: String(setting?.weaponId || (weapon ? _weaponId(weapon) : "")),
    weaponName: String(setting?.weaponName || (weapon ? _weaponName(weapon) : "")),
    weaponImg: String(setting?.weaponImg || (weapon ? _weaponImg(weapon) : "")),
    phaserEra: _normalizePhaserEra(setting?.phaserEra),
    sourceOffset: _normalizeSourceOffset(setting?.sourceOffset),
    charge: normalizeShipArrayChargeSettings(setting?.charge),
  };
}

function _normalizeCurveNode(node) {
  const anchor = _normalizeCurvePoint(node);
  if (!anchor) return null;
  const hIn = _normalizeCurvePoint(node?.hIn) ?? { x: anchor.x, y: anchor.y };
  const hOut = _normalizeCurvePoint(node?.hOut) ?? { x: anchor.x, y: anchor.y };
  return { x: anchor.x, y: anchor.y, hIn, hOut };
}

function _normalizeArrayCurve(curve) {
  const nodes = Array.isArray(curve?.nodes)
    ? curve.nodes.map(node => _normalizeCurveNode(node)).filter(Boolean)
    : [];
  if (nodes.length >= 2) {
    return {
      nodes,
      weaponId: String(curve?.weaponId || ""),
      weaponName: String(curve?.weaponName || ""),
      weaponImg: String(curve?.weaponImg || ""),
      label: String(curve?.label || "Array curve"),
    };
  }

  const points = Array.isArray(curve?.points)
    ? curve.points.map(point => _normalizeCurvePoint(point)).filter(Boolean)
    : [];
  if (points.length >= 2) {
    return {
      points,
      weaponId: String(curve?.weaponId || ""),
      weaponName: String(curve?.weaponName || ""),
      weaponImg: String(curve?.weaponImg || ""),
      label: String(curve?.label || "Array curve"),
    };
  }

  const start = _normalizeCurvePoint(curve?.start);
  const control1 = _normalizeCurvePoint(curve?.control1);
  const control2 = _normalizeCurvePoint(curve?.control2);
  const end = _normalizeCurvePoint(curve?.end);
  if (!start || !control1 || !control2 || !end) return null;
  return {
    start,
    control1,
    control2,
    end,
    weaponId: String(curve?.weaponId || ""),
    weaponName: String(curve?.weaponName || ""),
    weaponImg: String(curve?.weaponImg || ""),
    label: String(curve?.label || "Array curve"),
  };
}

function _systemLabel(systemKey) {
  return SHIP_SYSTEMS.find(system => system.key === systemKey)?.label ?? systemKey;
}

function _systemColor(systemKey) {
  return SHIP_SYSTEMS.find(system => system.key === systemKey)?.color ?? "#33aaff";
}

function _normalizeSystemKey(systemKey) {
  const key = String(systemKey || "").toLowerCase();
  return SHIP_SYSTEM_KEYS.has(key) ? key : "structure";
}

function _normalizeHitLocation(anchor) {
  const systemKey = _normalizeSystemKey(anchor?.systemKey);
  const normalized = _normalizeAnchor(anchor, `${_systemLabel(systemKey)} hit location`);
  if (!normalized) return null;
  return {
    ...normalized,
    systemKey,
  };
}

// ── Hit zone polygons ────────────────────────────────────────────────────────
// Per-system polygon zones drawn over the ship image. Shots sample a random
// point inside the polygon so hits land somewhere new each time, instead of
// always striking the same fixed emitter point. Legacy hitLocations points
// remain as a fallback for ships without drawn zones.
function _normalizeHitPolygon(zone) {
  const systemKey = _normalizeSystemKey(zone?.systemKey);
  const points = Array.isArray(zone?.points)
    ? zone.points.map(point => _normalizeCurvePoint(point)).filter(Boolean)
    : [];
  if (points.length < 3) return null;
  return {
    systemKey,
    points,
    label: String(zone?.label || `${_systemLabel(systemKey)} hit zone`),
  };
}

// Shoelace formula; result is in normalized image space so it only matters
// relative to other zones on the same ship (used for area-weighted picks).
function _polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += (a.x * b.y) - (b.x * a.y);
  }
  return Math.abs(area) / 2;
}

function _polygonCentroid(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  const n = Math.max(1, points.length);
  return { x: x / n, y: y / n };
}

// Standard ray-cast point-in-polygon test.
function _pointInHitPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && (point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

// Rejection-sample inside the polygon's bounding box. Concave hulls are fine;
// the fallback centroid covers degenerate slivers that never accept a sample.
function _randomPointInPolygon(points, maxTries = 80) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  for (let i = 0; i < maxTries; i++) {
    const candidate = {
      x: minX + Math.random() * (maxX - minX),
      y: minY + Math.random() * (maxY - minY),
    };
    if (_pointInHitPolygon(candidate, points)) return candidate;
  }
  return _polygonCentroid(points);
}

function _pickHitPolygonWeightedByArea(polygons) {
  if (polygons.length === 1) return polygons[0];
  const weights = polygons.map(zone => Math.max(_polygonArea(zone.points), 1e-6));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < polygons.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return polygons[i];
  }
  return polygons[polygons.length - 1];
}

function _weaponId(weapon) {
  return String(weapon?.id ?? weapon?._id ?? "");
}

function _weaponName(weapon) {
  return String(weapon?.name ?? "");
}

function _weaponImg(weapon) {
  return String(weapon?.img ?? "");
}

function _weaponMatchesEmitter(anchor, weapon) {
  if (!anchor || !weapon) return false;
  const weaponId = _weaponId(weapon);
  if (anchor.weaponId && weaponId) return anchor.weaponId === weaponId;
  const weaponImg = _weaponImg(weapon);
  if (anchor.weaponImg && weaponImg) return anchor.weaponImg === weaponImg;
  const weaponName = _weaponName(weapon);
  return !!anchor.weaponName && !!weaponName && anchor.weaponName === weaponName;
}

function _isArrayWeapon(weapon) {
  const img = _weaponImg(weapon).split("/").pop().replace(/\.(svg|webp|png|jpg)$/i, "");
  if (img.includes("-array") && !img.includes("-array-spread")) return true;
  return /\barrays?\b/i.test(_weaponName(weapon));
}

function _isEraPhaserWeapon(weapon) {
  const name = _weaponName(weapon).toLowerCase();
  const img = _weaponImg(weapon).split("/").pop().replace(/\.(svg|webp|png|jpg)$/i, "").toLowerCase();
  const isPhaser = /\bphasers?\b/.test(name) || /\bphase[-\s]?pulse\b/.test(name) || img.includes("phaser");
  const isSupportedType = img.includes("phaser-bank") || img.includes("phaser-array") || img.includes("phaser-cannon")
    || /\b(phaser|phase[-\s]?pulse).*\b(banks?|arrays?|cannons?)\b/.test(name)
    || /\b(banks?|arrays?|cannons?)\b.*\b(phaser|phase[-\s]?pulse)\b/.test(name);
  return isPhaser && isSupportedType;
}

function _tabIdForWeapon(weapon) {
  return `weapon:${_weaponId(weapon)}`;
}

export function normalizeShipVfxAnchors(data = {}) {
  const tractorEmitters = Array.isArray(data?.anchors?.tractorEmitters)
    ? data.anchors.tractorEmitters.map(anchor => _normalizeAnchor(anchor)).filter(Boolean)
    : [];
  const legacyTractorEmitter = _normalizeAnchor(data?.anchors?.tractorEmitter);
  if (!tractorEmitters.length && legacyTractorEmitter) tractorEmitters.push(legacyTractorEmitter);

  const weaponEmitters = Array.isArray(data?.anchors?.weaponEmitters)
    ? data.anchors.weaponEmitters.map(anchor => _normalizeWeaponEmitter(anchor)).filter(Boolean)
    : [];

  const engineEmitters = Array.isArray(data?.anchors?.engineEmitters)
    ? data.anchors.engineEmitters.map(anchor => _normalizeEngineEmitter(anchor)).filter(Boolean)
    : [];

  const hitLocations = Array.isArray(data?.anchors?.hitLocations)
    ? data.anchors.hitLocations.map(anchor => _normalizeHitLocation(anchor)).filter(Boolean)
    : [];

  const hitPolygons = Array.isArray(data?.anchors?.hitPolygons)
    ? data.anchors.hitPolygons.map(zone => _normalizeHitPolygon(zone)).filter(Boolean)
    : [];

  const arrayCurves = Array.isArray(data?.anchors?.arrayCurves)
    ? data.anchors.arrayCurves.map(curve => _normalizeArrayCurve(curve)).filter(Boolean)
    : [];
  const weaponVfx = Array.isArray(data?.settings?.weaponVfx)
    ? data.settings.weaponVfx.map(setting => normalizeShipWeaponVfxSetting(setting)).filter(setting => (
      setting.weaponId || setting.weaponName || setting.weaponImg
    ))
    : [];

  return {
    version: SHIP_VFX_ANCHORS_VERSION,
    textureSrc: String(data?.textureSrc || ""),
    anchors: {
      tractorEmitters,
      weaponEmitters,
      engineEmitters,
      hitLocations,
      hitPolygons,
      arrayCurves,
    },
    settings: {
      weaponVfx,
      shieldImpact: normalizeShipShieldImpactSettings(data?.settings?.shieldImpact),
      engineTrail: normalizeShipEngineTrailSettings(data?.settings?.engineTrail),
    },
  };
}

export function getShipVfxAnchors(actorOrToken) {
  const actor = _resolveActor(actorOrToken);
  if (!actor) return normalizeShipVfxAnchors();
  return normalizeShipVfxAnchors(actor.getFlag(MODULE, SHIP_VFX_ANCHORS_FLAG) ?? {});
}

export function getDefaultShipWeaponVfxSettings(weapon = null) {
  return normalizeShipWeaponVfxSetting({}, weapon);
}

export function getShipWeaponVfxSettingsFromData(data, weapon, override = null) {
  if (override) return normalizeShipWeaponVfxSetting(override, weapon);
  if (!weapon) return getDefaultShipWeaponVfxSettings();
  const setting = (normalizeShipVfxAnchors(data).settings.weaponVfx ?? [])
    .find(row => _weaponMatchesEmitter(row, weapon));
  return normalizeShipWeaponVfxSetting(setting ?? {}, weapon);
}

export function getShipWeaponVfxSettings(actorOrToken, weapon, override = null) {
  return getShipWeaponVfxSettingsFromData(getShipVfxAnchors(actorOrToken), weapon, override);
}

export function getShipShieldImpactSettings(actorOrToken) {
  return normalizeShipShieldImpactSettings(getShipVfxAnchors(actorOrToken)?.settings?.shieldImpact);
}

export function getShipEngineEmitters(actorOrToken, kind = null) {
  const all = getShipVfxAnchors(actorOrToken).anchors.engineEmitters ?? [];
  if (!kind) return all;
  const wanted = _normalizeEngineKind(kind);
  return all.filter(anchor => anchor.kind === wanted);
}

export function getShipEngineTrailSettings(actorOrToken) {
  return normalizeShipEngineTrailSettings(getShipVfxAnchors(actorOrToken)?.settings?.engineTrail);
}

// Map a placed engine emitter (normalized image anchor) to a live canvas point,
// honoring token rotation / flip / fit — reuses the weapon anchor math.
export function shipEngineEmitterToCanvasPoint(token, anchor) {
  return tokenAnchorToCanvasPoint(token, anchor);
}

// Convert ship-local facing degrees (0 fore) into a canvas-space angle for the
// given token, accounting for its current rotation.
export function shipEngineFacingToCanvasDeg(token, facingDeg) {
  // Ship-local 0 = fore = "up" on the unrotated sprite. Canvas 0deg = +x (east),
  // and "up" is -90deg. Token rotation adds clockwise.
  const local = _normalizeDegrees(facingDeg, DEFAULT_ENGINE_EMITTER_FACING_DEG);
  return _normalizeDegrees(local - 90 + _tokenRotationDeg(token));
}

// Faction / era aware exhaust color. Custom hex wins; otherwise a warm impulse
// glow and cool warp streak, tinted by the ship's faction guessed from its name.
export function resolveEngineTrailColorHex(actorOrToken, kind, modeSettings = null) {
  const k = _normalizeEngineKind(kind);
  const settings = modeSettings
    ? _normalizeEngineModeSettings(modeSettings, k)
    : (getShipEngineTrailSettings(actorOrToken)?.[k]);
  if (settings?.colorMode === "custom" && _normalizeHexColor(settings.customColor)) {
    return settings.customColor.toLowerCase();
  }
  const actor = _resolveActor(actorOrToken);
  const haystack = [
    actor?.name,
    actor?.system?.traits,
    Array.isArray(actor?.system?.traits) ? actor.system.traits.join(" ") : "",
  ].filter(Boolean).join(" ").toLowerCase();

  const FACTIONS = [
    { test: /klingon/, impulse: "#ff3b2e", warp: "#ff6a4a" },
    { test: /romulan/, impulse: "#2ad17a", warp: "#8affc0" },
    { test: /cardassian/, impulse: "#ffae42", warp: "#ffd089" },
    { test: /\bborg\b/, impulse: "#6aff4a", warp: "#b6ff9a" },
    { test: /dominion|jem'?hadar|founder/, impulse: "#7a5cff", warp: "#b9a9ff" },
    { test: /ferengi/, impulse: "#ff9a2a", warp: "#ffc46a" },
  ];
  for (const faction of FACTIONS) {
    if (faction.test.test(haystack)) return k === "warp" ? faction.warp : faction.impulse;
  }
  // Federation / default. TOS-era ships read warmer.
  if (/\b(tos|constitution|enterprise nx|nx-0|tos[- ]?era)\b/.test(haystack)) {
    return k === "warp" ? "#ffe7a0" : "#ffd24a";
  }
  return k === "warp" ? "#aad4ff" : "#ff7a2a";
}

export function shipLocalOffsetToCanvasDelta(token, sourceOffset) {
  const offset = _normalizeSourceOffset(sourceOffset);
  if (!token || (!offset.x && !offset.y)) return { x: 0, y: 0 };
  const doc = token?.document ?? token;
  const texture = doc?.texture ?? {};
  const scaleX = Number(texture.scaleX ?? 1) || 1;
  const scaleY = Number(texture.scaleY ?? 1) || 1;
  const localX = offset.x * (scaleX < 0 ? -1 : 1);
  const localY = offset.y * (scaleY < 0 ? -1 : 1);
  const rotation = Number(doc?.rotation ?? token?.rotation ?? 0) * (Math.PI / 180);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: localX * cos - localY * sin,
    y: localX * sin + localY * cos,
  };
}

export function adaptiveSourceOffsetToCanvasDelta(sourcePoint, targetPoint, sourceOffset) {
  const offset = _normalizeSourceOffset(sourceOffset);
  if (!sourcePoint || !targetPoint || (!offset.adaptiveAlong && !offset.adaptiveSide)) return { x: 0, y: 0 };
  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  return {
    x: (ux * offset.adaptiveAlong) + (nx * offset.adaptiveSide),
    y: (uy * offset.adaptiveAlong) + (ny * offset.adaptiveSide),
  };
}

export function sourceOffsetToCanvasDelta(token, sourcePoint, targetPoint, sourceOffset) {
  const local = shipLocalOffsetToCanvasDelta(token, sourceOffset);
  const adaptive = adaptiveSourceOffsetToCanvasDelta(sourcePoint, targetPoint, sourceOffset);
  return {
    x: local.x + adaptive.x,
    y: local.y + adaptive.y,
  };
}

export function applyShipWeaponSourceOffset(token, weapon, point, settingsOverride = null, targetPoint = null) {
  if (!point) return null;
  const settings = getShipWeaponVfxSettings(token, weapon, settingsOverride);
  const delta = sourceOffsetToCanvasDelta(token, point, targetPoint, settings.sourceOffset);
  return {
    ...point,
    x: point.x + delta.x,
    y: point.y + delta.y,
  };
}

export function shipWeaponAnchorToCanvasPoint(token, weapon, anchor, settingsOverride = null, targetPoint = null) {
  const point = tokenAnchorToCanvasPoint(token, anchor);
  return applyShipWeaponSourceOffset(token, weapon, point, settingsOverride, targetPoint);
}

export function getShipTractorEmitterAnchor(actorOrToken) {
  return getShipVfxAnchors(actorOrToken).anchors.tractorEmitters?.[0] ?? null;
}

export function getShipTractorEmitterAnchors(actorOrToken) {
  return getShipVfxAnchors(actorOrToken).anchors.tractorEmitters ?? [];
}

export function getClosestShipTractorEmitterPoint(token, targetPoint) {
  const anchors = getShipTractorEmitterAnchors(token);
  if (!anchors.length || !targetPoint) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    const point = tokenAnchorToCanvasPoint(token, anchor);
    if (!point) continue;
    const distance = Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

export function getShipWeaponEmitterAnchors(actorOrToken, weapon) {
  if (!weapon) return [];
  return (getShipVfxAnchors(actorOrToken).anchors.weaponEmitters ?? [])
    .filter(anchor => _weaponMatchesEmitter(anchor, weapon));
}

export function shipTargetBearingToLocalDeg(token, targetPoint) {
  const center = _tokenCenter(token);
  const canvasBearing = _canvasDirectionDeg(center, targetPoint);
  return _normalizeDegrees(canvasBearing - _tokenRotationDeg(token) + 90);
}

export function shipFacingDegToRotationForTarget(token, targetPoint, facingDeg) {
  const center = _tokenCenter(token);
  const canvasBearing = _canvasDirectionDeg(center, targetPoint);
  const currentRotation = _tokenRotationDeg(token);
  const targetRotation = canvasBearing - _normalizeDegrees(facingDeg) + 90;
  return currentRotation + _shortestAngleDelta(currentRotation, targetRotation);
}

export function getShipWeaponEmitterArcSelection(token, weapon, targetPoint, settingsOverride = null) {
  if (!token || !weapon || !targetPoint || _isArrayWeapon(weapon)) return null;
  const anchors = getShipWeaponEmitterAnchors(token, weapon);
  if (!anchors.length) return null;

  const targetBearing = shipTargetBearingToLocalDeg(token, targetPoint);
  const currentRotation = _tokenRotationDeg(token);
  let best = null;

  anchors.forEach((anchor, index) => {
    const point = shipWeaponAnchorToCanvasPoint(token, weapon, anchor, settingsOverride, targetPoint);
    if (!point) return;

    const facingDeg = _normalizeDegrees(anchor.facingDeg, _defaultEmitterFacingDeg(anchor));
    const arcWidthDeg = _normalizeEmitterArcWidth(anchor.arcWidthDeg, _emitterArcMinForWeaponImg(_weaponImg(weapon)));
    const bearingDelta = _angleDistanceDeg(targetBearing, facingDeg);
    const inArc = bearingDelta <= (arcWidthDeg / 2);
    const desiredRotation = shipFacingDegToRotationForTarget(token, targetPoint, facingDeg);
    const turnDelta = _shortestAngleDelta(currentRotation, desiredRotation);
    const distance = Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y);
    const score = inArc
      ? [0, distance, index]
      : [1, Math.abs(turnDelta), distance, index];

    if (!best || _compareScore(score, best.score) < 0) {
      best = {
        anchor,
        point,
        index,
        layer: _normalizeEmitterLayer(anchor.layer),
        facingDeg,
        arcWidthDeg,
        inArc,
        targetBearing,
        desiredRotation,
        turnDelta,
        distance,
        score,
      };
    }
  });

  if (!best) return null;
  const { score, ...selection } = best;
  return selection;
}

function _compareScore(a, b) {
  const length = Math.max(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < length; i++) {
    const av = a?.[i] ?? 0;
    const bv = b?.[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

export function getClosestShipWeaponEmitterPoint(token, weapon, targetPoint, settingsOverride = null) {
  const anchors = getShipWeaponEmitterAnchors(token, weapon);
  if (!anchors.length || !targetPoint) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    const point = shipWeaponAnchorToCanvasPoint(token, weapon, anchor, settingsOverride, targetPoint);
    if (!point) continue;
    const distance = Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

export function isShipArrayWeapon(weapon) {
  return _isArrayWeapon(weapon);
}

export function getShipArrayCurves(actorOrToken, weapon) {
  if (!weapon || !_isArrayWeapon(weapon)) return [];
  return (getShipVfxAnchors(actorOrToken).anchors.arrayCurves ?? [])
    .filter(curve => _weaponMatchesEmitter(curve, weapon));
}

export function tokenArrayCurveToCanvasCurve(token, curve) {
  if (!token || !curve) return null;
  if (Array.isArray(curve.nodes) && curve.nodes.length >= 2) {
    const nodes = curve.nodes
      .map(node => {
        const anchor = tokenAnchorToCanvasPoint(token, node);
        if (!anchor) return null;
        return {
          x: anchor.x,
          y: anchor.y,
          hIn: tokenAnchorToCanvasPoint(token, node.hIn) ?? { x: anchor.x, y: anchor.y },
          hOut: tokenAnchorToCanvasPoint(token, node.hOut) ?? { x: anchor.x, y: anchor.y },
        };
      })
      .filter(Boolean);
    if (nodes.length < 2) return null;
    return {
      nodes,
      start: { x: nodes[0].x, y: nodes[0].y },
      end: { x: nodes[nodes.length - 1].x, y: nodes[nodes.length - 1].y },
    };
  }
  if (Array.isArray(curve.points) && curve.points.length >= 2) {
    const points = curve.points
      .map(point => tokenAnchorToCanvasPoint(token, point))
      .filter(Boolean);
    if (points.length < 2) return null;
    return {
      points,
      start: points[0],
      end: points[points.length - 1],
    };
  }

  const start = tokenAnchorToCanvasPoint(token, curve.start);
  const control1 = tokenAnchorToCanvasPoint(token, curve.control1);
  const control2 = tokenAnchorToCanvasPoint(token, curve.control2);
  const end = tokenAnchorToCanvasPoint(token, curve.end);
  if (!start || !control1 || !control2 || !end) return null;
  return { start, control1, control2, end };
}

function _offsetCanvasPoint(point, delta) {
  return point ? { ...point, x: point.x + delta.x, y: point.y + delta.y } : null;
}

function _offsetCanvasCurve(canvasCurve, delta) {
  if (!canvasCurve) return null;
  if (Array.isArray(canvasCurve.nodes)) {
    const nodes = canvasCurve.nodes.map(node => ({
      x: node.x + delta.x,
      y: node.y + delta.y,
      hIn: _offsetCanvasPoint(node.hIn, delta) ?? { x: node.x + delta.x, y: node.y + delta.y },
      hOut: _offsetCanvasPoint(node.hOut, delta) ?? { x: node.x + delta.x, y: node.y + delta.y },
    }));
    return nodes.length >= 2
      ? { ...canvasCurve, nodes, start: { x: nodes[0].x, y: nodes[0].y }, end: { x: nodes[nodes.length - 1].x, y: nodes[nodes.length - 1].y } }
      : null;
  }
  if (Array.isArray(canvasCurve.points)) {
    const points = canvasCurve.points.map(point => _offsetCanvasPoint(point, delta)).filter(Boolean);
    return points.length >= 2 ? { ...canvasCurve, points, start: points[0], end: points[points.length - 1] } : null;
  }
  return {
    ...canvasCurve,
    start: _offsetCanvasPoint(canvasCurve.start, delta),
    control1: _offsetCanvasPoint(canvasCurve.control1, delta),
    control2: _offsetCanvasPoint(canvasCurve.control2, delta),
    end: _offsetCanvasPoint(canvasCurve.end, delta),
  };
}

function _cubicBezierPoint(curve, t) {
  const clamped = _clamp(t);
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
    t: clamped,
  };
}

// One cubic-bezier segment between two poly-bezier nodes. control1 = a.hOut,
// control2 = b.hIn, falling back to the anchors when a handle is missing.
function _polyBezierSegment(a, b) {
  return {
    start: { x: a.x, y: a.y },
    control1: a.hOut ?? { x: a.x, y: a.y },
    control2: b.hIn ?? { x: b.x, y: b.y },
    end: { x: b.x, y: b.y },
  };
}

function _polyBezierSegmentPoint(a, b, localT) {
  return _cubicBezierPoint(_polyBezierSegment(a, b), localT);
}

function _polyBezierSegmentTangent(a, b, localT) {
  const seg = _polyBezierSegment(a, b);
  const u = _clamp(localT);
  const mu = 1 - u;
  // Derivative of a cubic bezier.
  const dx = 3 * mu * mu * (seg.control1.x - seg.start.x)
    + 6 * mu * u * (seg.control2.x - seg.control1.x)
    + 3 * u * u * (seg.end.x - seg.control2.x);
  const dy = 3 * mu * mu * (seg.control1.y - seg.start.y)
    + 6 * mu * u * (seg.control2.y - seg.control1.y)
    + 3 * u * u * (seg.end.y - seg.control2.y);
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function _polyBezierPoint(nodes, t) {
  const clamped = _clamp(t);
  if (!Array.isArray(nodes) || nodes.length < 2) return null;
  const segments = nodes.length - 1;
  const scaled = clamped * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const localT = scaled - index;
  const point = _polyBezierSegmentPoint(nodes[index], nodes[index + 1], localT);
  return { x: point.x, y: point.y, t: clamped };
}

// Convert a placed-point curve into smooth poly-bezier nodes. Handles are
// derived from each point's neighbours (the Catmull-Rom to Bezier conversion),
// so the converted curve starts out matching the auto-smoothed look and the
// user only tweaks from there.
function _pointsToNodes(points) {
  const list = (points ?? []).map(point => ({ x: _clamp(point.x), y: _clamp(point.y) }));
  const n = list.length;
  return list.map((point, i) => {
    const prev = list[Math.max(0, i - 1)];
    const next = list[Math.min(n - 1, i + 1)];
    const tx = (next.x - prev.x) / 6;
    const ty = (next.y - prev.y) / 6;
    return {
      x: point.x,
      y: point.y,
      hIn: { x: _clamp(point.x - tx), y: _clamp(point.y - ty) },
      hOut: { x: _clamp(point.x + tx), y: _clamp(point.y + ty) },
    };
  });
}

function _cloneCurve(curve) {
  return {
    ...curve,
    points: Array.isArray(curve.points) ? curve.points.map(point => ({ ...point })) : undefined,
    nodes: Array.isArray(curve.nodes)
      ? curve.nodes.map(node => ({
        x: node.x,
        y: node.y,
        hIn: node.hIn ? { ...node.hIn } : undefined,
        hOut: node.hOut ? { ...node.hOut } : undefined,
      }))
      : undefined,
    start: curve.start ? { ...curve.start } : undefined,
    control1: curve.control1 ? { ...curve.control1 } : undefined,
    control2: curve.control2 ? { ...curve.control2 } : undefined,
    end: curve.end ? { ...curve.end } : undefined,
  };
}

// Insert a new node at `point`, splitting whichever bezier segment is closest.
// Handles are aligned with the local tangent so the curve shape barely shifts.
function _insertNodeNearest(curve, point) {
  const nodes = curve?.nodes;
  if (!Array.isArray(nodes) || nodes.length < 2) return false;
  let bestSeg = 0;
  let bestT = 0.5;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length - 1; i++) {
    for (let s = 1; s <= 10; s++) {
      const localT = s / 11;
      const p = _polyBezierSegmentPoint(nodes[i], nodes[i + 1], localT);
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < bestDist) { bestDist = d; bestSeg = i; bestT = localT; }
    }
  }
  const tangent = _polyBezierSegmentTangent(nodes[bestSeg], nodes[bestSeg + 1], bestT);
  const len = 0.04;
  nodes.splice(bestSeg + 1, 0, {
    x: _clamp(point.x),
    y: _clamp(point.y),
    hIn: { x: _clamp(point.x - tangent.x * len), y: _clamp(point.y - tangent.y * len) },
    hOut: { x: _clamp(point.x + tangent.x * len), y: _clamp(point.y + tangent.y * len) },
  });
  return true;
}

function _catmullRomPoint(points, t) {
  const clamped = _clamp(t);
  if (!Array.isArray(points) || points.length < 2) return null;
  if (points.length === 2) {
    const a = points[0];
    const b = points[1];
    return {
      x: a.x + ((b.x - a.x) * clamped),
      y: a.y + ((b.y - a.y) * clamped),
      t: clamped,
    };
  }

  const segmentCount = points.length - 1;
  const scaled = clamped * segmentCount;
  const index = Math.min(segmentCount - 1, Math.floor(scaled));
  const localT = scaled - index;
  const p0 = points[Math.max(0, index - 1)];
  const p1 = points[index];
  const p2 = points[index + 1];
  const p3 = points[Math.min(points.length - 1, index + 2)];

  // Centripetal Catmull-Rom (alpha = 0.5). Distance-based knot spacing stops
  // the spline overshooting and bowing on unevenly spaced points, which is what
  // lifted the long hull segments off the model. Uniform spacing (the previous
  // form) only stayed tight near the clamped endpoints and evenly spaced runs.
  const alpha = 0.5;
  const knot = (ti, a, b) => ti + (Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha) || 1e-4);
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const tt = t1 + ((t2 - t1) * localT);

  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / ((tb - ta) || 1e-4);
    return { x: a.x + ((b.x - a.x) * w), y: a.y + ((b.y - a.y) * w) };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  const c = lerp(b1, b2, t1, t2);
  return { x: c.x, y: c.y, t: clamped };
}

export function sampleShipArrayCurve(canvasCurve, steps = ARRAY_CURVE_SAMPLE_STEPS) {
  if (!canvasCurve) return [];
  // A multi-point hull curve needs ~12 samples per segment to stay on the
  // spline. 48 total is plenty for a 4-point bezier, but across a 19-point
  // curve it is only ~2.5 per segment, so the charge path chord-cuts inward
  // and lifts off the model. Scale the floor with the segment count.
  const isNodes = Array.isArray(canvasCurve.nodes);
  const segments = isNodes
    ? Math.max(1, canvasCurve.nodes.length - 1)
    : Array.isArray(canvasCurve.points)
      ? Math.max(1, canvasCurve.points.length - 1)
      : 1;
  // Beziers need a touch more density per segment than Catmull-Rom to stay
  // smooth through the handles.
  const perSegment = isNodes ? 16 : 12;
  const count = Math.max(4, Math.floor(Number(steps) || ARRAY_CURVE_SAMPLE_STEPS), segments * perSegment);
  const samples = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const point = isNodes
      ? _polyBezierPoint(canvasCurve.nodes, t)
      : Array.isArray(canvasCurve.points)
        ? _catmullRomPoint(canvasCurve.points, t)
        : _cubicBezierPoint(canvasCurve, t);
    if (point) samples.push(point);
  }
  return samples;
}

function _arrayCurveSvgPathData(curve) {
  if (!curve) return "";
  if (Array.isArray(curve.nodes) && curve.nodes.length >= 2) {
    const nodes = curve.nodes;
    let d = `M ${nodes[0].x * 100} ${nodes[0].y * 100}`;
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const c1 = a.hOut ?? a;
      const c2 = b.hIn ?? b;
      d += ` C ${c1.x * 100} ${c1.y * 100}, ${c2.x * 100} ${c2.y * 100}, ${b.x * 100} ${b.y * 100}`;
    }
    return d;
  }
  if (Array.isArray(curve.points) && curve.points.length >= 2) {
    const steps = Math.max(12, (curve.points.length - 1) * 12);
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const point = _catmullRomPoint(curve.points, i / steps);
      if (point) points.push(point);
    }
    return points.map((point, index) => (
      `${index === 0 ? "M" : "L"} ${point.x * 100} ${point.y * 100}`
    )).join(" ");
  }
  return `M ${curve.start.x * 100} ${curve.start.y * 100} C ${curve.control1.x * 100} ${curve.control1.y * 100}, ${curve.control2.x * 100} ${curve.control2.y * 100}, ${curve.end.x * 100} ${curve.end.y * 100}`;
}

function _arrayCurveHandleRows(curve, curveIndex) {
  if (!curve) return [];
  if (Array.isArray(curve.nodes)) {
    const rows = [];
    curve.nodes.forEach((node, i) => {
      if (node.hOut) {
        rows.push({
          curveIndex,
          index: `${i}.hOut`,
          path: `M ${node.x * 100} ${node.y * 100} L ${node.hOut.x * 100} ${node.hOut.y * 100}`,
        });
      }
      if (node.hIn) {
        rows.push({
          curveIndex,
          index: `${i}.hIn`,
          path: `M ${node.x * 100} ${node.y * 100} L ${node.hIn.x * 100} ${node.hIn.y * 100}`,
        });
      }
    });
    return rows;
  }
  if (Array.isArray(curve.points)) return [];
  return [
    {
      curveIndex,
      index: 1,
      path: `M ${curve.start.x * 100} ${curve.start.y * 100} L ${curve.control1.x * 100} ${curve.control1.y * 100}`,
    },
    {
      curveIndex,
      index: 2,
      path: `M ${curve.end.x * 100} ${curve.end.y * 100} L ${curve.control2.x * 100} ${curve.control2.y * 100}`,
    },
  ];
}

function _arrayCurveMarkerRows(curve, curveIndex) {
  if (Array.isArray(curve?.nodes) && curve.nodes.length >= 2) {
    const rows = [];
    curve.nodes.forEach((node, i) => {
      rows.push({ point: node, pointKey: `nodes.${i}.anchor`, label: String(i + 1), isControl: false });
      if (node.hOut) rows.push({ point: node.hOut, pointKey: `nodes.${i}.hOut`, label: "", isControl: true });
      if (node.hIn) rows.push({ point: node.hIn, pointKey: `nodes.${i}.hIn`, label: "", isControl: true });
    });
    return rows.filter(row => row.point).map(row => ({
      curveIndex,
      pointKey: row.pointKey,
      label: row.label,
      isControl: row.isControl,
      left: `${row.point.x * 100}%`,
      top: `${row.point.y * 100}%`,
      coords: `${row.point.x.toFixed(3)}, ${row.point.y.toFixed(3)}`,
    }));
  }
  const pointRows = Array.isArray(curve?.points) && curve.points.length >= 2
    ? curve.points.map((point, pointIndex) => ({
      point,
      pointKey: `points.${pointIndex}`,
      label: String(pointIndex + 1),
      isControl: false,
    }))
    : [
      { point: curve.start, pointKey: "start", label: "S", isControl: false },
      { point: curve.control1, pointKey: "control1", label: "C1", isControl: true },
      { point: curve.control2, pointKey: "control2", label: "C2", isControl: true },
      { point: curve.end, pointKey: "end", label: "E", isControl: false },
    ];

  return pointRows.filter(row => row.point).map(row => ({
    curveIndex,
    pointKey: row.pointKey,
    label: row.label,
    isControl: row.isControl,
    left: `${row.point.x * 100}%`,
    top: `${row.point.y * 100}%`,
    coords: `${row.point.x.toFixed(3)}, ${row.point.y.toFixed(3)}`,
  }));
}

export function getClosestShipArrayCurveMatch(token, weapon, targetPoint, steps = ARRAY_CURVE_SAMPLE_STEPS, settingsOverride = null, options = {}) {
  if (!token || !weapon || !targetPoint || !_isArrayWeapon(weapon)) return null;
  const curves = getShipArrayCurves(token, weapon);
  if (!curves.length) return null;
  const applySourceOffset = options.applySourceOffset !== false;
  const settings = applySourceOffset ? getShipWeaponVfxSettings(token, weapon, settingsOverride) : null;
  const localDelta = applySourceOffset
    ? shipLocalOffsetToCanvasDelta(token, settings.sourceOffset)
    : { x: 0, y: 0 };

  let best = null;
  for (const curve of curves) {
    const rawCanvasCurve = tokenArrayCurveToCanvasCurve(token, curve);
    const localCanvasCurve = _offsetCanvasCurve(rawCanvasCurve, localDelta);
    const samples = sampleShipArrayCurve(localCanvasCurve, steps)
      .map(sample => {
        if (!applySourceOffset) return sample;
        const adaptiveDelta = adaptiveSourceOffsetToCanvasDelta(sample, targetPoint, settings.sourceOffset);
        return {
          ...sample,
          x: sample.x + adaptiveDelta.x,
          y: sample.y + adaptiveDelta.y,
        };
      });
    const canvasCurve = samples.length >= 2
      ? { points: samples, start: samples[0], end: samples[samples.length - 1] }
      : localCanvasCurve;
    for (const sample of samples) {
      const distance = Math.hypot(sample.x - targetPoint.x, sample.y - targetPoint.y);
      if (!best || distance < best.distance) {
        best = {
          curve,
          canvasCurve,
          samples,
          point: sample,
          t: sample.t,
          distance,
        };
      }
    }
  }
  return best;
}

export function getClosestShipArrayCurvePoint(token, weapon, targetPoint, steps = ARRAY_CURVE_SAMPLE_STEPS, settingsOverride = null, options = {}) {
  return getClosestShipArrayCurveMatch(token, weapon, targetPoint, steps, settingsOverride, options)?.point ?? null;
}

export function getShipHitLocationAnchors(actorOrToken, systemKey) {
  const normalizedSystem = _normalizeSystemKey(systemKey);
  return (getShipVfxAnchors(actorOrToken).anchors.hitLocations ?? [])
    .filter(anchor => anchor.systemKey === normalizedSystem);
}

export function getShipHitLocationPoints(token, systemKey) {
  return getShipHitLocationAnchors(token, systemKey)
    .map(anchor => tokenAnchorToCanvasPoint(token, anchor))
    .filter(Boolean);
}

export function getShipHitPolygons(actorOrToken, systemKey) {
  const normalizedSystem = _normalizeSystemKey(systemKey);
  return (getShipVfxAnchors(actorOrToken).anchors.hitPolygons ?? [])
    .filter(zone => zone.systemKey === normalizedSystem);
}

// Sample a random canvas-space hit point inside one of the system's polygon
// zones. Larger zones soak up proportionally more hits. Sampling happens in
// normalized image space and is then mapped through the same anchor transform
// as point anchors, so rotation / flip / texture fit all behave identically.
export function getShipHitPolygonPointForShot(token, systemKey) {
  const polygons = getShipHitPolygons(token, systemKey);
  if (!polygons.length) return null;
  const zone = _pickHitPolygonWeightedByArea(polygons);
  const sample = _randomPointInPolygon(zone.points);
  return tokenAnchorToCanvasPoint(token, sample);
}

export function getShipHitLocationPointForShot(token, systemKey, referencePoint = null, shotIndex = 0) {
  // Polygon zones win when present: every shot lands somewhere new inside the
  // drawn area. Legacy point anchors keep working for ships without zones.
  const polygonPoint = getShipHitPolygonPointForShot(token, systemKey);
  if (polygonPoint) return polygonPoint;

  const points = getShipHitLocationPoints(token, systemKey);
  if (!points.length) return null;
  if (points.length === 1) return points[0];

  if (referencePoint) {
    points.sort((a, b) => (
      Math.hypot(a.x - referencePoint.x, a.y - referencePoint.y)
      - Math.hypot(b.x - referencePoint.x, b.y - referencePoint.y)
    ));
    return points[Math.abs(shotIndex) % points.length] ?? points[0];
  }

  return points[Math.floor(Math.random() * points.length)] ?? points[0];
}

export function tokenTextureSource(tokenOrActor) {
  const actor = _resolveActor(tokenOrActor);
  return tokenOrActor?.document?.texture?.src
    ?? tokenOrActor?.texture?.src
    ?? tokenOrActor?.document?.img
    ?? actor?.prototypeToken?.texture?.src
    ?? actor?.img
    ?? null;
}

// Animated tokens use video textures (webm/mp4/…). Foundry plays them fine, but
// an <img> and `new Image()` can't decode them, so the preview and alpha sampling
// must branch on the source type.
export function _isVideoTextureSrc(src) {
  if (!src) return false;
  const clean = String(src).split("?")[0].split("#")[0];
  const ext = clean.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  const vidConst = globalThis.CONST?.VIDEO_FILE_EXTENSIONS;
  if (vidConst && typeof vidConst === "object") {
    if (ext in vidConst) return true;
    if (Object.values(vidConst).includes(ext)) return true;
  }
  return /^(webm|mp4|m4v|ogv|ogg|mov)$/.test(ext);
}

export async function getTokenAlphaMask(src) {
  if (!src) return null;
  if (TOKEN_ALPHA_MASK_CACHE.has(src)) return TOKEN_ALPHA_MASK_CACHE.get(src);

  const sampleAlpha = (source, naturalWidth, naturalHeight, resolve) => {
    try {
      if (!naturalWidth || !naturalHeight) {
        resolve(null);
        return;
      }

      const scale = Math.min(1, TOKEN_ALPHA_MASK_MAX_SIZE / Math.max(naturalWidth, naturalHeight));
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      const canvasEl = document.createElement("canvas");
      canvasEl.width = width;
      canvasEl.height = height;
      const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(source, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      const opaque = [];
      const opaqueSet = new Set();
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[((y * width + x) * 4) + 3] >= TOKEN_ALPHA_THRESHOLD) {
            opaque.push({ x, y });
            opaqueSet.add(y * width + x);
          }
        }
      }
      resolve(opaque.length ? { width, height, opaque, opaqueSet } : null);
    } catch (err) {
      console.warn("STA2e Toolkit | Could not sample token alpha for ship VFX anchors:", err);
      resolve(null);
    }
  };

  const maskPromise = new Promise(resolve => {
    if (_isVideoTextureSrc(src)) {
      let video;
      try {
        video = document.createElement("video");
      } catch {
        resolve(null);
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        sampleAlpha(video, video.videoWidth, video.videoHeight, resolve);
      };

      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.onloadeddata = finish;
      video.onseeked = finish;
      video.onerror = () => { if (!settled) { settled = true; resolve(null); } };
      video.src = src;
      try { video.currentTime = 0; } catch { /* seek unsupported, loadeddata covers it */ }
      return;
    }

    let img;
    try {
      img = new Image();
    } catch {
      resolve(null);
      return;
    }

    img.crossOrigin = "anonymous";
    img.onload = () => sampleAlpha(img, img.naturalWidth || img.width, img.naturalHeight || img.height, resolve);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  TOKEN_ALPHA_MASK_CACHE.set(src, maskPromise);
  return maskPromise;
}

export async function isTexturePointOpaque(src, x, y) {
  const mask = await getTokenAlphaMask(src);
  if (!mask) return null;
  const px = _clamp(Math.floor(Number(x) * mask.width), 0, mask.width - 1);
  const py = _clamp(Math.floor(Number(y) * mask.height), 0, mask.height - 1);
  return mask.opaqueSet?.has(py * mask.width + px) ?? false;
}

// Natural pixel size of a placed token's image, read from the loaded texture.
function _tokenTextureNatural(token) {
  const tex = token?.texture ?? token?.mesh?.texture ?? null;
  const w = Number(tex?.width) || Number(tex?.baseTexture?.width)
    || Number(tex?.source?.width) || Number(tex?.source?.pixelWidth) || 0;
  const h = Number(tex?.height) || Number(tex?.baseTexture?.height)
    || Number(tex?.source?.height) || Number(tex?.source?.pixelHeight) || 0;
  return w > 0 && h > 0 ? { w, h } : null;
}

// How large the image is actually drawn inside the token box for a given
// Foundry `texture.fit` mode. The image is centered, so paired with the 0.5
// anchor this lets editor-normalized (image-space) coords land on the real
// hull instead of being smeared across the whole token rectangle.
function _fitDrawSize(fit, boxW, boxH, natW, natH) {
  const texAspect = natW / natH;
  const boxAspect = boxW / boxH;
  switch (fit) {
    case "fill":
      return { w: boxW, h: boxH };
    case "width":
      return { w: boxW, h: boxW / texAspect };
    case "height":
      return { w: boxH * texAspect, h: boxH };
    case "cover":
      return texAspect > boxAspect ? { w: boxH * texAspect, h: boxH } : { w: boxW, h: boxW / texAspect };
    case "contain":
    default:
      return texAspect > boxAspect ? { w: boxW, h: boxW / texAspect } : { w: boxH * texAspect, h: boxH };
  }
}

export function tokenAnchorToCanvasPoint(token, anchor) {
  const normalized = _normalizeAnchor(anchor);
  if (!token || !normalized) return null;

  const center = _tokenCenter(token);
  const doc = token?.document ?? token;
  const texture = doc?.texture ?? {};
  const anchorX = Number(texture.anchorX ?? 0.5);
  const anchorY = Number(texture.anchorY ?? 0.5);
  const scaleX = Number(texture.scaleX ?? 1) || 1;
  const scaleY = Number(texture.scaleY ?? 1) || 1;
  const signX = scaleX < 0 ? -1 : 1;
  const signY = scaleY < 0 ? -1 : 1;
  const { width, height } = _tokenDimensions(token);
  // The editor places points relative to the image; Foundry draws that image
  // into the token box per `texture.fit` (default "contain"), preserving the
  // image aspect and centering it. Map into that drawn rectangle so the canvas
  // curve matches the editor. Falls back to the full box if dims are unknown.
  const natural = _tokenTextureNatural(token);
  const draw = natural
    ? _fitDrawSize(String(texture.fit ?? "contain"), width, height, natural.w, natural.h)
    : { w: width, h: height };
  const rotation = Number(doc?.rotation ?? token?.rotation ?? 0) * (Math.PI / 180);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = (normalized.x - anchorX) * draw.w * Math.abs(scaleX) * signX;
  const localY = (normalized.y - anchorY) * draw.h * Math.abs(scaleY) * signY;
  const offsetX = localX * cos - localY * sin;
  const offsetY = localX * sin + localY * cos;

  return {
    x: center.x + offsetX,
    y: center.y + offsetY,
  };
}

async function _saveShipVfxAnchors(actor, data) {
  const normalized = normalizeShipVfxAnchors(data);
  await actor.setFlag(MODULE, SHIP_VFX_ANCHORS_FLAG, normalized);
  return normalized;
}

export class ShipVfxAnchorEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sta2e-ship-vfx-anchor-editor",
    tag: "div",
    window: { title: "STA2e - Ship VFX Anchors", resizable: true },
    position: { width: 520, height: 620 },
    actions: {
      save: ShipVfxAnchorEditor._onSave,
      clear: ShipVfxAnchorEditor._onClear,
      preview: ShipVfxAnchorEditor._onPreview,
      export: ShipVfxAnchorEditor._onExport,
      import: ShipVfxAnchorEditor._onImport,
      close: ShipVfxAnchorEditor._onClose,
    },
  };

  static PARTS = {
    panel: { template: "modules/sta2e-toolkit/templates/ship-vfx-anchors.hbs" },
  };

  constructor(actorOrToken, options = {}) {
    super(options);
    this.actor = _resolveActor(actorOrToken);
    this.textureSrc = tokenTextureSource(actorOrToken) ?? tokenTextureSource(this.actor) ?? "";
    const saved = getShipVfxAnchors(this.actor);
    this._anchors = {
      ...saved,
      textureSrc: saved.textureSrc || this.textureSrc,
    };
    this._opaqueState = null;
    this._activeTab = "tractor";
    this._activeHitSystem = "structure";
    this._activePlacementMode = "points";
    this._selectedEmitterIndex = 0;
    this._pendingCurvePoints = [];
    this._pendingZonePoints = [];
    this._autoPreview = false;
    this._previewTimer = null;
    this._previewSerial = 0;
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
  }

  _shipWeapons() {
    return Array.from(this.actor?.items ?? []).filter(item => item.type === "starshipweapon2e");
  }

  _weaponForTab(tabId = this._activeTab) {
    if (!String(tabId).startsWith("weapon:")) return null;
    return this._shipWeapons().find(weapon => _tabIdForWeapon(weapon) === tabId) ?? null;
  }

  _resolveActiveTab() {
    if (this._activeTab === "tractor") return "tractor";
    if (this._activeTab === "hitLocations") return "hitLocations";
    if (this._activeTab === "engineImpulse" || this._activeTab === "engineWarp") return this._activeTab;
    if (this._weaponForTab(this._activeTab)) return this._activeTab;
    this._activeTab = "tractor";
    return this._activeTab;
  }

  _isEngineTab() {
    const tab = this._resolveActiveTab();
    return tab === "engineImpulse" || tab === "engineWarp";
  }

  _activeEngineKind() {
    if (this._resolveActiveTab() === "engineWarp") return "warp";
    if (this._resolveActiveTab() === "engineImpulse") return "impulse";
    return null;
  }

  _activeTabLabel() {
    if (this._resolveActiveTab() === "tractor") return "Tractor";
    if (this._resolveActiveTab() === "hitLocations") return `${_systemLabel(this._activeHitSystem)} Hit Location`;
    if (this._resolveActiveTab() === "engineImpulse") return "Impulse Trail";
    if (this._resolveActiveTab() === "engineWarp") return "Warp Trail";
    return this._weaponForTab()?.name ?? "Weapon";
  }

  _isActiveArrayWeaponTab() {
    const weapon = this._weaponForTab();
    return !!weapon && _isArrayWeapon(weapon);
  }

  _activeWeaponSettings() {
    const weapon = this._weaponForTab();
    return weapon ? getShipWeaponVfxSettingsFromData(this._anchors, weapon) : null;
  }

  _setActiveWeaponSettings(settings) {
    const weapon = this._weaponForTab();
    if (!weapon) return;
    const normalized = normalizeShipWeaponVfxSetting(settings, weapon);
    const otherSettings = (this._anchors.settings?.weaponVfx ?? [])
      .filter(row => !_weaponMatchesEmitter(row, weapon));
    this._anchors = normalizeShipVfxAnchors({
      ...this._anchors,
      textureSrc: this.textureSrc,
      settings: {
        ...(this._anchors.settings ?? {}),
        weaponVfx: [...otherSettings, normalized],
      },
    });
  }

  _activeShieldImpactSettings() {
    return normalizeShipShieldImpactSettings(this._anchors.settings?.shieldImpact);
  }

  _setShieldImpactSettings(settings) {
    this._anchors = normalizeShipVfxAnchors({
      ...this._anchors,
      textureSrc: this.textureSrc,
      settings: {
        ...(this._anchors.settings ?? {}),
        shieldImpact: normalizeShipShieldImpactSettings(settings),
      },
    });
  }

  _chargeRows(settings) {
    if (!settings) return [];
    const c = settings.charge;
    return [
      { key: "hitDuration", label: "Hit Duration", type: "number", min: 80, max: 5000, step: 20, value: c.hitDuration },
      { key: "missDuration", label: "Miss Duration", type: "number", min: 80, max: 5000, step: 20, value: c.missDuration },
      { key: "colorOverride", label: "Color Override", type: "text", value: c.colorOverride, placeholder: "#ff9a33 or blank", isColor: true, pickerValue: c.colorOverride || "#ff9a33" },
      { key: "coreColorOverride", label: "Core Override", type: "text", value: c.coreColorOverride, placeholder: "#fff2c0 or blank", isColor: true, pickerValue: c.coreColorOverride || "#fff2c0" },
      { key: "orbGlowRadius", label: "Orb Glow Radius", type: "number", min: 1, max: 120, step: 1, value: c.orbGlowRadius },
      { key: "orbGlowAlpha", label: "Orb Glow Alpha", type: "number", min: 0, max: 1, step: 0.01, value: c.orbGlowAlpha },
      { key: "orbInnerRadius", label: "Orb Inner Radius", type: "number", min: 1, max: 120, step: 1, value: c.orbInnerRadius },
      { key: "orbInnerAlpha", label: "Orb Inner Alpha", type: "number", min: 0, max: 1, step: 0.01, value: c.orbInnerAlpha },
      { key: "coreRadius", label: "Core Radius", type: "number", min: 1, max: 80, step: 1, value: c.coreRadius },
      { key: "coreAlpha", label: "Core Alpha", type: "number", min: 0, max: 1, step: 0.01, value: c.coreAlpha },
      { key: "ringRadius", label: "Ring Radius", type: "number", min: 1, max: 120, step: 1, value: c.ringRadius },
      { key: "ringWidth", label: "Ring Width", type: "number", min: 0, max: 40, step: 0.5, value: c.ringWidth },
      { key: "ringAlpha", label: "Ring Alpha", type: "number", min: 0, max: 1, step: 0.01, value: c.ringAlpha },
      { key: "trailLength", label: "Trail Length", type: "number", min: 0.01, max: 1, step: 0.01, value: c.trailLength },
      { key: "trailSteps", label: "Trail Steps", type: "number", min: 2, max: 40, step: 1, value: c.trailSteps },
      { key: "trailGlowWidth", label: "Trail Glow Width", type: "number", min: 0, max: 80, step: 0.5, value: c.trailGlowWidth },
      { key: "trailGlowAlphaStart", label: "Trail Glow Alpha A", type: "number", min: 0, max: 1, step: 0.01, value: c.trailGlowAlphaStart },
      { key: "trailGlowAlphaEnd", label: "Trail Glow Alpha B", type: "number", min: 0, max: 1, step: 0.01, value: c.trailGlowAlphaEnd },
      { key: "trailCoreWidth", label: "Trail Core Width", type: "number", min: 0, max: 60, step: 0.5, value: c.trailCoreWidth },
      { key: "trailCoreAlphaStart", label: "Trail Core Alpha A", type: "number", min: 0, max: 1, step: 0.01, value: c.trailCoreAlphaStart },
      { key: "trailCoreAlphaEnd", label: "Trail Core Alpha B", type: "number", min: 0, max: 1, step: 0.01, value: c.trailCoreAlphaEnd },
      { key: "flashFillRadius", label: "Flash Fill Radius", type: "number", min: 0, max: 160, step: 1, value: c.flashFillRadius },
      { key: "flashFillAlpha", label: "Flash Fill Alpha", type: "number", min: 0, max: 1, step: 0.01, value: c.flashFillAlpha },
      { key: "flashRingRadius", label: "Flash Ring Radius", type: "number", min: 0, max: 200, step: 1, value: c.flashRingRadius },
      { key: "flashRingWidth", label: "Flash Ring Width", type: "number", min: 0, max: 60, step: 0.5, value: c.flashRingWidth },
      { key: "flashRingAlpha", label: "Flash Ring Alpha", type: "number", min: 0, max: 1, step: 0.01, value: c.flashRingAlpha },
      { key: "fadeDuration", label: "Fade Duration", type: "number", min: 20, max: 3000, step: 20, value: c.fadeDuration },
      { key: "flashFadeDuration", label: "Flash Fade", type: "number", min: 20, max: 3000, step: 20, value: c.flashFadeDuration },
      { key: "cleanupDelay", label: "Cleanup Delay", type: "number", min: 0, max: 2000, step: 20, value: c.cleanupDelay },
    ];
  }

  _previewSourceToken() {
    const tokens = Array.from(canvas?.tokens?.placeables ?? []);
    return (canvas?.tokens?.controlled ?? []).find(token => _resolveActor(token)?.id === this.actor?.id)
      ?? tokens.find(token => _resolveActor(token)?.id === this.actor?.id)
      ?? null;
  }

  _previewTargetPoint(sourceToken) {
    const target = Array.from(game.user?.targets ?? [])[0] ?? null;
    if (target?.center) return { point: { x: target.center.x, y: target.center.y }, label: target.name ?? "Targeted token" };
    const center = _tokenCenter(sourceToken);
    const { width, height } = _tokenDimensions(sourceToken);
    const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
    const rotation = Number(sourceToken?.document?.rotation ?? sourceToken?.rotation ?? 0) * (Math.PI / 180);
    const distance = Math.max(width, height, gridSize) + gridSize * 3;
    return {
      point: {
        x: center.x + Math.cos(rotation) * distance,
        y: center.y + Math.sin(rotation) * distance,
      },
      label: "Fallback endpoint",
    };
  }

  _readWeaponSettingsFromForm() {
    const weapon = this._weaponForTab();
    if (!weapon || !this.element) return null;
    const current = this._activeWeaponSettings() ?? getDefaultShipWeaponVfxSettings(weapon);
    const currentShieldImpact = this._activeShieldImpactSettings();
    this._setShieldImpactSettings({
      colorPreset: this.element.querySelector('[data-shield-impact-setting="colorPreset"]')?.value ?? currentShieldImpact.colorPreset,
      customColor: this.element.querySelector('[data-shield-impact-setting="customColor"]')?.value ?? currentShieldImpact.customColor,
    });
    const sourceOffset = {
      x: _number(this.element.querySelector('[data-vfx-setting="sourceOffset.x"]')?.value, current.sourceOffset.x),
      y: _number(this.element.querySelector('[data-vfx-setting="sourceOffset.y"]')?.value, current.sourceOffset.y),
      adaptiveAlong: _number(this.element.querySelector('[data-vfx-setting="sourceOffset.adaptiveAlong"]')?.value, current.sourceOffset.adaptiveAlong),
      adaptiveSide: _number(this.element.querySelector('[data-vfx-setting="sourceOffset.adaptiveSide"]')?.value, current.sourceOffset.adaptiveSide),
      space: "shipLocal",
    };
    const phaserEra = _normalizePhaserEra(
      this.element.querySelector('[data-vfx-setting="phaserEra"]')?.value ?? current.phaserEra
    );
    const charge = { ...current.charge };
    this.element.querySelectorAll("[data-charge-setting]").forEach(input => {
      const key = input.dataset.chargeSetting;
      if (!key) return;
      if (key === "easing" || key === "blendMode" || key === "colorOverride" || key === "coreColorOverride") charge[key] = input.value;
      else charge[key] = _number(input.value, charge[key]);
    });
    const settings = normalizeShipWeaponVfxSetting({
      ...current,
      phaserEra,
      sourceOffset,
      charge,
    }, weapon);
    this._setActiveWeaponSettings(settings);
    return settings;
  }

  _scheduleAutoPreview() {
    if (!this._autoPreview) return;
    window.clearTimeout(this._previewTimer);
    this._previewTimer = window.setTimeout(() => this._previewActive({ silent: true }), 450);
  }

  async _previewActive({ silent = false } = {}) {
    if (this._isEngineTab()) return this._previewActiveEngine({ silent });
    return this._previewActiveWeapon({ silent });
  }

  async _previewActiveEngine({ silent = false } = {}) {
    const kind = this._activeEngineKind();
    if (!kind) return;
    const sourceToken = this._previewSourceToken();
    if (!sourceToken) {
      if (!silent) ui.notifications.warn("STA2e Toolkit: Select or place a token for this ship to preview the engine trail.");
      return;
    }
    this._readEngineSettingsFromForm();
    this._readEmitterArcFromForm();
    const emitters = this._activeEmitters();
    if (!emitters.length) {
      if (!silent) ui.notifications.warn(`STA2e Toolkit: Place at least one ${kind} emitter point to preview.`);
      return;
    }
    const settings = this._activeEngineTrailSettings();
    try {
      const { previewEngineTrail } = await import("./engine-trail-vfx.js");
      await previewEngineTrail(sourceToken, kind, settings, emitters);
    } catch (err) {
      console.warn("STA2e Toolkit | Engine trail preview failed:", err);
      if (!silent) ui.notifications.warn("STA2e Toolkit: Engine trail preview failed. See console for details.");
    }
  }

  async _previewActiveWeapon({ silent = false } = {}) {
    const weapon = this._weaponForTab();
    if (!weapon) return;
    const sourceToken = this._previewSourceToken();
    if (!sourceToken) {
      if (!silent) ui.notifications.warn("STA2e Toolkit: Select or place a token for this ship to preview weapon VFX.");
      return;
    }
    const settings = this._readWeaponSettingsFromForm() ?? this._activeWeaponSettings();
    const target = this._previewTargetPoint(sourceToken);
    // The fired animation reads curves from the actor flag, while the editor
    // draws from in-memory edits. Persist first so the preview follows exactly
    // the handle curve on screen instead of the last explicitly-saved one.
    try {
      if (game.user?.isGM && this.actor) {
        this._anchors = await _saveShipVfxAnchors(this.actor, { ...this._anchors, textureSrc: this.textureSrc });
      }
    } catch (err) {
      console.warn("STA2e Toolkit | Could not persist anchors before preview:", err);
    }
    const serial = ++this._previewSerial;
    try {
      const { previewShipWeaponAnimation } = await import("./weapon-configs.js");
      if (serial !== this._previewSerial) return;
      await previewShipWeaponAnimation(sourceToken, weapon, target.point, {
        vfxSettings: settings,
        beamDuration: this._isActiveArrayWeaponTab() ? 520 : 420,
      });
    } catch (err) {
      console.warn("STA2e Toolkit | Weapon VFX preview failed:", err);
      if (!silent) ui.notifications.warn("STA2e Toolkit: Weapon VFX preview failed. See console for details.");
    }
  }

  _activeCurves() {
    const weapon = this._weaponForTab();
    if (!weapon || !_isArrayWeapon(weapon)) return [];
    return (this._anchors.anchors.arrayCurves ?? []).filter(curve => _weaponMatchesEmitter(curve, weapon));
  }

  _setActiveCurves(curves) {
    const weapon = this._weaponForTab();
    if (!weapon || !_isArrayWeapon(weapon)) return;
    const otherCurves = (this._anchors.anchors.arrayCurves ?? [])
      .filter(curve => !_weaponMatchesEmitter(curve, weapon));
    this._anchors = normalizeShipVfxAnchors({
      ...this._anchors,
      textureSrc: this.textureSrc,
      anchors: {
        ...this._anchors.anchors,
        arrayCurves: [
          ...otherCurves,
          ...curves.map((curve, index) => ({
            ...curve,
            weaponId: _weaponId(weapon),
            weaponName: _weaponName(weapon),
            weaponImg: _weaponImg(weapon),
            label: curve.label || `${_weaponName(weapon)} array curve ${index + 1}`,
          })),
        ],
      },
    });
  }

  _activeEmitters() {
    if (this._resolveActiveTab() === "tractor") return this._anchors.anchors.tractorEmitters ?? [];
    if (this._resolveActiveTab() === "hitLocations") {
      return (this._anchors.anchors.hitLocations ?? [])
        .filter(anchor => anchor.systemKey === this._activeHitSystem);
    }
    if (this._isEngineTab()) {
      const kind = this._activeEngineKind();
      return (this._anchors.anchors.engineEmitters ?? []).filter(anchor => anchor.kind === kind);
    }
    const weapon = this._weaponForTab();
    return (this._anchors.anchors.weaponEmitters ?? []).filter(anchor => _weaponMatchesEmitter(anchor, weapon));
  }

  _setActiveEmitters(emitters) {
    this._selectedEmitterIndex = Math.max(0, Math.min(
      Number.isInteger(this._selectedEmitterIndex) ? this._selectedEmitterIndex : 0,
      Math.max(0, emitters.length - 1),
    ));

    if (this._resolveActiveTab() === "tractor") {
      this._anchors = normalizeShipVfxAnchors({
        ...this._anchors,
        textureSrc: this.textureSrc,
        anchors: {
          ...this._anchors.anchors,
          tractorEmitters: emitters,
        },
      });
      return;
    }

    if (this._resolveActiveTab() === "hitLocations") {
      const otherHitLocations = (this._anchors.anchors.hitLocations ?? [])
        .filter(anchor => anchor.systemKey !== this._activeHitSystem);
      this._anchors = normalizeShipVfxAnchors({
        ...this._anchors,
        textureSrc: this.textureSrc,
        anchors: {
          ...this._anchors.anchors,
          hitLocations: [
            ...otherHitLocations,
            ...emitters.map((anchor, index) => ({
              ...anchor,
              systemKey: this._activeHitSystem,
              label: anchor.label || `${_systemLabel(this._activeHitSystem)} hit location ${index + 1}`,
            })),
          ],
        },
      });
      return;
    }

    if (this._isEngineTab()) {
      const kind = this._activeEngineKind();
      const otherEngineEmitters = (this._anchors.anchors.engineEmitters ?? [])
        .filter(anchor => anchor.kind !== kind);
      this._anchors = normalizeShipVfxAnchors({
        ...this._anchors,
        textureSrc: this.textureSrc,
        anchors: {
          ...this._anchors.anchors,
          engineEmitters: [
            ...otherEngineEmitters,
            ...emitters.map((anchor, index) => ({
              ...anchor,
              kind,
              label: anchor.label || `${kind === "warp" ? "Warp" : "Impulse"} emitter ${index + 1}`,
            })),
          ],
        },
      });
      return;
    }

    const weapon = this._weaponForTab();
    if (!weapon) return;
    const otherWeaponEmitters = (this._anchors.anchors.weaponEmitters ?? [])
      .filter(anchor => !_weaponMatchesEmitter(anchor, weapon));
    this._anchors = normalizeShipVfxAnchors({
      ...this._anchors,
      textureSrc: this.textureSrc,
      anchors: {
        ...this._anchors.anchors,
        weaponEmitters: [
          ...otherWeaponEmitters,
          ...emitters.map((anchor, index) => ({
            ...anchor,
            weaponId: _weaponId(weapon),
            weaponName: _weaponName(weapon),
            weaponImg: _weaponImg(weapon),
            label: anchor.label || `${_weaponName(weapon)} emitter ${index + 1}`,
          })),
        ],
      },
    });
  }

  // ── Hit zone polygons (editor state) ──────────────────────────────────────
  _activeZones() {
    if (this._resolveActiveTab() !== "hitLocations") return [];
    return (this._anchors.anchors.hitPolygons ?? [])
      .filter(zone => zone.systemKey === this._activeHitSystem);
  }

  _setActiveZones(zones) {
    if (this._resolveActiveTab() !== "hitLocations") return;
    const otherZones = (this._anchors.anchors.hitPolygons ?? [])
      .filter(zone => zone.systemKey !== this._activeHitSystem);
    this._anchors = normalizeShipVfxAnchors({
      ...this._anchors,
      textureSrc: this.textureSrc,
      anchors: {
        ...this._anchors.anchors,
        hitPolygons: [
          ...otherZones,
          ...zones.map((zone, index) => ({
            ...zone,
            systemKey: this._activeHitSystem,
            label: zone.label || `${_systemLabel(this._activeHitSystem)} hit zone ${index + 1}`,
          })),
        ],
      },
    });
  }

  _cloneZone(zone) {
    return {
      ...zone,
      points: (zone.points ?? []).map(point => ({ ...point })),
    };
  }

  _zoneSvgPathData(points) {
    if (!Array.isArray(points) || points.length < 2) return "";
    return `${points.map((point, index) => (
      `${index === 0 ? "M" : "L"} ${point.x * 100} ${point.y * 100}`
    )).join(" ")} Z`;
  }

  _zoneContext(zones) {
    const color = _systemColor(this._activeHitSystem);
    return zones.map((zone, index) => ({
      ...zone,
      index,
      displayIndex: index + 1,
      color,
      path: this._zoneSvgPathData(zone.points),
      vertexMarkers: (zone.points ?? []).map((point, pointIndex) => ({
        zoneIndex: index,
        pointIndex,
        label: String(pointIndex + 1),
        color,
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        coords: `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`,
      })),
      coords: `${(zone.points ?? []).length} vertices`,
    }));
  }

  _pendingZoneContext() {
    const color = _systemColor(this._activeHitSystem);
    return this._pendingZonePoints.map((point, index) => ({
      ...point,
      index,
      label: String(index + 1),
      color,
      left: `${point.x * 100}%`,
      top: `${point.y * 100}%`,
      coords: `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`,
    }));
  }

  // Insert a vertex into whichever zone edge is closest to `point`.
  _insertZoneVertexNearest(point) {
    const zones = this._activeZones().map(zone => this._cloneZone(zone));
    let best = null;
    zones.forEach((zone, zoneIndex) => {
      const points = zone.points ?? [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const lengthSq = (abx * abx) + (aby * aby) || 1e-9;
        const t = _clamp(((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq);
        const px = a.x + abx * t;
        const py = a.y + aby * t;
        const distance = Math.hypot(point.x - px, point.y - py);
        if (!best || distance < best.distance) best = { zoneIndex, edgeIndex: i, distance };
      }
    });
    if (!best) return false;
    zones[best.zoneIndex].points.splice(best.edgeIndex + 1, 0, { x: point.x, y: point.y });
    this._setActiveZones(zones);
    return true;
  }

  _markerContext(emitters) {
    const isWeaponEmitterTab = !!this._weaponForTab() && !this._isActiveArrayWeaponTab();
    const isEngineTab = this._isEngineTab();
    const showFacingArrow = isWeaponEmitterTab || isEngineTab;
    const engineColor = isEngineTab
      ? resolveEngineTrailColorHex(this.actor, this._activeEngineKind(), this._activeEngineModeSettings())
      : null;
    const defaultFacing = isEngineTab ? DEFAULT_ENGINE_EMITTER_FACING_DEG : 0;
    const arcMin = isWeaponEmitterTab
      ? _emitterArcMinForWeaponImg(_weaponImg(this._weaponForTab()))
      : WEAPON_EMITTER_MIN_ARC_WIDTH_DEG;
    return emitters.map((anchor, index) => ({
      ...anchor,
      index,
      displayIndex: index + 1,
      left: `${anchor.x * 100}%`,
      top: `${anchor.y * 100}%`,
      coords: `${anchor.x.toFixed(3)}, ${anchor.y.toFixed(3)}`,
      systemLabel: anchor.systemKey ? _systemLabel(anchor.systemKey) : null,
      markerColor: anchor.systemKey ? _systemColor(anchor.systemKey) : (engineColor ?? "#33aaff"),
      selected: showFacingArrow && index === this._selectedEmitterIndex,
      showFacingArrow,
      showArcWidth: isWeaponEmitterTab,
      facingDeg: Math.round(_normalizeDegrees(anchor.facingDeg, isEngineTab ? defaultFacing : _defaultEmitterFacingDeg(anchor))),
      arcWidthDeg: _normalizeEmitterArcWidth(anchor.arcWidthDeg, arcMin),
      layerLabel: _normalizeEmitterLayer(anchor.layer) === "below" ? "Below" : "Above",
    }));
  }

  _selectedEmitter() {
    const emitters = this._activeEmitters();
    if (!emitters.length) return null;
    const index = Math.max(0, Math.min(this._selectedEmitterIndex, emitters.length - 1));
    this._selectedEmitterIndex = index;
    return { index, anchor: emitters[index] };
  }

  _activeEmitterArcControls() {
    const isWeaponEmitterTab = !!this._weaponForTab() && !this._isActiveArrayWeaponTab();
    const isEngineTab = this._isEngineTab();
    if (!isWeaponEmitterTab && !isEngineTab) return null;
    const selected = this._selectedEmitter();
    if (!selected?.anchor) return null;
    const layer = _normalizeEmitterLayer(selected.anchor.layer);
    const defaultFacing = isEngineTab ? DEFAULT_ENGINE_EMITTER_FACING_DEG : _defaultEmitterFacingDeg(selected.anchor);
    const minArcWidthDeg = isWeaponEmitterTab
      ? _emitterArcMinForWeaponImg(_weaponImg(this._weaponForTab()))
      : WEAPON_EMITTER_MIN_ARC_WIDTH_DEG;
    return {
      index: selected.index,
      displayIndex: selected.index + 1,
      facingDeg: Math.round(_normalizeDegrees(selected.anchor.facingDeg, defaultFacing)),
      arcWidthDeg: _normalizeEmitterArcWidth(selected.anchor.arcWidthDeg, minArcWidthDeg),
      minArcWidthDeg,
      showArcWidth: isWeaponEmitterTab,
      isEngine: isEngineTab,
      layer,
      layerAboveSelected: layer === "above",
      layerBelowSelected: layer === "below",
    };
  }

  _readEmitterArcFromForm() {
    const isWeaponEmitterTab = !!this._weaponForTab() && !this._isActiveArrayWeaponTab();
    const isEngineTab = this._isEngineTab();
    if ((!isWeaponEmitterTab && !isEngineTab) || !this.element) return null;
    const selected = this._selectedEmitter();
    if (!selected?.anchor) return null;
    const emitters = [...this._activeEmitters()];
    const current = emitters[selected.index];
    if (!current) return null;
    const facingDeg = this.element.querySelector('[data-emitter-setting="facingDeg"]')?.value ?? current.facingDeg;
    const layer = this.element.querySelector('[data-emitter-setting="layer"]')?.value ?? current.layer;
    if (isEngineTab) {
      emitters[selected.index] = _normalizeEngineEmitter({ ...current, facingDeg, layer });
    } else {
      const arcWidthDeg = this.element.querySelector('[data-emitter-setting="arcWidthDeg"]')?.value ?? current.arcWidthDeg;
      emitters[selected.index] = _normalizeWeaponEmitter({ ...current, facingDeg, arcWidthDeg, layer });
    }
    this._setActiveEmitters(emitters);
    return emitters[selected.index];
  }

  // ── Engine trail settings ─────────────────────────────────────────────────
  _activeEngineTrailSettings() {
    return normalizeShipEngineTrailSettings(this._anchors.settings?.engineTrail);
  }

  _activeEngineModeSettings() {
    const kind = this._activeEngineKind();
    if (!kind) return null;
    return this._activeEngineTrailSettings()[kind];
  }

  _setEngineTrailSettings(settings) {
    this._anchors = normalizeShipVfxAnchors({
      ...this._anchors,
      textureSrc: this.textureSrc,
      settings: {
        ...(this._anchors.settings ?? {}),
        engineTrail: normalizeShipEngineTrailSettings(settings),
      },
    });
  }

  _readEngineSettingsFromForm() {
    if (!this._isEngineTab() || !this.element) return null;
    const kind = this._activeEngineKind();
    const current = this._activeEngineTrailSettings();
    const mode = current[kind];
    const read = (key, fallback) => this.element.querySelector(`[data-engine-setting="${key}"]`)?.value ?? fallback;
    const enabledEl = this.element.querySelector('[data-engine-setting="enabled"]');
    const updatedMode = {
      colorMode: read("colorMode", mode.colorMode),
      customColor: read("customColor", mode.customColor),
      lengthPx: _number(read("lengthPx", mode.lengthPx), mode.lengthPx),
      width: _number(read("width", mode.width), mode.width),
      rate: _number(read("rate", mode.rate), mode.rate),
      alpha: _number(read("alpha", mode.alpha), mode.alpha),
      fade: _number(read("fade", mode.fade), mode.fade),
      blendMode: read("blendMode", mode.blendMode),
    };
    const next = {
      ...current,
      enabled: enabledEl ? enabledEl.checked === true : current.enabled,
      warpThreshold: _number(read("warpThreshold", current.warpThreshold), current.warpThreshold),
      [kind]: updatedMode,
    };
    this._setEngineTrailSettings(next);
    return this._activeEngineModeSettings();
  }

  _curveContext(curves) {
    return curves.map((curve, index) => {
      const points = Array.isArray(curve.nodes) && curve.nodes.length >= 2
        ? curve.nodes
        : Array.isArray(curve.points) && curve.points.length >= 2
          ? curve.points
          : [curve.start, curve.end].filter(Boolean);
      const start = points[0];
      const end = points[points.length - 1];
      const kind = Array.isArray(curve.nodes) ? "handle node" : "point";
      return {
        ...curve,
        index,
        displayIndex: index + 1,
        isNodes: Array.isArray(curve.nodes),
        path: _arrayCurveSvgPathData(curve),
        handles: _arrayCurveHandleRows(curve, index),
        pointMarkers: _arrayCurveMarkerRows(curve, index),
        pointCount: points.length,
        coords: start && end
          ? `${points.length} ${kind}(s): ${start.x.toFixed(3)}, ${start.y.toFixed(3)} -> ${end.x.toFixed(3)}, ${end.y.toFixed(3)}`
          : "Invalid curve",
      };
    });
  }

  _pendingCurveContext() {
    return this._pendingCurvePoints.map((point, index) => ({
      ...point,
      index,
      label: String(index + 1),
      isControl: false,
      left: `${point.x * 100}%`,
      top: `${point.y * 100}%`,
      coords: `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`,
    }));
  }

  _tabContext() {
    const tabs = [
      {
        id: "tractor",
        label: "Tractor",
        title: "Tractor emitter points",
        count: (this._anchors.anchors.tractorEmitters ?? []).length,
        active: this._resolveActiveTab() === "tractor",
      },
      {
        id: "hitLocations",
        label: "Hit Zones",
        title: "System hit zone polygons",
        count: (this._anchors.anchors.hitPolygons ?? []).length
          + (this._anchors.anchors.hitLocations ?? []).length,
        active: this._resolveActiveTab() === "hitLocations",
      },
      {
        id: "engineImpulse",
        label: "Impulse",
        title: "Impulse engine trail emitters",
        icon: "fas fa-rocket",
        count: (this._anchors.anchors.engineEmitters ?? []).filter(a => a.kind === "impulse").length,
        active: this._resolveActiveTab() === "engineImpulse",
      },
      {
        id: "engineWarp",
        label: "Warp",
        title: "Warp nacelle trail emitters",
        icon: "fas fa-forward",
        count: (this._anchors.anchors.engineEmitters ?? []).filter(a => a.kind === "warp").length,
        active: this._resolveActiveTab() === "engineWarp",
      },
    ];
    for (const weapon of this._shipWeapons()) {
      const id = _tabIdForWeapon(weapon);
      tabs.push({
        id,
        label: weapon.name,
        title: weapon.name,
        img: weapon.img ?? "",
        count: ((this._anchors.anchors.weaponEmitters ?? [])
          .filter(anchor => _weaponMatchesEmitter(anchor, weapon)).length)
          + ((_isArrayWeapon(weapon) ? (this._anchors.anchors.arrayCurves ?? [])
            .filter(curve => _weaponMatchesEmitter(curve, weapon)).length : 0)),
        active: this._resolveActiveTab() === id,
      });
    }
    return tabs;
  }

  async _prepareContext(_options) {
    const activeEmitters = this._activeEmitters();
    const activeCurves = this._activeCurves();
    const activeMarkers = this._markerContext(activeEmitters);
    const activeCurveRows = this._curveContext(activeCurves);
    const activeTabLabel = this._activeTabLabel();
    const isHitLocationsTab = this._resolveActiveTab() === "hitLocations";
    const isArrayWeaponTab = this._isActiveArrayWeaponTab();
    const activeWeapon = this._weaponForTab();
    const curveModeActive = isArrayWeaponTab && this._activePlacementMode === "curve";
    const pointModeActive = !curveModeActive;
    const activeWeaponSettings = this._activeWeaponSettings();
    const activeEmitterArcControls = this._activeEmitterArcControls();
    const previewSource = this._previewSourceToken();
    const previewTarget = previewSource ? this._previewTargetPoint(previewSource) : null;
    const pendingCurveMarkers = curveModeActive ? this._pendingCurveContext() : [];
    const nextCurvePointLabel = this._pendingCurvePoints.length < 2
      ? `curve point ${this._pendingCurvePoints.length + 1}`
      : `curve point ${this._pendingCurvePoints.length + 1} or finish`;
    const isEngineTab = this._isEngineTab();
    const engineKind = this._activeEngineKind();
    const activeEngineTrailSettings = isEngineTab ? this._activeEngineTrailSettings() : null;
    const activeEngineModeSettings = isEngineTab ? this._activeEngineModeSettings() : null;
    const resolvedEngineColor = isEngineTab
      ? resolveEngineTrailColorHex(this.actor, engineKind, activeEngineModeSettings)
      : null;
    const activePointKind = isHitLocationsTab ? "hit location" : "emitter";
    const activeZones = isHitLocationsTab ? this._activeZones() : [];
    const activeZoneRows = isHitLocationsTab ? this._zoneContext(activeZones) : [];
    const pendingZoneMarkers = isHitLocationsTab ? this._pendingZoneContext() : [];
    const pendingZonePath = this._pendingZonePoints.length >= 2
      ? this._zoneSvgPathData(this._pendingZonePoints)
      : "";

    return {
      actorName: this.actor?.name ?? "Unknown ship",
      textureSrc: this.textureSrc,
      hasTexture: !!this.textureSrc,
      isVideoTexture: _isVideoTextureSrc(this.textureSrc),
      tabs: this._tabContext(),
      activeTab: this._resolveActiveTab(),
      activeTabLabel,
      activeEmitterCount: activeEmitters.length,
      activeCurveCount: activeCurves.length,
      activePointKind,
      activeMarkers,
      hasActiveEmitters: activeEmitters.length > 0,
      activeCurves: activeCurveRows,
      hasActiveCurves: activeCurveRows.length > 0,
      isArrayWeaponTab,
      isWeaponTab: !!this._weaponForTab(),
      activeWeaponSettings,
      activeEmitterArcControls,
      showEmitterArcSettings: !!activeEmitterArcControls,
      isEngineTab,
      engineKind,
      engineKindLabel: engineKind === "warp" ? "Warp" : "Impulse",
      activeEngineTrailSettings,
      activeEngineModeSettings,
      resolvedEngineColor,
      enginePickerColor: activeEngineModeSettings?.customColor || resolvedEngineColor || "#ffffff",
      engineColorModeOptions: isEngineTab ? ENGINE_COLOR_MODES.map(value => ({
        value,
        label: value === "custom" ? "Custom Hex" : "Auto by Faction",
        selected: value === (activeEngineModeSettings?.colorMode ?? "auto"),
      })) : [],
      engineBlendOptions: isEngineTab ? ENGINE_BLEND_OPTIONS.map(value => ({
        value,
        label: value,
        selected: value === (activeEngineModeSettings?.blendMode ?? "add"),
      })) : [],
      activeShieldImpactSettings: this._activeShieldImpactSettings(),
      shieldColorOptions: SHIELD_COLOR_OPTIONS.map(option => ({
        ...option,
        selected: option.value === this._activeShieldImpactSettings().colorPreset,
      })),
      showPhaserEraSelector: _isEraPhaserWeapon(activeWeapon),
      phaserEraOptions: PHASER_ERA_OPTIONS.map(option => ({
        ...option,
        selected: option.value === (activeWeaponSettings?.phaserEra ?? ""),
      })),
      activeChargeRows: isArrayWeaponTab ? this._chargeRows(activeWeaponSettings) : [],
      chargeEasingOptions: CHARGE_EASING_OPTIONS.map(value => ({
        value,
        label: value,
        selected: activeWeaponSettings?.charge?.easing === value,
      })),
      chargeBlendOptions: CHARGE_BLEND_OPTIONS.map(value => ({
        value,
        label: value,
        selected: activeWeaponSettings?.charge?.blendMode === value,
      })),
      autoPreview: this._autoPreview,
      previewSourceName: previewSource?.name ?? "No ship token",
      previewTargetName: previewTarget?.label ?? "No preview target",
      curveModeActive,
      pointModeActive,
      pendingCurveMarkers,
      hasPendingCurveMarkers: pendingCurveMarkers.length > 0,
      pendingCurveCount: this._pendingCurvePoints.length,
      canFinishCurve: this._pendingCurvePoints.length >= 2,
      nextCurvePointLabel,
      isHitLocationsTab,
      hitSystemOptions: isHitLocationsTab ? SHIP_SYSTEMS.map(system => ({
        ...system,
        active: system.key === this._activeHitSystem,
        count: (this._anchors.anchors.hitPolygons ?? []).filter(zone => zone.systemKey === system.key).length
          + (this._anchors.anchors.hitLocations ?? []).filter(anchor => anchor.systemKey === system.key).length,
      })) : null,
      activeZones: activeZoneRows,
      hasActiveZones: activeZoneRows.length > 0,
      activeZoneCount: activeZoneRows.length,
      pendingZoneMarkers,
      hasPendingZoneMarkers: pendingZoneMarkers.length > 0,
      pendingZoneCount: this._pendingZonePoints.length,
      pendingZonePath,
      canFinishZone: this._pendingZonePoints.length >= 3,
      activeHitSystemColor: _systemColor(this._activeHitSystem),
      activeHitSystemLabel: _systemLabel(this._activeHitSystem),
      hasLegacyHitPoints: isHitLocationsTab && activeEmitters.length > 0,
      opaqueState: this._opaqueState,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    if (!el) return;

    const stage = el.querySelector("[data-anchor-stage]");
    const img = el.querySelector("[data-anchor-image]");
    const coords = el.querySelector("[data-anchor-coords]");
    const opacityStatus = el.querySelector("[data-anchor-opacity]");

    // ── Zoom & pan ────────────────────────────────────────────────────────────
    // The frame holds the image, the curve SVG and every marker, all positioned
    // in its local percentage space. Scaling the whole frame keeps the existing
    // click/drag math valid, so zoom is a pure presentation transform.
    const frame = el.querySelector(".sta2e-anchor-image-frame");
    const zoomLevel = el.querySelector("[data-zoom-level]");

    const applyZoom = () => {
      if (frame) frame.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
      if (zoomLevel) zoomLevel.textContent = `${Math.round(this._zoom * 100)}%`;
    };

    const clampPan = () => {
      if (!frame || !stage) return false;
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      if (sw <= 0 || sh <= 0) return false;
      const fw0 = frame.offsetWidth;
      const fh0 = frame.offsetHeight;
      if (fw0 <= 0 || fh0 <= 0) return false;
      const natX = (sw - fw0) / 2; // flex-centred natural offset (layout is unscaled)
      const natY = (sh - fh0) / 2;
      const vw = fw0 * this._zoom;
      const vh = fh0 * this._zoom;
      this._panX = vw >= sw ? _clamp(this._panX, sw - vw - natX, -natX) : (sw - vw) / 2 - natX;
      this._panY = vh >= sh ? _clamp(this._panY, sh - vh - natY, -natY) : (sh - vh) / 2 - natY;
      return true;
    };

    const queueApplyZoom = () => {
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(applyZoom);
      else window.setTimeout(applyZoom, 0);
    };

    const zoomTo = (newZoom, clientX, clientY) => {
      if (!frame || !stage) return;
      const next = _clamp(newZoom, 1, 6);
      const stageRect = stage.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const localX = (clientX - frameRect.left) / this._zoom;
      const localY = (clientY - frameRect.top) / this._zoom;
      const natX = (frameRect.left - stageRect.left) - this._panX;
      const natY = (frameRect.top - stageRect.top) - this._panY;
      this._panX = (clientX - stageRect.left) - (next * localX) - natX;
      this._panY = (clientY - stageRect.top) - (next * localY) - natY;
      this._zoom = next;
      clampPan();
      applyZoom();
    };

    const zoomByFactor = factor => {
      const stageRect = stage?.getBoundingClientRect();
      if (!stageRect) return;
      zoomTo(this._zoom * factor, stageRect.left + stageRect.width / 2, stageRect.top + stageRect.height / 2);
    };

    applyZoom();
    queueApplyZoom();
    img?.addEventListener?.("load", queueApplyZoom, { once: true });
    img?.addEventListener?.("loadedmetadata", queueApplyZoom, { once: true });

    stage?.addEventListener("wheel", event => {
      if (!frame) return;
      event.preventDefault();
      zoomTo(this._zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY);
    }, { passive: false });

    el.querySelector("[data-zoom-in]")?.addEventListener("click", event => { event.preventDefault(); zoomByFactor(1.25); });
    el.querySelector("[data-zoom-out]")?.addEventListener("click", event => { event.preventDefault(); zoomByFactor(1 / 1.25); });
    el.querySelector("[data-zoom-reset]")?.addEventListener("click", event => {
      event.preventDefault();
      this._zoom = 1;
      this._panX = 0;
      this._panY = 0;
      clampPan();
      applyZoom();
    });

    stage?.addEventListener("pointerdown", event => {
      if (event.button !== 1) return; // middle button pans
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const baseX = this._panX;
      const baseY = this._panY;
      stage.style.cursor = "grabbing";
      const move = moveEvent => {
        this._panX = baseX + (moveEvent.clientX - startX);
        this._panY = baseY + (moveEvent.clientY - startY);
        clampPan();
        applyZoom();
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        stage.style.cursor = "";
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    });

    const pointFromImageEvent = event => {
      if (!img) return null;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        x: _clamp((event.clientX - rect.left) / rect.width),
        y: _clamp((event.clientY - rect.top) / rect.height),
      };
    };

    const moveMarkerElement = (marker, point) => {
      marker.style.left = `${point.x * 100}%`;
      marker.style.top = `${point.y * 100}%`;
    };

    const refreshCurveSvg = (curveIndex, curve) => {
      el.querySelector(`[data-curve-path="${curveIndex}"]`)?.setAttribute("d", _arrayCurveSvgPathData(curve));
      for (const handle of _arrayCurveHandleRows(curve, curveIndex)) {
        el.querySelector(`[data-curve-handle="${curveIndex}"][data-curve-handle-index="${handle.index}"]`)?.setAttribute("d", handle.path);
      }
    };

    const beginDrag = (event, applyMove) => {
      if (event.button) return; // primary button only; middle button pans the stage
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture?.(event.pointerId);
      let moved = false;

      const move = moveEvent => {
        const point = pointFromImageEvent(moveEvent);
        if (!point) return;
        moved = true;
        applyMove(point, target);
      };
      const up = upEvent => {
        target.releasePointerCapture?.(upEvent.pointerId);
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        if (moved) {
          this._opaqueState = null;
          this.render({ force: true });
        }
      };

      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };

    el.querySelectorAll("[data-anchor-tab]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        this._activeTab = event.currentTarget.dataset.anchorTab || "tractor";
        this._opaqueState = null;
        this._pendingCurvePoints = [];
        this._pendingZonePoints = [];
        this._selectedEmitterIndex = 0;
        if (!this._isActiveArrayWeaponTab()) this._activePlacementMode = "points";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-placement-mode]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        const mode = event.currentTarget.dataset.placementMode === "curve" ? "curve" : "points";
        this._activePlacementMode = this._isActiveArrayWeaponTab() ? mode : "points";
        this._pendingCurvePoints = [];
        this._opaqueState = null;
        this.render({ force: true });
      });
    });

    const syncHexPicker = picker => {
      const scope = picker.dataset.hexColorScope;
      const key = picker.dataset.hexColorKey;
      if (!scope || !key) return;
      const textInput = el.querySelector(`[data-${scope}-setting="${key}"][data-hex-color-text]`);
      if (!textInput) return;
      const updatePicker = () => {
        const value = String(textInput.value ?? "").trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) picker.value = value.toLowerCase();
      };
      textInput.addEventListener("input", updatePicker);
      textInput.addEventListener("change", updatePicker);
      const updateText = () => {
        textInput.value = picker.value;
        textInput.dispatchEvent(new Event("input", { bubbles: true }));
      };
      picker.addEventListener("input", updateText);
      picker.addEventListener("change", updateText);
    };

    el.querySelectorAll("[data-hex-color-picker]").forEach(syncHexPicker);

    el.querySelectorAll("[data-vfx-setting], [data-charge-setting], [data-shield-impact-setting]").forEach(input => {
      input.addEventListener("input", () => {
        this._readWeaponSettingsFromForm();
        this._scheduleAutoPreview();
      });
      input.addEventListener("change", () => {
        this._readWeaponSettingsFromForm();
        this._scheduleAutoPreview();
      });
    });

    el.querySelectorAll("[data-engine-setting]").forEach(input => {
      input.addEventListener("input", () => {
        this._readEngineSettingsFromForm();
        this._scheduleAutoPreview();
      });
      input.addEventListener("change", () => {
        this._readEngineSettingsFromForm();
        this._scheduleAutoPreview();
        // colorMode / enabled toggles change which controls show — re-render.
        const key = input.dataset.engineSetting;
        if (key === "colorMode" || key === "enabled") this.render({ force: true });
      });
    });

    el.querySelector("[data-reset-engine]")?.addEventListener("click", event => {
      event.preventDefault();
      const kind = this._activeEngineKind();
      if (!kind) return;
      const current = this._activeEngineTrailSettings();
      this._setEngineTrailSettings({
        ...current,
        [kind]: DEFAULT_ENGINE_MODE_SETTINGS[kind],
      });
      this.render({ force: true });
    });

    const refreshEmitterArcControls = () => {
      const active = this._activeEmitterArcControls();
      if (!active) return;
      el.querySelector("[data-emitter-facing-value]")?.replaceChildren(document.createTextNode(`${active.facingDeg} deg`));
      el.querySelector("[data-emitter-arc-value]")?.replaceChildren(document.createTextNode(`${active.arcWidthDeg} deg`));
      const marker = el.querySelector(`[data-move-emitter="${active.index}"] .sta2e-anchor-facing-arrow`);
      if (marker) marker.style.transform = `rotate(${active.facingDeg}deg)`;
    };

    el.querySelectorAll("[data-emitter-setting]").forEach(input => {
      input.addEventListener("input", () => {
        this._readEmitterArcFromForm();
        refreshEmitterArcControls();
        this._scheduleAutoPreview();
      });
      input.addEventListener("change", () => {
        this._readEmitterArcFromForm();
        this._scheduleAutoPreview();
        this.render({ force: true });
      });
    });

    el.querySelector("[data-auto-preview]")?.addEventListener("change", event => {
      this._autoPreview = event.currentTarget.checked === true;
      if (this._autoPreview) this._scheduleAutoPreview();
    });

    el.querySelector("[data-reset-offset]")?.addEventListener("click", event => {
      event.preventDefault();
      const settings = this._activeWeaponSettings();
      if (!settings) return;
      this._setActiveWeaponSettings({
        ...settings,
        sourceOffset: DEFAULT_SOURCE_OFFSET,
      });
      this.render({ force: true });
    });

    el.querySelector("[data-reset-charge]")?.addEventListener("click", event => {
      event.preventDefault();
      const settings = this._activeWeaponSettings();
      if (!settings) return;
      this._setActiveWeaponSettings({
        ...settings,
        charge: DEFAULT_ARRAY_CHARGE_SETTINGS,
      });
      this.render({ force: true });
    });

    el.querySelector("[data-finish-curve]")?.addEventListener("click", event => {
      event.preventDefault();
      if (!this._isActiveArrayWeaponTab() || this._pendingCurvePoints.length < 2) return;
      const activeCurves = this._activeCurves();
      const curve = {
        nodes: _pointsToNodes(this._pendingCurvePoints),
        label: `${this._activeTabLabel()} array curve ${activeCurves.length + 1}`,
      };
      this._setActiveCurves([...activeCurves, curve]);
      this._pendingCurvePoints = [];
      this._opaqueState = null;
      this.render({ force: true });
    });

    el.querySelector("[data-cancel-curve]")?.addEventListener("click", event => {
      event.preventDefault();
      this._pendingCurvePoints = [];
      this._opaqueState = null;
      this.render({ force: true });
    });

    el.querySelector("[data-convert-curve]")?.addEventListener("click", event => {
      event.preventDefault();
      if (!this._isActiveArrayWeaponTab()) return;
      let changed = false;
      const converted = this._activeCurves().map(curve => {
        if (Array.isArray(curve.nodes)) return curve;
        if (Array.isArray(curve.points) && curve.points.length >= 2) {
          changed = true;
          return { ...curve, points: undefined, nodes: _pointsToNodes(curve.points) };
        }
        if (curve.start && curve.control1 && curve.control2 && curve.end) {
          changed = true;
          return {
            ...curve,
            start: undefined,
            control1: undefined,
            control2: undefined,
            end: undefined,
            nodes: [
              { x: curve.start.x, y: curve.start.y, hIn: { ...curve.start }, hOut: { ...curve.control1 } },
              { x: curve.end.x, y: curve.end.y, hIn: { ...curve.control2 }, hOut: { ...curve.end } },
            ],
          };
        }
        return curve;
      });
      if (!changed) {
        ui.notifications.info("STA2e Toolkit: These array curves already use handles.");
        return;
      }
      this._setActiveCurves(converted);
      this._opaqueState = null;
      this.render({ force: true });
      ui.notifications.info("STA2e Toolkit: Converted array curve(s) to editable handles.");
    });

    el.querySelector("[data-finish-zone]")?.addEventListener("click", event => {
      event.preventDefault();
      if (this._resolveActiveTab() !== "hitLocations" || this._pendingZonePoints.length < 3) return;
      const activeZones = this._activeZones();
      const zone = {
        systemKey: this._activeHitSystem,
        points: this._pendingZonePoints.map(point => ({ ...point })),
        label: `${_systemLabel(this._activeHitSystem)} hit zone ${activeZones.length + 1}`,
      };
      this._setActiveZones([...activeZones, zone]);
      this._pendingZonePoints = [];
      this._opaqueState = null;
      this.render({ force: true });
    });

    el.querySelector("[data-cancel-zone]")?.addEventListener("click", event => {
      event.preventDefault();
      this._pendingZonePoints = [];
      this._opaqueState = null;
      this.render({ force: true });
    });

    el.querySelectorAll("[data-remove-zone]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.removeZone);
        const activeZones = [...this._activeZones()];
        if (!Number.isInteger(index) || index < 0 || index >= activeZones.length) return;
        activeZones.splice(index, 1);
        this._setActiveZones(activeZones);
        this._pendingZonePoints = [];
        this._opaqueState = null;
        this.render({ force: true });
      });
    });

    const refreshZoneSvg = zoneIndex => {
      const zone = this._activeZones()[zoneIndex];
      if (!zone) return;
      el.querySelector(`[data-zone-path="${zoneIndex}"]`)?.setAttribute("d", this._zoneSvgPathData(zone.points));
    };

    el.querySelectorAll("[data-move-zone]").forEach(marker => {
      marker.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
      });
      marker.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        const zoneIndex = Number(event.currentTarget.dataset.moveZone);
        const pointIndex = Number(event.currentTarget.dataset.moveZonePoint);
        const zones = this._activeZones().map(zone => this._cloneZone(zone));
        const zone = zones[zoneIndex];
        if (!zone || !Number.isInteger(pointIndex)) return;
        if (zone.points.length <= 3) {
          ui.notifications.warn("STA2e Toolkit: A hit zone needs at least three vertices.");
          return;
        }
        zone.points.splice(pointIndex, 1);
        this._setActiveZones(zones);
        this._opaqueState = null;
        this.render({ force: true });
      });
      marker.addEventListener("pointerdown", event => {
        const zoneIndex = Number(event.currentTarget.dataset.moveZone);
        const pointIndex = Number(event.currentTarget.dataset.moveZonePoint);
        if (!Number.isInteger(zoneIndex) || !Number.isInteger(pointIndex)) return;
        beginDrag(event, (point, target) => {
          const zones = this._activeZones().map(zone => this._cloneZone(zone));
          const zone = zones[zoneIndex];
          if (!zone || pointIndex < 0 || pointIndex >= zone.points.length) return;
          zone.points[pointIndex] = { x: point.x, y: point.y };
          this._setActiveZones(zones);
          moveMarkerElement(target, point);
          refreshZoneSvg(zoneIndex);
          if (coords) coords.textContent = `${zones.length} hit zone(s) for ${this._activeTabLabel()}`;
        });
      });
    });

    el.querySelectorAll("[data-hit-system]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        this._activeHitSystem = _normalizeSystemKey(event.currentTarget.dataset.hitSystem);
        this._opaqueState = null;
        this._pendingZonePoints = [];
        this.render({ force: true });
      });
    });

    stage?.addEventListener("click", async event => {
      if (!img || !this.textureSrc) return;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (
        event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom
      ) return;
      const x = _clamp((event.clientX - rect.left) / rect.width);
      const y = _clamp((event.clientY - rect.top) / rect.height);

      if (this._isActiveArrayWeaponTab() && this._activePlacementMode === "curve") {
        // Shift-click inserts a node into the most recent handle curve, splitting
        // the nearest segment, rather than starting a new pending point.
        if (event.shiftKey && !this._pendingCurvePoints.length) {
          const curves = this._activeCurves().map(curve => _cloneCurve(curve));
          let targetIndex = -1;
          for (let i = curves.length - 1; i >= 0; i--) {
            if (Array.isArray(curves[i].nodes)) { targetIndex = i; break; }
          }
          if (targetIndex >= 0 && _insertNodeNearest(curves[targetIndex], { x, y })) {
            this._setActiveCurves(curves);
            this._opaqueState = null;
            this.render({ force: true });
            return;
          }
        }
        this._pendingCurvePoints = [...this._pendingCurvePoints, { x, y }];
        if (coords) {
          coords.textContent = `${this._pendingCurvePoints.length} curve point(s) placed; click another point or Finish Curve`;
        }
        this._opaqueState = null;
        this.render({ force: true });
        return;
      }

      if (this._resolveActiveTab() === "hitLocations") {
        // Hit zones are drawn as polygons: each click drops a vertex, Finish
        // Zone closes the shape. Shift-click inserts a vertex into the nearest
        // edge of an already-saved zone instead.
        if (event.shiftKey && !this._pendingZonePoints.length && this._activeZones().length) {
          if (this._insertZoneVertexNearest({ x, y })) {
            this._opaqueState = null;
            this.render({ force: true });
            return;
          }
        }
        this._pendingZonePoints = [...this._pendingZonePoints, { x, y }];
        if (coords) {
          coords.textContent = `${this._pendingZonePoints.length} zone vertex(es) placed; click another or Finish Zone`;
        }
        this._opaqueState = null;
        this.render({ force: true });
        return;
      }

      const activeEmitters = this._activeEmitters();
      const activeLabel = this._activeTabLabel();
      const pointKind = this._resolveActiveTab() === "hitLocations" ? "hit location" : "emitter";
      const anchor = { x, y, label: `${activeLabel} ${pointKind} ${activeEmitters.length + 1}` };
      if (this._isEngineTab()) {
        anchor.kind = this._activeEngineKind();
        anchor.facingDeg = DEFAULT_ENGINE_EMITTER_FACING_DEG;
        anchor.layer = "above";
      } else if (this._weaponForTab() && !this._isActiveArrayWeaponTab()) {
        anchor.facingDeg = _defaultEmitterFacingDeg(anchor);
        anchor.arcWidthDeg = DEFAULT_WEAPON_EMITTER_ARC_WIDTH_DEG;
        anchor.layer = "above";
      }
      this._selectedEmitterIndex = activeEmitters.length;
      this._setActiveEmitters([...activeEmitters, anchor]);
      if (coords) coords.textContent = `${this._activeEmitters().length} ${pointKind} point(s) for ${this._activeTabLabel()}`;
      if (opacityStatus) opacityStatus.textContent = "Checking alpha...";
      const opaque = await isTexturePointOpaque(this.textureSrc, x, y);
      this._opaqueState = opaque === null ? null : (opaque ? "opaque" : "transparent");
      if (opacityStatus) {
        opacityStatus.textContent = opaque === null
          ? "Alpha mask unavailable"
          : (opaque ? "Point is on visible pixels" : "Warning: point appears transparent");
      }
      this.render({ force: true });
    });

    el.querySelectorAll("[data-remove-emitter]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.removeEmitter);
        const activeEmitters = [...this._activeEmitters()];
        if (!Number.isInteger(index) || index < 0 || index >= activeEmitters.length) return;
        activeEmitters.splice(index, 1);
        this._setActiveEmitters(activeEmitters);
        this._opaqueState = null;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-select-emitter]").forEach(row => {
      row.addEventListener("click", event => {
        if (event.target.closest("button")) return;
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.selectEmitter);
        if (!Number.isInteger(index)) return;
        this._selectedEmitterIndex = index;
        this._opaqueState = null;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-remove-curve]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.removeCurve);
        const activeCurves = [...this._activeCurves()];
        if (!Number.isInteger(index) || index < 0 || index >= activeCurves.length) return;
        activeCurves.splice(index, 1);
        this._setActiveCurves(activeCurves);
        this._pendingCurvePoints = [];
        this._opaqueState = null;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-move-emitter]").forEach(marker => {
      marker.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.moveEmitter);
        if (Number.isInteger(index) && this._weaponForTab() && !this._isActiveArrayWeaponTab()) {
          this._selectedEmitterIndex = index;
          this.render({ force: true });
        }
      });
      marker.addEventListener("pointerdown", event => {
        const index = Number(event.currentTarget.dataset.moveEmitter);
        if (!Number.isInteger(index)) return;
        this._selectedEmitterIndex = index;
        beginDrag(event, (point, target) => {
          const emitters = [...this._activeEmitters()];
          if (index < 0 || index >= emitters.length) return;
          emitters[index] = { ...emitters[index], x: point.x, y: point.y };
          this._setActiveEmitters(emitters);
          moveMarkerElement(target, point);
          if (coords) coords.textContent = `${emitters.length} ${this._resolveActiveTab() === "hitLocations" ? "hit location" : "emitter"} point(s) for ${this._activeTabLabel()}`;
        });
      });
    });

    const repositionHandleMarkers = (index, nodeIndex, node) => {
      for (const part of ["hIn", "hOut"]) {
        const handle = node?.[part];
        if (!handle) continue;
        const div = el.querySelector(`[data-move-curve="${index}"][data-move-curve-point="nodes.${nodeIndex}.${part}"]`);
        if (div) {
          div.style.left = `${handle.x * 100}%`;
          div.style.top = `${handle.y * 100}%`;
        }
      }
    };

    el.querySelectorAll("[data-move-curve]").forEach(marker => {
      marker.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
      });
      marker.addEventListener("contextmenu", event => {
        const pointKey = event.currentTarget.dataset.moveCurvePoint || "";
        const removeMatch = /^nodes\.(\d+)\.anchor$/.exec(pointKey);
        if (!removeMatch) return;
        event.preventDefault();
        event.stopPropagation();
        const index = Number(event.currentTarget.dataset.moveCurve);
        const curves = this._activeCurves().map(curve => _cloneCurve(curve));
        const curve = curves[index];
        if (!curve || !Array.isArray(curve.nodes)) return;
        if (curve.nodes.length <= 2) {
          ui.notifications.warn("STA2e Toolkit: A curve needs at least two handle nodes.");
          return;
        }
        curve.nodes.splice(Number(removeMatch[1]), 1);
        this._setActiveCurves(curves);
        this._opaqueState = null;
        this.render({ force: true });
      });
      marker.addEventListener("pointerdown", event => {
        const index = Number(event.currentTarget.dataset.moveCurve);
        const pointKey = event.currentTarget.dataset.moveCurvePoint;
        const nodeMatch = /^nodes\.(\d+)\.(anchor|hIn|hOut)$/.exec(pointKey || "");
        const pointIndex = String(pointKey || "").startsWith("points.")
          ? Number(String(pointKey).slice("points.".length))
          : null;
        const isLegacyPoint = ["start", "control1", "control2", "end"].includes(pointKey);
        if (!Number.isInteger(index)) return;
        if (!nodeMatch && !isLegacyPoint && !Number.isInteger(pointIndex)) return;
        beginDrag(event, (point, target) => {
          const curves = this._activeCurves().map(curve => _cloneCurve(curve));
          if (index < 0 || index >= curves.length) return;
          const curve = curves[index];
          if (nodeMatch) {
            const nodeIndex = Number(nodeMatch[1]);
            const part = nodeMatch[2];
            if (!Array.isArray(curve.nodes) || nodeIndex < 0 || nodeIndex >= curve.nodes.length) return;
            const node = curve.nodes[nodeIndex];
            if (part === "anchor") {
              const dx = point.x - node.x;
              const dy = point.y - node.y;
              node.x = point.x;
              node.y = point.y;
              if (node.hIn) { node.hIn.x = _clamp(node.hIn.x + dx); node.hIn.y = _clamp(node.hIn.y + dy); }
              if (node.hOut) { node.hOut.x = _clamp(node.hOut.x + dx); node.hOut.y = _clamp(node.hOut.y + dy); }
            } else {
              node[part] = { x: point.x, y: point.y };
            }
            this._setActiveCurves(curves);
            moveMarkerElement(target, point);
            if (part === "anchor") repositionHandleMarkers(index, nodeIndex, node);
            refreshCurveSvg(index, curve);
          } else if (Number.isInteger(pointIndex)) {
            if (!Array.isArray(curve.points) || pointIndex < 0 || pointIndex >= curve.points.length) return;
            curve.points[pointIndex] = { x: point.x, y: point.y };
            this._setActiveCurves(curves);
            moveMarkerElement(target, point);
            refreshCurveSvg(index, curve);
          } else {
            curves[index] = { ...curve, [pointKey]: { x: point.x, y: point.y } };
            this._setActiveCurves(curves);
            moveMarkerElement(target, point);
            refreshCurveSvg(index, curves[index]);
          }
          if (coords) coords.textContent = `${curves.length} array curve(s) for ${this._activeTabLabel()}`;
        });
      });
    });
  }

  static async _onSave(_event, _target) {
    if (!game.user?.isGM || !this.actor) return;
    this._readWeaponSettingsFromForm();
    this._readEngineSettingsFromForm();
    this._anchors = await _saveShipVfxAnchors(this.actor, {
      ...this._anchors,
      textureSrc: this.textureSrc,
    });
    ui.notifications.info(`STA2e Toolkit: Ship VFX anchors saved for ${this.actor.name}.`);
    this.render({ force: true });
  }

  static async _onClear(_event, _target) {
    if (!game.user?.isGM || !this.actor) return;
    const clearedLabel = this._activeTabLabel();
    if (this._isActiveArrayWeaponTab() && this._activePlacementMode === "curve") {
      this._setActiveCurves([]);
    } else if (this._resolveActiveTab() === "hitLocations") {
      this._setActiveZones([]);
      this._setActiveEmitters([]);
    } else {
      this._setActiveEmitters([]);
    }
    this._anchors = await _saveShipVfxAnchors(this.actor, this._anchors);
    this._opaqueState = null;
    this._pendingCurvePoints = [];
    this._pendingZonePoints = [];
    const pointKind = this._isActiveArrayWeaponTab() && this._activePlacementMode === "curve"
      ? "array curves"
      : (this._resolveActiveTab() === "hitLocations" ? "hit zones and legacy points" : "emitter points");
    ui.notifications.info(`STA2e Toolkit: ${clearedLabel} ${pointKind} cleared for ${this.actor.name}.`);
    this.render({ force: true });
  }

  static async _onPreview(_event, _target) {
    await this._previewActive({ silent: false });
  }

  // ── Export / import ────────────────────────────────────────────────────────
  // The full anchor payload (emitters, hit zones, curves, all settings) as a
  // JSON download. Coordinates are normalized to the ship image, so a setup
  // exported from one ship drops cleanly onto any other ship using the same
  // (or same-proportioned) art — handy for fleets of one class.
  static _onExport(_event, _target) {
    this._readWeaponSettingsFromForm();
    this._readEngineSettingsFromForm();
    const payload = {
      module: MODULE,
      type: SHIP_VFX_ANCHORS_FLAG,
      version: SHIP_VFX_ANCHORS_VERSION,
      actorName: this.actor?.name ?? "",
      exportedAt: new Date().toISOString(),
      data: normalizeShipVfxAnchors({ ...this._anchors, textureSrc: this.textureSrc }),
    };
    const slug = String(this.actor?.name ?? "ship")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ship";
    const json = JSON.stringify(payload, null, 2);
    const save = foundry?.utils?.saveDataToFile ?? globalThis.saveDataToFile;
    if (typeof save === "function") {
      save(json, "text/json", `${slug}-vfx-anchors.json`);
    } else {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug}-vfx-anchors.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    ui.notifications.info(`STA2e Toolkit: VFX setup exported for ${this.actor?.name ?? "ship"}.`);
  }

  static async _onImport(_event, _target) {
    if (!game.user?.isGM || !this.actor) {
      ui.notifications.warn("STA2e Toolkit: Only the GM can import VFX setups.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      let parsed;
      try {
        const read = foundry?.utils?.readTextFromFile ?? globalThis.readTextFromFile;
        const text = typeof read === "function" ? await read(file) : await file.text();
        parsed = JSON.parse(text);
      } catch (err) {
        console.warn("STA2e Toolkit | Could not read VFX import file:", err);
        ui.notifications.error("STA2e Toolkit: Could not read that file as JSON.");
        return;
      }

      // Accept both the wrapped export format and a raw anchors object.
      const raw = (parsed?.type === SHIP_VFX_ANCHORS_FLAG && parsed?.data) ? parsed.data : parsed;
      if (!raw || typeof raw !== "object" || typeof raw.anchors !== "object") {
        ui.notifications.error("STA2e Toolkit: That file does not look like a ship VFX export.");
        return;
      }

      const sourceName = parsed?.actorName ? ` (from ${parsed.actorName})` : "";
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Import Ship VFX Setup" },
        content: `<p>Replace the entire VFX setup for <strong>${this.actor.name}</strong> with the imported one${sourceName}? This overwrites all emitters, hit zones, curves, and settings.</p>`,
      });
      if (!confirmed) return;

      // Weapon ids are per-actor item ids, so entries exported from another
      // ship would never match this ship's weapons (id mismatch short-circuits
      // before the name/img fallback). Remap ids onto this actor's weapons by
      // id, then img, then name; clear ids that match nothing so the name/img
      // fallback can still catch them later.
      const weapons = this._shipWeapons();
      const remapWeaponRef = entry => {
        if (!entry || typeof entry !== "object") return entry;
        if (!entry.weaponId && !entry.weaponName && !entry.weaponImg) return entry;
        const match = weapons.find(weapon => _weaponId(weapon) === entry.weaponId)
          ?? weapons.find(weapon => entry.weaponImg && _weaponImg(weapon) === entry.weaponImg)
          ?? weapons.find(weapon => entry.weaponName && _weaponName(weapon) === entry.weaponName);
        return match
          ? { ...entry, weaponId: _weaponId(match), weaponName: _weaponName(match), weaponImg: _weaponImg(match) }
          : { ...entry, weaponId: "" };
      };
      const remapped = {
        ...raw,
        anchors: {
          ...(raw.anchors ?? {}),
          weaponEmitters: (raw.anchors?.weaponEmitters ?? []).map(remapWeaponRef),
          arrayCurves: (raw.anchors?.arrayCurves ?? []).map(remapWeaponRef),
        },
        settings: {
          ...(raw.settings ?? {}),
          weaponVfx: (raw.settings?.weaponVfx ?? []).map(remapWeaponRef),
        },
      };

      // Keep this ship's own texture path; normalized coordinates carry over.
      this._anchors = await _saveShipVfxAnchors(this.actor, {
        ...remapped,
        textureSrc: this.textureSrc,
      });
      this._opaqueState = null;
      this._pendingCurvePoints = [];
      this._pendingZonePoints = [];
      this._selectedEmitterIndex = 0;
      ui.notifications.info(`STA2e Toolkit: VFX setup imported onto ${this.actor.name}.`);
      this.render({ force: true });
    }, { once: true });
    input.click();
  }

  static _onClose(_event, _target) {
    window.clearTimeout(this._previewTimer);
    this.close();
  }
}

export function openShipVfxAnchorEditor(actorOrToken) {
  if (!game.user?.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can edit ship VFX anchors.");
    return null;
  }
  const actor = _resolveActor(actorOrToken);
  if (!actor) {
    ui.notifications.warn("STA2e Toolkit: Select or open a ship actor before editing VFX anchors.");
    return null;
  }
  const app = new ShipVfxAnchorEditor(actorOrToken);
  app.render({ force: true });
  return app;
}
