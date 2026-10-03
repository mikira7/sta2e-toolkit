// node --experimental-vm-modules tests/scene-effects.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const animations = [], emitted = [], hooks = new Map();
const sounds=[];
const surface = {
  style: { transform: "scale(1.1)", translate: "3px 4px" },
  animate(frames, options) {
    const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  },
};
const game = {
  user: { id: "gm", isGM: true },
  users: new Map([["gm", { isGM: true }], ["player", { isGM: false }]]),
  socket: { emit: (channel, message) => emitted.push({ channel, message }) },
  settings:{get:(_module,key)=>key==="sceneEffectSoundVolume"?70:`${key}.ogg`},
};
const canvas = { ready: true, scene: { id: "bridge" }, app: { canvas: surface } };
let id = 0;
const context = vm.createContext({ game, canvas, Math, console,
  AudioHelper:{play(options,broadcast){const sound={options,broadcast,stops:0,stop(){this.stops++;}};sounds.push(sound);return sound;}},
  crypto: { randomUUID: () => `id-${++id}` },
  Hooks: { on: (name, fn) => hooks.set(name, fn) } });
const module = new vm.SourceTextModule(await readFile(new URL("../scripts/scene-effects.js", import.meta.url), "utf8"), { context });
await module.link(async()=>new vm.SourceTextModule(await readFile(new URL("../scripts/scene-effect-audio.js",import.meta.url),"utf8"),{context}));
await module.evaluate();
const api = module.namespace;
const remote = { action: api.SCENE_SHAKE_ACTION, sceneId: "bridge", userId: "gm", id: "remote", seed: 42 };

assert.equal(api.handleSceneEffectSocket({ ...remote, sceneId: "other" }), false);
assert.equal(api.handleSceneEffectSocket({ ...remote, userId: "player" }), false);
assert.equal(api.handleSceneEffectSocket({ ...remote, userId: "unknown" }), false);
assert.equal(animations.length, 0);
assert.equal(api.broadcastCanvasShake(api.SHAKE_PRESETS.impact), true);
assert.equal(emitted.length, 1);
assert.equal(animations.length, 1, "sender plays locally exactly once");
assert.equal(sounds.length,1);assert.equal(sounds[0].options.src,"sndSceneImpact.ogg");assert.equal(sounds[0].broadcast,false);
assert.equal(api.handleSceneEffectSocket(emitted[0].message), false, "duplicate broadcasts ignored");
const first = animations[0];
assert.equal(first.options.composite, "add");
assert.equal(api.previewCanvasShake(api.SHAKE_PRESETS.earthquake), true);
assert.equal(emitted.length, 1, "preview never broadcasts");
assert.equal(sounds[1].options.src,"sndSceneEarthquake.ogg");
assert.equal(first.cancelled, true, "new shake cancels previous shake");
const preview = animations.at(-1);
first.onfinish();
assert.equal(preview.cancelled, false, "a stale completion cannot cancel the replacement");
preview.onfinish();
assert.equal(preview.cancelled, true, "completion releases animation");
assert.equal(surface.style.transform, "scale(1.1)");
assert.equal(surface.style.translate, "3px 4px", "underlying canvas styles untouched");

game.user = { id: "player", isGM: false };
assert.equal(api.broadcastCanvasShake(), false);
await new Promise(resolve=>setImmediate(resolve));
assert.ok(sounds.every(sound=>sound.stops===1),"completion, replacement and scene teardown stop every shake sound once");
assert.equal(api.broadcastStopCanvasShake(), false);
assert.equal(api.previewCanvasShake(), false);
assert.equal(api.handleSceneEffectSocket(remote), true, "players receive GM shake");
assert.equal(api.handleSceneEffectSocket({ action: api.SCENE_SHAKE_STOP_ACTION, sceneId: "other", userId: "gm" }), false);
assert.equal(animations.at(-1).cancelled, false, "another scene's stop ignored");
assert.equal(api.handleSceneEffectSocket({ action: api.SCENE_SHAKE_STOP_ACTION, sceneId: "bridge", userId: "gm" }), true);
assert.equal(animations.at(-1).cancelled, true);

game.user = { id: "gm", isGM: true };
api.broadcastCanvasShake();
api.broadcastStopCanvasShake();
assert.equal(emitted.at(-1).message.action, api.SCENE_SHAKE_STOP_ACTION);
assert.equal(animations.at(-1).cancelled, true);
api.registerSceneEffectHooks();
api.previewCanvasShake();
hooks.get("canvasTearDown")();
assert.equal(animations.at(-1).cancelled, true, "scene teardown cancels shake");
canvas.ready = false;
assert.equal(api.broadcastCanvasShake(), false);

const cfg = api.normalizeShake({ duration: Infinity, strength: 1000, frequency: -10 });
assert.equal(cfg.duration, 1.5);
assert.equal(cfg.strength, 40);
assert.equal(cfg.frequency, 4);
assert.ok(api.shakeKeyframes({ duration: 0.2, frequency: 4 }, 42).some(frame => frame.translate !== "0px 0px"),
  "short low-frequency shakes still have motion");
for (const preset of Object.values(api.SHAKE_PRESETS)) {
  const frames = api.shakeKeyframes(preset, 42);
  assert.equal(JSON.stringify(frames), JSON.stringify(api.shakeKeyframes(preset, 42)));
  assert.equal(frames[0].translate, "0px 0px");
  assert.equal(frames.at(-1).translate, "0px 0px");
  for (const frame of frames) {
    for (const value of frame.translate.split(" ")) assert.ok(Math.abs(parseFloat(value)) <= preset.strength);
  }
}
console.log("Scene effects checks passed: broadcast, scene filtering, permissions, preview, replacement, completion, stop, teardown, bounded deterministic motion.");
