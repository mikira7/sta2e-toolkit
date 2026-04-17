/**
 * sta2e-toolkit | zone-drag-ruler.js
 * Zone-aware token drag overlay.
 *
 * Since Drag Ruler is incompatible with Foundry v13, this module hooks into
 * Foundry's own token drag events to show a floating HUD with zone count,
 * range band, momentum cost, and movement limit indicators while the user
 * drags a token.
 *
 * Gated behind:
 *   - world setting `zoneDragRuler` = true
 *   - per-scene flag `sta2e-toolkit.zonesEnabled` != false
 *   - zones must exist on the scene
 */

import { getSceneZones, getZonePathWithCosts, rangeBandColor } from "./zone-data.js";
import { getLcTokens } from "./lcars-theme.js";

// ─────────────────────────────────────────────────────────────────────────────
// ZoneDragRuler — one instance per session, re-initialised on scene change
// ─────────────────────────────────────────────────────────────────────────────

export class ZoneDragRuler {

  constructor() {
    /** @type {HTMLElement|null} The floating HUD panel. */
    this._panel = null;

    /** @type {{x:number, y:number}|null} Drag origin in canvas coords. */
    this._originPt = null;

    /** @type {Token|null} Token being dragged. */
    this._dragToken = null;

    /** Whether the drag is currently active. */
    this._active = false;

    // PIXI path highlight container
    this._pathGfx = null;

    this._onDragMove = this._handleDragMove.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);

    this._patchTokenDrag();
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  /**
   * Patch Token's drag handlers to inject our zone overlay.
   * We hook _onDragLeftStart and _onDragLeftDrop via Hooks since Foundry v13
   * doesn't expose libWrapper as a dependency.
   */
  _patchTokenDrag() {
    // Use Foundry hooks for drag lifecycle
    Hooks.on("preUpdateToken", (tokenDoc, changes) => {
      // Fired just before a drag drop — capture destination
      // (actual zone check happens on updateToken in zone-movement-log.js)
    });
  }

  /**
   * Call when the user starts dragging a token.
   * @param {Token} token
   */
  startDrag(token) {
    if (!this._isEnabled()) return;

    this._dragToken = token;
    this._active = true;

    const center = token.center ?? { x: token.x, y: token.y };
    this._originPt = { x: center.x, y: center.y };

    // Create PIXI path highlight container
    if (!this._pathGfx) {
      this._pathGfx = new PIXI.Graphics();
      const parent = canvas?.interface ?? canvas?.stage;
      parent?.addChild(this._pathGfx);
    }

    // Show panel
    this._panel = this._createPanel();
    document.body.appendChild(this._panel);

    // Track mouse movement to update panel position + zone info
    window.addEventListener("mousemove", this._onMouseMove);
  }

  /**
   * Call when the drag ends (drop or cancel).
   */
  endDrag() {
    this._active = false;
    this._dragToken = null;
    this._originPt = null;

    window.removeEventListener("mousemove", this._onMouseMove);

    this._panel?.remove();
    this._panel = null;

    if (this._pathGfx) {
      this._pathGfx.clear();
      this._pathGfx.parent?.removeChild(this._pathGfx);
      this._pathGfx.destroy();
      this._pathGfx = null;
    }
  }

  destroy() {
    this.endDrag();
  }

  // ── Mouse tracking ───────────────────────────────────────────────────────

  _handleMouseMove(event) {
    if (!this._active || !this._panel) return;

    // Convert screen coords → canvas coords
    const pt = canvas?.canvasCoordinatesFromClient?.({ x: event.clientX, y: event.clientY });
    if (!pt || !this._originPt) return;

    // Update panel position (follow cursor)
    const px = Math.min(event.clientX + 16, window.innerWidth - 220);
    const py = Math.min(event.clientY + 16, window.innerHeight - 160);
    this._panel.style.left = `${px}px`;
    this._panel.style.top  = `${py}px`;

    // Compute zone info
    const zones = getSceneZones();
    if (!zones.length) return;

    const info = getZonePathWithCosts(this._originPt, pt, zones);
    this._updatePanel(info);
    this._drawPathHighlight(info, zones);
  }

  _handleDragMove(event) {
    // Legacy — superseded by mousemove
  }

  // ── Panel creation/update ────────────────────────────────────────────────

  _createPanel() {
    const panel = document.createElement("div");
    panel.id = "sta2e-zone-drag-panel";
    panel.innerHTML = `
      <div class="sta2e-zdp-zone">— ZONES —</div>
      <div class="sta2e-zdp-band">—</div>
      <div class="sta2e-zdp-momentum" style="display:none;"></div>
      <div class="sta2e-zdp-impulse" style="display:none;"></div>
      <div class="sta2e-zdp-warp"    style="display:none;"></div>
    `;
    return panel;
  }

  _updatePanel(info) {
    if (!this._panel) return;

    const zoneEl     = this._panel.querySelector(".sta2e-zdp-zone");
    const bandEl     = this._panel.querySelector(".sta2e-zdp-band");
    const momentumEl = this._panel.querySelector(".sta2e-zdp-momentum");
    const impulseEl  = this._panel.querySelector(".sta2e-zdp-impulse");
    const warpEl     = this._panel.querySelector(".sta2e-zdp-warp");

    if (!info.fromZone || !info.toZone || info.zoneCount < 0) {
      zoneEl.textContent = "— OUT OF ZONES —";
      bandEl.textContent = "";
      momentumEl.style.display = "none";
      impulseEl.style.display  = "none";
      warpEl.style.display     = "none";
      return;
    }

    const zn   = info.zoneCount;
    const band = info.rangeBand;
    const mom  = info.momentumCost;

    zoneEl.textContent = `${zn} ZONE${zn !== 1 ? "S" : ""}`;
    zoneEl.style.color = rangeBandColor(band);
    bandEl.textContent = band.toUpperCase();

    if (mom > 0) {
      momentumEl.style.display = "";
      momentumEl.textContent   = `+${mom} Momentum`;
    } else {
      momentumEl.style.display = "none";
    }

    // Combat indicators
    const actor   = this._dragToken?.actor ?? null;
    const isShip  = actor?.system?.systems !== undefined;
    const inCombat = game.combat?.active;

    if (inCombat && actor) {
      if (isShip) {
        // Impulse indicator
        impulseEl.style.display = "";
        if (zn <= 2) {
          impulseEl.textContent = "🟢 Impulse OK";
          impulseEl.style.color = "#00cc44";
        } else {
          impulseEl.textContent = `🔴 Impulse: ${zn}/2`;
          impulseEl.style.color = "#ff3333";
        }

        // Warp indicator
        const enginesScore = actor.system?.systems?.engines?.value ?? null;
        if (enginesScore != null) {
          warpEl.style.display = "";
          if (zn <= enginesScore) {
            warpEl.textContent = `🟢 Warp OK (Eng ${enginesScore})`;
            warpEl.style.color = "#00cc44";
          } else {
            warpEl.textContent = `🔴 Warp: ${zn}/${enginesScore}`;
            warpEl.style.color = "#ff3333";
          }
        } else {
          warpEl.style.display = "none";
        }
      } else {
        // Ground character
        impulseEl.style.display = "";
        if (zn <= 1) {
          impulseEl.textContent = "🟢 Move OK (1 zone)";
          impulseEl.style.color = "#00cc44";
        } else if (zn === 2) {
          impulseEl.textContent = "🟡 Sprint (2 zones)";
          impulseEl.style.color = "#cccc00";
        } else {
          impulseEl.textContent = `🔴 Move: ${zn}/2`;
          impulseEl.style.color = "#ff3333";
        }
        warpEl.style.display = "none";
      }
    } else {
      impulseEl.style.display = "none";
      warpEl.style.display    = "none";
    }
  }

  // ── Path highlight ───────────────────────────────────────────────────────

  _drawPathHighlight(info, zones) {
    if (!this._pathGfx) return;
    this._pathGfx.clear();

    if (!info.steps || info.steps.length < 2) return;

    const zoneMap = new Map(zones.map(z => [z.id, z]));

    for (let i = 1; i < info.steps.length; i++) {
      const step = info.steps[i];
      const zone = zoneMap.get(step.zoneId);
      if (!zone?.vertices?.length) continue;

      // Determine color: band-based tint
      let tintColor = rangeBandColor(info.rangeBand);
      // For combat ships, override tint based on movement limit
      const actor  = this._dragToken?.actor ?? null;
      const isShip = actor?.system?.systems !== undefined;
      if (game.combat?.active && isShip) {
        const zn = info.zoneCount;
        tintColor = zn <= 2 ? "#00cc44" : "#ff3333";
      }

      const colorInt = parseInt(tintColor.replace("#", ""), 16);
      this._pathGfx.beginFill(colorInt, 0.18);
      this._pathGfx.lineStyle(1, colorInt, 0.5);
      const verts = zone.vertices;
      this._pathGfx.moveTo(verts[0].x, verts[0].y);
      for (let j = 1; j < verts.length; j++) this._pathGfx.lineTo(verts[j].x, verts[j].y);
      this._pathGfx.closePath();
      this._pathGfx.endFill();
    }
  }

  // ── Gate check ───────────────────────────────────────────────────────────

  _isEnabled() {
    if (!game.settings.get("sta2e-toolkit", "zoneDragRuler")) return false;
    const perScene = canvas?.scene?.getFlag("sta2e-toolkit", "zonesEnabled");
    return perScene !== false;
  }
}
