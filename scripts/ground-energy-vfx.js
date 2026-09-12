/** Person-scale energy shots. Geometry is resolved once and replayed on every
 * client; the shot owns its ticker, meshes and teardown, including delayed hits.
 */
import { createBeamRibbon } from "./beam-shader.js";
import { createWeaponEnergyOrb, createWeaponEnergyShockwave } from "./weapon-energy-shader.js";
import { getBeamVfxSettings, getWeaponAnimationMode, nativeVfxBlendMode,
  nativeVfxContainer, playNativeVfxSound, shouldUseNativeWeaponVFX } from "./native-weapon-vfx.js";

export const GROUND_ENERGY_VFX_ACTION = "groundEnergyVfx";
const MODULE = "sta2e-toolkit";
const active = new Set();
const PROFILES = Object.freeze({
  disruptor: { color: 0x60ff68, core: 0xe8ffd4, width: 1.2, noise: .72, speed: 2.8, length: 30 },
  andorian: { color: 0x54bfff, core: 0xe0faff, width: 1.6, noise: .85, speed: 1.6, length: 38 },
  plasma: { color: 0xbd71ff, core: 0xf5deff, width: 1.6, noise: .85, speed: 1.6, length: 38 },
  particle: { color: 0xb18aff, core: 0xf5ecff, width: .9, noise: .3, speed: 3.8, length: 24 },
  phase: { color: 0xff5945, core: 0xffe9c5, width: .85, noise: .45, speed: 2.4, length: 24 },
  pulse: { color: 0x65caff, core: 0xe4faff, width: 1, noise: .8, speed: 2, length: 30 },
});
const clamp = (v, fallback, lo, hi) => Number.isFinite(Number(v))
  ? Math.min(hi, Math.max(lo, Number(v))) : fallback;
const point = p => Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null;
function center(token) {
  const p = point(token?.center);
  if (p) return p;
  const doc = token?.document ?? token;
  const grid = globalThis.canvas?.grid?.size ?? 100;
  return point({ x: doc?.x + (token?.w ?? (doc?.width ?? 1) * grid) / 2,
    y: doc?.y + (token?.h ?? (doc?.height ?? 1) * grid) / 2 });
}
function miss(source, target, grid) {
  const dx = target.x - source.x, dy = target.y - source.y;
  const d = Math.hypot(dx, dy) || 1;
  const side = grid * .5 * (Math.random() < .5 ? -1 : 1);
  return { x: target.x + dx / d * grid * .35 - dy / d * side,
    y: target.y + dy / d * grid * .35 + dx / d * side };
}

/** Returns only after the last impact, so injury resolution can remove tokens. */
export async function fireGroundEnergyVFX(config, isHit, sourceToken, targets, options = {}) {
  const key = config?.family === "ground-pulse" ? "weapon-ground-pulse" : "weapon-ground-energy";
  if (!shouldUseNativeWeaponVFX(key) || !globalThis.PIXI || !globalThis.canvas?.ready) return false;
  const sceneId = sourceToken?.document?.parent?.id ?? canvas.scene?.id;
  if (sceneId !== canvas.scene?.id) return false;
  const source = center(sourceToken);
  const tokens = Array.from(targets ?? []).filter(t => center(t)).slice(0, 64);
  if (!source || !tokens.length) return false;
  const grid = clamp(canvas.grid?.size, 100, 10, 1000);
  const settings = getBeamVfxSettings(), group = settings.groundPhaser;
  const profile = config.groundEnergyProfile in PROFILES ? config.groundEnergyProfile : "particle";
  const mode = key === "weapon-ground-pulse" ? "shockwave" : config.groundFireMode === "bolt" ? "bolt" : "beam";
  const ends = tokens.map(center).map(p => isHit ? p : miss(source, p, grid));
  const msg = {
    action: GROUND_ENERGY_VFX_ACTION, sceneId, sourcePoint: source, targetPoints: ends,
    mode, profile, hit: !!isHit, shaded: getWeaponAnimationMode(key) === "shader",
    scale: clamp(config.groundEnergyScale, 1, .25, 3),
    width: clamp(group.glowWidth, 4, 1, 30), coreWidth: clamp(group.coreWidth, 1.6, .2, 10),
    duration: mode === "shockwave" ? 1150 : clamp(isHit ? group.hitDuration : group.missDuration, 1000, 200, 4000),
    impactDelay: clamp(group.impactDelay, 180, 0, 1500), grid,
    blend: settings.shared.blendMode, shader: settings.shader,
  };
  if (mode === "shockwave") {
    // The primary target is the detonation point; only the radius grows to
    // include secondary targets. Never shift the centre to their average.
    msg.radius = Math.max(grid * 1.5, ...tokens.map((token, i) =>
      Math.hypot(ends[i].x - ends[0].x, ends[i].y - ends[0].y)
        + Math.max(token.w ?? grid, token.h ?? grid) * .5));
    msg.targetPoints = [ends[0]];
  }
  const playback = playGroundEnergyVfxFromSocket(msg);
  if (!playback) return false;
  playNativeVfxSound(options.soundPath ?? (isHit ? config.sound : config.missSound ?? config.sound));
  try { game.socket?.emit?.(`module.${MODULE}`, msg); }
  catch (err) { console.warn("STA2e Toolkit | Ground energy broadcast failed:", err); }
  await playback;
  return true;
}

/** Visuals only: sound is broadcast separately by AudioHelper. */
export function playGroundEnergyVfxFromSocket(msg = {}) {
  if (!globalThis.PIXI || !globalThis.canvas?.ready || msg.sceneId !== canvas.scene?.id) return false;
  const source = point(msg.sourcePoint);
  const ends = Array.isArray(msg.targetPoints) ? msg.targetPoints.slice(0, 64).map(point).filter(Boolean) : [];
  if (!source || !ends.length || !["beam", "bolt", "shockwave"].includes(msg.mode)) return false;
  const p = PROFILES[msg.profile] ?? PROFILES.particle;
  const spec = { ...msg, source, ends, p, shaded: msg.shaded === true,
    scale: clamp(msg.scale, 1, .25, 3), width: clamp(msg.width, 4, 1, 30),
    coreWidth: clamp(msg.coreWidth, 1.6, .2, 10), duration: clamp(msg.duration, 1000, 200, 4000),
    impactDelay: clamp(msg.impactDelay, 180, 0, 1500), grid: clamp(msg.grid, 100, 10, 1000),
    radius: clamp(msg.radius, 150, 10, 10000), blend: nativeVfxBlendMode(msg.blend),
  };
  if (spec.mode === "shockwave") return drawShockwave(spec);
  return Promise.all(ends.map((end, i) => drawShot(spec, end, i * 120)));
}

function circle(g, x, y, radius, color, alpha, stroke = 0) {
  if (radius <= 0 || alpha <= 0) return;
  if (g.drawCircle) {
    if (stroke) g.lineStyle(stroke, color, alpha);
    else g.beginFill(color, alpha);
    g.drawCircle(x, y, radius);
    if (stroke) g.lineStyle(0); else g.endFill();
  } else {
    g.circle(x, y, radius);
    if (stroke) g.stroke({ width: stroke, color, alpha }); else g.fill({ color, alpha });
  }
}
function line(g, a, b, width, color, alpha) {
  if (g.lineStyle) g.lineStyle(width, color, alpha).moveTo(a.x, a.y).lineTo(b.x, b.y);
  else g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color, alpha });
}

/** All delayed phases live on this timeline, so teardown cannot spawn new FX. */
function animate(container, duration, draw, release = () => {}) {
  const ticker = canvas.app.ticker, sceneId = canvas.scene?.id;
  let elapsed = 0, previous = performance.now(), stopped = false, timer;
  let resolve;
  const done = new Promise(r => { resolve = r; });
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    active.delete(dispose);
    ticker.remove(tick);
    clearTimeout(timer);
    release();
    if (!container.destroyed) container.destroy({ children: true });
    resolve(true);
  };
  const tick = () => {
    if (container.destroyed || !canvas.ready || canvas.scene?.id !== sceneId) return dispose();
    const now = performance.now();
    elapsed += Math.max(0, Math.min(50, now - previous)); previous = now;
    if (elapsed >= duration) return dispose();
    try { draw(elapsed); }
    catch (err) { dispose(); console.warn("STA2e Toolkit | Ground energy animation stopped:", err); }
  };
  active.add(dispose);
  try { draw(0); ticker.add(tick); timer = setTimeout(dispose, duration + 1000); }
  catch (err) { dispose(); throw err; }
  return done;
}

function flash(parent, spec, at, scale) {
  const holder = new PIXI.Container(); holder.position.set(at.x, at.y); parent.addChild(holder);
  const size = 24 * scale;
  const orb = spec.shaded ? createWeaponEnergyOrb(holder, { color: spec.p.color, coreColor: spec.p.core,
    blend: spec.blend, radius: size, coreRadius: 5 * scale, haloRadius: 19 * scale,
    ringRadius: 8 * scale, ringWidth: scale, haloAlpha: .65, flareAlpha: .3 }) : null;
  if (!orb) {
    const g = new PIXI.Graphics(); g.blendMode = spec.blend; holder.addChild(g);
    for (let i = 5; i > 0; i--) circle(g, 0, 0, i * 4 * scale, spec.p.color, .06);
    circle(g, 0, 0, 4 * scale, spec.p.core, .95);
  }
  holder.visible = false;
  return (time, alpha) => {
    holder.visible = alpha > 0; holder.alpha = Math.max(0, alpha);
    orb?.update(time / 1000);
  };
}

function drawShot(spec, end, delay) {
  const c = nativeVfxContainer(spec.source.y, "above");
  if (!c) return Promise.resolve(false);
  const { p, source } = spec;
  const distance = Math.hypot(end.x - source.x, end.y - source.y);
  const travel = clamp(distance / spec.grid * 85, 400, 160, 850);
  const bolt = spec.mode === "bolt";
  const impactAt = bolt ? travel : Math.min(spec.duration * .65, spec.impactDelay);
  const endAt = bolt ? travel + 380 : spec.duration;
  const half = spec.width * spec.scale * p.width;
  const core = spec.coreWidth * spec.scale;
  const body = new PIXI.Container(); c.addChild(body);
  const ribbon = spec.shaded ? createBeamRibbon(body, { mode: bolt ? "bolts" : "beam",
    from: source, to: end, halfWidth: half * (bolt ? 1.4 : 1), color: p.color, coreColor: p.core,
    profile: { core }, shader: { ...spec.shader, noiseAmount: p.noise, noiseSpeed: p.speed },
    blendMode: spec.blend, lifetimeMs: delay + endAt + 1000 }) : null;
  const g = new PIXI.Graphics(); g.blendMode = spec.blend; body.addChild(g);
  const muzzle = flash(c, spec, source, spec.scale * .7);
  const impact = flash(c, spec, end, spec.scale);
  return animate(c, delay + endAt, elapsed => {
    const t = elapsed - delay;
    c.visible = t >= 0;
    if (t < 0) return;
    muzzle(t, Math.max(0, 1 - t / 220));
    impact(t, spec.hit !== false && t >= impactAt ? Math.max(0, 1 - (t - impactAt) / (endAt - impactAt)) : 0);
    body.visible = !bolt || t < travel;
    body.alpha = bolt ? 1 : Math.min(1, t / 65) * Math.min(1, (endAt - t) / 240);
    const head = Math.min(1, t / travel), length = Math.min(.65, p.length * spec.scale / Math.max(1, distance));
    if (ribbon) { if (bolt) ribbon.setBolts([{ head, length, brightness: 1 }]); return; }
    g.clear();
    const at = u => ({ x: source.x + (end.x - source.x) * u, y: source.y + (end.y - source.y) * u });
    const a = bolt ? at(Math.max(0, head - length)) : source, b = bolt ? at(head) : end;
    for (let i = 3; i > 0; i--) line(g, a, b, half * i, p.color, .1);
    line(g, a, b, core, p.core, .95);
  }, () => ribbon?.stop());
}

function drawShockwave(spec) {
  const c = nativeVfxContainer(spec.ends[0].y, "above");
  if (!c) return false;
  c.position.set(spec.ends[0].x, spec.ends[0].y);
  const field = spec.shaded ? createWeaponEnergyShockwave(c, { color: spec.p.color,
    coreColor: spec.p.core, radius: spec.radius, blend: spec.blend }) : null;
  const g = new PIXI.Graphics(); g.blendMode = spec.blend; c.addChild(g);
  return animate(c, spec.duration, t => {
    const u = t / spec.duration;
    c.alpha = Math.min(1, (1 - u) / .45);
    if (field) { field.update(t / 1000, u); return; }
    g.clear();
    const r = spec.radius * (.05 + .95 * (1 - (1 - u) ** 2));
    circle(g, 0, 0, r, spec.p.color, .08 * (1 - u));
    circle(g, 0, 0, r, spec.p.color, .25, 10);
    circle(g, 0, 0, r, spec.p.core, .85, 2);
    circle(g, 0, 0, r * .78, spec.p.color, .4, 2);
    circle(g, 0, 0, spec.radius * .16, spec.p.core, Math.exp(-u * 18));
  });
}

globalThis.Hooks?.on("canvasTearDown", () => { for (const dispose of [...active]) dispose(); });
