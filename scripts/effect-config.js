/**
 * sta2e-toolkit | effect-config.js
 * Sounds & Animations configuration menu — ApplicationV2, Foundry v13 native.
 */

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
function buildTabDefs() {
  return [
    {
      id:    "shipWeapons",
      label: "Ship Weapons",
      customKey: "shipWeapons",
      rows: [
        // ── Phaser / Phase-Pulse ───────────────────────────────────────────
        { label: "Phaser / Phase-Pulse", slot: "Beam (Hit)",    sndKey: "sndShipPhaserHit",   animKey: "shipWeapons.phaser.animHit",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Orange_90ft_4000x400.webm`, `${_FREE}/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`) },
        { label: "Phaser / Phase-Pulse", slot: "Impact (Hit)",  sndKey: null,                 animKey: "shipWeapons.phaser.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.blue", _IMP) },
        { label: "Phaser / Phase-Pulse", slot: "Beam (Miss)",   sndKey: "sndShipPhaserMiss",  animKey: "shipWeapons.phaser.animMiss",
          defaultHint: jb2aHint(`${_PAT}/Weapon_Attacks/Ranged/Snipe_01_Regular_Orange_90ft_4000x400.webm`, `${_FREE}/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`) },
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
        // ── Phaser Cannon ──────────────────────────────────────────────────
        { label: "Phaser Cannon",        slot: "Shot (Hit)",    sndKey: "sndShipCannonPhaserHit",   animKey: "shipWeapons.phaserCannon.animHit",
          defaultHint: jb2aHint("jb2a.lasershot.orange", `${_WA}/LaserShot_01_Regular_Orange_30ft_1600x400.webm`) },
        { label: "Phaser Cannon",        slot: "Impact (Hit)",  sndKey: null,                       animKey: "shipWeapons.phaserCannon.animImpact",
          defaultHint: jb2aHint("jb2a.impact.011.blue", _IMP) },
        { label: "Phaser Cannon",        slot: "Shot (Miss)",   sndKey: "sndShipCannonPhaserMiss",  animKey: "shipWeapons.phaserCannon.animMiss",
          defaultHint: jb2aHint("jb2a.lasershot.orange", `${_WA}/LaserShot_01_Regular_Orange_30ft_1600x400.webm`) },
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
        { label: "Warp — Engage",          slot: "", sndKey: "sndWarpEngage",      animKey: null, defaultHint: null },
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
      customRows: tab.customKey
        ? (custom[tab.customKey] ?? []).map((c, i) => ({ ...c, index: i }))
        : null,
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
        new FilePicker({
          type:     fpType,
          current:  input.value || "",
          callback: path => { input.value = path; },
        }).render(true);
      });
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

    ui.notifications.info("STA2e Toolkit | Sounds & Animations saved.");
    this.close();
  }

  static _onCancel(_event, _target) {
    this.close();
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
        new FilePicker({ type: b.dataset.fpType ?? "audio", current: input.value || "",
          callback: p => { input.value = p; } }).render(true);
      });
    });
  }

  static _onDeleteCustomRow(_event, btn) {
    btn.closest(".ec-custom-row")?.remove();
  }
}
