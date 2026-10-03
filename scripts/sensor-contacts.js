/**
 * sta2e-toolkit | sensor-contacts.js
 *
 * The Sensors station's two information tasks, resolved on the active GM's
 * client so that nothing about a hidden vessel ever reaches a player's client
 * before the dice say it should:
 *
 *   Reveal (Major Action) — Reason + Science, Difficulty 3. On a success, if a
 *     hidden vessel is within Long range, reveal which zone it is in (one such
 *     vessel, chosen at random). Until it moves, the scanning ship may attack
 *     it at +2 Difficulty. A vessel inside a Sensor Shroud that affects
 *     sensors is only found if the roll made 3 + potency successes.
 *
 *   Sensor Sweep — information only. The GM gets a whispered report of the
 *     visible contacts in the swept area; a shroud hiding something adds
 *     "unresolved sensor readings". It never un-hides anything.
 *
 * A reveal is a token flag (REVEAL_FLAG), so it replicates itself and needs no
 * socket. A revealed **cloaked** vessel keeps `hidden: true` — its cloak is
 * still up — so every client draws a pulsing SENSOR CONTACT marker at the
 * position the Reveal fixed, read straight off that flag.
 */

import { getLcTokens } from "./lcars-theme.js";
import { lcarsChatCard } from "./chat-card-frame.js";
import { getZonesForToken, getZoneAtPoint, polygonArea, tokenFootprint } from "./zone-data.js";
import { getRangeContext, measureTokenRange, rectGap, getDynamicZoneRadius } from "./zone-dynamic.js";
import {
  REVEAL_FLAG, REVEALED_ATTACK_PENALTY, isHiddenVessel, isCloaked, rawShroudPotency,
  shroudAtPoint, tokenCentre, featuresAtPoint, isConcealed,
} from "./region-terrain.js";
import { activeGmWhisperIds } from "./gm-authority.js";

const LC     = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });
const MODULE = "sta2e-toolkit";

export const REVEAL_BASE_DIFFICULTY = 3;

// ── Shared helpers ───────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function _card(title, accent, body) {
  return lcarsChatCard({
    title, accent, body,
    legacy: () => `
<div style="background:${LC.bg};border:2px solid ${accent};border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:320px;">
  <div style="background:${accent};padding:5px 12px;">
    <span style="color:#000;font-weight:700;font-size:0.65em;letter-spacing:2px;">${title}</span>
  </div>${body}
</div>`,
  });
}

/**
 * Map bearing from a to b in whole degrees, 0–359: 0 is the top of the map,
 * increasing clockwise (canvas +y is down).
 */
export function mapBearing(a, b) {
  const deg = Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI;
  return Math.round((deg + 360) % 360) % 360;
}

/**
 * Ship tokens are drawn nose-south: at rotation 0 the bow points down the map
 * (map bearing 180), and Foundry's rotation turns it clockwise from there.
 */
export const SHIP_ART_NOSE_BEARING = 180;

/**
 * Bearing from the scanning ship's nose, Trek-style: 000 dead ahead, 090 to
 * starboard, 180 astern, 270 to port — whole degrees, 0–359.
 */
export function relativeBearing(scanner, from, to) {
  const rotation = Number(scanner?.document?.rotation ?? scanner?.rotation ?? 0) || 0;
  const nose = SHIP_ART_NOSE_BEARING + rotation;
  return Math.round((((mapBearing(from, to) - nose) % 360) + 360) % 360) % 360;
}

const BAND_BY_TENS = ["Close", "Medium", "Long"];

/**
 * The "mark": a distance scaled so each range band spans ten units —
 * Close 1–10, Medium 11–20, Long 21–30, Extreme 31 and up (31–40 is one zone
 * past Long, 41–50 two, and so on). 0 is Contact.
 *
 * Measured edge to edge, like range. Under dynamic zones (and on a zoneless
 * scene, using the default radius) the bands are R / 3R / 5R, so the mark is
 * exact. With drawn zones the band comes from the zone path and the position
 * within it is estimated from the gap against a typical zone's width, clamped
 * so the mark can never disagree with the band.
 * @returns {{mark:number, band:string}}
 */
export function contactMark(scanner, target, ctx = getRangeContext()) {
  const gap = rectGap(tokenFootprint(scanner), tokenFootprint(target));
  if (gap <= 0) return { mark: 0, band: "Contact" };

  const inBand = (n, frac) => {
    const f = Math.max(0, Math.min(1, frac));
    return { mark: 10 * n + 1 + Math.round(f * 9), band: BAND_BY_TENS[n] ?? "Extreme" };
  };

  if (ctx?.mode === "drawn") {
    const n = measureTokenRange(scanner, target, ctx)?.zoneCount;
    if (Number.isFinite(n) && n >= 0) {
      const areas = ctx.zones.map(z => Math.abs(polygonArea(z.vertices ?? []))).filter(a => a > 0);
      const zoneW = areas.length ? Math.sqrt(areas.reduce((s, a) => s + a, 0) / areas.length) : 0;
      return inBand(n, zoneW > 0 ? gap / zoneW - n : 0.5);
    }
  }

  const R = ctx?.mode === "dynamic" && ctx.radius > 0 ? ctx.radius : getDynamicZoneRadius();
  if (gap <= R) return inBand(0, gap / R);
  const n = Math.ceil((gap - R) / (2 * R));        // zones past Close, as dynamicZoneCount
  return inBand(n, (gap - R - 2 * R * (n - 1)) / (2 * R));
}

/**
 * Where a revealed vessel is, relative to the scanning ship's nose:
 * "Bearing 047 mark 15 · Medium range", plus the
 * drawn zone it sits in when the scene has a zone grid (the rule's "which
 * zone it is in").
 */
export function describeContactLocation(scanner, target, ctx = getRangeContext()) {
  const from = scanner?.center ?? tokenCentre(scanner);
  const to   = target?.center ?? tokenCentre(target);
  const { mark, band } = contactMark(scanner, target, ctx);
  let text = `Bearing ${String(relativeBearing(scanner, from, to)).padStart(3, "0")} mark ${mark} · ${band} range`;
  if (ctx?.mode === "drawn") {
    const zones = getZonesForToken(target, ctx.zones);
    if (zones.length) text += ` · Zone ${zones.map(z => z.name || "(unnamed)").join(" / ")}`;
  }
  return text;
}

function _withinLong(scanner, target, ctx) {
  if (!ctx?.mode) return true; // no zone system on this scene — the GM judges range
  const info = measureTokenRange(scanner, target, ctx);
  if (!info) return true;
  if (info.rangeBand) return ["Contact", "Close", "Medium", "Long"].includes(info.rangeBand);
  return Number.isFinite(info.zoneCount) ? info.zoneCount <= 2 : true;
}

// ── Reveal (GM side) ─────────────────────────────────────────────────────────

/**
 * Resolve a Reveal on the active GM's client.
 * @param {{sceneId, shipTokenId, successes, passed, requesterUserId}} data
 */
export async function resolveSensorReveal({ sceneId, shipTokenId, successes = 0, passed = true, requesterUserId = null } = {}) {
  if (sceneId && canvas?.scene?.id !== sceneId) return;
  const scanner = canvas.tokens?.get(shipTokenId);
  if (!scanner) return;

  const ctx = getRangeContext();
  const candidates = !passed ? [] : (canvas.tokens?.placeables ?? []).filter(t => {
    if (t.id === scanner.id || !t.actor) return false;
    if (!isHiddenVessel(t.document)) return false;
    if (!_withinLong(scanner, t, ctx)) return false;
    // A shroud that affects sensors has to be out-rolled.
    const potency = rawShroudPotency(t.document, "sensor");
    return successes >= REVEAL_BASE_DIFFICULTY + potency;
  });

  const scannerName = _esc(scanner.name);
  if (!candidates.length) {
    // Deliberately the same card whether the roll failed, nothing is there, or
    // a shroud beat the roll — the player learns nothing either way.
    await ChatMessage.create({
      content: _card("REVEAL — NO CONTACTS", LC.textDim, `
  <div style="padding:8px 12px;">
    <div style="color:${LC.textBright};font-size:0.85em;font-weight:700;">${scannerName}</div>
    <div style="color:${LC.textDim};font-size:0.8em;margin-top:3px;">
      No hidden vessels resolved within Long range.
    </div>
  </div>`),
      speaker: { alias: "Sensors" },
      flags: { [MODULE]: { type: "sensorReveal" } },
    });
    return;
  }

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const c = target.center ?? tokenCentre(target.document);
  await target.document.setFlag(MODULE, REVEAL_FLAG, {
    byTokenId: scanner.id,
    x: c.x,
    y: c.y,
    at: Date.now(),
  });

  const where = _esc(describeContactLocation(scanner, target, ctx));
  const cloaked = isCloaked(target.document);
  // The table sees where; only the active GM sees who.
  await ChatMessage.create({
    content: _card("REVEAL — CONTACT", LC.primary, `
  <div style="padding:8px 12px;border-bottom:1px solid ${LC.borderDim};">
    <div style="color:${LC.textBright};font-size:0.85em;font-weight:700;">${scannerName}</div>
    <div style="color:${LC.secondary};font-size:0.82em;margin-top:3px;">
      Hidden vessel detected: <strong style="color:${LC.textBright};">${where}</strong>
    </div>
  </div>
  <div style="padding:6px 12px;color:${LC.textDim};font-size:0.72em;line-height:1.5;">
    ${cloaked ? "Its cloak holds — a sensor contact marks its position." : "It is now visible on sensors."}
    Until it moves, attacks against it are at <strong>+${REVEALED_ATTACK_PENALTY} Difficulty</strong>.
  </div>`),
    speaker: { alias: "Sensors" },
    flags: { [MODULE]: { type: "sensorReveal", targetTokenId: target.id } },
  });

  if (candidates.length > 1 || cloaked) {
    await ChatMessage.create({
      content: _card("REVEAL — GM DETAIL", LC.secondary, `
  <div style="padding:8px 12px;font-size:0.78em;color:${LC.text};line-height:1.5;">
    Revealed: <strong>${_esc(target.name)}</strong>${cloaked ? " (cloaked)" : ""}<br>
    Other hidden vessels in range: ${candidates.length - 1}
  </div>`),
      speaker: { alias: "Sensors" },
      whisper: activeGmWhisperIds(),
      flags: { [MODULE]: { type: "sensorRevealGm" } },
    });
  }
}

// ── Sensor Sweep (GM side) ───────────────────────────────────────────────────

/**
 * Resolve a Sensor Sweep on the active GM's client.
 * @param {{sceneId, shipTokenId, point, passed, requesterUserId}} data
 */
export async function resolveSensorSweep({ sceneId, shipTokenId, point, passed = true, requesterUserId = null } = {}) {
  if (sceneId && canvas?.scene?.id !== sceneId) return;
  const scanner = canvas.tokens?.get(shipTokenId);
  if (!scanner || !point) return;
  if (!passed) return; // the roll card already reported the failure

  const ctx = getRangeContext();
  let areaName = "Swept area";
  let inArea;
  if (ctx?.mode === "drawn") {
    const zone = getZoneAtPoint(point.x, point.y, ctx.zones);
    areaName = zone?.name || "Swept area";
    inArea = t => zone ? getZonesForToken(t, ctx.zones).some(z => z.id === zone.id) : false;
  } else {
    // Dynamic or zoneless: within Close of the point, footprint edge to edge.
    const r = ctx?.radius ?? (canvas.grid?.size ?? 100) * 3;
    inArea = t => {
      const c = t.center ?? tokenCentre(t.document);
      return Math.hypot(c.x - point.x, c.y - point.y) <= r + Math.max(t.w ?? 0, t.h ?? 0) / 2;
    };
  }
  // Shroud regions at the point count as part of the swept area.
  const shrouds = featuresAtPoint(point, "shroud").map(f => f.region);
  const inShroud = t => shrouds.some(r => {
    const c = t.center ?? tokenCentre(t.document);
    return featuresAtPoint(c, "shroud").some(f => f.region === r);
  });

  const inside   = (canvas.tokens?.placeables ?? []).filter(t => t.id !== scanner.id && t.actor && (inArea(t) || inShroud(t)));
  const visible  = inside.filter(t => !isConcealed(t.document) || t.document.getFlag(MODULE, REVEAL_FLAG));
  const unresolved = inside.length - visible.length;

  const shroud = shroudAtPoint(point, "sensor");
  const list = visible.length
    ? visible.map(t => `<div>• ${_esc(t.name)}</div>`).join("")
    : `<div style="color:${LC.textDim};">No contacts resolved.</div>`;

  await ChatMessage.create({
    content: _card("SENSOR SWEEP — REPORT", LC.primary, `
  <div style="padding:8px 12px;border-bottom:1px solid ${LC.borderDim};">
    <div style="color:${LC.textBright};font-size:0.85em;font-weight:700;">${_esc(scanner.name)} · ${_esc(areaName)}</div>
    ${shroud.names.length ? `<div style="color:${LC.yellow};font-size:0.72em;margin-top:2px;">Interference: ${_esc(shroud.names.join(", "))}</div>` : ""}
  </div>
  <div style="padding:8px 12px;font-size:0.8em;color:${LC.text};line-height:1.5;">
    ${list}
    ${unresolved > 0 ? `<div style="color:${LC.yellow};margin-top:4px;">⚠ Unresolved sensor readings.</div>` : ""}
  </div>
  <div style="padding:4px 12px 8px;color:${LC.textDim};font-size:0.68em;">
    GM: share ship, object and phenomena detail as the sweep warrants.
  </div>`),
    speaker: { alias: "Sensors" },
    whisper: activeGmWhisperIds(),
    flags: { [MODULE]: { type: "sensorSweepReport" } },
  });
}

// ── Contact markers (every client) ───────────────────────────────────────────

let _layer  = null;
let _ticker = null;
let _t      = 0;

function _clearMarkers() {
  if (_ticker) { canvas?.app?.ticker?.remove(_ticker); _ticker = null; }
  if (_layer) {
    try { _layer.parent?.removeChild(_layer); _layer.destroy({ children: true }); } catch { /* torn down */ }
    _layer = null;
  }
}

/**
 * Draw a pulsing marker for every revealed vessel that is still cloaked.
 * A visible revealed vessel needs none — the token itself is the answer.
 * Cheap to call on any token change; it rebuilds from flags.
 */
export function syncSensorContactMarkers() {
  if (!canvas?.ready) return;
  const contacts = (canvas.tokens?.placeables ?? []).filter(t => {
    const f = t.document.getFlag(MODULE, REVEAL_FLAG);
    return f && Number.isFinite(f.x) && Number.isFinite(f.y) && isCloaked(t.document);
  });
  _clearMarkers();
  if (!contacts.length) return;

  const parent = canvas.interface ?? canvas.stage;
  if (!parent) return;
  _layer = new PIXI.Container();
  _layer.eventMode = "none";
  parent.addChild(_layer);

  const gs = canvas.grid?.size ?? 100;
  const markers = contacts.map(t => {
    const f = t.document.getFlag(MODULE, REVEAL_FLAG);
    const r = Math.max(t.w ?? gs, t.h ?? gs) * 0.6;
    const g = new PIXI.Graphics();
    g.position.set(f.x, f.y);
    _layer.addChild(g);
    const label = new PIXI.Text("SENSOR CONTACT", {
      fontFamily: "Antonio, Arial Narrow, sans-serif", fontSize: 14, fill: 0xff9c00,
      fontWeight: "700", letterSpacing: 2,
    });
    label.anchor.set(0.5, 0);
    label.position.set(f.x, f.y + r + 6);
    _layer.addChild(label);
    return { g, r };
  });

  _ticker = () => {
    _t = (_t + (canvas.app?.ticker?.deltaMS ?? 16) / 1000) % 1000;
    const pulse = (Math.sin(_t * 3) + 1) / 2;
    for (const { g, r } of markers) {
      g.clear();
      g.lineStyle(2, 0xff9c00, 0.5 + pulse * 0.4);
      g.drawCircle(0, 0, r * (0.9 + pulse * 0.15));
      g.lineStyle(1, 0xff9c00, 0.35);
      g.drawCircle(0, 0, r * 0.4);
      g.moveTo(-r * 1.1, 0).lineTo(-r * 0.55, 0);
      g.moveTo(r * 0.55, 0).lineTo(r * 1.1, 0);
      g.moveTo(0, -r * 1.1).lineTo(0, -r * 0.55);
      g.moveTo(0, r * 0.55).lineTo(0, r * 1.1);
    }
  };
  canvas.app?.ticker?.add(_ticker);
}

export function registerSensorContacts() {
  Hooks.on("canvasReady", () => syncSensorContactMarkers());
  Hooks.on("canvasTearDown", () => _clearMarkers());
  Hooks.on("deleteToken", () => syncSensorContactMarkers());
}
