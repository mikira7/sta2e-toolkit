/**
 * sta2e-toolkit | starfleet-ring.js
 *
 * Registers the toolkit's dynamic token ring configurations — the Starfleet
 * Metal Ring and the Starfield Ring — so they appear in Settings → Core →
 * Dynamic Token Ring. The Starfield Ring tints through mask frames, so its two
 * rings take the token colour and the starfield between them does not.
 *
 * Neither ring carries a badge: a world has ONE ring design, so commbadges and
 * faction insignia are stamped per token by the Token Maker
 * (scripts/token-emblems.js), like the rank pips.
 *
 * The art is pre-generated spritesheets in assets/rings/, drawn by
 * tools/starfleet-ring-atlas.js (see that file for how core tints a ring and
 * why the band is greyscale). Core picks ONE ring configuration for the whole
 * world, so choosing one restyles every token with a dynamic ring.
 *
 * Registration must happen on `initializeDynamicTokenRingConfig`, which core
 * fires once, after `setup` (game.mjs: TokenRingConfig.initialize()) — the
 * window is closed afterwards and `addConfig` throws.
 */

import { isActiveGM } from "./gm-authority.js";

const MODULE = "sta2e-toolkit";

export const TOOLKIT_RINGS = {
  // The id keeps its original name so worlds that chose it carry on working.
  sta2eStarfleetDelta: { label: "STA Toolkit — Starfleet Metal Ring", spritesheet: `modules/${MODULE}/assets/rings/starfleet-delta.json` },
  sta2eStarfieldRing:  { label: "STA Toolkit — Starfield Ring", spritesheet: `modules/${MODULE}/assets/rings/starfield-ring.json` },
};

/**
 * Ring ids that have been retired, and what replaced them. Core silently falls
 * back to its steel ring for an unknown id, so the active GM moves the world's
 * setting across once and asks everyone to reload.
 */
const RETIRED_RINGS = {
  sta2eCommbadgeTng: "sta2eStarfieldRing",
  sta2eCommbadgeDs9: "sta2eStarfieldRing",
};

export function registerStarfleetRings() {
  Hooks.once("initializeDynamicTokenRingConfig", (ringConfig) => {
    const DynamicRingData = foundry.canvas?.placeables?.tokens?.DynamicRingData;
    if (!DynamicRingData) return;
    for (const [id, cfg] of Object.entries(TOOLKIT_RINGS)) {
      try {
        ringConfig.addConfig(id, new DynamicRingData({ id, label: cfg.label, spritesheet: cfg.spritesheet }));
      } catch (err) {
        console.warn(`STA2e Toolkit | Could not register dynamic ring "${id}"`, err);
      }
    }
  });

  Hooks.once("ready", async () => {
    let current = "";
    try { current = game.settings.get("core", "dynamicTokenRing"); } catch { return; }
    const next = RETIRED_RINGS[current];
    if (!next) return;
    // Only the active GM writes it (gm-authority.js — a leaf, so safe to import).
    if (!isActiveGM()) return;
    await game.settings.set("core", "dynamicTokenRing", next);
    ui.notifications.info("STA Toolkit: the commbadge rings became the Starfield Ring — badges are now Token Maker emblems. Reload to see it.", { permanent: true });
  });
}

/** The world's active ring configuration id, and whether it is one of ours. */
export function activeRingConfig() {
  let id = "";
  try { id = game.settings.get("core", "dynamicTokenRing") ?? ""; } catch { /* not registered yet */ }
  return { id, label: CONFIG.Token?.ring?.configLabels?.[id] ?? id, toolkit: id in TOOLKIT_RINGS };
}
