/**
 * sta2e-toolkit | bolt-glow-vfx.js
 *
 * The additive glow and ion trail carried by each travelling energy bolt —
 * energy cannons, and the TMP-era phaser banks that fire tracers.
 *
 * WHAT IT IS FOR
 * --------------
 * The bolt shader (`beam-shader.js`, "bolts" mode) draws each bolt as a window
 * along one quad: a hot core inside a sheath, with a soft tail edge. That reads
 * as a bolt, but it is flat — there is nothing around it and nothing left
 * behind it. This adds the same two things the torpedo escort carries: a
 * core-and-corona pair riding the bolt, and a short trail of fading puffs
 * sampled back along its path.
 *
 * DELIBERATELY NOT THE TORPEDO ESCORT
 * -----------------------------------
 * A cannon bolt and a torpedo must not read as the same object, so this differs
 * from `torpedo-glow-vfx.js` on two axes rather than one:
 *
 *  1. **Size.** Its own `gridFraction` basis, well under the torpedo's — the
 *     torpedo is a warhead you can see coming, a cannon bolt is a hard little
 *     round.
 *  2. **Character.** No pulse and no launch flash. A torpedo breathes as it
 *     drifts in and lights the tube behind it; a bolt is a single hard shot, and
 *     `_tracerVolley` already draws its own muzzle flare. Adding either here
 *     would make a burst of cannon fire read as a stream of small torpedoes.
 *
 * It is a SIBLING of the torpedo escort, not a copy of it. The genuinely hard
 * parts of that module — binding to a Sequencer sprite by name, reproducing its
 * waypoint walk, the plasma scale tween — do not exist here at all: the bolts
 * are native PIXI drawn by this module, so their positions are already known
 * every frame. What the two share is `buildRadialTexture`, and that is imported
 * rather than rewritten.
 *
 * A LEAF
 * ------
 * Imports only `starfield-common.js`, which imports nothing — so
 * `native-weapon-vfx.js` can use it without adding to the dependency chain that
 * `ground-phaser-vfx.js` and the firing path already have to reason about.
 */

import { buildRadialTexture } from "./starfield-common.js";

/** Side of the texture `buildRadialTexture` produces, for scale maths. */
const RADIAL_TEX = 128;

/**
 * How small the furthest trail puff gets, as a fraction of the head's radius.
 *
 * Not a dial: it is a floor that stops the taper reaching sub-pixel sizes, and
 * exposing it would only offer a way to turn the tail invisible again.
 */
const TRAIL_MIN_SCALE = 0.4;

// ── Dials ───────────────────────────────────────────────────────────────────
// Canonical here and imported by `native-weapon-vfx.js` into
// DEFAULT_BEAM_VFX_SETTINGS / BEAM_VFX_RANGES, the same arrangement the beam
// shader and the torpedo glow use. All numeric: `normalizeBeamVfxSettings`
// understands numbers, colour strings and three named enums, so `intensity: 0`
// is the off switch rather than a boolean.

export const BOLT_GLOW_DEFAULTS = Object.freeze({
  // Master opacity. 0 leaves the shaded bolt with no escort at all.
  intensity: 1,
  // The basis every radius below is a multiple of, as a fraction of one grid
  // square. THIS is the "cannons are smaller than torpedoes" control: the
  // torpedo escort sits at 0.66, so a bolt reads at well under half its size
  // without any of the individual radii having to be retuned against it.
  gridFraction: 0.3,
  coreRadius: 0.36,
  coreAlpha: 0.6,
  coronaRadius: 0.85,
  coronaAlpha: 0.3,
  // How far the core colour is lifted toward white, so the centre reads hotter
  // than the halo — the same idea as the beam's core line.
  coreWhiten: 0.6,
  // Puffs behind each bolt. Short: a cannon leaves a spark trail, not the long
  // ion wake a torpedo drags.
  trailCount: 6,
  // How far back the trail reaches, as a multiple of the BOLT'S OWN LENGTH —
  // not of the path — so the tail stays in proportion whether the shot crosses
  // one square or twenty, exactly as the bolt itself does.
  trailReach: 2.4,
  trailRadius: 0.34,
  trailAlpha: 0.45,
});

export const BOLT_GLOW_RANGES = Object.freeze({
  "boltGlow.intensity": [0, 2],
  "boltGlow.gridFraction": [0.02, 2],
  "boltGlow.coreRadius": [0, 3],
  "boltGlow.coreAlpha": [0, 1],
  "boltGlow.coronaRadius": [0, 5],
  "boltGlow.coronaAlpha": [0, 1],
  "boltGlow.coreWhiten": [0, 1],
  "boltGlow.trailCount": [0, 24],
  "boltGlow.trailReach": [0, 8],
  "boltGlow.trailRadius": [0, 3],
  "boltGlow.trailAlpha": [0, 1],
});

// ── Shared texture ──────────────────────────────────────────────────────────
// One soft radial for every sprite in every bolt glow. Built on first use — it
// touches `document` and `PIXI` — and NEVER destroyed, the same rule the beam
// shader's noise texture and the torpedo escort's radial both follow.

let _radial = null;

function _radialTexture() {
  if (!_radial) _radial = buildRadialTexture();
  return _radial;
}

// ── Colour ──────────────────────────────────────────────────────────────────

/** Lift a colour toward white, so the core reads hotter than the corona. */
function _whiten(color, amount) {
  const lift = ch => Math.round(ch + ((255 - ch) * amount));
  return (lift((color >> 16) & 0xff) << 16)
    | (lift((color >> 8) & 0xff) << 8)
    | lift(color & 0xff);
}

function _num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _sprite(parent, texture, tint, blend) {
  const s = new PIXI.Sprite(texture);
  s.anchor.set(0.5);
  s.tint = tint;
  s.blendMode = blend;
  s.visible = false;
  parent.addChild(s);
  return s;
}

// ── The glow ────────────────────────────────────────────────────────────────

/**
 * Build the glow sprites for one volley.
 *
 * Every sprite for every bolt is created ONCE, here, and afterwards only moved,
 * scaled and shown or hidden — the module's create-once/toggle-`visible`
 * invariant. `_tracerVolley` redraws its Graphics from scratch each frame; this
 * deliberately does not.
 *
 * Returns null when it cannot build or has nothing to draw, so the caller reads
 * `const glow = createBoltGlow(...); …; glow?.update(...)`.
 *
 * @param {PIXI.Container} parent   added as children of this
 * @param {object} spec
 * @param {number} spec.color       sheath colour, 24-bit
 * @param {number} spec.coreColor   core colour, 24-bit; whitened from `color` if absent
 * @param {number|string} spec.blend
 * @param {number} spec.boltCount   how many bolts are in flight at once
 * @param {number} spec.gridSize    canvas grid size, the basis for `gridFraction`
 * @param {object} spec.dials       the resolved `boltGlow` settings group
 */
export function createBoltGlow(parent, {
  color = 0xff9a33, coreColor = null, blend = null,
  boltCount = 1, gridSize = 100, dials = null,
} = {}) {
  if (!parent || !globalThis.PIXI) return null;
  const cfg = { ...BOLT_GLOW_DEFAULTS, ...(dials ?? {}) };
  const intensity = _num(cfg.intensity, 1);
  if (!(intensity > 0)) return null;

  const bolts = Math.min(24, Math.max(1, Math.round(boltCount)));
  const trailCount = Math.min(24, Math.max(0, Math.round(_num(cfg.trailCount, 6))));
  // The basis every radius is a multiple of. A fraction of the GRID rather than
  // of the bolt's configured stroke width: the stroke dials are a line
  // thickness, and driving a round glow from them made a fat-stroked era
  // balloon while a thin one vanished.
  const px = Math.max(2, gridSize * _num(cfg.gridFraction, 0.28));

  let texture;
  try {
    texture = _radialTexture();
  } catch (err) {
    console.warn("STA2e Toolkit | Bolt glow texture failed:", err);
    return null;
  }

  const halo = Number.isFinite(color) ? color : 0xff9a33;
  const core = Number.isFinite(coreColor) ? coreColor : _whiten(halo, _num(cfg.coreWhiten, 0.6));

  const layer = new PIXI.Container();
  parent.addChild(layer);

  // Trail first so every puff draws under every head.
  const trails = [];
  for (let b = 0; b < bolts; b++) {
    const row = [];
    for (let k = 0; k < trailCount; k++) row.push(_sprite(layer, texture, halo, blend));
    trails.push(row);
  }
  const coronas = [];
  const heads = [];
  for (let b = 0; b < bolts; b++) coronas.push(_sprite(layer, texture, halo, blend));
  for (let b = 0; b < bolts; b++) heads.push(_sprite(layer, texture, core, blend));

  const coreScale = (_num(cfg.coreRadius, 0.42) * px) / RADIAL_TEX;
  const coronaScale = (_num(cfg.coronaRadius, 1.1) * px) / RADIAL_TEX;
  const trailScale = (_num(cfg.trailRadius, 0.32) * px) / RADIAL_TEX;
  const coreAlpha = _num(cfg.coreAlpha, 0.5) * intensity;
  const coronaAlpha = _num(cfg.coronaAlpha, 0.2) * intensity;
  const trailAlpha = _num(cfg.trailAlpha, 0.34) * intensity;
  const trailReach = _num(cfg.trailReach, 1.6);

  let dead = false;
  const bySlot = new Array(bolts).fill(null);

  return {
    /**
     * Place the glow for this frame.
     *
     * @param {(t:number)=>{x:number,y:number}} pointAt  the volley's own path
     *        function — the SAME one the bolts are drawn from, so the glow can
     *        never sit anywhere other than on its bolt.
     * @param {Array<{slot:number,head:number,brightness:number}>} live  bolts in
     *        flight. The list is COMPACTED — a landed bolt is absent — so each
     *        entry carries its own `slot`, the bolt's index, and that is what
     *        picks the sprite set. Indexing by array position instead would hand
     *        a landing bolt's trail to the next one and pop it backwards.
     * @param {number} boltT  the bolt's own length in normalised path space.
     */
    update(pointAt, live, boltT) {
      if (dead || layer.destroyed) return;
      try {
        // Resolve the compacted list back onto stable per-bolt slots.
        bySlot.fill(null);
        for (let i = 0; i < (live?.length ?? 0); i++) {
          const e = live[i];
          const slot = Number.isFinite(e?.slot) ? e.slot : i;
          if (slot >= 0 && slot < bolts) bySlot[slot] = e;
        }
        // Trail step is a fraction of the BOLT's length, so the tail scales with
        // the shot the way everything else in the volley does.
        const step = trailCount > 0
          ? (Math.max(0, boltT) * trailReach) / trailCount
          : 0;

        for (let b = 0; b < bolts; b++) {
          const entry = bySlot[b];
          const show = !!entry;
          const head = heads[b];
          const corona = coronas[b];
          const row = trails[b];

          head.visible = corona.visible = show;
          if (!show) {
            for (let k = 0; k < trailCount; k++) row[k].visible = false;
            continue;
          }

          // `head` is the ribbon's own field name for the bolt's position along
          // the path; reusing it keeps one vocabulary across the two consumers.
          const t = Math.min(1, Math.max(0, _num(entry.head, 0)));
          const bright = Math.max(0, _num(entry.brightness, 1));
          const p = pointAt(t);
          const behind = pointAt(Math.max(0,t-Math.max(.001,boltT*.2)));
          const ahead = pointAt(Math.min(1,t+.001));
          const heading = Math.atan2(ahead.y-behind.y,ahead.x-behind.x);

          head.position.set(p.x, p.y);
          head.rotation = heading;
          head.scale.set(coreScale*1.45,coreScale*.62);
          head.alpha = coreAlpha * bright;

          corona.position.set(p.x, p.y);
          corona.rotation = heading;
          corona.scale.set(coronaScale*1.3,coronaScale*.7);
          corona.alpha = coronaAlpha * bright;

          // Sampled BACKWARDS ALONG THE PATH rather than kept as a history
          // buffer: frame-rate independent, and correct on the very first frame
          // instead of collapsing to a point behind the muzzle.
          for (let k = 0; k < trailCount; k++) {
            const s = row[k];
            const tk = t - ((k + 1) * step);
            if (tk <= 0) { s.visible = false; continue; }
            const f = 1 - (k / trailCount);
            const q = pointAt(tk);
            const next = pointAt(Math.min(t,tk+step));
            s.visible = true;
            s.position.set(q.x, q.y);
            // Size tapers to a FLOOR, not to nothing. A plain `radius * f` put
            // the last of six puffs at a sixth of the head — around a pixel on a
            // 100px grid, which is not a faint puff but an invisible one. The
            // trail is meant to thin, not to vanish before it has been seen.
            const size=trailScale*(TRAIL_MIN_SCALE+((1-TRAIL_MIN_SCALE)*f));
            s.rotation=Math.atan2(next.y-q.y,next.x-q.x);
            // Overlapping, stretched samples form a short ion streak; round
            // dots at evenly spaced positions read as a string of beads.
            s.scale.set(Math.max(size*1.8,Math.hypot(next.x-q.x,next.y-q.y)*2.3/RADIAL_TEX),size*.65);
            s.alpha = trailAlpha * f * f * bright * .72;
          }
        }
      } catch { /* mid-teardown */ }
    },

    /**
     * Not normally needed: the sprites are children of the effect container,
     * which `_fadeContainer` destroys with `{children: true}`. Here so a caller
     * that owns its own lifetime can drop the glow early without leaving the
     * update path writing into destroyed sprites.
     */
    destroy() {
      if (dead) return;
      dead = true;
      try { layer.destroy({ children: true }); } catch { /* already gone */ }
    },
  };
}
