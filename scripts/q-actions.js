/**
 * sta2e-toolkit | q-actions.js
 *
 * The Q actions that operate on tokens already on the canvas: taking them out of
 * the scene, moving them somewhere else, and throwing them across it.
 *
 * They live here rather than in q-spawner.js because they have two callers with
 * nothing else in common — the Q tab's footer buttons and the Token HUD control
 * (q-hud.js) — and the HUD has no business importing a whole spawn-window tab
 * to reach them. Bringing tokens *in* stays in the tab: it needs the queue.
 *
 * All GM-only. They create, delete and move documents directly rather than over
 * the socket, the same as the rest of the spawn window.
 */

import { addBufferGroup, makeBufferGroup } from "./spawn-buffer.js";
import {
  awaitCanvasClick,
  crosshair,
  cursorPoint,
  drawFixedPoints,
  pickHeading,
  setCrosshairCursor,
  showOverlay,
  stroked,
} from "./spawn-picker.js";
import { Q_COLOR, playQSceneFlash, qFlashKick, qFlashMove, qSnapOut } from "./q-vfx.js";

/**
 * Whoever Q has taken out of the scene. World-scoped, and deliberately separate
 * from the transporter's pattern buffer: restoring one must never disturb the
 * other.
 */
export const Q_BUFFER_SETTING = "qHoldBuffer";

/**
 * Which tokens a Q action should act on, given the one whose HUD was opened.
 *
 * A GM who has selected four tokens and right-clicked one of them means all
 * four; a GM who right-clicked something they had not selected means that one.
 * Passing no token at all — the spawn window's buttons — just means the
 * selection.
 *
 * @param {Token} [token]  The token whose HUD this came from, if any
 * @returns {Token[]}
 */
export function resolveQTargets(token = null) {
  const controlled = [...(canvas.tokens?.controlled ?? [])];
  if (!token) return controlled;
  return controlled.includes(token) ? controlled : [token];
}

/** A ring that reads well for this token's footprint. */
function _tokenRadius(token) {
  const grid  = canvas.grid?.size ?? 100;
  const halfW = ((token.document.width  ?? 1) * grid) / 2;
  const halfH = ((token.document.height ?? 1) * grid) / 2;
  return Math.max(Math.max(halfW, halfH) * 0.9, 25);
}

// ── Snap out ──────────────────────────────────────────────────────────────────

/**
 * Take tokens out of the scene, holding them so Q can change his mind.
 *
 * No cap — the transporter's six is a Starfleet regulation, not a law of
 * physics, and Q is bound by neither. The buffer snapshot is written *before*
 * anything is deleted, so a failure part-way through cannot lose anyone.
 *
 * @param {Token[]} tokens
 * @returns {Promise<boolean>} true when the scene actually changed
 */
export async function qSnapOutTokens(tokens) {
  const list = (tokens ?? []).filter(Boolean);
  if (!list.length) {
    ui.notifications.warn("Select the tokens Q should remove.");
    return false;
  }

  const entries = list.filter(t => t.actor).map(t => ({
    actorId:      t.actor.id,
    name:         t.document.name ?? t.actor.name,
    img:          t.document.texture?.src ?? t.actor.img,
    resolvedImg:  t.document.texture?.src ?? t.actor.img,
    wildcardPath: t.actor.prototypeToken?.texture?.src ?? t.actor.prototypeToken?.img,
    isLinked:     t.document.actorLink,
    isWildcard:   t.actor.prototypeToken?.randomImg ?? false,
    quantity:     1,
  }));

  if (!entries.length) {
    ui.notifications.warn("None of those tokens have an actor to hold.");
    return false;
  }

  const label = entries.length === 1 ? entries[0].name : `${entries.length} REMOVED`;
  const group = makeBufferGroup(label, entries);
  await addBufferGroup(Q_BUFFER_SETTING, group);

  playQSceneFlash();
  await Promise.allSettled(list.map(qSnapOut));

  // Deleted in one call rather than per token, so the scene sees a single
  // update — and only after every snapshot is safely in the buffer.
  try {
    await canvas.scene.deleteEmbeddedDocuments("Token", list.map(t => t.id));
  } catch (err) {
    console.error("STA2e Toolkit | Q snap-out delete failed:", err);
    ui.notifications.error("Q could not remove those tokens — see console.");
    return false;
  }

  ui.notifications.info(`Q removed ${entries.length} token${entries.length === 1 ? "" : "s"} — held as "${group.label}".`);
  return true;
}

// ── Flash move ────────────────────────────────────────────────────────────────

/**
 * Move tokens somewhere else, keeping the group's shape.
 *
 * The preview draws every token's ring at its offset from the group's centre,
 * so what sits under the cursor is the arrangement that lands. One click
 * resolves a single offset applied to all of them.
 *
 * @param {Token[]} tokens
 * @param {object} [opts]
 * @param {(fn: () => Promise<any>) => Promise<any>} [opts.hideWhile]
 *   Wrapper that gets the caller's window out of the way during the pick.
 * @returns {Promise<boolean>} true when anything actually moved
 */
export async function qFlashMoveTokens(tokens, { hideWhile } = {}) {
  const list = (tokens ?? []).filter(Boolean);
  if (!list.length) {
    ui.notifications.warn("Select the tokens Q should move first.");
    return false;
  }

  const centres = list.map(t => t.center ?? { x: t.x, y: t.y });
  const origin = {
    x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
    y: centres.reduce((s, c) => s + c.y, 0) / centres.length,
  };
  const offsets = centres.map(c => ({ x: c.x - origin.x, y: c.y - origin.y }));
  const radii   = list.map(_tokenRadius);

  const run = async () => {
    const overlay = showOverlay(
      `Q FLASH · ${list.length} token${list.length === 1 ? "" : "s"}`,
      "Click where Q should put them · [RMB/Esc] abort"
    );
    setCrosshairCursor(true);
    let point;
    try {
      point = await awaitCanvasClick({
        onMove: g => {
          const p = cursorPoint();
          drawFixedPoints(g, offsets.map(o => ({ x: p.x + o.x, y: p.y + o.y })), radii, Q_COLOR);
          stroked(g, { width: 1, color: Q_COLOR, alpha: 0.5 }, gg => crosshair(gg, p.x, p.y));
        },
      });
    } finally {
      overlay.remove();
      setCrosshairCursor(false);
    }
    if (!point) { ui.notifications.warn("Q lost interest."); return false; }

    const delta = { x: point.x - origin.x, y: point.y - origin.y };
    const moved = await qFlashMove(list, delta);
    if (moved) ui.notifications.info(`Q moved ${moved} token${moved === 1 ? "" : "s"}.`);
    return moved > 0;
  };

  return hideWhile ? hideWhile(run) : run();
}

// ── Flash kick ────────────────────────────────────────────────────────────────

/** Centre of a group of tokens, for aiming. */
function _groupCentre(tokens) {
  const centres = tokens.map(t => t.center ?? { x: t.x, y: t.y });
  return {
    x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
    y: centres.reduce((s, c) => s + c.y, 0) / centres.length,
  };
}

/**
 * Q boots tokens across the scene — the flash goes off behind them and they
 * tumble away, coming to rest a long way off in that direction.
 *
 * Aiming has two modes. A targeted token wins outright: point at the Borg cube
 * and go, no prompt. Otherwise the drag-to-aim arrow appears, the same picker
 * the ship spawner uses for fleet facing, previewing the group as it swings.
 *
 * @param {Token[]} tokens
 * @param {object} [opts]
 * @param {(fn: () => Promise<any>) => Promise<any>} [opts.hideWhile]
 * @returns {Promise<boolean>} true when anything actually flew
 */
export async function qFlashKickTokens(tokens, { hideWhile } = {}) {
  const list = (tokens ?? []).filter(Boolean);
  if (!list.length) {
    ui.notifications.warn("Select the tokens Q should throw.");
    return false;
  }

  const origin  = _groupCentre(list);
  const offsets = list.map(t => {
    const c = t.center ?? { x: t.x, y: t.y };
    return { x: c.x - origin.x, y: c.y - origin.y };
  });
  const radii = list.map(_tokenRadius);

  // A target the GM has already set is a heading they have already chosen.
  const target = [...(game.user.targets ?? [])].find(t => !list.includes(t));
  const targetPoint = target ? (target.center ?? { x: target.x, y: target.y }) : null;

  const run = async () => {
    let heading;
    if (targetPoint) {
      heading = Math.atan2(targetPoint.y - origin.y, targetPoint.x - origin.x);
      ui.notifications.info(`Q throws them at ${target.name}.`);
    } else {
      heading = await pickHeading(
        origin,
        (g, h) => {
          drawFixedPoints(g, offsets.map(o => ({ x: origin.x + o.x, y: origin.y + o.y })), radii, Q_COLOR);
          // The arrow the picker draws starts at the origin; this second one
          // marks where the flash will land — behind them, opposite the throw.
          stroked(g, { width: 1, color: Q_COLOR, alpha: 0.45 }, gg =>
            crosshair(gg, origin.x - Math.cos(h) * 40, origin.y - Math.sin(h) * 40, 10));
        },
        { color: Q_COLOR }
      );
      if (heading === null) { ui.notifications.warn("Q lost interest."); return false; }
    }

    const kicked = await qFlashKick(list, heading);
    if (kicked) ui.notifications.info(`Q threw ${kicked} token${kicked === 1 ? "" : "s"} across the sector.`);
    return kicked > 0;
  };

  return hideWhile ? hideWhile(run) : run();
}
