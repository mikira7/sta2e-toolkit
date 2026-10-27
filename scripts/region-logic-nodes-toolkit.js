/**
 * sta2e-toolkit | region-logic-nodes-toolkit.js
 *
 * Region Logic nodes that reach into the rest of the toolkit and into core
 * documents: what a token carries or suffers from, the alert status, hazards,
 * the transporter, viewscreens, tiles, macros, the camera and journals. The
 * generic nodes and the descriptor shape are in region-logic-nodes.js.
 *
 * Anything heavy (the transporter, zone-hazard.js, the viewscreen behavior) is
 * imported when a node first runs, so this file adds nothing to the load of a
 * world that never uses those nodes, and closes no import cycle.
 *
 * Everything runs on the active GM. Two things have to reach other clients and
 * go over the module socket, handled by `handleRegionLogicSocket` (called from
 * region-logic-behavior.js's own listener): the camera pan and the journal show
 * for chosen players.
 */

import { registerRegionLogicNode, ALERT_LEVELS, nodeKey } from "./region-logic-nodes.js";
import { resolveDestinations, runRandomTeleport } from "./random-teleport-behavior.js";
import { COMBAT_CONDITIONS, hasCondition, addCondition, removeCondition } from "./token-conditions.js";

const MODULE = "sta2e-toolkit";
const SOCKET = `module.${MODULE}`;
const VIEWSCREEN_TYPE = `${MODULE}.warpViewscreen`;

const _norm = s => String(s ?? "").trim().toLowerCase();
const _names = text => String(text ?? "").split(",").map(_norm).filter(Boolean);
const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const _resolve = (uuid, behavior) => { try { return fromUuidSync(uuid, { relative: behavior }); } catch { return null; } };

/** The users a node's "Who sees it" choice names. */
function _audience(choice, token) {
  if (choice === "owners" && token) {
    return game.users.filter(u => u.active && (u.isGM || token.testUserPermission?.(u, "OWNER")));
  }
  return game.users.filter(u => u.active);
}
const AUDIENCE = { all: "Everyone", owners: "The token's owners (and GMs)" };

// ── What a token carries ─────────────────────────────────────────────────────

const ITEM_KINDS = { any: "Any item", trait: "Trait", talent: "Talent", item: "Gear", weapon: "Weapon",
  armor: "Armour", value: "Value", focus: "Focus" };

/** Does an actor hold an item matching one of the names? Traits also match the free-text traits field. */
export function actorHas(actor, names, { kind = "any", worn = false } = {}) {
  if (!actor || !names.length) return false;
  const wanted = new Set(names);
  for (const item of actor.items ?? []) {
    if (kind === "weapon" ? !String(item.type).toLowerCase().includes("weapon")
      : kind !== "any" && item.type !== kind) continue;
    if (!wanted.has(_norm(item.name))) continue;
    if (worn && !item.getFlag?.(MODULE, "worn")) continue;
    return true;
  }
  if (!worn && (kind === "any" || kind === "trait")) {
    const text = _norm(actor.system?.traits);
    if (text && names.some(n => new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text))) {
      return true;
    }
  }
  return false;
}

registerRegionLogicNode({
  type: "tokenHas", label: "Token Has", category: "condition", icon: "fa-solid fa-id-card",
  outputs: ["yes", "no"],
  defaults: { names: "", kind: "any", worn: false, match: "any" },
  fields: [
    { key: "names", label: "Named (comma-separated)", type: "text",
      hint: "Item names, matched ignoring case. Traits also match the sheet's traits text: \"Klingon\"." },
    { key: "kind", label: "Kind", type: "select", choices: ITEM_KINDS },
    { key: "worn", label: "Must be worn", type: "boolean",
      hint: "Only items switched on with the toolkit's Wear toggle count." },
    { key: "match", label: "With several names", type: "select",
      choices: { any: "Yes when it has any of them", all: "Yes when it has all of them" } },
  ],
  summary: c => (c.names ? `${c.worn ? "Wearing" : "Has"} ${c.names}` : "No names given"),
  run({ ctx, config }) {
    const actor = ctx.token?.actor;
    const names = _names(config.names);
    if (!actor || !names.length) return "no";
    const opts = { kind: config.kind, worn: !!config.worn };
    const ok = config.match === "all"
      ? names.every(n => actorHas(actor, [n], opts)) : actorHas(actor, names, opts);
    return ok ? "yes" : "no";
  },
});

// ── Conditions ───────────────────────────────────────────────────────────────
//
// One list holds both the toolkit's combat conditions ("sta:<key>") and core's
// status effects ("core:<id>"), so a flow can use Stunned or Prone alike.

function _conditionChoices() {
  const out = {};
  for (const [key, def] of Object.entries(COMBAT_CONDITIONS)) out[`sta:${key}`] = `${def.label} (toolkit)`;
  for (const s of CONFIG.statusEffects ?? []) {
    if (!s?.id) continue;
    out[`core:${s.id}`] = game.i18n?.localize?.(s.name ?? s.label ?? s.id) ?? s.id;
  }
  return out;
}

function _hasStatus(token, choice) {
  const [src, id] = String(choice ?? "").split(/:(.*)/);
  if (!token || !id) return false;
  if (src === "sta") return hasCondition(token, id);
  return !!token.actor?.statuses?.has(id) || !!token.hasStatusEffect?.(id);
}

async function _setStatus(token, choice, active) {
  const [src, id] = String(choice ?? "").split(/:(.*)/);
  if (!token || !id) return;
  if (src === "sta") return active ? addCondition(token, id) : removeCondition(token, id);
  const actor = token.actor;
  if (actor?.toggleStatusEffect) await actor.toggleStatusEffect(id, { active });
}

registerRegionLogicNode({
  type: "hasCondition", label: "Token Has Condition", category: "condition", icon: "fa-solid fa-heart-pulse",
  outputs: ["yes", "no"],
  defaults: { condition: "sta:stun" },
  fields: [{ key: "condition", label: "Condition", type: "select", choices: _conditionChoices }],
  summary: c => _conditionChoices()[c.condition] ?? c.condition,
  run: ({ ctx, config }) => (_hasStatus(ctx.token, config.condition) ? "yes" : "no"),
});

registerRegionLogicNode({
  type: "setCondition", label: "Apply Condition", category: "action", icon: "fa-solid fa-user-injured",
  inputs: ["add", "remove", "toggle"],
  defaults: { condition: "sta:stun" },
  fields: [{ key: "condition", label: "Condition", type: "select", choices: _conditionChoices }],
  summary: c => _conditionChoices()[c.condition] ?? c.condition,
  async run({ ctx, config, input }) {
    if (!ctx.token) return "out";
    const active = input === "toggle" ? !_hasStatus(ctx.token, config.condition) : input === "add";
    try { await _setStatus(ctx.token, config.condition, active); }
    catch (err) { console.warn("STA2e Toolkit | Region Logic: could not change a condition", err); }
    return "out";
  },
});

// ── Alert status ─────────────────────────────────────────────────────────────

const _alertNow = () => { try { return game.settings.get(MODULE, "alertCondition") ?? "green"; } catch { return "green"; } };

registerRegionLogicNode({
  type: "alertIs", label: "Alert Status Is", category: "condition", icon: "fa-solid fa-circle-exclamation",
  outputs: ["yes", "no"],
  defaults: { level: "red" },
  fields: [{ key: "level", label: "Alert", type: "select", choices: ALERT_LEVELS }],
  summary: c => `${ALERT_LEVELS[c.level] ?? c.level} Alert`,
  run: ({ config }) => (_alertNow() === config.level ? "yes" : "no"),
});

registerRegionLogicNode({
  type: "setAlert", label: "Set Alert Status", category: "action", icon: "fa-solid fa-triangle-exclamation",
  defaults: { level: "red" },
  fields: [{ key: "level", label: "Alert", type: "select", choices: ALERT_LEVELS }],
  summary: c => `${ALERT_LEVELS[c.level] ?? c.level} Alert`,
  async run({ config }) {
    if (_alertNow() === config.level) return "out";
    const hud = game.sta2eToolkit?.alertHud;
    // The HUD's own path writes the setting, broadcasts and plays the sound.
    if (hud?._setCondition) await hud._setCondition(config.level);
    else await game.settings.set(MODULE, "alertCondition", config.level);
    return "out";
  },
});

// ── Hazards ──────────────────────────────────────────────────────────────────

registerRegionLogicNode({
  type: "hazard", label: "Trigger Hazard", category: "action", icon: "fa-solid fa-biohazard",
  defaults: {},
  fields: [{ type: "heading", label: "Uses this Region's own Hazard behaviors" }],
  summary: () => "This Region's hazards",
  async run({ ctx }) {
    if (!ctx.token || !ctx.region) return "out";
    const { getRegionFeatures, regionHazardView } = await import("./region-terrain.js");
    const { ZoneHazard } = await import("./zone-hazard.js");
    const entries = getRegionFeatures(ctx.region.parent, "hazard")
      .filter(f => f.region === ctx.region || f.region?.id === ctx.region.id)
      .map(f => regionHazardView(f))
      .map(h => ({ ref: h.source, label: h.label, category: h.category, sourceName: h.sourceName }));
    if (!entries.length) {
      ui.notifications?.warn(`STA2e Toolkit | "${ctx.region.name}" has no Hazard behavior for Trigger Hazard to use.`);
      return "out";
    }
    await ZoneHazard.postHazardEntryCard(ctx.token, entries, { reason: "entry" });
    return "out";
  },
});

// ── Transporter ──────────────────────────────────────────────────────────────

let _tpChoices = null;
function _transporterChoices() {
  // transporter.js is loaded by main.js; the first call after that fills this in.
  if (!_tpChoices) {
    import("./transporter.js").then(m => { _tpChoices = m.transporterTypeChoices(); }).catch(() => {});
    return { tngFed: "TNG", voyFed: "Voyager", tosFed: "TOS", entFed: "Enterprise Era", klingon: "Klingon",
      cardassian: "Cardassian", dominion: "Dominion" };
  }
  return _tpChoices;
}

registerRegionLogicNode({
  type: "transport", label: "Transport", category: "action", icon: "fa-solid fa-person-rays",
  defaults: { type: "tngFed", destinations: [], placement: "random", snap: true, avoidOccupied: true,
    noRepeat: false, mode: "move" },
  fields: [
    { key: "type", label: "Transporter", type: "select", choices: _transporterChoices },
    { key: "mode", label: "Do", type: "select", choices: {
      move: "Beam to a destination", out: "Beam out only (leaves it invisible)", in: "Beam in only (where it is)" } },
    { key: "destinations", label: "Destinations", type: "uuids", docType: "Region", layer: "regions", noun: "Region",
      showIf: c => c.mode === "move", hint: "One is picked at random. It may be on another scene." },
    { key: "placement", label: "Placement", type: "select", showIf: c => c.mode === "move",
      choices: { random: "Random spot", center: "Centre" } },
    { key: "snap", label: "Snap to Grid", type: "boolean", showIf: c => c.mode === "move" },
    { key: "avoidOccupied", label: "Avoid Occupied", type: "boolean", showIf: c => c.mode === "move" },
    { key: "noRepeat", label: "No Repeat", type: "boolean", showIf: c => c.mode === "move" },
  ],
  summary(c) {
    const look = _transporterChoices()[c.type] ?? c.type;
    if (c.mode !== "move") return `${look} · beam ${c.mode}`;
    return `${look} · ${c.destinations?.length ?? 0} destination${c.destinations?.length === 1 ? "" : "s"}`;
  },
  async run({ ctx, node, config }) {
    if (!ctx.token) return null;
    const { playTransporterFx } = await import("./transporter.js");
    if (config.mode === "in") { await playTransporterFx(ctx.token, config.type, "in"); return "out"; }
    await playTransporterFx(ctx.token, config.type, "out");
    if (config.mode === "out") return "out";

    const destinations = resolveDestinations(config.destinations, ctx.behavior);
    if (!destinations.length) {
      // Nowhere to go: bring them back rather than strand an invisible token.
      await playTransporterFx(ctx.token, config.type, "in");
      return null;
    }
    const landed = await runRandomTeleport({
      key: nodeKey(ctx.behavior, node), config: { ...config, delay: 0, departSound: "", arriveSound: "" },
      destinations, region: ctx.region, token: ctx.token, movement: ctx.movement,
      user: ctx.movement ? (ctx.user ?? game.user) : game.user, viewSelf: false,
    });
    const arrived = landed ?? ctx.token;
    await _sleep(150);   // let the moved or recreated token reach every canvas
    await playTransporterFx(arrived, config.type, "in");
    if (!landed) return null;
    ctx.token = landed;
    return "out";
  },
});

// ── Viewscreens ──────────────────────────────────────────────────────────────

function _viewscreenChoices() {
  const out = { "": "Pick a viewscreen" };
  for (const scene of game.scenes ?? []) {
    for (const region of scene.regions ?? []) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== VIEWSCREEN_TYPE) continue;
        out[behavior.uuid] = `${scene.navName || scene.name} · ${region.name}${behavior.name ? ` · ${behavior.name}` : ""}`;
      }
    }
  }
  return out;
}

registerRegionLogicNode({
  type: "viewscreen", label: "Viewscreen", category: "action", icon: "fa-solid fa-tv",
  inputs: ["enter", "exit", "toggle"],
  defaults: { target: "" },
  fields: [{ key: "target", label: "Viewscreen", type: "select", choices: _viewscreenChoices,
    hint: "Any Viewscreen behavior, on any scene." }],
  summary: c => (c.target ? _viewscreenChoices()[c.target] ?? "Missing viewscreen" : "No viewscreen picked"),
  async run({ config, input }) {
    const behavior = config.target ? await fromUuid(config.target).catch(() => null) : null;
    if (behavior?.type !== VIEWSCREEN_TYPE) return "out";
    const { enterWarp, exitWarp, isAtWarp } = await import("./warp-viewscreen-behavior.js");
    const go = input === "toggle" ? !isAtWarp(behavior) : input === "enter";
    if (go !== isAtWarp(behavior)) await (go ? enterWarp(behavior) : exitWarp(behavior));
    return "out";
  },
});

// ── Tiles ────────────────────────────────────────────────────────────────────

const TILE_ACTIONS = { show: "Show", hide: "Hide", toggle: "Show / hide", image: "Change image",
  play: "Play video", pause: "Pause video", restart: "Play video from the start" };

registerRegionLogicNode({
  type: "tiles", label: "Tiles", category: "action", icon: "fa-solid fa-image",
  defaults: { tiles: [], action: "show", src: "" },
  fields: [
    { key: "tiles", label: "Tiles", type: "uuids", docType: "Tile", layer: "tiles", noun: "tile" },
    { key: "action", label: "Do", type: "select", choices: TILE_ACTIONS },
    { key: "src", label: "Image or Video", type: "image", showIf: c => c.action === "image" },
  ],
  summary: c => `${TILE_ACTIONS[c.action] ?? c.action} · ${c.tiles?.length ?? 0} tile${c.tiles?.length === 1 ? "" : "s"}`,
  async run({ ctx, config }) {
    const byScene = new Map();
    for (const uuid of config.tiles ?? []) {
      const tile = _resolve(uuid, ctx.behavior);
      if (!tile?.parent) continue;
      const a = config.action;
      if (a === "play" || a === "pause" || a === "restart") {
        // As core's Tile HUD does it: the update options carry the playback to every client.
        const play = a !== "pause";
        await tile.update({ "video.autoplay": play }, { diff: false, playVideo: play, ...(a === "restart" ? { offset: 0 } : {}) })
          .catch(err => console.warn("STA2e Toolkit | Region Logic: tile video", err));
        continue;
      }
      let change = null;
      if (a === "show") change = { hidden: false };
      else if (a === "hide") change = { hidden: true };
      else if (a === "toggle") change = { hidden: !tile.hidden };
      else if (a === "image" && config.src) change = { "texture.src": config.src };
      if (!change) continue;
      if (!byScene.has(tile.parent)) byScene.set(tile.parent, []);
      byScene.get(tile.parent).push({ _id: tile.id, ...change });
    }
    for (const [scene, rows] of byScene) {
      await scene.updateEmbeddedDocuments("Tile", rows).catch(err => console.warn("STA2e Toolkit | Region Logic: tiles", err));
    }
    return "out";
  },
});

// ── Macros, camera, journals ─────────────────────────────────────────────────

function _macroChoices() {
  const out = { "": "Pick a macro" };
  for (const m of game.macros ?? []) out[m.uuid] = m.name;
  return out;
}

registerRegionLogicNode({
  type: "macro", label: "Run Macro", category: "action", icon: "fa-solid fa-code",
  defaults: { macro: "", wait: true },
  fields: [
    { key: "macro", label: "Macro", type: "select", choices: _macroChoices,
      hint: "Runs on the active GM, with token, actor, region, behavior and event in scope." },
    { key: "wait", label: "Wait for it to finish", type: "boolean" },
  ],
  summary: c => (c.macro ? _macroChoices()[c.macro] ?? "Missing macro" : "No macro picked"),
  async run({ ctx, config }) {
    const macro = config.macro ? await fromUuid(config.macro).catch(() => null) : null;
    if (!macro?.execute) return "out";
    const scope = { token: ctx.token ?? null, actor: ctx.token?.actor ?? null, region: ctx.region,
      behavior: ctx.behavior, event: ctx.event, door: ctx.door ?? null };
    const running = Promise.resolve().then(() => macro.execute(scope))
      .catch(err => console.error(`STA2e Toolkit | Region Logic: macro "${macro.name}" failed`, err));
    if (config.wait) await running;
    return "out";
  },
});

const PAN_TO = { token: "The token", region: "This Region", other: "Another Region" };

registerRegionLogicNode({
  type: "panCamera", label: "Pan Camera", category: "action", icon: "fa-solid fa-camera",
  defaults: { to: "token", region: [], audience: "owners", zoom: null, duration: 1000 },
  fields: [
    { key: "to", label: "Pan To", type: "select", choices: PAN_TO },
    { key: "region", label: "Region", type: "uuids", docType: "Region", layer: "regions", noun: "Region",
      showIf: c => c.to === "other", hint: "The first one picked is used. It must be on the viewers' scene." },
    { key: "audience", label: "Who", type: "select", choices: AUDIENCE },
    { key: "zoom", label: "Zoom", type: "number", min: 0.1, max: 3, step: 0.1, nullable: true,
      hint: "Blank keeps each viewer's zoom." },
    { key: "duration", label: "Duration (ms)", type: "number", min: 0, max: 10000, step: 100 },
  ],
  summary: c => `${PAN_TO[c.to] ?? c.to} · ${AUDIENCE[c.audience] ?? c.audience}`,
  async run({ ctx, config }) {
    let point = null, scene = ctx.region?.parent;
    if (config.to === "token" && ctx.token) {
      const t = ctx.token;
      point = { x: t.x + (t.width * (t.parent?.grid?.size ?? 100)) / 2, y: t.y + (t.height * (t.parent?.grid?.size ?? 100)) / 2 };
      scene = t.parent;
    } else {
      const region = config.to === "other" ? _resolve(config.region?.[0], ctx.behavior) : ctx.region;
      const { regionCentre } = await import("./spawn-regions.js");
      if (region) { point = regionCentre(region); scene = region.parent; }
    }
    if (!point || !scene) return "out";
    const users = _audience(config.audience, ctx.token).map(u => u.id);
    const msg = { action: "regionLogicPan", sceneId: scene.id, users, x: point.x, y: point.y,
      scale: Number(config.zoom) || null, duration: Number(config.duration) || 0 };
    game.socket.emit(SOCKET, msg);
    handleRegionLogicSocket(msg);
    return "out";
  },
});

function _journalChoices() {
  const out = { "": "Pick a journal" };
  for (const j of game.journal ?? []) {
    out[j.uuid] = j.name;
    for (const p of j.pages ?? []) out[p.uuid] = `${j.name} · ${p.name}`;
  }
  return out;
}

registerRegionLogicNode({
  type: "showJournal", label: "Show Journal", category: "action", icon: "fa-solid fa-book-open",
  defaults: { journal: "", audience: "owners" },
  fields: [
    { key: "journal", label: "Journal or Page", type: "select", choices: _journalChoices },
    { key: "audience", label: "Show To", type: "select", choices: AUDIENCE,
      hint: "Players who cannot see it are given Observer permission first." },
  ],
  summary: c => (c.journal ? _journalChoices()[c.journal] ?? "Missing journal" : "No journal picked"),
  async run({ ctx, config }) {
    const doc = config.journal ? await fromUuid(config.journal).catch(() => null) : null;
    if (!doc) return "out";
    const users = _audience(config.audience, ctx.token).filter(u => !u.isGM);
    if (!users.length) return "out";
    const entry = doc.documentName === "JournalEntryPage" ? doc.parent : doc;
    // Give each viewer Observer on the entry so the shown sheet opens for them.
    const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    const grant = {};
    for (const u of users) if (!entry.testUserPermission(u, "OBSERVER")) grant[`ownership.${u.id}`] = OBS;
    if (Object.keys(grant).length) await entry.update(grant).catch(() => null);
    const Journal = foundry.documents?.collections?.Journal ?? globalThis.Journal;
    try { await Journal.show(doc, { force: true, users: users.map(u => u.id) }); }
    catch (err) { console.warn("STA2e Toolkit | Region Logic: could not show the journal", err); }
    return "out";
  },
});

// ── Socket ───────────────────────────────────────────────────────────────────

/** Receive the camera pan on each named user's client. True when the message was ours. */
export function handleRegionLogicSocket(msg) {
  if (msg?.action !== "regionLogicPan") return false;
  if (!msg.users?.includes(game.user.id) || canvas?.scene?.id !== msg.sceneId || !canvas.ready) return true;
  const pan = { x: msg.x, y: msg.y, duration: msg.duration };
  if (msg.scale) pan.scale = msg.scale;
  canvas.animatePan(pan);
  return true;
}
