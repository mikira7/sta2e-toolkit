/**
 * sta2e-toolkit | token-maker.js
 *
 * Tokenizer-style token maker for Appearances: frame a portrait, mask it, put
 * a ring on it, save the result next to the portrait and hand it back to the
 * look that asked for it.
 *
 * Compositing, in this order, onto one square output canvas:
 *   1. background fill (baked mode) — clipped to the shape
 *   2. subject INSIDE the shape:  subject ∩ shape − erase
 *   3. frame — a ring image (baked), or the dynamic ring preview
 *   4. subject POP-OUT:           subject ∩ restore − erase − shape
 *   5. rank pips — a plate on the ring at the bottom left
 *   6. emblem — a commbadge or insignia disc at the bottom right
 *      (token-emblems.js); per token, never part of the ring art
 * so hair, shoulders or a phaser painted back with the Restore brush break
 * over the frame. In dynamic-ring mode Foundry draws the ring and its
 * background itself, *under* the subject (core's ring shader blends the token
 * over the ring), so the export is layers 2 + 4 only and the preview draws the
 * ring underneath to match. A ring whose spritesheet lists `cutouts` (the
 * commbadge) has those discs cut out of both subject layers, so the portrait
 * cannot cover the badge; its `subjectRadius` sets the default mask size.
 *
 * The shape is a parameter in OUTPUT space, re-drawn every frame. The Erase and
 * Restore masks are bitmaps in SOURCE space — strokes go through the inverse
 * of the portrait's transform — so re-framing the portrait after masking keeps
 * the mask on the hair it was painted over. The maths is in
 * token-maker-compose.js (tested under node).
 *
 * Shape lives in styles/token-maker.css; colour arrives as `--tm-*` from
 * getLcCssVars. Mode-dependent rows are shown by `data-*` attributes on the
 * root and CSS, so changing a mode never rebuilds the panel under the pointer.
 */

import {
  subjectMatrix, invertMatrix, applyMatrix, autoFit, shapeGeometry, floodFill, rankInsignia, insigniaLabel, OFFICER_RANKS, officerGradeFor, ENLISTED_RANKS, ADMIRAL_RANKS,
  pipPlate, emblemDisc,
  tokenFileNames, baseScale, isWritableNextTo,
} from "./token-maker-compose.js";
import { uploadFile, browseFolder, storageForFile } from "./file-storage.js";
import { loadObjectImage, makeCanvas } from "./destructible-art.js";
import { pickArt, pickImageFile } from "./art-browser.js";
import { activeRingConfig } from "./starfleet-ring.js";
import {
  listEmblems, findEmblem, drawEmblem, addEmblemToLibrary, removeEmblemFromLibrary,
  convertToWebp, EMBLEM_DIR,
} from "./token-emblems.js";
import { BAKED_FRAMES, drawBakedFrame } from "./token-frames.js";
import { getLcCssVars } from "./lcars-theme.js";

const UNDO_MAX = 10;
const RING_EFFECTS = { pulse: 0x02, gradient: 0x04, wave: 0x08 };   // TokenRing.effects; ENABLED is 0x01

function _esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** A canvas the same size as another, optionally a copy of it. */
function _clone(src, copy = true) {
  const c = makeCanvas(src.width, src.height);
  if (copy) c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

function _shapePath(ctx, geo) {
  ctx.beginPath();
  if (geo.type === "circle") ctx.arc(geo.cx, geo.cy, geo.r, 0, Math.PI * 2);
  else if (geo.type === "poly") {
    const p = geo.points;
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
  } else ctx.rect(0, 0, 1e5, 1e5);
}

/** Load an image file into a canvas (any size), for frames and fills. */
async function _loadPlain(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
  const c = makeCanvas(img.naturalWidth, img.naturalHeight);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

// ── Dynamic ring preview ─────────────────────────────────────────────────────

const _ringCache = new Map();   // spritesheet path -> Promise<{ring, bkg, band}>

/** The `token-ring-med` frame and its background out of a ring spritesheet. */
function _loadRingFrames(spritesheet) {
  if (!_ringCache.has(spritesheet)) {
    _ringCache.set(spritesheet, (async () => {
      const json = await (await fetch(spritesheet)).json();
      const dir = spritesheet.slice(0, spritesheet.lastIndexOf("/") + 1);
      const atlas = await _loadPlain(dir + json.meta.image);
      const cut = (name) => {
        const f = json.frames[name]?.frame;
        if (!f) return null;
        const c = makeCanvas(f.w, f.h);
        c.getContext("2d").drawImage(atlas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        return c;
      };
      return {
        ring: cut("token-ring-med"),
        bkg:  cut("token-ring-med-bkg"),
        mask: cut("token-ring-med-msk"),
        band: json.frames["token-ring-med"]?.colorBand ?? json.config?.defaultColorBand ?? { startRadius: 0.666, endRadius: 0.7225 },
        // Toolkit-only config keys (core ignores them): where the portrait
        // should end, and discs it must stay out of (the commbadge).
        subjectRadius: Number(json.config?.subjectRadius) || null,
        cutouts: Array.isArray(json.config?.cutouts) ? json.config.cutouts : [],
        pips: json.config?.pips ?? null,
        emblem: json.config?.emblem ?? null,
      };
    })().catch((err) => { _ringCache.delete(spritesheet); throw err; }));
  }
  return _ringCache.get(spritesheet);
}

/**
 * A ring frame tinted the way core's shader tints it. With a mask frame the
 * colour (× the mask's red channel) is laid over the art wherever the mask is
 * drawn; without one, band pixels become the colour × their red channel. The
 * background is overlay-blended with the background colour.
 */
function _tintRing(frames, S, ringColor, bgColor) {
  const out = makeCanvas(S, S);
  const ctx = out.getContext("2d");
  if (frames.bkg) {
    const bkg = makeCanvas(S, S);
    const b = bkg.getContext("2d");
    b.drawImage(frames.bkg, 0, 0, S, S);
    if (bgColor && bgColor.toLowerCase() !== "#ffffff") {
      b.globalCompositeOperation = "overlay";
      b.fillStyle = bgColor;
      b.fillRect(0, 0, S, S);
      b.globalCompositeOperation = "destination-in";
      b.drawImage(frames.bkg, 0, 0, S, S);
    }
    ctx.drawImage(bkg, 0, 0);
  }
  if (frames.ring) {
    const ring = makeCanvas(S, S);
    const r = ring.getContext("2d");
    r.drawImage(frames.ring, 0, 0, S, S);
    if (ringColor && frames.mask) {
      const m = makeCanvas(S, S);
      const mc = m.getContext("2d");
      mc.drawImage(frames.mask, 0, 0, S, S);
      mc.globalCompositeOperation = "multiply";
      mc.fillStyle = ringColor;
      mc.fillRect(0, 0, S, S);
      mc.globalCompositeOperation = "destination-in";
      mc.drawImage(frames.mask, 0, 0, S, S);
      r.drawImage(m, 0, 0);
    } else if (ringColor) {
      // The band art is greyscale, so a multiply is colour × red channel.
      r.save();
      r.beginPath();
      r.arc(S / 2, S / 2, (frames.band.endRadius * S) / 2, 0, Math.PI * 2);
      r.arc(S / 2, S / 2, (frames.band.startRadius * S) / 2, 0, Math.PI * 2, true);
      r.clip();
      r.globalCompositeOperation = "multiply";
      r.fillStyle = ringColor;
      r.fillRect(0, 0, S, S);
      r.globalCompositeOperation = "destination-in";
      r.drawImage(frames.ring, 0, 0, S, S);
      r.restore();
    }
    ctx.drawImage(ring, 0, 0);
  }
  return out;
}

function _ringStyles() {
  const ring = CONFIG.Token?.ring;
  const labels = ring?.configLabels ?? {};
  return Object.entries(labels).map(([id, label]) => ({
    id,
    label: game.i18n.localize(label),
    spritesheet: ring?.getConfig?.(id)?.spritesheet ?? null,
  }));
}

// ── The window ───────────────────────────────────────────────────────────────

class TokenMakerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["sta2e-token-maker"],
    tag:     "section",
    window:  { resizable: true, icon: "fas fa-wand-magic-sparkles", title: "Token Maker" },
    position: { width: 980, height: 700 },
  };

  /**
   * @param {object} opts
   * @param {string} opts.source        Portrait (or any image) to make the token from
   * @param {object|null} opts.recipe   A look's saved `maker`, to re-open it
   * @param {object|null} opts.ring     The look's current ring
   * @param {string} [opts.lookName]
   * @param {string} [opts.rank]       The actor's free-text rank, for "From Rank" pips
   * @param {Function} opts.resolve     Receives {token, ring, maker} or null
   */
  constructor({ source, recipe, ring, lookName = "", rank = "", resolve }, options = {}) {
    super(options);
    const active = activeRingConfig();
    this._resolve = resolve;
    this._done = false;
    this._lookName = lookName;
    this.r = {
      src: recipe?.src || source,
      x: 0.5, y: 0.5, zoom: 1, rotation: 0, flipX: false,
      shape: "circle", size: 0.86, feather: 1.5,
      ringMode: ring?.enabled ? "dynamic" : "none",
      ringImage: "",
      ringStyle: active.id || "coreSteel",
      ringColor: ring?.ringColor ?? "#ff9c00",
      ringBg: ring?.backgroundColor ?? "#1b2236",
      effects: Number.isFinite(ring?.effects) ? ring.effects : 1,
      subjectScale: ring?.subjectScale ?? 1,
      fillMode: "color", fillColor: "#10131c", fillImage: "",
      outSize: 512,
      pipsMode: rankInsignia(rank) ? "auto" : "none",
      // Manual insignia: which kind, then that kind's own values.
      pipsKind: rankInsignia(rank)?.kind ?? "officer",
      pipsOfficer: officerGradeFor(rankInsignia(rank)?.solid, rankInsignia(rank)?.hollow)?.id ?? 4,
      pipsAdmiral: rankInsignia(rank)?.pips ?? 4,
      pipsEnlisted: 4,
      pipsCadet: rankInsignia(rank)?.bars ?? 1,
      emblemId: "",
      emblemFrame: "disc",
      // Image ring: a built-in frame (token-frames.js) in any colour, or "custom"
      // for the GM's own ring image in `ringImage`.
      frameStyle: "starfield",
      frameColor: "#9c0000",
      // The saved file's name without extension; blank means "<portrait>_token".
      fileName: "",
      ...(recipe ?? {}),
    };
    if (recipe?.src) this.r.src = recipe.src;
    // Recipes saved before the officer grade list stored pip counts.
    if (recipe && !("pipsOfficer" in recipe) && ("pipsSolid" in recipe || "pipsHollow" in recipe)) {
      this.r.pipsOfficer = officerGradeFor(recipe.pipsSolid, recipe.pipsHollow)?.id ?? 4;
    }
    // Recipes saved before built-in frames existed used a custom image.
    if (recipe && !("frameStyle" in recipe) && recipe.ringImage) this.r.frameStyle = "custom";
    this._recipeGiven = !!recipe;
    this._rank = String(rank ?? "");
    this._tool = "move";
    this._brush = { size: 40, hardness: 0.6, tolerance: 18 };
    this._undo = [];
    this._redo = [];
    this._frameImg = null;
    this._fillImg = null;
    this._ringFrames = null;
    this._raf = 0;
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  async _loadSource(src, { keepMasks = false } = {}) {
    this._srcCanvas = await loadObjectImage(src);
    this._srcData = this._srcCanvas.getContext("2d").getImageData(0, 0, this._srcCanvas.width, this._srcCanvas.height);
    if (!keepMasks) {
      this._restore = _clone(this._srcCanvas, false);
      this._erase = _clone(this._srcCanvas, false);
      this._undo = [];
      this._redo = [];
    }
  }

  async _loadMasks(path) {
    try {
      const m = await _loadPlain(path);
      const w = this._srcCanvas.width, h = this._srcCanvas.height;
      const scaled = makeCanvas(w, h);
      scaled.getContext("2d").drawImage(m, 0, 0, w, h);
      const px = scaled.getContext("2d").getImageData(0, 0, w, h);
      const r = new ImageData(w, h), e = new ImageData(w, h);
      for (let i = 0; i < px.data.length; i += 4) {
        r.data[i] = r.data[i + 1] = r.data[i + 2] = 255; r.data[i + 3] = px.data[i];
        e.data[i] = e.data[i + 1] = e.data[i + 2] = 255; e.data[i + 3] = px.data[i + 1];
      }
      this._restore.getContext("2d").putImageData(r, 0, 0);
      this._erase.getContext("2d").putImageData(e, 0, 0);
    } catch (err) {
      console.warn("STA2e Toolkit | Token Maker: saved masks could not be loaded", err);
    }
  }

  /** The built-in frame in use, or null (custom image, or not image mode). */
  _bakedFrame() {
    return this.r.ringMode === "image" ? (BAKED_FRAMES[this.r.frameStyle] ?? null) : null;
  }

  /** Mask size to the frame's opening (rounded down, never past it). */
  _fitSizeToFrame() {
    const f = this._bakedFrame();
    this._setValue("size", Math.floor((f?.opening ?? 0.86) * 100) / 100);
  }

  async _loadFrame() {
    this._frameImg = null;
    if (this.r.ringMode !== "image" || this._bakedFrame() || !this.r.ringImage) return;
    try { this._frameImg = await _loadPlain(this.r.ringImage); }
    catch { ui.notifications.warn("Token Maker: that ring image could not be loaded."); }
  }

  async _loadFill() {
    this._fillImg = null;
    if (this.r.fillMode !== "image" || !this.r.fillImage) return;
    try { this._fillImg = await _loadPlain(this.r.fillImage); }
    catch { ui.notifications.warn("Token Maker: that background image could not be loaded."); }
  }

  /**
   * Size the subject to the ring's own opening: a dynamic ring is drawn round
   * the outside of the subject, so the portrait should end just inside it.
   * Rings that don't say fall back to core's band (~0.66).
   */
  _fitSizeToRing() {
    const radius = this._ringFrames?.subjectRadius ?? this._ringFrames?.band?.startRadius ?? 0.66;
    // Round DOWN, so the portrait never pokes past the opening.
    this._setValue("size", Math.floor(Math.min(1, radius) * 100) / 100);
  }

  async _loadRing() {
    this._ringFrames = null;
    if (this.r.ringMode !== "dynamic") return;
    const style = _ringStyles().find(s => s.id === this.r.ringStyle) ?? _ringStyles()[0];
    if (!style?.spritesheet) return;
    try { this._ringFrames = await _loadRingFrames(style.spritesheet); }
    catch (err) { console.warn("STA2e Toolkit | Token Maker: ring preview unavailable", err); }
  }

  // ── Compositing ────────────────────────────────────────────────────────────

  _matrix(S) {
    return subjectMatrix(this.r, this._srcCanvas.width, this._srcCanvas.height, S);
  }

  /** The transformed subject and its masks, in output space. */
  _layers(S) {
    const m = this._matrix(S);
    const draw = (img) => {
      const c = makeCanvas(S, S);
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.setTransform(...m);
      ctx.drawImage(img, 0, 0);
      return c;
    };
    const subject = draw(this._srcCanvas);
    const restore = draw(this._restore);
    const erase = draw(this._erase);
    const shape = makeCanvas(S, S);
    const sctx = shape.getContext("2d");
    const geo = shapeGeometry(this.r.shape, S, this._effectiveSize());
    const feather = (Number(this.r.feather) || 0) * (S / 512);
    if (feather > 0 && geo.type !== "none") sctx.filter = `blur(${feather}px)`;
    sctx.fillStyle = "#fff";
    _shapePath(sctx, geo);
    sctx.fill();
    sctx.filter = "none";
    return { subject, restore, erase, shape, geo };
  }

  /** The insignia to stamp, or null. Auto re-reads the actor's rank every time. */
  _pips() {
    if (this.r.pipsMode === "auto") return rankInsignia(this._rank);
    if (this.r.pipsMode !== "manual") return null;
    switch (this.r.pipsKind) {
      case "admiral": return { kind: "admiral", pips: Number(this.r.pipsAdmiral) || 1 };
      case "cadet":   return { kind: "cadet", bars: Number(this.r.pipsCadet) || 1 };
      case "enlisted": {
        const e = ENLISTED_RANKS.find(x => x.id === Number(this.r.pipsEnlisted)) ?? ENLISTED_RANKS[0];
        return { kind: "enlisted", chevrons: e.chevrons, dots: e.dots };
      }
      default: {
        const o = OFFICER_RANKS.find(x => x.id === Number(this.r.pipsOfficer)) ?? OFFICER_RANKS[3];
        return { kind: "officer", solid: o.solid, hollow: o.hollow };
      }
    }
  }

  /**
   * Draw the rank insignia — officer pips on a gold-rimmed black plate, a flag
   * officer's gold-framed bar, an enlisted arrow tab with chevrons and dots, or
   * a cadet's white bars — after the TNG-era collar insignia.
   */
  _drawPips(ctx, S) {
    const pips = this._pips();
    // On a dynamic ring the plate sits where that ring says (on its band);
    // otherwise near the token edge, over a baked frame or none.
    const place = this.r.ringMode === "dynamic" && this._ringFrames?.pips ? this._ringFrames.pips
      : (this._bakedFrame()?.pips ?? {});
    const plate = pips && pipPlate(S, pips, place);
    if (!plate) return;
    const gold = (y0, y1) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, "#f3d48a");
      g.addColorStop(0.5, "#d7ac5c");
      g.addColorStop(1, "#a07a38");
      return g;
    };
    ctx.save();
    ctx.translate(plate.cx, plate.cy);
    ctx.rotate(plate.angle);
    const rim = Math.max(1.5, S * 0.006);
    if (plate.kind !== "officer") {
      this._drawInsignia(ctx, plate, rim, gold);
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.roundRect(-plate.w / 2, -plate.h / 2, plate.w, plate.h, plate.h * 0.22);
    ctx.fillStyle = "#050505";
    ctx.fill();
    // The officer plate's rim is brushed silver; the pips stay gold.
    const silver = ctx.createLinearGradient(0, -plate.h / 2, 0, plate.h / 2);
    silver.addColorStop(0, "#f2f4f7");
    silver.addColorStop(0.5, "#b4bac3");
    silver.addColorStop(1, "#7a818b");
    ctx.lineWidth = rim;
    ctx.strokeStyle = silver;
    ctx.stroke();
    for (const pip of plate.pips) {
      // A hollow pip's ring scales with the pip, so it stays a ring at any size.
      const ring = Math.max(1, pip.r * 0.34);
      ctx.beginPath();
      ctx.arc(pip.x, 0, pip.hollow ? pip.r - ring / 2 : pip.r, 0, Math.PI * 2);
      if (pip.hollow) {
        ctx.lineWidth = ring;
        ctx.strokeStyle = gold(-pip.r, pip.r);
        ctx.stroke();
      } else {
        ctx.fillStyle = gold(-pip.r, pip.r);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Flag, enlisted and cadet insignia, in the plate's own (rotated) frame. */
  _drawInsignia(ctx, plate, rim, gold) {
    const { w, h } = plate;
    if (plate.kind === "admiral") {
      // Gold frame, black field, gold pips.
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.1);
      ctx.fillStyle = gold(-h / 2, h / 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, rim * 0.6);
      ctx.strokeStyle = "#4a3410";
      ctx.stroke();
      const ft = h * 0.15;
      ctx.beginPath();
      ctx.roundRect(-w / 2 + ft, -h / 2 + ft, w - ft * 2, h - ft * 2, h * 0.05);
      ctx.fillStyle = "#070707";
      ctx.fill();
      for (const pip of plate.pips) {
        ctx.beginPath();
        ctx.arc(pip.x, 0, pip.r * 0.92, 0, Math.PI * 2);
        ctx.fillStyle = gold(-pip.r, pip.r);
        ctx.fill();
      }
      return;
    }
    if (plate.kind === "enlisted") {
      // A black tab with an arrow point, grey-edged; white chevrons, then dots.
      const tip = plate.tip;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2 - tip, -h / 2);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 2 - tip, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      ctx.fillStyle = "#0b0b0d";
      ctx.fill();
      ctx.lineWidth = Math.max(1, rim * 0.8);
      ctx.strokeStyle = "#6a6d73";
      ctx.stroke();
      ctx.strokeStyle = "#f2f2f0";
      ctx.lineWidth = h * 0.11;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const step = h * 0.27;
      let x = -w / 2 + h * 0.28;
      for (let i = 0; i < plate.chevrons; i++, x += step) {
        ctx.beginPath();
        ctx.moveTo(x, -h * 0.28);
        ctx.lineTo(x + h * 0.2, 0);
        ctx.lineTo(x, h * 0.28);
        ctx.stroke();
      }
      if (plate.dots) {
        const dx = x + h * 0.26, dr = h * 0.075;
        // One dot centred; two stacked; three as a stacked pair plus one ahead.
        const spots = plate.dots === 1 ? [[dx, 0]]
          : plate.dots === 2 ? [[dx, -h * 0.15], [dx, h * 0.15]]
          : [[dx, -h * 0.17], [dx, h * 0.17], [dx + h * 0.2, 0]];
        ctx.fillStyle = "#f2f2f0";
        for (const [px, py] of spots) {
          ctx.beginPath();
          ctx.arc(px, py, dr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    if (plate.kind === "cadet") {
      // A dark back with a white capsule per year.
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.18);
      ctx.fillStyle = "#16171a";
      ctx.fill();
      ctx.lineWidth = Math.max(1, rim * 0.6);
      ctx.strokeStyle = "#45484e";
      ctx.stroke();
      for (const bar of plate.bars) {
        ctx.beginPath();
        ctx.roundRect(bar.x - bar.w / 2, -bar.h / 2, bar.w, bar.h, bar.w / 2);
        const g = ctx.createLinearGradient(bar.x - bar.w / 2, 0, bar.x + bar.w / 2, 0);
        g.addColorStop(0, "#f4f2ea");
        g.addColorStop(1, "#cfccc0");
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }

  /** Discs the subject must stay out of — the commbadge, on rings that have one. */
  _cutouts(S) {
    if (this.r.ringMode !== "dynamic" || !this._ringFrames?.cutouts?.length) return null;
    const c = makeCanvas(S, S);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    for (const k of this._ringFrames.cutouts) {
      ctx.beginPath();
      ctx.arc(S / 2 + k.x * S / 2, S / 2 + k.y * S / 2, (k.r * S) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }

  /** Load a library emblem's image (built-ins are drawn in vector). */
  async _loadEmblem() {
    this._emblemImg = null;
    const e = findEmblem(this.r.emblemId);
    if (!e?.src) return;
    try { this._emblemImg = await _loadPlain(e.src); }
    catch { ui.notifications.warn(`Token Maker: the emblem "${e.name}" could not be loaded.`); }
  }

  _drawEmblem(ctx, S) {
    const e = findEmblem(this.r.emblemId);
    if (!e) return;
    if (!e.builtin && !this._emblemImg) return;
    const place = this.r.ringMode === "dynamic" && this._ringFrames?.emblem ? this._ringFrames.emblem
      : (this._bakedFrame()?.emblem ?? {});
    const disc = emblemDisc(S, place);
    drawEmblem(ctx, disc.cx, disc.cy, disc.r, { id: e.id, image: this._emblemImg, frame: this.r.emblemFrame });
  }

  /**
   * Add an image to the world's emblem library. A PNG or JPG is converted to
   * WebP and saved to worlds/<world>/sta2e-emblems/ first; SVG and WebP are
   * used where they are.
   */
  async _addEmblem() {
    const path = await pickImageFile("");
    if (!path) return;
    const stem = decodeURIComponent(path.split("/").pop() ?? "emblem").replace(/\.[a-z0-9]+$/i, "");
    const name = await foundry.applications.api.DialogV2.prompt({
      window:  { title: "Name This Emblem" },
      content: `<label style="display:flex;gap:8px;align-items:center">Name <input type="text" name="emblemName" value="${_esc(stem.replace(/[_-]+/g, " "))}" autofocus></label>`,
      ok:      { label: "Add Emblem", callback: (_ev, button) => button.form.elements.emblemName.value },
    }).catch(() => null);
    if (!name) return;
    try {
      let src = path;
      const { blob, converted } = await convertToWebp(path);
      if (converted) {
        const slug = stem.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "emblem";
        const file = new File([blob], `${slug}-${Math.random().toString(36).slice(2, 6)}.webp`, { type: "image/webp" });
        src = await this._upload(EMBLEM_DIR(), file);
        ui.notifications.info(`Emblem converted to WebP: ${src}`);
      }
      this.r.emblemId = await addEmblemToLibrary({ name, src });
      await this._loadEmblem();
      this.render();
    } catch (err) {
      ui.notifications.error(`Token Maker: could not add that emblem — ${err.message}`);
    }
  }

  _effectiveSize() {
    return Number(this.r.size) || 0.86;
  }

  /**
   * Compose the token.
   * @param {number} S  output size in px
   * @param {{preview?: boolean}} opts  preview draws the dynamic ring and the ghost
   */
  _compose(S, { preview = false } = {}) {
    const out = makeCanvas(S, S);
    const ctx = out.getContext("2d");
    const L = this._layers(S);
    const dynamic = this.r.ringMode === "dynamic";

    // Ghost of the whole portrait while masking, so the Restore brush can see
    // what is there to paint back.
    if (preview && (this._tool === "restore" || this._tool === "erase" || this._tool === "magic")) {
      ctx.globalAlpha = 0.22;
      ctx.drawImage(L.subject, 0, 0);
      ctx.globalAlpha = 1;
    }

    // Dynamic ring: Foundry draws it UNDER the subject.
    if (dynamic && preview && this._ringFrames) {
      ctx.drawImage(_tintRing(this._ringFrames, S, this.r.ringColor, this.r.ringBg), 0, 0);
    }

    // 1. background, clipped to the shape (baked modes only)
    if (!dynamic && this.r.fillMode !== "none" && L.geo.type !== "none") {
      const bg = makeCanvas(S, S);
      const b = bg.getContext("2d");
      if (this.r.fillMode === "image" && this._fillImg) {
        const k = Math.max(S / this._fillImg.width, S / this._fillImg.height);
        b.drawImage(this._fillImg, (S - this._fillImg.width * k) / 2, (S - this._fillImg.height * k) / 2, this._fillImg.width * k, this._fillImg.height * k);
      } else {
        b.fillStyle = this.r.fillColor || "#000";
        b.fillRect(0, 0, S, S);
      }
      b.globalCompositeOperation = "destination-in";
      b.drawImage(L.shape, 0, 0);
      ctx.drawImage(bg, 0, 0);
    }

    // 2. subject inside the shape
    const inside = _clone(L.subject);
    const ic = inside.getContext("2d");
    ic.globalCompositeOperation = "destination-in";
    ic.drawImage(L.shape, 0, 0);
    ic.globalCompositeOperation = "destination-out";
    ic.drawImage(L.erase, 0, 0);
    const cut = this._cutouts(S);
    if (cut) ic.drawImage(cut, 0, 0);
    ctx.drawImage(inside, 0, 0);

    // 3. frame
    if (this._bakedFrame()) drawBakedFrame(ctx, S, this.r.frameStyle, this.r.frameColor);
    else if (this.r.ringMode === "image" && this._frameImg) ctx.drawImage(this._frameImg, 0, 0, S, S);

    // 4. pop-out over the frame
    const pop = _clone(L.subject);
    const pc = pop.getContext("2d");
    pc.globalCompositeOperation = "destination-in";
    pc.drawImage(L.restore, 0, 0);
    pc.globalCompositeOperation = "destination-out";
    pc.drawImage(L.erase, 0, 0);
    pc.drawImage(L.shape, 0, 0);
    if (cut) pc.drawImage(cut, 0, 0);
    ctx.drawImage(pop, 0, 0);

    // 5. rank pips, over everything (in dynamic mode they ride on the subject,
    //    which Foundry draws over its ring)
    this._drawPips(ctx, S);

    // 6. emblem — commbadge or insignia, bottom right, opposite the pips
    this._drawEmblem(ctx, S);
    return out;
  }

  _requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._draw();
    });
  }

  _draw() {
    const canvas = this.element?.querySelector(".sta2e-tm-canvas");
    if (!canvas || !this._srcCanvas) return;
    const S = canvas.width;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this._compose(S, { preview: true }), 0, 0);
  }

  // ── Masks ──────────────────────────────────────────────────────────────────

  _snapshot() {
    const grab = (c) => c.getContext("2d").getImageData(0, 0, c.width, c.height);
    this._undo.push({ restore: grab(this._restore), erase: grab(this._erase) });
    if (this._undo.length > UNDO_MAX) this._undo.shift();
    this._redo = [];
  }

  _swapState(from, to) {
    const snap = from.pop();
    if (!snap) return;
    const grab = (c) => c.getContext("2d").getImageData(0, 0, c.width, c.height);
    to.push({ restore: grab(this._restore), erase: grab(this._erase) });
    this._restore.getContext("2d").putImageData(snap.restore, 0, 0);
    this._erase.getContext("2d").putImageData(snap.erase, 0, 0);
    this._requestDraw();
  }

  /** Display pointer position → output pixels on the working canvas. */
  _outPoint(ev) {
    const canvas = this.element.querySelector(".sta2e-tm-canvas");
    const rect = canvas.getBoundingClientRect();
    return [((ev.clientX - rect.left) / rect.width) * canvas.width, ((ev.clientY - rect.top) / rect.height) * canvas.height];
  }

  /** A brush dab from output point a to b, in source space, on both masks. */
  _stroke(a, b) {
    const canvas = this.element.querySelector(".sta2e-tm-canvas");
    const S = canvas.width;
    const inv = invertMatrix(this._matrix(S));
    const k = baseScale(this._srcCanvas.width, this._srcCanvas.height, S) * (Number(this.r.zoom) || 1);
    const radius = ((this._brush.size / 2) * (S / 512)) / k;
    const [sx0, sy0] = applyMatrix(inv, a[0], a[1]);
    const [sx1, sy1] = applyMatrix(inv, b[0], b[1]);
    const target = this._tool === "restore" ? this._restore : this._erase;
    const other = this._tool === "restore" ? this._erase : this._restore;
    const steps = Math.max(1, Math.ceil(Math.hypot(sx1 - sx0, sy1 - sy0) / (radius * 0.35)));
    const dab = (ctx, x, y, op) => {
      ctx.globalCompositeOperation = op;
      const g = ctx.createRadialGradient(x, y, radius * this._brush.hardness, x, y, radius);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    const tc = target.getContext("2d"), oc = other.getContext("2d");
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = sx0 + (sx1 - sx0) * t, y = sy0 + (sy1 - sy0) * t;
      dab(tc, x, y, "source-over");
      dab(oc, x, y, "destination-out");
    }
    tc.globalCompositeOperation = oc.globalCompositeOperation = "source-over";
    this._requestDraw();
  }

  _magic(pt) {
    const canvas = this.element.querySelector(".sta2e-tm-canvas");
    const inv = invertMatrix(this._matrix(canvas.width));
    const [sx, sy] = applyMatrix(inv, pt[0], pt[1]);
    const w = this._srcCanvas.width, h = this._srcCanvas.height;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    this._snapshot();
    const fill = floodFill(this._srcData, sx, sy, this._brush.tolerance);
    const ec = this._erase.getContext("2d"), rc = this._restore.getContext("2d");
    const e = ec.getImageData(0, 0, w, h), r = rc.getImageData(0, 0, w, h);
    for (let p = 0; p < fill.length; p++) {
      if (!fill[p]) continue;
      const i = p * 4;
      e.data[i] = e.data[i + 1] = e.data[i + 2] = 255; e.data[i + 3] = 255;
      r.data[i + 3] = 0;
    }
    ec.putImageData(e, 0, 0);
    rc.putImageData(r, 0, 0);
    this._requestDraw();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  async _renderHTML() {
    const r = this.r;
    const styles = _ringStyles();
    const active = activeRingConfig();
    const tool = (id, icon, tip) => `<button type="button" class="sta2e-tm-tool ${this._tool === id ? "is-active" : ""}" data-tool="${id}" data-tooltip="${tip}"><i class="fas fa-${icon}"></i></button>`;
    const range = (field, min, max, step, value, label, unit = "") => `
      <label class="sta2e-tm-range">
        <span>${label}</span>
        <input type="range" data-r="${field}" min="${min}" max="${max}" step="${step}" value="${value}">
        <output data-out="${field}">${value}${unit}</output>
      </label>`;
    const seg = (field, options) => `<div class="sta2e-tm-seg">${options.map(([v, label, icon]) =>
      `<button type="button" data-seg="${field}" data-value="${v}" class="${String(r[field]) === String(v) ? "is-active" : ""}">${icon ? `<i class="fas fa-${icon}"></i> ` : ""}${label}</button>`).join("")}</div>`;
    const eff = (key, label) => `<label class="sta2e-tm-check"><input type="checkbox" data-effect="${key}" ${(r.effects & RING_EFFECTS[key]) ? "checked" : ""}> ${label}</label>`;

    return `
      <div class="sta2e-tm" style="${getLcCssVars("tm")}" data-tool="${this._tool}" data-ring-mode="${r.ringMode}" data-fill-mode="${r.fillMode}" data-pips-mode="${r.pipsMode}" data-frame-kind="${BAKED_FRAMES[r.frameStyle] ? "builtin" : "custom"}">
        <header class="sta2e-tm-head">
          <div class="sta2e-tm-title"><i class="fas fa-wand-magic-sparkles"></i> Token Maker${this._lookName ? ` <span>— ${_esc(this._lookName)}</span>` : ""}</div>
          <label class="sta2e-tm-size">Size
            <select data-r="outSize">
              ${[256, 400, 512, 1024].map(s => `<option value="${s}" ${Number(r.outSize) === s ? "selected" : ""}>${s}px</option>`).join("")}
            </select>
          </label>
        </header>
        <div class="sta2e-tm-body">
          <nav class="sta2e-tm-rail">
            ${tool("move", "up-down-left-right", "Move — drag to pan, wheel to zoom, Shift+wheel to rotate")}
            ${tool("erase", "eraser", "Erase brush — paint to hide")}
            ${tool("restore", "paintbrush", "Restore brush — paint back, even outside the ring to pop out over it")}
            ${tool("magic", "wand-magic", "Magic eraser — click a background colour to erase it")}
            <span class="sta2e-tm-rail-gap"></span>
            <button type="button" class="sta2e-tm-tool" data-act="undo" data-tooltip="Undo mask"><i class="fas fa-rotate-left"></i></button>
            <button type="button" class="sta2e-tm-tool" data-act="redo" data-tooltip="Redo mask"><i class="fas fa-rotate-right"></i></button>
            <button type="button" class="sta2e-tm-tool" data-act="fit" data-tooltip="Re-frame on the face"><i class="fas fa-crosshairs"></i></button>
            <button type="button" class="sta2e-tm-tool is-danger" data-act="clear-masks" data-tooltip="Clear all brush work"><i class="fas fa-broom"></i></button>
          </nav>
          <div class="sta2e-tm-stage">
            <div class="sta2e-tm-canvas-wrap">
              <canvas class="sta2e-tm-canvas" width="${Number(r.outSize) || 512}" height="${Number(r.outSize) || 512}"></canvas>
              <div class="sta2e-tm-cursor"></div>
            </div>
            <div class="sta2e-tm-hint">
              <span data-hint="move">Drag to position · wheel to zoom · Shift+wheel to rotate</span>
              <span data-hint="erase">Paint over anything to hide it</span>
              <span data-hint="restore">Paint parts back — outside the ring they pop out over the frame</span>
              <span data-hint="magic">Click a background area to erase its colour</span>
            </div>
          </div>
          <aside class="sta2e-tm-panel">
            <section class="sta2e-tm-group">
              <header>Source</header>
              <div class="sta2e-tm-source">
                <span class="sta2e-tm-path" data-tooltip="${_esc(r.src)}">${_esc(decodeURIComponent(String(r.src).split("/").pop() ?? ""))}</span>
                <button type="button" data-act="src-library" data-tooltip="Art library"><i class="fas fa-images"></i></button>
                <button type="button" data-act="src-file" data-tooltip="File picker"><i class="fas fa-folder-open"></i></button>
              </div>
              ${range("zoom", 0.3, 4, 0.01, r.zoom, "Zoom", "×")}
              ${range("rotation", -180, 180, 1, r.rotation, "Rotate", "°")}
              <label class="sta2e-tm-check"><input type="checkbox" data-r="flipX" ${r.flipX ? "checked" : ""}> Flip horizontally</label>
            </section>

            <section class="sta2e-tm-group">
              <header>Mask</header>
              ${seg("shape", [["circle", "", "circle"], ["rounded", "", "square"], ["hexagon", "", "draw-polygon"], ["none", "None"]])}
              ${range("size", 0.3, 1, 0.01, r.size, "Size")}
              ${range("feather", 0, 12, 0.5, r.feather, "Feather", "px")}
              <div class="sta2e-tm-brushrow" data-show-tools="erase restore">
                ${range("brushSize", 4, 160, 1, this._brush.size, "Brush", "px")}
                ${range("brushHardness", 0, 0.95, 0.05, this._brush.hardness, "Hardness")}
              </div>
              <div data-show-tools="magic">${range("tolerance", 1, 60, 1, this._brush.tolerance, "Tolerance")}</div>
            </section>

            <section class="sta2e-tm-group">
              <header>Ring</header>
              ${seg("ringMode", [["none", "None"], ["image", "Image"], ["dynamic", "Dynamic"]])}
              <div data-show-ring="image" class="sta2e-tm-dyn">
                <label class="sta2e-tm-row">Frame
                  <select data-r="frameStyle">
                    ${Object.entries(BAKED_FRAMES).map(([id, f]) => `<option value="${id}" ${id === r.frameStyle ? "selected" : ""}>${_esc(f.name)}</option>`).join("")}
                    <option value="custom" ${BAKED_FRAMES[r.frameStyle] ? "" : "selected"}>Custom image…</option>
                  </select>
                </label>
                <label class="sta2e-tm-row" data-show-frame="builtin">Colour <input type="color" data-r="frameColor" value="${r.frameColor}"></label>
                <div class="sta2e-tm-swatches" data-show-frame="builtin">
                  ${[["#9c0000", "Command red"], ["#c8a03c", "Operations gold"], ["#2f6fb0", "Sciences blue"], ["#1f7a6d", "Sciences teal (TOS-era)"], ["#5a5a5a", "Grey"], ["#e0e0e0", "Silver"]]
                    .map(([c, t]) => `<button type="button" class="sta2e-tm-swatch" data-act="frame-swatch" data-color="${c}" data-tooltip="${t}" style="--tm-sw:${c}"></button>`).join("")}
                </div>
              </div>
              <div class="sta2e-tm-source" data-show-ring="image" data-show-frame="custom">
                <span class="sta2e-tm-path">${r.ringImage ? _esc(decodeURIComponent(r.ringImage.split("/").pop())) : "No ring image"}</span>
                <button type="button" data-act="ring-library" data-tooltip="Art library"><i class="fas fa-images"></i></button>
                <button type="button" data-act="ring-file" data-tooltip="File picker"><i class="fas fa-folder-open"></i></button>
              </div>
              <div data-show-ring="dynamic" class="sta2e-tm-dyn">
                <label class="sta2e-tm-row">Style
                  <select data-r="ringStyle">${styles.map(s => `<option value="${s.id}" ${s.id === r.ringStyle ? "selected" : ""}>${_esc(s.label)}</option>`).join("")}</select>
                </label>
                <p class="sta2e-tm-note" data-world-ring>
                  ${r.ringStyle === active.id
                    ? `<i class="fas fa-circle-check"></i> This is the world's ring style.`
                    : `<i class="fas fa-circle-info"></i> The world uses <b>${_esc(game.i18n.localize(active.label))}</b>. Rings use one style per world.
                       ${game.user.isGM ? `<button type="button" data-act="use-ring-style">Use this style</button>` : ""}`}
                </p>
                <label class="sta2e-tm-row">Ring <input type="color" data-r="ringColor" value="${r.ringColor}"></label>
                <label class="sta2e-tm-row">Background <input type="color" data-r="ringBg" value="${r.ringBg}"></label>
                ${range("subjectScale", 0.5, 2, 0.01, r.subjectScale, "Subject scale", "×")}
                <div class="sta2e-tm-effects">${eff("pulse", "Pulse")}${eff("gradient", "Gradient")}${eff("wave", "Background wave")}</div>
              </div>
            </section>

            <section class="sta2e-tm-group">
              <header>Rank Insignia</header>
              ${seg("pipsMode", [["none", "None"], ["auto", "From Rank"], ["manual", "Manual"]])}
              <p class="sta2e-tm-note" data-show-pips="auto">${this._rank
                ? (rankInsignia(this._rank)
                  ? `<i class="fas fa-circle-check"></i> <b>${_esc(this._rank)}</b> — ${_esc(insigniaLabel(rankInsignia(this._rank)))}`
                  : `<i class="fas fa-circle-info"></i> No collar insignia for <b>${_esc(this._rank)}</b> — use Manual.`)
                : `<i class="fas fa-circle-info"></i> This actor has no rank set — use Manual.`}</p>
              <div data-show-pips="manual" class="sta2e-tm-dyn" data-pips-kind="${r.pipsKind}">
                ${seg("pipsKind", [["officer", "Officer"], ["admiral", "Flag"], ["enlisted", "Enlisted"], ["cadet", "Cadet"]])}
                <label class="sta2e-tm-row" data-show-kind="officer">Grade
                  <select data-r="pipsOfficer">${OFFICER_RANKS.map(o => `<option value="${o.id}" ${Number(r.pipsOfficer) === o.id ? "selected" : ""}>${_esc(o.name)}</option>`).join("")}</select>
                </label>
                <label class="sta2e-tm-row" data-show-kind="admiral">Grade
                  <select data-r="pipsAdmiral">${ADMIRAL_RANKS.map(a => `<option value="${a.pips}" ${Number(r.pipsAdmiral) === a.pips ? "selected" : ""}>${_esc(a.name)}</option>`).join("")}</select>
                </label>
                <label class="sta2e-tm-row" data-show-kind="enlisted">Grade
                  <select data-r="pipsEnlisted">${ENLISTED_RANKS.map(e => `<option value="${e.id}" ${Number(r.pipsEnlisted) === e.id ? "selected" : ""}>${_esc(e.name)}</option>`).join("")}</select>
                </label>
                <div data-show-kind="cadet">${range("pipsCadet", 1, 4, 1, r.pipsCadet, "Year")}</div>
              </div>
            </section>

            <section class="sta2e-tm-group">
              <header>Emblem</header>
              <label class="sta2e-tm-row">Emblem
                <select data-r="emblemId">
                  <option value="" ${r.emblemId ? "" : "selected"}>None</option>
                  ${listEmblems().map(e => `<option value="${_esc(e.id)}" ${e.id === r.emblemId ? "selected" : ""}>${_esc(e.name)}</option>`).join("")}
                </select>
              </label>
              ${findEmblem(r.emblemId) && !findEmblem(r.emblemId).builtin ? seg("emblemFrame", [["disc", "Badge Disc"], ["plain", "Plain"]]) : ""}
              <div class="sta2e-tm-source">
                <button type="button" class="sta2e-tm-wide" data-act="emblem-add" data-tooltip="Add an image to the emblem library — PNG and JPG are converted to WebP"><i class="fas fa-plus"></i> Add Emblem</button>
                ${findEmblem(r.emblemId) && !findEmblem(r.emblemId).builtin && game.user.isGM
                  ? `<button type="button" data-act="emblem-remove" data-tooltip="Remove this emblem from the library (the image file stays)"><i class="fas fa-trash"></i></button>` : ""}
              </div>
            </section>

            <section class="sta2e-tm-group" data-hide-ring="dynamic">
              <header>Background</header>
              ${seg("fillMode", [["none", "None"], ["color", "Colour"], ["image", "Image"]])}
              <label class="sta2e-tm-row" data-show-fill="color">Colour <input type="color" data-r="fillColor" value="${r.fillColor}"></label>
              <div class="sta2e-tm-source" data-show-fill="image">
                <span class="sta2e-tm-path">${r.fillImage ? _esc(decodeURIComponent(r.fillImage.split("/").pop())) : "No image"}</span>
                <button type="button" data-act="fill-library" data-tooltip="Art library"><i class="fas fa-images"></i></button>
                <button type="button" data-act="fill-file" data-tooltip="File picker"><i class="fas fa-folder-open"></i></button>
              </div>
            </section>
          </aside>
        </div>
        <footer class="sta2e-tm-footer">
          <label class="sta2e-tm-filename" data-tooltip="Saved next to the portrait. A number is added if the name is taken.">File name
            <input type="text" data-r="fileName" value="${_esc(r.fileName ?? "")}" placeholder="${_esc(tokenFileNames(r.src, []).name.replace(/\.webp$/, ""))}" spellcheck="false">
            <span class="sta2e-tm-muted">.webp</span>
          </label>
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" data-act="save" class="is-primary"><i class="fas fa-floppy-disk"></i> Save Token</button>
        </footer>
      </div>`;
  }

  _replaceHTML(result, element) {
    (element.querySelector(".window-content") ?? element).innerHTML = result;
  }

  /**
   * Every render replaces the canvas element, so its pointer handlers are
   * re-attached here; the panel's own handlers are delegated on the app root
   * once, in `_onFirstRender`.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this._wireCanvas();
    if (this._srcCanvas) {
      this._syncInputs();
      this._requestDraw();
    }
  }

  async _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._wire();
    try {
      await this._loadSource(this.r.src);
      if (!this._recipeGiven) Object.assign(this.r, autoFit(this._srcCanvas.width, this._srcCanvas.height, 512));
      if (this.r.maskPath) await this._loadMasks(this.r.maskPath);
      await Promise.all([this._loadFrame(), this._loadFill(), this._loadRing(), this._loadEmblem()]);
      this._syncInputs();
      this._requestDraw();
    } catch (err) {
      ui.notifications.error(`Token Maker: ${err.message}`);
    }
  }

  /** Push recipe values back into the controls (after auto-fit or a reload). */
  _syncInputs() {
    const root = this.element;
    for (const el of root.querySelectorAll("[data-r]")) {
      const v = this.r[el.dataset.r];
      if (el.type === "checkbox") el.checked = !!v;
      else if (v !== undefined) el.value = v;
      const out = root.querySelector(`[data-out="${el.dataset.r}"]`);
      if (out && v !== undefined) out.textContent = this._fmt(el.dataset.r, v);
    }
  }

  _fmt(field, v) {
    const n = Number(v);
    if (field === "zoom" || field === "subjectScale") return `${n.toFixed(2)}×`;
    if (field === "rotation") return `${Math.round(n)}°`;
    if (field === "feather" || field === "brushSize") return `${n}px`;
    if (field === "size" || field === "brushHardness") return n.toFixed(2);
    return String(v);
  }

  _setRoot(attr, value) {
    const root = this.element.querySelector(".sta2e-tm");
    if (root) root.dataset[attr] = value;
  }

  _wire() {
    const el = this.element;

    el.addEventListener("input", (ev) => {
      const t = ev.target;
      const f = t.dataset.r;
      if (!f) return;
      const brushField = { brushSize: "size", brushHardness: "hardness", tolerance: "tolerance" }[f];
      const value = t.type === "checkbox" ? t.checked : (t.type === "range" ? Number(t.value) : t.value);
      if (brushField) this._brush[brushField] = value;
      else this.r[f] = value;
      const out = el.querySelector(`[data-out="${f}"]`);
      if (out) out.textContent = this._fmt(f, value);
      if (f === "brushSize") this._updateCursorSize();
      if (f !== "outSize" && f !== "fileName") this._requestDraw();
    });

    el.addEventListener("change", async (ev) => {
      const t = ev.target;
      if (t.dataset.effect) {
        const bit = RING_EFFECTS[t.dataset.effect];
        this.r.effects = ((this.r.effects | 1) & ~bit) | (t.checked ? bit : 0);
        return;
      }
      if (t.dataset.r === "outSize") {
        this.r.outSize = Number(t.value);
        const c = el.querySelector(".sta2e-tm-canvas");
        c.width = c.height = this.r.outSize;
        this._requestDraw();
      }
      if (t.dataset.r === "ringStyle") {
        this.r.ringStyle = t.value;
        await this._loadRing();
        this._fitSizeToRing();
        this.render();   // refresh the "world style" note
        return;
      }
      if (t.dataset.r === "flipX") this._requestDraw();
      if (t.dataset.r === "frameStyle") {
        this.r.frameStyle = t.value;
        this._setRoot("frameKind", BAKED_FRAMES[t.value] ? "builtin" : "custom");
        // A frame whose look depends on its colour brings that colour with it.
        if (BAKED_FRAMES[t.value]?.color) this._setValue("frameColor", BAKED_FRAMES[t.value].color);
        if (this._bakedFrame()) this._fitSizeToFrame();
        await this._loadFrame();
        this._requestDraw();
        return;
      }
      if (t.dataset.r === "emblemId") {
        this.r.emblemId = t.value;
        await this._loadEmblem();
        this.render();   // the frame row and Remove key depend on the emblem
      }
    });

    el.addEventListener("click", async (ev) => {
      const toolBtn = ev.target.closest("[data-tool]");
      if (toolBtn && toolBtn.classList.contains("sta2e-tm-tool")) {
        this._tool = toolBtn.dataset.tool;
        for (const b of el.querySelectorAll(".sta2e-tm-tool[data-tool]")) b.classList.toggle("is-active", b === toolBtn);
        this._setRoot("tool", this._tool);
        this._requestDraw();
        return;
      }
      const segBtn = ev.target.closest("[data-seg]");
      if (segBtn) {
        const field = segBtn.dataset.seg;
        this.r[field] = segBtn.dataset.value;
        for (const b of segBtn.parentElement.children) b.classList.toggle("is-active", b === segBtn);
        if (field === "ringMode") {
          this._setRoot("ringMode", this.r.ringMode);
          // A dynamic ring is drawn round the outside of the subject, so the
          // subject should end just inside the colour band; a baked frame wants
          // it nearly full size.
          await Promise.all([this._loadRing(), this._loadFrame()]);
          if (this.r.ringMode === "dynamic") this._fitSizeToRing();
          else if (this._bakedFrame()) this._fitSizeToFrame();
          else if (this.r.size < 0.7) this._setValue("size", 0.86);
        }
        if (field === "fillMode") { this._setRoot("fillMode", this.r.fillMode); await this._loadFill(); }
        if (field === "pipsMode") this._setRoot("pipsMode", this.r.pipsMode);
        if (field === "pipsKind") {
          const box = segBtn.closest("[data-pips-kind]");
          if (box) box.dataset.pipsKind = this.r.pipsKind;
        }
        this._requestDraw();
        return;
      }
      const act = ev.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      switch (act) {
        case "undo": this._swapState(this._undo, this._redo); break;
        case "redo": this._swapState(this._redo, this._undo); break;
        case "fit":
          Object.assign(this.r, autoFit(this._srcCanvas.width, this._srcCanvas.height, 512));
          this._syncInputs();
          this._requestDraw();
          break;
        case "clear-masks":
          this._snapshot();
          for (const c of [this._restore, this._erase]) c.getContext("2d").clearRect(0, 0, c.width, c.height);
          this._requestDraw();
          break;
        case "src-library":
        case "src-file": {
          const path = act === "src-library" ? await pickArt({ slot: "portrait" }) : await pickImageFile(this.r.src);
          if (!path) break;
          try {
            await this._loadSource(path);
            this.r.src = path;
            Object.assign(this.r, autoFit(this._srcCanvas.width, this._srcCanvas.height, 512));
            this.render();
            this._requestDraw();
          } catch (err) { ui.notifications.error(`Token Maker: ${err.message}`); }
          break;
        }
        case "ring-library":
        case "ring-file": {
          const path = act === "ring-library" ? await pickArt({ query: "ring" }) : await pickImageFile(this.r.ringImage);
          if (!path) break;
          this.r.ringImage = path;
          await this._loadFrame();
          this.render();
          this._requestDraw();
          break;
        }
        case "fill-library":
        case "fill-file": {
          const path = act === "fill-library" ? await pickArt({}) : await pickImageFile(this.r.fillImage);
          if (!path) break;
          this.r.fillImage = path;
          await this._loadFill();
          this.render();
          this._requestDraw();
          break;
        }
        case "use-ring-style":
          await game.settings.set("core", "dynamicTokenRing", this.r.ringStyle);
          ui.notifications.info("World ring style changed — it takes effect after everyone reloads.");
          this.render();
          break;
        case "frame-swatch": {
          const color = ev.target.closest("[data-color]")?.dataset.color;
          if (color) { this._setValue("frameColor", color); this._requestDraw(); }
          break;
        }
        case "emblem-add": await this._addEmblem(); break;
        case "emblem-remove": {
          const e = findEmblem(this.r.emblemId);
          if (!e || e.builtin) break;
          await removeEmblemFromLibrary(e.id);
          this.r.emblemId = "";
          this._emblemImg = null;
          this.render();
          break;
        }
        case "cancel": this.close(); break;
        case "save": await this._save(); break;
      }
    });

  }

  _setValue(field, value) {
    this.r[field] = value;
    const input = this.element.querySelector(`[data-r="${field}"]`);
    if (input) input.value = value;
    const out = this.element.querySelector(`[data-out="${field}"]`);
    if (out) out.textContent = this._fmt(field, value);
  }

  _updateCursorSize() {
    const canvas = this.element.querySelector(".sta2e-tm-canvas");
    const cursor = this.element.querySelector(".sta2e-tm-cursor");
    if (!canvas || !cursor) return;
    const rect = canvas.getBoundingClientRect();
    const d = (this._brush.size * (canvas.width / 512)) * (rect.width / canvas.width);
    cursor.style.width = cursor.style.height = `${d}px`;
  }

  _wireCanvas() {
    const el = this.element;
    const canvas = el.querySelector(".sta2e-tm-canvas");
    const cursor = el.querySelector(".sta2e-tm-cursor");
    let drag = null;

    canvas.addEventListener("pointerdown", (ev) => {
      if (!this._srcCanvas || ev.button !== 0) return;
      canvas.setPointerCapture(ev.pointerId);
      const pt = this._outPoint(ev);
      if (this._tool === "magic") { this._magic(pt); return; }
      if (this._tool === "move") {
        drag = { mode: "move", start: pt, x: this.r.x, y: this.r.y };
        return;
      }
      this._snapshot();
      drag = { mode: "brush", last: pt };
      this._stroke(pt, pt);
    });
    canvas.addEventListener("pointermove", (ev) => {
      const rect = canvas.getBoundingClientRect();
      cursor.style.left = `${ev.clientX - rect.left}px`;
      cursor.style.top = `${ev.clientY - rect.top}px`;
      if (!drag) return;
      const pt = this._outPoint(ev);
      if (drag.mode === "move") {
        const S = canvas.width;
        this.r.x = drag.x + (pt[0] - drag.start[0]) / S;
        this.r.y = drag.y + (pt[1] - drag.start[1]) / S;
        this._requestDraw();
      } else {
        this._stroke(drag.last, pt);
        drag.last = pt;
      }
    });
    const end = (ev) => {
      drag = null;
      try { canvas.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerenter", () => this._updateCursorSize());

    canvas.addEventListener("wheel", (ev) => {
      if (!this._srcCanvas) return;
      ev.preventDefault();
      if (ev.shiftKey) {
        this._setValue("rotation", Math.max(-180, Math.min(180, Math.round(Number(this.r.rotation) + Math.sign(ev.deltaY) * 2))));
      } else {
        // Zoom about the pointer: keep the source point under it fixed.
        const S = canvas.width;
        const pt = this._outPoint(ev);
        const before = applyMatrix(invertMatrix(this._matrix(S)), pt[0], pt[1]);
        const zoom = Math.max(0.3, Math.min(4, Number(this.r.zoom) * Math.pow(1.0015, -ev.deltaY)));
        this._setValue("zoom", Math.round(zoom * 100) / 100);
        const after = applyMatrix(this._matrix(S), before[0], before[1]);
        this.r.x += (pt[0] - after[0]) / S;
        this.r.y += (pt[1] - after[1]) / S;
      }
      this._requestDraw();
    }, { passive: false });
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  /** `where` is a folder path or a resolved storage location (file-storage.js). */
  async _upload(where, file) {
    return uploadFile(where, file);
  }

  async _existing(where) {
    try {
      return ((await browseFolder(where))?.files ?? []).map(f => {
        const name = String(f).split(/[?#]/)[0].split("/").pop();
        try { return decodeURIComponent(name); } catch { return name; }
      });
    } catch { return []; }
  }

  /**
   * The portrait's own folder as a place to save into, or null. Resolves URLs
   * too — a Forge Assets Library or S3 portrait gets its token beside it rather
   * than always falling back to the world folder.
   */
  _portraitFolder() {
    const loc = storageForFile(this.r.src);
    return loc && isWritableNextTo(`${loc.target}/x`) ? loc : null;
  }

  /** Restore in R, erase in G — one small PNG that brings the brush work back. */
  _maskPng() {
    const w = this._srcCanvas.width, h = this._srcCanvas.height;
    const r = this._restore.getContext("2d").getImageData(0, 0, w, h).data;
    const e = this._erase.getContext("2d").getImageData(0, 0, w, h).data;
    let any = false;
    const out = new ImageData(w, h);
    for (let i = 0; i < r.length; i += 4) {
      out.data[i] = r[i + 3];
      out.data[i + 1] = e[i + 3];
      out.data[i + 3] = 255;
      if (r[i + 3] || e[i + 3]) any = true;
    }
    if (!any) return null;
    const c = makeCanvas(w, h);
    c.getContext("2d").putImageData(out, 0, 0);
    return c;
  }

  async _save() {
    if (!this._srcCanvas) return;
    const btn = this.element.querySelector('[data-act="save"]');
    if (btn) btn.disabled = true;
    try {
      const S = Number(this.r.outSize) || 512;
      const token = this._compose(S, { preview: false });
      const blob = await new Promise(res => token.toBlob(res, "image/webp", 0.92));
      if (!blob) throw new Error("could not encode the token image");

      const fallback = `worlds/${game.world.id}/sta2e-tokens`;
      const near = this._portraitFolder();
      let where = near ?? fallback;
      const name = this.r.fileName;
      let names = tokenFileNames(this.r.src, await this._existing(where), fallback, { forceFallback: !near, name });
      let tokenPath;
      try {
        tokenPath = await this._upload(where, new File([blob], names.name, { type: "image/webp" }));
      } catch {
        if (names.fellBack) throw new Error("could not save the token — check file upload permissions");
        // The portrait's folder refused the write; use the world folder instead.
        where = fallback;
        names = tokenFileNames(this.r.src, await this._existing(fallback), fallback, { forceFallback: true, name });
        tokenPath = await this._upload(where, new File([blob], names.name, { type: "image/webp" }));
      }
      if (names.fellBack) ui.notifications.info(`Token saved to ${fallback} — the portrait's own folder isn't writable.`);

      let maskPath = null;
      const mask = this._maskPng();
      if (mask) {
        const mblob = await new Promise(res => mask.toBlob(res, "image/png"));
        try { maskPath = await this._upload(where, new File([mblob], names.mask, { type: "image/png" })); }
        catch { /* the token still saved; only re-editing loses the brush work */ }
      }

      const dynamic = this.r.ringMode === "dynamic";
      const { ringImage, fillImage, ...rest } = this.r;
      const result = {
        token: tokenPath,
        ring: dynamic
          ? { enabled: true, ringColor: this.r.ringColor, backgroundColor: this.r.ringBg, effects: this.r.effects | 1, subjectScale: this.r.subjectScale }
          : { enabled: false },
        maker: { ...rest, ringImage, fillImage, maskPath },
      };
      this._done = true;
      this._resolve?.(result);
      ui.notifications.info(`Token saved: ${tokenPath}`);
      this.close();
    } catch (err) {
      ui.notifications.error(`Token Maker: ${err.message}`);
      if (btn) btn.disabled = false;
    }
  }

  async close(options) {
    if (!this._done) this._resolve?.(null);
    this._done = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    return super.close(options);
  }
}

/**
 * Open the Token Maker. Resolves `{token, ring, maker}` once a token is saved,
 * or null if the window is closed without saving.
 *
 * @param {object} opts
 * @param {string} opts.source         The portrait to start from
 * @param {object|null} [opts.recipe]  A look's saved `maker` recipe
 * @param {object|null} [opts.ring]    The look's current ring
 * @param {string} [opts.lookName]
 * @param {string} [opts.rank]       The actor's rank text (system.rank), for pips
 */
export function openTokenMaker({ source, recipe = null, ring = null, lookName = "", rank = "" } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can make tokens.");
    return Promise.resolve(null);
  }
  if (!source && !recipe?.src) {
    ui.notifications.warn("Give the look a portrait first — the Token Maker builds the token from it.");
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    new TokenMakerApp({ source, recipe, ring, lookName, rank, resolve }).render(true);
  });
}
