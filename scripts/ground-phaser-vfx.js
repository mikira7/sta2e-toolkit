/**
 * sta2e-toolkit | ground-phaser-vfx.js
 *
 * Native PIXI effects for hand phasers, in two shapes:
 *
 *   • a single-target BEAM, drawn by the starship bank's own `_beamShot` at
 *     person scale — so the hand weapon genuinely is the ship beam rather than
 *     a lookalike that has to be kept in sync by hand;
 *   • an area CONE, which opens from the shooter across every token the attack
 *     actually caught. This one has no ship equivalent: nothing on a starship
 *     fires a spread over several targets at once.
 *
 * This is an ADDITION, never a replacement. The JB2A/Sequencer ground beam is
 * still the default; nothing here runs unless a world sets the Ground Phasers
 * animation mode to "experimental".
 *
 * Era colour comes from the shared `eraColors` beam settings, so hand phasers
 * and ship phasers of the same era tint identically. Which era applies is
 * decided in weapon-configs.js (`resolveGroundPhaserEra`) at the config layer,
 * not here — the classic renderer needs the same answer.
 *
 * PIXI v8 rules observed throughout (see .claude/skills/foundry-vfx):
 * fill/stroke are applied AFTER the shape method, blend mode is a string, dt is
 * clamped so a tab switch cannot teleport the animation, and filters are
 * destroyed by hand because `container.destroy()` does not take them.
 */

import {
  applyNativeVfxGlow,
  fadeNativeVfxContainer,
  getBeamVfxSettings,
  nativeVfxBlendMode,
  nativeVfxContainer,
  playNativeBeamBetweenPoints,
  playNativeVfxSound,
  shouldUseNativeWeaponVFX,
} from "./native-weapon-vfx.js";

const MODULE = "sta2e-toolkit";
const SOCKET = `module.${MODULE}`;
export const GROUND_PHASER_VFX_KEY = "weapon-ground-phaser";
export const GROUND_PHASER_VFX_ACTION = "groundPhaserVfx";

// Fallbacks for a world whose era colours have been cleared.
const FALLBACK_COLOR = "#ff9a33";
const FALLBACK_CORE = "#fff2c0";

// Gap between successive beams when one shot resolves against several targets.
const MULTI_TARGET_GAP_MS = 120;

/** Is the native ground phaser renderer switched on in this world? */
export function usingNativeGroundPhaser() {
  return shouldUseNativeWeaponVFX(GROUND_PHASER_VFX_KEY);
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Single-target (or per-target) beams. Called by `fireNativeWeaponVFX` once it
 * has claimed the shot, so the mode check has already passed.
 */
export async function fireGroundPhaserVFX(config, isHit, sourceToken, targets, options = {}) {
  const source = _center(sourceToken);
  const targetList = (targets ?? []).filter(Boolean);
  const points = targetList.map(_center).filter(Boolean);
  if (!source || !points.length) return false;

  const style = _resolveStyle(config, options);
  const shape = _beamShape(style, isHit);
  // One sound for the shot, not one per target — a phaser fired once should be
  // heard once however many people it caught.
  playNativeVfxSound(options.soundPath ?? (isHit ? config?.sound : config?.missSound));

  // Broadcast up front rather than after the stagger, so remote clients start
  // their copy at the same moment this one does instead of a volley late.
  _broadcast({
    mode: "beam",
    sourcePoint: source,
    targetPoints: points,
    hit: !!isHit,
    style,
  });

  for (let i = 0; i < points.length; i++) {
    if (i > 0) await _delay(MULTI_TARGET_GAP_MS);
    _beam(source, points[i], isHit, style, {
      impact: { path: config?.impact, token: targetList[i], point: points[i] },
    });
  }

  // Hold until the shot has actually played out. The caller — the ground injury
  // resolution — goes straight on to the outcome dialog and, for a vaporised
  // minor NPC, to deleting the token; returning early let all of that land on
  // top of a beam that had barely appeared.
  await _delay(Math.max(shape.hitDuration, shape.impactDelay + 400));
  return true;
}

/**
 * The area cone. Called from the ground damage card once the GM has ticked the
 * Area targets, which is the only moment the full affected set exists.
 *
 * Returns true when it actually drew, so the caller only suppresses the
 * per-target beams on a shot this really replaced.
 */
export function playGroundPhaserCone(attackerToken, targetTokens, { config = null, hit = true } = {}) {
  if (!usingNativeGroundPhaser()) return false;
  if (!globalThis.PIXI || !canvas?.ready) return false;

  const apex = _center(attackerToken);
  const tokens = (targetTokens ?? []).filter(Boolean);
  const points = tokens.map(_center).filter(Boolean);
  if (!apex || !points.length) return false;

  const style = _resolveStyle(config, {});
  playNativeVfxSound(hit ? config?.sound : config?.missSound);

  _broadcast({
    mode: "cone",
    sourcePoint: apex,
    targetPoints: points,
    hit: !!hit,
    style,
  });

  _cone(apex, points, hit, style, {
    // Origin client only — Sequencer broadcasts its own play.
    impacts: points.map((point, i) => ({ path: config?.impact, token: tokens[i], point })),
  });
  return true;
}

/**
 * Replay a broadcast effect on this client. Visuals only — AudioHelper already
 * broadcast the sound from the originating client, so playing it again here
 * would double it.
 */
export function playGroundPhaserVfxFromSocket(msg = {}) {
  if (!globalThis.PIXI || !canvas?.ready) return;
  if (msg.sceneId && msg.sceneId !== canvas?.scene?.id) return;

  const apex = _point(msg.sourcePoint);
  const points = (msg.targetPoints ?? []).map(_point).filter(Boolean);
  if (!apex || !points.length) return;

  const style = _normalizeStyle(msg.style);
  const hit = msg.hit !== false;

  if (msg.mode === "cone") {
    _cone(apex, points, hit, style);
    return;
  }
  // Beams are staggered on the firing client too, so the replay has to stagger
  // the same way or the two clients disagree about what they saw.
  points.forEach((point, i) => {
    if (i === 0) _beam(apex, point, hit, style);
    else setTimeout(() => _beam(apex, point, hit, style), i * MULTI_TARGET_GAP_MS);
  });
}

// ---------------------------------------------------------------------------
// Style — era colour, type scale, appearance dials
// ---------------------------------------------------------------------------

/**
 * Everything the draw needs, flattened into something small enough to put on a
 * socket. Resolved once per shot so every beam of a volley matches.
 */
function _resolveStyle(config, options = {}) {
  const beam = getBeamVfxSettings();
  const group = beam.groundPhaser ?? {};
  const era = String(options.era ?? config?.phaserEra ?? "").toLowerCase();
  const type = String(options.phaserType ?? config?.groundPhaserType ?? "type2").toLowerCase();

  const eraColors = beam.eraColors ?? {};
  const color = eraColors[`${era}Color`] || FALLBACK_COLOR;
  const core = eraColors[`${era}Core`] || FALLBACK_CORE;
  const scale = Number(group[`${type}Scale`]) || 1;

  return _normalizeStyle({
    color, core, scale,
    blend: beam.shared?.blendMode ?? "add",
    shared: beam.shared,
    group,
  });
}

function _normalizeStyle(style = {}) {
  const group = style.group ?? {};
  const fallback = getBeamVfxSettings();
  return {
    color: _hexText(style.color, FALLBACK_COLOR),
    core: _hexText(style.core, FALLBACK_CORE),
    scale: _num(style.scale, 1, 0.1, 4),
    blend: style.blend === "normal" ? "normal" : "add",
    shared: style.shared ?? fallback.shared,
    group: Object.keys(group).length ? group : (fallback.groundPhaser ?? {}),
  };
}

/**
 * The bank-shaped sizing group `_beamShot` expects, scaled for this phaser
 * type. Widths and radii scale; alphas and stroke weights do not, so a Type-1
 * reads thinner rather than fainter.
 */
function _beamShape(style, isHit) {
  const g = style.group;
  const s = style.scale;
  return {
    glowWidth: _num(g.glowWidth, 4) * s,
    glowAlpha: _num(g.glowAlpha, 0.3),
    coreWidth: _num(g.coreWidth, 1.6) * s,
    coreAlpha: _num(g.coreAlpha, 0.95),
    muzzleFillRadius: _num(g.muzzleFillRadius, 3) * s,
    muzzleFillAlpha: _num(g.muzzleFillAlpha, 0.9),
    muzzleRingRadius: _num(g.muzzleRingRadius, 4) * s,
    muzzleRingWidth: _num(g.muzzleRingWidth, 1),
    muzzleRingAlpha: _num(g.muzzleRingAlpha, 0.5),
    impactFillRadius: _num(g.impactFillRadius, 5) * s,
    impactFillAlpha: _num(g.impactFillAlpha, 0.85),
    impactRingRadius: _num(g.impactRingRadius, 7) * s,
    impactRingWidth: _num(g.impactRingWidth, 1.5),
    impactRingAlpha: _num(g.impactRingAlpha, 0.7),
    hitDuration: _num(isHit ? g.hitDuration : g.missDuration, isHit ? 1100 : 800),
    impactDelay: _num(g.impactDelay, 300, 0, 4000),
  };
}

// ---------------------------------------------------------------------------
// Beam
// ---------------------------------------------------------------------------

/**
 * @param {object} [opts.impact] Origin-client only: `{ path, token }` for the
 *   JB2A impact asset. Sequencer broadcasts its own play, so the socket replay
 *   must leave this off or every client stacks a second copy.
 */
function _beam(source, target, isHit, style, opts = {}) {
  const shape = _beamShape(style, isHit);
  // A miss should visibly go wide rather than land on the target and simply
  // skip its impact flare.
  const endPoint = isHit ? target : _missOvershoot(source, target);
  // hit:false deliberately — _beamShot would otherwise draw its impact on the
  // same frame as the muzzle, which reads as the shot arriving before it was
  // fired. The impact is drawn below instead, once the beam has been up long
  // enough to be seen.
  //
  // The muzzle is zeroed out for the same reason the impact is: both flashes
  // are drawn here instead, each in its own container, so each can carry its
  // own glow pass. Sharing the beam's container would mean sharing the beam's
  // glow, and a halo sized for a long line barely registers on a small disc.
  playNativeBeamBetweenPoints(source, endPoint, {
    hit: false,
    color: style.color,
    coreColor: style.core,
    duration: shape.hitDuration,
    shape: { ...shape, muzzleFillRadius: 0, muzzleRingRadius: 0, muzzleRingWidth: 0 },
  });
  _muzzleFlash(source, style, shape);
  if (!isHit) return;
  setTimeout(() => {
    _impactFlare(target, style, shape);
    _playImpactEffect(opts.impact);
  }, shape.impactDelay);
}

/** The emitter flash, lit from the first frame and gone before the beam is. */
function _muzzleFlash(point, style, shape) {
  if (shape.muzzleFillRadius <= 0 && shape.muzzleRingRadius <= 0) return;
  const container = _flashContainer(point, style);
  if (!container) return;

  const g = new PIXI.Graphics();
  g.blendMode = nativeVfxBlendMode(style.blend);
  _gFillCircle(g, 0, 0, shape.muzzleFillRadius, _hexNumber(style.core), shape.muzzleFillAlpha);
  _gStrokeCircle(g, 0, 0, shape.muzzleRingRadius, shape.muzzleRingWidth,
    _hexNumber(style.color), shape.muzzleRingAlpha);
  container.addChild(g);

  fadeNativeVfxContainer(container, Math.max(180, Math.round(shape.hitDuration * 0.45)),
    style.shared?.cleanupDelay, style.shared);
}

/** The hit flare, drawn on its own so it can land after the beam. */
function _impactFlare(point, style, shape) {
  if (shape.impactFillRadius <= 0 && shape.impactRingRadius <= 0) return;
  const container = _flashContainer(point, style);
  if (!container) return;

  const g = new PIXI.Graphics();
  g.blendMode = nativeVfxBlendMode(style.blend);
  _gFillCircle(g, 0, 0, shape.impactFillRadius, _hexNumber(style.core), shape.impactFillAlpha);
  _gStrokeCircle(g, 0, 0, shape.impactRingRadius, shape.impactRingWidth,
    _hexNumber(style.color), shape.impactRingAlpha);
  container.addChild(g);

  fadeNativeVfxContainer(container, Math.max(240, shape.hitDuration - shape.impactDelay),
    style.shared?.cleanupDelay, style.shared);
}

/** A positioned container carrying the flash glow, ready for its Graphics. */
function _flashContainer(point, style) {
  const container = nativeVfxContainer(point.y, "above");
  if (!container) return null;
  container.x = point.x;
  container.y = point.y;
  _applyFlashGlow(container, _hexNumber(style.color), style);
  return container;
}

/**
 * The muzzle and impact flashes get their own GlowFilter rather than the beam's.
 * Both are small bright discs where the halo is most of the effect, so they want
 * a wider, hotter pass than the line does — the shared beam glow is sized for a
 * long thin stroke and all but disappears on a disc a few pixels across.
 *
 * Falls back to the shared beam glow if the flash glow has been dialled to zero,
 * so turning it down never leaves the flashes completely flat.
 */
function _applyFlashGlow(container, color, style) {
  const size = _num(style.group.flashGlowSize, 14, 0, 60);
  if (size <= 0) {
    applyNativeVfxGlow(container, color, style.shared);
    return;
  }
  try {
    const GlowFilter = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (!GlowFilter) return;
    const filter = new GlowFilter({
      distance:      size,
      outerStrength: _num(style.group.flashGlowStrength, 2.6, 0, 8),
      innerStrength: _num(style.group.flashGlowInnerStrength, 0.6, 0, 4),
      color,
      quality:       _num(style.shared?.glowQuality, 0.25, 0.05, 1),
      knockout:      false,
    });
    // Same trap _applyBeamGlow documents: a filtered container renders to an
    // offscreen target first, which drops the child's additive blend unless the
    // filter composites on that blend mode too.
    try { filter.blendMode = nativeVfxBlendMode(style.blend); } catch { /* older pixi-filters */ }
    container.filters = [filter];
  } catch { /* glow is a bonus, never a requirement */ }
}

/**
 * The weapon's configured JB2A impact asset.
 *
 * Native mode claims the shot inside fireWeapon and returns before the
 * "ground-beam" branch, so this asset — the only target-side visual a Stun ever
 * had, since stun raises no splash FX of its own — was being skipped entirely.
 * Optional: without Sequencer the PIXI flare stands alone.
 */
function _playImpactEffect(impact) {
  const path = impact?.path;
  if (!path || !globalThis.Sequence) return;
  try {
    const sequence = new Sequence().effect().file(path);
    const anchor = impact.token ?? impact.point;
    sequence.atLocation(anchor);
    if (impact.token && typeof sequence.scaleToObject === "function") sequence.scaleToObject(1.5);
    sequence.play();
  } catch (err) {
    console.warn("STA2e Toolkit | Ground phaser impact effect failed:", err);
  }
}

/** Push a missed shot past and to one side of the target. */
function _missOvershoot(source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const dist = Math.hypot(dx, dy) || 1;
  const grid = canvas?.grid?.size ?? 100;
  const ux = dx / dist;
  const uy = dy / dist;
  // Sideways by ~half a square, and a little long, so the beam reads as a near
  // miss rather than as a shot at nobody.
  const side = (Math.random() < 0.5 ? -1 : 1) * grid * 0.45;
  return {
    x: source.x + ux * (dist + grid * 0.3) - uy * side,
    y: source.y + uy * (dist + grid * 0.3) + ux * side,
  };
}

// ---------------------------------------------------------------------------
// Cone
// ---------------------------------------------------------------------------

function _cone(apex, points, isHit, style, opts = {}) {
  const container = nativeVfxContainer(apex.y, "above");
  if (!container) return;

  container.x = apex.x;
  container.y = apex.y;
  applyNativeVfxGlow(container, _hexNumber(style.color), style.shared);

  const g = style.group;
  const geom = _coneGeometry(apex, points, g, style.scale);
  const blend = nativeVfxBlendMode(style.blend);

  // One wedge and one ray fan, in separate Graphics: the wedge only changes
  // while it is opening, the rays are repainted every frame for the whole
  // lifetime. A second wedge stacked on this one — however hot or narrow —
  // reads as two cones rather than as one cone with a bright centre.
  const wedge = new PIXI.Graphics();
  const rays = new PIXI.Graphics();
  for (const child of [wedge, rays]) child.blendMode = blend;
  container.addChild(wedge, rays);

  const wedgeColor = _hexNumber(style.color);
  const coneAlpha = _num(g.coneAlpha, 0.34);
  const rayCfg = _coneRayConfig(style);
  // Per-ray length factors, seeded once: varied depths so the tips do not all
  // land on the same arc, but fixed for the effect's lifetime so they do not
  // twitch from frame to frame.
  const reaches = Array.from({ length: rayCfg.count }, () => 0.78 + (Math.random() * 0.22));

  // Muzzle flare sits at the apex and does not animate — the emitter is lit
  // from the first frame, it is the beam that takes time to open. Drawn through
  // the shared helper so it carries the flash glow, not the wedge's.
  const flashShape = _beamShape(style, isHit);
  _muzzleFlash(apex, style, { ...flashShape, hitDuration: _num(g.coneHitDuration, 1100) });

  const openMs = _num(g.coneOpenDuration, 280, 40, 2000);
  const holdMs = _num(isHit ? g.coneHitDuration : g.missDuration, isHit ? 1100 : 800);

  let elapsed = 0;
  let prevNow = performance.now();
  let faded = false;
  let stopped = false;

  const paintWedge = progress => {
    wedge.clear();
    _gWedge(wedge, _coneRadius(geom, progress),
      geom.center - (geom.halfAngle * progress), geom.center + (geom.halfAngle * progress),
      wedgeColor, coneAlpha);
  };

  const paintRays = (progress, elapsedSec) => {
    rays.clear();
    _coneRays(rays, geom, progress, elapsedSec, style, rayCfg, reaches);
  };

  // The wedge is done animating and the impacts land; the rays keep flickering
  // over the fade, so this deliberately does NOT stop the ticker.
  const startFade = () => {
    if (faded) return;
    faded = true;
    paintWedge(1);
    if (isHit) {
      // Each caught target gets the same glowed flare and the same JB2A impact
      // asset a single-target shot lands — otherwise an Area stun has no
      // target-side visual at all. Own containers, so they sit above the wedge
      // and carry the flash glow rather than the wedge's.
      for (const point of points) {
        _impactFlare(point, style, { ...flashShape, impactDelay: 0 });
      }
      for (const impact of opts.impacts ?? []) _playImpactEffect(impact);
    }
    fadeNativeVfxContainer(container, holdMs, style.shared?.cleanupDelay, style.shared);
  };

  const stopTicker = () => {
    if (stopped) return;
    stopped = true;
    try { canvas.app?.ticker?.remove(tick); } catch { /* already gone */ }
  };

  const tick = () => {
    // The container is destroyed at the end of the fade; drawing into a dead
    // Graphics after that throws every frame.
    if (wedge.destroyed || rays.destroyed) { stopTicker(); return; }

    const now = performance.now();
    // Clamped: a backgrounded tab pauses rAF, and an unclamped catch-up frame
    // would snap the wedge open in one step.
    elapsed += Math.min(now - prevNow, 50);
    prevNow = now;

    if (elapsed < openMs) {
      const progress = _easeOutQuad(elapsed / openMs);
      paintWedge(progress);
      paintRays(progress, elapsed / 1000);
      return;
    }
    // Open: the wedge holds its shape, the rays go on shimmering until the
    // container has faded out from under them.
    startFade();
    paintRays(1, elapsed / 1000);
    if (elapsed >= openMs + holdMs) stopTicker();
  };

  paintWedge(0.001);
  paintRays(0.001, 0);
  try {
    canvas.app.ticker.add(tick);
    // Backstops: if the ticker is torn down mid-effect (scene change), the
    // container still fades and cleans itself up.
    setTimeout(startFade, openMs + 200);
    setTimeout(stopTicker, openMs + holdMs + 200);
  } catch {
    startFade();
  }
}

/** Ray dials, resolved once per shot. Widths scale with the phaser type; alphas do not. */
function _coneRayConfig(style) {
  const g = style.group;
  return {
    count: Math.round(_num(g.coneRayCount, 6, 0, 24)),
    width: _num(g.coneRayWidth, 2.4, 0, 20) * style.scale,
    alpha: _num(g.coneRayAlpha, 0.85, 0, 1),
    speed: _num(g.coneRaySpeed, 2.2, 0, 12),
    feather: _num(g.coneRayFeather, 0.7, 0, 2),
  };
}

/**
 * Straight rays fanning out from the emitter to the wedge's arc, the way the
 * tractor beam's emitter fan reads (`_drawEmitterRays` in tractor-beam-vfx.js).
 * Each ray breathes on its own phase offset, so the fan shimmers instead of
 * blinking in unison — that flicker is the whole point of the cone now that it
 * is a single flat wedge.
 *
 * Drawn in the container's own space, whose origin is already the apex.
 */
function _coneRays(g, geom, progress, elapsedSec, style, cfg, reaches) {
  if (cfg.count < 1 || cfg.width <= 0 || cfg.alpha <= 0) return;

  const color = _hexNumber(style.core);
  const passes = _featherPasses(cfg.feather);
  const half = geom.halfAngle * progress;
  const radius = _coneRadius(geom, progress);

  for (let i = 0; i < cfg.count; i++) {
    // Interior positions only — a ray on the wedge edge would just thicken the
    // outline instead of reading as its own beam.
    const u = (i + 1) / (cfg.count + 1);
    const angle = geom.center - half + (2 * half * u);
    const phase = (elapsedSec * cfg.speed) - (i / cfg.count);
    const breath = 0.30 + (0.70 * (0.5 + (0.5 * Math.sin(phase * Math.PI * 2))));
    const alpha = cfg.alpha * breath;
    if (alpha <= 0.002) continue;

    const reach = radius * (reaches[i] ?? 1);
    const x = Math.cos(angle) * reach;
    const y = Math.sin(angle) * reach;
    for (const pass of passes) {
      _gLine(g, 0, 0, x, y, cfg.width * pass.widthMul, color, alpha * pass.alphaMul);
    }
  }
}

/**
 * Soft edges come from stacking strokes rather than from a filter: a wide dim
 * halo, a mid pass, then the bright core. Under ADD those sum into a falloff
 * across the ray's width, which is what sells it as light rather than as a
 * drawn line. Widest first, so the core lands on top.
 */
function _featherPasses(feather) {
  if (feather <= 0.01) return [{ widthMul: 1, alphaMul: 1 }];
  return [
    { widthMul: 1 + (3.4 * feather), alphaMul: 0.14 * feather },
    { widthMul: 1 + (1.5 * feather), alphaMul: 0.30 * feather },
    { widthMul: 1, alphaMul: 1 },
  ];
}

/** The wedge's reach at a given open progress — it grows as it sweeps. */
function _coneRadius(geom, progress) {
  return geom.radius * (0.2 + (0.8 * progress));
}

/**
 * Where the wedge points, how wide it opens and how far it reaches.
 *
 * The centre bearing is a vector mean rather than an average of angles, so a
 * spread that straddles the ±π seam does not fold inside out. The half-angle is
 * whatever the targets actually subtend, clamped into the configured band —
 * a single target still reads as a spread, and a wide spill cannot wrap round
 * into a disc.
 */
function _coneGeometry(apex, points, group, scale = 1) {
  let sumX = 0;
  let sumY = 0;
  let maxDist = 0;
  const bearings = [];

  for (const point of points) {
    const dx = point.x - apex.x;
    const dy = point.y - apex.y;
    const dist = Math.hypot(dx, dy);
    maxDist = Math.max(maxDist, dist);
    if (dist < 1) continue;               // standing on the shooter: no bearing
    const angle = Math.atan2(dy, dx);
    bearings.push(angle);
    sumX += Math.cos(angle);
    sumY += Math.sin(angle);
  }

  const center = bearings.length ? Math.atan2(sumY, sumX) : 0;
  let spread = 0;
  for (const angle of bearings) spread = Math.max(spread, Math.abs(_wrapAngle(angle - center)));

  const grid = canvas?.grid?.size ?? 100;
  // Widen enough to clear the tokens themselves, not just their centres.
  const pad = maxDist > 1 ? Math.atan2(grid * 0.5, maxDist) : 0;
  const min = _toRadians(_num(group.coneMinAngle, 14, 2, 80));
  const max = _toRadians(_num(group.coneMaxAngle, 52, 2, 80));
  // Clamp the natural spread into the band FIRST, then scale — scaling the band
  // instead would leave the type scale doing nothing whenever the targets
  // already subtend something mid-band, which is the common case. A Type-3 has
  // to read wider than a Type-2 at every spread, not just at the extremes.
  const natural = Math.min(Math.max(spread + pad, min), Math.max(min, max));
  // Hard cap: past a 80° half-angle a "cone" is a half-disc.
  //
  // A narrow type, or a spread past the max clamp, can leave an outlying target
  // outside the wedge. That is deliberate — STA's ground Area is zone
  // membership, not a geometric template, so the cone is a depiction of the
  // shot rather than its hit area, and a Type-1 should not spray a wide fan.
  // Every target still gets its own impact flare, so the connection reads.
  const halfAngle = Math.min(natural * scale, _toRadians(80));

  return {
    center,
    halfAngle,
    radius: Math.max(grid * 0.75, maxDist * _num(group.coneRadiusPad, 1.08, 1, 2)),
  };
}

// ---------------------------------------------------------------------------
// PIXI v7 / v8 drawing shims
// ---------------------------------------------------------------------------
// v7 wants beginFill() BEFORE the shape and endFill() after; v8 wants fill()
// AFTER it. Getting this backwards draws nothing at all, silently.

function _gWedge(g, radius, startAngle, endAngle, color, alpha) {
  if (radius <= 0 || alpha <= 0) return;
  const v7 = typeof g.beginFill === "function";
  if (v7) g.beginFill(color, alpha);
  g.moveTo(0, 0);
  g.arc(0, 0, radius, startAngle, endAngle);
  g.lineTo(0, 0);
  if (v7) g.endFill();
  else g.fill({ color, alpha });
}

function _gLine(g, x1, y1, x2, y2, width, color, alpha) {
  if (width <= 0 || alpha <= 0) return;
  if (typeof g.lineStyle === "function") {
    g.lineStyle({ width, color, alpha, cap: "round" });
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.lineStyle(0);
    return;
  }
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke({ width, color, alpha, cap: "round" });
}

function _gFillCircle(g, cx, cy, radius, color, alpha) {
  if (radius <= 0 || alpha <= 0) return;
  if (typeof g.drawCircle === "function") {
    g.beginFill(color, alpha);
    g.drawCircle(cx, cy, radius);
    g.endFill();
    return;
  }
  g.circle(cx, cy, radius);
  g.fill({ color, alpha });
}

function _gStrokeCircle(g, cx, cy, radius, width, color, alpha) {
  if (radius <= 0 || width <= 0 || alpha <= 0) return;
  if (typeof g.drawCircle === "function") {
    g.lineStyle(width, color, alpha);
    g.drawCircle(cx, cy, radius);
    g.lineStyle(0);
    return;
  }
  g.circle(cx, cy, radius);
  g.stroke({ width, color, alpha });
}

// ---------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------

/**
 * Foundry sockets do not loop back, so every caller here plays locally first
 * and then emits. The payload carries no sound path: AudioHelper already
 * broadcast the audio itself.
 */
function _broadcast({ mode, sourcePoint, targetPoints, hit, style }) {
  try {
    game.socket?.emit?.(SOCKET, {
      action: GROUND_PHASER_VFX_ACTION,
      sceneId: canvas?.scene?.id ?? null,
      mode,
      sourcePoint: { x: sourcePoint.x, y: sourcePoint.y },
      targetPoints: targetPoints.map(p => ({ x: p.x, y: p.y })),
      hit: !!hit,
      style: {
        color: style.color,
        core: style.core,
        scale: style.scale,
        blend: style.blend,
      },
    });
  } catch (err) {
    console.warn("STA2e Toolkit | Could not broadcast ground phaser VFX:", err);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function _center(token) {
  if (!token) return null;
  if (token.center && Number.isFinite(token.center.x)) {
    return { x: token.center.x, y: token.center.y };
  }
  const doc = token.document ?? token;
  const grid = canvas?.grid?.size ?? 100;
  const w = token.w ?? ((doc?.width ?? 1) * grid);
  const h = token.h ?? ((doc?.height ?? 1) * grid);
  const x = doc?.x ?? token.x;
  const y = doc?.y ?? token.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: x + (w / 2), y: y + (h / 2) };
}

function _point(raw) {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function _num(value, fallback, min = null, max = null) {
  let numeric = Number(value);
  if (!Number.isFinite(numeric)) numeric = fallback;
  if (min !== null) numeric = Math.max(min, numeric);
  if (max !== null) numeric = Math.min(max, numeric);
  return numeric;
}

function _hexText(value, fallback) {
  const text = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function _hexNumber(value) {
  return Number.parseInt(_hexText(value, FALLBACK_COLOR).slice(1), 16);
}

function _toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Fold an angle difference into [-π, π] so seam-straddling spreads behave. */
function _wrapAngle(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function _easeOutQuad(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - ((1 - clamped) * (1 - clamped));
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
