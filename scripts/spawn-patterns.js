/**
 * sta2e-toolkit | spawn-patterns.js
 *
 * Formation geometry shared by the transporter beam-in and the ship spawner.
 *
 * Everything here returns **offsets relative to the layout centre** — never
 * absolute canvas coords and never top-left token coords. That is deliberate:
 * the transporter places 1x1 tokens and re-adds the click point directly, while
 * the ship spawner places 2x2 and larger ships and has to convert each offset to
 * top-left using that ship's own footprint. Baking either assumption in here
 * would break the other caller.
 *
 * ── Local frame ──
 * Offsets are authored in a ship-local frame where **-Y is forward** (up on an
 * unrotated screen) and +X is starboard, so the lead element of a wedge sits at
 * the most negative Y. Passing `headingRad` rotates the whole formation so that
 * forward points along that canvas bearing; passing null leaves it unrotated,
 * which is the transporter's case.
 */

/** Pattern key → label for `<select>` menus. */
export const SPAWN_PATTERNS = {
  circle:        "Circle",
  line:          "Line — Horizontal",
  line_vertical: "Line — Vertical",
  grid:          "Grid",
  formation:     "Formation (Wedge)",
  v_formation:   "V-Formation",
  diagonal:      "Diagonal",
  scatter:       "Scatter",
  individual:    "Individual Placement",
};

/** Patterns whose geometry is meaningful — `individual` is placed by hand. */
export const GEOMETRIC_PATTERNS = Object.keys(SPAWN_PATTERNS).filter(k => k !== "individual");

const DEG = 180 / Math.PI;

/**
 * Radius of the scatter cloud. Exported because the picker draws it as a single
 * containing ring rather than one ring per ship — a scatter preview of the real
 * positions would be a lie, since they are re-rolled at spawn time.
 */
export function scatterMaxRadius(total) {
  const gridSize = canvas?.grid?.size ?? 100;
  return Math.max(gridSize * 1.5 * Math.sqrt(total), gridSize * 1.5);
}

/** Rotate a local-frame point by `angleRadians` about the origin. */
function rotatePoint(x, y, angleRadians) {
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * Rotation that carries local forward (0, -1) onto canvas bearing `headingRad`.
 *
 * Rotating (0,-1) by φ gives (sin φ, -cos φ); setting that equal to
 * (cos h, sin h) solves to φ = h + π/2.
 */
function frameRotation(headingRad) {
  return headingRad + Math.PI / 2;
}

/**
 * Offsets from the layout centre for one formation.
 *
 * @param {string} pattern   A key of {@link SPAWN_PATTERNS}
 * @param {number} total     How many placeables
 * @param {number} spacing   Spread distance in pixels (the dialog's slider)
 * @param {object} [opts]
 * @param {number|null} [opts.headingRad]  Canvas bearing the formation faces, or
 *   null to leave it unrotated. Ignored by `circle` and `scatter`.
 * @returns {{x:number, y:number, rotation:number|null}[]}
 *   `rotation` is degrees of Foundry token rotation for that specific slot, or
 *   null meaning "use the formation's own heading". Only `circle` sets it.
 */
export function calcSpawnOffsets(pattern, total, spacing, { headingRad = null } = {}) {
  if (total <= 0) return [];

  // Half-spacing is the module's established step for the transporter's line and
  // wedge; every aligned pattern uses it so one slider value reads the same way
  // across all of them.
  const step  = spacing / 2;
  const plain = (x, y) => ({ x, y, rotation: null });

  switch (pattern) {
    case "line": {
      const totalWidth = (total - 1) * step;
      return align(
        Array.from({ length: total }, (_, i) => plain(-totalWidth / 2 + i * step, 0)),
        headingRad
      );
    }

    case "line_vertical": {
      const totalDepth = (total - 1) * step;
      return align(
        Array.from({ length: total }, (_, i) => plain(0, -totalDepth / 2 + i * step)),
        headingRad
      );
    }

    case "grid": {
      const cols = Math.ceil(Math.sqrt(total));
      const rows = Math.ceil(total / cols);
      return align(
        Array.from({ length: total }, (_, i) => plain(
          ((i % cols)          - (cols - 1) / 2) * step,
          (Math.floor(i / cols) - (rows - 1) / 2) * step
        )),
        headingRad
      );
    }

    case "formation": {
      // Wedge: 1 lead, then rows of 2, 3, … trailing behind it.
      const raw = [];
      let remaining = total;
      let row = 0;
      while (remaining > 0) {
        const cols = Math.min(row + 1, remaining);
        const rowW = (cols - 1) * step;
        for (let c = 0; c < cols; c++) raw.push(plain(-rowW / 2 + c * step, row * step));
        remaining -= cols;
        row++;
      }
      const maxY = raw[raw.length - 1]?.y ?? 0;
      return align(raw.map(p => plain(p.x, p.y - maxY / 2)), headingRad);
    }

    case "v_formation": {
      // Lead at the point, wings trailing back on alternating sides.
      const raw = [plain(0, 0)];
      for (let i = 1; i < total; i++) {
        const side  = (i - 1) % 2 === 0 ? -1 : 1;
        const depth = Math.floor((i - 1) / 2) + 1;
        raw.push(plain(side * depth * step * 0.8, depth * step));
      }
      return align(raw, headingRad);
    }

    case "diagonal": {
      const offset = i => (i - (total - 1) / 2) * step * 0.7;
      return align(
        Array.from({ length: total }, (_, i) => plain(offset(i), offset(i))),
        headingRad
      );
    }

    case "scatter": {
      // Rejection-sampled so ships do not land on top of each other. Never
      // aligned — a scatter with a heading would not be a scatter.
      const gridSize  = canvas?.grid?.size ?? 100;
      const maxRadius = scatterMaxRadius(total);
      const minDist   = gridSize * 0.5;
      const minSep    = gridSize * 1.1;
      const placed    = [];
      for (let i = 0; i < total; i++) {
        let pos;
        let attempts = 0;
        do {
          const angle = Math.random() * 2 * Math.PI;
          const dist  = minDist + Math.random() * (maxRadius - minDist);
          pos = plain(dist * Math.cos(angle), dist * Math.sin(angle));
          attempts++;
        } while (attempts < 50 && placed.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < minSep));
        placed.push(pos);
      }
      return placed;
    }

    case "individual":
      // Placed by hand, one click each — callers handle this before getting here.
      return Array.from({ length: total }, () => plain(0, 0));

    default: {
      // circle. Radius derives from circumference so spacing stays the arc
      // distance between neighbours however many ships there are.
      const radius = spacing * Math.sqrt(total) / (2 * Math.PI);
      return Array.from({ length: total }, (_, i) => {
        const angle = (i / total) * 2 * Math.PI;
        return {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
          // Face inward: bearing from this slot to the centre is angle + π, and
          // Foundry token rotation is that bearing less 90° (see
          // ship-card-movement.js — rotation 0 points the bow down).
          rotation: (angle + Math.PI) * DEG - 90,
        };
      });
    }
  }
}

/** Rotate a whole formation onto `headingRad`, or return it untouched. */
function align(offsets, headingRad) {
  if (!Number.isFinite(headingRad)) return offsets;
  const phi = frameRotation(headingRad);
  return offsets.map(o => {
    const r = rotatePoint(o.x, o.y, phi);
    return { x: r.x, y: r.y, rotation: o.rotation };
  });
}
