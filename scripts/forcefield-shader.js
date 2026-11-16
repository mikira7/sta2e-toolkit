/**
 * sta2e-toolkit | forcefield-shader.js
 *
 * The forcefield door shader: one QuadMesh per forcefield wall, turned onto the
 * wall and stretched along it (forcefield-data.js `wallQuad`). Built the way
 * water-shader.js and beam-shader.js are, for the same reasons:
 *
 *  - the class is made LAZILY — `foundry.canvas.rendering.shaders` is not there
 *    when an ES module evaluates at init;
 *  - every uniform is declared in `defaultUniforms` (AbstractBaseShader.create
 *    merges with `insertKeys: false`, so an undeclared one is dropped silently);
 *  - the typed-array uniform is re-allocated per instance in `_configure`, since
 *    the defaults hand it over by reference;
 *  - world alpha reaches the shader only through `_preRender`;
 *  - output is PREMULTIPLIED, and mostly light: the colour is far brighter than
 *    the alpha, so normal blending adds it over the floor while a faint veil
 *    keeps it readable on a pale map.
 *
 * Everything inside works in px along (a) and across (c) the wall, so the
 * pattern keeps its size however long the wall is.
 */

export const FF_MAX_HITS = 4;

const VERT = `
attribute vec2 aVertexPosition;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}
`;

// GLSL ES 1.00. No backticks in here: this is a JS template literal.
const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uAlpha;
uniform float uTime;
uniform float uLen;       // quad length, px (wall + both pads)
uniform float uThick;     // quad width, px
uniform float uPad;       // px of quad before the wall's first end
uniform float uSeg;       // wall length, px
uniform float uGrid;      // px per grid square
uniform vec3  uColor;
uniform vec3  uCore;
uniform float uPower;     // 0 down .. 1 up
uniform float uFlash;     // 0..1 the snap as a field collapses
uniform float uIntensity; // 0..1
uniform float uPattern;   // 0 hex, 1 bands, 2 plasma
uniform float uSeed;
uniform vec4  uHits[${FF_MAX_HITS}];  // [along px, across px, age s, strength]

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, 512.0));
  float b = hash12(mod(i + vec2(1.0, 0.0), 512.0));
  float c = hash12(mod(i + vec2(0.0, 1.0), 512.0));
  float d = hash12(mod(i + vec2(1.0, 1.0), 512.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Distance to the nearest hexagon edge, 0 on the edge, ~0.5 at a centre.
float hexEdge(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p + s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 h = abs(g);
  return 0.5 - max(dot(h, normalize(s)), h.x);
}

void main() {
  float a = vUv.x * uLen - uPad;           // px along the wall, 0 at its first end
  float c = (vUv.y - 0.5) * uThick;        // px across, 0 on the line
  float halfW = uThick * 0.5;
  float t = mod(uTime, 3600.0);
  float p = clamp(uPower, 0.0, 1.0);

  // The field collapses to its emitter line as it drains.
  float w = halfW * mix(0.06, 1.0, p);
  float dx = max(max(-a, a - uSeg), 0.0);  // px past an end, 0 along the wall
  float inside = 1.0 - smoothstep(0.0, w * 0.35, dx);

  // ── Across-profile ───────────────────────────────────────────────────────
  float ac = abs(c);
  // Half strength at half the width, plus a soft halo out to the quad's edge.
  float body = exp(-(ac * ac) / (w * w * 0.36)) * inside;
  float halo = exp(-ac / (w * 0.45)) * inside;
  float coreW = max(1.2, w * 0.08);
  float core = exp(-(ac * ac) / (coreW * coreW)) * inside;

  // ── Pattern ──────────────────────────────────────────────────────────────
  vec2 q = vec2(a, c);
  float pat;
  if (uPattern < 0.5) {
    // Hexagonal cells with a shimmer drifting along them.
    float cell = max(uGrid * 0.075, 4.0);
    float e = hexEdge(q / cell + vec2(t * 0.15, 0.0));
    float edge = 1.0 - smoothstep(0.0, 0.09, e);
    float sh = vnoise(q / (uGrid * 0.35) + vec2(t * 0.6, uSeed * 13.0));
    pat = 0.18 + edge * (0.35 + 0.9 * sh);
  } else if (uPattern < 1.5) {
    // Brig: fine bands across the field, rippling.
    float k = a / max(uGrid * 0.045, 3.0) + sin(c / max(halfW, 1.0) * 3.0 + t * 2.0) * 0.6;
    float band = pow(0.5 + 0.5 * sin(k * 6.2832 - t * 1.4), 6.0);
    float sh = vnoise(q / (uGrid * 0.3) + vec2(-t * 0.8, uSeed * 7.0));
    pat = 0.22 + band * (0.55 + 0.6 * sh);
  } else {
    // Plasma: churning noise, two octaves going opposite ways.
    float n1 = vnoise(q / (uGrid * 0.22) + vec2(t * 0.7, -t * 0.3) + uSeed * 5.0);
    float n2 = vnoise(q / (uGrid * 0.09) + vec2(-t * 1.3, t * 0.5) + uSeed * 9.0);
    float n = n1 * 0.65 + n2 * 0.35;
    pat = 0.15 + smoothstep(0.42, 0.8, n) * 1.2;
  }

  // A brighter pulse running along the field.
  float pulse = pow(0.5 + 0.5 * sin(a / (uGrid * 0.6) * 6.2832 * 0.5 - t * 2.4 + uSeed * 6.0), 10.0);

  // ── Contact flares ───────────────────────────────────────────────────────
  float hit = 0.0;
  for (int i = 0; i < ${FF_MAX_HITS}; i++) {
    vec4 h = uHits[i];
    if (h.w <= 0.0) continue;
    float age = h.z;
    float fade = h.w * clamp(1.0 - age / 1.1, 0.0, 1.0);
    float dist = length(vec2(a - h.x, (c - h.y) * 1.6));
    float radius = age * uGrid * 1.3;
    float ring = exp(-pow((dist - radius) / (uGrid * 0.07), 2.0));
    float glow = exp(-dist / (uGrid * 0.22)) * clamp(1.0 - age * 2.2, 0.0, 1.0);
    hit += (ring * 0.9 + glow * 1.4) * fade;
  }
  hit *= body * 1.4 + core * 0.4;

  // ── Emitter nodes at each end ────────────────────────────────────────────
  float n0 = length(vec2(a, c));
  float n1e = length(vec2(a - uSeg, c));
  float nr = max(halfW * 0.16, 2.0);
  float node = exp(-min(n0, n1e) / nr);
  float idle = 0.28 + 0.72 * p;

  // ── Compose (premultiplied) ──────────────────────────────────────────────
  float shimmer = 0.9 + 0.1 * sin(t * 7.0 + uSeed * 3.0);
  vec3 col = uColor * body * (pat + pulse * 0.45) * p * shimmer
           + uColor * halo * 0.22 * p
           + uCore * core * (0.9 * p + uFlash * 2.2)
           + uColor * hit
           + uCore * node * idle * 0.9;
  col *= 0.35 + 0.85 * uIntensity;
  // The veil dims the floor under the body before the light is added, which is
  // what keeps the colour on a pale map; at 0.22 the field washed out to white.
  float veil = body * 0.55 * p + halo * 0.12 * p + node * 0.25 * idle;
  float master = clamp(uAlpha, 0.0, 1.0);
  vec3 pre = col * master;
  float al = clamp(veil, 0.0, 1.0) * master;
  if (max(max(pre.r, pre.g), max(pre.b, al)) < 0.004) discard;
  gl_FragColor = vec4(pre, al);
}
`;

/** The GLSL, for tests/forcefield-browser.html (a raw-WebGL preview). */
export const FF_VERT = VERT;
export const FF_FRAG = FRAG;

let _cls = null;

function _shaderClass() {
  if (_cls) return _cls;
  const Base = foundry?.canvas?.rendering?.shaders?.AbstractBaseShader;
  if (!Base) return null;
  class Sta2eForcefieldShader extends Base {
    static _createVertexShader() { return VERT; }
    static _createFragmentShader() { return FRAG; }
    static defaultUniforms = {
      uAlpha: 1,
      uTime: 0,
      uLen: 100,
      uThick: 30,
      uPad: 15,
      uSeg: 70,
      uGrid: 100,
      uColor: [0.3, 0.6, 1],
      uCore: [0.85, 0.92, 1],
      uPower: 1,
      uFlash: 0,
      uIntensity: 0.8,
      uPattern: 0,
      uSeed: 0,
      uHits: new Float32Array(FF_MAX_HITS * 4),
    };
    _configure(_options) { this.uniforms.uHits = new Float32Array(FF_MAX_HITS * 4); }
    _preRender(mesh, _renderer) { this.uniforms.uAlpha = mesh.worldAlpha; }
  }
  _cls = Sta2eForcefieldShader;
  return _cls;
}

let _probed = null;
let _warned = false;

/** Can this client draw the forcefield shader? Probed once per canvas. */
export function forcefieldShaderAvailable() {
  if (_probed !== null) return _probed;
  _probed = false;
  try {
    const r = canvas?.app?.renderer;
    if (!r?.gl || r.gl.isContextLost?.()) throw new Error("no-gl");
    if (!foundry?.canvas?.containers?.QuadMesh) throw new Error("no-quadmesh");
    if (!_shaderClass()) throw new Error("no-base-shader");
    _probed = true;
  } catch (err) {
    _warnOnce("Forcefield shader unavailable; drawing a plain glow line instead.", err?.message ?? err);
  }
  return _probed;
}

function _warnOnce(msg, detail) {
  if (_warned) return;
  _warned = true;
  console.warn(`STA2e Toolkit | ${msg}`, detail);
}

/** Forget the probe (canvasTearDown): a new canvas is a new GL context. */
export function resetForcefieldShaderProbe() { _probed = null; }

/** A fresh QuadMesh carrying the forcefield shader, or null. */
export function createForcefieldMesh() {
  if (!forcefieldShaderAvailable()) return null;
  try {
    return new foundry.canvas.containers.QuadMesh(_shaderClass());
  } catch (err) {
    _probed = false;
    _warnOnce("Forcefield shader failed to build; drawing a plain glow line instead.", err);
    return null;
  }
}
