// Offline bake: node tools/bake-biome-textures.mjs. Original synthetic maps.
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
const size = 96, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };
function hash(x, y, seed) {
  let n = Math.imul(x + seed * 137, 374761393) ^ Math.imul(y + 47, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967295;
}
function noise(x, y, cells, seed) {
  x *= cells; y *= cells; const ix = Math.floor(x), iy = Math.floor(y), tx = smooth(x - ix), ty = smooth(y - iy);
  const at = (a, b) => hash((a % cells + cells) % cells, (b % cells + cells) % cells, seed);
  return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
}
const names = ["forest", "grassland", "desert", "tundra", "alpine"], maps = [];
for (const [kind, name] of names.entries()) for (let variant = 0; variant < 2; variant++) {
  const albedo = [], height = [], seed = 317 + kind * 71 + variant * 19;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const warp = (noise(u, v, 4, seed + 7) - .5) * .18;
    const broad = noise(u + warp, v - warp, 8, seed), fine = noise(u, v, 32, seed + 31);
    let a, h;
    if (name === "forest") {
      // Irregular forest cover and clearings, rather than individual trees.
      const clearing = smooth((noise(u + warp, v - warp, 32, seed + 17) - .52) * 3);
      a = .42 + broad * .23 + clearing * .16 + (fine - .5) * .08;
      h = .40 + broad * .15 + clearing * .08;
    } else if (name === "grassland") {
      const drainage = 1 - Math.abs(noise(u + warp, v, 16, seed + 13) * 2 - 1);
      a = .42 + broad * .30 - drainage ** 10 * .12 + (fine - .5) * .04;
      h = .38 + broad * .22 - drainage ** 10 * .06;
    } else if (name === "desert") {
      // Periodic winding dune fields surrounded by flatter exposed plateaus.
      const phase = u * Math.PI * 2 * (10 + variant * 3) + Math.sin(v * Math.PI * 4) * 2 + warp * 8;
      const dune = Math.sin(phase) * .5 + .5, field = smooth((broad - .47) * 4.2);
      a = .45 + broad * .20 + (dune - .5) * .20 * field;
      h = .36 + broad * .22 + (dune - .5) * .23 * field;
    } else if (name === "tundra") {
      const thaw = smooth((noise(u + warp, v - warp, 16, seed + 11) - .46) * 3);
      a = .42 + broad * .26 + thaw * .18 + (fine - .5) * .05;
      h = .40 + broad * .18 + thaw * .05;
    } else {
      // Nested warped ridges and eroded valley channels at several scales.
      const ridge = 1 - Math.abs(noise(u + warp, v - warp, 8, seed + 17) * 2 - 1);
      const tributary = 1 - Math.abs(noise(u + warp * .4, v, 24, seed + 43) * 2 - 1);
      h = .20 + ridge ** 2 * .55 + tributary ** 4 * .15;
      a = .40 + ridge * .32 - tributary ** 8 * .09 + (fine - .5) * .05;
    }
    albedo.push(clamp(a)); height.push(clamp(h));
  }
  maps.push({ name: `${name}-${variant}`, albedo, height });
}
const encode = values => values.map(v => { const byte = Math.round(v * 255); return alphabet[byte >>> 6] + alphabet[byte & 63]; }).join("");
const encoded = maps.map(({ name, albedo, height }) => ({ name, albedo: encode(albedo), height: encode(height) }));
await writeFile(new URL("../scripts/biome-texture-data.js", import.meta.url), `/** Baked by tools/bake-biome-textures.mjs; do not hand-edit. */\nexport const BIOME_MAP_SIZE = ${size};\nconst alphabet = "${alphabet}";\nconst decode = text => Float32Array.from({ length: text.length / 2 }, (_, i) => (alphabet.indexOf(text[i * 2]) * 64 + alphabet.indexOf(text[i * 2 + 1])) / 255);\nexport const BIOME_MAPS = ${JSON.stringify(encoded, null, 2)}.map(({ name, albedo, height }) => ({ name, albedo: decode(albedo), height: decode(height) }));\n`);
// Five columns, two variants; albedo then height for each variant.
const width = size * 5, atlasHeight = size * 4, bytes = Buffer.alloc((width * 4 + 1) * atlasHeight);
for (let k = 0; k < maps.length; k++) for (let channel = 0; channel < 2; channel++) {
  const values = maps[k][channel ? "height" : "albedo"], column = Math.floor(k / 2), row = k % 2 * 2 + channel;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (row * size + y) * (width * 4 + 1) + 1 + (column * size + x) * 4, value = Math.round(values[y * size + x] * 255);
    bytes[i] = bytes[i + 1] = bytes[i + 2] = value; bytes[i + 3] = 255;
  }
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4); let crc = -1;
  for (const b of Buffer.concat([name, data])) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (0xedb88320 & -(crc & 1)); }
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ -1) >>> 0); return Buffer.concat([length, name, data, checksum]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(atlasHeight, 4); header[8] = 8; header[9] = 6;
await mkdir(new URL("../assets/planets/", import.meta.url), { recursive: true });
await writeFile(new URL("../assets/planets/class-m-biome-atlas.png", import.meta.url), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(bytes)), chunk("IEND", Buffer.alloc(0))]));
console.log("Baked two variants each of forest, grassland, desert, tundra, and alpine albedo/height maps.");
