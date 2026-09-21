# Engine glow validation

Run `node tests/serve-transporter-tests.cjs`, then open
`http://127.0.0.1:3188/tests/engine-glow-browser.html`.
The fixture uses the locally installed Foundry PIXI library and isolated token
stubs. It does not connect to a world or modify actor data.

Verified on PIXI 7.4.3: **58 rendering and lifecycle checks passed**.

- Both engine colors, additive and normal blending, soft halo falloff,
  sweep reveal, alpha, ancestor opacity, and degenerate curves.
- Tight curves do not accumulate brightness at segment joins, produce rays
  beyond the halo, or show gaps and beads along the core.
- Warp and impulse runners use shaders, expire naturally, and release their
  graphics, tickers, and backstop timers on stop or scene changes.
- Graphics fallback remains available when the shader cannot be used.

Visually inspected the powered-engine preview and the tight loop, S bend,
and sharp-return fixtures. These checks cover the installed PIXI 7 WebGL
renderer; other renderer generations use the Graphics fallback.

The anchor editor template compiles for both engine tabs. Existing anchor and
deflector regression suite: `node --experimental-vm-modules tests/deflector-vfx.mjs`
— 88/88 passed.

After refreshing Foundry, use Ship VFX Anchors → Warp / Impulse → Preview.
Existing colors, points, curves, layering, and charge-style choices are retained.
Glow Size is available on both tabs; zero removes the outer halo.
