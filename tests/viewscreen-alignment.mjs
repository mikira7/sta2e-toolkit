import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const source = await readFile(new URL("../scripts/viewscreen-alignment.js", import.meta.url), "utf8");
const { validScreenCorners, screenProjection, alignedImageGeometry } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const quad = [{ x: .1, y: .1 }, { x: .9, y: .3 }, { x: .8, y: .7 }, { x: .2, y: .9 }];
assert(validScreenCorners(quad));
for (const invalid of [null, [], [...square.slice(0, 3), square[0]],
  [square[0], square[2], square[1], square[3]],
  [square[0], square[1], { x: .2, y: .2 }, square[3]],
  [{ x: NaN, y: 0 }, ...square.slice(1)]]) assert(!validScreenCorners(invalid));
const near = (a, b) => assert(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
for (const points of [square, quad, square.map(p => ({ x: 1 - p.y, y: p.x }))]) {
  const project = screenProjection(points);
  square.forEach((p, i) => { const q = project(p.x, p.y); near(q.x, points[i].x); near(q.y, points[i].y); });
  // Projective maps keep straight lines straight, even away from corners.
  const a = project(0, .4), b = project(1, .4), c = project(.37, .4);
  near((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x), 0);
}
const bounds = { x: 100, y: 200, width: 800, height: 400 };
const cfg = { imageFit: "stretch", imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 };
const geo = alignedImageGeometry(quad, bounds, 400, 400, cfg);
assert([...geo.vertices, ...geo.uvs].every(Number.isFinite));
near(geo.vertices[0], 180); near(geo.vertices[1], 240);
assert(Math.max(...geo.indices) < geo.vertices.length / 2);
for (const fit of ["stretch", "cover", "contain", "native"]) {
  const g = alignedImageGeometry(square, bounds, 400, 400, { ...cfg, imageFit: fit });
  assert([...g.uvs].every(v => v >= 0 && v <= 1));
  if (fit === "contain" || fit === "native") near(g.vertices[0], 300);
  if (fit === "cover") near(g.uvs[1], .25);
}
assert.equal(alignedImageGeometry(square, bounds, 400, 400,
  { ...cfg, imageScale: .1, imageOffsetX: 1 }), null);
const moved = alignedImageGeometry(quad, { ...bounds, x: 350, width: 1600 }, 400, 400, cfg);
near(moved.vertices[0], 510);
console.log("Perspective geometry, invalid corners, crop/contain/native, offsets and region resizing passed.");

// Optional browser integration: node tests/viewscreen-alignment.mjs <pixi.js bundle>
if (process.argv[2]) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.addScriptTag({ path: process.argv[2] });
    const renderer = await readFile(new URL("../scripts/warp-viewscreen-vfx.js", import.meta.url), "utf8");
    const picker = await readFile(new URL("../scripts/viewscreen-alignment-picker.js", import.meta.url), "utf8");
    const result = await page.evaluate(async ({ source, renderer, picker }) => {
      const { alignedImageGeometry, validScreenCorners, screenProjection } = await import(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
      const app = new PIXI.Application({ width: 1000, height: 700, backgroundColor: 0x181818 });
      document.body.appendChild(app.view);
      const image = document.createElement("canvas"); image.width = 400; image.height = 400;
      const ctx = image.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, 400, 400);
      ctx.strokeStyle = "#3366ff"; ctx.lineWidth = 3;
      for (let n = 0; n <= 400; n += 40) { ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n, 400); ctx.moveTo(0, n); ctx.lineTo(400, n); ctx.stroke(); }
      const tex = PIXI.Texture.from(image);
      const releaseBody = renderer.slice(renderer.indexOf("function _releaseImage("), renderer.indexOf("/**\n * Turn the *animated*"));
      const release = new Function(`${releaseBody}; return _releaseImage;`)();
      const syncBody = renderer.slice(renderer.indexOf("async function _syncImageAsync("), renderer.indexOf("/**\n * Drop the current image sprite."));
      const sync = new Function("_loadImageTexture", "_releaseImage", "_isVideoPath", "_readConfig", "alignedImageGeometry", "_passThrough",
        `${syncBody}; return _syncImageAsync;`)(async () => tex, release, () => false, b => b.system, alignedImageGeometry, () => {});
      const cfg = { imageSrc: "grid", imageCorners: [{ x: .1, y: .1 }, { x: .9, y: .3 }, { x: .8, y: .7 }, { x: .2, y: .9 }], imageFit: "stretch", imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, imageAlpha: 1, imageAbove: false };
      const inst = { behavior: { system: cfg }, imgBelow: new PIXI.Container(), imgAbove: new PIXI.Container(), frame: { bounds: { x: 100, y: 100, width: 800, height: 500 } } };
      app.stage.addChild(inst.imgBelow, inst.imgAbove);
      await sync(inst, cfg); app.renderer.render(app.stage);
      if (!inst.imgMesh || inst.imgSprite.visible) throw Error("Alignment did not activate");
      const pixels = app.renderer.extract.pixels(app.stage);
      if (!pixels.some((value, i) => i % 4 === 0 && value > 200)) throw Error("Mesh rendered no image pixels");
      const mesh = inst.imgMesh;
      await sync(inst, cfg);
      if (inst.imgMesh !== mesh) throw Error("Unchanged alignment rebuilt the mesh");
      cfg.imageAbove = true; cfg.imageAlpha = .6;
      await sync(inst, cfg);
      if (mesh.parent !== inst.imgAbove || mesh.alpha !== .6) throw Error("Layer/opacity failed");
      cfg.imageSrc = "second-grid"; await sync(inst, cfg);
      if (!inst.imgMesh || inst.imgMesh === mesh || tex.baseTexture.destroyed) throw Error("Image switch lost alignment or destroyed shared texture");
      cfg.imageCorners = null; await sync(inst, cfg);
      if (inst.imgMesh || !inst.imgSprite.visible) throw Error("Reset failed");
      cfg.imageCorners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
      await sync(inst, cfg); release(inst);
      if (inst.imgMesh || inst.imgSprite || tex.baseTexture.destroyed) throw Error("Cleanup/texture ownership failed");

      const hookMap = new Map();
      window.Hooks = {
        on: (name, fn) => hookMap.set(name, fn), off: name => hookMap.delete(name),
      };
      window.canvas = { ready: true, app, stage: app.stage };
      let warnings = 0, overlays = 0;
      window.ui = { notifications: { warn: () => warnings++ } };
      const pick = new Function("regionBounds", "validScreenCorners", "screenProjection", "createIndicator", "destroyIndicator", "showOverlay", "stroked", "crosshair",
        picker.replace(/^import .*;\r?\n/gm, "").replace("export function", "function") + "; return pickImageCorners;")(
        () => inst.frame.bounds, validScreenCorners, screenProjection,
        () => app.stage.addChild(new PIXI.Graphics()), g => g.destroy(),
        () => { overlays++; return { remove: () => overlays-- }; },
        (g, style, draw) => { g.lineStyle(style.width, style.color, style.alpha); draw(g); },
        (g, x, y, r) => { g.moveTo(x - r, y); g.lineTo(x + r, y); });
      app.stage.scale.set(.8); app.stage.position.set(40, 20);
      const pointer = (type, x, y) => {
        const p = app.stage.toGlobal(new PIXI.Point(x, y)), rect = app.view.getBoundingClientRect();
        app.view.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
          clientX: rect.left + p.x, clientY: rect.top + p.y, button: 0 }));
      };
      const key = value => window.dispatchEvent(new KeyboardEvent("keydown", { key: value, cancelable: true }));
      let pending = pick({ id: "region" }, []);
      pointer("pointerdown", 100, 100); pointer("pointermove", 180, 150); pointer("pointerup", 180, 150);
      key("Enter");
      const saved = await pending;
      if (Math.abs(saved[0].x - .1) > 1e-5 || Math.abs(saved[0].y - .1) > 1e-5) throw Error("Zoomed/panned corner drag failed");
      pending = pick({ id: "region" }, saved); key("Escape");
      if (await pending !== null) throw Error("Escape committed alignment");
      pending = pick({ id: "region" }, []);
      pointer("pointerdown", 100, 100); pointer("pointermove", 900, 600); pointer("pointerup", 900, 600);
      key("Enter");
      if (!warnings || !overlays) throw Error("Invalid quadrilateral accepted");
      hookMap.get("canvasTearDown")();
      if (await pending !== null || overlays || hookMap.size) throw Error("Scene teardown failed to clean up picker");
      app.destroy(true); tex.destroy(true);
      return "PIXI render, mesh reuse, opacity/layers, image switching, reset, texture ownership, zoomed corner dragging, invalid corners, cancellation and scene teardown passed.";
    }, { source, renderer: renderer.replaceAll("\r\n", "\n"), picker });
    console.log(result);
  } finally { await browser.close(); }
}
