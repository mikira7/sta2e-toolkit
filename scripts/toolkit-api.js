/**
 * sta2e-toolkit | toolkit-api.js
 * Public API exposed as game.sta2eToolkit.
 * Macros and external modules (like the warp calculator) use this
 * instead of touching internals directly.
 */

import {
  getSceneZones, getZoneAtPoint as _getZoneAtPoint,
  getZoneDistance as _getZoneDistance,
} from "./zone-data.js";
import { TransporterVFX } from "./transporter-vfx.js";

export class ToolkitAPI {

  constructor({ campaignStore, hud, dateEditor, campaignManager }) {
    this.campaignStore = campaignStore;
    this.hud = hud;
    this.dateEditor = dateEditor;
    this.campaignManager = campaignManager;
  }

  /**
   * Re-render the HUD on all connected clients.
   * Call this any time world settings change that players need to see
   * (time advance, theme change, campaign switch, etc.)
   * The GM's own client re-renders immediately; the socket message
   * triggers re-render on all player clients.
   */
  broadcastHUDRender() {
    this.hud?.render();
    game.sta2eToolkit?.alertHud?._refreshTheme();
    // Re-render the combat HUD so it picks up any theme change immediately
    game.sta2eToolkit?.combatHud?._refresh?.();
    // Re-inject sheet CSS on the local (GM) client immediately
    game.sta2eToolkit?.refreshSheetTheme?.();
    // Socket message re-applies sheet CSS on all player clients too (see main.js renderHUD handler)
    game.socket.emit("module.sta2e-toolkit", { action: "renderHUD" });
  }

  // ---------------------------------------------------------------------------
  // Campaign data access
  // ---------------------------------------------------------------------------

  /**
   * Get the current active campaign snapshot.
   * @returns {object|null}
   * {
   *   id, name, era,
   *   stardate,           // number e.g. 49523.7
   *   calendarDate,       // ISO string e.g. "2372-03-14" or null
   *   time: { hours, minutes },
   *   dailyRate           // for TOS/custom
   * }
   */
  getActiveCampaign() {
    return this.campaignStore.getActiveCampaign();
  }

  /**
   * Get the current stardate as a number.
   * @returns {number}
   */
  getCurrentStardate() {
    return this.campaignStore.getActiveCampaign()?.stardate ?? 0;
  }

  /**
   * Get all campaigns.
   * @returns {object[]}
   */
  getCampaigns() {
    return this.campaignStore.getCampaigns();
  }

  // ---------------------------------------------------------------------------
  // Pool persistence — Momentum & Threat auto-sync per campaign
  //
  // Pools are kept in sync automatically:
  //   • Whenever sta.momentum or sta.threat changes in the STA tracker, the
  //     new value is silently saved to the active campaign (wired in main.js).
  //   • Whenever a campaign becomes active (scene change or switchCampaign),
  //     its saved pool values are automatically restored into the tracker.
  //
  // The two methods below are provided for macros that want explicit control.
  // ---------------------------------------------------------------------------

  /**
   * Manually snapshot the current live pool values into the active campaign.
   * (Auto-sync makes this unnecessary in normal play; useful for edge cases.)
   *
   * @example
   * await game.sta2eToolkit.savePoolsToActiveCampaign();
   */
  async savePoolsToActiveCampaign() {
    await this.campaignStore.savePoolsToActiveCampaign();
  }

  /**
   * Manually push a campaign's saved pool values back into the live tracker.
   * (Normally happens automatically on campaign switch.)
   *
   * @param {string} id  Campaign id to restore pools from.
   *
   * @example
   * await game.sta2eToolkit.restorePoolsFromCampaign("abc123");
   */
  async restorePoolsFromCampaign(id) {
    await this.campaignStore.restorePoolsFromCampaign(id);
  }

  /**
   * Switch the active campaign.
   * Automatically restores the incoming campaign's saved Momentum and Threat.
   * (Current pool values are already kept up-to-date by the auto-sync hook,
   * so there's no need to explicitly save before switching.)
   *
   * @param {string} id  Campaign id to switch to.
   *
   * @example
   * const campB = game.sta2eToolkit.getCampaigns().find(c => c.name === "Campaign B");
   * await game.sta2eToolkit.switchCampaign(campB.id);
   */
  async switchCampaign(id) {
    await this.campaignStore.setActiveCampaign(id);
  }

  // ---------------------------------------------------------------------------
  // Time advancement (used by warp calculator confirm travel)
  // ---------------------------------------------------------------------------

  /**
   * Advance the active campaign by a duration.
   * Automatically recalculates stardate based on era.
   *
   * @param {{ days?: number, hours?: number, minutes?: number }} delta
   *   Use negative values to go back in time.
   *
   * @example
   * // Warp calculator confirms travel of 4 days 7 hours
   * await game.sta2eToolkit.advanceByDuration({ days: 4, hours: 7 });
   */
  async advanceByDuration(delta) {
    await this.campaignStore.advanceByDuration(delta);
  }

  /**
   * Directly set the stardate and/or calendar date/time for the active campaign.
   * @param {{ stardate?, calendarDate?, time?: { hours, minutes } }} data
   */
  async setDateTime(data) {
    await this.campaignStore.setActiveDateTime(data);
  }

  // ---------------------------------------------------------------------------
  // Chat card helper — used by warp calculator confirm button
  // ---------------------------------------------------------------------------

  /**
   * Post a warp travel chat card with a "Confirm Travel" button.
   * The button will call advanceByDuration when clicked.
   *
   * @param {object} opts
   * @param {string} opts.shipName
   * @param {string} opts.destination
   * @param {number} opts.warpFactor
   * @param {number} opts.distanceLY
   * @param {{ days: number, hours: number, minutes: number }} opts.travelTime
   *
   * @example
   * await game.sta2eToolkit.postWarpCard({
   *   shipName: "USS Navajo",
   *   destination: "Caldos II",
   *   warpFactor: 7,
   *   distanceLY: 14.3,
   *   travelTime: { days: 4, hours: 7, minutes: 0 }
   * });
   */
  async postWarpCard({ shipName, destination, warpFactor, speedC, distanceLY, travelTime }) {
    const campaign = this.getActiveCampaign();
    if (!campaign) {
      ui.notifications.warn("STA2e Toolkit: No active campaign set.");
      return;
    }

    const { formatStardate, formatCalendarDate, formatTime, advanceCalendarTime, calcTNGStardate, calcTOSStardate, tosStardateToCalendar, advanceCustomStardate } =
      await import("./stardate-calc.js");

    // Calculate arrival stardate/date
    const { calendarDate: arrivalDate, time: arrivalTime } = advanceCalendarTime(
      campaign.calendarDate,
      campaign.time ?? { hours: 0, minutes: 0 },
      travelTime
    );

    let arrivalStardate;
    if ((campaign.era === "tng" || campaign.era === "tos") && arrivalDate) {
      const [y, m, d] = arrivalDate.split("-").map(Number);
      arrivalStardate = campaign.era === "tng"
        ? calcTNGStardate(y, m, d, arrivalTime.hours, arrivalTime.minutes)
        : calcTOSStardate(y, m, d, arrivalTime.hours, arrivalTime.minutes);
    } else if (campaign.era === "tos") {
      // TOS campaign with no calendarDate — reverse stardate to date, advance, recalculate
      const reversed = tosStardateToCalendar(campaign.stardate);
      const isoBase = `${reversed.year}-${String(reversed.month).padStart(2,"0")}-${String(reversed.day).padStart(2,"0")}`;
      const readvanced = advanceCalendarTime(isoBase, campaign.time ?? { hours: 0, minutes: 0 }, travelTime);
      const [y, m, d] = readvanced.calendarDate.split("-").map(Number);
      arrivalStardate = calcTOSStardate(y, m, d, readvanced.time.hours, readvanced.time.minutes);
    } else {
      const totalDays = travelTime.days + travelTime.hours / 24 + travelTime.minutes / (24 * 60);
      arrivalStardate = advanceCustomStardate(campaign.stardate, totalDays, 0, 0, campaign.dailyRate ?? 1.0);
    }

    const travelLabel = [
      travelTime.days ? `${travelTime.days}d` : "",
      travelTime.hours ? `${travelTime.hours}h` : "",
      travelTime.minutes ? `${travelTime.minutes}m` : ""
    ].filter(Boolean).join(" ") || "0h";

    // Encode delta for the confirm button
    const deltaEncoded = encodeURIComponent(JSON.stringify(travelTime));

    // --- Shared values ---
    const depSD    = formatStardate(campaign.stardate);
    const arrSD    = formatStardate(arrivalStardate);
    const speedStr = speedC != null ? speedC.toFixed(1) : null;

    // Full travel time string e.g. "Warp 9 (1516.0c): 1 day, 2 hours, 25 minutes"
    const timeParts = [];
    if (travelTime.years  > 0) timeParts.push(`${travelTime.years} year${travelTime.years   !== 1 ? "s" : ""}`);
    if (travelTime.days   > 0) timeParts.push(`${travelTime.days}  day${travelTime.days    !== 1 ? "s" : ""}`);
    timeParts.push(`${travelTime.hours} hour${travelTime.hours !== 1 ? "s" : ""}`);
    timeParts.push(`${travelTime.minutes} minute${travelTime.minutes !== 1 ? "s" : ""}`);
    const timeFullStr = (speedStr ? `Warp ${warpFactor} (${speedStr}c): ` : `Warp ${warpFactor}: `) + timeParts.join(", ");

    // --- Confirm / Cancel buttons (shared) ---
    const confirmBtns = `
      <div class="sta2e-warp-buttons" style="margin-top:8px;display:flex;gap:8px;">
        <button class="sta2e-confirm-travel" data-delta="${deltaEncoded}" style="flex:1;padding:7px;background:#1a1a1a;border:1px solid #555;color:#f90;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:0.75em;letter-spacing:2px;cursor:pointer;border-radius:3px;">
          ▶ CONFIRM TRAVEL
        </button>
        <button class="sta2e-cancel-travel" style="padding:7px 12px;background:#1a1a1a;border:1px solid #333;color:#555;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:0.75em;letter-spacing:2px;cursor:pointer;border-radius:3px;">
          ✕
        </button>
      </div>`;

    let content;

    if (campaign.era === "ent") {
      // --- ENT gunmetal/amber calendar style ---
      const fmtDate = (iso) => {
        if (!iso) return null;
        const [y, m, d] = iso.split("-");
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${d} ${months[parseInt(m,10)-1]} ${y}`;
      };
      const depDate = fmtDate(campaign.calendarDate);
      const arrDate = fmtDate(arrivalDate);
      const dateRow = depDate && arrDate ? `
  <tr style="border-top:1px solid #111;">
    <td style="padding:0;width:5px;background:#3a3a3e;"></td>
    <td style="padding:7px 12px;">
      <div style="color:#555;font-size:0.52em;letter-spacing:0.12em;margin-bottom:3px;text-transform:uppercase;">Date</div>
      <div style="display:flex;align-items:center;gap:14px;">
        <div><div style="color:#555;font-size:0.54em;letter-spacing:0.1em;">Departure</div><div style="font-family:'Courier New',monospace;color:#dd9944;font-size:0.9em;letter-spacing:0.04em;text-shadow:0 0 6px rgba(200,140,40,0.4);">${depDate}</div></div>
        <div style="color:#443322;font-size:1.1em;">▶</div>
        <div><div style="color:#555;font-size:0.54em;letter-spacing:0.1em;">Arrival</div><div style="font-family:'Courier New',monospace;color:#dd9944;font-size:0.9em;letter-spacing:0.04em;text-shadow:0 0 6px rgba(200,140,40,0.4);">${arrDate}</div></div>
      </div>
    </td>
  </tr>` : "";
      const entConfirmBtns = `
      <div class="sta2e-warp-buttons" style="margin-top:8px;display:flex;gap:8px;">
        <button class="sta2e-confirm-travel" data-delta="${deltaEncoded}" style="flex:1;padding:7px;background:linear-gradient(180deg,#3a3a3e 0%,#252528 100%);border:1px solid #cc8833;color:#cc8833;font-family:'Helvetica Neue',Arial,sans-serif;font-size:0.75em;letter-spacing:0.1em;cursor:pointer;border-radius:3px;">
          ▶ CONFIRM TRAVEL
        </button>
        <button class="sta2e-cancel-travel" style="padding:7px 12px;background:linear-gradient(180deg,#2a2a2e 0%,#1e1e20 100%);border:1px solid #333;color:#555;font-family:'Helvetica Neue',Arial,sans-serif;font-size:0.75em;letter-spacing:0.1em;cursor:pointer;border-radius:3px;">
          ✕
        </button>
      </div>`;
      content = `
<div style="background:linear-gradient(180deg,#2c2c2e 0%,#1e1e20 100%);border:1px solid #111;border-top:none;border-bottom:3px solid #0a0a0a;border-radius:0 0 5px 5px;font-family:'Helvetica Neue',Arial,sans-serif;max-width:420px;overflow:hidden;">
  <div style="background:linear-gradient(180deg,#1a1a1c 0%,#111113 100%);padding:9px 14px;border-bottom:2px solid #0a0a0a;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="color:#cc8833;font-size:0.72em;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">UESPA Navigational Analysis</div>
      <div style="font-family:'Courier New',monospace;color:#dd9944;font-size:0.9em;letter-spacing:0.04em;margin-top:3px;text-shadow:0 0 6px rgba(200,140,40,0.4);">${shipName.toUpperCase()} <span style="color:#443322;">▶</span> ${destination.toUpperCase()}</div>
    </div>
    ${depDate ? `<div style="background:#111;border:1px solid #333;border-radius:3px;padding:3px 8px;text-align:right;"><div style="color:#555;font-size:0.48em;letter-spacing:0.12em;display:block;">DATE</div><span style="font-family:'Courier New',monospace;color:#dd9944;font-size:0.8em;letter-spacing:0.04em;">${depDate}</span></div>` : ""}
  </div>
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:0;width:5px;background:#3a3a3e;"></td>
      <td style="padding:7px 12px;">
        <div style="color:#555;font-size:0.52em;letter-spacing:0.12em;margin-bottom:2px;text-transform:uppercase;">Distance</div>
        <div style="font-family:'Courier New',monospace;color:#dd9944;font-size:1em;letter-spacing:0.04em;text-shadow:0 0 6px rgba(200,140,40,0.4);">${distanceLY.toFixed(2)} <span style="color:#886622;font-size:0.65em;">LIGHT YEARS</span></div>
      </td>
    </tr>
    <tr style="border-top:1px solid #111;">
      <td style="padding:0;width:5px;background:#4a4a3a;"></td>
      <td style="padding:7px 12px;">
        <div style="color:#555;font-size:0.52em;letter-spacing:0.12em;margin-bottom:2px;text-transform:uppercase;">Travel Time</div>
        <div style="color:#aa6622;font-size:0.92em;font-family:'Courier New',monospace;letter-spacing:0.04em;">${timeFullStr}</div>
      </td>
    </tr>
    ${dateRow}
  </table>
  <div style="padding:8px 12px;border-top:1px solid #111;">
    ${entConfirmBtns}
  </div>
  <div style="background:linear-gradient(180deg,#1a1a1c 0%,#111113 100%);border-top:2px solid #0a0a0a;padding:5px 14px;display:flex;justify-content:space-between;">
    <div style="color:#2a2a2a;font-size:0.52em;letter-spacing:0.1em;text-transform:uppercase;">Earth Starfleet · UESPA</div>
    <div style="color:#2a2a2a;font-size:0.52em;letter-spacing:0.08em;">Cochrane Warp Drive Mk IV</div>
  </div>
</div>`;

    } else if (campaign.era === "tos") {
      // --- TOS/TMP dark panel style ---
      const sdRow = `
  <tr style="border-top:1px solid #1a1a1a;">
    <td style="padding:0;width:6px;background:#8B0000;"></td>
    <td style="padding:7px 12px;">
      <div style="color:#ff4444;font-size:0.52em;letter-spacing:2px;margin-bottom:3px;">STARDATE</div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div><div style="color:#aaa;font-size:0.56em;letter-spacing:1px;">DEPARTURE</div><div style="color:#ffcc44;font-size:0.95em;letter-spacing:2px;">${depSD}</div></div>
        <div style="color:#ff4444;font-size:1.2em;">▶</div>
        <div><div style="color:#aaa;font-size:0.56em;letter-spacing:1px;">ARRIVAL</div><div style="color:#ffcc44;font-size:0.95em;letter-spacing:2px;">${arrSD}</div></div>
      </div>
    </td>
  </tr>`;
      content = `
<div style="background:#0a0a0a;border:1px solid #444;border-top:3px solid #cc2200;border-radius:4px;overflow:hidden;font-family:'Share Tech Mono','Courier New',monospace;max-width:420px;">
  <div style="background:linear-gradient(180deg,#1a0a00 0%,#0d0500 100%);padding:10px 14px 8px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="color:#cc2200;font-size:0.58em;letter-spacing:3px;margin-bottom:2px;">STARFLEET · NAVIGATIONAL ANALYSIS</div>
      <div style="color:#ffcc44;font-size:0.95em;letter-spacing:1px;">${shipName.toUpperCase()} <span style="color:#cc2200;">▶</span> ${destination.toUpperCase()}</div>
    </div>
    <div style="background:#1a0500;border:1px solid #551100;border-radius:2px;padding:3px 8px;text-align:right;"><div style="color:#cc2200;font-size:0.48em;letter-spacing:2px;">SD</div><div style="color:#ffcc44;font-size:0.82em;letter-spacing:1px;">${depSD}</div></div>
  </div>
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:0;width:6px;background:#1a3a6a;"></td>
      <td style="padding:7px 12px;">
        <div style="color:#4499ff;font-size:0.52em;letter-spacing:2px;margin-bottom:2px;">DISTANCE</div>
        <div style="color:#fff;font-size:1.05em;letter-spacing:1px;">${distanceLY.toFixed(2)} <span style="color:#4499ff;font-size:0.65em;">LIGHT YEARS</span></div>
      </td>
    </tr>
    <tr style="border-top:1px solid #1a1a1a;">
      <td style="padding:0;width:6px;background:#8B4500;"></td>
      <td style="padding:7px 12px;">
        <div style="color:#ff8800;font-size:0.52em;letter-spacing:2px;margin-bottom:2px;">TRAVEL TIME</div>
        <div style="color:#fff;font-size:0.95em;">${timeFullStr}</div>
      </td>
    </tr>
    ${sdRow}
  </table>
  <div style="padding:8px 12px;border-top:1px solid #222;">
    ${confirmBtns}
  </div>
  <div style="background:#0d0500;border-top:1px solid #222;padding:5px 12px;display:flex;justify-content:space-between;">
    <div style="color:#441100;font-size:0.5em;letter-spacing:2px;">FEDERATION NAVIGATIONAL SYSTEMS</div>
    <div style="color:#441100;font-size:0.5em;letter-spacing:1px;">MK VII · WARP NAV</div>
  </div>
</div>`;

    } else {  // TNG / default LCARS
      // --- TNG/default LCARS orange style ---
      const sdFooter = `
  <div style="display:flex;border-bottom:1px solid #222;">
    <div style="background:#cc7700;width:8px;flex-shrink:0;"></div>
    <div style="padding:7px 14px;flex:1;display:flex;justify-content:space-between;align-items:center;">
      <div><div style="color:#cc7700;font-size:0.54em;letter-spacing:2px;margin-bottom:1px;">DEPARTURE STARDATE</div><div style="color:#fff;font-size:0.95em;letter-spacing:1px;">${depSD}</div></div>
      <div style="color:#f90;font-size:1em;padding:0 10px;">▶</div>
      <div style="text-align:right;"><div style="color:#cc7700;font-size:0.54em;letter-spacing:2px;margin-bottom:1px;">ARRIVAL STARDATE</div><div style="color:#fff;font-size:0.95em;letter-spacing:1px;">${arrSD}</div></div>
    </div>
  </div>`;
      content = `
<div style="background:#000;border-radius:12px;overflow:hidden;font-family:'Antonio','Trebuchet MS',sans-serif;border:2px solid #f90;max-width:420px;">
  <div style="height:44px;display:flex;align-items:center;background:#ff9900;border-radius:10px 0 0 0;padding:0 14px;">
    <div style="color:#000;font-size:0.68em;letter-spacing:3px;font-weight:bold;flex:1;">NAVIGATIONAL ANALYSIS</div>
    <div style="background:#cc7700;color:#000;padding:0 12px;height:44px;line-height:44px;font-size:0.62em;letter-spacing:2px;font-weight:bold;white-space:nowrap;">SD ${depSD}</div>
  </div>
  <div style="background:#111;padding:8px 16px 6px;border-bottom:1px solid #333;">
    <div style="color:#f90;font-size:0.56em;letter-spacing:3px;margin-bottom:3px;">DESTINATION ROUTE</div>
    <div style="color:#fff;font-size:1em;letter-spacing:1px;">${shipName.toUpperCase()} <span style="color:#f90;">▶</span> ${destination.toUpperCase()}</div>
  </div>
  <div style="display:flex;border-bottom:1px solid #222;">
    <div style="background:#9999ff;width:8px;flex-shrink:0;"></div>
    <div style="padding:8px 14px;flex:1;">
      <div style="color:#9999ff;font-size:0.54em;letter-spacing:2px;margin-bottom:2px;">DISTANCE</div>
      <div style="color:#fff;font-size:1.1em;">${distanceLY.toFixed(2)} <span style="color:#9999ff;font-size:0.65em;">LIGHT YEARS</span></div>
    </div>
  </div>
  <div style="display:flex;border-bottom:1px solid #222;">
    <div style="background:#f90;width:8px;flex-shrink:0;"></div>
    <div style="padding:8px 14px;flex:1;">
      <div style="color:#f90;font-size:0.54em;letter-spacing:2px;margin-bottom:2px;">TRAVEL TIME</div>
      <div style="color:#fff;font-size:0.95em;">${timeFullStr}</div>
    </div>
  </div>
  ${sdFooter}
  <div style="padding:8px 12px;border-bottom:1px solid #1a1a1a;">
    ${confirmBtns}
  </div>
  <div style="height:26px;display:flex;align-items:center;background:#ff9900;border-radius:0 0 0 10px;padding:0 12px;">
    <div style="color:#000;font-size:0.52em;letter-spacing:2px;flex:1;">WARP NAVIGATION SYSTEMS</div>
    <div style="background:#cc7700;color:#000;padding:0 10px;height:20px;line-height:20px;font-size:0.52em;letter-spacing:2px;border-radius:2px;">WARP NAV v2.4</div>
  </div>
</div>`;
    }

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker(),
      flags: { "sta2e-toolkit": { type: "warpCard", delta: travelTime } }
    });
  }

  // ---------------------------------------------------------------------------
  // Transporter VFX — dev / test helper
  // ---------------------------------------------------------------------------

  /**
   * Fire a native transporter VFX on all currently selected tokens.
   * Use this from the browser console to preview the effect without
   * opening the transporter dialog.
   *
   *   game.sta2eToolkit.testVFX("tngFed")          // beam-out (default)
   *   game.sta2eToolkit.testVFX("klingon", "in")   // beam-in
   *
   * Valid types: voyFed tngFed tmpFed tosFed klingon cardassian romulan ferengi borg
   *
   * @param {string}        type   Faction key
   * @param {"out"|"in"}    phase  "out" or "in"
   */
  testVFX(type = "tngFed", phase = "out") {
    TransporterVFX.test(type, phase);
  }

  // ---------------------------------------------------------------------------
  // Zone system — public API
  // ---------------------------------------------------------------------------

  /**
   * Get all zones defined on the current scene.
   * @returns {object[]}
   */
  getZones() {
    return getSceneZones();
  }

  /**
   * Get the zone containing a canvas point.
   * @param {number} x
   * @param {number} y
   * @returns {object|null}
   */
  getZoneAtPoint(x, y) {
    return _getZoneAtPoint(x, y, getSceneZones());
  }

  /**
   * Get the zone a token is currently in (based on its center position).
   * @param {Token|TokenDocument} token
   * @returns {object|null}
   */
  getZoneForToken(token) {
    const obj = token?.object ?? token;
    const center = obj?.center ?? { x: obj?.x ?? 0, y: obj?.y ?? 0 };
    return this.getZoneAtPoint(center.x, center.y);
  }

  /**
   * Calculate zone-based distance between two tokens.
   * @param {Token|TokenDocument} tokenA
   * @param {Token|TokenDocument} tokenB
   * @returns {{ zoneCount: number, rangeBand: string, momentumCost: number, fromZone: object|null, toZone: object|null, path: string[] }}
   */
  getZoneDistance(tokenA, tokenB) {
    const a = (tokenA?.object ?? tokenA);
    const b = (tokenB?.object ?? tokenB);
    const ptA = a?.center ?? { x: a?.x ?? 0, y: a?.y ?? 0 };
    const ptB = b?.center ?? { x: b?.x ?? 0, y: b?.y ?? 0 };
    return _getZoneDistance(ptA, ptB, getSceneZones());
  }
}
