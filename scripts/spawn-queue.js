/**
 * sta2e-toolkit | spawn-queue.js
 *
 * The drag-actors-in-here queue shared by the spawn window's LCARS tabs.
 *
 * Lifted out of transporter.js when the Q tab arrived wanting exactly the same
 * widget. Everything is scoped to a container element and addressed by class,
 * never by element id — the spawn window keeps every tab mounted at once, so
 * two queues with the same ids would be a live collision.
 *
 * Markup uses the shared `.sw-*` class names from styles/spawn-window.css, so
 * one stylesheet serves every tab that uses this widget.
 *
 * Entry shape (the queue is a plain array the caller owns and mutates in
 * place — the drop wiring and every row's buttons close over that array):
 *   { id, actorId, actor, name, img, isLinked, isWildcard, wildcardPath, quantity }
 */

/** Per-actor copy limit. There is no *total* cap here; tabs impose their own. */
export const MAX_PER_ACTOR = 20;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

// ── Markup ────────────────────────────────────────────────────────────────────

/** The drop zone and its (initially empty) list. */
export function buildQueueHTML({ hint = "⟡ Drag tokens or actors from sidebar ⟡" } = {}) {
  return `
    <div class="sw-drop-zone">
      <div class="sw-drop-hint">${esc(hint)}</div>
      <div class="sw-token-list"></div>
    </div>`;
}

// ── Rows ──────────────────────────────────────────────────────────────────────

function buildQueueItem(entry, queue, container) {
  const item = document.createElement("div");
  item.className = "sw-token-item";
  item.dataset.id = entry.id;

  const img = document.createElement("img");
  img.src = entry.img;
  item.appendChild(img);

  const name = document.createElement("span");
  name.className   = "sw-token-name";
  name.textContent = entry.name;
  item.appendChild(name);

  const badge = document.createElement("span");
  badge.className = `sw-token-badge ${entry.isLinked ? "linked" : "wildcard"}`;
  badge.textContent = entry.isLinked ? "LINKED" : (entry.isWildcard ? "WILD" : "UNLINK");
  item.appendChild(badge);

  // A linked actor has exactly one token by definition, so no quantity control.
  if (!entry.isLinked) {
    const qCtrl = document.createElement("div");
    qCtrl.className = "sw-quantity-ctrl";
    const minus = document.createElement("span");
    minus.className   = "sw-qty-btn";
    minus.textContent = "−";
    const display = document.createElement("span");
    display.className   = "sw-qty-display";
    display.textContent = entry.quantity;
    const plus = document.createElement("span");
    plus.className   = "sw-qty-btn";
    plus.textContent = "+";
    minus.addEventListener("click", () => {
      if (entry.quantity > 1) { entry.quantity--; display.textContent = entry.quantity; }
    });
    plus.addEventListener("click", () => {
      if (entry.quantity < MAX_PER_ACTOR) { entry.quantity++; display.textContent = entry.quantity; }
      else ui.notifications.warn(`Maximum ${MAX_PER_ACTOR} copies per actor.`);
    });
    qCtrl.append(minus, display, plus);
    item.appendChild(qCtrl);
  }

  const remove = document.createElement("span");
  remove.className   = "sw-remove-btn";
  remove.textContent = "✕";
  remove.addEventListener("click", () => {
    const i = queue.findIndex(t => t.id === entry.id);
    if (i >= 0) queue.splice(i, 1);
    item.remove();
  });
  item.appendChild(remove);

  container.appendChild(item);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Redraw the list from the array, dropping anyone whose actor has been deleted
 * since — a queue outlives the window, so a stale entry would blow up mid-spawn.
 *
 * Entries are spliced out in place rather than filtered into a new array,
 * because the drop wiring closes over this exact array.
 */
export function renderQueue(scope, queue) {
  const list = scope?.querySelector(".sw-token-list");
  if (!list) return;

  let dropped = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!game.actors.get(queue[i].actorId)) { queue.splice(i, 1); dropped++; }
  }
  if (dropped) ui.notifications.warn(`Removed ${dropped} deleted actor(s) from the queue.`);

  list.innerHTML = "";
  for (const entry of queue) buildQueueItem(entry, queue, list);
}

/** How many tokens the queue will actually create. */
export function queueTotal(queue) {
  return queue.reduce((sum, e) => sum + (e.isLinked ? 1 : e.quantity), 0);
}

/** Flatten to one entry per token, numbering the copies. */
export function expandQueue(queue) {
  const out = [];
  for (const entry of queue) {
    const count = entry.isLinked ? 1 : entry.quantity;
    for (let i = 0; i < count; i++) {
      out.push({ ...entry, displayName: count > 1 ? `${entry.name} ${i + 1}` : entry.name });
    }
  }
  return out;
}

// ── Drop wiring ───────────────────────────────────────────────────────────────

/** Resolve an Actor from a Foundry drag payload, or null. */
async function actorFromDrop(data) {
  if (data?.type === "Token") {
    return (canvas.tokens.get(data.tokenId) ?? canvas.tokens.get(data.id))?.actor ?? null;
  }
  if (data?.type === "Actor") {
    return (await fromUuid(data.uuid)) ?? game.actors.get(data.id) ?? null;
  }
  return null;
}

export function wireQueue(scope, queue) {
  const dropZone = scope?.querySelector(".sw-drop-zone");
  const list     = scope?.querySelector(".sw-token-list");
  if (!dropZone || !list) return;

  dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", async e => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");

    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }

    const actor = await actorFromDrop(data);
    if (!actor) { ui.notifications.warn("Could not resolve an actor from that drop."); return; }
    if (queue.some(t => t.actorId === actor.id)) {
      ui.notifications.warn(`${actor.name} is already in the queue.`);
      return;
    }

    const proto  = actor.prototypeToken;
    const isWild = proto?.randomImg ?? false;
    const entry = {
      // Random suffix as well as the timestamp: two drops inside the same
      // millisecond would otherwise share an id, and removal is keyed on it.
      id:           `drop_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      actorId:      actor.id,
      actor,
      name:         actor.name,
      img:          proto?.texture?.src ?? proto?.img ?? actor.img ?? "icons/svg/mystery-man.svg",
      isLinked:     proto?.actorLink ?? false,
      isWildcard:   isWild,
      wildcardPath: isWild ? (proto?.texture?.src ?? proto?.img) : null,
      quantity:     1,
    };

    queue.push(entry);
    buildQueueItem(entry, queue, list);
  });
}
