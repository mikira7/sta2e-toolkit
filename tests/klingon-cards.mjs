// node tests/klingon-cards.mjs [--preview out.html]
//
// The Klingon Targeting Scope skins: the working task card (task-card-klingon.js)
// and the chat card frame's Klingon path (chat-card-frame.js). Checks the DOM
// contract the chat wiring depends on — the .sta2e-working-actions wrappers, the
// die markup, every button class and data-* attribute, no inline border-radius
// or font-family — that a key's colour is entirely inline and every key is
// data-filled, and that the frame puts the body on the scope with its LCARS
// shapes turned into scope parts. Both modules import only lcars-theme.js (and
// each other), so they load under node with the theme setting stubbed. The
// sibling of tests/ent-cards.mjs.
//
// --preview writes a page rendering every state against the real stylesheets,
// with the bundled fonts inlined.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let theme = 'klingon';
globalThis.game = { settings: { get: (_m, key) => key === 'hudTheme' ? theme : undefined } };

const { renderKlingonTaskCard, triangleMeter, keyStyle } = await import('../scripts/task-card-klingon.js');
const { lcarsChatCard, klingonBodyHtml } = await import('../scripts/chat-card-frame.js');

// ── A view shaped like buildPlayerRollCardHtml's ──────────────────────────────
// Die colours as diceRow writes them under klingon: crit gold, success the
// scope's phosphor (successDieColour), complication the token red.
const diceRow = (dice, pool = 'crew', opts = {}) => {
  const size = opts.size ?? 32;
  return `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;">${
    dice.map((d, i) => {
      const col = d.crit ? '#ffd84a' : d.success ? '#6fd24a' : d.complication ? '#ff1100' : '#aaaaaa';
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
  return `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="font-size:9px;color:#662200;font-weight:700;text-transform:uppercase;">${label}</span>`
    + `<span style="display:inline-flex;gap:3px;">${Array.from({ length: n }, () =>
      `<img src="${TOKENS[type]}" style="width:${size}px;height:${size}px;border-radius:50%;filter:drop-shadow(0 0 2px ${color});" />`).join('')}</span></span>`;
};
const rerollButtonBody = rb => `<span class="sta2e-rr-name">${rb.label}</span>${rb.cost ? `<span class="sta2e-rr-cost">${rb.cost}</span>` : ''}`;

function view(over = {}, roll = {}) {
  const rollData = {
    taskLabel: 'Fire Disruptors', officerName: 'Lt. Kargan',
    crewDice: [{ value: 1, success: true, crit: true }, { value: 9, success: true }, { value: 15 }, { value: 20, complication: true }],
    shipDice: [{ value: 7, success: true }],
    apAssistDice: [{ value: 17 }],
    pendingAssists: [{ name: 'Ens. Bekk', type: 'direct' }],
    confirmed: false, isAssistRoll: false, crewTarget: 12,
    ...roll,
  };
  return {
    rollData, diceRow, renderResourceTokens, rerollButtonBody, p: 'PAYLOAD',
    passed: true, finalResultLabel: 'Success',
    contextLeftLabel: 'Lt. Kargan', contextRightLabel: 'Comp Range 20',
    crewDiceHeading: 'Control + Security (target: 12)',
    shipDiceHeading: 'IKS Rotarran · Weapons + Security · (target: 10)',
    namedAssistBlocks: [{ die: { value: 4, success: true }, heading: 'Cmdr. Kurn — Assist Die', subHeading: 'Daring + Command' }],
    noteStrips: [
      { tone: 'warn', text: 'Assist dice may not be added: the crew die failed' },
      { tone: 'note', text: 'Persistent: +1 success, +1 complication' },
      { tone: 'bonus', text: 'Fire at Will: +1 bonus Momentum on success' },
    ],
    traitNotes: [{ name: 'Ion Storm', label: 'Difficulty', value: 1 }],
    statCells: [['Successes', 4, ''], ['Difficulty', 3, ''], ['Momentum', 1, ''], ['Complic.', 1, ''], ['Result', 'PASS', '']],
    interactiveActive: true, spentVisible: true,
    spentGroups: [['Momentum', 2, 'momentum', '#cc8800'], ['Threat', 1, 'threat', '#ff1100'], ['Personal Threat', 0, 'threat', '#662200']],
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
const working = renderKlingonTaskCard(view());

check('root carries the task card class, the Klingon class and the theme', () => {
  assert.match(working, /class="sta2e-task-card sta2e-task-card--klingon tkc" data-theme="klingon"/);
  assert.match(working, /--tkc-c:#6fd24a;/, 'a working card has the green phosphor');
  assert.match(working, /class="tkc-title">Fire Disruptors</);
  assert.match(working, /class="tkc-code">Working</);
  assert.match(working, /class="tkc-tri" aria-hidden="true">D3</, 'the lamp carries the Difficulty');
});

check('every working block is rendered, the readout on the scope and the keys below it', () => {
  for (const text of ['Lt. Kargan · Comp Range 20', 'Cmdr. Kurn — Assist Die', 'Daring + Command', 'Helm — Attack Pattern',
    'IKS Rotarran · Weapons + Security', 'T 12', 'T 10', 'Persistent', 'Fire at Will', 'Ion Storm: Difficulty (+1)',
    'Complic.', 'Spent', 'Pending Assists', 'Rerolls Available', 'Edit Results', 'Hit at Cost', 'Resolve HIT']) {
    assert.ok(working.includes(text), `missing: ${text}`);
  }
  const scopeAt = working.indexOf('class="tkc-scope"');
  assert.ok(scopeAt > 0 && scopeAt < working.indexOf('class="tkc-well"'), 'the dice sit on the scope');
  assert.ok(working.indexOf('tkc-result') < working.indexOf('sta2e-working-actions'), 'the keys follow the readout');
});

check('dice keep pool and index, with an <img> inside each', () => {
  assert.equal(count(working, /class="sta2e-card-die" data-pool="crew"/g), 4);
  assert.equal(count(working, /data-pool="named-assist" data-index="0"/g), 1);
  assert.equal(count(working, /data-pool="ap-assist"/g), 1);
  assert.equal(count(working, /data-pool="ship"/g), 1);
  assert.equal(count(working, /class="sta2e-card-die"[^>]*>\s*<img/g), 7);
  assert.equal(count(working, /class="tkc-well"/g), 4, 'one group per dice pool');
});

check('each action group sits in its own working-actions wrapper', () => {
  for (const m of ['assists', 'luck', 'rerolls', 'confirm']) {
    assert.match(working, new RegExp(`class="sta2e-working-actions sta2e-working-actions--${m} tkc-actions"`));
  }
  assert.match(working, /class="tkc-pad sta2e-task-rerolls"/, 'the reroll grid is the inner list, not the wrapper');
});

check('buttons keep their classes and data attributes', () => {
  assert.match(working, /class="sta2e-player-assist-roll[^"]*" data-filled="1"\s+data-payload="PAYLOAD" data-assist-index="0"/);
  assert.match(working, /class="sta2e-make-own-luck[^"]*" data-filled="1"\s+data-payload="PAYLOAD"/);
  assert.equal(count(working, /class="sta2e-player-reroll/g), 3);
  assert.match(working, /data-ability="chiefEngineer"\s+data-ability-label="Chief Engineer"/);
  assert.match(working, /<span class="sta2e-rr-name">Spend Determination<\/span><span class="sta2e-rr-cost">Multiple dice<\/span>/);
  assert.match(working, /class="sta2e-edit-roll-card[^"]*" data-filled="1" data-payload="PAYLOAD"/);
  assert.match(working, /class="sta2e-succeed-at-cost[^"]*" data-filled="1" data-payload="PAYLOAD"/);
  assert.match(working, /class="sta2e-player-confirm[^"]*" data-filled="1" data-payload="PAYLOAD"/);
});

check('every key is a filled plate, so arming lights it yellow', () => {
  const keys = working.match(/<(button|div) class="[^"]*tkc-key[^"]*"[^>]*>/g);
  assert.ok(keys.length >= 8);
  for (const k of keys) assert.match(k, /data-filled="1"/);
});

check("a key's colour is all inline, and nothing carries an inline radius or font", () => {
  for (const tag of working.match(/<button\b[^>]*>/g)) {
    assert.match(tag, /style="--k:#[0-9a-f]{6};background:linear-gradient\(180deg,#[0-9a-f]{6},#[0-9a-f]{6} 55%,#[0-9a-f]{6}\);color:#[0-9a-f]{6};"/);
  }
  // The dice and pool tokens are the stubs' markup above, not the skin's.
  const own = working.replace(/<span class="sta2e-card-die"[\s\S]*?<\/span><\/span>(<\/span>)?/g, '')
    .replace(/<img [^>]*>/g, '');
  assert.doesNotMatch(own, /border-radius|font-family/);
});

check('dark plates take light ink, bright ones dark ink', () => {
  assert.match(keyStyle('#ffd84a'), /color:#1a0200;/);
  assert.match(keyStyle('#7a5040'), /color:#ffe6dc;/);
});

check('the triangle meter lights the successes and reds the Difficulty', () => {
  assert.equal(triangleMeter(4, 6, 3),
    '<span class="tkc-tris" aria-hidden="true"><i class="d on"></i><i class="d on"></i><i class="d on"></i><i class="on"></i><i></i><i></i></span>');
  assert.match(working, /<span>Successes<\/span><b>4<\/b><span class="tkc-tris"/);
  assert.equal(count(working, /class="tkc-tris"/g), 1, 'only the Successes row carries a meter');
  const big = renderKlingonTaskCard(view({ statCells: [['Successes', 30, ''], ['Difficulty', 3, ''], ['Result', 'PASS', '']] }));
  assert.equal(count(big.match(/<span class="tkc-tris"[\s\S]*?<\/span>/)[0], /<i/g), 20, 'the meter is capped at twenty');
  assert.match(working, /class="tkc-row tkc-row--cpx"><span>Complic\.<\/span>/);
});

check('confirmed card: gold phosphor, Qapla\', pool button keeps its data, gained tokens show', () => {
  const html = renderKlingonTaskCard(view({
    gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#cc8800', autoBanked: false },
    poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: 'T1', label: 'Add Momentum to Pool (+2)' },
    statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
  }, { confirmed: true, pendingAssists: [] }));
  assert.match(html, /--tkc-c:#ffd84a;/);
  assert.match(html, /class="tkc-code">Success</);
  assert.match(html, /class="sta2e-add-to-pool[^"]*" data-filled="1"\s+data-pool="momentum"\s+data-amount="2"\s+data-token-id="T1"/);
  assert.match(html, /Gained/);
  assert.match(html, /tkc-result--pass"><strong>Success<\/strong><small>Qapla'<\/small>/);
  assert.doesNotMatch(html, /sta2e-player-confirm|sta2e-player-reroll|sta2e-working-actions--assists/);
});

check('a working card shows no flavour word yet', () => {
  assert.doesNotMatch(working, /Qapla'|bIlujpu'/);
});

check('confirmed with nothing to bank shows Completed', () => {
  const html = renderKlingonTaskCard(view({ poolButton: { visible: false } }, { confirmed: true }));
  assert.match(html, /class="sta2e-task-btn[^"]*"[^>]*>Completed</);
});

check('a failed card turns the phosphor and the result red', () => {
  const html = renderKlingonTaskCard(view({ passed: false, finalResultLabel: 'Failed' }, { confirmed: true }));
  assert.match(html, /--tkc-c:#ff5a40;/);
  assert.match(html, /tkc-result--fail"><strong>PASS<\/strong><small>bIlujpu'<\/small>/);
});

check('assist roll: amber phosphor, no lamp readout, Add to Task Roll, then Applied to', () => {
  const open = renderKlingonTaskCard(view({}, { isAssistRoll: true, assistOfficerName: 'Cmdr. Kurn' }));
  assert.match(open, /class="tkc-title">Assist — Cmdr. Kurn</);
  assert.match(open, /--tkc-c:#ffaa3a;/);
  assert.match(open, /class="tkc-tri" aria-hidden="true"><\/span>/);
  assert.match(open, /class="sta2e-assist-to-roll[^"]*" data-filled="1" data-payload="PAYLOAD"/);
  assert.doesNotMatch(open, /tkc-result|sta2e-player-confirm|sta2e-player-reroll/);
  const done = renderKlingonTaskCard(view({}, { isAssistRoll: true, assistApplied: 'Fire Disruptors' }));
  assert.match(done, /class="sta2e-task-btn[^"]*"[^>]*>Applied to: Fire Disruptors</);
});

check('succeed at cost reads COST on the readout, with no flavour word', () => {
  const html = renderKlingonTaskCard(view({ statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'COST', '']] },
    { succeedAtCost: true, confirmed: true }));
  assert.match(html, /tkc-result--cost"><strong>COST<\/strong><\/div>/);
});

// ── Chat card frame ─────────────────────────────────────────────────────────
const tile = (l, v, c = '#ddaa88') => `<div style="flex:1;padding:3px;border:1px solid #2a0000;border-radius:2px;text-align:center;font-family:'Arial Narrow',sans-serif;"><div style="font-size:8px;color:#662200;text-transform:uppercase;letter-spacing:0.08em;">${l}</div><div style="font-size:15px;font-weight:700;color:${c};">${v}</div></div>`;
const damageBody = `<div style="font-size:10px;color:#ddaa88;margin-bottom:4px;">💥 Romulan Warbird ▸ IKS Rotarran</div>
    <div style="display:flex;gap:4px;">${tile('Damage', 8)}${tile('Resist', '−3')}${tile('Shields', '12 → 7', '#ff4422')}</div>
    <div style="margin-top:5px;padding:3px 6px;border-left:3px solid #cc8800;font-size:10px;color:#ffffff;background:rgba(204,136,0,0.08);">⚠️ Shields below 50%: one breach to Weapons</div>
    <div class="sta2e-damage-controls" style="display:flex;gap:4px;margin-top:6px;">
      <button class="sta2e-apply-damage" data-x="1" style="flex:1;padding:5px;background:#cc1111;border:1px solid #cc1111;border-radius:2px;color:#000;font-weight:700;font-size:10px;font-family:'Arial Narrow',sans-serif;">APPLY DAMAGE</button>
      <button class="sta2e-undo" style="flex:1;padding:5px;background:transparent;border:1px solid #884400;border-radius:2px;color:#884400;font-weight:700;font-size:10px;">UNDO</button>
      <button class="sta2e-plain">Plain</button>
    </div>`;
const legacy = () => '<div class="legacy">old</div>';
const framed = lcarsChatCard({ title: '💥 Plasma Torpedo Hit', accent: '#ff4422', body: damageBody, legacy,
  rootClass: 'sta2e-momentum-tracker', attrs: 'data-pool="momentum"' });

check('Klingon frame: head and scope, root identity carried forward', () => {
  assert.match(framed, /class="sta2e-chat-card sta2e-chat-card--klingon tkc sta2e-momentum-tracker" data-pool="momentum" data-theme="klingon"/);
  assert.match(framed, /--ccf-c:#ff4422;--tkc-c:#ff4422;/);
  assert.match(framed, /class="tkc-title">Plasma Torpedo Hit</, 'title without the emoji');
  assert.match(framed, /<div class="tkc-head">/);
  assert.match(framed, /class="tkc-scope ccf-body">/, 'the body sits on the scope and keeps .ccf-body, the wirers\' host');
  assert.ok(framed.includes('class="sta2e-damage-controls"'), 'body classes pass through');
});

check('Klingon body pass: tiles, notes and keys, no LCARS geometry or font left', () => {
  const inner = framed.slice(framed.indexOf('ccf-body">'));
  assert.equal(count(inner, /class="ccf-kli-tile"/g), 3);
  assert.match(inner, /class="ccf-kli-note" style="--tn-c:#cc8800;/);
  assert.doesNotMatch(inner, /border-radius|font-family|💥|⚠/);
  assert.match(inner, /color:#ff4422;/, 'a value keeps its colour');
});

check('Klingon body pass: buttons become plates in their own accent, layout and data kept', () => {
  const tags = framed.match(/<button\b[^>]*>/g);
  assert.equal(tags.length, 3);
  for (const t of tags) assert.doesNotMatch(t, /(?<![-\w])(background|border[-a-z]*|color)\s*:/);
  assert.match(tags[0], /class="sta2e-apply-damage" data-x="1"/);
  assert.match(tags[0], /--tck-a:#cc1111;/, 'a filled key keeps its fill as the accent');
  assert.match(tags[1], /--tck-a:#884400;/);
  assert.match(tags[2], /--tck-a:#cc1111;/, 'no colour falls back to the theme primary');
});

check('the spend panel pass is the same pass', () => {
  assert.equal(klingonBodyHtml('<button style="color:#ff4422">+</button>'), '<button style="--tck-a:#ff4422;--tck-ink:#fff4ee;">+</button>');
});

check('other eras keep their own frames or legacy markup', () => {
  theme = 'ent-panel';
  assert.match(lcarsChatCard({ title: 'T', body: damageBody, legacy }), /sta2e-chat-card--ent tec/);
  theme = 'lcars-tng';
  const tng = lcarsChatCard({ title: 'T', body: damageBody, legacy });
  assert.match(tng, /sta2e-chat-card--tng tbc/);
  assert.doesNotMatch(tng, /ccf-kli-|tkc/);
  theme = 'blue';
  assert.equal(lcarsChatCard({ title: 'T', body: damageBody, legacy }), legacy());
  theme = 'klingon';
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
  TOKENS = { momentum: dot('#cc8800'), threat: dot('#ff1100') };
  // The stylesheets name the fonts relative to styles/; inline them for the page.
  const css = ['chat-card.css', 'task-card.css', 'task-card-tmp.css', 'task-card-klingon.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/(tmp|klingon)\/([^"]+)"\)/g,
      (_, d, f) => `url("data:font/woff2;base64,${fs.readFileSync(`${root}/fonts/${d}/${f}`).toString('base64')}")`);
  // The reroll tray exactly as _armCardSelection injects it, with the klingon tokens.
  const tray = `<div class="sta2e-reroll-tray" style="margin-top:5px;padding:5px 6px;background:rgba(255,255,255,0.04);border:1px solid #cc8800;border-radius:var(--tcx-tray-radius, 10px);font-family:'Arial Narrow',sans-serif;">
    <div style="font-size:8px;color:#cc8800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:5px;text-align:center;">Targeting Solution: pick 1 die to reroll</div>
    <div style="display:flex;gap:5px;">
      <button type="button" class="sta2e-tray-confirm" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.06);border:1px solid #cc8800;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#cc8800;">Reroll Selected</button>
      <button type="button" class="sta2e-tray-cancel" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.03);border:1px solid #662200;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#662200;">Cancel</button>
    </div></div>`;
  const armed = renderKlingonTaskCard(view({ namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
    statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'FAIL', '']], passed: false,
    rerollButtons: view().rerollButtons.slice(0, 2), confirmLabel: 'Confirm Results (1 success)' },
  { taskLabel: 'Evasive Action', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 14 }, { value: 3, success: true }, { value: 18 }] }))
    // Arm the second reroll the way _armCardSelection does a filled key, dim the first, and append the tray.
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="ts"[^>]*style=")([^"]*)("[^>]*>)<span class="sta2e-rr-name">/,
      '$1$2background:#cc8800;border-color:#cc8800;color:#0a0000;$3<span class="sta2e-rr-name">▶ ')
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="detReroll"[^>]*style=")([^"]*)"/, '$1$2opacity:0.4;"')
    .replace(/(<div class="sta2e-working-actions sta2e-working-actions--rerolls[\s\S]*?<\/div>)(\s*<\/div>)/, `$1${tray}$2`)
    .replace(/(<span class="sta2e-card-die" data-pool="crew" data-index="0" style=")([^"]*)("[^>]*>)<img([^>]*?)style="([^"]*)"/,
      '$1$2outline:1px solid #cc8800;box-shadow:0 0 6px #cc8800;$3<img$4style="$5opacity:0.8;filter:sepia(1) saturate(6) hue-rotate(4deg) brightness(1.15) drop-shadow(0 0 5px #cc8800);"');
  const injuryBody = `<div style="font-size:10px;color:#ddaa88;margin-bottom:4px;">Warrior Kor ▸ Jem'Hadar Soldier</div>
    <div style="display:flex;gap:4px;">${tile('Severity', 4)}${tile('Protection', '−1')}${tile('Stress', '8 → 5', '#ff4422')}</div>
    <div style="margin-top:5px;padding:4px 6px;border:1px solid #2a0000;border-left:3px solid #ff1100;color:#ff1100;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Deadly Injury</div>
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button style="flex:1;padding:5px;background:#cc1111;border:1px solid #cc1111;color:#000;font-weight:700;font-size:10px;">TAKE INJURY</button>
      <button style="flex:1;padding:5px;background:transparent;border:1px solid #cc8800;color:#cc8800;font-weight:700;font-size:10px;">AVOID · 2 THREAT</button>
    </div>`;
  const hazardBody = `<div style="font-size:10px;color:#ddaa88;margin-bottom:4px;">Ion Storm · Lingering</div>
    <div style="display:flex;gap:6px;align-items:center;font-size:10px;color:#ddaa88;">Potency <span style="display:inline-block;padding:0 5px;border:1px solid #ff4400;color:#ff4400;border-radius:2px;">3</span>
      <label style="margin-left:auto;font-size:10px;"><input type="checkbox" checked> Established</label></div>
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button style="flex:1;padding:5px;background:#ff4400;border:1px solid #ff4400;color:#000;font-weight:700;font-size:10px;">BUILD &amp; APPLY</button>
      <button style="flex:1;padding:5px;background:transparent;border:1px solid #662200;color:#662200;font-weight:700;font-size:10px;">IGNORE</button>
    </div>`;
  const cards = [
    ['Working, everything on', renderKlingonTaskCard(view())],
    ['A reroll armed', armed],
    ['Confirmed, Momentum to bank', renderKlingonTaskCard(view({
      gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#cc8800' },
      poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: '', label: 'Add Momentum to Pool (+2)' },
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Analyse Anomaly', officerName: 'Cmdr. Kurn', shipDice: [], apAssistDice: [], crewDice: [{ value: 3, success: true }, { value: 1, success: true, crit: true }] }))],
    ['Failed', renderKlingonTaskCard(view({
      passed: false, finalResultLabel: 'Failed', namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 1, ''], ['Difficulty', 3, ''], ['Momentum', 0, ''], ['Complic.', 1, ''], ['Result', 'Failed', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Raise Shields', shipDice: [], apAssistDice: [], crewDice: [{ value: 12, success: true }, { value: 19, complication: true }] }))],
    ['Working, edit + confirm only', renderKlingonTaskCard(view({
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
      rerollButtons: [], succeedAtCostButton: { visible: false }, confirmLabel: 'Confirm Results (2 successes)',
      statCells: [['Successes', 2, ''], ['Difficulty', 1, ''], ['Momentum', 1, ''], ['Result', 'PASS', '']],
    }, { taskLabel: 'Scan for Lifesigns', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 5, success: true }, { value: 8, success: true }] }))],
    ['Assist roll', renderKlingonTaskCard(view({ showMakeYourOwnLuck: false, noteStrips: [], traitNotes: [], crewDiceHeading: 'Daring + Command (target: 13)' },
      { isAssistRoll: true, assistOfficerName: 'Cmdr. Kurn', crewDice: [{ value: 6, success: true }], shipDice: [], apAssistDice: [] }))],
    ['Ship damage (frame)', lcarsChatCard({ title: '💥 Plasma Torpedo Hit', accent: '#ff4422', body: damageBody, legacy })],
    ['Ground damage (frame)', lcarsChatCard({ title: "Bat'leth Strike", accent: '#ff1100', body: injuryBody, legacy })],
    ['Hazard (frame)', lcarsChatCard({ title: '⚠️ Hazard Entry', accent: '#ff4400', body: hazardBody, legacy })],
    ['Info card (frame, theme primary)', lcarsChatCard({ title: 'Sensor Contact', legacy,
      body: '<div style="font-size:11px;color:#ddaa88;">Bearing 047 mark 15 · Medium range · Mempa Sector</div>' })],
  ];
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Klingon cards</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.chat-message{width:300px;background:#0e0e11;padding:6px;border-radius:6px}
.chat-message button{height:2rem}h4{margin:0 0 4px;font-size:11px;color:#888}</style>
<div class="grid">${cards.map(([t, h]) => `<div><h4>${t}</h4><div class="chat-message">${h}</div></div>`).join('')}</div>`);
  console.log(`preview: ${out}`);
}
process.exit(failed ? 1 : 0);
