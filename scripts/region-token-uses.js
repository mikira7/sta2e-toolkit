/**
 * sta2e-toolkit | region-token-uses.js
 *
 * "Once Per Token" and the cooldown for Region behaviors: which tokens have
 * already triggered a behavior, a Reset for one token or all of them, the Used
 * By block, and a per-behavior cooldown timer with its status line. Shared by
 * Random Teleport and Door & Light Control.
 *
 * A use is a token flag `{[behaviorId]: true}` under the behavior's own flag
 * key, so it travels with the token — a Random Teleport to another scene
 * recreates the token there with the mark — which is why `usedTokens` walks
 * every scene. Imports nothing.
 */

const MODULE = "sta2e-toolkit";

/** Has this token already triggered the behavior? */
export function hasUsed(token, flagKey, behaviorId) {
  return !!token?.getFlag?.(MODULE, flagKey)?.[behaviorId];
}

/** Every token, on any scene, marked as having triggered the behavior. */
export function usedTokens(flagKey, behaviorId) {
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens) if (hasUsed(token, flagKey, behaviorId)) out.push(token);
  }
  return out;
}

/** The update data that marks a use — usable on its own or inside a larger update. */
export function useMark(flagKey, behaviorId) {
  return { flags: { [MODULE]: { [flagKey]: { [behaviorId]: true } } } };
}

/** An update removing one key, in v14's operator form (the "-=" prefix is deprecated). */
function _unset(path) {
  const Del = foundry.data.operators?.ForcedDeletion;
  if (Del) return { [path]: new Del() };
  const i = path.lastIndexOf(".");
  return { [`${path.slice(0, i)}.-=${path.slice(i + 1)}`]: null };
}

/**
 * GM only. Clear the use mark from one token (document or UUID), or from every
 * token that has used the behavior when `tokenOrUuid` is omitted.
 * @returns {Promise<number>} How many tokens were reset.
 */
export async function resetUses(behavior, flagKey, tokenOrUuid = null) {
  if (!game.user.isGM) {
    ui.notifications?.warn("STA2e Toolkit | Only a GM can reset a behavior's uses.");
    return 0;
  }
  let tokens;
  if (tokenOrUuid) {
    const token = typeof tokenOrUuid === "string" ? await fromUuid(tokenOrUuid) : tokenOrUuid;
    tokens = token ? [token] : [];
  } else tokens = usedTokens(flagKey, behavior.id);

  const path = `flags.${MODULE}.${flagKey}.${behavior.id}`;
  const byScene = new Map();
  for (const t of tokens) {
    if (!hasUsed(t, flagKey, behavior.id) || !t.parent) continue;
    if (!byScene.has(t.parent)) byScene.set(t.parent, []);
    byScene.get(t.parent).push({ _id: t.id, ..._unset(path) });
  }
  let count = 0;
  for (const [scene, rows] of byScene) {
    try { await scene.updateEmbeddedDocuments("Token", rows); count += rows.length; }
    catch (err) { console.error("STA2e Toolkit | Reset of behavior uses failed", err); }
  }
  return count;
}

// ── Real entries ─────────────────────────────────────────────────────────────

/**
 * Did this move START inside the Region? Then it is not an entry, whatever
 * event fired: a token moving about inside a Region can still raise
 * TOKEN_ENTER / TOKEN_MOVE_IN when its path clips the edge, and that is how a
 * token that had sat inside through a cooldown got teleported by a move once
 * the cooldown ended. Tested with core's own TokenDocument#testInsideRegion at
 * the movement's origin, so it agrees with how core decides membership.
 * False when there is no movement (a token created or dropped inside).
 */
export function startedInside(token, region, movement) {
  const origin = movement?.origin;
  if (!origin || !region || token?.parent !== region.parent) return false;
  try { return !!token.testInsideRegion(region, origin); }
  catch { return false; }
}

// ── Cooldown ─────────────────────────────────────────────────────────────────
//
// One timer per behavior, in the behavior flag `cooldown: {until, waitEmpty}`.
// While `until` is in the future, entries are ignored. After it, `waitEmpty`
// keeps the behavior blocked while any OTHER token is still inside: it re-arms
// only once the Region has emptied. That needs no exit tracking — "the Region
// emptied since the trigger" is the same as "nobody else is inside as this
// token enters", since the entering token was outside a moment ago.
//
// Written by whoever triggers it, which must be able to update the behavior
// (the active GM); `_local` holds the same value at once, so two tokens
// arriving together cannot both pass before the flag write lands, and a client
// that cannot write the flag still keeps its own cooldown.

const _local = new Map();

/** A cooldown seconds field drawn as a number box (a 0–3600 slider is useless). */
export function cooldownField(hint) {
  const field = new foundry.data.fields.NumberField({
    required: true, nullable: false, integer: true, initial: 0, min: 0, max: 3600, step: 1,
    label: "Cooldown (seconds)", hint,
  });
  field.toInput = function(config = {}) {
    config.type ??= "number";
    return Object.getPrototypeOf(this).toInput.call(this, config);
  };
  return field;
}

// A behavior with several cooldowns (Region Logic, one per Cooldown node) names
// each one by `slot`; it is kept under the flag `cooldowns.<slot>`. No slot is
// the classic behaviors' single `cooldown`.
const _flagPath = slot => (slot ? `cooldowns.${slot}` : "cooldown");
const _localKey = (behavior, slot) => (slot ? `${behavior?.uuid}|${slot}` : behavior?.uuid);

function _cooldownState(behavior, slot = null) {
  const stored = (slot
    ? behavior?.getFlag?.(MODULE, "cooldowns")?.[slot]
    : behavior?.getFlag?.(MODULE, "cooldown")) ?? null;
  const local = _local.get(_localKey(behavior, slot)) ?? null;
  if (!stored) return local;
  if (!local) return stored;
  return (local.until ?? 0) >= (stored.until ?? 0) ? local : stored;
}

/**
 * Is the behavior cooling down for this entering token?
 * @param {RegionBehavior} behavior
 * @param {TokenDocument} entering
 * @param {(t: TokenDocument) => boolean} [counts]  Which tokens inside count as "still there".
 * @param {string|null} [slot]  Which of the behavior's cooldowns; none for the classic single one.
 * @returns {false|"cooling"|"occupied"}
 */
export function cooldownBlocked(behavior, entering, counts = () => true, slot = null) {
  const state = _cooldownState(behavior, slot);
  if (!state) return false;
  if (Date.now() < (state.until ?? 0)) return "cooling";
  if (state.waitEmpty) {
    const inside = [...(behavior.parent?.tokens ?? [])]
      .some(t => t !== entering && t.id !== entering?.id && counts(t));
    if (inside) return "occupied";
  }
  return false;
}

/** Start the behavior's cooldown now. No-op for 0 seconds. */
export async function startCooldown(behavior, seconds, slot = null) {
  if (!(seconds > 0) || !behavior) return;
  const state = { until: Date.now() + seconds * 1000, waitEmpty: true };
  _local.set(_localKey(behavior, slot), state);
  if (!behavior.canUserModify?.(game.user, "update")) return;
  try { await behavior.update({ [`flags.${MODULE}.${_flagPath(slot)}`]: state }); }
  catch (err) { console.warn("STA2e Toolkit | Could not save the behavior's cooldown", err); }
}

/** GM only. End the cooldown at once, including the wait for the Region to empty. */
export async function clearCooldown(behavior, slot = null) {
  _local.delete(_localKey(behavior, slot));
  if (!game.user.isGM || !behavior) return;
  await behavior.update({ [`flags.${MODULE}.${_flagPath(slot)}`]: null });
}

/**
 * A status line after the sheet's `system.cooldown` field: how long is left, or
 * that it is waiting for the Region to empty, with a Clear key. Refreshed once
 * a second while the sheet is open. GM only; idempotent.
 */
export function injectCooldownStatus(root, behavior, counts = () => true) {
  if (!root || !game.user.isGM || root.querySelector(".sta2e-behavior-cooldown")) return;
  const anchor = root.querySelector('[name="system.cooldown"]')?.closest(".form-group");
  if (!anchor) return;
  const block = document.createElement("div");
  block.className = "form-group sta2e-behavior-cooldown";
  const fill = () => {
    if (!block.isConnected && block.dataset.placed) { clearInterval(timer); return; }
    const state = _cooldownState(behavior);
    const left = Math.ceil(((state?.until ?? 0) - Date.now()) / 1000);
    let text = "Ready.";
    if (left > 0) text = `Cooling down — ${left} s left.`;
    else if (cooldownBlocked(behavior, null, counts)) text = "Waiting for the Region to empty.";
    const idle = text === "Ready.";
    block.innerHTML = `
      <div style="flex:0 0 100%;display:flex;align-items:center;gap:6px;min-width:0;">
        <span style="flex:1 1 auto;min-width:0;">Cooldown: ${text}
          <span style="opacity:0.65;">(STA Toolkit)</span></span>
        ${idle ? "" : `<button type="button" data-clear style="flex:0 0 auto;width:auto;">
          <i class="fa-solid fa-forward"></i> Clear</button>`}
      </div>`;
    block.querySelector("[data-clear]")?.addEventListener("click", async () => {
      await clearCooldown(behavior);
      fill();
    });
  };
  const timer = setInterval(fill, 1000);
  fill();
  anchor.after(block);
  block.dataset.placed = "1";
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

/**
 * Put the Used By block after the sheet's `system.oncePerToken` field: each
 * token that has used the behavior, with a Reset, and Reset All. Its own
 * full-width block, so it fits core's fixed sheet width. It refills in place
 * after a reset rather than re-rendering the sheet, which would throw away
 * unsaved edits in the other fields. GM only; idempotent.
 */
export function injectUsedBy(root, behavior, flagKey) {
  if (!root || !game.user.isGM || root.querySelector(".sta2e-behavior-used")) return;
  const anchor = root.querySelector('[name="system.oncePerToken"]')?.closest(".form-group");
  if (!anchor) return;

  const block = document.createElement("div");
  block.className = "form-group sta2e-behavior-used";
  const fill = () => {
    const used = usedTokens(flagKey, behavior.id);
    const rows = used.map(t => `
      <div style="display:flex;align-items:center;gap:6px;min-width:0;">
        <span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${esc(t.name)} <span style="opacity:0.65;">— ${esc(t.parent?.navName || t.parent?.name)}</span></span>
        <button type="button" data-reset="${esc(t.uuid)}" style="flex:0 0 auto;width:auto;">
          <i class="fa-solid fa-rotate-left"></i> Reset</button>
      </div>`).join("");
    block.innerHTML = `
      <div style="flex:0 0 100%;display:flex;flex-direction:column;gap:4px;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <strong style="flex:1 1 auto;">Used By <span style="opacity:0.65;font-weight:normal;">(STA Toolkit)</span></strong>
          ${used.length ? `<button type="button" data-reset-all style="flex:0 0 auto;width:auto;">
            <i class="fa-solid fa-rotate-left"></i> Reset All</button>` : ""}
        </div>
        ${rows || `<p class="hint" style="margin:0;">No token has used this behavior yet.</p>`}
      </div>`;
    block.querySelector("[data-reset-all]")?.addEventListener("click", async () => {
      const n = await resetUses(behavior, flagKey);
      ui.notifications.info(`Reset ${n} token${n === 1 ? "" : "s"}.`);
      fill();
    });
    for (const btn of block.querySelectorAll("[data-reset]")) {
      btn.addEventListener("click", async () => { await resetUses(behavior, flagKey, btn.dataset.reset); fill(); });
    }
  };
  fill();
  anchor.after(block);
}
