/**
 * sta2e-toolkit | zone-monitor.js
 * Zone Monitor — GM-only floating panel showing all zones in the current scene,
 * their tokens, and hazard activation buttons. Replaces the old right-click
 * zone info panel / hazard dialog.
 *
 * Draggable, collapsible sections, position persisted in localStorage, LCARS-themed.
 */

import { getLcTokens } from "./lcars-theme.js";
import { getSceneZones, getZoneAtPoint } from "./zone-data.js";

const MONITOR_ID         = "sta2e-zone-monitor";
const POS_KEY            = "sta2e-toolkit.zoneMonitorPos";
const COLLAPSE_KEY       = "sta2e-toolkit.zoneMonitorCollapsed";
const BODY_COLLAPSED_KEY = "sta2e-toolkit.zoneMonitorBodyCollapsed";
const SHOW_EMPTY_KEY     = "sta2e-toolkit.zoneMonitorShowEmpty";

function getTokenDocumentCenter(token) {
  const doc = token?.document;
  if (!doc) return token?.center ?? { x: 0, y: 0 };

  const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  const widthPx  = (doc.width  ?? 1) * gridSize;
  const heightPx = (doc.height ?? 1) * gridSize;

  return {
    x: (doc.x ?? 0) + widthPx / 2,
    y: (doc.y ?? 0) + heightPx / 2,
  };
}

export class ZoneMonitor {

  constructor() {
    this._el              = null;
    this._body            = null;
    this._footer          = null;
    this._collapseToggle  = null;
    this._showEmptyToggle = null;
    this._visible         = false;
    this._monitorCollapsed = localStorage.getItem(BODY_COLLAPSED_KEY) === "true";
    this._showEmptyZones  = localStorage.getItem(SHOW_EMPTY_KEY) !== "false";
    this._collapseState   = this._loadCollapse();
    this._debounceTimer   = null;
    this._followupTimer   = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  toggle() {
    if (this._visible) this.hide(); else this.show();
  }

  show() {
    if (!this._el) this._build();
    this._el.style.display = "flex";
    this._visible = true;
    this.refresh();
  }

  hide() {
    if (this._el) this._el.style.display = "none";
    this._visible = false;
  }

  destroy() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    if (this._followupTimer) clearTimeout(this._followupTimer);
    this._el?.remove();
    this._el   = null;
    this._body = null;
    this._visible = false;
  }

  refresh() {
    if (!this._visible || !this._body) return;

    const LC    = getLcTokens();
    const zones = getSceneZones();
    const tokens = canvas?.tokens?.placeables ?? [];

    // Map each token to its zone
    const zoneTokenMap = new Map();   // zoneId → token[]
    const noZoneTokens = [];

    for (const t of tokens) {
      const center = getTokenDocumentCenter(t);
      const zone   = getZoneAtPoint(center.x, center.y, zones);
      if (zone) {
        if (!zoneTokenMap.has(zone.id)) zoneTokenMap.set(zone.id, []);
        zoneTokenMap.get(zone.id).push(t);
      } else {
        noZoneTokens.push(t);
      }
    }

    this._body.innerHTML = "";

    if (zones.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = `padding: 12px; font-size: 0.8em; opacity: 0.5; text-align: center;`;
      empty.textContent = "No zones in this scene.";
      this._body.appendChild(empty);
      return;
    }

    // Sort zones with tokens to the top for easy access
    const sortedZones = [...zones].sort((a, b) => {
      const aHas = zoneTokenMap.has(a.id) ? 1 : 0;
      const bHas = zoneTokenMap.has(b.id) ? 1 : 0;
      return bHas - aHas;
    });

    const visibleZones = this._showEmptyZones
      ? sortedZones
      : sortedZones.filter(zone => (zoneTokenMap.get(zone.id)?.length ?? 0) > 0);

    if (visibleZones.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = `padding: 12px; font-size: 0.8em; opacity: 0.5; text-align: center;`;
      empty.textContent = this._showEmptyZones
        ? "No zones in this scene."
        : "No occupied zones right now.";
      this._body.appendChild(empty);
    }

    for (const zone of visibleZones) {
      const zoneTokens = zoneTokenMap.get(zone.id) ?? [];
      this._body.appendChild(this._renderZoneSection(zone, zoneTokens, LC));
    }

    // "No Zone" section for tokens outside all zones
    if (noZoneTokens.length > 0) {
      const noZone = { id: "__nozone__", name: "No Zone", hazards: [], tags: [], momentumCost: 0 };
      this._body.appendChild(this._renderZoneSection(noZone, noZoneTokens, LC, true));
    }
  }

  _debouncedRefresh() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    if (this._followupTimer) clearTimeout(this._followupTimer);

    this._debounceTimer = setTimeout(() => this.refresh(), 100);
    // A second pass catches post-move animation settling and async hazard updates.
    this._followupTimer = setTimeout(() => this.refresh(), 450);
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  _build() {
    document.getElementById(MONITOR_ID)?.remove();

    const LC = getLcTokens();

    const el = document.createElement("div");
    el.id = MONITOR_ID;
    el.style.cssText = `
      position: fixed;
      z-index: 9998;
      display: flex;
      flex-direction: column;
      min-width: 480px;
      max-width: 90vw;
      max-height: 60vh;
      background: ${LC.bg};
      border: 1px solid ${LC.border};
      border-top: 3px solid ${LC.primary};
      border-radius: 2px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.85), 0 0 10px rgba(255,153,0,0.1);
      font-family: ${LC.font};
      color: ${LC.text};
      user-select: none;
      overflow: hidden;
    `;

    const pos = this._loadPos();
    el.style.left = `${pos.x}px`;
    el.style.top  = `${pos.y}px`;

    // ── Header (drag handle) ─────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "sta2e-zm-header";
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: ${LC.primary};
      padding: 4px 10px;
      cursor: grab;
    `;

    const title = document.createElement("span");
    title.style.cssText = `
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: ${LC.bg};
    `;
    title.textContent = "Zone Monitor";

    const controls = document.createElement("div");
    controls.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
    `;

    const emptyToggle = document.createElement("button");
    emptyToggle.className = "sta2e-zm-empty-toggle";
    emptyToggle.type = "button";
    emptyToggle.title = "Show or hide zones with no tokens";
    this._showEmptyToggle = emptyToggle;
    this._updateShowEmptyToggle(LC);

    // Collapse toggle (chevron to collapse/expand the entire body)
    const collapseBtn = document.createElement("button");
    collapseBtn.className = "sta2e-zm-collapse-toggle";
    collapseBtn.style.cssText = `
      background: none;
      border: none;
      color: ${LC.bg};
      font-size: 11px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      opacity: 0.7;
    `;
    collapseBtn.innerHTML = this._monitorCollapsed
      ? '<i class="fas fa-chevron-right"></i>'
      : '<i class="fas fa-chevron-down"></i>';
    collapseBtn.title = "Collapse/Expand Zone Monitor";
    this._collapseToggle = collapseBtn;

    const closeBtn = document.createElement("button");
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: ${LC.bg};
      font-size: 13px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      opacity: 0.7;
    `;
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close Zone Monitor";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
    });

    header.appendChild(title);
    controls.appendChild(emptyToggle);
    controls.appendChild(collapseBtn);
    controls.appendChild(closeBtn);
    header.appendChild(controls);
    el.appendChild(header);

    // ── Body (scrollable zone list) ──────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "sta2e-zm-body";
    body.style.cssText = `
      overflow-y: auto;
      overflow-x: hidden;
      flex: 1;
      padding: 4px 0;
      background: ${LC.panel};
    `;
    el.appendChild(body);
    this._body = body;

    // ── Footer bar ───────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.style.cssText = `
      height: 3px;
      flex-shrink: 0;
      background: linear-gradient(to right, ${LC.primary}, ${LC.secondary}, ${LC.primary});
    `;
    el.appendChild(footer);
    this._footer = footer;

    // Apply initial monitor-level collapse
    if (this._monitorCollapsed) {
      body.style.display = "none";
      footer.style.display = "none";
    }

    // Wire collapse toggle
    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._monitorCollapsed = !this._monitorCollapsed;
      body.style.display   = this._monitorCollapsed ? "none" : "";
      footer.style.display = this._monitorCollapsed ? "none" : "";
      collapseBtn.innerHTML = this._monitorCollapsed
        ? '<i class="fas fa-chevron-right"></i>'
        : '<i class="fas fa-chevron-down"></i>';
      localStorage.setItem(BODY_COLLAPSED_KEY, this._monitorCollapsed);
    });

    emptyToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      this._showEmptyZones = !this._showEmptyZones;
      localStorage.setItem(SHOW_EMPTY_KEY, this._showEmptyZones);
      this._updateShowEmptyToggle(LC);
      this.refresh();
    });

    document.body.appendChild(el);
    this._el = el;

    this._makeDraggable(header, el);
  }

  // ── Zone section rendering ─────────────────────────────────────────────────

  _renderZoneSection(zone, tokens, LC, isNoZone = false) {
    const section = document.createElement("div");
    section.className = "sta2e-zm-zone";
    section.style.borderBottom = `1px solid ${LC.borderDim}`;

    const collapsed = !!this._collapseState[zone.id];
    const immediateHazards  = (zone.hazards ?? []).filter(h => h.category === "immediate");
    const lingeringHazards  = (zone.hazards ?? []).filter(h => h.category === "lingering");
    const terrainHazards    = (zone.hazards ?? []).filter(h => h.category === "terrain");

    // ── Section header ───────────────────────────────────────────────────────
    const hdr = document.createElement("div");
    hdr.className = "sta2e-zm-zone-header";
    hdr.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 0.8em;
      transition: background 0.1s;
    `;
    hdr.addEventListener("mouseenter", () => hdr.style.background = "rgba(255,255,255,0.04)");
    hdr.addEventListener("mouseleave", () => hdr.style.background = "transparent");

    // Chevron
    const chevron = document.createElement("i");
    chevron.className = "fas fa-chevron-down";
    chevron.style.cssText = `
      font-size: 0.7em;
      transition: transform 0.2s;
      flex-shrink: 0;
      width: 10px;
      text-align: center;
      color: ${LC.textDim};
    `;
    if (collapsed) chevron.style.transform = "rotate(-90deg)";
    hdr.appendChild(chevron);

    // Zone name
    const nameEl = document.createElement("span");
    nameEl.style.cssText = `
      font-weight: 700;
      letter-spacing: 0.06em;
      color: ${isNoZone ? LC.textDim : LC.primary};
      flex-shrink: 0;
    `;
    nameEl.textContent = zone.name || "(unnamed)";
    hdr.appendChild(nameEl);

    // Meta summary
    const meta = document.createElement("span");
    meta.style.cssText = `
      font-size: 0.85em;
      opacity: 0.5;
      margin-left: auto;
      white-space: nowrap;
    `;
    const metaParts = [];
    if (zone.momentumCost > 0) metaParts.push(`+${zone.momentumCost}M`);
    if (zone.isDifficult) metaParts.push("Difficult");
    const hazardCount = (zone.hazards ?? []).length;
    if (hazardCount > 0) metaParts.push(`\u26a0 ${hazardCount} hazard${hazardCount !== 1 ? "s" : ""}`);
    metaParts.push(`${tokens.length} token${tokens.length !== 1 ? "s" : ""}`);
    meta.textContent = metaParts.join(" \u2022 ");
    hdr.appendChild(meta);

    // Zone properties gear button (not for "No Zone")
    if (!isNoZone) {
      const gearBtn = document.createElement("button");
      gearBtn.className = "sta2e-zm-gear-btn";
      gearBtn.style.cssText = `
        background: none;
        border: none;
        color: ${LC.textDim};
        font-size: 0.85em;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        opacity: 0.6;
        flex-shrink: 0;
        transition: opacity 0.15s;
      `;
      gearBtn.innerHTML = '<i class="fas fa-cog"></i>';
      gearBtn.title = "Open Zone Properties";
      gearBtn.addEventListener("mouseenter", () => { gearBtn.style.opacity = "1"; });
      gearBtn.addEventListener("mouseleave", () => { gearBtn.style.opacity = "0.6"; });
      gearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        game.sta2eToolkit?.zoneEditor?.openZoneProperties(zone.id);
      });
      hdr.appendChild(gearBtn);
    }

    section.appendChild(hdr);

    // ── Section body ─────────────────────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "sta2e-zm-zone-body";
    body.style.cssText = `padding: 2px 10px 6px 28px;`;
    if (collapsed) body.style.display = "none";

    // Tags
    if (!isNoZone) {
      const tags = (zone.tags ?? []).join(", ");
      if (tags) {
        const tagsEl = document.createElement("div");
        tagsEl.style.cssText = `font-size: 0.72em; opacity: 0.5; margin-bottom: 4px; letter-spacing: 0.04em;`;
        tagsEl.textContent = `Tags: ${tags}`;
        body.appendChild(tagsEl);
      }
    }

    // Terrain hazard rows (zone-level, before token rows)
    if (!isNoZone && terrainHazards.length > 0) {
      for (const hazard of terrainHazards) {
        const terrainRow = document.createElement("div");
        terrainRow.style.cssText = `
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 0;
          font-size: 0.78em;
          border-bottom: 1px solid ${LC.borderDim}22;
          margin-bottom: 2px;
        `;

        const terrainLabel = document.createElement("span");
        terrainLabel.style.cssText = `
          color: ${LC.yellow ?? "#ffcc00"};
          font-weight: 600;
          flex: 1;
          letter-spacing: 0.04em;
        `;
        terrainLabel.textContent = `\u26f0 ${hazard.label || hazard.type}`;
        terrainRow.appendChild(terrainLabel);

        if (hazard.established) {
          const badge = document.createElement("span");
          badge.style.cssText = `
            font-size: 0.8em;
            color: ${LC.textDim};
            opacity: 0.7;
          `;
          badge.textContent = "Established";
          terrainRow.appendChild(badge);

          const resetBtn = document.createElement("button");
          resetBtn.className = "sta2e-zm-hazard-btn";
          resetBtn.style.cssText = `
            background: none;
            border: 1px solid ${LC.textDim ?? "#888"};
            color: ${LC.textDim ?? "#888"};
            font-size: 0.82em;
            font-family: ${LC.font};
            padding: 1px 6px;
            border-radius: 3px;
            cursor: pointer;
            white-space: nowrap;
            letter-spacing: 0.04em;
            transition: background 0.15s;
          `;
          resetBtn.textContent = "Reset";
          const refund = hazard.establishedThreatCost ?? 0;
          resetBtn.title = `Reset ${hazard.label || hazard.type}${refund > 0 ? ` — refund ${refund} Threat` : ""}`;
          resetBtn.addEventListener("mouseenter", () => {
            resetBtn.style.background = `${LC.textDim ?? "#888"}22`;
          });
          resetBtn.addEventListener("mouseleave", () => {
            resetBtn.style.background = "none";
          });
          resetBtn.addEventListener("click", async () => {
            const { ZoneHazard } = await import("./zone-hazard.js");
            await ZoneHazard.resetHazard(zone.id, hazard.id);
          });
          terrainRow.appendChild(resetBtn);
        }

        const setupBtn = document.createElement("button");
        setupBtn.className = "sta2e-zm-hazard-btn";
        setupBtn.style.cssText = `
          background: none;
          border: 1px solid ${LC.yellow ?? "#ffcc00"};
          color: ${LC.yellow ?? "#ffcc00"};
          font-size: 0.82em;
          font-family: ${LC.font};
          padding: 1px 6px;
          border-radius: 3px;
          cursor: pointer;
          white-space: nowrap;
          letter-spacing: 0.04em;
          transition: background 0.15s;
        `;
        setupBtn.textContent = hazard.established ? "Reconfigure" : "Setup";
        setupBtn.title = hazard.established
          ? `Reconfigure ${hazard.label || hazard.type}`
          : `Setup ${hazard.label || hazard.type} (opens hazard builder)`;
        setupBtn.addEventListener("mouseenter", () => {
          setupBtn.style.background = `${LC.yellow ?? "#ffcc00"}22`;
        });
        setupBtn.addEventListener("mouseleave", () => {
          setupBtn.style.background = "none";
        });
        setupBtn.addEventListener("click", async () => {
          // Determine isShip from first token in zone, default to false
          const firstToken = tokens[0];
          const isShip = firstToken?.actor?.system?.systems !== undefined;
          const { ZoneHazard } = await import("./zone-hazard.js");
          await ZoneHazard.setupHazard(zone.id, hazard.id, hazard.label || hazard.type, hazard, isShip, "terrain");
        });
        terrainRow.appendChild(setupBtn);

        body.appendChild(terrainRow);
      }
    }

    // Lingering hazard rows (zone-level, before token rows)
    if (!isNoZone && lingeringHazards.length > 0) {
      for (const hazard of lingeringHazards) {
        const lingerRow = document.createElement("div");
        lingerRow.style.cssText = `
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 0;
          font-size: 0.78em;
          border-bottom: 1px solid ${LC.borderDim}22;
          margin-bottom: 2px;
        `;

        const lingerLabel = document.createElement("span");
        lingerLabel.style.cssText = `
          color: ${LC.orange ?? "#ff6600"};
          font-weight: 600;
          flex: 1;
          letter-spacing: 0.04em;
        `;
        lingerLabel.textContent = `${hazard.established ? "\u267b" : "\ud83d\udd25"} ${hazard.label || hazard.type}`;
        lingerRow.appendChild(lingerLabel);

        if (hazard.established) {
          const badge = document.createElement("span");
          badge.style.cssText = `
            font-size: 0.8em;
            color: ${LC.textDim};
            opacity: 0.7;
          `;
          badge.textContent = "Established";
          lingerRow.appendChild(badge);

          const resetBtn = document.createElement("button");
          resetBtn.className = "sta2e-zm-hazard-btn";
          resetBtn.style.cssText = `
            background: none;
            border: 1px solid ${LC.textDim ?? "#888"};
            color: ${LC.textDim ?? "#888"};
            font-size: 0.82em;
            font-family: ${LC.font};
            padding: 1px 6px;
            border-radius: 3px;
            cursor: pointer;
            white-space: nowrap;
            letter-spacing: 0.04em;
            transition: background 0.15s;
          `;
          resetBtn.textContent = "Reset";
          const refund = hazard.establishedThreatCost ?? 0;
          resetBtn.title = `Reset ${hazard.label || hazard.type}${refund > 0 ? ` — refund ${refund} Threat` : ""}`;
          resetBtn.addEventListener("mouseenter", () => {
            resetBtn.style.background = `${LC.textDim ?? "#888"}22`;
          });
          resetBtn.addEventListener("mouseleave", () => {
            resetBtn.style.background = "none";
          });
          resetBtn.addEventListener("click", async () => {
            const { ZoneHazard } = await import("./zone-hazard.js");
            await ZoneHazard.resetHazard(zone.id, hazard.id);
          });
          lingerRow.appendChild(resetBtn);
        }

        if (!hazard.established) {
          const setupBtn = document.createElement("button");
          setupBtn.className = "sta2e-zm-hazard-btn";
          setupBtn.style.cssText = `
            background: none;
            border: 1px solid ${LC.orange ?? "#ff6600"};
            color: ${LC.orange ?? "#ff6600"};
            font-size: 0.82em;
            font-family: ${LC.font};
            padding: 1px 6px;
            border-radius: 3px;
            cursor: pointer;
            white-space: nowrap;
            letter-spacing: 0.04em;
            transition: background 0.15s;
          `;
          setupBtn.textContent = "Setup";
          setupBtn.title = `Setup ${hazard.label || hazard.type} (opens hazard builder)`;
          setupBtn.addEventListener("mouseenter", () => {
            setupBtn.style.background = `${LC.orange ?? "#ff6600"}22`;
          });
          setupBtn.addEventListener("mouseleave", () => {
            setupBtn.style.background = "none";
          });
          setupBtn.addEventListener("click", async () => {
            const firstToken = tokens[0];
            const isShip = firstToken?.actor?.system?.systems !== undefined;
            const { ZoneHazard } = await import("./zone-hazard.js");
            await ZoneHazard.setupHazard(zone.id, hazard.id, hazard.label || hazard.type, hazard, isShip, "lingering");
          });
          lingerRow.appendChild(setupBtn);
        }

        body.appendChild(lingerRow);
      }
    }

    // Immediate hazard zone-level rows (only for established ones — shows reset button)
    if (!isNoZone && immediateHazards.length > 0) {
      for (const hazard of immediateHazards) {
        if (!hazard.established) continue;
        const immedRow = document.createElement("div");
        immedRow.style.cssText = `
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 0;
          font-size: 0.78em;
          border-bottom: 1px solid ${LC.borderDim}22;
          margin-bottom: 2px;
        `;

        const immedLabel = document.createElement("span");
        immedLabel.style.cssText = `
          color: ${LC.red ?? "#ff3333"};
          font-weight: 600;
          flex: 1;
          letter-spacing: 0.04em;
        `;
        immedLabel.textContent = `\u26a1 ${hazard.label || hazard.type}`;
        immedRow.appendChild(immedLabel);

        const badge = document.createElement("span");
        badge.style.cssText = `
          font-size: 0.8em;
          color: ${LC.textDim};
          opacity: 0.7;
        `;
        badge.textContent = "Established";
        immedRow.appendChild(badge);

        const resetBtn = document.createElement("button");
        resetBtn.className = "sta2e-zm-hazard-btn";
        resetBtn.style.cssText = `
          background: none;
          border: 1px solid ${LC.textDim ?? "#888"};
          color: ${LC.textDim ?? "#888"};
          font-size: 0.82em;
          font-family: ${LC.font};
          padding: 1px 6px;
          border-radius: 3px;
          cursor: pointer;
          white-space: nowrap;
          letter-spacing: 0.04em;
          transition: background 0.15s;
        `;
        resetBtn.textContent = "Reset";
        const refund = hazard.establishedThreatCost ?? 0;
        resetBtn.title = `Reset ${hazard.label || hazard.type}${refund > 0 ? ` — refund ${refund} Threat` : ""}`;
        resetBtn.addEventListener("mouseenter", () => {
          resetBtn.style.background = `${LC.textDim ?? "#888"}22`;
        });
        resetBtn.addEventListener("mouseleave", () => {
          resetBtn.style.background = "none";
        });
        resetBtn.addEventListener("click", async () => {
          const { ZoneHazard } = await import("./zone-hazard.js");
          await ZoneHazard.resetHazard(zone.id, hazard.id);
        });
        immedRow.appendChild(resetBtn);

        body.appendChild(immedRow);
      }
    }

    // Token rows
    if (tokens.length === 0 && !isNoZone) {
      const empty = document.createElement("div");
      empty.style.cssText = `font-size: 0.75em; opacity: 0.4; padding: 2px 0;`;
      empty.textContent = "No tokens in zone";
      body.appendChild(empty);
    }

    for (const token of tokens) {
      const row = document.createElement("div");
      row.className = "sta2e-zm-token-row";
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
        font-size: 0.78em;
      `;

      // Token image
      const img = document.createElement("img");
      img.className = "sta2e-zm-token-img";
      img.src = token.document.texture.src;
      img.style.cssText = `
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid ${LC.borderDim};
        object-fit: cover;
        flex-shrink: 0;
      `;
      img.onerror = () => { img.style.display = "none"; };
      row.appendChild(img);

      // Token name
      const nameSpan = document.createElement("span");
      nameSpan.className = "sta2e-zm-token-name";
      nameSpan.style.cssText = `
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: ${LC.text};
      `;
      nameSpan.textContent = token.document.name;
      row.appendChild(nameSpan);

      // Immediate hazard buttons (red)
      if (!isNoZone && immediateHazards.length > 0) {
        for (const hazard of immediateHazards) {
          const btn = document.createElement("button");
          btn.className = "sta2e-zm-hazard-btn";
          btn.style.cssText = `
            background: none;
            border: 1px solid ${LC.red ?? "#ff3333"};
            color: ${LC.red ?? "#ff3333"};
            font-size: 0.82em;
            font-family: ${LC.font};
            padding: 1px 6px;
            border-radius: 3px;
            cursor: pointer;
            white-space: nowrap;
            letter-spacing: 0.04em;
            transition: background 0.15s, color 0.15s;
          `;
          btn.textContent = `\u26a1 ${hazard.label || hazard.type}${hazard.established ? " \u267b" : ""}`;
          btn.title = `Apply ${hazard.label || hazard.type} to ${token.document.name}`;

          btn.addEventListener("mouseenter", () => {
            btn.style.background = `${LC.red ?? "#ff3333"}22`;
          });
          btn.addEventListener("mouseleave", () => {
            btn.style.background = "none";
          });

          btn.addEventListener("click", async () => {
            // Target this specific token, then resolve the hazard
            token.setTarget(true, { releaseOthers: true });
            const { ZoneHazard } = await import("./zone-hazard.js");
            await ZoneHazard.resolveImmediate(zone, hazard);
          });

          row.appendChild(btn);
        }
      }

      // Lingering hazard per-token buttons (orange)
      if (!isNoZone && lingeringHazards.length > 0) {
        for (const hazard of lingeringHazards) {
          if (!hazard.established) continue; // only show per-token apply for established hazards
          const btn = document.createElement("button");
          btn.className = "sta2e-zm-hazard-btn";
          btn.style.cssText = `
            background: none;
            border: 1px solid ${LC.orange ?? "#ff6600"};
            color: ${LC.orange ?? "#ff6600"};
            font-size: 0.82em;
            font-family: ${LC.font};
            padding: 1px 6px;
            border-radius: 3px;
            cursor: pointer;
            white-space: nowrap;
            letter-spacing: 0.04em;
            transition: background 0.15s, color 0.15s;
          `;
          btn.textContent = `\u267b ${hazard.label || hazard.type}`;
          btn.title = `Apply ${hazard.label || hazard.type} to ${token.document.name}`;

          btn.addEventListener("mouseenter", () => {
            btn.style.background = `${LC.orange ?? "#ff6600"}22`;
          });
          btn.addEventListener("mouseleave", () => {
            btn.style.background = "none";
          });

          btn.addEventListener("click", async () => {
            token.setTarget(true, { releaseOthers: true });
            const { ZoneHazard } = await import("./zone-hazard.js");
            await ZoneHazard.resolveHazard(token.document, zone, hazard);
          });

          row.appendChild(btn);
        }
      }

      body.appendChild(row);
    }

    section.appendChild(body);

    // ── Collapse toggle ──────────────────────────────────────────────────────
    hdr.addEventListener("click", () => {
      const nowCollapsed = body.style.display === "none";
      if (nowCollapsed) {
        body.style.display = "";
        chevron.style.transform = "rotate(0deg)";
        delete this._collapseState[zone.id];
      } else {
        body.style.display = "none";
        chevron.style.transform = "rotate(-90deg)";
        this._collapseState[zone.id] = true;
      }
      this._saveCollapse();
    });

    return section;
  }

  // ── Drag ────────────────────────────────────────────────────────────────────

  _makeDraggable(handle, el) {
    let startX, startY, startLeft, startTop;

    const onMove = (e) => {
      el.style.left = `${startLeft + e.clientX - startX}px`;
      el.style.top  = `${startTop  + e.clientY - startY}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      handle.style.cursor = "grab";
      this._savePos(parseInt(el.style.left), parseInt(el.style.top));
    };

    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      e.preventDefault();
      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = parseInt(el.style.left) || 200;
      startTop  = parseInt(el.style.top)  || 400;
      handle.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  _savePos(x, y) {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  }

  _loadPos() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY));
      if (p?.x != null) return p;
    } catch {}
    return { x: 200, y: Math.max(100, window.innerHeight - 300) };
  }

  _saveCollapse() {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(this._collapseState));
  }

  _loadCollapse() {
    try {
      const c = JSON.parse(localStorage.getItem(COLLAPSE_KEY));
      if (c && typeof c === "object") return c;
    } catch {}
    return {};
  }

  _updateShowEmptyToggle(LC) {
    if (!this._showEmptyToggle) return;

    this._showEmptyToggle.style.cssText = `
      background: none;
      border: 1px solid ${this._showEmptyZones ? LC.bg : "rgba(0,0,0,0.35)"};
      color: ${LC.bg};
      font-size: 9px;
      font-family: ${LC.font};
      cursor: pointer;
      padding: 1px 7px;
      line-height: 1.4;
      opacity: ${this._showEmptyZones ? "0.95" : "0.65"};
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-radius: 999px;
      background: ${this._showEmptyZones ? "rgba(0,0,0,0.2)" : "transparent"};
    `;
    this._showEmptyToggle.textContent = this._showEmptyZones ? "Empty On" : "Empty Off";
  }
}
