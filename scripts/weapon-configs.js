/**
 * sta2e-toolkit | weapon-configs.js
 * Weapon animation configurations and firing functions.
 *
 * Sounds are driven by module settings — see settings.js for registration.
 * JB2A asset paths switch between Free and Patron tiers based on the
 * "jb2aTier" setting.
 */

// ---------------------------------------------------------------------------
// Runtime helpers — read from Foundry settings at call time
// ---------------------------------------------------------------------------

function snd(key) {
  try { return game.settings.get("sta2e-toolkit", key) || null; }
  catch { return null; }
}

function isPatron() {
  try { return game.settings.get("sta2e-toolkit", "jb2aTier") === "patron"; }
  catch { return false; }
}

/**
 * Read an animation override set via the Sounds & Animations config menu.
 * @param {string} tab    — "shipWeapons" | "groundWeapons" | "shipTasks" | "groundTasks" | "transporter"
 * @param {string} weapon — weapon/task key, e.g. "phaser", "firstAid"
 * @param {string} slot   — "animHit" | "animMiss" | "anim"
 * @returns {string|null} override path, or null to use the hardcoded default
 */
function animOverride(tab, weapon, slot) {
  try {
    const ov = game.settings.get("sta2e-toolkit", "animationOverrides");
    return ov?.[tab]?.[weapon]?.[slot] || null;
  } catch { return null; }
}

/**
 * Look up a custom weapon entry by weapon name fragment.
 * Returns { sound, anim } for hit or miss, or null if no match.
 */
function resolveCustomEffect(weaponName, isShip, isHit) {
  try {
    const customs = game.settings.get("sta2e-toolkit", "customWeaponEffects");
    const list    = isShip ? (customs?.shipWeapons ?? []) : (customs?.groundWeapons ?? []);
    const entry   = list.find(e =>
      e.namePattern && weaponName?.toLowerCase().includes(e.namePattern.toLowerCase())
    );
    if (!entry) return null;
    return {
      sound:      isHit ? (entry.soundHit || null) : (entry.soundMiss || null),
      anim:       isHit ? (entry.animHit  || null) : (entry.animMiss  || null),
      animImpact: entry.animImpact || null,
    };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// JB2A effect path helpers — ship scale
// ---------------------------------------------------------------------------

// FireballBeam — long ship-scale energy beam (free & patron)
function beamEffect(color) {
  const weaponKey = color === "green" ? "disruptor" : color === "purple" ? "polaron" : "phaser";
  return animOverride("shipWeapons", weaponKey, "animHit")
    ?? (isPatron()
      ? `modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Ranged/Snipe_01_Regular_${{ orange: "Orange", green: "Green", purple: "Purple", blue: "Blue" }[color] ?? "Orange"}_90ft_4000x400.webm`
      : `modules/JB2A_DnD5e/Library/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`);
}

const WA = "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged";

function torpedoEffect(color, torpedoType) {
  const weaponKey = torpedoType === "quantum" ? "quantumTorpedo"
                  : torpedoType === "plasma"  ? "plasmaTorpedo"
                  : "photonTorpedo";
  return animOverride("shipWeapons", weaponKey, "anim")
    ?? (isPatron()
      ? `modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Ranged/Bullet_03_Regular_${{ red: "Red", blue: "Blue", green: "Green" }[color] ?? "Red"}_90ft_4000x400.webm`
      : color === "blue"  ? `${WA}/Bullet_03_Regular_Blue_90ft_4000x400.webm`
      : color === "green" ? `${WA}/Missile01_01_Regular_Blue_90ft_4000x400.webm`
      : `${WA}/Bullet_01_Regular_Orange_90ft_4000x400.webm`);
}

function cannonEffect(color) {
  const weaponKey = color === "green" ? "disruptorCannon" : color === "purple" ? "polaronCannon" : "phaserCannon";
  return animOverride("shipWeapons", weaponKey, "animHit")
    ?? (isPatron()
      ? `jb2a.lasershot.${{ orange: "orange", green: "green", purple: "purple", blue: "blue" }[color] ?? "orange"}`
      : `${WA}/LaserShot_01_Regular_${{ orange: "Orange", green: "Green", purple: "Blue", blue: "Blue" }[color] ?? "Orange"}_30ft_1600x400.webm`);
}

function impactEffect(color) {
  if (isPatron()) {
    return `jb2a.impact.011.${color === "orange" ? "blue" : color}`;
  }
  return `modules/JB2A_DnD5e/Library/Generic/Impact/Impact013/Impact013_001_OrangeYellow_400x400.webm`;
}

function explosionEffect(color) {
  if (isPatron()) {
    // jb2a.explosion.08 sub-paths: orange, blue, green, dark_blue, dark_green, dark_orange
    const col = { red: "orange", blue: "blue", green: "green", orange: "orange" }[color] ?? "orange";
    return `jb2a.explosion.08.${col}`;
  }
  const file = color === "blue" ? "Explosion_02_Blue_400x400.webm" : "Explosion_01_Orange_400x400.webm";
  return `modules/JB2A_DnD5e/Library/Generic/Explosion/${file}`;
}

// ---------------------------------------------------------------------------
// JB2A effect path helpers — ground / person scale
// ---------------------------------------------------------------------------

// Short-range person-scale energy bolt (phasers, disruptors, etc.)
// Free tier: Bullet_01 (orange) / Bullet_03 (blue) — short travel, person-scale
// Patron:    Snipe_01 in matching colour
function groundBeamEffect(color) {
  const weaponKey = color === "green" ? "disruptor" : color === "purple" ? "plasma" : "phaser";
  return animOverride("groundWeapons", weaponKey, "animHit")
    ?? (isPatron()
      ? `modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Ranged/Snipe_01_Regular_${{ orange: "Orange", green: "Green", purple: "Purple", blue: "Blue" }[color] ?? "Orange"}_90ft_4000x400.webm`
      : color === "orange" ? `modules/JB2A_DnD5e/Library/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`
      : color === "green"  ? `${WA}/LaserShot_01_Regular_Green_30ft_1600x400.webm`
      : `${WA}/Bullet_03_Regular_Blue_90ft_4000x400.webm`);
}

// Melee strike effect — attaches to the attacker, plays toward target
// Free tier: uses Sword/Maul/Mace from the Weapon_Attacks/Melee library
// Patron:    dedicated jb2a named paths
const WM = "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Melee";

function meleeEffect(subtype) {
  return animOverride("groundWeapons", "melee", "animHit")
    ?? (isPatron()
      ? ({ blade: "jb2a.sword.melee.01.white", dagger: "jb2a.dagger.melee.02",
           heavy: "jb2a.greatclub.standard.white", bludgeon: "jb2a.mace.melee.01.white",
           unarmed: "jb2a.unarmed_strike.physical.01", ushaan: "jb2a.dagger.melee.02" }[subtype]
        ?? "jb2a.sword.melee.01.white")
      : ({ blade:    `${WM}/Group01/MeleeAttack01_ShortSword01_02_800x600.webm`,
           dagger:   `${WM}/Dagger02_01_Regular_White_800x600.webm`,
           heavy:    `${WM}/Halberd01_03_Regular_White_800x600.webm`,
           bludgeon: `${WM}/Club01_05_Regular_White_800x600.webm`,
           unarmed:  `${WM}/Unarmed_Strike_01/Unarmed_Strike_01_Regular_White_200x200.webm`,
           ushaan:   `${WM}/Group01/MeleeAttack01_Chakram01_01_800x600.webm` }[subtype]
        ?? `${WM}/Group01/MeleeAttack01_ShortSword01_02_800x600.webm`));
}

function groundCrackEffect() {
  return isPatron()
    ? "jb2a.impact.ground_crack.still_frame.01"   // orange/blue/green etc are random-picked by Sequencer
    : `modules/JB2A_DnD5e/Library/Generic/Impact/Impact013/Impact013_001_OrangeYellow_400x400.webm`;
}

function magicCircleEffect(color) {
  // jb2a.magic_signs.circle.02 sub-paths are schools, not colors — use evocation for energy/combat
  if (isPatron()) return `jb2a.magic_signs.circle.02.evocation.loop`;
  return `modules/JB2A_DnD5e/Library/Generic/Magic_Signs/Runes/AbjurationRuneLoop_01_Regular_Blue_400x400.webm`;
}

// Radar sweep — patron; free tier also has a radar pulse via jb2a-extras/TMFX
function radarScanEffect() {
  if (isPatron()) return `jb2a.template_circle.radar.loop.800px.001.sweep.blue`;
  return `jb2a.extras.tmfx.radar.circle.pulse.01.normal`;
}

// ---------------------------------------------------------------------------
// Starship weapon config builders
// ---------------------------------------------------------------------------

function shipBeam(name, color, shots, isArray = false) {
  const wk = color === "green" ? "disruptor" : color === "purple" ? "polaron" : "phaser";
  return {
    name, color, shots, type: "beam", isArray,
    get effect()    { return beamEffect(color); },
    get impact()    { return animOverride("shipWeapons", wk, "animImpact") ?? impactEffect(color); },
    get sound()     {
      const key = color === "green"  ? "sndShipDisruptorHit"
                : color === "purple" ? "sndShipPolaronHit"
                : "sndShipPhaserHit";
      return snd(key);
    },
    get missSound() {
      const key = color === "green"  ? "sndShipDisruptorMiss"
                : color === "purple" ? "sndShipPolaronMiss"
                : "sndShipPhaserMiss";
      return snd(key);
    },
  };
}

function shipCannon(name, color, shots) {
  const wk = color === "green" ? "disruptorCannon" : color === "purple" ? "polaronCannon" : "phaserCannon";
  return {
    name, color, shots, type: "cannon",
    get effect()    { return cannonEffect(color); },
    get impact()    { return animOverride("shipWeapons", wk, "animImpact") ?? impactEffect(color); },
    get sound() {
      const key = color === "green"  ? "sndShipCannonDisruptorHit"
                : color === "purple" ? "sndShipCannonPolaronHit"
                : "sndShipCannonPhaserHit";
      return snd(key) || snd("sndShipCannonHit");
    },
    get missSound() {
      const key = color === "green"  ? "sndShipCannonDisruptorMiss"
                : color === "purple" ? "sndShipCannonPolaronMiss"
                : "sndShipCannonPhaserMiss";
      return snd(key) || snd("sndShipCannonHit");
    },
  };
}

function shipTorpedo(name, color, salvo, torpedoes, torpedoType) {
  return {
    name, color, salvo, torpedoes, type: "torpedo", torpedoType,
    get effect()    { return torpedoEffect(color, torpedoType); },
    get explosion() {
      const wk = torpedoType === "quantum" ? "quantumTorpedo" : torpedoType === "plasma" ? "plasmaTorpedo" : "photonTorpedo";
      return animOverride("shipWeapons", wk, "animExplosion") ?? explosionEffect(color);
    },
    get sound() {
      const base = torpedoType === "quantum" ? "sndShipTorpedoQuantum"
                 : torpedoType === "plasma"  ? "sndShipTorpedoPlasma"
                 : "sndShipTorpedoPhoton";   // photon is the default/fallback
      const key = salvo ? base + "Salvo" : base;
      // fall back: salvo key → base key → legacy "sndShipTorpedo"
      return snd(key) || snd(base) || snd("sndShipTorpedo");
    },
    get missSound() {
      const base = torpedoType === "quantum" ? "sndShipTorpedoQuantum"
                 : torpedoType === "plasma"  ? "sndShipTorpedoPlasma"
                 : "sndShipTorpedoPhoton";
      const key = salvo ? base + "Salvo" : base;
      return snd(key) || snd(base) || snd("sndShipTorpedo");
    },
  };
}

// ---------------------------------------------------------------------------
// Starship Weapon Configs — keyed by img slug
// ---------------------------------------------------------------------------

export const STARSHIP_WEAPON_CONFIGS = {

  "weapon-phaser-array":        shipBeam("Phaser Arrays",        "orange", 4, true),
  "weapon-phaser-bank":         shipBeam("Phaser Banks",         "orange", 3),
  "weapon-phaser-cannon":       shipCannon("Phaser Cannon",      "orange", 4),
  "weapon-phaser-array-spread": shipBeam("Phaser Spinal Lance",  "orange", 1),

  "weapon-disruptor-array":        shipBeam("Disruptor Arrays",       "green", 4, true),
  "weapon-disruptor-bank":         shipBeam("Disruptor Banks",        "green", 3),
  "weapon-disruptor-cannon":       shipCannon("Disruptor Cannon",     "green", 4),
  "weapon-disruptor-array-spread": shipBeam("Disruptor Spinal Lance", "green", 1),

  "weapon-polaron-array":        shipBeam("Polaron Arrays",       "purple", 4, true),
  "weapon-polaron-bank":         shipBeam("Polaron Banks",        "purple", 3),
  "weapon-polaron-cannon":       shipCannon("Polaron Cannon",     "purple", 4),
  "weapon-polaron-array-spread": shipBeam("Polaron Spinal Lance", "purple", 1),

  "weapon-photon-torpedo":        shipTorpedo("Photon Torpedo",        "red",   false, 1, "photon"),
  "weapon-photon-torpedo-salvo":  shipTorpedo("Photon Torpedo Salvo",  "red",   true,  3, "photon"),
  "weapon-quantum-torpedo":       shipTorpedo("Quantum Torpedo",       "blue",  false, 1, "quantum"),
  "weapon-quantum-torpedo-salvo": shipTorpedo("Quantum Torpedo Salvo", "blue",  true,  3, "quantum"),
  "weapon-plasma-torpedo":        shipTorpedo("Plasma Torpedo",        "green", false, 1, "plasma"),
  "weapon-plasma-torpedo-salvo":  shipTorpedo("Plasma Torpedo Salvo",  "green", true,  3, "plasma"),
};

// ---------------------------------------------------------------------------
// Ground Weapon Config Resolver
// ---------------------------------------------------------------------------

export function resolveGroundWeaponConfig(item) {
  const name  = item.name.toLowerCase();
  const range = item.system.range;
  const hands = item.system.hands;

  // ── Custom weapon entry override ─────────────────────────────────────────
  // Check the user-configured Custom Weapon Entries first. If the weapon name
  // matches a pattern entry that has a custom animation, build a ground-beam
  // config using those paths. Sound/anim slots left blank fall back to the
  // generic sound or the normal detection path below.
  const _customHit  = resolveCustomEffect(item.name, false, true);
  const _customMiss = resolveCustomEffect(item.name, false, false);
  if (_customHit?.anim || _customMiss?.anim || _customHit?.sound || _customMiss?.sound) {
    return {
      name:  item.name,
      type:  "ground-beam",
      color: "blue",
      get effect()    {
        return _customHit?.anim  || animOverride("groundWeapons", "generic", "animHit")
          || groundBeamEffect("blue");
      },
      get missEffect() {
        return _customMiss?.anim || animOverride("groundWeapons", "generic", "animMiss")
          || groundBeamEffect("blue");
      },
      get impact() {
        return _customHit?.animImpact
          || animOverride("groundWeapons", "generic", "animImpact")
          || impactEffect("blue");
      },
      get sound()     { return _customHit?.sound  || snd("sndGroundGenericHit"); },
      get missSound() { return _customMiss?.sound || snd("sndGroundGenericHit"); },
    };
  }

  // ── Anesthetic Hypospray ──────────────────────────────────────────────────
  if (name.includes("hypospray") || name.includes("anesthetic")) {
    return {
      name: item.name, type: "hypospray", color: "green",
      effect: "modules/JB2A_DnD5e/Library/Generic/Conditions/Boon01/ConditionBoon01_018_Green_600x600.webm",
      get sound() { return snd("sndGroundHypospray"); },
    };
  }

  // ── Grenades ──────────────────────────────────────────────────────────────
  if (name.includes("grenade")) {
    return {
      name: item.name, type: "grenade", color: "orange",
      get sound()     { return snd("sndGroundGrenade"); },
      get explosion() { return animOverride("groundWeapons", "grenade", "animExplosion") ?? explosionEffect("orange"); },
    };
  }

  // ── Ranged energy weapons ─────────────────────────────────────────────────
  if (range === "ranged") {
    if (name.includes("phaser") || name.includes("phase")) {
      return {
        name: item.name, type: "ground-beam", color: "orange",
        get effect()    { return groundBeamEffect("orange"); },
        get impact()    { return animOverride("groundWeapons", "phaser", "animImpact") ?? impactEffect("orange"); },
        get sound()     { return snd("sndGroundPhaserHit"); },
        get missSound() { return snd("sndGroundPhaserMiss"); },
      };
    }
    if (name.includes("disruptor")) {
      return {
        name: item.name, type: "ground-beam", color: "green",
        get effect()    { return groundBeamEffect("green"); },
        get impact()    { return animOverride("groundWeapons", "disruptor", "animImpact") ?? impactEffect("green"); },
        get sound()     { return snd("sndGroundDisruptorHit"); },
        get missSound() { return snd("sndGroundDisruptorMiss"); },
      };
    }
    if (name.includes("plasma") || name.includes("particle") || name.includes("proton")) {
      return {
        name: item.name, type: "ground-beam", color: "purple",
        get effect()    { return groundBeamEffect("purple"); },
        get impact()    { return animOverride("groundWeapons", "plasma", "animImpact") ?? impactEffect("purple"); },
        get sound()     { return snd("sndGroundPlasmaHit"); },
        get missSound() { return snd("sndGroundPlasmaHit"); },
      };
    }
    // Generic fallback ranged (rifles, projectile weapons, etc.)
    return {
      name: item.name, type: "ground-beam", color: "blue",
      get effect()    { return groundBeamEffect("blue"); },
      get impact()    { return animOverride("groundWeapons", "generic", "animImpact") ?? impactEffect("blue"); },
      get sound()     { return snd("sndGroundGenericHit"); },
      get missSound() { return snd("sndGroundGenericHit"); },
    };
  }

  // ── Melee weapons ─────────────────────────────────────────────────────────
  if (range === "melee") {
    const subtype = name.includes("unarmed") || name.includes("punch") || name.includes("fist")
      ? "unarmed"
      : name.includes("ushaan")
        ? "ushaan"
        : (name.includes("knife") || name.includes("dagger"))
          ? "dagger"
          : (hands === 2 || name.includes("bat") || name.includes("heavy") || name.includes("maul") || name.includes("staff") || name.includes("lirpa") || name.includes("halberd"))
            ? "heavy"
            : (name.includes("blade") || name.includes("sword") || name.includes("mek"))
              ? "blade"
              : "bludgeon";
    return {
      name: item.name, type: `melee-${subtype}`, subtype, color: "white",
      get effect()    { return meleeEffect(subtype); },
      get impact()    { return animOverride("groundWeapons", "melee", "animImpact") ?? groundCrackEffect(); },
      get sound()     { return snd("sndGroundMeleeHit"); },
      get missSound() { return snd("sndGroundMeleeMiss"); },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Img slug extractor
// ---------------------------------------------------------------------------

export function getImgSlug(imgUrl) {
  return imgUrl.split("/").pop().replace(/\.(svg|webp|png|jpg)$/, "");
}

// ---------------------------------------------------------------------------
// Get animation config from a weapon item
// ---------------------------------------------------------------------------

export function getWeaponConfig(item) {
  if (item.type === "starshipweapon2e") {
    const slug = getImgSlug(item.img);
    return STARSHIP_WEAPON_CONFIGS[slug] ?? null;
  }
  if (item.type === "characterweapon2e") {
    return resolveGroundWeaponConfig(item);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build a weapon context object for the dice roller
// ---------------------------------------------------------------------------

/**
 * Build a weapon context object for use with openPlayerRoller / openNpcRoller.
 * Extracts the name, torpedo flag, damage, and quality string from a weapon item.
 * @param {Item} weapon - A starshipweapon2e item
 * @returns {{ name: string, isTorpedo: boolean, damage: number, qualities: string }}
 */
export function buildWeaponContext(weapon) {
  const config    = getWeaponConfig(weapon);
  const isTorpedo = config?.type === "torpedo";
  const QUALITY_LABELS = {
    area:        "Area",         calibration: "Calibration", cumbersome:  "Cumbersome",
    dampening:   "Dampening",    depleting:   "Depleting",   devastating: "Devastating",
    highyield:   "High Yield",   intense:     "Intense",     jamming:     "Jamming",
    persistent:  "Persistent",   piercing:    "Piercing",    slowing:     "Slowing",
    spread:      "Spread",
  };
  const q     = weapon.system?.qualities ?? {};
  const parts = [];
  for (const [k, lbl] of Object.entries(QUALITY_LABELS)) {
    if (q[k]) parts.push(lbl);
  }
  if ((q.hiddenx   ?? 0) > 0) parts.push(`Hidden ${q.hiddenx}`);
  if ((q.versatilex ?? 0) > 0) parts.push(`Versatile ${q.versatilex}`);
  const isArray  = config?.type === "beam"    && (config?.isArray ?? false);
  const isSalvo  = config?.type === "torpedo" && (config?.salvo  ?? false);
  return {
    name:      weapon.name,
    isTorpedo,
    isArray,
    isSalvo,
    damage:    weapon.system?.damage ?? 0,
    qualities: parts.join(", ") || "None",
  };
}

// ---------------------------------------------------------------------------
// Sequencer helper
// ---------------------------------------------------------------------------

function seq() {
  if (!window.Sequence) {
    ui.notifications.error("STA 2e Toolkit: Sequencer module is required for combat animations.");
    throw new Error("Sequencer not available");
  }
  return new window.Sequence();
}

function withSound(s, soundPath) {
  return soundPath ? s.sound().file(soundPath).volume(1) : s;
}

// ---------------------------------------------------------------------------
// Ship-scale firing functions
// ---------------------------------------------------------------------------

function getTimingBeamTravel() {
  try { return game.settings.get("sta2e-toolkit", "timingBeamTravel") || 3800; }
  catch { return 3800; }
}
function getTimingGroundBeamTravel() {
  try { return game.settings.get("sta2e-toolkit", "timingGroundBeamTravel") || 600; }
  catch { return 600; }
}
function getTimingTorpedoImpact() {
  try { return game.settings.get("sta2e-toolkit", "timingTorpedoImpact") || 1000; }
  catch { return 1000; }
}

async function fireBeamSingle(config, isHit, token, targets) {
  for (const target of targets) {
    const soundPath = isHit ? config.sound : (config.missSound ?? config.sound);
    let s = withSound(seq(), soundPath).wait(50);
    if (isHit) {
      s.effect().file(config.effect).scale(0.5).atLocation(token).stretchTo(target)
       .wait(getTimingBeamTravel())
       .effect().file(config.impact).atLocation(target).scaleToObject(1.5);
    } else {
      s.effect().file(config.effect).atLocation(token).stretchTo(target).missed();
    }
    s.play();
  }
}

async function fireBeamSpread(config, isHit, token, targets) {
  for (const target of targets) {
    const soundPath = isHit ? config.sound : (config.missSound ?? config.sound);
    let s = withSound(seq(), soundPath).wait(50);
    if (isHit) {
      const shots = config.shots ?? 4;
      for (let i = 0; i < shots; i++) {
        s = s.effect().file(config.effect).scale(0.5)
             .atLocation(token, { randomOffset: true })
             .stretchTo(target, { randomOffset: true })
             .waitUntilFinished(-200);
      }
      s.effect().file(config.impact).atLocation(target).scaleToObject(1.5);
    } else {
      s.effect().file(config.effect).atLocation(token).stretchTo(target).missed();
    }
    s.play();
  }
}

async function fireCannons(config, isHit, token, targets) {
  for (const target of targets) {
    let s = withSound(seq(), config.sound).wait(50);
    if (isHit) {
      for (let i = 0; i < (config.shots ?? 4); i++) {
        s = s.effect().file(config.effect)
             .atLocation(token, { randomOffset: true })
             .stretchTo(target, { randomOffset: true }).wait(50);
      }
      s.effect().file(config.impact).atLocation(target).scaleToObject(1.5);
    } else {
      s.effect().file(config.effect).atLocation(token).stretchTo(target).missed();
    }
    s.play();
  }
}

async function fireTorpedoSingle(config, isHit, token, targets) {
  for (const target of targets) {
    const soundPath = config.sound;
    const s = seq();
    if (soundPath) s.sound().file(soundPath).volume(1);
    s.wait(150);
    if (isHit) {
      s.effect().file(config.effect).atLocation(token).stretchTo(target);
      s.wait(getTimingTorpedoImpact());
      s.effect().file(config.explosion).atLocation(target).scaleToObject(1.5);
    } else {
      s.effect().file(config.effect).atLocation(token).stretchTo(target).missed();
    }
    s.play();
  }
}

async function fireTorpedoSalvo(config, isHit, token, targets, salvoMode) {
  const count = config.torpedoes ?? 3;

  if (salvoMode === "spread") {
    // One torpedo per target — same as single but faster succession across targets
    for (const target of targets) {
      const soundPath = config.sound;
      const s = seq();
      if (soundPath) s.sound().file(soundPath).volume(1);
      s.wait(100);
      if (isHit) {
        s.effect().file(config.effect).atLocation(token).stretchTo(target);
        s.wait(getTimingTorpedoImpact());
        s.effect().file(config.explosion).atLocation(target).scaleToObject(1.5);
      } else {
        s.effect().file(config.effect).atLocation(token).stretchTo(target).missed();
      }
      s.play();
    }
  } else {
    // Area salvo — fire `count` torpedoes at the primary target with staggered
    // timing and fanned launch offsets so each shot is visually distinct
    for (const target of targets) {
      const soundPath = config.sound;
      const s = seq();

      if (isHit) {
        for (let i = 0; i < count; i++) {
          if (i > 0) s.wait(220);
          if (soundPath) s.sound().file(soundPath).volume(i === 0 ? 1 : 0.7);
          s.effect()
            .file(config.effect)
            .atLocation(token, { randomOffset: 0.4 })
            .stretchTo(target, { randomOffset: 0.3 });
        }
        // Explosion after the last torpedo arrives
        s.wait(getTimingTorpedoImpact());
        s.effect().file(config.explosion).atLocation(target).scaleToObject(2.0);
      } else {
        // One missed shot is enough visually
        if (soundPath) s.sound().file(soundPath).volume(1);
        s.effect().file(config.effect).atLocation(token).stretchTo(target).missed();
      }

      s.play();
    }
  }
}

// ---------------------------------------------------------------------------
// Ground-scale firing functions
// ---------------------------------------------------------------------------

// Person-scale ranged energy bolt
// Phaser uses FireballBeam (3800ms travel), others use short Bullet/LaserShot (~600ms)
async function fireGroundBeam(config, isHit, token, targets) {
  const travelMs = config.color === "orange" ? getTimingBeamTravel() : getTimingGroundBeamTravel();
  for (const target of targets) {
    const soundPath = isHit ? config.sound : (config.missSound ?? config.sound);
    const animPath  = isHit ? config.effect : (config.missEffect ?? config.effect);
    let s = withSound(seq(), soundPath).wait(50);
    if (isHit) {
      s.effect().file(animPath).scale(0.45)
       .atLocation(token).stretchTo(target)
       .wait(travelMs)
       .effect().file(config.impact).atLocation(target).scaleToObject(1.5);
    } else {
      s.effect().file(animPath).scale(0.45)
       .atLocation(token).stretchTo(target).missed();
    }
    s.play();
  }
}

// Melee — strike effect plays at the attacker, no stretching to preserve full animation size
async function fireMelee(config, isHit, token, targets) {
  for (const target of targets) {
    const soundPath = isHit ? config.sound : (config.missSound ?? config.sound);
    // Flip animation when target is to the left of the attacker
    const tx    = token?.x  ?? token?.document?.x  ?? 0;
    const tt    = target?.x ?? target?.document?.x ?? 0;
    const flipX = tt < tx;
    let s = withSound(seq(), soundPath).wait(50);
    if (isHit) {
      s.effect().file(config.effect).scale(1.2)
       .atLocation(token)
       .mirrorX(flipX)
       .waitUntilFinished(-200)
       .effect().file(config.impact).atLocation(target).scaleToObject(1.5);
    } else {
      s.effect().file(config.effect).scale(1.2)
       .atLocation(token)
       .mirrorX(flipX)
       .missed();
    }
    s.play();
  }
}

async function fireGrenade(config, _isHit, _token, targets) {
  for (const target of targets) {
    withSound(seq(), config.sound).wait(200)
      .effect().file(config.explosion).atLocation(target).scaleToObject(2)
      .play();
  }
}

// Anesthetic Hypospray — boon/condition aura plays on the target
async function fireHypospray(config, isHit, _token, targets) {
  for (const target of targets) {
    const s = withSound(seq(), config.sound).wait(100);
    if (isHit) {
      s.effect()
        .file(config.effect)
        .atLocation(target)
        .scaleToObject(1.4)
        .fadeIn(200).fadeOut(400);
    }
    s.play();
  }
}

// ---------------------------------------------------------------------------
// Tactical effect functions
// ---------------------------------------------------------------------------

export async function fireRam(attackerToken, targetToken) {
  withSound(seq(), snd("sndRam"))
    .effect()
      .file(groundCrackEffect())
      .atLocation(targetToken).scaleToObject(2.5)
    .wait(500)
    .effect().file(explosionEffect("orange")).atLocation(targetToken).scaleToObject(2)
    .wait(200)
    .effect().file(impactEffect("blue")).atLocation(attackerToken).scaleToObject(1.5)
    .play();
}

export async function fireScanForWeakness(attackerToken, targetToken) {
  withSound(seq(), snd("sndScanForWeakness"))
    .effect()
      .file(radarScanEffect())
      .atLocation(targetToken).scaleToObject(1.8).duration(2000)
    .play();
}

export async function fireAttackPattern(token) {
  withSound(seq(), snd("sndAttackPattern"))
    .effect()
      .file("jb2a.cast_generic.fire.01.orange")
      .atLocation(token)
      .scaleToObject(1.5)
      .fadeIn(150).fadeOut(400)
    .play();
}

export async function fireDefenseMode(token, type) {
  const soundKey = type === "evasive-action" ? "sndEvasiveAction" : "sndDefensiveFire";

  if (type === "evasive-action") {
    withSound(seq(), snd(soundKey))
      .effect()
        .file("jb2a.extras.tmfx.outpulse.line.02.normal")
        .atLocation(token)
        .scaleToObject(1.8)
        .fadeIn(100).fadeOut(400)
      .play();
  } else {
    // Defensive Fire
    withSound(seq(), snd(soundKey))
      .effect()
        .file("jb2a.zoning.inward.circle.once.bluegreen.01.01")
        .atLocation(token)
        .scaleToObject(1.8)
        .fadeIn(150).fadeOut(400)
      .play();
  }
}

export async function fireTargetingSolution(attackerToken, targetToken) {
  // Plays on the TARGET — inward indicator showing sensors locked on
  seq()
    .effect()
      .file("jb2a.zoning.inward.indicator.once.bluegreen.02.01")
      .atLocation(targetToken)
      .scaleToObject(1.8)
      .fadeIn(150).fadeOut(500)
    .play();
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function fireWeapon(config, isHit, token, targets, { spreadDeclared = false, salvoMode = "area" } = {}) {
  if (!config) return;

  switch (config.type) {
    // Ship-scale weapons
    case "beam":
      if (spreadDeclared || salvoMode === "spread") await fireBeamSpread(config, isHit, token, targets);
      else await fireBeamSingle(config, isHit, token, targets);
      break;
    case "cannon":
      await fireCannons(config, isHit, token, targets);
      break;
    case "torpedo":
      if (config.salvo) await fireTorpedoSalvo(config, isHit, token, targets, salvoMode);
      else              await fireTorpedoSingle(config, isHit, token, targets);
      break;

    // Ground-scale weapons
    case "ground-beam":
      await fireGroundBeam(config, isHit, token, targets);
      break;
    case "melee-blade":
    case "melee-dagger":
    case "melee-heavy":
    case "melee-bludgeon":
    case "melee-unarmed":
    case "melee-ushaan":
      await fireMelee(config, isHit, token, targets);
      break;
    case "grenade":
      await fireGrenade(config, isHit, token, targets);
      break;
    case "hypospray":
      await fireHypospray(config, isHit, token, targets);
      break;

    default:
      console.warn(`STA2e Toolkit | Unknown weapon type: ${config.type}`);
  }
}
