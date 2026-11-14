/**
 * sta2e-toolkit | water-presets.js
 *
 * The Water Surface style registry. A LEAF with NO IMPORTS, so the behavior's
 * schema, its sheet and the tests can read it without pulling PIXI in.
 *
 * A preset is a starting point, not a mode: picking one in the sheet writes its
 * `defaults` into the behavior's own fields, and from then on the fields are
 * what the renderer reads. Nothing in the renderer branches on the preset id.
 *
 * Units, so a preset and the schema cannot disagree:
 *  - sizes and distances are in GRID SQUARES (`waveScale`, `foamWidth`,
 *    `depthReach`), so a style looks the same on a 50 px and a 200 px grid;
 *  - every 0–100 field is a percentage;
 *  - `waveSpeed` / `flowSpeed` are percentages of a tuned base speed;
 *  - `flowAngle` is a compass bearing — 0 runs up the map, 90 to the right.
 */

/** Field ranges, shared by the schema and the tests. */
export const WATER_FIELD_RANGES = Object.freeze({
  opacity:       [0, 100],
  waveScale:     [0.25, 12],
  waveSpeed:     [0, 300],
  waveHeight:    [0, 100],
  flowAngle:     [0, 359],
  flowSpeed:     [0, 300],
  foamWidth:     [0, 6],
  foamIntensity: [0, 100],
  depthReach:    [0.5, 30],
  glow:          [0, 100],
  wakeStrength:  [0, 100],
  swellSize:     [0, 100],
  swellEvery:    [10, 600],
  turbulence:    [0, 100],
  caustics:      [0, 100],
});

export const WATER_FLOW_MODES = Object.freeze({
  still:       "Still",
  uniform:     "One direction",
  followBanks: "Follow the banks",
});

const P = (label, defaults, extra = {}) => Object.freeze({ label, defaults: Object.freeze(defaults), ...extra });

/** Ordered as the select shows them: water first, then the alien liquids. */
export const WATER_PRESETS = Object.freeze({
  ocean: P("Ocean", {
    deepColor: "#0b2f4f", shallowColor: "#2f8fa6", foamColor: "#eaf6f8",
    opacity: 85, waveScale: 3, waveSpeed: 100, waveHeight: 70,
    flowMode: "still", flowAngle: 90, flowSpeed: 0,
    foamWidth: 1.2, foamIntensity: 80, depthReach: 10, glow: 0,
    swellSize: 55, swellEvery: 45, turbulence: 0, caustics: 0,
  }),
  lake: P("Lake", {
    deepColor: "#123a3c", shallowColor: "#3f8a7e", foamColor: "#d8ece6",
    opacity: 80, waveScale: 1.6, waveSpeed: 55, waveHeight: 35,
    flowMode: "still", flowAngle: 90, flowSpeed: 0,
    foamWidth: 0.5, foamIntensity: 45, depthReach: 5, glow: 0,
    swellSize: 0, swellEvery: 90, turbulence: 0, caustics: 0,
  }),
  river: P("River", {
    deepColor: "#1a4250", shallowColor: "#4a9198", foamColor: "#e4f1ef",
    opacity: 82, waveScale: 1.2, waveSpeed: 70, waveHeight: 45,
    flowMode: "followBanks", flowAngle: 90, flowSpeed: 110,
    foamWidth: 0.45, foamIntensity: 55, depthReach: 2.5, glow: 0,
    swellSize: 0, swellEvery: 90, turbulence: 0, caustics: 0,
  }),
  pool: P("Swimming Pool", {
    deepColor: "#0a5f93", shallowColor: "#3ccbe3", foamColor: "#f2fbff",
    opacity: 55, waveScale: 1.1, waveSpeed: 45, waveHeight: 18,
    flowMode: "still", flowAngle: 90, flowSpeed: 0,
    foamWidth: 0.12, foamIntensity: 25, depthReach: 3, glow: 0,
    swellSize: 0, swellEvery: 90, turbulence: 0, caustics: 75,
  }),
  swamp: P("Swamp", {
    deepColor: "#1d2a14", shallowColor: "#4d5a2a", foamColor: "#9aa865",
    opacity: 88, waveScale: 2.2, waveSpeed: 25, waveHeight: 20,
    flowMode: "still", flowAngle: 90, flowSpeed: 0,
    foamWidth: 0.7, foamIntensity: 35, depthReach: 3, glow: 0,
    swellSize: 0, swellEvery: 90, turbulence: 0, caustics: 0,
  }),
  lava: P("Lava", {
    deepColor: "#2a0c05", shallowColor: "#ff6a12", foamColor: "#ffd27a",
    opacity: 100, waveScale: 2.4, waveSpeed: 30, waveHeight: 60,
    flowMode: "uniform", flowAngle: 90, flowSpeed: 25,
    foamWidth: 0.6, foamIntensity: 70, depthReach: 4, glow: 85,
    swellSize: 0, swellEvery: 90, turbulence: 0, caustics: 0,
  }),
  acid: P("Acid", {
    deepColor: "#1f4a07", shallowColor: "#8dff2e", foamColor: "#e8ffb0",
    opacity: 85, waveScale: 1.4, waveSpeed: 80, waveHeight: 50,
    flowMode: "still", flowAngle: 90, flowSpeed: 0,
    foamWidth: 0.5, foamIntensity: 75, depthReach: 3, glow: 55,
    swellSize: 0, swellEvery: 90, turbulence: 0, caustics: 0,
  }),
  toxicSludge: P("Toxic Sludge", {
    deepColor: "#2b1238", shallowColor: "#8f3fb0", foamColor: "#d7f05a",
    opacity: 95, waveScale: 2.8, waveSpeed: 20, waveHeight: 40,
    flowMode: "still", flowAngle: 90, flowSpeed: 0,
    foamWidth: 0.8, foamIntensity: 60, depthReach: 4, glow: 35,
    swellSize: 0, swellEvery: 90, turbulence: 0, caustics: 0,
  }),
});

export const DEFAULT_WATER_PRESET = "ocean";

/** The keys a preset writes — every defaults block carries exactly these. */
export const WATER_PRESET_FIELDS = Object.freeze(Object.keys(WATER_PRESETS.ocean.defaults));

export function isWaterPresetId(id) {
  return Object.prototype.hasOwnProperty.call(WATER_PRESETS, id);
}

/** `{id: label}` for a StringField's `choices`. */
export function waterPresetChoices() {
  const out = {};
  for (const [id, p] of Object.entries(WATER_PRESETS)) out[id] = p.label;
  return out;
}

/** A fresh copy of a preset's defaults; an unknown id gives the default preset's. */
export function waterPresetDefaults(id) {
  const p = WATER_PRESETS[isWaterPresetId(id) ? id : DEFAULT_WATER_PRESET];
  return { ...p.defaults };
}
