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
import { readPoolRaw, setPool } from "./pool-service.js";

// How long to keep the auto-sync guard held after writing the live pools, so
// updateSetting hooks that arrive late (hosted servers, multiple clients) can't
// snapshot a half-applied tracker back into the campaign.
const POOL_SETTLE_MS = 500;

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
    savedAlliedNpcMomentum: null,
    // Redundant copy of the previous saved pools, rolled over on every change.
    // { momentum, threat, alliedNpcMomentum, ts } — restorable from the
    // Campaign Manager if a snapshot is ever lost.
    poolsBackup: null,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// CampaignStore class
// ---------------------------------------------------------------------------

export class CampaignStore {

  // Depth counter held while pools are being restored, to suppress the
  // updateSetting hook from calling syncPoolsFromTracker() mid-restore.
  // A counter rather than a boolean so overlapping restores cannot clear
  // each other's guard.
  _switchDepth = 0;

  // Serializes campaign switches so two overlapping calls run in order
  // instead of interleaving their save/restore phases.
  _switchQueue = Promise.resolve();

  // Serializes writes to the campaigns setting. Every mutation is a full
  // read-modify-write of one settings blob, so concurrent writers built from
  // stale snapshots silently clobber each other's fields — on Forge, where
  // every write is a network round-trip, that overlap is the norm.
  _writeQueue = Promise.resolve();

  // The campaign whose pools are currently loaded into the live tracker.
  // Deliberately NOT getActiveCampaign(), which resolves the current scene's
  // pin first: the scene-pin auto-switch runs from canvasReady, when
  // canvas.scene is already the *incoming* scene, so that lookup names the
  // campaign we are switching to rather than the one leaving.
  _effectiveCampaignId = null;

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

  /**
   * The campaign that owns the values currently sitting in the live tracker —
   * the only correct target for a pool save.
   *
   * Falls back to the raw activeCampaign setting rather than getActiveCampaign():
   * that setting is written only by _doSetActiveCampaign and is never influenced
   * by the current scene, so on a cold client it still names the last campaign
   * switched to. Consulting the scene pin here is what caused the incoming
   * campaign to be saved over with the outgoing campaign's pools.
   * @returns {string}
   */
  _getPoolOwnerId() {
    return this._effectiveCampaignId ?? this.getActiveCampaignId();
  }

  // --- Write ----------------------------------------------------------------

  /**
   * Serialize a mutation of the campaigns setting.
   * The mutator receives a *fresh* read taken inside the critical section, so
   * no caller can write from a snapshot taken before an earlier write landed.
   * @param {(campaigns: object[]) => object[]|null} mutator  return null to skip the write
   */
  async _mutateCampaigns(mutator) {
    const run = this._writeQueue.then(async () => {
      const next = mutator(this.getCampaigns());
      if (!next) return;
      await game.settings.set("sta2e-toolkit", "campaigns", { list: next });
      game.sta2eToolkit?.broadcastHUDRender();
    });
    this._writeQueue = run.catch(err =>
      console.error("STA2e Toolkit | campaigns write failed:", err));
    return run;
  }

  /**
   * @param {string} id
   * @param {object} [opts]
   * @param {boolean} [opts.deferRestore=false]  When true, the pool restore waits
   *   a tick so all other canvasReady hooks (including the STA system's own)
   *   finish before we write to sta.momentum / sta.threat.
   *   Use this on the canvasReady scene-pin path to avoid a race condition.
   */
  async setActiveCampaign(id, { deferRestore = false } = {}) {
    // Queue whole switches: two overlapping calls used to skip the second's
    // pre-switch save and clear each other's guard mid-restore.
    const run = this._switchQueue.then(() => this._doSetActiveCampaign(id, { deferRestore }));
    this._switchQueue = run.catch(err =>
      console.error("STA2e Toolkit | campaign switch failed:", err));
    return run;
  }

  async _doSetActiveCampaign(id, { deferRestore = false } = {}) {
    // Resolve the outgoing campaign from pool ownership, never from the scene
    // pin: on the canvasReady pin path canvas.scene is already the incoming
    // scene, so a pin lookup here names the campaign we are switching *to* and
    // this save would stamp the outgoing pools onto it.
    const previousId = this._getPoolOwnerId();

    // Explicitly save current pools before we leave — this is the primary save
    // path and is reliable regardless of whether the updateSetting hook fired.
    // force: this save must never be suppressed by the guard below.
    // Runs even when previousId === id (a re-assert): the values belong to that
    // campaign either way, and the save flushes an edit the 200ms debounce
    // hasn't landed yet before the restore below overwrites the tracker.
    if (previousId) await this.syncPoolsFromTracker(previousId, { force: true });

    // Suppress the updateSetting hook during restore so the in-progress write
    // to sta.momentum/sta.threat doesn't call syncPoolsFromTracker() again and
    // overwrite the incoming campaign's data with a mid-flight value.
    this._switchDepth++;
    try {
      await game.settings.set("sta2e-toolkit", "activeCampaign", id);
      // Let the other canvasReady hooks settle before we touch the tracker.
      if (deferRestore) await new Promise(r => setTimeout(r, 250));
      await this._silentRestorePools(id, { nullPolicy: "zero" });
      // Hold the guard while late updateSetting hooks from the restore land —
      // on a high-latency host these arrive after the awaits resolve.
      await new Promise(r => setTimeout(r, POOL_SETTLE_MS));
    } finally {
      this._switchDepth--;
    }
    game.sta2eToolkit?.broadcastHUDRender();
    // Tell other clients to drop any in-progress pool edit — otherwise a
    // focused field commits its stale value over the pools we just restored.
    game.sta2eToolkit?.poolTracker?.refresh?.({ discardEdits: true });
    try {
      game.socket?.emit("module.sta2e-toolkit", { action: "campaignSwitched" });
    } catch { /* socket unavailable — local refresh above still applies */ }
  }

  /**
   * Re-assert the active campaign's pools onto the live tracker without
   * treating it as a switch. Used on canvasReady, where a missing snapshot
   * must be left alone rather than written through as 0.
   * @param {string} id
   */
  async restoreActivePools(id) {
    this._switchDepth++;
    try {
      await this._silentRestorePools(id, { nullPolicy: "skip" });
      await new Promise(r => setTimeout(r, POOL_SETTLE_MS));
    } finally {
      this._switchDepth--;
    }
  }

  /**
   * Write a single pool to the live tracker without the auto-sync hook
   * bouncing a half-applied state back into the campaign.
   * @param {"momentum"|"threat"|"alliedNpcMomentum"} pool
   * @param {number} value
   */
  async setLivePool(pool, value) {
    this._switchDepth++;
    try {
      await CampaignStore._setPoolValue(pool, value);
      await new Promise(r => setTimeout(r, POOL_SETTLE_MS));
    } finally {
      this._switchDepth--;
    }
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

  // Entry point for the updateSetting hook. Debounced so a single roll's
  // momentum-spend + threat-add coalesce into one campaigns write instead of
  // several racing ones, and so duplicate hook storms are absorbed.
  _debouncedSync = foundry.utils.debounce(
    () => this.syncPoolsFromTracker().catch(err =>
      console.error("STA2e Toolkit | pool sync failed:", err)),
    200
  );

  // Pool write helper keeps campaign sync pointed at shared STA values.
  // Reads go through readPoolRaw() so an unready tracker can be detected
  // rather than silently read as 0.
  static async _setPoolValue(key, value) {
    await setPool(key, value, { source: "campaign", notify: false });
  }

  static _canWriteSettings() {
    return game.permissions?.SETTINGS_MODIFY?.includes(game.user.role) ?? game.user.isGM;
  }

  /**
   * Read the live pool values and save them onto the active campaign.
   * Silent — called automatically by the updateSetting hook on every pool change,
   * and explicitly by setActiveCampaign before switching.
   * @param {string|null} campaignId
   * @param {object} [opts]
   * @param {boolean} [opts.force=false]  Bypass the mid-restore guard. Only the
   *   explicit pre-switch save should use this.
   */
  async syncPoolsFromTracker(campaignId = null, { force = false } = {}) {
    // Never persist during startup — the trackers aren't populated yet.
    if (!game.ready) return;
    if (!CampaignStore._canWriteSettings()) return;
    // Skip if we're mid-restore — the restore write would trigger this hook and
    // overwrite the incoming campaign's stored values with the outgoing ones.
    if (this._switchDepth > 0 && !force) return;
    // No id means the debounced updateSetting hook: target whoever owns the
    // live pools. Resolving via the scene pin would misfile every edit made
    // after a dropdown switch on a pinned scene.
    const campaign = this.getCampaignById(campaignId ?? this._getPoolOwnerId());
    if (!campaign) return;

    const savedMomentum = readPoolRaw("momentum");
    const savedThreat   = readPoolRaw("threat");
    const savedAlliedNpcMomentum = readPoolRaw("alliedNpcMomentum");

    // An unreadable source (STA tracker not initialised yet, settings throw)
    // reads as 0 for *every* pool at once. Skipping the save is always safer
    // than writing that phantom 0 over real campaign data.
    if (savedMomentum === null || savedThreat === null || savedAlliedNpcMomentum === null) {
      console.warn("STA2e Toolkit | pool sync skipped: tracker not readable");
      return;
    }

    console.debug(`STA2e Toolkit | pool save → "${campaign.name}"`,
      { savedMomentum, savedThreat, savedAlliedNpcMomentum });
    await this.savePoolSnapshot(campaign.id, {
      savedMomentum, savedThreat, savedAlliedNpcMomentum
    });
  }

  /**
   * Write a pool snapshot onto a campaign, rolling the values it replaces into
   * poolsBackup so a bad write is always one click from recovery.
   * @param {string} id
   * @param {{savedMomentum:number, savedThreat:number, savedAlliedNpcMomentum:number}} pools
   */
  async savePoolSnapshot(id, pools) {
    await this._mutateCampaigns(list => list.map(c => {
      if (c.id !== id) return c;
      const hadValues = (c.savedMomentum !== null && c.savedMomentum !== undefined)
                     || (c.savedThreat   !== null && c.savedThreat   !== undefined);
      const changed = c.savedMomentum !== pools.savedMomentum
                   || c.savedThreat   !== pools.savedThreat
                   || c.savedAlliedNpcMomentum !== pools.savedAlliedNpcMomentum;
      const poolsBackup = (hadValues && changed)
        ? {
            momentum: c.savedMomentum,
            threat: c.savedThreat,
            alliedNpcMomentum: c.savedAlliedNpcMomentum,
            ts: Date.now(),
          }
        : (c.poolsBackup ?? null);
      return { ...c, ...pools, poolsBackup };
    }));
  }

  /**
   * Push the savedMomentum/savedThreat from the given campaign into the live
   * tracker.  Silent — called automatically by setActiveCampaign.
   * Uses the toolkit pool service, which preserves the shared STA values.
   * @param {string} id
   * @param {object} [opts]
   * @param {"zero"|"skip"} [opts.nullPolicy="zero"]  What to do with a pool the
   *   campaign has never saved. "zero" (a real switch) starts the incoming
   *   campaign clean rather than carrying over the outgoing one's pools;
   *   "skip" (a re-assert of the already-active campaign, e.g. canvasReady)
   *   leaves the live tracker alone.
   */
  async _silentRestorePools(id, { nullPolicy = "zero" } = {}) {
    const campaign = this.getCampaignById(id);
    if (!campaign) return;

    const resolve = v => (v ?? (nullPolicy === "zero" ? 0 : null));
    const momentum = resolve(campaign.savedMomentum);
    const threat   = resolve(campaign.savedThreat);
    const alliedNpcMomentum = resolve(campaign.savedAlliedNpcMomentum);

    if (momentum !== null) await CampaignStore._setPoolValue("momentum", momentum);
    if (threat   !== null) await CampaignStore._setPoolValue("threat",   threat);
    if (alliedNpcMomentum !== null) {
      await CampaignStore._setPoolValue("alliedNpcMomentum", alliedNpcMomentum);
    }

    // The tracker now holds this campaign's pools — it owns any later save.
    // Every restore path (switch, canvasReady re-assert, backup restore) lands
    // here, so this one assignment keeps ownership current for all of them.
    this._effectiveCampaignId = id;

    // Persist the resolved values so a null never lingers and can't trigger
    // another zeroing restore later.
    if (nullPolicy === "zero") {
      await this.savePoolSnapshot(id, {
        savedMomentum: momentum,
        savedThreat: threat,
        savedAlliedNpcMomentum: alliedNpcMomentum,
      });
    }
  }

  /**
   * Set one saved pool field on a campaign, journalling the values it replaces
   * so a mistyped edit is as recoverable as an automatic save.
   * @param {string} id
   * @param {"savedMomentum"|"savedThreat"|"savedAlliedNpcMomentum"} field
   * @param {number|null} value  null marks the pool as never saved
   */
  async setCampaignPoolField(id, field, value) {
    await this._mutateCampaigns(list => list.map(c => {
      if (c.id !== id) return c;
      if (c[field] === value) return c;
      return {
        ...c,
        [field]: value,
        poolsBackup: {
          momentum: c.savedMomentum ?? null,
          threat: c.savedThreat ?? null,
          alliedNpcMomentum: c.savedAlliedNpcMomentum ?? null,
          ts: Date.now(),
        },
      };
    }));
  }

  /** Restore a campaign's poolsBackup into its saved pools. */
  async restorePoolBackup(id) {
    const campaign = this.getCampaignById(id);
    const backup = campaign?.poolsBackup;
    if (!backup) return false;

    await this.savePoolSnapshot(id, {
      savedMomentum: backup.momentum ?? 0,
      savedThreat: backup.threat ?? 0,
      savedAlliedNpcMomentum: backup.alliedNpcMomentum ?? 0,
    });
    if (id === this.getActiveCampaignId()) {
      await this.restoreActivePools(id);
    }
    return true;
  }

  // --- Public pool helpers (for macros) ----------------------------------------

  /**
   * Manually snapshot the live pool values into the active campaign.
   * Shows a notification — use this from macros when you want explicit control.
   */
  async savePoolsToActiveCampaign() {
    // Report against the pool owner, which is what syncPoolsFromTracker() writes
    // to — getActiveCampaign() could name a different, scene-pinned campaign.
    const ownerId = this._getPoolOwnerId();
    if (!this.getCampaignById(ownerId)) return;
    await this.syncPoolsFromTracker();
    const c = this.getCampaignById(ownerId); // re-fetch after save
    ui.notifications.info(
      `STA2e Toolkit: Saved pools for "${c.name}" - Momentum ${c.savedMomentum ?? 0}, Threat ${c.savedThreat ?? 0}, Allied NPC Momentum ${c.savedAlliedNpcMomentum ?? 0}.`
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

    const { savedMomentum, savedThreat, savedAlliedNpcMomentum } = campaign;
    if (savedMomentum === null && savedThreat === null && savedAlliedNpcMomentum === null) {
      ui.notifications.warn(`STA2e Toolkit: No saved pools found for "${campaign.name}".`);
      return;
    }
    await this.restoreActivePools(id);
    ui.notifications.info(
      `STA2e Toolkit: Restored pools for "${campaign.name}" - Momentum ${savedMomentum ?? "-"}, Threat ${savedThreat ?? "-"}, Allied NPC Momentum ${savedAlliedNpcMomentum ?? "-"}.`
    );
  }

  /**
   * Add a new campaign.
   * @param {object} data  partial campaign object (name, era, stardate, etc.)
   * @returns {object} the created campaign
   */
  async addCampaign(data = {}) {
    const campaign = defaultCampaign(data);
    let count = 0;
    await this._mutateCampaigns(list => {
      const next = [...list, campaign];
      count = next.length;
      return next;
    });

    // Auto-select if this is the first campaign
    if (count === 1) {
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
    await this._mutateCampaigns(list =>
      list.map(c => (c.id === id ? { ...c, ...updates } : c))
    );
  }

  /**
   * Delete a campaign by id.
   * If it was the active campaign, switches to the first remaining one.
   * @param {string} id
   */
  async deleteCampaign(id) {
    let remaining = [];
    await this._mutateCampaigns(list => {
      remaining = list.filter(c => c.id !== id);
      return remaining;
    });

    if (this.getActiveCampaignId() === id) {
      await this.setActiveCampaign(remaining[0]?.id ?? "");
    }
  }

  /**
   * Reorder campaigns (drag-and-drop in Campaign Manager).
   * @param {string[]} orderedIds  campaign ids in desired order
   */
  async reorderCampaigns(orderedIds) {
    await this._mutateCampaigns(list => {
      const map = Object.fromEntries(list.map(c => [c.id, c]));
      const ordered = orderedIds.map(id => map[id]).filter(Boolean);
      // Don't drop campaigns created while the drag was in flight.
      const missing = list.filter(c => !orderedIds.includes(c.id));
      return [...ordered, ...missing];
    });
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
    const id = this.getActiveCampaign()?.id;
    if (!id) return;
    // De-dupe: drop any earlier entry with the same pair of actor ids + task name
    const key = `${snapshot.responderActorId ?? ""}|${snapshot.initiatorActorId ?? ""}|${snapshot.taskName ?? ""}`;
    // The list is rebuilt inside the queue so this can't revive a stale copy of
    // the campaign's other fields (pools especially) over a concurrent write.
    await this._mutateCampaigns(list => list.map(c => {
      if (c.id !== id) return c;
      const filtered = (Array.isArray(c.recentOpposed) ? c.recentOpposed : []).filter(s =>
        `${s.responderActorId ?? ""}|${s.initiatorActorId ?? ""}|${s.taskName ?? ""}` !== key);
      filtered.unshift({ ...snapshot, ts: Date.now() });
      if (filtered.length > CampaignStore.RECENT_OPPOSED_MAX)
        filtered.length = CampaignStore.RECENT_OPPOSED_MAX;
      return { ...c, recentOpposed: filtered };
    }));
  }

  /** Remove all recent opposed-task entries from the active campaign. */
  async clearRecentOpposedTasks() {
    const id = this.getActiveCampaign()?.id;
    if (!id) return;
    await this._mutateCampaigns(list =>
      list.map(c => (c.id === id ? { ...c, recentOpposed: [] } : c))
    );
  }
}
