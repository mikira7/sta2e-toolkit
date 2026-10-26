/**
 * sta2e-toolkit | region-logic-convert.js
 *
 * The Region Logic graph that does what an existing Door & Light Control or
 * Random Teleport behavior does. A leaf with no imports (tests/region-logic.mjs).
 * Takes the behavior's system data as plain JSON with its UUIDs already made
 * absolute; the caller copies the switch state across.
 *
 * One deliberate difference: Once Per Token marks the token as it passes, and
 * the cooldown comes after it. The classic behaviors mark only once the
 * cooldown has also passed, so a fresh token entering during a cooldown is used
 * up here and was not there. The two are rarely combined.
 */

/** Columns for the editor, left to right. */
const COL = [40, 300, 560, 820, 1080];
const ROW = 140;

function _chain(nodes, wires, ids) {
  for (let i = 0; i < ids.length - 1; i++) {
    const from = nodes.find(n => n.id === ids[i]);
    wires.push({ from: ids[i], out: from.port ?? "out", to: ids[i + 1], in: "in" });
  }
}

/** Trigger → Once Per Token? → Cooldown? → target, appended to nodes / wires. */
function _gated(nodes, wires, { row, trigger, oncePerToken, cooldown, who }) {
  nodes.push({ id: trigger.id, type: trigger.type, x: COL[0], y: row * ROW, config: trigger.config });
  const ids = [trigger.id];
  let col = 1;
  if (oncePerToken) {
    nodes.push({ id: "once", type: "oncePerToken", x: COL[col++], y: row * ROW, config: {}, port: "first" });
    ids.push("once");
  }
  if (cooldown > 0) {
    nodes.push({ id: "cooldown", type: "cooldown", x: COL[col++], y: row * ROW,
      config: { seconds: cooldown, who }, port: "ready" });
    ids.push("cooldown");
  }
  return { ids, col };
}

function _strip(nodes) {
  for (const n of nodes) delete n.port;
  return nodes;
}

/** @param {object} sys  Door & Light Control system data. */
export function graphFromDoorLight(sys = {}) {
  const nodes = [];
  const wires = [];
  const who = sys.triggerBy ?? "visible";
  const trigger = sys.trigger ?? "presence";

  const switchNode = {
    id: "switch", type: "switch", x: COL[3], y: ROW,
    config: {
      doors: [...(sys.doors ?? [])], lights: [...(sys.lights ?? [])], sounds: [...(sys.sounds ?? [])],
      sequence: { ...(sys.sequence ?? {}) }, on: { ...(sys.on ?? {}) }, off: { ...(sys.off ?? {}) },
    },
  };

  if (trigger !== "manual") {
    const { ids } = _gated(nodes, wires, {
      row: 0, oncePerToken: !!sys.oncePerToken, cooldown: Number(sys.cooldown) || 0, who,
      trigger: { id: "enter", type: "tokenEnter", config: { who, waitSeen: true, ignoreDisplace: false } },
    });
    _chain(nodes, wires, ids);
    wires.push({ from: ids.at(-1), out: nodes.find(n => n.id === ids.at(-1)).port ?? "out",
      to: "switch", in: trigger === "toggle" ? "toggle" : "on" });
  }

  if (trigger === "presence" && sys.onLeave !== "keep") {
    nodes.push({ id: "exit", type: "tokenExit", x: COL[0], y: 2 * ROW, config: { who, waitSeen: true } });
    nodes.push({ id: "empty", type: "regionEmpty", x: COL[1], y: 2 * ROW, config: { who } });
    wires.push({ from: "exit", out: "out", to: "empty", in: "in" });
    wires.push({ from: "empty", out: "yes", to: "switch", in: "off" });
  }

  // The classic sheet's Switch On / Switch Off keys worked in every mode.
  nodes.push({ id: "manualOn", type: "manual", x: COL[0], y: 3 * ROW, config: { label: "Switch On" } });
  nodes.push({ id: "manualOff", type: "manual", x: COL[0], y: 4 * ROW, config: { label: "Switch Off" } });
  wires.push({ from: "manualOn", out: "out", to: "switch", in: "on" });
  wires.push({ from: "manualOff", out: "out", to: "switch", in: "off" });

  nodes.push(switchNode);
  return { version: 1, nodes: _strip(nodes), wires };
}

/** @param {object} sys  Random Teleport system data. */
export function graphFromRandomTeleport(sys = {}) {
  const nodes = [];
  const wires = [];
  // Random Teleport fires for any token, hidden ones included, and never on a
  // displacement; its cooldown is held open only by visible tokens.
  const { ids, col } = _gated(nodes, wires, {
    row: 0, oncePerToken: !!sys.oncePerToken, cooldown: Number(sys.cooldown) || 0, who: "visible",
    trigger: { id: "enter", type: "tokenEnter", config: { who: "any", waitSeen: false, ignoreDisplace: true } },
  });
  nodes.push({
    id: "teleport", type: "teleport", x: COL[col], y: 0,
    config: {
      destinations: [...(sys.destinations ?? [])],
      placement: sys.placement ?? "random", snap: sys.snap ?? true,
      avoidOccupied: sys.avoidOccupied ?? true, noRepeat: sys.noRepeat ?? true,
      delay: Number(sys.delay) || 0,
      departSound: sys.departSound ?? "", arriveSound: sys.arriveSound ?? "",
      soundVolume: sys.soundVolume ?? 0.8, soundAudience: sys.soundAudience ?? "all",
      transition: { type: sys.transition?.type ?? null, duration: sys.transition?.duration ?? 1500 },
    },
  });
  ids.push("teleport");
  _chain(nodes, wires, ids);
  return { version: 1, nodes: _strip(nodes), wires };
}
