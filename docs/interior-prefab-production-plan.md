# Universal interior puzzle kit — production checklist

Status: the next production batch uses **rooms with attached half corridors**. [Current architecture, guides and joined proof](interior-prefabs/room-corridor-halves/README.md). Each combined master owns its entrance wall and doorway; opposing modules meet on the corridor floor. Six cabin interiors remain approved. The geometry assembler is implemented; combined artwork and live integration remain pending.

The inventory and connection proposals below are historical planning material. Where they conflict, the linked half-corridor contract and approved rectangular cabin catalog take precedence. The former 26 room-only/corridor image batch is superseded by 14 combined cabin/access artwork targets plus sixteen style-specific support tasks. Cabin bases use separate solid interior or windowed hull rear-wall layers; curved hull sections remain a geometry task. Jefferies recesses now have 2×1 clear squares. Old officer-suite candidates remain appearance references only.

Build complete, furnished room and corridor pieces whose footprints, walls, and connection points are known before artwork is made. The generator chooses compatible pieces and assembles them into a deck. It must not stretch a finished room image into an independently generated room outline.

“Universal” means a common connection system. It does not mean every piece attaches on every edge, or that unrelated faction interiors should be mixed automatically. A single family of pieces should create many coherent layouts through rotation, compatible variants, and room selection.

## 1. Decisions to lock before making images

- [ ] **Scale:** retain the project's 1 square = 1.5 metres. Size beds, bathrooms, doors, and corridor widths in metres first.
- [ ] **Master resolution:** proposed 200 pixels per square; export at the selected scene resolution without changing physical dimensions. Large rooms may require compositing several render passes.
- [ ] **Camera:** exact overhead orthographic view, with the ceiling removed. No isometric camera or perspective distortion.
- [ ] **Appearance:** consistent wall cut height, wall thickness, contact shadows, material scale, and neutral lighting within a style family. Emergency lighting is an overlay/state, not a reason to redraw every room.
- [x] **Entrance wall ownership:** one combined room/half-corridor master owns the complete entrance wall. The corridor join lies on floor, away from door openings. Adjacent room side walls still require consistent edge treatment and one deduplicated native wall.
- [x] **Door ownership:** room entrances are internal to combined masters. Keep animated leaves separate and export one native door per approved opening. Corridor floor joins never create doors.
- [ ] **Footprints:** use rectangles, chamfered rooms, L-shaped rooms, offset entrance bays, circular lift cabins, and hull-sector wedges. Transparent canvas corners are not walkable floor.
- [ ] **Rotation:** begin with 90-degree rotations for ordinary pieces. Curved families use their explicitly designed radial transforms. Never rotate an arbitrary rectangular room into a curved wedge or stretch it to fit.
- [ ] **Handedness:** track left/right layouts where necessary. Mirror only pieces whose furniture, controls, and connection rules still make sense; otherwise author a second master.
- [ ] **Corridor families:** ordinary passages have a 2-square / 3-metre clear width. Narrow service passages and broad promenades use separate connectors and transition pieces.
- [ ] **Hull curvature:** begin with one radial family: 15-degree segments around an 18-square / 27-metre corridor centre-line radius. The corridor edges are at radii 17 and 19 squares. Outboard rooms attach to the radius-19 edge; inboard rooms attach to radius 17. Different radii require separately compatible pieces.
- [ ] **Labels and grid:** do not bake readable labels, numbers, arrows, or a square grid into room masters. Add them separately so rotation and reuse remain possible.

The dimensions below are planning envelopes, not approved construction drawings. Validate the floor plans at actual token scale before turning them into artwork.

## 2. Connection standards

Each opening has a position, facing direction, clear width, connector type, and a clear approach area on both sides. Side-door corridor variants need matching room-door openings; a plain solid corridor wall cannot accept a room simply because its floor is nearby.

| Connector | Proposed clear width | Connects to | Required companion pieces |
|---|---:|---|---|
| Ordinary room door | 1.2 squares / 1.8 m | Cabin, office, lab, lift, normal compartment | Matching corridor doorway, standard door assembly |
| Wide room door | 2 squares / 3 m | Cargo, sickbay, engineering, large communal rooms | Wide doorway corridor, wide door assembly |
| Main corridor end | 2 squares / 3 m | Straight, bend, junction, radial adapter | Exact matching floor/trim seam |
| Narrow passage end | 1 square / 1.5 m | Personnel service passage | Main-to-narrow transition |
| Promenade end | 4 squares / 6 m | Station/public circulation | Main-to-promenade transition |
| Jefferies hatch | 0.6 squares / 0.9 m | Room access hatch and crawlway entrance | Matching hatch frame, crawling clearance |
| Jefferies route end | 0.6 squares clear within a 1-square service envelope | Tube straight, bend, junction | Matching grating and conduit seams |
| Airlock/docking port | Per approved airlock drawing | Compatible vestibule or exterior connection | Pressure door and exterior-end treatment |
| Vertical access marker | No automatic horizontal join | Lift shaft or Jefferies ladder | Deck destination metadata; separate travel implementation |

Native collision uses the actual opening width. Jefferies routes use smaller crawling tokens. A vertical access marker does not itself implement travel between scenes.

## 3. Room masters to create

Every master includes its floor, visible walls, built-in fixtures, furniture, and internal layout. Door leaves remain separate state artwork. Footprints are bounding envelopes in grid squares; L-shaped modules include an explicit missing corner, not a solid rectangular floor under transparent art.

“Core” identifies the first useful Starfleet TNG kit. “Expansion” completes the general inventory. Each distinct doorway configuration or changed footprint is a separate compatible variant, even when much of its artwork can be reused.

| ID | Room master | Initial envelope / shape | Layout requirements | Batch |
|---|---|---|---|---|
| Q01 | Standard single crew quarters | 4 × 5 or 5 × 5; offset entrance | Bed, desk, storage, seating, perimeter bathroom with toilet/basin/sonic shower | Core |
| Q02 | Shared two-person quarters | 5 × 6; divided sleeping zones | Two beds and desks; privacy; shared perimeter bathroom | Expansion |
| Q03 | Officer quarters | 6 × 6; L-shaped living space | Separate sleeping/living zones; larger perimeter bathroom, tub plus sonic shower | Core |
| Q04 | Senior officer / VIP suite | 8 × 6; L-shaped suite | Bedroom, reception/dining, storage, generous bathroom with tub; no wasted lobby | Expansion |
| Q05 | Family quarters | 8 × 7; branched internal plan | Two sleeping rooms, shared living space, bathroom(s) and storage | Expansion |
| Q06 | Compact/bunk accommodation | 4 × 6; elongated | Bunks, lockers, separate adjoining shared washroom; circulation stays clear | Expansion |
| Q07 | Shared washroom | 3 × 4; end or side bay | Toilet stalls, basins, sonic shower stalls; connects to bunk accommodation | Expansion |
| C01 | Small command bridge | 8 × 8; circular/chamfered | Helm, command, perimeter stations; two deliberately placed exits | Core |
| C02 | Large command bridge | 10 × 8; oval/chamfered | More stations, command grouping, routes behind consoles | Expansion |
| C03 | Station operations centre | 10 × 10; tiered footprint | Operations focus, perimeter stations, multiple public exits | Expansion |
| C04 | Ready room / office | 4 × 5; offset or chamfered | Desk with chair behind it, visitor seats, sofa; bridge or corridor entry | Core |
| C05 | Briefing / conference room | 6 × 5; hull-facing option | Table and chairs with usable circulation; display and optional hull windows | Expansion |
| T01 | Single turbolift cabin | Approx. 2 × 2 cabin within 3 × 3 envelope | Circular/faceted cabin; controls; one door directly onto corridor; inboard only | Core |
| T02 | Paired turbolift bank | 5 × 3; two compact cabins | Two independent doors; corridor-side adapter, no oversized lift room | Expansion |
| T03 | Transporter room | 6 × 6; curved side alcove | Pad in fitted alcove, separate operator station, clear access and equipment bay | Core |
| T04 | Cargo transporter | 6 × 7; industrial | Large pad, cargo staging and control booth | Expansion |
| T05 | Personnel airlock | 4 × 3; vestibule | Two pressure boundaries, suit storage, interior and exterior ports | Expansion |
| T06 | Docking reception / gangway | 6 × 4; elongated | Airlock connection, reception/checkpoint, pressure-door approach | Expansion |
| M01 | Sickbay treatment room | 7 × 6; chamfered or L-shaped | Diagnostic beds beside clear aisles; staff station and equipment storage | Core |
| M02 | Surgery / intensive treatment | 5 × 5; enclosed | Central treatment bed, equipment, staff access, sickbay connection | Expansion |
| M03 | Medical office / examination | 4 × 4; side bay | Exam bed, consultation desk and storage | Expansion |
| M04 | Isolation / quarantine | 5 × 4; vestibule entry | Patient area and distinct controlled entrance | Expansion |
| S01 | General science lab | 6 × 5; L-shaped benches | Work surfaces, instruments, storage and clear working aisles | Core |
| S02 | Specialist / containment lab | 6 × 6; central protected area | Containment apparatus, observation/control station, equipment access | Expansion |
| S03 | Computer / sensor control | 5 × 5; equipment-lined | Console stations and accessible equipment banks | Expansion |
| E01 | Main engineering | 10 × 8; shaped around machinery | Core, control stations, safe walking routes and service entrances | Core |
| E02 | Reactor / auxiliary power | 7 × 7; industrial | Dedicated machinery enclosure and maintenance clearance | Expansion |
| E03 | Workshop / maintenance | 6 × 5; bench-lined | Benches, storage, working floor and tube access | Expansion |
| E04 | Machinery / life-support bay | 5 × 5; irregular equipment bays | Pumps/filters/control banks with maintenance paths | Expansion |
| E05 | Cargo / stores | 8 × 6; chamfered/L-shaped | Shelving and containers around a continuous handling aisle | Core |
| E06 | Small utility / storage bay | 3 × 3; corner or side bay | Useful infill, supplies and service access | Expansion |
| E07 | Shuttle / vehicle bay | 16 × 12 or larger; separate large-module family | Landing/parking area, apron, control area, exterior opening | Expansion |
| P01 | Crew lounge / mess | 7 × 6; hull-facing | Seating groups, dining, replicators and open circulation | Core |
| P02 | Galley / replicator service | 5 × 4; service connection | Food/service counters, storage and mess connection | Expansion |
| P03 | Recreation / gym | 7 × 6; open central space | Exercise/recreation zones and perimeter storage | Expansion |
| P04 | Holodeck / simulation room | 8 × 8; distinct entrance | Neutral inactive chamber; optional scenario overlays later | Expansion |
| P05 | Observation lounge | 8 × 5; curved hull | Windows, social seating, view-facing arrangement | Expansion |
| B01 | Security office / armoury | 5 × 5; controlled side bay | Desk, equipment lockers, secure storage | Expansion |
| B02 | Brig | 7 × 5; cells beside guard passage | Cells, guard station, separately controlled forcefield/door openings | Expansion |
| B03 | Checkpoint / decontamination | 4 × 4; through route | Screening station with deliberate entry and exit | Expansion |
| A01 | Regeneration compartment | 6 × 6; alcove-lined | Faction-specific regeneration equipment and conduit access | Faction expansion |
| A02 | Assimilation / processing chamber | 8 × 6; industrial | Faction-specific machinery, working areas and connected conduits | Faction expansion |

### Required room variations

- [ ] **Inboard version:** no exterior windows; suitable service-side walls and optional predefined tube hatch.
- [ ] **Outboard version:** a declared hull edge with windows where appropriate. Never place this edge against another room.
- [ ] **Flat hull and radial hull versions:** distinct footprints. A curved-room render cannot be manufactured by distorting its flat counterpart.
- [ ] **Left/right entrance versions:** where a bathroom, bed, or control station prevents simply rotating the piece.
- [ ] **At least one true L-shaped outer footprint:** standard quarters, officer quarters, and a lab/workshop; specify the adjoining utility piece or neighbouring room that fills the notch.
- [ ] **Internal L-shaped living space:** bathrooms and storage form perimeter bays; living/sleeping circulation wraps around them.
- [ ] **Approved entry positions:** start with one standard entrance per quarters master; additional positions require a checked variant, not a new opening punched through finished furniture.
- [ ] **Bathroom layouts:** standard toilet/basin/sonic shower; larger suite toilet/basin/sonic shower/tub. Bathrooms share the cabin perimeter and have realistic standing space. Review roughly 7–10 m² standard and 11–16 m² suite layouts before freezing dimensions; these are design targets, not automatic rules.
- [ ] **Service access variants:** hatch built into a specific available wall with a clear approach; no hatch behind a bed or machine.

Turbolifts have no outboard/hull-window variant. They are placed inside the ship/station structure, opening directly onto a passageway. A corridor window does not make a lift an exterior compartment.

## 4. Corridor masters to create

All pieces include their visible walls, trim, floor, and lighting housings. End seams must match in width, colour, texture scale, and wall cross-section.

| ID | Piece | Required configurations |
|---|---|---|
| H01 | Short straight | 2-square-wide passage, 2-square run; two open ends |
| H02 | Standard straight | 2-square-wide passage, 4-square run; two open ends |
| H03 | Long straight | 2-square-wide passage, 8-square run; structural rhythm matches H02 |
| H04 | Right-angle bend | Proper inside/outside corner walls; no pinched walking lane |
| H05 | T junction | Three matching corridor ends |
| H06 | Cross junction | Four matching corridor ends |
| H07 | Dead-end cap | Solid end wall, optional terminal/service panel |
| H08 | One side doorway | Standard straight with one room-door socket |
| H09 | Opposed side doorways | Matching sockets on both sides |
| H10 | Staggered side doorways | Offset cabin/office entrances |
| H11 | Wide side doorway | Cargo/medical/engineering connection |
| H12 | Shallow recess / doorway alcove | Offset entrance without making a large lobby |
| H13 | Offset / dogleg | Full corridor clearance around a displaced run |
| H14 | Radial straight-through segment | 15-degree segment of the chosen radius; no side doors |
| H15 | Radial outer-door segment | H14 with a fixed outboard room socket |
| H16 | Radial inner-door segment | H14 with a fixed inboard room/lift socket |
| H17 | Radial two-sided-door segment | H14 with both sockets |
| H18 | Radial-to-straight adapter | Explicit endpoint poses connecting the radial and straight families |
| H19 | Narrow service passage | Straight, bend and T variants; personnel access |
| H20 | Main-to-narrow transition | Tapered width adapter |
| H21 | Wide promenade | Straight, bend, T and side-door variants |
| H22 | Main-to-promenade transition | Width and material transition |
| H23 | Pressure bulkhead passage | Two corridor ends and a wide controllable closure |
| H24 | Corridor window bay | Exterior-marked edge; never placed in an inboard run |

H19 and H21 each represent several masters. Rotations are placements, not extra image generations. Door-side variants are real production items and must be counted when the chosen starter geometry is frozen.

## 5. Jefferies and vertical-access pieces

| ID | Piece | Requirement |
|---|---|---|
| J01 | Tube straight, short/long | Consistent grating, conduits, cross-section and connector ends |
| J02 | Tube elbow | Full crawling clearance through the bend |
| J03 | Tube T junction | Three compatible route ends |
| J04 | Tube cross junction | Four compatible route ends |
| J05 | Room-to-tube hatch adapter | Room-wall opening, hatch frame, clear landing and route connection |
| J06 | Tube end / equipment termination | Intentional closed end, not an unfinished seam |
| J07 | Vertical ladder shaft | Visible ladder/access platform, destination marker and safety boundary |
| J08 | Junction chamber | Small maintenance access chamber where several routes meet |
| J09 | Radial tube segment and adapter | Fits the selected curved hull family |
| J10 | Turbolift shaft / machinery surround | Structural fill around a cabin; not a second passenger room |

Routes form a separate connected maintenance network between intentional hatches. They must not cut through a neighbouring bedroom, bathroom, lift shaft, or empty space outside the hull.

## 6. Shared construction and state artwork

These are necessary to assemble finished-looking rooms without multiplying every room image for every door/window condition.

- [ ] Standard door frame, sill, open door leaves, and closed door leaves.
- [ ] Wide cargo/pressure door equivalents.
- [ ] Jefferies hatch frame and open/closed hatch states.
- [ ] Brig forcefield off/on states and emitter frames.
- [ ] Solid bulkhead caps, straight wall ends, convex corners, and concave corners.
- [ ] Shared-wall seam strips and matching floor/trim seam patches.
- [ ] Flat hull cap, curved hull cap, hull corner, and hull-to-bulkhead junction.
- [ ] Standard cabin window, wide lounge window, and matching solid/blank panel alternatives.
- [ ] Window glass/emissive layer; optional shutter state where that room family supports it.
- [ ] Structural/service fill for gaps between shaped rooms, including small rectangles, wedges, and L-notch infill. This fill is not walkable.
- [ ] Blank floor/material swatches for controlled seam correction, not for rescaling room footprints.
- [ ] Damage, scorch, debris, and emergency-light overlays as a later visual expansion.
- [ ] Signs, room labels, door numbers, and deck markings as separate overlays.
- [ ] Thumbnail/contact-sheet images and a visual catalog showing dimensions, ports, and allowed neighbours.

The delivered base room can look fully pre-rendered, including wall surfaces and fixtures, while retaining layered masters for doors, windows, and corrections. Do not bake an immovable closed door across a playable opening.

## 7. Faction and era art families

Start with **Starfleet TNG / DS9 / Voyager**, establish a consistent style, and prove a complete section assembles well. Extend the tested geometry into other compatible families. Distinctive layouts may need new footprints rather than a colour change.

| Family | Planned era coverage matching current generator choices | Additional design brief |
|---|---|---|
| Starfleet | Enterprise, Original Series, movie era, TNG-era, Picard-era | Separate console, furniture, wall, door and material references per era |
| Klingon | Original Series, movie era, TNG-era, Picard-era | Distinct structural shapes, machinery, seating and communal accommodation |
| Romulan | Original Series, movie era, TNG-era | Distinct control stations, wall profiles, doors and social spaces |
| Cardassian | TNG-era, Picard-era | Distinct angular/curved structural framing and station circulation |
| Borg | TNG-era, Picard-era | Conduit/lattice circulation, regeneration and processing modules; no automatic domestic quarters or hull-window cabins |

These are production scope labels, not claims that a specific canonical room exists in every era. Build reference boards before authoring each art family. One approved visual set may serve multiple era selections only when the reuse is intentional and documented.

Ship and station variants share connectors. Stations additionally need the promenade, docking reception, public/service zoning, and larger operations/cargo modules. Different style families must not be mixed in one deck by accident; a refit/captured-vessel style transition is an explicit special module.

## 8. What must accompany every image

- [ ] Stable piece ID, version, faction/style family, era compatibility, and category.
- [ ] Exact canvas dimensions, pixels-per-square, anchor, footprint polygon and allowed transforms.
- [ ] Connection positions, direction, width, type and permitted neighbours.
- [ ] Walkable area and clearance around entrances, fixtures and furniture.
- [ ] Solid wall paths, native door/hatch/window segments, and light locations.
- [ ] Exterior-hull edge tags, inboard-only tags, and structural/void masks.
- [ ] Internal room subdivisions, including bathroom floor, partition paths and door.
- [ ] Layered source, exported art, collision/placement metadata, thumbnail and provenance/prompt record.
- [ ] An assembly example and verification status: drafted, geometry checked, art made, seams checked, Foundry checked, ready.

Artwork generation alone cannot guarantee exact connectors or collision geometry. Start from a precise floor-plan template and finish each render to that template; inspect and correct its edges before accepting it into the catalog.

## 9. Production order

1. **Geometry and style reference sheets.** Draw the footprints, doors, wall cross-sections, bathroom plans and connector swatches. Make plain-colour assembly mockups first. No room rendering yet.
2. **Small assembly proof.** Join one standard quarters, one officer quarters, a lift, a straight corridor, a side-door piece and a bend. Prove seam ownership, door states, bathroom access and fixed physical scale.
3. **Core Starfleet TNG art kit.** Produce the Core room masters above, their needed doorway variants, H01/H02/H04–H11/H14–H18/H23, the required hull caps/windows, door states, and J01–J05/J09/J10. Make the minimum connector/support artwork before expanding room variety.
4. **Three complete deck examples.** Assemble a habitation sector, command/medical sector, and engineering/cargo sector. Verify every connection in Foundry, including window collision, native doors and Jefferies routes.
5. **Room and station expansion.** Add the remaining general room types, shared accommodation, docking, promenades and large bays.
6. **Faction/era expansion.** Produce the other visual families against the proven connector system; introduce faction-specific geometry where needed.
7. **Optional visual variants.** Damage, alternate furnishings, emergency states and refit transitions.

This checklist counts logical masters and required variants, not image-generation calls. Final file counts depend on approved door positions, handed layouts and art families. Do not multiply every room by every faction, era, shape and doorway combination before the first kit has passed assembly review.

## 10. Acceptance checks before a piece is ready

- [ ] It matches the approved footprint and metre scale; furniture has not been stretched.
- [ ] All permitted seams fit in both directions and every allowed rotation.
- [ ] Wall joints have no gaps, doubled thickness, colour jumps or mismatched shadows.
- [ ] Door openings agree in artwork, connector metadata and Foundry walls.
- [ ] A normal token can pass ordinary doorways and main walking paths; crawling routes use their declared clearance.
- [ ] Bathroom fixtures have standing/access space and the bathroom shares actual perimeter walls.
- [ ] Closet partitions join adjoining walls without sliver gaps; food replicators are recessed into explicitly reserved service-wall depth, with a clear approach in each private cabin.
- [ ] Shaped/L rooms do not overlap their neighbours, and their missing corners receive intentional infill or another room.
- [ ] Turbolifts remain inboard; windows and exterior airlocks face an actual exterior edge.
- [ ] Jefferies hatches lead to connected routes; no route crosses another module's solid footprint.
- [ ] All selected rooms are reachable; incompatible ports and accidental exterior openings are rejected.
- [ ] Door/window state artwork remains correct after save and reload.
- [ ] The piece passes both a close-up inspection and a full-deck seam inspection.

## 11. Existing assets and implementation work

**Existing nine-image room/corridor kit:** seven room inserts and two corridor floor images. Their original briefs explicitly omitted enclosing walls and fixed doorway locations. Treat them as composition/material references, not as completed puzzle masters. The lift-lobby image is unsuitable for the new compact cabin standard.

**Existing individual furnishings and textures:** 28 additional PNGs, including floor materials, furniture, corridor sill and hull window artwork. Reuse suitable items in layered compositions after checking scale, angle and visual consistency. Reuse does not remove the need for complete wall/door/layout masters.

**Future generator work, after the geometry proof:** add a prefab catalog/metadata format; place pieces from compatible ports; enforce footprints, hull location and room adjacency; connect service routes; compose fixed-scale artwork and state layers; create deduplicated native walls/doors/windows/lights; save prefab IDs, positions and versions in the scene recipe. Include manual piece replacement/rotation and a missing-piece report when a requested arrangement has no compatible module. Preserve the current generated and painted modes as separate choices.

The first **geometry/style reference sheet and assembly mockup** is available in [the starter proof](interior-prefabs/README.md): nine masters, ten placements, two bathroom programs, one inboard lift, fixed doorway positions and verified walking approaches. This proves the initial straight-corridor geometry family. The [artwork review](../assets/interiors/prefabs/starfleet-tng/index.html) now includes a corrected, registered assembly with smaller cabin furnishings, fixed corridor shapes, a continuous corridor floor finish and separate open/closed door proofs. Source PNGs remain immutable; exact outline clips and a shared corridor texture are applied by the scene-proof renderer. Room-wall cross-sections, final door/window art and live Foundry integration still require validation. The full inventory, radial family and Jefferies prefab network remain later work.

As of 25 September 2026, **Scenes → Assembled Interior** exports that fixed starter in four orientations with native walls, doors, hull windows and lights. Offline adapter tests pass for Foundry 13 and 14. Live validation remains pending. This limited experimental export does not complete the broader compatible-port placement system or change the production acceptance checklist above.

The next milestone adds **automatic habitation assembly**: seeded 2–6-cabin sections, standard/officer/mixed rooms, inboard lifts, straight or bent passages, compatible port attachment, footprint rejection and closed corridor ends. The user confirmed the native door fix works. Automated checks cover 360 generated layouts; live confirmation of the new assembly UI/export remains pending. This delivers the first constrained placement family, while branches, loops, curved hulls, service routes and the remaining room/faction inventory stay on the production list.

The user has now requested corridor aesthetics closer to **Galaxy and Intrepid classes**, with **both retained as selectable styles**, before expanding the art/layout library further. The [corridor studies](../assets/interiors/prefabs/corridor-studies/README.md) provide two visual boards and a measured 2×2-square Jefferies access alcove. New masters H10-J and J01-A are geometry prototypes; 160 placement checks pass. They are not yet runtime artwork. The next production batch must use orthographic guides and style-specific floor layers so carpet runners and borders survive composition. The hatch remains closed until a real tube route or vertical destination is connected.

The user approved the corridor looks and asked for matching cabin finishes. [Galaxy and Intrepid cabin studies](../assets/interiors/prefabs/cabin-studies/README.md) show standard quarters and the L-shaped officer suite in each material family. They remain palette references; their cabin geometry brief has been superseded by the following measured revisions. Review boards are not yet runtime art.

The [revised cabin guides](interior-prefabs/cabin-revisions/README.md) now retire the L-shaped officer design in favor of Q03-R, a long rectangular suite with dining, living/work, bedroom, closet and head sections. Q05-F2 and Q05-F3 add two/three-bedroom family suites with dining seating for six. A private passage gives independent access to every bedroom and the shared head. Each larger suite has one master bedroom with a private walk-in closet accessed only from that bedroom. Desk chairs are centered on their desks' working edges. Wardrobes, recessed replicators, wall-backed toilets and the paired junior-officer arrangement remain included. All six plans pass fixture, chair alignment, storage, privacy-route and one-square walking checks. Six masters in both material styles require **twelve cabin images**, making **26 planned master images** with the 14 corridor/access pieces, plus hatch/floor layers. These guides are separate from pinned legacy geometry. New artwork registration and runtime support for larger suite bays and two-entry paired modules remain to be completed before the revised cabins become selectable in Foundry.
