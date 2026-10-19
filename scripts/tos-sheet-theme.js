/**
 * sta2e-toolkit | tos-sheet-theme.js
 *
 * The era overlays for the 2e actor sheets — character, NPC, supporting
 * character, starship and small craft: the TOS "Console Viewer" look (sibling of
 * task-card-tos.js, styles/tos-sheet.css) and the TMP "Console Monitor" look
 * (sibling of task-card-tmp.js, styles/tmp-sheet.css). This module only decides
 * which sheets get which; shape and colour live in the stylesheets.
 *
 * ── An overlay, never a template ─────────────────────────────────────────────
 * Nothing in the system's markup is moved, wrapped or replaced. A render hook
 * stamps two things on the template root (.character-sheet / .starship-sheet):
 * the era class (`sta2e-tos-sheet` or `sta2e-tmp-sheet`), and
 * `data-sta2e-sheet="<kind>"`. Every rule in each stylesheet hangs off both. Every data-action, input name and system
 * script — the track renderer rebuilds its keys on every render — therefore
 * keeps working, and the decorations (header strip, viewer caption, lamps) are
 * pseudo-elements.
 *
 * The kind is needed because CSS cannot tell the sheets apart otherwise: NPC,
 * supporting and player characters are all actor type `character` on the same
 * root class, and the NPC's Personal Threat track reuses the character's
 * `box stress` keys.
 *
 * ── When it applies ──────────────────────────────────────────────────────────
 * Theme `tos-panel`, `tmp-console` or `tmp-monitor`, the world setting `themeCharacterSheet`
 * on (the same switch that gates the toolkit's other sheet theming), and the
 * actor has not picked its own palette in the system's colour picker.
 * _applySheetTheme in main.js skips a tagged sheet, since its rules are all
 * `!important` and would fight the overlay.
 *
 * A leaf: imports only lcars-theme.js.
 */

import { getActiveLcThemeKey } from "./lcars-theme.js";

/** The sheet class → its kind. Render hooks are named after the class. */
const SHEET_KINDS = {
  STACharacterSheet2e:  "character",
  STANPCSheet2e:        "npc",
  STASupportingSheet2e: "supporting",
  STAStarshipSheet2e:   "starship",
  STASmallCraftSheet2e: "smallcraft",
};

/** The theme id → the overlay classes it stamps. TMP Monitor is the TMP
 *  overlay plus a modifier that styles/tmp-monitor-sheet.css restyles from, so
 *  it inherits every layout fix tmp-sheet.css carries. */
const ERA_CLASSES = {
  "tos-panel":   ["sta2e-tos-sheet"],
  "tmp-console": ["sta2e-tmp-sheet"],
  "tmp-monitor": ["sta2e-tmp-sheet", "sta2e-tmp-sheet--monitor"],
};
const ALL_ERA_CLASSES = [...new Set(Object.values(ERA_CLASSES).flat())];

/** The overlay classes on for this client right now (empty when off). */
function _activeEraClasses() {
  try {
    if (!game.settings.get("sta2e-toolkit", "themeCharacterSheet")) return [];
    return ERA_CLASSES[getActiveLcThemeKey()] ?? [];
  } catch {
    return [];
  }
}

/** Whether the TOS sheet look is on for this client right now. */
export function tosSheetThemeActive() {
  return _activeEraClasses().includes("sta2e-tos-sheet");
}

function _apply(app, kind) {
  const root = app?.element?.querySelector?.(".character-sheet, .starship-sheet");
  if (!root) return;
  const palette = app.document?.system?.palette;
  const ownPalette = !!palette && palette !== "default";
  const era = ownPalette ? [] : _activeEraClasses();
  // Toggle every era class, so a theme change moves an open sheet across.
  for (const cls of ALL_ERA_CLASSES) root.classList.toggle(cls, era.includes(cls));
  if (era.length) root.dataset.sta2eSheet = kind;
  else delete root.dataset.sta2eSheet;
}

/** Re-tag every open sheet — after a theme or setting change. */
export function refreshTosSheets() {
  const apps = foundry?.applications?.instances?.values?.() ?? [];
  for (const app of apps) {
    const kind = SHEET_KINDS[app?.constructor?.name];
    if (kind) _apply(app, kind);
  }
}

export function registerTosSheetTheme() {
  for (const [cls, kind] of Object.entries(SHEET_KINDS)) {
    Hooks.on(`render${cls}`, app => _apply(app, kind));
  }
}
