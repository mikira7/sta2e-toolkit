/**
 * sta2e-toolkit | art-browser.js
 *
 * A searchable thumbnail grid over the world's art folder, for filling an
 * Appearance slot — the part of Token Variant Art people actually used.
 *
 * It is an EDITING tool only. Nothing at spawn time browses a folder any more
 * (see appearance-data.js), so the index can be slow to build and is simply
 * cached for the session, keyed by root, with a Refresh key.
 *
 *   const path = await pickArt({ slot: "token", query: "klingon" });
 *
 * Resolves the chosen path, or null if the window was closed.
 */

import { classifyImage, parseKeywords } from "./appearance-data.js";
import { getLcCssVars } from "./lcars-theme.js";
import { browseFolder, childLocation } from "./file-storage.js";

const MODULE = "sta2e-toolkit";
const IMAGE_EXT = /\.(webp|png|jpe?g|gif|svg|avif|webm)$/i;
const MAX_DIRS = 2000;     // a runaway tree (a whole Data root) stops here
const MAX_SHOWN = 240;     // thumbnails rendered at once — refine the search past this

const _cache = new Map();  // root -> Promise<string[]>

function _FP() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
}

function _esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Every image under `root`, breadth first, capped at MAX_DIRS folders. The
 * walk stays in whichever storage the root was found in (local data, the
 * Forge Assets Library, an S3 bucket) — see file-storage.js.
 */
async function _index(root) {
  const files = [];
  const queue = [root];
  let seen = 0;
  while (queue.length && seen < MAX_DIRS) {
    const dir = queue.shift();
    seen++;
    try {
      const res = await browseFolder(dir);
      for (const f of res?.files ?? []) if (IMAGE_EXT.test(f.split(/[?#]/)[0])) files.push(f);
      for (const d of res?.dirs ?? []) queue.push(childLocation(res.loc, d));
    } catch (err) {
      console.warn(`STA2e Toolkit | Art browser could not read "${dir?.target ?? dir}"`, err);
    }
  }
  if (queue.length) {
    ui.notifications.warn(`Art library: stopped after ${MAX_DIRS} folders — point the Art Library Folder setting at a narrower folder.`);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/** The image list under a root, built once per session. */
export function artIndex(root, { refresh = false } = {}) {
  const key = root ?? "";
  if (refresh || !_cache.has(key)) {
    const p = _index(key).catch((err) => { _cache.delete(key); throw err; });
    _cache.set(key, p);
  }
  return _cache.get(key);
}

/** Every image directly inside one folder (not recursive) — for folder fill. */
export async function listFolderImages(dir) {
  try {
    const res = await browseFolder(dir);
    return (res?.files ?? []).filter(f => IMAGE_EXT.test(f.split(/[?#]/)[0]));
  } catch (err) {
    console.warn(`STA2e Toolkit | Could not read folder "${dir}"`, err);
    return [];
  }
}

/** Ask for a folder with core's FilePicker. Resolves the path or null. */
export function pickFolder(current = "") {
  return new Promise((resolve) => {
    let done = false;
    const fp = new (_FP())({
      type:     "folder",
      current,
      callback: (path) => { done = true; resolve(path || null); },
    });
    fp.render(true);
    // FilePicker has no "cancelled" callback; resolve null when it closes unpicked.
    const origClose = fp.close.bind(fp);
    fp.close = async (...args) => { const r = await origClose(...args); if (!done) resolve(null); return r; };
  });
}

/** Ask for one image with core's FilePicker. Resolves the path or null. */
export function pickImageFile(current = "") {
  return new Promise((resolve) => {
    let done = false;
    const fp = new (_FP())({
      type:     "imagevideo",
      current,
      callback: (path) => { done = true; resolve(path || null); },
    });
    fp.render(true);
    const origClose = fp.close.bind(fp);
    fp.close = async (...args) => { const r = await origClose(...args); if (!done) resolve(null); return r; };
  });
}

function _keywords() {
  const get = (k, d) => { try { return parseKeywords(game.settings.get(MODULE, k)); } catch { return d; } };
  return {
    tokenKeywords:    get("appearanceTokenKeywords", ["token"]),
    portraitKeywords: get("appearancePortraitKeywords", ["portrait"]),
  };
}

class ArtBrowserApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["sta2e-art-browser"],
    tag:     "section",
    window:  { title: "Art Library", resizable: true, icon: "fas fa-images" },
    position: { width: 760, height: 640 },
  };

  constructor({ slot = "all", query = "", resolve } = {}, options = {}) {
    super(options);
    this._filter  = slot === "token" || slot === "portrait" ? slot : "all";
    this._query   = query;
    this._resolve = resolve;
    this._picked  = false;
    this._root    = (() => { try { return game.settings.get(MODULE, "appearanceArtRoot") ?? ""; } catch { return ""; } })();
    this._files   = null;
    this._loading = false;
  }

  async _load(refresh = false) {
    this._loading = true;
    this.render();
    try { this._files = await artIndex(this._root, { refresh }); }
    catch { this._files = []; }
    this._loading = false;
    this.render();
  }

  _matches() {
    const words = this._query.toLowerCase().split(/\s+/).filter(Boolean);
    const kw = _keywords();
    const out = [];
    for (const f of this._files ?? []) {
      const lower = decodeURIComponent(f).toLowerCase();
      if (!words.every(w => lower.includes(w))) continue;
      if (this._filter !== "all") {
        const cls = classifyImage(f, kw);
        // Unmarked files count for both slots — most art carries no keyword.
        if (cls && cls !== this._filter) continue;
      }
      out.push(f);
    }
    return out;
  }

  async _renderHTML() {
    const matches = this._files ? this._matches() : [];
    const shown = matches.slice(0, MAX_SHOWN);
    const tab = (id, label) =>
      `<button type="button" class="sta2e-ab-tab ${this._filter === id ? "is-active" : ""}" data-filter="${id}">${label}</button>`;
    const grid = this._loading || !this._files
      ? `<div class="sta2e-ab-empty"><i class="fas fa-spinner fa-spin"></i> Indexing ${_esc(this._root || "the Data folder")}…</div>`
      : !shown.length
        ? `<div class="sta2e-ab-empty">No images match.</div>`
        : shown.map(f => {
            const name = decodeURIComponent(f.split("/").pop());
            const video = /\.webm$/i.test(f);
            return `<button type="button" class="sta2e-ab-cell" data-path="${_esc(f)}" data-tooltip="${_esc(decodeURIComponent(f))}">
              ${video ? `<video src="${_esc(f)}" muted loop autoplay playsinline></video>` : `<img src="${_esc(f)}" loading="lazy" alt="">`}
              <span>${_esc(name)}</span>
            </button>`;
          }).join("");
    const more = matches.length > shown.length
      ? `<div class="sta2e-ab-more">Showing ${shown.length} of ${matches.length} — type more to narrow it down.</div>` : "";
    return `
      <div class="sta2e-ab" style="${getLcCssVars("ab")}">
        <div class="sta2e-ab-bar">
          <input type="search" class="sta2e-ab-search" placeholder="Search file names…" value="${_esc(this._query)}" autocomplete="off">
          <div class="sta2e-ab-tabs">${tab("all", "All")}${tab("token", "Token")}${tab("portrait", "Portrait")}</div>
        </div>
        <div class="sta2e-ab-root">
          <span><i class="fas fa-folder"></i> ${_esc(this._root || "(Data root)")}</span>
          <button type="button" data-action="ab-folder" data-tooltip="Browse a different folder this session"><i class="fas fa-folder-open"></i></button>
          <button type="button" data-action="ab-refresh" data-tooltip="Re-index (after adding new art)"><i class="fas fa-rotate"></i></button>
        </div>
        <div class="sta2e-ab-grid">${grid}</div>
        ${more}
      </div>`;
  }

  _replaceHTML(result, element) {
    const content = element.querySelector(".window-content") ?? element;
    const hadFocus = content.querySelector(".sta2e-ab-search") === document.activeElement;
    const caret = hadFocus ? content.querySelector(".sta2e-ab-search").selectionStart : null;
    content.innerHTML = result;
    if (hadFocus) {
      const input = content.querySelector(".sta2e-ab-search");
      input.focus();
      if (caret !== null) input.setSelectionRange(caret, caret);
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const el = this.element;
    let t = null;
    el.addEventListener("input", (ev) => {
      if (!ev.target.matches(".sta2e-ab-search")) return;
      this._query = ev.target.value;
      clearTimeout(t);
      t = setTimeout(() => this.render(), 180);
    });
    el.addEventListener("click", async (ev) => {
      const cell = ev.target.closest(".sta2e-ab-cell");
      if (cell) {
        this._picked = true;
        this._resolve?.(cell.dataset.path);
        this.close();
        return;
      }
      const tab = ev.target.closest(".sta2e-ab-tab");
      if (tab) { this._filter = tab.dataset.filter; this.render(); return; }
      const act = ev.target.closest("[data-action]")?.dataset.action;
      if (act === "ab-refresh") this._load(true);
      if (act === "ab-folder") {
        const dir = await pickFolder(this._root);
        if (dir !== null) { this._root = dir; this._files = null; this._load(); }
      }
    });
    this._load();
  }

  async close(options) {
    if (!this._picked) this._resolve?.(null);
    this._picked = true;
    return super.close(options);
  }
}

/**
 * Open the browser. Resolves a path, or null if closed without picking.
 * @param {{slot?: "token"|"portrait"|"all", query?: string}} [opts]
 */
export function pickArt({ slot = "all", query = "" } = {}) {
  return new Promise((resolve) => {
    new ArtBrowserApp({ slot, query, resolve }).render(true);
  });
}
