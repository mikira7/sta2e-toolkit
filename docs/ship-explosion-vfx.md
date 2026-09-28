# Native starship explosion

Reload Foundry, then select **Module Settings → STA 2e Toolkit → Starship
Explosion Animation → Native — Trek fireball and debris**. JB2A remains the
default and can be selected again at any time.

The native effect has a white-hot initial flash followed by six overlapping,
expanding billows of warm fire and a localized blue plasma pocket. The WebGL
shader integrates through a small 3D density field in 20 depth samples, allowing
foreground smoke to obscure the illuminated interior. Low-frequency turbulence,
internal shadows, and a soft glow replace the earlier flat, grainy cloud texture.
The fire cools into dissipating smoke over 1.5 seconds.
Radial sparks and 28 angular metal fragments tumble outward and disappear
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

- `node --experimental-vm-modules tests/ship-explosion-vfx.mjs` exercises
  deterministic particles, scene/visibility guards, socket duplication,
  cleanup, preview isolation, and combat deletion behavior without Sequencer.
- `node tests/serve-transporter-tests.cjs` serves
  `http://127.0.0.1:3188/tests/ship-explosion-browser.html` using the installed
  Foundry PIXI library. Rendering checks cover visible fireball, its quick fade,
  lingering debris, particle expiry, WebGL errors, fallback, and resource cleanup.
  Replay and the time slider allow visual inspection of each stage.

Live multiplayer playback still needs confirmation in a running Foundry world.
