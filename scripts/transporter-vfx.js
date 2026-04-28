/**
 * sta2e-toolkit | transporter-vfx.js
 *
 * Native Foundry v14 transporter visual effects.
 * No Sequencer, JB2A, or TokenMagic required.
 *
 * Architecture
 * ────────────
 * Each transport plays three visual layers simultaneously:
 *
 *   1. Beam column — a soft, faction-coloured pillar of light built from an
 *      offscreen-canvas gradient sprite (ADD blend mode) with a moving scan
 *      band that sweeps upward (beam-out) or downward (beam-in) to sell the
 *      "molecular disassembly" direction.
 *
 *   2. Particle motes — upward-drifting sparkle particles spawned in a ring
 *      around the token.  Uses foundry.canvas.vfx.ParticleGenerator when the
 *      v14 API is available; falls back to a manual PIXI ticker emitter.
 *
 *   3. Token shimmer — PIXI ColorMatrixFilter (brightness boost) + GlowFilter
 *      (faction-coloured, pulsing) applied directly to token.mesh.  Replaces
 *      the TokenMagic dependency with no external module needed.
 *
 * All three layers self-clean after the effect ends.
 *
 * Public API (both fire-and-forget; caller still owns token.document lifecycle):
 *   TransporterVFX.beamOut(token, transporterType)
 *   TransporterVFX.beamIn(token, transporterType)
 *
 * Console test (select a token first):
 *   game.sta2eToolkit.testVFX("tngFed")
 *   game.sta2eToolkit.testVFX("klingon", "in")
 */

// ── Faction palettes ──────────────────────────────────────────────────────────
// primary  — particle tint, ring colour, glow colour
// bright   — mote highlight colour
// hex      — CSS hex string used in canvas gradient

const VFX_COLORS = {
  voyFed:     { primary: 0x6699FF, bright: 0xAABBFF, hex: "#6699ff" },
  tngFed:     { primary: 0x4488FF, bright: 0x99BBFF, hex: "#4488ff" },
  tmpFed:     { primary: 0xCCDDFF, bright: 0xEEF4FF, hex: "#ccdeff" }, // cool silver-white
  tosFed:     { primary: 0xFFD700, bright: 0xFFEE99, hex: "#ffd700" }, // gold
  klingon:    { primary: 0xCC2200, bright: 0xFF7755, hex: "#cc2200" },
  cardassian: { primary: 0xCC7700, bright: 0xFFAA44, hex: "#cc7700" },
  romulan:    { primary: 0x00AA44, bright: 0x55EE88, hex: "#00aa44" },
  ferengi:    { primary: 0xFF8800, bright: 0xFFBB55, hex: "#ff8800" },
  borg:       { primary: 0x44BB22, bright: 0x99FF55, hex: "#44bb22" },
};

// Timing config per faction (ms).
// total     — how long the whole VFX plays before PIXI cleanup
// beamFadeIn  — how fast the beam column fades in
// beamFadeOut — how fast it fades out at the end
// scanSpeed — ms for one scan-band sweep across the full beam height
const VFX_TIMING = {
  voyFed:     { total: 5600, beamFadeIn: 350, beamFadeOut: 900, scanSpeed: 850  },
  tngFed:     { total: 5600, beamFadeIn: 350, beamFadeOut: 900, scanSpeed: 850  },
  tmpFed:     { total: 5400, beamFadeIn: 250, beamFadeOut: 750, scanSpeed: 750  }, // crisp
  tosFed:     { total: 5800, beamFadeIn: 450, beamFadeOut: 1100, scanSpeed: 950 }, // leisurely
  klingon:    { total: 4800, beamFadeIn: 180, beamFadeOut: 600, scanSpeed: 600  }, // violent/fast
  cardassian: { total: 5200, beamFadeIn: 300, beamFadeOut: 800, scanSpeed: 780  },
  romulan:    { total: 6000, beamFadeIn: 550, beamFadeOut: 1200, scanSpeed: 1050 }, // sinister/slow
  ferengi:    { total: 5000, beamFadeIn: 250, beamFadeOut: 700, scanSpeed: 680  },
  borg:       { total: 5200, beamFadeIn: 300, beamFadeOut: 900, scanSpeed: 800  },
};

function _vc(type) { return VFX_COLORS[type] ?? VFX_COLORS.tngFed; }
function _vt(type) { return VFX_TIMING[type] ?? VFX_TIMING.tngFed; }

// ── PIXI compatibility shims ──────────────────────────────────────────────────
// Foundry v14 uses PIXI v8.  v8 changed the blend mode and Graphics APIs.
// These shims let the same code run against both v7 (older Foundry) and v8.

function _addBlend() {
  // PIXI v7: BLEND_MODES.ADD is a numeric constant.
  // PIXI v8: blend modes are lowercase strings.
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

// PIXI v7: g.lineStyle(w, color, alpha)  /  g.drawEllipse(...)  /  g.drawCircle(...)
// PIXI v8: g.stroke({ width, color, alpha })  /  g.ellipse(...)  /  g.circle(...)
// We detect at runtime which API is present.

function _gLine(g, width, color, alpha) {
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
  } else {
    // v8 method chaining — stroke() is called after the shape method
    g._sta2eStroke = { width, color, alpha };
  }
}

function _gCircle(g, cx, cy, r) {
  if (typeof g.drawCircle === "function") {
    g.drawCircle(cx, cy, r);
  } else {
    // PIXI v8: draw shape first, then apply fill + stroke in that order
    g.circle(cx, cy, r);
    if (g._sta2eFill)   { g.fill(g._sta2eFill);     delete g._sta2eFill; }
    if (g._sta2eStroke) { g.stroke(g._sta2eStroke); delete g._sta2eStroke; }
  }
}

function _gRect(g, x, y, w, h) {
  if (typeof g.drawRect === "function") {
    g.drawRect(x, y, w, h);
  } else {
    g.rect(x, y, w, h);
    if (g._sta2eFill)   { g.fill(g._sta2eFill);     delete g._sta2eFill; }
    if (g._sta2eStroke) { g.stroke(g._sta2eStroke); delete g._sta2eStroke; }
  }
}

function _gEllipse(g, cx, cy, rx, ry) {
  if (typeof g.drawEllipse === "function") {
    g.drawEllipse(cx, cy, rx, ry);
  } else {
    // PIXI v8: draw shape first, then apply fill + stroke in that order
    g.ellipse(cx, cy, rx, ry);
    if (g._sta2eFill)   { g.fill(g._sta2eFill);     delete g._sta2eFill; }
    if (g._sta2eStroke) { g.stroke(g._sta2eStroke); delete g._sta2eStroke; }
  }
}

function _gFill(g, color, alpha) {
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
  } else {
    g._sta2eFill = { color, alpha };
  }
}

function _gEndFill(g) {
  if (typeof g.endFill === "function") {
    g.endFill();
  }
  // In v8, fill() is called after the shape methods; handled inside shape helpers
}

// ── Canvas layer ──────────────────────────────────────────────────────────────
// VFX objects go into canvas.tokens — the same PlaceablesLayer that tokens
// live in.  Adding here with a high zIndex puts them above every token sprite
// without fighting canvas.primary's PrimarySpriteMesh compositing pass.
// sortableChildren is already true on TokenLayer (Foundry uses it for token
// elevation ordering), so our zIndex values are honoured immediately.

// Baseline VFX zIndex — used as a floor; beamOut/beamIn compute the actual
// effective zIndex at call time using Math.max(VFX_Z_BASE, token.zIndex + 10_000)
// so we always beat the token's live elevation-derived zIndex value.
const VFX_Z_BASE = 900_000;

function _effectLayer() {
  // In Foundry v14, token sprites (PrimarySpriteMesh) live in canvas.primary,
  // while canvas.tokens (TokenLayer) is a separate interaction layer that sits
  // ABOVE canvas.primary in the display list.  Either way we want a layer that
  // renders above the token sprite.
  //
  // Priority order:
  //   1. canvas.interface — definitely above everything (UI layer)
  //   2. canvas.controls  — above tokens but may clip/interfere with rulers
  //   3. canvas.tokens    — same layer as Token PlaceableObjects; sortableChildren
  //                         lets zIndex control ordering within the layer
  //   4. canvas.primary   — last resort
  //
  // We prefer canvas.tokens so the VFX participates in normal scene z-ordering.
  // If the token's own zIndex in that layer is too high (handled by the dynamic
  // baseZ in beamOut/beamIn), we simply beat it.
  const layer = canvas.tokens ?? canvas.interface ?? canvas.primary ?? canvas.stage;
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

// ── animejs accessor ──────────────────────────────────────────────────────────
// Foundry v14 exposes the full animejs v4 module as globalThis.animejs.
// The primary entry point in v4 is animejs.animate(target, params).

function _anime() {
  return globalThis.animejs ?? null;
}

// Thin animate wrapper — falls back to instant assignment if animejs absent.
function _tween(target, params, delayMs = 0) {
  const aj = _anime();
  if (aj?.animate) {
    const p = delayMs > 0 ? { ...params, delay: delayMs } : params;
    aj.animate(target, p);
  } else {
    setTimeout(() => {
      for (const [k, v] of Object.entries(params)) {
        if (k === "duration" || k === "ease" || k === "delay") continue;
        try {
          const val = Array.isArray(v) ? v[v.length - 1] : v;
          target[k] = val;
        } catch { /**/ }
      }
    }, delayMs);
  }
}

// ── Beam column ───────────────────────────────────────────────────────────────

/**
 * Build the central beam-of-light column.
 *
 * Visual construction:
 *   • A 128×512 offscreen canvas with a horizontal soft-edge gradient gives a
 *     smooth "tube of light" when stretched to token dimensions.
 *   • A second 128×128 canvas forms the scan band — a bright horizontal stripe
 *     that animatesvup (beam-out) or down (beam-in) to imply direction.
 *   • Two base ellipse rings at the bottom anchor the beam to the ground.
 *
 * Returns a PIXI.Container with named child references for animation:
 *   container._scanBand   — PIXI.Sprite for the sweeping band
 *   container._beamH      — pixel height of the beam sprite
 *   container._beamOffY   — y-offset of the beam sprite centre from container origin
 *
 * The container's (x, y) should be set to the token centre.
 */
function _createBeam(cx, cy, tokenW, tokenH, colors, zBase = VFX_Z_BASE) {
  const container = new PIXI.Container();
  container.x      = cx;
  container.y      = cy;
  container.zIndex = zBase;

  const beamW    = tokenW  * 0.64;
  const beamH    = tokenH  * 2.7;
  const beamOffY = -tokenH * 0.68;   // shift up so beam base sits at token feet

  // ── Primary beam gradient ─────────────────────────────────────────────────
  // Horizontal gradient: transparent → faction edge → white core → faction edge → transparent
  const oc  = document.createElement("canvas");
  oc.width  = 128;
  oc.height = 512;
  const ctx = oc.getContext("2d");

  const hg = ctx.createLinearGradient(0, 0, 128, 0);
  const pc  = colors.hex;
  hg.addColorStop(0,    "rgba(0,0,0,0)");
  hg.addColorStop(0.15, `${pc}33`);
  hg.addColorStop(0.35, `${pc}aa`);
  hg.addColorStop(0.50, "rgba(255,255,255,0.92)");
  hg.addColorStop(0.65, `${pc}aa`);
  hg.addColorStop(0.85, `${pc}33`);
  hg.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, 128, 512);

  // Vertical fade: dim at very top and bottom of column
  const vg = ctx.createLinearGradient(0, 0, 0, 512);
  vg.addColorStop(0,    "rgba(0,0,0,0.55)");
  vg.addColorStop(0.12, "rgba(0,0,0,0)");
  vg.addColorStop(0.88, "rgba(0,0,0,0)");
  vg.addColorStop(1,    "rgba(0,0,0,0.65)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, 128, 512);

  const beamTex    = PIXI.Texture.from(oc);
  const beamSprite = new PIXI.Sprite(beamTex);
  beamSprite.anchor.set(0.5, 0.5);
  beamSprite.width     = beamW;
  beamSprite.height    = beamH;
  beamSprite.y         = beamOffY;
  beamSprite.blendMode = _addBlend();
  container.addChild(beamSprite);

  // ── Scan band ─────────────────────────────────────────────────────────────
  // A soft horizontal stripe that sweeps through the beam.
  const sb   = document.createElement("canvas");
  sb.width   = 128;
  sb.height  = 128;
  const sctx = sb.getContext("2d");
  const sg   = sctx.createLinearGradient(0, 0, 0, 128);
  sg.addColorStop(0,   "rgba(0,0,0,0)");
  sg.addColorStop(0.35, "rgba(255,255,255,0.6)");
  sg.addColorStop(0.65, "rgba(255,255,255,0.6)");
  sg.addColorStop(1,   "rgba(0,0,0,0)");
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 128, 128);

  const scanTex    = PIXI.Texture.from(sb);
  const scanBand   = new PIXI.Sprite(scanTex);
  scanBand.anchor.set(0.5, 0.5);
  scanBand.width     = beamW * 0.92;
  scanBand.height    = beamH * 0.16;
  scanBand.blendMode = _addBlend();
  scanBand.alpha     = 0;
  container.addChild(scanBand);

  // ── Base rings ────────────────────────────────────────────────────────────
  const baseY  = tokenH * 0.44;
  const baseRx = beamW  * 0.46;
  const baseRy = beamW  * 0.13;

  const rings = new PIXI.Graphics();
  rings.blendMode = _addBlend();

  _gLine(rings, 2.0, colors.primary, 0.9);
  _gEllipse(rings, 0, baseY, baseRx, baseRy);

  _gLine(rings, 1.0, 0xFFFFFF, 0.45);
  _gEllipse(rings, 0, baseY, baseRx * 0.65, baseRy * 0.65);

  container.addChild(rings);

  // Expose references for the animation phase
  container._scanBand   = scanBand;
  container._beamH      = beamH;
  container._beamOffY   = beamOffY;

  return container;
}

// ── Expanding / contracting indicator ring ────────────────────────────────────

function _createRing(cx, cy, tokenW, colors, zBase = VFX_Z_BASE) {
  const g = new PIXI.Graphics();
  g.x      = cx;
  g.y      = cy;
  g.zIndex = zBase + 1;
  g.blendMode = _addBlend();

  const r  = tokenW * 0.38;

  _gLine(g, 2.5, colors.primary, 0.85);
  _gCircle(g, 0, 0, r);

  _gLine(g, 1.0, 0xFFFFFF, 0.40);
  _gCircle(g, 0, 0, r * 0.72);

  return g;
}

// ── Particle motes ────────────────────────────────────────────────────────────

/**
 * Emit sparkle motes that cascade downward over the token.
 *
 * Particles spawn across the top of the beam column (above the token's head)
 * and fall downward, passing over and through the token — visually "on top of"
 * it.  This matches the classic Star Trek transporter sparkle-shower look.
 *
 * Strategy:
 *   1. Try foundry.canvas.vfx.VFXEffect with a particle component if the v14
 *      native API supports it (detected at runtime from the components namespace).
 *   2. Fall back to a manual PIXI.Graphics ticker emitter (always available).
 *
 * Returns a stop function — calling it ceases new emission; existing particles
 * always fade out naturally.
 *
 * @param {PIXI.Container} layer
 * @param {number} cx / cy   Token centre in canvas coords
 * @param {number} tokenW    Token pixel width
 * @param {number} tokenH    Token pixel height
 * @param {object} colors    VFX_COLORS entry
 * @param {number} zBase     Base zIndex (beam + 2)
 */
function _startMotes(layer, cx, cy, tokenW, tokenH, colors, zBase = VFX_Z_BASE) {
  // Spawn band — wide enough to cover the full token plus slight overhang,
  // positioned above the token's head so sparkles rain down over the figure.
  const spawnY    = cy - tokenH * 0.575;  // above the token's head (25% lower than before)
  const spawnHalf = tokenW * 0.52;        // slightly wider than the token

  // Log available v14 VFX surface so we know what to wire up next.
  const vfxNS   = foundry.canvas?.vfx;
  const vfxComp = vfxNS?.components;
  console.log(
    "sta2e-toolkit | _startMotes — v14 vfx.components keys:",
    vfxComp ? JSON.stringify(Object.keys(vfxComp)) : "namespace absent",
  );

  // ── PIXI ticker emitter ───────────────────────────────────────────────────
  // Reliable cross-version fallback.  Dense sparkle rain over the token.
  console.log(
    "sta2e-toolkit | _startMotes PIXI emitter — layer:", layer?.constructor?.name,
    "| zIndex:", zBase + 2,
    "| sortableChildren:", layer?.sortableChildren,
    "| spawnY:", spawnY.toFixed(0), "spawnHalf:", spawnHalf.toFixed(0),
  );
  const container  = new PIXI.Container();
  container.zIndex = zBase + 2;   // above beam column and ring
  layer.addChild(container);

  // Faction-coloured glow on the whole rain container — one filter pass
  // covers every streak particle without per-object cost.
  try {
    const GF = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (GF) {
      container.filters = [new GF({
        distance:      8,
        outerStrength: 1.8,
        innerStrength: 0.3,
        color:         colors.primary,
        quality:       0.25,
      })];
    }
  } catch { /**/ }

  let   emitting  = true;
  const particles = [];
  let   lastSpawn = 0;
  let   prevNow   = performance.now();

  function spawnParticle() {
    // Spawn uniformly across the full width of the token (slight overhang)
    const spawnX = cx + (Math.random() - 0.5) * spawnHalf * 2;
    const sy     = spawnY + (Math.random() - 0.5) * tokenH * 0.10;

    // Rainfall: near-vertical fall with almost no sideways drift.
    // ±0.04 rad ≈ ±2.3° — just enough to avoid a mechanical look.
    const driftA = (Math.random() - 0.5) * 0.08;
    const speed  = 220 + Math.random() * 200;   // 220–420 px/s — fast like rain
    const life   = 280 + Math.random() * 220;   // short life; they traverse quickly

    // Thin vertical streak — tall ellipse (rx ≈ 1, ry ≈ 3–6) so each drop
    // looks like a falling streak rather than a floating flake.
    const rx = 0.8 + Math.random() * 0.5;
    const ry = 3.0 + Math.random() * 3.5;

    const g = new PIXI.Graphics();
    _gFill(g, colors.bright, 0.88 + Math.random() * 0.12);
    _gEllipse(g, 0, 0, rx, ry);
    _gEndFill(g);
    g.blendMode = _addBlend();
    g.x = spawnX;
    g.y = sy;
    // Tilt the streak slightly in the direction of travel so it reads as motion
    g.rotation = driftA;
    container.addChild(g);

    particles.push({
      g,
      vx:  Math.sin(driftA) * speed,
      vy: +Math.cos(driftA) * speed,   // positive y = downward in PIXI
      life,
      age: 0,
    });
  }

  function tick() {
    const now = performance.now();
    const dt  = Math.min(now - prevNow, 50);   // clamp to avoid huge jumps
    prevNow   = now;

    if (emitting && now - lastSpawn > 6) {    // ~167 particles/sec — 50% denser rainfall
      spawnParticle();
      lastSpawn = now;
      if (particles.length === 1) {
        console.log("sta2e-toolkit | PIXI fallback: first particle spawned",
          "| container.parent:", container.parent?.constructor?.name ?? "NO PARENT — not added to scene!");
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p  = particles[i];
      p.age   += dt;
      p.g.x   += p.vx * (dt / 1000);
      p.g.y   += p.vy * (dt / 1000);
      p.g.alpha = Math.max(0, 1 - p.age / p.life);

      if (p.age >= p.life) {
        container.removeChild(p.g);
        p.g.destroy();
        particles.splice(i, 1);
      }
    }

    if (!emitting && particles.length === 0) {
      canvas.app.ticker.remove(tick);
      try { container.destroy(); } catch { /**/ }
    }
  }

  canvas.app.ticker.add(tick);
  return () => { emitting = false; };
}

// ── Token shimmer filters ─────────────────────────────────────────────────────

/**
 * Apply faction-coloured glow + brightness boost to token.mesh.
 *
 *   • PIXI.filters.ColorMatrixFilter — cranks brightness so the token looks
 *     like it's dissolving into light.
 *   • PIXI.filters.GlowFilter (pixi-filters, bundled with Foundry) — faction
 *     coloured outer glow animated via animejs so it pulses like TokenMagic's
 *     glow filter.
 *
 * Returns a cleanup function that removes both filters and stops any animation.
 */
function _applyFilters(token, colors) {
  const mesh = token.mesh;
  if (!mesh) return () => {};

  const prior  = Array.isArray(mesh.filters) ? [...mesh.filters] : [];
  const added  = [];
  let   pulseAnim = null;

  // Brightness — makes the token visually "hot" during transport
  // PIXI v8 moved ColorMatrixFilter off the filters sub-namespace.
  try {
    const CMF = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
    if (CMF) {
      const cmf = new CMF();
      cmf.brightness(1.45, false);
      added.push(cmf);
    }
  } catch (err) {
    console.debug("sta2e-toolkit | ColorMatrixFilter unavailable:", err?.message);
  }

  // Glow — faction coloured, pulsing outer light
  try {
    const GF = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (GF) {
      const glow = new GF({
        distance:      18,
        outerStrength: 2.0,
        innerStrength: 0.4,
        color:         colors.primary,
        quality:       0.35,
      });
      added.push(glow);

      // Animate glow pulse with animejs if available
      const aj = _anime();
      if (aj?.animate && glow.outerStrength !== undefined) {
        // Ping-pong 0.4 → 3.2 → 0.4 on a 700ms loop
        const loop = () => {
          if (!glow._sta2eActive) return;
          aj.animate(glow, {
            outerStrength: [0.4, 3.2],
            duration:      350,
            ease:          "inOutSine",
            onComplete:    () => {
              if (!glow._sta2eActive) return;
              aj.animate(glow, {
                outerStrength: [3.2, 0.4],
                duration:      350,
                ease:          "inOutSine",
                onComplete:    loop,
              });
            },
          });
        };
        glow._sta2eActive = true;
        loop();
        pulseAnim = () => { glow._sta2eActive = false; };
      }
    }
  } catch (err) {
    console.debug("sta2e-toolkit | GlowFilter unavailable:", err?.message);
  }

  if (added.length) mesh.filters = [...prior, ...added];

  return () => {
    if (pulseAnim) pulseAnim();
    mesh.filters = (mesh.filters ?? []).filter(f => !added.includes(f));
  };
}

// ── Materialization motes ─────────────────────────────────────────────────────

/**
 * Tiny dots that pop in and out randomly across the token's silhouette,
 * selling the illusion of matter being assembled or disassembled at the
 * quantum level.
 *
 * Unlike the rainfall particles (which fall through), these stay pinned to
 * random positions within the token's bounding ellipse and simply flicker —
 * each one fades in fast, holds for a moment, then fades out.  High spawn
 * rate with short lifetimes keeps the surface "alive" with activity.
 *
 * Beam-out: run from the start; density ramps down naturally as the caller
 *   stops emission before the final flash.
 * Beam-in:  run from the start; caller stops them once the token is solid.
 *
 * Returns a stop function.
 *
 * @param {PIXI.Container} layer
 * @param {number} cx / cy    Token centre in canvas coords
 * @param {number} tokenW/H   Token pixel dimensions
 * @param {object} colors     VFX_COLORS entry
 * @param {number} zBase      Base zIndex
 */
function _startMaterializeMotes(layer, cx, cy, tokenW, tokenH, colors, zBase) {
  const container  = new PIXI.Container();
  container.zIndex = zBase + 4;   // above rain, ring, beam, and flash
  layer.addChild(container);

  let   emitting = true;
  const particles = [];
  let   lastSpawn = 0;
  let   prevNow   = performance.now();

  function spawnMote() {
    // Random position inside the token's bounding ellipse.
    // sqrt(rand) gives uniform distribution across the area rather than
    // clustering at the centre.
    const angle = Math.random() * Math.PI * 2;
    const t     = Math.sqrt(Math.random());
    const mx    = cx + Math.cos(angle) * (tokenW * 0.46) * t;
    const my    = cy + Math.sin(angle) * (tokenH * 0.46) * t;

    const r          = 0.7 + Math.random() * 1.6;   // tiny — 0.7 to 2.3 px radius
    const peakAlpha  = 0.55 + Math.random() * 0.45;
    const lifetime   = 100 + Math.random() * 200;   // 100–300 ms per mote
    const peakAt     = lifetime * (0.15 + Math.random() * 0.25); // peaks early

    // Alternate between faction bright and pure white for variety
    const tint = Math.random() > 0.35 ? colors.bright : 0xFFFFFF;

    const g = new PIXI.Graphics();
    _gFill(g, tint, 1.0);
    _gCircle(g, 0, 0, r);
    _gEndFill(g);
    g.blendMode = _addBlend();
    g.x     = mx;
    g.y     = my;
    g.alpha = 0;
    container.addChild(g);

    particles.push({ g, life: lifetime, age: 0, peakAt, peakAlpha });
  }

  function tick() {
    const now = performance.now();
    const dt  = Math.min(now - prevNow, 50);
    prevNow   = now;

    // ~200 spawns/sec — dense enough that ~20–25 motes are alive at any moment
    if (emitting && now - lastSpawn > 5) {
      spawnMote();
      lastSpawn = now;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age  += dt;

      // Triangle envelope: ramp up to peak, ramp down to end
      if (p.age < p.peakAt) {
        p.g.alpha = p.peakAlpha * (p.age / p.peakAt);
      } else {
        p.g.alpha = p.peakAlpha * Math.max(0, 1 - (p.age - p.peakAt) / (p.life - p.peakAt));
      }

      if (p.age >= p.life) {
        container.removeChild(p.g);
        p.g.destroy();
        particles.splice(i, 1);
      }
    }

    if (!emitting && particles.length === 0) {
      canvas.app.ticker.remove(tick);
      try { container.destroy(); } catch { /**/ }
    }
  }

  canvas.app.ticker.add(tick);
  return () => { emitting = false; };
}

// ── Flash burst ───────────────────────────────────────────────────────────────

/**
 * Play a brief radial flash burst at the token centre.
 *
 * Used at the end of beam-out (final dissolve pop) and the start of beam-in
 * (arrival burst).  Built from an offscreen-canvas radial gradient so the
 * flash has a soft, photographic quality rather than a hard-edged circle.
 *
 * The burst flashes in over ~80 ms, then expands and fades over ~300 ms.
 * Self-destructs — no cleanup needed by the caller.
 *
 * @param {PIXI.Container} layer
 * @param {number} cx / cy   Token centre in canvas coords
 * @param {number} tokenW    Token pixel width
 * @param {object} colors    VFX_COLORS entry
 * @param {number} zBase     Base zIndex (beam)
 */
function _flashBurst(layer, cx, cy, tokenW, colors, zBase) {
  // Radial gradient: white hot core → faction colour → transparent edge
  const oc   = document.createElement("canvas");
  oc.width   = 128;
  oc.height  = 128;
  const ctx  = oc.getContext("2d");
  const rg   = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0,    "rgba(255,255,255,0.98)");
  rg.addColorStop(0.20, "rgba(255,255,255,0.82)");
  rg.addColorStop(0.45, `${colors.hex}cc`);
  rg.addColorStop(0.75, `${colors.hex}44`);
  rg.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 128, 128);

  const tex    = PIXI.Texture.from(oc);
  const sprite = new PIXI.Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.blendMode = _addBlend();

  const container  = new PIXI.Container();
  container.x      = cx;
  container.y      = cy;
  container.zIndex = zBase + 3;   // above beam, ring, and particles
  container.alpha  = 0;
  container.scale.set(0.25);      // starts small — expands outward
  // Initial size covers the token; expansion reaches ~2.5× the token width
  const startSize = tokenW * 0.90;
  sprite.width  = startSize;
  sprite.height = startSize;
  container.addChild(sprite);
  layer.addChild(container);

  // Flash in quickly, then expand and fade simultaneously
  _tween(container,       { alpha: 1,    duration:  75, ease: "outQuad" });
  _tween(container.scale, { x: 3.2, y: 3.2, duration: 380, ease: "outQuad" });
  _tween(container,       { alpha: 0,    duration: 320, ease: "inQuad" }, 75);

  // Self-destruct after animation completes
  setTimeout(() => {
    try { container.destroy({ children: true }); } catch { /**/ }
  }, 500);
}

// ── Scan line sweep ───────────────────────────────────────────────────────────

/**
 * Two thin vertical scan lines that start at the token centre and sweep
 * outward — one to the left, one to the right — like a dissolve-scanner
 * passing over the figure.
 *
 * Each line is as tall as the token and 2 px wide.  A GlowFilter on the
 * container gives them a soft faction-coloured halo.  They flash in quickly,
 * hold their brightness as they travel, then fade out as they reach the edge.
 *
 * Fire-and-forget — self-destructs when the sweep completes.
 *
 * @param {PIXI.Container} layer
 * @param {number} cx / cy    Token centre
 * @param {number} tokenW/H   Token pixel dimensions
 * @param {object} colors     VFX_COLORS entry
 * @param {number} zBase      Base zIndex
 */
function _scanLineSweep(layer, cx, cy, tokenW, tokenH, colors, zBase) {
  const container  = new PIXI.Container();
  container.zIndex = zBase + 5;
  layer.addChild(container);

  // Faction-coloured glow so the thin lines read clearly against any background
  try {
    const GF = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (GF) {
      container.filters = [new GF({
        distance:      10,
        outerStrength: 2.5,
        innerStrength: 0.5,
        color:         colors.primary,
        quality:       0.3,
      })];
    }
  } catch { /**/ }

  // Two lens-shaped lines — vertical ellipse so each line is thick in the
  // middle and tapers naturally to a sharp point at both ends.
  // rx = half-width at the widest point (middle), ry = half-height (tip to tip)
  const lineRX = 5;               // ~10 px wide at centre
  const lineRY = tokenH * 0.52;   // matches token height, tip-to-tip

  function _makeLine() {
    const g = new PIXI.Graphics();
    _gFill(g, 0xFFFFFF, 1.0);
    _gEllipse(g, 0, 0, lineRX, lineRY);
    _gEndFill(g);
    g.blendMode = _addBlend();
    g.x     = cx;
    g.y     = cy;
    g.alpha = 0;
    container.addChild(g);
    return g;
  }

  const leftLine  = _makeLine();
  const rightLine = _makeLine();

  // Each line travels from the centre to the token edge (half-width)
  const travelDist = tokenW * 0.55;
  const duration   = 380;   // ms for the full outward sweep

  let prevNow = performance.now();
  let age     = 0;

  function tick() {
    const now = performance.now();
    const dt  = Math.min(now - prevNow, 50);
    prevNow   = now;
    age      += dt;

    const t = Math.min(1, age / duration);

    // easeInOutQuad — starts slow, accelerates, slows at the edge
    const eased = t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2 * t + 2, 2) / 2;

    // Alpha: snap in fast, hold at full brightness, fade out toward the edge
    const alpha = t < 0.10 ? t / 0.10
                : t < 0.65 ? 1.0
                :             1.0 - (t - 0.65) / 0.35;

    leftLine.x  = cx - travelDist * eased;
    rightLine.x = cx + travelDist * eased;
    leftLine.alpha  = alpha;
    rightLine.alpha = alpha;

    if (t >= 1) {
      canvas.app.ticker.remove(tick);
      try { container.destroy({ children: true }); } catch { /**/ }
    }
  }

  canvas.app.ticker.add(tick);
}

// ── Swirling orbit particles ──────────────────────────────────────────────────

/**
 * Slow-swirling particles that spiral outward from the token centre,
 * paired with a softly pulsing radial glow at the origin point.
 *
 * Each particle is spawned close to the centre and travels both angularly
 * (orbiting) and radially (drifting outward) so the cloud fans out like a
 * gentle energy vortex.  About half rotate clockwise, half counter-clockwise,
 * giving a dual-helix look similar to the energy coils in classic Trek VFX.
 *
 * A GlowFilter on the container saturates the whole cloud with faction colour.
 * A separate offscreen-canvas radial gradient sprite provides the bright
 * central "source" orb that the particles appear to emit from.
 *
 * Returns a stop function — sets emitting=false; active particles fade out
 * naturally over their remaining lifetime.
 *
 * @param {PIXI.Container} layer
 * @param {number} cx / cy    Token centre in canvas coords
 * @param {number} tokenW/H   Token pixel dimensions
 * @param {object} colors     VFX_COLORS entry
 * @param {number} zBase      Base zIndex
 */
function _swirlOrbit(layer, cx, cy, tokenW, tokenH, colors, zBase) {
  const container  = new PIXI.Container();
  container.zIndex = zBase + 6;   // above scan lines
  layer.addChild(container);

  // Faction-coloured glow — applied once to the container so every particle
  // inherits it without extra per-object filter cost.
  try {
    const GF = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (GF) {
      container.filters = [new GF({
        distance:      20,
        outerStrength: 3.2,
        innerStrength: 1.2,
        color:         colors.primary,
        quality:       0.35,
      })];
    }
  } catch { /**/ }

  // ── Central source orb ───────────────────────────────────────────────────
  // A soft radial gradient sprite that sits at the origin and gives the
  // impression of energy being emitted from a single bright point.
  const oc  = document.createElement("canvas");
  oc.width  = 128;
  oc.height = 128;
  const ctx = oc.getContext("2d");
  const rg  = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0,    "rgba(255,255,255,0.95)");
  rg.addColorStop(0.18, "rgba(255,255,255,0.80)");
  rg.addColorStop(0.40, `${colors.hex}bb`);
  rg.addColorStop(0.70, `${colors.hex}44`);
  rg.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 128, 128);

  const orbTex  = PIXI.Texture.from(oc);
  const orbSize = tokenW * 0.45;
  const orb     = new PIXI.Sprite(orbTex);
  orb.anchor.set(0.5);
  orb.blendMode = _addBlend();
  orb.width  = orbSize;
  orb.height = orbSize;
  orb.x = cx;
  orb.y = cy;
  orb.alpha = 0;
  container.addChild(orb);

  // Pulse the orb: fade in over 400 ms, then breathe gently
  const aj = _anime();
  if (aj?.animate) {
    aj.animate(orb, { alpha: [0, 0.20], duration: 400, ease: "outQuad" });
  } else {
    setTimeout(() => { orb.alpha = 0.20; }, 400);
  }

  // ── Orbit particles ───────────────────────────────────────────────────────
  let   emitting  = true;
  const particles = [];
  let   lastSpawn = 0;
  let   prevNow   = performance.now();

  function spawnOrbitParticle() {
    // Born near the centre; drifts outward while orbiting.
    const startAngle  = Math.random() * Math.PI * 2;
    // Spawn radius: 5–18% of token half-width so they appear to originate
    // from the glowing core rather than materialising at a distance.
    const startRadius = tokenW * (0.05 + Math.random() * 0.13);

    // Angular velocity in radians/sec — mix of CW and CCW for dual-helix look.
    // Range: 1.2–3.0 rad/s (roughly 0.2 – 0.5 rotations/sec — "slow swirl").
    const direction   = Math.random() > 0.5 ? 1 : -1;
    const angularVel  = direction * (1.2 + Math.random() * 2.8);

    // Radial drift: particles slowly spiral outward.
    // 8–20% of tokenW per second so they travel across the token over ~600 ms.
    const driftSpeed  = tokenW * (0.08 + Math.random() * 0.12);

    const size       = 1.2 + Math.random() * 2.8;
    const lifetime   = 500 + Math.random() * 900;      // 500–1400 ms
    const peakAlpha  = 0.65 + Math.random() * 0.35;
    const tint       = Math.random() > 0.3 ? colors.bright : 0xFFFFFF;

    const g = new PIXI.Graphics();
    _gFill(g, tint, 1.0);
    _gCircle(g, 0, 0, size);
    _gEndFill(g);
    g.blendMode = _addBlend();
    g.x = cx + Math.cos(startAngle) * startRadius;
    g.y = cy + Math.sin(startAngle) * startRadius;
    g.alpha = 0;
    container.addChild(g);

    particles.push({
      g,
      angle:      startAngle,
      radius:     startRadius,
      angularVel,
      driftSpeed,
      life:       lifetime,
      age:        0,
      peakAlpha,
    });
  }

  function tick() {
    const now = performance.now();
    const dt  = Math.min(now - prevNow, 50);
    prevNow   = now;

    // ~40 particles/sec — enough to keep a visible swirling cloud without
    // overwhelming the more prominent rain/mote layers.
    if (emitting && now - lastSpawn > 25) {
      spawnOrbitParticle();
      lastSpawn = now;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age    += dt;
      p.angle  += p.angularVel  * (dt / 1000);
      p.radius += p.driftSpeed  * (dt / 1000);

      p.g.x = cx + Math.cos(p.angle) * p.radius;
      p.g.y = cy + Math.sin(p.angle) * p.radius;

      // Alpha envelope: quick fade-in (15%), hold (45%), long fade-out (40%)
      const t = Math.min(1, p.age / p.life);
      if      (t < 0.15) { p.g.alpha = p.peakAlpha * (t / 0.15); }
      else if (t < 0.60) { p.g.alpha = p.peakAlpha; }
      else               { p.g.alpha = p.peakAlpha * (1 - (t - 0.60) / 0.40); }

      if (p.age >= p.life) {
        container.removeChild(p.g);
        p.g.destroy();
        particles.splice(i, 1);
      }
    }

    if (!emitting && particles.length === 0) {
      canvas.app.ticker.remove(tick);
      try { container.destroy({ children: true }); } catch { /**/ }
    }
  }

  canvas.app.ticker.add(tick);

  // Return a stop function that also fades the orb out
  return () => {
    emitting = false;
    if (aj?.animate) {
      aj.animate(orb, { alpha: 0, duration: 400, ease: "inQuad" });
    } else {
      setTimeout(() => { try { orb.alpha = 0; } catch { /**/ } }, 400);
    }
  };
}

// ── Scan band sweep animation ─────────────────────────────────────────────────

/**
 * Animate the scan band sweeping through the beam column.
 *
 * @param {PIXI.Sprite} scanBand    The scan band sprite
 * @param {number}      fromY       Starting Y position (beam top or bottom)
 * @param {number}      toY         Ending Y position
 * @param {number}      speed       Duration of one sweep in ms
 * @param {number}      passes      How many sweeps to play
 * @param {number}      startDelay  ms before first sweep begins
 */
function _animateScanBand(scanBand, fromY, toY, speed, passes, startDelay) {
  const aj = _anime();

  function runPass(passIndex) {
    if (passIndex >= passes) return;
    scanBand.y     = fromY;
    scanBand.alpha = 0;

    const delay = passIndex === 0 ? startDelay : 0;

    if (aj?.animate) {
      aj.animate(scanBand, {
        alpha:    [0, 0.72, 0],
        duration: speed,
        ease:     "inOutSine",
        delay,
        onComplete: () => runPass(passIndex + 1),
      });
      aj.animate(scanBand, {
        y:        toY,
        duration: speed,
        ease:     "linear",
        delay,
      });
    } else {
      setTimeout(() => {
        scanBand.alpha = 0.6;
        scanBand.y     = toY;
        setTimeout(() => {
          scanBand.alpha = 0;
          runPass(passIndex + 1);
        }, speed);
      }, delay);
    }
  }

  runPass(0);
}

// ── Main effect engine ────────────────────────────────────────────────────────

export class TransporterVFX {

  /**
   * Beam-out visual effect.  Fire-and-forget.
   *
   * Plays for ~timing.total ms then cleans up all PIXI objects.
   * Token alpha fade and document deletion remain the caller's responsibility
   * (transporter.js schedules these via setTimeout as before).
   *
   * @param {Token}  token
   * @param {string} transporterType   Key into VFX_COLORS / VFX_TIMING
   */
  static beamOut(token, transporterType = "tngFed") {
    const colors = _vc(transporterType);
    const timing = _vt(transporterType);
    const layer  = _effectLayer();
    const { x: cx, y: cy } = token.center;
    const w = token.w, h = token.h;
    const aj = _anime();

    // Beat the token's live elevation-derived zIndex — whatever it is.
    const tokenZ = typeof token.zIndex === "number" ? token.zIndex : 0;
    const baseZ  = Math.max(VFX_Z_BASE, tokenZ + 10_000);

    console.log(
      `sta2e-toolkit | TransporterVFX.beamOut("${transporterType}")`,
      `\n  layer       : ${layer?.constructor?.name ?? "none"}`,
      `\n  sortable    : ${layer?.sortableChildren}`,
      `\n  animejs     : ${aj ? "✓ available" : "✗ missing — using setTimeout fallback"}`,
      `\n  vfx API     : ${Object.keys(foundry.canvas?.vfx ?? {}).join(", ")}`,
      `\n  token centre: (${cx.toFixed(0)}, ${cy.toFixed(0)})  size: ${w}×${h}`,
      `\n  token.zIndex: ${tokenZ}  →  baseZ: ${baseZ}`,
    );

    // ── Build PIXI objects ────────────────────────────────────────────────
    const beam = _createBeam(cx, cy, w, h, colors, baseZ);
    const ring = _createRing(cx, cy, w, colors, baseZ);
    beam.alpha = 0;
    ring.alpha = 0;
    ring.scale.set(0.5);

    layer.addChild(ring);
    layer.addChild(beam);

    // ── Ring: flash in → expand → fade ───────────────────────────────────
    _tween(ring, { alpha: 0.9, duration: 200, ease: "outQuad" });
    _tween(ring.scale, { x: 2.8, y: 2.8, duration: 1800, ease: "outQuad" });
    _tween(ring, { alpha: 0,   duration: 1400, ease: "outQuad" }, 200);

    // ── Beam column: fade in, then fade out near the end ──────────────────
    _tween(beam, { alpha: 0.88, duration: timing.beamFadeIn, ease: "outQuad" });
    const beamFadeStart = timing.total - timing.beamFadeOut - 300;
    _tween(beam, { alpha: 0, duration: timing.beamFadeOut, ease: "inQuad" }, beamFadeStart);

    // ── Scan bands sweep upward (beam-out = matter going up) ──────────────
    const sb   = beam._scanBand;
    const botY = beam._beamOffY + beam._beamH * 0.46;
    const topY = beam._beamOffY - beam._beamH * 0.46;
    if (sb) _animateScanBand(sb, botY, topY, timing.scanSpeed, 2, timing.beamFadeIn + 50);

    // ── Rainfall particles ────────────────────────────────────────────────
    let stopMotes;
    const moteStopAt = timing.total - 900;
    setTimeout(() => {
      stopMotes = _startMotes(layer, cx, cy, w, h, colors, baseZ);
    }, 200);
    setTimeout(() => { if (stopMotes) stopMotes(); }, moteStopAt);

    // ── Materialization motes — token surface dissolving ─────────────────
    // Start immediately so the token appears to disassemble from the first frame.
    // Stop just before the flash so the last thing seen is the burst, not dots.
    const stopMatMotes = _startMaterializeMotes(layer, cx, cy, w, h, colors, baseZ);
    setTimeout(stopMatMotes, timing.total - 900);

    // ── Swirling orbit particles — energy vortex from centre ─────────────
    // Starts ~300 ms in so the orb fades in as the beam column is establishing.
    // Stops with the motes just before the final flash.
    let stopSwirl;
    setTimeout(() => {
      stopSwirl = _swirlOrbit(layer, cx, cy, w, h, colors, baseZ);
    }, 300);
    setTimeout(() => { if (stopSwirl) stopSwirl(); }, timing.total - 900);

    // ── Scan line sweep — two lines split outward near the end ───────────
    // Fires just before the flash so the lines sweep and fade right as the
    // final burst fires.  Sweep duration is ~380 ms so timing.total - 1200
    // lands comfortably before the flash at timing.total - 750.
    setTimeout(() => {
      _scanLineSweep(layer, cx, cy, w, h, colors, baseZ);
    }, timing.total - 2200);

    // ── Token shimmer filters ─────────────────────────────────────────────
    const removeFilters = _applyFilters(token, colors);
    setTimeout(removeFilters, timing.total - 500);

    // ── Flash burst — final dissolve pop as the last matter disperses ─────
    // Timed to fire as the beam column is fading out, particles are stopping,
    // and the token mesh is nearly invisible.
    setTimeout(() => {
      _flashBurst(layer, cx, cy, w, colors, baseZ);
    }, timing.total - 750);

    // ── Full PIXI cleanup ─────────────────────────────────────────────────
    setTimeout(() => {
      try { ring.destroy({ children: true }); } catch { /**/ }
      try { beam.destroy({ children: true }); } catch { /**/ }
    }, timing.total + 300);
  }

  /**
   * Beam-in visual effect.  Fire-and-forget.
   *
   * Token is already spawned with alpha=0 by the caller.  This method drives
   * the token mesh alpha from 0 → 1 as the beam dematerialises, then syncs
   * the Foundry document alpha so the data model matches.
   *
   * @param {Token}  token
   * @param {string} transporterType
   */
  static beamIn(token, transporterType = "tngFed") {
    const colors = _vc(transporterType);
    const timing = _vt(transporterType);
    const layer  = _effectLayer();
    const { x: cx, y: cy } = token.center;
    const w = token.w, h = token.h;
    const aj = _anime();

    const tokenZ = typeof token.zIndex === "number" ? token.zIndex : 0;
    const baseZ  = Math.max(VFX_Z_BASE, tokenZ + 10_000);

    // ── Token mesh fades in through the particles ─────────────────────────
    const mesh = token.mesh;
    if (mesh) {
      mesh.alpha = 0;
      _tween(mesh, { alpha: 1, duration: 1800, ease: "outQuad" }, 1100);
    }

    // ── Rainfall particles ────────────────────────────────────────────────
    let stopMotes;
    setTimeout(() => {
      stopMotes = _startMotes(layer, cx, cy, w, h, colors, baseZ);
    }, 100);
    setTimeout(() => { if (stopMotes) stopMotes(); }, 3000);

    // ── Materialization motes — token surface assembling ─────────────────
    // Start immediately (token is invisible, motes represent matter arriving).
    // Stop when the token mesh is fully opaque (~2900 ms).
    const stopMatMotes = _startMaterializeMotes(layer, cx, cy, w, h, colors, baseZ);
    setTimeout(stopMatMotes, 3000);

    // ── Swirling orbit particles — energy vortex from centre ─────────────
    // Starts at the flash burst moment so the orb glows at peak intensity
    // as matter coalesces, then fades as the token solidifies.
    const stopSwirl = _swirlOrbit(layer, cx, cy, w, h, colors, baseZ);
    setTimeout(stopSwirl, 3000);

    // ── Scan line sweep — fires near the end of beam-in ──────────────────
    // Token is nearly solid by 2200 ms; lines sweep outward at the climax
    // of materialisation.  Flash fires 400 ms later as final punctuation.
    setTimeout(() => {
      _scanLineSweep(layer, cx, cy, w, h, colors, baseZ);
    }, 1200);
    setTimeout(() => {
      _flashBurst(layer, cx, cy, w, colors, baseZ);
    }, 2600);

    // ── Token shimmer filters ─────────────────────────────────────────────
    const removeFilters = _applyFilters(token, colors);

    // Sync the Foundry document model after the mesh animation completes,
    // so token.document.alpha matches the visual state.
    setTimeout(async () => {
      try {
        await token.document.update({ alpha: 1 }, { animate: false });
      } catch { /**/ }
      removeFilters();
    }, 3100);

  }

  /**
   * Quick console test — no dialog needed.
   *
   *   game.sta2eToolkit.testVFX("tngFed")         // beam-out on selected tokens
   *   game.sta2eToolkit.testVFX("klingon", "in")  // beam-in on selected tokens
   *
   * @param {string} transporterType  Any key from VFX_COLORS
   * @param {"out"|"in"} phase
   */
  static test(transporterType = "tngFed", phase = "out") {
    const tokens = canvas.tokens?.controlled ?? [];
    if (!tokens.length) {
      ui.notifications.warn("sta2e-toolkit | Select a token before testing TransporterVFX.");
      return;
    }
    for (const t of tokens) {
      if (phase === "in") TransporterVFX.beamIn(t, transporterType);
      else                TransporterVFX.beamOut(t, transporterType);
    }
    ui.notifications.info(
      `sta2e-toolkit | TransporterVFX.${phase === "in" ? "beamIn" : "beamOut"}("${transporterType}") playing on ${tokens.length} token(s).`
    );
  }
}
