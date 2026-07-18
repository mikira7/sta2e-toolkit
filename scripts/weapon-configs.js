import {
  getClosestShipArrayCurvePoint,
  getShipWeaponEmitterArcSelection,
  getShipHitLocationPointForShot,
  getShipWeaponVfxSettings,
  getShipWeaponEmitterAnchors,
  isShipArrayWeapon,
  shipEngineFacingToCanvasDeg,
  shipTargetBearingToLocalDeg,
  shipWeaponAnchorToCanvasPoint,
} from "./ship-vfx-anchors.js";
import {
  fireNativeWeaponVFX,
  playArrayCurveChargeVFX,
  previewShipWeaponVFX,
  shouldUseNativeWeaponVFX,
} from "./native-weapon-vfx.js";
import {
  playShieldImpactVFX,
} from "./shield-impact-vfx.js";
import {
  getSceneZones,
  getZoneAtPoint,
} from "./zone-data.js";
import { stampHullDecal } from "./hull-decals.js";

const SHIP_HULL_IMPACT_EFFECT = "jb2a.explosion_side.01.orange.2";

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
const SHIP_PHASER_BEAM = "modules/JB2A_DnD5e/Library/2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Orange_90ft_4000x400.webm";
const SHIP_PHASER_BEAM_TEMPLATE = Object.freeze({ gridSize: 100, startPoint: 260, endPoint: 200 });
const SHIP_RANGED_TRAVEL_TEMPLATE = Object.freeze({ gridSize: 100, startPoint: 200, endPoint: 200 });
// Lead-in padding for a raw Scorching Ray .webm. Tune `startPoint` until the
// ray origin sits on the emitter; read JB2A's own value with
//   Sequencer.Database.getEntry(Sequencer.Database.searchFor("scorching_ray")[0])?.template
const SHIP_SCORCHING_RAY_TEMPLATE = Object.freeze({ gridSize: 100, startPoint: 260, endPoint: 200 });
const SHIP_IMPACT_EFFECT_BASE_SIZE = 400;
const SHIP_PHOTON_TORPEDO_EFFECT = "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/Bullet_01_Regular_Orange_90ft_4000x400.webm";
const SHIP_PHOTON_TORPEDO_TINT = 0xff3333;
// Bundled custom torpedo sprites live here, named "<Type>-Torpedo.webm"
// (Photon-Torpedo.webm, Quantum-Torpedo.webm, …). Unlike the JB2A "bullet"
// strip (a long horizontal sprite drawn along its travel axis, stretched
// between source and target), these are square sprites that spin in place, so
// they must be FLOWN from emitter to target with a move-tween instead of
// stretchTo — see isMovingTorpedoSprite()/applyTorpedoTravel().
const SHIP_TORPEDO_SPRITE_DIR = "modules/sta2e-toolkit/assets/vfx";
const SHIP_PHOTON_TORPEDO_SPRITE = `${SHIP_TORPEDO_SPRITE_DIR}/Photon-Torpedo.webm`;
// Sprites shipped with the module. The cache is pre-seeded with these so every
// bundled type resolves even when FilePicker.browse can't list the module dir —
// which happens on hosted services like The Forge, where module assets are
// served from a CDN and a "data" browse fails or comes back empty. Without the
// seed, an empty cache made every torpedo type silently fall back to the
// photon sprite. Keep this list in sync with assets/vfx/*-Torpedo.webm.
const BUNDLED_TORPEDO_SPRITES = Object.freeze([
  "Blue-Photon-Torpedo.webm",
  "Chroniton-Torpedo.webm",
  "Gravimetric-Torpedo.webm",
  "Neutronic-Torpedo.webm",
  "Nuclear-Torpedo.webm",
  "Photon-Torpedo.webm",
  "Photonic-Torpedo.webm",
  "Plasma-Torpedo.webm",
  "Polaron-Torpedo.webm",
  "Positron-Torpedo.webm",
  "Quantum-Torpedo.webm",
  "Spatial-Torpedo.webm",
  "Tetryonic-Torpedo.webm",
  "Transphasic-Torpedo.webm",
  "Tricobalt-Torpedo.webm",
]);
// Lowercased basenames of "<Type>-Torpedo.webm" files present in the sprite
// dir. Seeded with the bundled sprites; refreshTorpedoSpriteCache() adds any
// user-dropped extras at ready. A type without its own file falls back to the
// photon sprite.
const TORPEDO_SPRITE_FILES = new Set(BUNDLED_TORPEDO_SPRITES.map(f => f.toLowerCase()));
// On-canvas size of the moving sprite, as a fraction of one grid square.
const SHIP_TORPEDO_SPRITE_GRID_FRACTION = 0.66;
const SHIP_WEAPON_FACING_DURATION_SCALE = 3.5;
const SHIP_WEAPON_FACING_SETTLE_MS = 900;
// Cinematic reposition glide: time per grid square, and a floor. Higher = slower.
const SHIP_WEAPON_REPOSITION_MS_PER_SQUARE = 900;
const SHIP_WEAPON_REPOSITION_MIN_MS = 700;
// Waypoint interval for the bow-first turning glide. Each waypoint is a
// document.update — a full server round-trip on hosted games (The Forge) —
// so waypoints are coarse and Foundry tweens between them. Per-frame stepping
// (16ms) stacked 24–90 round-trips in front of every shot, which is what made
// torpedoes fire late and out of sync as combat wore on.
const SHIP_WEAPON_REPOSITION_STEP_MS = 60;
// How hard the ship banks into the curve: extra heading swing, in degrees,
// blended in at mid-glide then unwound so it still ends on the firing facing.
const SHIP_WEAPON_REPOSITION_BANK_DEG = 6;
// Clear gap the ship keeps from a same-zone target, as a fraction of its own
// token length (edge to edge).
const SHIP_WEAPON_REPOSITION_TARGET_GAP = 0.3;
// Scale-based speed: each point of ship Scale above this baseline slows the
// glide and turn by SHIP_SCALE_SPEED_PER_POINT, clamped to the min/max factor.
// A bigger, more massive hull moves more ponderously than a runabout.
const SHIP_SCALE_SPEED_BASELINE = 1;
const SHIP_SCALE_SPEED_PER_POINT = 0.18;
const SHIP_SCALE_SPEED_MIN = 0.6;
const SHIP_SCALE_SPEED_MAX = 2.5;
const DISABLE_WEAPON_AUTO_ROTATE_FLAG = "disableWeaponAutoRotate";

function isWeaponAutoRotateDisabled(token) {
  const doc = token?.document ?? token;
  return !!doc?.getFlag?.("sta2e-toolkit", DISABLE_WEAPON_AUTO_ROTATE_FLAG);
}

/**
 * Duration multiplier from a ship's Scale stat (actor.system.scale). Higher
 * scale -> larger number -> longer animation -> slower movement and turning.
 * Returns 1 when the feature is off, the actor has no scale, or scale matches
 * the baseline. Clamped so extremes stay sane.
 */
function shipScaleSpeedFactor(token) {
  try {
    if (game.settings.get("sta2e-toolkit", "shipWeaponScaleSpeed") === false) return 1;
  } catch { /* feature on by default */ }
  const scale = Number(token?.actor?.system?.scale);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  const factor = 1 + (scale - SHIP_SCALE_SPEED_BASELINE) * SHIP_SCALE_SPEED_PER_POINT;
  return Math.max(SHIP_SCALE_SPEED_MIN, Math.min(SHIP_SCALE_SPEED_MAX, factor));
}

function beamEffect(color) {
  const weaponKey = color === "green" ? "disruptor" : color === "purple" ? "polaron" : "phaser";
  return animOverride("shipWeapons", weaponKey, "animHit")
    ?? (isPatron()
      ? (color === "orange" ? SHIP_PHASER_BEAM : `modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Ranged/Snipe_01_Regular_${{ green: "Green", purple: "Purple", blue: "Blue" }[color] ?? "Orange"}_90ft_4000x400.webm`)
      : color === "orange" ? SHIP_PHASER_BEAM
      : `modules/JB2A_DnD5e/Library/3rd_Level/Fireball/FireballBeam_01_Orange_30ft_1600x400.webm`);
}

const WA = "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged";

function photonTorpedoSpriteEnabled() {
  try { return game.settings.get("sta2e-toolkit", "photonTorpedoCustomSprite") === true; }
  catch { return false; }
}

// True for any bundled toolkit torpedo sprite ("<Type>-Torpedo.webm" in the
// sprite dir). These spin in place and are flown along a path; JB2A strips and
// other overrides are not, so they keep the stretchTo treatment.
function isMovingTorpedoSprite(effectPath) {
  const p = String(effectPath ?? "");
  return p.startsWith(`${SHIP_TORPEDO_SPRITE_DIR}/`) && /-Torpedo\.webm$/i.test(p);
}

// File name a torpedo type would use for its bundled sprite
// (e.g. "quantum" -> "Quantum-Torpedo.webm").
function torpedoSpriteFileName(torpedoType) {
  const t = torpedoType || "photon";
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}-Torpedo.webm`;
}

// Era variant sprites: "<Era>-<Type>-Torpedo.webm" (e.g. the TOS-era photon
// torpedo, "Blue-Photon-Torpedo.webm"). Keyed by `${era}:${torpedoType}`.
const TORPEDO_ERA_SPRITE_FILES = Object.freeze({
  "tos:photon": "Blue-Photon-Torpedo.webm",
});

// Resolves a torpedo type to its bundled sprite. An era-specific variant wins
// when its file exists; otherwise uses the per-type file when it exists in the
// sprite dir; otherwise falls back to the photon sprite until the per-type
// animation is added.
function torpedoSpritePath(torpedoType, era = "") {
  const eraFile = TORPEDO_ERA_SPRITE_FILES[`${era}:${torpedoType || "photon"}`];
  if (eraFile && TORPEDO_SPRITE_FILES.has(eraFile.toLowerCase())) {
    return `${SHIP_TORPEDO_SPRITE_DIR}/${eraFile}`;
  }
  const file = torpedoSpriteFileName(torpedoType);
  if (TORPEDO_SPRITE_FILES.has(file.toLowerCase())) return `${SHIP_TORPEDO_SPRITE_DIR}/${file}`;
  return SHIP_PHOTON_TORPEDO_SPRITE;
}

// Scans the sprite dir for "<Type>-Torpedo.webm" files so each torpedo type
// auto-picks up its own sprite once dropped in. Called at ready; safe to re-run
// (e.g. after adding new assets and reloading). The bundled sprites are always
// kept in the cache — a failed or empty browse (normal on The Forge, where
// module assets live on a CDN) must never wipe them, or every type would fall
// back to the photon sprite.
export async function refreshTorpedoSpriteCache() {
  try {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const response = await FP.browse("data", SHIP_TORPEDO_SPRITE_DIR);
    TORPEDO_SPRITE_FILES.clear();
    for (const f of BUNDLED_TORPEDO_SPRITES) TORPEDO_SPRITE_FILES.add(f.toLowerCase());
    for (const f of (response?.files ?? [])) {
      // Hosted services may return full URLs with query strings or encoded
      // characters — normalize down to the plain basename before matching.
      let name = String(f).split("/").pop().split("?")[0];
      try { name = decodeURIComponent(name); } catch { /* keep raw */ }
      if (/-Torpedo\.webm$/i.test(name)) TORPEDO_SPRITE_FILES.add(name.toLowerCase());
    }
  } catch (err) {
    console.warn("STA2e Toolkit | torpedo sprite scan failed (bundled sprites remain active):", err);
  }
}

// Maps a torpedo type to its animation-override weapon key (e.g. "quantum" ->
// "quantumTorpedo"), so every torpedo type carries its own override slot.
function torpedoWeaponKey(torpedoType) {
  return `${torpedoType || "photon"}Torpedo`;
}

// Capitalized sound-setting base for a torpedo type (e.g. "quantum" ->
// "sndShipTorpedoQuantum"). Types without a dedicated sound setting fall back
// through the lookup chain in shipTorpedo() to the generic torpedo sound.
function torpedoSoundBase(torpedoType) {
  const t = torpedoType || "photon";
  return `sndShipTorpedo${t.charAt(0).toUpperCase()}${t.slice(1)}`;
}

function torpedoEffect(color, torpedoType, era = "") {
  const weaponKey = torpedoWeaponKey(torpedoType);
  // An explicit per-weapon file override always wins.
  const override = animOverride("shipWeapons", weaponKey, "anim");
  if (override) return override;
  // With the toolkit's custom torpedo sprite enabled, each type uses its own
  // bundled sprite ("<Type>-Torpedo.webm") when present, falling back to the
  // photon sprite until that file is added.
  if (photonTorpedoSpriteEnabled()) return torpedoSpritePath(torpedoType, era);
  return (isPatron()
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

const PHASER_ERAS = Object.freeze(["ent", "tos", "tmp", "tng"]);
const PHASER_ERA_EFFECTS = Object.freeze({
  ent: {
    bank: "modules/JB2A_DnD5e/Library/2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Orange_90ft_4000x400.webm",
    array: "modules/JB2A_DnD5e/Library/2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Orange_90ft_4000x400.webm",
    cannon: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/LaserShot_01_Regular_Orange_90ft_4000x400.webm",
  },
  tos: {
    bank: "modules/jb2a_patreon/Library/2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Blue_90ft_4000x400.webm",
    array: "modules/jb2a_patreon/Library/2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Blue_90ft_4000x400.webm",
    cannon: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/LaserShot_01_Regular_Blue_90ft_4000x400.webm",
  },
  tmp: {
    bank: "modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Ranged/Snipe_01_Regular_Red_90ft_4000x400.webm",
    array: "modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Ranged/Snipe_01_Regular_Red_90ft_4000x400.webm",
    cannon: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/LaserShot_01_Regular_Red_90ft_4000x400.webm",
  },
  tng: {
    bank: "modules/JB2A_DnD5e/Library/2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Orange_90ft_4000x400.webm",
    array: "modules/JB2A_DnD5e/Library/2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Orange_90ft_4000x400.webm",
    cannon: "modules/JB2A_DnD5e/Library/Generic/Weapon_Attacks/Ranged/LaserShot_01_Regular_Orange_90ft_4000x400.webm",
  },
});
const PHASER_ERA_SOUND_PARTS = Object.freeze({
  ent: "Ent",
  tos: "Tos",
  tmp: "Tmp",
  tng: "Tng",
});
const PHASER_KIND_SOUND_PARTS = Object.freeze({
  bank: "Bank",
  array: "Array",
  cannon: "Cannon",
  lance: "Lance",
});

function normalizePhaserEra(era) {
  const value = String(era ?? "").toLowerCase();
  return PHASER_ERAS.includes(value) ? value : "";
}

function phaserWeaponKind(weapon, config) {
  const name = String(weapon?.name ?? config?.name ?? "").toLowerCase();
  const img = String(weapon?.img ?? "").split("/").pop().replace(/\.(svg|webp|png|jpg)$/i, "").toLowerCase();
  const isPhaser = /\bphasers?\b/.test(name) || /\bphase[-\s]?pulse\b/.test(name) || img.includes("phaser");
  if (!isPhaser && config?.color !== "orange") return null;
  if (img.includes("phaser-cannon") || /\bcannons?\b/.test(name)) return "cannon";
  // Spinal Lance must be checked before "array": its slug contains "phaser-array".
  if (img.includes("phaser-array-spread") || /\bspinal lance\b/.test(name)) return "lance";
  if (img.includes("phaser-array") || config?.isArray || /\barrays?\b/.test(name)) return "array";
  if (img.includes("phaser-bank") || /\bbanks?\b/.test(name)) return "bank";
  return null;
}

function phaserEraSound(kind, era, isHit, baseConfig) {
  const kindPart = PHASER_KIND_SOUND_PARTS[kind];
  const eraPart = PHASER_ERA_SOUND_PARTS[era];
  const resultPart = isHit ? "Hit" : "Miss";
  const eraSound = kindPart && eraPart ? snd(`sndShipPhaser${kindPart}${eraPart}${resultPart}`) : null;
  if (eraSound) return eraSound;
  if (isHit) return baseConfig.sound;
  return baseConfig.missSound ?? baseConfig.sound;
}

function phaserEraEffect(kind, era, baseConfig) {
  // Spinal Lance shares the beam VFX; the era only swaps the sound, never the
  // visual, so it keeps its beam-counterpart effect across all eras.
  if (kind === "lance") return baseConfig.effect;
  const weaponKey = kind === "cannon" ? "phaserCannon" : "phaser";
  return animOverride("shipWeapons", weaponKey, "animHit")
    ?? PHASER_ERA_EFFECTS[era]?.[kind]
    ?? baseConfig.effect;
}

function withPhaserEraConfig(config, sourceToken, weapon, settingsOverride = null) {
  if (!config || !weapon) return config;
  const kind = phaserWeaponKind(weapon, config);
  const isTorpedo = config.type === "torpedo";
  if (!kind && !isTorpedo) return config;
  const era = normalizePhaserEra(settingsOverride?.phaserEra ?? getShipWeaponVfxSettings(sourceToken, weapon)?.phaserEra);
  if (!era) return config;
  const baseConfig = config;
  if (isTorpedo) {
    // Torpedoes keep their own sound/explosion chain; the era only swaps the
    // travel sprite (e.g. the TOS-era blue photon torpedo) when that era
    // variant file exists in the sprite dir.
    return {
      ...baseConfig,
      phaserEra: era,
      get effect() { return torpedoEffect(baseConfig.color, baseConfig.torpedoType, era); },
    };
  }
  return {
    ...baseConfig,
    phaserEra: era,
    phaserEraKind: kind,
    get effect() { return phaserEraEffect(kind, era, baseConfig); },
    get sound() { return phaserEraSound(kind, era, true, baseConfig); },
    get missSound() { return phaserEraSound(kind, era, false, baseConfig); },
  };
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
    name, color, shots, type: "beam", isArray, family: isArray ? "array" : "bank",
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

// Spinal Lance — a single-shot beam that shares the beam's VFX/effect but has
// its own per-type sound. Blank lance sound falls back to the matching beam
// counterpart (sndShip{Disruptor,Polaron,Phaser}Hit/Miss).
function shipLance(name, color) {
  const wk = color === "green" ? "disruptor" : color === "purple" ? "polaron" : "phaser";
  const lanceHit  = color === "green" ? "sndShipLanceDisruptorHit"  : color === "purple" ? "sndShipLancePolaronHit"  : "sndShipLancePhaserHit";
  const lanceMiss = color === "green" ? "sndShipLanceDisruptorMiss" : color === "purple" ? "sndShipLancePolaronMiss" : "sndShipLancePhaserMiss";
  const beamHit   = color === "green" ? "sndShipDisruptorHit"       : color === "purple" ? "sndShipPolaronHit"       : "sndShipPhaserHit";
  const beamMiss  = color === "green" ? "sndShipDisruptorMiss"      : color === "purple" ? "sndShipPolaronMiss"      : "sndShipPhaserMiss";
  return {
    name, color, shots: 1, type: "beam", isArray: false, family: "lance",
    get effect()    { return beamEffect(color); },
    get impact()    { return animOverride("shipWeapons", wk, "animImpact") ?? impactEffect(color); },
    get sound()     { return snd(lanceHit)  || snd(beamHit); },
    get missSound() { return snd(lanceMiss) || snd(beamMiss); },
  };
}

function shipCannon(name, color, shots) {
  const wk = color === "green" ? "disruptorCannon" : color === "purple" ? "polaronCannon" : "phaserCannon";
  return {
    name, color, shots, type: "cannon", family: "cannon",
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
      return animOverride("shipWeapons", torpedoWeaponKey(torpedoType), "animExplosion") ?? explosionEffect(color);
    },
    get sound() {
      const base = torpedoSoundBase(torpedoType);
      const key = salvo ? base + "Salvo" : base;
      // fall back: salvo key → base key → legacy "sndShipTorpedo"
      return snd(key) || snd(base) || snd("sndShipTorpedo");
    },
    get missSound() {
      const base = torpedoSoundBase(torpedoType);
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
  "weapon-phaser-array-spread": shipLance("Phaser Spinal Lance",  "orange"),

  "weapon-disruptor-array":        shipBeam("Disruptor Arrays",       "green", 4, true),
  "weapon-disruptor-bank":         shipBeam("Disruptor Banks",        "green", 3),
  "weapon-disruptor-cannon":       shipCannon("Disruptor Cannon",     "green", 4),
  "weapon-disruptor-array-spread": shipLance("Disruptor Spinal Lance", "green"),

  "weapon-polaron-array":        shipBeam("Polaron Arrays",       "purple", 4, true),
  "weapon-polaron-bank":         shipBeam("Polaron Banks",        "purple", 3),
  "weapon-polaron-cannon":       shipCannon("Polaron Cannon",     "purple", 4),
  "weapon-polaron-array-spread": shipLance("Polaron Spinal Lance", "purple"),

  "weapon-photon-torpedo":        shipTorpedo("Photon Torpedo",        "red",   false, 1, "photon"),
  "weapon-photon-torpedo-salvo":  shipTorpedo("Photon Torpedo Salvo",  "red",   true,  3, "photon"),
  "weapon-quantum-torpedo":       shipTorpedo("Quantum Torpedo",       "blue",  false, 1, "quantum"),
  "weapon-quantum-torpedo-salvo": shipTorpedo("Quantum Torpedo Salvo", "blue",  true,  3, "quantum"),
  "weapon-plasma-torpedo":        shipTorpedo("Plasma Torpedo",        "green", false, 1, "plasma"),
  "weapon-plasma-torpedo-salvo":  shipTorpedo("Plasma Torpedo Salvo",  "green", true,  3, "plasma"),

  // Additional torpedo types. For now they all use the toolkit's bundled custom
  // sprite (the same moving animation as the photon torpedo). Each carries its
  // own override key (e.g. "chronitonTorpedo"), so a per-type animation can be
  // dropped in later via the shipWeapons override settings without code changes.
  "weapon-chroniton-torpedo":         shipTorpedo("Chroniton Torpedo",         "blue",   false, 1, "chroniton"),
  "weapon-chroniton-torpedo-salvo":   shipTorpedo("Chroniton Torpedo Salvo",   "blue",   true,  3, "chroniton"),
  "weapon-gravimetric-torpedo":       shipTorpedo("Gravimetric Torpedo",       "purple", false, 1, "gravimetric"),
  "weapon-gravimetric-torpedo-salvo": shipTorpedo("Gravimetric Torpedo Salvo", "purple", true,  3, "gravimetric"),
  "weapon-neutronic-torpedo":         shipTorpedo("Neutronic Torpedo",         "green",  false, 1, "neutronic"),
  "weapon-neutronic-torpedo-salvo":   shipTorpedo("Neutronic Torpedo Salvo",   "green",  true,  3, "neutronic"),
  "weapon-nuclear-torpedo":           shipTorpedo("Nuclear Torpedo",           "red",    false, 1, "nuclear"),
  "weapon-nuclear-torpedo-salvo":     shipTorpedo("Nuclear Torpedo Salvo",     "red",    true,  3, "nuclear"),
  "weapon-photonic-torpedo":          shipTorpedo("Photonic Torpedo",          "red",    false, 1, "photonic"),
  "weapon-photonic-torpedo-salvo":    shipTorpedo("Photonic Torpedo Salvo",    "red",    true,  3, "photonic"),
  "weapon-polaron-torpedo":           shipTorpedo("Polaron Torpedo",           "purple", false, 1, "polaron"),
  "weapon-polaron-torpedo-salvo":     shipTorpedo("Polaron Torpedo Salvo",     "purple", true,  3, "polaron"),
  "weapon-positron-torpedo":          shipTorpedo("Positron Torpedo",          "blue",   false, 1, "positron"),
  "weapon-positron-torpedo-salvo":    shipTorpedo("Positron Torpedo Salvo",    "blue",   true,  3, "positron"),
  "weapon-spatial-torpedo":           shipTorpedo("Spatial Torpedo",           "blue",   false, 1, "spatial"),
  "weapon-spatial-torpedo-salvo":     shipTorpedo("Spatial Torpedo Salvo",     "blue",   true,  3, "spatial"),
  "weapon-tetryonic-torpedo":         shipTorpedo("Tetryonic Torpedo",         "green",  false, 1, "tetryonic"),
  "weapon-tetryonic-torpedo-salvo":   shipTorpedo("Tetryonic Torpedo Salvo",   "green",  true,  3, "tetryonic"),
  "weapon-transphasic-torpedo":       shipTorpedo("Transphasic Torpedo",       "blue",   false, 1, "transphasic"),
  "weapon-transphasic-torpedo-salvo": shipTorpedo("Transphasic Torpedo Salvo", "blue",   true,  3, "transphasic"),
  "weapon-tricobalt-torpedo":         shipTorpedo("Tricobalt Torpedo",         "red",    false, 1, "tricobalt"),
  "weapon-tricobalt-torpedo-salvo":   shipTorpedo("Tricobalt Torpedo Salvo",   "red",    true,  3, "tricobalt"),
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

// Torpedo type keys known to STARSHIP_WEAPON_CONFIGS ("weapon-<type>-torpedo").
// "photonic" is listed before "photon" defensively, though the word-boundary
// match already keeps "photon" from matching inside "photonic".
const TORPEDO_CONFIG_TYPES = Object.freeze([
  "photonic", "photon", "quantum", "plasma", "chroniton", "gravimetric",
  "neutronic", "nuclear", "polaron", "positron", "spatial", "tetryonic",
  "transphasic", "tricobalt",
]);

// Ship sheets often reuse one torpedo icon across several launcher items, but
// configs are keyed by the icon slug — so a "Gravimetric Torpedo" carrying the
// plasma-torpedo icon would inherit the plasma animation AND rules (torpedo
// counts, launch-size scaling). When the weapon's NAME names a specific
// torpedo type, trust the name over the icon. Salvo-ness follows the icon
// slug, with "salvo" in the name as a fallback signal.
function torpedoConfigFromName(item, slug, imgConfig) {
  if (imgConfig && imgConfig.type !== "torpedo") return null;
  const name = String(item?.name ?? "").toLowerCase();
  if (!/\btorpedo/.test(name)) return null;
  const type = TORPEDO_CONFIG_TYPES.find(t => new RegExp(`\\b${t}\\b`).test(name));
  if (!type) return null;
  const salvo = String(slug ?? "").endsWith("-salvo") || /\bsalvo\b/.test(name);
  return STARSHIP_WEAPON_CONFIGS[`weapon-${type}-torpedo${salvo ? "-salvo" : ""}`] ?? null;
}

export function getWeaponConfig(item) {
  if (item.type === "starshipweapon2e") {
    const slug = getImgSlug(item.img);
    const imgConfig = STARSHIP_WEAPON_CONFIGS[slug] ?? null;
    return torpedoConfigFromName(item, slug, imgConfig) ?? imgConfig;
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
 * @returns {{ name: string, weaponId: string|null, shipActorId: string|null, shipTokenId: string|null, isTorpedo: boolean, damage: number, qualities: string }}
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
    shipTokenId: null,
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

function normalizeTargetList(targets) {
  if (!targets) return [];
  if (Array.isArray(targets)) return targets.filter(Boolean);
  if (typeof targets[Symbol.iterator] === "function") return Array.from(targets).filter(Boolean);
  return [targets].filter(Boolean);
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

function sequenceLocation(token, point, fallbackOptions = undefined, layer = null) {
  const offset = offsetForTokenPoint(token, point);
  if (offset) return { location: token, options: { offset }, layer };
  return { location: token, options: fallbackOptions, layer };
}

function pointSequenceLocation(point) {
  return point ? { location: point } : null;
}

// Stable value key for an emitter anchor (no id field on the normalized data).
function emitterAnchorKey(anchor) {
  if (!anchor) return "";
  const r = n => Math.round(Number(n) * 1000) / 1000;
  return `${r(anchor.x)}:${r(anchor.y)}:${r(anchor.facingDeg)}`;
}

function nearestShipWeaponEmitterPoint(sourceToken, weapon, targetPoint, settingsOverride = null) {
  const anchors = getShipWeaponEmitterAnchors(sourceToken, weapon);
  if (!anchors.length || !targetPoint) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    const point = shipWeaponAnchorToCanvasPoint(sourceToken, weapon, anchor, settingsOverride, targetPoint);
    if (!point) continue;
    const distance = Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        x: point.x,
        y: point.y,
        layer: anchor.layer ?? point.layer ?? "above",
        facingDeg: anchor.facingDeg,
      };
    }
  }
  return best;
}

function shipWeaponEmitterPointForShot(sourceToken, weapon, targetPoint, shotIndex = 0, selectedEmitter = null, arcRestrict = false) {
  if (!weapon || !targetPoint) return null;

  if (isShipArrayWeapon(weapon)) {
    const curvePoint = getClosestShipArrayCurvePoint(sourceToken, weapon, targetPoint);
    if (curvePoint) return curvePoint;
  }

  if (isWeaponAutoRotateDisabled(sourceToken)) {
    return nearestShipWeaponEmitterPoint(sourceToken, weapon, targetPoint);
  }

  const anchors = getShipWeaponEmitterAnchors(sourceToken, weapon);

  // No enumerable emitters: honour the pre-selected arc emitter if there is one.
  if (!anchors.length) {
    if (selectedEmitter?.anchor) {
      const point = shipWeaponAnchorToCanvasPoint(sourceToken, weapon, selectedEmitter.anchor, null, targetPoint);
      if (point) return { ...point, layer: selectedEmitter.layer ?? selectedEmitter.anchor.layer ?? "above", facingDeg: selectedEmitter.anchor.facingDeg };
    }
    return null;
  }

  // Build an ordered list of emitter points so consecutive shots fire from
  // different emitters (e.g. a Bird-of-Prey alternating its two forward
  // disruptor cannons). The pre-selected arc emitter goes first so shot 0 still
  // comes from where the ship turned to fire; the rest follow by proximity to
  // the target. With arcRestrict (torpedoes), cycling is limited to emitters
  // whose facing arc covers the target at the ship's current (post-turn)
  // heading — otherwise a multi-torpedo shot would happily pull in an aft
  // launcher against a target dead ahead. If nothing covers (e.g. residual
  // heading from the curved torpedo's relaxed turn), fall back to the
  // arc-selected emitter, then all. Beams/cannons keep the unrestricted
  // alternation: paired forward cannons should trade off every shot.
  const selKey = selectedEmitter?.anchor ? emitterAnchorKey(selectedEmitter.anchor) : null;
  const targetBearing = shipTargetBearingToLocalDeg(sourceToken, targetPoint);
  const ordered = anchors
    .map(anchor => {
      const p = shipWeaponAnchorToCanvasPoint(sourceToken, weapon, anchor, null, targetPoint);
      if (!p) return null;
      const facing = Number(anchor.facingDeg);
      const halfArc = (Number(anchor.arcWidthDeg) || 90) / 2;
      const covers = !Number.isFinite(facing)
        || Math.abs(((targetBearing - facing + 540) % 360) - 180) <= halfArc;
      return { x: p.x, y: p.y, layer: anchor.layer ?? p.layer ?? "above", key: emitterAnchorKey(anchor), covers, facingDeg: anchor.facingDeg };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aSel = selKey && a.key === selKey ? 0 : 1;
      const bSel = selKey && b.key === selKey ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel; // selected emitter first
      return Math.hypot(a.x - targetPoint.x, a.y - targetPoint.y)
           - Math.hypot(b.x - targetPoint.x, b.y - targetPoint.y);
    });

  if (!ordered.length) return null;
  let pool = ordered;
  if (arcRestrict) {
    pool = ordered.filter(o => o.covers);
    if (!pool.length && selKey) pool = ordered.filter(o => o.key === selKey);
    if (!pool.length) pool = ordered;
  }
  const chosen = pool[Math.abs(shotIndex) % pool.length];
  return { x: chosen.x, y: chosen.y, layer: chosen.layer, facingDeg: chosen.facingDeg };
}

// Wraps sequenceLocation and, when the emitter has a facing, attaches the
// launch heading in canvas degrees so the torpedo path can leave the tube
// straight along it before curving onto the target.
function emitterSequenceLocation(sourceToken, emitterPoint) {
  const loc = sequenceLocation(sourceToken, emitterPoint, undefined, emitterPoint.layer ?? null);
  const facing = Number(emitterPoint.facingDeg);
  if (Number.isFinite(facing)) {
    try { loc.launchDeg = shipEngineFacingToCanvasDeg(sourceToken, facing); } catch { /* no launch heading */ }
  }
  return loc;
}

async function shipWeaponSourceLocation(sourceToken, targetToken, weapon, targetPoint, fallbackOptions = undefined, shotIndex = 0, selectedEmitter = null, arcRestrict = false) {
  const aimingPoint = targetPoint ?? tokenCenter(targetToken);
  const emitterPoint = shipWeaponEmitterPointForShot(sourceToken, weapon, aimingPoint, shotIndex, selectedEmitter, arcRestrict);
  if (emitterPoint) return emitterSequenceLocation(sourceToken, emitterPoint);
  return sequenceLocation(sourceToken, await randomOpaqueTokenPoint(sourceToken), fallbackOptions);
}

function shipWeaponMissSourceLocation(sourceToken, targetToken, weapon, shotIndex = 0, selectedEmitter = null) {
  const aimingPoint = tokenCenter(targetToken);
  const emitterPoint = shipWeaponEmitterPointForShot(sourceToken, weapon, aimingPoint, shotIndex, selectedEmitter);
  if (emitterPoint) return emitterSequenceLocation(sourceToken, emitterPoint);
  return sequenceLocation(sourceToken, null);
}

function shipWeaponMissTargetLocation(targetToken) {
  return { location: tokenCenter(targetToken) };
}

async function shipShotLocations(sourceToken, targetToken, { sourceOptions = undefined, targetOptions = undefined, weapon = null, shotIndex = 0, targetSystem = null, selectedEmitter = null, arcRestrict = false } = {}) {
  const sourceReference = tokenCenter(sourceToken);
  const hitLocationPoint = targetSystem
    ? getShipHitLocationPointForShot(targetToken, targetSystem, sourceReference, shotIndex)
    : null;
  const targetPoint = hitLocationPoint ?? await randomOpaqueTokenPoint(targetToken);
  return {
    source: await shipWeaponSourceLocation(sourceToken, targetToken, weapon, targetPoint, sourceOptions, shotIndex, selectedEmitter, arcRestrict),
    target: pointSequenceLocation(targetPoint ?? tokenCenter(targetToken)),
    impact: sequenceLocation(targetToken, targetPoint, targetOptions),
  };
}

function atSequenceLocation(effect, location) {
  effect = applySequenceSourceLayer(effect, location?.layer);
  return location?.options
    ? effect.atLocation(location.location, location.options)
    : effect.atLocation(location.location);
}

function stretchToSequenceLocation(effect, location) {
  effect = applySequenceSourceLayer(effect, location?.layer);
  return location?.options
    ? effect.stretchTo(location.location, location.options)
    : effect.stretchTo(location.location);
}

function applySequenceSourceLayer(effect, layer) {
  if (!effect || !layer) return effect;
  if (layer === "below" && typeof effect.belowTokens === "function") return effect.belowTokens();
  if (layer === "above" && typeof effect.aboveTokens === "function") return effect.aboveTokens();
  return effect;
}

// Builds the projectile-travel portion of a torpedo shot. JB2A bullet strips are
// drawn along their length, so they stretchTo() between source and target. The
// bundled custom sprite spins in place, so it is placed at the source and flown
// along hand-built canvas waypoints at a fixed on-canvas size. Pass missed:true
// to fan the shot off-target.
// Plasma torpedoes cruise slower than other types for a heavier, rolling look.
// Applied only to the flown toolkit sprite — JB2A strips keep standard timing.
const SHIP_PLASMA_TORPEDO_SPEED_FACTOR = 1.5;

// Travel time for one torpedo shot. Also used by the fire sequences as the
// wait before the impact explosion, so the two always stay in sync.
function torpedoTravelMs(config) {
  const base = Math.max(300, Number(getTimingTorpedoImpact()) || 1000);
  const slow = config?.torpedoType === "plasma" && isMovingTorpedoSprite(config?.effect);
  return slow ? Math.round(base * SHIP_PLASMA_TORPEDO_SPEED_FACTOR) : base;
}

function usesToolkitTorpedoSprite(config) {
  return isMovingTorpedoSprite(config?.effect);
}

function applyTorpedoTravel(s, config, source, target, { missed = false, finalDamage = 0 } = {}) {
  const effectPath = config.effect;
  const base = s.effect().file(effectPath);

  if (isMovingTorpedoSprite(effectPath)) {
    const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
    const px = Math.max(8, Math.round(gridSize * SHIP_TORPEDO_SPRITE_GRID_FRACTION));
    const travelMs = torpedoTravelMs(config);
    // The toolkit sprites spin in place, so Sequencer cannot stretch them like
    // JB2A strips. Keep the effect parked at an absolute launch point and move
    // the sprite container over a small, bounded set of arc segments.
    // The launch point is resolved to an ABSOLUTE canvas point rather than
    // handing Sequencer a token + offset: Sequencer's own offset processing
    // doesn't place the effect on the emitter, which made torpedoes appear to
    // launch from the wrong emitter position.
    const launchPoint = resolveTravelPoint(source);
    const launchLoc = launchPoint
      ? { location: launchPoint, layer: source?.layer ?? null }
      : source;
    let effect = atSequenceLocation(base, launchLoc)
      .size(px)
      .duration(travelMs);
    const arc = buildTorpedoArcOffsets(source, target, { gridSize, missed });
    if (arc) {
      // Keep this deliberately compact. Large salvos used to build dozens of
      // delayed spriteContainer tweens in one Sequence, which could eventually
      // leave only the start frame and impact visible during long combats.
      const segs = arc.x.length - 1;
      const segMs = travelMs / segs;
      for (let i = 0; i < segs; i++) {
        effect = effect
          .animateProperty("spriteContainer", "position.x", { from: arc.x[i], to: arc.x[i + 1], duration: segMs, delay: i * segMs, ease: "linear", absolute: true })
          .animateProperty("spriteContainer", "position.y", { from: arc.y[i], to: arc.y[i + 1], duration: segMs, delay: i * segMs, ease: "linear", absolute: true });
      }
    } else {
      // Degenerate case (unresolvable points / zero distance): fall back to a
      // plain straight flight so the torpedo never just sits at the emitter.
      effect = effect.moveTowards(target?.location ?? target, { ease: "linear", duration: travelMs });
      if (missed && typeof effect.missed === "function") effect = effect.missed();
    }
    // Plasma torpedoes launch as a large bolt sized by the damage dealt, then
    // shrink as they converge on the target. Other torpedo types keep a
    // constant size.
    if (config.torpedoType === "plasma") {
      const dmg = Math.max(0, Number(finalDamage) || 0);
      // 75% of the original launch-size curve (was min(3.5, 1.2 + dmg * 0.18)).
      const startScale = Math.min(2.625, 0.9 + dmg * 0.135);
      const endScale = 0.8;
      effect = effect
        .scale(startScale)
        .animateProperty("spriteContainer", "scale.x", { from: startScale, to: endScale, duration: travelMs, ease: "linear", absolute: true })
        .animateProperty("spriteContainer", "scale.y", { from: startScale, to: endScale, duration: travelMs, ease: "linear", absolute: true });
    }
    // Misses are handled inside the waypoint path (fanned-off endpoint), not
    // via .missed(), which without stretchTo/rotateTowards would randomize
    // the LAUNCH location instead of the target.
    return effect;
  }

  let effect = stretchToSequenceLocation(
    atSequenceLocation(shipTravelEffect(base, config), source),
    target
  );
  if (missed && typeof effect.missed === "function") effect = effect.missed();
  return effect;
}

// Resolves a Sequencer travel location (token+offset, or a plain point) to an
// absolute canvas point so the arc math can work in screen space.
function resolveTravelPoint(loc) {
  if (!loc?.location) return null;
  const base = loc.location;
  const offset = loc.options?.offset ?? { x: 0, y: 0 };
  const isToken = !!(base.center || base.document || base.documentName);
  const anchor = isToken ? tokenCenter(base) : { x: Number(base.x) || 0, y: Number(base.y) || 0 };
  return { x: anchor.x + (offset.x ?? 0), y: anchor.y + (offset.y ?? 0) };
}

// Torpedo arc tuning. The path is a cubic Bézier from launch to impact whose
// FIRST control point lies straight ahead of the launch tube (the emitter's
// facing, falling back to the ship's bow), so the torpedo always leaves the
// hull straight out of the tube before curving onto the target — the classic
// missile-launch look.
//   LAUNCH_RUN_SQUARES  — straight-out run length cap, in grid squares.
//   LAUNCH_RUN_FRACTION — straight-out run as a fraction of the shot distance
//                         (short shots use this so the run doesn't dominate).
//   APPROACH_FRACTION   — how far back from the target the curve straightens
//                         into its final approach heading.
const TORPEDO_LAUNCH_RUN_SQUARES = 2.5;
const TORPEDO_LAUNCH_RUN_FRACTION = 0.35;
const TORPEDO_APPROACH_FRACTION = 0.35;
const TORPEDO_ARC_WAYPOINTS = 4;

// Builds a compact flight path of canvas-space offsets from launch point to
// impact. The effect itself never moves or rotates; only the spriteContainer is
// tweened, and the last waypoint is the landing point. Keep the waypoint count
// low because every segment becomes delayed Sequencer property tweens.
function buildTorpedoArcOffsets(source, target, { gridSize = 100, missed = false } = {}) {
  const sp = resolveTravelPoint(source);
  let tp = resolveTravelPoint(target);
  if (!sp || !tp) return null;

  if (missed) {
    // Overshoot past the target and drift sideways so the bolt visibly sails
    // wide instead of detonating on the hull.
    const mAng = Math.atan2(tp.y - sp.y, tp.x - sp.x);
    const over = gridSize * (1.2 + Math.random() * 0.8);
    const drift = gridSize * (0.6 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1);
    tp = {
      x: tp.x + Math.cos(mAng) * over - Math.sin(mAng) * drift,
      y: tp.y + Math.sin(mAng) * over + Math.cos(mAng) * drift,
    };
  }

  const dx = tp.x - sp.x;
  const dy = tp.y - sp.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return null;

  // Launch heading: the firing emitter's facing (attached by
  // emitterSequenceLocation), falling back to the ship's bow, then to
  // straight at the target (which degenerates into a near-straight flight).
  let launchDeg = Number(source?.launchDeg);
  if (!Number.isFinite(launchDeg)) {
    const srcToken = (source?.location?.center || source?.location?.document) ? source.location : null;
    if (srcToken) {
      try { launchDeg = shipEngineFacingToCanvasDeg(srcToken, 0); } catch { /* fall back below */ }
    }
  }
  const launchRad = Number.isFinite(launchDeg)
    ? (launchDeg * Math.PI) / 180
    : Math.atan2(dy, dx);

  // Cubic Bézier: A = launch (0,0), B = impact (dx,dy). C1 sits straight
  // ahead of the tube so the torpedo leaves the hull along the launcher's
  // facing; C2 sits on the final approach line so it straightens out onto
  // the target.
  const run = Math.min(dist * TORPEDO_LAUNCH_RUN_FRACTION, gridSize * TORPEDO_LAUNCH_RUN_SQUARES);
  const c1x = Math.cos(launchRad) * run;
  const c1y = Math.sin(launchRad) * run;
  const adx = dx - c1x;
  const ady = dy - c1y;
  const aLen = Math.max(1, Math.hypot(adx, ady));
  const approach = Math.min(dist * TORPEDO_APPROACH_FRACTION, aLen * 0.8);
  const c2x = dx - (adx / aLen) * approach;
  const c2y = dy - (ady / aLen) * approach;

  const steps = TORPEDO_ARC_WAYPOINTS;
  const x = [];
  const y = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const u = 1 - t;
    x.push(3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * dx);
    y.push(3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * dy);
  }
  return { x, y };
}

export function getStarshipDamageAnimationRepeatCount(finalDamage) {
  const damage = Math.max(0, Number(finalDamage) || 0);
  if (damage >= 8) return 3;
  if (damage >= 4) return 2;
  return 1;
}

// All torpedo types, with display labels for the config menu.
export const TORPEDO_TYPES = Object.freeze([
  { type: "photon",      label: "Photon" },
  { type: "quantum",     label: "Quantum" },
  { type: "plasma",      label: "Plasma" },
  { type: "chroniton",   label: "Chroniton" },
  { type: "gravimetric", label: "Gravimetric" },
  { type: "neutronic",   label: "Neutronic" },
  { type: "nuclear",     label: "Nuclear" },
  { type: "photonic",    label: "Photonic" },
  { type: "polaron",     label: "Polaron" },
  { type: "positron",    label: "Positron" },
  { type: "spatial",     label: "Spatial" },
  { type: "tetryonic",   label: "Tetryonic" },
  { type: "transphasic", label: "Transphasic" },
  { type: "tricobalt",   label: "Tricobalt" },
]);

// Per-type torpedo count defaults: how many torpedoes a shot fires, computed as
// base × damage tier (1/2/3) capped at max. Standard base 1 → 1/2/3 (the old
// behavior); salvo base 2 → 2/4/6. Plasma defaults to a single bolt.
const TORPEDO_COUNT_DEFAULTS = Object.freeze(Object.fromEntries(
  TORPEDO_TYPES.map(({ type }) => [
    type,
    type === "plasma" ? { standard: 1, salvo: 1, max: 1 } : { standard: 1, salvo: 2, max: 8 },
  ])
));

function clampTorpedoSlider(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(20, n));
}

// Merged, validated per-type count config (stored setting over defaults).
export function getTorpedoCountConfig() {
  let stored = {};
  try { stored = game.settings.get("sta2e-toolkit", "torpedoCountConfig") ?? {}; }
  catch { stored = {}; }
  const merged = {};
  for (const { type } of TORPEDO_TYPES) {
    const d = TORPEDO_COUNT_DEFAULTS[type];
    const s = stored[type] ?? {};
    merged[type] = {
      standard: clampTorpedoSlider(s.standard, d.standard),
      salvo:    clampTorpedoSlider(s.salvo,    d.salvo),
      max:      clampTorpedoSlider(s.max,      d.max),
    };
  }
  return merged;
}

// How many torpedoes to fire: base (standard or salvo) × damage tier, capped at
// the type's max. mode is "standard" or "salvo".
export function getTorpedoCount(torpedoType, mode, finalDamage) {
  const cfg = getTorpedoCountConfig();
  const t = cfg[torpedoType] ?? cfg.photon;
  const base = mode === "salvo" ? t.salvo : t.standard;
  const tier = getStarshipDamageAnimationRepeatCount(finalDamage);
  return Math.max(1, Math.min(t.max, Math.round(base * tier)));
}

function normalizeRepeatCount(repeatCount) {
  const count = Math.floor(Number(repeatCount) || 1);
  return Math.min(3, Math.max(1, count));
}

// Energy weapon families that scale their animation play-count by damage, with
// display labels for the config menu. Banks/arrays/lances are "beam" type;
// cannons are "cannon" type. The family is tagged on each config.
export const ENERGY_WEAPON_FAMILIES = Object.freeze([
  { family: "bank",   label: "Phaser / Energy Banks" },
  { family: "array",  label: "Phaser / Energy Arrays" },
  { family: "cannon", label: "Cannons" },
  { family: "lance",  label: "Spinal Lances" },
]);

// Per-family defaults: base = animation plays on any hit; perDamage = fire one
// additional play per this many points of final damage (0 disables scaling);
// max = hard cap. Bank/array reproduce the old 1/2/3 feel and extend past it.
const ENERGY_WEAPON_COUNT_DEFAULTS = Object.freeze({
  bank:   { base: 1, perDamage: 4, max: 6 },
  array:  { base: 1, perDamage: 4, max: 6 },
  cannon: { base: 2, perDamage: 3, max: 8 },
  lance:  { base: 1, perDamage: 6, max: 4 },
});

// Clamp a stored slider value. perDamage may be 0 (no scaling); base/max floor
// at 1. All cap at 20.
function clampEnergySlider(value, fallback, min = 1) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(20, n));
}

// Merged, validated per-family count config (stored setting over defaults).
export function getEnergyWeaponCountConfig() {
  let stored = {};
  try { stored = game.settings.get("sta2e-toolkit", "energyWeaponCountConfig") ?? {}; }
  catch { stored = {}; }
  const merged = {};
  for (const { family } of ENERGY_WEAPON_FAMILIES) {
    const d = ENERGY_WEAPON_COUNT_DEFAULTS[family];
    const s = stored[family] ?? {};
    merged[family] = {
      base:      clampEnergySlider(s.base,      d.base,      1),
      perDamage: clampEnergySlider(s.perDamage, d.perDamage, 0),
      max:       clampEnergySlider(s.max,       d.max,       1),
    };
  }
  return merged;
}

// How many times to play the firing animation: base + one per perDamage points
// of final damage, floored at base and capped at max.
export function getEnergyWeaponShotCount(family, finalDamage) {
  const cfg = getEnergyWeaponCountConfig();
  const c = cfg[family] ?? cfg.bank;
  const damage = Math.max(0, Number(finalDamage) || 0);
  const extra = c.perDamage > 0 ? Math.floor(damage / c.perDamage) : 0;
  return Math.max(c.base, Math.min(c.max, c.base + extra));
}

function isShipWeaponConfig(config) {
  return ["beam", "cannon", "torpedo"].includes(config?.type);
}

async function prepareShipEmitterFacing(config, token, targets, weapon) {
  if (!isShipWeaponConfig(config) || !token || !weapon || isShipArrayWeapon(weapon)) return null;
  if (isWeaponAutoRotateDisabled(token)) return null;
  const primaryTarget = normalizeTargetList(targets)[0] ?? null;
  if (!primaryTarget) return null;
  let selection = getShipWeaponEmitterArcSelection(token, weapon, tokenCenter(primaryTarget));
  if (!selection?.anchor || !Number.isFinite(selection.desiredRotation)) return null;
  // The curved photon torpedo arcs onto its target, so the ship only needs to
  // turn partway. Leave up to ~45deg of residual heading for the curve to cover.
  if (isMovingTorpedoSprite(config.effect)) selection = relaxFacingForCurvedTorpedo(selection);
  // Try the cinematic bow-first turning glide; it also brings the ship onto the
  // firing facing. If it declines (disabled, no zones, blocked), fall back to a
  // plain in-place rotation so the weapon still lines up.
  const maneuvered = await maneuverShipForFiring(token, selection, primaryTarget);
  if (!maneuvered) await rotateTokenToEmitterFacing(token, selection.desiredRotation);
  await _delay(SHIP_WEAPON_FACING_SETTLE_MS);
  return selection;
}

// Reduces how far the ship turns to fire a curved torpedo. The ship turns only
// enough to bring the target within ~45deg of its emitter facing; the torpedo's
// arc bridges the rest. Returns a selection clone with a relaxed desiredRotation.
function relaxFacingForCurvedTorpedo(selection) {
  const turnDelta = Number(selection.turnDelta) || 0;
  const currentRotation = selection.desiredRotation - turnDelta;
  const residualMax = 45;
  const magnitude = Math.abs(turnDelta);
  const executed = magnitude <= residualMax
    ? 0
    : Math.sign(turnDelta) * (magnitude - residualMax);
  return { ...selection, desiredRotation: currentRotation + executed, turnDelta: executed };
}

function shipRepositionSettings() {
  let enabled = true;
  let maxSquares = 2;
  try { enabled = game.settings.get("sta2e-toolkit", "shipWeaponReposition") !== false; } catch { /* default */ }
  try {
    const raw = Number(game.settings.get("sta2e-toolkit", "shipWeaponRepositionSquares"));
    if (Number.isFinite(raw)) maxSquares = Math.max(0, Math.min(4, raw));
  } catch { /* default */ }
  return { enabled, maxSquares };
}

/**
 * Cinematic bow-first turning glide. The ship noses through a banking curve
 * while its heading eases from its current rotation to the firing facing,
 * finishing aimed. The resting spot is chosen first, then the curve is drawn to
 * it, so transient sideways bulges in the arc never cut the move short. The
 * destination is the furthest point (up to the configured distance) forward
 * along the firing facing that still satisfies two hard rules:
 *   1. it stays inside the zone the ship started in (range bands never change);
 *   2. it never lands on top of the target token, when the target shares that
 *      zone (the ship stops just short instead).
 *
 * Returns true when it handled the facing (caller should not also rotate), or
 * false when it declined (disabled, no zone system, ship not in a zone, or
 * there's no room to advance) so the caller can fall back to a plain rotation.
 *
 * @param {Token} token         the firing ship token
 * @param {object} selection    arc selection from getShipWeaponEmitterArcSelection
 * @param {Token} primaryTarget the token being fired at (may be null)
 * @returns {Promise<boolean>}
 */
async function maneuverShipForFiring(token, selection, primaryTarget = null) {
  const { enabled, maxSquares } = shipRepositionSettings();
  if (!enabled || maxSquares <= 0) return false;

  const doc = token?.document;
  if (!doc?.update) return false;

  const zones = getSceneZones();
  if (!zones?.length) return false; // feature is opt-in via the zone system

  const center0 = tokenCenter(token);
  const startZone = getZoneAtPoint(center0.x, center0.y, zones);
  if (!startZone) return false; // ship isn't in a zone — leave it alone

  const H0 = Number(doc.rotation ?? token?.rotation ?? 0) || 0;
  // Firing facing computed at the START position — used only to choose the
  // forward direction for the glide. The actual end facing is re-aimed from the
  // destination further below, since moving changes the bearing to the target.
  const Hf0 = Number(selection?.desiredRotation);
  if (!Number.isFinite(Hf0)) return false;

  const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  const sceneRect = canvas?.dimensions?.sceneRect ?? null;
  const { width, height } = tokenDimensions(token);

  // Foundry tokens are front-facing at local 180°, so a heading's bow points
  // along canvas bearing (heading + 90)° in the atan2(dy,dx) convention.
  const bowDir = (headingDeg) => {
    const r = (headingDeg + 90) * (Math.PI / 180);
    return { x: Math.cos(r), y: Math.sin(r) };
  };
  const inZone = (x, y) => {
    if (sceneRect && !sceneRect.contains(x, y)) return false;
    const z = getZoneAtPoint(x, y, zones);
    return !!z && z.id === startZone.id;
  };

  // Keep-clear ring around the target — only enforced when the target is in the
  // same zone. The ship keeps a small slice of empty space between the two hulls:
  // centre-to-centre separation = both bounding radii plus a fraction of a ship
  // length of gap.
  let targetCenter = null;
  let minSeparation = 0;
  if (primaryTarget) {
    const tc = tokenCenter(primaryTarget);
    const tz = getZoneAtPoint(tc.x, tc.y, zones);
    if (tz && tz.id === startZone.id) {
      const tDim = tokenDimensions(primaryTarget);
      const shipLen = Math.max(width, height);
      const shipR = shipLen / 2;
      const tgtR = Math.max(tDim.width, tDim.height) / 2;
      targetCenter = tc;
      minSeparation = shipR + tgtR + shipLen * SHIP_WEAPON_REPOSITION_TARGET_GAP;
    }
  }

  // Pick the furthest forward resting centre that obeys both rules. Start from
  // the configured distance, then cap it at the near edge of the target's
  // keep-clear ring so the ship stops short instead of flying through the
  // target to land on the far side.
  const bowHf = bowDir(Hf0);
  let maxDist = maxSquares * gridSize;
  if (targetCenter) {
    const lx = targetCenter.x - center0.x;
    const ly = targetCenter.y - center0.y;
    const tca = lx * bowHf.x + ly * bowHf.y; // projection of target onto the bow ray
    if (tca > 0) { // target lies ahead, not behind
      const perp2 = (lx * lx + ly * ly) - tca * tca; // squared off-axis distance
      const r2 = minSeparation * minSeparation;
      if (perp2 < r2) { // the forward ray actually enters the keep-clear ring
        const tNear = tca - Math.sqrt(r2 - perp2);
        maxDist = Math.min(maxDist, Math.max(0, tNear));
      }
    }
  }

  // Walk inward from there for the zone boundary (zones may be non-convex), so
  // the ship moves as much as it's allowed to while staying in its start zone.
  let bestD = 0;
  for (let d = maxDist; d >= 0; d -= gridSize * 0.1) {
    const ex = center0.x + bowHf.x * d;
    const ey = center0.y + bowHf.y * d;
    if (!inZone(ex, ey)) continue;
    bestD = d;
    break;
  }

  const dest = { x: center0.x + bowHf.x * bestD, y: center0.y + bowHf.y * bestD };

  // Re-aim from the destination so the weapon arc still bears on the target once
  // the ship has moved. Same convention as ship-vfx-anchors.js:
  // rotation = bearing(dest -> target) - emitterFacingDeg + 90.
  let Hf = Hf0;
  const aimPoint = primaryTarget ? tokenCenter(primaryTarget) : null;
  if (aimPoint && Number.isFinite(selection?.facingDeg)) {
    const cb = ((Math.atan2(aimPoint.y - dest.y, aimPoint.x - dest.x) * 180 / Math.PI) % 360 + 360) % 360;
    const fd = ((Number(selection.facingDeg) % 360) + 360) % 360;
    Hf = cb - fd + 90;
  }
  const turn = ((Hf - H0 + 540) % 360) - 180; // shortest signed turn, degrees
  const sgn = turn > 0 ? 1 : (turn < 0 ? -1 : 0);

  // Nothing worthwhile to do: no room to advance and no turn to show.
  if (bestD < gridSize * 0.2 && Math.abs(turn) < 1) return false;

  const moveVec = { x: dest.x - center0.x, y: dest.y - center0.y };
  const moveDist = Math.hypot(moveVec.x, moveVec.y) || 1;

  // Quadratic-Bézier control point offset perpendicular to the move, so the hull
  // banks into the turn. Zero offset when there's no turn (straight glide).
  const arc = Math.min(moveDist * 1.25, gridSize * 2.5) * sgn;
  const mid = { x: center0.x + moveVec.x * 0.5, y: center0.y + moveVec.y * 0.5 };
  const ctrl = {
    x: mid.x - (moveVec.y / moveDist) * arc,
    y: mid.y + (moveVec.x / moveDist) * arc,
  };

  const speedFactor = shipScaleSpeedFactor(token);
  const DURATION_MS = Math.max(SHIP_WEAPON_REPOSITION_MIN_MS, maxSquares * SHIP_WEAPON_REPOSITION_MS_PER_SQUARE) * speedFactor;
  const STEPS = Math.max(6, Math.min(30, Math.round(DURATION_MS / SHIP_WEAPON_REPOSITION_STEP_MS)));
  const stepDelay = DURATION_MS / STEPS;
  const smooth = t => t * t * (3 - 2 * t); // smoothstep ease-in-out

  try {
    for (let i = 1; i <= STEPS; i++) {
      const raw = i / STEPS;
      const te = smooth(raw);
      const mt = 1 - te;
      const bx = mt * mt * center0.x + 2 * mt * te * ctrl.x + te * te * dest.x;
      const by = mt * mt * center0.y + 2 * mt * te * ctrl.y + te * te * dest.y;
      // Heading eases H0 -> Hf, plus a transient bank that is zero at both ends.
      const heading = H0 + turn * te + SHIP_WEAPON_REPOSITION_BANK_DEG * sgn * Math.sin(Math.PI * raw);

      await doc.update(
        { x: bx - width / 2, y: by - height / 2, rotation: heading },
        {
          animate: true,
          animation: { duration: stepDelay, easing: "linear" },
          sta2eWeaponReposition: true,
        },
      );
      await _delay(stepDelay);
    }
  } finally {
    // Snap to the exact destination and firing facing (unwinds residual bank),
    // even if a frame above threw.
    await doc.update(
      { x: dest.x - width / 2, y: dest.y - height / 2, rotation: Hf },
      { animate: false, sta2eWeaponReposition: true },
    );
  }
  return true;
}

async function rotateTokenToEmitterFacing(token, desiredRotation) {
  const doc = token?.document;
  if (!doc?.update) return;
  const current = Number(doc.rotation ?? token?.rotation ?? 0) || 0;
  const delta = ((desiredRotation - current + 540) % 360) - 180;
  if (Math.abs(delta) < 1) return;
  const targetRotation = current + delta;
  const duration = Math.round(
    Math.max(250, Math.min(900, Math.abs(delta) * 2))
      * SHIP_WEAPON_FACING_DURATION_SCALE * shipScaleSpeedFactor(token),
  );
  await doc.update(
    { rotation: targetRotation },
    { animate: true, animation: { duration, easing: "easeInOutSine" }, sta2eWeaponFacing: true },
  );
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

// Mirrors the registered default for "timingBeamTravel". While the setting sits
// at this value we treat beam timing as adaptive: the impact flash and shield
// flash are timed to each JB2A clip's real length instead of a fixed delay, so
// beam animations of different speeds all stay in sync. If the user overrides
// the setting, we fall back to the old fixed-delay behavior as a manual escape
// hatch.
const BEAM_TRAVEL_DEFAULT_MS = 3800;
// The impact lands this many ms before the beam clip finishes. Matches the
// value already used by the spread and melee paths.
const BEAM_IMPACT_LEAD_MS = -200;

function beamTravelIsAdaptive() {
  try {
    const v = Number(game.settings.get("sta2e-toolkit", "timingBeamTravel"));
    return !Number.isFinite(v) || v === BEAM_TRAVEL_DEFAULT_MS;
  } catch { return true; }
}

// Times whatever sections follow the beam (impact flash, shield step) to the
// beam's actual duration on defaults, or to the manual travel time when the
// setting is overridden. Pass the stretched beam effect; returns the parent
// sequence for chaining.
function waitForBeamImpact(beamEffect) {
  return beamTravelIsAdaptive()
    ? beamEffect.waitUntilFinished(BEAM_IMPACT_LEAD_MS)
    : beamEffect.wait(getTimingBeamTravel());
}

async function playSequenceAndWaitForArrayBeam(sequence) {
  // play() resolves after the beam's real duration (waitUntilFinished) or the
  // manual travel time, so multi-shot pacing tracks the actual animation rather
  // than a fixed 3800ms floor. A short settle separates consecutive shots.
  await sequence.play();
  await _delay(ARRAY_WEAPON_ANIMATION_SETTLE_MS);
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
  // The hit flash always renders above the target token, even when the firing
  // emitter sits on the "below" layer (e.g. a ventral phaser). Without this the
  // impact inherits the default layer and can appear tucked under the target
  // hull instead of on top of it.
  if (typeof effect.aboveTokens === "function") effect = effect.aboveTokens();
  return effect.scale(shipImpactScaleForToken(targetToken, scale, maxTokenRatio));
}

// For a beam fired from a "below" emitter, add a second copy of the beam forced
// ABOVE tokens and masked to the target token. The mask means this copy only
// shows where it crosses the target, so the beam reads as striking ON TOP of
// the target while the primary beam stays UNDER the firing ship's hull. The two
// copies share the same geometry and timing, so there is no mid-beam seam.
// No-op for normal/above emitters. Add this immediately BEFORE the primary beam
// effect so both start together (the primary's wait gates only later steps).
function addAboveTargetBeamOverlay(s, config, source, target, targetToken) {
  if (source?.layer !== "below" || !targetToken) return;
  try {
    let over = stretchToSequenceLocation(
      atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), { ...source, layer: null }),
      target,
    );
    if (typeof over.aboveTokens === "function") over = over.aboveTokens();
    if (typeof over.mask === "function") over = over.mask(targetToken);
  } catch (err) {
    console.warn("STA2e Toolkit | Above-target beam overlay failed:", err);
  }
}

function shieldImpactForShot(shieldImpact, shotIndex = 0, shotCount = 1) {
  if (!shieldImpact?.preShields) return null;
  const count = Math.max(1, Number(shotCount) || 1);
  return {
    ...shieldImpact,
    shieldBroke: !!shieldImpact.shieldBroke && shotIndex >= count - 1,
  };
}

function addShieldImpactStep(sequence, sourceToken, targetToken, impactPoint, shieldImpact, shotIndex = 0, shotCount = 1) {
  const impact = shieldImpactForShot(shieldImpact, shotIndex, shotCount);
  if (!impact || !impactPoint || typeof sequence?.thenDo !== "function") return sequence;
  return sequence.thenDo(() => {
    playShieldImpactVFX(sourceToken, targetToken, impactPoint, impact);
  });
}

function shipImpactFile(config, slot, hullImpact = null) {
  if (hullImpact?.shieldsDown) return SHIP_HULL_IMPACT_EFFECT;
  return config?.[slot] ?? null;
}

function _hexColorForWeaponConfig(config, fallback = 0xff9a33) {
  const color = String(config?.color ?? "").toLowerCase();
  if (color === "green") return 0x66ff99;
  if (color === "purple") return 0xaa66ff;
  if (color === "blue") return 0x66ccff;
  if (color === "red") return 0xff3333;
  return fallback;
}

async function playSequencerArrayCurveCharge(config, sourceToken, weapon, targetPoint, isHit, options = {}) {
  if (!isShipArrayWeapon(weapon) || !targetPoint) return null;
  try {
    return await playArrayCurveChargeVFX(sourceToken, weapon, targetPoint, {
      isHit,
      shotIndex: options.shotIndex ?? 0,
      selectedEmitter: options.selectedEmitter,
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
  const config = withPhaserEraConfig(getWeaponConfig(weapon), sourceToken, weapon, options.vfxSettings);
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

  applyTorpedoTravel(s, config, source, target);

  if (config.impact) {
    s.wait(Math.min(650, Math.max(180, Number(options.beamDuration) || 420)));
    shipImpactEffect(atSequenceLocation(s.effect().file(config.impact), target), { w: 100, h: 100, document: { width: 1, height: 1 } }, 0.65);
  }

  await s.play();
  return true;
}

async function fireBeamSingle(config, isHit, token, targets, repeatCount = 1, weapon = null, targetSystem = null, shieldImpact = null, hullImpact = null, selectedEmitter = null) {
  // repeatCount is the resolved damage-scaled play count from fireWeapon.
  const repeats = isHit ? Math.max(1, Math.floor(Number(repeatCount) || 1)) : 1;
  for (const target of targets) {
    const soundPath = isHit ? config.sound : (config.missSound ?? config.sound);
    let s = seq();
    if (isHit) {
      if (isShipArrayWeapon(weapon)) {
        for (let i = 0; i < repeats; i++) {
          const locations = await shipShotLocations(token, target, { weapon, shotIndex: i, targetSystem, selectedEmitter });
          await playSequencerArrayCurveCharge(config, token, weapon, locations.target?.location, true, { shotIndex: i, selectedEmitter });
          let shot = seq();
          shot = withSound(shot, soundPath).wait(50);
          waitForBeamImpact(stretchToSequenceLocation(
            atSequenceLocation(shipTravelEffect(shot.effect().file(config.effect), config), locations.source),
            locations.target
          ));
          addShieldImpactStep(shot, token, target, locations.target?.location, shieldImpact, i, repeats);
          _stampHullDecalAt(shot, target, locations.target, hullImpact);
          shipImpactEffect(atSequenceLocation(shot.effect().file(shipImpactFile(config, "impact", hullImpact)), locations.impact), target, 1.5);
          await playSequenceAndWaitForArrayBeam(shot);
          if (i < repeats - 1) await _delay(250);
        }
        continue;
      }

      for (let i = 0; i < repeats; i++) {
        const locations = await shipShotLocations(token, target, { weapon, shotIndex: i, targetSystem, selectedEmitter });
        s = withSound(s, soundPath).wait(50);
        addAboveTargetBeamOverlay(s, config, locations.source, locations.target, target);
        waitForBeamImpact(stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
          locations.target
        ));
        addShieldImpactStep(s, token, target, locations.target?.location, shieldImpact, i, repeats);
        _stampHullDecalAt(s, target, locations.target, hullImpact);
        shipImpactEffect(atSequenceLocation(s.effect().file(shipImpactFile(config, "impact", hullImpact)), locations.impact), target, 1.5);
        if (i < repeats - 1) s.wait(250);
      }
    } else {
      s = withSound(s, soundPath).wait(50);
      const missTarget = shipWeaponMissTargetLocation(target);
      await playSequencerArrayCurveCharge(config, token, weapon, missTarget.location, false, { selectedEmitter });
      stretchToSequenceLocation(
        atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon, 0, selectedEmitter)),
        missTarget
      ).missed();
    }
    await s.play();
  }
}

async function fireBeamSpread(config, isHit, token, targets, repeatCount = 1, weapon = null, targetSystem = null, shieldImpact = null, hullImpact = null, selectedEmitter = null) {
  // repeatCount is the resolved damage-scaled play count from fireWeapon.
  const repeats = isHit ? Math.max(1, Math.floor(Number(repeatCount) || 1)) : 1;
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
            selectedEmitter,
          });
          impactLocation = locations.impact;
          await playSequencerArrayCurveCharge(config, token, weapon, locations.target?.location, true, { shotIndex: i, selectedEmitter });
          let shot = seq();
          shot = withSound(shot, soundPath).wait(50);
          waitForBeamImpact(stretchToSequenceLocation(
            atSequenceLocation(shipTravelEffect(shot.effect().file(config.effect), config), locations.source),
            locations.target
          ));
          addShieldImpactStep(shot, token, target, locations.target?.location, shieldImpact, i, repeats);
          _stampHullDecalAt(shot, target, locations.target, hullImpact);
          if (i === repeats - 1) {
            shipImpactEffect(atSequenceLocation(shot.effect().file(shipImpactFile(config, "impact", hullImpact)), impactLocation), target, 1.5);
          }
          await playSequenceAndWaitForArrayBeam(shot);
          if (i < repeats - 1) await _delay(250);
        }
        continue;
      }

      let impactLocation = sequenceLocation(target, null);
      let impactPoint = null;
      for (let i = 0; i < repeats; i++) {
        const locations = await shipShotLocations(token, target, {
          sourceOptions: { randomOffset: true },
          targetOptions: { randomOffset: true },
          weapon,
          shotIndex: i,
          targetSystem,
          selectedEmitter,
        });
        impactLocation = locations.impact;
        impactPoint = locations.target?.location ?? impactPoint;
        s = withSound(s, soundPath).wait(50);
        addAboveTargetBeamOverlay(s, config, locations.source, locations.target, target);
        s = waitForBeamImpact(stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
          locations.target
        ));
      }
      addShieldImpactStep(s, token, target, impactLocation?.location, shieldImpact, repeats - 1, repeats);
      shipImpactEffect(atSequenceLocation(s.effect().file(shipImpactFile(config, "impact", hullImpact)), impactLocation), target, 1.5);
      _stampHullDecalAt(s, target, impactPoint, hullImpact);
    } else {
      s = withSound(s, soundPath).wait(50);
      const missTarget = shipWeaponMissTargetLocation(target);
      await playSequencerArrayCurveCharge(config, token, weapon, missTarget.location, false, { selectedEmitter });
      stretchToSequenceLocation(
        atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon, 0, selectedEmitter)),
        missTarget
      ).missed();
    }
    await s.play();
  }
}

async function fireCannons(config, isHit, token, targets, repeatCount = 1, weapon = null, targetSystem = null, shieldImpact = null, hullImpact = null, selectedEmitter = null) {
  // repeatCount is the resolved damage-scaled shot count from fireWeapon.
  const shots = isHit ? Math.max(1, Math.floor(Number(repeatCount) || 1)) : 1;
  for (const target of targets) {
    const soundPath = isHit ? config.sound : (config.missSound ?? config.sound);
    let s = seq();
    if (isHit) {
      let impactLocation = sequenceLocation(target, null);
      let impactPoint = null;
      for (let i = 0; i < shots; i++) {
        const locations = await shipShotLocations(token, target, {
          sourceOptions: { randomOffset: true },
          targetOptions: { randomOffset: true },
          weapon,
          shotIndex: i,
          targetSystem,
          selectedEmitter,
        });
        impactLocation = locations.impact;
        impactPoint = locations.target?.location ?? impactPoint;
        s = withSound(s, soundPath).wait(50);
        addAboveTargetBeamOverlay(s, config, locations.source, locations.target, target);
        s = stretchToSequenceLocation(
          atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), locations.source),
          locations.target
        ).wait(50);
      }
      addShieldImpactStep(s, token, target, impactLocation?.location, shieldImpact, shots - 1, shots);
      shipImpactEffect(atSequenceLocation(s.effect().file(shipImpactFile(config, "impact", hullImpact)), impactLocation), target, 1.5);
      _stampHullDecalAt(s, target, impactPoint, hullImpact);
    } else {
      s = withSound(s, soundPath).wait(50);
      stretchToSequenceLocation(
        atSequenceLocation(shipTravelEffect(s.effect().file(config.effect), config), shipWeaponMissSourceLocation(token, target, weapon, 0, selectedEmitter)),
        shipWeaponMissTargetLocation(target)
      ).missed();
    }
    await s.play();
  }
}

async function fireTorpedoSingle(config, isHit, token, targets, repeatCount = 1, weapon = null, targetSystem = null, shieldImpact = null, hullImpact = null, selectedEmitter = null, finalDamage = 0) {
  const repeats = isHit ? getTorpedoCount(config.torpedoType, "standard", finalDamage) : 1;
  for (const target of targets) {
    const soundPath = config.sound;
    const s = seq();
    if (isHit) {
      for (let i = 0; i < repeats; i++) {
        const locations = await shipShotLocations(token, target, { weapon, shotIndex: i, targetSystem, selectedEmitter, arcRestrict: true });
        if (soundPath) s.sound().file(soundPath).volume(1);
        s.wait(150);
        applyTorpedoTravel(s, config, locations.source, locations.target, { finalDamage });
        s.wait(torpedoTravelMs(config));
        addShieldImpactStep(s, token, target, locations.target?.location, shieldImpact, i, repeats);
        _stampHullDecalAt(s, target, locations.target, hullImpact);
        shipImpactEffect(atSequenceLocation(s.effect().file(shipImpactFile(config, "explosion", hullImpact)), locations.impact), target, 1.5);
        if (i < repeats - 1) s.wait(250);
      }
    } else {
      if (soundPath) s.sound().file(soundPath).volume(1);
      s.wait(150);
      applyTorpedoTravel(s, config, shipWeaponMissSourceLocation(token, target, weapon, 0, selectedEmitter), shipWeaponMissTargetLocation(target), { missed: true, finalDamage });
    }
    await s.play();
  }
}

async function fireToolkitTorpedoAreaSalvo(config, token, target, salvoShots, weapon = null, targetSystem = null, shieldImpact = null, hullImpact = null, selectedEmitter = null, finalDamage = 0) {
  const soundPath = config.sound;
  const staggerMs = 180;
  const travelMs = torpedoTravelMs(config);
  const sequences = [];
  let explosionLocation = sequenceLocation(target, null);
  let explosionPoint = null;

  for (let i = 0; i < salvoShots; i++) {
    const locations = await shipShotLocations(token, target, {
      sourceOptions: { randomOffset: 0.4 },
      targetOptions: { randomOffset: 0.3 },
      weapon,
      shotIndex: i,
      targetSystem,
      selectedEmitter,
      arcRestrict: true,
    });
    explosionLocation = locations.impact;
    explosionPoint = locations.target?.location ?? explosionPoint;

    const shot = seq();
    if (i > 0) shot.wait(i * staggerMs);
    if (soundPath && i < 4) shot.sound().file(soundPath).volume(i === 0 ? 1 : 0.6);
    applyTorpedoTravel(shot, config, locations.source, locations.target, { finalDamage });
    sequences.push(shot);
  }

  const impact = seq().wait(((salvoShots - 1) * staggerMs) + travelMs);
  addShieldImpactStep(impact, token, target, explosionLocation?.location, shieldImpact, salvoShots - 1, salvoShots);
  shipImpactEffect(atSequenceLocation(impact.effect().file(shipImpactFile(config, "explosion", hullImpact)), explosionLocation), target, 2.0, 0.9);
  _stampHullDecalAt(impact, target, explosionPoint, hullImpact);
  sequences.push(impact);

  await Promise.all(sequences.map(sequence => sequence.play()));
}

async function fireTorpedoSalvo(config, isHit, token, targets, salvoMode, repeatCount = 1, weapon = null, targetSystem = null, shieldImpact = null, hullImpact = null, selectedEmitter = null, finalDamage = 0) {
  // Number of torpedoes the salvo fires (base × damage tier, capped), per type.
  const salvoCount = isHit ? getTorpedoCount(config.torpedoType, "salvo", finalDamage) : 1;

  if (salvoMode === "spread") {
    // One torpedo per target — same as single but faster succession across targets
    for (const target of targets) {
      const soundPath = config.sound;
      const s = seq();
      if (isHit) {
        for (let r = 0; r < salvoCount; r++) {
          const locations = await shipShotLocations(token, target, { weapon, shotIndex: r, targetSystem, selectedEmitter, arcRestrict: true });
          if (soundPath) s.sound().file(soundPath).volume(1);
          s.wait(100);
          applyTorpedoTravel(s, config, locations.source, locations.target, { finalDamage });
          s.wait(torpedoTravelMs(config));
          addShieldImpactStep(s, token, target, locations.target?.location, shieldImpact, r, salvoCount);
          _stampHullDecalAt(s, target, locations.target, hullImpact);
          shipImpactEffect(atSequenceLocation(s.effect().file(shipImpactFile(config, "explosion", hullImpact)), locations.impact), target, 1.5);
          if (r < salvoCount - 1) s.wait(250);
        }
      } else {
        if (soundPath) s.sound().file(soundPath).volume(1);
        s.wait(100);
        applyTorpedoTravel(s, config, shipWeaponMissSourceLocation(token, target, weapon, 0, selectedEmitter), shipWeaponMissTargetLocation(target), { missed: true, finalDamage });
      }
      await s.play();
    }
  } else {
    // Area salvo uses damage-scaled shots with staggered
    // timing and fanned launch offsets so each shot is visually distinct.
    for (const target of targets) {
      if (isHit && usesToolkitTorpedoSprite(config)) {
        await fireToolkitTorpedoAreaSalvo(config, token, target, salvoCount, weapon, targetSystem, shieldImpact, hullImpact, selectedEmitter, finalDamage);
        continue;
      }

      const soundPath = config.sound;
      const s = seq();

      if (isHit) {
        // Salvo count is base × damage tier, capped, configured per torpedo type.
        const salvoShots = salvoCount;
        let explosionLocation = sequenceLocation(target, null);
        let explosionPoint = null;
        for (let i = 0; i < salvoShots; i++) {
          const locations = await shipShotLocations(token, target, {
            sourceOptions: { randomOffset: 0.4 },
            targetOptions: { randomOffset: 0.3 },
            weapon,
            shotIndex: i,
            targetSystem,
            selectedEmitter,
            arcRestrict: true,
          });
          explosionLocation = locations.impact;
          explosionPoint = locations.target?.location ?? explosionPoint;
          if (i > 0) s.wait(180);
          // Cap the launch sounds so a large barrage doesn't stack into noise.
          if (soundPath && i < 4) s.sound().file(soundPath).volume(i === 0 ? 1 : 0.6);
          applyTorpedoTravel(s, config, locations.source, locations.target, { finalDamage });
        }
        // Explosion after the last torpedo arrives
        s.wait(torpedoTravelMs(config));
        addShieldImpactStep(s, token, target, explosionLocation?.location, shieldImpact, salvoShots - 1, salvoShots);
        shipImpactEffect(atSequenceLocation(s.effect().file(shipImpactFile(config, "explosion", hullImpact)), explosionLocation), target, 2.0, 0.9);
        _stampHullDecalAt(s, target, explosionPoint, hullImpact);
      } else {
        // One missed shot is enough visually
        if (soundPath) s.sound().file(soundPath).volume(1);
        applyTorpedoTravel(s, config, shipWeaponMissSourceLocation(token, target, weapon, 0, selectedEmitter), shipWeaponMissTargetLocation(target), { missed: true, finalDamage });
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

// Stamp a persistent scorch decal at the exact spot a shot struck the hull.
// `location` is a sequence-location ({ location: {x,y} }) or a raw {x,y} point —
// the same point the impact VFX is drawn at. Only fires when the hit reached the
// hull (shields down). Severity comes from hullImpact.finalDamage.
function _stampHullDecalAt(seq, targetToken, location, hullImpact) {
  if (!hullImpact?.shieldsDown || !targetToken) return;
  const point = (location && typeof location.x === "number") ? location : location?.location;
  if (!point || typeof point.x !== "number") return;
  const px = point.x, py = point.y, fd = hullImpact.finalDamage;
  const stamp = () => {
    stampHullDecal(targetToken, { x: px, y: py }, { finalDamage: fd })
      ?.catch?.(err => console.warn("STA2e Toolkit | Hull decal stamp failed:", err));
  };
  // Run the stamp WHEN the sequence reaches the impact, so the scorch appears
  // together with the explosion rather than the instant the animation starts.
  if (seq && typeof seq.thenDo === "function") seq.thenDo(stamp);
  else stamp();
}

export async function fireWeapon(config, isHit, token, targets, { spreadDeclared = false, salvoMode = "area", repeatCount = 1, weapon = null, targetSystem = null, shieldImpact = null, hullImpact = null, finalDamage = 0 } = {}) {
  if (!config) return;
  config = withPhaserEraConfig(config, token, weapon);
  const shipRepeatCount = isHit ? normalizeRepeatCount(repeatCount) : 1;
  // Energy weapons (banks/arrays/lances = "beam", cannons = "cannon") scale how
  // many times the animation plays by final damage, per-family configurable.
  const isEnergyWeapon = config.type === "beam" || config.type === "cannon";
  const energyShotCount = isHit && isEnergyWeapon
    ? getEnergyWeaponShotCount(config.family, finalDamage)
    : shipRepeatCount;
  const selectedEmitter = await prepareShipEmitterFacing(config, token, targets, weapon);

  if (await fireNativeWeaponVFX(config, isHit, token, targets, {
    spreadDeclared,
    salvoMode,
    repeatCount: energyShotCount,
    weapon,
    targetSystem,
    shieldImpact,
    hullImpact,
    selectedEmitter,
  })) return;

  if (!combatAnimationsAvailable()) return;

  switch (config.type) {
    // Ship-scale weapons
    case "beam":
      if (spreadDeclared || salvoMode === "spread") await fireBeamSpread(config, isHit, token, targets, energyShotCount, weapon, targetSystem, shieldImpact, hullImpact, selectedEmitter);
      else await fireBeamSingle(config, isHit, token, targets, energyShotCount, weapon, targetSystem, shieldImpact, hullImpact, selectedEmitter);
      break;
    case "cannon":
      await fireCannons(config, isHit, token, targets, energyShotCount, weapon, targetSystem, shieldImpact, hullImpact, selectedEmitter);
      break;
    case "torpedo":
      // Count comes from the per-type sliders (base × damage tier, capped).
      // Plasma keeps its damage-scaled, shrinking sprite via applyTorpedoTravel.
      if (config.salvo)
        await fireTorpedoSalvo(config, isHit, token, targets, salvoMode, shipRepeatCount, weapon, targetSystem, shieldImpact, hullImpact, selectedEmitter, finalDamage);
      else
        await fireTorpedoSingle(config, isHit, token, targets, shipRepeatCount, weapon, targetSystem, shieldImpact, hullImpact, selectedEmitter, finalDamage);
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
