/** Destructible tab hosted by the existing VFX editor. */
import { normalizeDestructible, fracturePolygon, UNIT_POLYGON } from "./destructible-geometry.js";
import { generateObjectArt, loadObjectImage, cutRegion } from "./destructible-art.js";
import { getDestructibleState, getDestructibleConfig, saveDestructibleConfig, requestObjectOperation } from "./destructible-objects.js";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function objectPanelTarget(editor) {
  return editor.objectToken ?? canvas?.tokens?.controlled?.find(t => t.document.actorId === editor.actor?.id)?.document ?? null;
}
export function readObjectPanel(editor) {
  const settings = { ...editor.objectSettings };
  for (const input of editor.element?.querySelectorAll("[data-object-field]") ?? []) settings[input.dataset.objectField] = input.type === "checkbox" ? input.checked : input.value;
  editor.objectSettings = normalizeDestructible(settings); return editor.objectSettings;
}
export function objectPanelHtml(editor) {
  const c = editor.objectSettings, target = objectPanelTarget(editor), state = getDestructibleState(target);
  const check = (key, label) => `<label><input type="checkbox" data-object-field="${key}" ${c[key] ? "checked" : ""}> ${label}</label>`;
  const field = (key, label, type = "number", attrs = "") => `<label style="display:flex;align-items:center;justify-content:space-between;gap:8px">${label}<input type="${type}" data-object-field="${key}" value="${escape(c[key])}" ${attrs} style="width:${type === "text" ? "62%" : "90px"}"></label>`;
  const select = (key, label, values) => `<label>${label}<select data-object-field="${key}">${values.map(([v, text]) => `<option value="${v}" ${c[key] === v ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
  return `<div style="overflow:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;padding:6px" data-object-panel>
    <p style="margin:0">${editor.objectToken ? `Editing this scene token: <strong>${escape(target?.name)}</strong>` : "Actor defaults apply to future placements. Select a matching scene token for manual controls."}</p>
    ${check("enabled", "Destructible Object")}
    ${select("preset", "Object preset", [["asteroid", "Asteroid"], ["rock", "Surface rock"], ["wall", "Wall section (visual)"]])}
    ${select("artwork", "Artwork", [["procedural", "Generate from seed"], ["existing", "Existing static token image"]])}
    ${field("seed", "Seed", "text")}
    <div style="display:flex;gap:8px">${field("darkColor", "Dark", "color")}${field("lightColor", "Light", "color")}</div>
    ${field("source", "Saved / imported image", "text")}<button type="button" data-object-action="browse">Browse image</button>
    <small>Leave the image path blank to use the token image. Changing seed or colors regenerates procedural artwork on Save.</small>
    ${field("integrity", "Maximum Integrity", "number", 'min="1" step="1"')}
    ${field("resistance", "Resistance", "number", 'min="0" step="1"')}
    ${field("difficulty", "Attack difficulty", "number", 'min="0" max="10" step="1"')}
    ${field("beamPieces", "Beam / manual fragments", "number", 'min="2" max="8" step="1"')}
    ${field("blastPieces", "Explosive fragments", "number", 'min="2" max="8" step="1"')}
    ${field("maxDepth", "Maximum fracture depth", "number", 'min="0" max="6" step="1"')}
    ${field("minSize", "Minimum dimension (grid units)", "number", 'min="0.05" step="0.05"')}
    ${field("maxFragments", "Surviving fragment limit", "number", 'min="2" max="64" step="1"')}
    ${check("animation", "Animate breakup")}
    ${field("duration", "Animation duration (ms)", "number", 'min="200" max="3000" step="50"')}
    ${field("separation", "Separation (grid units)", "number", 'min="0" max="2" step="0.05"')}
    <div style="display:flex;gap:6px"><button type="button" data-object-action="art">Preview artwork</button><button type="button" data-object-action="beam">Preview beam cut</button><button type="button" data-object-action="explosive">Preview explosion</button></div>
    <div data-object-preview style="min-height:200px;background:#080b12;display:flex;align-items:center;justify-content:center"></div>
    <small>Previews do not save artwork or change the scene.</small>
    <fieldset><legend>GM controls · ${escape(target?.name ?? "Select a matching token")}</legend>
      <div>Integrity: ${state ? `${state.current} / ${state.maximum} · generation ${state.generation}` : target ? getDestructibleConfig(target).integrity : "—"}</div>
      <label>Damage before Resistance <input type="number" data-object-damage value="1" min="0" step="1" style="width:80px"></label>
      <div style="display:flex;gap:6px;margin-top:8px"><button type="button" data-object-action="damage" ${target ? "" : "disabled"}>Apply damage</button><button type="button" data-object-action="split" ${target ? "" : "disabled"}>Split</button><button type="button" data-object-action="destroy" ${target ? "" : "disabled"}>Destroy</button></div>
      <small>Manual controls use the token's saved settings. Split forces a breakup; Destroy removes it as debris.</small>
    </fieldset>
  </div>`;
}
export async function previewObjectPanel(editor, kind = "art") {
  const config = readObjectPanel(editor), state = getDestructibleState(editor.objectToken);
  const serial = editor.objectPreviewSerial = (editor.objectPreviewSerial || 0) + 1;
  let art = state?.generation > 0 ? await loadObjectImage(state.source)
    : config.artwork === "procedural" ? generateObjectArt(config)
      : await loadObjectImage(config.source || editor.textureSrc);
  if (editor.objectPreviewSerial !== serial) return;
  const geometry = state?.geometry ?? UNIT_POLYGON;
  const canvasPreview = document.createElement("canvas"); canvasPreview.width = 400; canvasPreview.height = 300;
  canvasPreview.style.cssText = "max-width:100%;max-height:260px;object-fit:contain";
  const ctx = canvasPreview.getContext("2d"), size = 220;
  const polygons = kind === "art" ? [geometry] : fracturePolygon(geometry, { seed: config.seed, kind, count: kind === "explosive" ? config.blastPieces : config.beamPieces, angle: .25 });
  polygons.forEach(p => {
    const crop = cutRegion(art, p), frame = crop.frame;
    const dx = kind === "art" ? 0 : (frame.x + frame.w / 2 - .5) * 24;
    const dy = kind === "art" ? 0 : (frame.y + frame.h / 2 - .5) * 24;
    ctx.drawImage(crop.canvas, 90 + frame.x * size + dx, 40 + frame.y * size + dy, frame.w * size, frame.h * size);
  });
  editor.element?.querySelector("[data-object-preview]")?.replaceChildren(canvasPreview);
}
export async function saveObjectPanel(editor) {
  editor.objectSettings = await saveDestructibleConfig(editor.objectToken ?? editor.actor, readObjectPanel(editor));
  if (editor.objectSettings.enabled) editor.textureSrc = editor.objectSettings.source || editor.textureSrc;
  ui.notifications.info(`Destructible settings saved for ${editor.objectToken?.name ?? editor.actor.name}.`);
  editor.render({ force: true });
}
export function wireObjectPanel(editor) {
  editor.element.querySelectorAll("[data-object-field]").forEach(input => input.addEventListener("change", () => readObjectPanel(editor)));
  editor.element.querySelectorAll("[data-object-action]").forEach(button => button.addEventListener("click", async () => {
    const action = button.dataset.objectAction; button.disabled = true;
    try {
      if (["art", "beam", "explosive"].includes(action)) return await previewObjectPanel(editor, action);
      if (action === "browse") {
        new foundry.applications.apps.FilePicker.implementation({ type: "image", callback: path => {
          editor.element.querySelector('[data-object-field="source"]').value = path;
          editor.element.querySelector('[data-object-field="artwork"]').value = "existing"; readObjectPanel(editor);
        } }).browse(); return;
      }
      const target = objectPanelTarget(editor);
      if (!target) throw new Error("Select a matching scene token first.");
      const result = await requestObjectOperation({ sceneId: target.parent.id, tokenId: target.id, mode: action,
        rawDamage: Number(editor.element.querySelector("[data-object-damage]").value) || 0, kind: "irregular" });
      ui.notifications.info(`Integrity ${result.before} → ${result.after}${result.destroyed ? `; ${result.fragments.length} surviving fragments` : ""}.`);
      if (result.destroyed && editor.objectToken) await editor.close(); else editor.render({ force: true });
    } catch (err) { ui.notifications.error(err.message); console.error("STA2e Toolkit | Destructible panel:", err); }
    finally { button.disabled = false; }
  }));
  void previewObjectPanel(editor).catch(err => { const area = editor.element?.querySelector("[data-object-preview]"); if (area) area.textContent = err.message; });
}
