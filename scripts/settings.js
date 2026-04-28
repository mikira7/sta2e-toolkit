/**
 * sta2e-toolkit | settings.js
 */

import { EffectConfigMenu } from "./effect-config.js";
import { WildcardNamerConfig } from "./wildcard-namer.js";

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

  game.settings.register("sta2e-toolkit", "deleteTokenOnDestruction", {
    name:    "STA2E.Settings.DeleteTokenOnDestruction.Name",
    hint:    "STA2E.Settings.DeleteTokenOnDestruction.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // ── Token Magic FX — breach damage visuals ──────────────────────────────
  game.settings.register("sta2e-toolkit", "breachTokenFX", {
    name:    "STA2E.Settings.BreachTokenFX.Name",
    hint:    "STA2E.Settings.BreachTokenFX.Hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
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

  // Warp effect sound
  game.settings.register("sta2e-toolkit", "sndWarpEngage", {
    name: "Warp Sound — Engage",
    hint: "Audio file played when the warp engage animation fires (the 'flash' sound).",
    scope: "world", config: false, type: String, default: "", filePicker: "audio"
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
}
