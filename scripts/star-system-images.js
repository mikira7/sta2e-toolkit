/**
 * sta2e-toolkit | star-system-images.js
 * GM configuration for Star System type image pools.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const MODULE_ID = "sta2e-toolkit";
export const STAR_SYSTEM_IMAGE_SETTING = "starSystemImageData";

export const STAR_SYSTEM_STAR_IMAGE_TYPES = [
  { key: "O", label: "Type-O Blue-Hot" },
  { key: "B", label: "Type-B Blue-White" },
  { key: "A", label: "Type-A White" },
  { key: "F", label: "Type-F Yellow-White" },
  { key: "G", label: "Type-G Yellow" },
  { key: "K", label: "Type-K Orange" },
  { key: "M", label: "Type-M Red" },
  { key: "L", label: "Type-L Brown Dwarf" },
  { key: "Y", label: "Type-Y Brown Dwarf" },
  { key: "T", label: "Type-T Brown Dwarf" },
  { key: "White Dwarf", label: "White Dwarf" },
  { key: "T-Tauri", label: "T-Tauri" },
];

export const STAR_SYSTEM_PLANET_IMAGE_TYPES = [
  { key: "A", label: "Class-A Geothermal" },
  { key: "B", label: "Class-B Geomorteus" },
  { key: "C", label: "Class-C Icy Geoinactive" },
  { key: "D", label: "Class-D Barren" },
  { key: "E", label: "Class-E Geoplastic" },
  { key: "F", label: "Class-F Primordial" },
  { key: "G", label: "Class-G Developing" },
  { key: "H", label: "Class-H Desert" },
  { key: "I", label: "Class-I Hot Jupiter" },
  { key: "J", label: "Class-J Jovian" },
  { key: "K", label: "Class-K Adaptable" },
  { key: "L", label: "Class-L Marginal" },
  { key: "M", label: "Class-M Terrestrial" },
  { key: "N", label: "Class-N Reducing" },
  { key: "O", label: "Class-O Ocean" },
  { key: "P", label: "Class-P Glaciated" },
  { key: "Q", label: "Class-Q Variable" },
  { key: "R", label: "Class-R Rogue" },
  { key: "S", label: "Class-S Super-Jovian" },
  { key: "T", label: "Class-T Super-Jovian" },
  { key: "Y", label: "Class-Y Demon" },
  { key: "Belt", label: "Asteroid Belt" },
];

function cleanImageList(value) {
  const list = Array.isArray(value) ? value : [];
  return Array.from(new Set(list.map(path => String(path ?? "").trim()).filter(Boolean)));
}

function keyedImageRows(types, stored = {}) {
  return Object.fromEntries(types.map(type => [type.key, cleanImageList(stored?.[type.key])]));
}

export function normalizeStarSystemImageData(raw = {}) {
  return {
    stars: keyedImageRows(STAR_SYSTEM_STAR_IMAGE_TYPES, raw?.stars),
    planets: keyedImageRows(STAR_SYSTEM_PLANET_IMAGE_TYPES, raw?.planets),
  };
}

export function getStarSystemImageData() {
  try {
    return normalizeStarSystemImageData(game.settings.get(MODULE_ID, STAR_SYSTEM_IMAGE_SETTING));
  } catch (_error) {
    return normalizeStarSystemImageData();
  }
}

export function imagesForStarSystemType(kind, key) {
  const data = getStarSystemImageData();
  const group = kind === "star" ? data.stars : data.planets;
  return cleanImageList(group?.[String(key ?? "").trim()]);
}

export function pickStarSystemImage(kind, key) {
  const images = imagesForStarSystemType(kind, key);
  if (!images.length) return "";
  return images[Math.floor(Math.random() * images.length)] ?? "";
}

// ---------------------------------------------------------------------------
// Multi-star composite portraits
// ---------------------------------------------------------------------------
// Binary/trinary systems combine each star's art into one image for the actor
// portrait and token instead of showing only the primary. The composite is
// drawn on an offscreen canvas with additive ("lighter") blending — star art on
// black or transparent backgrounds merges naturally — then uploaded once to
// the world's data directory under a deterministic content-hashed filename, so
// repeat saves of the same star combination reuse the same file.

// hash -> uploaded path, per session (avoids re-uploading on every sheet save)
const _compositeCache = new Map();

// Center-x, center-y, and size as fractions of the square canvas. Primary star
// first, companions arranged around it, shrinking with count. Capped at 4.
const _COMPOSITE_LAYOUTS = {
  2: [
    { x: 0.40, y: 0.50, s: 0.72 },
    { x: 0.74, y: 0.30, s: 0.42 },
  ],
  3: [
    { x: 0.38, y: 0.52, s: 0.66 },
    { x: 0.74, y: 0.28, s: 0.40 },
    { x: 0.76, y: 0.74, s: 0.32 },
  ],
  4: [
    { x: 0.36, y: 0.54, s: 0.62 },
    { x: 0.72, y: 0.26, s: 0.38 },
    { x: 0.78, y: 0.72, s: 0.30 },
    { x: 0.30, y: 0.20, s: 0.26 },
  ],
};

function _hashPaths(paths) {
  let hash = 5381;
  const text = paths.join("|");
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function _loadCompositeImage(path) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = path;
  });
}

/**
 * Compose 2+ star images into a single portrait and upload it to the world's
 * data directory. Returns the uploaded path, or "" on any failure so callers
 * can fall back to the primary star image.
 *
 * @param {string[]} paths      star image paths, primary first
 * @param {string} [knownPath]  current actor.img — reused when it already is
 *                              this exact composite (skips canvas + upload)
 * @returns {Promise<string>}
 */
export async function composeStarSystemImage(paths, knownPath = "") {
  try {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean).slice(0, 4);
    if (list.length < 2) return "";
    // Uploading needs file permissions — players without them keep the fallback.
    if (!(game.user?.isGM || game.user?.can?.("FILES_UPLOAD"))) return "";

    const hash = _hashPaths(list);
    const fileName = `sta2e-stars-${hash}.webp`;
    if (knownPath && String(knownPath).includes(fileName)) return knownPath;
    if (_compositeCache.has(hash)) return _compositeCache.get(hash);

    const loaded = (await Promise.all(list.map(_loadCompositeImage))).filter(Boolean);
    if (loaded.length < 2) return "";

    const SIZE = 512;
    const canvasEl = document.createElement("canvas");
    canvasEl.width = SIZE;
    canvasEl.height = SIZE;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return "";
    ctx.globalCompositeOperation = "lighter";

    const layout = _COMPOSITE_LAYOUTS[Math.min(loaded.length, 4)];
    loaded.forEach((img, i) => {
      const spot = layout[i];
      if (!spot) return;
      const box = spot.s * SIZE;
      const w = img.naturalWidth || box;
      const h = img.naturalHeight || box;
      const scale = box / Math.max(w, h);
      const dw = w * scale;
      const dh = h * scale;
      ctx.drawImage(img, spot.x * SIZE - dw / 2, spot.y * SIZE - dh / 2, dw, dh);
    });

    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, "image/webp", 0.92));
    if (!blob) return "";

    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const dir = `worlds/${game.world.id}/sta2e-star-composites`;
    try { await FP.createDirectory("data", dir); } catch { /* already exists */ }
    const file = new File([blob], fileName, { type: "image/webp" });
    const result = await FP.upload("data", dir, file, {}, { notify: false });
    const path = result?.path ? String(result.path) : "";
    if (path) _compositeCache.set(hash, path);
    return path;
  } catch (err) {
    console.warn("STA2e Toolkit | star composite failed:", err);
    return "";
  }
}

function contextRows(types, stored) {
  return types.map(type => ({
    ...type,
    images: cleanImageList(stored?.[type.key]).map((path, index) => ({ path, index })),
  }));
}

export class StarSystemImagesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sta2e-star-system-images-config",
    tag: "div",
    classes: ["sta2e-star-system-images-window"],
    window: { title: "Star System Images", resizable: true },
    position: { width: 860, height: 620 },
    actions: {
      save: StarSystemImagesConfig._onSave,
      cancel: StarSystemImagesConfig._onCancel,
      addImage: StarSystemImagesConfig._onAddImage,
      deleteImage: StarSystemImagesConfig._onDeleteImage,
    },
  };

  static PARTS = {
    config: { template: "modules/sta2e-toolkit/templates/star-system-images.hbs" },
  };

  async _prepareContext(_options) {
    const data = getStarSystemImageData();
    return {
      stars: contextRows(STAR_SYSTEM_STAR_IMAGE_TYPES, data.stars),
      planets: contextRows(STAR_SYSTEM_PLANET_IMAGE_TYPES, data.planets),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    this._bindImageControls(el);
  }

  _bindImageControls(root) {
    const syncPreview = input => {
      const row = input.closest("[data-image-entry]");
      const img = row?.querySelector("[data-image-preview]");
      const path = input.value.trim();
      if (img) {
        img.src = path;
        img.hidden = !path;
      }
    };

    root.querySelectorAll("[data-image-path]").forEach(input => {
      syncPreview(input);
      input.addEventListener("input", () => syncPreview(input));
      input.addEventListener("change", () => syncPreview(input));
    });

    root.querySelectorAll("[data-browse-image]").forEach(button => {
      button.addEventListener("click", () => {
        const row = button.closest("[data-image-entry]");
        const input = row?.querySelector("[data-image-path]");
        if (!input || typeof FilePicker !== "function") return;
        new FilePicker({
          type: "image",
          current: input.value || "",
          callback: path => {
            input.value = path;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          },
        }).render(true);
      });
    });
  }

  _appendImageRow(typeRow) {
    const list = typeRow?.querySelector(".sta2e-ssi-image-list");
    if (!list) return;
    list.querySelector(".sta2e-ssi-empty")?.remove();
    const row = document.createElement("div");
    row.className = "sta2e-ssi-image-entry";
    row.dataset.imageEntry = "";
    row.innerHTML = `
      <div class="sta2e-ssi-image-media">
        <img src="" alt="" data-image-preview hidden />
        <input type="text" data-image-path value="" placeholder="path/to/image.webp" />
      </div>
      <div class="sta2e-ssi-image-actions">
        <button type="button" data-browse-image title="Browse image"><i class="fas fa-folder-open"></i></button>
        <button type="button" data-action="deleteImage" title="Remove image"><i class="fas fa-trash"></i></button>
      </div>`;
    list.appendChild(row);
    this._bindImageControls(row);
    row.querySelector("[data-image-path]")?.focus();
  }

  static async _onSave(_event, _target) {
    const el = this.element;
    const data = normalizeStarSystemImageData();
    for (const row of el.querySelectorAll("[data-image-type-row]")) {
      const kind = row.dataset.kind === "star" ? "stars" : "planets";
      const key = row.dataset.key;
      data[kind][key] = cleanImageList(Array.from(row.querySelectorAll("[data-image-path]")).map(input => input.value));
    }
    await game.settings.set(MODULE_ID, STAR_SYSTEM_IMAGE_SETTING, data);
    this.close();
  }

  static _onCancel(_event, _target) {
    this.close();
  }

  static async _onAddImage(_event, target) {
    this._appendImageRow(target.closest("[data-image-type-row]"));
  }

  static async _onDeleteImage(_event, target) {
    const entry = target.closest("[data-image-entry]");
    const list = entry?.closest(".sta2e-ssi-image-list");
    entry?.remove();
    if (list && !list.querySelector("[data-image-entry]")) {
      const empty = document.createElement("div");
      empty.className = "sta2e-ssi-empty";
      empty.textContent = "No images configured.";
      list.appendChild(empty);
    }
  }
}
