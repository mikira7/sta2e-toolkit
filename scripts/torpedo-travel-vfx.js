// Torpedo travel sprite playback.
//
// WHY THIS IS NOT JUST A SEQUENCER BROADCAST
// ------------------------------------------
// The toolkit's bundled torpedo sprites spin in place, so they cannot be
// stretched from launcher to target the way a JB2A strip can. They are flown by
// tweening `spriteContainer.position` along Bezier waypoints with
// `.animateProperty()`.
//
// Sequencer time-compensates custom property animations against wall-clock
// time: the firing client stamps `creationTimestamp: Date.now()` into the
// broadcast effect data, each receiving client stamps its own
// `actualCreationTime`, and `_playCustomAnimations()` seeds every attribute with
// `durationDone = actualCreationTime - creationTimestamp`. That delta is network
// latency PLUS raw clock skew between two machines. Once it reaches the ~1s
// travel time the whole flight path completes on the first ticker frame — the
// torpedo appears parked on the target hull and only the impact reads as
// animated. Locally the sender and viewer are the same machine so the delta is
// ~0, which is why this only ever showed up on hosted games (The Forge).
//
// So the travel is NOT handed to Sequencer's cross-client push. The firing
// client resolves the flight to plain numbers, plays it locally, and broadcasts
// the plan on the toolkit socket; every client then builds and plays its own
// local sequence, stamping and consuming its own timestamp with nothing in
// between. Same pattern as the Point Defense tracers.

// A travel plan is pure JSON — it crosses the socket, so it holds no tokens and
// no documents:
//   { file, px, travelMs, launch: {x, y}, layer,
//     arcX: number[]|null, arcY: number[]|null,   // canvas-space offsets from launch
//     fallbackTarget: {x, y}|null,                // used when arcX/arcY are null
//     missed: boolean,
//     scaleFrom: number|null, scaleTo: number|null }

function applyLayer(effect, layer) {
  if (!effect || !layer) return effect;
  if (layer === "below" && typeof effect.belowTokens === "function") return effect.belowTokens();
  if (layer === "above" && typeof effect.aboveTokens === "function") return effect.aboveTokens();
  return effect;
}

// Builds and plays the travel sprite on THIS client only. Never broadcasts.
export function playTorpedoTravelLocal(plan) {
  if (!plan?.file || !window.Sequence) return;
  const launch = plan.launch;
  if (!Number.isFinite(launch?.x) || !Number.isFinite(launch?.y)) return;

  try {
    const travelMs = Math.max(1, Number(plan.travelMs) || 1000);
    const s = new window.Sequence();
    // .locally() is a section trait, not a Sequence method — it pins the
    // effect's user list to us, which suppresses Sequencer's own
    // executeForOthers push. Without it every client would rebroadcast.
    let effect = s.effect()
      .file(plan.file)
      .locally()
      .atLocation({ x: launch.x, y: launch.y })
      .size(Math.max(8, Number(plan.px) || 66))
      .duration(travelMs);
    effect = applyLayer(effect, plan.layer);

    const arcX = Array.isArray(plan.arcX) ? plan.arcX : null;
    const arcY = Array.isArray(plan.arcY) ? plan.arcY : null;
    if (arcX && arcY && arcX.length > 1 && arcX.length === arcY.length) {
      const segs = arcX.length - 1;
      const segMs = travelMs / segs;
      for (let i = 0; i < segs; i++) {
        effect = effect
          .animateProperty("spriteContainer", "position.x", { from: arcX[i], to: arcX[i + 1], duration: segMs, delay: i * segMs, ease: "linear", absolute: true })
          .animateProperty("spriteContainer", "position.y", { from: arcY[i], to: arcY[i + 1], duration: segMs, delay: i * segMs, ease: "linear", absolute: true });
      }
    } else if (plan.fallbackTarget) {
      // Degenerate case (unresolvable points / zero distance): fall back to a
      // plain straight flight so the torpedo never just sits at the emitter.
      effect = effect.moveTowards(plan.fallbackTarget, { ease: "linear", duration: travelMs });
      if (plan.missed && typeof effect.missed === "function") effect = effect.missed();
    }

    // Plasma torpedoes launch as a large bolt sized by the damage dealt, then
    // shrink as they converge on the target.
    if (Number.isFinite(plan.scaleFrom) && Number.isFinite(plan.scaleTo)) {
      effect = effect
        .scale(plan.scaleFrom)
        .animateProperty("spriteContainer", "scale.x", { from: plan.scaleFrom, to: plan.scaleTo, duration: travelMs, ease: "linear", absolute: true })
        .animateProperty("spriteContainer", "scale.y", { from: plan.scaleFrom, to: plan.scaleTo, duration: travelMs, ease: "linear", absolute: true });
    }

    s.play();
  } catch (err) {
    console.warn("STA2e Toolkit | Torpedo travel VFX failed:", err);
  }
}

// Plays the travel sprite here and asks every other client on this scene to play
// its own copy. Foundry sockets do not loop back, hence the local play first.
export function broadcastTorpedoTravel(plan) {
  playTorpedoTravelLocal(plan);
  try {
    game.socket?.emit?.("module.sta2e-toolkit", {
      action: "torpedoTravelVfx",
      sceneId: canvas?.scene?.id ?? null,
      plan,
    });
  } catch (err) {
    console.warn("STA2e Toolkit | Could not broadcast torpedo travel VFX:", err);
  }
}
