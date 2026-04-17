# STA 2e Toolkit

A FoundryVTT module for **Star Trek Adventures 2nd Edition** (the `sta` game system).

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
  <img width="766" height="394" alt="image" src="https://github.com/user-attachments/assets/38df0128-0e35-4412-941b-2e7149f98c43" />

- **Alert HUD** — alert status overlay with soudfx that can be added in the settings.
 <img width="200" height="102" alt="image" src="https://github.com/user-attachments/assets/2780004b-1684-4b80-8221-13303c3db53c" />
 
- **Wildcard Namer** — auto-names wildcard tokens from rollable tables using a the name of a trait within the character sheet or star ship sheet.
- **Token Distance Hover over** - While a token is select hoveing over another token show's it distance and auto calculates with the elevation of the token, and is full intergrated with the zone system. 

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
