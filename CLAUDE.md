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

### Zone System

Three-file system:
- [scripts/zone-data.js](scripts/zone-data.js) — data model, scene flag CRUD (`FLAG_KEY = "zones"`), geometry (point-in-polygon), BFS zone-distance calculation, range bands (Contact/Close/Medium/Long)
- [scripts/zone-layer.js](scripts/zone-layer.js) — `ZoneOverlay` PIXI rendering layer
- [scripts/zone-editor.js](scripts/zone-editor.js) — `ZoneEditState`/`ZoneToolbar` for hex stamp, polygon draw, flood-fill edit tools

Zones are stored as scene flags. The ruler measurement is patched in `main.js` to annotate distances with zone counts when `zoneRulerOverride` is enabled.

**Multi-zone tokens:** very large ships (Borg cubes, stations) can be flagged via a Token Config checkbox ("Occupies Multiple Zones", token flag `flags.sta2e-toolkit.multiZone`, injected by [scripts/zone-token-config.js](scripts/zone-token-config.js)). Flagged tokens test their full footprint rect against zone polygons (`getZonesForToken`) and may occupy several zones at once. Range is measured to the nearest occupied zone (`getZoneDistanceBetweenTokens`, multi-source BFS); weapon range checks and area-attack target filters use this. Hazards and movement remain center-based. Note: the hazard effect property `establishedEffects.multiZone` in zone-hazard.js is unrelated.

### NPC Roller

[scripts/npc-roller.js](scripts/npc-roller.js) — LCARS-styled dice roller dialog (`DialogV2`). Handles two pools (Crew and Ship), clickable die pips for rerolls, Targeting Solution bonus die, and Threat spending for rerolls after the first. Posts results as LCARS chat cards.

### Supporting Files

| File | Purpose |
|------|---------|
| [scripts/crew-manifest.js](scripts/crew-manifest.js) | Bridge station assignments, officer stats |
| [scripts/weapon-configs.js](scripts/weapon-configs.js) | Weapon config registry, `buildWeaponContext`, fire functions |
| [scripts/token-conditions.js](scripts/token-conditions.js) | STA combat conditions (add/remove/query) |
| [scripts/transporter.js](scripts/transporter.js) | Transporter beam-in/out visual effect |
| [scripts/warp-calc.js](scripts/warp-calc.js) | Warp travel calculator dialog |
| [scripts/alert-hud.js](scripts/alert-hud.js) | Alert status HUD overlay |
| [scripts/toolkit-widget.js](scripts/toolkit-widget.js) | Floating toolbar widget |
| [scripts/wildcard-namer.js](scripts/wildcard-namer.js) | Auto-names wildcard tokens from rollable tables |
| [scripts/elevation-ruler.js](scripts/elevation-ruler.js) | Patches FoundryVTT ruler for 3D elevation |
| [scripts/star-system-scene.js](scripts/star-system-scene.js) | Builds a scene map from a Star System actor (tiles, orbit rings, per-orbit zones, hover tooltips) |
| [scripts/scene-flags.js](scripts/scene-flags.js) | Scene flag helpers |

## Key Conventions

- **Socket pattern:** `game.socket.emit("module.sta2e-toolkit", { action, ...payload })`. All actions are handled in `main.js`'s single socket listener. Players cannot directly call GM-privileged Foundry API; they emit a socket event instead.
- **Chat cards** are built as inline HTML strings (no Handlebars templates for dynamic cards) to allow per-era LCARS styling.
- **Settings** are registered in [scripts/settings.js](scripts/settings.js); scope is `"world"` for GM-visible and `"client"` for per-user.
- **Flags namespace** is always `"sta2e-toolkit"`.
