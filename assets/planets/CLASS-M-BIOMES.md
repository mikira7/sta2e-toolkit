# Class M biome textures

Run `node tools/bake-biome-textures.mjs` to rebuild the original synthetic color-variation and height maps in `scripts/biome-texture-data.js`, and their grayscale proof in `assets/planets/class-m-biome-atlas.png`. The atlas columns are forest, grassland, desert, tundra, and alpine; rows show variant 1 albedo/height followed by variant 2 albedo/height. The runtime uses the same data synchronously, without downloading images or loading a canvas.

Forests have irregular cover and clearings, grasslands have drainage patterns, deserts have winding dune fields, tundra has broken thaw patches, and alpine areas have nested ridges and valley channels. These are illustrative orbital-scale patterns, not individual trees or a climate simulation.

Deserts also blend independent regional deposits of pale sand, warmer ochre sediment, and darker exposed bedrock. These vary hue as well as reflectance and remain derived from the selected palette. Mountain ranges have broad shoulders and foothills surrounding the original seeded ridge cores; snow is restricted to the summit field rather than spread across the wider massifs.

Latitude, moisture fields, altitude, and existing mountain placement determine smoothly normalized biome weights. Seeded variant choices and warped triplanar mapping avoid longitude seams, polar stretching, and uniform texture direction. Color is derived from the planet palette; the maps store no baked sunlight. Fine contrast and relief fade as their features become subpixel.

The **Biome detail** control applies to terrestrial/Class M and ocean worlds. Its default is 65; 0 restores the simpler surface material. It changes appearance without moving coasts, rivers, clouds, cities, or geological landforms. Mountain snow respects **Ice coverage**, including 0. Oceans retain their existing rendering, and clouds/ice are applied over the biomes.

Reload Foundry and regenerate a world's artwork to see the change. Existing saved exports retain their original pixels.

## Ocean depths and crust plates

**Ocean depth shading** under **Surface, water, and civilization** defaults to 80. It uses the generated seafloor's depth below a calibrated waterline to blend light shoals and shelves through mid-depth water to darker basins and abyssal regions. The colors follow the selected ocean palette. Setting this control to 0 restores the earlier narrow shelf blend. Fully flooded worlds retain depth variation. Lighting, water reflections, sea ice, and cloud shadows still apply over the water material.

**Crust plates** under **Canyons and landforms** offers Seeded choice, Active crust plates, Ancient / inactive plates, and No crust plates. Terrestrial and ocean worlds default to Seeded choice, deterministically selecting active plates or no plates; the UI shows the resolved state. Other solid worlds default to no plates. Stars, asteroids, and worlds with no visible solid surface disable the control.

Plate provinces use smoothly blended spherical Voronoi regions, continental/oceanic crust types, and seeded tangent drift directions. Convergent boundaries contribute mountain belts and trenches; divergent boundaries contribute seafloor ridges and rifts. Ancient plate mode weakens those boundary remnants while retaining provinces. Choosing another crust mode changes continents, mountain placement, basin depth, and river drainage. The sea level is recalibrated to preserve the water percentage. No crust plates restores the earlier noise-based terrain.

The model is illustrative rather than a tectonic or physical ocean-optics simulation. Both features are local, seeded, and view-independent.

## Mountain shadows

**Mountain shadows** under **Sunlight and shadow** defaults to 70 for terrestrial/Class M and ocean worlds. Sun-facing slopes receive restrained highlights, opposite slopes darken, and nearby higher ridges cast soft shadows under low sunlight. The effect follows the sun and filters slope detail to the pixel footprint. It adjusts direct illumination while preserving night-side ambient brightness, ocean colors, and terrain placement. Setting it to 0 disables the added mountain lighting. Preview and exported artwork use the same calculation.

## Rivers and river basins

**River density** controls visible downhill channels: tributaries merge and larger accumulated flows produce wider rivers. Channel shading follows the ocean palette, with filtering for smaller previews. **River basins**, under **Surface, water, and civilization**, defaults to 55 on terrestrial/Class M and ocean worlds. It adds muted alluvial floodplains beside channels and small inland lakes in closed drainage sinks. Catchment IDs follow each river to its terminal outlet; lake levels stay below the sampled depression rim. These are illustrative orbital-scale drainage features rather than a hydrology simulation.

Rivers and basins require surface water, exposed land, and nonzero river density. Basin strength changes appearance without moving continents, mountains, or river routes; 0 removes the added floodplains and closed-basin lakes. Existing ocean coverage remains calibrated independently of these small inland lakes. Reload Foundry and regenerate artwork to apply the update.

## Cloud relief and shadows

**Cloud relief and shadows** in the weather controls defaults to 70. It adds sun-facing highlights, darker lee slopes, and self-shadowing to the cloud density field. Ground shadows sample that same field at a sunward offset for a raised deck, preserving clear gaps and hurricane eyes; lower sunlight increases their displacement. Wispy clouds cast weaker shadows than dense decks and storm towers. Slope sampling follows the output pixel footprint. This is a lightweight volume approximation, not atmospheric ray marching.

The relief slider preserves cloud coverage and pattern placement. Thickness still controls opacity, and relief 0 restores the earlier cloud shading. Cover or thickness 0 clears the clouds and their shadows. Shadows attenuate direct surface light while retaining ambient brightness. Both cameras and exported artwork share the weather calculation.

## Close-orbit scene quality

Procedural viewscreen compositions render the visible rectangular viewport directly, preserving terrain and weather sampling when a close or horizon view would otherwise enlarge a capped whole-globe texture. Star and asteroid compositions retain their specialized renderer, and supplied artwork keeps its existing image placement.

Low-orbit encounter scenes render their visible band at 4096 pixels wide for 2K/4K recipes, and 3000 for 1K recipes. The map layout, atmosphere height, and terrain walls keep their positions. A finer nested biome layer supplies surface color and relief at close range and fades before becoming subpixel at distant scales. Coastlines, rivers, and mountain placement remain seeded. Recreate low-orbit scenes and re-export viewscreen images after reloading Foundry to update their saved pixels.

## Image generation progress

Saving procedural artwork, orbital crops, and viewscreen images displays a progress bar in the lower-right corner. Render progress advances with completed image rows, followed by encoding and uploading stages. Paired information/scene images and front ring layers share an overall percentage and show the current view number. Completion reaches 100% only after the artwork upload succeeds; failures display a failure state and clear the panel. Preview renders do not open a progress panel. Multiple generation jobs can display separate bars without blocking the interface.

## Gas giant cloud relief

**Gas cloud relief and shadows** in **Colors and texture** defaults to 70 for gas giants. Raised cloud decks and advected convective billows receive sun-facing highlights and darker lee slopes, with short soft shadows from taller clouds under low sunlight. The height field follows seeded belts and storms, while finer filaments remain color markings. Smooth atmospheres and hazy ice giants use subdued height variations; stormy ice giants include raised companion clouds and recessed dark vortices. Lighting is filtered to the pixel footprint and follows the same sun in portraits, scene views, and orbital crops.

The slider changes reflected sunlight without altering palette colors, band/storm placement, night-side ambient brightness, or Hot Jupiter emission. Setting it to 0 restores the earlier smooth-sphere lighting. This is a local cloud-height lighting approximation, not full atmospheric volume ray marching. Reload Foundry and regenerate saved artwork to apply it.

## Desert world surfaces

**Desert surface detail** in **Colors and texture** defaults to 70. Independent sediment and exposure fields blend pale sand sheets, warmer deposits, darker bedrock, and localized mesas. Sand dunes use seeded, warped triplanar sampling of the baked desert maps; exposed regions use the baked barren rock maps. Badlands favor exposed rock and mesas; dune worlds favor sand seas; salt worlds add pale, smoother evaporite plains in lowlands. Fine texture fades with the output footprint to avoid distant grain and polar stretching. Colors continue to follow the planet palette and the existing mineral controls.

Desert mountain ranges now include broad shoulders and foothills, and **Mountain shadows** is enabled for desert worlds with a default of 70. Salt flats suppress local relief and mountain shading. Surface detail 0 restores the simpler material; mountain shadows remain a separate control. These appearance features preserve elevations, water coverage, and river routing. Canyons, impact basins, shield volcanoes, craters, fractures, water, ice, and weather continue to layer over the desert surface. Reload Foundry and regenerate artwork to update saved pixels.

## Desert and barren geology

**Volcanic flats / ancient lava beds** under **Canyons and landforms** is available for desert and barren worlds. Seeded basalt provinces lower and smooth terrain, with lobed margins, shallow flow fronts, and winding rilles. The deposits are cooled and emit no glow.

**Giant impact basin** adds an asymmetric, planet-scale depression with smooth lowlands, a broken boundary scarp, and rougher terrain beyond its margins. Resurfacing softens older craters and mountain relief within the basin. This is illustrative geology inspired by the proposed giant-impact origin of Mars's hemispheric dichotomy. Basin strength preserves seeded placement; both new geology controls default to 0. Their elevation changes also affect water placement and river routing.

The crust menu includes **Single / stagnant crust**, which has one plate and no moving plate boundaries. **Active plates** and **Ancient / inactive plates** retain boundary-driven terrain. For a Mars-inspired world, try stagnant or ancient crust, giant impact basin 70–90, volcanic flats 40–65, and moderate crater density. Reload Foundry and regenerate artwork to apply these features.

## Volcanic and primordial surfaces

**Volcanic terrain detail** in **Colors and texture** defaults to 75 on volcanic and primordial worlds. It reuses the baked barren rock maps and regional highland/scarp field for broken basalt, ash mantles, sulfur deposits, broad mountain shoulders and directional relief. Cooled volcanic flats suppress older roughness; lava pools include cooling rafts. Mountain shadows default to 70 and follow the same sunlight as clouds. Terrain detail 0 uses the simpler surface material while keeping explicitly selected landforms.

Under **Canyons and landforms**, **Lava basins** (default 45) creates irregular depressed molten pools with solid rims. **Supervolcano calderas** (default 35) adds broad collapsed floors, broken raised boundaries and ash deposits. Shield volcanoes expose molten summit vents, and branching canyons carry lava along their floors below rocky walls. New recipes default to shield volcanoes 55, canyon strength 40 and volcanic flats 40. Explicit settings in existing recipes are preserved. Strength changes keep feature locations fixed; changing palette, lighting or surface detail preserves elevations. Basins and calderas change the elevation field used by water and drainage. Water and ice can conceal molten terrain.

**Sulfur / toxic cloud variation** under **Clouds and weather** defaults to 65 and blends sulfur-yellow, muted fume and dark ash colors with the selected cloud palette. Volcanic sources add wind-offset billowing haze; the shared density/height field supplies cloud relief and shadows. New hot-world recipes default to 25 cloud cover to leave terrain visible. Cover or thickness 0 clears all clouds; toxic variation 0 restores normal cloud coloring and disables volcanic haze. These are artistic color and shallow-height effects, not a chemistry or fluid simulation.

Molten primordial textures retain broad magma regions; cooling crust and developing worlds reduce local molten coverage. Only molten regions emit at night. Exposed crust, ash and toxic clouds use reflected light. All features use spherical body coordinates in portraits, scene images and native orbital crops. Reload Foundry and regenerate saved artwork to apply them.

### Lava cooling and hot spots

**Lava glow** in **Colors and texture** defaults to 75 on volcanic and primordial worlds. Independent seeded fields place dark cooling rafts, warm molten shoulders and bright yellow-white hot cores inside the lava mask. Thermal emission follows the selected lava palette, warming toward pale hot cores, and uses screen blending to retain detail in bright channels. Glow 0 disables thermal emission while keeping the cooling patterns in the reflected surface colors. Increasing glow preserves geography and hot-spot positions.

The glow is a local emissive material with soft warm shoulders rather than a screen-space blur, so native orbital crops and both cameras sample the same features. Small fragments fade with the pixel footprint. Water, ice and cloud opacity can conceal lava emission; solid land and cooled flats emit no glow outside their molten channels. Regenerate saved artwork after reloading Foundry.

### Volcanic reference appearance

Volcanic worlds favor dark basalt, branching orange-red seams, larger molten provinces and a few near-white eruption centers. Two warped crack scales add irregular bends and small connecting branches. Their narrow cores fade with pixel size while soft shoulders retain a subtle glow. Shield volcanoes, supervolcano calderas and lava basins anchor eruption centers; their strength controls also strengthen these hot spots without relocating them. Warm surface-coordinate halos surround eruption centers and seams, including nearby solid crust. Exponential thermal tone mapping keeps the eruption centers bright while retaining saturated cooler lava and dark cooling patches. Primordial worlds retain their broader molten-crust appearance.

For the cinematic volcanic appearance, try Basalt or Obsidian, Lava glow 85–95, Shield volcanoes 70–85, Supervolcano calderas 55–70 and cloud cover 10–20. Lava fissures emphasizes branching seams; Lava fields emphasizes larger molten regions. These effects are baked into regenerated artwork, including scene views and orbital crops.

Primordial **Geoplastic / molten crust** also uses this eruptive appearance: darker exposed basalt, broader cooling rafts, branching molten seams, bright eruption centers and warm halos. It retains its larger magma regions and molten palette. **Primordial / cooling crust** and **Developing / early oceans** keep their subdued cooling-stage materials. The existing Lava glow, shield volcano, supervolcano and lava basin controls tune the molten appearance; reload Foundry and regenerate saved artwork.

## Planet atmospheric glow

**Atmosphere glow** and **Atmosphere glow color** under **Sunlight and shadow** add a soft illuminated limb and a narrow exterior halo. Class M and ocean worlds default to blue, deserts to warm dust, icy worlds to pale blue, and gas, dense-cloud and molten worlds draw their initial tint from their palette. Strength is independent of cloud cover. Barren worlds default to 0 and can be given a thin atmospheric glow manually; stars and asteroids do not use these controls. Strength 0 removes the added glow while retaining existing haze.

The glow follows the sun direction and night brightness, blends beneath the antialiased edge, and uses the same planet coordinates and scale in portraits, scene artwork and low-orbit crops. Strength and color are saved with the procedural recipe. Reload Foundry and regenerate saved planet artwork to apply it.

## Dense Venus-like and Demon atmospheres

Under **Colors and texture**, **Dense cloud relief and shadows** defaults to 75 and **Cloud turbulence** defaults to 35 on Venus-like worlds and 70 on Demon worlds. Broad sheared fronts and raised storm billows use sun-facing highlights, darker troughs and short soft shadows from taller clouds. Relief 0 removes directional height shading; turbulence 0 calms the eddies and storm towers. The cloud envelope stays fully opaque, with no exposed terrain. Height shading affects direct sunlight while preserving the night-side ambient floor. The colors and height field use spherical coordinates shared by portraits and orbital crops; this is a shallow cloud-height approximation, not atmospheric ray marching.

The default Demon palette is now **Demon crimson / ominous clouds**, with deep crimson, near-black troughs and muted red highlights. **Inferno black / blood red** provides a darker alternative. The previous warm colors remain available as **Copper / sulfur clouds**. Venus-like worlds retain their cream and ochre appearance. Customized atmospheric colors remain supported. Dense clouds emit no thermal light, even on Demon worlds. Reload Foundry and regenerate saved artwork to update the cloud material and non-custom Demon palette.

## Cinematic stellar artwork

**Photosphere detail** under **Solar flares and glow** defaults to 75. Warped convection cells, fine granulation, dark lanes, brighter active regions and layered starspots add surface depth with restrained contrast. A soft highlight response keeps luminous regions detailed rather than clipping whole areas to white. Fine granulation fades at smaller pixel footprints. Giants use broader cells; white dwarfs have smoother bright surfaces. Brown dwarfs retain their dim atmospheric bands rather than adopting photosphere detail. Detail 0 uses the simpler surface material.

The corona combines a bright inner rim and softer uneven outer streamers. Solar loops have bright near-white cores and wider colored plasma envelopes, with the far-side portions hidden by the star. Lens flare uses a narrow streak with a softer shoulder and subdued secondary artifacts. Corona, flare and lens controls remain independent and can each be disabled at 0. Spectral and custom colors remain supported; stars remain self-lit regardless of sun-angle settings. The same seeded surface coordinates supply portrait and scene artwork. These are artistic stellar effects, not a physical plasma simulation.

Try Photosphere detail 75–85, Solar flares 50–65, Corona / glow 45–60 and Lens flare 10–20. T-Tauri stars support stronger activity; white and brown dwarfs keep their restrained default effects. Reload Foundry and regenerate saved star artwork to apply the new renderer.

Solar flares now have taller, thicker arcs, stronger plasma glow and brighter footpoints where the loops meet the stellar surface. Increasing flare strength reveals more of a fixed seeded set of loops and raises their intensity and height. Normal and young stars have a stronger saturated corona, an inner limb bloom, and a smooth outer fade into transparency. Halo colors derive from the selected spectral colors, giving warm orange/red glow on warm stars and blue glow on hot stars. White and brown dwarf coronas retain their restrained response. Solar flares 70–85 and Corona / glow 60–75 produce a stronger reference-style appearance; regenerate artwork to apply it.

The normal/young-star corona is composited beneath the antialiased photosphere edge, removing the dark transparent seam between the disc and glow. Detailed photospheres now have warmer saturated convection texture, brighter limb response and seeded localized active regions with fine filament breakup. Flare arcs use wider, uneven, noise-modulated plasma wisps and softened cores rather than narrow uniform tubes. Bright footpoints remain attached to the star; far-side flares remain occulted. Custom colors and quieter dwarf materials remain supported. Reload and regenerate saved artwork to apply the seamless edge and updated plasma material.

Detailed photospheres now favor broader, smoother plasma shapes with faint granulation. Fine texture amplitude is reduced, and broad diffuse glow surrounds the seeded active regions. Brighter transitions and soft hot patches emphasize luminosity within the photosphere while retaining starspots and the selected spectral colors. Photosphere detail 75–85 is recommended for this glowing appearance; 0 retains the simpler granular surface. Reload and regenerate artwork to update saved stars.
