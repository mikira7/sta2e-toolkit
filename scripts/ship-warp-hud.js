/**
 * sta2e-toolkit | ship-warp-hud.js
 *
 * GM-only warp controls on the Token HUD (right-click a starship token).
 *
 * The normal warp route is roller → chat card → ENGAGE → destination picker,
 * which is right for play but far too much ceremony when the GM just wants to
 * reposition a ship between beats. These two buttons run the same animations
 * with none of the dice or chat cards.
 *
 * Range is shown, not enforced: the destination picker's tether still turns red
 * past the ship's Engines rating, and the post-move warning still fires, but the
 * click always lands. It is a GM tool.
 */

import { promptShipCardDestination, runWarpEngageCard, runWarpFleeCard } from "./combat/ship-card-movement.js";

const FLAG_SCOPE = "sta2e-toolkit";

/**
 * Is this actor a ship of some kind?
 *
 * The module checks this in half a dozen places with four different
 * definitions; this is the most permissive of them (the elevation-ruler one) —
 * it covers the system's `starship`, the `spacecraft2e` variant, small craft,
 * and duck-types on the ship systems block for anything homebrewed.
 *
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isShipActor(actor) {
  if (!actor) return false;
  if (["starship", "smallcraft", "spacecraft2e"].includes(actor.type)) return true;
  if (actor.system?.systems !== undefined) return true;
  return !!actor.items?.some(i => i.type === "starshipweapon2e");
}

/**
 * Build a HUD control by cloning an existing sibling, so the markup matches
 * whatever element type this Foundry version uses (`<button class="control-icon">`
 * in v13+, `<div class="control-icon">` before that).
 */
function _buildControl(sibling, { cssClass, icon, tooltip }) {
  const el = sibling
    ? sibling.cloneNode(false)
    : document.createElement("button");
  el.className = "control-icon";
  el.classList.add(cssClass);
  el.classList.remove("active");
  el.removeAttribute("data-action");
  if (el.tagName === "BUTTON") el.type = "button";
  el.dataset.tooltip = tooltip;
  el.setAttribute("aria-label", tooltip);
  el.innerHTML = `<i class="${icon}"></i>`;
  return el;
}

function _resolveToken(app) {
  const obj = app?.object ?? app?.document?.object ?? null;
  if (obj?.document) return obj;
  const id = app?.document?.id ?? app?.object?.id ?? null;
  return id ? (canvas.tokens?.get(id) ?? null) : null;
}

async function _onWarpJump(app, token) {
  try { await app.clear?.(); } catch { /* HUD may already be gone */ }

  const destination = await promptShipCardDestination({
    overlayId: "sta2e-warp-overlay",
    title: "GM WARP JUMP",
    color: "#00a6fb",
    tokenId: token.id,
    actorId: token.actor?.id ?? null,
    // Drives the tether colour only — the picker never blocks a click.
    maxZones: token.actor?.system?.systems?.engines?.value ?? null,
  });
  if (!destination) {
    ui.notifications.info("STA2e Toolkit: Warp jump aborted.");
    return;
  }

  // Without this flag main.js reads the jump as impulse movement and warns
  // about a 2-zone limit; with it, the correct Engines-based warning fires and
  // the flag clears itself.
  try { await token.document.setFlag(FLAG_SCOPE, "_warpActive", true); } catch { /**/ }

  try {
    await runWarpEngageCard({
      tokenId:   token.id,
      actorId:   token.actor?.id ?? null,
      actorName: token.actor?.name ?? "Ship",
    }, destination);
  } catch (err) {
    console.error("STA2e Toolkit | GM warp jump failed:", err);
    ui.notifications.error("Warp jump failed — see console.");
    try { await token.document.update({ alpha: 1 }); } catch { /**/ }
  }
}

async function _onWarpOut(app, token) {
  try { await app.clear?.(); } catch { /**/ }

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Warp Out" },
    content: `<p><strong>${token.actor?.name ?? "This ship"}</strong> will warp out and its
      token will be <strong>removed from this scene</strong>.</p>`,
    yes: { label: "Warp Out" },
    no:  { label: "Cancel" },
    modal: true,
  });
  if (!confirmed) return;

  try {
    await runWarpFleeCard({ tokenId: token.id });
  } catch (err) {
    console.error("STA2e Toolkit | GM warp out failed:", err);
    ui.notifications.error("Warp out failed — see console.");
    try { await token.document.update({ alpha: 1 }); } catch { /**/ }
  }
}

function _injectWarpControls(app, html) {
  if (!game.user?.isGM) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".sta2e-warp-jump")) return;

  const token = _resolveToken(app);
  if (!token || !isShipActor(token.actor)) return;

  const column = root.querySelector(".col.right") ?? root.querySelector(".col.left");
  if (!column) return;
  const sibling = column.querySelector(".control-icon");

  const jump = _buildControl(sibling, {
    cssClass: "sta2e-warp-jump",
    icon:     "fas fa-forward-fast",
    tooltip:  "Warp Jump (GM) — pick a destination",
  });
  jump.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    _onWarpJump(app, token);
  });
  column.appendChild(jump);

  const out = _buildControl(sibling, {
    cssClass: "sta2e-warp-out",
    icon:     "fas fa-right-from-bracket",
    tooltip:  "Warp Out (GM) — leave the scene",
  });
  out.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    _onWarpOut(app, token);
  });
  column.appendChild(out);
}

/** Register the HUD hook. Call once from main.js init. */
export function registerShipWarpHud() {
  Hooks.on("renderTokenHUD", _injectWarpControls);
}
