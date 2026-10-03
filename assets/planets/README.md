# Barren-world baked textures

The renderer uses three repeating weathered-rock height tiles and four crater-wall detail stamps. These are original, offline-baked synthetic assets, with no external image service or downloaded texture dependency.

Run `node tools/bake-barren-textures.mjs` from the module root to rebuild `scripts/barren-texture-data.js` and `assets/planets/barren-height-atlas.png`. The PNG shows the exact quantized heights for inspection; the generated JavaScript carries the same data for synchronous rendering without image loading or canvas readback.

Rock maps use periodic noise and thermal weathering. Seeded triplanar mapping combines three variants across the globe. Domain warping and independent geological provinces vary the direction and scale of exposed rock. Smooth regolith plains alternate with locally rugged highlands, discontinuous asymmetric scarps, and degraded ancient impact rims. Fine rubble is limited to exposed highlands; the old global grain and repeated high-frequency rock shading have been removed. Impact stamps contain broken terraces and radial wall detail around a neutral floor and border. Heights affect directional shading; existing procedural crater bowls, peaks, rim shadows, and ejecta remain responsible for the larger structure. Barren impacts now include a denser population of small craters and deeper small bowls.

Colors remain controlled by the selected planet palette. Fine relief fades with pixel footprint to avoid noisy small planets and limbs. Class M, desert, and ice materials do not use these maps.

To see the change in Foundry, reload the module and regenerate a barren world's artwork in the planet generator. Existing exported images retain their previously rendered pixels.

The **Volcanic flats / ancient lava beds** control under **Canyons and landforms** adds optional seeded basalt provinces to barren and desert worlds. Deposits have lobed boundaries, smooth interiors, shallow flow fronts, and winding rilles. They alter elevation and bury much of the older surface detail. Higher strengths preserve placement. Water, snow, and clouds can hide deposits. These features are illustrative planetary-scale geology and emit no lava glow. **Giant impact basin** adds broad, smooth depressed lowlands beside rougher highlands, with a broken boundary scarp and softened older crater detail. Both controls default to 0.
