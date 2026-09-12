# Ground energy VFX

Ground Energy Weapons and Pulse Grenades default to Shader Energy in Configure
Effects → Ground Weapons. Existing ground phaser renderer choices are preserved.
Disruptor pistols and rifles offer Beam/Bolt on their item sheets (default Bolt).
Andorian plasma rifles use blue plasma bolts; other plasma weapons use violet
bolts; particle rifles use violet beams; phase pistols use red-orange beams.
Rifles are 1.35 times pistol scale, using the Ground Phasers width settings.

Pulse grenade Area resolution draws one shockwave at the primary target and
expands its radius to cover the selected secondary targets. Injury resolution
waits for playback, and the existing Area playback flag suppresses duplicate
blasts on secondary injury cards. Miss positions are resolved on the sender;
socket playback uses those positions and does not replay audio.

## Automated verification

Run `node --experimental-vm-modules tests/ground-energy-config.mjs` for 35
assertions covering real weapon resolution, dispatch, rifle scaling, legacy
phaser modes, conventional weapon exclusions and Current-mode disruptor assets.

Run `node tests/serve-transporter-tests.cjs` and open
`http://127.0.0.1:3188/tests/ground-energy-browser.html`. Run checks exercises
62 assertions using the installed Foundry QuadMesh, AbstractBaseShader and PIXI:
shader/fallback visibility, animation, GL errors, fading, Area geometry,
miss endpoints, scene guards, teardown and Current-mode opt-out.

Play, Hold shots, Hold impacts and Graphics fallback support visual inspection.
These are isolated fixtures; live multi-client combat still requires a world
reload on each client and a smoke test of primary/secondary injury cards.
