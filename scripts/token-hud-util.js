/**
 * sta2e-toolkit | token-hud-util.js
 *
 * Shared plumbing for the module's Token HUD control — the toolkit menu in
 * token-toolkit-hud.js and the sections it hosts. It adds one control to the
 * HUD's right column that opens a flyout, working around the same two Foundry
 * quirks as ever: the control element type changed between versions, and the
 * flyout cannot be a child of the control.
 *
 * A leaf: the sections import `buildHudItem` from here, so nothing in this file
 * may import the host back.
 *
 * Styling for the shell lives in styles/token-hud-flyout.css, keyed off the
 * `sta2e-hud-control` / `sta2e-hud-flyout` / `sta2e-hud-item` classes applied
 * here.
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
 * @param {string} cssClass  Feature-specific class, e.g. "sta2e-toolkit-hud-palette".
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
 * The "only one flyout at a time" sweep below was the one hazard for a nested
 * menu, and the toolkit menu sidesteps it by never opening a second panel — it
 * navigates by replacing the one it has. See token-toolkit-hud.js.
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

/**
 * Build one flyout row — the `.sta2e-hud-item` shared by every section.
 *
 * Lifted here from ship-command-hud.js and q-hud.js, which carried byte-identical
 * copies. It lives in this leaf rather than in token-toolkit-hud.js because the
 * sections are imported *by* that host, and importing the row builder back out of
 * it would close a cycle.
 *
 * Labels are written with `textContent`, not interpolated into `innerHTML`: they
 * carry token and actor names ("Release: <name>"), which are user-supplied.
 *
 * @param {{icon: string, label: string, tooltip?: string, danger?: boolean,
 *          extraClass?: string}} options
 * @param {Function} onClick  Receives the click event, so handlers can read
 *                            `shiftKey` for the announce-in-chat modifier.
 * @returns {HTMLButtonElement}
 */
export function buildHudItem({ icon, label, tooltip, danger = false, extraClass = "" }, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sta2e-hud-item";
  if (danger) btn.classList.add("danger");
  for (const cls of extraClass.split(" ").filter(Boolean)) btn.classList.add(cls);
  if (tooltip) btn.dataset.tooltip = tooltip;

  const i = document.createElement("i");
  i.className = icon;
  const span = document.createElement("span");
  span.textContent = label;
  btn.append(i, span);

  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return btn;
}
