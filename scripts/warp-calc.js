/**
 * sta2e-toolkit | warp-calc.js
 * Warp Distance & Travel Time Calculator — integrated into the toolkit HUD.
 *
 * openWarpCalc() reads the active campaign era/theme and opens the matching
 * dialog style:
 *   lcars-tng / lcars-tng-blue  → LCARS orange (TNG style)
 *   tos-panel                   → Dark panel, crimson/amber (TOS style)
 *   tmp-console                 → Dark panel, crimson/amber (TMP style, same sheet)
 *   ent-panel                   → LCARS orange (ENT has no warp scale, but still useful)
 *   default                     → LCARS orange
 */

import { getLcCssVars, getLcTokens } from "./lcars-theme.js";

// ============================================================
// Shared physics & formatting
// ============================================================

const BASE_WIDTH = 880;

// TNG warp → c (10/3 exponent, high-warp interpolation to sub-warp-10)
function warpToC_TNG(w) {
  if (w <= 0) return 0;
  if (w >= 10) return Infinity;
  if (w < 9) return Math.pow(w, 10 / 3);
  const w9 = 1516, w99 = 3053, w999 = 7912;
  if (w <= 9.9) { const t = (w - 9) / 0.9;  return w9  + (w99  - w9)  * Math.pow(t, 2.5); }
  else          { const t = (w - 9.9) / 0.09; return w99 + (w999 - w99) * Math.pow(t, 3);   }
}

// TOS/TMP/ENT warp → c
// Matches TNG (N^10/3) up through Warp 9 = 1516c, then cubic N³ above —
// giving Warp 14 = 2744c as the practical maximum.
function warpToC_TOS(w) {
  if (w <= 0) return 0;
  if (w <= 9) return Math.pow(w, 10 / 3);
  return Math.pow(w, 3);
}

function calcTravelTime(distanceLY, speedC) {
  if (!speedC || speedC <= 0 || !distanceLY || distanceLY <= 0) return null;
  const totalYears = distanceLY / speedC;
  const years      = Math.floor(totalYears);
  const daysRem    = (totalYears - years) * 365.25;
  const days       = Math.floor(daysRem);
  const hoursRem   = (daysRem - days) * 24;
  const hours      = Math.floor(hoursRem);
  const minutes    = Math.floor((hoursRem - hours) * 60);
  return { years, days, hours, minutes, totalYears };
}

function formatTimeShort(t) {
  if (!t) return "—";
  const p = [];
  if (t.years > 0) p.push(`${t.years}Y`);
  if (t.days  > 0) p.push(`${t.days}D`);
  p.push(`${t.hours}H ${t.minutes}M`);
  return p.join(" ");
}

function formatTimeFull(t, warp, speedC) {
  if (!t) return "—";
  const p = [];
  if (t.years > 0) p.push(`${t.years} year${t.years   !== 1 ? "s" : ""}`);
  if (t.days  > 0) p.push(`${t.days}  day${t.days    !== 1 ? "s" : ""}`);
  p.push(`${t.hours} hour${t.hours     !== 1 ? "s" : ""}`);
  p.push(`${t.minutes} minute${t.minutes !== 1 ? "s" : ""}`);
  return `Warp ${warp} (${speedC.toFixed(1)}c): ` + p.join(", ");
}

function calcArrivalStardate(currentSD, travelTimeYears) {
  if (!currentSD || isNaN(currentSD)) return null;
  return (currentSD + travelTimeYears * 1000).toFixed(1);
}

// ============================================================
// Token detection (called at dialog-open time)
// ============================================================

function getTokenContext() {
  const controlled = canvas.tokens.controlled;
  const targeted   = [...game.user.targets].filter(t => !controlled.includes(t));
  const tokenShip  = controlled[0] ?? null;
  const tokenDest  = targeted[0] ?? controlled[1] ?? null;

  const GRID_LY = canvas.scene.grid.distance;
  let tokenDistance3D = null, tokenFlatDistance = null, tokenElevDiff = null;

  if (tokenShip && tokenDest) {
    const gs = canvas.scene.grid.size;
    const ax = tokenShip.x/gs, ay = tokenShip.y/gs, az = (tokenShip.document.elevation ?? 0) / GRID_LY;
    const bx = tokenDest.x/gs,  by = tokenDest.y/gs,  bz = (tokenDest.document.elevation  ?? 0) / GRID_LY;
    const dx = (bx-ax)*GRID_LY, dy = (by-ay)*GRID_LY, dz = (bz-az)*GRID_LY;
    tokenFlatDistance = Math.sqrt(dx*dx + dy*dy);
    tokenDistance3D   = Math.sqrt(dx*dx + dy*dy + dz*dz);
    tokenElevDiff     = Math.abs(dz);
  }

  return {
    nameShip:        tokenShip?.name ?? "ORIGIN",
    nameDest:        tokenDest?.name ?? "DESTINATION",
    tokenDistance3D,
    tokenFlatDistance,
    tokenElevDiff,
  };
}

// ============================================================
// Post to chat via toolkit, fall back to local card
// ============================================================

async function postCard(params, fallbackFn) {
  if (game.sta2eToolkit?.postWarpCard) {
    try {
      await game.sta2eToolkit.postWarpCard(params);
      return;
    } catch (e) {
      console.error("sta2eToolkit.postWarpCard failed:", e);
    }
  }
  fallbackFn();
}

// ============================================================
// LCARS (TNG / default) dialog
// ============================================================

const TNG_PRESETS = [
  { label: "WARP 5",     sublabel: "CRUISE",        value: 5     },
  { label: "WARP 8",     sublabel: "STANDARD",      value: 8     },
  { label: "WARP 9",     sublabel: "EMERGENCY",     value: 9     },
  { label: "WARP 9.6",   sublabel: "MAXIMUM",       value: 9.6   },
  { label: "WARP 9.975", sublabel: "INTREPID MAX",  value: 9.975 },
  { label: "WARP 9.999", sublabel: "SOVEREIGN MAX", value: 9.999 },
];

function buildLCARSContent(ctx) {
  const LC = getLcTokens();
  const cssVars = getLcCssVars("lc", LC);
  const { nameShip, nameDest, tokenDistance3D, tokenFlatDistance, tokenElevDiff } = ctx;
  const tokenDistStr = tokenDistance3D !== null ? tokenDistance3D.toFixed(2) : "";
  const tokenSubStat = tokenDistance3D !== null
    ? `2D FLAT: ${tokenFlatDistance.toFixed(2)} LY${tokenElevDiff > 0.001 ? ` &nbsp;|&nbsp; Z-DEPTH: ${tokenElevDiff.toFixed(2)} LY` : ""}`
    : "NO DESTINATION TOKEN — ENTER DISTANCE MANUALLY";

  const presetRowsHTML = TNG_PRESETS.map(p => `
<div class="lc-row">
  <div class="lc-pip"></div>
  <div class="lc-label">
    <span class="lc-wname">${p.label}</span>
    <span class="lc-wsub">${p.sublabel}</span>
  </div>
  <div class="lc-time" id="preset-time-${p.value.toString().replace(".","_")}">—</div>
  <button class="lc-sendbtn" data-warp="${p.value}">▶ SEND</button>
</div>`).join("");

  return `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Antonio:wght@400;700&display=swap');
  .lc-wrap{${cssVars}background:var(--lc-bg);font-family:'Antonio','Trebuchet MS',sans-serif;color:var(--lc-text-bright);border-radius:6px;overflow:hidden;}
  .lc-wrap *{box-sizing:border-box;}
  .lc-head{height:64px;display:flex;align-items:center;flex-shrink:0;background:#ff9900;border-radius:6px 0 0 0;padding:0 20px;}
  .lc-head-title{color:#000;font-size:1em;letter-spacing:4px;font-weight:bold;flex:1;display:flex;align-items:center;}
  .lc-route{background:#111;padding:6px 20px 5px;border-bottom:2px solid #f90;}
  .lc-route-lbl{color:#f90;font-size:0.72em;letter-spacing:3px;margin-bottom:2px;}
  .lc-route-name{color:#fff;font-size:1.4em;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .lc-arrow{color:#f90;margin:0 7px;}
  .lc-dist-block{display:flex;border-bottom:1px solid #1f1f1f;}
  .lc-dist-bar{background:#9999ff;width:10px;flex-shrink:0;}
  .lc-dist-inner{padding:8px 20px;flex:1;}
  .lc-dist-lbl{color:#9999ff;font-size:0.72em;letter-spacing:3px;margin-bottom:3px;}
  .lc-dist-row{display:flex;align-items:center;gap:10px;}
  .lc-dist-val{color:#fff;font-size:2em;line-height:1.1;flex-shrink:0;}
  .lc-dist-unit{color:#9999ff;font-size:0.65em;margin-left:6px;}
  .lc-dist-sub{color:#444;font-size:0.72em;letter-spacing:1px;margin-top:3px;}
  .lc-dist-override{flex:1;min-width:0;background:#0d0d0d;border:1px solid #333;color:#9999ff;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:1.1em;letter-spacing:1px;padding:6px 10px;border-radius:3px;text-align:center;}
  .lc-dist-override:focus{outline:none;border-color:#9999ff;}
  .lc-dist-override.active{border-color:#9999ff;color:#fff;background:#0a0a1a;}
  .lc-dist-override-lbl{color:#333;font-size:0.66em;letter-spacing:1px;margin-top:2px;}
  .lc-sec{display:flex;align-items:center;gap:8px;padding:5px 20px 3px;background:#000;}
  .lc-sec-bar{background:#f90;height:2px;width:22px;flex-shrink:0;}
  .lc-sec-txt{color:#f90;font-size:0.75em;letter-spacing:3px;}
  .lc-warp-panel{display:flex;align-items:stretch;border-bottom:1px solid #1a1a1a;}
  .lc-presets{flex:1;min-width:0;border-right:2px solid #1a1a1a;}
  .lc-row{display:flex;align-items:center;border-bottom:1px solid #161616;height:40px;}
  .lc-row:last-child{border-bottom:none;}
  .lc-row:hover{background:#0c0c0c;}
  .lc-pip{background:#f90;width:6px;align-self:stretch;flex-shrink:0;}
  .lc-label{width:140px;padding:0 12px;flex-shrink:0;display:flex;align-items:center;gap:8px;}
  .lc-wname{color:#fff;font-size:1em;letter-spacing:1px;white-space:nowrap;}
  .lc-wsub{color:#444;font-size:0.62em;letter-spacing:2px;white-space:nowrap;}
  .lc-time{flex:1;color:#f90;font-size:1em;letter-spacing:1px;padding:0 10px;white-space:nowrap;}
  .lc-sendbtn{flex-shrink:0;width:86px;background:#1a1a1a;border:1px solid #444;color:#f90;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:0.72em;letter-spacing:2px;padding:5px 0;margin:0 10px;border-radius:3px;cursor:pointer;}
  .lc-sendbtn:hover{background:#f90;color:#000;border-color:#f90;}
  .lc-custom-panel{width:260px;flex-shrink:0;background:#0a0a0a;display:flex;flex-direction:column;padding:12px 16px;gap:10px;}
  .lc-custom-sec-txt{color:#f90;font-size:0.72em;letter-spacing:3px;margin-bottom:2px;}
  .lc-pills{display:flex;gap:4px;flex-wrap:wrap;}
  .lc-pill{background:#111;border:1px solid #f90;color:#f90;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:0.7em;letter-spacing:1px;padding:3px 9px;border-radius:2px;cursor:pointer;}
  .lc-pill:hover{background:#f90;color:#000;}
  .lc-num-input{width:100%;background:#0d0d0d;border:1px solid #f90;color:#f90;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:1.2em;letter-spacing:1px;padding:7px;border-radius:3px;text-align:center;}
  .lc-num-input:focus{outline:none;border-color:#ffaa33;}
  .lc-cresult{color:#fff;font-size:0.88em;line-height:1.4;min-height:1.4em;}
  .lc-cresult .cr-warp{color:#f90;}
  .lc-cresult .cr-c{color:#555;font-size:0.85em;}
  .lc-mainbtn{width:100%;background:#f90;border:none;color:#000;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:0.8em;letter-spacing:2px;font-weight:bold;padding:10px;border-radius:3px;cursor:pointer;margin-top:auto;}
  .lc-mainbtn:hover{background:#ffb733;}
  .lc-sd-block{padding:6px 20px 10px;border-top:1px solid #1a1a1a;}
  .lc-sd-row{display:flex;align-items:center;gap:12px;margin-top:6px;}
  .lc-sd-input{flex:1;background:#0d0d0d;border:1px solid #555;color:#cc7700;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:1.1em;letter-spacing:2px;padding:7px 12px;border-radius:3px;text-align:center;min-width:0;}
  .lc-sd-input:focus{outline:none;border-color:#f90;}
  .lc-sd-arrow{color:#f90;font-size:1.3em;flex-shrink:0;}
  .lc-sd-arrival{flex:1;background:#0d0d0d;border:1px solid #333;color:#888;font-family:'Antonio','Trebuchet MS',sans-serif;font-size:1.1em;letter-spacing:2px;padding:7px 12px;border-radius:3px;text-align:center;min-width:0;}
  .lc-sd-labels{display:flex;gap:12px;margin-top:4px;}
  .lc-sd-label{flex:1;color:#333;font-size:0.68em;letter-spacing:2px;text-align:center;}
  .lc-sd-hint{color:#2a2a2a;font-size:0.66em;letter-spacing:1px;margin-top:4px;}
  .lc-foot{height:36px;display:flex;align-items:center;flex-shrink:0;background:#ff9900;border-radius:0 0 0 6px;padding:0 16px;}
  .lc-foot-txt{color:#000;font-size:0.66em;letter-spacing:2px;flex:1;}
  .lc-foot-tag{background:#cc7700;color:#000;font-size:0.66em;letter-spacing:2px;padding:0 14px;height:24px;display:flex;align-items:center;border-radius:3px;}
  .lc-head,.lc-foot{background:var(--lc-primary);}
  .lc-head-title,.lc-foot-txt,.lc-foot-tag,.lc-sendbtn:hover,.lc-pill:hover,.lc-mainbtn{color:var(--lc-bg);}
  .lc-route{background:var(--lc-panel);border-bottom-color:var(--lc-primary);}
  .lc-route-lbl,.lc-arrow,.lc-sec-txt,.lc-time,.lc-sendbtn,.lc-pill,.lc-num-input,.lc-cresult .cr-warp,.lc-sd-arrow{color:var(--lc-primary);}
  .lc-route-name,.lc-dist-val,.lc-cresult{color:var(--lc-text-bright);}
  .lc-dist-bar,.lc-sec-bar,.lc-pip,.lc-mainbtn{background:var(--lc-primary);}
  .lc-dist-lbl,.lc-dist-unit,.lc-dist-override{color:var(--lc-secondary);}
  .lc-dist-override,.lc-pill,.lc-num-input{border-color:var(--lc-primary);}
  .lc-sendbtn:hover,.lc-pill:hover{background:var(--lc-primary);border-color:var(--lc-primary);}
  .lc-sd-input:focus,.lc-num-input:focus,.lc-dist-override:focus{border-color:var(--lc-tertiary);}
  .lc-foot-tag{background:color-mix(in srgb,var(--lc-primary) 72%,black);}
</style>

<div class="lc-wrap" id="lc-wrap">

  <div class="lc-head">
    <div class="lc-head-title">WARP NAVIGATION ANALYSIS</div>
  </div>

  <div class="lc-route">
    <div class="lc-route-lbl">DESTINATION ROUTE</div>
    <div class="lc-route-name">
      ${nameShip.toUpperCase()}<span class="lc-arrow">▶</span>${nameDest.toUpperCase()}
    </div>
  </div>

  <div class="lc-dist-block">
    <div class="lc-dist-bar"></div>
    <div class="lc-dist-inner">
      <div class="lc-dist-lbl">DISTANCE</div>
      <div class="lc-dist-row">
        <div class="lc-dist-val" id="dist-display">
          ${tokenDistStr ? `${tokenDistStr}<span class="lc-dist-unit">LY</span>` : `<span style="color:#444;font-size:0.7em;">——</span>`}
        </div>
        <input class="lc-dist-override" type="number" id="dist-override" placeholder="manual LY" min="0.01" step="0.01" />
      </div>
      <div class="lc-dist-sub" id="dist-sub">${tokenSubStat}</div>
      <div class="lc-dist-override-lbl" id="dist-override-lbl">OVERRIDE: TYPE TO FORCE A MANUAL DISTANCE</div>
    </div>
  </div>

  <div class="lc-sec">
    <div class="lc-sec-bar"></div>
    <div class="lc-sec-txt">WARP FACTORS</div>
  </div>

  <div class="lc-warp-panel">
    <div class="lc-presets">${presetRowsHTML}</div>
    <div class="lc-custom-panel">
      <div>
        <div class="lc-custom-sec-txt">CUSTOM WARP</div>
        <div class="lc-pills" style="margin-top:6px;">
          ${TNG_PRESETS.map(p => `<span class="lc-pill" data-warp="${p.value}">${p.value}</span>`).join("")}
        </div>
      </div>
      <input class="lc-num-input" type="number" id="custom-warp" min="0.1" max="9.999" step="0.001" value="9" />
      <div class="lc-cresult" id="custom-result">—</div>
      <button class="lc-mainbtn" id="custom-chat-btn">▶ SEND</button>
    </div>
  </div>

  <div class="lc-sd-block">
    <div class="lc-sec-txt">STARDATE</div>
    <div class="lc-sd-row">
      <input class="lc-sd-input" type="text" id="stardate-input" placeholder="e.g. 49025.3" maxlength="12" />
      <div class="lc-sd-arrow">▶</div>
      <div class="lc-sd-arrival" id="sd-arrival">——</div>
    </div>
    <div class="lc-sd-labels">
      <div class="lc-sd-label">CURRENT STARDATE</div>
      <div style="width:22px;flex-shrink:0;"></div>
      <div class="lc-sd-label">ARRIVAL STARDATE</div>
    </div>
    <div class="lc-sd-hint">ARRIVAL UPDATES WITH SELECTED WARP FACTOR · LEAVE BLANK TO OMIT FROM CHAT</div>
  </div>

  <div class="lc-foot">
    <div class="lc-foot-txt">WARP NAVIGATION SYSTEMS ONLINE</div>
    <div class="lc-foot-tag">WARP NAV v2.4</div>
  </div>

</div>`;
}

// ============================================================
// TOS / TMP dialog
// ============================================================

const TOS_PRESETS = [
  { label: "WARP 3",   sublabel: "STANDARD",   value: 3   },
  { label: "WARP 6",   sublabel: "CRUISE",      value: 6   },
  { label: "WARP 8",   sublabel: "EMERGENCY",   value: 8   },
  { label: "WARP 14.1",sublabel: "MAX SAFE",    value: 14.1 },
];

function buildTOSContent(ctx) {
  const { nameShip, nameDest, tokenDistance3D, tokenFlatDistance, tokenElevDiff } = ctx;
  const tokenDistStr = tokenDistance3D !== null ? tokenDistance3D.toFixed(2) : "";
  const tokenSubStat = tokenDistance3D !== null
    ? `FLAT: ${tokenFlatDistance.toFixed(2)} LY${tokenElevDiff > 0.001 ? `  |  Z: ${tokenElevDiff.toFixed(2)} LY` : ""}`
    : "NO DESTINATION TOKEN — ENTER DISTANCE MANUALLY";

  const presetRowsHTML = TOS_PRESETS.map(p => `
<div class="tw-row">
  <div class="tw-row-accent"></div>
  <div class="tw-row-label">
    <span class="tw-wname">${p.label}</span>
    <span class="tw-wsub">${p.sublabel}</span>
  </div>
  <div class="tw-row-speed">${warpToC_TOS(p.value).toFixed(0)}c</div>
  <div class="tw-row-time" id="preset-time-${p.value.toString().replace(".","_")}">—</div>
  <button class="tw-sendbtn" data-warp="${p.value}">SEND</button>
</div>`).join("");

  return `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700&display=swap');
  .tw-wrap{background:#080808;font-family:'Share Tech Mono','Courier New',monospace;color:#ccc;border-top:3px solid #cc2200;overflow:hidden;}
  .tw-wrap *{box-sizing:border-box;}
  .tw-head{background:linear-gradient(180deg,#150800 0%,#0a0400 100%);padding:8px 20px 7px;border-bottom:2px solid #cc2200;display:flex;justify-content:space-between;align-items:center;}
  .tw-head-title{font-family:'Orbitron',monospace;color:#cc2200;font-size:0.85em;letter-spacing:4px;font-weight:700;}
  .tw-head-sub{color:#664400;font-size:0.66em;letter-spacing:2px;margin-top:2px;}
  .tw-route{background:#0d0600;padding:6px 20px;border-bottom:1px solid #1a1a1a;}
  .tw-route-lbl{color:#663300;font-size:0.68em;letter-spacing:3px;margin-bottom:2px;}
  .tw-route-name{color:#ffcc44;font-size:1.35em;letter-spacing:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .tw-arrow{color:#cc2200;margin:0 8px;}
  .tw-dist-block{background:#0a0a0a;border-bottom:1px solid #1a1a1a;display:flex;}
  .tw-dist-bar{background:#1a3a6a;width:8px;flex-shrink:0;}
  .tw-dist-inner{padding:8px 20px;flex:1;}
  .tw-dist-lbl{color:#3366aa;font-size:0.68em;letter-spacing:3px;margin-bottom:3px;}
  .tw-dist-row{display:flex;align-items:center;gap:10px;}
  .tw-dist-val{font-family:'Orbitron',monospace;color:#4499ff;font-size:1.9em;flex-shrink:0;}
  .tw-dist-unit{color:#3366aa;font-size:0.64em;margin-left:5px;}
  .tw-dist-sub{color:#222;font-size:0.68em;letter-spacing:1px;margin-top:3px;}
  .tw-dist-override{flex:1;min-width:0;background:#050505;border:1px solid #222;color:#4499ff;font-family:'Share Tech Mono','Courier New',monospace;font-size:1.05em;padding:6px 10px;border-radius:2px;text-align:center;}
  .tw-dist-override:focus{outline:none;border-color:#4499ff;}
  .tw-dist-override.active{border-color:#4499ff;background:#020a14;}
  .tw-dist-override-lbl{color:#1a1a1a;font-size:0.64em;letter-spacing:1px;margin-top:2px;}
  .tw-sec{display:flex;align-items:center;gap:10px;padding:5px 20px 3px;background:#080808;}
  .tw-sec-line{background:#cc2200;height:1px;flex:1;}
  .tw-sec-txt{color:#661100;font-size:0.68em;letter-spacing:3px;white-space:nowrap;}
  .tw-warp-panel{display:flex;align-items:stretch;border-bottom:1px solid #111;}
  .tw-presets{flex:1;min-width:0;border-right:2px solid #111;}
  .tw-row{display:flex;align-items:center;border-bottom:1px solid #111;height:42px;background:#080808;}
  .tw-row:last-child{border-bottom:none;}
  .tw-row:hover{background:#0e0600;}
  .tw-row-accent{background:#8B4500;width:5px;align-self:stretch;flex-shrink:0;}
  .tw-row-label{width:180px;padding:0 12px;flex-shrink:0;display:flex;align-items:center;gap:8px;}
  .tw-wname{color:#ffcc44;font-size:1em;letter-spacing:1px;white-space:nowrap;}
  .tw-wsub{color:#331a00;font-size:0.6em;letter-spacing:1px;white-space:nowrap;}
  .tw-row-speed{width:60px;color:#663300;font-size:0.72em;letter-spacing:1px;flex-shrink:0;text-align:right;padding-right:8px;}
  .tw-row-time{flex:1;color:#ff8800;font-size:1em;letter-spacing:1px;padding:0 10px;white-space:nowrap;}
  .tw-sendbtn{flex-shrink:0;width:68px;background:#150800;border:1px solid #441100;color:#cc2200;font-family:'Share Tech Mono','Courier New',monospace;font-size:0.68em;letter-spacing:2px;padding:5px 0;margin:0 12px;border-radius:2px;cursor:pointer;}
  .tw-sendbtn:hover{background:#cc2200;color:#fff;border-color:#cc2200;}
  .tw-custom-panel{width:260px;flex-shrink:0;background:#050505;display:flex;flex-direction:column;padding:12px 16px;gap:10px;border-left:1px solid #1a1a1a;}
  .tw-custom-sec-txt{color:#661100;font-size:0.68em;letter-spacing:3px;}
  .tw-pills{display:flex;gap:4px;flex-wrap:wrap;}
  .tw-pill{background:#0d0500;border:1px solid #441100;color:#cc2200;font-family:'Share Tech Mono','Courier New',monospace;font-size:0.68em;letter-spacing:1px;padding:3px 9px;border-radius:2px;cursor:pointer;}
  .tw-pill:hover{background:#cc2200;color:#fff;}
  .tw-num-input{width:100%;background:#050505;border:1px solid #cc2200;color:#ff8800;font-family:'Share Tech Mono','Courier New',monospace;font-size:1.15em;letter-spacing:1px;padding:7px;border-radius:2px;text-align:center;}
  .tw-num-input:focus{outline:none;border-color:#ff4400;}
  .tw-cresult{color:#ccc;font-size:0.88em;line-height:1.4;min-height:1.4em;}
  .tw-cresult .cr-warp{color:#ff8800;}
  .tw-cresult .cr-c{color:#331a00;font-size:0.85em;}
  .tw-mainbtn{width:100%;background:#cc2200;border:none;color:#fff;font-family:'Share Tech Mono','Courier New',monospace;font-size:0.75em;letter-spacing:2px;font-weight:bold;padding:10px;border-radius:2px;cursor:pointer;margin-top:auto;}
  .tw-mainbtn:hover{background:#ff3300;}
  .tw-sd-block{padding:5px 20px 10px;border-top:1px solid #111;background:#080808;}
  .tw-sd-row{display:flex;align-items:center;gap:10px;margin-top:6px;}
  .tw-sd-input{flex:1;min-width:0;background:#050505;border:1px solid #442200;color:#ffcc44;font-family:'Share Tech Mono','Courier New',monospace;font-size:1.08em;letter-spacing:2px;padding:7px 10px;border-radius:2px;text-align:center;}
  .tw-sd-input:focus{outline:none;border-color:#cc2200;}
  .tw-sd-arrow{color:#cc2200;font-size:1.25em;flex-shrink:0;}
  .tw-sd-arrival{flex:1;min-width:0;background:#050505;border:1px solid #221100;color:#664400;font-family:'Share Tech Mono','Courier New',monospace;font-size:1.08em;letter-spacing:2px;padding:7px 10px;border-radius:2px;text-align:center;}
  .tw-sd-labels{display:flex;gap:10px;margin-top:4px;}
  .tw-sd-label{flex:1;color:#1a0a00;font-size:0.65em;letter-spacing:2px;text-align:center;}
  .tw-sd-hint{color:#111;font-size:0.64em;letter-spacing:1px;margin-top:4px;}
  .tw-foot{background:#0d0500;border-top:1px solid #1a0800;padding:6px 16px;display:flex;justify-content:space-between;align-items:center;}
  .tw-foot-l{color:#2a1000;font-size:0.65em;letter-spacing:2px;}
  .tw-foot-r{color:#2a1000;font-size:0.65em;letter-spacing:1px;}
</style>

<div class="tw-wrap" id="tw-wrap">

  <div class="tw-head">
    <div>
      <div class="tw-head-title">NAVIGATIONAL ANALYSIS</div>
      <div class="tw-head-sub">FEDERATION WARP NAVIGATION · MK VII</div>
    </div>
    <div style="color:#330a00;font-size:0.6em;letter-spacing:1px;text-align:right;line-height:1.6;">WARP FORMULA<br>N³ × C</div>
  </div>

  <div class="tw-route">
    <div class="tw-route-lbl">DESTINATION ROUTE</div>
    <div class="tw-route-name">
      ${nameShip.toUpperCase()}<span class="tw-arrow">▶</span>${nameDest.toUpperCase()}
    </div>
  </div>

  <div class="tw-dist-block">
    <div class="tw-dist-bar"></div>
    <div class="tw-dist-inner">
      <div class="tw-dist-lbl">DISTANCE</div>
      <div class="tw-dist-row">
        <div class="tw-dist-val" id="dist-display">
          ${tokenDistStr ? `${tokenDistStr}<span class="tw-dist-unit">LY</span>` : `<span style="color:#1a1a1a;font-size:0.7em;">——</span>`}
        </div>
        <input class="tw-dist-override" type="number" id="dist-override" placeholder="manual LY" min="0.01" step="0.01" />
      </div>
      <div class="tw-dist-sub" id="dist-sub">${tokenSubStat}</div>
      <div class="tw-dist-override-lbl" id="dist-override-lbl">OVERRIDE: TYPE TO FORCE MANUAL DISTANCE</div>
    </div>
  </div>

  <div class="tw-sec">
    <div class="tw-sec-line"></div>
    <div class="tw-sec-txt">WARP FACTORS</div>
    <div class="tw-sec-line"></div>
  </div>

  <div class="tw-warp-panel">
    <div class="tw-presets">${presetRowsHTML}</div>
    <div class="tw-custom-panel">
      <div>
        <div class="tw-custom-sec-txt">CUSTOM WARP</div>
        <div class="tw-pills" style="margin-top:6px;">
          ${TOS_PRESETS.map(p => `<span class="tw-pill" data-warp="${p.value}">${p.value}</span>`).join("")}
        </div>
      </div>
      <input class="tw-num-input" type="number" id="custom-warp" min="0.1" max="14.1" step="0.1" value="6" />
      <div class="tw-cresult" id="custom-result">—</div>
      <button class="tw-mainbtn" id="custom-chat-btn">▶ SEND</button>
    </div>
  </div>

  <div class="tw-sd-block">
    <div class="tw-sec-txt" style="color:#661100;">STARDATE</div>
    <div class="tw-sd-row">
      <input class="tw-sd-input" type="text" id="stardate-input" placeholder="e.g. 2258.3" maxlength="12" />
      <div class="tw-sd-arrow">▶</div>
      <div class="tw-sd-arrival" id="sd-arrival">——</div>
    </div>
    <div class="tw-sd-labels">
      <div class="tw-sd-label">DEPARTURE STARDATE</div>
      <div style="width:18px;flex-shrink:0;"></div>
      <div class="tw-sd-label">ARRIVAL STARDATE</div>
    </div>
    <div class="tw-sd-hint">ARRIVAL UPDATES WITH SELECTED WARP · LEAVE BLANK TO OMIT FROM CHAT</div>
  </div>

  <div class="tw-foot">
    <div class="tw-foot-l">STARFLEET NAVIGATIONAL SYSTEMS</div>
    <div class="tw-foot-r">WARP NAV MK VII</div>
  </div>

</div>`;
}

// ============================================================
// Shared render callback factory
// ============================================================

function makeRenderFn({ prefix, warpToC, presets, defaultWarp, ctx }) {
  const { nameShip, nameDest, tokenDistance3D, tokenFlatDistance, tokenElevDiff } = ctx;
  const lc = prefix === "lc";

  const tokenSubStat = tokenDistance3D !== null
    ? (lc
        ? `2D FLAT: ${tokenFlatDistance.toFixed(2)} LY${tokenElevDiff > 0.001 ? ` &nbsp;|&nbsp; Z-DEPTH: ${tokenElevDiff.toFixed(2)} LY` : ""}`
        : `FLAT: ${tokenFlatDistance.toFixed(2)} LY${tokenElevDiff > 0.001 ? `  |  Z: ${tokenElevDiff.toFixed(2)} LY` : ""}`)
    : "NO DESTINATION TOKEN — ENTER DISTANCE MANUALLY";

  return (html) => {
    const warpInput    = html.find("#custom-warp");
    const customResult = html.find("#custom-result");
    const chatBtn      = html.find("#custom-chat-btn");
    const sdInput      = html.find("#stardate-input");
    const sdArrival    = html.find("#sd-arrival");
    const distOverride = html.find("#dist-override");
    const distDisplay  = html.find("#dist-display");
    const distSub      = html.find("#dist-sub");
    const distOvLbl    = html.find("#dist-override-lbl");

    // No scaler — dialog is fixed-width and resizable via Foundry's native resize.

    // Auto-populate stardate from toolkit
    if (game.sta2eToolkit) {
      const sd = game.sta2eToolkit.getCurrentStardate();
      if (sd) sdInput.val(sd.toFixed(1));
    }

    let cWarp = defaultWarp, cSpeed = warpToC(defaultWarp), cTime = null;

    function getActiveDistance() {
      const ov = parseFloat(distOverride.val());
      return (!isNaN(ov) && ov > 0) ? ov : tokenDistance3D;
    }

    function getCurrentSD()  { return sdInput.val(); }
    function getArrivalSD(y) { return calcArrivalStardate(parseFloat(sdInput.val()), y); }

    const arrivalDimColor = lc ? "#888"   : "#664400";
    const arrivalLitColor = lc ? "#cc7700": "#ffcc44";

    function updateArrivalDisplay() {
      const sd = parseFloat(sdInput.val());
      if (!sd || isNaN(sd) || !cTime) { sdArrival.text("——").css("color", arrivalDimColor); return; }
      sdArrival.text(calcArrivalStardate(sd, cTime.totalYears)).css("color", arrivalLitColor);
    }

    function updatePresetRows(dist) {
      presets.forEach(p => {
        const t = calcTravelTime(dist, warpToC(p.value));
        html.find(`#preset-time-${p.value.toString().replace(".","_")}`).text(formatTimeShort(t));
      });
    }

    const unitClass  = lc ? "lc-dist-unit" : "tw-dist-unit";
    const unitColor  = lc ? "#9999ff" : "#3366aa";
    const unitSize   = lc ? "0.65em" : "0.64em";
    const blankColor = lc ? "#444" : "#1a1a1a";

    function updateAll() {
      const dist = getActiveDistance();
      const w    = parseFloat(warpInput.val());
      cWarp = w; cSpeed = warpToC(w); cTime = calcTravelTime(dist, cSpeed);
      updatePresetRows(dist);
      if (!w || w <= 0 || (lc && w >= 10)) {
        customResult.html(lc && w >= 10 ? `<span class="cr-warp">WARP 10: IMPOSSIBLE</span>` : "—");
      } else {
        customResult.html(`<span class="cr-warp">WARP ${w}</span> <span class="cr-c">(${cSpeed.toFixed(1)}c)</span><br>${formatTimeShort(cTime)}`);
      }
      updateArrivalDisplay();
    }

    distOverride.on("input", function() {
      const ov = parseFloat($(this).val());
      if (!isNaN(ov) && ov > 0) {
        distDisplay.html(`${ov.toFixed(2)}<span style="color:${unitColor};font-size:${unitSize};margin-left:5px;">LY</span> <span style="color:${unitColor};font-size:0.45em;letter-spacing:1px;">MANUAL</span>`);
        distSub.html("TOKEN DISTANCE OVERRIDDEN").css("color", unitColor);
        distOvLbl.css("color", unitColor);
        $(this).addClass("active");
      } else {
        if (tokenDistance3D !== null) {
          distDisplay.html(`${tokenDistance3D.toFixed(2)}<span style="color:${unitColor};font-size:${unitSize};margin-left:5px;">LY</span>`);
          distSub.html(tokenSubStat).css("color", lc ? "#444" : "#222");
        } else {
          distDisplay.html(`<span style="color:${blankColor};font-size:0.7em;">——</span>`);
          distSub.html("NO DESTINATION TOKEN — ENTER DISTANCE MANUALLY").css("color", lc ? "#444" : "#222");
        }
        distOvLbl.css("color", lc ? "#333" : "#1a1a1a");
        $(this).removeClass("active");
      }
      updateAll();
    });

    warpInput.on("input", updateAll);
    sdInput.on("input", updateArrivalDisplay);
    html.find(`.${prefix}-pill`).on("click", function() { warpInput.val($(this).data("warp")); updateAll(); });

    async function sendPreset(w) {
      const dist = getActiveDistance();
      if (!dist) return ui.notifications.warn("STA 2e Toolkit: No distance set.");
      const s = warpToC(w), t = calcTravelTime(dist, s);
      await postCard(
        { shipName: nameShip, destination: nameDest, warpFactor: w, speedC: s, distanceLY: dist,
          travelTime: { years: t.years ?? 0, days: t.days, hours: t.hours, minutes: t.minutes } },
        () => localCard(w, s, t, getCurrentSD(), getArrivalSD(t.totalYears), dist)
      );
    }

    async function sendCustom() {
      const dist = getActiveDistance();
      if (!dist || !cTime) return ui.notifications.warn("STA 2e Toolkit: No distance or warp set.");
      await postCard(
        { shipName: nameShip, destination: nameDest, warpFactor: cWarp, speedC: cSpeed, distanceLY: dist,
          travelTime: { years: cTime.years ?? 0, days: cTime.days, hours: cTime.hours, minutes: cTime.minutes } },
        () => localCard(cWarp, cSpeed, cTime, getCurrentSD(), getArrivalSD(cTime.totalYears), dist)
      );
    }

    // Local fallback chat card — matches theme
    function localCard(warp, speedC, t, currentSD, arrivalSD, dist) {
      const hasSd = currentSD?.trim();
      if (lc) {
        const sdBlock  = hasSd ? `<div style="background:#cc7700;color:#000;padding:0 12px;height:44px;line-height:44px;font-size:0.62em;letter-spacing:2px;font-weight:bold;white-space:nowrap;">SD ${currentSD.trim()}</div>` : "";
        const sdFooter = hasSd && arrivalSD ? `
  <div style="display:flex;border-bottom:1px solid #222;">
    <div style="background:#cc7700;width:8px;flex-shrink:0;"></div>
    <div style="padding:7px 14px;flex:1;display:flex;justify-content:space-between;align-items:center;">
      <div><div style="color:#cc7700;font-size:0.54em;letter-spacing:2px;margin-bottom:1px;">DEPARTURE STARDATE</div><div style="color:#fff;font-size:0.95em;letter-spacing:1px;">${currentSD.trim()}</div></div>
      <div style="color:#f90;font-size:1em;padding:0 10px;">▶</div>
      <div style="text-align:right;"><div style="color:#cc7700;font-size:0.54em;letter-spacing:2px;margin-bottom:1px;">ARRIVAL STARDATE</div><div style="color:#fff;font-size:0.95em;letter-spacing:1px;">${arrivalSD}</div></div>
    </div>
  </div>` : "";
        ChatMessage.create({ content: `
<div style="background:#000;border-radius:12px;overflow:hidden;font-family:'Antonio','Trebuchet MS',sans-serif;border:2px solid #f90;max-width:420px;">
  <div style="height:44px;display:flex;align-items:center;background:#ff9900;border-radius:10px 0 0 0;padding:0 14px;">
    <div style="color:#000;font-size:0.68em;letter-spacing:3px;font-weight:bold;flex:1;">NAVIGATIONAL ANALYSIS</div>
    ${sdBlock}
  </div>
  <div style="background:#111;padding:8px 16px 6px;border-bottom:1px solid #333;">
    <div style="color:#f90;font-size:0.56em;letter-spacing:3px;margin-bottom:3px;">DESTINATION ROUTE</div>
    <div style="color:#fff;font-size:1em;letter-spacing:1px;">${nameShip.toUpperCase()} <span style="color:#f90;">▶</span> ${nameDest.toUpperCase()}</div>
  </div>
  <div style="display:flex;border-bottom:1px solid #222;">
    <div style="background:#9999ff;width:8px;flex-shrink:0;"></div>
    <div style="padding:8px 14px;flex:1;">
      <div style="color:#9999ff;font-size:0.54em;letter-spacing:2px;margin-bottom:2px;">DISTANCE</div>
      <div style="color:#fff;font-size:1.1em;">${dist.toFixed(2)} <span style="color:#9999ff;font-size:0.65em;">LIGHT YEARS</span></div>
    </div>
  </div>
  <div style="display:flex;border-bottom:1px solid #222;">
    <div style="background:#f90;width:8px;flex-shrink:0;"></div>
    <div style="padding:8px 14px;flex:1;">
      <div style="color:#f90;font-size:0.54em;letter-spacing:2px;margin-bottom:2px;">TRAVEL TIME</div>
      <div style="color:#fff;font-size:0.95em;">${formatTimeFull(t, warp, speedC)}</div>
    </div>
  </div>
  ${sdFooter}
  <div style="height:26px;display:flex;align-items:center;background:#ff9900;border-radius:0 0 0 10px;padding:0 12px;">
    <div style="color:#000;font-size:0.52em;letter-spacing:2px;flex:1;">WARP NAVIGATION SYSTEMS</div>
    <div style="background:#cc7700;color:#000;padding:0 10px;height:20px;line-height:20px;font-size:0.52em;letter-spacing:2px;border-radius:2px;">WARP NAV v2.4</div>
  </div>
</div>`, speaker: ChatMessage.getSpeaker() });
      } else {
        const sdRow = hasSd && arrivalSD ? `
  <tr style="border-top:1px solid #1a1a1a;">
    <td style="padding:0;width:6px;background:#8B0000;"></td>
    <td style="padding:7px 12px;">
      <div style="color:#ff4444;font-size:0.52em;letter-spacing:2px;margin-bottom:3px;">STARDATE</div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div><div style="color:#aaa;font-size:0.56em;letter-spacing:1px;">DEPARTURE</div><div style="color:#ffcc44;font-size:0.95em;letter-spacing:2px;">${currentSD.trim()}</div></div>
        <div style="color:#ff4444;font-size:1.2em;">▶</div>
        <div><div style="color:#aaa;font-size:0.56em;letter-spacing:1px;">ARRIVAL</div><div style="color:#ffcc44;font-size:0.95em;letter-spacing:2px;">${arrivalSD}</div></div>
      </div>
    </td>
  </tr>` : "";
        ChatMessage.create({ content: `
<div style="background:#0a0a0a;border:1px solid #444;border-top:3px solid #cc2200;border-radius:4px;overflow:hidden;font-family:'Share Tech Mono','Courier New',monospace;max-width:420px;">
  <div style="background:linear-gradient(180deg,#1a0a00 0%,#0d0500 100%);padding:10px 14px 8px;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="color:#cc2200;font-size:0.58em;letter-spacing:3px;margin-bottom:2px;">STARFLEET · NAVIGATIONAL ANALYSIS</div>
      <div style="color:#ffcc44;font-size:0.95em;letter-spacing:1px;">${nameShip.toUpperCase()} <span style="color:#cc2200;">▶</span> ${nameDest.toUpperCase()}</div>
    </div>
    ${hasSd ? `<div style="background:#1a0500;border:1px solid #551100;border-radius:2px;padding:3px 8px;text-align:right;"><div style="color:#cc2200;font-size:0.48em;letter-spacing:2px;">SD</div><div style="color:#ffcc44;font-size:0.82em;letter-spacing:1px;">${currentSD.trim()}</div></div>` : ""}
  </div>
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:0;width:6px;background:#1a3a6a;"></td>
      <td style="padding:7px 12px;">
        <div style="color:#4499ff;font-size:0.52em;letter-spacing:2px;margin-bottom:2px;">DISTANCE</div>
        <div style="color:#fff;font-size:1.05em;letter-spacing:1px;">${dist.toFixed(2)} <span style="color:#4499ff;font-size:0.65em;">LIGHT YEARS</span></div>
      </td>
    </tr>
    <tr style="border-top:1px solid #1a1a1a;">
      <td style="padding:0;width:6px;background:#8B4500;"></td>
      <td style="padding:7px 12px;">
        <div style="color:#ff8800;font-size:0.52em;letter-spacing:2px;margin-bottom:2px;">TRAVEL TIME</div>
        <div style="color:#fff;font-size:0.95em;">${formatTimeFull(t, warp, speedC)}</div>
      </td>
    </tr>
    ${dateRow}
  </table>
  <div style="background:#0d0500;border-top:1px solid #222;padding:5px 12px;display:flex;justify-content:space-between;">
    <div style="color:#441100;font-size:0.5em;letter-spacing:2px;">FEDERATION NAVIGATIONAL SYSTEMS</div>
    <div style="color:#441100;font-size:0.5em;letter-spacing:1px;">MK VII · WARP NAV</div>
  </div>
</div>`, speaker: ChatMessage.getSpeaker() });
      }
    }

    html.find(`.${prefix}-sendbtn`).on("click", async function() {
      await sendPreset(parseFloat($(this).data("warp")));
    });
    chatBtn.on("click", async () => { await sendCustom(); });

    updateAll();
  };
}

// ============================================================
// ENT (NX-01 era) dialog — gunmetal/amber, TOS cubic physics
// Presets reflect ENT warp scale practical range
// ============================================================

const ENT_PRESETS = [
  { label: "WARP 1",   sublabel: "MINIMUM",     value: 1   },
  { label: "WARP 3",   sublabel: "STANDARD",     value: 3   },
  { label: "WARP 4",   sublabel: "CRUISE",       value: 4   },
  { label: "WARP 5",   sublabel: "EMERGENCY",    value: 5   },
  { label: "WARP 5.1", sublabel: "ENTERPRISE MAX", value: 5.1 },
  { label: "WARP 7",   sublabel: "THEORETICAL",  value: 7   },
];

function buildENTContent(ctx) {
  const { nameShip, nameDest, tokenDistance3D, tokenFlatDistance, tokenElevDiff } = ctx;
  const tokenDistStr = tokenDistance3D !== null ? tokenDistance3D.toFixed(2) : "";
  const tokenSubStat = tokenDistance3D !== null
    ? `FLAT: ${tokenFlatDistance.toFixed(2)} LY${tokenElevDiff > 0.001 ? `  |  Z: ${tokenElevDiff.toFixed(2)} LY` : ""}`
    : "NO DESTINATION TOKEN — ENTER DISTANCE MANUALLY";

  const presetRowsHTML = ENT_PRESETS.map(p => `
<div class="en-row">
  <div class="en-row-accent"></div>
  <div class="en-row-label">
    <span class="en-wname">${p.label}</span>
    <span class="en-wsub">${p.sublabel}</span>
  </div>
  <div class="en-row-speed">${warpToC_TOS(p.value).toFixed(0)}c</div>
  <div class="en-row-time" id="preset-time-${p.value.toString().replace(".","_")}">—</div>
  <button class="en-sendbtn" data-warp="${p.value}">SEND</button>
</div>`).join("");

  return `
<style>
  .en-wrap{background:linear-gradient(180deg,#2c2c2e 0%,#1e1e20 50%,#161618 100%);font-family:"Helvetica Neue",Arial,sans-serif;color:#cc8833;overflow:hidden;border-bottom:3px solid #0a0a0a;}
  .en-wrap *{box-sizing:border-box;}

  /* Header */
  .en-head{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(180deg,#1a1a1c 0%,#111113 100%);border-bottom:2px solid #0a0a0a;padding:10px 16px;}
  .en-head-title{font-size:0.95em;font-weight:700;color:#cc8833;letter-spacing:0.1em;text-transform:uppercase;}
  .en-head-sub{font-size:0.6em;color:#555;letter-spacing:0.1em;margin-top:2px;}
  .en-head-badge{background:#111;border:1px solid #333;border-radius:3px;padding:4px 10px;text-align:right;}
  .en-head-badge-label{font-size:0.52em;color:#555;letter-spacing:0.12em;display:block;}
  .en-head-badge-val{font-family:"Courier New",monospace;font-size:0.8em;color:#dd9944;letter-spacing:0.04em;}

  /* Route */
  .en-route{background:#111113;padding:7px 16px;border-bottom:1px solid #0a0a0a;}
  .en-route-lbl{font-size:0.62em;color:#555;letter-spacing:0.12em;margin-bottom:2px;}
  .en-route-name{font-family:"Courier New",monospace;color:#dd9944;font-size:1.2em;letter-spacing:0.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 0 8px rgba(200,140,40,0.4);}
  .en-arrow{color:#886622;margin:0 8px;}

  /* Distance block */
  .en-dist-block{display:flex;border-bottom:1px solid #0a0a0a;}
  .en-dist-bar{background:#3a3a3e;width:6px;flex-shrink:0;border-right:1px solid #0a0a0a;}
  .en-dist-inner{padding:8px 16px;flex:1;}
  .en-dist-lbl{font-size:0.62em;color:#555;letter-spacing:0.12em;margin-bottom:3px;}
  .en-dist-row{display:flex;align-items:center;gap:10px;}
  .en-dist-val{font-family:"Courier New",monospace;color:#dd9944;font-size:1.8em;flex-shrink:0;text-shadow:0 0 8px rgba(200,140,40,0.4);}
  .en-dist-unit{color:#886622;font-size:0.6em;margin-left:5px;}
  .en-dist-sub{color:#333;font-size:0.62em;letter-spacing:0.08em;margin-top:3px;}
  .en-dist-override{flex:1;min-width:0;background:#111;border:1px solid #333;color:#cc8833;font-family:"Courier New",monospace;font-size:1em;padding:5px 10px;border-radius:3px;text-align:center;}
  .en-dist-override:focus{outline:none;border-color:#cc8833;}
  .en-dist-override.active{border-color:#dd9944;background:#0d0c0a;}
  .en-dist-override-lbl{color:#2a2a2a;font-size:0.6em;letter-spacing:0.08em;margin-top:2px;}

  /* Section divider */
  .en-sec{display:flex;align-items:center;gap:8px;padding:5px 16px 3px;background:#1e1e20;border-top:1px solid #0a0a0a;border-bottom:1px solid #0a0a0a;}
  .en-strut{width:20px;height:1px;background:linear-gradient(90deg,#111 0%,#333 100%);flex-shrink:0;}
  .en-sec-txt{color:#555;font-size:0.62em;letter-spacing:0.14em;font-weight:700;white-space:nowrap;}

  /* Warp panel */
  .en-warp-panel{display:flex;align-items:stretch;border-bottom:1px solid #0a0a0a;}
  .en-presets{flex:1;min-width:0;border-right:2px solid #0a0a0a;}
  .en-row{display:flex;align-items:center;border-bottom:1px solid #111;height:40px;background:linear-gradient(180deg,#252528 0%,#1e1e20 100%);}
  .en-row:last-child{border-bottom:none;}
  .en-row:hover{background:linear-gradient(180deg,#303035 0%,#252528 100%);}
  .en-row-accent{background:#3a3a3e;width:4px;align-self:stretch;flex-shrink:0;border-right:1px solid #0a0a0a;}
  .en-row-label{width:160px;padding:0 12px;flex-shrink:0;display:flex;align-items:center;gap:8px;}
  .en-wname{color:#cc8833;font-size:0.9em;font-weight:700;letter-spacing:0.08em;white-space:nowrap;}
  .en-wsub{color:#443322;font-size:0.58em;letter-spacing:0.08em;white-space:nowrap;}
  .en-row-speed{width:56px;color:#555;font-size:0.65em;letter-spacing:0.06em;flex-shrink:0;text-align:right;padding-right:8px;font-family:"Courier New",monospace;}
  .en-row-time{flex:1;font-family:"Courier New",monospace;color:#aa6622;font-size:0.9em;letter-spacing:0.04em;padding:0 10px;white-space:nowrap;}
  .en-sendbtn{flex-shrink:0;width:62px;background:linear-gradient(180deg,#3a3a3e 0%,#252528 100%);border:1px solid #4a4a4e;color:#cc8833;font-family:"Helvetica Neue",Arial,sans-serif;font-size:0.65em;font-weight:700;letter-spacing:0.1em;padding:5px 0;margin:0 10px;border-radius:3px;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 1px 3px rgba(0,0,0,0.5);}
  .en-sendbtn:hover{background:linear-gradient(180deg,#4a4a50 0%,#303035 100%);color:#dd9944;border-color:#cc8833;}

  /* Custom sidebar */
  .en-custom-panel{width:240px;flex-shrink:0;background:linear-gradient(180deg,#1e1e20 0%,#161618 100%);display:flex;flex-direction:column;padding:12px 14px;gap:10px;border-left:1px solid #0a0a0a;}
  .en-custom-lbl{color:#555;font-size:0.62em;letter-spacing:0.14em;font-weight:700;}
  .en-pills{display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;}
  .en-pill{background:linear-gradient(180deg,#3a3a3e 0%,#252528 100%);border:1px solid #4a4a4e;color:#886622;font-family:"Helvetica Neue",Arial,sans-serif;font-size:0.62em;font-weight:700;letter-spacing:0.08em;padding:3px 8px;border-radius:3px;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);}
  .en-pill:hover{color:#cc8833;border-color:#cc8833;background:linear-gradient(180deg,#4a4a50 0%,#303035 100%);}
  .en-num-input{width:100%;background:#111;border:1px solid #cc8833;color:#dd9944;font-family:"Courier New",monospace;font-size:1.1em;letter-spacing:0.04em;padding:7px;border-radius:3px;text-align:center;}
  .en-num-input:focus{outline:none;border-color:#dd9944;}
  .en-cresult{font-family:"Courier New",monospace;color:#aa6622;font-size:0.82em;line-height:1.5;min-height:1.5em;}
  .en-cresult .cr-warp{color:#cc8833;}
  .en-cresult .cr-c{color:#443322;font-size:0.85em;}
  .en-mainbtn{width:100%;background:linear-gradient(180deg,#3a3a3e 0%,#252528 100%);border:1px solid #cc8833;color:#cc8833;font-family:"Helvetica Neue",Arial,sans-serif;font-size:0.75em;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:9px;border-radius:3px;cursor:pointer;margin-top:auto;box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 1px 3px rgba(0,0,0,0.5);}
  .en-mainbtn:hover{background:linear-gradient(180deg,#4a4a50 0%,#303035 100%);color:#dd9944;border-color:#dd9944;}

  /* Stardate block */
  .en-sd-block{padding:6px 16px 10px;border-top:1px solid #0a0a0a;background:#1e1e20;}
  .en-sd-row{display:flex;align-items:center;gap:10px;margin-top:6px;}
  .en-sd-input{flex:1;min-width:0;background:#111;border:1px solid #443322;color:#dd9944;font-family:"Courier New",monospace;font-size:1em;letter-spacing:0.04em;padding:6px 10px;border-radius:3px;text-align:center;text-shadow:0 0 6px rgba(200,140,40,0.3);}
  .en-sd-input:focus{outline:none;border-color:#cc8833;}
  .en-sd-arrow{color:#443322;font-size:1.2em;flex-shrink:0;}
  .en-sd-arrival{flex:1;min-width:0;background:#111;border:1px solid #222;color:#555;font-family:"Courier New",monospace;font-size:1em;letter-spacing:0.04em;padding:6px 10px;border-radius:3px;text-align:center;}
  .en-sd-labels{display:flex;gap:10px;margin-top:3px;}
  .en-sd-label{flex:1;color:#2a2a2a;font-size:0.58em;letter-spacing:0.1em;text-align:center;text-transform:uppercase;}
  .en-sd-hint{color:#222;font-size:0.58em;letter-spacing:0.06em;margin-top:4px;}

  /* Footer */
  .en-foot{background:linear-gradient(180deg,#1a1a1c 0%,#111113 100%);border-top:2px solid #0a0a0a;padding:6px 16px;display:flex;justify-content:space-between;align-items:center;}
  .en-foot-l{color:#333;font-size:0.58em;letter-spacing:0.1em;font-weight:600;}
  .en-foot-r{color:#333;font-size:0.58em;letter-spacing:0.08em;}
</style>

<div class="en-wrap" id="en-wrap">

  <div class="en-head">
    <div>
      <div class="en-head-title">Navigational Analysis</div>
      <div class="en-head-sub">Earth Starfleet &mdash; UESPA Warp Navigation</div>
    </div>
    <div class="en-head-badge">
      <span class="en-head-badge-label">WARP FORMULA</span>
      <span class="en-head-badge-val">N³ × C</span>
    </div>
  </div>

  <div class="en-route">
    <div class="en-route-lbl">Destination Route</div>
    <div class="en-route-name">
      ${nameShip.toUpperCase()}<span class="en-arrow">▶</span>${nameDest.toUpperCase()}
    </div>
  </div>

  <div class="en-dist-block">
    <div class="en-dist-bar"></div>
    <div class="en-dist-inner">
      <div class="en-dist-lbl">Distance</div>
      <div class="en-dist-row">
        <div class="en-dist-val" id="dist-display">
          ${tokenDistStr ? `${tokenDistStr}<span class="en-dist-unit">LY</span>` : `<span style="color:#222;font-size:0.7em;">——</span>`}
        </div>
        <input class="en-dist-override" type="number" id="dist-override" placeholder="manual LY" min="0.01" step="0.01" />
      </div>
      <div class="en-dist-sub" id="dist-sub">${tokenSubStat}</div>
      <div class="en-dist-override-lbl" id="dist-override-lbl">Override: type to force manual distance</div>
    </div>
  </div>

  <div class="en-sec">
    <div class="en-strut"></div>
    <div class="en-sec-txt">Warp Factors</div>
    <div class="en-strut"></div>
  </div>

  <div class="en-warp-panel">
    <div class="en-presets">${presetRowsHTML}</div>
    <div class="en-custom-panel">
      <div>
        <div class="en-custom-lbl">Custom Warp</div>
        <div class="en-pills">
          ${ENT_PRESETS.map(p => `<span class="en-pill" data-warp="${p.value}">${p.value}</span>`).join("")}
        </div>
      </div>
      <input class="en-num-input" type="number" id="custom-warp" min="0.1" max="7" step="0.1" value="4" />
      <div class="en-cresult" id="custom-result">—</div>
      <button class="en-mainbtn" id="custom-chat-btn">Send</button>
    </div>
  </div>

  <div class="en-sd-block">
    <div class="en-sec-txt">Date</div>
    <div class="en-sd-row">
      <input class="en-sd-input" type="date" id="date-input" />
      <div class="en-sd-arrow">▶</div>
      <div class="en-sd-arrival" id="sd-arrival">——</div>
    </div>
    <div class="en-sd-labels">
      <div class="en-sd-label">Departure Date</div>
      <div style="width:16px;flex-shrink:0;"></div>
      <div class="en-sd-label">Arrival Date</div>
    </div>
    <div class="en-sd-hint">Arrival updates with selected warp factor · leave blank to omit from chat</div>
  </div>

  <div class="en-foot">
    <div class="en-foot-l">Earth Starfleet &mdash; UESPA Navigation</div>
    <div class="en-foot-r">Cochrane Warp Drive Mk IV</div>
  </div>

</div>`;
}

// ENT render fn — local fallback chat card in gunmetal/amber style
function makeENTRenderFn(ctx) {
  const { nameShip, nameDest, tokenDistance3D, tokenFlatDistance, tokenElevDiff } = ctx;

  const tokenSubStat = tokenDistance3D !== null
    ? `Flat: ${tokenFlatDistance.toFixed(2)} LY${tokenElevDiff > 0.001 ? `  |  Z: ${tokenElevDiff.toFixed(2)} LY` : ""}`
    : "No destination token — enter distance manually";

  return (html) => {
    const warpInput    = html.find("#custom-warp");
    const customResult = html.find("#custom-result");
    const chatBtn      = html.find("#custom-chat-btn");
    const dateInput    = html.find("#date-input");
    const sdArrival    = html.find("#sd-arrival");
    const distOverride = html.find("#dist-override");
    const distDisplay  = html.find("#dist-display");
    const distSub      = html.find("#dist-sub");
    const distOvLbl    = html.find("#dist-override-lbl");

    // Populate date from active campaign's calendarDate
    if (game.sta2eToolkit) {
      const campaign = game.sta2eToolkit.getActiveCampaign?.();
      if (campaign?.calendarDate) dateInput.val(campaign.calendarDate);
    }

    let cWarp = 4, cSpeed = warpToC_TOS(4), cTime = null;

    function getActiveDistance() {
      const ov = parseFloat(distOverride.val());
      return (!isNaN(ov) && ov > 0) ? ov : tokenDistance3D;
    }
    function getCurrentDate()    { return dateInput.val(); }   // ISO string e.g. "2152-03-14"
    function formatDateDisplay(iso) {
      if (!iso) return null;
      const [y, m, d] = iso.split("-");
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${d} ${months[parseInt(m,10)-1]} ${y}`;
    }
    function calcArrivalDate(isoDate, travelTimeYears) {
      if (!isoDate) return null;
      const [y, m, d] = isoDate.split("-").map(Number);
      const totalDays  = travelTimeYears * 365.25;
      const depMs      = Date.UTC(y, m - 1, d);
      const arrMs      = depMs + totalDays * 86400000;
      const arr        = new Date(arrMs);
      return `${arr.getUTCFullYear()}-${String(arr.getUTCMonth()+1).padStart(2,"0")}-${String(arr.getUTCDate()).padStart(2,"0")}`;
    }

    function updateArrivalDisplay() {
      const iso = getCurrentDate();
      if (!iso || !cTime) { sdArrival.text("——").css("color", "#555"); return; }
      const arrISO = calcArrivalDate(iso, cTime.totalYears);
      sdArrival.text(formatDateDisplay(arrISO) ?? "——").css("color", "#dd9944");
    }

    function updatePresetRows(dist) {
      ENT_PRESETS.forEach(p => {
        const t = calcTravelTime(dist, warpToC_TOS(p.value));
        html.find(`#preset-time-${p.value.toString().replace(".","_")}`).text(formatTimeShort(t));
      });
    }

    function updateAll() {
      const dist = getActiveDistance();
      const w    = parseFloat(warpInput.val());
      cWarp = w; cSpeed = warpToC_TOS(w); cTime = calcTravelTime(dist, cSpeed);
      updatePresetRows(dist);
      customResult.html(!w || w <= 0 ? "—"
        : `<span class="cr-warp">Warp ${w}</span> <span class="cr-c">(${cSpeed.toFixed(1)}c)</span><br>${formatTimeShort(cTime)}`);
      updateArrivalDisplay();
    }

    distOverride.on("input", function() {
      const ov = parseFloat($(this).val());
      if (!isNaN(ov) && ov > 0) {
        distDisplay.html(`${ov.toFixed(2)}<span style="color:#886622;font-size:0.6em;margin-left:5px;">LY</span> <span style="color:#555;font-size:0.45em;">MANUAL</span>`);
        distSub.html("Token distance overridden").css("color", "#886622");
        distOvLbl.css("color", "#886622");
        $(this).addClass("active");
      } else {
        if (tokenDistance3D !== null) {
          distDisplay.html(`${tokenDistance3D.toFixed(2)}<span style="color:#886622;font-size:0.6em;margin-left:5px;">LY</span>`);
          distSub.html(tokenSubStat).css("color", "#333");
        } else {
          distDisplay.html(`<span style="color:#222;font-size:0.7em;">——</span>`);
          distSub.html("No destination token — enter distance manually").css("color", "#333");
        }
        distOvLbl.css("color", "#2a2a2a");
        $(this).removeClass("active");
      }
      updateAll();
    });

    warpInput.on("input", updateAll);
    dateInput.on("change", updateArrivalDisplay);
    html.find(".en-pill").on("click", function() { warpInput.val($(this).data("warp")); updateAll(); });

    function entLocalCard(warp, speedC, t, depISO, arrISO, dist) {
      const hasDate = depISO?.trim();
      const dateRow = hasDate && arrISO ? `
  <tr style="border-top:1px solid #111;">
    <td style="padding:0;width:5px;background:#3a3a3e;"></td>
    <td style="padding:7px 12px;">
      <div style="color:#555;font-size:0.52em;letter-spacing:0.12em;margin-bottom:3px;text-transform:uppercase;">Date</div>
      <div style="display:flex;align-items:center;gap:14px;">
        <div><div style="color:#555;font-size:0.54em;letter-spacing:0.1em;">Departure</div><div style="font-family:'Courier New',monospace;color:#dd9944;font-size:0.9em;letter-spacing:0.04em;text-shadow:0 0 6px rgba(200,140,40,0.4);">${formatDateDisplay(depISO)}</div></div>
        <div style="color:#443322;font-size:1.1em;">▶</div>
        <div><div style="color:#555;font-size:0.54em;letter-spacing:0.1em;">Arrival</div><div style="font-family:'Courier New',monospace;color:#dd9944;font-size:0.9em;letter-spacing:0.04em;text-shadow:0 0 6px rgba(200,140,40,0.4);">${formatDateDisplay(arrISO)}</div></div>
      </div>
    </td>
  </tr>` : "";
      ChatMessage.create({ content: `
<div style="background:linear-gradient(180deg,#2c2c2e 0%,#1e1e20 100%);border:1px solid #111;border-top:none;border-bottom:3px solid #0a0a0a;border-radius:0 0 5px 5px;font-family:'Helvetica Neue',Arial,sans-serif;max-width:420px;overflow:hidden;">
  <div style="background:linear-gradient(180deg,#1a1a1c 0%,#111113 100%);padding:9px 14px;border-bottom:2px solid #0a0a0a;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="color:#cc8833;font-size:0.72em;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">UESPA Navigational Analysis</div>
      <div style="font-family:'Courier New',monospace;color:#dd9944;font-size:0.9em;letter-spacing:0.04em;margin-top:3px;text-shadow:0 0 6px rgba(200,140,40,0.4);">${nameShip.toUpperCase()} <span style="color:#443322;">▶</span> ${nameDest.toUpperCase()}</div>
    </div>
    ${hasDate ? `<div style="background:#111;border:1px solid #333;border-radius:3px;padding:3px 8px;text-align:right;"><div style="color:#555;font-size:0.48em;letter-spacing:0.12em;display:block;">DATE</div><span style="font-family:'Courier New',monospace;color:#dd9944;font-size:0.8em;letter-spacing:0.04em;">${formatDateDisplay(depISO)}</span></div>` : ""}
  </div>
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:0;width:5px;background:#3a3a3e;"></td>
      <td style="padding:7px 12px;">
        <div style="color:#555;font-size:0.52em;letter-spacing:0.12em;margin-bottom:2px;text-transform:uppercase;">Distance</div>
        <div style="font-family:'Courier New',monospace;color:#dd9944;font-size:1em;letter-spacing:0.04em;text-shadow:0 0 6px rgba(200,140,40,0.4);">${dist.toFixed(2)} <span style="color:#886622;font-size:0.65em;">LIGHT YEARS</span></div>
      </td>
    </tr>
    <tr style="border-top:1px solid #111;">
      <td style="padding:0;width:5px;background:#4a4a3a;"></td>
      <td style="padding:7px 12px;">
        <div style="color:#555;font-size:0.52em;letter-spacing:0.12em;margin-bottom:2px;text-transform:uppercase;">Travel Time</div>
        <div style="color:#aa6622;font-size:0.92em;font-family:'Courier New',monospace;letter-spacing:0.04em;">${formatTimeFull(t, warp, speedC)}</div>
      </td>
    </tr>
    ${dateRow}
  </table>
  <div style="background:linear-gradient(180deg,#1a1a1c 0%,#111113 100%);border-top:2px solid #0a0a0a;padding:5px 14px;display:flex;justify-content:space-between;">
    <div style="color:#2a2a2a;font-size:0.52em;letter-spacing:0.1em;text-transform:uppercase;">Earth Starfleet · UESPA</div>
    <div style="color:#2a2a2a;font-size:0.52em;letter-spacing:0.08em;">Cochrane Warp Drive Mk IV</div>
  </div>
</div>`, speaker: ChatMessage.getSpeaker() });
    }

    async function sendPreset(w) {
      const dist = getActiveDistance();
      if (!dist) return ui.notifications.warn("STA 2e Toolkit: No distance set.");
      const s = warpToC_TOS(w), t = calcTravelTime(dist, s);
      const depISO = getCurrentDate();
      const arrISO = calcArrivalDate(depISO, t.totalYears);
      await postCard(
        { shipName: nameShip, destination: nameDest, warpFactor: w, speedC: s, distanceLY: dist,
          travelTime: { years: t.years ?? 0, days: t.days, hours: t.hours, minutes: t.minutes } },
        () => entLocalCard(w, s, t, depISO, arrISO, dist)
      );
    }

    async function sendCustom() {
      const dist = getActiveDistance();
      if (!dist || !cTime) return ui.notifications.warn("STA 2e Toolkit: No distance or warp set.");
      const depISO = getCurrentDate();
      const arrISO = calcArrivalDate(depISO, cTime.totalYears);
      await postCard(
        { shipName: nameShip, destination: nameDest, warpFactor: cWarp, speedC: cSpeed, distanceLY: dist,
          travelTime: { years: cTime.years ?? 0, days: cTime.days, hours: cTime.hours, minutes: cTime.minutes } },
        () => entLocalCard(cWarp, cSpeed, cTime, depISO, arrISO, dist)
      );
    }

    html.find(".en-sendbtn").on("click", async function() { await sendPreset(parseFloat($(this).data("warp"))); });
    chatBtn.on("click", async () => { await sendCustom(); });

    updateAll();
  };
}

// ============================================================
// Public entry point
// ============================================================

export function openWarpCalc() {
  const { DialogV2 } = foundry.applications.api;

  const campaign = game.sta2eToolkit?.getActiveCampaign?.();
  const theme    = campaign?.theme ?? game.settings.get("sta2e-toolkit", "hudTheme") ?? "blue";

  const ctx = getTokenContext();

  // Helper: open a DialogV2, forwarding the jQuery-wrapped element to the
  // existing render function so all event-handler code stays unchanged.
  // We override _renderHTML to return the raw HTML directly, bypassing the
  // Handlebars dialog template which strips <style> blocks from the content.
  const _open = (title, rawContent, _closeLabel, renderFn) => {
    const dlg = new (class extends DialogV2 {
      async _renderHTML(context, options) { return rawContent; }
      _replaceHTML(result, element, options) {
        (element.querySelector(".window-content") ?? element).innerHTML = result;
      }
      _onRender(context, options) {
        super._onRender(context, options);
        renderFn($(this.element));
      }
    })({
      window:   { title },
      buttons:  [{ action: "close", label: "Close", default: true }],
      position: { width: BASE_WIDTH },
      resizable: true,
      classes:  ["dialog"],
      rejectClose: false,
    });
    dlg.render(true);
  };

  if (theme === "ent-panel") {
    _open("UESPA — Warp Navigation",       buildENTContent(ctx),   null, makeENTRenderFn(ctx));
  } else if (theme === "tos-panel" || theme === "tmp-console") {
    _open("Warp Navigation — TOS/TMP Era", buildTOSContent(ctx),   null,
      makeRenderFn({ prefix: "tw", warpToC: warpToC_TOS, presets: TOS_PRESETS, defaultWarp: 6, ctx }));
  } else {
    _open("LCARS — Warp Navigation",       buildLCARSContent(ctx), null,
      makeRenderFn({ prefix: "lc", warpToC: warpToC_TNG, presets: TNG_PRESETS, defaultWarp: 9, ctx }));
  }
}
