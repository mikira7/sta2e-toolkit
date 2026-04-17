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
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// CampaignStore class
// ---------------------------------------------------------------------------

export class CampaignStore {

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

  /** @param {string} id */
  async setActiveCampaign(id) {
    await game.settings.set("sta2e-toolkit", "activeCampaign", id);
    game.sta2eToolkit?.broadcastHUDRender();
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
