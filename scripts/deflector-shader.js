/** Deflector volumes. Local-space, premultiplied GLSL for Foundry's QuadMesh.
 * The effect runner owns the clock and mesh lifetime; these add no tickers,
 * render textures, particle allocations, or full-screen postprocessing.
 */
const VERT = `
attribute vec2 aVertexPosition;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const HEAD = `
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uCoreColor;
uniform float uAlpha;
uniform float uTime;
uniform float uSeed;
uniform vec2 uSize;
uniform vec4 uShape;
uniform vec2 uDetail;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
float fog(vec2 p) {
  return noise(p) * 0.57 + noise(p * 2.03 + 13.7) * 0.29
       + noise(p * 4.11 + 5.3) * 0.14;
}
float gaussian(float x) { return exp(-x * x); }
void light(float density, float heat) {
  // Exponential exposure preserves colour in bright overlapping volumes.
  float a = (1.0 - exp(-max(0.0, density))) * clamp(uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(mix(uColor, uCoreColor, clamp(heat, 0.0, 1.0)) * a, a);
}`;

const BODIES = {
  charge: `
void main() {
  float x = vUv.x;
  float lateral = (vUv.y - 0.5) * 2.0;
  float wall = max(0.015, x);
  float v = lateral / wall;
  float edge = pow(max(0.0, 1.0 - v * v), 2.0);
  float ends = smoothstep(0.0, 0.035, x) * (1.0 - smoothstep(0.65, 1.0, x));
  // Constant angular lanes travel toward the dish, never orbit around it.
  vec2 p = vec2(x * uSize.x * 0.024 + uTime * 2.4, v * 3.6 + uSeed);
  float n = fog(p);
  float threads = pow(noise(vec2(v * 19.0 + uSeed, x * 4.0 + uTime * 1.8)), 4.0);
  float bands = pow(0.5 + 0.5 * sin(x * 35.0 + uTime * 9.0 + n * 3.0), 8.0);
  float body = (0.2 + n * 0.8 + threads * 3.0 + bands * 0.28) * edge * ends;
  light(body * uDetail.x * 2.2, threads * 0.6 + (1.0 - x) * 0.12);
}`,
  pulse: `
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float radius = uShape.x, width = max(0.75, uShape.y);
  float angle = atan(p.y, p.x);
  float halfArc = max(0.02, uShape.z * 0.5);
  float angular = abs(angle) / halfArc;
  // A full-circle setting has no seam or pinched ends.
  float taper = uShape.z > 6.27 ? 1.0 : pow(max(0.0, 1.0 - angular * angular), 0.65);
  float radial = length(p);
  float behind = radius - radial;
  float w = max(0.65, width * taper);
  float front = gaussian((behind - w * 0.13) / (w * 0.18));
  float bloom = gaussian(behind / (w * (0.95 + uDetail.y * 0.35)));
  float inner = gaussian((behind - w * 0.65) / (w * 0.6));
  float tailLength = max(0.001, uShape.w);
  float depth = max(0.0, behind) / tailLength;
  // Noise is confined behind the coherent front. A warped second octave
  // stretches it into vapour filaments, rather than round sprite puffs.
  vec2 q = vec2(angle * radius * 0.035, behind * 0.04 - uTime * 1.9 + uSeed);
  float n = fog(q + vec2(noise(q * 0.6 + uTime * 0.3) * 1.8, 0.0));
  float wisps = pow(n, 2.2) * 3.0;
  float tail = smoothstep(w * 0.4, w * 1.8, behind)
             * (1.0 - smoothstep(0.1, 1.0, depth)) * wisps * taper;
  float rim = (front * 1.5 + bloom * 0.32 + inner * 0.3) * taper;
  light(rim + tail * uDetail.x * 1.6, front * 0.8 + inner * 0.16);
}`,
  stream: `
void main() {
  float x = vUv.x;
  float v = (vUv.y - 0.5) * uSize.y / max(1.0, uShape.x * 0.5);
  float neck = mix(0.25, 1.0, smoothstep(0.0, 0.32, x));
  float radial = v / neck;
  float edge = pow(max(0.0, 1.0 - radial * radial), 1.8);
  float ends = smoothstep(0.0, 0.045, x) * (1.0 - smoothstep(0.86, 1.0, x));
  // Pixel-based advection keeps the texture velocity tied to the mote dial.
  vec2 q = vec2(x * uSize.x * 0.025 - uTime * uDetail.y * 0.025, radial * 3.0 + uSeed);
  float n = fog(q);
  float filaments = pow(noise(vec2(q.x * 0.45, q.y * 3.0 + n)), 3.0);
  float a = sin(x * 15.0 - uTime * 3.3 + uSeed) * 0.48;
  float b = sin(x * 15.0 - uTime * 3.3 + uSeed + 3.14159) * 0.48;
  float strands = gaussian((radial - a) / 0.12) + gaussian((radial - b) / 0.15) * 0.65;
  float density = (0.32 + n * 0.85 + filaments * 1.4 + strands * 0.45) * edge * ends;
  float halo = gaussian(radial * 1.6) * min(1.0, uShape.y / 18.0)
             * (1.0 - smoothstep(0.85, 1.0 + uShape.y * 2.0 / max(1.0, uShape.x), abs(radial)));
  light((density + halo * ends * 0.3) * uDetail.x * 2.4, strands * 0.3 + filaments * 0.4);
}`,
};

const classes = new Map();
const failed = new Set();
const rgb = c => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** Null selects the caller's Graphics fallback. Mesh destruction belongs to
 * the runner's container; update mutates existing uniforms without allocating.
 */
export function createDeflectorField(parent, type, { color, coreColor, blend }) {
  const renderer = globalThis.canvas?.app?.renderer;
  const Base = globalThis.foundry?.canvas?.rendering?.shaders?.AbstractBaseShader;
  const Quad = globalThis.foundry?.canvas?.containers?.QuadMesh;
  if (!renderer?.gl || renderer.gl.isContextLost?.() || !Base || !Quad || !BODIES[type] || failed.has(type)) return null;
  let mesh;
  try {
    if (!classes.has(type)) {
      class DeflectorFieldShader extends Base {
        static _createVertexShader() { return VERT; }
        static _createFragmentShader() { return HEAD + BODIES[type]; }
        static defaultUniforms = {
          // Present before the eager compile: PIXI builds its uniform sync
          // function on first bind and does not discover keys added later.
          translationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          uColor: [0.4, 0.7, 1], uCoreColor: [0.85, 0.94, 1],
          uAlpha: 1, uTime: 0, uSeed: 0, uSize: [1, 1],
          uShape: [1, 1, 1, 1], uDetail: [1, 1],
        };
        _preRender(mesh) { this.uniforms.uAlpha = mesh.worldAlpha; }
      }
      classes.set(type, DeflectorFieldShader);
    }
    mesh = new Quad(classes.get(type));
    mesh.pivot.set(type === "pulse" ? 0.5 : 0, 0.5);
    mesh.blendMode = blend;
    const u = mesh.shader.uniforms;
    u.uColor = rgb(color); u.uCoreColor = rgb(coreColor); u.uSeed = Math.random() * 19;
    // Compile before selecting this path so unsupported shaders fall back now.
    renderer.shader.bind(mesh.shader);
    const program = mesh.shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
    if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) {
      throw new Error("Deflector GLSL program did not link");
    }
    mesh.alpha = 0;
    parent.addChild(mesh);
    return {
      mesh,
      update(x, y, angle, length, height, time, alpha, s0 = 1, s1 = 1, s2 = 1, s3 = 1, d0 = 1, d1 = 1) {
        if (mesh.destroyed) return;
        mesh.position.set(x, y); mesh.rotation = angle;
        mesh.scale.set(Math.max(1, length), Math.max(1, height));
        mesh.alpha = Math.max(0, Math.min(1, alpha));
        u.uSize[0] = Math.max(1, length); u.uSize[1] = Math.max(1, height); u.uTime = time;
        u.uShape[0] = s0; u.uShape[1] = s1; u.uShape[2] = s2; u.uShape[3] = s3;
        u.uDetail[0] = d0; u.uDetail[1] = d1;
      },
    };
  } catch (err) {
    failed.add(type);
    try { mesh?.destroy(); } catch { /* partially constructed */ }
    console.warn(`STA2e Toolkit | Deflector ${type} shader unavailable; using Graphics.`, err);
    return null;
  }
}

globalThis.Hooks?.on("canvasReady", () => failed.clear());
