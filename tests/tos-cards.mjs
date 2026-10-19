// node tests/tos-cards.mjs [--preview out.html]
//
// The TOS Console Viewer skins: the working task card (task-card-tos.js) and the
// chat card frame's TOS path (chat-card-frame.js). Checks the DOM contract the
// chat wiring depends on — the .sta2e-working-actions wrappers, the die markup,
// every button class and data-* attribute, data-filled on keys, no inline
// border-radius — and that the frame turns body buttons into keys without losing
// their accent. Both modules import only lcars-theme.js, so they load under node
// with the theme setting stubbed.
//
// --preview writes a page rendering every state against the real stylesheets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let theme = 'tos-panel';
globalThis.game = { settings: { get: (_m, key) => key === 'hudTheme' ? theme : undefined } };

const { renderTosTaskCard } = await import('../scripts/task-card-tos.js');
const { lcarsChatCard } = await import('../scripts/chat-card-frame.js');

// ── A view shaped like buildPlayerRollCardHtml's ──────────────────────────────
// diceRow mirrors the real one's DOM: a span per die with an <img> inside.
const diceRow = (dice, pool = 'crew') => `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;">${
  dice.map((d, i) => {
    const col = d.crit ? '#ddaa00' : d.success ? '#88cc44' : d.complication ? '#ff2200' : '#aaaaaa';
    const lbl = d.crit
      ? `<span style="display:flex;flex-direction:column;align-items:center;line-height:1;"><span style="font-size:7px;letter-spacing:-1px;">★★</span><span style="font-size:11px;">${d.value}</span></span>`
      : `<span style="font-size:11px;">${d.value}</span>`;
    return `<span class="sta2e-card-die" data-pool="${pool}" data-index="${i}" style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;vertical-align:middle;">`
      + `<img src="${D20}" style="position:absolute;top:0;left:0;width:32px;height:32px;opacity:0.2;pointer-events:none;" alt=""/>`
      + `<span style="position:relative;z-index:1;color:${col};font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;">${lbl}</span></span>`;
  }).join('')}</div>`;
let D20 = 'icons/svg/d20-grey.svg';
let TOKENS = { momentum: 'modules/sta2e-toolkit/assets/momentum.svg', threat: 'modules/sta2e-toolkit/assets/threat.svg' };
const renderResourceTokens = (label, count, type, color, size = 21) => {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return '';
  return `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="font-size:9px;font-weight:700;text-transform:uppercase;">${label}</span>`
    + `<span style="display:inline-flex;gap:3px;">${Array.from({ length: n }, () =>
      `<img src="${TOKENS[type]}" style="width:${size}px;height:${size}px;border-radius:50%;filter:drop-shadow(0 0 2px ${color});" />`).join('')}</span></span>`;
};
const rerollButtonBody = rb => `<span class="sta2e-rr-name">${rb.label}</span>${rb.cost ? `<span class="sta2e-rr-cost">${rb.cost}</span>` : ''}`;

function view(over = {}, roll = {}) {
  const rollData = {
    taskLabel: 'Fire Phasers', officerName: 'Lt. Sulu',
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
    contextLeftLabel: 'Lt. Sulu', contextRightLabel: 'Comp Range 19–20',
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
    spentGroups: [['Momentum', 2, 'momentum', '#88cc44'], ['Threat', 1, 'threat', '#ff2200'], ['Personal Threat', 0, 'threat', '#cc4400']],
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
const working = renderTosTaskCard(view());

check('root carries the task card class, the TOS class and the theme', () => {
  assert.match(working, /class="sta2e-task-card sta2e-task-card--tos" data-theme="tos-panel"/);
});

check('every working block is rendered', () => {
  for (const text of ['Fire Phasers — Working', 'Lt. Uhura — Assist Die', 'Insight + Command', 'Helm — Attack Pattern',
    'USS Enterprise · Weapons + Security', 'T12', 'T10', 'Persistent', 'Call Out Targets', 'Nebula Interference: Difficulty (+1)',
    'Complications', 'Spent', 'Pending Assists', 'Rerolls Available', 'Edit Results', 'Hit at Cost', 'Resolve HIT']) {
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
    assert.match(working, new RegExp(`class="sta2e-working-actions sta2e-working-actions--${m} tct-sect"`));
  }
  assert.match(working, /class="tct-btns sta2e-task-rerolls"/, 'the reroll grid is the inner list, not the wrapper');
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

check('rerolls and luck carry data-filled so arming lights the key', () => {
  for (const tag of working.match(/<button class="sta2e-(player-reroll|make-own-luck)[^>]*>/g)) {
    assert.match(tag, /data-filled="1"/);
  }
});

// The shared token images carry border-radius:50% from renderResourceTokens;
// the rule is about the renderer's own root and keys.
check('a key\'s colour is inline, and neither keys nor root carry an inline border-radius', () => {
  for (const tag of working.match(/<button\b[^>]*>/g)) {
    assert.match(tag, /style="background:linear-gradient/);
    assert.doesNotMatch(tag, /border-radius/);
  }
  assert.doesNotMatch(working.match(/<div class="sta2e-task-card[^>]*>/)[0], /border-radius/);
});

check('confirmed card: pool button keeps its data, gained tokens show', () => {
  const html = renderTosTaskCard(view({
    gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#cc4400', autoBanked: false },
    poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: 'T1', label: 'Add Momentum to Pool (+2)' },
    statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
  }, { confirmed: true, pendingAssists: [] }));
  assert.match(html, /Fire Phasers — Success/);
  assert.match(html, /class="sta2e-add-to-pool[^"]*"\s+data-pool="momentum"\s+data-amount="2"\s+data-token-id="T1"/);
  assert.match(html, /Gained/);
  assert.doesNotMatch(html, /sta2e-player-confirm|sta2e-player-reroll|sta2e-working-actions--assists/);
});

check('confirmed with nothing to bank shows Completed', () => {
  const html = renderTosTaskCard(view({ poolButton: { visible: false } }, { confirmed: true }));
  assert.match(html, /class="sta2e-task-btn[^"]*"[^>]*>Completed</);
});

check('assist roll: Add to Task Roll, then Applied to', () => {
  const open = renderTosTaskCard(view({}, { isAssistRoll: true, assistOfficerName: 'Lt. Uhura' }));
  assert.match(open, /Assist Roll — Lt. Uhura/);
  assert.match(open, /sta2e-working-actions--assist-apply/);
  assert.match(open, /class="sta2e-assist-to-roll[^"]*" data-payload="PAYLOAD"/);
  assert.doesNotMatch(open, /tct-result|sta2e-player-confirm|sta2e-player-reroll/);
  const done = renderTosTaskCard(view({}, { isAssistRoll: true, assistApplied: 'Fire Phasers' }));
  assert.match(done, /class="sta2e-task-btn[^"]*"[^>]*>Applied to: Fire Phasers</);
});

check('succeed at cost reads COST on the readout', () => {
  const html = renderTosTaskCard(view({ statCells: [['Successes', 1, ''], ['Difficulty', 2, ''], ['Result', 'COST', '']] },
    { succeedAtCost: true }));
  assert.match(html, /tct-result--cost">COST</);
});

// ── Chat card frame ─────────────────────────────────────────────────────────
const body = `<div class="sta2e-damage-controls">
  <button class="sta2e-apply-damage" data-x="1" style="flex:1;padding:4px;background:rgba(255,0,0,0.1);border:1px solid #ff2200;border-radius:2px;color:#ff2200;font-size:10px;">Apply</button>
  <button class="sta2e-undo" style="background:transparent;border:1px solid #886600;color:#886600;">Undo</button>
  <button class="sta2e-plain">Plain</button>
</div>`;
const legacy = () => '<div class="legacy">old</div>';
const framed = lcarsChatCard({ title: 'Phaser Hit', accent: '#ff2200', body, legacy, rootClass: 'sta2e-momentum-tracker', attrs: 'data-pool="momentum"' });

check('TOS frame: housing, title, accent, root identity carried forward', () => {
  assert.match(framed, /class="sta2e-chat-card sta2e-chat-card--tos sta2e-momentum-tracker" data-pool="momentum" data-theme="tos-panel"/);
  assert.match(framed, /--ccf-c:#ff2200;/);
  assert.match(framed, /class="ccf-tos-title">Phaser Hit</);
  assert.match(framed, /<div class="ccf-body">/, 'wirers use .ccf-body as their host');
  assert.ok(framed.includes('class="sta2e-damage-controls"'), 'body classes pass through');
});

check('TOS frame: buttons become keys in their own accent, layout kept', () => {
  const tags = framed.match(/<button\b[^>]*>/g);
  assert.equal(tags.length, 3);
  for (const t of tags) assert.doesNotMatch(t, /(?<![-\w])(background|border[-a-z]*|color)\s*:/);
  assert.match(tags[0], /style="--tck-a:#ff2200;--tck-ink:#fff4ee;flex:1;padding:4px;/);
  assert.match(tags[0], /class="sta2e-apply-damage" data-x="1"/);
  assert.match(tags[0], /font-size:10px;/);
  assert.match(tags[1], /--tck-a:#886600;/);
  assert.match(tags[2], /^<button style="--tck-a:#ddaa00;--tck-ink:#140e00;" class="sta2e-plain">$/);
});

check('TNG still gets its own frame, other eras their legacy markup', () => {
  theme = 'lcars-tng';
  const tng = lcarsChatCard({ title: 'T', body, legacy });
  assert.match(tng, /ccf-bar--top/);
  assert.doesNotMatch(tng, /sta2e-chat-card--tos|--tck-a/);
  theme = 'klingon';
  assert.equal(lcarsChatCard({ title: 'T', body, legacy }), legacy());
  theme = 'tos-panel';
});

// ── TOS body pass: a damage card body as combat-hud-core.js writes it ─────────
const LCF = "'Arial Narrow','Roboto Condensed','Helvetica Neue',sans-serif";
const damageBody = `
  <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
    <span title="Piercing quality" style="display:inline-block;padding:1px 6px;border:1px solid #cc4400;
      border-radius:2px;color:#cc4400;background:rgba(255,255,255,0.03);font-size:9px;font-weight:700;font-family:${LCF};">Piercing</span>
    <span title="Scan" style="display:inline-block;padding:1px 6px;border:1px solid #cc4400;border-radius:2px;color:#cc4400;font-size:9px;font-family:${LCF};">Scan: +1 dmg</span>
  </div>
  <div style="border:1px solid #aa8800;border-left:3px solid #cc4400;background:#141000;border-radius:2px;padding:6px 8px;margin-bottom:5px;">
    <div style="font-size:11px;font-weight:700;color:#cc4400;margin-bottom:5px;font-family:${LCF};">▶ I.K.S. Gorkon</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-bottom:5px;text-align:center;">
      <div style="background:rgba(255,153,0,0.07);border:1px solid #2a2000;border-radius:2px;padding:3px;">
        <div style="font-size:8px;color:#886600;text-transform:uppercase;font-family:${LCF};">Weapon</div>
        <div style="font-size:15px;font-weight:700;color:#88cc44;">6<span style="color:#ddaa00;font-size:10px;">+1</span></div>
      </div>
      <div style="background:rgba(255,153,0,0.07);border:1px solid #2a2000;border-radius:2px;padding:3px;">
        <div style="font-size:8px;color:#886600;text-transform:uppercase;font-family:${LCF};">−Resist</div>
        <div style="font-size:15px;font-weight:700;color:#ff6600;">2</div>
      </div>
      <div style="background:rgba(255,153,0,0.07);border:1px solid #2a2000;border-radius:2px;padding:3px;" title="Bonus damage">
        <div style="font-size:8px;color:#886600;text-transform:uppercase;font-family:${LCF};">Extra</div>
        <div class="sta2e-extra-display" style="font-size:15px;font-weight:700;color:#ddaa00;">0</div>
      </div>
      <div style="background:rgba(204,136,255,0.1);border:1px solid #cc4400;border-radius:2px;padding:3px;">
        <div style="font-size:8px;color:#886600;text-transform:uppercase;font-family:${LCF};">Total</div>
        <div class="sta2e-total-display" style="font-size:18px;font-weight:700;color:#ffffff;">5</div>
      </div>
    </div>
    <div style="font-size:10px;color:#886600;margin-bottom:5px;text-align:center;font-family:${LCF};">
      SHIELDS 9 → <span style="color:#ffdd00;font-weight:700;">4</span> / 12
    </div>
    <div style="margin-bottom:5px;padding:3px 6px;border-left:3px solid #ff2200;background:rgba(255,50,50,0.08);font-size:10px;color:#ff2200;font-family:${LCF};text-transform:uppercase;">
      Complications: -1 damage
    </div>
    <div style="margin-top:4px;padding:3px 6px;background:rgba(255,50,0,0.1);border-left:3px solid #ff2200;font-size:10px;color:#ff2200;font-family:${LCF};text-transform:uppercase;">
      ⚠️ SHAKEN — shields at or below 50%
    </div>
    <div class="sta2e-damage-controls" style="margin-top:5px;">
      <div class="sta2e-attack-quality-controls" style="margin-bottom:5px;padding:5px 6px;border:1px solid #2a2000;border-radius:2px;background:rgba(255,153,0,0.035);">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:5px;font-size:10px;color:#eecc77;font-family:${LCF};text-transform:uppercase;cursor:pointer;">
            <input class="sta2e-main-area-enabled" type="checkbox" style="cursor:pointer;accent-color:#ddaa00;"/> Area
          </label>
          <label style="display:flex;align-items:center;gap:5px;font-size:10px;color:#eecc77;font-family:${LCF};text-transform:uppercase;cursor:pointer;">
            <input class="sta2e-main-spread-enabled" type="checkbox" checked style="cursor:pointer;accent-color:#cc4400;"/> Spread
          </label>
        </div>
        <div class="sta2e-main-area-targets" style="display:none;margin-top:5px;padding:5px 6px;border:1px solid #2a2000;border-radius:2px;background:rgba(0,180,255,0.04);">
          <label style="display:flex;align-items:center;gap:6px;font-size:10px;color:#eecc77;font-family:${LCF};"><input class="sta2e-main-area-target" type="checkbox" value="T2" disabled style="accent-color:#ddaa00;"/> Bird-of-Prey</label>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <input class="sta2e-extra-damage" type="number" value="0" data-base-payload="ENC" style="display:none;"/>
        <label style="font-size:9px;color:#886600;white-space:nowrap;text-transform:uppercase;font-family:${LCF};">Adj:</label>
        <input class="sta2e-manual-adj" type="number" value="0" style="width:44px;padding:2px 4px;background:#0a0800;border:1px solid #aa8800;border-radius:2px;color:#eecc77;font-size:12px;text-align:center;font-family:${LCF};"/>
      </div>
      <button class="sta2e-apply-damage" data-payload="ENC" style="width:100%;padding:4px;background:#cc4400;border:none;border-radius:2px;color:#0a0800;font-size:10px;font-weight:700;text-transform:uppercase;cursor:pointer;font-family:${LCF};">APPLY DAMAGE → I.K.S. Gorkon</button>
    </div>
  </div>`;
const damageCard = lcarsChatCard({ title: '💥 Disruptor Banks — ✓ HIT', accent: '#88cc44', body: damageBody, legacy });

check('TOS body pass: tiles, plate, notes and chips are classified', () => {
  assert.equal(count(damageCard, /class="ccf-tos-tile"/g), 4, 'four stat tiles');
  assert.equal(count(damageCard, /class="ccf-tos-note"/g), 2, 'complication and warning banners');
  assert.equal(count(damageCard, /class="ccf-tos-chip"/g), 2);
  assert.match(damageCard, /class="ccf-tos-plate" style="--tn-c:#cc4400;/, 'the target block, with its accent edge');
  assert.match(damageCard, /class="ccf-tos-plate sta2e-attack-quality-controls"/, 'existing class kept after the new one');
  assert.match(damageCard, /--tn-c:#ff2200;/, 'banner keeps its own colour');
  assert.match(damageCard, /--tn-c:#cc4400;/, 'chip keeps its own colour');
});

check('TOS body pass: LCARS declarations go, meaning and layout stay', () => {
  const body = damageCard.slice(damageCard.indexOf('class="ccf-body"'));
  assert.doesNotMatch(body, /font-family/);
  assert.doesNotMatch(body, /border-radius/);
  assert.doesNotMatch(body, /accent-color/);
  assert.doesNotMatch(body, /background:rgba\(/, 'faint washes removed');
  assert.match(body, /class="sta2e-total-display" style="font-size:18px;font-weight:700;color:#ffffff;"/);
  assert.match(body, /display:grid;grid-template-columns:repeat\(4,1fr\)/);
  assert.match(body, /class="ccf-tos-plate sta2e-main-area-targets" style="display:none;/, 'wiring-toggled display survives');
  assert.match(body, /<input class="ccf-tos-ctl sta2e-extra-damage" type="number" value="0" data-base-payload="ENC" style="display:none;"\/>/);
  assert.match(body, /class="ccf-tos-ctl sta2e-manual-adj" type="number" value="0" style="width:44px;padding:2px 4px;color:#eecc77;font-size:12px;text-align:center;/);
  assert.match(body, /<input class="ccf-tos-ctl sta2e-main-spread-enabled" type="checkbox" checked style="cursor:pointer;"\/>/);
  assert.match(body, /<button class="sta2e-apply-damage" data-payload="ENC" style="--tck-a:#cc4400;/, 'button still keyified');
});

check('TOS body pass: decorative emoji go, functional glyphs stay', () => {
  assert.doesNotMatch(damageCard, /💥|⚠/);
  assert.match(damageCard, /ccf-tos-title">Disruptor Banks — ✓ HIT</);
  assert.match(damageCard, />▶ I\.K\.S\. Gorkon</);
  assert.match(damageCard, />\s*SHAKEN — shields at or below 50%/);
  assert.match(damageCard, /SHIELDS 9 → <span/);
});

check('TOS body pass: other eras get the body untouched', () => {
  theme = 'lcars-tng';
  assert.match(lcarsChatCard({ title: 'T', body: damageBody, legacy }), /💥|font-family:'Arial Narrow'/);
  theme = 'klingon';
  assert.equal(lcarsChatCard({ title: 'T', body: damageBody, legacy }), legacy());
  theme = 'tos-panel';
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
  const css = ['task-card.css', 'task-card-tos.css', 'chat-card.css'].map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n');
  const cards = [
    ['Working, everything on', renderTosTaskCard(view())],
    ['Confirmed, Momentum to bank', renderTosTaskCard(view({
      gained: { visible: true, label: 'Momentum', amount: 2, type: 'momentum', color: '#cc4400' },
      poolButton: { visible: true, pool: 'momentum', amount: 2, tokenId: '', label: 'Add Momentum to Pool (+2)' },
      namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 4, ''], ['Difficulty', 2, ''], ['Momentum', 2, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, shipDice: [], apAssistDice: [], crewDice: [{ value: 3, success: true }, { value: 1, success: true, crit: true }] }))],
    ['Failed', renderTosTaskCard(view({
      passed: false, finalResultLabel: 'Failed', namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 1, ''], ['Difficulty', 3, ''], ['Momentum', 0, ''], ['Complic.', 1, ''], ['Result', 'Failed', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Analyze Anomaly', shipDice: [], apAssistDice: [], crewDice: [{ value: 12, success: true }, { value: 19, complication: true }] }))],
    ['NPC, Threat banked', renderTosTaskCard(view({
      gained: { visible: true, label: 'Threat', amount: 3, type: 'threat', color: '#cc4400', autoBanked: true, banked: 2, floating: 1 },
      poolButton: { visible: false }, namedAssistBlocks: [], noteStrips: [], traitNotes: [], spentVisible: false,
      statCells: [['Successes', 5, ''], ['Difficulty', 2, ''], ['Threat', 3, ''], ['Result', 'Success', '']],
      showMakeYourOwnLuck: false,
    }, { confirmed: true, taskLabel: 'Ramming Speed', shipDice: [], apAssistDice: [], crewDice: [{ value: 2, success: true }, { value: 5, success: true }] }))],
    ['Assist roll', renderTosTaskCard(view({ showMakeYourOwnLuck: false, noteStrips: [], traitNotes: [] }, { isAssistRoll: true, assistOfficerName: 'Lt. Uhura', crewDice: [{ value: 6, success: true }], shipDice: [], apAssistDice: [] }))],
    ['Damage card (frame)', framed],
    ['Ship damage card (body pass)', damageCard],
    ['Ship damage card + spend panel', await (async () => {
      // The real spend panel, as momentum-spend.js builds it, with the few
      // Foundry globals it reads stubbed.
      try {
        globalThis.game.messages = { contents: [], get: () => null };
        globalThis.game.user = { isGM: true };
        globalThis.game.actors = { get: () => null };
        const { injectSpendPanelInline, makeSpendContext } = await import('../scripts/momentum-spend.js');
        const ctx = makeSpendContext({ floatingMomentum: 4, qualities: { intense: true, piercing: true }, scope: 'ship' });
        return lcarsChatCard({ title: 'Disruptor Banks — ✓ HIT', accent: '#88cc44',
          body: injectSpendPanelInline(damageBody, ctx, 'T1'), legacy });
      } catch (err) { return `<pre>${String(err?.stack ?? err)}</pre>`; }
    })()],
    ['Info card (frame)', lcarsChatCard({ title: 'Sensor Contact', accent: '#88cc44', legacy,
      body: '<div style="font-size:11px;">Bearing 047 mark 15 · Medium range</div>' })],
  ];
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>TOS cards</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.chat-message{width:290px;background:#0e0e11;padding:6px;border-radius:6px}
.chat-message button{height:2rem}h4{margin:0 0 4px;font-size:11px;color:#888}</style>
<div class="grid">${cards.map(([t, h]) => `<div><h4>${t}</h4><div class="chat-message">${h}</div></div>`).join('')}</div>`);
  console.log(`preview: ${out}`);
}
process.exit(failed ? 1 : 0);
