// node tests/tmp-monitor-cards.mjs [--preview out.html]
//
// The TMP Monitor theme (`tmp-monitor`) on the two card renderers it shares
// with TMP Console: task-card-tmp.js and chat-card-frame.js's TMP frame. It
// checks what the monitor variant adds — the modifier classes, the code tab and
// ticks, outlined keys with an inline border colour — and that it keeps the TMP
// card's DOM contract and leaves TMP Console exactly as it was. The view builder
// is tests/tmp-cards.mjs's, trimmed; that file covers the contract in full.
//
// --preview writes a page rendering the monitor states against the real
// stylesheets, with the bundled fonts inlined.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let theme = 'tmp-monitor';
globalThis.game = { settings: { get: (_m, key) => key === 'hudTheme' ? theme : undefined } };

const { renderTmpTaskCard } = await import('../scripts/task-card-tmp.js');
const { lcarsChatCard } = await import('../scripts/chat-card-frame.js');

let D20 = 'icons/svg/d20-grey.svg';
const diceRow = (dice, pool = 'crew', opts = {}) => {
  const size = opts.size ?? 32;
  return `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;">${dice.map((d, i) => {
    const col = d.success ? '#00d27a' : d.complication ? '#e82938' : '#aaaaaa';
    const lbl = d.crit
      ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;"><span style="font-size:8px;letter-spacing:-1px;">★★</span><span style="font-size:12px;">${d.value}</span></span>`
      : `<span style="font-size:12px;">${d.value}</span>`;
    return `<span class="sta2e-card-die" data-pool="${pool}" data-index="${i}" style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;">`
      + `<img src="${D20}" style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;opacity:0.2;" alt=""/>`
      + `<span style="position:relative;z-index:1;color:${col};font-weight:700;">${lbl}</span></span>`;
  }).join('')}</div>`;
};
const renderResourceTokens = (label, count) => count ? `<span style="font-size:9px;color:#0d7c4c;">${label} ×${count}</span>` : '';
const rerollButtonBody = rb => `<span class="sta2e-rr-name">${rb.label}</span>${rb.cost ? `<span class="sta2e-rr-cost">${rb.cost}</span>` : ''}`;

function view(over = {}, roll = {}) {
  return {
    rollData: {
      taskLabel: 'Fire Phasers', officerName: 'Cmdr. Sulu',
      crewDice: [{ value: 1, success: true, crit: true }, { value: 9, success: true }, { value: 15 }],
      shipDice: [{ value: 7, success: true }], apAssistDice: [], pendingAssists: [],
      confirmed: false, isAssistRoll: false, crewTarget: 12, ...roll,
    },
    diceRow, renderResourceTokens, rerollButtonBody, p: 'PAYLOAD',
    passed: true, finalResultLabel: 'Success',
    contextLeftLabel: 'Cmdr. Sulu', contextRightLabel: 'Comp Range 20',
    crewDiceHeading: 'Control + Security (target: 12)',
    shipDiceHeading: 'Enterprise · Weapons + Security · (target: 10)',
    namedAssistBlocks: [],
    noteStrips: [{ tone: 'bonus', text: 'Call Out Targets: +1 bonus Momentum on success' }],
    traitNotes: [],
    statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'PASS', '']],
    interactiveActive: true, spentVisible: false, spentGroups: [],
    gained: { visible: false }, poolButton: { visible: false },
    showMakeYourOwnLuck: false,
    rerollButtons: [
      { ability: 'detReroll', label: 'Spend Determination', labelShort: 'Reroll Dice', cost: 'Multiple dice' },
      { ability: 'ts', label: 'Targeting Solution', labelShort: 'Reroll a Die' },
    ],
    canGmEditCard: true, confirmLabel: 'Resolve HIT (4 succ.)',
    succeedAtCostButton: { visible: false },
    ...over,
  };
}

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

const working = renderTmpTaskCard(view());

check('task card: TMP root plus the monitor modifier, and the tab colour', () => {
  assert.match(working, /class="sta2e-task-card sta2e-task-card--tmp sta2e-task-card--tmpmon" data-theme="tmp-monitor"/);
  assert.match(working, /--tmm-tab:#00aef0;/);
});

check('task card: code tab and ticks replace the plate and the tag', () => {
  assert.match(working, /<span class="tmc-code">T-12<\/span>/);
  assert.match(working, /class="tmc-ticks"/);
  assert.doesNotMatch(working, /class="tmc-(plate|tag)"/);
});

check('task card: keys are outlined or filled with an inline border colour, no radius', () => {
  for (const tag of working.match(/<button\b[^>]*>/g)) {
    assert.match(tag, /style="background:(transparent|#[0-9a-f]{6});border-color:#[0-9a-f]{6};color:#[0-9a-f]{6};"/);
    assert.doesNotMatch(tag, /border-radius|linear-gradient/);
  }
  assert.match(working, /class="sta2e-player-confirm[^"]*"[^>]*style="background:#00d27a;border-color:#00d27a;color:#000000;"/);
});

check('task card: the TMP contract is unchanged (wrappers, dice, data-filled)', () => {
  assert.match(working, /class="sta2e-working-actions sta2e-working-actions--rerolls tmc-bed"/);
  assert.match(working, /class="tmc-btns sta2e-task-rerolls"/);
  assert.equal((working.match(/class="sta2e-card-die"[^>]*>\s*<img/g) ?? []).length, 4);
  for (const tag of working.match(/<button class="sta2e-player-reroll[^>]*>/g)) assert.match(tag, /data-filled="1"/);
});

check('task card: pass, fail and assist codes', () => {
  assert.match(renderTmpTaskCard(view({}, { confirmed: true })), /tmc-code">OK</);
  assert.match(renderTmpTaskCard(view({ passed: false, finalResultLabel: 'Failed' }, { confirmed: true })), /tmc-code">NEG<[\s\S]*--tmm-tab:#ed2f76;|--tmm-tab:#ed2f76;[\s\S]*tmc-code">NEG</);
  assert.match(renderTmpTaskCard(view({}, { isAssistRoll: true, assistOfficerName: 'Lt. Uhura' })), /tmc-code">AST</);
});

const body = `<div class="sta2e-damage-controls"><button class="sta2e-apply-damage" style="border:1px solid #e82938;color:#e82938;">Apply</button></div>`;
const legacy = () => '<div class="legacy">old</div>';
const framed = lcarsChatCard({ title: 'Phaser Hit', accent: '#e82938', body, legacy });

check('chat frame: the TMP frame plus the monitor modifier and ticks, buttons keyified', () => {
  assert.match(framed, /class="sta2e-chat-card sta2e-chat-card--tmp sta2e-chat-card--tmpmon"\s+data-theme="tmp-monitor"/);
  assert.match(framed, /class="ccf-tmp-ticks"/);
  assert.match(framed, /<button class="sta2e-apply-damage" style="--tck-a:#e82938;--tck-ink:#fff4ee;">/);
});

check('TMP Console is unchanged: no modifier, no code tab, lens keys', () => {
  theme = 'tmp-console';
  const card = renderTmpTaskCard(view());
  assert.match(card, /class="sta2e-task-card sta2e-task-card--tmp" data-theme="tmp-console"/);
  assert.doesNotMatch(card, /tmpmon|tmc-code|tmc-ticks|--tmm-tab/);
  assert.match(card, /<button class="sta2e-player-confirm[^>]*style="background:linear-gradient/);
  const chat = lcarsChatCard({ title: 'T', accent: '#e82938', body, legacy });
  assert.doesNotMatch(chat, /tmpmon|ccf-tmp-ticks/);
  theme = 'tmp-monitor';
});

for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);

// ── Optional preview page ────────────────────────────────────────────────────
const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  const out = path.resolve(process.argv[pi + 1]);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  D20 = `data:image/svg+xml;base64,${fs.readFileSync('C:/Program Files/Foundry Virtual Tabletop/resources/app/public/icons/svg/d20-grey.svg').toString('base64')}`;
  const css = ['task-card.css', 'task-card-tmp.css', 'chat-card.css', 'tmp-monitor.css', 'stardate-hud.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/tmp\/([^"]+)"\)/g,
      (_, f) => `url("data:font/woff2;base64,${fs.readFileSync(`${root}/fonts/tmp/${f}`).toString('base64')}")`);
  // The reroll tray exactly as _armCardSelection injects it, with the TMP tokens.
  const tray = `<div class="sta2e-reroll-tray" style="margin-top:5px;padding:5px 6px;background:rgba(255,255,255,0.04);border:1px solid #e9e95a;border-radius:var(--tcx-tray-radius, 10px);">
    <div style="font-size:8px;color:#e9e95a;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:5px;text-align:center;">Targeting Solution: pick 1 die to reroll</div>
    <div style="display:flex;gap:5px;"><button type="button" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.06);border:1px solid #e9e95a;color:#e9e95a;font-size:10px;">Reroll Selected</button>
    <button type="button" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.03);border:1px solid #0d7c4c;color:#0d7c4c;font-size:10px;">Cancel</button></div></div>`;
  const armed = renderTmpTaskCard(view({ passed: false, statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'FAIL', '']], confirmLabel: 'Confirm Results (1 success)' },
    { taskLabel: 'Evasive Action', shipDice: [], crewDice: [{ value: 14 }, { value: 3, success: true }] }))
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="ts"[^>]*style=")([^"]*)("[^>]*>)<span class="sta2e-rr-name">/,
      '$1$2background:#e9e95a;border-color:#e9e95a;color:#000000;$3<span class="sta2e-rr-name">▶ ')
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="detReroll"[^>]*style=")([^"]*)"/, '$1$2opacity:0.4;"')
    .replace(/(<div class="sta2e-working-actions sta2e-working-actions--rerolls[\s\S]*?<\/div>)(\s*<\/div>)/, `$1${tray}$2`);
  const hud = `<div class="sta2e-hud sta2e-tmp sta2e-theme-tmp-monitor sta2e-tmp--monitor"><div class="tmp__console-frame">
    <div class="tmp__id-stripe">SFHQ</div>
    <div class="tmp__oval-block"><div class="tmp__oval-label">VESSEL</div><select class="tmp__select"><option>USS Enterprise</option></select></div>
    <div class="tmp__oval-row"><button class="tmp__btn">-1D</button><button class="tmp__btn">-1H</button></div>
    <div class="tmp__display"><span class="tmp__display-label">STARDATE</span><span class="tmp__stardate">7412.6</span><span class="tmp__sep">·</span><span class="tmp__time">14:30</span></div>
    <div class="tmp__oval-row"><button class="tmp__btn">+1H</button><button class="tmp__btn">+1D</button></div>
    <div class="tmp__oval-row"><button class="tmp__btn tmp__btn--pin-active">PIN</button><button class="tmp__btn tmp__btn--alt">WRP</button><button class="tmp__btn tmp__btn--alt">EDT</button><button class="tmp__btn">CFG</button></div>
  </div></div>`;
  const cards = [
    ['Working', working],
    ['A reroll armed', armed],
    ['Confirmed, Momentum to bank', renderTmpTaskCard(view({
      poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: '', label: 'Add Momentum to Pool (+2)' }, noteStrips: [],
    }, { confirmed: true, shipDice: [] }))],
    ['Damage card (frame)', lcarsChatCard({ title: 'Phaser Hit', accent: '#e82938', legacy,
      body: `<div style="font-size:11px;color:#3df09d;">SHIELDS 9 → <b style="color:#e9e95a">4</b> / 12</div><div style="margin-top:6px;display:flex;gap:6px;">${['Apply Damage', 'Undo'].map((t, i) => `<button style="flex:1;border:1px solid ${i ? '#0d7c4c' : '#e82938'};color:${i ? '#0d7c4c' : '#e82938'};">${t}</button>`).join('')}</div>` })],
    ['Info card (frame)', lcarsChatCard({ title: 'Sensor Contact', accent: '#00aef0', legacy,
      body: '<div style="font-size:11px;color:#3df09d;">Bearing 047 mark 15 · Medium range</div>' })],
  ];
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>TMP Monitor cards</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.chat-message{width:300px;background:#0e0e11;padding:6px;border-radius:6px}
.chat-message button{height:2rem}h4{margin:0 0 4px;font-size:11px;color:#888}
.hudwrap{margin-bottom:18px}</style>
<h4>Calendar (Stardate HUD, GM)</h4><div class="hudwrap">${hud}</div>
<div class="grid">${cards.map(([t, h]) => `<div><h4>${t}</h4><div class="chat-message">${h}</div></div>`).join('')}</div>`);
  console.log(`preview: ${out}`);
}
process.exit(failed ? 1 : 0);
