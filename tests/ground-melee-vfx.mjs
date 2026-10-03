// node --experimental-vm-modules tests/ground-melee-vfx.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

let now = 0, serial = 0;
const ticks = new Set(), timers = new Map(), hooks = new Map(), roots = [], packets = [], sounds = [];
class Container {
  constructor() {
    this.children = []; this.position = { set: (x,y) => { this.x=x; this.y=y; } };
    this.scale = { set() {} };
    this.pivot = { set: (x,y) => { this.pivot.x=x; this.pivot.y=y; } };
  }
  addChild(...children) { this.children.push(...children); }
  destroy() { this.destroyed = true; this.children.forEach(c => c.destroy()); }
}
class Graphics extends Container {
  clear() { this.lines = []; return this; }
  beginFill() { return this; }
  drawPolygon(points) { this.shapes ??= []; this.shapes.push(points); return this; }
  endFill() { return this; }
  beginHole() { this.holes = (this.holes ?? 0) + 1; return this; }
  endHole() { return this; }
  lineStyle() { return this; }
  moveTo(x,y) { this.lines ??= []; this.lines.push([x,y]); return this; }
  lineTo(x,y) { this.lines.push([x,y]); return this; }
}
const overrides = {};
const context = vm.createContext({ console, PIXI: { Container, Graphics }, performance: { now: () => now },
  Hooks: { on: (name, cb) => hooks.set(name, cb) },
  canvas: { ready: true, scene: { id: "scene" }, grid: { size: 100 },
    app: { ticker: { add: f => ticks.add(f), remove: f => ticks.delete(f) } } },
  game: { settings: { get: (_, key) => key === "animationOverrides" ? overrides : null },
    socket: { emit: (_, msg) => packets.push(msg) } },
  setTimeout: (fn, ms) => { timers.set(++serial, { fn, at: now + ms }); return serial; },
  clearTimeout: id => timers.delete(id),
});
const native = new vm.SyntheticModule(["nativeVfxContainer", "playNativeVfxSound"], function() {
  this.setExport("nativeVfxContainer", () => { const c = new Container(); roots.push(c); return c; });
  this.setExport("playNativeVfxSound", sound => sounds.push(sound));
}, { context });
const melee = new vm.SourceTextModule(await readFile(new URL("../scripts/ground-melee-vfx.js", import.meta.url), "utf8"), { context });
await melee.link(() => native); await melee.evaluate();
const weapon = new vm.SourceTextModule(await readFile(new URL("../scripts/weapon-configs.js", import.meta.url), "utf8"), { context });
const gooCalls=[];
await weapon.link(async specifier => {
  if (specifier === "./ground-melee-vfx.js") return melee;
  if (specifier === "./ground-goo-vfx.js") return new vm.SyntheticModule(["fireGroundGooVFX"],function(){
    this.setExport("fireGroundGooVFX",(...args)=>{gooCalls.push(args);return true;});
  },{context});
  // Supply import names from the actual consumer, without loading unrelated VFX.
  const consumer = await readFile(new URL("../scripts/weapon-configs.js", import.meta.url), "utf8");
  const block = [...consumer.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].find(m => m[2] === specifier);
  const names = block[1].split(",").map(s => s.trim()).filter(Boolean);
  return new vm.SyntheticModule(names, function() { for (const name of names) this.setExport(name, () => null); }, { context });
});
await weapon.evaluate();
const resolve = name => weapon.namespace.resolveGroundWeaponConfig({ name, system: { range: "melee", hands: 2 } });
for (const name of ["Klingon Bat'leth", "Bat’leth", "Bat-leth", "BATLETH"]) assert.equal(resolve(name).subtype, "batleth");
assert.equal(resolve("Andorian Ushaan-tor").subtype, "ushaan");
assert.equal(resolve("Vulcan Lirpa").subtype, "lirpa");
for (const name of ["Nerve Pinch", "Vulcan Nerve Pinch", "Nerve-Pinch Attack"]) {
  assert.equal(resolve(name).subtype, "nerve-pinch");
}
assert.equal(weapon.namespace.resolveGroundWeaponConfig({name:"Medical Shotgun",system:{range:"ranged"}}).type,"ground-goo");
assert.equal(resolve("Quarterstaff").subtype, "heavy");
overrides.groundWeapons = { melee: { animHit: "custom.webm" } };
assert.equal(resolve("Bat'leth").useClassicMelee, true);
assert.equal(await melee.namespace.fireGroundMeleeVFX(resolve("Bat'leth"), true, {}, []), false);
delete overrides.groundWeapons;

function advance(ms) {
  for (let i=0; i<ms; i+=20) { now+=20; for (const tick of [...ticks]) tick(); }
}
const source = { center: { x:100, y:100 } }, target = { center: { x:100, y:200 } };
for (const subtype of ["batleth", "ushaan"]) {
  const playback = melee.namespace.fireGroundMeleeVFX({ subtype, sound:"hit", missSound:"miss" }, true, source, [target]);
  const root = roots.at(-1), blade = root.children[1];
  assert.ok(blade.shapes[0].length > 20);
  if (subtype === "batleth") assert.equal(blade.holes, 3, "three transparent handholds");
  else assert.equal(blade.holes, 1, "one transparent Ushaan-tor handhold");
  const windupRotation = blade.rotation;
  const hand = { x: blade.x, y: blade.y };
  advance(400);
  assert.ok(blade.y > source.center.y, "cut points toward a target below the attacker");
  assert.ok(root.children[2].lines.length, "hit creates contact sparks");
  if (subtype === "batleth") {
    assert.ok(blade.rotation - windupRotation > 1, "bat'leth rotates during its cut");
    assert.ok(Math.hypot(blade.x-hand.x,blade.y-hand.y)>60,"held end approaches from outside attacker");
    assert.equal(blade.pivot.y, 27, "rotation pivots at the opposite end grip");
    const armX = (26.04 - blade.pivot.x) * .9, armY = (-59.36 - blade.pivot.y) * .9;
    const tipX = blade.x + armX * Math.cos(blade.rotation) - armY * Math.sin(blade.rotation);
    const tipY = blade.y + armX * Math.sin(blade.rotation) + armY * Math.cos(blade.rotation);
    assert.ok(Math.hypot(tipX - target.center.x, tipY - target.center.y) < 15,
      "opposite tip swings into the target around contact");
    const strikeRotation = blade.rotation;
    const strikeHand = {x:blade.x,y:blade.y};
    advance(180);
    assert.ok(blade.rotation > strikeRotation, "rotation continues into follow-through");
    assert.ok(blade.rotation - windupRotation < Math.PI, "swing stays below a half turn");
    assert.deepEqual({ x: blade.x, y: blade.y }, strikeHand, "hand settles at contact for follow-through");
    advance(420);
  } else advance(600);
  assert.equal(await playback, true);
  assert.ok(root.destroyed); assert.equal(ticks.size, 0); assert.equal(timers.size, 0);
}
assert.equal(packets.length, 2); assert.deepEqual(sounds, ["hit", "hit"]);
const miss = melee.namespace.fireGroundMeleeVFX({ subtype:"ushaan", missSound:"miss" }, false, source, [target]);
advance(350); assert.equal(roots.at(-1).children[2].lines.length, 0);
hooks.get("canvasTearDown")(); await miss;
assert.equal(ticks.size, 0); assert.equal(timers.size, 0);
assert.equal(melee.namespace.playGroundMeleeVfxFromSocket({ sceneId:"other", subtype:"batleth" }), false);
assert.equal(melee.namespace.playGroundMeleeVfxFromSocket({ sceneId:"scene", subtype:"sword" }), false);
assert.equal(await melee.namespace.fireGroundMeleeVFX({ subtype:"heavy" }, true, source, [target]), false);
const lirpa = { subtype:"lirpa", name:"Vulcan Lirpa", sound:"hit" };
for (const mode of ["thrust", "swipe", "thrust"]) {
  const playback = melee.namespace.fireGroundMeleeVFX(lirpa, true, source, [target]);
  assert.equal(packets.at(-1).attackMode, mode, "lirpa alternates once per attack");
  const blade = roots.at(-1).children[1], start = {x:blade.x,y:blade.y,rotation:blade.rotation};
  assert.equal(blade.holes, 1, "lirpa blade has its circular opening");
  advance(380);
  const length = (mode === "thrust" ? -85 : 83) * .8;
  const tipX = blade.x + Math.cos(blade.rotation)*length;
  const tipY = blade.y + Math.sin(blade.rotation)*length;
  assert.ok(Math.hypot(tipX-target.center.x, tipY-target.center.y) < 15, "selected end reaches the target");
  const strikeY = blade.y;
  if (mode === "thrust") {
    assert.ok(blade.y > start.y+30, "pointed end thrusts toward target");
    assert.equal(blade.rotation,start.rotation,"thrust keeps its bearing");
  } else {
    assert.deepEqual({x:blade.x,y:blade.y},{x:start.x,y:start.y},"swipe holds shaft pivot steady");
    assert.ok(blade.rotation>start.rotation+.8,"blade end rotates through swipe");
  }
  advance(200);
  if (mode === "thrust") assert.ok(blade.y<strikeY,"thrust retracts after contact");
  advance(420); assert.equal(await playback,true);
  assert.equal(ticks.size,0); assert.equal(timers.size,0);
}
// Receiving the chosen mode keeps another client's next attack in step.
const remote = melee.namespace.playGroundMeleeVfxFromSocket({sceneId:"scene",subtype:"lirpa",attackKey:"100,100:Vulcan Lirpa",
  sourcePoint:source.center,targetPoints:[target.center],grid:100,hit:true,attackMode:"thrust"});
advance(1000); await remote;
const synced = melee.namespace.fireGroundMeleeVFX(lirpa, false, source, [target]);
assert.equal(packets.at(-1).attackMode,"swipe");
advance(1000); await synced;
const batleth = {subtype:"batleth",name:"Klingon Bat'leth",sound:"hit"};
for (const mode of ["swipe", "thrust", "swipe"]) {
  const playback = melee.namespace.fireGroundMeleeVFX(batleth, true, source, [target]);
  assert.equal(packets.at(-1).attackMode, mode, "bat'leth alternates swing and broad-edge thrust");
  const blade = roots.at(-1).children[1], start = {x:blade.x,y:blade.y,rotation:blade.rotation};
  advance(400);
  if (mode === "thrust") {
    assert.equal(blade.pivot.y,0,"thrust holds middle grip");
    assert.equal(blade.rotation,start.rotation,"broad edge stays facing target during thrust");
    assert.ok(Math.abs(blade.rotation-Math.PI/2)<.001,"long blade span lies across target bearing");
    assert.ok(blade.y>start.y+35,"blade pushes straight toward target");
    const edgeX=blade.x+(6.6-blade.pivot.x)*.9*Math.cos(blade.rotation);
    const edgeY=blade.y+(6.6-blade.pivot.x)*.9*Math.sin(blade.rotation);
    assert.ok(Math.hypot(edgeX-target.center.x,edgeY-target.center.y)<3,"middle of long cutting edge reaches target");
    const strikeY=blade.y;
    advance(260); assert.ok(blade.y<strikeY,"bat'leth retracts after thrust");
    advance(340);
  } else {
    assert.equal(blade.pivot.y,27,"existing end-grip swing stays intact");
    assert.ok(Math.hypot(blade.x-start.x,blade.y-start.y)>60,"swing moves inward from flank");
    advance(600);
  }
  assert.equal(await playback,true); assert.equal(ticks.size,0); assert.equal(timers.size,0);
}
// Reference motion: begin outside the attacker, then sweep into a target
// beyond the old reach cap. The same approach rotates with the target bearing.
for (const [dx,dy] of [[250,0],[-250,0],[0,250],[0,-250]]) {
  const end={x:source.center.x+dx,y:source.center.y+dy};
  const playback=melee.namespace.playGroundMeleeVfxFromSocket({sceneId:"scene",subtype:"batleth",attackMode:"swipe",
    sourcePoint:source.center,targetPoints:[end],grid:100,sourceRadius:50,hit:true});
  const blade=roots.at(-1).children[1];
  const worldPoint=(x,y) => {
    x=(x-blade.pivot.x)*.9; y=(y-blade.pivot.y)*.9;
    return {x:blade.x+x*Math.cos(blade.rotation)-y*Math.sin(blade.rotation),
      y:blade.y+x*Math.sin(blade.rotation)+y*Math.cos(blade.rotation)};
  };
  const silhouette=blade.shapes[0];
  for(let i=0;i<silhouette.length;i+=2) {
    const at=worldPoint(silhouette[i],silhouette[i+1]);
    assert.ok(Math.hypot(at.x-source.center.x,at.y-source.center.y)>50,"starting blade is outside attacker token");
  }
  advance(400);
  const tip=worldPoint(26.04,-59.36);
  assert.ok(Math.hypot(tip.x-end.x,tip.y-end.y)<15,"moving swing reaches target from every bearing");
  assert.ok(roots.at(-1).children[0].lines.length>20,"arc trail follows swing");
  advance(600); await playback;
}
const medical=weapon.namespace.resolveGroundWeaponConfig({name:"Medical Shotgun",system:{range:"ranged"}});
for(const useStun of [false,true,null]) {
  await weapon.namespace.fireWeapon(medical,true,source,[target],{useStun});
  assert.equal(gooCalls.at(-1)[4].deadly,useStun===false,"selected attack mode reaches goo renderer");
}
console.log("PASS: weapon detection, overrides, directed swings, hit/miss, broadcast, completion, scene teardown, alternating attacks, bat'leth sweep and goo intent routing");

const pinch = resolve("Vulcan Nerve Pinch");
for (const hit of [true, false]) {
  let finished = false;
  const playback = melee.namespace.fireGroundMeleeVFX(pinch, hit, source, [target])
    .then(result => { finished = true; return result; });
  const root = roots.at(-1), hand = root.children[0], pulse = root.children[1];
  advance(560);
  assert.equal(finished, false, "Nerve Pinch waits for its animation");
  assert.ok(hand.shapes.length > 0, "Nerve Pinch draws a hand");
  assert.equal((pulse.lines?.length ?? 0) > 0, hit, "neural pulse appears only on a hit");
  assert.equal(packets.at(-1).subtype, "nerve-pinch", "Nerve Pinch broadcasts to other clients");
  advance(600);
  assert.equal(await playback, true);
  assert.equal(ticks.size, 0); assert.equal(timers.size, 0);
  assert.equal(root.destroyed, true);
}

const definitions = new vm.SourceTextModule(await readFile(new URL("../scripts/combat/combat-definitions.js", import.meta.url), "utf8"), { context });
await definitions.link(() => { throw new Error("Unexpected import"); }); await definitions.evaluate();
const talents = new vm.SourceTextModule(await readFile(new URL("../scripts/combat/ground-talents.js", import.meta.url), "utf8"), { context });
await talents.link(specifier => {
  if (specifier === "./combat-definitions.js") return definitions;
  if (specifier === "../weapon-configs.js") return weapon;
  return new vm.SyntheticModule(["tokensSharingZone"], function() { this.setExport("tokensSharingZone", () => []); }, { context });
});
await talents.evaluate();
const attackWeapon = { name: "Vulcan Nerve Pinch", system: { range: "melee" } };
const actor = { items: [{ name: "Nerve Pinch (Talent)", type: "talent2e" }] };
assert.equal(talents.namespace.nervePinchDisciplines(actor, attackWeapon).join(","), "security,science,medicine");
assert.equal(talents.namespace.nervePinchDisciplines({ items: [] }, attackWeapon).join(","), "security");
assert.equal(talents.namespace.nervePinchDisciplines(actor, { name: "Unarmed Strike", system: { range: "melee" } }).join(","), "security");
for (const choice of ["security", "science", "medicine", null, "engineering"]) {
  context.foundry = { applications: { api: { DialogV2: { wait: async options => {
    assert.equal(options.buttons.map(button => button.action).join(","), "security,science,medicine");
    return choice;
  } } } } };
  assert.equal(await talents.namespace.chooseNervePinchDiscipline(actor, attackWeapon),
    ["security", "science", "medicine"].includes(choice) ? choice : null);
}
console.log("PASS: Nerve Pinch detection, hand animation, hit/miss, broadcast, cleanup, talent gate and discipline choice");

// Run the roller's actual entry logic; selected discipline becomes its default.
const rollerSource = await readFile(new URL("../scripts/npc-roller.js", import.meta.url), "utf8");
const rollerStart = rollerSource.indexOf("export async function openNpcRoller(");
const rollerEnd = rollerSource.indexOf("  // Read calibrate flags live", rollerStart);
const rollerContext = vm.createContext({
  nervePinchDisciplines: talents.namespace.nervePinchDisciplines,
  chooseNervePinchDiscipline: talents.namespace.chooseNervePinchDiscipline,
});
const open = vm.runInContext(`${rollerSource.slice(rollerStart, rollerEnd).replace("export ", "")} return defaultDisc; }; openNpcRoller`, rollerContext);
actor.items.push({ ...attackWeapon, id: "pinch", type: "characterweapon2e" });
let prompts = 0;
context.foundry.applications.api.DialogV2.wait = async () => { prompts++; return "medicine"; };
const options = { groundMode: true, weaponContext: { weaponId: "pinch", name: attackWeapon.name }, defaultDisc: "security" };
assert.equal(await open(actor, {}, options), "medicine");
assert.equal(await open(actor, {}, { ...options, opposedTaskRef: { side: "attacker" } }), "medicine");
assert.equal(await open(actor, {}, { ...options, opposedTaskRef: { side: "defender" } }), "security");
assert.equal(await open(actor, {}, { ...options, isAssistRoll: true }), "security");
assert.equal(prompts, 2, "only attacking rolls offer the talent choice");
context.foundry.applications.api.DialogV2.wait = async () => null;
assert.equal(await open(actor, {}, options), undefined, "closing discipline selection cancels opening the roller");
console.log("PASS: normal/opposed attack roller uses selected discipline; assists and defenders are excluded");
