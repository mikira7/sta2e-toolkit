/** Socket playback and GM-owned document lifecycle, separate from cosmetic rendering. */
import {
  TRANSPORTER_SHADER_ACTION, normalizeTransporterType, normalizeTransporterShader,
  getTransporterShaderSettings, createTransporterOperationCache, transporterNow,
} from "./transporter-shader-config.js";
import { playTransporterShader, stopTransporterShaders, releaseTransporterShaders } from "./transporter-shader.js";

const operations = createTransporterOperationCache();
const pending = new Map();
const running = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const waitUntil = time => wait(time - transporterNow());

export function isTransporterShaderRunning(tokenOrDocument) {
  const doc = tokenOrDocument.document ?? tokenOrDocument;
  return running.has(`${doc.parent.id}:${doc.id}`);
}

function validMessage(msg) {
  return msg?.action === TRANSPORTER_SHADER_ACTION && typeof msg.operationId === "string"
    && msg.operationId.length <= 100 && typeof msg.tokenId === "string"
    && typeof msg.sceneId === "string" && ["in", "out"].includes(msg.phase)
    && Number.isFinite(msg.startTime) && Number.isFinite(msg.seed)
    && Number.isFinite(msg.targetAlpha) && msg.targetAlpha >= 0 && msg.targetAlpha <= 1
    && game.users?.get(msg.userId)?.isGM;
}

/** Called locally and through the existing module socket; never mutates documents. */
export async function receiveTransporterShader(msg) {
  if (!validMessage(msg) || msg.sceneId !== canvas.scene?.id) return null;
  const settings = normalizeTransporterShader(msg.type, msg.settings);
  const now = transporterNow();
  const expiry = msg.startTime + settings.duration;
  if (msg.startTime > now + 2000) return null;
  if (msg.cancel === true) {
    const entry = pending.get(msg.operationId);
    if (entry) entry.canceled = true;
    operations.accept(msg.operationId, Math.max(expiry, now + 1000), now);
    stopTransporterShaders({ operationId: msg.operationId, reason: "canceled" });
    return null;
  }
  if (!operations.accept(msg.operationId, expiry, now)) return null;
  const entry = { canceled: false };
  pending.set(msg.operationId, entry);
  try {
    // Token creation reaches clients independently of the VFX packet.
    const deadline = Math.min(expiry, now + 1500);
    while (!entry.canceled && transporterNow() < deadline && canvas.scene?.id === msg.sceneId) {
      const token = canvas.tokens?.get(msg.tokenId);
      if (canvas.ready && token?.mesh && !token.mesh.destroyed) {
        if ((token.document.hidden && !game.user.isGM) || token.visible === false) return null;
        return playTransporterShader(token, msg.type, {
          settings, phase: msg.phase, startTime: msg.startTime, seed: msg.seed,
          operationId: msg.operationId, targetAlpha: msg.targetAlpha,
        });
      }
      await wait(50);
    }
  } finally { pending.delete(msg.operationId); }
  return null;
}

function broadcast(msg) {
  try { game.socket.emit("module.sta2e-toolkit", msg); }
  catch (error) { console.warn("STA2e Toolkit | Transporter broadcast failed", error); }
}

/** GM controller: a rendering failure or canvas switch cannot strand a created token. */
export async function runTransporterShader(tokenOrDocument, type, phase) {
  if (!game.user.isGM) throw new Error("Only the GM can transport tokens");
  const doc = tokenOrDocument.document ?? tokenOrDocument;
  const key = `${doc.parent.id}:${doc.id}`;
  if (running.has(key)) return running.get(key);
  const task = (async () => {
    const settings = getTransporterShaderSettings(type);
    const msg = {
      action: TRANSPORTER_SHADER_ACTION, operationId: foundry.utils.randomID(),
      userId: game.user.id, sceneId: doc.parent.id, tokenId: doc.id,
      type: normalizeTransporterType(type), phase,
      settings, startTime: transporterNow() + 100, seed: Math.floor(Math.random()*10000),
      targetAlpha: phase === "in" ? 1 : doc.alpha ?? 1,
    };
    // Cosmetic work is deliberately not awaited before the authoritative timer starts.
    receiveTransporterShader(msg).catch(error => console.warn("STA2e Toolkit | Transporter playback failed", error));
    broadcast(msg);
    await waitUntil(msg.startTime + settings.duration * .8);
    try {
      // A separately deleted token needs no further document work.
      if (doc.parent.tokens.has(doc.id)) {
        if (phase === "out") await doc.delete();
        else {
          // One transient update failure should not strand an invisible arrival.
          try { await doc.update({ alpha: 1 }, { animate: false }); }
          catch { await wait(200); await doc.update({ alpha: 1 }, { animate: false }); }
        }
      }
    } catch (error) {
      broadcast({ ...msg, cancel: true });
      await receiveTransporterShader({ ...msg, cancel: true });
      ui.notifications.error(`Transporter ${phase === "in" ? "arrival" : "departure"} failed for ${doc.name}. ${phase === "in" ? "The token remains on the scene; restore its opacity in token configuration." : "The token has been restored."}`);
      console.error("STA2e Toolkit | Transporter document operation failed", error);
      throw error;
    }
    await waitUntil(msg.startTime + settings.duration);
  })();
  running.set(key, task);
  try { return await task; }
  finally { if (running.get(key) === task) running.delete(key); }
}

export function teardownTransporterShaderPlayback() {
  for (const entry of pending.values()) entry.canceled = true;
  pending.clear();
  operations.clear();
  releaseTransporterShaders();
  // GM document timers continue across scene changes so cross-scene transport completes.
}
