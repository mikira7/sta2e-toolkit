/**
 * sta2e-toolkit | elevation-ruler.js
 *
 * Displays an LCARS-styled floating distance readout above a token when:
 *   - at least one other token is currently controlled (selected), AND
 *   - the user hovers over a different token on the canvas.
 *
 * Distance formula: √(horizontal² + Δelevation²)
 *
 * When the scene uses LY units AND the controlled ship actor has
 * cruiserSpeed / maxWarpSpeed flags set (entered on the sheet), a second
 * TIME section is drawn below the RANGE section showing estimated travel
 * time at each rated speed.
 */

import { getLcTokens } from "./lcars-theme.js";
import { getSceneZones, getZoneDistanceBetweenTokens, rangeBandColor } from "./zone-data.js";
import { evaluateWeaponRange, getStarshipWeapons } from "./weapon-range.js";
import { isStarSystemActor, getStarSystemData } from "./star-system-sheet.js";

// ---------------------------------------------------------------------------
// State — one label at a time
// ---------------------------------------------------------------------------

// Shape: { container: PIXI.Container, token: Token } | null
let _elevLabel = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a CSS "#rrggbb" string to a PIXI integer. */
function _hex(cssStr) {
  return parseInt(cssStr.replace(/^#/, ""), 16);
}

/** True when the scene grid units indicate light-years. */
function _isLYMap() {
  return /^ly$|light.?year/i.test(canvas.scene?.grid?.units ?? "");
}

/** True when the zone system is active on the current scene. */
function _isZonesActive() {
  try {
    const globalOn = game.settings.get("sta2e-toolkit", "showZoneBorders");
    if (!globalOn) return false;
    const perScene = canvas?.scene?.getFlag("sta2e-toolkit", "zonesEnabled");
    return perScene !== false;
  } catch { return false; }
}

function _isCombatActive() {
  return !!game.combat && game.combat.started !== false;
}

// ---------------------------------------------------------------------------
// Warp physics (self-contained — mirrors warp-calc.js, no import needed)
// ---------------------------------------------------------------------------

function _warpToC(w) {
  if (w <= 0) return 0;
  // Pick formula based on active campaign theme
  const theme = game.sta2eToolkit?.getActiveCampaign?.()?.theme
    ?? game.settings.get("sta2e-toolkit", "hudTheme") ?? "lcars-tng";
  const useTOS = theme === "tos-panel" || theme === "tmp-console" || theme === "ent-panel";
  if (useTOS) return w <= 9 ? Math.pow(w, 10 / 3) : Math.pow(w, 3);
  // TNG formula with high-warp interpolation
  if (w >= 10) return Infinity;
  if (w < 9)   return Math.pow(w, 10 / 3);
  const w9 = 1516, w99 = 3053, w999 = 7912;
  if (w <= 9.9)  { const t = (w - 9)   / 0.9;  return w9  + (w99  - w9)  * Math.pow(t, 2.5); }
  else            { const t = (w - 9.9) / 0.09; return w99 + (w999 - w99) * Math.pow(t, 3);   }
}

function _calcTravelTime(distLY, speedC) {
  if (!speedC || speedC <= 0 || !distLY || distLY <= 0) return null;
  const totalYears = distLY / speedC;
  const years   = Math.floor(totalYears);
  const daysRem = (totalYears - years) * 365.25;
  const days    = Math.floor(daysRem);
  const hours   = Math.floor((daysRem - days) * 24);
  const minutes = Math.floor(((daysRem - days) * 24 - hours) * 60);
  return { years, days, hours, minutes };
}

function _formatTime(t) {
  if (!t) return "—";
  const p = [];
  if (t.years)  p.push(`${t.years}Y`);
  if (t.days)   p.push(`${t.days}D`);
  p.push(`${t.hours}H`);
  if (!t.years) p.push(`${t.minutes}M`);
  return p.join(" ");
}

// ---------------------------------------------------------------------------
// Distance calculation
// ---------------------------------------------------------------------------

function _computeDistance(from, to) {
  const DIST = canvas.scene.grid.distance;
  const gs   = canvas.scene.grid.size;

  const ax = from.x / gs,  ay = from.y / gs;
  const bx = to.x   / gs,  by = to.y   / gs;
  const az = (from.document.elevation ?? 0) / DIST;
  const bz = (to.document.elevation   ?? 0) / DIST;

  const dx = (bx - ax) * DIST;
  const dy = (by - ay) * DIST;
  const dz = (bz - az) * DIST;

  return {
    flat:     Math.sqrt(dx * dx + dy * dy),
    dist3D:   Math.sqrt(dx * dx + dy * dy + dz * dz),
    elevDiff: Math.abs(dz),
  };
}

function _clipText(value, max = 20) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** True when the actor is a starship / small craft (same test used in main.js). */
function _isShipActor(actor) {
  if (!actor) return false;
  return actor.type === "starship"
    || actor.type === "spacecraft2e"
    || actor.system?.systems !== undefined
    || actor.items?.some(i => i.type === "starshipweapon2e");
}

/**
 * SYSTEM section rows for the hover panel — only when a starship token is
 * selected and the hovered token is a star-system actor. Shows the system
 * classification, each star's type, and the planet count (authored worlds
 * when present, otherwise the orbitalBodies number).
 * @returns {Array<{label:string,value:string}>|null}
 */
function _starSystemRowsForHover(sourceToken, hoveredToken) {
  try {
    if (!_isShipActor(sourceToken?.actor)) return null;
    const actor = hoveredToken?.actor;
    if (!isStarSystemActor(actor)) return null;

    const data = getStarSystemData(actor);
    const rows = [{ label: "TYPE", value: _clipText(data.classification || "Unknown", 24) }];

    const stars = Array.isArray(data.stars) && data.stars.length ? data.stars : null;
    if (stars) {
      stars.slice(0, 3).forEach((star, i) => {
        const desc = star.classification
          || [star.spectralType, star.subdivision, star.luminosityType].filter(Boolean).join(" ");
        rows.push({
          label: stars.length > 1 ? `STAR ${i + 1}` : "STAR",
          value: _clipText(desc || "Unknown", 24),
        });
      });
      if (stars.length > 3) rows.push({ label: "STARS", value: `+${stars.length - 3} more` });
    } else {
      rows.push({ label: "STAR", value: _clipText(data.primaryStar || "Unknown", 24) });
    }

    const planets = (Array.isArray(data.worlds) && data.worlds.length)
      ? data.worlds.length
      : data.orbitalBodies;
    rows.push({ label: "PLANETS", value: String(planets ?? 0) });
    return rows;
  } catch (err) {
    console.warn("STA2e | Star system hover rows failed:", err);
    return null;
  }
}

function _weaponRowsForZoneHover(sourceToken, zoneInfo) {
  const LC = getLcTokens();
  return getStarshipWeapons(sourceToken?.actor).map(weapon => {
    const status = evaluateWeaponRange(weapon, zoneInfo);
    return {
      name: _clipText(weapon.name, 22),
      range: status.listedRange ?? "?",
      color: status.known
        ? (status.within ? LC.green : LC.red)
        : LC.textDim,
    };
  });
}

// ---------------------------------------------------------------------------
// LCARS panel builder
// ---------------------------------------------------------------------------
//
// Layout with travel-time section:
//
//   ┌──────────┬───────────────────────┐
//   │  RANGE   │  3.50 LY              │  ← always
//   │          ├───────────────────────┤
//   │          │  H 2.00   V 3.00      │  ← only when elevation ≠ 0
//   └──────────┴───────────────────────┘
//        [4 px gap]
//   ┌──────────┬───────────────────────┐
//   │          │  CRZ W6    47Y 3D 14H │  ← only on LY map + ship speeds
//   │   TIME   ├───────────────────────┤
//   │          │  MAX W9.6  12Y 1D 2H  │
//   └──────────┴───────────────────────┘
//
// timeLines = null  |  Array<{ label: string, time: string }>

function _buildPanel(token, mainText, subText, timeLines, mainColorOverride, weaponRows = null, systemRows = null) {
  const LC = getLcTokens();
  const weaponList = Array.isArray(weaponRows) ? weaponRows : [];
  const sysList    = Array.isArray(systemRows) ? systemRows : [];

  // ── Geometry ───────────────────────────────────────────────────────────────
  const RADIUS     = 8;
  const PILL_W     = 46;
  const DATA_W     = (weaponList.length || sysList.length) ? 172 : 130;
  const TOTAL_W    = PILL_W + DATA_W;
  const PAD_X      = 7;
  const ROW1_H     = 26;
  const ROW2_H     = subText    ? 18 : 0;
  const RANGE_H    = ROW1_H + ROW2_H;
  const TIME_ROW_H = 18;
  const GAP        = timeLines?.length ? 4 : 0;
  const TIME_H     = timeLines?.length ? timeLines.length * TIME_ROW_H : 0;
  const SYS_ROW_H  = 16;
  const SYS_GAP    = sysList.length ? 4 : 0;
  const SYS_H      = sysList.length ? sysList.length * SYS_ROW_H : 0;
  const WEAPON_ROW_H = 16;
  const WEAPON_GAP   = weaponList.length ? 4 : 0;
  const WEAPON_H     = weaponList.length ? 20 + weaponList.length * WEAPON_ROW_H : 0;
  const TOTAL_H      = RANGE_H + GAP + TIME_H + SYS_GAP + SYS_H + WEAPON_GAP + WEAPON_H;

  // ── Colours ────────────────────────────────────────────────────────────────
  const cPrimary   = _hex(LC.primary);
  const cSecondary = _hex(LC.secondary);
  const cPanel     = _hex(LC.panel);
  const cBorder    = _hex(LC.border);
  const cBg        = _hex(LC.bg);
  const cText      = _hex(LC.text);
  const cTextDim   = _hex(LC.textDim);

  // ── Graphics ───────────────────────────────────────────────────────────────
  const g = new PIXI.Graphics();

  // — RANGE section —
  g.beginFill(cPanel, 1);
  g.drawRoundedRect(0, 0, TOTAL_W, RANGE_H, RADIUS);
  g.endFill();

  g.beginFill(cPrimary, 1);
  g.drawRoundedRect(0, 0, PILL_W + RADIUS, RANGE_H, RADIUS);
  g.endFill();
  g.beginFill(cPanel, 1);
  g.drawRect(PILL_W, 0, RADIUS + 1, RANGE_H);
  g.endFill();

  g.lineStyle(1, cBorder, 0.7);
  g.moveTo(PILL_W, 3); g.lineTo(PILL_W, RANGE_H - 3);
  g.lineStyle(0);

  if (subText) {
    g.lineStyle(1, cBorder, 0.45);
    g.moveTo(PILL_W + 2, ROW1_H); g.lineTo(TOTAL_W - 3, ROW1_H);
    g.lineStyle(0);
  }

  g.lineStyle(1, cBorder, 0.85);
  g.beginFill(0, 0);
  g.drawRoundedRect(0.5, 0.5, TOTAL_W - 1, RANGE_H - 1, RADIUS);
  g.endFill();
  g.lineStyle(0);

  // — TIME section —
  if (timeLines?.length) {
    const ty = RANGE_H + GAP;

    g.beginFill(cPanel, 1);
    g.drawRoundedRect(0, ty, TOTAL_W, TIME_H, RADIUS);
    g.endFill();

    g.beginFill(cSecondary, 1);
    g.drawRoundedRect(0, ty, PILL_W + RADIUS, TIME_H, RADIUS);
    g.endFill();
    g.beginFill(cPanel, 1);
    g.drawRect(PILL_W, ty, RADIUS + 1, TIME_H);
    g.endFill();

    g.lineStyle(1, cBorder, 0.7);
    g.moveTo(PILL_W, ty + 3); g.lineTo(PILL_W, ty + TIME_H - 3);
    g.lineStyle(0);

    for (let i = 1; i < timeLines.length; i++) {
      g.lineStyle(1, cBorder, 0.35);
      g.moveTo(PILL_W + 2, ty + i * TIME_ROW_H);
      g.lineTo(TOTAL_W - 3, ty + i * TIME_ROW_H);
      g.lineStyle(0);
    }

    g.lineStyle(1, cBorder, 0.85);
    g.beginFill(0, 0);
    g.drawRoundedRect(0.5, ty + 0.5, TOTAL_W - 1, TIME_H - 1, RADIUS);
    g.endFill();
    g.lineStyle(0);
  }

  // — SYSTEM section (star-system hover: type, stars, planet count) —
  if (sysList.length) {
    const sy = RANGE_H + GAP + TIME_H + SYS_GAP;

    g.beginFill(cPanel, 1);
    g.drawRoundedRect(0, sy, TOTAL_W, SYS_H, RADIUS);
    g.endFill();

    g.beginFill(cSecondary, 1);
    g.drawRoundedRect(0, sy, PILL_W + RADIUS, SYS_H, RADIUS);
    g.endFill();
    g.beginFill(cPanel, 1);
    g.drawRect(PILL_W, sy, RADIUS + 1, SYS_H);
    g.endFill();

    g.lineStyle(1, cBorder, 0.7);
    g.moveTo(PILL_W, sy + 3); g.lineTo(PILL_W, sy + SYS_H - 3);
    g.lineStyle(0);

    for (let i = 1; i < sysList.length; i++) {
      g.lineStyle(1, cBorder, 0.35);
      g.moveTo(PILL_W + 2, sy + i * SYS_ROW_H);
      g.lineTo(TOTAL_W - 3, sy + i * SYS_ROW_H);
      g.lineStyle(0);
    }

    g.lineStyle(1, cBorder, 0.85);
    g.beginFill(0, 0);
    g.drawRoundedRect(0.5, sy + 0.5, TOTAL_W - 1, SYS_H - 1, RADIUS);
    g.endFill();
    g.lineStyle(0);
  }

  // ── Assemble container ─────────────────────────────────────────────────────
  if (weaponList.length) {
    const wy = RANGE_H + GAP + TIME_H + SYS_GAP + SYS_H + WEAPON_GAP;

    g.beginFill(cPanel, 1);
    g.drawRoundedRect(0, wy, TOTAL_W, WEAPON_H, RADIUS);
    g.endFill();

    g.beginFill(cSecondary, 1);
    g.drawRoundedRect(0, wy, PILL_W + RADIUS, WEAPON_H, RADIUS);
    g.endFill();
    g.beginFill(cPanel, 1);
    g.drawRect(PILL_W, wy, RADIUS + 1, WEAPON_H);
    g.endFill();

    g.lineStyle(1, cBorder, 0.7);
    g.moveTo(PILL_W, wy + 3); g.lineTo(PILL_W, wy + WEAPON_H - 3);
    g.lineStyle(0);

    for (let i = 0; i < weaponList.length; i++) {
      g.lineStyle(1, cBorder, 0.28);
      g.moveTo(PILL_W + 2, wy + 20 + i * WEAPON_ROW_H);
      g.lineTo(TOTAL_W - 3, wy + 20 + i * WEAPON_ROW_H);
      g.lineStyle(0);
    }

    g.lineStyle(1, cBorder, 0.85);
    g.beginFill(0, 0);
    g.drawRoundedRect(0.5, wy + 0.5, TOTAL_W - 1, WEAPON_H - 1, RADIUS);
    g.endFill();
    g.lineStyle(0);
  }

  const ctr = new PIXI.Container();
  ctr.addChild(g);

  const PT = foundry.canvas.containers.PreciseText;

  const mkText = (str, size, color, weight = "400") => {
    const t = new PT(str, new PIXI.TextStyle({
      fontFamily: "'Arial Narrow','Arial',sans-serif",
      fontSize:   size,
      fontWeight: weight,
      fill:       color,
      align:      "left",
    }));
    return t;
  };

  // "RANGE" pill label
  const rangeLbl = mkText(game.i18n.localize("STA2E.ElevationRuler.RangeLabel"), 8, cBg, "700");
  rangeLbl.anchor.set(0.5, 0.5);
  rangeLbl.position.set(PILL_W / 2, ROW1_H / 2);
  ctr.addChild(rangeLbl);

  // Main distance value
  const mainT = mkText(mainText, 14, mainColorOverride ?? cText, "700");
  mainT.anchor.set(0, 0.5);
  mainT.position.set(PILL_W + PAD_X, ROW1_H / 2);
  ctr.addChild(mainT);

  // Elevation breakdown line
  if (subText) {
    const subT = mkText(subText, 10, cTextDim);
    subT.anchor.set(0, 0.5);
    subT.position.set(PILL_W + PAD_X, ROW1_H + ROW2_H / 2);
    ctr.addChild(subT);
  }

  // TIME pill label + rows
  if (timeLines?.length) {
    const ty = RANGE_H + GAP;

    const timeLbl = mkText(game.i18n.localize("STA2E.ElevationRuler.TimeLabel"), 8, cBg, "700");
    timeLbl.anchor.set(0.5, 0.5);
    timeLbl.position.set(PILL_W / 2, ty + TIME_H / 2);
    ctr.addChild(timeLbl);

    timeLines.forEach((row, i) => {
      const rowY = ty + i * TIME_ROW_H + TIME_ROW_H / 2;

      const lbl = mkText(row.label, 9, cTextDim);
      lbl.anchor.set(0, 0.5);
      lbl.position.set(PILL_W + PAD_X, rowY);
      ctr.addChild(lbl);

      const val = mkText(row.time, 10, cText, "700");
      val.anchor.set(1, 0.5);
      val.position.set(TOTAL_W - PAD_X, rowY);
      ctr.addChild(val);
    });
  }

  // SYSTEM pill label + rows
  if (sysList.length) {
    const sy = RANGE_H + GAP + TIME_H + SYS_GAP;

    const sysLbl = mkText("SYSTEM", 7, cBg, "700");
    sysLbl.anchor.set(0.5, 0.5);
    sysLbl.position.set(PILL_W / 2, sy + SYS_H / 2);
    ctr.addChild(sysLbl);

    sysList.forEach((row, i) => {
      const rowY = sy + i * SYS_ROW_H + SYS_ROW_H / 2;

      const lbl = mkText(row.label, 9, cTextDim);
      lbl.anchor.set(0, 0.5);
      lbl.position.set(PILL_W + PAD_X, rowY);
      ctr.addChild(lbl);

      const val = mkText(row.value, 10, cText, "700");
      val.anchor.set(1, 0.5);
      val.position.set(TOTAL_W - PAD_X, rowY);
      ctr.addChild(val);
    });
  }

  if (weaponList.length) {
    const wy = RANGE_H + GAP + TIME_H + SYS_GAP + SYS_H + WEAPON_GAP;

    const weaponLbl = mkText("WEAPONS", 7, cBg, "700");
    weaponLbl.anchor.set(0.5, 0.5);
    weaponLbl.position.set(PILL_W / 2, wy + WEAPON_H / 2);
    ctr.addChild(weaponLbl);

    const head = mkText("LISTED RANGE", 8, cTextDim, "700");
    head.anchor.set(0, 0.5);
    head.position.set(PILL_W + PAD_X, wy + 10);
    ctr.addChild(head);

    weaponList.forEach((row, i) => {
      const rowY = wy + 20 + i * WEAPON_ROW_H + WEAPON_ROW_H / 2;

      const name = mkText(row.name, 9, cTextDim);
      name.anchor.set(0, 0.5);
      name.position.set(PILL_W + PAD_X, rowY);
      ctr.addChild(name);

      const status = mkText(row.range, 9, _hex(row.color), "700");
      status.anchor.set(1, 0.5);
      status.position.set(TOTAL_W - PAD_X, rowY);
      ctr.addChild(status);
    });
  }

  // Position above the hovered token, centred horizontally
  ctr.position.set(
    token.w / 2 - TOTAL_W / 2,
    -TOTAL_H - 10,
  );
  ctr.zIndex = 9999;

  return ctr;
}

// ---------------------------------------------------------------------------
// Label show / hide
// ---------------------------------------------------------------------------

function _showLabel(hoveredToken) {
  const source = canvas.tokens?.controlled[0];
  if (!source || source === hoveredToken) {
    _hideLabel();
    return;
  }

  // Star-system readout — present in both zone mode and grid-distance mode.
  const systemRows = _starSystemRowsForHover(source, hoveredToken);

  // ── Zone mode ──────────────────────────────────────────────────────────────
  if (_isZonesActive()) {
    try {
      const zones = getSceneZones();
      if (zones.length > 0) {
        // Token-aware: multi-zone tokens (flags.sta2e-toolkit.multiZone)
        // measure from/to their nearest occupied zone, matching weapon range.
        const zInfo = getZoneDistanceBetweenTokens(source, hoveredToken, zones);
        if (zInfo.zoneCount >= 0) {
          const bandColor = _hex(rangeBandColor(zInfo.rangeBand));
          const mainText  = zInfo.rangeBand;

          const parts = [];
          if (zInfo.zoneCount > 0) parts.push(`${zInfo.zoneCount} zone${zInfo.zoneCount !== 1 ? "s" : ""}`);
          if (zInfo.momentumCost > 0) parts.push(`+${zInfo.momentumCost} Momentum`);
          if (zInfo.fromZone?.name && zInfo.toZone?.name && zInfo.fromZone.id !== zInfo.toZone.id) {
            parts.push(`${zInfo.fromZone.name} → ${zInfo.toZone.name}`);
          } else if (zInfo.fromZone?.name) {
            parts.push(zInfo.fromZone.name);
          }
          const subText = parts.length ? parts.join("  ·  ") : null;

          _hideLabel();
          const weaponRows = _isCombatActive() ? _weaponRowsForZoneHover(source, zInfo) : null;
          const container = _buildPanel(hoveredToken, mainText, subText, null, bandColor, weaponRows, systemRows);
          hoveredToken.addChild(container);
          _elevLabel = { container, token: hoveredToken };
          return;
        }
      }
    } catch (err) {
      console.warn("STA2e | Elevation ruler zone mode error:", err);
    }
  }

  // ── Grid distance fallback ─────────────────────────────────────────────────
  const { flat, dist3D, elevDiff } = _computeDistance(source, hoveredToken);
  const unit    = canvas.scene.grid.units || "u";
  const hasElev = elevDiff > 0.001;

  const mainText = hasElev ? `${dist3D.toFixed(2)} ${unit}` : `${flat.toFixed(2)} ${unit}`;
  const subText  = hasElev ? `H ${flat.toFixed(2)}   V ${elevDiff.toFixed(2)}` : null;

  // Travel-time rows — only on LY maps when the source ship has speed flags
  let timeLines = null;
  if (_isLYMap()) {
    const actor     = source.actor;
    const cruiser   = actor?.getFlag("sta2e-toolkit", "cruiserSpeed")       ?? null;
    const maxWarp   = actor?.getFlag("sta2e-toolkit", "maxWarpSpeed")       ?? null;
    const emergency = actor?.getFlag("sta2e-toolkit", "emergencyWarpSpeed") ?? null;
    const dist      = hasElev ? dist3D : flat;
    const lines     = [];

    if (cruiser != null) {
      const t = _calcTravelTime(dist, _warpToC(cruiser));
      lines.push({ label: `NRM W${cruiser}`, time: _formatTime(t) });
    }
    if (maxWarp != null) {
      const t = _calcTravelTime(dist, _warpToC(maxWarp));
      lines.push({ label: `MAX W${maxWarp}`, time: _formatTime(t) });
    }
    if (emergency != null) {
      const t = _calcTravelTime(dist, _warpToC(emergency));
      lines.push({ label: `EMG W${emergency}`, time: _formatTime(t) });
    }
    if (lines.length) timeLines = lines;
  }

  _hideLabel();
  const container = _buildPanel(hoveredToken, mainText, subText, timeLines, null, null, systemRows);
  hoveredToken.addChild(container);
  _elevLabel = { container, token: hoveredToken };
}

function _hideLabel() {
  if (!_elevLabel) return;
  try {
    _elevLabel.token.removeChild(_elevLabel.container);
    _elevLabel.container.destroy({ children: true });
  } catch { /* token may already be destroyed */ }
  _elevLabel = null;
}

// ---------------------------------------------------------------------------
// Public registration
// ---------------------------------------------------------------------------

export function registerElevationRuler() {
  Hooks.on("hoverToken", (token, hovered) => {
    if (!game.settings.get("sta2e-toolkit", "elevationRuler")) return;
    hovered ? _showLabel(token) : _hideLabel();
  });

  // Clear on any selection change so a stale source token is never used.
  Hooks.on("controlToken", () => {
    _hideLabel();
  });
}
