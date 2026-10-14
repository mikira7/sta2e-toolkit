# Interior image assets

Generated for sta2e-toolkit using the built-in imagegen tool. Furniture files retain transparent backgrounds. These original game assets draw on Star Trek production-design motifs; they are not extracted show artwork.

**Ship art as WebP, not PNG.** The files here were generated as PNG and converted to WebP in v1.26.2 (quality 90, alpha quality 100), which took the folder from 76 MB to 11 MB with alpha kept exact — the module had grown too large to update on The Forge. Convert any newly generated image before it is referenced, and leave the PNG out of the commit. `floor-room-carpet.png` is the one exception: the deck prefab library pins it by SHA-256 as its corridor finish. The prompts below are kept as they were written, so they still say PNG.

The generator can use these files or other Foundry image files chosen in its asset controls. Furniture faces the top or bottom along its local axis and is rotated by the room placement code. The carpet and plating textures repeat at map scale. All files are bundled locally and need no image service during use.

Additional generated assets and their prompts are recorded in [console variants](console-variants.md), [lounge furniture](lounge-furniture.md), [technical furniture](technical-furniture.md), the [pre-rendered room/corridor kit](room-kit.md), [individual assets derived from the room renders](room-derived-assets.md), and [hull-section corridor and window artwork](hull-section-assets.md). The complete library contains 37 PNGs. The ten TNG furnishing variants have a [visual catalog](room-derived-catalog.html), which can be opened locally (Foundry serves HTML assets as plain text); choose **Individual furniture assets** and select them in the matching image asset dropdowns after reloading Foundry. The three hull-section additions are used automatically, with overrides under corridor texture, doorway sills, and hull windows.

## starfleet-carpet.webp

Use case: stylized-concept. Asset type: reusable seamless floor texture for a top-down Foundry VTT Star Trek interior battlemap. ONE square, edge-to-edge Starfleet 24th-century dark warm gray-purple tightly woven carpet with subtle microscopic wear, even orthographic lighting, restrained contrast, tileable on all sides. No objects, rooms, lettering, perspective, borders, or watermark.

## console.webp

Use case: stylized-concept. Asset type: reusable transparent furniture sprite for a realistic top-down Star Trek Foundry VTT interior battlemap. ONE standalone futuristic starship workstation console. Horizontal wide footprint, about 2.3 meters wide by 0.8 meters deep. A gently curved brushed gunmetal and pale warm-gray cabinet with a recessed glossy black desktop displaying small amber, lavender and blue LCARS-inspired geometric touch panels. No readable text. Thin warm-white edge indicators. Camera is exactly straight overhead: see only the top, no front face, no perspective. Whole object centered, filling 90 percent of image width and 75 percent of image height. Transparent background. Realistic 3D rendered game asset with soft overhead ambient illumination, restrained fine material detail and very subtle contact shadow. True transparent alpha outside the object. No floor, no room, no backdrop, no border, no people, no logos, no watermark. Not isometric.

## chair.webp

Use case: stylized-concept. Asset type: reusable transparent furniture sprite for a realistic top-down Star Trek Foundry VTT interior battlemap. ONE standalone 24th-century Starfleet-style bridge chair, seen EXACTLY straight down from above, orthographic overhead, a square footprint. Gray-blue cushioned seat, warm-gray curved backrest at the TOP of the image and two slim side armrests with a few tiny amber controls. Fine leather grain and brushed-metal material realism. Seat faces the BOTTOM edge of image. Whole object centered filling 85 percent of image. Transparent background. Realistic 3D rendered game asset with soft overhead ambient illumination, restrained fine material detail and very subtle contact shadow. True transparent alpha outside the object. No floor, no room, no backdrop, no border, no people, no logos, no watermark. Not isometric.

## bed.webp

Use case: stylized-concept. Asset type: reusable image asset for realistic Star Trek Foundry VTT interior maps. ONE single futuristic crew cabin bed, true orthographic 90-degree straight-down overhead view. Narrow rectangular footprint about 1 by 2 meters, head at TOP image. Light gray pillow, fitted slate-blue duvet with subtle woven texture, thin pale-gray molded frame with a small inset amber status light on one corner. Whole bed centered, fills 90 percent of image height. Transparent alpha background. Photorealistic game asset rendering with soft overhead ambient lighting and fine restrained material detail. No people, lettering, watermark, logo, floor under furniture, or backdrop. Not isometric.

## table.webp

Use case: stylized-concept. Asset type: reusable image asset for realistic Star Trek Foundry VTT interior maps. ONE futuristic starship briefing table, true orthographic 90-degree straight-down overhead view. Horizontally elongated oval tabletop, about 2.4 by 1.2 meters, matte dark smoky glass center and broad brushed-silver rim, understated inset amber and blue touch controls at its two short ends. No chairs, no legs visible, no room. Centered, whole tabletop fills 90 percent of image width. Transparent alpha background. Photorealistic game asset rendering with soft overhead ambient lighting and fine restrained material detail. No people, lettering, watermark, logo, floor under furniture, or backdrop. Not isometric.

## metal.webp

Use case: stylized-concept. Asset type: reusable image asset for realistic Star Trek Foundry VTT interior maps. ONE square seamless texture of worn dark gunmetal starship deck plating. True orthographic scan, even neutral lighting. Four large square modular panels with narrow recessed seams, restrained anti-slip microtexture and small flush screws. Edge-to-edge floor material texture, tileable on all four sides, no perspective, no room, no furniture, no border, no text. Opaque image. Photorealistic game asset rendering with soft overhead ambient lighting and fine restrained material detail. No people, lettering, watermark, logo, floor under furniture, or backdrop. Not isometric.

## crate.webp

Use case: stylized-concept. Asset type: reusable image asset for realistic Star Trek Foundry VTT interior maps. ONE closed sci-fi cargo container, true orthographic 90-degree straight-down overhead view. Square footprint. Olive-gray titanium reinforced lid with chamfered corners, inset black rectangular panel, fine worn edges, small orange latches on opposing sides, subtle hardware. Only top visible, no front face, no perspective. Object centered filling 90 percent of image. Transparent alpha background. Photorealistic game asset rendering with soft overhead ambient lighting and fine restrained material detail. No people, lettering, watermark, logo, floor under furniture, or backdrop. Not isometric.
