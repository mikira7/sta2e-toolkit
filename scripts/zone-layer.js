/**
 * sta2e-toolkit | zone-layer.js
 * ZoneOverlay — renders zone polygons on the canvas using a PIXI.Container.
 * Supports edit mode (full color + labels + vertex handles) and play mode
 * (subtle borders only, gated by the showZoneBorders setting + zonesEnabled
 * scene flag).
 *
 * v2 additions:
 *   - Per-zone borderStyle: "none" | "solid" | "dashed" | "dotted"
 *   - Per-zone opacity (fill alpha)
 *   - Difficult terrain hatch pattern + ⚠ icon
 *   - Obscured zone fog/haze effect (tag "obscured")
 *   - Multi-select highlight ring
 *   - Quick info panel on right-click in play mode
 */

import { getSceneZones, getZoneAtPoint, polygonCentroid } from "./zone-data.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Parse a CSS color string to a PIXI-compatible integer. */
function _colorInt(str) {
  if (!str) return 0xffffff;
  if (str.startsWith("hsl")) {
    const tmp = document.createElement("canvas").getContext("2d");
    tmp.fillStyle = str;
    const hex = tmp.fillStyle;
    return parseInt(hex.replace("#", ""), 16);
  }
  return parseInt(str.replace(/^#/, ""), 16);
}

/**
 * Draw a dashed or dotted line on a PIXI.Graphics between two points.
 * @param {PIXI.Graphics} g
 * @param {{x,y}} a  start
 * @param {{x,y}} b  end
 * @param {number[]} dashPattern  e.g. [12, 6] for dashes, [3, 6] for dots
 */
function _dashedLine(g, a, b, dashPattern) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  const nx = dx / len;
  const ny = dy / len;

  let pos = 0;
  let dashIdx = 0;
  let drawing = true;

  while (pos < len) {
    const segLen = Math.min(dashPattern[dashIdx % dashPattern.length], len - pos);
    const sx = a.x + nx * pos;
    const sy = a.y + ny * pos;
    const ex = a.x + nx * (pos + segLen);
    const ey = a.y + ny * (pos + segLen);

    if (drawing) {
      g.moveTo(sx, sy);
      g.lineTo(ex, ey);
    }

    pos += segLen;
    dashIdx++;
    drawing = !drawing;
  }
}

/**
 * Draw a polygon border using the given dash pattern.
 * @param {PIXI.Graphics} g
 * @param {{x,y}[]} verts
 * @param {number[]} dashPattern
 */
function _dashedPolygon(g, verts, dashPattern) {
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    _dashedLine(g, a, b, dashPattern);
  }
}

/**
 * Draw a diagonal hatch pattern inside a polygon (45° lines).
 * Uses a bounding-box clip approach.
 * @param {PIXI.Graphics} g
 * @param {{x,y}[]} verts
 * @param {number} colorInt
 * @param {number} alpha
 * @param {number} spacing  pixels between hatch lines
 */
function _drawHatch(g, verts, colorInt, alpha, spacing = 18) {
  if (verts.length < 3) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  g.lineStyle(1, colorInt, alpha);

  // 45° hatch: iterate diagonals
  const totalSpan = (maxX - minX) + (maxY - minY);
  for (let d = -totalSpan; d <= totalSpan; d += spacing) {
    const candidates = [
      { x: minX, y: minX + d },
      { x: maxX, y: maxX + d },
      { x: minY - d, y: minY },
      { x: maxY - d, y: maxY },
    ].filter(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);

    if (candidates.length < 2) continue;
    candidates.sort((a, b) => a.x - b.x);
    const p1 = candidates[0];
    const p2 = candidates[candidates.length - 1];

    const steps = Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 8);
    if (steps < 1) continue;

    let inRun = false;
    let runStart = null;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = p1.x + t * (p2.x - p1.x);
      const y = p1.y + t * (p2.y - p1.y);
      const inside = _pointInPolygonLocal(x, y, verts);
      if (inside && !inRun) {
        inRun = true;
        runStart = { x, y };
      } else if (!inside && inRun) {
        inRun = false;
        g.moveTo(runStart.x, runStart.y);
        g.lineTo(x, y);
        runStart = null;
      }
    }
    if (inRun && runStart) {
      g.moveTo(runStart.x, runStart.y);
      g.lineTo(p2.x, p2.y);
    }
  }
}

/** Inline point-in-polygon (avoid circular import). */
function _pointInPolygonLocal(x, y, vertices) {
  const n = vertices.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZoneOverlay class
// ═══════════════════════════════════════════════════════════════════════════════

export class ZoneOverlay {

  constructor() {
    /** @type {PIXI.Container} Main container added to canvas. */
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    this.container.eventMode = "none";

    /** @type {PIXI.Container} Zone fills + labels (display layer). */
    this.displayLayer = new PIXI.Container();
    this.displayLayer.zIndex = 1;
    this.container.addChild(this.displayLayer);

    /** @type {PIXI.Container} Vertex handles + edge highlights (edit layer). */
    this.editLayer = new PIXI.Container();
    this.editLayer.zIndex = 2;
    this.editLayer.visible = false;
    this.container.addChild(this.editLayer);

    /** Whether we are in edit mode. */
    this._editMode = false;

    /** Currently selected zone id (edit mode). */
    this.selectedZoneId = null;

    /** Set of selected zone ids for multi-select. */
    this.selectedZoneIds = new Set();

    /** Map of zone id → { gfx, label, handles[], obscuredGfx? } for quick lookup. */
    this._zoneGraphics = new Map();

    // Oscillation ticker for obscured zones
    this._obscuredTicker = null;
    this._obscuredGfxList = [];

    // Add to canvas
    const parent = canvas?.interface ?? canvas?.stage;
    if (parent) {
      parent.addChild(this.container);
    } else {
      console.warn("STA2e Toolkit | Zone overlay: no canvas parent found, overlay not attached.");
    }

  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  draw() {
    this._clearAll();
    const zones = getSceneZones();
    if (!zones.length) return;

    for (const zone of zones) {
      this._drawZone(zone);
    }

    this._applyVisibility();
    this._startObscuredAnimation();
  }

  refresh() {
    this.draw();
  }

  destroy() {
    this._stopObscuredAnimation();
    this._clearAll();
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
  }

  // ── Mode switching ──────────────────────────────────────────────────────────

  setEditMode(active) {
    this._editMode = !!active;
    this.editLayer.visible = this._editMode;
    if (!this._editMode) {
      this.selectedZoneId = null;
      this.selectedZoneIds.clear();
    }
    // Redraw all zones so fill/label visibility matches the new mode immediately,
    // rather than deferring until the next save triggers an updateScene refresh.
    this.draw();
  }

  get editMode() {
    return this._editMode;
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  selectZone(id) {
    const prev = this.selectedZoneId;
    this.selectedZoneId = id;
    this.selectedZoneIds.clear();
    if (id) this.selectedZoneIds.add(id);
    if (prev) this._updateZoneHighlight(prev, false, false);
    if (id)   this._updateZoneHighlight(id, true, false);
  }

  /**
   * Toggle a zone in/out of the multi-select set.
   */
  toggleZoneSelection(id) {
    const prev = this.selectedZoneId;
    if (this.selectedZoneIds.has(id)) {
      this.selectedZoneIds.delete(id);
      this._updateZoneHighlight(id, false, false);
      // Update primary selection to another selected zone if any
      this.selectedZoneId = this.selectedZoneIds.size > 0 ? [...this.selectedZoneIds][0] : null;
    } else {
      this.selectedZoneIds.add(id);
      this._updateZoneHighlight(id, true, true);
      this.selectedZoneId = id;
    }
    // Refresh previously primary
    if (prev && prev !== id) {
      this._updateZoneHighlight(prev, this.selectedZoneIds.has(prev), this.selectedZoneIds.size > 1);
    }
  }

  getZoneIdAtPoint(x, y) {
    const zones = getSceneZones();
    const zone = getZoneAtPoint(x, y, zones);
    return zone?.id ?? null;
  }

  // ── Internal rendering ──────────────────────────────────────────────────────

  _drawZone(zone) {
    const verts = zone.vertices;
    if (!verts || verts.length < 3) return;

    const hideBorders = !this._editMode && (canvas?.scene?.getFlag("sta2e-toolkit", "zoneHideBorders") ?? false);
    const borderStyle = hideBorders ? "none" : (zone.borderStyle ?? "solid");
    const isDifficult = zone.isDifficult || (zone.momentumCost > 0);
    const isObscured  = (zone.tags ?? []).includes("obscured");
    const borderWidth = (() => {
      try { return game.settings.get("sta2e-toolkit", "zoneBorderWidth") ?? 2; } catch { return 2; }
    })();

    // ── Play-mode appearance overrides (read from per-scene flags) ───────────
    const _getSetting = (key, fallback) => { try { return game.settings.get("sta2e-toolkit", key); } catch { return fallback; } };
    const _sceneFlag  = (key, fallback) => canvas?.scene?.getFlag("sta2e-toolkit", key) ?? fallback;
    // Resolve color: zone custom → scene default → legacy play override → fallback
    const sceneDefault = _sceneFlag("zoneDefaultColor", "") || _sceneFlag("zonePlayBorderColor", "") || "#4488ff";
    let colorInt  = _colorInt(zone.color || sceneDefault);
    let fillAlpha = zone.opacity ?? 0.25;
    if (!this._editMode) {
      if (!_sceneFlag("zonePlayShowFill", false)) fillAlpha = 0;
    }

    // ── Fill polygon ──────────────────────────────────────────────────────────
    const gfx = new PIXI.Graphics();

    if (borderStyle !== "none") {
      gfx.beginFill(colorInt, fillAlpha);
      if (borderStyle === "solid") {
        gfx.lineStyle(borderWidth, colorInt, 0.8);
      }
      gfx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) gfx.lineTo(verts[i].x, verts[i].y);
      gfx.closePath();
      gfx.endFill();

      if (borderStyle === "dashed") {
        gfx.lineStyle(borderWidth, colorInt, 0.8);
        _dashedPolygon(gfx, verts, [12, 6]);
      } else if (borderStyle === "dotted") {
        gfx.lineStyle(borderWidth, colorInt, 0.8);
        _dashedPolygon(gfx, verts, [3, 6]);
      }
    } else {
      gfx.beginFill(colorInt, fillAlpha);
      gfx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) gfx.lineTo(verts[i].x, verts[i].y);
      gfx.closePath();
      gfx.endFill();
    }

    // ── Difficult terrain ─────────────────────────────────────────────────────
    if (isDifficult) {
      gfx.lineStyle(3, 0xff4444, 0.6);
      gfx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) gfx.lineTo(verts[i].x, verts[i].y);
      gfx.closePath();
      _drawHatch(gfx, verts, 0xff4444, 0.18, 20);
    }

    this.displayLayer.addChild(gfx);

    // ── Label ─────────────────────────────────────────────────────────────────
    // In edit mode always show; in play mode respect world setting + per-scene flag.
    const showLabels = this._editMode
      || (
        _getSetting("zoneShowLabels", true) !== false
        && canvas?.scene?.getFlag("sta2e-toolkit", "zoneShowLabels") !== false
      );

    const centroid = polygonCentroid(verts);
    let label = null;
    if (showLabels) {
      const labelText = zone.name || "(unnamed)";
      const costSuffix = zone.momentumCost > 0 ? ` [+${zone.momentumCost}M]` : "";
      const warningPrefix = isDifficult ? "⚠ " : "";

      const PreciseText = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
      label = new PreciseText(`${warningPrefix}${labelText}${costSuffix}`, {
        fontFamily: "Arial, sans-serif",
        fontSize: 14,
        fontWeight: "bold",
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 3,
        align: "center",
        dropShadow: true,
        dropShadowAlpha: 0.6,
        dropShadowDistance: 1,
      });
      label.anchor.set(0.5, 0.5);
      label.position.set(centroid.x, centroid.y);
      this.displayLayer.addChild(label);
    }

    // ── Obscured fog overlay ──────────────────────────────────────────────────
    let obscuredGfx = null;
    if (isObscured) {
      obscuredGfx = new PIXI.Graphics();
      obscuredGfx.beginFill(0xddddff, 0.12);
      obscuredGfx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) obscuredGfx.lineTo(verts[i].x, verts[i].y);
      obscuredGfx.closePath();
      obscuredGfx.endFill();
      this.displayLayer.addChild(obscuredGfx);
      this._obscuredGfxList.push(obscuredGfx);

      // Add "OBSCURED" sub-label in edit mode
      const PreciseText = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
      const obsLabel = new PreciseText("OBSCURED", {
        fontFamily: "Arial, sans-serif",
        fontSize: 10,
        fill: 0xaaaaff,
        stroke: 0x000000,
        strokeThickness: 2,
        align: "center",
      });
      obsLabel.anchor.set(0.5, 0.5);
      obsLabel.position.set(centroid.x, centroid.y + 16);
      obsLabel._obscuredEditLabel = true;
      this.displayLayer.addChild(obsLabel);
    }

    // ── Vertex handles (edit layer) ───────────────────────────────────────────
    const handles = [];
    for (let i = 0; i < verts.length; i++) {
      const handle = new PIXI.Graphics();
      handle.beginFill(0xffffff, 0.9);
      handle.lineStyle(2, colorInt, 1);
      handle.drawCircle(0, 0, 6);
      handle.endFill();
      handle.position.set(verts[i].x, verts[i].y);
      handle.zoneId = zone.id;
      handle.vertexIndex = i;
      handle.eventMode = "static";
      handle.cursor = "move";
      this.editLayer.addChild(handle);
      handles.push(handle);
    }

    this._zoneGraphics.set(zone.id, { gfx, label, handles, obscuredGfx });
  }

  _updateZoneHighlight(zoneId, selected, multiSelected = false) {
    const entry = this._zoneGraphics.get(zoneId);
    if (!entry) return;
    entry.gfx.alpha = selected ? 1.0 : 0.7;
    for (const h of entry.handles) {
      h.scale.set(selected ? 1.3 : 1.0);
    }

    // Multi-select dashed white ring
    const existingRing = entry._multiRing;
    if (multiSelected && !existingRing) {
      const zones = getSceneZones();
      const zone = zones.find(z => z.id === zoneId);
      if (zone?.vertices?.length >= 3) {
        const ring = new PIXI.Graphics();
        ring.lineStyle(2, 0xffffff, 0.9);
        _dashedPolygon(ring, zone.vertices, [8, 5]);
        this.editLayer.addChild(ring);
        entry._multiRing = ring;
      }
    } else if (!multiSelected && existingRing) {
      existingRing.parent?.removeChild(existingRing);
      existingRing.destroy();
      delete entry._multiRing;
    }
  }

  _applyVisibility() {
    if (this._editMode) {
      this.displayLayer.visible = true;
      this.displayLayer.alpha = 1.0;
      this.editLayer.visible = true;
    } else {
      // Zones are visible to everyone in play mode as long as this scene has
      // zones enabled (defaults to true). The GM can hide them per-scene via
      // the scene config flag, or globally via the "Show Zone Borders" setting.
      const showBorders = (() => {
        try { return game.settings.get("sta2e-toolkit", "showZoneBorders"); } catch { return true; }
      })();
      const perScene = canvas?.scene?.getFlag("sta2e-toolkit", "zonesEnabled");
      const sceneOn  = perScene !== false;     // true unless explicitly disabled
      const show = showBorders !== false && sceneOn;
      this.displayLayer.visible = show;
      this.displayLayer.alpha = show ? 0.5 : 0;
      this.editLayer.visible = false;
    }
  }

  _clearAll() {
    this._stopObscuredAnimation();
    this._obscuredGfxList = [];
    this.displayLayer.removeChildren().forEach(c => c.destroy({ children: true }));
    this.editLayer.removeChildren().forEach(c => c.destroy({ children: true }));
    this._zoneGraphics.clear();
  }

  // ── Obscured animation ──────────────────────────────────────────────────────

  _startObscuredAnimation() {
    this._stopObscuredAnimation();
    if (this._obscuredGfxList.length === 0) return;

    let t = 0;
    this._obscuredTicker = delta => {
      t += delta * 0.012;
      const a = 0.10 + 0.06 * Math.sin(t);
      for (const g of this._obscuredGfxList) {
        g.alpha = a;
      }
    };
    canvas.app?.ticker?.add(this._obscuredTicker);
  }

  _stopObscuredAnimation() {
    if (this._obscuredTicker) {
      canvas.app?.ticker?.remove(this._obscuredTicker);
      this._obscuredTicker = null;
    }
  }

}
