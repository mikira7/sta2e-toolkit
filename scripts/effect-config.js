/**
 * sta2e-toolkit | effect-config.js
 * Sounds & Animations configuration menu — ApplicationV2, Foundry v13 native.
 */

import {
  BEAM_VFX_BLEND_OPTIONS,
  BEAM_VFX_EASING_OPTIONS,
  BEAM_VFX_TRACER_ERA_OPTIONS,
  DEFAULT_BEAM_VFX_SETTINGS,
  NATIVE_WEAPON_VFX_MODE_ROWS,
  getBeamVfxSettings,
  normalizeBeamVfxSettings,
  normalizeWeaponAnimationModes,
  previewBeamVfxAppearance,
} from "./native-weapon-vfx.js";
import {
  TORPEDO_TYPES,
  getTorpedoCountConfig,
  ENERGY_WEAPON_FAMILIES,
  getEnergyWeaponCountConfig,
  getArrayAreaShotCap,
  ARRAY_AREA_SHOT_CAP_DEFAULT,
} from "./weapon-configs.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE = "sta2e-toolkit";

// ── Default path helpers ─────────────────────────────────────────────────────

/** Returns true when the user has JB2A Patron installed. */
function _isPatron() {
  try { return game.settings.get(MODULE, "jb2aTier") === "patron"; }
  catch { return false; }
}

/**
 * Build a human-readable hint showing the current JB2A default for an animation slot.
 * Shows the patron path when jb2aTier === "patron", otherwise the free path.
 */
function jb2aHint(patronPath, freePath) {
  return _isPatron() ? `Default (Patron): ${patronPath}` : `Default (Free): ${freePath}`;
}

// Shared default path fragments (avoids repeating long strings)
const _FREE = "modules/JB2A_DnD5e/Library/Generic";
const _PAT  = "modules/jb2a_patreon/Library/Generic";
const _WA   = `${_FREE}/Weapon_Attacks/Ranged`;
const _WM   = `${_FREE}/Weapon_Attacks/Melee`;
const _SHIP_PHASER_BEAM = `${_FREE}/RangedSpell/Beam/Beam002_03_Regular_Orange_90ft_4000x400.webm`;
const _IMP  = `${_FREE}/Impact/Impact013/Impact013_001_OrangeYellow_400x400.webm`;
const _EXP_O = `${_FREE}/Explosion/Explosion_01_Orange_400x400.webm`;
const _EXP_B = `${_FREE}/Explosion/Explosion_02_Blue_400x400.webm`;
const _CRACK = `${_FREE}/Impact/Impact013/Impact013_001_OrangeYellow_400x400.webm`;

// ── Tab definitions ─────────────────────────────────────────────────────────

/**
 * Each tab: { id, label, icon, rows[], customKey }
 * Each row: { label, slot, sndKey, animKey }
 *   sndKey  → game.settings key for the sound path
 *   animKey → dot-path into animationOverrides (e.g. "shipWeapons.phaser.animHit")
 *             null if no animation override for this slot
 */
function buildPhaserEraSoundRows() {
  const eras = [
    { key: "Ent", label: "ENT" },
    { key: "Tos", label: "TOS" },
    { key: "Tmp", label: "TMP" },
    { key: "Tng", label: "TNG/DS9/VOY" },
  ];
  const types = [
    { key: "Bank",   label: "Bank" },
    { key: "Array",  label: "Array" },
    { key: "Cannon", label: "Cannon" },
    { key: "Lance",  label: "Spinal Lance" },
  ];
  const results = ["Hit", "Miss"];
  return eras.flatMap(era => types.flatMap(type => {
    const rows = results.map(result => ({
      label: `Phaser ${type.label} - ${era.label}`,
      slot: result,
      sndKey: `sndShipPhaser${type.key}${era.key}${result}`,
      animKey: null,
      defaultHint: "Blank uses the base phaser sound for this weapon type.",
    }));
    // Only arrays fire multi-strike volleys with a single opening charge-up.
    if (type.key === "Array") {
      rows.push({
        label: `Phaser ${type.label} - ${era.label}`,
        slot: "Additional Strikes",
        sndKey: `sndShipPhaserArray${era.key}Repeat`,
        animKey: null,
        defaultHint: "Blank uses the generic array follow-up sound, then the base phaser sound.",
      });
    }
    return rows;
  }));
}

function buildTabDefs() {
  return [
    {
      id:    "shipWeapons",
      label: "Ship Weapons",
      customKey: "shipWeapons",
      nativeModeRows: NATIVE_WEAPON_VFX_MODE_ROWS,
      rows: [
        // ── Phaser / Phase-Pulse ───────────────────────────────────────────
        { label: "Phaser / Phase-Pulse", slot: "Beam (Hit)",    sndKey: "sndShipPhaserHit",   animKey: "shipWeapons.phaser.animHit",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Orange_90ft_4000x400.webm`, _SHIP_PHASER_BEAM) },
        { label: "Phaser / Phase-Pulse", slot: "Impact (Hit)",  sndKey: null,                 animKey: "shipWeapons.phaser.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.blue", _IMP) },
        { label: "Phaser / Phase-Pulse", slot: "Beam (Miss)",   sndKey: "sndShipPhaserMiss",  animKey: "shipWeapons.phaser.animMiss",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Orange_90ft_4000x400.webm`, _SHIP_PHASER_BEAM) },
        // ── Disruptor ──────────────────────────────────────────────────────
        { label: "Disruptor",            slot: "Beam (Hit)",    sndKey: "sndShipDisruptorHit",  animKey: "shipWeapons.disruptor.animHit",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Green_90ft_4000x400.webm`, `${_FREE}/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`) },
        { label: "Disruptor",            slot: "Impact (Hit)",  sndKey: null,                   animKey: "shipWeapons.disruptor.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.green", _IMP) },
        { label: "Disruptor",            slot: "Beam (Miss)",   sndKey: "sndShipDisruptorMiss", animKey: "shipWeapons.disruptor.animMiss",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Green_90ft_4000x400.webm`, `${_FREE}/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`) },
        // ── Polaron ────────────────────────────────────────────────────────
        { label: "Polaron",              slot: "Beam (Hit)",    sndKey: "sndShipPolaronHit",    animKey: "shipWeapons.polaron.animHit",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Purple_90ft_4000x400.webm`, `${_FREE}/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`) },
        { label: "Polaron",              slot: "Impact (Hit)",  sndKey: null,                   animKey: "shipWeapons.polaron.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.purple", _IMP) },
        { label: "Polaron",              slot: "Beam (Miss)",   sndKey: "sndShipPolaronMiss",   animKey: "shipWeapons.polaron.animMiss",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Purple_90ft_4000x400.webm`, `${_FREE}/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`) },
        // ── Arrays ─────────────────────────────────────────────────────────
        // An array volley charges up once, then keeps firing. The follow-up
        // strikes can use their own audio instead of replaying the charge.
        { label: "Array (any type)",     slot: "Additional Strikes", sndKey: "sndShipArrayRepeat", animKey: null,
          defaultHint: "Blank uses the weapon's normal hit sound for the 2nd and later strikes." },
        // ── Spinal Lance ───────────────────────────────────────────────────
        // Lances share the beam VFX; only the sound differs. Blank = beam sound.
        { label: "Phaser Spinal Lance",    slot: "Beam (Hit)",  sndKey: "sndShipLancePhaserHit",     animKey: null,
          defaultHint: "Blank uses the Phaser beam (hit) sound." },
        { label: "Phaser Spinal Lance",    slot: "Beam (Miss)", sndKey: "sndShipLancePhaserMiss",    animKey: null,
          defaultHint: "Blank uses the Phaser beam (miss) sound." },
        { label: "Disruptor Spinal Lance", slot: "Beam (Hit)",  sndKey: "sndShipLanceDisruptorHit",  animKey: null,
          defaultHint: "Blank uses the Disruptor beam (hit) sound." },
        { label: "Disruptor Spinal Lance", slot: "Beam (Miss)", sndKey: "sndShipLanceDisruptorMiss", animKey: null,
          defaultHint: "Blank uses the Disruptor beam (miss) sound." },
        { label: "Polaron Spinal Lance",   slot: "Beam (Hit)",  sndKey: "sndShipLancePolaronHit",    animKey: null,
          defaultHint: "Blank uses the Polaron beam (hit) sound." },
        { label: "Polaron Spinal Lance",   slot: "Beam (Miss)", sndKey: "sndShipLancePolaronMiss",   animKey: null,
          defaultHint: "Blank uses the Polaron beam (miss) sound." },
        // ── Phaser Cannon ──────────────────────────────────────────────────
        { label: "Phaser Cannon",        slot: "Shot (Hit)",    sndKey: "sndShipCannonPhaserHit",   animKey: "shipWeapons.phaserCannon.animHit",
          defaultHint: jb2aHint("jb2a.lasershot.orange", `${_WA}/LaserShot_01_Regular_Orange_30ft_1600x400.webm`) },
        { label: "Phaser Cannon",        slot: "Impact (Hit)",  sndKey: null,                       animKey: "shipWeapons.phaserCannon.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.blue", _IMP) },
        { label: "Phaser Cannon",        slot: "Shot (Miss)",   sndKey: "sndShipCannonPhaserMiss",  animKey: "shipWeapons.phaserCannon.animMiss",
          defaultHint: jb2aHint("jb2a.lasershot.orange", `${_WA}/LaserShot_01_Regular_Orange_30ft_1600x400.webm`) },
        ...buildPhaserEraSoundRows(),
        // ── Disruptor Cannon ───────────────────────────────────────────────
        { label: "Disruptor Cannon",     slot: "Shot (Hit)",    sndKey: "sndShipCannonDisruptorHit",   animKey: "shipWeapons.disruptorCannon.animHit",
          defaultHint: jb2aHint("jb2a.lasershot.green", `${_WA}/LaserShot_01_Regular_Green_30ft_1600x400.webm`) },
        { label: "Disruptor Cannon",     slot: "Impact (Hit)",  sndKey: null,                          animKey: "shipWeapons.disruptorCannon.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.green", _IMP) },
        { label: "Disruptor Cannon",     slot: "Shot (Miss)",   sndKey: "sndShipCannonDisruptorMiss",  animKey: "shipWeapons.disruptorCannon.animMiss",
          defaultHint: jb2aHint("jb2a.lasershot.green", `${_WA}/LaserShot_01_Regular_Green_30ft_1600x400.webm`) },
        // ── Polaron Cannon ─────────────────────────────────────────────────
        { label: "Polaron Cannon",       slot: "Shot (Hit)",    sndKey: "sndShipCannonPolaronHit",   animKey: "shipWeapons.polaronCannon.animHit",
          defaultHint: jb2aHint("jb2a.lasershot.purple", `${_WA}/LaserShot_01_Regular_Blue_30ft_1600x400.webm`) },
        { label: "Polaron Cannon",       slot: "Impact (Hit)",  sndKey: null,                        animKey: "shipWeapons.polaronCannon.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.purple", _IMP) },
        { label: "Polaron Cannon",       slot: "Shot (Miss)",   sndKey: "sndShipCannonPolaronMiss",  animKey: "shipWeapons.polaronCannon.animMiss",
          defaultHint: jb2aHint("jb2a.lasershot.purple", `${_WA}/LaserShot_01_Regular_Blue_30ft_1600x400.webm`) },
        // ── Torpedoes ──────────────────────────────────────────────────────
        { label: "Photon Torpedo",       slot: "Projectile",    sndKey: "sndShipTorpedoPhoton",       animKey: "shipWeapons.photonTorpedo.anim",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Bullet_03_Regular_Red_90ft_4000x400.webm`, `${_WA}/Bullet_01_Regular_Orange_90ft_4000x400.webm`) },
        { label: "Photon Torpedo",       slot: "Explosion",     sndKey: null,                         animKey: "shipWeapons.photonTorpedo.animExplosion",
          defaultHint: jb2aHint("jb2a.explosion.08.orange", _EXP_O) },
        { label: "Photon Torpedo Salvo", slot: "Projectile",    sndKey: "sndShipTorpedoPhotonSalvo",  animKey: null, defaultHint: null },
        { label: "Quantum Torpedo",      slot: "Projectile",    sndKey: "sndShipTorpedoQuantum",      animKey: "shipWeapons.quantumTorpedo.anim",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Bullet_03_Regular_Blue_90ft_4000x400.webm`, `${_WA}/Bullet_03_Regular_Blue_90ft_4000x400.webm`) },
        { label: "Quantum Torpedo",      slot: "Explosion",     sndKey: null,                         animKey: "shipWeapons.quantumTorpedo.animExplosion",
          defaultHint: jb2aHint("jb2a.explosion.08.blue", _EXP_B) },
        { label: "Quantum Torpedo Salvo",slot: "Projectile",    sndKey: "sndShipTorpedoQuantumSalvo", animKey: null, defaultHint: null },
        { label: "Plasma Torpedo",       slot: "Projectile",    sndKey: "sndShipTorpedoPlasma",       animKey: "shipWeapons.plasmaTorpedo.anim",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Bullet_03_Regular_Green_90ft_4000x400.webm`, `${_WA}/Missile01_01_Regular_Blue_90ft_4000x400.webm`) },
        { label: "Plasma Torpedo",       slot: "Explosion",     sndKey: null,                         animKey: "shipWeapons.plasmaTorpedo.animExplosion",
          defaultHint: jb2aHint("jb2a.explosion.08.green", _EXP_O) },
        { label: "Plasma Torpedo Salvo", slot: "Projectile",    sndKey: "sndShipTorpedoPlasmasSalvo", animKey: null, defaultHint: null },
        // ── Timing ────────────────────────────────────────────────────────
        { label: "Beam travel time",     slot: "ms", sndKey: null, animKey: null,
          delayKey: "timingBeamTravel",
          defaultHint: "Default: 3800 ms — also used by ground phaser beam" },
        { label: "Torpedo impact delay", slot: "ms", sndKey: null, animKey: null,
          delayKey: "timingTorpedoImpact",
          defaultHint: "Default: 1000 ms" },
      ],
    },
    {
      id:    "groundWeapons",
      label: "Ground Weapons",
      customKey: "groundWeapons",
      rows: [
        // ── Phaser ─────────────────────────────────────────────────────────
        { label: "Phaser",               slot: "Beam (Hit)",   sndKey: "sndGroundPhaserHit",    animKey: "groundWeapons.phaser.animHit",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Orange_90ft_4000x400.webm`, `${_FREE}/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`) },
        { label: "Phaser",               slot: "Impact (Hit)", sndKey: null,                    animKey: "groundWeapons.phaser.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.blue", _IMP) },
        { label: "Phaser",               slot: "Beam (Miss)",  sndKey: "sndGroundPhaserMiss",   animKey: "groundWeapons.phaser.animMiss",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Orange_90ft_4000x400.webm`, `${_FREE}/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`) },
        // ── Disruptor ──────────────────────────────────────────────────────
        { label: "Disruptor",            slot: "Beam (Hit)",   sndKey: "sndGroundDisruptorHit",  animKey: "groundWeapons.disruptor.animHit",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Green_90ft_4000x400.webm`, `${_WA}/LaserShot_01_Regular_Green_30ft_1600x400.webm`) },
        { label: "Disruptor",            slot: "Impact (Hit)", sndKey: null,                     animKey: "groundWeapons.disruptor.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.green", _IMP) },
        { label: "Disruptor",            slot: "Beam (Miss)",  sndKey: "sndGroundDisruptorMiss", animKey: "groundWeapons.disruptor.animMiss",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Green_90ft_4000x400.webm`, `${_WA}/LaserShot_01_Regular_Green_30ft_1600x400.webm`) },
        // ── Plasma / Particle ──────────────────────────────────────────────
        { label: "Plasma / Particle",    slot: "Beam (Hit)",   sndKey: "sndGroundPlasmaHit",     animKey: "groundWeapons.plasma.animHit",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Purple_90ft_4000x400.webm`, `${_WA}/Bullet_03_Regular_Blue_90ft_4000x400.webm`) },
        { label: "Plasma / Particle",    slot: "Impact (Hit)", sndKey: null,                     animKey: "groundWeapons.plasma.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.purple", _IMP) },
        // ── Generic Ranged ─────────────────────────────────────────────────
        { label: "Generic Ranged",       slot: "Beam (Hit)",   sndKey: "sndGroundGenericHit",    animKey: "groundWeapons.generic.animHit",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Blue_90ft_4000x400.webm`, `${_WA}/Bullet_03_Regular_Blue_90ft_4000x400.webm`) },
        { label: "Generic Ranged",       slot: "Impact (Hit)", sndKey: null,                     animKey: "groundWeapons.generic.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.blue", _IMP) },
        // ── Grenade ────────────────────────────────────────────────────────
        { label: "Grenade",              slot: "Explosion",    sndKey: "sndGroundGrenade",       animKey: "groundWeapons.grenade.animExplosion",
          defaultHint: jb2aHint("jb2a.explosion.08.orange", _EXP_O) },
        // ── Melee ──────────────────────────────────────────────────────────
        { label: "Melee",                slot: "Strike (Hit)", sndKey: "sndGroundMeleeHit",      animKey: "groundWeapons.melee.animHit",
          defaultHint: jb2aHint("jb2a.sword.melee.01.white", `${_WM}/Group01/MeleeAttack01_ShortSword01_02_800x600.webm`) },
        { label: "Melee",                slot: "Impact (Hit)", sndKey: null,                     animKey: "groundWeapons.melee.animImpact",
          defaultHint: jb2aHint("jb2a.impact.ground_crack.still_frame.01", _CRACK) },
        { label: "Melee",                slot: "Strike (Miss)",sndKey: "sndGroundMeleeMiss",     animKey: "groundWeapons.melee.animMiss",
          defaultHint: jb2aHint("jb2a.sword.melee.01.white", `${_WM}/Group01/MeleeAttack01_ShortSword01_02_800x600.webm`) },
        // ── Anesthetic Hypospray ───────────────────────────────────────────
        { label: "Anesthetic Hypospray", slot: "Use",          sndKey: "sndGroundHypospray",     animKey: "groundTasks.hypospray.anim",
          defaultHint: `Default: modules/JB2A_DnD5e/Library/Generic/Conditions/Boon01/ConditionBoon01_018_Green_600x600.webm` },
        // ── Timing ────────────────────────────────────────────────────────
        { label: "Short beam travel time", slot: "ms", sndKey: null, animKey: null,
          delayKey: "timingGroundBeamTravel",
          defaultHint: "Default: 600 ms — disruptor, plasma, generic (phaser uses beam travel time above)" },
      ],
    },
    {
      id:    "torpedoCounts",
      label: "Torpedoes",
      customKey: null,
      torpedoCounts: true,
      rows: [],
    },
    {
      id:    "energyWeaponCounts",
      label: "Energy Weapons",
      customKey: null,
      energyWeaponCounts: true,
      rows: [],
    },
    {
      id:    "beamVfx",
      label: "Beam VFX",
      customKey: null,
      beamVfx: true,
      rows: [],
    },
    {
      id:    "shipTasks",
      label: "Ship Tasks",
      customKey: null,
      rows: [
        { label: "Scan for Weakness",      slot: "", sndKey: "sndScanForWeakness", animKey: "shipTasks.scanForWeakness.anim",
          defaultHint: jb2aHint("jb2a.template_circle.radar.loop.800px.001.sweep.blue", "jb2a.extras.tmfx.radar.circle.pulse.01.normal") },
        { label: "Attack Pattern",         slot: "", sndKey: "sndAttackPattern",   animKey: "shipTasks.attackPattern.anim",
          defaultHint: "Default: jb2a.cast_generic.fire.01.orange" },
        { label: "Evasive Action",         slot: "", sndKey: "sndEvasiveAction",   animKey: "shipTasks.evasiveAction.anim",
          defaultHint: "Default: jb2a.zoning.inward.circle.once.bluegreen.01.01" },
        { label: "Defensive Fire",         slot: "", sndKey: "sndDefensiveFire",   animKey: "shipTasks.defensiveFire.anim",  defaultHint: null },
        { label: "Ram",                    slot: "", sndKey: "sndRam",             animKey: null,                            defaultHint: null },
        { label: "Ship Destroyed",         slot: "", sndKey: "sndShipDestroyed",   animKey: "shipTasks.destruction.anim",
          defaultHint: jb2aHint("jb2a.explosion.01.orange + jb2a.explosion.08.orange", `${_EXP_O} (multiple stages)`) },
        { label: "Cloaking Device",        slot: "", sndKey: "sndCloak",           animKey: null, defaultHint: null },
        { label: "Decloaking",             slot: "", sndKey: "sndDecloak",         animKey: null, defaultHint: null },
        { label: "Warp Core Breach Trail", slot: "", sndKey: null,                 animKey: "shipTasks.warpCoreBreach.anim",
          defaultHint: "Default: jb2a.fumes.steam.white" },
        { label: "Tractor Beam",           slot: "Sound",     sndKey: "sndTractorBeam",         animKey: null, defaultHint: null },
        { label: "Tractor Beam",           slot: "Animation", sndKey: null,                     animKey: "shipTasks.tractorBeam.anim",
          defaultHint: "Default: jb2a.energy_conduit.bluepurple.circle.01" },
        { label: "Impulse — Engage",       slot: "", sndKey: "sndImpulseEngage",   animKey: null, defaultHint: null },
        { label: "Warp — Depart (Boom)",   slot: "", sndKey: "sndWarpEngage",      animKey: "shipTasks.warpDepart.anim",
          defaultHint: jb2aHint("jb2a.impact.007.white", "jb2a.impact.007.yellow") },
        { label: "Warp — Arrive",          slot: "", sndKey: "sndWarpArrive",      animKey: "shipTasks.warpArrive.anim",
          defaultHint: jb2aHint("jb2a.impact.007.white", "jb2a.impact.007.yellow") },
        { label: "Warp — Corridor",        slot: "", sndKey: null,                 animKey: "shipTasks.warpCorridor.anim",
          defaultHint: jb2aHint(
            "jb2a.energy_strands.range.standard.blue.04.90ft",
            "jb2a.energy_strands.range.standard.purple.04.90ft (tinted toward blue)"
          ) + " — stretched between the departure and arrival points, so this must be a ranged asset. Setting your own file drops the tint." },
        { label: "Warp — Corridor max wait", slot: "ms", sndKey: null,               animKey: null,
          delayKey: "timingWarpCorridor",
          defaultHint: "Default: 2000 ms — the ship waits for the corridor animation to actually finish before dropping out of warp; this only caps that wait. Lower it if the arrival feels slow." },
        { label: "Red Alert (TNG/DS9/VOY)",slot: "", sndKey: "alertSoundRedTNG",   animKey: null, defaultHint: null },
        { label: "Red Alert (TOS/TMP)",    slot: "", sndKey: "alertSoundRedTOS",   animKey: null, defaultHint: null },
        { label: "Red Alert (ENT)",        slot: "", sndKey: "alertSoundRedENT",   animKey: null, defaultHint: null },
        { label: "Blue Alert (TNG/DS9/VOY)",slot:"", sndKey: "alertSoundBlueTNG", animKey: null, defaultHint: null },
        { label: "Blue Alert (TOS/TMP)",   slot: "", sndKey: "alertSoundBlueTOS",  animKey: null, defaultHint: null },
        { label: "Blue Alert (ENT)",       slot: "", sndKey: "alertSoundBlueENT",  animKey: null, defaultHint: null },
      ],
    },
    {
      id:    "groundTasks",
      label: "Ground Tasks",
      customKey: null,
      rows: [
        { label: "First Aid (Success)", slot: "", sndKey: "sndGroundFirstAid", animKey: "groundTasks.firstAid.anim" },
      ],
    },
    {
      id:    "transporter",
      label: "Transporter",
      customKey: null,
      rows: [
        { label: "Voyager / Federation", slot: "", sndKey: "sndTransporterVoyFed",    animKey: null },
        { label: "TNG Federation",        slot: "", sndKey: "sndTransporterTngFed",    animKey: null },
        { label: "TOS Federation",        slot: "", sndKey: "sndTransporterTosFed",    animKey: null },
        { label: "TMP / Films",           slot: "", sndKey: "sndTransporterTmpFed",    animKey: null },
        { label: "Klingon",               slot: "", sndKey: "sndTransporterKlingon",   animKey: null },
        { label: "Cardassian",            slot: "", sndKey: "sndTransporterCardassian",animKey: null },
        { label: "Romulan",               slot: "", sndKey: "sndTransporterRomulan",   animKey: null },
        { label: "Ferengi",               slot: "", sndKey: "sndTransporterFerengi",   animKey: null },
        { label: "Borg",                  slot: "", sndKey: "sndTransporterBorg",      animKey: null },
      ],
    },
  ];
}

// Per-type torpedo count rows for the Torpedoes tab.
function buildTorpedoRows() {
  const cfg = getTorpedoCountConfig();
  return TORPEDO_TYPES.map(({ type, label }) => {
    const c = cfg[type] ?? {};
    return { type, label, standard: c.standard ?? 1, salvo: c.salvo ?? 1, max: c.max ?? 1 };
  });
}

// Per-family energy weapon count rows for the Energy Weapons tab.
function buildEnergyWeaponRows() {
  const cfg = getEnergyWeaponCountConfig();
  return ENERGY_WEAPON_FAMILIES.map(({ family, label }) => {
    const c = cfg[family] ?? {};
    return { family, label, base: c.base ?? 1, perDamage: c.perDamage ?? 0, max: c.max ?? 1 };
  });
}

// ── Beam VFX tab ─────────────────────────────────────────────────────────────

// Field list for the Beam VFX tab, kept as data so the template stays one
// generic loop. `path` is the dot-path into the beamVfxAppearance setting.
const BEAM_VFX_FIELD_GROUPS = Object.freeze([
  {
    group: "bank",
    label: "Phaser Bank",
    hint: "Short amber bolts, fired as a burst per target. Widths and radii are in canvas pixels.",
    fields: [
      { key: "coreWidth",        label: "Core width",         kind: "range", min: 0,  max: 30,   step: 0.5  },
      { key: "coreAlpha",        label: "Core opacity",       kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "glowWidth",        label: "Glow width",         kind: "range", min: 0,  max: 60,   step: 1    },
      { key: "glowAlpha",        label: "Glow opacity",       kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "muzzleFillRadius", label: "Muzzle flare radius",kind: "range", min: 0,  max: 40,   step: 1    },
      { key: "muzzleFillAlpha",  label: "Muzzle flare opacity", kind: "range", min: 0, max: 1,   step: 0.02 },
      { key: "muzzleRingRadius", label: "Muzzle ring radius", kind: "range", min: 0,  max: 60,   step: 1    },
      { key: "muzzleRingWidth",  label: "Muzzle ring width",  kind: "range", min: 0,  max: 12,   step: 0.5  },
      { key: "muzzleRingAlpha",  label: "Muzzle ring opacity",kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "impactFillRadius", label: "Impact flash radius",kind: "range", min: 0,  max: 40,   step: 1    },
      { key: "impactFillAlpha",  label: "Impact flash opacity", kind: "range", min: 0, max: 1,   step: 0.02 },
      { key: "impactRingRadius", label: "Impact ring radius", kind: "range", min: 0,  max: 60,   step: 1    },
      { key: "impactRingWidth",  label: "Impact ring width",  kind: "range", min: 0,  max: 12,   step: 0.5  },
      { key: "impactRingAlpha",  label: "Impact ring opacity",kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "hitDuration",      label: "Bolt lifetime (hit)",  kind: "range", min: 60, max: 2000, step: 20, unit: "ms" },
      { key: "missDuration",     label: "Bolt lifetime (miss)", kind: "range", min: 60, max: 2000, step: 20, unit: "ms" },
      { key: "burstGap",         label: "Gap between bursts",   kind: "range", min: 0,  max: 600,  step: 5,  unit: "ms" },
      { key: "targetGap",        label: "Gap between targets",  kind: "range", min: 0,  max: 2000, step: 20, unit: "ms" },
    ],
  },
  {
    group: "array",
    label: "Phaser Array",
    hint: "Continuous strip beam: a wide halo, two offset side rails, a core, and a thin hot sweep line over the top.",
    fields: [
      { key: "haloWidth",        label: "Halo width",         kind: "range", min: 0,  max: 60,   step: 1    },
      { key: "haloAlpha",        label: "Halo opacity",       kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "railWidth",        label: "Side rail width",    kind: "range", min: 0,  max: 40,   step: 0.5  },
      { key: "railAlpha",        label: "Side rail opacity",  kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "railOffset",       label: "Side rail offset",   kind: "range", min: 0,  max: 40,   step: 0.5  },
      { key: "coreWidth",        label: "Core width",         kind: "range", min: 0,  max: 30,   step: 0.5  },
      { key: "coreAlpha",        label: "Core opacity",       kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "sweepWidth",       label: "Sweep line width",   kind: "range", min: 0,  max: 20,   step: 0.5  },
      { key: "sweepAlpha",       label: "Sweep line opacity", kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "sweepColor",       label: "Sweep line colour",  kind: "color",
        hint: "Clear to make the sweep follow the beam's own core colour." },
      { key: "impactFillRadius", label: "Impact flash radius",kind: "range", min: 0,  max: 40,   step: 1    },
      { key: "impactFillAlpha",  label: "Impact flash opacity", kind: "range", min: 0, max: 1,   step: 0.02 },
      { key: "impactRingRadius", label: "Impact ring radius", kind: "range", min: 0,  max: 60,   step: 1    },
      { key: "impactRingWidth",  label: "Impact ring width",  kind: "range", min: 0,  max: 12,   step: 0.5  },
      { key: "impactRingAlpha",  label: "Impact ring opacity",kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "hitDuration",      label: "Beam lifetime (hit)",  kind: "range", min: 60, max: 3000, step: 20, unit: "ms" },
      { key: "missDuration",     label: "Beam lifetime (miss)", kind: "range", min: 60, max: 3000, step: 20, unit: "ms" },
      { key: "shotGap",          label: "Gap between strikes",  kind: "range", min: 0,  max: 1000, step: 10, unit: "ms" },
    ],
  },
  {
    group: "shared",
    label: "Shared",
    hint: "Applies to both beams.",
    fields: [
      { key: "holdPercent",  label: "Hold before fade", kind: "range", min: 0.05, max: 0.95, step: 0.05,
        hint: "Fraction of the lifetime the beam stays at full opacity before it starts fading." },
      { key: "easing",       label: "Fade easing",  kind: "select", options: BEAM_VFX_EASING_OPTIONS },
      { key: "blendMode",    label: "Blend mode",   kind: "select", options: BEAM_VFX_BLEND_OPTIONS,
        hint: "\"add\" gives the glowing additive look; \"normal\" draws flat." },
      { key: "cleanupDelay", label: "Cleanup delay", kind: "range", min: 0, max: 1000, step: 10, unit: "ms",
        hint: "Extra time before the graphics are destroyed. Raise only if beams vanish early." },
    ],
  },
  {
    group: "eraColors",
    label: "Era Colours (Phaser Banks)",
    hint: "Tints a phaser bank by the ship's era, set per weapon in that ship's Ship VFX Anchors editor. "
      + "Precedence: the ship's own colour override beats these, these beat the weapon-name guess, "
      + "and a cleared swatch falls through to stock amber. Phaser arrays are not affected.",
    fields: [
      { key: "entColor", label: "ENT — primary",        kind: "color" },
      { key: "entCore",  label: "ENT — core",           kind: "color" },
      { key: "tosColor", label: "TOS — primary",        kind: "color" },
      { key: "tosCore",  label: "TOS — core",           kind: "color" },
      { key: "tmpColor", label: "TMP — primary",        kind: "color" },
      { key: "tmpCore",  label: "TMP — core",           kind: "color" },
      { key: "tngColor", label: "TNG/DS9/VOY — primary",kind: "color" },
      { key: "tngCore",  label: "TNG/DS9/VOY — core",   kind: "color" },
    ],
  },
  {
    group: "tracer",
    label: "Tracer Fire (Phaser Banks)",
    hint: "The selected era's phaser banks fire a stream of short travelling bolts instead of a held beam. "
      + "Bolts launch one after another so several are in flight at once. Muzzle flare and impact flash "
      + "are shared with the Phaser Bank settings above.",
    fields: [
      { key: "era", label: "Tracer era", kind: "select", options: BEAM_VFX_TRACER_ERA_OPTIONS,
        hint: "Which era fires tracers. \"off\" makes every era use the continuous beam." },
      { key: "boltCount",      label: "Bolts per burst",   kind: "range", min: 1,  max: 24,   step: 1    },
      { key: "boltLength",     label: "Bolt length",       kind: "range", min: 4,  max: 400,  step: 2    },
      { key: "boltSpacing",    label: "Time between bolts",kind: "range", min: 5,  max: 500,  step: 5, unit: "ms",
        hint: "Lower than the travel time means several bolts are in flight at once." },
      { key: "travelDuration", label: "Bolt travel time",  kind: "range", min: 40, max: 2000, step: 10, unit: "ms",
        hint: "Also when the shield/hull impact lands." },
      { key: "volleyGap",      label: "Gap between bursts",kind: "range", min: 0,  max: 2000, step: 20, unit: "ms",
        hint: "Replaces the Phaser Bank burst gap while tracers are firing." },
      { key: "glowWidth",      label: "Bolt glow width",   kind: "range", min: 0,  max: 60,   step: 1    },
      { key: "glowAlpha",      label: "Bolt glow opacity", kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "coreWidth",      label: "Bolt core width",   kind: "range", min: 0,  max: 30,   step: 0.5  },
      { key: "coreAlpha",      label: "Bolt core opacity", kind: "range", min: 0,  max: 1,    step: 0.02 },
      { key: "tailFade",       label: "Dim over flight",   kind: "range", min: 0,  max: 1,    step: 0.02,
        hint: "How much a bolt dims by the time it reaches the target. 0 keeps it at full brightness." },
    ],
  },
]);

// Era-colour swatches mean something different when cleared than the array
// sweep colour does, so the blank checkbox gets its own label.
const BEAM_VFX_BLANK_LABELS = Object.freeze({
  "array.sweepColor": "follow core colour",
});
const BEAM_VFX_BLANK_LABEL_DEFAULT = "use default colour";

// Era options for the preview toolbar — same eras as the ship-side selector.
const BEAM_VFX_PREVIEW_ERAS = Object.freeze([
  { value: "",    label: "No era" },
  { value: "ent", label: "ENT" },
  { value: "tos", label: "TOS" },
  { value: "tmp", label: "TMP" },
  { value: "tng", label: "TNG/DS9/VOY" },
]);

/** Build the Beam VFX tab rows from the current (or supplied) settings. */
function buildBeamVfxGroups(current = getBeamVfxSettings()) {
  return BEAM_VFX_FIELD_GROUPS.map(group => ({
    label: group.label,
    hint:  group.hint,
    fields: group.fields.map(field => {
      const value = current?.[group.group]?.[field.key] ?? DEFAULT_BEAM_VFX_SETTINGS[group.group][field.key];
      return {
        ...field,
        path: `${group.group}.${field.key}`,
        value,
        hint: field.hint ?? null,
        isRange:  field.kind === "range",
        isColor:  field.kind === "color",
        isSelect: field.kind === "select",
        // The colour input needs a concrete value; blank is carried by the checkbox.
        colorValue: field.kind === "color" ? (value || "#ffffff") : null,
        colorBlank: field.kind === "color" ? !value : false,
        blankLabel: BEAM_VFX_BLANK_LABELS[`${group.group}.${field.key}`] ?? BEAM_VFX_BLANK_LABEL_DEFAULT,
        choices: field.kind === "select"
          ? field.options.map(option => ({ value: option, selected: option === value }))
          : null,
      };
    }),
  }));
}

/** Read the Beam VFX tab's live (unsaved) form state into a settings object. */
function readBeamVfxForm(el) {
  const draft = foundry.utils.deepClone(DEFAULT_BEAM_VFX_SETTINGS);
  for (const input of el.querySelectorAll("[data-beam-path]")) {
    const path = input.dataset.beamPath;
    if (!path) continue;
    // A cleared colour swatch is stored blank so the beam follows its own colour.
    if (input.dataset.beamKind === "color") {
      const row = input.closest("[data-beam-color-row]");
      const blank = row?.querySelector("[data-beam-color-blank]")?.checked;
      setPath(draft, path, blank ? "" : input.value);
      continue;
    }
    setPath(draft, path, input.value);
  }
  return normalizeBeamVfxSettings(draft);
}

// ── Utility ──────────────────────────────────────────────────────────────────

/** Read a nested value from an object via dot-path ("a.b.c") */
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj) ?? "";
}

/** Set a nested value on an object via dot-path, creating intermediate objects. */
function setPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]] || typeof cur[keys[i]] !== "object") cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

// ── ApplicationV2 class ───────────────────────────────────────────────────────

export class EffectConfigMenu extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id:     "sta2e-effect-config",
    tag:    "div",
    window: { title: "STA2e — Sounds & Animations", resizable: true },
    position: { width: 860, height: 640 },
    actions: {
      save:            EffectConfigMenu._onSave,
      cancel:          EffectConfigMenu._onCancel,
      addCustomRow:    EffectConfigMenu._onAddCustomRow,
      deleteCustomRow: EffectConfigMenu._onDeleteCustomRow,
      previewBeam:     EffectConfigMenu._onPreviewBeam,
      resetBeam:       EffectConfigMenu._onResetBeam,
    },
  };

  static PARTS = {
    config: { template: "modules/sta2e-toolkit/templates/effect-config.hbs" },
  };

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext(_options) {
    const animOv = (() => {
      try { return game.settings.get(MODULE, "animationOverrides") ?? {}; }
      catch { return {}; }
    })();
    const custom = (() => {
      try { return game.settings.get(MODULE, "customWeaponEffects") ?? {}; }
      catch { return {}; }
    })();
    const weaponModes = normalizeWeaponAnimationModes((() => {
      try { return game.settings.get(MODULE, "weaponAnimationModes") ?? {}; }
      catch { return {}; }
    })());

    const tabs = buildTabDefs().map(tab => ({
      ...tab,
      rows: tab.rows.map(row => ({
        ...row,
        soundValue: row.sndKey
          ? (() => { try { return game.settings.get(MODULE, row.sndKey) || ""; } catch { return ""; } })()
          : null,
        animValue:   row.animKey    ? (getPath(animOv, row.animKey) || "") : null,
        delayValue:  row.delayKey != null
          ? (() => { try { return game.settings.get(MODULE, row.delayKey) ?? 0; } catch { return 0; } })()
          : null,
        defaultHint: row.defaultHint ?? null,
      })),
      nativeModeRows: tab.nativeModeRows
        ? tab.nativeModeRows.map(row => ({
          ...row,
          modeValue: weaponModes[row.key] ?? "current",
          currentSelected: (weaponModes[row.key] ?? "current") !== "experimental",
          experimentalSelected: weaponModes[row.key] === "experimental",
        }))
        : null,
      customRows: tab.customKey
        ? (custom[tab.customKey] ?? []).map((c, i) => ({ ...c, index: i }))
        : null,
      torpedoRows: tab.torpedoCounts ? buildTorpedoRows() : null,
      energyWeaponRows: tab.energyWeaponCounts ? buildEnergyWeaponRows() : null,
      arrayAreaCap: tab.energyWeaponCounts ? getArrayAreaShotCap() : null,
      beamVfxGroups: tab.beamVfx ? buildBeamVfxGroups() : null,
      beamPreviewEras: tab.beamVfx ? BEAM_VFX_PREVIEW_ERAS : null,
    }));

    return { tabs, activeTab: tabs[0]?.id ?? "" };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    // ── Tab switching ───────────────────────────────────────────────────────
    el.querySelectorAll(".ec-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        el.querySelectorAll(".ec-tab-btn").forEach(b => b.classList.remove("active"));
        el.querySelectorAll(".ec-tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        el.querySelector(`.ec-tab-panel[data-tab="${btn.dataset.tab}"]`)?.classList.add("active");
      });
    });

    // ── File pickers ────────────────────────────────────────────────────────
    el.querySelectorAll(".ec-browse-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        // Custom rows: button and input share one <td class="ec-pair"> — sibling is the input.
        // Main rows:   button is alone in <td class="ec-btn-cell"> — input is in the previous <td>.
        const input = btn.previousElementSibling
          ?? btn.closest("td")?.previousElementSibling?.querySelector("input");
        if (!input) return;
        const fpType = btn.dataset.fpType ?? "audio";
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        new FP({
          type:     fpType,
          current:  input.value || "",
          callback: path => { input.value = path; },
        }).render(true);
      });
    });

    // ── Torpedo count sliders — live value readout ────────────────────────────
    el.querySelectorAll(".ec-slider input[type='range']").forEach(range => {
      const valEl = range.parentElement?.querySelector(".ec-slider-val");
      range.addEventListener("input", () => { if (valEl) valEl.textContent = range.value; });
    });

    // ── Beam VFX colour swatches — picking a colour clears "follow core" ──────
    el.querySelectorAll("[data-beam-color-row]").forEach(row => {
      const swatch = row.querySelector("[data-beam-kind='color']");
      const blank  = row.querySelector("[data-beam-color-blank]");
      if (!swatch || !blank) return;
      swatch.addEventListener("input", () => { blank.checked = false; });
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Save all settings from the form. */
  static async _onSave(_event, _target) {
    const el    = this.element;
    const animOv = foundry.utils.deepClone(
      (() => { try { return game.settings.get(MODULE, "animationOverrides") ?? {}; } catch { return {}; } })()
    );
    const custom = foundry.utils.deepClone(
      (() => { try { return game.settings.get(MODULE, "customWeaponEffects") ?? {}; } catch { return {}; } })()
    );
    const weaponModes = normalizeWeaponAnimationModes(
      (() => { try { return game.settings.get(MODULE, "weaponAnimationModes") ?? {}; } catch { return {}; } })()
    );

    // Timing delays
    for (const input of el.querySelectorAll("[data-delay-key]")) {
      const key = input.dataset.delayKey;
      if (!key) continue;
      const val = parseInt(input.value) || 0;
      try { await game.settings.set(MODULE, key, val); }
      catch(e) { console.warn(`STA2e Toolkit | Could not save timing ${key}:`, e); }
    }

    // Sound settings
    for (const input of el.querySelectorAll("[data-snd-key]")) {
      const key = input.dataset.sndKey;
      if (!key) continue;
      try { await game.settings.set(MODULE, key, input.value.trim()); }
      catch(e) { console.warn(`STA2e Toolkit | Could not save setting ${key}:`, e); }
    }

    // Animation overrides
    for (const input of el.querySelectorAll("[data-anim-key]")) {
      const path = input.dataset.animKey;
      if (!path) continue;
      setPath(animOv, path, input.value.trim());
    }
    try { await game.settings.set(MODULE, "animationOverrides", animOv); }
    catch(e) { console.warn("STA2e Toolkit | Could not save animationOverrides:", e); }

    // Per-weapon animation modes
    for (const select of el.querySelectorAll("[data-weapon-mode-key]")) {
      const key = select.dataset.weaponModeKey;
      if (!key) continue;
      weaponModes[key] = select.value === "experimental" ? "experimental" : "current";
    }
    try { await game.settings.set(MODULE, "weaponAnimationModes", normalizeWeaponAnimationModes(weaponModes)); }
    catch(e) { console.warn("STA2e Toolkit | Could not save weaponAnimationModes:", e); }

    // Custom weapon rows per tab
    for (const panel of el.querySelectorAll(".ec-tab-panel[data-custom-key]")) {
      const key  = panel.dataset.customKey;
      const rows = [];
      for (const row of panel.querySelectorAll(".ec-custom-row")) {
        rows.push({
          namePattern: row.querySelector("[data-field='namePattern']")?.value.trim()  ?? "",
          soundHit:    row.querySelector("[data-field='soundHit']")?.value.trim()     ?? "",
          soundMiss:   row.querySelector("[data-field='soundMiss']")?.value.trim()    ?? "",
          animHit:     row.querySelector("[data-field='animHit']")?.value.trim()      ?? "",
          animMiss:    row.querySelector("[data-field='animMiss']")?.value.trim()     ?? "",
          animImpact:  row.querySelector("[data-field='animImpact']")?.value.trim()   ?? "",
        });
      }
      custom[key] = rows;
    }
    try { await game.settings.set(MODULE, "customWeaponEffects", custom); }
    catch(e) { console.warn("STA2e Toolkit | Could not save customWeaponEffects:", e); }

    // Per-type torpedo counts (Torpedoes tab)
    const torpedoCounts = foundry.utils.deepClone(
      (() => { try { return game.settings.get(MODULE, "torpedoCountConfig") ?? {}; } catch { return {}; } })()
    );
    for (const input of el.querySelectorAll("[data-torp-type]")) {
      const type  = input.dataset.torpType;
      const field = input.dataset.torpField;
      if (!type || !field) continue;
      const val = Math.max(1, Math.min(20, parseInt(input.value) || 1));
      if (!torpedoCounts[type] || typeof torpedoCounts[type] !== "object") torpedoCounts[type] = {};
      torpedoCounts[type][field] = val;
    }
    try { await game.settings.set(MODULE, "torpedoCountConfig", torpedoCounts); }
    catch(e) { console.warn("STA2e Toolkit | Could not save torpedoCountConfig:", e); }

    // Per-family energy weapon counts (Energy Weapons tab)
    const energyWeaponCounts = foundry.utils.deepClone(
      (() => { try { return game.settings.get(MODULE, "energyWeaponCountConfig") ?? {}; } catch { return {}; } })()
    );
    for (const input of el.querySelectorAll("[data-energy-family]")) {
      const family = input.dataset.energyFamily;
      const field  = input.dataset.energyField;
      if (!family || !field) continue;
      // perDamage may be 0 (no scaling); base/max floor at 1.
      const min = field === "perDamage" ? 0 : 1;
      const val = Math.max(min, Math.min(20, parseInt(input.value) || min));
      if (!energyWeaponCounts[family] || typeof energyWeaponCounts[family] !== "object") energyWeaponCounts[family] = {};
      energyWeaponCounts[family][field] = val;
    }
    try { await game.settings.set(MODULE, "energyWeaponCountConfig", energyWeaponCounts); }
    catch(e) { console.warn("STA2e Toolkit | Could not save energyWeaponCountConfig:", e); }

    // Array Area shot cap (Energy Weapons tab)
    const capEnabled = el.querySelector("[data-array-cap-field='enabled']");
    const capMax     = el.querySelector("[data-array-cap-field='max']");
    if (capEnabled || capMax) {
      try {
        await game.settings.set(MODULE, "arrayAreaShotCap", {
          enabled: !!capEnabled?.checked,
          max: Math.max(1, Math.min(20, parseInt(capMax?.value) || ARRAY_AREA_SHOT_CAP_DEFAULT)),
        });
      } catch(e) { console.warn("STA2e Toolkit | Could not save arrayAreaShotCap:", e); }
    }

    // Native beam appearance (Beam VFX tab)
    if (el.querySelector("[data-beam-path]")) {
      try { await game.settings.set(MODULE, "beamVfxAppearance", readBeamVfxForm(el)); }
      catch(e) { console.warn("STA2e Toolkit | Could not save beamVfxAppearance:", e); }
    }

    ui.notifications.info("STA2e Toolkit | Sounds & Animations saved.");
    this.close();
  }

  static _onCancel(_event, _target) {
    this.close();
  }

  /** Fire one beam between the controlled token and the first target, using the
   *  live form values so unsaved slider positions can be judged on canvas. */
  static _onPreviewBeam(_event, btn) {
    const source = canvas?.tokens?.controlled?.[0] ?? null;
    const target = Array.from(game.user?.targets ?? [])[0] ?? null;
    if (!source || !target) {
      ui.notifications.warn("STA2e Toolkit | Select a token and target another to preview the beam.");
      return;
    }
    if (source === target) {
      ui.notifications.warn("STA2e Toolkit | Target a different token to preview the beam.");
      return;
    }
    previewBeamVfxAppearance(source, target, {
      weaponKey: btn.dataset.beamPreview === "array" ? "weapon-phaser-array" : "weapon-phaser-bank",
      beamSettings: readBeamVfxForm(this.element),
      era: this.element.querySelector("[data-beam-preview-era]")?.value ?? "",
    });
  }

  /** Restore every Beam VFX control to its stock value (not saved until Save). */
  static _onResetBeam(_event, _btn) {
    const el = this.element;
    for (const input of el.querySelectorAll("[data-beam-path]")) {
      const path = input.dataset.beamPath;
      if (!path) continue;
      const value = getPath(DEFAULT_BEAM_VFX_SETTINGS, path);
      if (input.dataset.beamKind === "color") {
        const row = input.closest("[data-beam-color-row]");
        const blank = row?.querySelector("[data-beam-color-blank]");
        if (blank) blank.checked = !value;
        input.value = value || "#ffffff";
        continue;
      }
      input.value = value;
      const valEl = input.parentElement?.querySelector(".ec-slider-val");
      if (valEl) valEl.textContent = input.value;
    }
    ui.notifications.info("STA2e Toolkit | Beam VFX reset to defaults — press Save to keep it.");
  }

  /** Append a blank custom weapon row to the active tab's custom section. */
  static _onAddCustomRow(_event, btn) {
    const panel = btn.closest(".ec-tab-panel");
    const tbody = panel?.querySelector(".ec-custom-tbody");
    if (!tbody) return;
    const row = document.createElement("tr");
    row.className = "ec-custom-row";
    row.innerHTML = `
      <td><input type="text" data-field="namePattern" placeholder="e.g. bat'leth" style="width:100%;" /></td>
      <td class="ec-pair">
        <input type="text" data-field="soundHit" placeholder="path/to/hit.ogg" />
        <button type="button" class="ec-browse-btn" data-fp-type="audio" title="Browse audio">📁</button>
      </td>
      <td class="ec-pair">
        <input type="text" data-field="soundMiss" placeholder="path/to/miss.ogg" />
        <button type="button" class="ec-browse-btn" data-fp-type="audio" title="Browse audio">📁</button>
      </td>
      <td class="ec-pair">
        <input type="text" data-field="animHit" placeholder="jb2a.* or path/to/hit.webm" />
        <button type="button" class="ec-browse-btn" data-fp-type="video" title="Browse animation">📁</button>
      </td>
      <td class="ec-pair">
        <input type="text" data-field="animMiss" placeholder="jb2a.* or path/to/miss.webm" />
        <button type="button" class="ec-browse-btn" data-fp-type="video" title="Browse animation">📁</button>
      </td>
      <td class="ec-pair">
        <input type="text" data-field="animImpact" placeholder="jb2a.* or path/to/impact.webm" />
        <button type="button" class="ec-browse-btn" data-fp-type="video" title="Browse animation">📁</button>
      </td>
      <td><button type="button" class="ec-del-btn" data-action="deleteCustomRow" title="Remove row">🗑</button></td>`;
    tbody.appendChild(row);
    // Wire file pickers on new row
    row.querySelectorAll(".ec-browse-btn").forEach(b => {
      b.addEventListener("click", () => {
        const input = b.previousElementSibling;
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        new FP({ type: b.dataset.fpType ?? "audio", current: input.value || "",
          callback: p => { input.value = p; } }).render(true);
      });
    });
  }

  static _onDeleteCustomRow(_event, btn) {
    btn.closest(".ec-custom-row")?.remove();
  }
}
