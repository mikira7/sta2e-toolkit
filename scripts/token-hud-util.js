/**
 * sta2e-toolkit | token-hud-util.js
 *
 * Shared plumbing for the module's Token HUD injections — ship-command-hud.js
 * and token-weapon-hud.js. Both add a control to the HUD's right column that
 * opens a flyout, and both have to work around the same two Foundry quirks:
 * the control element type changed between versions, and the flyout cannot be
 * a child of the control.
 *
 * Styling for the shell lives in styles/token-hud-flyout.css, keyed off the
 * `sta2e-hud-control` / `sta2e-hud-flyout` classes applied here.
 */

/**
 * Build a HUD control by cloning an existing sibling, so the markup matches
 * whatever element type this Foundry version uses (`<button class="control-icon">`
 * in v13+, `<div class="control-icon">` before that).
 *
 * @param {Element|null} sibling  An existing `.control-icon` to clone, if any.
 * @param {{cssClass: string, icon?: string, img?: string, tooltip: string}} options
 * @returns {Element}
 */
export function buildHudControl(sibling, { cssClass, icon, img, tooltip }) {
  const el = sibling
    ? sibling.cloneNode(false)
    : document.createElement("button");
  el.className = "control-icon";
  el.classList.add("sta2e-hud-control", cssClass);
  el.classList.remove("active");
  el.removeAttribute("data-action");
  if (el.tagName === "BUTTON") el.type = "button";
  el.dataset.tooltip = tooltip;
  el.setAttribute("aria-label", tooltip);
  el.innerHTML = img ? `<img src="${img}" alt="">` : `<i class="${icon}"></i>`;
  return el;
}

/** Resolve the Token this HUD application is rendering for. */
export function resolveHudToken(app) {
  const obj = app?.object ?? app?.document?.object ?? null;
  if (obj?.document) return obj;
  const id = app?.document?.id ?? app?.object?.id ?? null;
  return id ? (canvas.tokens?.get(id) ?? null) : null;
}

/**
 * Create an empty flyout element. Clicks inside it must never reach the HUD
 * behind it, so they stop here.
 *
 * @param {string} cssClass  Feature-specific class, e.g. "sta2e-ship-command-palette".
 */
export function buildHudFlyout(cssClass) {
  const flyout = document.createElement("div");
  flyout.className = `sta2e-hud-flyout ${cssClass}`;
  flyout.addEventListener("click", (event) => event.stopPropagation());
  return flyout;
}

/**
 * Open or close a control's flyout.
 *
 * The flyout is a sibling of the control, not a child: the control is a
 * `<button>` in v13+, and nesting the flyout's own buttons inside it would be
 * invalid markup with unreliable hit-testing. It is positioned against the
 * column instead, aligned to the control's own offset.
 *
 * @param {Element}  control
 * @param {string}   cssClass    The flyout's feature-specific class.
 * @param {Function} buildFlyout Returns the flyout element to open.
 */
export function toggleHudFlyout(control, cssClass, buildFlyout) {
  const column = control.parentElement;
  if (!column) return;
  const existing = column.querySelector(`.${cssClass}`);
  if (existing) {
    existing.remove();
    control.classList.remove("active");
    return;
  }
  // Only one flyout at a time — two open at once would overlap, since both are
  // positioned against the same column edge.
  for (const other of column.querySelectorAll(".sta2e-hud-flyout")) other.remove();
  for (const other of column.querySelectorAll(".sta2e-hud-control.active")) {
    other.classList.remove("active");
  }

  const flyout = buildFlyout();
  flyout.style.top = `${control.offsetTop}px`;
  column.appendChild(flyout);
  control.classList.add("active");
}
