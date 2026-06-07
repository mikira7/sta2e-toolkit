/**
 * sta2e-toolkit | momentum-tracker.js
 *
 * Interactive overflow tracker chat card. On a successful task that generates
 * momentum (or non-bankable bonus momentum), the toolkit auto-banks the
 * `float` to the world pool and posts a tracker card mirroring the just-
 * generated `{ float, bonus }`. Downstream spend actions (damage cards,
 * future non-combat spends) decrement the tracker via socket. When both
 * buckets hit 0, the tracker auto-deletes. The GM can manually end the
 * tracker at any time (forfeits remaining bonus; float stays in pool).
 *
 * Flag namespace: `flags.sta2e-toolkit.overflowTracker = {
 *   float, bonus, pool, ownerActorId, ownerActorName, taskRollId,
 *   generatedAt, postedAtMs
 * }`
 */

import { getLcTokens } from "./lcars-theme.js";
import { readPool, writePool, poolLimit } from "./momentum-spend.js";

const MODULE = "sta2e-toolkit";

function getLC() {
  try { return getLcTokens() ?? {}; } catch { return {}; }
}

// ─── Card HTML ───────────────────────────────────────────────────────────────

function buildTrackerCardHtml({ float, bonus, versatile = 0, pool, ownerActorName, bankedToPool = 0, weaponName = null, messageId = null }) {
  const LC = getLC();
  const bg        = LC.bg        ?? "#1a1a1a";
  const secondary = LC.secondary ?? "#cc88ff";
  const tertiary  = LC.tertiary  ?? "#ffcc66";
  const textDim   = LC.textDim   ?? "#888";
  const text      = LC.text      ?? "#ffcc66";
  const font      = LC.font      ?? "var(--font-primary)";
  const border    = LC.border    ?? "#ff9900";
  const borderDim = LC.borderDim ?? "#664400";

  const poolLabel = pool === "threat" ? "THREAT" : "MOMENTUM";
  const poolIcon  = pool === "threat" ? "⚡" : "💫";
  const headerColor = pool === "threat" ? (LC.primary ?? "#ff9900") : secondary;

  const chip = (label, val, color) => `
    <div style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;
      min-width:62px;padding:4px 8px;background:rgba(0,0,0,0.35);
      border:1px solid ${color};border-radius:2px;margin-right:6px;">
      <div style="font-size:8px;color:${textDim};text-transform:uppercase;letter-spacing:0.1em;font-family:${font};">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color};font-family:${font};line-height:1;">${val}</div>
    </div>`;

  const endBtnHtml = `
    <button class="sta2e-tracker-end"
      data-message-id="${messageId ?? ""}"
      style="margin-top:6px;width:100%;padding:4px 8px;background:rgba(0,0,0,0.25);
        border:1px solid ${borderDim};border-radius:2px;cursor:pointer;
        font-family:${font};font-size:9px;font-weight:700;color:${textDim};
        letter-spacing:0.1em;text-transform:uppercase;">
      ✕ End Tracker (Forfeit Bonus)
    </button>`;

  return `
    <div class="sta2e-momentum-tracker" data-pool="${pool}"
      style="background:${bg};border:2px solid ${headerColor};border-radius:3px;
      overflow:hidden;font-family:${font};">
      <div style="background:${headerColor};color:${bg};font-size:9px;font-weight:700;
        letter-spacing:0.15em;text-transform:uppercase;padding:3px 10px;">
        ${poolIcon} ${poolLabel} OVERFLOW — ${ownerActorName ?? ""}
      </div>
      <div style="padding:8px 10px;">
        <div style="display:flex;align-items:center;flex-wrap:wrap;margin-bottom:5px;">
          ${chip("FLOAT", float, headerColor)}
          ${chip("BONUS", bonus, tertiary)}
          ${versatile > 0 ? chip("VERSATILE", versatile, LC.primary ?? "#ff9900") : ""}
        </div>
        <div style="font-size:9px;color:${textDim};line-height:1.5;font-family:${font};">
          ${float > 0 ? `<strong style="color:${headerColor};">Float</strong> didn't fit in the pool (cap reached) — spend on this action or it's lost.` : ""}
          ${bankedToPool > 0 ? `<br>+${bankedToPool} already banked to pool.` : ""}
          ${bonus > 0 ? `<br><span style="color:${tertiary};">Bonus</span> is non-bankable (e.g. Intense species ability) — spend or it expires.` : ""}
          ${versatile > 0 ? `<br><span style="color:${LC.primary ?? "#ff9900"};">Versatile</span>${weaponName ? ` (${weaponName})` : ""} — spend on Extra Damage, Devastating, or Trait Creation only.` : ""}
        </div>
        ${endBtnHtml}
      </div>
    </div>`;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Create a tracker chat message and auto-bank as much momentum as fits into
 * the pool. The portion that *doesn't* fit (because the pool would exceed
 * its cap) becomes "float" — held in the tracker for the user to spend on
 * the current action. Unspent float is lost when the tracker is ended.
 *
 * @param {Actor} ownerActor       - Actor that generated the momentum.
 * @param {object} opts
 * @param {number} opts.totalGenerated - Total overflow successes from the roll.
 * @param {number} opts.bonus      - Non-bankable bonus momentum (e.g. Andorian Intense).
 * @param {"momentum"|"threat"} opts.pool
 * @param {string} [opts.taskRollId]
 * @param {Token|TokenDocument|null} [opts.speakerToken]
 * @returns {Promise<{ message: ChatMessage|null, banked: number, float: number }>}
 */
export async function createTracker(ownerActor, { totalGenerated = 0, bonus = 0, versatile = 0, weaponName = null, pool = "momentum", taskRollId = null, speakerToken = null } = {}) {
  totalGenerated = Math.max(0, totalGenerated | 0);
  bonus = Math.max(0, bonus | 0);
  versatile = Math.max(0, versatile | 0);

  // Split the generated momentum:
  //   banked → what fits into the pool (gets written immediately)
  //   float  → the overflow above the pool cap, held in the tracker for
  //            this action's spends. Lost if not spent before action end.
  let banked = 0;
  let float = 0;
  if (totalGenerated > 0) {
    const cur = readPool(pool);
    const limit = poolLimit(pool);
    banked = Math.max(0, Math.min(totalGenerated, limit - cur));
    float  = totalGenerated - banked;
    if (banked > 0) {
      await writePool(pool, cur + banked, { source: "overflow", actor: ownerActor, token: speakerToken });
    }
  }

  // No leftover float, no bonus, no versatile → nothing to track. The bank
  // notice already shows on the summary card.
  if (float === 0 && bonus === 0 && versatile === 0) {
    return { message: null, banked, float: 0 };
  }

  const trackerData = {
    float, bonus, versatile, pool,
    bankedToPool:   banked,
    weaponName:     weaponName ?? null,
    ownerActorId:   ownerActor?.id ?? null,
    ownerActorName: ownerActor?.name ?? "",
    taskRollId:     taskRollId ?? null,
    generatedAt:    Date.now(),
  };

  // Only the GM should create the actual chat message to keep authorship/flag
  // permissions consistent. Players route via socket.
  if (!game.user.isGM) {
    game.socket.emit(`module.${MODULE}`, {
      action: "createOverflowTracker",
      trackerData,
      speakerTokenId: speakerToken?.id ?? null,
    });
    return { message: null, banked, float };
  }

  const msg = await _gmCreateTracker(trackerData, speakerToken);
  return { message: msg, banked, float };
}

export async function _gmCreateTracker(trackerData, speakerToken = null) {
  // A new task roll starts a fresh overflow window. End any prior active
  // tracker for this actor+pool first, so its leftover float/bonus can't be
  // pulled alongside the new one (otherwise a spend would see both overflows).
  try {
    await endPriorTrackers(trackerData.ownerActorId, trackerData.pool);
  } catch (err) {
    console.warn("STA2e Toolkit | endPriorTrackers failed:", err);
  }

  const content = buildTrackerCardHtml({
    float: trackerData.float,
    bonus: trackerData.bonus,
    versatile: trackerData.versatile ?? 0,
    pool:  trackerData.pool,
    ownerActorName: trackerData.ownerActorName,
    bankedToPool: trackerData.bankedToPool ?? 0,
    weaponName: trackerData.weaponName ?? null,
  });
  const msg = await ChatMessage.create({
    flags: { [MODULE]: { overflowTracker: trackerData } },
    content,
    speaker: ChatMessage.getSpeaker({ token: speakerToken ?? null, alias: "STA2e Toolkit" }),
  });
  return msg;
}

/**
 * GM-only: delete every existing tracker for an actor (optionally scoped to a
 * single pool). Called when a new task roll opens a fresh overflow window so
 * stale trackers don't linger and double-count toward later spends. Leftover
 * float already lives in the pool; only the non-bankable bonus is forfeited.
 *
 * @param {string} ownerActorId
 * @param {"momentum"|"threat"|null} [pool] - If set, only ends matching-pool trackers.
 */
export async function endPriorTrackers(ownerActorId, pool = null) {
  if (!ownerActorId || !game.user.isGM) return;
  const msgs = game.messages?.contents ?? [];
  const stale = [];
  for (const m of msgs) {
    const t = m.getFlag(MODULE, "overflowTracker");
    if (!t || t.ownerActorId !== ownerActorId) continue;
    if (pool && t.pool !== pool) continue;
    stale.push(m.id);
  }
  for (const id of stale) {
    const m = game.messages.get(id);
    if (!m) continue;
    try { await m.delete(); }
    catch (err) { console.warn("STA2e Toolkit | endPriorTrackers delete failed:", err); }
  }
}

/**
 * Find the most-recent active tracker for an actor.
 * @param {string} ownerActorId
 * @returns {ChatMessage|null}
 */
export function getActiveTracker(ownerActorId) {
  if (!ownerActorId) return null;
  const msgs = game.messages?.contents ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = msgs[i].getFlag(MODULE, "overflowTracker");
    if (!t || t.ownerActorId !== ownerActorId) continue;
    if ((t.float | 0) <= 0 && (t.bonus | 0) <= 0) continue;
    return msgs[i];
  }
  return null;
}

/**
 * Decrement a tracker. GM-only — players should socket to here.
 * Auto-deletes the message when both buckets hit 0.
 *
 * @param {string} messageId
 * @param {{ float?: number, bonus?: number }} delta - Positive numbers to subtract.
 */
export async function decrementTracker(messageId, { float = 0, bonus = 0, versatile = 0 } = {}) {
  if (!game.user.isGM) {
    game.socket.emit(`module.${MODULE}`, {
      action: "decrementOverflowTracker",
      messageId, float, bonus, versatile,
    });
    return;
  }
  const msg = game.messages.get(messageId);
  if (!msg) return;
  const t = msg.getFlag(MODULE, "overflowTracker");
  if (!t) return;
  const newFloat = Math.max(0, (t.float | 0) - Math.max(0, float | 0));
  const newBonus = Math.max(0, (t.bonus | 0) - Math.max(0, bonus | 0));
  const newVersatile = Math.max(0, (t.versatile | 0) - Math.max(0, versatile | 0));

  if (newFloat <= 0 && newBonus <= 0 && newVersatile <= 0) {
    try { await msg.delete(); } catch (err) { console.warn("STA2e Toolkit | tracker delete failed:", err); }
    return;
  }

  const newContent = buildTrackerCardHtml({
    float: newFloat,
    bonus: newBonus,
    versatile: newVersatile,
    pool: t.pool,
    ownerActorName: t.ownerActorName,
    bankedToPool: t.bankedToPool ?? 0,
    weaponName: t.weaponName ?? null,
  });
  await msg.update({
    [`flags.${MODULE}.overflowTracker.float`]: newFloat,
    [`flags.${MODULE}.overflowTracker.bonus`]: newBonus,
    [`flags.${MODULE}.overflowTracker.versatile`]: newVersatile,
    content: newContent,
  });
}

/**
 * Set absolute bucket values on a tracker. Used when the user manually adjusts
 * bonus momentum in a spend panel (e.g. from a talent the auto-detector missed).
 * Pass `undefined` to leave a bucket unchanged. Auto-deletes if all hit 0.
 */
export async function setTrackerBucket(messageId, { float, bonus, versatile } = {}) {
  if (!game.user.isGM) {
    game.socket.emit(`module.${MODULE}`, {
      action: "setOverflowTrackerBucket",
      messageId, float, bonus, versatile,
    });
    return;
  }
  const msg = game.messages.get(messageId);
  if (!msg) return;
  const t = msg.getFlag(MODULE, "overflowTracker");
  if (!t) return;
  const newFloat     = float     === undefined ? (t.float     | 0) : Math.max(0, float     | 0);
  const newBonus     = bonus     === undefined ? (t.bonus     | 0) : Math.max(0, bonus     | 0);
  const newVersatile = versatile === undefined ? (t.versatile | 0) : Math.max(0, versatile | 0);

  if (newFloat <= 0 && newBonus <= 0 && newVersatile <= 0) {
    try { await msg.delete(); } catch (err) { console.warn("STA2e Toolkit | tracker delete failed:", err); }
    return;
  }

  const newContent = buildTrackerCardHtml({
    float: newFloat,
    bonus: newBonus,
    versatile: newVersatile,
    pool: t.pool,
    ownerActorName: t.ownerActorName,
    bankedToPool: t.bankedToPool ?? 0,
    weaponName: t.weaponName ?? null,
  });
  await msg.update({
    [`flags.${MODULE}.overflowTracker.float`]:     newFloat,
    [`flags.${MODULE}.overflowTracker.bonus`]:     newBonus,
    [`flags.${MODULE}.overflowTracker.versatile`]: newVersatile,
    content: newContent,
  });
}

/**
 * GM-only: end (delete) a tracker. Bonus is forfeited; float remains in pool.
 */
export async function endTracker(messageId) {
  if (!game.user.isGM) {
    game.socket.emit(`module.${MODULE}`, {
      action: "endOverflowTracker",
      messageId,
    });
    return;
  }
  const msg = game.messages.get(messageId);
  if (!msg) return;
  try { await msg.delete(); } catch (err) { console.warn("STA2e Toolkit | tracker end failed:", err); }
}

// ─── Render hook ─────────────────────────────────────────────────────────────

function wireTrackerCard(message, html) {
  const tracker = message?.getFlag?.(MODULE, "overflowTracker");
  if (!tracker) return;
  const card = html.querySelector(".sta2e-momentum-tracker");
  if (!card) return;
  // Re-stamp the End button with the live messageId (initial render had no id)
  const endBtn = card.querySelector(".sta2e-tracker-end");
  if (endBtn) {
    endBtn.dataset.messageId = message.id;
    if (!game.user.isGM) {
      endBtn.style.display = "none";
    } else if (endBtn.dataset.wired !== "1") {
      endBtn.dataset.wired = "1";
      endBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        endBtn.disabled = true;
        endBtn.style.opacity = "0.5";
        try { await endTracker(message.id); }
        catch (err) { console.error("STA2e Toolkit | endTracker error:", err); }
      });
    }
  }
}

export function registerMomentumTracker() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    try { wireTrackerCard(message, html); }
    catch (err) { console.error("STA2e Toolkit | wireTrackerCard error:", err); }
  });
}
