/**
 * sta2e-toolkit | beam-shader.js
 *
 * A fragment shader for the native energy weapon beams.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every native beam in the module is a stroked `PIXI.Graphics` line under one
 * `GlowFilter`. A stroke has no interior: no hot core against a cooler sheath,
 * no turbulence, no energy visibly travelling toward the target, and a hard
 * square cut at both ends. All of that is a fragment shader's natural job and
 * none of it is reachable from `lineStyle`.
 *
 * A LEAF, DELIBERATELY
 * --------------------
 * Imports exactly one module — `starfield-common.js`, which imports nothing.
 * `native-weapon-vfx.js` already pulls ship-vfx-anchors -> shield-impact-vfx ->
 * shield-bubble-vfx, and `ground-phaser-vfx.js` sits beside it; both need this
 * and neither may end up importing the other. Same reasoning as `scene-warp.js`.
 *
 * PIXI VERSION
 * ------------
 * Foundry v14 (14.365) bundles **PIXI 7.4.3**, and ships it *without* the Canvas
 * renderer — so the renderer is always WebGL or the canvas never becomes ready
 * at all. Everything here is still probed rather than version-sniffed, matching
 * the rest of the module: on any failure `beamShaderAvailable()` returns false
 * once and forever and every caller falls back to the Graphics draw it had.
 *
 * BUILT ON FOUNDRY'S OWN PRIMITIVES
 * ---------------------------------
 * `foundry.canvas.containers.QuadMesh` is a unit quad driven by an
 * `AbstractBaseShader` subclass, maintained by core, that owns its geometry and
 * disposes it on destroy. Three of its details are load-bearing here:
 *
 *  1. `QuadMesh#_render` calls `this.#shader._preRender(this, renderer)` — the
 *     only hook we get, and the ONLY place world alpha can be applied (below).
 *  2. `AbstractBaseShader.create` merges uniforms with `insertKeys: false`, so
 *     **any uniform missing from `defaultUniforms` is silently dropped**. That is
 *     the easiest way to lose one here; every uniform below is declared there.
 *  3. `_render` calls `renderer.batch.flush()` before each draw. One mesh per
 *     bolt would flush the batcher once per bolt per frame — worse than the
 *     strokes it replaces — which is why a whole tracer volley is ONE quad with
 *     a `uBolts` array rather than one quad each.
 *
 * WORLD ALPHA IS THE TRAP
 * -----------------------
 * `QuadMesh#_render` writes only `translationMatrix`. It never applies
 * `worldAlpha` — so `_fadeContainer`'s `_tween(container, {alpha: 0, ...})`,
 * which is how *every* effect in this module dies, would not fade a shaded beam
 * at all; it would simply vanish when the container is destroyed. `_preRender`
 * copying `mesh.worldAlpha` into `uAlpha` is what keeps the existing hold/fade/
 * easing dials working untouched.
 */

import { buildNoiseTexture } from "./starfield-common.js";

// ── Tunable dials ───────────────────────────────────────────────────────────
// Canonical here, imported by `native-weapon-vfx.js` into DEFAULT_BEAM_VFX_SETTINGS
// and BEAM_VFX_RANGES, so the GLSL and the numbers that drive it cannot drift
// apart across two files. Same arrangement as GROUND_PHASER_ERA_ROWS.
//
// EVERY FIELD IS A NUMBER ON PURPOSE. `normalizeBeamVfxSettings` understands
// numbers, colour strings and three hard-coded enum field names — a boolean
// "enabled" would need the normalizer changed. `glowSize: 0` follows the
// precedent `shared.glowSize` already sets: zero switches the pass off.

export const BEAM_SHADER_DEFAULTS = Object.freeze({
  // Quad half-width as a multiple of the family's widest stroke. The shader
  // draws its own halo inside the quad, so it needs more room than the line it
  // replaces — and scaling the family's own dials means a world that has tuned
  // its arrays keeps those widths meaning something.
  widthScale: 1.6,
  // Transverse profile.
  coreSharpness: 2.2,
  haloSoftness: 2.6,
  // Turbulence. `noiseScale` is cells per 100 CANVAS PIXELS, not per beam, so a
  // point-blank shot and a cross-map shot boil at the same visual scale. In UV
  // the long shot would be fine speckle and the short one blobs.
  noiseAmount: 0.45,
  noiseScale: 3.0,
  noiseSpeed: 1.6,
  // The travelling brightness band — the single biggest reason a shaded beam
  // reads as powered rather than merely lit. 0 pulses means one surge per shot,
  // driven by elapsed time rather than repeating.
  surgeCount: 2,
  surgeSpeed: 1.4,
  surgeWidth: 0.12,
  surgeStrength: 0.55,
  // Irregular current fluctuations, interpolated between samples so high
  // frame-rate playback does not turn into a hard strobe.
  flicker: 0.18,
  flickerRate: 22,
  // Replaces the round line cap `_drawLine` gave for free. Without it the quad's
  // square corners show at the emitter and at the hull.
  endTaper: 0.06,
  // Bolt silhouette (the bolts program only — a held beam has no ends to shape).
  // Half-width along the bolt is s^boltTail * (1-s)^boltNose, so the widest
  // point lands at boltTail/(boltTail+boltNose): 0.9 and 0.28 put it about three
  // quarters of the way to the nose, giving a drawn-out tail and a blunt round
  // front. Equal values make it a symmetric lens; a large boltNose flips the
  // mass to the back, which reads as travelling the wrong way.
  boltTail: 0.9,
  boltNose: 0.28,
  bloom: 0.7,
  // An OPTIONAL extra GlowFilter over the shaded beam, off by default — the
  // shader is already its own glow. Raise it only to make the bloom bleed past
  // the quad. The muzzle and impact discs keep the existing shared glow either
  // way; they are hard-edged Graphics and genuinely need it.
  glowSize: 0,
});

export const BEAM_SHADER_RANGES = Object.freeze({
  "shader.widthScale": [0.5, 6],
  "shader.coreSharpness": [0.5, 8],
  "shader.haloSoftness": [0.5, 8],
  "shader.noiseAmount": [0, 1],
  "shader.noiseScale": [0.2, 20],
  "shader.noiseSpeed": [0, 12],
  "shader.surgeCount": [0, 12],
  "shader.surgeSpeed": [0, 12],
  "shader.surgeWidth": [0.01, 0.5],
  "shader.surgeStrength": [0, 2],
  "shader.flicker": [0, 1],
  "shader.flickerRate": [1, 90],
  "shader.endTaper": [0, 0.5],
  "shader.boltTail": [0.05, 4],
  "shader.boltNose": [0.05, 4],
  "shader.bloom": [0, 3],
  "shader.glowSize": [0, 40],
});

/** Ceiling on the bolt array. Matches the existing boltCount clamp of [1, 24]. */
const MAX_BOLTS = 24;

// ── GLSL ────────────────────────────────────────────────────────────────────
// GLSL ES 1.00 (WebGL 1 safe): `varying`, `gl_FragColor`, no textureLod, no
// dynamic array indexing, no `break` in the bolt loop.

const VERT = `
attribute vec2 aVertexPosition;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;

void main() {
  // QuadMesh's geometry is the unit square, so the vertex position IS the UV:
  // x runs emitter -> target, y runs across the beam.
  vUv = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}
`;

// Deliberately NO screen-space uniforms anywhere in these programs: if an
// ancestor container ever carries a filter the subtree renders into an offscreen
// target with a different projection, and any screen-space term would be
// silently wrong. Everything is expressed in the beam's own UV space.
const FRAG_HEAD = `
varying vec2 vUv;

uniform sampler2D uNoise;
uniform vec3  uColor;      // sheath colour
uniform vec3  uCoreColor;  // hot centre colour
uniform float uAlpha;      // = mesh.worldAlpha, written in _preRender
uniform float uTime;       // seconds since this shot started
uniform float uSeed;
uniform vec2  uSize;       // [lengthPx, widthPx]
uniform float uCore;       // core half-width / quad half-width
uniform float uCoreSharp;
uniform float uHaloSoft;
uniform vec2  uRail;       // [centre, half-width] as fractions; y == 0 disables
uniform vec3  uNoiseCfg;   // [amount, cells per 100px, cells per second]
uniform vec4  uSurge;      // [count, speed, width, strength]
uniform vec2  uFlicker;    // [amount, Hz]
uniform float uTaper;
uniform float uBloom;

float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453123); }

float lobe(float d, float c, float w, float sharp) {
  float t = (d - c) / max(w, 1e-4);
  return exp(-t * t * sharp);
}
`;

// The shared body: everything that does not depend on whether this is a held
// beam or a volley of bolts. Leaves `halo`, `core`, `rails`, `turb`, `surge`
// and `fl` in scope for the two programs below.
const FRAG_BODY = `
  float u = vUv.x;
  float v = (vUv.y - 0.5) * 2.0;
  float d = abs(v);

  // Turbulence scrolling toward the target. Two reads of one tiling texture,
  // the same construction _fbm uses and for the same reason. The cell count is
  // derived from the beam's PIXEL length so the boil is the same visual size at
  // every range — in UV a cross-map shot would be fine speckle and a
  // point-blank one would be blobs.
  float cells = uNoiseCfg.y * uSize.x * 0.01;
  vec2  nUv   = vec2(u * cells - uTime * uNoiseCfg.z, v * 0.5 + uSeed * 7.0);
  float n     = texture2D(uNoise, nUv).r * 0.65
              + texture2D(uNoise, nUv * 2.13 + vec2(0.37, uSeed)).r * 0.35;
  // Fine, stretched filaments ride a slower, broader plasma envelope.
  // Displacing only the sheath leaves a stable coherent centre to read.
  float fine  = texture2D(uNoise, nUv * vec2(0.43, 3.7) + vec2(n * 0.28, uTime * 0.11)).r;
  float turb  = mix(1.0, n * 1.7, uNoiseCfg.x);

  // Transverse profile: a hot Gaussian core inside a soft power falloff. The
  // noise rides the SHEATH and never the core — the core is the coherent
  // channel, the sheath is what boils off it. One noise term over the whole
  // beam just looks like a dissolving gradient.
  float core  = lobe(d, 0.0, uCore, uCoreSharp);
  float sheathD = abs(v + (n - 0.5) * 0.11 * uNoiseCfg.x);
  float halo  = pow(max(0.0, 1.0 - sheathD), uHaloSoft)
              * mix(1.0, 0.72 + fine * fine * 1.25, uNoiseCfg.x);
  float rails = uRail.y > 0.0 ? lobe(d, uRail.x, uRail.y, 4.0) * 0.6 : 0.0;

  // Travelling surge. count == 0 means a single surge per shot, driven by uTime.
  float sT    = uSurge.x > 0.0 ? fract(u * uSurge.x - uTime * uSurge.y)
                               : abs(u - uTime * uSurge.y);
  // Wrap the distance too, so a repeating surge has a soft leading edge
  // across the phase seam instead of a hard, rectangular brightness step.
  if (uSurge.x > 0.0) sT = min(sT, 1.0 - sT);
  float sw    = max(uSurge.z, 1e-3);
  float surge = exp(-(sT * sT) / (sw * sw)) * uSurge.w;

  float frame = uTime * max(uFlicker.y, 1.0);
  float fl = 1.0 - uFlicker.x * mix(hash11(floor(frame) + uSeed * 31.0),
    hash11(floor(frame) + 1.0 + uSeed * 31.0), smoothstep(0.0, 1.0, fract(frame)));
`;

// Held beam: banks, arrays, lances, ground phasers.
const FRAG_BEAM = `${FRAG_HEAD}
void main() {
${FRAG_BODY}
  // Soft ends, so the quad's corners never show.
  float ends = smoothstep(0.0, max(uTaper, 1e-4), u)
             * smoothstep(0.0, max(uTaper, 1e-4), 1.0 - u);

  float body = (halo + rails) * turb * 0.75 + core;
  float edge = 1.0 - smoothstep(0.86, 1.0, d);
  float density = (body + surge * (core * 0.55 + halo * 0.7)) * uBloom * ends * fl * edge;
  // Compress luminous energy before applying opacity: highlights keep detail
  // at high bloom settings and ancestor fades remain proportional.
  float a = (1.0 - exp(-density * 1.3)) * clamp(uAlpha, 0.0, 1.0);
  if (a <= 0.0) discard;
  vec3  col  = mix(uColor, uCoreColor, clamp(core * 0.95 + surge * core * 0.25, 0.0, 1.0));

  // PREMULTIPLIED. PIXI v7 maps BLEND_MODES.ADD to (gl.ONE, gl.ONE) for
  // premultiplied sources; emitting straight alpha here is the classic
  // "why is my beam a washed-out box" bug.
  gl_FragColor = vec4(col * a, a);
}
`;

// Bolt volley: tracers and cannons. One quad for the WHOLE volley — see the
// batch.flush() note in the file docblock.
const FRAG_BOLTS = `${FRAG_HEAD}
uniform vec3  uBolts[${MAX_BOLTS}];   // [headT, lengthT, brightness]
uniform float uBoltCount;
uniform vec3  uEgg;                   // [tail exponent, nose exponent, peak normaliser]

void main() {
${FRAG_BODY}
  // Each live bolt is an EGG: a drawn-out tail swelling to its widest point
  // forward of centre, then rounding off at the nose. A round is not a capsule —
  // the mass is at the front and the ionised tail streams off the back — and
  // that asymmetry is most of what tells a cannon round from a torpedo at a
  // glance.
  //
  // Half-width at station s is s^tail * (1-s)^nose, normalised by uEgg.z so the
  // widest point is exactly 1. The maximum sits at tail/(tail+nose), which with
  // the shipped exponents is about three quarters of the way to the nose.
  //
  // THE SHAPE IS ALSO THE WINDOW. That expression is already zero at both ends,
  // so the separate longitudinal smoothstep the old capsule needed is gone
  // rather than layered on top of this.
  //
  // No loop break, and uBolts is indexed only by the loop counter — both are
  // WebGL 1 Appendix A requirements.
  // (No backticks in here: this is a JS template literal, and one would end it.)
  float widest = 0.0;   // widest half-width claiming this station
  float amp    = 0.0;   // brightness of whichever bolt claims it
  float hot    = 0.0;   // 0 at the tail, 1 at the nose
  for (int i = 0; i < ${MAX_BOLTS}; i++) {
    float on   = step(float(i) + 0.5, uBoltCount);
    vec3  b    = uBolts[i];
    float tail = b.x - b.y;
    float s    = clamp((u - tail) / max(b.y, 1e-4), 0.0, 1.0);
    // pow() is undefined for a negative base; s is clamped, so both are safe.
    float w    = pow(s, uEgg.x) * pow(1.0 - s, uEgg.y) * uEgg.z * on;
    // max, not a sum: bolts are spaced along the path and do not overlap, and
    // summing would make any overlap bloom instead of merge.
    widest = max(widest, w);
    amp    = max(amp, w * b.z);
    hot    = max(hot, s * b.z * step(0.001, w));
  }
  if (amp <= 0.0) discard;

  // Transverse profile against the LOCAL half-width. This is why the bolts
  // recompute the core and sheath rather than using the constant-width pair
  // above — theirs narrows along the bolt, and that narrowing is the egg.
  float dd    = d / max(widest, 1e-3);
  float coreB = lobe(dd, 0.0, uCore, uCoreSharp);
  float haloB = pow(max(0.0, 1.0 - dd), uHaloSoft);

  float shell = lobe(dd, 0.42, 0.18, 2.5) * hot * 0.22;
  float body = (haloB * turb * mix(1.0, mix(0.6, 1.15, fine), uNoiseCfg.x) + shell
               + coreB * (0.5 + 0.7 * hot)) * amp;
  float edge = 1.0 - smoothstep(0.85, 1.0, dd);
  float a = (1.0 - exp(-(body + surge * coreB * amp * 0.3) * uBloom * fl * edge * 1.5))
          * clamp(uAlpha, 0.0, 1.0);
  if (a <= 0.0) discard;
  vec3  col  = mix(uColor, uCoreColor, clamp(coreB * (0.45 + hot * 0.55), 0.0, 1.0));

  gl_FragColor = vec4(col * a, a);
}
`;

// ── Shader classes ──────────────────────────────────────────────────────────
// These CANNOT be declared at module scope: `foundry.canvas.rendering.shaders`
// is not populated when an ES module evaluates at init, and QuadMesh throws
// unless the class already inherits from AbstractBaseShader. Built on first use
// and cached forever — PIXI.Program.from caches by source text behind them, so
// rebuilding would buy nothing anyway.

let _classes = null;

function _shaderClasses() {
  if (_classes) return _classes;
  const Base = foundry?.canvas?.rendering?.shaders?.AbstractBaseShader;
  if (!Base) return null;

  // Every uniform the GLSL declares MUST appear here. AbstractBaseShader.create
  // merges with `insertKeys: false`, so anything missing is dropped in silence.
  const shared = {
    uNoise: null,
    uColor: [1, 0.6, 0.2],
    uCoreColor: [1, 0.95, 0.75],
    uAlpha: 1,
    uTime: 0,
    uSeed: 0,
    uSize: [100, 10],
    uCore: 0.18,
    uCoreSharp: 2.2,
    uHaloSoft: 2.6,
    uRail: [0, 0],
    uNoiseCfg: [0.45, 3, 1.6],
    uSurge: [2, 1.4, 0.12, 0.55],
    uFlicker: [0.18, 22],
    uTaper: 0.06,
    uBloom: 0.7,
  };

  class Sta2eBeamShader extends Base {
    static _createVertexShader() { return VERT; }
    static _createFragmentShader() { return FRAG_BEAM; }
    static defaultUniforms = { ...shared };
    /** The only hook QuadMesh gives us, and the only place world alpha can land. */
    _preRender(mesh, _renderer) { this.uniforms.uAlpha = mesh.worldAlpha; }
  }

  class Sta2eBoltShader extends Base {
    static _createVertexShader() { return VERT; }
    static _createFragmentShader() { return FRAG_BOLTS; }
    static defaultUniforms = {
      ...shared,
      // A flat Float32Array of vec3s; PIXI uploads it as vec3[MAX_BOLTS].
      uBolts: new Float32Array(MAX_BOLTS * 3),
      uBoltCount: 0,
      // [tail exponent, nose exponent, peak normaliser] — see _eggShape.
      uEgg: [0.9, 0.28, 1.9],
    };

    /**
     * Give this instance its OWN bolt array.
     *
     * Both `foundry.utils.deepClone` and `mergeObject` — which
     * `AbstractBaseShader.create` runs the default uniforms through — pass a
     * Float32Array straight back BY REFERENCE, since it is neither a plain
     * object nor an Array. Without this every bolt shader ever created shares
     * the one array on the class, so two volleys in the air at once overwrite
     * each other's bolts and a finished volley keeps writing into a live one.
     *
     * `create` calls `_configure` right after construction, which is the first
     * point the instance exists.
     */
    _configure(_options) {
      this.uniforms.uBolts = new Float32Array(MAX_BOLTS * 3);
    }

    _preRender(mesh, _renderer) { this.uniforms.uAlpha = mesh.worldAlpha; }
  }

  _classes = { beam: Sta2eBeamShader, bolt: Sta2eBoltShader };
  return _classes;
}

// ── Capability probe ────────────────────────────────────────────────────────

let _probed = null;
const _warned = new Set();

function _warnOnce(key, err) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(`STA2e Toolkit | Beam shader unavailable (${key}); falling back to the stroked beam draw.`, err ?? "");
}

/**
 * Can this client draw a shaded beam? Probed once and cached.
 *
 * This is the ONLY place the shader/Graphics fallback is decided; everything
 * else asks here or checks `createBeamRibbon` for null. Reset on `canvasReady`,
 * because that is a new renderer and a new GL context — but the shader classes
 * and PIXI's own ProgramCache are deliberately NOT reset with it, since
 * re-linking is the expensive part.
 */
export function beamShaderAvailable() {
  if (_probed !== null) return _probed;
  _probed = false;
  try {
    const r = canvas?.app?.renderer;
    // Foundry ships PIXI without the Canvas renderer, so a non-WebGL renderer
    // cannot occur — but a LOST context can, and every caller already bails on
    // !canvas?.ready before reaching here.
    if (!r?.gl || r.gl.isContextLost?.()) { _warnOnce("no-gl"); return _probed; }
    if (!globalThis.PIXI?.State || !globalThis.PIXI?.Program) { _warnOnce("no-pixi"); return _probed; }
    if (!foundry?.canvas?.containers?.QuadMesh) { _warnOnce("no-quadmesh"); return _probed; }
    if (!_shaderClasses()) { _warnOnce("no-base-shader"); return _probed; }
    // WebGL 1 guarantees only 16 fragment uniform vectors; the bolt program
    // wants roughly 40. Every desktop GPU reports 224+, but this is what makes
    // a weak one degrade instead of failing to link.
    const slots = r.gl.getParameter(r.gl.MAX_FRAGMENT_UNIFORM_VECTORS);
    if (!(slots >= 64)) { _warnOnce(`uniform-slots-${slots}`); return _probed; }
    _probed = true;
  } catch (err) {
    _warnOnce("probe", err);
  }
  return _probed;
}

// ── Shared noise texture ────────────────────────────────────────────────────
// One 128x128 upload for every beam ever drawn. NEVER destroyed, not even on
// canvasTearDown — the same rule the viewscreen's image cache follows. PIXI
// re-uploads it from the source canvas after a context loss for free.

let _noise = null;

function _noiseTexture() {
  if (_noise) return _noise;
  // Integer `features` is what makes it tile; see buildNoiseTexture's docblock.
  _noise = buildNoiseTexture({ size: 128, octaves: 4, features: 4, contrast: 1 });
  return _noise;
}

// ── The ribbon ──────────────────────────────────────────────────────────────

const _live = new Set();

function _rgb(color, fallback) {
  const c = Number.isFinite(color) ? color : fallback;
  return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];
}

function _num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The bolt silhouette, as the shader wants it: `[tail, nose, normaliser]`.
 *
 * Half-width along the bolt is `s^tail * (1-s)^nose`, whose maximum sits at
 * `tail/(tail+nose)` and is worth `s*^tail * (1-s*)^nose`. The normaliser is the
 * reciprocal of that, so the widest point of ANY exponent pair comes out at
 * exactly 1 — which is what stops a shape change from also changing how fat the
 * bolt is, and keeps `widthScale` the only control over that.
 */
function _eggShape(dials) {
  const tail = Math.max(0.05, _num(dials?.boltTail, 0.9));
  const nose = Math.max(0.05, _num(dials?.boltNose, 0.28));
  const peakAt = tail / (tail + nose);
  const peak = Math.pow(peakAt, tail) * Math.pow(1 - peakAt, nose);
  return [tail, nose, 1 / Math.max(1e-4, peak)];
}

function _place(mesh, from, to, widthPx) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const w = Math.max(1, widthPx);
  mesh.position.set(from.x, from.y);
  mesh.rotation = Math.atan2(dy, dx);
  // A zero-length beam would collapse the quad and divide by nothing in the end
  // tapers; one pixel keeps it degenerate but valid.
  mesh.scale.set(len, w);
  try { mesh.shader.uniforms.uSize = [len, w]; } catch { /* mid-teardown */ }
}

/**
 * A shaded beam laid between two canvas points, added to `parent`.
 *
 * Returns **null** whenever the shader cannot be built, so every call site reads
 * `const ribbon = createBeamRibbon(...); if (!ribbon) { <the stroked draw> }`.
 *
 * The handle owns its own ticker with the module's standard shape — a `finished`
 * guard, `ticker.remove` in cleanup and a `setTimeout` backstop — plus a
 * `mesh.destroyed` guard, because `_fadeContainer` destroys the container on a
 * timer of its own and the mesh can go out from under us on any frame.
 *
 * This is a genuinely new cost for the held beams: `_beamShot` and `_arrayBeam`
 * have no ticker at all today. It is unavoidable, since `uTime` has to advance,
 * and it is the same order `_tracerVolley` already pays.
 *
 * @param {PIXI.Container} parent
 * @param {object} spec
 * @param {"beam"|"bolts"} spec.mode
 * @param {{x:number,y:number}} spec.from      emitter
 * @param {{x:number,y:number}} spec.to        target
 * @param {number} spec.halfWidth              quad half-width in canvas px, pre-scaled
 * @param {number} spec.color                  sheath colour, 24-bit
 * @param {number} spec.coreColor              core colour, 24-bit
 * @param {object} spec.shader                 the resolved `shader` settings group
 * @param {{core:number, rail:number[]}} spec.profile  px, from the family's own group
 * @param {number} spec.lifetimeMs
 * @param {number|string} [spec.blendMode]
 */
export function createBeamRibbon(parent, {
  mode = "beam", from, to, halfWidth = 6,
  color = 0xff9a33, coreColor = 0xfff2c0,
  shader = null, profile = null, lifetimeMs = 600, blendMode = null,
} = {}) {
  if (!parent || !beamShaderAvailable()) return null;
  if (!Number.isFinite(from?.x) || !Number.isFinite(from?.y)) return null;
  if (!Number.isFinite(to?.x) || !Number.isFinite(to?.y)) return null;

  const cfg = { ...BEAM_SHADER_DEFAULTS, ...(shader ?? {}) };
  const half = Math.max(1, _num(halfWidth, 6));

  let mesh = null;
  try {
    const classes = _shaderClasses();
    const QuadMesh = foundry.canvas.containers.QuadMesh;
    mesh = new QuadMesh(mode === "bolts" ? classes.bolt : classes.beam);

    const u = mesh.shader.uniforms;
    u.uNoise = _noiseTexture();
    u.uColor = _rgb(color, 0xff9a33);
    u.uCoreColor = _rgb(coreColor, 0xfff2c0);
    u.uSeed = Math.random();
    // Core and rails arrive in pixels and are expressed against the quad's own
    // half-width, so the family's existing width dials keep meaning something.
    u.uCore = Math.min(1, Math.max(0.01, _num(profile?.core, half * 0.25) / half));
    u.uCoreSharp = _num(cfg.coreSharpness, 2.2);
    u.uHaloSoft = _num(cfg.haloSoftness, 2.6);
    const railOffset = _num(profile?.rail?.[0], 0);
    const railWidth = _num(profile?.rail?.[1], 0);
    u.uRail = railWidth > 0
      ? [Math.min(1, railOffset / half), Math.min(1, (railWidth * 0.5) / half)]
      : [0, 0];
    u.uNoiseCfg = [_num(cfg.noiseAmount, 0.45), _num(cfg.noiseScale, 3), _num(cfg.noiseSpeed, 1.6)];
    u.uSurge = [
      _num(cfg.surgeCount, 2), _num(cfg.surgeSpeed, 1.4),
      _num(cfg.surgeWidth, 0.12), _num(cfg.surgeStrength, 0.55),
    ];
    u.uFlicker = [_num(cfg.flicker, 0.18), _num(cfg.flickerRate, 22)];
    u.uTaper = _num(cfg.endTaper, 0.06);
    u.uBloom = _num(cfg.bloom, 0.7);
    // Bolts only; the beam program declares no such uniform, and writing one it
    // does not have would be silently dropped anyway.
    if (mode === "bolts") u.uEgg = _eggShape(cfg);

    // The unit quad spans 0..1 in both axes, so pivoting at y = 0.5 centres the
    // strip on the line and `scale` becomes (length, full width) directly.
    mesh.pivot.set(0, 0.5);
    if (blendMode !== null && blendMode !== undefined) mesh.blendMode = blendMode;
    _place(mesh, from, to, half * 2);

    parent.addChild(mesh);
  } catch (err) {
    _probed = false;
    _warnOnce("create", err);
    try { mesh?.destroy?.(); } catch { /* no-op */ }
    return null;
  }

  const ticker = canvas.app?.ticker;
  const start = performance.now();
  let finished = false;
  let timer = null;

  const stop = () => {
    if (finished) return;
    finished = true;
    _live.delete(handle);
    try { ticker?.remove?.(tick); } catch { /* no-op */ }
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const tick = () => {
    // _fadeContainer destroys the container on its own timer, so the mesh can
    // go out from under us at any frame.
    if (mesh.destroyed || !mesh.parent) { stop(); return; }
    try {
      mesh.shader.uniforms.uTime = (performance.now() - start) / 1000;
    } catch {
      stop();
    }
  };

  const handle = {
    mesh,
    /** Retarget the ribbon — three property writes, no rebuild. */
    setSegment(a, b, widthPx) {
      if (finished || mesh.destroyed) return;
      _place(mesh, a, b, Number.isFinite(widthPx) ? widthPx : half * 2);
    },
    /**
     * `bolts` is a list of `{head, length, brightness}` in normalised path
     * space. Written into one flat array; anything past `uBoltCount` is ignored
     * by the shader rather than needing to be cleared.
     */
    setBolts(bolts) {
      if (finished || mesh.destroyed) return;
      try {
        const arr = mesh.shader.uniforms.uBolts;
        if (!arr) return;
        const n = Math.min(MAX_BOLTS, bolts?.length ?? 0);
        for (let i = 0; i < n; i++) {
          const b = bolts[i];
          arr[i * 3] = _num(b?.head, 0);
          arr[i * 3 + 1] = Math.max(1e-4, _num(b?.length, 0.05));
          arr[i * 3 + 2] = Math.max(0, _num(b?.brightness, 1));
        }
        mesh.shader.uniforms.uBoltCount = n;
      } catch { /* mid-teardown */ }
    },
    stop,
  };

  tick();
  if (ticker?.add) ticker.add(tick);
  // Backstop in case the ticker is unavailable or the container outlives its own
  // fade. `stop` is idempotent.
  timer = setTimeout(stop, Math.max(120, _num(lifetimeMs, 600)) + 250);
  _live.add(handle);
  return handle;
}

/**
 * Drop every live ribbon and re-probe.
 *
 * Called on `canvasTearDown`, where the token layer — and every mesh under it —
 * is destroyed out from under us. The noise texture and the shader classes are
 * deliberately kept: both survive a teardown, and rebuilding them would force a
 * GLSL recompile on the next shot for nothing.
 */
export function releaseBeamShaderCache() {
  for (const handle of [..._live]) {
    try { handle.stop(); } catch { /* no-op */ }
  }
  _live.clear();
  _probed = null;
}
