/**
 * Warp Viewscreen — the Region Behavior.
 *
 * This is the module's first RegionBehaviorType. A Region drawn over the
 * viewscreen or window in a bridge map gains this behavior, and the starfield in
 * warp-viewscreen-vfx.js renders clipped to that Region outline.
 *
 * Why a behavior rather than a scene flag: Foundry hands a behavior a per-client
 * `behaviorViewed` / `behaviorUnviewed` lifecycle for free, which is exactly the
 * attach/detach signal the renderer needs, and it fires on the right clients
 * without any bookkeeping of our own.
 *
 * The config sheet is generated entirely from the schema by core's
 * RegionBehaviorConfig — there is no .hbs to write. The one hand-built control is
 * the canvas picker for the vanishing point, injected into the rendered sheet the
 * same way region-pad-config.js injects the spawn-marker checkbox.
 */

import {
  awaitCanvasClick,
  cursorPoint,
  showOverlay,
  setCrosshairCursor,
  crosshair,
  stroked,
  INDICATOR_COLOR,
} from "./spawn-picker.js";
import {
  attachViewscreen,
  detachViewscreen,
  rebuildMask,
  refreshViewscreen,
  flashViewscreen,
  sweepViewscreens,
  getViewscreenTiming,
  viewscreenEnvironmentId,
} from "./warp-viewscreen-vfx.js";
import {
  getEnvironment,
  environmentChoices,
  DEFAULT_ENVIRONMENT,
} from "./viewscreen-environments.js";

const MODULE = "sta2e-toolkit";

/**
 * The RegionBehavior document type.
 *
 * Namespaced with the module id because that is what the server builds: a module
 * subtype declared in module.json as `documentTypes.RegionBehavior.warpViewscreen`
 * lands in `game.model.RegionBehavior` under `<module-id>.<type>`. `Document.TYPES`
 * reads that model, and the Add Behavior dropdown reads `TYPES` — so registering
 * `CONFIG.RegionBehavior.dataModels` alone is *not* enough to make the type
 * offered, and the key here has to match the namespaced one exactly.
 */
export const VIEWSCREEN_TYPE = "sta2e-toolkit.warpViewscreen";

/**
 * The label shown in the Add Behavior dropdown.
 *
 * It must be a real localization key, not a literal string: `createDialog` does
 * `game.i18n.has(label) ? localize(label) : type`, so a plain string silently
 * falls back to printing the raw type id. This is the same key core's own
 * localization pass would derive.
 */
const TYPE_LABEL_KEY = `TYPES.RegionBehavior.${VIEWSCREEN_TYPE}`;
const TYPE_HINT_KEY  = `TYPES.HINTS.RegionBehavior.${VIEWSCREEN_TYPE}`;

/** The phases the GM panel drives, in the order they run. */
export const VIEWSCREEN_PHASES = ["idle", "entering", "cruise", "exiting"];

const PHASE_CHOICES = {
  idle:     "Idle — sublight",
  entering: "Entering warp",
  cruise:   "At warp",
  exiting:  "Dropping out of warp",
};

/**
 * How a backdrop image is sized into the region.
 *
 * Exported so the GM panel builds its dropdown from the same table the schema
 * validates against, the way `PHASE_CHOICES` is used above.
 */
export const IMAGE_FIT_CHOICES = {
  cover:   "Cover — fill and crop",
  contain: "Contain — fit inside",
  stretch: "Stretch — distort to fit",
  native:  "Native size",
};

/** The live image fields one library entry stores, and the key it stores under. */
export const IMAGE_ENTRY_FIELDS = {
  src:     "imageSrc",
  fit:     "imageFit",
  scale:   "imageScale",
  offsetX: "imageOffsetX",
  offsetY: "imageOffsetY",
  alpha:   "imageAlpha",
  above:   "imageAbove",
};

/**
 * The same list without `src` — the fields that describe how a backdrop is
 * *framed* rather than which backdrop it is.
 *
 * The distinction is load-bearing. The panel mirrors live edits back into the
 * active library entry so a nudged slider sticks to the saved backdrop, and when
 * `src` rode along in that mirror, browsing for a second picture rewrote the
 * *first* entry's file before it was ever saved — so every entry ended up
 * pointing at the most recently chosen image. A file is the backdrop's identity;
 * changing it means you are no longer showing that saved entry, which is why the
 * panel detaches from the library instead of writing through.
 */
export const IMAGE_FRAMING_FIELDS = Object.fromEntries(
  Object.entries(IMAGE_ENTRY_FIELDS).filter(([key]) => key !== "src"),
);

/**
 * What one entry means when a key is absent.
 *
 * Selecting an entry has to settle *every* live field: Foundry drops `undefined`
 * from an update payload, so a missing key would silently leave the previous
 * backdrop's value in place rather than resetting it.
 */
export const IMAGE_ENTRY_DEFAULTS = Object.freeze({
  src: null, fit: "cover", scale: 100, offsetX: 0, offsetY: 0, alpha: 100, above: false,
});

// ── The data model ───────────────────────────────────────────────────────────

export class WarpViewscreenBehaviorType
  extends foundry.data.regionBehaviors.RegionBehaviorType {

  /** Only the base prefix — every field below carries its own literal label. */
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.base"];

  /**
   * No `_createEventsField()` here on purpose: this behavior never reacts to
   * token movement, so the sheet's "Subscribed events" fieldset is suppressed by
   * simply not declaring one.
   */
  static defineSchema() {
    const f = foundry.data.fields;
    return {
      // ── Live state, written by the GM panel ────────────────────────────────
      phase: new f.StringField({
        required: true, blank: false, initial: "idle", choices: PHASE_CHOICES,
        label: "Phase",
        hint: "Driven by the Warp Viewscreen panel. Entering and Exiting settle "
            + "into At warp / Idle on their own once the ramp finishes.",
      }),
      phaseAt: new f.NumberField({
        required: true, integer: true, initial: 0, nullable: false,
        label: "Phase started at",
        hint: "Wall-clock stamp for the current phase. Every client derives its "
            + "own ramp position from this, so a player who joins mid-warp is in "
            + "step. Set by the panel — no reason to edit it by hand.",
      }),

      // ── Environment ───────────────────────────────────────────────────────
      environment: new f.StringField({
        required: true, blank: false, initial: DEFAULT_ENVIRONMENT,
        choices: environmentChoices("viewscreen"),
        label: "Environment",
        hint: "What the ship is flying through. Warp is the classic starfield; "
            + "the others reuse the same look controls below under different "
            + "names, so Star Count means cloud density in a nebula and rock "
            + "count in an asteroid field. The Warp Viewscreen panel retunes "
            + "every one of them for you when you switch there — changing it "
            + "here swaps the environment and leaves your look settings alone.",
      }),
      // Which saved look preset was last applied here. The library itself is a
      // world setting (viewscreen-presets.js) rather than region data — this is
      // only the pointer, so the panel can offer Update and Rename against the
      // right entry after a reload. Hidden from this sheet by
      // `_hideLookPresetField`: it is a panel-owned id, and a raw id in a text
      // box is worse than nothing.
      lookPreset: new f.StringField({
        required: false, blank: true, initial: "",
        label: "Look Preset",
      }),
      intensity: new f.NumberField({
        required: true, initial: 100, min: 0, max: 100, step: 5, nullable: false,
        label: "Environment Intensity (%)",
        hint: "How strongly the environment asserts itself: how much gas, how "
            + "much debris, how violent the storm, how heavy the static. Also "
            + "drives the haze, the colour wash and how often lightning strikes. "
            + "No effect at all on plain Warp.",
      }),
      lightning: new f.NumberField({
        required: true, initial: 0, min: 0, max: 100, step: 5, nullable: false,
        label: "Lightning (%)",
        hint: "Switches the ion storm's electrical discharge on over whatever "
            + "else the viewscreen is showing — an ionized nebula, a charged "
            + "debris field. Drives the flash, the bolts, the shake and how "
            + "often they strike. Bolts take the accent colour, so they match "
            + "the environment they are in. Ignored when the environment is "
            + "already an Ion Storm, which has its own.",
      }),
      interference: new f.NumberField({
        required: true, initial: 0, min: 0, max: 100, step: 5, nullable: false,
        label: "Interference (%)",
        hint: "Lays the Signal Loss static over whatever else the viewscreen is "
            + "showing, so a screen can break up while the ship is still at warp "
            + "or in a nebula. 0 is a clean picture; 100 is as heavy as the "
            + "Signal Loss environment itself, but with the view still visible "
            + "underneath. Ignored when the environment is already Signal Loss, "
            + "which has nothing to lay it over.",
      }),
      starMix: new f.NumberField({
        required: true, initial: 100, min: 0, max: 100, step: 5, nullable: false,
        label: "Starfield Mix (%)",
        hint: "How much of the ordinary starfield survives behind the "
            + "environment. 100% is a full field; lower values read as stars "
            + "obscured by whatever you are flying through; 0 removes them "
            + "entirely, which is what the Static environment wants.",
      }),

      // ── Flight ────────────────────────────────────────────────────────────
      warpFactor: new f.NumberField({
        required: true, initial: 6, min: 1, max: 9.9, step: 0.1, nullable: false,
        label: "Warp Factor",
        hint: "How fast the stars run once at warp. 1 is a crawl, 9.9 streaks.",
      }),
      inbound: new f.BooleanField({
        initial: false,
        label: "Reverse flow (rear view)",
        hint: "Off: stars stream out of the vanishing point — the forward view. "
            + "On: stars converge into it, for a rear window or backing away.",
      }),
      spread: new f.NumberField({
        required: true, initial: 30, min: 0, max: 100, step: 5, nullable: false,
        label: "Spread (%)",
        hint: "How wide an area stars appear from. At 0 they all stream out of a "
            + "single point — about 60% of the field bunches at the vanishing "
            + "point. The 30% default drops that to under 10%. Stars cross in "
            + "the same time either way, but a wider spread does lengthen the "
            + "average streak, since more of the field sits out where the "
            + "apparent motion is fastest — trim Streak Length to compensate.",
      }),

      // ── Aim ───────────────────────────────────────────────────────────────
      vanishX: new f.NumberField({
        required: false, nullable: true, initial: null,
        label: "Vanishing Point X",
        hint: "Canvas coordinate the stars radiate from. Blank centres it on the "
            + "region. Use Set Vanishing Point to click it instead of typing.",
      }),
      vanishY: new f.NumberField({
        required: false, nullable: true, initial: null,
        label: "Vanishing Point Y",
      }),

      // ── Look ──────────────────────────────────────────────────────────────
      density: new f.NumberField({
        required: true, integer: true, initial: 600, min: 20, max: 1500, step: 10,
        nullable: false,
        label: "Star Count",
        hint: "A warp field wants to be dense — a few hundred stars reads as "
            + "sparse. 600 is the tuned default.",
      }),
      starTint: new f.ColorField({
        required: true, nullable: false, initial: "#cfe6ff",
        label: "Star Colour",
        hint: "The base of the field — cold white-blue by default.",
      }),
      accentTint: new f.ColorField({
        required: true, nullable: false, initial: "#a855f7",
        label: "Accent Star Colour",
        hint: "The second hue mixed through the field, and the colour of the "
            + "nebula haze. Violet by default.",
      }),
      variety: new f.NumberField({
        required: true, initial: 45, min: 0, max: 100, step: 5, nullable: false,
        label: "Colour Variety (%)",
        hint: "Share of stars drawn toward the accent colour. At 0 every star is "
            + "the base hue (brightness still varies with distance); the default "
            + "leaves most stars white-blue with a scattering of accent ones, "
            + "which is what makes the field read as depth rather than wallpaper.",
      }),
      streakMul: new f.NumberField({
        required: true, initial: 100, min: 10, max: 400, step: 5, nullable: false,
        label: "Streak Length (%)",
        hint: "Trims how far each star smears. 100% is the tuned default.",
      }),
      thickness: new f.NumberField({
        required: true, initial: 100, min: 50, max: 400, step: 5, nullable: false,
        label: "Streak Thickness (%)",
        hint: "How heavy each streak is. 100% is a hairline of roughly one pixel, "
            + "which is what a trailed star actually looks like; raise it for a "
            + "bolder field or on a large viewscreen where hairlines get lost. "
            + "Below 100% streaks go sub-pixel and read as fainter rather than "
            + "genuinely thinner — drop Star Colour brightness instead if that "
            + "is what you are after.",
      }),
      backdrop: new f.ColorField({
        required: true, nullable: false, initial: "#05030c",
        label: "Backdrop Colour",
      }),
      backdropAlpha: new f.NumberField({
        required: true, initial: 85, min: 0, max: 100, step: 5, nullable: false,
        label: "Backdrop Opacity (%)",
        hint: "Paints space behind the stars, clipped to the region. Set to 0 if "
            + "the map art already draws a black screen underneath.",
      }),

      // ── Backdrop image ────────────────────────────────────────────────────
      //
      // Two halves. The seven `image*` fields below are the *live* backdrop and
      // are what the renderer reads — flat, so the render path never looks an
      // entry up by id. `images` is a saved library the GM builds from the
      // panel; picking one *copies* its values into these fields, exactly as the
      // Environment select writes `{environment, ...environmentDefaults(id)}`.
      //
      // The library is an ArrayField, and that is load-bearing: core's
      // RegionBehaviorConfig only emits fields whose class has `hasFormSupport`,
      // which ArrayField does not, so it is skipped by the auto-sheet silently
      // rather than rendering a broken control. FilePathField *does* have it and
      // renders a real <file-picker>, so the live row costs no injection at all.
      images: new f.ArrayField(new f.SchemaField({
        id:      new f.StringField({ required: true, blank: false,
                                     initial: () => foundry.utils.randomID() }),
        label:   new f.StringField({ required: true, blank: true, initial: "" }),
        src:     new f.FilePathField({ categories: ["IMAGE", "VIDEO"],
                                       nullable: true, initial: null }),
        fit:     new f.StringField({ required: true, blank: false, initial: "cover",
                                     choices: IMAGE_FIT_CHOICES }),
        scale:   new f.NumberField({ initial: 100, min: 10,   max: 400, step: 5, nullable: false }),
        offsetX: new f.NumberField({ initial: 0,   min: -100, max: 100, step: 1, nullable: false }),
        offsetY: new f.NumberField({ initial: 0,   min: -100, max: 100, step: 1, nullable: false }),
        alpha:   new f.NumberField({ initial: 100, min: 0,    max: 100, step: 5, nullable: false }),
        above:   new f.BooleanField({ initial: false }),
      }), { initial: [] }),
      activeImage: new f.StringField({
        required: false, blank: true, initial: "",
        label: "Saved Backdrop",
        hint: "Which saved backdrop is showing. Entries are added and removed "
            + "from the Warp Viewscreen panel; this only picks between them.",
      }),
      imageSrc: new f.FilePathField({
        categories: ["IMAGE", "VIDEO"], nullable: true, initial: null,
        label: "Backdrop Image",
        hint: "An image or looping video drawn inside the region outline — a "
            + "planet, a starbase, a star chart. Clipped to the region like "
            + "everything else here, so anything hanging over the edge is "
            + "trimmed rather than spilling onto the map.",
      }),
      imageFit: new f.StringField({
        required: true, blank: false, initial: "cover", choices: IMAGE_FIT_CHOICES,
        label: "Image Fit",
        hint: "Cover fills the region and crops the overhang; Contain fits the "
            + "whole picture inside it and leaves the backdrop colour showing; "
            + "Stretch distorts to fit exactly; Native size draws it at its own "
            + "pixel size.",
      }),
      imageScale: new f.NumberField({
        required: true, initial: 100, min: 10, max: 400, step: 5, nullable: false,
        label: "Image Scale (%)",
        hint: "Multiplies whatever the fit mode worked out. 100% is the fit.",
      }),
      imageOffsetX: new f.NumberField({
        required: true, initial: 0, min: -100, max: 100, step: 1, nullable: false,
        label: "Image Offset X (%)",
        hint: "Shifts the image sideways, as a percentage of the region's own "
            + "width — so a saved backdrop keeps its framing if the region is "
            + "later moved or reshaped.",
      }),
      imageOffsetY: new f.NumberField({
        required: true, initial: 0, min: -100, max: 100, step: 1, nullable: false,
        label: "Image Offset Y (%)",
      }),
      imageAlpha: new f.NumberField({
        required: true, initial: 100, min: 0, max: 100, step: 5, nullable: false,
        label: "Image Opacity (%)",
      }),
      imageAbove: new f.BooleanField({
        initial: false,
        label: "Draw image above the starfield",
        hint: "Off by default, so the picture sits behind the stars — a planet "
            + "you are flying past. Turn on for a tactical display, star chart "
            + "or hail that should cover the field.",
      }),
      nebula: new f.BooleanField({
        initial: true,
        label: "Nebula haze",
        hint: "A soft wash of the accent colour off to one side, away from the "
            + "vanishing point.",
      }),
      flash: new f.BooleanField({
        // Off by default, unlike the other look options: this burst was removed
        // once for being intrusive, so it is opt-in rather than opt-out.
        initial: false,
        label: "Starburst on enter and exit",
        hint: "A short white burst at the centre of the viewscreen the moment "
            + "the ship jumps to warp or drops out. Off by default — the speed "
            + "ramp and the sounds already mark those beats.",
      }),
      sublightDrift: new f.BooleanField({
        initial: true,
        label: "Drift when not at warp",
        hint: "Keeps a slow starfield in the viewscreen while idle. Turn off for "
            + "a viewscreen that should be dark until the ship jumps.",
      }),
      aboveTokens: new f.BooleanField({
        initial: false,
        label: "Draw above tokens",
        hint: "Off by default, so crew standing in front of the viewscreen are "
            + "not painted over. Turn on for a window a token can pass behind.",
      }),
    };
  }

  /**
   * `behaviorViewed` fires per client when the behavior is active and its scene
   * is the one being looked at — precisely the renderer's attach signal.
   * `regionBoundary` covers the GM reshaping the region while it runs.
   */
  static events = {
    [CONST.REGION_EVENTS.BEHAVIOR_VIEWED]: function () {
      attachViewscreen(this);
      // A client arriving mid-warp gets the right starfield from `phaseAt`, but
      // it saw no phase update, so the loop has to be picked up here too. An
      // environment that persists at rest — a storm, a dead screen — is audible
      // whether or not the ship is going anywhere, so it starts unconditionally.
      if (isAtWarp(this.behavior) || _isRestAmbient(this.behavior)) {
        _startLoop(this.behavior);
      }
      // The hiss follows the field, not the phase, so it is picked up here for
      // exactly the same reason: a client arriving mid-scene saw no update.
      _syncInterferenceLoop(this.behavior);
    },
    [CONST.REGION_EVENTS.BEHAVIOR_UNVIEWED]: function () {
      detachViewscreen(this.behavior?.uuid);
      _stopLoop(this.behavior?.uuid);
    },
    [CONST.REGION_EVENTS.REGION_BOUNDARY]: function () {
      rebuildMask(this.behavior?.uuid);
    },
  };
}

// ── Finding viewscreens ──────────────────────────────────────────────────────

/**
 * Every warp-viewscreen behavior on the scene being viewed.
 *
 * Reads `canvas.scene.regions` only, matching how spawn-regions.js has always
 * enumerated regions — this module never reaches across scenes.
 */
export function listViewscreenBehaviors({ includeDisabled = true } = {}) {
  const out = [];
  try {
    const regions = canvas?.scene?.regions;
    if (!regions?.size) return out;
    for (const region of regions) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== VIEWSCREEN_TYPE) continue;
        if (!includeDisabled && behavior.disabled) continue;
        out.push(behavior);
      }
    }
  } catch (err) {
    console.warn("STA2e Toolkit | warp viewscreen: could not list behaviors:", err);
  }
  return out;
}

/** A readable name for one viewscreen, for the panel's target list. */
export function viewscreenLabel(behavior) {
  const regionName = behavior?.region?.name || "Unnamed Region";
  const own = behavior?.name;
  return own && own !== "Warp Viewscreen" ? `${regionName} — ${own}` : regionName;
}

// ── Driving the sequence ─────────────────────────────────────────────────────

/**
 * Write a new phase. This is the *only* thing that has to travel between
 * clients, and Foundry's own document replication carries it — see the header of
 * warp-viewscreen-vfx.js for why there is no socket here.
 */
export async function setViewscreenPhase(behavior, phase) {
  if (!behavior || !VIEWSCREEN_PHASES.includes(phase)) return;
  if (!game.user?.isGM) return;
  await behavior.update({ system: { phase, phaseAt: Date.now() } });
}

/** Jump to warp. */
export function enterWarp(behavior) {
  return setViewscreenPhase(behavior, "entering");
}

/** Drop out of warp. */
export function exitWarp(behavior) {
  return setViewscreenPhase(behavior, "exiting");
}

/**
 * The phase the viewscreen actually reads as right now, settling a finished ramp.
 *
 * The stored phase stays `entering` forever once the GM presses the button — the
 * renderer treats a finished ramp as cruise on its own, and so must anything that
 * labels a button.
 */
export function effectivePhase(behavior) {
  const s = behavior?.system ?? {};
  const phase = VIEWSCREEN_PHASES.includes(s.phase) ? s.phase : "idle";
  if (phase !== "entering" && phase !== "exiting") return phase;
  const at = Number(s.phaseAt);
  if (!Number.isFinite(at) || at <= 0) return phase === "entering" ? "cruise" : "idle";
  const timing  = getViewscreenTiming();
  const elapsed = Date.now() - at;
  const rampMs  = phase === "entering" ? timing.enterMs : timing.exitMs;
  if (elapsed < rampMs) return phase;
  return phase === "entering" ? "cruise" : "idle";
}

/** Is this viewscreen at warp or on its way there? */
export function isAtWarp(behavior) {
  const p = effectivePhase(behavior);
  return p === "entering" || p === "cruise";
}

// ── Sound ────────────────────────────────────────────────────────────────────
//
// Played locally on every client from the update hook, never broadcast. Each
// client already receives the document update, so broadcasting as well would
// double every cue.

/**
 * The looping beds, keyed `uuid|slot`.
 *
 * Two slots, because interference is an overlay rather than a mode: a viewscreen
 * breaking up while still at warp should hiss *over* the warp rumble, not
 * instead of it. Keying by uuid alone — as this did while Signal Loss was only
 * ever an environment of its own — meant starting one silently orphaned the
 * other, leaving a sound playing with no handle to stop it.
 */
const _loops = new Map();
const LOOP_ENV          = "env";
const LOOP_INTERFERENCE = "interference";

const _loopKey = (uuid, slot) => `${uuid}|${slot}`;

function _settingPath(key) {
  if (!key) return "";
  try {
    const v = game.settings.get(MODULE, key);
    return typeof v === "string" && v.trim() ? v.trim() : "";
  } catch {
    return "";
  }
}

/**
 * The audio file for one beat of one viewscreen, resolved through its
 * environment.
 *
 * Falls back to the plain warp keys when the environment's own slot is blank, so
 * a GM who has configured warp audio and nothing else still hears something in a
 * nebula rather than silence. Warp itself *names* those legacy keys, so this
 * costs it nothing.
 */
function _envSoundPath(behavior, beat) {
  const env = getEnvironment(viewscreenEnvironmentId(behavior));
  return _settingPath(env.sounds?.[beat])
      || _settingPath(getEnvironment(DEFAULT_ENVIRONMENT).sounds?.[beat]);
}

/**
 * Does this viewscreen's environment persist while the ship is at rest?
 *
 * The renderer asks the same question to decide whether it may go dark; the
 * sound layer asks it to decide whether dropping to idle should silence the
 * loop. A storm does not stop when the engines do.
 */
function _isRestAmbient(behavior) {
  return !!getEnvironment(viewscreenEnvironmentId(behavior)).restAmbient;
}

function _playLocal(src, { loop = false, volume = 0.7 } = {}) {
  if (!src) return null;
  try {
    const AudioHelper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    // `false` is the broadcast flag — this client only.
    return AudioHelper?.play({ src, volume, autoplay: true, loop }, false) ?? null;
  } catch (err) {
    console.warn("STA2e Toolkit | warp viewscreen: sound failed:", err);
    return null;
  }
}

async function _stopLoopSlot(uuid, slot) {
  const key = _loopKey(uuid, slot);
  const pending = _loops.get(key);
  if (!pending) return;
  _loops.delete(key);
  try {
    const sound = await pending;
    sound?.stop?.();
  } catch { /* the loop never started — nothing to stop */ }
}

/** Silence every bed on one viewscreen. */
function _stopLoop(uuid) {
  if (!uuid) return;
  _stopLoopSlot(uuid, LOOP_ENV);
  _stopLoopSlot(uuid, LOOP_INTERFERENCE);
}

/** Silence everything — canvas teardown only. */
function _stopAllLoops() {
  for (const key of [..._loops.keys()]) {
    const [uuid, slot] = key.split("|");
    _stopLoopSlot(uuid, slot);
  }
}

function _startLoopSlot(uuid, slot, src, volume) {
  _stopLoopSlot(uuid, slot);
  if (!src) return;
  const pending = _playLocal(src, { loop: true, volume });
  if (pending) _loops.set(_loopKey(uuid, slot), Promise.resolve(pending));
}

/** The environment's own ambience. */
function _startLoop(behavior) {
  const uuid = behavior?.uuid ?? behavior;
  if (!uuid) return;
  const src = typeof behavior === "object" ? _envSoundPath(behavior, "loop") : "";
  _startLoopSlot(uuid, LOOP_ENV, src, 0.45);
}

/**
 * The interference hiss, held for as long as the screen is broken up.
 *
 * Independent of the phase, unlike every other cue here: a screen does not stop
 * being broken because the ship dropped out of warp. It follows the Interference
 * field alone, and its volume tracks it, so easing the slider up reads as the
 * signal degrading rather than as a sound switching on.
 */
function _syncInterferenceLoop(behavior) {
  const uuid = behavior?.uuid;
  if (!uuid) return;
  const level = Number(behavior.system?.interference ?? 0) / 100;
  // The Signal Loss environment already carries this as its own ambience; a
  // second copy of the same hiss on top of it is just louder.
  const own = getEnvironment(viewscreenEnvironmentId(behavior)).grain;
  if (!(level > 0) || own) { _stopLoopSlot(uuid, LOOP_INTERFERENCE); return; }
  const src = _settingPath(getEnvironment("static").sounds.loop);
  _startLoopSlot(uuid, LOOP_INTERFERENCE, src, 0.12 + 0.33 * level);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Config or phase changed on the document.
 *
 * A phase change is the cue for the starburst and the sounds; anything else is a
 * look change the renderer can absorb in place. Only a change that moves the
 * behavior's *rendered* identity — being enabled, or its region — needs a full
 * re-attach, and core fires behaviorViewed/Unviewed for those itself.
 */
function _onBehaviorUpdate(behavior, changed) {
  if (behavior?.type !== VIEWSCREEN_TYPE) return;
  if (behavior.parent?.parent?.id !== canvas?.scene?.id) return;

  const changedSystem = changed?.system ?? {};

  if ("phase" in changedSystem) {
    const phase = changedSystem.phase;
    if (phase === "entering") {
      flashViewscreen(behavior);
      _playLocal(_envSoundPath(behavior, "enter"));
      _startLoop(behavior);
    } else if (phase === "exiting") {
      flashViewscreen(behavior);
      _playLocal(_envSoundPath(behavior, "exit"));
      // A persistent environment keeps its bed running under the drop-out cue;
      // only a viewscreen that is actually going quiet stops. The ENV slot
      // only — a broken screen does not un-break because the ship slowed down.
      if (!_isRestAmbient(behavior)) _stopLoopSlot(behavior.uuid, LOOP_ENV);
    } else if (phase === "idle") {
      if (!_isRestAmbient(behavior)) _stopLoopSlot(behavior.uuid, LOOP_ENV);
    }
  } else if ("environment" in changedSystem && isAtWarp(behavior)) {
    // Changing environment mid-flight produces no phase update, so nothing else
    // would swap the loop — a ship that flew from warp into a nebula would keep
    // the warp rumble running under the new picture.
    _startLoop(behavior);
  }

  // Independent of the phase, and re-checked on every update rather than only
  // when `interference` is in the diff: switching TO Signal Loss has to silence
  // the overlay hiss the previous environment was carrying.
  _syncInterferenceLoop(behavior);

  refreshViewscreen(behavior);
}

function _onBehaviorDelete(behavior) {
  if (behavior?.type !== VIEWSCREEN_TYPE) return;
  _stopLoop(behavior.uuid);
  detachViewscreen(behavior.uuid);
}

function _onCanvasReady() {
  // Nothing should survive a scene swap; core re-fires behaviorViewed for the
  // new scene's behaviors immediately after.
  sweepViewscreens();
  _stopAllLoops();
}

// ── The vanishing-point picker in the sheet ──────────────────────────────────

/** Same shape as region-pad-config.js `_buildFormGroup`. */
function _buildPickerRow() {
  const group = document.createElement("div");
  group.className = "form-group sta2e-viewscreen-pick";
  group.innerHTML = `
    <label>Vanishing Point <span style="opacity:0.6;font-size:0.85em;">(STA Toolkit)</span></label>
    <div class="form-fields">
      <button type="button" class="sta2e-viewscreen-pick-btn">
        <i class="fa-solid fa-crosshairs"></i> Set Vanishing Point
      </button>
      <button type="button" class="sta2e-viewscreen-pick-clear">
        <i class="fa-solid fa-xmark"></i> Centre
      </button>
    </div>
    <p class="hint">Click a point on the canvas for the stars to stream out of.
      It may sit outside the region — that is how you aim an angled window.</p>`;
  return group;
}

/**
 * Rays fanning out of the cursor, previewing the star flow. Drawn through
 * `stroked` so it works under both the PIXI v7 and v8 Graphics APIs.
 */
function _drawPickPreview(g, region, inbound) {
  const p = cursorPoint();
  const b = region?.object?.bounds ?? null;
  const reach = b
    ? Math.max(b.width, b.height) * 0.8
    : (canvas.dimensions?.size ?? 100) * 4;

  stroked(g, { width: 2, color: INDICATOR_COLOR, alpha: 0.8 }, gg => {
    for (let i = 0; i < 12; i++) {
      const a  = (i / 12) * Math.PI * 2;
      // Tails point back toward the vanishing point on a forward view, and away
      // from it on a rear view, so the preview reads as the actual direction.
      const t0 = inbound ? 1 : 0.28;
      const t1 = inbound ? 0.35 : 1;
      gg.moveTo(p.x + Math.cos(a) * reach * t0, p.y + Math.sin(a) * reach * t0);
      gg.lineTo(p.x + Math.cos(a) * reach * t1, p.y + Math.sin(a) * reach * t1);
    }
  });
  stroked(g, { width: 2, color: 0xffffff, alpha: 0.95 }, gg => crosshair(gg, p.x, p.y, 12));
}

/**
 * Click a vanishing point on the canvas. Resolves to the point, or null if the
 * GM right-clicked or pressed Escape.
 *
 * Shared by the behavior sheet and the GM panel — both need the same pick, and
 * the panel needs it without a sheet open.
 */
export async function pickVanishingPoint(region, { inbound = false } = {}) {
  if (!canvas?.ready) {
    ui.notifications.warn("The canvas is not ready — open the scene first.");
    return null;
  }
  const overlay = showOverlay(
    "VANISHING POINT",
    "Click where the stars stream from · [RMB/Esc] abort",
  );
  setCrosshairCursor(true);
  try {
    return await awaitCanvasClick({ onMove: g => _drawPickPreview(g, region, inbound) });
  } finally {
    setCrosshairCursor(false);
    overlay.remove();
  }
}

/**
 * Injected into the rendered behavior sheet.
 *
 * The picker writes straight into the `system.vanishX` / `system.vanishY` inputs
 * core already rendered, so ordinary form submission persists it — the same
 * native-form-path trick region-pad-config.js relies on, with no _updateObject
 * override needed.
 */
function _injectVanishingPointButton(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (doc?.type !== VIEWSCREEN_TYPE) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".sta2e-viewscreen-pick")) return;   // idempotency guard

  const xInput = root.querySelector('[name="system.vanishX"]');
  const yInput = root.querySelector('[name="system.vanishY"]');
  if (!xInput || !yInput) return;

  const row = _buildPickerRow();
  xInput.closest(".form-group")?.before(row);

  row.querySelector(".sta2e-viewscreen-pick-clear")?.addEventListener("click", () => {
    xInput.value = "";
    yInput.value = "";
  });

  row.querySelector(".sta2e-viewscreen-pick-btn")?.addEventListener("click", async () => {
    // The sheet sits over the canvas, so it has to get out of the way.
    try { await app.minimize?.(); } catch { /**/ }
    let point = null;
    try {
      point = await pickVanishingPoint(doc.region, {
        inbound: !!root.querySelector('[name="system.inbound"]')?.checked,
      });
    } finally {
      try { await app.maximize?.(); } catch { /**/ }
    }
    if (!point) return;
    xInput.value = Math.round(point.x);
    yInput.value = Math.round(point.y);
    ui.notifications.info("Vanishing point set — save the behavior to apply it.");
  });
}

// ── The backdrop-image library picker in the sheet ───────────────────────────

/** A readable name for one library entry — its label, else the file's basename. */
export function imageEntryLabel(entry) {
  const own = String(entry?.label ?? "").trim();
  if (own) return own;
  const src = String(entry?.src ?? "").trim();
  if (!src) return "Untitled";
  try {
    return decodeURIComponent(src.split("?")[0].split("/").pop() || "Untitled");
  } catch {
    return src.split("?")[0].split("/").pop() || "Untitled";
  }
}

/**
 * Write a value into one of core's own rendered inputs.
 *
 * Deliberately does *not* dispatch an event: this sheet does not submit on
 * change, and the values are picked up by ordinary form submission when the GM
 * saves. A `<file-picker>` is a custom element wrapping its own text input, so
 * both are written.
 */
function _setSheetValue(root, name, value) {
  const el = root.querySelector(`[name="${name}"]`);
  if (!el) return;
  if (el.type === "checkbox") { el.checked = !!value; return; }
  try { el.value = value ?? ""; } catch { /**/ }
  const inner = el.querySelector?.("input");
  if (inner && inner !== el) inner.value = value ?? "";
}

/**
 * Take the look-preset pointer off the sheet entirely.
 *
 * It is a world-library id owned by the panel, and core renders a bare
 * `StringField` as a text box — a random id in one is worse than nothing.
 * Removing the whole form group also removes it from the form, so ordinary
 * submission leaves the stored value untouched rather than blanking it, which is
 * exactly what is wanted: the sheet has no business repointing it.
 */
function _hideLookPresetField(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (doc?.type !== VIEWSCREEN_TYPE) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  root?.querySelector('[name="system.lookPreset"]')?.closest(".form-group")?.remove();
}

/**
 * Injected into the rendered behavior sheet.
 *
 * `activeImage` holds an entry id, which core renders as a bare text box — a
 * random id in a text field is useless to a GM, so it is swapped for a dropdown
 * carrying the same `name`. Picking one copies that entry's values into the
 * sibling `system.image*` inputs core already rendered and lets ordinary form
 * submission persist them, exactly as the vanishing-point button does. The
 * library itself is built from the panel; the sheet only picks and tunes.
 */
function _injectImageLibrarySelect(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (doc?.type !== VIEWSCREEN_TYPE) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".sta2e-viewscreen-images")) return;   // idempotency guard

  const current = root.querySelector('[name="system.activeImage"]');
  if (!current) return;

  const entries = Array.isArray(doc.system?.images) ? doc.system.images : [];
  const active  = String(doc.system?.activeImage ?? "");

  const sel = document.createElement("select");
  sel.name = "system.activeImage";
  sel.className = "sta2e-viewscreen-images";

  const none = document.createElement("option");
  none.value = "";
  none.textContent = entries.length ? "— Not from the library —" : "— None saved —";
  sel.appendChild(none);

  for (const entry of entries) {
    const opt = document.createElement("option");
    opt.value = String(entry?.id ?? "");
    // Entry labels are user data — never innerHTML.
    opt.textContent = imageEntryLabel(entry);
    sel.appendChild(opt);
  }
  sel.value = entries.some(e => String(e?.id) === active) ? active : "";

  current.replaceWith(sel);

  const group = sel.closest(".form-group");
  if (group && !group.querySelector(".sta2e-viewscreen-images-hint")) {
    const hint = document.createElement("p");
    hint.className = "hint sta2e-viewscreen-images-hint";
    hint.textContent = "Saved backdrops are added, renamed and removed from the "
                     + "Warp Viewscreen panel. Choosing one here fills in the "
                     + "image settings below; save the behavior to apply it.";
    group.appendChild(hint);
  }

  sel.addEventListener("change", () => {
    const entry = entries.find(e => String(e?.id) === sel.value);
    if (!entry) return;
    for (const [key, name] of Object.entries(IMAGE_ENTRY_FIELDS)) {
      // `??`, not `||` — an offset of 0 and `above: false` are real values, and
      // a key the entry never stored has to reset rather than stay sticky.
      _setSheetValue(root, `system.${name}`, entry[key] ?? IMAGE_ENTRY_DEFAULTS[key]);
    }
  });

  // Browsing a different file means this is no longer the saved backdrop the
  // select names, so the select goes back to "not from the library" — the same
  // rule the panel follows, and what keeps the two surfaces telling one story.
  // The library array is not in this form, so the entry itself is never touched.
  const srcInput = root.querySelector('[name="system.imageSrc"]');
  srcInput?.addEventListener("change", () => { sel.value = ""; });
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerWarpViewscreenBehavior() {
  CONFIG.RegionBehavior.dataModels[VIEWSCREEN_TYPE] = WarpViewscreenBehaviorType;
  CONFIG.RegionBehavior.typeLabels[VIEWSCREEN_TYPE] = TYPE_LABEL_KEY;
  CONFIG.RegionBehavior.typeHints[VIEWSCREEN_TYPE]  = TYPE_HINT_KEY;
  CONFIG.RegionBehavior.typeIcons[VIEWSCREEN_TYPE]  = "fa-solid fa-meteor";

  // If the manifest declaration did not take, the type is missing from
  // game.model and no amount of CONFIG registration will list it — say so rather
  // than leaving a silently absent dropdown entry. Wrapped because this runs
  // inside the init chain, where a throw would take the rest of the module down.
  try {
    const types = getDocumentClass("RegionBehavior")?.TYPES ?? [];
    if (!types.includes(VIEWSCREEN_TYPE)) {
      console.warn(
        `STA2e Toolkit | "${VIEWSCREEN_TYPE}" is not in game.model.RegionBehavior — `
        + "the Warp Viewscreen behavior will not appear in the Add Behavior list. "
        + "Check that module.json declares documentTypes.RegionBehavior.warpViewscreen, "
        + "then fully restart the world — a browser reload does not re-read the manifest.",
      );
    }
  } catch { /* diagnostic only — never block init */ }

  Hooks.on("renderRegionBehaviorConfig", _injectVanishingPointButton);
  Hooks.on("renderRegionBehaviorConfig", _injectImageLibrarySelect);
  Hooks.on("renderRegionBehaviorConfig", _hideLookPresetField);
  Hooks.on("updateRegionBehavior", _onBehaviorUpdate);
  Hooks.on("deleteRegionBehavior", _onBehaviorDelete);
  Hooks.on("canvasReady", _onCanvasReady);
}
