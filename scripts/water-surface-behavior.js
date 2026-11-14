/**
 * sta2e-toolkit | water-surface-behavior.js
 *
 * The `sta2e-toolkit.waterSurface` RegionBehaviorType: animated water drawn
 * inside a Region, with foam and shallows along its outline. Paint the water
 * with any Region tool — polygon, ellipse, or the toolkit's Curve tool — and
 * cut islands out of it with the Hole toggle.
 *
 * Like the Warp Viewscreen, the sheet is generated from the schema by core's
 * RegionBehaviorConfig. Two controls are injected: a Preset select, which writes
 * a preset's defaults into the native inputs (saved by ordinary submission), and
 * a Set Flow Direction picker that takes two canvas clicks.
 *
 * Registering the type needs the manifest entry
 * `documentTypes.RegionBehavior.waterSurface` and a WORLD RELAUNCH — a browser
 * reload does not re-read module.json.
 */

import {
  awaitCanvasClick, cursorPoint, showOverlay, setCrosshairCursor, crosshair, stroked, INDICATOR_COLOR,
} from "./spawn-picker.js";
import {
  attachWater, detachWater, rebuildWater, refreshWater, sweepWater,
} from "./water-vfx.js";
import {
  WATER_PRESETS, WATER_FIELD_RANGES, WATER_FLOW_MODES, WATER_PRESET_FIELDS,
  DEFAULT_WATER_PRESET, waterPresetChoices, waterPresetDefaults,
} from "./water-presets.js";

export const WATER_TYPE = "sta2e-toolkit.waterSurface";
const TYPE_LABEL_KEY = `TYPES.RegionBehavior.${WATER_TYPE}`;
const TYPE_HINT_KEY = `TYPES.HINTS.RegionBehavior.${WATER_TYPE}`;

const D = WATER_PRESETS[DEFAULT_WATER_PRESET].defaults;
const R = WATER_FIELD_RANGES;

export class WaterSurfaceBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.base"];

  /** No `_createEventsField()`: the water never reacts to token events itself. */
  static defineSchema() {
    const f = foundry.data.fields;
    const num = (key, label, hint, step, initial = D[key]) => new f.NumberField({
      required: true, nullable: false, initial, min: R[key][0], max: R[key][1], step, label, hint,
    });
    return {
      preset: new f.StringField({
        required: true, blank: false, initial: DEFAULT_WATER_PRESET, choices: waterPresetChoices(),
        label: "Preset",
        hint: "A starting look. Choosing one fills in every setting below; tune from there.",
      }),
      deepColor: new f.ColorField({ required: true, nullable: false, initial: D.deepColor, label: "Deep Colour" }),
      shallowColor: new f.ColorField({ required: true, nullable: false, initial: D.shallowColor, label: "Shallow Colour",
        hint: "The colour near the shore. For lava and other glowing liquids this is also the glow." }),
      foamColor: new f.ColorField({ required: true, nullable: false, initial: D.foamColor, label: "Foam Colour" }),
      opacity: num("opacity", "Opacity (%)", "How much of the map art shows through. Shallows are always a little clearer.", 5),

      waveScale: num("waveScale", "Wave Size (squares)", "How big the wave pattern is, in grid squares.", 0.25),
      waveSpeed: num("waveSpeed", "Wave Speed (%)", "How fast the surface churns.", 5),
      waveHeight: num("waveHeight", "Wave Height (%)", "How strongly the waves catch the light.", 5),

      flowMode: new f.StringField({
        required: true, blank: false, initial: D.flowMode, choices: { ...WATER_FLOW_MODES },
        label: "Current",
        hint: "Still water only churns. One Direction carries the whole surface along the bearing below. "
            + "Follow the Banks runs the current along the Region's outline, so a winding river flows round its bends; "
            + "the bearing says which way along it. (A river doubling back by more than a right angle may run backwards in the bend.)",
      }),
      flowAngle: num("flowAngle", "Current Bearing (°)", "0 runs up the map, 90 to the right, 180 down. Use Set Flow Direction to click it.", 1),
      flowSpeed: num("flowSpeed", "Current Speed (%)", "", 5),

      foamWidth: num("foamWidth", "Foam Width (squares)", "How far the surf reaches out from the shore. 0 for no foam.", 0.1),
      foamIntensity: num("foamIntensity", "Foam Strength (%)", "", 5),
      depthReach: num("depthReach", "Shelf Width (squares)", "How far out from the shore the water reaches its deep colour.", 0.5),
      openEdges: new f.BooleanField({
        required: true, initial: true, label: "Open Map Edges",
        hint: "Water running off the edge of the scene carries on past it, so no surf is drawn along the map border.",
      }),

      swellSize: num("swellSize", "Swell Size (%)",
        "Big surfable waves: sets of three that rise out in deep water at random, roll in, "
        + "break into a wall of white water and surge up the shore. 0 for none.", 5),
      swellEvery: num("swellEvery", "Swell Sets Every (s)",
        "On average how many seconds between sets. They arrive at random, and only along "
        + "a stretch of the coast at a time.", 5),
      turbulence: num("turbulence", "Turbulence (%)",
        "Rough seas: steeper, faster chop, whitecaps breaking out on open water, foam blown "
        + "into streaks down the wind (the Flow Direction), heavier surf, and a storm-grey sea. 0 for calm.", 5),

      caustics: num("caustics", "Caustics (%)",
        "The rippling web of light the waves focus onto the floor of clear, shallow water — "
        + "a swimming pool, a lagoon. Lower the Opacity so the floor shows through. 0 for none.", 5),
      sparkles: new f.BooleanField({
        required: true, initial: true, label: "Sun Glitter",
        hint: "Tiny flashes of sunlight on the wave faces. Off for overcast or night scenes, or water that should read matte.",
      }),
      glow: num("glow", "Glow (%)", "Emissive veins and a hot tint, for lava, acid and the like. 0 for water.", 5),
      aboveTokens: new f.BooleanField({
        required: true, initial: false, label: "Draw Above Tokens",
        hint: "Off: the water lies on the map and tokens float on it. On: it covers tokens, for deep water or fog banks.",
      }),

      wakes: new f.BooleanField({
        required: true, initial: true, label: "Token Wakes",
        hint: "Tokens moving through the water leave spreading ripples.",
      }),
      wakeStrength: num("wakeStrength", "Wake Strength (%)", "", 5, 60),
    };
  }

  static events = {
    [CONST.REGION_EVENTS.BEHAVIOR_VIEWED]: function () { attachWater(this); },
    [CONST.REGION_EVENTS.BEHAVIOR_UNVIEWED]: function () { detachWater(this.behavior?.uuid); },
    [CONST.REGION_EVENTS.REGION_BOUNDARY]: function () { rebuildWater(this.behavior?.uuid); },
  };
}

// ── Hooks ───────────────────────────────────────────────────────────────────

function _onBehaviorUpdate(behavior) {
  if (behavior?.type !== WATER_TYPE) return;
  if (behavior.parent?.parent?.id !== canvas?.scene?.id) return;
  refreshWater(behavior);
}

function _onBehaviorDelete(behavior) {
  if (behavior?.type !== WATER_TYPE) return;
  detachWater(behavior.uuid);
}

// ── Sheet: preset select ────────────────────────────────────────────────────

function _setSheetValue(root, name, value) {
  const el = root.querySelector(`[name="${name}"]`);
  if (!el) return;
  if (el.type === "checkbox") { el.checked = !!value; return; }
  try { el.value = value ?? ""; } catch { /**/ }
  // <color-picker> and range-pickers wrap their own inputs.
  for (const inner of el.querySelectorAll?.("input") ?? []) inner.value = value ?? "";
}

function _wirePresetSelect(app, root) {
  const sel = root.querySelector('select[name="system.preset"]');
  if (!sel || sel.dataset.sta2eWater) return;
  sel.dataset.sta2eWater = "1";
  sel.addEventListener("change", () => {
    const d = waterPresetDefaults(sel.value);
    for (const key of WATER_PRESET_FIELDS) _setSheetValue(root, `system.${key}`, d[key]);
  });
}

// ── Sheet: flow direction picker ────────────────────────────────────────────

function _drawFlowPreview(g, from) {
  const p = cursorPoint();
  stroked(g, { width: 3, color: INDICATOR_COLOR, alpha: 0.9 }, gg => {
    if (from) {
      gg.moveTo(from.x, from.y);
      gg.lineTo(p.x, p.y);
      const a = Math.atan2(p.y - from.y, p.x - from.x), h = 18;
      gg.moveTo(p.x, p.y); gg.lineTo(p.x - Math.cos(a - 0.45) * h, p.y - Math.sin(a - 0.45) * h);
      gg.moveTo(p.x, p.y); gg.lineTo(p.x - Math.cos(a + 0.45) * h, p.y - Math.sin(a + 0.45) * h);
    }
  });
  stroked(g, { width: 2, color: 0xffffff, alpha: 0.95 }, gg => crosshair(gg, p.x, p.y, 10));
}

/** Two clicks, upstream then downstream. Resolves to a compass bearing or null. */
export async function pickFlowBearing() {
  if (!canvas?.ready) return null;
  const overlay = showOverlay("CURRENT", "Click upstream, then downstream · [RMB/Esc] abort");
  setCrosshairCursor(true);
  try {
    const a = await awaitCanvasClick({ onMove: g => _drawFlowPreview(g, null) });
    if (!a) return null;
    const b = await awaitCanvasClick({ onMove: g => _drawFlowPreview(g, a) });
    if (!b || (b.x === a.x && b.y === a.y)) return null;
    // Compass: 0 up the map, clockwise.
    const deg = Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI;
    return Math.round((deg + 360) % 360);
  } finally {
    setCrosshairCursor(false);
    overlay.remove();
  }
}

function _injectFlowPicker(app, root) {
  if (root.querySelector(".sta2e-water-flow-pick")) return;
  const input = root.querySelector('[name="system.flowAngle"]');
  const group = input?.closest(".form-group");
  if (!group) return;
  const row = document.createElement("div");
  row.className = "form-group sta2e-water-flow-pick";
  row.innerHTML = `
    <label>Flow Direction <span style="opacity:0.6;font-size:0.85em;">(STA Toolkit)</span></label>
    <div class="form-fields">
      <button type="button"><i class="fa-solid fa-arrow-right-long"></i> Set Flow Direction</button>
    </div>
    <p class="hint">Click upstream, then downstream, to set the current's bearing.</p>`;
  group.after(row);
  row.querySelector("button").addEventListener("click", async () => {
    try { await app.minimize?.(); } catch { /**/ }
    let deg = null;
    try { deg = await pickFlowBearing(); } finally { try { await app.maximize?.(); } catch { /**/ } }
    if (deg === null) return;
    _setSheetValue(root, "system.flowAngle", deg);
    const mode = root.querySelector('[name="system.flowMode"]');
    if (mode && mode.value === "still") mode.value = "uniform";
    ui.notifications.info(`Current bearing ${deg}° — save the behavior to apply it.`);
  });
}

/**
 * Call a set of big waves on a water behavior now, for everyone: the whole
 * coast, at least a good size even when random swell is off. It is a flag
 * stamped with the wall-clock time; every client's shader starts the set from
 * that stamp, so no socket is needed and late joiners see it mid-way.
 */
export async function sendWaterSet(behaviorOrUuid) {
  const behavior = typeof behaviorOrUuid === "string" ? await fromUuid(behaviorOrUuid) : behaviorOrUuid;
  if (behavior?.type !== WATER_TYPE) {
    ui.notifications.warn("That is not a Water Surface behavior.");
    return;
  }
  await behavior.setFlag("sta2e-toolkit", "swellAt", Date.now());
}

function _injectSendSet(app, root) {
  if (root.querySelector(".sta2e-water-send-set")) return;
  const group = root.querySelector('[name="system.swellEvery"]')?.closest(".form-group");
  const doc = app?.document ?? app?.object ?? null;
  if (!group || !doc?.id) return;
  const row = document.createElement("div");
  row.className = "form-group sta2e-water-send-set";
  row.innerHTML = `
    <label>Big Waves <span style="opacity:0.6;font-size:0.85em;">(STA Toolkit)</span></label>
    <div class="form-fields">
      <button type="button"><i class="fa-solid fa-water"></i> Send a Set Now</button>
    </div>
    <p class="hint">Rolls a set of three big waves in along the whole shore, for everyone, right now.</p>`;
  group.after(row);
  row.querySelector("button").addEventListener("click", () => sendWaterSet(doc));
}

function _onRenderConfig(app, html) {
  const doc = app?.document ?? app?.object ?? null;
  if (doc?.type !== WATER_TYPE) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  _wirePresetSelect(app, root);
  _injectFlowPicker(app, root);
  _injectSendSet(app, root);
}

/**
 * Redraw every water behavior on the viewed scene from scratch — the quality
 * setting changed. "Off" leaves nothing; anything else attaches every enabled
 * behavior, which covers going from Off back on (no instance to rebuild).
 */
export function resyncWater() {
  sweepWater();
  if (!canvas?.ready) return;
  for (const region of canvas.scene?.regions ?? []) {
    for (const behavior of region.behaviors ?? []) {
      if (behavior.type === WATER_TYPE && !behavior.disabled) attachWater(behavior.system);
    }
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerWaterSurfaceBehavior() {
  CONFIG.RegionBehavior.dataModels[WATER_TYPE] = WaterSurfaceBehaviorType;
  CONFIG.RegionBehavior.typeLabels[WATER_TYPE] = TYPE_LABEL_KEY;
  CONFIG.RegionBehavior.typeHints[WATER_TYPE] = TYPE_HINT_KEY;
  CONFIG.RegionBehavior.typeIcons[WATER_TYPE] = "fa-solid fa-water";

  try {
    const types = getDocumentClass("RegionBehavior")?.TYPES ?? [];
    if (!types.includes(WATER_TYPE)) {
      console.warn(
        `STA2e Toolkit | "${WATER_TYPE}" is not in game.model.RegionBehavior — the Water Surface `
        + "behavior will not appear in the Add Behavior list until the world is relaunched "
        + "(a browser reload does not re-read module.json).",
      );
    }
  } catch { /* diagnostic only */ }

  Hooks.on("renderRegionBehaviorConfig", _onRenderConfig);
  Hooks.on("updateRegionBehavior", _onBehaviorUpdate);
  Hooks.on("deleteRegionBehavior", _onBehaviorDelete);
  Hooks.on("canvasReady", () => sweepWater());
  Hooks.on("canvasTearDown", () => sweepWater());
}
