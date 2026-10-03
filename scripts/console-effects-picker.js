import { getConsoleLocations } from "./console-effects.js";

let markers = null, cancelPick = null;

export function clearConsoleMarkers() {
  if (!markers) return;
  markers.parent?.removeChild(markers);
  if (!markers.destroyed) markers.destroy({ children: true });
  markers = null;
}

function ring(g, x, y, radius) {
  if (g.lineStyle) {
    g.lineStyle(2, 0x66ccff, 0.85).drawCircle(x, y, radius);
    g.moveTo(x - 8, y); g.lineTo(x + 8, y); g.moveTo(x, y - 8); g.lineTo(x, y + 8);
    g.lineStyle(0);
  } else {
    g.circle(x, y, radius).stroke({ width: 2, color: 0x66ccff, alpha: 0.85 });
    g.moveTo(x - 8, y); g.lineTo(x + 8, y); g.moveTo(x, y - 8); g.lineTo(x, y + 8);
    g.stroke({ width: 2, color: 0x66ccff, alpha: 0.85 });
  }
}

export function showConsoleMarkers(show) {
  clearConsoleMarkers();
  if (!show || !game.user?.isGM || !canvas?.ready || !globalThis.PIXI) return;
  markers = new PIXI.Container(); markers.eventMode = "none"; markers.zIndex = 950002;
  const graphics = new PIXI.Graphics(); markers.addChild(graphics);
  getConsoleLocations().forEach((p, index) => {
    ring(graphics, p.x, p.y, p.size * 0.5);
    const style = { fontFamily: "Arial", fontSize: 13, fill: 0xcceeff, stroke: 0x000000, strokeThickness: 3 };
    const text = Number.parseInt(PIXI.VERSION) >= 8
      ? new PIXI.Text({ text: `${index + 1}. ${p.label}`, style })
      : new PIXI.Text(`${index + 1}. ${p.label}`, style);
    text.position.set(p.x + 10, p.y + 10); markers.addChild(text);
  });
  const layer = canvas.interface ?? canvas.tokens;
  layer.sortableChildren = true; layer.addChild(markers);
}

export function cancelConsolePick() { cancelPick?.(); }

/** Capture the canvas click before token selection or a drawing tool receives it. */
export function pickConsolePosition({ label = "console" } = {}) {
  if (!game.user?.isGM || !canvas?.ready || !canvas.scene) return Promise.resolve(null);
  cancelConsolePick();
  const surface = canvas.app?.canvas ?? canvas.app?.view;
  const layer = canvas.interface ?? canvas.tokens, stage = canvas.stage, sceneId = canvas.scene.id;
  if (!surface || !layer || !stage) return Promise.resolve(null);
  const indicator = new PIXI.Graphics(); indicator.eventMode = "none"; indicator.zIndex = 950003;
  layer.addChild(indicator);
  const cursor = surface.style.cursor;
  surface.style.cursor = "crosshair";
  ui.notifications.info(`Click the ${label} on the canvas. Escape or right-click cancels.`);
  return new Promise(resolve => {
    let done = false;
    const pointAt = event => {
      const rect = surface.getBoundingClientRect();
      const screen = canvas.app.renderer.screen;
      return stage.worldTransform.applyInverse({
        x: (event.clientX - rect.left) * screen.width / rect.width,
        y: (event.clientY - rect.top) * screen.height / rect.height,
      });
    };
    const finish = point => {
      if (done) return;
      done = true;
      document.removeEventListener("pointerdown", click, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("contextmenu", contextMenu, true);
      Hooks.off("canvasTearDown", teardown);
      surface.style.cursor = cursor;
      indicator.parent?.removeChild(indicator);
      if (!indicator.destroyed) indicator.destroy();
      cancelPick = null;
      resolve(point);
    };
    const move = event => {
      if (event.target !== surface || canvas.scene?.id !== sceneId) return;
      const p = pointAt(event); indicator.clear(); ring(indicator, p.x, p.y, 20);
    };
    const click = event => {
      if (event.target !== surface) return;
      event.preventDefault(); event.stopImmediatePropagation();
      // Wait for contextmenu to cancel so it too is consumed before Foundry.
      if (event.button === 2) return;
      if (event.button !== 0) return;
      if (!canvas.ready || canvas.scene?.id !== sceneId) { finish(null); return; }
      const p = pointAt(event), rect = canvas.dimensions?.sceneRect;
      if (rect && !rect.contains(p.x, p.y)) { ui.notifications.warn("Choose a location inside the scene."); return; }
      finish({ x: p.x, y: p.y });
    };
    const key = event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); finish(null);
    };
    const contextMenu = event => {
      if (event.target !== surface) return;
      event.preventDefault(); event.stopImmediatePropagation(); finish(null);
    };
    const teardown = Hooks.on("canvasTearDown", () => finish(null));
    cancelPick = () => finish(null);
    document.addEventListener("pointerdown", click, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("contextmenu", contextMenu, true);
  });
}
