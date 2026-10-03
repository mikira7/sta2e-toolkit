/** Weapon silhouettes and physical slashes at person scale, replayed per client. */
import { nativeVfxContainer, playNativeVfxSound } from "./native-weapon-vfx.js";

export const GROUND_MELEE_VFX_ACTION = "groundMeleeVfx";
const active = new Set();
const nextMeleeMode = new Map();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const point = p => Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null;
function center(token) {
  if (point(token?.center)) return point(token.center);
  const d = token?.document ?? token, grid = globalThis.canvas?.grid?.size ?? 100;
  return point({ x: d?.x + (token?.w ?? (d?.width ?? 1) * grid) / 2,
    y: d?.y + (token?.h ?? (d?.height ?? 1) * grid) / 2 });
}

export async function fireGroundMeleeVFX(config, isHit, token, targets) {
  if (!["batleth", "ushaan", "lirpa", "nerve-pinch"].includes(config?.subtype) || config.useClassicMelee
    || !globalThis.PIXI || !globalThis.canvas?.ready) return false;
  const source = center(token), ends = Array.from(targets ?? []).map(center).filter(Boolean).slice(0, 64);
  if (!source || !ends.length) return false;
  const attackKey = ["lirpa", "batleth"].includes(config.subtype)
    ? `${token?.document?.uuid ?? token?.id ?? `${source.x},${source.y}`}:${config.name ?? config.subtype}` : null;
  const grid = canvas.grid?.size ?? 100, doc = token?.document ?? token;
  const sourceRadius = Math.max(token?.w ?? (doc?.width ?? 1) * grid,
    token?.h ?? (doc?.height ?? 1) * grid) / 2;
  const msg = { action: GROUND_MELEE_VFX_ACTION, sceneId: token?.document?.parent?.id ?? canvas.scene?.id,
    sourcePoint: source, targetPoints: ends, subtype: config.subtype, hit: !!isHit,
    grid, sourceRadius, attackKey,
    attackMode: attackKey ? nextMeleeMode.get(attackKey) ?? (config.subtype === "lirpa" ? "thrust" : "swipe") : "swipe" };
  const playback = playGroundMeleeVfxFromSocket(msg);
  if (!playback) return false;
  playNativeVfxSound(isHit ? config.sound : config.missSound ?? config.sound);
  try { game.socket?.emit?.("module.sta2e-toolkit", msg); }
  catch (err) { console.warn("STA2e Toolkit | Melee broadcast failed:", err); }
  await playback;
  return true;
}

function polygon(g, points, color, alpha = 1) {
  if (g.beginFill) g.beginFill(color, alpha).drawPolygon(points).endFill();
  else g.poly(points).fill({ color, alpha });
}
function line(g, points, width, color, alpha = 1) {
  if (g.lineStyle) g.lineStyle(width, color, alpha);
  points.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
  if (!g.lineStyle) g.stroke({ width, color, alpha });
}

// Sample cubic contours so the same silhouette works in PIXI 7 and 8.
// Coordinates follow the supplied reference before turning the edge to +X.
function batlethContour(start, curves, transform = (x, y) => [(y - 450) * .14, (x - 502) * .14]) {
  const points = [start];
  let from = start;
  for (const [cx1, cy1, cx2, cy2, x, y] of curves) {
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      points.push([u*u*u*from[0] + 3*u*u*t*cx1 + 3*u*t*t*cx2 + t*t*t*x,
        u*u*u*from[1] + 3*u*u*t*cy1 + 3*u*t*t*cy2 + t*t*t*y]);
    }
    from = [x, y];
  }
  return points.flatMap(([x, y]) => transform(x, y));
}

function drawBatleth(g) {
  const body = batlethContour([78,636], [
    [108,510, 287,386, 502,386], [718,386, 892,501, 925,630],
    [884,568, 810,489, 776,507], [747,512, 745,527, 757,614],
    [742,580, 730,523, 698,516], [633,487, 370,487, 304,520],
    [274,535, 258,582, 250,616], [240,568, 246,539, 257,526],
    [266,509, 232,494, 213,511], [163,538, 111,585, 78,636],
  ]);
  const holes = [
    batlethContour([282,451], [[321,435, 359,425, 389,427], [411,432, 416,461, 393,472],
      [360,483, 321,496, 296,498], [272,499, 261,478, 271,461], [274,456, 278,453, 282,451]]),
    batlethContour([460,422], [[482,420, 523,420, 547,422], [577,423, 580,468, 550,469],
      [524,470, 483,470, 457,469], [429,468, 432,424, 460,422]]),
    batlethContour([616,430], [[644,433, 699,451, 724,465], [745,476, 738,499, 714,497],
      [681,494, 644,482, 615,470], [590,460, 595,427, 616,430]]),
  ];
  if (g.beginFill) {
    g.beginFill(0xaebbc7).drawPolygon(body);
    for (const hole of holes) g.beginHole().drawPolygon(hole).endHole();
    g.endFill();
  } else {
    g.poly(body).fill({ color: 0xaebbc7 });
    for (const hole of holes) g.poly(hole).cut();
  }
  const asPoints = a => Array.from({ length: a.length / 2 }, (_, i) => ({ x: a[i*2], y: a[i*2+1] }));
  line(g, asPoints(body), .6, 0x586775);
  // Bright sharpened inner edge, with a broad darker bevel behind it.
  const bevel = batlethContour([919,620], [[877,558, 810,484, 776,502],
    [740,508, 740,530, 752,601], [735,554, 724,518, 698,511],
    [628,482, 371,482, 302,515], [270,530, 258,575, 252,598],
    [246,560, 250,536, 261,527], [270,505, 234,488, 211,507], [163,534, 111,582, 83,627]]);
  line(g, asPoints(bevel), 1.4, 0x758794);
  line(g, asPoints(bevel), .45, 0xf1f5f8);
  for (const hole of holes) line(g, asPoints(hole), .4, 0xe0e7eb);
  // Wrapped grips follow the back arch above each real, transparent handhold.
  const grips = [
    [[261,442], [[304,421, 348,409, 386,400], [387,409, 389,419, 391,429],
      [349,436, 309,450, 274,467], [269,459, 265,449, 261,442]]],
    [[446,390], [[479,386, 524,385, 559,390], [558,400, 557,411, 556,422],
      [520,419, 481,419, 449,422], [448,411, 447,399, 446,390]]],
    [[619,401], [[661,410, 710,425, 747,444], [742,453, 738,463, 734,469],
      [696,451, 654,435, 615,429], [616,418, 618,408, 619,401]]],
  ];
  for (const [start, curves] of grips) polygon(g, batlethContour(start, curves), 0x514741);
  for (const [a,b,c,d] of [[266,442,386,403],[448,391,557,392],[619,404,742,445]]) {
    for (let i = 1; i < 17; i++) {
      const t = i / 17, x = a + (c-a)*t, y = b + (d-b)*t;
      const pts = batlethContour([x,y], [[x+1,y+8,x+3,y+19,x+4,y+29]]);
      line(g, asPoints(pts), .35, 0x938277, .7);
    }
  }
}

function drawUshaanTor(g) {
  // Reference silhouette: scalloped arch, swept side tips and an enclosed
  // handhold. The cutting arch faces +X, opposite the lower palm grip.
  const contour = (start, curves) => batlethContour(start, curves,
    (x, y) => [(170 - y) * .15, (x - 288) * .15]);
  const asPoints = a => Array.from({ length: a.length / 2 }, (_, i) => ({ x: a[i*2], y: a[i*2+1] }));
  const body = contour([27,143], [
    [54,145, 93,139, 103,127], [118,131, 124,123, 132,116],
    [148,120, 157,109, 160,103], [176,106, 185,92, 189,86],
    [205,88, 212,76, 216,69], [232,72, 241,59, 247,54],
    [262,57, 274,47, 279,42], [294,48, 305,43, 313,37],
    [325,47, 337,47, 348,39], [358,49, 370,49, 380,43],
    [389,54, 401,56, 409,51], [411,65, 420,72, 433,70],
    [436,83, 446,92, 458,93], [457,104, 466,112, 476,114],
    [478,125, 487,136, 497,135], [502,148, 514,156, 527,154],
    [533,159, 541,164, 551,164], [510,180, 471,171, 444,171],
    [418,168, 413,187, 402,213], [400,235, 371,233, 344,230],
    [311,225, 273,231, 248,227], [216,225, 204,193, 188,173],
    [177,149, 149,155, 125,161], [83,169, 47,158, 27,143],
  ]);
  const hole = contour([223,161], [
    [234,127, 283,120, 320,126], [343,127, 367,133, 379,137],
    [397,147, 400,174, 381,185], [365,197, 348,183, 325,185],
    [298,186, 276,199, 252,191], [235,185, 218,176, 223,161],
  ]);
  if (g.beginFill) {
    g.beginFill(0xc8cec9).drawPolygon(body);
    g.beginHole().drawPolygon(hole).endHole(); g.endFill();
  } else {
    g.poly(body).fill({ color: 0xc8cec9 }); g.poly(hole).cut();
  }
  line(g, asPoints(body), .5, 0x687670);
  line(g, asPoints(hole), .65, 0x8a9892);
  // Shallow bevel beneath the scallops; subtle highlights on the inner rim.
  const bevel = contour([37,145], [[102,159, 177,108, 247,65],
    [298,46, 343,45, 383,58], [441,86, 476,153, 537,164]]);
  line(g, asPoints(bevel), 1.8, 0xd9dfd8);
  line(g, asPoints(bevel), .45, 0xf2f3e8);
  const inner = contour([225,158], [[241,124, 284,122, 320,128],
    [345,129, 367,136, 378,139]]);
  line(g, asPoints(inner), .45, 0xf4f6ee);
  const grip = contour([215,206], [[227,196, 234,187, 246,188],
    [273,203, 304,184, 332,186], [357,182, 382,192, 391,191],
    [395,199, 399,205, 402,213], [400,233, 371,232, 344,229],
    [309,224, 274,232, 248,226], [232,226, 223,219, 215,206]]);
  polygon(g, grip, 0x302f29);
  const gripHighlight = contour([221,208], [[250,220, 282,213, 310,210],
    [344,202, 374,220, 396,212]]);
  line(g, asPoints(gripHighlight), 1.2, 0x555449);
  for (const [x, y, endX, endY] of [[233,198,245,220],[384,198,379,221]]) {
    line(g, asPoints(contour([x,y], [[x-2,y+8,endX-2,endY-6,endX,endY]])), .8, 0x797b6b);
    line(g, asPoints(contour([x+4,y], [[x+2,y+8,endX+2,endY-6,endX+4,endY]])), .25, 0xc3c8b8);
  }
}

// Local +X is the striking edge. Dark grips and inset bevels keep the metal
// readable over both bright and dark maps without an energy-weapon glow.
function drawLirpa(g) {
  // Shaft along X: a spear tip at -X and a broad crescent blade at +X.
  polygon(g, [-65,-2.5, 57,-2.5, 57,2.5, -65,2.5], 0x865a24);
  polygon(g, [-62,-3, -54,-3, -54,3, -62,3], 0x743923);
  polygon(g, [32,-3, 56,-3, 56,3, 32,3], 0x743923);
  line(g, [{x:-53,y:-1},{x:31,y:-1}], .6, 0xc19957);
  for (const x of [-62,-54,32,55]) line(g, [{x,y:-3},{x,y:3}], .7, 0xc6c8bf);
  polygon(g, [-85,0, -73,-6, -63,-3, -63,3, -73,6], 0xcbd0c7);
  polygon(g, [-85,0, -73,-6, -63,-3, -69,0], 0xf0f1df);
  line(g, [{x:-84,y:0},{x:-63,y:0}], .65, 0x7a827b);
  line(g, [{x:-64,y:0},{x:-55,y:0}], 4, 0x8d968e);
  line(g, [{x:54,y:0},{x:65,y:0}], 4, 0x8d968e);
  const blade = batlethContour([57,-24], [[91,-24, 94,24, 57,24],
    [55,14, 48,6, 44,0], [53,-7, 58,-17, 57,-24]], (x,y) => [x,y]);
  const hole = Array.from({length: 33}, (_,i) => [68+4.5*Math.cos(i/32*Math.PI*2),4.5*Math.sin(i/32*Math.PI*2)]).flat();
  if (g.beginFill) {
    g.beginFill(0xcbd0c7).drawPolygon(blade);
    g.beginHole().drawPolygon(hole).endHole(); g.endFill();
  } else {
    g.poly(blade).fill({color:0xcbd0c7}); g.poly(hole).cut();
  }
  const points = a => Array.from({length:a.length/2},(_,i) => ({x:a[i*2],y:a[i*2+1]}));
  line(g, points(blade), .55, 0x747e77);
  const edge = batlethContour([58,-22], [[88,-22, 91,22, 58,22]], (x,y) => [x,y]);
  line(g, points(edge), 2.2, 0xa2ada5);
  line(g, points(edge), .65, 0xf4f5e8);
  line(g, points(hole), .45, 0x777f78);
}

function weaponShape(g, subtype) {
  if (subtype === "batleth") {
    drawBatleth(g);
  } else if (subtype === "lirpa") {
    drawLirpa(g);
  } else {
    drawUshaanTor(g);
  }
}

export function playGroundMeleeVfxFromSocket(msg = {}) {
  if (!globalThis.PIXI || !globalThis.canvas?.ready || !canvas.app?.ticker
    || msg.sceneId !== canvas.scene?.id || !["batleth", "ushaan", "lirpa", "nerve-pinch"].includes(msg.subtype)) return false;
  const source = point(msg.sourcePoint);
  const ends = Array.isArray(msg.targetPoints) ? msg.targetPoints.slice(0, 64).map(point).filter(Boolean) : [];
  if (!source || !ends.length) return false;
  const grid = Number.isFinite(msg.grid) ? clamp(msg.grid, 10, 1000) : 100;
  const sourceRadius = Number.isFinite(msg.sourceRadius) ? clamp(msg.sourceRadius, grid*.1, grid*10) : grid*.5;
  if (["lirpa", "batleth"].includes(msg.subtype) && typeof msg.attackKey === "string") {
    if (nextMeleeMode.size >= 256 && !nextMeleeMode.has(msg.attackKey)) nextMeleeMode.delete(nextMeleeMode.keys().next().value);
    nextMeleeMode.set(msg.attackKey, msg.attackMode === "thrust" ? "swipe" : "thrust");
  }
  if (msg.subtype === "nerve-pinch") {
    return Promise.all(ends.map(end => drawNervePinch(source, end, grid, msg.hit === true)));
  }
  return Promise.all(ends.map(end => drawSwing(source, end, grid, msg.subtype, msg.hit === true,
    msg.attackMode === "thrust" ? "thrust" : "swipe", sourceRadius)));
}

/** An open five-fingered hand curls around the shoulder on contact. */
function drawNervePinch(source, target, grid, hit) {
  const root = nativeVfxContainer(target.y, "above");
  if (!root) return Promise.resolve(false);
  const hand = new PIXI.Graphics(), pulse = new PIXI.Graphics();
  root.addChild(hand, pulse);
  const bearing = Math.atan2(target.y - source.y, target.x - source.x);
  const contact = { x: target.x - Math.cos(bearing) * grid * .22 + Math.sin(bearing) * grid * .2,
    y: target.y - Math.sin(bearing) * grid * .22 - Math.cos(bearing) * grid * .2 };
  const duration = 1050, sceneId = canvas.scene.id, ticker = canvas.app.ticker;
  let elapsed = 0, previous = performance.now(), stopped = false, timer, resolve;
  const done = new Promise(r => { resolve = r; });
  const dispose = () => {
    if (stopped) return;
    stopped = true; active.delete(dispose); ticker.remove(tick); clearTimeout(timer);
    if (!root.destroyed) root.destroy({ children: true });
    resolve(true);
  };
  const draw = () => {
    const t = elapsed / duration, reach = clamp(t / .35, 0, 1);
    const recovery = clamp((t - .72) / .28, 0, 1);
    const progress = reach * reach * (3 - 2 * reach) * (1 - recovery * .35);
    hand.clear(); pulse.clear();
    hand.position.set(source.x + (contact.x - source.x) * progress,
      source.y + (contact.y - source.y) * progress);
    hand.rotation = bearing;
    hand.alpha = Math.min(1, t / .08, (1 - t) / .2);
    // Four spread fingers and an opposing thumb. Shortening the distal joints
    // shows the fingers curling toward the palm, then reopening on withdrawal.
    const curl = clamp((t - .32) / .22, 0, 1);
    const close = curl * curl * (3 - 2 * curl) * (1 - recovery);
    const skin = 0xd5b79d, light = 0xecd2b9, outline = 0x77594a;
    const capsule = (a, b, radius, color) => {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const contour = [];
      for (let i = 0; i <= 10; i++) {
        const theta = angle - Math.PI / 2 + i / 10 * Math.PI;
        contour.push((b.x + Math.cos(theta) * radius) * grid,
          (b.y + Math.sin(theta) * radius) * grid);
      }
      for (let i = 0; i <= 10; i++) {
        const theta = angle + Math.PI / 2 + i / 10 * Math.PI;
        contour.push((a.x + Math.cos(theta) * radius) * grid,
          (a.y + Math.sin(theta) * radius) * grid);
      }
      polygon(hand, contour, color);
    };
    const digit = (base, joint, tip, width) => {
      capsule(base, joint, width + .006, outline);
      capsule(joint, tip, width + .006, outline);
      capsule(base, joint, width, skin);
      capsule(joint, tip, width, light);
      // A small rounded nail keeps each fingertip readable at token scale.
      capsule({x:tip.x - .018, y:tip.y}, tip, width * .55, 0xf2d9c3);
    };
    for (const [y, length, spread] of [[-.095,.20,-.07],[-.033,.235,-.024],
      [.033,.215,.027],[.095,.165,.075]]) {
      const joint = {x:.065 + .025 * close, y:y + spread * (1 - close) * .45};
      const tip = {x:length * (1 - close) + .055 * close,
        y:y + spread * (1 - close)};
      digit({x:-.035,y}, joint, tip, .026);
    }
    digit({x:-.15,y:.075}, {x:-.075 + .035*close,y:.19 - .06*close},
      {x:.04 + .015*close,y:.21 - .155*close}, .035);
    // Palm covers the finger roots; a narrow wrist joins the reaching arm.
    polygon(hand, [-.23,-.066,-.15,-.066,-.115,-.12,-.01,-.12,.025,-.085,
      .025,.085,-.01,.12,-.115,.12,-.15,.066,-.23,.066].map(v => v * grid), skin);
    line(hand, [{x:-grid*.12,y:-grid*.07},{x:-grid*.075,y:-grid*.025},
      {x:-grid*.07,y:grid*.05}], grid*.009, outline, .4);
    if (hit && t >= .42) {
      const age = (t - .42) / .58, fade = (1 - age) * Math.min(1, age * 8);
      for (let ring = 0; ring < 2; ring++) {
        const radius = grid * (.06 + age * .27 + ring * .045);
        const points = Array.from({length:33}, (_, i) => ({
          x:contact.x + Math.cos(i / 32 * Math.PI * 2) * radius,
          y:contact.y + Math.sin(i / 32 * Math.PI * 2) * radius }));
        line(pulse, points, grid*.014, 0x80d8ca, fade * .7);
      }
    }
  };
  const tick = () => {
    if (root.destroyed || !canvas.ready || canvas.scene?.id !== sceneId) return dispose();
    const now = performance.now(); elapsed += clamp(now - previous, 0, 50); previous = now;
    if (elapsed >= duration) return dispose();
    try { draw(); } catch (err) { dispose(); console.warn("STA2e Toolkit | Nerve Pinch animation stopped:", err); }
  };
  active.add(dispose);
  try { draw(); ticker.add(tick); timer = setTimeout(dispose, duration + 1000); }
  catch (err) { dispose(); console.warn("STA2e Toolkit | Nerve Pinch animation failed:", err); }
  return done;
}

function drawSwing(source, target, grid, subtype, hit, attackMode, sourceRadius) {
  const root = nativeVfxContainer(source.y, "above");
  if (!root) return Promise.resolve(false);
  const trail = new PIXI.Graphics(), blade = new PIXI.Graphics(), impact = new PIXI.Graphics();
  root.addChild(trail, blade, impact);
  weaponShape(blade, subtype);
  const heavy = subtype === "batleth", lirpa = subtype === "lirpa";
  const thrust = (heavy || lirpa) && attackMode === "thrust", arcSwing = (heavy || lirpa) && !thrust;
  const duration = heavy ? 900 : lirpa ? 850 : 650;
  const size = grid / 100 * (heavy ? .9 : .8);
  blade.scale.set(size);
  const bearing = Math.atan2(target.y - source.y, target.x - source.x);
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const reach = heavy && !thrust ? distance : Math.min(distance, grid * (heavy ? 1.45 : 1.15));
  // End-grip pivot for the bat'leth, shaft pivot for the lirpa's blade swipe.
  // Both aim the free striking end at the target at contact.
  // A bat'leth thrust uses the middle grip and drives the broad inner edge
  // forward (+X), with its long blade span held across the target bearing.
  const grip = lirpa ? {x:0,y:0} : thrust ? {x:-6,y:0} : { x: -4, y: 27 };
  const tip = lirpa ? {x:thrust ? -85 : 83, y:0} : thrust ? {x:6.6,y:0} : { x: 26.04, y: -59.36 };
  const arm = { x: (tip.x - grip.x) * size, y: (tip.y - grip.y) * size };
  const armLength = Math.hypot(arm.x, arm.y), armBearing = Math.atan2(arm.y, arm.x);
  const handReach = Math.max(0, reach - armLength);
  const hand = { x: source.x + Math.cos(bearing) * handReach, y: source.y + Math.sin(bearing) * handReach };
  if (arcSwing || thrust) blade.pivot.set(grip.x, grip.y);
  const contactReach = arcSwing || thrust ? handReach + armLength : reach;
  const contact = { x: source.x + Math.cos(bearing) * contactReach, y: source.y + Math.sin(bearing) * contactReach };
  const sweep = heavy ? 1.75 : 1.55, missOffset = hit ? 0 : .55;
  const pose = p => {
    const angle = bearing + (p - .62) * sweep + missOffset;
    if (thrust) {
      const pullback = grid * .4 * (1 - clamp(p / .62, 0, 1));
      return {x:hand.x - Math.cos(bearing) * pullback, y:hand.y - Math.sin(bearing) * pullback,
        angle: bearing - armBearing + missOffset};
    }
    if (heavy) {
      // Start outside the attacker's flank, then carry the held end along a
      // bowed approach while the free end turns inward toward the target.
      const u = clamp(p / .62, 0, 1), side = sourceRadius + grid * .35;
      const startX = source.x + Math.cos(bearing) * grid * .12 + Math.sin(bearing) * side;
      const startY = source.y + Math.sin(bearing) * grid * .12 - Math.cos(bearing) * side;
      const bow = Math.sin(u * Math.PI) * grid * .2;
      return { x: startX + (hand.x - startX) * u + Math.sin(bearing) * bow,
        y: startY + (hand.y - startY) * u - Math.cos(bearing) * bow, angle: angle - armBearing };
    }
    if (arcSwing) return { x: hand.x, y: hand.y, angle: angle - armBearing };
    const r = reach * (.65 + .35 * Math.sin(p * Math.PI));
    return { x: source.x + Math.cos(angle) * r, y: source.y + Math.sin(angle) * r, angle };
  };
  const trailPoint = p => {
    const at = pose(p);
    if (!arcSwing && !thrust) return at;
    return { x: at.x + arm.x * Math.cos(at.angle) - arm.y * Math.sin(at.angle),
      y: at.y + arm.x * Math.sin(at.angle) + arm.y * Math.cos(at.angle) };
  };
  let stopped = false, previous = performance.now(), elapsed = 0, timer, resolve;
  const done = new Promise(r => { resolve = r; });
  const ticker = canvas.app.ticker, sceneId = canvas.scene.id;
  const dispose = () => {
    if (stopped) return;
    stopped = true; active.delete(dispose); ticker.remove(tick); clearTimeout(timer);
    if (!root.destroyed) root.destroy({ children: true });
    resolve(true);
  };
  const draw = () => {
    const t = elapsed / duration;
    // Wind-up, fast cut, then a slower recovery. Contact occurs at 62% of cut.
    const cut = clamp((t - .18) / .42, 0, 1), p = cut * cut * (3 - 2 * cut);
    const at = pose(p);
    if (thrust) {
      const recovery = clamp((t - .60) / .25, 0, 1);
      at.x -= Math.cos(bearing) * grid * .4 * recovery;
      at.y -= Math.sin(bearing) * grid * .4 * recovery;
    }
    blade.position.set(at.x, at.y);
    blade.rotation = at.angle;
    blade.alpha = Math.min(1, t / .08, (1 - t) / .22);
    trail.clear(); impact.clear();
    if (arcSwing && cut > 0) {
      // Follow the free end's actual path, including the bat'leth's moving
      // hand, and fade the tapered crescent after the follow-through.
      const fade = 1 - clamp((t - .60) / .25, 0, 1);
      const start = Math.max(0, p - .8);
      const arc = Array.from({ length: 33 }, (_, i) => {
        const u = i / 32, progress = start + (p - start) * u;
        const at = pose(progress), angle = at.angle + armBearing;
        return { x:at.x, y:at.y, angle, width: grid * .18 * Math.pow(Math.sin(Math.PI * u), .7) };
      });
      const ribbon = widthScale => {
        const edge = (sample, inner) => {
          const radius = armLength - (inner ? sample.width * widthScale : 0);
          return [sample.x + Math.cos(sample.angle) * radius, sample.y + Math.sin(sample.angle) * radius];
        };
        return [...arc.flatMap(sample => edge(sample, false)),
          ...arc.slice().reverse().flatMap(sample => edge(sample, true))];
      };
      if (fade > 0) {
        polygon(trail, ribbon(1), 0xc6d5e1, .24 * fade);
        polygon(trail, ribbon(.35), 0xe8f2f8, .28 * fade);
        line(trail, arc.map(sample => ({ x: sample.x + Math.cos(sample.angle) * armLength,
          y: sample.y + Math.sin(sample.angle) * armLength })), grid * .012, 0xf3f8fc, .65 * fade);
      }
    } else if (!arcSwing && cut > 0 && cut < 1) {
      const points = Array.from({ length: 14 }, (_, i) => trailPoint(Math.max(0, p - .25 + i / 13 * .25)));
      line(trail, points, grid * .055, 0xc4e5ef, .13);
      line(trail, points, grid * .018, 0xf1f6fa, .45);
    }
    const age = (t - .18 - .42 * .58) * duration;
    if (hit && age > 0 && age < 220) {
      const fade = 1 - age / 220;
      for (let i = 0; i < 7; i++) {
        const a = bearing + i * Math.PI * 2 / 7;
        const r = grid * (.06 + age / 220 * .28);
        line(impact, [{x:contact.x + Math.cos(a)*r*.55, y:contact.y + Math.sin(a)*r*.55},
          {x:contact.x + Math.cos(a)*r, y:contact.y + Math.sin(a)*r}], grid*.018, 0xffe5b0, fade);
      }
    }
  };
  const tick = () => {
    if (root.destroyed || !canvas.ready || canvas.scene?.id !== sceneId) return dispose();
    const now = performance.now(); elapsed += clamp(now - previous, 0, 50); previous = now;
    if (elapsed >= duration) return dispose();
    try { draw(); } catch (err) { dispose(); console.warn("STA2e Toolkit | Melee animation stopped:", err); }
  };
  active.add(dispose);
  try { draw(); ticker.add(tick); timer = setTimeout(dispose, duration + 1000); }
  catch (err) { dispose(); console.warn("STA2e Toolkit | Melee animation failed:", err); }
  return done;
}

globalThis.Hooks?.on("canvasTearDown", () => {
  for (const dispose of [...active]) dispose();
  nextMeleeMode.clear();
});
