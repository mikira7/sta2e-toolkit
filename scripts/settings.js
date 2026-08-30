/**
 * sta2e-toolkit | settings.js
 */

import { EffectConfigMenu } from "./effect-config.js";
import {
  TRACTOR_BEAM_CLIENT_SETTING,
  TRACTOR_BEAM_RENDERER_SETTING,
  TRACTOR_BEAM_WORLD_SETTING,
} from "./tractor-beam-vfx.js";
import {
  DEFAULT_BEAM_VFX_SETTINGS,
  GROUND_PHASER_ERA_ROWS,
  GROUND_PHASER_TYPE_ROWS,
  NATIVE_WEAPON_VFX_DEFAULT_MODES,
} from "./native-weapon-vfx.js";
import { resyncAllHullDecals, refreshAllHullDecals } from "./hull-decals.js";
import { refreshAllTokenElevationTooltips } from "./token-elevation-display.js";
import { refreshAllTokenSelectGlow } from "./token-select-glow.js";
import { WildcardNamerConfig } from "./wildcard-namer.js";
import { CharacterCreatorConfig, CHARACTER_CREATOR_DEFAULT_DATA } from "./character-creator.js";
import {
  STAR_SYSTEM_IMAGE_SETTING,
  StarSystemImagesConfig,
  normalizeStarSystemImageData,
} from "./star-system-images.js";
import { SFX_SETTING, SfxBoardConfig } from "./sfx-board.js";
import { environmentSoundKeys } from "./viewscreen-environments.js";
import { VIEWSCREEN_PRESET_SETTING } from "./viewscreen-presets.js";

export function registerSettings() {

  // ── Wildcard Token Namer config menu button ────────────────────────────
  game.settings.registerMenu("sta2e-toolkit", "wildcardNamerMenu", {
    name:       "STA2E.Settings.WildcardNamer.Name",
    label:      "STA2E.Settings.WildcardNamer.Label",
    hint:       "STA2E.Settings.WildcardNamer.Hint",
    icon:       "fas fa-dice",
    type:       WildcardNamerConfig,
    restricted: true,
  });

  // Internal — wildcard namer rules: { rules: [{ trait, tableSource, packId, tableName }] }
  game.settings.register("sta2e-toolkit", "wildcardNamerRules", {
    name:    "Wildcard Namer Rules",
    scope:   "world",
    config:  false,
    type:    Object,
    default: { rules: [] },
  });

  game.settings.registerMenu("sta2e-toolkit", "characterCreatorMenu", {
    name:       "STA2E.Settings.CharacterCreator.Name",
    label:      "STA2E.Settings.CharacterCreator.Label",
    hint:       "STA2E.Settings.CharacterCreator.Hint",
    icon:       "fas fa-user-astronaut",
    type:       CharacterCreatorConfig,
    restricted: true,
  });

  game.settings.register("sta2e-toolkit", "characterCreatorData", {
    name:    "Character Creator Data",
    scope:   "world",
    config:  false,
    type:    Object,
    default: CHARACTER_CREATOR_DEFAULT_DATA,
  });

  game.settings.registerMenu("sta2e-toolkit", "starSystemImagesMenu", {
    name:       "Star System Images",
    label:      "Configure Images",
    hint:       "Configure image pools used by generated Star System sheets, tokens, and prompts.",
    icon:       "fas fa-image",
    type:       StarSystemImagesConfig,
    restricted: true,
  });

  game.settings.register("sta2e-toolkit", STAR_SYSTEM_IMAGE_SETTING, {
    name:    "Star System Image Data",
    scope:   "world",
    config:  false,
    type:    Object,
    default: normalizeStarSystemImageData(),
  });

  // ── Audio SFX Board ─────────────────────────────────────────────────────
  game.settings.registerMenu("sta2e-toolkit", "sfxBoardMenu", {
    name:       "STA2E.Settings.SfxBoard.Name",
    label:      "STA2E.Settings.SfxBoard.Label",
    hint:       "STA2E.Settings.SfxBoard.Hint",
    icon:       "fas fa-volume-high",
    type:       SfxBoardConfig,
    restricted: true,
  });

  // Internal — SFX entries: { entries: [{ id, label, path, volume, players }] }
  game.settings.register("sta2e-toolkit", SFX_SETTING, {
    name:    "Audio SFX Entries",
    scope:   "world",
    config:  false,
    type:    Object,
    default: { entries: [] },
  });

  game.settings.register("sta2e-toolkit", "sfxWidgetEnabled", {
    name:     "STA2E.Settings.SfxWidgetEnabled.Name",
    hint:     "STA2E.Settings.SfxWidgetEnabled.Hint",
    scope:    "client",
    config:   true,
    type:     Boolean,
    default:  true,
    onChange: () => game.sta2eToolkit?.sfxWidget?.refresh?.(),
  });

  // Internal — per-user button arrangement for the SFX widget.
  game.settings.register("sta2e-toolkit", "sfxWidgetLayout", {
    name:    "SFX Widget Layout",
    scope:   "client",
    config:  false,
    type:    Object,
    default: { order: [], hidden: [], columns: 2 },
  });

  // ── Round-robin initiative ────────────────────────────────────────────────
  // The `sta` system's popcorn tracker lets the GM activate any combatant. These
  // settings layer STA 2e's side alternation, per-turn action economy and the
  // turn-order spends on top of it. See combat/initiative-order.js.

  game.settings.register("sta2e-toolkit", "initiativeRoundRobin", {
    name:     "STA2E.Settings.InitiativeRoundRobin.Name",
    hint:     "STA2E.Settings.InitiativeRoundRobin.Hint",
    scope:    "world",
    config:   true,
    type:     Boolean,
    default:  true,
    onChange: () => { try { ui.combat?.render(); } catch {} },
  });

  game.settings.register("sta2e-toolkit", "initiativeShipStandby", {
    name:     "STA2E.Settings.InitiativeShipStandby.Name",
    hint:     "STA2E.Settings.InitiativeShipStandby.Hint",
    scope:    "world",
    config:   true,
    type:     Boolean,
    default:  true,
    onChange: () => { try { ui.combat?.render(); } catch {} },
  });

  game.settings.register("sta2e-toolkit", "initiativeShipTurnMarker", {
    name:    "STA2E.Settings.InitiativeShipTurnMarker.Name",
    hint:    "STA2E.Settings.InitiativeShipTurnMarker.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "initiativeTurnMarkerFit", {
    name:     "STA2E.Settings.InitiativeTurnMarkerFit.Name",
    hint:     "STA2E.Settings.InitiativeTurnMarkerFit.Hint",
    scope:    "world",
    config:   true,
    type:     Boolean,
    default:  true,
    onChange: () => game.sta2eToolkit?.refreshTurnMarkerSizes?.(),
  });

  game.settings.register("sta2e-toolkit", "initiativeTurnMarkerScale", {
    name:     "STA2E.Settings.InitiativeTurnMarkerScale.Name",
    hint:     "STA2E.Settings.InitiativeTurnMarkerScale.Hint",
    scope:    "world",
    config:   true,
    type:     Number,
    range:    { min: 0.25, max: 3, step: 0.05 },
    default:  1,
    onChange: () => game.sta2eToolkit?.refreshTurnMarkerSizes?.(),
  });

  game.settings.register("sta2e-toolkit", "initiativePlayerSpends", {
    name:     "STA2E.Settings.InitiativePlayerSpends.Name",
    hint:     "STA2E.Settings.InitiativePlayerSpends.Hint",
    scope:    "world",
    config:   true,
    type:     Boolean,
    default:  true,
    onChange: () => { try { ui.combat?.render(); } catch {} },
  });

  game.settings.register("sta2e-toolkit", "initiativePlayerThreatPayment", {
    name:     "STA2E.Settings.InitiativePlayerThreatPayment.Name",
    hint:     "STA2E.Settings.InitiativePlayerThreatPayment.Hint",
    scope:    "world",
    config:   true,
    type:     Boolean,
    default:  true,
  });

  game.settings.register("sta2e-toolkit", "initiativeAutoTrackActions", {
    name:    "STA2E.Settings.InitiativeAutoTrackActions.Name",
    hint:    "STA2E.Settings.InitiativeAutoTrackActions.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "initiativeApplyExtraMajorDifficulty", {
    name:    "STA2E.Settings.InitiativeApplyExtraMajorDifficulty.Name",
    hint:    "STA2E.Settings.InitiativeApplyExtraMajorDifficulty.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  const _initiativeCost = (key, label, hint, def) => {
    game.settings.register("sta2e-toolkit", key, {
      name:    label,
      hint,
      scope:   "world",
      config:  true,
      type:    Number,
      range:   { min: 0, max: 6, step: 1 },
      default: def,
    });
  };

  _initiativeCost("keepInitiativeCost",
    "STA2E.Settings.KeepInitiativeCost.Name", "STA2E.Settings.KeepInitiativeCost.Hint", 2);
  _initiativeCost("seizeInitiativeCost",
    "STA2E.Settings.SeizeInitiativeCost.Name", "STA2E.Settings.SeizeInitiativeCost.Hint", 2);
  _initiativeCost("extraMinorCost",
    "STA2E.Settings.ExtraMinorCost.Name", "STA2E.Settings.ExtraMinorCost.Hint", 1);
  _initiativeCost("extraMajorCost",
    "STA2E.Settings.ExtraMajorCost.Name", "STA2E.Settings.ExtraMajorCost.Hint", 2);

  game.settings.register("sta2e-toolkit", "poolTrackerMode", {
    name:    "STA2E.Settings.PoolTrackerMode.Name",
    hint:    "STA2E.Settings.PoolTrackerMode.Hint",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      "sta":     "STA2E.Settings.PoolTrackerMode.Sta",
      "toolkit": "STA2E.Settings.PoolTrackerMode.Toolkit",
    },
    default: "sta",
    onChange: () => {
      game.sta2eToolkit?.poolTracker?.applyMode?.();
      game.socket?.emit("module.sta2e-toolkit", { action: "refreshPoolTracker" });
    },
  });

  game.settings.register("sta2e-toolkit", "poolChangeChatLog", {
    name:    "STA2E.Settings.PoolChangeChatLog.Name",
    hint:    "STA2E.Settings.PoolChangeChatLog.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // Remembers the last Task Maker configuration per user (normal + extended task).
  game.settings.register("sta2e-toolkit", "taskMakerLastSettings", {
    scope:   "client",
    config:  false,
    type:    Object,
    default: {},
  });

  // Up to five recent extended-task setups, so the GM can reuse any of several
  // concurrent extended tasks.
  game.settings.register("sta2e-toolkit", "taskMakerRecentExtended", {
    scope:   "client",
    config:  false,
    type:    Array,
    default: [],
  });

  game.settings.register("sta2e-toolkit", "alliedNpcMomentum", {
    name:    "Allied NPC Momentum",
    hint:    "Secondary Momentum pool used by allied NPCs. Maximum 6.",
    scope:   "world",
    config:  false,
    type:    Number,
    default: 0,
    onChange: () => {
      game.sta2eToolkit?.poolTracker?.refresh?.();
      game.socket?.emit("module.sta2e-toolkit", { action: "refreshPoolTracker" });
    },
  });

  game.settings.register("sta2e-toolkit", "showAlliedNpcMomentumTracker", {
    name:    "Show Allied NPC Momentum in Tracker",
    hint:    "When enabled, the toolkit pool tracker shows the Allied NPC Momentum pool while the active scene has an allied NPC token.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => {
      game.sta2eToolkit?.poolTracker?.refresh?.();
      game.socket?.emit("module.sta2e-toolkit", { action: "refreshPoolTracker" });
    },
  });

  game.settings.register("sta2e-toolkit", "poolTrackerLayout", {
    name:    "STA2E.Settings.PoolTrackerLayout.Name",
    hint:    "STA2E.Settings.PoolTrackerLayout.Hint",
    scope:   "client",
    config:  true,
    type:    String,
    choices: {
      "docked":   "STA2E.Settings.PoolTrackerLayout.Docked",
      "floating": "STA2E.Settings.PoolTrackerLayout.Floating",
    },
    default: "docked",
    onChange: () => {
      game.sta2eToolkit?.poolTracker?.applyMode?.();
      game.sta2eToolkit?.poolTracker?.refresh?.();
    },
  });

  game.settings.register("sta2e-toolkit", "poolTrackerSize", {
    name:    "STA2E.Settings.PoolTrackerSize.Name",
    hint:    "STA2E.Settings.PoolTrackerSize.Hint",
    scope:   "client",
    config:  true,
    type:    Number,
    range:   { min: 50, max: 150, step: 5 },
    default: 100,
    onChange: () => {
      game.sta2eToolkit?.poolTracker?.applyMode?.();
      game.sta2eToolkit?.poolTracker?.refresh?.();
    },
  });

  // ── Sounds & Animations config menu button ─────────────────────────────
  game.settings.registerMenu("sta2e-toolkit", "effectConfigMenu", {
    name:       "STA2E.Settings.EffectConfig.Name",
    label:      "STA2E.Settings.EffectConfig.Label",
    hint:       "STA2E.Settings.EffectConfig.Hint",
    icon:       "fas fa-volume-high",
    type:       EffectConfigMenu,
    restricted: true,
  });

  // ── Zone System ──────────────────────────────────────────────────────────
  game.settings.register("sta2e-toolkit", "showZoneBorders", {
    name:    "STA2E.Settings.ShowZoneBorders.Name",
    hint:    "STA2E.Settings.ShowZoneBorders.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => game.sta2eToolkit?.zoneOverlay?.refresh(),
  });

  game.settings.register("sta2e-toolkit", "zoneRulerOverride", {
    name:    "STA2E.Settings.ZoneRulerOverride.Name",
    hint:    "STA2E.Settings.ZoneRulerOverride.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "zoneBorderStyleDefault", {
    name:    "STA2E.Settings.ZoneBorderStyleDefault.Name",
    hint:    "STA2E.Settings.ZoneBorderStyleDefault.Hint",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      "solid":  "STA2E.Settings.ZoneBorderStyleDefault.Solid",
      "dashed": "STA2E.Settings.ZoneBorderStyleDefault.Dashed",
      "dotted": "STA2E.Settings.ZoneBorderStyleDefault.Dotted",
      "none":   "STA2E.Settings.ZoneBorderStyleDefault.None",
    },
    default: "solid",
  });

  game.settings.register("sta2e-toolkit", "zoneBorderWidth", {
    name:    "STA2E.Settings.ZoneBorderWidth.Name",
    hint:    "STA2E.Settings.ZoneBorderWidth.Hint",
    scope:   "world",
    config:  true,
    type:    Number,
    range:   { min: 1, max: 20, step: 1 },
    default: 2,
    onChange: () => game.sta2eToolkit?.zoneOverlay?.refresh(),
  });

  game.settings.register("sta2e-toolkit", "zoneShowLabels", {
    name:    "STA2E.Settings.ZoneShowLabels.Name",
    hint:    "STA2E.Settings.ZoneShowLabels.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => game.sta2eToolkit?.zoneOverlay?.refresh(),
  });

  game.settings.register("sta2e-toolkit", "zoneDragRuler", {
    name:    "STA2E.Settings.ZoneDragRuler.Name",
    hint:    "STA2E.Settings.ZoneDragRuler.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "zoneMovementLog", {
    name:    "STA2E.Settings.ZoneMovementLog.Name",
    hint:    "STA2E.Settings.ZoneMovementLog.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // Internal — last hex size used for stamp/fill (persists per-client)
  game.settings.register("sta2e-toolkit", "zoneHexSize", {
    name:    "Zone Hex Size",
    scope:   "client",
    config:  false,
    type:    Number,
    default: 150,
  });

  // Honeycomb radius for the hex stamp tool. 0 = single hex; 1 = 7-cell cluster;
  // 2 = 19; 3 = 37. Each click stamps one zone whose outer boundary traces the
  // union of the cluster cells.
  game.settings.register("sta2e-toolkit", "zoneHoneycombRadius", {
    name:    "Zone Honeycomb Radius",
    scope:   "client",
    config:  false,
    type:    Number,
    default: 1,
  });

  game.settings.register("sta2e-toolkit", "zoneBrushSnap", {
    name:    "Zone Brush Snap",
    scope:   "client",
    config:  false,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "zoneBrushCellRadius", {
    name:    "Zone Brush Cell Radius",
    scope:   "client",
    config:  false,
    type:    Number,
    default: 1,
  });

  game.settings.register("sta2e-toolkit", "zoneBrushPixelDiameter", {
    name:    "Zone Brush Pixel Diameter",
    scope:   "client",
    config:  false,
    type:    Number,
    default: 0,
  });

  game.settings.register("sta2e-toolkit", "elevationRuler", {
    name: "STA2E.Settings.ElevationRuler.Name",
    hint: "STA2E.Settings.ElevationRuler.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "forcePrimaryCharacterSelection", {
    name:    "STA2E.Settings.ForcePrimaryCharacterSelection.Name",
    hint:    "STA2E.Settings.ForcePrimaryCharacterSelection.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register("sta2e-toolkit", "lcarsRingEnabled", {
    name:    "STA2E.Settings.LcarsRingEnabled.Name",
    hint:    "STA2E.Settings.LcarsRingEnabled.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => game.sta2eToolkit?.lcarsRing?.refresh?.(),
  });

  game.settings.register("sta2e-toolkit", "lcarsRingHiddenForStreaming", {
    name:    "STA2E.Settings.LcarsRingHiddenForStreaming.Name",
    hint:    "STA2E.Settings.LcarsRingHiddenForStreaming.Hint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => game.sta2eToolkit?.lcarsRing?.refresh?.(),
  });

  game.settings.register("sta2e-toolkit", "lcarsRingSize", {
    name:    "STA2E.Settings.LcarsRingSize.Name",
    hint:    "STA2E.Settings.LcarsRingSize.Hint",
    scope:   "client",
    config:  true,
    type:    Number,
    range:   { min: 50, max: 150, step: 5 },
    default: 100,
    onChange: () => game.sta2eToolkit?.lcarsRing?.refresh?.(),
  });

  game.settings.register("sta2e-toolkit", "lcarsRingCollapsed", {
    name:    "LCARS Ring Collapsed",
    scope:   "client",
    config:  false,
    type:    Boolean,
    default: false,
    onChange: () => game.sta2eToolkit?.lcarsRing?.refresh?.(),
  });

  game.settings.register("sta2e-toolkit", "lcarsRingActiveActorId", {
    name:    "LCARS Ring Active Actor",
    scope:   "client",
    config:  false,
    type:    String,
    default: "",
    onChange: () => game.sta2eToolkit?.lcarsRing?.refresh?.(),
  });

  game.settings.register("sta2e-toolkit", "lcarsRingGmAutoSwitch", {
    name:    "STA2E.Settings.LcarsRingGmAutoSwitch.Name",
    hint:    "STA2E.Settings.LcarsRingGmAutoSwitch.Hint",
    scope:   "client",
    config:  false,
    type:    Boolean,
    default: false,
    onChange: () => game.sta2eToolkit?.lcarsRing?.refresh?.(),
  });

  game.settings.register("sta2e-toolkit", "lcarsRingShipByActor", {
    name:    "LCARS Ring Ships By Actor",
    scope:   "client",
    config:  false,
    type:    Object,
    default: {},
    onChange: () => game.sta2eToolkit?.lcarsRing?.refresh?.(),
  });

  game.settings.register("sta2e-toolkit", "lcarsRingFavorites", {
    name:    "LCARS Ring Favorites",
    scope:   "client",
    config:  false,
    type:    Object,
    default: { characters: [], ships: [] },
  });

  game.settings.register("sta2e-toolkit", "showMinutes", {
    name: "STA2E.Settings.ShowMinutes.Name",
    hint: "STA2E.Settings.ShowMinutes.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => game.sta2eToolkit?.broadcastHUDRender()
  });

  game.settings.register("sta2e-toolkit", "hudVisibility", {
    name: "STA2E.Settings.HudVisibility.Name",
    hint: "STA2E.Settings.HudVisibility.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "gmonly": "STA2E.Settings.HudVisibility.GmOnly",
      "all":    "STA2E.Settings.HudVisibility.All",
    },
    default: "all",
    onChange: () => game.sta2eToolkit?.broadcastHUDRender()
  });

  game.settings.register("sta2e-toolkit", "hudTheme", {
    name: "STA2E.Settings.HudTheme.Name",
    hint: "STA2E.Settings.HudTheme.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "blue":           "STA2E.Settings.HudTheme.Blue",
      "lcars-tng":      "STA2E.Settings.HudTheme.LcarsTng",
      "lcars-tng-blue": "STA2E.Settings.HudTheme.LcarsTngBlue",
      "tos-panel":      "STA2E.Settings.HudTheme.TosPanel",
      "tmp-console":    "STA2E.Settings.HudTheme.TmpConsole",
      "ent-panel":      "STA2E.Settings.HudTheme.EntPanel",
      "klingon":        "STA2E.Settings.HudTheme.Klingon",
      "romulan":        "STA2E.Settings.HudTheme.Romulan",
    },
    default: "blue",
    onChange: () => game.sta2eToolkit?.broadcastHUDRender()
  });

  game.settings.register("sta2e-toolkit", "stressMode", {
    name: "STA2E.Settings.StressMode.Name",
    hint: "STA2E.Settings.StressMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "countdown": "STA2E.Settings.StressMode.Countdown",
      "countup":   "STA2E.Settings.StressMode.Countup",
    },
    default: "countdown",
  });

  game.settings.register("sta2e-toolkit", "npcPersonalThreatSource", {
    name: "STA2E.Settings.NpcPersonalThreatSource.Name",
    hint: "STA2E.Settings.NpcPersonalThreatSource.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "actor":           "STA2E.Settings.NpcPersonalThreatSource.Actor",
      "token":           "STA2E.Settings.NpcPersonalThreatSource.Token",
      "actor-then-token":"STA2E.Settings.NpcPersonalThreatSource.ActorThenToken",
      "token-then-actor":"STA2E.Settings.NpcPersonalThreatSource.TokenThenActor",
    },
    default: "actor",
    onChange: () => game.sta2eToolkit?.combatHud?._refresh?.(),
  });

  // Internal — ship assignment presets  { presetName: [shipActorId, ...] }
  game.settings.register("sta2e-toolkit", "shipPresets", {
    name:    "Ship Assignment Presets",
    scope:   "world",
    config:  false,
    type:    Object,
    default: {},
  });

  // Internal — pending opposed task: stores attacker context while defender rolls.
  // Written when an attack is intercepted by an active defense mode; cleared by
  // the GM socket handler once the defender confirms their roll.
  game.settings.register("sta2e-toolkit", "pendingOpposedTask", {
    name:    "Pending Opposed Task",
    scope:   "world",
    config:  false,
    type:    Object,
    default: null,
  });

  // Internal — campaigns stored as object wrapper
  game.settings.register("sta2e-toolkit", "campaigns", {
    name: "Campaigns",
    scope: "world",
    config: false,
    type: Object,
    default: { list: [] }
  });

  // Internal — active campaign ID
  game.settings.register("sta2e-toolkit", "activeCampaign", {
    name: "Active Campaign",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // ── Token Display ────────────────────────────────────────────────────────

  game.settings.register("sta2e-toolkit", "hideTokenElevation", {
    name:    "STA2E.Settings.HideTokenElevation.Name",
    hint:    "STA2E.Settings.HideTokenElevation.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => refreshAllTokenElevationTooltips(),
  });

  // ── Token Selection Glow ─────────────────────────────────────────────────
  // Replaces Foundry's rectangular selection border with a silhouette glow.
  // Client scope: every user picks their own look.

  game.settings.register("sta2e-toolkit", "tokenSelectGlow", {
    name:    "STA2E.Settings.TokenSelectGlow.Name",
    hint:    "STA2E.Settings.TokenSelectGlow.Hint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => refreshAllTokenSelectGlow(),
  });

  game.settings.register("sta2e-toolkit", "tokenSelectGlowHideBorder", {
    name:    "STA2E.Settings.TokenSelectGlowHideBorder.Name",
    hint:    "STA2E.Settings.TokenSelectGlowHideBorder.Hint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => refreshAllTokenSelectGlow(),
  });

  game.settings.register("sta2e-toolkit", "tokenSelectGlowDistance", {
    name:    "STA2E.Settings.TokenSelectGlowDistance.Name",
    hint:    "STA2E.Settings.TokenSelectGlowDistance.Hint",
    scope:   "client",
    config:  true,
    type:    Number,
    range:   { min: 4, max: 40, step: 1 },
    default: 14,
    onChange: () => refreshAllTokenSelectGlow(),
  });

  game.settings.register("sta2e-toolkit", "tokenSelectGlowStrength", {
    name:    "STA2E.Settings.TokenSelectGlowStrength.Name",
    hint:    "STA2E.Settings.TokenSelectGlowStrength.Hint",
    scope:   "client",
    config:  true,
    type:    Number,
    range:   { min: 0.5, max: 6, step: 0.1 },
    default: 2.6,
    onChange: () => refreshAllTokenSelectGlow(),
  });

  game.settings.register("sta2e-toolkit", "tokenSelectGlowHover", {
    name:    "STA2E.Settings.TokenSelectGlowHover.Name",
    hint:    "STA2E.Settings.TokenSelectGlowHover.Hint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => refreshAllTokenSelectGlow(),
  });

  game.settings.register("sta2e-toolkit", "tokenSelectGlowTarget", {
    name:    "STA2E.Settings.TokenSelectGlowTarget.Name",
    hint:    "STA2E.Settings.TokenSelectGlowTarget.Hint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => refreshAllTokenSelectGlow(),
  });

  // ── JB2A Tier ────────────────────────────────────────────────────────────

  game.settings.register("sta2e-toolkit", "jb2aTier", {
    name: "STA2E.Settings.Jb2aTier.Name",
    hint: "STA2E.Settings.Jb2aTier.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "free":   "STA2E.Settings.Jb2aTier.Free",
      "patron": "STA2E.Settings.Jb2aTier.Patron",
    },
    default: "free"
  });

  // ── NPC Ship Rules ────────────────────────────────────────────────────────
  // Core rulebook, NPCs and Starship Operations: "NPC ships do not have
  // Reserve Power (see page 185)." Off by default, so NPC and allied NPC
  // vessels skip the Reserve Power economy entirely.

  game.settings.register("sta2e-toolkit", "npcShipsUseReservePower", {
    name:    "STA2E.Settings.NpcShipsUseReservePower.Name",
    hint:    "STA2E.Settings.NpcShipsUseReservePower.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => {
      game.sta2eToolkit?.combatHud?._refresh?.();
      game.socket?.emit("module.sta2e-toolkit", { action: "renderHUD" });
    },
  });

  // ── Cinematic ship repositioning ─────────────────────────────────────────
  // When a ship fires, after it rotates to bring the weapon arc to bear it can
  // also nudge a square or two forward along that facing — purely for flavour.
  // The move is clamped to the firing ship's current zone, so range bands and
  // zone-based distances never change.

  game.settings.register("sta2e-toolkit", "shipWeaponReposition", {
    name:    "Ship Weapons — Cinematic Reposition",
    hint:    "When a ship fires, let it curve forward into firing position — the hull noses through a banking turn onto its weapon arc and glides a square or two, bow-first. The move stays inside the ship's current zone, so it never changes range bands. Turn off to keep the ship in place: it still turns to bring its weapon arc onto the target, just without the forward glide.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "shipWeaponRepositionSquares", {
    name:    "Ship Weapons — Reposition Distance (squares)",
    hint:    "Maximum number of grid squares a firing ship may slide forward along its arc. The actual distance is clamped so the ship stays in the same zone. 0 disables the nudge.",
    scope:   "world",
    config:  true,
    type:    Number,
    range:   { min: 0, max: 4, step: 0.5 },
    default: 1,
  });

  game.settings.register("sta2e-toolkit", "shipWeaponScaleSpeed", {
    name:    "Ship Weapons — Scale-Based Speed",
    hint:    "Tie the cinematic reposition speed to the ship's Scale. Higher-Scale hulls glide and turn more slowly; small craft stay nimble. Turn off for a uniform speed regardless of ship size.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "photonTorpedoCustomSprite", {
    name:    "Photon Torpedo — Custom Moving Sprite",
    hint:    "Use the toolkit's bundled photon torpedo webm (a spinning projectile) instead of the JB2A bullet. The sprite spins in place, so it is flown from the firing emitter to the target with a move-tween rather than being stretched along the path. Applies to single shots and salvos, hits and misses. Quantum and plasma torpedoes are unaffected.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // Per-type torpedo fire counts (standard/salvo base + max). Managed by the
  // Torpedoes tab in the Sounds & Animations menu; not shown in the flat list.
  game.settings.register("sta2e-toolkit", "torpedoCountConfig", {
    scope:   "world",
    config:  false,
    type:    Object,
    default: {},
  });

  // Per-family energy weapon animation play-counts (base + per-damage + max).
  // Managed by the Energy Weapons tab in the Sounds & Animations menu.
  game.settings.register("sta2e-toolkit", "energyWeaponCountConfig", {
    scope:   "world",
    config:  false,
    type:    Object,
    default: {},
  });

  // Optional hard cap on how many strikes an array volley plays when fired in
  // Area mode, on top of the per-family damage scaling. { enabled, max }.
  // Managed by the Energy Weapons tab in the Sounds & Animations menu.
  game.settings.register("sta2e-toolkit", "arrayAreaShotCap", {
    scope:   "world",
    config:  false,
    type:    Object,
    default: {},
  });

  // ── Combat Sound Effects ─────────────────────────────────────────────────
  // All optional — empty string = no sound played for that slot.

  const snd = (name, hint, def = "") => ({
    name, hint, scope: "world", config: false, type: String, default: def, filePicker: "audio"
  });

  // Ship weapons — hit sounds
  game.settings.register("sta2e-toolkit", "sndShipPhaserHit",    snd("Ship Sound — Phaser / Phase-Pulse (Hit)",    "Sound played when a phaser-type ship weapon hits."));
  game.settings.register("sta2e-toolkit", "sndShipPhaserMiss",   snd("Ship Sound — Phaser / Phase-Pulse (Miss)",   "Sound played when a phaser-type ship weapon misses."));
  game.settings.register("sta2e-toolkit", "sndShipDisruptorHit", snd("Ship Sound — Disruptor (Hit)",               "Sound played when a disruptor-type ship weapon hits."));
  game.settings.register("sta2e-toolkit", "sndShipDisruptorMiss",snd("Ship Sound — Disruptor (Miss)",              "Sound played when a disruptor-type ship weapon misses."));
  game.settings.register("sta2e-toolkit", "sndShipPolaronHit",   snd("Ship Sound — Polaron (Hit)",                 "Sound played when a polaron-type ship weapon hits."));
  game.settings.register("sta2e-toolkit", "sndShipPolaronMiss",  snd("Ship Sound — Polaron (Miss)",                "Sound played when a polaron-type ship weapon misses."));
  game.settings.register("sta2e-toolkit", "sndShipCannonHit",    snd("Ship Sound — Cannon (Hit)",                  "Sound played when a cannon-type ship weapon fires."));
  game.settings.register("sta2e-toolkit", "sndShipCannonPhaserHit",    snd("Ship Sound — Phaser Cannon (Hit)",    "Sound when a phaser cannon hits."));
  game.settings.register("sta2e-toolkit", "sndShipCannonPhaserMiss",   snd("Ship Sound — Phaser Cannon (Miss)",   "Sound when a phaser cannon misses."));
  game.settings.register("sta2e-toolkit", "sndShipCannonDisruptorHit", snd("Ship Sound — Disruptor Cannon (Hit)", "Sound when a disruptor cannon hits."));
  game.settings.register("sta2e-toolkit", "sndShipCannonDisruptorMiss",snd("Ship Sound — Disruptor Cannon (Miss)","Sound when a disruptor cannon misses."));
  game.settings.register("sta2e-toolkit", "sndShipCannonPolaronHit",   snd("Ship Sound — Polaron Cannon (Hit)",   "Sound when a polaron cannon hits."));
  game.settings.register("sta2e-toolkit", "sndShipCannonPolaronMiss",  snd("Ship Sound — Polaron Cannon (Miss)",  "Sound when a polaron cannon misses."));
  // Spinal Lance — per type. Blank falls back to the matching beam sound.
  game.settings.register("sta2e-toolkit", "sndShipLancePhaserHit",     snd("Ship Sound — Phaser Spinal Lance (Hit)",     "Sound when a phaser spinal lance hits. Blank uses the phaser beam (hit) sound."));
  game.settings.register("sta2e-toolkit", "sndShipLancePhaserMiss",    snd("Ship Sound — Phaser Spinal Lance (Miss)",    "Sound when a phaser spinal lance misses. Blank uses the phaser beam (miss) sound."));
  game.settings.register("sta2e-toolkit", "sndShipLanceDisruptorHit",  snd("Ship Sound — Disruptor Spinal Lance (Hit)",  "Sound when a disruptor spinal lance hits. Blank uses the disruptor beam (hit) sound."));
  game.settings.register("sta2e-toolkit", "sndShipLanceDisruptorMiss", snd("Ship Sound — Disruptor Spinal Lance (Miss)", "Sound when a disruptor spinal lance misses. Blank uses the disruptor beam (miss) sound."));
  game.settings.register("sta2e-toolkit", "sndShipLancePolaronHit",    snd("Ship Sound — Polaron Spinal Lance (Hit)",    "Sound when a polaron spinal lance hits. Blank uses the polaron beam (hit) sound."));
  game.settings.register("sta2e-toolkit", "sndShipLancePolaronMiss",   snd("Ship Sound — Polaron Spinal Lance (Miss)",   "Sound when a polaron spinal lance misses. Blank uses the polaron beam (miss) sound."));
  // Arrays only charge up on the opening strike of a volley; the strikes that
  // follow can use their own audio instead of replaying the charge-and-fire.
  game.settings.register("sta2e-toolkit", "sndShipArrayRepeat", snd(
    "Ship Sound — Array (Additional Strikes)",
    "Sound for the 2nd and later strikes of an array volley. Blank uses the weapon's normal hit sound."
  ));
  for (const era of [
    { key: "Ent", label: "ENT" },
    { key: "Tos", label: "TOS" },
    { key: "Tmp", label: "TMP" },
    { key: "Tng", label: "TNG/DS9/VOY" },
  ]) {
    for (const type of [
      { key: "Bank",   label: "Bank" },
      { key: "Array",  label: "Array" },
      { key: "Cannon", label: "Cannon" },
      { key: "Lance",  label: "Spinal Lance" },
    ]) {
      for (const result of ["Hit", "Miss"]) {
        game.settings.register("sta2e-toolkit", `sndShipPhaser${type.key}${era.key}${result}`, snd(
          `Ship Sound - Phaser ${type.label} ${era.label} (${result})`,
          `Sound when a ${era.label} phaser ${type.label.toLowerCase()} ${result.toLowerCase()} animation plays. Blank falls back to the base phaser sound.`
        ));
      }
      // Only arrays fire multi-strike volleys with a single opening charge-up.
      if (type.key === "Array") {
        game.settings.register("sta2e-toolkit", `sndShipPhaserArray${era.key}Repeat`, snd(
          `Ship Sound - Phaser Array ${era.label} (Additional Strikes)`,
          `Sound for the 2nd and later strikes of an ${era.label} phaser array volley. Blank falls back to the generic array follow-up sound, then the base phaser sound.`
        ));
      }
    }
  }
  // Torpedo sounds — per type, with optional separate salvo sound
  game.settings.register("sta2e-toolkit", "sndShipTorpedo",            snd("Ship Sound — Torpedo (legacy fallback)", "Legacy fallback if per-type torpedo sounds are not set."));
  game.settings.register("sta2e-toolkit", "sndShipTorpedoPhoton",      snd("Ship Sound — Photon Torpedo",       "Sound when a single photon torpedo is fired."));
  game.settings.register("sta2e-toolkit", "sndShipTorpedoPhotonSalvo", snd("Ship Sound — Photon Torpedo Salvo", "Sound when a photon torpedo salvo is fired (falls back to single if unset)."));
  game.settings.register("sta2e-toolkit", "sndShipTorpedoQuantum",     snd("Ship Sound — Quantum Torpedo",      "Sound when a single quantum torpedo is fired."));
  game.settings.register("sta2e-toolkit", "sndShipTorpedoQuantumSalvo",snd("Ship Sound — Quantum Torpedo Salvo","Sound when a quantum torpedo salvo is fired (falls back to single if unset)."));
  game.settings.register("sta2e-toolkit", "sndShipTorpedoPlasma",      snd("Ship Sound — Plasma Torpedo",       "Sound when a single plasma torpedo is fired."));
  game.settings.register("sta2e-toolkit", "sndShipTorpedoPlasmasSalvo",snd("Ship Sound — Plasma Torpedo Salvo", "Sound when a plasma torpedo salvo is fired (falls back to single if unset)."));

  // Ground weapons
  game.settings.register("sta2e-toolkit", "sndGroundPhaserHit",    snd("Ground Sound — Phaser (Hit)",    "Sound for ground phaser hits."));
  game.settings.register("sta2e-toolkit", "sndGroundPhaserMiss",   snd("Ground Sound — Phaser (Miss)",   "Sound for ground phaser misses."));
  game.settings.register("sta2e-toolkit", "sndGroundDisruptorHit", snd("Ground Sound — Disruptor (Hit)", "Sound for ground disruptor hits."));
  game.settings.register("sta2e-toolkit", "sndGroundDisruptorMiss",snd("Ground Sound — Disruptor (Miss)","Sound for ground disruptor misses."));
  game.settings.register("sta2e-toolkit", "sndGroundPlasmaHit",    snd("Ground Sound — Plasma/Particle (Hit)",  "Sound for ground plasma/particle hits."));
  game.settings.register("sta2e-toolkit", "sndGroundGenericHit",   snd("Ground Sound — Generic Ranged (Hit)",   "Fallback sound for unrecognised ranged ground weapons."));
  game.settings.register("sta2e-toolkit", "sndGroundGrenade",      snd("Ground Sound — Grenade",                "Sound for grenade explosions."));
  game.settings.register("sta2e-toolkit", "sndGroundMeleeHit",     snd("Ground Sound — Melee (Hit)",            "Sound for melee weapon hits."));
  game.settings.register("sta2e-toolkit", "sndGroundMeleeMiss",    snd("Ground Sound — Melee (Miss)",           "Sound for melee weapon misses (swoosh)."));
  game.settings.register("sta2e-toolkit", "sndGroundHypospray",    snd("Ground Sound — Anesthetic Hypospray",   "Sound when the Anesthetic Hypospray is used."));
  game.settings.register("sta2e-toolkit", "sndGroundFirstAid",     snd("Ground Sound — First Aid (Success)",    "Sound played on the target when a First Aid task succeeds."));

  // Ground phasers, per era and per hand-phaser type. Both rungs are optional:
  // a blank type slot falls back to the era slot, and a blank era slot falls
  // back to sndGroundPhaserHit/Miss above — so a GM can fill in only the audio
  // they actually have and the rest keeps working.
  for (const era of GROUND_PHASER_ERA_ROWS) {
    for (const result of ["Hit", "Miss"]) {
      game.settings.register("sta2e-toolkit", `sndGroundPhaser${era.key}${result}`, snd(
        `Ground Sound - Phaser ${era.label} (${result})`,
        `Sound for any ${era.label}-era ground phaser ${result.toLowerCase()}. Blank falls back to the base ground phaser sound.`
      ));
      for (const type of GROUND_PHASER_TYPE_ROWS) {
        game.settings.register("sta2e-toolkit", `sndGroundPhaser${type.key}${era.key}${result}`, snd(
          `Ground Sound - ${type.label} ${era.label} (${result})`,
          `Sound when a ${era.label}-era ${type.label} ${result.toLowerCase()}s. Blank falls back to the ${era.label} era sound, then the base ground phaser sound.`
        ));
      }
    }
  }

  // Tactical effects
  game.settings.register("sta2e-toolkit", "sndScanForWeakness",    snd("Effect Sound — Scan for Weakness",   "Sound when Scan for Weakness is activated on a target."));
  game.settings.register("sta2e-toolkit", "sndAttackPattern",      snd("Effect Sound — Attack Pattern",      "Sound when Attack Pattern is activated."));
  game.settings.register("sta2e-toolkit", "sndEvasiveAction",      snd("Effect Sound — Evasive Action",      "Sound when Evasive Action is activated."));
  game.settings.register("sta2e-toolkit", "sndDefensiveFire",      snd("Effect Sound — Defensive Fire",      "Sound when Defensive Fire is activated."));
  game.settings.register("sta2e-toolkit", "sndRam",                snd("Effect Sound — Ram",                 "Sound when a Ram attack is performed."));
  game.settings.register("sta2e-toolkit", "sndShipDestroyed",      snd("Effect Sound — Ship Destroyed",      "Sound when a ship is destroyed."));
  game.settings.register("sta2e-toolkit", "sndCloak",              snd("Effect Sound — Cloaking Device",     "Sound when a ship activates its cloaking device."));
  game.settings.register("sta2e-toolkit", "sndDecloak",            snd("Effect Sound — Decloaking",          "Sound when a ship deactivates its cloaking device."));

  // ── Hazard zone sounds ────────────────────────────────────────────────────
  const hSnd = (name, hint) => ({
    name, hint, scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });
  game.settings.register("sta2e-toolkit", "sndHazardRadiation",   hSnd("Hazard Sound — Radiation",            "Sound played when a token takes Radiation hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardPlasmaStorm", hSnd("Hazard Sound — Plasma Storm",         "Sound for Plasma Storm hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardAsteroid",    hSnd("Hazard Sound — Asteroid Field",       "Sound for Asteroid Field hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardFire",        hSnd("Hazard Sound — Fire / Plasma Fire",   "Sound for Fire hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardNebula",      hSnd("Hazard Sound — Nebula Gas",           "Sound for Nebula Gas hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardFallingRocks",hSnd("Hazard Sound — Falling Rocks/Debris", "Sound for Falling Rocks hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardCaveIn",      hSnd("Hazard Sound — Cave-in/Collapse",     "Sound for Cave-in hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardToxicGas",    hSnd("Hazard Sound — Toxic Gas",            "Sound for Toxic Gas hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardElectrical",  hSnd("Hazard Sound — Electrical Discharge", "Sound for Electrical Discharge hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardExtremeTemp", hSnd("Hazard Sound — Extreme Temperature",  "Sound for Extreme Temperature hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardMinefield",   hSnd("Hazard Sound — Mines/Explosives",     "Sound for Minefield hazard damage."));
  game.settings.register("sta2e-toolkit", "sndHazardGeneric",     hSnd("Hazard Sound — Generic Hazard",       "Fallback sound for any unrecognised hazard type."));

  game.settings.register("sta2e-toolkit", "autoVaporizeMinorNpc", {
    name:    "STA2E.Settings.AutoVaporizeMinorNpc.Name",
    hint:    "STA2E.Settings.AutoVaporizeMinorNpc.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "groundTalentAutomation", {
    name:    "STA2E.Settings.GroundTalentAutomation.Name",
    hint:    "STA2E.Settings.GroundTalentAutomation.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "deleteTokenOnDestruction", {
    name:    "STA2E.Settings.DeleteTokenOnDestruction.Name",
    hint:    "STA2E.Settings.DeleteTokenOnDestruction.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "autoDestroyNpcStarships", {
    name:    "STA2E.Settings.AutoDestroyNpcStarships.Name",
    hint:    "STA2E.Settings.AutoDestroyNpcStarships.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "autoDestroyPlayerStarships", {
    name:    "STA2E.Settings.AutoDestroyPlayerStarships.Name",
    hint:    "STA2E.Settings.AutoDestroyPlayerStarships.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register("sta2e-toolkit", "shipDestructionThroesDuration", {
    name:    "STA2E.Settings.ShipDestructionThroesDuration.Name",
    hint:    "STA2E.Settings.ShipDestructionThroesDuration.Hint",
    scope:   "world",
    config:  true,
    type:    Number,
    range:   { min: 2, max: 30, step: 1 },
    default: 10,
  });

  game.settings.register("sta2e-toolkit", "alphaAwareWeaponHitPoints", {
    name:    "STA2E.Settings.AlphaAwareWeaponHitPoints.Name",
    hint:    "STA2E.Settings.AlphaAwareWeaponHitPoints.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // ── Token Magic FX — breach damage visuals ──────────────────────────────
  game.settings.register("sta2e-toolkit", "shieldImpactFX", {
    name:    "STA2E.Settings.ShieldImpactFX.Name",
    hint:    "STA2E.Settings.ShieldImpactFX.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // Separate toggle rather than a pixi/sequencer renderer switch (cf. the
  // tractor beam): the bubble and the JB2A flash are meant to play together,
  // so this only decides whether the native layer is one of them.
  game.settings.register("sta2e-toolkit", "shieldBubbleVFX", {
    name:    "STA2E.Settings.ShieldBubbleVFX.Name",
    hint:    "STA2E.Settings.ShieldBubbleVFX.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // The standing envelope raised from the ship's Token HUD, not a weapon
  // reaction — separate from shieldBubbleVFX so a GM who wants impacts without
  // a permanent haze on the canvas can have exactly that.
  game.settings.register("sta2e-toolkit", "shieldIdleVFX", {
    name:    "STA2E.Settings.ShieldIdleVFX.Name",
    hint:    "STA2E.Settings.ShieldIdleVFX.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("sta2e-toolkit", "shieldBubbleStandoff", {
    name:    "STA2E.Settings.ShieldBubbleStandoff.Name",
    hint:    "STA2E.Settings.ShieldBubbleStandoff.Hint",
    scope:   "world",
    config:  true,
    type:    Number,
    range:   { min: 1, max: 2, step: 0.05 },
    default: 1.35,
  });

  game.settings.register("sta2e-toolkit", "shieldImpactPreset", {
    name:    "STA2E.Settings.ShieldImpactPreset.Name",
    hint:    "STA2E.Settings.ShieldImpactPreset.Hint",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      subtle:    "STA2E.Settings.ShieldImpactPreset.Subtle",
      cinematic: "STA2E.Settings.ShieldImpactPreset.Cinematic",
      intense:   "STA2E.Settings.ShieldImpactPreset.Intense",
    },
    default: "cinematic",
  });

  // Hull damage visuals — choose ONE system (or none) so they don't stack.
  //   decal      → persistent scorch PNG pinned to the hull (pins through rotation)
  //   tokenmagic → Token Magic FX splash filter on the token
  //   off        → no hull damage visual
  game.settings.register("sta2e-toolkit", "hullDamageStyle", {
    name:    "Hull Damage Visuals",
    hint:    "How a starship shows hull damage when a hit penetrates its shields. Scorch decals stamp a persistent mark pinned to the hull. Token Magic uses the splash filter. Off disables both.",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      decal:      "Scorch decals (pinned to hull)",
      tokenmagic: "Token Magic splash",
      off:        "Off",
    },
    default: "decal",
  });

  // Global size multiplier for scorch decals (1.0 = default). Lower = smaller.
  game.settings.register("sta2e-toolkit", "hullDecalScale", {
    name:    "Hull Decal Size",
    hint:    "Overall size of hull scorch decals. Use together with Hull Decal Growth to balance small vs large ships.",
    scope:   "world",
    config:  true,
    type:    Number,
    range:   { min: 0.3, max: 2, step: 0.05 },
    default: 1,
    onChange: () => resyncAllHullDecals(),
  });

  // Extra growth for decals on larger tokens, on top of the linear token-size
  // scaling. 1.0 = decals are a constant fraction of the token image; higher =
  // bigger tokens get proportionally larger marks than smaller tokens.
  game.settings.register("sta2e-toolkit", "hullDecalGrowth", {
    name:    "Hull Decal Growth",
    hint:    "Extra scaling for decals on larger tokens. 1.0 keeps marks a constant fraction of each token's image size; higher values make bigger tokens' marks proportionally larger still. (No effect when all tokens are the same size.)",
    scope:   "world",
    config:  true,
    type:    Number,
    range:   { min: 1, max: 2, step: 0.05 },
    default: 1,
    onChange: () => resyncAllHullDecals(),
  });

  // Keep decals on the hull: nudge a mark's placement inward until its footprint
  // sits on opaque ship pixels, using the token image's transparency. Avoids the
  // overhang you get from a hit near the silhouette edge. Applies to new marks.
  game.settings.register("sta2e-toolkit", "hullDecalMask", {
    name:    "Keep Decals on the Hull",
    hint:    "Pull scorch marks inward so they stay on the ship's shape instead of overhanging the edge into empty space. Uses the token image's transparency, and applies to newly created marks.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: () => refreshAllHullDecals(),
  });

  game.settings.register("sta2e-toolkit", "breachTrailFX", {
    name:    "STA2E.Settings.BreachTrailFX.Name",
    hint:    "STA2E.Settings.BreachTrailFX.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // ── Dice So Nice integration ─────────────────────────────────────────────
  game.settings.register("sta2e-toolkit", "useDiceSoNice", {
    name:    "STA2E.Settings.UseDiceSoNice.Name",
    hint:    "STA2E.Settings.UseDiceSoNice.Hint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // ── Interactive Dice Payment ─────────────────────────────────────────────
  game.settings.register("sta2e-toolkit", "interactiveDicePayment", {
    name:    "STA2E.Settings.InteractiveDicePayment.Name",
    hint:    "STA2E.Settings.InteractiveDicePayment.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // ── Task roll card style ─────────────────────────────────────────────────
  // classic → the original full-height Working Results card
  // slim    → same content, LCARS chrome: elbow header, left spine, pill stats
  // Read at render time in buildPlayerRollCardHtml. Cards store their rendered
  // HTML, so an existing card keeps the skin it was posted with until something
  // (reroll / assist / edit / confirm) rebuilds it.
  game.settings.register("sta2e-toolkit", "taskCardStyle", {
    name:    "Task Roll Card Style",
    hint:    "Visual skin for the interactive Working Results task-roll chat card. Classic is the original full-height layout. Slim keeps every section but packs it into LCARS chrome — elbow header, left spine, pill stat readout, smaller dice. Cards already in the chat log keep the style they were posted with.",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      classic: "Classic (full height)",
      slim:    "Slim LCARS (experimental)",
    },
    default: "classic",
  });

  // ── Task card resolution permissions ─────────────────────────────────────
  // Enforced per-client in the renderChatMessageHTML hook in
  // combat/combat-hud-core.js. Like `playersCanSetAlert`, this is a UI filter
  // rather than a security boundary — world settings are world-readable.
  game.settings.register("sta2e-toolkit", "gmOnlySucceedAtCost", {
    name:    "GM Only — Succeed at a Cost",
    hint:    "Only the GM may press \"Succeed at a Cost\" on a Working Results task card. Players see the button greyed out. The GM narrates the cost, so this keeps that call at the GM's table.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register("sta2e-toolkit", "gmOnlyConfirmResults", {
    name:    "GM Only — Confirm Results",
    hint:    "Only the GM may press \"Confirm Results\" to close out a Working Results task card. Players may still spend Momentum, reroll and assist; the GM performs the final confirmation.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // ── Character sheet roller override ──────────────────────────────────────
  game.settings.register("sta2e-toolkit", "overrideSheetRoller", {
    name:    "STA2E.Settings.OverrideSheetRoller.Name",
    hint:    "STA2E.Settings.OverrideSheetRoller.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // ── Character sheet theme ─────────────────────────────────────────────────
  game.settings.register("sta2e-toolkit", "themeCharacterSheet", {
    name:    "STA2E.Settings.ThemeCharacterSheet.Name",
    hint:    "STA2E.Settings.ThemeCharacterSheet.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => game.sta2eToolkit?.refreshSheetTheme?.(),
  });

  // ── Condition Alert ──────────────────────────────────────────────────────

  // Internal — current alert condition, synced to all clients via socket
  game.settings.register("sta2e-toolkit", "alertCondition", {
    name: "Alert Condition",
    scope: "world",
    config: false,
    type: String,
    default: "green"
  });

  game.settings.register("sta2e-toolkit", "alertVolume", {
    name: "STA2E.Settings.AlertVolume.Name",
    hint: "STA2E.Settings.AlertVolume.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.7,
  });

  game.settings.register("sta2e-toolkit", "playersCanSetAlert", {
    name: "STA2E.Settings.PlayersCanSetAlert.Name",
    hint: "STA2E.Settings.PlayersCanSetAlert.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register("sta2e-toolkit", "alertSoundLoop", {
    name: "STA2E.Settings.AlertSoundLoop.Name",
    hint: "STA2E.Settings.AlertSoundLoop.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Red Alert sounds — per era (managed via Sounds & Animations config menu)
  game.settings.register("sta2e-toolkit", "alertSoundRedTNG", {
    name: "Red Alert Sound — TNG/DS9/VOY Era",
    hint: "Audio file played on Red Alert for TNG-era campaigns.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });
  game.settings.register("sta2e-toolkit", "alertSoundRedTOS", {
    name: "Red Alert Sound — TOS/TMP Era",
    hint: "Audio file played on Red Alert for TOS/TMP-era campaigns.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });
  game.settings.register("sta2e-toolkit", "alertSoundRedENT", {
    name: "Red Alert Sound — ENT Era",
    hint: "Audio file played on Red Alert for ENT-era campaigns.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // Blue Alert sounds — per era
  game.settings.register("sta2e-toolkit", "alertSoundBlueTNG", {
    name: "Blue Alert Sound — TNG/DS9/VOY Era",
    hint: "Audio file played on Blue Alert for TNG-era campaigns.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });
  game.settings.register("sta2e-toolkit", "alertSoundBlueTOS", {
    name: "Blue Alert Sound — TOS/TMP Era",
    hint: "Audio file played on Blue Alert for TOS/TMP-era campaigns.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });
  game.settings.register("sta2e-toolkit", "alertSoundBlueENT", {
    name: "Blue Alert Sound — ENT Era",
    hint: "Audio file played on Blue Alert for ENT-era campaigns.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // Impulse effect sound (managed via Sounds & Animations config menu)
  game.settings.register("sta2e-toolkit", "sndImpulseEngage", {
    name: "Impulse Sound — Engage",
    hint: "Audio file played when the impulse engage animation fires.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // Warp effect sounds — depart is the boom as the ship jumps to warp, arrive
  // plays as it drops back out at the destination.
  game.settings.register("sta2e-toolkit", "sndWarpEngage", {
    name: "Warp Sound — Depart",
    hint: "Audio file played as the ship jumps to warp (the boom).",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  game.settings.register("sta2e-toolkit", "sndWarpArrive", {
    name: "Warp Sound — Arrive",
    hint: "Audio file played as the ship drops out of warp at its destination.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // The ship waits hidden at the far end until the corridor animation actually
  // finishes; this is only the ceiling on that wait, so a missing asset can't
  // hang the jump and a GM who finds the arrival slow can cut it short.
  game.settings.register("sta2e-toolkit", "timingWarpCorridor", {
    name: "Warp Corridor Max Wait (ms)",
    hint: "Longest the ship stays hidden waiting for the corridor animation to finish before dropping out of warp.",
    scope: "world", config: false, type: Number, default: 2000,
  });

  // Size multiplier (percent) for the Warp-Flash animation at both ends of a
  // jump. Managed via Sounds & Animations → Ship Tasks; world scope so every
  // client renders the flash the same size.
  game.settings.register("sta2e-toolkit", "warpFlashScale", {
    name: "Warp Flash Size (%)",
    hint: "Scales the standard warp depart/arrive flash animation. 100 = default size. Does not affect the Temporal Rift, which has its own size.",
    scope: "world", config: false, type: Number, default: 100,
  });

  // How far the ship's own hull elongates along its heading at the two ends of
  // a jump. A percent on the *elongation*, so 0 is genuinely no stretch rather
  // than a collapsed hull. World scope: every client deforms the same ship, so
  // they must agree. See warp-stretch-vfx.js.
  game.settings.register("sta2e-toolkit", "warpTokenStretch", {
    name: "Warp Token Stretch (%)",
    hint: "How far a ship's hull smears along its heading as it enters and leaves warp. 100 = default; 0 turns the stretch off. Rift effects never stretch.",
    scope: "world", config: false, type: Number, default: 100,
  });

  // The rift is a different clip with a different amount of transparent margin,
  // so it gets its own percent rather than sharing the flash's — sizing one
  // must never resize the other.
  game.settings.register("sta2e-toolkit", "warpRiftScale", {
    name: "Temporal Rift Size (%)",
    hint: "Scales the Temporal Rift animation. 100 = default size.",
    scope: "world", config: false, type: Number, default: 100,
  });

  // Timeships can warp through a Temporal Rift instead of the standard flash.
  // The rift is a much longer clip, so the moment the ship actually vanishes or
  // materialises has to be tunable independently of the flash's fixed 750ms —
  // the asset can be re-authored without touching code.
  game.settings.register("sta2e-toolkit", "warpRiftPeakMs", {
    name: "Temporal Rift Peak (ms)",
    hint: "When the rift aperture is widest — the moment a timeship vanishes or materialises. Keep this shorter than the Temporal-Rift clip itself.",
    scope: "world", config: false, type: Number, default: 2500,
  });

  // One key for both ends: a rift is a single continuous portal event rather
  // than the boom-then-drop-out pair a warp jump is. Blank falls back to the
  // normal warp sounds, so an unconfigured rift is never silent.
  game.settings.register("sta2e-toolkit", "sndTemporalRift", {
    name: "Temporal Rift Sound",
    hint: "Audio file played at both ends of a timeship's rift transit. Blank uses the Warp Depart / Warp Arrive sounds.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // The Cardassian rift is a separately authored clip with its own margins and
  // its own decisive frame, so it gets its own trio rather than sharing the
  // Federation rift's — the same reason warpRiftScale was split off
  // warpFlashScale. Only ships resolved as Cardassian ever read these.
  game.settings.register("sta2e-toolkit", "warpCardassianRiftScale", {
    name: "Cardassian Rift Size (%)",
    hint: "Scales the Cardassian Temporal Rift animation. 100 = default size.",
    scope: "world", config: false, type: Number, default: 100,
  });

  game.settings.register("sta2e-toolkit", "warpCardassianRiftPeakMs", {
    name: "Cardassian Rift Peak (ms)",
    hint: "When the Cardassian rift aperture is widest — the moment the ship vanishes or materialises. Keep this shorter than the Cardassian-Temporal-Rift clip itself.",
    scope: "world", config: false, type: Number, default: 2500,
  });

  game.settings.register("sta2e-toolkit", "sndCardassianTemporalRift", {
    name: "Cardassian Rift Sound",
    hint: "Audio file played at both ends of a Cardassian timeship's rift transit. Blank uses the Warp Depart / Warp Arrive sounds.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // Ship spawner dialog state. Per-client so two GMs do not fight over the
  // formation they each prefer; config:false because the dialog is the UI.
  game.settings.register("sta2e-toolkit", "shipSpawnerPrefs", {
    scope: "client", config: false, type: Object,
    default: { pattern: "circle", spacing: 350, snap: true, delay: 300, location: "canvas" },
  });

  // Spawn window shell state — which tab was last in front, where the window
  // sits, and each tab's last spawn site. Per-client for the same reason as the
  // spawner's own prefs.
  game.settings.register("sta2e-toolkit", "spawnWindowPrefs", {
    scope: "client", config: false, type: Object,
    default: {
      activeTab: "transporter", pos: null,
      transporterLocation: "canvas", qLocation: "canvas",
    },
  });

  // ── Q spawner ───────────────────────────────────────────────────────────────

  // Whoever Q has taken out of the scene. World-scoped like the transporter's
  // pattern buffer, and deliberately a separate setting: restoring one must
  // never disturb the other.
  game.settings.register("sta2e-toolkit", "qHoldBuffer", {
    scope: "world", config: false, type: Array, default: [],
  });

  game.settings.register("sta2e-toolkit", "qFlashScale", {
    name: "Q Flash Size",
    hint: "Percent size of the Q flash relative to the token it plays on. 100 matches the standard warp flash.",
    scope: "world", config: false, type: Number, default: 100,
  });

  game.settings.register("sta2e-toolkit", "qFlashPeakMs", {
    name: "Q Flash Peak (ms)",
    hint: "When the flash's decisive frame lands — the moment a token appears or vanishes. Lower is snappier.",
    scope: "world", config: false, type: Number, default: 450,
  });

  // The white wash across the board. Separate from the per-token flash above so
  // a table that finds full-screen flashes uncomfortable can set this to 0 and
  // still get the bursts.
  game.settings.register("sta2e-toolkit", "qScreenFlashIntensity", {
    name: "Q Screen Flash Intensity (%)",
    hint: "Peak whiteness of the board-wide flash. 0 turns the screen flash off entirely; the per-token flashes still play.",
    scope: "world", config: false, type: Number, default: 75,
  });

  game.settings.register("sta2e-toolkit", "qScreenFlashMs", {
    name: "Q Screen Flash Duration (ms)",
    hint: "How long the board-wide flash takes to rise, hold and fade.",
    scope: "world", config: false, type: Number, default: 500,
  });

  // Q Flash Kick — the throw across the scene. Distance is not a setting: it is
  // always as far as the scene goes in that direction.
  game.settings.register("sta2e-toolkit", "qKickMs", {
    name: "Q Kick Flight (ms)",
    hint: "How long the throw takes from the flash to the landing. Most of the distance is covered in the first quarter of it; the rest is the tumble.",
    scope: "world", config: false, type: Number, default: 2600,
  });

  game.settings.register("sta2e-toolkit", "qKickSpins", {
    name: "Q Kick Spins",
    hint: "Full rotations the token makes on the way out. Clamped against the flight length — too many for the time available would visibly stutter.",
    scope: "world", config: false, type: Number, default: 3,
  });

  game.settings.register("sta2e-toolkit", "sndQFlashIn", {
    name: "Q Flash — Arrive Sound",
    hint: "Audio file played when Q brings someone into the scene. Blank is silent.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  game.settings.register("sta2e-toolkit", "sndQFlashOut", {
    name: "Q Flash — Depart Sound",
    hint: "Audio file played when Q removes someone from the scene. Blank is silent.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // ── Warp Viewscreen ──────────────────────────────────────────────────────
  // The Region behavior that renders a warp starfield inside a viewscreen or
  // window drawn into the map art. Sounds play locally on every client from the
  // behavior's update hook, so none of these are broadcast.
  game.settings.register("sta2e-toolkit", "sndWarpViewscreenEnter", {
    name: "Warp Viewscreen — Enter Warp Sound",
    hint: "Audio file played when the viewscreen jumps to warp. Blank is silent.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  game.settings.register("sta2e-toolkit", "sndWarpViewscreenExit", {
    name: "Warp Viewscreen — Drop Out Sound",
    hint: "Audio file played when the viewscreen falls back to sublight. Blank is silent.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  game.settings.register("sta2e-toolkit", "sndWarpViewscreenLoop", {
    name: "Warp Viewscreen — Warp Loop",
    hint: "Looping rumble held for as long as the viewscreen is at warp. Blank is silent.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // The GM's saved look presets, managed entirely from the viewscreen panel:
  // { entries: [ { id, label, environment, isDefault, look: {...} } ] }.
  // World-scoped so one library serves every region on every scene and a co-GM
  // sees the same presets. Normalized on every read by viewscreen-presets.js,
  // which is what lets the default here be a bare empty list.
  game.settings.register("sta2e-toolkit", VIEWSCREEN_PRESET_SETTING, {
    name:   "Warp Viewscreen — Look Presets",
    hint:   "Saved appearance presets per travel environment. Managed from the Warp Viewscreen panel.",
    scope:  "world", config: false, type: Object, default: { entries: [] },
  });

  game.settings.register("sta2e-toolkit", "warpViewscreenEnterMs", {
    name: "Warp Viewscreen — Enter Ramp",
    hint: "How long the stars take to stretch from sublight to full warp, in milliseconds.",
    scope: "world", config: false, type: Number, default: 2000,
  });

  game.settings.register("sta2e-toolkit", "warpViewscreenExitMs", {
    name: "Warp Viewscreen — Exit Ramp",
    hint: "How long the stars take to settle back to sublight, in milliseconds.",
    scope: "world", config: false, type: Number, default: 1600,
  });

  game.settings.register("sta2e-toolkit", "warpViewscreenStarSpeed", {
    name: "Warp Viewscreen — Star Speed",
    hint: "Percent trim on the whole star field, sublight drift included. Raise it if warp reads too sedate on a large viewscreen.",
    scope: "world", config: false, type: Number, default: 100,
  });

  // Per-environment audio, generated from the environment table rather than
  // written out, so adding a travel environment brings its own three sound slots
  // with it and stays a one-file change. Warp is skipped: its descriptor names
  // the three keys registered immediately above, which predate the table and
  // which every other environment falls back to when its own slot is blank.
  for (const env of environmentSoundKeys()) {
    if (env.legacy) continue;
    const rows = [
      [env.enter, "Enter",     `Played when the viewscreen enters ${env.label}.`],
      [env.exit,  "Leave",     `Played when the viewscreen leaves ${env.label}.`],
      [env.loop,  "Ambience",  `Looping bed held for as long as the viewscreen shows ${env.label}.`],
    ];
    for (const [key, beat, hint] of rows) {
      game.settings.register("sta2e-toolkit", key, {
        name: `Viewscreen: ${env.label} — ${beat}`,
        hint: `${hint} Blank falls back to the plain Warp Viewscreen sound above.`,
        scope: "world", config: false, type: String, default: "", filePicker: "audio",
      });
    }
  }

  // ── Scene Warp ───────────────────────────────────────────────────────────
  // The top-down streak field that puts a whole tactical scene at warp. Unlike
  // the viewscreen above this has no sounds of its own — the GM drives it from
  // the Scene Warp panel, and the ships supply their own audio.
  game.settings.register("sta2e-toolkit", "sceneWarpEnterMs", {
    name: "Scene Warp — Enter Ramp",
    hint: "How long the field takes to stretch from a standstill to full warp, in milliseconds.",
    scope: "world", config: false, type: Number, default: 2600,
  });

  game.settings.register("sta2e-toolkit", "sceneWarpExitMs", {
    name: "Scene Warp — Exit Ramp",
    hint: "How long the field takes to settle back to sublight, in milliseconds.",
    scope: "world", config: false, type: Number, default: 2000,
  });

  // Client scope on purpose: frame rate is a per-machine problem. A player on a
  // laptop needs to turn this down for themselves without the GM deciding it for
  // the whole table, which a scene flag would do. It can only ever reduce what
  // the scene's own Star Count and band toggles ask for.
  game.settings.register("sta2e-toolkit", "sceneWarpQuality", {
    name: "Scene Warp — Quality (this device)",
    hint: "How much of the warp star field this device draws. Lower it if the frame rate "
        + "dips while at warp — especially alongside 3D dice. Affects only your own view.",
    scope: "client", config: true, type: String, default: "high",
    choices: {
      high:   "High — full field, streaks over tokens",
      medium: "Medium — about half the stars, none over tokens",
      low:    "Low — sparse field, two depth bands",
    },
    onChange: () => {
      // Rebuild this client's pools immediately rather than at the next scene
      // update, so the setting reads as instant.
      import("./scene-warp-vfx.js").then(m => m.syncSceneWarp()).catch(() => { /* canvas not up */ });
    },
  });

  game.settings.register("sta2e-toolkit", "sceneWarpStarSpeed", {
    name: "Scene Warp — Star Speed",
    hint: "Percent trim on the whole field, sublight drift included. Raise it if warp reads too sedate on a large scene.",
    scope: "world", config: false, type: Number, default: 100,
  });

  // Tractor beam sound
  game.settings.register("sta2e-toolkit", "sndTractorBeam", {
    name: "Tractor Beam — Engage Sound",
    hint: "Audio file played when the tractor beam locks onto a target.",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
  });

  // ── Animation timing ─────────────────────────────────────────────────────
  // Delay (ms) between weapon fire and impact animation. Managed via the
  // "Sounds & Animations" config menu (EffectConfigMenu).

  game.settings.register("sta2e-toolkit", "timingBeamTravel", {
    name: "Beam Travel Time (ms)",
    hint: "Milliseconds between beam fire and impact animation for ship beams and ground phaser.",
    scope: "world", config: false, type: Number, default: 3800,
  });

  game.settings.register("sta2e-toolkit", "timingGroundBeamTravel", {
    name: "Ground Short Beam Travel Time (ms)",
    hint: "Milliseconds between fire and impact for ground disruptor, plasma, and generic beams.",
    scope: "world", config: false, type: Number, default: 600,
  });

  game.settings.register("sta2e-toolkit", "timingTorpedoImpact", {
    name: "Torpedo Impact Delay (ms)",
    hint: "Milliseconds between torpedo launch and explosion animation.",
    scope: "world", config: false, type: Number, default: 1000,
  });

  // ── Animation overrides & custom weapon effects ───────────────────────────
  // Managed via the "Sounds & Animations" config menu (EffectConfigMenu).

  game.settings.register("sta2e-toolkit", TRACTOR_BEAM_WORLD_SETTING, {
    name: "Tractor Beam VFX World Defaults",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register("sta2e-toolkit", TRACTOR_BEAM_RENDERER_SETTING, {
    name: "Tractor Beam Animation Renderer",
    hint: "Choose the persistent live tractor-beam visual. JB2A uses the configured Sequencer asset; PIXI draws a native beam from the host emitter to the target's facing hull edge.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      jb2a: "JB2A / Sequencer",
      pixi: "Native PIXI",
    },
    default: "jb2a",
  });

  game.settings.register("sta2e-toolkit", TRACTOR_BEAM_CLIENT_SETTING, {
    name: "Tractor Beam VFX Client Overrides",
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register("sta2e-toolkit", "animationOverrides", {
    name:    "Animation Overrides",
    scope:   "world",
    config:  false,
    type:    Object,
    default: { shipWeapons: {}, groundWeapons: {}, shipTasks: {}, groundTasks: {}, transporter: {} },
  });

  game.settings.register("sta2e-toolkit", "customWeaponEffects", {
    name:    "Custom Weapon Effects",
    scope:   "world",
    config:  false,
    type:    Object,
    default: { groundWeapons: [], shipWeapons: [] },
  });

  game.settings.register("sta2e-toolkit", "weaponAnimationModes", {
    name:    "Weapon Animation Modes",
    scope:   "world",
    config:  false,
    type:    Object,
    default: { ...NATIVE_WEAPON_VFX_DEFAULT_MODES },
  });

  game.settings.register("sta2e-toolkit", "beamVfxAppearance", {
    name:    "Native Beam VFX Appearance",
    hint:    "Managed from Sounds & Animations → Beam VFX.",
    scope:   "world",
    config:  false,
    type:    Object,
    default: foundry.utils.deepClone(DEFAULT_BEAM_VFX_SETTINGS),
  });

  game.settings.register("sta2e-toolkit", "groundPhaserEra", {
    name:    "Ground Phaser Era",
    hint:    "Which era's colour and sound hand phasers use. Auto follows the active campaign's "
      + "era (TOS, ENT or TNG), and falls back to TNG for eras that name no phaser of their own. "
      + "TMP has no campaign era, so pick it here — or force any era on a single weapon from that "
      + "item's sheet, which always wins over this setting.",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      auto: "Auto (follow campaign era)",
      ent:  "ENT",
      tos:  "TOS",
      tmp:  "TMP",
      tng:  "TNG/DS9/VOY",
    },
    default: "auto",
  });

  game.settings.register("sta2e-toolkit", "regionSplineSmoothness", {
    name:    "Region Curve Smoothness",
    hint:    "How finely the Regions layer's Curve tool tessellates. Samples are spread by span "
      + "length rather than spread evenly, so a span running the width of the map gets more "
      + "points than one shorter than a grid square. Raise it if a large curve looks faceted, "
      + "lower it if a scene full of curved Regions feels heavy. World scope, because it "
      + "determines the geometry that gets saved.",
    scope:   "world",
    config:  true,
    type:    Number,
    range:   { min: 4, max: 24, step: 1 },
    default: 12,
  });
}
