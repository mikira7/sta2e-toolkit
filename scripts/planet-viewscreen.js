/** Local orbital compositions. Previewing never uploads or changes a document. */
import { normalizePlanetRecipe, renderPlanetPixelsAsync, planetSeedHash } from "./planet-generator.js";
import { getStarSystemBackgrounds } from "./star-system-images.js";
import { RING_BODY_SCALE } from "./gas-giant-material.js";
import { createPlanetRenderProgress } from "./planet-render-progress.js";

const MODULE_ID = "sta2e-toolkit";
const VIEWSCREEN_TYPE = "sta2e-toolkit.warpViewscreen";
export const PLANET_VIEW_PRESETS = Object.freeze({
  full: { label: "Full Planet", size: 70, x: 50, y: 50 },
  close: { label: "Close Orbit", size: 145, x: 25, y: 65 },
  horizon: { label: "Horizon", size: 380, x: 50, y: 215 },
});
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function normalizePlanetView(raw = {}) {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  raw ||= {};
  const preset = Object.hasOwn(PLANET_VIEW_PRESETS, raw.preset) ? raw.preset : "full";
  const defaults = PLANET_VIEW_PRESETS[preset];
  return { preset, size: bounded(raw.size ?? defaults.size, defaults.size, 10, 500),
    x: bounded(raw.x ?? defaults.x, defaults.x, -150, 250), y: bounded(raw.y ?? defaults.y, defaults.y, -200, 300),
    phase: bounded(raw.phase ?? 65, 65, 0, 180), direction: bounded(raw.direction ?? 0, 0, 0, 360),
    background: String(raw.background ?? "__stars"), source: raw.source === "existing" ? "existing" : "procedural",
    width: Number(raw.width) === 3840 ? 3840 : 1920 };
}

export function planetViewStars(seed, count = 550) {
  let state = planetSeedHash(`${seed}:viewscreen`);
  // Mix the seed before each sample; adjacent FNV suffixes correlate visibly.
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => {
    return { x: random(), y: random(), radius: .35 + random() * 1.1, alpha: .2 + random() * .65 };
  });
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  if (!canvas.getContext("2d")) throw new Error("Canvas rendering is unavailable.");
  return canvas;
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = src;
  });
}
function drawCover(ctx, image, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  ctx.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
}

export async function renderPlanetView(body, raw, { preview = false, onProgress } = {}) {
  const settings = normalizePlanetView(raw);
  const width = preview ? 640 : settings.width, height = width * 9 / 16;
  const canvas = makeCanvas(width, height), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#02050c"; ctx.fillRect(0, 0, width, height);
  let texture;
  try {
    if (settings.background === "__stars") {
      for (const star of planetViewStars(body.id || body.name)) {
        ctx.fillStyle = `rgba(210,225,255,${star.alpha})`;
        ctx.beginPath(); ctx.arc(star.x * width, star.y * height, star.radius * width / 1920, 0, Math.PI * 2); ctx.fill();
      }
    } else if (settings.background && settings.background !== "__black") {
      drawCover(ctx, await loadImage(settings.background), width, height);
    }
    let bodyScale = 1;
    if (settings.source === "existing") {
      if (!body.image) throw new Error("This planet has no existing artwork. Select Procedural planet.");
      texture = await loadImage(body.image);
    } else {
      const recipe = normalizePlanetRecipe(body.procedural || { seed: body.id || body.name }, body);
      recipe.phaseAngle = settings.phase;
      bodyScale = recipe.rings ? RING_BODY_SCALE : recipe.style === "asteroid" ? .85 : 1;
      // Render only visible pixels when a close orbit would enlarge a capped
      // whole-globe texture. Radius stays in output pixels, preserving detail.
      if (!["star", "asteroid"].includes(recipe.style)) {
        const diameter = height * settings.size / 100 / bodyScale;
        const rendered = await renderPlanetPixelsAsync(recipe, width, { view: "portrait", lightDirection: settings.direction, onProgress,
          viewport: { width, height, radius: diameter * .48 * bodyScale, cx: width * settings.x / 100, cy: height * settings.y / 100 } });
        texture = makeCanvas(rendered.width, rendered.height);
        texture.getContext("2d").putImageData(new ImageData(rendered.pixels, rendered.width, rendered.height), 0, 0);
        ctx.drawImage(texture, 0, 0);
        return canvas;
      }
      const textureSize = preview ? Math.min(1024, Math.max(384, Math.ceil(height * settings.size / 100 / bodyScale)))
        : Math.min(4096, Math.max(1024, Math.ceil(height * settings.size / 100 / bodyScale)));
      const rendered = await renderPlanetPixelsAsync(recipe, textureSize, { view: "portrait", lightDirection: settings.direction, onProgress });
      texture = makeCanvas(rendered.width, rendered.height ?? rendered.width);
      texture.getContext("2d").putImageData(new ImageData(rendered.pixels, rendered.width, rendered.width), 0, 0);
    }
    const size = height * settings.size / 100 / bodyScale;
    const textureHeight = size * texture.height / texture.width;
    ctx.drawImage(texture, width * settings.x / 100 - size / 2, height * settings.y / 100 - textureHeight / 2, size, textureHeight);
    return canvas;
  } catch (error) { canvas.width = canvas.height = 0; throw error; }
  finally { if (texture?.tagName === "CANVAS") texture.width = texture.height = 0; }
}

export async function savePlanetView(body, actorId, raw) {
  if (!game.user?.isGM) throw new Error("Only the GM can export planet views.");
  if (!actorId || !body.id) throw new Error("A saved system and planet are required.");
  const settings = normalizePlanetView(raw);
  const progress = createPlanetRenderProgress(`Generating ${body.name || "planet"} — viewscreen`);
  let canvas;
  try {
    canvas = await renderPlanetView(body, settings, { onProgress: value => progress.update(value * 90, "Rendering viewscreen image") });
    progress.update(90, "Encoding viewscreen image");
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .95));
    if (!blob) throw new Error("Could not encode the planet view.");
    const safe = value => String(value).replace(/[^A-Za-z0-9_-]/g, "");
    const directory = `worlds/${game.world.id}/sta2e-procedural-planets`;
    const filename = `sta2e-view-${safe(actorId)}-${safe(body.id)}-${foundry.utils.randomID()}.webp`;
    const FP = foundry.applications.apps.FilePicker.implementation;
    try { await FP.createDirectory("data", directory); } catch { /* Upload supplies the actionable error. */ }
    progress.update(95, "Uploading viewscreen image");
    const result = await FP.upload("data", directory, new File([blob], filename, { type: "image/webp" }), {}, { notify: false });
    if (!result?.path) throw new Error("Planet view upload failed. Check the world's file upload permissions.");
    progress.complete();
    return { viewscreenImage: result.path, viewscreenComposition: JSON.stringify(settings) };
  } catch (error) { progress.fail(); throw error; }
  finally { if (canvas) canvas.width = canvas.height = 0; }
}

export function planetViewTargets() {
  const targets = [];
  for (const scene of game.scenes ?? []) for (const region of scene.regions ?? []) {
    for (const behavior of region.behaviors ?? []) if (behavior.type === VIEWSCREEN_TYPE) {
      targets.push({ id: `${scene.id}/${region.id}/${behavior.id}`, label: `${scene.name} / ${region.name} / ${behavior.name || "Viewscreen"}`, behavior });
    }
  }
  return targets;
}

export async function addPlanetViewToLibrary(behavior, src, label) {
  if (!game.user?.isGM) throw new Error("Only the GM can add viewscreen images.");
  if (behavior?.type !== VIEWSCREEN_TYPE) throw new Error("The selected viewscreen is no longer available.");
  const images = Array.from(behavior.system.images ?? [], entry => ({
    ...foundry.utils.deepClone(entry.toObject ? entry.toObject() : entry),
  }));
  if (images.some(entry => entry.src === src)) return;
  images.push({ id: foundry.utils.randomID(), label, src, fit: "cover", scale: 100, offsetX: 0, offsetY: 0, alpha: 100, above: true });
  // Deliberately update only the library, never activeImage or live image fields.
  await behavior.update({ "system.images": images });
}

/** Returns exported metadata; caller persists it before optional library insertion. */
export async function promptPlanetView(body, actorId) {
  if (!game.user?.isGM) return null;
  const initial = normalizePlanetView(body.viewscreenComposition || {
    phase: normalizePlanetRecipe(body.procedural || {}, body).phaseAngle,
    source: body.procedural || !body.image ? "procedural" : "existing",
  });
  const backgrounds = [...new Set([initial.background, ...getStarSystemBackgrounds()])].filter(src => src && !src.startsWith("__"));
  const targets = planetViewTargets();
  const select = (name, label, entries, selected) => `<label>${label}<select name="${name}">${entries.map(([value, text]) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
  const slider = (name, label, min, max) => `<label>${label} <output data-output="${name}">${initial[name]}</output><input type="range" name="${name}" min="${min}" max="${max}" value="${initial[name]}"></label>`;
  let chosen = null, closed = false, revision = 0, rendering = false, timer;
  let latest;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${body.name || "Planet"} — Create Viewscreen Image` }, position: { width: 740 },
    content: `<div class="sta2e-planet-view"><div data-preview style="aspect-ratio:16/9;background:#02050c"></div><p data-status role="status">Preparing preview…</p>
      <div class="sta2e-planet-options">
      ${select("preset", "Framing", Object.entries(PLANET_VIEW_PRESETS).map(([key, value]) => [key, value.label]), initial.preset)}
      ${select("source", "Planet artwork", [["procedural", "Procedural planet"], ...(body.image ? [["existing", "Existing artwork"]] : [])], initial.source)}
      ${slider("size", "Planet diameter (% of height)", 10, 500)}${slider("x", "Horizontal position (%)", -150, 250)}${slider("y", "Vertical position (%)", -200, 300)}
      ${slider("phase", "Sun phase (°)", 0, 180)}${slider("direction", "Sun direction (°)", 0, 360)}
      ${select("background", "Background", [["__stars", "Seeded starfield"], ["__black", "Black"], ...backgrounds.map(src => [src, src.split("/").pop()])], initial.background)}
      ${select("width", "Export resolution", [["1920", "1920 × 1080"], ["3840", "3840 × 2160"]], String(initial.width))}
      ${select("target", "Add to viewscreen library", [["", "Save image only"], ...targets.map(t => [t.id, t.label])], "")}
      </div><p>Horizon shows the planet’s curved limb from space. Lighting controls apply to procedural artwork. Export does not change the planet’s appearance or the currently displayed viewscreen image.</p></div>`,
    render: (_event, dialog) => {
      const root = dialog.element;
      const read = () => normalizePlanetView(Object.fromEntries(["preset", "source", "size", "x", "y", "phase", "direction", "background", "width"].map(key => [key, root.querySelector(`[name="${key}"]`).value])));
      const run = async () => {
        if (rendering || closed) return;
        rendering = true;
        try {
          let done = -1;
          while (!closed && done !== revision) {
            done = revision;
            const settings = latest;
            try {
              const canvas = await renderPlanetView(body, settings, { preview: true });
              if (closed || done !== revision) { canvas.width = canvas.height = 0; continue; }
              canvas.style.cssText = "display:block;width:100%;height:auto";
              const old = root.querySelector("[data-preview] canvas");
              if (old) old.width = old.height = 0;
              root.querySelector("[data-preview]").replaceChildren(canvas);
              root.querySelector("[data-status]").textContent = "Preview — export uses full resolution.";
            } catch (error) {
              if (!closed && done === revision) root.querySelector("[data-status]").textContent = error.message;
            }
          }
        } finally { rendering = false; }
      };
      const refresh = event => {
        if (event?.target.name === "preset") {
          const preset = PLANET_VIEW_PRESETS[event.target.value];
          for (const key of ["size", "x", "y"]) root.querySelector(`[name="${key}"]`).value = preset[key];
        }
        latest = read(); revision++;
        for (const key of ["phase", "direction"]) root.querySelector(`[name="${key}"]`).disabled = latest.source === "existing";
        for (const key of ["size", "x", "y", "phase", "direction"]) root.querySelector(`[data-output="${key}"]`).textContent = latest[key];
        root.querySelector("[data-status]").textContent = "Rendering preview…";
        clearTimeout(timer); timer = setTimeout(run, 120);
      };
      root.querySelectorAll("input, select").forEach(input => input.addEventListener("input", refresh));
      refresh();
    },
    close: () => { closed = true; revision++; clearTimeout(timer); },
    buttons: [
      { action: "save", label: "Export Image", icon: "fas fa-image", default: true, callback: (_event, _button, dialog) => {
        const root = dialog.element;
        chosen = { settings: normalizePlanetView(Object.fromEntries(["preset", "source", "size", "x", "y", "phase", "direction", "background", "width"].map(key => [key, root.querySelector(`[name="${key}"]`).value]))), targetId: root.querySelector('[name="target"]').value };
        return "save";
      } },
      { action: "cancel", label: "Cancel" },
    ],
  });
  closed = true; revision++; clearTimeout(timer);
  if (result !== "save" || !chosen) return null;
  ui.notifications.info(`STA2e Toolkit: Exporting ${body.name || "planet"} viewscreen image…`);
  return { ...await savePlanetView(body, actorId, chosen.settings), targetId: chosen.targetId };
}
