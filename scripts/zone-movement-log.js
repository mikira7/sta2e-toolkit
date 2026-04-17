/**
 * sta2e-toolkit | zone-movement-log.js
 * Posts an LCARS-styled chat message when a token moves between zones.
 *
 * Gated behind:
 *   - Per-scene flag `sta2e-toolkit.zoneMovementLog` (if set, overrides global)
 *   - OR global setting `zoneMovementLog` (fallback)
 *   - Per-scene flag `sta2e-toolkit.zonesEnabled` != false
 *
 * Called from main.js `updateToken` hook via `toolkit.zoneMovementLog.onTokenMove(...)`.
 *
 * When the destination zone has a momentumCost > 0 the card gains interactive
 * "Spend Momentum / Spend Threat / Skip" buttons.  Clicking a button deducts
 * from the appropriate pool and marks the card resolved so buttons are replaced
 * with a confirmation line on any subsequent re-render.
 */

import { getSceneZones, getZoneAtPoint, getZonePathWithCosts, rangeBandFor } from "./zone-data.js";
import { getLcTokens } from "./lcars-theme.js";
import { PaymentPrompt } from "./payment-prompt.js";
import { CombatHUD } from "./combat-hud.js";

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });
const MODULE = "sta2e-toolkit";

// ─────────────────────────────────────────────────────────────────────────────
// Momentum / Threat pool helpers
// ─────────────────────────────────────────────────────────────────────────────

function _staTracker() {
  return game.STATracker?.constructor ?? null;
}

function _getMomentum() {
  const T = _staTracker();
  if (T) return T.ValueOf("momentum") ?? 0;
  try { return game.settings.get("sta", "momentum") ?? 0; } catch { return 0; }
}
async function _setMomentum(v) {
  const T = _staTracker();
  if (T) { await T.DoUpdateResource("momentum", Math.max(0, v)); return; }
  try { await game.settings.set("sta", "momentum", Math.max(0, v)); } catch { /* ignore */ }
}
function _getThreat() {
  const T = _staTracker();
  if (T) return T.ValueOf("threat") ?? 0;
  try { return game.settings.get("sta", "threat") ?? 0; } catch { return 0; }
}
async function _setThreat(v) {
  const T = _staTracker();
  if (T) { await T.DoUpdateResource("threat", Math.max(0, v)); return; }
  try { await game.settings.set("sta", "threat", Math.max(0, v)); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// NPC detection (mirrors ZoneHazard._isNpc)
// ─────────────────────────────────────────────────────────────────────────────

function _isNpc(actor) {
  if (!actor) return false;
  if (actor.system?.systems !== undefined) {
    // Ships: use the explicit NPC/player flag set via the Combat HUD toggle
    return CombatHUD.isNpcShip(actor);
  }
  return actor.hasPlayerOwner === false;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZoneMovementLog
// ─────────────────────────────────────────────────────────────────────────────

export class ZoneMovementLog {

  constructor() {
    // Wire interactive cost-card buttons on every chat message render
    this._onRenderChat = this._wireCostButtons.bind(this);
    Hooks.on("renderChatMessageHTML", this._onRenderChat);
    // Token IDs whose zone log is suppressed during multi-frame animations
    this._suppressIds = new Set();
  }

  destroy() {
    Hooks.off("renderChatMessageHTML", this._onRenderChat);
  }

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Called from the main.js updateToken hook when a token's position changes.
   * @param {TokenDocument} tokenDoc
   * @param {{x:number,y:number}} origin  canvas center of token before the move
   * @param {object} changes              the update changes object
   */
  async onTokenMove(tokenDoc, origin, changes) {
    if (!this._isEnabled()) return;
    if (this._suppressIds.has(tokenDoc.id)) return;

    const zones = getSceneZones();
    if (!zones.length) return;

    const gs = canvas.grid?.size ?? 100;
    const tw = (tokenDoc.width  ?? 1) * gs;
    const th = (tokenDoc.height ?? 1) * gs;
    const dest = {
      x: (changes.x ?? tokenDoc.x) + tw / 2,
      y: (changes.y ?? tokenDoc.y) + th / 2,
    };

    const fromZone = getZoneAtPoint(origin.x, origin.y, zones);
    const toZone   = getZoneAtPoint(dest.x,   dest.y,   zones);

    // Only log if zones actually differ
    if (!fromZone || !toZone) return;
    if (fromZone.id === toZone.id) return;

    const actor  = canvas.tokens?.get(tokenDoc.id)?.actor ?? null;
    const isNpc  = _isNpc(actor);
    const isShip = actor?.system?.systems !== undefined;

    const info = getZonePathWithCosts(origin, dest, zones);

    // Terrain hazards in the destination zone are folded into the movement card
    const terrainHazards = (toZone.hazards ?? []).filter(h => h.category === "terrain");

    await this._postMovementCard(tokenDoc, fromZone, toZone, info, isNpc, isShip, terrainHazards);

    // Non-terrain hazards (lingering) still resolve separately
    const hazardZones = (info.steps ?? [])
      .slice(1)
      .map(step => zones.find(z => z.id === step.zoneId))
      .filter(z => z?.hazards?.some(h => h.category !== "terrain"));

    if (hazardZones.length > 0) {
      const { ZoneHazard } = await import("./zone-hazard.js");
      for (const hz of hazardZones) {
        for (const hazard of hz.hazards) {
          if (hazard.category === "terrain") continue;
          await ZoneHazard.resolveHazard(tokenDoc, hz, hazard);
        }
      }
    }
  }

  // ── Card rendering ────────────────────────────────────────────────────────

  async _postMovementCard(tokenDoc, fromZone, toZone, info, isNpc, isShip, terrainHazards = []) {
    const tokenName   = tokenDoc.name ?? "Unknown";
    const zn          = info.zoneCount;
    const band        = info.rangeBand ?? rangeBandFor(zn);
    const mom         = info.momentumCost;
    const isDifficult = toZone.isDifficult || toZone.momentumCost > 0;
    const hasOtherHazard = (toZone.hazards ?? []).some(h => h.category !== "terrain");
    const hasTerrain  = terrainHazards.length > 0;
    // Terrain zones always have a cost; fall back to 1 if momentumCost not set
    const cost        = hasTerrain ? Math.max(mom, 1) : mom;
    const hasCost     = cost > 0;

    const fromName = fromZone.name || "(unnamed)";
    const toName   = toZone.name   || "(unnamed)";

    const zoneRow = hasCost
      ? `${zn} zone${zn !== 1 ? "s" : ""} · ${band} · +${cost} ${isNpc ? "Threat" : "Momentum"}`
      : `${zn} zone${zn !== 1 ? "s" : ""} · ${band}`;

    // Warning flags above the cost row
    const warningRows = [
      isDifficult && !hasTerrain ? `<div style="color:${LC.yellow};font-size:0.75em;letter-spacing:0.06em;">⚠ Difficult Terrain</div>` : "",
      hasOtherHazard             ? `<div style="color:${LC.red};font-size:0.75em;letter-spacing:0.06em;">⚠ Hazardous Zone</div>` : "",
    ].join("");

    // Hazardous terrain detail block shown inside the cost row
    const terrainBlock = hasTerrain ? `
  <div style="border:1px solid ${LC.yellow};border-radius:4px;padding:6px 8px;margin-bottom:4px;
    background:rgba(255,200,0,0.05);">
    <div style="color:${LC.yellow};font-size:0.68em;font-weight:700;letter-spacing:1px;margin-bottom:4px;">
      ⚠ HAZARDOUS TERRAIN
    </div>
    ${terrainHazards.map(h => `
      <div style="color:${LC.textBright};font-size:0.78em;font-weight:700;">${h.label || h.type}</div>
      ${h.description ? `<div style="color:${LC.textDim};font-size:0.72em;margin-top:1px;">${h.description}</div>` : ""}
    `).join("")}
    <div style="color:${LC.textDim};font-size:0.68em;margin-top:5px;font-style:italic;">
      ${isNpc
        ? "Threat spent for movement triggers the hazard."
        : "Using Threat instead of Momentum triggers the hazard."}
    </div>
  </div>` : "";

    // Buttons
    const spendLabel = hasTerrain && isNpc
      ? `💰 Spend ${cost} Threat — Hazard Triggers`
      : `💰 Spend ${cost} ${isNpc ? "Threat" : "Momentum"}`;

    const costRow = hasCost ? `
  <div class="sta2e-zone-cost-row" style="padding:6px 12px;border-top:1px solid ${LC.borderDim};display:flex;flex-direction:column;gap:4px;">
    ${terrainBlock}
    <button class="sta2e-spend-movement-cost"
      style="width:100%;padding:4px 8px;font-family:${LC.font};font-size:0.72em;font-weight:700;
        letter-spacing:0.06em;text-transform:uppercase;background:${LC.panel};
        border:1px solid ${LC.primary};border-radius:3px;color:${LC.primary};cursor:pointer;">
      ${spendLabel}
    </button>
    <button class="sta2e-skip-movement-cost"
      style="width:100%;padding:4px 8px;font-family:${LC.font};font-size:0.72em;font-weight:700;
        letter-spacing:0.06em;text-transform:uppercase;background:${LC.panel};
        border:1px solid ${LC.borderDim};border-radius:3px;color:${LC.textDim};cursor:pointer;">
      ⭐ Skip (GM Override)
    </button>
  </div>` : "";

    const content = `
<div style="background:${LC.bg};border:2px solid ${LC.primary};border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:320px;">
  <div style="background:${LC.primary};padding:5px 12px;display:flex;align-items:center;justify-content:space-between;">
    <span style="color:#000;font-weight:700;font-size:0.7em;letter-spacing:2px;">ZONE MOVEMENT</span>
  </div>
  <div style="padding:8px 12px;border-bottom:1px solid ${LC.borderDim};">
    <div style="color:${LC.textBright};font-size:0.9em;font-weight:700;">${tokenName}</div>
  </div>
  <div style="padding:8px 12px;border-bottom:1px solid ${LC.borderDim};display:flex;align-items:center;gap:10px;">
    <div style="flex:1;text-align:center;">
      <div style="color:${LC.textDim};font-size:0.55em;letter-spacing:0.12em;margin-bottom:2px;">FROM</div>
      <div style="color:${LC.text};font-size:0.82em;">${fromName}</div>
    </div>
    <div style="color:${LC.primary};font-size:1.1em;">▶</div>
    <div style="flex:1;text-align:center;">
      <div style="color:${LC.textDim};font-size:0.55em;letter-spacing:0.12em;margin-bottom:2px;">TO</div>
      <div style="color:${LC.text};font-size:0.82em;">${toName}</div>
    </div>
  </div>
  <div style="padding:7px 12px;${warningRows ? "border-bottom:1px solid " + LC.borderDim + ";" : ""}">
    <div style="color:${LC.secondary};font-size:0.78em;">${zoneRow}</div>
  </div>
  ${warningRows ? `<div style="padding:5px 12px;${hasCost ? "border-bottom:1px solid " + LC.borderDim + ";" : ""}">${warningRows}</div>` : ""}
  ${costRow}
  <div style="background:${LC.panel};padding:4px 12px;">
    <span style="color:${LC.textDim};font-size:0.5em;letter-spacing:2px;">ZONE TRACKER</span>
  </div>
</div>`;

    // Serialise terrain hazard info for button handlers (stored in flags)
    const terrainPayloads = terrainHazards.map(h => ({
      zoneId:            toZone.id,
      hazardId:          h.id,
      hazardLabel:       h.label || h.type,
      hazardDescription: h.description ?? "",
      tokenId:           tokenDoc.id,
      actorId:           tokenDoc.actor?.id ?? null,
      isShip,
      isNpc,
    }));

    await ChatMessage.create({
      content,
      speaker: { alias: "Zone Tracker" },
      whisper: game.users.filter(u => u.isGM || u.id === game.user.id).map(u => u.id),
      flags: {
        [MODULE]: {
          type:            hasTerrain ? "zoneMovementTerrain" : "zoneMovement",
          cost,
          isNpc,
          resolved:        false,
          terrainPayloads: hasTerrain ? terrainPayloads : undefined,
        },
      },
    });
  }

  // ── Interactive button wiring (fires on every renderChatMessageHTML) ───────

  _wireCostButtons(message, html) {
    const flags = message.flags?.[MODULE];
    // "zoneMovementTerrain" combined cards are handled by ZoneHazard.wireTerrainCard
    if (flags?.type !== "zoneMovement" || !flags.cost) return;

    const costRow = html.querySelector?.(".sta2e-zone-cost-row");
    if (!costRow) return;

    // If already resolved, replace buttons with a confirmation line
    if (flags.resolved) {
      const isSpent  = flags.resolution === "spent";
      let label = "";
      if (isSpent) {
        if (flags.paymentDetails && !flags.isNpc) {
          const m = flags.paymentDetails.momentumSpent;
          const t = flags.paymentDetails.threatAdded;
          label = `✅ Paid with ${m} Momentum / +${t} Threat`;
        } else {
          label = `✅ ${flags.cost} ${flags.isNpc ? "Threat" : "Momentum"} spent`;
        }
      } else {
        label = "⭐ Skipped (GM Override)";
      }
      const color    = isSpent ? "#00cc66" : LC.textDim;
      costRow.innerHTML = `
        <div style="padding:6px 12px;font-family:${LC.font};font-size:0.75em;
          font-weight:700;color:${color};letter-spacing:0.06em;">
          ${label}
        </div>`;
      return;
    }

    // Wire spend button
    const spendBtn = costRow.querySelector(".sta2e-spend-movement-cost");
    if (spendBtn) {
      spendBtn.addEventListener("click", async () => {
        const cost  = flags.cost;
        const isNpc = flags.isNpc;
        if (game.user.isGM) {
          if (isNpc) {
            await _setThreat(_getThreat() - cost);
            ui.notifications.info(`Spent ${cost} Threat for zone movement cost.`);
            await message.update({
              [`flags.${MODULE}.resolved`]:  true,
              [`flags.${MODULE}.resolution`]: "spent",
              [`flags.${MODULE}.paymentDetails`]: { threatSpent: cost }
            });
          } else {
            const payment = await PaymentPrompt.promptCost(cost);
            if (!payment) return; // User cancelled

            await _setMomentum(_getMomentum() - payment.momentumSpent);
            await _setThreat(_getThreat() + payment.threatAdded);
            ui.notifications.info(`Paid ${cost} movement cost (${payment.momentumSpent} Momentum, +${payment.threatAdded} Threat).`);

            await message.update({
              [`flags.${MODULE}.resolved`]:  true,
              [`flags.${MODULE}.resolution`]: "spent",
              [`flags.${MODULE}.paymentDetails`]: payment
            });
          }
        } else {
          // Non-GM: open PaymentPrompt locally if needed, then route to GM via socket
          let payment = null;
          if (!isNpc) {
            payment = await PaymentPrompt.promptCost(cost);
            if (!payment) return; // User cancelled
          }
          game.socket.emit("module.sta2e-toolkit", {
            action:    "zoneMovementPayment",
            messageId: message.id,
            isNpc,
            payment:   payment ?? { threatSpent: cost },
            cost,
          });
          ui.notifications.info(
            isNpc
              ? `Requesting GM to spend ${cost} Threat for zone movement.`
              : `Paid ${cost} movement cost (${payment.momentumSpent} Momentum, +${payment.threatAdded} Threat).`
          );
        }
      });
    }

    // Wire skip button
    const skipBtn = costRow.querySelector(".sta2e-skip-movement-cost");
    if (skipBtn) {
      skipBtn.addEventListener("click", async () => {
        await message.update({
          [`flags.${MODULE}.resolved`]:  true,
          [`flags.${MODULE}.resolution`]: "skipped",
        });
      });
    }
  }

  // ── Socket payment handler (called on GM client) ─────────────────────────

  async processPayment(messageId, payment, isNpc, cost) {
    const message = game.messages.get(messageId);
    if (!message) return;
    if (isNpc) {
      await _setThreat(_getThreat() - cost);
      ui.notifications.info(`Spent ${cost} Threat for zone movement cost.`);
      await message.update({
        [`flags.${MODULE}.resolved`]:  true,
        [`flags.${MODULE}.resolution`]: "spent",
        [`flags.${MODULE}.paymentDetails`]: { threatSpent: cost }
      });
    } else {
      await _setMomentum(_getMomentum() - payment.momentumSpent);
      await _setThreat(_getThreat() + payment.threatAdded);
      ui.notifications.info(`Paid ${cost} movement cost (${payment.momentumSpent} Momentum, +${payment.threatAdded} Threat).`);
      await message.update({
        [`flags.${MODULE}.resolved`]:  true,
        [`flags.${MODULE}.resolution`]: "spent",
        [`flags.${MODULE}.paymentDetails`]: payment
      });
    }
  }

  // ── Settings check ────────────────────────────────────────────────────────

  _isEnabled() {
    const perScene = canvas?.scene?.getFlag(MODULE, "zonesEnabled");
    if (perScene === false) return false;

    const sceneLog = canvas?.scene?.getFlag(MODULE, "zoneMovementLog");
    if (sceneLog === true)  return true;
    if (sceneLog === false) return false;

    return game.settings.get(MODULE, "zoneMovementLog") ?? false;
  }
}
