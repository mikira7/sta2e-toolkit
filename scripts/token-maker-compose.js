/**
 * sta2e-toolkit | token-maker-compose.js
 *
 * The maths and pixel work behind the Token Maker — a leaf with **no imports**
 * and no DOM, so tests/token-maker.mjs drives it under node. token-maker.js
 * owns the canvases and the window; everything here takes plain numbers and
 * `ImageData`-shaped buffers (`{data, width, height}`).
 *
 * Coordinate spaces:
 *   source  pixels of the portrait as loaded
 *   output  pixels of the square token being made (0..outSize)
 *
 * A recipe positions the portrait with `x, y` (where the portrait's centre
 * lands, as a fraction of the output), `zoom` (1 = the portrait's shorter side
 * exactly fills the output), `rotation` (degrees) and `flipX`. The brush masks
 * live in SOURCE space, so a stroke stays on the hair it was painted over when
 * the portrait is re-framed afterwards; `subjectMatrix` maps source to output
 * and its inverse maps a pointer back onto the mask.
 */

// ── Affine transforms ([a, b, c, d, e, f], canvas setTransform order) ────────

/** x' = a·x + c·y + e,  y' = b·x + d·y + f */
export function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invertMatrix(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return [1, 0, 0, 1, 0, 0];
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** The scale at zoom 1: the portrait's shorter side fills the output. */
export function baseScale(srcW, srcH, outSize) {
  return outSize / Math.max(1, Math.min(srcW, srcH));
}

/**
 * Source → output transform for a recipe.
 * out = T(x·S, y·S) · R(rotation) · Scale(±k, k) · T(−w/2, −h/2) · src
 */
export function subjectMatrix(recipe, srcW, srcH, outSize) {
  const k = baseScale(srcW, srcH, outSize) * (Number(recipe.zoom) || 1);
  const sx = recipe.flipX ? -k : k;
  const r = ((Number(recipe.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const tx = (recipe.x ?? 0.5) * outSize, ty = (recipe.y ?? 0.5) * outSize;
  // R · S
  const a = cos * sx, b = sin * sx, c = -sin * k, d = cos * k;
  // then translate the source centre to the origin first
  const e = tx - (a * srcW / 2 + c * srcH / 2);
  const f = ty - (b * srcW / 2 + d * srcH / 2);
  return [a, b, c, d, e, f];
}

/**
 * A starting frame for a portrait: fill the output and put the upper third —
 * where a portrait's face almost always is — at the centre.
 */
export function autoFit(srcW, srcH, outSize = 512) {
  const k = baseScale(srcW, srcH, outSize);
  const tall = srcH > srcW;
  const faceY = tall ? 0.36 : 0.5;          // fraction down the source
  const y = 0.5 + ((0.5 - faceY) * srcH * k) / outSize;
  return { x: 0.5, y: Math.round(y * 1000) / 1000, zoom: 1, rotation: 0, flipX: false };
}

// ── Shapes (output space) ────────────────────────────────────────────────────

export const SHAPES = ["circle", "rounded", "hexagon", "none"];

/**
 * Geometry for the cut-out shape. `size` is the shape's diameter as a
 * fraction of the output. Returns a circle descriptor or a closed polygon.
 */
export function shapeGeometry(shape, outSize, size = 0.86) {
  const c = outSize / 2;
  const r = (Math.max(0.1, Math.min(1, size)) * outSize) / 2;
  if (shape === "none") return { type: "none" };
  if (shape === "hexagon") {
    // Flat-topped, matching Foundry's hex tokens on a column grid.
    const points = [];
    for (let i = 0; i < 6; i++) {
      const t = (Math.PI / 3) * i;
      points.push(c + r * Math.cos(t), c + r * Math.sin(t));
    }
    return { type: "poly", points };
  }
  if (shape === "rounded") {
    const rad = r * 0.28;
    const points = [];
    const corners = [[c + r - rad, c - r + rad, -90], [c + r - rad, c + r - rad, 0], [c - r + rad, c + r - rad, 90], [c - r + rad, c - r + rad, 180]];
    for (const [cx, cy, start] of corners) {
      for (let i = 0; i <= 6; i++) {
        const t = ((start + 15 * i) * Math.PI) / 180;
        points.push(cx + rad * Math.cos(t), cy + rad * Math.sin(t));
      }
    }
    return { type: "poly", points };
  }
  return { type: "circle", cx: c, cy: c, r };
}

// ── Flood fill (magic eraser) ────────────────────────────────────────────────

/**
 * Pixels connected to (sx, sy) whose colour is within `tolerance` (0–100) of
 * the seed's. Transparent pixels always count as matching a transparent seed
 * and never as matching an opaque one, so a fill on an already-cut background
 * spreads through it without leaking into the subject.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @returns {Uint8Array} 1 where filled, row-major, width × height
 */
export function floodFill(img, sx, sy, tolerance = 20) {
  const { data, width: w, height: h } = img;
  const out = new Uint8Array(w * h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const i0 = (sy * w + sx) * 4;
  const seed = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]];
  const seedClear = seed[3] < 16;
  const lim = (Math.max(0, Math.min(100, tolerance)) / 100) * 441.68;   // max RGB distance
  const lim2 = lim * lim;
  const match = (p) => {
    const i = p * 4;
    const clear = data[i + 3] < 16;
    if (seedClear || clear) return seedClear && clear;
    const dr = data[i] - seed[0], dg = data[i + 1] - seed[1], db = data[i + 2] - seed[2];
    return dr * dr + dg * dg + db * db <= lim2;
  };
  const stack = [sy * w + sx];
  while (stack.length) {
    const p = stack.pop();
    if (out[p]) continue;
    const y = (p / w) | 0;
    // Scan left and right along the row, then queue the rows above and below.
    let l = p, r = p;
    const rowStart = y * w, rowEnd = rowStart + w - 1;
    while (l > rowStart && !out[l - 1] && match(l - 1)) l--;
    while (r < rowEnd && !out[r + 1] && match(r + 1)) r++;
    // Every queued pixel was matched before it was pushed (the seed matches itself).
    for (let q = l; q <= r; q++) {
      out[q] = 1;
      if (y > 0 && !out[q - w] && match(q - w)) stack.push(q - w);
      if (y < h - 1 && !out[q + w] && match(q + w)) stack.push(q + w);
    }
  }
  return out;
}

// ── Rank insignia ────────────────────────────────────────────────────────────
//
// Four kinds of TNG-era collar insignia, all stamped on the same spot:
//
//   officer   gold pips; hollow pips are the half-grades   {kind, solid, hollow}
//   admiral   a gold-framed black bar of gold pips, 1–5    {kind, pips}
//   enlisted  a black arrow tab with chevrons and dots     {kind, chevrons, dots}
//   cadet     white capsule bars on a black back, 1–4      {kind, bars}

/** Commissioned and warrant grades, lowest first — the manual picker's list. */
export const OFFICER_RANKS = [
  { id: 1, name: "Chief Warrant Officer",    solid: 0, hollow: 1 },
  { id: 2, name: "Ensign",                   solid: 1, hollow: 0 },
  { id: 3, name: "Lieutenant (Junior Grade)", solid: 1, hollow: 1 },
  { id: 4, name: "Lieutenant",               solid: 2, hollow: 0 },
  { id: 5, name: "Lieutenant Commander",     solid: 2, hollow: 1 },
  { id: 6, name: "Commander",                solid: 3, hollow: 0 },
  { id: 7, name: "Captain",                  solid: 4, hollow: 0 },
];

/** The officer grade a pip count corresponds to (for recipes saved before the grade list), or null. */
export function officerGradeFor(solid, hollow) {
  return OFFICER_RANKS.find(o => o.solid === (solid | 0) && o.hollow === (hollow | 0)) ?? null;
}

/** Enlisted grades, lowest first — the manual picker's list. */
export const ENLISTED_RANKS = [
  { id: 1, name: "Petty Officer Third Class",  chevrons: 1, dots: 0 },
  { id: 2, name: "Petty Officer Second Class", chevrons: 2, dots: 0 },
  { id: 3, name: "Petty Officer First Class",  chevrons: 3, dots: 0 },
  { id: 4, name: "Chief Petty Officer",        chevrons: 3, dots: 1 },
  { id: 5, name: "Senior Chief Petty Officer", chevrons: 3, dots: 2 },
  { id: 6, name: "Master Chief Petty Officer", chevrons: 3, dots: 3 },
];

export const ADMIRAL_RANKS = [
  { pips: 1, name: "Rear Admiral (Lower Half) / Commodore" },
  { pips: 2, name: "Rear Admiral (Upper Half)" },
  { pips: 3, name: "Vice Admiral" },
  { pips: 4, name: "Admiral" },
  { pips: 5, name: "Fleet Admiral" },
];

const _officer = (solid, hollow) => ({ kind: "officer", solid, hollow });
const _enlisted = (id) => ({ kind: "enlisted", ...(({ chevrons, dots }) => ({ chevrons, dots }))(ENLISTED_RANKS[id - 1]) });

/**
 * The insignia for a free-text rank. STA keeps `system.rank` as plain text, so
 * "Lt. Cmdr", "Lieutenant (jg)", "LtJG", "CPO" and "RADM (UH)" all have to land.
 * Returns null for ranks with no collar insignia (crewmen, yeomen) or text it
 * cannot read — the Token Maker then leaves the choice to the GM.
 *
 * Order matters: flag officers and enlisted grades are tested before officer
 * grades, because "Vice Admiral" contains no officer word but "Chief Petty
 * Officer" does contain "officer" — and a bare "Chief" is NOT read as an
 * enlisted grade, since "Chief Engineer" is a post, not a rank.
 *
 * @param {string} text
 * @returns {{kind: string}|null}
 */
export function rankInsignia(text) {
  const t = String(text ?? "").toLowerCase().replace(/[._\-/]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;

  // Flag officers.
  if (/\bfleet admiral\b|\bfadm\b/.test(t)) return { kind: "admiral", pips: 5 };
  if (/\bvice admiral\b|\bvadm\b/.test(t)) return { kind: "admiral", pips: 3 };
  if (/\brear admiral\b|\bradm\b/.test(t)) {
    return { kind: "admiral", pips: /\b(lower|lh)\b/.test(t) ? 1 : 2 };
  }
  if (/\bcommodore\b|\bcdre\b/.test(t)) return { kind: "admiral", pips: 1 };
  if (/\badmiral\b|\badm\b/.test(t)) return { kind: "admiral", pips: 4 };

  // Enlisted grades.
  if (/\bmaster chief\b|\bmcpo\b/.test(t)) return _enlisted(6);
  if (/\bsenior chief\b|\bscpo\b/.test(t)) return _enlisted(5);
  if (/\bchief petty officer\b|\bcpo\b/.test(t)) return _enlisted(4);
  if (/\bpetty officer\b|\bpo ?[123]\b/.test(t)) {
    if (/\b(first|1st)\b|\bpo ?1\b/.test(t)) return _enlisted(3);
    if (/\b(second|2nd)\b|\bpo ?2\b/.test(t)) return _enlisted(2);
    return _enlisted(1);
  }
  if (/\b(crewman|crewmember|yeoman|specialist|recruit)\b/.test(t)) return null;

  // Cadets.
  if (/\bcadet\b/.test(t)) {
    if (/\b(fourth|4th|senior)\b/.test(t)) return { kind: "cadet", bars: 4 };
    if (/\b(third|3rd)\b/.test(t)) return { kind: "cadet", bars: 3 };
    if (/\b(second|2nd)\b/.test(t)) return { kind: "cadet", bars: 2 };
    return { kind: "cadet", bars: 1 };
  }

  // Commissioned and warrant officers.
  if (/\bwarrant officer\b|\bcwo\b/.test(t)) return _officer(0, 1);
  if (/\b(lieutenant|lt) ?(commander|cmdr|cdr)\b|\blcdr\b/.test(t)) return _officer(2, 1);
  // Brackets round either spelling: "(jg)", "(j.g.)" → "(j g )", "(Junior Grade)".
  if (/\b(lieutenant|lt) ?\(?(jg|j g|junior grade)\b|\bltjg\b/.test(t)) return _officer(1, 1);
  if (/\b(commander|cmdr|cdr)\b/.test(t)) return _officer(3, 0);
  if (/\b(lieutenant|lt)\b/.test(t)) return _officer(2, 0);
  if (/\b(ensign|ens)\b/.test(t)) return _officer(1, 0);
  if (/\b(captain|capt|cpt)\b/.test(t)) return _officer(4, 0);
  return null;
}

/** Kept for older callers: the officer reading of a rank, or null. */
export function rankPips(text) {
  const r = rankInsignia(text);
  return r?.kind === "officer" ? r : null;
}

/** A short human description of an insignia, for the maker's "From Rank" note. */
export function insigniaLabel(ins) {
  if (!ins) return "";
  switch (ins.kind) {
    case "admiral":  return ADMIRAL_RANKS.find(a => a.pips === ins.pips)?.name ?? `Flag officer (${ins.pips})`;
    case "enlisted": return ENLISTED_RANKS.find(e => e.chevrons === ins.chevrons && e.dots === ins.dots)?.name ?? "Enlisted";
    case "cadet":    return `Cadet, year ${ins.bars}`;
    // Hollow first, as the plate draws them.
    default: {
      const pips = `${"○".repeat(ins.hollow ?? 0)}${"●".repeat(ins.solid ?? 0)}`;
      const grade = officerGradeFor(ins.solid, ins.hollow);
      return grade ? `${grade.name} ${pips}` : pips;
    }
  }
}

/**
 * Where the insignia goes, and how it is laid out: on the ring at the bottom
 * left, laid along the ring's tangent (running down to the right), opposite a
 * bottom-right badge. `dist` and `scale` come from the ring (its spritesheet's or
 * baked frame's `pips` config), so the plate sits on the ring rather than off
 * its edge; with no ring it sits near the token edge at full size.
 *
 * Accepts an insignia from `rankInsignia`, or the older `{solid, hollow}` shape
 * (read as an officer's). All positions along the plate are measured from its
 * centre; `angle` is in radians.
 *
 * - officer:  `pips: [{x, r, hollow}]` — hollow half-grades first, from the upper-left end
 * - admiral:  `pips: [{x, r}]` inside a gold frame
 * - enlisted: `chevrons`, `dots`, plus `tip` (how far the arrow point reaches)
 * - cadet:    `bars: [{x, w, h}]`
 *
 * @param {number} S  output size
 * @param {object} insignia
 * @param {{dist?: number, scale?: number}} [place]
 * @returns {object|null}
 */
export function pipPlate(S, insignia = {}, { dist = 0.9, scale = 1 } = {}) {
  const ins = insignia?.kind ? insignia : { kind: "officer", solid: insignia?.solid ?? 0, hollow: insignia?.hollow ?? 0 };
  const half = S / 2;
  const at = (135 * Math.PI) / 180;           // position: bottom left
  const base = {
    kind:  ins.kind,
    cx:    half + Math.cos(at) * dist * half,
    cy:    half + Math.sin(at) * dist * half,
    angle: at - Math.PI / 2,                  // the tangent there: down and to the right
  };
  const r = 0.046 * half * scale;             // the pip radius every kind is sized from

  if (ins.kind === "admiral") {
    const n = Math.max(1, Math.min(5, ins.pips | 0));
    const pr = r * 0.82, gap = pr * 0.5, pad = pr * 0.85;
    const w = n * 2 * pr + (n - 1) * gap + pad * 2;
    const h = 2 * pr + pad * 1.7;
    const pips = [];
    for (let i = 0; i < n; i++) pips.push({ x: -w / 2 + pad + pr + i * (2 * pr + gap), r: pr });
    return { ...base, w, h, pips };
  }

  if (ins.kind === "enlisted") {
    const chevrons = Math.max(0, Math.min(3, ins.chevrons | 0));
    const dots = Math.max(0, Math.min(3, ins.dots | 0));
    if (!chevrons && !dots) return null;
    const h = r * 2.5;
    const w = h * (dots ? 2.15 : 1.6);
    return { ...base, w, h, tip: h * 0.42, chevrons, dots };
  }

  if (ins.kind === "cadet") {
    const n = Math.max(1, Math.min(4, ins.bars | 0));
    const bw = r * 0.95, bh = r * 2.5, gap = bw * 0.38, pad = bw * 0.55;
    const w = n * bw + (n - 1) * gap + pad * 2;
    const h = bh + pad * 2;
    const bars = [];
    for (let i = 0; i < n; i++) bars.push({ x: -w / 2 + pad + bw / 2 + i * (bw + gap), w: bw, h: bh });
    return { ...base, w, h, bars };
  }

  const nSolid = Math.max(0, Math.min(4, ins.solid | 0)), nHollow = Math.max(0, Math.min(2, ins.hollow | 0));
  const n = nSolid + nHollow;
  if (!n) return null;
  // Same slot, spacing, padding and plate height as the flag officer's bar, so
  // the two read as one family; `r` is the drawn radius (the flag bar draws its
  // pips at 92% of the slot, and so does this).
  const pr = r * 0.82, gap = pr * 0.5, pad = pr * 0.85;
  const w = n * 2 * pr + (n - 1) * gap + pad * 2;
  const h = 2 * pr + pad * 1.7;
  const pips = [];
  for (let i = 0; i < n; i++) {
    pips.push({ x: -w / 2 + pad + pr + i * (2 * pr + gap), r: pr * 0.92, hollow: i < nHollow });
  }
  return { ...base, kind: "officer", w, h, pips };
}

/**
 * Where the emblem disc goes: on the ring at the bottom right, opposite the
 * pips. `dist` and `r` (both in token half-size units) come from the ring's
 * spritesheet `emblem` config; with no ring the disc sits near the token edge.
 *
 * @returns {{cx: number, cy: number, r: number}}
 */
export function emblemDisc(S, { dist = 0.8, r = 0.2 } = {}) {
  const half = S / 2;
  const at = Math.PI / 4;                     // bottom right
  return { cx: half + Math.cos(at) * dist * half, cy: half + Math.sin(at) * dist * half, r: r * half };
}

// ── Saving ───────────────────────────────────────────────────────────────────

/**
 * Folders the maker will not write into. Core's own assets are not in the data
 * folder at all, and anything under systems/ or modules/ is replaced on the
 * next package update — the token would vanish with it.
 */
export function isWritableNextTo(path) {
  const p = String(path ?? "").replace(/^\/+/, "");
  if (!p || /^[a-z]+:\/\//i.test(p) || p.startsWith("data:")) return false;
  if (!p.includes("/")) return false;
  return !/^(icons|ui|sounds|cards|canvas|systems|modules)\//i.test(p);
}

/** A file-name stem safe on every host: letters, digits, _ and -, spaces to dashes. */
export function safeFileStem(text) {
  return String(text ?? "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
}

/**
 * Folder and file names for a token made from `portraitPath`:
 * `<stem>_token.webp`, then `_token-2`, `_token-3` … when taken. A fresh name
 * every save means a browser never shows a cached copy of the previous one.
 *
 * @param {string} portraitPath
 * @param {Iterable<string>} existing  File names (not paths) already in the folder
 * @param {string} [fallbackDir]       Used when the portrait's folder is not writable
 * @param {{forceFallback?: boolean, name?: string}} [opts]  `forceFallback` uses the
 *   fallback folder even when the portrait's looks writable (its folder refused the
 *   upload); `name` is the GM's chosen file name, used instead of `<stem>_token`
 *   (still made unique, so a re-save never overwrites a file a browser has cached)
 */
export function tokenFileNames(portraitPath, existing = [], fallbackDir = "", { forceFallback = false, name: chosen = "" } = {}) {
  const path = String(portraitPath ?? "");
  const writable = !forceFallback && isWritableNextTo(path);
  const clean = path.split(/[?#]/)[0];
  const slash = clean.lastIndexOf("/");
  const dir = writable ? clean.slice(0, slash) : fallbackDir;
  let stem = "token";
  try { stem = decodeURIComponent(clean.slice(slash + 1)).replace(/\.[a-z0-9]+$/i, "") || "token"; } catch { /* keep default */ }
  stem = safeFileStem(stem) || "token";
  const base = safeFileStem(String(chosen ?? "").replace(/\.(webp|png|jpe?g)$/i, "")) || `${stem}_token`;
  const taken = new Set([...existing].map(n => String(n).toLowerCase()));
  let n = 1;
  let name = `${base}.webp`;
  while (taken.has(name.toLowerCase())) name = `${base}-${++n}.webp`;
  return { dir, name, mask: name.replace(/\.webp$/, ".mask.png"), fellBack: !writable };
}
