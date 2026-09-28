# Native starship explosion

Reload Foundry, then select **Module Settings → STA 2e Toolkit → Starship
Explosion Animation → Native — Trek fireball and debris**. JB2A remains the
default and can be selected again at any time.

For individual ships, open **Ship VFX Anchors → Ship Destruction** (below the
active tab's settings). **Explosion Effect** selects World Default, JB2A, or
Native for that ship, including the smaller death-throes bursts. **Native
Color** selects Classic, Borg Green, Blue, Red, or Violet. Click **Save**.
Choices are included in the editor's VFX export/import. Linked actors share
them across their tokens; unlinked ships save them on their synthetic actor.

**Final explosion shockwave with mist** is an independent checkbox, off by default. It adds
a luminous, expanding circular energy ring with a soft, turbulent mist wake
trailing on the inside of the advancing front to the final detonation with
either explosion renderer. The ring matches Native Color, lasts 1.8 seconds,
and does not repeat for small secondary hull bursts. It is an energy-ring
visual, not a screen-distortion filter or an area-damage mechanic.

**Preview Explosion** uses the current unsaved effect, color, and shockwave
choices. **Preview Shockwave Only** lets you inspect the ring separately even
with the checkbox off. Both are local, do not play the destruction sound,
and never hide or delete the ship. JB2A preview requires its assets and Sequencer.

**Hull meltdown before breach / engine destruction** is on by default. During
warp-core-breach or engines-destroyed destruction, a five-second token shader
runs with the final explosion starting three seconds in, while the hull is
still dissolving. A few localized breaches spread across the
original artwork, leaving intact plating around dark, charred cavities with
molten glowing rims and flickering plasma patches. Classic uses orange rims
and blue plasma; the other ship colors also apply, including Borg green.
The scorched areas then burn through into transparent holes and shed embers.
The hull keeps burning away beneath the fireball, then stays dissolved through
the remaining blast. Token hiding and deletion wait for the dissolve. Ordinary ship
destruction skips this stage, and the shockwave still plays only with the
final explosion when enabled.

**Preview Hull Meltdown** plays only this stage using the editor's current
color and restores the ship afterward. Closing the editor also stops its
preview. A selected-token macro can run the same local preview:

```js
game.sta2eToolkit.previewShipMeltdown();
```

The standalone filter never changes token documents or deletes a token. It
preserves other token filters and cleans up on completion, cancellation, or
scene teardown. Combat playback uses a scene-scoped, timestamped socket event.
The hull shader requires PIXI 7 WebGL; unsupported renderers skip the visual
while retaining the delay before the explosion.

The native effect has a white-hot initial flash followed by six overlapping,
expanding billows of warm fire and a localized blue plasma pocket. The WebGL
shader integrates through a small 3D density field in 20 depth samples, allowing
foreground smoke to obscure the illuminated interior. Low-frequency turbulence,
internal shadows, and a soft glow replace the earlier flat, grainy cloud texture.
The fire cools into dissipating smoke over 1.5 seconds.
220 sparks with bright cores and additive glow trails, plus 28 angular metal
fragments, tumble outward and disappear
over roughly three seconds. Smaller bursts
during death throes use the same effect with fewer particles. The debris is
procedural metal, not pieces sampled from the token artwork.

Select a ship and open the **VFX Test Panel → Preview Ship Explosion**.
The preview is local and never changes or deletes the token. The same preview
is available to script macros:

```js
game.sta2eToolkit.previewShipExplosion();
```

Combat playback uses the existing destruction sound and **Delete Token on
Destruction** setting. With deletion enabled, the GM hides the hull under the
flash and removes the token after the effect. With deletion disabled, its alpha
and document remain intact. Native playback needs neither JB2A nor Sequencer.

Playback broadcasts a scene-scoped position/size/seed snapshot so fragments
keep moving independently of the token. Hidden and nonvisible ships are
filtered on receiving clients. Cleanup runs on completion, scene teardown,
and a safety timer. Bursts are capped at 16 concurrent effects per client.
PIXI 7 WebGL uses the custom fireball shader; other renderers use a Graphics
fireball with the same debris animation.

## Validation

- `node --experimental-vm-modules tests/ship-meltdown-vfx.mjs` checks filter
  preservation, preview restoration, cancellation, socket timing and guards,
  cleanup, and the final explosion overlapping the active hull dissolve.
- `http://127.0.0.1:3188/tests/ship-meltdown-browser.html` previews the full
  burn-through and explosion sequence. Real PIXI rendering checks verify
  intact plating, charred interiors, molten rims, erosion, complete removal,
  restoration, and WebGL errors.
- `node --experimental-vm-modules tests/ship-explosion-vfx.mjs` exercises
  deterministic particles, scene/visibility guards, socket duplication,
  cleanup, preview isolation, and combat deletion behavior without Sequencer.
- `node tests/serve-transporter-tests.cjs` serves
  `http://127.0.0.1:3188/tests/ship-explosion-browser.html` using the installed
  Foundry PIXI library. Rendering checks cover visible fireball, its quick fade,
  lingering debris, particle expiry, WebGL errors, fallback, and resource cleanup.
  Replay and the time slider allow visual inspection of each stage.

Live multiplayer playback still needs confirmation in a running Foundry world.
