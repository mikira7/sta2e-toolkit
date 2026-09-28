/** Breach exhaust: sources follow the rendered hull; emitted gas stays in scene space. */
import { getShipEngineEmitters, getShipBreachEmitters, getShipBreachTrailSettings, normalizeBreachTrailSettings, shipEngineEmitterToCanvasPoint } from './ship-vfx-anchors.js';
import { createBreachSmokeRenderer, MAX_BREACH_PUFFS } from './breach-smoke-shader.js';

const MODULE = 'sta2e-toolkit';
const active = new Map();
export function getBreachTrailRenderer() {
  try { return game.settings.get(MODULE, 'breachTrailRenderer') || 'jb2a'; }
  catch { return 'jb2a'; }
}

export function stopNativeBreachTrail(token) {
  active.get(token?.id ?? token)?.destroy();
}

// TokenDocument already holds the destination during Foundry animations.
// Sample the placeable and rendered mesh so origins track the visible ship.
function renderedToken(token) {
  const rotation = Number.isFinite(token.mesh?.rotation)
    ? token.mesh.rotation * 180 / Math.PI : (token.document?.rotation ?? 0);
  return {
    document: { rotation, texture: token.document?.texture },
    center: token.center, w: token.w, h: token.h, mesh: token.mesh,
  };
}

function displayedDimensions(sample) {
  const corner = shipEngineEmitterToCanvasPoint(sample, { x: 0, y: 0 });
  const right = shipEngineEmitterToCanvasPoint(sample, { x: 1, y: 0 });
  const bottom = shipEngineEmitterToCanvasPoint(sample, { x: 0, y: 1 });
  const width = Math.max(1, Math.hypot(right.x-corner.x, right.y-corner.y));
  const height = Math.max(1, Math.hypot(bottom.x-corner.x, bottom.y-corner.y));
  return { width, height, span: Math.max(width, height) };
}

// Large plumes billow slowly. Stretch time, not the trajectory: dividing
// speed and drag by this factor and multiplying lifetime preserves reach.
function flowTimeScale(span) {
  const grid = Math.max(1, Number(canvas.grid?.size) || 100);
  return Math.max(1, Math.sqrt(span / grid));
}

export function getBreachTrailPreviewDuration(token, _mode, settings) {
  const { span } = displayedDimensions(renderedToken(token));
  const length = normalizeBreachTrailSettings(settings).length;
  return Math.min(30000, Math.ceil((3500 * length * flowTimeScale(span) + 2000) / 1000) * 1000);
}

export function resolveBreachTrailEmitters(token, mode, authored = getShipBreachEmitters(token)) {
  if (authored.length) return authored.slice(0, 4);
  const nacelles = mode === 'plasma' ? [] : getShipEngineEmitters(token, 'warp');
  // Ship artwork faces down, so aft exhaust points up (0 degrees).
  // Preserve nacelle positions, but never inherit a forward curve tangent.
  return nacelles.length ? nacelles.slice(0, 4).map(a => ({ ...a, facingDeg: 0 }))
    : [{ x: 0.5, y: 0.68, facingDeg: 0 }];
}

export function startNativeBreachTrail(token, options = {}) {
  const mode = options.mode ?? getBreachTrailRenderer();
  if (!token || mode === 'jb2a' || !globalThis.canvas?.app?.ticker || !globalThis.PIXI) return;
  const key = options.preview ? `preview:${token.id}` : token.id;
  const anchors = resolveBreachTrailEmitters(token, mode, options.emitters);
  const settings = normalizeBreachTrailSettings(options.settings ?? getShipBreachTrailSettings(token));
  const length = settings.length;
  const signature = JSON.stringify({ anchors, settings });
  const existing = active.get(key);
  if (!options.preview && existing?.mode === mode && existing.token === token && existing.signature === signature) return existing;
  existing?.destroy();
  const plasma = mode === 'plasma';
  const layer = canvas.tokens ?? canvas.interface;
  if (!layer) return;
  const container = new PIXI.Container();
  container.zIndex = -900000;
  container.eventMode = 'none';
  layer.sortableChildren = true;
  const visual = createBreachSmokeRenderer(plasma);
  container.addChild(visual.display); layer.addChild(container);
  const ticker = canvas.app.ticker, scene = canvas.scene;
  const puffs = [];
  const started = performance.now();
  let previous = started, accumulator = 0, destroyed = false;
  let previousInterval = null;
  let flowPhase = 0;
  let previousHeads = null;
  const handle = { token, mode, signature, destroy() {
    if (destroyed) return;
    destroyed = true; ticker.remove(tick);
    visual.destroy(); container.destroy({ children: true });
    if (active.get(key) === handle) active.delete(key);
  } };
  const tick = () => {
    if (canvas.scene !== scene || token.destroyed || container.destroyed || !token.document) return handle.destroy();
    const now = performance.now(), elapsed = Math.max(0, now - previous);
    if (options.duration && now - started >= options.duration) return handle.destroy();
    previous = now;
    // Age fully across a suspended tab, but never emit a catch-up burst.
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; p.age += elapsed;
      if (p.age >= p.life) { puffs.splice(i, 1); continue; }
      const dt = elapsed / 1000;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const drag = Math.exp(-dt * p.drag); p.vx *= drag; p.vy *= drag;
    }
    const sample = renderedToken(token);
    // Measure the displayed artwork in scene space, including texture fit,
    // independent X/Y scale, mirroring and rotation. Re-sample every tick so
    // resizing an active ship affects new gas without moving existing puffs.
    const { width, height, span } = displayedDimensions(sample);
    const timeScale = flowTimeScale(span);
    // The glow and gas share one clock. Longer/larger plumes slow both,
    // including the core's turbulent pattern, without phase jumps on resize.
    flowPhase += Math.min(100, elapsed) / (1000 * length * timeScale);
    // Keep slender ships' exhaust visible too; no fixed pixel ceiling.
    const size = Math.max(6, Math.min(width, height) * 0.085, span * 0.035);
    const heads = anchors.map(a => {
      const point = shipEngineEmitterToCanvasPoint(sample, a);
      // Transform a second local point to include image flips and fit in the heading.
      const angle = ((a.facingDeg ?? 0) - 90) * Math.PI / 180;
      // Measure around image center so an anchor on the image edge cannot
      // clamp the directional sample into a zero-length vector.
      const origin = shipEngineEmitterToCanvasPoint(sample, { x: 0.5, y: 0.5 });
      const tip = shipEngineEmitterToCanvasPoint(sample, { x: 0.5 + Math.cos(angle)*0.01, y: 0.5 + Math.sin(angle)*0.01 });
      // Distance to the image edge along this vent's direction. A central
      // underside vent must travel farther before its plume clears the hull.
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const edgeX = Math.abs(dx) < 1e-6 ? Infinity : (dx > 0 ? 1-a.x : -a.x) / dx;
      const edgeY = Math.abs(dy) < 1e-6 ? Infinity : (dy > 0 ? 1-a.y : -a.y) / dy;
      const toEdge = Math.max(0, Math.min(edgeX, edgeY));
      const clearance = Math.hypot(dx * toEdge * width, dy * toEdge * height);
      // At 1x length, carry gas beyond the hull while it is still bright.
      // The user's length multiplier continues to control drift and lifetime.
      const speed = Math.max(size * 2.3, (clearance + span * 0.25) * 1.2) / timeScale;
      return { ...point, angle: Math.atan2(tip.y-origin.y, tip.x-origin.x), speed,
        width: size * 1.4, length: clearance + span * 0.35 * Math.sqrt(length) };
    });
    // Scale lifetime, drag and emission spacing together: longer exhaust
    // travels farther and lingers behind moving ships within the same budget.
    const interval = 85 * length * timeScale;
    if (previousInterval !== null && previousInterval !== interval) accumulator *= interval / previousInterval;
    previousInterval = interval;
    accumulator += Math.min(100, elapsed);
    while (accumulator >= interval) {
      accumulator -= interval;
      heads.forEach((head, i) => {
        const old = previousHeads?.[i];
        // Interpolate ordinary movement only; teleports must not draw a bridge.
        const interpolate = old && elapsed < 250 && Math.hypot(head.x-old.x, head.y-old.y) < span*2;
        const t = 1 - accumulator / Math.max(1, elapsed);
        const angle = head.angle + (Math.random()-0.5)*(plasma ? 0.22 : 0.35);
        const speed = head.speed;
        puffs.push({ x: interpolate ? old.x + (head.x-old.x)*t : head.x,
          y: interpolate ? old.y + (head.y-old.y)*t : head.y,
          vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, angle,
          age: 0, life: (2600 + Math.random()*900) * length * timeScale,
          drag: 0.55 / (length * timeScale),
          size: size*(0.8+Math.random()*0.4), seed: Math.random()*100 });
      });
    }
    previousHeads = heads;
    if (puffs.length > MAX_BREACH_PUFFS) puffs.splice(0, puffs.length-MAX_BREACH_PUFFS);
    container.visible = token.visible !== false && !token.isPreview;
    visual.update(puffs, heads, flowPhase);
  };
  active.set(key, handle); ticker.add(tick);
  return handle;
}

/** All clients reconstruct native effects from synchronized document flags. */
export function registerBreachTrailHooks(start, stop) {
  const changed = changes => {
    const flags = changes?.flags?.[MODULE] ?? {};
    return ['warpBreachImminent', 'breachTrailDestruction'].some(key =>
      key in flags || `-=${key}` in flags || `flags.${MODULE}.${key}` in (changes ?? {}));
  };
  const sync = token => {
    if (!token) return;
    const imminent = token.document?.getFlag(MODULE, 'warpBreachImminent')
      ?? token.actor?.getFlag(MODULE, 'warpBreachImminent');
    const throes = token.document?.getFlag(MODULE, 'breachTrailDestruction');
    if (game.settings.get(MODULE, 'breachTrailFX') && (imminent || (throes && getBreachTrailRenderer() !== 'jb2a'))) start(token);
    else stop(token);
  };
  Hooks.on('canvasReady', () => {
    if (getBreachTrailRenderer() !== 'jb2a') for (const t of canvas.tokens?.placeables ?? []) sync(t);
  });
  Hooks.on('updateToken', (doc, changes) => {
    if (changed(changes) && getBreachTrailRenderer() !== 'jb2a' && doc.parent?.id === canvas.scene?.id) sync(doc.object);
  });
  Hooks.on('createToken', doc => {
    if (getBreachTrailRenderer() !== 'jb2a' && doc.parent?.id === canvas.scene?.id) sync(doc.object);
  });
  Hooks.on('updateActor', (actor, changes) => {
    const anchorsChanged = 'shipVfxAnchors' in (changes?.flags?.[MODULE] ?? {})
      || `flags.${MODULE}.shipVfxAnchors` in (changes ?? {});
    if ((changed(changes) || anchorsChanged) && getBreachTrailRenderer() !== 'jb2a') {
      for (const t of canvas.tokens?.placeables ?? []) if (t.actor === actor) sync(t);
    }
  });
  Hooks.on('deleteToken', doc => {
    if (doc.parent?.id === canvas.scene?.id) {
      stopNativeBreachTrail(doc.id);
      active.get(`preview:${doc.id}`)?.destroy();
    }
  });
  Hooks.on('canvasTearDown', () => { for (const h of [...active.values()]) h.destroy(); });
  Hooks.on('updateSetting', setting => {
    if (![`${MODULE}.breachTrailFX`, `${MODULE}.breachTrailRenderer`].includes(setting.key)) return;
    for (const token of canvas.tokens?.placeables ?? []) {
      Promise.resolve(stop(token)).then(() => sync(token)).catch(error => console.warn('STA2e Toolkit | Breach renderer refresh failed:', error));
    }
  });
}
