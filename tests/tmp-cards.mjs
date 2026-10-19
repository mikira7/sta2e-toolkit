// node tests/tmp-cards.mjs [--preview out.html]
//
// The TMP Console Monitor skins: the working task card (task-card-tmp.js) and the
// chat card frame's TMP path (chat-card-frame.js). Checks the DOM contract the
// chat wiring depends on — the .sta2e-working-actions wrappers, the die markup,
// every button class and data-* attribute, data-filled on keys, no inline
// border-radius — and that the frame turns body buttons into lenses without
// losing their accent. Both modules import only lcars-theme.js, so they load
// under node with the theme setting stubbed. The sibling of tests/tos-cards.mjs.
//
// --preview writes a page rendering every state against the real stylesheets,
// with the bundled fonts inlined.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let theme = 'tmp-console';
globalThis.game = { settings: { get: (_m, key) => key === 'hudTheme' ? theme : undefined } };

const { renderTmpTaskCard } = await import('../scripts/task-card-tmp.js');
const { lcarsChatCard } = await import('../scripts/chat-card-frame.js');

// ── A view shaped like buildPlayerRollCardHtml's ──────────────────────────────
// diceRow mirrors the real one's DOM: a span per die with an <img> inside, and
// the same opts.size the skin passes.
const diceRow = (dice, pool = 'crew', opts = {}) => {
  const size = opts.size ?? 32;
  return `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;">${
    dice.map((d, i) => {
      const col = d.crit ? '#00d27a' : d.success ? '#00d27a' : d.complication ? '#e82938' : '#aaaaaa';
      const lbl = d.crit
        ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;"><span style="font-size:8px;letter-spacing:-1px;">★★</span><span style="font-size:12px;">${d.value}</span></span>`
        : `<span style="font-size:12px;">${d.value}</span>`;
      return `<span class="sta2e-card-die" data-pool="${pool}" data-index="${i}" style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;vertical-align:middle;">`
        + `<img src="${D20}" style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;opacity:0.2;pointer-events:none;" alt=""/>`
        + `<span style="position:relative;z-index:1;color:${col};font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;">${lbl}</span></span>`;
    }).join('')}</div>`;
};
let D20 = 'icons/svg/d20-grey.svg';
let TOKENS = { momentum: 'modules/sta2e-toolkit/assets/momentum.svg', threat: 'modules/sta2e-toolkit/assets/threat.svg' };
const renderResourceTokens = (label, count, type, color, size = 21) => {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return '';
  return `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="font-size:9px;color:#0d7c4c;font-weight:700;text-transform:uppercase;">${label}</span>`
    + `<span style="display:inline-flex;gap:3px;">${Array.from({ length: n }, () =>
      `<img src="${TOKENS[type]}" style="width:${size}px;height:${size}px;border-radius:50%;filter:drop-shadow(0 0 2px ${color});" />`).join('')}</span></span>`;
};
const rerollButtonBody = rb => `<span class="sta2e-rr-name">${rb.label}</span>${rb.cost ? `<span class="sta2e-rr-cost">${rb.cost}</span>` : ''}`;

function view(over = {}, roll = {}) {
  const rollData = {
    taskLabel: 'Fire Phasers', officerName: 'Cmdr. Sulu',
    crewDice: [{ value: 1, success: true, crit: true }, { value: 9, success: true }, { value: 15 }, { value: 20, complication: true }],
    shipDice: [{ value: 7, success: true }],
    apAssistDice: [{ value: 17 }],
    pendingAssists: [{ name: 'Lt. Chekov', type: 'direct' }],
    confirmed: false, isAssistRoll: false, crewTarget: 12,
    ...roll,
  };
  return {
    rollData, diceRow, renderResourceTokens, rerollButtonBody, p: 'PAYLOAD',
    passed: true, finalResultLabel: 'Success',
    contextLeftLabel: 'Cmdr. Sulu', contextRightLabel: 'Comp Range 19–20',
    crewDiceHeading: 'Control + Security (target: 12)',
    shipDiceHeading: 'USS Enterprise · Weapons + Security · (target: 10)',
    namedAssistBlocks: [{ die: { value: 4, success: true }, heading: 'Lt. Uhura — Assist Die', subHeading: 'Insight + Command' }],
    noteStrips: [
      { tone: 'warn', text: 'Assist dice may not be added: the crew die failed' },
      { tone: 'note', text: 'Persistent: +1 success, +1 complication' },
      { tone: 'bonus', text: 'Call Out Targets: +1 bonus Momentum on success' },
    ],
    traitNotes: [{ name: 'Nebula Interference', label: 'Difficulty', value: 1 }],
    statCells: [['Successes', 4, ''], ['Difficulty', 3, ''], ['Momentum', 1, ''], ['Complic.', 1, ''], ['Result', 'PASS', '']],
    interactiveActive: true, spentVisible: true,
    spentGroups: [['Momentum', 2, 'momentum', '#ed2f76'], ['Threat', 1, 'threat', '#e82938'], ['Personal Threat', 0, 'threat', '#00aef0']],
    gained: { visible: false },
    poolButton: { visible: false },
    showMakeYourOwnLuck: true,
    rerollButtons: [
      { ability: 'detReroll', label: 'Spend Determination', labelShort: 'Reroll Dice', cost: 'Multiple dice' },
      { ability: 'ts', label: 'Targeting Solution', labelShort: 'Reroll a Die' },
      { ability: 'chiefEngineer', label: 'Chief Engineer', labelShort: 'Spend 1 Momentum - Reroll a Die', cost: '1 Momentum' },
    ],
    canGmEditCard: true, confirmLabel: 'Resolve HIT (4 succ.)',
    succeedAtCostButton: { visible: true, label: 'Hit at Cost (+1 Complication)' },
    ...over,
  };
}

const results = [];
function check(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}
const count = (html, re) => (html.match(re) ?? []).length;
const segsOf = (html, label) => html.match(new RegExp(`<span>${label}</span><span class="tmc-segs"[^>]*>(.*?)</span>`))[1];

// ── Task card ──────────────────────────────────────────────────────────────
const working = renderTmpTaskCard(view());

check('root carries the task card class, the TMP class and the theme', () => {
  assert.match(working, /class="sta2e-task-card sta2e-task-card--tmp" data-theme="tmp-console"/);
  assert.match(working, /--tmc-plate:#e9c83a;/, 'a working card has the yellow plate');
});

check('every working block is rendered', () => {
  for (const text of ['Fire Phasers — Working', 'Lt. Uhura — Assist Die', 'Insight + Command', 'Helm — Attack Pattern',
    'USS Enterprise · Weapons + Security', 'TN 12', 'TN 10', 'Persistent', 'Call Out Targets', 'Nebula Interference: Difficulty (+1)',
    'Complic.', 'Spent', 'Pending Assists', 'Rerolls Available', 'Edit Results', 'Hit at Cost', 'Resolve HIT', 'Task Analysis']) {
    assert.ok(working.includes(text), `missing: ${text}`);
  }
});

check('dice keep pool and index, with an <img> inside each', () => {
  assert.equal(count(working, /class="sta2e-card-die" data-pool="crew"/g), 4);
  assert.equal(count(working, /data-pool="named-assist" data-index="0"/g), 1);
  assert.equal(count(working, /data-pool="ap-assist"/g), 1);
  assert.equal(count(working, /data-pool="ship"/g), 1);
  assert.equal(count(working, /class="sta2e-card-die"[^>]*>\s*<img/g), 7);
});

check('each action group sits in its own working-actions wrapper (the key bed)', () => {
  for (const m of ['assists', 'luck', 'rerolls', 'confirm']) {
    assert.match(working, new RegExp(`class="sta2e-working-actions sta2e-working-actions--${m} tmc-bed"`));
  }
  assert.match(working, /class="tmc-btns sta2e-task-rerolls"/, 'the reroll grid is the inner list, not the wrapper');
});

check('buttons keep their classes and data attributes', () => {
  assert.match(working, /class="sta2e-player-assist-roll[^"]*"\s+data-payload="PAYLOAD" data-assist-index="0"/);
  assert.match(working, /class="sta2e-make-own-luck[^"]*"\s+data-payload="PAYLOAD"/);
  assert.equal(count(working, /class="sta2e-player-reroll/g), 3);
  assert.match(working, /data-ability="chiefEngineer"\s+data-ability-label="Chief Engineer"/);
  assert.match(working, /<span class="sta2e-rr-name">Spend Determination<\/span><span class="sta2e-rr-cost">Multiple dice<\/span>/);
  assert.match(working, /class="sta2e-edit-roll-card[^"]*" data-payload="PAYLOAD"/);
  assert.match(working, /class="sta2e-succeed-at-cost[^"]*" data-payload="PAYLOAD"/);
  assert.match(working, /class="sta2e-player-confirm[^"]*" data-payload="PAYLOAD"/);
});

check('rerolls, luck and assists carry data-filled so arming lights the lens', () => {
  for (const tag of working.match(/<button class="sta2e-(player-reroll|make-own-luck|player-assist-roll)[^>]*>/g)) {
    assert.match(tag, /data-filled="1"/);
  }
});

check("a lens's colour is inline, and neither keys nor root carry an inline border-radius", () => {
  for (const tag of working.match(/<button\b[^>]*>/g)) {
    assert.match(tag, /style="background:linear-gradient\(180deg,[^"]*;color:#[0-9a-f]{6};"/);
    assert.doesNotMatch(tag, /border-radius/);
  }
  assert.doesNotMatch(working.match(/<div class="sta2e-task-card[^>]*>/)[0], /border-radius/);
});

check('meters: one per readout, complications marked, a segment lit per point', () => {
  assert.equal(count(working, /class="tmc-meter[ "]/g), 4);
  assert.match(working, /class="tmc-meter tmc-meter--cpx"><span>Complic\.<\/span>/);
  const succ = segsOf(working, 'Successes');
  assert.equal(count(succ, /<i>/g), 4, 'four lit');
  assert.equal(count(succ, /tmc-seg--off/g), 2, 'padded to six');
});

check('a large value caps its meter at ten segments', () => {
  const html = renderTmpTaskCard(view({ statCells: [['Successes', 14, ''], ['Result', 'PASS', '']] }));
  assert.equal(count(segsOf(html, 'Successes'), /<i/g), 10);
  assert.match(html, /<b>14<\/b>/);
});

check('confirmed card: pool button keeps its data, gained tokens show', () => {
  const html = renderTmpTaskCard(view({
    gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#cc4400', autoBanked: false },
    poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: 'T1', label: 'Add Momentum to Pool (+2)' },
    statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
  }, { confirmed: true, pendingAssists: [] }));
  assert.match(html, /Fire Phasers — Success/);
  assert.match(html, /--tmc-plate:#3aa060;/);
  assert.match(html, /--tmc-s:#00d27a;/, 'a passed card has a green monitor');
  assert.match(html, /class="sta2e-add-to-pool[^"]*"\s+data-pool="momentum"\s+data-amount="2"\s+data-token-id="T1"/);
  assert.match(html, /Gained/);
  assert.doesNotMatch(html, /sta2e-player-confirm|sta2e-player-reroll|sta2e-working-actions--assists/);
});

check('confirmed with nothing to bank shows Completed', () => {
  const html = renderTmpTaskCard(view({ poolButton: { visible: false } }, { confirmed: true }));
  assert.match(html, /class="sta2e-task-btn[^"]*"[^>]*>Completed</);
});

check('a failed card turns the plate red and the monitor magenta', () => {
  const html = renderTmpTaskCard(view({ passed: false, finalResultLabel: 'Failed' }, { confirmed: true }));
  assert.match(html, /--tmc-plate:#c8312a;/);
  assert.match(html, /--tmc-s:#ed2f76;/);
});

check('assist roll: Add to Task Roll, then Applied to', () => {
  const open = renderTmpTaskCard(view({}, { isAssistRoll: true, assistOfficerName: 'Lt. Uhura' }));
  assert.match(open, /Assist Roll — Lt. Uhura/);
  assert.match(open, /sta2e-working-actions--assist-apply/);
  assert.match(open, /class="sta2e-assist-to-roll[^"]*" data-payload="PAYLOAD"/);
  assert.doesNotMatch(open, /tmc-result|sta2e-player-confirm|sta2e-player-reroll/);
  const done = renderTmpTaskCard(view({}, { isAssistRoll: true, assistApplied: 'Fire Phasers' }));
  assert.match(done, /class="sta2e-task-btn[^"]*"[^>]*>Applied to: Fire Phasers</);
});

check('succeed at cost reads COST on the readout', () => {
  const html = renderTmpTaskCard(view({ statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'COST', '']] },
    { succeedAtCost: true }));
  assert.match(html, /tmc-result--cost"><strong>COST</);
});

// ── Chat card frame ─────────────────────────────────────────────────────────
const body = `<div class="sta2e-damage-controls">
  <button class="sta2e-apply-damage" data-x="1" style="flex:1;padding:4px;background:rgba(255,0,0,0.1);border:1px solid #e82938;border-radius:2px;color:#e82938;font-size:10px;">Apply</button>
  <button class="sta2e-undo" style="background:transparent;border:1px solid #00aef0;color:#00aef0;">Undo</button>
  <button class="sta2e-plain">Plain</button>
</div>`;
const legacy = () => '<div class="legacy">old</div>';
const framed = lcarsChatCard({ title: 'Phaser Hit', accent: '#e82938', body, legacy, rootClass: 'sta2e-momentum-tracker', attrs: 'data-pool="momentum"' });

check('TMP frame: panel, plate, monitor, root identity carried forward', () => {
  assert.match(framed, /class="sta2e-chat-card sta2e-chat-card--tmp sta2e-momentum-tracker" data-pool="momentum" data-theme="tmp-console"/);
  assert.match(framed, /--ccf-c:#e82938;/);
  assert.match(framed, /class="ccf-tmp-title">Phaser Hit</);
  assert.match(framed, /class="ccf-tmp-screen"><div class="ccf-body">/, 'the whole body sits on the monitor, in .ccf-body');
  assert.ok(framed.includes('class="sta2e-damage-controls"'), 'body classes pass through');
});

check('TMP frame: buttons become lenses in their own accent, layout kept', () => {
  const tags = framed.match(/<button\b[^>]*>/g);
  assert.equal(tags.length, 3);
  for (const t of tags) assert.doesNotMatch(t, /(?<![-\w])(background|border[-a-z]*|color)\s*:/);
  assert.match(tags[0], /style="--tck-a:#e82938;--tck-ink:#fff4ee;flex:1;padding:4px;/);
  assert.match(tags[0], /class="sta2e-apply-damage" data-x="1"/);
  assert.match(tags[1], /--tck-a:#00aef0;/);
  assert.match(tags[2], /^<button style="--tck-a:#00d27a;--tck-ink:#140e00;" class="sta2e-plain">$/, 'no colour falls back to the theme primary');
});

check('TOS and TNG keep their own frames, other eras their legacy markup', () => {
  theme = 'tos-panel';
  assert.match(lcarsChatCard({ title: 'T', body, legacy }), /sta2e-chat-card--tos/);
  theme = 'lcars-tng';
  const tng = lcarsChatCard({ title: 'T', body, legacy });
  assert.match(tng, /sta2e-chat-card--tng tbc/);
  assert.doesNotMatch(tng, /sta2e-chat-card--tmp|--tck-a/);
  theme = 'klingon';
  assert.equal(lcarsChatCard({ title: 'T', body, legacy }), legacy());
  theme = 'tmp-console';
});

for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);

// ── Optional preview page ────────────────────────────────────────────────────
const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  const out = path.resolve(process.argv[pi + 1]);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const uri = f => `data:image/svg+xml;base64,${fs.readFileSync(f).toString('base64')}`;
  D20 = uri('C:/Program Files/Foundry Virtual Tabletop/resources/app/public/icons/svg/d20-grey.svg');
  TOKENS = { momentum: uri(`${root}/assets/momentum.svg`), threat: uri(`${root}/assets/threat.svg`) };
  // The stylesheets name the fonts relative to styles/; inline them for the page.
  const css = ['task-card.css', 'task-card-tmp.css', 'chat-card.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/tmp\/([^"]+)"\)/g,
      (_, f) => `url("data:font/woff2;base64,${fs.readFileSync(`${root}/fonts/tmp/${f}`).toString('base64')}")`);
  // The reroll tray exactly as _armCardSelection injects it, with the TMP tokens.
  const tray = `<div class="sta2e-reroll-tray" style="margin-top:5px;padding:5px 6px;background:rgba(255,255,255,0.04);border:1px solid #e9e95a;border-radius:var(--tcx-tray-radius, 10px);font-family:'Arial Narrow',sans-serif;">
    <div style="font-size:8px;color:#e9e95a;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:5px;text-align:center;">Targeting Solution: pick 1 die to reroll</div>
    <div style="display:flex;gap:5px;">
      <button type="button" class="sta2e-tray-confirm" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.06);border:1px solid #e9e95a;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#e9e95a;">Reroll Selected</button>
      <button type="button" class="sta2e-tray-cancel" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.03);border:1px solid #0d7c4c;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#0d7c4c;">Cancel</button>
    </div></div>`;
  const armed = renderTmpTaskCard(view({ namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
    statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'FAIL', '']], passed: false,
    rerollButtons: view().rerollButtons.slice(0, 2), confirmLabel: 'Confirm Results (1 success)' },
  { taskLabel: 'Evasive Action', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 14 }, { value: 3, success: true }, { value: 18 }] }))
    // Arm the second reroll the way _armCardSelection does, dim the first, and append the tray.
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="ts"[^>]*style=")([^"]*)("[^>]*>)<span class="sta2e-rr-name">/,
      '$1$2background:#e9e95a;border-color:#e9e95a;color:#000000;$3<span class="sta2e-rr-name">▶ ')
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="detReroll"[^>]*style=")([^"]*)"/, '$1$2opacity:0.4;"')
    .replace(/(<div class="sta2e-working-actions sta2e-working-actions--rerolls[\s\S]*?<\/div>)(\s*<\/div>)/, `$1${tray}$2`)
    .replace(/(<span class="sta2e-card-die" data-pool="crew" data-index="0" style=")([^"]*)("[^>]*>)<img([^>]*?)style="([^"]*)"/,
      '$1$2outline:1px solid #e9e95a;box-shadow:0 0 6px #e9e95a;$3<img$4style="$5opacity:0.8;filter:sepia(1) saturate(6) hue-rotate(4deg) brightness(1.15) drop-shadow(0 0 5px #e9e95a);"');
  const cards = [
    ['Working, everything on', renderTmpTaskCard(view())],
    ['A reroll armed', armed],
    ['Confirmed, Momentum to bank', renderTmpTaskCard(view({
      gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#00aef0' },
      poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: '', label: 'Add Momentum to Pool (+2)' },
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, shipDice: [], apAssistDice: [], crewDice: [{ value: 3, success: true }, { value: 1, success: true, crit: true }] }))],
    ['Failed', renderTmpTaskCard(view({
      passed: false, finalResultLabel: 'Failed', namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 1, ''], ['Difficulty', 3, ''], ['Momentum', 0, ''], ['Complic.', 1, ''], ['Result', 'Failed', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Analyze Anomaly', shipDice: [], apAssistDice: [], crewDice: [{ value: 12, success: true }, { value: 19, complication: true }] }))],
    ['NPC, Threat banked', renderTmpTaskCard(view({
      gained: { visible: true, label: 'Threat', amount: 3, type: 'threat', color: '#00aef0', autoBanked: true, banked: 2, floating: 1 },
      poolButton: { visible: false }, namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 5, ''], ['Difficulty', 2, ''], ['Threat', 3, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Ramming Speed', shipDice: [], apAssistDice: [], crewDice: [{ value: 2, success: true }, { value: 5, success: true }] }))],
    ['Assist roll', renderTmpTaskCard(view({ showMakeYourOwnLuck: false, noteStrips: [], traitNotes: [], crewDiceHeading: 'Insight + Command (target: 13)' },
      { isAssistRoll: true, assistOfficerName: 'Lt. Uhura', crewDice: [{ value: 6, success: true }], shipDice: [], apAssistDice: [] }))],
    ['Damage card (frame)', framed],
    ['Info card (frame)', lcarsChatCard({ title: 'Sensor Contact', accent: '#00aef0', legacy,
      body: '<div style="font-size:11px;color:#3df09d;">Bearing 047 mark 15 · Medium range</div>' })],
  ];
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>TMP cards</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.chat-message{width:300px;background:#0e0e11;padding:6px;border-radius:6px}
.chat-message button{height:2rem}h4{margin:0 0 4px;font-size:11px;color:#888}</style>
<div class="grid">${cards.map(([t, h]) => `<div><h4>${t}</h4><div class="chat-message">${h}</div></div>`).join('')}</div>`);
  console.log(`preview: ${out}`);
}
process.exit(failed ? 1 : 0);
