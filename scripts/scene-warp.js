/**
 * sta2e-toolkit | scene-warp.js
 * Scene Warp — the state. No rendering, no UI.
 *
 * Puts a whole tactical scene at warp: stars streak past in a chosen direction
 * ([scene-warp-vfx.js](scene-warp-vfx.js)), every ship holds a bow-forward
 * formation heading, and weapons fire without the ships slewing round to face
 * their targets. Driven from [scene-warp-panel.js](scene-warp-panel.js).
 *
 * Distinct from the two things it sits between:
 *   - [warp-viewscreen-vfx.js](warp-viewscreen-vfx.js) is the *forward* view,
 *     clipped to a Region — a viewscreen painted into a bridge map.
 *   - [warp-jump-vfx.js](warp-jump-vfx.js) / [warp-stretch-vfx.js](warp-stretch-vfx.js)
 *     are one ship's jump *to* warp. This is the sustained state of being there.
 *
 * **This module imports nothing on purpose.** [weapon-configs.js](weapon-configs.js)
 * and [native-weapon-vfx.js](native-weapon-vfx.js) both consult it from deep
 * inside the firing path, and it has to stay a leaf so they can — the same
 * reasoning that keeps [actor-faction.js](actor-faction.js) import-free. The one
 * consequence is the rotation conversion below is written out rather than
 * borrowed from `bearingToTokenRotation` in spawn-picker.js.
 *
 * Three rules carried over verbatim from the warp viewscreen, for the same
 * reasons they hold there:
 *
 *  1. **No socket action.** The GM writes the scene flag and Foundry replicates
 *     the Scene update to every client itself, exactly as Q Flash Move relies on
 *     document.update. It is also the only thing that gives correct state on
 *     reload and to a player who joins mid-warp, which a one-shot broadcast
 *     cannot.
 *  2. **`phaseAt` is a wall-clock stamp** and each client derives its own ramp
 *     position from it. Nobody writes a second update to end a ramp: `entering`
 *     settles into `cruise` and `exiting` into `idle` locally, from elapsed time.
 *  3. **Anything labelling a button reads `effectiveScenePhase()`,** never the
 *     raw stored `phase`.
 */

const MODULE = "sta2e-toolkit";
export const SCENE_WARP_FLAG = "sceneWarp";

/** The phases the panel drives, in the order they run. */
export const SCENE_WARP_PHASES = ["idle", "entering", "cruise", "exiting"];

/** How the current phase reads in the panel's status strip. */
export const SCENE_PHASE_TEXT = {
  idle:     "SUBLIGHT",
  entering: "ENGAGING…",
  cruise:   "AT WARP",
  exiting:  "DROPPING OUT…",
};

// Defaults for a scene that has never been configured. `lockHeading` is true
// here but only ever consulted through `isSceneHeadingLocked`, which first
// requires the flag to actually exist — otherwise every untouched scene in the
// world would report its ships as rotation-locked.
const DEFAULTS = {
  phase:                   "idle",
  phaseAt:                 0,
  course:                  0,      // compass degrees; 0 = north = up the screen
  warpFactor:              6,
  lockHeading:             true,
  disableWeaponAutoRotate: true,
  density:                 700,
  starTint:                "#cfe6ff",
  accentTint:              "#7dd3fc",
  variety:                 40,
  streakMul:               100,
  thickness:               100,
  parallax:                true,
  foreground:              true,
  drift:                   false,
};

// ── Reading ──────────────────────────────────────────────────────────────────

const _num = (v, d) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const _clamp = (v, min, max, d) => Math.min(max, Math.max(min, _num(v, d)));

/** The raw stored flag, or null when this scene was never put at warp. */
export function getSceneWarpRaw(scene = canvas?.scene) {
  try {
    return scene?.getFlag?.(MODULE, SCENE_WARP_FLAG) ?? null;
  } catch {
    return null;
  }
}

// ── Caches ───────────────────────────────────────────────────────────────────
//
// The renderer reads config and timings from inside its per-frame tick, so that
// a slider drag on the panel is live for everyone with no re-attach. Both reads
// therefore have to be nearly free.
//
// starfield-common.js carries an equivalent settings memo for the two renderers,
// and this deliberately does NOT import it: keeping this module a leaf is what
// lets the firing path consult it without a cycle (see the header). A dozen
// duplicated lines is the cheaper half of that trade.

const _settingCache = new Map();
let _settingHookId = null;

function _setting(key, fallback) {
  if (_settingCache.has(key)) return _settingCache.get(key);
  let v;
  try {
    v = Number(game.settings.get(MODULE, key));
  } catch {
    return fallback;   // VFX can run before settings register — don't cache it
  }
  if (!Number.isFinite(v) || v <= 0) v = fallback;
  _settingCache.set(key, v);
  return v;
}

/**
 * The built config for one raw flag object.
 *
 * Keyed on the raw flag by **object identity**: `getFlag` hands back the same
 * reference until the document is actually updated, so a hit costs one property
 * walk and allocates nothing. Before this, the tick built three of these objects
 * every frame — around 180 a second of pure GC churn.
 */
let _cfgKey = null;
let _cfgValue = null;

/** Drop both caches. */
export function invalidateSceneWarpCache() {
  _settingCache.clear();
  _cfgKey = null;
  _cfgValue = null;
}

/** Wire cache invalidation. Call once from main.js init. */
export function registerSceneWarpCache() {
  if (_settingHookId !== null) return;
  _settingHookId = Hooks.on("updateSetting", () => _settingCache.clear());
}

/** True once the scene has a Scene Warp configuration at all. */
export function hasSceneWarp(scene = canvas?.scene) {
  return !!getSceneWarpRaw(scene);
}

/**
 * The scene's warp config with every value defended and clamped.
 *
 * Always returns an object, so callers never branch on null; use
 * `hasSceneWarp()` when the distinction matters.
 */
export function getSceneWarp(scene = canvas?.scene) {
  const raw = getSceneWarpRaw(scene);
  // Identity hit — same flag object as last time, so the built config still
  // stands. `{}` for an unconfigured scene would be a fresh object every call,
  // so null is its own cache key.
  if (raw !== null && raw === _cfgKey) return _cfgValue;

  const s = raw ?? {};
  const built = {
    phase:      SCENE_WARP_PHASES.includes(s.phase) ? s.phase : DEFAULTS.phase,
    phaseAt:    _num(s.phaseAt, 0),
    course:     ((_num(s.course, DEFAULTS.course) % 360) + 360) % 360,
    warpFactor: _clamp(s.warpFactor, 1, 9.9, DEFAULTS.warpFactor),

    lockHeading:             s.lockHeading !== false,
    disableWeaponAutoRotate: s.disableWeaponAutoRotate !== false,

    density:    Math.round(_clamp(s.density, 50, 2000, DEFAULTS.density)),
    starTint:   String(s.starTint   ?? DEFAULTS.starTint),
    accentTint: String(s.accentTint ?? DEFAULTS.accentTint),
    variety:    _clamp(s.variety,   0,  100, DEFAULTS.variety) / 100,
    streakMul:  _clamp(s.streakMul, 10, 400, DEFAULTS.streakMul) / 100,
    thickness:  _clamp(s.thickness, 50, 400, DEFAULTS.thickness) / 100,

    parallax:   s.parallax  !== false,
    foreground: s.foreground !== false,
    // The one look option that is opt-IN: with no backdrop of its own this
    // field overlays your map art, so a scene merely *configured* for warp must
    // not quietly start drifting stars across a normal encounter.
    drift:      s.drift === true,
  };

  if (raw !== null) { _cfgKey = raw; _cfgValue = built; }
  return built;
}

/**
 * Ramp durations, world settings so the GM tunes the feel once.
 *
 * Memoised: this is read from inside the render tick, and three uncached
 * `game.settings.get` calls a frame is 540 a second at 60fps. The object itself
 * is rebuilt per call but only from cached numbers; callers hold it for the
 * length of one tick.
 */
export function getSceneWarpTiming() {
  return {
    enterMs:  _setting("sceneWarpEnterMs", 2600),
    exitMs:   _setting("sceneWarpExitMs", 2000),
    speedMul: Math.max(0.1, _setting("sceneWarpStarSpeed", 100) / 100),
  };
}

/**
 * How much the field is thinned on this client, and which bands it draws.
 *
 * **Client scope on purpose.** Frame rate is a per-machine problem: a player on
 * a laptop needs to turn this down without the GM deciding it for the whole
 * table, which a scene flag would do. It only ever *reduces* what the scene's
 * own controls ask for.
 */
export const SCENE_WARP_QUALITY = {
  high:   { densityMul: 1.0,  bands: 3, foreground: true  },
  medium: { densityMul: 0.55, bands: 3, foreground: false },
  low:    { densityMul: 0.28, bands: 2, foreground: false },
};

export function getSceneWarpQuality() {
  let key = "high";
  try { key = String(game.settings.get(MODULE, "sceneWarpQuality") ?? "high"); } catch { /* pre-init */ }
  return SCENE_WARP_QUALITY[key] ?? SCENE_WARP_QUALITY.high;
}

/**
 * The phase this scene is *actually* in right now.
 *
 * A ramp ends without anybody writing a second document update: once
 * `enterMs` has elapsed since `phaseAt`, `entering` is `cruise` everywhere at
 * once, because every client works it out from the same wall-clock stamp. Read
 * this, never `getSceneWarp().phase`, anywhere a label or a decision depends on
 * where the ramp has got to.
 */
export function effectiveScenePhase(scene = canvas?.scene) {
  return scenePhaseFrom(getSceneWarp(scene), getSceneWarpTiming());
}

/**
 * The same answer, from values the caller already holds.
 *
 * The render tick needs the config, the timing and the phase every frame. With
 * only the `scene`-taking form available it re-derived the first two on every
 * call — and because the ramp helper called this *and* read them itself, a
 * single tick ended up reading the scene flag three times and the settings nine.
 * Passing them in makes that impossible rather than merely unlikely. Take this
 * form anywhere you already have a cfg.
 */
export function scenePhaseFrom(cfg, timing) {
  if (cfg.phase !== "entering" && cfg.phase !== "exiting") return cfg.phase;
  const elapsed = Date.now() - cfg.phaseAt;
  const span    = cfg.phase === "entering" ? timing.enterMs : timing.exitMs;
  if (!(cfg.phaseAt > 0) || elapsed >= span) {
    return cfg.phase === "entering" ? "cruise" : "idle";
  }
  return cfg.phase;
}

/** True while the scene is at warp or on its way there. */
export function isSceneAtWarp(scene = canvas?.scene) {
  if (!hasSceneWarp(scene)) return false;
  const phase = effectiveScenePhase(scene);
  return phase === "entering" || phase === "cruise";
}

/** True once the ramp has finished and the field is at cruise. */
export function isSceneAtFullWarp(scene = canvas?.scene) {
  return hasSceneWarp(scene) && effectiveScenePhase(scene) === "cruise";
}

/**
 * True when ships on this scene hold the formation heading.
 *
 * An independent switch, not a consequence of the phase — a GM may want the
 * fleet locked bow-forward while setting an encounter up, before engaging.
 */
export function isSceneHeadingLocked(scene = canvas?.scene) {
  return hasSceneWarp(scene) && getSceneWarp(scene).lockHeading;
}

/**
 * True when weapons on this scene skip the turn-to-face entirely.
 *
 * Also independent of the phase, and deliberately so: at warp everyone is
 * bow-forward, so a ship firing on a target abeam would otherwise slew across
 * the formation. Consumed by `isWeaponAutoRotateDisabled` in weapon-configs.js
 * and its twin in native-weapon-vfx.js — which drops firing-arc enforcement in
 * favour of the nearest emitter as a side effect, and that is intended here.
 */
export function isSceneWeaponAutoRotateDisabled(scene = canvas?.scene) {
  return hasSceneWarp(scene) && getSceneWarp(scene).disableWeaponAutoRotate;
}

// ── Ships ────────────────────────────────────────────────────────────────────

/**
 * Is this actor a starship or small craft?
 *
 * The widest of the tests the codebase already carries — the one from
 * elevation-ruler.js, which catches system-specific types plus anything that
 * merely walks like a ship. main.js has a narrower copy that misses
 * `spacecraft2e`. Import this one rather than writing a fourth.
 */
export function isShipActor(actor) {
  if (!actor) return false;
  return actor.type === "starship"
    || actor.type === "spacecraft2e"
    || actor.type === "smallcraft"
    || actor.system?.systems !== undefined
    || actor.items?.some(i => i.type === "starshipweapon2e");
}

/** Is this token (or TokenDocument) a ship? */
export function isShipToken(tokenOrDoc) {
  return isShipActor((tokenOrDoc?.actor) ?? (tokenOrDoc?.document?.actor) ?? null);
}

/** Every ship Token on a scene's canvas. */
export function sceneShipTokens(scene = canvas?.scene) {
  if (!canvas?.ready || (scene && canvas.scene?.id !== scene.id)) return [];
  return (canvas.tokens?.placeables ?? []).filter(isShipToken);
}

/**
 * Compass course (0 = north, up the screen) → Foundry token rotation.
 *
 * Foundry treats `rotation === 0` as facing *south*, and core's own auto-rotate
 * writes `bearing - 90` where bearing is the atan2(dy, dx) angle. A compass
 * course converts to that bearing with `course - 90`, so the whole conversion
 * collapses to `course - 180`. Sanity check: course 0 (north) → 180, which is
 * indeed Foundry's "facing north".
 */
export function courseToTokenRotation(courseDeg) {
  return ((_num(courseDeg, 0) - 180) % 360 + 360) % 360;
}

/** The inverse, for turning a GM's manual token rotation back into a course. */
export function tokenRotationToCourse(rotationDeg) {
  return ((_num(rotationDeg, 0) + 180) % 360 + 360) % 360;
}

/**
 * The canvas-space unit vector the *stars* travel along.
 *
 * The reciprocal of the fleet's course: the ships are going that way, so the
 * field streams the other way past them.
 */
export function starFlowVector(courseDeg) {
  const bearing = (_num(courseDeg, 0) - 90) * (Math.PI / 180);
  return { x: -Math.cos(bearing), y: -Math.sin(bearing) };
}

// ── Writing (GM only) ────────────────────────────────────────────────────────

async function _write(patch, scene = canvas?.scene) {
  if (!scene) return null;
  if (!game.user?.isGM) {
    console.warn("STA2e Toolkit | scene warp: only the GM can change scene warp state.");
    return null;
  }
  const next = { ...(getSceneWarpRaw(scene) ?? {}), ...patch };
  await scene.setFlag(MODULE, SCENE_WARP_FLAG, next);
  return next;
}

/** Patch any subset of the config. Look values are live for every client. */
export async function setSceneWarpConfig(patch, scene = canvas?.scene) {
  return _write(patch, scene);
}

/**
 * Engage. Stamps the phase, and snaps the fleet onto the course if the heading
 * lock is on — one alignment write rather than the lock fighting each ship's
 * old facing frame by frame.
 */
export async function enterSceneWarp(scene = canvas?.scene) {
  const written = await _write({ phase: "entering", phaseAt: Date.now() }, scene);
  if (written && (written.lockHeading !== false)) await alignFleetToCourse(scene);
  return written;
}

/** Drop out. The field ramps down locally from this stamp. */
export async function exitSceneWarp(scene = canvas?.scene) {
  return _write({ phase: "exiting", phaseAt: Date.now() }, scene);
}

/** Change course. The renderer eases to it; the fleet snaps if locked. */
export async function setSceneCourse(courseDeg, scene = canvas?.scene) {
  const course  = ((_num(courseDeg, 0) % 360) + 360) % 360;
  const written = await _write({ course }, scene);
  if (written && (written.lockHeading !== false)) await alignFleetToCourse(scene);
  return written;
}

/**
 * Snap every ship on the scene to the formation heading.
 *
 * One `updateEmbeddedDocuments` call rather than a loop of per-token updates:
 * a fleet of eight otherwise fires eight replicated updates and eight preUpdate
 * passes. Tokens already on the heading are skipped so an align on an unchanged
 * fleet writes nothing at all.
 */
export async function alignFleetToCourse(scene = canvas?.scene) {
  if (!game.user?.isGM || !canvas?.ready) return;
  const cfg      = getSceneWarp(scene);
  const rotation = courseToTokenRotation(cfg.course);
  const updates  = sceneShipTokens(scene)
    .filter(t => Math.abs(((t.document.rotation ?? 0) - rotation + 540) % 360 - 180) > 0.5)
    .map(t => ({ _id: t.document.id, rotation }));
  if (!updates.length) return;
  // `sta2eSceneWarpAlign` marks these as the lock's own output so the
  // preUpdateToken guard in main.js lets them through instead of treating them
  // as a rotation to revert or to adopt as a new course.
  await canvas.scene.updateEmbeddedDocuments("Token", updates, { sta2eSceneWarpAlign: true });
}

/** Clear all Scene Warp state from a scene. */
export async function clearSceneWarp(scene = canvas?.scene) {
  if (!game.user?.isGM || !scene) return;
  await scene.unsetFlag(MODULE, SCENE_WARP_FLAG);
}
