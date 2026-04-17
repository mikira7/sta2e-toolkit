/**
 * sta2e-toolkit | zone-editor.js
 * Zone editing tools: polygon draw, hex stamp, square stamp, fill-scene,
 * select/move, multi-select, delete, zone properties dialog, import/export.
 */

import {
  getSceneZones, addZone, updateZone, deleteZone, setSceneZones,
  hexVertices, generateHexGrid, hexCellName, pointInPolygon,
  getZoneAtPoint, generateSquareGrid, squareCellName, HAZARD_TYPES,
  areZonesAllConnected, mergeZonePolygons, clipPolygonToRect,
} from "./zone-data.js";

// ═══════════════════════════════════════════════════════════════════════════════
// ZoneEditState — singleton state machine
// ═══════════════════════════════════════════════════════════════════════════════

export class ZoneEditState {

  constructor(overlay) {
    /** @type {import("./zone-layer.js").ZoneOverlay} */
    this.overlay = overlay;

    /** Current tool: "select" | "draw" | "hex" | "square" | "delete" | null */
    this.activeTool = null;

    // ── Polygon draw state ────────────────────────────────────────────────
    this._drawVerts = [];
    this._drawPreview = null;

    // ── Hex stamp state ───────────────────────────────────────────────────
    this._hexOverlay = null;
    this._hexSize = this._deriveHexSizeFromGrid();

    // ── Square stamp state ────────────────────────────────────────────────
    this._squareOverlay = null;
    this._squareSize = this._deriveSquareSizeFromGrid();

    // ── Drag state (select tool) ──────────────────────────────────────────
    this._dragging = null;

    // ── Bound handlers ────────────────────────────────────────────────────
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp   = this._handlePointerUp.bind(this);
    this._onKeyDown     = this._handleKeyDown.bind(this);
    this._onDblClick    = this._handleDblClick.bind(this);

    this._listening = false;
  }

  // ── Tool activation ─────────────────────────────────────────────────────

  setTool(tool) {
    this._cancelDraw();
    this._clearHexOverlay();
    this._clearSquareOverlay();
    this.activeTool = tool;

    if (tool && !this._listening) {
      canvas.stage.on("pointerdown", this._onPointerDown);
      canvas.stage.on("pointermove", this._onPointerMove);
      canvas.stage.on("pointerup",   this._onPointerUp);
      document.addEventListener("keydown", this._onKeyDown);
      _canvasEl()?.addEventListener("dblclick", this._onDblClick);
      this._listening = true;
    } else if (!tool && this._listening) {
      this._removeListeners();
    }

    const cursors = { draw: "crosshair", hex: "cell", square: "cell", delete: "not-allowed", select: "default" };
    const _cv = _canvasEl();
    if (_cv) _cv.style.cursor = cursors[tool] ?? "default";

    if (tool === "hex")    this._showHexOverlay();
    if (tool === "square") this._showSquareOverlay();
  }

  deactivate() {
    this.setTool(null);
    this.overlay.setEditMode(false);
  }

  destroy() {
    this._cancelDraw();
    this._clearHexOverlay();
    this._clearSquareOverlay();
    this._removeListeners();
  }

  _removeListeners() {
    canvas.stage?.off("pointerdown", this._onPointerDown);
    canvas.stage?.off("pointermove", this._onPointerMove);
    canvas.stage?.off("pointerup",   this._onPointerUp);
    document.removeEventListener("keydown", this._onKeyDown);
    _canvasEl()?.removeEventListener("dblclick", this._onDblClick);
    const _cv = _canvasEl();
    if (_cv) _cv.style.cursor = "default";
    this._listening = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Event handlers
  // ═══════════════════════════════════════════════════════════════════════════

  _extractPoint(event) {
    if (event?.clientX != null && event?.clientY != null && canvas?.canvasCoordinatesFromClient) {
      const pt = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
      if (pt?.x != null) return pt;
    }
    const origin = event?.data?.getLocalPosition?.(canvas.stage)
      ?? event?.getLocalPosition?.(canvas.stage);
    if (origin?.x != null) return origin;
    return null;
  }

  _handlePointerDown(event) {
    const pt = this._extractPoint(event);
    if (!pt) return;

    switch (this.activeTool) {
      case "draw":   this._drawAddVertex(pt); break;
      case "hex":    this._hexStamp(pt); break;
      case "square": this._squareStamp(pt); break;
      case "delete": this._deleteAtPoint(pt); break;
      case "select": this._selectOrStartDrag(pt, event); break;
    }
  }

  _handlePointerMove(event) {
    if (this.activeTool === "draw" && this._drawVerts.length > 0) {
      const pt = this._extractPoint(event);
      if (pt) this._drawUpdatePreview(pt);
    }
    if (this._dragging) {
      const pt = this._extractPoint(event);
      if (pt) this._dragMove(pt);
    }
  }

  _handlePointerUp(_event) {
    if (this._dragging) this._dragEnd();
  }

  _handleKeyDown(event) {
    if (event.key === "Escape") {
      this._cancelDraw();
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.activeTool === "select") {
      if (this.overlay.selectedZoneIds.size > 0) {
        this._deleteSelectedZones();
      }
    }
  }

  _handleDblClick(event) {
    const pt = this._extractPoint(event);
    if (!pt) return;

    if (this.activeTool === "draw" && this._drawVerts.length >= 3) {
      this._finishDraw();
    } else if (this.activeTool === "select") {
      const zones = getSceneZones();
      const zone = getZoneAtPoint(pt.x, pt.y, zones);
      if (zone) this.openZoneProperties(zone.id);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Polygon draw tool
  // ═══════════════════════════════════════════════════════════════════════════

  _drawAddVertex(pt) {
    const snapped = this._snapToVertex(pt, 20);
    const vertex = snapped ?? pt;

    if (this._drawVerts.length >= 3) {
      const first = this._drawVerts[0];
      if (Math.hypot(vertex.x - first.x, vertex.y - first.y) < 20) {
        this._finishDraw();
        return;
      }
    }

    this._drawVerts.push({ x: Math.round(vertex.x), y: Math.round(vertex.y) });
    this._drawUpdatePreview(vertex);
  }

  _drawUpdatePreview(cursor) {
    if (this._drawPreview) {
      this._drawPreview.parent?.removeChild(this._drawPreview);
      this._drawPreview.destroy();
    }

    const g = new PIXI.Graphics();
    g.lineStyle(2, 0x00ff88, 0.8);

    if (this._drawVerts.length > 0) {
      g.moveTo(this._drawVerts[0].x, this._drawVerts[0].y);
      for (let i = 1; i < this._drawVerts.length; i++) g.lineTo(this._drawVerts[i].x, this._drawVerts[i].y);
      g.lineTo(cursor.x, cursor.y);
      g.lineStyle(1, 0x00ff88, 0.4);
      g.lineTo(this._drawVerts[0].x, this._drawVerts[0].y);
    }

    g.lineStyle(0);
    for (const v of this._drawVerts) {
      g.beginFill(0x00ff88, 1);
      g.drawCircle(v.x, v.y, 5);
      g.endFill();
    }

    this.overlay.editLayer.addChild(g);
    this._drawPreview = g;
  }

  async _finishDraw() {
    const verts = [...this._drawVerts];
    this._cancelDraw();
    if (verts.length < 3) return;

    const props = await this._promptZoneProperties({
      name: "",
      color: null,
      momentumCost: 0,
      tags: [],
      borderStyle: game.settings.get("sta2e-toolkit", "zoneBorderStyleDefault") ?? "solid",
      isDifficult: false,
      opacity: 0.25,
      hazards: [],
    });
    if (!props) return;

    await addZone({ ...props, vertices: verts });
    this.overlay.refresh();
  }

  _cancelDraw() {
    this._drawVerts = [];
    if (this._drawPreview) {
      this._drawPreview.parent?.removeChild(this._drawPreview);
      this._drawPreview.destroy();
      this._drawPreview = null;
    }
  }

  _snapToVertex(pt, threshold) {
    const zones = getSceneZones();
    let closest = null, closestDist = threshold;
    for (const zone of zones) {
      for (const v of zone.vertices) {
        const d = Math.hypot(v.x - pt.x, v.y - pt.y);
        if (d < closestDist) { closestDist = d; closest = { x: v.x, y: v.y }; }
      }
    }
    return closest;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Hex stamp tool
  // ═══════════════════════════════════════════════════════════════════════════

  _showHexOverlay() {
    this._clearHexOverlay();
    const dim = canvas.dimensions;
    const grid = generateHexGrid(dim.sceneX, dim.sceneY, dim.sceneWidth, dim.sceneHeight, this._hexSize);
    const container = new PIXI.Container();
    container.name = "sta2eHexStampOverlay";
    container.eventMode = "none";

    for (const cell of grid) {
      const verts   = hexVertices(cell.cx, cell.cy, this._hexSize);
      const clipped = clipPolygonToRect(verts, dim.sceneX, dim.sceneY, dim.sceneWidth, dim.sceneHeight);
      if (clipped.length < 3) continue;
      const g = new PIXI.Graphics();
      g.lineStyle(1, 0x44aaff, 0.3);
      g.moveTo(clipped[0].x, clipped[0].y);
      for (let i = 1; i < clipped.length; i++) g.lineTo(clipped[i].x, clipped[i].y);
      g.closePath();
      g._hexCell  = cell;
      g._hexVerts = clipped;
      container.addChild(g);
    }

    this.overlay.editLayer.addChild(container);
    this._hexOverlay = container;
  }

  _clearHexOverlay() {
    if (this._hexOverlay) {
      this._hexOverlay.parent?.removeChild(this._hexOverlay);
      this._hexOverlay.destroy({ children: true });
      this._hexOverlay = null;
    }
  }

  async _hexStamp(pt) {
    if (!this._hexOverlay) return;

    for (const child of this._hexOverlay.children) {
      if (!child._hexVerts) continue;
      if (pointInPolygon(pt.x, pt.y, child._hexVerts)) {
        const cell = child._hexCell;
        const zones = getSceneZones();
        const existing = getZoneAtPoint(cell.cx, cell.cy, zones);
        if (existing) {
          ui.notifications.warn(`This hex is already covered by zone "${existing.name || "(unnamed)"}".`);
          return;
        }

        await addZone({
          name: hexCellName(cell.col, cell.row),
          vertices: child._hexVerts,
          color: null,
          momentumCost: 0,
          tags: [],
          borderStyle: game.settings.get("sta2e-toolkit", "zoneBorderStyleDefault") ?? "solid",
          isDifficult: false,
          opacity: 0.25,
          hazards: [],
        });

        this.overlay.refresh();
        this._showHexOverlay();
        return;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Square stamp tool
  // ═══════════════════════════════════════════════════════════════════════════

  _showSquareOverlay() {
    this._clearSquareOverlay();
    const dim = canvas.dimensions;
    const grid = generateSquareGrid(dim.sceneX, dim.sceneY, dim.sceneWidth, dim.sceneHeight, this._squareSize);
    const container = new PIXI.Container();
    container.name = "sta2eSquareStampOverlay";
    container.eventMode = "none";

    for (const cell of grid) {
      const g = new PIXI.Graphics();
      g.lineStyle(1, 0x44aaff, 0.3);
      const v = cell.vertices;
      g.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) g.lineTo(v[i].x, v[i].y);
      g.closePath();
      g._squareCell = cell;
      container.addChild(g);
    }

    this.overlay.editLayer.addChild(container);
    this._squareOverlay = container;
  }

  _clearSquareOverlay() {
    if (this._squareOverlay) {
      this._squareOverlay.parent?.removeChild(this._squareOverlay);
      this._squareOverlay.destroy({ children: true });
      this._squareOverlay = null;
    }
  }

  async _squareStamp(pt) {
    if (!this._squareOverlay) return;

    for (const child of this._squareOverlay.children) {
      const cell = child._squareCell;
      if (!cell) continue;
      if (pointInPolygon(pt.x, pt.y, cell.vertices)) {
        const zones = getSceneZones();
        const existing = getZoneAtPoint(cell.cx, cell.cy, zones);
        if (existing) {
          ui.notifications.warn(`This cell is already covered by zone "${existing.name || "(unnamed)"}".`);
          return;
        }

        await addZone({
          name: squareCellName(cell.col, cell.row),
          vertices: cell.vertices,
          color: null,
          momentumCost: 0,
          tags: [],
          borderStyle: game.settings.get("sta2e-toolkit", "zoneBorderStyleDefault") ?? "solid",
          isDifficult: false,
          opacity: 0.25,
          hazards: [],
        });

        this.overlay.refresh();
        this._showSquareOverlay();
        return;
      }
    }
  }

  _deriveSquareSizeFromGrid() {
    try {
      const gs = canvas?.scene?.grid?.size;
      if (gs && gs > 0) return Math.round(gs);
    } catch { /* canvas not ready */ }
    return 100;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fill Scene
  // ═══════════════════════════════════════════════════════════════════════════

  async fillScene(shape = "hex") {
    const size = shape === "square" ? this._squareSize : this._hexSize;
    const dim = canvas.dimensions;
    const existingZones = getSceneZones();

    let newCells;
    if (shape === "square") {
      const grid = generateSquareGrid(dim.sceneX, dim.sceneY, dim.sceneWidth, dim.sceneHeight, size);
      newCells = grid.filter(cell => !getZoneAtPoint(cell.cx, cell.cy, existingZones))
        .map(cell => ({ name: squareCellName(cell.col, cell.row), vertices: cell.vertices }));
    } else {
      const grid = generateHexGrid(dim.sceneX, dim.sceneY, dim.sceneWidth, dim.sceneHeight, size);
      newCells = grid
        .filter(cell => !getZoneAtPoint(cell.cx, cell.cy, existingZones))
        .map(cell => {
          const verts   = hexVertices(cell.cx, cell.cy, size);
          const clipped = clipPolygonToRect(verts, dim.sceneX, dim.sceneY, dim.sceneWidth, dim.sceneHeight);
          return { name: hexCellName(cell.col, cell.row), vertices: clipped };
        })
        .filter(cell => cell.vertices.length >= 3);
    }

    if (newCells.length === 0) {
      ui.notifications.info("All cells are already covered by existing zones.");
      return;
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: `Fill Scene with ${shape === "square" ? "Square" : "Hex"} Zones` },
      content: `<p>This will create <strong>${newCells.length}</strong> ${shape} zones (size ${size}px) to fill the scene.</p>
                <p>Existing zones will be preserved. Continue?</p>`,
      yes: { label: "Fill Scene", icon: "fas fa-fill" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;

    const defaultBorder = game.settings.get("sta2e-toolkit", "zoneBorderStyleDefault") ?? "solid";
    const zones = [...existingZones];
    for (const cell of newCells) {
      zones.push({
        id: foundry.utils.randomID(),
        name: cell.name,
        vertices: cell.vertices,
        color: null,
        momentumCost: 0,
        tags: [],
        sort: zones.length,
        borderStyle: defaultBorder,
        isDifficult: false,
        opacity: 0.25,
        hazards: [],
      });
    }

    await setSceneZones(zones);
    this.overlay.refresh();
    if (shape === "hex")    this._showHexOverlay();
    if (shape === "square") this._showSquareOverlay();
    ui.notifications.info(`Created ${newCells.length} ${shape} zones.`);
  }

  _deriveHexSizeFromGrid() {
    try {
      const gs = canvas?.scene?.grid?.size;
      if (gs && gs > 0) return Math.round(gs);
    } catch { /* canvas not ready */ }
    return game.settings.get("sta2e-toolkit", "zoneHexSize") ?? 150;
  }

  async promptHexSize() {
    const gridScene    = canvas?.scene;
    const gridSize     = gridScene?.grid?.size ?? 100;
    const gridDistance = gridScene?.grid?.distance ?? "?";
    const gridUnits    = gridScene?.grid?.units ?? "";
    const gridRecOneSize  = gridSize * 2;
    const gridRecTwoSize  = gridSize * 3;
    const gridType     = (() => {
      const t = gridScene?.grid?.type ?? 1;
      const map = { 0: "Gridless", 1: "Square", 2: "Hex (row, odd)", 3: "Hex (row, even)", 4: "Hex (col, odd)", 5: "Hex (col, even)" };
      return map[t] ?? `Type ${t}`;
    })();
    const gridLabel = `${gridSize}px / ${gridDistance}${gridUnits ? " " + gridUnits : ""}`;
    const content = `
      <form>
        <div class="form-group">
          <p class="notes">
            Foundry grid: <strong>${gridType}</strong> — ${gridSize}px per cell, ${gridDistance}${gridUnits ? " " + gridUnits : ""} per cell.
            Recommend for Grid sets hex and square size to be 2x-3x ${gridSize}px, ${gridRecOneSize}px between ${gridRecTwoSize}px.
          </p>
        </div>
        <div class="form-group">
          <label>Hex Size (radius in pixels)</label>
          <input type="number" name="hexSize" value="${this._hexSize}" min="50" max="1000" step="10"/>
        </div>
        <div class="form-group">
          <label>Square Cell Size (pixels)</label>
          <input type="number" name="squareSize" value="${this._squareSize}" min="50" max="1000" step="10"/>
        </div>
        <div class="form-group">
          <button type="button" class="sta2e-match-grid" style="width:100%;margin-top:4px;">
            <i class="fas fa-grid"></i> Match Both to Grid (${gridLabel})
          </button>
        </div>
      </form>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Set Zone Size" },
      content,
      ok: { label: "Apply", callback: (event, button, dialog) => {
        const form = button.form ?? dialog.querySelector?.("form") ?? button.closest?.("form");
        return form ? new FormData(form) : null;
      }},
      render: (event, html) => {
        const matchBtn   = html.querySelector?.(".sta2e-match-grid") ?? html.element?.querySelector?.(".sta2e-match-grid");
        const hexInput   = html.querySelector?.("[name=hexSize]")    ?? html.element?.querySelector?.("[name=hexSize]");
        const sqInput    = html.querySelector?.("[name=squareSize]") ?? html.element?.querySelector?.("[name=squareSize]");
        if (matchBtn && hexInput && sqInput) {
          matchBtn.addEventListener("click", () => { hexInput.value = gridSize; sqInput.value = gridSize; });
        }
      },
    });

    if (result) {
      const hex = Number(result.get?.("hexSize") ?? this._hexSize);
      const sq  = Number(result.get?.("squareSize") ?? this._squareSize);
      if (hex >= 50 && hex <= 1000) {
        this._hexSize = hex;
        await game.settings.set("sta2e-toolkit", "zoneHexSize", hex);
      }
      if (sq >= 50 && sq <= 1000) {
        this._squareSize = sq;
      }
      if (this.activeTool === "hex")    this._showHexOverlay();
      if (this.activeTool === "square") this._showSquareOverlay();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Select & drag tool
  // ═══════════════════════════════════════════════════════════════════════════

  _selectOrStartDrag(pt, event) {
    // Check if clicking on a vertex handle
    for (const [zoneId, entry] of this.overlay._zoneGraphics) {
      for (let i = 0; i < entry.handles.length; i++) {
        const h = entry.handles[i];
        if (Math.hypot(h.position.x - pt.x, h.position.y - pt.y) < 12) {
          this._dragging = { zoneId, vertexIndex: i };
          this.overlay.selectZone(zoneId);
          return;
        }
      }
    }

    // Multi-select: shift+click
    const isShift = event?.data?.originalEvent?.shiftKey || event?.shiftKey || false;
    const zones = getSceneZones();
    const zone  = getZoneAtPoint(pt.x, pt.y, zones);

    if (isShift && zone) {
      this.overlay.toggleZoneSelection(zone.id);
    } else {
      this.overlay.selectZone(zone?.id ?? null);
    }
  }

  _dragMove(pt) {
    if (!this._dragging) return;
    const { zoneId, vertexIndex } = this._dragging;
    const entry = this.overlay._zoneGraphics.get(zoneId);
    if (!entry?.handles[vertexIndex]) return;

    const snapped = this._snapToVertexExcluding(pt, 15, zoneId);
    const pos = snapped ?? pt;
    entry.handles[vertexIndex].position.set(pos.x, pos.y);
  }

  async _dragEnd() {
    if (!this._dragging) return;
    const { zoneId, vertexIndex } = this._dragging;
    const entry = this.overlay._zoneGraphics.get(zoneId);
    this._dragging = null;
    if (!entry?.handles[vertexIndex]) return;

    const newPos = entry.handles[vertexIndex].position;
    const zones = getSceneZones();
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    zone.vertices[vertexIndex] = { x: Math.round(newPos.x), y: Math.round(newPos.y) };
    await updateZone(zoneId, { vertices: zone.vertices });
    this.overlay.refresh();
  }

  _snapToVertexExcluding(pt, threshold, excludeZoneId) {
    const zones = getSceneZones();
    let closest = null, closestDist = threshold;
    for (const zone of zones) {
      if (zone.id === excludeZoneId) continue;
      for (const v of zone.vertices) {
        const d = Math.hypot(v.x - pt.x, v.y - pt.y);
        if (d < closestDist) { closestDist = d; closest = { x: v.x, y: v.y }; }
      }
    }
    return closest;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Delete tool
  // ═══════════════════════════════════════════════════════════════════════════

  async _deleteAtPoint(pt) {
    const zones = getSceneZones();
    const zone = getZoneAtPoint(pt.x, pt.y, zones);
    if (!zone) return;
    await this._deleteZoneById(zone.id);
  }

  async _deleteZoneById(id) {
    const zones = getSceneZones();
    const zone = zones.find(z => z.id === id);
    if (!zone) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Zone" },
      content: `<p>Delete zone <strong>"${zone.name || "(unnamed)"}"</strong>?</p>`,
      yes: { label: "Delete", icon: "fas fa-trash" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;

    await deleteZone(id);
    this.overlay.selectZone(null);
    this.overlay.refresh();
  }

  async _deleteSelectedZones() {
    const ids = [...this.overlay.selectedZoneIds];
    if (ids.length === 0) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Selected Zones" },
      content: `<p>Delete <strong>${ids.length} zone${ids.length !== 1 ? "s" : ""}</strong>?</p>`,
      yes: { label: "Delete", icon: "fas fa-trash" },
      no:  { label: "Cancel" },
    });
    if (!confirmed) return;

    const zones = getSceneZones().filter(z => !ids.includes(z.id));
    await setSceneZones(zones);
    this.overlay.selectZone(null);
    this.overlay.refresh();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Merge selected zones
  // ═══════════════════════════════════════════════════════════════════════════

  async mergeSelectedZones() {
    const ids = [...this.overlay.selectedZoneIds];
    if (ids.length < 2) {
      ui.notifications.warn("Select at least 2 zones to merge.");
      return;
    }

    const allZones = getSceneZones();
    const selected = allZones.filter(z => ids.includes(z.id));

    if (!areZonesAllConnected(selected)) {
      ui.notifications.warn("All selected zones must be adjacent to each other to merge.");
      return;
    }

    const mergedVerts = mergeZonePolygons(selected);
    if (!mergedVerts) {
      ui.notifications.error("Could not compute merged polygon — zones may not share edges.");
      return;
    }

    // Use the first zone's settings as defaults; combine names, tags, hazards
    const first = selected[0];
    const combinedName = selected.map(z => z.name).filter(Boolean).join(" + ");
    const combinedTags = [...new Set(selected.flatMap(z => z.tags ?? []))];
    const maxCost = Math.max(...selected.map(z => z.momentumCost ?? 0));

    const props = await this._promptZoneProperties({
      name:         combinedName,
      color:        first.color ?? null,
      momentumCost: maxCost,
      tags:         combinedTags,
      borderStyle:  first.borderStyle ?? "solid",
      isDifficult:  selected.some(z => z.isDifficult) || maxCost > 0,
      opacity:      first.opacity ?? 0.25,
      hazards:      [],
    });
    if (!props) return;

    const remaining = allZones.filter(z => !ids.includes(z.id));
    remaining.push({
      id:       foundry.utils.randomID(),
      sort:     remaining.length,
      vertices: mergedVerts,
      ...props,
    });

    await setSceneZones(remaining);
    this.overlay.selectZone(null);
    this.overlay.refresh();
    ui.notifications.info(`Merged ${ids.length} zones into "${props.name || "(unnamed)"}".`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Zone properties dialog
  // ═══════════════════════════════════════════════════════════════════════════

  async openZoneProperties(zoneId) {
    const zones = getSceneZones();
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    // If multiple zones selected, open batch properties
    const ids = [...this.overlay.selectedZoneIds];
    if (ids.length > 1) {
      return this._openBatchProperties(ids);
    }

    const props = await this._promptZoneProperties(zone);
    if (!props) return;

    await updateZone(zoneId, props);
    this.overlay.refresh();
  }

  /**
   * Batch-edit all selected zones. Only common fields are shown.
   */
  async _openBatchProperties(ids) {
    const zones = getSceneZones();
    const selected = zones.filter(z => ids.includes(z.id));
    if (selected.length === 0) return;

    // Use first zone's values as defaults
    const first = selected[0];
    const content = `
      <form class="sta2e-zone-properties">
        <p class="notes" style="margin-bottom:10px;">Editing <strong>${selected.length} zones</strong>. Changes apply to all selected zones.</p>
        <div class="form-group">
          <label>Momentum Cost</label>
          <input type="number" name="momentumCost" value="${first.momentumCost ?? 0}" min="0" max="10" step="1"/>
        </div>
        <div class="form-group">
          <label>Border Style</label>
          <select name="borderStyle">
            ${["solid","dashed","dotted","none"].map(s =>
              `<option value="${s}" ${(first.borderStyle ?? "solid") === s ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Fill Opacity</label>
          <input type="range" name="opacity" value="${Math.round((first.opacity ?? 0.25) * 100)}" min="0" max="100" step="5" style="width:100%;"/>
          <span class="sta2e-opacity-display">${Math.round((first.opacity ?? 0.25) * 100)}%</span>
        </div>
        <div class="form-group">
          <label class="checkbox"><input type="checkbox" name="isDifficult" ${(first.isDifficult || first.momentumCost > 0) ? "checked" : ""}/>  Difficult Terrain</label>
        </div>
      </form>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: `Edit ${selected.length} Zones` },
      content,
      ok: {
        label: "Apply to All",
        icon: "fas fa-save",
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.querySelector?.("form");
          if (!form) return null;
          const fd = new FormData(form);
          return {
            momentumCost: Number(fd.get("momentumCost")) || 0,
            borderStyle:  fd.get("borderStyle") ?? "solid",
            opacity:      Number(fd.get("opacity")) / 100,
            isDifficult:  fd.get("isDifficult") === "on",
          };
        },
      },
      render: (event, html) => _wireOpacitySlider(html),
    });

    if (!result) return;

    for (const id of ids) {
      await updateZone(id, result);
    }
    this.overlay.refresh();
  }

  /**
   * Show zone properties dialog. Returns the saved values or null if cancelled.
   */
  async _promptZoneProperties(defaults) {
    const tagOptions  = ["hazardous", "cover", "obscured", "vacuum", "zero-g"];
    const currentTags = defaults.tags ?? [];

    const tagCheckboxes = tagOptions.map(tag => {
      const checked = currentTags.includes(tag) ? "checked" : "";
      return `<label class="checkbox"><input type="checkbox" name="tag-${tag}" ${checked}/> ${tag}</label>`;
    }).join(" ");

    const sceneDefaultColor = canvas?.scene?.getFlag("sta2e-toolkit", "zoneDefaultColor") || "#4488ff";
    const hasCustomColor = !!defaults.color;
    let colorHex = defaults.color || sceneDefaultColor;
    if (colorHex.startsWith("hsl")) {
      const tmp = document.createElement("canvas").getContext("2d");
      tmp.fillStyle = colorHex;
      colorHex = tmp.fillStyle;
    }

    const currentBorder   = defaults.borderStyle ?? "solid";
    const currentOpacity  = Math.round((defaults.opacity ?? 0.25) * 100);
    const currentDifficult = defaults.isDifficult || (defaults.momentumCost > 0);
    const currentHazards  = defaults.hazards ?? [];

    // Build hazard rows HTML
    const hazardTypesHtml = Object.entries(HAZARD_TYPES)
      .map(([key, val]) => `<option value="${key}">${val.label}</option>`)
      .join("");

    const hazardRowsHtml = currentHazards.map((h, i) =>
      _buildHazardRowHtml(h, i, hazardTypesHtml)
    ).join("");

    const content = `
      <form class="sta2e-zone-properties">
        <div class="form-group">
          <label>Zone Name</label>
          <input type="text" name="name" value="${defaults.name ?? ""}" placeholder="e.g. Bridge, Engineering"/>
        </div>
        <div class="form-group">
          <label>Color</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="color" name="color" value="${colorHex}" ${!hasCustomColor ? 'disabled style="opacity:0.4;"' : ''}/>
            <label class="checkbox" style="white-space:nowrap;">
              <input type="checkbox" name="useDefaultColor" ${!hasCustomColor ? "checked" : ""}/>
              Use scene default
            </label>
          </div>
          <p class="notes" style="margin-top:2px;">Scene default: <span style="display:inline-block;width:12px;height:12px;background:${sceneDefaultColor};border:1px solid #666;border-radius:2px;vertical-align:middle;"></span> ${sceneDefaultColor}</p>
        </div>
        <div class="form-group">
          <label>Border Style</label>
          <select name="borderStyle">
            ${["solid","dashed","dotted","none"].map(s =>
              `<option value="${s}" ${currentBorder === s ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Fill Opacity</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="range" name="opacity" value="${currentOpacity}" min="0" max="100" step="5" style="flex:1;"/>
            <span class="sta2e-opacity-display" style="min-width:36px;text-align:right;">${currentOpacity}%</span>
          </div>
        </div>
        <div class="form-group">
          <label class="checkbox">
            <input type="checkbox" name="isDifficult" ${currentDifficult ? "checked" : ""}/>
            Difficult Terrain
          </label>
          <p class="notes">Automatically sets Momentum Cost to 1 when checked (if currently 0).</p>
        </div>
        <div class="form-group">
          <label>Momentum Cost</label>
          <input type="number" name="momentumCost" value="${defaults.momentumCost ?? 0}" min="0" max="10" step="1"/>
          <p class="notes">Extra Momentum required to move through this zone (0 = normal terrain).</p>
        </div>
        <div class="form-group">
          <label>Tags</label>
          <div class="sta2e-zone-tags">${tagCheckboxes}</div>
        </div>
        <div class="sta2e-zone-hazards-section" style="margin-top:8px;">
          <label style="display:block;font-weight:bold;margin-bottom:4px;">Hazards</label>
          <button type="button" class="sta2e-add-hazard" style="width:100%;margin-bottom:6px;">
            <i class="fas fa-plus"></i> Add Hazard
          </button>
          <div class="sta2e-zone-hazards-list" data-hazard-types='${JSON.stringify(Object.fromEntries(Object.entries(HAZARD_TYPES).map(([k,v]) => [k, v.label])))}'>${hazardRowsHtml}</div>
        </div>
      </form>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Zone Properties" },
      content,
      ok: {
        label: "Save",
        icon: "fas fa-save",
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.querySelector?.("form") ?? button.closest?.("form");
          if (!form) return null;
          const fd = new FormData(form);
          const tags = tagOptions.filter(t => fd.get(`tag-${t}`) === "on");

          let isDifficult  = fd.get("isDifficult") === "on";
          let momentumCost = Number(fd.get("momentumCost")) || 0;
          // Sync: difficult terrain checked + cost was 0 → set to 1
          if (isDifficult && momentumCost === 0) momentumCost = 1;
          if (!isDifficult && momentumCost === 0) isDifficult = false;
          // If cost > 0, treat as difficult
          if (momentumCost > 0) isDifficult = true;

          // Collect hazards
          const hazards = _collectHazardsFromForm(form);

          // Auto-add "hazardous" tag if hazards exist
          if (hazards.length > 0 && !tags.includes("hazardous")) tags.push("hazardous");
          if (hazards.length === 0) {
            const idx = tags.indexOf("hazardous");
            if (idx !== -1) tags.splice(idx, 1);
          }

          const useDefault = fd.get("useDefaultColor") === "on";
          return {
            name: fd.get("name") ?? "",
            color: useDefault ? null : (fd.get("color") ?? null),
            borderStyle: fd.get("borderStyle") ?? "solid",
            opacity: Number(fd.get("opacity")) / 100,
            isDifficult,
            momentumCost,
            tags,
            hazards,
          };
        },
      },
      render: (_event, html) => {
        _wireOpacitySlider(html);
        _wireHazardEditor(html);
        const root = html?.element ?? html;
        const colorChk = root?.querySelector("[name='useDefaultColor']");
        const colorPick = root?.querySelector("[name='color']");
        if (colorChk && colorPick) {
          colorChk.addEventListener("change", () => {
            colorPick.disabled = colorChk.checked;
            colorPick.style.opacity = colorChk.checked ? "0.4" : "1";
          });
        }
      },
    });

    return result ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Import / Export
  // ═══════════════════════════════════════════════════════════════════════════

  exportZones() {
    const zones = getSceneZones();
    const sceneName = canvas?.scene?.name ?? "scene";
    const data = {
      version: 1,
      sceneName,
      zones,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${sceneName.replace(/[^a-z0-9]/gi, "_")}-zones.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`Exported ${zones.length} zones.`);
  }

  async importZones() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type  = "file";
      input.accept = ".json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) { resolve(); return; }

        let data;
        try {
          data = JSON.parse(await file.text());
        } catch {
          ui.notifications.error("STA2e Toolkit: Invalid JSON file.");
          resolve();
          return;
        }

        if (!data?.zones || !Array.isArray(data.zones)) {
          ui.notifications.error("STA2e Toolkit: File does not contain a valid zone export.");
          resolve();
          return;
        }

        const mode = await foundry.applications.api.DialogV2.wait({
          window: { title: "Import Zones" },
          content: `<p>Import <strong>${data.zones.length}</strong> zone(s) from <em>${file.name}</em>.</p>
                    <p>How should the import be applied?</p>`,
          buttons: [
            { action: "replace", label: "Replace All", icon: "fas fa-file-import",
              callback: () => "replace" },
            { action: "merge",   label: "Merge (Add)",  icon: "fas fa-layer-group",
              callback: () => "merge" },
            { action: "cancel",  label: "Cancel",       icon: "fas fa-times",
              callback: () => null },
          ],
          default: "cancel",
        });

        if (!mode) { resolve(); return; }

        // Assign fresh IDs to imported zones to avoid collisions
        const imported = data.zones.map(z => ({
          ...z,
          id: foundry.utils.randomID(),
          // Backfill v2 fields if missing
          borderStyle: z.borderStyle ?? "solid",
          isDifficult: z.isDifficult ?? false,
          opacity:     z.opacity ?? 0.25,
          hazards:     z.hazards ?? [],
        }));

        if (mode === "replace") {
          await setSceneZones(imported);
        } else {
          const existing = getSceneZones();
          await setSceneZones([...existing, ...imported]);
        }

        this.overlay.refresh();
        ui.notifications.info(`Imported ${imported.length} zone(s) (${mode}).`);
        resolve();
      });
      input.click();
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hazard editor helpers (used by properties dialog)
// ═══════════════════════════════════════════════════════════════════════════════

function _buildHazardRowHtml(hazard, index, hazardTypesHtml) {
  const h = hazard ?? {};
  const cat = h.category ?? "lingering";
  const estJson = h.established
    ? JSON.stringify({
        established: h.established,
        establishedDamage: h.establishedDamage ?? 0,
        establishedDamageType: h.establishedDamageType ?? "stress",
        establishedEffects: h.establishedEffects ?? {},
      }).replace(/"/g, "&quot;")
    : "";
  const estNote = h.established
    ? `<div style="font-size:0.75em;color:#888;margin-top:2px;">♻ Established (${h.establishedDamage ?? "?"} ${h.establishedDamageType ?? ""})</div>`
    : "";
  return `
    <div class="sta2e-hazard-row" data-hazard-index="${index}">
      <input type="hidden" name="hazard-id-${index}" value="${h.id ?? ""}"/>
      <input type="hidden" name="hazard-established-${index}" value="${estJson}"/>
      <div class="sta2e-hazard-row-header">
        <strong>${h.label || "Hazard " + (index + 1)}</strong>
        <button type="button" class="sta2e-remove-hazard" title="Remove"><i class="fas fa-trash"></i></button>
      </div>
      <div class="form-group">
        <label>Type</label>
        <select name="hazard-type-${index}" class="sta2e-hazard-type">
          ${Object.entries(HAZARD_TYPES).map(([key, val]) =>
            `<option value="${key}" ${h.type === key ? "selected" : ""}>${val.label}</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Label</label>
        <input type="text" name="hazard-label-${index}" value="${h.label ?? ""}" placeholder="e.g. Radiation Leak"/>
      </div>
      <div class="form-group">
        <label>Category</label>
        <select name="hazard-category-${index}">
          <option value="immediate" ${cat === "immediate" ? "selected" : ""}>Immediate — GM-triggered one-shot hazard</option>
          <option value="lingering" ${cat === "lingering" ? "selected" : ""}>Lingering — zone-wide, applies each round</option>
          <option value="terrain"   ${cat === "terrain"   ? "selected" : ""}>Hazardous Terrain — triggered when crossing</option>
        </select>
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" name="hazard-description-${index}" value="${h.description ?? ""}" placeholder="Optional flavor text"/>
      </div>
      ${estNote}
    </div>`;
}

function _collectHazardsFromForm(form) {
  const rows = form.querySelectorAll(".sta2e-hazard-row");
  const hazards = [];
  rows.forEach((row, i) => {
    const idx = row.dataset.hazardIndex ?? i;
    const type        = form.querySelector(`[name="hazard-type-${idx}"]`)?.value ?? "generic";
    const label       = form.querySelector(`[name="hazard-label-${idx}"]`)?.value ?? "";
    const category    = form.querySelector(`[name="hazard-category-${idx}"]`)?.value ?? "lingering";
    const description = form.querySelector(`[name="hazard-description-${idx}"]`)?.value ?? "";
    // Preserve id and established state from hidden inputs
    const existingId  = form.querySelector(`[name="hazard-id-${idx}"]`)?.value || "";
    const estRaw      = form.querySelector(`[name="hazard-established-${idx}"]`)?.value ?? "";
    let estData = {};
    if (estRaw) {
      try { estData = JSON.parse(estRaw.replace(/&quot;/g, '"')); } catch { /* ignore */ }
    }
    hazards.push({
      id: existingId || foundry.utils.randomID(),
      type,
      label: label || (HAZARD_TYPES[type]?.label ?? "Hazard"),
      category,
      description,
      ...estData,
    });
  });
  return hazards;
}

function _wireHazardEditor(html) {
  const root = html?.element ?? html;
  if (!root) return;

  const list = root.querySelector?.(".sta2e-zone-hazards-list");
  const addBtn = root.querySelector?.(".sta2e-add-hazard");
  if (!list || !addBtn) return;

  // Delegate remove button clicks
  list.addEventListener("click", (ev) => {
    const removeBtn = ev.target.closest(".sta2e-remove-hazard");
    if (!removeBtn) return;
    const row = removeBtn.closest(".sta2e-hazard-row");
    if (row) row.remove();
    // Re-index remaining rows
    list.querySelectorAll(".sta2e-hazard-row").forEach((r, i) => {
      r.dataset.hazardIndex = i;
    });
  });

  addBtn.addEventListener("click", () => {
    const idx = list.querySelectorAll(".sta2e-hazard-row").length;
    const rowHtml = _buildHazardRowHtml({}, idx, "");
    const tmp = document.createElement("div");
    tmp.innerHTML = rowHtml;
    const newRow = tmp.firstElementChild;
    // Populate type dropdown (re-build it)
    const typeSelect = newRow.querySelector(`.sta2e-hazard-type`);
    if (typeSelect) {
      typeSelect.innerHTML = Object.entries(HAZARD_TYPES)
        .map(([key, val]) => `<option value="${key}">${val.label}</option>`)
        .join("");
    }
    list.appendChild(newRow);
  });
}

function _wireOpacitySlider(html) {
  const root = html?.element ?? html;
  if (!root) return;
  const slider  = root.querySelector?.("[name='opacity']");
  const display = root.querySelector?.(".sta2e-opacity-display");
  if (slider && display) {
    slider.addEventListener("input", () => { display.textContent = `${slider.value}%`; });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZoneToolbar — floating toolbar for zone tools
// ═══════════════════════════════════════════════════════════════════════════════

export class ZoneToolbar {
  constructor() {
    this._el = null;
    this._open = false;
  }

  get isOpen() { return this._open; }

  toggle() {
    console.log("STA2e | ZoneToolbar.toggle() called — _open:", this._open);
    if (this._open) this.close();
    else this.open();
  }

  open() {
    console.log("STA2e | ZoneToolbar.open() called — _open:", this._open);
    if (this._open) return;
    this._open = true;
    const overlay = game.sta2eToolkit?.zoneOverlay;
    let editor = game.sta2eToolkit?.zoneEditor;
    console.log("STA2e | ZoneToolbar.open() — overlay:", overlay, "editor:", editor);

    // Lazy-create zoneEditor if it didn't survive initialization
    if (overlay && !editor) {
      try {
        editor = new ZoneEditState(overlay);
        game.sta2eToolkit.zoneEditor = editor;
        console.log("STA2e | ZoneToolbar.open() — lazy-created ZoneEditState:", editor);
      } catch (err) {
        console.error("STA2e | ZoneToolbar.open() — ZoneEditState lazy-create FAILED:", err);
      }
    }

    try {
      overlay?.setEditMode(true);
      editor?.setTool("select");
    } catch (err) {
      console.warn("STA2e | ZoneToolbar.open – setTool error (non-fatal):", err);
    }
    this._render();
  }

  close() {
    this._open = false;
    const overlay = game.sta2eToolkit?.zoneOverlay;
    const editor  = game.sta2eToolkit?.zoneEditor;
    overlay?.setEditMode(false);
    editor?.setTool(null);
    this._el?.remove();
    this._el = null;
  }

  _render() {
    this._el?.remove();

    const el = document.createElement("div");
    el.id = "sta2e-zone-toolbar";
    el.innerHTML = `
      <div class="sta2e-zone-toolbar-header">
        <span>Zone Editor</span>
        <button class="sta2e-zone-close" title="Close"><i class="fas fa-times"></i></button>
      </div>
      <div class="sta2e-zone-toolbar-tools">
        <button data-zone-tool="select" class="active" title="Select / Move Zone"><i class="fas fa-mouse-pointer"></i></button>
        <button data-zone-tool="draw"   title="Draw Zone Polygon"><i class="fas fa-draw-polygon"></i></button>
        <button data-zone-tool="hex"    title="Hex Stamp"><i class="fas fa-border-all"></i></button>
        <button data-zone-tool="square" title="Square Stamp"><i class="fas fa-square"></i></button>
        <button data-zone-tool="delete" title="Delete Zone"><i class="fas fa-eraser"></i></button>
      </div>
      <div class="sta2e-zone-toolbar-actions">
        <div class="sta2e-zone-toolbar-row" style="display:flex;align-items:center;gap:6px;padding:4px 2px 2px;">
          <label style="font-size:0.72em;color:#888;white-space:nowrap;flex-shrink:0;">Border px</label>
          <input id="sta2e-border-width-input" type="number" min="1" max="20" step="1"
            style="width:52px;padding:2px 4px;background:#111;border:1px solid #444;border-radius:3px;color:#ddd;font-size:0.8em;text-align:center;"
            title="Zone border line width in pixels"/>
        </div>
        <button data-zone-action="hexSize"       title="Set Zone Size"><i class="fas fa-ruler"></i> Zone Size</button>
        <button data-zone-action="fill"          title="Fill Scene (Hex)"><i class="fas fa-fill"></i> Fill (Hex)</button>
        <button data-zone-action="fillSquare"    title="Fill Scene (Squares)"><i class="fas fa-th"></i> Fill (Square)</button>
        <button data-zone-action="configScene"   title="Open Scene Configuration"><i class="fas fa-cog"></i> Config Scene</button>
        <button data-zone-action="mergeZones"   title="Merge Selected Zones (select 2+ adjacent zones first)"><i class="fas fa-object-group"></i> Merge Selected</button>
        <button data-zone-action="exportZones"   title="Export Zones"><i class="fas fa-file-export"></i> Export</button>
        <button data-zone-action="importZones"   title="Import Zones"><i class="fas fa-file-import"></i> Import</button>
        <button data-zone-action="clearAll"      title="Clear All Zones"><i class="fas fa-trash-can"></i> Clear All</button>
      </div>`;

    el.addEventListener("click", async (ev) => {
      const toolBtn   = ev.target.closest("[data-zone-tool]");
      const actionBtn = ev.target.closest("[data-zone-action]");
      const closeBtn  = ev.target.closest(".sta2e-zone-close");
      console.log("STA2e | ZoneToolbar click — target:", ev.target, "toolBtn:", toolBtn, "actionBtn:", actionBtn, "closeBtn:", closeBtn);
      console.log("STA2e | ZoneToolbar click — zoneEditor:", game.sta2eToolkit?.zoneEditor, "zoneOverlay:", game.sta2eToolkit?.zoneOverlay);

      if (closeBtn) { this.close(); return; }

      if (toolBtn) {
        const tool = toolBtn.dataset.zoneTool;
        el.querySelectorAll("[data-zone-tool]").forEach(b => b.classList.remove("active"));
        toolBtn.classList.add("active");
        const editor = _ensureZoneEditor();
        console.log("STA2e | ZoneToolbar — setTool:", tool, "editor:", editor);
        editor?.setTool(tool);
        return;
      }

      if (actionBtn) {
        const action = actionBtn.dataset.zoneAction;
        const editor = _ensureZoneEditor();
        console.log("STA2e | ZoneToolbar — action:", action, "editor:", editor);
        if (!editor) return;

        if      (action === "hexSize")     { await editor.promptHexSize(); }
        else if (action === "fill")        { await editor.fillScene("hex"); }
        else if (action === "fillSquare")  { await editor.fillScene("square"); }
        else if (action === "configScene") { canvas.scene?.sheet.render(true); }
        else if (action === "mergeZones")  { await editor.mergeSelectedZones(); }
        else if (action === "exportZones") { editor.exportZones(); }
        else if (action === "importZones") { await editor.importZones(); }
        else if (action === "clearAll") {
          const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Clear All Zones" },
            content: "<p>Remove <strong>all</strong> zones from this scene?</p>",
            yes: { label: "Clear All", icon: "fas fa-trash" },
            no:  { label: "Cancel" },
          });
          if (!confirmed) return;
          await setSceneZones([]);
          game.sta2eToolkit?.zoneOverlay?.refresh();
        }
      }
    });

    // ── Border width input ────────────────────────────────────────────────────
    const bwInput = el.querySelector("#sta2e-border-width-input");
    if (bwInput) {
      try { bwInput.value = game.settings.get("sta2e-toolkit", "zoneBorderWidth") ?? 2; } catch { bwInput.value = 2; }
      bwInput.addEventListener("change", async () => {
        const val = Math.max(1, Math.min(20, parseInt(bwInput.value) || 2));
        bwInput.value = val;
        await game.settings.set("sta2e-toolkit", "zoneBorderWidth", val);
        game.sta2eToolkit?.zoneOverlay?.refresh();
      });
    }

    // Make toolbar draggable via its header
    const header = el.querySelector(".sta2e-zone-toolbar-header");
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      const rect = el.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      const onMove = (ev) => {
        el.style.left = (ev.clientX - offX) + "px";
        el.style.top  = (ev.clientY - offY) + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });

    document.body.appendChild(el);
    this._el = el;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Returns the PIXI canvas HTMLElement regardless of PIXI version (v7 .view / v8 .canvas). */
function _canvasEl() {
  return canvas?.app?.canvas ?? canvas?.app?.view ?? null;
}

/**
 * Returns the active ZoneEditState, lazily creating it if it wasn't initialized.
 * This handles cases where canvasReady fired before game.sta2eToolkit was set.
 */
function _ensureZoneEditor() {
  const tk = game.sta2eToolkit;
  if (!tk) return null;
  if (tk.zoneEditor) return tk.zoneEditor;
  const overlay = tk.zoneOverlay;
  if (!overlay) return null;
  try {
    tk.zoneEditor = new ZoneEditState(overlay);
    console.log("STA2e | _ensureZoneEditor: lazy-created ZoneEditState");
  } catch (err) {
    console.error("STA2e | _ensureZoneEditor: ZoneEditState creation failed:", err);
  }
  return tk.zoneEditor ?? null;
}

