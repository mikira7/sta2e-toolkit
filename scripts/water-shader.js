/**
 * sta2e-toolkit | water-shader.js
 *
 * The Water Surface shader: one QuadMesh per water Region, laid over the bake's
 * grid (water-shore-field.js). Built the way beam-shader.js is, and for the same
 * reasons:
 *
 *  - the class is made LAZILY — `foundry.canvas.rendering.shaders` is not there
 *    when an ES module evaluates at init;
 *  - every uniform is declared in `defaultUniforms` (AbstractBaseShader.create
 *    merges with `insertKeys: false`, so an undeclared one is dropped silently);
 *  - typed-array uniforms are re-allocated per instance in `_configure`, since
 *    the defaults hand them over by reference;
 *  - world alpha reaches the shader only through `_preRender`;
 *  - output is PREMULTIPLIED.
 *
 * Everything is computed in WORLD space (uOrigin + vUv * uSize), so the waves
 * stay put under the map when the camera pans or zooms.
 */

import { buildNoiseTexture } from "./starfield-common.js";

export const MAX_RIPPLES = 8;

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
precision highp float;   // world-space px run into the thousands
varying vec2 vUv;

uniform sampler2D uShore;
uniform sampler2D uNoise;
uniform float uAlpha;
uniform float uTime;
uniform vec2  uOrigin;      // world px of the quad's top-left
uniform vec2  uSize;        // world px of the quad
uniform float uReach;       // signed-distance range in the shore texture, px
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform vec3  uFoam;
uniform vec4  uWave;        // [feature px, speed, height 0..1, second layer 0|1]
uniform vec4  uFlow;        // [dir x, dir y, px per second, mode 0 still / 1 uniform / 2 banks]
uniform vec4  uShoreCfg;    // [foam width px, foam intensity 0..1, depth reach px, glow 0..1]
uniform float uOpacity;
uniform float uGrid;
uniform float uCell;       // canvas px per shore-texture cell
uniform vec4  uSwell;      // [size 0..1, mean seconds between sets, deepest point of the Region px, called set start (uTime clock) or 0]
uniform float uSparkle;    // 1 sun glitter on, 0 off
uniform float uRough;
uniform float uCaustics;   // 0..1: light focused onto the floor of clear water      // turbulence 0..1: chop, whitecaps, spindrift, a storm-grey sea
uniform vec4  uClip;       // [x0, y0, x1, y1] — the scene rect under Open Map Edges, else unbounded
uniform vec4  uRipples[${MAX_RIPPLES}];  // [x, y, age s, strength]

float nz(vec2 p) { return texture2D(uNoise, p).r; }
// No sin(): the swell feeds it slot numbers in the thousands (uTime is the wall
// clock), and GPU sin() of arguments that large has no precision left, so the
// classic fract(sin(n) * 43758) hash returned near-constants and no set ever
// came. This one (Hoskins) stays well-distributed with arguments kept small.
float runupAt(float surfT, float along) {
  float g0 = fract(surfT + along * 2.4);
  return g0 < 0.18 ? smoothstep(0.0, 0.18, g0) : 1.0 - smoothstep(0.18, 0.98, g0);
}
// Three hashes of a 2D integer cell (Hoskins), small arguments only.
vec3 hash31(vec2 c) {
  vec3 q = fract(vec3(c.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}
float hash11(float n) {
  n = fract(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return fract(n);
}

// Wind chop: two layers drifting across each other, plus the flow carried
// through the classic two-phase flow-map blend so a curving current never
// smears the texture out.
float waveLayer(vec2 p, vec2 flowOff) {
  // The noise tile holds four features; two per wave size balances detail
  // against the tile repeating visibly (1:1 hatched the lake).
  float s = 0.5 / max(uWave.x, 1.0);
  float t = uTime * uWave.y * (1.0 + 0.8 * uRough);
  float h = nz((p - flowOff) * s + vec2(t * 0.031, t * 0.017));
  // The second layer is rotated as well as scaled, so its repeat can never
  // line up with the first one's across a large map.
  if (uWave.w > 0.5) h = h * 0.6 + nz(mat2(0.866, -0.5, 0.5, 0.866) * (p - flowOff) * s * 2.3 + vec2(-t * 0.023, t * 0.041) + 0.37) * 0.4;
  // Turbulence: a short, fast cross-chop at another angle and a scale that
  // shares no ratio with the others, so the three repeats never line up.
  if (uRough > 0.0) {
    float c = nz(mat2(0.342, 0.940, -0.940, 0.342) * (p - flowOff) * s * 4.7 + vec2(t * 0.067, -t * 0.052) + 0.71);
    h = mix(h, h * 0.62 + c * 0.38, uRough);
  }
  return h;
}

// Caustics: the bright net the surface focuses onto the floor — closed cells
// with thin bright walls. Each cell's wall is where the nearest and second
// nearest of a set of moving points are equally far (F2 - F1 near 0); the
// points come from hash31 of their integer cell, so nothing repeats, and each
// circles its own home slowly. A coarse noise warp bends the walls into the
// wavy lines a real caustic has. The noise-ridge version drew loose
// squiggles that never closed into cells.
float causticNet(vec2 q, float t) {
  vec2 c = floor(q), f = fract(q);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec3 h = hash31(mod(c + o, 2048.0));
      float ang = t * (0.35 + 0.4 * h.z) + h.x * 6.2832;
      vec2 pt = o + 0.5 + 0.38 * vec2(cos(ang), sin(ang)) * (0.6 + 0.4 * h.y) - f;
      float dd = dot(pt, pt);
      if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) { d2 = dd; }
    }
  }
  float edge = sqrt(d2) - sqrt(d1);
  return 1.0 - smoothstep(0.0, 0.16, edge);
}

float causticAt(vec2 p) {
  float sz = max(uGrid * 0.6, 8.0);             // one cell is a little over half a square
  vec2 q = p / sz;
  vec2 w = vec2(nz(p / (sz * 9.0) + vec2(uTime * 0.012, 0.0)),
                nz(p / (sz * 9.0) + vec2(0.0, -uTime * 0.01) + 0.5)) - 0.5;
  q += w * 1.6;
  float t = mod(uTime, 6283.2);                 // keeps cos/sin arguments small
  float a = causticNet(q, t);
  float b = causticNet(mat2(0.8, -0.6, 0.6, 0.8) * q * 1.31 + 17.3, t * 1.2);
  // The brightest light is where two nets' walls cross.
  return clamp(a * 0.65 + b * 0.35 + a * b * 0.6, 0.0, 1.4);
}

float heightAt(vec2 p, vec2 dir) {
  if (uFlow.w < 0.5 || uFlow.z <= 0.0) return waveLayer(p, vec2(0.0));
  float period = 4.0;
  float ph0 = fract(uTime / period);
  float ph1 = fract(uTime / period + 0.5);
  vec2 travel = dir * uFlow.z * period;
  float a = waveLayer(p, travel * ph0);
  float b = waveLayer(p + 31.7, travel * ph1);
  float w = abs(1.0 - 2.0 * ph0);
  return mix(a, b, w);
}

void main() {
  vec4 s = texture2D(uShore, vUv);
  float r = s.r * 2.0 - 1.0;
  float d = sign(r) * r * r * uReach;     // + water, - land, px
  // Coverage edge from the interpolated distance alone. The A channel steps
  // once per cell, and gating on it drew a jagged one-pixel rim round the whole
  // shore. The water the distance carries past an open map edge is cut off by
  // uClip instead, which is a straight line.
  float cov = smoothstep(-uCell * 0.6, uCell * 0.6, d);

  float foamW = max(uShoreCfg.x, 1.0);
  float landReach = foamW * 0.55;   // how far the run-up and wet sand reach
  // A swell surges much further up the shore than the everyday run-up.
  // The biggest swell that can come: the random size, or a called set (0.6+).
  float swellMax = max(uSwell.x, uSwell.w > 0.0 ? 0.6 : 0.0);
  if (cov < 0.004 && d < -landReach * (1.0 + 1.4 * swellMax)) discard;

  vec2 p = uOrigin + vUv * uSize;
  if (p.x < uClip.x || p.y < uClip.y || p.x > uClip.z || p.y > uClip.w) discard;
  vec2 dir = uFlow.xy;
  if (uFlow.w > 1.5) {
    vec2 bank = s.gb * 2.0 - 1.0;
    float bl = length(bank);
    dir = bl > 0.01 ? bank / bl : uFlow.xy;
  }

  // Surface normal by finite differences of the height field.
  float e = max(uWave.x * 0.08, 2.0);
  float h0 = heightAt(p, dir);
  float hx = heightAt(p + vec2(e, 0.0), dir);
  float hy = heightAt(p + vec2(0.0, e), dir);
  // A rough sea is rough whatever Wave Height says: floor the height and steepen it.
  float amp = max(uWave.z, uRough * 0.7) * 6.0 * (1.0 + 1.6 * uRough);
  vec3 n = normalize(vec3((h0 - hx) * amp, (h0 - hy) * amp, 1.0));

  // Wake ripples bend the normal and catch the light.
  float ring = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 rp = uRipples[i];
    if (rp.w <= 0.0) continue;
    vec2 off = p - rp.xy;
    float dist = length(off);
    float radius = rp.z * uGrid * 0.9;
    float width = uGrid * 0.1 + rp.z * uGrid * 0.06;
    float fade = rp.w * clamp(1.0 - rp.z / 2.6, 0.0, 1.0);
    float k = (dist - radius) / width;
    float band = exp(-k * k) * fade;
    ring += band;
    if (dist > 0.001) n.xy += (off / dist) * band * sin(k * 3.0) * 0.6;
  }
  n = normalize(n);

  float glow = uShoreCfg.w;
  vec3 L = normalize(vec3(-0.45, -0.6, 0.66));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  // A tight, dim sheen from the broad waves. At pow 70 and full strength this
  // drew big white blobs over the whole surface that read as floating cotton.
  float spec = pow(clamp(dot(n, H), 0.0, 1.0), 180.0) * 0.45 * (1.0 - glow * 0.8);
  // Sun glitter: hashed cells, NOT the noise texture. Every texture-derived
  // version tiled — the texture is one 256 px tile, so its peaks recur on a
  // fixed lattice however it is scaled or rotated, and in Foundry that showed
  // as a grid of blobs. Each cell here gets its own random point, size and
  // flash time from a hash of its integer coordinates, so nothing repeats.
  // Glints only flash where the waves face the sun.
  float cellPx = max(uGrid * 0.32, 6.0);
  vec2 cell = floor(p / cellPx);
  vec2 inCell = p / cellPx - cell;
  vec3 hc = hash31(mod(cell, 2048.0));
  vec2 pt = 0.2 + 0.6 * hc.xy;                              // stays clear of the cell edge
  float life = fract(uTime * (0.25 + 0.35 * hc.z) + hc.x * 7.0);
  float flash = smoothstep(0.0, 0.04, life) * (1.0 - smoothstep(0.04, 0.16, life));
  float rad = (0.035 + 0.05 * hc.y) * mix(0.6, 1.0, flash);
  float dot0 = 1.0 - smoothstep(rad * 0.4, rad, length(inCell - pt));
  float facing = smoothstep(0.88, 0.985, dot(n, H));
  float sparkle = dot0 * flash * facing * (0.35 + 0.65 * uWave.z) * (1.0 - glow) * uSparkle;

  float depthT = smoothstep(0.0, 1.0, clamp(d / max(uShoreCfg.z, 1.0), 0.0, 1.0));
  vec3 col = mix(uShallow, uDeep, depthT);
  col *= 0.78 + 0.42 * diff;
  // Storm light: overcast, so the sea goes slate — darker, greyer, and the
  // troughs between the chop darker still. Glitter dies with the sun.
  if (uRough > 0.0) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 slate = mix(col, vec3(lum) * vec3(0.92, 1.0, 1.04), 0.55) * 0.74;
    col = mix(col, slate, uRough * (1.0 - glow));
    col *= 1.0 - uRough * 0.22 * clamp((0.55 - h0) * 3.0, 0.0, 1.0);
    sparkle *= 1.0 - uRough * 0.75;
    spec *= 1.0 - uRough * 0.5;
  }
  // Caustics, strongest where the floor is near (the shallow end) and fading
  // into the deep. Chromatic: a touch of the foam colour at the knots.
  if (uCaustics > 0.0) {
    float cst = causticAt(p + (n.xy * uGrid * 0.25));
    float near = mix(1.0, 0.45, depthT);
    col += mix(uShallow, uFoam, 0.6) * cst * uCaustics * near * 0.75 * (1.0 - glow);
  }
  col += spec + sparkle * 0.85;

  // Emissive liquids: hot veins through the crust, brightest in the shallows.
  if (glow > 0.0) {
    float veins = nz(p * 0.5 / max(uWave.x * 1.7, 1.0) + vec2(uTime * 0.012, -uTime * 0.009));
    float hot = smoothstep(0.5, 0.78, veins) * (0.55 + 0.45 * h0);
    col += glow * hot * mix(uShallow, uFoam, 0.35) * 1.3;
    col = mix(col, uShallow, glow * (1.0 - depthT) * 0.35);
  }

  // ── Surf ──────────────────────────────────────────────────────────────
  // A wave train rolling in toward the shore. Its phase falls with distance
  // and rises with time, so crests travel shoreward; a slow along-shore noise
  // offsets the phase, so crests reach different stretches of coast at
  // different moments instead of arriving as concentric rings.
  float surfT = uTime * (0.22 + 0.3 * uWave.y) * (1.0 + 0.35 * uRough);
  float along = nz(p / (foamW * 6.0) + vec2(uTime * 0.004, -uTime * 0.003));
  float lambda = foamW * 0.55;
  float phase = max(d, 0.0) / lambda + surfT + along * 2.4;
  float g = fract(phase);
  // Crest profile: a steep shoreward face (g just under 1) and a long foamy
  // back (g after 0).
  float crest = g > 0.88 ? smoothstep(0.88, 1.0, g) : exp(-g * 4.5);
  // Shoaling: crests only build in the shallows and peak just before they break.
  float shoal = smoothstep(foamW * 2.0, foamW * 0.35, d) * smoothstep(-foamW * 0.05, foamW * 0.18, d);

  // Lace: two octaves of noise thresholded into the cells of breaking foam,
  // drifting slowly so it reads as froth rather than texture.
  // One noise tile is four features; at 0.85 foam widths a tile it repeated in a
  // visible checker over a breaking set.
  vec2 lp = p / (foamW * 3.2);
  float lace = nz(lp + vec2(uTime * 0.031, -uTime * 0.017)) * 0.65
             + nz(lp * 2.7 + vec2(-uTime * 0.05, uTime * 0.02) + 0.43) * 0.35;
  float laceHi = smoothstep(0.42, 0.6, lace);
  float laceLo = smoothstep(0.3, 0.55, lace);

  // A current carries the surface along the bank rather than onto it, so
  // flowing liquids (rivers, a lava flow) get a calm edge with light lapping:
  // breakers rolling in against a river bank read as wrong.
  float surge = uFlow.w > 0.5 && uFlow.z > 0.0 ? 0.18 : 1.0;

  float surf = crest * shoal * mix(0.45, 1.0, laceHi) * surge * 1.35 * (1.0 + 0.5 * uRough);
  // White water: the broken, churning band between the break and the beach,
  // thickest as each wave lands.
  float whiteWater = d >= 0.0
    ? smoothstep(foamW * 0.95, foamW * 0.1, d) * laceLo * (0.3 + 0.5 * runupAt(surfT, along)) * surge
    : 0.0;

  // Run-up, timed to the waves: the phase at the waterline says when a crest
  // lands there. The sheet surges up the beach fast and drains back slowly.
  float g0 = fract(surfT + along * 2.4);
  float runup = g0 < 0.18 ? smoothstep(0.0, 0.18, g0) : 1.0 - smoothstep(0.18, 0.98, g0);
  float reach = landReach * (0.35 + 0.65 * runup) * mix(0.5, 1.0, surge);
  float up = max(-d, 0.0);
  float sheet = d < 0.0 ? (1.0 - smoothstep(reach * 0.7, reach, up)) : 0.0;
  float front = d < 0.0 ? exp(-pow((up - reach) / (landReach * 0.1), 2.0)) : 0.0;
  // Wet sand: darker where the sheet has been, fading toward the high-water mark.
  float wetSand = d < 0.0 ? (1.0 - smoothstep(0.0, landReach, up)) : 0.0;

  // The waterline itself: a foam edge that swells as each wave lands.
  float line = exp(-pow(d / (foamW * (0.1 + 0.12 * runup)), 2.0)) * mix(0.75, 1.0, laceLo);

  float landFoam = (sheet * 0.5 * laceLo + front * 1.2 * mix(0.4, 1.0, laceHi)) * (0.5 + 0.5 * runup);
  // ── Swell: sets of big waves ────────────────────────────────────────────
  // Time is cut into slots, one set per slot at most; a hash of the slot says
  // whether a set comes (chance = slot / mean interval) and which stretch of
  // coast it hits (a coarse noise patch). Two staggered slot clocks let sets
  // overlap. Each set is three waves a few seconds apart. Everything derives
  // from uTime (the wall clock), so every client sees the same sets.
  //
  // A swell is a RIDGE, sized in grid squares, not foam widths: a translucent
  // lit face toward the shore with a crisp crest line, and a long shaded back.
  // Sized off the foam width (a fraction of a square on a 180 px grid) and
  // started ~3 foam widths out, it drew thin faint contour lines that nobody
  // read as a wave — seen live in Foundry, not in the small preview.
  float swellFace = 0.0;
  float swellBack = 0.0;
  float swellTrough = 0.0;
  float swellCrest = 0.0;
  float swellFoam = 0.0;
  float spray = 0.0;                 // mist thrown up by crashing waves
  if (uSwell.x > 0.0 || uSwell.w > 0.0) {
    // Rises up to ~7 squares out, never past 85% of this Region's deepest
    // point (uSwell.z), so a small pool still sees the whole walk-in.
    float start = max(min(uGrid * 7.0, uSwell.z * 0.85), foamW * 1.5);
    float T = max(4.0, start / (uGrid * 0.6));       // ~0.6 squares a second
    float runT = 1.6 / T;                            // run-up time, as a fraction of T
    float gap = clamp(T * 0.22, 2.5, 5.0);           // seconds between the waves of a set
    float span = T * (1.0 + runT) + gap * 2.0;
    float chance = clamp(span / max(uSwell.y, 1.0), 0.0, 1.0);
    float size = max(uSwell.x, 0.0);
    for (int set = 0; set < 3; set++) {
      float local;
      float patchA;
      float setSize = size;
      vec2 off = vec2(0.47, 0.23);
      // Per-set seed; a called set takes one from its own start stamp.
      float seed = 911.0 + mod(floor(uSwell.w), 89.0);
      if (set == 2) {
        // A set the GM called ("Send a Set Now"): the whole coast, from the
        // stamped start, at least a decent size even if random swell is off.
        local = uTime - uSwell.w;
        if (uSwell.w <= 0.0 || local < 0.0 || local > span) continue;
        patchA = 1.0;
        setSize = max(size, 0.6);
      } else {
        if (size <= 0.0) continue;
        float tt = uTime + float(set) * span * 0.5;
        float slot = floor(tt / span);
        seed = mod(slot, 4096.0) + float(set) * 4099.0;
        if (hash11(seed) > chance) continue;
        local = tt - slot * span;
        off = vec2(hash11(seed + 3.1), hash11(seed + 7.7)) * 37.0;
        patchA = smoothstep(0.36, 0.6, nz(p / (uGrid * 14.0) + off));
        if (patchA <= 0.0) continue;
      }
      // Half-width of the ridge, in px: ~1.4 squares at size 0.55.
      float w = uGrid * (0.7 + 1.3 * setSize);
      for (int j = 0; j < 3; j++) {
        float k = (local - float(j) * gap) / T;
        if (k < 0.0 || k > 1.0 + runT) continue;
        float amp = setSize * patchA * (1.0 - 0.18 * float(j)) * surge;
        // Along the crest: a slow noise, different per wave, makes the crest
        // wander and its height vary, so it stops tracing the shoreline as a
        // contour line. Higher sections also break first, so the wave PEELS
        // along the beach instead of collapsing everywhere at once.
        float along = nz(p / (uGrid * 6.0) + off * 0.53 + vec2(float(j) * 0.31, float(j) * 0.17));
        amp *= mix(0.4, 1.0, smoothstep(0.25, 0.68, along));
        // Breaking on open water: most waves (60%) have stretches that crash
        // out on the water — over a bar or a reef, or because they got too
        // steep — then re-form smaller and roll on to break again at the shore.
        // Where and which stretches come from the set's hash, so every client
        // sees the same crash.
        float offSect = 0.0;
        float tOff = -1.0;
        if (hash11(seed * 1.7 + float(j) * 13.1) < 0.6) {
          float dOff = start * mix(0.4, 0.78, hash11(seed * 2.3 + float(j) * 5.7));
          offSect = smoothstep(0.5, 0.68, nz(p / (uGrid * 4.5) + off * 0.71 + vec2(float(j) * 0.43, 0.29)));
          tOff = (k - (1.0 - dOff / max(start, 1.0))) * T;
          if (tOff > 0.0) amp *= mix(1.0, 0.6, offSect);      // spent some of itself
        }
        // Crest distance: walks in from start, then up the shore as far as the
        // discard bound above allows, so the surge never meets a hard edge.
        float runMax = landReach * (1.0 + 1.4 * setSize) * 0.85;
        float c = k <= 1.0 ? start * (1.0 - k) : -runMax * (k - 1.0) / runT;
        // Wanders out in the water, settles onto the shore line as it lands.
        c += (along - 0.5) * uGrid * 1.3 * smoothstep(0.0, foamW * 2.0, c);
        float x = d - c;                              // < 0 shoreward of the crest
        float rise = smoothstep(0.0, 0.12, k);        // stands up out of the swell
        float fade = k > 1.0 ? 1.0 - (k - 1.0) / runT : 1.0;
        // Steepens as it shoals, then breaks in the shallows.
        float brkAt = foamW * (0.8 + 0.9 * along);
        float steep = smoothstep(start * 0.7, brkAt, c);
        float brk = smoothstep(brkAt, brkAt * 0.3, c);
        float clean = (1.0 - brk) * rise * amp;
        // The face narrows as it steepens; the back stays long.
        float faceW = w * mix(0.6, 0.32, steep);
        // Brightest just under the crest, where the face is thinnest.
        swellFace += (x < 0.0 ? exp(-pow(x / faceW, 2.0)) : 0.0) * clean;
        swellBack += (x >= 0.0 ? exp(-pow(x / (w * 1.7), 2.0)) : 0.0) * clean;
        // The trough the face rises out of gives it relief.
        swellTrough += exp(-pow((x + faceW * 1.8) / (faceW * 0.7), 2.0)) * clean;
        // Crest: broken into glints by the lace, never a ruled line.
        swellCrest += exp(-pow(x / (uGrid * 0.06), 2.0)) * clean * mix(0.35, 1.0, laceHi);
        // Spilling: white water tumbles down the face of the high sections
        // as the wave steepens, before the full break.
        float spill = x < 0.0 ? exp(-pow(x / (faceW * 0.35), 2.0)) : exp(-x / (uGrid * 0.08));
        swellFoam += spill * pow(steep, 3.0) * smoothstep(0.5, 0.75, along) * laceHi * clean * 0.8;
        // Feathering: spray off the lip as it steepens, before it breaks.
        float lip = exp(-pow((x + uGrid * 0.05) / (uGrid * 0.12), 2.0));
        swellFoam += lip * steep * steep * laceHi * clean * 0.9;
        // Breaking: a white wall with churned water behind it, kept short and
        // inside the breaking zone so a set never whitewashes a small pool.
        float wall = x < 0.0 ? exp(-pow(x / (uGrid * 0.25), 2.0)) : exp(-x / (uGrid * 0.5));
        float trail = x > 0.0 ? exp(-x / (uGrid * 1.1)) * 0.5 * laceLo * smoothstep(foamW * 2.0, foamW * 0.8, d) : 0.0;
        swellFoam += (wall * mix(0.55, 1.0, laceHi) + trail) * amp * brk * fade * 1.3;

        // ── Crash on open water ───────────────────────────────────────────
        if (offSect > 0.0 && tOff > -0.4) {
          // The lip pitches forward, the section explodes, spray drifts on.
          float pl = smoothstep(-0.4, 0.0, tOff) * (1.0 - smoothstep(0.0, 0.3, tOff));
          swellFoam += exp(-pow((x + faceW * 0.8) / (uGrid * 0.1), 2.0)) * pl * offSect * amp * 1.1;
          float ob = tOff > 0.0 ? exp(-tOff * 1.8) * smoothstep(0.0, 0.08, tOff) : 0.0;
          float obR = uGrid * (0.3 + 0.9 * (1.0 - exp(-max(tOff, 0.0) * 3.0)));
          swellFoam += exp(-pow(x / obR, 2.0)) * ob * offSect * amp * mix(0.6, 1.0, laceLo) * 1.5;
          spray += exp(-pow((x + obR * 0.5) / (obR * 1.3), 2.0)) * ob * offSect * amp * 0.5;
          // Then the re-formed wave carries the white water on its crest,
          // fading over a couple of seconds as it rolls in.
          float ride = tOff > 0.0 ? exp(-tOff * 0.55) : 0.0;
          float rideBand = x < 0.0 ? exp(-pow(x / (uGrid * 0.3), 2.0)) : exp(-x / (uGrid * 0.7));
          swellFoam += rideBand * ride * offSect * amp * laceLo * 0.9 * (1.0 - brk);
        }

        // ── Foam riding the swell ─────────────────────────────────────────
        // A lacy cap along the crest, and old foam scattered over the back,
        // both thickening as the wave steepens.
        float capFoam = exp(-pow((x - uGrid * 0.05) / (uGrid * 0.14), 2.0)) * laceHi;
        float backFoam = x > 0.0 ? exp(-x / (w * 1.4)) * smoothstep(0.55, 0.75, lace) : 0.0;
        swellFoam += (capFoam * 0.6 + backFoam * 0.35) * clean * mix(0.3, 1.0, steep);

        // ── Crash ─────────────────────────────────────────────────────────
        // tb: seconds since this section of the wave broke (its crest crossed
        // brkAt). All timed off the wave itself, so every client sees it.
        float kb = 1.0 - brkAt / max(start, 1.0);
        float tb = (k - kb) * T;
        // Plunge: just before the break the lip throws forward and lands a
        // little ahead of the face.
        float plunge = smoothstep(-0.45, 0.0, tb) * (1.0 - smoothstep(0.0, 0.35, tb));
        float lipLand = exp(-pow((x + faceW * 0.9) / (uGrid * 0.1), 2.0));
        swellFoam += lipLand * plunge * amp * mix(0.5, 1.0, laceHi) * 1.2;
        // Impact: an explosion of white water round the crest that blooms out
        // and settles, with mist thrown shoreward.
        float burst = tb > 0.0 ? exp(-tb * 1.6) * smoothstep(0.0, 0.08, tb) : 0.0;
        float burstR = uGrid * (0.35 + 1.1 * (1.0 - exp(-max(tb, 0.0) * 3.0)));
        swellFoam += exp(-pow(x / burstR, 2.0)) * burst * amp * mix(0.6, 1.0, laceLo) * 1.6;
        spray += exp(-pow((x + burstR * 0.6) / (burstR * 1.4), 2.0)) * burst * amp * 0.55;
        // Shore slam: what is left of the wave hits the waterline and bursts
        // up the beach (or against rocks), then falls back.
        float ts = (k - 1.0) * T;
        float slam = ts > -0.1 ? exp(-max(ts, 0.0) * 2.2) * smoothstep(-0.1, 0.05, ts) : 0.0;
        float shoreBand = exp(-pow((d + landReach * 0.35) / (landReach * 0.6), 2.0));
        swellFoam += shoreBand * slam * amp * laceHi * 1.1;
        spray += shoreBand * slam * amp * 0.6;
      }
    }
    // Face: thinner water catching the light reads translucent turquoise.
    // A partial blend, not a wash: at 0.7 toward a pale colour it milked out
    // the whole near-shore band.
    float face = clamp(swellFace, 0.0, 1.0);
    col = mix(col, uShallow * 1.18 + vec3(0.03), face * 0.5);
    col += sparkle * face * 1.2;                     // glitter lines up along the face
    col *= 1.0 - clamp(swellTrough, 0.0, 1.0) * 0.2;
    // Crest: one crisp bright line where the face meets the back.
    col += vec3(0.85, 0.93, 0.95) * clamp(swellCrest, 0.0, 1.0) * 0.4;
    // Back: the long slope away from the light.
    col *= 1.0 - clamp(swellBack, 0.0, 1.0) * 0.28;
  }

  // ── Turbulence on open water ───────────────────────────────────────────
  // Whitecaps: the tops of the chop break into foam that flares and fades,
  // gated by a drifting patch noise so caps come and go rather than sitting on
  // every peak. Spindrift: foam blown into long streaks down the wind (the
  // flow bearing). Both stay off the surf band, which has foam of its own.
  float roughFoam = 0.0;
  if (uRough > 0.0) {
    float open = smoothstep(foamW * 1.1, foamW * 2.6, d);
    float capGate = smoothstep(0.5 - 0.22 * uRough, 0.66 - 0.12 * uRough, nz(p / (uGrid * 3.1) + vec2(uTime * 0.071, -uTime * 0.053) + 0.19));
    float capBreak = nz(p / (uGrid * 0.85) + vec2(-uTime * 0.11, uTime * 0.07) + 0.57);
    float cap = smoothstep(0.62 - 0.12 * uRough, 0.7 - 0.08 * uRough, h0)
              * capGate * smoothstep(0.3, 0.55, capBreak);
    vec2 wnd = normalize(uFlow.xy + vec2(1e-5, 0.0));
    vec2 q = vec2(dot(p, wnd), dot(p, vec2(-wnd.y, wnd.x)));
    // Two stretched samples at unrelated scales, so neither's across-wind
    // repeat shows as even stripes; a coarse patch breaks the field up.
    float st = nz(vec2(q.x / (uGrid * 17.0), q.y / (uGrid * 1.45)) + vec2(-uTime * 0.035, 0.0)) * 0.6
             + nz(vec2(q.x / (uGrid * 11.0), q.y / (uGrid * 0.83)) + vec2(-uTime * 0.05, 0.0) + 0.33) * 0.4;
    float streak = smoothstep(0.54, 0.7, st)
                 * smoothstep(0.3, 0.6, nz(p / (uGrid * 9.0) + vec2(uTime * 0.01, 0.0) + 0.81));
    roughFoam = open * uRough * (cap * 1.2 + streak * 0.6 * uRough);
    // Spray off the caps, and torn off the surf at the waterline.
    spray += open * cap * uRough * uRough * 0.35 + line * laceHi * uRough * 0.3 * surge;
  }

  float foam = clamp((surf + whiteWater + swellFoam + line * 0.9 + (d < 0.0 ? landFoam : 0.0) + ring * 0.55) * uShoreCfg.y + roughFoam, 0.0, 1.0);

  // ── Compose (premultiplied) ─────────────────────────────────────────────
  float a = cov * uOpacity * mix(0.62, 1.0, depthT);
  // A thin sheet of shallow water over the sand where the run-up is.
  float sheetA = sheet * 0.5 * uOpacity * (0.5 + 0.5 * runup);
  a = max(a, sheetA);
  col = mix(col, uFoam, foam);
  float foamA = foam * min(1.0, uOpacity + 0.25);
  a = max(a, foamA);
  // Spray: a white mist from crashing waves, broken into drifting wisps. Its
  // own term, so it can hang over the sand past the surf's reach.
  float mist = clamp(spray, 0.0, 1.0) * uShoreCfg.y
             * (0.45 + 0.55 * nz(p / (uGrid * 0.6) + vec2(uTime * 0.15, -uTime * 0.1)));
  col = mix(col, vec3(1.0), mist * 0.8);
  a = max(a, mist * 0.75);
  vec3 pre = col * a;
  // Wet sand goes UNDER everything above: darken only what is left uncovered.
  // Kept faint: through the gaps in the lace a stronger tint read as dirt.
  float wetA = wetSand * 0.1 * uShoreCfg.y * (1.0 - a);
  a = a + wetA;
  a = clamp(a, 0.0, 1.0);
  float master = clamp(uAlpha, 0.0, 1.0);
  pre *= master;
  a *= master;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(pre, a);
}
`;

/** The GLSL, for tests/water-shader-browser.html (a raw-WebGL preview). */
export const WATER_VERT = VERT;
export const WATER_FRAG = FRAG;

let _cls = null;

function _shaderClass() {
  if (_cls) return _cls;
  const Base = foundry?.canvas?.rendering?.shaders?.AbstractBaseShader;
  if (!Base) return null;
  class Sta2eWaterShader extends Base {
    static _createVertexShader() { return VERT; }
    static _createFragmentShader() { return FRAG; }
    static defaultUniforms = {
      uShore: null,
      uNoise: null,
      uAlpha: 1,
      uTime: 0,
      uOrigin: [0, 0],
      uSize: [1, 1],
      uReach: 400,
      uDeep: [0.04, 0.18, 0.31],
      uShallow: [0.18, 0.56, 0.65],
      uFoam: [0.92, 0.96, 0.97],
      uWave: [300, 1, 0.7, 1],
      uFlow: [1, 0, 0, 0],
      uShoreCfg: [120, 0.8, 1000, 0],
      uOpacity: 0.85,
      uGrid: 100,
      uCell: 8,
      uClip: [-1e7, -1e7, 1e7, 1e7],
      uSwell: [0, 60, 0, 0],
      uRough: 0,
      uCaustics: 0,
      uSparkle: 1,
      uRipples: new Float32Array(MAX_RIPPLES * 4),
    };
    _configure(_options) { this.uniforms.uRipples = new Float32Array(MAX_RIPPLES * 4); }
    _preRender(mesh, _renderer) { this.uniforms.uAlpha = mesh.worldAlpha; }
  }
  _cls = Sta2eWaterShader;
  return _cls;
}

let _probed = null;
let _warned = false;

/** Can this client draw the water shader? Probed once per canvas. */
export function waterShaderAvailable() {
  if (_probed !== null) return _probed;
  _probed = false;
  try {
    const r = canvas?.app?.renderer;
    if (!r?.gl || r.gl.isContextLost?.()) throw new Error("no-gl");
    if (!foundry?.canvas?.containers?.QuadMesh) throw new Error("no-quadmesh");
    if (!_shaderClass()) throw new Error("no-base-shader");
    const slots = r.gl.getParameter(r.gl.MAX_FRAGMENT_UNIFORM_VECTORS);
    if (!(slots >= 32)) throw new Error(`uniform-slots-${slots}`);
    _probed = true;
  } catch (err) {
    if (!_warned) {
      _warned = true;
      console.warn("STA2e Toolkit | Water shader unavailable; drawing flat water instead.", err?.message ?? err);
    }
  }
  return _probed;
}

/** Forget the probe (canvasTearDown): a new canvas is a new GL context. */
export function resetWaterShaderProbe() { _probed = null; }

/** A failed mesh build marks the shader unusable for this canvas. */
export function markWaterShaderFailed(err) {
  _probed = false;
  if (!_warned) {
    _warned = true;
    console.warn("STA2e Toolkit | Water shader failed to build; drawing flat water instead.", err);
  }
}

let _noise = null;
/** Shared tiling noise. NEVER destroyed — it belongs to no scene. */
export function waterNoiseTexture() {
  if (_noise) return _noise;
  _noise = buildNoiseTexture({ size: 256, octaves: 4, features: 4, contrast: 1 });
  return _noise;
}

/** A fresh QuadMesh carrying the water shader, or null. */
export function createWaterMesh() {
  if (!waterShaderAvailable()) return null;
  try {
    const mesh = new foundry.canvas.containers.QuadMesh(_shaderClass());
    mesh.shader.uniforms.uNoise = waterNoiseTexture();
    return mesh;
  } catch (err) {
    markWaterShaderFailed(err);
    return null;
  }
}
