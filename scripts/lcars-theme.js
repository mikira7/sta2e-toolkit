/**
 * sta2e-toolkit | lcars-theme.js
 *
 * Shared design token resolver for LCARS-era and faction-themed widgets.
 * Call these helpers at render time so scene-pinned campaigns can affect UI.
 */

const FONT = "'Arial Narrow','Roboto Condensed','Helvetica Neue',sans-serif";

const THEMES = {
  blue: {
    bg: "#06111d", panel: "#081927", primary: "#f0a43a", secondary: "#c8942c",
    tertiary: "#d8b45f", text: "#f2c77a", textDim: "#b8842e", textBright: "#ffffff",
    border: "#a66f20", borderDim: "#3d2b12", green: "#66aa88", yellow: "#d8c86a",
    orange: "#ff9900", red: "#ff4455", font: FONT,
  },
  "lcars-tng": {
    bg: "#000000", panel: "#050505", primary: "#f6a726", secondary: "#c0a200",
    tertiary: "#f2c77a", text: "#f6c36d", textDim: "#b78a20", textBright: "#f2f2f2",
    border: "#f6a726", borderDim: "#403000", green: "#48c76b", yellow: "#ffef3a",
    orange: "#f47c20", red: "#d92222", font: FONT,
  },
  "lcars-tng-blue": {
    bg: "#000000", panel: "#02080d", primary: "#f0a43a", secondary: "#008c56",
    tertiary: "#d8b45f", text: "#f2c77a", textDim: "#b8842e", textBright: "#ffffff",
    border: "#a66f20", borderDim: "#3d2b12", green: "#00a565", yellow: "#d8ca62",
    orange: "#f1a23a", red: "#b51424", font: FONT,
  },
  "tos-panel": {
    bg: "#0a0800", panel: "#141000", primary: "#ddaa00", secondary: "#cc4400",
    tertiary: "#88cc44", text: "#eecc77", textDim: "#886600", textBright: "#ffffff",
    border: "#aa8800", borderDim: "#2a2000", green: "#88cc44", yellow: "#ffdd00",
    orange: "#ff6600", red: "#ff2200", font: FONT,
  },
  "tmp-console": {
    bg: "#000000", panel: "#001008", primary: "#00d27a", secondary: "#00aef0",
    tertiary: "#ed2f76", text: "#3df09d", textDim: "#0d7c4c", textBright: "#e8fff5",
    border: "#00aef0", borderDim: "#003a2a", green: "#00d27a", yellow: "#e9e95a",
    orange: "#f69b2e", red: "#e82938", font: FONT,
  },
  "ent-panel": {
    bg: "#000000", panel: "#2e2e2e", primary: "#c7c7c7", secondary: "#3d3d3d",
    tertiary: "#7aaec4", text: "#d0d0d0", textDim: "#5e5e5e", textBright: "#f0f0f0",
    border: "#c7c7c7", borderDim: "#373737", green: "#a7d46c", yellow: "#f0e800",
    orange: "#c47b00", red: "#9b0000", font: FONT,
  },
  klingon: {
    bg: "#0a0000", panel: "#120000", primary: "#cc1111", secondary: "#ff4422",
    tertiary: "#884400", text: "#ddaa88", textDim: "#662200", textBright: "#ffffff",
    border: "#881100", borderDim: "#2a0000", green: "#886600", yellow: "#cc8800",
    orange: "#ff4400", red: "#ff1100", font: FONT,
  },
  romulan: {
    bg: "#000a00", panel: "#000f00", primary: "#22aa44", secondary: "#44dd88",
    tertiary: "#669966", text: "#88cc88", textDim: "#226633", textBright: "#ccffcc",
    border: "#1a6633", borderDim: "#001a00", green: "#44dd88", yellow: "#aacc33",
    orange: "#cc6622", red: "#cc2233", font: FONT,
  },
};

const ERA_THEME_DEFAULTS = {
  tng: "lcars-tng",
  tos: "tos-panel",
  tmp: "tmp-console",
  ent: "ent-panel",
  klingon: "klingon",
  romulan: "romulan",
  custom: "lcars-tng-blue",
};

const THEME_TEMPLATES = {
  blue: "starfleet-blue",
  "lcars-tng": "tng-lcars",
  "lcars-tng-blue": "tech-lcars",
  "tos-panel": "tos-console",
  "tmp-console": "tmp-grid",
  "ent-panel": "ent-stream",
  klingon: "klingon-tactical",
  romulan: "romulan-grid",
};

export function themeForEra(era) {
  return ERA_THEME_DEFAULTS[era] ?? "lcars-tng";
}

export function getActiveLcThemeKey() {
  let themeKey = "lcars-tng";
  try {
    const store = game?.sta2eToolkit?.campaignStore;
    const campaign = store?.getActiveCampaign?.();
    if (campaign?.theme) themeKey = campaign.theme;
    else if (campaign?.era) themeKey = themeForEra(campaign.era);
    else {
      const globalTheme = game?.settings?.get("sta2e-toolkit", "hudTheme");
      if (globalTheme) themeKey = globalTheme;
    }
  } catch {
    // Foundry not ready yet.
  }
  return THEMES[themeKey] ? themeKey : "lcars-tng";
}

export function getLcTokens() {
  return THEMES[getActiveLcThemeKey()] ?? THEMES["lcars-tng"];
}

export function getLcThemeTemplate(themeKey = getActiveLcThemeKey()) {
  return THEME_TEMPLATES[themeKey] ?? "tng-lcars";
}

export function getLcCssVars(prefix = "lc", tokens = getLcTokens()) {
  const pairs = {
    bg: tokens.bg,
    panel: tokens.panel,
    primary: tokens.primary,
    secondary: tokens.secondary,
    tertiary: tokens.tertiary,
    text: tokens.text,
    "text-dim": tokens.textDim,
    "text-bright": tokens.textBright,
    border: tokens.border,
    "border-dim": tokens.borderDim,
    green: tokens.green,
    yellow: tokens.yellow,
    orange: tokens.orange,
    red: tokens.red,
    font: tokens.font,
  };
  return Object.entries(pairs).map(([key, value]) => `--${prefix}-${key}:${value};`).join("");
}

export const THEME_NAMES = {
  blue: "Starfleet Blue",
  "lcars-tng": "LCARS TNG Classic",
  "lcars-tng-blue": "LCARS TNG Blue-Grey",
  "tos-panel": "TOS Panel",
  "tmp-console": "TMP Console",
  "ent-panel": "ENT Panel",
  klingon: "Klingon",
  romulan: "Romulan",
};
