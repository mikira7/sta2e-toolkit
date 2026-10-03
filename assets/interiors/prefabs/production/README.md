# Galaxy and Intrepid combined-module production

Before generating cabin images, apply the [cabin style guide](../../../../docs/interior-prefabs/cabin-style-guide.md). It defines glass/wood tables and shape variants, seating, potted plants, lighting, sonic showers and tub options in both styles. Record the chosen furnishings and guide hash with each generation prompt; the manifest tracks the applicable brief and requires visual style review.

## First combined officer-cabin samples

Latest appearance revisions: [Galaxy v6](galaxy/Q03-R-HC-BASE-v6.png) and [Intrepid v5](intrepid/Q03-R-HC-BASE-v5.png). These correct the mismatched dry-area floors, restore two contrasting corridor edge bands, and remove Intrepid's unwanted desk enclosure. The bathroom keeps its separate non-slip floor. The final background-extraction passes restore actual exterior alpha after the appearance edits returned opaque images. Both use style-guide version 2; their individual prompt records retain that version's hash. Earlier samples retain their original brief hashes.

These are the current appearance previews. Physical room/corridor proportions, wall thickness, door registration and replicator detail still require review before runtime use. The earlier attempts below are retained as history.

The original five combined candidates were generated using the built-in image tool. The first Galaxy and Intrepid samples supplied the edit targets for the appearance corrections above. Both included their half corridor, glass dining table, wood desk and coffee table, small desk plant, lamps, sonic shower and oval tub. Neither was registered or ready for runtime.

Both first samples drift from the approved room/corridor proportions and wall thickness. Intrepid also adds an unwanted desk enclosure and a stripe at the open corridor join. Both need a clearer replicator serving niche. Corrective second passes are rejected: they have opaque checkerboard backgrounds and remove required entrance-side wall sections. A fresh Galaxy third pass introduces unapproved decoration and a stone coffee table, and still does not match the geometry.

All exact prompts, reference roles, recorded furniture choices, source guide hashes and per-image review findings are in [combined-requests.json](combined-requests.json). These records are included in the [manifest](manifest.json). A failed correction is retained as a rejected candidate, never silently promoted. New wall layers and other cabins should wait until a combined base retains the exact guide proportions, wall bands, openings and floor joins.

The next artwork batch follows the [room plus half-corridor contract](../../../../docs/interior-prefabs/room-corridor-halves/README.md). Each image includes its room, complete entrance wall, doorway and one clear square of corridor floor. Opposite banks join at the corridor centre line. Moving door leaves remain separate.

![Combined geometry proof](../../../../docs/interior-prefabs/room-corridor-halves/assembly-proof.png)

The [manifest](manifest.json) tracks 14 primary artwork targets: six cabin bases and a 2×1 Jefferies alcove in each style. Cabin bases omit their rear-wall band; one separate solid or windowed wall layer completes each cabin. Sixteen support tasks cover blank-half material, ends, bends, T junctions, centre finishes, solid/windowed rear-wall families and curved hull sections. Only exposed hull cabins receive windows. No combined artwork is ready for runtime yet. Curved hull, bend and junction geometry, combined image registration and Foundry integration remain required.

The room-only Q03-R-v*.png files are preserved as appearance references. They do not satisfy the new combined footprint and are not selected for production. Earlier registration reports measure only the room-only candidates. Exact recorded prompts remain in [prompts.json](prompts.json); missing records are flagged in the inventory.

Rebuild the inventory using `node tools/build-interior-production-review.mjs <path-to-sharp>`. It reads artwork without modifying it and cannot promote a candidate into the live library. Generate the new officer-suite combined master in both styles first, check its floor joins and door alignment, then continue the remaining targets.
