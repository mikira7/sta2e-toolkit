# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Module Overview

`sta2e-toolkit` is a FoundryVTT module for Star Trek Adventures 2nd Edition, running on Foundry **v14** (v14 gotchas: tiles anchor at their center, so tile x/y is the center point; scene background image/color live in the scene's `levels` collection, not the legacy top-level fields). It runs on the `sta` game system. The module is pure ES modules — there is no build step, no bundler, no transpilation, and no test suite. Reload FoundryVTT to see changes.

## Development Workflow

- **No build required.** Edit files directly; FoundryVTT loads them as ES modules from `scripts/main.js`.
- **To test changes:** Reload the FoundryVTT world (`F5` or `/reload` in the browser).
- **Module data path:** `C:\Users\tr2kk\AppData\Local\FoundryVTT\Data\modules\sta2e-toolkit\`

## Architecture

### Entry Point & Initialization

[scripts/main.js](scripts/main.js) is the sole ES module entry point (declared in `module.json`). It:
1. Imports and wires all subsystems in `Hooks.once("init")` / `Hooks.once("ready")`
2. Constructs `CampaignStore`, `StardateHUD`, `ToolkitAPI`, etc.
3. Exposes the public API at `game.sta2eToolkit` (a `ToolkitAPI` instance)
4. Registers the socket handler (`module.sta2e-toolkit`) for cross-client sync

### Public API

[scripts/toolkit-api.js](scripts/toolkit-api.js) — `ToolkitAPI` is the only stable external interface. Macros and external code should use `game.sta2eToolkit` methods rather than importing internals directly. Key methods:
- `getActiveCampaign()`, `getCampaigns()`, `advanceByDuration(delta)`, `setDateTime(data)`
- `broadcastHUDRender()` — call after any world setting change players need to see
- `getZones()`, `getZoneForToken(token)`, `getZoneDistance(tokenA, tokenB)`

### Campaign & Stardate System

[scripts/campaign-store.js](scripts/campaign-store.js) — single source of truth for all campaign data stored in world flags. All reads/writes go through `CampaignStore`.

[scripts/stardate-calc.js](scripts/stardate-calc.js) — era-specific stardate math. Eras: `tng`, `tos`, `ent`, `klingon`, `romulan`, `custom`. The `custom` era uses a configurable `dailyRate` multiplier.

### LCARS Theme System

[scripts/lcars-theme.js](scripts/lcars-theme.js) — **always call `getLcTokens()` at render time, never at module load time.** Theme changes when the active campaign changes. The `LC` pattern used throughout the codebase is a `Proxy` that resolves tokens dynamically:

```js
const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });
```

Themes: `lcars-tng` (orange), `lcars-tng-blue` (cool blue), `tos-panel`, and others for ENT/Klingon/Romulan.

### Combat HUD

[scripts/combat-hud.js](scripts/combat-hud.js) is a compatibility facade for the split combat HUD modules. Most implementation still lives in [scripts/combat/combat-hud-core.js](scripts/combat/combat-hud-core.js). The split modules contain:
- `CombatHUD` class — draggable floating widget for ship/ground combat
- `BRIDGE_STATIONS`, `TASK_PARAMS` — configuration constants in `scripts/combat/combat-definitions.js`
- Dozens of exported task functions (`applyImpulseForOfficer`, `applyWarpForOfficer`, etc.) called from `main.js` socket/button handlers
- Ship-card destination and Impulse/Warp movement helpers in `scripts/combat/ship-card-movement.js`
- NPC Notable/Major actors spend Threat to avoid deadly injuries (`applyGroundInjury`)

All combat button actions route through socket messages to ensure the GM executes privileged operations. Player buttons emit socket events; `main.js` handles them on the GM side.

**Who is acting.** Never pick an officer with `getStationOfficers(ship, stationId)[0]` — use `resolveActingOfficer()` / `resolveActingOfficerIndex()` from [scripts/combat/acting-officer.js](scripts/combat/acting-officer.js). Command is the only two-seat station (`COMMAND_SEATS`, Captain at index 0, First Officer at 1), so slot 0 silently credited every First Officer's Direct, Rally and Command Assist to the Captain. The resolver takes the first hint that actually mans the station — an explicit `actingActorId`, the module's initiative selection, core's turn pointer, `game.user.character`, the ring's saved active actor — and otherwise returns slot 0, so it is a no-op for the seven single-seat stations. The hint reaches it because `_runCombatEntry` ([lcars-action-ring.js](scripts/lcars-action-ring.js)) spreads `actingActorId` onto the action object and `_handleQuickAction` passes that whole object down as each handler's trailing options argument (the pattern `create-trait` already used for `creatorActorId`). `resolveTurnCombatant` takes the same hint so the Major Action pip is spent on the right officer's row. The module is a leaf by necessity: `initiative-order.js` already imports `crew-manifest.js`, so this can live in neither.

**Role abilities.** Detect them with `findRoleAbilityTalent` ([combat/combat-definitions.js](scripts/combat/combat-definitions.js)), never with `detectNamedTalent` in [npc-roller.js](scripts/npc-roller.js) — that one uses the weaker local normalizer and misses the `"Role Ability: X"` / `"X (Role Ability)"` names that sheets and the sta compendium actually use. `findFlightControllerTalent` and `findNavigatorTalent` join the Chief Engineer / Chief Medical / Chief of Security finders there.

Two rules the role abilities in the roller depend on:

- **Flight Controller's +1 Momentum is an explicit toggle, not a heuristic.** `isFlightControllerPilotTask()` now only *seeds* the `#flight-controller-bonus` checkbox; `state.flightControllerBonusSelected` is a tri-state (`null` = untouched, fall back to the heuristic) and the ticked value wins. It was the gate, which silently dropped the bonus on `"Maneuver"`, on bare character-sheet Conn rolls carrying no task label at all, and on the `impulse`/`thrusters` keys that never reach `selectedTaskKey`. The row's visibility follows the discipline live, updated both by the `#officer-disc` change listener *and* explicitly in the combat-panel task-button handler — in `sheetMode` that element is a hidden `<input>`, so dispatching `change` on it is not an option (the shared handler would parse its non-existent `selectedOptions` and zero the target display).
- **Anything that cancels a complication must feed `complicationsIgnored()`,** the sole owner of that subtraction (Navigator's 1-Momentum buy-off is its only user today). **Five** sites total complications independently: `rollComplicationTotal` plus three inline recomputations in `npc-roller.js` (player card, weapon Resolve HIT, Post & Resolve) and one in `combat-hud-core.js`. Adding a sixth subtraction instead of extending the helper will desync the card from the dialog.

Bonus Momentum has the same shape of trap: it is summed independently in `npc-roller.js` (dialog summary, chat card, player card, weapon and post-roll tracker paths), in `combat-hud-core.js`'s confirm handler, and in `_opposedSideBonusMomentum` ([opposed-task.js](scripts/opposed-task.js)) — a new bonus-Momentum talent must be added to all of them.

### Zone System

Three-file system:
- [scripts/zone-data.js](scripts/zone-data.js) — data model, scene flag CRUD (`FLAG_KEY = "zones"`), geometry (point-in-polygon), BFS zone-distance calculation, range bands (Contact/Close/Medium/Long)
- [scripts/zone-layer.js](scripts/zone-layer.js) — `ZoneOverlay` PIXI rendering layer
- [scripts/zone-editor.js](scripts/zone-editor.js) — `ZoneEditState`/`ZoneToolbar` for hex stamp, polygon draw, flood-fill edit tools

Zones are stored as scene flags. The ruler measurement is patched in `main.js` to annotate distances with zone counts when `zoneRulerOverride` is enabled.

**Multi-zone tokens:** very large ships (Borg cubes, stations) can be flagged via a Token Config checkbox ("Occupies Multiple Zones", token flag `flags.sta2e-toolkit.multiZone`, injected by [scripts/zone-token-config.js](scripts/zone-token-config.js)). Flagged tokens test their full footprint rect against zone polygons (`getZonesForToken`) and may occupy several zones at once. Range is measured to the nearest occupied zone (`getZoneDistanceBetweenTokens`, multi-source BFS); weapon range checks and area-attack target filters use this. Hazards and movement remain center-based. Note: the hazard effect property `establishedEffects.multiZone` in zone-hazard.js is unrelated.

### Region Curve Tool

A **Curve** tool on the Regions toolbar, beside Polygon: click control points and
get a smooth closed outline that passes *through* every one of them, for the
curved viewscreen cut into a bridge map, a nebula boundary, a debris-field edge.
[region-spline-tool.js](scripts/region-spline-tool.js) is the whole feature;
[spline-geometry.js](scripts/spline-geometry.js) is the maths, a leaf with no
imports.

**Core's shape drawing is driven by data, not by tool name, and that is why this
is ~90 lines rather than a reimplementation of the Regions layer.**
`ShapeLayerMixin` branches on `interaction.shape.type === "polygon"` and seeds
the shape from `ui.controls.tool.shapeData`, so a tool declaring
`creation: true, shapeData: {type: "polygon", …}` inherits click-to-place, the
rubber-band point, right-click-to-undo-a-point, double-click-or-click-the-first-
point to close, Escape, vertex snapping, the Hole toggle and the
add-a-shape-to-the-selected-Region path for free. The module supplies only a
curve in place of the raw click list. Two facts from core make that safe: a
polygon shape's `points` has `min: 4` and **no maximum and no integer
constraint**, and polygon `_createControlHandles` emits only
translate/scale/rotate — never one handle per vertex, so a 60-point curve does
not litter the canvas with 60 handles.

Five things the implementation rests on:

- **`_updateDragPreview` is the only seam that matters.**
  `PlaceablesLayer#_commitDragLeftDrop` creates the document from
  `interaction.preview.document`, *not* from `interaction.shape`, and
  `_updateDragPreview` is the only thing that copies one into the other — so
  patching that single method covers both the live preview and what gets saved.
- **The patch SWAPS a splined stand-in in for the duration of the core call; it
  must never write the curve onto `interaction.shape`.** Core appends the next
  click to that same points array, so overwriting it destroys the control-point
  list after the first click. The raw shape is restored in a `finally`.
- **`_commitDragLeftDrop` needs its own patch, and only for one branch.**
  Drawing while a Region is selected takes core's multi-shape path, which writes
  `{shapes: preview.document.toObject().shapes}` — **shapes only, flags
  dropped** — so the stamped control points would vanish on the single most
  common way of adding a second curve.
- **The stamp is rewritten on every click, not appended to.** `_updateDragPreview`
  fires per click, and `raw.points` carries the trailing rubber-band point until
  `_onDragLeftDrop` slices it off and refreshes one last time. Each call pops its
  own previous entry, so the surviving stamp is the one made from the final
  control points.
- **Stored control points are matched back to a live shape by REGENERATING and
  comparing, never by shape index.** An index breaks the moment a shape is
  deleted or reordered. `sameOutline` tolerates a centroid offset, so a dragged
  Region still matches and the rebuild re-anchors the controls onto its new
  position; it deliberately does *not* tolerate the scale or rotate handles,
  where a transformed shape simply stops matching and reverts to being an
  ordinary polygon. The Region Config panel says so rather than failing silently.

The curve is a **closed centripetal Catmull-Rom** (alpha = 0.5), the same knot
spacing as `_catmullRomPoint` in [ship-vfx-anchors.js](scripts/ship-vfx-anchors.js)
and for the same reason — uniform spacing bows and overshoots on unevenly spaced
points, which hand-clicked points always are. It is duplicated rather than
imported: that module is heavy, its curve is *open*, and it works in `{x, y}`
objects where a Region shape wants a flat array. Two numbers worth knowing:
sampling is **adaptive** (spread by span length against `canvas.grid.size`, so a
map-wide span gets more points than one shorter than a grid square, capped either
side), and the Hermite tangents are **clamped to the shorter of the two chords
meeting at each point** — centripetal spacing removes cusps within a span, the
clamp covers the tight zigzags and near-duplicate clicks it does not. Measured:
six clicks on a circle give an outline within 2.5% of true, where a straight
hexagon dips 13%.

### Spawn Window

GM-only token spawning lives in one draggable LCARS console (`Shift+B`, DOM id `sta2e-spawn-window`) with a tab per spawner — **Transporter, Ships, Q**. [scripts/spawn-window.js](scripts/spawn-window.js) owns only the chrome: a gold bar across the top and the bottom, a **central control rail** rising between them that carries the tab keys and the tab's action keys, and a content column either side, under the module's usual floating-panel header strip (title + close, as `scene-warp-panel.js` builds it). The header and the top band are both drag handles, clamped via `hud-position.js`; the grabbing cursor is flagged on the root so whichever one was grabbed shows it. The header names the **window** and the artwork's title cap names the **active tab**, so neither repeats the other. **The two bands are not drawn in CSS.** Each is artwork (`assets/spawn-frame-top.svg`, `-bottom.svg`) worn as a `mask-image` with `var(--sw-primary)` painted through it — the same trick the bridge-station glyphs use in [lcars-action-ring.js](scripts/lcars-action-ring.js), and the reason hand-drawn chrome still recolours per era instead of needing one export per theme. Reconstructing those LCARS curves in `border-radius` was the wrong tool; every correction meant re-deriving geometry from a picture.

Four things that follow, all easy to break:

- **The art is an Inkscape document wrapping a transparent PNG.** There is no path in it to give a fill, so `currentColor` can never work on these files — and does not need to. A mask reads the alpha channel and ignores colour, so the export is used exactly as it comes out of Inkscape. Do not "fix" the files to be tintable.
- **The mask is on `::before`, not on the band.** A mask clips an element's children too, and the top band's children — the title label and the stardate — sit in the gap the artwork deliberately leaves in its bar (`x 730..880`), where the mask is transparent. Masking the band itself erases them.
- **The column positions come from the art, not the other way round.** They were measured out of the PNG's alpha: left column `0..421`, rail `426..495`, side column `500..532`, right column `537..899` at the 900px width the art was drawn for. The left column is therefore a **fixed** `--sw-col-left`, not a `1fr` twin of the right — the painted rail is not centred, and two equal fractions put the keys ~30px off it. Re-exporting the art means re-measuring these.
- **`--sw-rail-stack` and `--sw-rail-side` need `min-width: 0`.** They are flex items, which default to `min-width: auto`, so the longest unbreakable label (`TRANSPORTER`) propped the stack open past `--sw-rail-w` and shoved the side column off the painted rail. That 70px rail is also why tab keys carry no icon.

`--sw-top-h` / `--sw-bottom-h` must match the art's viewBox height (84 for both), and `--sw-cap-*` / `--sw-meta-right` the slot it leaves for the title. Each tab registers a descriptor with `registerSpawnTab({ id, label, icon, meta, styles, buildHTML, wire, onActivate, buildActions })`; panels stay mounted and toggle with `hidden`, so every queue survives a tab switch. Rail tab order is the import order in `main.js`. `openTransporter()` / `openShipSpawner()` / `openQSpawner()` are thin wrappers that open the window on their tab, so old call sites (toolkit widget, Combat HUD Beam button) are unchanged.

Shape lives in [styles/spawn-window.css](styles/spawn-window.css) and markup helpers in [scripts/spawn-chrome.js](scripts/spawn-chrome.js) (`swColumns`, `swPanel`, `swGrid`, `swField`, `swSelect`, `swInput`, `swKey`, `swDeco`) — the same **shape in CSS, colour inline** split the card stylesheets use. All three tabs emit only `.sw-*` classes; there is no per-tab skin and no per-era bespoke stylesheet, only `[data-theme]` blocks tuning radii and two decorative colours. Two rules the renderers must keep: **no inline `border-radius` and no inline `display`** (inline beats any selector and would put the element out of reach of those blocks), and the one colour a caller may set inline is the accent, on the single custom property **`--sw-a`**.

Four things the chrome depends on:

- **`buildHTML()` must return exactly two children** — `.sw-col--left` then `.sw-col--right` (use `swColumns()`). The chrome injects its rail *between* them, so the panel is the three-column grid. The alternative — chrome-owned column containers — would hand each tab two disjoint roots and break every `panel.querySelector` in the three tab files.
- **`buildActions()` returns an array of `.sw-key` elements and must not emit a Close key** — the chrome appends one to every rail itself. `api.refreshActions()` rebuilds them (it is what the transporter and Q call after a buffer change).
- **The height cap is on `.sw-body`; the scrolling is strictly inside `.sw-col`.** The rail is a grid sibling of the columns, so it stretches to full body height for free. Putting `overflow` on `.sw-body` or on the panel would scroll the rail away with the content — the problem `task-maker.css` paints its spine as a background to avoid.
- **There is no `width` on the descriptor.** One `--sw-width` for every tab is what stopped the window jumping on a tab switch.

**All panels are mounted at once**, so anything shared must be addressed by class within a scope element, never by document id. Each panel also carries **its own rail**, so the tab keys exist once per panel — which is why `activate()` sets `.is-active` across every rail rather than just the visible one.

Placement is shared: [scripts/spawn-picker.js](scripts/spawn-picker.js) has the canvas pickers (`awaitCanvasClick`, `pickFormationCentre`, `pickIndividualCentres`, `pickHeading`, `centreToTopLeft`) and PIXI v7/v8 shims. `pickSpawnCentres()` is the whole Spawn Location branch in one call — pads, region fill, or click — and is what a tab should use rather than reimplementing it. **Everything works in centre points**; `centreToTopLeft` plus `protoHalfSize` converts to the top-left a TokenDocument wants. Formation geometry stays in `spawn-patterns.js`. The drag-actors-in queue widget is [scripts/spawn-queue.js](scripts/spawn-queue.js) and the hold/restore buffer is [scripts/spawn-buffer.js](scripts/spawn-buffer.js), keyed by setting so the transporter's pattern buffer and Q's hold buffer never share state.

**Spawn Location** has three kinds, parsed by `parseLocation()` in [scripts/spawn-regions.js](scripts/spawn-regions.js) and offered by the shared `buildLocationOptions()`:
- `canvas` — click to place, `[Q]` cycles pattern.
- `pads:<group>` — **one token per Region flagged as a spawn marker.** Regions are flagged in their own config (`flags.sta2e-toolkit.transporterPad`, with an optional `flags.sta2e-toolkit.padGroup` name), injected by [scripts/region-pad-config.js](scripts/region-pad-config.js) using the same native-form-path trick as `zone-token-config.js`. Markers are used in natural-sorted Region-name order ("Pad 1".."Pad 10"), unnamed ones last. All or nothing: fewer markers than queued tokens is an error that places nobody. Never grid-snapped — the marker is where the GM drew it.
- `region:<id>` — fill one Region's grid spaces, centre-outward, footprint-checked. Grid-snapped. Pad-flagged Regions are excluded from this list.

**Q tab** ([scripts/q-spawner.js](scripts/q-spawner.js)) is the transporter without the in-fiction limits — no six-pattern cap, no emitter types — plus a **Q Flash Move**: select tokens, click once, and the whole group is translated by one offset, keeping its shape. The actions that operate on tokens already on the canvas — Flash Move, **Flash Kick**, Snap Out + Hold — live in [scripts/q-actions.js](scripts/q-actions.js) rather than the tab, because the Token HUD needs them too ([scripts/q-hud.js](scripts/q-hud.js), GM-only, **no actor-type gate** — unlike the ship command HUD it appears on every token). `resolveQTargets(token)` is the shared rule for what they act on: the current selection when the HUD's token is part of it, otherwise just that token.

**Q Flash Kick** throws tokens across the scene: the flash fires *behind* them (opposite their heading), then they lurch away, tumble, fade, and land as far along that heading as the scene rect allows. Aim comes from `game.user.targets` if anything is targeted, otherwise `pickHeading`. Two rules the implementation depends on, both easy to break:
- The flight is a stream of `document.update` waypoints, so **it needs no socket action** — Foundry replicates position, rotation and alpha to every client itself. Only the flash and screen wash broadcast, and they do that themselves.
- Intermediate waypoints carry `sta2eScriptedMove: true` and **the final one deliberately does not** — [main.js:2542/:2572](scripts/main.js) skips zone BFS, cover and movement-log work on flagged updates so it all runs exactly once, at the landing point.

Spin is floored to whole turns and clamped so no single waypoint rotates more than ~150°, because Foundry tweens rotation along the shortest path and a larger step visibly spins backwards. The token lands at its **original** rotation — the tumble is theatre, not a change of facing. Its look is [scripts/q-vfx.js](scripts/q-vfx.js): a white screen flash (broadcast as `qSceneFlashVfx`, scene-guarded) plus the `qFlash` warp style at each token. The screen flash is deliberately **a DOM overlay sibling to `#board`, not a PIXI object** — inside the canvas it would be composited under lighting, weather and overhead tiles, and would stop at the scene edge when zoomed out. As a sibling of the board canvas it covers the viewport at any zoom and still passes under Foundry's UI chrome. It animates with a CSS transition, so it needs no animejs. That style carries two fields no other style uses — `hidden` keeps it out of every style picker (`getWarpEffectStyleOptions`, the Ship Spawner's Arrival Effect list), and `whiten` makes `_webmFlash` desaturate the clip, because sprite tint multiplies and so cannot turn the blue warp flash white. All Q timing comes from `getWarpFlashTiming("qFlash")`, never the `WARP_*_MS` constants. Its sounds and flash size are tuned in **Settings → Sounds & Animations → Q** ([effect-config.js](scripts/effect-config.js) `qSpawner` tab); every sound row in that menu has a ▶ button that auditions the typed path locally. The Q panel emits only the shared `.sw-*` classes and registers no styles of its own.

### Travel Environments

**What the ship is flying through**, shared by the Warp Viewscreen and Scene Warp
below. [viewscreen-environments.js](scripts/viewscreen-environments.js) is a
frozen registry modelled on `WARP_EFFECT_STYLES`. Five **volumes** you fly
through — `warp`, `nebula`, `ionStorm`, `asteroid` — four **tunnels** you fly
down — `transwarpConduit`, `slipstream`, `wormhole`, `subspaceVortex` — and
`static`, a screen state. The tunnels and `static` are viewscreen-only: a vortex
is something you look *down* and TV static on a tactical map means nothing.

**Neither camera changed to make this possible, and that is the point.** A
particle at `(x, y, z)` marching toward the near plane and projecting to
`vp + (x/z, y/z) * FOCAL` describes flying through a cloud bank or a rock field
exactly as well as it describes warp, and Scene Warp's depth bands are the same
story from another angle. What differs is the *material*: texture, blend mode,
whether it smears, whether it grows as it approaches, whether it tumbles, how
many. So an environment is a table entry, not a code path.

Five rules the registry lives by, all easy to break:

- **It imports nothing, and must not start.** The panels read labels without
  pulling PIXI into a DOM module, and [scene-warp.js](scripts/scene-warp.js)
  carries an environment id while staying the leaf the weapon-firing path needs.
  Textures are named by **string key**; each renderer owns its own key-to-builder
  switch, which is what keeps the table free of PIXI.
- **Every particle number is a MULTIPLIER over the renderer's own tuned constant,
  never an absolute.** The viewscreen's `WARP_STRETCH` is 8 and Scene Warp's is
  6.5 for a documented reason; a descriptor supplying an absolute flattens that
  distinction. `stretchMul: 1` means "whatever this surface already decided".
- **`warp` is the identity element.** Every multiplier 1, `defaults` equal to the
  pre-existing schema initials. A viewscreen or scene that has never heard of
  environments must render exactly as it did before. This is verifiable: drive
  both renderers against a `git worktree` of the previous commit under a seeded
  PRNG and diff the sprite tree. Doing exactly that is what caught `warp` gaining
  a haze blob, a wash and a flash sprite on the Scene Warp surface.
- **`stretchMul` and `tumbleDeg` are mutually exclusive.** A sprite has one
  rotation and the two want it for different things — a smear points along the
  direction of travel, a tumble spins about the particle's centre. Both renderers
  branch on `stretchMul > 0` and honour exactly one, so an entry setting both
  silently loses its tumble.
- **Clouds are procedurally textured, not gradient stacks.** `buildCloudTexture`
  lays overlapping soft lobes (a single radial gradient reads as a glowing ball —
  a light source, not a volume of gas) and then **carves fBm noise through the
  alpha**. The lobes alone are smooth, and a smooth blob scaled to a couple of
  hundred pixels is a thumbprint on the lens; the noise is what cuts the
  filaments and density variation the eye actually reads as gas. `contrast` is
  the exponent on it — raising it thins the sparse regions faster and leaves
  ragged wisps, which is most of the difference between `cloud` (nebula) and
  `stormCloud` (ion storm). ~5 ms per texture, ~20 ms for a set of four, one-off
  at attach. `getImageData` is wrapped — a tainted or stubbed canvas falls back
  to the lobes rather than failing to build.

- **Three separate things made clouds read as "rotating noise discs", and all
  three had to go.** Worth knowing, because each is easy to reintroduce:
  1. **The rim guard was doing the shaping.** It started at 0.55 of the radius,
     which forced the alpha onto a circular falloff whatever the noise did. It
     now starts at 0.88 and exists only to stop a square edge; the silhouette
     comes from the lobes and the noise.
  2. **Circular lobes.** However irregular their arrangement, a pile of circles
     still has a roughly circular hull, so `_blob` draws each one **elliptical
     and freely rotated**, and the angles are stratified so a few lobes cannot
     all land on one side.
  3. **Rigid-body spin.** Gas does not rotate as a solid, and the eye knows it —
     `tumbleDeg` went from 8/14 to 1.8/3.2, slow enough to register as drift.
     What replaces it is `aspect` (per-particle area-preserving eccentricity,
     rolled at seed) and `churn` (a slow billow on alpha and one scale axis).

  Lobe layout was **swept, not guessed** — `spread`, `lobeMin/Max` and `lobes`
  are exposed as options for exactly that. The trade is raggedness against
  coverage: scattered lobes are lumpy but break into separate puffs, tight ones
  fill the sprite and merge into a disc. The current values hold ~30% coverage at
  ~20% off-round for the nebula and ~21% at ~49% for the storm. Coverage matters
  more than it sounds: an early version reached only 0.72 of the radius and,
  after the noise ate the faint tail, covered ~15% of the texture — so every
  cloud rendered at roughly a third of its configured size, with the rest paid
  for as transparent fill.

- **`features` is the most important number in the cloud, and it is a cell count,
  not a frequency.** `_fbm` samples a 64-cell lattice, so passing a plain
  frequency of 1 spans all of it and puts the coarsest feature at 192/64 =
  **three pixels**, with every later octave below the pixel grid contributing
  nothing but grey. That is not cloud structure, it is speckle, and it is exactly
  what "too tightly compact" looks like. `features: 3` gives octaves of 64/32/16/8
  px — an actual fractal spread. The domain warp has to be coarser still (~2
  blobs across the sprite) or it jitters each pixel independently and adds grain
  rather than shearing anything.

- **The field's brightness is measured, not eyeballed.** `saturation.mjs` in the
  scratchpad sums every sprite's `alpha x on-screen area x its texture's own fill
  factor` over the region area, giving a mean additive alpha — roughly how many
  full-strength layers stack on a pixel. Under ~0.2 reads as too thin, over ~1.0
  saturates into a flat wash. Nebula sits at ~0.6, the storm at ~0.2 (it has
  lightning and a wash on top). This is worth re-running after any change to
  count, size or alpha, because the intuition is bad: the first saturated build
  measured 2.5, and **96% of it was the haze, not the clouds** — the haze sizes
  from the region's long edge, so a `scale` of 1.5 meant single blobs over 2000px
  wide on a 1150px viewscreen, while the clouds underneath contributed 0.07 and
  were effectively invisible. Only `warp` still uses a big-blob haze, and that is
  the deliberate single static sprite it has always had.

- **Trade cloud count for alpha, not the reverse.** Overdraw cost is the sprite
  *rect*, not the light it emits, so fewer brighter clouds give the same reading
  for measurably less fragment shading. The fill factor barely responds to the
  noise settings (the lobes limit it), so `alphaNear` and `sizeMax` are the real
  levers on visibility.

- **A tunnel is a seeding shape, not a camera.** Transwarp conduits, slipstreams
  and wormholes are not volumes you fly through but **walls wrapped round the
  axis** — and the pinhole camera draws one with no changes at all. Seed `(x, y)`
  on a ring instead of in a box and with `r` fixed while `z` falls, the projected
  radius `r * FOCAL / z` grows: the wall rushes outward past the viewer and the
  untouched centre is the hole you look down. The smear, recycle, depth fade,
  palette and pooling all carry over, and the smear runs along the direction of
  travel, which for a ring *is* the radial direction — so wall striations fall out
  free. `shape` defaults to `"box"`, which is what keeps every environment that
  predates tunnels untouched; the identity A/B proves it.

  Four things the tunnels rest on:
  - **The aperture is the phase ramp.** `open = APERTURE_MIN + (1-APERTURE_MIN) *
    ramp` scales the whole tube radius, so entering blooms it out of a point and
    dropping out collapses it — with no new document field, no timer and no
    socket, and a client joining mid-transit lands at the right dilation like
    everything else here. `APERTURE_MIN` is **not** cosmetic: at a true zero the
    entire pool projects onto one pixel and a few hundred additive sprites stack
    into a blinding dot. The layer alpha fades with the ramp for the same reason.
  - **`swirl` rotates the CONTAINER, never the sprites.** A sprite's one rotation
    is already claimed by the smear — the same conflict that makes `stretchMul`
    and `tumbleDeg` exclusive. A container roll is one property write per frame
    *and* correct: a child at local `P` with rotation `angle(P̂)` maps to world
    `angle(P̂) + R = angle(R·P̂)`, so every streak stays radially aligned as the
    wall turns. It pivots on the vanishing point (pivot == position is identity),
    set on attach/refresh rather than per frame, and a box environment resets the
    transform so switching away from a tunnel cannot strand the pool rolled over.
  - **`depth` is resolved before the projection**, because the flare needs it. For
    a box environment the multiplier is exactly 1 and the projection is unchanged.
  - **Watch `ENV_POOL_MAX`.** It clamps at 400, and a tunnel wall wants to read as
    continuous, so `density * countMul` can easily exceed it — at which point the
    cap silently swallows the GM's Wall Density slider *and* any retuning of
    `countMul`. Two of the four were clamped when first tuned, which is why
    lowering their counts changed the measured brightness by nothing at all. Keep
    every environment's product under 400.

  - **A conduit wall is thick vapour, not a bundle of hairlines.** The first pass
    drew crisp striations against black and read as wire. The reference look is
    broad luminous plumes with brighter threads *in* them and haze filling the
    volume between — so the two conduits take the `wisp` texture (a soft body with
    a bright spine, broken into filaments by fBm), triple their `wall` depth, and
    switch their ambient haze on. Plumes carry far more light than hairlines: the
    wisp's fill factor is ~0.13 against the cloud's ~0.046, which put both
    conduits over 1.0 and flat until their cross-section and alpha came down.
    Brightness is trimmed by **size and alpha, never by count** — fewer plumes
    breaks the wall's continuity, which is the thing that reads as a tunnel.

  What separates a tube from a box, measurably, is the **ratio of the closest
  projected particle to the median** — boxes 0.02–0.09, tubes 0.20–0.35, with no
  overlap. A tube cannot seed anything near its own axis, so its floor stays a
  real fraction of its median; a box seeds right through the middle. The ratio is
  scale-free, which matters: two earlier metrics both had to be thrown away.
  Counting particles near the centre fails because perspective crowds any wall
  inward — once the conduits gained thick walls their near-centre density
  overtook the nebula's outright. An absolute pixel floor fails because it is
  calibrated to one wall thickness. Pool the samples over several attaches, too:
  a 67-particle snapshot is noise.

- **`speedMul` is the only lever on longevity.** A particle's whole life is one
  traversal of the depth range, so nothing else changes how long it stays on
  screen. Clouds run at a third of the star speed and therefore last three times
  as long — at parity they flicked past and never read as volume at all.
  Honoured by both surfaces (the viewscreen scales `envSpeed`, Scene Warp scales
  the band `step`).
- **The ion storm is cells, not particles.** It drew a field of small fast motes
  first and that was wrong: a scatter of discrete dots reads as confetti rather
  than weather, and it left the bolts flashing over nothing. Cells give the
  lightning something to be *inside*, and the storm's violence then shows as
  churn and contrast rather than as count. Its glow is 0.8, not the motes' 1.2 —
  a big additive sprite under a strong glow blooms into a flat wash and loses
  exactly the structure the texture just bought. The `mote` texture key is still
  supported with no current user.
- **`haze.surfaces` exists on `warp` and nowhere else.** That blob *is* the
  viewscreen's old `_syncNebula` sprite, reproduced exactly (count 1, driftRate
  0, 0.2 alpha, 1.7× the long edge); the top-down field never had one, so drawing
  it there smears lilac over every map that only ever asked for plain warp. Every
  other environment omits the key and is hazy from both angles.

**The thirteen look fields are reused and relabelled, not duplicated.** `density`
reads "Cloud Density" under a nebula and "Rock Count" in an asteroid field, via
`environmentFieldLabel`. That is what keeps the schema and both panels from
tripling. Only five fields were added: `environment`, `intensity` (how strongly
the environment asserts itself — pool size, haze, wash, storm violence, static),
`starMix` (how much of the ordinary starfield survives behind it), and the two
overlay fields `interference` and `lightning` (below).

**Two capabilities are overlays rather than environments,** and they share one
shape: a thing an environment can own *intrinsically* or have switched on over
it by a 0–100 field. Both resolve through a helper returning a single
`{ spec, strength }`, so no renderer branches on which source is in play, and in
both cases **the environment's own always wins** — the field is *ignored* rather
than compounded, and the panels hide it there.

| field | helper | shared spec | owned by |
|---|---|---|---|
| `interference` | `environmentGrain` | `INTERFERENCE_GRAIN` | `static` |
| `lightning` | `environmentStrobe` | `IONIZED_STROBE` | `ionStorm` |

`static` answers "the screen is dead" and `interference` answers "the screen is
breaking up *while* something else is on it". `ionStorm` answers "this is a
storm" and `lightning` answers "this place is charged" — an ionized nebula, a
charged debris field. Naming each spec once and having the owning environment
reference it is what stops the two copies drifting: lightning in a nebula at 100%
is exactly the storm's lightning, over a nebula. The strike takes its colour from
the environment's accent, so violet lightning in a violet nebula falls out free.

Both fields are **live look fields**, so their layers build on first need rather
than at attach — the grain sprites from `_syncGrain`, the bolt pool from
`_tickStrobe`, and on Scene Warp the whole discharge from `_ensureStrobeLayers`.
Neither may cost a reattach, and neither breaks the create-once rule: the parent
containers are made up front and never move, so appending to them reorders
nothing. `strength` scales flash alpha, shake *and* strike rate together, so one
control is one idea.

Four more things interference rests on:

- **`environmentGrain(env, interference, intensity)` resolves both sources to one
  `{spec, strength}`,** so no renderer branches on which of the two is in play —
  and the environment's own grain always wins, which is what makes the field
  *ignored* on Signal Loss rather than compounded with it.
- **The grain sprites are built lazily, on first need.** Interference is an
  ordinary look field draggable off zero at any time, unlike an environment
  change, which forces a reattach. This does not violate the create-once rule:
  the sprites go inside `grainLayer`, which *is* created up front and never
  moves, so appending to it can reorder nothing.
- **It suppresses the dark gate.** A GM who has deliberately broken the screen
  wants to see it break, not see it switched off because the ship is parked with
  drift off — the same argument as `restAmbient`, from the other direction.
- **The hiss needs its own loop slot.** `_loops` is keyed `uuid|slot`
  (`env` / `interference`), because a screen breaking up at warp should hiss
  *over* the warp rumble rather than instead of it. Keyed by uuid alone — as it
  was while Signal Loss was only ever its own environment — starting one silently
  orphaned the other, leaving a sound playing with no handle to stop it. A phase
  change stops only the `env` slot: a broken screen does not un-break because the
  ship slowed down.

**Changing environment is structural** — it swaps textures, blend modes and which
layers exist — so both renderers take the one branch that reattaches wholesale
rather than keeping a list of which fields matter. Both attach functions are
already idempotent, which is what makes that a single line. The **panels** write
the environment's `defaults` in the same update as the id, so picking one gives a
tuned look; the behavior sheet's raw dropdown deliberately does not, and a Reset
to Environment Defaults button covers that case.

**Sounds are generated from the table**, so adding an environment is a one-file
change: `settings.js` registers three keys per entry and `effect-config.js`
builds three rows, both by walking `ENVIRONMENT_ORDER`. `warp` names the three
keys that predate the table (`sndWarpViewscreenEnter/Exit/Loop`) so nobody's
configured audio breaks, and every other environment falls back to them when its
own slot is blank. Scene Warp still has no sounds of its own.

`restAmbient` means an environment keeps running at ramp 0 with drift off — a
storm does not stop crackling when the engines do. **It is honoured on the
viewscreen and deliberately not on Scene Warp**, where it would mean a scene
merely *configured* for a storm never releasing its ticker; there, `drift` is how
a GM asks for persistence.

### Warp Viewscreen

A starfield that plays **inside a Region's outline**, so a viewscreen or window painted into a bridge map can show warp. The GM drives the three beats — enter warp, stars streaming by, drop out — from a floating panel. It also draws the other travel environments above; the type id stays `sta2e-toolkit.warpViewscreen` (changing it would orphan every existing behavior), only the display label in `lang/en.json` broadened to "Viewscreen".

**The layers are sub-containers, and the two particle pools have one each.**
Bottom to top: `backdrop → haze → stars → environment → wash → grain → bloom`.
Before that, star sprites were appended straight onto the root and only landed
above the fixed layers by accident of call order; with a container each, a pool
resizes without any re-append reordering anything — which is the create-once,
toggle-`visible` invariant made structural rather than merely observed. Two
consequences: the **GlowFilter moved off the root onto the star layer** (an
asteroid field draws on normal blend and must not be glowed, and a root filter
would catch it), and the **wash sits above both pools**, because painted
underneath it would tint the backdrop and nothing else.

The **shake** is one term at the projection (`vp.x + shakeX`), decayed
exponentially in `dt` and only ever *set* by a lightning strike, never added to,
so repeated strobes cannot accumulate.

**Lightning** is the ion storm's `strobe.bolt` block, drawn by both renderers.
One strike is a discharge glow and one to three bolts sharing a single strike
point, so the flash always sits *on* the lightning. Five things it rests on:

- **`buildLightningPath` displaces sideways rather than subdividing.** The
  classic fractal midpoint method spends its detail at scales too small to see
  once a bolt is two pixels wide, and is far harder to keep in a vertex budget.
- **The displacement tapers to zero at both ends** (`sin(t·π)`). Without it the
  endpoints wander off the line they were asked to connect, so a bolt aimed at
  the flash visibly misses it — the detail that stops it reading as lightning.
- **A bolt is a chord *through* the strike point, not a line ending at it,** so
  it enters and leaves frame like something arcing past rather than terminating
  politely on screen. The mask clips the overshoot for free. Scene Warp uses a
  much shorter chord relative to its frame (0.28 of the diagonal against the
  viewscreen's 0.75) — scaled to a scene rect, a bolt reads as a crack across
  the whole map instead of weather somewhere in it.
- **Two stroke passes, wide-soft then thin-bright,** the same construction
  `engine-trail-vfx.js` uses. A single stroke reads as a drawn line; the pair
  reads as something incandescent.
- **Redrawn per *strike*, never per frame.** Between strikes the Graphics are
  hidden, and the flicker moves the container's alpha rather than re-tracing any
  path, so a storm costs a redraw a second or two rather than sixty. On Scene
  Warp that matters more, since its tick is on the critical path for the map.

`strokePolyline` in [starfield-common.js](scripts/starfield-common.js) is the
shim (v7 sets the line style *before* the path, v8 strokes it *after*, the same
inversion `gFillRect` handles). **Round caps and joins are load-bearing, not a
nicety** — a bolt is short segments meeting at sharp angles, and mitred joins
spit visible spikes out of every one. `spawn-picker.js`'s `stroked` is the better
shim but drags lcars-theme and spawn-patterns in with it, far too much for a
per-frame renderer. `strobe.bolt` is optional: an environment wanting only the
flash omits it. The **static** layer is two grain sprites
stacked one above the other so the rolling tear is seamless without a
`TilingSprite`, whose constructor signature changed between PIXI v7 and v8; the
scanline texture is baked at the region's own height so a plain horizontal
stretch is exact, and is separate from the noise frames because scanlines must
not flicker.

This is the module's **only `RegionBehaviorType`** ([scripts/warp-viewscreen-behavior.js](scripts/warp-viewscreen-behavior.js)). Core's `RegionBehaviorConfig` builds the whole sheet from `defineSchema()`, so **there is no `.hbs`** — labels and hints are literal strings in the field options. It deliberately omits `_createEventsField()` (it never reacts to token movement), which suppresses the sheet's "Subscribed events" fieldset. `TypeDataModel.schema` sets `name = "system"`, so schema fields render as `name="system.vanishX"` — that is what lets the injected **Set Vanishing Point** button write into the native inputs and rely on ordinary form submission, the same trick `region-pad-config.js` uses.

**Registering a document subtype takes three things that must agree, and two of them are not JavaScript.** `Document.TYPES` reads `game.model`, which the *server* assembles from package manifests — so `CONFIG.RegionBehavior.dataModels` alone leaves the type absent from the Add Behavior dropdown with no error anywhere:

1. `module.json` must declare `documentTypes.RegionBehavior.warpViewscreen` — and **the manifest is only re-read when the world is launched**, so a browser reload will not pick this up.
2. The server namespaces it, so the type id is **`sta2e-toolkit.warpViewscreen`**, not the bare name. `VIEWSCREEN_TYPE` and the `CONFIG.RegionBehavior.*` keys must all use the namespaced form.
3. `typeLabels` must hold an **i18n key, not a literal string** — `createDialog` does `game.i18n.has(label) ? localize(label) : type`, so a plain string silently falls back to printing the raw type id. The key is `TYPES.RegionBehavior.sta2e-toolkit.warpViewscreen` (what core's own localization pass would derive), with the hint at `TYPES.HINTS.RegionBehavior.…`.

`registerWarpViewscreenBehavior()` checks `TYPES` after registering and warns if the manifest side did not take, rather than leaving a silently missing menu entry.

Three rules the implementation depends on:

- **No socket action anywhere.** The GM writes `phase`/`phaseAt` to the behavior and Foundry replicates the document update itself, the same reasoning as Q Flash Move. It also gives correct state on reload and for a player who joins mid-warp, which a one-shot broadcast cannot.
- **`phaseAt` is a wall-clock stamp, and each client derives its own ramp position from it.** Nobody writes a second update to end a ramp: `entering` settles into `cruise` and `exiting` into `idle` locally, from elapsed time. Anything that labels a button must use `effectivePhase()`, not the raw stored `phase`.
- **Sounds play locally in the `updateRegionBehavior` hook, never broadcast** — every client already receives the update, so broadcasting would double every cue. The warp loop is also (re)started on `behaviorViewed`, because a client arriving mid-warp sees no phase update.

The renderer ([scripts/warp-viewscreen-vfx.js](scripts/warp-viewscreen-vfx.js)) is a pinhole projection: a star holds `(x, y, z)` and projects to `vanishingPoint + (x/z, y/z) * FOCAL`, so the stretch and the forward/rear reversal fall out of the maths rather than being faked. Stars are **sprites sharing one generated gradient texture** (transform-only updates), not a `Graphics` redrawn each frame. The mask is a `PIXI.Graphics` filled from `regionPolygons()` — a core `RegionMesh` is not a reliable PIXI mask. Config is re-read from `behavior.system` every tick, so a slider drag is live for everyone with no re-attach; only pool size, palette, layers and the vanishing point need `refreshViewscreen()`.

What makes it read as warp rather than as moving dots, in rough order of impact:

- **Per-star colour.** A single tint looks like wallpaper. `_buildPalette()` mixes the base and accent hues into `PALETTE_SIZE` colours — mostly cold white-blue, some hot white cores, a `variety`-controlled minority pulled to the accent. A star takes one at seed and on every recycle, so **tint is never written per frame** (the setter converts a colour on each write, which across a thousand stars is not free). The container `GlowFilter` is deliberately weak: it carries one colour, so leaning on it flattens the per-star hues back out.
- **Hairline thickness.** Nearness shows as brightness and length, never as width. `STREAK_MIN_THICK`/`MAX_THICK` are the far/near ends at a Thickness of 100% (~1px, what a trailed star actually looks like); the setting scales the whole range rather than just the near end, so a thin or fat field keeps the same slight sense of depth. Below 100% streaks go sub-pixel and read as fainter rather than thinner, which is why the field floors at 50%.
- **Density.** 600 by default; a couple of hundred reads as sparse.
- **`WARP_STRETCH` and the `maxLen` clamp**, both tuned by measuring the length distribution rather than by eye. At 8, warp 6 puts the 90th percentile near a fifth of the viewscreen width; higher values produce full-width streaks that read as rain.
- **Spread** — how wide an area stars emerge from. Implemented by moving the **near plane** (`Z_NEAR_MIN`..`Z_NEAR_MAX`), not by scaling the seed box: the box is sized so the near plane lands exactly on the cull radius, which makes the birth area `radius * zNear / Z_FAR`. Scaling the box instead would widen the birth area but fling stars past the cull radius long before they reached the near plane, so most of the pool would live its life off-screen. Speeds are scaled by the depth range so traversal time stays constant across the setting — though a wider spread *does* lengthen the average streak, since more of the field sits where apparent motion is fastest. At spread 0 about 60% of stars bunch within 6% of the radius of the vanishing point; the 30% default drops that under 10%.

The enter/exit **starburst** (`flash`) is the one look option that is **opt-in rather than opt-out** — it was removed once for being intrusive and then restored as a toggle, so its schema default is `false` and `_readConfig` tests `s.flash === true` rather than `!== false`. Like the backdrop and nebula it is built once in `_buildLayers` and driven by `visible`/`alpha`; the original lazily `addChild`ed it on first flash, which meant a later star-count increase appended sprites over it. Going dark mid-burst calls `_clearBloom()`, since the tick returns early while hidden and would otherwise leave it frozen half-lit and show it again on the way back.

Four traps worth keeping in mind:

- **`Number(null)` is a finite `0`**, so nullable fields must go through `numOrNull()` — testing `Number.isFinite(Number(v))` silently pins an unset vanishing point to the canvas origin instead of the region centre.
- With `sublightDrift` off the container is **hidden**, not merely stopped, or the viewscreen shows a frozen starfield instead of going dark. Coming back from hidden clears every star's `px`/`py`, or the first lit frame draws a full set of clamped streaks.
- The backdrop and nebula are built once and toggled with `visible` — **never created and destroyed on option changes**, which would re-append them above the stars and need child-index juggling that differs across PIXI majors.
- `variety` scales the accent wash on *non*-accent stars too, so 0 is genuinely the base hue rather than faintly contaminated by it. Brightness still varies at 0 — that is depth, not decoration.

Sounds and ramp timings live in **Settings → Sounds & Animations → Viewscreen** ([effect-config.js](scripts/effect-config.js) `warpViewscreen` tab). Unrelated to `warp-jump-vfx.js`, which is the ship's own jump on the map.

### Scene Warp

The whole tactical map at warp: parallel star streaks running across the scene on
a course the GM sets, every ship holding a bow-forward formation heading, and
weapons firing without slewing to face their targets. Driven from a GM-only
floating panel (`Shift+W`, or the toolkit widget's Scene Warp button).

Distinct from the two things it sits between: the **Warp Viewscreen** above is the
*forward* view clipped to a Region, and `warp-jump-vfx.js` is one ship's jump *to*
warp. This is the sustained state of being there.

[scene-warp.js](scripts/scene-warp.js) owns the state — one scene flag,
`flags.sta2e-toolkit.sceneWarp`. It **imports nothing on purpose**: both
[weapon-configs.js](scripts/weapon-configs.js) and
[native-weapon-vfx.js](scripts/native-weapon-vfx.js) consult it from deep inside
the firing path, so it has to stay a leaf, exactly as
[actor-faction.js](scripts/actor-faction.js) does. It carries the viewscreen's
three rules verbatim and for the same reasons — **no socket action** (the Scene
update replicates itself, which is also what gives a player joining mid-warp the
right picture), **`phaseAt` is a wall-clock stamp** each client ramps from, and
anything labelling a button reads `effectiveScenePhase()` rather than the stored
`phase`. `isShipActor` here is the **widest** of the codebase's several ship
tests; do not add a fourth ([main.js](scripts/main.js)'s copy misses
`spacecraft2e`).

**The renderer** ([scene-warp-vfx.js](scripts/scene-warp-vfx.js)) is two nested
containers, and everything follows from that: an **outer** in canvas space masked
to `canvas.dimensions.sceneRect`, and an **inner** rotated to the course, in whose
local space the stars live. Stars advance along local **+Y only** and wrap by
modulo on that one axis. That buys correct wrapping at any angle (advancing along
a canvas-space vector instead means wrapping a diagonal band through an
axis-aligned rect, which gaps along two edges), no per-star `atan2` — every streak
points the same way locally, so `sprite.rotation` is a constant — and a course
change as one tween of `inner.rotation`, whose sweep of the star pattern around
the scene centre is what reads as banking onto a new heading. The rotation is
simply **the compass course in radians**: a container rotated by θ maps local
(0,1) to (−sin θ, cos θ), and setting that equal to `starFlowVector(course)`
reduces to θ = course.

Four things the look rests on:

- **Depth bands, not one field.** Far/mid/near differ in speed, length, alpha and
  thickness; a sparse fast **fourth band draws over the tokens**, which is the
  parallax. It lives in a *separate outer container* at a positive zIndex — it
  cannot sit inside the same z-sorted parent as the others.
- **Tint and alpha are written at seed and on recycle, never per frame.** Both are
  constant for a star's life, and the tint setter converts a colour on every
  write. Length and thickness are band-constant, so they resolve to one scale pair
  per band rather than going through the `width`/`height` setters per sprite.
- **`WARP_STRETCH` is 6.5, lower than the viewscreen's 8** — a top-down field is
  seen broadside, where the same multiplier gives visibly longer lines than
  head-on. Measured rather than eyeballed: at warp 6 the near band is ~11% of the
  field span and the `MAX_LEN_FRAC` clamp only binds on the foreground band at
  warp 8+, so streaks are not uniformly max-length (which reads as rain).
- **No backdrop fill.** Unlike the viewscreen this overlays your map art, so there
  is no `_syncBackdrop` equivalent, and `drift` is opt-**in** rather than opt-out —
  a scene merely *configured* for warp must not lay drifting stars over a normal
  encounter.

**The heading lock is absolute**: ships translate bow-forward and never turn. The
movement runners in
[ship-card-movement.js](scripts/combat/ship-card-movement.js) still fly their arcs
and glides but drop the facing, via `_moveUpdate` — stripping the key rather than
skipping the update keeps every path moving as it did. The standalone rotate loops
are guarded at their own call sites instead. A `preUpdateToken` hook in
[main.js](scripts/main.js) reverts player rotations and lets GM ones through as a
**per-token** override; it deliberately does *not* re-aim the fleet, which would
let one nudge cascade across the map. `alignFleetToCourse` marks its own writes
with `sta2eSceneWarpAlign` so that guard can tell them apart.

**The Warp movement task on a scene already at warp is a station change, not a
jump** — `_runWarpStationChange` glides the ship and skips the turn, run-up,
flash, vanish and hull smear. It also must **not** touch the nacelle glow: Scene
Warp holds that lit, and firing the jump's own `broadcastWarpChargeGlow`/`stop`
would pop the nacelles dark mid-warp.

**The scene-wide "No Weapon Turn" switch** is read by `isWeaponAutoRotateDisabled`
in [weapon-configs.js](scripts/weapon-configs.js) — the single choke point that
already gates both the facing prep and the emitter pick, so firing-arc enforcement
drops with it (intended: at warp everyone is abeam of everyone). Its twin
`_isWeaponAutoRotateDisabled` in
[native-weapon-vfx.js](scripts/native-weapon-vfx.js) **must be kept in step**, or
the beam leaves from a different emitter than the rules picked.

**The nacelle glow is local on every client, not broadcast.** Each client runs
`playWarpChargeGlow` for itself off the same flag, which is why the hold can be
long: the anti-stuck `peakHoldMs` cap exists for a *broadcast* glow whose stop a
client might miss, and here the same client that starts one owns stopping it. A 5s
heartbeat reconciles (so a ship dropped in mid-warp lights up on its own) and
re-arms only a genuinely expired glow — a re-arm visibly restarts the brightness
ramp, so the interval is set well short of the hold to make that effectively never
fire. `sweepMs` is 1, not 500: the fore-to-aft sweep is the *jump's* power-up beat,
and a ship already at warp has its nacelles lit.

Ramp timings live in [settings.js](scripts/settings.js) (`sceneWarpEnterMs` /
`ExitMs` / `StarSpeed`). It has no sounds of its own.

**Environments map onto the bands rather than replacing them.** An environment
with a particle spec contributes a *second set of bands* beside the star ones —
same depth definitions, same containers, same thinning — each of one of two
kinds. A `streak` band is stars and anything with `stretchMul > 0`: length and
thickness are band-constant, so they still resolve to one scale pair and the
deadband still elides almost every write. A `tumble` band is anything with
`tumbleDeg`: without a z axis a particle's depth *is* its band, so its scale is
fixed for its life and written at seed, leaving only position and rotation per
frame. `_poolSignature` gained `environment`, `intensity` and `starMix`; dice
thinning needed no change at all, because an environment band is an ordinary
band. The wash here is **additive and low-alpha**, unlike the viewscreen's, since
it lies directly on the GM's map art rather than over a backdrop this renderer
deliberately does not paint — and the wash and flash sprite are built **only for
an environment that uses them**, which is what keeps plain warp's sprite tree
byte-identical to the field that predates environments.

**Performance — five rules the tick depends on.** The field runs every frame, so
everything in `_tick` is on the critical path, and it shares a frame budget with
whatever else is drawing (Dice So Nice was what exposed all of this).

- **Read the config and the timing exactly once per frame, and pass them down.**
  `_rampFactor(cfg, timing)` and `scenePhaseFrom(cfg, timing)` take values rather
  than fetching their own — the `scene`-taking `effectiveScenePhase()` is for UI
  code only. Before that split, `_tick` → `_rampFactor` → `effectiveScenePhase`
  each re-derived both, giving **3 `getFlag` and 9 `game.settings.get` per frame**
  (540 a second), all of it *above* the early-return that skips a dark field.
  Both reads are memoised too — `getSceneWarp` on the raw flag by **object
  identity**, since `getFlag` returns the same reference until the document is
  updated — but the signature discipline is what stops it coming back.
- **A dark field unhooks its ticker** (`_sleep`), rather than returning early
  every frame. `syncSceneWarp()` re-arms it and runs on every `updateScene`, and
  the phase only ever leaves idle through a flag write, so nothing can strand it
  asleep. The exit ramp still finishes first: `_sleep` only fires once `ramp`
  actually reaches 0.
- **Streak length is driven by a smoothed `dt`; position by the real one.**
  Smoothing position would let the field drift out of step with wall-clock time,
  but length is a look — driven from raw frame time it makes every streak in the
  field pulse in sympathy with frame-rate jitter, which is exactly what a 3D dice
  roll produces.
- **The scale deadband must stay relative** (`SCALE_DEADBAND`). `sx` is a texture
  multiple — around 6 for a near-band streak at warp 6, near 0.02 for a drifting
  one — so an absolute epsilon tight enough to matter at the bottom of that range
  never triggers at the top, and every one of ~750 per-frame scale writes comes
  straight back the moment frame time jitters. Measured: 749/frame → ~7/frame
  under realistic load jitter.
- **Dice thinning moves each band's `active` count; it never rebuilds the pool.**
  A rebuild would reseed every star mid-flight and visibly jump the whole field,
  twice per roll. `_diceRolling` is a **count, not a flag** — a task roll and a
  damage roll are routinely in the air together, and a boolean would restore the
  field while dice were still on screen. A watchdog clears it if a
  `diceSoNiceRollComplete` never arrives.

**Quality (`sceneWarpQuality`) is `scope: "client"`, and must stay that way.**
Frame rate is a per-machine problem: a player on a laptop needs to turn the field
down without the GM deciding it for the table, which a scene flag would do. It
only ever *reduces* what the scene's own Star Count and band toggles ask for, and
depth-band shares are renormalised over the surviving bands so Star Count keeps
meaning the same number of stars at every quality. The GM panel's Quality row is
a convenience mirror of that client setting, not scene state.

`starfield-common.js` carries a `cachedSetting` memo (cleared on `updateSetting`)
that the **viewscreen** uses for the same reason — its `getViewscreenTiming()` is
also called from inside its own `_tick`. `scene-warp.js` deliberately duplicates a
dozen lines of that rather than importing it, because staying import-free is what
lets the firing path consult it without a cycle.

### Warp Token Stretch

The ship's own hull elongating along its heading at both ends of a jump
([warp-stretch-vfx.js](scripts/warp-stretch-vfx.js)) — as opposed to
[warp-jump-vfx.js](scripts/warp-jump-vfx.js), whose flash, corridor and nacelle
glow are all drawn *around* the ship and never touch it. This is the **only place
in the module that deforms a token's sprite**.

The stretch is **anchored, not symmetric**: departing, the trailing end holds
while the bow tears forward into the flash; arriving, the leading end pins to the
destination and the hull compacts onto it from behind. A symmetric smear was
tried first and reads wrong — as much hull grows backwards as forwards, which
cancels the run-up lunge the movement runners perform and makes the ship look
like it never moved. Anything revisiting the look should keep the anchoring.

Three things it rests on, all easy to break:

- **The stretch axis is the mesh's local Y, not a canvas direction.** PIXI scale
  is applied before rotation, and every runner turns the ship to face its
  destination before the flash (the rotate loops in `ship-card-movement.js`, and
  `bearingToTokenRotation(heading)` in `ship-spawner.js`), so the hull's long axis
  lies along the line of travel. A plain `mesh.scale.y` multiplier therefore
  smears along that line with no matrix work — but nothing corrects for a token
  that is not facing where it is going.
- **The anchor offset is in canvas space, taken from the caller's direction of
  travel — never derived from the mesh's own rotation.** Foundry treats
  `document.rotation === 0` as facing *south* (`Token#_refreshRotation` writes
  `mesh.angle = document.rotation` unmodified, and core's own auto-rotate uses
  `bearing - 90`, exactly as this module does), so which end of a given token's
  *artwork* is the bow is not knowable from inside the effect. The caller knows
  where the ship is going, and that is the only end-identification needed:
  `anchor: "stern"` pins the trailing end of the **motion**, `"bow"` the leading
  end, and no `dir` degrades to symmetric. The sprite is centre-anchored (0.5/0.5
  from `document.texture.anchorX/anchorY`), so pinning an end is a shift of half
  the *added* length along that direction.
- **Core rewrites both `mesh.scale` and `mesh.position` from scratch,** so
  neither can be written once. In v14 every scale write funnels through
  `Token#_refreshMeshSizeAndScale` (called by both `#_refreshSize` and
  `#_refreshMesh`) and every position write through `#_refreshPosition` — and
  `refreshSize` propagates `refreshPosition`, so a size refresh moves the mesh
  too, while `_onAnimationUpdate` raises both every frame of a glide.
  `registerWarpStretch()` chains those two, re-captures the base core just wrote,
  and re-applies — recomputing from scratch the way `_applyMarkerLayout` does in
  [initiative-turn-marker.js](scripts/combat/initiative-turn-marker.js). The
  capture is **guarded against reading back our own output**, each half
  independently: a patch firing when core did *not* rewrite that value would
  otherwise fold the multiplier into the base and compound it every frame.
  `_applyStretch` records exactly what it wrote — in two separate try blocks, so
  a failed position write can never leave the scale's record missing — and
  `_captureBase` skips whichever half still matches.

**The warp flash fires at the far tip of the smear, not at the token.**
`getWarpStretchTipOffset()` returns the canvas offset from the token centre to
the end *opposite* the anchor at full stretch (`C + s·d·L·(m - 0.5)`, derived in
its docblock), and the runners add it to the flash coordinates — so a departing
ship punches into the burst with its bow and an arriving one streams forward out
of one behind its stern. It must be read **while the owning stretch is running**,
since it needs the registry's captured *base* hull length and the live mesh is
mid-smear by then; with no stretch it falls back to measuring the resting mesh,
and it returns a zero vector for every degenerate case so callers add it
unconditionally. Note the offset is large — a 2-square ship at 7× puts the tip 13
squares out — which is why both corridors check that the two tips have not
crossed before using them and otherwise fall back to the token centres. In
[ship-card-movement.js](scripts/combat/ship-card-movement.js) `runWarpFleeCard`,
`stretchCfg` is resolved *above* `openEffect` rather than beside the stretch:
a `flyThrough` style calls that closure before the stretch exists, and the
closure would otherwise hit the temporal dead zone on it.

Unlike position, rotation and alpha, a sprite deformation is **not a document
field**, so Foundry replicates nothing — `broadcastWarpStretch` exists for the
same reason `broadcastEngineTrail` does (`warpStretchVfx` / `stopWarpStretchVfx`,
scene-guarded and ungated in `main.js`). A non-1 target is **held** after the
ease finishes, with the ticker released, which is what lets the depart beat leave
the hull smeared while the ship is invisible; only a target of 1 self-restores.
Amount comes from the style's `stretch: {max, squeeze}` field scaled by the
`warpTokenStretch` percent (Settings → Sounds & Animations → Ship Tasks) — the
percent scales the *elongation*, so 0% is genuinely no stretch. Both rifts and
`qFlash` set `stretch: null`: a ship flying through a portal is not accelerating.
`runWarpEngageCard` reads the `standard` style's stretch rather than the ship's,
which does not weaken its style-agnostic contract — a look is not a timing.

### NPC Roller

[scripts/npc-roller.js](scripts/npc-roller.js) — LCARS-styled dice roller dialog (`DialogV2`). Handles two pools (Crew and Ship), clickable die pips for rerolls, Targeting Solution bonus die, and Threat spending for rerolls after the first. Posts results as LCARS chat cards.

### Chat Card Frame

Every chat card the module posts other than the task card shares one TNG frame —
**a bar across the top carrying the title, a bar across the bottom, all four corners
rounded, no spine** — built by `lcarsChatCard` in
[chat-card-frame.js](scripts/chat-card-frame.js), with geometry in
[styles/chat-card.css](styles/chat-card.css). A leaf module importing only
`lcars-theme.js`, so any builder can use it without a cycle.

**`lcarsCard` in [combat-hud-core.js](scripts/combat/combat-hud-core.js) is the leverage
point**: one private helper builds ~139 of the module's ~175 cards — every damage, injury,
shield, warp, tractor, cloak, destruction and scan card — and its signature already
separated title, accent and body, so the whole family was reskinned without touching a call
site. Roughly nineteen other builders own their own root and were converted one at a time.

Three rules the frame depends on:

- **`legacy` is a thunk, and it is what keeps the other eras frozen.** The frame is
  TNG-only; every other era must render exactly as it did before a card was converted, and
  there are ~19 different "befores". Rather than model them all, each builder hands its
  existing template in as `legacy: () => \`…\`` and gains one frame path beside it.
  A conversion is: lift the body into a local, wrap the old return value, call the helper.
- **The frame wraps; it never rebuilds the body.** A lot of behaviour is anchored inside
  it — the five `renderChatMessageHTML` hooks query classes in card bodies, and
  [momentum-spend.js](scripts/momentum-spend.js) injects its spend panel with
  `insertAdjacentHTML("beforebegin")` against a controls element in there, which is why
  that panel still lands inside the frame rather than after the bottom bar.
- **The helper strips inline `border-radius` from the body's buttons** (`unroundButtons`).
  Card bodies write button geometry inline, mostly `border-radius:2px`, and inline beats
  any rule — so the frame could not round them from CSS at any specificity. Only the
  opening `<button>` tag and only that one property are touched.
- **`rootClass` / `attrs` carry the builder's own root identity forward.** The frame
  replaces the root element, so anything selecting a card *by* its root breaks silently:
  `wireTrackerCard` does `html.querySelector(".sta2e-momentum-tracker")` and returns
  early when it misses, which would kill the tracker's End and Create Trait buttons with no
  error. Pass the class (and any `data-*` the wiring reads) whenever a card has one.

Colour is not the frame's business: `--ccf-c` takes whatever accent the builder already
codes with — hit orange, miss dim, injury red, hazard yellow — so a card keeps its meaning
and only changes shape.

Out of scope by choice: the warp navigation cards
([warp-calc.js](scripts/warp-calc.js), [toolkit-api.js](scripts/toolkit-api.js)) and the
star-system reports, which have deliberate bespoke skins.

### Working Task Card

The interactive "Working Results" chat card, built by `buildPlayerRollCardHtml`
([npc-roller.js](scripts/npc-roller.js)). Two skins, chosen by the world setting
`taskCardStyle`: **classic** (the inline template at the end of that function) and
**slim** ([task-card-slim.js](scripts/task-card-slim.js) +
[styles/task-card-slim.css](styles/task-card-slim.css)). A card stores its rendered HTML,
so an existing one keeps the skin it was posted with until a reroll/assist/edit/confirm
rebuilds it.

**Colours are inline; only shape lives in CSS.** Both skins hang `data-theme="<lcars theme
id>"` and `getLcCssVars("tc")` on their root, so a per-era *look* is a rule block in
[styles/task-card.css](styles/task-card.css) — never a change to the renderer. That file
carries the base radius vars (`--tcx-radius`, `--tcx-head-radius`, `--tcx-btn-radius`,
`--tcx-tray-radius`) plus one stub block per theme id. **Nothing the renderer emits may
carry an inline `border-radius`** — not the root, not a button — since inline beats the
stylesheet and would put that element out of reach of a per-era rule. Every card button
is covered by the one `.sta2e-task-card button, .sta2e-task-card .sta2e-task-btn` rule;
`.sta2e-task-btn` is on the two `<div>`s drawn as buttons ("Applied to …", "Completed").
The reroll tray is injected inline by `_armCardSelection()` and reads those same vars
with literal fallbacks, which must be kept equal to the defaults here.

**The TNG LCARS frame.** When the active theme is `lcars-tng` the renderer adds
`sta2e-task-card--frame` to the root (`lcarsFrame` in `buildPlayerRollCardHtml`) and emits
two inert rails; that class, not a `data-theme` selector, is what every frame rule in
[styles/task-card.css](styles/task-card.css) hangs off. **Opting another era in is that one
line in the renderer** — keeping the switch in JS is what keeps every other era out of
reach of those rules. In frame mode the card also swaps its header for an identity row
(`contextLeftLabel` / `contextRightLabel`, which already read "name" and "Comp Range 20"),
drops its border entirely, and `btnFill` turns every button into a filled LCARS key.

**The frame is two gold pieces and nothing else**: a spine down the left with flat ends,
and one `.tcf-bar` heading the results block, which carries the task label and turns
pass/fail coloured on resolve. No border, no bar across the top, no rail down the right;
earlier versions had all three and they were wrong.

Three things the frame's geometry rests on:

- **The concave joins are radial-gradients**, one `::before` and one `::after` on each bar.
  A circle centred on the far corner of a `--tcf-fillet` square, transparent inside its own
  radius, leaves exactly the quarter that hugs the junction. Nothing else in CSS paints a
  concave corner. Without them a bar butts into the spine at a right angle and the two read
  as unrelated rectangles.
- **The bar's colour arrives inline twice**, as `background` and as `--tcf-bar-c`, because
  a gradient cannot pick a colour up from `background` — the fillets need the var.
- **`--tcx-radius` is 0 in frame mode.** The spine's ends have to read flat, and the root's
  corner radius plus its inline `overflow:hidden` would clip them round.

**Three rules the card's styling depends on**, the first two already stated at the top of
both stylesheets:

- **No `!important` in either card stylesheet, and never set `background` /
  `border-color` / `color` / `opacity` on `.sta2e-player-reroll` or
  `.sta2e-make-own-luck`** — `_armCardSelection()`
  ([combat-hud-core.js](scripts/combat/combat-hud-core.js)) owns those four while an
  ability is armed and round-trips the button through `style.cssText`. Layout properties
  are safe, and so is `opacity` on a child span (which is how `.sta2e-rr-cost` dims).
- **`.sta2e-working-actions` stays a plain block.** The reroll tray is appended to
  `armBtn.closest(".sta2e-working-actions")` and must land *below* the buttons, so the
  grid goes on the inner `.sta2e-task-rerolls` wrapper (slim puts that class on its
  `.tcs-btns`). That grid rule is written with a doubled-class selector so it outranks
  `.tcs-btns`'s column flex on **specificity rather than stylesheet order**.
- **The armed marker targets `.sta2e-rr-name`, not the button.** Reroll buttons are two
  block spans — name, plus a `cost` line for the few abilities that charge something —
  so prefixing the button's own `innerHTML` would drop `▶` onto a line of its own.
  `_armCardSelection` also reads `data-filled` there: a filled button inverts to a lit
  key when armed, because darkening one key in a row of lit ones reads as disabled.

The card carries **no emoji**; the surviving glyphs are functional and monochrome (`★★`
on a crit die, `▶` armed, `→` on Add to Task Roll). The roller *dialog* and the static
`buildChatCard` summary still use theirs.

### Task Maker

The GM-side dialog that authors task cards ([task-maker.js](scripts/task-maker.js), a
`DialogV2`), with three tabs — Normal, Extended and **Opposed**, the last supplied by
[opposed-panel.js](scripts/opposed-panel.js). Shape lives in
[styles/task-maker.css](styles/task-maker.css); the renderers emit classes and colour
only, exactly as the card stylesheets do.

- **The renderers must emit no inline `border-radius`, and no inline `display`.** Inline
  beats any selector — that is the trap `chat-card-frame.js`'s `unroundButtons()` exists to
  undo, and the whole dialog used to be committed to it. Colour still arrives inline: the
  root stamps `getLcCssVars("tmk")`, and per-element accents ride on one custom property,
  **`--tmk-a`** (the counterpart of `--tcs-a` and `--ccf-c`). Both files carry a small set
  of markup helpers — `panelBar`, `field`, `numInput`, `pillButton`, `clearKey` —
  **duplicated rather than shared**, because `opposed-panel.js` must stay a leaf (it already
  keeps its own `esc` and `clampInt` for the same reason).
- **Tab switching is CSS.** The container carries `data-mode`, and the stylesheet owns both
  which panels are hidden and the parameter grid's track list. `applyModeVisibility` only
  writes that attribute, toggles `is-active` on the tab keys and re-fits the window. It
  replaced a table that stored a *guessed* display value per element and wrote it back on
  every switch. For the same reason the checkbox-driven field rows toggle `el.hidden`, which
  a doubled-root rule (`.sta2e-task-maker.sta2e-task-maker [hidden]`) outranks the grid
  display rules with — a `style.display` write would put them out of the stylesheet's reach
  permanently.
- **Every grid track carries a `minmax(0, …)` floor and every control a `min-width: 0`.**
  This is what fixed the columns jumping on a tab switch: `selectStyle()` in
  `lcars-theme.js` sets no width (unlike `inputStyle()`), so a `<select>` took its widest
  option as a min-content floor — "No difficulty change", "Timed Challenge" — and bare `1fr`
  is `minmax(auto, 1fr)`, so the track grew and the grid overflowed rather than shrinking.
  The shared helpers in `lcars-theme.js` are used by a dozen other modules and were
  deliberately left alone; the fix is scoped to this stylesheet.
- **The dialog is resizable, so narrow reflow uses `@container`, not `@media`** — the
  viewport width is the wrong signal. `.sta2e-task-maker` is the `container-type:
  inline-size` context.
- **The spine is a root background gradient, not an element.** The root scrolls
  (`max-height: 72vh`), and an absolutely positioned spine inside a scroll container scrolls
  away and resolves `bottom: 0` against the visible box, so it cannot span a tall Extended
  tab. A background on the scroll container is painted against the border box and does not
  scroll. `styles/opposed-task.css` draws its spine the same way. The panel bars are the
  `.tcf-bar` construction from [task-card.css](styles/task-card.css) — pulled out over the
  spine, with `radial-gradient` concave fillets above and below. Those fillets are why
  `--tmk-bar-c` is set on the bar rather than the colour only being used as a `background`:
  a gradient cannot read a colour back out of `background`.
- **The chrome is one solid colour, and the root is square with no border.** The spine, every
  panel bar and all three tab keys take `--tmk-primary`; `panelBar()` takes no accent and the
  tab keys emit no inline `--tmk-a`. A hue per section was tried first and read as a muddle —
  the panels sit a few pixels apart, so the bars are seen as one column, and the spine's
  secondary/tertiary bands showed through the gaps as olive and pale-cream smudges. Sections
  are told apart by their labels, and the selected tab by its filled state. Per-element
  `--tmk-a` accents survive on *controls* (slot buttons, sliders, numeric fields, well
  titles), where they mark meaning — the two Opposed sides, for instance. The panel bodies,
  the masthead body and the tab strip carry **no border either** — they are dark blocks
  hanging under their bar, and an outline round each one fought the bars for attention.
- **The top-left elbow is rounded on the root, not on the masthead bar** (`--tmk-elbow`,
  with the root's other three corners square and `padding-top: 0`). The spine is the root's
  *background*, so it paints underneath that corner: rounding the bar alone reveals spine
  orange in the cutaway instead of a curve. Clipping at the root takes the spine and the bar
  together, which is what makes them read as one elbow. `padding-top: 0` is load-bearing —
  any top padding puts a square-topped 12px spine stub above the bar. The masthead's
  `::before` fillet is suppressed for the same reason: with nothing above it, it drew a hook
  floating in that corner.
- **`state._app` is the dialog**, stashed by `openTaskMakerSetup` so every path that changes
  the content's height can call `setPosition({height:"auto"})` — `refitDialog`. `DialogV2`
  sizes itself once at render, and the three tabs differ enormously in height. Safe to hang
  on the state object because `saveLastSettings` and `postTaskRequestCard` both build
  explicit payloads rather than spreading state.

`opposed-panel.js` keeps **every `.op-*` class name** — its own wiring and the resolution
side of [opposed-task.js](scripts/opposed-task.js) select on them; the `.tmk-*` classes sit
alongside. The `.sta2e-opposed-setup` rules in `styles/opposed-task.css` remain orphaned and
must stay that way: they are written for a full dialog root and would draw a second frame
inside this one.

Out of scope by choice: the DialogV2 window chrome (titlebar, Cancel / Post Card footer),
and the chat cards this file posts — those still carry `border-radius:2px` inline and go
through `lcarsChatCard`.

### Supporting Files

| File | Purpose |
|------|---------|
| [scripts/crew-manifest.js](scripts/crew-manifest.js) | Bridge station assignments, officer stats |
| [scripts/combat/acting-officer.js](scripts/combat/acting-officer.js) | `resolveActingOfficer` — which manned officer is taking a station's action. The only correct way to pick one; never index `getStationOfficers(...)[0]` |
| [scripts/weapon-configs.js](scripts/weapon-configs.js) | Weapon config registry, `buildWeaponContext`, fire functions |
| [scripts/token-conditions.js](scripts/token-conditions.js) | STA combat conditions (add/remove/query) |
| [scripts/task-card-slim.js](scripts/task-card-slim.js) | Slim LCARS skin for the Working Results task card (`taskCardStyle`) |
| [scripts/chat-card-frame.js](scripts/chat-card-frame.js) | `lcarsChatCard` — the TNG top/bottom-bar frame every other chat card shares. Leaf module; `legacy` thunk keeps non-TNG eras frozen |
| [styles/chat-card.css](styles/chat-card.css) | Shape-only CSS for that frame |
| [styles/task-card.css](styles/task-card.css) | Shape-only CSS for the task card — frame radius per era, the two-column reroll grid |
| [scripts/task-maker.js](scripts/task-maker.js) | The GM's task-authoring dialog — Normal / Extended / Opposed tabs, the posted request card, extended-task resolution |
| [scripts/opposed-panel.js](scripts/opposed-panel.js) | The Opposed Task tab's markup and wiring. A leaf by necessity — it may import only `lcars-theme.js` and `ship-pool.js` |
| [styles/task-maker.css](styles/task-maker.css) | Shape-only CSS for the Task Maker dialog and its pickers — spine, elbow bars, `[data-mode]` tab visibility, fluid grids, container queries |
| [scripts/transporter.js](scripts/transporter.js) | Transporter tab of the spawn window — queue, beam buffer, beam-in/out VFX |
| [scripts/ship-spawner.js](scripts/ship-spawner.js) | Ships tab of the spawn window — fleet queue (the shared `spawn-queue.js` widget), formation, warp arrival |
| [scripts/spawn-window.js](scripts/spawn-window.js) | The LCARS console shell all three tabs render into — frame, rail, tab keys, drag |
| [scripts/spawn-chrome.js](scripts/spawn-chrome.js) | Markup helpers the three tabs share — columns, panels, fields, rail keys. A leaf; it is what enforces the no-inline-geometry rule |
| [styles/spawn-window.css](styles/spawn-window.css) | Shape-only CSS for the spawn console — rail, keys, fields, queue, buffer, per-era radii |
| `assets/spawn-frame-top.svg` / `-bottom.svg` | The frame artwork, worn as a `mask-image` so it still recolours per era. Inkscape-wrapped raster — no path to fill, which is why it is masked rather than tinted; the stylesheet's column positions are measured off it |
| [scripts/q-spawner.js](scripts/q-spawner.js) | Q tab of the spawn window — uncapped snap in/out, hold buffer, Q Flash Move |
| [scripts/q-actions.js](scripts/q-actions.js) | Q Flash Move and Snap Out + Hold — shared by the Q tab and the Token HUD |
| [scripts/q-hud.js](scripts/q-hud.js) | Q control on the Token HUD, GM-only, every token type |
| [scripts/q-vfx.js](scripts/q-vfx.js) | Q's white screen flash and the composed snap sequences |
| [scripts/spawn-picker.js](scripts/spawn-picker.js) | Shared canvas pickers, `pickSpawnCentres`, PIXI shims, `centreToTopLeft` |
| [scripts/spawn-queue.js](scripts/spawn-queue.js) | The drag-actors-in queue widget shared by the LCARS tabs |
| [scripts/spawn-buffer.js](scripts/spawn-buffer.js) | Hold/restore group buffer, keyed by setting |
| [scripts/spawn-regions.js](scripts/spawn-regions.js) | Region spawn destinations — pad-marker discovery/order, grid fill, `parseLocation`, `buildLocationOptions` |
| [scripts/region-pad-config.js](scripts/region-pad-config.js) | Injects the spawn-marker checkbox + Pad Group field into Region Config |
| [scripts/region-spline-tool.js](scripts/region-spline-tool.js) | The Regions-toolbar **Curve** tool — the scene-control descriptor, the two `RegionLayer` patches, the control-point stamp, and the Region Config rebuild panel |
| [scripts/spline-geometry.js](scripts/spline-geometry.js) | Closed centripetal Catmull-Rom over flat `[x,y,…]` arrays — adaptive sampling, the tangent overshoot clamp, and the centroid-tolerant outline match. A leaf with **no imports** |
| [scripts/scene-warp.js](scripts/scene-warp.js) | Scene Warp state — the scene flag, phase ramp, course/rotation conversions, the ship test. A leaf with **no imports**, so the firing path can consult it without a cycle |
| [scripts/scene-warp-vfx.js](scripts/scene-warp-vfx.js) | The top-down parallax streak field — nested masked/rotated containers, depth bands, the over-tokens band |
| [scripts/scene-warp-panel.js](scripts/scene-warp-panel.js) | Floating GM-only LCARS panel driving engage/drop out, warp factor, course, the two rules switches and the look |
| [scripts/starfield-common.js](scripts/starfield-common.js) | Star and environment *material* shared by both renderers — streak/radial/cloud/storm-cloud/wisp/rock/mote/grain/scanline textures, fBm noise, lightning geometry, palette construction, colour maths, PIXI v7/v8 shims. Knows nothing about either camera |
| [scripts/viewscreen-environments.js](scripts/viewscreen-environments.js) | The travel environment registry — four volumes (warp, nebula, ion storm, asteroid), four tunnels (transwarp conduit, slipstream, wormhole, subspace vortex) and signal loss. A leaf with **no imports**, so the panels and `scene-warp.js` can read it; textures named by string key, every particle number a multiplier |
| [scripts/warp-viewscreen-behavior.js](scripts/warp-viewscreen-behavior.js) | The `sta2e-toolkit.warpViewscreen` RegionBehaviorType — schema, phase writes, environment-resolved sounds, the vanishing-point picker |
| [scripts/warp-viewscreen-vfx.js](scripts/warp-viewscreen-vfx.js) | The masked star-streak renderer — projection, star pool, ramp, bloom, teardown |
| [scripts/warp-viewscreen-panel.js](scripts/warp-viewscreen-panel.js) | Floating GM-only LCARS panel driving enter/exit warp, warp factor, aim and look |
| [scripts/warp-stretch-vfx.js](scripts/warp-stretch-vfx.js) | The hull smear at both ends of a warp jump — the only place the module deforms a token sprite. Owns the `Token#_refreshSize` / `#_refreshMesh` patch that keeps it applied |
| [scripts/warp-calc.js](scripts/warp-calc.js) | Warp travel calculator dialog |
| [scripts/warp-effect-styles.js](scripts/warp-effect-styles.js) | Warp flash style registry (clip, scale, peak, corridor) + the trait and faction gates. `standard`, `temporalRift`, `cardassianTemporalRift`; the rifts are timeships only. Styles sharing a `family` are faction variants: a variant with a `faction` key replaces the family's generic one for ships of that faction, substituted by `resolveFactionVariantId` on the initiating client so the resolved id is what travels the socket. Must not import `ship-vfx-anchors.js` — that would close an import cycle; faction detection is imported from `actor-faction.js` instead |
| [scripts/alert-hud.js](scripts/alert-hud.js) | Alert status HUD overlay |
| [scripts/toolkit-widget.js](scripts/toolkit-widget.js) | Floating toolbar widget |
| [scripts/hud-position.js](scripts/hud-position.js) | Viewport clamping shared by every draggable HUD panel — keeps a dragged/restored header on screen |
| [scripts/assist-pending.js](scripts/assist-pending.js) | Sole owner of the `assistPending` token flag (declared Assist / Direct). Writes self-route: direct when the user can update the token, otherwise a socket request the GM executes |
| [scripts/wildcard-namer.js](scripts/wildcard-namer.js) | Auto-names wildcard tokens from rollable tables |
| [scripts/elevation-ruler.js](scripts/elevation-ruler.js) | Patches FoundryVTT ruler for 3D elevation |
| [scripts/star-system-scene.js](scripts/star-system-scene.js) | Builds a scene map from a Star System actor (tiles, orbit rings, per-orbit zones, hover tooltips) |
| [scripts/actor-faction.js](scripts/actor-faction.js) | `resolveActorFactionKey` — guesses a ship's faction by regex over its name and traits. A leaf module with no imports, so gating code can use it without cycles; re-exported from `ship-vfx-anchors.js`, which is where every caller has always found it |
| [scripts/scene-flags.js](scripts/scene-flags.js) | Scene flag helpers |

## Key Conventions

- **Socket pattern:** `game.socket.emit("module.sta2e-toolkit", { action, ...payload })`. All actions are handled in `main.js`'s single socket listener. Players cannot directly call GM-privileged Foundry API; they emit a socket event instead.
- **Chat cards** are built as inline HTML strings (no Handlebars templates for dynamic cards) to allow per-era LCARS styling.
- **Settings** are registered in [scripts/settings.js](scripts/settings.js); scope is `"world"` for GM-visible and `"client"` for per-user.
- **Flags namespace** is always `"sta2e-toolkit"`.
