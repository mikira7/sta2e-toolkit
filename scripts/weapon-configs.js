import {
  getClosestShipArrayCurvePoint,
  getClosestShipWeaponEmitterPoint,
  getShipHitLocationPointForShot,
  getShipWeaponEmitterAnchors,
  isShipArrayWeapon,
  shipWeaponAnchorToCanvasPoint,
} from "./ship-vfx-anchors.js";
import {
  fireNativeWeaponVFX,
  playArrayCurveChargeVFX,
  previewShipWeaponVFX,
  shouldUseNativeWeaponVFX,
} from "./native-weapon-vfx.js";

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

// FireballBeam - long ship-scale energy beam.
// Use the raw path with manual template data so the beam keeps the smaller
// raw-file sizing while still anchoring stretchTo at the visible beam start.
const SHIP_PHASER_BEAM = "modules/JB2A_DnD5e/Library/3rd_Level/Fireball/FireballBeam_01_Orange_90ft_4000x400.webm";
const SHIP_PHASER_BEAM_TEMPLATE = Object.freeze({ gridSize: 100, startPoint: 200, endPoint: 200 });
const SHIP_RANGED_TRAVEL_TEMPLATE = Object.freeze({ gridSize: 100, startPoint: 200, endPoint: 200 });
// Lead-in padding for a raw Scorching Ray .webm. Tune `startPoint` until the
// ray origin sits on the emitter; read JB2A's own value with
//   Sequencer.Database.getEntry(Sequencer.Database.searchFor("scorching_ray")[0])?.template
const SHIP_SCORCHING_RAY_TEMPLATE = Object.freeze({ gridSize: 100, startPoint: 260, endPoint: 200 });
const SHIP_IMPACT_EFFECT_BASE_SIZE = 400;
const SHIP_PHOTON_TORPEDO_EFFECT = "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bullet_01_Regular_Orange_90ft_4000x400.webm";
const SHIP_PHOTON_TORPEDO_TINT = 0xff3333;

function beamEffect(color) {
  const weaponKey = color === "green" ? "disruptor" : color === "purple" ? "polaron" : "phaser";
  return animOverride("shipWeapons", weaponKey, "animHit")
    ?? (isPatron()
      ? (color === "orange" ? SHIP_PHASER_BEAM : `modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Ranged/Snipe_01_Regular_${{ green: "Green", purple: "Purple", blue: "Blue" }[color] ?? "Orange"}_90ft_4000x400.webm`)
      : color === "orange" ? SHIP_PHASER_BEAM
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
      : SHIP_PHOTON_TORPEDO_EFFECT);
}

function cannonEffect(color) {
  const weaponKey = color === "green" ? "disruptorCannon" : color === "purple" ? "polaronCannon" : "phaserCannon";
  return animOverride("shipWeapons", weaponKey, "animHit")
    ?? `${WA}/LaserShot_01_Regular_${{ orange: "Orange", green: "Green", purple: "Blue", blue: "Blue" }[color] ?? "Orange"}_30ft_1600x400.webm`;
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

function withNativeVfx(config, nativeVfxKey) {
  return Object.assign(config, { nativeVfxKey });
}

// ---------------------------------------------------------------------------
// Starship Weapon Configs — keyed by img slug
// ---------------------------------------------------------------------------

export const STARSHIP_WEAPON_CONFIGS = {

  "weapon-phaser-array":        withNativeVfx(shipBeam("Phaser Arrays",        "orange", 4, true), "weapon-phaser-array"),
  "weapon-phaser-bank":         withNativeVfx(shipBeam("Phaser Banks",         "orange", 3),       "weapon-phaser-bank"),
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

  "weapon-photon-torpedo":        withNativeVfx(shipTorpedo("Photon Torpedo",        "red",   false, 1, "photon"), "weapon-photon-torpedo"),
  "weapon-photon-torpedo-salvo":  withNativeVfx(shipTorpedo("Photon Torpedo Salvo",  "red",   true,  3, "photon"), "weapon-photon-torpedo-salvo"),
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
 * @returns {{ name: string, weaponId: string|null, shipActorId: string|null, isTorpedo: boolean, damage: number, qualities: string }}
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
  const isSalvo  = config?.type === "torpedo" && (config?.salvo  ?? false) && !q.cumbersome;
  return {
    name:      weapon.name,
    weaponId:  weapon.id ?? null,
    shipActorId: weapon.parent?.id ?? null,
    isTorpedo,
    isArray,
    isSalvo,
    cumbersome: !!q.cumbersome,
    dampening:  !!q.dampening,
    depleting:  !!q.depleting,
    persistent: !!q.persistent,
    damage:    weapon.system?.damage ?? 0,
    qualities: parts.join(", ") || "None",
  };
}

// ---------------------------------------------------------------------------
// Sequencer helper
// ---------------------------------------------------------------------------

function combatAnimationsAvailable() {
  return !!window.Sequence;
}

function seq() {
  if (!combatAnimationsAvailable()) throw new Error("Sequencer not available");
  return new window.Sequence();
}

function withSound(s, soundPath) {
  return soundPath ? s.sound().file(soundPath).volume(1) : s;
}

function useAlphaAwareWeaponHitPoints() {
  try { return game.settings.get("sta2e-toolkit", "alphaAwareWeaponHitPoints") !== false; }
  catch { return true; }
}

const TOKEN_ALPHA_MASK_CACHE = new Map();
const TOKEN_ALPHA_MASK_MAX_SIZE = 96;
const TOKEN_ALPHA_THRESHOLD = 32;

function tokenTextureSource(token) {
  return token?.document?.texture?.src
    ?? token?.texture?.src
    ?? token?.document?.img
    ?? token?.actor?.img
    ?? null;
}

async function getTokenAlphaMask(src) {
  if (!src) return null;
  if (TOKEN_ALPHA_MASK_CACHE.has(src)) return TOKEN_ALPHA_MASK_CACHE.get(src);

  const maskPromise = new Promise(resolve => {
    let img;
    try {
      img = new Image();
    } catch {
      resolve(null);
      return;
    }
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        if (!naturalWidth || !naturalHeight) {
          resolve(null);
          return;
        }

        const scale = Math.min(1, TOKEN_ALPHA_MASK_MAX_SIZE / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * scale));
        const height = Math.max(1, Math.round(naturalHeight * scale));
        const canvasEl = document.createElement("canvas");
        canvasEl.width = width;
        canvasEl.height = height;
        const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const opaque = [];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (data[((y * width + x) * 4) + 3] >= TOKEN_ALPHA_THRESHOLD) opaque.push({ x, y });
          }
        }
        resolve(opaque.length ? { width, height, opaque } : null);
      } catch (err) {
        console.warn("STA2e Toolkit | Could not sample token alpha for weapon animation:", err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  TOKEN_ALPHA_MASK_CACHE.set(src, maskPromise);
  return maskPromise;
}

function tokenCenter(token) {
  if (token?.center) return { x: token.center.x, y: token.center.y };
  const doc = token?.document ?? token;
  const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  const width = (doc?.width ?? 1) * gridSize;
  const height = (doc?.height ?? 1) * gridSize;
  return {
    x: (doc?.x ?? token?.x ?? 0) + width / 2,
    y: (doc?.y ?? token?.y ?? 0) + height / 2,
  };
}

function tokenDimensions(token) {
  const doc = token?.document ?? token;
  const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  return {
    width: token?.w ?? ((doc?.width ?? 1) * gridSize),
    height: token?.h ?? ((doc?.height ?? 1) * gridSize),
  };
}

async function randomOpaqueTokenPoint(token) {
  if (!useAlphaAwareWeaponHitPoints()) return null;

  const mask = await getTokenAlphaMask(tokenTextureSource(token));
  if (!mask) return null;

  const pixel = mask.opaque[Math.floor(Math.random() * mask.opaque.length)];
  if (!pixel) return null;

  const doc = token?.document ?? token;
  const texture = doc?.texture ?? {};
  const anchorX = Number(texture.anchorX ?? 0.5);
  const anchorY = Number(texture.anchorY ?? 0.5);
  const scaleX = Number(texture.scaleX ?? 1) || 1;
  const scaleY = Number(texture.scaleY ?? 1) || 1;
  const signX = scaleX < 0 ? -1 : 1;
  const signY = scaleY < 0 ? -1 : 1;
  const { width, height } = tokenDimensions(token);
  const u = (pixel.x + Math.random()) / mask.width;
  const v = (pixel.y + Math.random()) / mask.height;
  const localX = (u - anchorX) * width * Math.abs(scaleX) * signX;
  const localY = (v - anchorY) * height * Math.abs(scaleY) * signY;
  const rotation = Number(doc?.rotation ?? token?.rotation ?? 0) * (Math.PI / 180);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const center = tokenCenter(token);

  return {
    x: center.x + localX * cos - localY * sin,
    y: center.y + localX * sin + localY * cos,
  };
}

function offsetForTokenPoint(token, point) {
  if (!point) return null;
  const center = tokenCenter(token);
  return { x: point.x - center.x, y: point.y - center.y };
}

function sequenceLocation(token, point, fallbackOptions = undefined) {
  const offset = offsetForTokenPoint(token, point);
  if (offset) return { location: token, options: { offset } };
  return { location: token, options: fallbackOptions };
}

function pointSequenceLocation(point) {
  return point ? { location: point } : null;
}

function shipWeaponEmitterPointForShot(sourceToken, weapon, targetPoint, shotIndex = 0) {
  if (!weapon || !targetPoint) return null;

  if (isShipArrayWeapon(weapon)) {
    const curvePoint = getClosestShipArrayCurvePoint(sourceToken, weapon, targetPoint);
    if (curvePoint) return curvePoint;
  }

  const anchors = getShipWeaponEmitterAnchors(sourceToken, weapon);
  if (!anchors.length) return null;
  if (anchors.length === 1 || !shotIndex) return getClosestShipWeaponEmitterPoint(sourceToken, weapon, targetPoint);

  const points = anchors
    .map(anchor => shipWeaponAnchorToCanvasPoint(sourceToken, weapon, anchor, null, targetPoint))
    .filter(Boolean)
    .sort((a, b) => (
      Math.hypot(a.x - targetPoint.x, a.y - targetPoint.y)
      - Math.hypot(b.x - targetPoint.x, b.y - targetPoint.y)
    ));
  return points.length ? points[Math.abs(shotIndex) % points.length] : null;
}

async function shipWeaponSourceLocation(sourceToken, targetToken, weapon, targetPoint, fallbackOptions = undefined, shotIndex = 0) {
  const aimingPoint = targetPoint ?? tokenCenter(targetToken);
  const emitterPoint = shipWeaponEmitterPointForShot(sourceToken, weapon, aimingPoint, shotIndex);
  if (emitterPoint) return sequenceLocation(sourceToken, emitterPoint);
  return sequenceLocation(sourceToken, await randomOpaqueTokenPoint(sourceToken), fallbackOptions);
}

function shipWeaponMissSourceLocation(sourceToken, targetToken, weapon, shotIndex = 0) {
  const aimingPoint = tokenCenter(targetToken);
  const emitterPoint = shipWeaponEmitterPointForShot(sourceToken, weapon, aimingPoint, shotIndex);
  if (emitterPoint) return sequenceLocation(sourceToken, emitterPoint);
  return sequenceLocation(sourceToken, null);
}

function shipWeaponMissTargetLocation(targetToken) {
  return { location: tokenCenter(targetToken) };
}

async function shipShotLocations(sourceToken, targetToken, { sourceOptions = undefined, targetOptions = undefined, weapon = null, shotIndex = 0, targetSystem = null } = {}) {
  const sourceReference = tokenCenter(sourceToken);
  const hitLocationPoint = targetSystem
    ? getShipHitLocationPointForShot(targetToken, targetSystem, sourceReference, shotIndex)
    : null;
  const targetPoint = hitLocationPoint ?? await randomOpaqueTokenPoint(targetToken);
  return {
    source: await shipWeaponSourceLocation(sourceToken, targetToken, weapon, targetPoint, sourceOptions, shotIndex),
    target: pointSequenceLocation(targetPoint ?? tokenCenter(targetToken)),
    impact: sequenceLocation(targetToken, targetPoint, targetOptions),
  };
}

function atSequenceLocation(effect, location) {
  return location?.options
    ? effect.atLocation(location.location, location.options)
    : effect.atLocation(location.location);
}

function stretchToSequenceLocation(effect, location) {
  return location?.options
    ? effect.stretchTo(location.location, location.options)
    : effect.stretchTo(location.location);
}

export function getStarshipDamageAnimationRepeatCount(finalDamage) {
  const damage = Math.max(0, Number(finalDamage) || 0);
  if (damage >= 8) return 3;
  if (damage >= 4) return 2;
  return 1;
}

function normalizeRepeatCount(repeatCount) {
  const count = Math.floor(Number(repeatCount) || 1);
  return Math.min(3, Math.max(1, count));
}

function cannonShotCount(repeatCount) {
  return normalizeRepeatCount(repeatCount) * 2;
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

const ARRAY_WEAPON_ANIMATION_SETTLE_MS = 400;

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function getTimingArrayBeamAnimation() {
  return Math.max(250, Number(getTimingBeamTravel()) || 0) + ARRAY_WEAPON_ANIMATION_SETTLE_MS;
}

async function playSequenceAndWaitForArrayBeam(sequence) {
  await Promise.all([
    sequence.play(),
    _delay(getTimingArrayBeamAnimation()),
  ]);
}

function shipTravelEffect(effect, config) {
  const effectPath = String(config?.effect ?? "");
  // Database keys ("jb2a.*") already carry their own template, so stretchTo
  // trims the lead-in for free. Only raw .webm paths need a manual template.
  if (effectPath.startsWith("jb2a.")) return effect;
  if (effectPath === SHIP_PHASER_BEAM) return effect.template(SHIP_PHASER_BEAM_TEMPLATE);
  if (effectPath === SHIP_PHOTON_TORPEDO_EFFECT) return effect.tint(SHIP_PHOTON_TORPEDO_TINT);
  if (/scorching_?ray/i.test(effectPath)) return effect.template(SHIP_SCORCHING_RAY_TEMPLATE);
  if (effectPath.includes("/Snipe_01_Regular_")) return effect.template(SHIP_RANGED_TRAVEL_TEMPLATE);
  if (effectPath.includes("/LaserShot_01_Regular_")) return effect.template(SHIP_RANGED_TRAVEL_TEMPLATE);
  return effect;
}

function shipImpactScaleForToken(token, requestedScale = 1.5, maxTokenRatio = 0.85) {
  const { width, height } = tokenDimensions(token);
  const tokenLimit = Math.max(1, Math.min(width, height) * maxTokenRatio);
  const maxScale = tokenLimit / SHIP_IMPACT_EFFECT_BASE_SIZE;
  return Math.max(0.05, Math.min(requestedScale, maxScale));
}

function shipImpactEffect(effect, targetToken, scale = 1.5, maxTokenRatio = 0.85) {
  return effect.scale(shipImpactScaleForToken(targetToken, scale, maxTokenRatio));
}

function _hexColorForWeaponConfig(config, fallback = 0xff9a33) {
  const color = String(config?.color ?? "").toLowerCase();
  if (color === "green") return 0x66ff99;
  if (color === "purple") return 0xaa66ff;
  if (color === "blue") return 0x66ccff;
  if (color === "red") return 0xff3333;
  return fallback;
}

async function playSequencerArrayCurveCharge(config, sourceToken, weapon, targetPoint, isHit) {
  if (!isShipArrayWeapon(weapon) || !targetPoint) return null;
  try {
    return await playArrayCurveChargeVFX(sourceToken, weapon, targetPoint, {
      isHit,
      color: _hexColorForWeaponConfig(config),
      coreColor: 0xfff2c0,
    });
  } catch (err) {
    console.warn("STA2e Toolkit | Array curve charge VFX failed:", err);
    return null;
  }
}

export async function previewShipWeaponAnimation(sourceToken, weapon, targetPoint, options = {}) {
  if (!sourceToken || !weapon || !targetPoint) return false;
  const config = getWeaponConfig(weapon);
  if (!config) return false;

  if (config.nativeVfxKey && shouldUseNativeWeaponVFX(config.nativeVfxKey)) {
    return previewShipWeaponVFX(sourceToken, weapon, targetPoint, options);
  }

  if (!combatAnimationsAvailable()) {
    ui.notifications.warn("STA2e Toolkit: Sequencer is required to preview the current JB2A weapon animation.");
    return false;
  }

  const sourcePoint = shipWeaponEmitterPointForShot(sourceToken, weapon, targetPoint, 0);
  const source = sourcePoint
    ? sequenceLocation(sourceToken, sourcePoint)
    : sequenceLocation(sourceToken, null);
  const target = pointSequenceLocation(targetPoint);
  const s = seq();

  if (isShipArrayWeapon(weapon)) {
    await playSequencerArrayCurveCharge(config, sourceToken, weapon, targetPoint, true);
  }

  stretchToSequenceLocation(
    atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), source),
    target
  );

  if (config.impact) {
    s.wait(Math.min(650, Math.max(180, Number(options.beamDuration) || 420)));
    shipImpactEffect(atSequenceLocation(s.effect().file(config.impact), target), { w: 100, h: 100, document: { width: 1, height: 1 } }, 0.65);
  }

  await s.play();
  return true;
}

async function fireBeamSingle(config, isHit, token, targets, repeatCount = 1, weapon = null, targetSystem = null) {
  const repeats = isHit ? normalizeRepeatCount(repeatCount) : 1;
  for (const target of targets) {
    const soundPath = isHit ? config.sound : (config.missSound ?? config.sound);
    let s = seq();
    if (isHit) {
      if (isShipArrayWeapon(weapon)) {
        for (let i = 0; i < repeats; i++) {
          const locations = await shipShotLocations(token, target, { weapon, shotIndex: i, targetSystem });
          await playSequencerArrayCurveCharge(config, token, weapon, locations.target?.location, true);
          let shot = seq();
          shot = withSound(shot, soundPath).wait(50);
          stretchToSequenceLocation(
            atSequenceLocation(shipTravelEffect(shot.effect().file(config.effect), config), locations.source),
            locations.target
          )
            .wait(getTimingBeamTravel());
          shipImpactEffect(atSequenceLocation(shot.effect().file(config.impact), locations.impact), target, 1.5);
          await playSequenceAndWaitForArrayBeam(shot);
          if (i < repeats - 1) await _delay(250);
        }
        continue;
      }

      for (let i = 0; i < repeats; i++) {
        const locations = await shipShotLocations(token, target, { weapon, shotIndex: i, targetSystem });
        s = withSound(s, soundPath).wait(50);
        stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
          locations.target
        )
          .wait(getTimingBeamTravel());
        shipImpactEffect(atSequenceLocation(s.effect().file(config.impact), locations.impact), target, 1.5);
        if (i < repeats - 1) s.wait(250);
      }
    } else {
      s = withSound(s, soundPath).wait(50);
      const missTarget = shipWeaponMissTargetLocation(target);
      await playSequencerArrayCurveCharge(config, token, weapon, missTarget.location, false);
      stretchToSequenceLocation(
        atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon)),
        missTarget
      ).missed();
    }
    await s.play();
  }
}

async function fireBeamSpread(config, isHit, token, targets, repeatCount = 1, weapon = null, targetSystem = null) {
  const repeats = isHit ? normalizeRepeatCount(repeatCount) : 1;
  for (const target of targets) {
    const soundPath = isHit ? config.sound : (config.missSound ?? config.sound);
    let s = seq();
    if (isHit) {
      if (isShipArrayWeapon(weapon)) {
        let impactLocation = sequenceLocation(target, null);
        for (let i = 0; i < repeats; i++) {
          const locations = await shipShotLocations(token, target, {
            sourceOptions: { randomOffset: true },
            targetOptions: { randomOffset: true },
            weapon,
            shotIndex: i,
            targetSystem,
          });
          impactLocation = locations.impact;
          await playSequencerArrayCurveCharge(config, token, weapon, locations.target?.location, true);
          let shot = seq();
          shot = withSound(shot, soundPath).wait(50);
          stretchToSequenceLocation(
            atSequenceLocation(shipTravelEffect(shot.effect().file(config.effect), config), locations.source),
            locations.target
          )
            .wait(getTimingBeamTravel());
          if (i === repeats - 1) {
            shipImpactEffect(atSequenceLocation(shot.effect().file(config.impact), impactLocation), target, 1.5);
          }
          await playSequenceAndWaitForArrayBeam(shot);
          if (i < repeats - 1) await _delay(250);
        }
        continue;
      }

      let impactLocation = sequenceLocation(target, null);
      for (let i = 0; i < repeats; i++) {
        const locations = await shipShotLocations(token, target, {
          sourceOptions: { randomOffset: true },
          targetOptions: { randomOffset: true },
          weapon,
          shotIndex: i,
          targetSystem,
        });
        impactLocation = locations.impact;
        s = withSound(s, soundPath).wait(50);
        s = stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
          locations.target
        ).waitUntilFinished(-200);
      }
      shipImpactEffect(atSequenceLocation(s.effect().file(config.impact), impactLocation), target, 1.5);
    } else {
      s = withSound(s, soundPath).wait(50);
      const missTarget = shipWeaponMissTargetLocation(target);
      await playSequencerArrayCurveCharge(config, token, weapon, missTarget.location, false);
      stretchToSequenceLocation(
        atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon)),
        missTarget
      ).missed();
    }
    await s.play();
  }
}

async function fireCannons(config, isHit, token, targets, repeatCount = 1, weapon = null, targetSystem = null) {
  const shots = isHit ? cannonShotCount(repeatCount) : 1;
  for (const target of targets) {
    let s = seq();
    if (isHit) {
      let impactLocation = sequenceLocation(target, null);
      for (let i = 0; i < shots; i++) {
        const locations = await shipShotLocations(token, target, {
          sourceOptions: { randomOffset: true },
          targetOptions: { randomOffset: true },
          weapon,
          shotIndex: i,
          targetSystem,
        });
        impactLocation = locations.impact;
        s = withSound(s, config.sound).wait(50);
        s = stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
          locations.target
        ).wait(50);
      }
      shipImpactEffect(atSequenceLocation(s.effect().file(config.impact), impactLocation), target, 1.5);
    } else {
      s = withSound(s, config.sound).wait(50);
      stretchToSequenceLocation(
        atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon)),
        shipWeaponMissTargetLocation(target)
      ).missed();
    }
    await s.play();
  }
}

async function fireTorpedoSingle(config, isHit, token, targets, repeatCount = 1, weapon = null, targetSystem = null) {
  const repeats = isHit ? normalizeRepeatCount(repeatCount) : 1;
  for (const target of targets) {
    const soundPath = config.sound;
    const s = seq();
    if (isHit) {
      for (let i = 0; i < repeats; i++) {
        const locations = await shipShotLocations(token, target, { weapon, shotIndex: i, targetSystem });
        if (soundPath) s.sound().file(soundPath).volume(1);
        s.wait(150);
        stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
          locations.target
        );
        s.wait(getTimingTorpedoImpact());
        shipImpactEffect(atSequenceLocation(s.effect().file(config.explosion), locations.impact), target, 1.5);
        if (i < repeats - 1) s.wait(250);
      }
    } else {
      if (soundPath) s.sound().file(soundPath).volume(1);
      s.wait(150);
      stretchToSequenceLocation(
        atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon)),
        shipWeaponMissTargetLocation(target)
      ).missed();
    }
    await s.play();
  }
}

async function fireTorpedoSalvo(config, isHit, token, targets, salvoMode, repeatCount = 1, weapon = null, targetSystem = null) {
  const repeats = isHit ? normalizeRepeatCount(repeatCount) : 1;

  if (salvoMode === "spread") {
    // One torpedo per target — same as single but faster succession across targets
    for (const target of targets) {
      const soundPath = config.sound;
      const s = seq();
      if (isHit) {
        for (let r = 0; r < repeats; r++) {
          const locations = await shipShotLocations(token, target, { weapon, shotIndex: r, targetSystem });
          if (soundPath) s.sound().file(soundPath).volume(1);
          s.wait(100);
          stretchToSequenceLocation(
            atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
            locations.target
          );
          s.wait(getTimingTorpedoImpact());
          shipImpactEffect(atSequenceLocation(s.effect().file(config.explosion), locations.impact), target, 1.5);
          if (r < repeats - 1) s.wait(250);
        }
      } else {
        if (soundPath) s.sound().file(soundPath).volume(1);
        s.wait(100);
        stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon)),
          shipWeaponMissTargetLocation(target)
        ).missed();
      }
      await s.play();
    }
  } else {
    // Area salvo uses damage-scaled shots, capped at three, with staggered
    // timing and fanned launch offsets so each shot is visually distinct.
    for (const target of targets) {
      const soundPath = config.sound;
      const s = seq();

      if (isHit) {
        let explosionLocation = sequenceLocation(target, null);
        for (let i = 0; i < repeats; i++) {
          const locations = await shipShotLocations(token, target, {
            sourceOptions: { randomOffset: 0.4 },
            targetOptions: { randomOffset: 0.3 },
            weapon,
            shotIndex: i,
            targetSystem,
          });
          explosionLocation = locations.impact;
          if (i > 0) s.wait(220);
          if (soundPath) s.sound().file(soundPath).volume(i === 0 ? 1 : 0.7);
          stretchToSequenceLocation(
            atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
            locations.target
          );
        }
        // Explosion after the last torpedo arrives
        s.wait(getTimingTorpedoImpact());
        shipImpactEffect(atSequenceLocation(s.effect().file(config.explosion), explosionLocation), target, 2.0, 0.9);
      } else {
        // One missed shot is enough visually
        if (soundPath) s.sound().file(soundPath).volume(1);
        stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon)),
          shipWeaponMissTargetLocation(target)
        ).missed();
      }

      await s.play();
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
  if (!combatAnimationsAvailable()) return;

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
  if (!combatAnimationsAvailable()) return;

  withSound(seq(), snd("sndScanForWeakness"))
    .effect()
      .file(radarScanEffect())
      .atLocation(targetToken).scaleToObject(1.8).duration(2000)
    .play();
}

export async function fireAttackPattern(token) {
  if (!combatAnimationsAvailable()) return;

  withSound(seq(), snd("sndAttackPattern"))
    .effect()
      .file("jb2a.cast_generic.fire.01.orange")
      .atLocation(token)
      .scaleToObject(1.5)
      .fadeIn(150).fadeOut(400)
    .play();
}

export async function fireDefenseMode(token, type) {
  if (!combatAnimationsAvailable()) return;

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
  if (!combatAnimationsAvailable()) return;

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

export async function fireWeapon(config, isHit, token, targets, { spreadDeclared = false, salvoMode = "area", repeatCount = 1, weapon = null, targetSystem = null } = {}) {
  if (!config) return;
  const shipRepeatCount = isHit ? normalizeRepeatCount(repeatCount) : 1;

  if (await fireNativeWeaponVFX(config, isHit, token, targets, {
    spreadDeclared,
    salvoMode,
    repeatCount: shipRepeatCount,
    weapon,
    targetSystem,
  })) return;

  if (!combatAnimationsAvailable()) return;

  switch (config.type) {
    // Ship-scale weapons
    case "beam":
      if (spreadDeclared || salvoMode === "spread") await fireBeamSpread(config, isHit, token, targets, shipRepeatCount, weapon, targetSystem);
      else await fireBeamSingle(config, isHit, token, targets, shipRepeatCount, weapon, targetSystem);
      break;
    case "cannon":
      await fireCannons(config, isHit, token, targets, shipRepeatCount, weapon, targetSystem);
      break;
    case "torpedo":
      if (config.salvo) await fireTorpedoSalvo(config, isHit, token, targets, salvoMode, shipRepeatCount, weapon, targetSystem);
      else              await fireTorpedoSingle(config, isHit, token, targets, shipRepeatCount, weapon, targetSystem);
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
