/**
 * sta2e-toolkit | q-spawner.js
 *
 * The Q tab of the spawn window.
 *
 * Mechanically the transporter — drag actors into a queue, pick a pattern and a
 * spawn location, place them — with every in-fiction limit taken off. No
 * six-pattern cap, no emitter types, no pads required, no range. Q does not
 * need a transporter room.
 *
 * Three things it does that the transporter cannot:
 *   • Snap In / Snap Out with no cap on either.
 *   • Hold what it snapped away in its own buffer, separate from the
 *     transporter's, so restoring one never touches the other.
 *   • Q Flash Move — take whatever is selected and put it somewhere else,
 *     keeping the group's shape, in one gesture.
 *
 * The look is q-vfx.js: the warp flash desaturated white at each token, plus a
 * white wash across the scene on every action.
 *
 * Like the other two tabs it emits only the shared `.sw-*` classes and builds
 * its markup with the helpers in spawn-chrome.js, so styles/spawn-window.css
 * skins it for free in every era. It registers no styles of its own and — unlike
 * the arrangement this replaced — no longer depends on the Transporter tab being
 * registered to get a look.
 */

import {
  swColumns, swPanel, swGrid, swField, swSelect, swInput, swKey,
} from "./spawn-chrome.js";
import { SPAWN_PATTERNS } from "./spawn-patterns.js";
import { buildSpawnTokenData, protoHalfSize, getWildcardImage } from "./token-spawn-utils.js";
import { centreToTopLeft, pickSpawnCentres } from "./spawn-picker.js";
import { buildLocationOptions, parseLocation } from "./spawn-regions.js";
import { registerSpawnTab, openSpawnWindow, getSpawnPref, setSpawnPref } from "./spawn-window.js";
import {
  buildBufferHTML,
  getBufferGroups,
  removeBufferGroup,
  wireBufferButtons,
} from "./spawn-buffer.js";
import { buildQueueHTML, renderQueue, wireQueue, expandQueue, queueTotal } from "./spawn-queue.js";
import { Q_COLOR, playQSceneFlash, qSnapIn } from "./q-vfx.js";
import {
  Q_BUFFER_SETTING,
  qFlashMoveTokens,
  qSnapOutTokens,
  resolveQTargets,
} from "./q-actions.js";

const TAB_ID         = "q";
const BUFFER_SETTING = Q_BUFFER_SETTING;

/** Where the last snap was aimed, remembered across window opens. */
const SITE_PREF = "qLocation";

const _getHeldGroups   = () => getBufferGroups(BUFFER_SETTING);
const _removeHeldGroup = groupId => removeBufferGroup(BUFFER_SETTING, groupId);

/** The queue, and the buffer as last rendered — same shape as the other tabs. */
let _qQueue  = [];
let _qGroups = [];

function _defaultSpacing() {
  return Math.round(350 * ((canvas.grid?.size ?? 100) / 100));
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

/** One arrival. `radius` drives the placement preview, halfW/halfH the maths. */
function _qItem({ actor, displayName, isWildcard, wildcardPath, resolvedImg }) {
  const { halfW, halfH } = protoHalfSize(actor);
  return {
    actor, displayName, isWildcard, wildcardPath, resolvedImg,
    halfW, halfH,
    radius: Math.max(Math.max(halfW, halfH) * 0.9, 25),
  };
}

/**
 * Create the tokens and snap them into existence.
 *
 * One scene flash for the whole group rather than one each — Q makes a single
 * gesture, however many people arrive on it. The per-token bursts then run in
 * parallel, so a crowd appears together instead of filing in.
 */
async function _materializeQ(items, centres, { snap = false } = {}) {
  canvas.animatePan({ x: centres[0]?.x ?? 0, y: centres[0]?.y ?? 0, duration: 600 });

  const created = [];
  for (let i = 0; i < items.length; i++) {
    const item   = items[i];
    const centre = centres[i] ?? centres[0];
    const { x, y } = centreToTopLeft(centre, item.halfW, item.halfH, snap);

    try {
      const data = await buildSpawnTokenData(item.actor, {
        name: item.displayName, x, y, alpha: 0,
      });

      // A restored guest comes back wearing the image they left with, rather
      // than a fresh wildcard roll.
      const proto    = item.actor.prototypeToken;
      const protoImg = proto?.texture?.src ?? proto?.img;
      let img = item.resolvedImg ?? null;
      if (!img && item.isWildcard && item.wildcardPath) img = await getWildcardImage(item.wildcardPath);
      if (img && img !== protoImg) {
        data.texture = foundry.utils.mergeObject(data.texture ?? {}, { src: img });
      }

      const [doc] = await canvas.scene.createEmbeddedDocuments("Token", [data]);
      if (!doc) throw new Error("Token creation returned nothing.");
      created.push(doc);
    } catch (err) {
      console.error(`STA2e Toolkit | Q spawner: failed to spawn ${item.displayName}:`, err);
      ui.notifications.error(`Failed to spawn ${item.displayName}.`);
    }
  }

  // Yield so the canvas registers the placeables before they are animated —
  // the same 50ms the transporter and ship spawner both need.
  await new Promise(r => setTimeout(r, 50));

  // The wash fires here rather than up front: creating a large group takes long
  // enough that a flash before it would have faded before anyone appeared.
  playQSceneFlash();
  await Promise.allSettled(created.map(doc => {
    const tok = canvas.tokens.get(doc.id);
    return tok ? qSnapIn(tok) : null;
  }));

  return created.length;
}

/** Snap the queue in. No total cap — that is the whole point of this tab. */
async function _snapInQueue(queue, { pattern, spacing, location }) {
  if (!queue.length) {
    ui.notifications.warn("Nothing in the queue for Q to bring.");
    return false;
  }

  const items = expandQueue(queue).map(entry => _qItem({
    actor:        entry.actor,
    displayName:  entry.displayName,
    isWildcard:   entry.isWildcard,
    wildcardPath: entry.wildcardPath,
  }));

  const centres = await pickSpawnCentres(items, {
    pattern, spacing, location,
    color: Q_COLOR,
    verb: "Q SNAP",
    noun: "guest",
    abortMsg: "Q lost interest.",
  });
  if (!centres) return false;   // aborted — queue stays intact

  await _materializeQ(items, centres, { snap: parseLocation(location).kind === "region" });
  return true;
}

/** Put a held group back. Same placement flow as a fresh snap-in. */
async function _restoreHeldGroup(group, { pattern, spacing, location }) {
  const items = [];
  for (const entry of group.entries) {
    const actor = game.actors.get(entry.actorId);
    if (!actor) { console.warn(`STA2e Toolkit | Q spawner: actor ${entry.actorId} not found.`); continue; }
    items.push(_qItem({
      actor,
      displayName:  entry.name,
      isWildcard:   entry.isWildcard,
      wildcardPath: entry.wildcardPath,
      resolvedImg:  entry.resolvedImg,
    }));
  }
  if (!items.length) {
    ui.notifications.error(`No actors left for "${group.label}" — nothing to bring back.`);
    return false;
  }

  const centres = await pickSpawnCentres(items, {
    pattern, spacing, location,
    color: Q_COLOR,
    verb: `Q RETURN · ${group.label}`,
    noun: "guest",
    abortMsg: "Q lost interest.",
  });
  if (!centres) return false;   // aborted — the group stays held

  await _materializeQ(items, centres, { snap: parseLocation(location).kind === "region" });
  return true;
}

// Snap Out and Q Flash Move operate on tokens already on the canvas, and the
// Token HUD wants them too — they live in q-actions.js.

// ── Panel ─────────────────────────────────────────────────────────────────────

const _buildHeldHTML = groups => buildBufferHTML(groups, {
  title: "HELD",
  empty: "— NOBODY HELD —",
  unit:  "GUEST",
  icon:  "✦",
});

/** The held column's contents — rebuilt on its own whenever the buffer changes. */
function _buildHeldColumn(groups) {
  return swPanel("Held by Q", _buildHeldHTML(groups));
}

function _buildPanelHTML(groups) {
  const config = swGrid([
    swField("Arrangement", swSelect({
      id: "sta2e-q-pattern",
      options: Object.entries(SPAWN_PATTERNS)
        .map(([key, label]) => `<option value="${key}">${label}</option>`)
        .join(""),
    })),
    swField("Token Spacing", swInput({ id: "sta2e-q-spacing", value: _defaultSpacing() })),
    swField("Appears At",
      swSelect({
        id: "sta2e-q-location",
        options: buildLocationOptions(getSpawnPref(SITE_PREF, "canvas")),
      }),
      { noteId: "sta2e-q-location-note", wide: true }),
  ].join(""), 2);

  const left = [
    swPanel("Manifestation", config),
    swPanel("Summoning Queue", buildQueueHTML({ hint: "✦ Drag anyone Q feels like summoning ✦" }), {
      meta: "drag tokens / actors here",
    }),
  ].join("");

  return swColumns(left, _buildHeldColumn(groups));
}

function _readControls(root) {
  const q = sel => root?.querySelector(sel);
  return {
    spacing:  parseInt(q("#sta2e-q-spacing")?.value ?? _defaultSpacing()) || _defaultSpacing(),
    pattern:  q("#sta2e-q-pattern")?.value  ?? "circle",
    location: q("#sta2e-q-location")?.value || "canvas",
  };
}

function _refreshPanel(root) {
  const select = root?.querySelector("#sta2e-q-location");
  if (select) {
    select.innerHTML = buildLocationOptions(select.value);
    if (!select.value) select.value = "canvas";
  }

  const site     = parseLocation(select?.value);
  const onCanvas = site.kind === "canvas";
  const pattern  = root?.querySelector("#sta2e-q-pattern");
  const spacing  = root?.querySelector("#sta2e-q-spacing");
  if (pattern) pattern.disabled = !onCanvas;
  if (spacing) spacing.disabled = !onCanvas;

  const note = root?.querySelector("#sta2e-q-location-note");
  if (note) {
    note.textContent = site.kind === "pads" ? "ONE GUEST PER SPAWN MARKER"
                     : site.kind === "region" ? "ONE GUEST PER GRID SPACE"
                     : "";
  }
}

// ── Rail keys ─────────────────────────────────────────────────────────────────

function _buildActions(panel, api, refresh) {
  /** Run something with the window out of the way of the canvas. */
  const place = fn => (api?.hideWhile ? api.hideWhile(fn) : fn());
  /** Disable a key for the duration, whatever happens inside. */
  const guard = async (btn, fn) => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { return await fn(); }
    finally { btn.disabled = false; }
  };

  const keys = [];

  const snapIn = swKey("Snap In", { icon: "fas fa-hand-sparkles" });
  snapIn.addEventListener("click", () => guard(snapIn, async () => {
    if (!queueTotal(_qQueue)) { ui.notifications.warn("Nothing in the queue for Q to bring."); return; }
    const done = await place(() => _snapInQueue(_qQueue, _readControls(panel)));
    if (done) { _qQueue.splice(0, _qQueue.length); renderQueue(panel, _qQueue); }
  }));
  keys.push(snapIn);

  const snapOut = swKey("Snap Out", {
    icon: "fas fa-wand-magic",
    accent: "var(--sw-secondary)",
    title: "Snap the selected tokens away and hold them",
  });
  snapOut.addEventListener("click", () => guard(snapOut, async () => {
    if (await qSnapOutTokens(resolveQTargets())) await refresh();
  }));
  keys.push(snapOut);

  const flashMove = swKey("Flash Move", {
    icon: "fas fa-bolt",
    accent: "var(--sw-tertiary)",
    title: "Move the selection somewhere else, keeping its shape",
  });
  flashMove.addEventListener("click", () => guard(flashMove, () =>
    qFlashMoveTokens(resolveQTargets(), { hideWhile: api?.hideWhile })));
  keys.push(flashMove);

  if (_qGroups.length) {
    const total = _qGroups.reduce((n, g) => n + g.entries.length, 0);
    const restoreAll = swKey(`Return ${total}`, {
      icon: "fas fa-rotate-left",
      accent: "var(--sw-deco-b)",
      title: `Return everyone Q is holding (${total})`,
    });
    restoreAll.addEventListener("click", () => guard(restoreAll, async () => {
      const cfg = _readControls(panel);
      const latest = await _getHeldGroups();
      const allBack = await place(async () => {
        for (const group of latest) {
          if (!await _restoreHeldGroup(group, cfg)) return false;
          await _removeHeldGroup(group.groupId);
        }
        return true;
      });
      if (allBack) ui.notifications.info("Q returned everyone.");
      await refresh();
    }));
    keys.push(restoreAll);
  }

  return keys;
}

// ── Tab registration ──────────────────────────────────────────────────────────

registerSpawnTab({
  id:    TAB_ID,
  label: "Q",
  icon:  "fas fa-hand-sparkles",
  meta:  () => "Rules need not apply",
  buildHTML: async () => {
    _qGroups = await _getHeldGroups();
    return _buildPanelHTML(_qGroups);
  },

  wire: (panel, api) => {
    const refresh = async () => {
      _qGroups = await _getHeldGroups();
      const colRight = panel.querySelector(".sw-col--right");
      if (colRight) {
        colRight.innerHTML = _buildHeldColumn(_qGroups);
        _wireHeld(colRight, panel, api, refresh);
      }
      api.refreshActions();
    };
    panel._sta2eRefresh = refresh;

    wireQueue(panel, _qQueue);
    _wireHeld(panel, panel, api, refresh);

    // Persisted only on a real choice, never on a refresh: moving to a scene
    // without those markers should not erase the site you normally use.
    panel.querySelector("#sta2e-q-location")?.addEventListener("change", ev => {
      setSpawnPref(SITE_PREF, ev.currentTarget.value);
      _refreshPanel(panel);
    });

    renderQueue(panel, _qQueue);
    _refreshPanel(panel);
  },

  onActivate: panel => {
    renderQueue(panel, _qQueue);
    _refreshPanel(panel);
  },

  buildActions: (panel, api) =>
    _buildActions(panel, api, panel._sta2eRefresh ?? (async () => {})),
});

function _wireHeld(scope, panel, api, refresh) {
  const place = fn => (api?.hideWhile ? api.hideWhile(fn) : fn());
  wireBufferButtons(scope, {
    settingKey: BUFFER_SETTING,
    noun: "held group",
    refresh,
    restore: group => place(() => _restoreHeldGroup(group, _readControls(panel))),
  });
}

/**
 * Open the spawn window on the Q tab. GM only — it creates and deletes tokens.
 * Exposed as `game.sta2eToolkit.openQSpawner()`.
 */
export async function openQSpawner() {
  return openSpawnWindow({ tab: TAB_ID });
}
