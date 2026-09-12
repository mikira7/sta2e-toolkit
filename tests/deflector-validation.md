# Deflector VFX validation

Verified using the locally installed Foundry shader classes and PIXI 7.4.3.

- `node --experimental-vm-modules tests/deflector-vfx.mjs`: **81/81 passed**.
- Browser gallery: **96 rendering checks passed**. Covers actual GLSL linking,
  visible output, changing texture over time, additive and normal blending,
  ancestor alpha, rotation/scaling, small/large volumes, full-circle pulses,
  narrow arcs, zero-length wakes, Graphics fallback, and resource cleanup.
- JavaScript syntax checks passed for the renderer, both shader modules, and
  the browser harness. `git diff --check` passed.
- Visually inspected all four effects in the isolated gallery. No live world
  data was changed. In-world placement and appearance with individual ship art
  still depend on the saved emitter anchors, colours, and effect settings.

To reproduce the browser checks, run `node tests/serve-transporter-tests.cjs`
(the existing server also serves this gallery), then open
`http://127.0.0.1:3188/tests/deflector-browser.html` and click **Run rendering checks**.
The optional server argument points to a different Foundry `resources/app`
directory. **Play all**, **Hold midpoint**, **Hold late pulse**, and **Graphics
fallback** provide visual inspection controls.

The renderer uses one shaded volume per charge emitter, pulse wave, or stream.
Lances retain the shared beam shader. Shader volumes share the existing runner's
clock and teardown, and do not add full-screen filters or their own tickers.
Charge motes share a 400-particle budget across the ship's dishes.

The shared beam shader also fixes PIXI's context-loss capability check and
smooths the repeating surge seam. These two fixes apply to its other beam/bolt
callers as well; their configurations are unchanged.
