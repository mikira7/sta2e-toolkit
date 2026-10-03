/**
 * sta2e-toolkit | cloak-hit-vfx.js
 *
 * A cloaked ship struck by weapons fire shimmers: for a second or so the hull
 * ripples into view as a pale, heat-haze distortion of its own silhouette and
 * fades back out — the Bird-of-Prey-taking-a-hit look.
 *
 * The token itself is `hidden` and stays that way; nothing here touches the
 * document. The shimmer is a **separate sprite** built from the token's own
 * texture and drawn on `canvas.tokens`, so it shows on every client, including
 * players who cannot see the hidden token. It is purely cosmetic and never
 * reveals the ship's identity beyond its outline for a moment, which is the
 * point of the effect.
 *
 * Broadcast pattern matches the deflector: play locally, then raw-emit
 * `cloakHitShimmerVfx` with the SOURCE token's scene id; receivers scene-guard.
 * PIXI 7 is what runs (see the foundry-vfx skill); every v7 call has a v8
 * fallback and every failure degrades to "no shimmer", never to an error.
 */

const MODULE = "sta2e-toolkit";
export const CLOAK_HIT_SHIMMER_ACTION = "cloakHitShimmerVfx";

const DURATION_MS = 1500;
const TINT        = 0xbfe4ff;   // pale blue-white — reads as disturbed space, not a faction colour
const PEAK_ALPHA  = 0.55;

// ── Shared noise map ─────────────────────────────────────────────────────────

let _noiseTex = null;

/** Smooth tiling noise for the displacement map; built once, never destroyed. */
function _noiseTexture() {
  if (_noiseTex && !_noiseTex.destroyed) return _noiseTex;
  const N = 128;
  const oc = document.createElement("canvas");
  oc.width = oc.height = N;
  const ctx = oc.getContext("2d");
  const img = ctx.createImageData(N, N);
  // Sum of a few tiling sine waves — seamless by construction, so the map can
  // scroll forever on REPEAT without a visible seam.
  const waves = Array.from({ length: 5 }, () => ({
    fx: 1 + Math.floor(Math.random() * 4), fy: 1 + Math.floor(Math.random() * 4),
    p: Math.random() * Math.PI * 2,
  }));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0, g = 0;
      waves.forEach((w, i) => {
        const v = Math.sin((x * w.fx + y * w.fy) / N * Math.PI * 2 + w.p);
        if (i % 2) r += v; else g += v;
      });
      const o = (y * N + x) * 4;
      img.data[o]     = Math.round(128 + 50 * r);
      img.data[o + 1] = Math.round(128 + 50 * g);
      img.data[o + 2] = 128;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _noiseTex = PIXI.Texture.from(oc);
  try {
    const base = _noiseTex.baseTexture ?? _noiseTex.source;
    if (base && PIXI.WRAP_MODES) base.wrapMode = PIXI.WRAP_MODES.REPEAT;
    else if (base?.style) base.style.addressMode = "repeat";
  } catch { /* clamped wrap only costs a slightly visible edge */ }
  return _noiseTex;
}

function _displacementFilter(mapSprite, scale) {
  const DF = PIXI.DisplacementFilter ?? PIXI.filters?.DisplacementFilter;
  if (!DF) return null;
  try { return new DF(mapSprite, scale); }
  catch {
    try { return new DF({ sprite: mapSprite, scale }); } catch { return null; }
  }
}

function _addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

// ── Local playback ───────────────────────────────────────────────────────────

/**
 * Play the shimmer on this client only.
 * @param {Token|TokenDocument|string} tokenOrId
 */
export function playCloakHitShimmer(tokenOrId) {
  try {
    if (!canvas?.ready || !globalThis.PIXI) return;
    const token = typeof tokenOrId === "string"
      ? canvas.tokens?.get(tokenOrId)
      : (tokenOrId?.object ?? tokenOrId);
    if (!token || token.destroyed) return;

    const mesh = token.mesh;
    const texture = mesh?.texture ?? token.texture;
    if (!texture || texture === PIXI.Texture.EMPTY) return;

    const layer = canvas.tokens;
    if (!layer.sortableChildren) layer.sortableChildren = true;
    const tokenZ = typeof token.zIndex === "number" ? token.zIndex : 0;

    const container = new PIXI.Container();
    container.zIndex = Math.max(900_000, tokenZ + 10_000);
    container.eventMode = "none";
    const c = token.center;
    container.position.set(c.x, c.y);
    layer.addChild(container);

    // The silhouette: the token's own art, sized and turned like its mesh.
    const w = mesh?.width  || token.w;
    const h = mesh?.height || token.h;
    const angle = mesh?.angle ?? token.document?.rotation ?? 0;
    const hull = new PIXI.Sprite(texture);
    hull.anchor.set(0.5);
    hull.width = w;
    hull.height = h;
    hull.angle = angle;
    hull.tint = TINT;
    container.addChild(hull);

    // A slightly larger additive ghost — the "edge" of the cloak field.
    const halo = new PIXI.Sprite(texture);
    halo.anchor.set(0.5);
    halo.width = w * 1.08;
    halo.height = h * 1.08;
    halo.angle = angle;
    halo.tint = TINT;
    halo.blendMode = _addBlend();
    container.addChild(halo);

    // Heat-haze distortion: a scrolling noise map driving a DisplacementFilter.
    // renderable=false keeps the map's transform updating without drawing it.
    const map = new PIXI.Sprite(_noiseTexture());
    map.renderable = false;
    map.anchor.set(0.5);
    map.scale.set(Math.max(w, h) / 128 * 0.6);
    container.addChild(map);
    const disp = _displacementFilter(map, Math.max(8, Math.min(w, h) * 0.12));
    if (disp) container.filters = [disp];

    container.alpha = 0;
    const start = performance.now();
    let prev = start;
    const seed = Math.random() * 10;

    const tick = () => {
      try {
        const now = performance.now();
        const dt  = Math.min(now - prev, 50);
        prev = now;
        const t = (now - start) / DURATION_MS;
        if (t >= 1 || container.destroyed) { cleanup(); return; }

        // Envelope: fast bloom in, slow fade out, with an irregular flicker so
        // it reads as the field failing rather than a clean fade.
        const env = t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.6);
        const flicker = 0.7 + 0.3 * Math.sin(now / 38 + seed) * Math.sin(now / 91 + seed * 2);
        container.alpha = PEAK_ALPHA * env * flicker;
        halo.alpha = 0.35 + 0.25 * Math.sin(now / 55 + seed);

        map.x += dt * 0.06;
        map.y += dt * 0.045;
        if (disp?.scale) {
          const s = Math.max(8, Math.min(w, h) * 0.12) * (0.6 + env * 0.8);
          disp.scale.x = s;
          disp.scale.y = s;
        }
      } catch { cleanup(); }
    };

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      canvas.app?.ticker?.remove(tick);
      try { container.parent?.removeChild(container); } catch { /* torn down */ }
      // The noise texture is shared and the hull texture is the token's own —
      // destroy the sprites, never their textures.
      try { container.destroy({ children: true, texture: false }); } catch { /* torn down */ }
    };
    canvas.app?.ticker?.add(tick);
    Hooks.once("canvasTearDown", cleanup);
  } catch (err) {
    console.warn("STA2e Toolkit | cloak hit shimmer failed:", err);
  }
}

// ── Broadcast ────────────────────────────────────────────────────────────────

/** Play here, then tell every other client viewing that scene. */
export function broadcastCloakHitShimmer(tokenOrDoc) {
  const token = tokenOrDoc?.object ?? tokenOrDoc;
  const doc = token?.document ?? tokenOrDoc;
  const tokenId = doc?.id ?? null;
  if (!tokenId) return;
  playCloakHitShimmer(token?.document ? token : tokenId);
  try {
    game.socket.emit(`module.${MODULE}`, {
      action: CLOAK_HIT_SHIMMER_ACTION,
      tokenId,
      // The source token's scene, not the sender's viewed one (see CLAUDE.md).
      sceneId: doc?.parent?.id ?? canvas?.scene?.id ?? null,
    });
  } catch { /* cosmetic — never block on the socket */ }
}
