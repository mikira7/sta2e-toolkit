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

Themes: `lcars-tng` (orange), `lcars-fc` (First Contact: periwinkle/slate/tan), `tos-panel`, and others for ENT/Klingon/Romulan.

**`lcars-fc` replaced `lcars-tng-blue`.** `RETIRED_THEMES` maps the old id to the new one: `getActiveLcThemeKey` follows it at read time, and `migrateRetiredThemes` (the active GM, on `ready`) rewrites the stored `hudTheme` setting and every campaign's `theme`. The stored values must change because several readers take the raw id rather than calling `getActiveLcThemeKey` — `alert-hud.js`, `stardate-hud.js`, `transporter.js`, `warp-calc.js`, `elevation-ruler.js` and the department colours in `combat-hud-core.js`. A new retirement is one entry in that map.

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

### Crew Manifest

[crew-manifest.js](scripts/crew-manifest.js) owns who crews a ship; [ship-crew-tab.js](scripts/ship-crew-tab.js) is the **Crew** tab on the starship and small-craft sheets, and is only a view over it. Four rules:

- **One station per officer, and `assignOfficer` / `unassignOfficer` are its only owners.** Assigning someone moves them off every other station and *replaces* a single-seat station's occupant; Command keeps two seats by index (`COMMAND_SEATS`). The manifest dialog, the Crew tab and the LCARS ring all call it. They used to disagree — the dialog allowed two stations and refused a full one, the ring moved people — so never reintroduce an inline rebuild of the manifest.
- **The ship's company is a union of three sources** (`getShipCrew`): the character's `assignedShips` flag (Assign Ships), the system's `system.assignment` equal to the ship name (trimmed, case-insensitive — exactly how the system's Ship Roster finds crew), and anyone on the manifest. Adding someone writes both of the first two, so the system's roster sees them; removing clears the flag and clears Assignment only if it still names this ship. Adding **replaces** other Assignment text (the Character Creator writes a role there), and `applyShipCrewRequest` returns the old text so the caller can say so.
- **Crew writes self-route.** They land on the *character*, which a ship's owner usually cannot update, so `addShipCrew` / `removeShipCrew` fall back to the socket action `shipCrewUpdate`, run by the active GM. Station writes land on the ship (or the token, for an unlinked ship), which only its owners edit, so they need no relay.
- **The tab never moves the system's markup.** The 2e ship sheets have no tabs of their own, so the strip is ours, placed after the toolkit's NPC Ship block (or the name header). Switching toggles `sta2e-crew-active` on `.right-column` and CSS hides the other children. The chosen tab lives on the app instance (`_sta2eShipTab`) because the sheet re-renders constantly. Membership changes land on characters and never re-render the ship sheet, so `updateActor` / `updateToken` hooks rebuild the panel in open sheets. The tab is registered after the sheet-roller hooks in `main.js` so the NPC Ship block exists when the strip is placed.

**Departments.** The ship's company has department sub-tabs (All, Command, Conn, Engineering, Security, Science, Medical). A member's department is, in order: an explicit choice stored **on the ship** (`crewDepartments` flag, same store as the manifest, so the ship's owner can set it without writing the character), the department of the station they hold, then their best discipline (`crewDepartment` / `autoDepartment` in `crew-manifest.js`). The open sub-tab lives on the app instance (`_sta2eCrewDept`), like the Ship/Crew tab.

**Combat tracker.** `addManifestOfficersToCombat` (main.js) adds a tokenless, actor-only "Officer (Station)" combatant per manifest officer. It runs when a ship joins combat (`createCombatant`) **and** whenever the ship's `crewManifest` flag changes while it is already in a combat — `updateActor` for linked ships, `updateToken` for unlinked — on the active GM only, so one hook covers all three editors. A moved officer's combatant is renamed; a **replaced officer is deliberately left in the tracker**, since deleting a combatant mid-round would disturb the sequence `initiative-order.js` keeps. Covered by [tests/crew-manifest.mjs](tests/crew-manifest.mjs).

### TOS Sheet Overlay

Under `tos-panel`, with the world setting `themeCharacterSheet` on, the five 2e
sheets (character, NPC, supporting, starship, small craft) take the TOS Console
Viewer look of the task card: gunmetal housing, CRT readouts, backlit keys, lamps.
[tos-sheet-theme.js](scripts/tos-sheet-theme.js) (a leaf) stamps the template root
with `.sta2e-tos-sheet` and `data-sta2e-sheet="<kind>"` from each sheet class's
render hook; [styles/tos-sheet.css](styles/tos-sheet.css) does the rest. The design
source is `docs/tos-sheet-mockup.html`. Four things it rests on:

- **An overlay, never a template.** Nothing in the system's markup is moved or
  wrapped, so every `data-action` and the track renderer keep working. The panels
  are the template's own columns, the CRT screens its own blocks, and the header
  strip, viewer caption and lamps are pseudo-elements.
- **`_applySheetTheme` skips a tagged sheet** (`:not(.sta2e-tos-sheet)` beside the
  own-palette exclusion). Its rules are all `!important` and would otherwise fight
  the overlay, which has none. It also calls `refreshTosSheets()` first, so a theme
  or setting change re-tags open sheets.
- **The kind stamp exists because CSS cannot tell the sheets apart.** NPC,
  supporting and player characters are all actor type `character` on the same
  `.character-sheet` root, and the NPC's Personal Threat track reuses `box stress`.
- **The root is a class plus an attribute**, so every nested rule outranks sta.css's
  `.character-sheet .x` on specificity. Core's `.hidden { display: none !important }`
  sits in a cascade layer and still wins, so the overlay may set `display` freely.
  Inputs are underlined with box-shadows, since sta.css forces some border colours
  with `!important`. Breach counts turn red through `.breaches:not([value="0"])`,
  which works because the template writes the count as the value attribute.

**The TMP overlay** is the same machinery for `tmp-console`: the tagger stamps
`.sta2e-tmp-sheet` instead (`ERA_CLASSES` in tos-sheet-theme.js; it toggles every era
class, so a theme change moves an open sheet across), `_applySheetTheme` skips it too,
and [styles/tmp-sheet.css](styles/tmp-sheet.css) follows tos-sheet.css rule for rule
in the TMP task card's look: grey duty panels with a header plate, black monitors for
the statistics, dark amber-type windows for anything typed, lens keys, and the fonts
task-card-tmp.css declares. The design source is `docs/tmp-sheet-mockup.html`. Checked
by rendering the system's real `*2e.hbs` templates with Foundry's Handlebars, which
turned up one trap the TOS file shares: sta.css gives several blocks `width: 100%` as
a **content box** (list headers, `.buttons`, `.text-entry`, the supporting
improvement rows), so any padding the overlay adds pushes them past their column.
tmp-sheet.css sets `box-sizing: border-box` (or `width: auto`) on each.

**The ENT overlay** is the same machinery again for `ent-panel`: the tagger stamps
`.sta2e-ent-sheet`, `_applySheetTheme` skips it, and [styles/ent-sheet.css](styles/ent-sheet.css)
follows tmp-sheet.css rule for rule in the look of the ENT task and chat cards (`.tec`):
navy glass with corner brackets, the record title on a rule with three ticks and a cut
tab, underlined text fields, tracks as segmented readout bars, square indicators (radios
are diamonds) that fill yellow, and tab keys with a coloured edge. The design source is
`docs/ent-sheet-mockup.html`. Two things differ from the card, both forced by "never
wrap the system's markup": a panel has no inner box for the card's clipped-twice
chamfer, so it keeps a plain outline and the **corner brackets are background layers**
(`--ent-brk`), leaving both pseudo-elements free; and the header is the record column's
`::before` (title on a rule) plus its `::after` (the ticks as background stops, the tab's
slanted edge as a gradient angle, the tab text — Crew / NPC / Sup / Vessel / Aux — as
content). Checked against the real `*2e.hbs` templates the same way.

### TMP Monitor Theme

A second TMP theme, `tmp-monitor` ("TMP Monitor"), beside TMP Console: the later
films' monitor graphics (Concept B in `docs/tmp-card-mockups.html`) — every widget
one black screen with a vector grid, scanlines, a cyan border with rounded outer
corners and a square interior, Microgramma captions and outlined keys. It is picked
like any theme (campaign manager, `hudTheme`); the TMP era still defaults to TMP
Console. Its tokens equal `tmp-console`'s, and `isTmpTheme()` / `TMP_THEME_KEYS`
in lcars-theme.js are what "is this TMP?" checks should use.

**It owns no markup.** The calendar, the task card, the chat frame and the sheets all
render TMP Console's markup plus one modifier, and a stylesheet repaints it:

| surface | modifier, added by | repainted in |
|---|---|---|
| Stardate HUD | `.sta2e-tmp--monitor` — stardate-hud.js `tmpRootClass` | styles/tmp-monitor.css |
| Task card | `.sta2e-task-card--tmpmon` — task-card-tmp.js | styles/tmp-monitor.css |
| Chat frame | `.sta2e-chat-card--tmpmon` — chat-card-frame.js `tmpChatCard` | styles/tmp-monitor.css |
| Sheets | `.sta2e-tmp-sheet--monitor` beside `.sta2e-tmp-sheet` — tos-sheet-theme.js `ERA_CLASSES` | styles/tmp-monitor-sheet.css |

So the monitor inherits every fix the TMP files carry (the sheet content-box traps,
the row-control flash, the meter label columns) and a fix there lands in both. Each
monitor rule is one selector component deeper than its TMP counterpart, so it wins
on specificity, not load order. Two things differ in the renderers themselves: the
task card and chat frame put a code tab and tick marks in the header (the card's
code is `T-<target>` while working, `OK` / `NEG` / `AST`), and task-card keys take
`monitorStyle` — outlined or filled with an **inline `border-color`**, because an
armed key's yellow border is written by `_armCardSelection`. Monitor keys are
numbered by a CSS counter, not markup. Widgets this theme does not restyle (alert
widget, spawn window, Task Maker, opposed task, player bar) take TMP Console's rules,
which list `tmp-monitor` beside `tmp-console`. Covered by
[tests/tmp-monitor-cards.mjs](tests/tmp-monitor-cards.mjs) (`--preview` includes the
calendar bar).

### Token HUD

**One control, not four.** [token-toolkit-hud.js](scripts/token-toolkit-hud.js) is
the module's sole `renderTokenHUD` hook: a single arrowhead button that opens a
drill-down menu. It replaced four separate controls that each owned a hook, a
control and a flyout — the ship command arrowhead, the weapon crosshair, the Q
sparkle-hand, and an inline meteor button in `main.js`. On a starship that was
four icons stacked under Foundry's own controls.

**Navigation is the rebuild-in-place idiom the rich palettes already used, with
one extra piece of state — which section is open.** A level change builds a fresh
palette from `{sectionId, state}`, inherits the old one's `style.top` and
`replaceWith`es it, so the panel never jumps. There is only ever one panel on
screen, which is why `toggleHudFlyout`'s "one flyout per column" sweep — the one
real hazard for a nested menu — can never bite.

A section is a **descriptor, not a hook**. Two shapes:

```js
branch: { id, label, icon, tooltip?, available(token),
          initialState?(host), build(host, state) -> Element[] }
leaf:   { id, label, icon, tooltip?, leaf: true, available(token), run(host) }
```

`host` is `{app, token, control, palette, rebuild(next), back()}`. Each feature
file's old `rebuild()` closure maps onto `host.rebuild()` one for one, which is
why the conversion touched no row body. Four things it rests on:

- **`build()` returns rows, never a flyout.** The host owns the container, the
  `data-section` stamp and both connection guards. A section that builds its own
  `buildHudFlyout` would nest a panel inside a panel.
- **`buildHudItem` lives in [token-hud-util.js](scripts/token-hud-util.js), not in
  the host.** The host imports the sections, so a row builder exported from it
  would close a cycle. That util is the leaf, and it is also why the three
  byte-identical local copies of the row builder are now one.
- **The VFX leaf reaches its editor through `game.sta2eToolkit.openObjectVfxEditor`,
  not an `import`** — the same precedent the Weapons section sets for the Combat
  HUD, and it keeps the host out of `ship-vfx-anchors.js`'s import graph.
- **The control is not drawn when no section is available**, so the arrowhead
  never opens an empty menu.

Colour is deliberately static LCARS orange. The Token HUD sits outside the themed
`LC` token system and no HUD injection in this module themes itself — do not pull
`lcars-theme.js` in here. Shape lives in
[styles/token-hud-flyout.css](styles/token-hud-flyout.css) (container, rows, the
`.section` / `.leaf` / `.back` variants) and the control's art in
[styles/token-toolkit-hud.css](styles/token-toolkit-hud.css). The weapon grid
sizes itself off `.sta2e-hud-flyout[data-section="weapons"]` — that attribute is
what replaces the per-feature flyout class each section used to own.

**The one deliberate exception is Appearance**, which has its own theatre-masks
control ([appearance-hud.js](scripts/appearance-hud.js)) rather than a section
under the arrowhead: players use it on their own tokens, and the arrowhead is a
GM-only menu. It reuses `token-hud-util.js` and the same rebuild-in-place idiom,
and sits in the same column, so `toggleHudFlyout`'s sweep keeps only one of the
two panels open.

### Appearances

The toolkit's replacement for Token Variant Art and Visage: per-actor **looks**
(token art + portrait pairs), a random look on placement, a Token HUD switcher,
and **automatic looks** driven by worn gear or a condition. Five files:
[appearance-data.js](scripts/appearance-data.js) (the rules — a leaf with **no
imports**, covered by [tests/appearance-data.mjs](tests/appearance-data.mjs)),
[appearance.js](scripts/appearance.js) (hooks and writes),
[appearance-manager.js](scripts/appearance-manager.js) (the GM editor, from a
header control on every STA sheet; Looks and Automatic Looks tabs, a card
gallery beside a live editor stage after Visage's layout),
[appearance-hud.js](scripts/appearance-hud.js) (its own Token HUD button)
and [appearance-sheet.js](scripts/appearance-sheet.js) (the Wear toggle on
armour/gear rows). [art-browser.js](scripts/art-browser.js) is the searchable
picker.

- **Nothing browses a folder at spawn time.** A look is picked from the stored
  list, synchronously. The old wildcard roll browsed per spawn and `Klingon*`
  matched `Klingon_portrait.webp`, which is how a beam-in put a portrait on the
  map. `buildSpawnTokenData` applies the look and stamps `appearanceState`;
  the `preCreateToken` roll (sidebar drags) stands aside for any token that
  already has it. The transporter and Q loops skip their own wildcard re-roll
  for an Appearances actor (`usesAppearances`) — without that guard they painted
  a wildcard image straight over the look. Beam-out records `captureAppearance`
  in the buffer entry, so a restore brings back the same face **and** portrait.
- **State lives on the token for an unlinked token and on the ACTOR for a
  linked one** (`appearanceState: {lookId, ruleLookId, baseline}`), because a
  linked character's portrait is shared — two tokens of one PC must agree on
  whether the suit is on. The portrait goes to `delta.img` (unlinked) or
  `actor.img` (linked).
- **A linked character's original is its Prototype Token** (`_prototypeArt` in appearance.js), not whatever its placed token shows: core never updates placed tokens when the prototype changes, so a baseline captured from the map restored the OLD art after the original was changed. `_settle` captures a linked baseline from the prototype and rewrites an existing one's token/scale/ring from it (portrait and name stay as captured), and an `updateActor` hook on `prototypeToken` (active GM) moves undressed linked tokens to the new art. A wildcard prototype is skipped. Unlinked tokens keep the old rule.
- **The baseline is "original art".** Captured the first time the art leaves
  its original state, dropped when it returns, so taking a suit off restores
  what was there even with no look made for it. A rule overrides the chosen
  look (`lookId`) without replacing it; the pick shows once the rule clears.
- **Worn is the item flag `worn`, not the system's `ArmorData.equipped`** — that
  defaults to `true`, no sheet shows it and nothing reads it, so carried armour
  would always count. Item rules match by trimmed, case-insensitive **name**.
  The world setting `armorProtectionWornOnly` (off by default) makes damage
  read the same flag: `CombatHUD._getTargetProtection`, the single place every
  ground damage path sums armour, then skips armour not marked worn — for every
  actor, NPCs included.
- **Rules re-evaluate on the active GM only**, off `create/update/deleteActiveEffect`,
  `updateToken` (toolkit `conditions`/`defenseMode`), `updateItem` (worn or name),
  `create/deleteItem` and library edits. `settle()` is the single writer and is
  serialised per figure. With no GM connected, `setWorn` settles locally.
- **Composition is a stack of layers: condition rule → gear rule → mimic →
  chosen look → baseline.** `matchRules` takes the first matching rule *of each
  kind*, so a condition always shows over the gear rather than whichever is
  listed first hiding the other (an EV suit used to mask Unconscious). Use it,
  not `matchRule`, which is first-match-overall and kept for the tests.
  Each slot (art, portrait, scale, ring, token name) comes from the first layer
  that sets it. A look's `tokenName` renames the **token only** — the actor and
  its sheet keep their name — and the baseline remembers the token's own name so
  Original (or a look without one) puts it back. At creation the baseline only
  records a name when the look sets one, so restoring never undoes the wildcard
  namer, which renames a token *after* it is created.
- **A look (and the Original, `baseVersions`) may carry its own version of a
  rule** (`versions: [{kind, match, token, portrait}]`, matched by `ruleKey`, so
  reordering rules keeps them attached). When the matched rule has one on the
  worn look — on the Original when no look and no mimic is on — it takes the
  rule look's place in the rule layer. An empty slot falls back to the rule's
  look; scale, ring and token name come from the layers beneath, since a version
  is drawn for its own look's framing — except a token made in the Token Maker
  (the version's wand key, sourced from the version's portrait and opened on the
  look's ring), which keeps the maker's `ring` and `maker` recipe with its art so
  a baked frame never sits inside the look's dynamic ring; and its portrait shows even when the rule
  leaves portraits alone. The rule's look stays required: it is the fallback for
  every look without a version. State stores `ruleKey` beside `ruleLookId`
  because two rules may share one look and still carry different versions —
  `_ruleFor` re-finds the rule by it when a token is created. **Under gear, a
  condition's version comes from the gear's look** (the EV suit look's own
  Unconscious version), falling back to the condition's look; the gear's own
  version still comes from the chosen look. `gearKey` in state names the gear
  under the condition, read back by `_gearFor`.
- **Mimic (`applyMimic` / `endMimic`) is the changeling trick:** `captureMimic`
  copies another token as drawn right now — art, scale, ring, the portrait its
  sheet shows (`delta.img` for an unlinked one) and its token name — into
  `appearanceState.mimic`. It sits under rules (a killed changeling still shows
  its Fallen look) and over the chosen look, and picking any look or Original
  ends it. **Starting one is gated** by the world settings `mimicAccess` (`trait`
  default / `anyone` / `gm`) and `mimicTraits`: `canUseMimic` reads the token's own
  actor (synthetic for unlinked), and `mayMimic` matches trait items or the
  `system.traits` text by whole word. GMs always may; *ending* one is never
  gated. The check runs in the HUD, in `applyMimic`, and again on the active GM
  for a relayed request — against the requesting user, not the GM. It needs no
  library, which is why the HUD button is also offered to
  a player whose token may mimic; the HUD's Mimic key copies the user's single Foundry target. The
  relay carries the mimic payload, so a player can disguise a token they own but
  cannot write.
- **A mimic can be stored as a look** (`storeMimicForm`, the HUD's Store This
  Form): `storeMimicInLibrary` copies it into the base actor's library, named
  after the token it came from, and skips an exact duplicate. Stored looks carry
  `mimicked: true` and are left out of every random pick (`pickLook` and the
  HUD's Random Look), so a changeling NPC with randomize on never spawns wearing
  a face it copied. Same mimic gate as starting one; a user who can't update
  the base actor is relayed (`op: "storeMimic"`), and the active GM re-checks
  the rule against the requester and reads the mimic from the token itself.
- **A new token is dressed by composition, not by copying fields.**
  `applyCreationAppearance` runs the same `composeAppearance` the live tokens
  use and writes the whole visual (art, scale, ring, portrait, **token name**):
  for a restored transporter / Q pattern from its captured state, for a linked
  figure from its actor's state. That is what carries a mimic across scenes and
  through a beam — the old path restored only the art and portrait, so a
  disguise rematerialised under the actor's real name. Both creation paths
  (`preCreateToken`, `buildSpawnTokenData`) admit an actor with no looks when
  its state is dressed (`stateIsDressed`), because a mimic needs no library. The
  composed name overrides the buffer's display name, which is the actor's.
- **The Original is editable in the manager** — a card first in the gallery
  (`BASE_ID`), a look-shaped working copy of the prototype token (art, scale,
  ring) and the portrait, so every stage handler and the Token Maker work on it
  unchanged; its maker recipe is the library's `baseMaker`. A linked character
  in a look keeps its original portrait in the state baseline, not `actor.img`,
  so the portrait is read from and written to there. On Save,
  `_followPlacedTokens` runs **before** the library write (whose re-evaluation
  would otherwise race it): `rebaseVisual` moves a slot only where a placed
  token still holds the old original, and rewrites a dressed token's baseline
  by flat paths. A ring is compared without its art, since core stores the art
  as the ring's subject.
- **WebP conversion** ([webp-convert.js](scripts/webp-convert.js)) swaps
  PNG/JPEG token and portrait paths in the working copy for a copy saved beside
  them (Save applies it). A copy that is not smaller is skipped, and the
  original file is never deleted — Foundry has no API for it.
- **Read Visage's flag from `_source`, not `getFlag`** — `getFlag` throws for an
  inactive module's scope, which is exactly when Import from Visage is used.
- **A look may carry a dynamic ring** (`look.ring`, null = leave the token's ring
  alone; the Token Maker's baked output stores `{enabled: false}` so a painted
  frame is never doubled). The baseline captures the token's ring too, so
  Original Art switches a ring back off. `ringUpdates` always writes
  `ring.subject.texture` for an enabled ring — core then treats the subject as
  explicit and skips its fit-mode shrinking (`TokenRing`), which the maker's
  subject sizing depends on.

#### Token Maker

[token-maker.js](scripts/token-maker.js) (window) and
[token-maker-compose.js](scripts/token-maker-compose.js) (maths, a leaf, covered by
[tests/token-maker.mjs](tests/token-maker.mjs)): portrait → masked token, opened
from the wand key on the manager's token stage. Four things it rests on:

- **Compositing order:** background (clipped to the shape) → subject ∩ shape −
  erase → frame → subject ∩ restore − erase − shape. The last layer is what lets
  Restore strokes pop out over a ring. In dynamic mode Foundry draws the ring
  *under* the subject (core's ring shader blends the token over it), so the export
  is the two subject layers only and the subject is sized to end inside the colour
  band (~0.66 of the token).
- **Erase/restore masks live in SOURCE space**, mapped through the inverse of
  `subjectMatrix`, so re-framing after masking keeps them on the hair they were
  painted over. They are saved as one PNG beside the token (restore in R, erase in
  G) and reloaded from `maker.maskPath`.
- **Saves go next to the portrait** as `<stem>_token.webp`, a fresh `-2`, `-3`
  name each time so no client shows a cached copy; core/system/module paths and
  refused uploads fall back to `worlds/<world>/sta2e-tokens/`. The stem drops
  the portrait's own "Portrait" word (`Kira_Portrait` → `Kira_token`); a name
  the GM types is kept as typed.
- **Image ring mode has built-in baked frames** ([token-frames.js](scripts/token-frames.js)):
  Solid, Double, Starfield, Metal, Stone, Marble, Federation Citizen,
  LCARS, Duty Uniform, Klingon Carved Stone and Romulan Crescent, drawn at the output size in one colour
  (`frameStyle` / `frameColor`; bevel shades are derived from it) and painted
  into the token — so unlike a dynamic ring, each token can wear its own frame
  and colour. `frameStyle: "custom"` uses `ringImage` instead; a recipe saved
  before built-ins existed (no `frameStyle`, has `ringImage`) loads as custom.
  Stone and Marble are procedural (seeded value-noise fBm in coordinates
  normalised to the token size, so the grain matches at every size), and every
  frame is drawn once per size/style/colour onto a cached layer — the preview
  redraws on each pointer move, and the texture costs ~13 ms to build.
  Each frame declares its `opening` (the maker fits the mask to it) and its
  `pips` / `emblem` placement, as the dynamic rings' spritesheets do. The
  Klingon frame's edges are seeded polygons (`_jaggedRing`, straight chords
  looked up by angle, each cut lit by its own normal); its **inner edge may
  only bite inward past the opening** — outward it would leave a gap between
  portrait and stone. The Romulan crescent lies *over* the portrait's edge
  (opening 0.905) rather than in a gap of its own, which would leave a dead
  black band round the bottom.
- **Every render replaces the canvas**, so its pointer handlers are attached in
  `_onRender`; panel handlers are delegated once in `_onFirstRender`. Mode rows are
  shown by `data-tool` / `data-ring-mode` / `data-fill-mode` on the root.

**Toolkit dynamic rings** ([starfleet-ring.js](scripts/starfleet-ring.js)):
the **Starfleet Metal Ring** (id `sta2eStarfleetDelta`, kept from when it carried
a delta) and the **Starfield Ring**, registered on
`initializeDynamicTokenRingConfig` (fired once after `setup`; `addConfig` throws
afterwards). An LCARS style and two commbadge rings were tried and retired; the
retired commbadge ids are moved to the Starfield Ring by the active GM on
`ready` (`RETIRED_RINGS`), since core silently falls back to steel for an
unknown id. The art in `assets/rings/` is generated by
[tools/starfleet-ring-atlas.js](tools/starfleet-ring-atlas.js) in a browser and
committed — that file documents how core tints a ring (colour × red channel
inside the band, art as drawn outside it, background overlay-blended). **Core
uses one ring configuration per world** (`core.dynamicTokenRing`, requires
reload), so choosing one restyles every dynamic ring — which is why **no ring
carries a badge**: anything per token is stamped by the Token Maker.

Three things the rings rest on, all easy to break:

- **The Starfield Ring tints through mask frames** (`token-ring-<size>-msk`).
  With a mask core zeroes the colour band and lays colour × the mask's red
  channel over the art wherever the mask is drawn — the only way to tint *two*
  separate rings while the starfield between them stays as drawn. The ring
  frames also carry `ringColor` / `backgroundColor`, core's per-frame defaults,
  so an untinted token shows red.
- **Spritesheet `config` keys of the toolkit's own** (core ignores them):
  `subjectRadius`, where the Token Maker sizes the portrait; `pips`
  (`{dist, scale}`) and `emblem` (`{dist, r}`), where the rank plate and the
  emblem disc sit on that ring; and `cutouts`, discs removed from both subject
  layers (supported, currently unused). Add any of them to a new ring and the
  maker follows it.
- **A ring's opening must be at Foundry's 0.6667, not wherever the art looks
  good.** Core assumes a ring's subject fills 0.6667 of the token
  (`TokenRing#defaultSubjectThickness`) and fits tokens against that. The first
  commbadge rings opened at 0.812 — 1.22× — and the portrait visibly spilled over
  the ring in Foundry while looking right in the maker's preview. The Starfield
  Ring opens at 0.6667 with the outer edge at 0.817, and each ring frame declares
  `ringThickness` (0.15, outer − opening) so core's grid fit mode scales the ring
  to the grid square. Any new ring style needs the same.

**Rank pips and emblems are stamped by the Token Maker, never drawn in the
ring** — a world has one ring design, so ring art cannot vary by rank or by
faction.
- `rankInsignia` parses the actor's free-text `system.rank` into one of four kinds —
  officer pips (plus Chief Warrant Officer as one hollow pip), a flag officer's
  gold-framed bar (Commodore/Rear Admiral LH 1 … Fleet Admiral 5), an enlisted
  arrow tab (PO3–PO1 chevrons, Chief/Senior/Master Chief add dots) or cadet bars.
  Flag and enlisted grades are matched before officer words, and a bare "Chief"
  is never read as enlisted ("Chief Engineer" is a post). `rankPips` is the
  officer-only alias older callers used. Abbreviations ("(jg)",
  "LCDR", "CPO", "RADM"…) are handled; crewmen and yeomen return null. `pipPlate` lays
  the plate on the ring's tangent at the bottom left, hollow (half-grade) pips at
  the upper-left end.
- Emblems ([token-emblems.js](scripts/token-emblems.js)) sit in a disc at the
  bottom right (`emblemDisc`): the two built-in commbadges (TNG, DS9/VOY) are
  drawn in vector; four more ship as WebP in `assets/emblems/` (Starfleet Command,
  Starfleet Delta, Cardassian Union, Klingon Empire), each carrying a default
  `frame` the maker switches to when it is picked — the Cardassian sits on an
  `oval` plate (`OVAL_ASPECT`), the Klingon shield `plain`; anything else comes from the world setting `tokenEmblems`,
  added in the maker. **Adding a PNG/JPG converts it to WebP** (`convertToWebp`)
  and saves it to `worlds/<world>/sta2e-emblems/`; SVG and WebP are used where
  they are. A library emblem can sit on the gold starfield disc or plain.
- Both are the last layers, so in dynamic mode they ride on the subject over
  Foundry's ring. A promotion or a change of insignia means re-saving the token
  from the maker.

### Zone System

Three-file system:
- [scripts/zone-data.js](scripts/zone-data.js) — data model, scene flag CRUD (`FLAG_KEY = "zones"`), geometry (point-in-polygon), BFS zone-distance calculation, range bands (Contact/Close/Medium/Long)
- [scripts/zone-layer.js](scripts/zone-layer.js) — `ZoneOverlay` PIXI rendering layer
- [scripts/zone-editor.js](scripts/zone-editor.js) — `ZoneEditState`/`ZoneToolbar` for hex stamp, polygon draw, flood-fill edit tools

Zones are stored as scene flags. The ruler measurement is patched in `main.js` to annotate distances with zone counts when `zoneRulerOverride` is enabled.

**Multi-zone tokens:** very large ships (Borg cubes, stations) can be flagged via a Token Config checkbox ("Occupies Multiple Zones", token flag `flags.sta2e-toolkit.multiZone`, injected by [scripts/zone-token-config.js](scripts/zone-token-config.js)). Flagged tokens test their full footprint rect against zone polygons (`getZonesForToken`) and may occupy several zones at once. Range is measured to the nearest occupied zone (`getZoneDistanceBetweenTokens`, multi-source BFS); weapon range checks and area-attack target filters use this. Hazards and movement remain center-based. Note: the hazard effect property `establishedEffects.multiZone` in zone-hazard.js is unrelated.

**Dynamic zones:** range bands without a zone grid ([scripts/zone-dynamic.js](scripts/zone-dynamic.js)). Scene Config → STA2e Zones sets the flags `dynamicZones` and `dynamicZoneRadius` (px; blank falls back to the world setting `dynamicZoneRadiusDefault`, 300). Every token carries its own zone of that radius around its **footprint**, measured edge to edge, so a big hull gets a big zone: Contact when touching, Close ≤ R, Medium ≤ 3R, Long ≤ 5R, Extreme beyond (a zone is 2R across). **Drawn zones always win** — dynamic only applies while the scene has none. Anything that asks "what range is this?" or "who shares this zone?" should go through `getRangeContext()` + `measureTokenRange()` / `tokensSharingZone()`, not `getSceneZones()` directly; weapon range, the ship and ground Area pickers, warp core blast, `tokensWithinClose`, the hover label, the ruler and `game.sta2eToolkit.getZoneDistance()` all do.

**Movement** is measured **centre to centre** (not edge to edge — it is the token going somewhere, not two hulls apart) with the same bands, so `n` zones of movement reaches `dynamicReachRadius(n, R)` = R × (2n + 1): a ground Move is 3R, Impulse and Sprint 5R. Point-to-point movement goes through `measureMovement()`, and a result is usable only if `isMovementMeasured()` — a dynamic result deliberately has **null `fromZone`/`toZone`**, so the old `!info.fromZone` guard would silently reject every dynamic move. The drag readout, the Impulse/Warp destination tether, the combat movement warnings and the movement log all use it. With no zone borders on the map, the drag readout and the tether **draw rings** instead (`drawDynamicZoneRings` onto the caller's own Graphics; the tether draws just the `maxZones` reach). Dynamic moves cost no Momentum *from the zones themselves*, since there is no zone terrain to charge for. Terrain and hazards come from **Region Terrain** below, which works on dynamic scenes too. The movement log shows "Starting Position → New Position". Cover stays drawn-zone only. Covered by [tests/zone-dynamic.mjs](tests/zone-dynamic.mjs).

### Region Terrain

Terrain, hazards and obscured areas painted with **Regions**. These are independent of the zone grid, so they work the same on drawn-zone, dynamic-zone and zoneless scenes. There are three RegionBehaviorTypes ([region-terrain-behaviors.js](scripts/region-terrain-behaviors.js)), registered the same way as the Warp Viewscreen: manifest `documentTypes`, namespaced ids, i18n keys, and a **world relaunch** whenever the manifest changes.

| type | does |
|---|---|
| `sta2e-toolkit.difficultTerrain` | Crossing costs `momentumCost` (Threat for NPCs) |
| `sta2e-toolkit.terrainHazard` | One hazard (`terrain` / `lingering` / `immediate`); stack behaviors for several. Its `established` ObjectField is written in code only, and the auto-sheet skips it |
| `sta2e-toolkit.sensorShroud` | `potency` 1–5, plus four switches: `hideTokens`, `affectSensors`, `affectAttacks`, and `hideWithinShroud`. The last one removes the "viewer has a token in the same shroud" exception. It is checked on its own (`hiddenWithinShroud`) rather than inside `sharesShroud`, so sharing a thinner shroud around it cannot lift it |

[region-terrain.js](scripts/region-terrain.js) is the query layer. It imports only region geometry and `HAZARD_TYPES`, and memoises features per scene; the Region and behavior hooks invalidate that cache. Four rules it depends on:

- **Charged once per Region, at its max.** A Region that already contains the move's origin is not charged at all, because leaving costs nothing. Crossings are found by sampling the straight segment through `regionContainsPoint`, which is what keeps holes correct. `regionMovementCost` is added to the zone path cost in `onTokenMove`. The movement card now also posts for a Region crossing that stays inside one zone, or that happens on a scene with no zones.
- **A Region hazard is presented in the same shape as a zone `hazards[]` entry** (`regionHazardView`), plus a `source` ref. [zone-hazard.js](scripts/zone-hazard.js) reaches every hazard through `resolveHazardSource(ref)` (`{kind:"zone",zoneId,hazardId}` | `{kind:"region",sceneId,regionId,behaviorId}`). `setupHazard` / `resetHazard` accept either a ref or the old `zoneId`. Old card payloads that carry only `zoneId` map to a zone ref.
- **Hazards resolve on a GM-only HAZARD ENTRY card, never on the mover's client.** A move posts one card, whispered to the active GM, covering every lingering hazard it entered. Paying for hazardous terrain with Threat posts the same card for those terrain hazards; paying fully in Momentum posts nothing. Rows offer Build & Apply, Apply Established and Ignore, and each marks itself resolved in the message flags. Terrain rows never draw on the Threat pool again: the crossing already *added* that Threat, and RAW spends it on the hazard. The builder can **impose a trait** instead of damage (flat 2 Threat, through `createTraitFromData`). Lingering hazards stay damage-only, since they tick every round.
- **Reveal is the only thing that uncovers a hidden vessel** ([sensor-contacts.js](scripts/sensor-contacts.js)):
  - The officer picks no target. The roll goes to the active GM (socket `sensorReveal`), who takes the candidates as hidden vessels within Long range. A vessel inside a shroud with `affectSensors` counts only if the roll made `3 + potency` successes. The GM picks one candidate at random, sets `flags.sta2e-toolkit.sensorRevealed`, and posts a card: "Bearing 047 mark 15 · Medium range", plus the zone name on a drawn-zone scene.
    - The **bearing** is measured from the scanning ship's nose, Trek-style: 000 dead ahead, 090 starboard, 180 astern, 270 port (`relativeBearing`). It relies on the convention that **ship token art is drawn nose-south**, so at rotation 0 the bow faces map bearing 180 (`SHIP_ART_NOSE_BEARING`) and Foundry's rotation turns it clockwise from there. Art drawn facing another way will read off by that offset.
    - The **mark** (`contactMark`) is an edge-to-edge distance scaled so each band spans ten units: Close 1–10, Medium 11–20, Long 21–30, then Extreme 31–40 for one zone past Long, 41–50 for two, and so on. 0 is Contact.
    - Under dynamic zones, and on zoneless scenes using the default radius, the mark is exact. With drawn zones it is estimated within the band from a typical zone's width, clamped so it never disagrees with the band.
    - Covered by [tests/sensor-contacts.mjs](tests/sensor-contacts.mjs).
  - A roll that fails, finds nothing, or is beaten by a shroud posts the same "No contacts" card, so the player learns nothing from it.
  - The reveal is cleared when the vessel moves, cloaks or decloaks.
  - A revealed **cloaked** ship stays `hidden`. Every client draws a SENSOR CONTACT marker for it straight off the flag (no socket), and `resolveStarshipActionTarget` offers it as an anonymous target.
  - Sensor Sweep is information only: it adds shroud potency to Difficulty and whispers the GM a report.

Attack Difficulty is `concealmentAttackDifficulty`: **+2** on a revealed hidden vessel, otherwise **+potency** inside an `affectAttacks` shroud, and the two never stack. It is applied through `_concealmentDifficultyMod` in the roller, next to Small Craft. That function reads `weaponContext.primaryTargetTokenId` **before** `game.user.targets`, because a revealed cloaked ship can't be Foundry-targeted and arrives only as the explicit pick. Next it prefers the Foundry target over the actor-id lookup, because a reveal is per token and several unlinked ships can share one actor. **Opposed attacks lock their Difficulty before the roller opens, so every lock site must add it too:** the two `_shipAttackDifficulty(…, opposed.difficulty, …)` calls take a `concealmentPenalty` option, and each `pendingOpposedTask` write carries `concealmentPenalty` for the hand-rolled sum in `main.js`. Missing those was why the +2 never landed against a ship using Evasive Action or another defense. It is also applied as the opposed pipeline's `concealmentPenalty`, so it is counted once on each path. Hiding is a `Token#isVisible` libWrapper wrap in [zone-visibility.js](scripts/zone-visibility.js), not `testVisibility`: core never reaches `testVisibility` for a GM or on a scene without token vision. Covered by [tests/region-terrain.mjs](tests/region-terrain.mjs).

### Planetary Rings & Orbital Views

[star-system-scene.js](scripts/star-system-scene.js) builds five planet layouts:
Encounter, High Orbit, Low Orbit, Ring Plane and Overview (`PLANET_SCENE_LAYOUTS`).
Every planet goes through `placeBody`, so a ringed procedural body gets the same
three things wherever it is placed. That includes the system map.

- **Rings are split into two tiles for 2.5D.** `planetPixelRows`
  ([planet-generator.js](scripts/planet-generator.js)) takes a `ringLayer` option:
  - `back` is the globe plus the far half of the ring (`ringZ <= 0`).
  - `front` is only the near half, over transparency.
  - The invariant is that **front composited over back equals `all`**, and
    [tests/planet-ring-layers.mjs](tests/planet-ring-layers.mjs) checks it.
  - `sceneImage` is now the back layer and `sceneRingFront` is the front one. The front
    tile sits at `elevation` 10, because `canvas.primary` sorts by elevation before
    anything else: a ship at 0–9 flies under the near arc, a higher one over it.
  - `proceduralSceneImageIsCurrent` fails for ringed art that has no front layer, so
    older art regenerates once.
  - `planetSceneRingFront` returns "" once the portrait is replaced, the same rule
    as `planetSceneImage`.
- **Each ring gets a Region** (`ringRegionData`):
  - Shape: an outer `ellipse` with the inner one as a `hole`. It is squashed by
    `cos(axialTilt)` exactly as the renderer projects the ring, and rotated with the tile.
  - Its radii come from `ringVisibleExtent`, not from the material's 0.61–1.0 layout.
    That function measures where the rendered coverage reaches a useful share of the
    ring's peak. The faint inner rim and outer strand barely show, so the fixed limits
    made the Region visibly larger than the painted ring.
  - Behaviors: Difficult Terrain (1) and a Sensor Shroud (potency 1, tokens not hidden).
    The dialog's ring-terrain box drops the behaviors but keeps the Region, because the
    dust wake needs it.
  - The Region is only made for procedural art, where the geometry is known. Custom
    ring art gets no guessed Region.
- **Low Orbit and Ring Plane render a crop, not a scaled disc.** The `viewport`
  option `{width, height, radius, cx, cy}` renders part of a globe that may be
  20 000 px across, and its centre may be off the image.
  - The crops are saved by `saveProceduralViewCrop`, at half the scene resolution
    (`CROP_SCALE`).
  - `view: "ring"` looks face-on down the pole.
  - The whole-disc path keeps its original expressions, so cached textures stay byte-identical.
  - Both layouts need a procedural recipe.

**Dust wake** ([ring-dust-wake-vfx.js](scripts/ring-dust-wake-vfx.js)):
- **No socket.** Each client's own `updateToken` hook follows the token's animated
  `mesh.position` and emits puffs only while that point is inside a `planetRing` Region.
- It is **not** gated by `sta2eScriptedMove`, so Impulse glides billow the whole way.
- It emits nothing for a token this client cannot see, so it never reveals a cloaked ship.
- Client setting `ringDustWake`.

### Cloaking Device

There are three ways to cloak: the Combat HUD button (`_handleCloakToggle`), the sheet-panel roll (`handleCloakActivateResult`), and the Token HUD Ship Command section. **All three go through `applyCloakEngage` / `applyCloakDeactivateForOfficer`** in [combat-hud-core.js](scripts/combat/combat-hud-core.js). The HUD button used to carry its own copy of the sequence; never give it one again.

**Shields.** Engaging drops them to zero through the same "lowered" state as Lower/Raise Shields (value and max both 0, the pre-cloak value and max saved), so nothing can regenerate them while cloaked. Decloaking restores exactly what was saved.
- The flag `cloakLoweredShields` records that the cloak did the lowering.
- If shields were already lowered by hand before cloaking, the cloak leaves them alone and decloaking does not raise them.
- If they were raised by hand while cloaked, decloaking changes nothing.

**Hit shimmer.** `CombatHUD.applyDamage` calls `broadcastCloakHitShimmer` when the target is cloaked ([cloak-hit-vfx.js](scripts/cloak-hit-vfx.js)).
- The effect is a separate sprite built from the token's own texture on `canvas.tokens`: tinted, with an additive halo, a DisplacementFilter driven by a scrolling tiling noise map, and a flickering ~1.5 s envelope. It shows on every client even though the token stays `hidden`.
- Socket action `cloakHitShimmerVfx` is scene-guarded, with the source token's scene id.
- Teardown destroys the sprites but **never their textures**: the noise map is shared and the hull texture is the token's own.

### Active GM (assistant GMs)

Some tables seat players on GM-role accounts. [gm-authority.js](scripts/gm-authority.js) (a leaf with no imports) names **the** GM through the world setting `activeGmUserId`, chosen from the badge under the Stardate HUD. Any GM can claim the role or hand it on. When the designated user is offline, authority falls back to the lowest-id connected GM (the old `_isResponsibleGM` rule), so the table never stalls. `_isResponsibleGM()` now delegates to `isActiveGM()`, which re-points every socket gate; `destructible-objects.js` `authority()` follows too.

**Assistant GMs keep every GM tool but are treated as players** in three places:
- **Authority:** the socket handlers and per-round lingering damage run only on the active GM.
- **GM-only whispers:** hazard entry cards, Reveal detail, sweep reports and movement cards go to `activeGmWhisperIds()`.
- **Hidden information:** shrouds and obscured zones apply to assistant GMs, and cloaked (`hidden`) tokens are screened from them unless revealed. This is table etiquette, not security.

Code gating *GM tools* should keep checking `game.user.isGM`. Code gating *authority or secrets* should use `isActiveGM()` — **never core's `game.users.activeGM`**, which ignores the badge (it picks by role, then id). `trek-fx.js` and `interior-prefab-scene.js` carry an inlined copy of `isActiveGM` instead of importing it, because their tests link them with no dependencies — keep those copies in step with `gm-authority.js`.

React to a change through the `sta2eActiveGmChanged` hook (fired from the setting's `onChange`), not `updateSetting`: the first write in a world *creates* the Setting document and fires only `createSetting`, so an `updateSetting` listener made the switch look ignored until someone reconnected. `setActiveGM` relays the write over the socket (`setActiveGm`) when the clicking GM lacks core's `SETTINGS_MODIFY` permission, which a world can deny to Assistant GMs.

### Procedural Interiors: Habitat Runs

The `habitat` deck architecture ([interior-habitat.js](scripts/interior-habitat.js)) builds an
**encounter slice**, not a whole deck: a passageway running edge to edge with an isolation door
near each cut end, an outboard row of cabins and window rooms, an inboard row of support rooms,
a lift bay and a branch corridor. Each lift is a bare circular car with its own door, 3 squares
across (`LIFT_RADIUS`), so a 2 × 2 block of tokens fits inside. The shared lift test caps other
plans at 2.5 and habitat at 3.1. Small crew cabins (single, junior-officer pair) also go inboard,
where they get no windows; family cabins and suites stay on the hull. It returns early
from `generateInterior` and classifies its own edges.

A cabin is **one `quarters` room, not one room per section.** Living, bed, closet, head, study and
the private hall are partitions with native doors inside it (`architecture.type ===
"habitat-cabin"`), the same mechanism the measured cabins use. That is load-bearing: the shared
generation tests require the non-corridor room kinds to equal the selected palette exactly, and
require every `quarters` room to carry `architecture.bathroom`, `livingPolygon` and `furniture`.
Escape pods are `corridor`-kind alcoves (`pod: true`) for the same reason.

Six things it rests on:

- **Every room is a rigid rectangle on a chord.** Outboard rectangles diverge going outward and
  leave thin structural ribs at the hull; inboard ones converge, so `inboardGap` opens a sliver of
  wall mass between them. Nothing is ever fitted into a wedge. The radius grows with the slice
  length (`target * 2.4` floor), so a slice stays a gentle bow.
- **Cabin layouts are section lists** (`HABITAT_CABINS`). Each closet belongs to the adjacent
  bedroom not already served, so two bedrooms put their closets back to back between them. Cabins
  with several rooms sharing a head get a private hall on the corridor side; the bedrooms, study
  and head open off it. Walk-through cabins put every internal door on one door line. Junior officers' quarters have no closet rooms: bed, shared head, bed. Consecutive cabins
  alternate direction so heads meet heads.
- **A head is at least 1.6 squares wide** (shower, toilet and sink on the wet wall at the cabin
  end, where it backs onto the next head), and every door is at least 1.1 squares long. The
  tests enforce both.
- **Exact doors and windows are inserted vertices.** A cabin's entry door and its hull windows are
  extra points on its polygon edge. `interiorEdges` T-junction-splits the neighbouring corridor at
  them, and the matching sub-edge is marked `exactDoor`/`exactWindow` by key.
- **Corridor pieces must meet on a real shared vertex.** `anchor()` snaps each cut (isolation
  doors, open map ends) to the nearest vertex in each boundary line. Without it, a room corner
  that rounding left a hair inside the cut was deduplicated away, and the end piece came out
  disconnected.
- **`interiorEdges` is passed in, not imported**, which keeps this module out of
  `interior-layout.js`'s import graph.

### Procedural Interiors: Jefferies Tube Networks

The `jefferies` deck architecture ([interior-jefferies.js](scripts/interior-jefferies.js)) is
crawlways only. A randomised Prim tree over a lattice (uneven 6–8 square spacing) plus a few loop
links; **every node is an octagonal junction** (`jefferiesOctagon`, flat faces toward all eight
compass directions), so a tube running orthogonally or at 45° always meets a face squarely. Four
rules it rests on:

- **A diagonal is only allowed across a square cell**, and at most one per cell, so diagonals
  never cross and always hit a diagonal face.
- **The face (1.45) is wider than the tube (1.2)**: tube ends land inside a face, never on an
  octagon corner, and `interiorEdges` T-junction-splits the face at them. Tests check both numbers.
- **Dead ends are ladder access points** (`access: true`). Two boundary nodes get a short tube to
  a hatch onto a `corridor`-kind "Deck access" stub whose far edge is an open map cut. Every
  tube has a door at each end: a `hatch` edge marked `exactDoor`, so it spans the full 1.2-square
  tube width (a one-square token passes) and still draws the hatch markings.
  `interiorWallSegments` carries `hatch: true` through on an exact door for this.
- **Straight tubes (`tube: true`) tile the `jefferies` asset** (`assets/interiors/jefferies-tube.png`, an
  opaque 1536 × 1024 tile that repeats top to bottom), turned onto the tube axis and stretched across
  its width. The renderer embeds it only when the map has tubes, since it is ~2 MB as a data URI.
  The curved service crawlways of the hull-section plan keep the drawn style.
- **It ignores the room palette.** The shared palette tests exempt this plan explicitly, and the
  generator dialog disables the room-type choices for it. Do not "fix" either exemption.

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

**Q tab** ([scripts/q-spawner.js](scripts/q-spawner.js)) is the transporter without the in-fiction limits — no six-pattern cap, no emitter types — plus a **Q Flash Move**: select tokens, click once, and the whole group is translated by one offset, keeping its shape. The actions that operate on tokens already on the canvas — Flash Move, **Flash Kick**, Snap Out + Hold — live in [scripts/q-actions.js](scripts/q-actions.js) rather than the tab, because the Token HUD needs them too ([scripts/q-hud.js](scripts/q-hud.js) is the toolkit menu's Q section, GM-only, with **no actor-type gate** — unlike the Ship Command section it is offered on every token). `resolveQTargets(token)` is the shared rule for what they act on: the current selection when the HUD's token is part of it, otherwise just that token.

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
Bottom to top: `backdrop → image → haze → stars → environment → wash → image → grain → bloom`. The image appears twice because it is one sprite with two possible parents (see **Backdrop images** below).
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

**Look presets.** Every environment ships a tuned `defaults` block and picking
one writes it — a starting point, not a destination, so a GM who had dialled a
slipstream to taste redid the same dozen sliders on every region and every scene.
[viewscreen-presets.js](scripts/viewscreen-presets.js) saves that work: named
presets **filed under an environment**, in one world setting shared by every
region, every scene and a co-GM.

**`resolveEnvironmentLook(id)` is the single answer to "what does this
environment look like"** — the built-in tuning with the GM's *default* preset for
that environment laid over it. Anything that used to call `environmentDefaults`
to seed a look should call this instead; `environmentDefaults` remains the way to
ask for the shipped tuning specifically, which is what the panel's
"Built-in defaults" row does. One preset per environment may be the default, and
that invariant is enforced in `setDefaultViewscreenPreset` **and** re-enforced in
`normalizeViewscreenPresets`, because a hand-edited setting or two clients racing
must not be able to leave two.

Four things it rests on:

- **A preset stores the look and nothing else** (`PRESET_FIELDS`). Not `phase`,
  not `warpFactor`, and deliberately not `vanishX`/`vanishY`/`inbound`/
  `aboveTokens` or the backdrop image — those describe *this region*, and
  carrying them between regions would aim one viewscreen at another's vanishing
  point. `environment` is the key a preset is filed under, not a field it holds.
- **There is no write-through here, unlike the image library.** Moving a slider
  must not quietly rewrite the saved preset, or a GM could never try something
  without losing what they started from — so presets carry an explicit Update
  button where the image block deliberately has none. That asymmetry is the
  point, not an oversight.
- **`lookPreset` on the behavior is only a pointer** into a world-level library,
  which is why `_hideLookPresetField` takes it off the config sheet entirely
  rather than injecting a select over it. Removing the whole form group also
  removes it from the form, so ordinary submission leaves the stored value alone
  instead of blanking it.
- **The panel needs an `updateSetting` hook.** Presets are a setting, not a
  document, so none of the `*RegionBehavior` hooks fire when a co-GM saves one
  and the panel would show a stale list. Preset writes also do not come back
  through `_apply`, so `_runPresetWrite` re-renders itself.

Deliberately **not** shared with Scene Warp: the two surfaces share most look
field names but not all of them, and a half-applying preset is worse than none.

**Backdrop images.** A viewscreen can *show* something — a planet, a starbase, a
star chart, a tactical display — as a sprite drawn inside the region outline and
clipped by the same mask as everything else. The GM keeps a **named library per
region** and flips between entries from the panel mid-scene.

The data model is split in two, and the split is what makes the config sheet work
for free:

- **The live backdrop is seven flat schema fields** (`imageSrc`, `imageFit`,
  `imageScale`, `imageOffsetX/Y`, `imageAlpha`, `imageAbove`). The renderer reads
  those directly and never looks an entry up by id.
- **`images` is an `ArrayField` of saved presets**, and `activeImage` names one.
  Picking an entry **copies** its values into the live fields in one update —
  exactly the shape the Environment select already uses for
  `{ environment, ...environmentDefaults(id) }`.

**Core's auto-sheet is what forces that split, and it does it silently.**
`RegionBehaviorConfig#_getFields` only emits schema fields whose class has
`hasFormSupport`, which is defined as "overrides `_toInput`". `ArrayField` does
not, so the library is skipped with no error and no broken control — while
`FilePathField` *does*, and renders a native `<file-picker>`. So the live row
costs no injection at all, and the only hand-built control is the `<select>` that
replaces `activeImage`'s bare id textbox (`_injectImageLibrarySelect`, a sibling
of the vanishing-point button on the same `renderRegionBehaviorConfig` hook). It
writes the chosen entry into core's own rendered inputs and lets ordinary form
submission persist them — the same native-form-path trick, so the sheet still
never calls `document.update()`.

Five things the implementation rests on:

- **One sprite, two parents.** `imgBelow` sits on the backdrop colour under
  everything that moves; `imgAbove` sits over the wash (so it is not tinted) but
  under the grain and bloom — a screen breaking up should break up *over* the
  picture. Both containers are built in `_buildLayers` and never move;
  `imageAbove` `addChild`s the one sprite into the other, which reparents with no
  texture reload and no child-index maths that differs across PIXI majors.
- **Any layer the dark gate switches off must have an owner that switches it back
  on.** `_setFieldVisible` hides the animated layers individually, and a layer
  nobody claims stays hidden for good — which is exactly what happened to
  `envLayer`: nothing set it `visible`, so turning off "Drift When Idle" once
  emptied the environment pool permanently, invisible on plain warp (which has no
  pool) and total on a tunnel (where the pool *is* the effect). `_syncEnvLayer`
  now owns it, alongside `_syncHaze` / `_syncWash` / `_syncGrain`; the function's
  docblock carries the full ownership table.
- **The dark gate can no longer hide the container.** A GM showing a still planet
  with drift off must see the planet, not a black rectangle — the same argument
  `interference` already wins. `_setFieldVisible` turns the *animated* layers off
  individually instead, and comes back on by re-running the syncs that already own
  their own visibility rather than second-guessing them. `refreshViewscreen` and
  `rebuildMask` must **re-assert it after their sync pass**, or a slider nudged
  while dark quietly relights the haze and the wash.
- **Offsets are fractions of the region's own bounds, not pixels**, so a saved
  backdrop keeps its framing when the region is later moved or reshaped.
- **The texture cache is shared and must survive teardown.** `_loadImageTexture`
  is the `hull-decals.js` three-tier loader with its negative cache (a 404 is
  resolved once). `_destroyInstance` therefore destroys the sprite but **not** its
  texture — *except* for a video, which the instance owns outright because a
  `<video>` carries one playhead and two regions on one file would share it. That
  is the whole reason `imgOwnsTexture` exists.
- **The panel is two columns, and they scroll separately.** The image block is
  the whole right-hand one. Both columns are a fixed `COL_W` and the shell a
  fixed `PANEL_W`, so the panel never resizes under the pointer as controls
  appear and go away; `COL_MAX_H` caps the height so a long column scrolls
  instead of running off the bottom of the screen, which is what the
  single-column panel did once the image block was added. A *shared* scrollbar
  on the body would have dragged the short column out of view with the long one.
  `_showSide` collapses the second column with `style.display` rather than
  `hidden`, since every style here is inline and an inline `display: flex`
  outranks the UA stylesheet's `[hidden]` rule.
- **A backdrop's file is its identity; everything else is its framing, and the
  two must not be treated alike.** `_apply` mirrors live edits back into the
  active library entry so a nudged slider sticks to the saved backdrop — but it
  mirrors `IMAGE_FRAMING_FIELDS`, **not** `IMAGE_ENTRY_FIELDS`. With `src` in
  that mirror, browsing for a second picture rewrote the *first* entry's file
  before the second had even been saved, so every entry ended up pointing at the
  most recently chosen image and the library looked broken. Changing the file
  therefore **detaches** (`activeImage: ""`) on both surfaces rather than writing
  through, and the select drops to "Not from the library" until it is saved under
  its own name.
- **Selecting an entry must settle every live field**, falling back to
  `IMAGE_ENTRY_DEFAULTS` for any key it never stored. Foundry drops `undefined`
  from an update payload, so a missing key silently leaves the *previous*
  backdrop's value in place — the same class of sticky-state bug, one step
  removed. The fallback uses `??`, since an offset of 0 and `above: false` are
  real values.
- **`_syncImage` is fire-and-forget and must never reject.** It is called from the
  three sync paths (`attachViewscreen`, `rebuildMask`, `refreshViewscreen`) and
  awaited by none of them, so the async half is wrapped. After the await it
  re-checks both `inst.finished` and that `imgSrcLoaded` is still the file it
  started loading — the GM can pick a different one mid-flight.

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

### Deflector Dish

The navigational deflector, fired from the Token HUD's **Deflector Dish** section
([deflector-hud.js](scripts/deflector-hud.js)) and drawn by
[deflector-vfx.js](scripts/deflector-vfx.js). Four looks out of one placed
emitter:

| type | shape | aims at |
|---|---|---|
| `chargeGlow` | tiny motes drawn in from open space ahead of the ship, straight down a cone into the dish | nothing |
| `pulse` | a crescent shockwave — smooth bright front, turbulent fog tail — that **swells and slows** as it crosses | a target |
| `beam` | **several** lances fanned across the target area | a target |
| `stream` | a translucent column with glowing motes running down inside it — **latched**, so it holds until stopped | a target |

**Purely cosmetic** — no roll, no Power cost, no chat card, no rules hook. The
engine trail is the contract it matches, and most of its scaffolding is that
file's, lifted deliberately. Only the charge cone is aimless; the other three
take a target point (a targeted token, else a canvas click) from whichever
surface fired them, which is also why the emitter's **facing aims the charge
cone and nothing else**.

**The effect type is ship state, not emitter state.** A dish is one physical
location and all four effects come out of it, so a `type` field on the emitter
would mean stamping four markers on the same pixel and a marker list of
overlapping dots. `anchors.deflectorEmitters` is pure placement
(`{x, y, label, facingDeg, layer}`, facing defaulting to **0 — fore**, unlike an
exhaust's 180) and `settings.deflector` is
`{enabled, type, chargeGlow, pulse, beam, stream}` — structurally `engineTrail`
with four modes instead of two, which is what makes every normalizer a near-copy.
Six dials are shared (`colorMode`, `customColor`, `alpha`, `blendMode`, `width`,
`durationMs`); the rest are per-type and are emitted **only for the types whose
defaults declare them**, the same way the engine block treats `glowSize`.

Six things the implementation rests on:

- **`_deflectorRows` is why four effect types did not cost four template blocks.**
  `_chargeRows` had already established a generic dial descriptor
  (`{key, label, type, min, max, step, value, isColor, pickerValue}`) rendered by
  one `{{#each}}` and read back by one `[data-…-setting]` sweep. The deflector tab
  is that pattern again, so adding a fifth effect is a table entry.
- **The dials are read back onto the type the FORM was built for**, stamped as
  `data-deflector-form-type` on the settings block — not onto whatever the type
  select currently says. A `change` on that select fires *before* the re-render,
  so reading it live would copy one effect's dials onto another's block. Same
  hazard, and same fix, as `_emitterFormIndex`.
- **A preview is always a burst, even for the two sustained types.** Auto-preview
  fires on every slider change, and a charge glow that held would sit lit on the
  canvas until the GM went hunting for the Stop row. `previewDeflectorEffect`
  releases it after `PREVIEW_HOLD_MS`, the same beat the warp-glow preview uses.
  It also takes settings and emitters **as arguments**, like `previewEngineTrail`,
  so unlike the warp glow the editor never has to persist the flag to see what it
  is dragging.
- **`createBeamRibbon` exposes `setSegment`, so the lance tracks a moving hull.**
  Both the shader path and the mandatory Graphics fallback (the ribbon returns
  **null** whenever `beamShaderAvailable()` is false) are re-placed every frame
  from a re-read emitter point, so the two cannot drift apart in behaviour. One
  container alpha drives the envelope for both, because the beam shader's
  `_preRender` copies `mesh.worldAlpha` into `uAlpha`.
- **A charge mote rides a straight ray, held as `(along, lateral)` rather than as
  an angle.** Its offset from the axis is `u * along * tan(coneHalf)`, so both
  terms fall to zero together and the path is a line onto the dish that cannot
  leave the cone. Holding a fixed *angle* and shrinking the radius instead — the
  obvious formulation — seeds every mote on a circular arc and sweeps each
  through a curve: the field reads as **motes orbiting the ship** rather than
  being drawn in from the space ahead of it. There is deliberately **no swirl
  dial**; it was tried twice and it is the wrong read for an intake. The intake
  also reaches well out in front (`radiusPx` 420 against a 44° cone) — a short
  wide cone reads as a glow on the nose rather than as something being pulled in
  from open space.
- **A removed dial is removed from the DEFAULTS, not defaulted to zero.**
  `_normalizeDeflectorModeSettings` only emits a dial the type's own defaults
  declare, so deleting `swirlTurns` there also drops whatever a ship saved while
  it existed. Setting the default to 0 instead would have left every
  already-saved ship swirling, since a saved flag carries its own value.
- **The crescent is TWO layers, and the split is the whole look.** A *front* —
  seven nested lens fills sharing one outer arc, five shrinking inward plus two
  wider faint ones *outside* it, so additive stacking peaks at the leading edge
  and blooms just past it — and a *tail* of turbulent blobs shed **behind** that
  front, whiter, wider in sweep, dispersing and thinning backwards, and lagging
  further the faster the wave is still travelling (so it stretches on the way out
  and gathers as it slows in). An earlier version laid the haze *on* the arc,
  which fuzzed the leading edge and left the wave with no front at all: what
  makes it read as a shockwave rather than a cloud is that **one edge is clean**,
  so nothing noisy may touch it. `_drawCrescent` draws no bright spine for the
  same reason. The tail container is added **before** the front's Graphics, so
  the fog can never draw over the edge. The taper is still what makes it a
  crescent — the lens thickness and the fog density both fall to nothing at the
  tips on the same `(1 - u²)` profile — and the deceleration and the swelling are
  **the same eased parameter**, so they cannot drift apart.
- **`ringCount` defaults to 1.** One well-formed shockwave is the look; three
  staggered crescents read as ripples, which is a different effect.
- **The lance bundle fans about the DISH, not about its own centre.** Rotating
  each endpoint around the emitter is what makes the beams converge where they
  leave the ship and spread where they land — which is what "across the target
  area" means. Each lance gets its **own sub-container**, so a per-beam flicker
  is one alpha write and works for the shader too (`_preRender` copies
  `mesh.worldAlpha` into `uAlpha`).
- **A stream mote's lifetime is derived, never configured.** It holds a fixed
  lateral place in the column and advances at `speedPxPerSec`, so the life falls
  out of the distance — which is also what keeps the motes correct when the ship
  drifts and the column lengthens mid-flight.
- **Tint is written at seed and on recycle; alpha deliberately is not.** The fade
  along a mote's path *is* the effect, and these pools are two orders of magnitude
  smaller than a star field — the rule that matters is the colour conversion in
  the tint setter, which is what the Scene Warp note is about.
- **The stream is the one effect that can be LATCHED, and the latch has no
  timer.** `opts.hold` makes `_runStream`'s `emitting` predicate ignore
  `durationMs` and passes `totalMs: Infinity`, which `_makeRunner` reads as
  "arm no backstop" — the `Number.isFinite` guard there is load-bearing, since
  `setTimeout(fn, Infinity)` fires on the **next tick** rather than never. Three
  things follow. Its `stop()` must take the release level from the *sustained*
  brightness, or a column held for seconds computes a negative alpha off
  `durationMs` and snaps off instead of fading. `hold` has to travel **in the
  socket payload** — it is an instruction about the firing, not a look, and
  without it every remote client runs the burst and goes dark at `durationMs`
  while the firing client's column is still up. And it ends only on `stop()`,
  on `canvasTearDown`, or on `token.destroyed` — the per-tick check that exists
  because this is the first deflector effect that can outlive its ship — which
  is also why the stop handler's deliberately missing scene guard matters more
  here than anywhere else. The Token HUD's Stream row is a **toggle** built off
  the type-filtered `hasLiveDeflectorEffect(id, "stream")`, so a held charge
  glow cannot relabel it; the burst stays reachable from the editor's Preview
  and from `playDeflectorEffect`, which is what keeps the `durationMs` dial
  meaning what it says.

Sounds are four keys in **Settings → Sounds & Animations → Deflector**, played
**locally on every client** (`AudioHelper.play(…, false)`) because every client
runs `playDeflectorEffect` for itself off the broadcast — `true` there would
multiply one shot by the number of connected clients. The tab carries **no timing
rows**: every duration is a per-ship dial in the editor, where it is tuned against
a live Preview, and a second copy would be a stale second source of truth.

Socket actions are `deflectorVfx` / `stopDeflectorVfx`, play-locally-then-raw-emit
(never `emitToolkitSocket`), `sceneId` from the **source token's** scene, the
target as **coordinates rather than a token id**, and the stop handler
deliberately **un**-scene-guarded — a stop discarded on a guard strands a
sustained effect lit for good.

Covered by [tests/deflector-vfx.mjs](tests/deflector-vfx.mjs), which drives all
four renderers against a stubbed PIXI and asserts the teardown, the registry, the
hold-vs-burst split and the broadcast payload.

### NPC Roller

[scripts/npc-roller.js](scripts/npc-roller.js) — LCARS-styled dice roller dialog (`DialogV2`). Handles two pools (Crew and Ship), clickable die pips for rerolls, Targeting Solution bonus die, and Threat spending for rerolls after the first. Posts results as LCARS chat cards.

### Chat Card Frame

Under the Bracket Console themes (`BRACKET_THEME_KEYS` in lcars-theme.js: `lcars-tng` and
`lcars-fc`), every chat card the module posts other than the task card shares one frame — the
**Bracket Console**: open brackets at the four corners, the title centred in the top
bar's gap, segmented side arms — built by `lcarsChatCard` in
[chat-card-frame.js](scripts/chat-card-frame.js) (`tngChatCard`). It is the task card's
own frame: the same `bracketTop` / `bracketBottom` markup from
[task-card-tng.js](scripts/task-card-tng.js) and the same `.tbc` rules in
[styles/task-card-tng.css](styles/task-card-tng.css), so the two cannot drift. The
accent becomes `--tbc-c` (brackets and title); the side arms and bottom rule stay tan.
The module imports only `lcars-theme.js` and `task-card-tng.js` (itself importing only
`lcars-theme.js`), so any builder can use it without a cycle. The design source is
`docs/tng-card-mockups.html` (Concept B).

Two things the bracket frame rests on:

- **A corner bracket is a border elbow, not a fillet.** `.tbc-brk` has a thick left and a
  thinner top border with one outer radius; CSS draws the inner radius as the outer one
  less the border widths, which is the concave corner. `box-sizing: border-box` on it is
  load-bearing.
- **The side arms are the root's `::before` / `::after`**, positioned between the
  brackets, so neither builder emits markup for them. On a card shorter than two brackets
  they collapse to nothing, which is correct. The body pads itself clear of them.

**The TNG cards are set in Antonio**, bundled in `fonts/tng/` (Latin subset, SIL OFL,
licence text beside it) and declared in task-card-tng.css as `STA2e Antonio`, falling
back to Arial Narrow. Three things make it reach the text:

- **Neither root may carry an inline `font-family`.** The task card's renderer emits none,
  and `tngChatCard` runs the body through **`tngBodyHtml`**, which strips every inline
  declaration naming the Arial Narrow stack (bodies write `font-family:${LC.font}` almost
  everywhere) and keeps any other font a body chose. `injectSpendPanels` runs the same
  pass on the Momentum spend panel, which arrives after render.
- **`.tbc button, input, select` inherit the font**, since Foundry gives controls their own.
- **The chat body's children are zoomed 1.15.** Bodies set their sizes inline for Arial
  Narrow, which Antonio's narrower letters read small at, and no rule can outrank an inline
  size. The zoomed children lay out in the narrower zoomed width, so they still fit.

The reroll tray keeps Arial Narrow: `_armCardSelection` writes its font inline.

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

**Under `tos-panel` the same call returns the TOS Console Viewer frame** (`tosChatCard`):
a gunmetal housing, a header whose first lamp and left edge take `--ccf-c`, and the body
in a curved amber CRT. The body goes inside a `.ccf-body` (wirers use it as their host)
through **`tosifyBodyHtml`**, the TOS body pass, because every body — the damage cards
above all — draws LCARS shapes with inline styles that no rule can beat:

- **It classifies each tag by its inline style, then strips only what made it LCARS.**
  A bordered box with `padding:3px` is a stat *tile* (black readout), any other bordered
  div a *plate* (inset panel, keeping a left accent edge as `--tn-c`), a left border alone
  a *note* strip, a bordered inline-block span a *chip*, and inputs / selects *controls*.
  Their background, border, radius and shadow go; `font-family`, `accent-color`, every
  `border-radius` except `50%`, and faint `rgba(…, 0.x)` washes go everywhere. Text
  colour, layout, classes, `data-*` and wiring-toggled `display:none` stay, so a red
  banner stays red and every wirer still finds its elements. chat-card.css redraws the
  `ccf-tos-*` classes; checkboxes and radios become lamps.
- **Decorative emoji are stripped** (`stripDecorativeEmoji`, also on the title): the
  astral emoji and U+2600–26FF (💥 ⚠ ⚔). Arrows, shapes and dingbats (▶ ✓ ✗ ★ →) are
  functional and stay.
- **The Momentum spend panel is injected after render**, past the frame, so
  `injectSpendPanels` runs the same pass on it when its card is a TOS one.
- Buttons still go through `keyifyButtons`, which strips their inline background /
  border / colour / font and stamps `--tck-a` and `--tck-ink` for the gradient. The
  accent is the button's text colour, else its border, else — for a filled LCARS key,
  whose text is near-black — its fill; a near-black or translucent one falls back to the
  theme's primary. Code that repaints a button or a part at runtime still wins, since it
  writes inline afterwards. Covered by [tests/tos-cards.mjs](tests/tos-cards.mjs).

**Under `tmp-console` it returns the TMP Console Monitor frame** (`tmpChatCard`): a grey
duty panel, a header plate in `--ccf-c`, and the whole body on a black monitor whose
border takes the same accent. The body must sit on the monitor, never on the grey: every
body colours its text inline with the `tmp-console` tokens, which are made for black. Its
buttons go through the same `keyifyButtons` and become backlit lenses; the lens rules in
chat-card.css select on `[style*="--tck-a"]`, so buttons injected after render (the spend
panel's steppers) keep their own look.

**Under `ent-panel` it returns the ENT Bridge Touchscreen frame** (`entChatCard`): the
task card's own frame, built from the same `entHead` / `entFoot` markup and `.tec`
rules in [styles/task-card-ent.css](styles/task-card-ent.css). The body goes through
**`entBodyHtml`**, which is the TOS body pass with a different class prefix
(`_consoleBodyHtml(html, "ent")`): the same classifier strips the LCARS boxes and stamps
`ccf-ent-tile` / `-plate` / `-note` / `-chip` / `-ctl`, which task-card-ent.css redraws
as bracketed wells, glass plates and edge strips, and the buttons become tab keys painted
from `--tck-a`. The spend panel gets the same pass. Every other era still gets `legacy()`.

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

**The TNG Bracket Console skin.** Under `lcars-tng` and `lcars-fc` (`isBracketTheme`) the card is rendered by
[task-card-tng.js](scripts/task-card-tng.js) (shape in
[styles/task-card-tng.css](styles/task-card-tng.css)), whatever `taskCardStyle` says and
from the same `skinView` as TOS and TMP, with the same DOM contract. Dice sit in
stadium-outlined strips, every readout is a segmented gauge (6–10 segments, the number
always shown), and the keys are a two-column keypad rounded on their outer ends only. The
frame colour gives the state: orange working, blue assist, green passed, rose failed (First
Contact: periwinkle, tan, green, red).

- **Colour is by role, per theme.** `PALETTES` in task-card-tng.js names every inline colour
  by what it is for (frame state, each gauge, each key); the colours CSS owns (side arms,
  outlines, text, empty segments, note leads) are `--tbc-*` variables with TNG defaults on
  `.tbc` and one `.tbc[data-theme="lcars-fc"]` override block. A new bracket theme is a
  `PALETTES` entry, a CSS block and a `BRACKET_THEME_KEYS` entry.

- **Keys are filled LCARS keys with their colour inline** (`keyStyle`), and every arming
  key carries `data-filled="1"`, so arming lights it yellow.
- **The keypad's rounding is positional.** Odd children are the left column (rounded
  left), even the right. A wide key (`.tbc-key--wide`) spans the pad, and so does a
  left-column key left alone — the last child, or one followed by a wide key (`:has`).
  Wide keys therefore only ever go at the end of a section.
- **Reroll names wrap** inside a key rather than ellipsing (the shared
  `.sta2e-rr-name` rule clips to one line), since keys are two to a row.

Covered by [tests/tng-cards.mjs](tests/tng-cards.mjs), which also has `--preview`.

**The classic TNG spine frame (no longer reached).** Before the Bracket Console, the
classic renderer drew a TNG frame of its own. That code is still there, but since
`lcars-tng` now takes the skin branch first, nothing reaches it. When the active theme
is `lcars-tng` the renderer adds
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

**The TOS Console Viewer skin.** Under `tos-panel` the card is rendered by
[task-card-tos.js](scripts/task-card-tos.js) (shape in
[styles/task-card-tos.css](styles/task-card-tos.css)) **whatever `taskCardStyle` says** —
classic and slim are both LCARS shapes. It takes the same prepared view the slim skin
does (`skinView` in `buildPlayerRollCardHtml`), so the three skins cannot drift in
content: a gunmetal housing with indicator lamps, curved CRT screens for the dice and
the dot-leader readout, and raised backlit keys. It keeps the slim skin's DOM contract
(wrappers, `diceRow` dice with their `<img>`, every button class and data-*), and two
details of its own:

- **A key's colour is entirely inline** (`keyStyle`); the bevel is a `box-shadow`, which
  `_armCardSelection` never touches, so an armed key keeps its 3D look. Every key carries
  `data-filled="1"` so arming lights it yellow instead of darkening it.
- **The `.tct-key` rules are three classes deep**, to outrank task-card.css's shared
  two-class padding rules on specificity. `box-sizing: border-box` is load-bearing:
  "Completed" and "Applied to" are `<div>`s, which otherwise overflow at `width:100%`.

Covered by [tests/tos-cards.mjs](tests/tos-cards.mjs); `--preview out.html` renders every
state against the real stylesheets.

**The TMP Console Monitor skin.** Under `tmp-console` the card is rendered by
[task-card-tmp.js](scripts/task-card-tmp.js) (shape in
[styles/task-card-tmp.css](styles/task-card-tmp.css)), again whatever `taskCardStyle`
says and from the same `skinView`. The design source is `docs/tmp-card-mockups.html`
(Concept D and its coverage check): a grey duty panel with a header plate, monitor
screens with bracketed blocks and segmented meters (6–10 segments, the number always
shown), and backlit lens keys. Same DOM contract as TOS, plus two rules that came out of
checking the design against `_armCardSelection`:

- **The button is the lens, label inside it.** That function repaints the button itself
  and prefixes `.sta2e-rr-name`, so a lens drawn as a child with the label engraved below
  it (as the first mockups had) could not show the armed state. Colour is inline
  (`lensStyle`); the bezel ring is a `box-shadow` and the sheen an `::after`.
- **Every `.sta2e-working-actions` section is a dark key bed** (`.tmc-bed`). The reroll
  tray is injected with inline `LC.yellow` text on a near-transparent background, which
  is unreadable on the light grey panel and cannot be overridden without `!important`.

Its fonts are bundled in `fonts/tmp/` (Jost, Michroma, Share Tech Mono, SIL OFL, licence
texts beside them) and declared in task-card-tmp.css under `STA2e …` family names, which
the chat frame's TMP rules reuse. Covered by [tests/tmp-cards.mjs](tests/tmp-cards.mjs),
which also has `--preview`.

**The ENT Bridge Touchscreen skin.** Under `ent-panel` (`isEntTheme`) the card is
rendered by [task-card-ent.js](scripts/task-card-ent.js) (shape in
[styles/task-card-ent.css](styles/task-card-ent.css)), whatever `taskCardStyle` says and
from the same `skinView`, with the same DOM contract. The design source is
`docs/ent-card-mockups.html` (Concept A): the NX-01 bridge displays — navy glass with a
faint grid, a line-art outline with two chamfered corners, the title on a rule with a cut
tab carrying the state, dice in bracketed wells, each readout a value over a hairline bar
(one shared scale, with the Difficulty ticked on the Successes bar), and tab keys with a
coloured edge. The frame colour gives the state: blue working, grey assist, green passed,
red failed. Three things it rests on:

- **The outline is not a border.** A `clip-path` cuts a real border off the diagonal, so
  the root is filled with `--tec-c`, padded 1px, and the glass is a second clipped box
  (`.tec-in`) inside it. Both builders emit that inner wrapper.
- **Keys are tabs, not filled keys: no `data-filled`.** Their colour is inline
  (`keyStyle`: the edge is a stop in the background gradient, plus `border-color` and
  `color`); the stylesheet gives the border a width and a style only. Arming therefore takes
  `_armCardSelection`'s unfilled path — yellow outline and text on dark glass — and
  restoring `cssText` brings the edge back.
- **The footer's hex run is decoration**, `dataStream(title)`, stable per title so a
  re-render does not flicker it.

Rajdhani is bundled in `fonts/ent/` (SIL OFL, licence beside it) as `STA2e Rajdhani`; the
numbers use the `STA2e Share Tech Mono` that task-card-tmp.css declares. Chat bodies are
zoomed 1.1 for the same reason the TNG ones are. Covered by
[tests/ent-cards.mjs](tests/ent-cards.mjs), which also has `--preview`.

The card carries **no emoji**; the surviving glyphs are functional and monochrome (`★★`
on a crit die, `▶` armed, `→` on Add to Task Roll). The roller *dialog* carries none
either, in any era — content, footer labels and the text its wiring writes at runtime
(`✓ ✗ ★ ↺` stay). The static `buildChatCard` summary, the Rally card and the GM
re-roll chat message still use theirs.

### Dice Roller Skins

The Adv. Dice Roller dialog (`buildDialogContent` in npc-roller.js) is being given
each era's chat card look; the design source for all six is `docs/roller-mockups.html`.
One module, [roller-skin.js](scripts/roller-skin.js), holds the shared pass and one frame
per era, and `rollerSkin()` names the one the active theme wears:

| skin | themes | frame | shape |
|---|---|---|---|
| `tng` | `lcars-tng`, `lcars-fc` | the task card's bracket frame (`bracketTop` / `bracketBottom`, `.tbc`) | [roller-tng.css](styles/roller-tng.css) |
| `tos` | `tos-panel` | the Console Viewer housing — header and lamps, **one** CRT, strut, keys | [roller-tos.css](styles/roller-tos.css) |

Every other era gets `null` and the LCARS dialog unchanged. Adding an era is a frame
function, a `FRAMES` and a `FOOTER_PAINT` entry, a `rollerSkin()` case and a stylesheet.

**Wrap, never replace — the chat card frame's rule, for the same reason.** The content
is ~1100 lines of conditional markup, and `_wireSetupInputs` / `_wireDiePips` find every
control by id and write `display`, `opacity` and `innerHTML` into it at runtime. So
`openDialog` passes the built content through `skinRollerHtml`, which runs
`rollerBodyHtml` — one body pass for every era, stripping only what made each element
LCARS and stamping `tbr-ctl` (fields), `tbr-plate` (1px-bordered boxes), `tbr-note`
(thick left border) and `tbr-key` (buttons, colour lifted into `--tbr-a` / `--tbr-ink`)
— and puts the result in the era's frame. Checkbox, radio and range inputs keep their old
`accent-color` as `--tbr-a`, which is how the Complication range stays red. An era's
stylesheet draws only those `tbr-*` classes. Five things it rests on:

- **Three changes live in buildDialogContent itself, because a pass cannot regroup
  markup.** `sectionHeader` emits a bare `.tbr-head` under any skin (TNG's setup phase
  draws it and the element right after it as one stadium strip — so a section's body must
  stay the header's next sibling); the sheet-mode Ship Pool header does the same with its
  Manage key; and the Targeting Solution system keys repaint through `--tbr-a` instead
  of inline fills, since an inline wash would beat the key's fill.
- **TOS puts the whole content on one CRT, not a screen per section** (the mockup had
  one per section). The content leaves things between sections — the weapon line,
  breach banners, the trait list — coloured for black, which would be unreadable on the
  grey housing. Its root carries `.sta2e-task-card--tos` so the card's own header, lamp,
  CRT and strut rules apply, but **not `.sta2e-task-card`**: task-card.css's shared
  button rules hang off that, so roller-tos.css restates the housing instead.
- **Die pips are buttons and must not become keys** — the pass skips `.sta2e-die-pip`,
  whose glow is the reroll hint.
- **Don't use `stripDecorativeEmoji` alone on dice text.** Its U+2600–26FF range covers
  ★, the crit mark; the roller's `stripEmoji` keeps ★/☆. (The chat frames' TOS and ENT
  passes still eat ★ — a known gap in the shared helper.)
- **The footer is moved, not restyled in place.** Roll / Resolve / Cancel are core's
  DialogV2 `.form-footer`; `seatRollerFooter` moves it into the frame's
  `[data-roller-keys]` element after render (still inside the `<form>`, which is all
  core's button handling needs), drops icons and emoji, tags the window
  `sta2e-roller-win--<skin>`, and paints each key inline through `footerKeyStyle` — the
  first button is the main action (TNG peach, TOS green), Cancel is always the dim key.
  TOS takes its colours from task-card-tos.js's `tosKeyStyle`.

Covered by [tests/roller-skins.mjs](tests/roller-skins.mjs), which lifts the **real**
`buildDialogContent` out of npc-roller.js into a vm (missing module-level helpers are
loaded from the source on first `ReferenceError`), renders both phases, checks that
every id, data-* value, content class and `display:none` survives the pass, and checks
each frame. `--preview` renders both phases in TNG, First Contact and TOS against the
real stylesheets.

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
| [scripts/ship-crew-tab.js](scripts/ship-crew-tab.js) | The Crew tab on the starship and small-craft sheets — ship's company and bridge stations. A view only; every rule is in `crew-manifest.js` |
| [styles/ship-crew-tab.css](styles/ship-crew-tab.css) | Shape for that tab; colours from the sheet's own `--sta-*` palette variables |
| [scripts/combat/acting-officer.js](scripts/combat/acting-officer.js) | `resolveActingOfficer` — which manned officer is taking a station's action. The only correct way to pick one; never index `getStationOfficers(...)[0]` |
| [scripts/weapon-configs.js](scripts/weapon-configs.js) | Weapon config registry, `buildWeaponContext`, fire functions |
| [scripts/token-conditions.js](scripts/token-conditions.js) | STA combat conditions (add/remove/query) |
| [scripts/task-card-slim.js](scripts/task-card-slim.js) | Slim LCARS skin for the Working Results task card (`taskCardStyle`) |
| [scripts/task-card-tos.js](scripts/task-card-tos.js) | TOS Console Viewer skin for the task card — used for `tos-panel` regardless of `taskCardStyle`. Imports only `lcars-theme.js` |
| [styles/task-card-tos.css](styles/task-card-tos.css) | Shape for that skin — housing, lamps, CRT screens, keys |
| [scripts/task-card-tmp.js](scripts/task-card-tmp.js) | TMP Console Monitor skin for the task card — used for `tmp-console` regardless of `taskCardStyle`. Imports only `lcars-theme.js` |
| [styles/task-card-tmp.css](styles/task-card-tmp.css) | Shape for that skin — panel, monitors, meters, key bed, lenses — and the `@font-face` rules for `fonts/tmp/` |
| [scripts/task-card-tng.js](scripts/task-card-tng.js) | TNG Bracket Console skin for the task card — used for `lcars-tng` regardless of `taskCardStyle` — and the `bracketTop` / `bracketBottom` frame markup the chat card frame reuses. Imports only `lcars-theme.js` |
| [styles/task-card-tng.css](styles/task-card-tng.css) | The bracket frame (`.tbc`, shared with the TNG chat frame), the task card's strips, gauges and keypad, and the `@font-face` rule for `fonts/tng/` (Antonio) |
| [scripts/tos-sheet-theme.js](scripts/tos-sheet-theme.js) | Tags the 2e actor sheets for the TOS or TMP overlay — `registerTosSheetTheme`, `refreshTosSheets`. Imports only `lcars-theme.js` |
| [styles/tos-sheet.css](styles/tos-sheet.css) | The TOS overlay for the character, NPC, supporting, starship and small craft sheets (native CSS nesting) |
| [styles/tmp-sheet.css](styles/tmp-sheet.css) | The TMP overlay for the same five sheets, structured like tos-sheet.css |
| [styles/ent-sheet.css](styles/ent-sheet.css) | The ENT Bridge Touchscreen overlay for the same five sheets, structured like tmp-sheet.css |
| [styles/tmp-monitor.css](styles/tmp-monitor.css) | The TMP Monitor theme for the Stardate HUD, the task card and the chat frame — repaints the TMP markup from its modifier classes |
| [styles/tmp-monitor-sheet.css](styles/tmp-monitor-sheet.css) | The TMP Monitor repaint of the TMP sheet overlay |
| [scripts/task-card-ent.js](scripts/task-card-ent.js) | ENT Bridge Touchscreen skin for the task card — used for `ent-panel` regardless of `taskCardStyle` — and the `entHead` / `entFoot` frame markup the chat card frame reuses. Imports only `lcars-theme.js` |
| [styles/task-card-ent.css](styles/task-card-ent.css) | The touchscreen frame (`.tec`, shared with the ENT chat frame), the task card's wells, readout bars and tab keys, the `ccf-ent-*` body parts, and the `@font-face` rules for `fonts/ent/` (Rajdhani) |
| [scripts/chat-card-frame.js](scripts/chat-card-frame.js) | `lcarsChatCard` — the TNG Bracket Console frame every other chat card shares, and the TOS, TMP and ENT frames. Imports only `lcars-theme.js`, `task-card-tng.js` and `task-card-ent.js`; `legacy` thunk keeps the other eras frozen |
| [styles/chat-card.css](styles/chat-card.css) | Shared chat card rules and the TOS / TMP frames; the TNG brackets live in task-card-tng.css |
| [styles/task-card.css](styles/task-card.css) | Shape-only CSS for the task card — frame radius per era, the two-column reroll grid |
| [scripts/roller-skin.js](scripts/roller-skin.js) | Era skins for the Adv. Dice Roller dialog — the shared body pass, one frame per era (TNG / First Contact, TOS), footer seating. Imports only `lcars-theme.js`, `task-card-tng.js`, `task-card-tos.js` and `chat-card-frame.js` |
| [styles/roller-tng.css](styles/roller-tng.css) | Shape for the TNG roller skin — section strips, stadium fields, pill indicators, range, keys, the footer keypad |
| [styles/roller-tos.css](styles/roller-tos.css) | Shape for the TOS roller skin — housing, section captions on the CRT, amber readout fields, indicator lamps, backlit keys |
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
| [scripts/token-toolkit-hud.js](scripts/token-toolkit-hud.js) | The module's **only** Token HUD control — the arrowhead, the drill-down menu, and the section registry |
| [scripts/token-hud-util.js](scripts/token-hud-util.js) | Token HUD plumbing — `buildHudControl`, `buildHudFlyout`, `buildHudItem`, `resolveHudToken`, `toggleHudFlyout`. A leaf; the sections import the row builder from here |
| [scripts/ship-command-hud.js](scripts/ship-command-hud.js) | Ship Command section — warp, tractor, scan, cloak, shields. Also owns `isShipActor`, the widest of the ship tests |
| [scripts/token-weapon-hud.js](scripts/token-weapon-hud.js) | Weapons section — the weapon grid and the Hit / Miss / roller strip. The only stateful section |
| [scripts/q-hud.js](scripts/q-hud.js) | Q section of the toolkit menu, GM-only, every token type |
| [scripts/appearance-hud.js](scripts/appearance-hud.js) | The Token HUD's own Appearance button — looks as a three-across card grid (Original first) under an icon toolbar (Random, Manage). Offered to players on tokens they own. Gear moved to the arrowhead (gear-hud.js) |
| [scripts/token-maker.js](scripts/token-maker.js) | The Token Maker window — framing, shape/brush/magic masks, ring modes, save next to the portrait |
| [scripts/token-maker-compose.js](scripts/token-maker-compose.js) | Token Maker maths — subject transform, shapes, flood fill, file naming. A leaf with **no imports** |
| [scripts/starfleet-ring.js](scripts/starfleet-ring.js) | Registers the Starfleet Metal Ring and Starfield Ring dynamic ring configurations, and moves worlds off retired ring ids |
| [scripts/webp-convert.js](scripts/webp-convert.js) | `saveAsWebp` — a WebP copy of a PNG/JPEG saved beside it (world-folder fallback), skipped when not smaller. Used by the Appearance Manager's convert keys |
| [scripts/file-storage.js](scripts/file-storage.js) | Which FilePicker storage a path lives in — local `data`, The Forge's `forgevtt` Assets Library, or an S3 bucket — plus `uploadFile` (creates parent folders) and `browseFolder`. A leaf with **no imports**. The Token Maker and art browser use it, chiefly so a portrait that is a Forge Assets Library or S3 URL gets its token saved beside it. **On The Forge every `browse` is a rate-limited Forge API call** (`assets/browse`, ~50/min before its rate monitor complains), so the art browser indexes an Assets Library root with ONE `recursive: true` browse and only walks folder by folder as a fallback, capped at 150 folders there — walking the whole library one folder per call kept the API pinned for minutes. The other generated-image savers hard-code `"data"`, which works on The Forge in practice (uploads land in the Assets Library) — no need to convert them. Covered by [tests/file-storage.mjs](tests/file-storage.mjs) |
| [scripts/token-frames.js](scripts/token-frames.js) | Built-in baked ring frames for the Token Maker (Solid, Double, Starfield, Metal, procedural Stone and Marble) in any colour, with each frame's opening and pip/emblem placement |
| [scripts/token-emblems.js](scripts/token-emblems.js) | Token Maker emblems — built-in vector commbadges, the `tokenEmblems` library, PNG→WebP conversion, the badge-disc drawing |
| [tools/starfleet-ring-atlas.js](tools/starfleet-ring-atlas.js) | Browser-run generator for `assets/rings/*` — not loaded by the module |
| [styles/token-maker.css](styles/token-maker.css) | Shape for the Token Maker |
| [styles/appearance.css](styles/appearance.css) | Shape for the Appearance Manager, art browser, sheet Wear toggle and HUD thumbnails |
| [styles/sta-palette-fix.css](styles/sta-palette-fix.css) | TEMPORARY: undoes sta 2.8.0's unscoped `.palette` rule that hid every Token HUD palette. Delete when the system fixes it |
| [scripts/deflector-hud.js](scripts/deflector-hud.js) | Deflector Dish section — four effect rows plus a Stop row while a sustained one runs. The only file in that feature that may import `spawn-picker.js` |
| [scripts/deflector-vfx.js](scripts/deflector-vfx.js) | The four deflector renderers, the per-token instance registry and the `deflectorVfx` broadcast. Imports only `ship-vfx-anchors`, `starfield-common`, `bolt-glow-vfx` and `beam-shader` |
| [scripts/q-vfx.js](scripts/q-vfx.js) | Q's white screen flash and the composed snap sequences |
| [scripts/spawn-picker.js](scripts/spawn-picker.js) | Shared canvas pickers, `pickSpawnCentres`, PIXI shims, `centreToTopLeft` |
| [scripts/spawn-queue.js](scripts/spawn-queue.js) | The drag-actors-in queue widget shared by the LCARS tabs |
| [scripts/spawn-buffer.js](scripts/spawn-buffer.js) | Hold/restore group buffer, keyed by setting |
| [scripts/spawn-regions.js](scripts/spawn-regions.js) | Region spawn destinations — pad-marker discovery/order, grid fill, `parseLocation`, `buildLocationOptions`, and the shared region geometry (`regionPolygons`, `regionBounds`, `regionCentre`, `regionContainsPoint`). **Geometry comes off the RegionDocument, never the placeable** — `Region#polygons` and `Region#testPoint` are deprecated since v13 and log on every call. `regionBounds` is the exception: `Region#bounds` is not deprecated and gives the *animated* bounds, which is what canvas drawing wants |
| [scripts/region-pad-config.js](scripts/region-pad-config.js) | Injects the spawn-marker checkbox + Pad Group field into Region Config |
| [scripts/region-spline-tool.js](scripts/region-spline-tool.js) | The Regions-toolbar **Curve** tool — the scene-control descriptor, the two `RegionLayer` patches, the control-point stamp, and the Region Config rebuild panel |
| [scripts/spline-geometry.js](scripts/spline-geometry.js) | Closed centripetal Catmull-Rom over flat `[x,y,…]` arrays — adaptive sampling, the tangent overshoot clamp, and the centroid-tolerant outline match. A leaf with **no imports** |
| [scripts/scene-warp.js](scripts/scene-warp.js) | Scene Warp state — the scene flag, phase ramp, course/rotation conversions, the ship test. A leaf with **no imports**, so the firing path can consult it without a cycle |
| [scripts/scene-warp-vfx.js](scripts/scene-warp-vfx.js) | The top-down parallax streak field — nested masked/rotated containers, depth bands, the over-tokens band |
| [scripts/scene-warp-panel.js](scripts/scene-warp-panel.js) | Floating GM-only LCARS panel driving engage/drop out, warp factor, course, the two rules switches and the look |
| [scripts/starfield-common.js](scripts/starfield-common.js) | Star and environment *material* shared by both renderers — streak/radial/cloud/storm-cloud/wisp/rock/mote/grain/scanline textures, fBm noise, lightning geometry, palette construction, colour maths, PIXI v7/v8 shims. Knows nothing about either camera |
| [scripts/viewscreen-presets.js](scripts/viewscreen-presets.js) | The GM's saved look presets — one world setting, filed per environment, one markable default each. `resolveEnvironmentLook` is what picking an environment should write. Imports only the environment registry |
| [scripts/viewscreen-environments.js](scripts/viewscreen-environments.js) | The travel environment registry — four volumes (warp, nebula, ion storm, asteroid), four tunnels (transwarp conduit, slipstream, wormhole, subspace vortex) and signal loss. A leaf with **no imports**, so the panels and `scene-warp.js` can read it; textures named by string key, every particle number a multiplier |
| [scripts/warp-viewscreen-behavior.js](scripts/warp-viewscreen-behavior.js) | The `sta2e-toolkit.warpViewscreen` RegionBehaviorType — schema, phase writes, environment-resolved sounds, the vanishing-point picker, and the backdrop-image library `<select>` injected over `activeImage` |
| [scripts/warp-viewscreen-vfx.js](scripts/warp-viewscreen-vfx.js) | The masked star-streak renderer — projection, star pool, ramp, bloom, teardown, and the backdrop-image sprite. Its texture cache is shared and caches negatives; video is deliberately uncached and owned per instance |
| [scripts/warp-viewscreen-panel.js](scripts/warp-viewscreen-panel.js) | Floating GM-only LCARS panel driving enter/exit warp, warp factor, aim, look, and the backdrop-image library. Two independently scrolling columns — flight and look on the left, the image on the right. `_apply` mirrors the *framing* fields back into the active entry in the same update, which is why there is no Save button; `src` is excluded and changing it detaches |
| [scripts/warp-stretch-vfx.js](scripts/warp-stretch-vfx.js) | The hull smear at both ends of a warp jump — the only place the module deforms a token sprite. Owns the `Token#_refreshSize` / `#_refreshMesh` patch that keeps it applied |
| [scripts/warp-calc.js](scripts/warp-calc.js) | Warp travel calculator dialog |
| [scripts/warp-effect-styles.js](scripts/warp-effect-styles.js) | Warp flash style registry (clip, scale, peak, corridor) + the trait and faction gates. `standard`, `temporalRift`, `cardassianTemporalRift`; the rifts are timeships only. Styles sharing a `family` are faction variants: a variant with a `faction` key replaces the family's generic one for ships of that faction, substituted by `resolveFactionVariantId` on the initiating client so the resolved id is what travels the socket. Must not import `ship-vfx-anchors.js` — that would close an import cycle; faction detection is imported from `actor-faction.js` instead |
| [scripts/alert-hud.js](scripts/alert-hud.js) | Alert status HUD overlay |
| [scripts/toolkit-widget.js](scripts/toolkit-widget.js) | Floating toolbar widget |
| [scripts/hud-position.js](scripts/hud-position.js) | Viewport clamping shared by every draggable HUD panel — keeps a dragged/restored header on screen |
| [scripts/assist-pending.js](scripts/assist-pending.js) | Sole owner of the `assistPending` token flag (declared Assist / Direct). Writes self-route: direct when the user can update the token, otherwise a socket request the GM executes |
| [scripts/wildcard-namer.js](scripts/wildcard-namer.js) | Auto-names wildcard tokens from rollable tables |
| [scripts/elevation-ruler.js](scripts/elevation-ruler.js) | Patches FoundryVTT ruler for 3D elevation |
| [scripts/star-system-scene.js](scripts/star-system-scene.js) | Builds a scene map from a Star System actor (tiles, orbit rings, per-orbit zones, hover tooltips), the five planet layouts, and the ring Regions |
| [scripts/ring-dust-wake-vfx.js](scripts/ring-dust-wake-vfx.js) | The dust a ship kicks up flying through a planetary ring Region. Local on every client, no socket |
| [scripts/actor-faction.js](scripts/actor-faction.js) | `resolveActorFactionKey` — guesses a ship's faction by regex over its name and traits. A leaf module with no imports, so gating code can use it without cycles; re-exported from `ship-vfx-anchors.js`, which is where every caller has always found it |
| [scripts/scene-flags.js](scripts/scene-flags.js) | Scene flag helpers |
| [scripts/region-terrain.js](scripts/region-terrain.js) | Region Terrain query layer — features per scene, crossings and movement cost, Region hazard views, shroud potency, hidden-vessel and concealment tests |
| [scripts/region-terrain-behaviors.js](scripts/region-terrain-behaviors.js) | The Difficult Terrain / Hazard / Sensor Shroud RegionBehaviorTypes and their cache + visibility hooks |
| [scripts/gear-damage.js](scripts/gear-damage.js) | One out-of-action state (item flag `gearDamaged`) for character weapons ("Broken": refused in combat; an **energy weapon** — `isEnergyWeapon`, by name: phaser, disruptor, phase, plasma… — may instead be "Burnt out" and recharged, the item flag `gearDamageMode`, which is flavour only and is kept after the repair so the wording stays right), armour and gear ("Damaged": no Protection) and personal forcefields ("Burnt out"; the old `forcefieldBurntOut` flag is still read and cleared on repair). A leaf with **no imports**. Every attack entry point calls `assertWeaponUsable` — the Combat HUD weapon row (which also covers the LCARS ring, since `triggerRingWeapon` clicks that row) and `triggerHudHitMiss`; `_getTargetProtection` skips any damaged item. Ship weapons are out of scope (they have breaches). Covered by [tests/gear-damage.mjs](tests/gear-damage.mjs) |
| [scripts/complication-card.js](scripts/complication-card.js) | The working **COMPLICATIONS** card — complications settled in chat by any GM instead of in a prompt on one client (tables with several GMs). `CombatHUD._resolveComplicationDamagePenalty` (ground and ship attacks that hit) no longer prompts: it calls `requestComplicationResolution`, which posts the card and returns a promise the confirming client **awaits**, so the damage card is built only after a GM clicks Done — callers did not change. Per complication: reduce Severity/damage (anything unassigned), 2-Threat buy-off (NPC attacker), weapon malfunction / power-cell burnout (character weapon), or break other gear (potency = complications spent). State is the message flag `complicationCard`; every click is a message update, Done applies it all once, claiming the card first (`finishing`) so two GMs cannot both pay. The waiting client resolves off its own `updateChatMessage`, which is why the card is whispered to every GM **and** that user; deleting the card unsettled counts every complication against the damage. With nothing to choose (a PC with no gear to break, a player ship) no card is posted. The task kind (`postTaskComplicationCard`) waits on nothing and only breaks gear. The Break Gear dialog and the old buy-off / malfunction prompts are gone |
| [scripts/gear-damage-ui.js](scripts/gear-damage-ui.js) | The controls: the break/repair key on each row of the toolkit arrowhead's **Gear** section ([gear-hud.js](scripts/gear-hud.js): Wear toggles plus break/repair, character weapons included — GM-only; players wear their own from the sheet), the repair key the sheet shows on a damaged row, `toggleGearDamage` (writes the flag and posts the chat card), and the task-kind working COMPLICATIONS card (complication-card.js) the active GM posts when a Working Results card is confirmed with complications — any task, or a weapon attack that MISSED (a hit settles them on its own attack card first; a missed pulse grenade gets its misfire card instead) — (`updateChatMessage` on `flags.rollData.confirmed` — **not** the bare `flags.confirmed`, which the confirm handler writes first, before the result exists, and then leaves unchanged; once per roll via `gearComplicationCardPosted`) — its Break Gear key counts complications spent and closes the card when none are left; the task card itself is not touched. A character-weapon attack's complications may also make the weapon malfunction or burn out (one complication, on the working COMPLICATIONS card). **Repairing from the sheet is a request, not a repair**: the key posts a REPAIR REQUEST card whispered to the active GM, whose render-time controls settle it — repair with no roll, **Leave Broken** (close the request, item still out of action), spend a set Threat (NPC: charged at once) or Momentum (player character, `hasPlayerOwner`: the GM's price becomes an **offer** on the card — `gearRepairRequest.offer` — that an owner of the character Accepts or Declines — a decline hands the card back to the GM's controls with a note rather than closing it; the answer relays to the active GM over `gearRepairOfferReply`, who spends the pool and repairs, and a pool too low drops the offer so the GM can choose again), or require a roll, which posts a Task Maker request card carrying `taskData.gearRepair`; its `taskCallback` (`completeGearRepairFromTask`) repairs on a pass, relaying to the active GM (socket `gearRepairComplete`) to settle the card. That callback lives only on the client that opened the roller, so the roller must confirm their own roll. The Gear section of the toolkit HUD stays an instant GM toggle **A damaged item carries a negative trait** ("Phaser Type-2 (Broken)"): a toolkit trait with a Difficulty effect scaling with its potency, kept on the owner by the active GM alone (`registerGearDamageTraits`, off `updateItem` — so any route that breaks something gets one without trait permissions). Potency lives on the item (`gearDamagePotency`, 1–5): 1 to start, breaking it from the COMPLICATIONS card spends one complication per point; against a player character the + key raises it at 2 Threat a step (`POTENCY_THREAT_COST`); the Gear section's + key adds 1 (2 Threat on a PC). The trait is found again by its `gearTraitFor` flag; editing its quantity on the sheet copies back to the item, repairing deletes it, and its potency is the repair card's starting Difficulty **Pulse grenades** (`isPulseGrenade`, by name) are a supply: `grenadeCount` (item flag, 3 until first thrown) drops by one per throw — in the roller-confirm ground path and in `_resolveWeapon`'s ground branch — and `assertWeaponUsable` refuses one at 0; the Gear section has −/+ keys and the sheet a ×N badge. A **missed** throw that rolled a complication posts a GM-only GRENADE MISFIRE card: it can go off on the thrower or on the GM's single target via `CombatHUD.triggerGrenadeMisfire`, which calls `_resolveWeapon(true, { targets, misfire: true })` — the ordinary damage card, Area spill and injury decisions, but no second Major Action and no second grenade. While that card is offered the roll's **miss animation is held back** (`misfireOffered` in the roller path) — otherwise the blast showed at the original target and again where it misfired; No Misfire plays the held miss from the card's `missTargetIds` |
| [scripts/personal-shield-vfx.js](scripts/personal-shield-vfx.js) | A worn personal forcefield (item names in the world setting `personalShieldItems`). No standing bubble: a bloom when Wear goes on, a collapse when it goes off or the item is deleted, the full ship shield impact (`playShieldImpactVFX`: bubble cap plus tinted JB2A flash, same world toggles) when a ground weapon hits the wearer, and a particle explosion of its own (`_burst`: flash; a shock front baked as a ragged hard-edged ring with a soft wake, plus a trailing wave and haze; streak sparks; embers) when the wearer gains Stun/Dying/Dead or the field is sacrificed (or a core dead/unconscious status). Raise, collapse and break are played by every client from its own document hook, so nothing is broadcast; the hit's bubble broadcasts itself and Sequencer routes its flash, and it and is fired from `_playGroundAttackAnimation` / `_playGroundAreaConeAnimation`. Condition changes are diffed against a per-client last-seen map, since `preUpdateToken` only runs on the updating client. **Rules:** a working field (worn, not burnt out) may be **sacrificed** from the injury decision card against a Deadly injury — the injury is taken as a Stun injury of the same potency and the item gets the `forcefieldBurntOut` flag, which `_getTargetProtection` skips and every effect here ignores; a minor NPC with a working field gets the decision card instead of a straight injury. The sheet shows a battery icon on a burnt-out field, and clicking it recharges. **A hit on a working field stops ON it**: every ground renderer (native phaser, native energy except the pulse shockwave, and the Sequencer beam / bolt / JB2A bolt in weapon-configs.js) ends the shot at `personalShieldStopPoint`, and `playPersonalShieldHits` puts the flash there. The depth is a fixed `PERSONAL_CAP_T` rather than a per-shot roll because the renderer and the flash are separate calls with no payload between them — make it random and the beam and flash part company |
| [scripts/cloak-hit-vfx.js](scripts/cloak-hit-vfx.js) | The shimmer a cloaked ship shows when hit — local playback and the `cloakHitShimmerVfx` broadcast |
| [scripts/sensor-contacts.js](scripts/sensor-contacts.js) | Reveal and Sensor Sweep resolution (active GM side) and the SENSOR CONTACT markers |
| [scripts/gm-authority.js](scripts/gm-authority.js) | Active GM designation — `isActiveGM`, `getActiveGM`, `activeGmWhisperIds`. A leaf with **no imports** |
| [scripts/vfx-diagnostics.js](scripts/vfx-diagnostics.js) | Why a broadcast effect was not drawn on this client — `vfxDrop` reason slugs, per-action counters, the `vfxDebugLogging` memo. A leaf with **no imports**, since every drop site is inside a per-frame renderer |

## Key Conventions

- **Socket pattern:** `game.socket.emit("module.sta2e-toolkit", { action, ...payload })`. Players cannot directly call GM-privileged Foundry API; they emit a socket event instead. Nearly every action is handled in `main.js`'s listener, but it is **not the only one** — [destructible-objects.js](scripts/destructible-objects.js) registers a second on the same channel for `destructibleVfx` / `destructibleReply` / `destructibleRequest`.

  **The subscription is made in `init`, and must stay there.** `game.socket.on` is called at the top of the `init` hook and forwards to `_toolkitSocketHandler`, which is not built until partway through `ready`; anything arriving in between is queued by `_dispatchToolkitSocket` and replayed by `_drainPendingSocketMsgs`. It used to be a single `game.socket.on(…, _toolkitSocketHandler)` on the last line of `ready` — ~1160 lines in, past twelve constructors and the whole chat-card wiring, with no try/catch. **Anything that threw before it left that client permanently unsubscribed**: it drew its own effects and emitted normally, but silently received no broadcast VFX for the rest of the session, with nothing in the console connecting the two. Moving a throwing statement above the subscription reintroduces exactly that bug. A `_toolkitReadyCompleted` watchdog reports a `ready` that threw or hung, since the rest of the hook still matters.

- **Broadcast VFX diagnostics.** Every receive-side bail — scene mismatch, `!canvas.ready`, non-finite points, a token not on this client's canvas, `!window.Sequence` — calls `vfxDrop(action, reason, detail)` from [vfx-diagnostics.js](scripts/vfx-diagnostics.js) (a **leaf with no imports**; the drop sites are inside per-frame renderers). Reasons are short stable slugs so a support conversation can ask for one string. Console output is behind the client setting `vfxDebugLogging`; the counters are always kept. `game.sta2eToolkit.diagnoseVfx()` pings every client and whispers a report — **a user who does not answer at all is the headline result**, because that is the unsubscribed-client failure above.

- **A broadcast effect's `sceneId` is the SOURCE TOKEN'S scene, not the sender's viewed scene.** `canvas?.scene?.id` is only a fallback. A hit is drawn and broadcast from the *GM's* client, so a GM parked on another scene stamped that scene's id and every correctly-parked observer discarded the shot on the receiver's scene guard. Receivers still compare against their own viewed scene, which is correct.
- **Chat cards** are built as inline HTML strings (no Handlebars templates for dynamic cards) to allow per-era LCARS styling.
- **Settings** are registered in [scripts/settings.js](scripts/settings.js); scope is `"world"` for GM-visible and `"client"` for per-user.
- **Flags namespace** is always `"sta2e-toolkit"`.
- **Bundled art is WebP.** Convert any generated or added image to WebP before referencing it (sharp: `webp({quality: 90, alphaQuality: 100, effort: 6})` keeps alpha exact) and do not commit the PNG. The release zip had reached 282 MB and would not update on The Forge; v1.26.2 converted the interior art (76 → 11 MB). Development-only files — studies, drafts, review reports, generation prompts — go under a path `.gitattributes` marks `export-ignore`, so `git archive` keeps them out of the zip. The deck prefab pieces in `assets/interiors/prefabs/starfleet-tng/` and `floor-room-carpet.png` stay PNG on purpose: their manifests, build tools and tests pin each file by SHA-256, so converting them means rebuilding that chain. A bundled path that changes format needs a remap for anything saved with the old name (`currentBundledPath` in [interior-assets.js](scripts/interior-assets.js)).
