/**
 * sta2e-toolkit | tractor-beam-vfx.js
 *
 * Native Foundry/PIXI tractor beam preview effect.
 * This is intentionally independent from the live CombatHUD tractor flow.
 */

import {
  getClosestShipTractorEmitterPoint,
  getTokenAlphaMask,
  tokenTextureSource,
} from "./ship-vfx-anchors.js";

const MODULE = "sta2e-toolkit";
const VFX_Z_BASE = 910_000;

export const TRACTOR_BEAM_PRESETS = {
  starfleet: { label: "Starfleet Blue", color: "#44bbff" },
  violet:    { label: "Blue Violet",    color: "#7788ff" },
  emerald:   { label: "Emerald",        color: "#33dd88" },
  amber:     { label: "Amber",          color: "#ffaa33" },
  crimson:   { label: "Crimson",        color: "#ff5544" },
};

export const TRACTOR_BEAM_DEFAULTS = {
  preset: "starfleet",
  color: TRACTOR_BEAM_PRESETS.starfleet.color,
  placement: "above",
  adaptiveSizing: true,
  duration: 6000,
  sourceWidth: 54,
  coneWidth: 260,
  edgeFeather: 36,
  targetBubble: true,
  targetEnvelope: false,
  opacity: 0.55,
  pulseSpeed: 1.35,
  lineCount: 9,
  oscillationAmplitude: 28,
  oscillationSpeed: 1.7,
};

export const TRACTOR_BEAM_WORLD_SETTING = "tractorBeamVfxWorldDefaults";
export const TRACTOR_BEAM_CLIENT_SETTING = "tractorBeamVfxClientOverrides";

function _addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

function _hexToInt(hex, fallback = 0x44bbff) {
  const value = String(hex ?? "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) return fallback;
  return parseInt(value.slice(1), 16);
}

function _normalizeHex(hex, fallback = TRACTOR_BEAM_DEFAULTS.color) {
  const value = String(hex ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _effectLayer(placement = "above") {
  const layer = placement === "below"
    ? (canvas.primary ?? canvas.tokens ?? canvas.stage)
    : (canvas.tokens ?? canvas.interface ?? canvas.primary ?? canvas.stage);
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

function _clearGraphics(g) {
  if (typeof g.clear === "function") g.clear();
}

function _fillPolygon(g, points, color, alpha) {
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
    g.drawPolygon(points);
    g.endFill();
    return;
  }
  g.poly(points).fill({ color, alpha });
}

function _strokePath(g, points, width, color, alpha) {
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
  }
  else {
    g.setStrokeStyle?.({ width, color, alpha });
  }

  g.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);

  if (typeof g.stroke === "function" && typeof g.lineStyle !== "function") {
    g.stroke({ width, color, alpha });
  }
}

function _ring(g, x, y, rx, ry, width, color, alpha) {
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.drawEllipse(x, y, rx, ry);
    return;
  }
  g.ellipse(x, y, rx, ry).stroke({ width, color, alpha });
}

function _fillEllipse(g, x, y, rx, ry, color, alpha) {
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
    g.drawEllipse(x, y, rx, ry);
    g.endFill();
    return;
  }
  g.ellipse(x, y, rx, ry).fill({ color, alpha });
}

function _tokenCenter(token) {
  return token?.center ?? {
    x: (token?.x ?? 0) + (token?.w ?? 0) / 2,
    y: (token?.y ?? 0) + (token?.h ?? 0) / 2,
  };
}

function _isLiveToken(token) {
  if (!token?.id || !canvas.tokens) return false;
  return canvas.tokens.get(token.id) === token;
}

function _adaptiveConeWidth(targetToken) {
  return Math.max(30, (targetToken?.w ?? 100) * 0.5);
}

function _adaptiveEnvelopeConeWidth(targetToken, opts) {
  const baseWidth = _adaptiveConeWidth(targetToken);
  if (!opts?.targetBubble || !opts?.targetEnvelope) return baseWidth;
  const { rx, ry } = _targetBubbleRadii(targetToken);
  return Math.max(baseWidth, Math.min(rx, ry) * 2);
}

function _targetBubbleRadii(targetToken) {
  const width = Math.max(20, targetToken?.w ?? 100);
  const height = Math.max(20, targetToken?.h ?? 100);
  const padding = Math.max(10, Math.min(width, height) * 0.08);
  return {
    rx: width / 2 + padding,
    ry: height / 2 + padding,
  };
}

function _targetBubbleBeamPoint(sourceCenter, targetToken) {
  const targetCenter = _tokenCenter(targetToken);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return targetCenter;

  const ux = dx / len;
  const uy = dy / len;
  const { rx, ry } = _targetBubbleRadii(targetToken);
  const edgeDistance = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
  const overlap = Math.min(edgeDistance - 2, Math.max(18, Math.min(rx, ry) * 0.16));
  const beamDistance = Math.max(2, edgeDistance - overlap);

  return {
    x: targetCenter.x - ux * beamDistance,
    y: targetCenter.y - uy * beamDistance,
  };
}

function _targetRectEdgePoint(sourceCenter, targetToken) {
  const targetCenter = _tokenCenter(targetToken);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return targetCenter;

  const ux = dx / len;
  const uy = dy / len;
  const halfW = Math.max(1, (targetToken?.w ?? 100) / 2);
  const halfH = Math.max(1, (targetToken?.h ?? 100) / 2);
  const edgeDistanceX = Math.abs(ux) > 0.0001 ? halfW / Math.abs(ux) : Infinity;
  const edgeDistanceY = Math.abs(uy) > 0.0001 ? halfH / Math.abs(uy) : Infinity;
  const edgeDistance = Math.min(edgeDistanceX, edgeDistanceY);

  return {
    x: targetCenter.x - ux * edgeDistance,
    y: targetCenter.y - uy * edgeDistance,
  };
}

function _sourceRectEdgePoint(sourceToken, targetCenter) {
  const sourceCenter = _tokenCenter(sourceToken);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return sourceCenter;

  const ux = dx / len;
  const uy = dy / len;
  const halfW = Math.max(1, (sourceToken?.w ?? 100) / 2);
  const halfH = Math.max(1, (sourceToken?.h ?? 100) / 2);
  const edgeDistanceX = Math.abs(ux) > 0.0001 ? halfW / Math.abs(ux) : Infinity;
  const edgeDistanceY = Math.abs(uy) > 0.0001 ? halfH / Math.abs(uy) : Infinity;
  const edgeDistance = Math.min(edgeDistanceX, edgeDistanceY);

  return {
    x: sourceCenter.x + ux * edgeDistance,
    y: sourceCenter.y + uy * edgeDistance,
  };
}

function _alphaEdgePoint(token, mask, ux, uy, mode = "min") {
  if (!mask?.opaque?.length) return null;

  const center = _tokenCenter(token);
  const doc = token?.document ?? token;
  const texture = doc?.texture ?? {};
  const anchorX = Number(texture.anchorX ?? 0.5);
  const anchorY = Number(texture.anchorY ?? 0.5);
  const scaleX = Number(texture.scaleX ?? 1) || 1;
  const scaleY = Number(texture.scaleY ?? 1) || 1;
  const signX = scaleX < 0 ? -1 : 1;
  const signY = scaleY < 0 ? -1 : 1;
  const width = token?.w ?? ((doc?.width ?? 1) * (canvas?.grid?.size ?? 100));
  const height = token?.h ?? ((doc?.height ?? 1) * (canvas?.grid?.size ?? 100));
  const rotation = Number(doc?.rotation ?? token?.rotation ?? 0) * (Math.PI / 180);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  let best = null;
  let bestProjection = mode === "max" ? -Infinity : Infinity;
  for (const pixel of mask.opaque) {
    const u = (pixel.x + 0.5) / mask.width;
    const v = (pixel.y + 0.5) / mask.height;
    const localX = (u - anchorX) * width * Math.abs(scaleX) * signX;
    const localY = (v - anchorY) * height * Math.abs(scaleY) * signY;
    const offsetX = localX * cos - localY * sin;
    const offsetY = localX * sin + localY * cos;
    const projection = offsetX * ux + offsetY * uy;
    const isBetter = mode === "max" ? projection > bestProjection : projection < bestProjection;
    if (isBetter) {
      bestProjection = projection;
      best = {
        x: center.x + offsetX,
        y: center.y + offsetY,
      };
    }
  }
  return best;
}

function _targetEdgePoint(sourceCenter, targetToken, mask = null) {
  const targetCenter = _tokenCenter(targetToken);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const len = Math.hypot(dx, dy);
  const alphaPoint = len >= 1 ? _alphaEdgePoint(targetToken, mask, dx / len, dy / len, "min") : null;
  return alphaPoint
    ?? _targetRectEdgePoint(sourceCenter, targetToken);
}

function _sourceEdgePoint(sourceToken, targetCenter, mask = null) {
  const sourceCenter = _tokenCenter(sourceToken);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const len = Math.hypot(dx, dy);
  const alphaPoint = len >= 1 ? _alphaEdgePoint(sourceToken, mask, dx / len, dy / len, "max") : null;
  return alphaPoint
    ?? _sourceRectEdgePoint(sourceToken, targetCenter);
}

function _sourceAnchorPoint(sourceToken, targetCenter) {
  return getClosestShipTractorEmitterPoint(sourceToken, targetCenter);
}

function _sourceStartPoint(sourceToken, targetCenter, mask = null) {
  return _sourceAnchorPoint(sourceToken, targetCenter)
    ?? _sourceEdgePoint(sourceToken, targetCenter, mask);
}

function _resolveTokens() {
  const source = canvas.tokens?.controlled?.[0] ?? null;
  const target = Array.from(game.user?.targets ?? [])[0] ?? null;
  return { source, target };
}

function _readOptions(options = {}) {
  const preset = TRACTOR_BEAM_PRESETS[options.preset] ? options.preset : TRACTOR_BEAM_DEFAULTS.preset;
  const presetColor = TRACTOR_BEAM_PRESETS[preset]?.color ?? TRACTOR_BEAM_DEFAULTS.color;
  const edgeFeather = Number(options.edgeFeather);
  return {
    preset,
    color: _normalizeHex(options.color, presetColor),
    placement: options.placement === "below" ? "below" : "above",
    adaptiveSizing: options.adaptiveSizing !== false,
    duration: _clamp(Number(options.duration) || TRACTOR_BEAM_DEFAULTS.duration, 500, 60000),
    sourceWidth: _clamp(Number(options.sourceWidth) || TRACTOR_BEAM_DEFAULTS.sourceWidth, 8, 400),
    coneWidth: _clamp(Number(options.coneWidth) || TRACTOR_BEAM_DEFAULTS.coneWidth, 60, 900),
    edgeFeather: _clamp(Number.isFinite(edgeFeather) ? edgeFeather : TRACTOR_BEAM_DEFAULTS.edgeFeather, 0, 180),
    targetBubble: options.targetBubble !== false,
    targetEnvelope: options.targetEnvelope === true,
    opacity: _clamp(Number(options.opacity) || TRACTOR_BEAM_DEFAULTS.opacity, 0.05, 1),
    pulseSpeed: _clamp(Number(options.pulseSpeed) || TRACTOR_BEAM_DEFAULTS.pulseSpeed, 0.1, 6),
    lineCount: _clamp(Math.round(Number(options.lineCount) || TRACTOR_BEAM_DEFAULTS.lineCount), 1, 24),
    oscillationAmplitude: _clamp(Number(options.oscillationAmplitude) || TRACTOR_BEAM_DEFAULTS.oscillationAmplitude, 0, 160),
    oscillationSpeed: _clamp(Number(options.oscillationSpeed) || TRACTOR_BEAM_DEFAULTS.oscillationSpeed, 0, 8),
  };
}

function _drawBeam(glow, body, lines, rings, geometry, opts, elapsedSeconds) {
  const color = _hexToInt(opts.color);
  const len = geometry.length;
  const targetHalf = Math.max(30, geometry.coneWidth / 2);
  const sourceWidth = opts.adaptiveSizing ? 2 : opts.sourceWidth;
  const sourceHalf = Math.max(1, Math.min(targetHalf * 0.85, sourceWidth / 2));
  const feather = Math.max(0, opts.edgeFeather ?? 0);
  const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * opts.pulseSpeed * Math.PI * 2);
  const alpha = opts.opacity * (0.72 + pulse * 0.28);
  const scalePulse = 1 + (pulse - 0.5) * 0.10;

  glow.scale.y = scalePulse;
  body.scale.y = scalePulse;
  lines.scale.y = scalePulse;

  _clearGraphics(glow);
  _clearGraphics(body);
  _clearGraphics(lines);
  _clearGraphics(rings);

  const targetFadeDepth = feather > 0
    ? Math.min(len * 0.34, Math.max(20, feather * 1.9 + 16))
    : 0;
  const targetFadeN = targetFadeDepth > 0 ? _clamp(targetFadeDepth / len, 0.02, 0.34) : 0;
  const bodyEndN = 1 - targetFadeN;
  const halfAt = n => sourceHalf + (targetHalf - sourceHalf) * n;

  if (feather > 0) {
    const capDepth = Math.min(len * 0.38, feather * 2.4 + 22);

    for (let i = 4; i >= 1; i--) {
      const t = i / 4;
      const targetSpread = feather * t;
      const capAlpha = alpha * (0.055 * (1 - t) + 0.018);
      const innerN = capDepth / len;
      const innerHalf = sourceHalf + (targetHalf - sourceHalf) * Math.max(0, 1 - innerN);
      _fillPolygon(glow, [
        len - capDepth, -innerHalf,
        len, -(targetHalf + targetSpread),
        len, targetHalf + targetSpread,
        len - capDepth, innerHalf,
      ], color, capAlpha);
    }
  }

  const bodyEndX = len * bodyEndN;
  const bodyEndHalf = halfAt(bodyEndN);

  _fillPolygon(body, [
    0, -sourceHalf,
    bodyEndX, -bodyEndHalf,
    bodyEndX, bodyEndHalf,
    0, sourceHalf,
  ], color, alpha * 0.20);

  _fillPolygon(body, [
    0, -sourceHalf * 0.55,
    bodyEndX, -bodyEndHalf * 0.58,
    bodyEndX, bodyEndHalf * 0.58,
    0, sourceHalf * 0.55,
  ], 0xffffff, alpha * 0.10);

  if (targetFadeN > 0) {
    const fadeSteps = 8;
    for (let i = 0; i < fadeSteps; i++) {
      const n0 = bodyEndN + (i / fadeSteps) * targetFadeN;
      const n1 = bodyEndN + ((i + 1) / fadeSteps) * targetFadeN;
      const x0 = len * n0;
      const x1 = len * n1;
      const half0 = halfAt(n0);
      const half1 = halfAt(n1);
      const fadeT = 1 - ((i + 1) / fadeSteps);
      const fadeAlpha = alpha * 0.20 * (0.18 + 0.82 * (fadeT ** 1.45));
      _fillPolygon(body, [
        x0, -half0,
        x1, -half1,
        x1, half1,
        x0, half0,
      ], color, fadeAlpha);

      _fillPolygon(body, [
        x0, -half0 * 0.58,
        x1, -half1 * 0.58,
        x1, half1 * 0.58,
        x0, half0 * 0.58,
      ], 0xffffff, fadeAlpha * 0.50);
    }
  }

  const edgeAlpha = alpha * (0.65 - Math.min(0.45, feather / 400));
  _strokePath(body, [0, -sourceHalf, bodyEndX, -bodyEndHalf], 2, color, edgeAlpha);
  _strokePath(body, [0, sourceHalf, bodyEndX, bodyEndHalf], 2, color, edgeAlpha);

  const count = opts.lineCount;
  for (let i = 0; i < count; i++) {
    const centered = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const targetY = centered * targetHalf * 0.78;
    const points = [];
    const phase = i * 0.72;
    for (let s = 0; s <= 14; s++) {
      const n = s / 14;
      const x = len * n;
      const beamN = x / len;
      const localHalf = sourceHalf + (targetHalf - sourceHalf) * beamN;
      const wave = Math.sin(elapsedSeconds * opts.oscillationSpeed * Math.PI * 2 + phase + n * Math.PI * 3.2);
      const ripple = Math.sin(elapsedSeconds * opts.oscillationSpeed * Math.PI + phase * 1.7 + n * Math.PI * 7);
      const y = _clamp(targetY * beamN + (wave * 0.75 + ripple * 0.25) * opts.oscillationAmplitude * beamN, -localHalf * 0.88, localHalf * 0.88);
      points.push(x, y);
    }
    const bright = i % 3 === 0 ? 0xffffff : color;
    const lineAlpha = alpha * (i % 3 === 0 ? 0.62 : 0.45);
    _strokePath(lines, points, i % 3 === 0 ? 1.6 : 1.1, bright, lineAlpha);
  }

}

function _drawTargetBubble(bubble, targetToken, opts, elapsedSeconds) {
  const color = _hexToInt(opts.color);
  const center = _tokenCenter(targetToken);
  const { rx, ry } = _targetBubbleRadii(targetToken);
  const padding = Math.max(6, Math.min(rx, ry) * 0.08);
  const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * opts.pulseSpeed * Math.PI * 2);
  const alpha = opts.opacity * (0.72 + pulse * 0.28);
  const doc = targetToken?.document ?? targetToken;

  bubble.x = center.x;
  bubble.y = center.y;
  bubble.rotation = Number(doc?.rotation ?? targetToken?.rotation ?? 0) * (Math.PI / 180);

  _clearGraphics(bubble);
  _fillEllipse(bubble, 0, 0, rx, ry, color, alpha * 0.08);
  _ring(bubble, 0, 0, rx, ry, 2, color, alpha * 0.34);
  _ring(bubble, 0, 0, rx - padding, ry - padding, 1, 0xffffff, alpha * 0.18);
}

export class NativeTractorBeamVFX {
  static _active = null;

  static play(sourceToken, targetToken, options = {}) {
    if (!sourceToken || !targetToken) return null;
    NativeTractorBeamVFX.stopActive();

    const opts = _readOptions(options);
    let sourceAlphaMask = null;
    let targetAlphaMask = null;
    getTokenAlphaMask(tokenTextureSource(sourceToken)).then(mask => {
      sourceAlphaMask = mask;
    });
    getTokenAlphaMask(tokenTextureSource(targetToken)).then(mask => {
      targetAlphaMask = mask;
    });
    let sourcePoint = opts.adaptiveSizing
      ? _sourceStartPoint(sourceToken, _tokenCenter(targetToken), sourceAlphaMask)
      : _tokenCenter(sourceToken);
    let targetEdge = opts.targetBubble
      ? _targetBubbleBeamPoint(sourcePoint, targetToken)
      : _targetEdgePoint(sourcePoint, targetToken, targetAlphaMask);
    let dx = targetEdge.x - sourcePoint.x;
    let dy = targetEdge.y - sourcePoint.y;
    const length = Math.hypot(dx, dy);
    if (length < 8) return null;

    const layer = _effectLayer(opts.placement);
    const tokenZ = typeof sourceToken.zIndex === "number" ? sourceToken.zIndex : 0;
    const baseZ = opts.placement === "below"
      ? Math.min(-1000, tokenZ - 10_000)
      : Math.max(VFX_Z_BASE, tokenZ + 10_000);
    const color = _hexToInt(opts.color);

    const container = new PIXI.Container();
    container.x = sourcePoint.x;
    container.y = sourcePoint.y;
    container.rotation = Math.atan2(dy, dx);
    container.zIndex = baseZ;
    container.blendMode = _addBlend();

    const initialConeWidth = opts.adaptiveSizing ? _adaptiveEnvelopeConeWidth(targetToken, opts) : opts.coneWidth;
    const glow = new PIXI.Graphics();
    const body = new PIXI.Graphics();
    const lines = new PIXI.Graphics();
    const rings = new PIXI.Graphics();
    glow.blendMode = _addBlend();
    body.blendMode = _addBlend();
    lines.blendMode = _addBlend();
    rings.blendMode = _addBlend();
    container.addChild(glow, body, lines, rings);

    try {
      const GF = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
      if (GF) {
        container.filters = [new GF({
          distance: 12,
          outerStrength: 1.9,
          innerStrength: 0.25,
          color,
          quality: 0.35,
        })];
      }
    } catch { /* optional */ }

    layer.addChild(container);

    const targetBubble = new PIXI.Graphics();
    targetBubble.blendMode = _addBlend();
    targetBubble.zIndex = baseZ + 1;
    layer.addChild(targetBubble);

    const geometry = { length, coneWidth: initialConeWidth };
    const started = performance.now();
    let stopped = false;
    let timeoutId = null;

    const tick = () => {
      if (stopped) return;
      if (!_isLiveToken(sourceToken) || !_isLiveToken(targetToken)) {
        handle.stop();
        return;
      }

      sourcePoint = opts.adaptiveSizing
        ? _sourceStartPoint(sourceToken, _tokenCenter(targetToken), sourceAlphaMask)
        : _tokenCenter(sourceToken);
      targetEdge = opts.targetBubble
        ? _targetBubbleBeamPoint(sourcePoint, targetToken)
        : _targetEdgePoint(sourcePoint, targetToken, targetAlphaMask);
      dx = targetEdge.x - sourcePoint.x;
      dy = targetEdge.y - sourcePoint.y;
      geometry.length = Math.hypot(dx, dy);
      if (geometry.length < 8) {
        handle.stop();
        return;
      }
      geometry.coneWidth = opts.adaptiveSizing ? _adaptiveEnvelopeConeWidth(targetToken, opts) : opts.coneWidth;
      container.x = sourcePoint.x;
      container.y = sourcePoint.y;
      container.rotation = Math.atan2(dy, dx);

      const elapsedSeconds = (performance.now() - started) / 1000;
      _drawBeam(glow, body, lines, rings, geometry, opts, elapsedSeconds);
      if (opts.targetBubble) _drawTargetBubble(targetBubble, targetToken, opts, elapsedSeconds);
      else _clearGraphics(targetBubble);
    };

    const handle = {
      container,
      targetBubble,
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        try { canvas.app.ticker.remove(tick); } catch { /* optional */ }
        try { container.parent?.removeChild(container); } catch { /* optional */ }
        try { targetBubble.parent?.removeChild(targetBubble); } catch { /* optional */ }
        try { container.destroy({ children: true }); } catch { /* optional */ }
        try { targetBubble.destroy(); } catch { /* optional */ }
        if (NativeTractorBeamVFX._active === handle) NativeTractorBeamVFX._active = null;
      },
    };

    NativeTractorBeamVFX._active = handle;
    canvas.app.ticker.add(tick);
    tick();
    timeoutId = window.setTimeout(handle.stop, opts.duration);
    return handle;
  }

  static testSelectedToTargeted(options = {}) {
    if (!game.user?.isGM) {
      ui.notifications.warn("STA2e Toolkit: Only the GM can preview tractor beam VFX.");
      return null;
    }

    const { source, target } = _resolveTokens();
    if (!source) {
      ui.notifications.warn("STA2e Toolkit: Select a source token before testing tractor beam VFX.");
      return null;
    }
    if (!target) {
      ui.notifications.warn("STA2e Toolkit: Target a token before testing tractor beam VFX.");
      return null;
    }
    if (source.id === target.id) {
      ui.notifications.warn("STA2e Toolkit: Source and target tokens must be different.");
      return null;
    }

    const handle = NativeTractorBeamVFX.play(source, target, {
      ...getMergedTractorBeamVfxSettings(),
      ...options,
    });
    if (handle) ui.notifications.info(`STA2e Toolkit: Tractor beam VFX preview started from ${source.name} to ${target.name}.`);
    return handle;
  }

  static stopActive() {
    NativeTractorBeamVFX._active?.stop?.();
  }

  static hasActive() {
    return !!NativeTractorBeamVFX._active;
  }
}

export function getTractorBeamVfxDefaults() {
  return foundry.utils.deepClone(TRACTOR_BEAM_DEFAULTS);
}

export function getTractorBeamVfxPresets() {
  return Object.entries(TRACTOR_BEAM_PRESETS).map(([id, preset]) => ({ id, ...preset }));
}

export function normalizeTractorBeamVfxSettings(options = {}) {
  return _readOptions({ ...TRACTOR_BEAM_DEFAULTS, ...options });
}

export function getMergedTractorBeamVfxSettings() {
  const worldDefaults = (() => {
    try { return game.settings.get(MODULE, TRACTOR_BEAM_WORLD_SETTING) ?? {}; }
    catch { return {}; }
  })();
  const clientOverrides = (() => {
    try { return game.settings.get(MODULE, TRACTOR_BEAM_CLIENT_SETTING) ?? {}; }
    catch { return {}; }
  })();
  return normalizeTractorBeamVfxSettings({
    ...TRACTOR_BEAM_DEFAULTS,
    ...worldDefaults,
    ...clientOverrides,
  });
}

export async function saveTractorBeamVfxClientSettings(options = {}) {
  await game.settings.set(MODULE, TRACTOR_BEAM_CLIENT_SETTING, normalizeTractorBeamVfxSettings(options));
}

export async function saveTractorBeamVfxWorldSettings(options = {}) {
  await game.settings.set(MODULE, TRACTOR_BEAM_WORLD_SETTING, normalizeTractorBeamVfxSettings(options));
}

export async function resetTractorBeamVfxClientSettings() {
  await game.settings.set(MODULE, TRACTOR_BEAM_CLIENT_SETTING, {});
}
