/** Scene-scoped, transient canvas effects. Camera coordinates are never changed. */
import { playSceneEffectSound } from "./scene-effect-audio.js";
export const SCENE_SHAKE_ACTION = "sceneCanvasShake";
export const SCENE_SHAKE_STOP_ACTION = "stopSceneCanvasShake";
const CHANNEL = "module.sta2e-toolkit";
let active = null;
let activeSound = null;
const seen = new Set();

export const SHAKE_PRESETS = {
  impact: { mode: "impact", strength: 14, duration: 1.5, frequency: 24 },
  earthquake: { mode: "earthquake", strength: 8, duration: 8, frequency: 12 },
};

export function normalizeShake(options = {}) {
  const bounded = (key, fallback, min, max) => {
    const value = Number(options[key]);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return {
    mode: options.mode === "earthquake" ? "earthquake" : "impact",
    strength: bounded("strength", 14, 1, 40),
    duration: bounded("duration", 1.5, 0.2, 30),
    frequency: bounded("frequency", 24, 4, 40),
  };
}

/** Seeded offsets give every viewer the same motion, independent of zoom. */
export function shakeKeyframes(options, seed) {
  const cfg = normalizeShake(options);
  let state = (Number(seed) >>> 0) || 1;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296 * 2 - 1;
  };
  const count = Math.max(4, Math.ceil(cfg.duration * cfg.frequency));
  const frames = [{ offset: 0, translate: "0px 0px" }];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const envelope = cfg.mode === "impact"
      ? (1 - t) ** 2
      : Math.min(1, t / 0.08, (1 - t) / 0.18);
    const amplitude = cfg.strength * envelope;
    frames.push({ offset: t, translate: `${random() * amplitude}px ${random() * amplitude}px` });
  }
  frames.push({ offset: 1, translate: "0px 0px" });
  return frames;
}

export function stopCanvasShake() {
  const previous = active;
  active = null;
  activeSound?.stop(); activeSound = null;
  previous?.cancel();
}

export function playCanvasShakeLocal(options, seed) {
  const surface = canvas?.app?.canvas ?? canvas?.app?.view;
  if (!canvas?.ready || !canvas.scene || typeof surface?.animate !== "function") return false;
  stopCanvasShake();
  const cfg = normalizeShake(options);
  // Animate the canvas element rather than PIXI's camera. Additive translate
  // preserves any existing CSS transform; cancelling restores it automatically.
  const animation = surface.animate(shakeKeyframes(cfg, seed), {
    duration: cfg.duration * 1000, easing: "linear", composite: "add",
  });
  active = animation;
  activeSound = playSceneEffectSound(cfg.mode, { seed });
  animation.onfinish = () => {
    if (active === animation) stopCanvasShake();
  };
  return true;
}

export function previewCanvasShake(options = {}) {
  if (!game.user?.isGM) return false;
  return playCanvasShakeLocal(options, Math.floor(Math.random() * 4294967296));
}

export function broadcastCanvasShake(options = {}) {
  if (!game.user?.isGM || !canvas?.ready || !canvas.scene) return false;
  const message = {
    action: SCENE_SHAKE_ACTION, sceneId: canvas.scene.id,
    userId: game.user.id, id: crypto.randomUUID(),
    seed: Math.floor(Math.random() * 4294967296), ...normalizeShake(options),
  };
  // Foundry sockets do not loop back to the sender.
  if (!handleSceneEffectSocket(message)) return false;
  game.socket.emit(CHANNEL, message);
  return true;
}

export function broadcastStopCanvasShake() {
  if (!game.user?.isGM || !canvas?.scene) return false;
  stopCanvasShake();
  game.socket.emit(CHANNEL, {
    action: SCENE_SHAKE_STOP_ACTION, sceneId: canvas.scene.id, userId: game.user.id,
  });
  return true;
}

export function handleSceneEffectSocket(message) {
  if (!message || ![SCENE_SHAKE_ACTION, SCENE_SHAKE_STOP_ACTION].includes(message.action)) return false;
  if (!game.users?.get(message.userId)?.isGM || !canvas?.ready || message.sceneId !== canvas.scene?.id) return false;
  if (message.action === SCENE_SHAKE_STOP_ACTION) {
    stopCanvasShake();
    return true;
  }
  if (typeof message.id !== "string" || seen.has(message.id)) return false;
  seen.add(message.id);
  if (seen.size > 128) seen.delete(seen.values().next().value);
  return playCanvasShakeLocal(message, message.seed);
}

export function registerSceneEffectHooks() {
  Hooks.on("canvasTearDown", stopCanvasShake);
}
