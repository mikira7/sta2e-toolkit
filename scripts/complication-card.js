/**
 * sta2e-toolkit | complication-card.js
 *
 * The working COMPLICATIONS card — where complications are settled, in chat,
 * by whichever GM gets to it, instead of in a prompt on one client. Tables with
 * several GMs (or assistant GMs) cannot have a dialog pop up on the one machine
 * that happened to confirm the roll.
 *
 * Two kinds:
 *
 *   attack — a weapon attack that HIT with complications. The client that
 *            confirmed the roll posts the card and WAITS on it
 *            (`requestComplicationResolution`): the damage card is built only
 *            once a GM clicks Done, with what the card decided. Each
 *            complication is one of —
 *              · reduces Severity / damage by 1 (anything left unassigned),
 *              · bought off for 2 Threat (an NPC attacker),
 *              · the weapon malfunctions / its power cell burns out (a
 *                character weapon; one complication),
 *              · breaks another item of the attacker's (one or more
 *                complications each, which become its potency).
 *   task   — any other confirmed roll with complications (a task, or an attack
 *            that missed). Nothing waits on it; it only offers Break Gear.
 *
 * State lives in the message flag `complicationCard`; every change is a
 * message update, so all GMs see the same draft and any of them can finish it.
 * Nothing is spent or broken until Done, which applies it all at once and is
 * guarded against a second Done. The waiting client resolves off its own
 * `updateChatMessage` hook — the card is whispered to every GM and to that user
 * for exactly this reason (a client not on the whisper never gets the update).
 *
 * When nothing can be chosen (a player character's attack with no gear to
 * break, a player ship) no card is posted and every complication reduces the
 * damage, exactly as before.
 */

import { lcarsChatCard } from "./chat-card-frame.js";
import { getLcTokens } from "./lcars-theme.js";
import {
  isDamageable, isGearDamaged, gearDamageWords, gearDamageModes, isEnergyWeapon, gearKind,
} from "./gear-damage.js";
import { toggleGearDamage } from "./gear-damage-ui.js";

const MODULE = "sta2e-toolkit";
const FLAG = "complicationCard";
const BUYOFF_COST = 2;

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });
const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const _keyStyle = (fill) => `background:${fill};color:#000;border:none;`;
const _fieldStyle = () => `background:${LC.bg};color:${LC.textBright};border:1px solid ${LC.border};`;

/** messageId → resolve, for cards this client is waiting on. */
const _pending = new Map();

const ZERO = Object.freeze({ total: 0, boughtOff: 0, unresolved: 0, penalty: 0, threatSpent: 0 });

// ── State ────────────────────────────────────────────────────────────────────

function _used(st) {
  return (Number(st.buyoff) || 0)
    + (st.malfunction ? 1 : 0)
    + (st.breaks ?? []).reduce((n, b) => n + (Number(b.comp) || 0), 0);
}

function _remaining(st) {
  return Math.max(0, (Number(st.total) || 0) - _used(st));
}

/** What the damage step reads — the same shape the old prompt returned. */
function _result(st) {
  const resolvedOutright = (st.malfunction ? 1 : 0) + (st.breaks ?? []).reduce((n, b) => n + (Number(b.comp) || 0), 0);
  const total = Math.max(0, (Number(st.total) || 0) - resolvedOutright);
  const boughtOff = Number(st.buyoff) || 0;
  const unresolved = Math.max(0, total - boughtOff);
  return {
    total, boughtOff, unresolved,
    penalty: st.kind === "attack" ? unresolved : 0,
    threatSpent: boughtOff * BUYOFF_COST,
    malfunction: !!st.malfunction,
  };
}

async function _actor(st) {
  return st.actorUuid ? await fromUuid(st.actorUuid).catch(() => null) : null;
}

/** Working items of the attacker that a complication may break (not the attacking weapon). */
function _breakable(actor, st) {
  const taken = new Set((st.breaks ?? []).map(b => b.itemId));
  return (actor?.items?.contents ?? []).filter(i =>
    isDamageable(i) && !isGearDamaged(i) && i.id !== st.weaponId && !taken.has(i.id));
}

function _malfunctionAllowed(weapon) {
  return weapon?.type === "characterweapon2e" && !isGearDamaged(weapon);
}

// ── Card body ────────────────────────────────────────────────────────────────

function _html(st) {
  const unit = st.weaponType === "starshipweapon2e" || st.kind === "ship" ? "damage" : "Severity";
  const lines = [];
  if (st.buyoff) lines.push(`${st.buyoff} bought off (${st.buyoff * BUYOFF_COST} Threat)`);
  if (st.malfunction) lines.push(st.malfunction === "burnt" ? "1 — the power cell burns out" : "1 — the weapon malfunctions");
  for (const b of st.breaks ?? []) lines.push(`${b.comp} — ${_esc(b.itemName)} ${b.mode === "burnt" ? "burns out" : "breaks"} (potency ${b.comp})`);
  const left = _remaining(st);
  const leftLine = st.kind === "attack"
    ? `${left} left — each reduces ${unit} by 1`
    : `${left} left for the GM to narrate`;
  const status = st.done
    ? `<div style="font-size:10px;color:${LC.green};font-family:${LC.font};margin-top:4px;">Settled${st.kind === "attack" ? " — the damage card follows" : ""}.</div>`
    : `<div style="font-size:10px;color:${LC.textDim};font-family:${LC.font};margin-top:4px;">Any GM can settle this${st.kind === "attack" ? ` — the damage card waits on Done` : ""}.</div>`;
  const body = `
    <div style="font-size:12px;font-weight:700;color:${LC.textBright};font-family:${LC.font};margin-bottom:3px;">${_esc(st.attackerName)}</div>
    <div style="font-size:11px;color:${LC.text};font-family:${LC.font};">
      ${st.total} complication${st.total === 1 ? "" : "s"}${st.weaponName ? ` on <strong>${_esc(st.weaponName)}</strong>` : st.taskLabel ? ` on <strong>${_esc(st.taskLabel)}</strong>` : ""}.</div>
    ${lines.length ? `<ul style="margin:3px 0 0 14px;padding:0;font-size:10px;color:${LC.tertiary};font-family:${LC.font};">${lines.map(l => `<li>${l}</li>`).join("")}</ul>` : ""}
    <div style="font-size:10px;color:${left ? LC.text : LC.textDim};font-family:${LC.font};margin-top:3px;">${leftLine}.</div>
    ${status}`;
  return lcarsChatCard({
    title: "COMPLICATIONS", accent: LC.tertiary, body, rootClass: "sta2e-complication-card",
    legacy: () => `<div class="sta2e-complication-card" style="border-left:3px solid ${LC.tertiary};padding:4px 8px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:${LC.tertiary};font-family:${LC.font};">COMPLICATIONS</div>${body}</div>`,
  });
}

async function _write(message, st) {
  await message.update({ content: _html(st), [`flags.${MODULE}.${FLAG}`]: st });
}

function _whisper(extra = []) {
  // Every GM — any of them may settle it — plus whoever is waiting on it.
  return [...new Set([...game.users.filter(u => u.isGM).map(u => u.id), ...extra.filter(Boolean)])];
}

// ── Posting ──────────────────────────────────────────────────────────────────

/**
 * Settle an attack's complications on a working card and wait for it. Resolves
 * to `{total, boughtOff, unresolved, penalty, threatSpent, malfunction}` — the
 * shape the damage step already used. With nothing to choose, resolves at once
 * with every complication as a penalty and posts nothing.
 */
export async function requestComplicationResolution({
  total = 0, attackerIsNpc = false, attackerName = "Attacker", weapon = null, actor = null,
} = {}) {
  const n = Math.max(0, Math.trunc(Number(total)) || 0);
  if (n <= 0) return { ...ZERO };
  const owner = actor ?? weapon?.parent ?? null;
  const st = {
    kind: "attack",
    total: n,
    attackerName,
    attackerIsNpc: !!attackerIsNpc,
    actorUuid: owner?.uuid ?? null,
    weaponId: weapon?.id ?? null,
    weaponName: weapon?.name ?? "",
    weaponType: weapon?.type ?? null,
    malfunctionAllowed: _malfunctionAllowed(weapon),
    energy: isEnergyWeapon(weapon),
    buyoff: 0, malfunction: null, breaks: [],
    waitingUserId: game.user.id,
    done: false,
  };
  const choices = st.attackerIsNpc || st.malfunctionAllowed || _breakable(owner, st).length > 0;
  if (!choices) return { total: n, boughtOff: 0, unresolved: n, penalty: n, threatSpent: 0 };

  const message = await ChatMessage.create({
    content: _html(st),
    speaker: { alias: "STA2e Toolkit" },
    whisper: _whisper([game.user.id]),
    flags: { [MODULE]: { [FLAG]: st } },
  });
  if (!message) return { total: n, boughtOff: 0, unresolved: n, penalty: n, threatSpent: 0 };
  return new Promise(resolve => _pending.set(message.id, resolve));
}

/** The task kind: after a confirmed roll that is not a hit. Nothing waits on it. */
export async function postTaskComplicationCard({ total, actor, attackerName, taskLabel = "" }) {
  const n = Math.max(0, Math.trunc(Number(total)) || 0);
  if (n <= 0 || !actor) return null;
  const st = {
    kind: "task", total: n, attackerName: attackerName ?? actor.name, taskLabel,
    attackerIsNpc: false, actorUuid: actor.uuid, weaponId: null, weaponName: "", weaponType: null,
    malfunctionAllowed: false, energy: false,
    buyoff: 0, malfunction: null, breaks: [], done: false,
  };
  if (!_breakable(actor, st).length) return null;
  return ChatMessage.create({
    content: _html(st),
    speaker: { alias: "STA2e Toolkit" },
    whisper: _whisper(),
    flags: { [MODULE]: { [FLAG]: st } },
  });
}

// ── Done ─────────────────────────────────────────────────────────────────────

async function _finish(message) {
  // Re-read: another GM may have finished it a moment ago.
  if (message.flags?.[MODULE]?.[FLAG]?.done) return;
  // Claim it before spending anything, so two GMs clicking Done together do not
  // both pay the Threat: whoever's claim is on the message afterwards goes on.
  const claim = foundry.utils.randomID();
  await message.update({ [`flags.${MODULE}.${FLAG}.finishing`]: claim });
  const st = foundry.utils.deepClone(message.flags?.[MODULE]?.[FLAG] ?? {});
  if (!st || st.done || st.finishing !== claim) return;
  const actor = await _actor(st);

  if (st.buyoff > 0) {
    const { readPool, adjustPool } = await import("./pool-service.js");
    const have = Number(readPool("threat")) || 0;
    const cost = st.buyoff * BUYOFF_COST;
    if (have < cost) {
      ui.notifications.warn(`The buy-off needs ${cost} Threat — ${have} in the pool. Lower it and try again.`);
      return;
    }
    await adjustPool("threat", -cost, { source: "toolkit" });
  }
  if (st.malfunction && actor && st.weaponId) {
    const weapon = actor.items.get(st.weaponId);
    if (weapon && !isGearDamaged(weapon)) {
      await toggleGearDamage(weapon, true, {
        mode: st.malfunction,
        reason: st.malfunction === "burnt" ? "the power cell burnt out" : "the weapon malfunctioned",
        complications: 1,
      });
    }
  }
  for (const b of st.breaks ?? []) {
    const item = actor?.items?.get(b.itemId);
    if (!item || isGearDamaged(item)) continue;
    await toggleGearDamage(item, true, { mode: b.mode, potency: b.comp, complications: b.comp, reason: "a complication" });
  }

  st.done = true;
  st.result = _result(st);
  await _write(message, st);
}

// ── Controls (GMs, until Done) ───────────────────────────────────────────────

async function _wire(message, html) {
  const st0 = message.flags?.[MODULE]?.[FLAG];
  if (!st0 || st0.done || !game.user.isGM) return;
  const root = html.querySelector(".sta2e-complication-card") ?? html.querySelector(".message-content") ?? html;
  if (!root || root.querySelector(".sta2e-repair-controls")) return;
  const host = root.querySelector(".ccf-body") ?? root;
  const actor = await _actor(st0);
  const left = _remaining(st0);

  let threat = 0;
  if (st0.attackerIsNpc) { try { threat = Number((await import("./pool-service.js")).readPool("threat")) || 0; } catch { /* none */ } }
  const maxBuy = Math.min(Math.floor(threat / BUYOFF_COST), (st0.buyoff || 0) + left);

  const rows = [];
  if (st0.kind === "attack" && st0.attackerIsNpc) {
    rows.push(`<div class="sta2e-repair-row">
      <span style="color:${LC.text};font-size:10px;">Buy off (${BUYOFF_COST} Threat each · ${threat} in pool)</span>
      <button type="button" data-cc="buy-" style="${_keyStyle(LC.textDim)}" ${st0.buyoff ? "" : "disabled"}><i class="fas fa-minus"></i></button>
      <strong style="color:${LC.textBright};font-size:11px;">${st0.buyoff || 0}</strong>
      <button type="button" data-cc="buy+" style="${_keyStyle(LC.tertiary)}" ${(st0.buyoff || 0) < maxBuy ? "" : "disabled"}><i class="fas fa-plus"></i></button>
    </div>`);
  }
  if (st0.kind === "attack" && st0.malfunctionAllowed) {
    const opt = (v, l) => `<option value="${v}" ${(st0.malfunction ?? "") === v ? "selected" : ""}>${l}</option>`;
    rows.push(`<div class="sta2e-repair-row">
      <select data-cc="malfunction" style="${_fieldStyle()}" ${!st0.malfunction && !left ? "disabled" : ""}>
        ${opt("", "Weapon works")}${opt("broken", "Weapon malfunctions (1)")}${st0.energy ? opt("burnt", "Power cell burns out (1)") : ""}
      </select>
    </div>`);
  }
  const breakable = _breakable(actor, st0);
  for (const [i, b] of (st0.breaks ?? []).entries()) {
    rows.push(`<div class="sta2e-repair-row">
      <span style="color:${LC.text};font-size:10px;flex:1 1 auto;">${_esc(b.itemName)} — ${b.mode === "burnt" ? "burnt out" : "broken"}, ${b.comp}</span>
      <button type="button" data-cc="unbreak" data-index="${i}" style="${_keyStyle(LC.textDim)}"><i class="fas fa-xmark"></i></button>
    </div>`);
  }
  if (breakable.length && left > 0) {
    const options = breakable.flatMap(item => gearDamageModes(item).map(mode =>
      `<option value="${item.id}:${mode}">${_esc(item.name)} → ${gearDamageWords(item, mode).state}</option>`)).join("");
    rows.push(`<div class="sta2e-repair-row">
      <select data-cc="break-item" style="${_fieldStyle()}">${options}</select>
      <input type="number" data-cc="break-comp" min="1" max="${left}" value="1" style="${_fieldStyle()}" data-tooltip="Complications spent — its potency">
      <button type="button" data-cc="break" style="${_keyStyle(LC.red)}"><i class="fas fa-screwdriver-wrench"></i> Break</button>
    </div>`);
  }
  rows.push(`<div class="sta2e-repair-row">
    <button type="button" data-cc="done" style="${_keyStyle(LC.green)}"><i class="fas fa-check"></i> Done</button>
  </div>`);

  const box = document.createElement("div");
  box.className = "sta2e-repair-controls";
  box.innerHTML = rows.join("");
  host.appendChild(box);

  const lock = (on) => box.querySelectorAll("button, select, input").forEach(el => { el.disabled = on; });
  // Always edit the CURRENT flag, not the one this render saw — another GM may
  // have changed it since.
  const edit = async (fn) => {
    const st = foundry.utils.deepClone(message.flags?.[MODULE]?.[FLAG] ?? {});
    if (!st || st.done) return;
    fn(st);
    lock(true);
    await _write(message, st);
  };

  box.addEventListener("change", async (event) => {
    if (event.target.dataset.cc !== "malfunction") return;
    const v = event.target.value || null;
    await edit(st => { if (!v || st.malfunction || _remaining(st) > 0) st.malfunction = v; });
  });
  box.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-cc]");
    if (!btn || btn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const act = btn.dataset.cc;
    if (act === "buy+") return edit(st => { if (_remaining(st) > 0) st.buyoff = (st.buyoff || 0) + 1; });
    if (act === "buy-") return edit(st => { st.buyoff = Math.max(0, (st.buyoff || 0) - 1); });
    if (act === "unbreak") return edit(st => { st.breaks.splice(Number(btn.dataset.index), 1); });
    if (act === "break") {
      const [itemId, mode = "broken"] = String(box.querySelector("[data-cc=break-item]")?.value ?? "").split(":");
      const comp = Math.max(1, parseInt(box.querySelector("[data-cc=break-comp]")?.value, 10) || 1);
      const item = actor?.items?.get(itemId);
      if (!item) return;
      return edit(st => {
        const n = Math.min(comp, _remaining(st));
        if (n < 1) return;
        st.breaks = [...(st.breaks ?? []), { itemId, itemName: item.name, mode, comp: Math.min(5, n) }];
      });
    }
    if (act === "done") {
      lock(true);
      try { await _finish(message); }
      catch (err) {
        console.error("STA2e Toolkit | Settling complications failed:", err);
        ui.notifications.error("Settling the complications failed — see console.");
        lock(false);
      }
    }
  });
}

// ── Registration ─────────────────────────────────────────────────────────────

let _registered = false;

/** Card controls, and the waiting client's release when a GM clicks Done. Call once at init. */
export function registerComplicationCards() {
  if (_registered) return;
  _registered = true;
  Hooks.on("renderChatMessageHTML", (message, html) => { _wire(message, html); });
  Hooks.on("updateChatMessage", (message) => {
    const st = message.flags?.[MODULE]?.[FLAG];
    const resolve = _pending.get(message.id);
    if (!resolve || !st?.done) return;
    _pending.delete(message.id);
    resolve(st.result ?? _result(st));
  });
  // A card deleted before it was settled: every complication counts against the damage.
  Hooks.on("deleteChatMessage", (message) => {
    const resolve = _pending.get(message.id);
    if (!resolve) return;
    _pending.delete(message.id);
    const st = message.flags?.[MODULE]?.[FLAG] ?? {};
    const n = Number(st.total) || 0;
    resolve({ total: n, boughtOff: 0, unresolved: n, penalty: st.kind === "attack" ? n : 0, threatSpent: 0 });
  });
}
