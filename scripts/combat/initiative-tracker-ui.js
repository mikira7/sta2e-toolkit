/**
 * sta2e-toolkit | combat/initiative-tracker-ui.js
 * Round-robin turn order, action pips and turn-order spends, injected into the
 * `sta` system's sidebar Combat Tracker.
 *
 * We inject rather than subclass. The system installs `CONFIG.ui.combat =
 * CombatTracker2d20V2` inside its own `Hooks.once("ready")`, so a module subclass
 * would have to race that hook or rebuild an already-rendered sidebar. Riding the
 * render hook keeps us compatible with system updates and degrades to a no-op if
 * the DOM contract ever moves.
 *
 * The rules live in initiative-order.js; this file owns only presentation and
 * the click handlers that call into it.
 *
 * Row clicks still fall through to the system's own `_onCombatantMouseDown` →
 * `setTurn`. We never preventDefault — out-of-order picks are warned about by
 * `onTurnChanged`, never blocked.
 */

import { getLcCssVars } from "../lcars-theme.js";
import {
  SIDE_CREW, SIDE_NPC, SIDE_LABEL, SPEND_LABEL,
  initiativeEnabled, sideOf, isEligible, getTurnOrder,
  getTurnActions, paymentOptionsFor, spendCost,
  requestTurnOrderSpend, requestSetActionUsed, setCombatSide,
  projectedOrder, nextProjectedCombatant, advanceToNextInOrder,
  isStandingBy, setActivations, getActingCombatant,
} from "./initiative-order.js";

const MODULE = "sta2e-toolkit";

function _setting(key, fallback) {
  try {
    const v = game.settings.get(MODULE, key);
    return v === undefined || v === null ? fallback : v;
  } catch { return fallback; }
}

/**
 * Who may buy a spend or toggle a pip. The GM may always, on any combatant.
 * A player may only act on a combatant whose actor they own, and only while
 * `initiativePlayerSpends` is on. Neither ever advances the turn.
 */
function _canSpendFor(combatant) {
  if (game.user.isGM) return true;
  if (_setting("initiativePlayerSpends", true) === false) return false;
  return !!combatant?.actor?.isOwner;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small DOM builders
// ─────────────────────────────────────────────────────────────────────────────

function _band(label, modifier, note = "") {
  const li = document.createElement("li");
  li.className = `sta2e-init__band sta2e-init__band--${modifier}`;
  if (modifier === "next") li.classList.add(label.includes(SIDE_LABEL[SIDE_CREW]) ? "is-crew" : "is-npc");
  li.innerHTML = `<span>${label}</span>${note ? `<span class="sta2e-init__band-note">${note}</span>` : ""}`;
  return li;
}

function _chip(side) {
  const span = document.createElement("span");
  span.className = `sta2e-init__chip sta2e-init__chip--${side}`;
  span.textContent = SIDE_LABEL[side];
  return span;
}

function _button(label, className, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `sta2e-init__btn ${className}`;
  btn.textContent = label;
  if (title) btn.title = title;
  return btn;
}

/** More glyphs than this and the pips collapse to a counter instead. */
const PIP_GLYPH_LIMIT = 4;

/**
 * Major/Minor pips for one combatant. Filled glyphs are unspent, dimmed are used.
 * Clicking a pip toggles it, so a GM can correct the count by hand — the module
 * guides the action economy, it does not police it.
 *
 * Once bought extra actions push the glyph count past PIP_GLYPH_LIMIT the row
 * switches to a compact "◆ 1/3" counter. Rendering one glyph per action looked
 * good at 1 Major + 1 Minor but grew without bound, and on a narrow sidebar it
 * squeezed the system's ✓ turn-done control off the end of the row.
 */
function _pips(combatant, editable) {
  const acts = getTurnActions(combatant);
  const wrap = document.createElement("div");
  wrap.className = "sta2e-init__pips";

  const commit = async (kind, value) => {
    await requestSetActionUsed(combatant, kind, value);
    ui.combat?.render();
  };

  const addGlyphs = (kind, max, used, glyph) => {
    for (let i = 0; i < max; i++) {
      const isUsed = i < used;
      const pip = document.createElement("span");
      pip.className = `sta2e-init__pip sta2e-init__pip--${kind}${isUsed ? " is-used" : ""}`
        + (editable ? " is-clickable" : "");
      pip.textContent = glyph;
      pip.title = `${kind === "major" ? "Major" : "Minor"} action ${i + 1}${isUsed ? " (used)" : ""}`;
      if (editable) {
        pip.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();   // never let a pip click reach the row's setTurn handler
          // Clicking pip N sets the used-count to N+1, or back to N if already used.
          commit(kind, isUsed ? i : i + 1);
        });
      }
      wrap.appendChild(pip);
    }
  };

  const addCounter = (kind, max, used, glyph) => {
    const el = document.createElement("span");
    el.className = `sta2e-init__count sta2e-init__pip--${kind}`
      + (used >= max ? " is-used" : "") + (editable ? " is-clickable" : "");
    el.innerHTML = `<span class="sta2e-init__count-glyph">${glyph}</span>${used}/${max}`;
    el.title = `${used} of ${max} ${kind === "major" ? "Major" : "Minor"} actions used`
      + (editable ? " — click to advance, wraps at the maximum" : "");
    if (editable) {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        commit(kind, used >= max ? 0 : used + 1);
      });
    }
    wrap.appendChild(el);
  };

  const render = (acts.majorMax + acts.minorMax) > PIP_GLYPH_LIMIT ? addCounter : addGlyphs;
  render("major", acts.majorMax, acts.majorUsed, "◆");
  render("minor", acts.minorMax, acts.minorUsed, "⬡");

  if (acts.extraMajorDiff > 0) {
    const badge = document.createElement("span");
    badge.className = "sta2e-init__diff-badge";
    badge.textContent = "+1 DIFF";
    badge.title = "The extra Major Action bought this turn raises its Task Difficulty by 1.";
    wrap.appendChild(badge);
  }
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask which currency to pay with, when there is a choice.
 *
 * The GM always pays Threat, so they never see this. A player sees both routes:
 * spend Momentum, or add the same amount of Threat to the pool. When Momentum
 * cannot cover the cost the Threat route is the default button rather than the
 * spend being refused.
 *
 * @returns {Promise<"momentum"|"threat"|null>} null if cancelled
 */
async function _promptPayment(kind, target) {
  const { options, preferred, cost } = paymentOptionsFor(kind, target);
  if (options.length <= 1) return options[0] ?? null;

  const buttons = [
    {
      action:  "momentum",
      label:   `Spend ${cost} Momentum`,
      icon:    "fas fa-bolt",
      default: preferred === "momentum",
    },
    {
      action:  "threat",
      label:   `Add ${cost} Threat`,
      icon:    "fas fa-triangle-exclamation",
      default: preferred === "threat",
    },
  ];

  const result = await foundry.applications.api.DialogV2.wait({
    window:      { title: SPEND_LABEL[kind] ?? "Turn Order" },
    content: `
      <p style="margin:0 0 6px;"><strong>${SPEND_LABEL[kind]}</strong> costs ${cost}.</p>
      <p style="margin:0;font-size:12px;opacity:0.8;">
        Pay with Momentum, or hand the GM ${cost} Threat instead.
      </p>`,
    buttons,
    rejectClose: false,
  });
  return (result === "momentum" || result === "threat") ? result : null;
}

async function _buy(kind, target) {
  const payment = await _promptPayment(kind, target);
  if (!payment) return;
  await requestTurnOrderSpend({ kind, combatantId: target?.id ?? "", payment });
  ui.combat?.render();
}

/**
 * Button label carries the currency the TARGET pays in — a player character's
 * extra action costs the crew's Momentum whether the player or the GM clicks it.
 * Crew-side buttons show the Threat alternative too.
 */
function _costLabel(kind, target) {
  const { options } = paymentOptionsFor(kind, target);
  const cost = spendCost(kind);
  if (options.length === 1) return `${cost} ${options[0] === "threat" ? "Threat" : "Momentum"}`;
  return `${cost} Momentum or ${cost} Threat`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Injection
// ─────────────────────────────────────────────────────────────────────────────

function _rootOf(element) {
  if (element instanceof HTMLElement) return element;
  return element?.[0] instanceof HTMLElement ? element[0] : null;
}

function _inject(app, element) {
  const root = _rootOf(element);
  if (!root) return;

  const ol = root.querySelector("ol.combat-tracker");
  if (!ol) return;                                  // not the combat tracker, or DOM moved

  // Idempotency, and it MUST come before any DOM mutation below.
  //
  // Foundry fires a render hook for every class in the application's inheritance
  // chain (ApplicationV2##callHooks walks `inheritanceChain()`), so one paint of
  // the sta tracker triggers renderCombatTracker2d20V2, renderCombatTracker AND
  // renderApplicationV2 — all three of which we listen for. Clearing the strip
  // ahead of this guard meant the 2nd and 3rd calls deleted the header and
  // footer that the 1st had just built, and then bailed without rebuilding them.
  // The row grouping survived (it is a reorder, not an insert), which is exactly
  // what "the order works but the spend buttons are missing" looked like.
  if (ol.dataset.sta2eInit === "1") return;
  ol.dataset.sta2eInit = "1";

  // Clear any strip left over from an earlier paint — a tracker that re-renders
  // with the feature disabled, or with combat over, must not keep showing a
  // stale "Up: Crew" band.
  root.querySelector("#sta2e-init-header")?.remove();
  root.querySelector("#sta2e-init-footer")?.remove();

  if (!initiativeEnabled()) return;

  const combat = app?.viewed ?? game.combat;
  if (!combat?.started) return;

  // Theme tokens for the whole injected surface, resolved at render time.
  root.setAttribute("style", `${root.getAttribute("style") ?? ""}${getLcCssVars("init")}`);

  const rows = [...ol.querySelectorAll("li.combatant[data-combatant-id]")];
  if (!rows.length) return;

  const order    = getTurnOrder(combat);
  const upSide   = order?.expected ?? SIDE_CREW;
  const sequence = order?.sequence ?? [];

  // Decorate every row first, then reorder.
  const rowById = new Map();
  const acted   = [];
  const standby = [];
  const other   = [];   // rows we cannot classify — never dropped, just appended last

  for (const row of rows) {
    const id        = row.dataset.combatantId;
    const combatant = combat.combatants.get(id);
    if (!combatant) { other.push(row); continue; }

    rowById.set(id, row);
    const side = sideOf(combatant);

    // Side chip, in front of the name.
    const nameEl = row.querySelector(".token-name .name") ?? row.querySelector(".token-name");
    if (nameEl && !nameEl.querySelector(".sta2e-init__chip")) nameEl.prepend(_chip(side));

    // A ship standing by while its officers act takes no turns at all, so it
    // gets neither action pips nor a place in the running order.
    if (isStandingBy(combat, combatant)) {
      row.classList.add("sta2e-init--standby");
      standby.push(row);
      continue;
    }

    // Action pips go INSIDE .token-name, which core lays out as a flex column
    // (`flex: 1; flex-direction: column`), so they sit on their own line under
    // the name. As a sibling of the row they competed with the system's ✓
    // turn-done control for a fixed width, and every extra action bought pushed
    // the ✓ further off the end of the sidebar.
    if (!row.querySelector(".sta2e-init__pips")) {
      const nameBox = row.querySelector(".token-name");
      const pips    = _pips(combatant, _canSpendFor(combatant));
      if (nameBox) nameBox.appendChild(pips);
      else row.insertBefore(pips, row.querySelector(".token-turn-completed"));
    }

    if (!isEligible(combat, combatant)) {
      row.classList.add("sta2e-init--acted");
      acted.push({ row, id });
    }
  }

  // Acted rows keep the order they actually activated in; anything not in the
  // sequence (defeated, marked done by hand) trails behind in tracker order.
  acted.sort((a, b) => {
    const ai = sequence.indexOf(a.id);
    const bi = sequence.indexOf(b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });

  // The remaining order, genuinely interleaved: Crew → NPC → Crew → NPC. A
  // combatant with several activations left (a Scale-N ship) appears once, at
  // its first slot, badged with how many turns it still has.
  const projected = projectedOrder(combat);
  const upcoming  = [];
  const slotCount = new Map();
  for (const { combatant } of projected) {
    slotCount.set(combatant.id, (slotCount.get(combatant.id) ?? 0) + 1);
    if (!upcoming.some(u => u.id === combatant.id)) upcoming.push(combatant);
  }

  // Whoever is selected is shown on their own, not buried in the queue: they are
  // mid-turn, not waiting. Their turn is spent by ✓ or Next Turn.
  const acting    = order?.pending ? rowById.get(order.pending) : null;
  const actingIdx = acting ? upcoming.findIndex(c => c.id === order.pending) : -1;
  if (actingIdx >= 0) upcoming.splice(actingIdx, 1);

  ol.replaceChildren();

  if (acted.length) {
    ol.appendChild(_band("Acted", "acted", `${acted.length}`));
    for (const a of acted) ol.appendChild(a.row);
  }

  if (acting) {
    ol.appendChild(_band("▸ Acting Now", "acting", "✓ or Next Turn when done"));
    acting.classList.add("sta2e-init--acting");
    const slots = slotCount.get(order.pending) ?? 1;
    if (slots > 1) _stampOrderBadge(acting, "▶", slots);
    ol.appendChild(acting);
  }

  if (upcoming.length) {
    // Label from whoever is actually first in the remaining queue. `upSide` is
    // the side that is *up*, which while someone is mid-turn is still their own
    // side — so using it here would caption an NPC row "Up Next: Crew".
    const bandSide = sideOf(upcoming[0]);
    ol.appendChild(_band(`▸ Up Next: ${SIDE_LABEL[bandSide]}`, "next"));
    upcoming.forEach((combatant, i) => {
      const row = rowById.get(combatant.id);
      if (!row) return;
      row.classList.add(i === 0 ? "sta2e-init--up" : "sta2e-init--queued");
      _stampOrderBadge(row, i + 1, slotCount.get(combatant.id) ?? 1);
      ol.appendChild(row);
    });
  }

  if (standby.length) {
    ol.appendChild(_band("Standby", "standby", "no turns"));
    for (const r of standby) ol.appendChild(r);
  }

  for (const r of other) ol.appendChild(r);

  _injectHeader(root, ol, combat, order, upSide);
  _injectFooter(root, ol, combat, upSide);
  _bindNextTurn(root, app);
}

/**
 * Redirect the sidebar's Next Turn button into the round-robin order.
 *
 * Foundry's own handler advances to `turn + 1` in `combat.turns`, which is
 * ordered by initiative — with crew officers created as one batch and NPCs as
 * another, that plays every crew member and then every NPC. Capture-phase so we
 * run before the tracker's own delegated listener.
 *
 * Falls through to the default behaviour when there is nobody left to activate,
 * so ending the round still works normally.
 */
function _bindNextTurn(root, app) {
  const btn = root.querySelector('[data-action="nextTurn"]');
  if (!btn || !game.user.isGM) return;
  if (btn.dataset.sta2eInitBound === "1") return;
  btn.dataset.sta2eInitBound = "1";

  btn.addEventListener("click", (ev) => {
    // Resolve the combat at click time — the button can outlive a render, and a
    // captured reference would go stale across encounters.
    const live = app?.viewed ?? game.combat;
    if (!initiativeEnabled() || !live?.started) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (projectedOrder(live).length) {
      advanceToNextInOrder(live);
      return;
    }
    // Everyone has spent their activations. Foundry's own handler would step to
    // `turn + 1`, landing on some already-acted combatant, because our turn
    // pointer jumps around rather than walking the array. End the round instead.
    live.nextRound?.().catch(err =>
      console.warn("STA2e Toolkit | Could not advance the round:", err));
  }, true);
}

/**
 * Number each upcoming row with its place in the running order, so the
 * alternation is readable at a glance rather than inferred from the side chips.
 * `slots` > 1 marks a combatant that still has several activations this round.
 */
function _stampOrderBadge(row, position, slots) {
  row.querySelector(".sta2e-init__order")?.remove();
  const badge = document.createElement("span");
  badge.className = "sta2e-init__order";
  badge.textContent = slots > 1 ? `${position}·×${slots}` : String(position);
  badge.title = slots > 1
    ? `Position ${position} in the turn order — ${slots} activations left this round`
    : `Position ${position} in the turn order`;
  const nameEl = row.querySelector(".token-name .name") ?? row.querySelector(".token-name");
  if (nameEl) nameEl.prepend(badge);
  else row.prepend(badge);
}

function _injectHeader(root, ol, combat, order, upSide) {
  const header = document.createElement("div");
  header.id = "sta2e-init-header";
  const holdNote = order?.hold
    ? ` · <strong>${SPEND_LABEL[order.hold.kind] ?? "Hold"}</strong>`
    : "";
  header.innerHTML =
    `Round ${combat.round} · ${SIDE_LABEL[order?.firstSide ?? SIDE_CREW]} first`
    + ` · Up: <strong>${SIDE_LABEL[upSide]}</strong>${holdNote}`;
  ol.parentElement?.insertBefore(header, ol);
}

/**
 * Which combatant the footer's spend buttons act on.
 *
 * `combat.combatant` is NOT reliable here. It is null for the whole round when
 * the GM works the ✓ "take action" control instead of clicking rows (that never
 * moves the turn pointer), and it is deliberately null right after a round opens.
 * Keying the buttons off it alone made them vanish for most of a fight.
 *
 * So: the active combatant when there is one and the user may act for it,
 * otherwise a player's own eligible combatant, otherwise whoever is up next.
 */
function _spendTarget(combat) {
  // The selected combatant is the one mid-turn, so extra actions belong to them.
  const current = getActingCombatant(combat) ?? combat.combatant ?? null;
  if (current && _canSpendFor(current)) return current;

  if (!game.user.isGM) {
    for (const c of combat.combatants) {
      if (c.actor?.isOwner && isEligible(combat, c)) return c;
    }
    return null;                       // a player with nothing of their own in play
  }
  return current ?? nextProjectedCombatant(combat);
}

function _injectFooter(root, ol, combat, upSide) {
  const footer = document.createElement("div");
  footer.id = "sta2e-init-footer";

  const target = _spendTarget(combat);
  const canAct = !!target && _canSpendFor(target);

  if (canAct) {
    // Name the target — with the turn pointer often unset, "+ Minor" alone would
    // not say who it is for.
    const who = document.createElement("div");
    who.className = "sta2e-init__target";
    who.textContent = target.name;
    footer.appendChild(who);

    const buys = document.createElement("div");
    buys.className = "sta2e-init__buys";

    const minor = _button(`+ Minor (${_costLabel("extraMinor", target)})`, "sta2e-init__btn--minor",
      `${target.name}: gain an additional Minor Action this turn.`);
    minor.addEventListener("click", () => _buy("extraMinor", target));

    const major = _button(`+ Major (${_costLabel("extraMajor", target)}, +1 Diff)`, "sta2e-init__btn--major",
      `${target.name}: gain an additional Major Action this turn, at +1 Difficulty.`);
    major.addEventListener("click", () => _buy("extraMajor", target));

    buys.append(minor, major);
    footer.appendChild(buys);

    const keep = _button(`Keep the Initiative (${_costLabel("keep", target)})`, "sta2e-init__btn--keep",
      "Pass the next turn to an ally instead of an enemy. Once that ally has acted, the next turn must go to an enemy.");
    keep.addEventListener("click", () => _buy("keep", target));
    footer.appendChild(keep);
  }

  // Seize the Initiative — GM only, and only when the crew would otherwise be up.
  if (game.user.isGM && upSide === SIDE_CREW) {
    const seize = _button(`Seize the Initiative (${spendCost("seize")} Threat)`, "sta2e-init__btn--seize",
      "Spend Threat so an NPC acts instead of the crew. The turn returns to the crew afterwards.");
    seize.addEventListener("click", () => _buy("seize", target));
    footer.appendChild(seize);
  }

  if (!footer.childElementCount) return;
  ol.parentElement?.insertBefore(footer, ol.nextSibling);
}

// ─────────────────────────────────────────────────────────────────────────────
// Side override context menu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add "Set Combat Side" entries to a tracker row's context menu.
 *
 * The hook's argument order has shifted between Foundry versions, so we pick the
 * options array out of the arguments rather than relying on a fixed position.
 */
function _addSideContextOptions(...args) {
  if (!game.user.isGM || !initiativeEnabled()) return;
  const entryOptions = args.find(a => Array.isArray(a));
  if (!entryOptions) return;

  const resolve = (li) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const id = el?.dataset?.combatantId ?? el?.closest?.("[data-combatant-id]")?.dataset?.combatantId;
    return id ? game.combat?.combatants?.get(id) ?? null : null;
  };

  const entry = (side) => ({
    name: `Combat Side: ${SIDE_LABEL[side]}`,
    icon: side === SIDE_CREW ? '<i class="fas fa-user-astronaut"></i>' : '<i class="fas fa-skull"></i>',
    condition: (li) => {
      const c = resolve(li);
      return !!c && sideOf(c) !== side;
    },
    callback: async (li) => {
      const c = resolve(li);
      if (c) { await setCombatSide(c, side); ui.combat?.render(); }
    },
  });

  entryOptions.push(entry(SIDE_CREW), entry(SIDE_NPC), {
    name: "Combat Side: Auto-detect",
    icon: '<i class="fas fa-wand-magic-sparkles"></i>',
    condition: (li) => !!resolve(li)?.getFlag(MODULE, "combatSide"),
    callback: async (li) => {
      const c = resolve(li);
      if (c) { await setCombatSide(c, null); ui.combat?.render(); }
    },
  });

  // Stand a combatant down without removing it from the tracker. The player ship
  // does this automatically once its officers are in combat, but a GM may want it
  // for a docked shuttle, a disabled vessel, or a purely scenic combatant.
  const combat = () => game.combat;
  entryOptions.push({
    name: "Turn Order: Stand By (no turns)",
    icon: '<i class="fas fa-pause"></i>',
    condition: (li) => {
      const c = resolve(li);
      return !!c && !isStandingBy(combat(), c);
    },
    callback: async (li) => {
      const c = resolve(li);
      if (c) { await setActivations(c, 0); ui.combat?.render(); }
    },
  }, {
    name: "Turn Order: Take Turns Again",
    icon: '<i class="fas fa-play"></i>',
    condition: (li) => {
      const c = resolve(li);
      return !!c && isStandingBy(combat(), c);
    },
    callback: async (li) => {
      const c = resolve(li);
      if (!c) return;
      // Clearing the override restores auto — but for a player ship auto means
      // "stand by", so force an explicit 1 to actually put it back in the order.
      await setActivations(c, null);
      if (isStandingBy(combat(), c)) await setActivations(c, 1);
      ui.combat?.render();
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerInitiativeTrackerUI() {
  const handler = (app, element) => {
    try { _inject(app, element); }
    catch (err) { console.error("STA2e Toolkit | Initiative tracker injection failed:", err); }
  };

  // Register every name the tracker might render under. The injector is
  // idempotent, so multiple hits on one paint are harmless — this is the same
  // belt-and-braces approach registerTraitItemSheetFields uses.
  Hooks.on("renderApplicationV2", handler);
  Hooks.on("renderCombatTracker", handler);
  Hooks.on("renderCombatTracker2d20V2", handler);

  Hooks.on("getCombatTrackerEntryContext", _addSideContextOptions);
}
