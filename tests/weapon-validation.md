# Weapon shader polish validation

Validated with the installed Foundry shader classes and PIXI 7.4.3 in an isolated
browser gallery. The weapon runners and shaders are real; world/anchor lookup,
the animation clock, and Sequencer effect lookup use controlled fixtures.
Photon, quantum, and plasma fixtures display the module's bundled WebM artwork.

- **73 browser checks passed:** beam and bolt pixel output, animation, additive
  and normal blending, parent opacity, zero opacity, zero-length segments,
  disabled turbulence/flicker, one-shot surges, curved trails, rotation/scaling,
  ground phaser beam rendering, array convergence, torpedo loading/fallback,
  zero-duration fades, cleanup, and Graphics fallback.
- **96 deflector browser checks passed** after the shared beam shader changes.
- **81/81 deflector behavior checks passed.**
- JavaScript syntax checks passed for all changed production scripts and the
  weapon gallery. Whitespace validation passed for the tracked renderer changes.

To reproduce: run `node tests/serve-transporter-tests.cjs`, then open
`http://127.0.0.1:3188/tests/weapon-browser.html`. Use **Run checks**, **Play**,
**Hold midpoint**, **Inspect charge convergence**, or **Graphics fallback**.
The optional server argument selects another Foundry `resources/app` directory.

The gallery uses a longer three-round cannon volley and a slower array charge
for inspection. Live weapon timing and salvo settings are unchanged. The new
charge shader follows the existing curve samples and settings; it uses two
fixed-budget trail meshes and two orb meshes, with no extra ticker or filter.
Torpedo glow meshes follow the existing escort ticker and sprite tracking.

Ground phaser beams inherit the shared shader changes. Ground muzzle flashes
and impact flares did not receive a separate art pass. The subsequent ground
cone and tractor pass is documented in [fan-validation.md](fan-validation.md).
No live world data was changed; multiplayer latency and individual ship/token
artwork should still be assessed in their normal Foundry world context.
