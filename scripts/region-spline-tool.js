/**
 * sta2e-toolkit | region-spline-tool.js
 *
 * A curve tool for the Regions layer: click control points and get a smooth
 * closed outline that passes through every one of them, instead of Foundry's
 * straight-edged polygon. For curved viewscreens cut into a bridge map, nebula
 * boundaries, debris-field edges — anything organic.
 *
 * ── Why this is small ────────────────────────────────────────────────────────
 *
 * Core's shape drawing is driven by DATA, not by tool name. `ShapeLayerMixin`
 * (client/canvas/layers/mixins/shapes.mjs) branches on
 * `interaction.shape.type === "polygon"` and takes the starting shape from
 * `ui.controls.tool.shapeData`. So a tool declaring
 * `creation: true, shapeData: {type: "polygon", …}` inherits the entire core
 * workflow for free — click to place, the rubber-band preview point,
 * right-click to undo a point, double-click or click-the-first-point to close,
 * Escape to cancel, vertex snapping, the Hole toggle, and the
 * add-a-shape-to-the-selected-Region path. All this module supplies is a curve
 * in place of the raw click list.
 *
 * A Region polygon stores a flat [x0,y0,…] array with `min: 4`, no maximum and
 * no integer constraint, so a densely tessellated curve is a perfectly legal
 * Region shape. And core's polygon `_createControlHandles` emits only
 * translate/scale/rotate handles — never one per vertex — so a 60-point curve
 * does not litter the canvas with 60 handles.
 *
 * ── The seam ─────────────────────────────────────────────────────────────────
 *
 * `PlaceablesLayer#_commitDragLeftDrop` creates the document from
 * `interaction.preview.document`, NOT from `interaction.shape`. And
 * `_updateDragPreview` is the only thing that copies one into the other, called
 * after every click and every drag-move. So patching that single method covers
 * both the live preview and what actually gets saved.
 *
 * The patch SWAPS a splined stand-in in for the duration of the core call
 * rather than writing the curve onto `interaction.shape` itself: core appends
 * the next click to that same points array, so overwriting it would destroy the
 * control-point list after the first click.
 *
 * The one thing this does not cover is core's multi-shape branch — adding a
 * shape to an already-selected Region — which copies only `shapes` out of the
 * preview and would drop the flag. Hence the second patch.
 */

import {
  splineClosed,
  sameOutline,
  outlineOffset,
  translatePoints,
  SMOOTHNESS_MIN,
  SMOOTHNESS_MAX,
  SMOOTHNESS_DEFAULT,
} from "./spline-geometry.js";

const SCOPE = "sta2e-toolkit";

/** Scene-control tool name. */
const TOOL = "sta2eSpline";

/** Flag holding the clicked control points, so a curve can be regenerated. */
export const SPLINE_FLAG = "splineControls";
const FLAG_PATH = `flags.${SCOPE}.${SPLINE_FLAG}`;

/** Setting key for the nominal samples per span. */
export const SMOOTHNESS_SETTING = "regionSplineSmoothness";

// ── Small readers ────────────────────────────────────────────────────────────

/** The GM's smoothness setting, falling back if settings are not up yet. */
function _smoothness() {
  try {
    const v = Number(game.settings.get(SCOPE, SMOOTHNESS_SETTING));
    if (Number.isFinite(v)) return v;
  } catch { /* called before registration */ }
  return SMOOTHNESS_DEFAULT;
}

/** Scene grid size, which the adaptive sampling scales chord lengths against. */
const _gridSize = () => Number(canvas?.grid?.size) || 100;

/** Tessellate with the scene's grid in hand. */
const _curve = (points, smoothness) =>
  splineClosed(points, { smoothness: smoothness ?? _smoothness(), gridSize: _gridSize() });

/** Is our tool the active one? Matches the `game.activeTool` idiom core uses. */
const _isSplineTool = () => game?.activeTool === TOOL;

/** The stored control-point entries on a Region, always an array. */
function _storedControls(doc) {
  const raw = foundry.utils.getProperty(doc ?? {}, FLAG_PATH);
  return Array.isArray(raw) ? raw.filter(e => Array.isArray(e?.points)) : [];
}

// ── Scene control ────────────────────────────────────────────────────────────

function _registerTool(controls) {
  const group = controls?.regions;
  if (!group?.tools) return;

  group.tools[TOOL] = {
    name: TOOL,
    // Tools sort on a plain numeric `order`, so a fractional value parks this
    // directly after Polygon and survives core renumbering its own tools.
    order: (group.tools.polygon?.order ?? 10) + 0.5,
    title: "STA2E.RegionSpline.Tool",
    icon: "fa-solid fa-bezier-curve",
    visible: !canvas.regions?.templateMode,
    control: !canvas.regions?.templateMode,
    creation: true,
    // Core reads this to seed interaction.shape. Declaring "polygon" is what
    // buys the whole click-place-close workflow.
    shapeData: { type: "polygon", points: [0, 0, 0, 0] },
    toolclip: {
      heading: "STA2E.RegionSpline.Tool",
      items: [{ paragraph: "STA2E.RegionSpline.Toolclip" }],
    },
  };
}

// ── The patches ──────────────────────────────────────────────────────────────

/**
 * Record the clicked control points onto the preview document, so they travel
 * with the create and the curve can be regenerated later.
 *
 * Called on every click of one drag, so each call replaces the entry the
 * previous one added — the surviving stamp is the one made from the final
 * control points, after `_onDragLeftDrop` has sliced the rubber-band point off.
 */
function _stampControls(interaction, controlPoints, smoothness) {
  const doc = interaction?.preview?.document;
  if (!doc) return;

  // Read/modify/write the whole flags object rather than relying on how
  // updateSource merges a partial one.
  const flags = foundry.utils.deepClone(doc.toObject().flags ?? {});
  const bucket = flags[SCOPE] ??= {};
  const list = Array.isArray(bucket[SPLINE_FLAG]) ? bucket[SPLINE_FLAG].slice() : [];
  if (interaction.sta2eSplineStamped) list.pop();
  list.push({ points: Array.from(controlPoints), smoothness });
  bucket[SPLINE_FLAG] = list;

  doc.updateSource({ flags });
  interaction.sta2eSplineStamped = true;
}

function _patchRegionLayer() {
  const LayerClass = foundry.canvas?.layers?.RegionLayer;
  if (!LayerClass?.prototype) {
    console.warn("STA2e Toolkit | region-spline-tool: RegionLayer not found; curve tool disabled.");
    return;
  }
  if (LayerClass.prototype._sta2eSplinePatch) return;

  // ── 1. Substitute the curve into the preview ───────────────────────────────
  const originalPreview = LayerClass.prototype._updateDragPreview;
  LayerClass.prototype._updateDragPreview = function (event) {
    const interaction = event?.interactionData;
    const raw = interaction?.shape;
    if (!_isSplineTool() || raw?.type !== "polygon") return originalPreview.call(this, event);

    const smoothness = _smoothness();
    const curve = _curve(raw.points, smoothness);
    // Fewer than three distinct clicks yet — let core draw its straight stub.
    if (!curve) return originalPreview.call(this, event);

    // Core only reads interaction.shape.toObject() here, so a stand-in for the
    // duration of the call leaves the raw control points intact for the next
    // click to append to.
    interaction.shape = raw.clone({ points: curve });
    try {
      originalPreview.call(this, event);
      _stampControls(interaction, raw.points, smoothness);
    } finally {
      interaction.shape = raw;
    }
  };

  // ── 2. Carry the flag through core's multi-shape branch ────────────────────
  const originalCommit = LayerClass.prototype._commitDragLeftDrop;
  LayerClass.prototype._commitDragLeftDrop = async function (event) {
    const interaction = event?.interactionData;
    const preview = interaction?.preview;
    const object = preview?._original;

    // Mirrors the mixin's own branch, which writes only `shapes` out of the
    // preview and so would silently drop the control points we stamped.
    if (_isSplineTool() && interaction?.sta2eSplineStamped
        && object && !object.document.locked && !preview._destroyed) {
      const data = preview.document.toObject();
      interaction.clearPreviewContainer = false;
      try {
        await object.document.update({
          shapes: data.shapes,
          [FLAG_PATH]: data.flags?.[SCOPE]?.[SPLINE_FLAG] ?? [],
        });
      } finally {
        this.clearPreviewContainer();
      }
      return;
    }

    return originalCommit.call(this, event);
  };

  LayerClass.prototype._sta2eSplinePatch = true;
}

// ── Regeneration ─────────────────────────────────────────────────────────────

/**
 * Which of the Region's shapes this stored control set produced.
 *
 * Matched by REGENERATING and comparing, not by index: a shape can be deleted
 * or reordered and the association still holds. `sameOutline` tolerates the
 * whole Region having been dragged; it deliberately does not tolerate the scale
 * or rotate handles, where a transformed shape simply stops matching and
 * reverts to being an ordinary fixed polygon.
 *
 * @returns {number} Shape index, or -1.
 */
function _matchShapeIndex(doc, entry) {
  const curve = _curve(entry.points, entry.smoothness);
  if (!curve) return -1;
  const shapes = doc?.shapes ?? [];
  for (let i = 0; i < shapes.length; i++) {
    if (shapes[i]?.type !== "polygon") continue;
    if (sameOutline(curve, Array.from(shapes[i].points ?? []))) return i;
  }
  return -1;
}

/**
 * Rebuild every matched spline shape on a Region at a new smoothness.
 * @param {RegionDocument} doc
 * @param {number} smoothness
 */
async function _regenerate(doc, smoothness) {
  const entries = _storedControls(doc);
  if (!entries.length) return;

  const shapes = doc.toObject().shapes;
  const next = [];
  let changed = 0;

  for (const entry of entries) {
    const index = _matchShapeIndex(doc, entry);
    if (index < 0) { next.push(entry); continue; }

    // Re-anchor the controls onto wherever the Region now sits, so a moved
    // Region stays matchable after this rebuild.
    const before = _curve(entry.points, entry.smoothness);
    const offset = outlineOffset(before, Array.from(doc.shapes[index].points ?? []));
    const controls = translatePoints(entry.points, offset);

    const curve = _curve(controls, smoothness);
    if (!curve) { next.push(entry); continue; }

    shapes[index] = { ...shapes[index], points: curve };
    next.push({ points: controls, smoothness });
    changed++;
  }

  if (!changed) {
    ui.notifications.warn("No curve could be matched to a shape on this Region — it was probably scaled or rotated after it was drawn.");
    return;
  }

  await doc.update({ shapes, [FLAG_PATH]: next });
  ui.notifications.info(`Rebuilt ${changed} curve${changed === 1 ? "" : "s"} at smoothness ${smoothness}.`);
}

// ── Region config panel ──────────────────────────────────────────────────────

/**
 * Give the stored control points a purpose: report them and offer a rebuild at
 * a different smoothness. Follows region-pad-config.js — same hook, same
 * ApplicationV2/jQuery-tolerant unwrap, same idempotence guard (ApplicationV2
 * re-renders re-fire this hook).
 */
function _injectSplinePanel(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".sta2e-region-spline")) return;

  const doc = app.document ?? app.object ?? null;
  const entries = _storedControls(doc);
  if (!entries.length) return;

  const matched = entries.filter(e => _matchShapeIndex(doc, e) >= 0).length;
  const stale = entries.length - matched;
  const current = entries[entries.length - 1]?.smoothness ?? _smoothness();

  const target =
    root.querySelector('.tab[data-tab="shapes"]')
    ?? root.querySelector('.tab[data-tab="identity"]')
    ?? root.querySelector(".tab[data-tab]")
    ?? root.querySelector("form")
    ?? root;

  const group = document.createElement("div");
  group.classList.add("form-group", "sta2e-region-spline");
  // The input carries no `name`, so Foundry's form submission ignores it — this
  // panel drives its own document update rather than riding the sheet's submit.
  group.innerHTML = `
    <label>Curve Smoothness <span style="opacity:0.65;">(STA Toolkit)</span></label>
    <div class="form-fields">
      <input type="number" class="sta2e-spline-smoothness"
             min="${SMOOTHNESS_MIN}" max="${SMOOTHNESS_MAX}" step="1" value="${current}">
      <button type="button" class="sta2e-spline-regen">Rebuild Curves</button>
    </div>
    <p class="hint">
      ${matched} of ${entries.length} shape${entries.length === 1 ? "" : "s"} on this Region
      ${entries.length === 1 ? "was" : "were"} drawn with the curve tool and can be rebuilt at a
      different smoothness.${stale ? ` ${stale} can no longer be matched — scaling or rotating a
      shape makes it an ordinary polygon.` : ""}
      Rebuilding saves the Region immediately, so submit any other changes first.
    </p>`;

  target.appendChild(group);

  group.querySelector(".sta2e-spline-regen").addEventListener("click", async (event) => {
    event.preventDefault();
    const input = group.querySelector(".sta2e-spline-smoothness");
    const value = Math.min(SMOOTHNESS_MAX, Math.max(SMOOTHNESS_MIN, Number(input.value) || SMOOTHNESS_DEFAULT));
    try {
      await _regenerate(doc, value);
    } catch (err) {
      console.error("STA2e Toolkit | region-spline-tool: rebuild failed:", err);
      ui.notifications.error("Could not rebuild the curves — see the console.");
    }
  });
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Add the curve tool to the Regions control, patch the layer, and wire the
 * Region config panel. Call once from main.js init.
 */
export function registerRegionSplineTool() {
  Hooks.on("getSceneControlButtons", _registerTool);
  Hooks.on("renderRegionConfig", _injectSplinePanel);
  _patchRegionLayer();
}
