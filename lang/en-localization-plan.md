# STA2e Toolkit — Localization Plan (`lang/en.json`)

**Date:** 2026-04-12  
**Purpose:** Audit of all hardcoded user-facing strings that should be moved into `lang/en.json`, plus recommendations for future-proofing i18n support.

---

## 1. Current State

`lang/en.json` currently has **~70 keys** covering:
- Module title
- Stardate HUD labels
- Campaign manager/editor dialog titles
- A few notification messages
- Wildcard namer menu labels
- Zone system (the most complete section — ~50 keys)

Almost everything else in the module — settings, combat HUD, NPC roller, transporter, alert HUD, toolkit widget, notifications, keybindings — is **fully hardcoded** in JavaScript with no i18n.

---

## 2. How to Future-Proof for Multiple Languages

### 2a. Key Naming Convention

Adopt a consistent dot-notation namespace. The existing `STA2E.` prefix works fine; extend it consistently rather than introducing a mixed `sta2e-toolkit.` convention:

```
STA2E.<Section>.<Subsection?>.<Key>
```

Examples:
- `STA2E.Settings.WildcardNamer.Name`
- `STA2E.Combat.Action.Assist.Label`
- `STA2E.Notification.NoTargetSelected`

### 2b. FoundryVTT i18n Patterns

Always use these two methods — never bare strings:
- `game.i18n.localize("STA2E.MyKey")` — static string
- `game.i18n.format("STA2E.MyKey", { name: "Kirk" })` — interpolated string with `{name}` placeholders in the JSON value

### 2c. `module.json` Declaration

`module.json` must declare all language files. The current entry should look like:
```json
"languages": [
  {
    "lang": "en",
    "name": "English",
    "path": "lang/en.json"
  }
]
```
Adding a new language later is simply adding another entry and a new file (e.g., `lang/de.json`).

### 2d. Interpolation Placeholders

For any string that includes dynamic values, use named placeholders in the JSON:
```json
"STA2E.Notification.SystemDestroyed": "STA2e Toolkit: {system} is destroyed — this task cannot be attempted."
```
Then in code: `game.i18n.format("STA2E.Notification.SystemDestroyed", { system: systemName })`

---

## 3. Keys to Add — Organized by File/Section

### Priority Tier 1 — Highest visibility (settings, keybindings, notifications)

---

#### `scripts/settings.js`

Every `game.settings.register()` call passes bare strings for `name` and `hint`. These are shown in the Foundry settings UI and are the most user-visible hardcoded strings in the module.

| Suggested Key | Current Hardcoded Value |
|---|---|
| `STA2E.Settings.WildcardNamer.Name` | "Wildcard Token Namer" |
| `STA2E.Settings.WildcardNamer.Hint` | "Assign rollable tables to actor traits..." |
| `STA2E.Settings.EffectConfig.Name` | "Sounds & Animations" |
| `STA2E.Settings.EffectConfig.Hint` | "Set audio paths and animation overrides..." |
| `STA2E.Settings.ShowZoneBorders.Name` | "Show Zone Borders During Play" |
| `STA2E.Settings.ShowZoneBorders.Hint` | "When enabled (default), zone borders and labels are shown..." |
| `STA2E.Settings.ZoneRulerOverride.Name` | "Zone-Aware Ruler" |
| `STA2E.Settings.ZoneRulerOverride.Hint` | "Annotate ruler measurements with zone count..." |
| `STA2E.Settings.ZoneBorderStyleDefault.Name` | "Zone Default Border Style" |
| `STA2E.Settings.ZoneBorderStyleDefault.Hint` | "Default border style applied to new zones." |
| `STA2E.Settings.ZoneBorderWidth.Name` | "Zone Border Width" |
| `STA2E.Settings.ZoneBorderWidth.Hint` | "Thickness in pixels for zone borders." |
| `STA2E.Settings.ZoneShowLabels.Name` | "Show Zone Labels During Play" |
| `STA2E.Settings.ZoneShowLabels.Hint` | "Show zone name labels in play mode." |
| `STA2E.Settings.ZoneDragRuler.Name` | "Zone-Aware Token Drag Overlay" |
| `STA2E.Settings.ZoneDragRuler.Hint` | "Show zone count, range band, and movement limit indicators while dragging tokens." |
| `STA2E.Settings.ZoneMovementLog.Name` | "Zone Movement Log" |
| `STA2E.Settings.ZoneMovementLog.Hint` | "Post a chat message when a token moves between zones." |
| `STA2E.Settings.ElevationRuler.Name` | "Token Hover — 3D Distance Label" |
| `STA2E.Settings.ElevationRuler.Hint` | "When a token is selected and you hover another, show a floating 3D distance panel." |
| `STA2E.Settings.ShowMinutes.Name` | "Show Minutes on HUD" |
| `STA2E.Settings.ShowMinutes.Hint` | "Display HH:MM on the Stardate HUD alongside the date." |
| `STA2E.Settings.HudVisibility.Name` | "HUD Visible To" |
| `STA2E.Settings.HudVisibility.Hint` | "Who can see the Stardate HUD." |
| `STA2E.Settings.HudVisibility.GmOnly` | "GM Only" |
| `STA2E.Settings.HudVisibility.All` | "All Players" |
| `STA2E.Settings.HudTheme.Name` | "HUD Color Theme" |
| `STA2E.Settings.HudTheme.Hint` | "Visual theme for the Stardate HUD and associated dialogs." |
| `STA2E.Settings.HudTheme.Blue` | "Starfleet Blue (modern/default)" |
| `STA2E.Settings.HudTheme.LcarsTng` | "LCARS — TNG Classic (orange/tan/purple)" |
| `STA2E.Settings.HudTheme.LcarsTngBlue` | "LCARS — TNG Blue-Grey (cool blue/slate)" |
| `STA2E.Settings.HudTheme.TosPanel` | "TOS Panel — 2260s (boxy, gold/red/green)" |
| `STA2E.Settings.HudTheme.TmpConsole` | "TMP Console — 2270s (sleek, blue-white/green mono)" |
| `STA2E.Settings.HudTheme.EntPanel` | "ENT Panel — 2150s (dark gunmetal, industrial)" |
| `STA2E.Settings.HudTheme.Klingon` | "Klingon (crimson/black, aggressive)" |
| `STA2E.Settings.HudTheme.Romulan` | "Romulan (dark green, cold and precise)" |
| `STA2E.Settings.StressMode.Name` | "Stress Tracking Mode" |
| `STA2E.Settings.StressMode.Hint` | "Countdown: characters start with a full stress pool..." |
| `STA2E.Settings.StressMode.Countdown` | "Countdown — stress pool spent to avoid injuries (default)" |
| `STA2E.Settings.StressMode.Countup` | "Count-up — stress accumulates toward maximum" |
| `STA2E.Settings.NpcPersonalThreatSource.Name` | "NPC Personal Threat Source" |
| `STA2E.Settings.NpcPersonalThreatSource.Hint` | "Choose where notable and major NPCs pull Personal Threat from." |
| `STA2E.Settings.NpcPersonalThreatSource.Actor` | "NPC sheet only" |
| `STA2E.Settings.NpcPersonalThreatSource.Token` | "Token flag only" |
| `STA2E.Settings.NpcPersonalThreatSource.ActorThenToken` | "Combined — NPC sheet first, then token" |
| `STA2E.Settings.NpcPersonalThreatSource.TokenThenActor` | "Combined — token first, then NPC sheet" |
| `STA2E.Settings.Jb2aTier.Name` | "JB2A Asset Tier" |
| `STA2E.Settings.Jb2aTier.Hint` | "Select which version of JB2A you have installed." |
| `STA2E.Settings.Jb2aTier.Free` | "JB2A Free (jb2a_patreon free assets)" |
| `STA2E.Settings.Jb2aTier.Patron` | "JB2A Patron (full module)" |
| `STA2E.Settings.AutoVaporizeMinorNpc.Name` | "Ground Combat — Auto-Vaporize Minor NPCs on Instant Death" |
| `STA2E.Settings.AutoVaporizeMinorNpc.Hint` | "When a minor NPC is killed by a weapon with Vicious or similar, auto-apply the vaporize effect." |
| `STA2E.Settings.DeleteTokenOnDestruction.Name` | "Ship Destruction — Delete Token After Animation" |
| `STA2E.Settings.DeleteTokenOnDestruction.Hint` | "When a ship is destroyed, delete its token after the destruction animation completes." |
| `STA2E.Settings.BreachTokenFX.Name` | "Ship Damage — Token Magic Breach FX" |
| `STA2E.Settings.BreachTokenFX.Hint` | "Show progressive damage splash effects on ship tokens as they accumulate breaches." |
| `STA2E.Settings.BreachTrailFX.Name` | "Ship Damage — Warp Core Breach Visual FX" |
| `STA2E.Settings.BreachTrailFX.Hint` | "Show a persistent steam effect on a ship token after it takes a warp core breach." |
| `STA2E.Settings.UseDiceSoNice.Name` | "Adv. Dice Roller — Use Dice So Nice" |
| `STA2E.Settings.UseDiceSoNice.Hint` | "Show 3D dice animations via Dice So Nice when rolling from the Advanced Dice Roller." |
| `STA2E.Settings.InteractiveDicePayment.Name` | "Interactive Extra Dice Payment" |
| `STA2E.Settings.InteractiveDicePayment.Hint` | "If enabled, replaces the standard extra dice slider with an interactive spend-confirmation dialog." |
| `STA2E.Settings.OverrideSheetRoller.Name` | "Use Toolkit Dice Roller on Character Sheet" |
| `STA2E.Settings.OverrideSheetRoller.Hint` | "Intercepts attribute-test clicks on actor sheets and opens the Toolkit roller instead." |
| `STA2E.Settings.ThemeCharacterSheet.Name` | "Apply Toolkit Theme to Character Sheets" |
| `STA2E.Settings.ThemeCharacterSheet.Hint` | "Reskins STA2e actor sheets to match the active toolkit LCARS theme." |
| `STA2E.Settings.AlertVolume.Name` | "Alert Sound Volume" |
| `STA2E.Settings.AlertVolume.Hint` | "Volume for alert sounds on this client (0–1)." |
| `STA2E.Settings.PlayersCanSetAlert.Name` | "Players Can Change Alert Status" |
| `STA2E.Settings.PlayersCanSetAlert.Hint` | "If enabled, players can change the ship's alert condition from the Alert HUD." |
| `STA2E.Settings.AlertSoundLoop.Name` | "Red Alert Sound — Loop" |
| `STA2E.Settings.AlertSoundLoop.Hint` | "If enabled, the Red Alert sound loops continuously until the alert is cleared." |
| *(~45 additional sound path settings)* | *(name/hint pairs for each sound effect setting)* |

---

#### `scripts/main.js` — Keybindings & Scene Controls

| Suggested Key | Current Hardcoded Value |
|---|---|
| `STA2E.Keybinding.ToggleCombatHud.Name` | "Toggle Combat HUD" |
| `STA2E.Keybinding.ToggleCombatHud.Hint` | "Open or close the Quick Action Combat HUD for the selected token." |
| `STA2E.Keybinding.OpenTransporter.Name` | "Open Transporter Control" |
| `STA2E.Keybinding.OpenTransporter.Hint` | "Open the Transporter Control dialog (GM only)." |
| `STA2E.Keybinding.ToggleZoneEditor.Name` | "Toggle Zone Editor" |
| `STA2E.Keybinding.ToggleZoneEditor.Hint` | "Open or close the Zone Editor toolbar (GM only)." |
| `STA2E.SceneControl.Sta2eWidget.Title` | "STA2e Toolkit" |

---

#### Notifications (`ui.notifications.*` calls across multiple files)

These are shown as toast messages to users. Found in `main.js`, `combat-hud.js`, `zone-data.js`, `transporter.js`, and others.

| Suggested Key | Current Hardcoded Value |
|---|---|
| `STA2E.Notification.SelectTokenFirst` | "STA2e Toolkit: Select a token first to open the Combat HUD." |
| `STA2E.Notification.NoShipActors` | "STA2e Toolkit: No starship actors found in the world." |
| `STA2E.Notification.NoTargetSelected` | "No targets selected. Select a target token first." |
| `STA2E.Notification.NoCombatHud` | "CombatHUD not available." |
| `STA2E.Notification.ShipTokenNotFound` | "Could not find ship token — attack resolution cancelled." |
| `STA2E.Notification.SystemDestroyed` | "STA2e Toolkit: {system} is destroyed — this task cannot be attempted." |
| `STA2E.Notification.NotEnoughResource` | "Not enough {type} available!" |
| `STA2E.Notification.WeaponNotFound` | "STA2e Toolkit: Weapon not found." |
| `STA2E.Notification.NoGroundCharacters` | "No other ground characters found on the scene." |
| `STA2E.Notification.SelectTargetFirst` | "Select a target first." |
| `STA2E.Notification.CouldNotLoadTarget` | "Could not load target character." |
| `STA2E.Notification.CharacterNoInjuries` | "{name} has no injuries and is not Defeated." |
| `STA2E.Notification.NoReservePower` | "{actor}: No Reserve Power available — use Regain Power first." |
| `STA2E.Notification.ShieldsAtZero` | "{actor}: Shields are at 0 — cannot modulate." |
| `STA2E.Notification.NoBreachedSystems` | "{actor} has no breached systems to patch." |
| `STA2E.Notification.NoBreaches` | "STA2e Toolkit: No hull breaches to repair." |
| `STA2E.Notification.NoStrainComplications` | "STA2e Toolkit: No strain complications found." |
| `STA2E.Notification.NoAssistingCharacters` | "No other stations have assigned characters to assist." |
| `STA2E.Notification.NoAssistingDirectors` | "No other stations have assigned characters to direct." |
| `STA2E.Notification.CouldNotFindActorForDamage` | "STA2e Toolkit: Could not find target actor to apply damage." |
| `STA2E.Notification.CouldNotFindActorForDevastating` | "STA2e Toolkit: Could not find target actor for Devastating Attack." |
| `STA2E.Notification.NoAnimationConfig` | "STA2e Toolkit: No animation config for this weapon." |
| `STA2E.Notification.PrimaryTokenNotFound` | "STA2e Toolkit: Primary target token not found for Area attack." |
| `STA2E.Notification.NoNearbyTargets` | "No nearby starship targets within 250 px of the primary target." |
| `STA2E.Notification.CouldNotFindActorForInjury` | "STA2e Toolkit: Could not find target actor for injury." |
| `STA2E.Notification.FailedToPostInjury` | "Failed to post injury decision card — see console for details." |
| `STA2E.Notification.TransportInstruction` | "Click a destination on the scene, or press Escape to cancel." |
| `STA2E.Notification.MovementCostThreat` | "Spent {cost} Threat for zone movement cost." |
| `STA2E.Notification.MovementCost` | "Paid {cost} movement cost ({momentum_spent} Momentum, +{threat_added} Threat)." |
| `STA2E.Notification.HazardTokenNotFound` | "STA2e Toolkit: Could not find token to apply hazard damage." |
| `STA2E.Notification.HazardReset` | "STA2e Toolkit: Reset \"{label}\"{refund_text}" |
| `STA2E.Notification.WildcardTableNotFound` | "STA2e Toolkit: Wildcard Namer could not find table \"{tableName}\"" |

---

### Priority Tier 2 — Combat HUD, NPC Roller

---

#### `scripts/combat-hud.js` — Bridge Stations

The `BRIDGE_STATIONS` constant defines all station action `label` and `tooltip` strings. These are rendered as buttons and tooltips in the combat HUD.

**Station Labels:**
| Suggested Key | Value |
|---|---|
| `STA2E.Station.Command.Label` | "Command" |
| `STA2E.Station.Helm.Label` | "Helm" |
| `STA2E.Station.Navigator.Label` | "Navigator" |
| `STA2E.Station.Comms.Label` | "Comms" |
| `STA2E.Station.Operations.Label` | "Ops/Eng" |
| `STA2E.Station.Tactical.Label` | "Tactical" |
| `STA2E.Station.Sensors.Label` | "Sensors" |
| `STA2E.Station.Medical.Label` | "Medical" |

**Common Actions (appear on multiple stations):**
| Suggested Key | Value |
|---|---|
| `STA2E.Action.Assist.Label` | "Assist" |
| `STA2E.Action.Assist.Tooltip` | "Declare which station(s) you are assisting this round." |
| `STA2E.Action.CreateTrait.Label` | "Create Trait" |
| `STA2E.Action.CreateTrait.Tooltip` | "Standard Create Trait action — establish a fact about the scene." |
| `STA2E.Action.Direct.Label` | "Direct" |
| `STA2E.Action.Direct.Tooltip` | "Commit your major action to direct another crew member, granting them a bonus die." |
| `STA2E.Action.Rally.Label` | "Rally" |
| `STA2E.Action.Rally.Tooltip` | "Presence + Command, Difficulty 0 — restore Morale or steady the crew." |
| `STA2E.Action.TaskRoll.Label` | "Task Roll" |
| `STA2E.Action.TaskRoll.Tooltip` | "Open the Task Roller for this station." |
| `STA2E.Action.Override.Label` | "Override" |
| `STA2E.Action.Override.Tooltip` | "Operate the controls of another position (cross-station action)." |
| `STA2E.Action.Pass.Label` | "Pass" |
| `STA2E.Action.Pass.Tooltip` | "Do nothing this turn — forfeit your Major Action." |
| `STA2E.Action.Ready.Label` | "Ready" |
| `STA2E.Action.Ready.Tooltip` | "Hold your Major Action to react to an event later this round." |

**Station-Specific Actions** (representative sample — all follow same pattern):
| Suggested Key | Value |
|---|---|
| `STA2E.Action.Impulse.Label` | "Impulse" |
| `STA2E.Action.Impulse.Tooltip` | "Move the ship under impulse power." |
| `STA2E.Action.Warp.Label` | "Warp" |
| `STA2E.Action.Warp.Tooltip` | "Engage warp drive." |
| `STA2E.Action.FireWeapon.Label` | "Fire Weapon" |
| `STA2E.Action.FireWeapon.Tooltip` | "Fire a ship weapon at a target." |
| `STA2E.Action.BeamIn.Label` | "Beam In" |
| `STA2E.Action.BeamIn.Tooltip` | "Beam a character in from the buffer." |
| `STA2E.Action.BeamOut.Label` | "Beam Out" |
| `STA2E.Action.BeamOut.Tooltip` | "Beam a character out to the buffer." |
| *(~30 additional station actions)* | *(follow same Label/Tooltip pattern)* |

**Ground Actions** (all `label`/`tooltip` pairs in `GROUND_ACTIONS`):
| Suggested Key | Value |
|---|---|
| `STA2E.GroundAction.Aim.Label` | "Aim" |
| `STA2E.GroundAction.Aim.Tooltip` | "Spend a Minor Action to Aim, granting a bonus die on your next attack." |
| `STA2E.GroundAction.Attack.Label` | "Attack" |
| `STA2E.GroundAction.Attack.Tooltip` | "Make a melee or ranged attack against a target." |
| `STA2E.GroundAction.FirstAid.Label` | "First Aid" |
| `STA2E.GroundAction.FirstAid.Tooltip` | "Attempt to treat an injury on yourself or an adjacent character." |
| `STA2E.GroundAction.Sprint.Label` | "Sprint" |
| `STA2E.GroundAction.Sprint.Tooltip` | "Move up to two zones instead of one." |
| *(~10 additional ground actions)* | *(follow same pattern)* |

---

#### `scripts/npc-roller.js`

| Suggested Key | Value |
|---|---|
| `STA2E.CrewQuality.Basic.Label` | "Basic" |
| `STA2E.CrewQuality.Proficient.Label` | "Proficient" |
| `STA2E.CrewQuality.Talented.Label` | "Talented" |
| `STA2E.CrewQuality.Exceptional.Label` | "Exceptional" |
| `STA2E.Discipline.Command.Label` | "Command" |
| `STA2E.Discipline.Conn.Label` | "Conn" |
| `STA2E.Discipline.Engineering.Label` | "Engineering" |
| `STA2E.Discipline.Medicine.Label` | "Medicine" |
| `STA2E.Discipline.Science.Label` | "Science" |
| `STA2E.Discipline.Security.Label` | "Security" |
| `STA2E.Reroll.TalentReroll.Label` | "Bold / Cautious — Reroll a Die" |
| `STA2E.Reroll.TalentReroll.Short` | "Reroll a Die" |
| `STA2E.Reroll.Advisor.Label` | "Advisor — Reroll a Die" |
| `STA2E.Reroll.Advisor.Short` | "Reroll a Die" |
| `STA2E.Reroll.Determination.Label` | "Spend Determination — Reroll Dice" |
| `STA2E.Reroll.Determination.Short` | "Reroll Dice" |
| `STA2E.Reroll.TargetingSolution.Label` | "Targeting Solution — Reroll a Die" |
| `STA2E.Reroll.TargetingSolution.Short` | "Reroll a Die" |
| `STA2E.Reroll.CalibrateSensors.Label` | "Calibrate Sensors — Reroll a Die" |
| `STA2E.Reroll.CalibrateSensors.Short` | "Reroll a Die" |
| `STA2E.Reroll.TechExpertise.Label` | "Technical Expertise — Reroll a Die (Crew or Ship)" |
| `STA2E.Reroll.TechExpertise.Short` | "Reroll a Die (Crew or Ship)" |
| `STA2E.Reroll.Aim.Label` | "Aim ({remaining} remaining) — Reroll a Die" |
| `STA2E.Reroll.Aim.Short` | "Reroll a Die" |
| `STA2E.Reroll.Generic.Label` | "Talent / Trait Reroll" |
| `STA2E.Reroll.Generic.Short` | "Reroll a Die" |

---

### Priority Tier 3 — Supporting UI Elements

---

#### `scripts/alert-hud.js`

| Suggested Key | Value |
|---|---|
| `STA2E.Alert.Condition.Green` | "Green" |
| `STA2E.Alert.Condition.Blue` | "Blue" |
| `STA2E.Alert.Condition.Yellow` | "Yellow" |
| `STA2E.Alert.Condition.Red` | "Red" |
| `STA2E.Alert.Tooltip.Current` | "Current: Condition {label}" |
| `STA2E.Alert.Tooltip.CanChange` | "Set Condition {label}" |
| `STA2E.Alert.Tooltip.CannotChange` | "Condition {label}" |

---

#### `scripts/campaign-store.js`

| Suggested Key | Value |
|---|---|
| `STA2E.Campaign.DefaultName` | "New Campaign" |

---

#### `scripts/toolkit-widget.js`

| Suggested Key | Value |
|---|---|
| `STA2E.Widget.Title` | "STA2e Toolkit" |
| `STA2E.Widget.CloseButton.Title` | "Close widget" |
| `STA2E.Widget.Button.CombatHud.Label` | "Combat HUD" |
| `STA2E.Widget.Button.NpcRoller.Label` | "NPC Roller" |
| `STA2E.Widget.Button.Transporter.Label` | "Transporter" |
| `STA2E.Widget.Button.WarpCalc.Label` | "Warp Calc" |
| `STA2E.Widget.Button.AlertHud.Label` | "Alert Status" |

---

#### `scripts/elevation-ruler.js`

| Suggested Key | Value |
|---|---|
| `STA2E.Label.Range` | "RANGE" |
| `STA2E.Label.Time` | "TIME" |
| `STA2E.Label.Horizontal` | "H" |
| `STA2E.Label.Vertical` | "V" |

---

#### `scripts/combat-hud.js` — Engage/Flee Button States

| Suggested Key | Value |
|---|---|
| `STA2E.Button.Engaged` | "✓ ENGAGED" |
| `STA2E.Button.Engage` | "⚡ ENGAGE" |
| `STA2E.Button.Fled` | "✓ FLED" |
| `STA2E.Button.Flee` | "🚀 FLEE" |

---

#### `scripts/main.js` — NPC Ship Roller Dialog

| Suggested Key | Value |
|---|---|
| `STA2E.Dialog.NpcShipDiceRoller.Title` | "NPC Ship Dice Roller" |
| `STA2E.Dialog.NpcShipDiceRoller.SelectLabel` | "Select NPC Ship" |
| `STA2E.Dialog.NpcShipDiceRoller.OpenButton` | "Open Roller" |
| `STA2E.Dialog.NpcShipDiceRoller.CancelButton` | "Cancel" |

---

## 4. Keys That Do NOT Need Localization

The following categories of strings are intentionally not localized and should remain hardcoded:

- **CSS class names and HTML attributes** — these are structural, not user-facing
- **Internal flag keys and setting keys** — e.g., `"sta2e-toolkit"`, `"zones"` — these are data identifiers
- **Socket action names** — e.g., `"applyDamage"`, `"broadcastHUD"` — internal protocol
- **Console `console.log` / `console.warn` messages** — developer-facing only; localizing these adds no user value and makes debugging harder across locales
- **Era identifiers** — `"tng"`, `"tos"`, `"ent"` etc. — used as data keys
- **LCARS color tokens** — theme constants, not UI text

---

## 5. Implementation Approach

### Recommended order

1. **Settings** — highest visibility, shown in Foundry's Settings UI to all GMs
2. **Keybindings and scene controls** — shown in Foundry's Keybinding config
3. **Notifications** — shown to players during play
4. **Combat HUD station actions** — large volume, high gameplay importance
5. **NPC Roller** — self-contained, manageable scope
6. **Alert HUD, Widget, supporting files** — small, quick wins

### Pattern for migrating a setting

**Before:**
```js
game.settings.register("sta2e-toolkit", "stressMode", {
  name: "Stress Tracking Mode",
  hint: "Countdown: characters start with a full stress pool...",
  ...
});
```

**After (in `settings.js`):**
```js
game.settings.register("sta2e-toolkit", "stressMode", {
  name: "STA2E.Settings.StressMode.Name",
  hint: "STA2E.Settings.StressMode.Hint",
  ...
});
```

**In `en.json`:**
```json
"STA2E.Settings.StressMode.Name": "Stress Tracking Mode",
"STA2E.Settings.StressMode.Hint": "Countdown: characters start with a full stress pool...",
```

Foundry automatically calls `game.i18n.localize()` on `name` and `hint` in `settings.register`, so no code change is needed beyond passing the key string.

### Pattern for migrating a notification

**Before:**
```js
ui.notifications.warn(`STA2e Toolkit: ${systemName} is destroyed — this task cannot be attempted.`);
```

**After:**
```js
ui.notifications.warn(game.i18n.format("STA2E.Notification.SystemDestroyed", { system: systemName }));
```

**In `en.json`:**
```json
"STA2E.Notification.SystemDestroyed": "STA2e Toolkit: {system} is destroyed — this task cannot be attempted."
```

---

## 6. Estimated Key Count

| Section | Approx. New Keys |
|---|---|
| Settings (names, hints, choices) | ~110 |
| Keybindings | 6 |
| Notifications | ~35 |
| Combat HUD station actions | ~80 |
| Combat HUD ground actions | ~20 |
| NPC Roller (qualities, disciplines, rerolls) | ~30 |
| Alert HUD | 7 |
| Widget buttons | 8 |
| Dialog labels | ~10 |
| Miscellaneous labels | ~10 |
| **Total new keys** | **~316** |

Combined with the existing ~70 keys, the complete `en.json` would have approximately **~386 entries**.

---

## 7. Files That Are Already Fully or Mostly Localized

- `scripts/zone-data.js` — zone range bands and most zone UI strings use existing keys
- `scripts/zone-editor.js` — zone editor toolbar buttons use existing `STA2E.Zones.*` keys
- `scripts/wildcard-namer.js` — menu registration uses `STA2E.WildcardNamer.*` keys

These files still have a few hardcoded notification strings (noted in the tables above) but are otherwise in good shape.
