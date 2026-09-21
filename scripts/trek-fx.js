/** Persistent, token-local Trek FX. Document flags replicate to every client. */
const MODULE = "sta2e-toolkit";
const FLAG = "trekFx";
export const TREK_FX_TYPES = ["blueHaze", "particleStorm", "blueDissolve"];
export const TREK_PARTICLE_COLORS = [
  { id: "cyan", label: "Cyan", core: [.35, .95, 1], glow: [.05, .65, .8], tint: [.05, .30, .36] },
  { id: "red", label: "Red", core: [1, .32, .20], glow: [.8, .07, .05], tint: [.36, .06, .04] },
  { id: "purple", label: "Purple", core: [.78, .42, 1], glow: [.48, .12, .8], tint: [.22, .08, .36] },
  { id: "orange", label: "Orange", core: [1, .60, .16], glow: [.9, .28, .025], tint: [.36, .15, .025] },
  { id: "green", label: "Green", core: [.42, 1, .30], glow: [.12, .7, .08], tint: [.09, .30, .06] },
  { id: "brown", label: "Brown", core: [1, .72, .39], glow: [.60, .30, .10], tint: [.36, .22, .10] },
];
// Latest particle birth is 4.15s, followed by at most 2.1s of travel/fade.
export const TREK_DISSOLVE_DURATION_MS = 6500;
const active = new Map(); // Token objects, so drag previews never replace the real token.
const completions = new Map(); // Scene documents, independent of canvas and drag previews.
let ticker = null;
let registered = false;

export const TREK_FX_FRAGMENT = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize, inputClamp, outputFrame, uBounds;
uniform vec3 uEffects;
uniform vec3 uParticleCore, uParticleGlow, uParticleTint;
uniform float uTime, uSeed;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
             mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
}
vec4 art(vec2 p) {
  vec2 uv=(uBounds.xy+p*uBounds.zw-outputFrame.xy)*inputSize.zw;
  float inside=step(inputClamp.x,uv.x)*step(inputClamp.y,uv.y)
    *step(uv.x,inputClamp.z)*step(uv.y,inputClamp.w);
  return texture2D(uSampler,clamp(uv,inputClamp.xy,inputClamp.zw))*inside;
}
float birth(vec2 p) { return .65+3.5*clamp(p.x*.58+noise(p*9.)*.42,0.,1.); }
vec2 bombardment(vec2 p, vec2 aspect) {
  vec2 grid=p*aspect*18.;
  vec2 light=vec2(0.);
  // Independent lifetimes keep the bursts asynchronous. A particle holds its
  // position and size during its life; the next birth chooses both afresh.
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
    vec2 cell=floor(grid)+vec2(float(x),float(y));
    float seed=hash(cell+vec2(113.,257.));
    float life=uTime*(.85+seed*1.65)+seed*53.;
    float age=fract(life);
    vec2 id=cell+floor(life)*vec2(37.,71.);
    vec2 center=.12+.76*vec2(hash(id+13.),hash(id+29.));
    float radius=mix(.065,.35,pow(hash(id+43.),1.6));
    float dist=length(grid-cell-center)/radius;
    float hold=.12+.28*hash(id+59.);
    float pulse=smoothstep(0.,.035,age)*(1.-smoothstep(hold,hold+.12,age));
    float present=step(.22,hash(id+83.));
    float source=art((cell+center)/(aspect*18.)).a;
    float gain=pulse*present*source*(.7+.5*hash(id+97.));
    float core=1.-smoothstep(.18,1.,dist);
    // A broad colored halo surrounds every bright, round particle core.
    float glow=exp(-dist*dist*.42)*(1.-smoothstep(2.,2.8,dist));
    light+=vec2(core,glow)*gain;
  }
  return light;
}
void main() {
  vec2 p=(vTextureCoord*inputSize.xy+outputFrame.xy-uBounds.xy)/uBounds.zw;
  vec4 base=texture2D(uSampler,vTextureCoord);
  vec3 blue=vec3(.10,.45,1.);
  vec3 ice=vec3(.48,.86,1.);
  float unit=min(uBounds.z,uBounds.w);
  vec2 aspect=uBounds.zw/max(unit,1.);
  float time=uTime;
  if (uEffects.z>.5 && time>=6.5) { gl_FragColor=vec4(0.); return; }
  float matter=1.;
  float edge=0.;
  if (uEffects.z>.5) {
    float delta=time-birth(p);
    matter=1.-smoothstep(-.10,.12,delta);
    edge=exp(-abs(delta)*22.)*(1.-smoothstep(6.5,7.,time));
  }
  vec3 color=base.rgb;
  if (uEffects.x>.5) {
    float fuzz=noise(p*24.+vec2(uTime*1.2,-uTime*1.7));
    float grain=hash(floor(p*uBounds.zw*.7)+floor(uTime*22.));
    color=mix(color,blue*base.a,.32)+ice*base.a*(.09+fuzz*.18+grain*.12);
  }
  if (uEffects.y>.5) color=mix(color,uParticleTint*base.a,.16);
  vec4 result=vec4(color*matter+ice*edge*base.a*.8,base.a*matter);
  if (uEffects.y>.5) {
    vec2 sparks=bombardment(p,aspect)*matter;
    result.rgb+=uParticleCore*sparks.x+uParticleGlow*sparks.y*.65;
    result.a=max(result.a,clamp(sparks.x+sparks.y*.45,0.,1.));
  }
  if (uEffects.x>.5) {
    float halo=0.;
    for (int i=0;i<12;i++) {
      float angle=float(i)*6.283185/12.;
      vec2 ray=vec2(cos(angle),sin(angle))/aspect;
      halo+=art(p+ray*.026).a*.055+art(p+ray*.065).a*.025;
    }
    halo*=mix(.42,.7,noise(p*19.+uTime))*(1.-base.a)*matter;
    result.rgb+=blue*halo;
    result.a=max(result.a,halo);
  }
  if (uEffects.z>.5) {
    float light=0.;
    // Fixed budget. Emit from the source silhouette at its erosion time.
    for (int i=0;i<96;i++) {
      float n=float(i);
      vec2 origin=vec2((mod(n,8.)+.15+.7*hash(vec2(n,3.)))/8.,
                       (floor(n/8.)+.15+.7*hash(vec2(n,7.)))/12.);
      float age=time-birth(origin);
      if (age<0. || age>2.1) continue;
      float seed=hash(vec2(n,29.));
      vec2 drift=vec2(.27+seed*.13,-.18-seed*.12)*age;
      drift.y+=sin(age*3.+seed*30.)*.025*age;
      vec2 delta=(p-origin-drift)*aspect;
      float radius=.006+seed*.007;
      float dist=length(delta)/radius;
      if (dist>3.5) continue;
      float source=art(origin).a;
      float fade=smoothstep(0.,.12,age)*(1.-smoothstep(.65,2.1,age));
      light+=(exp(-dist*dist*1.8)+.24*exp(-dist*dist*.22))*source*fade;
    }
    float alpha=clamp(light,0.,1.);
    result.rgb=result.rgb*(1.-alpha)+mix(blue,ice,min(light,1.))*alpha;
    result.a=alpha+result.a*(1.-alpha);
    result.a=max(result.a,edge*base.a*.7);
  }
  // PIXI filter targets use premultiplied alpha.
  gl_FragColor=vec4(min(result.rgb,vec3(result.a)),result.a);
}`;

export function getTrekFx(token) {
  const saved = token?.document?.getFlag?.(MODULE, FLAG) ?? {};
  return Object.fromEntries(TREK_FX_TYPES.map(key => [key, saved[key] === true]));
}

export function getTrekParticleColor(token) {
  const id = token?.document?.getFlag?.(MODULE, FLAG)?.particleColor;
  return TREK_PARTICLE_COLORS.find(color => color.id === id)
    ?? TREK_PARTICLE_COLORS.find(color => color.id === "brown");
}

export async function setTrekParticleColor(token, id) {
  if (!game.user?.isGM) throw new Error("Only the GM can change Trek FX.");
  if (!TREK_PARTICLE_COLORS.some(color => color.id === id)) throw new Error("Unknown particle color.");
  await token.document.update({ [`flags.${MODULE}.${FLAG}.particleColor`]: id });
  refreshTrekFx(token);
}

export async function setTrekFx(token, key, enabled) {
  if (!game.user?.isGM) throw new Error("Only the GM can change Trek FX.");
  if (!TREK_FX_TYPES.includes(key)) throw new Error("Unknown Trek FX effect.");
  // Update only this toggle, preserving simultaneous edits to other toggles.
  const changes = { [`flags.${MODULE}.${FLAG}.${key}`]: enabled === true };
  if (key === "blueDissolve" && enabled) {
    changes[`flags.${MODULE}.${FLAG}.startedAt`] = game.time?.serverTime ?? Date.now();
  }
  await token.document.update(changes);
  scheduleCompletion(token.document);
  refreshTrekFx(token);
}

export async function clearTrekFx(token) {
  if (!game.user?.isGM) throw new Error("Only the GM can change Trek FX.");
  await token.document.unsetFlag(MODULE, FLAG);
  scheduleCompletion(token.document);
  refreshTrekFx(token);
}

function remove(token) {
  const record = active.get(token);
  if (!record) return;
  active.delete(token);
  if (!record.mesh.destroyed) {
    const remaining = (record.mesh.filters ?? []).filter(f => f !== record.filter);
    record.mesh.filters = remaining.length ? remaining : null;
  }
  record.filter.destroy();
  if (!active.size && ticker) { ticker.remove(tick); ticker = null; }
}

function cancelCompletion(doc) {
  const pending = completions.get(doc);
  if (pending) clearTimeout(pending.timer);
  completions.delete(doc);
}

function scheduleCompletion(doc) {
  const saved = doc?.getFlag?.(MODULE, FLAG);
  // Only a persisted scene token can be removed. Preview documents and prototypes
  // must never schedule deletion, even when they inherit the original's flags.
  if (!game.user?.isGM || doc?.parent?.tokens?.get(doc.id) !== doc
      || saved?.blueDissolve !== true || !Number.isFinite(saved.startedAt)) {
    cancelCompletion(doc);
    return;
  }
  if (completions.get(doc)?.startedAt === saved.startedAt) return;
  cancelCompletion(doc);
  const entry = { startedAt: saved.startedAt, timer: null };
  completions.set(doc, entry);
  const finish = async () => {
    if (completions.get(doc) !== entry) return;
    const current = doc.getFlag(MODULE, FLAG);
    if (doc.parent?.tokens?.get(doc.id) !== doc || current?.blueDissolve !== true
        || current.startedAt !== entry.startedAt) { cancelCompletion(doc); return; }
    const remaining = entry.startedAt + TREK_DISSOLVE_DURATION_MS - (game.time?.serverTime ?? Date.now());
    // Every GM keeps a timer, but only the elected GM performs the deletion.
    // A different GM can take over if that client disconnects or changes scenes.
    const authority = game.users?.activeGM;
    if (remaining > 0 || !game.user?.isGM || authority?.id !== game.user.id) {
      entry.timer = setTimeout(finish, Math.max(1000, remaining));
      return;
    }
    try {
      await doc.delete();
    } catch (error) {
      console.error("STA2e Toolkit | Dissolved token could not be removed:", error);
      ui.notifications.error("The dissolved token could not be removed. Turn off Blue Particle Dissolve to restore it.");
    } finally {
      if (completions.get(doc) === entry) cancelCompletion(doc);
    }
  };
  entry.timer = setTimeout(finish, Math.max(0,
    entry.startedAt + TREK_DISSOLVE_DURATION_MS - (game.time?.serverTime ?? Date.now())));
}

function restoreCompletions() {
  for (const scene of game.scenes ?? []) {
    for (const doc of scene.tokens ?? []) scheduleCompletion(doc);
  }
}

function update(record) {
  const b = record.mesh.getBounds();
  record.filter.uniforms.uBounds = [b.x, b.y, Math.max(1, b.width), Math.max(1, b.height)];
  const elapsed = Math.max(0, ((game.time?.serverTime ?? Date.now()) - record.startedAt) / 1000);
  record.filter.uniforms.uTime = record.dissolve ? Math.min(elapsed, 6.5) : elapsed % 4096;
  record.filter.padding = Math.ceil(Math.max(b.width, b.height) * (record.dissolve ? .9 : .09));
}

function tick() {
  for (const [token, record] of active) {
    if (token.destroyed || record.mesh.destroyed) { remove(token); continue; }
    update(record);
  }
}

export function refreshTrekFx(token) {
  if (!token) return;
  const state = getTrekFx(token);
  const particleColor = getTrekParticleColor(token);
  const effects = TREK_FX_TYPES.map(key => state[key] ? 1 : 0);
  const mesh = token.mesh;
  if (!effects.some(Boolean) || !mesh || mesh.destroyed || token.destroyed) { remove(token); return; }
  let record = active.get(token);
  if (record && (record.mesh !== mesh || !mesh.filters?.includes(record.filter))) {
    remove(token); record = null;
  }
  if (!record) {
    let filter;
    try {
      let seed = 0;
      for (const char of token.id ?? "trek") seed = (seed * 31 + char.charCodeAt(0)) % 10007;
      filter = new PIXI.Filter(undefined, TREK_FX_FRAGMENT, {
        uEffects: effects, uBounds: [0, 0, 1, 1], uTime: 0, uSeed: seed,
        uParticleCore: particleColor.core, uParticleGlow: particleColor.glow, uParticleTint: particleColor.tint,
      });
      const renderer = canvas.app.renderer;
      filter.resolution = Math.min(renderer.resolution ?? 1, 1);
      // Compile before attaching, so an unsupported shader cannot blank the token.
      renderer.shader.generateProgram(filter);
      const program = filter.program.glPrograms[renderer.CONTEXT_UID]?.program;
      if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) {
        throw new Error("Trek FX shader failed to link.");
      }
      record = { mesh, filter, dissolve: !!effects[2], startedAt: 0 };
      update(record);
      // Refresh bounds at application time too (camera transforms can change after a tick).
      filter.apply = (manager, input, output, clearMode) => {
        update(record);
        manager.applyFilter(filter, input, output, clearMode);
      };
      mesh.filters = [...(mesh.filters ?? []), filter];
      active.set(token, record);
    } catch (error) {
      filter?.destroy();
      console.warn("STA2e Toolkit | Trek FX unavailable:", error);
      return;
    }
  }
  record.filter.uniforms.uEffects = effects;
  record.filter.uniforms.uParticleCore = particleColor.core;
  record.filter.uniforms.uParticleGlow = particleColor.glow;
  record.filter.uniforms.uParticleTint = particleColor.tint;
  record.dissolve = !!effects[2];
  const startedAt = token.document.getFlag?.(MODULE, FLAG)?.startedAt;
  record.startedAt = record.dissolve && Number.isFinite(startedAt) ? startedAt : 0;
  update(record);
  if (!ticker) { ticker = canvas.app.ticker; ticker.add(tick); }
}

export function registerTrekFx() {
  if (registered) return;
  registered = true;
  Hooks.on("drawToken", refreshTrekFx);
  Hooks.on("refreshToken", refreshTrekFx);
  Hooks.on("updateToken", doc => {
    scheduleCompletion(doc);
    if (doc.object) refreshTrekFx(doc.object);
  });
  Hooks.on("createToken", scheduleCompletion);
  Hooks.on("destroyToken", remove);
  Hooks.on("deleteToken", doc => {
    cancelCompletion(doc);
    if (doc.object) remove(doc.object);
  });
  Hooks.on("ready", restoreCompletions);
  Hooks.on("updateUser", restoreCompletions);
  Hooks.on("canvasReady", () => {
    restoreCompletions();
    for (const token of canvas.tokens?.placeables ?? []) refreshTrekFx(token);
  });
  Hooks.on("canvasTearDown", () => { for (const token of [...active.keys()]) remove(token); });
}
