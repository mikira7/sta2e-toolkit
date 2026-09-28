/** Turbulent smoke quads. One bounded mesh per ship, with a soft Graphics fallback. */
const VERTEX = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aSmokeUV;
attribute vec4 aSmokeLife;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vUV;
varying vec4 vLife;
void main() {
  vUV = aSmokeUV; vLife = aSmokeLife;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;
const FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec4 vLife;
uniform float uPlasma;
uniform float uParentAlpha;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main() {
  // A continuous, attached nozzle plume gives the vent a readable origin.
  // Only this short core follows the hull; released puffs remain in space.
  if (vLife.z > 0.5) {
    float along = (vUV.x + 1.0) * 0.5;
    float time = vLife.w;
    float n = noise(vec2(along * 8.0 - time * 0.55, vUV.y * 4.0 + vLife.y));
    float bend = sin(along * 9.0 - time * 0.6 + vLife.y) * along * 0.08;
    float width = mix(0.12, 0.88, pow(along, 0.75));
    float across = abs(vUV.y - bend);
    float body = 1.0 - smoothstep(width * 0.2, width, across + (n-0.5) * along * 0.12);
    float core = exp(-pow(across / max(0.03, width * 0.22), 2.0) * 2.0);
    float fade = (1.0 - smoothstep(0.45, 1.0, along));
    float alpha = (body * (0.42 + n * 0.28) + core * 0.22) * fade * mix(0.7, 1.0, uPlasma) * uParentAlpha;
    vec3 smoke = mix(vec3(0.42,0.48,0.50), vec3(0.86,0.91,0.93), core * 0.5 + n * 0.2);
    vec3 plasma = mix(vec3(0.10,0.63,0.79), vec3(0.82,0.98,1.0), core * 0.8 + n * 0.15);
    gl_FragColor = vec4(mix(smoke, plasma, uPlasma) * alpha, alpha);
    return;
  }
  float age = vLife.x;
  vec2 p = vUV * 3.8 + vLife.y;
  p += vec2(noise(p + age), noise(p - age)) * 0.9;
  float n = noise(p + vec2(age * 1.7, -age)) * 0.65 + noise(p * 2.1 - age) * 0.35;
  float envelope = 1.0 - smoothstep(0.18, 1.0, length(vUV) + (n - 0.5) * 0.25);
  float alpha = envelope * (0.42 + n * 0.58) * smoothstep(0.0, 0.04, age) * pow(1.0-age, 1.35) * mix(0.68, 0.88, uPlasma) * uParentAlpha;
  vec3 smoke = mix(vec3(0.20,0.23,0.26), vec3(0.66,0.70,0.73), n);
  vec3 plasma = mix(vec3(0.13,0.40,0.46), vec3(0.48,0.88,1.0), (1.0-age) * (0.45+n*0.55));
  gl_FragColor = vec4(mix(smoke, plasma, uPlasma) * alpha, alpha);
}`;

export const MAX_BREACH_PUFFS = 160;
const MAX_QUADS = MAX_BREACH_PUFFS + 4;

// Oriented quads make gas stretch along its release direction instead of
// reading as a collection of round clouds. Directions never follow later turns.
function quad(x, y, along, across, angle = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const points = [];
  for (const [u, v] of [[-along,-across], [along,-across], [along,across], [-along,across]]) {
    points.push(x + u*c - v*s, y + u*s + v*c);
  }
  return points;
}

export function createBreachSmokeRenderer(plasma) {
  const renderer = globalThis.canvas?.app?.renderer;
  let geometry, shader, mesh;
  // Use the same verified PIXI 7 contract as engine-glow-shader. Other
  // renderers retain world-space smoke using soft concentric Graphics puffs.
  if (Number.parseInt(PIXI.VERSION, 10) === 7 && renderer?.gl) {
    try {
      const positions = new Float32Array(MAX_QUADS * 8);
      const uv = new Float32Array(MAX_QUADS * 8);
      const life = new Float32Array(MAX_QUADS * 16);
      const indices = [];
      for (let i = 0; i < MAX_QUADS; i++) {
        uv.set([-1,-1, 1,-1, 1,1, -1,1], i * 8);
        const b = i * 4; indices.push(b,b+1,b+2,b,b+2,b+3);
      }
      geometry = new PIXI.Geometry().addAttribute('aVertexPosition', positions, 2)
        .addAttribute('aSmokeUV', uv, 2).addAttribute('aSmokeLife', life, 4).addIndex(indices);
      shader = PIXI.Shader.from(VERTEX, FRAGMENT, { uPlasma: plasma ? 1 : 0, uParentAlpha: 1 });
      if (!shader.program.glPrograms[renderer.CONTEXT_UID]) renderer.shader.generateProgram(shader);
      const program = shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
      if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) throw new Error('Smoke shader failed to link');
      shader.update = () => { shader.uniforms.uParentAlpha = shader.alpha; };
      mesh = new PIXI.Mesh(geometry, shader);
      mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
      return {
        display: mesh,
        update(puffs, jets = [], time = 0) {
          positions.fill(0); life.fill(0);
          puffs.slice(0, MAX_BREACH_PUFFS).forEach((p, i) => {
            const age = p.age / p.life;
            const r = p.size * (0.35 + age * 2.2);
            positions.set(quad(p.x, p.y, r * 1.5, r * 0.75, p.angle ?? 0), i * 8);
            for (let j = 0; j < 4; j++) life.set([age, p.seed, 0, 0], i * 16 + j * 4);
          });
          jets.slice(0, 4).forEach((jet, index) => {
            const i = MAX_BREACH_PUFFS + index, half = jet.length / 2;
            positions.set(quad(jet.x + Math.cos(jet.angle)*half, jet.y + Math.sin(jet.angle)*half,
              half, jet.width, jet.angle), i * 8);
            for (let j = 0; j < 4; j++) life.set([0, index * 7.3, 1, time % 4096], i * 16 + j * 4);
          });
          geometry.getBuffer('aVertexPosition').update();
          geometry.getBuffer('aSmokeLife').update();
        },
        destroy() { mesh.destroy(); geometry.destroy(); shader.destroy(); },
      };
    } catch (error) {
      mesh?.destroy(); geometry?.destroy(); shader?.destroy();
      console.warn('STA2e Toolkit | Smoke shader unavailable; using soft puffs.', error);
    }
  }
  const g = new PIXI.Graphics();
  return {
    display: g,
    update(puffs, jets = []) {
      g.clear();
      for (const p of puffs) {
        const age = p.age / p.life, radius = p.size * (0.4 + age * 2.6);
        const alpha = Math.min(1, age / 0.04) * (1-age) ** 1.35 * (plasma ? 0.11 : 0.085);
        for (let i = 5; i >= 1; i--) {
          const color = plasma ? 0x75cedc : 0x859098;
          if (typeof g.beginFill === 'function') {
            g.beginFill(color, alpha).drawCircle(p.x, p.y, radius * i / 5).endFill();
          } else g.circle(p.x, p.y, radius * i / 5).fill({ color, alpha });
        }
      }
      // Soft nested cones retain a defined vent even without a custom shader.
      for (const jet of jets.slice(0, 4)) {
        const c = Math.cos(jet.angle), s = Math.sin(jet.angle);
        for (let i = 4; i >= 1; i--) {
          const w = jet.width * i / 4;
          const points = [jet.x-s*w*0.1, jet.y+c*w*0.1,
            jet.x+c*jet.length-s*w, jet.y+s*jet.length+c*w,
            jet.x+c*jet.length+s*w, jet.y+s*jet.length-c*w,
            jet.x+s*w*0.1, jet.y-c*w*0.1];
          const color = plasma ? (i === 1 ? 0xd1faff : 0x48bfda) : 0xaac0c6;
          if (typeof g.beginFill === 'function') g.beginFill(color, 0.07).drawPolygon(points).endFill();
          else g.poly(points).fill({ color, alpha: 0.07 });
        }
      }
    },
    destroy() { g.destroy(); },
  };
}
