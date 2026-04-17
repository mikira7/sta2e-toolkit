/**
 * sta2e-toolkit | date-editor.js
 * Date Editor dialog — ApplicationV2, Foundry v13 native.
 */

import { calcTNGStardate, calcTOSStardate, tngStardateToCalendar, tosStardateToCalendar, formatKlingonDateVerbose, formatRomulanDateVerbose } from "./stardate-calc.js";
import { getSceneOverride, setSceneOverride, clearSceneOverride } from "./scene-flags.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DateEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sta2e-date-editor",
    tag: "div",
    window: { title: "Stardate Editor", resizable: false },
    position: { width: 440, height: "auto" },
    actions: {
      applyDate:        DateEditor._onApply,
      toggleOverride:   DateEditor._onToggleOverride,
    }
  };

  static PARTS = {
    editor: { template: "modules/sta2e-toolkit/templates/date-editor.hbs" }
  };

  async _prepareContext(_options) {
    const store = game.sta2eToolkit.campaignStore;
    const campaign = store.getActiveCampaign();
    if (!campaign) return {};

    const sceneOverride = getSceneOverride();
    const allCampaigns = store.getCampaigns();

    let year = 2364, month = 1, day = 1;
    if (!campaign.calendarDate) {
      year = campaign.era === "tos" ? 2269
           : campaign.era === "ent" ? 2151
           : campaign.era === "klingon" ? 2372
           : campaign.era === "romulan" ? 2372
           : 2364;
    } else {
      [year, month, day] = campaign.calendarDate.split("-").map(Number);
    }

    const isKlingon = campaign.era === "klingon";
    const isRomulan = campaign.era === "romulan";
    const isFaction = isKlingon || isRomulan;

    return {
      campaign,
      year, month, day,
      hours:   campaign.time?.hours   ?? 0,
      minutes: campaign.time?.minutes ?? 0,
      isCalendarDriven: campaign.era === "tng" || campaign.era === "tos" || campaign.era === "ent" || isFaction,
      isENT:    campaign.era === "ent",
      isTNG:    campaign.era === "tng",
      isTOS:    campaign.era === "tos",
      isKlingon,
      isRomulan,
      isFaction,
      isCustom: campaign.era === "custom",
      eraYearMin: campaign.era === "tos" ? 2245 : campaign.era === "tng" ? 2323 : campaign.era === "ent" ? 2151 : isFaction ? 2300 : 2200,
      eraYearMax: campaign.era === "tos" ? 2299 : campaign.era === "tng" ? 2500 : campaign.era === "ent" ? 2161 : isFaction ? 2500 : 9999,
      sceneOverride,
      allCampaigns: allCampaigns.map(c => ({
        id: c.id, name: c.name, selected: c.id === sceneOverride
      })),
      hasScene: !!canvas?.scene
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const store = game.sta2eToolkit.campaignStore;
    const campaign = store.getActiveCampaign();

    if (campaign?.era === "tng" || campaign?.era === "tos" || campaign?.era === "ent" ||
        campaign?.era === "klingon" || campaign?.era === "romulan") {
      const calcFn    = campaign.era === "tng" ? calcTNGStardate    : calcTOSStardate;
      const reverseFn = campaign.era === "tng" ? tngStardateToCalendar : tosStardateToCalendar;
      const defaultYear = campaign.era === "tos" ? 2269 : 2364;

      const sdInput   = el.querySelector("[name=stardate-manual]");
      const yearInput = el.querySelector("[name=year]");
      const moInput   = el.querySelector("[name=month]");
      const dayInput  = el.querySelector("[name=day]");
      const hInput    = el.querySelector("[name=hours]");
      const miInput   = el.querySelector("[name=minutes]");
      const preview   = el.querySelector("#sta2e-stardate-preview");

      // ENT era: calendar only — no stardate wiring needed
      if (campaign.era !== "ent") {
        // Forward: date fields → stardate preview
        const updatePreview = () => {
          const y  = parseInt(yearInput?.value) || defaultYear;
          const mo = parseInt(moInput?.value)   || 1;
          const d  = parseInt(dayInput?.value)  || 1;
          const h  = parseInt(hInput?.value)    || 0;
          const mi = parseInt(miInput?.value)   || 0;
          const sd = calcFn(y, mo, d, h, mi);
          if (preview) preview.textContent = sd.toFixed(1);
          if (sdInput) sdInput.value = sd.toFixed(1);
        };

        // Reverse: stardate input → populate date fields
        const reverseFromStardate = () => {
          const sd = parseFloat(sdInput?.value);
          if (isNaN(sd)) return;
          const { year, month, day, hours, minutes } = reverseFn(sd);
          if (yearInput) yearInput.value = year;
          if (moInput)   moInput.value   = month;
          if (dayInput)  dayInput.value  = day;
          if (hInput)    hInput.value    = hours;
          if (miInput)   miInput.value   = minutes;
          if (preview)   preview.textContent = sd.toFixed(1);
        };

        [yearInput, moInput, dayInput, hInput, miInput].forEach(input =>
          input?.addEventListener("input", updatePreview)
        );
        sdInput?.addEventListener("input", reverseFromStardate);
        sdInput?.addEventListener("change", reverseFromStardate);
        updatePreview();
      }
    }

    // Faction eras — live preview of derived YK / AS date
    if (campaign?.era === "klingon" || campaign?.era === "romulan") {
      const yearInput  = el.querySelector("[name=year]");
      const moInput    = el.querySelector("[name=month]");
      const dayInput   = el.querySelector("[name=day]");
      const preview    = el.querySelector("#sta2e-faction-preview");

      const updateFactionPreview = () => {
        const y  = parseInt(yearInput?.value)  || 2372;
        const mo = parseInt(moInput?.value)    || 1;
        const d  = parseInt(dayInput?.value)   || 1;
        const iso = `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        if (preview) {
          preview.textContent = campaign.era === "klingon"
            ? formatKlingonDateVerbose(iso)
            : formatRomulanDateVerbose(iso);
        }
      };

      [yearInput, moInput, dayInput].forEach(input =>
        input?.addEventListener("input", updateFactionPreview)
      );
      updateFactionPreview();
    }
    el.querySelector("#sta2e-scene-campaign-select")
      ?.addEventListener("change", async (e) => {
        if (el.querySelector("#sta2e-scene-override-toggle")?.checked) {
          await setSceneOverride(e.target.value);
        }
      });
  }

  // --- Static action handlers -----------------------------------------------

  static async _onApply(event, target) {
    const el = this.element;
    const store = game.sta2eToolkit.campaignStore;
    const campaign = store.getActiveCampaign();
    if (!campaign) return;

    const get = (name) => el.querySelector(`[name=${name}]`)?.value ?? "";

    const time = {
      hours:   Math.min(23, Math.max(0, parseInt(get("hours"))   || 0)),
      minutes: Math.min(59, Math.max(0, parseInt(get("minutes")) || 0))
    };

    let updates = { time };

    if (campaign.era === "tng" || campaign.era === "tos" || campaign.era === "ent" ||
        campaign.era === "klingon" || campaign.era === "romulan") {
      const defaultYear = campaign.era === "tos" ? 2269
                        : campaign.era === "ent" ? 2151
                        : (campaign.era === "klingon" || campaign.era === "romulan") ? 2372
                        : 2364;
      const y  = parseInt(get("year"))  || defaultYear;
      const mo = parseInt(get("month")) || 1;
      const d  = parseInt(get("day"))   || 1;
      const isoDate = `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      updates.calendarDate = isoDate;
      const noStardate = campaign.era === "ent" || campaign.era === "klingon" || campaign.era === "romulan";
      if (!noStardate) {
        const calcFn = campaign.era === "tng" ? calcTNGStardate : calcTOSStardate;
        updates.stardate = calcFn(y, mo, d, time.hours, time.minutes);
      }
    } else {
      updates.stardate  = parseFloat(get("stardate"))  || campaign.stardate;
      updates.dailyRate = parseFloat(get("dailyRate")) || campaign.dailyRate;
      const cd = get("calendarDate");
      if (cd) updates.calendarDate = cd;
    }

    await store.setActiveDateTime(updates);
    this.close();
  }

  static async _onToggleOverride(event, target) {
    if (target.checked) {
      const selectedId = this.element.querySelector("#sta2e-scene-campaign-select")?.value;
      if (selectedId) await setSceneOverride(selectedId);
    } else {
      await clearSceneOverride();
    }
    this.render({ force: true });
  }
}
