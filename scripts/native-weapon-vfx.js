/**
 * sta2e-toolkit | native-weapon-vfx.js
 *
 * Experimental Foundry canvas / PIXI weapon animations.
 */

import {
  getClosestShipArrayCurveMatch,
  getShipWeaponVfxSettings,
  getShipHitLocationPointForShot,
  getShipWeaponEmitterArcSelection,
  getShipWeaponEmitterAnchors,
  getTokenAlphaMask,
  isShipArrayWeapon,
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

export const NATIVE_WEAPON_VFX_DEFAULT_MODES = Object.freeze({
  "weapon-phaser-bank": "current",
  "weapon-phaser-array": "current",
});

export const NATIVE_WEAPON_VFX_MODE_ROWS = Object.freeze([
  { key: "weapon-phaser-bank", label: "Phaser Banks", hint: "Experimental: three TNG/VOY-style amber beam bursts." },
  { key: "weapon-phaser-array", label: "Phaser Arrays", hint: "Experimental: clean continuous TNG/VOY-style array beam." },
]);

const SUPPORTED_NATIVE_WEAPONS = new Set(Object.keys(NATIVE_WEAPON_VFX_DEFAULT_MODES));

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
  const curveMatch = getClosestShipArrayCurveMatch(sourceToken, weapon, targetPoint, undefined, settings, {
    applySourceOffset: false,
  });
  if (!curveMatch) return null;
  await _arrayCurveCharge(curveMatch, charge);
  return curveMatch.point ?? null;
}

export async function previewShipWeaponVFX(sourceToken, weapon, targetPoint, options = {}) {
  if (!globalThis.PIXI || !canvas?.ready || !sourceToken || !targetPoint) return false;
  const settings = getShipWeaponVfxSettings(sourceToken, weapon, options.vfxSettings);
  const colors = _previewColors(weapon, settings, options);
  if (isShipArrayWeapon(weapon)) {
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
      duration: Math.max(180, Number(options.beamDuration) || 520),
      color: colors.color,
      coreColor: colors.coreColor,
    });
    return true;
  }

  const sourcePoint = _sourcePointForShot(sourceToken, weapon, targetPoint, 0, settings, options.selectedEmitter);
  _beamShot(sourcePoint, targetPoint, {
    hit: true,
    duration: Math.max(180, Number(options.beamDuration) || 420),
    width: 3,
    glowWidth: 12,
    color: colors.color,
    coreColor: colors.coreColor,
    layer: sourcePoint.layer,
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

function _previewColors(weapon, settings, options = {}) {
  const name = `${weapon?.name ?? ""} ${weapon?.img ?? ""}`.toLowerCase();
  const fallback = name.includes("disruptor") ? 0x66ff99
    : name.includes("polaron") ? 0xaa66ff
    : name.includes("quantum") ? 0x66ccff
    : PHASER_PRIMARY;
  return {
    color: _parseHexColor(settings?.charge?.colorOverride, options.color ?? fallback),
    coreColor: _parseHexColor(settings?.charge?.coreColorOverride, options.coreColor ?? PHASER_CORE),
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
    const curvePoint = getClosestShipArrayCurveMatch(sourceToken, weapon, targetPoint, undefined, vfxSettings)?.point;
    if (curvePoint) return curvePoint;
  }

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
  return Math.min(3, Math.max(1, count));
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
  for (const target of targets) {
    _playSound(opts.soundPath);
    for (let i = 0; i < 3; i++) {
      const targetPoint = await _targetPointForShot(sourceToken, target, {
        isHit,
        targetSystem: opts.targetSystem,
        shotIndex: i,
      });
      const sourcePoint = _sourcePointForShot(sourceToken, opts.weapon, targetPoint, i, null, opts.selectedEmitter);
      await _delay(i === 0 ? 0 : 95);
      _beamShot(sourcePoint, targetPoint, {
        hit: isHit,
        duration: 360,
        width: 3,
        glowWidth: 14,
        color: PHASER_PRIMARY,
        coreColor: PHASER_CORE,
        layer: sourcePoint.layer,
      });
      if (isHit) {
        if (opts.hullImpact?.shieldsDown) scheduleHullImpactVFX(target, targetPoint, { ...opts.hullImpact, delayMs: 300 });
        else {
          scheduleShieldImpactVFX(sourceToken, target, targetPoint, {
            ..._shieldImpactForShot(opts.shieldImpact, i, 3),
            delayMs: 300,
          });
        }
      }
    }
    await _delay(520);
  }
}

async function _firePhaserArray(isHit, sourceToken, targets, opts) {
  const repeats = isHit ? opts.repeatCount : 1;
  const settings = getShipWeaponVfxSettings(sourceToken, opts.weapon);
  const colors = _previewColors(opts.weapon, settings, {
    color: PHASER_PRIMARY,
    coreColor: PHASER_CORE,
  });
  for (const target of targets) {
    _playSound(opts.soundPath);
    for (let i = 0; i < repeats; i++) {
      const targetPoint = await _targetPointForShot(sourceToken, target, {
        isHit,
        targetSystem: opts.targetSystem,
        shotIndex: i,
      });
      await playArrayCurveChargeVFX(sourceToken, opts.weapon, targetPoint, {
        vfxSettings: settings,
        isHit,
        color: colors.color,
        coreColor: colors.coreColor,
      });
      const sourcePoint = _sourcePointForShot(sourceToken, opts.weapon, targetPoint, i, settings, opts.selectedEmitter);
      const beamDuration = isHit ? 760 : 420;
      _arrayBeam(sourcePoint, targetPoint, {
        hit: isHit,
        duration: beamDuration,
        color: colors.color,
        coreColor: colors.coreColor,
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
      await _delay(beamDuration + 160);
    }
  }
}

function _arrayCurveCharge(curveMatch, opts = {}) {
  const layer = _effectLayer();
  if (!layer || !curveMatch?.canvasCurve || !curveMatch?.point) return Promise.resolve();

  const duration = Math.max(160, Number(opts.duration) || 420);
  const color = opts.color ?? PHASER_PRIMARY;
  const coreColor = opts.coreColor ?? PHASER_CORE;
  const curve = curveMatch.canvasCurve;
  const samples = curveMatch.samples?.length ? curveMatch.samples : [curve.start, curve.end].filter(Boolean);
  if (samples.length < 2) return Promise.resolve();
  const meetT = Math.max(0.04, Math.min(0.96, Number(curveMatch.t) || 0.5));
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

  const finish = () => {
    if (finished) return;
    finished = true;
    try { ticker?.remove?.(tick); } catch { /* no-op */ }
    _arrayCurveMeetingFlash(curveMatch.point, color, coreColor, opts);
    _fadeContainer(container, opts.fadeDuration ?? 180, opts.cleanupDelay ?? 120);
  };

  const tick = () => {
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
  };

  tick();
  if (ticker?.add) ticker.add(tick);
  else setTimeout(finish, duration);
  setTimeout(finish, duration + (Number(opts.cleanupDelay) || 120));
  return _delay(duration);
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

  const container = _sceneContainer(Math.max(sourcePoint.y, targetPoint.y), opts.layer);
  layer.addChild(container);

  const glow = new PIXI.Graphics();
  const beam = new PIXI.Graphics();
  const flare = new PIXI.Graphics();
  const spark = new PIXI.Graphics();
  for (const child of [glow, beam, flare, spark]) child.blendMode = _addBlend();

  _drawLine(glow, sourcePoint, targetPoint, opts.glowWidth ?? 12, opts.color, 0.26);
  _drawLine(beam, sourcePoint, targetPoint, opts.width ?? 3, opts.coreColor, 0.94);
  _fillCircle(flare, sourcePoint.x, sourcePoint.y, 7, opts.coreColor, 0.88);
  _strokeCircle(flare, sourcePoint.x, sourcePoint.y, 12, 2, opts.color, 0.55);
  container.addChild(glow, beam, flare);
  if (opts.hit) {
    _fillCircle(spark, targetPoint.x, targetPoint.y, 9, opts.coreColor, 0.9);
    _strokeCircle(spark, targetPoint.x, targetPoint.y, 20, 2, opts.color, 0.7);
    if (opts.layer === "below") {
      const impactContainer = _sceneContainer(targetPoint.y);
      impactContainer.addChild(spark);
      layer.addChild(impactContainer);
      _fadeContainer(impactContainer, opts.duration ?? 420);
    } else {
      container.addChild(spark);
    }
  }

  _fadeContainer(container, opts.duration ?? 420);
}

function _arrayBeam(sourcePoint, targetPoint, opts = {}) {
  const layer = _effectLayer();
  if (!layer) return;

  const container = _sceneContainer(Math.max(sourcePoint.y, targetPoint.y));
  layer.addChild(container);

  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;

  const glow = new PIXI.Graphics();
  const beam = new PIXI.Graphics();
  const sweep = new PIXI.Graphics();
  for (const child of [glow, beam, sweep]) child.blendMode = _addBlend();

  _drawLine(glow, sourcePoint, targetPoint, 18, opts.color, 0.22);
  _drawLine(glow, _offsetPoint(sourcePoint, nx, ny, 4), _offsetPoint(targetPoint, nx, ny, 4), 8, opts.color, 0.18);
  _drawLine(glow, _offsetPoint(sourcePoint, nx, ny, -4), _offsetPoint(targetPoint, nx, ny, -4), 8, opts.color, 0.18);
  _drawLine(beam, sourcePoint, targetPoint, 4, opts.coreColor, 0.96);
  _drawLine(sweep, sourcePoint, targetPoint, 2, 0xffffff, 0.72);

  if (opts.hit) {
    const spark = new PIXI.Graphics();
    spark.blendMode = _addBlend();
    _fillCircle(spark, targetPoint.x, targetPoint.y, 10, opts.coreColor, 0.85);
    _strokeCircle(spark, targetPoint.x, targetPoint.y, 24, 2, opts.color, 0.62);
    container.addChild(spark);
  }

  container.addChild(glow, beam, sweep);
  _fadeContainer(container, opts.duration ?? 760);
}

function _sampledCurvePoint(samples, t) {
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  if (!Array.isArray(samples) || !samples.length) return { x: 0, y: 0 };
  if (samples.length === 1) return samples[0];
  const scaled = clamped * (samples.length - 1);
  const index = Math.min(samples.length - 2, Math.floor(scaled));
  const localT = scaled - index;
  const a = samples[index];
  const b = samples[index + 1];
  return {
    x: a.x + ((b.x - a.x) * localT),
    y: a.y + ((b.y - a.y) * localT),
  };
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

function _fadeContainer(container, duration = 420, cleanupDelay = 120) {
  container.alpha = 1;
  _tween(container, { alpha: 0, duration: Math.max(120, duration * 0.45), ease: "inQuad" }, Math.max(90, duration * 0.55));
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

function _playSound(soundPath, volume = 1) {
  if (!soundPath) return;
  try {
    if (globalThis.AudioHelper?.play) {
      AudioHelper.play({ src: soundPath, volume, autoplay: true, loop: false }, true);
    }
  } catch (err) {
    console.warn("STA2e Toolkit | Native weapon VFX sound failed:", err);
  }
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
