/**
 * sta2e-toolkit | torpedo-glow-vfx.js
 *
 * The native PIXI glow that flies with a toolkit torpedo sprite: a pulsing core,
 * a corona, a tapering ion trail, and a flash at the launcher.
 *
 * NOT A LIGHT SOURCE, DELIBERATELY
 * --------------------------------
 * This is additive decoration in the token layer. It creates no
 * `PointLightSource`, never touches `canvas.perception`, does not illuminate the
 * map, and takes no part in vision or lighting. A real moving light would force
 * a lighting refresh on every waypoint, and on a twelve-torpedo salvo that is
 * twelve of them a frame. It also would not show at all on the bright starfield
 * maps most of these shots are fired across, since a light only reads where
 * there is darkness to cut.
 *
 * IT NEEDS NO SOCKET ACTION, AND THAT IS WHY IT IS CHEAP
 * -----------------------------------------------------
 * `playTorpedoTravelLocal` is the single funnel every toolkit torpedo sprite
 * goes through on every client — the firing client via `broadcastTorpedoTravel`,
 * everyone else via the `torpedoTravelVfx` handler in main.js, and the weapon
 * preview via `applyTorpedoTravel(..., {broadcast: false})`. Starting the escort
 * there means cross-client playback with no new action, no new handler and no
 * change to the broadcast — and the preview correctly stays local.
 *
 * IT FOLLOWS THE SPRITE; IT DOES NOT RUN ITS OWN CLOCK
 * ----------------------------------------------------
 * The first version recomputed the flight from the plan on its own timer and
 * ran visibly AHEAD of the torpedo. The plan's numbers were right — the start
 * time was not. Sequencer takes a variable moment to load the file and build the
 * effect (longest on the first shot of a session, when the .webm is not yet
 * decoded), and any clock started when `playTorpedoTravelLocal` is called leads
 * the sprite by exactly that much.
 *
 * So the escort binds to the effect by name and reads `spriteContainer`'s real
 * position every frame. No clock to synchronise, nothing to drift, and it stays
 * correct if Sequencer's easing or waypoint handling ever changes.
 *
 * Position is taken through `getGlobalPosition()` and mapped back into the VFX
 * layer's space rather than added to `plan.launch`. The tweens do write
 * `spriteContainer.position` as an offset from launch, but the effect container
 * also carries `.size()` and (for plasma) `.scale()`, so reading the raw
 * property would be wrong the moment a parent transform is non-identity.
 *
 * `_at()` survives as the FALLBACK only — used before the sprite exists, and
 * permanently if it never appears (a bad file, or a future Sequencer that no
 * longer exposes `spriteContainer`). It reproduces Sequencer's piecewise-linear
 * walk across the waypoints, NOT the original Bezier: `buildTorpedoArcOffsets`
 * samples the cubic at four points and `.animateProperty` then flies straight
 * lines between them at one third of `travelMs` each.
 *
 * A LEAF
 * ------
 * Imports only `starfield-common.js`, which imports nothing — so
 * `torpedo-travel-vfx.js` (import-free until now) does not inherit
 * `native-weapon-vfx.js`'s dependency chain. That is also why the settings are
 * read straight out of the world flag here and normalized locally rather than
 * through `getBeamVfxSettings()`; `scene-warp.js` duplicates a memo for the same
 * reason.
 */

import { addBlend, buildRadialTexture, effectLayer } from "./starfield-common.js";
import { createWeaponEnergyOrb } from "./weapon-energy-shader.js";

const MODULE = "sta2e-toolkit";

// The weapon path's z convention, spelled locally rather than imported: the one
// exported from starfield-common is 900_000, which is the STARFIELD base and
// would put the glow under every beam.
const VFX_Z_BASE = 920_000;

/** Side of the texture `buildRadialTexture` produces, for scale maths. */
const RADIAL_TEX = 128;

// ── Dials ───────────────────────────────────────────────────────────────────
// Canonical here and imported by `native-weapon-vfx.js` into
// DEFAULT_BEAM_VFX_SETTINGS / BEAM_VFX_RANGES, so there is one table rather than
// a copy that can drift. All numeric on purpose: `normalizeBeamVfxSettings`
// understands numbers, colour strings and three named enums, so a boolean
// "enabled" would need the normalizer changed — `intensity: 0` switches the
// escort off instead, the precedent `shared.glowSize` already sets.

// SIZES ARE MULTIPLES OF THE TORPEDO SPRITE'S OWN WIDTH, and the escort has to
// stay SUBORDINATE to it. The first tuning did not: at core 0.55/0.85 and corona
// 1.35/0.30 the glow was wider than the sprite and bright enough to saturate the
// area under it, so the .webm's animation was completely masked — compositing
// the glow over the real Photon sprite and compositing it over nothing produced
// the same picture, which is the measurement that settled it.
//
// The rule these values follow: the CORE sits well inside the sprite (0.28, so
// it adds heat to the torpedo's own bright centre rather than covering it), and
// the CORONA stays at or under the sprite's width with a low alpha, so it reads
// as a halo around the art instead of replacing it. Raise them only if the
// torpedo art itself is faint.
export const TORPEDO_GLOW_DEFAULTS = Object.freeze({
  intensity: 1.1,
  coreRadius: 0.28,
  coreAlpha: 0.42,
  pulseRate: 3.2,
  pulseDepth: 0.15,
  coronaRadius: 0.65,
  coronaAlpha: 0.10,
  // How far the core colour is lifted toward white. A torpedo's centre reads as
  // hotter than its halo for the same reason a beam's does.
  coreWhiten: 0.05,
  trailCount: 16,
  trailSpanMs: 220,
  trailRadius: 0.10,
  trailAlpha: 0.12,
  // The flash is at the launcher and momentary, so it can be wider than the
  // sprite without ever competing with it.
  launchFlashRadius: 0.15,
  launchFlashMs: 220,
  fadeMs: 140,
});

export const TORPEDO_GLOW_RANGES = Object.freeze({
  "torpedoGlow.intensity": [0, 2],
  "torpedoGlow.coreRadius": [0, 3],
  "torpedoGlow.coreAlpha": [0, 1],
  "torpedoGlow.pulseRate": [0, 20],
  "torpedoGlow.pulseDepth": [0, 1],
  "torpedoGlow.coronaRadius": [0, 5],
  "torpedoGlow.coronaAlpha": [0, 1],
  "torpedoGlow.coreWhiten": [0, 1],
  "torpedoGlow.trailCount": [0, 40],
  "torpedoGlow.trailSpanMs": [20, 1200],
  "torpedoGlow.trailRadius": [0, 3],
  "torpedoGlow.trailAlpha": [0, 1],
  "torpedoGlow.launchFlashRadius": [0, 6],
  "torpedoGlow.launchFlashMs": [0, 1200],
  "torpedoGlow.fadeMs": [0, 1000],
});

/**
 * The torpedo glow dials, clamped.
 *
 * Read from the raw world flag rather than through `getBeamVfxSettings()`, which
 * lives in `native-weapon-vfx.js` — importing that would drag its whole
 * dependency chain into the torpedo travel path. See the file docblock.
 */
function _cfg() {
  const out = { ...TORPEDO_GLOW_DEFAULTS };
  let raw = null;
  try { raw = game.settings.get(MODULE, "beamVfxAppearance")?.torpedoGlow ?? null; } catch { /* unregistered */ }
  if (!raw) return out;
  for (const key of Object.keys(out)) {
    const range = TORPEDO_GLOW_RANGES[`torpedoGlow.${key}`];
    const n = Number(raw[key]);
    if (!range || !Number.isFinite(n)) continue;
    out[key] = Math.max(range[0], Math.min(range[1], n));
  }
  return out;
}

// ── Shared texture ──────────────────────────────────────────────────────────
// One soft radial for every sprite in every escort. Built on first use — it
// touches `document` and `PIXI` — and NEVER destroyed, the same rule the beam
// shader's noise texture follows.

let _radial = null;

function _radialTexture() {
  if (!_radial) _radial = buildRadialTexture();
  return _radial;
}

// ── Path ────────────────────────────────────────────────────────────────────

/**
 * The world point at normalised time `t`, identical to what Sequencer is
 * flying: piecewise-linear across the waypoints, NOT the original Bezier.
 *
 * `arcX`/`arcY` are OFFSETS FROM LAUNCH — `buildTorpedoArcOffsets` starts at
 * (0, 0) and `.atLocation(launch)` plus `absolute: true` makes them local — so
 * the world point is launch + offset. Reading them as absolute puts the glow at
 * the canvas origin.
 */
function _at(path, t) {
  const clamped = Math.min(1, Math.max(0, t));
  if (path.straight) {
    return {
      x: path.launch.x + (path.endX * clamped),
      y: path.launch.y + (path.endY * clamped),
    };
  }
  const n = path.xs.length - 1;
  const f = Math.min(n - 1e-6, clamped * n);
  const i = Math.floor(f);
  const k = f - i;
  return {
    x: path.launch.x + path.xs[i] + ((path.xs[i + 1] - path.xs[i]) * k),
    y: path.launch.y + path.ys[i] + ((path.ys[i + 1] - path.ys[i]) * k),
  };
}

/**
 * Resolve a travel plan into the path the escort flies, or null when it must
 * not fly at all.
 *
 * The one refusal worth spelling out: a plan with no arc, `missed: true` and a
 * `fallbackTarget` takes Sequencer's `.missed()`, which randomises the endpoint
 * INDEPENDENTLY ON EVERY CLIENT and puts nothing about it in the plan. The glow
 * cannot match that, and a glow visibly detached from its torpedo is worse than
 * no glow — so this one branch draws nothing.
 */
function _resolvePath(plan) {
  const launch = plan?.launch;
  if (!Number.isFinite(launch?.x) || !Number.isFinite(launch?.y)) return null;

  const xs = Array.isArray(plan.arcX) ? plan.arcX : null;
  const ys = Array.isArray(plan.arcY) ? plan.arcY : null;
  if (xs && ys && xs.length > 1 && xs.length === ys.length) {
    return { launch, xs, ys, straight: false };
  }

  if (plan.missed === true) return null;
  const t = plan.fallbackTarget;
  if (!Number.isFinite(t?.x) || !Number.isFinite(t?.y)) return null;
  return { launch, straight: true, endX: t.x - launch.x, endY: t.y - launch.y };
}

// ── Colour ──────────────────────────────────────────────────────────────────

function _parseColor(value, fallback) {
  if (Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  return fallback;
}

/** Lift a colour toward white, so the core reads hotter than the corona. */
function _whiten(color, amount) {
  const lift = ch => Math.round(ch + ((255 - ch) * amount));
  return (lift((color >> 16) & 0xff) << 16)
    | (lift((color >> 8) & 0xff) << 8)
    | lift(color & 0xff);
}

// ── The escort ──────────────────────────────────────────────────────────────

const _live = new Set();

/**
 * The running Sequencer effect with this name, or null.
 *
 * `Sequencer.EffectManager.getEffectPositionByName` is NOT the tool here — it
 * returns the effect's source/target anchors, which for a flown torpedo are
 * just the launch and impact points. The live position is on the effect object.
 */
function _findEffect(name) {
  if (!name) return null;
  try {
    const effects = globalThis.Sequencer?.EffectManager?.getEffects?.({ name });
    return effects?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Where the torpedo sprite actually is, in `layer`'s coordinate space, or null
 * if it cannot be read this frame.
 *
 * Goes through the global transform rather than `launch + spriteContainer.position`
 * so a parent's `.size()` or `.scale()` cannot skew it.
 */
function _spritePoint(effect, layer) {
  try {
    const container = effect?.spriteContainer;
    if (!container || container.destroyed || !container.parent) return null;
    const p = layer.toLocal(container.getGlobalPosition());
    return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null;
  } catch {
    return null;
  }
}

function _sprite(parent, texture, tint, blend) {
  const s = new PIXI.Sprite(texture);
  s.anchor.set(0.5);
  s.tint = tint;
  s.blendMode = blend;
  parent.addChild(s);
  return s;
}

/**
 * Fly a glow alongside one torpedo sprite.
 *
 * Fire and forget: it owns its own ticker, cleans itself up, and never throws
 * into the caller — `playTorpedoTravelLocal` must not be able to fail because
 * decoration did.
 */
export function startTorpedoGlow(plan, trackName = null) {
  try {
    const cfg = _cfg();
    if (!(cfg.intensity > 0)) return;
    if (!globalThis.PIXI || !canvas?.ready) return;

    const path = _resolvePath(plan);
    if (!path) return;

    const layer = effectLayer();
    if (!layer) return;

    const travelMs = Math.max(1, Number(plan.travelMs) || 1000);
    // The escort's own basis, NOT the sprite's `px` — the two are separate so
    // resizing the torpedo art does not rescale the glow that was tuned against
    // it. Falls back to `px` for a plan built before the split.
    const px = Math.max(8, Number(plan.glowPx) || Number(plan.px) || 66);
    const blend = addBlend();
    const halo = _parseColor(plan.glowColor, 0xff3333);
    const core = _parseColor(plan.glowCore, _whiten(halo, cfg.coreWhiten));

    // Plasma launches large and shrinks as it converges, matching the sprite's
    // own scale tween over the full travel.
    const hasScale = Number.isFinite(plan.scaleFrom) && Number.isFinite(plan.scaleTo);
    const scaleAt = hasScale
      ? t => plan.scaleFrom + ((plan.scaleTo - plan.scaleFrom) * Math.min(1, Math.max(0, t)))
      : () => 1;

    const container = new PIXI.Container();
    // Set once from the far end of the flight rather than per frame: writing
    // zIndex marks the whole token layer's child list dirty, and a re-sort every
    // frame per torpedo is not worth an ordering nobody can see on an additive
    // glow. The far end keeps it above the target it is flying at.
    const endY = _at(path, 1).y;
    container.zIndex = plan.layer === "below"
      ? -VFX_Z_BASE + Math.round(Math.max(path.launch.y, endY))
      : VFX_Z_BASE + Math.round(Math.max(path.launch.y, endY));
    // No filter, ever. A twelve-torpedo salvo would be twelve offscreen render
    // passes a frame; these sprites are already additive and already soft.
    layer.addChild(container);

    const texture = _radialTexture();

    // Trail first so it draws under the head. A FIXED POOL, created once and
    // recycled — the module's create-once/toggle-visible invariant.
    const trailCount = Math.max(0, Math.round(cfg.trailCount));
    const trail = [];
    for (let i = 0; i < trailCount; i++) {
      const s = _sprite(container, texture, halo, blend);
      s.visible = false;
      trail.push(s);
    }

    const corona = _sprite(container, texture, halo, blend);
    const head = _sprite(container, texture, core, blend);
    const field = createWeaponEnergyOrb(container,{color:halo,coreColor:core,blend,
      radius:Math.max(cfg.coreRadius,cfg.coronaRadius)*px,
      coreRadius:cfg.coreRadius*px*.5,haloRadius:cfg.coronaRadius*px*.5,
      ringRadius:cfg.coronaRadius*px*.23,ringWidth:px*.012,
      coreAlpha:cfg.coreAlpha,haloAlpha:cfg.coronaAlpha,ringAlpha:cfg.coronaAlpha*.3,
      flareAlpha:cfg.coronaAlpha*.35});

    const flash = cfg.launchFlashRadius > 0 && cfg.launchFlashMs > 0
      ? _sprite(container, texture, core, blend)
      : null;
    const flashStreak = flash ? _sprite(container, texture, halo, blend) : null;
    if (flash) flash.position.set(path.launch.x, path.launch.y);
    if (flashStreak) {
      flashStreak.position.set(path.launch.x,path.launch.y);
      const lead=_at(path,.01);
      flashStreak.rotation=Math.atan2(lead.y-path.launch.y,lead.x-path.launch.x)+Math.PI/2;
    }

    const ticker = canvas.app?.ticker;
    const start = performance.now();
    let finished = false;
    let timer = null;

    const fadeMs = Math.max(0, cfg.fadeMs);

    const cleanup = () => {
      if (finished) return;
      finished = true;
      _live.delete(cleanup);
      try { ticker?.remove?.(tick); } catch { /* no-op */ }
      if (timer) { clearTimeout(timer); timer = null; }
      try { container.destroy({ children: true }); } catch { /* no-op */ }
    };

    // Sprite tracking state. `bound` is the effect once found; `boundAt` is when
    // it appeared, which becomes the glow's real time origin — everything after
    // that is measured from the sprite, not from this function being called.
    let bound = null;
    let boundAt = 0;
    let sawSprite = false;
    let ended = 0;
    let lastPoint = _at(path,0);
    let lastT = 0;
    // If the sprite never shows up in this long, give up on it and fly the
    // computed path on our own clock (the pre-tracking behaviour). Generous,
    // because the first shot of a session pays for decoding the .webm.
    const BIND_TIMEOUT_MS = Math.min(1200, Math.max(400, travelMs * 0.5));

    const tick = () => {
      try {
        if (container.destroyed) { cleanup(); return; }
        const elapsed = performance.now() - start;

        if (!bound && !sawSprite && elapsed < BIND_TIMEOUT_MS) {
          const candidate = _findEffect(trackName);
          // Sequencer can register the effect before decoding its artwork.
          // Binding before the drawable exists mistakes loading for removal.
          if (_spritePoint(candidate, layer)) {
            bound = candidate; boundAt = performance.now(); sawSprite = true;
          }
        }

        // Where the torpedo is, and how far through its flight.
        let p = null;
        let t;
        if (bound) {
          p = _spritePoint(bound, layer);
          if (p) {
            t = Math.min(1, (performance.now() - boundAt) / travelMs);
          } else {
            // The effect ended (Sequencer removed it) or its container went
            // away. Hold the last point and let the fade below finish.
            bound = null;
            ended = ended || performance.now();
          }
        }
        if (!p) {
          if (sawSprite) {
            // We were tracking and the sprite is gone: freeze where it left off
            // and fade. Nothing to chase any more.
            t = lastT;
            p = lastPoint;
          } else if (elapsed < BIND_TIMEOUT_MS) {
            // Still waiting for the sprite. Sit in the tube, exactly as the
            // torpedo does — do NOT start flying, which is the bug this whole
            // tracking path exists to fix.
            t = 0;
            p = _at(path, 0);
          } else {
            // Sprite never appeared. Fall back to the computed flight.
            t = (elapsed-BIND_TIMEOUT_MS) / travelMs;
            p = _at(path, t);
          }
        }

        // Fade out at the end of the flight so the glow hands off into the
        // impact the sequence already schedules, rather than popping out. Timed
        // from whichever clock is actually driving this escort.
        const over = ended
          ? performance.now() - ended
          : (t >= 1 ? (bound ? performance.now() - boundAt : elapsed-BIND_TIMEOUT_MS) - travelMs : 0);
        if ((ended || t>=1) && over >= fadeMs) { cleanup(); return; }
        container.alpha = over <= 0 ? 1 : Math.max(0, 1 - (over / Math.max(1, fadeMs)));

        const scale = scaleAt(t);
        const flightSeconds = Math.max(0, (sawSprite ? performance.now()-boundAt : elapsed-BIND_TIMEOUT_MS)/1000);
        const pulse = cfg.pulseRate > 0
          ? 1 - (cfg.pulseDepth * 0.5 * (1 + Math.sin(2 * Math.PI * cfg.pulseRate * flightSeconds)))
          : 1;

        // While still waiting for the sprite, show only the launch flash. A core
        // and corona hanging at the tube with no torpedo under them reads as a
        // misfire; this way the tube flashes and the torpedo emerges glowing.
        const waiting = !bound && !sawSprite && elapsed < BIND_TIMEOUT_MS;
        lastPoint = {x:p.x,y:p.y};
        lastT = t;
        head.visible = corona.visible = !waiting && !field;
        const prev = _at(path,Math.max(0,t-.01)),next = _at(path,Math.min(1,t+.01));
        const heading = Math.atan2(next.y-prev.y,next.x-prev.x);
        if(field){
          field.mesh.visible=!waiting;field.mesh.position.set(p.x,p.y);field.mesh.rotation=heading;
          const radius=Math.max(cfg.coreRadius,cfg.coronaRadius)*px;
          field.mesh.scale.set(Math.max(1,radius*2*scale));
          field.update(flightSeconds,cfg.intensity*pulse);
        }

        head.position.set(p.x, p.y);
        head.scale.set((cfg.coreRadius * px * scale * pulse) / RADIAL_TEX);
        head.alpha = cfg.coreAlpha * cfg.intensity;

        corona.position.set(p.x, p.y);
        // Counter-pulses against the core, so the two do not breathe as one blob.
        corona.scale.set((cfg.coronaRadius * px * scale * (2 - pulse)) / RADIAL_TEX);
        corona.alpha = cfg.coronaAlpha * cfg.intensity;

        // The tail is sampled BACKWARDS ALONG THE PATH rather than kept as a
        // history buffer: that makes its shape frame-rate independent (a 20fps
        // client gets the same tail as a 120fps one) and correct on the very
        // first frame instead of collapsing to a point.
        //
        // The samples are shifted by however far the measured sprite sits from
        // the computed path at this instant, so the tail stays welded to the
        // head even if our reproduction of Sequencer's interpolation is a pixel
        // out. Without it the first trail sprite can float off the torpedo.
        if (trailCount > 0 && !waiting) {
          const ref = _at(path, t);
          const offX = p.x - ref.x;
          const offY = p.y - ref.y;
          const stepT = (cfg.trailSpanMs / travelMs) / trailCount;
          for (let i = 0; i < trailCount; i++) {
            const s = trail[i];
            const tk = t - ((i + 1) * stepT);
            if (tk <= 0) { s.visible = false; continue; }
            const f = 1 - (i / trailCount);
            const q = _at(path, tk);
            const next = _at(path,Math.min(t,tk+stepT));
            s.visible = true;
            s.position.set(q.x + offX, q.y + offY);
            const width=cfg.trailRadius*px*(.4+.6*f)*scaleAt(tk);
            s.rotation=Math.atan2(next.y-q.y,next.x-q.x);
            s.scale.set(Math.max(width*2,Math.hypot(next.x-q.x,next.y-q.y)*2.4)/RADIAL_TEX,width/RADIAL_TEX);
            s.alpha = cfg.trailAlpha * f * f * cfg.intensity * .7;
          }
        }

        if (flash) {
          const f = 1 - (elapsed / cfg.launchFlashMs);
          if (f <= 0) flash.visible = flashStreak.visible = false;
          else {
            flash.visible = flashStreak.visible = true;
            flash.scale.set((cfg.launchFlashRadius * px * (1.2 - (f * 0.2))) / RADIAL_TEX);
            flash.alpha = f * f * cfg.intensity;
            flashStreak.scale.set(cfg.launchFlashRadius*px*(3.5-1.2*f)/RADIAL_TEX,cfg.launchFlashRadius*px*.18/RADIAL_TEX);
            flashStreak.alpha=f*f*f*cfg.intensity*.45;
          }
        }
      } catch (err) {
        console.warn("STA2e Toolkit | Torpedo glow VFX failed:", err);
        cleanup();
      }
    };

    tick();
    if (finished) return;
    if (ticker?.add) ticker.add(tick);
    // Backstop in case the ticker is unavailable. `cleanup` is idempotent.
    // It has to allow for the bind wait as well as the flight: the escort's
    // clock now starts when the SPRITE appears, which may be most of a second
    // after this call on the first shot of a session.
    timer = setTimeout(cleanup, BIND_TIMEOUT_MS + travelMs + fadeMs + 500);
    _live.add(cleanup);
  } catch (err) {
    console.warn("STA2e Toolkit | Torpedo glow VFX failed to start:", err);
  }
}

// A scene change destroys the token layer out from under every escort in
// flight, leaving a ticker callback per torpedo behind. The radial texture
// deliberately survives — see `_radialTexture`.
Hooks.on("canvasTearDown", () => {
  for (const cleanup of [..._live]) {
    try { cleanup(); } catch { /* no-op */ }
  }
  _live.clear();
});
