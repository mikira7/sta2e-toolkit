/**
 * sta2e-toolkit | tos-sheet-theme.js
 *
 * The era overlays for the 2e actor sheets — character, NPC, supporting
 * character, starship and small craft: the TOS "Console Viewer" look (sibling of
 * task-card-tos.js, styles/tos-sheet.css), the TMP "Console Monitor" look
 * (sibling of task-card-tmp.js, styles/tmp-sheet.css), the ENT "Bridge
 * Touchscreen" look (sibling of task-card-ent.js, styles/ent-sheet.css), the
 * Klingon "Targeting Scope" look (sibling of task-card-klingon.js,
 * styles/klingon-sheet.css) and the Romulan "Raptor Wing" look (sibling of
 * task-card-romulan.js, styles/romulan-sheet.css). This
 * module only decides which sheets get which; shape and colour live in the
 * stylesheets.
 *
 * ── An overlay, never a template ─────────────────────────────────────────────
 * Nothing in the system's markup is moved, wrapped or replaced. A render hook
 * stamps two things on the template root (.character-sheet / .starship-sheet):
 * the era class (`sta2e-tos-sheet`, `sta2e-tmp-sheet`, `sta2e-ent-sheet`,
 * `sta2e-kli-sheet` or `sta2e-rom-sheet`), and
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
 * Theme `tos-panel`, `tmp-console`, `tmp-monitor`, `ent-panel`, `klingon` or `romulan`, the
 * world setting `themeCharacterSheet`
 * on (the same switch that gates the toolkit's other sheet theming), and the
 * actor has not picked its own palette in the system's colour picker.
 * _applySheetTheme in main.js skips a tagged sheet, since its rules are all
 * `!important` and would fight the overlay.
 *
 * ── Per-actor skin ───────────────────────────────────────────────────────────
 * The system's Colour Palette dialog (`_onColourPalette`) gains a Sheet Skin
 * select, injected on `renderDialogV2` and saved with the dialog's own Save as
 * the actor flag `sheetSkin`. Blank is Auto (the rule above). `system` keeps the
 * system sheet and its palette under any theme. An era theme id puts that
 * overlay on this actor's sheet whatever the campaign theme, the
 * `themeCharacterSheet` switch or the palette say — an explicit choice wins.
 * The dialog does not say which actor it is for, so a capture-phase click on
 * the sheet's `.colourpalette` key notes the actor just before it opens.
 *
 * Auto also means faction: with the world setting `factionSheetSkins` on, a
 * Klingon or Romulan actor (name, species, traits text or trait items — so a
 * "Klingon" character and a "Klingon Starship" both count) wears that skin.
 * `actorSkinTheme` is the one answer to "which skin does this actor wear",
 * and the dice roller and its task card use it too (npc-roller.js), so the
 * roller and the cards follow the sheet.
 *
 * A leaf: imports only lcars-theme.js and actor-faction.js (itself a leaf).
 */

import { getCampaignLcThemeKey } from "./lcars-theme.js";
import { resolveActorFactionKey } from "./actor-faction.js";

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
  "ent-panel":   ["sta2e-ent-sheet"],
  "klingon":     ["sta2e-kli-sheet"],
  "romulan":     ["sta2e-rom-sheet"],
};
const ALL_ERA_CLASSES = [...new Set(Object.values(ERA_CLASSES).flat())];

const SKIN_FLAG = "sheetSkin";

/** The Sheet Skin choices, in dialog order. */
const SHEET_SKINS = [
  { id: "",            label: "Auto (campaign theme; Klingon / Romulan by faction)" },
  { id: "system",      label: "System sheet (use the palette below)" },
  { id: "tos-panel",   label: "TOS Console Viewer" },
  { id: "tmp-console", label: "TMP Console" },
  { id: "tmp-monitor", label: "TMP Monitor" },
  { id: "ent-panel",   label: "ENT Bridge Touchscreen" },
  { id: "klingon",     label: "Klingon Targeting Scope" },
  { id: "romulan",     label: "Romulan Raptor Wing" },
];
const SKIN_IDS = new Set(SHEET_SKINS.map(s => s.id));

/** The actor's chosen sheet skin: "" (Auto), "system", or an era theme id. */
export function sheetSkinOf(actor) {
  let v;
  try { v = actor?.getFlag?.("sta2e-toolkit", SKIN_FLAG); } catch { v = undefined; }
  return typeof v === "string" && SKIN_IDS.has(v) ? v : "";
}

/** Klingon / Romulan from the actor's name, species and traits, when the
 *  world setting allows it; otherwise null. */
function _factionSkin(actor) {
  try {
    if (!game.settings.get("sta2e-toolkit", "factionSheetSkins")) return null;
  } catch { return null; }
  if (!actor) return null;
  const species = String(actor.system?.species ?? "").toLowerCase();
  if (/klingon/.test(species)) return "klingon";
  if (/romulan/.test(species)) return "romulan";
  const key = resolveActorFactionKey(actor);
  return key === "klingon" || key === "romulan" ? key : null;
}

/**
 * The era theme this actor's sheet, dice roller and task cards wear, or null to
 * follow the campaign theme. An explicit era skin wins; "system" opts out of
 * everything, faction included; Auto falls back to Klingon / Romulan.
 */
export function actorSkinTheme(actor) {
  const skin = sheetSkinOf(actor);
  if (skin === "system") return null;
  if (skin) return skin;
  return _factionSkin(actor);
}

/** The overlay classes on for this client right now (empty when off). */
function _activeEraClasses() {
  try {
    if (!game.settings.get("sta2e-toolkit", "themeCharacterSheet")) return [];
    return ERA_CLASSES[getCampaignLcThemeKey()] ?? [];
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
  const skin = sheetSkinOf(app.document);
  const faction = skin ? null : _factionSkin(app.document);
  const palette = app.document?.system?.palette;
  const ownPalette = !!palette && palette !== "default";
  let era;
  if (skin === "system") era = [];
  else if (skin) era = ERA_CLASSES[skin] ?? [];
  // A faction skin gives way to a palette the actor picked by hand.
  else if (faction) era = ownPalette ? [] : ERA_CLASSES[faction];
  else {
    const palette = app.document?.system?.palette;
    const ownPalette = !!palette && palette !== "default";
    era = ownPalette ? [] : _activeEraClasses();
  }
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

/** The actor whose palette key was just clicked — the dialog carries no
 *  reference to it. Short-lived, so an unrelated dialog never picks it up. */
let _paletteActor = null;
let _paletteAt = 0;

function _watchPaletteKey(app) {
  const el = app?.element;
  if (!el || el.dataset.sta2eSkinWatch) return;
  el.dataset.sta2eSkinWatch = "1";
  // Delegated once on the window, which survives re-renders; capture phase so
  // it runs before the system's action handler opens the dialog.
  el.addEventListener("click", ev => {
    if (!ev.target?.closest?.(".colourpalette")) return;
    _paletteActor = app.document;
    _paletteAt = Date.now();
  }, true);
}

function _escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function _injectSkinSelect(dialog) {
  const root = dialog?.element;
  const list = root?.querySelector?.(".palette-list");
  if (!list || root.querySelector(".sta2e-sheet-skin")) return;
  const actor = _paletteActor;
  if (!actor || Date.now() - _paletteAt > 5000) return;
  _paletteActor = null;

  const current = sheetSkinOf(actor);
  const options = SHEET_SKINS.map(s =>
    `<option value="${s.id}"${s.id === current ? " selected" : ""}>${_escapeHtml(s.label)}</option>`).join("");
  const block = document.createElement("div");
  block.className = "sta2e-sheet-skin";
  block.innerHTML = `
    <label class="sta2e-sheet-skin-row">
      <span class="sta2e-sheet-skin-label">Sheet Skin</span>
      <select name="sta2e-sheet-skin">${options}</select>
    </label>
    <p class="sta2e-sheet-skin-hint">An era skin replaces the palette on this sheet, and its dice roller and chat cards wear it too.</p>`;
  list.before(block);

  const select = block.querySelector("select");
  const hint = block.querySelector(".sta2e-sheet-skin-hint");
  const syncHint = () => {
    const era = !!select.value && select.value !== "system";
    hint.hidden = !era;
    list.classList.toggle("sta2e-sheet-skin-muted", era);
  };
  select.addEventListener("change", syncHint);
  syncHint();

  // Saved with the dialog's own Save, so closing it changes nothing.
  let saved = false;
  const save = () => {
    if (saved) return;
    saved = true;
    const next = select.value;
    if (next === sheetSkinOf(actor)) return;
    const write = next
      ? actor.setFlag("sta2e-toolkit", SKIN_FLAG, next)
      : actor.unsetFlag("sta2e-toolkit", SKIN_FLAG);
    Promise.resolve(write).catch(err => {
      console.error("sta2e-toolkit | Sheet skin could not be saved", err);
      ui.notifications?.warn("The sheet skin could not be saved.");
    });
  };
  root.querySelector('button[data-action="save"]')?.addEventListener("click", save);
  root.querySelector("form")?.addEventListener("submit", save);
}

export function registerTosSheetTheme() {
  for (const [cls, kind] of Object.entries(SHEET_KINDS)) {
    Hooks.on(`render${cls}`, app => { _watchPaletteKey(app); _apply(app, kind); });
  }
  Hooks.on("renderDialogV2", dialog => {
    try { _injectSkinSelect(dialog); }
    catch (err) { console.error("sta2e-toolkit | Sheet skin select failed", err); }
  });
}
