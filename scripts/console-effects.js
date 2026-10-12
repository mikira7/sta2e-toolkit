/** Saved bridge-console anchors and transient, scene-scoped overload effects. */
import { playCanvasShakeLocal, stopCanvasShake, normalizeShake } from "./scene-effects.js";
import { createConsoleExplosionVolume, createConsoleElectricalBloom, clearConsoleCinematicTextures } from "./console-cinematic-vfx.js";
import { playSceneEffectSound } from "./scene-effect-audio.js";

const MODULE = "sta2e-toolkit";
export const CONSOLE_LOCATIONS_FLAG = "consoleEffectLocations";
export const CONSOLE_EFFECT_ACTION = "consoleOverloadVfx";
export const CONSOLE_EFFECT_STOP_ACTION = "stopConsoleOverloadVfx";
const active = new Set(), seen = new Set(), writes = new Map();
const audioEvents = new Set();
const bound = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.max(min, Math.min(max, Number(value))) : fallback;
const validPoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);

export function getConsoleLocations(scene = canvas?.scene) {
  const saved = scene?.getFlag(MODULE, CONSOLE_LOCATIONS_FLAG);
  if (!Array.isArray(saved)) return [];
  const ids = new Set();
  return saved.filter(p => validPoint(p) && typeof p.id === "string" && !ids.has(p.id) && ids.add(p.id))
    .slice(0, 64).map(p => ({ id: p.id, label: String(p.label ?? "Console").slice(0, 60),
      x: p.x, y: p.y, size: bound(p.size, 60, 10, 600) }));
}

/** Serialise this client's edits so rapid adds/renames do not overwrite each other. */
function editLocations(scene, edit) {
  if (!game.user?.isGM) return Promise.reject(new Error("Only the GM can edit console locations."));
  if (!scene) return Promise.reject(new Error("Open a scene first."));
  const key = scene.id;
  const operation = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = edit(getConsoleLocations(scene));
    await scene.setFlag(MODULE, CONSOLE_LOCATIONS_FLAG, next);
    return next;
  });
  writes.set(key, operation);
  operation.then(() => { if (writes.get(key) === operation) writes.delete(key); },
    () => { if (writes.get(key) === operation) writes.delete(key); });
  return operation;
}

export function saveConsoleLocation(point, scene = canvas?.scene) {
  return editLocations(scene, locations => {
    if (!validPoint(point)) throw new Error("Pick a valid canvas position.");
    const existing = locations.find(p => p.id === point.id);
    if (!existing && locations.length >= 64) throw new Error("A scene can have up to 64 console locations.");
    const entry = { id: existing?.id ?? crypto.randomUUID(),
      label: String(point.label ?? existing?.label ?? `Console ${locations.length + 1}`).trim().slice(0, 60) || "Console",
      x: point.x, y: point.y, size: bound(point.size, existing?.size ?? 60, 10, 600) };
    return existing ? locations.map(p => p.id === entry.id ? entry : p) : [...locations, entry];
  });
}

export function updateConsoleLocation(id, patch, scene = canvas?.scene) {
  return editLocations(scene, locations => locations.map(p => {
    if (p.id !== id) return p;
    const next = { ...p, ...patch, id: p.id };
    if (!validPoint(next)) throw new Error("Pick a valid canvas position.");
    return { id: p.id, x: next.x, y: next.y,
      label: String(next.label).trim().slice(0, 60) || "Console", size: bound(next.size, p.size, 10, 600) };
  }));
}

export function removeConsoleLocation(id, scene = canvas?.scene) {
  return editLocations(scene, locations => locations.filter(p => p.id !== id));
}

function rng(seed) {
  let state = Number(seed) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Pick distinct consoles on the sender; receivers replay the same snapshot. */
export function chooseConsoleLocations(locations, count, random = Math.random) {
  const pool = [...locations], chosen = [];
  const limit = Math.min(pool.length, Math.round(bound(count, 1, 1, 16)));
  while (chosen.length < limit) chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return chosen;
}

export function triggerConsoleEffects({ ids, count = 1, kind = "electric", duration = 2.5,
  shake = false, shakeOptions, skeleton = true, preview = false } = {}) {
  if (!game.user?.isGM || !canvas?.ready || !canvas.scene) return false;
  const locations = getConsoleLocations();
  const selected = Array.isArray(ids) ? locations.filter(p => ids.includes(p.id)).slice(0, 16)
    : chooseConsoleLocations(locations, count);
  if (!selected.length) { ui.notifications.warn("Add a console location to this scene first."); return false; }
  const event = { action: CONSOLE_EFFECT_ACTION, id: crypto.randomUUID(), userId: game.user.id,
    sceneId: canvas.scene.id, duration: bound(duration, 2.5, 0.4, 6), seed: Math.floor(Math.random() * 4294967296),
    locations: selected.map(p => ({ ...p, kind: kind === "mixed" ? (Math.random() < 0.5 ? "electric" : "explosion")
      : kind === "explosion" ? "explosion" : "electric" })),
    shake: shake === true, shakeOptions: normalizeShake(shakeOptions), skeleton: skeleton !== false };
  if (!handleConsoleEffectSocket(event)) return false;
  if (!preview) game.socket.emit(`module.${MODULE}`, event);
  return true;
}

export function stopConsoleEffectsLocal() {
  for (const handle of [...active]) handle.stop();
  for (const audio of [...audioEvents]) audio.stop();
}

export function stopConsoleEffects() {
  if (!game.user?.isGM || !canvas?.scene) return false;
  stopConsoleEffectsLocal(); stopCanvasShake();
  game.socket.emit(`module.${MODULE}`, { action: CONSOLE_EFFECT_STOP_ACTION, userId: game.user.id, sceneId: canvas.scene.id });
  return true;
}

export function handleConsoleEffectSocket(event) {
  if (!event || !game.users?.get(event.userId)?.isGM || !canvas?.ready || event.sceneId !== canvas.scene?.id) return false;
  if (event.action === CONSOLE_EFFECT_STOP_ACTION) { stopConsoleEffectsLocal(); stopCanvasShake(); return true; }
  if (event.action !== CONSOLE_EFFECT_ACTION || typeof event.id !== "string" || seen.has(event.id)) return false;
  if (!Array.isArray(event.locations) || !event.locations.length || event.locations.length > 16
    || !event.locations.every(p => validPoint(p) && Number.isFinite(p.size) && ["electric", "explosion"].includes(p.kind))) return false;
  if (!globalThis.PIXI || !canvas.app?.ticker || !(canvas.interface ?? canvas.tokens)?.addChild) return false;
  seen.add(event.id); if (seen.size > 128) seen.delete(seen.values().next().value);
  let played = false;
  const audio = { remaining: 0, sounds: [], kinds: new Set(), stop() {
    for (const sound of this.sounds) sound.stop(); this.sounds.length = 0; audioEvents.delete(this);
  } };
  audioEvents.add(audio);
  for (const [i, point] of event.locations.entries()) {
    if (playBurst(point, event, i, audio)) { played = true; audio.kinds.add(point.kind); }
  }
  for (const kind of audio.kinds) { const sound = playSceneEffectSound(kind, { seed: event.seed }); if (sound) audio.sounds.push(sound); }
  if (!audio.remaining) audio.stop();
  if (played && event.shake === true) playCanvasShakeLocal(normalizeShake(event.shakeOptions), event.seed);
  return played;
}

function circle(g, x, y, radius, color, alpha) {
  if (Number.parseInt(PIXI.VERSION, 10) < 8 && g.beginFill) g.beginFill(color, alpha).drawCircle(x, y, radius).endFill();
  else g.circle(x, y, radius).fill({ color, alpha });
}
function line(g, points, width, color, alpha) {
  const legacy = Number.parseInt(PIXI.VERSION, 10) < 8 && g.lineStyle;
  if (legacy) g.lineStyle(width, color, alpha);
  points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
  if (legacy) g.lineStyle(0); else g.stroke({ width, color, alpha, cap: "round", join: "round" });
}

/** Midpoint displacement keeps the ends anchored while giving each discharge forks. */
function electricalArc(g, from, to, random, alpha, width = 1) {
  let path = [from, to];
  let displacement = Math.hypot(to[0] - from[0], to[1] - from[1]) * .18;
  for (let depth = 0; depth < 4; depth++) {
    const next = [path[0]];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const offset = (random() - .5) * displacement * 2;
      next.push([(a[0] + b[0]) / 2 - Math.sin(angle) * offset,
        (a[1] + b[1]) / 2 + Math.cos(angle) * offset], b);
    }
    path = next; displacement *= .52;
  }
  line(g, path, width * 8, 0x2255ff, alpha * .07);
  line(g, path, width * 3, 0x55bbff, alpha * .3);
  line(g, path, width, 0xe8faff, alpha);
  for (const i of [5, 10]) {
    const a = path[i], b = path[i + 3];
    const end = [b[0] + (random() - .5) * displacement * 20, b[1] + (random() - .5) * displacement * 20];
    line(g, [a, [(a[0] + end[0]) / 2, b[1]], end], width * .6, 0x8bdcff, alpha * .55);
  }
}

// Share one offset among overlapping bursts and never write token documents.
const electricalJitters = new Map();
// Reference counts keep the artwork hidden until the last overlapping charge ends.
const electricalArtwork = new Map();
function releaseJitter(mesh, owner) {
  const state = electricalJitters.get(mesh);
  if (!state) return;
  state.owners.delete(owner);
  if (state.owners.size) return;
  if (!mesh.destroyed) {
    if (mesh.x === state.x) mesh.x -= state.dx;
    if (mesh.y === state.y) mesh.y -= state.dy;
  }
  electricalJitters.delete(mesh);
}
function jitterToken(mesh, owner, time, strength) {
  let state = electricalJitters.get(mesh);
  if (!state) {
    state = { owners: new Set(), dx: 0, dy: 0, x: mesh.x, y: mesh.y };
    electricalJitters.set(mesh, state);
  }
  state.owners.add(owner);
  const x = mesh.x - (mesh.x === state.x ? state.dx : 0);
  const y = mesh.y - (mesh.y === state.y ? state.dy : 0);
  state.dx = Math.sin(time * .137) * strength;
  state.dy = Math.sin(time * .193 + 1) * strength * .7;
  mesh.x = state.x = x + state.dx; mesh.y = state.y = y + state.dy;
}

function tokenInElectricalRadius(token, point, radius) {
  if (token.destroyed || token.isVisible === false || token.visible === false
    || (token.document?.hidden && !game.user?.isGM) || !token.mesh || token.mesh.destroyed
    || token.mesh.visible === false
    || (token.mesh.renderable === false && !electricalArtwork.has(token.mesh)) || token.mesh.alpha === 0) return false;
  const x = Math.max(token.x, Math.min(point.x, token.x + token.w));
  const y = Math.max(token.y, Math.min(point.y, token.y + token.h));
  return Math.hypot(x - point.x, y - point.y) <= radius;
}

let skeletonTexturePromise;
function loadSkeletonTexture() {
  if (!skeletonTexturePromise) skeletonTexturePromise = (async () => {
    const path = `modules/${MODULE}/assets/vfx/electrocution-token.png`;
    try {
      if (globalThis.foundry?.canvas?.loadTexture) return await foundry.canvas.loadTexture(path);
      if (globalThis.loadTexture) return await loadTexture(path);
      if (PIXI.Assets?.load) return await PIXI.Assets.load(path);
    } catch (error) { console.warn("STA2e Toolkit | Skeleton portrait unavailable:", error); }
    return null;
  })();
  return skeletonTexturePromise;
}

/** Reference portrait with the procedural skeleton retained as a loading fallback. */
function createElectricalSkeleton(mesh) {
  const display = new PIXI.Container(), fallback = createFallbackElectricalSkeleton(mesh);
  display.eventMode = "none"; display.addChild(fallback);
  loadSkeletonTexture().then(texture => {
    if (!texture || display.destroyed) return;
    const portrait = new PIXI.Sprite(texture);
    const w = mesh.texture.orig.width, h = mesh.texture.orig.height;
    const size = Math.min(w, h);
    portrait.width = portrait.height = size;
    portrait.tint = 0x79baff;
    portrait.position.set((.5 - mesh.anchor.x) * w - size / 2, (.5 - mesh.anchor.y) * h - size / 2);
    display.removeChild(fallback); fallback.destroy(); display.addChild(portrait);
  });
  return display;
}

/** A compact, outlined cartoon skeleton, drawn once in token texture coordinates. */
function createFallbackElectricalSkeleton(mesh) {
  const g = new PIXI.Graphics();
  const w = mesh.texture.orig.width, h = mesh.texture.orig.height;
  const unit = Math.min(w, h) * 1.3;
  const cx = (.5 - mesh.anchor.x) * w, cy = (.5 - mesh.anchor.y) * h;
  const point = (x, y) => [cx + x * unit, cy + y * unit];
  const ink = 0x10283e, bone = 0xf0fcff;
  const disc = (x, y, r, color) => circle(g, ...point(x, y), r * unit, color, 1);
  const stroke = (points, width = .024) => {
    const path = points.map(([x, y]) => point(x, y));
    line(g, path, unit * (width + .025), ink, 1);
    line(g, path, unit * width, bone, 1);
  };
  // Bent arms, splayed fingers and knock-kneed legs give the shock a comic pose.
  stroke([[0, -.18], [0, .17]], .032);
  for (const side of [-1, 1]) {
    const s = points => points.map(([x, y]) => [x * side, y]);
    stroke(s([[0, -.15], [.14, -.13], [.23, .01], [.31, -.16]]));
    for (const [x, y] of [[.27, -.24], [.33, -.25], [.38, -.2]]) {
      stroke(s([[.31, -.16], [x, y]]), .015);
    }
    for (let rib = 0; rib < 3; rib++) {
      const y = -.105 + rib * .063;
      stroke(s([[0, y], [.09, y - .018], [.115, y + .008], [.075, y + .04], [0, y + .025]]), .016);
    }
    stroke(s([[0, .15], [.085, .19], [.055, .24], [0, .21]]), .028);
    stroke(s([[.065, .22], [.13, .32], [.095, .43], [.19, .44]]), .03);
    disc(side * .13, .32, .024, bone);
  }
  // Oversized skull, dark sockets and a toothy grin remain legible when zoomed out.
  disc(0, -.31, .139, ink); disc(0, -.31, .121, bone);
  stroke([[-.064, -.255], [-.055, -.197], [.055, -.197], [.064, -.255]], .033);
  for (const side of [-1, 1]) disc(side * .047, -.32, .032, ink);
  disc(0, -.268, .015, ink);
  line(g, [point(-.045, -.229), point(.045, -.229)], unit * .011, ink, 1);
  for (const x of [-.024, 0, .024]) {
    line(g, [point(x, -.244), point(x, -.213)], unit * .009, ink, 1);
  }
  g.eventMode = "none";
  return g;
}

/** Texture-alpha mask makes the flash and crawling arcs cover the actual artwork. */
function createTokenCharge(mesh, container, showSkeleton) {
  if (!PIXI.Sprite || !mesh.texture) return null;
  const display = new PIXI.Container(), mask = new PIXI.Sprite(mesh.texture);
  const flash = new PIXI.Sprite(mesh.texture), arcs = new PIXI.Graphics();
  for (const sprite of [mask, flash]) sprite.anchor.copyFrom(mesh.anchor);
  flash.tint = 0x80dfff; flash.blendMode = PIXI.BLEND_MODES?.ADD ?? "add";
  arcs.blendMode = PIXI.BLEND_MODES?.ADD ?? "add";
  const skeleton = showSkeleton ? createElectricalSkeleton(mesh) : null;
  display.eventMode = "none"; display.addChild(flash);
  if (skeleton) display.addChild(skeleton);
  display.addChild(arcs, mask); arcs.mask = mask;
  container.addChild(display);
  const artwork = showSkeleton
    ? electricalArtwork.get(mesh) ?? { count: 0, renderable: mesh.renderable ?? true } : null;
  if (artwork) {
    artwork.count++; electricalArtwork.set(mesh, artwork);
    mesh.renderable = false;
  }
  flash.visible = false;
  let destroyed = false;
  return { display, update(random, alpha) {
    // Convert the mesh's local axes through world space to handle zoom, rotation and mirroring.
    const origin = container.toLocal(mesh.toGlobal(new PIXI.Point(0, 0)));
    const x = container.toLocal(mesh.toGlobal(new PIXI.Point(1, 0)));
    const y = container.toLocal(mesh.toGlobal(new PIXI.Point(0, 1)));
    const matrix = new PIXI.Matrix(x.x-origin.x, x.y-origin.y, y.x-origin.x, y.y-origin.y, origin.x, origin.y);
    if (display.setFromMatrix) display.setFromMatrix(matrix); else display.transform.setFromMatrix(matrix);
    display.alpha = mesh.worldAlpha ?? mesh.alpha ?? 1;
    if (skeleton) {
      mesh.renderable = false;
      skeleton.alpha = .85 + random() * .15;
    }
    arcs.clear();
    const w = mesh.texture.orig.width, h = mesh.texture.orig.height;
    const left = -mesh.anchor.x * w, top = -mesh.anchor.y * h;
    for (let i = 0; i < 7; i++) {
      electricalArc(arcs, [left + random() * w, top], [left + random() * w, top + h], random,
        alpha, Math.max(1.2, Math.min(w, h) * .016));
    }
  }, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (artwork && --artwork.count === 0) {
      if (!mesh.destroyed && mesh.renderable === false) mesh.renderable = artwork.renderable;
      electricalArtwork.delete(mesh);
    }
    arcs.mask = null; display.parent?.removeChild(display); display.destroy({ children: true });
  } };
}

/** Native PIXI arcs, hot sparks, fire and smoke; works without animation packs. */
function playBurst(point, event, index, audio) {
  if (active.size >= 32) active.values().next().value.stop();
  const container = new PIXI.Container(), smoke = new PIXI.Graphics(), glow = new PIXI.Graphics();
  container.eventMode = "none"; container.zIndex = 950001;
  container.position.set(point.x, point.y);
  glow.blendMode = PIXI.BLEND_MODES?.ADD ?? "add";
  container.addChild(smoke);
  const seed = (event.seed >>> 0) + index * 7919, random = rng(seed);
  const particles = Array.from({ length: point.kind === "electric" ? 32 : 56 }, () => ({
    angle: random() * Math.PI * 2, speed: 0.4 + random() * 1.8,
    delay: random() * 0.25, life: 0.35 + random() * 0.5, width: 0.5 + random() * 1.5,
  }));
  const lobes = Array.from({ length: 9 }, () => ({ x: (random() - 0.5) * 1.1, y: (random() - 0.5) * 1.1, radius: 0.22 + random() * 0.3 }));
  const ticker = canvas.app.ticker, start = performance.now(), duration = bound(event.duration, 2.5, 0.4, 6) * 1000;
  const size = bound(point.size, 60, 10, 600);
  const volume = point.kind === "explosion" ? createConsoleExplosionVolume(size, seed) : null;
  const bloom = point.kind === "electric" ? createConsoleElectricalBloom(size) : null;
  const charged = new Map();
  if (volume) container.addChild(volume.display);
  if (bloom) container.addChild(bloom.display);
  container.addChild(glow);
  let stopped = false, timer, counted = false;
  const handle = { stop };
  function stop() {
    if (stopped) return;
    stopped = true; clearTimeout(timer); ticker.remove(tick); active.delete(handle);
    if (counted && --audio.remaining === 0) audio.stop();
    volume?.destroy(); bloom?.destroy();
    for (const [mesh, charge] of charged) { releaseJitter(mesh, handle); charge?.destroy(); }
    charged.clear();
    container.parent?.removeChild(container); container.destroy({ children: true });
  }
  function tick() {
    if (stopped) return;
    if (!canvas.ready || canvas.scene?.id !== event.sceneId || container.destroyed) { stop(); return; }
    const progress = (performance.now() - start) / duration;
    if (progress >= 1) { stop(); return; }
    try {
      const t = progress, fade = Math.min(1, t * 40) * (1 - t);
      smoke.clear(); glow.clear();
      if (point.kind === "electric") {
        const flicker = rng(seed + Math.floor(t * duration / 55));
        const pulse = flicker() > .24 ? .65 + flicker() * .35 : .12;
        bloom?.update(t, pulse);
        // Soft nested falloff also provides a glow on renderers without sprites.
        if (!bloom) for (let band = 12; band > 0; band--) {
          const radius = size * 1.3 * band / 12;
          circle(glow, 0, 0, radius, band > 4 ? 0x2266ff : 0x99ddff,
            fade * (.035 + pulse * .025) * (1 - band / 13));
        }
        for (let arc = 0; arc < 5; arc++) {
          const angle = flicker() * Math.PI * 2, length = size * (0.3 + flicker() * 0.8);
          const end = [Math.cos(angle) * length, Math.sin(angle) * length];
          electricalArc(glow, [0, 0], end, flicker, fade * pulse, Math.max(.7, size * .012));
          bloom?.contact(arc, end[0], end[1], fade * (.5 + pulse * .5));
        }
        const present = new Set();
        for (const token of canvas.tokens?.placeables ?? []) {
          if (!tokenInElectricalRadius(token, point, size)) continue;
          const mesh = token.mesh; present.add(mesh);
          if (!charged.has(mesh)) charged.set(mesh, createTokenCharge(mesh, container, event.skeleton !== false));
          jitterToken(mesh, handle, performance.now(), Math.min(2, Math.min(token.w, token.h) * .018) * fade * pulse);
          const end = [token.x + token.w * .5 - point.x, token.y + token.h * .5 - point.y];
          // Keep token strikes readable between flashes and hold their brightness
          // longer than the ambient sparks, with a thicker white-hot core.
          const strikeAlpha = Math.min(1, t * 40) * Math.pow(1 - t, .55) * (.65 + pulse * .35);
          electricalArc(glow, [0, 0], end, flicker, strikeAlpha, Math.max(1.8, size * .028));
          charged.get(mesh)?.update(flicker, strikeAlpha);
        }
        for (const [mesh, charge] of charged) if (!present.has(mesh)) {
          releaseJitter(mesh, handle); charge?.destroy(); charged.delete(mesh);
        }
        circle(glow, 0, 0, size * 0.16, 0x66ccff, fade * 0.25);
      } else if (volume) {
        volume.update(t);
      } else {
        const expansion = 0.35 + Math.min(1, t * 4) * 0.9;
        const heat = Math.max(0, 1 - t * 2.6);
        for (const lobe of lobes) {
          const x = lobe.x * size * expansion, y = lobe.y * size * expansion - t * size * 0.8;
          const radius = lobe.radius * size * expansion;
          // Layered, shaded billows retain depth if a GPU shader is unavailable.
          for (let band = 7; band > 0; band--) {
            const r = radius * (1 + t) * band / 7;
            circle(smoke, x, y, r, 0x28272b, fade * .055);
            circle(smoke, x - radius * .16, y - radius * .22, r * .76,
              heat > .25 ? 0x88604b : 0x77767a, fade * .035);
          }
          if (heat > 0) {
            circle(glow, x, y, radius * 1.3, 0xff3311, heat * fade * 0.1);
            circle(glow, x, y, radius, 0xff660a, heat * fade * 0.4);
            circle(glow, x, y, radius * 0.55, 0xffcc44, heat * fade * 0.7);
          }
        }
        if (t < 0.13) circle(glow, 0, 0, size * (0.2 + t * 3), 0xfff3ce, (1 - t / 0.13) * fade);
      }
      for (const p of particles) {
        const age = t - p.delay;
        if (age <= 0 || age >= p.life) continue;
        const x = Math.cos(p.angle) * size * p.speed * age * 2;
        const y = Math.sin(p.angle) * size * p.speed * age * 2 + size * age * age;
        const tail = size * 0.08 * (1 - age / p.life);
        const path = [[x - Math.cos(p.angle) * tail, y - Math.sin(p.angle) * tail], [x, y]];
        const alpha = 1 - age / p.life, color = point.kind === "electric" ? 0x9edfff : 0xffba45;
        line(glow, path, p.width * 4, color, alpha * 0.12);
        line(glow, path, p.width, 0xfff2cb, alpha);
      }
    } catch (error) { console.warn("STA2e Toolkit | Console effect stopped:", error); stop(); }
  }
  try {
    const layer = canvas.interface ?? canvas.tokens;
    layer.sortableChildren = true; layer.addChild(container);
    active.add(handle); audio.remaining++; counted = true;
    ticker.add(tick); timer = setTimeout(stop, duration + 250); tick();
    return true;
  } catch (error) { stop(); console.warn("STA2e Toolkit | Console effect failed:", error); return false; }
}

export function registerConsoleEffectHooks() {
  void loadSkeletonTexture();
  Hooks.on("canvasTearDown", () => { stopConsoleEffectsLocal(); clearConsoleCinematicTextures(); seen.clear(); });
}
