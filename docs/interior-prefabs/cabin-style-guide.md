# Cabin artwork style guide

Version 3 — production brief for Galaxy and Intrepid cabins. This guide applies before generating any new cabin artwork. It is a project art direction, not a claim of exact canonical ship specifications.

The user's requirements are glass or wood tables in varied shapes, potted plants, visible light fixtures, varied chairs and lounge chairs, sonic showers and tub variations. The palettes and combinations below provide consistent starting defaults; new furniture variants can be added later without changing the approved cabin plans.

## Room character

Cabins should feel like comfortable, inhabited starship accommodation. Use fitted storage, soft upholstery, restrained personal decoration and furniture with rounded or softened edges. Maintain a coherent material family across a cabin and its attached half corridor. Variation comes from furniture silhouettes, wood tone, textiles and plants rather than changing wall positions.

| Element | Galaxy treatment | Intrepid treatment |
|---|---|---|
| Walls and built-ins | Warm taupe, cream and muted beige; rounded corners and dark recessed details | Cool grey and pale neutral panels; graphite bases and softly chamfered corners |
| Floor | One continuous muted mauve carpet across living, dining, work, bedroom, passage and closet | One continuous slate-blue carpet across living, dining, work, bedroom, passage and closet |
| Wood | Satin walnut, warm medium oak, occasional dark stained wood | Satin ash, pale oak or darker neutral wood |
| Glass | Clear, smoke or warm bronze tint; restrained reflections | Clear or smoke tint; restrained cool reflections |
| Upholstery | Muted blue, dusty rose, cream and charcoal | Slate blue, blue-grey, charcoal and muted teal |
| Fixtures and lighting | Warm diffused wall sconces, soft built-in strips, rounded housings | Neutral-white inset lamps, compact sconces, narrow built-in strips |

Use one principal wood tone, one glass tint and at most two upholstery accent colours per cabin. Metal is appropriate for legs, bases and trim; table tops are glass or wood. Avoid chrome-heavy furniture, distressed wood, rustic decoration and excessive glowing outlines.

### Floor and corridor continuity

The coloured zones in the geometry drawings identify functions, not different flooring materials. Use the same carpet colour, texture scale and grain across all dry cabin spaces, including bedroom and closet. Do not turn the dining or desk zones into rectangular patches, rugs, raised platforms or enclosures. The head keeps its distinct pale non-slip floor, with the material transition at its actual doorway.

Each attached corridor half keeps two adjacent, continuous colour bands along its **wall-side edge**. From the entrance wall toward the corridor centre: a narrow neutral border, then a wider accent band, then the main runner carpet. Galaxy uses a warm grey/taupe border, dusty rose accent and dark mauve runner. Intrepid uses a graphite border, light grey accent and slate-blue runner. As a starting material contract, reserve 0.10 square for the border and 0.15 square for the accent, within the one-square clear half corridor. Both bands remain flat, walkable floor; they do not narrow the passage.

The bands follow the corridor wall consistently through doorway frontage. Their widths and colours must match at every side join. The open centreline edge has main runner carpet only: the opposite wall's border belongs to the opposite half. Do not put another border across the centre seam. Keep this two-band treatment in edits; it must not disappear into a uniform carpet fill.

The desk is open to the living area. Its task chair faces the desk from the working side. No added wall, panel, rail or raised floor border may surround the desk.

### Corridor-facing wall character and alignment

The entrance wall must carry the earlier corridor studies' panel rhythm, recessed details, ribs, lamps and small door controls. Galaxy uses warm moulded panels, restrained wood-toned rail details and diffused inset lights. Intrepid uses cool panels, graphite lower details, chamfered ribs and narrow neutral-white lamps. A plain uninterrupted metallic trim strip does not meet this requirement.

Use the measured overhead wall band for these details. Do not tilt the camera to reveal tall wall faces or widen a decorative rib into a doorway or the clear corridor. The perspective corridor studies provide appearance references only. All wall centres, endpoints and five door apertures must register to the approved plan with one uniform scale; reject independently compressed room depth or oversized wall piers.

The [Galaxy](room-corridor-halves/Q03-R-HC-galaxy-wall-guide.png) and [Intrepid](room-corridor-halves/Q03-R-HC-intrepid-wall-guide.png) officer references combine geometry, continuous floor, two-band corridor finish and measured wall detail. Rebuild these code-native guides with `node tools/build-officer-wall-guides.mjs`; they do not alter any generated raster.

## Furniture and decoration library

| Asset family | Variants to create | Placement and appearance |
|---|---|---|
| Dining tables | Oval, rectangle, rounded rectangle and round; glass and wood versions | Stable pedestal or restrained legs. Preserve the approved number of seats and their approach space. Glass has a readable rim, subtle tint and a visible support beneath it. |
| Coffee tables | Oval, low rectangle, rounded triangle and softly asymmetric shape; glass or wood | Low profile within the existing living-area table footprint. Rounded triangle and asymmetric designs are occasional accents, not the only design used everywhere. |
| Side tables | Small round, oval and square with softened corners; glass or wood | Beside existing seating only where the guide reserves enough space. Do not consume the doorway or bedside route. |
| Desks | Straight or gently curved worktop; coordinated wood finish with inset dark controls | Retain the approved desk footprint. Keep the task chair on its working side facing the desk. Do not turn a desk into a dining table or enlarge it to fill the room. |
| Task chairs | Low upholstered swivel chair; medium-back ergonomic chair | Clearly show seat, back and base in overhead view. Position for use of the desk, with a clear route behind the chair where provided. |
| Dining chairs | Upholstered armless chair; slim rounded-back chair | Orient toward the table. Keep the approved family dining benches and six seats; do not replace benches with fewer chairs. |
| Lounge seating | Rounded tub armchair, low sculpted armchair, reclining lounge chair and chaise | Coordinate upholstery while varying silhouettes. Place only within an approved compatible seat footprint; a chaise cannot be substituted into a small chair slot. Preserve bedroom and closet access. |
| Sofas | Straight two-seat sofa; larger straight sofa where the guide permits | Soft upholstery and low arms. Do not introduce an L-shaped sectional that changes the approved circulation. |
| Potted plants | Small tabletop leafy plant, medium broad-leaf floor plant, slender upright floor plant | Simple ceramic or brushed-metal pots, restrained natural greens. Leaves and shadows must remain within the reserved placement area. No vines across doors or wall seams. |
| Light fixtures | Wall sconce, recessed service-wall light, bedside reading lamp, integrated desk light | Visible fixtures are built into walls or existing furniture. Suggest ceiling illumination through soft light on surfaces; avoid drawing hanging lamps that obscure the overhead map. |

A varied silhouette must still fit the measured fixture envelope. Fitting a round or oval top inside a rectangular dining envelope is permitted only if the planned seats remain usable. Furniture placement, fixture scale and circulation take priority over decorative variety.

## Bathrooms and heads

All shower fixtures are **sonic showers**. Show a dry recessed standing area or shallow enclosed booth with wall-mounted emitter panels, a small control panel and a threshold. A curved or straight transparent privacy screen may be used inside the existing shower footprint. Do not depict a water showerhead, handheld hose, rain head, running water, wet spray or steam as the normal sonic-shower treatment.

| Fixture | Variations | Rules |
|---|---|---|
| Sonic shower | Straight recessed booth; curved-front booth; softly chamfered booth | Same function and reserved footprint. The entry faces its usable approach area. Controls and emitter panels sit on walls rather than occupying standing space. |
| Tub | Oval inset basin; rectangular inset basin with rounded interior; sculpted rounded basin | Only in the larger heads whose approved guide includes a tub. Fit within the existing tub envelope; no new corner jacuzzi, enlarged spa or extra tub. |
| Tub finish | Warm ivory with neutral surround; pale grey with graphite surround | Default to an empty basin so its form is readable from above. A discreet bath spout/control is allowed at a tub; the sonic-shower prohibition on water hardware applies to showers. |
| Basin | Rounded inset bowl; oval bowl; compact rectangular bowl | Retain its designated location and standing approach. A basin must remain visually distinct from the shower. |
| Toilet | Compact rounded or softly squared sanitary housing | Cistern/back against the wall; bowl/front faces the usable floor, exactly as shown by the guide's orientation. |

Keep tubs, basins and sonic showers visibly distinct. Do not swap their positions while interpreting the guide. The approved bathroom arrangement, doorway and privacy partitions remain fixed.

## Starting combinations by cabin

These are appearance defaults, not new layout requirements. Use only the furniture slots present in that cabin's approved geometry. Extra plants or lamps require an unoccupied, measured placement; omit a decorative item if it would reduce clearance.

| Cabin | Suggested furniture treatment | Decoration | Head |
|---|---|---|---|
| Q01-B compact | Coordinated wood desk; upholstered task chair and existing compact seating | One small tabletop plant where practical; integrated desk/bedside lights | Toilet, basin and sonic shower |
| Q02-R standard rectangle | Wood desk; upholstered chair; varied glass/wood low table only if a table slot is present | One small plant; bedside and wall lighting | Toilet, basin and sonic shower |
| Q04-P junior pair | Related furniture family with a different upholstery accent in each private cabin | Up to one small plant per cabin; independent reading/task lights | Shared central toilet, basin and sonic shower |
| Q03-R officer | Oval glass dining table; wood low table; coordinated task and lounge seating in existing slots | Small tabletop plant and, where clearance permits, one floor plant; wall and reading lights | Existing tub plus sonic shower; start with oval tub interior |
| Q05-F2 family | Rounded-rectangle wood dining table with existing six-seat arrangement; oval glass low table | One or two plants if reserved space allows; matching room lights with restrained bedroom variation | Existing tub plus sonic shower; rounded rectangular tub interior |
| Q05-F3 family | Rectangle wood dining table with existing six-seat arrangement; softly shaped glass low table | One or two plants if reserved space allows; coordinated bedroom textiles and reading lights | Existing tub plus sonic shower; sculpted rounded tub interior |

A cabin without a dining table slot does not gain one from this guide. A lounge-chair or tub variation is a replacement within the corresponding slot, not an additional object. Variety should come from recorded choices, not from furniture or decoration changing each time an image is repaired.

## Image and layer contract

- Follow the [combined room/half-corridor geometry](room-corridor-halves/README.md) and [approved cabin interiors](cabin-revisions/README.md). Preserve all walls, doorway widths, fixture positions, connected closets, recessed replicators and clear routes.
- Use exact overhead orthographic view, ceiling removed, a consistent wall cut height, soft contact shadows and neutral scene illumination. No perspective, grid, labels, arrows or baked text.
- The base includes the cabin and half corridor, with the rear-wall band omitted. Complete it using exactly one registered rear-wall layer: solid inside the ship, windowed only at the hull. Do not bake windows, exterior views or window-specific sunbeams into the reusable base.
- Glass tabletop transparency reveals the room floor and table support within the finished image. It must not become a transparent hole through the entire map asset. Keep genuine asset alpha for empty exterior areas and intentionally omitted layers.
- Match wall-layer material, cut height and light direction to the base. A lamp in the removable rear-wall band belongs to that wall layer; do not bake half a fixture or its window-specific shadow into the base.
- Native animated door leaves stay separate. Plants, chair backs, lamps and furniture shadows must not cover a doorway, a corridor-floor seam or a replaceable rear-wall join.
- Keep replicators recessed in their marked thick service walls, with a readable serving niche. Preserve the living/work, sleeping, closet and bathroom divisions already approved.
- Do not redraw a cabin into an L shape, move a chair to the wrong side of its desk, or introduce furnishings just to fill every empty patch of floor.

## Required prompt and review record

Before each image call, record the cabin ID, style, guide version/hash, geometry reference, chosen table material and shape, seating treatment, sonic-shower variant, tub variant if present, and any reserved plant/light placements. State whether the requested image is a cabin base or a rear-wall layer. Include this guide's applicable constraints in the prompt rather than relying on its filename alone.

Review the rendered result for the following before accepting it:

- Glass/wood table materials and shapes match the recorded choices; glass has a readable rim and support.
- Chairs face the correct working or dining surface; seating capacity and circulation match the plan.
- Plants and lights fit reserved spaces and do not obscure doors, service niches or layer boundaries.
- Showers are sonic, and tub/shower/basin locations and toilet orientation match the guide.
- The selected Galaxy or Intrepid materials are consistent with the attached corridor and rear-wall layer.
- Door and wall registration, exterior alpha, fixture scale and all existing geometry checks pass.

This is a visual review as well as a geometry review. Recording the guide hash in the production manifest establishes which brief was used; it does not automatically certify that an image follows it.
