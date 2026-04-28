/**
 * sta2e-toolkit | campaign-store.js
 * Single source of truth for campaign data.
 * All reads/writes to world flags go through here.
 * Exposes a clean API consumed by the HUD, dialogs, and game.sta2eToolkit.
 */

import {
  calcTNGStardate,
  calcTOSStardate,
  tosStardateToCalendar,
  tngStardateToCalendar,
  advanceCustomStardate,
  advanceCalendarTime,
} from "./stardate-calc.js";

// ---------------------------------------------------------------------------
// Default campaign template
// ---------------------------------------------------------------------------

function defaultCampaign(overrides = {}) {
  return {
    id: foundry.utils.randomID(),
    name: game.i18n?.localize("STA2E.Campaign.DefaultName") ?? "New Campaign",
    era: "tng",             // "tng" | "tos" | "ent" | "klingon" | "romulan" | "custom"
    theme: "lcars-tng",     // HUD visual theme for this campaign
    stardate: 41000.0,
    calendarDate: "2364-01-01",
    time: { hours: 0, minutes: 0 },
    dailyRate: 1.0,         // used by "custom" era only
    savedMomentum: null,    // saved pool value (null = never saved)
    savedThreat: null,      // saved pool value (null = never saved)
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// CampaignStore class
// ---------------------------------------------------------------------------

export class CampaignStore {

  // Flag set during setActiveCampaign to suppress the updateSetting hook
  // from calling syncPoolsFromTracker() while we are mid-restore.
  _isSwitchingCampaign = false;

  // --- Read -----------------------------------------------------------------

  /** @returns {object[]} all campaigns */
  getCampaigns() {
    const stored = game.settings.get("sta2e-toolkit", "campaigns");
    return stored?.list ?? [];
  }

  /** @returns {string} active campaign id */
  getActiveCampaignId() {
    return game.settings.get("sta2e-toolkit", "activeCampaign") ?? "";
  }

  /**
   * Get the effective active campaign, respecting scene overrides.
   * @returns {object|null}
   */
  getActiveCampaign() {
    // Check for scene-level override first
    const sceneOverride = canvas?.scene?.getFlag("sta2e-toolkit", "campaignOverride");
    const id = sceneOverride || this.getActiveCampaignId();
    return this.getCampaignById(id);
  }

  /** @returns {object|null} */
  getCampaignById(id) {
    return this.getCampaigns().find(c => c.id === id) ?? null;
  }

  // --- Write ----------------------------------------------------------------

  /** Save the full campaigns array. Triggers HUD re-render via settings onChange. */
  async _saveCampaigns(campaigns) {
    await game.settings.set("sta2e-toolkit", "campaigns", { list: campaigns });
    game.sta2eToolkit?.broadcastHUDRender();
  }

  /**
   * @param {string} id
   * @param {object} [opts]
   * @param {boolean} [opts.deferRestore=false]  When true, the pool restore is
   *   scheduled via setTimeout so all other canvasReady hooks (including the STA
   *   system's own) finish before we write to sta.momentum / sta.threat.
   *   Use this on the canvasReady scene-pin path to avoid a race condition.
   */
  async setActiveCampaign(id, { deferRestore = false } = {}) {
    const previousId = this.getActiveCampaignId();
    // Explicitly save current pools before we leave — this is the primary save
    // path and is reliable regardless of whether the updateSetting hook fired.
    await this.syncPoolsFromTracker(previousId);

    // Suppress the updateSetting hook during restore so the in-progress write
    // to sta.momentum/sta.threat doesn't call syncPoolsFromTracker() again and
    // overwrite the incoming campaign's data with a mid-flight value.
    this._isSwitchingCampaign = true;
    try {
      await game.settings.set("sta2e-toolkit", "activeCampaign", id);
      if (!deferRestore) {
        await this._silentRestorePools(id);
        this._isSwitchingCampaign = false;
      } else {
        // Release the flag immediately so normal pool-change hooks resume,
        // then restore after a short delay once all scene hooks have settled.
        this._isSwitchingCampaign = false;
        setTimeout(() => this._silentRestorePools(id), 250);
      }
    } catch (err) {
      this._isSwitchingCampaign = false;
      throw err;
    }
    game.sta2eToolkit?.broadcastHUDRender();
  }

  // --- Pool auto-sync ----------------------------------------------------------
  // Momentum and Threat are stored per campaign and kept in sync automatically:
  //   • syncPoolsFromTracker() — called by the updateSetting hook whenever
  //     sta.momentum or sta.threat changes; silently writes the new values into
  //     the active campaign so they survive a campaign switch.
  //   • _silentRestorePools(id) — called by setActiveCampaign; pushes the
  //     stored values back into the live tracker when a campaign becomes active.
  //
  // The public savePools() / restorePools(id) below are still available for
  // macros that want explicit control with user-facing notifications.

  // Pool read/write helpers — mirrors the pattern in zone-movement-log.js so
  // both the STATracker API and the raw settings fallback work on The Forge.
  static _getPoolValue(key) {
    const T = game.STATracker?.constructor ?? null;
    if (T) return T.ValueOf(key) ?? 0;
    try { return game.settings.get("sta", key) ?? 0; } catch { return 0; }
  }
  static async _setPoolValue(key, value) {
    const T = game.STATracker?.constructor ?? null;
    if (T) { await T.DoUpdateResource(key, Math.max(0, value)); return; }
    try { await game.settings.set("sta", key, Math.max(0, value)); } catch { /* ignore */ }
  }

  static _canWriteSettings() {
    return game.permissions?.SETTINGS_MODIFY?.includes(game.user.role) ?? game.user.isGM;
  }

  /**
   * Read the live pool values and save them onto the active campaign.
   * Silent — called automatically by the updateSetting hook on every pool change,
   * and explicitly by setActiveCampaign before switching.
   */
  async syncPoolsFromTracker(campaignId = null) {
    if (!CampaignStore._canWriteSettings()) return;
    // Skip if we're mid-switch — the restore write would trigger this hook and
    // overwrite the incoming campaign's stored values with the outgoing ones.
    if (this._isSwitchingCampaign) return;
    const campaign = campaignId ? this.getCampaignById(campaignId) : this.getActiveCampaign();
    if (!campaign) return;

    const savedMomentum = CampaignStore._getPoolValue("momentum");
    const savedThreat   = CampaignStore._getPoolValue("threat");
    await this.updateCampaign(campaign.id, { savedMomentum, savedThreat });
  }

  /**
   * Push the savedMomentum/savedThreat from the given campaign into the live
   * tracker.  Silent — called automatically by setActiveCampaign.
   * Null values (campaign never played) default to 0 so the tracker always
   * reflects the incoming campaign rather than carrying over stale pool values.
   * Falls back to direct game.settings.set if STATracker is unavailable (Forge).
   * @param {string} id
   */
  async _silentRestorePools(id) {
    const campaign = this.getCampaignById(id);
    if (!campaign) return;

    // Default null → 0 so every campaign switch sets the tracker, even for
    // campaigns that have never had pools explicitly saved.
    const momentum = campaign.savedMomentum ?? 0;
    const threat   = campaign.savedThreat   ?? 0;

    await CampaignStore._setPoolValue("momentum", momentum);
    await CampaignStore._setPoolValue("threat",   threat);
  }

  // --- Public pool helpers (for macros) ----------------------------------------

  /**
   * Manually snapshot the live pool values into the active campaign.
   * Shows a notification — use this from macros when you want explicit control.
   */
  async savePoolsToActiveCampaign() {
    const campaign = this.getActiveCampaign();
    if (!campaign) return;
    await this.syncPoolsFromTracker();
    const c = this.getActiveCampaign(); // re-fetch after save
    ui.notifications.info(
      `STA2e Toolkit: Saved pools for "${c.name}" — Momentum ${c.savedMomentum ?? 0}, Threat ${c.savedThreat ?? 0}.`
    );
  }

  /**
   * Manually restore a campaign's saved pool values into the live tracker.
   * Shows a notification — use this from macros when you want explicit control.
   * @param {string} id  Campaign id whose saved values should be restored.
   */
  async restorePoolsFromCampaign(id) {
    const campaign = this.getCampaignById(id);
    if (!campaign) return;

    const Tracker = game.STATracker?.constructor;
    if (!Tracker) {
      ui.notifications.warn("STA2e Toolkit: STATracker not available — pool values not restored.");
      return;
    }
    const { savedMomentum, savedThreat } = campaign;
    if (savedMomentum === null && savedThreat === null) {
      ui.notifications.warn(`STA2e Toolkit: No saved pools found for "${campaign.name}".`);
      return;
    }
    await this._silentRestorePools(id);
    ui.notifications.info(
      `STA2e Toolkit: Restored pools for "${campaign.name}" — Momentum ${savedMomentum ?? "—"}, Threat ${savedThreat ?? "—"}.`
    );
  }

  /**
   * Add a new campaign.
   * @param {object} data  partial campaign object (name, era, stardate, etc.)
   * @returns {object} the created campaign
   */
  async addCampaign(data = {}) {
    const campaign = defaultCampaign(data);
    const campaigns = [...this.getCampaigns(), campaign];
    await this._saveCampaigns(campaigns);

    // Auto-select if this is the first campaign
    if (campaigns.length === 1) {
      await this.setActiveCampaign(campaign.id);
    }
    return campaign;
  }

  /**
   * Update fields on an existing campaign.
   * @param {string} id
   * @param {object} updates  partial campaign fields
   */
  async updateCampaign(id, updates) {
    const campaigns = this.getCampaigns().map(c =>
      c.id === id ? { ...c, ...updates } : c
    );
    await this._saveCampaigns(campaigns);
  }

  /**
   * Delete a campaign by id.
   * If it was the active campaign, switches to the first remaining one.
   * @param {string} id
   */
  async deleteCampaign(id) {
    const campaigns = this.getCampaigns().filter(c => c.id !== id);
    await this._saveCampaigns(campaigns);

    if (this.getActiveCampaignId() === id) {
      await this.setActiveCampaign(campaigns[0]?.id ?? "");
    }
  }

  /**
   * Reorder campaigns (drag-and-drop in Campaign Manager).
   * @param {string[]} orderedIds  campaign ids in desired order
   */
  async reorderCampaigns(orderedIds) {
    const map = Object.fromEntries(this.getCampaigns().map(c => [c.id, c]));
    const campaigns = orderedIds.map(id => map[id]).filter(Boolean);
    await this._saveCampaigns(campaigns);
  }

  // --- Time Advancement -----------------------------------------------------

  /**
   * Advance the active campaign by a duration.
   * Handles TNG (recalculates stardate from calendar) and TOS/custom (advances at daily rate).
   * @param {{ days?: number, hours?: number, minutes?: number }} delta  can be negative
   */
  async advanceByDuration(delta) {
    const campaign = this.getActiveCampaign();
    if (!campaign) return;

    // Advance calendar time + handle rollover
    const { calendarDate, time } = advanceCalendarTime(
      campaign.calendarDate,
      campaign.time,
      delta
    );

    let stardate = campaign.stardate;

    if (campaign.era === "tng" || campaign.era === "tos") {      // Calendar-driven eras — if calendarDate is missing, reverse the stardate to get one
      let effectiveDate = calendarDate;
      if (!effectiveDate && campaign.stardate != null) {
        const reversed = campaign.era === "tng"
          ? tngStardateToCalendar(campaign.stardate)
          : tosStardateToCalendar(campaign.stardate);
        // reversed is { year, month, day } — build ISO string and re-advance
        const isoBase = `${reversed.year}-${String(reversed.month).padStart(2,"0")}-${String(reversed.day).padStart(2,"0")}`;
        const readvanced = advanceCalendarTime(isoBase, campaign.time ?? { hours: 0, minutes: 0 }, delta);
        effectiveDate = readvanced.calendarDate;
      }
      if (effectiveDate) {
        const [y, m, d] = effectiveDate.split("-").map(Number);
        stardate = campaign.era === "tng"
          ? calcTNGStardate(y, m, d, time.hours, time.minutes)
          : calcTOSStardate(y, m, d, time.hours, time.minutes);
      }
    } else if (campaign.era === "ent" || campaign.era === "klingon" || campaign.era === "romulan") {
      // Faction/ENT eras — Earth calendar tracking only, no Federation stardates
      stardate = null;
    } else {
      // Custom: advance at manual daily rate
      const totalDays = (delta.days ?? 0) + (delta.hours ?? 0) / 24 + (delta.minutes ?? 0) / (24 * 60);
      stardate = advanceCustomStardate(campaign.stardate, totalDays, 0, 0, campaign.dailyRate);
    }

    await this.updateCampaign(campaign.id, { stardate, calendarDate, time });
  }

  /**
   * Directly set the stardate, calendar date, and time for the active campaign.
   * Used by the Date Editor dialog.
   * @param {{ stardate?, calendarDate?, time? }} data
   */
  async setActiveDateTime(data) {
    const campaign = this.getActiveCampaign();
    if (!campaign) return;
    await this.updateCampaign(campaign.id, data);
  }

  // ── Recent Opposed Tasks ─────────────────────────────────────────────────
  // Ring buffer of recent opposed-task configs stored on the active campaign,
  // so the setup dialog can offer "Reuse last" and a "Recent ▾" picker.
  // Max length is capped to keep the world settings payload small.

  static RECENT_OPPOSED_MAX = 10;

  /** @returns {object[]} most-recent-first list of opposed-task snapshots */
  getRecentOpposedTasks() {
    const campaign = this.getActiveCampaign();
    return Array.isArray(campaign?.recentOpposed) ? campaign.recentOpposed : [];
  }

  /**
   * Push an opposed-task snapshot onto the active campaign's ring buffer.
   * @param {object} snapshot - { taskName, flavor, kind, suggestedAttr, suggestedDisc,
   *   difficultyBase, responderActorId, initiatorActorId, options, ts }
   */
  async pushRecentOpposedTask(snapshot) {
    const campaign = this.getActiveCampaign();
    if (!campaign) return;
    const list = Array.isArray(campaign.recentOpposed) ? [...campaign.recentOpposed] : [];
    // De-dupe: drop any earlier entry with the same pair of actor ids + task name
    const key = `${snapshot.responderActorId ?? ""}|${snapshot.initiatorActorId ?? ""}|${snapshot.taskName ?? ""}`;
    const filtered = list.filter(s =>
      `${s.responderActorId ?? ""}|${s.initiatorActorId ?? ""}|${s.taskName ?? ""}` !== key);
    filtered.unshift({ ...snapshot, ts: Date.now() });
    if (filtered.length > CampaignStore.RECENT_OPPOSED_MAX)
      filtered.length = CampaignStore.RECENT_OPPOSED_MAX;
    await this.updateCampaign(campaign.id, { recentOpposed: filtered });
  }

  /** Remove all recent opposed-task entries from the active campaign. */
  async clearRecentOpposedTasks() {
    const campaign = this.getActiveCampaign();
    if (!campaign) return;
    await this.updateCampaign(campaign.id, { recentOpposed: [] });
  }
}
