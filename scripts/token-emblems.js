/**
 * sta2e-toolkit | token-emblems.js
 *
 * Emblems the Token Maker stamps on a token — a commbadge, a faction or species
 * insignia — in a disc at the bottom right, opposite the rank pips. They used
 * to be painted into the dynamic ring art, which made every token in the world
 * wear the same badge: a ring has one design per world. As a stamped layer an
 * emblem is per token, like the pips.
 *
 * Three kinds:
 *   built-in  drawn here in vector (`tng`, `ds9` commbadges) — crisp at any size
 *   shipped   images bundled in assets/emblems/ (Starfleet, Cardassian, Klingon),
 *             each with its own default framing (`frame`)
 *   library   an image in the world setting `tokenEmblems` ({id, name, src}),
 *             added from the Token Maker. A PNG/JPG is converted to WebP on the
 *             way in (`convertToWebp`) and saved to worlds/<world>/sta2e-emblems/.
 *
 * Framing: `disc` puts the emblem on a gold-rimmed starfield disc (the commbadge
 * look); `oval` is the same plate drawn as an upright ellipse, for tall insignia
 * that would sit small in a circle; `plain` draws the image alone, for insignia
 * that bring their own shape. The vector built-ins always use their disc.
 */

const MODULE = "sta2e-toolkit";
export const EMBLEM_SETTING = "tokenEmblems";
export const EMBLEM_DIR = () => `worlds/${game.world.id}/sta2e-emblems`;

const EMBLEM_ASSETS = `modules/${MODULE}/assets/emblems`;

export const BUILTIN_EMBLEMS = [
  { id: "tng", name: "Starfleet Commbadge (TNG)" },
  { id: "ds9", name: "Starfleet Commbadge (DS9/VOY)" },
  { id: "starfleet-command", name: "Starfleet Command", src: `${EMBLEM_ASSETS}/starfleet-command.webp`, frame: "disc" },
  { id: "starfleet-delta",   name: "Starfleet Delta",   src: `${EMBLEM_ASSETS}/starfleet-delta.webp`,   frame: "disc" },
  { id: "cardassian-union",  name: "Cardassian Union",  src: `${EMBLEM_ASSETS}/cardassian-union.webp`,  frame: "oval" },
  { id: "klingon-empire",    name: "Klingon Empire",    src: `${EMBLEM_ASSETS}/klingon-empire.webp`,    frame: "plain" },
];

/** The two commbadges drawn in vector here; every other emblem is an image. */
export const VECTOR_EMBLEMS = new Set(["tng", "ds9"]);

// ── Library ──────────────────────────────────────────────────────────────────

export function registerEmblemSettings() {
  game.settings.register(MODULE, EMBLEM_SETTING, {
    name:    "Token Emblems",
    scope:   "world",
    config:  false,
    type:    Array,
    default: [],
  });
}

/** Built-ins first, then the world's library. */
export function listEmblems() {
  let lib = [];
  try { lib = game.settings.get(MODULE, EMBLEM_SETTING) ?? []; } catch { /* not ready */ }
  return [
    ...BUILTIN_EMBLEMS.map(e => ({ ...e, builtin: true })),
    ...lib.filter(e => e?.id && e?.src).map(e => ({ id: `lib:${e.id}`, name: e.name || "Emblem", src: e.src, builtin: false })),
  ];
}

export function findEmblem(id) {
  return listEmblems().find(e => e.id === id) ?? null;
}

export async function addEmblemToLibrary({ name, src }) {
  const lib = [...(game.settings.get(MODULE, EMBLEM_SETTING) ?? [])];
  const id = Math.random().toString(36).slice(2, 10);
  lib.push({ id, name: String(name || "Emblem").trim(), src });
  await game.settings.set(MODULE, EMBLEM_SETTING, lib);
  return `lib:${id}`;
}

export async function removeEmblemFromLibrary(id) {
  const raw = String(id).replace(/^lib:/, "");
  const lib = (game.settings.get(MODULE, EMBLEM_SETTING) ?? []).filter(e => e.id !== raw);
  await game.settings.set(MODULE, EMBLEM_SETTING, lib);
}

// ── Conversion ───────────────────────────────────────────────────────────────

/**
 * Re-encode any image the browser can read as WebP (lossless-ish quality 0.95,
 * alpha kept). SVG and WebP are left alone — one is already vector, the other
 * already WebP.
 *
 * @param {string} src
 * @returns {Promise<{blob: Blob|null, converted: boolean}>}
 */
export async function convertToWebp(src) {
  if (/\.(svg|webp)(?:[?#]|$)/i.test(src)) return { blob: null, converted: false };
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`Could not read ${src}`));
    img.src = src;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  const blob = await new Promise(res => c.toBlob(res, "image/webp", 0.95));
  if (!blob) throw new Error("This browser could not encode WebP.");
  return { blob, converted: true };
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Black space with faint haze and stars, filling a `size` square at the origin. */
export function drawStarfield(ctx, size, seed = 77) {
  const rand = rng(seed);
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 6; i++) {
    const x = rand() * size, y = rand() * size, r = size * (0.15 + rand() * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,160,180,${0.06 + rand() * 0.05})`);
    g.addColorStop(1, "rgba(150,160,180,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const count = Math.round(size * size * 0.004);
  for (let i = 0; i < count; i++) {
    const big = rand() > 0.95;
    ctx.fillStyle = `rgba(255,255,255,${big ? 0.95 : 0.35 + rand() * 0.6})`;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, Math.max(0.5, (big ? 1.3 : 0.35 + rand() * 0.6) * (size / 200)), 0, Math.PI * 2);
    ctx.fill();
  }
}

function goldFill(ctx, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#f3d48a");
  g.addColorStop(0.5, "#cfa458");
  g.addColorStop(1, "#9c7636");
  return g;
}

/**
 * The commbadge drawing space. Both badges were traced from a 1000-unit
 * reference drawing, so their coordinates are in that drawing's units and
 * mapped onto the disc here; `gold()` is the reference's olive gold.
 */
function badgeSpace(ctx, x, y, r) {
  const k = (r * 0.84) / 414;   // 414 = the delta's left tip's distance from the centre
  const X = (u) => x + (u - 500) * k, Y = (v) => y + (v - 492) * k;
  return {
    X, Y, k,
    m: (u, v) => ctx.moveTo(X(u), Y(v)),
    l: (u, v) => ctx.lineTo(X(u), Y(v)),
    q: (a, b, u, v) => ctx.quadraticCurveTo(X(a), Y(b), X(u), Y(v)),
    c: (a, b, d, e, u, v) => ctx.bezierCurveTo(X(a), Y(b), X(d), Y(e), X(u), Y(v)),
    gold() {
      const g = ctx.createLinearGradient(0, Y(145), 0, Y(840));
      g.addColorStop(0, "#d9cd72");
      g.addColorStop(0.5, "#bdb050");
      g.addColorStop(1, "#978b34");
      return g;
    },
  };
}

/**
 * The leaning, gold-rimmed silver delta both badges share. Its outlines are
 * hairlines — at the backing's weight they swamp the narrow gold rim.
 */
function badgeDelta(ctx, x, y, r) {
  const { X, Y, m, c, gold } = badgeSpace(ctx, x, y, r);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(0.5, r * 0.009);
  ctx.strokeStyle = "rgba(43,41,20,0.85)";

  // The gold rim: the right tip sits higher than the left, so it leans.
  ctx.beginPath();
  m(515, 145);
  c(600, 300, 690, 560, 722, 782);
  c(680, 640, 620, 570, 550, 572);
  c(450, 575, 340, 700, 278, 840);
  c(320, 600, 420, 330, 515, 145);
  ctx.closePath();
  ctx.fillStyle = gold();
  ctx.fill();
  ctx.stroke();

  // The silver field inside it.
  ctx.beginPath();
  m(514, 172);
  c(592, 320, 672, 555, 700, 700);
  c(665, 620, 610, 588, 548, 590);
  c(455, 592, 360, 690, 300, 780);
  c(335, 590, 425, 345, 514, 172);
  ctx.closePath();
  const s = ctx.createLinearGradient(X(300), Y(172), X(700), Y(780));
  s.addColorStop(0, "#d6dde3");
  s.addColorStop(0.55, "#bec7cf");
  s.addColorStop(1, "#a3adb7");
  ctx.fillStyle = s;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Width of the `oval` plate as a share of its height (the disc's diameter). */
export const OVAL_ASPECT = 0.74;

/** Rim thickness as a share of r — the same on both axes, so an oval's matches the disc's. */
const RIM = 0.12;

/** The starfield window inside the rim, as the current path. */
function plateWindow(ctx, x, y, r, rx) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx - r * RIM, r * (1 - RIM), 0, 0, Math.PI * 2);
}

/**
 * The gold-rimmed starfield plate every `disc` and `oval` emblem sits on.
 * `rx` is the half-width; a disc passes `rx === r`.
 */
function drawDisc(ctx, x, y, r, rx = r) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = goldFill(ctx, y - r, y + r);
  ctx.fill();
  plateWindow(ctx, x, y, r, rx);
  ctx.clip();
  ctx.translate(x - r, y - r);
  drawStarfield(ctx, r * 2, 77);
  ctx.restore();
  plateWindow(ctx, x, y, r, rx);
  ctx.lineWidth = Math.max(1, r * 0.03);
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.stroke();
}

/** The TNG commbadge: the shared delta over a gold oval with an inset groove. */
function drawTng(ctx, x, y, r) {
  const { gold } = badgeSpace(ctx, x, y, r);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.05, r * 0.66, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = gold();
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.025);
  ctx.strokeStyle = "#2b2914";
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.05, r * 0.56, r * 0.3, 0, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(0.5, r * 0.012);
  ctx.strokeStyle = "rgba(60,56,20,0.55)";
  ctx.stroke();
  ctx.restore();
  badgeDelta(ctx, x, y, r);
}

/** The DS9/VOY commbadge: the shared delta over a slotted gold bar. */
function drawDs9(ctx, x, y, r) {
  const { m, l, q, c, gold } = badgeSpace(ctx, x, y, r);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#2b2914";
  ctx.lineWidth = Math.max(1, r * 0.025);

  // The bar, with its two slots punched through (even-odd).
  ctx.beginPath();
  m(262, 365); l(415, 352); l(615, 352); l(765, 365);
  c(780, 410, 800, 480, 805, 528); l(680, 556); l(345, 556); l(207, 532);
  c(204, 490, 232, 420, 262, 365);
  ctx.closePath();
  m(305, 430); l(384, 430); l(366, 478); l(302, 478); q(278, 470, 278, 455); q(280, 437, 305, 430);
  ctx.closePath();
  m(644, 430); l(722, 430); q(752, 445, 752, 458); q(745, 475, 735, 478); l(662, 478);
  ctx.closePath();
  ctx.fillStyle = gold();
  ctx.fill("evenodd");
  ctx.stroke();
  ctx.restore();
  badgeDelta(ctx, x, y, r);
}

/**
 * Stamp an emblem centred on (x, y) with radius r.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{id: string, image?: CanvasImageSource|null, frame?: "disc"|"plain"}} emblem
 *   `image` is the loaded library image (null for built-ins).
 */
export function drawEmblem(ctx, x, y, r, { id, image = null, frame = "disc" } = {}) {
  if (VECTOR_EMBLEMS.has(id)) {
    drawDisc(ctx, x, y, r);
    (id === "ds9" ? drawDs9 : drawTng)(ctx, x, y, r);
    return;
  }
  if (!image) return;
  const iw = image.width || image.naturalWidth, ih = image.height || image.naturalHeight;
  if (!iw || !ih) return;
  if (frame === "plain") {
    const k = (2 * r) / Math.max(iw, ih);
    ctx.drawImage(image, x - (iw * k) / 2, y - (ih * k) / 2, iw * k, ih * k);
    return;
  }
  const rx = frame === "oval" ? r * OVAL_ASPECT : r;
  drawDisc(ctx, x, y, r, rx);
  // The image sits inside the rim, with a little breathing room. Fitted per
  // axis, so a tall insignia fills the oval's height; on a disc both terms
  // reduce to the longest-side fit.
  const k = Math.min((2 * (rx - r * RIM) * 0.82) / iw, (2 * r * (1 - RIM) * 0.82) / ih);
  ctx.save();
  plateWindow(ctx, x, y, r, rx);
  ctx.clip();
  ctx.drawImage(image, x - (iw * k) / 2, y - (ih * k) / 2, iw * k, ih * k);
  ctx.restore();
}
