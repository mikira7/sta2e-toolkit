/**
 * sta2e-toolkit | spawn-buffer.js
 *
 * The "held somewhere else" panel shared by the spawn window's tabs.
 *
 * The transporter beams people into its pattern buffer and puts them back; Q
 * snaps them out of existence and can change his mind. Mechanically that is one
 * feature — a list of groups in a world setting, each restorable or purgeable —
 * so it lives here once, keyed by setting, with the materialisation supplied by
 * the caller.
 *
 * World-scoped storage is deliberate: any GM client can see and restore what
 * another GM put away, not just the one who did it.
 *
 * The markup uses the shared `.sw-*` class names from styles/spawn-window.css,
 * so one stylesheet serves every panel that uses this. It carries no id
 * attributes, because the spawn window keeps all its tabs mounted at once and
 * two buffer panels would otherwise collide.
 *
 * Group shape:
 *   { groupId, label, timestamp, entries: [{ actorId, name, resolvedImg, … }] }
 * Everything past `name` is the caller's business — this file only counts and
 * lists them.
 */

const MODULE = "sta2e-toolkit";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

// ── Storage ───────────────────────────────────────────────────────────────────

export async function getBufferGroups(settingKey) {
  try {
    const raw = game.settings.get(MODULE, settingKey);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export async function setBufferGroups(settingKey, groups) {
  await game.settings.set(MODULE, settingKey, groups);
}

export async function addBufferGroup(settingKey, group) {
  const existing = await getBufferGroups(settingKey);
  await setBufferGroups(settingKey, [...existing, group]);
}

export async function removeBufferGroup(settingKey, groupId) {
  const groups = await getBufferGroups(settingKey);
  await setBufferGroups(settingKey, groups.filter(g => g.groupId !== groupId));
}

export async function clearBufferGroups(settingKey) {
  await setBufferGroups(settingKey, []);
}

/** A new group ready to store. `label` is what the panel calls it. */
export function makeBufferGroup(label, entries, extra = {}) {
  return {
    groupId:   `grp_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    label:     String(label ?? "").toUpperCase(),
    timestamp: Date.now(),
    entries,
    ...extra,
  };
}

// ── Markup ────────────────────────────────────────────────────────────────────

/**
 * @param {object[]} groups
 * @param {object} [opts]
 * @param {string} [opts.title]      Summary line heading, e.g. "TRANSPORTER BUFFER"
 * @param {string} [opts.empty]      Shown when nothing is held
 * @param {string} [opts.unit]       What one entry is called — "PATTERN", "GUEST"
 * @param {string} [opts.icon]       Glyph on each group header
 */
export function buildBufferHTML(groups, {
  title = "BUFFER",
  empty = "— NOTHING HELD —",
  unit  = "PATTERN",
  icon  = "⚡",
} = {}) {
  if (!groups.length) return `<div class="sw-buffer-empty">${esc(empty)}</div>`;

  const total  = groups.reduce((n, g) => n + g.entries.length, 0);
  const plural = groups.length > 1 ? "S" : "";

  const groupRows = groups.map(g => {
    const names   = g.entries.map(e => esc(e.name)).join(" · ");
    const timeStr = new Date(g.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const ep      = g.entries.length > 1 ? "S" : "";
    const id      = esc(g.groupId);
    return `
      <div class="sw-buffer-group" data-group-id="${id}">
        <div class="sw-buffer-header">
          <span class="sw-buffer-icon">${icon}</span>
          <div class="sw-buffer-title">${esc(g.label)} — ${g.entries.length} ${esc(unit)}${ep}</div>
          <div class="sw-buffer-meta">${esc(timeStr)}</div>
        </div>
        <div class="sw-buffer-names">${names}</div>
        <div class="sw-buffer-actions">
          <button type="button" class="sw-group-btn sw-group-restore" data-group-id="${id}">RESTORE</button>
          <button type="button" class="sw-group-btn sw-group-purge"   data-group-id="${id}">PURGE</button>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="sw-buffer-container">
      <div class="sw-buffer-summary">
        <span>${esc(title)} — ${groups.length} GROUP${plural} / ${total} TOTAL</span>
        <span class="sw-purge-all">PURGE ALL</span>
      </div>
      ${groupRows}
    </div>`;
}

// ── Wiring ────────────────────────────────────────────────────────────────────

/**
 * Wire restore / purge / purge-all inside `scope`.
 *
 * @param {HTMLElement} scope
 * @param {object} opts
 * @param {string} opts.settingKey
 * @param {(group: object) => Promise<boolean>} opts.restore
 *   Materialise the group. Returning false (an aborted placement) leaves the
 *   group in the buffer and re-enables its button — nothing is lost to a
 *   cancelled click.
 * @param {() => Promise<void>} [opts.refresh]  Re-render the panel
 * @param {string} [opts.noun]  What the notifications call a group
 */
export function wireBufferButtons(scope, { settingKey, restore, refresh, noun = "group" } = {}) {
  if (!scope || !settingKey) return;

  scope.querySelectorAll(".sw-group-restore").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.style.opacity = "0.5";

      const groupId = btn.dataset.groupId;
      const groups  = await getBufferGroups(settingKey);
      const group   = groups.find(g => g.groupId === groupId);
      if (!group) {
        ui.notifications.warn(`That ${noun} is no longer held.`);
        await refresh?.();
        return;
      }

      const restored = await restore?.(group);
      if (restored) {
        await removeBufferGroup(settingKey, groupId);
        ui.notifications.info(`"${group.label}" restored.`);
        await refresh?.();
      } else {
        btn.disabled = false;
        btn.style.opacity = "";
      }
    });
  });

  scope.querySelectorAll(".sw-group-purge").forEach(btn => {
    btn.addEventListener("click", async () => {
      await removeBufferGroup(settingKey, btn.dataset.groupId);
      ui.notifications.info(`${noun[0].toUpperCase()}${noun.slice(1)} purged.`);
      await refresh?.();
    });
  });

  scope.querySelector(".sw-purge-all")?.addEventListener("click", async () => {
    await clearBufferGroups(settingKey);
    ui.notifications.info(`All held ${noun}s purged.`);
    await refresh?.();
  });
}
