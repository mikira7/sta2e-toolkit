# Ground cone and tractor polish validation

Validated with the installed Foundry shader classes and PIXI 7.4.3. The gallery
uses the real ground and tractor runners, GPU meshes and shaders. Token/anchor
lookups, the animation clock and settings use isolated fixtures; no world data
is modified.

- 137/137 browser checks passed: actual GLSL compilation and pixel output for
  both fields in normal and additive blending, animated energy, ancestor and
  zero opacity, disabled rays, degenerate geometry, changing hull topology,
  exact contour endpoints, transformed parents, token movement/rotation,
  renderer selection, remote release, missing GPU fallback, normal hit/miss
  completion, scene teardown and repeated preview cleanup. The tractor regression
  cases cover two full target rotations with fixed mesh topology and no repeated
  alpha-mask loads, overlap and invalid-size recovery, emitter movement, adaptive
  contact on the facing hull, and PIXI event-boundary hit testing of the token
  underneath the beam.
- Full-hull capture tests verify alpha-zero margins and interior holes stay
  clear, both wings and rear extremities receive light, the coating animates and
  fades, rotated/mirrored artwork stays aligned across different layer transforms,
  atlas UVs and texture replacements are followed, missing artwork recovers, and
  cleanup never destroys the borrowed token texture.
- Adaptive geometry tests verify 33 opaque hull contacts at six orientations,
  emitter-facing placement, and missing-art fallback. Movement checks allow the
  intentional contact easing to settle instead of expecting an instantaneous snap.
- Opening and midpoint previews visually reviewed for the shader ground cone,
  native ground fallback, blue tractor and violet tractor on a wider hull.
- Syntax checks passed for all changed production JavaScript and the gallery.
- Targeted whitespace validation passed.

To reproduce, run `node tests/serve-transporter-tests.cjs`, then open
`http://127.0.0.1:3188/tests/fan-browser.html` and click **Run checks**. Use
**Play**, **Hold midpoint** or **Inspect opening** to inspect the visuals.

Ground cone shading follows the existing Ground Phasers **Shader Beam (WebGL)**
mode. Experimental Native receives a feathered Graphics fallback. Cone sizing,
phaser type/era, target impacts and timing retain their existing settings.
The starship Area renderer is not changed by this pass.

Tractor shading is selected with **Tractor Beam Animation Renderer → Cinematic
Shader (WebGL)**. The VFX test panel also has a session preview selector. Existing
saved renderer preferences are preserved. Faction/per-ship colors, emitter
anchors, placement and ray controls remain in use. Shader mode analyzes cached
alpha data to find the largest connected thick hull region. A bounded set of 33
rays finds the first opaque surface facing the emitter, with a small inset. Its lock light covers the entire
visible ship using the live token texture's alpha, including wings and transparent
interior holes. Broader opaque regions receive stronger illumination. Only the
lock coating is masked; the incoming beam remains visible in the space leading
to the ship, avoiding a cutoff at transparent image margins.

The coating copies the token mesh's rendered quad and UVs (including anchor,
mirroring, rotation, trim and texture updates). It does not sample pixels on the
CPU or trace/rebuild hull contours. Contact geometry uses the module's existing
cached CPU alpha mask; broad-region analysis is cached per mask. Pose changes are
sampled at most once per 65 ms and contacts ease over roughly 70 ms. The mesh keeps
the same vertex count, settles without repeated uploads, and snaps large moves.
No invalid contact sample removes the live animation ticker. All tractor visuals
ignore pointer input, including descendants.

If the artwork is not ready, the lock uses the prior diffuse grab glow until its
texture becomes available. The shader falls back to native graphics with the same stable grab geometry when
unavailable. Native PIXI mode retains its hull contour, using the stable geometry
if the contour is invalid. Temporary overlap or invalid dimensions hide the
effect until valid coordinates return, without removing the live tractor lock.

Live multiplayer networking and individual world artwork have not been tested;
token-flag playback and remote release were exercised through their real hooks
with fixture documents.
