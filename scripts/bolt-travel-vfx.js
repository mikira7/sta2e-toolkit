// Energy bolt travel sprite playback.
//
// The sibling of torpedo-travel-vfx.js, and it exists for the same reason —
// read that file's header for the full story. In short: Sequencer
// time-compensates custom property animations against the wall-clock delta
// between the firing client and each receiver, which is network latency PLUS
// clock skew. Once that delta reaches the travel time, the whole flight
// completes on the first ticker frame and the projectile appears parked on the
// target. Locally the sender and viewer are the same machine so the delta is
// ~0, which is why it only ever shows on hosted games (The Forge).
//
// So travel is never handed to Sequencer's cross-client push. The firing client
// resolves the flight to plain numbers, plays it locally, and broadcasts the
// plan on the toolkit socket; every client builds and plays its own sequence.
//
// WHERE THIS DIFFERS FROM THE TORPEDO
// -----------------------------------
// Bolts fly straight — no drive, no Bezier arc — so the plan carries a target
// point rather than waypoints and the flight is a single `moveTowards`.
//
// And the bolt sprite is DIRECTIONAL, unlike the torpedo sprites which are
// square and spin in their own clip. `.moveTowards()` handles that for us: its
// `rotate` option defaults to TRUE, so the effect is already turned onto the
// travel vector.
//
// Do NOT also rotate by the shot bearing. `.rotate()` adds an OFFSET to the
// effect's rotation rather than setting it, so doing both leaves the sprite at
// twice the bearing — pointing somewhere between the target and its mirror
// image. `rotationOffsetDeg` below is only for a sprite whose art is not drawn
// pointing right; it is a constant correction, not the shot angle.

// A travel plan is pure JSON — it crosses the socket, so it holds no tokens and
// no documents:
//   { file, px, travelMs, rotationOffsetDeg,
//     launch: {x, y}, target: {x, y}, layer }

export const BOLT_TRAVEL_VFX_ACTION = "boltTravelVfx";

function applyLayer(effect, layer) {
  if (!effect || !layer) return effect;
  if (layer === "below" && typeof effect.belowTokens === "function") return effect.belowTokens();
  if (layer === "above" && typeof effect.aboveTokens === "function") return effect.aboveTokens();
  return effect;
}

/** Builds and plays the bolt on THIS client only. Never broadcasts. */
export function playBoltTravelLocal(plan) {
  if (!plan?.file || !window.Sequence) return;
  const launch = plan.launch;
  const target = plan.target;
  if (!Number.isFinite(launch?.x) || !Number.isFinite(launch?.y)) return;
  if (!Number.isFinite(target?.x) || !Number.isFinite(target?.y)) return;

  try {
    const travelMs = Math.max(1, Number(plan.travelMs) || 400);
    const s = new window.Sequence();
    // .locally() is a section trait, not a Sequence method — it pins the
    // effect's user list to us, which suppresses Sequencer's own
    // executeForOthers push. Without it every client would rebroadcast.
    let effect = s.effect()
      .file(plan.file)
      .locally()
      .atLocation({ x: launch.x, y: launch.y })
      .size(Math.max(8, Number(plan.px) || 50))
      .duration(travelMs)
      // rotate defaults to true, which is what turns the bolt onto its heading.
      .moveTowards({ x: target.x, y: target.y }, { ease: "linear", duration: travelMs });

    // Never `.missed()`: with no stretchTo or rotateTowards to anchor it, it
    // randomises the LAUNCH point rather than the impact — the shot would leave
    // from somewhere the shooter isn't. Misses are baked into the target point
    // when the plan is built instead.

    // A constant correction for art that isn't drawn pointing right. Added on
    // top of the heading moveTowards already applied, so 0 means "the sprite
    // points along +X" and needs nothing.
    const offset = Number(plan.rotationOffsetDeg);
    if (Number.isFinite(offset) && offset !== 0 && typeof effect.rotate === "function") {
      effect = effect.rotate(offset);
    }
    effect = applyLayer(effect, plan.layer);

    s.play();
  } catch (err) {
    console.warn("STA2e Toolkit | Bolt travel VFX failed:", err);
  }
}

/**
 * Plays the bolt here and asks every other client on this scene to play its own
 * copy. Foundry sockets do not loop back, hence the local play first.
 *
 * Emits with the raw socket rather than the module's emitToolkitSocket helper:
 * that helper also re-runs the handler locally on the responsible GM, which
 * would draw the bolt twice for them.
 */
export function broadcastBoltTravel(plan) {
  playBoltTravelLocal(plan);
  try {
    game.socket?.emit?.("module.sta2e-toolkit", {
      action: BOLT_TRAVEL_VFX_ACTION,
      sceneId: canvas?.scene?.id ?? null,
      plan,
    });
  } catch (err) {
    console.warn("STA2e Toolkit | Could not broadcast bolt travel VFX:", err);
  }
}
