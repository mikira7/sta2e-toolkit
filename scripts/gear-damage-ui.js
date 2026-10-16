/**
 * sta2e-toolkit | gear-damage-ui.js
 *
 * The controls for damaged / broken gear (state and rules: gear-damage.js):
 *
 *   - `buildGearDamageKey` — the small key on each Token HUD Gear row
 *     (the GM toolkit menu's Gear section, gear-hud.js) that breaks or repairs that item.
 *   - `registerGearDamageCardButton` — posts the task COMPLICATIONS working
 *     card (complication-card.js) when a roll is confirmed with complications,
 *     where any GM breaks gear with them — no prompt.
 *   - `toggleGearDamage` — the one writer the UI uses: flips the flag and posts
 *     a short chat card, so the table sees it happen.
 *
 * Shape lives in styles/appearance.css (`.sta2e-gear-*`).
 */

import { lcarsChatCard } from "./chat-card-frame.js";
import { getLcTokens } from "./lcars-theme.js";
import {
  isDamageable, isGearDamaged, setGearDamaged, gearDamageWords, gearKind,
  storedGearDamagePotency, setGearDamagePotency, gearDamageChanged, gearDamagePotencyChanged,
  gearDamageModes, isPulseGrenade, grenadeCount, GRENADE_FLAG,
} from "./gear-damage.js";

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Announce a change of state in chat. Resolves once the card exists, so a
 * caller can make sure it lands before whatever follows — a complication spent
 * on breaking gear posts its own COMPLICATION card ahead of the injury card.
 *
 * @param {number} [opts.complications] Complications spent on it; titles the
 *   card COMPLICATION and says so.
 */
export async function postGearDamageCard(item, damaged, { reason = "", complications = 0 } = {}) {
  const words = gearDamageWords(item);
  const owner = item?.parent?.name ?? "";
  const accent = damaged ? LC.red : LC.green;
  const spent = damaged ? Math.max(0, Math.trunc(Number(complications)) || 0) : 0;
  const title = spent ? `COMPLICATION — ${words.state.toUpperCase()}` : (damaged ? words.state : words.fixed).toUpperCase();
  const line = damaged
    ? `<strong>${_esc(item.name)}</strong> is ${words.state.toLowerCase()}${reason ? ` — ${_esc(reason)}` : ""}.`
    : `<strong>${_esc(item.name)}</strong> is back in service — ${words.fixed}.`;
  const effect = !damaged ? ""
    : gearKind(item) === "weapon" ? `It can't be used in combat until it is ${words.fixed}.`
    : gearKind(item) === "forcefield" ? "It gives no Protection until it is recharged."
    : gearKind(item) === "armor" ? "It gives no Protection until it is repaired."
    : "";
  const body = `
    <div style="font-size:12px;font-weight:700;color:${LC.textBright};font-family:${LC.font};margin-bottom:3px;">${_esc(owner)}</div>
    ${spent ? `<div style="font-size:10px;font-weight:700;color:${LC.tertiary};font-family:${LC.font};margin-bottom:3px;">
      ${spent} complication${spent === 1 ? "" : "s"} spent</div>` : ""}
    <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">${line}</div>
    ${effect ? `<div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-top:3px;">${effect}</div>` : ""}`;
  try {
    return await ChatMessage.create({
      content: lcarsChatCard({
        title, accent, body,
        legacy: () => `<div style="border-left:3px solid ${accent};padding:4px 8px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:${accent};font-family:${LC.font};">${title}</div>${body}</div>`,
      }),
      speaker: { alias: "STA2e Toolkit" },
    });
  } catch (err) {
    console.warn("STA2e Toolkit | Gear damage card failed:", err);
    return null;
  }
}

/** Break or repair an item and announce it. False when nothing changed. */
export async function toggleGearDamage(item, damaged, { reason = "", potency = 1, mode = "broken", complications = 0 } = {}) {
  if (!isDamageable(item) || isGearDamaged(item) === !!damaged) return false;
  const ok = await setGearDamaged(item, !!damaged, { potency, mode });
  // Awaited: the card must be in chat before the caller posts anything after it.
  if (ok) await postGearDamageCard(item, !!damaged, { reason, complications });
  return ok;
}

// ── The negative trait ───────────────────────────────────────────────────────
//
// While an item is out of action its owner carries a trait — "Phaser Type-2
// (Broken)" — whose potency is how badly it is broken: 1 to start, raised by
// complications or, against a player character, by the GM spending Threat. It
// is an ordinary toolkit trait (trait-service.js): a Difficulty effect that
// scales with potency, offered in the roller like any other trait, and its
// potency is the base Difficulty to repair the item.
//
// The ACTIVE GM is the single writer (`registerGearDamageTraits`): it follows
// the item's damaged and potency flags from the `updateItem` hook, so every
// way of breaking something — the Toolkit HUD, a complication, a malfunction
// confirmed by a player — gets its trait without needing trait permissions.
// The trait carries `gearTraitFor` (the item id) to find it again; editing the
// trait's quantity on the sheet is copied back to the item.

const GEAR_TRAIT_FLAG = "gearTraitFor";

/** Raising a trait's potency costs 2 Threat a step (STA 2e), against a player character. */
export const POTENCY_THREAT_COST = 2;

/** The trait standing for a damaged item, on the same actor, or null. */
export function gearTraitFor(item) {
  const actor = item?.parent;
  if (!actor?.items || !item?.id) return null;
  return actor.items.find(t => t.type === "trait" && t.getFlag?.("sta2e-toolkit", GEAR_TRAIT_FLAG) === item.id) ?? null;
}

/** How badly an item is broken: its trait's potency, else the stored value. 0 when working. */
export function gearDamagePotency(item) {
  if (!isGearDamaged(item)) return 0;
  const trait = gearTraitFor(item);
  const q = Number(trait?.system?.quantity);
  return Number.isFinite(q) && q >= 1 ? Math.trunc(q) : storedGearDamagePotency(item);
}

function _gearTraitName(item) {
  return `${item.name} (${gearDamageWords(item).state})`;
}

/** Bring an item's trait in line with its damaged state and potency. Active GM only. */
async function _syncGearTrait(item) {
  const actor = item?.parent;
  if (!actor || !isDamageable(item)) return;
  const trait = gearTraitFor(item);
  const svc = await import("./trait-service.js");
  if (!isGearDamaged(item)) {
    if (trait) await actor.deleteEmbeddedDocuments("Item", [trait.id]);
    return;
  }
  const potency = storedGearDamagePotency(item);
  if (trait) {
    if (Number(trait.system?.quantity) !== potency) await svc.updateActorTraitItem(actor, trait.id, { quantity: potency });
    return;
  }
  const words = gearDamageWords(item);
  const created = await svc.createActorTrait(actor, {
    name: _gearTraitName(item),
    img: item.img,
    quantity: potency,
    description: `<p>${_esc(item.name)} is ${words.state.toLowerCase()}. The potency of this trait is the Difficulty to ${words.fix.toLowerCase()} it, and it hinders tasks that would rely on it.</p>`,
    automation: {
      duration: "persistent",
      sourceTags: ["gear-damage"],
      effects: [{
        type: "difficulty",
        label: `${item.name} ${words.state.toLowerCase()}`,
        value: 1,
        difficultyDirection: "increase",
        scalesWithQuantity: true,
        alwaysOn: false,
      }],
    },
  });
  await created?.setFlag?.("sta2e-toolkit", GEAR_TRAIT_FLAG, item.id);
}

/**
 * Raise a damaged item's potency by one. Against a player character it costs
 * the GM 2 Threat (POTENCY_THREAT_COST); an NPC's gear is the GM's own to make
 * worse.
 */
export async function raiseGearDamagePotency(item) {
  if (!isGearDamaged(item)) return false;
  const current = gearDamagePotency(item);
  if (current >= 5) { ui.notifications.info(`${item.name} is already at potency 5.`); return false; }
  if (item.parent?.hasPlayerOwner) {
    const { readPool, adjustPool } = await import("./pool-service.js");
    const threat = Number(readPool("threat")) || 0;
    if (threat < POTENCY_THREAT_COST) {
      ui.notifications.warn(`Raising potency costs ${POTENCY_THREAT_COST} Threat — ${threat} in the pool.`);
      return false;
    }
    await adjustPool("threat", -POTENCY_THREAT_COST, { source: "toolkit" });
  }
  return setGearDamagePotency(item, current + 1);
}

let _traitsRegistered = false;

/** The active GM keeps each damaged item's trait in step. Call once at init. */
export function registerGearDamageTraits() {
  if (_traitsRegistered) return;
  _traitsRegistered = true;
  const activeGm = async () => {
    try { return (await import("./gm-authority.js")).isActiveGM(); } catch { return game.user.isGM; }
  };
  Hooks.on("updateItem", async (item, changes) => {
    // The trait's own quantity edited on the sheet: copy it back to the item.
    if (item.type === "trait") {
      const forId = item.getFlag?.("sta2e-toolkit", GEAR_TRAIT_FLAG);
      if (!forId || foundry.utils.getProperty(changes, "system.quantity") === undefined) return;
      if (!(await activeGm())) return;
      const gear = item.parent?.items?.get(forId);
      const q = Math.max(1, Math.trunc(Number(item.system?.quantity)) || 1);
      if (gear && isGearDamaged(gear) && storedGearDamagePotency(gear) !== Math.min(5, q)) await setGearDamagePotency(gear, q);
      return;
    }
    if (!gearDamageChanged(changes) && !gearDamagePotencyChanged(changes)) return;
    if (!(await activeGm())) return;
    try { await _syncGearTrait(item); }
    catch (err) { console.warn("STA2e Toolkit | Gear damage trait sync failed:", err); }
  });
  // The item itself deleted: its trait goes with it.
  Hooks.on("deleteItem", async (item) => {
    if (!isDamageable(item) || !(await activeGm())) return;
    const actor = item.parent;
    const trait = actor?.items?.find(t => t.type === "trait" && t.getFlag?.("sta2e-toolkit", GEAR_TRAIT_FLAG) === item.id);
    if (trait) await actor.deleteEmbeddedDocuments("Item", [trait.id]).catch(() => {});
  });
}

/**
 * The small key a Token HUD Gear row carries: lit red while the item is out of
 * action (click to repair), dim otherwise (click to break).
 */
export function buildGearDamageKey(item, onDone, { mode = "broken" } = {}) {
  const damaged = isGearDamaged(item);
  // A working energy weapon gets one key per mode; a damaged item one repair key.
  const words = damaged ? gearDamageWords(item) : gearDamageWords(item, mode);
  const key = document.createElement("button");
  key.type = "button";
  key.className = `sta2e-gear-dmg-key${damaged ? " is-damaged" : ""}`;
  key.dataset.tooltip = damaged
    ? `${words.state} — click to ${words.fix.toLowerCase()}`
    : `Working — click to mark ${words.state.toLowerCase()}`;
  key.setAttribute("aria-label", key.dataset.tooltip);
  key.innerHTML = `<i class="${words.icon}"></i>`;
  key.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!item.isOwner) { ui.notifications.warn("You don't own that item."); return; }
    await toggleGearDamage(item, !damaged, { mode });
    onDone?.();
  });
  return key;
}

/** Everything on an actor that can be put out of action, working ones first. */
export function damageableGear(actor) {
  return (actor?.items?.contents ?? []).filter(isDamageable)
    .sort((a, b) => Number(isGearDamaged(a)) - Number(isGearDamaged(b)));
}

/** The actor a Working Results card was rolled for. */
function _cardActor(rollData) {
  const tokenObj = rollData?.tokenId ? canvas?.tokens?.get(rollData.tokenId) : null;
  return tokenObj?.actor
    ?? (rollData?.officerActorId ? game.actors.get(rollData.officerActorId) : null)
    ?? (rollData?.actorId ? game.actors.get(rollData.actorId) : null);
}

let _registered = false;

// ── The task COMPLICATIONS card ──────────────────────────────────────────────
//
// When a Working Results card is confirmed with complications, the active GM
// posts the working COMPLICATIONS card (complication-card.js, "task" kind) so
// any GM can spend them breaking the roller's gear — on the card, no prompt.
// A weapon attack that HIT is left out: its complications were settled on the
// attack's own working card before the damage card. A miss gets this one — and
// a missed pulse grenade its misfire card instead.

async function _postTaskComplications(message) {
  const flags = message.flags?.["sta2e-toolkit"] ?? {};
  const rollData = flags.rollData;
  if (!rollData || flags.gearComplicationCardPosted) return;
  if (rollData.weaponContext && rollData.confirmedPassed !== false) return;
  const actor = _cardActor(rollData);
  if (!actor) return;
  if (rollData.weaponContext) {
    const weapon = rollData.weaponContext.weaponId ? actor.items?.get(rollData.weaponContext.weaponId) : null;
    if (weapon && isPulseGrenade(weapon)) return;
  }
  let total = 0;
  try { total = (await import("./npc-roller.js")).rollComplicationTotal(rollData); } catch { return; }
  if (total < 1) return;
  await message.setFlag("sta2e-toolkit", "gearComplicationCardPosted", true);
  const { postTaskComplicationCard } = await import("./complication-card.js");
  await postTaskComplicationCard({ total, actor, attackerName: actor.name, taskLabel: rollData.taskLabel ?? "" });
}

/**
 * Post the task COMPLICATIONS card when a Working Results card is confirmed
 * with complications. Call once at init.
 */
export function registerGearDamageCardButton() {
  if (_registered) return;
  _registered = true;
  Hooks.on("updateChatMessage", async (message, changes) => {
    // Keyed on the confirmed ROLL DATA, not the bare `confirmed` flag: the confirm
    // handler sets that flag first, before the result is known (so a weapon
    // miss looked like an unresolved attack), and its later write leaves it
    // unchanged, so a hook on it never sees the finished roll.
    if (foundry.utils.getProperty(changes, "flags.sta2e-toolkit.rollData.confirmed") !== true) return;
    if (!message.flags?.["sta2e-toolkit"]?.playerRollCard) return;
    try {
      if (!(await import("./gm-authority.js")).isActiveGM()) return;
      await _postTaskComplications(message);
    } catch (err) {
      console.warn("STA2e Toolkit | Complications card failed:", err);
    }
  });
}

// ── Repair requests ──────────────────────────────────────────────────────────
//
// Repairing from a character sheet does not repair outright: it posts a REPAIR
// REQUEST card whispered to the active GM, who settles it one of three ways —
//
//   - Repair, no roll       — it just works again.
//   - Require a roll        — posts a Task Maker request card (attribute,
//                             discipline, Difficulty set on the card); a PASSED
//                             roll repairs the item (`completeGearRepairFromTask`,
//                             the taskCallback task-maker.js wires for
//                             `taskData.gearRepair`).
//   - Spend Momentum/Threat — a set amount from the group Momentum pool for a
//                             player character, or from Threat for an NPC.
//
// The card's controls are added at render time for GMs only, and the card is
// rewritten as resolved so it cannot be settled twice. The Token HUD's Gear
// section stays an instant GM toggle.

const REPAIR_ATTRS = [
  ["control", "Control"], ["daring", "Daring"], ["fitness", "Fitness"],
  ["insight", "Insight"], ["presence", "Presence"], ["reason", "Reason"],
];
const REPAIR_DISCS = [
  ["command", "Command"], ["conn", "Conn"], ["engineering", "Engineering"],
  ["medicine", "Medicine"], ["science", "Science"], ["security", "Security"],
];

/** Momentum for a player character, Threat for anyone else. */
function _repairPool(actor) {
  return actor?.hasPlayerOwner ? "momentum" : "threat";
}

const _cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

function _repairCardHtml(item, { resolution = "", offer = null, note = "" } = {}) {
  const words = gearDamageWords(item);
  const owner = item?.parent?.name ?? "";
  const body = `
    <div style="font-size:12px;font-weight:700;color:${LC.textBright};font-family:${LC.font};margin-bottom:3px;">${_esc(owner)}</div>
    <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
      Wants to ${words.fix.toLowerCase()} <strong>${_esc(item.name)}</strong>
      <span style="color:${LC.red};">(${words.state.toLowerCase()}${gearDamagePotency(item) ? `, potency ${gearDamagePotency(item)}` : ""})</span>.</div>
    ${resolution
      ? `<div class="sta2e-repair-resolved" style="font-size:10px;color:${LC.green};font-family:${LC.font};margin-top:4px;">${resolution}</div>`
      : offer
        ? `<div class="sta2e-repair-pending" style="font-size:10px;color:${LC.tertiary};font-family:${LC.font};margin-top:4px;">
            The GM offers to ${words.fix.toLowerCase()} it for <strong>${offer.cost} Momentum</strong>. Waiting for the player to accept.</div>`
        : `<div class="sta2e-repair-pending" style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-top:4px;">
            ${note ? `<span style="color:${LC.tertiary};">${note}</span> ` : ""}Waiting on the GM.</div>`}`;
  const title = `${words.fix.toUpperCase()} REQUEST`;
  return lcarsChatCard({
    title, accent: LC.secondary, body, rootClass: "sta2e-repair-request",
    legacy: () => `<div class="sta2e-repair-request" style="border-left:3px solid ${LC.secondary};padding:4px 8px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:${LC.secondary};font-family:${LC.font};">${title}</div>${body}</div>`,
  });
}

/**
 * Ask the GM to repair / recharge an item. Whispered to the active GM and to
 * the user who asked, so they see the outcome.
 */
export async function requestGearRepair(item) {
  if (!isDamageable(item) || !isGearDamaged(item)) return null;
  let gmIds = [];
  try {
    const { activeGmWhisperIds } = await import("./gm-authority.js");
    gmIds = activeGmWhisperIds(game.user.id);
  } catch { gmIds = [...game.users.filter(u => u.isGM).map(u => u.id), game.user.id]; }
  const token = item.parent?.isToken ? item.parent.token : null;
  ui.notifications.info(`Repair request for ${item.name} sent to the GM.`);
  return ChatMessage.create({
    content: _repairCardHtml(item),
    speaker: { alias: "STA2e Toolkit" },
    whisper: [...new Set(gmIds)],
    flags: { "sta2e-toolkit": { gearRepairRequest: {
      itemUuid: item.uuid,
      // Task Maker resolves its actor from the world collection, plus the token.
      actorId:  token ? (token.actorId ?? item.parent.id) : item.parent?.id,
      tokenId:  token?.id ?? null,
      resolved: false,
    } } },
  });
}

/**
 * Pay for a repair from the pool and repair. GM side only (pool writes and the
 * card update). False — with a warning — when the pool cannot cover it.
 */
async function _spendAndRepair(message, item, pool, cost) {
  const poolLabel = pool === "momentum" ? "Momentum" : "Threat";
  const { readPool, adjustPool } = await import("./pool-service.js");
  const have = Number(readPool(pool)) || 0;
  if (have < cost) {
    ui.notifications.warn(`Not enough ${poolLabel}: ${cost} needed, ${have} in the pool.`);
    return false;
  }
  await adjustPool(pool, -cost, { source: "toolkit" });
  await toggleGearDamage(item, false);
  await _resolveRequestCard(message, item,
    `${_cap(gearDamageWords(item).fixed)} for ${cost} ${poolLabel} (pool ${have} → ${have - cost}).`);
  return true;
}

/** Put a Momentum price on the card for the player to accept or decline. */
async function _offerRepair(message, item, cost) {
  await message.update({
    content: _repairCardHtml(item, { offer: { cost } }),
    "flags.sta2e-toolkit.gearRepairRequest.offer": { cost, pool: "momentum" },
  });
}

/**
 * The player's answer to an offer. Settled on the active GM: a player can
 * neither spend the group pool directly nor update the GM's card.
 */
async function _answerOffer(message, accept) {
  const req = message?.flags?.["sta2e-toolkit"]?.gearRepairRequest;
  if (!req?.offer || req.resolved) return;
  const item = await fromUuid(req.itemUuid).catch(() => null);
  if (!item) return;
  if (!accept) {
    // Back to the GM, who can set another price, ask for a roll, or leave it.
    await message.update({
      content: _repairCardHtml(item, { note: `The player declined ${req.offer.cost} Momentum.` }),
      "flags.sta2e-toolkit.gearRepairRequest.-=offer": null,
    });
    return;
  }
  const ok = await _spendAndRepair(message, item, req.offer.pool ?? "momentum", req.offer.cost);
  // Could not pay: drop the offer so the GM can choose again.
  if (!ok) await message.update({ content: _repairCardHtml(item), "flags.sta2e-toolkit.gearRepairRequest.-=offer": null });
}

/** Rewrite a request card as settled. GMs can update any message. */
async function _resolveRequestCard(message, item, resolution) {
  try {
    await message.update({
      content: _repairCardHtml(item, { resolution }),
      "flags.sta2e-toolkit.gearRepairRequest.resolved": true,
    });
  } catch (err) {
    console.warn("STA2e Toolkit | Could not mark the repair request resolved:", err);
  }
}

/**
 * A passed repair roll. Runs on the client that confirmed the roll; a user who
 * cannot write the item asks the active GM (socket `gearRepairComplete`), who
 * also marks the request card done.
 */
export async function completeGearRepairFromTask(gearRepair, result = {}) {
  if (!result?.passed || !gearRepair?.itemUuid) return null;
  const item = await fromUuid(gearRepair.itemUuid).catch(() => null);
  if (!item) return null;
  if (!item.isOwner || !game.user.isGM) {
    // The GM side settles the request card, which a player cannot update.
    if (item.isOwner) await toggleGearDamage(item, false);
    game.socket.emit("module.sta2e-toolkit", { action: "gearRepairComplete", gearRepair, repaired: item.isOwner });
    return item;
  }
  await toggleGearDamage(item, false);
  const message = gearRepair.requestMessageId ? game.messages.get(gearRepair.requestMessageId) : null;
  if (message) await _resolveRequestCard(message, item, `${_cap(gearDamageWords(item).fixed)} — the repair roll passed.`);
  return item;
}

// Colour goes inline, as every card body here writes it: Foundry's own chat
// button and field styles are dark-on-dark inside the LCARS frame, and the
// frame only sets shape (styles/chat-card.css). No inline border-radius.
const _keyStyle = (fill) => `background:${fill};color:#000;border:none;`;
const _fieldStyle = () => `background:${LC.bg};color:${LC.textBright};border:1px solid ${LC.border};`;

function _select(name, options, value) {
  return `<select data-repair="${name}" style="${_fieldStyle()}">${options.map(([k, l]) =>
    `<option value="${k}" ${k === value ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}

/** GM controls on an unresolved request card. */
async function _wireRepairRequest(message, html) {
  const req = message.flags?.["sta2e-toolkit"]?.gearRepairRequest;
  if (!req || req.resolved) return;
  if (req.offer) return _wireOfferAnswer(message, html, req);
  if (!game.user.isGM) return;
  const item = await fromUuid(req.itemUuid).catch(() => null);
  const root = html.querySelector(".sta2e-repair-request") ?? html.querySelector(".message-content") ?? html;
  if (!item || !root || root.querySelector(".sta2e-repair-controls")) return;
  // Inside the frame's body, above its bottom bar — not after it.
  const host = root.querySelector(".ccf-body") ?? root;
  if (!isGearDamaged(item)) {
    root.querySelector(".sta2e-repair-pending")?.replaceChildren(document.createTextNode("Already back in service."));
    return;
  }
  const actor = item.parent;
  const pool = _repairPool(actor);
  const poolLabel = pool === "momentum" ? "Momentum" : "Threat";
  const words = gearDamageWords(item);
  const defDisc = gearKind(item) === "weapon" ? "security" : "engineering";

  const box = document.createElement("div");
  box.className = "sta2e-repair-controls";
  box.innerHTML = `
    <div class="sta2e-repair-row">
      <button type="button" data-repair-act="free" style="${_keyStyle(LC.green)}"><i class="fas fa-check"></i> ${words.fix} — No Roll</button>
      <button type="button" data-repair-act="leave" style="${_keyStyle(LC.red)}"><i class="fas fa-ban"></i> Leave ${words.state}</button>
    </div>
    <div class="sta2e-repair-row">
      ${_select("attr", REPAIR_ATTRS, "control")}
      ${_select("disc", REPAIR_DISCS, defDisc)}
      <label style="color:${LC.text};" data-tooltip="Starts at the broken trait's potency">Diff <input type="number" data-repair="diff" min="0" max="5" value="${Math.max(1, gearDamagePotency(item))}" style="${_fieldStyle()}"></label>
    </div>
    <div class="sta2e-repair-row">
      <button type="button" data-repair-act="roll" style="${_keyStyle(LC.primary)}"><i class="fas fa-dice-d20"></i> Require Roll</button>
    </div>
    <div class="sta2e-repair-row">
      <label style="color:${LC.text};"><input type="number" data-repair="cost" min="1" max="6" value="2" style="${_fieldStyle()}"> ${poolLabel}</label>
      <button type="button" data-repair-act="spend" style="${_keyStyle(pool === "momentum" ? LC.secondary : LC.tertiary)}"><i class="fas fa-coins"></i> ${pool === "momentum" ? "Offer to Player" : `Spend &amp; ${words.fix}`}</button>
    </div>`;
  host.appendChild(box);

  const val = (k) => box.querySelector(`[data-repair="${k}"]`)?.value;
  const setLocked = (on) => box.querySelectorAll("button").forEach(b => { b.disabled = on; });

  box.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-repair-act]");
    if (!btn || btn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const act = btn.dataset.repairAct;

    if (act === "leave") {
      setLocked(true);
      await _resolveRequestCard(message, item, `The GM leaves it ${words.state.toLowerCase()} for now.`);
      return;
    }

    if (act === "free") {
      setLocked(true);
      await toggleGearDamage(item, false);
      await _resolveRequestCard(message, item, `${_cap(words.fixed)} — no roll needed.`);
      return;
    }

    if (act === "spend") {
      const cost = Math.max(1, Math.min(6, parseInt(val("cost"), 10) || 1));
      setLocked(true);
      // A player character's Momentum is the players' to spend: the GM sets the
      // price and the player accepts it on the card. Threat is the GM's own.
      if (pool === "momentum") await _offerRepair(message, item, cost);
      else if (!(await _spendAndRepair(message, item, pool, cost))) setLocked(false);
      return;
    }

    if (act === "roll") {
      const attrKey = val("attr") || "control";
      const discKey = val("disc") || "engineering";
      const difficulty = Math.max(0, Math.min(5, parseInt(val("diff"), 10) || 0));
      setLocked(true);
      const { postTaskRequestCard } = await import("./task-maker.js");
      const posted = await postTaskRequestCard({
        mode:       "task",
        actorId:    req.actorId ?? actor?.id,
        tokenId:    req.tokenId ?? null,
        taskName:   `${words.fix} ${item.name}`,
        flavor:     `${words.fix} the ${words.state.toLowerCase()} ${item.name}`,
        attrKey, discKey, difficulty,
        complicationRange: 1,
        gearRepair: { itemUuid: item.uuid, itemName: item.name, requestMessageId: message.id },
      });
      if (!posted) { setLocked(false); return; }
      const attrLabel = REPAIR_ATTRS.find(([k]) => k === attrKey)?.[1] ?? attrKey;
      const discLabel = REPAIR_DISCS.find(([k]) => k === discKey)?.[1] ?? discKey;
      await _resolveRequestCard(message, item,
        `Roll required: ${attrLabel} + ${discLabel}, Difficulty ${difficulty}. A passed roll ${words.fix.toLowerCase()}s it.`);
    }
  });
}

/**
 * Accept / Decline on a pending offer, for the character's owners (and the GM,
 * who can answer for an absent player). The GM also gets Withdraw, to take the
 * offer back and choose another way.
 */
async function _wireOfferAnswer(message, html, req) {
  const item = await fromUuid(req.itemUuid).catch(() => null);
  const root = html.querySelector(".sta2e-repair-request") ?? html.querySelector(".message-content") ?? html;
  if (!item || !root || root.querySelector(".sta2e-repair-controls")) return;
  const owns = !!item.parent?.isOwner;
  if (!owns && !game.user.isGM) return;
  const host = root.querySelector(".ccf-body") ?? root;
  const box = document.createElement("div");
  box.className = "sta2e-repair-controls";
  box.innerHTML = `
    <div class="sta2e-repair-row">
      <button type="button" data-offer="accept" style="${_keyStyle(LC.green)}"><i class="fas fa-check"></i> Accept — ${req.offer.cost} Momentum</button>
      <button type="button" data-offer="decline" style="${_keyStyle(LC.red)}"><i class="fas fa-xmark"></i> Decline</button>
    </div>
    ${game.user.isGM ? `<div class="sta2e-repair-row">
      <button type="button" data-offer="withdraw" style="${_keyStyle(LC.textDim)}"><i class="fas fa-rotate-left"></i> Withdraw Offer</button>
    </div>` : ""}`;
  host.appendChild(box);
  box.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-offer]");
    if (!btn || btn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    box.querySelectorAll("button").forEach(b => { b.disabled = true; });
    const answer = btn.dataset.offer;
    if (answer === "withdraw") {
      await message.update({ content: _repairCardHtml(item), "flags.sta2e-toolkit.gearRepairRequest.-=offer": null });
      return;
    }
    if (game.user.isGM) await _answerOffer(message, answer === "accept");
    else game.socket.emit("module.sta2e-toolkit", { action: "gearRepairOfferReply", messageId: message.id, accept: answer === "accept", userId: game.user.id });
  });
}

let _repairRegistered = false;

/** Request-card controls and the GM side of a relayed repair. Call once at init. */
export function registerGearRepairRequests() {
  if (_repairRegistered) return;
  _repairRegistered = true;
  Hooks.on("renderChatMessageHTML", (message, html) => { _wireRepairRequest(message, html); });
  game.socket.on("module.sta2e-toolkit", async (msg) => {
    if (msg?.action === "gearRepairOfferReply") {
      try {
        const { isActiveGM } = await import("./gm-authority.js");
        if (!isActiveGM()) return;
        const message = game.messages.get(msg.messageId);
        const req = message?.flags?.["sta2e-toolkit"]?.gearRepairRequest;
        const item = req ? await fromUuid(req.itemUuid).catch(() => null) : null;
        // Only an owner of the character may answer for it.
        const user = game.users.get(msg.userId ?? "") ?? null;
        if (user && item?.parent && !item.parent.testUserPermission(user, "OWNER")) return;
        await _answerOffer(message, !!msg.accept);
      } catch (err) {
        console.warn("STA2e Toolkit | Repair offer reply failed:", err);
      }
      return;
    }
    if (msg?.action !== "gearRepairComplete") return;
    try {
      const { isActiveGM } = await import("./gm-authority.js");
      if (!isActiveGM()) return;
      const gearRepair = msg.gearRepair ?? {};
      const item = await fromUuid(gearRepair.itemUuid).catch(() => null);
      if (!item) return;
      // The roller could not write the item — the GM repairs it.
      if (!msg.repaired) await toggleGearDamage(item, false);
      const message = gearRepair.requestMessageId ? game.messages.get(gearRepair.requestMessageId) : null;
      if (message) await _resolveRequestCard(message, item, `${_cap(gearDamageWords(item).fixed)} — the repair roll passed.`);
    } catch (err) {
      console.warn("STA2e Toolkit | Relayed gear repair failed:", err);
    }
  });
}

// ── Pulse grenades: count and misfire ────────────────────────────────────────
//
// The count (gear-damage.js `grenadeCount`) goes down by one per throw. The
// throwing client writes it when it owns the item, and otherwise asks the
// active GM (socket `grenadeCountSet`). The Gear section restocks it.
//
// A MISSED throw that rolled a complication can misfire: a card whispered to
// the active GM offers to set the grenade off on the thrower, or on another
// token the GM targets — resolved as an ordinary hit through
// `CombatHUD.triggerGrenadeMisfire`, so the usual ground damage card, Area
// spill and injury decisions follow — or to let it fall harmlessly.

/** Set how many grenades are left (0–20). Relays to the active GM if needed. */
export async function setGrenadeCount(item, count) {
  if (!isPulseGrenade(item)) return false;
  const n = Math.max(0, Math.min(20, Math.trunc(Number(count)) || 0));
  if (item.isOwner) {
    await item.setFlag("sta2e-toolkit", GRENADE_FLAG, n);
    return true;
  }
  game.socket.emit("module.sta2e-toolkit", { action: "grenadeCountSet", itemUuid: item.uuid, count: n });
  return true;
}

/** One grenade thrown. Says so when that was the last. */
export async function useGrenade(item) {
  const left = grenadeCount(item);
  if (left === null) return;
  const next = Math.max(0, left - 1);
  await setGrenadeCount(item, next);
  if (next === 0) ui.notifications.info(`That was the last ${item.name}.`);
}

function _misfireCardHtml(attackerName, weaponName, { resolution = "" } = {}) {
  const body = `
    <div style="font-size:12px;font-weight:700;color:${LC.textBright};font-family:${LC.font};margin-bottom:3px;">${_esc(attackerName)}</div>
    <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
      The <strong>${_esc(weaponName)}</strong> missed with a complication — it can go off somewhere else.</div>
    ${resolution
      ? `<div class="sta2e-misfire-resolved" style="font-size:10px;color:${LC.green};font-family:${LC.font};margin-top:4px;">${resolution}</div>`
      : `<div class="sta2e-misfire-pending" style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-top:4px;">
          To pick another token, target it (T) first.</div>`}`;
  return lcarsChatCard({
    title: "GRENADE MISFIRE", accent: LC.red, body, rootClass: "sta2e-grenade-misfire",
    legacy: () => `<div class="sta2e-grenade-misfire" style="border-left:3px solid ${LC.red};padding:4px 8px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:${LC.red};font-family:${LC.font};">GRENADE MISFIRE</div>${body}</div>`,
  });
}

/**
 * Offer the GM a misfire for a missed throw that rolled a complication.
 * Called on the client that confirmed the roll.
 */
export async function offerGrenadeMisfire({ attackerToken, weapon, useStun = false, missTargetIds = [] }) {
  if (!attackerToken || !isPulseGrenade(weapon)) return null;
  let whisper = game.users.filter(u => u.isGM).map(u => u.id);
  try { whisper = (await import("./gm-authority.js")).activeGmWhisperIds(); } catch { /* fallback */ }
  return ChatMessage.create({
    content: _misfireCardHtml(attackerToken.name, weapon.name),
    speaker: { alias: "STA2e Toolkit" },
    whisper,
    flags: { "sta2e-toolkit": { grenadeMisfire: {
      attackerTokenId: attackerToken.id,
      sceneId:         attackerToken.document?.parent?.id ?? canvas.scene?.id ?? null,
      weaponId:        weapon.id,
      weaponName:      weapon.name,
      useStun:         !!useStun,
      // The miss animation was held back for this card; No Misfire plays it.
      missTargetIds:   Array.isArray(missTargetIds) ? missTargetIds : [],
      resolved:        false,
    } } },
  });
}

async function _wireGrenadeMisfire(message, html) {
  const m = message.flags?.["sta2e-toolkit"]?.grenadeMisfire;
  if (!m || m.resolved || !game.user.isGM) return;
  const root = html.querySelector(".sta2e-grenade-misfire") ?? html.querySelector(".message-content") ?? html;
  if (!root || root.querySelector(".sta2e-repair-controls")) return;
  const host = root.querySelector(".ccf-body") ?? root;
  const attacker = canvas.tokens?.get(m.attackerTokenId);
  const box = document.createElement("div");
  box.className = "sta2e-repair-controls";
  box.innerHTML = `
    <div class="sta2e-repair-row">
      <button type="button" data-misfire="self" style="${_keyStyle(LC.red)}"><i class="fas fa-person-falling-burst"></i> Goes Off on ${_esc(attacker?.name ?? "the Thrower")}</button>
    </div>
    <div class="sta2e-repair-row">
      <button type="button" data-misfire="target" style="${_keyStyle(LC.primary)}"><i class="fas fa-crosshairs"></i> Goes Off on My Target</button>
    </div>
    <div class="sta2e-repair-row">
      <button type="button" data-misfire="none" style="${_keyStyle(LC.textDim)}"><i class="fas fa-xmark"></i> No Misfire</button>
    </div>`;
  host.appendChild(box);

  const settle = async (resolution) => {
    try {
      await message.update({
        content: _misfireCardHtml(attacker?.name ?? "", m.weaponName, { resolution }),
        "flags.sta2e-toolkit.grenadeMisfire.resolved": true,
      });
    } catch (err) { console.warn("STA2e Toolkit | Could not close the misfire card:", err); }
  };

  box.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-misfire]");
    if (!btn || btn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const choice = btn.dataset.misfire;
    if (choice === "none") {
      box.querySelectorAll("button").forEach(b => { b.disabled = true; });
      await settle("It falls harmlessly.");
      // Now show the miss the roll held back.
      const weapon = attacker?.actor?.items?.get(m.weaponId);
      const targets = (m.missTargetIds ?? []).map(id => canvas.tokens?.get(id)).filter(Boolean);
      if (attacker && weapon && targets.length) {
        try {
          const { fireWeapon, getWeaponConfig } = await import("./weapon-configs.js");
          const config = getWeaponConfig(weapon);
          if (config) await fireWeapon(config, false, attacker, targets, { weapon, useStun: m.useStun });
        } catch (err) { console.warn("STA2e Toolkit | Grenade miss animation failed:", err); }
      }
      return;
    }
    if (!attacker) { ui.notifications.warn("The thrower is not on this scene."); return; }
    let target = attacker;
    if (choice === "target") {
      const targets = [...game.user.targets];
      if (targets.length !== 1) {
        ui.notifications.info("Target the one token the grenade lands on (hover it and press T), then click again.");
        return;
      }
      target = targets[0];
    }
    box.querySelectorAll("button").forEach(b => { b.disabled = true; });
    const hud = game.sta2eToolkit?.combatHud;
    if (!hud?.triggerGrenadeMisfire) { ui.notifications.error("STA2e Toolkit: Combat HUD is not ready."); return; }
    const ok = await hud.triggerGrenadeMisfire(attacker, m.weaponId, target, { useStun: m.useStun });
    if (ok) await settle(`It goes off on ${_esc(target.name)} — see the damage card.`);
    else box.querySelectorAll("button").forEach(b => { b.disabled = false; });
  });
}

let _grenadeRegistered = false;

/** Misfire card controls and the GM side of a relayed count. Call once at init. */
export function registerGrenadeTools() {
  if (_grenadeRegistered) return;
  _grenadeRegistered = true;
  Hooks.on("renderChatMessageHTML", (message, html) => { _wireGrenadeMisfire(message, html); });
  game.socket.on("module.sta2e-toolkit", async (msg) => {
    if (msg?.action !== "grenadeCountSet") return;
    try {
      const { isActiveGM } = await import("./gm-authority.js");
      if (!isActiveGM()) return;
      const item = await fromUuid(msg.itemUuid).catch(() => null);
      if (item && isPulseGrenade(item)) await item.setFlag("sta2e-toolkit", GRENADE_FLAG, Math.max(0, Math.min(20, Math.trunc(Number(msg.count)) || 0)));
    } catch (err) {
      console.warn("STA2e Toolkit | Relayed grenade count failed:", err);
    }
  });
}
