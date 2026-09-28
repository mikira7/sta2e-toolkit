/** Native starship breakup: brief fireball, fast sparks, tumbling metal plates. */
import { createShipFireball } from "./ship-explosion-shader.js";
import { normalizeShipExplosionColor, shipExplosionPalette } from "./ship-explosion-colors.js";

const MODULE = "sta2e-toolkit";
export const SHIP_EXPLOSION_ACTION = "shipExplosionVfx";
export const SHIP_EXPLOSION_DURATION_MS = 3200;
const active = new Set(), seen = new Set();
let hooked = false;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function getShipExplosionColor(token) {
  return normalizeShipExplosionColor(token?.document?.getFlag?.(MODULE, "shipExplosionColor")
    ?? token?.actor?.getFlag?.(MODULE, "shipExplosionColor"));
}

export async function saveShipExplosionColor(token, color) {
  if (!game.user?.isGM) throw new Error("Only the GM can save a ship explosion color.");
  if (!token?.document) throw new Error("Select a ship first.");
  // Actor storage carries the choice to future tokens of this ship.
  const document = token.actor ?? token.document;
  await document.setFlag(MODULE, "shipExplosionColor", normalizeShipExplosionColor(color));
  if (token.actor && token.document.getFlag?.(MODULE, "shipExplosionColor") != null) {
    await token.document.unsetFlag(MODULE, "shipExplosionColor");
  }
}

export function useNativeShipExplosion() {
  try { return game.settings.get(MODULE, "shipExplosionRenderer") === "native"; }
  catch { return false; }
}

function randomFrom(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Deterministic particles let all clients see the same breakup. No gravity in space. */
export function buildShipExplosionParticles(seed, secondary = false) {
  const random = randomFrom(seed);
  return Array.from({ length: secondary ? 54 : 248 }, (_, i) => {
    const debris = i < (secondary ? 6 : 28);
    const angle = random() * Math.PI * 2;
    return { debris, angle, origin: random() * .24,
      speed: debris ? .35 + random() * .8 : .7 + random() * 1.65,
      size: debris ? .012 + random() ** 2 * .05 : .002 + random() * .004,
      stretch: .4 + random() * .7, rotation: random() * Math.PI * 2,
      spin: (random() - .5) * 10, delay: random() * (debris ? .09 : .22),
      life: debris ? 1.9 + random() * 1.15 : .55 + random() * 1.15,
      warm: random() > .5 };
  });
}

function polygon(g, points, color, alpha) {
  if (g.beginFill) g.beginFill(color, alpha).drawPolygon(points).endFill();
  else g.poly(points).fill({ color, alpha });
}

/** Time is absolute, so low frame rates cannot change the trajectories. */
export function drawShipExplosionParticles(g, particles, seconds, size, color = "classic", sparkGraphics = g) {
  const palette = shipExplosionPalette(color);
  g.clear();
  if (sparkGraphics !== g) sparkGraphics.clear();
  for (const p of particles) {
    const age = seconds - p.delay;
    if (age < 0 || age >= p.life) continue;
    const fade = Math.min(1, age / .025) * (1 - clamp((age/p.life - .5) / .5, 0, 1));
    const distance = size * (p.origin + p.speed * age);
    const c = Math.cos(p.angle), s = Math.sin(p.angle), x = c*distance, y = s*distance;
    if (p.debris) {
      const a = p.rotation + p.spin*age, ca = Math.cos(a), sa = Math.sin(a);
      const width = size*p.size, height = width*p.stretch*(.3 + .7*Math.abs(Math.cos(age*p.spin)));
      const local = [[-1,-.45],[.25,-1],[1,.05],[.45,.85],[-.8,.65]];
      const pts = local.flatMap(([u,v]) => [x+u*width*ca-v*height*sa, y+u*width*sa+v*height*ca]);
      const hot = Math.max(0, 1-age/.8);
      polygon(g, pts, hot > .45 ? palette.spark : 0x788795, fade);
      // A lit facet and dark face make the plates read as solid tumbling hull.
      polygon(g, [...pts.slice(0,6),x,y], hot > .2 ? palette.core : 0xc6d2da, fade*.7);
      polygon(g, [...pts.slice(6), ...pts.slice(0,2),x,y], 0x202936, fade*.75);
    } else {
      const width = Math.max(.6, size*p.size), length = size*p.speed*(.018 + .045*(1-age/p.life));
      // Nested translucent trails give each spark a halo and a hot core.
      // A separate additive layer keeps the sparks luminous over the smoke.
      for (const [spread, opacity] of [[5,.055],[3,.12],[1.5,.28],[.55,.95]]) {
        const w=width*spread, tail=length*(1+spread*.12);
        const pts=[x-s*w,y+c*w, x+c*width,y+s*width, x+s*w,y-c*w, x-c*tail,y-s*tail];
        polygon(sparkGraphics, pts, spread<1 ? palette.core : palette.spark, fade*opacity);
      }
    }
  }
}

export function stopShipExplosionPreviews() {
  for (const handle of [...active]) if (handle.preview) handle.stop();
}

/** Receive a snapshot, not a live token dependency: fragments outlive deletion. */
export function playShipExplosionFromSocket(event) {
  const canvas = globalThis.canvas;
  if (!canvas?.ready || canvas.scene?.id !== event?.sceneId || !globalThis.PIXI) return null;
  if (event.hidden && !game.user?.isGM) return null;
  const token = canvas.tokens?.get(event.tokenId);
  if (!game.user?.isGM && token && (token.document?.hidden || token.visible === false)) return null;
  if (![event.x,event.y,event.size,event.seed].every(Number.isFinite) || event.size <= 0) return null;
  if (typeof event.id !== "string" || seen.has(event.id)) return null;
  seen.add(event.id); if (seen.size > 256) seen.delete(seen.values().next().value);
  if (!hooked) {
    hooked = true;
    Hooks.on("canvasTearDown", () => { for (const h of [...active]) h.stop(); seen.clear(); });
  }
  // Bound simultaneous effects as well as particles per burst.
  if (active.size >= 16) active.values().next().value.stop();
  const size = clamp(event.size, 8, 4000), secondary = event.secondary === true;
  const duration = secondary ? 1600 : SHIP_EXPLOSION_DURATION_MS;
  const container = new PIXI.Container(), graphics = new PIXI.Graphics(), sparks = new PIXI.Graphics();
  const color = normalizeShipExplosionColor(event.color);
  sparks.blendMode = PIXI.BLEND_MODES?.ADD ?? "add";
  const ticker = canvas.app.ticker;
  let fireball, timer, stopped = false, resolveFinished;
  const handle = { preview: event.preview === true, finished: new Promise(resolve => { resolveFinished = resolve; }), stop };
  function stop() {
    if (stopped) return;
    stopped = true; clearTimeout(timer); ticker.remove(tick); active.delete(handle);
    fireball?.destroy(); container.destroy({ children: true }); resolveFinished();
  }
  const start = performance.now(), particles = buildShipExplosionParticles(event.seed, secondary);
  function tick() {
    if (stopped) return;
    if (canvas.scene?.id !== event.sceneId || !canvas.ready || container.destroyed) { stop(); return; }
    try {
      const elapsed = performance.now() - start;
      if (elapsed >= duration) { stop(); return; }
      const seconds = elapsed / 1000 * (secondary ? 2 : 1);
      fireball.update(seconds);
      drawShipExplosionParticles(graphics, particles, seconds, size, color, sparks);
    } catch (error) { console.warn("STA2e Toolkit | Ship explosion stopped:", error); stop(); }
  }
  try {
    container.position.set(event.x, event.y); container.zIndex = 950000; container.eventMode = "none";
    const layer = canvas.tokens ?? canvas.interface;
    layer.sortableChildren = true; layer.addChild(container);
    fireball = createShipFireball(size, event.seed % 10000, color);
    container.addChild(graphics); container.addChild(fireball.display); container.addChild(sparks);
    active.add(handle); ticker.add(tick);
    timer = setTimeout(stop, duration + 250);
    tick();
    return handle;
  } catch (error) { stop(); console.warn("STA2e Toolkit | Ship explosion failed:", error); return null; }
}

/** Cosmetic only. Destruction/deletion stays in CombatHUD. Preview is local. */
export function playNativeShipExplosion(token, { secondary = false, broadcast = true, preview = false, color } = {}) {
  if (!token?.center || !globalThis.canvas?.scene) return null;
  const grid = canvas.grid?.size ?? 100;
  const width = token.w ?? (token.document?.width ?? 1)*grid;
  const height = token.h ?? (token.document?.height ?? 1)*grid;
  const scaleX = Math.abs(token.document?.texture?.scaleX ?? 1), scaleY = Math.abs(token.document?.texture?.scaleY ?? 1);
  const size = Math.max(width*scaleX, height*scaleY);
  const event = { action: SHIP_EXPLOSION_ACTION, id: globalThis.crypto.randomUUID(),
    sceneId: canvas.scene.id, tokenId: token.id, hidden: token.document?.hidden === true,
    color: color == null ? getShipExplosionColor(token) : normalizeShipExplosionColor(color),
    x: token.center.x + (secondary ? (Math.random()-.5)*width*.55 : 0),
    y: token.center.y + (secondary ? (Math.random()-.5)*height*.55 : 0),
    size: size*(secondary ? .24 : 1), seed: Math.floor(Math.random()*4294967296), secondary, preview };
  const handle = playShipExplosionFromSocket(event);
  if (broadcast && !preview) game.socket?.emit(`module.${MODULE}`, event);
  return handle;
}

export function previewShipExplosion({ color } = {}) {
  const token = globalThis.canvas?.tokens?.controlled?.[0];
  if (!token) { ui.notifications.warn("Select a starship token to preview its explosion."); return null; }
  stopShipExplosionPreviews();
  return playNativeShipExplosion(token, { broadcast: false, preview: true, color });
}
