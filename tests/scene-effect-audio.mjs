// node --experimental-vm-modules tests/scene-effect-audio.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const definitions=new Map(), values=new Map(), changes=[], plays=[], warnings=[];
const game={settings:{register(module,key,definition){assert.equal(module,"sta2e-toolkit");definitions.set(key,definition);values.set(key,definition.default);},
  get:(_module,key)=>values.get(key)}};
const helper={play(options,broadcast){let resolve;const promise=new Promise(r=>resolve=r);
  const record={options,broadcast,resolve,stops:0};record.sound={stop(){record.stops++;}};plays.push(record);return promise;}};
const context=vm.createContext({game,foundry:{audio:{AudioHelper:helper}},Hooks:{callAll:name=>changes.push(name)},
  console:{warn:(...args)=>warnings.push(args)}});
const mod=new vm.SourceTextModule(await readFile(new URL("../scripts/scene-effect-audio.js",import.meta.url),"utf8"),{context});
await mod.link(()=>{});await mod.evaluate();const api=mod.namespace;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
api.registerSceneEffectAudioSettings();assert.equal(definitions.size,7);
for(const row of api.SCENE_EFFECT_SOUNDS){assert.equal(definitions.get(row.key).filePicker,"audio");assert.equal(definitions.get(row.key).scope,"world");}
assert.equal(api.playSceneEffectSound("electric"),null,"blank files are silent");
values.set("sndSceneElectric"," sparks.ogg ");
values.set(api.SCENE_EFFECT_VARIANTS,{electric:[" sparks.ogg ","zap.ogg","crackle.ogg","",42,"zap.ogg"]});
assert.deepEqual(Array.from(api.getSceneSoundVariants().electric),["sparks.ogg","zap.ogg","crackle.ogg"]);
const selected=new Set();
for(let seed=0;seed<100;seed++) {
  const path=api.chooseSceneEffectSound("electric",seed);selected.add(path);
  assert.equal(api.chooseSceneEffectSound("electric",seed),path,"shared seeds select identical files");
}
assert.deepEqual([...selected].sort(),["crackle.ogg","sparks.ogg","zap.ogg"]);
assert.equal(api.chooseSceneEffectSound("unknown",1),"");
values.set("sndSceneElectric","");
assert.ok(["sparks.ogg","zap.ogg","crackle.ogg"].includes(api.chooseSceneEffectSound("electric",42)),"additional choices work with a blank main path");
assert.equal(api.normalizeSceneSoundVariants({electric:Array.from({length:50},(_,i)=>`${i}.ogg`)}).electric.length,32);
values.set(api.SCENE_EFFECT_VARIANTS,{});values.set("sndSceneElectric","sparks.ogg");
const pending=api.playSceneEffectSound("electric");assert.equal(plays[0].options.src,"sparks.ogg");
assert.equal(plays[0].options.volume,.8);assert.equal(plays[0].broadcast,false,"received effects never rebroadcast audio");
pending.stop();pending.stop();plays[0].resolve(plays[0].sound);await flush();
assert.equal(plays[0].stops,1,"stopping while a file loads stops its eventual sound exactly once");
values.set("sndSceneCoolant","leak.ogg");
values.set(api.SCENE_EFFECT_VARIANTS,{coolant:["leak2.ogg","leak3.ogg"]});
const state={active:true,startedAt:123,seed:42};
api.syncCoolantLeakSound("bridge",state);assert.equal(plays.at(-1).options.loop,true);
assert.equal(plays.at(-1).options.src,api.chooseSceneEffectSound("coolant",state.seed));
const first=plays.at(-1);first.resolve(first.sound);await flush();
api.syncCoolantLeakSound("bridge",{...state,angle:90,density:2});
assert.equal(plays.length,2,"live visual edits do not restart coolant audio");
values.set(api.SCENE_EFFECT_VOLUME,45);api.syncCoolantLeakSound("bridge",state);
assert.equal(first.stops,1);assert.equal(plays.at(-1).options.volume,.45);
const replacement=plays.at(-1);api.stopCoolantLeakSound();replacement.resolve(replacement.sound);await flush();
assert.equal(replacement.stops,1,"teardown cancels pending loop load");
api.syncCoolantLeakSound("bridge",state);const late=plays.at(-1);late.resolve(late.sound);await flush();
api.syncCoolantLeakSound("another",state);assert.equal(late.stops,1,"scene switch stops previous loop");
const other=plays.at(-1);values.set("sndSceneCoolant","");values.set(api.SCENE_EFFECT_VARIANTS,{});api.syncCoolantLeakSound("another",state);
other.resolve(other.sound);await flush();assert.equal(other.stops,1,"clearing path stops the loop");
values.set(api.SCENE_EFFECT_VOLUME,0);assert.equal(api.playSceneEffectSound("electric"),null,"zero volume disables audio");
values.set(api.SCENE_EFFECT_VOLUME,999);api.playSceneEffectSound("electric");assert.equal(plays.at(-1).options.volume,1);
helper.play=()=>Promise.reject(new Error("Missing audio"));api.playSceneEffectSound("electric");await flush();
assert.equal(warnings.length,1,"load failures are handled without breaking visuals");
definitions.get("sndSceneCoolant").onChange();assert.equal(changes[0],api.SCENE_EFFECT_AUDIO_CHANGED);
api.stopCoolantLeakSound();
console.log("Scene effect audio passed: settings, silence, volume, local playback, pending cancellation, loop idempotence, live configuration, scene cleanup and load failure.");
