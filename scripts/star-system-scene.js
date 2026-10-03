/**
 * sta2e-toolkit | star-system-scene.js
 * Builds a playable Foundry scene from a Star System actor: star and planet
 * tiles, orbit-ring drawings labeled in AU, moon clusters, and asteroid belts.
 * Also provides the hover tooltip that shows a body's
 * name to any user mousing over a system-map tile.
 */

import { getStarSystemData, ensureOrbitalDistances, STAR_SYSTEM_FLAG } from "./star-system-sheet.js";
import { pickStarSystemImage, getStarSystemBackgrounds, starTypeKey } from "./star-system-images.js";
import { NEBULA_PALETTES, STARFIELD_FLAG, getSavedStarfieldBackgrounds, normalizeStarfieldRecipe, saveStarfieldBackground } from "./star-system-background.js";
import { normalizePlanetRecipe, ringVisibleExtent, saveProceduralPlanetImage, saveProceduralViewCrop, planetSeedHash, isProceduralPlanet, proceduralSceneImageIsCurrent, planetSceneImage, planetSceneRingFront, planetSceneBodyScale } from "./planet-generator.js";

const MODULE_ID = "sta2e-toolkit";
export const SCENE_ACTOR_FLAG = "starSystemSceneActor";
export const SCENE_WORLD_FLAG = "starSystemSceneWorld";
export const SCENE_LAYOUT_FLAG = "starSystemSceneLayout";
export const SCENE_HOVER_NAMES_FLAG = "starSystemHoverNames";
const BODY_FLAG = "systemBody";

// Layout constants (pixels). The scene is gridless with a 100px grid size.
const GRID = 100;
const RING_MIN_RADIUS = 900;
const RING_MIN_GAP = 450;
const SCENE_MARGIN = 900;
const SCENE_MIN_SIZE = 3000;
const SCENE_MAX_SIZE = 30000;
const AU_RADIUS_PER_DECADE = 1800;
const AU_SPAN_RADIUS_PER_DECADE = 1500;
const BODY_WALL_SEGMENTS = 16;
const STAR_WALL_RADIUS_SCALE = 0.75;
const PLANET_WALL_RADIUS_SCALE = 0.9;
const BODY_CLEARANCE = 50;
const MOON_TILE_SIZE = 80;
const MOON_BODY_GAP = 60;
const MOON_SEPARATION = 30;
const PLACEMENT_ATTEMPTS = 48;

// ── Planetary rings in 2.5D ─────────────────────────────────────────────────
// A ringed procedural body is two tiles: the globe plus the far ring arc at
// ground level, and the near arc raised above ship tokens. canvas.primary sorts
// by elevation before anything else, so 10 draws over a token at 0-9 and under
// one flying higher — which reads correctly as passing over the ring plane.
// It also sits inside the default v14 level (0-20).
const RING_FRONT_ELEVATION = 10;
// The outer ring radius is 0.48 of the tile in planet-generator's units. Where
// the material shows within it comes from ringVisibleExtent; these are the
// material's own limits, used only if that cannot be measured.
const RING_OUTER_FRACTION = 0.48;
const RING_FALLBACK_EXTENT = Object.freeze({ inner: 0.61, outer: 1 });
const RING_MIN_HALF_THICKNESS = 24;
export const RING_REGION_FLAG = "planetRing";
// region-terrain.js owns these ids; spelled out rather than imported so this
// module, and the node tests that load it, stay out of the zone graph.
const TERRAIN_BEHAVIOR_TYPE = `${MODULE_ID}.difficultTerrain`;
const SHROUD_BEHAVIOR_TYPE = `${MODULE_ID}.sensorShroud`;

export const PLANET_SCENE_LAYOUTS = Object.freeze({
  encounter: "Encounter — open space for ships",
  highOrbit: "High orbit — moon approach",
  lowOrbit: "Low orbit — skimming the atmosphere",
  ringPlane: "Ring plane — flying through the rings",
  overview: "Overview — planet and moon system",
});

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

function tileData({ src, cx, cy, size, width = size, height = size, sort, name, kind, type, rotation = 0 }) {
  // Foundry v14 tiles anchor at their center (shape.anchor 0.5), so x/y is the
  // center point; v13 and earlier position tiles by their top-left corner.
  const centered = (game.release?.generation ?? 13) >= 14;
  return {
    texture: { src },
    x: Math.round(centered ? cx : cx - width / 2),
    y: Math.round(centered ? cy : cy - height / 2),
    width: Math.round(width),
    height: Math.round(height),
    rotation,
    sort,
    flags: bodyFlag(name, kind, type),
  };
}

/**
 * A terrain wall loop prevents tokens from entering a stellar body while still
 * allowing the partially-transparent line-of-sight behavior Foundry gives
 * terrain walls. Use the runtime constants so this stays compatible with the
 * Foundry version hosting the module.
 */
function terrainWallLoop({ cx, cy, radius, name, kind, type, from = 0, to = Math.PI * 2, segments = BODY_WALL_SEGMENTS }) {
  const normal = CONST.WALL_MOVEMENT_TYPES?.NORMAL ?? 1;
  // In Foundry v14 movement uses WALL_MOVEMENT_TYPES, while light/sight/sound
  // retain the Wall Sense values (Limited is 10, not restriction enum value 2).
  const limited = CONST.WALL_SENSE_TYPES?.LIMITED ?? 10;
  const walls = [];
  // `from`/`to` bound an open arc, for a limb far larger than the scene.
  for (let index = 0; index < segments; index += 1) {
    const start = from + (index / segments) * (to - from);
    const end = from + ((index + 1) / segments) * (to - from);
    walls.push({
      c: [
        Math.round(cx + Math.cos(start) * radius),
        Math.round(cy + Math.sin(start) * radius),
        Math.round(cx + Math.cos(end) * radius),
        Math.round(cy + Math.sin(end) * radius),
      ],
      move: normal,
      sight: limited,
      light: limited,
      sound: limited,
      flags: bodyFlag(name, kind, type),
    });
  }
  return walls;
}

/** The normalized procedural recipe of a ringed body, or null. */
function ringedRecipe(body) {
  if (!isProceduralPlanet(body)) return null;
  try {
    const recipe = normalizePlanetRecipe(body.procedural, body);
    return recipe.rings ? recipe : null;
  } catch { return null; }
}

/**
 * A Region over a ring annulus: an outer ellipse with the inner one cut out as
 * a hole, squashed by the axial tilt exactly as the renderer projects it, and
 * turned with the tile. It makes the rings Difficult Terrain and a light
 * Sensor Shroud, and its flag is what the dust wake looks for.
 */
export function ringRegionData({ cx, cy, outerRadius, aspect = 1, rotation = 0, name, recipe, terrain = true }) {
  // Fit the annulus to the band that actually reads, not the material's limits.
  let extent = RING_FALLBACK_EXTENT;
  try { extent = ringVisibleExtent(recipe) ?? RING_FALLBACK_EXTENT; } catch { /* keep the fallback */ }
  const rx = outerRadius * extent.outer;
  const ry = Math.max(rx * Math.abs(aspect), RING_MIN_HALF_THICKNESS);
  const innerScale = extent.inner / extent.outer;
  const ellipse = (scale, hole) => ({
    type: "ellipse", x: Math.round(cx), y: Math.round(cy),
    radiusX: Math.round(rx * scale), radiusY: Math.round(Math.max(ry * scale, RING_MIN_HALF_THICKNESS / 2)),
    rotation, hole,
  });
  const label = `${name} Rings`;
  return {
    name: label,
    color: recipe.ringColor,
    shapes: [ellipse(1, false), ellipse(innerScale, true)],
    behaviors: terrain ? [
      { name: "Ring Debris", type: TERRAIN_BEHAVIOR_TYPE, system: { label, momentumCost: 1 } },
      { name: "Ring Interference", type: SHROUD_BEHAVIOR_TYPE,
        system: { label, potency: 1, hideTokens: false, affectSensors: true, affectAttacks: true } },
    ] : [],
    flags: { [MODULE_ID]: { [RING_REGION_FLAG]: { body: name, color: recipe.ringColor, style: recipe.ringStyle } } },
  };
}

/**
 * Place a planet-like body: its tile (or a placeholder disc), its wall loop,
 * and — for a ringed procedural body — the raised near-ring tile and the ring
 * Region. Returns the art used, or "" when a placeholder was drawn.
 */
function placeBody(bag, body, { cx, cy, size, sort, name, kind, rotation = 0, fallbackSrc = "", walls = true, ringTerrain = true, placeholderAlpha = 1 }) {
  const src = planetSceneImage(body) || fallbackSrc;
  if (src) bag.tiles.push(tileData({ src, cx, cy, size, sort, name, kind, type: body.type, rotation }));
  else bag.drawings.push({
    x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), shape: { type: "e", width: Math.round(size), height: Math.round(size) },
    fillType: CONST.DRAWING_FILL_TYPES.SOLID, fillColor: "#8899aa", fillAlpha: placeholderAlpha, strokeWidth: 0,
    flags: bodyFlag(name, kind, body.type),
  });
  if (walls) bag.walls.push(...terrainWallLoop({ cx, cy, radius: size / 2 * PLANET_WALL_RADIUS_SCALE * (src ? planetSceneBodyScale(body) : 1), name, kind, type: body.type }));
  const recipe = src ? ringedRecipe(body) : null;
  if (!recipe) return src;
  const front = planetSceneRingFront(body);
  if (front) {
    const tile = tileData({ src: front, cx, cy, size, sort, name, kind, type: body.type, rotation });
    tile.elevation = RING_FRONT_ELEVATION;
    tile.flags[MODULE_ID].planetRingFront = true;
    bag.tiles.push(tile);
  }
  bag.regions.push(ringRegionData({
    cx, cy, rotation, name, recipe, terrain: ringTerrain,
    outerRadius: size * RING_OUTER_FRACTION,
    aspect: Math.cos(recipe.axialTilt * Math.PI / 180),
  }));
  return src;
}

async function createSceneWithEmbedded(sceneData, bag, options = {}) {
  if (options.proceduralBackground) {
    const art = await saveStarfieldBackground(options.proceduralBackground, sceneData.width, sceneData.height);
    if ((game.release?.generation ?? 13) >= 14) sceneData.levels[0].background.src = art.src;
    else sceneData.background = { src: art.src };
    sceneData.flags[MODULE_ID][STARFIELD_FLAG] = art.recipe;
  } else if (options.savedBackgroundRecipe) {
    sceneData.flags[MODULE_ID][STARFIELD_FLAG] = options.savedBackgroundRecipe;
  }
  sceneData.flags[MODULE_ID][SCENE_HOVER_NAMES_FLAG] = options.hoverNames ?? (sceneData.flags[MODULE_ID][SCENE_LAYOUT_FLAG] !== "lowOrbit");
  const scene = await Scene.create(sceneData);
  if (!scene) return null;
  try {
    if (bag.tiles.length) await scene.createEmbeddedDocuments("Tile", bag.tiles);
    if (bag.drawings.length) await scene.createEmbeddedDocuments("Drawing", bag.drawings);
    if (bag.walls.length) await scene.createEmbeddedDocuments("Wall", bag.walls);
    if (bag.regions?.length) await scene.createEmbeddedDocuments("Region", bag.regions);
    return scene;
  } catch (error) {
    await scene.delete();
    throw error;
  }
}

/** Shared scene document for the fixed-size planet layouts. */
function planetSceneData(actor, data, world, layout, title, background, width = 6000, height = 4000) {
  const sceneData = {
    name: `${data.designation || actor.name} — ${displayName(world)} ${title}`, width, height, padding: 0,
    grid: { type: CONST.GRID_TYPES.GRIDLESS, size: GRID, distance: 1, units: "" },
    tokenVision: true, fog: { exploration: false }, environment: { globalLight: { enabled: true } },
    flags: { [MODULE_ID]: { [SCENE_ACTOR_FLAG]: actor.id, [SCENE_WORLD_FLAG]: world.id,
      [SCENE_LAYOUT_FLAG]: layout, starSystemGeneratedAt: Date.now() } },
  };
  if ((game.release?.generation ?? 13) >= 14) {
    sceneData.levels = [{ _id: "defaultLevel0000", name: "Level", background: { color: "#000000", src: background || null } }];
  } else {
    sceneData.backgroundColor = "#000000";
    if (background) sceneData.background = { src: background };
  }
  return sceneData;
}

/**
 * Pick a point on an orbital circle that does not overlap an occupied body.
 * The initial angle is tried first, then a deterministic spread of candidates
 * is scored by clearance so generated maps stay readable even in multi-star
 * systems whose local orbital centers are close together.
 */
function findClearOrbitalPosition({ cx, cy, orbitRadius, bodyRadius, preferredAngle, occupied = [] }) {
  let best = null;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
    const angle = attempt === 0 ? preferredAngle : preferredAngle + attempt * goldenAngle;
    const x = cx + Math.cos(angle) * orbitRadius;
    const y = cy + Math.sin(angle) * orbitRadius;
    const clearance = occupied.reduce((minimum, other) => {
      const distance = Math.hypot(x - other.x, y - other.y);
      return Math.min(minimum, distance - bodyRadius - other.radius - BODY_CLEARANCE);
    }, Infinity);
    const candidate = { x, y, angle, clearance };
    if (clearance >= 0) return candidate;
    if (!best || clearance > best.clearance) best = candidate;
  }
  // Extremely crowded systems may have no fully clear point at this radius;
  // retain the candidate with the largest separation instead of stacking tiles.
  return best ?? { x: cx, y: cy, angle: preferredAngle, clearance: -Infinity };
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
  const min = Math.max(aus[0], 1e-6);
  const max = Math.max(aus[n - 1], min * 1.01);
  const span = Math.log(max / min);
  const absoluteDecades = Math.max(0, Math.log10(max));
  const spanDecades = Math.max(0, Math.log10(max / min));
  const densityTarget = RING_MIN_RADIUS + Math.max(1, n - 1) * RING_MIN_GAP;
  const auTarget = RING_MIN_RADIUS + Math.max(
    absoluteDecades * AU_RADIUS_PER_DECADE,
    spanDecades * AU_SPAN_RADIUS_PER_DECADE,
  );
  const outerTarget = Math.min(Math.max(densityTarget, auTarget), (SCENE_MAX_SIZE / 2) - SCENE_MARGIN);
  if (n === 1) return [outerTarget];
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

// Scene tiles always need art, so unrecognised types fall back to a Type-G sun
// rather than the sheet's empty-string default.
function starTypeKeyOf(star) {
  return starTypeKey(star, { fallback: "G" });
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

  const existing = (game.scenes ?? []).filter(scene => scene.getFlag(MODULE_ID, SCENE_ACTOR_FLAG) === actor.id && !scene.getFlag(MODULE_ID, SCENE_WORLD_FLAG));
  const choice = await promptSceneOptions(data, existing);
  if (!choice) return null;

  await prepareProceduralSceneArt(actor, data, null, choice.artwork);
  const scene = await buildScene(actor, data, choice.background, choice);
  if (!scene) return null;
  if (choice.replace && existing.length) await Scene.deleteDocuments(existing.map(scene => scene.id));
  ui.notifications.info(`STA2e Toolkit: Scene map "${scene.name}" created.`);
  await scene.view();
  return scene;
}

/** Ring Plane is only offered for a ringed body; the rest are always listed. */
function planetLayoutOptions(planet) {
  const ringed = String(planet?.rings ?? "").trim().toLowerCase() === "yes";
  return Object.entries(PLANET_SCENE_LAYOUTS)
    .filter(([key]) => key !== "ringPlane" || ringed)
    .map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join("");
}

async function promptSceneOptions(data, existingScenes, planet = null) {
  const backgrounds = getStarSystemBackgrounds();
  const savedBackgrounds = await getSavedStarfieldBackgrounds();
  const savedRows = savedBackgrounds.map((entry, index) => `
    <label class="sta2e-ss-scene-bg-option">
      <input type="radio" name="background" value="__saved_${index}" />
      <img src="${escapeHtml(entry.src)}" alt="" loading="lazy" />
      <span>${escapeHtml(entry.label)}</span>
    </label>`).join("");
  const backgroundRows = [
    `<label class="sta2e-ss-scene-bg-option">
       <input type="radio" name="background" value="__procedural" checked />
       <span class="sta2e-ss-scene-bg-random"><i class="fas fa-star"></i></span>
       <span>Procedural starfield</span>
     </label>`,
    `<label class="sta2e-ss-scene-bg-option">
       <input type="radio" name="background" value="__random" />
       <span class="sta2e-ss-scene-bg-random"><i class="fas fa-dice"></i></span>
       <span>Random${backgrounds.length ? "" : " (no backgrounds configured — black background)"}</span>
     </label>`,
    `<label class="sta2e-ss-scene-bg-option"><input type="radio" name="background" value="" /><span>Black background</span></label>`,
    ...backgrounds.map(path => `
      <label class="sta2e-ss-scene-bg-option">
        <input type="radio" name="background" value="${escapeHtml(path)}" />
        <img src="${escapeHtml(path)}" alt="" />
        <span>${escapeHtml(path.split("/").pop() ?? path)}</span>
      </label>`),
  ].join("");

  const replaceSection = existingScenes.length ? `
    <hr />
    <p>A scene map for this ${planet ? "planet" : "system"} already exists (<strong>${escapeHtml(existingScenes[0].name)}</strong>).</p>
    <label class="sta2e-ss-scene-bg-option"><input type="radio" name="mode" value="replace" /><span>Replace the existing scene${existingScenes.length > 1 ? "s" : ""} (${existingScenes.length})</span></label>
    <label class="sta2e-ss-scene-bg-option"><input type="radio" name="mode" value="new" checked /><span>Create an additional scene</span></label>` : "";

  const content = `
    <div class="sta2e-ss-scene-dialog">
      <p>Create a scene map for <strong>${escapeHtml(planet?.name || data.designation || "this system")}</strong>
      with ${planet ? `${planet.moonRecords?.length ?? 0} moons. Orbital spacing is schematic, not a distance scale.` : `${data.worlds.length} orbital bodies.`}</p>
      ${planet ? `<label>Layout <select name="layout">${planetLayoutOptions(planet)}</select></label>
      <fieldset><legend>Encounter options</legend>
      <label><input type="checkbox" name="mirror"> Planet on the right</label>
      <label><input type="checkbox" name="moons" checked> Include moons</label>
      <label><input type="checkbox" name="labels"> Show labels</label>
      <label><input type="checkbox" name="orbitRings"> Show orbit rings</label></fieldset>
      ${planet.moonRecords?.length ? `<label>High orbit approach to <select name="focusMoon">${planet.moonRecords.map(moon =>
        `<option value="${escapeHtml(moon.id)}">${escapeHtml(displayName(moon, "Moon"))}</option>`).join("")}</select></label>` : ""}
      <p>Low Orbit and Ring Plane are rendered close up from the planet's procedural recipe, so they need procedural artwork.</p>
      <p>Replacement applies only to scenes of the selected layout. Older planetary scenes count as Overview.</p>` : ""}
      <label><input type="checkbox" name="ringTerrain" checked> Planetary rings are Difficult Terrain and a Sensor Shroud</label>
      <label><input type="checkbox" name="hoverNames" checked> Show body names on hover</label>
      <p>Turn off hover names to keep the cursor clear.${planet ? " Low Orbit defaults to off; printed labels use the separate Show labels option." : ""}</p>
      <label>Body artwork <select name="artwork">
        <option value="missing" selected>Generate procedural art where images are missing</option>
        <option value="all">Generate procedural art for ${planet ? "this planet and its moons" : "all stars, planets, moons, and asteroids"}</option>
        <option value="existing">Use existing images only</option>
      </select></label>
      <p>Procedural planets use a polar view with their saved axial tilt. Missing polar views are prepared automatically; information portraits keep their side view.</p>
      <h4>Background</h4>
      <div class="sta2e-ss-scene-bg-list">${backgroundRows}</div>
      <h4>Saved starfields</h4>
      <p>Generated starfields are saved automatically. Select one below to reuse its image without generating it again. Images fit the new scene's proportions.</p>
      ${savedBackgrounds.length ? `<div class="sta2e-ss-scene-bg-list">${savedRows}</div>` : "<p>No saved starfields yet.</p>"}
      <fieldset data-starfield-options><legend>Procedural starfield</legend>
        <label>Star density <input type="number" name="starDensity" value="100" min="0" max="200" step="10"></label>
        <label><input type="checkbox" name="nebula"> Add nebula</label>
        <div data-nebula-options hidden>
          <label>Nebula colors <select name="nebulaPalette">${Object.entries(NEBULA_PALETTES).map(([key, palette]) => `<option value="${key}">${palette.label}</option>`).join("")}</select></label>
          <label>Nebula strength <input type="number" name="nebulaStrength" value="55" min="0" max="100" step="5"></label>
        </div>
        <label>Seed <input type="text" name="starfieldSeed" maxlength="128" placeholder="Leave blank for a new random field"></label>
        <label>Image size <select name="starfieldResolution"><option value="2048">2048 px</option><option value="4096">4096 px — more detail</option><option value="1024">1024 px — smaller file</option></select></label>
        <p>The longest image edge uses this size. Reuse a seed and settings to recreate a background. Nebulae are decorative.</p>
      </fieldset>
      ${replaceSection}
    </div>`;

  let result = null;
  const outcome = await foundry.applications.api.DialogV2.wait({
    window: { title: planet ? "Create Orbital Scene" : "Create Star System Scene" },
    position: { width: 480 },
    content,
    render: (_event, dialog) => {
      const root = dialog.element;
      const updateBackgroundOptions = () => {
        const procedural = root.querySelector('input[name="background"]:checked')?.value === "__procedural";
        const fieldset = root.querySelector('[data-starfield-options]');
        fieldset.hidden = !procedural;
        fieldset.disabled = !procedural;
        root.querySelector('[data-nebula-options]').hidden = !root.querySelector('[name="nebula"]').checked;
      };
      root.querySelectorAll('input[name="background"], input[name="nebula"]').forEach(input => input.addEventListener("change", updateBackgroundOptions));
      updateBackgroundOptions();
      root.querySelector('[name="layout"]')?.addEventListener("change", event => {
        root.querySelector('[name="hoverNames"]').checked = event.currentTarget.value !== "lowOrbit";
      });
    },
    buttons: [
      {
        action: "create",
        label: "Create Scene",
        icon: "fas fa-map",
        default: true,
        callback: (_event, _button, dialog) => {
          const root = dialog.element;
          const background = root.querySelector('input[name="background"]:checked')?.value ?? "__random";
          const savedBackground = savedBackgrounds.find((_entry, index) => background === `__saved_${index}`);
          const mode = root.querySelector('input[name="mode"]:checked')?.value ?? "new";
          result = {
            background: savedBackground?.src ?? (background === "__procedural" ? "" : background === "__random" ? (backgrounds.length ? backgrounds[Math.floor(Math.random() * backgrounds.length)] : "") : background),
            savedBackgroundRecipe: savedBackground?.recipe ?? null,
            proceduralBackground: background === "__procedural" ? normalizeStarfieldRecipe({
              seed: root.querySelector('[name="starfieldSeed"]')?.value.trim() || foundry.utils.randomID(),
              density: root.querySelector('[name="starDensity"]')?.value ?? 100,
              nebula: !!root.querySelector('[name="nebula"]')?.checked,
              palette: root.querySelector('[name="nebulaPalette"]')?.value,
              strength: root.querySelector('[name="nebulaStrength"]')?.value ?? 55,
              resolution: root.querySelector('[name="starfieldResolution"]')?.value ?? 2048,
            }) : null,
            replace: existingScenes.length > 0 && mode === "replace",
            artwork: root.querySelector('select[name="artwork"]')?.value ?? "missing",
            layout: Object.hasOwn(PLANET_SCENE_LAYOUTS, root.querySelector('[name="layout"]')?.value) ? root.querySelector('[name="layout"]').value : "encounter",
            mirror: !!root.querySelector('[name="mirror"]')?.checked,
            moons: root.querySelector('[name="moons"]')?.checked ?? true,
            labels: !!root.querySelector('[name="labels"]')?.checked,
            hoverNames: root.querySelector('[name="hoverNames"]')?.checked ?? true,
            orbitRings: !!root.querySelector('[name="orbitRings"]')?.checked,
            focusMoon: root.querySelector('[name="focusMoon"]')?.value ?? "",
            ringTerrain: root.querySelector('[name="ringTerrain"]')?.checked ?? true,
          };
          return "create";
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  });
  return outcome === "create" ? result : null;
}

async function prepareProceduralSceneArt(actor, data, worldId = null, mode = "missing") {
  const worlds = data.worlds.filter(world => !worldId || world.id === worldId);
  const bodies = [...(worldId ? [] : data.stars), ...worlds.flatMap(world => [world, ...(world.moonRecords ?? [])])];
  const needsPair = body => mode === "all" || (mode === "missing" && !String(body.image ?? "").trim());
  const pending = bodies.filter(body => needsPair(body) || (isProceduralPlanet(body) && !proceduralSceneImageIsCurrent(body)));
  if (!pending.length) return;
  ui.notifications.info(`STA2e Toolkit: Preparing procedural artwork and scene views for ${pending.length} bodies…`);
  for (const body of pending) {
    const recipe = normalizePlanetRecipe(body.procedural || { seed: `${actor.id}-${body.id}` }, body);
    const art = await saveProceduralPlanetImage(body, actor.id, recipe, { sceneOnly: !needsPair(body) });
    Object.assign(body, art);
    if (art.image) body.imageLayers = { base: art.image, polarCap: "", cloud: "", ring: "" };
    // Let the browser paint progress between large textures.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await actor.setFlag(MODULE_ID, STAR_SYSTEM_FLAG, data);
}

/** A separate scene family per planet, so replacing a system never deletes overviews. */
export async function createPlanetaryOverviewScene(actor, worldId) {
  if (!game.user?.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can create planetary scenes.");
    return null;
  }
  const data = getStarSystemData(actor);
  const world = data.worlds.find(row => row.id === worldId);
  if (!data.isStarSystem || !world) return null;
  if (worldClassOf(world.type) === "Belt") {
    ui.notifications.warn("STA2e Toolkit: Select a planet for a planetary overview.");
    return null;
  }
  const existing = (game.scenes ?? []).filter(scene => scene.getFlag(MODULE_ID, SCENE_ACTOR_FLAG) === actor.id && scene.getFlag(MODULE_ID, SCENE_WORLD_FLAG) === world.id);
  const choice = await promptSceneOptions(data, existing, world);
  if (!choice) return null;
  await prepareProceduralSceneArt(actor, data, world.id, choice.artwork);
  const builders = {
    encounter: buildPlanetaryEncounterScene,
    highOrbit: buildPlanetaryHighOrbitScene,
    lowOrbit: buildPlanetaryLowOrbitScene,
    ringPlane: buildPlanetaryRingPlaneScene,
    overview: buildPlanetaryOverviewScene,
  };
  // prepareProceduralSceneArt mutated the data it was handed; re-read the body
  // so a freshly generated recipe and front-ring layer are the ones used.
  const current = data.worlds.find(row => row.id === world.id) ?? world;
  const scene = await (builders[choice.layout] ?? buildPlanetaryEncounterScene)(actor, data, current, choice.background, choice);
  if (!scene) return null;
  const replaced = existing.filter(scene => (scene.getFlag(MODULE_ID, SCENE_LAYOUT_FLAG) || "overview") === choice.layout);
  if (choice.replace && replaced.length) await Scene.deleteDocuments(replaced.map(scene => scene.id));
  ui.notifications.info(`STA2e Toolkit: Orbital scene "${scene.name}" created.`);
  await scene.view();
  return scene;
}

export async function buildPlanetaryOverviewScene(actor, data, world, background = "", options = {}) {
  const moons = world.moonRecords ?? [];
  const size = Math.min(30000, Math.max(6000, 3800 + moons.length * 680));
  const center = size / 2;
  const planetSize = 1800;
  const name = displayName(world, "Planet");
  const sceneData = {
    name: `${data.designation || actor.name} — ${name} Orbit`, width: size, height: size, padding: 0,
    grid: { type: CONST.GRID_TYPES.GRIDLESS, size: GRID, distance: 1, units: "" },
    tokenVision: true, fog: { exploration: false }, environment: { globalLight: { enabled: true } },
    flags: { [MODULE_ID]: { [SCENE_ACTOR_FLAG]: actor.id, [SCENE_WORLD_FLAG]: world.id, [SCENE_LAYOUT_FLAG]: "overview", starSystemGeneratedAt: Date.now() } },
  };
  if ((game.release?.generation ?? 13) >= 14) {
    sceneData.levels = [{ _id: "defaultLevel0000", name: "Level", background: { color: "#000000", src: background || null } }];
  } else {
    sceneData.backgroundColor = "#000000";
    if (background) sceneData.background = { src: background };
  }
  const bag = { tiles: [], drawings: [], walls: [], regions: [] };
  const { drawings } = bag;
  const label = (text, x, y, width = 1000, fontSize = 42) => drawings.push({
    x: Math.round(x - width / 2), y: Math.round(y), shape: { type: "r", width, height: 120 },
    fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 0, text, fontSize, textColor: "#aaccff",
  });
  const addBody = (body, x, y, bodySize, kind) => {
    const bodyName = displayName(body, kind);
    placeBody(bag, body, { cx: x, cy: y, size: bodySize, sort: kind === "planet" ? 200 : 300, name: bodyName, kind,
      fallbackSrc: pickStarSystemImage("planet", worldClassOf(body.type)), ringTerrain: options.ringTerrain !== false });
    label(bodyName, x, y + bodySize / 2 + 40, kind === "planet" ? 1400 : 700);
  };
  addBody(world, center, center, planetSize, "planet");
  label(`${name} • ${world.type || "Unclassified"} • Orbital overview (schematic)`, center, 150, size - 400, 48);
  const occupied = [{ x: center, y: center, radius: planetSize / 2 }];
  moons.forEach((moon, index) => {
    const radius = 1550 + (index + 1) / Math.max(1, moons.length) * (center - 2250);
    drawings.push({ x: center - radius, y: center - radius, shape: { type: "e", width: radius * 2, height: radius * 2 },
      fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 2, strokeColor: "#557799", strokeAlpha: .35 });
    const angle = planetSeedHash(`${world.id}-${moon.id}`) / 4294967296 * Math.PI * 2;
    const pos = findClearOrbitalPosition({ cx: center, cy: center, orbitRadius: radius, bodyRadius: 220, preferredAngle: angle, occupied });
    addBody(moon, pos.x, pos.y, 280, "moon");
    occupied.push({ x: pos.x, y: pos.y, radius: 220 });
  });
  return createSceneWithEmbedded(sceneData, bag, options);
}

/** A fixed-size tactical arena; moon sizes adapt to keep even crowded systems clear. */
export async function buildPlanetaryEncounterScene(actor, data, world, background = "", options = {}) {
  const width = 6000, height = 4000, cx = 1400, cy = 2000, planetSize = 2600;
  const mirrorX = x => options.mirror ? width - x : x;
  const moons = options.moons === false ? [] : world.moonRecords ?? [];
  const sceneData = planetSceneData(actor, data, world, "encounter", "Encounter", background, width, height);
  const bag = { tiles: [], drawings: [], walls: [], regions: [] };
  const { drawings } = bag;
  const add = (body, x, y, size, kind) => {
    x = mirrorX(x);
    const name = displayName(body, kind);
    placeBody(bag, body, { cx: x, cy: y, size, sort: kind === "planet" ? 200 : 300, name, kind,
      fallbackSrc: pickStarSystemImage("planet", worldClassOf(body.type)), ringTerrain: options.ringTerrain !== false });
    if (options.labels) drawings.push({ x: x - size / 2, y: y + size / 2 + 15,
      shape: { type: "r", width: size, height: 80 }, fillType: CONST.DRAWING_FILL_TYPES.NONE,
      strokeWidth: 0, text: name, fontSize: kind === "planet" ? 42 : 24, textColor: "#aaccff" });
  };
  add(world, cx, cy, planetSize, "planet");
  // A half-orbit on the open side leaves the outer third free for ships.
  const radius = 1750, arc = 2.7;
  const moonSize = Math.min(240, radius * arc / Math.max(1, moons.length) * .65);
  moons.forEach((moon, index) => {
    const angle = moons.length === 1 ? 0 : -arc / 2 + index * arc / (moons.length - 1);
    add(moon, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, moonSize, "moon");
  });
  if (options.orbitRings && moons.length) {
    // Polygonal arc stays inside the encounter map (the full orbit extends off-map).
    const points = [];
    for (let i = 0; i <= 48; i++) {
      const angle = -arc / 2 + i * arc / 48;
      points.push(mirrorX(cx + Math.cos(angle) * radius), cy + Math.sin(angle) * radius);
    }
    drawings.push({ x: 0, y: 0, shape: { type: "p", points, width, height },
      fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 2, strokeColor: "#557799", strokeAlpha: .35, bezierFactor: 0 });
  }
  return createSceneWithEmbedded(sceneData, bag, options);
}

/**
 * The planet large in one corner and a chosen moon close in the foreground,
 * the classic approach shot. Uses the ordinary scene art, so it works for
 * custom images too.
 */
export async function buildPlanetaryHighOrbitScene(actor, data, world, background = "", options = {}) {
  const width = 6000, height = 4000, planetSize = 2400, moonSize = 1300;
  const mirrorX = x => options.mirror ? width - x : x;
  const moons = world.moonRecords ?? [];
  const focus = moons.find(moon => moon.id === options.focusMoon) ?? moons[0] ?? null;
  const sceneData = planetSceneData(actor, data, world, "highOrbit", "High Orbit", background, width, height);
  const bag = { tiles: [], drawings: [], walls: [], regions: [] };
  const ringTerrain = options.ringTerrain !== false;
  const add = (body, x, y, size, kind) => {
    const name = displayName(body, kind);
    placeBody(bag, body, { cx: x, cy: y, size, sort: kind === "planet" ? 200 : 300, name, kind,
      fallbackSrc: pickStarSystemImage("planet", worldClassOf(body.type)), ringTerrain });
    if (options.labels) bag.drawings.push({ x: Math.round(x - size / 2), y: Math.round(y + size / 2 + 15),
      shape: { type: "r", width: size, height: 80 }, fillType: CONST.DRAWING_FILL_TYPES.NONE,
      strokeWidth: 0, text: name, fontSize: kind === "planet" ? 42 : 30, textColor: "#aaccff" });
  };
  const planet = { x: mirrorX(1500), y: 1500 };
  add(world, planet.x, planet.y, planetSize, "planet");
  const occupied = [{ x: planet.x, y: planet.y, radius: planetSize / 2 }];
  if (focus) {
    const pos = { x: mirrorX(4750), y: 2950 };
    add(focus, pos.x, pos.y, moonSize, "moon");
    occupied.push({ x: pos.x, y: pos.y, radius: moonSize / 2 });
  }
  // The rest keep their distance from the planet, on the side facing open space.
  const small = 180;
  if (options.moons !== false) moons.filter(moon => moon !== focus).forEach(moon => {
    const angle = planetSeedHash(`${world.id}-${moon.id}`) / 4294967296 * (Math.PI / 2);
    const pos = findClearOrbitalPosition({ cx: planet.x, cy: planet.y, orbitRadius: 1650, bodyRadius: small / 2 + 40,
      preferredAngle: options.mirror ? Math.PI - angle : angle, occupied });
    if (pos.clearance < 0 || pos.x - small / 2 < 0 || pos.x + small / 2 > width || pos.y - small / 2 < 0 || pos.y + small / 2 > height) return;
    add(moon, pos.x, pos.y, small, "moon");
    occupied.push({ x: pos.x, y: pos.y, radius: small / 2 });
  });
  return createSceneWithEmbedded(sceneData, bag, options);
}

/** Close-up art for the two layouts that frame only part of the globe. */
async function renderLayoutCrop(actor, world, { tag, view, viewport, label }) {
  if (!isProceduralPlanet(world)) {
    ui.notifications.warn(`STA2e Toolkit: The ${label} layout renders from the planet's procedural recipe. Generate procedural artwork for ${displayName(world)} first.`);
    return "";
  }
  ui.notifications.info(`STA2e Toolkit: Rendering the ${label} view of ${displayName(world)}…`);
  return saveProceduralViewCrop(world, actor.id, normalizePlanetRecipe(world.procedural, world), { view, viewport, tag });
}

// Ring-plane crops retain a lighter render; low orbit uses the recipe quality
// to bring its visible terrain band up to a 4096-pixel edge.
const CROP_SCALE = 2;

/**
 * The globe's limb curving across the bottom of the map, its atmosphere a
 * glowing band above it, and open space for ships everywhere else. The globe is
 * far larger than the scene, so only the band that shows is rendered.
 */
export async function buildPlanetaryLowOrbitScene(actor, data, world, background = "", options = {}) {
  const width = 6000, height = 4000, globeRadius = 14000, limbY = 2700;
  const cx = width / 2, cy = limbY + globeRadius;
  // From just above the atmosphere halo (about 2.2% of the radius) to the bottom edge.
  const bandTop = limbY - Math.round(globeRadius * .036);
  const bandHeight = height - bandTop;
  const name = displayName(world, "Planet");
  const quality = normalizePlanetRecipe(world.procedural, world).resolution;
  const cropScale = width / Math.min(4096, Math.max(3000, quality * 2));
  const src = await renderLayoutCrop(actor, world, {
    tag: "low-orbit", view: "scene", label: "Low Orbit",
    viewport: { width: width / cropScale, height: bandHeight / cropScale, radius: globeRadius / cropScale,
      cx: cx / cropScale, cy: (cy - bandTop) / cropScale },
  });
  if (!src) return null;
  const sceneData = planetSceneData(actor, data, world, "lowOrbit", "Low Orbit", background, width, height);
  const bag = { tiles: [], drawings: [], walls: [], regions: [] };
  bag.tiles.push(tileData({ src, cx, cy: bandTop + bandHeight / 2, width, height: bandHeight, sort: 200, name, kind: "planet", type: world.type }));
  // A terrain wall just under the limb, across the scene and a little past it.
  const span = Math.asin(Math.min(1, (width / 2 + 400) / globeRadius));
  bag.walls.push(...terrainWallLoop({ cx, cy, radius: globeRadius * .998, name, kind: "planet", type: world.type,
    from: -Math.PI / 2 - span, to: -Math.PI / 2 + span, segments: 24 }));
  if (options.labels) bag.drawings.push({ x: cx - 1500, y: height - 160, shape: { type: "r", width: 3000, height: 100 },
    fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 0, text: `${name} • Low orbit`, fontSize: 48, textColor: "#aaccff" });
  return createSceneWithEmbedded(sceneData, bag, options);
}

/**
 * Looking straight down onto the ring plane: the globe a partial disc at one
 * edge and the ring band sweeping across the map, with loose debris in it.
 */
export async function buildPlanetaryRingPlaneScene(actor, data, world, background = "", options = {}) {
  const recipe = ringedRecipe(world);
  if (!recipe) {
    ui.notifications.warn(`STA2e Toolkit: The Ring Plane layout needs a procedural planet with rings.`);
    return null;
  }
  const width = 6000, height = 4000, outerRing = 8600;
  const side = options.mirror ? 1 : -1;
  // Centre off the map, so the globe's limb shows on one side and the band fills the rest.
  const cx = options.mirror ? width + 2600 : -2600, cy = height / 2;
  const globeRadius = outerRing * planetSceneBodyScale(world);
  const name = displayName(world, "Planet");
  const src = await renderLayoutCrop(actor, world, {
    tag: options.mirror ? "ring-plane-r" : "ring-plane", view: "ring", label: "Ring Plane",
    viewport: { width: width / CROP_SCALE, height: height / CROP_SCALE, radius: globeRadius / CROP_SCALE,
      cx: cx / CROP_SCALE, cy: cy / CROP_SCALE },
  });
  if (!src) return null;
  const sceneData = planetSceneData(actor, data, world, "ringPlane", "Ring Plane", background, width, height);
  const bag = { tiles: [], drawings: [], walls: [], regions: [] };
  bag.tiles.push(tileData({ src, cx: width / 2, cy, width, height, sort: 200, name, kind: "planet", type: world.type }));
  const facing = side < 0 ? 0 : Math.PI;
  const span = Math.asin(Math.min(1, (height / 2 + 300) / globeRadius));
  bag.walls.push(...terrainWallLoop({ cx, cy, radius: globeRadius * .985, name, kind: "planet", type: world.type,
    from: facing - span, to: facing + span, segments: 20 }));
  bag.regions.push(ringRegionData({ cx, cy, outerRadius: outerRing, rotation: 0, name, recipe, terrain: options.ringTerrain !== false }));
  // Loose ring debris, seeded so a rebuilt scene keeps its rocks.
  const rockSrc = pickStarSystemImage("planet", "Belt");
  if (rockSrc) for (let k = 0; k < 36; k += 1) {
    const random = salt => planetSeedHash(`${world.id}-ring-${k}-${salt}`) / 4294967295;
    const r = outerRing * (.64 + random("radius") * .33);
    const angle = facing + (random("angle") * 2 - 1) * .42;
    const size = 40 + random("size") ** 2 * 90;
    const x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
    if (x - size / 2 < 0 || x + size / 2 > width || y - size / 2 < 0 || y + size / 2 > height) continue;
    bag.tiles.push(tileData({ src: rockSrc, cx: x, cy: y, size, rotation: random("rotation") * 360, sort: 250,
      name: `${name} ring debris`, kind: "ring", type: world.type }));
  }
  if (options.labels) bag.drawings.push({ x: width / 2 - 1500, y: 60, shape: { type: "r", width: 3000, height: 100 },
    fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 0, text: `${name} • Ring plane`, fontSize: 48, textColor: "#aaccff" });
  return createSceneWithEmbedded(sceneData, bag, options);
}

async function buildScene(actor, data, background, options = {}) {
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

  // Resolve world positions before drawing anything. Worlds around separate
  // stellar parents can otherwise land on top of each other by chance.
  const occupiedBodies = nodes
    .filter(node => node.type === "star")
    .map(node => {
      const star = data.stars.find(row => row.id === node.starId);
      const pos = positions.get(node.id) ?? { x: 0, y: 0 };
      return { x: pos.x, y: pos.y, radius: starTileSize(star, node) / 2 };
    });
  for (const layout of worldLayouts) {
    const cls = worldClassOf(layout.world.type);
    if (cls === "Belt") continue;
    const parentPos = positions.get(layout.parentId) ?? { x: 0, y: 0 };
    const placement = findClearOrbitalPosition({
      cx: parentPos.x,
      cy: parentPos.y,
      orbitRadius: layout.radius,
      bodyRadius: planetTileSize(cls) / 2,
      preferredAngle: layout.angle,
      occupied: occupiedBodies,
    });
    layout.angle = placement.angle;
    occupiedBodies.push({ x: placement.x, y: placement.y, radius: planetTileSize(cls) / 2 });
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
    tokenVision: true,
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

  const bag = { tiles: [], drawings: [], walls: [], regions: [] };
  const { tiles, drawings, walls } = bag;

  // ── Stars at their hierarchy positions ───────────────────────────────────
  nodes.filter(node => node.type === "star").forEach((node, i) => {
    const star = data.stars.find(row => row.id === node.starId) ?? { role: node.label, spectralType: "G", classification: node.label };
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    const src = planetSceneImage(star) || pickStarSystemImage("star", starTypeKeyOf(star));
    const label = star.classification || data.primaryStar || "Star";
    const size = starTileSize(star, node);
    const sx = pos.x + offsetX;
    const sy = pos.y + offsetY;
    const name = `${displayName({ name: data.designation }, "System")} - ${nodeLabel(node, data)} - ${label}`;
    const starWallScale = isProceduralPlanet(star) ? planetSceneBodyScale(star) * .95 : STAR_WALL_RADIUS_SCALE;
    walls.push(...terrainWallLoop({ cx: sx, cy: sy, radius: (size / 2) * starWallScale, name, kind: "star", type: label }));
    if (src) {
      tiles.push(tileData({
        src,
        cx: sx,
        cy: sy,
        size,
        sort: 100 + i,
        name,
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
        const random = salt => planetSeedHash(`${world.id}-${k}-${salt}`) / 4294967295;
        const angle = (k / rocks) * Math.PI * 2 + random("angle") * 0.2;
        const r = radius + (random("radius") * 2 - 1) * 120;
        const src = planetSceneImage(world) || pickStarSystemImage("planet", "Belt");
        if (!src) break;
        tiles.push(tileData({
          src,
          cx: pcx + Math.cos(angle) * r,
          cy: pcy + Math.sin(angle) * r,
          size: 55 + random("size") * 50,
          rotation: random("rotation") * 360,
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
    placeBody(bag, world, {
      cx: px, cy: py, size: psize, sort: 200, name, kind: "planet",
      rotation: shadowRotationAwayFrom(pcx, pcy, px, py),
      fallbackSrc: pickStarSystemImage("planet", cls),
      ringTerrain: options.ringTerrain !== false, placeholderAlpha: 0.9,
    });

    // Moons fan out from the planet, away from the star, while avoiding the
    // host and all previously laid out stellar bodies.
    const moons = Array.isArray(world.moonRecords) ? world.moonRecords : [];
    moons.forEach((moon, k) => {
      const moonAngle = angle + (k - (moons.length - 1) / 2) * 0.45;
      const moonRadius = psize / 2 + MOON_TILE_SIZE / 2 + MOON_BODY_GAP + k * (MOON_TILE_SIZE + MOON_SEPARATION);
      const moonSrc = planetSceneImage(moon) || pickStarSystemImage("planet", worldClassOf(moon.type));
      if (!moonSrc) return;
      const moonPlacement = findClearOrbitalPosition({
        cx: px - offsetX,
        cy: py - offsetY,
        orbitRadius: moonRadius,
        bodyRadius: MOON_TILE_SIZE / 2,
        preferredAngle: moonAngle,
        occupied: occupiedBodies,
      });
      const mx = moonPlacement.x + offsetX;
      const my = moonPlacement.y + offsetY;
      const lightPos = positions.get(moon.orbitParentNodeId) ?? parentPos;
      const lightX = lightPos.x + offsetX;
      const lightY = lightPos.y + offsetY;
      tiles.push(tileData({
        src: moonSrc,
        cx: mx,
        cy: my,
        size: MOON_TILE_SIZE,
        sort: 300,
        name: displayName(moon, `${name} moon`),
        kind: "moon",
        type: moon.type,
        rotation: shadowRotationAwayFrom(lightX, lightY, mx, my),
      }));
      occupiedBodies.push({ x: moonPlacement.x, y: moonPlacement.y, radius: MOON_TILE_SIZE / 2 });
    });
  });

  return createSceneWithEmbedded(sceneData, bag, options);
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
  const hoverNames = canvas.scene.getFlag(MODULE_ID, SCENE_HOVER_NAMES_FLAG);
  if (hoverNames === false || (hoverNames === undefined && canvas.scene.getFlag(MODULE_ID, SCENE_LAYOUT_FLAG) === "lowOrbit")) return;
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
