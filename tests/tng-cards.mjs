// node tests/tng-cards.mjs [--preview out.html]
//
// The TNG Bracket Console skins: the working task card (task-card-tng.js) and
// the chat card frame's TNG path (chat-card-frame.js). Checks the DOM contract
// the chat wiring depends on — the .sta2e-working-actions wrappers, the die
// markup, every button class and data-* attribute, data-filled on keys, no
// inline border-radius — and that the frame wraps a body without touching its
// classes or its button colours. Both modules import only lcars-theme.js (and
// each other), so they load under node with the theme setting stubbed. The
// sibling of tests/tmp-cards.mjs.
//
// --preview writes a page rendering every state against the real stylesheets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let theme = 'lcars-tng';
globalThis.game = { settings: { get: (_m, key) => key === 'hudTheme' ? theme : undefined } };

const { renderTngTaskCard } = await import('../scripts/task-card-tng.js');
const { lcarsChatCard, tngBodyHtml } = await import('../scripts/chat-card-frame.js');
const { canonicalThemeKey, migrateRetiredThemes, getActiveLcThemeKey, isBracketTheme } = await import('../scripts/lcars-theme.js');

// ── A view shaped like buildPlayerRollCardHtml's ──────────────────────────────
const diceRow = (dice, pool = 'crew', opts = {}) => {
  const size = opts.size ?? 32;
  return `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;">${
    dice.map((d, i) => {
      const col = d.crit ? '#ffef3a' : d.success ? '#f6c36d' : d.complication ? '#d92222' : '#6a5418';
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
  return `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="font-size:9px;color:#b78a20;font-weight:700;text-transform:uppercase;">${label}</span>`
    + `<span style="display:inline-flex;gap:3px;">${Array.from({ length: n }, () =>
      `<img src="${TOKENS[type]}" style="width:${size}px;height:${size}px;border-radius:50%;filter:drop-shadow(0 0 2px ${color});" />`).join('')}</span></span>`;
};
const rerollButtonBody = rb => `<span class="sta2e-rr-name">${rb.label}</span>${rb.cost ? `<span class="sta2e-rr-cost">${rb.cost}</span>` : ''}`;

function view(over = {}, roll = {}) {
  const rollData = {
    taskLabel: 'Fire Phasers', officerName: 'Lt. Worf',
    crewDice: [{ value: 1, success: true, crit: true }, { value: 9, success: true }, { value: 15 }, { value: 20, complication: true }],
    shipDice: [{ value: 7, success: true }],
    apAssistDice: [{ value: 17 }],
    pendingAssists: [{ name: 'Cmdr. Riker', type: 'direct' }],
    confirmed: false, isAssistRoll: false, crewTarget: 12,
    ...roll,
  };
  return {
    rollData, diceRow, renderResourceTokens, rerollButtonBody, p: 'PAYLOAD',
    passed: true, finalResultLabel: 'Success',
    contextLeftLabel: 'Lt. Worf', contextRightLabel: 'Comp Range 20',
    crewDiceHeading: 'Control + Security (target: 12)',
    shipDiceHeading: 'USS Enterprise · Weapons + Security · (target: 10)',
    namedAssistBlocks: [{ die: { value: 4, success: true }, heading: 'Lt. Cmdr. Data — Assist Die', subHeading: 'Reason + Science' }],
    noteStrips: [
      { tone: 'warn', text: 'Assist dice may not be added: the crew die failed' },
      { tone: 'note', text: 'Persistent: +1 success, +1 complication' },
      { tone: 'bonus', text: 'Call Out Targets: +1 bonus Momentum on success' },
    ],
    traitNotes: [{ name: 'Nebula Interference', label: 'Difficulty', value: 1 }],
    statCells: [['Successes', 4, ''], ['Difficulty', 3, ''], ['Momentum', 1, ''], ['Complic.', 1, ''], ['Result', 'PASS', '']],
    interactiveActive: true, spentVisible: true,
    spentGroups: [['Momentum', 2, 'momentum', '#f2c77a'], ['Threat', 1, 'threat', '#d92222'], ['Personal Threat', 0, 'threat', '#c0a200']],
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
const segsOf = (html, label) => html.match(new RegExp(`<span>${label}</span><span class="tbc-segs"[^>]*>(.*?)</span>`))[1];

// ── Task card ──────────────────────────────────────────────────────────────
const working = renderTngTaskCard(view());

check('root carries the task card class, the TNG class, the frame class and the theme', () => {
  assert.match(working, /class="sta2e-task-card sta2e-task-card--tng tbc" data-theme="lcars-tng"/);
  assert.match(working, /--tbc-c:#f6a726;/, 'a working card has an orange frame');
});

check('the bracket frame: title in the top gap, status in the bottom', () => {
  assert.match(working, /class="tbc-title">Fire Phasers</);
  assert.equal(count(working, /class="tbc-brk"/g), 2);
  assert.equal(count(working, /class="tbc-brk tbc-brk--r"/g), 2);
  assert.match(working, /class="tbc-code">Working</);
});

check('every working block is rendered', () => {
  for (const text of ['Lt. Worf · Comp Range 20', 'Lt. Cmdr. Data — Assist Die', 'Reason + Science', 'Helm — Attack Pattern',
    'USS Enterprise · Weapons + Security', 'T 12', 'T 10', 'Persistent', 'Call Out Targets', 'Nebula Interference: Difficulty (+1)',
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
});

check('each action group sits in its own working-actions wrapper', () => {
  for (const m of ['assists', 'luck', 'rerolls', 'confirm']) {
    assert.match(working, new RegExp(`class="sta2e-working-actions sta2e-working-actions--${m} tbc-actions"`));
  }
  assert.match(working, /class="tbc-pad sta2e-task-rerolls"/, 'the reroll grid is the inner list, not the wrapper');
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

check('rerolls, luck and assists carry data-filled so arming lights the key', () => {
  for (const tag of working.match(/<button class="sta2e-(player-reroll|make-own-luck|player-assist-roll)[^>]*>/g)) {
    assert.match(tag, /data-filled="1"/);
  }
});

check("a key's colour is inline, and neither keys nor root carry an inline border-radius", () => {
  for (const tag of working.match(/<button\b[^>]*>/g)) {
    assert.match(tag, /style="background:#[0-9a-f]{6};color:#000000;"/);
    assert.doesNotMatch(tag, /border-radius/);
  }
  assert.doesNotMatch(working.match(/<div class="sta2e-task-card[^>]*>/)[0], /border-radius/);
});

check('the root carries no inline font, so the bundled Antonio applies', () => {
  assert.doesNotMatch(working.match(/<div class="sta2e-task-card[^>]*>/)[0], /font-family/);
});

check('the confirm key is the wide one, so the pad rounds the others in pairs', () => {
  assert.match(working, /class="sta2e-player-confirm tbc-key tbc-key--wide"/);
  assert.doesNotMatch(working, /class="sta2e-edit-roll-card tbc-key tbc-key--wide"/);
});

check('gauges: one per readout, complications marked, a segment lit per point', () => {
  assert.equal(count(working, /class="tbc-gauge[ "]/g), 4);
  assert.match(working, /class="tbc-gauge tbc-gauge--cpx" style="--tbc-g:#d92222;"><span>Complic\.<\/span>/);
  const succ = segsOf(working, 'Successes');
  assert.equal(count(succ, /<i>/g), 4, 'four lit');
  assert.equal(count(succ, /tbc-seg--off/g), 2, 'padded to six');
});

check('a large value caps its gauge at ten segments', () => {
  const html = renderTngTaskCard(view({ statCells: [['Successes', 14, ''], ['Result', 'PASS', '']] }));
  assert.equal(count(segsOf(html, 'Successes'), /<i/g), 10);
  assert.match(html, /<b>14<\/b>/);
});

check('confirmed card: green frame, pool button keeps its data, gained tokens show', () => {
  const html = renderTngTaskCard(view({
    gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#c0a200', autoBanked: false },
    poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: 'T1', label: 'Add Momentum to Pool (+2)' },
    statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
  }, { confirmed: true, pendingAssists: [] }));
  assert.match(html, /--tbc-c:#48c76b;/);
  assert.match(html, /class="tbc-code">Success</);
  assert.match(html, /class="sta2e-add-to-pool[^"]*"\s+data-pool="momentum"\s+data-amount="2"\s+data-token-id="T1"/);
  assert.match(html, /Gained/);
  assert.doesNotMatch(html, /sta2e-player-confirm|sta2e-player-reroll|sta2e-working-actions--assists/);
});

check('confirmed with nothing to bank shows Completed', () => {
  const html = renderTngTaskCard(view({ poolButton: { visible: false } }, { confirmed: true }));
  assert.match(html, /class="sta2e-task-btn[^"]*"[^>]*>Completed</);
});

check('a failed card turns the frame rose and the result red', () => {
  const html = renderTngTaskCard(view({ passed: false, finalResultLabel: 'Failed' }, { confirmed: true }));
  assert.match(html, /--tbc-c:#cc6666;/);
  assert.match(html, /tbc-result--fail/);
});

check('assist roll: blue frame, Add to Task Roll, then Applied to', () => {
  const open = renderTngTaskCard(view({}, { isAssistRoll: true, assistOfficerName: 'Lt. Cmdr. Data' }));
  assert.match(open, /class="tbc-title">Assist — Lt. Cmdr. Data</);
  assert.match(open, /--tbc-c:#9999ff;/);
  assert.match(open, /sta2e-working-actions--assist-apply/);
  assert.match(open, /class="sta2e-assist-to-roll[^"]*" data-payload="PAYLOAD"/);
  assert.doesNotMatch(open, /tbc-result|sta2e-player-confirm|sta2e-player-reroll/);
  const done = renderTngTaskCard(view({}, { isAssistRoll: true, assistApplied: 'Fire Phasers' }));
  assert.match(done, /class="sta2e-task-btn[^"]*"[^>]*>Applied to: Fire Phasers</);
});

check('succeed at cost reads COST on the readout', () => {
  const html = renderTngTaskCard(view({ statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'COST', '']] },
    { succeedAtCost: true }));
  assert.match(html, /tbc-result--cost"><strong>COST</);
});

// ── Chat card frame ─────────────────────────────────────────────────────────
const body = `<div class="sta2e-damage-controls">
  <button class="sta2e-apply-damage" data-x="1" style="flex:1;padding:4px;background:#cc6666;border:1px solid #cc6666;border-radius:2px;color:#000;font-size:10px;">Apply Damage</button>
  <button class="sta2e-undo" style="background:transparent;border:1px solid #f6a726;color:#f6a726;">Undo</button>
</div>`;
const legacy = () => '<div class="legacy">old</div>';
const framed = lcarsChatCard({ title: 'Photon Torpedo Hit', accent: '#cc6666', body, legacy, rootClass: 'sta2e-momentum-tracker', attrs: 'data-pool="momentum"' });

check('TNG frame: brackets, title, root identity carried forward', () => {
  assert.match(framed, /class="sta2e-chat-card sta2e-chat-card--tng tbc sta2e-momentum-tracker" data-pool="momentum" data-theme="lcars-tng"/);
  assert.match(framed, /--ccf-c:#cc6666;--tbc-c:#cc6666;/);
  assert.match(framed, /class="tbc-title">Photon Torpedo Hit</);
  assert.match(framed, /class="tbc-body ccf-body">/, 'the body keeps .ccf-body, the wirers\' host');
  assert.equal(count(framed, /class="tbc-brk/g), 4);
  assert.ok(framed.includes('class="sta2e-damage-controls"'), 'body classes pass through');
});

check('TNG frame: buttons keep their colours and lose only the inline radius', () => {
  const tags = framed.match(/<button\b[^>]*>/g);
  assert.equal(tags.length, 2);
  for (const t of tags) assert.doesNotMatch(t, /border-radius/);
  assert.match(tags[0], /background:#cc6666;border:1px solid #cc6666;color:#000;/);
  assert.doesNotMatch(framed, /--tck-a/);
});

check('TNG body pass strips the inline LCARS font and keeps any other', () => {
  const html = tngBodyHtml(`<div style="color:#fff;font-family:'Arial Narrow','Roboto Condensed',sans-serif;font-size:10px;">a</div>`
    + `<span style="font-family: 'Arial Narrow', sans-serif">b</span><code style="font-family:monospace;">c</code>`
    + `<button style="border-radius:2px;font-family:'Arial Narrow';color:#000;">d</button>`);
  assert.doesNotMatch(html, /Arial Narrow/);
  assert.match(html, /<div style="color:#fff;font-size:10px;">a/);
  assert.match(html, /font-family:monospace;/);
  assert.match(html, /<button style="color:#000;">d/);
  const framedFont = lcarsChatCard({ title: 'T', legacy, body: `<div style="font-family:'Arial Narrow',sans-serif;">x</div>` });
  // The root's --cc-font variable still names the stack; only the body is checked.
  assert.match(framedFont, /class="tbc-body ccf-body"><div style="">x</, 'the frame runs the pass on its body');
});

check('TNG frame defaults to the theme primary with no accent', () => {
  assert.match(lcarsChatCard({ title: 'T', body, legacy }), /--tbc-c:#f6a726;/);
});

check('other eras keep their own frames or legacy markup', () => {
  theme = 'tos-panel';
  assert.match(lcarsChatCard({ title: 'T', body, legacy }), /sta2e-chat-card--tos/);
  theme = 'tmp-console';
  assert.match(lcarsChatCard({ title: 'T', body, legacy }), /sta2e-chat-card--tmp/);
  theme = 'blue';
  assert.equal(lcarsChatCard({ title: 'T', body, legacy }), legacy());
  theme = 'lcars-tng';
});

// ── First Contact (lcars-fc) ────────────────────────────────────────────────
check('First Contact wears the Bracket Console in its own palette', () => {
  theme = 'lcars-fc';
  const html = renderTngTaskCard(view());
  assert.match(html, /class="sta2e-task-card sta2e-task-card--tng tbc" data-theme="lcars-fc"/);
  assert.match(html, /--tbc-c:#6a86cc;/, 'a working card has a periwinkle frame');
  assert.match(html, /class="sta2e-player-confirm[^"]*"[^>]*style="background:#ff9c33;/, 'the resolving key is orange');
  assert.doesNotMatch(html, /#f6a726/, 'no TNG orange in the frame or keys');
  const done = renderTngTaskCard(view({ passed: false, finalResultLabel: 'Failed' }, { confirmed: true }));
  assert.match(done, /--tbc-c:#cf5a4e;/);
  const card = lcarsChatCard({ title: 'Photon Torpedo Hit', accent: '#d9443a', body, legacy });
  assert.match(card, /sta2e-chat-card--tng tbc"\s+data-theme="lcars-fc"/);
  assert.match(card, /--tbc-c:#d9443a;/);
  assert.match(lcarsChatCard({ title: 'T', body, legacy }), /--tbc-c:#7b93d1;/, 'no accent: the theme primary');
  theme = 'lcars-tng';
});

check('the retired blue theme resolves to First Contact', () => {
  assert.equal(canonicalThemeKey('lcars-tng-blue'), 'lcars-fc');
  assert.equal(canonicalThemeKey('lcars-tng'), 'lcars-tng');
  assert.ok(isBracketTheme('lcars-fc') && isBracketTheme('lcars-tng') && !isBracketTheme('blue'));
  theme = 'lcars-tng-blue';
  assert.equal(getActiveLcThemeKey(), 'lcars-fc');
  assert.match(lcarsChatCard({ title: 'T', body, legacy }), /data-theme="lcars-fc"/);
  theme = 'lcars-tng';
});

// Async: run before the summary below.
{
  const saved = globalThis.game;
  const store = { hudTheme: 'lcars-tng-blue', campaigns: { list: [{ id: 'a', theme: 'lcars-tng-blue' }, { id: 'b', theme: 'tos-panel' }, { id: 'c' }] } };
  const writes = [];
  globalThis.game = { settings: {
    get: (_m, k) => store[k],
    set: async (_m, k, v) => { writes.push(k); store[k] = v; },
  } };
  try {
    const changed = await migrateRetiredThemes();
    const again = await migrateRetiredThemes();
    check('migration rewrites the setting and campaigns once, and leaves others alone', () => {
      assert.equal(changed, true);
      assert.equal(store.hudTheme, 'lcars-fc');
      assert.deepEqual(store.campaigns.list, [{ id: 'a', theme: 'lcars-fc' }, { id: 'b', theme: 'tos-panel' }, { id: 'c' }]);
      assert.deepEqual(writes, ['hudTheme', 'campaigns']);
      assert.equal(again, false, 'a second run writes nothing');
    });
  } finally { globalThis.game = saved; }
}

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
  // Plain dots for the pool tokens keep the page small enough to open quickly.
  const dot = c => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="${c}"/></svg>`).toString('base64')}`;
  TOKENS = { momentum: dot('#f2c77a'), threat: dot('#d92222') };
  // The stylesheet names the font relative to styles/; inline it for the page.
  const css = ['chat-card.css', 'task-card.css', 'task-card-tng.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/tng\/([^"]+)"\)/g,
      (_, f) => `url("data:font/woff2;base64,${fs.readFileSync(`${root}/fonts/tng/${f}`).toString('base64')}")`);
  // The reroll tray exactly as _armCardSelection injects it, with the TNG tokens.
  const tray = `<div class="sta2e-reroll-tray" style="margin-top:5px;padding:5px 6px;background:rgba(255,255,255,0.04);border:1px solid #ffef3a;border-radius:var(--tcx-tray-radius, 10px);font-family:'Arial Narrow',sans-serif;">
    <div style="font-size:8px;color:#ffef3a;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:5px;text-align:center;">Targeting Solution: pick 1 die to reroll</div>
    <div style="display:flex;gap:5px;">
      <button type="button" class="sta2e-tray-confirm" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.06);border:1px solid #ffef3a;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#ffef3a;">Reroll Selected</button>
      <button type="button" class="sta2e-tray-cancel" style="flex:1;padding:5px 8px;background:rgba(255,255,255,0.03);border:1px solid #b78a20;border-radius:var(--tcx-btn-radius, 9px);font-size:10px;font-weight:700;color:#b78a20;">Cancel</button>
    </div></div>`;
  const armed = renderTngTaskCard(view({ namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
    statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'FAIL', '']], passed: false,
    rerollButtons: view().rerollButtons.slice(0, 2), confirmLabel: 'Confirm Results (1 success)' },
  { taskLabel: 'Evasive Action', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 14 }, { value: 3, success: true }, { value: 18 }] }))
    // Arm the second reroll the way _armCardSelection does, dim the first, and append the tray.
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="ts"[^>]*style=")([^"]*)("[^>]*>)<span class="sta2e-rr-name">/,
      '$1$2background:#ffef3a;border-color:#ffef3a;color:#000000;$3<span class="sta2e-rr-name">▶ ')
    .replace(/(<button class="sta2e-player-reroll[^>]*data-ability="detReroll"[^>]*style=")([^"]*)"/, '$1$2opacity:0.4;"')
    .replace(/(<div class="sta2e-working-actions sta2e-working-actions--rerolls[\s\S]*?<\/div>)(\s*<\/div>)/, `$1${tray}$2`)
    .replace(/(<span class="sta2e-card-die" data-pool="crew" data-index="0" style=")([^"]*)("[^>]*>)<img([^>]*?)style="([^"]*)"/,
      '$1$2outline:1px solid #ffef3a;box-shadow:0 0 6px #ffef3a;$3<img$4style="$5opacity:0.8;filter:sepia(1) saturate(6) hue-rotate(4deg) brightness(1.15) drop-shadow(0 0 5px #ffef3a);"');
  // A ship damage body as lcarsCard bodies write it: bordered stat tiles and keys.
  const tile = (l, v, c = '#f6c36d') => `<div style="flex:1;padding:3px;border:1px solid #403000;border-radius:2px;text-align:center;"><div style="font-size:8px;color:#b78a20;text-transform:uppercase;letter-spacing:0.08em;">${l}</div><div style="font-size:15px;font-weight:700;color:${c};">${v}</div></div>`;
  const damageBody = `<div style="font-size:10px;color:#f6c36d;margin-bottom:4px;">U.S.S. Enterprise ▸ I.R.W. Haakona</div>
    <div style="display:flex;gap:4px;">${tile('Damage', 8)}${tile('Resist', '−3')}${tile('Shields', '12 → 7', '#99ccff')}</div>
    <div style="margin-top:5px;padding:3px 6px;border-left:3px solid #ffef3a;font-size:10px;color:#f2f2f2;">Shields below 50%: one breach to Weapons</div>
    <div class="sta2e-damage-controls" style="display:flex;gap:4px;margin-top:6px;">
      <button style="flex:1;padding:5px;background:#cc6666;border:1px solid #cc6666;border-radius:2px;color:#000;font-weight:700;font-size:10px;">APPLY DAMAGE</button>
      <button style="flex:1;padding:5px;background:transparent;border:1px solid #f6a726;border-radius:2px;color:#f6a726;font-weight:700;font-size:10px;">UNDO</button>
    </div>`;
  const fc = fn => { theme = 'lcars-fc'; try { return fn(); } finally { theme = 'lcars-tng'; } };
  const cards = [
    ['Working, everything on', renderTngTaskCard(view())],
    ['A reroll armed', armed],
    ['Confirmed, Momentum to bank', renderTngTaskCard(view({
      gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#c0a200' },
      poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: '', label: 'Add Momentum to Pool (+2)' },
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Analyse Anomaly', shipDice: [], apAssistDice: [], crewDice: [{ value: 3, success: true }, { value: 1, success: true, crit: true }] }))],
    ['Failed', renderTngTaskCard(view({
      passed: false, finalResultLabel: 'Failed', namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 1, ''], ['Difficulty', 3, ''], ['Momentum', 0, ''], ['Complic.', 1, ''], ['Result', 'Failed', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Modulate Shields', shipDice: [], apAssistDice: [], crewDice: [{ value: 12, success: true }, { value: 19, complication: true }] }))],
    ['Working, edit + confirm only', renderTngTaskCard(view({
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false, showMakeYourOwnLuck: false,
      rerollButtons: [], succeedAtCostButton: { visible: false }, confirmLabel: 'Confirm Results (2 successes)',
      statCells: [['Successes', 2, ''], ['Difficulty', 1, ''], ['Momentum', 1, ''], ['Result', 'PASS', '']],
    }, { taskLabel: 'Scan for Lifesigns', shipDice: [], apAssistDice: [], pendingAssists: [], crewDice: [{ value: 5, success: true }, { value: 8, success: true }] }))],
    ['Assist roll', renderTngTaskCard(view({ showMakeYourOwnLuck: false, noteStrips: [], traitNotes: [], crewDiceHeading: 'Reason + Science (target: 13)' },
      { isAssistRoll: true, assistOfficerName: 'Lt. Cmdr. Data', crewDice: [{ value: 6, success: true }], shipDice: [], apAssistDice: [] }))],
    ['Damage card (frame)', lcarsChatCard({ title: 'Photon Torpedo Hit', accent: '#cc6666', body: damageBody, legacy })],
    ['First Contact: working', fc(() => renderTngTaskCard(view()))],
    ['First Contact: confirmed', fc(() => renderTngTaskCard(view({
      gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#c9a27a' },
      poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: '', label: 'Add Momentum to Pool (+2)' },
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Analyse Anomaly', shipDice: [], apAssistDice: [], crewDice: [{ value: 3, success: true }, { value: 1, success: true, crit: true }] })))],
    ['First Contact: damage', fc(() => lcarsChatCard({ title: 'Quantum Torpedo Hit', accent: '#d9443a', body: damageBody, legacy }))],
    ['First Contact: info', fc(() => lcarsChatCard({ title: 'Sensor Contact', accent: '#7b93d1', legacy,
      body: '<div style="font-size:11px;color:#c6d3f0;">Borg sphere · bearing 047 mark 15 · Medium range</div>' }))],
    ['Info card (frame)', lcarsChatCard({ title: 'Sensor Contact', accent: '#9999ff', legacy,
      body: '<div style="font-size:11px;color:#f6c36d;">Bearing 047 mark 15 · Medium range</div>' })],
  ];
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>TNG cards</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.chat-message{width:300px;background:#0e0e11;padding:6px;border-radius:6px}
.chat-message button{height:2rem}h4{margin:0 0 4px;font-size:11px;color:#888}</style>
<div class="grid">${cards.map(([t, h]) => `<div><h4>${t}</h4><div class="chat-message">${h}</div></div>`).join('')}</div>`);
  console.log(`preview: ${out}`);
}
process.exit(failed ? 1 : 0);
