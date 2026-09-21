/** Spherical gas-cloud and radial ring materials. No screen-space randomness. */
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
export const RING_BODY_SCALE = .54;
export const RING_STYLES = { icy: "Broad icy rings", dusty: "Faint dusty rings", narrow: "Narrow rings" };
// A normalized light direction shared by surface and ring shadow rays.
const length = Math.hypot(.30, .954);
export const PLANET_LIGHT = { y: -.30 / length, z: .954 / length };
export const isIceGiantTexture = texture => texture === "ice-hazy" || texture === "ice-stormy";

/** Visible-light ice-giant atmosphere: low-contrast decks beneath haze, with
 * sparse high clouds and dark vortices. All detail is anchored to the sphere.
 */
function createIceGiantMaterial(recipe, { noise, fbm }, colors, rampAt) {
  const stormy = recipe.texture === "ice-stormy";
  const belts = Array.from({ length: 7 }, (_, i) => ({
    latitude: -1.2 + i * .38 + (noise(i, 43, 17) - .5) * .16,
    width: .12 + noise(i, 19, 83) * .17,
    depth: (noise(i, 31, 67) - .5) * (stormy ? .24 : .09),
  }));
  const longitude = Math.PI / 2 + (noise(13, 71, 29) - .5) * .7;
  const latitude = -.35 + (noise(17, 23, 91) - .5) * .25;
  const storms = Array.from({ length: stormy ? 6 : 2 }, (_, i) => ({
    longitude: i < 2 ? longitude + i * .12 : (noise(i, 61, 37) * 2 - 1) * Math.PI,
    latitude: i < 2 ? latitude + i * .13 : (noise(i, 23, 83) * 2 - 1) * 1.1,
    width: i === 0 && stormy ? .20 : .10 + noise(i, 71, 41) * .12,
    height: i === 0 && stormy ? .085 : .015 + noise(i, 53, 11) * .016,
    dark: stormy && i === 0,
  }));
  const hazeColor = rampAt(.78), highCloud = blend(rampAt(1), colors.cloud, .5);
  const sampleSurface = (x, y, z) => {
    const lat = Math.asin(clamp(y, -1, 1)), lon = Math.atan2(z, x);
    // Rotate a spherical domain for zonal shear. It stays continuous at both
    // poles, unlike a longitude texture stretched into the polar pixel.
    const shear = Math.sin(lat * 5) * .25, c = Math.cos(shear), s = Math.sin(shear);
    const ax = x * c - z * s, az = x * s + z * c;
    const weather = fbm(ax * 5 + 17, y * 18 + 41, az * 5 + 73, 4);
    const fine = fbm(ax * 24 + 5, y * 100 + 19, az * 24 + 61, 3);
    const bandLatitude = lat + (weather - .5) * .025 * Math.cos(lat);
    let tone = .48 + (weather - .5) * (stormy ? .075 : .025);
    for (const belt of belts) {
      const d = (bandLatitude - belt.latitude) / belt.width;
      tone += belt.depth * Math.exp(-d * d);
    }
    let color = rampAt(tone);
    color = blend(color, hazeColor, stormy ? .12 : .36);
    color = blend(color, highCloud, Math.pow(clamp((fine - .48) * 2), 2) * (stormy ? .045 : .01));
    for (const storm of storms) {
      const v = (lat - storm.latitude) / storm.height;
      if (Math.abs(v) > 2.5) continue;
      const u = wrap(lon - storm.longitude) * Math.cos(storm.latitude) / storm.width;
      const q = u * u + v * v;
      if (q > 6.25) continue;
      const edge = 1 - smooth(3, 6.25, q);
      // Clouds feather into their surroundings, with fine breakup instead of
      // solid white ovals. The dark vortex stays beneath the overlying haze.
      const mask = Math.exp(-q * (storm.dark ? 1.2 : .85)) * edge;
      if (storm.dark) color = blend(color, rampAt(.03), mask * .62);
      else color = blend(color, highCloud, mask * (.4 + fine * .6) * (stormy ? .55 : .14));
    }
    const cap = smooth(.48, 1.35, lat) * (stormy ? .13 : .27);
    const capDetail = fbm(x * 12 + 11, y * 12 + 31, z * 12 + 53, 3);
    color = blend(color, hazeColor, cap * (.9 + capDetail * .2));
    return { color, emission: null };
  };
  return { sample: (x, y, z) => sampleSurface(x, y, z).color, sampleSurface, belts, storms };
}

export function createGasGiantMaterial(recipe, { noise, fbm }, colors) {
  const hot = recipe.texture === "hot";
  const soft = recipe.texture === "smooth", turbulent = recipe.texture === "turbulent" || hot;
  const ramp = recipe.gasColors?.length >= 3
    ? recipe.gasColors.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)))
    : [colors.surfaceLow, blend(colors.surfaceLow, colors.surfaceHigh, .5), colors.surfaceHigh];
  const rampAt = value => {
    const position = clamp(value) * (ramp.length - 1), index = Math.min(ramp.length - 2, Math.floor(position));
    return blend(ramp[index], ramp[index + 1], smooth(0, 1, position - index));
  };
  if (isIceGiantTexture(recipe.texture)) return createIceGiantMaterial(recipe, { noise, fbm }, colors, rampAt);
  const belts = [];
  for (let i = 0; i < 12; i++) {
    const hemisphere = i < 6 ? -1 : 1, j = i % 6;
    belts.push({
      latitude: hemisphere * (.19 + j * .22 + (noise(i, 13, 71) - .5) * .07),
      width: .035 + noise(i, 37, 59) * .045,
      depth: (soft ? .13 : .24) + noise(i, 41, 79) * (soft ? .07 : .18),
    });
  }
  const storms = Array.from({ length: soft ? 3 : turbulent ? 18 : 11 }, (_, i) => ({
    longitude: i === 0 ? Math.PI / 2 + (noise(i, 17, 43) - .5) * .7 : (noise(i, 61, 37) * 2 - 1) * Math.PI,
    latitude: i === 0 ? -.33 : (noise(i, 23, 83) * 2 - 1) * 1.2,
    width: i === 0 ? .28 : .055 + noise(i, 71, 41) * .09,
    height: i === 0 ? .09 : .023 + noise(i, 53, 11) * .035,
    spin: (i % 2 ? 1 : -1) * (2 + noise(i, 29, 67) * 2),
    tint: rampAt(i === 0 ? .28 : .55 + noise(i, 89, 13) * .45),
    strength: soft ? .2 : i === 0 ? .65 : .45,
  }));
  const lightCloud = blend(ramp.at(-1), colors.cloud, .18);
  const sampleSurface = (x, y, z) => {
    const latitude = Math.asin(clamp(y, -1, 1));
    const longitude = Math.atan2(z, x);
    let lat = latitude, lon = longitude, stormMask = 0, stormColor = null;
    for (const storm of storms) {
      const v = (latitude - storm.latitude) / storm.height;
      if (Math.abs(v) > 2) continue;
      const u = wrap(longitude - storm.longitude) * Math.max(.3, Math.cos(storm.latitude)) / storm.width;
      const q = u * u + v * v;
      if (q > 4) continue;
      // Rotate the local flow in an ellipse, carrying cloud filaments and belt
      // boundaries around the vortex instead of stamping a flat colored oval.
      const twist = storm.spin * Math.exp(-q * .7) * (1 - smooth(1.5, 4, q));
      const cu = u * Math.cos(twist) - v * Math.sin(twist);
      const cv = u * Math.sin(twist) + v * Math.cos(twist);
      lon += (cu - u) * storm.width / Math.max(.3, Math.cos(storm.latitude));
      lat += (cv - v) * storm.height;
      const mask = Math.exp(-q * 1.8) * storm.strength * (1 - smooth(2.5, 4, q));
      if (mask > stormMask) { stormMask = mask; stormColor = storm.tint; }
    }
    // Differential flow stretches weather along latitude. Noise changes local
    // color and cloud height, rather than the phase of hundreds of contour lines.
    const shear = Math.sin(lat * 11) * (soft ? .06 : .22);
    const advected = lon + shear;
    const weather = fbm(Math.cos(advected) * 4 + 17, lat * 28 + 41, Math.sin(advected) * 4 + 73, 4);
    const disturbance = (weather - .5) * (turbulent ? .085 : soft ? .008 : .035) * Math.cos(lat);
    const bandLatitude = lat + disturbance;
    let tone = soft ? .88 : .70 + noise(bandLatitude * 3.7 + 29, 19, 57) * .32;
    for (const belt of belts) {
      const d = Math.abs((bandLatitude - belt.latitude) / belt.width);
      if (d < 2.3) tone -= belt.depth * Math.exp(-(d ** 4)) * 1.75;
    }
    const fine = fbm(Math.cos(advected + weather * .08) * 22 + 5, lat * 150 + 19, Math.sin(advected + weather * .08) * 22 + 61, 3);
    tone += (weather - .5) * (soft ? .05 : .16) + (fine - .5) * (soft ? .025 : .075);
    // The full color ramp spans dark belts, middle cloud decks, and pale zones.
    // Weather shifts locally between neighboring colors without erasing bands.
    let color = rampAt(tone);
    // Wispy high clouds and small convective cells sit over the darker belts.
    const wisps = Math.pow(clamp((fine - .48) * 2.8), 2) * (soft ? .07 : .28);
    color = blend(color, lightCloud, wisps);
    if (stormColor) color = blend(color, stormColor, stormMask * (.75 + fine * .5));
    const polarHaze = smooth(1.15, Math.PI / 2, Math.abs(latitude));
    const polarDetail = fbm(x * 32 + 11, y * 32 + 31, z * 32 + 53, 3);
    color = blend(color, rampAt(.55 + polarDetail * .3), polarHaze);
    if (!hot) return { color, emission: null };

    // An artistic hot-atmosphere treatment: broad advected cloud plumes with
    // fine luminous filaments. Heat lives on the sphere, so both views agree.
    const latitudeRadius = Math.cos(lat);
    const hx = Math.cos(advected) * latitudeRadius, hy = Math.sin(lat), hz = Math.sin(advected) * latitudeRadius;
    const flow = fbm(hx * 3 + 97, hy * 5 + 37, hz * 3 + 19, 4);
    const plumes = fbm(hx * 8 + flow * 3 + 23, hy * 13 + flow * 2 + 59, hz * 8 + flow * 3 + 83, 4);
    // Longitude collapses at the poles. Fade stretched latitude detail into
    // spherical detail there to avoid a pinwheel singularity in polar maps.
    const polarFine = fine * (1 - polarHaze) + polarDetail * polarHaze;
    const hotTone = tone * (1 - polarHaze) + (.55 + polarDetail * .3) * polarHaze;
    const filaments = smooth(.45, .72, polarFine) * smooth(.38, .65, plumes);
    const heat = clamp(.48 + (plumes - .5) * 2.2 + (hotTone - .65) * .28 + filaments * .26);
    color = rampAt(heat);
    const glow = recipe.hotGlow / 100 * (.15 + smooth(.25, .85, heat) * .85);
    return { color, emission: rampAt(Math.min(1, heat + .13)).map(v => v * glow) };
  };
  return { sample: (x, y, z) => sampleSurface(x, y, z).color, sampleSurface, belts, storms };
}

/** A radial optical-depth table and its integral provide footprint filtering.
 * Wide rings contain a translucent inner region, a dense middle region, a
 * major division, an outer region and a thin outer strand. No evenly spaced
 * black/white sine stripes are used.
 */
export function createRingMaterial(recipe, noise) {
  const count = 4096, depth = new Float32Array(count + 1), integral = new Float64Array(count + 1);
  const dusty = recipe.ringStyle === "dusty", narrow = recipe.ringStyle === "narrow";
  const division = .856 + (noise(31, 17, 91) - .5) * .01;
  const ringColor = [1, 3, 5].map(start => parseInt(recipe.ringColor.slice(start, start + 2), 16));
  const density = recipe.ringDensity / 100;
  const band = (r, inner, outer, edge) => smooth(inner, inner + edge, r) * (1 - smooth(outer - edge, outer, r));
  for (let i = 0; i <= count; i++) {
    const r = i / count;
    const broad = .74 + noise(r * 53, 13, 71) * .42;
    const fine = .86 + noise(r * 680, 47, 31) * .18 + noise(r * 1830, 83, 29) * .07;
    let tau;
    if (narrow) {
      tau = band(r, .80, .826, .002) * .55 + band(r, .872, .884, .001) * .8
        + band(r, .944, .958, .002) * 1.1 + band(r, .987, .997, .002) * .55;
    } else {
      tau = band(r, .62, .733, .006) * .15 + band(r, .73, division, .003) * 1.25
        + band(r, division + .026, .977, .003) * .62 + band(r, .988, .998, .002) * .18;
      // Small divisions are irregular and filtered at the output resolution.
      tau *= 1 - band(r, .945, .952, .001) * .86;
    }
    depth[i] = tau * broad * fine * density * (dusty ? .16 : 1);
    if (i) integral[i] = integral[i - 1] + (depth[i - 1] + depth[i]) / (2 * count);
  }
  const interpolate = (table, radius) => {
    const p = clamp(radius) * count, i = Math.min(count - 1, Math.floor(p));
    return table[i] + (table[i + 1] - table[i]) * (p - i);
  };
  const opticalDepth = (radius, footprint = 0) => {
    if (radius + footprint < .61 || radius - footprint > 1) return 0;
    if (footprint < 1 / count) return interpolate(depth, radius);
    return (interpolate(integral, radius + footprint) - interpolate(integral, radius - footprint)) / (2 * footprint);
  };
  const colorAt = radius => {
    const brightness = .72 + noise(radius * 41, 11, 67) * .26;
    const ice = blend(ringColor, [235, 232, 219], radius > division ? .15 : .06);
    return ice.map(v => v * brightness);
  };
  return { opticalDepth, colorAt, division };
}

/** Planet shadow received by a point on the ring plane, in outer-ring units. */
export function ringPlanetShadow(x, y, z, bodyScale = RING_BODY_SCALE, light = PLANET_LIGHT) {
  const dot = x * (light.x ?? 0) + y * light.y + z * light.z;
  if (dot >= 0) return 1;
  const distance = Math.sqrt(Math.max(0, x * x + y * y + z * z - dot * dot));
  return .10 + .90 * smooth(bodyScale - .009, bodyScale + .015, distance);
}

/** Transmission of sunlight from the globe surface through the ring plane. */
export function ringSurfaceTransmission(material, x, y, z, sin, cos, footprint = .002, light = PLANET_LIGHT) {
  const incidence = -sin * light.y + cos * light.z;
  if (Math.abs(incidence) < 1e-5) return 1;
  const t = -(-sin * y + cos * z) / incidence;
  if (t <= 0) return 1;
  const qy = y + t * light.y, qz = z + t * light.z;
  const tau = material.opticalDepth(Math.hypot(x + t * (light.x ?? 0), qy, qz), footprint);
  return Math.exp(-tau / Math.max(.05, Math.abs(incidence)));
}
