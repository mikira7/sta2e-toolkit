/**
 * sta2e-toolkit | spawn-window.js
 *
 * The single GM spawn window — one draggable LCARS console with a tab per
 * spawner. It owns the chrome and nothing else: each tab supplies its own two
 * content columns, its wiring and its rail keys through a descriptor.
 *
 * The console is an LCARS frame — a gold bar across the top and the bottom, a
 * central control rail rising between them carrying the tab keys and the action
 * keys, and a content column either side.
 *
 * The two bands are SVG masks (assets/spawn-frame-*.svg) painted with the era's
 * primary, not shapes built out of elements — so this file creates one div per
 * band and nothing else. Everything else's shape lives in
 * styles/spawn-window.css; the only thing written inline is colour, as the
 * custom properties getLcCssVars("sw") emits (and never at module load — the
 * theme follows the active campaign).
 *
 * ── The rail is injected per panel, not owned once by the chrome ────────────
 * `wire(panel, api)` and `onActivate(panel, api)` both take a single scope and
 * query inside it. Splitting the two columns into chrome-owned containers
 * would hand each tab two disjoint roots and break every `panel.querySelector`
 * in transporter.js, q-spawner.js and ship-spawner.js. So the panel itself is
 * the three-column grid, and the chrome inserts its rail between the two
 * `.sw-col` children that `buildHTML()` returned.
 *
 * ── Scrolling ──────────────────────────────────────────────────────────────
 * The height cap is on `.sw-body` and the scrolling is strictly inside
 * `.sw-col`. The rail is a grid sibling of the columns, so it stretches to full
 * body height for free. Never put `overflow` on `.sw-body` or on the panel: it
 * would scroll the rail away with the content, which is the problem
 * task-maker.css has to paint its spine as a background to avoid.
 *
 * All panels stay in the DOM once built and are toggled with `hidden`, so
 * switching tabs never costs the GM a half-assembled queue.
 */

import { getLcCssVars, getActiveLcThemeKey } from "./lcars-theme.js";
import { clampHudPos, onViewportResize } from "./hud-position.js";
import { swKey, swDeco } from "./spawn-chrome.js";

const MODULE      = "sta2e-toolkit";
const WINDOW_ID   = "sta2e-spawn-window";
const PREF_KEY    = "spawnWindowPrefs";
const PREF_DEFAULTS = { activeTab: "transporter", pos: null, transporterLocation: "canvas" };

/**
 * Tab descriptors, in strip order.
 *
 * @typedef {object} SpawnTab
 * @property {string}   id
 * @property {string}   label          Fills the title cap and the rail's tab key
 * @property {string}   icon           Font Awesome class
 * @property {() => string} [styles]   One-off <style> markup, injected once
 * @property {() => string} [meta]     Short text for the top arm (a stardate, say)
 * @property {() => Promise<string>|string} buildHTML
 *   Must return exactly two children — `.sw-col.sw-col--left` then
 *   `.sw-col.sw-col--right`. Use swColumns() from spawn-chrome.js.
 * @property {(panel: HTMLElement, api: SpawnWindowApi) => void} [wire]
 *   Once, when the window is built.
 * @property {(panel: HTMLElement, api: SpawnWindowApi) => void} [onActivate]
 *   Every time this tab comes to the front — the scene may have changed under it.
 * @property {(panel: HTMLElement, api: SpawnWindowApi) => HTMLElement[]} [buildActions]
 *   The tab's rail keys, top to bottom. It must NOT emit a Close key: the
 *   chrome appends one to every rail itself.
 *
 * Note there is no `width`. Every tab is the same width, which is what stopped
 * the window jumping on a tab switch; `--sw-width` in the stylesheet owns it.
 */
const _tabs = new Map();

/** Register a tab. Called at module load by each spawner. */
export function registerSpawnTab(tab) {
  _tabs.set(tab.id, tab);
}

// ── Preferences ───────────────────────────────────────────────────────────────

function getPrefs() {
  try { return { ...PREF_DEFAULTS, ...(game.settings.get(MODULE, PREF_KEY) ?? {}) }; }
  catch { return { ...PREF_DEFAULTS }; }
}

function setPrefs(patch) {
  try { game.settings.set(MODULE, PREF_KEY, { ...getPrefs(), ...patch }); }
  catch { /* setting not registered — the window simply does not remember */ }
}

/**
 * Read/write one window-level preference.
 *
 * Exposed so a tab can persist a scrap of state without registering a setting
 * of its own — the transporter's beam site, for instance. Writes merge, so two
 * tabs cannot clobber each other's keys.
 */
export function getSpawnPref(key, fallback = null) {
  const value = getPrefs()[key];
  return value === undefined ? fallback : value;
}

export function setSpawnPref(key, value) {
  setPrefs({ [key]: value });
}

// ── Frame pieces ──────────────────────────────────────────────────────────────

const el = (cls, tag = "div") => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
};

/**
 * The window header — the module's usual floating-panel strip: filled primary,
 * black uppercase title, a close button, and a grab handle. Same construction
 * as scene-warp-panel.js and the other draggable panels.
 *
 * It carries the window's identity and the artwork's title cap carries the
 * active tab, rather than both saying the same thing.
 */
function buildHeader(onClose) {
  const header = el("sw-header");

  const title = el("sw-header-title", "span");
  title.textContent = "Spawn Window";

  const close = el("sw-header-close", "button");
  close.type = "button";
  close.title = "Close";
  close.textContent = "×";
  close.addEventListener("click", e => { e.stopPropagation(); onClose(); });

  header.append(title, close);
  return { header, close };
}

/**
 * The two frame bands.
 *
 * Each is a single element; its shape comes from an SVG mask in assets/, not
 * from markup — see the header of styles/spawn-window.css. So there are no
 * segment elements here, only the two labels that ride on top of the top band.
 */
function buildTopBand() {
  const top  = el("sw-top");
  const meta = el("sw-top-meta", "span");
  const cap  = el("sw-title-cap", "span");
  top.append(meta, cap);
  return { top, cap, meta };
}

function buildBottomBar() {
  const bottom = el("sw-bottom");
  bottom.setAttribute("aria-hidden", "true");
  return bottom;
}

/**
 * One panel's rail: the tab keys, the tab's own action keys, Close, and the
 * decorative blocks that make the column read as a console rather than as a
 * row of buttons with a gap in it.
 *
 * Every panel gets its own rail, so the tab keys exist three times over. That
 * is why `activate()` sets `.is-active` across every rail rather than just the
 * visible one.
 */
function buildRail(order, onTab, onClose) {
  const rail  = el("sw-rail");
  const stack = el("sw-rail-stack");

  const tabs = el("sw-rail-tabs");
  for (const tabDef of order) {
    // No icon on a tab key: the rail is 70px wide and these carry the longest
    // labels in it, so the glyph is what would push "Transporter" to two lines.
    const key = swKey(tabDef.label, { className: "sw-key--tab", title: tabDef.label });
    key.dataset.tab = tabDef.id;
    key.addEventListener("click", () => onTab(tabDef.id));
    tabs.appendChild(key);
  }

  const actions = el("sw-rail-actions");

  const closeKey = swKey("Close", { icon: "fas fa-times", className: "sw-key--close" });
  closeKey.addEventListener("click", onClose);

  const tail = el("sw-rail-deco");
  tail.append(
    swDeco({ size: "sm", accent: "var(--sw-deco-c)" }),
    swDeco({ fill: true, accent: "var(--sw-secondary)" }),
  );

  stack.append(
    tabs,
    swDeco({ size: "xs" }),
    actions,
    swDeco({ size: "sm", accent: "var(--sw-deco-b)" }),
    closeKey,
    tail,
  );

  const side = el("sw-rail-side");
  side.setAttribute("aria-hidden", "true");
  side.append(
    swDeco({ size: "lg", accent: "var(--sw-secondary)" }),
    swDeco({ size: "md", accent: "var(--sw-tertiary)" }),
    swDeco({ size: "sm", accent: "var(--sw-deco-a)" }),
    swDeco({ fill: true, accent: "var(--sw-secondary)" }),
  );

  rail.append(stack, side);
  return rail;
}

// ── Window ────────────────────────────────────────────────────────────────────

export function getSpawnWindowEl() {
  return document.getElementById(WINDOW_ID);
}

export function closeSpawnWindow() {
  const node = getSpawnWindowEl();
  node?._sta2eCleanup?.();
  node?.remove();
}

/**
 * Open the spawn window, or bring an open one to the requested tab.
 *
 * @param {object} [opts]
 * @param {string} [opts.tab]  Tab id. Omitted means "wherever I left off".
 */
export async function openSpawnWindow({ tab } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can open the spawner.");
    return;
  }
  if (!_tabs.size) {
    ui.notifications.error("No spawner tabs are registered.");
    return;
  }

  const prefs  = getPrefs();
  const wanted = _tabs.has(tab) ? tab
               : _tabs.has(prefs.activeTab) ? prefs.activeTab
               : [..._tabs.keys()][0];

  // Already open — just switch tabs rather than rebuilding, so a queue survives
  // a second press of the hotkey.
  const existing = getSpawnWindowEl();
  if (existing) {
    existing._sta2eActivate?.(wanted);
    return;
  }

  const app = document.createElement("div");
  app.id        = WINDOW_ID;
  app.className = "sta2e-sw";
  app.dataset.theme = getActiveLcThemeKey();
  // Colour only. No geometry inline — see the header of styles/spawn-window.css.
  app.style.cssText = getLcCssVars("sw");
  app.style.top  = "80px";
  app.style.left = "50%";
  app.style.transform = "translateX(-50%)";

  const { header, close: headerClose } = buildHeader(() => closeSpawnWindow());
  const { top: titleBar, cap: titleCap, meta: titleMeta } = buildTopBand();
  const body      = el("sw-body");
  const styleHost = el("sw-styles");

  app.append(styleHost, header, titleBar, body, buildBottomBar());
  document.body.appendChild(app);

  // ── Drag to reposition ─────────────────────────────────────────────────────
  let dragging = false, dragOffX = 0, dragOffY = 0;

  const moveTo = (x, y) => {
    const clamped = clampHudPos(app, x, y);
    app.style.left      = `${clamped.x}px`;
    app.style.top       = `${clamped.y}px`;
    app.style.transform = "none";
    return clamped;
  };

  const onMouseMove = e => {
    if (!dragging) return;
    moveTo(e.clientX - dragOffX, e.clientY - dragOffY);
  };
  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    app.classList.remove("is-dragging");
    const rect = app.getBoundingClientRect();
    setPrefs({ pos: { x: rect.left, y: rect.top } });
  };

  // Both the header and the artwork band drag the window. The grabbing cursor
  // is flagged on the root rather than on one handle, so whichever you took
  // hold of shows it.
  for (const handle of [header, titleBar]) {
    handle.addEventListener("mousedown", e => {
      if (e.target === headerClose) return;
      dragging = true;
      const rect = app.getBoundingClientRect();
      dragOffX = e.clientX - rect.left;
      dragOffY = e.clientY - rect.top;
      app.classList.add("is-dragging");
    });
  }
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  const stopResizeWatch = onViewportResize(
    () => getSpawnWindowEl(),
    pos => setPrefs({ pos }),
  );

  app._sta2eCleanup = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    stopResizeWatch?.();
  };

  // ── API handed to each tab ─────────────────────────────────────────────────
  /**
   * @typedef {object} SpawnWindowApi
   * @property {() => void} close
   * @property {() => void} refreshActions       Rebuild the active tab's rail keys
   * @property {(fn: () => Promise<any>) => Promise<any>} hideWhile
   *   Run something with the window out of the way — canvas placement happens
   *   under where this panel sits.
   * @property {(tabId: string) => void} activate
   */
  const api = {
    close: () => closeSpawnWindow(),
    refreshActions: () => renderActions(),
    activate: id => activate(id),
    hideWhile: async fn => {
      app.style.visibility = "hidden";
      try { return await fn(); }
      finally { if (app.isConnected) app.style.visibility = ""; }
    },
  };

  // ── Build the panels ───────────────────────────────────────────────────────
  let activeId = null;
  const order = [..._tabs.values()];
  for (const tabDef of order) {
    if (typeof tabDef.styles === "function") {
      // styles() returns markup, not one stylesheet body — a tab may hand over
      // several <style> blocks — so it is parsed as HTML.
      const holder = document.createElement("div");
      holder.innerHTML = tabDef.styles();
      styleHost.append(...holder.childNodes);
    }

    const panel = el("sta2e-sw-panel");
    panel.dataset.tab = tabDef.id;
    panel.innerHTML = await tabDef.buildHTML();

    // The rail goes between the two columns the tab just returned. A tab that
    // forgot its right column would otherwise silently put the rail last.
    const rightCol = panel.querySelector(".sw-col--right");
    const rail = buildRail(order, id => activate(id), () => closeSpawnWindow());
    if (rightCol) panel.insertBefore(rail, rightCol);
    else {
      console.warn(`STA2e Toolkit | spawn tab "${tabDef.id}" built no .sw-col--right`);
      panel.appendChild(rail);
    }

    body.appendChild(panel);

    try { tabDef.wire?.(panel, api); }
    catch (err) { console.error(`STA2e Toolkit | spawn tab "${tabDef.id}" failed to wire:`, err); }
  }

  const panelFor = id => body.querySelector(`.sta2e-sw-panel[data-tab="${id}"]`);

  function renderActions() {
    const tabDef = _tabs.get(activeId);
    const panel  = panelFor(activeId);
    const slot   = panel?.querySelector(".sw-rail-actions");
    if (!slot) return;
    slot.replaceChildren();
    if (!tabDef?.buildActions) return;
    try { slot.append(...tabDef.buildActions(panel, api)); }
    catch (err) { console.error(`STA2e Toolkit | spawn tab "${activeId}" actions failed:`, err); }
  }

  function activate(id) {
    const tabDef = _tabs.get(id);
    if (!tabDef) return;
    activeId = id;
    app.dataset.tab = id;

    // Every panel carries its own rail, so the lit key has to be set in all of
    // them — not just the one on screen.
    for (const key of body.querySelectorAll(".sw-key--tab")) {
      key.classList.toggle("is-active", key.dataset.tab === id);
    }
    for (const panel of body.querySelectorAll(".sta2e-sw-panel")) {
      panel.hidden = panel.dataset.tab !== id;
    }

    titleCap.textContent  = tabDef.label;
    titleMeta.textContent = tabDef.meta?.() ?? "";
    renderActions();
    setPrefs({ activeTab: id });
    tabDef.onActivate?.(panelFor(id), api);
  }

  app._sta2eActivate = activate;
  activate(wanted);

  // Resolve the position to explicit pixels either way: the opening `left: 50%`
  // is only a starting point, and the resize clamp reads style.left as a number.
  if (prefs.pos && Number.isFinite(prefs.pos.x) && Number.isFinite(prefs.pos.y)) {
    moveTo(prefs.pos.x, prefs.pos.y);   // clamped, in case the viewport shrank since
  } else {
    const rect = app.getBoundingClientRect();
    moveTo(Math.round((window.innerWidth - rect.width) / 2), 80);
  }
}
