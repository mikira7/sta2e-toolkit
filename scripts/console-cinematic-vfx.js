/** Small, bounded GPU volumes and shared soft light textures for bridge consoles. */
const VERTEX8 = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize, uOutputFrame, uOutputTexture;
void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

// Front-to-back absorption gives the smoke real depth and conceals the fire
// behind its foreground billows. Sixteen samples keep multi-console bursts bounded.
const VOLUME = `
uniform float uProgress, uSeed;
float hash(vec3 p) {
  p = fract(p * .1031); p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
    mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
    mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) { return noise(p)*.58 + noise(p*2.03+17.0)*.28 + noise(p*4.07+31.0)*.14; }
vec4 volume(vec2 p) {
  float t = clamp(uProgress,0.0,1.0);
  float life = smoothstep(0.0,.018,t)*(1.0-smoothstep(.55,1.0,t));
  float heat = 1.0-smoothstep(.07,.48,t);
  float expansion = .24 + .76*(1.0-exp(-t*12.0));
  vec3 rgb = vec3(0.0); float alpha = 0.0;
  for (int stepIndex=0; stepIndex<16; stepIndex++) {
    vec3 pos = vec3(p.x,p.y+t*.38,.84-float(stepIndex)*.112);
    float distance = 2.0; vec3 normal = vec3(0,0,1);
    for (int lobe=0; lobe<5; lobe++) {
      float j = float(lobe);
      float angle = j*2.39996+uSeed*.007;
      float drift = lobe==0 ? 0.0 : (.19+.06*sin(j*3.0+uSeed))*expansion;
      vec3 center = vec3(cos(angle)*drift,sin(angle)*drift,sin(j*7.0+uSeed)*.17);
      float radius = (.29+.06*sin(j*13.0+uSeed))*expansion;
      vec3 delta = pos-center;
      float d = length(delta)-radius;
      float weight = clamp(.5+.5*(distance-d)/.13,0.0,1.0);
      distance = mix(distance,d,weight)-.13*weight*(1.0-weight);
      normal = mix(normal,delta/max(length(delta),.001),weight);
    }
    if (distance > .12) continue;
    vec3 flow = pos*10.0+vec3(uSeed*.011,t*1.3,-t*2.8);
    flow.xy += vec2(sin(pos.z*6.0+t*4.0),cos(pos.x*5.0-t*3.0))*.32;
    float n = fbm(flow);
    float surface = distance+(n-.48)*.23;
    float density = (1.0-smoothstep(-.055,.025,surface))*(.28+1.25*smoothstep(.22,.72,n))*life;
    if (density < .005) continue;
    float opacity = 1.0-exp(-density*.68);
    float light = clamp(dot(normal,normalize(vec3(-.45,-.55,.8)))*.5+.5,0.0,1.0);
    float shadow = exp(-max(0.0,fbm(flow+vec3(-.5,-.7,1.0))-.30)*2.6);
    float interior = 1.0-smoothstep(-.18,.04,surface);
    float ignition = heat*(.18+1.35*smoothstep(.32,.78,n))*(.4+interior*.6);
    vec3 ash = mix(vec3(.035,.03,.028),vec3(.33,.32,.31),light*shadow);
    vec3 fire = mix(vec3(1.0,.065,.008),vec3(1.0,.72,.19),smoothstep(.32,.92,ignition));
    // Warm light bleeds into surrounding smoke before the core cools.
    ash += vec3(.32,.085,.012)*heat*exp(-dot(pos,pos)*5.0)*shadow;
    vec3 color = mix(ash,fire,clamp(ignition*1.25,0.0,1.0));
    float transmission = 1.0-alpha;
    rgb += transmission*opacity*color; alpha += transmission*opacity;
    if (alpha > .985) break;
  }
  float flash = exp(-dot(p,p)*24.0)*exp(-t*55.0)*smoothstep(0.0,.004,t);
  float bloom = exp(-dot(p,p)*5.5)*heat*life*.12;
  rgb += vec3(1.0,.92,.72)*flash+vec3(1.0,.22,.025)*bloom;
  alpha = clamp(alpha+flash+bloom,0.0,1.0);
  return vec4(min(rgb,vec3(alpha)),alpha);
}`;

/** Local filter rather than a fullscreen post-process; follows pan and zoom. */
export function createConsoleExplosionVolume(size, seed) {
  const effect = createLocalVolume({ body: VOLUME,
    uniforms: { uProgress: 0, uSeed: (Number(seed) >>> 0) % 10000 },
    bounds: { x: -size*1.8, y: -size*1.8, width: size*3.6, height: size*3.6 } });
  if (!effect) return null;
  return { ...effect, update(progress) { effect.update({ uProgress: Math.min(1, Math.max(0, progress)) }); } };
}

/** Shared local volume filter for one-shot fireballs and sustained plumes. */
export function createLocalVolume({ body, uniforms, bounds }) {
  const renderer = globalThis.canvas?.app?.renderer;
  if (!renderer?.gl || !PIXI.Filter) return null;
  let quad, filter;
  try {
    const v8 = Number.parseInt(PIXI.VERSION, 10) >= 8;
    const prefix = v8
      ? "in vec2 vTextureCoord; uniform vec4 uInputSize, uOutputFrame; uniform sampler2D uTexture;"
      : "varying vec2 vTextureCoord; uniform vec4 inputSize, outputFrame; uniform sampler2D uSampler;";
    const map = v8 ? "uInputSize.xy / uOutputFrame.zw" : "inputSize.xy / outputFrame.zw";
    const sampler = v8 ? "uTexture" : "uSampler";
    const fragment = `precision highp float;\n${prefix}\n${body}\nvoid main() {
      vec2 p = vTextureCoord * ${map} * 2.0 - 1.0;
      gl_FragColor = volume(p) * texture2D(${sampler},vTextureCoord).a;
    }`;
    if (v8) {
      if (!PIXI.GlProgram) return null;
      filter = new PIXI.Filter({ glProgram: PIXI.GlProgram.from({ vertex: VERTEX8, fragment }),
        resources: { consoleUniforms: Object.fromEntries(Object.entries(uniforms)
          .map(([key, value]) => [key, { value, type: "f32" }])) }, resolution: 0.65, padding: 0 });
    } else {
      filter = new PIXI.Filter(null, fragment, uniforms);
      filter.resolution = 0.65; filter.padding = 0;
      // Validate immediately so older GPUs retain the Graphics fallback.
      if (renderer.shader?.generateProgram) {
        renderer.shader.generateProgram(filter);
        const program = filter.program.glPrograms[renderer.CONTEXT_UID]?.program;
        if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) throw new Error("Console volume shader failed to link.");
      }
    }
    quad = new PIXI.Graphics();
    if (!v8 && quad.beginFill) quad.beginFill(0xffffff).drawRect(bounds.x,bounds.y,bounds.width,bounds.height).endFill();
    else quad.rect(bounds.x,bounds.y,bounds.width,bounds.height).fill(0xffffff);
    quad.filters = [filter]; quad.eventMode = "none";
    let destroyed = false;
    return { display: quad,
      update(values) {
        const target = v8 ? filter.resources.consoleUniforms.uniforms : filter.uniforms;
        Object.assign(target, values);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true; quad.filters = null;
        quad.parent?.removeChild(quad); quad.destroy(); filter.destroy();
      } };
  } catch (error) {
    if (quad) { quad.filters = null; quad.destroy(); }
    filter?.destroy();
    console.warn("STA2e Toolkit | Console volume unavailable; using shaded billows.", error);
    return null;
  }
}

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const image = document.createElement("canvas"); image.width = image.height = 128;
  const context = image.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(64,64,0,64,64,64);
  for (const [offset, alpha] of [[0,1],[.08,.95],[.2,.6],[.4,.22],[.65,.055],[1,0]]) gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
  context.fillStyle = gradient; context.fillRect(0,0,128,128);
  glowTexture = PIXI.Texture.from(image);
  return glowTexture;
}

export function createConsoleElectricalBloom(size) {
  if (!PIXI.Sprite || !PIXI.Texture || !globalThis.document?.createElement) return null;
  const texture = getGlowTexture();
  if (!texture) return null;
  const display = new PIXI.Container(); display.eventMode = "none";
  const light = (color, width, height) => {
    const sprite = new PIXI.Sprite(texture); sprite.anchor.set(.5); sprite.tint = color;
    sprite.width = width; sprite.height = height; sprite.blendMode = PIXI.BLEND_MODES?.ADD ?? "add";
    display.addChild(sprite); return sprite;
  };
  const aura = light(0x226aff,size*3.8,size*3.2), core = light(0xb5efff,size*1.1,size*1.1);
  const flare = light(0x79cfff,size*5,size*.25);
  const contacts = Array.from({ length: 5 }, () => light(0x94eaff,size*.48,size*.48));
  let destroyed = false;
  return { display,
    update(progress, pulse) {
      const fade = Math.min(1,progress*40)*(1-progress);
      aura.alpha = fade*(.33+pulse*.3); core.alpha = fade*(.48+pulse*.5);
      flare.alpha = fade*pulse*.38;
      for (const contact of contacts) contact.alpha = 0;
    },
    contact(index, x, y, intensity) {
      const sprite = contacts[index]; sprite.position.set(x,y); sprite.alpha = intensity*.7;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; display.parent?.removeChild(display); display.destroy({ children: true });
    } };
}

export function clearConsoleCinematicTextures() {
  glowTexture?.destroy(true); glowTexture = null;
}
