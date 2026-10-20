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
  // The Enterprise-E's LCARS from First Contact and Insurrection: periwinkle and
  // slate-blue frames with tan accents, orange kept for highlights. Replaced
  // the old "lcars-tng-blue" (RETIRED_THEMES below moves worlds across).
  "lcars-fc": {
    bg: "#000000", panel: "#04070f", primary: "#7b93d1", secondary: "#c9a27a",
    tertiary: "#b5c3e8", text: "#c6d3f0", textDim: "#5d6f9c", textBright: "#f2f5ff",
    border: "#7b93d1", borderDim: "#1e2840", green: "#5fbf8f", yellow: "#ffd35c",
    orange: "#ff9c33", red: "#d9443a", font: FONT,
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
  // The later films' monitor graphics: the same phosphor palette as TMP
  // Console, drawn as one black screen rather than a grey panel.
  "tmp-monitor": {
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
  custom: "lcars-fc",
};

const THEME_TEMPLATES = {
  blue: "starfleet-blue",
  "lcars-tng": "tng-lcars",
  "lcars-fc": "tech-lcars",
  "tos-panel": "tos-console",
  "tmp-console": "tmp-grid",
  "tmp-monitor": "tmp-grid",
  "ent-panel": "ent-stream",
  klingon: "klingon-tactical",
  romulan: "romulan-grid",
};

/**
 * Retired theme ids and what replaced them. getActiveLcThemeKey resolves them at
 * read time, and migrateRetiredThemes (run by the active GM on ready) rewrites
 * the stored hudTheme setting and every campaign's theme, because several
 * readers take the raw stored id rather than going through this module.
 */
export const RETIRED_THEMES = { "lcars-tng-blue": "lcars-fc" };

/** Resolve a stored theme id, following a retired id to its replacement. */
export function canonicalThemeKey(key) { return RETIRED_THEMES[key] ?? key; }

/**
 * Move the world off retired theme ids. Call on the active GM only. Returns
 * true when anything was written.
 */
export async function migrateRetiredThemes() {
  let changed = false;
  const global = game.settings.get("sta2e-toolkit", "hudTheme");
  if (RETIRED_THEMES[global]) {
    await game.settings.set("sta2e-toolkit", "hudTheme", RETIRED_THEMES[global]);
    changed = true;
  }
  const retire = c => RETIRED_THEMES[c?.theme] ? { ...c, theme: RETIRED_THEMES[c.theme] } : c;
  const store = game.sta2eToolkit?.campaignStore;
  if (store?._mutateCampaigns) {
    // Through the store's write queue, so it cannot race a pool write at ready.
    await store._mutateCampaigns(list => {
      if (!list.some(c => RETIRED_THEMES[c?.theme])) return null;
      changed = true;
      return list.map(retire);
    });
  } else {
    const stored = game.settings.get("sta2e-toolkit", "campaigns");
    const list = Array.isArray(stored?.list) ? stored.list : [];
    if (list.some(c => RETIRED_THEMES[c?.theme])) {
      await game.settings.set("sta2e-toolkit", "campaigns", { ...stored, list: list.map(retire) });
      changed = true;
    }
  }
  return changed;
}

/**
 * Themes whose task card and chat cards wear the Bracket Console
 * (task-card-tng.js, tngChatCard in chat-card-frame.js).
 */
export const BRACKET_THEME_KEYS = new Set(["lcars-tng", "lcars-fc"]);

/** Whether a theme id wears the Bracket Console cards. */
export function isBracketTheme(key) { return BRACKET_THEME_KEYS.has(key); }

/** Both TMP themes — Console (grey panels) and Monitor (black screens). */
export const TMP_THEME_KEYS = new Set(["tmp-console", "tmp-monitor"]);

/** Whether a theme id is one of the TMP looks. */
export function isTmpTheme(key) { return TMP_THEME_KEYS.has(key); }

/**
 * Themes whose task card and chat cards wear the ENT Bridge Touchscreen
 * (task-card-ent.js, entChatCard in chat-card-frame.js).
 */
export const ENT_THEME_KEYS = new Set(["ent-panel"]);

/** Whether a theme id wears the Bridge Touchscreen cards. */
export function isEntTheme(key) { return ENT_THEME_KEYS.has(key); }

/**
 * Themes whose task card and chat cards wear the Klingon Targeting Scope
 * (task-card-klingon.js, klingonChatCard in chat-card-frame.js).
 */
export const KLINGON_THEME_KEYS = new Set(["klingon"]);

/** Whether a theme id wears the Targeting Scope cards. */
export function isKlingonTheme(key) { return KLINGON_THEME_KEYS.has(key); }

/**
 * Themes whose task card, chat cards and dice roller wear the Romulan Raptor
 * Wing (task-card-romulan.js, romulanChatCard in chat-card-frame.js).
 */
export const ROMULAN_THEME_KEYS = new Set(["romulan"]);

/** Whether a theme id wears the Raptor Wing cards. */
export function isRomulanTheme(key) { return ROMULAN_THEME_KEYS.has(key); }

export function themeForEra(era) {
  return ERA_THEME_DEFAULTS[era] ?? "lcars-tng";
}

// ── Scoped theme override ────────────────────────────────────────────────────
// An actor's Sheet Skin (tos-sheet-theme.js) dresses its dice roller and the
// cards that roll posts in that skin's era. Everything that skins reads the
// theme through getActiveLcThemeKey, so the override lives here: a stack of
// pushed keys (the top wins), plus `null` entries pushed by withBaseLcTheme,
// which the persistent HUDs use so a roller held open does not repaint them.
const _themeOverrides = [];

function _overrideKey() {
  const top = _themeOverrides[_themeOverrides.length - 1];
  return top && THEMES[top] ? top : null;
}

/** Push a theme override; returns its release (safe to call more than once). */
export function pushLcThemeOverride(key) {
  const entry = { key: key && THEMES[canonicalThemeKey(key)] ? canonicalThemeKey(key) : null };
  _themeOverrides.push(entry.key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const i = _themeOverrides.lastIndexOf(entry.key);
    if (i >= 0) _themeOverrides.splice(i, 1);
  };
}

/** Run fn synchronously under theme `key` (a falsy key leaves the theme alone). */
export function withLcTheme(key, fn) {
  if (!key) return fn();
  const release = pushLcThemeOverride(key);
  try { return fn(); } finally { release(); }
}

/** Run fn synchronously under the campaign theme, ignoring any override. */
export function withBaseLcTheme(fn) {
  if (!_themeOverrides.length) return fn();
  const release = pushLcThemeOverride(null);
  try { return fn(); } finally { release(); }
}

export function getActiveLcThemeKey() {
  const override = _overrideKey();
  if (override) return override;
  return getCampaignLcThemeKey();
}

/** The campaign / world theme, never an actor's skin override. */
export function getCampaignLcThemeKey() {
  let themeKey = "lcars-tng";
  try {
    const store = game?.sta2eToolkit?.campaignStore;
    const campaign = store?.getActiveCampaign?.();
    if (campaign?.theme) themeKey = canonicalThemeKey(campaign.theme);
    else if (campaign?.era) themeKey = themeForEra(campaign.era);
    else {
      const globalTheme = game?.settings?.get("sta2e-toolkit", "hudTheme");
      if (globalTheme) themeKey = canonicalThemeKey(globalTheme);
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

// ─────────────────────────────────────────────────────────────────────────
// Inline style builders
//
// Shared by the dialogs that build their markup as inline-styled HTML strings
// (Task Maker and its Opposed tab). They resolve LC tokens at call time, so
// they must be invoked during render, never cached at module load.
// ─────────────────────────────────────────────────────────────────────────

export function inputStyle(extra = "", tokens = getLcTokens()) {
  return `width:100%;background:${tokens.panel};color:${tokens.text};border:1px solid ${tokens.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-family:${tokens.font};font-size:12px;${extra}`;
}

export function selectStyle(extra = "", tokens = getLcTokens()) {
  return `background:${tokens.panel};color:${tokens.text};border:1px solid ${tokens.border};padding:8px 10px;border-radius:12px 3px 12px 3px;font-family:${tokens.font};${extra}`;
}

export function labelStyle(extra = "", tokens = getLcTokens()) {
  return `display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${tokens.textDim};${extra}`;
}

export function pillStyle(color, prefix = "tmk", tokens = getLcTokens()) {
  return `flex:1;background:${tokens.bg};color:${tokens.text};border:1px solid ${tokens.border};padding:4px 6px;border-radius:999px;font-size:9px;cursor:pointer;letter-spacing:0.06em;text-transform:uppercase;--${prefix}-button-accent:${color};`;
}

export const THEME_NAMES = {
  blue: "Starfleet Blue",
  "lcars-tng": "LCARS TNG Classic",
  "lcars-fc": "LCARS First Contact",
  "tos-panel": "TOS Panel",
  "tmp-console": "TMP Console",
  "tmp-monitor": "TMP Monitor",
  "ent-panel": "ENT Panel",
  klingon: "Klingon",
  romulan: "Romulan",
};
