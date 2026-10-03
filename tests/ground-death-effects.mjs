// node tests/ground-death-effects.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Exercise the real injury resolution method without loading the HUD's UI dependencies.
const source = await readFile(new URL("../scripts/combat/combat-hud-core.js", import.meta.url), "utf8");
const start = source.indexOf("  static async _executeInjuryResolution(");
const end = source.indexOf("  static async _markInjuryCardResolved(", start);
assert.ok(start >= 0 && end > start);

async function resolve({ automatic, weaponType, weaponColor, choice = "dead" }) {
  const conditions = new Set(), effects = new Set(), events = [];
  const actor = { name: "Minor NPC", system: { stress: { value: 0, max: 0 } },
    createEmbeddedDocuments: async () => {} };
  const token = { actor, document: {} };
  const context = vm.createContext({
    console,
    canvas: { tokens: { get: () => token } },
    game: { user: { isGM: true }, settings: { get: (_, key) =>
      key === "autoVaporizeMinorNpc" ? automatic : "countdown" } },
    ChatMessage: { create: () => {} },
    LC: {}, lcarsCard: () => "", traitDamageCreditHtml: () => "",
    addCondition: async (_, key) => { conditions.add(key); events.push(`condition:${key}`); },
    removeCondition: async (_, key) => conditions.delete(key),
    foundry: { applications: { api: { DialogV2: { wait: async () => {
      events.push("dialog"); return choice;
    } } } } },
  });
  const HUD = vm.runInContext(`class CombatHUD {${source.slice(start, end)}}; CombatHUD`, context);
  HUD.getGroundCombatProfile = () => ({ npcType: "minor", isPlayerOwned: false });
  HUD._removeDyingSplashFX = async () => effects.delete("dying");
  HUD._applyDeathSplashFX = () => { effects.add("dead"); events.push("death-effect"); };
  HUD._removeDeathSplashFX = async () => { effects.delete("dead"); events.push("clear-death"); };
  let finishAnimation, animationStarted;
  const started = new Promise(resolve => { animationStarted = resolve; });
  HUD._playGroundAttackAnimation = async () => {
    events.push("attack");
    animationStarted();
    await new Promise(resolve => { finishAnimation = resolve; });
    events.push("attack-finished");
  };
  HUD._vaporizeToken = async () => events.push("vaporize");
  HUD._markInjuryCardResolved = async () => events.push("resolved");
  const resolution = HUD._executeInjuryResolution("take", { tokenId: "target", injuryName: "Deadly injury",
    useStun: false, potency: 1, severity: 1, npcType: "minor", isPlayerOwned: false,
    weaponType, weaponColor }, null);
  await started;
  assert.equal(conditions.size, 0, "token conditions must wait for animation completion");
  assert.equal(effects.size, 0, "death effect must wait for animation completion");
  finishAnimation();
  await resolution;
  assert.ok(conditions.has("dead"));
  assert.ok(events.indexOf("attack-finished") < events.indexOf("condition:dead"));
  assert.equal(events.filter(e => e === "attack").length, 1);
  assert.equal(events.at(-1), "resolved");
  return { effects, events };
}

for (const weaponType of ["melee", "projectile", "ground-beam"]) {
  const { effects, events } = await resolve({ automatic: true, weaponType, weaponColor: "blue" });
  assert.ok(effects.has("dead"), `${weaponType}: ordinary death must retain its effect`);
  assert.ok(!events.includes("clear-death"));
  assert.ok(!events.includes("vaporize"));
}
for (const choice of ["dead", "keep", "vaporized"]) {
  const { effects, events } = await resolve({ automatic: false, weaponType: "ground-beam", weaponColor: "orange", choice });
  assert.equal(effects.has("dead"), choice !== "vaporized");
  assert.equal(events.includes("vaporize"), choice === "vaporized");
}
const { effects, events } = await resolve({ automatic: true, weaponType: "ground-beam", weaponColor: "orange" });
assert.equal(effects.size, 0);
assert.ok(!events.includes("death-effect"), "automatic vaporization must skip the blood pool");
assert.ok(events.indexOf("attack") < events.indexOf("vaporize"));
assert.ok(events.indexOf("clear-death") < events.indexOf("vaporize"));
console.log("PASS: ordinary death effects persist; manual and automatic vaporization still resolve correctly");

// Classic Sequencer renderers must keep their promises pending for every target.
const weaponSource = await readFile(new URL("../scripts/weapon-configs.js", import.meta.url), "utf8");
for (const name of ["fireGroundBeam", "fireMelee", "fireGrenade", "fireHypospray",
  "fireGroundPhaserBolt", "fireGroundPhaserBoltJb2a"]) {
  const start = weaponSource.indexOf(`async function ${name}(`);
  const end = weaponSource.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start);
  const pending = [];
  const seq = () => {
    const chain = new Proxy({}, { get: (_, key) => key === "play"
      ? () => new Promise(resolve => pending.push(resolve))
      : () => chain });
    return chain;
  };
  const context = vm.createContext({ seq, withSound: s => s,
    getTimingBeamTravel: () => 100, getTimingGroundBeamTravel: () => 100,
    normalizePhaserEra: x => x, groundPhaserBoltJb2aEffect: () => "bolt",
    shipTravelEffect: s => s, atSequenceLocation: s => s, stretchToSequenceLocation: s => s,
    sequenceLocation: x => x, applyBoltTravel: () => 100 });
  const fire = vm.runInContext(`${weaponSource.slice(start, end)}; ${name}`, context);
  let finished = false;
  const shot = fire({ color: "orange", effect: "strike", impact: "impact" }, true, {}, [{}, {}])
    .then(() => { finished = true; });
  assert.equal(pending.length, 2, `${name}: all targets start together`);
  pending[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false, `${name}: must wait for the final target`);
  pending[1]();
  await shot;
  assert.equal(finished, true);
}
console.log("PASS: death waits for playback; all six classic ground renderers await every target");
