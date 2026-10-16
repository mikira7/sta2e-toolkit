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
