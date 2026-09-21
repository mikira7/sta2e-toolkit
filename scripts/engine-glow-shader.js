/** Continuous engine light, evaluated once per pixel across the whole curve. */
const MAX_POINTS = 128;
const VERTEX = `
precision highp float;
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vPosition;
void main() {
  vPosition = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;
const FRAGMENT = `
precision highp float;
varying vec2 vPosition;
uniform vec4 uPath[${MAX_POINTS}]; // xy position, z arc length, w opacity
uniform float uCount;
uniform vec3 uColor;
uniform float uWidth;
uniform float uGlow;
uniform float uLength;
uniform float uAlpha;
uniform float uTime;
uniform float uReveal;
uniform float uWarp;
uniform float uTaper;
uniform float uParentAlpha;
void main() {
  float nearest = 1.0e20;
  float strength = 0.0;
  float arc = 0.0;
  // One distance field avoids overlapping triangles, miter spikes and beads
  // at tight bends. Adjacent segments never add light together.
  for (int i = 0; i < ${MAX_POINTS - 1}; i++) {
    if (float(i + 1) >= uCount) break;
    vec4 a = uPath[i];
    vec4 b = uPath[i + 1];
    vec2 delta = b.xy - a.xy;
    float t = clamp(dot(vPosition - a.xy, delta) / max(dot(delta, delta), 0.0001), 0.0, 1.0);
    float along = mix(a.z, b.z, t);
    float fraction = clamp(along / uLength, 0.0, 1.0);
    float taper = mix(1.0, 1.0 - fraction * 0.65, uTaper);
    float distanceToPath = length(vPosition - mix(a.xy, b.xy, t)) / taper;
    if (distanceToPath < nearest) {
      nearest = distanceToPath;
      arc = along;
      strength = mix(a.w, b.w, t) * mix(1.0, pow(1.0 - fraction, 0.7), uTaper);
    }
  }
  float coreRadius = max(0.5, uWidth * 0.5);
  float radius = coreRadius + uGlow;
  float core = exp(-2.8 * pow(nearest / coreRadius, 2.0));
  float bloom = exp(-3.5 * pow(nearest / radius, 2.0)) * min(1.0, uGlow) * 0.28;
  float edge = 1.0 - smoothstep(radius * 0.75, radius, nearest);
  float reveal = 1.0 - smoothstep(uReveal * (uLength + radius) - radius,
    uReveal * (uLength + radius), arc);
  // Modulate the whole light together, never little dots along the spline.
  float shimmer = 0.985 + 0.015 * sin(uTime * 2.5);
  float alpha = clamp((core * 0.78 + bloom) * edge * reveal * strength * uAlpha * shimmer, 0.0, 1.0) * uParentAlpha;
  vec3 color = mix(uColor, vec3(1.0), core * mix(0.25, 0.5, uWarp));
  gl_FragColor = vec4(color * alpha, alpha);
}`;

// Keep samples at bends instead of uniformly skipping points. Long, straight
// nacelles then need only one segment evaluation per pixel.
function simplifyPath(points, tolerance) {
  const keep = new Set([0, points.length - 1]);
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop();
    const a = points[first], b = points[last];
    const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
    let maxError = tolerance * tolerance, selected = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (lengthSq || 1)));
      const error = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
      if (error > maxError) { maxError = error; selected = i; }
    }
    if (selected >= 0) {
      keep.add(selected);
      pending.push([first, selected], [selected, last]);
    }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}

/** Returns null on unsupported renderers, preserving the Graphics fallback. */
export function createEngineGlow({ color, width, glowSize, warp = false, blendMode = 'add' }) {
  const renderer = globalThis.canvas?.app?.renderer;
  if (!globalThis.PIXI?.Shader || !PIXI.Mesh || !renderer?.gl) return null;
  // Foundry's installed PIXI 7 shader contract is verified by the browser test.
  if (Number.parseInt(PIXI.VERSION, 10) !== 7) return null;
  const positions = new Float32Array(8);
  const uniforms = {
    uPath: new Float32Array(MAX_POINTS * 4), uCount: 0,
    uColor: new Float32Array([(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255]),
    uWidth: Math.max(1, width), uGlow: Math.max(0, glowSize), uLength: 1,
    uAlpha: 1, uTime: 0, uReveal: 1, uWarp: warp ? 1 : 0, uTaper: 0, uParentAlpha: 1,
  };
  let geometry, shader, mesh;
  try {
    geometry = new PIXI.Geometry().addAttribute('aVertexPosition', positions, 2).addIndex([0, 1, 2, 0, 2, 3]);
    shader = PIXI.Shader.from(VERTEX, FRAGMENT, uniforms);
    // Recompiling a shared, bound program invalidates PIXI's binding cache.
    if (!shader.program.glPrograms[renderer.CONTEXT_UID]) renderer.shader.generateProgram(shader);
    const program = shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
    if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) throw new Error('Engine glow shader failed to link');
    mesh = new PIXI.Mesh(geometry, shader);
    mesh.blendMode = blendMode;
    mesh.visible = false;
  } catch (error) {
    mesh?.destroy(); geometry?.destroy(); shader?.destroy();
    console.warn('STA2e Toolkit | Engine shader unavailable; using ribbon fallback.', error);
    return null;
  }
  shader.update = () => { uniforms.uParentAlpha = shader.alpha; };
  let destroyed = false;
  return {
    mesh,
    update(points, { alpha = 1, time = 0, reveal = 1, taper = false } = {}) {
      if (destroyed) return;
      const path = [];
      for (const p of points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const last = path[path.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) path.push(p);
      }
      mesh.visible = path.length > 1 && alpha > 0;
      if (!mesh.visible) return;
      // Preserve age samples on trails; simplify constant-brightness nacelles.
      let tolerance = 0.15;
      let sampled = taper ? path : simplifyPath(path, tolerance);
      while (sampled.length > MAX_POINTS) sampled = simplifyPath(path, tolerance *= 2);
      const origin = sampled[0];
      let length = 0, minX = 0, maxX = 0, minY = 0, maxY = 0;
      for (let i = 0; i < sampled.length; i++) {
        const p = sampled[i], x = p.x - origin.x, y = p.y - origin.y;
        if (i) length += Math.hypot(p.x - sampled[i - 1].x, p.y - sampled[i - 1].y);
        uniforms.uPath.set([x, y, length, Math.max(0, Math.min(1, p.strength ?? 1))], i * 4);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const radius = uniforms.uWidth * 0.5 + uniforms.uGlow;
      positions.set([minX - radius, minY - radius, maxX + radius, minY - radius,
        maxX + radius, maxY + radius, minX - radius, maxY + radius]);
      mesh.position.set(origin.x, origin.y);
      geometry.getBuffer('aVertexPosition').update();
      Object.assign(uniforms, { uCount: sampled.length, uLength: Math.max(0.01, length), uAlpha: alpha,
        uTime: time % 4096, uReveal: Math.max(0, Math.min(1, reveal)), uTaper: taper ? 1 : 0 });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      mesh.destroy(); geometry.destroy(); shader.destroy();
    },
  };
}
