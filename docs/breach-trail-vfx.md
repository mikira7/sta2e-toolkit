# Warp core breach exhaust

In Configure Settings → STA 2e Toolkit, enable **Ship Damage — Warp Core Breach Visual FX** and choose **Ship Damage — Warp Core Breach Trail Style**:

- **JB2A animation** preserves the existing animation and its Animation Overrides entry. This remains the default.
- **Native smoke — warp nacelles** uses custom Breach Exhaust vents when saved. Otherwise it uses Warp engine anchor locations (including warp curve aft endpoints), with exhaust always directed aft rather than inheriting curve tangents. Ships without anchors use one aft engineering vent.
- **Native warp plasma — underside vent** uses the same custom Breach Exhaust vents, or defaults to a central aft engineering vent, at 50% image width and 68% image height, directed aft.

In the **Ship VFX Anchor editor → Breach Exhaust** tab, click the image to place up to four vents. Drag markers to position them and select a marker to adjust its exhaust direction. Ships face down, so new vents and automatic exhaust default to **0° up/aft**. Other image-local directions are 90° right, 180° down/fore, and 270° left. Explicitly saved directions are preserved. Preview plays unsaved settings locally; it uses native smoke when the world style is JB2A. Save updates active native exhaust on all clients. Clear removes the custom vents and restores default locations and directions while preserving the chosen trail length. Points, directions and length are included in ship VFX exports/imports.

The **Trail Length** slider in Breach Exhaust scales the cone from **0.5× to 5×**. **1×** is the standard length for the displayed ship size; try **2×–3×** for a longer plume. This per-ship setting applies to native smoke and plasma, saves with the vents, and is included in exports. Increasing length extends particle lifetime and reduces drag so gas travels farther even while the ship is stationary. Preview uses the unsaved length and increases its duration for large smoke plumes, up to 30 seconds.

Native particles retain their scene positions and initial exhaust direction after emission, expanding and fading over roughly three seconds at 1× length. Turning the ship moves the vent, not the smoke already released. The native modes require neither JB2A nor Sequencer and continue during the death-throes sequence. The existing master toggle disables both warning and destruction exhaust.

The shader is validated with Foundry's installed PIXI 7.4.3/WebGL. Other renderers use soft Graphics puffs. Effects are reconstructed locally from synchronized token flags and cleaned up on stabilization, final destruction, token deletion and canvas teardown. No per-frame network messages are sent. A ship uses at most four nacelle emitters and 160 live puffs.

Each vent has a continuous tapered nozzle plume, with elongated gas clouds peeling away into the scene. Plasma has a brighter blue-white core and a tighter flow; smoke keeps a denser grey vent. Both use the same gas velocity, drag and lifetime for the same vent placement. The glow's turbulence shares the plume's size/length-adjusted clock, with a slow internal ripple rather than a fast stream running ahead of the smoke. Only the nozzle follows the ship's current rotation; released gas retains its emission direction. The fallback renderer also draws a vent cone. The renderer adds at most four nozzle quads to the existing particle budget.

Exhaust automatically scales to the displayed artwork, including token dimensions, texture fit, texture scale and mirroring. There is no fixed pixel size ceiling. Plume width grows with the ship, while drift speed increases only with the square root of ship size above one grid cell. Larger smoke and plasma plumes linger longer and lose speed more gradually, preserving their reach beyond the hull without rapidly shooting puffs outward. Resizing a token updates newly emitted gas; smoke already in space keeps its position, size and drag. Trail Length remains a multiplier on the automatic result. Emission spacing adjusts to the longer lifetime so particle count stays bounded regardless of ship size.

## Verification

Run `node --experimental-vm-modules tests/breach-trail-vfx.mjs` for movement, rotation, teleport, lifetime, visibility and lifecycle tests.

Run `node tests/serve-transporter-tests.cjs`, then open `http://127.0.0.1:3188/tests/breach-smoke-browser.html` for the isolated shader and fallback rendering checks. This fixture uses installed Foundry PIXI and does not access a world database.

In-world acceptance: select a native style, flag a ship for a breach, move and rotate it, then begin destruction. Existing exhaust should stay behind while the vent follows the visible hull. Clear the warning to stop it, or finish destruction. Check the same scene on a player client. Full live-world multiplayer acceptance remains manual.
