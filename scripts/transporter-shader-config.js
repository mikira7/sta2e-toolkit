/** Pure configuration and timeline helpers shared by the renderer, UI and tests. */
export const TRANSPORTER_SHADER_SETTING = "transporterShaderAppearance";
export const TRANSPORTER_SHADER_ACTION = "transporterShaderVfx";

const base = {
  framing: "figure", color: "#72aaff", highlight: "#e4f3ff", secondary: "#d9c7ff", duration: 5600,
  rainDensity: 0.65, rainSpeed: 1.1, particleSize: 1, noiseScale: 24,
  noiseStrength: 0.65, shimmerSpeed: 1.5, particleSpeed: 1.5, glow: 0.45,
  outerDirection: "clockwise", innerDirection: "clockwise",
  innerClusterSize: 100,
  staticAmount: .55, staticRate: 1.5,
  stretch: 14, turbulence: 0.15, pulse: 0.08, shape: 0,
  accent: "none", rainGain: 1,
  swipeHeight: 100, swipeWidth: 100,
  strandWidth: 0, strandLength: 0, strandCount: 0,
};
const preset = (label, values) => Object.freeze({ ...base, label, ...values,
  particleSpeed: values.shimmerSpeed ?? base.shimmerSpeed,
  innerParticleSpeed: values.shimmerSpeed ?? base.shimmerSpeed,
  coreIntensity: values.noiseStrength ?? base.noiseStrength,
});
const tosStyle = { duration: 5800, rainSpeed: 0.5, particleSize: 1.35, noiseScale: 40, noiseStrength: 0.85, stretch: 1, turbulence: 0.05, shimmerSpeed: 2.2, accent: "tos", rainGain: 0 };
export const TRANSPORTER_SHADER_PRESETS = Object.freeze({
  voyFed: preset("Voyager / Federation", { color: "#86b5ff", rainDensity: 0.8, particleSize: 0.8, stretch: 18, noiseScale: 30, accent: "voyager" }),
  tngFed: preset("TNG Federation", {}),
  tosFed: preset("TOS Federation", { ...tosStyle, color: "#ffd34d", highlight: "#fff5bd" }),
  entFed: preset("Enterprise Era", { ...tosStyle, color: "#c4e5ff", highlight: "#f5fbff" }),
  tmpFed: preset("TMP / Films", { color: "#cbdcff", highlight: "#ffffff", duration: 5400, rainDensity: 0.45, rainSpeed: 1.5, particleSize: 0.75, stretch: 7, glow: 0.55, turbulence: 0.04, accent: "tmp", rainGain: 0 }),
  klingon: preset("Klingon", { color: "#ed4b26", highlight: "#ffd6ad", duration: 4800, rainSpeed: 1.4, particleSize: 1.4, noiseScale: 17, turbulence: 0.6, pulse: 0.3, shimmerSpeed: 2.8, stretch: 2, shape: 1 }),
  cardassian: preset("Cardassian", { color: "#e7a23d", highlight: "#ffe9a3", duration: 5200, rainSpeed: 0.8, noiseScale: 18, stretch: 4, pulse: 0.2, shape: 1 }),
  romulan: preset("Romulan", { color: "#4cdb98", highlight: "#c7ffe1", duration: 6000, rainSpeed: 0.6, noiseScale: 16, noiseStrength: 0.85, turbulence: 0.4, shimmerSpeed: 0.8, stretch: 2, rainGain: 0, accent: "romulan" }),
  ferengi: preset("Ferengi", { color: "#ffae48", highlight: "#fff1c4", duration: 5000, rainDensity: 0.8, rainSpeed: 1.25, particleSize: 0.85, noiseScale: 35, shimmerSpeed: 3, pulse: 0.25, stretch: 1.5 }),
  borg: preset("Borg", { color: "#78e83a", highlight: "#d8ffb0", duration: 5200, rainDensity: 0.45, rainSpeed: 0.7, particleSize: 1.5, noiseScale: 20, noiseStrength: 0.9, shimmerSpeed: 1, stretch: 1, turbulence: 0, pulse: 0.22, shape: 1, rainGain: 0, strandWidth: 1.8, strandLength: .55, strandCount: 8 }),
  dominion: preset("Dominion", { color: "#c4e5ff", secondary: "#d9c7ff", highlight: "#ffffff", duration: 6000, rainDensity: 1, rainSpeed: 1.35, particleSize: .7, noiseScale: 18, noiseStrength: .7, shimmerSpeed: .8, glow: .7, stretch: 18, rainGain: 1.6, accent: "dominion" }),
});

// This is also the form definition, so saved values and controls have identical bounds.
const particleDirections = Object.freeze({ clockwise: "Clockwise", counterclockwise: "Counterclockwise" });
export const TRANSPORTER_SHADER_CONTROLS = Object.freeze([
  { key: "rainDensity", label: "Rain density", min: 0, max: 1, step: 0.05 },
  { key: "rainSpeed", label: "Rain speed", min: 0.1, max: 3, step: 0.1 },
  { key: "particleSize", label: "Particle size", min: 0.4, max: 3, step: 0.1 },
  { key: "particleSpeed", label: "Outer dancing particle speed", min: 0, max: 4, step: 0.1, particlesOnly: true },
  { key: "innerParticleSpeed", label: "Inner dancing particle speed", min: 0, max: 4, step: 0.1, particlesOnly: true },
  { key: "outerDirection", label: "Outer particle direction", choices: particleDirections, particlesOnly: true },
  { key: "innerDirection", label: "Inner cluster direction", choices: particleDirections, particlesOnly: true },
  { key: "noiseScale", label: "Dancing particle detail", min: 8, max: 64, step: 1 },
  { key: "noiseStrength", label: "Outer dancing particle intensity", min: 0, max: 1, step: 0.05 },
  { key: "coreIntensity", label: "Inner cluster intensity", min: 0, max: 1, step: 0.05, particlesOnly: true },
  { key: "innerClusterSize", label: "Inner cluster size (%)", min: 25, max: 200, step: 5, particlesOnly: true },
  { key: "shimmerSpeed", label: "Shimmer speed", min: 0.1, max: 4, step: 0.1 },
  { key: "staticAmount", label: "Static sparkle amount", min: 0, max: 1, step: 0.05 },
  { key: "staticRate", label: "Static sparkle rate", min: 0.1, max: 4, step: 0.1 },
  { key: "glow", label: "Glow", min: 0, max: 1.5, step: 0.05 },
  { key: "duration", label: "Duration (ms)", min: 2000, max: 12000, step: 100 },
  { key: "swipeHeight", label: "Swipe height (%)", min: 25, max: 200, step: 5, preset: "tmpFed" },
  { key: "swipeWidth", label: "Swipe width (%)", min: 25, max: 300, step: 5, preset: "tmpFed" },
]);
export function normalizeTransporterType(type) {
  return Object.hasOwn(TRANSPORTER_SHADER_PRESETS, type) ? type : "tngFed";
}
export function normalizeTransporterShader(type, values = {}) {
  const defaults = TRANSPORTER_SHADER_PRESETS[normalizeTransporterType(type)];
  const result = { ...defaults };
  for (const { key, min, max, choices } of TRANSPORTER_SHADER_CONTROLS) {
    const raw = values?.[key];
    if (choices) {
      if (Object.hasOwn(choices, raw)) result[key] = raw;
      continue;
    }
    const n = typeof raw === "number" || (typeof raw === "string" && raw.trim()) ? Number(raw) : NaN;
    if (Number.isFinite(n)) result[key] = Math.max(min, Math.min(max, n));
  }
  for (const key of ["color", "highlight", "secondary"]) {
    if (/^#[0-9a-f]{6}$/i.test(values?.[key])) result[key] = values[key].toLowerCase();
  }
  // Old saves used shimmer speed for both movement and flicker. Preserve that
  // motion until a dedicated particle speed has been saved for this preset.
  if (values?.particleSpeed == null) result.particleSpeed = result.shimmerSpeed;
  // The old particle speed drove both layers. Keep it for the inner cluster
  // until that preset has an explicitly saved inner speed, including zero.
  if (values?.innerParticleSpeed == null) result.innerParticleSpeed = result.particleSpeed;
  // Preserve the previous shared intensity until the inner layer is saved separately.
  if (values?.coreIntensity == null) result.coreIntensity = result.noiseStrength;
  if (["figure", "portrait"].includes(values?.framing)) result.framing = values.framing;
  return result;
}
export function getTransporterShaderSettings(type) {
  let saved;
  try { saved = game.settings.get("sta2e-toolkit", TRANSPORTER_SHADER_SETTING); } catch { /* defaults */ }
  return normalizeTransporterShader(type, saved?.[normalizeTransporterType(type)]);
}
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
export function transporterTimeline(elapsed, duration, phase = "out") {
  const progress = clamp(elapsed / duration);
  const transition = smooth((progress - 0.15) / 0.65);
  return {
    progress, transition,
    matter: phase === "in" ? transition : 1 - transition,
    energy: smooth(progress / 0.15) * (1 - smooth((progress - 0.8) / 0.2)),
    // Clear the token overlay before its document is removed at the 80% boundary.
    surfaceEnergy: smooth(progress / 0.12) * (1 - smooth((progress - 0.66) / 0.14)),
    commit: progress >= 0.8,
    complete: progress >= 1,
  };
}

/** Era choreography in normalized artwork coordinates, independent of frame rate/duration.
 * Voyager: two successive pairs, each traveling from center toward head and feet.
 * TMP: two central vertical lines grow to full height, then separate horizontally.
 * Romulan: downward scan establishes the field, then a faint pair spreads and
 * returns brightly to the center. All scans clear at the document boundary.
 */
export function transporterAccents(progress, accent = "none") {
  const pair = start => {
    const p = (progress - start) / .29;
    return [smooth(p), smooth(p / .12) * (1 - smooth((p - .8) / .2))];
  };
  return {
    scan: accent === "romulan" ? [
      smooth((progress-.04)/.26),
      smooth((progress-.035)/.035)*(1-smooth((progress-.28)/.04)),
      progress < .5 ? smooth((progress-.33)/.17) : 1-smooth((progress-.5)/.23),
      smooth((progress-.32)/.04)*(.17+1.9*smooth((progress-.49)/.22))*(1-smooth((progress-.74)/.06)),
    ] : [0,0,0,0],
    orbs: accent === "voyager" ? [...pair(.13), ...pair(.44)] : [0, 0, 0, 0],
    circle: ["tos", "tmp"].includes(accent) ? 1 : 0,
    lines: accent === "tmp" ? [
      smooth((progress - .16) / .23),
      smooth((progress - .4) / .31),
      smooth((progress - .14) / .07) * (1 - smooth((progress - .68) / .12)),
    ] : [0, 0, 0],
  };
}
export function transporterNow() { return globalThis.game?.time?.serverTime ?? Date.now(); }

/** Bounded operation cache; canceled messages also reserve their ID against late playback. */
export function createTransporterOperationCache() {
  const seen = new Map();
  return {
    accept(id, expires, now) {
      for (const [key, expiry] of seen) if (expiry <= now) seen.delete(key);
      if (seen.has(id) || expires <= now) return false;
      if (seen.size >= 256) seen.delete(seen.keys().next().value);
      seen.set(id, expires);
      return true;
    },
    clear() { seen.clear(); },
  };
}
