// node tests/ent-cards.mjs [--preview out.html]
//
// The ENT Bridge Touchscreen skins: the working task card (task-card-ent.js) and
// the chat card frame's ENT path (chat-card-frame.js). Checks the DOM contract
// the chat wiring depends on — the .sta2e-working-actions wrappers, the die
// markup, every button class and data-* attribute, no inline border-radius or
// font-family — that a key's colour is entirely inline, and that the frame
// turns the body's LCARS shapes into ENT parts without losing their accent.
// Both modules import only lcars-theme.js (and each other), so they load under
// node with the theme setting stubbed. The sibling of tests/tng-cards.mjs.
//
// --preview writes a page rendering every state against the real stylesheets,
// with the bundled fonts inlined.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let theme = 'ent-panel';
globalThis.game = { settings: { get: (_m, key) => key === 'hudTheme' ? theme : undefined } };

const { renderEntTaskCard, dataStream } = await import('../scripts/task-card-ent.js');
const { lcarsChatCard, entBodyHtml } = await import('../scripts/chat-card-frame.js');

// ── A view shaped like buildPlayerRollCardHtml's ──────────────────────────────
const diceRow = (dice, pool = 'crew', opts = {}) => {
  const size = opts.size ?? 32;
  return `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;">${
    dice.map((d, i) => {
      const col = d.crit ? '#f0e800' : d.success ? '#bfe3f2' : d.complication ? '#ff3b2a' : '#5e5e5e';
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
  return `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="font-size:9px;color:#5e5e5e;font-weight:700;text-transform:uppercase;">${label}</span>`
    + `<span style="display:inline-flex;gap:3px;">${Array.from({ length: n }, () =>
      `<img src="${TOKENS[type]}" style="width:${size}px;height:${size}px;border-radius:50%;filter:drop-shadow(0 0 2px ${color});" />`).join('')}</span></span>`;
};
const rerollButtonBody = rb => `<span class="sta2e-rr-name">${rb.label}</span>${rb.cost ? `<span class="sta2e-rr-cost">${rb.cost}</span>` : ''}`;

function view(over = {}, roll = {}) {
  const rollData = {
    taskLabel: 'Fire Phase Cannons', officerName: 'Lt. Reed',
    crewDice: [{ value: 1, success: true, crit: true }, { value: 9, success: true }, { value: 15 }, { value: 20, complication: true }],
    shipDice: [{ value: 7, success: true }],
    apAssistDice: [{ value: 17 }],
    pendingAssists: [{ name: 'Ens. Mayweather', type: 'direct' }],
    confirmed: false, isAssistRoll: false, crewTarget: 12,
    ...roll,
  };
  return {
    rollData, diceRow, renderResourceTokens, rerollButtonBody, p: 'PAYLOAD',
    passed: true, finalResultLabel: 'Success',
    contextLeftLabel: 'Lt. Reed', contextRightLabel: 'Comp Range 20',
    crewDiceHeading: 'Control + Security (target: 12)',
    shipDiceHeading: 'Enterprise NX-01 · Weapons + Security · (target: 10)',
    namedAssistBlocks: [{ die: { value: 4, success: true }, heading: 'Ens. Sato — Assist Die', subHeading: 'Insight + Command' }],
    noteStrips: [
      { tone: 'warn', text: 'Assist dice may not be added: the crew die failed' },
      { tone: 'note', text: 'Persistent: +1 success, +1 complication' },
      { tone: 'bonus', text: 'Call Out Targets: +1 bonus Momentum on success' },
    ],
    traitNotes: [{ name: 'Thermobaric Cloud', label: 'Difficulty', value: 1 }],
    statCells: [['Successes', 4, ''], ['Difficulty', 3, ''], ['Momentum', 1, ''], ['Complic.', 1, ''], ['Result', 'PASS', '']],
    interactiveActive: true, spentVisible: true,
    spentGroups: [['Momentum', 2, 'momentum', '#7aaec4'], ['Threat', 1, 'threat', '#9b0000'], ['Personal Threat', 0, 'threat', '#3d3d3d']],
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

// ── Task card ──────────────────────────────────────────────────────────────
const working = renderEntTaskCard(view());

check('root carries the task card class, the ENT class and the theme', () => {
  assert.match(working, /class="sta2e-task-card sta2e-task-card--ent tec" data-theme="ent-panel"/);
  assert.match(working, /--tec-c:#7aaec4;/, 'a working card has the ENT blue frame');
  assert.match(working, /<div class="tec-in">/, 'the glass is the inner clipped box');
  assert.match(working, /class="tec-title">Fire Phase Cannons</);
  assert.match(working, /class="tec-tab">Working</);
});

check('every working block is rendered', () => {
  for (const text of ['Lt. Reed · Comp Range 20', 'Ens. Sato — Assist Die', 'Insight + Command', 'Helm — Attack Pattern',
    'Enterprise NX-01 · Weapons + Security', 'T 12', 'T 10', 'Persistent', 'Call Out Targets', 'Thermobaric Cloud: Difficulty (+1)',
    'Complic.', 'Spent', 'Pending Assists', 'Rerolls Available', 'Edit Results', 'Hit at Cost', 'Resolve HIT']) {
    assert.ok(working.includes(text), `missing: ${text}`);
  }
});

check('dice keep pool and index, with an <img> inside each', () => {
  assert.equal(count(working, /class="sta2e-card-die" data-pool="crew"/g), 4);
  assert.equal(count(working, /data-pool="named-assist" data-index="0"/g), 1);
  assert.equal(count(working, /data-pool="ap-assist"/g), 1);
  assert.equal(count(working, /data-pool="ship"/g), 1);
  assert.equal(count(working, /class="sta2e-card-die"[^>]*>\s*<img/g), 7);
  assert.equal(count(working, /class="tec-well"/g), 4, 'one well per dice group');
});

check('each action group sits in its own working-actions wrapper', () => {
  for (const m of ['assists', 'luck', 'rerolls', 'confirm']) {
    assert.match(working, new RegExp(`class="sta2e-working-actions sta2e-working-actions--${m} tec-actions"`));
  }
  assert.match(working, /class="tec-pad sta2e-task-rerolls"/, 'the reroll grid is the inner list, not the wrapper');
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

check('keys are tabs, not filled keys, so arming outlines them in yellow', () => {
  assert.doesNotMatch(working, /data-filled/);
});

check("a key's colour is all inline, and nothing carries an inline radius or font", () => {
  for (const tag of working.match(/<button\b[^>]*>/g)) {
    assert.match(tag, /style="--k:#[0-9a-f]{6};background:linear-gradient\(90deg,#[0-9a-f]{6} 0 3px,#[0-9a-f]{6} 3px\);border-color:#[0-9a-f]{6};color:#f0f0f0;"/);
  }
  // The dice and pool tokens are the stubs' markup above, not the skin's.
  const own = working.replace(/<span class="sta2e-card-die"[\s\S]*?<\/span><\/span>(<\/span>)?/g, '')
    .replace(/<img [^>]*>/g, '');
  assert.doesNotMatch(own, /border-radius|font-family/);
});

check('readout rows share one scale, and Successes marks the Difficulty', () => {
  assert.equal(count(working, /class="tec-row[ "]/g), 4);
  assert.match(working, /<span>Successes<\/span><b>4<\/b><span class="tec-bar tec-bar--mark"[^>]*style="--p:67%;--bc:#7aaec4;--m:50%;"/);
  assert.match(working, /<span>Difficulty<\/span><b>3<\/b><span class="tec-bar"[^>]*--p:50%;/);
  assert.match(working, /class="tec-row tec-row--cpx"><span>Complic\.<\/span>/);
  const big = renderEntTaskCard(view({ statCells: [['Successes', 12, ''], ['Difficulty', 3, ''], ['Result', 'PASS', '']] }));
  assert.match(big, /--p:100%;--bc:#7aaec4;--m:25%;/, 'the scale grows past six with the largest value');
});

check('confirmed card: green frame, pool button keeps its data, gained tokens show', () => {
  const html = renderEntTaskCard(view({
    gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#3d3d3d', autoBanked: false },
    poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: 'T1', label: 'Add Momentum to Pool (+2)' },
    statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
  }, { confirmed: true, pendingAssists: [] }));
  assert.match(html, /--tec-c:#a7d46c;/);
  assert.match(html, /class="tec-tab">Success</);
  assert.match(html, /class="sta2e-add-to-pool[^"]*"\s+data-pool="momentum"\s+data-amount="2"\s+data-token-id="T1"/);
  assert.match(html, /Gained/);
  assert.match(html, /tec-result--pass"><strong>Success</);
  assert.doesNotMatch(html, /sta2e-player-confirm|sta2e-player-reroll|sta2e-working-actions--assists/);
});

check('confirmed with nothing to bank shows Completed', () => {
  const html = renderEntTaskCard(view({ poolButton: { visible: false } }, { confirmed: true }));
  assert.match(html, /class="sta2e-task-btn[^"]*"[^>]*>Completed</);
});

check('a failed card turns the frame and the result red', () => {
  const html = renderEntTaskCard(view({ passed: false, finalResultLabel: 'Failed' }, { confirmed: true }));
  assert.match(html, /--tec-c:#e0533a;/);
  assert.match(html, /tec-result--fail/);
});

check('assist roll: grey frame, Add to Task Roll, then Applied to', () => {
  const open = renderEntTaskCard(view({}, { isAssistRoll: true, assistOfficerName: 'Ens. Sato' }));
  assert.match(open, /class="tec-title">Assist — Ens. Sato</);
  assert.match(open, /--tec-c:#c7c7c7;/);
  assert.match(open, /class="sta2e-assist-to-roll[^"]*" data-payload="PAYLOAD"/);
  assert.doesNotMatch(open, /tec-result|sta2e-player-confirm|sta2e-player-reroll/);
  const done = renderEntTaskCard(view({}, { isAssistRoll: true, assistApplied: 'Fire Phase Cannons' }));
  assert.match(done, /class="sta2e-task-btn[^"]*"[^>]*>Applied to: Fire Phase Cannons</);
});

check('succeed at cost reads COST on the readout', () => {
  const html = renderEntTaskCard(view({ statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'COST', '']] },
    { succeedAtCost: true }));
  assert.match(html, /tec-result--cost"><strong>COST</);
});

check('the footer stream is stable per title', () => {
  assert.equal(dataStream('Fire Phase Cannons'), dataStream('Fire Phase Cannons'));
  assert.notEqual(dataStream('Fire Phase Cannons'), dataStream('Scan'));
  assert.match(dataStream('x'), /^([0-9A-F]{2} ){5}[0-9A-F]{2}$/);
});

// ── Chat card frame ─────────────────────────────────────────────────────────
const tile = (l, v, c = '#d0d0d0') => `<div style="flex:1;padding:3px;border:1px solid #373737;border-radius:2px;text-align:center;font-family:'Arial Narrow',sans-serif;"><div style="font-size:8px;color:#5e5e5e;text-transform:uppercase;letter-spacing:0.08em;">${l}</div><div style="font-size:15px;font-weight:700;color:${c};">${v}</div></div>`;
const damageBody = `<div style="font-size:10px;color:#d0d0d0;margin-bottom:4px;">💥 Klingon Raptor ▸ Enterprise NX-01</div>
    <div style="display:flex;gap:4px;">${tile('Damage', 8)}${tile('Resist', '−3')}${tile('Shields', '12 → 7', '#7aaec4')}</div>
    <div style="margin-top:5px;padding:3px 6px;border-left:3px solid #f0e800;font-size:10px;color:#f0f0f0;background:rgba(240,232,0,0.08);">⚠️ Shields below 50%: one breach to Weapons</div>
    <div class="sta2e-damage-controls" style="display:flex;gap:4px;margin-top:6px;">
      <button class="sta2e-apply-damage" data-x="1" style="flex:1;padding:5px;background:#9b0000;border:1px solid #9b0000;border-radius:2px;color:#000;font-weight:700;font-size:10px;font-family:'Arial Narrow',sans-serif;">APPLY DAMAGE</button>
      <button class="sta2e-undo" style="flex:1;padding:5px;background:transparent;border:1px solid #7aaec4;border-radius:2px;color:#7aaec4;font-weight:700;font-size:10px;">UNDO</button>
      <button class="sta2e-plain">Plain</button>
    </div>`;
const legacy = () => '<div class="legacy">old</div>';
const framed = lcarsChatCard({ title: '💥 Plasma Cannon Hit', accent: '#e0533a', body: damageBody, legacy,
  rootClass: 'sta2e-momentum-tracker', attrs: 'data-pool="momentum"' });

check('ENT frame: glass, head, foot, root identity carried forward', () => {
  assert.match(framed, /class="sta2e-chat-card sta2e-chat-card--ent tec sta2e-momentum-tracker" data-pool="momentum" data-theme="ent-panel"/);
  assert.match(framed, /--ccf-c:#e0533a;--tec-c:#e0533a;/);
  assert.match(framed, /class="tec-title">Plasma Cannon Hit</, 'title without the emoji');
  assert.match(framed, /<div class="tec-in">\s*<div class="tec-head">/);
  assert.match(framed, /class="tec-body ccf-body">/, 'the body keeps .ccf-body, the wirers\' host');
  assert.match(framed, /class="tec-foot"/);
  assert.ok(framed.includes('class="sta2e-damage-controls"'), 'body classes pass through');
});

check('ENT body pass: tiles, notes and keys, no LCARS geometry or font left', () => {
  const inner = framed.slice(framed.indexOf('ccf-body">'));
  assert.equal(count(inner, /class="ccf-ent-tile"/g), 3);
  assert.match(inner, /class="ccf-ent-note" style="--tn-c:#f0e800;/);
  assert.doesNotMatch(inner, /border-radius|font-family|💥|⚠/);
  assert.match(inner, /color:#7aaec4;/, 'a value keeps its colour');
});

check('ENT body pass: buttons become keys in their own accent, layout and data kept', () => {
  const tags = framed.match(/<button\b[^>]*>/g);
  assert.equal(tags.length, 3);
  for (const t of tags) assert.doesNotMatch(t, /(?<![-\w])(background|border[-a-z]*|color)\s*:/);
  assert.match(tags[0], /class="sta2e-apply-damage" data-x="1"/);
  assert.match(tags[0], /--tck-a:#9b0000;/, 'a filled key keeps its fill as the accent');
  assert.match(tags[1], /--tck-a:#7aaec4;/);
  assert.match(tags[2], /--tck-a:#c7c7c7;/, 'no colour falls back to the theme primary');
});

check('the spend panel pass is the same pass', () => {
  assert.equal(entBodyHtml('<button style="color:#7aaec4">+</button>'), '<button style="--tck-a:#7aaec4;--tck-ink:#140e00;">+</button>');
});

check('other eras keep their own frames or legacy markup', () => {
  theme = 'tos-panel';
  assert.match(lcarsChatCard({ title: 'T', body: damageBody, legacy }), /sta2e-chat-card--tos/);
  theme = 'tmp-console';
  assert.match(lcarsChatCard({ title: 'T', body: damageBody, legacy }), /sta2e-chat-card--tmp/);
  theme = 'lcars-tng';
  const tng = lcarsChatCard({ title: 'T', body: damageBody, legacy });
  assert.match(tng, /sta2e-chat-card--tng tbc/);
  assert.doesNotMatch(tng, /ccf-ent-|--tck-a/);
  theme = 'klingon';
  assert.equal(lcarsChatCard({ title: 'T', body: damageBody, legacy }), legacy());
  theme = 'ent-panel';
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
  const dot = c => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="${c}"/></svg>`).toString('base64')}`;
  TOKENS = { momentum: dot('#7aaec4'), threat: dot('#9b0000') };
  // The stylesheets name the fonts relative to styles/; inline them for the page.
  const css = ['chat-card.css', 'task-card.css', 'task-card-tmp.css', 'task-card-ent.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/(tmp|ent)\/([^"]+)"\)/g,
      (_, d, f) => `url("data:font/woff2;base64,${fs.readFileSync(`${root}/fonts/${d}/${f}`).toString('base64')}")`);
  // The reroll tray exactly as _armCardSelection injects it, with the ENT tokens.
  const tray = `<div class="sta2e-reroll-tray" style="margin-top:5px;padding:5px 6px;background:rgba(255,255,255,0.04);border:1px solid #f0e800;border-radius:var(--tcx-tray-radius, 10px);font-family:'Arial Narrow',sans-serif;">
    <div style="font-size:8px;color:#f0e800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:5px;text-align:center;">Targeting Solution: pick 1 die to reroll</div>
    <div style="display:flex;gap:5px;">
      <button type="button" class="sta2e-tray-confirm" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.06);border:1px solid #f0e800;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#f0e800;">Reroll Selected</button>
      <button type="button" class="sta2e-tray-cancel" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.03);border:1px solid #5e5e5e;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#5e5e5e;">Cancel</button>
    </div></div>`;
  const armed = renderEntTaskCard(view({ namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
    statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'FAIL', '']], passed: false,
    rerollButtons: view().rerollButtons.slice(0, 2), confirmLabel: 'Confirm Results (1 success)' },
  { taskLabel: 'Evasive Action', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 14 }, { value: 3, success: true }, { value: 18 }] }))
    // Arm the second reroll the way _armCardSelection does an unfilled key, dim the first, and append the tray.
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="ts"[^>]*style=")([^"]*)("[^>]*>)<span class="sta2e-rr-name">/,
      '$1$2background:rgba(255,255,255,0.06);border-color:#f0e800;color:#f0e800;$3<span class="sta2e-rr-name">▶ ')
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="detReroll"[^>]*style=")([^"]*)"/, '$1$2opacity:0.4;"')
    .replace(/(<div class="sta2e-working-actions sta2e-working-actions--rerolls[\s\S]*?<\/div>)(\s*<\/div>)/, `$1${tray}$2`)
    .replace(/(<span class="sta2e-card-die" data-pool="crew" data-index="0" style=")([^"]*)("[^>]*>)<img([^>]*?)style="([^"]*)"/,
      '$1$2outline:1px solid #f0e800;box-shadow:0 0 6px #f0e800;$3<img$4style="$5opacity:0.8;filter:sepia(1) saturate(6) hue-rotate(4deg) brightness(1.15) drop-shadow(0 0 5px #f0e800);"');
  const injuryBody = `<div style="font-size:10px;color:#d0d0d0;margin-bottom:4px;">Cpl. Hawkins ▸ Xindi-Reptilian</div>
    <div style="display:flex;gap:4px;">${tile('Severity', 4)}${tile('Protection', '−1')}${tile('Stress', '8 → 5', '#e0533a')}</div>
    <div style="margin-top:5px;padding:4px 6px;border:1px solid #373737;border-left:3px solid #ff3b2a;color:#ff3b2a;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Deadly Injury</div>
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button style="flex:1;padding:5px;background:#9b0000;border:1px solid #9b0000;color:#000;font-weight:700;font-size:10px;">TAKE INJURY</button>
      <button style="flex:1;padding:5px;background:transparent;border:1px solid #c7c7c7;color:#c7c7c7;font-weight:700;font-size:10px;">AVOID · 2 THREAT</button>
    </div>`;
  const hazardBody = `<div style="font-size:10px;color:#d0d0d0;margin-bottom:4px;">Thermobaric Cloud · Lingering</div>
    <div style="display:flex;gap:6px;align-items:center;font-size:10px;color:#d0d0d0;">Potency <span style="display:inline-block;padding:0 5px;border:1px solid #f0b400;color:#f0b400;border-radius:2px;">3</span>
      <label style="margin-left:auto;font-size:10px;"><input type="checkbox" checked> Established</label></div>
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button style="flex:1;padding:5px;background:#f0b400;border:1px solid #f0b400;color:#000;font-weight:700;font-size:10px;">BUILD &amp; APPLY</button>
      <button style="flex:1;padding:5px;background:transparent;border:1px solid #5e5e5e;color:#5e5e5e;font-weight:700;font-size:10px;">IGNORE</button>
    </div>`;
  const cards = [
    ['Working, everything on', renderEntTaskCard(view())],
    ['A reroll armed', armed],
    ['Confirmed, Momentum to bank', renderEntTaskCard(view({
      gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#3d3d3d' },
      poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: '', label: 'Add Momentum to Pool (+2)' },
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Analyse Anomaly', officerName: "T'Pol", shipDice: [], apAssistDice: [], crewDice: [{ value: 3, success: true }, { value: 1, success: true, crit: true }] }))],
    ['Failed', renderEntTaskCard(view({
      passed: false, finalResultLabel: 'Failed', namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 1, ''], ['Difficulty', 3, ''], ['Momentum', 0, ''], ['Complic.', 1, ''], ['Result', 'Failed', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Polarize Hull Plating', shipDice: [], apAssistDice: [], crewDice: [{ value: 12, success: true }, { value: 19, complication: true }] }))],
    ['Working, edit + confirm only', renderEntTaskCard(view({
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
      rerollButtons: [], succeedAtCostButton: { visible: false }, confirmLabel: 'Confirm Results (2 successes)',
      statCells: [['Successes', 2, ''], ['Difficulty', 1, ''], ['Momentum', 1, ''], ['Result', 'PASS', '']],
    }, { taskLabel: 'Scan for Lifesigns', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 5, success: true }, { value: 8, success: true }] }))],
    ['Assist roll', renderEntTaskCard(view({ showMakeYourOwnLuck: false, noteStrips: [], traitNotes: [], crewDiceHeading: 'Insight + Command (target: 13)' },
      { isAssistRoll: true, assistOfficerName: 'Ens. Sato', crewDice: [{ value: 6, success: true }], shipDice: [], apAssistDice: [] }))],
    ['Ship damage (frame)', lcarsChatCard({ title: '💥 Plasma Cannon Hit', accent: '#e0533a', body: damageBody, legacy })],
    ['Ground damage (frame)', lcarsChatCard({ title: 'Phase Pistol Hit', accent: '#ff3b2a', body: injuryBody, legacy })],
    ['Hazard (frame)', lcarsChatCard({ title: '⚠️ Hazard Entry', accent: '#f0b400', body: hazardBody, legacy })],
    ['Info card (frame)', lcarsChatCard({ title: 'Sensor Contact', accent: '#bfe3f2', legacy,
      body: '<div style="font-size:11px;color:#d0d0d0;">Bearing 047 mark 15 · Medium range · Delphic Expanse</div>' })],
  ];
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>ENT cards</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.chat-message{width:300px;background:#0e0e11;padding:6px;border-radius:6px}
.chat-message button{height:2rem}h4{margin:0 0 4px;font-size:11px;color:#888}</style>
<div class="grid">${cards.map(([t, h]) => `<div><h4>${t}</h4><div class="chat-message">${h}</div></div>`).join('')}</div>`);
  console.log(`preview: ${out}`);
}
process.exit(failed ? 1 : 0);
