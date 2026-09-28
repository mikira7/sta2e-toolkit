# Starfleet TNG starter geometry proof

**Latest cabin revisions:** [wardrobes, an officer closet, corrected toilet orientation, a rectangular standard and paired junior cabins](cabin-revisions/README.md). These separate guides supersede the cabin brief for new artwork; the legacy catalog below stays pinned to the current registered scene assets.

This is the first assembly mockup for the approved [puzzle-kit production plan](../interior-prefab-production-plan.md). It establishes exact footprints and connections before finished room images are generated. It is not yet a selectable mode in the Foundry generator.

![Assembled habitation proof](starter-assembly.png)

[All nine footprint templates](starter-footprints.png) · [Editable geometry catalog](starter-kit.json) · [Assembly SVG](starter-assembly.svg) · [Footprint SVG](starter-footprints.svg)

## What is established

| Template | Physical layout |
|---|---|
| Q01-A standard quarters | 7.5 × 7.5 m envelope; bed, desk, seating and a perimeter bathroom with basin, toilet and sonic shower |
| Q03-L officer quarters | 9 × 9 m envelope with a real 3 × 3 m missing corner; separate tub and sonic shower; the bathroom shares the outer walls |
| T01-A compact lift | 3.6 × 3.6 m faceted cabin envelope, one direct corridor doorway, inboard only |
| H02-A straight | 6 m run; 3 m clear passage |
| H08-A side-door corridor | Same run and width, with one fixed room opening |
| H09-A opposed-door corridor | Same run and width, with two opposite room openings |
| H04-A bend | L-shaped floor with two compatible corridor ends |
| H07-A end cap | Rotates to close an unused passage end |
| F01-A structural infill | Fills the officer cabin's notch; solid technical space, not an inaccessible room |

There are ten placements made from nine masters: the end cap is reused with a different rotation. All eight module connections pair exactly. The three external room doors and two bathroom doors are represented once each in the merged wall data.

The bathroom envelopes are **9.9 m²** and **15.1 m²**, measured to wall centre lines. Net clear floor area is slightly smaller. Fixtures are represented at physical scale. Walking checks account for furniture and solid walls and verify that a one-square / 1.5 m diameter token can travel between the declared entrance, bathroom and living-area approach points with doors open. These checks do not claim that every furniture fixture itself is walkable.

Corridor walls are 0.15 m thick. A 3.15 m wall-centre span leaves 3 m clear between their inner faces. This distinction is intentional: wall thickness must not silently reduce the agreed passage width. Ordinary door openings are 1.8 m clear. Door positions are fixed per master.

The proof is a short connection example, not a complete ship deck. Empty space between separate modules is not automatically a finished hull or a corridor. The larger kit still needs the planned utility infill, hull caps, radial modules, Jefferies pieces and additional room types.

## Art direction for the first finished set

The diagram colours identify rooms, bathrooms, corridors and structural fill; they are **not** the final room colours.

| Surface/detail | Proposed TNG-set treatment |
|---|---|
| Camera and scale | Exact overhead orthographic; fixed physical footprint; no perspective walls or stretched furniture |
| Room floor | Muted warm grey/lavender carpet with fine restrained texture |
| Corridor floor | Coordinated charcoal carpet; repeated seams and guidance trim at the agreed pitch |
| Bathroom | Warm neutral, slightly cooler non-slip floor; built-in basin, sonic shower, toilet, and suite tub |
| Walls and frames | Pearl/warm-grey wall tops, darker recessed trim, consistent cut height and cross-section |
| Furniture | Slate-blue upholstery, light neutral beds/storage, brushed-metal fittings |
| Controls | Restrained amber/lavender/blue interface details; no readable text baked into the master |
| Illumination | Even neutral overhead lighting and subtle contact shadows; no strong shadow falling across a connection seam |
| Doorways | Frame and sill in the master; a separately controlled leaf/state layer at each shared opening |
| Windows | Declared exterior edge only; glazing supplied as a layer; no permanent exterior starfield baked into a room |

The existing furnishings and room inserts may inform materials and composition. They are not geometry substitutes. Each final render must match the template footprint, doorway location and fixture arrangement, with transparent pixels outside its envelope.

## Verification and scope

Run `node tests/interior-prefab-proof.mjs`. Add `--render` to regenerate the SVG proof sheets and prototype merged-wall JSON from the catalog. PNGs are rendered from those SVGs for convenient viewing.

Checks cover unique piece IDs, ports fitting their boundaries, matching port types/positions/directions, declared fixture containment, perimeter-attached bathrooms, expected tub variants, one-square-token access, assembly connectivity, footprint overlaps at 0.1-square sampling, inboard/outboard placement, rotation consistency, and deduplicated door segments. The assembly was also visually inspected.

`starter-assembly-walls.json` records geometry in grid units for this proof; it is **not** a Foundry scene import. No existing world scenes, current generator mode, or room artwork were replaced. Native Foundry wall, window and lighting export will be validated when this catalog is integrated.

## First artwork pass — 21 September 2026

The [art review and assembly study](../../assets/interiors/prefabs/starfleet-tng/index.html) now contains nine rendered candidates, with exact drawing overlays. The original PNGs, [catalog](../../assets/interiors/prefabs/starfleet-tng/catalog.json), [prompts](../../assets/interiors/prefabs/starfleet-tng/prompts.json), and [fit report](../../assets/interiors/prefabs/starfleet-tng/fit-report.json) are saved together. Artwork was generated using the built-in image tool. Earlier versions are retained separately.

Both cabin bathroom programs are present, including the officer suite's separate tub. The compact lift has no lobby. Corridor art includes straight, single-door, opposed-door, L bend and end cap variants. All nine selected PNGs have actual transparency, but **none is marked production-ready**. Generated images are 1254 × 1254; requested guides are 1536 × 1536 at 200 pixels per grid unit. Framing is not consistent enough to infer final placement directly from the generated canvas.

The initial review used one uniform scale from each image's opaque width and left remaining shape and seam errors visible. At that stage, the bend and end cap had approximately 6.6% and 5.6% envelope aspect differences respectively. These first-pass issues motivated the corrections below. The raw-image fit report measures outer bounds only and is not a connectivity or clearance certification.

Clean guides, footprint masks and pixel anchor metadata are in [art-guides](art-guides/manifest.json). Rebuild SVG guides with `node tools/build-interior-prefab-guides.mjs`; PNG conversion needs an SVG renderer. Build the art review and run read-only PNG checks with `node tools/review-interior-prefab-art.mjs <path-to-sharp>` (omit the argument if Sharp is installed locally).

## Fitted assembly — 22 September 2026

![Corrected art assembly](../../assets/interiors/prefabs/starfleet-tng/registered-assembly.png)

[Open-door map](../../assets/interiors/prefabs/starfleet-tng/registered-assembly.png) · [Closed-door map](../../assets/interiors/prefabs/starfleet-tng/registered-assembly-closed.png) · [Separate door layer](../../assets/interiors/prefabs/starfleet-tng/registered-door-layer.svg)

Five new renders correct both cabin furnishing arrangements, the straight corridor finish, the bend envelope, and the end cap proportions. The bend's envelope aspect error is now 0%; the end cap's is 1.2%. Both cabins retain their perimeter bathrooms, including the suite's separate tub and shower. All earlier PNG revisions remain available.

The fitted proof uses recorded envelope, corner and doorway anchors with one uniform scale per image. Exact footprint clips remove edge fringes during scene rendering, and a plain underlay fills small transparent raster holes. A single world-aligned carpet finish covers the corridor walking surfaces through a mask based on the exact wall/door geometry. This removes the floor-color seams and enforces the corridor surface's planned clear width. It is a layered composition; the standalone generated PNGs are not themselves guaranteed to tile seamlessly.

Five deduplicated door leaves form a separate proof layer; open doors have no leaves. The layer matches the geometry proof's three shared room entrances and two bathroom doors. The largest measured registration-anchor residual is 5.9 cm. The regression threshold of 7.5 cm is explicitly a fitting-proof tolerance, not approval of every painted wall edge or furniture clearance.

Rebuild SVG scene proofs with `node tools/build-interior-prefab-registered-proof.mjs`. Render those SVGs to PNG with an SVG renderer. `node tests/interior-prefab-registration.mjs` checks scale preservation, image revision hashes, registration residuals, clipping coverage, corridor-mask joins and separate door states against the deduplicated wall proof. The original geometry suite also passes. Both static scene previews were visually inspected; the HTML review was not browser-tested because its local URL was previously blocked.

Remaining art work: approve room-wall thickness and furniture clearances, create final door artwork and separate glazing. Curved hull and Jefferies compatibility require their own geometry proofs before those pieces enter production. The fixed starter export below uses the fitted proof composition. No live scene import has been tested.

## Experimental starter export — 25 September 2026

The Scenes directory now offers **Assembled Interior**, a separate Starfleet habitation starter dialog. Choose one of four outer-hull orientations and 70, 100 or 140 pixels per 1.5 m square. This milestone exports the single fitted ten-placement assembly; it does not yet rearrange pieces procedurally.

The generated scene includes 69 deduplicated native wall segments, with five controllable doors, two movement-blocking/transparent hull windows and ten lights. Both bathrooms have their own light. Window intervals replace their corresponding opaque wall intervals. The background always contains open doorways; separate door-leaf tiles follow native door state on each client without document writes. Locked doors remain visibly closed. Deleted walls hide the corresponding leaves. Existing generated/painted layout behavior remains available.

The runtime manifest is [starter-scene.json](../../assets/interiors/prefabs/starfleet-tng/starter-scene.json), built by `node tools/build-interior-prefab-starter.mjs`. It packages native geometry and piece/version metadata without runtime dependencies on these proof documents. Artwork integrity is checked before upload. Scene creation first validates host document data, then uploads a world-local background and creates all embedded walls/lights/tiles together. It never activates the scene for players.

Offline tests cover all 24 orientation, resolution and Foundry 13/14 combinations; identical raster/native transforms; clear window spans; door state handling; permission, schema, image, and upload failures; and cleanup. The source geometry and registered artwork suites also pass. See [starter usage and limitations](../../assets/interiors/prefabs/starfleet-tng/README.md). Live dialog/export, reload, player vision and token-movement testing remain pending because the local Foundry service was unavailable. This is an experimental entry point, not production acceptance of the art or a complete procedural prefab generator.

### Door alignment correction and native animation

User testing exposed a half-width offset in the v14 tile presentation: the exporter supplied top-left tile coordinates, while v14 positions the tile at its texture anchor. Version 14+ now creates native double sliding doors directly on the wall segments, using a single-panel texture at 200 px per square. The halves meet at the doorway midpoint and retract outward at full strength over 750 ms. No overlay tiles are created in new v14 scenes. Version 13 keeps its separate tile implementation.

On viewing an existing starter scene after an active-GM reload, the module adds missing native animation settings and hides only its obsolete generated door tiles. Coordinates and open/locked states survive, and user-configured animations with textures are preserved. The retained tiles allow recovery; the visibility hook suppresses them when their wall has a native animation, including for GMs. Offline migration tests pass, and the installed Foundry DoorMesh calculations pass 60 rotated/resized door-pair cases through opening and closing. Live visual verification of this fix remains pending: Foundry is reachable, but the test browser is at the login screen.

## Automatic assembly — first habitation family

The user subsequently confirmed that the native doors work. **Assembled Interior** now defaults to automatic assembly, with the fixed starter retained as a selectable option. The first family supports 2–6 standard and/or officer cabins, a seeded inboard lift position, straight corridors or an inward bend with a variable tail, end caps, and four whole-section orientations. Mixed accommodation includes both cabin types.

Each attachment aligns matching ports with opposing directions. Corridor spacers prevent room overlaps; exact polygon decomposition checks the concave suite and bend footprints, so structural infill can occupy an L-shaped notch without being mistaken for an overlap. All ports must have exactly one peer, all walkable pieces must connect, lifts must lie inboard of the passage, and windows must face unobstructed exterior space. Native wall construction splits and deduplicates coincident spans, including shared doors and hull glazing.

The renderer composes the pinned artwork at fixed physical scale, clips each master to its footprint, and applies the same continuous corridor finish as the starter. It exports native doors/windows/lights using arbitrary scene dimensions, with native v14 animations retained. Saved flags record the deterministic recipe and piece placements/versions. Artwork is stored in the world before the complete scene is created.

`tests/interior-prefab-puzzle.mjs` verifies 360 generated arrangements, reproducibility and seed variation, exact port pairing, reachability, non-overlap, windows, inboard lifts, invalid requests/missing pieces, art hashes and 24 rotation/resolution/version export combinations. Two rendered examples were visually inspected. See the [runtime library and examples](../../assets/interiors/prefabs/starfleet-tng/README.md).

Scope remains one linear habitation family, with an optional inward bend. Branches, loops, radial hull geometry, whole-deck filling, service routes and additional room/faction kits require more compatible masters. The automatic assembly UI/export has not yet been confirmed in a live Foundry session.
