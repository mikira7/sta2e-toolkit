/**
 * sta2e-toolkit | character-creator.js
 * Incremental STA 2e character creator.
 *
 * First slice:
 * - Creator data settings for species.
 * - Drag/drop species ability and species talents.
 * - Step One preview with mixed-species talent pooling.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE = "sta2e-toolkit";
const UUID_DOC_CACHE = new Map();

export const CHARACTER_CREATOR_DEFAULT_DATA = {
  config: {
    talents: {},
    roles: [],
    traits: [],
    values: [],
    focuses: [],
    departmentFocuses: {},
    items: [],
    weapons: [],
    armor: [],
  },
  ui: {
    collapsedSpeciesIds: [],
    collapsedEnvironmentIds: [],
    collapsedUpbringingIds: [],
    collapsedCareerPathIds: [],
    collapsedCareerEventIds: [],
    collapsedConfigSections: [],
  },
  talentPacks: [],
  species: [],
  environments: [],
  upbringings: [],
  careerPaths: [],
  experienceOptions: [],
  careerEvents: [],
  finishing: {
    roleLoadouts: {},
    rankLoadouts: {},
    departmentLoadouts: {},
    assignmentLoadouts: {},
    ranks: [],
  },
  talentRequirements: {},
};

export const ATTRIBUTE_KEYS = [
  "control",
  "daring",
  "fitness",
  "insight",
  "presence",
  "reason",
];

export const DISCIPLINE_KEYS = [
  "command",
  "conn",
  "engineering",
  "medicine",
  "science",
  "security",
];

const ATTRIBUTE_LABELS = {
  control: "Control",
  daring: "Daring",
  fitness: "Fitness",
  insight: "Insight",
  presence: "Presence",
  reason: "Reason",
};

const DISCIPLINE_LABELS = {
  command: "Command",
  conn: "Conn",
  engineering: "Engineering",
  medicine: "Medical",
  science: "Science",
  security: "Security",
};

const CHARACTER_TYPE_DEFINITIONS = {
  player: {
    key: "player",
    name: "Player Character",
    description: "Full lifepath creation for a main character.",
  },
  supporting: {
    key: "supporting",
    name: "Supporting Character",
    description: "Short creation using supporting character arrays.",
    attributeArray: [10, 9, 9, 8, 8, 7],
    departmentArray: [4, 3, 2, 2, 1, 1],
    focusCount: 3,
    valueCount: 0,
  },
  supervisory: {
    key: "supervisory",
    name: "Supervisory Character",
    description: "Short creation using supervisory arrays, four focuses, and one value.",
    attributeArray: [10, 10, 9, 9, 8, 8],
    departmentArray: [4, 4, 3, 2, 2, 1],
    focusCount: 4,
    valueCount: 1,
  },
  minorNpc: {
    key: "minorNpc",
    name: "Minor NPC",
    description: "GM-only rank-and-file NPC creation.",
    npcType: "minor",
    attributeArray: [9, 9, 8, 8, 7, 7],
    departmentArray: [2, 2, 1, 1, 0, 0],
    valueCount: 0,
    focusCount: 0,
    talentCount: 2,
    minTalentCount: 1,
    extraTraitCount: 0,
  },
  notableNpc: {
    key: "notableNpc",
    name: "Notable NPC",
    description: "GM-only lieutenant-grade NPC creation.",
    npcType: "notable",
    attributeArray: [10, 9, 9, 8, 8, 7],
    departmentArray: [3, 2, 2, 1, 1, 0],
    valueCount: 1,
    focusCount: 3,
    minFocusCount: 2,
    talentCount: 3,
    minTalentCount: 2,
    extraTraitCount: 0,
  },
  majorNpc: {
    key: "majorNpc",
    name: "Major NPC",
    description: "GM-only major adversary or recurring NPC creation.",
    npcType: "major",
    attributeArray: [12, 11, 10, 9, 9, 8],
    departmentArray: [5, 4, 3, 2, 1, 1],
    valueCount: 4,
    minValueCount: 2,
    focusCount: 6,
    minFocusCount: 0,
    talentCount: 4,
    minTalentCount: 4,
    extraTraitCount: 1,
  },
};

const SUPPORTING_CHARACTER_TYPES = ["supporting", "supervisory"];
const NPC_CHARACTER_TYPES = ["minorNpc", "notableNpc", "majorNpc"];

const SUPPORTING_STEP_LABELS = [
  { step: 1, number: "01", label: "Species" },
  { step: 2, number: "02", label: "Scores" },
  { step: 3, number: "03", label: "Details" },
  { step: 4, number: "04", label: "Review" },
];

const NPC_STEP_LABELS = [
  { step: 1, number: "01", label: "Species" },
  { step: 2, number: "02", label: "Scores" },
  { step: 3, number: "03", label: "Details" },
  { step: 4, number: "04", label: "Review" },
];

const NPC_SPECIAL_RULE_FALLBACKS = [
  "Additional Threat Spent",
  "Familiarity",
  "Guidance",
  "Proficiency",
  "Substitution",
  "Threatening",
];

const EXPERIENCE_DEFINITIONS = [
  { key: "novice", name: "Novice", talentMode: "configured" },
  { key: "experienced", name: "Experienced", talentMode: "eligible" },
  { key: "veteran", name: "Veteran", talentMode: "configured" },
];

const JEM_HADAR_HATCHERIES = [
  {
    key: "gamma",
    name: "Gamma Hatchery",
    description: "Bred and raised in a hatchery in the heart of the Dominion's Gamma Quadrant territories.",
    valuePrompt: "Choose a value reflecting Dominion tradition, dogma, and loyalty to the Founders.",
    attributes: ["control", "fitness", "reason"],
    department: "security",
    focusPrompt: "Choose a focus tied to combat or starship operations.",
  },
  {
    key: "alpha",
    name: "Alpha Hatchery",
    description: "Bred and raised in the Dominion's Alpha Quadrant territories during the Dominion War.",
    valuePrompt: "Choose a value reflecting specialized conditioning and Alpha Quadrant superiority.",
    attributes: ["daring", "presence", "insight"],
    department: "command",
    focusPrompt: "Choose a focus tied to leadership in battle.",
  },
];

const VORTA_CLONING = {
  key: "vortaCloning",
  name: "Vorta Cloning",
  description: "Engineered in cloned batches to serve the Founders' will.",
  valuePrompt: "Choose a value reflecting Dominion tradition, dogma, and belief in the Founders.",
};

const VORTA_PRIMARY_DEPARTMENTS = ["command", "science", "medicine"];

const VORTA_CAREER_NAMES = [
  "diplomatic corps",
  "civilian (physician)",
  "civilian (scientist)",
  "civilian (official)",
];

const DISCIPLINE_ALIASES = {
  command: "command",
  conn: "conn",
  engineering: "engineering",
  engineer: "engineering",
  medicine: "medicine",
  medical: "medicine",
  science: "science",
  security: "security",
};

const TALENT_CATEGORIES = [
  { key: "general", label: "General" },
  { key: "augment", label: "Augment" },
  { key: "cybernetic", label: "Cybernetic" },
  { key: "borgImplant", label: "Borg Implants" },
  { key: "esoteric", label: "Esoteric" },
  { key: "npc", label: "NPC Special Rules" },
  { key: "command", label: "Command" },
  { key: "conn", label: "Conn" },
  { key: "engineering", label: "Engineering" },
  { key: "security", label: "Security" },
  { key: "science", label: "Science" },
  { key: "medical", label: "Medical" },
];

const CONFIG_ITEM_TYPES = {
  talent: ["talent"],
  role: ["talent"],
  trait: ["trait"],
  value: ["value"],
  focus: ["focus"],
  item: ["item"],
  weapon: ["characterweapon2e"],
  armor: ["armor"],
};

function normalizeUuidList(list) {
  return Array.isArray(list)
    ? list
      .map(uuid => String(uuid ?? "").trim())
      .filter(uuid => uuid && !["undefined", "null"].includes(uuid.toLocaleLowerCase(game.i18n.lang)))
    : [];
}

function uniqueUuidList(list) {
  return Array.from(new Set(normalizeUuidList(list)));
}

function isLiberatedBorgSpecies(species = {}) {
  return String(species?.name ?? "").trim().toLocaleLowerCase(game.i18n.lang) === "liberated borg";
}

function isHumanAugmentSpecies(species = {}) {
  return String(species?.name ?? "").trim().toLocaleLowerCase(game.i18n.lang) === "human augment";
}

function isExpandedProgrammingTalent(talent = {}) {
  return String(talent?.name ?? "").trim().toLocaleLowerCase(game.i18n.lang) === "expanded programming";
}

function isOldAsDirtTalent(talent = {}) {
  return String(talent?.name ?? "").trim().toLocaleLowerCase(game.i18n.lang) === "old as dirt";
}

function normalizeAccessName(name = "") {
  return String(name ?? "")
    .trim()
    .toLocaleLowerCase(game.i18n.lang)
    .replace(/[’‘`]/g, "'");
}

function normalizeExtraFocusCount(value) {
  return Math.max(0, Math.min(6, Number(value ?? 0) || 0));
}

function normalizeSpeciesEsotericTalentCount(value, talentUuids = []) {
  const fallback = normalizeUuidList(talentUuids).length ? 1 : 0;
  return Math.max(0, Math.min(6, Number(value ?? fallback) || 0));
}

function configuredDepartmentFocusUuids(config = {}) {
  return uniqueUuidList(DISCIPLINE_KEYS.flatMap(key => normalizeUuidList(config?.departmentFocuses?.[key])));
}

function configuredFocusUuids(config = {}) {
  return uniqueUuidList([
    ...configuredDepartmentFocusUuids(config),
    ...normalizeUuidList(config?.focuses),
  ]);
}

function departmentFocusUuids(config = {}, departments = []) {
  return uniqueUuidList(normalizeUuidList(departments)
    .filter(key => DISCIPLINE_KEYS.includes(key))
    .flatMap(key => normalizeUuidList(config?.departmentFocuses?.[key])));
}

function lifepathFocusUuids(recommendedFocusUuids = [], config = {}, departments = []) {
  return uniqueUuidList([
    ...normalizeUuidList(recommendedFocusUuids),
    ...departmentFocusUuids(config, departments),
  ]);
}

function normalizeNameList(list = []) {
  const source = Array.isArray(list) ? list : String(list ?? "").split(/\r?\n/);
  const seen = new Set();
  const names = [];

  for (const value of source) {
    const name = String(value ?? "").trim();
    if (!name) continue;

    const key = name.toLocaleLowerCase(game.i18n.lang);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

function nameListToText(list = []) {
  return normalizeNameList(list).join("\n");
}

function mergeNameLists(current = [], incoming = []) {
  return normalizeNameList([
    ...normalizeNameList(current),
    ...normalizeNameList(incoming),
  ]);
}

function firstNamePoolForGender(species, gender = "any") {
  const maleFirstNames = normalizeNameList(species?.maleFirstNames);
  const femaleFirstNames = normalizeNameList(species?.femaleFirstNames);
  const legacyFirstNames = normalizeNameList(species?.firstNames);

  if (gender === "male") return maleFirstNames.length ? maleFirstNames : legacyFirstNames;
  if (gender === "female") return femaleFirstNames.length ? femaleFirstNames : legacyFirstNames;

  const pools = [maleFirstNames, femaleFirstNames].filter(pool => pool.length);
  if (pools.length) return pools[Math.floor(Math.random() * pools.length)];
  return legacyFirstNames;
}

function randomNameFromSpecies(species, gender = "any") {
  const firstNames = firstNamePoolForGender(species, gender);
  const surnames = normalizeNameList(species?.surnames);
  const firstName = firstNames.length ? firstNames[Math.floor(Math.random() * firstNames.length)] : "";
  const surname = surnames.length ? surnames[Math.floor(Math.random() * surnames.length)] : "";

  if (firstName && surname) {
    return species?.surnameFirst ? `${surname} ${firstName}` : `${firstName} ${surname}`;
  }

  return firstName || surname;
}

function hasSpeciesNames(species, gender = "any") {
  return firstNamePoolForGender(species, gender).length > 0 || normalizeNameList(species?.surnames).length > 0;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(file);
  });
}

function downloadTextFile(filename, contents, mimeType = "application/json") {
  if (typeof globalThis.saveDataToFile === "function") {
    globalThis.saveDataToFile(contents, mimeType, filename);
    return;
  }

  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const CC_SECTION_EXPORT_VERSION = 1;
const CC_SECTION_TYPE_PREFIX = "sta2e-toolkit.characterCreator.";

function normalizeConfigData(config = {}) {
  const talents = {};
  const sourceTalents = config?.talents ?? {};
  for (const category of TALENT_CATEGORIES) {
    const fallback = ["augment", "cybernetic"].includes(category.key) ? sourceTalents.augmentCybernetic : [];
    talents[category.key] = normalizeUuidList(sourceTalents[category.key] ?? fallback);
  }

  const departmentFocuses = {};
  const sourceDepartmentFocuses = config?.departmentFocuses ?? config?.focusesByDepartment ?? {};
  for (const key of DISCIPLINE_KEYS) {
    departmentFocuses[key] = normalizeUuidList(sourceDepartmentFocuses[key]);
  }

  return {
    talents,
    roles: normalizeUuidList(config?.roles),
    traits: normalizeUuidList(config?.traits),
    values: normalizeUuidList(config?.values),
    focuses: configuredFocusUuids({ ...config, departmentFocuses }),
    departmentFocuses,
    items: uniqueUuidList([
      ...normalizeUuidList(config?.items),
      ...normalizeUuidList(config?.equipment),
    ]),
    weapons: normalizeUuidList(config?.weapons),
    armor: normalizeUuidList(config?.armor),
  };
}

function normalizeUiData(ui = {}) {
  return {
    collapsedSpeciesIds: normalizeUuidList(ui?.collapsedSpeciesIds),
    collapsedEnvironmentIds: normalizeUuidList(ui?.collapsedEnvironmentIds),
    collapsedUpbringingIds: normalizeUuidList(ui?.collapsedUpbringingIds),
    collapsedCareerPathIds: normalizeUuidList(ui?.collapsedCareerPathIds),
    collapsedCareerEventIds: normalizeUuidList(ui?.collapsedCareerEventIds),
    collapsedConfigSections: normalizeUuidList(ui?.collapsedConfigSections),
  };
}

function normalizeEnvironment(row = {}) {
  const attributeMode = ["selected", "characterSpecies", "species", "any"].includes(row.attributeMode) ? row.attributeMode : "selected";
  const departmentMode = ["selected", "any"].includes(row.departmentMode) ? row.departmentMode : "selected";

  return {
    id: row.id || foundry.utils.randomID(),
    name: String(row.name ?? "").trim(),
    description: String(row.description ?? "").trim(),
    valueDescription: String(row.valueDescription ?? "").trim(),
    attributeDescription: String(row.attributeDescription ?? "").trim(),
    attributeMode,
    attributeChoices: ATTRIBUTE_KEYS.filter(key => Array.isArray(row.attributeChoices) && row.attributeChoices.includes(key)),
    departmentDescription: String(row.departmentDescription ?? "").trim(),
    departmentMode,
    departmentChoices: DISCIPLINE_KEYS.filter(key => Array.isArray(row.departmentChoices) && row.departmentChoices.includes(key)),
  };
}

function normalizeUpbringingPath(path = {}) {
  return {
    attributePlusOne: ATTRIBUTE_KEYS.includes(path.attributePlusOne) ? path.attributePlusOne : "",
    attributePlusTwo: ATTRIBUTE_KEYS.includes(path.attributePlusTwo) ? path.attributePlusTwo : "",
  };
}

function normalizeUpbringing(row = {}) {
  const allowAllDepartments = !!row.allowAllDepartments;
  const departmentChoices = DISCIPLINE_KEYS.filter(key => Array.isArray(row.departmentChoices) && row.departmentChoices.includes(key));
  return {
    id: row.id || foundry.utils.randomID(),
    name: String(row.name ?? "").trim(),
    description: String(row.description ?? "").trim(),
    acceptedDescription: String(row.acceptedDescription ?? "").trim(),
    rebelledDescription: String(row.rebelledDescription ?? "").trim(),
    accepted: normalizeUpbringingPath(row.accepted),
    rebelled: normalizeUpbringingPath(row.rebelled),
    departmentDescription: String(row.departmentDescription ?? "").trim(),
    allowAllDepartments,
    departmentChoices: allowAllDepartments ? departmentChoices : departmentChoices.slice(0, 3),
    focusDescription: String(row.focusDescription ?? "").trim(),
    recommendedFocusUuids: normalizeUuidList(row.recommendedFocusUuids),
    talentDescription: String(row.talentDescription ?? "").trim(),
    talentUuids: normalizeUuidList(row.talentUuids),
  };
}

function effectiveUpbringingDepartmentChoices(upbringing = {}) {
  return upbringing.allowAllDepartments ? DISCIPLINE_KEYS : normalizeUpbringing(upbringing).departmentChoices;
}

function normalizeCareerDepartments(row = {}) {
  const plusTwoRaw = Array.isArray(row.plusTwo) ? row.plusTwo : row.plusTwo ? [row.plusTwo] : [];
  const plusOneRaw = Array.isArray(row.plusOne) ? row.plusOne : row.plusOne ? [row.plusOne] : [];
  const plusTwo = DISCIPLINE_KEYS.filter(key => plusTwoRaw.includes(key));
  const plusOne = DISCIPLINE_KEYS.filter(key => plusOneRaw.includes(key));
  return { plusTwo, plusOne };
}

function inferCareerRequiredAttributes(text = "") {
  const source = String(text ?? "");
  if (!/\b(at least one|must|required)\b/i.test(source)) return [];
  return ATTRIBUTE_KEYS.filter(key => new RegExp(`\\b${ATTRIBUTE_LABELS[key]}\\b`, "i").test(source));
}

function inferCareerDepartmentReallocation(text = "") {
  const source = String(text ?? "");
  return /\breduce\b[\s\S]*\bdepartment\b[\s\S]*\badd\b[\s\S]*\bpoint\b/i.test(source);
}

function normalizeCareerRequiredAttributes(row = {}) {
  const hasExplicitRequirement = Object.prototype.hasOwnProperty.call(row, "requiredAttributes")
    || Object.prototype.hasOwnProperty.call(row, "requiredAttributeKeys");
  const raw = Array.isArray(row.requiredAttributes)
    ? row.requiredAttributes
    : Array.isArray(row.requiredAttributeKeys)
      ? row.requiredAttributeKeys
      : [];
  const explicit = ATTRIBUTE_KEYS.filter(key => raw.includes(key));
  return hasExplicitRequirement ? explicit : inferCareerRequiredAttributes(row.attributeDescription);
}

function normalizeCareerPath(row = {}) {
  const hasExplicitDepartmentReallocation = Object.prototype.hasOwnProperty.call(row, "departmentReallocationAllowed");
  return {
    id: row.id || foundry.utils.randomID(),
    name: String(row.name ?? "").trim(),
    description: String(row.description ?? "").trim(),
    traitDescription: String(row.traitDescription ?? "").trim(),
    traitUuids: normalizeUuidList(row.traitUuids),
    valueDescription: String(row.valueDescription ?? "").trim(),
    attributeDescription: String(row.attributeDescription ?? "").trim(),
    requiredAttributes: normalizeCareerRequiredAttributes(row),
    departmentDescription: String(row.departmentDescription ?? "").trim(),
    departmentReallocationAllowed: hasExplicitDepartmentReallocation
      ? !!row.departmentReallocationAllowed
      : inferCareerDepartmentReallocation(row.departmentDescription),
    departments: normalizeCareerDepartments(row.departments),
    focusDescription: String(row.focusDescription ?? "").trim(),
    recommendedFocusUuids: normalizeUuidList(row.recommendedFocusUuids),
    talentDescription: String(row.talentDescription ?? "").trim(),
    talentUuids: normalizeUuidList(row.talentUuids),
  };
}

function normalizeExperienceOption(row = {}) {
  const definition = EXPERIENCE_DEFINITIONS.find(def => def.key === row.key)
    ?? EXPERIENCE_DEFINITIONS.find(def => def.name.toLowerCase() === String(row.name ?? "").trim().toLowerCase())
    ?? EXPERIENCE_DEFINITIONS[0];
  return {
    key: definition.key,
    name: definition.name,
    talentMode: definition.talentMode,
    description: String(row.description ?? "").trim(),
    valueDescription: String(row.valueDescription ?? "").trim(),
    talentDescription: String(row.talentDescription ?? "").trim(),
    talentUuids: definition.talentMode === "configured" ? normalizeUuidList(row.talentUuids) : [],
  };
}

function normalizeExperienceOptions(options = []) {
  return EXPERIENCE_DEFINITIONS.map(definition => {
    const row = Array.isArray(options)
      ? options.find(option => option?.key === definition.key || String(option?.name ?? "").trim().toLowerCase() === definition.name.toLowerCase())
      : null;
    return normalizeExperienceOption({
      key: definition.key,
      name: definition.name,
      talentMode: definition.talentMode,
      ...(row ?? {}),
    });
  });
}

function normalizeCareerEvent(row = {}) {
  const attributeChoices = Array.isArray(row.attributeChoices)
    ? row.attributeChoices
    : row.attributeKey
      ? [row.attributeKey]
      : [];
  const departmentChoices = Array.isArray(row.departmentChoices)
    ? row.departmentChoices
    : row.departmentKey
      ? [row.departmentKey]
      : [];
  return {
    id: row.id || foundry.utils.randomID(),
    name: String(row.name ?? "").trim(),
    description: String(row.description ?? "").trim(),
    allowAnyAttribute: !!row.allowAnyAttribute,
    attributeChoices: ATTRIBUTE_KEYS.filter(key => attributeChoices.includes(key)),
    attributeKey: ATTRIBUTE_KEYS.includes(row.attributeKey) ? row.attributeKey : ATTRIBUTE_KEYS.filter(key => attributeChoices.includes(key))[0] ?? "presence",
    allowAnyDepartment: !!row.allowAnyDepartment,
    departmentChoices: DISCIPLINE_KEYS.filter(key => departmentChoices.includes(key)),
    departmentKey: DISCIPLINE_KEYS.includes(row.departmentKey) ? row.departmentKey : DISCIPLINE_KEYS.filter(key => departmentChoices.includes(key))[0] ?? "command",
    focusDescription: String(row.focusDescription ?? "").trim(),
    suggestedFocusUuids: normalizeUuidList(row.suggestedFocusUuids),
    traitGrant: !!row.traitGrant,
    traitDescription: String(row.traitDescription ?? "").trim(),
    suggestedTraitUuids: normalizeUuidList(row.suggestedTraitUuids),
  };
}

function normalizeRank(row = {}) {
  return {
    id: row.id || foundry.utils.randomID(),
    name: String(row.name ?? "").trim(),
    description: String(row.description ?? "").trim(),
  };
}

function normalizeFinishingData(finishing = {}) {
  const normalizeLoadoutMap = source => {
    const loadouts = {};
    if (!source || typeof source !== "object") return loadouts;
    for (const [key, equipmentUuids] of Object.entries(source)) {
      const uuid = String(key ?? "").trim();
      if (!uuid) continue;
      loadouts[uuid] = normalizeUuidList(equipmentUuids);
    }
    return loadouts;
  };
  const roleLoadouts = normalizeLoadoutMap(finishing?.roleLoadouts);
  const rankLoadouts = normalizeLoadoutMap(finishing?.rankLoadouts);
  const departmentLoadouts = normalizeLoadoutMap(finishing?.departmentLoadouts);
  const assignmentLoadouts = normalizeLoadoutMap(finishing?.assignmentLoadouts);
  const ranks = Array.isArray(finishing?.ranks)
    ? finishing.ranks.map(normalizeRank)
    : [];
  return { roleLoadouts, rankLoadouts, departmentLoadouts, assignmentLoadouts, ranks };
}

function selectedTalentNames(...talents) {
  return talents
    .filter(Boolean)
    .map(talent => String(talent.name ?? "").trim())
    .filter(Boolean);
}

function uniqueNameList(list = []) {
  const seen = new Set();
  const names = [];
  for (const value of list) {
    const name = String(value ?? "").trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase(game.i18n.lang);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function traitIdentityKeys(trait) {
  const keys = [];
  const uuid = String(trait?.uuid ?? "").trim();
  const name = String(trait?.name ?? "").trim();
  if (uuid) keys.push(`uuid:${uuid}`);
  if (name) keys.push(`name:${name.toLocaleLowerCase(game.i18n.lang)}`);
  return keys;
}

function isDuplicateTrait(trait, existingTraits = []) {
  const existing = new Set(existingTraits.flatMap(traitIdentityKeys));
  return traitIdentityKeys(trait).some(key => existing.has(key));
}

function hasUntappedPotential(...talents) {
  return selectedTalentNames(...talents).some(name => name.toLowerCase() === "untapped potential");
}

function scoreTotal(scores = {}, keys = []) {
  return keys.reduce((total, key) => total + (Number(scores[key] ?? 0) || 0), 0);
}

function departmentLabel(key) {
  return DISCIPLINE_LABELS[key] ?? key ?? "";
}

function normalizeScoreArrayAssignments(assignments = {}, keys = [], values = []) {
  const normalized = {};
  const available = [...values];

  for (const key of keys) {
    const requested = Number(assignments?.[key]);
    const index = available.indexOf(requested);
    if (index === -1) continue;
    normalized[key] = requested;
    available.splice(index, 1);
  }

  for (const key of keys) {
    if (normalized[key] != null) continue;
    const value = available.shift();
    if (value != null) normalized[key] = value;
  }

  return normalized;
}

function scoreArrayOptions(values = [], selectedValue = null) {
  const selected = Number(selectedValue);
  return values.map((value, index) => ({
    id: `${value}-${index}`,
    value,
    selected: value === selected,
  }));
}

function shuffledCopy(list = []) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomElement(list = []) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

function randomSample(list = [], count = 0) {
  return shuffledCopy(list).slice(0, Math.max(0, count));
}

function npcDefinitionForType(type = "") {
  return NPC_CHARACTER_TYPES.includes(type) ? CHARACTER_TYPE_DEFINITIONS[type] : null;
}

function npcTierLabel(type = "") {
  const definition = npcDefinitionForType(type);
  return definition?.name ?? "NPC";
}

function applyScoreSpends(scores, spends = {}, keys = []) {
  const updated = { ...scores };
  for (const key of keys) {
    const value = Number(spends?.[key] ?? 0) || 0;
    if (value) updated[key] = (updated[key] ?? 0) + value;
  }
  return updated;
}

function normalizeScoreSpends(spends = {}, keys = [], limit = 0, perKeyLimit = Infinity) {
  const normalized = {};
  let remaining = Math.max(0, Number(limit) || 0);
  for (const key of keys) {
    if (!remaining) break;
    const value = Math.max(0, Math.min(remaining, perKeyLimit, Number(spends?.[key] ?? 0) || 0));
    if (value) {
      normalized[key] = value;
      remaining -= value;
    }
  }
  return normalized;
}

function canIncreaseLimitedScore(scores, key, limit) {
  const max = Number(limit?.max ?? 0) || 0;
  if (!key || !(key in scores) || (scores[key] ?? 0) >= max) return false;
  if (limit?.singleMax && (scores[key] ?? 0) === max - 1) {
    return !Object.entries(scores).some(([scoreKey, value]) => scoreKey !== key && value >= max);
  }
  return true;
}

function calculateScoreCorrection(scores = {}, keys = [], limit = {}) {
  const corrected = {};
  let redistribution = 0;
  const max = Number(limit.max ?? 0) || 0;
  for (const key of keys) {
    const value = Number(scores[key] ?? 0) || 0;
    const next = max ? Math.min(value, max) : value;
    corrected[key] = next;
    redistribution += Math.max(0, value - next);
  }

  if (limit.singleMax && max) {
    let maxSeen = false;
    for (const key of keys) {
      if (corrected[key] !== max) continue;
      if (!maxSeen) {
        maxSeen = true;
        continue;
      }
      corrected[key] = max - 1;
      redistribution += 1;
    }
  }

  return { scores: corrected, redistribution };
}

function finalScoreContext(baseScores = {}, keys = [], labels = {}, limit = {}, redistributionSpends = {}, finalSpends = {}, finalSpendLimit = 2) {
  const correction = calculateScoreCorrection(baseScores, keys, limit);
  const redistribution = normalizeScoreSpends(redistributionSpends, keys, correction.redistribution);
  let afterRedistribution = { ...correction.scores };
  for (const key of keys) {
    const requested = redistribution[key] ?? 0;
    let applied = 0;
    while (applied < requested && canIncreaseLimitedScore(afterRedistribution, key, limit)) {
      afterRedistribution[key] += 1;
      applied += 1;
    }
    if (applied !== requested) redistribution[key] = applied;
    if (!redistribution[key]) delete redistribution[key];
  }

  const final = normalizeScoreSpends(finalSpends, keys, finalSpendLimit, 1);
  let scores = { ...afterRedistribution };
  for (const key of keys) {
    const requested = final[key] ?? 0;
    let applied = 0;
    while (applied < requested && canIncreaseLimitedScore(scores, key, limit)) {
      scores[key] += 1;
      applied += 1;
    }
    if (applied !== requested) final[key] = applied;
    if (!final[key]) delete final[key];
  }

  return {
    scores,
    correction,
    redistribution,
    final,
    redistributionRemaining: Math.max(0, correction.redistribution - scoreTotal(redistribution, keys)),
    finalRemaining: Math.max(0, finalSpendLimit - scoreTotal(final, keys)),
    rows: keys.map(key => ({
      key,
      label: labels[key],
      base: baseScores[key] ?? 0,
      corrected: correction.scores[key] ?? 0,
      redistribution: redistribution[key] ?? 0,
      final: final[key] ?? 0,
      value: scores[key] ?? 0,
      correctedDown: (baseScores[key] ?? 0) > (correction.scores[key] ?? 0),
      canAddRedistribution: scoreTotal(redistribution, keys) < correction.redistribution && canIncreaseLimitedScore(afterRedistribution, key, limit),
      canRemoveRedistribution: (redistribution[key] ?? 0) > 0,
      canAddFinal: (final[key] ?? 0) < 1 && scoreTotal(final, keys) < finalSpendLimit && canIncreaseLimitedScore(scores, key, limit),
      canRemoveFinal: (final[key] ?? 0) > 0,
    })),
  };
}

function cloneCreatorData(data = null) {
  return foundry.utils.deepClone({
    ...CHARACTER_CREATOR_DEFAULT_DATA,
    ...(data ?? {}),
    config: normalizeConfigData(data?.config),
    ui: normalizeUiData(data?.ui),
    talentPacks: Array.isArray(data?.talentPacks) ? data.talentPacks : [],
    species: Array.isArray(data?.species) ? data.species : [],
    environments: Array.isArray(data?.environments) ? data.environments : [],
    upbringings: Array.isArray(data?.upbringings) ? data.upbringings : [],
    careerPaths: Array.isArray(data?.careerPaths) ? data.careerPaths : [],
    experienceOptions: normalizeExperienceOptions(data?.experienceOptions),
    careerEvents: Array.isArray(data?.careerEvents) ? data.careerEvents : [],
    finishing: normalizeFinishingData(data?.finishing),
    talentRequirements: data?.talentRequirements ?? {},
  });
}

export function getCreatorData() {
  let data = null;
  try { data = game.settings.get(MODULE, "characterCreatorData"); }
  catch { data = null; }
  return cloneCreatorData(data);
}

function selectedAttributeOptions(selected = []) {
  const selectedSet = new Set(selected);
  return ATTRIBUTE_KEYS.map(key => ({
    key,
    label: ATTRIBUTE_LABELS[key],
    selected: selectedSet.has(key),
  }));
}

function selectedDisciplineOptions(selected = []) {
  const selectedSet = new Set(selected);
  return DISCIPLINE_KEYS.map(key => ({
    key,
    label: DISCIPLINE_LABELS[key],
    selected: selectedSet.has(key),
  }));
}

function selectedSingleAttributeOptions(selected = "") {
  return ATTRIBUTE_KEYS.map(key => ({
    key,
    label: ATTRIBUTE_LABELS[key],
    selected: key === selected,
  }));
}

function selectedSingleDisciplineOptions(selected = "") {
  return DISCIPLINE_KEYS.map(key => ({
    key,
    label: DISCIPLINE_LABELS[key],
    selected: key === selected,
  }));
}

function careerEventAttributeChoices(event = {}) {
  if (!event) return [];
  return event.allowAnyAttribute ? ATTRIBUTE_KEYS : ATTRIBUTE_KEYS.filter(key => event.attributeChoices?.includes(key));
}

function careerEventDepartmentChoices(event = {}) {
  if (!event) return [];
  return event.allowAnyDepartment ? DISCIPLINE_KEYS : DISCIPLINE_KEYS.filter(key => event.departmentChoices?.includes(key));
}

function formatRequirement(req) {
  if (!req) return "";
  if (req.type === "attribute") return `${ATTRIBUTE_LABELS[req.key] ?? req.key} ${req.min}+`;
  if (req.type === "discipline") return `${DISCIPLINE_LABELS[req.key] ?? req.key} ${req.min}+`;
  if (req.type === "species") return `${req.name}`;
  if (req.type === "trait") return `${req.name} trait`;
  if (req.type === "traitAny") return req.label ?? `${(req.names ?? []).join(" or ")} trait`;
  return req.label ?? "";
}

function normalizeTalentTypeInfo(item) {
  const talentType = item?.system?.talenttype ?? item?.system?.talentType ?? {};
  const type = String(talentType.typeenum ?? talentType.type ?? talentType.category ?? "").trim().toLowerCase();
  const description = String(talentType.description ?? talentType.label ?? "").trim();
  const minimum = Number(talentType.minimum ?? talentType.min ?? 0);
  return {
    type,
    description,
    minimum: Number.isFinite(minimum) ? minimum : 0,
  };
}

function disciplineKeyFromLabel(label = "") {
  const normalized = String(label).trim().toLowerCase().replace(/[^a-z]/g, "");
  if (DISCIPLINE_ALIASES[normalized]) return DISCIPLINE_ALIASES[normalized];
  for (const [alias, key] of Object.entries(DISCIPLINE_ALIASES)) {
    if (normalized.includes(alias)) return key;
  }
  return "";
}

function attributeKeyFromLabel(label = "") {
  const normalized = String(label).trim().toLowerCase().replace(/[^a-z]/g, "");
  return ATTRIBUTE_KEYS.find(key => key === normalized || ATTRIBUTE_LABELS[key].toLowerCase() === normalized) ?? "";
}

function textFromHtml(html = "") {
  return String(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function talentTypeRequirements(item) {
  const info = normalizeTalentTypeInfo(item);
  if (info.type !== "discipline") return [];

  const key = disciplineKeyFromLabel(info.description);
  const min = Number(info.minimum ?? 0);
  if (!key || !min) return [];

  return [{
    type: "discipline",
    key,
    min,
    source: "talenttype",
  }];
}

function descriptionRequirements(item) {
  const text = textFromHtml(descriptionForDoc(item));
  if (!text) return [];

  const requirements = [];
  const scorePattern = /\b(Control|Daring|Fitness|Insight|Presence|Reason|Command|Conn|Engineering|Medicine|Medical|Science|Security)\s+(\d+)\s*\+/gi;
  for (const match of text.matchAll(scorePattern)) {
    const label = match[1];
    const min = Number(match[2]);
    const attributeKey = attributeKeyFromLabel(label);
    if (attributeKey) {
      requirements.push({ type: "attribute", key: attributeKey, min, source: "description" });
      continue;
    }

    const disciplineKey = disciplineKeyFromLabel(label);
    if (disciplineKey) {
      requirements.push({ type: "discipline", key: disciplineKey, min, source: "description" });
    }
  }
  if (/\bAugment or Cyborg trait\b/i.test(text)) {
    requirements.push({ type: "traitAny", names: ["Augment", "Cyborg"], label: "Augment or Cyborg trait", source: "description" });
  } else {
    if (/\bAugment trait\b/i.test(text)) requirements.push({ type: "trait", name: "Augment", source: "description" });
    if (/\bCyborg trait\b/i.test(text)) requirements.push({ type: "trait", name: "Cyborg", source: "description" });
  }

  return requirements;
}

function uniqueRequirements(requirements = []) {
  const seen = new Set();
  const unique = [];
  for (const req of requirements) {
    const key = `${req.type}:${req.key ?? req.name ?? req.label ?? ""}:${req.min ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(req);
  }
  return unique;
}

function talentTypeLabel(item) {
  const info = normalizeTalentTypeInfo(item);
  if (!info.type) return "";
  const typeLabel = info.type.charAt(0).toUpperCase() + info.type.slice(1);
  if (info.type === "discipline" && info.description) {
    return `${typeLabel}: ${DISCIPLINE_LABELS[disciplineKeyFromLabel(info.description)] ?? info.description}${info.minimum ? ` ${info.minimum}+` : ""}`;
  }
  return info.description ? `${typeLabel}: ${info.description}` : typeLabel;
}

function isEsotericTalent(item, data = getCreatorData(), uuid = item?.uuid ?? "") {
  const info = normalizeTalentTypeInfo(item);
  if (info.type === "esoteric") return true;
  return normalizeUuidList(data.config?.talents?.esoteric).includes(uuid);
}

function talentSpecialAccess(item, data = getCreatorData(), uuid = item?.uuid ?? "") {
  const info = normalizeTalentTypeInfo(item);
  const typeKey = info.type.replace(/[^a-z]/g, "");
  const description = textFromHtml(descriptionForDoc(item));
  const configuredAugment = normalizeUuidList(data.config?.talents?.augment).includes(uuid);
  const configuredCybernetic = normalizeUuidList(data.config?.talents?.cybernetic).includes(uuid);
  const augmentOrCybernetic = info.type === "augmentcybernetic"
    || (configuredAugment && configuredCybernetic)
    || /\bAugment or Cyborg trait\b/i.test(description);

  return {
    augment: augmentOrCybernetic
      || configuredAugment
      || info.type === "augment"
      || /\bAugment trait\b/i.test(description),
    cybernetic: augmentOrCybernetic
      || configuredCybernetic
      || info.type === "cybernetic"
      || /\b(Cyborg|Cybernetic) trait\b/i.test(description),
    augmentOrCybernetic,
    borgImplant: normalizeUuidList(data.config?.talents?.borgImplant).includes(uuid)
      || ["borg", "borgimplant"].includes(typeKey),
    npc: normalizeUuidList(data.config?.talents?.npc).includes(uuid)
      || info.type === "npc"
      || /\bNPC\b/i.test(info.description),
  };
}

function isTalentAllowedBySpecialAccess(item, data, uuid, options = {}) {
  const access = talentSpecialAccess(item, data, uuid);
  if (access.npc && !options.includeNpc) return false;
  if (access.borgImplant && !options.includeBorgImplants) return false;
  if (access.augmentOrCybernetic && !(options.includeAugment || options.includeCybernetic)) return false;
  if (access.augment && !access.augmentOrCybernetic && !options.includeAugment) return false;
  if (access.cybernetic && !access.augmentOrCybernetic && !options.includeCybernetic) return false;
  return true;
}

function hasTraitAccessName(names = new Set(), traitName = "") {
  const required = normalizeAccessName(traitName);
  if (!required) return false;
  return Array.from(names).map(normalizeAccessName).some(name => name === required || name.includes(required));
}

function specialTalentAccessOptions(names = new Set()) {
  return {
    includeAugment: hasTraitAccessName(names, "augment"),
    includeCybernetic: hasTraitAccessName(names, "cyborg") || hasTraitAccessName(names, "cybernetic"),
    includeBorgImplants: hasTraitAccessName(names, "liberated borg"),
  };
}

function talentNormalizedName(item) {
  return String(item?.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function boldCautiousTalentInfo(item) {
  const match = String(item?.name ?? "").match(/^\s*(Bold|Cautious)\s*\(([^)]+)\)/i);
  if (!match) return null;
  const discipline = disciplineKeyFromLabel(match[2]);
  if (!discipline) return null;
  return {
    side: match[1].toLowerCase(),
    discipline,
  };
}

function talentPairKey(info) {
  return info ? `boldCautious:${info.side}:${info.discipline}` : "";
}

function oppositeBoldCautiousKey(info) {
  if (!info) return "";
  return talentPairKey({
    side: info.side === "bold" ? "cautious" : "bold",
    discipline: info.discipline,
  });
}

async function buildTalentBlockList(uuids = []) {
  const blockedUuids = new Set();
  const blockedNames = new Set();
  const blockedPairKeys = new Set();

  const entries = await Promise.all(normalizeUuidList(uuids).map(async uuid => ({
    uuid,
    doc: await resolveUuidDoc(uuid),
  })));

  for (const { uuid, doc } of entries) {
    blockedUuids.add(uuid);
    const name = talentNormalizedName(doc);
    if (name) blockedNames.add(name);
    const oppositeKey = oppositeBoldCautiousKey(boldCautiousTalentInfo(doc));
    if (oppositeKey) blockedPairKeys.add(oppositeKey);
  }

  return { blockedUuids, blockedNames, blockedPairKeys };
}

function readTalentRequirements(item, data = getCreatorData()) {
  const uuid = item?.uuid;
  const flagRequirements =
    item?.getFlag?.(MODULE, "creator.requirements")
    ?? item?.getFlag?.(MODULE, "requirements")
    ?? null;
  const configured = uuid ? data.talentRequirements?.[uuid] : null;
  const requirements = Array.isArray(configured)
    ? configured
    : Array.isArray(flagRequirements)
      ? flagRequirements
      : [];
  return [
    ...uniqueRequirements([
      ...requirements,
      ...talentTypeRequirements(item),
      ...descriptionRequirements(item),
    ]),
  ];
}

function isRequirementMet(req, preview, speciesNames) {
  if (!req) return true;
  if (req.type === "attribute") return (preview.attributes?.[req.key] ?? 0) >= Number(req.min ?? 0);
  if (req.type === "discipline") return (preview.disciplines?.[req.key] ?? 0) >= Number(req.min ?? 0);
  if (req.type === "species") return speciesNames.has(String(req.name ?? "").toLowerCase());
  if (req.type === "trait") {
    const required = String(req.name ?? "").toLowerCase();
    return Array.from(speciesNames).some(name => name === required || name.includes(required));
  }
  if (req.type === "traitAny") {
    return (req.names ?? []).some(requiredName => {
      const required = String(requiredName).toLowerCase();
      return Array.from(speciesNames).some(name => name === required || name.includes(required));
    });
  }
  return true;
}

async function resolveUuidDoc(uuid) {
  const key = String(uuid ?? "").trim();
  if (!key) return null;
  if (!UUID_DOC_CACHE.has(key)) {
    UUID_DOC_CACHE.set(key, (async () => {
      try { return await fromUuid(key); }
      catch (err) {
        console.warn(`STA2e Toolkit | Character Creator could not resolve ${key}:`, err);
        return null;
      }
    })());
  }
  return UUID_DOC_CACHE.get(key);
}

function descriptionForDoc(doc) {
  const description = doc?.system?.description;
  if (typeof description === "string") return description;
  if (typeof description?.value === "string") return description.value;
  return "";
}

function isAllowedConfigItemType(item, configType) {
  const allowedTypes = CONFIG_ITEM_TYPES[configType];
  if (!allowedTypes) return true;
  return allowedTypes.includes(item?.type);
}

function allowedConfigItemTypeLabel(configType) {
  return CONFIG_ITEM_TYPES[configType]?.join(", ") ?? "item";
}

async function droppedItemFromEvent(event) {
  const data = dropDataFromEvent(event);
  if (!isDropDataType(data, "Item")) return null;

  try {
    return await Item.implementation.fromDropData(data);
  } catch (err) {
    console.warn("STA2e Toolkit | Character Creator item drop failed:", err);
    return null;
  }
}

function dropDataFromEvent(event) {
  const raw = event.dataTransfer?.getData("text/plain");
  if (!raw) return null;

  try { return JSON.parse(raw); }
  catch { return null; }
}

function isDropDataType(data, documentName) {
  return data?.type === documentName || data?.documentName === documentName;
}

async function droppedFolderFromData(data) {
  if (!isDropDataType(data, "Folder")) return null;

  try {
    if (Folder.implementation?.fromDropData) {
      const folder = await Folder.implementation.fromDropData(data);
      if (folder) return folder;
    }
  } catch (err) {
    console.warn("STA2e Toolkit | Character Creator folder drop failed:", err);
  }

  if (data.uuid) {
    const doc = await resolveUuidDoc(data.uuid);
    if (doc?.documentName === "Folder") return doc;
  }

  if (data.pack && data.id) {
    const pack = game.packs.get(data.pack);
    const folder = pack?.folders?.get?.(data.id) ?? pack?.folders?.find?.(f => f.id === data.id);
    if (folder) return folder;
  }

  if (data.id) return game.folders.get(data.id) ?? null;
  return null;
}

function collectChildFolders(folder) {
  const children = [];

  for (const child of folder?.children ?? []) {
    if (child?.folder) children.push(child.folder);
    else if (child?.documentName === "Folder") children.push(child);
  }

  if (folder?.getSubfolders) {
    for (const child of folder.getSubfolders(false) ?? []) children.push(child);
  }

  return children;
}

function collectFolderIds(folder, seen = new Set()) {
  if (!folder || seen.has(folder.id)) return seen;
  seen.add(folder.id);
  for (const child of collectChildFolders(folder)) collectFolderIds(child, seen);
  return seen;
}

async function collectItemsFromFolder(folder) {
  if (!folder) return [];
  if (folder.type && folder.type !== "Item") return [];

  const items = [];
  const seenUuids = new Set();
  const addItem = item => {
    if (!item || item.documentName !== "Item" || seenUuids.has(item.uuid)) return;
    seenUuids.add(item.uuid);
    items.push(item);
  };

  const collectLoaded = currentFolder => {
    for (const doc of currentFolder?.contents ?? []) addItem(doc);
    for (const child of collectChildFolders(currentFolder)) collectLoaded(child);
  };

  collectLoaded(folder);

  if (folder.pack) {
    const pack = game.packs.get(folder.pack);
    const folderIds = collectFolderIds(folder);
    try {
      const documents = await pack?.getDocuments?.();
      for (const doc of documents ?? []) {
        const folderId = doc.folder?.id ?? doc.folder;
        if (folderIds.has(folderId)) addItem(doc);
      }
    } catch (err) {
      console.warn("STA2e Toolkit | Character Creator could not read compendium folder contents:", err);
    }
  }

  return items;
}

async function prepareUuidListForContext(uuids) {
  return Promise.all(normalizeUuidList(uuids).map(async uuid => {
    const doc = await resolveUuidDoc(uuid);
    return {
      uuid,
      name: doc?.name ?? uuid,
      type: doc?.type ?? "",
      description: descriptionForDoc(doc),
    };
  }));
}

function normalizeSpecies(row = {}) {
  const traitUuids = uniqueUuidList([
    ...normalizeUuidList(row.traitUuids),
    row.traitUuid,
  ]);
  const speciesEsotericTalentUuids = uniqueUuidList(row.speciesEsotericTalentUuids);
  return {
    id: row.id || foundry.utils.randomID(),
    name: String(row.name ?? "").trim(),
    trait: String(row.trait ?? "").trim(),
    traitUuid: traitUuids[0] ?? "",
    traitUuids,
    description: String(row.description ?? "").trim(),
    tokenImage: String(row.tokenImage ?? row.img ?? "").trim(),
    extraFocusCount: normalizeExtraFocusCount(row.extraFocusCount ?? row.speciesFocusCount),
    freeAttributeSelection: !!row.freeAttributeSelection,
    attributeBoosts: ATTRIBUTE_KEYS.filter(key => Array.isArray(row.attributeBoosts) && row.attributeBoosts.includes(key)).slice(0, 3),
    attributeChoiceBoosts: ATTRIBUTE_KEYS.filter(key => Array.isArray(row.attributeChoiceBoosts) && row.attributeChoiceBoosts.includes(key)),
    speciesAbilityUuid: String(row.speciesAbilityUuid ?? "").trim(),
    speciesTalentUuids: Array.isArray(row.speciesTalentUuids)
      ? row.speciesTalentUuids.map(u => String(u).trim()).filter(Boolean)
      : [],
    speciesValueUuids: Array.isArray(row.speciesValueUuids)
      ? row.speciesValueUuids.map(u => String(u).trim()).filter(Boolean)
      : [],
    speciesEsotericTalentCount: normalizeSpeciesEsotericTalentCount(row.speciesEsotericTalentCount ?? row.esotericTalentCount, speciesEsotericTalentUuids),
    speciesEsotericTalentUuids,
    maleFirstNames: normalizeNameList(row.maleFirstNames ?? row.firstNames),
    femaleFirstNames: normalizeNameList(row.femaleFirstNames ?? row.firstNames),
    firstNames: normalizeNameList(row.firstNames),
    surnames: normalizeNameList(row.surnames),
    surnameFirst: !!row.surnameFirst,
  };
}

async function prepareSpeciesForContext(species, creatorData) {
  const prepareTalents = async uuids => Promise.all(normalizeUuidList(uuids).map(async uuid => {
    const doc = await resolveUuidDoc(uuid);
    const requirements = readTalentRequirements(doc, creatorData);
    return {
      uuid,
      name: doc?.name ?? uuid,
      description: descriptionForDoc(doc),
      typeLabel: talentTypeLabel(doc),
      requirements,
      requirementLabel: requirements.map(formatRequirement).filter(Boolean).join(", "),
    };
  }));

  const traitUuids = uniqueUuidList([
    ...normalizeUuidList(species.traitUuids),
    species.traitUuid,
  ]);

  const [traitDocs, abilityDoc, talents, esotericTalents, values] = await Promise.all([
    Promise.all(traitUuids.map(resolveUuidDoc)),
    resolveUuidDoc(species.speciesAbilityUuid),
    prepareTalents(species.speciesTalentUuids),
    prepareTalents(species.speciesEsotericTalentUuids),
    prepareUuidListForContext(species.speciesValueUuids ?? []),
  ]);
  const abilityName = abilityDoc?.name ?? species.speciesAbilityUuid ?? "";
  esotericTalents.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang, { sensitivity: "base" }));
  const traits = traitUuids.map((uuid, index) => {
    const doc = traitDocs[index];
    return {
      uuid,
      name: doc?.name || (index === 0 ? species.trait : "") || uuid,
      type: doc?.type ?? "",
      description: descriptionForDoc(doc),
    };
  }).filter(trait => trait.name);
  const primaryTrait = traits[0] ?? null;

  return {
    ...species,
    traits,
    traitName: primaryTrait?.name ?? species.trait ?? species.traitUuid ?? "",
    traitUuid: primaryTrait?.uuid ?? "",
    traitUuids,
    traitDescription: primaryTrait?.description ?? "",
    abilityName,
    abilityDescription: descriptionForDoc(abilityDoc),
    talents,
    esotericTalents,
    values,
    attributes: selectedAttributeOptions(species.attributeBoosts),
    attributeChoices: selectedAttributeOptions(species.attributeChoiceBoosts),
    attributeChoiceLabel: selectedAttributeOptions(species.attributeChoiceBoosts)
      .filter(attr => attr.selected)
      .map(attr => attr.label)
      .join(" or "),
    freeAttributeSelection: !!species.freeAttributeSelection,
  };
}

function buildStepOnePreview(primarySpecies, secondarySpecies = null) {
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key, 7]));
  const disciplines = Object.fromEntries(DISCIPLINE_KEYS.map(key => [key, 1]));

  for (const key of primarySpecies?.attributeBoosts ?? []) {
    if (key in attributes) attributes[key] += 1;
  }

  const traits = [];
  for (const trait of primarySpecies?.traits ?? []) {
    if (trait?.name) traits.push(trait.name);
  }
  if (!traits.length) {
    const traitName = primarySpecies?.traitName ?? primarySpecies?.trait ?? "";
    if (traitName) traits.push(traitName);
  }

  return {
    attributes,
    disciplines,
    traits,
    primarySpeciesName: primarySpecies?.name ?? "",
    secondarySpeciesName: secondarySpecies?.name ?? "",
  };
}

function applyEnvironmentPreview(preview, environmentState = {}) {
  const attribute = environmentState.attribute;
  if (attribute && attribute in preview.attributes) preview.attributes[attribute] += 1;

  const department = environmentState.department;
  if (department && department in preview.disciplines) preview.disciplines[department] += 1;
}

function applyUpbringingPreview(preview, upbringing, pathKey = "accepted", department = "") {
  const path = pathKey === "rebelled" ? upbringing?.rebelled : upbringing?.accepted;
  const attributePlusOne = path?.attributePlusOne;
  if (attributePlusOne && attributePlusOne in preview.attributes) preview.attributes[attributePlusOne] += 1;

  const attributePlusTwo = path?.attributePlusTwo;
  if (attributePlusTwo && attributePlusTwo in preview.attributes) preview.attributes[attributePlusTwo] += 2;

  if (department && department in preview.disciplines) preview.disciplines[department] += 1;
}

function normalizeCareerAttributeSpends(spends = {}) {
  const normalized = {};
  for (const key of ATTRIBUTE_KEYS) {
    const value = Math.max(0, Math.min(2, Number(spends?.[key] ?? 0) || 0));
    if (value) normalized[key] = value;
  }
  return normalized;
}

function careerAttributeSpendTotal(spends = {}) {
  return ATTRIBUTE_KEYS.reduce((total, key) => total + (Number(spends?.[key] ?? 0) || 0), 0);
}

function careerAttributeRequirementMet(spends = {}, requiredAttributes = []) {
  const required = normalizeCareerRequiredAttributes({ requiredAttributes });
  return !required.length || required.some(key => (Number(spends?.[key] ?? 0) || 0) > 0);
}

function applyCareerPreview(preview, attributeSpends = {}, careerDepartments = {}) {
  for (const key of ATTRIBUTE_KEYS) {
    const value = Number(attributeSpends?.[key] ?? 0) || 0;
    if (value && key in preview.attributes) preview.attributes[key] += value;
  }

  const plusTwo = careerDepartments?.plusTwo;
  if (plusTwo && plusTwo in preview.disciplines) preview.disciplines[plusTwo] += 2;

  for (const key of careerDepartments?.plusOne ?? []) {
    if (key in preview.disciplines) preview.disciplines[key] += 1;
  }

  const reallocationFrom = careerDepartments?.reallocationFrom;
  const reallocationTo = careerDepartments?.reallocationTo;
  if (reallocationFrom && reallocationTo && reallocationFrom in preview.disciplines && reallocationTo in preview.disciplines) {
    preview.disciplines[reallocationFrom] -= 1;
    preview.disciplines[reallocationTo] += 1;
  }
}

function jemHadarHatcheryByKey(key = "") {
  return JEM_HADAR_HATCHERIES.find(hatchery => hatchery.key === key) ?? JEM_HADAR_HATCHERIES[0];
}

function findStarfleetEnlistedCareerPath(careerPaths = []) {
  return careerPaths.find(path => {
    const name = normalizeAccessName(path?.name);
    return name.includes("starfleet") && name.includes("enlisted");
  }) ?? null;
}

function vortaCareerPathOptions(careerPaths = []) {
  const exact = careerPaths.filter(path => VORTA_CAREER_NAMES.includes(normalizeAccessName(path?.name)));
  if (exact.length) return exact;
  return careerPaths.filter(path => {
    const name = normalizeAccessName(path?.name);
    return name.includes("diplomatic corps")
      || (name.includes("civilian") && (name.includes("physician") || name.includes("scientist") || name.includes("official")));
  });
}

function applyJemHadarHatcheryPreview(preview, hatchery, selectedAttribute = "", selectedDepartment = "") {
  for (const key of hatchery?.attributes ?? []) {
    if (key in preview.attributes) preview.attributes[key] += 1;
  }
  if (selectedAttribute && (hatchery?.attributes ?? []).includes(selectedAttribute) && selectedAttribute in preview.attributes) {
    preview.attributes[selectedAttribute] += 1;
  }

  const fixedDepartment = hatchery?.department;
  if (fixedDepartment && fixedDepartment in preview.disciplines) preview.disciplines[fixedDepartment] += 1;
  if (selectedDepartment && selectedDepartment !== fixedDepartment && selectedDepartment in preview.disciplines) {
    preview.disciplines[selectedDepartment] += 1;
  }
}

function applyVortaCloningPreview(preview, attributes = [], attributeChoice = "", departments = []) {
  for (const key of attributes ?? []) {
    if (key in preview.attributes) preview.attributes[key] += 1;
  }
  if (attributeChoice && (attributes ?? []).includes(attributeChoice) && attributeChoice in preview.attributes) {
    preview.attributes[attributeChoice] += 1;
  }
  for (const key of departments ?? []) {
    if (key in preview.disciplines) preview.disciplines[key] += 1;
  }
}

function applyCareerEventsPreview(preview, selectedEvents = []) {
  for (const event of selectedEvents) {
    if (event?.attributeKey && event.attributeKey in preview.attributes) preview.attributes[event.attributeKey] += 1;
    if (event?.departmentKey && event.departmentKey in preview.disciplines) preview.disciplines[event.departmentKey] += 1;
  }
}

function allConfiguredTalentUuids(config = {}, options = {}) {
  const uuids = [];
  const sourceTalents = config?.talents ?? {};
  for (const category of TALENT_CATEGORIES) {
    if (category.key === "esoteric" && !options.includeEsoteric) continue;
    if (category.key === "augment" && !options.includeAugment) continue;
    if (category.key === "cybernetic" && !options.includeCybernetic) continue;
    if (category.key === "borgImplant" && !options.includeBorgImplantCategory) continue;
    if (category.key === "npc" && !options.includeNpc) continue;
    uuids.push(...normalizeUuidList(sourceTalents[category.key]));
  }
  return uniqueUuidList(uuids);
}

async function prepareTalentChoicesForContext(uuids, data, preview, speciesNames, selectedUuid = "", options = {}) {
  const choices = [];
  const entries = await Promise.all(uniqueUuidList(uuids).map(async uuid => ({
    uuid,
    doc: await resolveUuidDoc(uuid),
  })));

  for (const { uuid, doc } of entries) {
    if (!options.includeEsoteric && isEsotericTalent(doc, data, uuid)) continue;
    if (!isTalentAllowedBySpecialAccess(doc, data, uuid, options)) continue;
    if (uuid !== selectedUuid) {
      if (options.blockedTalents?.blockedUuids?.has(uuid)) continue;
      const normalizedName = talentNormalizedName(doc);
      if (normalizedName && options.blockedTalents?.blockedNames?.has(normalizedName)) continue;
      const pairKey = talentPairKey(boldCautiousTalentInfo(doc));
      if (pairKey && options.blockedTalents?.blockedPairKeys?.has(pairKey)) continue;
    }

    const requirements = readTalentRequirements(doc, data);
    const unmet = requirements.filter(req => !isRequirementMet(req, preview, speciesNames));
    if (options.hideUnavailableScoreRequirements && unmet.some(req => req.type === "attribute" || req.type === "discipline")) {
      continue;
    }
    if (options.hideUnavailableDiscipline && unmet.some(req => req.type === "discipline" && req.source === "talenttype")) {
      continue;
    }
    choices.push({
      uuid,
      name: doc?.name ?? uuid,
      description: descriptionForDoc(doc),
      typeLabel: talentTypeLabel(doc),
      requirementLabel: requirements.map(formatRequirement).filter(Boolean).join(", "),
      available: unmet.length === 0,
      unavailableReason: unmet.map(formatRequirement).filter(Boolean).join(", "),
      selected: uuid === selectedUuid,
    });
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang, { sensitivity: "base" }));
}

function setActiveConfigTab(element, tab = "config") {
  const activeTab = tab || "config";
  element.querySelectorAll("[data-cc-config-tab]").forEach(button => {
    button.classList.toggle("is-active", button.dataset.ccConfigTab === activeTab);
  });
  element.querySelectorAll("[data-cc-config-panel]").forEach(panel => {
    panel.hidden = panel.dataset.ccConfigPanel !== activeTab;
  });
}

function setActiveConfigSubtab(element, group, tab) {
  if (!group || !tab) return;
  element.querySelectorAll(`[data-cc-subtab-group="${group}"]`).forEach(button => {
    button.classList.toggle("is-active", button.dataset.ccSubtab === tab);
  });
  element.querySelectorAll(`[data-cc-subtab-panel-group="${group}"]`).forEach(panel => {
    panel.hidden = panel.dataset.ccSubtabPanel !== tab;
  });
}

function setActiveCreatorTab(element, group, tab) {
  if (!group || !tab) return;
  element.querySelectorAll(`[data-cc-creator-tab-group="${group}"]`).forEach(button => {
    button.classList.toggle("is-active", button.dataset.ccCreatorTab === tab);
  });
  element.querySelectorAll(`[data-cc-creator-panel-group="${group}"]`).forEach(panel => {
    panel.hidden = panel.dataset.ccCreatorPanel !== tab;
  });
}

function cleanEmbeddedItemData(data = {}) {
  const item = foundry.utils.deepClone(data);
  delete item._id;
  delete item.folder;
  delete item.ownership;
  delete item.sort;
  delete item._stats;
  return item;
}

async function embeddedItemDataFromUuid(uuid) {
  const doc = await resolveUuidDoc(uuid);
  if (!doc) return null;
  return cleanEmbeddedItemData(doc.toObject());
}

function customEmbeddedItemData(type, name, description = "") {
  const system = type === "value"
    ? { used: false, description }
    : type === "trait"
      ? { description, quantity: 1 }
      : type === "talent"
        ? {
          description,
          talenttype: {
            typeenum: "npc",
            description: "",
            minimum: 0,
          },
        }
        : { description };
  return {
    name,
    type,
    img: "systems/sta/assets/icons/VoyagerCombadgeIcon.png",
    system,
  };
}

function defaultSupportingUnarmedItems() {
  return [
    {
      name: "Unarmed Strike",
      type: "characterweapon2e",
      img: "systems/sta/assets/compendia/icons/weapons-core/unarmed-strike.webp",
      system: {
        description: "",
        damage: 2,
        range: "melee",
        hands: 1,
        severity: 0,
        opportunity: 0,
        escalation: 0,
        qualities: {
          deadly: false,
          stun: true,
          accurate: false,
          area: false,
          charge: false,
          cumbersome: false,
          debilitating: false,
          grenade: false,
          inaccurate: false,
          intense: false,
          piercingx: false,
          hiddenx: 0,
        },
      },
      effects: [],
      flags: {},
    },
    {
      name: "Unarmed Strike",
      type: "characterweapon",
      img: "systems/sta/assets/compendia/icons/weapons-core/unarmed-strike.webp",
      effects: [],
      flags: { core: {} },
      system: {
        description: "",
        damage: 1,
        range: "melee",
        hands: 1,
        qualities: {
          area: false,
          intense: false,
          knockdown: true,
          accurate: false,
          charge: false,
          cumbersome: false,
          deadly: false,
          debilitating: false,
          grenade: false,
          inaccurate: false,
          nonlethal: true,
          hiddenx: 0,
          piercingx: 0,
          viciousx: 0,
        },
        opportunity: null,
        escalation: null,
      },
    },
  ];
}

function addUniqueItemData(items, item, keyHint = "") {
  if (!item?.name || !item?.type) return;
  const key = keyHint || `${item.type}:${item.name}`.toLowerCase();
  if (items.some(existing => existing._sta2eCreatorKey === key)) return;
  item._sta2eCreatorKey = key;
  items.push(item);
}

function removeLowerPhaserTypeItems(items = []) {
  const hasType2 = items.some(item => /\bphaser\b.*\btype\s*[- ]?\s*(?:2|ii)\b/i.test(String(item?.name ?? "")));
  if (!hasType2) return items;
  return items.filter(item => !/\bphaser\b.*\btype\s*[- ]?\s*(?:1|i)\b/i.test(String(item?.name ?? "")));
}

function stripCreatorItemKeys(items) {
  return items.map(item => {
    const cleaned = foundry.utils.deepClone(item);
    delete cleaned._sta2eCreatorKey;
    return cleaned;
  });
}

function embeddedItemIdentity(item = {}) {
  const type = String(item?.type ?? "").trim().toLocaleLowerCase(game.i18n.lang);
  const name = String(item?.name ?? "").trim().toLocaleLowerCase(game.i18n.lang);
  return type && name ? `${type}:${name}` : "";
}

function embeddedItemIdentityCounts(items = []) {
  const counts = new Map();
  for (const item of items) {
    const key = embeddedItemIdentity(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function missingEmbeddedItemData(expectedItems = [], existingItems = []) {
  const existingCounts = embeddedItemIdentityCounts(existingItems);
  const missing = [];
  for (const item of expectedItems) {
    const key = embeddedItemIdentity(item);
    if (!key) continue;
    const count = existingCounts.get(key) ?? 0;
    if (count > 0) {
      existingCounts.set(key, count - 1);
      continue;
    }
    missing.push(foundry.utils.deepClone(item));
  }
  return missing;
}

async function reconcileCreatorActorItems(actor, expectedItems = []) {
  if (!actor?.createEmbeddedDocuments || !expectedItems.length) return;

  const currentItems = Array.from(actor.items ?? []);
  const missing = missingEmbeddedItemData(expectedItems, currentItems);
  if (!missing.length) return;

  await actor.createEmbeddedDocuments("Item", missing);

  const stillMissing = missingEmbeddedItemData(expectedItems, Array.from(actor.items ?? []));
  if (stillMissing.length) {
    console.warn(
      "STA2e Toolkit | Character Creator actor item reconciliation did not add every expected item:",
      stillMissing.map(item => `${item.type}:${item.name}`),
    );
  }
}

function supportingStressMax(attributes = {}, disciplines = {}, items = [], isSupervisory = false) {
  const fitness = Number(attributes.fitness?.value ?? attributes.fitness ?? 7) || 0;
  const command = Number(disciplines.command?.value ?? disciplines.command ?? 0) || 0;
  const control = Number(attributes.control?.value ?? attributes.control ?? 0) || 0;
  const hasItemNamed = name => items.some(item => String(item?.name ?? "").toLowerCase().includes(name));
  const hasValue = items.some(item => item?.type === "value");
  if (!isSupervisory && !hasValue) return 0;

  let max = fitness;
  if (hasItemNamed("tough")) max += 2;
  if (hasItemNamed("resolute")) max += command;
  if (hasItemNamed("mental discipline")) max = control;
  if (!isSupervisory) max = Math.ceil(max / 2);
  return Math.max(0, max);
}

function playerActorOwnership() {
  return {
    default: CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0,
    [game.user.id]: CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3,
  };
}

function sharedActorOwnership() {
  return {
    default: CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3,
  };
}

function bindDescriptionToggles(element) {
  element.querySelectorAll("[data-toggle-description]").forEach(button => {
    button.addEventListener("click", () => {
      const root = button.closest("[data-description-root]");
      const panel = root?.querySelector("[data-description-panel]");
      if (!panel) return;
      panel.hidden = !panel.hidden;
    });
  });
}

function createOpeningLoader({ title, detail }) {
  if (!document?.body) return null;

  const root = document.createElement("div");
  root.className = "sta2e-cc-opening-loader";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const panel = document.createElement("div");
  panel.className = "sta2e-cc-opening-panel";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const detailEl = document.createElement("p");
  detailEl.textContent = detail;

  const progress = document.createElement("div");
  progress.className = "sta2e-cc-opening-progress";
  progress.setAttribute("aria-label", "Opening progress");

  const bar = document.createElement("div");
  bar.className = "sta2e-cc-opening-progress-bar";
  progress.append(bar);

  const percent = document.createElement("span");
  percent.className = "sta2e-cc-opening-percent";
  percent.textContent = "0%";

  panel.append(heading, detailEl, progress, percent);
  root.append(panel);
  document.body.append(root);

  const started = Date.now();
  let closed = false;
  let current = 0;

  const setProgress = (value, nextDetail = "") => {
    if (closed) return;
    current = Math.max(current, Math.min(100, Number(value) || 0));
    bar.style.width = `${current}%`;
    percent.textContent = `${Math.round(current)}%`;
    if (nextDetail) detailEl.textContent = nextDetail;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    current = 100;
    bar.style.width = "100%";
    percent.textContent = "100%";
    detailEl.textContent = "Ready";

    const finish = () => {
      root.classList.add("is-complete");
      window.setTimeout(() => root.remove(), 180);
    };
    window.setTimeout(finish, Math.max(160, 420 - (Date.now() - started)));
  };

  setProgress(8);
  return { setProgress, close };
}

function startOpeningLoader(app, title, detail) {
  if (app._initialRenderComplete || app._openingLoader) return;
  app._openingLoader = createOpeningLoader({ title, detail });
}

function updateOpeningLoader(app, value, detail) {
  app._openingLoader?.setProgress(value, detail);
}

function finishOpeningLoader(app) {
  app._initialRenderComplete = true;
  const loader = app._openingLoader;
  app._openingLoader = null;
  loader?.close();
}

export class CharacterCreatorConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sta2e-character-creator-config",
    tag: "div",
    window: { title: "STA2E.CharacterCreator.Config.Title", resizable: true },
    position: { width: 840, height: 680 },
    actions: {
      addSpecies: CharacterCreatorConfig._onAddSpecies,
      deleteSpecies: CharacterCreatorConfig._onDeleteSpecies,
      addEnvironment: CharacterCreatorConfig._onAddEnvironment,
      deleteEnvironment: CharacterCreatorConfig._onDeleteEnvironment,
      addUpbringing: CharacterCreatorConfig._onAddUpbringing,
      deleteUpbringing: CharacterCreatorConfig._onDeleteUpbringing,
      addCareerPath: CharacterCreatorConfig._onAddCareerPath,
      deleteCareerPath: CharacterCreatorConfig._onDeleteCareerPath,
      addCareerEvent: CharacterCreatorConfig._onAddCareerEvent,
      deleteCareerEvent: CharacterCreatorConfig._onDeleteCareerEvent,
      addRank: CharacterCreatorConfig._onAddRank,
      deleteRank: CharacterCreatorConfig._onDeleteRank,
      addAssignmentLoadout: CharacterCreatorConfig._onAddAssignmentLoadout,
      deleteAssignmentLoadout: CharacterCreatorConfig._onDeleteAssignmentLoadout,
      saveFinishing: CharacterCreatorConfig._onSaveFinishing,
      save: CharacterCreatorConfig._onSave,
      cancel: CharacterCreatorConfig._onCancel,
    },
  };

  static PARTS = {
    config: { template: "modules/sta2e-toolkit/templates/character-creator-config.hbs" },
  };

  constructor(options = {}) {
    super(options);
    const ui = getCreatorData().ui;
    this._collapsedSpecies = new Set(ui.collapsedSpeciesIds);
    this._collapsedEnvironments = new Set(ui.collapsedEnvironmentIds);
    this._collapsedUpbringings = new Set(ui.collapsedUpbringingIds);
    this._collapsedCareerPaths = new Set(ui.collapsedCareerPathIds);
    this._collapsedCareerEvents = new Set(ui.collapsedCareerEventIds);
    this._collapsedConfigSections = new Set(ui.collapsedConfigSections);
    this._activeConfigTab = "config";
    this._activeSubtabs = {};
    this._scrollState = null;
    this._openingLoader = null;
    this._initialRenderComplete = false;
  }

  render(options = {}) {
    this._captureScrollState();
    startOpeningLoader(this, "Opening Creator Data", "Reading character creator settings");
    const result = super.render(options);
    Promise.resolve(result).catch(() => finishOpeningLoader(this));
    return result;
  }

  _captureScrollState() {
    const el = this.element;
    if (!el) return;

    const activeTab = el.querySelector("[data-cc-config-tab].is-active")?.dataset.ccConfigTab ?? this._activeConfigTab ?? "config";
    const panelScroll = {};
    el.querySelectorAll("[data-cc-config-panel]").forEach(panel => {
      if (panel.dataset.ccConfigPanel) panelScroll[panel.dataset.ccConfigPanel] = panel.scrollTop;
    });

    const activeSubtabs = { ...this._activeSubtabs };
    el.querySelectorAll("[data-cc-subtab].is-active").forEach(button => {
      if (button.dataset.ccSubtabGroup) activeSubtabs[button.dataset.ccSubtabGroup] = button.dataset.ccSubtab;
    });

    this._scrollState = {
      activeTab,
      panelScroll,
      activeSubtabs,
      tabsScroll: el.querySelector(".sta2e-cc-config-tabs")?.scrollLeft ?? 0,
    };
  }

  _restoreScrollState() {
    const state = this._scrollState;
    const el = this.element;
    if (!el || !state) return;

    requestAnimationFrame(() => {
      const current = this.element;
      if (!current) return;

      const activeTab = this._activeConfigTab || state.activeTab || "config";
      setActiveConfigTab(current, activeTab);
      for (const [group, tab] of Object.entries({ ...state.activeSubtabs, ...this._activeSubtabs })) {
        setActiveConfigSubtab(current, group, tab);
      }

      const tabs = current.querySelector(".sta2e-cc-config-tabs");
      if (tabs) tabs.scrollLeft = state.tabsScroll ?? 0;

      current.querySelectorAll("[data-cc-config-panel]").forEach(panel => {
        const key = panel.dataset.ccConfigPanel;
        if (key && Number.isFinite(state.panelScroll?.[key])) panel.scrollTop = state.panelScroll[key];
      });
    });
  }

  async _prepareContext(_options) {
    updateOpeningLoader(this, 16, "Preparing configured species");
    const data = getCreatorData();
    const species = await Promise.all(data.species.map(normalizeSpecies).map(async row => {
      const prepared = await prepareSpeciesForContext(row, data);
      return {
        ...prepared,
        collapsed: this._collapsedSpecies.has(prepared.id),
        maleFirstNamesText: nameListToText(prepared.maleFirstNames),
        femaleFirstNamesText: nameListToText(prepared.femaleFirstNames),
        surnamesText: nameListToText(prepared.surnames),
      };
    }));
    updateOpeningLoader(this, 34, "Preparing lifepath options");
    const allSpeciesCollapsed = species.length > 0 && species.every(row => row.collapsed);
    const environments = data.environments.map(normalizeEnvironment).map(environment => ({
      ...environment,
      collapsed: this._collapsedEnvironments.has(environment.id),
      attributes: selectedAttributeOptions(environment.attributeChoices),
      departments: selectedDisciplineOptions(environment.departmentChoices),
      attributeModeOptions: [
        { key: "selected", label: "Limited attribute list", selected: environment.attributeMode === "selected" },
        { key: "characterSpecies", label: "Character species attributes", selected: environment.attributeMode === "characterSpecies" },
        { key: "species", label: "Another species attribute list", selected: environment.attributeMode === "species" },
        { key: "any", label: "Any attribute", selected: environment.attributeMode === "any" },
      ],
      departmentModeOptions: [
        { key: "selected", label: "Limited department list", selected: environment.departmentMode === "selected" },
        { key: "any", label: "Any department", selected: environment.departmentMode === "any" },
      ],
    }));
    const allEnvironmentsCollapsed = environments.length > 0 && environments.every(row => row.collapsed);
    const upbringings = await Promise.all(data.upbringings.map(normalizeUpbringing).map(async upbringing => ({
        ...upbringing,
        collapsed: this._collapsedUpbringings.has(upbringing.id),
        acceptedPlusOneAttributes: selectedSingleAttributeOptions(upbringing.accepted.attributePlusOne),
        acceptedPlusTwoAttributes: selectedSingleAttributeOptions(upbringing.accepted.attributePlusTwo),
        rebelledPlusOneAttributes: selectedSingleAttributeOptions(upbringing.rebelled.attributePlusOne),
        rebelledPlusTwoAttributes: selectedSingleAttributeOptions(upbringing.rebelled.attributePlusTwo),
        departments: selectedDisciplineOptions(effectiveUpbringingDepartmentChoices(upbringing)),
        focuses: await prepareUuidListForContext(upbringing.recommendedFocusUuids),
        talents: await prepareUuidListForContext(upbringing.talentUuids),
      })));
    const allUpbringingsCollapsed = upbringings.length > 0 && upbringings.every(row => row.collapsed);
    const careerPaths = await Promise.all(data.careerPaths.map(normalizeCareerPath).map(async careerPath => ({
        ...careerPath,
        collapsed: this._collapsedCareerPaths.has(careerPath.id),
        plusTwoDepartments: selectedDisciplineOptions(careerPath.departments.plusTwo),
        plusOneDepartments: selectedDisciplineOptions(careerPath.departments.plusOne),
        requiredAttributes: selectedAttributeOptions(careerPath.requiredAttributes),
        departmentReallocationAllowed: careerPath.departmentReallocationAllowed,
        traits: await prepareUuidListForContext(careerPath.traitUuids),
        focuses: await prepareUuidListForContext(careerPath.recommendedFocusUuids),
        talents: await prepareUuidListForContext(careerPath.talentUuids),
      })));
    const allCareerPathsCollapsed = careerPaths.length > 0 && careerPaths.every(row => row.collapsed);
    const experienceOptions = await Promise.all(normalizeExperienceOptions(data.experienceOptions).map(async option => ({
        ...option,
        talents: await prepareUuidListForContext(option.talentUuids),
      })));
    const careerEvents = await Promise.all(data.careerEvents.map(normalizeCareerEvent).map(async event => ({
        ...event,
        collapsed: this._collapsedCareerEvents.has(event.id),
        attributeOptions: selectedAttributeOptions(event.attributeChoices),
        departmentOptions: selectedDisciplineOptions(event.departmentChoices),
        focuses: await prepareUuidListForContext(event.suggestedFocusUuids),
        traits: await prepareUuidListForContext(event.suggestedTraitUuids),
      })));
    updateOpeningLoader(this, 62, "Resolving equipment and talent lists");
    const allCareerEventsCollapsed = careerEvents.length > 0 && careerEvents.every(row => row.collapsed);
    const finishing = normalizeFinishingData(data.finishing);
    const ranks = await Promise.all(finishing.ranks.map(async rank => ({
        ...rank,
        equipment: await prepareUuidListForContext(finishing.rankLoadouts[rank.id] ?? []),
      })));
    const roleLoadouts = await Promise.all(data.config.roles.map(async roleUuid => {
      const roleDoc = await resolveUuidDoc(roleUuid);
      return {
        uuid: roleUuid,
        name: roleDoc?.name ?? roleUuid,
        description: descriptionForDoc(roleDoc),
        equipment: await prepareUuidListForContext(finishing.roleLoadouts[roleUuid] ?? []),
      };
    }));
    const assignmentLoadouts = await Promise.all(Object.entries(finishing.assignmentLoadouts).map(async ([name, equipmentUuids]) => ({
        id: foundry.utils.randomID(),
        name,
        equipment: await prepareUuidListForContext(equipmentUuids),
      })));
    assignmentLoadouts.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang, { sensitivity: "base" }));
    const departmentLoadouts = await Promise.all(DISCIPLINE_KEYS.map(async key => ({
      key,
      label: departmentLabel(key),
      equipment: await prepareUuidListForContext(finishing.departmentLoadouts[key] ?? []),
    })));

    const talentCategories = await Promise.all(TALENT_CATEGORIES.map(async category => {
      const items = await prepareUuidListForContext(data.config.talents[category.key]);
      return {
        ...category,
        active: category.key === TALENT_CATEGORIES[0].key,
        items,
      };
    }));
    const esotericTalentOptions = talentCategories.find(category => category.key === "esoteric")?.items ?? [];
    const [
      configRoles,
      configTraits,
      configValues,
      configFocuses,
      configDepartmentFocuses,
      configItems,
      configWeapons,
      configArmor,
    ] = await Promise.all([
      prepareUuidListForContext(data.config.roles),
      prepareUuidListForContext(data.config.traits),
      prepareUuidListForContext(data.config.values),
      prepareUuidListForContext(configuredFocusUuids(data.config)),
      Promise.all(DISCIPLINE_KEYS.map(async key => ({
        key,
        label: departmentLabel(key),
        active: key === DISCIPLINE_KEYS[0],
        items: await prepareUuidListForContext(data.config.departmentFocuses?.[key] ?? []),
      }))),
      prepareUuidListForContext(data.config.items),
      prepareUuidListForContext(data.config.weapons),
      prepareUuidListForContext(data.config.armor),
    ]);

    updateOpeningLoader(this, 92, "Building creator data window");
    return {
      talentPacksText: data.talentPacks.join("\n"),
      configCollapsed: {
        talents: this._collapsedConfigSections.has("talents"),
        roles: this._collapsedConfigSections.has("roles"),
        traits: this._collapsedConfigSections.has("traits"),
        values: this._collapsedConfigSections.has("values"),
        focuses: this._collapsedConfigSections.has("focuses"),
        items: this._collapsedConfigSections.has("items"),
        weapons: this._collapsedConfigSections.has("weapons"),
        armor: this._collapsedConfigSections.has("armor"),
        finishingRanks: this._collapsedConfigSections.has("finishingRanks"),
        finishingRoles: this._collapsedConfigSections.has("finishingRoles"),
        finishingAssignments: this._collapsedConfigSections.has("finishingAssignments"),
        supportingDepartments: this._collapsedConfigSections.has("supportingDepartments"),
      },
      config: {
        talentCategories,
        roles: configRoles,
        traits: configTraits,
        values: configValues,
        focuses: configFocuses,
        departmentFocuses: configDepartmentFocuses,
        items: configItems,
        weapons: configWeapons,
        armor: configArmor,
      },
      species,
      environments,
      upbringings,
      careerPaths,
      experienceOptions,
      careerEvents,
      ranks,
      roleLoadouts,
      departmentLoadouts,
      assignmentLoadouts,
      esotericTalentOptions,
      allSpeciesCollapsed,
      allEnvironmentsCollapsed,
      allUpbringingsCollapsed,
      allCareerPathsCollapsed,
      allCareerEventsCollapsed,
      attributes: ATTRIBUTE_KEYS.map(key => ({ key, label: ATTRIBUTE_LABELS[key] })),
      departments: DISCIPLINE_KEYS.map(key => ({ key, label: DISCIPLINE_LABELS[key] })),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    setActiveConfigTab(el, this._activeConfigTab);
    for (const [group, tab] of Object.entries(this._activeSubtabs)) {
      setActiveConfigSubtab(el, group, tab);
    }

    el.querySelectorAll("[data-cc-config-tab]").forEach(button => {
      button.addEventListener("click", () => {
        const tab = button.dataset.ccConfigTab;
        this._activeConfigTab = tab;
        setActiveConfigTab(el, tab);
      });
    });

    el.querySelectorAll("[data-cc-subtab]").forEach(button => {
      button.addEventListener("click", () => {
        const group = button.dataset.ccSubtabGroup;
        const tab = button.dataset.ccSubtab;
        this._activeSubtabs[group] = tab;
        setActiveConfigSubtab(el, group, tab);
      });
    });

    bindDescriptionToggles(el);

    const syncSpeciesTokenPreview = input => {
      const row = input.closest(".sta2e-cc-species-row");
      const preview = row?.querySelector(".sta2e-cc-species-token-config-preview");
      const img = row?.querySelector("[data-species-token-preview]");
      const path = input.value.trim();
      if (preview) preview.hidden = !path;
      if (img) img.src = path;
    };

    el.querySelectorAll("[data-field='tokenImage']").forEach(input => {
      syncSpeciesTokenPreview(input);
      input.addEventListener("input", () => syncSpeciesTokenPreview(input));
      input.addEventListener("change", () => syncSpeciesTokenPreview(input));
    });

    el.querySelectorAll("[data-browse-species-token]").forEach(button => {
      button.addEventListener("click", () => {
        const row = button.closest(".sta2e-cc-species-row");
        const input = row?.querySelector("[data-field='tokenImage']");
        if (!input || typeof FilePicker !== "function") return;
        new FilePicker({
          type: "image",
          current: input.value || "",
          callback: path => {
            input.value = path;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          },
        }).render(true);
      });
    });

    el.querySelectorAll("[data-toggle-finishing-entry]").forEach(button => {
      button.addEventListener("click", () => {
        const row = button.closest(".sta2e-cc-species-row");
        const body = row?.querySelector("[data-finishing-entry-body]");
        if (!row || !body) return;
        const collapsed = !body.hidden;
        body.hidden = collapsed;
        row.classList.toggle("is-collapsed", collapsed);
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        button.title = collapsed ? "Expand entry" : "Collapse entry";
        const icon = button.querySelector("i");
        icon?.classList.toggle("fa-chevron-down", collapsed);
        icon?.classList.toggle("fa-chevron-up", !collapsed);
      });
    });

    const collapseConfigs = {
      species: {
        idKey: "speciesId",
        rowSelector: ".sta2e-cc-species-row[data-species-id]",
        bodySelector: "[data-species-body]",
        toggleSelector: "[data-toggle-species]",
        allSelector: "[data-toggle-all-species]",
        sortSelector: "[data-sort-species-name]",
        listSelector: "[data-species-list]",
        nameSelector: "[data-field='name']",
        collapsedIds: this._collapsedSpecies,
        label: "species",
      },
      environment: {
        idKey: "environmentId",
        rowSelector: ".sta2e-cc-environment-row[data-environment-id]",
        bodySelector: "[data-environment-body]",
        toggleSelector: "[data-toggle-environment]",
        allSelector: "[data-toggle-all-environments]",
        sortSelector: "[data-sort-environment-name]",
        listSelector: "[data-environment-list]",
        nameSelector: "[data-field='environmentName']",
        collapsedIds: this._collapsedEnvironments,
        label: "environment",
      },
      upbringing: {
        idKey: "upbringingId",
        rowSelector: ".sta2e-cc-upbringing-row[data-upbringing-id]",
        bodySelector: "[data-upbringing-body]",
        toggleSelector: "[data-toggle-upbringing]",
        allSelector: "[data-toggle-all-upbringings]",
        sortSelector: "[data-sort-upbringing-name]",
        listSelector: "[data-upbringing-list]",
        nameSelector: "[data-field='upbringingName']",
        collapsedIds: this._collapsedUpbringings,
        label: "upbringing",
      },
      careerPath: {
        idKey: "careerPathId",
        rowSelector: ".sta2e-cc-career-row[data-career-path-id]",
        bodySelector: "[data-career-body]",
        toggleSelector: "[data-toggle-career-path]",
        allSelector: "[data-toggle-all-career-paths]",
        sortSelector: "[data-sort-career-path-name]",
        listSelector: "[data-career-path-list]",
        nameSelector: "[data-field='careerPathName']",
        collapsedIds: this._collapsedCareerPaths,
        label: "career path",
      },
      careerEvent: {
        idKey: "careerEventId",
        rowSelector: ".sta2e-cc-career-event-row[data-career-event-id]",
        bodySelector: "[data-career-event-body]",
        toggleSelector: "[data-toggle-career-event]",
        allSelector: "[data-toggle-all-career-events]",
        sortSelector: "[data-sort-career-event-name]",
        listSelector: "[data-career-event-list]",
        nameSelector: "[data-field='careerEventName']",
        collapsedIds: this._collapsedCareerEvents,
        label: "career event",
      },
    };

    const syncCollapseAllButton = config => {
      const button = el.querySelector(config.allSelector);
      if (!button) return;

      const rows = Array.from(el.querySelectorAll(config.rowSelector));
      const allCollapsed = rows.length > 0 && rows.every(row => row.querySelector(config.bodySelector)?.hidden);
      button.dataset.collapseMode = allCollapsed ? "expand" : "collapse";
      button.title = allCollapsed ? `Expand all ${config.label}s` : `Collapse all ${config.label}s`;

      const icon = button.querySelector("i");
      if (icon) icon.className = `fas ${allCollapsed ? "fa-chevron-down" : "fa-chevron-up"}`;

      const label = button.querySelector("[data-collapse-all-label]");
      if (label) label.textContent = allCollapsed ? "Expand All" : "Collapse All";
    };

    const setRowCollapsed = (row, config, collapse) => {
      const body = row.querySelector(config.bodySelector);
      const button = row.querySelector(config.toggleSelector);
      if (!body || !button) return;

      body.hidden = collapse;
      row.classList.toggle("is-collapsed", collapse);
      button.setAttribute("aria-expanded", String(!collapse));
      button.title = collapse ? `Expand ${config.label}` : `Minimize ${config.label}`;

      const icon = button.querySelector("i");
      icon?.classList.toggle("fa-chevron-down", collapse);
      icon?.classList.toggle("fa-chevron-up", !collapse);

      const id = row.dataset[config.idKey];
      if (collapse) config.collapsedIds.add(id);
      else config.collapsedIds.delete(id);
    };

    const bindCollapsibleList = config => {
      el.querySelector(config.sortSelector)?.addEventListener("click", () => {
        const list = el.querySelector(config.listSelector);
        if (!list) return;

        const rows = Array.from(list.querySelectorAll(config.rowSelector));
        rows.sort((a, b) => {
          const aName = a.querySelector(config.nameSelector)?.value?.trim() ?? "";
          const bName = b.querySelector(config.nameSelector)?.value?.trim() ?? "";
          return aName.localeCompare(bName, game.i18n.lang, { sensitivity: "base" });
        });

        rows.forEach(row => list.appendChild(row));
      });

      el.querySelector(config.allSelector)?.addEventListener("click", buttonEvent => {
        const rows = Array.from(el.querySelectorAll(config.rowSelector));
        const collapse = buttonEvent.currentTarget.dataset.collapseMode !== "expand";
        for (const row of rows) setRowCollapsed(row, config, collapse);
        syncCollapseAllButton(config);
      });

      el.querySelectorAll(config.toggleSelector).forEach(button => {
        button.addEventListener("click", () => {
          const row = button.closest(config.rowSelector);
          const body = row?.querySelector(config.bodySelector);
          if (!row || !body) return;

          setRowCollapsed(row, config, !body.hidden);
          syncCollapseAllButton(config);
        });
      });

      syncCollapseAllButton(config);
    };

    for (const config of Object.values(collapseConfigs)) bindCollapsibleList(config);

    el.querySelectorAll("[data-export-species-names]").forEach(button => {
      button.addEventListener("click", () => {
        const row = button.closest(".sta2e-cc-species-row");
        if (row) CharacterCreatorConfig._exportSpeciesNames(row);
      });
    });

    el.querySelectorAll("[data-import-species-names]").forEach(button => {
      button.addEventListener("click", () => {
        const row = button.closest(".sta2e-cc-species-row");
        row?.querySelector("[data-species-names-import]")?.click();
      });
    });

    el.querySelectorAll("[data-species-names-import]").forEach(input => {
      input.addEventListener("change", async () => {
        const row = input.closest(".sta2e-cc-species-row");
        const file = input.files?.[0];
        input.value = "";
        if (row && file) await CharacterCreatorConfig._importSpeciesNames(row, file);
      });
    });

    el.querySelectorAll("[data-clear-species-names]").forEach(button => {
      button.addEventListener("click", () => {
        const row = button.closest(".sta2e-cc-species-row");
        if (row) CharacterCreatorConfig._clearSpeciesNames(row);
      });
    });

    el.querySelectorAll("[data-export-section]").forEach(button => {
      button.addEventListener("click", () => {
        const sectionKey = button.dataset.exportSection;
        if (sectionKey) CharacterCreatorConfig._exportSection.call(this, sectionKey);
      });
    });

    el.querySelectorAll("[data-import-section]").forEach(button => {
      button.addEventListener("click", () => {
        const sectionKey = button.dataset.importSection;
        if (!sectionKey) return;
        el.querySelector(`[data-section-import-input='${sectionKey}']`)?.click();
      });
    });

    el.querySelectorAll("[data-section-import-input]").forEach(input => {
      input.addEventListener("change", async () => {
        const sectionKey = input.dataset.sectionImportInput;
        const file = input.files?.[0];
        input.value = "";
        if (sectionKey && file) await CharacterCreatorConfig._importSection.call(this, sectionKey, file);
      });
    });

    el.querySelectorAll("[data-export-pack]").forEach(button => {
      button.addEventListener("click", () => CharacterCreatorConfig._exportPack.call(this));
    });

    el.querySelectorAll("[data-import-pack]").forEach(button => {
      button.addEventListener("click", () => {
        el.querySelector("[data-pack-import-input]")?.click();
      });
    });

    el.querySelectorAll("[data-pack-import-input]").forEach(input => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.value = "";
        if (file) await CharacterCreatorConfig._importPack.call(this, file);
      });
    });

    const setConfigBlockCollapsed = (block, collapse) => {
      const key = block.dataset.configSection;
      const body = block.querySelector("[data-config-block-body]");
      const button = block.querySelector("[data-toggle-config-block]");
      if (!key || !body || !button) return;

      body.hidden = collapse;
      block.classList.toggle("is-collapsed", collapse);
      button.setAttribute("aria-expanded", String(!collapse));
      button.title = collapse ? "Expand section" : "Collapse section";

      const icon = button.querySelector("i");
      icon?.classList.toggle("fa-chevron-down", collapse);
      icon?.classList.toggle("fa-chevron-up", !collapse);

      if (collapse) this._collapsedConfigSections.add(key);
      else this._collapsedConfigSections.delete(key);
    };

    el.querySelectorAll("[data-toggle-config-block]").forEach(button => {
      button.addEventListener("click", () => {
        const block = button.closest("[data-config-section]");
        const body = block?.querySelector("[data-config-block-body]");
        if (!block || !body) return;
        setConfigBlockCollapsed(block, !body.hidden);
      });
    });

    el.querySelectorAll(".sta2e-cc-drop-slot").forEach(slot => {
      slot.addEventListener("dragover", event => {
        event.preventDefault();
        slot.classList.add("is-dragover");
      });

      slot.addEventListener("dragleave", () => slot.classList.remove("is-dragover"));

      slot.addEventListener("drop", async event => {
        event.preventDefault();
        slot.classList.remove("is-dragover");

        const data = dropDataFromEvent(event);
        const item = isDropDataType(data, "Item") ? await droppedItemFromEvent(event) : null;
        const folder = isDropDataType(data, "Folder") ? await droppedFolderFromData(data) : null;
        if (!item && !folder) return;

        if (slot.dataset.configDrop) {
          const configType = slot.dataset.configType;

          if (folder) {
            const folderItems = await collectItemsFromFolder(folder);
            const acceptedItems = folderItems.filter(folderItem => isAllowedConfigItemType(folderItem, configType));
            if (!acceptedItems.length) {
              ui.notifications.warn(`STA2e Toolkit: No matching items found. This list accepts item types: ${allowedConfigItemTypeLabel(configType)}.`);
              return;
            }

            const list = el.querySelector(`[data-config-list="${slot.dataset.configDrop}"]`);
            if (!list) return;
            const existing = new Set(Array.from(list.querySelectorAll("[data-field='configItemUuid']"))
              .map(input => input.value));
            let added = 0;
            for (const folderItem of acceptedItems) {
              if (existing.has(folderItem.uuid)) continue;
              existing.add(folderItem.uuid);
              list.appendChild(this._buildConfigListItem(folderItem.uuid, folderItem.name, folderItem.type, descriptionForDoc(folderItem)));
              added += 1;
            }

            if (added) ui.notifications.info(`STA2e Toolkit: Added ${added} item${added === 1 ? "" : "s"} from ${folder.name}.`);
            else ui.notifications.warn("STA2e Toolkit: All matching items from that folder were already in this list.");
            return;
          }

          if (!isAllowedConfigItemType(item, configType)) {
            ui.notifications.warn(`STA2e Toolkit: This list accepts item types: ${allowedConfigItemTypeLabel(configType)}.`);
            return;
          }

          const list = el.querySelector(`[data-config-list="${slot.dataset.configDrop}"]`);
          if (!list) return;
          const existing = Array.from(list.querySelectorAll("[data-field='configItemUuid']"))
            .some(input => input.value === item.uuid);
          if (existing) return;
          list.appendChild(this._buildConfigListItem(item.uuid, item.name, item.type, descriptionForDoc(item)));
          return;
        }

        if (slot.dataset.upbringingDrop) {
          const dropType = slot.dataset.upbringingDrop;
          const expectedType = dropType === "focus" ? "focus" : "talent";
          const row = slot.closest(".sta2e-cc-upbringing-row");
          const list = row?.querySelector(`[data-upbringing-list="${dropType}"]`);
          if (!row || !list) return;

          const appendItem = itemDoc => {
            const existing = Array.from(list.querySelectorAll("[data-field]"))
              .some(input => input.value === itemDoc.uuid);
            if (existing) return false;
            const fieldName = dropType === "focus" ? "upbringingFocusUuid" : "upbringingTalentUuid";
            list.appendChild(this._buildUpbringingListItem(itemDoc.uuid, itemDoc.name, itemDoc.type, descriptionForDoc(itemDoc), fieldName));
            return true;
          };

          if (folder) {
            const folderItems = await collectItemsFromFolder(folder);
            const acceptedItems = folderItems.filter(folderItem => folderItem.type === expectedType);
            let added = 0;
            for (const folderItem of acceptedItems) if (appendItem(folderItem)) added += 1;
            if (added) ui.notifications.info(`STA2e Toolkit: Added ${added} ${dropType}${added === 1 ? "" : "s"} from ${folder.name}.`);
            else ui.notifications.warn(`STA2e Toolkit: No new ${expectedType} items found in that folder.`);
            return;
          }

          if (item.type !== expectedType) {
            ui.notifications.warn(`STA2e Toolkit: This drop slot needs a ${expectedType} item.`);
            return;
          }

          appendItem(item);
          return;
        }

        if (slot.dataset.careerDrop) {
          const dropType = slot.dataset.careerDrop;
          const expectedType = dropType === "trait" ? "trait" : dropType === "focus" ? "focus" : "talent";
          const row = slot.closest(".sta2e-cc-career-row");
          const list = row?.querySelector(`[data-career-list="${dropType}"]`);
          if (!row || !list) return;

          const appendItem = itemDoc => {
            const existing = Array.from(list.querySelectorAll("[data-field]"))
              .some(input => input.value === itemDoc.uuid);
            if (existing) return false;
            const fieldName = dropType === "trait" ? "careerTraitUuid" : dropType === "focus" ? "careerFocusUuid" : "careerTalentUuid";
            list.appendChild(this._buildUpbringingListItem(itemDoc.uuid, itemDoc.name, itemDoc.type, descriptionForDoc(itemDoc), fieldName));
            return true;
          };

          if (folder) {
            const folderItems = await collectItemsFromFolder(folder);
            const acceptedItems = folderItems.filter(folderItem => folderItem.type === expectedType);
            let added = 0;
            for (const folderItem of acceptedItems) if (appendItem(folderItem)) added += 1;
            if (added) ui.notifications.info(`STA2e Toolkit: Added ${added} ${dropType}${added === 1 ? "" : "s"} from ${folder.name}.`);
            else ui.notifications.warn(`STA2e Toolkit: No new ${expectedType} items found in that folder.`);
            return;
          }

          if (item.type !== expectedType) {
            ui.notifications.warn(`STA2e Toolkit: This drop slot needs a ${expectedType} item.`);
            return;
          }

          appendItem(item);
          return;
        }

        if (slot.dataset.experienceDrop) {
          const row = slot.closest(".sta2e-cc-experience-row");
          const list = row?.querySelector("[data-experience-list='talent']");
          if (!row || !list) return;

          const appendItem = itemDoc => {
            const existing = Array.from(list.querySelectorAll("[data-field='experienceTalentUuid']"))
              .some(input => input.value === itemDoc.uuid);
            if (existing) return false;
            list.appendChild(this._buildUpbringingListItem(itemDoc.uuid, itemDoc.name, itemDoc.type, descriptionForDoc(itemDoc), "experienceTalentUuid"));
            return true;
          };

          if (folder) {
            const folderItems = await collectItemsFromFolder(folder);
            const acceptedItems = folderItems.filter(folderItem => folderItem.type === "talent");
            let added = 0;
            for (const folderItem of acceptedItems) if (appendItem(folderItem)) added += 1;
            if (added) ui.notifications.info(`STA2e Toolkit: Added ${added} talent${added === 1 ? "" : "s"} from ${folder.name}.`);
            else ui.notifications.warn("STA2e Toolkit: No new talent items found in that folder.");
            return;
          }

          if (item.type !== "talent") {
            ui.notifications.warn("STA2e Toolkit: This drop slot needs a talent item.");
            return;
          }

          appendItem(item);
          return;
        }

        if (slot.dataset.careerEventDrop) {
          const row = slot.closest(".sta2e-cc-career-event-row");
          const type = slot.dataset.careerEventDrop;
          const list = row?.querySelector(`[data-career-event-list='${type}']`);
          if (!row || !list) return;
          const fieldName = type === "trait" ? "careerEventTraitUuid" : "careerEventFocusUuid";

          const appendItem = itemDoc => {
            const existing = Array.from(list.querySelectorAll(`[data-field='${fieldName}']`))
              .some(input => input.value === itemDoc.uuid);
            if (existing) return false;
            list.appendChild(this._buildUpbringingListItem(itemDoc.uuid, itemDoc.name, itemDoc.type, descriptionForDoc(itemDoc), fieldName));
            return true;
          };

          if (folder) {
            const folderItems = await collectItemsFromFolder(folder);
            const acceptedItems = folderItems.filter(folderItem => folderItem.type === type);
            let added = 0;
            for (const folderItem of acceptedItems) if (appendItem(folderItem)) added += 1;
            if (added) ui.notifications.info(`STA2e Toolkit: Added ${added} ${type}${added === 1 ? "" : type === "focus" ? "es" : "s"} from ${folder.name}.`);
            else ui.notifications.warn(`STA2e Toolkit: No new ${type} items found in that folder.`);
            return;
          }

          if (item.type !== type) {
            ui.notifications.warn(`STA2e Toolkit: This drop slot needs a ${type} item.`);
            return;
          }

          appendItem(item);
          return;
        }

        if (slot.dataset.finishingDrop) {
          const row = slot.closest(".sta2e-cc-role-loadout-row, .sta2e-cc-rank-row, .sta2e-cc-assignment-loadout-row, .sta2e-cc-department-loadout-row");
          const dropType = slot.dataset.finishingDrop;
          const fieldName = dropType === "rankEquipment"
            ? "rankLoadoutEquipmentUuid"
            : dropType === "assignmentEquipment"
              ? "assignmentLoadoutEquipmentUuid"
              : dropType === "departmentEquipment"
                ? "departmentLoadoutEquipmentUuid"
                : "roleLoadoutEquipmentUuid";
          const list = dropType === "rankEquipment"
            ? row?.querySelector("[data-rank-loadout-list]")
            : dropType === "assignmentEquipment"
              ? row?.querySelector("[data-assignment-loadout-list]")
              : dropType === "departmentEquipment"
                ? row?.querySelector("[data-department-loadout-list]")
                : row?.querySelector("[data-role-loadout-list]");
          if (!row || !list) return;

          const isEquipment = itemDoc => ["item", "characterweapon2e", "armor"].includes(itemDoc?.type);
          const appendItem = itemDoc => {
            const existing = Array.from(list.querySelectorAll(`[data-field='${fieldName}']`))
              .some(input => input.value === itemDoc.uuid);
            if (existing) return false;
            list.appendChild(this._buildUpbringingListItem(itemDoc.uuid, itemDoc.name, itemDoc.type, descriptionForDoc(itemDoc), fieldName));
            return true;
          };

          if (folder) {
            const folderItems = await collectItemsFromFolder(folder);
            const acceptedItems = folderItems.filter(isEquipment);
            let added = 0;
            for (const folderItem of acceptedItems) if (appendItem(folderItem)) added += 1;
            if (added) ui.notifications.info(`STA2e Toolkit: Added ${added} equipment item${added === 1 ? "" : "s"} from ${folder.name}.`);
            else ui.notifications.warn("STA2e Toolkit: No new equipment items found in that folder.");
            return;
          }

          if (!isEquipment(item)) {
            ui.notifications.warn("STA2e Toolkit: Finishing loadouts accept item, weapon, and armor items.");
            return;
          }

          appendItem(item);
          return;
        }

        if (folder) {
          ui.notifications.warn("STA2e Toolkit: Folder drops are only supported in the Config item lists.");
          return;
        }

        const expectedType = slot.dataset.dropRole === "speciesTrait"
          ? "trait"
          : slot.dataset.dropRole === "speciesValue"
            ? "value"
            : "talent";
        if (item.type !== expectedType) {
          ui.notifications.warn(`STA2e Toolkit: This drop slot needs a ${expectedType} item.`);
          return;
        }

        const row = slot.closest(".sta2e-cc-species-row");
        if (!row) return;

        if (slot.dataset.dropRole === "speciesAbility") {
          row.querySelector("[data-field='speciesAbilityUuid']").value = item.uuid;
          row.querySelector("[data-ability-name]").textContent = item.name;
          const descriptionPanel = slot.querySelector("[data-description-panel]");
          const toggle = slot.querySelector("[data-toggle-description]");
          if (descriptionPanel) descriptionPanel.innerHTML = descriptionForDoc(item);
          if (toggle) toggle.hidden = !descriptionForDoc(item);
          return;
        }

        if (slot.dataset.dropRole === "speciesTrait") {
          const list = row.querySelector("[data-species-traits]");
          if (!list) return;
          const existing = Array.from(list.querySelectorAll("[data-field='speciesTraitUuid']"))
            .some(input => input.value === item.uuid);
          if (existing) return;
          list.appendChild(this._buildUpbringingListItem(item.uuid, item.name, item.type, descriptionForDoc(item), "speciesTraitUuid"));
          return;
        }

        if (slot.dataset.dropRole === "speciesTalent") {
          const list = row.querySelector("[data-species-talents]");
          const existing = Array.from(list.querySelectorAll("[data-field='speciesTalentUuid']"))
            .some(input => input.value === item.uuid);
          if (existing) return;
          list.appendChild(this._buildTalentListItem(item.uuid, item.name, descriptionForDoc(item)));
          return;
        }

        if (slot.dataset.dropRole === "speciesValue") {
          const list = row.querySelector("[data-species-values]");
          if (!list) return;
          const existing = Array.from(list.querySelectorAll("[data-field='speciesValueUuid']"))
            .some(input => input.value === item.uuid);
          if (existing) return;
          list.appendChild(this._buildUpbringingListItem(item.uuid, item.name, item.type, descriptionForDoc(item), "speciesValueUuid"));
          return;
        }

        if (slot.dataset.dropRole === "speciesEsotericTalent") {
          if (!isEsotericTalent(item, getCreatorData(), item.uuid)) {
            ui.notifications.warn("STA2e Toolkit: This drop slot needs an Esoteric talent item.");
            return;
          }

          const list = row.querySelector("[data-species-esoteric-talents]");
          const existing = Array.from(list.querySelectorAll("[data-field='speciesEsotericTalentUuid']"))
            .some(input => input.value === item.uuid);
          if (existing) return;
          list.appendChild(this._buildTalentListItem(item.uuid, item.name, descriptionForDoc(item), "speciesEsotericTalentUuid"));
        }
      });
    });

    el.querySelectorAll("[data-add-species-esoteric]").forEach(button => {
      button.addEventListener("click", async () => {
        const row = button.closest(".sta2e-cc-species-row");
        const select = row?.querySelector("[data-field='speciesEsotericTalentSelect']");
        const list = row?.querySelector("[data-species-esoteric-talents]");
        const uuid = select?.value ?? "";
        if (!row || !list || !uuid) return;

        const existing = Array.from(list.querySelectorAll("[data-field='speciesEsotericTalentUuid']"))
          .some(input => input.value === uuid);
        if (existing) return;

        const doc = await resolveUuidDoc(uuid);
        list.appendChild(this._buildTalentListItem(uuid, doc?.name ?? uuid, descriptionForDoc(doc), "speciesEsotericTalentUuid"));
      });
    });

    el.querySelectorAll("[data-add-career-config-item]").forEach(button => {
      button.addEventListener("click", async () => {
        const row = button.closest(".sta2e-cc-career-row");
        const type = button.dataset.addCareerConfigItem;
        const select = row?.querySelector(`[data-field='career${type.charAt(0).toUpperCase()}${type.slice(1)}Select']`);
        const list = row?.querySelector(`[data-career-list="${type}"]`);
        const uuid = select?.value ?? "";
        if (!row || !list || !uuid) return;

        const fieldName = type === "trait" ? "careerTraitUuid" : type === "focus" ? "careerFocusUuid" : "careerTalentUuid";
        const existing = Array.from(list.querySelectorAll(`[data-field='${fieldName}']`))
          .some(input => input.value === uuid);
        if (existing) return;

        const doc = await resolveUuidDoc(uuid);
        list.appendChild(this._buildUpbringingListItem(uuid, doc?.name ?? uuid, doc?.type ?? "", descriptionForDoc(doc), fieldName));
      });
    });

    el.querySelectorAll("[data-add-career-event-item]").forEach(button => {
      button.addEventListener("click", async () => {
        const row = button.closest(".sta2e-cc-career-event-row");
        const type = button.dataset.addCareerEventItem;
        const select = row?.querySelector(`[data-field='careerEvent${type.charAt(0).toUpperCase()}${type.slice(1)}Select']`);
        const list = row?.querySelector(`[data-career-event-list='${type}']`);
        const uuid = select?.value ?? "";
        if (!row || !list || !uuid) return;

        const fieldName = type === "trait" ? "careerEventTraitUuid" : "careerEventFocusUuid";
        const existing = Array.from(list.querySelectorAll(`[data-field='${fieldName}']`))
          .some(input => input.value === uuid);
        if (existing) return;

        const doc = await resolveUuidDoc(uuid);
        list.appendChild(this._buildUpbringingListItem(uuid, doc?.name ?? uuid, doc?.type ?? "", descriptionForDoc(doc), fieldName));
      });
    });

    el.querySelectorAll("[data-remove-talent]").forEach(button => {
      button.addEventListener("click", () => button.closest(".sta2e-cc-pill")?.remove());
    });

    el.querySelectorAll("[data-remove-config-item]").forEach(button => {
      button.addEventListener("click", () => button.closest(".sta2e-cc-pill")?.remove());
    });

    el.querySelectorAll("[data-remove-upbringing-item]").forEach(button => {
      button.addEventListener("click", () => button.closest(".sta2e-cc-pill")?.remove());
    });

    this._restoreScrollState();
    finishOpeningLoader(this);
  }

  _buildConfigListItem(uuid, name, type = "", description = "") {
    const li = document.createElement("li");
    li.className = "sta2e-cc-pill";
    li.dataset.descriptionRoot = "";

    const label = document.createElement("span");
    label.textContent = name;

    const input = document.createElement("input");
    input.type = "hidden";
    input.dataset.field = "configItemUuid";
    input.value = uuid;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.dataset.removeConfigItem = "";
    removeButton.title = "Remove item";
    removeButton.innerHTML = '<i class="fas fa-times"></i>';
    removeButton.addEventListener("click", () => li.remove());

    li.append(label, input);

    if (type) {
      const typeLabel = document.createElement("em");
      typeLabel.textContent = type;
      li.append(typeLabel);
    }

    if (description) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sta2e-cc-link-btn";
      toggle.dataset.toggleDescription = "";
      toggle.textContent = "Description";

      const panel = document.createElement("div");
      panel.className = "sta2e-cc-description-panel";
      panel.dataset.descriptionPanel = "";
      panel.hidden = true;
      panel.innerHTML = description;

      toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
      });

      li.append(toggle, panel);
    }

    li.append(removeButton);
    return li;
  }

  _buildTalentListItem(uuid, name, description = "", fieldName = "speciesTalentUuid") {
    const li = document.createElement("li");
    li.className = "sta2e-cc-pill";
    li.dataset.descriptionRoot = "";
    const label = document.createElement("span");
    label.textContent = name;

    const input = document.createElement("input");
    input.type = "hidden";
    input.dataset.field = fieldName;
    input.value = uuid;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.removeTalent = "";
    button.title = "Remove talent";
    button.innerHTML = '<i class="fas fa-times"></i>';
    button.addEventListener("click", () => li.remove());

    li.append(label, input);

    if (description) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sta2e-cc-link-btn";
      toggle.dataset.toggleDescription = "";
      toggle.textContent = "Description";

      const panel = document.createElement("div");
      panel.className = "sta2e-cc-description-panel";
      panel.dataset.descriptionPanel = "";
      panel.hidden = true;
      panel.innerHTML = description;

      toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
      });

      li.append(toggle, panel);
    }

    li.append(button);
    return li;
  }

  _buildUpbringingListItem(uuid, name, type = "", description = "", fieldName = "upbringingTalentUuid") {
    const li = document.createElement("li");
    li.className = "sta2e-cc-pill";
    li.dataset.descriptionRoot = "";

    const label = document.createElement("span");
    label.textContent = name;

    const input = document.createElement("input");
    input.type = "hidden";
    input.dataset.field = fieldName;
    input.value = uuid;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.dataset.removeUpbringingItem = "";
    removeButton.title = "Remove item";
    removeButton.innerHTML = '<i class="fas fa-times"></i>';
    removeButton.addEventListener("click", () => li.remove());

    li.append(label, input);

    if (type) {
      const typeLabel = document.createElement("em");
      typeLabel.textContent = type;
      li.append(typeLabel);
    }

    if (description) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sta2e-cc-link-btn";
      toggle.dataset.toggleDescription = "";
      toggle.textContent = "Description";

      const panel = document.createElement("div");
      panel.className = "sta2e-cc-description-panel";
      panel.dataset.descriptionPanel = "";
      panel.hidden = true;
      panel.innerHTML = description;

      toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
      });

      li.append(toggle, panel);
    }

    li.append(removeButton);
    return li;
  }

  static async _onAddSpecies() {
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.species.push(normalizeSpecies({ name: "New Species", trait: "New Species" }));
    await game.settings.set(MODULE, "characterCreatorData", data);
    this.render({ force: true });
  }

  static async _onDeleteSpecies(_event, target) {
    const id = target.dataset.speciesId;
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.species = data.species.filter(species => species.id !== id);
    data.ui.collapsedSpeciesIds = data.ui.collapsedSpeciesIds.filter(speciesId => speciesId !== id);
    this._collapsedSpecies.delete(id);
    await game.settings.set(MODULE, "characterCreatorData", data);
    this.render({ force: true });
  }

  static async _onAddEnvironment() {
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.environments.push(normalizeEnvironment({
      name: "New Environment",
      attributeMode: "selected",
      attributeChoices: ["daring", "presence"],
      departmentMode: "any",
    }));
    await game.settings.set(MODULE, "characterCreatorData", data);
    this.render({ force: true });
  }

  static async _onDeleteEnvironment(_event, target) {
    const id = target.dataset.environmentId;
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.environments = data.environments.filter(environment => environment.id !== id);
    data.ui.collapsedEnvironmentIds = data.ui.collapsedEnvironmentIds.filter(environmentId => environmentId !== id);
    this._collapsedEnvironments.delete(id);
    await game.settings.set(MODULE, "characterCreatorData", data);
    this.render({ force: true });
  }

  static async _onAddUpbringing() {
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.upbringings.push(normalizeUpbringing({
      name: "New Upbringing",
      accepted: { attributePlusOne: "control", attributePlusTwo: "fitness" },
      rebelled: { attributePlusOne: "daring", attributePlusTwo: "insight" },
      departmentChoices: ["command", "security", "science"],
    }));
    await game.settings.set(MODULE, "characterCreatorData", data);
    this.render({ force: true });
  }

  static async _onDeleteUpbringing(_event, target) {
    const id = target.dataset.upbringingId;
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.upbringings = data.upbringings.filter(upbringing => upbringing.id !== id);
    data.ui.collapsedUpbringingIds = data.ui.collapsedUpbringingIds.filter(upbringingId => upbringingId !== id);
    this._collapsedUpbringings.delete(id);
    await game.settings.set(MODULE, "characterCreatorData", data);
    this.render({ force: true });
  }

  static async _onAddCareerPath() {
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.careerPaths.push(normalizeCareerPath({
      name: "New Career Path",
      departments: { plusTwo: ["command"], plusOne: ["conn", "security"] },
    }));
    await game.settings.set(MODULE, "characterCreatorData", data);
    this.render({ force: true });
  }

  static async _onDeleteCareerPath(_event, target) {
    const id = target.dataset.careerPathId;
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.careerPaths = data.careerPaths.filter(careerPath => careerPath.id !== id);
    data.ui.collapsedCareerPathIds = data.ui.collapsedCareerPathIds.filter(careerPathId => careerPathId !== id);
    this._collapsedCareerPaths.delete(id);
    await game.settings.set(MODULE, "characterCreatorData", data);
    this.render({ force: true });
  }

  static async _onAddCareerEvent() {
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.careerEvents.push(normalizeCareerEvent({
      name: "New Career Event",
      attributeKey: "presence",
      departmentKey: "command",
    }));
    await game.settings.set(MODULE, "characterCreatorData", data);
    this._activeConfigTab = "events";
    this.render({ force: true });
  }

  static async _onDeleteCareerEvent(_event, target) {
    const id = target.dataset.careerEventId;
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    data.careerEvents = data.careerEvents.filter(event => event.id !== id);
    data.ui.collapsedCareerEventIds = data.ui.collapsedCareerEventIds.filter(eventId => eventId !== id);
    this._collapsedCareerEvents.delete(id);
    await game.settings.set(MODULE, "characterCreatorData", data);
    this._activeConfigTab = "events";
    this.render({ force: true });
  }

  static async _onAddRank() {
    const data = this._dataWithFinishingFromForm();
    data.finishing.ranks.push(normalizeRank({
      name: "New Rank",
      description: "",
    }));
    await game.settings.set(MODULE, "characterCreatorData", data);
    this._activeConfigTab = "finishing";
    this.render({ force: true });
  }

  static async _onDeleteRank(_event, target) {
    const id = target.dataset.rankId;
    const data = this._dataWithFinishingFromForm();
    data.finishing.ranks = data.finishing.ranks.filter(rank => rank.id !== id);
    delete data.finishing.rankLoadouts[id];
    await game.settings.set(MODULE, "characterCreatorData", data);
    this._activeConfigTab = "finishing";
    this.render({ force: true });
  }

  _dataWithFinishingFromForm() {
    return this._dataFromForm({ validate: false }) ?? getCreatorData();
  }

  static async _onSaveFinishing() {
    const data = this._dataWithFinishingFromForm();
    await game.settings.set(MODULE, "characterCreatorData", data);
    ui.notifications.info("STA2e Toolkit: Finishing ranks and equipment saved.");
    this._activeConfigTab = "finishing";
    this.render({ force: true });
  }

  static async _onAddAssignmentLoadout() {
    const data = this._dataWithFinishingFromForm();
    const baseName = "New Assignment";
    let name = baseName;
    let index = 2;
    while (Object.prototype.hasOwnProperty.call(data.finishing.assignmentLoadouts, name)) {
      name = `${baseName} ${index}`;
      index += 1;
    }
    data.finishing.assignmentLoadouts[name] = [];
    await game.settings.set(MODULE, "characterCreatorData", data);
    this._activeConfigTab = "finishing";
    this.render({ force: true });
  }

  static _onDeleteAssignmentLoadout(_event, target) {
    target.closest(".sta2e-cc-assignment-loadout-row")?.remove();
  }

  static get _sectionSpecs() {
    return {
      species:           { type: `${CC_SECTION_TYPE_PREFIX}species`,           shape: "array",      field: "species",           label: "Species",           normalize: normalizeSpecies },
      environments:      { type: `${CC_SECTION_TYPE_PREFIX}environments`,      shape: "array",      field: "environments",      label: "Environments",      normalize: normalizeEnvironment },
      upbringings:       { type: `${CC_SECTION_TYPE_PREFIX}upbringings`,       shape: "array",      field: "upbringings",       label: "Upbringings",       normalize: normalizeUpbringing },
      careerPaths:       { type: `${CC_SECTION_TYPE_PREFIX}careerPaths`,       shape: "array",      field: "careerPaths",       label: "Career Paths",      normalize: normalizeCareerPath },
      careerEvents:      { type: `${CC_SECTION_TYPE_PREFIX}careerEvents`,      shape: "array",      field: "careerEvents",      label: "Career Events",     normalize: normalizeCareerEvent },
      experienceOptions: { type: `${CC_SECTION_TYPE_PREFIX}experienceOptions`, shape: "keyed",      field: "experienceOptions", label: "Experience Options", normalize: normalizeExperienceOption, keyField: "key", appendable: false },
      talentPacks:       { type: `${CC_SECTION_TYPE_PREFIX}talentPacks`,       shape: "strings",    field: "talentPacks",       label: "Talent Source Packs" },
      finishing:         { type: `${CC_SECTION_TYPE_PREFIX}finishing`,         shape: "object",     field: "finishing",         label: "Finishing Data",    normalize: normalizeFinishingData },
      supportingDepartments: {
        type: `${CC_SECTION_TYPE_PREFIX}supportingDepartments`,
        shape: "loadoutMap",
        label: "Supporting Department Equipment",
        getValue: data => data?.finishing?.departmentLoadouts ?? {},
        setValue: (data, value) => {
          data.finishing = normalizeFinishingData({ ...(data.finishing ?? {}), departmentLoadouts: value });
        },
      },
    };
  }

  static _getSectionValue(spec, data) {
    if (typeof spec.getValue === "function") return spec.getValue(data);
    return data?.[spec.field];
  }

  static _setSectionValue(spec, data, value) {
    if (typeof spec.setValue === "function") { spec.setValue(data, value); return; }
    data[spec.field] = value;
  }

  static _exportSection(sectionKey) {
    const spec = CharacterCreatorConfig._sectionSpecs[sectionKey];
    if (!spec) return;
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    const sectionData = CharacterCreatorConfig._getSectionValue(spec, data);
    const payload = {
      type: spec.type,
      version: CC_SECTION_EXPORT_VERSION,
      module: MODULE,
      exportedAt: new Date().toISOString(),
    };
    if (spec.shape === "object" || spec.shape === "loadoutMap") payload.data = sectionData;
    else payload.entries = Array.isArray(sectionData) ? sectionData : [];
    downloadTextFile(
      `sta2e-character-creator-${sectionKey}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
    ui.notifications.info(`STA2e Toolkit: Exported ${spec.label}.`);
  }

  static async _importSection(sectionKey, file) {
    const spec = CharacterCreatorConfig._sectionSpecs[sectionKey];
    if (!spec) return;

    let payload = null;
    try {
      payload = JSON.parse(await readFileText(file));
    } catch (err) {
      console.warn("STA2e Toolkit | Character Creator import failed:", err);
      ui.notifications.warn("STA2e Toolkit: That import file is not valid JSON.");
      return;
    }

    if (payload?.type !== spec.type) {
      ui.notifications.warn(`STA2e Toolkit: That JSON file is not a ${spec.label} export.`);
      return;
    }

    let mode = "replace";
    if (spec.appendable !== false) {
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: `Import ${spec.label}` },
        content: `<p>How should the imported ${spec.label.toLowerCase()} merge with the existing data?</p>
                  <p><strong>Append</strong> keeps current entries and adds the imported ones with fresh IDs.<br>
                  <strong>Replace All</strong> wipes the current ${spec.label.toLowerCase()} and uses only the imported data.</p>`,
        buttons: [
          { action: "append",  label: "Append",      icon: "fas fa-plus",       default: true },
          { action: "replace", label: "Replace All", icon: "fas fa-arrows-rotate" },
          { action: "cancel",  label: "Cancel",      icon: "fas fa-times" },
        ],
      });
      if (!choice || choice === "cancel") return;
      mode = choice;
    }

    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    const currentValue = CharacterCreatorConfig._getSectionValue(spec, data);
    const merged = CharacterCreatorConfig._mergeSectionData(spec, currentValue, payload, mode);
    if (!merged.ok) {
      ui.notifications.warn(merged.message ?? "STA2e Toolkit: Nothing to import.");
      return;
    }

    CharacterCreatorConfig._setSectionValue(spec, data, merged.value);
    await game.settings.set(MODULE, "characterCreatorData", data);
    ui.notifications.info(`STA2e Toolkit: ${merged.message ?? `Imported ${spec.label}.`}`);
    this.render({ force: true });
  }

  static _mergeSectionData(spec, current, payload, mode) {
    const importedEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const importedData = payload?.data;

    if (spec.shape === "array") {
      if (!importedEntries.length) return { ok: false, message: "STA2e Toolkit: That export file contained no entries." };
      const normalize = spec.normalize ?? (entry => entry);
      if (mode === "replace") {
        const value = importedEntries.map(entry => normalize(entry));
        return { ok: true, value, message: `Replaced ${value.length} ${spec.label.toLowerCase()}. Save Creator Data to persist.` };
      }
      const reIded = importedEntries.map(entry => normalize({ ...entry, id: undefined }));
      const value = [...(Array.isArray(current) ? current : []), ...reIded];
      return { ok: true, value, message: `Appended ${reIded.length} ${spec.label.toLowerCase()}. Save Creator Data to persist.` };
    }

    if (spec.shape === "keyed") {
      if (!importedEntries.length) return { ok: false, message: "STA2e Toolkit: That export file contained no entries." };
      const keyField = spec.keyField ?? "key";
      const normalize = spec.normalize ?? (entry => entry);
      const currentList = Array.isArray(current) ? current : [];
      const knownKeys = new Set(currentList.map(entry => entry?.[keyField]));
      const importedByKey = new Map();
      let unknown = 0;
      for (const entry of importedEntries) {
        const key = entry?.[keyField];
        if (!knownKeys.has(key)) { unknown += 1; continue; }
        importedByKey.set(key, entry);
      }
      if (!importedByKey.size) {
        const msg = unknown
          ? `STA2e Toolkit: None of the imported ${spec.label.toLowerCase()} matched a known key.`
          : "STA2e Toolkit: That export file contained no entries.";
        return { ok: false, message: msg };
      }
      const value = currentList.map(entry => {
        const replacement = importedByKey.get(entry?.[keyField]);
        return replacement ? normalize({ ...entry, ...replacement }) : entry;
      });
      const updated = importedByKey.size;
      const dropped = unknown ? ` ${unknown} unknown key${unknown === 1 ? "" : "s"} skipped.` : "";
      return { ok: true, value, message: `Updated ${updated} ${spec.label.toLowerCase()}.${dropped} Save Creator Data to persist.` };
    }

    if (spec.shape === "strings") {
      const importedList = Array.isArray(importedEntries)
        ? importedEntries.map(value => String(value ?? "").trim()).filter(Boolean)
        : [];
      if (!importedList.length) return { ok: false, message: "STA2e Toolkit: That export file contained no talent pack entries." };
      if (mode === "replace") {
        return { ok: true, value: importedList, message: `Replaced ${importedList.length} talent pack entr${importedList.length === 1 ? "y" : "ies"}. Save Creator Data to persist.` };
      }
      const seen = new Set((Array.isArray(current) ? current : []).map(value => String(value ?? "").trim().toLowerCase()).filter(Boolean));
      const additions = [];
      for (const value of importedList) {
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push(value);
      }
      const value = [...(Array.isArray(current) ? current : []), ...additions];
      return { ok: true, value, message: `Added ${additions.length} new talent pack entr${additions.length === 1 ? "y" : "ies"}. Save Creator Data to persist.` };
    }

    if (spec.shape === "loadoutMap") {
      if (!importedData || typeof importedData !== "object") return { ok: false, message: `STA2e Toolkit: That export file did not contain ${spec.label.toLowerCase()}.` };
      const normalizeMap = source => {
        const out = {};
        if (!source || typeof source !== "object") return out;
        for (const [key, value] of Object.entries(source)) {
          const trimmed = String(key ?? "").trim();
          if (!trimmed) continue;
          out[trimmed] = Array.isArray(value) ? value.map(uuid => String(uuid ?? "").trim()).filter(Boolean) : [];
        }
        return out;
      };
      const importedMap = normalizeMap(importedData);
      if (!Object.keys(importedMap).length) return { ok: false, message: "STA2e Toolkit: That export file contained no department entries." };

      if (mode === "replace") {
        return { ok: true, value: importedMap, message: `Replaced ${Object.keys(importedMap).length} department loadout${Object.keys(importedMap).length === 1 ? "" : "s"}. Save Creator Data to persist.` };
      }

      const existingMap = normalizeMap(current);
      const merged = { ...existingMap };
      let added = 0;
      for (const [key, uuids] of Object.entries(importedMap)) {
        const existing = Array.isArray(merged[key]) ? merged[key] : [];
        const seen = new Set(existing);
        const next = [...existing];
        for (const uuid of uuids) {
          if (seen.has(uuid)) continue;
          seen.add(uuid);
          next.push(uuid);
          added += 1;
        }
        merged[key] = next;
      }
      return { ok: true, value: merged, message: `Added ${added} new equipment entr${added === 1 ? "y" : "ies"} across ${Object.keys(importedMap).length} department${Object.keys(importedMap).length === 1 ? "" : "s"}. Save Creator Data to persist.` };
    }

    if (spec.shape === "object") {
      if (!importedData || typeof importedData !== "object") return { ok: false, message: "STA2e Toolkit: That export file did not contain finishing data." };
      const normalize = spec.normalize ?? (data => data);
      if (mode === "replace") {
        return { ok: true, value: normalize(importedData), message: "Replaced finishing data. Save Creator Data to persist." };
      }
      const existing = current && typeof current === "object" ? current : {};
      const mergedRanksRaw = [
        ...(Array.isArray(existing.ranks) ? existing.ranks : []),
        ...(Array.isArray(importedData.ranks) ? importedData.ranks.map(rank => ({ ...rank, id: undefined })) : []),
      ];
      const value = normalize({
        roleLoadouts:       { ...(existing.roleLoadouts ?? {}),       ...(importedData.roleLoadouts ?? {}) },
        rankLoadouts:       { ...(existing.rankLoadouts ?? {}),       ...(importedData.rankLoadouts ?? {}) },
        departmentLoadouts: { ...(existing.departmentLoadouts ?? {}), ...(importedData.departmentLoadouts ?? {}) },
        assignmentLoadouts: { ...(existing.assignmentLoadouts ?? {}), ...(importedData.assignmentLoadouts ?? {}) },
        ranks: mergedRanksRaw,
      });
      const newRanks = Array.isArray(importedData.ranks) ? importedData.ranks.length : 0;
      return { ok: true, value, message: `Merged finishing loadouts and appended ${newRanks} rank${newRanks === 1 ? "" : "s"}. Save Creator Data to persist.` };
    }

    return { ok: false, message: "STA2e Toolkit: Unknown section shape." };
  }

  static _speciesNamePayloadFromRow(row) {
    return {
      type: "sta2e-toolkit.speciesNames",
      version: 2,
      species: String(row.querySelector("[data-field='name']")?.value ?? "").trim(),
      surnameFirst: row.querySelector("[data-field='surnameFirst']")?.checked ?? false,
      maleFirstNames: normalizeNameList(row.querySelector("[data-field='maleFirstNames']")?.value),
      femaleFirstNames: normalizeNameList(row.querySelector("[data-field='femaleFirstNames']")?.value),
      surnames: normalizeNameList(row.querySelector("[data-field='surnames']")?.value),
    };
  }

  static _setSpeciesNameList(row, field, names) {
    const textarea = row.querySelector(`[data-field='${field}']`);
    if (textarea) textarea.value = nameListToText(names);
  }

  static _exportSpeciesNames(row) {
    const payload = this._speciesNamePayloadFromRow(row);
    const speciesName = payload.species || "species";
    const safeName = speciesName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "species";
    downloadTextFile(
      `sta2e-${safeName}-names.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  }

  static async _importSpeciesNames(row, file) {
    let payload = null;
    try {
      payload = JSON.parse(await readFileText(file));
    } catch (err) {
      console.warn("STA2e Toolkit | Species name import failed:", err);
      ui.notifications.warn("STA2e Toolkit: That name import file is not valid JSON.");
      return;
    }

    if (payload?.type !== "sta2e-toolkit.speciesNames") {
      ui.notifications.warn("STA2e Toolkit: That JSON file is not a species name list export.");
      return;
    }

    const importedLegacyFirstNames = normalizeNameList(payload.firstNames);
    const importedMaleFirstNames = normalizeNameList([
      ...normalizeNameList(payload.maleFirstNames),
      ...importedLegacyFirstNames,
    ]);
    const importedFemaleFirstNames = normalizeNameList([
      ...normalizeNameList(payload.femaleFirstNames),
      ...importedLegacyFirstNames,
    ]);
    const importedSurnames = normalizeNameList(payload.surnames);
    if (!importedMaleFirstNames.length && !importedFemaleFirstNames.length && !importedSurnames.length && typeof payload.surnameFirst !== "boolean") {
      ui.notifications.warn("STA2e Toolkit: That name import file does not contain any first names or surnames.");
      return;
    }

    const current = this._speciesNamePayloadFromRow(row);
    const maleFirstNames = mergeNameLists(current.maleFirstNames, importedMaleFirstNames);
    const femaleFirstNames = mergeNameLists(current.femaleFirstNames, importedFemaleFirstNames);
    const surnames = mergeNameLists(current.surnames, importedSurnames);
    this._setSpeciesNameList(row, "maleFirstNames", maleFirstNames);
    this._setSpeciesNameList(row, "femaleFirstNames", femaleFirstNames);
    this._setSpeciesNameList(row, "surnames", surnames);

    const surnameFirst = row.querySelector("[data-field='surnameFirst']");
    if (surnameFirst && typeof payload.surnameFirst === "boolean") surnameFirst.checked = payload.surnameFirst;

    const maleAdded = maleFirstNames.length - current.maleFirstNames.length;
    const femaleAdded = femaleFirstNames.length - current.femaleFirstNames.length;
    const surnamesAdded = surnames.length - current.surnames.length;
    ui.notifications.info(`STA2e Toolkit: Imported ${maleAdded} male first name${maleAdded === 1 ? "" : "s"}, ${femaleAdded} female first name${femaleAdded === 1 ? "" : "s"}, and ${surnamesAdded} surname${surnamesAdded === 1 ? "" : "s"}. Save Creator Data to persist.`);
  }

  static _clearSpeciesNames(row) {
    this._setSpeciesNameList(row, "maleFirstNames", []);
    this._setSpeciesNameList(row, "femaleFirstNames", []);
    this._setSpeciesNameList(row, "surnames", []);
    const surnameFirst = row.querySelector("[data-field='surnameFirst']");
    if (surnameFirst) surnameFirst.checked = false;
    ui.notifications.info("STA2e Toolkit: Cleared this species name lists. Save Creator Data to persist.");
  }

  static _collectReferencedPacks(data) {
    const counts = new Map();
    const PACK_RE = /^Compendium\.([^.]+\.[^.]+)\./;
    const tally = packId => counts.set(packId, (counts.get(packId) ?? 0) + 1);

    const walk = node => {
      if (node == null) return;
      if (typeof node === "string") {
        const m = node.match(PACK_RE);
        if (m) tally(m[1]);
        return;
      }
      if (Array.isArray(node)) { for (const v of node) walk(v); return; }
      if (typeof node === "object") { for (const v of Object.values(node)) walk(v); }
    };
    walk(data);

    for (const id of (Array.isArray(data?.talentPacks) ? data.talentPacks : [])) {
      const trimmed = String(id ?? "").trim();
      if (trimmed) tally(trimmed);
    }

    const out = [];
    for (const [packId, count] of counts) {
      const pack = game.packs?.get(packId);
      out.push({
        packId,
        count,
        label: pack?.metadata?.label ?? packId,
        documentName: pack?.documentName ?? pack?.metadata?.type ?? null,
        missing: !pack,
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  static async _exportPack() {
    const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
    const refs = CharacterCreatorConfig._collectReferencedPacks(data);
    if (!refs.length) {
      ui.notifications.info("STA2e Toolkit: No compendium packs are referenced by the current creator data.");
      return;
    }

    const escape = foundry.utils.escapeHTML ?? (s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]));
    const options = refs.map(r => {
      const tag = r.missing ? " — (not installed)" : "";
      const dis = r.missing ? " disabled" : "";
      return `<option value="${escape(r.packId)}"${dis}>${escape(r.label)} [${escape(r.packId)}] · ${r.count} ref${r.count === 1 ? "" : "s"}${tag}</option>`;
    }).join("");

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Export Compendium Pack" },
      content: `<p>Pick a compendium pack referenced by the creator data. Every document in that pack will be saved to a JSON file you can import into another world.</p>
                <label style="display:block;margin-top:0.5rem;">Pack
                  <select name="packId" style="width:100%;margin-top:0.25rem;">${options}</select>
                </label>`,
      buttons: [
        {
          action: "export", label: "Export", icon: "fas fa-file-export", default: true,
          callback: (_event, button) => button.form?.elements?.packId?.value ?? null,
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });

    if (!choice || choice === "cancel") return;

    const pack = game.packs?.get(choice);
    if (!pack) {
      ui.notifications.error(`STA2e Toolkit: Pack "${choice}" is not installed in this world.`);
      return;
    }

    let docs;
    try {
      docs = await pack.getDocuments();
    } catch (err) {
      console.error("STA2e Toolkit | Pack export failed:", err);
      ui.notifications.error("STA2e Toolkit: Failed to load pack documents. See console.");
      return;
    }

    const folders = pack.folders?.contents ?? [];
    const payload = {
      type: "sta2e-toolkit.compendiumPack",
      version: 2,
      module: MODULE,
      exportedAt: new Date().toISOString(),
      pack: {
        id: pack.collection,
        label: pack.metadata?.label ?? pack.collection,
        documentName: pack.documentName ?? pack.metadata?.type ?? "Item",
        packageType: pack.metadata?.packageType ?? null,
        packageName: pack.metadata?.packageName ?? null,
      },
      folders: folders.map(f => f.toObject()),
      documents: docs.map(d => d.toObject()),
    };

    const safe = String(pack.collection).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "pack";
    downloadTextFile(`sta2e-pack-${safe}.json`, JSON.stringify(payload, null, 2), "application/json");
    ui.notifications.info(`STA2e Toolkit: Exported ${docs.length} document${docs.length === 1 ? "" : "s"} from ${pack.metadata?.label ?? pack.collection}.`);
  }

  static async _importPack(file) {
    let payload = null;
    try {
      payload = JSON.parse(await readFileText(file));
    } catch (err) {
      console.warn("STA2e Toolkit | Pack import failed:", err);
      ui.notifications.warn("STA2e Toolkit: That import file is not valid JSON.");
      return;
    }

    if (payload?.type !== "sta2e-toolkit.compendiumPack" || !Array.isArray(payload.documents)) {
      ui.notifications.warn("STA2e Toolkit: That JSON file is not a compendium pack export.");
      return;
    }

    const sourcePackId = String(payload.pack?.id ?? "").trim();
    const documentName = String(payload.pack?.documentName ?? "Item");
    const sourceLabel = String(payload.pack?.label ?? sourcePackId ?? "Imported Pack");
    const importedFolders = Array.isArray(payload.folders) ? payload.folders : [];
    if (!sourcePackId) {
      ui.notifications.warn("STA2e Toolkit: Pack export is missing a source pack id.");
      return;
    }

    const sanitized = sourcePackId.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "imported-pack";
    const targetPackId = `world.${sanitized}`;
    let targetPack = game.packs?.get(targetPackId);
    let mode = "create";

    if (targetPack) {
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Import Compendium Pack" },
        content: `<p>A world pack <code>${targetPackId}</code> already exists.</p>
                  <p><strong>Replace</strong> deletes its existing documents and inserts the imported ones.<br>
                  <strong>Merge</strong> adds imported documents and skips IDs that already exist.</p>`,
        buttons: [
          { action: "merge",   label: "Merge",   icon: "fas fa-plus",         default: true },
          { action: "replace", label: "Replace", icon: "fas fa-arrows-rotate" },
          { action: "cancel",  label: "Cancel",  icon: "fas fa-times" },
        ],
      });
      if (!choice || choice === "cancel") return;
      mode = choice;
    } else {
      try {
        targetPack = await CompendiumCollection.createCompendium({
          label: sourceLabel,
          name: sanitized,
          type: documentName,
          package: "world",
        });
      } catch (err) {
        console.error("STA2e Toolkit | Pack creation failed:", err);
        ui.notifications.error("STA2e Toolkit: Could not create world compendium. See console.");
        return;
      }
    }

    const DocCls = CONFIG[targetPack.documentName]?.documentClass;
    if (!DocCls) {
      ui.notifications.error(`STA2e Toolkit: Unknown document type "${targetPack.documentName}".`);
      return;
    }

    if (mode === "replace") {
      try {
        const existingDocs = await targetPack.getDocuments();
        const docIds = existingDocs.map(d => d.id);
        if (docIds.length) await DocCls.deleteDocuments(docIds, { pack: targetPack.collection });
        const folderIds = (targetPack.folders?.contents ?? []).map(f => f.id);
        if (folderIds.length) await Folder.deleteDocuments(folderIds, { pack: targetPack.collection });
      } catch (err) {
        console.error("STA2e Toolkit | Failed to clear pack:", err);
        ui.notifications.error("STA2e Toolkit: Failed to clear the existing pack. See console.");
        return;
      }
    }

    let foldersCreated = 0;
    let foldersSkipped = 0;
    if (importedFolders.length) {
      try {
        let foldersToInsert = importedFolders;
        if (mode === "merge") {
          const existingFolderIds = new Set((targetPack.folders?.contents ?? []).map(f => f.id));
          foldersToInsert = importedFolders.filter(f => !existingFolderIds.has(f._id));
          foldersSkipped = importedFolders.length - foldersToInsert.length;
        }
        if (foldersToInsert.length) {
          const result = await Folder.createDocuments(foldersToInsert, { pack: targetPack.collection, keepId: true });
          foldersCreated = result?.length ?? foldersToInsert.length;
        }
      } catch (err) {
        console.error("STA2e Toolkit | Pack folder import failed:", err);
        ui.notifications.warn("STA2e Toolkit: Failed to recreate folder structure (continuing with documents). See console.");
      }
    }

    let created = 0;
    let skipped = 0;
    try {
      let toInsert = payload.documents;
      if (mode === "merge") {
        const existing = await targetPack.getDocuments();
        const existingIds = new Set(existing.map(d => d.id));
        toInsert = payload.documents.filter(doc => !existingIds.has(doc._id));
        skipped = payload.documents.length - toInsert.length;
      }
      const result = await DocCls.createDocuments(toInsert, { pack: targetPack.collection, keepId: true });
      created = result?.length ?? toInsert.length;
    } catch (err) {
      console.error("STA2e Toolkit | Pack document import failed:", err);
      ui.notifications.error("STA2e Toolkit: Failed to insert pack documents. See console.");
      return;
    }

    let remappedCount = 0;
    if (sourcePackId !== targetPack.collection) {
      const remap = await foundry.applications.api.DialogV2.wait({
        window: { title: "Remap Creator References?" },
        content: `<p>Update creator data so references to <code>${sourcePackId}</code> point at the new world pack <code>${targetPack.collection}</code>?</p>
                  <p>If you skip this, existing creator data still points at the original pack id.</p>`,
        buttons: [
          { action: "yes", label: "Remap", icon: "fas fa-check", default: true },
          { action: "no",  label: "Skip",  icon: "fas fa-times" },
        ],
      });
      if (remap === "yes") {
        const data = this._dataFromForm({ validate: false }) ?? getCreatorData();
        remappedCount = CharacterCreatorConfig._remapCreatorUuids(data, sourcePackId, targetPack.collection);
        await game.settings.set(MODULE, "characterCreatorData", data);
        this.render({ force: true });
      }
    }

    const folderMsg = foldersCreated ? ` and ${foldersCreated} folder${foldersCreated === 1 ? "" : "s"}` : "";
    const skippedFolders = foldersSkipped ? `, skipped ${foldersSkipped} duplicate folder${foldersSkipped === 1 ? "" : "s"}` : "";
    const skippedMsg = skipped ? `, skipped ${skipped} duplicate document${skipped === 1 ? "" : "s"}` : "";
    const remapMsg = remappedCount ? `, remapped ${remappedCount} reference${remappedCount === 1 ? "" : "s"}` : "";
    ui.notifications.info(`STA2e Toolkit: Imported ${created} document${created === 1 ? "" : "s"}${folderMsg} into ${targetPack.collection}${skippedMsg}${skippedFolders}${remapMsg}.`);
  }

  static _remapCreatorUuids(data, oldPackId, newPackId) {
    if (!data || oldPackId === newPackId) return 0;
    const oldPrefix = `Compendium.${oldPackId}.`;
    const newPrefix = `Compendium.${newPackId}.`;
    let count = 0;

    const remap = node => {
      if (node == null) return node;
      if (typeof node === "string") {
        if (node.startsWith(oldPrefix)) { count += 1; return newPrefix + node.slice(oldPrefix.length); }
        return node;
      }
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) node[i] = remap(node[i]);
        return node;
      }
      if (typeof node === "object") {
        for (const k of Object.keys(node)) node[k] = remap(node[k]);
        return node;
      }
      return node;
    };
    remap(data);

    if (Array.isArray(data.talentPacks)) {
      for (let i = 0; i < data.talentPacks.length; i += 1) {
        if (String(data.talentPacks[i] ?? "").trim() === oldPackId) {
          data.talentPacks[i] = newPackId;
          count += 1;
        }
      }
    }

    return count;
  }

  _dataFromForm({ validate = true } = {}) {
    const el = this.element;
    if (!el) return getCreatorData();

    const species = [];
    const environments = [];
    const upbringings = [];
    const careerPaths = [];
    const experienceOptions = [];
    const careerEvents = [];
    const finishing = normalizeFinishingData();

    for (const row of el.querySelectorAll(".sta2e-cc-species-row[data-species-id]")) {
      const freeAttributeSelection = row.querySelector("[data-field='freeAttributeSelection']")?.checked ?? false;
      const attributeBoosts = Array.from(row.querySelectorAll("[data-field='attributeBoost']:checked"))
        .map(input => input.value);
      const attributeChoiceBoosts = Array.from(row.querySelectorAll("[data-field='attributeChoiceBoost']:checked"))
        .map(input => input.value);

      if (validate && !freeAttributeSelection) {
        const boostRuleTotal = attributeBoosts.length + (attributeChoiceBoosts.length ? 1 : 0);
        if (attributeChoiceBoosts.length === 1) {
          ui.notifications.warn("STA2e Toolkit: Choose-one species attribute rules need at least two choice options.");
          return null;
        }
        if (attributeBoosts.length > 3 || boostRuleTotal > 3) {
          ui.notifications.warn("STA2e Toolkit: Species attribute rules may grant only three total boosts.");
          return null;
        }
      }

      species.push(normalizeSpecies({
        id: row.dataset.speciesId,
        name: row.querySelector("[data-field='name']")?.value,
        traitUuids: Array.from(row.querySelectorAll("[data-field='speciesTraitUuid']"))
          .map(input => input.value),
        description: row.querySelector("[data-field='description']")?.value,
        tokenImage: row.querySelector("[data-field='tokenImage']")?.value,
        extraFocusCount: row.querySelector("[data-field='extraFocusCount']")?.value,
        freeAttributeSelection,
        attributeBoosts,
        attributeChoiceBoosts,
        speciesAbilityUuid: row.querySelector("[data-field='speciesAbilityUuid']")?.value,
        speciesEsotericTalentCount: row.querySelector("[data-field='speciesEsotericTalentCount']")?.value,
        speciesTalentUuids: Array.from(row.querySelectorAll("[data-field='speciesTalentUuid']"))
          .map(input => input.value),
        speciesValueUuids: Array.from(row.querySelectorAll("[data-field='speciesValueUuid']"))
          .map(input => input.value),
        speciesEsotericTalentUuids: Array.from(row.querySelectorAll("[data-field='speciesEsotericTalentUuid']"))
          .map(input => input.value),
        maleFirstNames: normalizeNameList(row.querySelector("[data-field='maleFirstNames']")?.value),
        femaleFirstNames: normalizeNameList(row.querySelector("[data-field='femaleFirstNames']")?.value),
        surnames: normalizeNameList(row.querySelector("[data-field='surnames']")?.value),
        surnameFirst: row.querySelector("[data-field='surnameFirst']")?.checked ?? false,
      }));
    }

    for (const row of el.querySelectorAll(".sta2e-cc-environment-row")) {
      environments.push(normalizeEnvironment({
        id: row.dataset.environmentId,
        name: row.querySelector("[data-field='environmentName']")?.value,
        description: row.querySelector("[data-field='environmentDescription']")?.value,
        valueDescription: row.querySelector("[data-field='environmentValueDescription']")?.value,
        attributeDescription: row.querySelector("[data-field='environmentAttributeDescription']")?.value,
        attributeMode: row.querySelector("[data-field='environmentAttributeMode']")?.value,
        attributeChoices: Array.from(row.querySelectorAll("[data-field='environmentAttributeChoice']:checked"))
          .map(input => input.value),
        departmentDescription: row.querySelector("[data-field='environmentDepartmentDescription']")?.value,
        departmentMode: row.querySelector("[data-field='environmentDepartmentMode']")?.value,
        departmentChoices: Array.from(row.querySelectorAll("[data-field='environmentDepartmentChoice']:checked"))
          .map(input => input.value),
      }));
    }

    for (const row of el.querySelectorAll(".sta2e-cc-upbringing-row")) {
      const allowAllDepartments = row.querySelector("[data-field='upbringingAllowAllDepartments']")?.checked ?? false;
      const departmentChoices = Array.from(row.querySelectorAll("[data-field='upbringingDepartmentChoice']:checked"))
        .map(input => input.value);
      if (validate && !allowAllDepartments && departmentChoices.length !== 3) {
        ui.notifications.warn("STA2e Toolkit: Each upbringing must have exactly three department choices.");
        return null;
      }
      const acceptedPlusOne = row.querySelector("[data-field='upbringingAcceptedPlusOne']")?.value;
      const acceptedPlusTwo = row.querySelector("[data-field='upbringingAcceptedPlusTwo']")?.value;
      const rebelledPlusOne = row.querySelector("[data-field='upbringingRebelledPlusOne']")?.value;
      const rebelledPlusTwo = row.querySelector("[data-field='upbringingRebelledPlusTwo']")?.value;
      if (validate && acceptedPlusOne && acceptedPlusOne === acceptedPlusTwo) {
        ui.notifications.warn("STA2e Toolkit: Accepted upbringing attributes must be two different attributes.");
        return null;
      }
      if (validate && rebelledPlusOne && rebelledPlusOne === rebelledPlusTwo) {
        ui.notifications.warn("STA2e Toolkit: Rebelled upbringing attributes must be two different attributes.");
        return null;
      }

      upbringings.push(normalizeUpbringing({
        id: row.dataset.upbringingId,
        name: row.querySelector("[data-field='upbringingName']")?.value,
        description: row.querySelector("[data-field='upbringingDescription']")?.value,
        acceptedDescription: row.querySelector("[data-field='upbringingAcceptedDescription']")?.value,
        rebelledDescription: row.querySelector("[data-field='upbringingRebelledDescription']")?.value,
        accepted: {
          attributePlusOne: acceptedPlusOne,
          attributePlusTwo: acceptedPlusTwo,
        },
        rebelled: {
          attributePlusOne: rebelledPlusOne,
          attributePlusTwo: rebelledPlusTwo,
        },
        departmentDescription: row.querySelector("[data-field='upbringingDepartmentDescription']")?.value,
        allowAllDepartments,
        departmentChoices,
        focusDescription: row.querySelector("[data-field='upbringingFocusDescription']")?.value,
        recommendedFocusUuids: Array.from(row.querySelectorAll("[data-field='upbringingFocusUuid']"))
          .map(input => input.value),
        talentDescription: row.querySelector("[data-field='upbringingTalentDescription']")?.value,
        talentUuids: Array.from(row.querySelectorAll("[data-field='upbringingTalentUuid']"))
          .map(input => input.value),
      }));
    }

    for (const row of el.querySelectorAll(".sta2e-cc-career-row")) {
      const plusTwo = Array.from(row.querySelectorAll("[data-field='careerDepartmentPlusTwo']:checked"))
        .map(input => input.value);
      const plusOne = Array.from(row.querySelectorAll("[data-field='careerDepartmentPlusOne']:checked"))
        .map(input => input.value);
      if (validate && (!plusTwo.length || plusOne.length < 2)) {
        ui.notifications.warn("STA2e Toolkit: Each career path must have at least one +2 department option and at least two +1 department options.");
        return null;
      }

      careerPaths.push(normalizeCareerPath({
        id: row.dataset.careerPathId,
        name: row.querySelector("[data-field='careerPathName']")?.value,
        description: row.querySelector("[data-field='careerPathDescription']")?.value,
        traitDescription: row.querySelector("[data-field='careerTraitDescription']")?.value,
        traitUuids: Array.from(row.querySelectorAll("[data-field='careerTraitUuid']"))
          .map(input => input.value),
        valueDescription: row.querySelector("[data-field='careerValueDescription']")?.value,
        attributeDescription: row.querySelector("[data-field='careerAttributeDescription']")?.value,
        requiredAttributes: Array.from(row.querySelectorAll("[data-field='careerRequiredAttribute']:checked"))
          .map(input => input.value),
        departmentDescription: row.querySelector("[data-field='careerDepartmentDescription']")?.value,
        departmentReallocationAllowed: !!row.querySelector("[data-field='careerDepartmentReallocationAllowed']")?.checked,
        departments: { plusTwo, plusOne },
        focusDescription: row.querySelector("[data-field='careerFocusDescription']")?.value,
        recommendedFocusUuids: Array.from(row.querySelectorAll("[data-field='careerFocusUuid']"))
          .map(input => input.value),
        talentDescription: row.querySelector("[data-field='careerTalentDescription']")?.value,
        talentUuids: Array.from(row.querySelectorAll("[data-field='careerTalentUuid']"))
          .map(input => input.value),
      }));
    }

    for (const row of el.querySelectorAll(".sta2e-cc-experience-row")) {
      experienceOptions.push(normalizeExperienceOption({
        key: row.dataset.experienceKey,
        description: row.querySelector("[data-field='experienceDescription']")?.value,
        valueDescription: row.querySelector("[data-field='experienceValueDescription']")?.value,
        talentDescription: row.querySelector("[data-field='experienceTalentDescription']")?.value,
        talentUuids: Array.from(row.querySelectorAll("[data-field='experienceTalentUuid']"))
          .map(input => input.value),
      }));
    }

    for (const row of el.querySelectorAll(".sta2e-cc-career-event-row")) {
      const allowAnyAttribute = !!row.querySelector("[data-field='careerEventAllowAnyAttribute']")?.checked;
      const attributeChoices = Array.from(row.querySelectorAll("[data-field='careerEventAttribute']:checked"))
        .map(input => input.value);
      const allowAnyDepartment = !!row.querySelector("[data-field='careerEventAllowAnyDepartment']")?.checked;
      const departmentChoices = Array.from(row.querySelectorAll("[data-field='careerEventDepartment']:checked"))
        .map(input => input.value);
      if (validate && !allowAnyAttribute && !attributeChoices.length) {
        ui.notifications.warn("STA2e Toolkit: Each career event must allow any attribute or choose at least one attribute.");
        return null;
      }
      if (validate && !allowAnyDepartment && !departmentChoices.length) {
        ui.notifications.warn("STA2e Toolkit: Each career event must allow any department or choose at least one department.");
        return null;
      }

      careerEvents.push(normalizeCareerEvent({
        id: row.dataset.careerEventId,
        name: row.querySelector("[data-field='careerEventName']")?.value,
        description: row.querySelector("[data-field='careerEventDescription']")?.value,
        allowAnyAttribute,
        attributeChoices,
        allowAnyDepartment,
        departmentChoices,
        focusDescription: row.querySelector("[data-field='careerEventFocusDescription']")?.value,
        suggestedFocusUuids: Array.from(row.querySelectorAll("[data-field='careerEventFocusUuid']"))
          .map(input => input.value),
        traitGrant: !!row.querySelector("[data-field='careerEventTraitGrant']")?.checked,
        traitDescription: row.querySelector("[data-field='careerEventTraitDescription']")?.value,
        suggestedTraitUuids: Array.from(row.querySelectorAll("[data-field='careerEventTraitUuid']"))
          .map(input => input.value),
      }));
    }

    finishing.ranks = Array.from(el.querySelectorAll(".sta2e-cc-rank-row"))
      .map(row => normalizeRank({
        id: row.dataset.rankId,
        name: row.querySelector("[data-field='rankName']")?.value,
        description: row.querySelector("[data-field='rankDescription']")?.value,
      }))
      .filter(rank => rank.name || rank.description);
    for (const row of el.querySelectorAll(".sta2e-cc-rank-row")) {
      const rankId = row.dataset.rankId;
      if (!rankId || !finishing.ranks.some(rank => rank.id === rankId)) continue;
      finishing.rankLoadouts[rankId] = Array.from(row.querySelectorAll("[data-field='rankLoadoutEquipmentUuid']"))
        .map(input => input.value);
    }

    finishing.departmentLoadouts = {};
    for (const row of el.querySelectorAll(".sta2e-cc-department-loadout-row")) {
      const department = row.dataset.department;
      if (!DISCIPLINE_KEYS.includes(department)) continue;
      finishing.departmentLoadouts[department] = Array.from(row.querySelectorAll("[data-field='departmentLoadoutEquipmentUuid']"))
        .map(input => input.value);
    }

    finishing.assignmentLoadouts = {};
    for (const row of el.querySelectorAll(".sta2e-cc-assignment-loadout-row")) {
      const name = String(row.querySelector("[data-field='assignmentLoadoutName']")?.value ?? "").trim();
      if (!name) continue;
      finishing.assignmentLoadouts[name] = Array.from(row.querySelectorAll("[data-field='assignmentLoadoutEquipmentUuid']"))
        .map(input => input.value);
    }

    const talentPacks = (el.querySelector("[data-field='talentPacks']")?.value ?? "")
      .split(/\r?\n|,/)
      .map(s => s.trim())
      .filter(Boolean);

    const previousData = getCreatorData();
    const config = normalizeConfigData(previousData.config);
    for (const category of TALENT_CATEGORIES) {
      config.talents[category.key] = Array.from(el.querySelectorAll(`[data-config-list="talent:${category.key}"] [data-field='configItemUuid']`))
        .map(input => input.value);
    }
    config.roles = Array.from(el.querySelectorAll(`[data-config-list="roles"] [data-field='configItemUuid']`))
      .map(input => input.value);
    config.traits = Array.from(el.querySelectorAll(`[data-config-list="traits"] [data-field='configItemUuid']`))
      .map(input => input.value);
    config.values = Array.from(el.querySelectorAll(`[data-config-list="values"] [data-field='configItemUuid']`))
      .map(input => input.value);
    config.departmentFocuses = {};
    for (const key of DISCIPLINE_KEYS) {
      config.departmentFocuses[key] = Array.from(el.querySelectorAll(`[data-config-list="departmentFocuses:${key}"] [data-field='configItemUuid']`))
        .map(input => input.value);
    }
    const departmentFocusUuids = configuredDepartmentFocusUuids(config);
    config.focuses = departmentFocusUuids.length ? departmentFocusUuids : normalizeUuidList(previousData.config?.focuses);
    config.items = Array.from(el.querySelectorAll(`[data-config-list="items"] [data-field='configItemUuid']`))
      .map(input => input.value);
    config.weapons = Array.from(el.querySelectorAll(`[data-config-list="weapons"] [data-field='configItemUuid']`))
      .map(input => input.value);
    config.armor = Array.from(el.querySelectorAll(`[data-config-list="armor"] [data-field='configItemUuid']`))
      .map(input => input.value);

    for (const row of el.querySelectorAll(".sta2e-cc-role-loadout-row")) {
      const roleUuid = row.dataset.roleUuid;
      if (!roleUuid) continue;
      finishing.roleLoadouts[roleUuid] = Array.from(row.querySelectorAll("[data-field='roleLoadoutEquipmentUuid']"))
        .map(input => input.value);
    }

    const uiState = normalizeUiData({
      collapsedSpeciesIds: Array.from(el.querySelectorAll(".sta2e-cc-species-row[data-species-id]"))
        .filter(row => row.querySelector("[data-species-body]")?.hidden)
        .map(row => row.dataset.speciesId),
      collapsedEnvironmentIds: Array.from(el.querySelectorAll(".sta2e-cc-environment-row[data-environment-id]"))
        .filter(row => row.querySelector("[data-environment-body]")?.hidden)
        .map(row => row.dataset.environmentId),
      collapsedUpbringingIds: Array.from(el.querySelectorAll(".sta2e-cc-upbringing-row[data-upbringing-id]"))
        .filter(row => row.querySelector("[data-upbringing-body]")?.hidden)
        .map(row => row.dataset.upbringingId),
      collapsedCareerPathIds: Array.from(el.querySelectorAll(".sta2e-cc-career-row[data-career-path-id]"))
        .filter(row => row.querySelector("[data-career-body]")?.hidden)
        .map(row => row.dataset.careerPathId),
      collapsedCareerEventIds: Array.from(el.querySelectorAll(".sta2e-cc-career-event-row[data-career-event-id]"))
        .filter(row => row.querySelector("[data-career-event-body]")?.hidden)
        .map(row => row.dataset.careerEventId),
      collapsedConfigSections: Array.from(el.querySelectorAll("[data-config-section]"))
        .filter(block => block.querySelector("[data-config-block-body]")?.hidden)
        .map(block => block.dataset.configSection),
    });

    return {
      ...getCreatorData(),
      config,
      ui: uiState,
      talentPacks,
      species,
      environments,
      upbringings,
      careerPaths,
      experienceOptions: normalizeExperienceOptions(experienceOptions),
      careerEvents,
      finishing,
    };
  }

  static async _onSave() {
    const data = this._dataFromForm();
    if (!data) return;

    await game.settings.set(MODULE, "characterCreatorData", data);
    ui.notifications.info("STA2e Toolkit: Character Creator data saved.");
    this.render({ force: true });
  }

  static _onCancel() {
    this.close();
  }
}

export class CharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sta2e-character-creator",
    tag: "div",
    window: { title: "STA2E.CharacterCreator.Title", resizable: true },
    position: { width: 860, height: 720 },
    actions: {
      openConfig: CharacterCreator._onOpenConfig,
      selectCharacterType: CharacterCreator._onSelectCharacterType,
      nextStep: CharacterCreator._onNextStep,
      previousStep: CharacterCreator._onPreviousStep,
      randomEnvironmentValue: CharacterCreator._onRandomEnvironmentValue,
      randomEnvironmentAttributeSpecies: CharacterCreator._onRandomEnvironmentAttributeSpecies,
      randomJemHadarHatcheryValue: CharacterCreator._onRandomJemHadarHatcheryValue,
      randomJemHadarHatcheryFocus: CharacterCreator._onRandomJemHadarHatcheryFocus,
      randomVortaCloningValue: CharacterCreator._onRandomVortaCloningValue,
      randomVortaCloningFocus: CharacterCreator._onRandomVortaCloningFocus,
      randomUpbringing: CharacterCreator._onRandomUpbringing,
      randomUpbringingFocus: CharacterCreator._onRandomUpbringingFocus,
      randomSpeciesFocus: CharacterCreator._onRandomSpeciesFocus,
      randomNpcTrait: CharacterCreator._onRandomNpcTrait,
      randomNpcValue: CharacterCreator._onRandomNpcValue,
      randomNpcFocus: CharacterCreator._onRandomNpcFocus,
      randomNpcTalent: CharacterCreator._onRandomNpcTalent,
      addNpcValue: CharacterCreator._onAddNpcValue,
      addNpcFocus: CharacterCreator._onAddNpcFocus,
      addNpcTalent: CharacterCreator._onAddNpcTalent,
      removeNpcValue: CharacterCreator._onRemoveNpcValue,
      removeNpcFocus: CharacterCreator._onRemoveNpcFocus,
      removeNpcTalent: CharacterCreator._onRemoveNpcTalent,
      editNpcValue: CharacterCreator._onEditNpcValue,
      editNpcFocus: CharacterCreator._onEditNpcFocus,
      editNpcTalent: CharacterCreator._onEditNpcTalent,
      cancelEditNpcValue: CharacterCreator._onCancelEditNpcValue,
      cancelEditNpcFocus: CharacterCreator._onCancelEditNpcFocus,
      cancelEditNpcTalent: CharacterCreator._onCancelEditNpcTalent,
      randomCareerPath: CharacterCreator._onRandomCareerPath,
      randomCareerValue: CharacterCreator._onRandomCareerValue,
      randomCareerFocus: CharacterCreator._onRandomCareerFocus,
      randomExperienceValue: CharacterCreator._onRandomExperienceValue,
      randomCareerEvent: CharacterCreator._onRandomCareerEvent,
      randomCareerEventFocus: CharacterCreator._onRandomCareerEventFocus,
      randomFinalValue: CharacterCreator._onRandomFinalValue,
      randomSupportingFocus: CharacterCreator._onRandomSupportingFocus,
      randomSupportingValue: CharacterCreator._onRandomSupportingValue,
      randomCharacterName: CharacterCreator._onRandomCharacterName,
      randomizeNpc: CharacterCreator._onRandomizeNpc,
      finalizeCharacter: CharacterCreator._onFinalizeCharacter,
    },
  };

  static PARTS = {
    creator: { template: "modules/sta2e-toolkit/templates/character-creator.hbs" },
  };

  constructor(options = {}) {
    const { folderId = "", ...appOptions } = options;
    super(appOptions);
    const targetFolder = typeof folderId === "string" ? game.folders.get(folderId) : null;
    this._targetFolderId = targetFolder?.type === "Actor" ? targetFolder.id : "";
    this._creatorState = {
      characterType: "",
      step: 1,
      characterName: "",
      randomNameGender: "any",
      speciesSearch: "",
      primarySpeciesId: "",
      mixedSpecies: false,
      secondarySpeciesId: "",
      selectedFreeAttributes: [],
      selectedSpeciesAttributeChoice: "",
      selectedSpeciesEsotericTalentUuid: "",
      selectedSpeciesEsotericTalentUuids: [],
      selectedBorgImplantUuids: [],
      selectedHumanAugmentTalentUuids: [],
      humanAugmentFlawTraitUuid: "",
      humanAugmentCustomFlawTraitName: "",
      humanAugmentCustomFlawTraitDescription: "",
      speciesFocusUuids: ["", "", "", "", "", ""],
      speciesCustomFocusNames: ["", "", "", "", "", ""],
      environmentId: "",
      environmentValueUuid: "",
      environmentCustomValueName: "",
      environmentCustomValueDescription: "",
      environmentAttribute: "",
      environmentAttributeSpeciesId: "",
      environmentDepartment: "",
      jemHadarHatcheryKey: "gamma",
      jemHadarHatcheryValueUuid: "",
      jemHadarHatcheryCustomValueName: "",
      jemHadarHatcheryCustomValueDescription: "",
      jemHadarHatcheryAttribute: "",
      jemHadarHatcheryDepartment: "",
      jemHadarHatcheryFocusUuid: "",
      jemHadarHatcheryCustomFocusName: "",
      jemHadarHatcheryCustomFocusDescription: "",
      jemHadarHatcheryTalentUuid: "",
      vortaCloningValueUuid: "",
      vortaCloningCustomValueName: "",
      vortaCloningCustomValueDescription: "",
      vortaCloningAttributes: [],
      vortaCloningAttributeChoice: "",
      vortaCloningPrimaryDepartment: "",
      vortaCloningSecondaryDepartment: "",
      vortaCloningFocusUuid: "",
      vortaCloningCustomFocusName: "",
      vortaCloningCustomFocusDescription: "",
      upbringingId: "",
      upbringingPath: "accepted",
      upbringingDepartment: "",
      upbringingFocusUuid: "",
      upbringingCustomFocusName: "",
      upbringingCustomFocusDescription: "",
      upbringingTalentUuid: "",
      gmAllowEsotericTalents: false,
      careerPathId: "",
      careerTraitUuid: "",
      careerCustomTraitName: "",
      careerCustomTraitDescription: "",
      careerValueUuid: "",
      careerCustomValueName: "",
      careerCustomValueDescription: "",
      careerAttributeSpends: {},
      careerDepartmentPlusTwo: "",
      careerDepartmentPlusOne: [],
      careerDepartmentReallocationFrom: "",
      careerDepartmentReallocationTo: "",
      careerFocusUuids: ["", "", ""],
      careerCustomFocusNames: ["", "", ""],
      careerTalentUuid: "",
      experienceKey: "novice",
      experienceValueUuid: "",
      experienceCustomValueName: "",
      experienceCustomValueDescription: "",
      experienceTalentUuid: "",
      careerEventIds: ["", ""],
      careerEventAttributeKeys: ["", ""],
      careerEventDepartmentKeys: ["", ""],
      careerEventFocusUuids: ["", ""],
      careerEventCustomFocusNames: ["", ""],
      careerEventTraitUuids: ["", ""],
      careerEventCustomTraitNames: ["", ""],
      careerEventCustomTraitDescriptions: ["", ""],
      expandedProgrammingFocusUuids: ["", ""],
      expandedProgrammingCustomFocusNames: ["", ""],
      finalValueUuid: "",
      finalCustomValueName: "",
      finalCustomValueDescription: "",
      finalAttributeRedistribution: {},
      finalAttributeBoosts: {},
      finalDepartmentRedistribution: {},
      finalDepartmentBoosts: {},
      finalTalentUuid: "",
      roleUuid: "",
      pastime: "",
      rankId: "",
      rank: "",
      assignment: "",
      pronouns: "",
      supportingDepartment: "",
      supportingAttributeAssignments: {},
      supportingDepartmentAssignments: {},
      supportingTraitUuid: "",
      supportingCustomTraitName: "",
      supportingCustomTraitDescription: "",
      supportingFocusUuids: ["", "", "", ""],
      supportingCustomFocusNames: ["", "", "", ""],
      supportingValueUuid: "",
      supportingCustomValueName: "",
      supportingCustomValueDescription: "",
      npcAttributeAssignments: {},
      npcDepartmentAssignments: {},
      npcRoleTraitUuid: "",
      npcCustomRoleTraitName: "",
      npcCustomRoleTraitDescription: "",
      npcExtraTraitUuid: "",
      npcCustomExtraTraitName: "",
      npcCustomExtraTraitDescription: "",
      npcValueUuids: ["", "", "", ""],
      npcCustomValueNames: ["", "", "", ""],
      npcCustomValueDescriptions: ["", "", "", ""],
      npcValueEditFlags: [false, false, false, false],
      npcVisibleValueSlots: 0,
      npcFocusUuids: ["", "", "", "", "", ""],
      npcCustomFocusNames: ["", "", "", "", "", ""],
      npcCustomFocusDescriptions: ["", "", "", "", "", ""],
      npcFocusEditFlags: [false, false, false, false, false, false],
      npcVisibleFocusSlots: 0,
      npcTalentUuids: ["", "", "", ""],
      npcCustomTalentNames: ["", "", "", ""],
      npcCustomTalentDescriptions: ["", "", "", ""],
      npcTalentEditFlags: [false, false, false, false],
      npcVisibleTalentSlots: 0,
      npcEquipmentUuids: [],
      npcNotes: "",
    };
    this._scrollState = null;
    this._activeCreatorTabs = { careerEvents: "event0", finishing: "checks" };
    this._openingLoader = null;
    this._initialRenderComplete = false;
  }

  render(options = {}) {
    this._captureScrollState();
    startOpeningLoader(this, "Opening Character Creator", "Reading creator data");
    const result = super.render(options);
    Promise.resolve(result).catch(() => finishOpeningLoader(this));
    return result;
  }

  _captureScrollState() {
    const main = this.element?.querySelector(".sta2e-cc-main");
    const steps = this.element?.querySelector(".sta2e-cc-steps");
    this._scrollState = {
      mainTop: main?.scrollTop ?? 0,
      stepsLeft: steps?.scrollLeft ?? 0,
    };
  }

  _restoreScrollState() {
    const state = this._scrollState;
    if (!state) return;

    requestAnimationFrame(() => {
      const main = this.element?.querySelector(".sta2e-cc-main");
      const steps = this.element?.querySelector(".sta2e-cc-steps");
      if (main) main.scrollTop = state.mainTop ?? 0;
      if (steps) steps.scrollLeft = state.stepsLeft ?? 0;
    });
  }

  async _prepareContext(_options) {
    updateOpeningLoader(this, 16, "Preparing character choices");
    const data = getCreatorData();
    const currentStep = Number(this._creatorState.step ?? 1);
    const characterType = Object.prototype.hasOwnProperty.call(CHARACTER_TYPE_DEFINITIONS, this._creatorState.characterType)
      ? this._creatorState.characterType
      : "";
    const characterTypeDefinition = CHARACTER_TYPE_DEFINITIONS[characterType] ?? null;
    const typeChoiceActive = !characterType;
    const isPlayerCharacter = characterType === "player";
    const isSupportingCharacter = SUPPORTING_CHARACTER_TYPES.includes(characterType);
    const isNpcCharacter = NPC_CHARACTER_TYPES.includes(characterType);
    const visibleCharacterTypeOptions = Object.values(CHARACTER_TYPE_DEFINITIONS)
      .filter(definition => !NPC_CHARACTER_TYPES.includes(definition.key) || game.user.isGM);
    if (isNpcCharacter && !game.user.isGM) {
      this._creatorState.characterType = "";
      this._creatorState.step = 1;
      ui.notifications.warn("STA2e Toolkit: Only GMs can create NPCs.");
      return this._prepareContext(_options);
    }
    if (typeChoiceActive) {
      updateOpeningLoader(this, 92, "Building character creator window");
      return {
        step: currentStep,
        typeChoiceActive,
        characterType,
        characterTypeDefinition,
        characterTypeOptions: visibleCharacterTypeOptions.map(definition => ({
          ...definition,
          selected: false,
        })),
        isPlayerCharacter: false,
        isSupportingCharacter: false,
        isNpcCharacter: false,
        isSupervisoryCharacter: false,
        supportingStepLabels: SUPPORTING_STEP_LABELS.map(row => ({ ...row, active: false })),
        npcStepLabels: NPC_STEP_LABELS.map(row => ({ ...row, active: false })),
        stepOneActive: false,
        stepTwoActive: false,
        stepThreeActive: false,
        stepFourActive: false,
        stepFiveActive: false,
        stepSixActive: false,
        stepSevenActive: false,
        reviewActive: false,
      };
    }
    const shouldApplyEnvironment = currentStep >= 2;
    const shouldApplyUpbringing = currentStep >= 3;
    const shouldApplyCareer = currentStep >= 4;
    const species = data.species.map(normalizeSpecies).filter(s => s.name);
    if (!this._creatorState.primarySpeciesId && species.length) this._creatorState.primarySpeciesId = species[0].id;
    const environments = data.environments.map(normalizeEnvironment).filter(e => e.name);
    if (!this._creatorState.environmentId && environments.length) this._creatorState.environmentId = environments[0].id;
    const upbringings = data.upbringings.map(normalizeUpbringing).filter(u => u.name);
    if (!this._creatorState.upbringingId && upbringings.length) this._creatorState.upbringingId = upbringings[0].id;
    const careerPaths = data.careerPaths.map(normalizeCareerPath).filter(c => c.name);
    if (!this._creatorState.careerPathId && careerPaths.length) this._creatorState.careerPathId = careerPaths[0].id;
    let experienceOptions = normalizeExperienceOptions(data.experienceOptions);
    let experience = experienceOptions.find(option => option.key === this._creatorState.experienceKey) ?? experienceOptions[0] ?? null;
    if (experience && this._creatorState.experienceKey !== experience.key) this._creatorState.experienceKey = experience.key;
    const careerEvents = data.careerEvents.map(normalizeCareerEvent).filter(event => event.name);
    updateOpeningLoader(this, 38, "Resolving species and lifepath data");

    const primary = species.find(s => s.id === this._creatorState.primarySpeciesId) ?? species[0] ?? null;
    const mixedSpeciesForced = isLiberatedBorgSpecies(primary);
    const requiresHumanAugmentTalents = isHumanAugmentSpecies(primary);
    if (mixedSpeciesForced) this._creatorState.mixedSpecies = true;
    if (this._creatorState.secondarySpeciesId === primary?.id) this._creatorState.secondarySpeciesId = "";
    const secondary = this._creatorState.mixedSpecies
      ? species.find(s => s.id === this._creatorState.secondarySpeciesId && s.id !== primary?.id) ?? null
      : null;
    const environment = environments.find(e => e.id === this._creatorState.environmentId) ?? environments[0] ?? null;
    const upbringing = upbringings.find(u => u.id === this._creatorState.upbringingId) ?? upbringings[0] ?? null;
    let careerPath = careerPaths.find(c => c.id === this._creatorState.careerPathId) ?? careerPaths[0] ?? null;

    const selectedFreeAttributes = ATTRIBUTE_KEYS
      .filter(key => this._creatorState.selectedFreeAttributes.includes(key))
      .slice(0, 3);
    const speciesAttributeChoiceKeys = primary?.freeAttributeSelection
      ? []
      : ATTRIBUTE_KEYS.filter(key => Array.isArray(primary?.attributeChoiceBoosts) && primary.attributeChoiceBoosts.includes(key));
    const selectedSpeciesAttributeChoice = speciesAttributeChoiceKeys.includes(this._creatorState.selectedSpeciesAttributeChoice)
      ? this._creatorState.selectedSpeciesAttributeChoice
      : "";
    if (this._creatorState.selectedSpeciesAttributeChoice && !selectedSpeciesAttributeChoice) {
      this._creatorState.selectedSpeciesAttributeChoice = "";
    }
    let effectivePrimary = primary;
    if (primary?.freeAttributeSelection) {
      effectivePrimary = { ...primary, attributeBoosts: selectedFreeAttributes };
    } else if (speciesAttributeChoiceKeys.length) {
      effectivePrimary = { ...primary, attributeBoosts: uniqueUuidList([...(primary?.attributeBoosts ?? []), selectedSpeciesAttributeChoice]) };
    }

    const preview = buildStepOnePreview(effectivePrimary, secondary);
    const [primaryCtx, secondaryCtx] = await Promise.all([
      primary ? prepareSpeciesForContext(primary, data) : null,
      secondary ? prepareSpeciesForContext(secondary, data) : null,
    ]);
    updateOpeningLoader(this, 58, "Preparing talent and focus choices");
    const speciesEsotericOptions = primaryCtx?.esotericTalents ?? [];
    const speciesEsotericTalentCount = normalizeSpeciesEsotericTalentCount(primaryCtx?.speciesEsotericTalentCount, primaryCtx?.speciesEsotericTalentUuids);
    let selectedSpeciesEsotericTalentUuids = uniqueUuidList([
      ...normalizeUuidList(this._creatorState.selectedSpeciesEsotericTalentUuids),
      this._creatorState.selectedSpeciesEsotericTalentUuid,
    ])
      .filter(uuid => speciesEsotericOptions.some(talent => talent.uuid === uuid))
      .slice(0, speciesEsotericTalentCount);
    if (speciesEsotericTalentCount > 0 && speciesEsotericOptions.length <= speciesEsotericTalentCount) {
      selectedSpeciesEsotericTalentUuids = speciesEsotericOptions.map(talent => talent.uuid);
    }
    this._creatorState.selectedSpeciesEsotericTalentUuids = selectedSpeciesEsotericTalentUuids;
    this._creatorState.selectedSpeciesEsotericTalentUuid = selectedSpeciesEsotericTalentUuids[0] ?? "";
    const selectedSpeciesEsotericTalents = selectedSpeciesEsotericTalentUuids
      .map(uuid => speciesEsotericOptions.find(talent => talent.uuid === uuid))
      .filter(Boolean);
    const selectedSpeciesEsotericTalent = selectedSpeciesEsotericTalents[0] ?? null;
    const speciesEsotericSelections = Array.from({ length: speciesEsotericTalentCount }, (_slot, index) => {
      const selectedUuid = selectedSpeciesEsotericTalentUuids[index] ?? "";
      return {
        index,
        number: index + 1,
        selected: speciesEsotericOptions.find(talent => talent.uuid === selectedUuid) ?? null,
        options: speciesEsotericOptions.map(talent => ({
          ...talent,
          selected: talent.uuid === selectedUuid,
          disabled: selectedSpeciesEsotericTalentUuids.includes(talent.uuid) && talent.uuid !== selectedUuid,
        })),
      };
    });
    if (this._creatorState.selectedSpeciesEsotericTalentUuid && !selectedSpeciesEsotericTalent) {
      this._creatorState.selectedSpeciesEsotericTalentUuid = "";
    }
    this._creatorState.speciesFocusUuids = Array.isArray(this._creatorState.speciesFocusUuids)
      ? this._creatorState.speciesFocusUuids
      : ["", "", "", "", "", ""];
    this._creatorState.speciesCustomFocusNames = Array.isArray(this._creatorState.speciesCustomFocusNames)
      ? this._creatorState.speciesCustomFocusNames
      : ["", "", "", "", "", ""];
    const speciesExtraFocusCount = normalizeExtraFocusCount(effectivePrimary?.extraFocusCount ?? 0);
    const speciesFocusOptions = await prepareUuidListForContext(configuredFocusUuids(data.config));
    const speciesFocusSelections = Array.from({ length: speciesExtraFocusCount }, (_slot, index) => {
      const customName = String(this._creatorState.speciesCustomFocusNames?.[index] ?? "").trim();
      const configured = customName
        ? null
        : speciesFocusOptions.find(focus => focus.uuid === this._creatorState.speciesFocusUuids?.[index]) ?? null;
      return {
        index,
        number: index + 1,
        customName,
        selected: customName ? { name: customName, custom: true } : configured,
        options: speciesFocusOptions.map(focus => ({
          ...focus,
          selected: focus.uuid === configured?.uuid,
        })),
      };
    });
    const traitList = [primaryCtx, secondaryCtx]
      .flatMap(ctx => {
        if (!ctx) return [];
        const traits = Array.isArray(ctx.traits) && ctx.traits.length
          ? ctx.traits
          : ctx.traitName
            ? [{
              name: ctx.traitName,
              description: ctx.traitDescription,
              uuid: ctx.traitUuid,
            }]
            : [];
        return traits.map(trait => ({
          name: trait.name,
          description: trait.description,
          sourceName: ctx.name,
          uuid: trait.uuid,
        }));
      });
    const speciesNames = new Set([
      primary?.name,
      secondary?.name,
      ...traitList.map(trait => trait.name),
    ].filter(Boolean).map(normalizeAccessName));
    const isJemHadarLifepath = isPlayerCharacter && hasTraitAccessName(speciesNames, "jem'hadar");
    const isVortaLifepath = isPlayerCharacter && hasTraitAccessName(speciesNames, "vorta");
    const forcedJemHadarCareerPath = isJemHadarLifepath ? findStarfleetEnlistedCareerPath(careerPaths) : null;
    const vortaCareerPaths = isVortaLifepath ? vortaCareerPathOptions(careerPaths) : [];
    if (forcedJemHadarCareerPath && careerPath?.id !== forcedJemHadarCareerPath.id) {
      careerPath = forcedJemHadarCareerPath;
      this._creatorState.careerPathId = forcedJemHadarCareerPath.id;
      this._creatorState.careerTraitUuid = "";
      this._creatorState.careerCustomTraitName = "";
      this._creatorState.careerCustomTraitDescription = "";
      this._creatorState.careerValueUuid = "";
      this._creatorState.careerCustomValueName = "";
      this._creatorState.careerCustomValueDescription = "";
      this._creatorState.careerAttributeSpends = {};
      this._creatorState.careerDepartmentPlusTwo = "";
      this._creatorState.careerDepartmentPlusOne = [];
      this._creatorState.careerDepartmentReallocationFrom = "";
      this._creatorState.careerDepartmentReallocationTo = "";
      this._creatorState.careerFocusUuids = ["", "", ""];
      this._creatorState.careerCustomFocusNames = ["", "", ""];
      this._creatorState.careerTalentUuid = "";
    }
    if (isVortaLifepath && vortaCareerPaths.length && !vortaCareerPaths.some(path => path.id === careerPath?.id)) {
      careerPath = vortaCareerPaths[0];
      this._creatorState.careerPathId = careerPath.id;
      this._creatorState.careerTraitUuid = "";
      this._creatorState.careerCustomTraitName = "";
      this._creatorState.careerCustomTraitDescription = "";
      this._creatorState.careerValueUuid = "";
      this._creatorState.careerCustomValueName = "";
      this._creatorState.careerCustomValueDescription = "";
      this._creatorState.careerAttributeSpends = {};
      this._creatorState.careerDepartmentPlusTwo = "";
      this._creatorState.careerDepartmentPlusOne = [];
      this._creatorState.careerDepartmentReallocationFrom = "";
      this._creatorState.careerDepartmentReallocationTo = "";
      this._creatorState.careerFocusUuids = ["", "", ""];
      this._creatorState.careerCustomFocusNames = ["", "", ""];
      this._creatorState.careerTalentUuid = "";
    }

    const environmentAttributeSource = environment?.attributeMode === "species"
      ? species.find(s => s.id === this._creatorState.environmentAttributeSpeciesId && s.id !== primary?.id)
        ?? species.find(s => s.id !== primary?.id)
        ?? null
      : null;
    if (environmentAttributeSource && this._creatorState.environmentAttributeSpeciesId !== environmentAttributeSource.id) {
      this._creatorState.environmentAttributeSpeciesId = environmentAttributeSource.id;
    }

    const environmentAttributeKeys = environment?.attributeMode === "any"
      ? ATTRIBUTE_KEYS
      : environment?.attributeMode === "characterSpecies"
        ? effectivePrimary?.attributeBoosts ?? []
        : environment?.attributeMode === "species"
          ? environmentAttributeSource?.freeAttributeSelection
            ? ATTRIBUTE_KEYS
            : uniqueUuidList([
              ...(environmentAttributeSource?.attributeBoosts ?? []),
              ...(environmentAttributeSource?.attributeChoiceBoosts ?? []),
            ])
        : environment?.attributeChoices ?? [];
    const selectedEnvironmentAttribute = environmentAttributeKeys.includes(this._creatorState.environmentAttribute)
      ? this._creatorState.environmentAttribute
      : "";
    if (this._creatorState.environmentAttribute && !selectedEnvironmentAttribute) {
      this._creatorState.environmentAttribute = "";
    }

    const environmentDepartmentKeys = environment?.departmentMode === "any"
      ? DISCIPLINE_KEYS
      : environment?.departmentChoices ?? [];
    const selectedEnvironmentDepartment = environmentDepartmentKeys.includes(this._creatorState.environmentDepartment)
      ? this._creatorState.environmentDepartment
      : "";
    if (this._creatorState.environmentDepartment && !selectedEnvironmentDepartment) {
      this._creatorState.environmentDepartment = "";
    }

    const selectedJemHadarHatchery = jemHadarHatcheryByKey(this._creatorState.jemHadarHatcheryKey);
    if (this._creatorState.jemHadarHatcheryKey !== selectedJemHadarHatchery.key) {
      this._creatorState.jemHadarHatcheryKey = selectedJemHadarHatchery.key;
    }
    const selectedJemHadarHatcheryAttribute = selectedJemHadarHatchery.attributes.includes(this._creatorState.jemHadarHatcheryAttribute)
      ? this._creatorState.jemHadarHatcheryAttribute
      : "";
    if (this._creatorState.jemHadarHatcheryAttribute && !selectedJemHadarHatcheryAttribute) this._creatorState.jemHadarHatcheryAttribute = "";
    const selectedJemHadarHatcheryDepartment = DISCIPLINE_KEYS
      .filter(key => key !== selectedJemHadarHatchery.department)
      .includes(this._creatorState.jemHadarHatcheryDepartment)
      ? this._creatorState.jemHadarHatcheryDepartment
      : "";
    if (this._creatorState.jemHadarHatcheryDepartment && !selectedJemHadarHatcheryDepartment) this._creatorState.jemHadarHatcheryDepartment = "";
    const selectedVortaCloningAttributes = ATTRIBUTE_KEYS
      .filter(key => Array.isArray(this._creatorState.vortaCloningAttributes) && this._creatorState.vortaCloningAttributes.includes(key))
      .slice(0, 3);
    if (JSON.stringify(this._creatorState.vortaCloningAttributes ?? []) !== JSON.stringify(selectedVortaCloningAttributes)) {
      this._creatorState.vortaCloningAttributes = selectedVortaCloningAttributes;
    }
    const selectedVortaCloningAttributeChoice = selectedVortaCloningAttributes.includes(this._creatorState.vortaCloningAttributeChoice)
      ? this._creatorState.vortaCloningAttributeChoice
      : "";
    if (this._creatorState.vortaCloningAttributeChoice && !selectedVortaCloningAttributeChoice) this._creatorState.vortaCloningAttributeChoice = "";
    const selectedVortaCloningPrimaryDepartment = VORTA_PRIMARY_DEPARTMENTS.includes(this._creatorState.vortaCloningPrimaryDepartment)
      ? this._creatorState.vortaCloningPrimaryDepartment
      : "";
    if (this._creatorState.vortaCloningPrimaryDepartment && !selectedVortaCloningPrimaryDepartment) this._creatorState.vortaCloningPrimaryDepartment = "";
    const selectedVortaCloningSecondaryDepartment = DISCIPLINE_KEYS
      .filter(key => key !== selectedVortaCloningPrimaryDepartment)
      .includes(this._creatorState.vortaCloningSecondaryDepartment)
      ? this._creatorState.vortaCloningSecondaryDepartment
      : "";
    if (this._creatorState.vortaCloningSecondaryDepartment && !selectedVortaCloningSecondaryDepartment) this._creatorState.vortaCloningSecondaryDepartment = "";
    const selectedVortaCloningDepartments = [selectedVortaCloningPrimaryDepartment, selectedVortaCloningSecondaryDepartment].filter(Boolean);

    if (shouldApplyEnvironment && isJemHadarLifepath) {
      applyJemHadarHatcheryPreview(preview, selectedJemHadarHatchery, selectedJemHadarHatcheryAttribute, selectedJemHadarHatcheryDepartment);
    } else if (shouldApplyEnvironment && isVortaLifepath) {
      applyVortaCloningPreview(preview, selectedVortaCloningAttributes, selectedVortaCloningAttributeChoice, selectedVortaCloningDepartments);
    } else if (shouldApplyEnvironment) {
      applyEnvironmentPreview(preview, {
        attribute: selectedEnvironmentAttribute,
        department: selectedEnvironmentDepartment,
      });
    }

    const isLanthaniteCharacter = hasTraitAccessName(speciesNames, "lanthanite");
    if (isLanthaniteCharacter) {
      const veteranExperience = experienceOptions.find(option => option.key === "veteran")
        ?? experienceOptions.find(option => String(option.name ?? "").trim().toLocaleLowerCase(game.i18n.lang) === "veteran")
        ?? null;
      if (veteranExperience) {
        experienceOptions = [veteranExperience];
        if (experience?.key !== veteranExperience.key) {
          this._creatorState.experienceKey = veteranExperience.key;
          this._creatorState.experienceValueUuid = "";
          this._creatorState.experienceCustomValueName = "";
          this._creatorState.experienceCustomValueDescription = "";
          this._creatorState.experienceTalentUuid = "";
        }
        experience = veteranExperience;
      }
    }
    const isHologramCharacter = hasTraitAccessName(speciesNames, "hologram");
    const speciesTalentAccess = specialTalentAccessOptions(speciesNames);
    const borgImplantOptions = mixedSpeciesForced
      ? await Promise.all(normalizeUuidList(data.config?.talents?.borgImplant).map(async uuid => {
        const doc = await resolveUuidDoc(uuid);
        const requirements = readTalentRequirements(doc, data);
        const unmet = requirements.filter(req => !isRequirementMet(req, preview, speciesNames));
        return {
          uuid,
          name: doc?.name ?? uuid,
          description: descriptionForDoc(doc),
          typeLabel: talentTypeLabel(doc),
          requirementLabel: requirements.map(formatRequirement).filter(Boolean).join(", "),
          available: unmet.length === 0,
          unavailableReason: unmet.map(formatRequirement).filter(Boolean).join(", "),
        };
      }))
      : [];
    borgImplantOptions.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang, { sensitivity: "base" }));
    const availableBorgImplantUuids = new Set(borgImplantOptions.filter(talent => talent.available).map(talent => talent.uuid));
    this._creatorState.selectedBorgImplantUuids = mixedSpeciesForced
      ? uniqueUuidList(this._creatorState.selectedBorgImplantUuids).filter(uuid => availableBorgImplantUuids.has(uuid)).slice(0, 3)
      : [];
    const selectedBorgImplants = borgImplantOptions.filter(talent => this._creatorState.selectedBorgImplantUuids.includes(talent.uuid));
    const humanAugmentCandidateUuids = uniqueUuidList([
      ...normalizeUuidList(data.config?.talents?.augment),
      ...(primary?.speciesTalentUuids ?? []),
      ...(secondary?.speciesTalentUuids ?? []),
    ]);
    const humanAugmentTalentOptions = requiresHumanAugmentTalents
      ? (await Promise.all(humanAugmentCandidateUuids.map(async uuid => {
        const doc = await resolveUuidDoc(uuid);
        if (!talentSpecialAccess(doc, data, uuid).augment) return null;
        const requirements = readTalentRequirements(doc, data);
        const unmet = requirements.filter(req => !isRequirementMet(req, preview, speciesNames));
        return {
          uuid,
          name: doc?.name ?? uuid,
          description: descriptionForDoc(doc),
          typeLabel: talentTypeLabel(doc),
          requirementLabel: requirements.map(formatRequirement).filter(Boolean).join(", "),
          available: unmet.length === 0,
          unavailableReason: unmet.map(formatRequirement).filter(Boolean).join(", "),
        };
      }))).filter(Boolean)
      : [];
    humanAugmentTalentOptions.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang, { sensitivity: "base" }));
    const availableHumanAugmentTalentUuids = new Set(humanAugmentTalentOptions.filter(talent => talent.available).map(talent => talent.uuid));
    this._creatorState.selectedHumanAugmentTalentUuids = requiresHumanAugmentTalents
      ? uniqueUuidList(this._creatorState.selectedHumanAugmentTalentUuids).filter(uuid => availableHumanAugmentTalentUuids.has(uuid)).slice(0, 2)
      : [];
    const selectedHumanAugmentTalents = humanAugmentTalentOptions.filter(talent => this._creatorState.selectedHumanAugmentTalentUuids.includes(talent.uuid));
    const humanAugmentRequiresFlawTrait = selectedHumanAugmentTalents.length >= 2;
    const humanAugmentFlawTraitOptions = requiresHumanAugmentTalents ? await prepareUuidListForContext(data.config.traits) : [];
    const humanAugmentCustomFlawTrait = humanAugmentRequiresFlawTrait && this._creatorState.humanAugmentCustomFlawTraitName.trim()
      ? {
        name: this._creatorState.humanAugmentCustomFlawTraitName.trim(),
        description: this._creatorState.humanAugmentCustomFlawTraitDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredHumanAugmentFlawTrait = humanAugmentCustomFlawTrait
      ? null
      : humanAugmentFlawTraitOptions.find(trait => trait.uuid === this._creatorState.humanAugmentFlawTraitUuid) ?? null;
    let selectedHumanAugmentFlawTrait = humanAugmentRequiresFlawTrait
      ? humanAugmentCustomFlawTrait ?? selectedConfiguredHumanAugmentFlawTrait
      : null;
    if (humanAugmentRequiresFlawTrait && selectedHumanAugmentFlawTrait && isDuplicateTrait(selectedHumanAugmentFlawTrait, traitList)) {
      if (selectedHumanAugmentFlawTrait.uuid) this._creatorState.humanAugmentFlawTraitUuid = "";
      selectedHumanAugmentFlawTrait = null;
    }
    if (!requiresHumanAugmentTalents) {
      this._creatorState.humanAugmentFlawTraitUuid = "";
      this._creatorState.humanAugmentCustomFlawTraitName = "";
      this._creatorState.humanAugmentCustomFlawTraitDescription = "";
    }
    const upbringingPathKey = this._creatorState.upbringingPath === "rebelled" ? "rebelled" : "accepted";
    const upbringingDepartmentKeys = upbringing ? effectiveUpbringingDepartmentChoices(upbringing) : [];
    const selectedUpbringingDepartment = upbringingDepartmentKeys.includes(this._creatorState.upbringingDepartment)
      ? this._creatorState.upbringingDepartment
      : "";
    if (this._creatorState.upbringingDepartment && !selectedUpbringingDepartment) {
      this._creatorState.upbringingDepartment = "";
    }
    if (shouldApplyUpbringing && !isJemHadarLifepath && !isVortaLifepath) {
      applyUpbringingPreview(preview, upbringing, upbringingPathKey, selectedUpbringingDepartment);
    }
    const selectedCareerAttributeSpends = normalizeCareerAttributeSpends(this._creatorState.careerAttributeSpends);
    this._creatorState.careerAttributeSpends = selectedCareerAttributeSpends;
    const careerDisciplineBase = { ...preview.disciplines };
    const careerPlusTwoOptions = careerPath?.departments?.plusTwo ?? [];
    const careerPlusOneOptions = careerPath?.departments?.plusOne ?? [];
    const selectedCareerDepartmentPlusTwo = careerPlusTwoOptions.includes(this._creatorState.careerDepartmentPlusTwo)
      && (careerDisciplineBase[this._creatorState.careerDepartmentPlusTwo] ?? 0) + 2 <= 4
      ? this._creatorState.careerDepartmentPlusTwo
      : "";
    if (this._creatorState.careerDepartmentPlusTwo && !selectedCareerDepartmentPlusTwo) {
      this._creatorState.careerDepartmentPlusTwo = "";
    }
    const selectedCareerDepartmentPlusOne = DISCIPLINE_KEYS
      .filter(key => Array.isArray(this._creatorState.careerDepartmentPlusOne) && this._creatorState.careerDepartmentPlusOne.includes(key))
      .filter(key => careerPlusOneOptions.includes(key))
      .filter(key => key !== selectedCareerDepartmentPlusTwo)
      .filter(key => (careerDisciplineBase[key] ?? 0) + 1 <= 4)
      .slice(0, 2);
    if (JSON.stringify(this._creatorState.careerDepartmentPlusOne ?? []) !== JSON.stringify(selectedCareerDepartmentPlusOne)) {
      this._creatorState.careerDepartmentPlusOne = selectedCareerDepartmentPlusOne;
    }
    const careerIncreasedDepartments = new Set([
      selectedCareerDepartmentPlusTwo,
      ...selectedCareerDepartmentPlusOne,
    ].filter(Boolean));
    const careerDepartmentReallocationAllowed = !!careerPath?.departmentReallocationAllowed;
    const careerDepartmentReallocationFromOptions = careerDepartmentReallocationAllowed
      ? DISCIPLINE_KEYS.filter(key => !careerIncreasedDepartments.has(key) && (careerDisciplineBase[key] ?? 0) > 1)
      : [];
    const selectedCareerDepartmentReallocationFrom = careerDepartmentReallocationFromOptions.includes(this._creatorState.careerDepartmentReallocationFrom)
      ? this._creatorState.careerDepartmentReallocationFrom
      : "";
    if (this._creatorState.careerDepartmentReallocationFrom && !selectedCareerDepartmentReallocationFrom) {
      this._creatorState.careerDepartmentReallocationFrom = "";
    }
    const careerDepartmentReallocationToOptions = careerDepartmentReallocationAllowed
      ? DISCIPLINE_KEYS.filter(key =>
        !careerIncreasedDepartments.has(key)
        && key !== selectedCareerDepartmentReallocationFrom
        && (careerDisciplineBase[key] ?? 0) + 1 <= 4)
      : [];
    const selectedCareerDepartmentReallocationTo = selectedCareerDepartmentReallocationFrom
      && careerDepartmentReallocationToOptions.includes(this._creatorState.careerDepartmentReallocationTo)
      ? this._creatorState.careerDepartmentReallocationTo
      : "";
    if (this._creatorState.careerDepartmentReallocationTo && !selectedCareerDepartmentReallocationTo) {
      this._creatorState.careerDepartmentReallocationTo = "";
    }
    const selectedCareerDepartments = {
      plusTwo: selectedCareerDepartmentPlusTwo,
      plusOne: selectedCareerDepartmentPlusOne,
      reallocationFrom: selectedCareerDepartmentReallocationFrom,
      reallocationTo: selectedCareerDepartmentReallocationTo,
    };
    const careerRequiredAttributes = careerPath?.requiredAttributes ?? [];
    const careerAttributeRequirementLabel = careerRequiredAttributes
      .map(key => ATTRIBUTE_LABELS[key])
      .filter(Boolean)
      .join(" or ");
    const careerAttributeRequirementSatisfied = careerAttributeRequirementMet(selectedCareerAttributeSpends, careerRequiredAttributes);
    if (shouldApplyCareer) applyCareerPreview(preview, selectedCareerAttributeSpends, selectedCareerDepartments);

    this._creatorState.careerEventAttributeKeys = Array.isArray(this._creatorState.careerEventAttributeKeys) ? this._creatorState.careerEventAttributeKeys : ["", ""];
    this._creatorState.careerEventDepartmentKeys = Array.isArray(this._creatorState.careerEventDepartmentKeys) ? this._creatorState.careerEventDepartmentKeys : ["", ""];
    this._creatorState.careerEventTraitUuids = Array.isArray(this._creatorState.careerEventTraitUuids) ? this._creatorState.careerEventTraitUuids : ["", ""];
    this._creatorState.careerEventCustomTraitNames = Array.isArray(this._creatorState.careerEventCustomTraitNames) ? this._creatorState.careerEventCustomTraitNames : ["", ""];
    this._creatorState.careerEventCustomTraitDescriptions = Array.isArray(this._creatorState.careerEventCustomTraitDescriptions) ? this._creatorState.careerEventCustomTraitDescriptions : ["", ""];
    const selectedCareerEventIds = [0, 1].map(index => {
      const id = this._creatorState.careerEventIds?.[index] ?? "";
      return careerEvents.some(event => event.id === id) ? id : "";
    });
    if (JSON.stringify(this._creatorState.careerEventIds ?? []) !== JSON.stringify(selectedCareerEventIds)) {
      this._creatorState.careerEventIds = selectedCareerEventIds;
    }
    const selectedCareerEvents = [0, 1].map(index => {
      const event = careerEvents.find(row => row.id === selectedCareerEventIds[index]) ?? null;
      const attributeChoices = careerEventAttributeChoices(event);
      let attributeKey = event ? this._creatorState.careerEventAttributeKeys?.[index] ?? "" : "";
      if (event && attributeChoices.length === 1) attributeKey = attributeChoices[0];
      else if (!attributeChoices.includes(attributeKey)) attributeKey = "";
      if ((this._creatorState.careerEventAttributeKeys?.[index] ?? "") !== attributeKey) this._creatorState.careerEventAttributeKeys[index] = attributeKey;

      const departmentChoices = careerEventDepartmentChoices(event);
      let departmentKey = event ? this._creatorState.careerEventDepartmentKeys?.[index] ?? "" : "";
      if (event && departmentChoices.length === 1) departmentKey = departmentChoices[0];
      else if (!departmentChoices.includes(departmentKey)) departmentKey = "";
      if ((this._creatorState.careerEventDepartmentKeys?.[index] ?? "") !== departmentKey) this._creatorState.careerEventDepartmentKeys[index] = departmentKey;

      return event ? { ...event, attributeKey, departmentKey } : null;
    });
    if (currentStep >= 6) applyCareerEventsPreview(preview, selectedCareerEvents.filter(Boolean));

    const talentUuids = [
      ...(primary?.speciesTalentUuids ?? []),
      ...(secondary?.speciesTalentUuids ?? []),
    ];
    const talentPool = await Promise.all(uniqueUuidList(talentUuids).map(async uuid => {
      const doc = await resolveUuidDoc(uuid);
      const requirements = readTalentRequirements(doc, data);
      const unmet = requirements.filter(req => !isRequirementMet(req, preview, speciesNames));
      return {
        uuid,
        name: doc?.name ?? uuid,
        description: descriptionForDoc(doc),
        typeLabel: talentTypeLabel(doc),
        requirementLabel: requirements.map(formatRequirement).filter(Boolean).join(", "),
        available: unmet.length === 0,
        unavailableReason: unmet.map(formatRequirement).filter(Boolean).join(", "),
      };
    }));
    talentPool.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang, { sensitivity: "base" }));
    const baseValues = await prepareUuidListForContext(data.config.values);
    const speciesValueEntries = [
      ...(primaryCtx?.values ?? []),
      ...(secondaryCtx?.values ?? []),
    ];
    const seenValueUuids = new Set();
    const values = [];
    for (const value of [...baseValues, ...speciesValueEntries]) {
      if (!value?.uuid || seenValueUuids.has(value.uuid)) continue;
      seenValueUuids.add(value.uuid);
      values.push(value);
    }
    const customEnvironmentValue = this._creatorState.environmentCustomValueName.trim()
      ? {
        name: this._creatorState.environmentCustomValueName.trim(),
        description: this._creatorState.environmentCustomValueDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredEnvironmentValue = customEnvironmentValue
      ? null
      : values.find(value => value.uuid === this._creatorState.environmentValueUuid) ?? null;
    const selectedEnvironmentValue = customEnvironmentValue ?? selectedConfiguredEnvironmentValue;
    const customJemHadarHatcheryValue = this._creatorState.jemHadarHatcheryCustomValueName.trim()
      ? {
        name: this._creatorState.jemHadarHatcheryCustomValueName.trim(),
        description: this._creatorState.jemHadarHatcheryCustomValueDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredJemHadarHatcheryValue = customJemHadarHatcheryValue
      ? null
      : values.find(value => value.uuid === this._creatorState.jemHadarHatcheryValueUuid) ?? null;
    const selectedJemHadarHatcheryValue = customJemHadarHatcheryValue ?? selectedConfiguredJemHadarHatcheryValue;
    const customVortaCloningValue = this._creatorState.vortaCloningCustomValueName.trim()
      ? {
        name: this._creatorState.vortaCloningCustomValueName.trim(),
        description: this._creatorState.vortaCloningCustomValueDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredVortaCloningValue = customVortaCloningValue
      ? null
      : values.find(value => value.uuid === this._creatorState.vortaCloningValueUuid) ?? null;
    const selectedVortaCloningValue = customVortaCloningValue ?? selectedConfiguredVortaCloningValue;
    const focusOptions = await prepareUuidListForContext(lifepathFocusUuids(
      upbringing?.recommendedFocusUuids ?? [],
      data.config,
      selectedUpbringingDepartment ? [selectedUpbringingDepartment] : [],
    ));
    const customUpbringingFocus = this._creatorState.upbringingCustomFocusName.trim()
      ? {
        name: this._creatorState.upbringingCustomFocusName.trim(),
        description: this._creatorState.upbringingCustomFocusDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredUpbringingFocus = customUpbringingFocus
      ? null
      : focusOptions.find(focus => focus.uuid === this._creatorState.upbringingFocusUuid) ?? null;
    const selectedUpbringingFocus = customUpbringingFocus ?? selectedConfiguredUpbringingFocus;
    const jemHadarHatcheryFocusOptions = await prepareUuidListForContext(lifepathFocusUuids(
      [],
      data.config,
      [selectedJemHadarHatchery.department, selectedJemHadarHatcheryDepartment].filter(Boolean),
    ));
    const customJemHadarHatcheryFocus = this._creatorState.jemHadarHatcheryCustomFocusName.trim()
      ? {
        name: this._creatorState.jemHadarHatcheryCustomFocusName.trim(),
        description: this._creatorState.jemHadarHatcheryCustomFocusDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredJemHadarHatcheryFocus = customJemHadarHatcheryFocus
      ? null
      : jemHadarHatcheryFocusOptions.find(focus => focus.uuid === this._creatorState.jemHadarHatcheryFocusUuid) ?? null;
    const selectedJemHadarHatcheryFocus = customJemHadarHatcheryFocus ?? selectedConfiguredJemHadarHatcheryFocus;
    const vortaCloningFocusOptions = await prepareUuidListForContext(lifepathFocusUuids(
      [],
      data.config,
      selectedVortaCloningDepartments,
    ));
    const customVortaCloningFocus = this._creatorState.vortaCloningCustomFocusName.trim()
      ? {
        name: this._creatorState.vortaCloningCustomFocusName.trim(),
        description: this._creatorState.vortaCloningCustomFocusDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredVortaCloningFocus = customVortaCloningFocus
      ? null
      : vortaCloningFocusOptions.find(focus => focus.uuid === this._creatorState.vortaCloningFocusUuid) ?? null;
    const selectedVortaCloningFocus = customVortaCloningFocus ?? selectedConfiguredVortaCloningFocus;

    const jemHadarHatcheryBlockedTalents = await buildTalentBlockList([
      ...selectedSpeciesEsotericTalents.map(talent => talent.uuid),
      ...selectedBorgImplants.map(talent => talent.uuid),
      ...selectedHumanAugmentTalents.map(talent => talent.uuid),
    ]);
    const jemHadarHatcheryTalentChoices = await prepareTalentChoicesForContext(
      allConfiguredTalentUuids(data.config, {
        includeEsoteric: this._creatorState.gmAllowEsotericTalents,
        ...speciesTalentAccess,
      }),
      data,
      preview,
      speciesNames,
      this._creatorState.jemHadarHatcheryTalentUuid,
      {
        hideUnavailableScoreRequirements: true,
        includeEsoteric: this._creatorState.gmAllowEsotericTalents,
        ...speciesTalentAccess,
        blockedTalents: jemHadarHatcheryBlockedTalents,
      },
    );
    const selectedJemHadarHatcheryTalent = jemHadarHatcheryTalentChoices.find(talent => talent.selected && talent.available) ?? null;
    if (this._creatorState.jemHadarHatcheryTalentUuid && !selectedJemHadarHatcheryTalent) {
      this._creatorState.jemHadarHatcheryTalentUuid = "";
      for (const talent of jemHadarHatcheryTalentChoices) talent.selected = false;
    }
    const upbringingBlockedTalents = await buildTalentBlockList([
      ...selectedSpeciesEsotericTalents.map(talent => talent.uuid),
      ...selectedBorgImplants.map(talent => talent.uuid),
      ...selectedHumanAugmentTalents.map(talent => talent.uuid),
      selectedJemHadarHatcheryTalent?.uuid,
    ]);
    const configuredUpbringingTalents = uniqueUuidList([
      ...(upbringing?.talentUuids?.length
        ? upbringing.talentUuids
        : allConfiguredTalentUuids(data.config, {
          includeEsoteric: this._creatorState.gmAllowEsotericTalents,
          ...speciesTalentAccess,
        })),
      ...talentUuids,
    ]);
    const upbringingTalentChoices = await prepareTalentChoicesForContext(
      configuredUpbringingTalents,
      data,
      preview,
      speciesNames,
      this._creatorState.upbringingTalentUuid,
      {
        hideUnavailableScoreRequirements: true,
        includeEsoteric: this._creatorState.gmAllowEsotericTalents,
        ...speciesTalentAccess,
        blockedTalents: upbringingBlockedTalents,
      },
    );
    const selectedUpbringingTalent = upbringingTalentChoices.find(talent => talent.selected && talent.available) ?? null;
    if (this._creatorState.upbringingTalentUuid && !upbringingTalentChoices.some(talent => talent.uuid === this._creatorState.upbringingTalentUuid && talent.available)) {
      this._creatorState.upbringingTalentUuid = "";
      for (const talent of upbringingTalentChoices) talent.selected = false;
    }
    const selectedUpbringingPath = upbringingPathKey === "rebelled" ? upbringing?.rebelled : upbringing?.accepted;
    const upbringingBoostedAttributes = [
      selectedUpbringingPath?.attributePlusOne,
      selectedUpbringingPath?.attributePlusTwo,
    ].filter(Boolean);
    const careerTraitOptions = await prepareUuidListForContext(careerPath?.traitUuids ?? []);
    const hasCustomCareerTraitInput = this._creatorState.careerCustomTraitName.trim() || this._creatorState.careerCustomTraitDescription.trim();
    if (!this._creatorState.careerTraitUuid && !hasCustomCareerTraitInput && careerTraitOptions.length === 1) {
      this._creatorState.careerTraitUuid = careerTraitOptions[0].uuid;
    }
    const customCareerTrait = this._creatorState.careerCustomTraitName.trim()
      ? {
        name: this._creatorState.careerCustomTraitName.trim(),
        description: this._creatorState.careerCustomTraitDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredCareerTrait = customCareerTrait
      ? null
      : careerTraitOptions.find(trait => trait.uuid === this._creatorState.careerTraitUuid) ?? null;
    const selectedCareerTrait = customCareerTrait ?? selectedConfiguredCareerTrait;
    if (this._creatorState.careerTraitUuid && !selectedConfiguredCareerTrait && !customCareerTrait) {
      this._creatorState.careerTraitUuid = "";
    }
    const careerTalentNames = new Set([
      ...speciesNames,
      selectedCareerTrait?.name?.toLocaleLowerCase(game.i18n.lang),
    ].filter(Boolean));
    const careerTalentAccess = specialTalentAccessOptions(careerTalentNames);

    const customCareerValue = this._creatorState.careerCustomValueName.trim()
      ? {
        name: this._creatorState.careerCustomValueName.trim(),
        description: this._creatorState.careerCustomValueDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredCareerValue = customCareerValue
      ? null
      : values.find(value => value.uuid === this._creatorState.careerValueUuid) ?? null;
    const selectedCareerValue = customCareerValue ?? selectedConfiguredCareerValue;

    const careerFocusOptions = await prepareUuidListForContext(lifepathFocusUuids(
      careerPath?.recommendedFocusUuids ?? [],
      data.config,
      [selectedCareerDepartmentPlusTwo, ...selectedCareerDepartmentPlusOne, selectedCareerDepartmentReallocationTo].filter(Boolean),
    ));
    const careerFocusSelections = [0, 1, 2].map(index => {
      const customName = String(this._creatorState.careerCustomFocusNames?.[index] ?? "").trim();
      const configured = customName ? null : careerFocusOptions.find(focus => focus.uuid === this._creatorState.careerFocusUuids?.[index]) ?? null;
      return {
        index,
        number: index + 1,
        customName,
        selected: customName ? { name: customName, custom: true } : configured,
        options: careerFocusOptions.map(focus => ({
          ...focus,
          selected: focus.uuid === configured?.uuid,
        })),
      };
    });

    const careerBlockedTalents = await buildTalentBlockList([
      ...selectedSpeciesEsotericTalents.map(talent => talent.uuid),
      ...selectedBorgImplants.map(talent => talent.uuid),
      ...selectedHumanAugmentTalents.map(talent => talent.uuid),
      isJemHadarLifepath || isVortaLifepath ? null : selectedUpbringingTalent?.uuid,
      selectedJemHadarHatcheryTalent?.uuid,
    ]);
    const configuredCareerTalents = uniqueUuidList([
      ...(careerPath?.talentUuids?.length
        ? careerPath.talentUuids
        : allConfiguredTalentUuids(data.config, {
          includeEsoteric: this._creatorState.gmAllowEsotericTalents,
          ...careerTalentAccess,
        })),
      ...talentUuids,
    ]);
    const careerTalentChoices = await prepareTalentChoicesForContext(
      configuredCareerTalents,
      data,
      preview,
      careerTalentNames,
      this._creatorState.careerTalentUuid,
      {
        hideUnavailableScoreRequirements: true,
        includeEsoteric: this._creatorState.gmAllowEsotericTalents,
        ...careerTalentAccess,
        blockedTalents: careerBlockedTalents,
      },
    );
    const selectedCareerTalent = careerTalentChoices.find(talent => talent.selected && talent.available) ?? null;
    if (this._creatorState.careerTalentUuid && !careerTalentChoices.some(talent => talent.uuid === this._creatorState.careerTalentUuid && talent.available)) {
      this._creatorState.careerTalentUuid = "";
      for (const talent of careerTalentChoices) talent.selected = false;
    }

    const customExperienceValue = this._creatorState.experienceCustomValueName.trim()
      ? {
        name: this._creatorState.experienceCustomValueName.trim(),
        description: this._creatorState.experienceCustomValueDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredExperienceValue = customExperienceValue
      ? null
      : values.find(value => value.uuid === this._creatorState.experienceValueUuid) ?? null;
    const selectedExperienceValue = customExperienceValue ?? selectedConfiguredExperienceValue;

    const experienceBlockedTalents = await buildTalentBlockList([
      ...selectedSpeciesEsotericTalents.map(talent => talent.uuid),
      ...selectedBorgImplants.map(talent => talent.uuid),
      ...selectedHumanAugmentTalents.map(talent => talent.uuid),
      isJemHadarLifepath || isVortaLifepath ? null : selectedUpbringingTalent?.uuid,
      selectedCareerTalent?.uuid,
      selectedJemHadarHatcheryTalent?.uuid,
    ]);
    const speciesTalentUuidSet = new Set(talentUuids);
    const oldAsDirtSpeciesTalentUuids = hasTraitAccessName(speciesNames, "horta") && experience?.key === "veteran"
      ? (await Promise.all(uniqueUuidList(talentUuids).map(async uuid => ({
        uuid,
        doc: await resolveUuidDoc(uuid),
      }))))
        .filter(entry => isOldAsDirtTalent(entry.doc))
        .map(entry => entry.uuid)
      : [];
    const configuredExperienceTalentUuids = experience?.talentMode === "configured"
      ? (experience.talentUuids ?? []).filter(uuid => !speciesTalentUuidSet.has(uuid))
      : [
        ...allConfiguredTalentUuids(data.config, {
          includeEsoteric: this._creatorState.gmAllowEsotericTalents,
          ...careerTalentAccess,
        }),
        ...talentUuids,
    ];
    const configuredExperienceTalents = uniqueUuidList([
      ...configuredExperienceTalentUuids,
      ...oldAsDirtSpeciesTalentUuids,
    ]);
    const experienceTalentChoices = await prepareTalentChoicesForContext(
      configuredExperienceTalents,
      data,
      preview,
      careerTalentNames,
      this._creatorState.experienceTalentUuid,
      {
        hideUnavailableScoreRequirements: true,
        includeEsoteric: this._creatorState.gmAllowEsotericTalents,
        ...careerTalentAccess,
        blockedTalents: experienceBlockedTalents,
      },
    );
    const selectedExperienceTalent = experienceTalentChoices.find(talent => talent.selected && talent.available) ?? null;
    if (this._creatorState.experienceTalentUuid && !experienceTalentChoices.some(talent => talent.uuid === this._creatorState.experienceTalentUuid && talent.available)) {
      this._creatorState.experienceTalentUuid = "";
      for (const talent of experienceTalentChoices) talent.selected = false;
    }

    const careerEventSelections = await Promise.all([0, 1].map(async index => {
      const selectedEvent = selectedCareerEvents[index] ?? null;
      const attributeChoices = careerEventAttributeChoices(selectedEvent);
      const departmentChoices = careerEventDepartmentChoices(selectedEvent);
      const focusOptions = await prepareUuidListForContext(selectedEvent?.suggestedFocusUuids ?? []);
      const customName = String(this._creatorState.careerEventCustomFocusNames?.[index] ?? "").trim();
      const configuredFocus = customName
        ? null
        : focusOptions.find(focus => focus.uuid === this._creatorState.careerEventFocusUuids?.[index]) ?? null;
      const traitOptions = await prepareUuidListForContext(selectedEvent?.suggestedTraitUuids ?? []);
      const customTraitName = String(this._creatorState.careerEventCustomTraitNames?.[index] ?? "").trim();
      const customTraitDescription = String(this._creatorState.careerEventCustomTraitDescriptions?.[index] ?? "").trim();
      const customTrait = customTraitName
        ? { name: customTraitName, description: customTraitDescription, custom: true }
        : null;
      const configuredTrait = customTrait
        ? null
        : traitOptions.find(trait => trait.uuid === this._creatorState.careerEventTraitUuids?.[index]) ?? null;
      return {
        index,
        number: index + 1,
        tabId: `event${index}`,
        event: selectedEvent,
        eventOptions: careerEvents.map(event => ({
          id: event.id,
          name: event.name,
          description: event.description,
          slotIndex: index,
          attributeLabel: event.allowAnyAttribute ? "Any Attribute" : careerEventAttributeChoices(event).map(key => ATTRIBUTE_LABELS[key]).join(" or "),
          departmentLabel: event.allowAnyDepartment ? "Any Department" : careerEventDepartmentChoices(event).map(key => DISCIPLINE_LABELS[key]).join(" or "),
          selected: event.id === selectedEvent?.id,
        })),
        attributeLabel: selectedEvent?.attributeKey ? ATTRIBUTE_LABELS[selectedEvent.attributeKey] : "",
        departmentLabel: selectedEvent?.departmentKey ? DISCIPLINE_LABELS[selectedEvent.departmentKey] : "",
        attributeChoices: attributeChoices.map(key => ({
          key,
          label: ATTRIBUTE_LABELS[key],
          selected: key === selectedEvent?.attributeKey,
        })),
        departmentChoices: departmentChoices.map(key => ({
          key,
          label: DISCIPLINE_LABELS[key],
          selected: key === selectedEvent?.departmentKey,
        })),
        needsAttributeChoice: attributeChoices.length > 1,
        needsDepartmentChoice: departmentChoices.length > 1,
        focusDescription: selectedEvent?.focusDescription ?? "",
        focusOptions: focusOptions.map(focus => ({
          ...focus,
          selected: focus.uuid === configuredFocus?.uuid,
        })),
        customFocusName: customName,
        selectedFocus: customName ? { name: customName, custom: true } : configuredFocus,
        traitDescription: selectedEvent?.traitDescription ?? "",
        traitOptions: traitOptions.map(trait => ({
          ...trait,
          selected: trait.uuid === configuredTrait?.uuid,
        })),
        customTraitName,
        customTraitDescription,
        selectedTrait: customTrait ?? configuredTrait,
      };
    }));

    const untappedPotential = hasUntappedPotential(selectedExperienceTalent);
    const finalAttributeContext = finalScoreContext(
      preview.attributes,
      ATTRIBUTE_KEYS,
      ATTRIBUTE_LABELS,
      { max: untappedPotential ? 11 : 12, singleMax: !untappedPotential },
      this._creatorState.finalAttributeRedistribution,
      this._creatorState.finalAttributeBoosts,
      2,
    );
    const finalDepartmentContext = finalScoreContext(
      preview.disciplines,
      DISCIPLINE_KEYS,
      DISCIPLINE_LABELS,
      { max: untappedPotential ? 4 : 5, singleMax: !untappedPotential },
      this._creatorState.finalDepartmentRedistribution,
      this._creatorState.finalDepartmentBoosts,
      2,
    );
    this._creatorState.finalAttributeRedistribution = finalAttributeContext.redistribution;
    this._creatorState.finalAttributeBoosts = finalAttributeContext.final;
    this._creatorState.finalDepartmentRedistribution = finalDepartmentContext.redistribution;
    this._creatorState.finalDepartmentBoosts = finalDepartmentContext.final;
    const finalPreview = {
      attributes: currentStep >= 7 ? finalAttributeContext.scores : preview.attributes,
      disciplines: currentStep >= 7 ? finalDepartmentContext.scores : preview.disciplines,
    };
    if (currentStep >= 7) {
      preview.attributes = { ...finalAttributeContext.scores };
      preview.disciplines = { ...finalDepartmentContext.scores };
    }

    const customFinalValue = this._creatorState.finalCustomValueName.trim()
      ? {
        name: this._creatorState.finalCustomValueName.trim(),
        description: this._creatorState.finalCustomValueDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredFinalValue = customFinalValue
      ? null
      : values.find(value => value.uuid === this._creatorState.finalValueUuid) ?? null;
    const selectedFinalValue = customFinalValue ?? selectedConfiguredFinalValue;
    const finalTalentNames = new Set([
      ...careerTalentNames,
      ...careerEventSelections.map(slot => slot.selectedTrait?.name?.toLocaleLowerCase(game.i18n.lang)),
    ].filter(Boolean));
    const finalTalentAccess = specialTalentAccessOptions(finalTalentNames);

    const finalBlockedTalents = await buildTalentBlockList([
      ...selectedSpeciesEsotericTalents.map(talent => talent.uuid),
      ...selectedBorgImplants.map(talent => talent.uuid),
      ...selectedHumanAugmentTalents.map(talent => talent.uuid),
      isJemHadarLifepath || isVortaLifepath ? null : selectedUpbringingTalent?.uuid,
      selectedCareerTalent?.uuid,
      selectedExperienceTalent?.uuid,
      selectedJemHadarHatcheryTalent?.uuid,
    ]);
    const finalTalentChoices = await prepareTalentChoicesForContext(
      uniqueUuidList([
        ...allConfiguredTalentUuids(data.config, {
          includeEsoteric: this._creatorState.gmAllowEsotericTalents,
          ...finalTalentAccess,
        }),
        ...talentUuids,
      ]),
      data,
      finalPreview,
      finalTalentNames,
      this._creatorState.finalTalentUuid,
      {
        hideUnavailableScoreRequirements: true,
        includeEsoteric: this._creatorState.gmAllowEsotericTalents,
        ...finalTalentAccess,
        blockedTalents: finalBlockedTalents,
      },
    );
    const selectedFinalTalent = finalTalentChoices.find(talent => talent.selected && talent.available) ?? null;
    if (this._creatorState.finalTalentUuid && !finalTalentChoices.some(talent => talent.uuid === this._creatorState.finalTalentUuid && talent.available)) {
      this._creatorState.finalTalentUuid = "";
      for (const talent of finalTalentChoices) talent.selected = false;
    }

    const roles = await prepareUuidListForContext(data.config.roles);
    const selectedRole = roles.find(role => role.uuid === this._creatorState.roleUuid) ?? null;
    const roleEquipment = await prepareUuidListForContext(selectedRole ? data.finishing.roleLoadouts?.[selectedRole.uuid] ?? [] : []);
    const finishingData = normalizeFinishingData(data.finishing);
    const ranks = finishingData.ranks;
    const selectedRank = ranks.find(rank => rank.id === this._creatorState.rankId) ?? null;
    const rankDisplay = selectedRank?.name ?? this._creatorState.rank;
    const rankEquipment = await prepareUuidListForContext(selectedRank ? finishingData.rankLoadouts?.[selectedRank.id] ?? [] : []);

    const selectedSupportingDepartment = DISCIPLINE_KEYS.includes(this._creatorState.supportingDepartment)
      ? this._creatorState.supportingDepartment
      : "";
    if (this._creatorState.supportingDepartment && !selectedSupportingDepartment) this._creatorState.supportingDepartment = "";
    const departmentEquipment = await prepareUuidListForContext(
      selectedSupportingDepartment ? finishingData.departmentLoadouts?.[selectedSupportingDepartment] ?? [] : [],
    );

    const supportingAttributeAssignments = normalizeScoreArrayAssignments(
      this._creatorState.supportingAttributeAssignments,
      ATTRIBUTE_KEYS,
      characterTypeDefinition?.attributeArray ?? CHARACTER_TYPE_DEFINITIONS.supporting.attributeArray,
    );
    const supportingDepartmentAssignments = normalizeScoreArrayAssignments(
      this._creatorState.supportingDepartmentAssignments,
      DISCIPLINE_KEYS,
      characterTypeDefinition?.departmentArray ?? CHARACTER_TYPE_DEFINITIONS.supporting.departmentArray,
    );
    this._creatorState.supportingAttributeAssignments = supportingAttributeAssignments;
    this._creatorState.supportingDepartmentAssignments = supportingDepartmentAssignments;

    const supportingAttributes = { ...supportingAttributeAssignments };
    for (const key of effectivePrimary?.attributeBoosts ?? []) {
      if (key in supportingAttributes) supportingAttributes[key] += 1;
    }
    const supportingDepartments = { ...supportingDepartmentAssignments };
    const supportingTraitOptions = await prepareUuidListForContext(data.config.traits);
    const customSupportingTrait = this._creatorState.supportingCustomTraitName.trim()
      ? {
        name: this._creatorState.supportingCustomTraitName.trim(),
        description: this._creatorState.supportingCustomTraitDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredSupportingTrait = customSupportingTrait
      ? null
      : supportingTraitOptions.find(trait => trait.uuid === this._creatorState.supportingTraitUuid) ?? null;
    let selectedSupportingTrait = customSupportingTrait ?? selectedConfiguredSupportingTrait;
    const existingSupportingTraits = [
      ...traitList,
      selectedHumanAugmentFlawTrait,
    ].filter(Boolean);
    if (selectedSupportingTrait && isDuplicateTrait(selectedSupportingTrait, existingSupportingTraits)) {
      if (selectedSupportingTrait.uuid && this._creatorState.supportingTraitUuid === selectedSupportingTrait.uuid) this._creatorState.supportingTraitUuid = "";
      selectedSupportingTrait = null;
    }

    const supportingFocusLimit = characterTypeDefinition?.focusCount ?? 0;
    const supportingFocusOptions = await prepareUuidListForContext(
      selectedSupportingDepartment ? data.config.departmentFocuses?.[selectedSupportingDepartment] ?? [] : [],
    );
    const supportingFocusSelections = Array.from({ length: supportingFocusLimit }, (_slot, index) => {
      const customName = String(this._creatorState.supportingCustomFocusNames?.[index] ?? "").trim();
      const configured = customName
        ? null
        : supportingFocusOptions.find(focus => focus.uuid === this._creatorState.supportingFocusUuids?.[index]) ?? null;
      return {
        index,
        number: index + 1,
        customName,
        selected: customName ? { name: customName, custom: true } : configured,
        options: supportingFocusOptions.map(focus => ({
          ...focus,
          selected: focus.uuid === configured?.uuid,
        })),
      };
    });

    const customSupportingValue = this._creatorState.supportingCustomValueName.trim()
      ? {
        name: this._creatorState.supportingCustomValueName.trim(),
        description: this._creatorState.supportingCustomValueDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredSupportingValue = customSupportingValue
      ? null
      : values.find(value => value.uuid === this._creatorState.supportingValueUuid) ?? null;
    const selectedSupportingValue = customSupportingValue ?? selectedConfiguredSupportingValue;
    const assignmentName = String(this._creatorState.assignment ?? "").trim();
    const assignmentLoadoutKey = Object.keys(finishingData.assignmentLoadouts)
      .find(key => key.toLocaleLowerCase(game.i18n.lang) === assignmentName.toLocaleLowerCase(game.i18n.lang));
    const assignmentEquipment = await prepareUuidListForContext(assignmentLoadoutKey ? finishingData.assignmentLoadouts[assignmentLoadoutKey] ?? [] : []);

    const selectedTalentSummary = [
      ...selectedBorgImplants,
      ...selectedHumanAugmentTalents,
      isJemHadarLifepath ? selectedJemHadarHatcheryTalent : null,
      isJemHadarLifepath || isVortaLifepath ? null : selectedUpbringingTalent,
      selectedCareerTalent,
      selectedExperienceTalent,
      selectedFinalTalent,
    ].filter(Boolean);
    const hasExpandedProgrammingTalent = selectedTalentSummary.some(isExpandedProgrammingTalent);
    this._creatorState.expandedProgrammingFocusUuids = Array.isArray(this._creatorState.expandedProgrammingFocusUuids)
      ? this._creatorState.expandedProgrammingFocusUuids
      : ["", ""];
    this._creatorState.expandedProgrammingCustomFocusNames = Array.isArray(this._creatorState.expandedProgrammingCustomFocusNames)
      ? this._creatorState.expandedProgrammingCustomFocusNames
      : ["", ""];
    const expandedProgrammingFocusOptions = hasExpandedProgrammingTalent
      ? await prepareUuidListForContext(configuredFocusUuids(data.config))
      : [];
    const expandedProgrammingFocusSelections = Array.from({ length: hasExpandedProgrammingTalent ? 2 : 0 }, (_slot, index) => {
      const customName = String(this._creatorState.expandedProgrammingCustomFocusNames?.[index] ?? "").trim();
      const configured = customName
        ? null
        : expandedProgrammingFocusOptions.find(focus => focus.uuid === this._creatorState.expandedProgrammingFocusUuids?.[index]) ?? null;
      return {
        index,
        number: index + 1,
        customName,
        selected: customName ? { name: customName, custom: true } : configured,
        options: expandedProgrammingFocusOptions.map(focus => ({
          ...focus,
          selected: focus.uuid === configured?.uuid,
        })),
      };
    });
    if (!hasExpandedProgrammingTalent) {
      this._creatorState.expandedProgrammingFocusUuids = ["", ""];
      this._creatorState.expandedProgrammingCustomFocusNames = ["", ""];
    }
    const canSelectPastime = !isHologramCharacter || hasExpandedProgrammingTalent;
    if (!canSelectPastime && this._creatorState.pastime) this._creatorState.pastime = "";
    const focusSummary = [
      ...speciesFocusSelections.map(slot => slot.selected),
      isJemHadarLifepath ? selectedJemHadarHatcheryFocus : null,
      isVortaLifepath ? selectedVortaCloningFocus : null,
      isJemHadarLifepath || isVortaLifepath ? null : selectedUpbringingFocus,
      ...careerFocusSelections.map(slot => slot.selected),
      ...careerEventSelections.map(slot => slot.selectedFocus),
      ...expandedProgrammingFocusSelections.map(slot => slot.selected),
    ].filter(Boolean);
    const eventTraitSummary = careerEventSelections.map(slot => slot.selectedTrait).filter(Boolean);
    const valueSummary = [
      isJemHadarLifepath ? selectedJemHadarHatcheryValue : null,
      isVortaLifepath ? selectedVortaCloningValue : null,
      isJemHadarLifepath || isVortaLifepath ? null : selectedEnvironmentValue,
      selectedCareerValue,
      selectedExperienceValue,
      selectedFinalValue,
    ].filter(Boolean);
    const supportingFocusSummary = [
      ...speciesFocusSelections.map(slot => slot.selected),
      ...supportingFocusSelections.map(slot => slot.selected),
      ...expandedProgrammingFocusSelections.map(slot => slot.selected),
    ].filter(Boolean);
    const supportingValueSummary = selectedSupportingValue ? [selectedSupportingValue] : [];

    const npcDefinition = npcDefinitionForType(characterType);
    const npcAttributeAssignments = normalizeScoreArrayAssignments(
      this._creatorState.npcAttributeAssignments,
      ATTRIBUTE_KEYS,
      npcDefinition?.attributeArray ?? CHARACTER_TYPE_DEFINITIONS.minorNpc.attributeArray,
    );
    const npcDepartmentAssignments = normalizeScoreArrayAssignments(
      this._creatorState.npcDepartmentAssignments,
      DISCIPLINE_KEYS,
      npcDefinition?.departmentArray ?? CHARACTER_TYPE_DEFINITIONS.minorNpc.departmentArray,
    );
    if (isNpcCharacter) {
      this._creatorState.npcAttributeAssignments = npcAttributeAssignments;
      this._creatorState.npcDepartmentAssignments = npcDepartmentAssignments;
    }
    const npcAttributes = { ...npcAttributeAssignments };
    for (const key of effectivePrimary?.attributeBoosts ?? []) {
      if (key in npcAttributes) npcAttributes[key] = Math.min(12, (npcAttributes[key] ?? 0) + 1);
    }
    const npcDisciplines = { ...npcDepartmentAssignments };
    const npcTraitOptions = await prepareUuidListForContext(data.config.traits);
    const npcCustomRoleTrait = this._creatorState.npcCustomRoleTraitName.trim()
      ? {
        name: this._creatorState.npcCustomRoleTraitName.trim(),
        description: this._creatorState.npcCustomRoleTraitDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredNpcRoleTrait = npcCustomRoleTrait
      ? null
      : npcTraitOptions.find(trait => trait.uuid === this._creatorState.npcRoleTraitUuid) ?? null;
    let selectedNpcRoleTrait = npcCustomRoleTrait ?? selectedConfiguredNpcRoleTrait;
    if (selectedNpcRoleTrait && isDuplicateTrait(selectedNpcRoleTrait, traitList)) {
      if (selectedNpcRoleTrait.uuid && this._creatorState.npcRoleTraitUuid === selectedNpcRoleTrait.uuid) this._creatorState.npcRoleTraitUuid = "";
      selectedNpcRoleTrait = null;
    }
    const npcCustomExtraTrait = this._creatorState.npcCustomExtraTraitName.trim()
      ? {
        name: this._creatorState.npcCustomExtraTraitName.trim(),
        description: this._creatorState.npcCustomExtraTraitDescription.trim(),
        custom: true,
      }
      : null;
    const selectedConfiguredNpcExtraTrait = npcCustomExtraTrait
      ? null
      : npcTraitOptions.find(trait => trait.uuid === this._creatorState.npcExtraTraitUuid) ?? null;
    let selectedNpcExtraTrait = npcCustomExtraTrait ?? selectedConfiguredNpcExtraTrait;
    if (selectedNpcExtraTrait && isDuplicateTrait(selectedNpcExtraTrait, [...traitList, selectedNpcRoleTrait].filter(Boolean))) {
      if (selectedNpcExtraTrait.uuid && this._creatorState.npcExtraTraitUuid === selectedNpcExtraTrait.uuid) this._creatorState.npcExtraTraitUuid = "";
      selectedNpcExtraTrait = null;
    }
    const npcValueLimit = npcDefinition?.valueCount ?? 0;
    const npcValueMin = Math.min(npcValueLimit, npcDefinition?.minValueCount ?? npcValueLimit);
    let lastFilledValue = -1;
    for (let i = 0; i < (this._creatorState.npcValueUuids?.length ?? 0); i++) {
      if (this._creatorState.npcValueUuids[i] || (this._creatorState.npcCustomValueNames?.[i] ?? "").trim()) lastFilledValue = i;
    }
    const npcValueVisible = Math.min(npcValueLimit, Math.max(Number(this._creatorState.npcVisibleValueSlots ?? 0) || 0, npcValueMin, lastFilledValue + 1));
    const npcCanAddValue = npcValueVisible < npcValueLimit;
    const npcValueSelections = Array.from({ length: npcValueVisible }, (_slot, index) => {
      const rawCustomName = String(this._creatorState.npcCustomValueNames?.[index] ?? "");
      const rawCustomDescription = String(this._creatorState.npcCustomValueDescriptions?.[index] ?? "");
      const customName = rawCustomName.trim();
      const customDescription = rawCustomDescription.trim();
      const editing = !!this._creatorState.npcValueEditFlags?.[index];
      const configured = values.find(value => value.uuid === this._creatorState.npcValueUuids?.[index]) ?? null;
      const isEdited = editing && !!configured;
      const isCustomOnly = !configured && (customName || customDescription);
      let selected = null;
      if (isEdited) selected = { name: customName || configured.name, description: customDescription || configured.description, custom: true, edited: true };
      else if (isCustomOnly) selected = { name: customName, description: customDescription, custom: true };
      else if (configured) selected = configured;
      return {
        index,
        number: index + 1,
        customName: isEdited ? (rawCustomName || configured.name) : rawCustomName,
        customDescription: isEdited ? (rawCustomDescription || configured.description) : rawCustomDescription,
        editing: isEdited,
        canEdit: !!configured && !isEdited,
        showCustomFields: isEdited || isCustomOnly || !configured,
        removable: index >= npcValueMin,
        selected,
        options: values.map(value => ({
          ...value,
          selected: value.uuid === configured?.uuid,
          disabled: normalizeUuidList(this._creatorState.npcValueUuids).includes(value.uuid) && value.uuid !== configured?.uuid,
        })),
      };
    });
    const npcFocusLimit = npcDefinition?.focusCount ?? 0;
    const npcFocusMin = Math.min(npcFocusLimit, npcDefinition?.minFocusCount ?? npcFocusLimit);
    const npcFocusOptions = await prepareUuidListForContext(configuredFocusUuids(data.config));
    let lastFilledFocus = -1;
    for (let i = 0; i < (this._creatorState.npcFocusUuids?.length ?? 0); i++) {
      if (this._creatorState.npcFocusUuids[i] || (this._creatorState.npcCustomFocusNames?.[i] ?? "").trim()) lastFilledFocus = i;
    }
    const npcFocusVisible = Math.min(npcFocusLimit, Math.max(Number(this._creatorState.npcVisibleFocusSlots ?? 0) || 0, npcFocusMin, lastFilledFocus + 1));
    const npcCanAddFocus = npcFocusVisible < npcFocusLimit;
    const npcFocusSelections = Array.from({ length: npcFocusVisible }, (_slot, index) => {
      const rawCustomName = String(this._creatorState.npcCustomFocusNames?.[index] ?? "");
      const rawCustomDescription = String(this._creatorState.npcCustomFocusDescriptions?.[index] ?? "");
      const customName = rawCustomName.trim();
      const customDescription = rawCustomDescription.trim();
      const editing = !!this._creatorState.npcFocusEditFlags?.[index];
      const configured = npcFocusOptions.find(focus => focus.uuid === this._creatorState.npcFocusUuids?.[index]) ?? null;
      const isEdited = editing && !!configured;
      const isCustomOnly = !configured && (customName || customDescription);
      let selected = null;
      if (isEdited) selected = { name: customName || configured.name, description: customDescription || configured.description, custom: true, edited: true };
      else if (isCustomOnly) selected = { name: customName, description: customDescription, custom: true };
      else if (configured) selected = configured;
      return {
        index,
        number: index + 1,
        customName: isEdited ? (rawCustomName || configured.name) : rawCustomName,
        customDescription: isEdited ? (rawCustomDescription || configured.description) : rawCustomDescription,
        editing: isEdited,
        canEdit: !!configured && !isEdited,
        showCustomFields: isEdited || isCustomOnly || !configured,
        removable: index >= npcFocusMin,
        selected,
        options: npcFocusOptions.map(focus => ({
          ...focus,
          selected: focus.uuid === configured?.uuid,
          disabled: normalizeUuidList(this._creatorState.npcFocusUuids).includes(focus.uuid) && focus.uuid !== configured?.uuid,
        })),
      };
    });
    const npcTalentLimit = npcDefinition?.talentCount ?? 0;
    const npcTalentChoices = await prepareTalentChoicesForContext(
      allConfiguredTalentUuids(data.config, {
        includeNpc: true,
        includeEsoteric: true,
        includeAugment: true,
        includeCybernetic: true,
        includeBorgImplantCategory: true,
      }),
      data,
      { attributes: npcAttributes, disciplines: npcDisciplines },
      speciesNames,
      "",
      {
        includeNpc: true,
        includeEsoteric: true,
        includeAugment: true,
        includeCybernetic: true,
        includeBorgImplantCategory: true,
        includeBorgImplants: true,
      },
    );
    const selectedNpcTalentUuids = normalizeUuidList(this._creatorState.npcTalentUuids);
    const npcTalentMin = Math.min(npcTalentLimit, npcDefinition?.minTalentCount ?? npcTalentLimit);
    let lastFilledTalent = -1;
    for (let i = 0; i < (this._creatorState.npcTalentUuids?.length ?? 0); i++) {
      if (this._creatorState.npcTalentUuids[i] || (this._creatorState.npcCustomTalentNames?.[i] ?? "").trim()) lastFilledTalent = i;
    }
    const npcTalentVisible = Math.min(npcTalentLimit, Math.max(Number(this._creatorState.npcVisibleTalentSlots ?? 0) || 0, npcTalentMin, lastFilledTalent + 1));
    const npcCanAddTalent = npcTalentVisible < npcTalentLimit;
    const npcTalentSelections = Array.from({ length: npcTalentVisible }, (_slot, index) => {
      const rawCustomName = String(this._creatorState.npcCustomTalentNames?.[index] ?? "");
      const rawCustomDescription = String(this._creatorState.npcCustomTalentDescriptions?.[index] ?? "");
      const customName = rawCustomName.trim();
      const customDescription = rawCustomDescription.trim();
      const editing = !!this._creatorState.npcTalentEditFlags?.[index];
      const configured = npcTalentChoices.find(talent => talent.uuid === this._creatorState.npcTalentUuids?.[index]) ?? null;
      const isEdited = editing && !!configured;
      const isCustomOnly = !configured && (customName || customDescription);
      let selected = null;
      if (isEdited) selected = { name: customName || configured.name, description: customDescription || configured.description, custom: true, edited: true };
      else if (isCustomOnly) selected = { name: customName, description: customDescription, custom: true };
      else if (configured) selected = configured;
      return {
        index,
        number: index + 1,
        customName: isEdited ? (rawCustomName || configured.name) : rawCustomName,
        customDescription: isEdited ? (rawCustomDescription || configured.description) : rawCustomDescription,
        editing: isEdited,
        canEdit: !!configured && !isEdited,
        showCustomFields: isEdited || isCustomOnly || !configured,
        removable: index >= npcTalentMin,
        selected,
        options: npcTalentChoices.map(talent => ({
          ...talent,
          selected: talent.uuid === configured?.uuid,
          disabled: !talent.available || (selectedNpcTalentUuids.includes(talent.uuid) && talent.uuid !== configured?.uuid),
        })),
      };
    });
    const npcEquipmentOptions = await prepareUuidListForContext(uniqueUuidList([
      ...normalizeUuidList(data.config.items),
      ...normalizeUuidList(data.config.weapons),
      ...normalizeUuidList(data.config.armor),
    ]));
    const selectedNpcEquipmentUuids = normalizeUuidList(this._creatorState.npcEquipmentUuids);
    const selectedNpcEquipment = npcEquipmentOptions.filter(item => selectedNpcEquipmentUuids.includes(item.uuid));
    const npcValueSummary = npcValueSelections.map(slot => slot.selected).filter(Boolean);
    const npcFocusSummary = [
      ...speciesFocusSelections.map(slot => slot.selected),
      ...npcFocusSelections.map(slot => slot.selected),
    ].filter(Boolean);
    const npcTalentSummary = npcTalentSelections.map(slot => slot.selected).filter(Boolean);
    const npcPersonalThreat = npcDefinition?.npcType === "major"
      ? 6 + npcValueSummary.length
      : npcDefinition?.npcType === "notable" ? 3 : 0;

    updateOpeningLoader(this, 92, "Building character creator window");
    return {
      step: currentStep,
      typeChoiceActive,
      characterType,
      characterTypeDefinition,
      characterTypeOptions: visibleCharacterTypeOptions.map(definition => ({
        ...definition,
        selected: definition.key === characterType,
      })),
      isPlayerCharacter,
      isSupportingCharacter,
      isNpcCharacter,
      isSupervisoryCharacter: characterType === "supervisory",
      npcDefinition,
      npcTypeLabel: npcDefinition?.name ?? "",
      supportingStepLabels: SUPPORTING_STEP_LABELS.map(row => ({
        ...row,
        active: row.step === currentStep,
      })),
      npcStepLabels: NPC_STEP_LABELS.map(row => ({
        ...row,
        active: row.step === currentStep,
      })),
      stepOneActive: currentStep === 1,
      stepTwoActive: currentStep === 2,
      stepThreeActive: currentStep === 3,
      stepFourActive: currentStep === 4,
      stepFiveActive: currentStep === 5,
      stepSixActive: currentStep === 6,
      stepSevenActive: currentStep === 7,
      reviewActive: currentStep === 8,
      hasSpecies: species.length > 0,
      hasEnvironments: environments.length > 0,
      hasUpbringings: upbringings.length > 0,
      hasCareerPaths: careerPaths.length > 0,
      hasExperienceOptions: experienceOptions.length > 0,
      hasCareerEvents: careerEvents.length > 0,
      isJemHadarLifepath,
      isVortaLifepath,
      forcedJemHadarCareerPathMissing: isJemHadarLifepath && !forcedJemHadarCareerPath,
      vortaCareerPathOptionsMissing: isVortaLifepath && !vortaCareerPaths.length,
      speciesSearch: this._creatorState.speciesSearch ?? "",
      speciesOptions: species.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tokenImage: s.tokenImage,
        extraFocusCount: s.extraFocusCount,
        attributeLabels: selectedAttributeOptions(s.attributeBoosts).filter(attr => attr.selected),
        attributeChoiceLabel: selectedAttributeOptions(s.attributeChoiceBoosts).filter(attr => attr.selected).map(attr => attr.label).join(" or "),
        freeAttributeSelection: !!s.freeAttributeSelection,
        primarySelected: s.id === primary?.id,
        secondarySelected: s.id === secondary?.id,
        showSecondaryPicker: this._creatorState.mixedSpecies,
        disabledAsSecondary: s.id === primary?.id,
      })),
      mixedSpecies: this._creatorState.mixedSpecies,
      mixedSpeciesForced,
      primary: primaryCtx,
      secondary: secondaryCtx,
      requiresBorgImplants: mixedSpeciesForced,
      borgImplantOptions: borgImplantOptions.map(talent => ({
        ...talent,
        selected: this._creatorState.selectedBorgImplantUuids.includes(talent.uuid),
      })),
      hasBorgImplantOptions: borgImplantOptions.length > 0,
      selectedBorgImplants,
      selectedBorgImplantCount: selectedBorgImplants.length,
      borgImplantMin: 1,
      borgImplantMax: 3,
      requiresHumanAugmentTalents,
      humanAugmentTalentOptions: humanAugmentTalentOptions.map(talent => ({
        ...talent,
        selected: this._creatorState.selectedHumanAugmentTalentUuids.includes(talent.uuid),
      })),
      hasHumanAugmentTalentOptions: humanAugmentTalentOptions.length > 0,
      selectedHumanAugmentTalents,
      selectedHumanAugmentTalentCount: selectedHumanAugmentTalents.length,
      humanAugmentRequiresFlawTrait,
      humanAugmentFlawTraitOptions: humanAugmentFlawTraitOptions
        .filter(trait => !isDuplicateTrait(trait, traitList))
        .map(trait => ({
          ...trait,
          selected: trait.uuid === selectedConfiguredHumanAugmentFlawTrait?.uuid,
        })),
      hasHumanAugmentFlawTraitOptions: humanAugmentFlawTraitOptions.length > 0,
      humanAugmentFlawTraitUuid: this._creatorState.humanAugmentFlawTraitUuid,
      humanAugmentCustomFlawTraitName: this._creatorState.humanAugmentCustomFlawTraitName,
      humanAugmentCustomFlawTraitDescription: this._creatorState.humanAugmentCustomFlawTraitDescription,
      selectedHumanAugmentFlawTrait,
      speciesEsotericOptions: speciesEsotericOptions.map(talent => ({
        ...talent,
        selected: selectedSpeciesEsotericTalentUuids.includes(talent.uuid),
      })),
      hasSpeciesEsotericOptions: speciesEsotericSelections.length > 0,
      speciesEsotericTalentCount,
      speciesEsotericSelections,
      selectedSpeciesEsotericTalents,
      selectedSpeciesEsotericTalent,
      speciesExtraFocusCount,
      speciesFocusOptions,
      speciesFocusSelections,
      selectedSpeciesAbilityUuid: effectivePrimary?.speciesAbilityUuid ?? "",
      selectedSpeciesTraitUuids: uniqueUuidList([
        ...normalizeUuidList(primary?.traitUuids),
        primary?.traitUuid,
        ...(this._creatorState.mixedSpecies ? [
          ...normalizeUuidList(secondary?.traitUuids),
          secondary?.traitUuid,
        ] : []),
      ]),
      environment,
      upbringing,
      careerPath,
      experience,
      careerEventSelections,
      eventTraitSummary,
      environmentOptions: environments.map(e => ({
        id: e.id,
        name: e.name,
        selected: e.id === environment?.id,
      })),
      upbringingOptions: upbringings.map(u => ({
        id: u.id,
        name: u.name,
        selected: u.id === upbringing?.id,
      })),
      careerPathOptions: (isJemHadarLifepath && forcedJemHadarCareerPath
        ? [forcedJemHadarCareerPath]
        : isVortaLifepath && vortaCareerPaths.length
          ? vortaCareerPaths
          : careerPaths).map(c => ({
        id: c.id,
        name: c.name,
        selected: c.id === careerPath?.id,
      })),
      environmentValueOptions: values.map(value => ({
        ...value,
        selected: value.uuid === selectedConfiguredEnvironmentValue?.uuid,
      })),
      hasEnvironmentValues: values.length > 0,
      customEnvironmentValue,
      environmentCustomValueName: this._creatorState.environmentCustomValueName,
      environmentCustomValueDescription: this._creatorState.environmentCustomValueDescription,
      selectedEnvironmentValue,
      jemHadarHatcheryOptions: JEM_HADAR_HATCHERIES.map(hatchery => ({
        ...hatchery,
        selected: hatchery.key === selectedJemHadarHatchery.key,
        attributeSummary: hatchery.attributes.map(key => `${ATTRIBUTE_LABELS[key]} +1`).join(", "),
        departmentSummary: `${DISCIPLINE_LABELS[hatchery.department]} +1`,
      })),
      selectedJemHadarHatchery,
      jemHadarHatcheryValueOptions: values.map(value => ({
        ...value,
        selected: value.uuid === selectedConfiguredJemHadarHatcheryValue?.uuid,
      })),
      jemHadarHatcheryCustomValueName: this._creatorState.jemHadarHatcheryCustomValueName,
      jemHadarHatcheryCustomValueDescription: this._creatorState.jemHadarHatcheryCustomValueDescription,
      selectedJemHadarHatcheryValue,
      jemHadarHatcheryAttributeChoices: selectedJemHadarHatchery.attributes.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        selected: key === selectedJemHadarHatcheryAttribute,
      })),
      jemHadarHatcheryFixedAttributeSummary: selectedJemHadarHatchery.attributes.map(key => `${ATTRIBUTE_LABELS[key]} +1`).join(", "),
      jemHadarHatcheryDepartmentChoices: DISCIPLINE_KEYS
        .filter(key => key !== selectedJemHadarHatchery.department)
        .map(key => ({
          key,
          label: DISCIPLINE_LABELS[key],
          selected: key === selectedJemHadarHatcheryDepartment,
        })),
      jemHadarHatcheryFixedDepartmentLabel: DISCIPLINE_LABELS[selectedJemHadarHatchery.department],
      jemHadarHatcheryFocusOptions: jemHadarHatcheryFocusOptions.map(focus => ({
        ...focus,
        selected: focus.uuid === selectedConfiguredJemHadarHatcheryFocus?.uuid,
      })),
      jemHadarHatcheryCustomFocusName: this._creatorState.jemHadarHatcheryCustomFocusName,
      jemHadarHatcheryCustomFocusDescription: this._creatorState.jemHadarHatcheryCustomFocusDescription,
      selectedJemHadarHatcheryFocus,
      jemHadarHatcheryTalentChoices,
      selectedJemHadarHatcheryTalent,
      vortaCloning: VORTA_CLONING,
      vortaCloningValueOptions: values.map(value => ({
        ...value,
        selected: value.uuid === selectedConfiguredVortaCloningValue?.uuid,
      })),
      vortaCloningCustomValueName: this._creatorState.vortaCloningCustomValueName,
      vortaCloningCustomValueDescription: this._creatorState.vortaCloningCustomValueDescription,
      selectedVortaCloningValue,
      selectedVortaCloningAttributeCount: selectedVortaCloningAttributes.length,
      selectedVortaCloningAttributeChoice,
      vortaCloningAttributeChoices: ATTRIBUTE_KEYS.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        selected: selectedVortaCloningAttributes.includes(key),
        disabled: selectedVortaCloningAttributes.length >= 3 && !selectedVortaCloningAttributes.includes(key),
      })),
      vortaCloningAttributeChoiceOptions: selectedVortaCloningAttributes.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        selected: key === selectedVortaCloningAttributeChoice,
      })),
      vortaCloningPrimaryDepartmentChoices: VORTA_PRIMARY_DEPARTMENTS.map(key => ({
        key,
        label: DISCIPLINE_LABELS[key],
        selected: key === selectedVortaCloningPrimaryDepartment,
      })),
      vortaCloningSecondaryDepartmentChoices: DISCIPLINE_KEYS
        .filter(key => key !== selectedVortaCloningPrimaryDepartment)
        .map(key => ({
          key,
          label: DISCIPLINE_LABELS[key],
          selected: key === selectedVortaCloningSecondaryDepartment,
          disabled: !selectedVortaCloningPrimaryDepartment,
        })),
      selectedVortaCloningPrimaryDepartment,
      selectedVortaCloningSecondaryDepartment,
      vortaCloningFocusOptions: vortaCloningFocusOptions.map(focus => ({
        ...focus,
        selected: focus.uuid === selectedConfiguredVortaCloningFocus?.uuid,
      })),
      vortaCloningCustomFocusName: this._creatorState.vortaCloningCustomFocusName,
      vortaCloningCustomFocusDescription: this._creatorState.vortaCloningCustomFocusDescription,
      selectedVortaCloningFocus,
      upbringingPath: upbringingPathKey,
      upbringingAcceptedSelected: upbringingPathKey === "accepted",
      upbringingRebelledSelected: upbringingPathKey === "rebelled",
      upbringingPathDescription: upbringingPathKey === "rebelled" ? upbringing?.rebelledDescription : upbringing?.acceptedDescription,
      upbringingPathAttributes: [
        selectedUpbringingPath?.attributePlusOne ? `${ATTRIBUTE_LABELS[selectedUpbringingPath.attributePlusOne]} +1` : "",
        selectedUpbringingPath?.attributePlusTwo ? `${ATTRIBUTE_LABELS[selectedUpbringingPath.attributePlusTwo]} +2` : "",
      ].filter(Boolean).join(", "),
      upbringingDepartmentChoices: upbringingDepartmentKeys.map(key => ({
        key,
        label: DISCIPLINE_LABELS[key],
        selected: key === selectedUpbringingDepartment,
      })),
      upbringingFocusOptions: focusOptions.map(focus => ({
        ...focus,
        selected: focus.uuid === selectedConfiguredUpbringingFocus?.uuid,
      })),
      hasUpbringingFocusOptions: focusOptions.length > 0,
      customUpbringingFocus,
      upbringingCustomFocusName: this._creatorState.upbringingCustomFocusName,
      upbringingCustomFocusDescription: this._creatorState.upbringingCustomFocusDescription,
      selectedUpbringingFocus,
      upbringingTalentChoices,
      selectedUpbringingTalent,
      careerTraitOptions: careerTraitOptions.map(trait => ({
        ...trait,
        selected: trait.uuid === selectedCareerTrait?.uuid,
      })),
      hasCareerTraitOptions: careerTraitOptions.length > 0,
      careerCustomTraitName: this._creatorState.careerCustomTraitName,
      careerCustomTraitDescription: this._creatorState.careerCustomTraitDescription,
      selectedCareerTrait,
      careerValueOptions: values.map(value => ({
        ...value,
        selected: value.uuid === selectedConfiguredCareerValue?.uuid,
      })),
      careerCustomValueName: this._creatorState.careerCustomValueName,
      careerCustomValueDescription: this._creatorState.careerCustomValueDescription,
      selectedCareerValue,
      careerAttributeSpendTotal: careerAttributeSpendTotal(selectedCareerAttributeSpends),
      careerAttributeSpendRemaining: Math.max(0, 3 - careerAttributeSpendTotal(selectedCareerAttributeSpends)),
      careerRequiredAttributes,
      careerAttributeRequirementLabel,
      careerAttributeRequirementSatisfied,
      careerAttributeChoices: ATTRIBUTE_KEYS.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        value: selectedCareerAttributeSpends[key] ?? 0,
        required: careerRequiredAttributes.includes(key),
        canDecrease: (selectedCareerAttributeSpends[key] ?? 0) > 0,
        canIncrease: (selectedCareerAttributeSpends[key] ?? 0) < 2 && careerAttributeSpendTotal(selectedCareerAttributeSpends) < 3,
      })),
      careerDepartmentPlusTwoChoices: careerPlusTwoOptions.map(key => {
        const baseValue = careerDisciplineBase[key] ?? 0;
        const disabled = baseValue + 2 > 4;
        return {
          key,
          label: DISCIPLINE_LABELS[key],
          baseValue,
          selected: key === selectedCareerDepartmentPlusTwo,
          disabled,
        };
      }),
      careerDepartmentPlusOneChoices: careerPlusOneOptions.map(key => {
        const baseValue = careerDisciplineBase[key] ?? 0;
        const alreadySelected = selectedCareerDepartmentPlusOne.includes(key);
        const sameAsPlusTwo = key === selectedCareerDepartmentPlusTwo;
        const tooHigh = baseValue + 1 > 4;
        const overSelectionLimit = selectedCareerDepartmentPlusOne.length >= 2 && !alreadySelected;
        const disabled = sameAsPlusTwo || tooHigh || overSelectionLimit;
        return {
          key,
          label: DISCIPLINE_LABELS[key],
          baseValue,
          selected: alreadySelected,
          disabled,
        };
      }),
      selectedCareerDepartmentPlusTwo,
      selectedCareerDepartmentPlusOne,
      careerDepartmentPlusOneRemaining: Math.max(0, 2 - selectedCareerDepartmentPlusOne.length),
      careerDepartmentReallocationAllowed,
      selectedCareerDepartmentReallocationFrom,
      selectedCareerDepartmentReallocationTo,
      careerDepartmentReallocationFromChoices: careerDepartmentReallocationFromOptions.map(key => ({
        key,
        label: DISCIPLINE_LABELS[key],
        baseValue: careerDisciplineBase[key] ?? 0,
        selected: key === selectedCareerDepartmentReallocationFrom,
      })),
      careerDepartmentReallocationToChoices: careerDepartmentReallocationToOptions.map(key => ({
        key,
        label: DISCIPLINE_LABELS[key],
        baseValue: careerDisciplineBase[key] ?? 0,
        selected: key === selectedCareerDepartmentReallocationTo,
        disabled: !selectedCareerDepartmentReallocationFrom,
      })),
      careerDepartmentSummary: [
        selectedCareerDepartmentPlusTwo ? `${DISCIPLINE_LABELS[selectedCareerDepartmentPlusTwo]} +2` : "",
        ...selectedCareerDepartmentPlusOne.map(key => `${DISCIPLINE_LABELS[key]} +1`),
        selectedCareerDepartmentReallocationFrom && selectedCareerDepartmentReallocationTo
          ? `${DISCIPLINE_LABELS[selectedCareerDepartmentReallocationFrom]} -1, ${DISCIPLINE_LABELS[selectedCareerDepartmentReallocationTo]} +1`
          : "",
      ].filter(Boolean),
      careerFocusOptions,
      careerFocusSelections,
      careerTalentChoices,
      selectedCareerTalent,
      experienceOptions: experienceOptions.map(option => ({
        ...option,
        selected: option.key === experience?.key,
      })),
      experienceValueOptions: values.map(value => ({
        ...value,
        selected: value.uuid === selectedConfiguredExperienceValue?.uuid,
      })),
      experienceCustomValueName: this._creatorState.experienceCustomValueName,
      experienceCustomValueDescription: this._creatorState.experienceCustomValueDescription,
      selectedExperienceValue,
      isLanthaniteCharacter,
      experienceTalentChoices,
      selectedExperienceTalent,
      experienceTalentPoolLabel: oldAsDirtSpeciesTalentUuids.length
        ? `${experience.name} Talent List, plus Old as Dirt`
        : experience?.talentMode === "configured" ? `${experience.name} Talent List` : "Eligible Talents",
      untappedPotential,
      finalAttributeContext,
      finalDepartmentContext,
      finalAttributeTotal: scoreTotal(finalAttributeContext.scores, ATTRIBUTE_KEYS),
      finalDepartmentTotal: scoreTotal(finalDepartmentContext.scores, DISCIPLINE_KEYS),
      finalValueOptions: values.map(value => ({
        ...value,
        selected: value.uuid === selectedConfiguredFinalValue?.uuid,
      })),
      finalCustomValueName: this._creatorState.finalCustomValueName,
      finalCustomValueDescription: this._creatorState.finalCustomValueDescription,
      selectedFinalValue,
      finalTalentChoices,
      selectedFinalTalent,
      selectedTalentSummary,
      selectedTalentCount: [
        isJemHadarLifepath ? selectedJemHadarHatcheryTalent : null,
        isJemHadarLifepath || isVortaLifepath ? null : selectedUpbringingTalent,
        selectedCareerTalent,
        selectedExperienceTalent,
      ].filter(Boolean).length,
      isHologramCharacter,
      hasExpandedProgrammingTalent,
      canSelectPastime,
      expandedProgrammingFocusOptions,
      expandedProgrammingFocusSelections,
      focusSummary,
      focusCount: focusSummary.length,
      focusTargetCount: 6 + speciesExtraFocusCount + expandedProgrammingFocusSelections.length,
      valueSummary,
      roleOptions: roles.map(role => ({
        ...role,
        selected: role.uuid === selectedRole?.uuid,
      })),
      selectedRole,
      roleEquipment,
      departmentEquipment,
      assignmentEquipment,
      characterName: this._creatorState.characterName,
      randomNameGender: this._creatorState.randomNameGender,
      pastime: this._creatorState.pastime,
      rank: rankDisplay,
      customRank: this._creatorState.rank,
      selectedRank,
      rankEquipment,
      rankOptions: ranks.map(rank => ({
        ...rank,
        selected: rank.id === selectedRank?.id,
      })),
      assignment: this._creatorState.assignment,
      pronouns: this._creatorState.pronouns,
      supportingDepartment: selectedSupportingDepartment,
      supportingDepartmentLabel: departmentLabel(selectedSupportingDepartment),
      supportingDepartmentOptions: DISCIPLINE_KEYS.map(key => ({
        key,
        label: departmentLabel(key),
        selected: key === selectedSupportingDepartment,
      })),
      supportingAttributeRows: ATTRIBUTE_KEYS.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        value: supportingAttributes[key],
        baseValue: supportingAttributeAssignments[key],
        boosted: effectivePrimary?.attributeBoosts?.includes(key),
        options: scoreArrayOptions(characterTypeDefinition?.attributeArray ?? [], supportingAttributeAssignments[key]),
      })),
      supportingDepartmentRows: DISCIPLINE_KEYS.map(key => ({
        key,
        label: DISCIPLINE_LABELS[key],
        value: supportingDepartments[key],
        options: scoreArrayOptions(characterTypeDefinition?.departmentArray ?? [], supportingDepartmentAssignments[key]),
      })),
      supportingTraitOptions: supportingTraitOptions
        .filter(trait => !isDuplicateTrait(trait, existingSupportingTraits))
        .map(trait => ({
          ...trait,
          selected: trait.uuid === selectedConfiguredSupportingTrait?.uuid,
        })),
      supportingCustomTraitName: this._creatorState.supportingCustomTraitName,
      supportingCustomTraitDescription: this._creatorState.supportingCustomTraitDescription,
      selectedSupportingTrait,
      supportingFocusOptions,
      supportingFocusSelections,
      supportingFocusSummary,
      supportingFocusCount: supportingFocusSummary.length,
      supportingFocusLimit: supportingFocusLimit + expandedProgrammingFocusSelections.length,
      supportingValueOptions: values.map(value => ({
        ...value,
        selected: value.uuid === selectedConfiguredSupportingValue?.uuid,
      })),
      supportingCustomValueName: this._creatorState.supportingCustomValueName,
      supportingCustomValueDescription: this._creatorState.supportingCustomValueDescription,
      selectedSupportingValue,
      supportingValueSummary,
      supportingAttributeTotal: scoreTotal(supportingAttributes, ATTRIBUTE_KEYS),
      supportingDepartmentTotal: scoreTotal(supportingDepartments, DISCIPLINE_KEYS),
      npcAttributeRows: ATTRIBUTE_KEYS.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        value: npcAttributes[key],
        baseValue: npcAttributeAssignments[key],
        boosted: effectivePrimary?.attributeBoosts?.includes(key),
      })),
      npcDepartmentRows: DISCIPLINE_KEYS.map(key => ({
        key,
        label: DISCIPLINE_LABELS[key],
        value: npcDisciplines[key],
      })),
      npcAttributeTotal: scoreTotal(npcAttributes, ATTRIBUTE_KEYS),
      npcDepartmentTotal: scoreTotal(npcDisciplines, DISCIPLINE_KEYS),
      npcPersonalThreat,
      npcTraitOptions: npcTraitOptions
        .filter(trait => !isDuplicateTrait(trait, traitList))
        .map(trait => ({
          ...trait,
          selected: trait.uuid === selectedConfiguredNpcRoleTrait?.uuid,
        })),
      npcExtraTraitOptions: npcTraitOptions
        .filter(trait => !isDuplicateTrait(trait, [...traitList, selectedNpcRoleTrait].filter(Boolean)))
        .map(trait => ({
          ...trait,
          selected: trait.uuid === selectedConfiguredNpcExtraTrait?.uuid,
        })),
      selectedNpcRoleTrait,
      selectedNpcExtraTrait,
      npcCustomRoleTraitName: this._creatorState.npcCustomRoleTraitName,
      npcCustomRoleTraitDescription: this._creatorState.npcCustomRoleTraitDescription,
      npcCustomExtraTraitName: this._creatorState.npcCustomExtraTraitName,
      npcCustomExtraTraitDescription: this._creatorState.npcCustomExtraTraitDescription,
      npcValueSelections,
      npcValueSummary,
      npcValueCount: npcValueSummary.length,
      npcMinValueCount: npcDefinition?.minValueCount ?? npcValueLimit,
      npcValueLimit,
      npcCanAddValue,
      npcFocusSelections,
      npcFocusSummary,
      npcFocusCount: npcFocusSummary.length,
      npcMinFocusCount: npcDefinition?.minFocusCount ?? npcFocusLimit,
      npcFocusLimit,
      npcCanAddFocus,
      npcTalentSelections,
      npcTalentSummary,
      npcTalentCount: npcTalentSummary.length,
      npcMinTalentCount: npcDefinition?.minTalentCount ?? npcTalentLimit,
      npcTalentLimit,
      npcCanAddTalent,
      npcEquipmentOptions: npcEquipmentOptions.map(item => ({
        ...item,
        selected: selectedNpcEquipmentUuids.includes(item.uuid),
      })),
      selectedNpcEquipment,
      npcNotes: this._creatorState.npcNotes,
      gmAllowEsotericTalents: this._creatorState.gmAllowEsotericTalents,
      showEnvironmentAttributeSpecies: environment?.attributeMode === "species",
      environmentAttributeChoices: environmentAttributeKeys.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        selected: key === selectedEnvironmentAttribute,
      })),
      environmentAttributeSourceOptions: species.map(s => ({
        id: s.id,
        name: s.name,
        selected: s.id === environmentAttributeSource?.id,
        disabled: s.id === primary?.id,
      })),
      environmentDepartmentChoices: environmentDepartmentKeys.map(key => ({
        key,
        label: DISCIPLINE_LABELS[key],
        selected: key === selectedEnvironmentDepartment,
      })),
      primaryFreeAttributeSelection: !!primary?.freeAttributeSelection,
      selectedFreeAttributeCount: selectedFreeAttributes.length,
      freeAttributeChoices: ATTRIBUTE_KEYS.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        selected: selectedFreeAttributes.includes(key),
      })),
      hasSpeciesAttributeChoice: speciesAttributeChoiceKeys.length > 0,
      selectedSpeciesAttributeChoice,
      speciesAttributeChoiceOptions: speciesAttributeChoiceKeys.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        selected: key === selectedSpeciesAttributeChoice,
      })),
      previewAttributes: ATTRIBUTE_KEYS.map(key => ({
        key,
        label: ATTRIBUTE_LABELS[key],
        value: preview.attributes[key],
        boosted: effectivePrimary?.attributeBoosts?.includes(key)
          || (shouldApplyEnvironment && !isJemHadarLifepath && !isVortaLifepath && selectedEnvironmentAttribute === key)
          || (shouldApplyEnvironment && isJemHadarLifepath && (selectedJemHadarHatchery.attributes.includes(key) || selectedJemHadarHatcheryAttribute === key))
          || (shouldApplyEnvironment && isVortaLifepath && (selectedVortaCloningAttributes.includes(key) || selectedVortaCloningAttributeChoice === key))
          || (shouldApplyUpbringing && !isJemHadarLifepath && !isVortaLifepath && upbringingBoostedAttributes.includes(key))
          || (shouldApplyCareer && (selectedCareerAttributeSpends[key] ?? 0) > 0)
          || (currentStep >= 6 && selectedCareerEvents.some(event => event?.attributeKey === key)),
      })),
      previewDisciplines: DISCIPLINE_KEYS.map(key => ({
        key,
        label: DISCIPLINE_LABELS[key],
        value: preview.disciplines[key],
        boosted: (shouldApplyEnvironment && !isJemHadarLifepath && !isVortaLifepath && selectedEnvironmentDepartment === key)
          || (shouldApplyEnvironment && isJemHadarLifepath && (selectedJemHadarHatchery.department === key || selectedJemHadarHatcheryDepartment === key))
          || (shouldApplyEnvironment && isVortaLifepath && selectedVortaCloningDepartments.includes(key))
          || (shouldApplyUpbringing && !isJemHadarLifepath && !isVortaLifepath && selectedUpbringingDepartment === key)
          || (shouldApplyCareer && (selectedCareerDepartmentPlusTwo === key || selectedCareerDepartmentPlusOne.includes(key) || selectedCareerDepartmentReallocationTo === key))
          || (currentStep >= 6 && selectedCareerEvents.some(event => event?.departmentKey === key)),
      })),
      traitList,
      talentPool,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    bindDescriptionToggles(el);

    for (const [group, tab] of Object.entries(this._activeCreatorTabs)) {
      setActiveCreatorTab(el, group, tab);
    }

    el.querySelectorAll("[data-cc-creator-tab]").forEach(button => {
      button.addEventListener("click", () => {
        const group = button.dataset.ccCreatorTabGroup;
        const tab = button.dataset.ccCreatorTab;
        if (!group || !tab) return;
        this._activeCreatorTabs[group] = tab;
        setActiveCreatorTab(el, group, tab);
      });
    });

    el.querySelectorAll("[data-talent-filter]").forEach(input => {
      const root = input.closest("[data-talent-filter-root]");
      const list = root?.querySelector("[data-talent-filter-list]");
      const empty = root?.querySelector("[data-talent-filter-empty]");
      if (!list) return;

      const applyFilter = () => {
        const query = String(input.value ?? "").trim().toLocaleLowerCase(game.i18n.lang);
        let visible = 0;
        list.querySelectorAll("[data-talent-option]").forEach(item => {
          const matches = !query || item.textContent.toLocaleLowerCase(game.i18n.lang).includes(query);
          item.hidden = !matches;
          if (matches) visible += 1;
        });
        if (empty) empty.hidden = !query || visible > 0;
      };

      input.addEventListener("input", applyFilter);
      applyFilter();
    });

    el.querySelector("[data-field='characterName']")?.addEventListener("input", event => {
      this._creatorState.characterName = event.target.value;
    });

    el.querySelector("[data-field='randomNameGender']")?.addEventListener("change", event => {
      this._creatorState.randomNameGender = ["any", "male", "female"].includes(event.target.value) ? event.target.value : "any";
    });

    el.querySelectorAll("[data-supporting-score-chip]").forEach(chip => {
      chip.addEventListener("dragstart", event => {
        const payload = {
          kind: chip.dataset.scoreKind,
          key: chip.dataset.scoreKey,
        };
        event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
        event.dataTransfer?.setData("application/x-sta2e-supporting-score", JSON.stringify(payload));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
    });

    el.querySelectorAll("[data-supporting-score-drop]").forEach(row => {
      row.addEventListener("dragover", event => {
        event.preventDefault();
        row.classList.add("is-dragover");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });

      row.addEventListener("dragleave", () => row.classList.remove("is-dragover"));

      row.addEventListener("drop", event => {
        event.preventDefault();
        row.classList.remove("is-dragover");

        let payload = null;
        try {
          const raw = event.dataTransfer?.getData("application/x-sta2e-supporting-score")
            || event.dataTransfer?.getData("text/plain")
            || "";
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          payload = null;
        }

        const kind = row.dataset.scoreKind;
        const targetKey = row.dataset.scoreKey;
        if (!payload || payload.kind !== kind || payload.key === targetKey) return;

        const keys = kind === "attribute" ? ATTRIBUTE_KEYS : DISCIPLINE_KEYS;
        if (!keys.includes(payload.key) || !keys.includes(targetKey)) return;

        const isNpcScore = NPC_CHARACTER_TYPES.includes(this._creatorState.characterType);
        const definition = CHARACTER_TYPE_DEFINITIONS[this._creatorState.characterType] ?? CHARACTER_TYPE_DEFINITIONS.supporting;
        const stateKey = isNpcScore
          ? kind === "attribute" ? "npcAttributeAssignments" : "npcDepartmentAssignments"
          : kind === "attribute" ? "supportingAttributeAssignments" : "supportingDepartmentAssignments";
        const values = kind === "attribute" ? definition.attributeArray : definition.departmentArray;
        const assignments = normalizeScoreArrayAssignments(this._creatorState[stateKey], keys, values);
        const sourceValue = assignments[payload.key];
        assignments[payload.key] = assignments[targetKey];
        assignments[targetKey] = sourceValue;
        this._creatorState[stateKey] = assignments;
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='supportingDepartment']")?.addEventListener("change", event => {
      this._creatorState.supportingDepartment = DISCIPLINE_KEYS.includes(event.target.value) ? event.target.value : "";
      this._creatorState.supportingFocusUuids = ["", "", "", ""];
      this._creatorState.supportingCustomFocusNames = ["", "", "", ""];
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='supportingAttributeAssignment']").forEach(select => {
      select.addEventListener("change", event => {
        const key = event.target.dataset.attribute;
        if (!ATTRIBUTE_KEYS.includes(key)) return;
        this._creatorState.supportingAttributeAssignments = {
          ...this._creatorState.supportingAttributeAssignments,
          [key]: Number(event.target.value),
        };
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='supportingDepartmentAssignment']").forEach(select => {
      select.addEventListener("change", event => {
        const key = event.target.dataset.department;
        if (!DISCIPLINE_KEYS.includes(key)) return;
        this._creatorState.supportingDepartmentAssignments = {
          ...this._creatorState.supportingDepartmentAssignments,
          [key]: Number(event.target.value),
        };
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='supportingTrait']")?.addEventListener("change", event => {
      this._creatorState.supportingTraitUuid = event.target.value;
      this._creatorState.supportingCustomTraitName = "";
      this._creatorState.supportingCustomTraitDescription = "";
      this.render({ force: true });
    });

    const syncSupportingTrait = () => {
      this._creatorState.supportingCustomTraitName = el.querySelector("[data-field='supportingCustomTraitName']")?.value ?? "";
      this._creatorState.supportingCustomTraitDescription = el.querySelector("[data-field='supportingCustomTraitDescription']")?.value ?? "";
      if (this._creatorState.supportingCustomTraitName.trim() || this._creatorState.supportingCustomTraitDescription.trim()) {
        this._creatorState.supportingTraitUuid = "";
      }
    };
    el.querySelector("[data-field='supportingCustomTraitName']")?.addEventListener("input", syncSupportingTrait);
    el.querySelector("[data-field='supportingCustomTraitName']")?.addEventListener("change", () => {
      syncSupportingTrait();
      this.render({ force: true });
    });
    el.querySelector("[data-field='supportingCustomTraitDescription']")?.addEventListener("input", syncSupportingTrait);
    el.querySelector("[data-field='supportingCustomTraitDescription']")?.addEventListener("change", () => {
      syncSupportingTrait();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='supportingFocus']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.supportingFocusUuids[index] = event.target.value;
        this._creatorState.supportingCustomFocusNames[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='supportingCustomFocusName']").forEach(input => {
      input.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.supportingCustomFocusNames[index] = event.target.value;
        if (event.target.value.trim()) this._creatorState.supportingFocusUuids[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='supportingValue']")?.addEventListener("change", event => {
      this._creatorState.supportingValueUuid = event.target.value;
      this._creatorState.supportingCustomValueName = "";
      this._creatorState.supportingCustomValueDescription = "";
      this.render({ force: true });
    });

    const syncSupportingValue = () => {
      this._creatorState.supportingCustomValueName = el.querySelector("[data-field='supportingCustomValueName']")?.value ?? "";
      this._creatorState.supportingCustomValueDescription = el.querySelector("[data-field='supportingCustomValueDescription']")?.value ?? "";
      if (this._creatorState.supportingCustomValueName.trim() || this._creatorState.supportingCustomValueDescription.trim()) this._creatorState.supportingValueUuid = "";
    };
    el.querySelector("[data-field='supportingCustomValueName']")?.addEventListener("input", syncSupportingValue);
    el.querySelector("[data-field='supportingCustomValueName']")?.addEventListener("change", () => {
      syncSupportingValue();
      this.render({ force: true });
    });
    el.querySelector("[data-field='supportingCustomValueDescription']")?.addEventListener("input", syncSupportingValue);
    el.querySelector("[data-field='supportingCustomValueDescription']")?.addEventListener("change", () => {
      syncSupportingValue();
      this.render({ force: true });
    });

    el.querySelector("[data-field='npcRoleTrait']")?.addEventListener("change", event => {
      this._creatorState.npcRoleTraitUuid = event.target.value;
      this._creatorState.npcCustomRoleTraitName = "";
      this._creatorState.npcCustomRoleTraitDescription = "";
      this.render({ force: true });
    });

    const syncNpcRoleTrait = () => {
      this._creatorState.npcCustomRoleTraitName = el.querySelector("[data-field='npcCustomRoleTraitName']")?.value ?? "";
      this._creatorState.npcCustomRoleTraitDescription = el.querySelector("[data-field='npcCustomRoleTraitDescription']")?.value ?? "";
      if (this._creatorState.npcCustomRoleTraitName.trim() || this._creatorState.npcCustomRoleTraitDescription.trim()) {
        this._creatorState.npcRoleTraitUuid = "";
      }
    };
    el.querySelector("[data-field='npcCustomRoleTraitName']")?.addEventListener("input", syncNpcRoleTrait);
    el.querySelector("[data-field='npcCustomRoleTraitName']")?.addEventListener("change", () => {
      syncNpcRoleTrait();
      this.render({ force: true });
    });
    el.querySelector("[data-field='npcCustomRoleTraitDescription']")?.addEventListener("input", syncNpcRoleTrait);
    el.querySelector("[data-field='npcCustomRoleTraitDescription']")?.addEventListener("change", () => {
      syncNpcRoleTrait();
      this.render({ force: true });
    });

    el.querySelector("[data-field='npcExtraTrait']")?.addEventListener("change", event => {
      this._creatorState.npcExtraTraitUuid = event.target.value;
      this._creatorState.npcCustomExtraTraitName = "";
      this._creatorState.npcCustomExtraTraitDescription = "";
      this.render({ force: true });
    });

    const syncNpcExtraTrait = () => {
      this._creatorState.npcCustomExtraTraitName = el.querySelector("[data-field='npcCustomExtraTraitName']")?.value ?? "";
      this._creatorState.npcCustomExtraTraitDescription = el.querySelector("[data-field='npcCustomExtraTraitDescription']")?.value ?? "";
      if (this._creatorState.npcCustomExtraTraitName.trim() || this._creatorState.npcCustomExtraTraitDescription.trim()) {
        this._creatorState.npcExtraTraitUuid = "";
      }
    };
    el.querySelector("[data-field='npcCustomExtraTraitName']")?.addEventListener("input", syncNpcExtraTrait);
    el.querySelector("[data-field='npcCustomExtraTraitName']")?.addEventListener("change", () => {
      syncNpcExtraTrait();
      this.render({ force: true });
    });
    el.querySelector("[data-field='npcCustomExtraTraitDescription']")?.addEventListener("input", syncNpcExtraTrait);
    el.querySelector("[data-field='npcCustomExtraTraitDescription']")?.addEventListener("change", () => {
      syncNpcExtraTrait();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='npcValue']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.npcValueUuids[index] = event.target.value;
        this._creatorState.npcCustomValueNames[index] = "";
        this._creatorState.npcCustomValueDescriptions[index] = "";
        if (Array.isArray(this._creatorState.npcValueEditFlags)) this._creatorState.npcValueEditFlags[index] = false;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("input[data-field='npcCustomValueName']").forEach(input => {
      input.addEventListener("input", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.npcCustomValueNames[index] = event.target.value;
        const editing = !!this._creatorState.npcValueEditFlags?.[index];
        if (!editing && (event.target.value.trim() || (this._creatorState.npcCustomValueDescriptions[index] ?? "").trim())) this._creatorState.npcValueUuids[index] = "";
      });
      input.addEventListener("change", () => this.render({ force: true }));
    });
    el.querySelectorAll("prose-mirror[data-field='npcCustomValueDescription']").forEach(editor => {
      const sync = () => {
        const index = Number(editor.dataset.index);
        if (!Number.isInteger(index)) return;
        const value = editor.value ?? "";
        this._creatorState.npcCustomValueDescriptions[index] = value;
        const editing = !!this._creatorState.npcValueEditFlags?.[index];
        if (!editing && ((this._creatorState.npcCustomValueNames[index] ?? "").trim() || value.trim())) this._creatorState.npcValueUuids[index] = "";
      };
      editor.addEventListener("change", sync);
      editor.addEventListener("input", sync);
    });

    el.querySelectorAll("[data-field='npcFocus']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.npcFocusUuids[index] = event.target.value;
        this._creatorState.npcCustomFocusNames[index] = "";
        this._creatorState.npcCustomFocusDescriptions[index] = "";
        if (Array.isArray(this._creatorState.npcFocusEditFlags)) this._creatorState.npcFocusEditFlags[index] = false;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("input[data-field='npcCustomFocusName']").forEach(input => {
      input.addEventListener("input", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.npcCustomFocusNames[index] = event.target.value;
        const editing = !!this._creatorState.npcFocusEditFlags?.[index];
        if (!editing && (event.target.value.trim() || (this._creatorState.npcCustomFocusDescriptions[index] ?? "").trim())) this._creatorState.npcFocusUuids[index] = "";
      });
      input.addEventListener("change", () => this.render({ force: true }));
    });
    el.querySelectorAll("prose-mirror[data-field='npcCustomFocusDescription']").forEach(editor => {
      const sync = () => {
        const index = Number(editor.dataset.index);
        if (!Number.isInteger(index)) return;
        const value = editor.value ?? "";
        this._creatorState.npcCustomFocusDescriptions[index] = value;
        const editing = !!this._creatorState.npcFocusEditFlags?.[index];
        if (!editing && ((this._creatorState.npcCustomFocusNames[index] ?? "").trim() || value.trim())) this._creatorState.npcFocusUuids[index] = "";
      };
      editor.addEventListener("change", sync);
      editor.addEventListener("input", sync);
    });

    el.querySelectorAll("[data-field='npcTalent']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.npcTalentUuids[index] = event.target.value;
        this._creatorState.npcCustomTalentNames[index] = "";
        this._creatorState.npcCustomTalentDescriptions[index] = "";
        if (Array.isArray(this._creatorState.npcTalentEditFlags)) this._creatorState.npcTalentEditFlags[index] = false;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("input[data-field='npcCustomTalentName']").forEach(input => {
      input.addEventListener("input", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.npcCustomTalentNames[index] = event.target.value;
        const editing = !!this._creatorState.npcTalentEditFlags?.[index];
        if (!editing && (event.target.value.trim() || (this._creatorState.npcCustomTalentDescriptions[index] ?? "").trim())) this._creatorState.npcTalentUuids[index] = "";
      });
      input.addEventListener("change", () => this.render({ force: true }));
    });
    el.querySelectorAll("prose-mirror[data-field='npcCustomTalentDescription']").forEach(editor => {
      const sync = () => {
        const index = Number(editor.dataset.index);
        if (!Number.isInteger(index)) return;
        const value = editor.value ?? "";
        this._creatorState.npcCustomTalentDescriptions[index] = value;
        const editing = !!this._creatorState.npcTalentEditFlags?.[index];
        if (!editing && ((this._creatorState.npcCustomTalentNames[index] ?? "").trim() || value.trim())) this._creatorState.npcTalentUuids[index] = "";
      };
      editor.addEventListener("change", sync);
      editor.addEventListener("input", sync);
    });

    el.querySelectorAll("[data-field='npcEquipment']").forEach(input => {
      input.addEventListener("change", () => {
        this._creatorState.npcEquipmentUuids = Array.from(el.querySelectorAll("[data-field='npcEquipment']:checked"))
          .map(choice => choice.value);
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='npcNotes']")?.addEventListener("input", event => {
      this._creatorState.npcNotes = event.target.value;
    });

    const applySpeciesFilter = input => {
      const panel = input.closest(".sta2e-cc-species-list-panel");
      const query = input.value.trim().toLocaleLowerCase(game.i18n.lang);
      const terms = query.split(/\s+/).filter(Boolean);
      let visibleCount = 0;
      panel?.querySelectorAll("[data-species-card]").forEach(card => {
        const text = String(card.dataset.speciesName ?? "").toLocaleLowerCase(game.i18n.lang);
        const visible = terms.every(term => text.includes(term));
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      const empty = panel?.querySelector("[data-species-filter-empty]");
      if (empty) empty.hidden = visibleCount > 0;
    };

    el.querySelectorAll("[data-species-filter]").forEach(input => {
      input.value = this._creatorState.speciesSearch ?? "";
      applySpeciesFilter(input);
      input.addEventListener("input", event => {
        this._creatorState.speciesSearch = event.target.value;
        el.querySelectorAll("[data-species-filter]").forEach(otherInput => {
          if (otherInput !== event.target) otherInput.value = event.target.value;
          applySpeciesFilter(otherInput);
        });
      });
    });

    el.querySelectorAll("[data-field='primarySpecies']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.primarySpeciesId = event.target.value;
        this._creatorState.selectedFreeAttributes = [];
        this._creatorState.selectedSpeciesAttributeChoice = "";
        this._creatorState.selectedSpeciesEsotericTalentUuid = "";
        this._creatorState.selectedSpeciesEsotericTalentUuids = [];
        this._creatorState.selectedBorgImplantUuids = [];
        this._creatorState.selectedHumanAugmentTalentUuids = [];
        this._creatorState.humanAugmentFlawTraitUuid = "";
        this._creatorState.humanAugmentCustomFlawTraitName = "";
        this._creatorState.humanAugmentCustomFlawTraitDescription = "";
        this._creatorState.speciesFocusUuids = ["", "", "", "", "", ""];
        this._creatorState.speciesCustomFocusNames = ["", "", "", "", "", ""];
        this._creatorState.jemHadarHatcheryKey = "gamma";
        this._creatorState.jemHadarHatcheryValueUuid = "";
        this._creatorState.jemHadarHatcheryCustomValueName = "";
        this._creatorState.jemHadarHatcheryCustomValueDescription = "";
        this._creatorState.jemHadarHatcheryAttribute = "";
        this._creatorState.jemHadarHatcheryDepartment = "";
        this._creatorState.jemHadarHatcheryFocusUuid = "";
        this._creatorState.jemHadarHatcheryCustomFocusName = "";
        this._creatorState.jemHadarHatcheryCustomFocusDescription = "";
        this._creatorState.jemHadarHatcheryTalentUuid = "";
        this._creatorState.vortaCloningValueUuid = "";
        this._creatorState.vortaCloningCustomValueName = "";
        this._creatorState.vortaCloningCustomValueDescription = "";
        this._creatorState.vortaCloningAttributes = [];
        this._creatorState.vortaCloningAttributeChoice = "";
        this._creatorState.vortaCloningPrimaryDepartment = "";
        this._creatorState.vortaCloningSecondaryDepartment = "";
        this._creatorState.vortaCloningFocusUuid = "";
        this._creatorState.vortaCloningCustomFocusName = "";
        this._creatorState.vortaCloningCustomFocusDescription = "";
        if (this._creatorState.secondarySpeciesId === this._creatorState.primarySpeciesId) this._creatorState.secondarySpeciesId = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='mixedSpecies']")?.addEventListener("change", event => {
      this._creatorState.mixedSpecies = event.target.checked;
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='secondarySpecies']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.secondarySpeciesId = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='speciesEsotericTalent']").forEach(input => {
      input.addEventListener("change", event => {
        const index = Number(event.target.dataset.index ?? 0);
        const selected = [...normalizeUuidList(this._creatorState.selectedSpeciesEsotericTalentUuids)];
        selected[index] = event.target.value;
        const duplicateIndex = selected.findIndex((uuid, otherIndex) => uuid && uuid === event.target.value && otherIndex !== index);
        if (duplicateIndex >= 0) selected[duplicateIndex] = "";
        this._creatorState.selectedSpeciesEsotericTalentUuids = selected;
        this._creatorState.selectedSpeciesEsotericTalentUuid = selected[0] ?? "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='borgImplant']").forEach(input => {
      input.addEventListener("change", event => {
        const uuid = event.target.value;
        const selected = new Set(uniqueUuidList(this._creatorState.selectedBorgImplantUuids));
        if (event.target.checked) {
          if (selected.size >= 3) {
            event.target.checked = false;
            ui.notifications.warn("STA2e Toolkit: Liberated Borg may select up to three Borg implants.");
            return;
          }
          selected.add(uuid);
        } else {
          selected.delete(uuid);
        }
        this._creatorState.selectedBorgImplantUuids = Array.from(selected).slice(0, 3);
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='humanAugmentTalent']").forEach(input => {
      input.addEventListener("change", event => {
        const uuid = event.target.value;
        const selected = new Set(uniqueUuidList(this._creatorState.selectedHumanAugmentTalentUuids));
        if (event.target.checked) {
          if (selected.size >= 2) {
            event.target.checked = false;
            ui.notifications.warn("STA2e Toolkit: Human Augment may select up to two Augment talents.");
            return;
          }
          selected.add(uuid);
        } else {
          selected.delete(uuid);
        }
        this._creatorState.selectedHumanAugmentTalentUuids = Array.from(selected).slice(0, 2);
        if (this._creatorState.selectedHumanAugmentTalentUuids.length < 2) {
          this._creatorState.humanAugmentFlawTraitUuid = "";
          this._creatorState.humanAugmentCustomFlawTraitName = "";
          this._creatorState.humanAugmentCustomFlawTraitDescription = "";
        }
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='humanAugmentFlawTrait']")?.addEventListener("change", event => {
      this._creatorState.humanAugmentFlawTraitUuid = event.target.value;
      if (event.target.value) {
        this._creatorState.humanAugmentCustomFlawTraitName = "";
        this._creatorState.humanAugmentCustomFlawTraitDescription = "";
      }
      this.render({ force: true });
    });

    el.querySelector("[data-field='humanAugmentCustomFlawTraitName']")?.addEventListener("change", event => {
      this._creatorState.humanAugmentCustomFlawTraitName = event.target.value;
      if (event.target.value.trim()) this._creatorState.humanAugmentFlawTraitUuid = "";
      this.render({ force: true });
    });

    el.querySelector("[data-field='humanAugmentCustomFlawTraitDescription']")?.addEventListener("change", event => {
      this._creatorState.humanAugmentCustomFlawTraitDescription = event.target.value;
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='speciesFocus']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.speciesFocusUuids[index] = event.target.value;
        this._creatorState.speciesCustomFocusNames[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='speciesCustomFocusName']").forEach(input => {
      input.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.speciesCustomFocusNames[index] = event.target.value;
        if (event.target.value.trim()) this._creatorState.speciesFocusUuids[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='environment']")?.addEventListener("change", event => {
      this._creatorState.environmentId = event.target.value;
      this._creatorState.environmentValueUuid = "";
      this._creatorState.environmentCustomValueName = "";
      this._creatorState.environmentCustomValueDescription = "";
      this._creatorState.environmentAttribute = "";
      this._creatorState.environmentAttributeSpeciesId = "";
      this._creatorState.environmentDepartment = "";
      this.render({ force: true });
    });

    el.querySelector("[data-field='environmentValue']")?.addEventListener("change", event => {
      this._creatorState.environmentValueUuid = event.target.value;
      this._creatorState.environmentCustomValueName = "";
      this._creatorState.environmentCustomValueDescription = "";
      this.render({ force: true });
    });

    const syncCustomValue = () => {
      this._creatorState.environmentCustomValueName = el.querySelector("[data-field='environmentCustomValueName']")?.value ?? "";
      this._creatorState.environmentCustomValueDescription = el.querySelector("[data-field='environmentCustomValueDescription']")?.value ?? "";
      if (this._creatorState.environmentCustomValueName.trim() || this._creatorState.environmentCustomValueDescription.trim()) {
        this._creatorState.environmentValueUuid = "";
      }
    };

    el.querySelector("[data-field='environmentCustomValueName']")?.addEventListener("input", syncCustomValue);
    el.querySelector("[data-field='environmentCustomValueName']")?.addEventListener("change", () => {
      syncCustomValue();
      this.render({ force: true });
    });
    el.querySelector("[data-field='environmentCustomValueDescription']")?.addEventListener("input", syncCustomValue);
    el.querySelector("[data-field='environmentCustomValueDescription']")?.addEventListener("change", () => {
      syncCustomValue();
      this.render({ force: true });
    });

    el.querySelector("[data-field='environmentAttributeSpecies']")?.addEventListener("change", event => {
      this._creatorState.environmentAttributeSpeciesId = event.target.value;
      this._creatorState.environmentAttribute = "";
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='environmentAttribute']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.environmentAttribute = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='environmentDepartment']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.environmentDepartment = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='jemHadarHatchery']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.jemHadarHatcheryKey = event.target.value;
        this._creatorState.jemHadarHatcheryAttribute = "";
        this._creatorState.jemHadarHatcheryDepartment = "";
        this._creatorState.jemHadarHatcheryFocusUuid = "";
        this._creatorState.jemHadarHatcheryCustomFocusName = "";
        this._creatorState.jemHadarHatcheryCustomFocusDescription = "";
        this._creatorState.jemHadarHatcheryTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='jemHadarHatcheryValue']")?.addEventListener("change", event => {
      this._creatorState.jemHadarHatcheryValueUuid = event.target.value;
      this._creatorState.jemHadarHatcheryCustomValueName = "";
      this._creatorState.jemHadarHatcheryCustomValueDescription = "";
      this.render({ force: true });
    });

    const syncJemHadarHatcheryValue = () => {
      this._creatorState.jemHadarHatcheryCustomValueName = el.querySelector("[data-field='jemHadarHatcheryCustomValueName']")?.value ?? "";
      this._creatorState.jemHadarHatcheryCustomValueDescription = el.querySelector("[data-field='jemHadarHatcheryCustomValueDescription']")?.value ?? "";
      if (this._creatorState.jemHadarHatcheryCustomValueName.trim() || this._creatorState.jemHadarHatcheryCustomValueDescription.trim()) {
        this._creatorState.jemHadarHatcheryValueUuid = "";
      }
    };

    el.querySelector("[data-field='jemHadarHatcheryCustomValueName']")?.addEventListener("input", syncJemHadarHatcheryValue);
    el.querySelector("[data-field='jemHadarHatcheryCustomValueName']")?.addEventListener("change", () => {
      syncJemHadarHatcheryValue();
      this.render({ force: true });
    });
    el.querySelector("[data-field='jemHadarHatcheryCustomValueDescription']")?.addEventListener("input", syncJemHadarHatcheryValue);
    el.querySelector("[data-field='jemHadarHatcheryCustomValueDescription']")?.addEventListener("change", () => {
      syncJemHadarHatcheryValue();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='jemHadarHatcheryAttribute']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.jemHadarHatcheryAttribute = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='jemHadarHatcheryDepartment']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.jemHadarHatcheryDepartment = event.target.value;
        this._creatorState.jemHadarHatcheryTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='jemHadarHatcheryFocus']")?.addEventListener("change", event => {
      this._creatorState.jemHadarHatcheryFocusUuid = event.target.value;
      this._creatorState.jemHadarHatcheryCustomFocusName = "";
      this._creatorState.jemHadarHatcheryCustomFocusDescription = "";
      this.render({ force: true });
    });

    const syncJemHadarHatcheryFocus = () => {
      this._creatorState.jemHadarHatcheryCustomFocusName = el.querySelector("[data-field='jemHadarHatcheryCustomFocusName']")?.value ?? "";
      this._creatorState.jemHadarHatcheryCustomFocusDescription = el.querySelector("[data-field='jemHadarHatcheryCustomFocusDescription']")?.value ?? "";
      if (this._creatorState.jemHadarHatcheryCustomFocusName.trim() || this._creatorState.jemHadarHatcheryCustomFocusDescription.trim()) {
        this._creatorState.jemHadarHatcheryFocusUuid = "";
      }
    };

    el.querySelector("[data-field='jemHadarHatcheryCustomFocusName']")?.addEventListener("input", syncJemHadarHatcheryFocus);
    el.querySelector("[data-field='jemHadarHatcheryCustomFocusName']")?.addEventListener("change", () => {
      syncJemHadarHatcheryFocus();
      this.render({ force: true });
    });
    el.querySelector("[data-field='jemHadarHatcheryCustomFocusDescription']")?.addEventListener("input", syncJemHadarHatcheryFocus);
    el.querySelector("[data-field='jemHadarHatcheryCustomFocusDescription']")?.addEventListener("change", () => {
      syncJemHadarHatcheryFocus();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='jemHadarHatcheryTalent']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.jemHadarHatcheryTalentUuid = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='vortaCloningValue']")?.addEventListener("change", event => {
      this._creatorState.vortaCloningValueUuid = event.target.value;
      this._creatorState.vortaCloningCustomValueName = "";
      this._creatorState.vortaCloningCustomValueDescription = "";
      this.render({ force: true });
    });

    const syncVortaCloningValue = () => {
      this._creatorState.vortaCloningCustomValueName = el.querySelector("[data-field='vortaCloningCustomValueName']")?.value ?? "";
      this._creatorState.vortaCloningCustomValueDescription = el.querySelector("[data-field='vortaCloningCustomValueDescription']")?.value ?? "";
      if (this._creatorState.vortaCloningCustomValueName.trim() || this._creatorState.vortaCloningCustomValueDescription.trim()) {
        this._creatorState.vortaCloningValueUuid = "";
      }
    };
    el.querySelector("[data-field='vortaCloningCustomValueName']")?.addEventListener("input", syncVortaCloningValue);
    el.querySelector("[data-field='vortaCloningCustomValueName']")?.addEventListener("change", () => {
      syncVortaCloningValue();
      this.render({ force: true });
    });
    el.querySelector("[data-field='vortaCloningCustomValueDescription']")?.addEventListener("input", syncVortaCloningValue);
    el.querySelector("[data-field='vortaCloningCustomValueDescription']")?.addEventListener("change", () => {
      syncVortaCloningValue();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='vortaCloningAttribute']").forEach(input => {
      input.addEventListener("change", () => {
        const selected = Array.from(el.querySelectorAll("[data-field='vortaCloningAttribute']:checked"))
          .map(choice => choice.value)
          .slice(0, 3);
        this._creatorState.vortaCloningAttributes = selected;
        if (!selected.includes(this._creatorState.vortaCloningAttributeChoice)) this._creatorState.vortaCloningAttributeChoice = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='vortaCloningAttributeChoice']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.vortaCloningAttributeChoice = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='vortaCloningPrimaryDepartment']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.vortaCloningPrimaryDepartment = event.target.value;
        if (this._creatorState.vortaCloningSecondaryDepartment === event.target.value) this._creatorState.vortaCloningSecondaryDepartment = "";
        this._creatorState.vortaCloningFocusUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='vortaCloningSecondaryDepartment']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.vortaCloningSecondaryDepartment = event.target.value;
        this._creatorState.vortaCloningFocusUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='vortaCloningFocus']")?.addEventListener("change", event => {
      this._creatorState.vortaCloningFocusUuid = event.target.value;
      this._creatorState.vortaCloningCustomFocusName = "";
      this._creatorState.vortaCloningCustomFocusDescription = "";
      this.render({ force: true });
    });

    const syncVortaCloningFocus = () => {
      this._creatorState.vortaCloningCustomFocusName = el.querySelector("[data-field='vortaCloningCustomFocusName']")?.value ?? "";
      this._creatorState.vortaCloningCustomFocusDescription = el.querySelector("[data-field='vortaCloningCustomFocusDescription']")?.value ?? "";
      if (this._creatorState.vortaCloningCustomFocusName.trim() || this._creatorState.vortaCloningCustomFocusDescription.trim()) {
        this._creatorState.vortaCloningFocusUuid = "";
      }
    };
    el.querySelector("[data-field='vortaCloningCustomFocusName']")?.addEventListener("input", syncVortaCloningFocus);
    el.querySelector("[data-field='vortaCloningCustomFocusName']")?.addEventListener("change", () => {
      syncVortaCloningFocus();
      this.render({ force: true });
    });
    el.querySelector("[data-field='vortaCloningCustomFocusDescription']")?.addEventListener("input", syncVortaCloningFocus);
    el.querySelector("[data-field='vortaCloningCustomFocusDescription']")?.addEventListener("change", () => {
      syncVortaCloningFocus();
      this.render({ force: true });
    });

    el.querySelector("[data-field='upbringing']")?.addEventListener("change", event => {
      this._creatorState.upbringingId = event.target.value;
      this._creatorState.upbringingDepartment = "";
      this._creatorState.upbringingFocusUuid = "";
      this._creatorState.upbringingCustomFocusName = "";
      this._creatorState.upbringingCustomFocusDescription = "";
      this._creatorState.upbringingTalentUuid = "";
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='upbringingPath']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.upbringingPath = event.target.value === "rebelled" ? "rebelled" : "accepted";
        this._creatorState.upbringingTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='upbringingDepartment']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.upbringingDepartment = event.target.value;
        this._creatorState.upbringingTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='upbringingFocus']")?.addEventListener("change", event => {
      this._creatorState.upbringingFocusUuid = event.target.value;
      this._creatorState.upbringingCustomFocusName = "";
      this._creatorState.upbringingCustomFocusDescription = "";
      this.render({ force: true });
    });

    const syncCustomFocus = () => {
      this._creatorState.upbringingCustomFocusName = el.querySelector("[data-field='upbringingCustomFocusName']")?.value ?? "";
      this._creatorState.upbringingCustomFocusDescription = el.querySelector("[data-field='upbringingCustomFocusDescription']")?.value ?? "";
      if (this._creatorState.upbringingCustomFocusName.trim() || this._creatorState.upbringingCustomFocusDescription.trim()) {
        this._creatorState.upbringingFocusUuid = "";
      }
    };

    el.querySelector("[data-field='upbringingCustomFocusName']")?.addEventListener("input", syncCustomFocus);
    el.querySelector("[data-field='upbringingCustomFocusName']")?.addEventListener("change", () => {
      syncCustomFocus();
      this.render({ force: true });
    });
    el.querySelector("[data-field='upbringingCustomFocusDescription']")?.addEventListener("input", syncCustomFocus);
    el.querySelector("[data-field='upbringingCustomFocusDescription']")?.addEventListener("change", () => {
      syncCustomFocus();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='upbringingTalent']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.upbringingTalentUuid = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='gmAllowEsotericTalents']")?.addEventListener("change", event => {
      this._creatorState.gmAllowEsotericTalents = event.target.checked;
      this._creatorState.jemHadarHatcheryTalentUuid = "";
      this._creatorState.upbringingTalentUuid = "";
      this._creatorState.careerTalentUuid = "";
      this._creatorState.experienceTalentUuid = "";
      this.render({ force: true });
    });

    el.querySelector("[data-field='careerPath']")?.addEventListener("change", event => {
      this._creatorState.careerPathId = event.target.value;
      this._creatorState.careerTraitUuid = "";
      this._creatorState.careerCustomTraitName = "";
      this._creatorState.careerCustomTraitDescription = "";
      this._creatorState.careerValueUuid = "";
      this._creatorState.careerCustomValueName = "";
      this._creatorState.careerCustomValueDescription = "";
      this._creatorState.careerAttributeSpends = {};
      this._creatorState.careerDepartmentPlusTwo = "";
      this._creatorState.careerDepartmentPlusOne = [];
      this._creatorState.careerDepartmentReallocationFrom = "";
      this._creatorState.careerDepartmentReallocationTo = "";
      this._creatorState.careerFocusUuids = ["", "", ""];
      this._creatorState.careerCustomFocusNames = ["", "", ""];
      this._creatorState.careerTalentUuid = "";
      this._creatorState.experienceTalentUuid = "";
      this.render({ force: true });
    });

    el.querySelector("[data-field='careerTrait']")?.addEventListener("change", event => {
      this._creatorState.careerTraitUuid = event.target.value;
      this._creatorState.careerCustomTraitName = "";
      this._creatorState.careerCustomTraitDescription = "";
      this.render({ force: true });
    });

    const syncCareerTrait = () => {
      this._creatorState.careerCustomTraitName = el.querySelector("[data-field='careerCustomTraitName']")?.value ?? "";
      this._creatorState.careerCustomTraitDescription = el.querySelector("[data-field='careerCustomTraitDescription']")?.value ?? "";
      if (this._creatorState.careerCustomTraitName.trim() || this._creatorState.careerCustomTraitDescription.trim()) {
        this._creatorState.careerTraitUuid = "";
      }
    };
    el.querySelector("[data-field='careerCustomTraitName']")?.addEventListener("input", syncCareerTrait);
    el.querySelector("[data-field='careerCustomTraitName']")?.addEventListener("change", () => {
      syncCareerTrait();
      this.render({ force: true });
    });
    el.querySelector("[data-field='careerCustomTraitDescription']")?.addEventListener("input", syncCareerTrait);
    el.querySelector("[data-field='careerCustomTraitDescription']")?.addEventListener("change", () => {
      syncCareerTrait();
      this.render({ force: true });
    });

    el.querySelector("[data-field='careerValue']")?.addEventListener("change", event => {
      this._creatorState.careerValueUuid = event.target.value;
      this._creatorState.careerCustomValueName = "";
      this._creatorState.careerCustomValueDescription = "";
      this.render({ force: true });
    });

    const syncCareerValue = () => {
      this._creatorState.careerCustomValueName = el.querySelector("[data-field='careerCustomValueName']")?.value ?? "";
      this._creatorState.careerCustomValueDescription = el.querySelector("[data-field='careerCustomValueDescription']")?.value ?? "";
      if (this._creatorState.careerCustomValueName.trim() || this._creatorState.careerCustomValueDescription.trim()) this._creatorState.careerValueUuid = "";
    };
    el.querySelector("[data-field='careerCustomValueName']")?.addEventListener("input", syncCareerValue);
    el.querySelector("[data-field='careerCustomValueName']")?.addEventListener("change", () => {
      syncCareerValue();
      this.render({ force: true });
    });
    el.querySelector("[data-field='careerCustomValueDescription']")?.addEventListener("input", syncCareerValue);
    el.querySelector("[data-field='careerCustomValueDescription']")?.addEventListener("change", () => {
      syncCareerValue();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='careerAttributeSpend']").forEach(input => {
      input.addEventListener("change", event => {
        const key = event.target.dataset.attribute;
        const spends = normalizeCareerAttributeSpends(this._creatorState.careerAttributeSpends);
        const previous = spends[key] ?? 0;
        spends[key] = Math.max(0, Math.min(2, Number(event.target.value ?? 0) || 0));
        const excess = careerAttributeSpendTotal(spends) - 3;
        if (excess > 0) spends[key] = Math.max(0, spends[key] - excess);
        if ((spends[key] ?? 0) === 0) delete spends[key];
        this._creatorState.careerAttributeSpends = spends;
        if (previous !== spends[key]) this._creatorState.careerTalentUuid = "";
        if (previous !== spends[key]) this._creatorState.experienceTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-career-attribute-step]").forEach(button => {
      button.addEventListener("click", event => {
        const key = event.currentTarget.dataset.attribute;
        const delta = Number(event.currentTarget.dataset.delta ?? 0) || 0;
        const spends = normalizeCareerAttributeSpends(this._creatorState.careerAttributeSpends);
        const previous = spends[key] ?? 0;
        let next = Math.max(0, Math.min(2, previous + delta));
        if (delta > 0 && careerAttributeSpendTotal(spends) >= 3) next = previous;
        if (next) spends[key] = next;
        else delete spends[key];
        this._creatorState.careerAttributeSpends = spends;
        if (previous !== next) this._creatorState.careerTalentUuid = "";
        if (previous !== next) this._creatorState.experienceTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerDepartmentPlusTwo']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.careerDepartmentPlusTwo = event.target.value;
        this._creatorState.careerDepartmentPlusOne = (this._creatorState.careerDepartmentPlusOne ?? [])
          .filter(key => key !== this._creatorState.careerDepartmentPlusTwo);
        this._creatorState.careerDepartmentReallocationFrom = "";
        this._creatorState.careerDepartmentReallocationTo = "";
        this._creatorState.careerTalentUuid = "";
        this._creatorState.experienceTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerDepartmentPlusOne']").forEach(input => {
      input.addEventListener("change", () => {
        this._creatorState.careerDepartmentPlusOne = Array.from(el.querySelectorAll("[data-field='careerDepartmentPlusOne']:checked"))
          .map(choice => choice.value)
          .filter(key => key !== this._creatorState.careerDepartmentPlusTwo)
          .slice(0, 2);
        this._creatorState.careerDepartmentReallocationFrom = "";
        this._creatorState.careerDepartmentReallocationTo = "";
        this._creatorState.careerTalentUuid = "";
        this._creatorState.experienceTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='careerDepartmentReallocationFrom']")?.addEventListener("change", event => {
      this._creatorState.careerDepartmentReallocationFrom = event.target.value;
      this._creatorState.careerDepartmentReallocationTo = "";
      this._creatorState.careerTalentUuid = "";
      this._creatorState.experienceTalentUuid = "";
      this.render({ force: true });
    });

    el.querySelector("[data-field='careerDepartmentReallocationTo']")?.addEventListener("change", event => {
      this._creatorState.careerDepartmentReallocationTo = event.target.value;
      this._creatorState.careerTalentUuid = "";
      this._creatorState.experienceTalentUuid = "";
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='careerFocus']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        this._creatorState.careerFocusUuids[index] = event.target.value;
        this._creatorState.careerCustomFocusNames[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerCustomFocusName']").forEach(input => {
      input.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        this._creatorState.careerCustomFocusNames[index] = event.target.value;
        if (event.target.value.trim()) this._creatorState.careerFocusUuids[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='expandedProgrammingFocus']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.expandedProgrammingFocusUuids[index] = event.target.value;
        this._creatorState.expandedProgrammingCustomFocusNames[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='expandedProgrammingCustomFocusName']").forEach(input => {
      input.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        if (!Number.isInteger(index)) return;
        this._creatorState.expandedProgrammingCustomFocusNames[index] = event.target.value;
        if (event.target.value.trim()) this._creatorState.expandedProgrammingFocusUuids[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerTalent']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.careerTalentUuid = event.target.value;
        this._creatorState.experienceTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='experience']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.experienceKey = event.target.value;
        this._creatorState.experienceValueUuid = "";
        this._creatorState.experienceCustomValueName = "";
        this._creatorState.experienceCustomValueDescription = "";
        this._creatorState.experienceTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='experienceValue']")?.addEventListener("change", event => {
      this._creatorState.experienceValueUuid = event.target.value;
      this._creatorState.experienceCustomValueName = "";
      this._creatorState.experienceCustomValueDescription = "";
      this.render({ force: true });
    });

    const syncExperienceValue = () => {
      this._creatorState.experienceCustomValueName = el.querySelector("[data-field='experienceCustomValueName']")?.value ?? "";
      this._creatorState.experienceCustomValueDescription = el.querySelector("[data-field='experienceCustomValueDescription']")?.value ?? "";
      if (this._creatorState.experienceCustomValueName.trim() || this._creatorState.experienceCustomValueDescription.trim()) this._creatorState.experienceValueUuid = "";
    };
    el.querySelector("[data-field='experienceCustomValueName']")?.addEventListener("input", syncExperienceValue);
    el.querySelector("[data-field='experienceCustomValueName']")?.addEventListener("change", () => {
      syncExperienceValue();
      this.render({ force: true });
    });
    el.querySelector("[data-field='experienceCustomValueDescription']")?.addEventListener("input", syncExperienceValue);
    el.querySelector("[data-field='experienceCustomValueDescription']")?.addEventListener("change", () => {
      syncExperienceValue();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='experienceTalent']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.experienceTalentUuid = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerEvent']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        this._creatorState.careerEventIds[index] = event.target.value;
        this._creatorState.careerEventAttributeKeys[index] = "";
        this._creatorState.careerEventDepartmentKeys[index] = "";
        this._creatorState.careerEventFocusUuids[index] = "";
        this._creatorState.careerEventCustomFocusNames[index] = "";
        this._creatorState.careerEventTraitUuids[index] = "";
        this._creatorState.careerEventCustomTraitNames[index] = "";
        this._creatorState.careerEventCustomTraitDescriptions[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerEventAttribute']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        this._creatorState.careerEventAttributeKeys[index] = event.target.value;
        this._creatorState.careerTalentUuid = "";
        this._creatorState.experienceTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerEventDepartment']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        this._creatorState.careerEventDepartmentKeys[index] = event.target.value;
        this._creatorState.careerTalentUuid = "";
        this._creatorState.experienceTalentUuid = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerEventFocus']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        this._creatorState.careerEventFocusUuids[index] = event.target.value;
        this._creatorState.careerEventCustomFocusNames[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerEventCustomFocusName']").forEach(input => {
      input.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        this._creatorState.careerEventCustomFocusNames[index] = event.target.value;
        if (event.target.value.trim()) this._creatorState.careerEventFocusUuids[index] = "";
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='careerEventTrait']").forEach(select => {
      select.addEventListener("change", event => {
        const index = Number(event.target.dataset.index);
        this._creatorState.careerEventTraitUuids[index] = event.target.value;
        this._creatorState.careerEventCustomTraitNames[index] = "";
        this._creatorState.careerEventCustomTraitDescriptions[index] = "";
        this.render({ force: true });
      });
    });

    const syncCareerEventTrait = event => {
      const index = Number(event.target.dataset.index);
      this._creatorState.careerEventCustomTraitNames[index] = el.querySelector(`[data-field='careerEventCustomTraitName'][data-index='${index}']`)?.value ?? "";
      this._creatorState.careerEventCustomTraitDescriptions[index] = el.querySelector(`[data-field='careerEventCustomTraitDescription'][data-index='${index}']`)?.value ?? "";
      if (this._creatorState.careerEventCustomTraitNames[index].trim() || this._creatorState.careerEventCustomTraitDescriptions[index].trim()) {
        this._creatorState.careerEventTraitUuids[index] = "";
      }
    };
    el.querySelectorAll("[data-field='careerEventCustomTraitName'], [data-field='careerEventCustomTraitDescription']").forEach(input => {
      input.addEventListener("input", syncCareerEventTrait);
      input.addEventListener("change", event => {
        syncCareerEventTrait(event);
        this.render({ force: true });
      });
    });

    const adjustScoreSpend = (stateKey, scoreKey, delta, keys, limit) => {
      const perKeyLimit = stateKey.endsWith("Boosts") ? 1 : Infinity;
      const spends = normalizeScoreSpends(this._creatorState[stateKey], keys, limit, perKeyLimit);
      const current = spends[scoreKey] ?? 0;
      const next = Math.max(0, current + delta);
      if (next) spends[scoreKey] = next;
      else delete spends[scoreKey];
      this._creatorState[stateKey] = normalizeScoreSpends(spends, keys, limit, perKeyLimit);
      this._creatorState.finalTalentUuid = "";
      this.render({ force: true });
    };

    el.querySelectorAll("[data-final-score-step]").forEach(button => {
      button.addEventListener("click", event => {
        const kind = event.currentTarget.dataset.kind;
        const mode = event.currentTarget.dataset.mode;
        const key = event.currentTarget.dataset.scoreKey;
        const delta = Number(event.currentTarget.dataset.delta ?? 0) || 0;
        const keys = kind === "attribute" ? ATTRIBUTE_KEYS : DISCIPLINE_KEYS;
        const scoreContext = kind === "attribute" ? context?.finalAttributeContext : context?.finalDepartmentContext;
        const limit = mode === "redistribution" ? scoreContext?.correction?.redistribution ?? 0 : 2;
        const stateKey = kind === "attribute"
          ? mode === "redistribution" ? "finalAttributeRedistribution" : "finalAttributeBoosts"
          : mode === "redistribution" ? "finalDepartmentRedistribution" : "finalDepartmentBoosts";
        adjustScoreSpend(stateKey, key, delta, keys, limit);
      });
    });

    el.querySelector("[data-field='finalValue']")?.addEventListener("change", event => {
      this._creatorState.finalValueUuid = event.target.value;
      this._creatorState.finalCustomValueName = "";
      this._creatorState.finalCustomValueDescription = "";
      this.render({ force: true });
    });

    const syncFinalValue = () => {
      this._creatorState.finalCustomValueName = el.querySelector("[data-field='finalCustomValueName']")?.value ?? "";
      this._creatorState.finalCustomValueDescription = el.querySelector("[data-field='finalCustomValueDescription']")?.value ?? "";
      if (this._creatorState.finalCustomValueName.trim() || this._creatorState.finalCustomValueDescription.trim()) this._creatorState.finalValueUuid = "";
    };
    el.querySelector("[data-field='finalCustomValueName']")?.addEventListener("input", syncFinalValue);
    el.querySelector("[data-field='finalCustomValueName']")?.addEventListener("change", () => {
      syncFinalValue();
      this.render({ force: true });
    });
    el.querySelector("[data-field='finalCustomValueDescription']")?.addEventListener("input", syncFinalValue);
    el.querySelector("[data-field='finalCustomValueDescription']")?.addEventListener("change", () => {
      syncFinalValue();
      this.render({ force: true });
    });

    el.querySelectorAll("[data-field='finalTalent']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.finalTalentUuid = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='role']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.roleUuid = event.target.value;
        this.render({ force: true });
      });
    });

    el.querySelectorAll("[data-field='rankSelect']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.rankId = event.target.value;
        if (event.target.value) this._creatorState.rank = "";
        this.render({ force: true });
      });
    });

    el.querySelector("[data-field='rank']")?.addEventListener("input", event => {
      this._creatorState.rank = event.target.value;
      if (event.target.value.trim()) this._creatorState.rankId = "";
    });

    el.querySelector("[data-field='rank']")?.addEventListener("change", event => {
      this._creatorState.rank = event.target.value;
      if (event.target.value.trim()) this._creatorState.rankId = "";
      this.render({ force: true });
    });

    ["pastime", "assignment", "pronouns"].forEach(field => {
      el.querySelector(`[data-field='${field}']`)?.addEventListener("input", event => {
        this._creatorState[field] = event.target.value;
      });
    });

    el.querySelectorAll("[data-field='freeAttributeChoice']").forEach(input => {
      input.addEventListener("change", () => {
        const selected = Array.from(el.querySelectorAll("[data-field='freeAttributeChoice']:checked"))
          .map(choice => choice.value)
          .slice(0, 3);
        this._creatorState.selectedFreeAttributes = selected;
        if (selected.length >= 3) {
          el.querySelectorAll("[data-field='freeAttributeChoice']:not(:checked)").forEach(choice => {
            choice.disabled = true;
          });
        }
        this.render({ force: true });
      });
    });

    const selectedFreeCount = Array.from(el.querySelectorAll("[data-field='freeAttributeChoice']:checked")).length;
    if (selectedFreeCount >= 3) {
      el.querySelectorAll("[data-field='freeAttributeChoice']:not(:checked)").forEach(input => {
        input.disabled = true;
      });
    }

    el.querySelectorAll("[data-field='speciesAttributeChoice']").forEach(input => {
      input.addEventListener("change", event => {
        this._creatorState.selectedSpeciesAttributeChoice = event.target.value;
        this.render({ force: true });
      });
    });

    this._restoreScrollState();
    finishOpeningLoader(this);
  }

  static _onOpenConfig() {
    new CharacterCreatorConfig().render(true);
  }

  static _onSelectCharacterType(_event, target) {
    const type = target.dataset.characterType;
    if (!Object.prototype.hasOwnProperty.call(CHARACTER_TYPE_DEFINITIONS, type)) return;
    if (NPC_CHARACTER_TYPES.includes(type) && !game.user.isGM) {
      ui.notifications.warn("STA2e Toolkit: Only GMs can create NPCs.");
      return;
    }
    this._creatorState.characterType = type;
    this._creatorState.step = 1;
    if (SUPPORTING_CHARACTER_TYPES.includes(type)) {
      const definition = CHARACTER_TYPE_DEFINITIONS[type];
      this._creatorState.supportingAttributeAssignments = normalizeScoreArrayAssignments({}, ATTRIBUTE_KEYS, definition.attributeArray);
      this._creatorState.supportingDepartmentAssignments = normalizeScoreArrayAssignments({}, DISCIPLINE_KEYS, definition.departmentArray);
      this._creatorState.supportingFocusUuids = ["", "", "", ""];
      this._creatorState.supportingCustomFocusNames = ["", "", "", ""];
      this._activeCreatorTabs.finishing = "details";
    }
    if (NPC_CHARACTER_TYPES.includes(type)) {
      const definition = CHARACTER_TYPE_DEFINITIONS[type];
      this._creatorState.npcAttributeAssignments = normalizeScoreArrayAssignments({}, ATTRIBUTE_KEYS, definition.attributeArray);
      this._creatorState.npcDepartmentAssignments = normalizeScoreArrayAssignments({}, DISCIPLINE_KEYS, definition.departmentArray);
      this._creatorState.npcValueUuids = ["", "", "", ""];
      this._creatorState.npcCustomValueNames = ["", "", "", ""];
      this._creatorState.npcCustomValueDescriptions = ["", "", "", ""];
      this._creatorState.npcValueEditFlags = [false, false, false, false];
      this._creatorState.npcVisibleValueSlots = definition.minValueCount ?? definition.valueCount ?? 0;
      this._creatorState.npcFocusUuids = ["", "", "", "", "", ""];
      this._creatorState.npcCustomFocusNames = ["", "", "", "", "", ""];
      this._creatorState.npcCustomFocusDescriptions = ["", "", "", "", "", ""];
      this._creatorState.npcFocusEditFlags = [false, false, false, false, false, false];
      this._creatorState.npcVisibleFocusSlots = definition.minFocusCount ?? definition.focusCount ?? 0;
      this._creatorState.npcTalentUuids = ["", "", "", ""];
      this._creatorState.npcCustomTalentNames = ["", "", "", ""];
      this._creatorState.npcCustomTalentDescriptions = ["", "", "", ""];
      this._creatorState.npcTalentEditFlags = [false, false, false, false];
      this._creatorState.npcVisibleTalentSlots = definition.minTalentCount ?? definition.talentCount ?? 0;
      this._creatorState.npcEquipmentUuids = [];
    }
    this.render({ force: true });
  }

  async _buildFinalActorItems(context) {
    const items = [];
    const addUuid = async uuid => {
      if (!uuid) return;
      const item = await embeddedItemDataFromUuid(uuid);
      addUniqueItemData(items, item, `uuid:${uuid}`);
    };
    const addTraitUuid = async uuid => {
      if (!uuid) return;
      const item = await embeddedItemDataFromUuid(uuid);
      const key = item?.name ? `trait:${item.name.toLocaleLowerCase(game.i18n.lang)}` : `uuid:${uuid}`;
      addUniqueItemData(items, item, key);
    };

    if (context.isNpcCharacter) {
      for (const item of defaultSupportingUnarmedItems()) addUniqueItemData(items, item);
      for (const uuid of context.selectedSpeciesTraitUuids ?? []) await addTraitUuid(uuid);
      for (const trait of context.traitList ?? []) {
        if (!trait?.name || trait.uuid) continue;
        addUniqueItemData(items, customEmbeddedItemData("trait", trait.name, trait.description ?? ""));
      }
      await addUuid(context.selectedSpeciesAbilityUuid);
      for (const talent of context.selectedSpeciesEsotericTalents ?? []) await addUuid(talent.uuid);
      for (const talent of context.selectedBorgImplants ?? []) await addUuid(talent.uuid);
      for (const talent of context.selectedHumanAugmentTalents ?? []) await addUuid(talent.uuid);
      if (context.selectedHumanAugmentFlawTrait?.uuid) await addTraitUuid(context.selectedHumanAugmentFlawTrait.uuid);
      else if (context.selectedHumanAugmentFlawTrait?.custom) {
        addUniqueItemData(items, customEmbeddedItemData("trait", context.selectedHumanAugmentFlawTrait.name, context.selectedHumanAugmentFlawTrait.description ?? ""));
      }
      if (context.selectedNpcRoleTrait?.uuid) await addTraitUuid(context.selectedNpcRoleTrait.uuid);
      else if (context.selectedNpcRoleTrait?.custom) {
        addUniqueItemData(items, customEmbeddedItemData("trait", context.selectedNpcRoleTrait.name, context.selectedNpcRoleTrait.description ?? ""));
      }
      if (context.selectedNpcExtraTrait?.uuid) await addTraitUuid(context.selectedNpcExtraTrait.uuid);
      else if (context.selectedNpcExtraTrait?.custom) {
        addUniqueItemData(items, customEmbeddedItemData("trait", context.selectedNpcExtraTrait.name, context.selectedNpcExtraTrait.description ?? ""));
      }
      for (const value of context.npcValueSummary ?? []) {
        if (value.uuid) await addUuid(value.uuid);
        else if (value.custom) addUniqueItemData(items, customEmbeddedItemData("value", value.name, value.description ?? ""));
      }
      for (const focus of context.npcFocusSummary ?? []) {
        if (focus.uuid) await addUuid(focus.uuid);
        else if (focus.custom) addUniqueItemData(items, customEmbeddedItemData("focus", focus.name, focus.description ?? ""));
      }
      for (const talent of context.npcTalentSummary ?? []) {
        if (talent.uuid) await addUuid(talent.uuid);
        else if (talent.custom) addUniqueItemData(items, customEmbeddedItemData("talent", talent.name, talent.description ?? ""));
      }
      for (const item of context.selectedNpcEquipment ?? []) await addUuid(item.uuid);
      return stripCreatorItemKeys(removeLowerPhaserTypeItems(items));
    }

    if (context.isSupportingCharacter) {
      for (const item of defaultSupportingUnarmedItems()) addUniqueItemData(items, item);
      const speciesTraitUuids = new Set(context.selectedSpeciesTraitUuids ?? []);
      for (const uuid of speciesTraitUuids) await addTraitUuid(uuid);
      for (const trait of context.traitList ?? []) {
        if (!trait?.name || trait.uuid) continue;
        addUniqueItemData(items, customEmbeddedItemData("trait", trait.name, trait.description ?? ""));
      }
      await addUuid(context.selectedSpeciesAbilityUuid);
      for (const talent of context.selectedSpeciesEsotericTalents ?? []) await addUuid(talent.uuid);
      for (const talent of context.selectedBorgImplants ?? []) await addUuid(talent.uuid);
      for (const talent of context.selectedHumanAugmentTalents ?? []) await addUuid(talent.uuid);
      if (context.selectedHumanAugmentFlawTrait?.uuid) await addTraitUuid(context.selectedHumanAugmentFlawTrait.uuid);
      else if (context.selectedHumanAugmentFlawTrait?.custom) {
        addUniqueItemData(items, customEmbeddedItemData("trait", context.selectedHumanAugmentFlawTrait.name, context.selectedHumanAugmentFlawTrait.description ?? ""));
      }
      if (context.selectedSupportingTrait?.uuid) await addTraitUuid(context.selectedSupportingTrait.uuid);
      else if (context.selectedSupportingTrait?.custom) {
        addUniqueItemData(items, customEmbeddedItemData("trait", context.selectedSupportingTrait.name, context.selectedSupportingTrait.description ?? ""));
      }
      for (const value of context.supportingValueSummary ?? []) {
        if (value.uuid) await addUuid(value.uuid);
        else if (value.custom) addUniqueItemData(items, customEmbeddedItemData("value", value.name, value.description ?? ""));
      }
      for (const focus of context.supportingFocusSummary ?? []) {
        if (focus.uuid) await addUuid(focus.uuid);
        else if (focus.custom) addUniqueItemData(items, customEmbeddedItemData("focus", focus.name, focus.description ?? ""));
      }
      for (const item of context.departmentEquipment ?? []) await addUuid(item.uuid);
      for (const item of context.assignmentEquipment ?? []) await addUuid(item.uuid);
      return stripCreatorItemKeys(removeLowerPhaserTypeItems(items));
    }

    for (const uuid of context.selectedSpeciesTraitUuids ?? []) await addTraitUuid(uuid);
    await addUuid(context.selectedSpeciesAbilityUuid);
    for (const talent of context.selectedSpeciesEsotericTalents ?? []) await addUuid(talent.uuid);
    if (context.selectedHumanAugmentFlawTrait?.uuid) await addTraitUuid(context.selectedHumanAugmentFlawTrait.uuid);
    else if (context.selectedHumanAugmentFlawTrait?.custom) {
      addUniqueItemData(items, customEmbeddedItemData("trait", context.selectedHumanAugmentFlawTrait.name, context.selectedHumanAugmentFlawTrait.description ?? ""));
    }
    if (context.selectedCareerTrait?.uuid) await addTraitUuid(context.selectedCareerTrait.uuid);
    else if (context.selectedCareerTrait?.custom) {
      addUniqueItemData(items, customEmbeddedItemData("trait", context.selectedCareerTrait.name, context.selectedCareerTrait.description ?? ""));
    }
    for (const trait of context.eventTraitSummary ?? []) {
      if (trait.uuid) await addTraitUuid(trait.uuid);
      else if (trait.custom) addUniqueItemData(items, customEmbeddedItemData("trait", trait.name, trait.description ?? ""));
    }
    await addUuid(context.selectedRole?.uuid);

    for (const value of context.valueSummary ?? []) {
      if (value.uuid) await addUuid(value.uuid);
      else if (value.custom) addUniqueItemData(items, customEmbeddedItemData("value", value.name, value.description ?? ""));
    }

    for (const focus of context.focusSummary ?? []) {
      if (focus.uuid) await addUuid(focus.uuid);
      else if (focus.custom) addUniqueItemData(items, customEmbeddedItemData("focus", focus.name, focus.description ?? ""));
    }

    for (const talent of context.selectedTalentSummary ?? []) await addUuid(talent.uuid);
    for (const item of context.roleEquipment ?? []) await addUuid(item.uuid);
    for (const item of context.rankEquipment ?? []) await addUuid(item.uuid);

    return stripCreatorItemKeys(removeLowerPhaserTypeItems(items));
  }

  _buildFinalActorData(context, items) {
    if (context.isNpcCharacter) return this._buildNpcActorData(context, items);
    if (context.isSupportingCharacter) return this._buildSupportingActorData(context, items);

    const attributes = {};
    const disciplines = {};
    for (const key of ATTRIBUTE_KEYS) {
      attributes[key] = {
        label: `sta.actor.character.attribute.${key}`,
        value: context.finalAttributeContext.scores[key] ?? 7,
        selected: key === ATTRIBUTE_KEYS[0],
      };
    }
    for (const key of DISCIPLINE_KEYS) {
      disciplines[key] = {
        label: `sta.actor.character.discipline.${key}`,
        value: context.finalDepartmentContext.scores[key] ?? 1,
        selected: key === DISCIPLINE_KEYS[0],
      };
    }

    const careerEventNames = (context.careerEventSelections ?? [])
      .map(slot => slot.event?.name)
      .filter(Boolean)
      .join(", ");
    const speciesName = [
      context.primary?.name,
      context.mixedSpecies ? context.secondary?.name : "",
    ].filter(Boolean).join(" / ");
    const stressMax = (attributes.fitness?.value ?? 7) + (disciplines.security?.value ?? 1);
    const actorImage = context.primary?.tokenImage || "icons/svg/mystery-man.svg";

    return {
      name: context.characterName?.trim() || "Unnamed Character",
      type: "character",
      img: actorImage,
      folder: this._targetFolderId || null,
      system: {
        assignment: context.assignment ?? "",
        disciplineorder: ["command", "conn", "security", "engineering", "science", "medicine"],
        disciplineorder2e: ["command", "conn", "engineering", "security", "medicine", "science"],
        attributes,
        disciplines,
        determination: { value: 1, max: 3 },
        stress: { value: stressMax, max: stressMax },
        reputation: 3,
        environment: context.isJemHadarLifepath
          ? context.selectedJemHadarHatchery?.name ?? ""
          : context.isVortaLifepath
            ? context.vortaCloning?.name ?? ""
            : context.environment?.name ?? "",
        milestones: "",
        pronouns: context.pronouns ?? "",
        characterrole: context.selectedRole?.name ?? "",
        rank: context.rank ?? "",
        acclaim: 0,
        reprimand: 0,
        species: speciesName,
        careerpath: context.careerPath?.name ?? "",
        pastimes: context.canSelectPastime ? context.pastime ?? "" : "",
        experience: context.experience?.name ?? "",
        careerevents: careerEventNames,
        house: "",
        caste: "",
        status: "",
        temperament: "",
        househistory: "",
        influence: 0,
        might: 0,
        wealth: 0,
        legacy: "",
        traits: "",
        notes: "Created with STA2e Toolkit Character Creator.",
        strmod: 0,
        rollrepnotdis: false,
        upbringing: context.isJemHadarLifepath
          ? context.selectedJemHadarHatchery?.name ?? ""
          : context.isVortaLifepath
            ? context.vortaCloning?.name ?? ""
            : context.upbringing?.name ?? "",
        npcType: "minor",
        showklingon: false,
      },
      prototypeToken: {
        name: context.characterName?.trim() || "Unnamed Character",
        displayName: 30,
        actorLink: true,
        width: 1,
        height: 1,
        texture: { src: actorImage },
        disposition: 1,
      },
      ownership: playerActorOwnership(),
      items,
    };
  }

  _buildSupportingActorData(context, items) {
    const attributes = {};
    const disciplines = {};
    for (const row of context.supportingAttributeRows ?? []) {
      attributes[row.key] = {
        label: `sta.actor.character.attribute.${row.key}`,
        value: row.value ?? 7,
        selected: row.key === ATTRIBUTE_KEYS[0],
      };
    }
    for (const row of context.supportingDepartmentRows ?? []) {
      disciplines[row.key] = {
        label: `sta.actor.character.discipline.${row.key}`,
        value: row.value ?? 0,
        selected: row.key === DISCIPLINE_KEYS[0],
      };
    }

    const speciesName = [
      context.primary?.name,
      context.mixedSpecies ? context.secondary?.name : "",
    ].filter(Boolean).join(" / ");
    const assignment = String(context.assignment ?? "").trim() || context.supportingDepartmentLabel || "";
    const name = context.characterName?.trim() || "Unnamed Character";
    const stressMax = supportingStressMax(attributes, disciplines, items, context.isSupervisoryCharacter);
    const actorImage = context.primary?.tokenImage || "icons/svg/mystery-man.svg";

    return {
      name,
      type: "character",
      img: actorImage,
      folder: this._targetFolderId || null,
      system: {
        assignment,
        disciplineorder: ["command", "conn", "security", "engineering", "science", "medicine"],
        disciplineorder2e: ["command", "conn", "engineering", "security", "medicine", "science"],
        attributes,
        disciplines,
        determination: { value: 1, max: 3 },
        stress: { value: 0, max: stressMax },
        reputation: 3,
        environment: "",
        milestones: "",
        pronouns: context.pronouns ?? "",
        characterrole: "",
        rank: context.rank ?? "",
        acclaim: 0,
        reprimand: 0,
        species: speciesName,
        careerpath: "",
        pastimes: context.canSelectPastime ? context.pastime ?? "" : "",
        experience: context.characterTypeDefinition?.name ?? "",
        careerevents: "",
        house: "",
        caste: "",
        status: "",
        temperament: "",
        househistory: "",
        influence: 0,
        might: 0,
        wealth: 0,
        legacy: "",
        traits: "",
        notes: "Created with STA2e Toolkit Character Creator.",
        strmod: 0,
        rollrepnotdis: false,
        upbringing: "",
        npcType: "minor",
        showklingon: false,
      },
      prototypeToken: {
        name,
        displayName: 0,
        actorLink: false,
        width: 1,
        height: 1,
        depth: 1,
        texture: {
          src: actorImage,
          anchorX: 0.5,
          anchorY: 0.5,
          fit: "contain",
          scaleX: 1,
          scaleY: 1,
          tint: "#ffffff",
          alphaThreshold: 0.75,
        },
        lockRotation: false,
        rotation: 0,
        alpha: 1,
        disposition: -1,
        displayBars: 0,
        bar1: { attribute: null },
        bar2: { attribute: null },
      },
      flags: {
        core: { sheetClass: "sta.STASupportingSheet2e" },
        "sta2e-toolkit": {
          supervisoryCharacter: !!context.isSupervisoryCharacter,
          supportingDepartment: context.supportingDepartment,
        },
      },
      ownership: sharedActorOwnership(),
      items,
    };
  }

  _buildNpcActorData(context, items) {
    const attributes = {};
    const disciplines = {};
    for (const row of context.npcAttributeRows ?? []) {
      attributes[row.key] = {
        label: `sta.actor.character.attribute.${row.key}`,
        value: row.value ?? 7,
        selected: row.key === ATTRIBUTE_KEYS[0],
      };
    }
    for (const row of context.npcDepartmentRows ?? []) {
      disciplines[row.key] = {
        label: `sta.actor.character.discipline.${row.key}`,
        value: row.value ?? 0,
        selected: row.key === DISCIPLINE_KEYS[0],
      };
    }

    const speciesName = [
      context.primary?.name,
      context.mixedSpecies ? context.secondary?.name : "",
    ].filter(Boolean).join(" / ");
    const name = context.characterName?.trim() || `Unnamed ${context.npcDefinition?.name ?? "NPC"}`;
    const actorImage = context.primary?.tokenImage || "icons/svg/mystery-man.svg";
    const npcType = context.npcDefinition?.npcType ?? "minor";
    const actorLink = npcType !== "minor";

    return {
      name,
      type: "character",
      img: actorImage,
      folder: this._targetFolderId || null,
      system: {
        assignment: context.assignment ?? "",
        disciplineorder: ["command", "conn", "security", "engineering", "science", "medicine"],
        disciplineorder2e: ["command", "conn", "engineering", "security", "medicine", "science"],
        attributes,
        disciplines,
        determination: { value: 1, max: 3 },
        stress: { value: 0, max: context.npcPersonalThreat ?? 0 },
        reputation: 3,
        environment: "",
        milestones: "",
        pronouns: context.pronouns ?? "",
        characterrole: "",
        rank: context.rank ?? "",
        acclaim: 0,
        reprimand: 0,
        species: speciesName,
        careerpath: "",
        pastimes: "",
        experience: context.npcDefinition?.name ?? "",
        careerevents: "",
        house: "",
        caste: "",
        status: "",
        temperament: "",
        househistory: "",
        influence: 0,
        might: 0,
        wealth: 0,
        legacy: "",
        traits: "",
        notes: context.npcNotes?.trim() || "Created with STA2e Toolkit Character Creator.",
        strmod: 0,
        rollrepnotdis: false,
        upbringing: "",
        npcType,
        showklingon: false,
      },
      prototypeToken: {
        name,
        displayName: 0,
        actorLink,
        width: 1,
        height: 1,
        depth: 1,
        texture: {
          src: actorImage,
          anchorX: 0.5,
          anchorY: 0.5,
          fit: "contain",
          scaleX: 1,
          scaleY: 1,
          tint: "#ffffff",
          alphaThreshold: 0.75,
        },
        lockRotation: false,
        rotation: 0,
        alpha: 1,
        disposition: -1,
        displayBars: 0,
        bar1: { attribute: null },
        bar2: { attribute: null },
      },
      flags: {
        core: { sheetClass: "sta.STANPCSheet2e" },
        "sta2e-toolkit": {
          npcCreator: true,
          npcType,
        },
      },
      ownership: sharedActorOwnership(),
      items,
    };
  }

  static async _onFinalizeCharacter() {
    const context = await this._prepareContext({});
    if (context.isNpcCharacter && !game.user.isGM) {
      ui.notifications.warn("STA2e Toolkit: Only GMs can create NPCs.");
      return;
    }
    const validationStep = context.isNpcCharacter ? 3 : context.isSupportingCharacter ? 3 : 7;
    const warning = this._validationWarningForStep({ ...context, step: validationStep });
    if (warning) {
      ui.notifications.warn(`STA2e Toolkit: ${warning}`);
      this._creatorState.step = validationStep;
      this.render({ force: true });
      return;
    }

    try {
      const items = await this._buildFinalActorItems(context);
      const actor = await Actor.create(this._buildFinalActorData(context, items), { renderSheet: false });
      await reconcileCreatorActorItems(actor, items);
      actor.sheet?.render(true);
      ui.notifications.info(`STA2e Toolkit: Created character ${actor.name}.`);
      this.close();
    } catch (err) {
      console.error("STA2e Toolkit | Character Creator finalize failed:", err);
      ui.notifications.error("STA2e Toolkit: Could not create the character. See console for details.");
    }
  }

  _validationWarningForStep(context) {
    const hasSelected = rows => Array.isArray(rows) && rows.some(row => row.selected);
    const hasText = value => String(value ?? "").trim().length > 0;
    const hasValue = value => !!value;

    if (context.isNpcCharacter) {
      switch (context.step) {
        case 1:
          if (!game.user.isGM) return "Only GMs can create NPCs.";
          if (!context.primary) return "Choose a primary species before continuing.";
          if (context.mixedSpecies && !context.secondary) return "Choose a secondary species for a mixed-species NPC.";
          if (context.primaryFreeAttributeSelection && context.selectedFreeAttributeCount < 3) return "Choose three species attributes before continuing.";
          if (context.hasSpeciesAttributeChoice && !context.selectedSpeciesAttributeChoice) return "Choose the species attribute option before continuing.";
          if ((context.speciesFocusSelections ?? []).some(slot => !slot.selected)) return "Choose or write all species bonus focuses.";
          return "";
        case 2:
          if ((context.npcAttributeTotal ?? 0) < 0 || (context.npcDepartmentTotal ?? 0) < 0) return "Assign NPC scores before continuing.";
          return "";
        case 3:
          if (!hasText(context.characterName)) return "Enter the NPC's name.";
          if (!context.selectedNpcRoleTrait) return "Choose or write the NPC's role trait.";
          if ((context.npcValueCount ?? 0) < (context.npcMinValueCount ?? 0)) return `Choose or write at least ${context.npcMinValueCount} value${context.npcMinValueCount === 1 ? "" : "s"}.`;
          if ((context.npcFocusCount ?? 0) < (context.npcMinFocusCount ?? 0)) return `Choose or write at least ${context.npcMinFocusCount} focus${context.npcMinFocusCount === 1 ? "" : "es"}.`;
          if ((context.npcTalentCount ?? 0) < (context.npcMinTalentCount ?? 0)) return `Choose or write at least ${context.npcMinTalentCount} special rule${context.npcMinTalentCount === 1 ? "" : "s"}.`;
          return "";
        default:
          return "";
      }
    }

    if (context.isSupportingCharacter) {
      switch (context.step) {
        case 1:
          if (!context.primary) return "Choose a primary species before continuing.";
          if (context.mixedSpecies && !context.secondary) return "Choose a secondary species for a mixed-species character.";
          if (context.requiresBorgImplants && !(context.selectedBorgImplantCount >= 1)) return "Choose at least one Borg implant.";
          if (context.requiresHumanAugmentTalents && !(context.selectedHumanAugmentTalentCount >= 1)) return "Choose at least one Augment talent.";
          if (context.humanAugmentRequiresFlawTrait && !context.selectedHumanAugmentFlawTrait) return "Choose or write the required Human Augment flaw trait.";
          if ((context.speciesEsotericSelections ?? []).some(slot => !slot.selected)) return "Choose all species esoteric talents before continuing.";
          if (context.primaryFreeAttributeSelection && context.selectedFreeAttributeCount < 3) return "Choose three species attributes before continuing.";
          if (context.hasSpeciesAttributeChoice && !context.selectedSpeciesAttributeChoice) return "Choose the species attribute option before continuing.";
          if ((context.speciesFocusSelections ?? []).some(slot => !slot.selected)) return "Choose or write all species bonus focuses.";
          return "";
        case 2:
          if (!context.supportingDepartment) return "Choose the character's department before continuing.";
          if (!context.selectedSupportingTrait) return "Choose or write one extra trait before continuing.";
          if ((context.supportingFocusSelections ?? []).some(slot => !slot.selected)) return "Choose, roll, or write all required focuses.";
          if (context.isSupervisoryCharacter && !context.selectedSupportingValue) return "Choose, roll, or write a value.";
          return "";
        case 3:
          if (!hasText(context.characterName)) return "Enter the character's name.";
          if (!context.selectedRank && !hasText(context.customRank)) return "Choose a rank or write a custom rank.";
          if (!hasText(context.assignment)) return "Enter the character's assignment.";
          if (context.canSelectPastime && !hasText(context.pastime)) return "Enter a pastime.";
          if (!hasText(context.pronouns)) return "Enter pronouns.";
          return "";
        default:
          return "";
      }
    }

    switch (context.step) {
      case 1:
        if (!context.primary) return "Choose a primary species before continuing.";
        if (context.mixedSpecies && !context.secondary) return "Choose a secondary species for a mixed-species character.";
        if (context.requiresBorgImplants && !(context.selectedBorgImplantCount >= 1)) return "Choose at least one Borg implant.";
        if (context.requiresHumanAugmentTalents && !(context.selectedHumanAugmentTalentCount >= 1)) return "Choose at least one Augment talent.";
        if (context.humanAugmentRequiresFlawTrait && !context.selectedHumanAugmentFlawTrait) return "Choose or write the required Human Augment flaw trait.";
        if ((context.speciesEsotericSelections ?? []).some(slot => !slot.selected)) return "Choose all species esoteric talents before continuing.";
        if (context.primaryFreeAttributeSelection && context.selectedFreeAttributeCount < 3) return "Choose three species attributes before continuing.";
        if (context.hasSpeciesAttributeChoice && !context.selectedSpeciesAttributeChoice) return "Choose the species attribute option before continuing.";
        if ((context.speciesFocusSelections ?? []).some(slot => !slot.selected)) return "Choose or write all species bonus focuses.";
        return "";
      case 2:
        if (context.isJemHadarLifepath) {
          if (!context.selectedJemHadarHatcheryValue) return "Choose, roll, or write a hatchery value.";
          if (!hasSelected(context.jemHadarHatcheryAttributeChoices)) return "Choose the hatchery attribute increase.";
          if (!hasSelected(context.jemHadarHatcheryDepartmentChoices)) return "Choose the hatchery department increase.";
          return "";
        }
        if (context.isVortaLifepath) {
          if (!context.selectedVortaCloningValue) return "Choose, roll, or write a cloning value.";
          if (context.selectedVortaCloningAttributeCount < 3) return "Choose three Vorta cloning attributes.";
          if (!context.selectedVortaCloningAttributeChoice) return "Choose which Vorta cloning attribute gets the extra increase.";
          if (!context.selectedVortaCloningPrimaryDepartment) return "Choose Command, Science, or Medicine for Vorta cloning.";
          if (!context.selectedVortaCloningSecondaryDepartment) return "Choose one other Vorta cloning department.";
          return "";
        }
        if (!context.environment) return "Choose an environment before continuing.";
        if (!context.selectedEnvironmentValue) return "Choose, roll, or write a value for the environment step.";
        if (!hasSelected(context.environmentAttributeChoices)) return "Choose the environment attribute increase.";
        if (!hasSelected(context.environmentDepartmentChoices)) return "Choose the environment department increase.";
        return "";
      case 3:
        if (context.isJemHadarLifepath) {
          if (!context.selectedJemHadarHatcheryFocus) return "Choose, roll, or write a hatchery focus.";
          if (!context.selectedJemHadarHatcheryTalent) return "Choose an eligible hatchery talent.";
          return "";
        }
        if (context.isVortaLifepath) {
          if (!context.selectedVortaCloningFocus) return "Choose, roll, or write a cloning focus.";
          return "";
        }
        if (!context.upbringing) return "Choose or roll an upbringing before continuing.";
        if (!hasSelected(context.upbringingDepartmentChoices)) return "Choose the upbringing department increase.";
        if (!context.selectedUpbringingFocus) return "Choose or write an upbringing focus.";
        if (!context.selectedUpbringingTalent) return "Choose an eligible upbringing talent.";
        return "";
      case 4:
        if (context.isJemHadarLifepath && context.forcedJemHadarCareerPathMissing) return "Add a Starfleet (Enlisted) career path before continuing.";
        if (context.isVortaLifepath && context.vortaCareerPathOptionsMissing) return "Add a Diplomatic Corps or Civilian Vorta career path before continuing.";
        if (!context.careerPath) return "Choose or roll a career path before continuing.";
        if (context.hasCareerTraitOptions && !context.selectedCareerTrait) return "Choose or write one professional trait.";
        if (!context.selectedCareerValue) return "Choose, roll, or write a career value.";
        if ((context.careerAttributeSpendTotal ?? 0) < 3) return "Spend all three career attribute points.";
        if (!context.careerAttributeRequirementSatisfied) return `Spend at least one career attribute point in ${context.careerAttributeRequirementLabel}.`;
        if (!context.selectedCareerDepartmentPlusTwo) return "Choose the career department that receives +2.";
        if ((context.selectedCareerDepartmentPlusOne?.length ?? 0) < 2) return "Choose two career departments that receive +1.";
        if (context.selectedCareerDepartmentReallocationFrom && !context.selectedCareerDepartmentReallocationTo) return "Choose where the optional department reallocation point goes, or clear the reduction.";
        if ((context.careerFocusSelections ?? []).some(slot => !slot.selected)) return "Choose or write all three career focuses.";
        if (!context.selectedCareerTalent) return "Choose an eligible career talent.";
        return "";
      case 5:
        if (!context.experience) return "Choose an experience level before continuing.";
        if (!context.selectedExperienceValue) return "Choose, roll, or write an experience value.";
        if (!context.selectedExperienceTalent) return "Choose an eligible experience talent.";
        return "";
      case 6:
        if ((context.careerEventSelections ?? []).some(slot => !slot.event)) return "Choose or roll two career events.";
        if ((context.careerEventSelections ?? []).some(slot => !slot.event.attributeKey)) return "Choose the attribute increase for each career event.";
        if ((context.careerEventSelections ?? []).some(slot => !slot.event.departmentKey)) return "Choose the department increase for each career event.";
        if ((context.careerEventSelections ?? []).some(slot => !slot.selectedFocus)) return "Choose or write a focus for each career event.";
        if ((context.careerEventSelections ?? []).some(slot => slot.event?.traitGrant && !slot.selectedTrait)) return "Choose or write the career event trait.";
        return "";
      case 7:
        if (!context.selectedFinalValue) return "Choose, roll, or write the final value.";
        if ((context.finalAttributeContext?.redistributionRemaining ?? 0) > 0) return "Finish redistributing reduced attribute points.";
        if ((context.finalDepartmentContext?.redistributionRemaining ?? 0) > 0) return "Finish redistributing reduced department points.";
        if ((context.finalAttributeContext?.finalRemaining ?? 0) > 0) return "Choose both final attribute increases.";
        if ((context.finalDepartmentContext?.finalRemaining ?? 0) > 0) return "Choose both final department increases.";
        if ((context.finalAttributeTotal ?? 0) !== 56) return "Attributes must total 56 before review.";
        if ((context.finalDepartmentTotal ?? 0) !== 16) return "Departments must total 16 before review. Check earlier department choices, especially Career Path.";
        if (!context.selectedFinalTalent) return "Choose the extra final talent.";
        if (!hasText(context.characterName)) return "Enter the character's name.";
        if (!context.selectedRole) return "Choose a role.";
        if (!context.selectedRank && !hasText(context.customRank)) return "Choose a rank or write a custom rank.";
        if (context.canSelectPastime && !hasText(context.pastime)) return "Enter a pastime.";
        if (!hasText(context.assignment)) return "Enter an assignment.";
        if (!hasText(context.pronouns)) return "Enter pronouns.";
        return "";
      default:
        return "";
    }
  }

  static async _onNextStep() {
    const context = await this._prepareContext({});
    const warning = this._validationWarningForStep(context);
    if (warning) {
      ui.notifications.warn(`STA2e Toolkit: ${warning}`);
      this.render({ force: true });
      return;
    }
    const maxStep = context.isNpcCharacter || context.isSupportingCharacter ? 4 : 8;
    this._creatorState.step = Math.min(this._creatorState.step + 1, maxStep);
    this.render({ force: true });
  }

  static _onPreviousStep() {
    if ((this._creatorState.step ?? 1) <= 1) {
      this._creatorState.characterType = "";
      this._creatorState.step = 1;
    } else {
      this._creatorState.step = Math.max(this._creatorState.step - 1, 1);
    }
    this.render({ force: true });
  }

  static _onRandomCharacterName() {
    const species = getCreatorData().species.map(normalizeSpecies).filter(row => row.name);
    const gender = ["any", "male", "female"].includes(this._creatorState.randomNameGender) ? this._creatorState.randomNameGender : "any";
    const primary = species.find(row => row.id === this._creatorState.primarySpeciesId) ?? species[0] ?? null;
    const secondary = this._creatorState.mixedSpecies
      ? species.find(row => row.id === this._creatorState.secondarySpeciesId && row.id !== primary?.id) ?? null
      : null;
    const isHologram = [primary, secondary].some(speciesOption =>
      hasTraitAccessName(new Set([
        speciesOption?.name,
        speciesOption?.trait,
      ].filter(Boolean).map(name => String(name).toLocaleLowerCase(game.i18n.lang))), "hologram"));
    const candidates = (isHologram ? species : [primary, secondary])
      .filter(speciesOption => hasSpeciesNames(speciesOption, gender));

    if (!candidates.length) {
      ui.notifications.warn(`STA2e Toolkit: Add first names or surnames to ${isHologram ? "at least one species" : "the selected species"} before rolling a random character name.`);
      return;
    }

    const source = candidates[Math.floor(Math.random() * candidates.length)];
    const name = randomNameFromSpecies(source, gender);
    if (!name) {
      ui.notifications.warn("STA2e Toolkit: The selected species name list could not generate a name.");
      return;
    }

    this._creatorState.characterName = name;
    this.render({ force: true });
  }

  static _onRandomEnvironmentValue() {
    const values = normalizeUuidList(getCreatorData().config.values);
    if (!values.length) {
      ui.notifications.warn("STA2e Toolkit: Add values to Creator Config before rolling a random value.");
      return;
    }

    this._creatorState.environmentValueUuid = values[Math.floor(Math.random() * values.length)];
    this._creatorState.environmentCustomValueName = "";
    this._creatorState.environmentCustomValueDescription = "";
    this.render({ force: true });
  }

  static _onRandomEnvironmentAttributeSpecies() {
    const species = getCreatorData().species.map(normalizeSpecies).filter(row => row.name);
    const primary = species.find(row => row.id === this._creatorState.primarySpeciesId) ?? species[0] ?? null;
    const candidates = species.filter(row => row.id !== primary?.id);

    if (!candidates.length) {
      ui.notifications.warn("STA2e Toolkit: Add another species before rolling an environment attribute source.");
      return;
    }

    const source = candidates[Math.floor(Math.random() * candidates.length)];
    this._creatorState.environmentAttributeSpeciesId = source.id;
    this._creatorState.environmentAttribute = "";
    this.render({ force: true });
  }

  static _onRandomJemHadarHatcheryValue() {
    const values = normalizeUuidList(getCreatorData().config.values);
    if (!values.length) {
      ui.notifications.warn("STA2e Toolkit: Add values to Creator Config before rolling a random hatchery value.");
      return;
    }

    this._creatorState.jemHadarHatcheryValueUuid = values[Math.floor(Math.random() * values.length)];
    this._creatorState.jemHadarHatcheryCustomValueName = "";
    this._creatorState.jemHadarHatcheryCustomValueDescription = "";
    this.render({ force: true });
  }

  static _onRandomJemHadarHatcheryFocus() {
    const data = getCreatorData();
    const hatchery = jemHadarHatcheryByKey(this._creatorState.jemHadarHatcheryKey);
    const selectedDepartment = DISCIPLINE_KEYS
      .filter(key => key !== hatchery.department)
      .includes(this._creatorState.jemHadarHatcheryDepartment)
      ? this._creatorState.jemHadarHatcheryDepartment
      : "";
    const focusUuids = lifepathFocusUuids([], data.config, [hatchery.department, selectedDepartment].filter(Boolean));
    if (!focusUuids.length) {
      ui.notifications.warn("STA2e Toolkit: Add focuses to Creator Config before rolling a hatchery focus.");
      return;
    }

    this._creatorState.jemHadarHatcheryFocusUuid = focusUuids[Math.floor(Math.random() * focusUuids.length)];
    this._creatorState.jemHadarHatcheryCustomFocusName = "";
    this._creatorState.jemHadarHatcheryCustomFocusDescription = "";
    this.render({ force: true });
  }

  static _onRandomVortaCloningValue() {
    const values = normalizeUuidList(getCreatorData().config.values);
    if (!values.length) {
      ui.notifications.warn("STA2e Toolkit: Add values to Creator Config before rolling a random cloning value.");
      return;
    }

    this._creatorState.vortaCloningValueUuid = values[Math.floor(Math.random() * values.length)];
    this._creatorState.vortaCloningCustomValueName = "";
    this._creatorState.vortaCloningCustomValueDescription = "";
    this.render({ force: true });
  }

  static _onRandomVortaCloningFocus() {
    const data = getCreatorData();
    const departments = DISCIPLINE_KEYS
      .filter(key => [
        this._creatorState.vortaCloningPrimaryDepartment,
        this._creatorState.vortaCloningSecondaryDepartment,
      ].includes(key));
    const focusUuids = lifepathFocusUuids([], data.config, departments);
    if (!focusUuids.length) {
      ui.notifications.warn("STA2e Toolkit: Add focuses to Creator Config before rolling a cloning focus.");
      return;
    }

    this._creatorState.vortaCloningFocusUuid = focusUuids[Math.floor(Math.random() * focusUuids.length)];
    this._creatorState.vortaCloningCustomFocusName = "";
    this._creatorState.vortaCloningCustomFocusDescription = "";
    this.render({ force: true });
  }

  static _onRandomCareerValue() {
    const values = normalizeUuidList(getCreatorData().config.values);
    if (!values.length) {
      ui.notifications.warn("STA2e Toolkit: Add values to Creator Config before rolling a random career value.");
      return;
    }

    this._creatorState.careerValueUuid = values[Math.floor(Math.random() * values.length)];
    this._creatorState.careerCustomValueName = "";
    this._creatorState.careerCustomValueDescription = "";
    this.render({ force: true });
  }

  static _onRandomExperienceValue() {
    const values = normalizeUuidList(getCreatorData().config.values);
    if (!values.length) {
      ui.notifications.warn("STA2e Toolkit: Add values to Creator Config before rolling a random experience value.");
      return;
    }

    this._creatorState.experienceValueUuid = values[Math.floor(Math.random() * values.length)];
    this._creatorState.experienceCustomValueName = "";
    this._creatorState.experienceCustomValueDescription = "";
    this.render({ force: true });
  }

  static _onRandomFinalValue() {
    const values = normalizeUuidList(getCreatorData().config.values);
    if (!values.length) {
      ui.notifications.warn("STA2e Toolkit: Add values to Creator Config before rolling a random final value.");
      return;
    }

    this._creatorState.finalValueUuid = values[Math.floor(Math.random() * values.length)];
    this._creatorState.finalCustomValueName = "";
    this._creatorState.finalCustomValueDescription = "";
    this.render({ force: true });
  }

  static _onRandomSupportingValue() {
    const values = normalizeUuidList(getCreatorData().config.values);
    if (!values.length) {
      ui.notifications.warn("STA2e Toolkit: Add values to Creator Config before rolling a random value.");
      return;
    }

    this._creatorState.supportingValueUuid = values[Math.floor(Math.random() * values.length)];
    this._creatorState.supportingCustomValueName = "";
    this._creatorState.supportingCustomValueDescription = "";
    this.render({ force: true });
  }

  static _onRandomUpbringingFocus() {
    const data = getCreatorData();
    const upbringings = data.upbringings.map(normalizeUpbringing).filter(upbringing => upbringing.name);
    const upbringing = upbringings.find(row => row.id === this._creatorState.upbringingId) ?? upbringings[0] ?? null;
    if (!upbringing) {
      ui.notifications.warn("STA2e Toolkit: Choose an upbringing before rolling a focus.");
      return;
    }

    const selectedDepartment = effectiveUpbringingDepartmentChoices(upbringing).includes(this._creatorState.upbringingDepartment)
      ? this._creatorState.upbringingDepartment
      : "";
    const focusUuids = lifepathFocusUuids(
      upbringing.recommendedFocusUuids,
      data.config,
      selectedDepartment ? [selectedDepartment] : [],
    );
    if (!focusUuids.length) {
      ui.notifications.warn("STA2e Toolkit: Add recommended focuses to this upbringing or choose an upbringing department with configured focuses.");
      return;
    }

    this._creatorState.upbringingFocusUuid = focusUuids[Math.floor(Math.random() * focusUuids.length)];
    this._creatorState.upbringingCustomFocusName = "";
    this._creatorState.upbringingCustomFocusDescription = "";
    this.render({ force: true });
  }

  static _onRandomSpeciesFocus(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;

    const data = getCreatorData();
    const species = data.species.map(normalizeSpecies).filter(row => row.name);
    const primary = species.find(row => row.id === this._creatorState.primarySpeciesId) ?? species[0] ?? null;
    const focusLimit = normalizeExtraFocusCount(primary?.extraFocusCount ?? 0);
    if (!primary || index >= focusLimit) {
      ui.notifications.warn("STA2e Toolkit: Choose a species with bonus focuses before rolling a focus.");
      return;
    }

    const focusUuids = configuredFocusUuids(data.config);
    if (!focusUuids.length) {
      ui.notifications.warn("STA2e Toolkit: Add configured or department focuses to Creator Data before rolling a species focus.");
      return;
    }

    const alreadySelected = new Set((this._creatorState.speciesFocusUuids ?? []).filter((uuid, i) => uuid && i !== index));
    const available = focusUuids.filter(uuid => !alreadySelected.has(uuid));
    const pool = available.length ? available : focusUuids;
    this._creatorState.speciesFocusUuids[index] = pool[Math.floor(Math.random() * pool.length)];
    this._creatorState.speciesCustomFocusNames[index] = "";
    this.render({ force: true });
  }

  static _onRandomNpcTrait(_event, target) {
    const isExtra = target?.dataset?.target === "extra";
    const definition = npcDefinitionForType(this._creatorState.characterType);
    if (isExtra && !definition?.extraTraitCount) return;

    const traits = normalizeUuidList(getCreatorData().config.traits);
    if (!traits.length) {
      ui.notifications.warn("STA2e Toolkit: Add traits to Creator Config before rolling a random trait.");
      return;
    }

    const otherUuid = isExtra ? this._creatorState.npcRoleTraitUuid : this._creatorState.npcExtraTraitUuid;
    const available = traits.filter(uuid => uuid !== otherUuid);
    const pool = available.length ? available : traits;
    const picked = pool[Math.floor(Math.random() * pool.length)];

    if (isExtra) {
      this._creatorState.npcExtraTraitUuid = picked;
      this._creatorState.npcCustomExtraTraitName = "";
      this._creatorState.npcCustomExtraTraitDescription = "";
    } else {
      this._creatorState.npcRoleTraitUuid = picked;
      this._creatorState.npcCustomRoleTraitName = "";
      this._creatorState.npcCustomRoleTraitDescription = "";
    }
    this.render({ force: true });
  }

  static _onRandomNpcValue(_event, target) {
    const index = Number(target.dataset.index);
    const limit = npcDefinitionForType(this._creatorState.characterType)?.valueCount ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= limit) return;

    const values = normalizeUuidList(getCreatorData().config.values);
    if (!values.length) {
      ui.notifications.warn("STA2e Toolkit: Add values to Creator Config before rolling a random value.");
      return;
    }

    const alreadySelected = new Set((this._creatorState.npcValueUuids ?? []).filter((uuid, i) => uuid && i !== index));
    const available = values.filter(uuid => !alreadySelected.has(uuid));
    const pool = available.length ? available : values;
    this._creatorState.npcValueUuids[index] = pool[Math.floor(Math.random() * pool.length)];
    this._creatorState.npcCustomValueNames[index] = "";
    this._creatorState.npcCustomValueDescriptions[index] = "";
    if (Array.isArray(this._creatorState.npcValueEditFlags)) this._creatorState.npcValueEditFlags[index] = false;
    this.render({ force: true });
  }

  static _onRandomNpcFocus(_event, target) {
    const index = Number(target.dataset.index);
    const limit = npcDefinitionForType(this._creatorState.characterType)?.focusCount ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= limit) return;

    const focuses = configuredFocusUuids(getCreatorData().config);
    if (!focuses.length) {
      ui.notifications.warn("STA2e Toolkit: Add focuses to Creator Config before rolling a random focus.");
      return;
    }

    const alreadySelected = new Set((this._creatorState.npcFocusUuids ?? []).filter((uuid, i) => uuid && i !== index));
    const available = focuses.filter(uuid => !alreadySelected.has(uuid));
    const pool = available.length ? available : focuses;
    this._creatorState.npcFocusUuids[index] = pool[Math.floor(Math.random() * pool.length)];
    this._creatorState.npcCustomFocusNames[index] = "";
    this._creatorState.npcCustomFocusDescriptions[index] = "";
    if (Array.isArray(this._creatorState.npcFocusEditFlags)) this._creatorState.npcFocusEditFlags[index] = false;
    this.render({ force: true });
  }

  static _onRandomNpcTalent(_event, target) {
    const index = Number(target.dataset.index);
    const limit = npcDefinitionForType(this._creatorState.characterType)?.talentCount ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= limit) return;

    const talents = allConfiguredTalentUuids(getCreatorData().config, {
      includeNpc: true,
      includeEsoteric: true,
      includeAugment: true,
      includeCybernetic: true,
      includeBorgImplantCategory: true,
    });
    if (!talents.length) {
      ui.notifications.warn("STA2e Toolkit: Add NPC special rules or talents to Creator Config before rolling a random special rule.");
      return;
    }

    const alreadySelected = new Set((this._creatorState.npcTalentUuids ?? []).filter((uuid, i) => uuid && i !== index));
    const available = talents.filter(uuid => !alreadySelected.has(uuid));
    const pool = available.length ? available : talents;
    this._creatorState.npcTalentUuids[index] = pool[Math.floor(Math.random() * pool.length)];
    this._creatorState.npcCustomTalentNames[index] = "";
    this._creatorState.npcCustomTalentDescriptions[index] = "";
    if (Array.isArray(this._creatorState.npcTalentEditFlags)) this._creatorState.npcTalentEditFlags[index] = false;
    this.render({ force: true });
  }

  static _onAddNpcValue() {
    const definition = npcDefinitionForType(this._creatorState.characterType);
    const limit = definition?.valueCount ?? 0;
    const current = Number(this._creatorState.npcVisibleValueSlots ?? 0) || 0;
    this._creatorState.npcVisibleValueSlots = Math.min(current + 1, limit);
    this.render({ force: true });
  }

  static _onAddNpcFocus() {
    const definition = npcDefinitionForType(this._creatorState.characterType);
    const limit = definition?.focusCount ?? 0;
    const current = Number(this._creatorState.npcVisibleFocusSlots ?? 0) || 0;
    this._creatorState.npcVisibleFocusSlots = Math.min(current + 1, limit);
    this.render({ force: true });
  }

  static _onAddNpcTalent() {
    const definition = npcDefinitionForType(this._creatorState.characterType);
    const limit = definition?.talentCount ?? 0;
    const current = Number(this._creatorState.npcVisibleTalentSlots ?? 0) || 0;
    this._creatorState.npcVisibleTalentSlots = Math.min(current + 1, limit);
    this.render({ force: true });
  }

  static _onRemoveNpcValue(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const definition = npcDefinitionForType(this._creatorState.characterType);
    const limit = definition?.valueCount ?? 0;
    const min = Math.min(limit, definition?.minValueCount ?? limit);
    if (Array.isArray(this._creatorState.npcValueUuids)) {
      this._creatorState.npcValueUuids.splice(index, 1);
      this._creatorState.npcValueUuids.push("");
    }
    if (Array.isArray(this._creatorState.npcCustomValueNames)) {
      this._creatorState.npcCustomValueNames.splice(index, 1);
      this._creatorState.npcCustomValueNames.push("");
    }
    if (Array.isArray(this._creatorState.npcCustomValueDescriptions)) {
      this._creatorState.npcCustomValueDescriptions.splice(index, 1);
      this._creatorState.npcCustomValueDescriptions.push("");
    }
    if (Array.isArray(this._creatorState.npcValueEditFlags)) {
      this._creatorState.npcValueEditFlags.splice(index, 1);
      this._creatorState.npcValueEditFlags.push(false);
    }
    const current = Number(this._creatorState.npcVisibleValueSlots ?? 0) || 0;
    this._creatorState.npcVisibleValueSlots = Math.max(min, current - 1);
    this.render({ force: true });
  }

  static _onRemoveNpcFocus(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const definition = npcDefinitionForType(this._creatorState.characterType);
    const limit = definition?.focusCount ?? 0;
    const min = Math.min(limit, definition?.minFocusCount ?? limit);
    if (Array.isArray(this._creatorState.npcFocusUuids)) {
      this._creatorState.npcFocusUuids.splice(index, 1);
      this._creatorState.npcFocusUuids.push("");
    }
    if (Array.isArray(this._creatorState.npcCustomFocusNames)) {
      this._creatorState.npcCustomFocusNames.splice(index, 1);
      this._creatorState.npcCustomFocusNames.push("");
    }
    if (Array.isArray(this._creatorState.npcCustomFocusDescriptions)) {
      this._creatorState.npcCustomFocusDescriptions.splice(index, 1);
      this._creatorState.npcCustomFocusDescriptions.push("");
    }
    if (Array.isArray(this._creatorState.npcFocusEditFlags)) {
      this._creatorState.npcFocusEditFlags.splice(index, 1);
      this._creatorState.npcFocusEditFlags.push(false);
    }
    const current = Number(this._creatorState.npcVisibleFocusSlots ?? 0) || 0;
    this._creatorState.npcVisibleFocusSlots = Math.max(min, current - 1);
    this.render({ force: true });
  }

  static _onRemoveNpcTalent(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const definition = npcDefinitionForType(this._creatorState.characterType);
    const limit = definition?.talentCount ?? 0;
    const min = Math.min(limit, definition?.minTalentCount ?? limit);
    if (Array.isArray(this._creatorState.npcTalentUuids)) {
      this._creatorState.npcTalentUuids.splice(index, 1);
      this._creatorState.npcTalentUuids.push("");
    }
    if (Array.isArray(this._creatorState.npcCustomTalentNames)) {
      this._creatorState.npcCustomTalentNames.splice(index, 1);
      this._creatorState.npcCustomTalentNames.push("");
    }
    if (Array.isArray(this._creatorState.npcCustomTalentDescriptions)) {
      this._creatorState.npcCustomTalentDescriptions.splice(index, 1);
      this._creatorState.npcCustomTalentDescriptions.push("");
    }
    if (Array.isArray(this._creatorState.npcTalentEditFlags)) {
      this._creatorState.npcTalentEditFlags.splice(index, 1);
      this._creatorState.npcTalentEditFlags.push(false);
    }
    const current = Number(this._creatorState.npcVisibleTalentSlots ?? 0) || 0;
    this._creatorState.npcVisibleTalentSlots = Math.max(min, current - 1);
    this.render({ force: true });
  }

  static async _onEditNpcValue(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const uuid = this._creatorState.npcValueUuids?.[index];
    if (!uuid) return;
    if (!Array.isArray(this._creatorState.npcValueEditFlags)) this._creatorState.npcValueEditFlags = [];
    if (!(this._creatorState.npcCustomValueNames?.[index] ?? "").trim() && !(this._creatorState.npcCustomValueDescriptions?.[index] ?? "").trim()) {
      const doc = await resolveUuidDoc(uuid);
      if (doc) {
        this._creatorState.npcCustomValueNames[index] = doc.name ?? "";
        this._creatorState.npcCustomValueDescriptions[index] = descriptionForDoc(doc);
      }
    }
    this._creatorState.npcValueEditFlags[index] = true;
    this.render({ force: true });
  }

  static async _onEditNpcFocus(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const uuid = this._creatorState.npcFocusUuids?.[index];
    if (!uuid) return;
    if (!Array.isArray(this._creatorState.npcFocusEditFlags)) this._creatorState.npcFocusEditFlags = [];
    if (!(this._creatorState.npcCustomFocusNames?.[index] ?? "").trim() && !(this._creatorState.npcCustomFocusDescriptions?.[index] ?? "").trim()) {
      const doc = await resolveUuidDoc(uuid);
      if (doc) {
        this._creatorState.npcCustomFocusNames[index] = doc.name ?? "";
        this._creatorState.npcCustomFocusDescriptions[index] = descriptionForDoc(doc);
      }
    }
    this._creatorState.npcFocusEditFlags[index] = true;
    this.render({ force: true });
  }

  static async _onEditNpcTalent(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const uuid = this._creatorState.npcTalentUuids?.[index];
    if (!uuid) return;
    if (!Array.isArray(this._creatorState.npcTalentEditFlags)) this._creatorState.npcTalentEditFlags = [];
    if (!(this._creatorState.npcCustomTalentNames?.[index] ?? "").trim() && !(this._creatorState.npcCustomTalentDescriptions?.[index] ?? "").trim()) {
      const doc = await resolveUuidDoc(uuid);
      if (doc) {
        this._creatorState.npcCustomTalentNames[index] = doc.name ?? "";
        this._creatorState.npcCustomTalentDescriptions[index] = descriptionForDoc(doc);
      }
    }
    this._creatorState.npcTalentEditFlags[index] = true;
    this.render({ force: true });
  }

  static _onCancelEditNpcValue(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    if (Array.isArray(this._creatorState.npcCustomValueNames)) this._creatorState.npcCustomValueNames[index] = "";
    if (Array.isArray(this._creatorState.npcCustomValueDescriptions)) this._creatorState.npcCustomValueDescriptions[index] = "";
    if (Array.isArray(this._creatorState.npcValueEditFlags)) this._creatorState.npcValueEditFlags[index] = false;
    this.render({ force: true });
  }

  static _onCancelEditNpcFocus(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    if (Array.isArray(this._creatorState.npcCustomFocusNames)) this._creatorState.npcCustomFocusNames[index] = "";
    if (Array.isArray(this._creatorState.npcCustomFocusDescriptions)) this._creatorState.npcCustomFocusDescriptions[index] = "";
    if (Array.isArray(this._creatorState.npcFocusEditFlags)) this._creatorState.npcFocusEditFlags[index] = false;
    this.render({ force: true });
  }

  static _onCancelEditNpcTalent(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    if (Array.isArray(this._creatorState.npcCustomTalentNames)) this._creatorState.npcCustomTalentNames[index] = "";
    if (Array.isArray(this._creatorState.npcCustomTalentDescriptions)) this._creatorState.npcCustomTalentDescriptions[index] = "";
    if (Array.isArray(this._creatorState.npcTalentEditFlags)) this._creatorState.npcTalentEditFlags[index] = false;
    this.render({ force: true });
  }

  static _onRandomSupportingFocus(_event, target) {
    const index = Number(target.dataset.index);
    const type = this._creatorState.characterType;
    const limit = CHARACTER_TYPE_DEFINITIONS[type]?.focusCount ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= limit) return;

    const department = DISCIPLINE_KEYS.includes(this._creatorState.supportingDepartment)
      ? this._creatorState.supportingDepartment
      : "";
    if (!department) {
      ui.notifications.warn("STA2e Toolkit: Choose a department before rolling a focus.");
      return;
    }

    const focusUuids = normalizeUuidList(getCreatorData().config.departmentFocuses?.[department]);
    if (!focusUuids.length) {
      ui.notifications.warn(`STA2e Toolkit: Add ${departmentLabel(department)} focuses to Creator Data before rolling a random focus.`);
      return;
    }

    const alreadySelected = new Set((this._creatorState.supportingFocusUuids ?? []).filter((uuid, i) => uuid && i !== index));
    const available = focusUuids.filter(uuid => !alreadySelected.has(uuid));
    const pool = available.length ? available : focusUuids;
    this._creatorState.supportingFocusUuids[index] = pool[Math.floor(Math.random() * pool.length)];
    this._creatorState.supportingCustomFocusNames[index] = "";
    this.render({ force: true });
  }

  static _onRandomCareerFocus(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index > 2) return;

    const data = getCreatorData();
    const careerPaths = data.careerPaths.map(normalizeCareerPath).filter(careerPath => careerPath.name);
    const careerPath = careerPaths.find(path => path.id === this._creatorState.careerPathId) ?? careerPaths[0] ?? null;
    const selectedDepartments = [
      this._creatorState.careerDepartmentPlusTwo,
      ...(Array.isArray(this._creatorState.careerDepartmentPlusOne) ? this._creatorState.careerDepartmentPlusOne : []),
      this._creatorState.careerDepartmentReallocationTo,
    ].filter(key => DISCIPLINE_KEYS.includes(key));
    const focusUuids = lifepathFocusUuids(
      careerPath?.recommendedFocusUuids,
      data.config,
      selectedDepartments,
    );
    if (!focusUuids.length) {
      ui.notifications.warn("STA2e Toolkit: Add recommended focuses to this career path or choose career departments with configured focuses.");
      return;
    }

    const alreadySelected = new Set((this._creatorState.careerFocusUuids ?? []).filter((uuid, i) => uuid && i !== index));
    const available = focusUuids.filter(uuid => !alreadySelected.has(uuid));
    const pool = available.length ? available : focusUuids;
    this._creatorState.careerFocusUuids[index] = pool[Math.floor(Math.random() * pool.length)];
    this._creatorState.careerCustomFocusNames[index] = "";
    this.render({ force: true });
  }

  static _onRandomCareerEventFocus(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index > 1) return;

    const careerEvents = getCreatorData().careerEvents.map(normalizeCareerEvent).filter(event => event.name);
    const event = careerEvents.find(row => row.id === this._creatorState.careerEventIds?.[index]) ?? null;
    if (!event) {
      ui.notifications.warn("STA2e Toolkit: Choose a career event before rolling its focus.");
      return;
    }

    const focusUuids = normalizeUuidList(event.suggestedFocusUuids);
    if (!focusUuids.length) {
      ui.notifications.warn(`STA2e Toolkit: Add suggested focuses to ${event.name} before rolling a random event focus.`);
      return;
    }

    const alreadySelected = new Set((this._creatorState.careerEventFocusUuids ?? []).filter((uuid, i) => uuid && i !== index));
    const available = focusUuids.filter(uuid => !alreadySelected.has(uuid));
    const pool = available.length ? available : focusUuids;
    this._creatorState.careerEventFocusUuids[index] = pool[Math.floor(Math.random() * pool.length)];
    this._creatorState.careerEventCustomFocusNames[index] = "";
    this.render({ force: true });
  }

  static _onRandomCareerEvent(_event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index > 1) return;

    const careerEvents = getCreatorData().careerEvents.map(normalizeCareerEvent).filter(event => event.name);
    if (!careerEvents.length) {
      ui.notifications.warn("STA2e Toolkit: Add career events to Creator Config before rolling a random career event.");
      return;
    }

    const event = careerEvents[Math.floor(Math.random() * careerEvents.length)];
    this._creatorState.careerEventIds[index] = event.id;
    this._creatorState.careerEventAttributeKeys[index] = "";
    this._creatorState.careerEventDepartmentKeys[index] = "";
    this._creatorState.careerEventFocusUuids[index] = "";
    this._creatorState.careerEventCustomFocusNames[index] = "";
    this._creatorState.careerEventTraitUuids[index] = "";
    this._creatorState.careerEventCustomTraitNames[index] = "";
    this._creatorState.careerEventCustomTraitDescriptions[index] = "";
    ui.notifications.info(`STA2e Toolkit: Career Event ${index + 1}: ${event.name}`);
    this.render({ force: true });
  }

  static _onRandomUpbringing() {
    const upbringings = getCreatorData().upbringings.map(normalizeUpbringing).filter(upbringing => upbringing.name);
    if (!upbringings.length) {
      ui.notifications.warn("STA2e Toolkit: Add upbringings to Creator Config before rolling a random upbringing.");
      return;
    }

    const upbringing = upbringings[Math.floor(Math.random() * upbringings.length)];
    this._creatorState.upbringingId = upbringing.id;
    this._creatorState.upbringingDepartment = "";
    this._creatorState.upbringingFocusUuid = "";
    this._creatorState.upbringingCustomFocusName = "";
    this._creatorState.upbringingCustomFocusDescription = "";
    this._creatorState.upbringingTalentUuid = "";
    this.render({ force: true });
  }

  static _onRandomCareerPath() {
    const careerPaths = getCreatorData().careerPaths.map(normalizeCareerPath).filter(careerPath => careerPath.name);
    if (!careerPaths.length) {
      ui.notifications.warn("STA2e Toolkit: Add career paths to Creator Config before rolling a random career path.");
      return;
    }

    const careerPath = careerPaths[Math.floor(Math.random() * careerPaths.length)];

    ui.notifications.info(`STA2e Toolkit: Random Career Path: ${careerPath.name}`);
    this._creatorState.careerPathId = careerPath.id;
    this._creatorState.careerTraitUuid = "";
    this._creatorState.careerCustomTraitName = "";
    this._creatorState.careerCustomTraitDescription = "";
    this._creatorState.careerValueUuid = "";
    this._creatorState.careerCustomValueName = "";
    this._creatorState.careerCustomValueDescription = "";
    this._creatorState.careerAttributeSpends = {};
    this._creatorState.careerDepartmentPlusTwo = "";
    this._creatorState.careerDepartmentPlusOne = [];
    this._creatorState.careerDepartmentReallocationFrom = "";
    this._creatorState.careerDepartmentReallocationTo = "";
    this._creatorState.careerFocusUuids = ["", "", ""];
    this._creatorState.careerCustomFocusNames = ["", "", ""];
    this._creatorState.careerTalentUuid = "";
    this._creatorState.experienceValueUuid = "";
    this._creatorState.experienceCustomValueName = "";
    this._creatorState.experienceCustomValueDescription = "";
    this._creatorState.experienceTalentUuid = "";
    this.render({ force: true });
  }

  static async _onRandomizeNpc() {
    if (!game.user.isGM) {
      ui.notifications.warn("STA2e Toolkit: Only GMs can randomize NPCs.");
      return;
    }

    const definition = npcDefinitionForType(this._creatorState.characterType);
    if (!definition) return;

    const data = getCreatorData();
    const species = data.species.map(normalizeSpecies).filter(row => row.name);
    const primary = randomElement(species);
    if (!primary) {
      ui.notifications.warn("STA2e Toolkit: Add species to Creator Config before randomizing an NPC.");
      return;
    }

    const assignScores = (keys, values) => {
      const shuffled = shuffledCopy(values);
      return Object.fromEntries(keys.map((key, index) => [key, shuffled[index] ?? values[index] ?? 0]));
    };
    const randomCount = (min, max) => {
      const floor = Math.max(0, Number(min) || 0);
      const ceiling = Math.max(floor, Number(max) || floor);
      return floor + Math.floor(Math.random() * (ceiling - floor + 1));
    };

    this._creatorState.primarySpeciesId = primary.id;
    this._creatorState.mixedSpecies = false;
    this._creatorState.secondarySpeciesId = "";
    this._creatorState.selectedFreeAttributes = primary.freeAttributeSelection ? randomSample(ATTRIBUTE_KEYS, 3) : [];
    this._creatorState.selectedSpeciesAttributeChoice = randomElement(primary.attributeChoiceBoosts ?? []) ?? "";
    this._creatorState.npcAttributeAssignments = normalizeScoreArrayAssignments(assignScores(ATTRIBUTE_KEYS, definition.attributeArray), ATTRIBUTE_KEYS, definition.attributeArray);
    this._creatorState.npcDepartmentAssignments = normalizeScoreArrayAssignments(assignScores(DISCIPLINE_KEYS, definition.departmentArray), DISCIPLINE_KEYS, definition.departmentArray);

    const traits = await prepareUuidListForContext(data.config.traits);
    const roleTrait = randomElement(traits);
    this._creatorState.npcRoleTraitUuid = roleTrait?.uuid ?? "";
    this._creatorState.npcCustomRoleTraitName = roleTrait ? "" : `${definition.name} Role`;
    this._creatorState.npcCustomRoleTraitDescription = "";
    const extraTrait = definition.extraTraitCount ? randomElement(traits.filter(trait => trait.uuid !== roleTrait?.uuid)) : null;
    this._creatorState.npcExtraTraitUuid = extraTrait?.uuid ?? "";
    this._creatorState.npcCustomExtraTraitName = "";
    this._creatorState.npcCustomExtraTraitDescription = "";

    const values = await prepareUuidListForContext(data.config.values);
    const valueCount = definition.valueCount
      ? randomCount(definition.minValueCount ?? definition.valueCount, definition.valueCount)
      : 0;
    const selectedValues = randomSample(values, valueCount);
    this._creatorState.npcValueUuids = Array.from({ length: 4 }, (_slot, index) => selectedValues[index]?.uuid ?? "");
    this._creatorState.npcCustomValueNames = Array.from({ length: 4 }, (_slot, index) => {
      if (selectedValues[index]) return "";
      if (index >= valueCount) return "";
      return `${definition.name} Motivation ${index + 1}`;
    });
    this._creatorState.npcCustomValueDescriptions = ["", "", "", ""];
    this._creatorState.npcValueEditFlags = [false, false, false, false];
    this._creatorState.npcVisibleValueSlots = Math.min(definition.valueCount ?? 0, valueCount);

    const focuses = await prepareUuidListForContext(configuredFocusUuids(data.config));
    const focusCount = definition.focusCount
      ? randomCount(definition.minFocusCount ?? definition.focusCount, definition.focusCount)
      : 0;
    const selectedFocuses = randomSample(focuses, focusCount);
    this._creatorState.npcFocusUuids = Array.from({ length: 6 }, (_slot, index) => selectedFocuses[index]?.uuid ?? "");
    this._creatorState.npcCustomFocusNames = Array.from({ length: 6 }, (_slot, index) => {
      if (selectedFocuses[index]) return "";
      if (index >= focusCount) return "";
      return `${definition.name} Focus ${index + 1}`;
    });
    this._creatorState.npcCustomFocusDescriptions = ["", "", "", "", "", ""];
    this._creatorState.npcFocusEditFlags = [false, false, false, false, false, false];
    this._creatorState.npcVisibleFocusSlots = Math.min(definition.focusCount ?? 0, focusCount);

    const talents = await prepareUuidListForContext(allConfiguredTalentUuids(data.config, {
      includeNpc: true,
      includeEsoteric: true,
      includeAugment: true,
      includeCybernetic: true,
      includeBorgImplantCategory: true,
    }));
    const talentCount = randomCount(definition.minTalentCount ?? definition.talentCount, definition.talentCount);
    const selectedTalents = randomSample(talents, talentCount);
    this._creatorState.npcTalentUuids = Array.from({ length: 4 }, (_slot, index) => selectedTalents[index]?.uuid ?? "");
    this._creatorState.npcCustomTalentNames = Array.from({ length: 4 }, (_slot, index) => {
      if (selectedTalents[index]) return "";
      if (index >= talentCount) return "";
      return NPC_SPECIAL_RULE_FALLBACKS[index % NPC_SPECIAL_RULE_FALLBACKS.length];
    });
    this._creatorState.npcCustomTalentDescriptions = ["", "", "", ""];
    this._creatorState.npcTalentEditFlags = [false, false, false, false];
    this._creatorState.npcVisibleTalentSlots = Math.min(definition.talentCount ?? 0, talentCount);

    const equipment = await prepareUuidListForContext(uniqueUuidList([
      ...normalizeUuidList(data.config.items),
      ...normalizeUuidList(data.config.weapons),
      ...normalizeUuidList(data.config.armor),
    ]));
    this._creatorState.npcEquipmentUuids = randomSample(equipment, Math.min(equipment.length, randomCount(0, 2))).map(item => item.uuid);

    const gender = ["any", "male", "female"].includes(this._creatorState.randomNameGender) ? this._creatorState.randomNameGender : "any";
    this._creatorState.characterName = hasSpeciesNames(primary, gender)
      ? randomNameFromSpecies(primary, gender)
      : `${definition.name} ${Math.floor(Math.random() * 900 + 100)}`;
    this._creatorState.assignment = roleTrait?.name ?? this._creatorState.npcCustomRoleTraitName;
    this._creatorState.rankId = "";
    this._creatorState.rank = "";
    this._creatorState.pronouns = "";
    this._creatorState.npcNotes = `Randomized ${definition.name} created with STA2e Toolkit Character Creator.`;
    this._creatorState.step = 4;
    ui.notifications.info(`STA2e Toolkit: Randomized ${definition.name}. Review before finalizing.`);
    this.render({ force: true });
  }
}

export function openCharacterCreator(options = {}) {
  new CharacterCreator(options).render(true);
}
