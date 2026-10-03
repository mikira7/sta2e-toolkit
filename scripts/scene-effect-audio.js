/** Scene effects already broadcast their visuals; audio is local on each viewer. */
const MODULE = "sta2e-toolkit";
export const SCENE_EFFECT_SOUNDS = [
  { kind: "impact", key: "sndSceneImpact", label: "Canvas Shake — Bridge Impact" },
  { kind: "earthquake", key: "sndSceneEarthquake", label: "Canvas Shake — Earthquake" },
  { kind: "electric", key: "sndSceneElectric", label: "Console — Electrical" },
  { kind: "explosion", key: "sndSceneExplosion", label: "Console — Explosion" },
  { kind: "coolant", key: "sndSceneCoolant", label: "Coolant Leak — Loop" },
];
export const SCENE_EFFECT_VOLUME = "sceneEffectSoundVolume";
export const SCENE_EFFECT_VARIANTS = "sceneEffectSoundVariants";
export const SCENE_EFFECT_AUDIO_CHANGED = "sta2eSceneEffectAudioChanged";

export function registerSceneEffectAudioSettings() {
  const onChange = () => Hooks.callAll(SCENE_EFFECT_AUDIO_CHANGED);
  for (const { key, label, kind } of SCENE_EFFECT_SOUNDS) game.settings.register(MODULE, key, {
    name: `Scene Effects Sound — ${label}`, scope: "world", config: false,
    type: String, default: "", filePicker: "audio", onChange,
    hint: kind === "coolant" ? "Loops while the coolant leak runs. Blank is silent."
      : "Played with this scene effect. Blank is silent.",
  });
  game.settings.register(MODULE, SCENE_EFFECT_VOLUME, {
    name: "Scene Effects Sound Volume", scope: "world", config: false,
    type: Number, default: 80, range: { min: 0, max: 100, step: 5 }, onChange,
    hint: "Volume for scene effect sounds, from 0 to 100 percent.",
  });
  game.settings.register(MODULE, SCENE_EFFECT_VARIANTS, {
    name: "Scene Effect Sound Choices", scope: "world", config: false,
    type: Object, default: {}, onChange,
    hint: "Additional random sound choices for each scene effect.",
  });
}

export function normalizeSceneSoundVariants(raw = {}) {
  return Object.fromEntries(SCENE_EFFECT_SOUNDS.map(({kind}) => [kind,
    [...new Set((Array.isArray(raw?.[kind]) ? raw[kind] : [])
      .filter(path => typeof path === "string").map(path => path.trim()).filter(Boolean))].slice(0,32)]));
}

export function getSceneSoundVariants() {
  try { return normalizeSceneSoundVariants(game.settings.get(MODULE, SCENE_EFFECT_VARIANTS)); }
  catch { return normalizeSceneSoundVariants(); }
}

/** The effect's shared seed chooses the same file on every viewing client. */
export function chooseSceneEffectSound(kind, seed = Math.floor(Math.random()*4294967296)) {
  const row = SCENE_EFFECT_SOUNDS.find(row => row.kind === kind);
  if (!row) return "";
  let primary="";
  try { primary=game.settings.get(MODULE,row.key); } catch { /* Unconfigured. */ }
  const choices=[...new Set([typeof primary==="string"?primary.trim():"",...getSceneSoundVariants()[kind]].filter(Boolean))];
  if (!choices.length) return "";
  let hash=Number(seed)>>>0;
  for(const char of kind)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d);hash^=hash>>>15;
  hash=Math.imul(hash,0x846ca68b);hash^=hash>>>16;
  return choices[Math.floor((hash>>>0)/4294967296*choices.length)];
}

function config(kind, seed) {
  try {
    const value = Number(game.settings.get(MODULE, SCENE_EFFECT_VOLUME));
    return { src: chooseSceneEffectSound(kind,seed),
      volume: Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : .8 };
  } catch { return { src: "", volume: .8 }; }
}

/** Stopping before asynchronous loading finishes also stops the resolved sound. */
export function playSceneEffectSound(kind, { loop = false, seed } = {}) {
  const { src, volume } = config(kind,seed);
  if (!src || !volume) return null;
  const helper = globalThis.foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
  if (!helper?.play) return null;
  let stopped = false, sound;
  const stopSound = value => {
    try { Promise.resolve(value?.stop?.()).catch(() => {}); } catch { /* Already stopped. */ }
  };
  try {
    Promise.resolve(helper.play({ src, volume, autoplay: true, loop }, false)).then(value => {
      sound = value;
      if (stopped) stopSound(sound);
    }).catch(error => console.warn("STA2e Toolkit | Scene effect audio failed:", error));
  } catch (error) { console.warn("STA2e Toolkit | Scene effect audio failed:", error); }
  return { stop() { if (stopped) return; stopped = true; stopSound(sound); } };
}

let coolant = null;
export function stopCoolantLeakSound() {
  coolant?.handle?.stop(); coolant = null;
}

export function syncCoolantLeakSound(sceneId, state) {
  const { src, volume } = config("coolant",state.seed);
  const key = JSON.stringify([sceneId, state.startedAt, state.seed, src, volume]);
  if (coolant?.key === key) return;
  stopCoolantLeakSound();
  if (state.active && src && volume) coolant = { key, handle: playSceneEffectSound("coolant", { loop: true, seed: state.seed }) };
}
