# Animated door textures

Eight transparent overhead textures for Foundry's native animated doors. Each image contains one horizontal door leaf with its hinge on the left; there is no fixed frame or floor artwork.

Wood and metal doors include a pair of lever handles near the latch end, visible from overhead on both sides of the leaf.

| Material | Thin | Thick |
| --- | --- | --- |
| Wood | `wood-thin.webp` | `wood-thick.webp` |
| Stone | `stone-thin.webp` | `stone-thick.webp` |
| Metal | `metal-thin.webp` | `metal-thick.webp` |
| Jail / barred iron | `jail-thin.webp` | `jail-thick.webp` |

## Use in Foundry VTT 13–14

1. Open a door wall's configuration and choose an animation, such as **Swing** or **Slide**.
2. In **Door Texture**, browse **User Data → modules → sta2e-toolkit → assets → doors** and choose a WebP file.
3. Save, then open and close the door. Use **Open Direction** or **Flip Door Texture** to adjust its orientation. Enable **Double Door** when appropriate; Foundry repeats the single leaf for each half.

For example, paste this path into Door Texture:

```text
modules/sta2e-toolkit/assets/doors/wood-thick.webp
```

Foundry supplies the animation; these files are static textures. Width automatically stretches along the door wall. Exports are 400 pixels wide, calibrated for Foundry's default texture grid of 200. Thin and thick leaves retain their original 20 and 40 pixel depth envelopes (0.10 and 0.20 scene grid squares); wood and metal canvases include additional space above and below for the protruding handles. Their leaf center remains aligned to the wall. A wall with a custom `flags.core.textureGridSize` uses its custom scale instead.

Jail textures depict a gate's top rail and bars from overhead. To allow vision through a closed jail door, configure the wall's sight restriction separately; texture transparency does not control sight or movement.

See the [labeled preview](../../docs/door-textures/preview.png), [generation prompts](../../docs/door-textures/prompts.json), and [source artwork](../../docs/door-textures/sources). Images were created with the built-in image generation tool. The export script crops transparent margins and resizes the art while retaining alpha, then writes lossless WebP files.

The [handle edit prompts](../../docs/door-textures/handle-prompts.json) record the wood and metal updates. Original sources remain in [before-handles](../../docs/door-textures/sources/before-handles), with their leaf bounds in [handle-registration.json](../../docs/door-textures/handle-registration.json) for consistent export sizing.

To rebuild, run `node tools/build-door-textures.mjs` with Sharp installed, or pass its absolute module path as the first argument. The script verifies all eight files' dimensions and transparency. Native door scaling was checked against the installed Foundry v14 implementation; live scene animation has not been visually verified.
