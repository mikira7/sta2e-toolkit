/**
 * sta2e-toolkit | crew-manifest.js
 * NPC Ship Crew Manifest — assign named officer actors to bridge stations.
 *
 * Officers are assigned by dragging a token from the canvas and dropping it
 * onto the station's drop zone in the manifest dialog.
 *
 * Exports:
 *   STATION_SLOTS        — station definitions with slot counts
 *   getCrewManifest      — read manifest flag from actor
 *   setCrewManifest      — write manifest flag to actor
 *   getStationOfficers   — get assigned officer actors for a station
 *   openCrewManifest     — open the manifest assignment dialog
 *   readOfficerStats     — read attributes + disciplines from a character actor
 */

import { getLcTokens } from "./lcars-theme.js";

const MODULE = "sta2e-toolkit";
const FLAG   = "crewManifest";

const LC = new Proxy({}, {
  get(_, prop) { return getLcTokens()[prop]; },
});

// ── Station slot definitions ──────────────────────────────────────────────────
export const STATION_SLOTS = [
  { id: "command",    label: "Command",   icon: "⭐", maxOfficers: 2, defaultAttr: "presence", defaultDisc: "command"     },
  { id: "comms",      label: "Comms",     icon: "📡", maxOfficers: 1, defaultAttr: "presence", defaultDisc: "command"     },
  { id: "helm",       label: "Helm",      icon: "🎮", maxOfficers: 1, defaultAttr: "daring",   defaultDisc: "conn"        },
  { id: "navigator",  label: "Navigator", icon: "🗺️", maxOfficers: 1, defaultAttr: "reason",   defaultDisc: "conn"        },
  { id: "operations", label: "Ops/Eng",   icon: "⚙️", maxOfficers: 1, defaultAttr: "control",  defaultDisc: "engineering" },
  { id: "sensors",    label: "Sensors",   icon: "🔬", maxOfficers: 1, defaultAttr: "control",  defaultDisc: "science"     },
  { id: "tactical",   label: "Tactical",  icon: "🎯", maxOfficers: 1, defaultAttr: "control",  defaultDisc: "security"    },
  { id: "medical",    label: "Medical",   icon: "⚕️", maxOfficers: 1, defaultAttr: "insight",  defaultDisc: "medicine"    },
];

// Command is the only station with named positions. Its manifest array keeps
// these seats at their matching indexes, including a null placeholder when one
// is vacant, so an Executive Officer can be assigned before a Captain.
export const COMMAND_SEATS = [
  { id: "captain", label: "Captain", index: 0 },
  { id: "executiveOfficer", label: "First Officer (Executive Officer)", index: 1 },
];

// ── STA 2e character attribute + discipline keys ──────────────────────────────
export const OFFICER_ATTRIBUTES = [
  { key: "control",  label: "Control"  },
  { key: "daring",   label: "Daring"   },
  { key: "fitness",  label: "Fitness"  },
  { key: "insight",  label: "Insight"  },
  { key: "presence", label: "Presence" },
  { key: "reason",   label: "Reason"   },
];

export const OFFICER_DISCIPLINES = [
  { key: "command",     label: "Command"     },
  { key: "conn",        label: "Conn"        },
  { key: "engineering", label: "Engineering" },
  { key: "medicine",    label: "Medicine"    },
  { key: "science",     label: "Science"     },
  { key: "security",    label: "Security"    },
];

// ── Flag helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve where to store the crew manifest for this actor.
 * - Linked (world) actors: stored on the actor document — shared across all
 *   linked tokens for that actor (correct for named unique ships).
 * - Unlinked (wildcard) synthetic actors: stored on the specific token document
 *   so each wildcard instance has its own independent crew assignment.
 *
 * Returns { type: "actor", doc } or { type: "token", doc }
 */
function _manifestStore(actor) {
  if (actor.isToken && actor.token) {
    // Synthetic actor — token.isLinked tells us if the token is linked
    if (!actor.token.isLinked) {
      // Unlinked/wildcard: store on the token document
      return { type: "token", doc: actor.token };
    }
  }
  // Linked world actor (or synthetic of a linked token): store on world actor
  const worldActor = actor.isToken
    ? (game.actors.get(actor.id ?? actor._id) ?? actor)
    : actor;
  return { type: "actor", doc: worldActor };
}

export function getCrewManifest(actor) {
  const { doc } = _manifestStore(actor);
  if (!doc) return _emptyManifest();
  return _normalizeManifest(doc.getFlag(MODULE, FLAG));
}

export async function setCrewManifest(actor, manifest) {
  const { doc } = _manifestStore(actor);
  if (!doc) return;
  await doc.setFlag(MODULE, FLAG, _normalizeManifest(manifest));
}

function _emptyManifest() {
  const m = {};
  STATION_SLOTS.forEach(s => { m[s.id] = []; });
  m.command = [null, null];
  return m;
}

function _normalizeManifest(manifest) {
  const source = manifest && typeof manifest === "object" ? manifest : {};
  const normalized = _emptyManifest();
  for (const slot of STATION_SLOTS) {
    const ids = Array.isArray(source[slot.id]) ? source[slot.id] : [];
    if (slot.id === "command") {
      normalized.command = COMMAND_SEATS.map(({ index }) => {
        const id = ids[index];
        return typeof id === "string" && id ? id : null;
      });
    } else {
      normalized[slot.id] = ids
        .filter(id => typeof id === "string" && id)
        .slice(0, slot.maxOfficers);
    }
  }
  return normalized;
}

// ── Officer resolution ────────────────────────────────────────────────────────

export function getStationOfficers(shipActor, stationId) {
  const manifest = getCrewManifest(shipActor);
  const ids      = manifest[stationId] ?? [];
  return ids.filter(Boolean).map(id => game.actors.get(id)).filter(Boolean);
}

export function readOfficerStats(actor) {
  if (!actor) return null;
  const attrs = actor.system?.attributes;
  const discs = actor.system?.disciplines;
  if (!attrs && !discs) return null;

  const attributes  = {};
  const disciplines = {};
  OFFICER_ATTRIBUTES.forEach(({ key }) => {
    attributes[key] = attrs?.[key]?.value ?? attrs?.[key] ?? null;
  });
  OFFICER_DISCIPLINES.forEach(({ key }) => {
    disciplines[key] = discs?.[key]?.value ?? discs?.[key] ?? null;
  });
  return { name: actor.name, id: actor.id, attributes, disciplines };
}

// ── Assigned Ships (per character actor) ─────────────────────────────────────
// Mirrors the crew manifest pattern: stores a list of preferred ship actor IDs
// on the character actor (world actor for linked tokens, token doc for unlinked).
// Used by the sheet-roller override to filter the ship-assist pre-dialog.

const SHIPS_FLAG = "assignedShips";

export function normalizeAssignedShips(shipIds) {
  const ids = Array.isArray(shipIds) ? shipIds : [];
  return ids
    .map(id => String(id ?? "").trim())
    .filter((id, idx, arr) => id && arr.indexOf(id) === idx);
}

export function getAssignedShips(actor) {
  const { doc } = _manifestStore(actor);
  return normalizeAssignedShips(doc?.getFlag(MODULE, SHIPS_FLAG));
}

export async function setAssignedShips(actor, shipIds) {
  const { doc } = _manifestStore(actor);
  if (!doc) return;
  await doc.setFlag(MODULE, SHIPS_FLAG, normalizeAssignedShips(shipIds));
}

// ── Station assignment rule ──────────────────────────────────────────────────
// One station per officer. Command is the only two-seat station (Captain and
// First Officer, by index); every other station holds one officer, and putting
// someone there replaces whoever held it. These two functions are the sole
// owners of that rule — the manifest dialog, the ship sheet's Crew tab and the
// LCARS ring all go through them, so the three cannot disagree again.

/**
 * Returns a NEW manifest with `actorId` moved to `stationId`.
 * @param {object} manifest   Any manifest shape; it is normalised first.
 * @param {string} actorId
 * @param {string|null} stationId  null/"" = unassign everywhere.
 * @param {number|null} seatIndex  Command seat index; ignored elsewhere. When
 *   omitted for Command, the first vacant seat is used, else the Captain's.
 */
export function assignOfficer(manifest, actorId, stationId, seatIndex = null) {
  const next = unassignOfficer(manifest, actorId);
  if (!actorId || !stationId) return next;
  const slot = STATION_SLOTS.find(s => s.id === stationId);
  if (!slot) return next;

  if (stationId === "command") {
    let seat = Number.isInteger(seatIndex) ? seatIndex : next.command.findIndex(id => !id);
    if (!COMMAND_SEATS.some(s => s.index === seat)) seat = 0;
    next.command[seat] = actorId;
  } else {
    next[stationId] = [actorId];
  }
  return next;
}

/** Returns a NEW manifest with `actorId` removed from every station. */
export function unassignOfficer(manifest, actorId) {
  const next = _normalizeManifest(manifest);
  for (const slot of STATION_SLOTS) {
    next[slot.id] = slot.id === "command"
      ? next.command.map(id => (id === actorId ? null : id))
      : next[slot.id].filter(id => id !== actorId);
  }
  return next;
}

/** Where `actorId` sits in this manifest: { stationId, seatIndex } or null. */
export function findOfficerStation(manifest, actorId) {
  const m = _normalizeManifest(manifest);
  for (const slot of STATION_SLOTS) {
    const index = (m[slot.id] ?? []).indexOf(actorId);
    if (index >= 0) return { stationId: slot.id, seatIndex: slot.id === "command" ? index : null };
  }
  return null;
}

/** Display label for a station (and Command seat). */
export function stationLabel(stationId, seatIndex = null) {
  if (stationId === "command") {
    const seat = COMMAND_SEATS.find(s => s.index === seatIndex);
    return seat ? (seat.index === 0 ? "Captain" : "First Officer") : "Command";
  }
  return STATION_SLOTS.find(s => s.id === stationId)?.label ?? stationId;
}

// ── Ship's company ───────────────────────────────────────────────────────────
// Who serves aboard a ship. Three sources, unioned:
//   • "toolkit"    — the character's assignedShips flag (Assign Ships button)
//   • "assignment" — the sta system's Assignment field equal to the ship name,
//                    which is exactly how its Ship Roster finds a ship's crew
//   • "manifest"   — anyone holding a station on this ship
// Adding someone writes the first two, so the system's roster sees them too.

export const SHIP_CREW_ACTION = "shipCrewUpdate";

/** The world actor a ship's crew membership is keyed by. */
function _shipWorldActor(ship) {
  if (!ship) return null;
  return ship.isToken ? (game.actors.get(ship.id ?? ship._id) ?? ship) : ship;
}

function _sameName(a, b) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase()
    && String(a ?? "").trim() !== "";
}

/**
 * The ship's company, sorted Command first, then by station order, then the
 * unassigned crew by name.
 * @returns {{actor, sources: string[], stationId: string|null, seatIndex: number|null}[]}
 */
export function getShipCrew(ship) {
  const world = _shipWorldActor(ship);
  if (!world) return [];
  const manifest = getCrewManifest(ship);
  const byId = new Map();
  const add = (actor, source) => {
    if (!actor) return;
    const entry = byId.get(actor.id) ?? { actor, sources: [] };
    if (!entry.sources.includes(source)) entry.sources.push(source);
    byId.set(actor.id, entry);
  };

  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    const shipIds = normalizeAssignedShips(actor.getFlag?.(MODULE, SHIPS_FLAG));
    if (shipIds.includes(world.id)) add(actor, "toolkit");
    if (_sameName(actor.system?.assignment, world.name)) add(actor, "assignment");
  }
  for (const slot of STATION_SLOTS) {
    for (const id of manifest[slot.id] ?? []) if (id) add(game.actors.get(id), "manifest");
  }

  const order = (e) => {
    if (e.stationId === "command") return e.seatIndex ?? 0;
    const i = STATION_SLOTS.findIndex(s => s.id === e.stationId);
    return i >= 0 ? 10 + i : 100;
  };
  return [...byId.values()]
    .map(e => ({ ...e, ...(findOfficerStation(manifest, e.actor.id) ?? { stationId: null, seatIndex: null }) }))
    .sort((a, b) => order(a) - order(b) || a.actor.name.localeCompare(b.actor.name));
}

/** Is this actor part of the ship's company by any source? */
export function isShipCrew(ship, actor) {
  return !!actor && getShipCrew(ship).some(e => e.actor.id === actor.id);
}

/**
 * Add a character to the ship's company. Writes route themselves: a user who
 * cannot update the character (a player who owns the ship but not the other
 * PCs) asks the active GM over the socket, which runs applyShipCrewRequest.
 * Returns the character's previous Assignment text when this replaced it.
 */
export async function addShipCrew(ship, actor) {
  return _routeShipCrewWrite("add", ship, actor);
}

/** Remove a character from the ship's company and from this ship's stations. */
export async function removeShipCrew(ship, actor) {
  if (!ship || !actor) return;
  const manifest = getCrewManifest(ship);
  if (findOfficerStation(manifest, actor.id)) await setCrewManifest(ship, unassignOfficer(manifest, actor.id));
  return _routeShipCrewWrite("remove", ship, actor);
}

async function _routeShipCrewWrite(op, ship, actor) {
  const world = _shipWorldActor(ship);
  const target = actor?.isToken ? (game.actors.get(actor.id) ?? actor) : actor;
  if (!world || !target) return null;
  if (target.canUserModify?.(game.user, "update")) return applyShipCrewRequest(op, world, target);
  game.socket.emit(`module.${MODULE}`, { action: SHIP_CREW_ACTION, op, shipId: world.id, actorId: target.id });
  return null;
}

/**
 * Perform a crew membership change. Called directly by a user who may update
 * the character, or by the active GM for a socket request.
 */
export async function applyShipCrewRequest(op, ship, actor) {
  const world = _shipWorldActor(ship);
  if (!world || !actor) return null;
  const shipIds = normalizeAssignedShips(actor.getFlag?.(MODULE, SHIPS_FLAG));
  const previous = String(actor.system?.assignment ?? "").trim();
  const update = {};

  if (op === "add") {
    if (!shipIds.includes(world.id)) update[`flags.${MODULE}.${SHIPS_FLAG}`] = [...shipIds, world.id];
    if (!_sameName(previous, world.name)) update["system.assignment"] = world.name;
  } else if (op === "remove") {
    if (shipIds.includes(world.id)) update[`flags.${MODULE}.${SHIPS_FLAG}`] = shipIds.filter(id => id !== world.id);
    if (_sameName(previous, world.name)) update["system.assignment"] = "";
  } else {
    return null;
  }
  if (Object.keys(update).length) await actor.update(update);
  // Tell the caller what Assignment text was overwritten, so it can say so.
  return op === "add" && previous && !_sameName(previous, world.name) ? previous : null;
}

// ── Drag data resolution ──────────────────────────────────────────────────────

/**
 * Resolve an Actor from Foundry drag-transfer data.
 * Handles both Actor drags (from sidebar) and Token drags (from canvas).
 */
export function actorFromDragData(data) {
  let actor = null;

  if (data.type === "Actor") {
    // Dragged from the Actors sidebar — uuid is "Actor.XXXX"
    const id = data.uuid?.replace("Actor.", "") ?? data.id;
    actor = game.actors.get(id);
  } else if (data.type === "Token") {
    // Dragged from the canvas — resolve via scene + token id
    const sceneId = data.sceneId ?? canvas.scene?.id;
    const tokenId = data.tokenId
      ?? data.uuid?.split(".").pop()
      ?? data.id;
    const scene   = game.scenes.get(sceneId);
    const td      = scene?.tokens.get(tokenId);
    actor = td?.actor ?? null;
  }

  if (!actor) return null;
  if (actor.type === "starship" || actor.type === "spacecraft2e") return null;
  if (!actor.system?.attributes && !actor.system?.disciplines) return null;
  return actor;
}

// ── Manifest dialog ───────────────────────────────────────────────────────────

export async function openCrewManifest(shipActor, shipToken, onClose) {
  const manifest = getCrewManifest(shipActor);

  const buildContent = () => {
    const rows = STATION_SLOTS.map(slot => {
      const assigned = (manifest[slot.id] ?? [])
        .map((id, index) => ({ actor: game.actors.get(id), index }))
        .filter(({ actor }) => Boolean(actor));

      // Assigned officer rows
      const officerRows = assigned.map(({ actor: officer, index }) => {
        const stats    = readOfficerStats(officer);
        const img      = officer.img ?? "icons/svg/mystery-man.svg";
        const commandSeat = slot.id === "command"
          ? COMMAND_SEATS.find(seat => seat.index === index)
          : null;
        const attrLine = stats
          ? OFFICER_ATTRIBUTES
              .filter(a => stats.attributes[a.key] !== null)
              .map(a => `${a.label.slice(0,3)} <strong>${stats.attributes[a.key]}</strong>`)
              .join(" · ")
          : "";
        const discLine = stats
          ? OFFICER_DISCIPLINES
              .filter(d => stats.disciplines[d.key] !== null)
              .map(d => `${d.label.slice(0,3)} <strong>${stats.disciplines[d.key]}</strong>`)
              .join(" · ")
          : "";

        return `
          <div style="display:flex;align-items:center;gap:6px;
            padding:4px 6px;margin-bottom:3px;
            background:rgba(255,153,0,0.06);
            border:1px solid ${LC.border};border-radius:2px;">
            <img src="${img}" style="width:28px;height:28px;border-radius:50%;
              object-fit:cover;border:1px solid ${LC.borderDim};flex-shrink:0;" />
            <div style="flex:1;min-width:0;">
              <div style="font-size:10px;font-weight:700;color:${LC.text};
                font-family:${LC.font};white-space:nowrap;overflow:hidden;
                text-overflow:ellipsis;">${officer.name}</div>
              ${commandSeat ? `
                <div style="font-size:8px;color:${LC.primary};font-family:${LC.font};
                  letter-spacing:0.06em;text-transform:uppercase;">${commandSeat.label}</div>` : ""}
              ${stats ? `
                <div style="font-size:8px;color:${LC.textDim};font-family:${LC.font};
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${attrLine}
                </div>
                <div style="font-size:8px;color:${LC.textDim};font-family:${LC.font};
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${discLine}
                </div>` : ""}
            </div>
            <button class="sta2e-crew-remove"
              data-station="${slot.id}" data-index="${index}"
              style="padding:2px 6px;background:rgba(180,0,0,0.15);
                border:1px solid ${LC.red};border-radius:2px;
                color:${LC.red};font-size:9px;cursor:pointer;
                font-family:${LC.font};flex-shrink:0;line-height:1.4;">✕</button>
          </div>`;
      }).join("");

      // Drop zone — only if slot has room
      const buildDropZone = (label, commandSeatIndex = null) => `
        <div class="sta2e-drop-zone" data-station="${slot.id}"${commandSeatIndex === null ? "" : ` data-command-seat="${commandSeatIndex}"`}
          style="display:flex;align-items:center;justify-content:center;gap:6px;
            padding:8px;min-height:38px;
            border:2px dashed ${LC.borderDim};border-radius:3px;
            color:${LC.textDim};font-size:9px;font-family:${LC.font};
            letter-spacing:0.06em;text-transform:uppercase;
            transition:border-color 0.15s,color 0.15s,background 0.15s;
            cursor:copy;">
          <span style="font-size:14px;opacity:0.45;">⬇</span>
          ${label}
        </div>`;
      const commandDropZones = slot.id === "command"
        ? COMMAND_SEATS
            .filter(({ index }) => !manifest.command[index])
            .map(seat => buildDropZone(`Drop ${seat.label}`, seat.index))
            .join("")
        : "";
      const dropZone = slot.id === "command"
        ? commandDropZones
        : buildDropZone(assigned.length < slot.maxOfficers ? "Drop token here" : "Drop to replace");
      const canAddMore = slot.id === "command"
        ? COMMAND_SEATS.some(({ index }) => !manifest.command[index])
        : true;

      return `
        <div style="margin-bottom:8px;padding:6px 8px;
          background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:2px;">
          <div style="font-size:9px;font-weight:700;color:${LC.primary};
            font-family:${LC.font};letter-spacing:0.08em;text-transform:uppercase;
            margin-bottom:${assigned.length > 0 || canAddMore ? "6px" : "0"};">
            ${slot.icon} ${slot.label}
            <span style="color:${LC.textDim};font-weight:400;">
              · ${assigned.length}/${slot.maxOfficers}
            </span>
          </div>
          ${officerRows}
          ${dropZone}
        </div>`;
    }).join("");

    return `
      <div style="font-family:${LC.font};padding:4px;">
        <div style="font-size:9px;color:${LC.textDim};margin-bottom:10px;line-height:1.5;">
          Drag a token from the canvas and drop it onto a station to assign that officer.
          An officer holds one station; assigning them elsewhere moves them.
          Command supports two officers (Captain + First Officer).
        </div>
        ${rows}
      </div>`;
  };

  const dialog = new foundry.applications.api.DialogV2({
    window:  { title: `Crew Manifest — ${shipActor.name}`, resizable: true },
    content: buildContent(),
    buttons: [{ action: "close", label: "Done", icon: "fas fa-check", default: true }],
  });

  await dialog.render(true);

  const wireDialog = () => {
    const el = dialog.element ?? document.querySelector(".app.dialog-v2");
    if (!el) return;

    // ── Drop zones ──────────────────────────────────────────────────────────
    el.querySelectorAll(".sta2e-drop-zone").forEach(zone => {
      zone.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        zone.style.borderColor    = LC.primary;
        zone.style.color          = LC.primary;
        zone.style.background     = "rgba(255,153,0,0.08)";
      });

      zone.addEventListener("dragleave", () => {
        zone.style.borderColor = LC.borderDim;
        zone.style.color       = LC.textDim;
        zone.style.background  = "";
      });

      zone.addEventListener("drop", async e => {
        e.preventDefault();
        zone.style.borderColor = LC.borderDim;
        zone.style.color       = LC.textDim;
        zone.style.background  = "";

        let data;
        try {
          data = JSON.parse(e.dataTransfer.getData("text/plain"));
        } catch {
          ui.notifications.warn("STA2e Toolkit: Could not read drag data.");
          return;
        }

        const actor = actorFromDragData(data);
        if (!actor) {
          ui.notifications.warn("STA2e Toolkit: Drop a character token — ship tokens cannot be assigned as officers.");
          return;
        }

        const stationId = zone.dataset.station;
        const commandSeatIndex = zone.dataset.commandSeat === undefined
          ? null
          : Number(zone.dataset.commandSeat);

        // One station per officer: this moves them off any other station.
        Object.assign(manifest, assignOfficer(manifest, actor.id, stationId, commandSeatIndex));
        await setCrewManifest(shipActor, manifest);
        if (!isShipCrew(shipActor, actor)) await addShipCrew(shipActor, actor);

        const body = el.querySelector(".dialog-content") ?? el.querySelector(".window-content");
        if (body) {
          body.innerHTML = buildContent();
          setTimeout(wireDialog, 50);
        }
      });
    });

    // ── Remove buttons ──────────────────────────────────────────────────────
    el.querySelectorAll(".sta2e-crew-remove").forEach(btn => {
      btn.addEventListener("click", async () => {
        const stationId = btn.dataset.station;
        const idx       = parseInt(btn.dataset.index);
        if (stationId === "command") {
          manifest.command = (manifest.command ?? []).map((id, i) => i === idx ? null : id);
        } else {
          manifest[stationId] = (manifest[stationId] ?? []).filter((_, i) => i !== idx);
        }
        await setCrewManifest(shipActor, manifest);

        const body = el.querySelector(".dialog-content") ?? el.querySelector(".window-content");
        if (body) {
          body.innerHTML = buildContent();
          setTimeout(wireDialog, 50);
        }
      });
    });
  };

  setTimeout(wireDialog, 80);

  Hooks.once("closeDialogV2", () => { if (onClose) onClose(); });
}
