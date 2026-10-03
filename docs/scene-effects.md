# Scene Effects

As GM, open **Toolkit → Scene Effects** while viewing a scene.

Configure optional audio under **Toolkit settings → Sounds & Animations → Scene Effects**. Browse for separate sound files for bridge impact, earthquake, electrical bursts, explosions, and the coolant leak, then save. Preview buttons audition the typed file on the GM's client only. The shared **Sound Volume** setting is 0–100%; blank paths or zero volume are silent. No sound files are bundled.

Use **+ Add sound choice** beneath any effect to add more files, each with its own browse, preview, and remove buttons. Save to keep the choices. Each playback randomly selects one file from the main path and up to 32 additional choices; blank entries and duplicate paths are skipped. Additional choices also work when the main path is blank. The shared effect seed makes every viewer select the same file. Coolant chooses one loop per activation and retains it through visual edits and late-player restoration; stopping and restarting can choose a different loop.

Sounds accompany effects for clients viewing that scene; local effect previews remain local. A burst at multiple consoles plays each sound type once, avoiding stacked identical audio. Coolant audio loops until stopped, resumes for returning viewers, and continues through plume direction/size edits. Stop controls, natural transient completion, and scene teardown stop the associated audio, including files still loading. Changing the saved coolant sound or volume updates its running loop.

The panel displays **Canvas Shake**, **Electrical**, **Explosion**, and **Coolant Leak** icon buttons. Click an icon to expand its settings and playback controls; click it again to collapse them.

- **Bridge impact** starts with a jolt and quickly settles.
- **Earthquake** builds into sustained shaking and then settles.
- Adjust strength in screen pixels, duration in seconds, and frequency in Hz.
- **Preview locally** plays only on the GM's canvas.
- **Shake Everyone** plays for all connected users currently viewing the same scene, including the GM.
- **Stop for Everyone** cancels shaking on that scene, including a local preview.

The panel is draggable and remembers its position on this client. Changing styles loads that style's default values. New shakes replace an existing shake. Scene teardown and natural completion clear the effect. The canvas moves visually without changing camera pan, zoom, scene documents, or token positions; other interface elements stay steady. No optional VFX module is required.

GM macros can also trigger or stop the shared effect:

```js
game.sta2eToolkit.shakeCanvas({ mode: "impact", strength: 14, duration: 1.5, frequency: 24 });
game.sta2eToolkit.shakeCanvas({ mode: "earthquake", strength: 8, duration: 8, frequency: 12 });
game.sta2eToolkit.stopCanvasShake();
```

This is a manual effect; ship damage does not trigger it automatically. Broadcasts are transient, so users who join or switch to the scene afterward do not replay an earlier shake. Playback starts when each client receives the broadcast.

## Bridge consoles

Open **Electrical** or **Explosion**, then click **Add console** and click a console on the canvas. Escape, right-click, closing the panel, or changing scenes cancels placement. Locations are saved in the scene's `sta2e-toolkit.consoleEffectLocations` flag and shared by both effects; they survive reloads.

Each console row has an editable name and burst size (scene pixels), plus icon buttons to **play for everyone**, **preview locally**, **move**, and **remove** the location. **Show saved locations** draws named markers visible only to the GM. These controls affect saved effect anchors and never change the bridge artwork or tokens.

**Fire random consoles** selects the requested number of distinct saved consoles, up to 16 per burst. If fewer locations exist, it uses all available locations once. Enable **Mix sparks & explosions for random** to randomly choose electrical or explosion playback at each selected console. The same selections are sent to every viewer of that scene.

**Include canvas shake** adds one shake to the whole burst, using the current settings under **Canvas Shake**. Disable it for sparks or explosions alone. Local previews keep both the burst and optional shake local. **Stop effects & shake for everyone** clears all console bursts and the canvas shake on the viewed scene.

Electrical bursts use blue-white arcs, falling sparks, soft pulsing blue bloom, bright contact flashes, and a subtle horizontal lens flare. Explosions ray-march a small three-dimensional volume with turbulent fire, internally lit smoke, foreground absorption, and smoke that rises as the fire cools. The volume uses a bounded 16-sample shader on PIXI 7 and 8 WebGL renderers; shaded billows provide a fallback when the shader is unavailable. Both are native PIXI effects; no Sequencer or animation pack is required. Up to 64 saved consoles and 32 active bursts per client are supported. Effects and shader resources clean up when they finish or the canvas tears down; electrical glow textures are shared and released on teardown.

GM macro examples:

```js
// Two distinct random consoles, with sparks or explosions and a bridge shake.
game.sta2eToolkit.playConsoleEffects({ count: 2, kind: "mixed", shake: true });
// Play specific saved console IDs.
game.sta2eToolkit.playConsoleEffects({ ids: ["saved-console-id"], kind: "electric", duration: 3 });
game.sta2eToolkit.stopConsoleEffects();
```

Validation: `node --experimental-vm-modules tests/scene-effects.mjs`.
Console validation: `node --experimental-vm-modules tests/console-effects.mjs`.
Cinematic resource validation: `node --experimental-vm-modules tests/console-cinematic-vfx.mjs`.

For a visual WebGL check, serve the module directory locally and open `tools/console-cinematic-preview.html`. It renders deterministic ignition, fire/arc, and cooling frames using PIXI 7.4.3 and 8.14.0 from the official PixiJS CDN. The local volume filter follows the [PIXI custom-filter APIs](https://pixijs.com/8.x/guides/components/filters).

## Warp core coolant leak

Open **Coolant Leak**, click **Place / move leak source**, then click the emission point on the canvas. **Start for Everyone** starts a continuous cold blue-white volumetric vapor plume from that point. Adjust **plume size** in scene pixels, **vapor density**, **flow speed**, and **direction** before or during playback. Direction rotates clockwise around the saved source: **0° up, 90° right, 180° down, 270° left**. The direction is saved to the scene and shared with its viewers. **Stop for Everyone** removes the plume and retains the saved source; **Remove saved source** stops it and clears the point.

The source, configuration, running state, and start time are saved in `sta2e-toolkit.coolantLeak` on the scene. Closing the panel does not stop it. Reloading, a late player joining, or returning to the scene restores a running leak. Leaving the scene releases local GPU and ticker resources without changing its saved running state. Only the GM can change the flag. One continuous plume is supported per scene, with a bounded 16-sample local volume shader and a flowing Graphics fallback. Console stop buttons control console bursts and shaking; use the coolant leak's own Stop button for the persistent plume.

The plume blends moving, rounded billows at different depths into a continuous jet. Directional highlights, smoke self-shadowing, cool rim light, and foreground absorption make the vapor read as a three-dimensional volume.

For an isometric bridge map, choose **Map view → Isometric**. This foreshortens the jet, tilts the volume's depth sampling, and adds a soft floor contact shadow to anchor the elevated vapor to its source. Direction still aims the jet in screen degrees. The view setting is saved per scene, shared with everyone, and can change while the leak runs. Existing scenes default to **Top down**. This is an artistic projection preset; it does not infer the map's camera angle or occlude vapor behind painted scenery. The Graphics fallback uses a shorter plume with staggered depth offsets.

GM macros:

```js
await game.sta2eToolkit.setCoolantLeakConfig({ x: 500, y: 700, size: 80, density: 1, speed: 1 });
await game.sta2eToolkit.setCoolantLeakConfig({ projection: "isometric" });
await game.sta2eToolkit.startCoolantLeak();
await game.sta2eToolkit.stopCoolantLeak();
```

Validation: `node --experimental-vm-modules tests/coolant-leak.mjs`. For a visual check, open `tools/coolant-leak-preview.html` using the same local preview server.

Audio validation: `node --experimental-vm-modules tests/scene-effect-audio.mjs`.
