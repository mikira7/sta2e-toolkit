/**
 * sta2e-toolkit | combat/initiative-order.js
 * STA 2e round-robin turn order, per-turn action economy, and the turn-order spends.
 *
 * The `sta` system ships a "popcorn" tracker: the GM clicks a row and
 * `Combat2d20#setTurn(i)` activates it. Nothing enforces *sides*, nothing
 * remembers who went last round, and nothing tracks Minor/Major actions.
 * This module is the rules engine for all three. It owns no DOM — the sidebar
 * injection lives in `initiative-tracker-ui.js`.
 *
 * We deliberately do NOT subclass `Combat2d20` / `CombatTracker2d20V2`. The system
 * installs those into CONFIG inside its own `Hooks.once("ready")`
 * (systems/sta/module/sta.mjs:495-499), so a module subclass has to race that hook
 * or re-instantiate an already-rendered sidebar. Instead we ride `updateCombat`,
 * which `setTurn` triggers anyway via `this.update({round, turn})`.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 * Combat flag `flags.sta2e-toolkit.initiative`:
 *   { round, firstSide, lastSide, sequence: [combatantId], hold }
 *
 * `hold` is one mechanism serving two buttons:
 *   Keep the Initiative  → { side: "crew", kind: "keep",  round, chained: false }
 *   Seize the Initiative → { side: "npc",  kind: "seize", round, chained: false }
 * Either way the next activation is forced to `hold.side`; once it happens
 * `chained: true` forces the *opposite* side after it. That is exactly the
 * "once that ally has acted, the next turn must go to an enemy" clause, and
 * equally the right behaviour for a seizure handing the turn back.
 *
 * Combatant flag `flags.sta2e-toolkit.turnActions`:
 *   { round, minorUsed, minorMax, majorUsed, majorMax, extraMajorDiff }
 *
 * ── Terminology ──────────────────────────────────────────────────────────────
 * `actionsRemaining` (the system's flag) is a DIFFERENT axis: how many *turns*
 * a combatant gets per round — 1 for characters, Scale for ships. The Minor/Major
 * budget here is per-turn and does not collide with it.
 */

import { adjustPool, readPool } from "../pool-service.js";
import { getLcTokens } from "../lcars-theme.js";
import { getCrewManifest, STATION_SLOTS } from "../crew-manifest.js";

/**
 * CombatHUD's side-detection statics, resolved lazily off the public API.
 *
 * Importing combat-hud-core.js directly would drag a 23k-line module into
 * everything that touches turn order (npc-roller, opposed-task, toolkit-api) and
 * close another import cycle through npc-roller. Every caller here runs during
 * combat, long after `ready` publishes the class reference.
 */
function _hud() {
  return game.sta2eToolkit?.CombatHUD ?? null;
}

const MODULE    = "sta2e-toolkit";
const FLAG_INIT = "initiative";
const FLAG_ACTS = "turnActions";
const FLAG_SIDE = "combatSide";

export const SIDE_CREW = "crew";
export const SIDE_NPC  = "npc";

/** Human labels. Kept here so the UI and the chat cards can never disagree. */
export const SIDE_LABEL = { [SIDE_CREW]: "Crew", [SIDE_NPC]: "NPC" };

export function opposite(side) {
  return side === SIDE_NPC ? SIDE_CREW : SIDE_NPC;
}

/** Master on/off. Every entry point checks this so the feature is inert when disabled. */
export function initiativeEnabled() {
  try { return game.settings.get(MODULE, "initiativeRoundRobin") !== false; }
  catch { return false; }
}

function _setting(key, fallback) {
  try {
    const v = game.settings.get(MODULE, key);
    return v === undefined || v === null ? fallback : v;
  } catch { return fallback; }
}

/** Cost of each spend, in Momentum or Threat. GM-configurable. */
export function spendCost(kind) {
  switch (kind) {
    case "keep":       return Number(_setting("keepInitiativeCost", 2))  || 2;
    case "seize":      return Number(_setting("seizeInitiativeCost", 2)) || 2;
    case "extraMinor": return Number(_setting("extraMinorCost", 1))      || 1;
    case "extraMajor": return Number(_setting("extraMajorCost", 2))      || 2;
    default:           return 0;
  }
}

export const SPEND_LABEL = {
  keep:       "Keep the Initiative",
  seize:      "Seize the Initiative",
  extraMinor: "Extra Minor Action",
  extraMajor: "Extra Major Action",
};

// ─────────────────────────────────────────────────────────────────────────────
// Side classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which side a combatant fights on.
 *
 * MUST tolerate `combatant.token === null`. `main.js`'s createCombatant hook
 * auto-creates tokenless, actor-only combatants for every officer on a ship's
 * crew manifest, and in ship combat those are the majority of the tracker. Side
 * detection therefore leans on the actor, never on token disposition, except as
 * a last resort.
 *
 * @param {Combatant} combatant
 * @returns {"crew"|"npc"}
 */
export function sideOf(combatant) {
  if (!combatant) return SIDE_NPC;

  // 1. Explicit GM override always wins.
  const override = combatant.getFlag?.(MODULE, FLAG_SIDE);
  if (override === SIDE_CREW || override === SIDE_NPC) return override;

  const actor = combatant.actor ?? null;
  if (!actor) return SIDE_NPC;

  const tokenDoc = combatant.token ?? null;
  const HUD      = _hud();

  if (HUD) {
    // 2. Ships carry their own allegiance flags.
    const profile = HUD.getGroundCombatProfile(actor, tokenDoc);
    if (profile.isShip) {
      if (HUD.isAlliedNpcActor(actor)) return SIDE_CREW;
      return HUD.isNpcShip(actor) ? SIDE_NPC : SIDE_CREW;
    }

    // 3. Ground characters. `getGroundCombatProfile` deliberately does not trust
    //    `hasPlayerOwner` alone — it layers sheet class, npcType and stress track.
    if (HUD.isAlliedNpcActor(actor)) return SIDE_CREW;
    if (profile.isPlayerOwned) return SIDE_CREW;
  } else if (actor.hasPlayerOwner) {
    return SIDE_CREW;   // API not published yet — coarse but never wrong-by-default
  }

  // 4. Last resort: token disposition, for hand-placed tokens with no flags.
  if (tokenDoc?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return SIDE_CREW;
  return SIDE_NPC;
}

const FLAG_ACTIVATIONS = "activations";   // per-combatant override, 0 = stand by

/**
 * Is this a player ship whose bridge officers are in the tracker as their own
 * combatants?
 *
 * The module's createCombatant hook adds one combatant per assigned officer, so
 * a player ship would otherwise take Scale-many turns of its own *on top of*
 * every officer's turn — inflating the crew side and wrecking the alternation.
 * Allied and hostile NPC ships are unaffected: they act as ships.
 */
function _isStandbyShip(combat, combatant) {
  const actor = combatant?.actor;
  if (!actor) return false;
  if (_setting("initiativeShipStandby", true) === false) return false;

  const HUD = _hud();
  const isShip = HUD
    ? HUD.getGroundCombatProfile(actor, combatant.token ?? null).isShip
    : (actor.type === "starship" || actor.type === "spacecraft2e");
  if (!isShip) return false;
  if (HUD?.isNpcShip(actor)) return false;          // NPC ships act normally

  // Safety: only stand the ship down if its officers are actually present. A
  // player ship fielded without its crew must still be able to act, or the crew
  // side would have nobody in the running order at all.
  return _shipHasCrewInCombat(combat, actor);
}

function _shipHasCrewInCombat(combat, shipActor) {
  let manifest;
  try { manifest = getCrewManifest(shipActor); } catch { return false; }
  if (!manifest) return false;

  const officerIds = new Set();
  for (const slot of STATION_SLOTS) {
    for (const id of manifest[slot.id] ?? []) if (id) officerIds.add(id);
  }
  if (!officerIds.size) return false;

  for (const c of combat.combatants) {
    if (c.actorId && officerIds.has(c.actorId)) return true;
  }
  return false;
}

/**
 * How many turns this combatant gets per round. 1 for characters, Scale for
 * ships — the system's own rule, when the popcorn tracker is installed — and
 * 0 for a player ship standing by while its officers act.
 *
 * Note this cannot be expressed through the system: `Combat2d20`'s
 * `_clampAPRByType` floors ships at 1, so `sta.actionsPerRoundOverride = 0`
 * would be silently raised back to 1.
 */
function _maxActivations(combat, combatant) {
  // Explicit per-combatant override always wins, including an explicit 0.
  const override = combatant?.getFlag?.(MODULE, FLAG_ACTIVATIONS);
  if (override != null && Number.isFinite(Number(override))) {
    return Math.max(0, Math.floor(Number(override)));
  }

  if (_isStandbyShip(combat, combatant)) return 0;

  if (typeof combat?.actionsPerRoundFor !== "function") return 1;
  try { return Math.max(1, Number(combat.actionsPerRoundFor(combatant)) || 1); }
  catch { return 1; }
}

/** Public: how many turns this combatant gets this round (0 = standing by). */
export function maxActivations(combat, combatant) {
  return _maxActivations(combat, combatant);
}

/** True when the combatant is in the tracker but deliberately takes no turns. */
export function isStandingBy(combat, combatant) {
  return _maxActivations(combat, combatant) === 0;
}

/**
 * Set (or clear) a combatant's per-round turn count.
 * @param {number|null} value  0 to stand by, null to go back to auto.
 */
export async function setActivations(combatant, value) {
  if (!combatant) return;
  try {
    if (value === null || value === undefined) await combatant.unsetFlag(MODULE, FLAG_ACTIVATIONS);
    else await combatant.setFlag(MODULE, FLAG_ACTIVATIONS, Math.max(0, Math.floor(Number(value) || 0)));
  } catch (e) {
    console.warn("STA2e Toolkit | Could not set activations:", e);
  }
}

/** How many times this combatant has already activated this round. */
function _activationsUsed(combat, combatant) {
  const raw = combat?.getFlag?.(MODULE, FLAG_INIT) ?? null;
  if (!raw || raw.round !== combat.round) return 0;
  return (raw.sequence ?? []).filter(id => id === combatant.id).length;
}

/**
 * Can this combatant still take a turn this round?
 *
 * Our own activation log is the source of truth, NOT the system's
 * `actionsRemaining`. Nothing in `Combat2d20` decrements that when a turn is
 * taken — only the tracker's ✓ button does — so relying on it would leave every
 * combatant permanently "eligible" and the running order would never advance.
 *
 * The system's fields are still honoured as GM overrides, but only ever to make
 * a combatant *less* eligible: ticking ✓ or zeroing their actions retires them
 * early. We never write to them, so the tracker's own "N / M" readout stays the
 * system's business.
 */
export function isEligible(combat, combatant) {
  if (!combat || !combatant) return false;
  if (combatant.isDefeated) return false;

  try {
    if (combat.getTurnDone?.(combatant.id)) return false;
    const systemRemaining = combat.actionsRemainingThisRound?.[combatant.id];
    if (systemRemaining != null && Number(systemRemaining) <= 0) return false;
  } catch { /* stock Combat document — no action economy to consult */ }

  return _activationsUsed(combat, combatant) < _maxActivations(combat, combatant);
}

/** Every eligible combatant on a side. */
export function eligibleOnSide(combat, side) {
  if (!combat) return [];
  return combat.combatants.filter(c => isEligible(combat, c) && sideOf(c) === side);
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn-order state
// ─────────────────────────────────────────────────────────────────────────────

function _blankState(combat, firstSide = SIDE_CREW) {
  return {
    round:     combat?.round ?? 1,
    firstSide,
    lastSide:  null,
    sequence:  [],
    hold:      null,
    pending:   null,   // selected and acting, but the turn is not spent yet
  };
}

/**
 * Read the turn-order state, rebuilding it if it is missing or describes an
 * older round (which happens after an undo, a round rewind, or a fresh combat).
 */
export function getState(combat) {
  if (!combat) return null;
  const raw = combat.getFlag?.(MODULE, FLAG_INIT) ?? null;
  if (!raw || raw.round !== combat.round) {
    // Carry the flip forward when we are advancing rather than starting fresh.
    const first = raw?.lastSide ? opposite(raw.lastSide) : SIDE_CREW;
    return _blankState(combat, first);
  }
  return {
    round:     raw.round,
    firstSide: raw.firstSide ?? SIDE_CREW,
    lastSide:  raw.lastSide ?? null,
    sequence:  Array.isArray(raw.sequence) ? [...raw.sequence] : [],
    hold:      raw.hold ?? null,
    pending:   raw.pending ?? null,
  };
}

async function _writeState(combat, state) {
  try {
    await combat.setFlag(MODULE, FLAG_INIT, state);
  } catch (e) {
    console.warn("STA2e Toolkit | Could not write initiative state:", e);
  }
}

/**
 * The side that *should* act next.
 *
 * The "when one side runs out, the other finishes the round consecutively" rule
 * falls out for free: if the side we want has nobody eligible, we hand it over.
 */
export function expectedSide(combat) {
  if (!combat) return SIDE_CREW;
  const state = getState(combat);

  let want;
  if (state.hold) {
    // A live hold forces its side; once consumed it forces the opposite.
    want = state.hold.chained ? opposite(state.hold.side) : state.hold.side;
  } else if (state.sequence.length) {
    want = opposite(state.lastSide ?? SIDE_CREW);
  } else {
    want = state.firstSide;
  }

  if (!eligibleOnSide(combat, want).length && eligibleOnSide(combat, opposite(want)).length) {
    return opposite(want);
  }
  return want;
}

/** How many more times this combatant may activate this round. */
function _remainingActivations(combat, combatant) {
  if (!isEligible(combat, combatant)) return 0;
  return Math.max(1, _maxActivations(combat, combatant) - _activationsUsed(combat, combatant));
}

/** One entry per remaining activation, so a Scale-4 ship takes four slots. */
function _slotsFor(combat, side) {
  const out = [];
  for (const c of eligibleOnSide(combat, side)) {
    const n = _remainingActivations(combat, c);
    for (let i = 0; i < n; i++) out.push(c);
  }
  return out;
}

/**
 * The round-robin running order for the rest of this round: one side, then the
 * other, alternating, starting from whoever is up next.
 *
 * This is the whole point of the feature — the tracker must read
 * Crew → NPC → Crew → NPC, not "every crew member, then every NPC". When one
 * side runs out of activations the other simply finishes the round, which falls
 * out of the queue-drain below.
 *
 * Within a side, combatants keep the tracker's own ordering. The GM can still
 * activate anyone; this is the suggested order, not a rail.
 *
 * @returns {Array<{combatant: Combatant, side: string}>}
 */
export function projectedOrder(combat) {
  if (!combat) return [];

  const queues = {
    [SIDE_CREW]: _slotsFor(combat, SIDE_CREW),
    [SIDE_NPC]:  _slotsFor(combat, SIDE_NPC),
  };

  let side = expectedSide(combat);
  const out = [];

  while (queues[SIDE_CREW].length || queues[SIDE_NPC].length) {
    // Whichever side we wanted has nothing left — the other side finishes out.
    if (!queues[side].length) side = opposite(side);
    out.push({ combatant: queues[side].shift(), side });
    side = opposite(side);
  }
  return out;
}

/** The combatant the GM should activate next, or null. */
export function nextProjectedCombatant(combat) {
  return projectedOrder(combat)[0]?.combatant ?? null;
}

/** Convenience for the UI: who acts first this round, and who is up next. */
export function getTurnOrder(combat = game.combat) {
  if (!combat) return null;
  const state = getState(combat);
  return {
    round:     combat.round,
    firstSide: state.firstSide,
    lastSide:  state.lastSide,
    sequence:  state.sequence,
    hold:      state.hold,
    pending:   state.pending,
    expected:  expectedSide(combat),
  };
}

/** The combatant selected and acting right now, or null. */
export function getActingCombatant(combat = game.combat) {
  const id = getState(combat)?.pending;
  return id ? combat?.combatants?.get(id) ?? null : null;
}

/**
 * Select a combatant as the one now acting. Called from the GM-side
 * `updateCombat` hook whenever `turn` changes — including the system's own
 * row-click path, since `Combat2d20#setTurn` ends in `this.update({round, turn})`.
 *
 * Selecting does NOT spend the turn. The two-step is deliberate:
 *
 *   click a row   → that combatant is ACTING NOW
 *   ✓ / Next Turn → the turn is spent and the order moves on
 *
 * It makes mis-clicks free (picking the wrong row costs nobody a turn, you just
 * click the right one) and it matches how the table actually plays: you pick who
 * is up, they do their thing, then you close out their turn.
 */
export async function onTurnChanged(combat, combatant) {
  if (!initiativeEnabled() || !combat || !combatant) return;

  const wanted = expectedSide(combat);
  const side   = sideOf(combatant);

  // Guide, don't block: the selection always stands, but say so when it breaks
  // the alternation, because the GM may simply have mis-clicked.
  if (side !== wanted && eligibleOnSide(combat, wanted).length) {
    ui.notifications?.warn(
      `STA2e Toolkit: ${combatant.name} is up out of turn — it is the ${SIDE_LABEL[wanted]} side's turn.`
    );
  }

  const state   = getState(combat);
  state.pending = combatant.id;
  state.round   = combat.round;

  await _writeState(combat, state);
  await resetTurnActions(combat, combatant);
}

/**
 * Spend the selected combatant's turn and clear the selection.
 *
 * @returns {Promise<boolean>} whether anything was committed
 */
export async function commitPendingTurn(combat = game.combat) {
  if (!initiativeEnabled() || !combat?.started) return false;

  const state = getState(combat);
  if (!state.pending) return false;

  const combatant = combat.combatants.get(state.pending);
  if (!combatant) {
    state.pending = null;
    await _writeState(combat, state);
    return false;
  }

  const next = _applyActivation(state, combatant, sideOf(combatant));
  next.pending = null;
  next.round   = combat.round;

  await _writeState(combat, next);
  return true;
}

/**
 * Log one activation against the round state.
 *
 * The sequence is appended to, never deduped: the count of a combatant's entries
 * is how many turns they have spent this round, which is what `isEligible` and
 * the running-order projection read. A Scale-4 ship appears four times.
 */
function _applyActivation(state, combatant, side) {
  // Resolve the hold. A hold survives exactly one activation of its own side,
  // then flips to `chained` so the following turn is forced to the other side.
  let hold = state.hold;
  if (hold) {
    if (hold.chained) hold = null;                        // the chain has been honoured
    else if (side === hold.side) hold = { ...hold, chained: true };
  }

  return {
    ...state,
    sequence: [...state.sequence, combatant.id],
    lastSide: side,
    hold,
  };
}

/**
 * Catch up the activation log with the system's own action economy.
 *
 * Turns can be spent WITHOUT the turn pointer moving: the sta tracker's ✓
 * "take action" control calls `adjustActionsRemaining(-1)` and only writes a
 * flag on the Combat document — `combat.turn` never changes, so `updateCombat`
 * never reports a turn change and `onTurnChanged` never fires. A GM who works
 * that way would leave `lastSide` permanently stale, and the running order would
 * keep offering the same side over and over.
 *
 * Reconciliation only ever ADDS entries, when the system says a combatant has
 * spent more turns than our log knows about. That makes it safe to run after
 * every combat update and safe to mix with row-clicks: a row-click logs the
 * activation first, so there is no deficit left for this to double-count.
 */
export async function reconcileActivations(combat) {
  if (!initiativeEnabled() || !combat?.started) return false;
  if (typeof combat.actionsPerRoundFor !== "function") return false;   // popcorn tracker off

  let state    = getState(combat);
  let lastAdded = null;
  let wanted    = expectedSide(combat);

  for (const c of combat.combatants) {
    const remaining = combat.actionsRemainingThisRound?.[c.id];
    if (remaining == null) continue;

    const systemUsed = Math.max(0, _maxActivations(combat, c) - Number(remaining));
    const loggedUsed = state.sequence.filter(id => id === c.id).length;

    for (let i = loggedUsed; i < systemUsed; i++) {
      const side = sideOf(c);
      // Only warn for a combatant that was never selected — selecting one
      // already warned, and repeating it on every ✓ would be noise.
      const wasSelected = state.pending === c.id;
      if (!lastAdded && !wasSelected && side !== wanted && eligibleOnSide(combat, wanted).length) {
        ui.notifications?.warn(
          `STA2e Toolkit: ${c.name} took a turn out of order — it was the ${SIDE_LABEL[wanted]} side's turn.`
        );
      }
      state = _applyActivation(state, c, side);
      // The ✓ button closes out the turn we had selected.
      if (state.pending === c.id) state.pending = null;
      lastAdded = c;
    }
  }

  if (!lastAdded) return false;

  state.round = combat.round;
  await _writeState(combat, state);
  try { ui.combat?.render(); } catch {}
  return true;
}

/**
 * Start a new round: the side that acted last goes second.
 *
 * Idempotent. Foundry normally diffs an update before firing `updateCombat`, so
 * `round` only appears when it really changed — but a caller that disables
 * diffing would otherwise wipe a round's sequence mid-round.
 */
export async function onRoundChanged(combat) {
  if (!initiativeEnabled() || !combat) return;
  const previous = combat.getFlag?.(MODULE, FLAG_INIT) ?? null;
  if (previous && previous.round === combat.round) return;   // already on this round

  const first = previous?.lastSide ? opposite(previous.lastSide) : SIDE_CREW;
  await _writeState(combat, _blankState(combat, first));

  // Foundry parks the pointer on turns[0] when a round opens. Nobody has acted
  // yet, so that highlight is a lie — and worse, the system's tracker ignores a
  // click on the already-current row (`newTurn !== currentTurn`), making the
  // combatant at index 0 unselectable. Clearing it to "no-one's turn" fixes both.
  if (combat.turn !== null && combat.turn !== undefined) {
    try { await combat.update({ turn: null }); }
    catch (e) { console.warn("STA2e Toolkit | Could not clear the turn pointer:", e); }
  }
}

/**
 * Advance to the next combatant in the round-robin order.
 *
 * Foundry's own Next Turn walks `combat.turns`, which is ordered by initiative —
 * and since crew officers are all created together and NPCs separately, that
 * runs every crew member and then every NPC. This is what the sidebar's next-turn
 * button is redirected to instead.
 *
 * @returns {Promise<boolean>} false when there is nobody left to activate, which
 *   the caller should treat as "let Foundry advance the round normally".
 */
export async function advanceToNextInOrder(combat = game.combat) {
  if (!combat?.started) return false;

  // Close out whoever was selected — Next Turn means "they are done".
  await commitPendingTurn(combat);

  const next = nextProjectedCombatant(combat);
  if (!next) return false;

  const index = combat.turns?.findIndex(t => t.id === next.id) ?? -1;
  if (index < 0) return false;

  // The same combatant selected again — a Scale-N ship spending its remaining
  // actions once the other side is out. The turn pointer cannot move (Foundry
  // diffs an unchanged `turn` away, so `updateCombat` would never fire), so
  // re-select it directly instead.
  if (index === combat.turn) {
    await onTurnChanged(combat, next);
    try { ui.combat?.render(); } catch {}
    return true;
  }

  try {
    if (typeof combat.setTurn === "function") await combat.setTurn(index);
    else await combat.update({ turn: index });
    return true;
  } catch (e) {
    console.warn("STA2e Toolkit | Could not advance to the next combatant:", e);
    return false;
  }
}

/** GM override of a combatant's side, from the tracker row context menu. */
export async function setCombatSide(combatant, side) {
  if (!combatant) return;
  if (side !== SIDE_CREW && side !== SIDE_NPC) {
    try { await combatant.unsetFlag(MODULE, FLAG_SIDE); } catch {}
    return;
  }
  try { await combatant.setFlag(MODULE, FLAG_SIDE, side); }
  catch (e) { console.warn("STA2e Toolkit | Could not set combat side:", e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-turn action economy (Minor / Major)
// ─────────────────────────────────────────────────────────────────────────────

/** The Combat a Combatant belongs to. `parent` is the guaranteed property. */
function _combatOf(combatant) {
  return combatant?.parent ?? combatant?.combat ?? game.combat ?? null;
}

function _defaultActions(combat) {
  return {
    round:          combat?.round ?? 1,
    minorUsed:      0,
    minorMax:       1,
    majorUsed:      0,
    majorMax:       1,
    extraMajorDiff: 0,
  };
}

/**
 * The combatant's Minor/Major budget for the turn it is currently taking.
 * A stale `round` means the stored budget belongs to an earlier turn, so it
 * reads as fresh rather than leaking spent actions across rounds.
 */
export function getTurnActions(combatant, combat = _combatOf(combatant)) {
  const base = _defaultActions(combat);
  const raw  = combatant?.getFlag?.(MODULE, FLAG_ACTS);
  if (!raw || raw.round !== base.round) return base;
  return { ...base, ...raw };
}

async function _writeActions(combatant, data) {
  try {
    await combatant.setFlag(MODULE, FLAG_ACTS, data);
  } catch (e) {
    console.warn("STA2e Toolkit | Could not write turn actions:", e);
  }
}

/** Wipe the budget back to 1 Minor / 1 Major at the start of a combatant's turn. */
export async function resetTurnActions(combat, combatant) {
  if (!combatant) return;
  await _writeActions(combatant, _defaultActions(combat));
}

/**
 * Consume Minor or Major actions. Over-budget use warns and still proceeds —
 * the table may be doing something the module does not model.
 *
 * @param {"minor"|"major"} kind
 */
export async function useAction(combatant, kind, count = 1) {
  if (!combatant) return null;
  const combat  = _combatOf(combatant);
  const actions = getTurnActions(combatant, combat);
  const usedKey = kind === "major" ? "majorUsed" : "minorUsed";
  const maxKey  = kind === "major" ? "majorMax"  : "minorMax";

  const next = { ...actions, [usedKey]: Math.max(0, actions[usedKey] + Number(count || 0)) };
  if (next[usedKey] > next[maxKey]) {
    ui.notifications?.warn(
      `STA2e Toolkit: ${combatant.name} has used ${next[usedKey]} ${kind} action(s) this turn but only has ${next[maxKey]}.`
    );
  }
  await _writeActions(combatant, next);
  return next;
}

/**
 * Flag that a Task roll consumed this combatant's Major Action.
 *
 * Deliberately "ensure at least one", not "add one". A single action can reach
 * this more than once — the Combat HUD marks a station action when the button is
 * pressed, and the Task roll it opens lands here moments later — and an
 * incrementing call would charge that action twice. Raising `majorUsed` to 1 only
 * when it is still 0 is idempotent by construction.
 *
 * The trade-off: with a bought extra Major Action, the second roll of the turn
 * will not auto-flag (the first already set the flag). The pips stay
 * click-editable for exactly that case — the module guides, it does not police.
 *
 * @returns {Promise<boolean>} whether anything changed
 */
export async function ensureMajorUsed(combatant) {
  if (!combatant) return false;
  const acts = getTurnActions(combatant);
  if (acts.majorUsed >= 1) return false;
  await _writeActions(combatant, { ...acts, majorUsed: 1 });
  return true;
}

/**
 * Called when a Task roll resolves. Flags the Major Action against whoever is
 * acting, so rolls made outside the Combat HUD's action buttons — a character
 * sheet, the LCARS ring, a task card — still register in the tracker.
 *
 * Only fires for the combatant the tracker currently has active. When nothing is
 * selected (a GM working purely from the ✓ control) it falls back to whoever the
 * actor resolves to, so that workflow is not left out.
 *
 * @param {Actor}   actor
 * @param {object}  [opts]
 * @param {string}  [opts.stationId]    bridge station, for ship rolls
 * @param {boolean} [opts.isAssistRoll] assists belong to the assisting character's
 *   own declared action, which was already charged when they declared it
 * @returns {Promise<boolean>}
 */
export async function markTaskRollMajor(actor, { stationId = null, isAssistRoll = false } = {}) {
  if (!actor || isAssistRoll) return false;
  if (!initiativeEnabled()) return false;
  if (_setting("initiativeAutoTrackActions", true) === false) return false;

  const combat = game.combat;
  if (!combat?.started) return false;

  const combatant = resolveTurnCombatant(actor, combat, { stationId });
  if (!combatant) return false;

  // If the tracker has an active combatant, only flag that one — a defender's
  // opposed roll or another character's aside must not spend the active turn.
  const acting = getActingCombatant(combat);
  if (acting && acting.id !== combatant.id) return false;

  const changed = await ensureMajorUsed(combatant);
  if (changed) { try { ui.combat?.render(); } catch {} }
  return changed;
}

/** Directly set a used-count — the tracker pips are click-to-toggle. */
export async function setActionUsed(combatant, kind, value) {
  if (!combatant) return null;
  const actions = getTurnActions(combatant, _combatOf(combatant));
  const usedKey = kind === "major" ? "majorUsed" : "minorUsed";
  const next    = { ...actions, [usedKey]: Math.max(0, Number(value) || 0) };
  await _writeActions(combatant, next);
  return next;
}

/**
 * The pending +1 Difficulty owed by a bought extra Major action, resolved from
 * an actor. Returns 0 when the automation is off, out of combat, or unowed.
 */
export function getExtraActionDifficulty(actor) {
  if (!actor) return 0;
  if (!initiativeEnabled()) return 0;
  if (_setting("initiativeApplyExtraMajorDifficulty", true) === false) return 0;

  const combat = game.combat;
  if (!combat?.started) return 0;

  const combatant = findCombatantForActor(actor, combat);
  if (!combatant) return 0;
  return Number(getTurnActions(combatant, combat).extraMajorDiff) || 0;
}

/** Clear the pending +1 once the Task it paid for has been rolled. */
export async function clearExtraActionDifficulty(actor) {
  const combat = game.combat;
  if (!combat?.started || !actor) return;
  const combatant = findCombatantForActor(actor, combat);
  if (!combatant) return;
  const actions = getTurnActions(combatant, combat);
  if (!actions.extraMajorDiff) return;
  await _writeActions(combatant, { ...actions, extraMajorDiff: 0 });
}

/**
 * Map an actor back to its combatant. Handles the tokenless, actor-only crew
 * combatants the module creates for bridge officers, and synthetic token actors
 * whose `id` is the prototype's id.
 */
/** The combatant for an officer manning `stationId` on this ship, if any. */
function _officerCombatantForStation(combat, shipActor, stationId) {
  if (!shipActor || !stationId) return null;

  let manifest;
  try { manifest = getCrewManifest(shipActor); } catch { return null; }
  // Command seats are a fixed-length array that may contain nulls.
  const ids = (manifest?.[stationId] ?? []).filter(Boolean);

  for (const actorId of ids) {
    const c = combat.combatants.find(x => x.actorId === actorId);
    if (c && !isStandingBy(combat, c)) return c;
  }
  return null;
}

/**
 * The combatant whose turn budget an action by this actor should be charged to.
 *
 * Not always the actor's own combatant. In starship combat the Combat HUD takes
 * actions with the SHIP as the acting actor, but the ship is standing by while
 * its bridge officers take the turns — so the action belongs to an officer.
 *
 * Resolution order:
 *   1. the actor's own combatant, unless it is standing by
 *   2. the officer manning `stationId` on that ship (precise: a Tactical action
 *      is the Tactical officer's, whoever the tracker happens to have selected)
 *   3. whichever combatant is currently acting
 *
 * Step 2 matters because step 3 only works once a row has been clicked. A GM
 * driving the fight from the ✓ control never sets a selection, and every action
 * would have been charged to the standing-by ship — which renders no action pips
 * at all, so nothing appeared to happen.
 */
export function resolveTurnCombatant(actor, combat = game.combat, { stationId = null } = {}) {
  if (!combat?.started) return null;

  const direct = findCombatantForActor(actor, combat);
  if (direct && !isStandingBy(combat, direct)) return direct;

  const officer = _officerCombatantForStation(combat, actor, stationId);
  if (officer) return officer;

  return getActingCombatant(combat) ?? direct ?? null;
}

export function findCombatantForActor(actor, combat = game.combat) {
  if (!actor || !combat) return null;
  const tokenId = actor.token?.id ?? null;
  if (tokenId) {
    const byToken = combat.combatants.find(c => c.tokenId === tokenId);
    if (byToken) return byToken;
  }
  const actorId = actor.isToken ? (actor.id ?? actor._id) : actor.id;
  return combat.combatants.find(c => c.actorId === actorId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn-order spends
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which side's resources pay for a spend.
 *
 * This follows the COMBATANT, not whoever is clicking. A GM buying an extra
 * Minor Action for a player character spends the crew's Momentum — it is the
 * character's action, not the GM's. Keying this off `game.user.isGM` (as an
 * earlier version did) told the GM to pay Threat for a PC's extra action, which
 * is simply the wrong resource.
 *
 * Seize the Initiative is the exception: it is an NPC acting out of order, so it
 * always comes from Threat regardless of who is highlighted at the time.
 */
export function spendSide(kind, combatant) {
  if (kind === "seize") return SIDE_NPC;
  return combatant ? sideOf(combatant) : SIDE_NPC;
}

/**
 * Crew-side spends that may alternatively be paid by handing the GM Threat.
 *
 * Only Keep the Initiative. The extra Minor and Major Actions are Momentum
 * spends for a player character, full stop — there is no give-the-GM-Threat
 * route for them.
 */
const THREAT_ALTERNATIVE_KINDS = new Set(["keep"]);

/**
 * Which currencies may pay for a spend, and which to default to.
 *
 * Crew-side spends use Momentum. Keep the Initiative additionally offers the
 * standard STA alternative of *adding* the same amount to the Threat pool, and
 * that route becomes the default when Momentum cannot cover the cost. NPC-side
 * spends come out of Threat.
 *
 * @returns {{side: string, options: Array<"momentum"|"threat">, preferred: string, cost: number}}
 */
export function paymentOptionsFor(kind, combatant = null) {
  const cost = spendCost(kind);
  const side = spendSide(kind, combatant);

  if (side === SIDE_NPC) return { side, options: ["threat"], preferred: "threat", cost };

  const options = ["momentum"];
  if (THREAT_ALTERNATIVE_KINDS.has(kind)
    && _setting("initiativePlayerThreatPayment", true) !== false) {
    options.push("threat");
  }

  const canAfford = readPool("momentum") >= cost;
  return { side, options, preferred: (canAfford || options.length === 1) ? "momentum" : "threat", cost };
}

/**
 * Move the pool for a turn-order spend.
 *
 * The direction follows the SIDE, not who is executing:
 *
 *   crew  + momentum → spend Momentum
 *   crew  + threat   → ADD Threat (the players hand the GM Threat instead)
 *   npc   + threat   → spend Threat
 *
 * Deriving the sign from the side rather than from `game.user.isGM` also removes
 * a whole bug class: this runs on the GM's client after a player's socket relay,
 * so anything keyed to the executing user's role got it backwards.
 *
 * `canUserAdjustPool` (pool-service.js) permits a non-GM Threat write only for an
 * allow-listed source with a positive delta, which is why the source is
 * "turnOrder" and why the sign matters.
 *
 * @returns {Promise<boolean>} whether the pool actually moved
 */
async function _payFor(kind, payment, side) {
  const cost = spendCost(kind);
  if (cost <= 0) return true;

  // The players' alternative to spending Momentum: give the GM Threat.
  if (payment === "threat" && side === SIDE_CREW) {
    return adjustPool("threat", +cost, { source: "turnOrder" });
  }

  const pool = payment === "threat" ? "threat" : "momentum";
  if (readPool(pool) < cost) {
    ui.notifications?.warn(
      `STA2e Toolkit: Not enough ${pool === "threat" ? "Threat" : "Momentum"} — ${SPEND_LABEL[kind]} costs ${cost}.`
    );
    return false;
  }
  return adjustPool(pool, -cost, { source: "turnOrder" });
}

/**
 * Execute a turn-order spend. GM-side only — player clicks arrive here through
 * the `initiativeSpend` socket action, which `main.js` gates on the responsible GM.
 *
 * @param {object}  opts
 * @param {string}  opts.kind        keep | seize | extraMinor | extraMajor
 * @param {string}  opts.combatantId
 * @param {string}  opts.payment     "momentum" | "threat"
 * @param {string} [opts.userName]   who asked, for the chat card
 */
export async function applyTurnOrderSpend({
  kind, combatantId, payment = "momentum", userName = null,
} = {}) {
  const combat = game.combat;
  if (!combat) return false;

  const combatant = combat.combatants.get(combatantId);
  if (!combatant && kind !== "seize") {
    console.warn(`STA2e Toolkit | initiative spend: combatant ${combatantId} not found`);
    return false;
  }

  // Normalise the requested currency against what this spend actually permits.
  // A stale socket message, a macro, or a client with different settings must
  // not be able to pay for an extra Minor Action by handing over Threat.
  const { side, options, preferred } = paymentOptionsFor(kind, combatant);
  const currency = options.includes(payment) ? payment : preferred;

  const paid = await _payFor(kind, currency, side);
  if (!paid) return false;

  if (kind === "keep" || kind === "seize") {
    const side  = kind === "seize" ? SIDE_NPC : sideOf(combatant);
    const state = getState(combat);
    state.hold  = { side, kind, round: combat.round, chained: false };
    await _writeState(combat, state);
  } else if (kind === "extraMinor") {
    const actions = getTurnActions(combatant, combat);
    await _writeActions(combatant, { ...actions, minorMax: actions.minorMax + 1 });
  } else if (kind === "extraMajor") {
    const actions = getTurnActions(combatant, combat);
    await _writeActions(combatant, {
      ...actions,
      majorMax:       actions.majorMax + 1,
      extraMajorDiff: 1,
    });
  }

  await _postSpendCard({ kind, combatant, payment: currency, side, userName });
  try { ui.combat?.render(); } catch {}
  return true;
}

/**
 * LCARS chat card for a spend. Modelled on the Momentum Overflow tracker card
 * (momentum-tracker.js) — tokens resolved at render time, never cached.
 */
async function _postSpendCard({ kind, combatant, payment, side, userName }) {
  const LC   = getLcTokens();
  const cost = spendCost(kind);

  // Crew paying in Threat are handing it over, not spending it.
  const gave    = payment === "threat" && side === SIDE_CREW;
  const accent  = (payment === "threat") ? LC.primary : LC.secondary;
  const icon    = (payment === "threat") ? "⚡" : "💫";
  const currency = gave
    ? `+${cost} Threat`
    : `−${cost} ${payment === "threat" ? "Threat" : "Momentum"}`;

  const who  = combatant?.name ?? "the GM";
  const by   = userName ? ` · ${userName}` : "";

  const detail = {
    keep:       `The next turn passes to an ally. Once that ally has acted, the turn must go to an enemy.`,
    seize:      `An NPC acts instead of the crew. The turn returns to the crew afterwards.`,
    extraMinor: `${who} gains an additional Minor Action this turn.`,
    extraMajor: `${who} gains an additional Major Action this turn, at <strong>+1 Difficulty</strong>.`,
  }[kind] ?? "";

  const content = `
    <div style="font-family:${LC.font};background:${LC.bg};border-left:4px solid ${accent};
                border-radius:2px;padding:8px 10px;color:${LC.text};">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:14px;">${icon}</span>
        <span style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${accent};">
          ${SPEND_LABEL[kind] ?? "Turn Order"}
        </span>
      </div>
      <div style="font-size:11px;color:${LC.textDim};margin-bottom:6px;">
        ${who}${by}
      </div>
      <div style="display:inline-block;padding:3px 8px;background:rgba(0,0,0,0.35);
                  border:1px solid ${accent};border-radius:2px;font-size:13px;font-weight:700;color:${accent};">
        ${currency}
      </div>
      <div style="margin-top:8px;font-size:11px;line-height:1.4;color:${LC.text};">
        ${detail}
      </div>
      ${gave ? `<div style="margin-top:6px;font-size:10px;color:${LC.textDim};font-style:italic;">
        Paid by adding Threat to the pool instead of spending Momentum.
      </div>` : ""}
    </div>`;

  try {
    await ChatMessage.create({ content, speaker: { alias: "Turn Order" } });
  } catch (e) {
    console.warn("STA2e Toolkit | Could not post turn-order spend card:", e);
  }
}

/**
 * Client-side entry point for a spend button. Routes itself: the GM applies it
 * directly, everyone else asks the responsible GM over the socket. Mirrors the
 * self-routing write in assist-pending.js.
 */
export function requestTurnOrderSpend({ kind, combatantId, payment = "momentum" } = {}) {
  if (game.user.isGM) {
    return applyTurnOrderSpend({ kind, combatantId, payment, userName: game.user.name });
  }
  game.socket.emit(`module.${MODULE}`, {
    action:   "initiativeSpend",
    kind,
    combatantId,
    payment,
    userName: game.user.name,
  });
  return Promise.resolve(true);
}

/** Same routing for the click-to-toggle action pips. */
export function requestSetActionUsed(combatant, kind, value) {
  if (!combatant) return Promise.resolve(false);
  if (game.user.isGM) return setActionUsed(combatant, kind, value);

  game.socket.emit(`module.${MODULE}`, {
    action:      "initiativeSetActions",
    combatantId: combatant.id,
    kind,
    value,
  });
  return Promise.resolve(true);
}
