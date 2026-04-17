/**
 * sta2e-toolkit | lcars-theme.js
 *
 * Shared LCARS design token resolver.
 * Returns a full LC token set matched to the currently active campaign theme,
 * falling back to TNG Classic if no campaign is active.
 *
 * Usage:
 *   import { getLcTokens } from "./lcars-theme.js";
 *   const LC = getLcTokens();   // call at render time, not module load time
 */

const FONT = "'Arial Narrow','Roboto Condensed','Helvetica Neue',sans-serif";

// ── Per-theme token overrides ─────────────────────────────────────────────────

const THEMES = {

  // TNG / DS9 / VOY — warm orange LCARS
  "lcars-tng": {
    bg:         "#000814",
    panel:      "#000d1a",
    primary:    "#ff9900",   // orange
    secondary:  "#cc88ff",   // purple
    tertiary:   "#ffcc66",   // tan/gold
    text:       "#ffcc88",
    textDim:    "#aa6600",
    textBright: "#ffffff",
    border:     "#cc6600",
    borderDim:  "#331a00",
    green:      "#66cc66",
    yellow:     "#ffcc00",
    orange:     "#ff6600",
    red:        "#ff3333",
    font:       FONT,
  },

  // TNG Blue-Grey — cooler, slate-blue variant seen in some TNG displays
  "lcars-tng-blue": {
    bg:         "#00050f",
    panel:      "#000a1a",
    primary:    "#5599ff",   // cool blue
    secondary:  "#99ccff",   // light blue accent
    tertiary:   "#aabbdd",   // slate
    text:       "#c8deff",
    textDim:    "#4466aa",
    textBright: "#ffffff",
    border:     "#3366cc",
    borderDim:  "#0a1a33",
    green:      "#55ddaa",
    yellow:     "#ffdd55",
    orange:     "#ff8833",
    red:        "#ff4455",
    font:       FONT,
  },

  // TOS — boxy, illuminated panels, gold/amber/green
  "tos-panel": {
    bg:         "#0a0800",
    panel:      "#141000",
    primary:    "#ddaa00",   // gold/amber
    secondary:  "#cc4400",   // red-orange accent
    tertiary:   "#88cc44",   // green
    text:       "#eecc77",
    textDim:    "#886600",
    textBright: "#ffffff",
    border:     "#aa8800",
    borderDim:  "#2a2000",
    green:      "#88cc44",
    yellow:     "#ffdd00",
    orange:     "#ff6600",
    red:        "#ff2200",
    font:       FONT,
  },

  // TMP — sleek blue-white, monochrome blue-green
  "tmp-console": {
    bg:         "#000810",
    panel:      "#000d1c",
    primary:    "#33aadd",   // teal-blue
    secondary:  "#55ddcc",   // cyan accent
    tertiary:   "#99ddee",
    text:       "#aaddee",
    textDim:    "#336677",
    textBright: "#ffffff",
    border:     "#226688",
    borderDim:  "#051522",
    green:      "#44ddaa",
    yellow:     "#eedd44",
    orange:     "#ff8833",
    red:        "#ff3344",
    font:       FONT,
  },

  // ENT — dark gunmetal, industrial, muted blue/grey
  "ent-panel": {
    bg:         "#080a0c",
    panel:      "#0e1215",
    primary:    "#4488bb",   // muted steel blue
    secondary:  "#6699aa",   // grey-blue
    tertiary:   "#8899aa",
    text:       "#99bbcc",
    textDim:    "#3a5566",
    textBright: "#ddeeff",
    border:     "#335566",
    borderDim:  "#101820",
    green:      "#44aa77",
    yellow:     "#ccaa33",
    orange:     "#cc6633",
    red:        "#cc2233",
    font:       FONT,
  },

  // Klingon — deep crimson/black, harsh and aggressive
  "klingon": {
    bg:         "#0a0000",
    panel:      "#120000",
    primary:    "#cc1111",   // blood red
    secondary:  "#ff4422",   // orange-red accent
    tertiary:   "#884400",   // dark burnt orange
    text:       "#ddaa88",
    textDim:    "#662200",
    textBright: "#ffffff",
    border:     "#881100",
    borderDim:  "#2a0000",
    green:      "#886600",   // desaturated — Klingons don't do friendly green
    yellow:     "#cc8800",
    orange:     "#ff4400",
    red:        "#ff1100",
    font:       FONT,
  },

  // Romulan — cold dark green, precise and clinical
  "romulan": {
    bg:         "#000a00",
    panel:      "#000f00",
    primary:    "#22aa44",   // Romulan green
    secondary:  "#44dd88",   // bright green accent
    tertiary:   "#669966",   // muted sage
    text:       "#88cc88",
    textDim:    "#226633",
    textBright: "#ccffcc",
    border:     "#1a6633",
    borderDim:  "#001a00",
    green:      "#44dd88",
    yellow:     "#aacc33",
    orange:     "#cc6622",
    red:        "#cc2233",
    font:       FONT,
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the LC token set for the currently active campaign theme.
 * Safe to call at any time after Foundry is ready; falls back to TNG Classic.
 *
 * @returns {object} LC design tokens
 */
export function getLcTokens() {
  let themeKey = "lcars-tng";
  try {
    // Primary: active campaign theme via the toolkit API
    const store    = game?.sta2eToolkit?.campaignStore;
    const campaign = store?.getActiveCampaign?.();
    if (campaign?.theme) {
      themeKey = campaign.theme;
    } else {
      // Fallback: global hudTheme setting
      const globalTheme = game?.settings?.get("sta2e-toolkit", "hudTheme");
      if (globalTheme) themeKey = globalTheme;
    }
  } catch {
    // Foundry not ready yet — use default
  }
  return THEMES[themeKey] ?? THEMES["lcars-tng"];
}

/**
 * Map of all available theme keys → display names.
 * Matches the choices registered in settings.js.
 */
export const THEME_NAMES = {
  "lcars-tng":      "LCARS TNG Classic",
  "lcars-tng-blue": "LCARS TNG Blue-Grey",
  "tos-panel":      "TOS Panel",
  "tmp-console":    "TMP Console",
  "ent-panel":      "ENT Panel",
  "klingon":        "Klingon",
  "romulan":        "Romulan",
};
