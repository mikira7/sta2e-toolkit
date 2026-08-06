/**
 * sta2e-toolkit | ship-pool.js
 * Shared helpers for building the "which ship is assisting this task" list.
 *
 * These used to live in task-maker.js.  They moved here so opposed-panel.js can
 * reuse them without importing task-maker.js — see the cycle note atop
 * opposed-panel.js.  This module must stay a leaf: crew-manifest.js is the only
 * import beyond the theme, and it in turn imports nothing but lcars-theme.js.
 */

import { getAssignedShips, normalizeAssignedShips } from "./crew-manifest.js";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isShipActor(actor) {
  return actor?.type === "starship" || actor?.type === "smallcraft" || actor?.type === "spacecraft2e" || actor?.system?.systems !== undefined;
}

export function worldShips() {
  return game.actors
    .filter(isShipActor)
    .map(actor => ({ label: actor.name, actorId: actor.id, shipActor: actor }));
}

export function orderedShipsForActor(actor, preferredShipId = null) {
  const all = worldShips();
  const byId = new Map(all.map(s => [s.actorId, s]));
  const assigned = normalizeAssignedShips(getAssignedShips(actor));
  // Only offer ships assigned to this character. If none are assigned, fall back to all ships.
  if (!assigned.length) return all;
  const assignedSet = new Set(assigned);
  const order = [preferredShipId, ...assigned].filter(id => id && assignedSet.has(id));
  const seen = new Set();
  const ordered = [];
  for (const id of order) {
    const ship = byId.get(id);
    if (ship && !seen.has(ship.actorId)) {
      seen.add(ship.actorId);
      ordered.push(ship);
    }
  }
  return ordered;
}

export function serializeShipsForRoller(shipRefs) {
  return shipRefs.map(s => ({
    label: s.label,
    actorId: s.actorId,
    systems: s.shipActor.system?.systems ?? {},
    depts: s.shipActor.system?.departments ?? {},
    hasAdvancedSensors: s.shipActor.items?.some(i =>
      i.name.toLowerCase().includes("advanced sensor suites") ||
      i.name.toLowerCase().includes("advanced sensors")
    ) ?? false,
    sensorsBreaches: s.shipActor.system?.systems?.sensors?.breaches ?? 0,
  }));
}

export function shipSystemOptions(ship, selectedKey) {
  const entries = Object.entries(ship?.system?.systems ?? {});
  return entries.map(([key, value]) => `<option value="${esc(key)}" ${key === selectedKey ? "selected" : ""}>${esc(labelFromKey(key))} (${Number(value?.value ?? value ?? 0)})</option>`).join("");
}

export function shipDeptOptions(ship, selectedKey) {
  const entries = Object.entries(ship?.system?.departments ?? {});
  return entries.map(([key, value]) => `<option value="${esc(key)}" ${key === selectedKey ? "selected" : ""}>${esc(labelFromKey(key))} (${Number(value?.value ?? value ?? 0)})</option>`).join("");
}

export function labelFromKey(key) {
  return String(key ?? "").replace(/[-_]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
}
