/**
 * sta2e-toolkit | viewscreen-environments.js
 * What the ship is flying *through*.
 *
 * Both star renderers used to draw exactly one thing. The
 * [warp viewscreen](warp-viewscreen-vfx.js) drew a warp starfield clipped to a
 * Region; [scene warp](scene-warp-vfx.js) drew top-down warp streaks across the
 * tactical map. Neither carried any notion of the medium.
 *
 * The observation this file rests on is that **the cameras were already
 * environment-agnostic**. A particle at `(x, y, z)` marching toward the near
 * plane and projecting to `vp + (x/z, y/z) * FOCAL` describes flying through a
 * cloud bank or a rock field exactly as well as it describes warp; scene warp's
 * parallel depth bands are the same story from a different angle. What actually
 * differs between environments is the *material*: which texture, whether it
 * smears, whether it grows as it approaches, whether it tumbles, what blend
 * mode, how many. That is what this table holds.
 *
 * ## The rules this table lives by
 *
 * 1. **It imports nothing, and must not start.** Two things depend on that: the
 *    panels read labels without pulling PIXI into a DOM module, and
 *    [scene-warp.js](scene-warp.js) can carry an environment id while staying
 *    the leaf that the weapon-firing path needs it to be. Textures are named by
 *    **string key** here; each renderer owns its own key-to-builder switch.
 *
 * 2. **Every particle number is a MULTIPLIER over the renderer's own tuned
 *    constant, never an absolute.** The viewscreen's `WARP_STRETCH` is 8 and
 *    scene warp's is 6.5, and the difference is deliberate — a top-down field is
 *    seen broadside, where the same multiplier gives visibly longer lines than
 *    head-on. A descriptor handing out an absolute would flatten that back out.
 *    `stretchMul: 1` means "whatever this surface already decided".
 *
 * 3. **`warp` is the identity element.** Every multiplier on it is 1 and its
 *    `defaults` are the schema initials that were already there, so a viewscreen
 *    or scene that has never heard of environments renders exactly as it did
 *    before this file existed. If `warp` ever stops being pixel-identical that
 *    is a bug in this table, not a matter of taste.
 *
 * 4. **Adding an environment is meant to be a one-file change.** `settings.js`
 *    and `effect-config.js` both generate their sound keys and their rows by
 *    walking `ENVIRONMENT_ORDER`, so a new entry here brings its own audio
 *    configuration with it.
 */

/**
 * The particle material for an environment that adds a pool of its own.
 *
 * `null` on an environment that draws no second pool: `warp` (stars only) and
 * `static` (no particles at all).
 *
 * @typedef {object} ParticleSpec
 * @property {"streak"|"cloud"|"rock"|"mote"} texture Key into the renderer's builder switch.
 * @property {"add"|"normal"} blend  Rocks are lit, not glowing, so they take `normal`.
 * @property {number} stretchMul  Multiplies the surface's own warp stretch. 0 never smears.
 * @property {number} growMul     How much apparent size follows 1/z. 0 is a star, 1 full perspective.
 * @property {number} sizeMin     Base size in px at the far plane, before `growMul`.
 * @property {number} sizeMax     Base size in px at the near plane.
 * @property {number} tumbleDeg   Peak spin in degrees per second. 0 for anything that must not rotate.
 * @property {number} alphaFar    Opacity at the far plane.
 * @property {number} alphaNear   Opacity at the near plane.
 * @property {number} glow        `outerStrength` for this layer's GlowFilter. 0 builds no filter.
 * @property {number} countMul    Scales the surface's density setting into this pool's size.
 * @property {number} [speedMul]  Travel speed relative to the starfield, default 1.
 *                                Below 1 the pool lives proportionally longer, which is the
 *                                only lever on longevity: a particle's whole life is one
 *                                traversal, so halving the speed doubles the time on screen.
 * @property {number} [aspect]    Peak per-particle eccentricity, default 1 (circular). Rolled
 *                                once at seed and area-preserving, so a pool of these does not
 *                                read as a set of identical discs.
 * @property {number} [churn]     Internal billow, default 0. Amplitude of a slow per-particle
 *                                wobble on alpha and one scale axis. Viewscreen only — see the
 *                                note in scene-warp-vfx.js on why that surface stays seed-only.
 *
 * **`stretchMul` and `tumbleDeg` are mutually exclusive.** A sprite has one
 * rotation and the two want it for different things: a smear has to point along
 * the direction of travel, while a tumble is a spin about the particle's own
 * centre. Both renderers branch on `stretchMul > 0` and honour exactly one of
 * them, so an entry setting both would silently lose its tumble.
 *
 * ## Tunnels
 *
 * Everything above describes a *volume* you fly through: particles seeded in a
 * box around the line of travel. A transwarp conduit, a slipstream or a wormhole
 * is not a volume — it is a **wall wrapped round the axis**, with a hole down the
 * middle you are looking into.
 *
 * **The camera does not change for that.** Seed `(x, y)` on a ring instead of in
 * a box and the same z-march projects it as a tunnel: with the ring radius fixed
 * and z falling, the projected radius `r * FOCAL / z` grows, so the wall rushes
 * outward past the viewer and the untouched centre is the tunnel. The smear,
 * recycle, depth fade, palette and pooling all carry over untouched — and the
 * smear happens to run along the direction of travel, which for a ring *is* the
 * radial direction, so wall striations fall out with no extra code.
 *
 * @property {"box"|"tube"} [shape] Seeding shape, default `"box"`. **The default is
 *                                load-bearing**: every environment that predates
 *                                tunnels omits it and is untouched.
 * @property {number} [radius]    Tube radius, as a fraction of the seed spread.
 * @property {number} [wall]      Radial jitter as a fraction of radius — wall thickness.
 * @property {number} [flare]     How much the tube widens toward the viewer. 0 is a cylinder.
 * @property {number} [swirl]     Degrees per second the wall rolls about the axis. Applied to
 *                                the whole pool's CONTAINER, never per sprite — the sprite's
 *                                one rotation is already claimed by the smear, and a container
 *                                rotation is both free and correct (a child at local P with
 *                                rotation angle(P̂) maps to world angle(R·P̂), so every streak
 *                                stays radially aligned as the wall turns).
 * @property {object} [core]      `{ size, alpha, pulseMs }` — the light at the end, pinned to
 *                                the vanishing point, or null for an open-ended tunnel.
 */

/**
 * @typedef {object} TravelEnvironment
 * @property {string} id
 * @property {string} label
 * @property {string} hint
 * @property {string} icon             Font Awesome class for the panel picker.
 * @property {string[]} surfaces       "viewscreen" and/or "scene".
 * @property {ParticleSpec|null} particle
 * @property {object} labels           Per-field relabelling for the panels and the sheet.
 * @property {object} defaults         Applied wholesale when the GM picks this environment.
 * @property {object|null} haze        Soft coloured blobs behind the flow.
 * @property {object|null} wash        Ambient colour over the whole region.
 * @property {object|null} strobe      Lightning bursts, and the shake they kick.
 * @property {object|null} grain       Procedural static.
 * @property {boolean} restAmbient     Keeps running at ramp 0 even with drift off.
 * @property {object} sounds           Setting keys, in full rather than as suffixes.
 */

/**
 * The static that the `static` environment is made of, and that the
 * **Interference** field lays over any other environment.
 *
 * Named here rather than written inline on `static` because it is used twice and
 * the two must not drift: a viewscreen at warp with the interference slider at
 * 100% should look like the same broken screen as one set to Signal Loss, only
 * with warp still visible underneath.
 *
 * `rollRate` is the rolling tear travelling down the screen, in screen heights
 * per second. It is what makes this read as a broken signal rather than as noise
 * laid over a picture.
 */
export const INTERFERENCE_GRAIN = Object.freeze({
  alpha: 0.55, fps: 18, scanlines: true, rollRate: 0.12,
});

/**
 * The electrical discharge the ion storm is built on, and that the **Lightning**
 * field switches on over any other environment — an ionized nebula, a charged
 * debris field, a storm front seen from inside plain warp.
 *
 * Named here for the same reason as `INTERFERENCE_GRAIN`: it is used twice and
 * the two must not drift. Lightning in a nebula with the field at 100% should be
 * exactly the storm's lightning, over a nebula.
 *
 * The strike takes its colour from the environment's accent, so this carries no
 * hue of its own — violet lightning in a violet nebula falls out for free.
 */
export const IONIZED_STROBE = Object.freeze({
  minMs: 700, maxMs: 3200, alpha: 0.9, scale: 1.4, shakePx: 9,
  bolt: Object.freeze({
    min: 1, max: 2,        // bolts per strike
    segments: 11,          // vertices along the run; more is not more visible
    jitter: 0.13,          // lateral displacement, as a fraction of bolt length
    forks: 3, forkChance: 0.55,
    width: 2.2,            // bright core, in px
    glowWidth: 8,          // soft outer pass under it
    lifeMs: 260,
    flickers: 4,           // blinks across the life, on top of the fade
  }),
});

/** Every field a `defaults` block may carry, so a switch never leaves a stale value behind. */
export const ENVIRONMENT_DEFAULT_KEYS = Object.freeze([
  "density", "starTint", "accentTint", "variety", "streakMul", "thickness",
  "backdrop", "backdropAlpha", "spread", "intensity", "starMix", "nebula",
]);

export const TRAVEL_ENVIRONMENTS = Object.freeze({

  // -- Warp -------------------------------------------------------------------
  // The identity element. Every multiplier 1, no second pool, and a haze block
  // that reproduces the old single static sprite exactly: one blob at 0.2 alpha,
  // 1.7x the long edge, offset 30% away from the vanishing point, never moving.
  warp: {
    id: "warp",
    label: "Warp",
    hint: "Stars streaking past at warp. The classic view.",
    icon: "fas fa-rocket",
    surfaces: ["viewscreen", "scene"],
    particle: null,
    labels: {},
    defaults: {
      density: 600, starTint: "#cfe6ff", accentTint: "#a855f7", variety: 45,
      streakMul: 100, thickness: 100, backdrop: "#05030c", backdropAlpha: 85,
      spread: 30, intensity: 100, starMix: 100, nebula: true,
    },
    // count 1 with driftRate 0 is what makes this the old `_syncNebula` sprite.
    //
    // `surfaces` is here and nowhere else, and it is load-bearing: this blob is
    // the *viewscreen's* legacy haze, reproduced exactly. The top-down field
    // never had one, so drawing it there would put a lilac smear over every map
    // that has only ever asked for plain warp. Every other environment omits the
    // key and gets its haze on both surfaces, which is what you want — a nebula
    // is hazy from any angle.
    haze: { count: 1, alpha: 0.2, scale: 1.7, offset: 0.3, driftRate: 0, surfaces: ["viewscreen"] },
    wash: null,
    strobe: null,
    grain: null,
    restAmbient: false,
    // The keys that already existed, so nobody's configured audio breaks.
    sounds: {
      enter: "sndWarpViewscreenEnter",
      exit:  "sndWarpViewscreenExit",
      loop:  "sndWarpViewscreenLoop",
    },
  },

  // -- Nebula -----------------------------------------------------------------
  // Gas rushing past. The clouds are the whole look: they take the tumble rather
  // than the smear (gas has no direction of travel to point along) and grow hard
  // as they approach, which is what sells being *inside* something rather than
  // watching it go by. Star mix drops to 55 so the field reads as thinned by it.
  nebula: {
    id: "nebula",
    label: "Nebula",
    hint: "Flying through a gas cloud. Glowing banks rush past and the stars dim behind them.",
    icon: "fas fa-cloud",
    surfaces: ["viewscreen", "scene"],
    particle: {
      texture: "cloud", blend: "add",
      stretchMul: 0, growMul: 1,
      sizeMin: 60, sizeMax: 460,
      // Barely turning. At 8 deg/s a textured sprite reads unmistakably as a
      // spinning disc — gas does not rotate as a rigid body, and the eye knows
      // it. This is slow enough to register as drift rather than rotation.
      tumbleDeg: 1.8,
      // A third of the star speed, so a bank takes about three times as long to
      // cross. A cloud you are *inside* should linger; at parity with the stars
      // they flicked past and never read as volume at all.
      speedMul: 0.34,
      aspect: 1.45,
      churn: 0.14,
      alphaFar: 0.12, alphaNear: 1.0,
      glow: 0.5,
      // 600 stars becomes ~110 clouds. Fill rate, not sprite count, is what a
      // big additive sprite costs, so this stays low.
      countMul: 0.16,
    },
    labels: {
      density: "Cloud Density", streakMul: "Star Streak", thickness: "Star Thickness",
      accentTint: "Gas Colour", variety: "Gas Variety", spread: "Cloud Spread",
      intensity: "Gas Density",
    },
    defaults: {
      density: 420, starTint: "#cfe6ff", accentTint: "#c084fc", variety: 55,
      streakMul: 60, thickness: 100, backdrop: "#0a0413", backdropAlpha: 90,
      spread: 45, intensity: 100, starMix: 55, nebula: true,
    },
    haze: { count: 5, alpha: 0.14, scale: 0.60, offset: 0.34, driftRate: 0.35 },
    wash: { alpha: 0.12, pulseMs: 7000 },
    strobe: null,
    grain: null,
    restAmbient: false,
    sounds: {
      enter: "sndViewscreenNebulaEnter",
      exit:  "sndViewscreenNebulaExit",
      loop:  "sndViewscreenNebulaLoop",
    },
  },

  // -- Ion storm --------------------------------------------------------------
  // The eventful one: torn storm cells with lightning striking inside them, plus
  // the shake that lightning kicks. `restAmbient` because a storm does not stop
  // crackling when the ship does.
  //
  // It drew a field of small fast motes first, and that was wrong — a scatter of
  // discrete dots reads as confetti rather than as weather, and it left the bolts
  // flashing over nothing. Cells give the lightning something to be inside, and
  // the storm's violence then shows as churn and contrast rather than as count.
  ionStorm: {
    id: "ionStorm",
    label: "Ion Storm",
    hint: "Charged cloud and lightning. The viewscreen flares and shakes, and keeps going while stopped.",
    icon: "fas fa-bolt",
    surfaces: ["viewscreen", "scene"],
    particle: {
      texture: "stormCloud", blend: "add",
      // Tumble, not smear — the two are mutually exclusive, and a cell has no
      // direction of travel to point along. Still barely turning, for the same
      // reason as the nebula: a storm is agitated, and that has to show as churn
      // and contrast rather than as a sprite visibly spinning.
      stretchMul: 0, growMul: 1,
      sizeMin: 50, sizeMax: 400,
      tumbleDeg: 3.2,
      speedMul: 0.5,
      aspect: 1.6,
      churn: 0.22,
      alphaFar: 0.10, alphaNear: 0.95,
      // Lower than the motes' 1.2. A big additive sprite under a strong glow
      // blooms into a flat wash and loses the structure the texture just bought.
      glow: 0.8,
      countMul: 0.21,
    },
    labels: {
      density: "Cell Density", streakMul: "Star Streak", thickness: "Star Thickness",
      accentTint: "Charge Colour", variety: "Charge Variety", spread: "Cell Spread",
      intensity: "Storm Violence",
    },
    defaults: {
      density: 520, starTint: "#d8f2ff", accentTint: "#7cffb2", variety: 60,
      streakMul: 110, thickness: 110, backdrop: "#04080a", backdropAlpha: 88,
      spread: 40, intensity: 100, starMix: 70, nebula: true,
    },
    haze: { count: 3, alpha: 0.12, scale: 0.55, offset: 0.28, driftRate: 1.1 },
    wash: { alpha: 0.14, pulseMs: 2600 },
    // A strike is two things: a soft discharge glow and the bolt itself, drawn
    // through the same point so the two agree. Shared with the Lightning field —
    // see IONIZED_STROBE. `bolt` is optional there: an environment wanting only
    // the flash omits it, which is how this started before bolts existed.
    strobe: IONIZED_STROBE,
    grain: null,
    restAmbient: true,
    sounds: {
      enter: "sndViewscreenIonStormEnter",
      exit:  "sndViewscreenIonStormExit",
      loop:  "sndViewscreenIonStormLoop",
    },
  },

  // -- Asteroid field ---------------------------------------------------------
  // The one that draws on `normal` blend and takes no glow: rocks are lit, not
  // luminous, and an additive rock is a smear of light. Sparse and large, with
  // the starfield left at full strength behind it so the motion reads.
  asteroid: {
    id: "asteroid",
    label: "Asteroid Field",
    hint: "Tumbling rock and debris passing the screen, with stars visible behind.",
    icon: "fas fa-meteor",
    surfaces: ["viewscreen", "scene"],
    particle: {
      texture: "rock", blend: "normal",
      // Rock does not smear at any speed. A motion-blurred boulder reads as a
      // smudge rather than as speed.
      stretchMul: 0, growMul: 1,
      sizeMin: 10, sizeMax: 190,
      tumbleDeg: 45,
      alphaFar: 0.35, alphaNear: 1,
      glow: 0,
      countMul: 0.1,
    },
    labels: {
      density: "Rock Count", streakMul: "Star Streak", accentTint: "Rock Colour",
      variety: "Rock Variety", spread: "Field Spread", intensity: "Debris Density",
    },
    defaults: {
      density: 500, starTint: "#cfe6ff", accentTint: "#a88b6a", variety: 25,
      streakMul: 100, thickness: 100, backdrop: "#04040a", backdropAlpha: 92,
      spread: 60, intensity: 100, starMix: 100, nebula: true,
    },
    haze: { count: 2, alpha: 0.08, scale: 0.60, offset: 0.3, driftRate: 0.2 },
    wash: null,
    strobe: null,
    grain: null,
    restAmbient: false,
    sounds: {
      enter: "sndViewscreenAsteroidEnter",
      exit:  "sndViewscreenAsteroidExit",
      loop:  "sndViewscreenAsteroidLoop",
    },
  },

  // -- Transwarp conduit ------------------------------------------------------
  // The first of four TUNNELS (see the note on `shape` above). All four are
  // viewscreen-only — a vortex is something you look *down*, and the top-down
  // camera has no way to show that — and all four run `starMix: 0` with drift
  // off: there is no starfield inside a conduit, and an idle one is dark because
  // the ship is not in it yet.
  //
  // The Borg look: tight, fast, hard roll, the wall drawn as fine striations.
  transwarpConduit: {
    id: "transwarpConduit",
    label: "Transwarp Conduit",
    hint: "A tight green-white tunnel at enormous speed, its wall striated and rolling hard.",
    icon: "fas fa-circle-notch",
    surfaces: ["viewscreen"],
    particle: {
      texture: "wisp", blend: "add",
      shape: "tube", radius: 0.78, wall: 0.62, flare: 0.40, swirl: 22,
      core: { size: 0.22, alpha: 0.85, pulseMs: 2000 },
      // `size` is the plume's cross-section and the smear is its length. Broad
      // and long, where the first version was a hairline and read as wire.
      stretchMul: 2.4, growMul: 1,
      sizeMin: 14, sizeMax: 72,
      tumbleDeg: 0,
      alphaFar: 0.07, alphaNear: 0.50,
      glow: 1.0,
      // density x countMul must stay under ENV_POOL_MAX (400) or the cap eats
      // the GM's Wall Density slider along with any retuning here.
      countMul: 0.42,
    },
    labels: {
      density: "Wall Density", streakMul: "Striation Length",
      thickness: "Striation Weight", accentTint: "Conduit Colour",
      variety: "Colour Variety", spread: "Tunnel Width",
      intensity: "Conduit Turbulence",
    },
    defaults: {
      density: 760, starTint: "#dfffe8", accentTint: "#56ff9e", variety: 40,
      streakMul: 200, thickness: 100, backdrop: "#010806", backdropAlpha: 96,
      spread: 55, intensity: 100, starMix: 0, nebula: true,
    },
    haze: { count: 4, alpha: 0.16, scale: 0.55, offset: 0.20, driftRate: 0.9 },
    wash: { alpha: 0.10, pulseMs: 3400 },
    strobe: null,
    grain: null,
    restAmbient: false,
    sounds: {
      enter: "sndViewscreenTranswarpEnter",
      exit:  "sndViewscreenTranswarpExit",
      loop:  "sndViewscreenTranswarpLoop",
    },
  },

  // -- Quantum slipstream -----------------------------------------------------
  // The fastest of the four and the narrowest: barely any roll, almost no flare,
  // and streaks stretched hard enough that the wall reads as one continuous
  // sheet. Less like flying and more like being fired down a beam.
  slipstream: {
    id: "slipstream",
    label: "Quantum Slipstream",
    hint: "A narrow blue-white corridor at extreme speed, the wall drawn out into a continuous sheet.",
    icon: "fas fa-bolt-lightning",
    surfaces: ["viewscreen"],
    particle: {
      texture: "wisp", blend: "add",
      shape: "tube", radius: 0.68, wall: 0.48, flare: 0.24, swirl: 10,
      core: { size: 0.18, alpha: 1.0, pulseMs: 1400 },
      stretchMul: 3.2, growMul: 1,
      sizeMin: 10, sizeMax: 54,
      tumbleDeg: 0,
      alphaFar: 0.08, alphaNear: 0.52,
      glow: 1.3,
      countMul: 0.44,
    },
    labels: {
      density: "Wall Density", streakMul: "Streak Length",
      thickness: "Streak Weight", accentTint: "Slipstream Colour",
      variety: "Colour Variety", spread: "Corridor Width",
      intensity: "Stream Energy",
    },
    defaults: {
      density: 800, starTint: "#eaf6ff", accentTint: "#4fb8ff", variety: 35,
      streakMul: 260, thickness: 100, backdrop: "#01060e", backdropAlpha: 96,
      spread: 45, intensity: 100, starMix: 0, nebula: true,
    },
    haze: { count: 4, alpha: 0.14, scale: 0.48, offset: 0.18, driftRate: 1.2 },
    wash: { alpha: 0.12, pulseMs: 1800 },
    strobe: null,
    grain: null,
    restAmbient: false,
    sounds: {
      enter: "sndViewscreenSlipstreamEnter",
      exit:  "sndViewscreenSlipstreamExit",
      loop:  "sndViewscreenSlipstreamLoop",
    },
  },

  // -- Wormhole ---------------------------------------------------------------
  // The odd one out: the only tunnel whose wall BILLOWS rather than streaks, so
  // it takes the tumble branch and the cloud texture. Wide, slow, and strongly
  // flared, so the mouth opens out around the viewer rather than running past as
  // a corridor. Slower than warp on purpose — a wormhole is a place, not a road.
  wormhole: {
    id: "wormhole",
    label: "Wormhole Transit",
    hint: "A wide, slow, flowering tunnel of blue-violet cloud, opening out around the ship.",
    icon: "fas fa-hurricane",
    surfaces: ["viewscreen"],
    particle: {
      texture: "cloud", blend: "add",
      shape: "tube", radius: 0.95, wall: 0.45, flare: 1.10, swirl: 7,
      core: { size: 0.34, alpha: 0.70, pulseMs: 3200 },
      // Tumble, not smear: cloud has no direction of travel to point along, and
      // the two are mutually exclusive. The roll comes from `swirl` instead.
      stretchMul: 0, growMul: 1,
      sizeMin: 60, sizeMax: 480,
      tumbleDeg: 4,
      speedMul: 0.55,
      aspect: 1.5, churn: 0.18,
      alphaFar: 0.14, alphaNear: 1.0,
      glow: 0.6,
      countMul: 0.26,
    },
    labels: {
      density: "Cloud Density", streakMul: "Cloud Smear",
      thickness: "Cloud Weight", accentTint: "Aperture Colour",
      variety: "Colour Variety", spread: "Mouth Width",
      intensity: "Aperture Energy",
    },
    defaults: {
      density: 520, starTint: "#dceeff", accentTint: "#7ea8ff", variety: 55,
      streakMul: 80, thickness: 100, backdrop: "#030616", backdropAlpha: 94,
      spread: 65, intensity: 100, starMix: 0, nebula: false,
    },
    haze: null,
    wash: { alpha: 0.14, pulseMs: 4200 },
    strobe: null,
    grain: null,
    restAmbient: false,
    sounds: {
      enter: "sndViewscreenWormholeEnter",
      exit:  "sndViewscreenWormholeExit",
      loop:  "sndViewscreenWormholeLoop",
    },
  },

  // -- Subspace vortex --------------------------------------------------------
  // The unnamed one, for a spatial anomaly or a conduit the setting has not
  // christened. Soft glowing motes rather than hard striations, so it reads as
  // energy rather than as machinery — and it is the first user of the `mote`
  // texture, which the ion storm gave up when it became cells.
  subspaceVortex: {
    id: "subspaceVortex",
    label: "Subspace Vortex",
    hint: "A neutral glowing vortex, for an anomaly or any transit the setting has not named. Recolour it freely.",
    icon: "fas fa-tornado",
    surfaces: ["viewscreen"],
    particle: {
      texture: "mote", blend: "add",
      shape: "tube", radius: 0.82, wall: 0.30, flare: 0.50, swirl: 16,
      core: { size: 0.26, alpha: 0.80, pulseMs: 2600 },
      stretchMul: 1.8, growMul: 1,
      sizeMin: 6, sizeMax: 26,
      tumbleDeg: 0,
      alphaFar: 0.14, alphaNear: 1.0,
      glow: 1.0,
      countMul: 0.63,
    },
    labels: {
      density: "Wall Density", streakMul: "Trail Length",
      thickness: "Mote Size", accentTint: "Vortex Colour",
      variety: "Colour Variety", spread: "Vortex Width",
      intensity: "Vortex Energy",
    },
    defaults: {
      density: 560, starTint: "#f0e8ff", accentTint: "#b98cff", variety: 50,
      streakMul: 180, thickness: 100, backdrop: "#05030c", backdropAlpha: 94,
      spread: 55, intensity: 100, starMix: 0, nebula: false,
    },
    haze: null,
    wash: { alpha: 0.11, pulseMs: 3000 },
    strobe: null,
    grain: null,
    restAmbient: false,
    sounds: {
      enter: "sndViewscreenVortexEnter",
      exit:  "sndViewscreenVortexExit",
      loop:  "sndViewscreenVortexLoop",
    },
  },

  // -- Static -----------------------------------------------------------------
  // Not a place but a screen state, for a viewscreen that is dead, jammed or
  // taking a hit. Viewscreen only: TV static on a top-down tactical map means
  // nothing. No particles at all, and `starMix: 0` so the field underneath is
  // genuinely off rather than faintly showing through.
  static: {
    id: "static",
    label: "Static / Signal Loss",
    hint: "Interference. The viewscreen loses its picture, whether or not the ship is moving.",
    icon: "fas fa-tower-broadcast",
    surfaces: ["viewscreen"],
    particle: null,
    labels: {
      density: "Star Count (hidden)", intensity: "Interference",
      accentTint: "Interference Colour",
    },
    defaults: {
      density: 60, starTint: "#cfe6ff", accentTint: "#8899aa", variety: 0,
      streakMul: 100, thickness: 100, backdrop: "#060606", backdropAlpha: 100,
      spread: 30, intensity: 100, starMix: 0, nebula: false,
    },
    haze: null,
    wash: { alpha: 0.06, pulseMs: 0 },
    strobe: null,
    // The same static the Interference field lays over everything else — see
    // INTERFERENCE_GRAIN. Picking this environment is the extreme of that
    // slider: nothing underneath but a dark screen.
    grain: INTERFERENCE_GRAIN,
    restAmbient: true,
    sounds: {
      enter: "sndViewscreenStaticEnter",
      exit:  "sndViewscreenStaticExit",
      loop:  "sndViewscreenStaticLoop",
    },
  },
});

/** Picker order. Warp first because it is the default and the way back. */
export const ENVIRONMENT_ORDER = Object.freeze([
  // Volumes first, then the four tunnels, then the screen state. Warp leads
  // because it is the default and the way back from anything else.
  "warp", "nebula", "ionStorm", "asteroid",
  "transwarpConduit", "slipstream", "wormhole", "subspaceVortex",
  "static",
]);

/** The id anything unrecognised falls back to. */
export const DEFAULT_ENVIRONMENT = "warp";

/**
 * A descriptor by id, always resolving to something renderable.
 *
 * Never returns null: a scene carrying an id from a future version, or a typo
 * hand-edited into a behavior sheet, has to keep drawing rather than throw from
 * inside a ticker.
 */
export function getEnvironment(id) {
  return TRAVEL_ENVIRONMENTS[id] ?? TRAVEL_ENVIRONMENTS[DEFAULT_ENVIRONMENT];
}

/** Is this a real environment id? */
export function isEnvironmentId(id) {
  return Object.prototype.hasOwnProperty.call(TRAVEL_ENVIRONMENTS, id);
}

/** The environments one surface can draw, in picker order. */
export function environmentsForSurface(surface) {
  return ENVIRONMENT_ORDER
    .map(id => TRAVEL_ENVIRONMENTS[id])
    .filter(env => env.surfaces.includes(surface));
}

/**
 * `{ id: label }` for a `StringField`'s `choices`, or for a panel select.
 *
 * Pass a surface to narrow it — the behavior sheet wants viewscreen only.
 */
export function environmentChoices(surface = null) {
  const list = surface
    ? environmentsForSurface(surface)
    : ENVIRONMENT_ORDER.map(getEnvironment);
  const out = {};
  for (const env of list) out[env.id] = env.label;
  return out;
}

/**
 * What this environment calls one of the shared look fields.
 *
 * The thirteen look fields are reused across every environment rather than
 * duplicated per environment — that is what keeps the schema and both panels
 * from tripling in size — so "Star Count" has to read "Cloud Density" under a
 * nebula and "Rock Count" in an asteroid field.
 */
export function environmentFieldLabel(envOrId, field, fallback) {
  const env = typeof envOrId === "string" ? getEnvironment(envOrId) : envOrId;
  return env?.labels?.[field] ?? fallback;
}

/**
 * The look values to write alongside a change of environment.
 *
 * A fresh object every call: callers spread it into a document update, and a
 * shared reference would be one accidental mutation away from rewriting the
 * table.
 */
export function environmentDefaults(id) {
  return { ...getEnvironment(id).defaults };
}

/**
 * The static this viewscreen should draw, and how strongly, or null for none.
 *
 * Two sources, and the environment's own always wins: the `static` environment
 * *is* signal loss and drives its grain from Intensity like everything else it
 * owns, while every other environment can have interference laid over it by the
 * separate `interference` field. Returning one resolved `{ spec, strength }`
 * rather than making the renderer branch is what keeps the two from drifting —
 * and it means the Interference field is simply ignored, not compounded, when
 * the environment is already Signal Loss.
 *
 * @param {number} interference 0..1, the behavior's Interference field.
 */
export function environmentGrain(envOrId, interference = 0, intensity = 1) {
  const env = typeof envOrId === "string" ? getEnvironment(envOrId) : envOrId;
  if (env?.grain) return { spec: env.grain, strength: intensity };
  if (interference > 0) return { spec: INTERFERENCE_GRAIN, strength: interference };
  return null;
}

/**
 * The lightning this viewscreen should throw, and how hard, or null for none.
 *
 * Exactly the shape of `environmentGrain`, and for the same reasons. The ion
 * storm owns its discharge and drives it from Intensity like everything else it
 * owns; every other environment can have the same lightning switched on by the
 * separate `lightning` field — an ionized nebula, a charged debris field.
 *
 * The environment's own always wins, so the field is *ignored* rather than
 * compounded on a storm, and the panel hides it there.
 *
 * `strength` scales the flash alpha, the shake and the strike rate together, so
 * one control means one idea rather than three loosely-related ones.
 *
 * @param {number} lightning 0..1, the behavior's Lightning field.
 */
export function environmentStrobe(envOrId, lightning = 0, intensity = 1) {
  const env = typeof envOrId === "string" ? getEnvironment(envOrId) : envOrId;
  if (env?.strobe) return { spec: env.strobe, strength: intensity };
  if (lightning > 0) return { spec: IONIZED_STROBE, strength: lightning };
  return null;
}

/**
 * This environment's haze spec for one surface, or null.
 *
 * Only `warp` narrows its haze, and only to the viewscreen — see the note on
 * that entry. Everything else omits `surfaces` and is drawn wherever it runs.
 */
export function environmentHaze(envOrId, surface) {
  const env  = typeof envOrId === "string" ? getEnvironment(envOrId) : envOrId;
  const haze = env?.haze;
  if (!haze) return null;
  if (haze.surfaces && !haze.surfaces.includes(surface)) return null;
  return haze;
}

/**
 * Every sound setting key the table names.
 *
 * `settings.js` registers these and `effect-config.js` builds a row per entry,
 * which is what makes adding an environment a one-file change. Warp's three keys
 * predate the table and are flagged `legacy` so neither caller registers or
 * re-lists what already exists.
 */
export function environmentSoundKeys() {
  return ENVIRONMENT_ORDER.map(id => {
    const env = TRAVEL_ENVIRONMENTS[id];
    return {
      id,
      label:  env.label,
      enter:  env.sounds.enter,
      exit:   env.sounds.exit,
      loop:   env.sounds.loop,
      legacy: id === DEFAULT_ENVIRONMENT,
    };
  });
}
