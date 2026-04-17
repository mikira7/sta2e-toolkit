/**
 * sta2e-toolkit | campaign-manager.js
 * Campaign Manager dialog — ApplicationV2, Foundry v13 native.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CampaignManager extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sta2e-campaign-manager",
    tag: "div",
    window: { title: "Campaign Manager", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      addCampaign:    CampaignManager._onAddCampaign,
      deleteCampaign: CampaignManager._onDeleteCampaign,
    }
  };

  static PARTS = {
    manager: { template: "modules/sta2e-toolkit/templates/campaign-manager.hbs" }
  };

  async _prepareContext(_options) {
    const store = game.sta2eToolkit.campaignStore;
    return {
      campaigns: store.getCampaigns().map(c => ({
        ...c,
        eraLabel: { tng: "TNG/DS9/VOY", tos: "TOS/TMP", ent: "ENT Era", custom: "Custom" }[c.era] ?? "TNG",
        isCustom: c.era === "custom",
        isENT: c.era === "ent"
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
        const update = { era: newEra };
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

    // Drag-to-reorder
    this._activateDragSort(el);
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
}
