/**
 * sta2e-toolkit | trait-service.js
 *
 * Toolkit metadata and helpers layered over native STA trait items.
 */

import { getLcTokens } from "./lcars-theme.js";
import { adjustPool, readPool } from "./pool-service.js";
import { getCrewManifest } from "./crew-manifest.js";

export const MODULE = "sta2e-toolkit";
export const TRAIT_FLAG = "traitAutomation";
export const SCENE_TRAITS_FLAG = "sceneTraits";
export const SCENE_TRAIT_ACTOR_FLAG = "sceneTraitActorUuid";
export const SCENE_TRAIT_ACTOR_TYPE = "scenetraits";
export const SCENE_TRAIT_ACTOR_FOLDER = "Scene Traits";

const DEFAULT_IMG = "systems/sta/assets/icons/VoyagerCombadgeIcon.png";
const DEFAULT_SCENE_TRAIT_ACTOR_IMG = "icons/svg/mystery-man.svg";
const TRAIT_AUTOMATION_COMMENT_RE = /<!--\s*sta2e-toolkit:traitAutomation:([A-Za-z0-9+/=]+)\s*-->/;

const LC = new Proxy({}, {
  get(_, prop) { return getLcTokens()[prop]; },
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value ?? "");
  return div.textContent?.trim() ?? "";
}

function encodeTraitAutomation(value) {
  const json = JSON.stringify(normalizeAutomation(value));
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeTraitAutomation(value) {
  try {
    return normalizeAutomation(JSON.parse(decodeURIComponent(escape(atob(String(value ?? ""))))));
  } catch {
    return null;
  }
}

export function splitTraitDescription(value) {
  const raw = String(value ?? "");
  const match = raw.match(TRAIT_AUTOMATION_COMMENT_RE);
  return {
    description: raw.replace(TRAIT_AUTOMATION_COMMENT_RE, "").trim(),
    automation: match ? decodeTraitAutomation(match[1]) : null,
  };
}

export function traitDescriptionForStorage(description, automation) {
  const clean = splitTraitDescription(description).description;
  const encoded = encodeTraitAutomation(automation);
  return `${clean}${clean ? "\n" : ""}<!-- sta2e-toolkit:traitAutomation:${encoded} -->`;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeTalentName(value) {
  return normalizeKey(value)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

export function actorHasTalent(actor, talentName) {
  if (!actor?.items || !talentName) return false;
  const wanted = normalizeTalentName(talentName);
  return Array.from(actor.items).some(item => normalizeTalentName(item?.name) === wanted);
}

export function actorHasPlanOfActionTalent(actor) {
  return actorHasTalent(actor, "Plan of Action");
}

export function actorHasMethodicalPlanningTalent(actor) {
  return actorHasTalent(actor, "Methodical Planning");
}

function hasPlanSourceTag(tags = []) {
  const normalized = new Set((Array.isArray(tags) ? tags : []).map(normalizeTalentName));
  return normalized.has("plan")
    || normalized.has("strategy")
    || normalized.has("course of action");
}

function arrayHas(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (value === null || value === undefined || value === "") return true;
  return list.map(normalizeKey).includes(normalizeKey(value));
}

function intersects(configured, actual) {
  if (!Array.isArray(configured) || configured.length === 0) return true;
  const actualSet = new Set((Array.isArray(actual) ? actual : [actual]).map(normalizeKey));
  return configured.some(v => actualSet.has(normalizeKey(v)));
}

function randomId() {
  return foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2);
}

export function traitCreatorFromActor(actor = null) {
  if (!actor) return null;
  return {
    actorId: actor.id ?? null,
    actorUuid: actor.uuid ?? null,
    name: actor.name ?? "Actor",
  };
}

export function normalizeTraitCreator(value = null) {
  if (!value || typeof value !== "object") return null;
  const name = String(value.name ?? value.actorName ?? "").trim();
  const actorId = value.actorId ? String(value.actorId) : null;
  const actorUuid = value.actorUuid ? String(value.actorUuid) : null;
  if (!name && !actorId && !actorUuid) return null;
  return {
    actorId,
    actorUuid,
    name: name || "Actor",
  };
}

export function defaultAutomation(overrides = {}) {
  return {
    sourceTags: [],
    duration: "persistent",
    createdBy: null,
    effects: [],
    ...overrides,
  };
}

export function normalizeAutomation(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    sourceTags: Array.isArray(raw.sourceTags) ? raw.sourceTags.map(String) : [],
    duration: ["persistent", "scene", "single-task"].includes(raw.duration) ? raw.duration : "persistent",
    createdBy: normalizeTraitCreator(raw.createdBy ?? raw.creator ?? null),
    effects: Array.isArray(raw.effects) ? raw.effects.map(effect => ({
      id: String(effect?.id ?? randomId()),
      type: String(effect?.type ?? "note"),
      label: String(effect?.label ?? ""),
      value: Number(effect?.value ?? 0) || 0,
      difficultyDirection: effect?.difficultyDirection === "reduce" ? "reduce" : "increase",
      complicationDirection: effect?.complicationDirection === "reduce" ? "reduce" : "increase",
      alwaysOn: !!effect?.alwaysOn,
      scalesWithQuantity: !!effect?.scalesWithQuantity,
      match: effect?.match && typeof effect.match === "object" ? foundry.utils.deepClone(effect.match) : {},
      note: String(effect?.note ?? ""),
    })) : [],
  };
}

export function traitDescriptionText(trait) {
  if (trait?.description) return stripHtml(splitTraitDescription(trait.description).description);
  return stripHtml(splitTraitDescription(trait?.system?.description ?? "").description);
}

export function traitQuantity(trait) {
  return Math.max(1, Number(trait?.quantity ?? trait?.system?.quantity ?? 1) || 1);
}

export function traitRecordFromItem(item, actor = item?.parent ?? null) {
  if (!item || item.type !== "trait") return null;
  const splitDescription = splitTraitDescription(item.system?.description ?? "");
  const automation = traitAutomationFromItem(item);
  return {
    id: item.id,
    uuid: item.uuid,
    itemId: item.id,
    actorId: actor?.id ?? null,
    actorUuid: actor?.uuid ?? null,
    actorName: actor?.name ?? "",
    scope: "actor",
    name: item.name ?? "Trait",
    img: item.img ?? DEFAULT_IMG,
    description: splitDescription.description,
    quantity: traitQuantity(item),
    automation,
    configured: automation.effects.length > 0,
    document: item,
    actor,
  };
}

function sceneTraitRecordFromItem(item, actor, scene = canvas?.scene) {
  const record = traitRecordFromItem(item, actor);
  if (!record) return null;
  return {
    ...record,
    scope: "scene",
    actorId: null,
    actorUuid: null,
    actorName: actor?.name ?? "",
    sceneId: scene?.id ?? null,
    sceneName: scene?.name ?? "",
  };
}

export function traitAutomationFromItem(item) {
  const embedded = splitTraitDescription(item?.system?.description ?? "").automation;
  if (embedded) return embedded;
  return normalizeAutomation(item?.getFlag?.(MODULE, TRAIT_FLAG) ?? item?.flags?.[MODULE]?.[TRAIT_FLAG] ?? {});
}

export async function updateActorTraitItem(actor, itemId, data = {}) {
  if (!actor) throw new Error("Actor is required.");
  if (!itemId) throw new Error("Trait item id is required.");
  if (!canEditActorTraits(actor)) throw new Error("You cannot edit this actor's traits.");
  const update = { _id: itemId };
  const existingItem = actor.items?.get(itemId) ?? null;
  const existingAutomation = traitAutomationFromItem(existingItem);
  const incomingAutomation = "automation" in data
    ? (() => {
        const normalized = normalizeAutomation(data.automation);
        return normalized.createdBy ? normalized : { ...normalized, createdBy: existingAutomation.createdBy ?? null };
      })()
    : null;
  if ("description" in data || "automation" in data) {
    const description = "description" in data
      ? data.description ?? ""
      : splitTraitDescription(existingItem?.system?.description ?? "").description;
    const automation = incomingAutomation ?? existingAutomation;
    update.system = {
      ...(update.system ?? {}),
      description: traitDescriptionForStorage(description, automation),
    };
  }
  if ("quantity" in data) update.system = { ...(update.system ?? {}), quantity: Math.max(1, Number(data.quantity ?? 1) || 1) };
  if ("automation" in data) {
    update.flags = {
      [MODULE]: {
        [TRAIT_FLAG]: incomingAutomation,
      },
    };
  }
  const updated = await actor.updateEmbeddedDocuments("Item", [update]);
  const item = updated?.[0] ?? actor.items?.get(itemId) ?? null;
  if (!item) throw new Error(`Trait item ${itemId} was not found after update.`);
  if ("automation" in data && !splitTraitDescription(item.system?.description ?? "").automation) {
    throw new Error(`Trait metadata did not persist on ${item.name}.`);
  }
  return item;
}

export function getActorTraitRecords(actor) {
  if (!actor?.items) return [];
  return Array.from(actor.items)
    .map(item => traitRecordFromItem(item, actor))
    .filter(Boolean);
}

export function getSceneTraitRecords(scene = canvas?.scene) {
  if (!scene) return [];
  const actor = getSceneTraitActor(scene);
  if (actor) {
    return Array.from(actor.items ?? [])
      .map(item => sceneTraitRecordFromItem(item, actor, scene))
      .filter(Boolean);
  }
  return getLegacySceneTraitRecords(scene);
}

function getLegacySceneTraitRecords(scene = canvas?.scene) {
  if (!scene) return [];
  const traits = scene.getFlag(MODULE, SCENE_TRAITS_FLAG) ?? [];
  return (Array.isArray(traits) ? traits : []).map(raw => {
    const automation = normalizeAutomation(raw.automation ?? raw.flags?.[MODULE]?.[TRAIT_FLAG] ?? {});
    return {
      id: raw.id ?? randomId(),
      scope: "scene",
      sceneId: scene.id,
      sceneName: scene.name,
      name: raw.name ?? "Scene Trait",
      img: raw.img ?? DEFAULT_IMG,
      description: raw.description ?? "",
      quantity: Math.max(1, Number(raw.quantity ?? 1) || 1),
      automation,
      configured: automation.effects.length > 0,
    };
  });
}

function actorFromUuidSync(uuid) {
  const value = String(uuid ?? "").trim();
  if (!value) return null;
  if (typeof fromUuidSync === "function") {
    try {
      const doc = fromUuidSync(value);
      if (doc?.documentName === "Actor") return doc;
      if (doc?.actor?.documentName === "Actor") return doc.actor;
    } catch (err) {
      console.warn("STA2e Toolkit | Could not resolve scene trait actor UUID:", value, err);
    }
  }
  const match = value.match(/^Actor\.([^.]+)$/);
  return match ? game.actors?.get(match[1]) ?? null : null;
}

async function actorFromUuid(uuid) {
  const value = String(uuid ?? "").trim();
  if (!value) return null;
  if (typeof fromUuid === "function") {
    try {
      const doc = await fromUuid(value);
      if (doc?.documentName === "Actor") return doc;
      if (doc?.actor?.documentName === "Actor") return doc.actor;
    } catch (err) {
      console.warn("STA2e Toolkit | Could not resolve scene trait actor UUID:", value, err);
    }
  }
  return actorFromUuidSync(value);
}

function isSceneTraitActor(actor) {
  return actor?.documentName === "Actor" && actor.type === SCENE_TRAIT_ACTOR_TYPE;
}

export function getSceneTraitActor(scene = canvas?.scene) {
  if (!scene) return null;
  const actor = actorFromUuidSync(scene.getFlag(MODULE, SCENE_TRAIT_ACTOR_FLAG));
  return isSceneTraitActor(actor) ? actor : null;
}

export async function resolveSceneTraitActor(scene = canvas?.scene) {
  if (!scene) return null;
  const actor = await actorFromUuid(scene.getFlag(MODULE, SCENE_TRAIT_ACTOR_FLAG));
  return isSceneTraitActor(actor) ? actor : null;
}

export async function ensureSceneTraitActorFolder() {
  if (!game.user?.isGM) throw new Error("Only the GM can create scene trait actor folders.");
  const folders = game.folders?.contents ?? Array.from(game.folders ?? []);
  const existing = folders.find(folder => folder?.type === "Actor" && folder.name === SCENE_TRAIT_ACTOR_FOLDER);
  if (existing) return existing;
  return Folder.create({
    name: SCENE_TRAIT_ACTOR_FOLDER,
    type: "Actor",
  });
}

function sceneTraitRecordKey(record) {
  const name = normalizeKey(record?.name ?? "");
  const description = normalizeKey(stripHtml(splitTraitDescription(record?.description ?? "").description));
  return `${name}\n${description}`;
}

function sceneTraitCreateData(record = {}) {
  const automation = normalizeAutomation(record.automation ?? record.flags?.[MODULE]?.[TRAIT_FLAG] ?? {});
  return {
    name: String(record.name ?? "Scene Trait").trim() || "Scene Trait",
    type: "trait",
    img: record.img ?? DEFAULT_IMG,
    system: {
      description: traitDescriptionForStorage(record.description ?? "", automation),
      quantity: Math.max(1, Number(record.quantity ?? 1) || 1),
    },
    flags: {
      [MODULE]: {
        [TRAIT_FLAG]: automation,
      },
    },
  };
}

async function importLegacySceneTraitsToActor(scene, actor) {
  const legacy = getLegacySceneTraitRecords(scene);
  if (!legacy.length) return;
  const existingKeys = new Set(
    Array.from(actor.items ?? [])
      .map(item => traitRecordFromItem(item, actor))
      .filter(Boolean)
      .map(sceneTraitRecordKey)
  );
  const toCreate = legacy.filter(record => {
    const key = sceneTraitRecordKey(record);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  if (toCreate.length) {
    await actor.createEmbeddedDocuments("Item", toCreate.map(sceneTraitCreateData));
  }
  await scene.unsetFlag(MODULE, SCENE_TRAITS_FLAG).catch(async () => {
    await scene.setFlag(MODULE, SCENE_TRAITS_FLAG, []);
  });
}

export async function linkSceneTraitActor(actor, scene = canvas?.scene) {
  if (!scene) throw new Error("No active scene.");
  if (!game.user?.isGM) throw new Error("Only the GM can link scene trait actors.");
  if (!isSceneTraitActor(actor)) throw new Error("Actor must be a scene traits actor.");
  await scene.setFlag(MODULE, SCENE_TRAIT_ACTOR_FLAG, actor.uuid);
  await importLegacySceneTraitsToActor(scene, actor);
  return actor;
}

export async function unlinkSceneTraitActor(scene = canvas?.scene) {
  if (!scene) throw new Error("No active scene.");
  if (!game.user?.isGM) throw new Error("Only the GM can unlink scene trait actors.");
  await scene.unsetFlag(MODULE, SCENE_TRAIT_ACTOR_FLAG);
}

export async function createSceneTraitActor(scene = canvas?.scene) {
  if (!scene) throw new Error("No active scene.");
  if (!game.user?.isGM) throw new Error("Only the GM can create scene trait actors.");
  const folder = await ensureSceneTraitActorFolder();
  const actor = await Actor.create({
    name: `${scene.name ?? "Scene"} Scene Traits`,
    type: SCENE_TRAIT_ACTOR_TYPE,
    img: DEFAULT_SCENE_TRAIT_ACTOR_IMG,
    system: {},
    folder: folder?.id ?? null,
  });
  return linkSceneTraitActor(actor, scene);
}

export async function ensureSceneTraitActor(scene = canvas?.scene) {
  const existing = await resolveSceneTraitActor(scene);
  return existing ?? createSceneTraitActor(scene);
}

export function canViewActorTraits(actor, user = game.user) {
  if (!actor || !user) return false;
  return user.isGM || actor.testUserPermission?.(user, "OWNER") || actor.isOwner;
}

export function canEditActorTraits(actor, user = game.user) {
  if (!actor || !user) return false;
  return user.isGM || actor.testUserPermission?.(user, "OWNER") || actor.isOwner;
}

export function visibleSceneActors() {
  const byId = new Map();
  for (const token of canvas?.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (actor && !byId.has(actor.id)) byId.set(actor.id, actor);
  }
  return Array.from(byId.values());
}

export function visibleTraitActors(user = game.user) {
  return visibleSceneActors().filter(actor => canViewActorTraits(actor, user));
}

function manifestActorsForShip(actor) {
  if (!actor?.system?.systems) return [];
  const manifest = getCrewManifest(actor);
  const ids = Object.values(manifest ?? {}).flat().filter(Boolean);
  return ids
    .map(id => game.actors.get(id))
    .filter(Boolean);
}

function uniqueActors(actors = []) {
  const seen = new Set();
  return actors.filter(actor => {
    if (!actor?.id || seen.has(actor.id)) return false;
    seen.add(actor.id);
    return true;
  });
}

export async function resolveActorReference({ actorUuid = "", actorId = "" } = {}) {
  if (actorUuid) {
    try {
      const actor = typeof fromUuid === "function"
        ? await fromUuid(actorUuid)
        : typeof fromUuidSync === "function"
          ? fromUuidSync(actorUuid)
          : null;
      if (actor) return actor;
    } catch (err) {
      console.warn("STA2e Toolkit | Could not resolve actor UUID for trait creation:", actorUuid, err);
    }
  }
  return game.actors.get(actorId) ?? null;
}

export function rollTraitContext(state = {}, actor = null, token = null) {
  const weaponTags = [];
  if (state.weaponContext?.isTorpedo) weaponTags.push("torpedo");
  if (state.weaponContext?.isArray) weaponTags.push("array");
  if (state.weaponContext?.isSalvo) weaponTags.push("salvo");
  if (state.weaponContext) weaponTags.push("weapon", "attack");
  if (state.groundMode) weaponTags.push("ground");
  if (!state.groundMode) weaponTags.push("starship");

  return {
    actor,
    token,
    mode: state.groundMode ? "ground" : "starship",
    isNpc: !!state.groundIsNpc || !!state._isNpc,
    taskKey: state.selectedTaskKey ?? state.combatTaskContext?._selected?.taskKey ?? null,
    stationId: state.stationId ?? null,
    attrKey: state.officerAttrKey ?? null,
    discKey: state.officerDiscKey ?? null,
    shipSystemKey: state.shipSystemKey ?? null,
    shipDeptKey: state.shipDeptKey ?? null,
    weaponTags,
  };
}

export function effectMatches(effect, context, sourceTrait) {
  const match = effect?.match ?? {};
  if (!arrayHas(match.modes, context.mode)) return false;
  if (!arrayHas(match.taskKeys, context.taskKey)) return false;
  if (!arrayHas(match.stationIds, context.stationId)) return false;
  if (!arrayHas(match.attributes, context.attrKey)) return false;
  if (!arrayHas(match.disciplines, context.discKey)) return false;
  if (!arrayHas(match.shipSystems, context.shipSystemKey)) return false;
  if (!arrayHas(match.departments, context.shipDeptKey)) return false;
  if (!intersects(match.weaponTags, context.weaponTags)) return false;
  if (!intersects(match.sourceTags, sourceTrait?.automation?.sourceTags ?? [])) return false;
  return true;
}

export function effectMagnitude(effect, trait) {
  if (["difficulty", "complicationRange", "bonusMomentum", "bonusThreat"].includes(effect?.type)) {
    return traitQuantity(trait);
  }
  if (effect?.type === "reroll") return 1;
  return 0;
}

export function collectRollTraits(actor, token, state = {}) {
  const records = [];
  records.push(...getActorTraitRecords(actor).map(t => ({ ...t, appliesFrom: "actor" })));
  const officerActor = state.officer?.id ? game.actors.get(state.officer.id) : null;
  if (officerActor && officerActor.id !== actor?.id && officerActor.uuid !== actor?.uuid) {
    records.push(...getActorTraitRecords(officerActor).map(t => ({
      ...t,
      appliesFrom: "officer",
      officerName: state.officer?.name ?? officerActor.name,
    })));
  }

  const rollingActorKeys = new Set([
    actor?.id,
    actor?.uuid,
    token?.actor?.id,
    token?.actor?.uuid,
    officerActor?.id,
    officerActor?.uuid,
  ].filter(Boolean).map(String));
  const rollingTokenKeys = new Set([
    token?.id,
    token?.document?.id,
    token?.object?.id,
  ].filter(Boolean).map(String));

  const targetTokens = Array.from(game.user?.targets ?? []);
  const selectedTargetId = state.selectedTargetId ?? state.combatTaskContext?._selected?.targetId ?? null;
  const selectedTarget = selectedTargetId
    ? canvas?.tokens?.placeables?.find(t => t.actor?.id === selectedTargetId || t.id === selectedTargetId)
    : null;
  if (selectedTarget && !targetTokens.includes(selectedTarget)) targetTokens.push(selectedTarget);
  const seenTargets = new Set();
  const addTargetTraits = (targetActor, targetTokenKey = "", targetName = "") => {
    const targetActorKeys = [targetActor?.id, targetActor?.uuid].filter(Boolean).map(String);
    if (!targetActor) return;
    if (targetTokenKey && rollingTokenKeys.has(targetTokenKey)) return;
    if (targetActorKeys.some(key => rollingActorKeys.has(key))) return;
    const targetKey = targetActor?.uuid ?? targetActor?.id ?? targetTokenKey;
    if (!targetKey || seenTargets.has(targetKey)) return;
    seenTargets.add(targetKey);
    records.push(...getActorTraitRecords(targetActor).map(t => ({ ...t, appliesFrom: "target", targetName: targetName || targetActor.name })));
  };

  const opposedTargets = [
    ...(Array.isArray(state.opposedTraitTargets) ? state.opposedTraitTargets : []),
    ...(state.opposedTraitTarget ? [state.opposedTraitTarget] : []),
  ];
  for (const ref of opposedTargets) {
    const targetToken = ref?.tokenId ? canvas?.tokens?.get?.(ref.tokenId) : null;
    const targetActor = targetToken?.actor ?? (ref?.actorId ? game.actors.get(ref.actorId) : null);
    addTargetTraits(targetActor, String(targetToken?.id ?? ref?.tokenId ?? ""), ref?.name ?? targetToken?.name ?? "");
  }

  for (const target of targetTokens) {
    addTargetTraits(target?.actor, String(target?.id ?? target?.document?.id ?? ""), target?.name ?? "");
  }

  records.push(...getSceneTraitRecords(canvas?.scene).map(t => ({ ...t, appliesFrom: "scene" })));
  return records;
}

export function rollTraitSuggestions(actor, token, state = {}) {
  const context = rollTraitContext(state, actor, token);
  const suggestions = [];
  for (const trait of collectRollTraits(actor, token, state)) {
    if (!trait.configured) {
      suggestions.push({
        id: `${trait.scope}:${trait.itemId ?? trait.id}:note`,
        trait,
        effect: { type: "note", label: "Descriptive trait", value: 0, note: traitDescriptionText(trait) },
        value: 0,
        checked: false,
        noteOnly: true,
      });
      continue;
    }
    for (const effect of trait.automation.effects) {
      if (!effectMatches(effect, context, trait)) continue;
      const autoCheck = ["complicationRange", "reroll", "bonusMomentum", "bonusThreat"].includes(effect.type);
      suggestions.push({
        id: `${trait.scope}:${trait.itemId ?? trait.id}:${effect.id}`,
        trait,
        effect,
        value: effectMagnitude(effect, trait),
        checked: !!effect.alwaysOn || autoCheck,
        locked: !!effect.alwaysOn,
        noteOnly: effect.type === "note" || effect.type === "possible" || effect.type === "impossible",
      });
    }
  }
  return suggestions;
}

export function applyTraitSelectionsToState(state, suggestions = [], selectedIds = [], difficultyDirections = {}) {
  const selected = new Set(selectedIds);
  const applied = suggestions.filter(s => selected.has(s.id) && !s.noteOnly);
  const difficultyDelta = applied
    .filter(s => s.effect.type === "difficulty")
    .reduce((sum, s) => {
      const direction = difficultyDirections[s.id] === "reduce" ? -1 : 1;
      return sum + (Math.abs(Number(s.value ?? 0) || 0) * direction);
    }, 0);
  const complicationDelta = applied
    .filter(s => s.effect.type === "complicationRange")
    .reduce((sum, s) => {
      const direction = s.effect.complicationDirection === "reduce" ? -1 : 1;
      return sum + (Math.abs(Number(s.value ?? 0) || 0) * direction);
    }, 0);
  const bonusMomentum = applied
    .filter(s => s.effect.type === "bonusMomentum")
    .reduce((sum, s) => sum + s.value, 0);
  const bonusThreat = applied
    .filter(s => s.effect.type === "bonusThreat")
    .reduce((sum, s) => sum + s.value, 0);
  const rerolls = applied.filter(s => s.effect.type === "reroll");

  state.appliedTraitEffects = applied.map(s => ({
    id: s.id,
    traitId: s.trait.itemId ?? s.trait.id,
    traitName: s.trait.name,
    scope: s.trait.scope,
    actorId: s.trait.actorId ?? null,
    sceneId: s.trait.sceneId ?? null,
    effectType: s.effect.type,
    label: s.effect.label || s.effect.type,
    value: s.effect.type === "difficulty"
      ? Math.abs(Number(s.value ?? 0) || 0) * (difficultyDirections[s.id] === "reduce" ? -1 : 1)
      : s.value,
    difficultyDirection: s.effect.type === "difficulty"
      ? (difficultyDirections[s.id] === "reduce" ? "reduce" : "increase")
      : null,
    duration: s.trait.automation?.duration ?? "persistent",
    createdBy: normalizeTraitCreator(s.trait.automation?.createdBy ?? null),
    sourceTags: Array.isArray(s.trait.automation?.sourceTags) ? [...s.trait.automation.sourceTags] : [],
  }));
  state.traitDifficultyDelta = difficultyDelta;
  state.traitComplicationDelta = complicationDelta;
  state.traitBonusMomentum = bonusMomentum;
  state.traitBonusThreat = bonusThreat;
  state.hasTraitReroll = rerolls.length > 0;
  state.traitRerollSource = rerolls.map(s => s.trait.name).join(" / ");
  if (state.hasTraitReroll && !state.genericRerollUsed) {
    state.hasGenericTraitReroll = true;
  }
}

export function planOfActionBonusMomentum(appliedEffects = [], rollingActor = null) {
  const seenCreators = new Set();
  let bonus = 0;
  for (const effect of appliedEffects ?? []) {
    if (effect?.effectType !== "difficulty") continue;
    if (effect?.difficultyDirection !== "reduce") continue;
    if (Number(effect?.value ?? 0) >= 0) continue;
    if (!hasPlanSourceTag(effect?.sourceTags)) continue;
    const creatorRef = normalizeTraitCreator(effect?.createdBy ?? null);
    const creator = creatorRef
      ? (game.actors.get(creatorRef.actorId) ?? (creatorRef.actorUuid && typeof fromUuidSync === "function" ? fromUuidSync(creatorRef.actorUuid) : null))
      : null;
    if (!creator || !actorHasPlanOfActionTalent(creator)) continue;
    if (rollingActor && (creator.id === rollingActor.id || creator.uuid === rollingActor.uuid)) continue;
    const key = creator.uuid ?? creator.id;
    if (!key || seenCreators.has(key)) continue;
    seenCreators.add(key);
    bonus += 2;
  }
  return bonus;
}

export function methodicalPlanningAssistActors(appliedEffects = [], rollingActor = null) {
  const seenCreators = new Set();
  const actors = [];
  for (const effect of appliedEffects ?? []) {
    if (!effect || effect.noteOnly) continue;
    if (!hasPlanSourceTag(effect?.sourceTags)) continue;
    const creatorRef = normalizeTraitCreator(effect?.createdBy ?? null);
    const creator = creatorRef
      ? (game.actors.get(creatorRef.actorId) ?? (creatorRef.actorUuid && typeof fromUuidSync === "function" ? fromUuidSync(creatorRef.actorUuid) : null))
      : null;
    if (!creator || !actorHasMethodicalPlanningTalent(creator)) continue;
    if (rollingActor && (creator.id === rollingActor.id || creator.uuid === rollingActor.uuid)) continue;
    const key = creator.uuid ?? creator.id;
    if (!key || seenCreators.has(key)) continue;
    seenCreators.add(key);
    actors.push(creator);
  }
  return actors;
}

export async function consumeSingleTaskTraits(appliedEffects = []) {
  if (!game.user?.isGM && !appliedEffects.some(e => e.actorId && game.actors.get(e.actorId)?.isOwner)) return;
  const consumedKeys = new Set();
  for (const effect of appliedEffects) {
    if (effect.duration !== "single-task") continue;
    const key = `${effect.scope}:${effect.actorId ?? effect.sceneId}:${effect.traitId}`;
    if (consumedKeys.has(key)) continue;
    consumedKeys.add(key);
    try {
      if (effect.scope === "actor" && effect.actorId && effect.traitId) {
        const actor = game.actors.get(effect.actorId);
        if (actor && canEditActorTraits(actor)) await actor.deleteEmbeddedDocuments("Item", [effect.traitId]);
      } else if (effect.scope === "scene" && effect.traitId) {
        await removeSceneTrait(effect.traitId);
      }
    } catch (err) {
      console.warn("STA2e Toolkit | Could not consume single-task trait:", err);
    }
  }
}

export function traitSummaryHtml(appliedEffects = []) {
  if (!appliedEffects.length) return "";
  return `
    <div style="padding:5px 10px;border-top:1px solid ${LC.borderDim};
      font-family:${LC.font};font-size:9px;color:${LC.secondary};letter-spacing:0.05em;">
      <div style="text-transform:uppercase;color:${LC.textDim};margin-bottom:3px;">Traits Applied</div>
      ${appliedEffects.map(e => `
        <div>${escapeHtml(e.traitName)}: ${escapeHtml(e.label)}${e.value ? ` (${e.value > 0 ? "+" : ""}${e.value})` : ""}</div>
      `).join("")}
    </div>`;
}

export async function createActorTrait(actor, data = {}) {
  if (!actor) throw new Error("Actor is required.");
  if (!canEditActorTraits(actor)) throw new Error("You cannot edit this actor's traits.");
  const creator = normalizeTraitCreator(data.createdBy ?? data.creator ?? data.automation?.createdBy)
    ?? traitCreatorFromActor(data.creatorActor ?? actor);
  const automation = normalizeAutomation({
    ...(data.automation ?? { duration: data.duration ?? "persistent" }),
    createdBy: creator,
  });
  const created = await actor.createEmbeddedDocuments("Item", [{
    name: String(data.name ?? "New Trait").trim() || "New Trait",
    type: "trait",
    img: data.img ?? DEFAULT_IMG,
  }]);
  const trait = created?.[0] ?? null;
  if (!trait) throw new Error(`Trait item was not created on ${actor.name}.`);
  return updateActorTraitItem(actor, trait.id, {
    description: data.description ?? "",
    quantity: Math.max(1, Number(data.quantity ?? 1) || 1),
    automation,
  });
}

async function writeSceneTraitRecordsToActor(actor, records = []) {
  if (!actor) throw new Error("Scene trait actor is required.");
  if (!canEditActorTraits(actor)) throw new Error("You cannot edit the scene trait actor.");
  const normalized = Array.isArray(records) ? records : [];
  const existingItems = Array.from(actor.items ?? []).filter(item => item.type === "trait");
  const existingIds = new Set(existingItems.map(item => item.id));
  const keepIds = new Set();
  const updates = [];
  const creates = [];

  for (const record of normalized) {
    const itemId = String(record?.itemId ?? record?.id ?? "");
    const createData = sceneTraitCreateData(record);
    if (itemId && existingIds.has(itemId)) {
      keepIds.add(itemId);
      updates.push({
        _id: itemId,
        name: createData.name,
        img: createData.img,
        system: createData.system,
        flags: createData.flags,
      });
    } else {
      creates.push(createData);
    }
  }

  const toDelete = existingItems
    .filter(item => !keepIds.has(item.id))
    .map(item => item.id);
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  if (creates.length) await actor.createEmbeddedDocuments("Item", creates);
}

export async function setSceneTraits(traits, scene = canvas?.scene) {
  if (!scene) throw new Error("No active scene.");
  if (!game.user?.isGM) throw new Error("Only the GM can edit scene traits.");
  const actor = await resolveSceneTraitActor(scene);
  if (actor) {
    await writeSceneTraitRecordsToActor(actor, traits);
    return;
  }
  await scene.setFlag(MODULE, SCENE_TRAITS_FLAG, traits);
}

export async function createSceneTrait(data = {}, scene = canvas?.scene) {
  if (!scene) throw new Error("No active scene.");
  if (!game.user?.isGM) throw new Error("Only the GM can create scene traits.");
  const actor = await ensureSceneTraitActor(scene);
  const creator = normalizeTraitCreator(data.createdBy ?? data.creator ?? data.automation?.createdBy)
    ?? traitCreatorFromActor(data.creatorActor ?? null);
  const item = await createActorTrait(actor, {
    ...data,
    creatorActor: data.creatorActor ?? null,
    automation: normalizeAutomation({
      ...(data.automation ?? { duration: data.duration ?? "scene" }),
      createdBy: creator,
    }),
  });
  return sceneTraitRecordFromItem(item, actor, scene);
}

export async function removeSceneTrait(id, scene = canvas?.scene) {
  if (!scene) return;
  const actor = await resolveSceneTraitActor(scene);
  if (actor) {
    if (!game.user?.isGM) throw new Error("Only the GM can remove scene traits.");
    if (actor.items?.get(id) && canEditActorTraits(actor)) await actor.deleteEmbeddedDocuments("Item", [id]);
    return;
  }
  const traits = getSceneTraitRecords(scene)
    .filter(t => t.id !== id)
    .map(t => ({
      id: t.id,
      name: t.name,
      img: t.img,
      description: t.description,
      quantity: t.quantity,
      automation: t.automation,
    }));
  await setSceneTraits(traits, scene);
}

export async function updateSceneTraitItem(itemId, data = {}, scene = canvas?.scene) {
  if (!scene) throw new Error("No active scene.");
  if (!game.user?.isGM) throw new Error("Only the GM can edit scene traits.");
  const actor = await resolveSceneTraitActor(scene);
  if (actor) {
    return updateActorTraitItem(actor, itemId, data);
  }
  const traits = getLegacySceneTraitRecords(scene).map(t => ({
    id: t.id,
    name: t.name,
    img: t.img,
    description: "description" in data && t.id === itemId ? data.description : t.description,
    quantity: "quantity" in data && t.id === itemId ? data.quantity : t.quantity,
    automation: "automation" in data && t.id === itemId ? data.automation : t.automation,
  }));
  await scene.setFlag(MODULE, SCENE_TRAITS_FLAG, traits);
  return traits.find(t => t.id === itemId) ?? null;
}

export function traitSpendPool(actor, token) {
  const subject = actor ?? token?.actor ?? null;
  const CombatHUD = game.sta2eToolkit?.CombatHUD;
  if (subject?.system?.systems !== undefined) {
    const isNpcShip = !!CombatHUD?.isNpcShip?.(subject);
    const isAlliedNpc = !!CombatHUD?.isAlliedNpcActor?.(subject);
    if (isAlliedNpc) return CombatHUD?.alliedNpcMomentumPool?.(subject) ?? "momentum";
    return isNpcShip && !isAlliedNpc ? "threat" : "momentum";
  }

  const profile = subject ? CombatHUD?.getGroundCombatProfile?.(subject) : null;
  const isGroundNpc = profile?.isPlayerOwned === false;
  const isAlliedNpc = !!CombatHUD?.isAlliedNpcActor?.(subject);
  if (isAlliedNpc) return CombatHUD?.alliedNpcMomentumPool?.(subject) ?? "momentum";
  return isGroundNpc && !isAlliedNpc ? "threat" : "momentum";
}

export async function spendForTraitCreation(actor, token, amount = 2) {
  const pool = traitSpendPool(actor, token);
  const current = readPool(pool);
  if (current < amount) {
    ui.notifications.warn(`STA2e Toolkit: Not enough ${pool === "threat" ? "Threat" : "Momentum"} to create a trait.`);
    return false;
  }
  const ok = await adjustPool(pool, -amount, {
    source: "traitCreation",
    actor,
    token,
  });
  return ok ? { pool, amount } : false;
}

function traitSuggestionEffectText(suggestion) {
  const effect = suggestion?.effect ?? {};
  const label = effect.label || effect.type || "note";
  const value = Number(suggestion?.value ?? 0) || 0;
  if (effect.type === "difficulty") {
    return `Difficulty by ${Math.abs(value)} from Potency`;
  }
  if (effect.type === "complicationRange") {
    const dir = effect.complicationDirection === "reduce" ? "Reduce" : "Increase";
    return `${dir} Complication range by ${Math.abs(value)}`;
  }
  const suffix = value ? ` ${value > 0 ? "+" : ""}${value}` : "";
  return `${label}${suffix}`;
}

export async function promptTraitCreateData({ actor = null, allowScene = true, title = "Create Trait", spend = null, defaultScope = "actor" } = {}) {
  const canTagPlan = actorHasPlanOfActionTalent(actor);
  const actorChoices = uniqueActors([
    actor,
    ...manifestActorsForShip(actor),
    ...visibleTraitActors(),
  ].filter(Boolean));
  const selectedActor = actorChoices.find(a => a?.uuid === actor?.uuid)
    ?? actorChoices.find(a => a?.id === actor?.id)
    ?? actorChoices[0]
    ?? null;
  const actorOptions = actorChoices
    .filter(a => canEditActorTraits(a))
    .map(a => `<option value="${escapeHtml(a.uuid ?? "")}" data-actor-id="${escapeHtml(a.id ?? "")}" ${selectedActor?.uuid === a.uuid ? "selected" : ""}>${escapeHtml(a.name)}</option>`)
    .join("");
  const sceneAllowed = allowScene && game.user?.isGM;
  const content = `
    <form class="sta2e-trait-create-form sta2e-trait-prompt">
      <header class="sta2e-trait-prompt-header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>Create an actor or scene trait using STA's native trait item data plus toolkit metadata.</p>
        </div>
      </header>
      <div class="sta2e-trait-form-grid">
        <label>Name</label>
        <input name="name" type="text" placeholder="Dense Smoke" autofocus />
        <label>Scope</label>
        <select name="scope">
          ${actorOptions ? `<option value="actor" ${defaultScope !== "scene" ? "selected" : ""}>Actor</option>` : ""}
          ${sceneAllowed ? `<option value="scene" ${defaultScope === "scene" ? "selected" : ""}>Scene</option>` : ""}
        </select>
        <label>Actor</label>
        <select name="actorUuid" ${actorOptions ? "" : "disabled"}>${actorOptions}</select>
        <input name="actorId" type="hidden" value="${escapeHtml(selectedActor?.id ?? actor?.id ?? "")}" />
        <label>Duration</label>
        <select name="duration">
          <option value="scene">Scene</option>
          <option value="single-task">Single Task</option>
          <option value="persistent">Persistent</option>
        </select>
        <label>Potency</label>
        <input name="quantity" type="number" min="1" max="9" value="1" />
        <label>Description</label>
        <textarea name="description" rows="3"></textarea>
      </div>
      ${canTagPlan ? `
      <label class="sta2e-trait-plan-option">
        <input name="planTag" type="checkbox" value="1" checked />
        <span>
          <strong>Plan / Strategy</strong>
          <small>Adds the plan Source Tag for Plan of Action and Methodical Planning.</small>
        </span>
      </label>` : ""}
      ${spend ? `<p class="sta2e-trait-prompt-note">This will spend ${spend.amount} ${spend.pool === "threat" ? "Threat" : "Momentum"}.</p>` : ""}
    </form>`;

  let formResult = null;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title },
    content,
    rejectClose: false,
    buttons: [
      {
        action: "create",
        label: "Create",
        icon: "fas fa-plus",
        default: true,
        callback: (_event, _button, dialog) => {
          const form = dialog.element.querySelector(".sta2e-trait-create-form");
          const fd = form ? new FormData(form) : null;
          if (!fd) return;
          const name = String(fd.get("name") ?? "").trim();
          if (!name) {
            ui.notifications.warn("STA2e Toolkit: Enter a trait name.");
            form.querySelector("[name='name']")?.focus();
            return false;
          }
          formResult = {
            name,
            scope: String(fd.get("scope") ?? "actor"),
            actorId: String(fd.get("actorId") ?? actor?.id ?? ""),
            actorUuid: String(fd.get("actorUuid") ?? actor?.uuid ?? ""),
            duration: String(fd.get("duration") ?? "scene"),
            quantity: Math.max(1, Number(fd.get("quantity") ?? 1) || 1),
            description: String(fd.get("description") ?? ""),
            sourceTags: canTagPlan && fd.get("planTag") ? ["plan"] : [],
          };
          return "create";
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
    render: (_event, dialog) => {
      const form = dialog.element.querySelector(".sta2e-trait-create-form");
      const scope = form?.querySelector("[name='scope']");
      const actorSelect = form?.querySelector("[name='actorUuid']");
      const actorIdInput = form?.querySelector("[name='actorId']");
      const sync = () => {
        if (actorSelect) actorSelect.disabled = scope?.value !== "actor";
        if (actorIdInput && actorSelect) {
          actorIdInput.value = actorSelect.selectedOptions?.[0]?.dataset?.actorId ?? "";
        }
      };
      scope?.addEventListener("change", sync);
      form?.addEventListener("submit", event => event.preventDefault());
      sync();
    },
  });
  if (result !== "create") return null;
  if (!formResult?.name) return null;
  return formResult;
}

export async function createTraitFromData(data) {
  const selectedActor = await resolveActorReference(data);
  const creator = normalizeTraitCreator(data.createdBy ?? data.creator ?? null)
    ?? traitCreatorFromActor(data.creatorActor ?? selectedActor);
  const sourceTags = Array.isArray(data.sourceTags)
    ? data.sourceTags
    : Array.isArray(data.automation?.sourceTags)
      ? data.automation.sourceTags
      : [];
  const automation = defaultAutomation({
    duration: data.duration,
    createdBy: creator,
    sourceTags,
  });
  if (data.scope === "scene") {
    return createSceneTrait({ ...data, automation });
  }
  if (!selectedActor) throw new Error("No actor selected.");
  return createActorTrait(selectedActor, { ...data, automation, creatorActor: selectedActor });
}

export async function promptSpendCreateTrait({ actor = null, token = null, allowScene = true } = {}) {
  const spend = await spendForTraitCreation(actor, token, 2);
  if (!spend) return null;
  const data = await promptTraitCreateData({
    actor,
    allowScene,
    title: "Create Trait - Spend 2",
    spend,
  });
  if (!data) {
    await adjustPool(spend.pool, spend.amount, { source: "traitCreationRefund", actor, token });
    return null;
  }
  let trait = null;
  try {
    trait = await createTraitFromData(data);
  } catch (err) {
    await adjustPool(spend.pool, spend.amount, { source: "traitCreationRefund", actor, token });
    throw err;
  }
  await postTraitCreatedCard(data, spend);
  return trait;
}

export async function postTraitCreatedCard(data, spend = null) {
  const actor = data.scope === "scene" ? null : await resolveActorReference(data);
  await ChatMessage.create({
    content: `
      <div style="background:${LC.bg};border:1px solid ${LC.primary};border-left:4px solid ${LC.primary};
        border-radius:3px;padding:8px 10px;font-family:${LC.font};">
        <div style="font-size:9px;color:${LC.primary};font-weight:800;letter-spacing:0.1em;text-transform:uppercase;">
          Trait Created
        </div>
        <div style="font-size:14px;color:${LC.text};font-weight:800;margin-top:4px;">${escapeHtml(data.name)}</div>
        <div style="font-size:10px;color:${LC.textDim};margin-top:4px;">
          ${escapeHtml(data.scope === "scene" ? canvas?.scene?.name ?? "Scene" : actor?.name ?? "Actor")}
          · Potency ${Number(data.quantity ?? 1) || 1}
          ${spend ? ` · Spent ${spend.amount} ${spend.pool === "threat" ? "Threat" : "Momentum"}` : ""}
        </div>
      </div>`,
    speaker: { alias: "STA2e Toolkit" },
  });
}

export function renderTraitSuggestionPanel(suggestions = [], selectedIds = [], difficultyDirections = {}) {
  const rollEffects = suggestions.filter(s => !s.noteOnly);
  if (!rollEffects.length) return "";
  const selected = new Set(selectedIds);
  const isGM = !!game.user?.isGM;
  return `
    <div id="sta2e-trait-suggestions" style="border-top:1px solid ${LC.borderDim};">
      <div style="padding:6px 10px 2px;font-size:9px;color:${LC.textDim};font-family:${LC.font};
        text-transform:uppercase;letter-spacing:0.08em;">Traits</div>
      <div style="padding:4px 10px 8px;display:flex;flex-direction:column;gap:4px;">
        ${rollEffects.map(s => {
          const locked = !!s.locked;
          const lockedForUser = locked && !isGM;
          const checked = locked || selected.has(s.id) || (s.checked && !selectedIds.length);
          const from = s.appliesFrom === "target" ? `Target${s.targetName ? `: ${s.targetName}` : ""}`
            : s.appliesFrom === "officer" ? `Officer${s.officerName ? `: ${s.officerName}` : ""}`
              : s.appliesFrom === "scene" ? "Scene" : "Actor";
          const effectText = traitSuggestionEffectText(s);
          const direction = difficultyDirections[s.id] === "reduce" ? "reduce" : "increase";
          return `
            <label style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px;align-items:start;
              padding:4px 6px;border:1px solid ${s.noteOnly ? LC.borderDim : LC.border};border-radius:2px;
              background:${s.noteOnly ? "rgba(255,255,255,0.02)" : "rgba(255,153,0,0.05)"};">
              <input type="checkbox" class="sta2e-trait-effect-cb" value="${escapeHtml(s.id)}"
                ${checked ? "checked" : ""} ${s.noteOnly || lockedForUser ? "disabled" : ""}
                style="margin-top:2px;accent-color:${LC.primary};" />
              <span style="min-width:0;font-family:${LC.font};">
                <span style="display:block;font-size:10px;color:${s.noteOnly ? LC.textDim : LC.text};font-weight:700;">
                  ${escapeHtml(s.trait.name)} <span style="color:${LC.textDim};font-weight:400;">(${escapeHtml(from)})</span>${locked ? ` <span style="color:${LC.tertiary};font-weight:700;" title="Always on - locked by GM">[LOCKED]</span>` : ""}
                </span>
                <span style="display:block;font-size:9px;color:${s.noteOnly ? LC.textDim : LC.secondary};">
                  ${escapeHtml(effectText)}
                </span>
                ${s.effect.type === "difficulty" && !s.noteOnly ? `
                <span style="display:flex;align-items:center;gap:5px;margin-top:4px;font-size:9px;color:${LC.textDim};">
                  <span class="sta2e-trait-difficulty-label">Reduce</span>
                  <input type="checkbox" class="sta2e-trait-difficulty-direction" data-trait-effect-id="${escapeHtml(s.id)}"
                    value="increase" ${direction === "increase" ? "checked" : ""} ${checked && !lockedForUser ? "" : "disabled"} />
                  <span class="sta2e-trait-difficulty-label">Increase</span>
                </span>` : ""}
              </span>
            </label>`;
        }).join("")}
      </div>
    </div>`;
}
