/**
 * sta2e-toolkit | appearance-data.js
 *
 * The data rules behind Appearances — the toolkit's replacement for Token
 * Variant Art and Visage. A leaf with **no imports**, so the spawners
 * (token-spawn-utils.js) can use it from inside the creation path and the node
 * tests can load it with no Foundry at all.
 *
 * Two documents carry state:
 *
 *   Actor flag `appearance` — the library, edited in the Appearance Manager:
 *     { looks: [{id, name, token, portrait, scale, versions}],
 *       randomize, defaultLookId, baseVersions,
 *       rules: [{kind: "status"|"item", match, lookId, portrait}] }
 *   `versions` (and `baseVersions`, the Original's) are a look's own art for a
 *   rule — `{kind, match, token, portrait}`, keyed to the rule by `ruleKey` —
 *   so a look can have its own "dead" or "EV suit" form. The rule's look is the
 *   fallback for a look with none, and for a version's empty slot.
 *
 *   `appearanceState` — what this figure is wearing:
 *     { lookId, ruleLookId, ruleKey, mimic, baseline: {token, portrait, scale, ring, name} | null }
 *   `ruleKey` names the rule in force; `ruleLookId` alone cannot, since two
 *   rules may share one look and still carry different versions.
 *   `mimic` is another token's appearance copied wholesale (the changeling
 *   trick) — art, scale, ring, portrait and token name — or null.
 *   It lives on the TOKEN for an unlinked token and on the ACTOR for a linked
 *   one, because a linked character's portrait is shared by every token it has
 *   — two tokens of one PC must not disagree about whether the EV suit is on.
 *
 * **The baseline is what "original art" means.** It is captured the first time
 * the art leaves its original state (a pick or a rule) and dropped when it comes
 * back, so taking an EV suit off restores whatever was there before, whether or
 * not the GM ever made a look for it. A spawned NPC records its prototype art as
 * its baseline at creation. A baseline `portrait` of null means "no override" —
 * on an unlinked token that is `delta.img: null`, which falls back to the base
 * actor's portrait.
 *
 * **Nothing here browses a folder.** A random look is picked from the stored
 * list, synchronously, so it cannot fail at spawn time and fall back to a
 * wildcard path that also matches the portrait — which is the bug this whole
 * feature started from.
 */

export const MODULE          = "sta2e-toolkit";
export const LIBRARY_FLAG    = "appearance";
export const STATE_FLAG      = "appearanceState";
export const WORN_FLAG       = "worn";

/** Item types that can be worn. The system's `ArmorData.equipped` is deliberately
 *  ignored — it defaults to true and no sheet shows it, so carried armour would
 *  always count as worn. */
export const WEARABLE_TYPES = new Set(["armor", "item"]);

// ── Normalisation ────────────────────────────────────────────────────────────

const str = (v) => (typeof v === "string" ? v.trim() : "");

/** Case- and whitespace-insensitive key for matching an item rule to a name. */
export function nameKey(name) {
  return str(name).toLowerCase().replace(/\s+/g, " ");
}

/** A short id. `foundry.utils.randomID` is not available to a leaf under node. */
export function newLookId() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function _scale(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const _HEX = /^#[0-9a-f]{6}$/i;
const _color = (v) => (typeof v === "string" && _HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

/**
 * A dynamic token ring, as a look (or a baseline) carries it — or null for
 * "leave the token's ring alone". A look made by the Token Maker in baked mode
 * stores `{enabled: false}` explicitly, so its painted frame is never doubled
 * by a ring the prototype happened to have switched on.
 *
 * `subjectTexture` is only meaningful on a baseline (restoring a prototype that
 * named its own subject): a look's subject is always its own token art.
 */
export function normalizeRing(raw) {
  if (!raw || typeof raw !== "object") return null;
  const effects = Math.trunc(Number(raw.effects));
  const scale = Number(raw.subjectScale);
  return {
    enabled:         raw.enabled === true,
    ringColor:       _color(raw.ringColor),
    backgroundColor: _color(raw.backgroundColor),
    effects:         Number.isFinite(effects) && effects >= 0 ? effects : 1,
    subjectScale:    Number.isFinite(scale) && scale >= 0.5 ? scale : 1,
    subjectTexture:  str(raw.subjectTexture),
  };
}

/** The Token Maker's recipe — kept as plain JSON, anything else dropped. */
function _maker(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  try { return JSON.parse(JSON.stringify(raw)); } catch { return null; }
}

/** A rule's identity, by what triggers it — reordering rules keeps versions attached. */
export function ruleKey(rule) {
  if (!rule) return "";
  const kind = rule.kind === "item" ? "item" : "status";
  const match = kind === "item" ? nameKey(rule.match) : str(rule.match);
  return match ? `${kind}:${match}` : "";
}

/** A look's own art for one rule, or null when it has no match or no art. */
export function normalizeVersion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const v = {
    kind:     raw.kind === "item" ? "item" : "status",
    match:    str(raw.match),
    token:    str(raw.token),
    portrait: str(raw.portrait),
  };
  return v.match && (v.token || v.portrait) ? v : null;
}

function _versions(raw) {
  const out = [];
  const seen = new Set();
  for (const v of (Array.isArray(raw) ? raw : []).map(normalizeVersion)) {
    const key = ruleKey(v);
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** The version `owner` (a look, or `{versions}`) carries for `rule`, or null. */
export function findVersion(owner, rule) {
  const key = ruleKey(rule);
  if (!key || !owner?.versions?.length) return null;
  return owner.versions.find(v => ruleKey(v) === key && (v.token || v.portrait)) ?? null;
}

export function normalizeLook(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    id:       str(r.id) || newLookId(),
    name:     str(r.name),
    token:    str(r.token),
    portrait: str(r.portrait),
    scale:    _scale(r.scale),
    ring:     normalizeRing(r.ring),
    maker:    _maker(r.maker),
    // Shown on the token only; the actor (and its sheet) keep their name.
    tokenName: str(r.tokenName),
    // A form stored from a mimic: never rolled for a new token at random.
    mimicked: r.mimicked === true,
    versions: _versions(r.versions),
  };
}

/**
 * A copied appearance (Mimic). Shaped like a look — `token`, `portrait`,
 * `scale`, `ring`, `tokenName` — so composition treats it as one more layer,
 * plus `from`, the name of the token it was copied from, for display.
 */
export function normalizeMimic(raw) {
  if (!raw || typeof raw !== "object") return null;
  const m = {
    token:     str(raw.token),
    portrait:  str(raw.portrait),
    scale:     _scale(raw.scale),
    ring:      normalizeRing(raw.ring),
    tokenName: str(raw.tokenName),
    from:      str(raw.from),
  };
  return m.token || m.portrait || m.tokenName ? m : null;
}

export function normalizeRule(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    kind:     r.kind === "item" ? "item" : "status",
    match:    str(r.match),
    lookId:   str(r.lookId),
    portrait: r.portrait !== false,
  };
}

/** Whatever is stored under the actor flag, as a well-formed library. */
export function normalizeLibrary(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const looks = (Array.isArray(r.looks) ? r.looks : []).map(normalizeLook);
  // Two looks sharing an id (a hand edit, a bad import) would make one of them
  // unreachable. Re-roll the later one.
  const seen = new Set();
  for (const look of looks) {
    while (seen.has(look.id)) look.id = newLookId();
    seen.add(look.id);
  }
  const ids = new Set(looks.map(l => l.id));
  return {
    looks,
    randomize:     r.randomize === true,
    defaultLookId: ids.has(str(r.defaultLookId)) ? str(r.defaultLookId) : null,
    rules:         (Array.isArray(r.rules) ? r.rules : []).map(normalizeRule),
    // The Token Maker recipe behind the Original (prototype) token art.
    baseMaker:     _maker(r.baseMaker),
    // The Original's own versions, used while no look (and no mimic) is on.
    baseVersions:  _versions(r.baseVersions),
  };
}

export function normalizeState(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const b = r.baseline && typeof r.baseline === "object" ? r.baseline : null;
  return {
    lookId:     str(r.lookId) || null,
    ruleLookId: str(r.ruleLookId) || null,
    ruleKey:    str(r.ruleKey) || null,
    mimic:     normalizeMimic(r.mimic),
    baseline:   b ? { token: str(b.token), portrait: str(b.portrait) || null, scale: _scale(b.scale), ring: normalizeRing(b.ring), name: str(b.name) || null } : null,
  };
}

/** The library stored on an actor (or an empty one). */
export function readLibrary(actor) {
  let raw = null;
  try { raw = actor?.getFlag?.(MODULE, LIBRARY_FLAG) ?? null; } catch { raw = null; }
  return normalizeLibrary(raw);
}

export function hasLooks(library) {
  return (library?.looks ?? []).some(l => l.token || l.portrait);
}

export function findLook(library, id) {
  if (!id) return null;
  return library?.looks?.find(l => l.id === id) ?? null;
}

// ── Picking ──────────────────────────────────────────────────────────────────

/**
 * The look a newly placed token should wear: a random one when the library
 * randomizes, otherwise the default, otherwise none (keep the prototype art).
 * Only looks with token art are candidates for a random roll — a portrait-only
 * look would leave the map showing the prototype under a stranger's portrait.
 */
export function pickLook(library, { random = library?.randomize, rng = Math.random } = {}) {
  if (!library) return null;
  if (random) {
    const pool = library.looks.filter(l => l.token && !l.mimicked);
    if (pool.length) return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  }
  return findLook(library, library.defaultLookId);
}

// ── Rules ────────────────────────────────────────────────────────────────────

/**
 * What a figure currently has going on that a rule could match.
 *
 * @param {object} src
 * @param {Iterable<string>} [src.statuses]   Core status ids (`actor.statuses`)
 * @param {string[]}         [src.conditions] Toolkit condition keys
 * @param {string|null}      [src.defenseMode]
 * @param {Array<{name, type, worn}>} [src.items]
 */
export function collectTriggers({ statuses = [], conditions = [], defenseMode = null, items = [] } = {}) {
  const status = new Set();
  for (const s of statuses ?? []) if (s) status.add(String(s));
  for (const c of conditions ?? []) if (c) status.add(String(c));
  if (defenseMode) status.add(String(defenseMode));
  const worn = new Set();
  for (const it of items ?? []) {
    if (it?.worn && WEARABLE_TYPES.has(it.type)) worn.add(nameKey(it.name));
  }
  return { status, worn };
}

/** The first rule that both matches and points at a look that still exists. */
export function matchRule(library, triggers) {
  if (!library || !triggers) return null;
  for (const rule of library.rules) {
    if (!rule.match || !findLook(library, rule.lookId)) continue;
    const hit = rule.kind === "item"
      ? triggers.worn.has(nameKey(rule.match))
      : triggers.status.has(rule.match);
    if (hit) return rule;
  }
  return null;
}

// ── Composition ──────────────────────────────────────────────────────────────

/**
 * The art a figure should show, and the state that produces it.
 *
 * Precedence: a matching rule, then a mimic, then the chosen look, then the
 * baseline. Each slot (art, portrait, scale, ring, token name) is taken from the
 * first layer that sets it, and falls back to the baseline — so switching from a
 * look with a portrait to one without puts the original portrait back rather
 * than leaving the last one stuck, and ending a mimic restores the token's own
 * name. A rule with `portrait: false` changes the map art only; its portrait
 * comes from the layers beneath it.
 *
 * @param {object} args
 * @param {object} args.library   normalizeLibrary output
 * @param {object} args.state     normalizeState output
 * @param {object|null} args.rule matchRule output
 * @param {{token, portrait, scale}} args.current  What the figure shows right
 *   now — captured as the baseline when the art first leaves its original state.
 * @returns {{visual: {token, portrait, scale}|null, state: object}}
 *   `visual` null means "leave the art alone" (no look, no baseline to restore).
 */
export function composeAppearance({ library, state, rule, current }) {
  const next = { ...state, ruleLookId: rule?.lookId ?? null, ruleKey: rule ? (ruleKey(rule) || null) : null };
  const chosen = findLook(library, next.lookId);
  if (!chosen) next.lookId = null;
  const ruleLook = rule ? findLook(library, rule.lookId) : null;

  const mimic = next.mimic ?? null;

  // The worn look's own version of this rule (the Original's, when nothing is
  // worn) takes the rule look's place. Its empty slots fall back to the rule's
  // look; scale, ring and name come from the layers beneath, since a version is
  // drawn for its own look's framing. Its portrait is explicit, so it shows even
  // when the rule leaves the portrait alone.
  const version = ruleLook
    ? findVersion(chosen ?? (mimic ? null : { versions: library?.baseVersions }), rule)
    : null;
  const ruled = version
    ? {
        token:     version.token || ruleLook.token,
        portrait:  version.portrait || (rule.portrait === false ? "" : ruleLook.portrait),
        scale:     null,
        ring:      null,
        tokenName: "",
      }
    : ruleLook;

  // Back to original: restore the baseline once, then forget it.
  if (!ruled && !chosen && !mimic) {
    if (!next.baseline) return { visual: null, state: next };
    const visual = { ...next.baseline };
    next.baseline = null;
    return { visual, state: next };
  }

  if (!next.baseline) {
    next.baseline = {
      token:    str(current?.token),
      portrait: str(current?.portrait) || null,
      scale:    _scale(current?.scale),
      ring:     normalizeRing(current?.ring),
      name:     str(current?.name) || null,
    };
  }
  const base = next.baseline;
  const layers = [ruled, mimic, chosen].filter(Boolean);
  const first = (key, { skipRule = false, empty = (v) => !v } = {}) => {
    for (const l of layers) {
      if (skipRule && l === ruled) continue;
      if (!empty(l[key])) return l[key];
    }
    return null;
  };
  const unset = (v) => v === null || v === undefined;
  const visual = {
    token:    first("token") || base.token,
    portrait: first("portrait", { skipRule: !!ruled && !version && rule.portrait === false }) || base.portrait,
    scale:    first("scale", { empty: unset }) ?? base.scale,
    ring:     first("ring", { empty: unset }) ?? base.ring ?? null,
    name:     first("tokenName") || base.name || null,
  };
  return { visual, state: next };
}

/**
 * Carry a change of ORIGINAL art (the prototype token and the actor portrait,
 * edited in the Appearance Manager) onto a figure already on a scene. A slot
 * moves only where it still holds the old original — a token the GM has since
 * re-dressed by hand keeps what it has.
 *
 * - Undressed (`baseline` null): `patch` is the slots to write on the token now.
 * - Dressed (a `baseline` remembered): `baseline` is that record rewritten, so
 *   taking the look off restores the NEW original; nothing is drawn now.
 *
 * Only the slots present in `current` (or the baseline) are compared, so a
 * caller leaves `portrait` out where the portrait lives somewhere else.
 *
 * @returns {{patch: object|null, baseline: object|null}}
 */
export function rebaseVisual({ oldBase, newBase, current = null, baseline = null }) {
  const from = baseline ?? current;
  if (!from || !oldBase || !newBase) return { patch: null, baseline: null };
  // A ring is compared without its art: its subject defaults to the token art
  // (and a token read back from the canvas names that art explicitly), so the
  // art changing must not read as the ring changing.
  const ringSansArt = (o) => {
    const r = normalizeRing(o?.ring);
    if (r && r.subjectTexture && r.subjectTexture === str(o.token)) r.subjectTexture = "";
    return _ringKey(r, "");
  };
  const same = {
    token:    (a, b) => str(a.token) === str(b.token),
    portrait: (a, b) => (str(a.portrait) || null) === (str(b.portrait) || null),
    scale:    (a, b) => (_scale(a.scale) ?? 1) === (_scale(b.scale) ?? 1),
    ring:     (a, b) => ringSansArt(a) === ringSansArt(b),
  };
  const patch = {};
  for (const key of Object.keys(same)) {
    if (!(key in from)) continue;
    if (same[key](newBase, oldBase)) continue;      // this slot did not change
    if (!same[key](from, oldBase)) continue;        // the figure moved off the old original
    patch[key] = newBase[key] ?? null;
  }
  // New art under a ring that pointed its subject at the old art: re-point it.
  const fromRing = normalizeRing(from.ring);
  if (patch.token && !("ring" in patch) && fromRing?.enabled && fromRing.subjectTexture === str(from.token)) {
    patch.ring = { ...fromRing, subjectTexture: "" };
  }
  if (!Object.keys(patch).length) return { patch: null, baseline: null };
  if (baseline) return { patch: null, baseline: { ...baseline, ...patch } };
  return { patch, baseline: null };
}

/** True when two visuals would draw the same thing. */
export function sameVisual(a, b) {
  if (!a || !b) return false;
  return str(a.token) === str(b.token)
    && (str(a.portrait) || null) === (str(b.portrait) || null)
    && (_scale(a.scale) ?? null) === (_scale(b.scale) ?? null)
    && _ringKey(a.ring, a.token) === _ringKey(b.ring, b.token)
    && (str(a.name) || null) === (str(b.name) || null);
}

/** A ring's identity for comparison; null means "unspecified". */
function _ringKey(ring, token) {
  const r = normalizeRing(ring);
  if (!r) return "";
  if (!r.enabled) return "off";
  return JSON.stringify({ ...r, subjectTexture: r.subjectTexture || str(token) });
}

/**
 * Flat token update paths for a ring. An enabled ring shows the token art as
 * its subject unless the ring names its own.
 */
export function ringUpdates(ring, token) {
  const r = normalizeRing(ring);
  if (!r) return {};
  const out = { "ring.enabled": r.enabled };
  if (!r.enabled) return out;
  out["ring.colors.ring"] = r.ringColor;
  out["ring.colors.background"] = r.backgroundColor;
  out["ring.effects"] = r.effects;
  out["ring.subject.scale"] = r.subjectScale;
  out["ring.subject.texture"] = r.subjectTexture || str(token) || null;
  return out;
}

/**
 * Document updates that put `visual` on a token.
 *
 * @param {{token, portrait, scale}} visual
 * @param {object} opts
 * @param {boolean} opts.linked   Linked token — the portrait goes on the actor.
 * @param {{scaleX:number, scaleY:number}} [opts.currentScale] Kept for its sign,
 *   so a mirrored token stays mirrored when a look sets a scale.
 * @returns {{token: object, actor: object|null}} Flat update paths.
 */
export function visualUpdates(visual, { linked, currentScale = { scaleX: 1, scaleY: 1 } } = {}) {
  const token = {};
  if (visual.token) token["texture.src"] = visual.token;
  if (visual.scale) {
    token["texture.scaleX"] = Math.sign(currentScale.scaleX || 1) * visual.scale;
    token["texture.scaleY"] = Math.sign(currentScale.scaleY || 1) * visual.scale;
  }
  Object.assign(token, ringUpdates(visual.ring, visual.token));
  if (visual.name) token.name = visual.name;
  let actor = null;
  if (linked) {
    if (visual.portrait) actor = { img: visual.portrait };
  } else {
    token["delta.img"] = visual.portrait || null;
  }
  return { token, actor };
}

/** Write a ring into nested token creation data. */
function _applyRingToData(data, ring, token) {
  const r = normalizeRing(ring);
  if (!r) return;
  data.ring ??= {};
  data.ring.enabled = r.enabled;
  if (!r.enabled) return;
  data.ring.colors = { ring: r.ringColor, background: r.backgroundColor };
  data.ring.effects = r.effects;
  data.ring.subject = { scale: r.subjectScale, texture: r.subjectTexture || token || null };
}

/** Put a composed visual onto nested token creation data. */
function _applyVisualToData(data, visual, { linked }) {
  if (visual.token) data.texture.src = visual.token;
  if (visual.scale) {
    data.texture.scaleX = Math.sign(data.texture.scaleX || 1) * visual.scale;
    data.texture.scaleY = Math.sign(data.texture.scaleY || 1) * visual.scale;
  }
  _applyRingToData(data, visual.ring, visual.token);
  if (visual.name) data.name = visual.name;
  if (!linked) data.delta = { ...(data.delta ?? {}), img: visual.portrait || null };
}

/** What a token being created would show by itself — the "current" for composition. */
function _dataCurrent(data) {
  return {
    token:    str(data.texture?.src),
    portrait: null,
    scale:    Math.abs(Number(data.texture?.scaleX ?? 1)) || 1,
    ring:     ringFromToken(data.ring),
    name:     str(data.name) || null,
  };
}

/**
 * The rule a stored `ruleLookId` came from. A token being created has no
 * statuses yet to re-match against, so the stored override stands until the
 * next re-evaluation; the library's own rule supplies its portrait setting.
 */
function _ruleFor(library, state) {
  if (!state.ruleLookId) return null;
  // By key first: two rules can share a look but carry different versions.
  const byKey = state.ruleKey ? library.rules.find(r => r.lookId === state.ruleLookId && ruleKey(r) === state.ruleKey) : null;
  return byKey ?? library.rules.find(r => r.lookId === state.ruleLookId) ?? { kind: "status", match: "", lookId: state.ruleLookId, portrait: true };
}

/** True when a stored state is wearing anything — a look, a rule's look or a mimic. */
export function stateIsDressed(raw) {
  const s = normalizeState(raw);
  return !!(s.lookId || s.ruleLookId || s.mimic);
}

/**
 * Appearance for a token about to be created from an actor's prototype —
 * mutates `data` (token creation data, nested form) in place.
 *
 * - An `override` (a restored transporter / Q pattern) is the captured state,
 *   composed exactly as a live token is: the same look, the same MIMIC — art,
 *   scale, ring and token name — and the exact portrait it left with.
 * - A linked token wears whatever its actor is wearing now — its look, its
 *   rule's look, or its mimic — so a PC placed on a new scene (or beamed in)
 *   arrives in the EV suit, or still disguised.
 * - An unlinked token rolls from the library (`pickLook`).
 *
 * @param {object} data       Token creation data (from prototypeToken.toObject()).
 * @param {object} library    normalizeLibrary output for the actor.
 * @param {object} opts
 * @param {object|null} [opts.actorState]  normalizeState of the actor (linked).
 * @param {{state: object, portrait: string|null}|null} [opts.override]
 * @param {Function} [opts.rng]
 * @returns {boolean} true when it changed anything.
 */
export function applyCreationAppearance(data, library, { actorState = null, override = null, rng } = {}) {
  data.texture ??= {};
  data.flags ??= {};
  data.flags[MODULE] ??= {};
  const linked = !!data.actorLink;

  if (override?.state && !linked) {
    const state = normalizeState(override.state);
    const { visual, state: next } = composeAppearance({
      library, state, rule: _ruleFor(library, state), current: _dataCurrent(data),
    });
    if (visual) _applyVisualToData(data, visual, { linked: false });
    // The exact portrait it left with wins over the recomposed one.
    if ("portrait" in override) data.delta = { ...(data.delta ?? {}), img: override.portrait || null };
    data.flags[MODULE][STATE_FLAG] = next;
    return true;
  }

  if (linked) {
    const s = normalizeState(actorState);
    if (!stateIsDressed(s)) return false;
    const { visual } = composeAppearance({ library, state: s, rule: _ruleFor(library, s), current: _dataCurrent(data) });
    if (!visual) return false;
    _applyVisualToData(data, visual, { linked: true });
    return true;
  }

  if (!hasLooks(library)) return false;
  const look = pickLook(library, { rng });
  if (!look) return false;
  const baseline = {
    token:    str(data.texture.src),
    portrait: null,
    scale:    _scale(Math.abs(Number(data.texture.scaleX ?? 1))),
    ring:     ringFromToken(data.ring),
    // Only when the look renames the token: otherwise restoring the baseline
    // would undo a name given after creation (the wildcard namer runs then).
    name:     look.tokenName ? (str(data.name) || null) : null,
  };
  if (look.token) data.texture.src = look.token;
  if (look.scale) {
    data.texture.scaleX = Math.sign(data.texture.scaleX || 1) * look.scale;
    data.texture.scaleY = Math.sign(data.texture.scaleY || 1) * look.scale;
  }
  if (look.portrait) data.delta = { ...(data.delta ?? {}), img: look.portrait };
  if (look.tokenName) data.name = look.tokenName;
  _applyRingToData(data, look.ring, look.token);
  data.flags[MODULE][STATE_FLAG] = { lookId: look.id, ruleLookId: null, baseline };
  return true;
}

/** A token's (or creation data's) ring field as a normalized ring, for a baseline. */
export function ringFromToken(ring) {
  if (!ring || typeof ring !== "object") return null;
  return normalizeRing({
    enabled:         ring.enabled === true,
    ringColor:       ring.colors?.ring ?? null,
    backgroundColor: ring.colors?.background ?? null,
    effects:         ring.effects,
    subjectScale:    ring.subject?.scale,
    subjectTexture:  ring.subject?.texture ?? "",
  });
}

// ── Stored forms ─────────────────────────────────────────────────────────────

/**
 * Turn the mimic a token is wearing into a look for its library — a "stored
 * form" the changeling can take again later without the original present.
 * Returns `{library, look, duplicate}`: when the library already holds a look
 * with the same art and token name, nothing is added and `duplicate` is that
 * look, so storing twice is harmless.
 *
 * @param {object} library  normalizeLibrary output
 * @param {object} mimic    normalizeMimic output
 */
export function storeMimicInLibrary(library, mimic) {
  const m = normalizeMimic(mimic);
  if (!m) return { library, look: null, duplicate: null };
  const duplicate = library.looks.find(l =>
    l.token === m.token && (l.tokenName || "") === (m.tokenName || "") && (l.portrait || "") === (m.portrait || "")) ?? null;
  if (duplicate) return { library, look: null, duplicate };
  const look = normalizeLook({
    id:        newLookId(),
    name:      m.from || m.tokenName || "Stored form",
    token:     m.token,
    portrait:  m.portrait,
    scale:     m.scale,
    ring:      m.ring,
    tokenName: m.tokenName,
    mimicked:  true,
  });
  return { library: { ...library, looks: [...library.looks, look] }, look, duplicate: null };
}

// ── Mimic access ─────────────────────────────────────────────────────────────

export const MIMIC_ACCESS = ["trait", "anyone", "gm"];

/** An actor's trait names: trait items plus the free-text `system.traits` field. */
export function actorTraitNames({ items = [], traitsText = "" } = {}) {
  const out = [];
  for (const i of items ?? []) if (i?.type === "trait" && i.name) out.push(String(i.name));
  if (typeof traitsText === "string") {
    for (const t of traitsText.split(/[,;\n]/)) if (t.trim()) out.push(t.trim());
  }
  return out;
}

/**
 * Whether a user may put a Mimic on a token.
 *
 * - GMs always may.
 * - `access: "anyone"` — any user who owns the token.
 * - `access: "trait"` — the token's actor must carry one of `traits`, matched
 *   as a whole word, case-insensitively, so "Changeling" matches a trait named
 *   "Changeling (Founder)" but not "Unchangeling".
 * - `access: "gm"` — GMs only.
 *
 * Ending a mimic is never gated; only starting one is.
 */
export function mayMimic({ isGM = false, access = "trait", traits = [], actorTraits = [] } = {}) {
  if (isGM) return true;
  if (access === "anyone") return true;
  if (access !== "trait") return false;
  const words = traits.map(t => String(t).trim().toLowerCase()).filter(Boolean);
  if (!words.length) return false;
  return actorTraits.some((name) => {
    const n = String(name).toLowerCase();
    return words.some(w => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(n));
  });
}

// ── Bulk fill ────────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(webp|png|jpe?g|gif|svg|avif|webm|mp4)$/i;

export function parseKeywords(text) {
  return String(text ?? "").split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

function _fileStem(path) {
  const file = String(path).split("/").pop() ?? "";
  return decodeURIComponent(file).replace(IMAGE_EXT, "");
}

/** Remove one keyword (as a whole token between separators) from a stem. */
function _stripKeyword(stem, keyword) {
  const re = new RegExp(`(^|[\\s._-])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s._-])`, "i");
  return re.test(stem) ? stem.replace(re, "").replace(/^[\s._-]+|[\s._-]+$/g, "") : null;
}

/** Which slot a file belongs in by its name: "token", "portrait" or null. */
export function classifyImage(path, { tokenKeywords = ["token"], portraitKeywords = ["portrait"] } = {}) {
  const stem = _fileStem(path);
  for (const k of portraitKeywords) if (_stripKeyword(stem, k) !== null) return "portrait";
  for (const k of tokenKeywords) if (_stripKeyword(stem, k) !== null) return "token";
  return null;
}

/**
 * Turn a folder's worth of images into looks, pairing files that share a stem
 * once the slot keyword is removed: `Klingon_03_token.webp` and
 * `Klingon_03_portrait.webp` become one look named "Klingon 03". An image with
 * no keyword fills both slots. A lone portrait becomes a portrait-only look.
 *
 * @param {string[]} paths
 * @returns {Array<{name, token, portrait}>} in first-seen order
 */
export function pairImages(paths, { tokenKeywords = ["token"], portraitKeywords = ["portrait"] } = {}) {
  const groups = new Map();
  for (const path of paths ?? []) {
    if (!IMAGE_EXT.test(String(path))) continue;
    const stem = _fileStem(path);
    let slot = null;
    let key  = stem;
    for (const k of portraitKeywords) {
      const s = _stripKeyword(stem, k);
      if (s !== null) { slot = "portrait"; key = s; break; }
    }
    if (!slot) {
      for (const k of tokenKeywords) {
        const s = _stripKeyword(stem, k);
        if (s !== null) { slot = "token"; key = s; break; }
      }
    }
    const id = key.toLowerCase();
    if (!groups.has(id)) groups.set(id, { name: key.replace(/[._-]+/g, " ").trim(), token: "", portrait: "", plain: "" });
    const g = groups.get(id);
    if (slot === "portrait") g.portrait ||= path;
    else if (slot === "token") g.token ||= path;
    else g.plain ||= path;
  }
  return [...groups.values()].map(g => ({
    name:     g.name,
    token:    g.token || g.plain,
    portrait: g.portrait || g.plain,
  }));
}

/**
 * Looks from a Visage `alternateVisages` flag — an object keyed by id, or the
 * legacy array. Only the art and scale carry over; Visage's lighting, rings,
 * dimensions and its own automation have no counterpart here.
 */
export function looksFromVisage(raw) {
  const entries = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const c = e.changes ?? e;
    const token = str(c?.texture?.src ?? c?.img ?? e.path);
    const portrait = str(c?.portrait);
    if (!token && !portrait) continue;
    out.push({
      name:     str(e.label) || str(e.name) || str(c?.name) || "Visage",
      token,
      portrait,
      scale:    _scale(c?.scale ?? e.scale),
    });
  }
  return out;
}
