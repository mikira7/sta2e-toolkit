/**
 * sta2e-toolkit | ship-command-hud.js
 *
 * GM-only ship controls on the Token HUD (right-click a starship token).
 *
 * One arrowhead button opens a flyout palette of shortcuts: warp jump, warp out,
 * tractor beam lock/release, and cloak engage/disengage. Every one of them exists
 * because the normal route — roller → chat card → confirm → picker — is far too
 * much ceremony when the GM just wants to stage a ship between beats. Nothing
 * here rolls dice, and cloak skips the Reserve Power cost entirely.
 *
 * Range is shown, not enforced: the warp destination picker's tether still turns
 * red past the ship's Engines rating, and the post-move warning still fires, but
 * the click always lands. It is a GM tool.
 *
 * Actions are silent by default. Shift-click a tractor or cloak entry to also
 * post the usual LCARS chat card.
 */

import { promptShipCardDestination, runWarpEngageCard, runWarpFleeCard } from "./combat/ship-card-movement.js";
import {
  CombatHUD,
  applyTractorBeamLock,
  applyTractorBeamRelease,
  applyCloakEngage,
  applyCloakDeactivateForOfficer,
} from "./combat/combat-hud-core.js";
import { hasCloakingDevice } from "./combat/combat-definitions.js";

const FLAG_SCOPE = "sta2e-toolkit";
const ARROWHEAD  = "modules/sta2e-toolkit/assets/arrowhead.svg";
const SHIFT_HINT = " · Shift-click to announce in chat";

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
 * A ship counts as cloaked if either half of the state is set. The two are
 * applied together but can drift if one update fails, so treat either as cloaked
 * and let the toggle resynchronise them.
 */
function _isCloaked(token) {
  return (token.actor?.statuses?.has("invisible") ?? false)
      || (token.document.hidden ?? false);
}

/**
 * Build a HUD control by cloning an existing sibling, so the markup matches
 * whatever element type this Foundry version uses (`<button class="control-icon">`
 * in v13+, `<div class="control-icon">` before that).
 */
function _buildControl(sibling, { cssClass, icon, img, tooltip }) {
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
  el.innerHTML = img ? `<img src="${img}" alt="">` : `<i class="${icon}"></i>`;
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

async function _onTractorLock(token, { towTarget, announce }) {
  const target = Array.from(game.user.targets ?? [])[0] ?? null;
  if (!target) {
    ui.notifications.warn("STA2e Toolkit: Target the ship to lock on (T), then try again.");
    return;
  }
  if (target.id === token.id) {
    ui.notifications.warn("STA2e Toolkit: A ship cannot tractor itself.");
    return;
  }

  try {
    await applyTractorBeamLock(token, target, { towTarget, announce });
  } catch (err) {
    console.error("STA2e Toolkit | GM tractor lock failed:", err);
    ui.notifications.error("Tractor lock failed — see console.");
  }
}

/**
 * Both ends of a lock carry the flag, but only the projector's copy holds
 * `targetTokenId`. Resolve which end this token is so a release always clears
 * both — releasing from the held end alone would strand the projector's flag.
 *
 * @returns {{sourceTok: Token, targetTok: Token|null, heldName: string}|null}
 */
function _resolveTractorPair(token) {
  const state = CombatHUD.getTractorBeamState(token);
  if (!state) return null;

  if (state.targetTokenId) {
    return {
      sourceTok: token,
      targetTok: canvas.tokens?.get(state.targetTokenId) ?? null,
      heldName:  state.targetName ?? "target",
    };
  }
  // This token is the one being held — the projector is the other end.
  const sourceTok = state.sourceTokenId ? (canvas.tokens?.get(state.sourceTokenId) ?? null) : null;
  return {
    sourceTok: sourceTok ?? token,
    targetTok: sourceTok ? token : null,
    heldName:  state.sourceName ?? "source",
  };
}

async function _onTractorRelease(token, { announce }) {
  const pair = _resolveTractorPair(token);
  if (!pair) return;

  try {
    await applyTractorBeamRelease(pair.sourceTok, pair.targetTok, { announce });
  } catch (err) {
    console.error("STA2e Toolkit | GM tractor release failed:", err);
    ui.notifications.error("Tractor release failed — see console.");
  }
}

async function _onCloakToggle(token, { announce }) {
  const actor = token.actor;
  if (!actor) return;

  try {
    // No roll, no officer gate, and no Reserve Power cost — this is the GM path.
    if (_isCloaked(token)) await applyCloakDeactivateForOfficer(actor, token, { announce });
    else                   await applyCloakEngage(actor, token, { announce });
  } catch (err) {
    console.error("STA2e Toolkit | GM cloak toggle failed:", err);
    ui.notifications.error("Cloak toggle failed — see console.");
  }
}

/**
 * Build one palette row. `onClick` receives the click event so handlers can read
 * `shiftKey` for the announce-in-chat modifier.
 */
function _buildItem({ icon, label, tooltip, danger = false }, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sta2e-ship-command-item";
  if (danger) btn.classList.add("danger");
  btn.dataset.tooltip = tooltip;
  btn.innerHTML = `<i class="${icon}"></i><span>${label}</span>`;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return btn;
}

/**
 * Build the flyout contents for the token's current state. Rebuilt after every
 * stateful action so Engage/Release labels flip without reopening the HUD.
 */
function _buildPalette(app, token, control) {
  const palette = document.createElement("div");
  palette.className = "sta2e-ship-command-palette";
  // Clicks inside the flyout must never reach the HUD behind it.
  palette.addEventListener("click", (event) => event.stopPropagation());

  const rebuild = () => {
    // The HUD may have closed while the action was running.
    if (!control.isConnected || !palette.isConnected) return;
    const fresh = _buildPalette(app, token, control);
    fresh.style.top = palette.style.top;
    palette.replaceWith(fresh);
  };

  palette.appendChild(_buildItem({
    icon:    "fas fa-forward-fast",
    label:   "Warp Jump",
    tooltip: "Pick a destination and warp there",
  }, () => _onWarpJump(app, token)));

  palette.appendChild(_buildItem({
    icon:    "fas fa-right-from-bracket",
    label:   "Warp Out",
    tooltip: "Warp off the map — removes the token from this scene",
    danger:  true,
  }, () => _onWarpOut(app, token)));

  const pair = _resolveTractorPair(token);
  if (pair) {
    const isProjector = pair.sourceTok === token;
    palette.appendChild(_buildItem({
      icon:    "fas fa-link-slash",
      label:   isProjector ? `Release: ${pair.heldName}` : `Break Free: ${pair.heldName}`,
      tooltip: isProjector
        ? `Drop the tractor lock on ${pair.heldName}${SHIFT_HINT}`
        : `Clear the tractor lock ${pair.heldName} has on this ship${SHIFT_HINT}`,
      danger:  true,
    }, async (event) => {
      await _onTractorRelease(token, { announce: event.shiftKey });
      rebuild();
    }));
  } else {
    palette.appendChild(_buildItem({
      icon:    "fas fa-link",
      label:   "Tractor: Lock Beam",
      tooltip: `Lock the targeted ship — visual only, it is not moved${SHIFT_HINT}`,
    }, async (event) => {
      await _onTractorLock(token, { towTarget: false, announce: event.shiftKey });
      rebuild();
    }));

    palette.appendChild(_buildItem({
      icon:    "fas fa-link",
      label:   "Tractor: Lock & Tow",
      tooltip: `Lock the targeted ship and attach it so it follows this one${SHIFT_HINT}`,
    }, async (event) => {
      await _onTractorLock(token, { towTarget: true, announce: event.shiftKey });
      rebuild();
    }));
  }

  if (hasCloakingDevice(token.actor)) {
    const cloaked = _isCloaked(token);
    palette.appendChild(_buildItem({
      icon:    cloaked ? "fas fa-eye" : "fas fa-eye-slash",
      label:   cloaked ? "Cloak: Disengage" : "Cloak: Engage",
      tooltip: cloaked
        ? `Decloak — reveals the token${SHIFT_HINT}`
        : `Cloak — no roll, no Reserve Power cost${SHIFT_HINT}`,
      danger:  cloaked,
    }, async (event) => {
      await _onCloakToggle(token, { announce: event.shiftKey });
      rebuild();
    }));
  }

  return palette;
}

/**
 * The flyout is a sibling of the control, not a child: the control is a
 * `<button>` in v13+, and nesting the palette's buttons inside it would be
 * invalid markup with unreliable hit-testing. It is positioned against the
 * column instead, aligned to the control's own offset.
 */
function _togglePalette(app, token, control) {
  const column   = control.parentElement;
  if (!column) return;
  const existing = column.querySelector(".sta2e-ship-command-palette");
  if (existing) {
    existing.remove();
    control.classList.remove("active");
    return;
  }
  const palette = _buildPalette(app, token, control);
  palette.style.top = `${control.offsetTop}px`;
  column.appendChild(palette);
  control.classList.add("active");
}

function _injectShipCommand(app, html) {
  if (!game.user?.isGM) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".sta2e-ship-command")) return;

  const token = _resolveToken(app);
  if (!token || !isShipActor(token.actor)) return;

  const column = root.querySelector(".col.right") ?? root.querySelector(".col.left");
  if (!column) return;
  const sibling = column.querySelector(".control-icon");

  const control = _buildControl(sibling, {
    cssClass: "sta2e-ship-command",
    img:      ARROWHEAD,
    tooltip:  "Ship Command (GM)",
  });
  control.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    _togglePalette(app, token, control);
  });
  column.appendChild(control);
}

/** Register the HUD hook. Call once from main.js init. */
export function registerShipCommandHud() {
  Hooks.on("renderTokenHUD", _injectShipCommand);
}
