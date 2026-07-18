/**
 * sta2e-toolkit | star-system-scene.js
 * Builds a playable Foundry scene from a Star System actor: star and planet
 * tiles, orbit-ring drawings labeled in AU, moon clusters, asteroid belts, and
 * concentric toolkit zones (one ring per orbit) so the zone ruler and range
 * bands work immediately. Also provides the hover tooltip that shows a body's
 * name to any user mousing over a system-map tile.
 */

import { getStarSystemData, ensureOrbitalDistances } from "./star-system-sheet.js";
import { pickStarSystemImage, getStarSystemBackgrounds } from "./star-system-images.js";
import { setSceneZones } from "./zone-data.js";

const MODULE_ID = "sta2e-toolkit";
export const SCENE_ACTOR_FLAG = "starSystemSceneActor";
const BODY_FLAG = "systemBody";

// Layout constants (pixels). The scene is gridless with a 100px grid size.
const GRID = 100;
const RING_MIN_RADIUS = 900;
const RING_MIN_GAP = 450;
const SCENE_MARGIN = 900;
const SCENE_MIN_SIZE = 3000;
const SCENE_MAX_SIZE = 15000;
const CIRCLE_POINTS = 48;

const ZONE_COLORS = ["#ff9c00", "#cc99cc", "#9999ff", "#ff9966", "#66ccff", "#99cc99"];

function worldClassOf(value) {
  const match = String(value ?? "").match(/Class-([A-Z])/i);
  if (match) return match[1].toUpperCase();
  return String(value ?? "").includes("Asteroid Belt") ? "Belt" : "";
}

function isGasGiantClass(cls) {
  return ["I", "J", "S", "T"].includes(cls);
}

function displayName(world, fallback = "Unknown body") {
  return String(world?.name ?? "").trim() || fallback;
}

function auNumber(world) {
  const num = Number(world?.orbitalAU);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function bodyFlag(name, kind, type) {
  return { [MODULE_ID]: { [BODY_FLAG]: { name, kind, type: String(type ?? "") } } };
}

function tileData({ src, cx, cy, size, sort, name, kind, type }) {
  // Foundry v14 tiles anchor at their center (shape.anchor 0.5), so x/y is the
  // center point; v13 and earlier position tiles by their top-left corner.
  const centered = (game.release?.generation ?? 13) >= 14;
  return {
    texture: { src },
    x: Math.round(centered ? cx : cx - size / 2),
    y: Math.round(centered ? cy : cy - size / 2),
    width: Math.round(size),
    height: Math.round(size),
    sort,
    flags: bodyFlag(name, kind, type),
  };
}

function circleVertices(cx, cy, radius, points = CIRCLE_POINTS) {
  const vertices = [];
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    vertices.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return vertices;
}

/**
 * Annulus polygon: outer circle then inner circle reversed. Ray-casting
 * point-in-polygon treats the hole correctly (seam edges cancel), and
 * consecutive rings share their boundary circle vertices exactly, which is
 * what zone adjacency checks look for.
 */
function annulusVertices(cx, cy, innerRadius, outerRadius) {
  const outer = circleVertices(cx, cy, outerRadius);
  const inner = circleVertices(cx, cy, innerRadius).reverse();
  return [...outer, ...inner];
}

/**
 * Map ascending AU values onto ring radii with a log-compressed scale so
 * inner and outer orbits both stay playable, then enforce a minimum gap.
 */
function computeRingRadii(aus) {
  const n = aus.length;
  if (!n) return [];
  if (n === 1) return [RING_MIN_RADIUS + RING_MIN_GAP];
  const min = Math.max(aus[0], 1e-6);
  const max = Math.max(aus[n - 1], min * 1.01);
  const span = Math.log(max / min);
  const outerTarget = Math.min(RING_MIN_RADIUS + (n - 1) * 750, (SCENE_MAX_SIZE / 2) - SCENE_MARGIN);
  const radii = aus.map(au => {
    const t = span > 0 ? Math.log(Math.max(au, min) / min) / span : 0;
    return RING_MIN_RADIUS + (outerTarget - RING_MIN_RADIUS) * t;
  });
  for (let i = 1; i < n; i += 1) {
    radii[i] = Math.max(radii[i], radii[i - 1] + RING_MIN_GAP);
  }
  return radii;
}

function planetTileSize(cls) {
  if (cls === "Belt") return 0;
  if (isGasGiantClass(cls)) return 4.2 * GRID;
  if (["M", "L", "O", "P", "N", "H", "K", "E", "F", "G", "Q", "Y"].includes(cls)) return 2.8 * GRID;
  return 1.8 * GRID;
}

// Primary star at center, companions offset around it, shrinking with count.
const STAR_LAYOUTS = {
  1: [{ dx: 0, dy: 0, size: 10 * GRID }],
  2: [
    { dx: -1.2 * GRID, dy: 0.8 * GRID, size: 9 * GRID },
    { dx: 4.4 * GRID, dy: -3.2 * GRID, size: 5 * GRID },
  ],
  3: [
    { dx: -1.6 * GRID, dy: 1.0 * GRID, size: 8.4 * GRID },
    { dx: 4.4 * GRID, dy: -3.4 * GRID, size: 4.8 * GRID },
    { dx: 4.8 * GRID, dy: 3.6 * GRID, size: 3.8 * GRID },
  ],
  4: [
    { dx: -1.8 * GRID, dy: 1.2 * GRID, size: 8 * GRID },
    { dx: 4.4 * GRID, dy: -3.6 * GRID, size: 4.6 * GRID },
    { dx: 5.0 * GRID, dy: 3.8 * GRID, size: 3.6 * GRID },
    { dx: -4.6 * GRID, dy: -4.0 * GRID, size: 3.2 * GRID },
  ],
};

function starTypeKeyOf(star) {
  const text = String(star?.spectralType || star?.classification || "").trim();
  if (/white\s+dwarf/i.test(text)) return "White Dwarf";
  if (/t-?tauri/i.test(text)) return "T-Tauri";
  const match = text.match(/^[A-Z]/i);
  return match ? match[0].toUpperCase() : "G";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Create (or replace) the scene map for a star system actor. GM only.
 * @param {Actor} actor  a star-system actor
 * @returns {Promise<Scene|null>}
 */
export async function createStarSystemMapScene(actor) {
  if (!game.user?.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can create star system scenes.");
    return null;
  }
  if (!actor) return null;
  const data = ensureOrbitalDistances(getStarSystemData(actor));
  if (!data?.isStarSystem) {
    ui.notifications.warn("STA2e Toolkit: This actor is not a star system.");
    return null;
  }

  const existing = (game.scenes ?? []).filter(scene => scene.getFlag(MODULE_ID, SCENE_ACTOR_FLAG) === actor.id);
  const choice = await promptSceneOptions(data, existing);
  if (!choice) return null;

  if (choice.replace && existing.length) {
    await Scene.deleteDocuments(existing.map(scene => scene.id));
  }

  const scene = await buildScene(actor, data, choice.background);
  if (!scene) return null;
  ui.notifications.info(`STA2e Toolkit: Scene map "${scene.name}" created.`);
  await scene.view();
  return scene;
}

async function promptSceneOptions(data, existingScenes) {
  const backgrounds = getStarSystemBackgrounds();
  const backgroundRows = [
    `<label class="sta2e-ss-scene-bg-option">
       <input type="radio" name="background" value="__random" checked />
       <span class="sta2e-ss-scene-bg-random"><i class="fas fa-dice"></i></span>
       <span>Random${backgrounds.length ? "" : " (no backgrounds configured — plain starfield)"}</span>
     </label>`,
    ...backgrounds.map(path => `
      <label class="sta2e-ss-scene-bg-option">
        <input type="radio" name="background" value="${escapeHtml(path)}" />
        <img src="${escapeHtml(path)}" alt="" />
        <span>${escapeHtml(path.split("/").pop() ?? path)}</span>
      </label>`),
  ].join("");

  const replaceSection = existingScenes.length ? `
    <hr />
    <p>A scene map for this system already exists (<strong>${escapeHtml(existingScenes[0].name)}</strong>).</p>
    <label class="sta2e-ss-scene-bg-option"><input type="radio" name="mode" value="replace" checked /><span>Replace the existing scene</span></label>
    <label class="sta2e-ss-scene-bg-option"><input type="radio" name="mode" value="new" /><span>Create an additional scene</span></label>` : "";

  const content = `
    <form class="sta2e-ss-scene-dialog">
      <p>Create a scene map for <strong>${escapeHtml(data.designation || "this system")}</strong>
      with ${data.worlds.length} orbital bod${data.worlds.length === 1 ? "y" : "ies"}.</p>
      <h4>Background</h4>
      <div class="sta2e-ss-scene-bg-list">${backgroundRows}</div>
      ${replaceSection}
    </form>`;

  let result = null;
  const outcome = await foundry.applications.api.DialogV2.wait({
    window: { title: "Create Star System Scene" },
    position: { width: 480 },
    content,
    buttons: [
      {
        action: "create",
        label: "Create Scene",
        icon: "fas fa-map",
        default: true,
        callback: (_event, _button, dialog) => {
          const root = dialog.element;
          const background = root.querySelector('input[name="background"]:checked')?.value ?? "__random";
          const mode = root.querySelector('input[name="mode"]:checked')?.value ?? "replace";
          result = {
            background: background === "__random" ? (backgrounds.length ? backgrounds[Math.floor(Math.random() * backgrounds.length)] : "") : background,
            replace: existingScenes.length > 0 && mode === "replace",
          };
          return "create";
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  });
  return outcome === "create" ? result : null;
}

async function buildScene(actor, data, background) {
  // Order worlds by orbital distance — AU is the measurement basis for the map.
  const worlds = data.worlds
    .map((world, index) => ({ world, au: auNumber(world) ?? (index + 1) }))
    .sort((a, b) => a.au - b.au);
  const radii = computeRingRadii(worlds.map(entry => entry.au));

  const outermost = radii.length ? radii[radii.length - 1] : RING_MIN_RADIUS;
  const size = Math.round(Math.min(Math.max((outermost + SCENE_MARGIN) * 2, SCENE_MIN_SIZE), SCENE_MAX_SIZE));
  const cx = size / 2;
  const cy = size / 2;

  const sceneData = {
    name: data.designation || actor.name || "Star System",
    width: size,
    height: size,
    padding: 0,
    grid: { type: CONST.GRID_TYPES.GRIDLESS, size: GRID, distance: 1, units: "" },
    tokenVision: false,
    fog: { exploration: false },
    environment: { globalLight: { enabled: true } },
    flags: { [MODULE_ID]: { [SCENE_ACTOR_FLAG]: actor.id, starSystemGeneratedAt: Date.now() } },
  };
  // Foundry v14 moved the background image/color into the scene's levels
  // collection; the legacy top-level fields are silently ignored on create.
  if ((game.release?.generation ?? 13) >= 14) {
    sceneData.levels = [{
      _id: "defaultLevel0000",
      name: "Level",
      background: { color: "#000000", src: background || null },
    }];
  } else {
    sceneData.backgroundColor = "#000000";
    if (background) sceneData.background = { src: background };
  }

  const scene = await Scene.create(sceneData);
  if (!scene) return null;

  const tiles = [];
  const drawings = [];

  // ── Stars at the center ──────────────────────────────────────────────────
  const stars = data.stars.length ? data.stars : [{ role: "Primary", spectralType: "G", classification: data.primaryStar }];
  const layout = STAR_LAYOUTS[Math.min(stars.length, 4)] ?? STAR_LAYOUTS[1];
  stars.slice(0, 4).forEach((star, i) => {
    const spot = layout[i];
    const src = String(star.image ?? "").trim() || pickStarSystemImage("star", starTypeKeyOf(star));
    const label = star.classification || data.primaryStar || "Star";
    if (src) {
      tiles.push(tileData({
        src,
        cx: cx + spot.dx,
        cy: cy + spot.dy,
        size: spot.size,
        sort: 100 + i,
        name: `${displayName({ name: data.designation }, "System")} — ${label}`,
        kind: "star",
        type: label,
      }));
    } else {
      drawings.push({
        x: Math.round(cx + spot.dx - spot.size / 2),
        y: Math.round(cy + spot.dy - spot.size / 2),
        shape: { type: "e", width: Math.round(spot.size), height: Math.round(spot.size) },
        fillType: CONST.DRAWING_FILL_TYPES.SOLID,
        fillColor: "#ffcc66",
        fillAlpha: 0.9,
        strokeWidth: 0,
        flags: bodyFlag(label, "star", label),
      });
    }
  });

  // ── Orbit rings, planets, belts, moons ───────────────────────────────────
  worlds.forEach((entry, i) => {
    const world = entry.world;
    const radius = radii[i];
    const cls = worldClassOf(world.type);
    const isBelt = cls === "Belt";
    const name = displayName(world, `Orbit ${world.orbit || i + 1}`);

    // Orbit ring
    drawings.push({
      x: Math.round(cx - radius),
      y: Math.round(cy - radius),
      shape: { type: "e", width: Math.round(radius * 2), height: Math.round(radius * 2) },
      fillType: CONST.DRAWING_FILL_TYPES.NONE,
      strokeColor: isBelt ? "#aa9977" : "#5599cc",
      strokeAlpha: isBelt ? 0.5 : 0.35,
      strokeWidth: isBelt ? 24 : 8,
    });

    // AU label at the top of the ring
    drawings.push({
      x: Math.round(cx - 300),
      y: Math.round(cy - radius - 90),
      shape: { type: "r", width: 600, height: 80 },
      fillType: CONST.DRAWING_FILL_TYPES.NONE,
      strokeWidth: 0,
      text: `${world.orbit || i + 1} — ${entry.au} AU`,
      fontSize: 56,
      textColor: "#88bbee",
      textAlpha: 0.85,
    });

    if (isBelt) {
      const rocks = 24;
      for (let k = 0; k < rocks; k += 1) {
        const angle = (k / rocks) * Math.PI * 2 + Math.random() * 0.2;
        const r = radius + (Math.random() * 2 - 1) * 120;
        const src = String(world.image ?? "").trim() || pickStarSystemImage("planet", "Belt");
        if (!src) break;
        tiles.push(tileData({
          src,
          cx: cx + Math.cos(angle) * r,
          cy: cy + Math.sin(angle) * r,
          size: 55 + Math.random() * 50,
          sort: 150,
          name: `${name} (asteroid belt)`,
          kind: "belt",
          type: world.type,
        }));
      }
      return;
    }

    const angle = Math.random() * Math.PI * 2;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    const psize = planetTileSize(cls);
    const src = String(world.image ?? "").trim() || pickStarSystemImage("planet", cls);
    if (src) {
      tiles.push(tileData({
        src,
        cx: px,
        cy: py,
        size: psize,
        sort: 200,
        name,
        kind: "planet",
        type: world.type,
      }));
    } else {
      drawings.push({
        x: Math.round(px - psize / 2),
        y: Math.round(py - psize / 2),
        shape: { type: "e", width: Math.round(psize), height: Math.round(psize) },
        fillType: CONST.DRAWING_FILL_TYPES.SOLID,
        fillColor: "#8899aa",
        fillAlpha: 0.9,
        strokeWidth: 0,
        flags: bodyFlag(name, "planet", world.type),
      });
    }

    // Moons fan out from the planet, away from the star.
    const moons = Array.isArray(world.moonRecords) ? world.moonRecords : [];
    moons.forEach((moon, k) => {
      const moonAngle = angle + (k - (moons.length - 1) / 2) * 0.45;
      const moonRadius = psize / 2 + 90 + k * 30;
      const moonSrc = String(moon.image ?? "").trim() || pickStarSystemImage("planet", worldClassOf(moon.type));
      if (!moonSrc) return;
      tiles.push(tileData({
        src: moonSrc,
        cx: px + Math.cos(moonAngle) * moonRadius,
        cy: py + Math.sin(moonAngle) * moonRadius,
        size: 80,
        sort: 300,
        name: displayName(moon, `${name} moon`),
        kind: "moon",
        type: moon.type,
      }));
    });
  });

  if (tiles.length) await scene.createEmbeddedDocuments("Tile", tiles);
  if (drawings.length) await scene.createEmbeddedDocuments("Drawing", drawings);

  await setSceneZones(buildOrbitZones(worlds, radii, cx, cy), scene);
  return scene;
}

/**
 * One toolkit zone per orbit: a central disc around the star, then annulus
 * bands whose boundaries sit midway between adjacent rings. Consecutive bands
 * share their boundary circle vertices so zone adjacency (and therefore BFS
 * zone distance = orbit separation) works out of the box.
 */
function buildOrbitZones(worlds, radii, cx, cy) {
  const zones = [];
  const boundaries = [];
  for (let i = 0; i < radii.length; i += 1) {
    boundaries.push(i === 0 ? radii[0] / 2 : (radii[i - 1] + radii[i]) / 2);
  }
  if (radii.length) {
    const lastGap = radii.length > 1 ? (radii[radii.length - 1] - boundaries[boundaries.length - 1]) : RING_MIN_GAP / 2;
    boundaries.push(radii[radii.length - 1] + lastGap);
  } else {
    boundaries.push(RING_MIN_RADIUS);
  }

  // Boundary circles are shared between consecutive zones so adjacency sees
  // identical vertices.
  const circles = boundaries.map(radius => circleVertices(cx, cy, radius));

  zones.push({
    id: foundry.utils.randomID(),
    name: "Inner System",
    vertices: circles[0],
    color: ZONE_COLORS[0],
    momentumCost: 0,
    tags: ["star-system"],
    sort: 0,
    borderStyle: "solid",
    isDifficult: false,
    opacity: 0.08,
    hazards: [],
  });

  worlds.forEach((entry, i) => {
    const name = displayName(entry.world, `Orbit ${entry.world.orbit || i + 1}`);
    zones.push({
      id: foundry.utils.randomID(),
      name: worldClassOf(entry.world.type) === "Belt" ? `${name} belt` : `${name} orbit`,
      vertices: [...circles[i + 1], ...[...circles[i]].reverse()],
      color: ZONE_COLORS[(i + 1) % ZONE_COLORS.length],
      momentumCost: 0,
      tags: ["star-system"],
      sort: i + 1,
      borderStyle: "solid",
      isDifficult: false,
      opacity: 0.08,
      hazards: [],
    });
  });

  return zones;
}

// ═══════════════════════════════════════════════════════════════════════════
// Hover tooltip — body names on system-map tiles, for every user
// ═══════════════════════════════════════════════════════════════════════════

let _tooltipEl = null;
let _hoverHandler = null;
let _leaveHandler = null;
let _hoverBoard = null;

function _getBoard() {
  return canvas?.app?.view ?? canvas?.app?.canvas ?? null;
}

function _ensureTooltip() {
  if (_tooltipEl?.isConnected) return _tooltipEl;
  _tooltipEl = document.createElement("div");
  _tooltipEl.className = "sta2e-ss-map-tooltip";
  _tooltipEl.hidden = true;
  document.body.appendChild(_tooltipEl);
  return _tooltipEl;
}

function _hideTooltip() {
  if (_tooltipEl) _tooltipEl.hidden = true;
}

function _teardownHover() {
  if (_hoverBoard && _hoverHandler) _hoverBoard.removeEventListener("pointermove", _hoverHandler);
  if (_hoverBoard && _leaveHandler) _hoverBoard.removeEventListener("pointerleave", _leaveHandler);
  _hoverHandler = null;
  _leaveHandler = null;
  _hoverBoard = null;
  _hideTooltip();
}

function _bodyTileAt(x, y) {
  const centered = (game.release?.generation ?? 13) >= 14;
  let best = null;
  let bestArea = Infinity;
  for (const tile of canvas?.scene?.tiles ?? []) {
    const body = tile.getFlag(MODULE_ID, BODY_FLAG);
    if (!body?.name) continue;
    const left = centered ? tile.x - tile.width / 2 : tile.x;
    const top = centered ? tile.y - tile.height / 2 : tile.y;
    if (x < left || y < top || x > left + tile.width || y > top + tile.height) continue;
    const area = tile.width * tile.height;
    if (area < bestArea) {
      best = body;
      bestArea = area;
    }
  }
  return best;
}

function _setupHover() {
  _teardownHover();
  if (!canvas?.scene?.getFlag(MODULE_ID, SCENE_ACTOR_FLAG)) return;
  const board = _getBoard();
  if (!board) return;

  let last = 0;
  _hoverHandler = event => {
    const now = performance.now();
    if (now - last < 60) return;
    last = now;
    // Derive canvas coordinates from the event itself — canvas.mousePosition
    // can lag behind the DOM event stream.
    let pos;
    if (typeof canvas.canvasCoordinatesFromClient === "function") {
      pos = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    } else {
      const rect = board.getBoundingClientRect();
      pos = canvas.stage.worldTransform.applyInverse({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    if (!pos) return;
    const body = _bodyTileAt(pos.x, pos.y);
    const el = _ensureTooltip();
    if (!body) {
      el.hidden = true;
      return;
    }
    el.textContent = body.name;
    el.hidden = false;
    el.style.left = `${event.clientX + 14}px`;
    el.style.top = `${event.clientY + 12}px`;
  };
  _leaveHandler = () => _hideTooltip();
  board.addEventListener("pointermove", _hoverHandler);
  board.addEventListener("pointerleave", _leaveHandler);
  _hoverBoard = board;
}

/** Register canvas hooks for the system-map hover tooltip. Call once at init. */
export function registerStarSystemMapHover() {
  Hooks.on("canvasReady", () => _setupHover());
  Hooks.on("canvasTearDown", () => _teardownHover());
}
