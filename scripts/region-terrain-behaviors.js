/**
 * sta2e-toolkit | region-terrain-behaviors.js
 *
 * Three RegionBehaviorTypes that let a GM paint terrain onto a map with
 * Regions — independent of the zone grid, so they work on drawn-zone and
 * dynamic-zone scenes alike:
 *
 *   Difficult Terrain  crossing costs Momentum (Threat for NPCs)
 *   Hazard             one hazard; stack several behaviors for several hazards
 *   Sensor Shroud      an obscured area: hides tokens, raises sensor and
 *                      attack Difficulty by its potency, uncovered by Reveal
 *
 * The query side is region-terrain.js. These types only declare schema — core's
 * RegionBehaviorConfig builds each sheet from defineSchema(), so there is no
 * .hbs. None declares _createEventsField(): movement is detected by the
 * toolkit's own updateToken path (zone-movement-log.js), which already knows
 * the move's origin and whether it was a scripted waypoint.
 *
 * Registration needs the same three agreeing pieces as the Warp Viewscreen:
 * module.json documentTypes (re-read only when the world is LAUNCHED), the
 * namespaced type ids, and i18n *keys* for the labels.
 */

import { HAZARD_TYPES } from "./zone-data.js";
import {
  TERRAIN_BEHAVIOR, HAZARD_BEHAVIOR, SHROUD_BEHAVIOR, invalidateRegionFeatures, getRegionFeatures,
} from "./region-terrain.js";

const TYPES = [
  { type: TERRAIN_BEHAVIOR, icon: "fa-solid fa-mound" },
  { type: HAZARD_BEHAVIOR,  icon: "fa-solid fa-radiation" },
  { type: SHROUD_BEHAVIOR,  icon: "fa-solid fa-smog" },
];

const CATEGORY_CHOICES = Object.freeze({
  terrain:   "Hazardous Terrain — triggers when crossed using Threat",
  lingering: "Lingering — on entry, and each round for tokens inside",
  immediate: "Immediate — GM-triggered from the Zone Monitor",
});

function _hazardTypeChoices() {
  return Object.fromEntries(Object.entries(HAZARD_TYPES).map(([k, v]) => [k, v.label]));
}

// ── Data models ──────────────────────────────────────────────────────────────

const Base = foundry.data.regionBehaviors.RegionBehaviorType;

export class DifficultTerrainBehaviorType extends Base {
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.base"];

  static defineSchema() {
    const f = foundry.data.fields;
    return {
      label: new f.StringField({
        required: true, blank: true, initial: "",
        label: "Label",
        hint: "Shown on the movement card, e.g. \"Debris Field\". Blank uses the Region's name.",
      }),
      momentumCost: new f.NumberField({
        required: true, integer: true, min: 1, max: 10, initial: 1,
        label: "Momentum Cost",
        hint: "Momentum (Threat for NPCs) to enter or pass through this Region. "
          + "Charged once per Region per move; leaving costs nothing.",
      }),
    };
  }
}

export class TerrainHazardBehaviorType extends Base {
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.base"];

  static defineSchema() {
    const f = foundry.data.fields;
    return {
      hazardType: new f.StringField({
        required: true, blank: false, initial: "generic", choices: _hazardTypeChoices,
        label: "Hazard Type",
      }),
      label: new f.StringField({
        required: true, blank: true, initial: "",
        label: "Label",
        hint: "Display name. Blank uses the hazard type.",
      }),
      category: new f.StringField({
        required: true, blank: false, initial: "terrain", choices: CATEGORY_CHOICES,
        label: "Category",
      }),
      description: new f.StringField({
        required: true, blank: true, initial: "",
        label: "Description",
      }),
      momentumCost: new f.NumberField({
        required: true, integer: true, min: 1, max: 10, initial: 1,
        label: "Crossing Cost",
        hint: "Hazardous Terrain only: Momentum to cross safely. Paying with Threat "
          + "instead spends that Threat at once on damage or a trait.",
      }),
      // Written in code only, by zone-hazard.js when the GM first resolves the
      // hazard. ObjectField has no form support, so the auto-sheet skips it.
      established: new f.ObjectField({ required: true, initial: {} }),
    };
  }
}

export class SensorShroudBehaviorType extends Base {
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.base"];

  static defineSchema() {
    const f = foundry.data.fields;
    return {
      label: new f.StringField({
        required: true, blank: true, initial: "",
        label: "Label",
        hint: "e.g. \"Mutara Nebula\". Blank uses the Region's name.",
      }),
      potency: new f.NumberField({
        required: true, integer: true, min: 1, max: 5, initial: 2,
        label: "Potency",
        hint: "How thick the interference is. Added to Difficulty where enabled "
          + "below; a Reveal needs 3 + potency successes to find a vessel inside.",
      }),
      hideTokens: new f.BooleanField({
        initial: true,
        label: "Hide Tokens",
        hint: "Tokens inside are hidden from players (and assistant GMs) unless "
          + "revealed, or unless the viewer has a token inside the same shroud.",
      }),
      hideWithinShroud: new f.BooleanField({
        initial: false,
        label: "Hide From Tokens Inside",
        hint: "Hide Tokens only: tokens inside stay hidden even from a viewer whose own "
          + "token is inside the same shroud. For interference so thick that ships in it "
          + "lose each other too. A Reveal still uncovers a vessel.",
      }),
      affectSensors: new f.BooleanField({
        initial: true,
        label: "Affects Sensors",
        hint: "Adds potency to Sensor Sweep Difficulty into this area, and to the "
          + "successes a Reveal needs to find a vessel inside.",
      }),
      affectAttacks: new f.BooleanField({
        initial: true,
        label: "Affects Attacks",
        hint: "Adds potency to the Difficulty of attacks against tokens inside. "
          + "A revealed hidden vessel takes the Reveal +2 instead.",
      }),
    };
  }
}

const MODELS = {
  [TERRAIN_BEHAVIOR]: DifficultTerrainBehaviorType,
  [HAZARD_BEHAVIOR]:  TerrainHazardBehaviorType,
  [SHROUD_BEHAVIOR]:  SensorShroudBehaviorType,
};

// ── Change tracking ──────────────────────────────────────────────────────────

function _refreshVisibility() {
  if (!canvas?.ready) return;
  const zv = game.sta2eToolkit?.zoneVisibility;
  if (zv?.refresh) { zv.refresh(); return; }
  try { canvas.perception?.update({ refreshVision: true }, true); } catch { /* optional */ }
}

// Shroud visibility depends on where every token is and which the viewer has
// selected, so both re-test — but only on scenes that actually have a shroud.
function _refreshIfShrouded() {
  if (getRegionFeatures(canvas?.scene, "shroud").length) _refreshVisibility();
}

function _onRegionChange() {
  invalidateRegionFeatures();
  _refreshVisibility();
  game.sta2eToolkit?.zoneMonitor?._debouncedRefresh?.();
}

function _onBehaviorChange(behavior) {
  if (!MODELS[behavior?.type]) return;
  _onRegionChange();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRegionTerrainBehaviors() {
  for (const { type, icon } of TYPES) {
    CONFIG.RegionBehavior.dataModels[type] = MODELS[type];
    CONFIG.RegionBehavior.typeLabels[type] = `TYPES.RegionBehavior.${type}`;
    CONFIG.RegionBehavior.typeHints[type]  = `TYPES.HINTS.RegionBehavior.${type}`;
    CONFIG.RegionBehavior.typeIcons[type]  = icon;
  }

  // A type missing from game.model will never be offered — say so rather than
  // leave the Add Behavior list silently short. Wrapped: this runs in init.
  try {
    const known = getDocumentClass("RegionBehavior")?.TYPES ?? [];
    const missing = TYPES.map(t => t.type).filter(t => !known.includes(t));
    if (missing.length) {
      console.warn(
        `STA2e Toolkit | ${missing.join(", ")} not in game.model.RegionBehavior — `
        + "Region Terrain behaviors will not appear in the Add Behavior list. "
        + "Check module.json documentTypes.RegionBehavior, then fully restart the world.",
      );
    }
  } catch { /* diagnostic only */ }

  Hooks.on("createRegion", _onRegionChange);
  Hooks.on("updateRegion", _onRegionChange);
  Hooks.on("deleteRegion", _onRegionChange);
  Hooks.on("createRegionBehavior", _onBehaviorChange);
  Hooks.on("updateRegionBehavior", _onBehaviorChange);
  Hooks.on("deleteRegionBehavior", _onBehaviorChange);
  Hooks.on("canvasReady", invalidateRegionFeatures);
  Hooks.on("controlToken", _refreshIfShrouded);
  // Becoming (or ceasing to be) the active GM changes what this client may see.
  Hooks.on("updateSetting", (setting) => {
    if (setting?.key === "sta2e-toolkit.activeGmUserId") _refreshVisibility();
  });
  Hooks.on("userConnected", () => _refreshVisibility());
  Hooks.on("updateToken", (_doc, changes) => {
    if ("x" in changes || "y" in changes) _refreshIfShrouded();
  });
}
