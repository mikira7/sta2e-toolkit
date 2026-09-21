/**
 * sta2e-toolkit | token-toolkit-hud.js
 *
 * The module's single Token HUD control — one arrowhead button that opens a
 * drill-down menu of every GM tool that acts on a token.
 *
 * It replaces four separate controls that each owned their own `renderTokenHUD`
 * hook and their own flyout: the ship command arrowhead, the weapon crosshair,
 * the Q sparkle-hand, and an inline meteor button in main.js. On a starship that
 * was four icons stacked under Foundry's own controls, crowding the column and
 * giving no sense that they were one toolkit.
 *
 * **Navigation is the rebuild-in-place idiom the two rich palettes already used,
 * with one extra piece of state — which section is open.** A level change is a
 * fresh palette built from `{sectionId, state}` that replaces the old one and
 * inherits its `style.top`, so the panel never jumps. There is only ever one
 * panel on screen, which is what keeps `toggleHudFlyout`'s "one flyout per
 * column" rule from ever mattering.
 *
 * A section is a descriptor, not a hook. Two shapes:
 *
 *   branch: {id, label, icon, tooltip?, available(token),
 *            initialState?(host), build(host, state) -> Element[]}
 *   leaf:   {id, label, icon, tooltip?, leaf: true, available(token), run(host)}
 *
 * `host` is `{app, token, control, palette, rebuild(next), back()}`. Each feature
 * file's old `rebuild()` closure maps onto `host.rebuild()` one for one, which is
 * why converting them touched no row body.
 *
 * Row markup and colour are shared — see `buildHudItem` in token-hud-util.js and
 * styles/token-hud-flyout.css. The control's own art is styled in
 * styles/token-toolkit-hud.css.
 */

import {
  buildHudControl,
  buildHudFlyout,
  buildHudItem,
  resolveHudToken,
  toggleHudFlyout,
} from "./token-hud-util.js";
import { SHIP_COMMAND_SECTION } from "./ship-command-hud.js";
import { WEAPON_SECTION } from "./token-weapon-hud.js";
import { DEFLECTOR_SECTION } from "./deflector-hud.js";
import { Q_SECTION } from "./q-hud.js";
import { TREK_FX_SECTION } from "./trek-fx-hud.js";

const ARROWHEAD     = "modules/sta2e-toolkit/assets/arrowhead.svg";
const PALETTE_CLASS = "sta2e-toolkit-hud-palette";

/**
 * The VFX / destructible editor, as a leaf row.
 *
 * Reached through `game.sta2eToolkit` rather than an `import` of
 * ship-vfx-anchors.js — the same precedent token-weapon-hud.js sets for the
 * Combat HUD, and it keeps this host out of a very heavy module's import graph.
 * `openShipVfxAnchorEditor` accepts an actor or a token.
 */
const VFX_SECTION = {
  id:      "vfx",
  label:   "VFX & Destructible",
  icon:    "fas fa-meteor",
  tooltip: "Configure VFX anchors and destructible-object state for this token",
  leaf:    true,
  available: (token) => !!token.actor,
  run: (host) => {
    const open = game.sta2eToolkit?.openObjectVfxEditor;
    if (typeof open !== "function") {
      ui.notifications.error("STA2e Toolkit: the VFX editor is not ready.");
      return;
    }
    open(host.token);
  },
};

/** Root order, matching the column order the four controls used to appear in. */
const SECTIONS = [SHIP_COMMAND_SECTION, WEAPON_SECTION, DEFLECTOR_SECTION, Q_SECTION, TREK_FX_SECTION, VFX_SECTION];

/**
 * Which sections this token can offer. A section that throws while deciding is
 * dropped rather than taking the whole menu down with it.
 */
function _sectionsFor(token) {
  return SECTIONS.filter((section) => {
    try {
      return section.available(token);
    } catch (err) {
      console.warn(`STA2e Toolkit | Token HUD section "${section.id}" failed its availability check:`, err);
      return false;
    }
  });
}

/**
 * Swap the open panel for one built at `nav`. The HUD may have closed while an
 * action was running, hence the two connection guards.
 */
function _swap(host, nav) {
  const { control, palette } = host;
  if (!control.isConnected || !palette.isConnected) return;
  const fresh = _render(host.app, host.token, control, nav);
  fresh.style.top = palette.style.top;
  palette.replaceWith(fresh);
}

/**
 * Build the panel for one navigation state.
 *
 * @param {object} nav {sectionId: string|null, state: *}
 */
function _render(app, token, control, nav) {
  const palette = buildHudFlyout(PALETTE_CLASS);
  // The weapon grid sizes itself off this — see styles/token-weapon-hud.css.
  palette.dataset.section = nav.sectionId ?? "root";

  const host = {
    app, token, control, palette,
    rebuild: (next) => _swap(host, {
      sectionId: nav.sectionId,
      state:     next === undefined ? nav.state : next,
    }),
    back: () => _swap(host, { sectionId: null, state: null }),
  };

  if (!nav.sectionId) {
    for (const section of _sectionsFor(token)) {
      palette.appendChild(buildHudItem({
        icon:       section.icon,
        label:      section.label,
        tooltip:    section.tooltip ?? section.label,
        extraClass: section.leaf ? "leaf" : "section",
      }, () => {
        if (section.leaf) return void section.run(host);
        _swap(host, { sectionId: section.id, state: section.initialState?.(host) ?? null });
      }));
    }
    return palette;
  }

  const section = SECTIONS.find((s) => s.id === nav.sectionId);
  // The section stopped being available mid-navigation — fall back to the root.
  if (!section) return _render(app, token, control, { sectionId: null, state: null });

  palette.appendChild(buildHudItem({
    icon:       "fas fa-chevron-left",
    label:      section.label,
    tooltip:    "Back to the toolkit menu",
    extraClass: "back",
  }, () => host.back()));

  for (const row of section.build(host, nav.state) ?? []) palette.appendChild(row);
  return palette;
}

function _injectToolkitHud(app, html) {
  if (!game.user?.isGM) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".sta2e-toolkit-hud")) return;

  const token = resolveHudToken(app);
  if (!token) return;
  // Nothing to offer on this token — do not add an arrowhead that opens empty.
  if (!_sectionsFor(token).length) return;

  const column = root.querySelector(".col.right") ?? root.querySelector(".col.left");
  if (!column) return;
  const sibling = column.querySelector(".control-icon");

  const control = buildHudControl(sibling, {
    cssClass: "sta2e-toolkit-hud",
    img:      ARROWHEAD,
    tooltip:  "STA Toolkit (GM)",
  });
  control.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleHudFlyout(control, PALETTE_CLASS, () =>
      _render(app, token, control, { sectionId: null, state: null })
    );
  });
  column.appendChild(control);
}

/** Register the HUD hook. Call once from main.js init. */
export function registerTokenToolkitHud() {
  Hooks.on("renderTokenHUD", _injectToolkitHud);
}
