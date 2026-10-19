/**
 * sta2e-toolkit | tos-sheet-theme.js
 *
 * The TOS "Console Viewer" look for the 2e actor sheets — character, NPC,
 * supporting character, starship and small craft — the sibling of the TOS task
 * card (task-card-tos.js). Shape and colour live in styles/tos-sheet.css; this
 * module only decides which sheets get it.
 *
 * ── An overlay, never a template ─────────────────────────────────────────────
 * Nothing in the system's markup is moved, wrapped or replaced. A render hook
 * stamps two things on the template root (.character-sheet / .starship-sheet):
 * the class `sta2e-tos-sheet`, and `data-sta2e-sheet="<kind>"`. Every rule in
 * the stylesheet hangs off both. Every data-action, input name and system
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
 * Theme `tos-panel`, the world setting `themeCharacterSheet` on (the same switch
 * that gates the toolkit's other sheet theming), and the actor has not picked
 * its own palette in the system's colour picker. _applySheetTheme in main.js
 * skips a tagged sheet, since its rules are all `!important` and would fight
 * this overlay.
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

/** Whether the TOS sheet look is on for this client right now. */
export function tosSheetThemeActive() {
  try {
    return getActiveLcThemeKey() === "tos-panel"
      && !!game.settings.get("sta2e-toolkit", "themeCharacterSheet");
  } catch {
    return false;
  }
}

function _apply(app, kind) {
  const root = app?.element?.querySelector?.(".character-sheet, .starship-sheet");
  if (!root) return;
  const palette = app.document?.system?.palette;
  const ownPalette = !!palette && palette !== "default";
  const on = tosSheetThemeActive() && !ownPalette;
  root.classList.toggle("sta2e-tos-sheet", on);
  if (on) root.dataset.sta2eSheet = kind;
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
