/**
 * sta2e-toolkit | gear-damage-ui.js
 *
 * The controls for damaged / broken gear (state and rules: gear-damage.js):
 *
 *   - `buildGearDamageKey` — the small key on each Token HUD Gear row
 *     (the GM toolkit menu's Gear section, gear-hud.js) that breaks or repairs that item.
 *   - `openBreakGearDialog` — pick one of an actor's items to put out of action;
 *     what a task card's Break Gear button opens.
 *   - `registerGearDamageCardButton` — that button, added to a Working Results
 *     card for the GM whenever the roll has a complication.
 *   - `toggleGearDamage` — the one writer the UI uses: flips the flag and posts
 *     a short chat card, so the table sees it happen.
 *
 * Shape lives in styles/appearance.css (`.sta2e-gear-*`).
 */

import { lcarsChatCard } from "./chat-card-frame.js";
import { getLcTokens } from "./lcars-theme.js";
import {
  isDamageable, isGearDamaged, setGearDamaged, gearDamageWords, gearKind,
} from "./gear-damage.js";

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Announce a change of state in chat. */
export function postGearDamageCard(item, damaged, { reason = "" } = {}) {
  const words = gearDamageWords(item);
  const owner = item?.parent?.name ?? "";
  const accent = damaged ? LC.red : LC.green;
  const title = (damaged ? words.state : words.fixed).toUpperCase();
  const line = damaged
    ? `<strong>${_esc(item.name)}</strong> is ${words.state.toLowerCase()}${reason ? ` — ${_esc(reason)}` : ""}.`
    : `<strong>${_esc(item.name)}</strong> is back in service — ${words.fixed}.`;
  const effect = !damaged ? ""
    : gearKind(item) === "weapon" ? "It can't be used in combat until it is repaired."
    : gearKind(item) === "forcefield" ? "It gives no Protection until it is recharged."
    : gearKind(item) === "armor" ? "It gives no Protection until it is repaired."
    : "";
  const body = `
    <div style="font-size:12px;font-weight:700;color:${LC.textBright};font-family:${LC.font};margin-bottom:3px;">${_esc(owner)}</div>
    <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">${line}</div>
    ${effect ? `<div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-top:3px;">${effect}</div>` : ""}`;
  try {
    ChatMessage.create({
      content: lcarsChatCard({
        title, accent, body,
        legacy: () => `<div style="border-left:3px solid ${accent};padding:4px 8px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:${accent};font-family:${LC.font};">${title}</div>${body}</div>`,
      }),
      speaker: { alias: "STA2e Toolkit" },
    });
  } catch (err) {
    console.warn("STA2e Toolkit | Gear damage card failed:", err);
  }
}

/** Break or repair an item and announce it. False when nothing changed. */
export async function toggleGearDamage(item, damaged, { reason = "" } = {}) {
  if (!isDamageable(item) || isGearDamaged(item) === !!damaged) return false;
  const ok = await setGearDamaged(item, !!damaged);
  if (ok) postGearDamageCard(item, !!damaged, { reason });
  return ok;
}

/**
 * The small key a Token HUD Gear row carries: lit red while the item is out of
 * action (click to repair), dim otherwise (click to break).
 */
export function buildGearDamageKey(item, onDone) {
  const words = gearDamageWords(item);
  const damaged = isGearDamaged(item);
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
    await toggleGearDamage(item, !damaged);
    onDone?.();
  });
  return key;
}

/** Everything on an actor that can be put out of action, working ones first. */
export function damageableGear(actor) {
  return (actor?.items?.contents ?? []).filter(isDamageable)
    .sort((a, b) => Number(isGearDamaged(a)) - Number(isGearDamaged(b)));
}

/**
 * Pick one of an actor's working items and put it out of action — a
 * complication's consequence. Resolves to the item, or null if cancelled.
 */
export async function openBreakGearDialog(actor, { reason = "Complication" } = {}) {
  const items = damageableGear(actor).filter(i => !isGearDamaged(i));
  if (!items.length) {
    ui.notifications.info(`${actor?.name ?? "That character"} has no working gear to break.`);
    return null;
  }
  const kindLabel = { weapon: "Weapon", forcefield: "Forcefield", armor: "Armour", gear: "Gear" };
  const rows = items.map((item, i) => `
    <label class="sta2e-gear-pick">
      <input type="radio" name="sta2e-gear-pick" value="${item.id}" ${i === 0 ? "checked" : ""}>
      <img src="${_esc(item.img)}" alt="">
      <span class="sta2e-gear-pick-name">${_esc(item.name)}</span>
      <span class="sta2e-gear-pick-kind">${kindLabel[gearKind(item)] ?? ""} → ${gearDamageWords(item).state}</span>
    </label>`).join("");
  const id = await foundry.applications.api.DialogV2.wait({
    window: { title: `${actor.name} — Break Gear` },
    content: `<div class="sta2e-gear-pick-list">
      <p style="font-size:11px;margin:0 0 6px;">Which item does the complication put out of action?</p>${rows}</div>`,
    buttons: [
      {
        action: "break", label: "Break It", icon: "fas fa-screwdriver-wrench", default: true,
        callback: (_e, _b, dlg) => dlg.element.querySelector("input[name=sta2e-gear-pick]:checked")?.value ?? null,
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  }).catch(() => null);
  const item = id && id !== "cancel" ? actor.items.get(id) : null;
  if (!item) return null;
  await toggleGearDamage(item, true, { reason });
  return item;
}

/** The actor a Working Results card was rolled for. */
function _cardActor(rollData) {
  const tokenObj = rollData?.tokenId ? canvas?.tokens?.get(rollData.tokenId) : null;
  return tokenObj?.actor
    ?? (rollData?.officerActorId ? game.actors.get(rollData.officerActorId) : null)
    ?? (rollData?.actorId ? game.actors.get(rollData.actorId) : null);
}

let _registered = false;

/**
 * A "Break Gear" key on a Working Results card, for the GM, whenever the roll
 * has at least one complication. It never edits the card — it is appended to
 * the rendered DOM on each render, so neither skin's template changes.
 */
export function registerGearDamageCardButton() {
  if (_registered) return;
  _registered = true;
  Hooks.on("renderChatMessageHTML", async (message, html) => {
    if (!game.user.isGM) return;
    const flags = message.flags?.["sta2e-toolkit"] ?? {};
    if (!flags.playerRollCard || !flags.rollData) return;
    const actor = _cardActor(flags.rollData);
    if (!actor || !damageableGear(actor).length) return;
    let total = 0;
    try {
      const { rollComplicationTotal } = await import("./npc-roller.js");
      total = rollComplicationTotal(flags.rollData);
    } catch { return; }
    if (total < 1) return;
    const root = html.querySelector(".sta2e-task-card") ?? html.querySelector(".message-content") ?? html;
    if (!root || root.querySelector(".sta2e-break-gear")) return;
    const row = document.createElement("div");
    row.className = "sta2e-break-gear";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sta2e-break-gear-btn";
    btn.style.color = LC.red;
    btn.dataset.tooltip = `A complication: put one of ${actor.name}'s items out of action`;
    btn.innerHTML = `<i class="fas fa-screwdriver-wrench"></i> Break Gear (${total} complication${total === 1 ? "" : "s"})`;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBreakGearDialog(actor, { reason: "complication" });
    });
    row.appendChild(btn);
    root.appendChild(row);
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
      <span style="color:${LC.red};">(${words.state.toLowerCase()})</span>.</div>
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
      <label style="color:${LC.text};">Diff <input type="number" data-repair="diff" min="0" max="5" value="1" style="${_fieldStyle()}"></label>
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
