/**
 * sta2e-toolkit | region-logic-doors.js
 *
 * What a door's state change means, for Region Logic's Door Changes trigger.
 * A leaf with no imports (tests/region-logic.mjs).
 *
 * `updateWall` reports only the new `ds`, never the old one, and the client
 * that changed it is often a player's, so the old value cannot ride along in
 * the update options to the GM. Every client therefore keeps the last `ds` it
 * saw for each door (`rememberDoorState`), seeded from every scene on ready —
 * on every client, so a GM who becomes the active GM later already has it.
 */

/** Core's CONST.WALL_DOOR_STATES. */
export const DOOR_STATE = Object.freeze({ CLOSED: 0, OPEN: 1, LOCKED: 2 });

export const DOOR_EVENTS = {
  unlocked: "Unlocked",
  locked:   "Locked",
  opened:   "Opened",
  closed:   "Closed",
  changed:  "Any change",
};

/**
 * The events a change from `prev` to `next` raises. An unknown `prev` (a door
 * never seen before) raises what the new state shows, but never "unlocked":
 * that needs to know the door WAS locked.
 * @returns {string[]}
 */
export function doorEvents(prev, next) {
  if (prev === next || next == null) return [];
  const known = prev !== undefined && prev !== null;
  const out = ["changed"];
  if (next === DOOR_STATE.LOCKED) out.push("locked");
  if (next === DOOR_STATE.OPEN) out.push("opened");
  if (next === DOOR_STATE.CLOSED) out.push("closed");
  if (known && prev === DOOR_STATE.LOCKED) out.push("unlocked");
  return out;
}

const _last = new Map();

/** Record a door's state; returns the one it replaces (undefined if unseen). */
export function rememberDoorState(uuid, ds) {
  const prev = _last.get(uuid);
  if (ds === undefined) _last.delete(uuid);
  else _last.set(uuid, ds);
  return prev;
}

export function forgetDoorStates() {
  _last.clear();
}
