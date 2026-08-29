/**
 * sta2e-toolkit | ship-spawner.js
 *
 * The Ships tab of the spawn window. Drag ship actors into the queue, pick a
 * formation, then place it on the canvas — the ships warp in using the module's
 * own warp arrival (flash, fade, decelerating glide), the same one a Warp Jump
 * lands with.
 *
 * Two things drive facing:
 *   • a targeted token — the fleet forms up facing it, and a circle rings it;
 *   • otherwise a drag-to-aim arrow, so the GM sets the heading by hand.
 *
 * Ships can also arrive on Foundry Regions instead of at a click: one ship per
 * Region flagged as a spawn marker (shuttlebay parking spots), or spread over
 * the grid spaces inside one big Region (a hangar deck, an arrival volume).
 * Either way the Regions supply the positions and the heading is still aimed by
 * hand, because which way a fleet faces when it drops out of warp is a tactical
 * decision, not a geometric one.
 *
 * Placement runs entirely on the GM client, like the transporter. The arrival
 * VFX broadcasts itself (playWarpFlash / broadcastEngineTrail), so no socket
 * action is needed here.
 */

import {
  swColumns, swPanel, swGrid, swField, swCheckField, swSelect, swInput,
  swOptions, swKey,
} from "./spawn-chrome.js";
import { buildQueueHTML, renderQueue, wireQueue, queueTotal } from "./spawn-queue.js";
import { SPAWN_PATTERNS, calcSpawnOffsets } from "./spawn-patterns.js";
import { buildSpawnTokenData, protoHalfSize } from "./token-spawn-utils.js";
import { runShipWarpArrival } from "./combat/ship-card-movement.js";
import {
  WARP_EFFECT_STYLES,
  WARP_STYLE_AUTO,
  resolveRequestedWarpStyle,
} from "./warp-effect-styles.js";
import {
  INDICATOR_COLOR,
  bearingToTokenRotation,
  centreToTopLeft,
  drawFixedPoints,
  drawFormation,
  pickFormationCentre,
  pickHeading,
  pickIndividualCentres,
} from "./spawn-picker.js";
import {
  buildLocationOptions,
  getSceneRegion,
  padCentresForSlots,
  parseLocation,
  regionCentre,
  regionCentresForSlots,
} from "./spawn-regions.js";
import { registerSpawnTab, openSpawnWindow } from "./spawn-window.js";

const MODULE   = "sta2e-toolkit";
const TAB_ID   = "ships";

/** Starfleet can only keep track of so many contacts at once. */
const MAX_SHIPS       = 24;

/**
 * Sentinel for the Spawn Location picker. The other values are `pads:<group>`
 * (one ship per spawn marker) and `region:<id>` (fill a region's grid spaces) —
 * see parseLocation in spawn-regions.js.
 */
const LOC_CANVAS = "canvas";

/**
 * The queue survives a cancelled placement — aborting on the canvas should not
 * cost the GM the fleet they just assembled. Cleared only on a successful spawn.
 *
 * `const`, and every clear is a splice: wireQueue() in spawn-queue.js closes
 * over this exact array, so reassigning it would detach the drop handler.
 */
const _queue = [];

// ── Preferences ───────────────────────────────────────────────────────────────

const PREF_DEFAULTS = {
  pattern: "circle", spacing: 350, snap: true, delay: 300,
  warpStyle: WARP_STYLE_AUTO, location: LOC_CANVAS,
};

/**
 * Arrival-effect choices for the dialog. "Per Ship Default" keeps each actor's
 * own Ship VFX setting, which is why one dialog-wide control can still serve a
 * mixed fleet; the explicit choices override it for this spawn only.
 *
 * Only the canonical styles are listed — a faction variant would be meaningless
 * as a fleet-wide control, because resolveRequestedWarpStyle already swaps each
 * ship onto its own faction's variant. Picking "Temporal Rift" for a mixed
 * fleet therefore gives the Cardassians their rift and the Federation ships
 * theirs, and any ship lacking the trait falls back to standard.
 *
 * `hidden` styles are left out too — the Q flash is not a way for a ship to
 * arrive under its own power.
 */
const WARP_STYLE_CHOICES = [
  { value: WARP_STYLE_AUTO, label: "Per Ship Default" },
  ...Object.values(WARP_EFFECT_STYLES)
    .filter(s => !s.faction && !s.hidden)
    .map(s => ({ value: s.id, label: s.label })),
];

function getPrefs() {
  try {
    return { ...PREF_DEFAULTS, ...(game.settings.get(MODULE, "shipSpawnerPrefs") ?? {}) };
  } catch { return { ...PREF_DEFAULTS }; }
}

function setPrefs(prefs) {
  try { game.settings.set(MODULE, "shipSpawnerPrefs", { ...getPrefs(), ...prefs }); }
  catch { /* setting not registered — prefs simply do not persist */ }
}

// ── Queue ─────────────────────────────────────────────────────────────────────

/** Flatten the queue to one entry per token that will actually be created. */
function expandQueue() {
  const out = [];
  // The queue holds live Actor references across dialog opens, so an actor
  // deleted in between would otherwise blow up mid-placement.
  // Spliced in place, never reassigned: wireQueue() closes over this exact
  // array, so a fresh one would leave the drop handler filling a detached queue.
  let dropped = 0;
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (!game.actors.get(_queue[i].actor?.id)) { _queue.splice(i, 1); dropped++; }
  }
  if (dropped) ui.notifications.warn(`Removed ${dropped} deleted actor(s) from the queue.`);

  for (const entry of _queue) {
    const count = entry.isLinked ? 1 : entry.quantity;
    for (let i = 0; i < count; i++) {
      const { halfW, halfH } = protoHalfSize(entry.actor);
      out.push({
        actor: entry.actor,
        displayName: count > 1 ? `${entry.name} ${i + 1}` : entry.name,
        halfW,
        halfH,
        // A ring slightly inside the footprint reads better than one exactly on
        // it, and a hard floor keeps 0.5-size shuttles visible.
        radius: Math.max(Math.max(halfW, halfH) * 0.9, 20),
      });
    }
  }
  return out;
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

async function spawnFleet(slots, centres, heading, { snap, delay, warpStyle }) {
  canvas.animatePan({ x: centres[0].x, y: centres[0].y, duration: 1000 });

  let spawned = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot   = slots[i];
    const centre = centres[i] ?? centres[0];
    try {
      const { x, y } = centreToTopLeft(centre, slot.halfW, slot.halfH, snap);
      const data = await buildSpawnTokenData(slot.actor, {
        name: slot.displayName,
        x, y,
        rotation: slot.rotation ?? bearingToTokenRotation(heading),
        alpha: 0,
      });

      const [created] = await canvas.scene.createEmbeddedDocuments("Token", [data]);
      if (!created) throw new Error("Token creation returned nothing.");

      // Let the canvas register the placeable before animating it — the same
      // yield the transporter's beam-in needs.
      await new Promise(r => setTimeout(r, 50));
      const tok = canvas.tokens.get(created.id);
      // Style resolved from the source actor rather than the token: the token
      // was created moments ago and its synthetic actor may not resolve yet.
      // The dialog's choice wins over the ship's own default, and a ship that
      // lacks the trait for it falls back to the standard flash.
      if (tok) await runShipWarpArrival(tok, heading, {
        style: resolveRequestedWarpStyle(slot.actor, warpStyle),
      });
      spawned++;
    } catch (err) {
      console.error(`STA2e Toolkit | ship spawner: failed to spawn ${slot.displayName}:`, err);
      ui.notifications.error(`Failed to spawn ${slot.displayName}.`);
    }

    if (i < slots.length - 1 && delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return spawned;
}

/**
 * Pad-marker placement — one ship per marked Region, in the order the GM named
 * them. All or nothing: three marked parking spots cannot take five shuttles.
 * Returns { centres, anchor } or null.
 */
function resolvePadCentres(groupKey, slots) {
  const { centres, padCount, label } = padCentresForSlots(groupKey, slots);
  if (!centres) {
    ui.notifications.error(padCount
      ? `${slots.length} ship${slots.length === 1 ? "" : "s"} queued, "${label}" has ${padCount} marker${padCount === 1 ? "" : "s"}.`
      : `"${label}" has no spawn markers on this scene — flag some Regions first.`);
    return null;
  }
  // Aim from the middle of the markers actually used, not the whole set.
  return {
    centres,
    anchor: {
      x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
      y: centres.reduce((s, c) => s + c.y, 0) / centres.length,
    },
  };
}

/**
 * Region placement — the Region defines where, the GM still defines which way.
 * Returns { centres, anchor } or null when the region is unusable.
 */
function resolveRegionCentres(regionId, slots) {
  const region = getSceneRegion(regionId);
  if (!region) {
    ui.notifications.warn("That Region is not on this scene any more — pick a spawn location again.");
    return null;
  }

  const { centres, overflow } = regionCentresForSlots(region, slots);
  if (!centres.length) {
    ui.notifications.error(`No room inside "${region.name}" for a ship that size.`);
    return null;
  }
  if (overflow) {
    ui.notifications.warn(
      `"${region.name}" has room for ${slots.length - overflow} of ${slots.length} ships — the rest are squeezed in.`
    );
  }
  return { centres, anchor: regionCentre(region) };
}

/** Run the full placement flow. Returns true when ships were actually spawned. */
async function runSpawn({ pattern, spacing, snap, delay, warpStyle, location }) {
  const slots = expandQueue();
  if (!slots.length) {
    ui.notifications.warn("No ships in the spawn queue.");
    return false;
  }
  if (slots.length > MAX_SHIPS) {
    ui.notifications.error(`${slots.length} contacts queued — sensors can only resolve ${MAX_SHIPS} at once.`);
    return false;
  }

  const target = Array.from(game.user.targets)[0] ?? null;
  const targetPoint = target ? (target.center ?? { x: target.x, y: target.y }) : null;
  const site = parseLocation(location);

  // ── Stage 1: position ──────────────────────────────────────────────────────
  let centres = null;
  let anchor = null;
  let chosenPattern = pattern;

  if (site.kind === "pads" || site.kind === "region") {
    // The Regions already answer "where" — no click, and the formation control
    // has nothing to say, so it is ignored (and greyed out in the panel).
    const placed = site.kind === "pads"
      ? resolvePadCentres(site.key, slots)
      : resolveRegionCentres(site.id, slots);
    if (!placed) return false;
    centres = placed.centres;
    anchor  = placed.anchor;
    chosenPattern = "individual";   // positions are fixed; nothing to re-derive
  } else if (pattern === "individual") {
    centres = await pickIndividualCentres(slots, null);
    if (!centres) { ui.notifications.warn("Warp-in aborted."); return false; }
  } else {
    const picked = await pickFormationCentre(slots, pattern, spacing, { targetPoint, verb: "WARP-IN" });
    if (!picked) { ui.notifications.warn("Warp-in aborted."); return false; }
    chosenPattern = picked.pattern;
    if (chosenPattern === "individual") {
      // [Q] landed on individual — the click just placed ship one.
      centres = await pickIndividualCentres(slots, picked.centre);
      if (!centres) { ui.notifications.warn("Warp-in aborted."); return false; }
    } else {
      centres = [picked.centre];   // resolved into offsets once the heading is known
    }
  }

  // The anchor for aiming: the click point, the region's centre, or the
  // centroid of hand-placed ships.
  anchor ??= chosenPattern === "individual"
    ? {
        x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
        y: centres.reduce((s, c) => s + c.y, 0) / centres.length,
      }
    : centres[0];

  // ── Stage 2: heading ───────────────────────────────────────────────────────
  let heading;
  if (targetPoint) {
    heading = Math.atan2(targetPoint.y - anchor.y, targetPoint.x - anchor.x);
  } else {
    heading = await pickHeading(
      anchor,
      chosenPattern === "individual"
        // Hand-placed and region positions are already fixed, so show them as
        // they stand rather than a formation that would swing with the aim.
        ? g => drawFixedPoints(g, centres, slots.map(s => s.radius), INDICATOR_COLOR)
        : (g, h) => drawFormation(g, anchor.x, anchor.y, slots, chosenPattern, spacing, h)
    );
    if (heading === null) { ui.notifications.warn("Warp-in aborted."); return false; }
  }

  // ── Resolve final positions ────────────────────────────────────────────────
  if (chosenPattern !== "individual") {
    const offsets = calcSpawnOffsets(chosenPattern, slots.length, spacing, { headingRad: heading });
    centres = offsets.map(o => ({ x: anchor.x + o.x, y: anchor.y + o.y }));
    // Circle faces every ship inward at the target rather than along the heading.
    offsets.forEach((o, i) => { slots[i].rotation = o.rotation; });
  }

  ui.notifications.info(`Warping in ${slots.length} ship(s)…`);
  // A marker was drawn where it was meant to be, so snapping it to the grid
  // would only move the ship off it.
  const spawned = await spawnFleet(slots, centres, heading, {
    snap: site.kind === "pads" ? false : snap,
    delay, warpStyle,
  });

  if (spawned > 0) ui.notifications.info(`${spawned} ship(s) warped in.`);
  else ui.notifications.error("No ships were spawned — see console.");
  return spawned > 0;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function buildContent(prefs) {
  const config = swGrid([
    swField("Spawn Location", swSelect({
      id: "sp-location",
      options: buildLocationOptions(prefs.location),
    })),
    swField("Formation", swSelect({
      id: "sp-pattern",
      options: swOptions(Object.entries(SPAWN_PATTERNS), prefs.pattern),
    })),
    swField("Spread (px)", swInput({
      id: "sp-spacing", value: prefs.spacing,
      attrs: ` min="50" max="2000" step="25"`,
    })),
    swField("Spawn Delay (ms)", swInput({
      id: "sp-delay", value: prefs.delay,
      attrs: ` min="0" max="5000" step="50"`,
    })),
    swField("Arrival Effect", swSelect({
      id: "sp-warp-style",
      options: swOptions(WARP_STYLE_CHOICES.map(c => [c.value, c.label]), prefs.warpStyle),
    })),
    swCheckField("Snap to Grid", { id: "sp-snap", checked: prefs.snap }),
  ].join(""), 2);

  const left = [
    swPanel("Fleet Configuration", config),
    swPanel("Ship Queue", buildQueueHTML({ hint: "⟡ Drag ship actors or tokens here ⟡" }), {
      meta: "drag ships here",
    }),
  ].join("");

  const right = swPanel("Deployment Status", `<div class="sw-status" id="sp-status"></div>`);

  return swColumns(left, right);
}

/**
 * The status line, and the controls a Region makes meaningless.
 * Re-run whenever the panel is shown, since the target can change while the
 * window sits open.
 */
function refreshStatus(root) {
  const status = root.querySelector("#sp-status");
  const site   = parseLocation(root.querySelector("#sp-location")?.value ?? LOC_CANVAS);
  const target = Array.from(game.user.targets)[0] ?? null;

  // Neither Region mode leaves the formation controls anything to decide.
  const pattern = root.querySelector("#sp-pattern");
  const spacing = root.querySelector("#sp-spacing");
  if (pattern) pattern.disabled = site.kind !== "canvas";
  if (spacing) spacing.disabled = site.kind !== "canvas";

  if (!status) return;
  status.classList.toggle("has-target", !!target);
  const facing = target
    ? `Facing target: ${target.name}.`
    : "No target — you'll set the fleet's heading with the aiming arrow.";
  const where = {
    pads:   "Arriving one ship per spawn marker, in marker-name order. ",
    region: "Arriving inside the selected Region, one ship per grid space. ",
  }[site.kind] ?? "";
  status.textContent = `${where}${facing}`;
}

/**
 * The queue widget, the drop target and the status line.
 *
 * The queue itself is the shared one from spawn-queue.js — this tab used to
 * carry a near-identical copy. Everything downstream (expandQueue, runSpawn)
 * reads only `actor` / `isLinked` / `quantity` / `name`, all of which the
 * shared entry shape carries, so the swap is invisible to the spawn path.
 */
function wirePanel(root) {
  wireQueue(root, _queue);
  root.querySelector("#sp-location")?.addEventListener("change", () => refreshStatus(root));

  renderQueue(root, _queue);
  refreshStatus(root);
}

/**
 * Re-read the panel. The window keeps both tabs mounted, so this runs on every
 * activation: the scene's Regions and the user's target can both have changed
 * while the Transporter tab was in front.
 */
function refreshPanel(root) {
  const select = root?.querySelector("#sp-location");
  if (select) {
    // A Region that has gone (scene change, deletion) is simply no longer in
    // the list, and the select falls back to Canvas Click rather than silently
    // spawning somewhere else.
    select.innerHTML = buildLocationOptions(select.value);
    if (!select.value) select.value = LOC_CANVAS;
  }
  refreshStatus(root);
}

function readForm(root) {
  const q = sel => root?.querySelector(sel);
  const num = (sel, fallback) => {
    const v = Number(q(sel)?.value);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    pattern:   q("#sp-pattern")?.value ?? PREF_DEFAULTS.pattern,
    spacing:   num("#sp-spacing", PREF_DEFAULTS.spacing),
    delay:     num("#sp-delay", PREF_DEFAULTS.delay),
    snap:      q("#sp-snap")?.checked ?? PREF_DEFAULTS.snap,
    warpStyle: q("#sp-warp-style")?.value ?? PREF_DEFAULTS.warpStyle,
    location:  q("#sp-location")?.value ?? PREF_DEFAULTS.location,
  };
}
// ── Rail keys ─────────────────────────────────────────────────────────────────

function buildActions(root, api) {
  const spawnBtn = swKey("Warp In", {
    icon: "fas fa-rocket",
    title: "Warp the queued fleet in",
  });
  spawnBtn.addEventListener("click", async () => {
    if (spawnBtn.disabled) return;
    const form = readForm(root);
    setPrefs(form);
    if (!queueTotal(_queue)) {
      ui.notifications.warn("No ships in the spawn queue — drag ship actors in first.");
      return;
    }
    spawnBtn.disabled = true;
    try {
      // The window sits over the canvas the GM is about to click on.
      const spawned = await api.hideWhile(() => runSpawn(form));
      // Spliced rather than reassigned: wireQueue() closes over this exact
      // array, so a fresh one would leave the drop handler filling a detached
      // queue that nothing ever renders.
      if (spawned) { _queue.splice(0, _queue.length); renderQueue(root, _queue); }
    } finally {
      spawnBtn.disabled = false;
    }
  });

  const clearBtn = swKey("Clear Queue", {
    icon: "fas fa-eraser",
    accent: "var(--sw-secondary)",
  });
  clearBtn.addEventListener("click", () => {
    _queue.splice(0, _queue.length);
    renderQueue(root, _queue);
  });

  return [spawnBtn, clearBtn];
}

// ── Registration ──────────────────────────────────────────────────────────────

registerSpawnTab({
  id:    TAB_ID,
  label: "Ships",
  icon:  "fas fa-rocket",
  buildHTML:    () => buildContent(getPrefs()),
  wire:         panel => wirePanel(panel),
  onActivate:   panel => refreshPanel(panel),
  buildActions: (panel, api) => buildActions(panel, api),
});

/**
 * Open the spawn window on the Ships tab. GM only — it creates tokens.
 * Exposed as `game.sta2eToolkit.openShipSpawner()`.
 */
export async function openShipSpawner() {
  return openSpawnWindow({ tab: TAB_ID });
}

export { bearingToTokenRotation };
