/** Soft, procedural engine ribbons. No filter plug-in or offscreen blur needed. */
const VERTEX = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aEngineCoord;
attribute float aStrength;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vEngineCoord;
varying float vStrength;
void main() {
  vEngineCoord = aEngineCoord;
  vStrength = aStrength;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 vEngineCoord;
varying float vStrength;
uniform vec3 uColor;
uniform float uWidth;
uniform float uGlow;
uniform float uLength;
uniform float uAlpha;
uniform float uTime;
uniform float uReveal;
uniform float uWarp;
uniform float uParentAlpha;
void main() {
  // Distance from the centreline, including rounded ends beyond the curve.
  float endDistance = max(-vEngineCoord.x, vEngineCoord.x - uLength);
  float d = length(vec2(max(0.0, endDistance), vEngineCoord.y));
  float coreRadius = max(0.5, uWidth * 0.5);
  float radius = coreRadius + uGlow;
  float core = exp(-2.8 * pow(d / coreRadius, 2.0));
  float bloom = exp(-3.5 * pow(d / radius, 2.0)) * min(1.0, uGlow) * 0.28;
  float edge = 1.0 - smoothstep(radius * 0.75, radius, d);
  // A soft ignition front; very small modulation keeps powered nacelles calm.
  float reveal = 1.0 - smoothstep(uReveal * (uLength + radius * 2.0) - radius,
    uReveal * (uLength + radius * 2.0), vEngineCoord.x);
  float shimmer = 0.975 + 0.025 * sin(vEngineCoord.x * 0.065 - uTime * 2.5);
  float alpha = clamp((core * 0.78 + bloom) * edge * reveal * vStrength * uAlpha * shimmer, 0.0, 1.0) * uParentAlpha;
  vec3 color = mix(uColor, vec3(1.0), core * mix(0.25, 0.5, uWarp));
  gl_FragColor = vec4(color * alpha, alpha);
}`;

/** Returns null on unsupported renderers, allowing the existing Graphics path. */
export function createEngineGlow({ color, width, glowSize, warp = false, blendMode = 'add' }) {
  const renderer = globalThis.canvas?.app?.renderer;
  if (!globalThis.PIXI?.Shader || !PIXI.Mesh || !renderer?.gl) return null;
  // Foundry's installed renderer uses PIXI 7. Other renderer generations keep
  // the existing Graphics effect until their shader contract is verified.
  if (Number.parseInt(PIXI.VERSION, 10) !== 7) return null;
  let geometry, shader, mesh;
  const capacity = 132; // Up to 128 curve samples plus two rounded end caps.
  const positions = new Float32Array(capacity * 4);
  const coordinates = new Float32Array(capacity * 4);
  const strengths = new Float32Array(capacity * 2);
  const indices = new Uint16Array((capacity - 1) * 6);
  for (let i = 0; i < capacity - 1; i++) {
    const v = i * 2;
    indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
  }
  const uniforms = {
    uColor: new Float32Array([(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255]),
    uWidth: Math.max(1, width), uGlow: Math.max(0, glowSize), uLength: 1,
    uAlpha: 1, uTime: 0, uReveal: 1, uWarp: warp ? 1 : 0, uParentAlpha: 1,
  };
  try {
    geometry = new PIXI.Geometry()
        .addAttribute('aVertexPosition', positions, 2)
        .addAttribute('aEngineCoord', coordinates, 2)
        .addAttribute('aStrength', strengths, 1)
        .addIndex(indices);
      shader = PIXI.Shader.from(VERTEX, FRAGMENT, uniforms);
      // Catch compile failures before the mesh can interrupt Foundry's render loop.
      // Shader.from shares programs. Recompiling an already-bound program would
      // leave PIXI's binding cache pointing at the old GPU program.
      if (!shader.program.glPrograms[renderer.CONTEXT_UID]) renderer.shader.generateProgram(shader);
      const program = shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
      if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) {
        throw new Error('Engine glow shader failed to link');
      }
      mesh = new PIXI.Mesh(geometry, shader);
    mesh.blendMode = blendMode;
    mesh.visible = false;
  } catch (error) {
    mesh?.destroy();
    geometry?.destroy();
    shader?.destroy();
    console.warn('STA2e Toolkit | Engine shader unavailable; using ribbon fallback.', error);
    return null;
  }
  const live = shader.uniforms;
  shader.update = () => { live.uParentAlpha = shader.alpha; };
  let destroyed = false;
  return {
    mesh,
    update(points, { alpha = 1, time = 0, reveal = 1, taper = false } = {}) {
      if (destroyed) return;
      // Remove coincident points before constructing normals (stationary emitters).
      const path = [];
      for (const p of points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const last = path[path.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) path.push(p);
      }
      mesh.visible = path.length > 1 && alpha > 0;
      if (!mesh.visible) return;
      const sampled = path.length <= 128 ? path : Array.from({ length: 128 }, (_, i) => path[Math.round(i * (path.length - 1) / 127)]);
      const distances = [0];
      for (let i = 1; i < sampled.length; i++) distances.push(distances[i - 1] + Math.hypot(sampled[i].x - sampled[i - 1].x, sampled[i].y - sampled[i - 1].y));
      const length = distances[distances.length - 1];
      const radius = uniforms.uWidth * 0.5 + uniforms.uGlow;
      const tangent = (a, b) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      };
      const first = sampled[0], last = sampled[sampled.length - 1];
      const startDir = tangent(first, sampled[1]), endDir = tangent(sampled[sampled.length - 2], last);
      const rows = [
        { ...first, x: first.x - startDir.x * radius, y: first.y - startDir.y * radius },
        ...sampled,
        { ...last, x: last.x + endDir.x * radius, y: last.y + endDir.y * radius },
      ];
      const arcs = [-radius, ...distances, length + radius];
      for (let i = 0; i < rows.length; i++) {
        const p = rows[i];
        const dir = tangent(rows[Math.max(0, i - 1)], rows[Math.min(rows.length - 1, i + 1)]);
        const fraction = Math.max(0, Math.min(1, arcs[i] / length));
        const half = radius * (taper ? 1 - fraction * 0.65 : 1);
        positions.set([p.x - dir.y * half, p.y + dir.x * half, p.x + dir.y * half, p.y - dir.x * half], i * 4);
        coordinates.set([arcs[i], -radius, arcs[i], radius], i * 4);
        const strength = Math.max(0, Math.min(1, p.strength ?? 1)) * (taper ? Math.pow(1 - fraction, 0.7) : 1);
        strengths.set([strength, strength], i * 2);
      }
      // Degenerate unused triangles so a shorter path cannot leave stale geometry.
      for (let i = rows.length; i < capacity; i++) {
        positions.set(positions.subarray((rows.length - 1) * 4, rows.length * 4), i * 4);
        coordinates.set(coordinates.subarray((rows.length - 1) * 4, rows.length * 4), i * 4);
        strengths.set([0, 0], i * 2);
      }
      for (const name of ['aVertexPosition', 'aEngineCoord', 'aStrength']) geometry.getBuffer(name).update();
      Object.assign(live, { uLength: length, uAlpha: alpha, uTime: time % 4096, uReveal: Math.max(0, Math.min(1, reveal)) });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      mesh.destroy();
      geometry.destroy();
      shader.destroy();
    },
  };
}
