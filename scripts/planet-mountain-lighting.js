/** Sun-facing slopes and short, soft ridge shadows in spherical coordinates. */
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export function createMountainLighting(recipe, terrain) {
  const strength = (recipe.mountainShadows ?? 70) / 100;
  const relief = recipe.mountains / 100 * .026;
  const inlandAt = elevation => smooth(terrain.seaLevel + .004, terrain.seaLevel + .045, elevation);
  return {
    sample(x, y, z, elevation, mountain, light, footprint = 0) {
      const incidence = x * light.x + y * light.y + z * light.z;
      const mask = smooth(.06, .35, mountain) * inlandAt(elevation);
      if (!strength || !relief || !mask || incidence <= 0) return 1;
      const horizontal = Math.sqrt(Math.max(0, 1 - incidence * incidence));
      if (horizontal < .01) return 1;
      const dx = (light.x - incidence * x) / horizontal;
      const dy = (light.y - incidence * y) / horizontal;
      const dz = (light.z - incidence * z) / horizontal;
      const height = mountain * relief * inlandAt(elevation);
      const heightAt = distance => {
        const px = x + dx * distance, py = y + dy * distance, pz = z + dz * distance;
        const length = Math.hypot(px, py, pz), u = px / length, v = py / length, w = pz / length;
        const n = terrain.elevation(u, v, w);
        return terrain.mountainAt(u, v, w) * relief * inlandAt(n);
      };
      // Filter slope detail to the pixel footprint so small peaks don't sparkle.
      const step = Math.max(.002, Math.min(.012, footprint * .6));
      const slope = (height - heightAt(step)) / step;
      const facing = clamp(1 + slope * horizontal * .75, .48, 1.16);
      let occlusion = 0;
      if (incidence < .65) {
        const rise = incidence / horizontal;
        for (const distance of [.009, .020, .040]) {
          if (distance < step) continue;
          // Curvature lifts the light ray above the spherical horizon.
          const obstruction = heightAt(distance) - height - distance * rise - distance * distance * .5;
          occlusion = Math.max(occlusion, smooth(0, .002 + footprint * .12, obstruction));
        }
      }
      const result = facing * (1 - occlusion * .52);
      return 1 + (result - 1) * mask * strength * smooth(0, .08, incidence);
    },
  };
}
