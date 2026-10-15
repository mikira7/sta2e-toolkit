/**
 * sta2e-toolkit | appearance-manager.js
 *
 * The GM's editor for an actor's Appearances library: its looks (token art +
 * portrait pairs), what a newly placed token wears, and the automatic rules
 * that switch looks when gear is worn or a condition lands.
 *
 * Layout, after Visage's gallery and editor:
 *
 *   header   actor identity · "New tokens get: Prototype | Default | Random"
 *   tabs     Looks | Automatic Looks
 *   Looks    card gallery (left) + a live editor stage for the selected look
 *   Rules    "WHEN <wearing|condition> <match>  →  SHOW <look>" cards, in
 *            priority order
 *
 * It edits a WORKING COPY and writes the flag once, on Save — a half-typed
 * name must not reach the canvas, and the `updateActor` hook re-evaluates
 * every token of the actor on each write. Typing and the scale slider patch
 * the DOM in place (re-rendering under the caret or a dragged thumb loses
 * it); structural changes re-render.
 *
 * Shape lives in styles/appearance.css; colour arrives as `--ap-*` custom
 * properties from `getLcCssVars`, the shape-in-CSS / colour-inline split the
 * card stylesheets use. No renderer here writes an inline `border-radius` or
 * `display` — the per-element accent rides on `--ap-a` only.
 */

import {
  MODULE, LIBRARY_FLAG, STATE_FLAG, WEARABLE_TYPES, normalizeLibrary, normalizeLook, newLookId,
  pairImages, looksFromVisage, parseKeywords, normalizeState, normalizeRing, ringFromToken,
  ringUpdates, rebaseVisual,
} from "./appearance-data.js";
import { saveAsWebp, isConvertible, formatBytes } from "./webp-convert.js";
import { pickArt, pickFolder, pickImageFile, listFolderImages } from "./art-browser.js";
import { getWildcardImages } from "./token-spawn-utils.js";
import { COMBAT_CONDITIONS } from "./token-conditions.js";
import { getLcCssVars } from "./lcars-theme.js";
import { openTokenMaker } from "./token-maker.js";

const _open = new Map();   // actor uuid -> app

const SCALE_MIN = 0.25;
const SCALE_MAX = 3;

/** The id the Original (prototype token + portrait) card goes by in the UI. */
const BASE_ID = "__base__";

function _esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function _isVideo(path) {
  return /\.(webm|mp4)$/i.test(String(path ?? ""));
}

/** An <img> or a muted looping <video>, for any art path. */
function _media(path, cls = "") {
  if (!path) return "";
  return _isVideo(path)
    ? `<video class="${cls}" src="${_esc(path)}" muted loop autoplay playsinline></video>`
    : `<img class="${cls}" src="${_esc(path)}" alt="" loading="lazy">`;
}

function _keywords() {
  const get = (k, d) => { try { return parseKeywords(game.settings.get(MODULE, k)); } catch { return d; } };
  return {
    tokenKeywords:    get("appearanceTokenKeywords", ["token"]),
    portraitKeywords: get("appearancePortraitKeywords", ["portrait"]),
  };
}

/** Core status effects plus the toolkit's own conditions, for the rule picker. */
function _statusChoices() {
  const out = [];
  for (const e of CONFIG.statusEffects ?? []) {
    if (!e?.id) continue;
    out.push({ id: e.id, label: game.i18n.localize(e.name ?? e.label ?? e.id), img: e.img ?? e.icon ?? "", group: "Status Effects" });
  }
  for (const [id, c] of Object.entries(COMBAT_CONDITIONS)) {
    out.push({ id, label: c.label, img: "", group: "Toolkit Conditions" });
  }
  return out;
}

/**
 * Visage's stored looks, read from the source data rather than `getFlag`:
 * `getFlag` throws for the scope of a module that is not active — which is
 * exactly when this import matters, after Visage has been switched off.
 */
function _visageLooks(actor) {
  return actor?._source?.flags?.visage?.alternateVisages ?? actor?.flags?.visage?.alternateVisages ?? null;
}

/** Image path out of whatever was dropped: a file, a tile, an actor, an item. */
async function _pathFromDrop(event) {
  let data = null;
  try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { /* plain text */ }
  if (!data) {
    const text = event.dataTransfer.getData("text/plain");
    return /\.(webp|png|jpe?g|gif|svg|avif|webm|mp4)$/i.test(text) ? text : null;
  }
  if (data.src) return data.src;
  if (data.texture?.src) return data.texture.src;
  if (data.uuid) {
    const doc = await fromUuid(data.uuid).catch(() => null);
    return doc?.img ?? doc?.texture?.src ?? null;
  }
  return null;
}

class AppearanceManagerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["sta2e-appearance-manager"],
    tag:     "section",
    window:  { resizable: true, icon: "fas fa-masks-theater" },
    position: { width: 940, height: 720 },
  };

  constructor(actor, options = {}) {
    super({ id: `sta2e-appearance-${actor.id}`, window: { title: `Appearances — ${actor.name}` }, ...options });
    this.actor = actor;
    this._lib = normalizeLibrary(foundry.utils.deepClone(actor.getFlag(MODULE, LIBRARY_FLAG) ?? {}));
    this._dirty = false;
    this._tab = "looks";
    // The Original: the prototype token and the sheet portrait, edited as one
    // more look-shaped working copy so every stage handler works on it as is.
    this._base = this._readBase();
    this._baseWas = foundry.utils.deepClone(this._base);
    this._sel = this._lib.looks[0]?.id ?? BASE_ID;
  }

  get _linked() {
    return !!this.actor.prototypeToken?.actorLink;
  }

  /**
   * The actor's original art. A linked character in a look has that look's
   * portrait on `actor.img`; its original portrait is in the state baseline.
   */
  _readBase() {
    const proto = this.actor.prototypeToken;
    const token = proto?.texture?.src ?? "";
    const st = this._linked ? normalizeState(this.actor.getFlag(MODULE, STATE_FLAG)) : null;
    const ring = ringFromToken(proto?.ring);
    // A subject naming the art itself is "follow the art", so new art is not
    // left inside a ring still showing the old picture.
    if (ring?.subjectTexture === token) ring.subjectTexture = "";
    return {
      id:       BASE_ID,
      name:     "Original",
      token,
      portrait: st?.baseline?.portrait || this.actor.img || "",
      scale:    Math.abs(Number(proto?.texture?.scaleX ?? 1)) || 1,
      ring,
      maker:    this._lib.baseMaker ?? null,
    };
  }

  _baseChanged() {
    const a = this._base, b = this._baseWas;
    return a.token !== b.token || a.portrait !== b.portrait || a.scale !== b.scale
      || JSON.stringify(normalizeRing(a.ring)) !== JSON.stringify(normalizeRing(b.ring));
  }

  _selected() {
    return this._lib.looks.find(l => l.id === this._sel) ?? this._lib.looks[0] ?? null;
  }

  _placement() {
    const lib = this._lib;
    if (lib.randomize && !this._linked) return "random";
    return lib.defaultLookId ? "default" : "proto";
  }

  /** Rules that point at a look — shown as chips on the card and the editor. */
  _rulesFor(lookId) {
    return this._lib.rules.filter(r => r.lookId === lookId && r.match);
  }

  _ruleLabel(rule) {
    if (rule.kind === "item") return `Wearing ${rule.match}`;
    const s = _statusChoices().find(c => c.id === rule.match);
    return s?.label ?? rule.match;
  }

  // ── Header ───────────────────────────────────────────────────────────────────

  _header() {
    const lib = this._lib;
    const place = this._placement();
    const seg = (id, icon, label, tip, disabled = false) => `
      <button type="button" class="sta2e-ap-seg-key ${place === id ? "is-active" : ""}" data-action="ap-place" data-place="${id}"
        data-tooltip="${_esc(tip)}" ${disabled ? "disabled" : ""}><i class="fas fa-${icon}"></i> ${label}</button>`;
    const randomTip = this._linked
      ? "A linked character keeps one look — switch it from the Token HUD."
      : "Every token placed rolls one of the looks that has token art";
    const def = lib.looks.find(l => l.id === lib.defaultLookId);
    return `
      <header class="sta2e-ap-head">
        <div class="sta2e-ap-id">
          <div class="sta2e-ap-id-portrait">${_media(this.actor.img)}</div>
          <div class="sta2e-ap-id-text">
            <h2>${_esc(this.actor.name)}</h2>
            <span>${lib.looks.length} look${lib.looks.length === 1 ? "" : "s"} · ${lib.rules.length} automatic${this._linked ? " · linked" : ""}</span>
          </div>
        </div>
        <div class="sta2e-ap-place">
          <span class="sta2e-ap-label">New tokens get</span>
          <div class="sta2e-ap-seg">
            ${seg("proto", "image", "Original", "The Original art — the prototype token, unchanged")}
            ${seg("default", "star", def ? _esc(def.name || "Default look") : "Default Look", "The look marked with the star", !lib.looks.length)}
            ${seg("random", "dice", "Random", randomTip, this._linked || !lib.looks.some(l => l.token))}
          </div>
        </div>
      </header>
      <nav class="sta2e-ap-tabs">
        <button type="button" class="sta2e-ap-tab ${this._tab === "looks" ? "is-active" : ""}" data-action="ap-tab" data-tab="looks">
          <i class="fas fa-masks-theater"></i> Looks <span class="sta2e-ap-pill">${lib.looks.length}</span>
        </button>
        <button type="button" class="sta2e-ap-tab ${this._tab === "rules" ? "is-active" : ""}" data-action="ap-tab" data-tab="rules">
          <i class="fas fa-bolt"></i> Automatic Looks <span class="sta2e-ap-pill">${lib.rules.length}</span>
        </button>
      </nav>`;
  }

  // ── Looks tab ────────────────────────────────────────────────────────────────

  _card(look) {
    const sel = this._sel !== BASE_ID && look.id === this._selected()?.id;
    const isDefault = look.id === this._lib.defaultLookId;
    const rules = this._rulesFor(look.id);
    const badges = [
      isDefault ? `<span class="sta2e-ap-badge is-star" data-tooltip="Default look"><i class="fas fa-star"></i></span>` : "",
      rules.length ? `<span class="sta2e-ap-badge is-auto" data-tooltip="${_esc(rules.map(r => this._ruleLabel(r)).join(" · "))}"><i class="fas fa-bolt"></i></span>` : "",
      look.scale ? `<span class="sta2e-ap-badge is-scale" data-tooltip="Scale">×${look.scale}</span>` : "",
      look.mimicked ? `<span class="sta2e-ap-badge is-mimic" data-tooltip="Stored from a Mimic — never rolled at random"><i class="fas fa-user-secret"></i></span>` : "",
      look.tokenName ? `<span class="sta2e-ap-badge is-name" data-tooltip="Token shows as: ${_esc(look.tokenName)}"><i class="fas fa-id-badge"></i></span>` : "",
      look.ring?.enabled ? `<span class="sta2e-ap-badge is-ring" data-tooltip="Dynamic ring" style="--ap-a:${look.ring.ringColor ?? "var(--ap-primary)"}"><i class="fas fa-ring"></i></span>` : "",
    ].join("");
    return `
      <button type="button" class="sta2e-ap-card ${sel ? "is-selected" : ""}" data-action="ap-select" data-look="${look.id}">
        <div class="sta2e-ap-card-stage">
          ${look.token ? _media(look.token, "sta2e-ap-card-token")
            : `<i class="fas fa-circle-user sta2e-ap-card-missing"></i>`}
          ${look.portrait ? `<div class="sta2e-ap-card-portrait">${_media(look.portrait)}</div>` : ""}
          <div class="sta2e-ap-badges">${badges}</div>
        </div>
        <div class="sta2e-ap-card-name" data-name-for="${look.id}">${_esc(look.name || "Unnamed look")}</div>
      </button>`;
  }

  /** The Original's card — always first, as Original Art is in the Token HUD. */
  _baseCard() {
    const b = this._base;
    const badges = [
      b.scale !== 1 ? `<span class="sta2e-ap-badge is-scale" data-tooltip="Scale">×${b.scale}</span>` : "",
      b.ring?.enabled ? `<span class="sta2e-ap-badge is-ring" data-tooltip="Dynamic ring" style="--ap-a:${b.ring.ringColor ?? "var(--ap-primary)"}"><i class="fas fa-ring"></i></span>` : "",
    ].join("");
    return `
      <button type="button" class="sta2e-ap-card is-base ${this._sel === BASE_ID ? "is-selected" : ""}" data-action="ap-select" data-look="${BASE_ID}"
        data-tooltip="What this character wears with no look on">
        <div class="sta2e-ap-card-stage">
          ${b.token ? _media(b.token, "sta2e-ap-card-token") : `<i class="fas fa-circle-user sta2e-ap-card-missing"></i>`}
          ${b.portrait ? `<div class="sta2e-ap-card-portrait">${_media(b.portrait)}</div>` : ""}
          <div class="sta2e-ap-badges">${badges}</div>
        </div>
        <div class="sta2e-ap-card-name"><i class="fas fa-user"></i> Original</div>
      </button>`;
  }

  /** Every token/portrait slot (the Original's included) holding a PNG or JPEG. */
  _convertibleSlots() {
    const out = [];
    for (const obj of [this._base, ...this._lib.looks]) {
      for (const slot of ["token", "portrait"]) if (isConvertible(obj[slot])) out.push({ obj, slot });
    }
    return out;
  }

  _gallery() {
    const lib = this._lib;
    const convertible = new Set(this._convertibleSlots().map(t => t.obj[t.slot])).size;
    const visage = _visageLooks(this.actor);
    const hasVisage = !!visage && Object.keys(visage).length > 0;
    const proto = this.actor.prototypeToken;
    const hasWildcard = !!proto?.randomImg && String(proto?.texture?.src ?? "").includes("*");
    return `
      <section class="sta2e-ap-gallery">
        <div class="sta2e-ap-toolbar">
          <button type="button" data-action="ap-add-look" class="is-primary"><i class="fas fa-plus"></i> New Look</button>
          <button type="button" data-action="ap-add-folder" data-tooltip="One look per image, pairing token and portrait files by name"><i class="fas fa-folder-plus"></i> Folder</button>
          ${hasWildcard ? `<button type="button" data-action="ap-import-wildcard" data-tooltip="Import from ${_esc(proto.texture.src)}"><i class="fas fa-dice"></i> Wildcard</button>` : ""}
          ${hasVisage ? `<button type="button" data-action="ap-import-visage" data-tooltip="Import this actor's Visage looks"><i class="fas fa-masks-theater"></i> Visage</button>` : ""}
          ${convertible ? `<button type="button" data-action="ap-webp-all" data-tooltip="Save a WebP copy of every PNG/JPEG token and portrait here (${convertible}) and use it instead — usually far smaller. The originals are left in place."><i class="fas fa-file-zipper"></i> WebP</button>` : ""}
        </div>
        <div class="sta2e-ap-grid">
          ${this._baseCard()}
          ${lib.looks.map(l => this._card(l)).join("")}
          <button type="button" class="sta2e-ap-card is-new" data-action="ap-add-look">
            <div class="sta2e-ap-card-stage"><i class="fas fa-plus"></i></div>
            <div class="sta2e-ap-card-name">New Look</div>
          </button>
        </div>
      </section>`;
  }

  _stage(look, slot) {
    const path = look[slot];
    const isToken = slot === "token";
    const scale = isToken ? (look.scale ?? 1) : 1;
    const ring = isToken && look.ring?.enabled
      ? `<div class="sta2e-ap-stage-ring" style="--ap-a:${look.ring.ringColor ?? "var(--ap-primary)"}" data-tooltip="Dynamic ring"></div>` : "";
    const empty = isToken && look.portrait
      ? `<div class="sta2e-ap-stage-empty"><i class="fas fa-wand-magic-sparkles"></i>
           <button type="button" class="sta2e-ap-make" data-action="ap-maker">Make token from portrait</button>
           <span>or drop token art here</span></div>`
      : `<div class="sta2e-ap-stage-empty"><i class="fas fa-${isToken ? "circle-user" : "image-portrait"}"></i><span>Drop ${isToken ? "token art" : "a portrait"} here</span></div>`;
    return `
      <figure class="sta2e-ap-stage is-${slot} ${path ? "has-art" : ""}" data-slot="${slot}" data-look="${look.id}">
        <div class="sta2e-ap-stage-view">
          ${path ? `<div class="sta2e-ap-stage-art" style="--ap-scale:${scale}">${_media(path)}</div>${ring}` : empty}
        </div>
        <figcaption>
          <span>${isToken ? "Token" : "Portrait"}</span>
          <span class="sta2e-ap-stage-keys">
            ${isToken ? `<button type="button" data-action="ap-maker" data-tooltip="${look.maker ? "Edit in the Token Maker" : "Token Maker — make this token from a portrait"}"><i class="fas fa-wand-magic-sparkles"></i></button>` : ""}
            ${isConvertible(path) ? `<button type="button" data-action="ap-webp" data-tooltip="Convert to WebP — saves a smaller copy beside it and uses that"><i class="fas fa-file-zipper"></i></button>` : ""}
            <button type="button" data-action="ap-browse" data-tooltip="Art library"><i class="fas fa-images"></i></button>
            <button type="button" data-action="ap-file" data-tooltip="File picker"><i class="fas fa-folder-open"></i></button>
            ${path && look.id !== BASE_ID ? `<button type="button" data-action="ap-clear" data-tooltip="Clear"><i class="fas fa-xmark"></i></button>` : ""}
          </span>
        </figcaption>
      </figure>`;
  }

  /** The Original's editor: the two stages and the scale, nothing look-specific. */
  _baseEditor() {
    const b = this._base;
    const proto = this.actor.prototypeToken;
    const wildcard = !!proto?.randomImg && String(proto?.texture?.src ?? "").includes("*");
    return `
      <section class="sta2e-ap-editor is-base" data-look="${BASE_ID}">
        <div class="sta2e-ap-editor-head">
          <h3 class="sta2e-ap-base-title"><i class="fas fa-user"></i> Original</h3>
        </div>
        <p class="sta2e-ap-muted">What ${_esc(this.actor.name)} wears with no look on — the prototype token and the sheet portrait. Saving updates placed tokens still showing the old original art.</p>
        ${wildcard ? `<p class="sta2e-ap-muted"><i class="fas fa-dice"></i> The prototype rolls from a wildcard; setting a token here replaces it.</p>` : ""}
        <div class="sta2e-ap-stages">
          ${this._stage(b, "token")}
          ${this._stage(b, "portrait")}
        </div>
        <div class="sta2e-ap-scale">
          <span class="sta2e-ap-label">Token scale</span>
          <input type="range" data-field="scale" min="${SCALE_MIN}" max="${SCALE_MAX}" step="0.05" value="${b.scale}">
          <output data-scale-out>×${b.scale}</output>
          <button type="button" data-action="ap-scale-reset" ${b.scale === 1 ? "disabled" : ""} data-tooltip="Back to ×1"><i class="fas fa-rotate-left"></i></button>
        </div>
      </section>`;
  }

  _editor() {
    if (this._sel === BASE_ID) return this._baseEditor();
    const look = this._selected();
    if (!look) {
      return `
        <section class="sta2e-ap-editor is-empty">
          <i class="fas fa-masks-theater"></i>
          <h3>No looks yet</h3>
          <p>Make a look for each outfit or face: token art for the map, a portrait for the sheet. Fill several at once from a folder whose files are named like <code>Name_token</code> / <code>Name_portrait</code>.</p>
        </section>`;
    }
    const lib = this._lib;
    const idx = lib.looks.indexOf(look);
    const isDefault = look.id === lib.defaultLookId;
    const rules = this._rulesFor(look.id);
    const scale = look.scale ?? 1;
    return `
      <section class="sta2e-ap-editor" data-look="${look.id}">
        <div class="sta2e-ap-editor-head">
          <input type="text" class="sta2e-ap-name" data-field="name" value="${_esc(look.name)}" placeholder="Name this look">
          <div class="sta2e-ap-keys">
            <button type="button" data-action="ap-default" class="${isDefault ? "is-on" : ""}" data-tooltip="${isDefault ? "Default look" : "Make this the default look"}"><i class="fas fa-star"></i></button>
            <button type="button" data-action="ap-up" ${idx === 0 ? "disabled" : ""} data-tooltip="Move earlier"><i class="fas fa-arrow-left"></i></button>
            <button type="button" data-action="ap-down" ${idx === lib.looks.length - 1 ? "disabled" : ""} data-tooltip="Move later"><i class="fas fa-arrow-right"></i></button>
            <button type="button" data-action="ap-dup" data-tooltip="Duplicate"><i class="fas fa-clone"></i></button>
            <button type="button" data-action="ap-del-look" class="is-danger" data-tooltip="Delete look"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <label class="sta2e-ap-tokenname" data-tooltip="Renames the token while this look is on — the character's sheet keeps its name. Blank keeps the token's own name.">
          <span class="sta2e-ap-label">Name on token</span>
          <input type="text" data-field="tokenName" value="${_esc(look.tokenName)}" placeholder="Keep the token's own name">
        </label>
        <div class="sta2e-ap-stages">
          ${this._stage(look, "token")}
          ${this._stage(look, "portrait")}
        </div>
        <div class="sta2e-ap-scale">
          <span class="sta2e-ap-label">Token scale</span>
          <input type="range" data-field="scale" min="${SCALE_MIN}" max="${SCALE_MAX}" step="0.05" value="${scale}" class="${look.scale ? "" : "is-keep"}">
          <output data-scale-out>${look.scale ? `×${look.scale}` : "Keep"}</output>
          <button type="button" data-action="ap-scale-reset" ${look.scale ? "" : "disabled"} data-tooltip="Keep the token's own scale"><i class="fas fa-rotate-left"></i></button>
        </div>
        <div class="sta2e-ap-used">
          <span class="sta2e-ap-label">Shown automatically</span>
          ${rules.length
            ? rules.map(r => `<button type="button" class="sta2e-ap-chip" data-action="ap-tab" data-tab="rules"><i class="fas fa-${r.kind === "item" ? "shirt" : "heart-pulse"}"></i> ${_esc(this._ruleLabel(r))}</button>`).join("")
            : `<span class="sta2e-ap-muted">Never — pick it from the Token HUD, or add a rule.</span>`}
          <button type="button" class="sta2e-ap-chip is-add" data-action="ap-rule-for"><i class="fas fa-plus"></i> Rule</button>
        </div>
      </section>`;
  }

  // ── Automatic Looks tab ──────────────────────────────────────────────────────

  _ruleCard(rule, i, n, items, statuses) {
    const target = this._lib.looks.find(l => l.id === rule.lookId);
    const looks = this._lib.looks.map(l =>
      `<option value="${l.id}" ${l.id === rule.lookId ? "selected" : ""}>${_esc(l.name || "Unnamed look")}</option>`).join("");
    let match;
    if (rule.kind === "item") {
      // The name box appears only when it is needed: "Other item…" picked, or a
      // saved name that is not on this actor (a base NPC with no suit on it yet).
      const known = items.some(n => n.toLowerCase() === rule.match.toLowerCase());
      const other = rule._other || (!known && !!rule.match);
      const opts = items.map(n => `<option value="${_esc(n)}" ${known && n.toLowerCase() === rule.match.toLowerCase() ? "selected" : ""}>${_esc(n)}</option>`).join("");
      match = `
        <select data-rfield="matchPick" data-tooltip="Armour and gear on this actor">
          <option value="" ${!known && !other ? "selected" : ""}>Choose an item…</option>${opts}
          <option value="__other__" ${other ? "selected" : ""}>Other item (type its name)…</option>
        </select>
        ${other ? `<input type="text" data-rfield="match" value="${_esc(rule.match)}" placeholder="Item name, e.g. EV Suit">` : ""}`;
    } else {
      const groups = {};
      for (const s of statuses) (groups[s.group] ??= []).push(s);
      const icon = statuses.find(s => s.id === rule.match)?.img;
      match = `
        ${icon ? `<img class="sta2e-ap-status-icon" src="${_esc(icon)}" alt="">` : ""}
        <select data-rfield="match"><option value="">Choose a condition…</option>${
          Object.entries(groups).map(([g, list]) => `<optgroup label="${_esc(g)}">${
            list.map(s => `<option value="${_esc(s.id)}" ${s.id === rule.match ? "selected" : ""}>${_esc(s.label)}</option>`).join("")
          }</optgroup>`).join("")}</select>`;
    }
    const incomplete = !rule.match || !target;
    return `
      <li class="sta2e-ap-rule ${incomplete ? "is-incomplete" : ""}" data-rule="${i}" style="--ap-a:${rule.kind === "item" ? "var(--ap-secondary)" : "var(--ap-tertiary)"}">
        <div class="sta2e-ap-rule-prio" data-tooltip="Priority — the first matching rule wins">${i + 1}</div>
        <div class="sta2e-ap-rule-when">
          <span class="sta2e-ap-label">When</span>
          <div class="sta2e-ap-seg is-small">
            <button type="button" class="sta2e-ap-seg-key ${rule.kind === "item" ? "is-active" : ""}" data-action="ap-rule-kind" data-kind="item"><i class="fas fa-shirt"></i> Wearing</button>
            <button type="button" class="sta2e-ap-seg-key ${rule.kind === "status" ? "is-active" : ""}" data-action="ap-rule-kind" data-kind="status"><i class="fas fa-heart-pulse"></i> Condition</button>
          </div>
          <div class="sta2e-ap-rule-match">${match}</div>
        </div>
        <i class="fas fa-chevron-right sta2e-ap-rule-arrow"></i>
        <div class="sta2e-ap-rule-then">
          <span class="sta2e-ap-label">Show</span>
          <div class="sta2e-ap-rule-target">
            <div class="sta2e-ap-rule-thumb">${target ? _media(target.token || target.portrait) : `<i class="fas fa-question"></i>`}</div>
            <select data-rfield="lookId"><option value="">Choose a look…</option>${looks}</select>
          </div>
          <label class="sta2e-ap-toggle" data-tooltip="Also switch the sheet portrait">
            <input type="checkbox" data-rfield="portrait" ${rule.portrait ? "checked" : ""}>
            <span class="sta2e-ap-toggle-track"></span> Portrait too
          </label>
        </div>
        <div class="sta2e-ap-rule-keys">
          <button type="button" data-action="ap-rule-up" ${i === 0 ? "disabled" : ""} data-tooltip="Higher priority"><i class="fas fa-chevron-up"></i></button>
          <button type="button" data-action="ap-rule-down" ${i === n - 1 ? "disabled" : ""} data-tooltip="Lower priority"><i class="fas fa-chevron-down"></i></button>
          <button type="button" data-action="ap-del-rule" class="is-danger" data-tooltip="Delete rule"><i class="fas fa-trash"></i></button>
        </div>
      </li>`;
  }

  _rulesTab() {
    const lib = this._lib;
    const items = [...new Set(this.actor.items.filter(i => WEARABLE_TYPES.has(i.type)).map(i => i.name))].sort();
    const statuses = _statusChoices();
    const noLooks = !lib.looks.length;
    return `
      <section class="sta2e-ap-rules-tab">
        <div class="sta2e-ap-toolbar">
          <button type="button" data-action="ap-add-rule" data-kind="item" class="is-primary" ${noLooks ? "disabled" : ""}><i class="fas fa-shirt"></i> Gear Rule</button>
          <button type="button" data-action="ap-add-rule" data-kind="status" class="is-primary" ${noLooks ? "disabled" : ""}><i class="fas fa-heart-pulse"></i> Condition Rule</button>
          <span class="sta2e-ap-muted">Put gear on with the <i class="fas fa-shirt"></i> Wear toggle on the sheet or the Token HUD. The first matching rule wins.</span>
        </div>
        ${lib.rules.length
          ? `<ol class="sta2e-ap-rule-list">${lib.rules.map((r, i) => this._ruleCard(r, i, lib.rules.length, items, statuses)).join("")}</ol>`
          : `<div class="sta2e-ap-editor is-empty">
              <i class="fas fa-bolt"></i>
              <h3>No automatic looks</h3>
              <p>${noLooks ? "Make a look first, then come back here." : "Switch to a look while an item is worn — an EV suit, body armour — or while a condition is on, like Dead or Stunned. Taking it off puts the previous look back."}</p>
            </div>`}
      </section>`;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  async _renderHTML() {
    const body = this._tab === "rules"
      ? this._rulesTab()
      : `<div class="sta2e-ap-looks">${this._gallery()}${this._editor()}</div>`;
    return `
      <div class="sta2e-ap" style="${getLcCssVars("ap")}">
        ${this._header()}
        <div class="sta2e-ap-body">${body}</div>
        <footer class="sta2e-ap-footer">
          <span class="sta2e-ap-muted" data-dirty-note>${this._dirty ? "Unsaved changes" : ""}</span>
          <button type="button" data-action="ap-cancel">Cancel</button>
          <button type="button" data-action="ap-save" class="is-primary"><i class="fas fa-floppy-disk"></i> Save</button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, element) {
    const content = element.querySelector(".window-content") ?? element;
    const keep = [".sta2e-ap-grid", ".sta2e-ap-editor", ".sta2e-ap-rules-tab"]
      .map(sel => [sel, content.querySelector(sel)?.scrollTop ?? 0]);
    content.innerHTML = result;
    for (const [sel, top] of keep) {
      const el = content.querySelector(sel);
      if (el) el.scrollTop = top;
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  _look(el) {
    const id = el?.closest("[data-look]")?.dataset.look;
    if (id === BASE_ID) return this._base;
    return this._lib.looks.find(l => l.id === id) ?? null;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const el = this.element;
    el.addEventListener("click", (ev) => this._onClick(ev));
    el.addEventListener("change", (ev) => this._onChange(ev));
    el.addEventListener("input", (ev) => this._onInput(ev));
    el.addEventListener("dragover", (ev) => {
      const stage = ev.target.closest(".sta2e-ap-stage");
      if (!stage) return;
      ev.preventDefault();
      stage.classList.add("is-drop");
    });
    el.addEventListener("dragleave", (ev) => ev.target.closest(".sta2e-ap-stage")?.classList.remove("is-drop"));
    el.addEventListener("drop", async (ev) => {
      const stage = ev.target.closest(".sta2e-ap-stage");
      if (!stage) return;
      ev.preventDefault();
      stage.classList.remove("is-drop");
      const path = await _pathFromDrop(ev);
      const look = this._look(stage);
      if (path && look) { look[stage.dataset.slot] = path; this._touch(true); }
    });
  }

  _touch(rerender = false) {
    this._dirty = true;
    if (rerender) return this.render();
    const note = this.element?.querySelector("[data-dirty-note]");
    if (note) note.textContent = "Unsaved changes";
  }

  _onInput(ev) {
    const t = ev.target;
    if (t.dataset.field === "tokenName") {
      const look = this._look(t);
      if (look) { look.tokenName = t.value; this._touch(); }
      return;
    }
    if (t.dataset.field === "name") {
      const look = this._look(t);
      if (!look) return;
      look.name = t.value;
      const label = this.element.querySelector(`[data-name-for="${look.id}"]`);
      if (label) label.textContent = t.value || "Unnamed look";
      this._touch();
      return;
    }
    if (t.dataset.field === "scale") {
      const look = this._look(t);
      if (!look) return;
      look.scale = Math.round(Number(t.value) * 100) / 100;
      t.classList.remove("is-keep");
      const out = this.element.querySelector("[data-scale-out]");
      if (out) out.textContent = `×${look.scale}`;
      this.element.querySelector(".sta2e-ap-stage.is-token .sta2e-ap-stage-art")?.style.setProperty("--ap-scale", look.scale);
      this._touch();
      return;
    }
    if (t.dataset.rfield === "match" && t.tagName === "INPUT") {
      const rule = this._lib.rules[Number(t.closest("[data-rule]")?.dataset.rule)];
      if (rule) { rule.match = t.value; this._touch(); }
    }
  }

  _onChange(ev) {
    const t = ev.target;
    if (t.dataset.field === "scale") { this._touch(true); return; }   // refresh the card badge
    const ruleEl = t.closest("[data-rule]");
    if (!ruleEl || !t.dataset.rfield) return;
    const rule = this._lib.rules[Number(ruleEl.dataset.rule)];
    if (!rule) return;
    switch (t.dataset.rfield) {
      case "matchPick":
        // `_other` is transient UI state — normalizeRule drops it on save.
        if (t.value === "__other__") { rule._other = true; rule.match = ""; }
        else { rule._other = false; rule.match = t.value; }
        this._touch(true);
        break;
      case "match":     if (t.tagName === "SELECT") { rule.match = t.value; this._touch(true); } break;
      case "lookId":    rule.lookId = t.value; this._touch(true); break;
      case "portrait":  rule.portrait = t.checked; this._touch(); break;
    }
  }

  async _onClick(ev) {
    const btn = ev.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    const lib = this._lib;
    const action = btn.dataset.action;
    const look = this._look(btn) ?? (action.startsWith("ap-") ? this._selected() : null);
    const slot = btn.closest(".sta2e-ap-stage")?.dataset.slot;
    const ruleIdx = Number(btn.closest("[data-rule]")?.dataset.rule);
    const move = (arr, i, d) => { const j = i + d; if (i < 0 || j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };

    switch (action) {
      case "ap-tab":    this._tab = btn.dataset.tab; this.render(); break;
      case "ap-select": this._sel = btn.dataset.look; this.render(); break;
      case "ap-place": {
        const place = btn.dataset.place;
        lib.randomize = place === "random";
        if (place === "proto") lib.defaultLookId = null;
        if (place === "default" && !lib.defaultLookId) lib.defaultLookId = this._selected()?.id ?? lib.looks[0]?.id ?? null;
        this._touch(true);
        break;
      }
      case "ap-default":
        if (!look) break;
        lib.defaultLookId = lib.defaultLookId === look.id ? null : look.id;
        this._touch(true);
        break;
      case "ap-browse": {
        const path = await pickArt({ slot, query: look?.name || this.actor.name });
        if (path && look) { look[slot] = path; this._touch(true); }
        break;
      }
      case "ap-file": {
        const path = await pickImageFile(look?.[slot] ?? "");
        if (path && look) { look[slot] = path; this._touch(true); }
        break;
      }
      case "ap-clear":       if (look && slot) { look[slot] = ""; this._touch(true); } break;
      // The Original always has a scale; a look's "no scale" means keep the token's.
      case "ap-scale-reset": if (look) { look.scale = look.id === BASE_ID ? 1 : null; this._touch(true); } break;
      case "ap-webp":        if (look && slot) await this._convertToWebp([{ obj: look, slot }]); break;
      case "ap-webp-all":    await this._convertToWebp(this._convertibleSlots()); break;
      case "ap-maker": {
        if (!look) break;
        const isBase = look.id === BASE_ID;
        const made = await openTokenMaker({
          source:   look.maker?.src || look.portrait || look.token,
          recipe:   look.maker,
          ring:     look.ring,
          lookName: isBase ? this.actor.name : look.name,
          rank:     this.actor.system?.rank ?? "",
        });
        if (!made) break;
        // The working copy may have been re-rendered while the maker was open;
        // find the look again by id rather than trusting the old reference.
        const target = isBase ? this._base : lib.looks.find(l => l.id === look.id);
        if (!target) break;
        Object.assign(target, { token: made.token, ring: made.ring, maker: made.maker });
        this._touch(true);
        break;
      }
      case "ap-up":          move(lib.looks, lib.looks.indexOf(look), -1); this._touch(true); break;
      case "ap-down":        move(lib.looks, lib.looks.indexOf(look), +1); this._touch(true); break;
      case "ap-dup": {
        if (!look) break;
        const copy = normalizeLook({ ...look, id: newLookId(), name: look.name ? `${look.name} (copy)` : "" });
        lib.looks.splice(lib.looks.indexOf(look) + 1, 0, copy);
        this._sel = copy.id;
        this._touch(true);
        break;
      }
      case "ap-del-look": {
        if (!look) break;
        const used = this._rulesFor(look.id).length;
        if (used) {
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Delete Look" },
            content: `<p>${used} automatic look rule${used === 1 ? " uses" : "s use"} <b>${_esc(look.name || "this look")}</b>. Delete it anyway? Those rules will do nothing until given another look.</p>`,
          }).catch(() => false);
          if (!ok) break;
        }
        const i = lib.looks.indexOf(look);
        lib.looks.splice(i, 1);
        if (lib.defaultLookId === look.id) lib.defaultLookId = null;
        this._sel = lib.looks[Math.min(i, lib.looks.length - 1)]?.id ?? BASE_ID;
        this._touch(true);
        break;
      }
      case "ap-add-look": {
        const fresh = normalizeLook({ id: newLookId(), name: "" });
        lib.looks.push(fresh);
        this._sel = fresh.id;
        this._tab = "looks";
        this._touch(true);
        break;
      }
      case "ap-add-folder":      await this._fillFromFolder(); break;
      case "ap-import-wildcard": await this._importWildcard(); break;
      case "ap-import-visage":   this._importVisage(); break;
      case "ap-rule-for":
        if (!look) break;
        lib.rules.push({ kind: "item", match: "", lookId: look.id, portrait: true });
        this._tab = "rules";
        this._touch(true);
        break;
      case "ap-add-rule":
        lib.rules.push({ kind: btn.dataset.kind === "status" ? "status" : "item", match: "", lookId: this._selected()?.id ?? "", portrait: true });
        this._touch(true);
        break;
      case "ap-rule-kind": {
        const rule = lib.rules[ruleIdx];
        if (rule && rule.kind !== btn.dataset.kind) { rule.kind = btn.dataset.kind; rule.match = ""; this._touch(true); }
        break;
      }
      case "ap-rule-up":   move(lib.rules, ruleIdx, -1); this._touch(true); break;
      case "ap-rule-down": move(lib.rules, ruleIdx, +1); this._touch(true); break;
      case "ap-del-rule":  lib.rules.splice(ruleIdx, 1); this._touch(true); break;
      case "ap-cancel":    this._dirty = false; this.close(); break;
      case "ap-save":      await this._save(); break;
    }
  }

  _addLooks(list) {
    const known = new Set(this._lib.looks.flatMap(l => [l.token, l.portrait]).filter(Boolean));
    let added = 0;
    let first = null;
    for (const raw of list) {
      if ((raw.token && known.has(raw.token)) || (!raw.token && raw.portrait && known.has(raw.portrait))) continue;
      const look = normalizeLook({ ...raw, id: newLookId() });
      this._lib.looks.push(look);
      first ??= look.id;
      added++;
    }
    ui.notifications.info(added ? `Added ${added} look${added === 1 ? "" : "s"}.` : "No new images found — those are already looks.");
    if (added) { this._sel = first; this._tab = "looks"; this._touch(true); }
  }

  async _fillFromFolder() {
    let root = "";
    try { root = game.settings.get(MODULE, "appearanceArtRoot") ?? ""; } catch { /* default */ }
    const dir = await pickFolder(root);
    if (!dir) return;
    this._addLooks(pairImages(await listFolderImages(dir), _keywords()));
  }

  async _importWildcard() {
    const src = this.actor.prototypeToken?.texture?.src;
    if (!src) return;
    // Every match, portraits included — pairing sorts them into the right slot.
    const lastSlash = src.lastIndexOf("/");
    const pattern = src.slice(lastSlash + 1);
    const all = await listFolderImages(src.slice(0, lastSlash));
    const re = new RegExp("^" + pattern.split("*").map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
    const files = all.filter(f => re.test(decodeURIComponent(f.split("/").pop())));
    this._addLooks(pairImages(files.length ? files : await getWildcardImages(src), _keywords()));
  }

  _importVisage() {
    this._addLooks(looksFromVisage(_visageLooks(this.actor)));
  }

  /**
   * Swap PNG/JPEG art for a WebP copy saved beside it, in the working copy —
   * Save writes it. One conversion per distinct file, however many slots use it.
   * @param {{obj: object, slot: string}[]} targets
   */
  async _convertToWebp(targets) {
    if (this._converting || !targets.length) return;
    this._converting = true;
    const cache = new Map();
    let converted = 0, skipped = 0, failed = 0, savedBytes = 0;
    const distinct = new Set(targets.map(t => t.obj[t.slot])).size;
    ui.notifications.info(`Converting ${distinct} image${distinct === 1 ? "" : "s"} to WebP…`);
    try {
      for (const { obj, slot } of targets) {
        const src = obj[slot];
        if (!cache.has(src)) {
          try {
            const r = await saveAsWebp(src);
            cache.set(src, r);
            if (r.skipped) skipped++;
            else { converted++; savedBytes += r.before - r.after; }
          } catch (err) {
            failed++;
            cache.set(src, null);
            console.warn(`STA2e Toolkit | WebP: could not convert ${src}`, err);
          }
        }
        const r = cache.get(src);
        if (r && !r.skipped) obj[slot] = r.path;
      }
      // A Token Maker recipe that started from a converted portrait follows it.
      for (const obj of [this._base, ...this._lib.looks]) {
        const r = obj.maker?.src ? cache.get(obj.maker.src) : null;
        if (r && !r.skipped) obj.maker.src = r.path;
      }
    } finally {
      this._converting = false;
    }
    const parts = [];
    if (converted) parts.push(`Converted ${converted} to WebP, ${formatBytes(savedBytes)} smaller — Save to use them. The originals are still on disk; delete them from your file host to free the space.`);
    if (skipped)   parts.push(`${skipped} skipped (WebP would not be smaller).`);
    if (failed)    parts.push(`${failed} could not be converted (see the console).`);
    (failed ? ui.notifications.warn : ui.notifications.info).call(ui.notifications, parts.join(" ") || "Nothing to convert.");
    if (converted) this._touch(true);
  }

  /** Flat prototype-token / actor updates that make the edited Original stick. */
  _baseActorUpdate() {
    const n = this._base, o = this._baseWas;
    const tex = this.actor.prototypeToken?.texture ?? {};
    const out = {};
    if (n.token !== o.token) out["prototypeToken.texture.src"] = n.token;
    if (n.scale !== o.scale) {
      out["prototypeToken.texture.scaleX"] = Math.sign(tex.scaleX || 1) * n.scale;
      out["prototypeToken.texture.scaleY"] = Math.sign(tex.scaleY || 1) * n.scale;
    }
    const ringChanged = JSON.stringify(normalizeRing(n.ring)) !== JSON.stringify(normalizeRing(o.ring));
    // New art under an enabled ring re-points the ring's subject at it.
    if (ringChanged || (n.token !== o.token && n.ring?.enabled)) {
      for (const [k, v] of Object.entries(ringUpdates(n.ring, n.token))) out[`prototypeToken.${k}`] = v;
    }
    if (n.portrait !== o.portrait) {
      // A linked character in a look shows that look's portrait; its original
      // waits in the baseline until the look comes off.
      const st = this._linked ? normalizeState(this.actor.getFlag(MODULE, STATE_FLAG)) : null;
      if (st?.baseline) out[`flags.${MODULE}.${STATE_FLAG}.baseline.portrait`] = n.portrait;
      else out.img = n.portrait;
    }
    return out;
  }

  /**
   * Carry the new Original onto tokens already on a scene: a token still on the
   * old original art takes the new one, and a token in a look has its
   * remembered original rewritten so taking the look off shows the new art.
   */
  async _followPlacedTokens(oldBase, newBase) {
    const strip = ({ token, scale, ring }) => ({ token, scale, ring });
    const oldB = strip(oldBase), newB = strip(newBase);
    // Flat paths, only for the slots that moved, so nothing else in the state
    // (the portrait, the name, the chosen look) is rewritten.
    const baselinePaths = (was, now) => {
      const out = {};
      for (const k of ["token", "scale", "ring"]) {
        if (JSON.stringify(was[k] ?? null) !== JSON.stringify(now[k] ?? null)) out[`flags.${MODULE}.${STATE_FLAG}.baseline.${k}`] = now[k] ?? null;
      }
      return out;
    };
    let linkedDone = false;
    for (const scene of game.scenes ?? []) {
      for (const td of scene.tokens ?? []) {
        if (td.actorId !== this.actor.id) continue;
        try {
          const stateDoc = td.actorLink ? this.actor : td;
          const st = normalizeState(stateDoc.getFlag(MODULE, STATE_FLAG));
          if (st.baseline) {
            // Portraits are not compared here: an unlinked token's baseline
            // portrait is "use the actor's", and a linked one's is handled by
            // `_baseActorUpdate`. Linked tokens share the actor's one state.
            if (td.actorLink && linkedDone) continue;
            const { baseline } = rebaseVisual({ oldBase: oldB, newBase: newB, baseline: { ...st.baseline } });
            if (td.actorLink) linkedDone = true;
            if (baseline) await stateDoc.update(baselinePaths(st.baseline, baseline));
            continue;
          }
          const current = {
            token: td.texture?.src ?? "",
            scale: Math.abs(Number(td.texture?.scaleX ?? 1)) || 1,
            ring:  ringFromToken(td.ring),
          };
          const { patch } = rebaseVisual({ oldBase: oldB, newBase: newB, current });
          if (!patch) continue;
          const data = {};
          if ("token" in patch) data["texture.src"] = patch.token;
          if ("scale" in patch) {
            data["texture.scaleX"] = Math.sign(td.texture?.scaleX || 1) * patch.scale;
            data["texture.scaleY"] = Math.sign(td.texture?.scaleY || 1) * patch.scale;
          }
          if ("ring" in patch) Object.assign(data, ringUpdates(patch.ring, patch.token ?? current.token));
          await td.update(data);
        } catch (err) {
          console.warn(`STA2e Toolkit | Appearance: could not update ${td.name} to the new original art`, err);
        }
      }
    }
  }

  async _save() {
    const lib = normalizeLibrary({ ...this._lib, baseMaker: this._base.maker });
    const bad = lib.rules.filter(r => !r.match || !r.lookId);
    if (bad.length) {
      ui.notifications.warn(`${bad.length} automatic look${bad.length === 1 ? " is" : "s are"} missing an item/condition or a look, and will be ignored until completed.`);
    }
    const baseChanged = this._baseChanged();
    // Placed tokens first: the library write below sets the active GM
    // re-evaluating every token of this actor, and that pass must read the
    // rewritten baselines rather than race them.
    if (baseChanged) await this._followPlacedTokens(this._baseWas, this._base);
    await this.actor.update({
      [`flags.${MODULE}.${LIBRARY_FLAG}`]: lib,
      ...(baseChanged ? this._baseActorUpdate() : {}),
    });
    this._lib = lib;
    this._dirty = false;
    ui.notifications.info(`Appearances saved for ${this.actor.name}.`);
    this.close();
  }

  async close(options) {
    if (this._dirty) {
      const discard = await foundry.applications.api.DialogV2.confirm({
        window:  { title: "Unsaved Appearances" },
        content: `<p>Discard your changes to ${_esc(this.actor.name)}'s looks?</p>`,
      }).catch(() => false);
      if (!discard) return this;
      this._dirty = false;
    }
    _open.delete(this.actor.uuid);
    return super.close(options);
  }
}

/**
 * Open the manager for an actor — or a token, whose world actor owns the
 * library. One window per actor.
 */
export function openAppearanceManager(target) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can edit appearances.");
    return null;
  }
  const doc = target?.document ?? target;
  const actor = doc?.documentName === "Token"
    ? (doc.baseActor ?? game.actors.get(doc.actorId))
    : (doc?.isToken ? (doc.token?.baseActor ?? game.actors.get(doc.token?.actorId)) : doc);
  if (!actor) return null;
  const existing = _open.get(actor.uuid);
  if (existing?.rendered) { existing.bringToFront?.(); return existing; }
  const app = new AppearanceManagerApp(actor);
  _open.set(actor.uuid, app);
  app.render(true);
  return app;
}
