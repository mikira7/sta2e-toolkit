/**
 * sta2e-toolkit | tractor-beam-vfx.js
 *
 * Native Foundry/PIXI tractor beam renderer for previews and live tractor locks.
 */

import {
  getClosestShipTractorEmitterPoint,
  getShipTractorBeamSettings,
  getTokenAlphaMask,
  resolveTractorFactionColorHex,
  tokenTextureSource,
} from "./ship-vfx-anchors.js";

export { TRACTOR_FACTION_COLORS } from "./ship-vfx-anchors.js";

const MODULE = "sta2e-toolkit";
const VFX_Z_BASE = 910_000;
const TRACTOR_TARGET_CAP_COVERAGE = 0.60;

export const TRACTOR_BEAM_PRESETS = {
  starfleet: { label: "Starfleet Blue", color: "#44bbff" },
  violet:    { label: "Blue Violet",    color: "#7788ff" },
  emerald:   { label: "Emerald",        color: "#33dd88" },
  amber:     { label: "Amber",          color: "#ffaa33" },
  crimson:   { label: "Crimson",        color: "#ff5544" },
};

export const TRACTOR_BEAM_DEFAULTS = {
  preset: "starfleet",
  colorMode: "auto",
  color: TRACTOR_BEAM_PRESETS.starfleet.color,
  placement: "above",
  duration: 6000,
  opacity: 0.55,
  pulseSpeed: 1.35,
  rayLines: true,
  rayCount: 5,
  rayWidth: 2.4,
  rayFeather: 0.7,
  raySpeed: 0.8,
  rayOpacity: 0.85,
  rayShade: 0.55,
};

export const TRACTOR_BEAM_WORLD_SETTING = "tractorBeamVfxWorldDefaults";
export const TRACTOR_BEAM_CLIENT_SETTING = "tractorBeamVfxClientOverrides";
export const TRACTOR_BEAM_RENDERER_SETTING = "tractorBeamAnimationRenderer";

function _addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

function _hexToInt(hex, fallback = 0x44bbff) {
  const value = String(hex ?? "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) return fallback;
  return parseInt(value.slice(1), 16);
}

// Darkens a packed rgb int. Under ADD blending a darker color reads as a
// dimmer line, which is how the interior arcs stay subtler than the fill.
function _shadeInt(colorInt, factor) {
  const r = Math.round(((colorInt >> 16) & 0xff) * factor);
  const g = Math.round(((colorInt >> 8) & 0xff) * factor);
  const b = Math.round((colorInt & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function _normalizeHex(hex, fallback = TRACTOR_BEAM_DEFAULTS.color) {
  const value = String(hex ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Unlike `Number(x) || fallback`, keeps a legitimate 0.
function _num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function _strokePath(g, points, width, color, alpha, cap = null) {
  const style = cap ? { width, color, alpha, cap } : { width, color, alpha };
  if (typeof g.lineStyle === "function") {
    if (cap) g.lineStyle(style);
    else g.lineStyle(width, color, alpha);
  }
  else {
    g.setStrokeStyle?.(style);
  }

  g.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);

  if (typeof g.stroke === "function" && typeof g.lineStyle !== "function") {
    g.stroke(style);
  }
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

function _fitScale(fit, w, h, tw, th) {
  switch (fit) {
    case "fill":   return [w / tw, h / th];
    case "cover":  { const s = Math.max(w / tw, h / th); return [s, s]; }
    case "width":  { const s = w / tw; return [s, s]; }
    case "height": { const s = h / th; return [s, s]; }
    case "contain":
    default:       { const s = Math.min(w / tw, h / th); return [s, s]; }
  }
}

function _hasUsableSilhouette(mask) {
  const opaqueCount = mask?.opaqueSet?.size ?? mask?.opaque?.length ?? 0;
  const total = (mask?.width ?? 0) * (mask?.height ?? 0);
  // A fully opaque image gives us only the token rectangle, so use the
  // rectangular fallback rather than pretending it has a hull contour.
  return opaqueCount > 0 && total > 0 && opaqueCount < total;
}

function _maskPixelToCanvas(token, mask, pixel) {
  const center = _tokenCenter(token);
  const texture = token?.document?.texture ?? {};
  const [fx, fy] = _fitScale(texture.fit ?? "contain", token?.w ?? 1, token?.h ?? 1, mask.width, mask.height);
  const anchorX = Number(texture.anchorX ?? 0.5);
  const anchorY = Number(texture.anchorY ?? 0.5);
  const scaleX = Number(texture.scaleX ?? 1) || 1;
  const scaleY = Number(texture.scaleY ?? 1) || 1;
  const rotation = Number(token?.document?.rotation ?? token?.rotation ?? 0) * (Math.PI / 180);
  const localX = (pixel.x + 0.5 - anchorX * mask.width) * fx * scaleX;
  const localY = (pixel.y + 0.5 - anchorY * mask.height) * fy * scaleY;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + localX * cos - localY * sin,
    y: center.y + localX * sin + localY * cos,
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

function _median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function _pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 0.0001) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = _clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

// Keep only the bends that are visually meaningful at the token's current
// scale. This avoids building the fan from every alpha-mask pixel.
function _simplifyPolyline(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const segments = [[0, points.length - 1]];

  while (segments.length) {
    const [startIndex, endIndex] = segments.pop();
    let farthestIndex = -1;
    let farthestDistance = tolerance;
    for (let i = startIndex + 1; i < endIndex; i++) {
      const distance = _pointToSegmentDistance(points[i], points[startIndex], points[endIndex]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = i;
      }
    }
    if (farthestIndex >= 0) {
      keep[farthestIndex] = 1;
      segments.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }
  return points.filter((_point, index) => keep[index]);
}

function _segmentsCross(a, b, c, d) {
  const side = (start, end, point) => (end.x - start.x) * (point.y - start.y)
    - (end.y - start.y) * (point.x - start.x);
  const abC = side(a, b, c);
  const abD = side(a, b, d);
  const cdA = side(c, d, a);
  const cdB = side(c, d, b);
  return abC * abD < -0.0001 && cdA * cdB < -0.0001;
}

function _fanSelfIntersects(sourcePoint, contour) {
  const polygon = [sourcePoint, ...contour];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    for (let j = i + 1; j < polygon.length; j++) {
      // Neighboring edges intentionally meet at a shared endpoint.
      if (j === i || (i + 1) % polygon.length === j || (j + 1) % polygon.length === i) continue;
      const c = polygon[j];
      const d = polygon[(j + 1) % polygon.length];
      if (_segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

function _isValidFacingContour(contour, sourcePoint) {
  if (!Array.isArray(contour) || contour.length < 2 || !sourcePoint) return false;
  let span = 0;
  for (let i = 0; i < contour.length; i++) {
    const point = contour[i];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
    if (i) span += Math.hypot(point.x - contour[i - 1].x, point.y - contour[i - 1].y);
  }
  return span >= 2
    && !contour.every(point => Math.hypot(point.x - sourcePoint.x, point.y - sourcePoint.y) < 1)
    && !_fanSelfIntersects(sourcePoint, contour);
}

// Narrow the target cap to the central part of the hull it faces. This keeps
// tractor locks visually focused instead of spanning the full long ship edge.
function _limitFacingContourCoverage(sourcePoint, targetToken, contour, coverage = TRACTOR_TARGET_CAP_COVERAGE) {
  if (!Array.isArray(contour) || contour.length < 2) return null;
  const center = _tokenCenter(targetToken);
  const dx = center.x - sourcePoint.x;
  const dy = center.y - sourcePoint.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const px = -dy / length;
  const py = dx / length;
  const lateral = point => (point.x - sourcePoint.x) * px + (point.y - sourcePoint.y) * py;
  const samples = contour.map(point => ({ point, lateral: lateral(point) }));
  const minLateral = Math.min(...samples.map(sample => sample.lateral));
  const maxLateral = Math.max(...samples.map(sample => sample.lateral));
  const fullSpan = maxLateral - minLateral;
  const desiredSpan = fullSpan * _clamp(coverage, 0.1, 1);
  if (desiredSpan < 2 || desiredSpan >= fullSpan - 0.01) return contour;

  const centerLateral = _clamp(lateral(center), minLateral + desiredSpan / 2, maxLateral - desiredSpan / 2);
  const lower = centerLateral - desiredSpan / 2;
  const upper = centerLateral + desiredSpan / 2;
  const clipped = [];
  const addPoint = point => {
    const prior = clipped[clipped.length - 1];
    if (!prior || Math.hypot(point.x - prior.x, point.y - prior.y) > 0.01) clipped.push(point);
  };

  for (let i = 0; i < samples.length - 1; i++) {
    const current = samples[i];
    const next = samples[i + 1];
    if (i === 0 && current.lateral >= lower && current.lateral <= upper) addPoint(current.point);
    const crossings = [lower, upper]
      .filter(boundary => (current.lateral - boundary) * (next.lateral - boundary) < 0)
      .map(boundary => ({
        t: (boundary - current.lateral) / (next.lateral - current.lateral),
      }))
      .sort((a, b) => a.t - b.t);
    for (const { t } of crossings) {
      addPoint({
        x: current.point.x + (next.point.x - current.point.x) * t,
        y: current.point.y + (next.point.y - current.point.y) * t,
      });
    }
    if (next.lateral >= lower && next.lateral <= upper) addPoint(next.point);
  }
  return _isValidFacingContour(clipped, sourcePoint) ? clipped : null;
}

// Build a clean source-facing contour. The alpha mask is deliberately sampled
// in coarse lateral bins, then filtered and simplified, so anti-aliased hull
// pixels and tiny transparent notches cannot turn into a serrated beam cap.
function _targetFacingContour(sourcePoint, targetToken, mask) {
  if (!_hasUsableSilhouette(mask)) return null;
  const center = _tokenCenter(targetToken);
  const dx = center.x - sourcePoint.x;
  const dy = center.y - sourcePoint.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const ux = dx / length, uy = dy / length;
  const px = -uy, py = ux;
  const texture = targetToken?.document?.texture ?? {};
  const [fx, fy] = _fitScale(texture.fit ?? "contain", targetToken?.w ?? 1, targetToken?.h ?? 1, mask.width, mask.height);
  // Group roughly three mask pixels per slice. This stays adaptive to token
  // scale while preserving broad features such as saucers and nacelles.
  const binSize = Math.max(3, (Math.abs(fx) + Math.abs(fy)) * 1.5);
  const bins = new Map();

  for (const pixel of mask.opaque) {
    const point = _maskPixelToCanvas(targetToken, mask, pixel);
    const forward = (point.x - sourcePoint.x) * ux + (point.y - sourcePoint.y) * uy;
    const lateral = (point.x - sourcePoint.x) * px + (point.y - sourcePoint.y) * py;
    const key = Math.round(lateral / binSize);
    const prior = bins.get(key);
    if (!prior || forward < prior.forward) bins.set(key, { key, forward });
  }

  let profile = [...bins.values()].sort((a, b) => a.key - b.key);
  if (profile.length < 2) return null;

  // Ignore isolated bins caused by stray translucent pixels. Preserve very
  // short profiles so an otherwise valid small token can still render.
  if (profile.length > 2) {
    profile = profile.filter((entry, index, entries) => {
      const previous = entries[index - 1];
      const next = entries[index + 1];
      return (previous && entry.key - previous.key <= 2)
        || (next && next.key - entry.key <= 2);
    });
  }
  if (profile.length < 2) return null;

  // Reconstruct small gaps caused by coarse alpha sampling so the cap is a
  // continuous profile rather than a chain of tiny diagonal wedges.
  const bridged = [profile[0]];
  for (let i = 1; i < profile.length; i++) {
    const previous = profile[i - 1];
    const current = profile[i];
    const gap = current.key - previous.key;
    if (gap > 1 && gap <= 3) {
      for (let step = 1; step < gap; step++) {
        const ratio = step / gap;
        bridged.push({
          key: previous.key + step,
          forward: previous.forward + (current.forward - previous.forward) * ratio,
        });
      }
    }
    bridged.push(current);
  }

  // Median filtering rejects single-bin spikes; a light weighted pass then
  // rounds the remaining stair-steps without erasing major hull bends.
  const medianProfile = bridged.map((entry, index) => ({
    ...entry,
    forward: _median(bridged
      .slice(Math.max(0, index - 2), Math.min(bridged.length, index + 3))
      .map(sample => sample.forward)),
  }));
  const smoothed = medianProfile.map((entry, index) => {
    if (index === 0 || index === medianProfile.length - 1) return entry;
    const previous = medianProfile[index - 1];
    const next = medianProfile[index + 1];
    return {
      ...entry,
      forward: (previous.forward + entry.forward * 2 + next.forward) * 0.25,
    };
  });

  const contour = _simplifyPolyline(smoothed.map(entry => ({
    x: sourcePoint.x + ux * entry.forward + px * entry.key * binSize,
    y: sourcePoint.y + uy * entry.forward + py * entry.key * binSize,
  })), Math.max(2, binSize * 0.85));
  return _isValidFacingContour(contour, sourcePoint) ? contour : null;
}

function _targetRectFacingContour(sourcePoint, targetToken) {
  const center = _tokenCenter(targetToken);
  const dx = center.x - sourcePoint.x;
  const dy = center.y - sourcePoint.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const ux = dx / length, uy = dy / length;
  const px = -uy, py = ux;
  const rotation = Number(targetToken?.document?.rotation ?? targetToken?.rotation ?? 0) * (Math.PI / 180);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const halfW = Math.max(1, (targetToken?.w ?? 1) / 2);
  const halfH = Math.max(1, (targetToken?.h ?? 1) / 2);
  const corners = [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]].map(([x, y]) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  }));

  let edge = null;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const projection = ((a.x + b.x) * 0.5 - sourcePoint.x) * ux
      + ((a.y + b.y) * 0.5 - sourcePoint.y) * uy;
    if (!edge || projection < edge.projection) edge = { a, b, projection };
  }
  if (!edge) return null;
  return ((edge.a.x - sourcePoint.x) * px + (edge.a.y - sourcePoint.y) * py)
    <= ((edge.b.x - sourcePoint.x) * px + (edge.b.y - sourcePoint.y) * py)
    ? [edge.a, edge.b] : [edge.b, edge.a];
}

function _drawFacingBeam(graphics, sourcePoint, contour, opts, elapsedSeconds) {
  _clearGraphics(graphics);
  if (!sourcePoint || !Array.isArray(contour) || contour.length < 2) return;
  const color = _hexToInt(opts.color);
  const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * opts.pulseSpeed * Math.PI * 2);
  const alpha = opts.opacity * (0.32 + pulse * 0.20);
  const points = [sourcePoint.x, sourcePoint.y];
  for (const point of contour) points.push(point.x, point.y);

  _fillPolygon(graphics, points, color, alpha);
  _strokePath(graphics, [...points, sourcePoint.x, sourcePoint.y], 1.5, color, alpha * 0.9);
  _drawEmitterRays(graphics, sourcePoint, contour, opts, elapsedSeconds, color, alpha);
}

// Cumulative segment lengths along the contour, so rays can be spread evenly
// across the hull edge. The contour is Douglas-Peucker simplified, so its
// points are unevenly spaced and indexing into it directly would bunch rays
// wherever the silhouette is detailed.
function _contourLengths(contour) {
  const lengths = [0];
  for (let i = 1; i < contour.length; i++) {
    const dx = contour[i].x - contour[i - 1].x;
    const dy = contour[i].y - contour[i - 1].y;
    lengths.push(lengths[i - 1] + Math.hypot(dx, dy));
  }
  return lengths;
}

function _contourPointAt(contour, lengths, u) {
  const total = lengths[lengths.length - 1];
  if (!(total > 0)) return contour[0];
  const target = _clamp(u, 0, 1) * total;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < target) i++;
  const span = lengths[i] - lengths[i - 1];
  const localT = span > 0 ? (target - lengths[i - 1]) / span : 0;
  const a = contour[i - 1];
  const b = contour[i];
  return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
}

// Soft edges come from stacking strokes rather than from a filter: a wide dim
// halo, a mid pass, then the bright core. Under ADD blending those sum into a
// falloff across the ray's width, which is what sells it as light instead of a
// drawn line. Widest first so the core lands on top.
function _featherPasses(feather) {
  if (feather <= 0.01) return [{ widthMul: 1, alphaMul: 1 }];
  return [
    { widthMul: 1 + 3.4 * feather, alphaMul: 0.14 * feather },
    { widthMul: 1 + 1.5 * feather, alphaMul: 0.30 * feather },
    { widthMul: 1, alphaMul: 1 },
  ];
}

// Discrete rays fanning out from the emitter to the target's hull edge, the
// way a screen-accurate tractor beam reads. Each ray breathes on its own phase
// offset so the fan shimmers instead of blinking in unison.
function _drawEmitterRays(graphics, sourcePoint, contour, opts, elapsedSeconds, color, alpha) {
  if (!opts.rayLines || opts.rayCount < 1) return;
  const rayColor = _shadeInt(color, opts.rayShade);
  const lengths = _contourLengths(contour);
  const passes = _featherPasses(opts.rayFeather);

  for (let i = 0; i < opts.rayCount; i++) {
    // Interior positions only — the outermost rays would sit on the wedge
    // outline that is already stroked.
    const u = (i + 1) / (opts.rayCount + 1);
    const phase = elapsedSeconds * opts.raySpeed - i / opts.rayCount;
    const breath = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
    const rayAlpha = alpha * opts.rayOpacity * breath;
    if (rayAlpha <= 0.002) continue;

    const tip = _contourPointAt(contour, lengths, u);
    const line = [sourcePoint.x, sourcePoint.y, tip.x, tip.y];
    for (const pass of passes) {
      _strokePath(graphics, line, opts.rayWidth * pass.widthMul, rayColor, rayAlpha * pass.alphaMul, "round");
    }
  }
}

function _resolveTokens() {
  const source = canvas.tokens?.controlled?.[0] ?? null;
  const target = Array.from(game.user?.targets ?? [])[0] ?? null;
  return { source, target };
}

function _readOptions(options = {}) {
  const preset = TRACTOR_BEAM_PRESETS[options.preset] ? options.preset : TRACTOR_BEAM_DEFAULTS.preset;
  const presetColor = TRACTOR_BEAM_PRESETS[preset]?.color ?? TRACTOR_BEAM_DEFAULTS.color;
  return {
    preset,
    colorMode: options.colorMode === "custom" ? "custom" : "auto",
    color: _normalizeHex(options.color, presetColor),
    placement: options.placement === "below" ? "below" : "above",
    duration: _clamp(Number(options.duration) || TRACTOR_BEAM_DEFAULTS.duration, 500, 60000),
    opacity: _clamp(Number(options.opacity) || TRACTOR_BEAM_DEFAULTS.opacity, 0.05, 1),
    pulseSpeed: _clamp(Number(options.pulseSpeed) || TRACTOR_BEAM_DEFAULTS.pulseSpeed, 0.1, 6),
    rayLines: options.rayLines !== false,
    rayCount: Math.round(_clamp(_num(options.rayCount, TRACTOR_BEAM_DEFAULTS.rayCount), 0, 24)),
    rayWidth: _clamp(_num(options.rayWidth, TRACTOR_BEAM_DEFAULTS.rayWidth), 0.5, 10),
    rayFeather: _clamp(_num(options.rayFeather, TRACTOR_BEAM_DEFAULTS.rayFeather), 0, 1),
    raySpeed: _clamp(_num(options.raySpeed, TRACTOR_BEAM_DEFAULTS.raySpeed), 0.05, 4),
    rayOpacity: _clamp(_num(options.rayOpacity, TRACTOR_BEAM_DEFAULTS.rayOpacity), 0, 1),
    rayShade: _clamp(_num(options.rayShade, TRACTOR_BEAM_DEFAULTS.rayShade), 0.1, 1),
  };
}

// Faction tint for the emitting ship. Custom mode passes the configured hex
// straight through.
export function resolveTractorBeamColorHex(sourceToken, opts = {}) {
  if (opts.colorMode === "custom") return _normalizeHex(opts.color);
  return resolveTractorFactionColorHex(sourceToken);
}

// Resolution order: a ship's own settings (when it opts in via the Tractor tab
// of the ship VFX editor) win over the global world/client values, and the
// faction tint fills in whenever the winning layer is on "auto" color.
function _resolveBeamOptions(sourceToken, options) {
  const ship = (() => {
    try { return getShipTractorBeamSettings(sourceToken); }
    catch { return null; }
  })();

  if (ship?.override) {
    const { override, customColor, ...shipOptions } = ship;
    options = { ...options, ...shipOptions, color: customColor || options.color };
  }

  const opts = _readOptions(options);
  if (opts.colorMode === "auto") opts.color = resolveTractorBeamColorHex(sourceToken, opts);
  return opts;
}

export class NativeTractorBeamVFX {
  static _active = null;
  static _persistent = new Map();

  static play(sourceToken, targetToken, options = {}) {
    if (!sourceToken || !targetToken) return null;
    const persistentKey = options.persistentKey ?? null;
    if (persistentKey) NativeTractorBeamVFX.stopPersistent(persistentKey);
    else NativeTractorBeamVFX.stopActive();

    const opts = _resolveBeamOptions(sourceToken, options);
    let sourceAlphaMask = null;
    let targetAlphaMask = null;
    let sourceTextureSrc = null;
    let targetTextureSrc = null;
    const refreshMasks = () => {
      const nextSourceSrc = tokenTextureSource(sourceToken);
      if (nextSourceSrc !== sourceTextureSrc) {
        sourceTextureSrc = nextSourceSrc;
        sourceAlphaMask = null;
        getTokenAlphaMask(nextSourceSrc).then(mask => {
          if (sourceTextureSrc === nextSourceSrc) sourceAlphaMask = mask;
        }).catch(() => {});
      }
      const nextTargetSrc = tokenTextureSource(targetToken);
      if (nextTargetSrc !== targetTextureSrc) {
        targetTextureSrc = nextTargetSrc;
        targetAlphaMask = null;
        getTokenAlphaMask(nextTargetSrc).then(mask => {
          if (targetTextureSrc === nextTargetSrc) targetAlphaMask = mask;
        }).catch(() => {});
      }
    };
    refreshMasks();
    let sourcePoint = _sourceStartPoint(sourceToken, _tokenCenter(targetToken), sourceAlphaMask);
    let targetContour = _limitFacingContourCoverage(sourcePoint, targetToken,
      _targetFacingContour(sourcePoint, targetToken, targetAlphaMask)
        ?? _targetRectFacingContour(sourcePoint, targetToken));
    if (!targetContour) return null;

    const layer = _effectLayer(opts.placement);
    const tokenZ = typeof sourceToken.zIndex === "number" ? sourceToken.zIndex : 0;
    const baseZ = opts.placement === "below"
      ? Math.min(-1000, tokenZ - 10_000)
      : Math.max(VFX_Z_BASE, tokenZ + 10_000);
    const container = new PIXI.Container();
    container.zIndex = baseZ;
    container.blendMode = _addBlend();

    const body = new PIXI.Graphics();
    body.blendMode = _addBlend();
    container.addChild(body);

    layer.addChild(container);
    const started = performance.now();
    let stopped = false;
    let timeoutId = null;

    const tick = () => {
      if (stopped) return;
      if (!_isLiveToken(sourceToken) || !_isLiveToken(targetToken)) {
        handle.stop();
        return;
      }

      refreshMasks();
      sourcePoint = _sourceStartPoint(sourceToken, _tokenCenter(targetToken), sourceAlphaMask);
      targetContour = _limitFacingContourCoverage(sourcePoint, targetToken,
        _targetFacingContour(sourcePoint, targetToken, targetAlphaMask)
          ?? _targetRectFacingContour(sourcePoint, targetToken));
      if (!targetContour) {
        handle.stop();
        return;
      }

      const elapsedSeconds = (performance.now() - started) / 1000;
      _drawFacingBeam(body, sourcePoint, targetContour, opts, elapsedSeconds);
    };

    const handle = {
      container,
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        try { canvas.app.ticker.remove(tick); } catch { /* optional */ }
        try { container.parent?.removeChild(container); } catch { /* optional */ }
        try { container.destroy({ children: true }); } catch { /* optional */ }
        if (NativeTractorBeamVFX._active === handle) NativeTractorBeamVFX._active = null;
        if (persistentKey && NativeTractorBeamVFX._persistent.get(persistentKey) === handle) {
          NativeTractorBeamVFX._persistent.delete(persistentKey);
        }
      },
    };

    if (persistentKey) NativeTractorBeamVFX._persistent.set(persistentKey, handle);
    else NativeTractorBeamVFX._active = handle;
    canvas.app.ticker.add(tick);
    tick();
    if (!persistentKey) timeoutId = window.setTimeout(handle.stop, opts.duration);
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

  static stopPersistent(key) {
    NativeTractorBeamVFX._persistent.get(key)?.stop?.();
  }

  static stopAllPersistent() {
    for (const handle of [...NativeTractorBeamVFX._persistent.values()]) handle.stop?.();
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

export function getTractorBeamAnimationRenderer() {
  try {
    return game.settings.get(MODULE, TRACTOR_BEAM_RENDERER_SETTING) === "pixi" ? "pixi" : "jb2a";
  } catch {
    return "jb2a";
  }
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
  refreshPersistentTractorBeamVfx();
}

export async function saveTractorBeamVfxWorldSettings(options = {}) {
  await game.settings.set(MODULE, TRACTOR_BEAM_WORLD_SETTING, normalizeTractorBeamVfxSettings(options));
  refreshPersistentTractorBeamVfx();
}

export async function resetTractorBeamVfxClientSettings() {
  await game.settings.set(MODULE, TRACTOR_BEAM_CLIENT_SETTING, {});
  refreshPersistentTractorBeamVfx();
}

export function getPersistentTractorBeamKey(sourceToken) {
  return `sta2e-tractor-beam-pixi-${sourceToken?.id ?? "unknown"}`;
}

export function refreshPersistentTractorBeamVfx() {
  NativeTractorBeamVFX.stopAllPersistent();
  if (!canvas?.ready) return;
  const opts = getMergedTractorBeamVfxSettings();
  const usePixiBeam = getTractorBeamAnimationRenderer() === "pixi";

  if (!usePixiBeam) return;
  for (const source of canvas.tokens?.placeables ?? []) {
    const state = source.document?.getFlag(MODULE, "tractorBeam");
    const target = state?.targetTokenId ? canvas.tokens?.get(state.targetTokenId) : null;
    if (!target) continue;
    NativeTractorBeamVFX.play(source, target, {
      ...opts,
      persistentKey: getPersistentTractorBeamKey(source),
    });
  }
}

/**
 * Did this token update touch the tractor flag?
 *
 * Both spellings have to be tested. `setFlag` — engaging the beam — puts the
 * plain key in the diff, but `releaseTractorBeam` clears it with `unsetFlag`,
 * which Foundry expresses as the `-=key` deletion form instead. Testing only
 * the plain key meant release never reached the clients that were not the one
 * releasing: `CombatHUD.releaseTractorBeam` stops the beam directly for the GM
 * who clicked, and everyone else depends entirely on this hook, so the beam
 * stayed drawn on every player's screen until the next canvas load.
 *
 * Same test as the scene flag watcher in token-elevation-display.js.
 */
function _tractorFlagChanged(changes) {
  const get = foundry.utils.getProperty;
  return get(changes, `flags.${MODULE}.tractorBeam`) !== undefined
      || get(changes, `flags.${MODULE}.-=tractorBeam`) !== undefined;
}

let _tractorVfxHooksRegistered = false;

export function registerTractorBeamVfxHooks() {
  if (_tractorVfxHooksRegistered) return;
  _tractorVfxHooksRegistered = true;

  Hooks.on("canvasReady", () => refreshPersistentTractorBeamVfx());
  Hooks.on("canvasTearDown", () => NativeTractorBeamVFX.stopAllPersistent());
  Hooks.on("updateToken", (_tokenDoc, changes) => {
    if (_tractorFlagChanged(changes)) {
      refreshPersistentTractorBeamVfx();
    }
  });
  Hooks.on("deleteToken", () => refreshPersistentTractorBeamVfx());
  // Per-ship beam overrides live on the ship VFX anchors flag, so a live beam
  // has to be rebuilt when the GM edits them in the Tractor tab.
  Hooks.on("updateActor", (_actor, changes) => {
    if (changes.flags?.[MODULE]?.shipVfxAnchors !== undefined) {
      refreshPersistentTractorBeamVfx();
    }
  });
  Hooks.on("updateSetting", setting => {
    const key = setting?.key ?? "";
    if (key === `${MODULE}.${TRACTOR_BEAM_WORLD_SETTING}`
      || key === `${MODULE}.${TRACTOR_BEAM_CLIENT_SETTING}`
      || key === `${MODULE}.${TRACTOR_BEAM_RENDERER_SETTING}`) {
      refreshPersistentTractorBeamVfx();
    }
  });
}
