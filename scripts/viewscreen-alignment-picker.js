import { regionBounds } from "./spawn-regions.js";
import { validScreenCorners, screenProjection } from "./viewscreen-alignment.js";
import { createIndicator, destroyIndicator, showOverlay, stroked, crosshair } from "./spawn-picker.js";

/** Local corner editor. Only the final accepted result is written to the document. */
export function pickImageCorners(region, saved) {
  const bounds = regionBounds(region);
  const view = canvas?.app?.canvas ?? canvas?.app?.view;
  if (!canvas?.ready || !view || !bounds?.width || !bounds?.height) {
    ui.notifications.warn("Open the viewscreen's scene before aligning its image.");
    return Promise.resolve(null);
  }
  const corners = (validScreenCorners(saved) ? saved : [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ]).map(p => ({ ...p }));
  const g = createIndicator();
  g.eventMode = "none";
  const overlay = showOverlay("ALIGN IMAGE", "Drag the four corner handles · Enter saves · Esc / right-click cancels");
  const stage = canvas.stage;
  const toWorld = p => ({ x: bounds.x + p.x * bounds.width, y: bounds.y + p.y * bounds.height });
  const point = ev => {
    const rect = view.getBoundingClientRect(), screen = canvas.app.renderer.screen;
    return stage.toLocal(new PIXI.Point((ev.clientX - rect.left) * screen.width / rect.width,
      (ev.clientY - rect.top) * screen.height / rect.height));
  };
  const redraw = () => {
    g.clear();
    const project = screenProjection(corners);
    stroked(g, { width: 2 / stage.scale.x, color: project ? 0x66bbff : 0xff6666, alpha: 0.95 }, gg => {
      const pts = corners.map(toWorld);
      gg.moveTo(pts[0].x, pts[0].y);
      for (const p of [...pts.slice(1), pts[0]]) gg.lineTo(p.x, p.y);
      for (const p of pts) crosshair(gg, p.x, p.y, 12 / stage.scale.x);
      if (project) for (let n = 1; n < 4; n++) {
        for (const [a, b] of [[project(n / 4, 0), project(n / 4, 1)],
          [project(0, n / 4), project(1, n / 4)]]) {
          const p = toWorld(a), q = toWorld(b);
          gg.moveTo(p.x, p.y); gg.lineTo(q.x, q.y);
        }
      }
    });
  };
  return new Promise(resolve => {
    let dragging = -1, done = false;
    const stop = ev => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    const finish = value => {
      if (done) return;
      done = true;
      for (const [name, fn] of listeners) window.removeEventListener(name, fn, true);
      Hooks.off("canvasTearDown", teardown);
      Hooks.off("deleteRegion", deleted);
      destroyIndicator(g);
      overlay.remove();
      resolve(value);
    };
    const teardown = () => finish(null);
    const deleted = doc => { if (doc.id === region.id) finish(null); };
    const down = ev => {
      if (ev.target !== view) return;
      stop(ev);
      if (ev.button === 2) return finish(null);
      if (ev.button !== 0) return;
      const p = point(ev), radius = 24 / stage.scale.x;
      let distance = radius;
      corners.forEach((c, i) => {
        const q = toWorld(c), d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < distance) { distance = d; dragging = i; }
      });
    };
    const move = ev => {
      if (dragging < 0) return;
      stop(ev);
      const p = point(ev);
      corners[dragging] = { x: (p.x - bounds.x) / bounds.width, y: (p.y - bounds.y) / bounds.height };
      redraw();
    };
    const up = ev => { if (dragging >= 0) { move(ev); dragging = -1; } };
    const key = ev => {
      if (ev.key !== "Escape" && ev.key !== "Enter") return;
      stop(ev);
      if (ev.key === "Escape") return finish(null);
      if (!validScreenCorners(corners)) {
        ui.notifications.warn("Keep the four corners in order without crossing or flattening the screen edges.");
        return;
      }
      finish(corners);
    };
    const context = ev => { if (ev.target === view) { stop(ev); finish(null); } };
    const cancelDrag = () => { dragging = -1; };
    const listeners = [["pointerdown", down], ["pointermove", move], ["pointerup", up],
      ["pointercancel", cancelDrag], ["keydown", key], ["contextmenu", context]];
    for (const [name, fn] of listeners) window.addEventListener(name, fn, true);
    Hooks.on("canvasTearDown", teardown);
    Hooks.on("deleteRegion", deleted);
    redraw();
  });
}
