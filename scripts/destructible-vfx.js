/** Transient, client-local breakup effects; documents already contain their final positions. */
import { seededRandom } from "./destructible-geometry.js";
const seen = new Set(), cleanups = new Set();
let hooked = false;
function circle(g, x, y, radius, color, alpha) {
  if (typeof g.beginFill === "function") { g.beginFill(color, alpha); g.drawCircle(x, y, radius); g.endFill(); }
  else g.circle(x, y, radius).fill({ color, alpha });
}
export async function playDestructibleVfx(event) {
  if (!canvas?.ready || canvas.scene?.id !== event.sceneId || !globalThis.PIXI || seen.has(event.operationId)) return;
  if (event.hidden && !game.user.isGM) return;
  seen.add(event.operationId); if (seen.size > 256) seen.delete(seen.values().next().value);
  if (!hooked) { hooked = true; Hooks.on("canvasTearDown", () => { for (const stop of [...cleanups]) stop(); seen.clear(); }); }
  const sceneId = canvas.scene.id;
  // Wait briefly for embedded document rendering on remote clients. Do not replay on scene entry.
  const fragments = event.fragments ?? [];
  const textures = await Promise.all(fragments.map(async f => {
    try { return await (globalThis.loadTexture ? loadTexture(f.src) : PIXI.Assets.load(f.src)); } catch { return null; }
  }));
  if (canvas.scene?.id !== sceneId || !canvas.ready) return;
  const layer = canvas.tokens ?? canvas.interface, container = new PIXI.Container(), graphics = new PIXI.Graphics();
  container.zIndex = 1000000; container.eventMode = "none"; layer.sortableChildren = true; layer.addChild(container); container.addChild(graphics);
  const sprites = [], hidden = new Map(), random = seededRandom(event.operationId);
  let frame, stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true; cancelAnimationFrame(frame); cleanups.delete(stop);
    for (const [mesh, visible] of hidden) if (!mesh.destroyed) mesh.visible = visible;
    if (!container.destroyed) container.destroy({ children: true });
  };
  cleanups.add(stop);
  try {
    fragments.forEach((f, i) => {
      if (!textures[i] || (f.hidden && !game.user.isGM)) return;
      const sprite = new PIXI.Sprite(textures[i]); sprite.anchor.set(.5);
      sprite.width = f.width * Math.abs(f.scaleX); sprite.height = f.height * Math.abs(f.scaleY);
      sprite.scale.x *= Math.sign(f.scaleX || 1); sprite.scale.y *= Math.sign(f.scaleY || 1); sprite.alpha = f.alpha ?? 1;
      container.addChild(sprite); sprites.push({ sprite, f });
    });
    const particles = Array.from({ length: 24 }, () => ({ angle: random() * Math.PI * 2, speed: 15 + random() * 70, size: 1 + random() * 5 }));
    const start = performance.now(), duration = Math.max(200, Math.min(3000, event.duration || 850));
    const color = /^#[0-9a-f]{6}$/i.test(event.color) ? parseInt(event.color.slice(1), 16) : 0xa49a86;
    const tick = now => {
      if (stopped) return;
      if (canvas.scene?.id !== sceneId || container.destroyed) { stop(); return; }
      try {
        const t = Math.min(1, (now - start) / duration), ease = 1 - (1 - t) ** 3;
        graphics.clear();
        circle(graphics, event.center.x, event.center.y, 8 + t * 38, 0xffe5b0, Math.max(0, 1 - t * 4) * .8);
        for (const p of particles) {
          const d = p.speed * ease * (event.preset === "asteroid" ? 1 : .5);
          circle(graphics, event.center.x + Math.cos(p.angle) * d, event.center.y + Math.sin(p.angle) * d, p.size * (event.preset === "asteroid" ? 1 : 1 + t * 2), color, (1 - t) * .65);
        }
        for (const { sprite, f } of sprites) {
          const mesh = canvas.tokens.get(f.tokenId)?.mesh;
          if (mesh && !mesh.destroyed) { if (!hidden.has(mesh)) hidden.set(mesh, mesh.visible); mesh.visible = false; }
          sprite.position.set(f.x - f.dx * (1 - ease), f.y - f.dy * (1 - ease));
          sprite.rotation = (f.startRotation + (f.rotation - f.startRotation) * ease) * Math.PI / 180;
        }
        if (t >= 1) stop(); else frame = requestAnimationFrame(tick);
      } catch (err) { stop(); console.warn("STA2e Toolkit | Breakup animation stopped:", err); }
    };
    frame = requestAnimationFrame(tick);
  } catch (err) { stop(); throw err; }
}
