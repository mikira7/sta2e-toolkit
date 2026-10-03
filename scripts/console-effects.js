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
  shake = false, shakeOptions, preview = false } = {}) {
  if (!game.user?.isGM || !canvas?.ready || !canvas.scene) return false;
  const locations = getConsoleLocations();
  const selected = Array.isArray(ids) ? locations.filter(p => ids.includes(p.id)).slice(0, 16)
    : chooseConsoleLocations(locations, count);
  if (!selected.length) { ui.notifications.warn("Add a console location to this scene first."); return false; }
  const event = { action: CONSOLE_EFFECT_ACTION, id: crypto.randomUUID(), userId: game.user.id,
    sceneId: canvas.scene.id, duration: bound(duration, 2.5, 0.4, 6), seed: Math.floor(Math.random() * 4294967296),
    locations: selected.map(p => ({ ...p, kind: kind === "mixed" ? (Math.random() < 0.5 ? "electric" : "explosion")
      : kind === "explosion" ? "explosion" : "electric" })),
    shake: shake === true, shakeOptions: normalizeShake(shakeOptions) };
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
        const pulse = .5 + .5 * Math.sin(t * duration / 38 + seed);
        bloom?.update(t, pulse);
        // Soft nested falloff also provides a glow on renderers without sprites.
        if (!bloom) for (let band = 12; band > 0; band--) {
          const radius = size * 1.3 * band / 12;
          circle(glow, 0, 0, radius, band > 4 ? 0x2266ff : 0x99ddff,
            fade * (.035 + pulse * .025) * (1 - band / 13));
        }
        for (let arc = 0; arc < 5; arc++) {
          const angle = flicker() * Math.PI * 2, length = size * (0.3 + flicker() * 0.8);
          const path = [[0, 0]];
          for (let j = 1; j <= 7; j++) {
            const along = length * j / 7, jitter = (flicker() - 0.5) * size * 0.25;
            path.push([Math.cos(angle) * along - Math.sin(angle) * jitter, Math.sin(angle) * along + Math.cos(angle) * jitter]);
          }
          line(glow, path, Math.max(5, size * 0.18), 0x2244ff, fade * 0.055);
          line(glow, path, Math.max(3, size * 0.09), 0x3377ff, fade * 0.16);
          line(glow, path, Math.max(1.5, size * 0.03), 0x66ccff, fade * 0.7);
          line(glow, path, Math.max(0.6, size * 0.01), 0xf0fcff, fade);
          const end = path[path.length - 1];
          bloom?.contact(arc, end[0], end[1], fade * (.5 + pulse * .5));
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
  Hooks.on("canvasTearDown", () => { stopConsoleEffectsLocal(); clearConsoleCinematicTextures(); seen.clear(); });
}
