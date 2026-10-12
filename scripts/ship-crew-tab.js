/**
 * sta2e-toolkit | ship-crew-tab.js
 * A "Crew" tab on the STA 2e starship and small-craft sheets: the ship's
 * company, and the bridge stations filled from it.
 *
 * The system's ship sheets have no tabs of their own — they are one long page,
 * a `.left-column` beside a `.right-column`. So the tab strip is ours, placed
 * under the name header in `.right-column`, and switching tabs only toggles a
 * class on that column; CSS hides the system's children while Crew is showing.
 * The system's markup is never moved or re-parented, so its own render and
 * listeners are untouched. The chosen tab is kept on the app instance, because
 * the sheet re-renders from scratch on almost every change.
 *
 * Every rule lives in crew-manifest.js — one station per officer
 * (`assignOfficer`), the three-source crew list (`getShipCrew`) and the
 * self-routing crew writes (`addShipCrew` / `removeShipCrew`). This file is
 * only the view.
 */

import {
  STATION_SLOTS, COMMAND_SEATS, OFFICER_ATTRIBUTES, OFFICER_DISCIPLINES,
  getCrewManifest, setCrewManifest, readOfficerStats,
  assignOfficer, unassignOfficer, stationLabel,
  getShipCrew, isShipCrew, addShipCrew, removeShipCrew, actorFromDragData,
} from "./crew-manifest.js";

const TAB_KEY = "_sta2eShipTab";
const SOURCE_LABEL = { toolkit: "Toolkit", assignment: "Assignment", manifest: "Manifest" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

const _label = (list, key) => list.find(e => e.key === key)?.label ?? key;

function _isShipSheet(app) {
  const type = app?.document?.type;
  return type === "starship" || type === "smallcraft";
}

// ── Markup ───────────────────────────────────────────────────────────────────

function _seatList() {
  return STATION_SLOTS.flatMap(slot => slot.id === "command"
    ? COMMAND_SEATS.map(seat => ({ slot, seatIndex: seat.index }))
    : [{ slot, seatIndex: null }]);
}

function _statLine(slot, actor, ship) {
  if (!actor) {
    const quality = game.sta2eToolkit?.CombatHUD?.getCrewQuality?.(ship) ?? "proficient";
    return `NPC crew · ${quality.charAt(0).toUpperCase()}${quality.slice(1)}`;
  }
  const stats = readOfficerStats(actor);
  const attr = stats?.attributes?.[slot.defaultAttr];
  const disc = stats?.disciplines?.[slot.defaultDisc];
  if (attr == null && disc == null) return "";
  return `${_label(OFFICER_ATTRIBUTES, slot.defaultAttr)} ${attr ?? "–"} · `
    + `${_label(OFFICER_DISCIPLINES, slot.defaultDisc)} ${disc ?? "–"}`;
}

function _stationsHtml(ship, crew, manifest, editable) {
  const rows = _seatList().map(({ slot, seatIndex }) => {
    const occupantId = slot.id === "command" ? manifest.command[seatIndex] : manifest[slot.id]?.[0];
    const occupant = occupantId ? game.actors.get(occupantId) : null;
    const options = crew.map(e => {
      const where = e.stationId && !(e.stationId === slot.id && e.seatIndex === seatIndex)
        ? ` (${stationLabel(e.stationId, e.seatIndex)})` : "";
      return `<option value="${e.actor.id}" ${e.actor.id === occupantId ? "selected" : ""}>${esc(e.actor.name)}${esc(where)}</option>`;
    }).join("");
    // An occupant who is somehow not in the crew list still has to be shown.
    const orphan = occupant && !crew.some(e => e.actor.id === occupant.id)
      ? `<option value="${occupant.id}" selected>${esc(occupant.name)}</option>` : "";
    return `
      <div class="sta2e-crew-station${occupant ? "" : " is-vacant"}"
        data-station="${slot.id}" ${seatIndex === null ? "" : `data-seat="${seatIndex}"`}>
        <span class="sta2e-crew-station-name">${esc(stationLabel(slot.id, seatIndex))}</span>
        <select class="sta2e-crew-select" ${editable ? "" : "disabled"}>
          <option value="">— Vacant —</option>${orphan}${options}
        </select>
        <span class="sta2e-crew-stat">${esc(_statLine(slot, occupant, ship))}</span>
      </div>`;
  }).join("");
  return `
    <section class="sta2e-crew-section">
      <div class="sta2e-crew-heading">Bridge Stations</div>
      ${rows}
      <div class="sta2e-crew-hint">One station per officer — assigning someone moves them.${editable ? " Drag a crew member onto a station, or pick from its list." : ""}</div>
    </section>`;
}

function _companyHtml(crew, editable) {
  const rows = crew.map(e => `
    <div class="sta2e-crew-member" data-actor-id="${e.actor.id}" ${editable ? `draggable="true"` : ""}>
      <img class="sta2e-crew-portrait" src="${esc(e.actor.img || "icons/svg/mystery-man.svg")}" alt="">
      <span class="sta2e-crew-member-name" title="Open sheet">${esc(e.actor.name)}</span>
      <span class="sta2e-crew-member-post">${e.stationId ? esc(stationLabel(e.stationId, e.seatIndex)) : "Unassigned"}</span>
      <span class="sta2e-crew-badges">${e.sources.map(s =>
        `<span class="sta2e-crew-badge" title="${s === "toolkit" ? "Assign Ships on their sheet"
          : s === "assignment" ? "Their Assignment field names this ship (the system's Ship Roster)"
            : "Holds a station"}">${SOURCE_LABEL[s] ?? s}</span>`).join("")}</span>
      ${editable ? `<button type="button" class="sta2e-crew-remove" title="Remove from the ship's company">✕</button>` : ""}
    </div>`).join("");
  return `
    <section class="sta2e-crew-section">
      <div class="sta2e-crew-heading">Ship's Company <span class="sta2e-crew-count">${crew.length}</span></div>
      ${rows || `<div class="sta2e-crew-hint">No crew yet.</div>`}
      ${editable ? `<div class="sta2e-crew-drop">Drop a character from the sidebar or a token to add them to the crew</div>` : ""}
    </section>`;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function _readDrop(event) {
  try { return actorFromDragData(JSON.parse(event.dataTransfer.getData("text/plain"))); }
  catch { return null; }
}

function _dropTarget(el, onDrop) {
  el.addEventListener("dragover", ev => { ev.preventDefault(); ev.stopPropagation(); el.classList.add("is-over"); });
  el.addEventListener("dragleave", () => el.classList.remove("is-over"));
  el.addEventListener("drop", async ev => {
    // Stop here so the sheet's own drop handler never sees an Actor drop.
    ev.preventDefault(); ev.stopPropagation(); el.classList.remove("is-over");
    const actor = _readDrop(ev);
    if (!actor) { ui.notifications.warn("STA2e Toolkit: Drop a character — ships cannot crew a station."); return; }
    await onDrop(actor);
  });
}

async function _addToCrew(ship, actor) {
  const replaced = await addShipCrew(ship, actor);
  if (replaced) ui.notifications.info(`STA2e Toolkit: ${actor.name}'s Assignment was "${replaced}"; it now reads "${ship.name}".`);
}

async function _assign(ship, actorId, stationId, seatIndex) {
  await setCrewManifest(ship, assignOfficer(getCrewManifest(ship), actorId, stationId, seatIndex));
  const actor = game.actors.get(actorId);
  if (actor && !isShipCrew(ship, actor)) await _addToCrew(ship, actor);
}

function _wirePanel(panel, ship, editable) {
  panel.querySelectorAll(".sta2e-crew-member-name").forEach(el => el.addEventListener("click", () =>
    game.actors.get(el.closest("[data-actor-id]").dataset.actorId)?.sheet?.render(true)));
  if (!editable) return;

  panel.querySelectorAll(".sta2e-crew-member").forEach(row => {
    row.addEventListener("dragstart", ev => {
      ev.stopPropagation();
      const actor = game.actors.get(row.dataset.actorId);
      if (actor) ev.dataTransfer.setData("text/plain", JSON.stringify(actor.toDragData()));
    });
  });

  panel.querySelectorAll(".sta2e-crew-station").forEach(row => {
    const stationId = row.dataset.station;
    const seatIndex = row.dataset.seat === undefined ? null : Number(row.dataset.seat);
    row.querySelector(".sta2e-crew-select").addEventListener("change", async ev => {
      // The sheet is a submit-on-change form; this select is not one of its fields.
      ev.stopPropagation();
      const id = ev.currentTarget.value;
      const manifest = getCrewManifest(ship);
      if (id) {
        await _assign(ship, id, stationId, seatIndex);
      } else {
        const current = stationId === "command" ? manifest.command[seatIndex] : manifest[stationId]?.[0];
        if (current) await setCrewManifest(ship, unassignOfficer(manifest, current));
      }
      refreshCrewPanels();
    });
    _dropTarget(row, async actor => { await _assign(ship, actor.id, stationId, seatIndex); refreshCrewPanels(); });
  });

  panel.querySelectorAll(".sta2e-crew-remove").forEach(btn => btn.addEventListener("click", async () => {
    const actor = game.actors.get(btn.closest("[data-actor-id]").dataset.actorId);
    if (!actor) return;
    await removeShipCrew(ship, actor);
    refreshCrewPanels();
  }));

  const drop = panel.querySelector(".sta2e-crew-drop");
  if (drop) _dropTarget(drop, async actor => { await _addToCrew(ship, actor); refreshCrewPanels(); });
}

function _fillPanel(panel, app) {
  const ship = app.document;
  const editable = !!ship?.isOwner;
  const crew = getShipCrew(ship);
  const manifest = getCrewManifest(ship);
  panel.innerHTML = _stationsHtml(ship, crew, manifest, editable) + _companyHtml(crew, editable);
  _wirePanel(panel, ship, editable);
}

function _showTab(app, column, tab) {
  app[TAB_KEY] = tab;
  column.classList.toggle("sta2e-crew-active", tab === "crew");
  column.querySelectorAll(".sta2e-crew-tab").forEach(btn =>
    btn.classList.toggle("is-active", btn.dataset.tab === tab));
}

/** renderSTAStarshipSheet2e / renderSTASmallCraftSheet2e. */
export function injectShipCrewTab(app, html) {
  if (!_isShipSheet(app)) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
  const column = root?.querySelector(".starship-sheet .right-column");
  if (!column || column.querySelector(".sta2e-crew-tabs")) return;

  const strip = document.createElement("nav");
  strip.className = "sta2e-crew-tabs";
  strip.innerHTML = `
    <button type="button" class="sta2e-crew-tab" data-tab="ship">Ship</button>
    <button type="button" class="sta2e-crew-tab" data-tab="crew">Crew</button>`;
  // Under the name header — and under the toolkit's NPC Ship block when the
  // sheet carries one, so the strip sits in the same place either way.
  const anchor = column.querySelector(".sta2e-npc-ship-block") ?? column.querySelector(".name-field");
  if (anchor) anchor.insertAdjacentElement("afterend", strip);
  else column.prepend(strip);

  const panel = document.createElement("div");
  panel.className = "sta2e-crew-panel";
  strip.insertAdjacentElement("afterend", panel);
  _fillPanel(panel, app);

  strip.querySelectorAll(".sta2e-crew-tab").forEach(btn =>
    btn.addEventListener("click", () => _showTab(app, column, btn.dataset.tab)));
  _showTab(app, column, app[TAB_KEY] ?? "ship");
}

/** Rebuild the Crew panel in every open ship sheet. */
export function refreshCrewPanels() {
  const apps = foundry.applications?.instances?.values?.() ?? [];
  for (const app of apps) {
    if (!_isShipSheet(app)) continue;
    const panel = app.element?.querySelector?.(".sta2e-crew-panel");
    if (panel) _fillPanel(panel, app);
  }
}

/**
 * Crew membership lives on the CHARACTERS (their assignedShips flag and their
 * Assignment field), so a change there never re-renders the ship sheet by
 * itself. Rebuild the panels when any of that changes.
 */
export function registerShipCrewTab() {
  Hooks.on("renderSTAStarshipSheet2e", injectShipCrewTab);
  Hooks.on("renderSTASmallCraftSheet2e", injectShipCrewTab);

  const touchesCrew = (changes) =>
    foundry.utils.hasProperty(changes, "flags.sta2e-toolkit.assignedShips")
    || foundry.utils.hasProperty(changes, "flags.sta2e-toolkit.-=assignedShips")
    || foundry.utils.hasProperty(changes, "flags.sta2e-toolkit.crewManifest")
    || foundry.utils.hasProperty(changes, "flags.sta2e-toolkit.crewQuality")
    || foundry.utils.hasProperty(changes, "system.assignment")
    || "name" in changes || "img" in changes;
  Hooks.on("updateActor", (_doc, changes) => { if (touchesCrew(changes)) refreshCrewPanels(); });
  // An unlinked ship keeps its manifest on the token, which does not re-render the sheet.
  Hooks.on("updateToken", (_doc, changes) => { if (touchesCrew(changes)) refreshCrewPanels(); });
}
