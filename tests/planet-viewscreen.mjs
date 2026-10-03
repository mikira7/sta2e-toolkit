// Browser canvas integration tests. Requires Playwright and an installed Chrome.
// NODE_PATH may point to the bundled runtime's node_modules.
// Run: node tests/planet-viewscreen.mjs [optional screenshot directory]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = resolve(import.meta.dirname, "..");
const server = createServer(async (req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    return res.end('<html><head><link rel="stylesheet" href="/styles/star-system-sheet.css"></head><body style="background:#121824;color:#e0e8ff;font:14px sans-serif;margin:20px"></body></html>');
  }
  const path = resolve(root, `.${decodeURIComponent(req.url.split("?")[0])}`);
  if (!path.startsWith(root + sep) || ![".js", ".css"].includes(extname(path))) { res.writeHead(404); return res.end(); }
  try { res.setHeader("Content-Type", extname(path) === ".js" ? "text/javascript" : "text/css"); res.end(await readFile(path)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    let id = 0;
    window.uploads = []; window.notices = [];
    window.ActorSheet = class {};
    window.foundry = { utils: { randomID: () => `test${++id}`, deepClone: value => structuredClone(value) }, applications: {
      api: { ApplicationV2: class {}, HandlebarsApplicationMixin: cls => cls,
        DialogV2: { wait: options => new Promise(resolve => {
          const element = document.createElement("div"); element.style.width = "700px"; element.innerHTML = options.content;
          document.body.replaceChildren(element);
          window.dialog = { options, element, finish: async action => {
            const button = options.buttons.find(button => button.action === action);
            const result = button?.callback ? await button.callback(null, null, { element }) : action;
            options.close?.(); resolve(result);
          } };
          options.render?.(null, { element });
        }) },
      }, apps: { FilePicker: { implementation: { createDirectory: async () => {}, upload: async (_source, dir, file) => {
        if (window.failUpload) return {};
        const bitmap = await createImageBitmap(file);
        uploads.push({ path: `${dir}/${file.name}`, width: bitmap.width, height: bitmap.height }); bitmap.close();
        return { path: uploads.at(-1).path };
      } } } },
    } };
    window.game = { user: { isGM: true }, world: { id: "test" }, scenes: [], settings: { get: () => ({}) } };
    window.ui = { notifications: Object.fromEntries(["info", "warn", "error"].map(key => [key, message => notices.push(message)])) };
    window.view = await import("/scripts/planet-viewscreen.js");
    window.generator = await import("/scripts/planet-generator.js");
    window.sheet = await import("/scripts/star-system-sheet.js");
    window.bodies = [
      { id: "m", name: "Terrestrial", type: "Class-M", procedural: JSON.stringify(generator.normalizePlanetRecipe({ seed: "orbital-test", cities: 30 }, { type: "Class-M" })) },
      { id: "d", name: "Barren", type: "Class-D", procedural: JSON.stringify(generator.normalizePlanetRecipe({ seed: "orbital-test" }, { type: "Class-D" })) },
      { id: "j", name: "Ringed Gas Giant", type: "Class-J", procedural: JSON.stringify(generator.normalizePlanetRecipe({ seed: "orbital-test", rings: true }, { type: "Class-J" })) },
    ];
  });
  const basic = await page.evaluate(async () => {
    const a = view.normalizePlanetView('{"preset":"horizon","size":999,"phase":-10,"direction":999}');
    const body = bodies[0], before = JSON.stringify(body);
    const settings = view.normalizePlanetView({});
    const first = await view.renderPlanetView(body, settings, { preview: true });
    const second = await view.renderPlanetView(body, settings, { preview: true });
    const changed = await view.renderPlanetView(body, { ...settings, direction: 90 }, { preview: true });
    const equal = first.toDataURL() === second.toDataURL(), lightChanged = first.toDataURL() !== changed.toDataURL();
    const form = document.createElement("form");
    for (const [name, value] of Object.entries({ id: "m", viewscreenImage: "saved.webp", viewscreenComposition: JSON.stringify(settings) })) {
      const input = document.createElement("input"); input.name = `starSystem.worlds.0.${name}`; input.value = value; form.append(input);
    }
    const roundtrip = sheet.StarSystemActorSheet.prototype._dataFromForm.call({}, form).starSystem;
    return { a, equal, lightChanged, unchanged: before === JSON.stringify(body), roundtrip: roundtrip.worlds[0],
      stars: JSON.stringify(view.planetViewStars("m")) === JSON.stringify(view.planetViewStars("m")),
      starSpread: view.planetViewStars("m").filter(star => Math.abs(star.x - star.y) > .25).length,
      invalid: view.normalizePlanetView("bad JSON") };
  });
  assert(basic.equal && basic.lightChanged && basic.unchanged && basic.stars);
  assert(basic.starSpread > 200, "Star coordinates are distributed independently");
  assert.equal(basic.a.size, 500); assert.equal(basic.a.phase, 0); assert.equal(basic.a.direction, 360);
  assert.equal(basic.invalid.preset, "full");
  const nativeHorizon = await page.evaluate(async () => {
    const settings = view.normalizePlanetView({ preset: "horizon", background: "__black" });
    const actual = await view.renderPlanetView(bodies[0], settings, { preview: true });
    const recipe = generator.normalizePlanetRecipe(bodies[0].procedural, bodies[0]); recipe.phaseAngle = settings.phase;
    const rendered = await generator.renderPlanetPixelsAsync(recipe, 640, { view: "portrait", lightDirection: settings.direction,
      viewport: { width: 640, height: 360, radius: 360 * settings.size / 100 * .48, cx: 640 * settings.x / 100, cy: 360 * settings.y / 100 } });
    const texture = document.createElement("canvas"); texture.width = 640; texture.height = 360;
    texture.getContext("2d").putImageData(new ImageData(rendered.pixels, 640, 360), 0, 0);
    const expected = document.createElement("canvas"); expected.width = 640; expected.height = 360;
    const ctx = expected.getContext("2d"); ctx.fillStyle = "#02050c"; ctx.fillRect(0, 0, 640, 360); ctx.drawImage(texture, 0, 0);
    return actual.toDataURL() === expected.toDataURL();
  });
  assert(nativeHorizon, "Horizon compositions render at native viewport resolution instead of enlarging a whole-globe texture");
  assert.equal(basic.roundtrip.viewscreenImage, "saved.webp");
  assert.equal(JSON.parse(basic.roundtrip.viewscreenComposition).width, 1920);

  await page.evaluate(async () => {
    const grid = document.createElement("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:12px";
    document.body.replaceChildren(grid);
    for (const body of bodies) for (const preset of Object.keys(view.PLANET_VIEW_PRESETS)) {
      const cell = document.createElement("div"); cell.textContent = `${body.name} / ${view.PLANET_VIEW_PRESETS[preset].label}`;
      const canvas = await view.renderPlanetView(body, { preset }, { preview: true });
      canvas.style.width = "100%"; cell.append(canvas); grid.append(cell);
    }
  });
  if (process.argv[2]) {
    await mkdir(process.argv[2], { recursive: true });
    await page.screenshot({ path: resolve(process.argv[2], "planet-views.png"), fullPage: true });
    await page.evaluate(async () => {
      window.CONST = { GRID_TYPES: { GRIDLESS: 0 }, DRAWING_FILL_TYPES: { NONE: 0, SOLID: 1 } };
      game.release = { generation: 14 };
      window.Scene = { create: async data => ({ ...data, embedded: {}, async createEmbeddedDocuments(kind, docs) { this.embedded[kind] = docs; } }) };
      const scenes = await import("/scripts/star-system-scene.js");
      const texture = async body => {
        const pixels = await generator.renderPlanetPixelsAsync(JSON.parse(body.procedural), 384, { view: "scene" });
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 384;
        canvas.getContext("2d").putImageData(new ImageData(pixels.pixels, 384, 384), 0, 0);
        const image = new Image(); image.src = canvas.toDataURL(); await image.decode(); return image;
      };
      const planet = await texture(bodies[0]), moon = await texture(bodies[1]);
      const grid = document.createElement("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:12px";
      document.body.replaceChildren(grid);
      for (const mirror of [false, true]) for (const count of [0, 8, 50]) {
        const world = { ...bodies[0], sceneImage: planet.src, moonRecords: Array.from({ length: count }, (_, i) => ({ ...bodies[1], id: `moon${i}`, sceneImage: moon.src })) };
        const scene = await scenes.buildPlanetaryEncounterScene({ id: "system", name: "System" }, {}, world, "", { mirror });
        const cell = document.createElement("div"); cell.textContent = `${mirror ? "Right" : "Left"} planet / ${count} moons`;
        const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 600; canvas.style.width = "100%";
        const ctx = canvas.getContext("2d"); ctx.fillStyle = "#02050c"; ctx.fillRect(0, 0, 900, 600); ctx.scale(.15, .15);
        for (const tile of scene.embedded.Tile) ctx.drawImage(tile.flags["sta2e-toolkit"].systemBody.kind === "planet" ? planet : moon,
          tile.x - tile.width / 2, tile.y - tile.height / 2, tile.width, tile.height);
        cell.append(canvas); grid.append(cell);
      }
    });
    await page.screenshot({ path: resolve(process.argv[2], "planet-encounters.png"), fullPage: true });
  }
  const saved = await page.evaluate(async () => {
    const first = await view.savePlanetView(bodies[1], "system", {});
    const second = await view.savePlanetView(bodies[1], "system", { width: 3840 });
    const behavior = { type: "sta2e-toolkit.warpViewscreen", system: { images: [{ id: "old", src: "old.webp" }], activeImage: "old", imageSrc: "old.webp" }, update: async patch => {
      window.libraryPatch = patch; behavior.system.images = patch["system.images"];
    } };
    await view.addPlanetViewToLibrary(behavior, first.viewscreenImage, "Planet");
    await view.addPlanetViewToLibrary(behavior, first.viewscreenImage, "Planet");
    game.scenes = [{ id: "s", name: "Bridge", regions: [{ id: "r", name: "Main Screen", behaviors: [{ ...behavior, id: "b", name: "Screen" }] }] }];
    let missingTarget = false, failure = false;
    try { await view.addPlanetViewToLibrary(null, "image.webp", "Planet"); } catch { missingTarget = true; }
    window.failUpload = true;
    // Existing tiny image keeps the injected upload-failure test fast.
    const image = document.createElement("canvas"); image.width = image.height = 16;
    try { await view.savePlanetView({ id: "test", image: image.toDataURL() }, "system", { source: "existing" }); } catch { failure = true; }
    window.failUpload = false;
    return { first, second, uploads, patchKeys: Object.keys(libraryPatch), images: behavior.system.images,
      active: behavior.system.activeImage, targets: view.planetViewTargets().map(t => t.label), failure, missingTarget };
  });
  assert.notEqual(saved.first.viewscreenImage, saved.second.viewscreenImage);
  assert.deepEqual(saved.uploads.map(u => [u.width, u.height]), [[1920, 1080], [3840, 2160]]);
  assert.deepEqual(saved.patchKeys, ["system.images"]); assert.equal(saved.active, "old"); assert.equal(saved.images.length, 2);
  assert(saved.failure && saved.missingTarget); assert.deepEqual(saved.targets, ["Bridge / Main Screen / Screen"]);
  assert(await page.evaluate(() => [...document.querySelectorAll(".sta2e-planet-render-progress")].some(panel => panel.textContent.includes("Image generation failed"))), "Failed exports show a failure state");
  await page.waitForFunction(() => !document.getElementById("sta2e-planet-render-progress"));
  await page.evaluate(() => {
    const FP = foundry.applications.apps.FilePicker.implementation;
    window.originalUpload = FP.upload;
    FP.upload = async () => new Promise(resolve => { window.releaseProgressUpload = () => resolve({ path: "progress-test.webp" }); });
    const image = document.createElement("canvas"); image.width = image.height = 16;
    window.progressExport = view.savePlanetView({ id: "progress", name: "Progress test", image: image.toDataURL() }, "system", { source: "existing" });
  });
  await page.waitForFunction(() => document.querySelector(".sta2e-planet-render-progress progress")?.value === 95);
  assert(await page.evaluate(() => document.querySelector(".sta2e-planet-render-progress").textContent.includes("Uploading viewscreen image")), "Upload remains below 100% until it succeeds");
  if (process.argv[2]) await page.screenshot({ path: resolve(process.argv[2], "planet-progress.png") });
  await page.evaluate(async () => {
    window.releaseProgressUpload(); await window.progressExport;
    foundry.applications.apps.FilePicker.implementation.upload = window.originalUpload;
  });
  assert.equal(await page.locator(".sta2e-planet-render-progress progress").evaluate(bar => bar.value), 100, "Only saved artwork reaches 100%");
  await page.waitForFunction(() => !document.getElementById("sta2e-planet-render-progress"));

  await page.evaluate(() => { window.pending = view.promptPlanetView(bodies[0], "system"); });
  await page.waitForFunction(() => document.querySelector("[data-status]")?.textContent.startsWith("Preview"));
  await page.selectOption('[name="preset"]', "horizon");
  await page.selectOption('[name="preset"]', "close");
  await page.selectOption('[name="preset"]', "full");
  await page.waitForFunction(() => document.querySelector("[data-status]")?.textContent.startsWith("Preview"));
  assert.equal(await page.inputValue('[name="size"]'), "70");
  const previewMatches = await page.evaluate(async () => {
    const expected = await view.renderPlanetView(bodies[0], {}, { preview: true });
    return expected.toDataURL() === document.querySelector("[data-preview] canvas").toDataURL();
  });
  assert(previewMatches, "Obsolete previews never replace the latest framing");
  if (process.argv[2]) await page.screenshot({ path: resolve(process.argv[2], "planet-composer.png"), fullPage: true });
  const cancellation = await page.evaluate(async () => {
    const before = uploads.length;
    await dialog.finish("cancel");
    return { result: await pending, unchanged: before === uploads.length };
  });
  assert.equal(cancellation.result, null); assert(cancellation.unchanged);
  // Full sheet action: failed optional delivery still retains the saved image.
  await page.evaluate(() => {
    const image = document.createElement("canvas"); image.width = image.height = 16;
    window.actorData = { isStarSystem: true, designation: "System", worlds: [{ id: "integration", name: "Test Planet", type: "Class-M", image: image.toDataURL() }] };
    window.fakeSheet = { actor: { id: "system", name: "System", getFlag: () => structuredClone(actorData), setFlag: async (_module, _key, data) => { window.actorData = structuredClone(data); } }, render() {} };
    game.scenes[0].regions[0].behaviors[0].update = async () => { throw new Error("Injected library failure"); };
    window.actionPromise = sheet.StarSystemActorSheet.prototype._handleAction.call(fakeSheet, {
      preventDefault() {}, currentTarget: { dataset: { ssAction: "planet-viewscreen", index: "0" }, closest: () => null },
    });
  });
  await page.waitForFunction(() => document.querySelector('[name="source"]')?.value === "existing");
  assert(await page.isDisabled('[name="phase"]'));
  await page.selectOption('[name="target"]', "s/r/b");
  const integration = await page.evaluate(async () => {
    const before = actorData.worlds[0].image;
    await dialog.finish("save"); await actionPromise;
    return { world: actorData.worlds[0], preserved: actorData.worlds[0].image === before, notices, busy: fakeSheet._planetGenerationBusy };
  });
  assert(integration.world.viewscreenImage.endsWith(".webp"));
  assert.equal(JSON.parse(integration.world.viewscreenComposition).source, "existing");
  assert(integration.preserved); assert.equal(integration.busy, false);
  assert(integration.notices.some(message => message.includes("Image saved, but could not add")));
  assert.deepEqual(errors, []);
  console.log("PASS: planet view determinism, lighting, persistence, presets, real 1080p/4K WebP exports, upload failures, library isolation, stale previews, and cancellation.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
