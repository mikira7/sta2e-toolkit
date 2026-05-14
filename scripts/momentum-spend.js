/**
 * sta2e-toolkit | momentum-spend.js
 *
 * Multi-bucket momentum/threat spending panel for combat chat cards.
 * Tracks floating momentum (overflow from the triggering roll), bonus
 * momentum (manual input + auto from Andorian Intense talent), Versatile
 * X bonus momentum (ship weapons), and the shared pool — and auto-deducts
 * in that order when the user spends on Extra Damage, Devastating Attack,
 * Secondary Target, or Trait Creation.
 *
 * Plumbed in via:
 *   - Damage-card builders stamp `flags.sta2e-toolkit.spendContext` on the
 *     ChatMessage carrying { floatingMomentum, qualities, scope,
 *     attackerIsNpc, attackerActorId, attackerTokenId, intenseTalentBonus }.
 *   - The `renderChatMessageHTML` hook in `wireSpendPanels` injects the
 *     panel UI above the existing damage controls.
 *   - The Apply Damage button consumes the spend before invoking
 *     CombatHUD.applyDamage.
 */

import { getLcTokens } from "./lcars-theme.js";

const MODULE = "sta2e-toolkit";

// ─── Pool R/W (shared with npc-roller) ───────────────────────────────────────

function _STClass() { return game.STATracker?.constructor ?? null; }
export function readPool(key) {
  const ST = _STClass();
  if (ST) return ST.ValueOf(key) ?? 0;
  try { return game.settings.get("sta", key) ?? 0; } catch { return 0; }
}
export function poolLimit(key) {
  const ST = _STClass();
  if (ST?.LimitOf) {
    try { return Number(ST.LimitOf(key)) || (key === "momentum" ? 6 : 99); }
    catch { return key === "momentum" ? 6 : 99; }
  }
  return key === "momentum" ? 6 : 99;
}
export async function writePool(key, v) {
  const ST = _STClass();
  // Cap-aware write — STA's DoUpdateResource throws above the pool's limit.
  const capped = Math.max(0, Math.min(Number(v) || 0, poolLimit(key)));
  if (ST) { await ST.DoUpdateResource(key, capped); return; }
  try { await game.settings.set("sta", key, capped); } catch { /* ignore */ }
}

// ─── Intense (Andorian) species ability detection ────────────────────────────

const INTENSE_TALENT_NAMES = [
  "intense",
  "intense (andorian)",
  "intense (andorian species ability)",
  "intense (species ability)",
];

export function actorHasIntenseTalent(actor) {
  if (!actor?.items) return false;
  for (const item of actor.items) {
    const n = (item.name ?? "").trim().toLowerCase();
    if (INTENSE_TALENT_NAMES.includes(n)) return true;
  }
  return false;
}

// ─── Spend-context construction ──────────────────────────────────────────────

/**
 * Build the spendContext flag payload for a damage card.
 * @param {object} ctx
 * @param {number} ctx.floatingMomentum - Overflow successes from the triggering roll.
 * @param {object} ctx.qualities - Weapon qualities relevant to spend rules.
 * @param {"ship"|"ground"} ctx.scope
 * @param {boolean} ctx.attackerIsNpc - NPC attackers spend Threat by default.
 * @param {string|null} [ctx.attackerActorId]
 * @param {string|null} [ctx.attackerTokenId]
 * @param {number} [ctx.intenseTalentBonus] - Pre-computed Andorian Intense bonus.
 */
export function makeSpendContext({
  floatingMomentum = 0,
  qualities = {},
  scope = "ship",
  attackerIsNpc = false,
  attackerActorId = null,
  attackerTokenId = null,
  intenseTalentBonus = 0,
  trackerMessageId = null,
} = {}) {
  return {
    floatingMomentum: Math.max(0, floatingMomentum | 0),
    qualities: {
      intense:   !!qualities.intense,
      area:      !!qualities.area,
      spread:    !!qualities.spread,
      piercing:  !!qualities.piercing,
      versatile: Math.max(0, (qualities.versatile | 0) || 0),
      isShip:    scope === "ship",
    },
    scope,
    attackerIsNpc: !!attackerIsNpc,
    attackerActorId: attackerActorId ?? null,
    attackerTokenId: attackerTokenId ?? null,
    intenseTalentBonus: Math.max(0, intenseTalentBonus | 0),
    trackerMessageId: trackerMessageId ?? null,
  };
}

/**
 * Read live `{ float, bonus, versatile, pool, messageId }` from a tracker
 * chat message. If `messageId` is null, falls back to the most-recent active
 * tracker for `attackerActorId`. Returns zeros if no tracker is found.
 */
export function readTrackerState(messageId, attackerActorId = null) {
  let msg = messageId ? (game.messages?.get?.(messageId) ?? null) : null;
  if (!msg && attackerActorId) {
    // Fallback: find the most-recent un-dismissed tracker for the attacker.
    // Needed for player-driven attacks where the tracker is created via
    // socket round-trip and the originating client never had the message ID.
    const msgs = game.messages?.contents ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const t = msgs[i].getFlag(MODULE, "overflowTracker");
      if (!t || t.ownerActorId !== attackerActorId) continue;
      if ((t.float | 0) <= 0 && (t.bonus | 0) <= 0 && (t.versatile | 0) <= 0) continue;
      msg = msgs[i];
      break;
    }
  }
  if (!msg) return { float: 0, bonus: 0, versatile: 0, pool: null, messageId: null };
  const t = msg.getFlag(MODULE, "overflowTracker");
  if (!t) return { float: 0, bonus: 0, versatile: 0, pool: null, messageId: null };
  return {
    float:     Math.max(0, t.float | 0),
    bonus:     Math.max(0, t.bonus | 0),
    versatile: Math.max(0, t.versatile | 0),
    pool:      t.pool ?? null,
    messageId: msg.id,
  };
}

// ─── Cost rules ──────────────────────────────────────────────────────────────

function extraDamageCost(qualities) { return qualities.intense ? 1 : 2; }
function devastatingCost(qualities) { return qualities.spread ? 1 : 2; }
const SECONDARY_TARGET_COST = 1;
const TRAIT_CREATION_COST = 2;

// What spends versatile bonus momentum is allowed to fund.
function versatileEligible(spendKey) {
  return spendKey === "extraDamage" || spendKey === "devastating" || spendKey === "trait";
}

// ─── Panel HTML ──────────────────────────────────────────────────────────────

function getLC() {
  try { return getLcTokens() ?? {}; } catch { return {}; }
}

function lcars() {
  const LC = getLC();
  return {
    bg:        LC.bg        ?? "#000",
    panel:     LC.panel     ?? "#111",
    border:    LC.border    ?? "#ff9900",
    borderDim: LC.borderDim ?? "#664400",
    text:      LC.text      ?? "#ffcc66",
    textDim:   LC.textDim   ?? "#aa7700",
    textBright:LC.textBright?? "#ffe9b8",
    primary:   LC.primary   ?? "#ff9900",
    secondary: LC.secondary ?? "#cc88ff",
    tertiary:  LC.tertiary  ?? "#ffcc66",
    green:     LC.green     ?? "#66ff99",
    red:       LC.red       ?? "#ff5555",
    yellow:    LC.yellow    ?? "#ffcc44",
    font:      LC.font      ?? "var(--font-primary)",
  };
}

/**
 * Build the spend panel HTML for a single damage card target.
 * Inserted above the existing `.sta2e-damage-controls` block.
 *
 * Encodes spendContext into a data attribute so the wire-up handler can
 * mutate the sibling `sta2e-extra-damage` input + payload on apply.
 */
function buildSpendPanelHtml(spendCtx, targetTokenId) {
  const LC = lcars();
  const q = spendCtx.qualities;
  const showSecondary   = q.area;
  const showTrait       = q.isShip;
  const extraCost = extraDamageCost(q);
  const groundMax = !q.isShip ? 2 : null;

  const sourceDefault = spendCtx.attackerIsNpc ? "threat" : "momentum";

  // Live tracker state — try by explicit messageId first, then fall back to
  // most-recent active tracker for the attacker (handles player-driven
  // attacks where socket round-trip leaves the original messageId unknown).
  const tracker = readTrackerState(spendCtx.trackerMessageId, spendCtx.attackerActorId);
  const floating = tracker.float || spendCtx.floatingMomentum || 0;
  const intenseBonus = tracker.bonus || spendCtx.intenseTalentBonus || 0;
  const versatile = tracker.versatile || q.versatile || 0;

  // Compact data blob for the wire-up
  const dataBlob = encodeURIComponent(JSON.stringify({
    ctx: spendCtx,
    targetTokenId,
    sourceDefault,
    extraCost,
    secondaryCost: SECONDARY_TARGET_COST,
    traitCost: TRAIT_CREATION_COST,
    groundMax,
  }));

  const labelStyle = `font-size:9px;color:${LC.textDim};text-transform:uppercase;letter-spacing:0.08em;font-family:${LC.font};`;
  const chipStyle = (active) => `display:inline-block;padding:1px 5px;border:1px solid ${active ? LC.primary : LC.borderDim};border-radius:2px;color:${active ? LC.primary : LC.textDim};background:${active ? "rgba(255,153,0,0.08)" : "transparent"};font-size:9px;font-family:${LC.font};letter-spacing:0.06em;`;
  const inputStyle = `width:38px;padding:1px 3px;background:${LC.bg};border:1px solid ${LC.border};border-radius:2px;color:${LC.text};font-size:11px;text-align:center;font-family:${LC.font};`;

  const rowBase = (key, label, costLabel, max = null, visible = true) => `
    <div class="sta2e-spend-row" data-key="${key}" style="display:${visible ? "flex" : "none"};align-items:center;gap:4px;margin-top:2px;">
      <label style="${labelStyle}flex:1;">${label}</label>
      <span style="${labelStyle}">${costLabel}</span>
      <input class="sta2e-spend-input" data-key="${key}" type="number" min="0" ${max !== null ? `max="${max}"` : ""} value="0" style="${inputStyle}"/>
    </div>`;

  return `
  <div class="sta2e-spend-panel" data-spend="${dataBlob}" style="margin-top:5px;padding:5px 6px;border:1px solid ${LC.borderDim};border-radius:2px;background:rgba(255,153,0,0.03);">
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;align-items:center;">
      <span style="${labelStyle}">SPEND:</span>
      <span class="sta2e-spend-chip" data-bucket="floating" style="${chipStyle(floating > 0)}" title="Floating Momentum — overflow that didn't fit in the pool. Spend on this action or it's lost.">FLOAT <strong class="sta2e-spend-chip-val sta2e-spend-float-val">${floating}</strong></span>
      <span class="sta2e-spend-chip" data-bucket="pool" data-source="momentum" style="${chipStyle(false)}" title="Group Momentum pool">MOM <strong class="sta2e-spend-pool-mom">${readPool("momentum")}</strong></span>
      <span class="sta2e-spend-chip" data-bucket="pool" data-source="threat" style="${chipStyle(false)}" title="Threat pool">THR <strong class="sta2e-spend-pool-thr">${readPool("threat")}</strong></span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;align-items:center;">
      <span class="sta2e-spend-chip" data-bucket="bonus" style="${chipStyle(intenseBonus > 0)}" title="Bonus momentum (e.g. talents, advantages, Andorian Intense). Cannot be saved to pool. Edits sync to the Overflow Tracker.">BONUS <input class="sta2e-spend-bonus-input" type="number" min="0" value="${intenseBonus}" style="${inputStyle}width:36px;margin-left:3px;"/></span>
      ${versatile > 0 ? `<span class="sta2e-spend-chip" data-bucket="versatile" style="${chipStyle(true)}" title="Versatile X bonus momentum — only Extra Damage, Devastating Attack, or Trait Creation.">VERSATILE <strong class="sta2e-spend-chip-val">${versatile}</strong></span>` : ""}
    </div>
    ${rowBase("extraDamage",  `Extra Damage Die${groundMax ? ` (max ${groundMax})` : ""}`, `${extraCost}/die`, groundMax)}
    ${rowBase("secondary",    `Secondary Target (Area)`,                                     `${SECONDARY_TARGET_COST}`, 1, showSecondary)}
    ${rowBase("trait",        `Create Trait`,                                                `${TRAIT_CREATION_COST}`,   3, showTrait)}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:5px;gap:6px;flex-wrap:wrap;">
      <div style="display:flex;gap:6px;align-items:center;">
        <label style="${labelStyle}">Source:</label>
        <label style="font-size:10px;color:${LC.text};font-family:${LC.font};cursor:pointer;">
          <input type="radio" name="sta2e-spend-src-${targetTokenId}" class="sta2e-spend-source" value="momentum" ${sourceDefault === "momentum" ? "checked" : ""}/> Momentum
        </label>
        <label style="font-size:10px;color:${LC.text};font-family:${LC.font};cursor:pointer;">
          <input type="radio" name="sta2e-spend-src-${targetTokenId}" class="sta2e-spend-source" value="threat" ${sourceDefault === "threat" ? "checked" : ""}/> Threat
        </label>
      </div>
      <div class="sta2e-spend-tally" style="${labelStyle}">F:0 · B:0 · V:0 · P:0</div>
    </div>
  </div>`;
}

// ─── Wire-up ─────────────────────────────────────────────────────────────────

function recomputeSpend(panelEl) {
  const blob = JSON.parse(decodeURIComponent(panelEl.dataset.spend));
  const ctx = blob.ctx;
  const q = ctx.qualities;

  const getQty = (key) => {
    const inp = panelEl.querySelector(`.sta2e-spend-input[data-key="${key}"]`);
    return Math.max(0, parseInt(inp?.value ?? "0") || 0);
  };
  const bonusInput = panelEl.querySelector(".sta2e-spend-bonus-input");
  const bonusAvail = Math.max(0, parseInt(bonusInput?.value ?? "0") || 0);

  // Per-spend cost & versatile-eligibility
  const spends = [
    { key: "extraDamage", qty: getQty("extraDamage"), cost: blob.extraCost,     versatileOk: true },
    { key: "secondary",   qty: getQty("secondary"),   cost: blob.secondaryCost,  versatileOk: false },
    { key: "trait",       qty: getQty("trait"),       cost: blob.traitCost,      versatileOk: true },
  ];

  let needVersatile = 0;
  let needGeneral = 0;
  for (const s of spends) {
    const total = s.qty * s.cost;
    if (s.versatileOk) needVersatile += total;
    else                needGeneral  += total;
  }

  // Live tracker state — re-read each recompute so chips reflect any
  // decrements from other spend events on the same tracker. Falls back to
  // actor-id lookup if the explicit messageId was unknown at card-build time.
  const tracker = readTrackerState(ctx.trackerMessageId, ctx.attackerActorId);
  const floatAvail = tracker.float || ctx.floatingMomentum || 0;
  const bonusFromTracker = tracker.bonus || 0;
  const versatileAvail = tracker.versatile || ctx.qualities.versatile || 0;
  // Bonus input may have been edited up from the tracker's seed value.
  const bonusAvailEffective = Math.max(bonusAvail, bonusFromTracker);

  // Consume order: versatile (eligible only) → tracker float → bonus → pool
  let versatileUsed = Math.min(versatileAvail, needVersatile);
  let remainingVersatileNeed = needVersatile - versatileUsed;
  let remaining = remainingVersatileNeed + needGeneral;

  const floatingUsed = Math.min(floatAvail, remaining);
  remaining -= floatingUsed;

  const bonusUsed = Math.min(bonusAvailEffective, remaining);
  remaining -= bonusUsed;

  const source = panelEl.querySelector(".sta2e-spend-source:checked")?.value ?? blob.sourceDefault;
  const poolAvail = readPool(source);
  const poolUsed = Math.min(poolAvail, remaining);
  remaining -= poolUsed;

  // Update FLOAT chip display so users see live tracker state
  const floatChipVal = panelEl.querySelector(".sta2e-spend-float-val");
  if (floatChipVal) floatChipVal.textContent = String(floatAvail);

  const tally = panelEl.querySelector(".sta2e-spend-tally");
  if (tally) {
    const insufficient = remaining > 0;
    tally.textContent = `F:${floatingUsed} · B:${bonusUsed} · V:${versatileUsed} · P:${poolUsed}${insufficient ? ` · NEED ${remaining}` : ""}`;
    tally.style.color = insufficient ? (getLC().red ?? "#ff5555") : (getLC().textDim ?? "#aa7700");
  }

  // Tracker pool fallback: if no tracker was found, derive pool from the
  // attacker's side (NPC=threat, PC=momentum) so floating spends still
  // deduct from the correct world pool.
  const trackerPool = tracker.pool ?? (ctx.attackerIsNpc ? "threat" : "momentum");

  return {
    spends,
    versatileUsed,
    floatingUsed,
    bonusUsed,
    poolUsed,
    source,
    trackerMessageId: tracker.messageId ?? ctx.trackerMessageId ?? null,
    trackerPool,
    // Bonus draw is decremented from the tracker only up to the seeded amount;
    // any spent over the seed came from the user's manual top-up (no tracker).
    bonusFromTrackerSpent: Math.min(bonusUsed, bonusFromTracker),
    insufficient: remaining > 0,
    extraDice: spends.find(s => s.key === "extraDamage").qty,
    secondary: spends.find(s => s.key === "secondary").qty > 0,
    trait: spends.find(s => s.key === "trait").qty,
  };
}

/**
 * Wire the spend panel inside an already-rendered chat message.
 * Called from the renderChatMessageHTML hook.
 */
export function wireSpendPanel(html) {
  const panels = html.querySelectorAll(".sta2e-spend-panel");
  if (!panels.length) return;

  panels.forEach(panel => {
    if (panel.dataset.wired === "1") return;
    panel.dataset.wired = "1";

    // Stop drag/click bubbling on inputs/labels (chat messages eat input)
    panel.querySelectorAll("input,label,.sta2e-spend-chip").forEach(el => {
      el.addEventListener("mousedown", e => e.stopPropagation());
      el.addEventListener("click",     e => e.stopPropagation());
    });

    const update = () => {
      const result = recomputeSpend(panel);
      // Sync the legacy adjustment input below us so existing payload logic
      // still applies the bonus to finalDamage / potency.
      // Ship damage card → `.sta2e-damage-controls` + `.sta2e-extra-damage` + `.sta2e-apply-damage`
      // Ground damage card → `.sta2e-ground-controls` + `.sta2e-ground-adj` + `.sta2e-apply-injury`
      const controls = panel.parentElement?.querySelector(".sta2e-damage-controls, .sta2e-ground-controls");
      const extraInput = controls?.querySelector(".sta2e-extra-damage, .sta2e-ground-adj");
      const applyBtn = controls?.querySelector(".sta2e-apply-damage, .sta2e-apply-injury");
      if (extraInput) {
        // Extra dice + devastating (Devastating ≈ +Vicious 1 / High Yield equivalent).
        // For ship Devastating we set the highYield flag on the payload; the die
        // count itself stays at extraDice. For ground we treat Devastating as +X
        // damage equal to the weapon's stress severity bump — handled at apply.
        const newExtra = result.extraDice;
        if (extraInput.value !== String(newExtra)) {
          extraInput.value = String(newExtra);
          extraInput.dispatchEvent(new Event("input", { bubbles: false }));
        }
      }
      // Stash latest spend result on the apply button so click handler can read it.
      if (applyBtn) applyBtn.dataset.spendResult = encodeURIComponent(JSON.stringify(result));
      // Disable apply if insufficient
      if (applyBtn) {
        if (result.insufficient) {
          applyBtn.dataset.spendBlocked = "1";
          applyBtn.style.outline = `1px dashed ${lcars().red}`;
        } else {
          delete applyBtn.dataset.spendBlocked;
          applyBtn.style.outline = "";
        }
      }
    };

    // Sync the user-edited BONUS value back to the linked Momentum Overflow
    // Tracker so subsequent spends (Devastating Attack button, other actions
    // sharing the tracker) see the full bonus pool.
    const syncBonusToTracker = () => {
      try {
        const blob = JSON.parse(decodeURIComponent(panel.dataset.spend));
        const ctx = blob.ctx;
        const bonusInput = panel.querySelector(".sta2e-spend-bonus-input");
        const newBonus = Math.max(0, parseInt(bonusInput?.value ?? "0") || 0);
        const trackerLive = readTrackerState(ctx.trackerMessageId, ctx.attackerActorId);
        const targetId = trackerLive.messageId ?? ctx.trackerMessageId;
        if (!targetId) return;            // no tracker to sync to
        if (newBonus === trackerLive.bonus) return;
        if (game.user.isGM) {
          import("./momentum-tracker.js").then(mod =>
            mod.setTrackerBucket(targetId, { bonus: newBonus })
          ).catch(err => console.warn("STA2e Toolkit | setTrackerBucket error:", err));
        } else {
          game.socket.emit("module.sta2e-toolkit", {
            action: "setOverflowTrackerBucket",
            messageId: targetId,
            bonus: newBonus,
          });
        }
      } catch (err) { console.warn("STA2e Toolkit | syncBonusToTracker error:", err); }
    };

    // Bonus input → also push to tracker (debounced via change event)
    const bonusInput = panel.querySelector(".sta2e-spend-bonus-input");
    if (bonusInput) {
      bonusInput.addEventListener("change", syncBonusToTracker);
      bonusInput.addEventListener("blur",   syncBonusToTracker);
    }

    panel.querySelectorAll(".sta2e-spend-input,.sta2e-spend-bonus-input,.sta2e-spend-source")
      .forEach(el => {
        el.addEventListener("input",  update);
        el.addEventListener("change", update);
      });

    update();
  });
}

/**
 * Consume the spend recorded on an Apply Damage button before the damage is
 * applied. Returns true if the spend was consumed (or there was nothing to
 * spend); false if it was blocked due to insufficient pool.
 *
 * Players cannot write the world pool directly — for PC threat-generation
 * and PC momentum-spend, we route through a socket so the GM applies it.
 */
export async function consumeSpendForApply(btn) {
  const raw = btn?.dataset?.spendResult;
  if (!raw) return true;
  let result;
  try { result = JSON.parse(decodeURIComponent(raw)); }
  catch { return true; }

  if (result.insufficient) {
    ui.notifications?.warn("Insufficient Momentum/Threat for selected spends.");
    return false;
  }

  const {
    floatingUsed = 0,
    bonusUsed = 0,
    bonusFromTrackerSpent = 0,
    versatileUsed = 0,
    poolUsed = 0,
    source = "momentum",
    trackerMessageId = null,
    trackerPool = null,
  } = result;
  const totalSpent = floatingUsed + bonusUsed + versatileUsed + poolUsed;
  if (totalSpent === 0) return true;

  // Float in the tracker is overflow that didn't fit in the pool — spending it
  // does NOT decrement the pool (it was never banked there). It only decrements
  // the tracker card.

  // Decrement the tracker card by floatingUsed (float bucket),
  // bonusFromTrackerSpent (bonus bucket), and versatileUsed (versatile bucket).
  if (trackerMessageId && (floatingUsed > 0 || bonusFromTrackerSpent > 0 || versatileUsed > 0)) {
    if (game.user.isGM) {
      const mod = await import("./momentum-tracker.js");
      await mod.decrementTracker(trackerMessageId, {
        float: floatingUsed,
        bonus: bonusFromTrackerSpent,
        versatile: versatileUsed,
      });
    } else {
      game.socket.emit("module.sta2e-toolkit", {
        action: "decrementOverflowTracker",
        messageId: trackerMessageId,
        float: floatingUsed,
        bonus: bonusFromTrackerSpent,
        versatile: versatileUsed,
      });
    }
  }

  // Pool deduction from the user-selected source (typically the player's
  // momentum or NPC's threat pool, when tracker float was exhausted).
  if (poolUsed > 0) {
    if (game.user.isGM) {
      const cur = readPool(source);
      await writePool(source, cur - poolUsed);
    } else {
      game.socket.emit("module.sta2e-toolkit", {
        action: "spendPool",
        source,
        amount: poolUsed,
      });
    }
  }

  // Versatile + bonus over the tracker seed are ephemeral — no persistence.
  return true;
}

/**
 * Convenience helper for callers that want to add the panel to an existing
 * damage-card HTML string. Looks for `.sta2e-damage-controls` and prepends
 * the panel above it.
 *
 * Generally easier to just stamp `spendContext` flag on the ChatMessage and
 * let `injectSpendPanels` do its work at render time.
 */
export function injectSpendPanelInline(html, spendCtx, targetTokenId) {
  if (!spendCtx || !html) return html;
  const panel = buildSpendPanelHtml(spendCtx, targetTokenId);
  return html.replace(
    /(<div class="sta2e-damage-controls")/,
    `${panel}$1`
  );
}

/**
 * Run on every rendered chat message. If the message carries a
 * spendContext flag, inject a spend panel above each damage-controls block.
 */
export function injectSpendPanels(message, html) {
  const flags = message?.flags?.[MODULE];
  if (!flags) return;
  const spendCtx = flags.spendContext;
  if (!spendCtx) return;
  // Only GMs see/use spend panels (matches existing apply-damage gating).
  // Players can still see existing controls if shown elsewhere; the spend
  // panel is GM-only because spending the world pool requires GM perms.
  // Exception: if the actor is owned by the player and this is a player-
  // initiated PC attack, allow the player to drive the panel and route the
  // pool write via socket.
  const isOwnedAttacker = spendCtx.attackerActorId
    ? (game.actors.get(spendCtx.attackerActorId)?.testUserPermission?.(game.user, "OWNER") ?? false)
    : false;
  if (!game.user.isGM && !isOwnedAttacker) return;

  const controlsList = html.querySelectorAll(".sta2e-damage-controls, .sta2e-ground-controls");
  if (!controlsList.length) return;

  controlsList.forEach((controls, idx) => {
    if (controls.previousElementSibling?.classList?.contains("sta2e-spend-panel")) return;
    let targetTokenId = null;
    try {
      const inp = controls.querySelector(".sta2e-extra-damage, .sta2e-ground-adj");
      const basePayload = inp?.dataset?.basePayload;
      if (basePayload) targetTokenId = JSON.parse(decodeURIComponent(basePayload))?.tokenId ?? null;
    } catch { /* ignore */ }
    const panelHtml = buildSpendPanelHtml(spendCtx, targetTokenId ?? `idx${idx}`);
    controls.insertAdjacentHTML("beforebegin", panelHtml);
  });

  wireSpendPanel(html);
}

/**
 * Register hooks. Call once during the `init` (or `ready`) hook from main.js.
 */
export function registerMomentumSpend() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    try { injectSpendPanels(message, html); }
    catch (err) { console.error("STA2e Toolkit | injectSpendPanels error:", err); }
  });

  // Wrap existing Apply Damage click so consumeSpendForApply runs first.
  // Done by listening to clicks in capture phase on the same selector.
  document.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.(".sta2e-apply-damage, .sta2e-apply-injury");
    if (!btn) return;
    if (btn.dataset.spendConsumed === "1") return;
    if (!btn.dataset.spendResult) return; // no panel on this card
    if (btn.dataset.spendBlocked === "1") {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      ui.notifications?.warn("Insufficient Momentum/Threat — adjust spend before applying.");
      return;
    }
    btn.dataset.spendConsumed = "1";
    try { await consumeSpendForApply(btn); }
    catch (err) { console.error("STA2e Toolkit | consumeSpendForApply error:", err); }
  }, true);
}
