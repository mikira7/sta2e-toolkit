/**
 * sta2e-toolkit | star-system-scene.js
 * Builds a playable Foundry scene from a Star System actor: star and planet
 * tiles, orbit-ring drawings labeled in AU, moon clusters, and asteroid belts.
 * Also provides the hover tooltip that shows a body's
 * name to any user mousing over a system-map tile.
 */

import { getStarSystemData, ensureOrbitalDistances } from "./star-system-sheet.js";
import { pickStarSystemImage, getStarSystemBackgrounds } from "./star-system-images.js";

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

function tileData({ src, cx, cy, size, sort, name, kind, type, rotation = 0 }) {
  // Foundry v14 tiles anchor at their center (shape.anchor 0.5), so x/y is the
  // center point; v13 and earlier position tiles by their top-left corner.
  const centered = (game.release?.generation ?? 13) >= 14;
  return {
    texture: { src },
    x: Math.round(centered ? cx : cx - size / 2),
    y: Math.round(centered ? cy : cy - size / 2),
    width: Math.round(size),
    height: Math.round(size),
    rotation,
    sort,
    flags: bodyFlag(name, kind, type),
  };
}

function shadowRotationAwayFrom(cx, cy, bodyX, bodyY) {
  const angle = Math.atan2(bodyY - cy, bodyX - cx) * 180 / Math.PI;
  return Math.round(angle - 90);
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

const ROOT_ORBITAL_NODE_ID = "root";

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

function stellarOrbitRadiusPx(au) {
  const value = Number(au);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1) return 260 + value * 360;
  return Math.min(4200, RING_MIN_RADIUS + Math.log(value) * 500);
}

function nodeLabel(node, data) {
  if (!node) return "Primary Star";
  if (node.type === "star") {
    const star = data.stars.find(row => row.id === node.starId);
    return star?.role || star?.classification || node.label || "Star";
  }
  return node.label || "Barycenter";
}

function primaryNodeId(data) {
  return data.orbitalNodes?.find(node => node.type === "star")?.id ?? ROOT_ORBITAL_NODE_ID;
}

function resolveNodePositions(data) {
  const nodes = Array.isArray(data.orbitalNodes) && data.orbitalNodes.length
    ? data.orbitalNodes
    : [{ id: ROOT_ORBITAL_NODE_ID, type: "barycenter", label: "System Barycenter", parentId: "", orbitalAU: 0, angle: 0 }];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const positions = new Map([[ROOT_ORBITAL_NODE_ID, { x: 0, y: 0 }]]);

  const resolve = node => {
    if (!node?.id) return { x: 0, y: 0 };
    if (positions.has(node.id)) return positions.get(node.id);
    const parent = byId.get(node.parentId) ?? byId.get(ROOT_ORBITAL_NODE_ID);
    const parentPos = parent && parent.id !== node.id ? resolve(parent) : { x: 0, y: 0 };
    const radius = stellarOrbitRadiusPx(node.orbitalAU);
    const angle = (Number(node.angle) || 0) * Math.PI / 180;
    const pos = {
      x: parentPos.x + Math.cos(angle) * radius,
      y: parentPos.y + Math.sin(angle) * radius,
    };
    positions.set(node.id, pos);
    return pos;
  };

  nodes.forEach(resolve);
  return { nodes, byId, positions };
}

function starTileSize(star, node) {
  if (!star) return 5 * GRID;
  if (/primary/i.test(String(star.role ?? "")) && Number(node?.orbitalAU) <= 0) return 10 * GRID;
  return ["O", "B", "A"].includes(starTypeKeyOf(star)) ? 6 * GRID : 5 * GRID;
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
  const { nodes, byId, positions } = resolveNodePositions(data);
  const fallbackParentId = primaryNodeId(data);
  const worldGroups = new Map();
  data.worlds.forEach((world, index) => {
    const parentId = byId.has(world.orbitParentNodeId) ? world.orbitParentNodeId : fallbackParentId;
    if (!worldGroups.has(parentId)) worldGroups.set(parentId, []);
    worldGroups.get(parentId).push({ world, au: auNumber(world) ?? (index + 1), originalIndex: index });
  });

  const worldLayouts = [];
  for (const [parentId, entries] of worldGroups.entries()) {
    const ordered = entries.sort((a, b) => a.au - b.au);
    const radii = computeRingRadii(ordered.map(entry => entry.au));
    ordered.forEach((entry, index) => {
      worldLayouts.push({
        ...entry,
        parentId,
        radius: radii[index],
        angle: Math.random() * Math.PI * 2,
      });
    });
  }

  const bounds = { minX: -GRID, minY: -GRID, maxX: GRID, maxY: GRID };
  const includeBounds = (x, y, pad = 0) => {
    bounds.minX = Math.min(bounds.minX, x - pad);
    bounds.maxX = Math.max(bounds.maxX, x + pad);
    bounds.minY = Math.min(bounds.minY, y - pad);
    bounds.maxY = Math.max(bounds.maxY, y + pad);
  };

  for (const node of nodes) {
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    const star = node.type === "star" ? data.stars.find(row => row.id === node.starId) : null;
    includeBounds(pos.x, pos.y, node.type === "star" ? starTileSize(star, node) / 2 : GRID);
  }
  for (const layout of worldLayouts) {
    const parentPos = positions.get(layout.parentId) ?? { x: 0, y: 0 };
    includeBounds(parentPos.x, parentPos.y, layout.radius + planetTileSize(worldClassOf(layout.world.type)) + 250);
  }

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const size = Math.round(Math.min(Math.max(Math.max(width, height) + SCENE_MARGIN * 2, SCENE_MIN_SIZE), SCENE_MAX_SIZE));
  const offsetX = size / 2 - (bounds.minX + bounds.maxX) / 2;
  const offsetY = size / 2 - (bounds.minY + bounds.maxY) / 2;

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

  // ── Stars at their hierarchy positions ───────────────────────────────────
  nodes.filter(node => node.type === "star").forEach((node, i) => {
    const star = data.stars.find(row => row.id === node.starId) ?? { role: node.label, spectralType: "G", classification: node.label };
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    const src = String(star.image ?? "").trim() || pickStarSystemImage("star", starTypeKeyOf(star));
    const label = star.classification || data.primaryStar || "Star";
    const size = starTileSize(star, node);
    const sx = pos.x + offsetX;
    const sy = pos.y + offsetY;
    if (src) {
      tiles.push(tileData({
        src,
        cx: sx,
        cy: sy,
        size,
        sort: 100 + i,
        name: `${displayName({ name: data.designation }, "System")} - ${nodeLabel(node, data)} - ${label}`,
        kind: "star",
        type: label,
      }));
    } else {
      drawings.push({
        x: Math.round(sx - size / 2),
        y: Math.round(sy - size / 2),
        shape: { type: "e", width: Math.round(size), height: Math.round(size) },
        fillType: CONST.DRAWING_FILL_TYPES.SOLID,
        fillColor: "#ffcc66",
        fillAlpha: 0.9,
        strokeWidth: 0,
        flags: bodyFlag(label, "star", label),
      });
    }
  });

  // ── Local orbit rings, planets, belts, moons ─────────────────────────────
  worldLayouts.forEach((entry, i) => {
    const world = entry.world;
    const radius = entry.radius;
    const parentPos = positions.get(entry.parentId) ?? { x: 0, y: 0 };
    const pcx = parentPos.x + offsetX;
    const pcy = parentPos.y + offsetY;
    const cls = worldClassOf(world.type);
    const isBelt = cls === "Belt";
    const name = displayName(world, `Orbit ${world.orbit || i + 1}`);
    const parentLabel = nodeLabel(byId.get(entry.parentId), data);

    // Orbit ring
    drawings.push({
      x: Math.round(pcx - radius),
      y: Math.round(pcy - radius),
      shape: { type: "e", width: Math.round(radius * 2), height: Math.round(radius * 2) },
      fillType: CONST.DRAWING_FILL_TYPES.NONE,
      strokeColor: isBelt ? "#aa9977" : "#5599cc",
      strokeAlpha: isBelt ? 0.5 : 0.35,
      strokeWidth: isBelt ? 24 : 8,
    });

    // AU label at the top of the ring
    drawings.push({
      x: Math.round(pcx - 360),
      y: Math.round(pcy - radius - 90),
      shape: { type: "r", width: 600, height: 80 },
      fillType: CONST.DRAWING_FILL_TYPES.NONE,
      strokeWidth: 0,
      text: `${world.orbit || i + 1} - ${entry.au} AU - ${parentLabel}`,
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
          cx: pcx + Math.cos(angle) * r,
          cy: pcy + Math.sin(angle) * r,
          size: 55 + Math.random() * 50,
          sort: 150,
          name: `${name} (asteroid belt)`,
          kind: "belt",
          type: world.type,
        }));
      }
      return;
    }

    const angle = entry.angle;
    const px = pcx + Math.cos(angle) * radius;
    const py = pcy + Math.sin(angle) * radius;
    const psize = planetTileSize(cls);
    const src = String(world.image ?? "").trim() || pickStarSystemImage("planet", cls);
    const rotation = shadowRotationAwayFrom(pcx, pcy, px, py);
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
        rotation,
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
      const mx = px + Math.cos(moonAngle) * moonRadius;
      const my = py + Math.sin(moonAngle) * moonRadius;
      const lightPos = positions.get(moon.orbitParentNodeId) ?? parentPos;
      const lightX = lightPos.x + offsetX;
      const lightY = lightPos.y + offsetY;
      const moonSrc = String(moon.image ?? "").trim() || pickStarSystemImage("planet", worldClassOf(moon.type));
      if (!moonSrc) return;
      tiles.push(tileData({
        src: moonSrc,
        cx: mx,
        cy: my,
        size: 80,
        sort: 300,
        name: displayName(moon, `${name} moon`),
        kind: "moon",
        type: moon.type,
        rotation: shadowRotationAwayFrom(lightX, lightY, mx, my),
      }));
    });
  });

  if (tiles.length) await scene.createEmbeddedDocuments("Tile", tiles);
  if (drawings.length) await scene.createEmbeddedDocuments("Drawing", drawings);

  return scene;
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
