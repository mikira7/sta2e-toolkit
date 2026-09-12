/** Cinematic, client-local transporter. Never writes a TokenDocument. */
import { TransporterVFX } from "./transporter-vfx.js";
import {
  getTransporterShaderSettings, normalizeTransporterShader, transporterTimeline, transporterNow, transporterAccents,
} from "./transporter-shader-config.js";

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)) + uSeed) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
             mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);
}
`;
const CYLINDER = `
float cylinderParticles(vec2 art) {
  float x = (art.x-.5)/.52;
  if (abs(x) >= 1. || art.y < -.06 || art.y > 1.06) return 0.;
  float clock = uTime*uParticleSpeed;
  float rotation = clock*uOuterDirection;
  float columns = floor(clamp(uNoiseScale,12.,48.));
  float rows = clamp(uNoiseScale*.7*uSize.y/max(uSize.x,1.),10.,64.);
  float light = 0.;
  // Inverse-project front and rear halves of a vertical cylinder. Angular
  // travel becomes sideways motion at the front and recession at the edges.
  for (int side=0; side<2; side++) {
    float theta = asin(x);
    if (side == 1) theta = 3.141593-theta;
    float depth = cos(theta);
    float vertical = art.y+depth*.05+clock*.035;
    vec2 grid = vec2((theta/6.283185-rotation*.085-vertical*.12)*columns,vertical*rows);
    for (int y=-1; y<=1; y++) for (int n=-1; n<=1; n++) {
      vec2 cell = floor(grid)+vec2(float(n),float(y));
      vec2 id = vec2(mod(cell.x,columns),cell.y);
      float seed = hash(id);
      vec2 center = .15+.7*vec2(hash(id+11.),hash(id+23.));
      float altitude = (cell.y+center.y)/rows;
      float angle = ((cell.x+center.x)/columns+rotation*.085+altitude*.12)*6.283185;
      float z = cos(angle);
      if ((side == 0 && z < 0.) || (side == 1 && z >= 0.)) continue;
      vec2 projected = vec2(.5+.52*sin(angle),altitude-clock*.035-z*.05);
      float near = .5+.5*z;
      float radius = max(1.,min(uSize.x,uSize.y)*.01)*uParticleSize
                   *mix(.3,1.25,pow(hash(id+37.),1.5))*mix(.78,1.18,near);
      float distance = length((art-projected)*uSize)/max(radius,.1);
      float orb = (1.-smoothstep(.25,1.,distance))+exp(-distance*distance*1.8)*.22;
      float cluster = noise(id*.23);
      float present = 1.-step(mix(.22,.9,cluster),seed);
      float flicker = .6+.4*sin(uTime*uShimmer*(.8+seed)+seed*63.);
      float rear = side == 0 ? 1. : .3*(1.-uMatter*.75);
      light += orb*present*flicker*rear*mix(.7,1.15,near);
    }
  }
  float ends = smoothstep(-.06,0.,art.y)*(1.-smoothstep(1.,1.06,art.y));
  ends *= 1.-smoothstep(.97,1.,abs(x));
  return light*ends;
}
float coreParticles(vec2 art) {
  // A second volume at the artwork centre, half-width at the default size. Pixel coordinates keep
  // it spherical on tall figures as well as square portraits. Nested orbits
  // fill its interior instead of drawing another hollow cylindrical wall.
  vec2 pixel = (art-.5)*uSize;
  float extent = max(1.,min(uSize.x,uSize.y)*.26*uInnerClusterSize);
  if (length(pixel) > extent*1.15) return 0.;
  float clock = uTime*uInnerParticleSpeed;
  float count = floor(clamp(uNoiseScale*2.,24.,96.));
  float light = 0.;
  for (int particle=0; particle<96; particle++) {
    float i = float(particle);
    if (i >= count) break;
    vec2 id = vec2(i+419.,827.);
    float seed = hash(id);
    float latitude = (hash(id+11.)*2.-1.)*.9
                   + .08*sin(clock*.23+seed*63.);
    float shell = mix(.18,1.,pow(hash(id+23.),.6));
    float orbit = sqrt(max(0.,1.-latitude*latitude))*shell;
    float angle = hash(id+37.)*6.283185+clock*uInnerDirection*(.45+hash(id+43.)*.3);
    float depth = cos(angle)*orbit;
    vec2 projected = vec2(sin(angle)*orbit,latitude*shell)*extent;
    float near = .5+.5*depth;
    float radius = max(1.,min(uSize.x,uSize.y)*.01)*uParticleSize
                 *mix(.3,1.1,pow(hash(id+53.),1.5))*mix(.78,1.18,near);
    float distance = length(pixel-projected)/max(radius,.1);
    float orb = (1.-smoothstep(.25,1.,distance))+exp(-distance*distance*1.8)*.22;
    float flicker = .6+.4*sin(uTime*uShimmer*(.8+seed)+seed*63.);
    float rear = mix(.3*(1.-uMatter*.75),1.,smoothstep(-.12,.12,depth));
    light += orb*flicker*rear*mix(.7,1.15,near);
  }
  return light*(1.-smoothstep(extent,extent*1.15,length(pixel)));
}
`;
export const TRANSPORTER_FILTER_FRAGMENT = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform float uSeed, uTime, uMatter, uEnergy, uNoiseScale, uNoiseStrength, uShimmer, uGlow, uParticleSize;
uniform float uParticleSpeed, uInnerParticleSpeed, uCoreIntensity;
uniform float uInnerClusterSize;
uniform float uOuterDirection, uInnerDirection;
uniform float uStaticAmount, uStaticRate;
uniform vec2 uSize;
uniform vec3 uColor, uHighlight;
uniform vec3 uStrands;
uniform float uField, uHaze;
uniform vec4 uScan;
${NOISE}
${CYLINDER}
float staticParticles(vec2 p) {
  // Stationary during each short appearance. New births choose new positions,
  // sizes and timing independently, so there is no drift or synchronized pulse.
  vec2 grid = p*20.*vec2(1.,outputFrame.w/max(outputFrame.z,1.));
  float light = 0.;
  for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++) {
    vec2 cell = floor(grid)+vec2(float(x),float(y));
    float seed = hash(cell+vec2(113.,257.));
    float life = uTime*uStaticRate*(.7+seed*1.6)+seed*53.;
    float age = fract(life);
    vec2 id = cell+floor(life)*vec2(37.,71.);
    vec2 center = .08+.84*vec2(hash(id+13.),hash(id+29.));
    float radius = mix(.055,.29,pow(hash(id+43.),1.4));
    float distance = length(grid-cell-center)/radius;
    float orb = (1.-smoothstep(.25,1.,distance))+exp(-distance*distance*1.7)*.18;
    float hold = .15+.18*hash(id+59.);
    float pulse = smoothstep(0.,.045,age)*(1.-smoothstep(hold,hold+.09,age));
    float present = 1.-step(uStaticAmount,hash(id+83.));
    light += orb*pulse*present*(.65+.65*hash(id+97.));
  }
  return light;
}
float energyStrands(vec2 p) {
  float clock = uTime*uShimmer;
  float energy = 0.;
  float count = clamp(uStrands.z*2.*uNoiseScale/24.,6.,32.);
  vec2 aspect = vec2(outputFrame.z/max(outputFrame.w,1.),1.);
  // Bounded independent filaments, each in its own randomly rotated frame.
  // Aspect correction keeps diagonal curves and thickness true to the artwork.
  for (int strand=0; strand<32; strand++) {
    float i = float(strand);
    if (i >= count) break;
    float seed = hash(vec2(i,91.));
    float life = clock*(.16+seed*.2)+seed*53.;
    float age = fract(life);
    vec2 id = vec2(i,floor(life));
    vec2 center = vec2(hash(id+11.),hash(id+23.));
    center += .04*vec2(sin(clock*.6+seed*37.),cos(clock*.47+seed*51.));
    float angle = hash(id+47.)*6.283185 + .3*sin(clock*.4+seed*19.);
    vec2 delta = (p-center)*aspect;
    vec2 local = vec2(dot(delta,vec2(cos(angle),sin(angle))),
                      dot(delta,vec2(-sin(angle),cos(angle))));
    float length = uStrands.y*(.55+.65*hash(id+67.));
    float phase = seed*63.+clock*(.5+seed*1.4);
    float bend = sin(local.y/length*8.+phase)*length*.09
               + sin(local.y/length*19.-phase*1.3)*length*.035;
    float segment = 1.-smoothstep(length*.25,length*.5,abs(local.y));
    float width = .006*uStrands.x*uParticleSize*(.7+seed*.6);
    float distance = abs(local.x-bend)/width;
    float light = exp(-distance*distance*1.8) + exp(-distance*distance*.16)*(.22+uGlow*.16);
    float pulse = smoothstep(0.,.16,age)*(1.-smoothstep(.65,1.,age))
                *(.35+.65*noise(vec2(clock*(.8+seed),i*1.7)));
    energy += light*segment*pulse;
  }
  return energy;
}
void main() {
  vec4 src = texture2D(uSampler, vTextureCoord);
  vec2 p = vTextureCoord * inputSize.xy / max(outputFrame.zw, vec2(1.));
  // A uniform fade of the actual artwork, never a threshold that cuts holes in it.
  vec4 art = src * uMatter;
  float glitter;
  float fieldFront = 1.;
  if (uField > 0.) {
    // Fine, connected ripples form a field behind the descending scan. The
    // source alpha clips this luminous fabric to the actual figure/portrait.
    vec2 grid = p*uNoiseScale*1.9*vec2(1.,outputFrame.w/max(outputFrame.z,1.));
    float clock = uTime*uShimmer;
    vec2 warp = vec2(noise(grid*.2+clock*.19),noise(grid*.2-clock*.16+31.))-.5;
    float weave = noise(grid+warp*2.2+vec2(clock*.22,-clock*.15));
    float lace = pow(max(0.,1.-abs(weave-.5)*5.),max(2.,7./uParticleSize));
    float mist = noise(grid*.38+warp+clock*.12);
    glitter = (lace*.48+mist*.23)*uNoiseStrength;
    fieldFront = (1.-smoothstep(uScan.x-.07,uScan.x+.04,p.y))*smoothstep(0.,.03,uScan.x);
  } else if (uStrands.x > 0.) {
    glitter = energyStrands(p)*uNoiseStrength;
  } else if (uHaze > 0.) {
    vec2 q = p*vec2(3.,5.)*uNoiseScale/18.;
    vec2 drift = vec2(uTime*.08,-uTime*.12)*uShimmer;
    glitter = (noise(q+drift)*.35+noise(q*2.3-drift)*.15)*uNoiseStrength;
  } else {
    // Preserve the cylinder trajectories, but composite them through the source
    // alpha so particles cannot appear in transparent artwork or around its edge.
    glitter = cylinderParticles(p)*uNoiseStrength;
    if (uCoreIntensity > 0.) glitter += coreParticles(p)*uCoreIntensity;
  }
  // Common layer on every era/faction, including fields, strands and haze.
  // The final composite clips both its core and halo to the source alpha.
  if (uStaticAmount > 0.) glitter += staticParticles(p);
  float veil = uEnergy*(.19 + .09*uGlow)*fieldFront;
  float emission = clamp(veil + glitter*uEnergy*(.8+uGlow*.5)*fieldFront,0.,.94);
  vec3 color = mix(uColor,uHighlight,clamp(glitter*2.,0.,1.));
  // Alpha-over keeps colors premultiplied and respects the source artwork's alpha.
  gl_FragColor = vec4(art.rgb*(1.-emission)+color*src.a*emission,
                      art.a+src.a*emission*(1.-uMatter));
}
`;
const VERT = `
precision highp float;
attribute vec2 aVertexPosition;
uniform mat3 translationMatrix, projectionMatrix;
varying vec2 vCoord;
void main() {
  vCoord = aVertexPosition;
  gl_Position = vec4((projectionMatrix*translationMatrix*vec3(aVertexPosition,1.)).xy,0.,1.);
}
`;
export const TRANSPORTER_RAIN_FRAGMENT = `
precision highp float;
varying vec2 vCoord;
uniform float uSeed, uTime, uEnergy, uAlpha, uDensity, uSpeed, uParticleSize;
uniform float uStretch, uTurbulence, uPulse, uShimmer, uGlow, uShape;
uniform float uRainGain, uCircle;
uniform float uHaze, uProgress, uNoiseScale, uNoiseStrength;
uniform vec4 uArtRect, uOrbs;
uniform vec4 uScan;
uniform vec3 uLines;
uniform vec2 uSize;
uniform vec2 uSwipeSize;
uniform vec3 uColor, uHighlight, uSecondary;
${NOISE}

void main() {
  vec2 p = vCoord;
  vec2 art = (p-uArtRect.xy)/uArtRect.zw;
  float spark = 0.;
  vec3 spectrum = vec3(0.);
  // Long, continuous trails measured in TOKEN heights. No vertical cells to
  // truncate a streak into the short dashes of the previous rain shader.
  for (int layer=0; layer<3; layer++) {
    float l = float(layer);
    float column = p.x*(22.+l*7.)*mix(1.,1.65,uHaze) + sin(uTime*.3+l)*uTurbulence*.18;
    vec2 cell = vec2(floor(column),l*43.);
    float seed = hash(cell);
    float dx = fract(column)-(.2+.6*hash(cell+17.));
    float width = mix(.075,.16,hash(cell+29.))*uParticleSize;
    float across = exp(-pow(dx/width,2.)*1.8);
    float head = uTime*uSpeed*(.45+l*.2) + hash(cell+47.)*2.4;
    float behind = mod(head-art.y,2.4);
    float length = mix(.82,.98,hash(cell+73.))*mix(.95,1.,clamp(uStretch/14.,0.,1.));
    float tail = smoothstep(0.,.018,behind)*(1.-smoothstep(length*.85,length,behind));
    tail *= .4+.6*(1.-clamp(behind/length,0.,1.));
    float drop = across*tail*(1.-step(uDensity*mix(.55,.9,uHaze),seed))*(.45+.55*hash(cell+61.));
    spark += drop;
    float hue = hash(cell+89.);
    spectrum += drop*(hue < .34 ? uColor : (hue < .68 ? uSecondary : uHighlight));
  }
  float envelope = smoothstep(0.,.08,p.y)*(1.-smoothstep(.86,1.,p.y));
  envelope *= smoothstep(0.,.16,p.x)*(1.-smoothstep(.84,1.,p.x));
  float pulse = 1.-uPulse*.5 + uPulse*.5*sin(uTime*uShimmer*6.283);
  float shaft = exp(-pow((p.x-.5)*5.,2.)) * .018*uGlow;
  float rain = (spark*(.9+uGlow*.35)+shaft)*envelope*uEnergy*pulse*uRainGain;
  rain *= mix(1.,smoothstep(.1,.28,uProgress),uHaze);
  vec2 mistCoord = vec2(art.x*3.,art.y*4.5)*uNoiseScale/18.;
  vec2 mistDrift = vec2(uTime*.09,-uTime*.13)*uShimmer;
  float mist = noise(mistCoord+mistDrift)*.65+noise(mistCoord*2.1-mistDrift)*.35;
  float mistEdge = (1.-smoothstep(.38,.65,abs(art.x-.5)))
                 *smoothstep(-.15,.08,art.y)*(1.-smoothstep(.92,1.16,art.y));
  float haze = (.12+mist*.4)*mistEdge*uHaze*uEnergy*uNoiseStrength*(.7+uGlow*.4);
  // Accents are placed relative to the ART, not to the taller rain column.
  vec2 pixel = (art-.5)*uSize;
  float unit = max(1.,min(uSize.x,uSize.y)*.01);
  float radius = max(uSize.x,uSize.y)*.55;
  float rimDist = abs(length(pixel)-radius)/unit;
  float rim = (exp(-rimDist*rimDist*.8)*.58 + exp(-rimDist*rimDist*.07)*.15)*uCircle*uEnergy;
  float accents = 0.;
  for (int pair=0; pair<2; pair++) {
    float travel = pair == 0 ? uOrbs.x : uOrbs.z;
    float strength = pair == 0 ? uOrbs.y : uOrbs.w;
    for (int side=0; side<2; side++) {
      float signY = side == 0 ? -1. : 1.;
      vec2 delta = (art-vec2(.5,.5+signY*travel*.5))*uSize/(unit*5.5);
      float d = dot(delta,delta);
      accents += (exp(-d*2.) + exp(-d*.22)*.3)*strength;
    }
  }
  float halfHeight = uLines.x*.5*uSwipeSize.x;
  float alongLine = abs(art.y-.5)/max(halfHeight,.0001);
  float lineEnds = step(.0001,halfHeight)*(1.-step(1.,alongLine));
  // Four times the former central width, narrowing continuously to pointed tips.
  float lineWidth = max(.02,4.*uSwipeSize.y*pow(max(0.,1.-alongLine),.7));
  float lineX = max(.055*uSwipeSize.y,uLines.y*.6);
  float dLeft = (art.x-(.5-lineX))*uSize.x/unit;
  float dRight = (art.x-(.5+lineX))*uSize.x/unit;
  float swipeCore = (exp(-pow(dLeft/lineWidth,2.)*.8)+exp(-pow(dRight/lineWidth,2.)*.8))*lineEnds*uLines.z;
  vec2 glowDistance = abs(vec2(dLeft,dRight))/lineWidth;
  vec2 halos = (exp(-glowDistance*glowDistance*.085)*.58
              + exp(-glowDistance*glowDistance*.018)*.2)
              * (1.-smoothstep(vec2(10.),vec2(14.),glowDistance));
  float swipeGlow = halos.x+halos.y;
  swipeGlow *= lineEnds*uLines.z*(.85+uGlow*.4);
  accents += swipeCore;
  // Romulan: a bright horizontal scan, then two full-height scan lines which
  // open faintly and close with a luminous central convergence. Soft ends and
  // halos avoid a rectangular sheet around transparent artwork.
  float acrossBody = 1.-smoothstep(.42,.56,abs(art.x-.5));
  float downDistance = (art.y-uScan.x)*uSize.y/unit;
  float downScan = (exp(-downDistance*downDistance*.4)*1.6
                 + exp(-downDistance*downDistance*.012)*(.45+uGlow*.4))*acrossBody*uScan.y;
  float scanLeft = (art.x-(.5-uScan.z*.5))*uSize.x/unit;
  float scanRight = (art.x-(.5+uScan.z*.5))*uSize.x/unit;
  float scanEnds = 1.-smoothstep(.43,.55,abs(art.y-.5));
  float sideScans = (exp(-scanLeft*scanLeft*.6)+exp(-scanRight*scanRight*.6)
                  + (exp(-scanLeft*scanLeft*.012)+exp(-scanRight*scanRight*.012))*(.35+uGlow*.45))*scanEnds*uScan.w;
  accents += downScan+sideScans;
  float total = rain+rim+accents+swipeGlow+haze;
  float a = clamp(total*uAlpha,0.,1.);
  vec3 col = mix(uColor,uHighlight,clamp(spark*.55+accents*.8,0.,1.));
  vec3 rainColor = mix(col,spectrum/max(spark,.0001),uHaze);
  vec3 mistColor = mix(uColor,uSecondary,smoothstep(.3,.7,mist));
  col = (col*(rim+accents+swipeGlow)+rainColor*rain+mistColor*haze)/max(total,.0001);
  gl_FragColor = vec4(col*a,a);
}
`;

let classes;
let warned = false;
const active = new Map();
const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255);
function shaderClasses() {
  if (classes) return classes;
  const Base = globalThis.foundry?.canvas?.rendering?.shaders?.AbstractBaseShader;
  const Filter = globalThis.PIXI?.Filter;
  if (!Base || !Filter) throw new Error("Foundry shader interfaces unavailable");
  class TransporterRain extends Base {
    static _createVertexShader() { return VERT; }
    static _createFragmentShader() { return TRANSPORTER_RAIN_FRAGMENT; }
    static defaultUniforms = {
      uSeed: 0, uTime: 0, uEnergy: 0, uAlpha: 1, uDensity: .65, uSpeed: 1,
      uParticleSize: 1, uStretch: 3, uTurbulence: .15, uPulse: .08,
      uShimmer: 1.5, uGlow: .45, uShape: 0, uSize: [100,200],
      uRainGain: 1, uCircle: 0, uArtRect: [0,0,1,1], uOrbs: [0,0,0,0], uLines: [0,0,0],
      uSwipeSize: [1,1],
      uScan: [0,0,0,0],
      uHaze: 0, uProgress: 0, uNoiseScale: 24, uNoiseStrength: .65,
      uSecondary: [.85,.78,1],
      uColor: [0.4,0.7,1], uHighlight: [1,1,1],
    };
    _preRender(mesh) { this.uniforms.uAlpha = mesh.worldAlpha; }
  }
  classes = { Rain: TransporterRain, Filter };
  return classes;
}
function warn(error) {
  if (warned) return;
  warned = true;
  console.warn("STA2e Toolkit | Transporter shader unavailable; using native visual fallback.", error);
}
function createShaderParts(token, settings, seed) {
  const renderer = canvas.app?.renderer;
  if (!renderer?.gl || renderer.gl.isContextLost()) throw new Error("WebGL unavailable");
  const { Rain, Filter } = shaderClasses();
  let filter, rain;
  try {
    filter = new Filter(undefined, TRANSPORTER_FILTER_FRAGMENT, {
      uSeed: seed, uTime: 0, uMatter: 1, uEnergy: 0,
      uNoiseScale: settings.noiseScale, uNoiseStrength: settings.noiseStrength,
      uCoreIntensity: settings.coreIntensity,
      uInnerClusterSize: settings.innerClusterSize/100,
      uOuterDirection: settings.outerDirection === "counterclockwise" ? -1 : 1,
      uInnerDirection: settings.innerDirection === "counterclockwise" ? -1 : 1,
      uShimmer: settings.shimmerSpeed, uGlow: settings.glow,
      uParticleSize: settings.particleSize,
      uParticleSpeed: settings.particleSpeed, uSize: [100,200],
      uInnerParticleSpeed: settings.innerParticleSpeed,
      uStaticAmount: settings.staticAmount, uStaticRate: settings.staticRate,
      uStrands: [settings.strandWidth,settings.strandLength,settings.strandCount],
      uField: settings.accent === "romulan" ? 1 : 0, uHaze: settings.accent === "dominion" ? 1 : 0, uScan: [0,0,0,0],
      uColor: rgb(settings.color), uHighlight: rgb(settings.highlight),
    });
    // Bound filter buffers on large or highly zoomed token art.
    filter.resolution = Math.min(renderer.resolution ?? 1, 1);
    filter.padding = 0;
    rain = new foundry.canvas.containers.QuadMesh(Rain);
    rain.blendMode = PIXI.BLEND_MODES.ADD;
    Object.assign(rain.shader.uniforms, {
      uSeed: seed, uDensity: settings.rainDensity, uSpeed: settings.rainSpeed,
      uParticleSize: settings.particleSize, uStretch: settings.stretch,
      uTurbulence: settings.turbulence, uPulse: settings.pulse, uShimmer: settings.shimmerSpeed,
      uGlow: settings.glow, uShape: settings.shape,
      uRainGain: settings.rainGain,
      uHaze: settings.accent === "dominion" ? 1 : 0,
      uNoiseScale: settings.noiseScale, uNoiseStrength: settings.noiseStrength, uSecondary: rgb(settings.secondary),
      uSwipeSize: [settings.swipeHeight/100,settings.swipeWidth/100],
      uColor: rgb(settings.color), uHighlight: rgb(settings.highlight),
    });
    // Compile/link now, before changing token appearance. PIXI otherwise defers failure until rendering.
    for (const shader of [filter, rain.shader]) {
      // Compile without binding: inputSize/outputFrame belong to the filter system and
      // are not populated until the actual filter pass.
      if (!shader.program.glPrograms?.[renderer.CONTEXT_UID]) renderer.shader.generateProgram(shader);
      const program = shader.program.glPrograms?.[renderer.CONTEXT_UID]?.program;
      if (program && !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) throw new Error("Transporter shader link failed");
    }
    token.mesh.filters = [...(token.mesh.filters ?? []), filter];
    return { filter, rain };
  } catch (error) {
    filter?.destroy();
    rain?.destroy({ children: true });
    throw error;
  }
}

/** Artwork bounds in the overlay layer's coordinates (including texture scale/rotation). */
function artworkBounds(mesh, layer, token) {
  const b = mesh.getBounds();
  const inv = layer.worldTransform;
  const a = inv.applyInverse({ x: b.x, y: b.y });
  const z = inv.applyInverse({ x: b.x+b.width, y: b.y+b.height });
  if (![a.x,a.y,z.x,z.y].every(Number.isFinite)) throw new Error("Invalid token bounds");
  return { x: a.x, y: a.y, width: Math.max(1,z.x-a.x || token.w), height: Math.max(1,z.y-a.y || token.h) };
}

/** Returns a handle even when graphics fail. Completion never depends on a rendering frame. */
export function playTransporterShader(token, type = "tngFed", options = {}) {
  const settings = normalizeTransporterShader(type, options.settings ?? getTransporterShaderSettings(type));
  const phase = options.phase === "in" ? "in" : "out";
  const preview = options.preview === true;
  const key = `${token.document.parent?.id ?? canvas.scene?.id}:${token.id}`;
  // A preview must never cancel an actual transport's local visibility animation.
  if (preview && active.has(key) && !active.get(key).preview) return null;
  active.get(key)?.stop("replaced");
  const mesh = token.mesh;
  const originalAlpha = mesh?.alpha ?? 1;
  const originalDocumentAlpha = token.document.alpha ?? 1;
  const targetAlpha = options.targetAlpha ?? (phase === "in" && !preview ? 1 : originalDocumentAlpha);
  const startTime = options.startTime ?? transporterNow();
  const seed = Number.isFinite(options.seed) ? options.seed % 10000 : 1;
  const ticker = canvas.app?.ticker;
  const view = canvas.app?.renderer?.view;
  const layer = canvas.tokens;
  const scene = canvas.scene;
  let filter, rain, fallback, timer, done = false, departed = false, lastVisible = false;
  let resolveFinished;
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  const stripFilter = () => {
    if (filter && mesh && !mesh.destroyed) mesh.filters = (mesh.filters ?? []).filter(f => f !== filter);
    try { filter?.destroy(); } catch { /* renderer gone */ }
    filter = null;
  };
  const stop = (reason = "stopped") => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    ticker?.remove(tick);
    view?.removeEventListener?.("webglcontextlost", onContextLost);
    stripFilter();
    try { rain?.destroy({ children: true }); } catch { /* scene already destroyed */ }
    fallback?.stop();
    if (mesh && !mesh.destroyed) {
      mesh.alpha = preview ? originalAlpha : (token.alpha ?? 1)*(token.document.alpha ?? originalDocumentAlpha);
    }
    if (active.get(key) === handle) active.delete(key);
    resolveFinished({ reason });
  };
  const startFallback = error => {
    warn(error);
    stripFilter();
    try { rain?.destroy({ children: true }); } catch { /* no-op */ }
    rain = null;
    if (!layer || !mesh || mesh.destroyed) return;
    try { fallback = TransporterVFX.visualFallback(token, type, { ...settings, seed }); }
    catch (error) { console.warn("STA2e Toolkit | Transporter visual fallback failed", error); }
  };
  const handle = { finished, stop, operationId: options.operationId, get preview() { return preview; } };
  const onContextLost = () => stop("context-lost");
  const tick = () => {
    if (done) return;
    const elapsed = Math.max(0, transporterNow()-startTime);
    const t = transporterTimeline(elapsed, settings.duration, phase);
    const accents = transporterAccents(t.progress, settings.accent);
    if (t.complete) { stop("complete"); return; }
    if (canvas.scene !== scene || !canvas.ready) { stop("scene-change"); return; }
    if (!mesh || mesh.destroyed || token.destroyed) {
      if (phase === "out" && t.commit) departed = true;
      else { stop("token-destroyed"); return; }
    }
    try {
      const visible = departed ? lastVisible : (!token.document.hidden || game.user.isGM) && token.visible !== false && mesh.visible !== false;
      lastVisible = visible;
      if (rain) rain.visible = visible;
      fallback?.setVisible(visible);
      if (!departed) {
        // Core refreshes this value from document.alpha; maintain only while this handle owns it.
        mesh.alpha = (token.alpha ?? 1) * targetAlpha * (filter ? 1 : t.matter);
        if (filter) {
          if (!(mesh.filters ?? []).includes(filter)) mesh.filters = [...(mesh.filters ?? []), filter];
          Object.assign(filter.uniforms, { uTime: elapsed/1000, uMatter: t.matter, uEnergy: t.surfaceEnergy, uScan: accents.scan });
        }
        if (rain) {
          const b = artworkBounds(mesh, layer, token);
          const head = settings.framing === "portrait" ? .12 : .65;
          // Include the complete circular outline even for tall/narrow figures.
          let marginX = accents.circle ? Math.max(b.width*.12,Math.max(b.width,b.height)*.63-b.width*.5) : b.width*.16;
          let marginTop = accents.circle ? Math.max(b.height*.12,Math.max(b.width,b.height)*.63-b.height*.5) : b.height*head;
          let marginBottom = accents.circle ? marginTop : b.height*.16;
          if (settings.accent === "tmp") {
            const unit = Math.max(1,Math.min(b.width,b.height)*.01);
            const coreWidth = 4*settings.swipeWidth/100*unit;
            // The halo reaches zero at fourteen core widths; reserve it even
            // at the widest setting and the end of the horizontal sweep.
            marginX = Math.max(marginX,b.width*.1+14*coreWidth);
            marginTop = Math.max(marginTop,b.height*(settings.swipeHeight/200-.5)+unit*4);
            marginBottom = Math.max(marginBottom,marginTop);
          }
          if (settings.accent === "romulan") {
            const halo = 28*Math.max(1,Math.min(b.width,b.height)*.01);
            marginX = Math.max(marginX,halo);
            marginTop = Math.max(b.height*.12,halo);
            marginBottom = marginTop;
          }
          const width = b.width+marginX*2, height = b.height+marginTop+marginBottom;
          rain.position.set(b.x-marginX, b.y-marginTop);
          rain.scale.set(width, height);
          rain.shader.uniforms.uArtRect = [marginX/width,marginTop/height,b.width/width,b.height/height];
          rain.shader.uniforms.uSize = [b.width,b.height];
          if (filter) filter.uniforms.uSize = [b.width,b.height];
          rain.alpha = (token.alpha ?? 1)*targetAlpha;
        }
      }
      if (rain) Object.assign(rain.shader.uniforms, {
        uProgress: t.progress,
        uTime: elapsed/1000, uEnergy: t.energy, uOrbs: accents.orbs, uCircle: accents.circle, uLines: accents.lines, uScan: accents.scan,
      });
      fallback?.update(t, elapsed, accents);
    } catch (error) {
      if (filter || rain) startFallback(error);
      else { stop("render-error"); }
    }
  };
  active.set(key, handle);
  try {
    if (!mesh || !layer) throw new Error("Token mesh not ready");
    ({ filter, rain } = createShaderParts(token, settings, seed));
    rain.zIndex = Math.max(900000, (token.zIndex ?? 0)+10000);
    layer.sortableChildren = true;
    layer.addChild(rain);
  } catch (error) { startFallback(error); }
  tick();
  if (!done) {
    ticker?.add(tick);
    view?.addEventListener?.("webglcontextlost", onContextLost);
    timer = setTimeout(() => stop("complete"), Math.max(0,startTime+settings.duration-transporterNow())+100);
  }
  return handle;
}

export function stopTransporterShaders({ previewsOnly = false, operationId, reason = "stopped" } = {}) {
  for (const handle of [...active.values()]) {
    if (previewsOnly && !handle.preview) continue;
    if (operationId && handle.operationId !== operationId) continue;
    handle.stop(reason);
  }
}
export function releaseTransporterShaders() {
  stopTransporterShaders({ reason: "scene-change" });
  warned = false;
}
export function previewTransporterShader(type = "tngFed", phase = "out", options = {}) {
  const tokens = canvas.tokens?.controlled ?? [];
  if (!tokens.length) { ui.notifications.warn("Select a token to preview the transporter."); return []; }
  return tokens.slice(0, 6).map(token => playTransporterShader(token, type, { ...options, phase, preview: true })).filter(Boolean);
}
