/**
 * sta2e-toolkit | door-light-plan.js
 *
 * What a Door & Light Control behavior writes when it switches state. A leaf
 * with no imports, so tests/door-light-control.mjs can load it under node.
 *
 * Input targets are plain snapshots, not documents:
 *   door   {uuid, kind: "door",  isDoor, ds}
 *   light  {uuid, kind: "light", hidden, color, alpha, animation}
 *   sound  {uuid, kind: "sound", hidden}
 *
 * A state is {door, light, sound, color, alpha, animation}; "" / null in any
 * slot means "leave it". Light look fields (colour, intensity, animation) are
 * the one place the two states are not symmetric: switching ON saves what each
 * light looked like before the first change, and switching OFF with a look
 * slot left blank puts the saved value back. So red alert lighting needs to be
 * set only on the ON side.
 */

export const DOOR_STATES = Object.freeze({ closed: 0, open: 1, locked: 2 });
const LOOK_KEYS = ["color", "alpha", "animation"];

const _set = v => v !== null && v !== undefined && v !== "";

/** The "none" animation choice means no animation, which core stores as null. */
function _lookValue(key, v) {
  return key === "animation" && v === "none" ? null : v;
}

/**
 * @param {object} args
 * @param {object[]} args.targets
 * @param {object} args.state         The state being switched to.
 * @param {boolean} args.activating
 * @param {Record<string, object>} [args.saved]  Looks saved by an earlier ON.
 * @returns {{updates: {uuid: string, kind: string, changes: object}[], saved: Record<string, object>}}
 */
export function planDoorLight({ targets = [], state = {}, activating, saved = {} }) {
  const nextSaved = { ...saved };
  const updates = [];

  for (const t of targets) {
    const changes = {};

    if (t.kind === "door") {
      const ds = DOOR_STATES[state.door];
      if (t.isDoor && ds !== undefined && t.ds !== ds) changes.ds = ds;
    }

    if (t.kind === "light" || t.kind === "sound") {
      const want = t.kind === "light" ? state.light : state.sound;
      if (want === "on" && t.hidden) changes.hidden = false;
      if (want === "off" && !t.hidden) changes.hidden = true;
    }

    if (t.kind === "light") {
      if (activating) {
        const keys = LOOK_KEYS.filter(k => _set(state[k]));
        if (keys.length && !nextSaved[t.uuid]) {
          nextSaved[t.uuid] = Object.fromEntries(LOOK_KEYS.map(k => [k, t[k] ?? null]));
        }
        for (const k of keys) {
          const v = _lookValue(k, state[k]);
          if (t[k] !== v) changes[k] = v;
        }
      } else {
        const back = nextSaved[t.uuid];
        for (const k of LOOK_KEYS) {
          let v;
          if (_set(state[k])) v = _lookValue(k, state[k]);
          else if (back && k in back) v = back[k];
          else continue;
          if ((t[k] ?? null) !== v) changes[k] = v;
        }
        delete nextSaved[t.uuid];
      }
    }

    if (Object.keys(changes).length) updates.push({ uuid: t.uuid, kind: t.kind, changes });
  }

  return { updates, saved: nextSaved };
}

/** A stored Sequence Group number as a whole number ≥ 1; blank or junk is null. */
export function normalizeGroup(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Split a switch's updates into the groups a sequence steps through.
 *
 * Groups are cut from the TARGET list, per kind, before anything is skipped:
 * with two per step, lights 1+2 are one group and 3+4 the next, even when
 * light 2 is already on — otherwise one light already in the right state would
 * shift every pair after it. A group with nothing to change is dropped, so it
 * costs no pause. Groups come back in list order (doors, lights, sounds).
 *
 * With `byTag`, groups are the GM's own Sequence Group numbers instead (the
 * `group` on each target): everything sharing a number changes together —
 * doors, lights and sounds alike — in ascending number order, and anything
 * without one takes a step of its own after the numbered groups.
 * @param {{uuid: string}[]} updates
 * @param {{uuid: string, kind: string, group?: number|null}[]} targets
 * @param {{perStep?: number, byTag?: boolean}} [options]
 * @returns {object[][]}
 */
export function groupUpdates(updates, targets, { perStep = 1, byTag = false } = {}) {
  const groupOf = new Map();
  if (byTag) {
    const numbered = [];
    let loose = 0;
    for (const t of targets) {
      const n = normalizeGroup(t.group);
      if (n === null) groupOf.set(t.uuid, `loose:${loose++}`);
      else { groupOf.set(t.uuid, `tag:${n}`); numbered.push(n); }
    }
    // Map insertion order is step order: numbered groups ascending, then loose.
    const keys = [...new Set(numbered)].sort((a, b) => a - b).map(n => `tag:${n}`);
    for (let i = 0; i < loose; i++) keys.push(`loose:${i}`);
    const groups = new Map(keys.map(k => [k, []]));
    for (const u of updates) groups.get(groupOf.get(u.uuid) ?? keys[0])?.push(u);
    return [...groups.values()].filter(g => g.length);
  }

  const size = Math.max(1, Math.floor(Number(perStep)) || 1);
  const seen = {};
  for (const t of targets) {
    const i = seen[t.kind] = (seen[t.kind] ?? -1) + 1;
    groupOf.set(t.uuid, `${t.kind}:${Math.floor(i / size)}`);
  }
  const groups = new Map();
  for (const u of updates) {
    const key = groupOf.get(u.uuid) ?? `?:${u.uuid}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  return [...groups.values()];
}

/**
 * The order a sequenced switch applies its updates (or groups) in.
 *   forward     list order, both ways
 *   reverseOff  list order switching on, reversed switching off — lights come
 *               up along a corridor and go out back towards the start
 *   random      shuffled each time
 * @param {object[]} updates
 * @param {"forward"|"reverseOff"|"random"} order
 * @param {boolean} activating
 * @param {() => number} [random]
 */
export function orderUpdates(updates, order, activating, random = Math.random) {
  const out = [...updates];
  if (order === "reverseOff" && !activating) out.reverse();
  if (order === "random") {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}
