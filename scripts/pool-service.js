/**
 * sta2e-toolkit | pool-service.js
 *
 * Central Momentum / Threat pool gateway. Values remain stored in the STA
 * system world settings for compatibility, but toolkit code applies its own
 * source-level permission policy before asking the STA tracker to update them.
 */

import { getLcTokens } from "./lcars-theme.js";

const MODULE = "sta2e-toolkit";
const POOL_LOG_BATCH_MS = 150;
const _poolLogBatches = new Map();

function _tracker() {
  return game.STATracker?.constructor ?? null;
}

function _canWriteWorldSettings() {
  return game.permissions?.SETTINGS_MODIFY?.includes(game.user.role) ?? game.user.isGM;
}

function _key(pool) {
  if (pool === "alliedNpcMomentum") return "alliedNpcMomentum";
  return pool === "threat" ? "threat" : "momentum";
}

function _source(options = {}) {
  return options?.source ?? "toolkit";
}

function _label(pool) {
  if (pool === "alliedNpcMomentum") return "Allied NPC Momentum";
  return pool === "threat" ? "Threat" : "Momentum";
}

function _sourceLabel(source) {
  const labels = {
    widget: "Widget",
    diceRoller: "Dice Roller",
    combat: "Combat",
    zoneMovement: "Zone Movement",
    zoneHazard: "Zone Hazard",
    overflow: "Overflow",
    torpedoAttack: "Torpedo Attack",
    regenShields: "Regen Shields",
    traitCreation: "Trait Creation",
    traitCreationRefund: "Trait Creation Refund",
    toolkit: "Toolkit",
  };
  return labels[source] ?? source ?? "Toolkit";
}

function _number(value) {
  return Math.max(0, Number(value) || 0);
}

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function _resolveToken(options = {}) {
  const token = options.token ?? options.speakerToken ?? null;
  if (token) return token;
  return canvas?.tokens?.controlled?.[0] ?? null;
}

function _resolveActor(options = {}, token = null, user = game.user) {
  return options.actor
    ?? token?.actor
    ?? token?.document?.actor
    ?? user?.character
    ?? null;
}

function _resolveUser(options = {}) {
  return game.users?.get?.(options.userId) ?? game.user;
}

function _shouldLogPoolChange(source, options = {}) {
  if (options.log === false) return false;
  if (options.notify === false) return false;
  if (source === "campaign") return false;
  try {
    if (game.settings.get(MODULE, "poolTrackerMode") !== "toolkit") return false;
    if (game.settings.get(MODULE, "poolChangeChatLog") !== true) return false;
  } catch {
    return false;
  }
  return true;
}

function _poolColor(pool, LC) {
  return pool === "threat" ? (LC.red ?? "#ff4455") : (LC.secondary ?? "#c8942c");
}

function _isToolkitPool(pool) {
  return pool === "alliedNpcMomentum";
}

function _buildPoolChangeCard(entries, source, actorName) {
  const LC = getLcTokens() ?? {};
  const bg = LC.bg ?? "#000000";
  const panel = LC.panel ?? "#111111";
  const primary = entries.length > 1 ? (LC.primary ?? "#f0a43a") : _poolColor(entries[0]?.pool, LC);
  const text = LC.text ?? "#f2c77a";
  const textDim = LC.textDim ?? "#b8842e";
  const textBright = LC.textBright ?? "#ffffff";
  const borderDim = LC.borderDim ?? "#3d2b12";
  const font = LC.font ?? "var(--font-primary)";
  const sourceLabel = _sourceLabel(source);
  const title = entries.length > 1 ? "POOL UPDATE" : `${_label(entries[0]?.pool).toUpperCase()} UPDATE`;

  const chip = (label, value, color = textBright) => `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-width:42px;padding:2px 5px;background:${panel};border:1px solid ${borderDim};
      border-radius:3px;">
      <div style="color:${textDim};font-size:7px;font-weight:700;letter-spacing:0.08em;
        text-transform:uppercase;line-height:1.1;">${label}</div>
      <div style="color:${color};font-size:14px;font-weight:800;line-height:1.05;">${value}</div>
    </div>`;

  const rows = entries.map(entry => {
    const color = _poolColor(entry.pool, LC);
    const sign = entry.delta > 0 ? "+" : "";
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;
      padding:3px 0;${entry === entries[0] ? "" : `border-top:1px solid ${borderDim};`}">
      <div style="min-width:66px;color:${color};font-size:8px;font-weight:800;
        letter-spacing:0.08em;text-transform:uppercase;">
        ${_label(entry.pool)}
      </div>
      <div style="display:flex;gap:4px;justify-content:flex-end;">
        ${chip("Delta", `${sign}${entry.delta}`, color)}
        ${chip("Total", entry.value, text)}
      </div>
    </div>`;
  }).join("");

  return `
<div class="sta2e-pool-change-card" data-pool="${entries.length > 1 ? "multiple" : entries[0]?.pool}" style="background:${bg};
  border:1px solid ${primary};border-left:4px solid ${primary};border-radius:3px;overflow:hidden;max-width:320px;
  font-family:${font};">
  <div style="background:${primary};color:${entries.length === 1 && entries[0]?.pool === "threat" ? "#ffffff" : bg};
    padding:3px 8px;font-size:8px;font-weight:800;letter-spacing:0.1em;
    text-transform:uppercase;">
    ${title}
  </div>
  <div style="padding:5px 8px;border-bottom:1px solid ${borderDim};">
    <div style="color:${textBright};font-size:11px;font-weight:700;line-height:1.15;">
      ${_escapeHtml(actorName)}
    </div>
    <div style="color:${textDim};font-size:7px;letter-spacing:0.08em;text-transform:uppercase;
      margin-top:1px;">
      ${_escapeHtml(sourceLabel)}
    </div>
  </div>
  <div style="padding:3px 8px 4px;">
    ${rows}
  </div>
</div>`;
}

function _poolLogBatchKey(user, actor, token, source, actorName) {
  const actorKey = actor?.uuid ?? actor?.id ?? "";
  const tokenDoc = token?.document ?? token ?? null;
  const tokenKey = tokenDoc?.uuid ?? tokenDoc?.id ?? "";
  return [
    user?.id ?? "unknown-user",
    source ?? "toolkit",
    actorKey || tokenKey || actorName || "unknown-actor",
  ].join("|");
}

async function _flushPoolLogBatch(key) {
  const batch = _poolLogBatches.get(key);
  if (!batch) return;
  _poolLogBatches.delete(key);

  const entries = Array.from(batch.entries.values()).filter(entry => entry.delta !== 0);
  if (!entries.length) return;

  try {
    const content = _buildPoolChangeCard(entries, batch.source, batch.actorName);
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({
        actor: batch.actor ?? null,
        token: batch.token?.document ?? batch.token ?? null,
        alias: batch.actorName,
      }),
      flags: {
        [MODULE]: {
          poolLog: {
            pool: entries.length === 1 ? entries[0].pool : "multiple",
            pools: entries.map(entry => ({
              pool: entry.pool,
              delta: entry.delta,
              value: entry.value,
            })),
            source: batch.source,
            userId: batch.user?.id ?? null,
          },
        },
      },
    });
  } catch (err) {
    console.warn("STA2e Toolkit | pool chat log failed:", err);
  }
}

async function _postPoolChangeLog(pool, delta, nextValue, source, options = {}) {
  if (!_shouldLogPoolChange(source, options)) return;
  if (!delta) return;

  try {
    const user = _resolveUser(options);
    const token = _resolveToken(options);
    const actor = _resolveActor(options, token, user);
    const actorName = actor?.name ?? token?.name ?? token?.document?.name ?? user?.name ?? "User";
    const key = _poolLogBatchKey(user, actor, token, source, actorName);
    let batch = _poolLogBatches.get(key);

    if (!batch) {
      batch = {
        actor,
        actorName,
        entries: new Map(),
        source,
        timer: null,
        token,
        user,
      };
      _poolLogBatches.set(key, batch);
    }

    const existing = batch.entries.get(pool);
    if (existing?.value === nextValue) return;
    batch.entries.set(pool, {
      pool,
      delta: (existing?.delta ?? 0) + delta,
      value: nextValue,
    });

    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => {
      _flushPoolLogBatch(key);
    }, POOL_LOG_BATCH_MS);
  } catch (err) {
    console.warn("STA2e Toolkit | pool chat log failed:", err);
  }
}

function _notifyBlocked(pool, source) {
  const label = _label(pool);
  if (pool === "threat") {
    ui.notifications?.warn(
      `STA2e Toolkit: Players can only add Threat through approved toolkit actions. (${source})`
    );
  } else {
    ui.notifications?.warn(`STA2e Toolkit: You do not have permission to update ${label}.`);
  }
}

function _refreshPoolUis() {
  try { game.sta2eToolkit?.poolTracker?.refresh?.(); } catch {}
  try { game.STATracker?.constructor?.UpdateTracker?.(); } catch {}
}

export function readPool(pool) {
  const key = _key(pool);
  if (_isToolkitPool(key)) {
    try { return Number(game.settings.get(MODULE, key)) || 0; }
    catch { return 0; }
  }
  const Tracker = _tracker();
  if (Tracker?.ValueOf) {
    try { return Number(Tracker.ValueOf(key)) || 0; }
    catch { /* fall through */ }
  }
  try { return Number(game.settings.get("sta", key)) || 0; }
  catch { return 0; }
}

export function poolLimit(pool) {
  const key = _key(pool);
  if (key === "alliedNpcMomentum") return 6;
  const Tracker = _tracker();
  if (Tracker?.LimitOf) {
    try { return Number(Tracker.LimitOf(key)) || (key === "momentum" ? 6 : 99); }
    catch { return key === "momentum" ? 6 : 99; }
  }
  if (key === "momentum") {
    try { return Number(game.settings.get("sta", "maxNumberOfMomentum")) || 6; }
    catch { return 6; }
  }
  return 99;
}

export function canUserAdjustPool(pool, source = "toolkit", delta = 0) {
  const key = _key(pool);
  if (game.user?.isGM) return true;
  if (key === "momentum" || key === "alliedNpcMomentum") return true;
  return ["diceRoller", "torpedoAttack"].includes(source) && Number(delta) > 0;
}

export async function setPool(pool, value, options = {}) {
  const key = _key(pool);
  const source = _source(options);
  const current = readPool(key);
  const limit = poolLimit(key);
  const nextValue = Math.max(0, Math.min(_number(value), limit));
  const delta = nextValue - current;

  if (delta === 0) {
    _refreshPoolUis();
    return true;
  }

  if (!canUserAdjustPool(key, source, delta)) {
    if (options.notify !== false) _notifyBlocked(key, source);
    return false;
  }

  if (_isToolkitPool(key)) {
    if (!_canWriteWorldSettings()) {
      if (!game.user?.isGM) {
        game.socket?.emit(`module.${MODULE}`, {
          action: "setToolkitPool",
          pool: key,
          value: nextValue,
          source,
          requesterUserId: game.user?.id ?? null,
        });
        _refreshPoolUis();
        return true;
      }
      if (options.notify !== false) {
        ui.notifications?.warn(`STA2e Toolkit: Could not update ${_label(key)}.`);
      }
      return false;
    }

    try {
      await game.settings.set(MODULE, key, nextValue);
      _refreshPoolUis();
      await _postPoolChangeLog(key, delta, nextValue, source, options);
      try { game.socket?.emit(`module.${MODULE}`, { action: "refreshPoolTracker" }); } catch {}
      return true;
    } catch (err) {
      console.warn(`STA2e Toolkit | setting ${key} write failed:`, err);
      return false;
    }
  }

  const Tracker = _tracker();
  if (Tracker?.DoUpdateResource) {
    try {
      if (!_canWriteWorldSettings()) {
        if (!Tracker.SendUpdateMessage) {
          if (options.notify !== false) {
            ui.notifications?.warn("STA2e Toolkit: STA tracker socket update API is unavailable.");
          }
          return false;
        }
        Tracker.SendUpdateMessage(Tracker.MessageType?.SetResource ?? "set-resource", key, nextValue);
        _refreshPoolUis();
        await _postPoolChangeLog(key, delta, nextValue, source, options);
        return true;
      }

      await Tracker.DoUpdateResource(key, nextValue);
      _refreshPoolUis();

      // If this client can write settings, the value should already be live.
      // If not, STA has emitted its own system socket and the GM will apply it.
      const ok = _canWriteWorldSettings()
        ? ((Tracker.ValueOf?.(key) ?? readPool(key)) === nextValue)
        : true;
      if (ok) await _postPoolChangeLog(key, delta, nextValue, source, options);
      return ok;
    } catch (err) {
      console.warn(`STA2e Toolkit | STA tracker ${key} write failed:`, err);
      if (options.notify !== false) {
        ui.notifications?.warn(`STA2e Toolkit: Could not update ${_label(key)}.`);
      }
      _refreshPoolUis();
      return false;
    }
  }

  if (!_canWriteWorldSettings()) {
    if (options.notify !== false) {
      ui.notifications?.warn("STA2e Toolkit: No STA tracker is available and this user cannot write world settings.");
    }
    return false;
  }

  try {
    await game.settings.set("sta", key, nextValue);
    _refreshPoolUis();
    await _postPoolChangeLog(key, delta, nextValue, source, options);
    return true;
  } catch (err) {
    console.warn(`STA2e Toolkit | STA setting ${key} write failed:`, err);
    return false;
  }
}

export async function adjustPool(pool, delta, options = {}) {
  const key = _key(pool);
  return setPool(key, readPool(key) + (Number(delta) || 0), options);
}

export function broadcastPoolRefresh() {
  _refreshPoolUis();
  try { game.socket?.emit(`module.${MODULE}`, { action: "refreshPoolTracker" }); } catch {}
}
