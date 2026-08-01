/**
 * sta2e-toolkit | campaign-manager.js
 * Campaign Manager dialog — ApplicationV2, Foundry v13 native.
 */

import { themeForEra } from "./lcars-theme.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CampaignManager extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sta2e-campaign-manager",
    tag: "div",
    window: { title: "Campaign Manager", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      addCampaign:       CampaignManager._onAddCampaign,
      deleteCampaign:    CampaignManager._onDeleteCampaign,
      restorePoolBackup: CampaignManager._onRestorePoolBackup,
    }
  };

  static PARTS = {
    manager: { template: "modules/sta2e-toolkit/templates/campaign-manager.hbs" }
  };

  /** Pool fields render "" (showing the — placeholder) when never saved, so a
   *  missing snapshot is visibly different from a genuine 0. */
  static _poolDisplay(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  async _prepareContext(_options) {
    const store = game.sta2eToolkit.campaignStore;
    const activeId = store.getActiveCampaignId();
    return {
      campaigns: store.getCampaigns().map(c => ({
        ...c,
        eraLabel: { tng: "TNG/DS9/VOY", tos: "TOS/TMP", ent: "ENT Era", klingon: "Klingon", romulan: "Romulan", custom: "Custom" }[c.era] ?? "TNG",
        isCustom: c.era === "custom",
        isENT: c.era === "ent",
        isActive: c.id === activeId,
        momentumDisplay: CampaignManager._poolDisplay(c.savedMomentum),
        threatDisplay:   CampaignManager._poolDisplay(c.savedThreat),
        alliedDisplay:   CampaignManager._poolDisplay(c.savedAlliedNpcMomentum),
        hasBackup: !!c.poolsBackup,
      }))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const store = game.sta2eToolkit.campaignStore;

    // Inline name edits
    el.querySelectorAll("[data-campaign-name]").forEach(input => {
      input.addEventListener("change", async (e) => {
        await store.updateCampaign(e.target.dataset.campaignName, { name: e.target.value });
      });
    });

    // Inline era changes — re-render so rate field shows/hides
    el.querySelectorAll("[data-campaign-era]").forEach(select => {
      select.addEventListener("change", async (e) => {
        const newEra = e.target.value;
        const id     = e.target.dataset.campaignEra;
        const update = { era: newEra, theme: themeForEra(newEra) };
        // Seed sensible defaults when switching to ENT — calendar only, no stardate
        if (newEra === "ent") {
          const existing = game.sta2eToolkit.campaignStore.getCampaignById(id);
          if (!existing?.calendarDate || existing.calendarDate.startsWith("236") || existing.calendarDate.startsWith("221")) {
            update.calendarDate = "2152-01-01";
          }
          update.stardate = null;
        }
        await store.updateCampaign(id, update);
        this.render({ force: true });
      });
    });

    // Inline theme changes — saves immediately and re-renders HUD
    el.querySelectorAll("[data-campaign-theme]").forEach(select => {
      select.addEventListener("change", async (e) => {
        await store.updateCampaign(e.target.dataset.campaignTheme, { theme: e.target.value });
      });
    });

    // Inline stardate edits
    el.querySelectorAll("[data-campaign-startdate]").forEach(input => {
      const save = async (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
          await store.updateCampaign(e.target.dataset.campaignStartdate, { stardate: val });
        }
      };
      input.addEventListener("change", save);
      input.addEventListener("blur", save);
    });

    // Inline daily rate edits (custom era only)
    el.querySelectorAll("[data-campaign-rate]").forEach(input => {
      input.addEventListener("change", async (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
          await store.updateCampaign(e.target.dataset.campaignRate, { dailyRate: val });
        }
      });
    });

    // Inline pool edits — saved Momentum / Threat / Allied NPC Momentum.
    // Blank commits null ("never saved"); a number commits that value, and
    // pushes it to the live tracker when this is the active campaign.
    el.querySelectorAll("[data-campaign-pool]").forEach(input => {
      input.addEventListener("change", async (e) => {
        const id   = e.target.dataset.campaignPool;
        const pool = e.target.dataset.pool;
        const raw  = e.target.value.trim();
        const val  = raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
        const field = {
          momentum: "savedMomentum",
          threat: "savedThreat",
          alliedNpcMomentum: "savedAlliedNpcMomentum",
        }[pool];
        if (!field) return;

        await store.setCampaignPoolField(id, field, val);
        if (val !== null && id === store.getActiveCampaignId()) {
          await store.setLivePool(pool, val);
        }
        this.render({ force: true });
      });
    });

    // Keep the dialog in step with pool changes made from the tracker.
    if (!this._campaignsHook) {
      this._campaignsHook = Hooks.on("updateSetting", (setting) => {
        if (setting.key === "sta2e-toolkit.campaigns") this.render();
      });
    }

    // Drag-to-reorder
    this._activateDragSort(el);
  }

  _onClose(options) {
    if (this._campaignsHook) {
      Hooks.off("updateSetting", this._campaignsHook);
      this._campaignsHook = null;
    }
    return super._onClose(options);
  }

  _activateDragSort(el) {
    const list = el.querySelector("#sta2e-campaign-list");
    if (!list) return;

    let dragged = null;

    list.addEventListener("dragstart", (e) => {
      dragged = e.target.closest("[data-campaign-id]");
      if (dragged) {
        dragged.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      }
    });

    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      const target = e.target.closest("[data-campaign-id]");
      if (target && target !== dragged) {
        const rect = target.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        list.insertBefore(dragged, after ? target.nextSibling : target);
      }
    });

    list.addEventListener("dragend", async () => {
      if (dragged) dragged.classList.remove("dragging");
      dragged = null;
      const orderedIds = [...list.querySelectorAll("[data-campaign-id]")]
        .map(el => el.dataset.campaignId);
      await game.sta2eToolkit.campaignStore.reorderCampaigns(orderedIds);
    });
  }

  // --- Static action handlers -----------------------------------------------

  static async _onAddCampaign() {
    await game.sta2eToolkit.campaignStore.addCampaign({
      name: "New Campaign",
      era: "tng",
      stardate: 41000.0,
      calendarDate: "2364-01-01",
      time: { hours: 0, minutes: 0 }
    });
    this.render({ force: true });
  }

  static async _onDeleteCampaign(event, target) {
    const id = target.dataset.deleteCampaign;
    const store = game.sta2eToolkit.campaignStore;
    const campaign = store.getCampaignById(id);

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Campaign" },
      content: `<p>Delete <strong>${campaign?.name ?? "this campaign"}</strong>? This cannot be undone.</p>`
    });

    if (confirmed) {
      await store.deleteCampaign(id);
      this.render({ force: true });
    }
  }

  static async _onRestorePoolBackup(event, target) {
    const id = target.dataset.restorePools;
    const store = game.sta2eToolkit.campaignStore;
    const backup = store.getCampaignById(id)?.poolsBackup;
    if (!backup) return;

    const restored = await store.restorePoolBackup(id);
    if (restored) {
      ui.notifications.info(
        `STA2e Toolkit: Restored previous pools - Momentum ${backup.momentum ?? "-"}, Threat ${backup.threat ?? "-"}.`
      );
    }
    this.render({ force: true });
  }
}
