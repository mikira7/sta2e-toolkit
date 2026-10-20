// node tests/romulan-cards.mjs [--preview out.html]
//
// The Romulan Raptor Wing skins: the working task card (task-card-romulan.js)
// and the chat card frame's Romulan path (chat-card-frame.js). Checks the DOM
// contract the chat wiring depends on — the .sta2e-working-actions wrappers, the
// die markup, every button class and data-* attribute, no inline border-radius
// or font-family — that a key's colour is entirely inline and no key is
// data-filled (they are edged, so arming takes the unfilled path), and that the
// frame puts the body on the grid with its LCARS shapes turned into Raptor Wing
// parts. Both modules import only lcars-theme.js (and each other), so they load
// under node with the theme setting stubbed. The sibling of
// tests/klingon-cards.mjs.
//
// --preview writes a page rendering every state against the real stylesheets,
// with the bundled fonts inlined.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let theme = 'romulan';
globalThis.game = { settings: { get: (_m, key) => key === 'hudTheme' ? theme : undefined } };

const { renderRomulanTaskCard, diamondMeter, keyStyle, romulanHead } = await import('../scripts/task-card-romulan.js');
const { lcarsChatCard, romulanBodyHtml } = await import('../scripts/chat-card-frame.js');

// ── A view shaped like buildPlayerRollCardHtml's ──────────────────────────────
// Die colours as diceRow writes them under romulan: crit gold, success the
// bright jade (successDieColour), complication the token red.
const diceRow = (dice, pool = 'crew', opts = {}) => {
  const size = opts.size ?? 32;
  return `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;">${
    dice.map((d, i) => {
      const col = d.crit ? '#d8c050' : d.success ? '#5cf09a' : d.complication ? '#cc2233' : '#aaaaaa';
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
  return `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="font-size:9px;color:#226633;font-weight:700;text-transform:uppercase;">${label}</span>`
    + `<span style="display:inline-flex;gap:3px;">${Array.from({ length: n }, () =>
      `<img src="${TOKENS[type]}" style="width:${size}px;height:${size}px;border-radius:50%;filter:drop-shadow(0 0 2px ${color});" />`).join('')}</span></span>`;
};
const rerollButtonBody = rb => `<span class="sta2e-rr-name">${rb.label}</span>${rb.cost ? `<span class="sta2e-rr-cost">${rb.cost}</span>` : ''}`;

function view(over = {}, roll = {}) {
  const rollData = {
    taskLabel: 'Fire Disruptors', officerName: 'Subcmdr. Tal',
    crewDice: [{ value: 1, success: true, crit: true }, { value: 9, success: true }, { value: 15 }, { value: 20, complication: true }],
    shipDice: [{ value: 7, success: true }],
    apAssistDice: [{ value: 17 }],
    pendingAssists: [{ name: 'Centurion Velal', type: 'direct' }],
    confirmed: false, isAssistRoll: false, crewTarget: 12,
    ...roll,
  };
  return {
    rollData, diceRow, renderResourceTokens, rerollButtonBody, p: 'PAYLOAD',
    passed: true, finalResultLabel: 'Success',
    contextLeftLabel: 'Subcmdr. Tal', contextRightLabel: 'Comp Range 20',
    crewDiceHeading: 'Control + Security (target: 12)',
    shipDiceHeading: 'IRW Haakona · Weapons + Security · (target: 10)',
    namedAssistBlocks: [{ die: { value: 4, success: true }, heading: 'Cmdr. Toreth — Assist Die', subHeading: 'Insight + Command' }],
    noteStrips: [
      { tone: 'warn', text: 'Assist dice may not be added: the crew die failed' },
      { tone: 'note', text: 'Persistent: +1 success, +1 complication' },
      { tone: 'bonus', text: 'Tactical advantage: +1 bonus Momentum on success' },
    ],
    traitNotes: [{ name: 'Plasma Storm', label: 'Difficulty', value: 1 }],
    statCells: [['Successes', 4, ''], ['Difficulty', 3, ''], ['Momentum', 1, ''], ['Complic.', 1, ''], ['Result', 'PASS', '']],
    interactiveActive: true, spentVisible: true,
    spentGroups: [['Momentum', 2, 'momentum', '#d8c050'], ['Threat', 1, 'threat', '#cc2233'], ['Personal Threat', 0, 'threat', '#226633']],
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
const working = renderRomulanTaskCard(view());

check('root carries the task card class, the Romulan class and the theme', () => {
  assert.match(working, /class="sta2e-task-card sta2e-task-card--romulan trw" data-theme="romulan"/);
  assert.match(working, /--trw-c:#22aa44;/, 'a working card has the frame green');
  assert.match(working, /class="trw-title">Fire Disruptors</);
  assert.match(working, /class="trw-code">Working</);
  assert.equal(count(working, /class="trw-wing trw-wing--[lr]"/g), 2, 'two swept wings');
});

check('every working block is rendered, the readout before the keys', () => {
  for (const text of ['Subcmdr. Tal · Comp Range 20', 'Cmdr. Toreth — Assist Die', 'Insight + Command', 'Helm — Attack Pattern',
    'IRW Haakona · Weapons + Security', 'T 12', 'T 10', 'Persistent', 'Tactical advantage', 'Plasma Storm: Difficulty (+1)',
    'Complic.', 'Spent', 'Pending Assists', 'Rerolls Available', 'Edit Results', 'Hit at Cost', 'Resolve HIT']) {
    assert.ok(working.includes(text), `missing: ${text}`);
  }
  assert.ok(working.indexOf('trw-result') < working.indexOf('sta2e-working-actions'), 'the keys follow the readout');
});

check('dice keep pool and index, with an <img> inside each', () => {
  assert.equal(count(working, /class="sta2e-card-die" data-pool="crew"/g), 4);
  assert.equal(count(working, /data-pool="named-assist" data-index="0"/g), 1);
  assert.equal(count(working, /data-pool="ap-assist"/g), 1);
  assert.equal(count(working, /data-pool="ship"/g), 1);
  assert.equal(count(working, /class="sta2e-card-die"[^>]*>\s*<img/g), 7);
  assert.equal(count(working, /class="trw-well"/g), 4, 'one well per dice pool');
});

check('each action group sits in its own working-actions wrapper', () => {
  for (const m of ['assists', 'luck', 'rerolls', 'confirm']) {
    assert.match(working, new RegExp(`class="sta2e-working-actions sta2e-working-actions--${m} trw-actions"`));
  }
  assert.match(working, /class="trw-pad sta2e-task-rerolls"/, 'the reroll grid is the inner list, not the wrapper');
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

check('keys are edged, not filled, so arming takes the unfilled path', () => {
  const keys = working.match(/<(button|div) class="[^"]*trw-key[^"]*"[^>]*>/g);
  assert.ok(keys.length >= 8);
  for (const k of keys) assert.doesNotMatch(k, /data-filled/);
});

check("a key's colour is all inline, and nothing carries an inline radius or font", () => {
  for (const tag of working.match(/<button\b[^>]*>/g)) {
    assert.match(tag, /style="--k:#[0-9a-f]{6};background:linear-gradient\(90deg,#[0-9a-f]{6} 0 3px,#021a0c 3px calc\(100% - 3px\),#[0-9a-f]{6} calc\(100% - 3px\)\);border-color:#[0-9a-f]{6};color:#[0-9a-f]{6};"/);
  }
  const own = working.replace(/<span class="sta2e-card-die"[\s\S]*?<\/span><\/span>(<\/span>)?/g, '')
    .replace(/<img [^>]*>/g, '');
  assert.doesNotMatch(own, /border-radius|font-family/);
});

check('a key label is its colour lightened toward white', () => {
  assert.equal(keyStyle('#000000').match(/color:(#[0-9a-f]{6});$/)[1], '#4d4d4d');
});

check('the diamond meter lights the successes and reds the Difficulty', () => {
  assert.equal(diamondMeter(4, 6, 3),
    '<div class="trw-dia" aria-hidden="true"><i class="d on"></i><i class="d on"></i><i class="d on"></i><i class="on"></i><i></i><i></i></div>');
  assert.equal(count(working, /class="trw-dia"/g), 1);
  const big = renderRomulanTaskCard(view({ statCells: [['Successes', 30, ''], ['Difficulty', 3, ''], ['Result', 'PASS', '']] }));
  assert.equal(count(big.match(/<div class="trw-dia"[\s\S]*?<\/div>/)[0], /<i/g), 16, 'the meter is capped at sixteen');
  assert.match(working, /class="trw-cell trw-cell--red"><span>Complic\.<\/span><b>1<\/b>/);
  assert.match(working, /class="trw-cell trw-cell--gold"><span>Momentum<\/span>/);
});

check('confirmed card: gold frame, mnhei\'sahe, pool button keeps its data, gained tokens show', () => {
  const html = renderRomulanTaskCard(view({
    gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#d8c050', autoBanked: false },
    poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: 'T1', label: 'Add Momentum to Pool (+2)' },
    statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
  }, { confirmed: true, pendingAssists: [] }));
  assert.match(html, /--trw-c:#d8c050;/);
  assert.match(html, /class="trw-code">Success</);
  assert.match(html, /class="sta2e-add-to-pool[^"]*"\s+data-pool="momentum"\s+data-amount="2"\s+data-token-id="T1"/);
  assert.match(html, /Gained/);
  assert.match(html, /trw-result--pass"><strong>Success<\/strong><small>mnhei'sahe<\/small>/);
  assert.doesNotMatch(html, /sta2e-player-confirm|sta2e-player-reroll|sta2e-working-actions--assists/);
});

check('a working card shows no flavour word yet', () => {
  assert.doesNotMatch(working, /mnhei'sahe/);
});

check('confirmed with nothing to bank shows Completed', () => {
  const html = renderRomulanTaskCard(view({ poolButton: { visible: false } }, { confirmed: true }));
  assert.match(html, /class="sta2e-task-btn[^"]*"[^>]*>Completed</);
});

check('a failed card turns the frame and the result red, with no flavour word', () => {
  const html = renderRomulanTaskCard(view({ passed: false, finalResultLabel: 'Failed' }, { confirmed: true }));
  assert.match(html, /--trw-c:#ff4a5a;/);
  assert.match(html, /trw-result--fail"><strong>PASS<\/strong><\/div>/);
});

check('assist roll: sage frame, no readout, Add to Task Roll, then Applied to', () => {
  const open = renderRomulanTaskCard(view({}, { isAssistRoll: true, assistOfficerName: 'Cmdr. Toreth' }));
  assert.match(open, /class="trw-title">Assist — Cmdr. Toreth</);
  assert.match(open, /--trw-c:#669966;/);
  assert.match(open, /class="sta2e-assist-to-roll[^"]*" data-payload="PAYLOAD"/);
  assert.doesNotMatch(open, /trw-result|trw-dia|sta2e-player-confirm|sta2e-player-reroll/);
  const done = renderRomulanTaskCard(view({}, { isAssistRoll: true, assistApplied: 'Fire Disruptors' }));
  assert.match(done, /class="sta2e-task-btn[^"]*"[^>]*>Applied to: Fire Disruptors</);
});

check('succeed at cost reads COST on the readout, with no flavour word', () => {
  const html = renderRomulanTaskCard(view({ statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'COST', '']] },
    { succeedAtCost: true, confirmed: true }));
  assert.match(html, /trw-result--cost"><strong>COST<\/strong><\/div>/);
});

check('the head is shared: wings, title, diamond-line code', () => {
  const head = romulanHead('Sensor Contact', 'Reveal');
  assert.match(head, /<div class="trw-title">Sensor Contact<\/div>/);
  assert.match(head, /<div class="trw-code">Reveal<\/div>/);
  assert.match(romulanHead('x'), /<div class="trw-code"><\/div>/, 'an empty code still draws the diamond line');
});

// ── Chat card frame ─────────────────────────────────────────────────────────
const tile = (l, v, c = '#88cc88') => `<div style="flex:1;padding:3px;border:1px solid #001a00;border-radius:2px;text-align:center;font-family:'Arial Narrow',sans-serif;"><div style="font-size:8px;color:#226633;text-transform:uppercase;letter-spacing:0.08em;">${l}</div><div style="font-size:15px;font-weight:700;color:${c};">${v}</div></div>`;
const damageBody = `<div style="font-size:10px;color:#88cc88;margin-bottom:4px;">💥 IRW Haakona ▸ U.S.S. Gettysburg</div>
    <div style="display:flex;gap:4px;">${tile('Damage', 8)}${tile('Resist', '−3')}${tile('Shields', '12 → 7', '#cc2233')}</div>
    <div style="margin-top:5px;padding:3px 6px;border-left:3px solid #cc6622;font-size:10px;color:#ccffcc;background:rgba(204,102,34,0.08);">⚠️ Shields below 50%: one breach to Weapons</div>
    <div class="sta2e-damage-controls" style="display:flex;gap:4px;margin-top:6px;">
      <button class="sta2e-apply-damage" data-x="1" style="flex:1;padding:5px;background:#cc2233;border:1px solid #cc2233;border-radius:2px;color:#000;font-weight:700;font-size:10px;font-family:'Arial Narrow',sans-serif;">APPLY DAMAGE</button>
      <button class="sta2e-undo" style="flex:1;padding:5px;background:transparent;border:1px solid #669966;border-radius:2px;color:#669966;font-weight:700;font-size:10px;">UNDO</button>
      <button class="sta2e-plain">Plain</button>
    </div>`;
const legacy = () => '<div class="legacy">old</div>';
const framed = lcarsChatCard({ title: '💥 Disruptor Hit', accent: '#ff4a5a', body: damageBody, legacy,
  rootClass: 'sta2e-momentum-tracker', attrs: 'data-pool="momentum"' });

check('Romulan frame: wings and body, root identity carried forward', () => {
  assert.match(framed, /class="sta2e-chat-card sta2e-chat-card--romulan trw sta2e-momentum-tracker" data-pool="momentum" data-theme="romulan"/);
  assert.match(framed, /--ccf-c:#ff4a5a;--trw-c:#ff4a5a;/);
  assert.match(framed, /class="trw-title">Disruptor Hit</, 'title without the emoji');
  assert.equal(count(framed, /class="trw-wing/g), 2);
  assert.match(framed, /class="trw-body ccf-body">/, 'the body keeps .ccf-body, the wirers\' host');
  assert.ok(framed.includes('class="sta2e-damage-controls"'), 'body classes pass through');
});

check('Romulan body pass: tiles, notes and keys, no LCARS geometry or font left', () => {
  const inner = framed.slice(framed.indexOf('ccf-body">'));
  assert.equal(count(inner, /class="ccf-rom-tile"/g), 3);
  assert.match(inner, /class="ccf-rom-note" style="--tn-c:#cc6622;/);
  assert.doesNotMatch(inner, /border-radius|font-family|💥|⚠/);
  assert.match(inner, /color:#cc2233;/, 'a value keeps its colour');
});

check('Romulan body pass: buttons become keys in their own accent, layout and data kept', () => {
  const tags = framed.match(/<button\b[^>]*>/g);
  assert.equal(tags.length, 3);
  for (const t of tags) assert.doesNotMatch(t, /(?<![-\w])(background|border[-a-z]*|color)\s*:/);
  assert.match(tags[0], /class="sta2e-apply-damage" data-x="1"/);
  assert.match(tags[0], /--tck-a:#cc2233;/, 'a filled key keeps its fill as the accent');
  assert.match(tags[1], /--tck-a:#669966;/);
  assert.match(tags[2], /--tck-a:#22aa44;/, 'no colour falls back to the theme primary');
});

check('the spend panel pass is the same pass', () => {
  assert.equal(romulanBodyHtml('<button style="color:#ff4a5a">+</button>'), '<button style="--tck-a:#ff4a5a;--tck-ink:#140e00;">+</button>');
});

check('other eras keep their own frames or legacy markup', () => {
  theme = 'klingon';
  assert.match(lcarsChatCard({ title: 'T', body: damageBody, legacy }), /sta2e-chat-card--klingon tkc/);
  theme = 'lcars-tng';
  const tng = lcarsChatCard({ title: 'T', body: damageBody, legacy });
  assert.match(tng, /sta2e-chat-card--tng tbc/);
  assert.doesNotMatch(tng, /ccf-rom-|trw/);
  theme = 'blue';
  assert.equal(lcarsChatCard({ title: 'T', body: damageBody, legacy }), legacy());
  theme = 'romulan';
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
  TOKENS = { momentum: dot('#d8c050'), threat: dot('#cc2233') };
  // The stylesheets name the fonts relative to styles/; inline them for the page.
  const css = ['chat-card.css', 'task-card.css', 'task-card-tmp.css', 'task-card-romulan.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/(tmp|romulan)\/([^"]+)"\)/g,
      (_, d, f) => `url("data:font/woff2;base64,${fs.readFileSync(`${root}/fonts/${d}/${f}`).toString('base64')}")`);
  // The reroll tray exactly as _armCardSelection injects it, with the romulan tokens.
  const tray = `<div class="sta2e-reroll-tray" style="margin-top:5px;padding:5px 6px;background:rgba(255,255,255,0.04);border:1px solid #aacc33;border-radius:var(--tcx-tray-radius, 10px);font-family:'Arial Narrow',sans-serif;">
    <div style="font-size:8px;color:#aacc33;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:5px;text-align:center;">Targeting Solution: pick 1 die to reroll</div>
    <div style="display:flex;gap:5px;">
      <button type="button" class="sta2e-tray-confirm" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.06);border:1px solid #aacc33;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#aacc33;">Reroll Selected</button>
      <button type="button" class="sta2e-tray-cancel" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.03);border:1px solid #226633;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#226633;">Cancel</button>
    </div></div>`;
  const armed = renderRomulanTaskCard(view({ namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
    statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'FAIL', '']], passed: false,
    rerollButtons: view().rerollButtons.slice(0, 2), confirmLabel: 'Confirm Results (1 success)' },
  { taskLabel: 'Evasive Action', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 14 }, { value: 3, success: true }, { value: 18 }] }))
    // Arm the second reroll the way _armCardSelection does an unfilled key, dim the first, and append the tray.
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="ts"[^>]*style=")([^"]*)("[^>]*>)<span class="sta2e-rr-name">/,
      '$1$2background:rgba(255,255,255,0.06);border-color:#aacc33;color:#aacc33;$3<span class="sta2e-rr-name">▶ ')
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="detReroll"[^>]*style=")([^"]*)"/, '$1$2opacity:0.4;"')
    .replace(/(<div class="sta2e-working-actions sta2e-working-actions--rerolls[\s\S]*?<\/div>)(\s*<\/div>)/, `$1${tray}$2`);
  const injuryBody = `<div style="font-size:10px;color:#88cc88;margin-bottom:4px;">Centurion Velal ▸ Reman Insurgent</div>
    <div style="display:flex;gap:4px;">${tile('Severity', 4)}${tile('Protection', '−1')}${tile('Stress', '8 → 5', '#cc2233')}</div>
    <div style="margin-top:5px;padding:4px 6px;border:1px solid #001a00;border-left:3px solid #cc2233;color:#ff4a5a;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Deadly Injury</div>
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button style="flex:1;padding:5px;background:#cc2233;border:1px solid #cc2233;color:#000;font-weight:700;font-size:10px;">TAKE INJURY</button>
      <button style="flex:1;padding:5px;background:transparent;border:1px solid #aacc33;color:#aacc33;font-weight:700;font-size:10px;">AVOID · 2 THREAT</button>
    </div>`;
  const hazardBody = `<div style="font-size:10px;color:#88cc88;margin-bottom:4px;">Plasma Storm · Lingering</div>
    <div style="display:flex;gap:6px;align-items:center;font-size:10px;color:#88cc88;">Potency <span style="display:inline-block;padding:0 5px;border:1px solid #cc6622;color:#cc6622;border-radius:2px;">3</span>
      <label style="margin-left:auto;font-size:10px;"><input type="checkbox" checked> Established</label></div>
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button style="flex:1;padding:5px;background:#cc6622;border:1px solid #cc6622;color:#000;font-weight:700;font-size:10px;">BUILD &amp; APPLY</button>
      <button style="flex:1;padding:5px;background:transparent;border:1px solid #226633;color:#226633;font-weight:700;font-size:10px;">IGNORE</button>
    </div>`;
  const cards = [
    ['Working, everything on', renderRomulanTaskCard(view())],
    ['A reroll armed', armed],
    ['Confirmed, Momentum to bank', renderRomulanTaskCard(view({
      gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#d8c050' },
      poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: '', label: 'Add Momentum to Pool (+2)' },
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Decrypt Transmission', officerName: 'Cmdr. Toreth', shipDice: [], apAssistDice: [], crewDice: [{ value: 3, success: true }, { value: 1, success: true, crit: true }] }))],
    ['Failed', renderRomulanTaskCard(view({
      passed: false, finalResultLabel: 'Failed', namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 1, ''], ['Difficulty', 3, ''], ['Momentum', 0, ''], ['Complic.', 1, ''], ['Result', 'Failed', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Raise Shields', shipDice: [], apAssistDice: [], crewDice: [{ value: 12, success: true }, { value: 19, complication: true }] }))],
    ['Working, edit + confirm only', renderRomulanTaskCard(view({
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
      rerollButtons: [], succeedAtCostButton: { visible: false }, confirmLabel: 'Confirm Results (2 successes)',
      statCells: [['Successes', 2, ''], ['Difficulty', 1, ''], ['Momentum', 1, ''], ['Result', 'PASS', '']],
    }, { taskLabel: 'Scan for Lifesigns', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 5, success: true }, { value: 8, success: true }] }))],
    ['Assist roll', renderRomulanTaskCard(view({ showMakeYourOwnLuck: false, noteStrips: [], traitNotes: [], crewDiceHeading: 'Insight + Command (target: 13)' },
      { isAssistRoll: true, assistOfficerName: 'Cmdr. Toreth', crewDice: [{ value: 6, success: true }], shipDice: [], apAssistDice: [] }))],
    ['Ship damage (frame)', lcarsChatCard({ title: '💥 Disruptor Hit', accent: '#ff4a5a', body: damageBody, legacy })],
    ['Ground damage (frame)', lcarsChatCard({ title: 'Disruptor Pistol', accent: '#ff4a5a', body: injuryBody, legacy })],
    ['Hazard (frame)', lcarsChatCard({ title: '⚠️ Hazard Entry', accent: '#e08a2a', body: hazardBody, legacy })],
    ['Info card (frame, theme primary)', lcarsChatCard({ title: 'Sensor Contact', legacy,
      body: '<div style="font-size:11px;color:#88cc88;">Bearing 047 mark 15 · Medium range · Neutral Zone</div>' })],
  ];
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Romulan cards</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.chat-message{width:300px;background:#0e0e11;padding:6px;border-radius:6px}
.chat-message button{height:2rem}h4{margin:0 0 4px;font-size:11px;color:#888}</style>
<div class="grid">${cards.map(([t, h]) => `<div><h4>${t}</h4><div class="chat-message">${h}</div></div>`).join('')}</div>`);
  console.log(`preview: ${out}`);
}
process.exit(failed ? 1 : 0);
