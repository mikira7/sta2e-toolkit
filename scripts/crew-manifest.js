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
  return doc.getFlag(MODULE, FLAG) ?? _emptyManifest();
}

export async function setCrewManifest(actor, manifest) {
  const { doc } = _manifestStore(actor);
  if (!doc) return;
  await doc.setFlag(MODULE, FLAG, manifest);
}

function _emptyManifest() {
  const m = {};
  STATION_SLOTS.forEach(s => { m[s.id] = []; });
  return m;
}

// ── Officer resolution ────────────────────────────────────────────────────────

export function getStationOfficers(shipActor, stationId) {
  const manifest = getCrewManifest(shipActor);
  const ids      = manifest[stationId] ?? [];
  return ids.map(id => game.actors.get(id)).filter(Boolean);
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

export function getAssignedShips(actor) {
  const { doc } = _manifestStore(actor);
  return doc?.getFlag(MODULE, SHIPS_FLAG) ?? [];
}

export async function setAssignedShips(actor, shipIds) {
  const { doc } = _manifestStore(actor);
  if (!doc) return;
  await doc.setFlag(MODULE, SHIPS_FLAG, shipIds);
}

// ── Drag data resolution ──────────────────────────────────────────────────────

/**
 * Resolve an Actor from Foundry drag-transfer data.
 * Handles both Actor drags (from sidebar) and Token drags (from canvas).
 */
function _actorFromDragData(data) {
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
        .map(id => game.actors.get(id))
        .filter(Boolean);

      // Assigned officer rows
      const officerRows = assigned.map((officer, idx) => {
        const stats    = readOfficerStats(officer);
        const img      = officer.img ?? "icons/svg/mystery-man.svg";
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
              data-station="${slot.id}" data-index="${idx}"
              style="padding:2px 6px;background:rgba(180,0,0,0.15);
                border:1px solid ${LC.red};border-radius:2px;
                color:${LC.red};font-size:9px;cursor:pointer;
                font-family:${LC.font};flex-shrink:0;line-height:1.4;">✕</button>
          </div>`;
      }).join("");

      // Drop zone — only if slot has room
      const canAddMore = assigned.length < slot.maxOfficers;
      const dropZone   = canAddMore ? `
        <div class="sta2e-drop-zone" data-station="${slot.id}"
          style="display:flex;align-items:center;justify-content:center;gap:6px;
            padding:8px;min-height:38px;
            border:2px dashed ${LC.borderDim};border-radius:3px;
            color:${LC.textDim};font-size:9px;font-family:${LC.font};
            letter-spacing:0.06em;text-transform:uppercase;
            transition:border-color 0.15s,color 0.15s,background 0.15s;
            cursor:copy;">
          <span style="font-size:14px;opacity:0.45;">⬇</span>
          Drop token here
        </div>` : "";

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
          A character may hold up to two stations.
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

        const actor = _actorFromDragData(data);
        if (!actor) {
          ui.notifications.warn("STA2e Toolkit: Drop a character token — ship tokens cannot be assigned as officers.");
          return;
        }

        const stationId = zone.dataset.station;
        const slot      = STATION_SLOTS.find(s => s.id === stationId);
        const current   = manifest[stationId] ?? [];

        if (current.length >= slot.maxOfficers) {
          ui.notifications.warn(`STA2e Toolkit: ${slot.label} is full.`);
          return;
        }
        if (current.includes(actor.id)) {
          ui.notifications.warn(`STA2e Toolkit: ${actor.name} is already at ${slot.label}.`);
          return;
        }

        // Enforce max two stations per officer
        const totalAssigned = STATION_SLOTS.reduce((n, s) => {
          return n + ((manifest[s.id] ?? []).includes(actor.id) ? 1 : 0);
        }, 0);
        if (totalAssigned >= 2) {
          ui.notifications.warn(`STA2e Toolkit: ${actor.name} is already assigned to two stations.`);
          return;
        }

        manifest[stationId] = [...current, actor.id];
        await setCrewManifest(shipActor, manifest);

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
        manifest[stationId] = (manifest[stationId] ?? []).filter((_, i) => i !== idx);
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
