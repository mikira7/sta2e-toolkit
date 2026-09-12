# STA 2e Toolkit

A FoundryVTT module for **Star Trek Adventures 2nd Edition** (Using the Star Trek Adventures `sta` game system).

## Features

- **Stardate HUD** — floating display with multi-campaign support and era switching (TOS, TNG, ENT, Klingon, Romulan, Custom)
  <img width="987" height="67" alt="image" src="https://github.com/user-attachments/assets/d3b795bd-67a3-4266-8cd5-465e28453742" />

- **Combat HUD** — draggable widget for ship and ground combat with bridge station assignments
  <img width="298" height="734" alt="image" src="https://github.com/user-attachments/assets/c5e12090-0d67-4363-8e0b-9df321266c15" />

- **Zone System** — hex/polygon zone grid with range bands (Contact/Close/Medium/Long) and ruler integration
- **NPC & Player Roller** — Simple-LCARS-styled dice roller with Threat spending and reroll support with auto theat and momentum spending, and reroll functions. Drag and drop, double click or use the easy fill slider to add/spend momentum or threat to build the dice pool.
  <img width="425" height="739" alt="image" src="https://github.com/user-attachments/assets/9d02d4c8-102d-4708-8cb9-56dc2dbb1611" /> <img width="422" height="715" alt="image" src="https://github.com/user-attachments/assets/e8cf3e8f-a0ed-4735-a41f-6633b37c51d1" />

- **Intergrate Advance Dice Roller With Character Sheets** - Overrides the standard dice roller in the sta system with the Advance Dice Roller used in the combat, also includes a side panel while in combat for starship combat only.
- **Unified Character Color Sceheme** - Uses a similar color scheme for the campaign which is set in the Stardate Hud, for character sheets, adv. dice roller, and other hud and widgets.
- **Social Opposed Task Builder** - A simple prompt to build social tasks between two characters that auto adds the difficutly in for the attacker.
  <img width="525" height="751" alt="image" src="https://github.com/user-attachments/assets/2430f6af-86be-4546-9aa2-4dda08a87a96" />

- **Warp Travel Calculator** — travel time and stardate advancement
  <img width="880" height="683" alt="image" src="https://github.com/user-attachments/assets/2bcb4b60-a14b-45ca-b22c-4e450f28590e" />

- **Transporter** — visual beam-in/out effects for tokens and for spawning in new characters via a transporter, with 9 different types
  - **Cinematic Shader** is an optional engine with slow token fades beneath a colored veil and dancing sparkles. TNG/Voyager use long falling streaks; Voyager adds two successive pairs of orbs traveling from the center toward the head and feet. TOS/TMP use era-colored circular outlines, and TMP adds two center lines that grow to full height before separating left and right. Choose it under **Sounds & Animations → Transporter** (or **Transporter Visual Effects Engine** in module settings). Expand a preset to tune colors, rain, dancing particles, glow, duration, and Figure/Portrait framing. Beam In/Out previews use selected tokens locally and restore their appearance; Save applies the settings to the world. Sequencer/JB2A and Native VFX remain available, and existing engine selections are preserved.
  <img width="766" height="394" alt="image" src="https://github.com/user-attachments/assets/38df0128-0e35-4412-941b-2e7149f98c43" />

- **Alert HUD** — alert status overlay with soudfx that can be added in the settings.
 <img width="200" height="102" alt="image" src="https://github.com/user-attachments/assets/2780004b-1684-4b80-8221-13303c3db53c" />
 
- **Wildcard Namer** — auto-names wildcard tokens from rollable tables using a the name of a trait within the character sheet or star ship sheet.
- **Token Distance Hover over** - While a token is select hoveing over another token show's it distance and auto calculates with the elevation of the token, and is full intergrated with the zone system. 

## Procedural planets and space maps

On a Star System actor's sheet, the GM can use the **palette** button on a star, planet, moon, or asteroid belt to preview procedural artwork. Choose a seed, appearance, texture, colors, axial tilt, and texture quality, then select **Apply Artwork**. Planets also offer surface, atmosphere, and ring controls. Reusing the same seed and controls in the same renderer version reproduces the body. Appearance controls do not change its survey classification; applying planetary rings also updates the body's Rings field.

**Colors and texture** provides type-specific patterns: continents and archipelagos; dunes, badlands, and salt flats; banded, turbulent, and smooth gas giants; glaciers and fractured ice; cratered or rocky worlds; and volcanic fissures or lava fields. Choose a named palette or **Seeded variation**, or enable **Customize colors** to set lowland/highland (or gas-band), water, cloud, ice, and city-light colors independently. Class-M-style worlds include green and purple ocean palettes. Changing the palette preserves the geography; changing the seed changes the geography and any seeded palette.

Gas giants use uneven broad belts and brighter zones, sheared cloud wisps, seeded oval vortices, subtle polar haze, and softer limb lighting. **Banded** emphasizes belts, **Turbulent** adds stronger weather and more storms, and **Soft bands** gives a calmer appearance. Cloud features remain attached to the planet in both views.

Gas palettes now blend six colors through the belts, middle cloud decks, and bright zones. Choose Golden Cream, Azure, Violet, Jade, Rose, Peacock, or Opal variations, or enable **Customize colors** and choose **3–8 cloud colors**. Each color is editable, in order from dark belts to bright zones. Older custom two-color recipes retain their endpoints when upgraded.

Select **Gas giant → Hot Jupiter / plasma clouds** for a stylized hot atmosphere with turbulent plumes and luminous filaments. Ember mixes crimson, orange, gold, and warm white; Plasma mixes indigo, violet, magenta, and icy blue; Stellar uses wine, copper, amber, and ivory. **Cloud glow** adjusts emitted light from 0–100; at 0 the clouds use reflected light only. Seeded variation chooses among the hot palettes for this texture. Both information and polar views share the same clouds and glow. Reapply artwork to upgrade existing planets, then regenerate their scenes to display the new textures.

For ice-giant atmospheres, choose **Gas giant → Ice giant — hazy** or **Ice giant — stormy**. Hazy uses subdued bands beneath a pale atmospheric veil with a brighter polar region; Stormy adds a dark vortex and sparse bright companion clouds. Uranus-inspired pale cyan, Neptune-inspired blue-green, and Cold teal palettes provide restrained six-color variations; custom colors, rings, tilt, and export quality still apply. These are atmospheric globes; the separate **Ice** appearance provides solid glacial surfaces. The visible-light treatment is inspired by [reconstructed Uranus and Neptune colors](https://www.ox.ac.uk/news/2024-01-05-new-images-reveal-what-neptune-and-uranus-really-look-0) and [Hubble observations of their clouds and storms](https://science.nasa.gov/missions/hubble/hubble-reveals-dynamic-atmospheres-of-uranus-neptune/), rather than a calibrated scientific simulation.

Under **Rings, view, and export quality**, choose broad icy, faint dusty, or narrow rings, then set density and color. Rings use different optical depths across their inner, middle, and outer regions, major divisions and smaller gaps, filtered fine structure, and mutual shadows between the rings and planet. Edge-on rings retain a thin visible projection. Broader rings leave a smaller globe inside the image; generated scene walls use that saved globe size, while older configured composites retain their original size. The artistic treatment was informed by [Cassini ring imagery](https://science.nasa.gov/mission/cassini/science/rings/) and [Voyager's view of Saturn's translucent inner rings and ring shadows](https://www.jpl.nasa.gov/images/pia01374-saturns-ring-system/).

**Surface, water, and civilization** controls water and ice coverage, mountain strength, river density, and optional city lights. Water coverage is approximated across the whole sphere and fills low basins on solid worlds, including deserts. New Class-K recipes start with 3% surface water; old dry-world recipes migrate their previously unused water setting to a dry or trace-water default. Rivers follow a coarse downhill drainage network and require some surface water. City lights default to off, fade in daylight, and are dimmed by clouds. These visual controls do not change population or survey records. Surface features share the same coordinates in the information and polar views.

**Settlement layout** offers organic city clusters, planned street grids, circular/concentric cities, linked circular cities, and domed colonies. **Automatic** chooses domes for barren and ice worlds and organic clusters elsewhere. Organic lights favor land and coasts; planned settlements use stable seeded positions. Domes and circular cities can occupy frozen surfaces, including solid sea ice, while open water remains unlit. **City lights** controls density, and **Settlement size** sets the footprint of discrete grids, circular cities, and domes. Increasing density preserves existing colony positions. Size and structures are exaggerated for orbital-map readability; 2K/4K exports resolve their ring roads, spokes, and dome lighting more clearly. All layouts use the custom City lights color.

**Linked circular cities** builds each settlement around a small central ring, radial avenues, and a larger outer ring. Illuminated routes join nearby settlements, forming linked circular formations across the night side. This layout uses fewer, larger settlements so the rings and connections remain readable. Routes follow the spherical surface and are checked for open-water crossings; frozen terrain can support them. Roads fade in daylight and under clouds along with the cities, and match the side and polar views. Select this layout explicitly; existing Circular and Domed layouts remain available.

**Sunlight and shadow** provides **Sun angle** (0–180°) and **Night-side brightness** (0–20%). The default 65° angle exposes more night side than the earlier near-full view, and the default 2% night brightness keeps unlit terrain dark. 0° is fully illuminated, 90° is half illuminated, and larger angles produce a crescent. Set night brightness to 0 for an unlit surface, or raise it for map readability. City lights and thermal glow remain visible in darkness. Terrain, cloud lighting, atmospheric rims, and ring shadows use the same sun direction in both views. These controls apply to spherical planets; stars and irregular asteroids retain their dedicated lighting. Reapply artwork and regenerate existing scenes to update them.

Desert and barren palettes also offer four-color regional materials: **Mars**, **Mesa**, and **Mineral desert**; **Lunar**, **Iron-rich**, and **Mineral rock**. They combine the soil/dust colors with independently colored exposed rock and mineral deposits. Mars mixes muted rust and tan dust with grey basalt and pale deposits. **Rock / mineral variation** controls their strength from 0–100; new palettes start at 75, while older palettes retain 0. Under **Customize colors**, edit **Exposed rock** and **Mineral deposits** alongside the existing lowland/highland colors. Color changes preserve terrain, drainage, craters, and canyons; both views share the same regional patterns. Select a new palette and reapply artwork to update an existing world.

**Crater density** adds impact bowls and raised rims to any desert, barren, or icy texture, including planets and moons. Set it from 0 (none) to 100 (heavily cratered). Increasing density adds impacts to the same seeded landscape without moving existing craters. Existing cratered and frozen-rock textures default to 50; other textures remain crater-free until enabled. For a Mars-like Class-K world, try Desert / Badlands, the Mars palette, density 30–60, and low cloud cover. Water and ice can obscure craters; the setting is saved with both artwork views.

**Fissure density**, under **Canyons and landforms**, adds narrow surface cracks with dark interiors and subtle raised edges to desert, barren, and icy planets or moons. Set it from 0 (none) to 100 (a dense network). Increasing density adds cracks to the same seeded pattern; new cracks fade in between steps. 0 also clears the cracks from the Fractured ice texture. Existing Fractured ice defaults to 70; other icy textures to 25, preserving their previous crack counts. Desert and barren worlds default to 0. These fine material features preserve elevations and river routes, and can be hidden by water, snow, and clouds. Their placement matches between the side and polar views; settings are saved with the recipe.

**Canyons and landforms** also provides three independent 0–100 strength controls for solid planets and moons, including Class-K deserts and barren worlds. **Canyon strength** cuts long meandering chasms with narrower branches; **Impact basins** adds broad depressions, subdued floors, and raised rims; **Shield volcanoes** adds wide volcanic mountains with depressed summit calderas. All default to 0 so existing terrain stays unchanged. Strength preserves seeded feature positions; a new seed relocates them. These landforms change elevations before water coverage and downhill drainage are calculated, so water and rivers respond to the modified terrain. Snow, oceans, and clouds can obscure features. Both artwork views share the same landforms and lighting.

For a Mars-inspired Class-K, try Badlands with the Mars palette, Canyon strength 65, Impact basins 45, Shield volcanoes 40, Crater density 30, and low water/cloud cover. The geological shapes draw on [NASA's Mars topography overview](https://science.nasa.gov/photojournal/maps-of-mars-global-topography/) and [Hellas basin imagery](https://science.nasa.gov/photojournal/hellas-planitia/). They are artistic, exaggerated features for orbital maps, not a geological or erosion simulation. Reapply procedural artwork and regenerate existing scenes to update them.

**Ice coverage** controls the approximate frozen fraction of the whole surface on mixed-biome worlds, including sea ice. It advances from the poles with irregular margins and an elevation bias, preserving the same underlying continents and basins. 0 removes snow and ice; 100 freezes the surface. Terrestrial and ocean worlds default to 8%, seasonal Class-Q worlds to 48%, and frozen rogue rock to 35%. The separate **Ice** appearance retains its fully icy material at 100%; choose terrestrial, ocean, desert, or barren for a mix of ice and exposed terrain. Gas giants, stars, asteroids, and opaque greenhouse atmospheres do not use surface-ice coverage.

**Clouds and weather** provides Mixed cloud layers, High wispy clouds, Layered overcast, and Storm fronts. **Cloud cover** controls overall amount, **Cloud thickness** controls opacity, and **Storminess** adds convective cloud towers. Low decks and high wisps have separate patterns, with soft ground shadows and varied cloud-top shading. Cover or thickness at 0 clears the cloud layer. These controls apply to solid worlds and moons; gas giants and dense greenhouse envelopes retain their dedicated atmospheric renderers.

Set **Hurricane systems** from 0–8 to request seeded tropical cyclones with clear eyes, dense eyewalls, and broken spiral rainbands. Placement requires a patch of unfrozen tropical water, so a dry, cold, or land-dominated world can support fewer systems than requested. This artistic treatment draws on [NOAA's hurricane structure reference](https://www.aoml.noaa.gov/general/graphics/lib/storm.html) and [NASA's description of thin cirrus clouds](https://science.nasa.gov/earth/earth-observatory/clouds-and-radiation/). It is a static weather snapshot rather than a climate simulation. Ice and weather settings are saved in the recipe and shared by both views; reapply artwork and regenerate an existing scene to update it.

The generator previews and saves two views of the same spherical terrain: a **side view for the information sheet and reports**, and a **polar view for scene maps**. Scene axial tilt defaults to 23.5°; 0° looks down the north pole, 90° along the equator, and 180° down the south pole. Continents, clouds, polar caps, gas bands, and rings follow the same axis. Tilt does not change the information portrait. Ring projection ranges from a full annulus at the pole to a thin band at the equator.

Solid-world materials separate broad regional colors from fine directional relief. Deserts have dust mantles, darker exposed-rock regions, localized wind-aligned dune fields, and salt deposits in low terrain. Barren worlds mix darker plains with lighter highlands; crater bowls and rims shade toward the light rather than using bright circular outlines. Ice uses pale sheets and long intersecting fractures with subtle raised edges. Terrestrial land has smoother vegetation/aridity transitions, while volcanic and primordial worlds use connected lava provinces and cooling crust. Canyons, basins, and shield volcanoes blend into the same material, and ice coverage retains the relief underneath it. These are artistic orbital textures, informed by [NASA's Mars dune imagery](https://science.nasa.gov/resource/colorful-dunes/) and [Europa ridge and fracture imagery](https://science.nasa.gov/missions/europa-clipper/europa-clipper-resources/ridges-on-europa/), rather than measured terrain or an erosion simulation.

Texture quality offers **1K, 2K (default), and 4K** output for each view. The renderer adds six octaves of warped terrain, coastal shelves, biome and mountain shading, detailed cloud layers, spherical craters, downhill river paths, optional city lights, and projected rings. Previews use reduced resolution; fine dune and ice-fracture patterns are filtered at small sizes, and small rivers and settlement details are clearer in the exported texture. Higher resolutions take longer to generate and use more memory; generation yields regularly to keep the interface responsive. Reload Foundry, reapply procedural artwork, and regenerate an existing scene to use updated surface materials.

The system's **Scene Map** button creates the full star system. The **map** button beside an individual planet creates a separate planetary space overview with a large planet, labeled moons and their orbital rings, and space for ship tokens. These are gridless orbital scenes; distances are schematic, and these are not planetary surface maps.

The system scene dialog can generate artwork for missing images, generate it for every star, planet, moon, and asteroid belt, or use existing artwork. Planetary overviews apply the same choice to their planet and moons. Missing scene views for previously generated procedural bodies are prepared automatically while preserving their information portraits. Reapply artwork in the palette dialog to upgrade both views of an older body to the new renderer. Custom images keep their existing view; a single uploaded image cannot supply unseen geography. Asteroid belts use a generated representative rock, distributed at varied sizes and orientations around the system orbit. Maps are editable Foundry scenes with tiles, drawings, and body walls. Creating an additional scene is the default; replacement affects only matching system scenes or that planet's overviews and retains the old scenes if building the new scene fails. Regenerate an existing scene to use the new textures.

Textures are generated locally as transparent WebP files in `worlds/<world-id>/sta2e-procedural-planets`, with their recipes and both image paths saved on the actor. No image pack or external image service is needed. Different recipes, resolutions, views, and renderer versions retain separate files so earlier scenes keep their artwork; deleting a scene does not delete these reusable files.

All 21 planet classes in the toolkit's image catalog have explicit procedural defaults, also used for moons. Existing saved recipes retain their appearance choices. Classes F, G, Q, R, and S are now available in the planet and moon type dropdowns.

| Catalog classes | Default procedural appearance |
| --- | --- |
| A, B | Geothermal fissures; extensive volcanic fields |
| C, D | Fractured ice; cratered rock (icy Class-D variants use cratered ice) |
| E, F, G | Molten geoplastic crust; cooling primordial crust and steam; mineral continents and early oceans |
| H, K | Desert dunes; rocky badlands with trace water |
| I, J | Hot Jupiter; banded Jovian atmosphere |
| L, M, O | Marginal continents; terrestrial world; ocean world |
| N, Y | Opaque Venus-like cloud envelopes with sweeping fronts, fine wind streaks, and soft polar haze; cream/ochre for Venus and copper/sulfur for Demon worlds |
| P, Q, R | Glaciated surface; seasonal ice and exposed terrain; frozen rogue rock |
| S, T | Turbulent warm super-Jovian; calmer blue cold super-Jovian |
| Asteroid belts and asteroid-scale moonlets | Irregular rock with craters and mineral grain; silicate, carbonaceous, metallic, and icy options |

Stars now have a palette button on their row. **Star / brown dwarf** supports all 12 listed stellar types: O, B, A, F, G, K, M, L, T, Y, White Dwarf, and T-Tauri. Stellar artwork has spectral colors, luminous surface granulation, spots, and a corona; brown dwarfs use dim cloud decks, and white dwarfs have smoother surfaces. Saved luminosity class affects granulation scale; scene layout continues to control stellar tile size. Brown-dwarf colors and brightness are illustrative so these faint bodies remain usable on a map.

Under **Solar flares and glow**, set **Solar flares**, **Corona / glow**, and **Lens flare** independently from 0–100. Flare loops follow the star's orientation and are occluded by its visible surface; glow creates a soft halo, and lens flare adds restrained camera streaks. Zero turns each effect off. T-Tauri stars default to greater activity, while brown and white dwarfs default to no solar loops. These are static effects baked into each exported texture, not animated scene effects. Stellar glow is excluded from the generated body wall radius.

## Requirements

- **FoundryVTT:** v13–v14
- **Game System:** `sta` (Star Trek Adventures)
- v14 is functional, however animation do not function until sequencer gets updated to v14.

## Required Dependencies

- [Token Attacher](https://github.com/KayelGee/token-attacher)
- [Sequencer](https://github.com/fantasycalendar/FoundryVTT-Sequencer)
- [JB2A Animations](https://github.com/Jules-Bens-Aa/JB2A_DnD5e)
- [Token Magic FX](https://github.com/Feu-Secret/Tokenmagic)

## Localization
- **English** - English is the only avaialble language, There are no plans to add additional languages at the moment.

## Installation

Paste this manifest URL into FoundryVTT → Add-on Modules → Install Module:

```
https://raw.githubusercontent.com/mikira7/sta2e-toolkit/main/module.json
```

## License

All rights reserved. Personal use only unless otherwise stated.
