/**
 * sta2e-toolkit | region-logic-editor.js
 *
 * The visual editor for a Region Logic behavior's graph: a node palette on the
 * left, a pannable, zoomable canvas in the middle, and an inspector on the
 * right for the selected node's settings. Opened from the behavior sheet's
 * Flow panel, or game.sta2eToolkit.openRegionLogicEditor(uuid).
 *
 * Everything that changes the graph is a pure function in
 * region-logic-editor-model.js; this file holds the working copy, draws it, and
 * turns pointer and key events into those calls. Three things it rests on:
 *
 * - **The shell renders once; the graph is redrawn by hand.** ApplicationV2's
 *   render() replaces the whole window, which would drop the inspector's focus
 *   and the canvas's pointer capture mid-drag. `_drawNodes`, `_drawWires` and
 *   `_drawInspector` rebuild their own hosts, and a node drag only moves
 *   elements and redraws the wires.
 * - **Edits stay local until Save.** The working copy is a graph; every edit
 *   pushes the previous one onto the undo stack. Save writes
 *   `system.graph` in one update; closing with unsaved changes asks first.
 *   Another GM's save reloads the editor only when it has nothing unsaved.
 * - **The canvas claims keyboard focus** (`data-keyboard-focus="true"`), so
 *   Foundry's keyboard manager treats it like a text field. Without it, Delete
 *   here would also delete whatever walls or lights are selected on the map.
 */

import { getLcCssVars, withBaseLcTheme } from "./lcars-theme.js";
import { normalizeGraph, nodeConfig } from "./region-logic-graph.js";
import {
  REGION_LOGIC_NODES, isLogicSwitchOn, setLogicSwitch, isNodeDisabled, nodeDisabledUntil, setNodesDisabled,
} from "./region-logic-nodes.js";
import {
  NODE_W, HEAD_H, ROW_H, PAD, FOOT_H, GRID, PORT_LABELS, PORT_TONE, CATEGORIES, TEMPLATES,
  nodePorts, nodeHeight, portPoint, wirePath, wireKey, wireProblem, addNode, removeNodes, moveNodes,
  connect, disconnect, getPath, setNodeConfig, setNodeTitle, duplicateNodes, graphBounds, fitView,
  zoomAbout, insertTemplate, freeSpot,
} from "./region-logic-editor-model.js";

const MODULE = "sta2e-toolkit";
const BEHAVIOR_TYPE = `${MODULE}.regionLogic`;
const HISTORY_MAX = 100;
const SVG_OFF = 10000;   // the wire layer reaches this far round the origin

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

const CATEGORY_COLOUR = {
  trigger: "var(--rle-green)", condition: "var(--rle-yellow)", flow: "var(--rle-tertiary)",
  action: "var(--rle-primary)",
};

const LAYERS = {
  walls: () => canvas.walls, lighting: () => canvas.lighting, sounds: () => canvas.sounds,
  regions: () => canvas.regions,
};

/** Open editors, by behavior UUID — opening one again brings it forward. */
const _open = new Map();

function _desc(node) {
  return REGION_LOGIC_NODES.get(node.type) ?? null;
}

function _label(node) {
  return node.title || _desc(node)?.label || `Unknown (${node.type})`;
}

function _summary(node, behavior) {
  const desc = _desc(node);
  if (!desc) return "This node type is not loaded.";
  let s = "";
  try { s = desc.summary?.(nodeConfig(node, desc)) ?? ""; } catch { /* never break the canvas */ }
  if (desc.switchState) s += isLogicSwitchOn(behavior, node.id) ? " · ON" : " · OFF";
  return s;
}

function _choices(field) {
  const raw = typeof field.choices === "function" ? field.choices() : (field.choices ?? {});
  return Object.entries(raw).map(([value, label]) => [value, game.i18n.localize(String(label))]);
}

/** A target's name for the UUID lists: its own name, or its kind and id. */
function _targetName(uuid, field, behavior) {
  let doc = null;
  try { doc = fromUuidSync(uuid, { relative: behavior }); } catch { /* shown as missing */ }
  if (!doc) return { text: `Missing (${uuid.split(".").pop()})`, missing: true };
  const name = doc.name || `${field.noun.charAt(0).toUpperCase()}${field.noun.slice(1)} ${doc.id}`;
  const scene = doc.parent?.documentName === "Scene" && doc.parent !== behavior.parent?.parent
    ? ` · ${doc.parent.name}` : "";
  return { text: `${name}${scene}`, missing: false };
}

export class RegionLogicEditor extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["sta2e-region-logic-editor"],
    tag: "section",
    window: { resizable: true, icon: "fa-solid fa-diagram-project", title: "Region Logic" },
    position: { width: 1180, height: 720 },
  };

  constructor(behavior, options = {}) {
    super(options);
    this.behavior = behavior;
    this.graph = normalizeGraph(behavior.system.graph);
    this._savedJson = JSON.stringify(this.graph);
    this._undo = [];
    this._redo = [];
    this.view = { x: 40, y: 40, zoom: 1 };
    this._fitted = false;
    this.selected = new Set();
    this.selectedWire = null;
    this._drag = null;
  }

  get title() {
    return `Region Logic: ${this.behavior.name || "Behavior"} — ${this.behavior.parent?.name ?? "Region"}`;
  }

  get dirty() {
    return JSON.stringify(this.graph) !== this._savedJson;
  }

  // ── Shell ──────────────────────────────────────────────────────────────────

  async _renderHTML() {
    return withBaseLcTheme(() => {
      const vars = getLcCssVars("rle")
        + `--rle-node-w:${NODE_W}px;--rle-head-h:${HEAD_H}px;--rle-row-h:${ROW_H}px;`
        + `--rle-pad:${PAD}px;--rle-foot-h:${FOOT_H}px;--rle-svg-off:${SVG_OFF}px;`;
      const palette = CATEGORIES.map(cat => {
        const items = [...REGION_LOGIC_NODES.values()].filter(d => d.category === cat.id && !d.hidden);
        if (!items.length) return "";
        return `<div class="rle-pal-group" style="--rle-c:${CATEGORY_COLOUR[cat.id]}">
          <div class="rle-pal-title">${esc(cat.label)}</div>
          ${items.map(d => `<button type="button" class="rle-pal-item" draggable="true" data-add="${esc(d.type)}"
            data-tooltip="Click to add, or drag onto the canvas"><i class="${esc(d.icon)}"></i>
            <span>${esc(d.label)}</span></button>`).join("")}
        </div>`;
      }).join("");
      const templates = TEMPLATES.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join("");
      return `<div class="rle" style="${vars}">
        <aside class="rle-palette">${palette}</aside>
        <div class="rle-main">
          <div class="rle-toolbar">
            <select class="rle-tpl" data-tooltip="Add a ready-made flow">
              <option value="">Add a template…</option>${templates}</select>
            <span class="rle-gap"></span>
            <button type="button" data-act="undo" data-tooltip="Undo (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i></button>
            <button type="button" data-act="redo" data-tooltip="Redo (Ctrl+Y)"><i class="fa-solid fa-rotate-right"></i></button>
            <button type="button" data-act="zoomOut" data-tooltip="Zoom out"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
            <span class="rle-zoom">100%</span>
            <button type="button" data-act="zoomIn" data-tooltip="Zoom in"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
            <button type="button" data-act="fit" data-tooltip="Fit the flow in view"><i class="fa-solid fa-expand"></i></button>
          </div>
          <div class="rle-canvas" tabindex="0" data-keyboard-focus="true">
            <div class="rle-world">
              <svg class="rle-wires" width="${SVG_OFF * 2}" height="${SVG_OFF * 2}">
                <g transform="translate(${SVG_OFF} ${SVG_OFF})"><g class="rle-wire-list"></g>
                <path class="rle-wire rle-wire--temp" d=""></path></g>
              </svg>
              <div class="rle-nodes"></div>
            </div>
            <div class="rle-empty">
              <strong>An empty flow</strong>
              <span>Add a node from the left, or start from a template:</span>
              <div class="rle-empty-list">${TEMPLATES.map(t => `<button type="button" data-tpl="${esc(t.id)}"
                data-tooltip="${esc(t.hint)}">${esc(t.label)}</button>`).join("")}</div>
            </div>
            <div class="rle-help">Drag from an output dot to an input dot · drag an input's wire off to move
              it · Delete removes · wheel zooms · drag the background to pan</div>
          </div>
        </div>
        <aside class="rle-inspector"></aside>
        <footer class="rle-foot">
          <span class="rle-status"></span>
          <button type="button" data-act="revert"><i class="fa-solid fa-clock-rotate-left"></i> Revert</button>
          <button type="button" data-act="save" class="rle-primary"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        </footer>
      </div>`;
    });
  }

  _replaceHTML(result, element) {
    (element.querySelector(".window-content") ?? element).innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._wire();
    // Fit once the window has its size; the canvas measures 0 before that.
    requestAnimationFrame(() => {
      if (!this._fitted && this.graph.nodes.length) this._fit();
      this._fitted = true;
      this._drawAll();
    });
    // A timed disable ends by the clock, with no document update to say so;
    // redraw when the set of disabled nodes changes.
    clearInterval(this._disabledTimer);
    this._disabledSig = this._disabledSignature();
    this._disabledTimer = setInterval(() => {
      const sig = this._disabledSignature();
      if (sig === this._disabledSig) return;
      this._disabledSig = sig;
      this._drawNodes();
      this._queueInspector();
    }, 1000);
  }

  _disabledSignature() {
    return this.graph.nodes.filter(n => isNodeDisabled(this.behavior, n.id)).map(n => n.id).join("|");
  }

  _q(sel) {
    return this.element?.querySelector(sel) ?? null;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  _drawAll() {
    this._applyView();
    this._drawNodes();
    this._drawWires();
    this._drawInspector();
    this._drawStatus();
  }

  _applyView() {
    const world = this._q(".rle-world");
    const canvasEl = this._q(".rle-canvas");
    if (!world || !canvasEl) return;
    const { x, y, zoom } = this.view;
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    canvasEl.style.backgroundSize = `${GRID * zoom}px ${GRID * zoom}px`;
    canvasEl.style.backgroundPosition = `${x}px ${y}px`;
    const label = this._q(".rle-zoom");
    if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  }

  _nodeHtml(node) {
    const desc = _desc(node);
    const ports = nodePorts(node, desc, this.graph);
    const rows = Math.max(1, ports.inputs.length, ports.outputs.length);
    const colour = desc ? (CATEGORY_COLOUR[desc.category] ?? CATEGORY_COLOUR.action) : "var(--rle-red)";
    const port = (side, name) => {
      if (!name) return `<span class="rle-port-gap"></span>`;
      const tone = side === "out" ? (PORT_TONE[name] ?? "") : "";
      return `<span class="rle-port rle-port--${side}${tone ? ` rle-port--${tone}` : ""}" data-side="${side}"
        data-node="${esc(node.id)}" data-port="${esc(name)}">${esc(PORT_LABELS[name] ?? name)}</span>`;
    };
    let body = "";
    for (let i = 0; i < rows; i++) {
      body += `<div class="rle-row">${port("in", ports.inputs[i])}${port("out", ports.outputs[i])}</div>`;
    }
    const sw = desc?.switchState
      ? `<span class="rle-badge${isLogicSwitchOn(this.behavior, node.id) ? " is-on" : ""}">`
        + `${isLogicSwitchOn(this.behavior, node.id) ? "ON" : "OFF"}</span>` : "";
    const disabled = isNodeDisabled(this.behavior, node.id);
    const off = disabled ? `<span class="rle-badge rle-badge--disabled">DISABLED</span>` : "";
    const summary = _summary(node, this.behavior).replace(/ · (ON|OFF)$/, "");
    const cls = ["rle-node", this.selected.has(node.id) && "is-selected", !desc && "is-unknown",
      disabled && "is-disabled", this._controlledIds().has(node.id) && "is-controlled"]
      .filter(Boolean).join(" ");
    return `<div class="${cls}" data-node="${esc(node.id)}" style="--rle-c:${colour};left:${node.x}px;top:${node.y}px;
      height:${nodeHeight(ports)}px;">
      <div class="rle-node-head"><i class="${esc(desc?.icon ?? "fa-solid fa-question")}"></i>
        <span class="rle-node-title">${esc(_label(node))}</span>${off}${sw}</div>
      <div class="rle-node-ports">${body}</div>
      <div class="rle-node-sum" data-tooltip="${esc(summary)}">${esc(summary)}</div>
    </div>`;
  }

  _drawNodes() {
    const host = this._q(".rle-nodes");
    if (!host) return;
    host.innerHTML = this.graph.nodes.map(n => this._nodeHtml(n)).join("");
    const empty = this._q(".rle-empty");
    if (empty) empty.hidden = this.graph.nodes.length > 0;
  }

  /** One node's element, redrawn in place (its summary or badge changed). */
  _redrawNode(id) {
    const node = this.graph.nodes.find(n => n.id === id);
    const el = this._q(`.rle-node[data-node="${CSS.escape(id)}"]`);
    if (!node || !el) return this._drawNodes();
    el.outerHTML = this._nodeHtml(node);
  }

  _portPointFor(nodeId, side, port) {
    const node = this.graph.nodes.find(n => n.id === nodeId);
    if (!node) return null;
    return portPoint(node, nodePorts(node, _desc(node), this.graph), side, port);
  }

  _drawWires() {
    const host = this._q(".rle-wire-list");
    if (!host) return;
    let out = "";
    for (const w of this.graph.wires) {
      const a = this._portPointFor(w.from, "out", w.out);
      const b = this._portPointFor(w.to, "in", w.in);
      if (!a || !b) continue;
      const d = wirePath(a, b);
      const key = wireKey(w);
      const tone = PORT_TONE[w.out] ?? "";
      out += `<path class="rle-wire-hit" data-wire="${esc(key)}" d="${d}"></path>`
        + `<path class="rle-wire${tone ? ` rle-wire--${tone}` : ""}${this.selectedWire === key ? " is-selected" : ""}"
          d="${d}"></path>`;
    }
    host.innerHTML = out;
  }

  _drawStatus() {
    const el = this._q(".rle-status");
    if (!el) return;
    const n = this.graph.nodes.length;
    el.textContent = `${n} node${n === 1 ? "" : "s"} · ${this.dirty ? "Unsaved changes" : "Saved"}`;
    el.classList.toggle("is-dirty", this.dirty);
    const undo = this._q('[data-act="undo"]');
    const redo = this._q('[data-act="redo"]');
    if (undo) undo.disabled = !this._undo.length;
    if (redo) redo.disabled = !this._redo.length;
  }

  // ── Inspector ──────────────────────────────────────────────────────────────

  _drawInspector() {
    const host = this._q(".rle-inspector");
    if (!host) return;
    // Note which control has focus, so rebuilding the panel does not take it away.
    const active = host.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active && ["path", "title", "paste", "swatch"]
      .map(k => (active.dataset?.[k] !== undefined ? `[data-${k}="${CSS.escape(active.dataset[k])}"]` : null))
      .find(Boolean);
    const scroll = host.scrollTop;
    this._fillInspector(host);
    host.scrollTop = scroll;
    if (focusKey) host.querySelector(focusKey)?.focus({ preventScroll: true });
  }

  _fillInspector(host) {
    const ids = [...this.selected];
    if (ids.length === 1) host.innerHTML = this._nodeInspector(this.graph.nodes.find(n => n.id === ids[0]));
    else if (ids.length > 1) {
      host.innerHTML = `<div class="rle-insp-head"><strong>${ids.length} nodes selected</strong></div>
        <div class="rle-insp-actions">
          <button type="button" data-act="duplicate"><i class="fa-solid fa-clone"></i> Duplicate</button>
          <button type="button" data-act="delete" class="rle-danger"><i class="fa-solid fa-trash"></i> Delete</button>
        </div>`;
    } else if (this.selectedWire) host.innerHTML = this._wireInspector();
    else host.innerHTML = this._graphInspector();
  }

  _graphInspector() {
    const triggers = this.graph.nodes.filter(n => _desc(n)?.category === "trigger").length;
    return `<div class="rle-insp-head"><strong>${esc(this.behavior.name || "Region Logic")}</strong>
        <span>${esc(this.behavior.parent?.name ?? "")}</span></div>
      <p class="rle-insp-note">A flow starts at a <b>trigger</b> — a token entering or leaving, or a button
        pressed on the sheet — and follows the wires out of whichever port each node chooses.
        ${triggers ? "" : "<br><b>This flow has no trigger yet, so nothing will start it.</b>"}</p>
      <p class="rle-insp-note">Click a node to change its settings. Shift-click to select several.
        Ctrl+D duplicates, Ctrl+S saves.</p>`;
  }

  _wireInspector() {
    const w = this.graph.wires.find(x => wireKey(x) === this.selectedWire);
    if (!w) return this._graphInspector();
    const from = this.graph.nodes.find(n => n.id === w.from);
    const to = this.graph.nodes.find(n => n.id === w.to);
    const port = p => (PORT_LABELS[p] ? ` <em>(${esc(PORT_LABELS[p])})</em>` : "");
    return `<div class="rle-insp-head"><strong>Wire</strong></div>
      <p class="rle-insp-note">${esc(_label(from))}${port(w.out)} → ${esc(_label(to))}${port(w.in)}</p>
      <div class="rle-insp-actions">
        <button type="button" data-act="delete" class="rle-danger"><i class="fa-solid fa-scissors"></i> Remove Wire</button>
      </div>`;
  }

  _nodeInspector(node) {
    if (!node) return this._graphInspector();
    const desc = _desc(node);
    if (!desc) {
      return `<div class="rle-insp-head"><strong>${esc(_label(node))}</strong></div>
        <p class="rle-insp-note">No node type "${esc(node.type)}" is registered — the module that adds it
          may be disabled. Its settings and wires are kept.</p>
        <div class="rle-insp-actions"><button type="button" data-act="delete" class="rle-danger">
          <i class="fa-solid fa-trash"></i> Delete</button></div>`;
    }
    const config = nodeConfig(node, desc);
    const fields = (desc.fields ?? []).filter(f => !f.showIf || f.showIf(config));
    const extra = [];
    if (node.type === "manual") {
      extra.push(`<button type="button" data-act="press" ${this.dirty ? "disabled data-tooltip=\"Save first\"" : ""}>
        <i class="fa-solid fa-hand-pointer"></i> Press</button>`);
    }
    {
      const until = nodeDisabledUntil(this.behavior, node.id);
      const disabled = isNodeDisabled(this.behavior, node.id);
      const when = until ? ` until ${new Date(until).toLocaleTimeString()}` : "";
      extra.push(disabled
        ? `<span class="rle-insp-state">Disabled${esc(when)}</span>
          <button type="button" data-act="nodeEnable"><i class="fa-solid fa-power-off"></i> Enable</button>`
        : `<button type="button" data-act="nodeDisable" data-tooltip="A disabled node is skipped until enabled">
          <i class="fa-solid fa-power-off"></i> Disable</button>`);
    }
    if (desc.switchState) {
      const on = isLogicSwitchOn(this.behavior, node.id);
      extra.push(`<span class="rle-insp-state">Now <b>${on ? "ON" : "OFF"}</b></span>`);
      // A Switch's state is only a flag, so it can be set by hand; a door or
      // light switch would also have to move its targets, which is the sheet's job.
      if (node.type === "latch") {
        extra.push(`<button type="button" data-act="latchOn" ${on ? "disabled" : ""}>Turn On</button>`,
          `<button type="button" data-act="latchOff" ${on ? "" : "disabled"}>Turn Off</button>`);
      }
    }
    const macro = node.type === "manual"
      ? `<p class="rle-insp-note rle-mono">game.sta2eToolkit.fireRegionLogic("${esc(this.behavior.uuid)}",
          "${esc(config.label)}")</p>` : "";
    return `<div class="rle-insp-head" style="--rle-c:${CATEGORY_COLOUR[desc.category] ?? CATEGORY_COLOUR.action}">
        <i class="${esc(desc.icon)}"></i><strong>${esc(desc.label)}</strong><span>${esc(node.id)}</span></div>
      <label class="rle-field"><span>Name on the canvas</span>
        <input type="text" data-title value="${esc(node.title ?? "")}" placeholder="${esc(desc.label)}"></label>
      ${fields.length ? fields.map(f => this._fieldHtml(f, config)).join("")
        : `<p class="rle-insp-note">Nothing to set.</p>`}
      ${extra.length ? `<div class="rle-insp-actions">${extra.join("")}</div>` : ""}
      ${macro}
      <div class="rle-insp-actions">
        <button type="button" data-act="duplicate"><i class="fa-solid fa-clone"></i> Duplicate</button>
        <button type="button" data-act="delete" class="rle-danger"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>`;
  }

  _fieldHtml(field, config) {
    if (field.type === "heading") return `<div class="rle-insp-heading">${esc(field.label)}</div>`;
    const value = getPath(config, field.key);
    const path = esc(field.key);
    const hint = field.hint ? `<small>${esc(field.hint)}</small>` : "";
    switch (field.type) {
      case "boolean":
        return `<label class="rle-field rle-field--check"><input type="checkbox" data-path="${path}"
          data-type="boolean" ${value ? "checked" : ""}><span>${esc(field.label)}</span>${hint}</label>`;
      case "select": {
        const cur = value ?? "";
        const opts = _choices(field).map(([v, l]) =>
          `<option value="${esc(v)}" ${String(cur) === v ? "selected" : ""}>${esc(l)}</option>`).join("");
        return `<label class="rle-field"><span>${esc(field.label)}</span>
          <select data-path="${path}" data-type="select" ${field.nullable ? "data-nullable" : ""}>${opts}</select>${hint}</label>`;
      }
      case "number":
        return `<label class="rle-field"><span>${esc(field.label)}</span>
          <input type="number" data-path="${path}" data-type="number" value="${value ?? ""}"
            ${field.min != null ? `min="${field.min}"` : ""} ${field.max != null ? `max="${field.max}"` : ""}
            ${field.step != null ? `step="${field.step}"` : ""} ${field.nullable ? "data-nullable placeholder=\"blank\"" : ""}>${hint}</label>`;
      case "color":
        return `<label class="rle-field"><span>${esc(field.label)}</span><span class="rle-inline">
          <input type="text" data-path="${path}" data-type="color" value="${esc(value ?? "")}" placeholder="blank">
          <input type="color" data-swatch="${path}" value="${esc(value || "#ffffff")}"></span>${hint}</label>`;
      case "audio":
        return `<label class="rle-field"><span>${esc(field.label)}</span><span class="rle-inline">
          <input type="text" data-path="${path}" data-type="text" value="${esc(value ?? "")}" placeholder="No sound">
          <button type="button" data-browse="${path}" data-tooltip="Browse"><i class="fa-solid fa-file-audio"></i></button>
          </span>${hint}</label>`;
      case "nodes": {
        const self = this._selectedNode();
        const picked = new Set(Array.isArray(value) ? value : []);
        const others = this.graph.nodes.filter(n => n.id !== self?.id);
        const rows = others.map(n => `<label class="rle-pick"><input type="checkbox" data-nodes-path="${path}"
          value="${esc(n.id)}" ${picked.has(n.id) ? "checked" : ""}><i class="${esc(_desc(n)?.icon ?? "fa-solid fa-question")}"></i>
          <span>${esc(_label(n))}</span><small>${esc(n.id)}</small></label>`).join("");
        return `<div class="rle-field"><span>${esc(field.label)} (${others.filter(n => picked.has(n.id)).length})</span>
          <div class="rle-picks">${rows || `<span class="rle-insp-note">No other nodes yet.</span>`}</div>${hint}</div>`;
      }
      case "uuids": {
        const list = Array.isArray(value) ? value : [];
        const rows = list.map((uuid, i) => {
          const name = _targetName(uuid, field, this.behavior);
          return `<li class="${name.missing ? "is-missing" : ""}"><span data-tooltip="${esc(uuid)}">${esc(name.text)}</span>
            <button type="button" data-remove="${path}" data-index="${i}" data-tooltip="Remove">
            <i class="fa-solid fa-xmark"></i></button></li>`;
        }).join("");
        return `<div class="rle-field"><span>${esc(field.label)} (${list.length})</span>
          <ul class="rle-uuids">${rows || `<li class="is-empty">None</li>`}</ul>
          <span class="rle-inline">
            <button type="button" data-add-selected="${path}"><i class="fa-solid fa-plus"></i>
              Add Selected ${esc(field.noun)}s</button>
          </span>
          <span class="rle-inline"><input type="text" data-paste="${path}" placeholder="…or paste a UUID">
            <button type="button" data-paste-add="${path}" data-tooltip="Add"><i class="fa-solid fa-check"></i></button></span>
          ${hint}</div>`;
      }
      default:
        return `<label class="rle-field"><span>${esc(field.label)}</span>
          <input type="text" data-path="${path}" data-type="text" value="${esc(value ?? "")}">${hint}</label>`;
    }
  }

  _selectedNode() {
    if (this.selected.size !== 1) return null;
    const id = [...this.selected][0];
    return this.graph.nodes.find(n => n.id === id) ?? null;
  }

  _fieldFor(node, path) {
    return (_desc(node)?.fields ?? []).find(f => f.key === path) ?? null;
  }

  /** A control's value as the field stores it. */
  _readControl(el, field) {
    const type = el.dataset.type;
    if (type === "boolean") return el.checked;
    if (type === "number") {
      if (el.value === "") return field?.nullable ? null : (field?.min ?? 0);
      let n = Number(el.value);
      if (!Number.isFinite(n)) n = 0;
      if (field?.min != null) n = Math.max(field.min, n);
      if (field?.max != null) n = Math.min(field.max, n);
      return n;
    }
    if (type === "color") {
      const v = el.value.trim();
      return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
    }
    if (type === "select" && el.value === "" && el.hasAttribute("data-nullable")) return null;
    return el.value;
  }

  _setConfig(node, path, value, { redrawInspector = true } = {}) {
    this._commit(setNodeConfig(this.graph, node.id, path, value), { nodes: false });
    this._redrawNode(node.id);
    if (redrawInspector) this._queueInspector();
  }

  /**
   * Rebuild the inspector on the next tick. `change` fires BEFORE focus moves
   * to the next control, so rebuilding at once would remove the control focus
   * is about to land on; a tick later, `_drawInspector` sees where it landed
   * and puts it back.
   */
  _queueInspector() {
    clearTimeout(this._inspectorTimer);
    this._inspectorTimer = setTimeout(() => this._drawInspector(), 0);
  }

  _onInspectorChange(event) {
    const el = event.target;
    const node = this._selectedNode();
    if (!node) return;
    if (el.matches("[data-title]")) {
      this._commit(setNodeTitle(this.graph, node.id, el.value), { nodes: false });
      this._redrawNode(node.id);
      return;
    }
    if (el.matches("[data-swatch]")) {
      this._setConfig(node, el.dataset.swatch, el.value.toLowerCase());
      return;
    }
    if (el.matches("[data-nodes-path]")) {
      const path = el.dataset.nodesPath;
      const ids = [...this.element.querySelectorAll(`[data-nodes-path="${CSS.escape(path)}"]:checked`)]
        .map(box => box.value);
      this._setConfig(node, path, ids);
      this._select(this.selected);   // re-outline the nodes it now controls
      return;
    }
    if (!el.matches("[data-path]")) return;
    const field = this._fieldFor(node, el.dataset.path);
    this._setConfig(node, el.dataset.path, this._readControl(el, field));
  }

  _onInspectorClick(event) {
    const btn = event.target.closest("button");
    if (!btn) return;
    const node = this._selectedNode();
    if (btn.dataset.act) return this._onAction(btn.dataset.act);
    if (!node) return;
    const config = nodeConfig(node, _desc(node));
    if (btn.dataset.browse) {
      const path = btn.dataset.browse;
      const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      new FP({ type: "audio", current: getPath(config, path) || "",
        callback: src => this._setConfig(node, path, src) }).render(true);
      return;
    }
    if (btn.dataset.remove) {
      const path = btn.dataset.remove;
      const list = [...(getPath(config, path) ?? [])];
      list.splice(Number(btn.dataset.index), 1);
      this._setConfig(node, path, list);
      return;
    }
    if (btn.dataset.addSelected) return this._addSelected(node, btn.dataset.addSelected);
    if (btn.dataset.pasteAdd) {
      const input = this._q(`[data-paste="${CSS.escape(btn.dataset.pasteAdd)}"]`);
      return this._addPasted(node, btn.dataset.pasteAdd, input?.value ?? "");
    }
  }

  _addUuids(node, path, uuids) {
    const have = getPath(nodeConfig(node, _desc(node)), path) ?? [];
    const next = [...new Set([...have, ...uuids])];
    if (next.length !== have.length) this._setConfig(node, path, next);
  }

  _addSelected(node, path) {
    const field = this._fieldFor(node, path);
    let picked = [...(LAYERS[field.layer]?.()?.controlled ?? [])].map(o => o.document).filter(Boolean);
    if (field.filter) picked = picked.filter(field.filter);
    if (field.docType === "Region") picked = picked.filter(d => d !== this.behavior.parent);
    if (!picked.length) {
      ui.notifications.info(`Select one or more ${field.noun}s on the canvas first.`);
      return;
    }
    this._addUuids(node, path, picked.map(d => d.uuid));
  }

  async _addPasted(node, path, text) {
    const uuid = text.trim();
    if (!uuid) return;
    const field = this._fieldFor(node, path);
    let doc = null;
    try { doc = await fromUuid(uuid); } catch { /* reported below */ }
    if (doc?.documentName !== field.docType || (field.filter && !field.filter(doc))) {
      ui.notifications.warn(`That is not a ${field.noun}.`);
      return;
    }
    this._addUuids(node, path, [doc.uuid]);
  }

  // ── Edits & history ────────────────────────────────────────────────────────

  /** Take a new working graph, keeping the old one for Undo. */
  _commit(next, { nodes = true, wires = true } = {}) {
    if (next === this.graph) return;
    this._undo.push(this.graph);
    if (this._undo.length > HISTORY_MAX) this._undo.shift();
    this._redo = [];
    this.graph = next;
    if (nodes) this._drawNodes();
    if (wires) this._drawWires();
    this._drawStatus();
  }

  _restore(graph) {
    this.graph = graph;
    const ids = new Set(graph.nodes.map(n => n.id));
    for (const id of [...this.selected]) if (!ids.has(id)) this.selected.delete(id);
    if (this.selectedWire && !graph.wires.some(w => wireKey(w) === this.selectedWire)) this.selectedWire = null;
    this._drawAll();
  }

  _undoStep() {
    if (!this._undo.length) return;
    this._redo.push(this.graph);
    this._restore(this._undo.pop());
  }

  _redoStep() {
    if (!this._redo.length) return;
    this._undo.push(this.graph);
    this._restore(this._redo.pop());
  }

  _select(ids, wire = null) {
    this.selected = new Set(ids);
    this.selectedWire = wire;
    const controlled = this._controlledIds();
    for (const el of this.element.querySelectorAll(".rle-node")) {
      el.classList.toggle("is-selected", this.selected.has(el.dataset.node));
      el.classList.toggle("is-controlled", controlled.has(el.dataset.node));
    }
    this._drawWires();
    this._drawInspector();
  }

  /** The nodes the selected Enable / Disable node acts on, outlined on the canvas. */
  _controlledIds() {
    const node = this._selectedNode();
    if (node?.type !== "toggleNodes") return new Set();
    return new Set(nodeConfig(node, _desc(node)).nodes ?? []);
  }

  _deleteSelection() {
    if (this.selected.size) {
      this._commit(removeNodes(this.graph, [...this.selected]));
      this._select([]);
    } else if (this.selectedWire) {
      this._commit(disconnect(this.graph, this.selectedWire));
      this._select([]);
    }
  }

  _duplicateSelection() {
    if (!this.selected.size) return;
    const { graph, ids } = duplicateNodes(this.graph, [...this.selected]);
    this._commit(graph);
    this._select(ids);
  }

  /** The graph point at the middle of the visible canvas. */
  _viewCentre() {
    const r = this._q(".rle-canvas").getBoundingClientRect();
    return { x: (r.width / 2 - this.view.x) / this.view.zoom, y: (r.height / 2 - this.view.y) / this.view.zoom };
  }

  _addNodeAt(type, x, y) {
    const desc = REGION_LOGIC_NODES.get(type);
    if (!desc) return;
    const spot = freeSpot(this.graph, REGION_LOGIC_NODES, x - NODE_W / 2, y - HEAD_H / 2,
      nodeHeight(nodePorts({ type }, desc)));
    const { graph, id } = addNode(this.graph, type, spot.x, spot.y);
    this._commit(graph);
    this._select([id]);
  }

  _addTemplate(id) {
    const { graph, ids } = insertTemplate(this.graph, REGION_LOGIC_NODES, id);
    if (!ids.length) return;
    this._commit(graph);
    this._select(ids);
    this._fit(graphBounds({ nodes: graph.nodes.filter(n => ids.includes(n.id)), wires: [] }, REGION_LOGIC_NODES));
  }

  _fit(bounds = graphBounds(this.graph, REGION_LOGIC_NODES)) {
    const r = this._q(".rle-canvas")?.getBoundingClientRect();
    if (!r?.width) return;
    this.view = fitView(bounds, r.width, r.height);
    this._applyView();
  }

  _zoomBy(factor, sx = null, sy = null) {
    const r = this._q(".rle-canvas").getBoundingClientRect();
    this.view = zoomAbout(this.view, factor, sx ?? r.width / 2, sy ?? r.height / 2);
    this._applyView();
  }

  async _save() {
    const graph = normalizeGraph(this.graph);
    this._saving = true;
    try {
      await this.behavior.update({ "system.graph": graph });
      this.graph = graph;
      this._savedJson = JSON.stringify(graph);
      this._drawStatus();
      this._drawInspector();
      ui.notifications.info(`Saved "${this.behavior.name}".`);
    } catch (err) {
      ui.notifications.error(`Region Logic: could not save — ${err.message}`);
    } finally {
      this._saving = false;
    }
  }

  async _onAction(act) {
    switch (act) {
      case "undo": return this._undoStep();
      case "redo": return this._redoStep();
      case "zoomIn": return this._zoomBy(1.2);
      case "zoomOut": return this._zoomBy(1 / 1.2);
      case "fit": return this._fit();
      case "save": return this._save();
      case "revert":
        if (!this.dirty) return;
        this._undo.push(this.graph);
        this._redo = [];
        return this._restore(normalizeGraph(this.behavior.system.graph));
      case "delete": return this._deleteSelection();
      case "duplicate": return this._duplicateSelection();
      case "nodeEnable":
      case "nodeDisable": {
        const node = this._selectedNode();
        if (node) await setNodesDisabled(this.behavior, [node.id], act === "nodeDisable");
        return;
      }
      case "latchOn":
      case "latchOff": {
        const node = this._selectedNode();
        if (node?.type === "latch") await setLogicSwitch(this.behavior, node.id, act === "latchOn");
        return;
      }
      case "press": {
        const node = this._selectedNode();
        if (!node || this.dirty) return;
        await game.sta2eToolkit?.fireRegionLogic?.(this.behavior, node.id);
        return;
      }
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  _wire() {
    const root = this._q(".rle");
    const canvasEl = this._q(".rle-canvas");
    if (!root || !canvasEl) return;

    root.addEventListener("click", event => {
      const btn = event.target.closest("[data-act], [data-tpl], [data-add]");
      if (!btn || btn.closest(".rle-inspector")) return;
      if (btn.dataset.tpl) return this._addTemplate(btn.dataset.tpl);
      if (btn.dataset.add) {
        const c = this._viewCentre();
        return this._addNodeAt(btn.dataset.add, c.x, c.y);
      }
      this._onAction(btn.dataset.act);
    });
    this._q(".rle-tpl")?.addEventListener("change", event => {
      const id = event.target.value;
      event.target.value = "";
      if (id) this._addTemplate(id);
    });

    const insp = this._q(".rle-inspector");
    insp.addEventListener("change", this._onInspectorChange.bind(this));
    insp.addEventListener("click", this._onInspectorClick.bind(this));
    insp.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target.matches("[data-paste]")) {
        event.preventDefault();
        const node = this._selectedNode();
        if (node) this._addPasted(node, event.target.dataset.paste, event.target.value);
      }
    });

    // Palette drag onto the canvas.
    for (const item of root.querySelectorAll(".rle-pal-item")) {
      item.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", `sta2e-rle:${item.dataset.add}`);
        event.dataTransfer.effectAllowed = "copy";
      });
    }
    canvasEl.addEventListener("dragover", event => event.preventDefault());
    canvasEl.addEventListener("drop", event => {
      const data = event.dataTransfer.getData("text/plain");
      if (!data.startsWith("sta2e-rle:")) return;
      event.preventDefault();
      const p = this._toGraph(event);
      this._addNodeAt(data.slice(10), p.x, p.y);
    });

    canvasEl.addEventListener("pointerdown", this._onPointerDown.bind(this));
    canvasEl.addEventListener("pointermove", this._onPointerMove.bind(this));
    canvasEl.addEventListener("pointerup", this._onPointerUp.bind(this));
    canvasEl.addEventListener("pointercancel", this._onPointerUp.bind(this));
    canvasEl.addEventListener("wheel", event => {
      event.preventDefault();
      const r = canvasEl.getBoundingClientRect();
      this._zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - r.left, event.clientY - r.top);
    }, { passive: false });
    canvasEl.addEventListener("dblclick", event => {
      if (event.target.closest(".rle-node, .rle-empty")) return;
      this._fit();
    });

    canvasEl.addEventListener("keydown", event => {
      // Never let a key reach Foundry's canvas bindings from here.
      event.stopPropagation();
      const mod = event.ctrlKey || event.metaKey;
      const k = event.key.toLowerCase();
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); this._deleteSelection(); }
      else if (mod && k === "z") { event.preventDefault(); event.shiftKey ? this._redoStep() : this._undoStep(); }
      else if (mod && k === "y") { event.preventDefault(); this._redoStep(); }
      else if (mod && k === "d") { event.preventDefault(); this._duplicateSelection(); }
      else if (mod && k === "a") { event.preventDefault(); this._select(this.graph.nodes.map(n => n.id)); }
      else if (event.key === "Escape" && (this.selected.size || this.selectedWire)) {
        event.preventDefault();
        this._select([]);
      }
    });
    root.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        this._save();
      }
    });
  }

  _toGraph(event) {
    const r = this._q(".rle-canvas").getBoundingClientRect();
    return { x: (event.clientX - r.left - this.view.x) / this.view.zoom,
      y: (event.clientY - r.top - this.view.y) / this.view.zoom };
  }

  _onPointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest(".rle-empty button")) return;
    const canvasEl = event.currentTarget;
    canvasEl.focus({ preventScroll: true });
    const p = this._toGraph(event);

    // Middle button always pans.
    const port = event.button === 0 ? event.target.closest(".rle-port") : null;
    if (port && port.dataset.side === "out") {
      this._drag = { kind: "wire", from: port.dataset.node, out: port.dataset.port };
    } else if (port && port.dataset.side === "in") {
      // Pick up the newest wire into this input and move it; a bare input does nothing.
      const into = this.graph.wires.filter(w => w.to === port.dataset.node && w.in === port.dataset.port);
      const w = into.at(-1);
      if (!w) return;
      this._commit(disconnect(this.graph, wireKey(w)));
      this._drag = { kind: "wire", from: w.from, out: w.out };
    } else if (event.button === 0 && event.target.closest(".rle-wire-hit")) {
      this._select([], event.target.closest(".rle-wire-hit").dataset.wire);
      return;
    } else if (event.button === 0 && event.target.closest(".rle-node")) {
      const id = event.target.closest(".rle-node").dataset.node;
      if (event.shiftKey) {
        const next = new Set(this.selected);
        next.has(id) ? next.delete(id) : next.add(id);
        this._select(next);
        if (!next.has(id)) return;
      } else if (!this.selected.has(id)) this._select([id]);
      const start = new Map(this.graph.nodes.filter(n => this.selected.has(n.id)).map(n => [n.id, { x: n.x, y: n.y }]));
      // The drag moves a copy; the graph it started from is what Undo goes back to.
      const before = this.graph;
      this.graph = JSON.parse(JSON.stringify(before));
      this._drag = { kind: "move", origin: p, start, moved: false, before };
    } else {
      if (event.button === 0 && !event.shiftKey) this._select([]);
      this._drag = { kind: "pan", sx: event.clientX, sy: event.clientY, vx: this.view.x, vy: this.view.y };
      canvasEl.classList.add("is-panning");
    }
    canvasEl.setPointerCapture(event.pointerId);
    if (this._drag?.kind === "wire") {
      canvasEl.classList.add("is-wiring");
      this._drawTempWire(p);
    }
  }

  _drawTempWire(p) {
    const temp = this._q(".rle-wire--temp");
    const a = this._portPointFor(this._drag.from, "out", this._drag.out);
    if (temp && a) temp.setAttribute("d", wirePath(a, p));
  }

  _onPointerMove(event) {
    const d = this._drag;
    if (!d) return;
    if (d.kind === "pan") {
      this.view.x = d.vx + event.clientX - d.sx;
      this.view.y = d.vy + event.clientY - d.sy;
      this._applyView();
    } else if (d.kind === "wire") {
      this._drawTempWire(this._toGraph(event));
      const target = this._dropTarget(event);
      for (const el of this.element.querySelectorAll(".rle-port.is-target")) el.classList.remove("is-target");
      target?.el?.classList.add("is-target");
    } else if (d.kind === "move") {
      const p = this._toGraph(event);
      const dx = p.x - d.origin.x;
      const dy = p.y - d.origin.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      // Move the working copy without history; one entry is pushed on release.
      for (const n of this.graph.nodes) {
        const s = d.start.get(n.id);
        if (!s) continue;
        n.x = s.x + dx;
        n.y = s.y + dy;
        const el = this._q(`.rle-node[data-node="${CSS.escape(n.id)}"]`);
        if (el) { el.style.left = `${n.x}px`; el.style.top = `${n.y}px`; }
      }
      this._drawWires();
    }
  }

  /** The input port under the pointer, or a node's only input when dropped on its body. */
  _dropTarget(event) {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const port = el?.closest?.(".rle-port--in");
    if (port) return { el: port, to: port.dataset.node, in: port.dataset.port };
    const nodeEl = el?.closest?.(".rle-node");
    if (!nodeEl) return null;
    const node = this.graph.nodes.find(n => n.id === nodeEl.dataset.node);
    const inputs = node ? nodePorts(node, _desc(node), this.graph).inputs : [];
    if (inputs.length !== 1) return null;
    return { el: nodeEl.querySelector(".rle-port--in"), to: node.id, in: inputs[0] };
  }

  _onPointerUp(event) {
    const d = this._drag;
    this._drag = null;
    const canvasEl = this._q(".rle-canvas");
    canvasEl?.classList.remove("is-panning", "is-wiring");
    try { canvasEl?.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    if (!d) return;
    if (d.kind === "wire") {
      this._q(".rle-wire--temp")?.setAttribute("d", "");
      for (const el of this.element.querySelectorAll(".rle-port.is-target")) el.classList.remove("is-target");
      const target = event.type === "pointerup" ? this._dropTarget(event) : null;
      if (!target) return this._drawWires();
      const wire = { from: d.from, out: d.out, to: target.to, in: target.in };
      const problem = wireProblem(this.graph, REGION_LOGIC_NODES, wire);
      if (problem) {
        if (problem !== "Already connected.") ui.notifications.warn(problem);
        return this._drawWires();
      }
      this._commit(connect(this.graph, REGION_LOGIC_NODES, wire), { nodes: false });
    } else if (d.kind === "move" && !d.moved) {
      this.graph = d.before;
    } else if (d.kind === "move") {
      // Put the pre-drag graph back, then commit the snapped move as one step.
      const moved = this.graph;
      const ids = [...d.start.keys()];
      const first = moved.nodes.find(n => n.id === ids[0]);
      const s = d.start.get(ids[0]);
      this.graph = d.before;
      this._commit(moveNodes(d.before, ids, first.x - s.x, first.y - s.y));
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Another client saved the behavior, or a switch changed state. */
  _onBehaviorUpdate(changes) {
    if (this._saving) return;
    if (changes.system?.graph !== undefined) {
      if (this.dirty) {
        ui.notifications.warn(`"${this.behavior.name}" was saved elsewhere. Your unsaved edits are kept — `
          + "Save overwrites the other version, Revert takes it.");
      } else {
        const graph = normalizeGraph(this.behavior.system.graph);
        this.graph = graph;
        this._savedJson = JSON.stringify(graph);
        this._undo = [];
        this._redo = [];
        this._restore(graph);
        return;
      }
    }
    if (changes.flags?.[MODULE] !== undefined) {
      this._drawNodes();
      this._queueInspector();
    }
    if (changes.name !== undefined && this.window?.title) this.window.title.textContent = this.title;
  }

  async close(options = {}) {
    if (this.dirty && !options.discard && this.behavior?.parent && !this._closing) {
      this._closing = true;
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Unsaved Changes" },
        content: `<p>Save the changes to "${esc(this.behavior.name)}" before closing?</p>`,
        buttons: [
          { action: "save", label: "Save", icon: "fa-solid fa-floppy-disk", default: true },
          { action: "discard", label: "Discard", icon: "fa-solid fa-trash" },
          { action: "cancel", label: "Keep Editing", icon: "fa-solid fa-xmark" },
        ],
        rejectClose: false,
      }).catch(() => "cancel");
      this._closing = false;
      if (choice === "save") await this._save();
      else if (choice !== "discard") return this;
    }
    clearInterval(this._disabledTimer);
    _open.delete(this.behavior.uuid);
    return super.close(options);
  }
}

/** Open (or bring forward) the editor for a Region Logic behavior. GM only. */
export async function openRegionLogicEditor(behaviorOrUuid) {
  const behavior = typeof behaviorOrUuid === "string" ? await fromUuid(behaviorOrUuid) : behaviorOrUuid;
  if (behavior?.type !== BEHAVIOR_TYPE) {
    ui.notifications?.warn("STA2e Toolkit | Not a Region Logic behavior.");
    return null;
  }
  if (!game.user.isGM) {
    ui.notifications?.warn("STA2e Toolkit | Only a GM can edit Region Logic.");
    return null;
  }
  let app = _open.get(behavior.uuid);
  if (!app) {
    app = new RegionLogicEditor(behavior);
    _open.set(behavior.uuid, app);
    await app.render({ force: true });
  } else if (app.rendered) app.bringToFront();
  else await app.render({ force: true });
  return app;
}

export function registerRegionLogicEditor() {
  Hooks.on("updateRegionBehavior", (doc, changes) => _open.get(doc.uuid)?._onBehaviorUpdate(changes));
  Hooks.on("deleteRegionBehavior", doc => _open.get(doc.uuid)?.close({ discard: true }));
}
