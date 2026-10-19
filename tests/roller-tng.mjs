// node tests/roller-tng.mjs [--preview out.html]
//
// The TNG Bracket Console skin for the Adv. Dice Roller dialog
// (roller-skin-tng.js). The dialog content is the REAL buildDialogContent from
// npc-roller.js, lifted out of the source and run in a vm with its helpers
// stubbed (the pattern tests/ground-melee-vfx.mjs uses), in the setup and the
// rolled phase. Checks that the skin keeps every id, class, data-* and
// wiring-toggled display the content had, that no square corners, LCARS font or
// accent-color survive, that die pips are left alone, and that the frame and the
// bare section headers appear under the bracket themes only.
//
// --preview writes a page rendering both phases in TNG and First Contact
// against the real stylesheets, with the footer seated as it is after render.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

let theme = 'lcars-tng';
const settings = { hudTheme: () => theme, interactiveDicePayment: () => true };
globalThis.game = {
  settings: { get: (_m, key) => settings[key]?.() },
  user: { isGM: true },
  sta2eToolkit: {},
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { getLcTokens } = await import('../scripts/lcars-theme.js');
const skin = await import('../scripts/roller-skin-tng.js');

// ── Lift the real builder out of npc-roller.js ───────────────────────────────
// CRLF on a Windows checkout; the markers below are written with \n.
const src = fs.readFileSync(`${root}/scripts/npc-roller.js`, 'utf8').replace(/\r\n/g, '\n');
const grab = (start, endMarker) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  const j = src.indexOf(endMarker, i);
  return src.slice(i, j);
};
const fnSrc = name => {
  const i = src.search(new RegExp(`^(export )?function ${name}\\(`, 'm'));
  assert.ok(i >= 0, `missing function ${name}`);
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j + 3).replace(/^export /, '');
};
const constSrc = name => {
  const i = src.search(new RegExp(`^const ${name} = `, 'm'));
  assert.ok(i >= 0, `missing const ${name}`);
  return src.slice(i, src.indexOf('\n};\n', i) + 4);
};

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });
const context = vm.createContext({
  LC, game: globalThis.game, console, Math, Number, String, Object, Array, JSON,
  isBracketRoller: skin.isBracketRoller,
  _rollResourceProfile: () => ({ usesPlayerPayment: true }),
  isFlightControllerPilotTask: () => false,
  _smallCraftDifficultyMod: () => 1,
  _concealmentDifficultyMod: () => 0,
  _concealmentDifficultyLabel: () => '',
  renderTraitSuggestionPanel: () => `
    <div id="sta2e-trait-suggestions" style="border-top:1px solid ${LC.borderDim};">
      <div style="padding:4px 10px 8px;display:flex;flex-direction:column;gap:4px;">
        <label style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px;padding:4px 6px;border:1px solid ${LC.border};border-radius:2px;background:rgba(255,153,0,0.05);">
          <input type="checkbox" class="sta2e-trait-effect-cb" value="ion" checked style="margin-top:2px;accent-color:${LC.primary};" />
          <span style="font-family:${LC.font};font-size:10px;color:${LC.text};">Ion Storm <span style="color:${LC.secondary};">+1 Difficulty</span></span>
        </label>
      </div>
    </div>`,
  _buildCombatTaskPanelHtml: () => '',
  _systemLabel: k => k.charAt(0).toUpperCase() + k.slice(1),
  _deptLabel: k => k.charAt(0).toUpperCase() + k.slice(1),
  rollComplicationTotal: () => 0,
  ASSIST_GATE_NOTE: 'Assist dice may not be added: the crew die failed',
});
vm.runInContext([
  `${grab('export const CREW_QUALITIES', '\n];\n').replace(/^export /, '')}\n];`,
  constSrc('ATTR_LABELS'), constSrc('DISC_LABELS'),
  fnSrc('crewQualityForKey'), fnSrc('countSuccesses'), fnSrc('countComplications'), fnSrc('diePipHtml'),
  grab('function buildDialogContent(', '\nfunction buildChatCard('),
  'globalThis.build = buildDialogContent;',
].join('\n'), context);

const officer = {
  id: 'worf', name: 'Lt. Worf',
  attributes: { control: 11, daring: 10, fitness: 11, insight: 8, presence: 9, reason: 8 },
  disciplines: { command: 3, conn: 2, engineering: 2, security: 5, science: 2, medicine: 1 },
};
const systems = { weapons: { value: 10 }, sensors: { value: 9 }, engines: { value: 9 } };
const depts = { security: { value: 3 }, conn: { value: 2 }, science: { value: 2 } };
const baseState = () => ({
  phase: 'setup', crewNumDice: 3, crewQuality: 'proficient',
  shipNumDice: 1, shipSystemKey: 'weapons', shipDeptKey: 'security',
  difficulty: 2, complicationRange: 1, hasTargetingSolution: true, tsChoice: 'reroll',
  crewAssist: false, shipAssist: true, officer, officerAttrKey: 'control', officerDiscKey: 'security',
  hasActorAtStation: true, hasFocus: true, hasTalentReroll: true, talentRerollSource: 'Bold (Security)',
  weaponContext: { name: 'Phaser Banks', damage: 4 },
  paymentSlots: ['momentum', null, null, null, null, null],
  assistOfficers: [{ name: 'Lt. Cmdr. Data', type: 'assist', attrKey: 'reason', discKey: 'science',
    stats: { attributes: { reason: 12, control: 10 }, disciplines: { science: 5, engineering: 4 } }, hasFocus: true }],
  pendingAssistName: null, crewDice: [], crewAssistDice: [], shipDice: [], apAssistDice: [],
  breachPenalty: { penaltyNote: 'Weapons breached: +1 Complication range' },
});
const rolledState = () => ({
  ...baseState(), phase: 'rolled',
  crewDept: 5, crewDice: [{ value: 3, success: true, crit: true, critThreshold: 5 }, { value: 9, success: true }, { value: 17 }],
  crewAssistDice: [{ value: 6, success: true }],
  shipDice: [{ value: 11, success: true }],
  activeRerollAbility: null, assistRerollsUsed: [],
});

// Any other module-level helper the builder reaches is a pure function or
// constant of npc-roller.js itself: load it from the source the first time a
// render trips over it, and render again.
const build = state => {
  for (let tries = 0; tries < 40; tries++) {
    try { return context.build(state, systems, depts, null); }
    catch (err) {
      const name = err?.name === 'ReferenceError'
        ? String(err.message).match(/^(\w+) is not defined/)?.[1] : null;
      if (!name) throw err;
      const isFn = new RegExp(`^(export )?function ${name}\\(`, 'm').test(src);
      vm.runInContext(isFn ? fnSrc(name) : constSrc(name), context);
    }
  }
  throw new Error('builder needs too many helpers');
};

// ── Checks ───────────────────────────────────────────────────────────────────
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}\n  ${err.message}`); }
};

const attrs = (html, attr) => [...html.matchAll(new RegExp(`\\s${attr}="([^"]*)"`, 'g'))].map(m => m[1]).sort();
const classes = html => attrs(html, 'class').flatMap(c => c.split(/\s+/)).filter(c => c && !c.startsWith('tbr-')).sort();

for (const [label, make] of [['setup', baseState], ['rolled', rolledState]]) {
  const raw = build(make());
  const skinned = skin.bracketRollerHtml(raw, { title: 'Phaser Banks', phase: label });
  check(`${label}: content builds and the skin wraps it`, () => {
    assert.ok(raw.includes('sta2e-npc-roller'));
    assert.match(skinned, /class="sta2e-roller sta2e-roller--tng tbc"/);
    assert.match(skinned, new RegExp(`data-phase="${label}"`));
    assert.match(skinned, /class="tbc-top"/);
    assert.match(skinned, /class="tbc-bot"/);
  });
  check(`${label}: every id, data-* value and content class survives`, () => {
    const body = skin.bracketRollerBodyHtml(raw);
    assert.deepEqual(attrs(body, 'id'), attrs(raw, 'id'));
    assert.deepEqual(attrs(body, 'data-[a-z-]+'), attrs(raw, 'data-[a-z-]+'));
    assert.deepEqual(classes(body), classes(raw));
  });
  check(`${label}: wiring-toggled display survives`, () => {
    const body = skin.bracketRollerBodyHtml(raw);
    const count = h => (h.match(/display:\s*none/g) ?? []).length;
    assert.equal(count(body), count(raw));
  });
  check(`${label}: no square corners, LCARS font or accent-color left inline`, () => {
    const body = skin.bracketRollerBodyHtml(raw);
    assert.equal(/border-radius\s*:\s*(?!50%)/i.test(body), false, body.match(/.{60}border-radius\s*:\s*(?!50%).{30}/)?.[0]);
    assert.equal(/font-family[^;"]*Arial Narrow/i.test(body), false);
    assert.equal(/accent-color/i.test(body), false);
  });
  check(`${label}: headers are bare under the bracket theme`, () => {
    assert.match(raw, /<div class="tbr-head">/);
  });
}

check('setup: fields, plates and checkbox accents', () => {
  const body = skin.bracketRollerBodyHtml(build(baseState()));
  assert.match(body, /<select class="tbr-ctl" id="officer-attr"/);
  assert.match(body, /<input class="tbr-ctl" id="difficulty"/);
  assert.match(body, /class="tbr-plate"/);
  assert.match(body, /id="complication-range"[^>]*style="--tbr-a:/);
  assert.match(body, /id="has-focus"[^>]*style="--tbr-a:/);
  assert.match(body, /class="tbr-note"/, 'the breach banner is a note');
});

check('setup: buttons become keys carrying their own accent', () => {
  const st = { ...baseState(), tsChoice: 'system', tsSystem: 'weapons' };
  const body = skin.bracketRollerBodyHtml(build(st));
  const keys = body.match(/<button[^>]*class="tbr-key ts-sys-btn"[^>]*>/g) ?? [];
  assert.equal(keys.length, 7);
  for (const k of keys) {
    assert.match(k, /--tbr-a:[^;]+;--tbr-ink:/);
    assert.equal(/background\s*:|border\s*:|(?<![-\w])color\s*:/.test(k), false, k);
  }
  const chosen = keys.find(k => k.includes('data-system="weapons"'));
  assert.match(chosen, new RegExp(`--tbr-a:${getLcTokens().primary}`), 'the chosen system keeps its colour');
});

check('rolled: die pips are not keys', () => {
  const st = { ...rolledState(), hasTargetingSolution: true, tsChoice: 'reroll' };
  const body = skin.bracketRollerBodyHtml(build(st));
  assert.equal(/sta2e-die-pip[^>]*tbr-key|tbr-key[^>]*sta2e-die-pip/.test(body), false);
  assert.match(body, /class="tbr-key reroll-arm-btn"/);
});

check('decorative emoji are dropped, functional glyphs kept', () => {
  const body = skin.bracketRollerBodyHtml('<div>⚔ Phaser ★★ ✗ → ▶</div>');
  assert.equal(body, '<div>Phaser ★★ ✗ → ▶</div>');
});

check('First Contact takes the bracket skin with its own palette', () => {
  theme = 'lcars-fc';
  try {
    assert.equal(skin.isBracketRoller(), true);
    const out = skin.bracketRollerHtml('<div></div>', { title: 'x' });
    assert.match(out, /data-theme="lcars-fc"/);
    assert.match(out, /--tbc-c:#6a86cc/);
  } finally { theme = 'lcars-tng'; }
});

check('rolled frame colour follows pass / fail', () => {
  assert.match(skin.bracketRollerHtml('', { phase: 'rolled', passed: true }), /--tbc-c:#48c76b/);
  assert.match(skin.bracketRollerHtml('', { phase: 'rolled', passed: false }), /--tbc-c:#cc6666/);
});

check('other eras keep the legacy content and headers', () => {
  for (const t of ['tos-panel', 'tmp-console', 'ent-panel', 'lcars-tng-blue-was-retired']) {
    theme = t;
    try {
      if (t.startsWith('lcars-tng-blue')) continue;
      assert.equal(skin.isBracketRoller(), false, t);
      const raw = build(baseState());
      assert.equal(raw.includes('tbr-head'), false, t);
      assert.equal(raw.includes('sta2e-roller--tng'), false, t);
    } finally { theme = 'lcars-tng'; }
  }
});

// ── Optional preview page ────────────────────────────────────────────────────
const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  const out = path.resolve(process.argv[pi + 1]);
  const css = ['chat-card.css', 'task-card.css', 'task-card-tng.css', 'roller-tng.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/tng\/([^"]+)"\)/g,
      (_, f) => `url("data:font/woff2;base64,${fs.readFileSync(`${root}/fonts/tng/${f}`).toString('base64')}")`);
  const asset = f => `data:image/svg+xml;base64,${fs.readFileSync(f).toString('base64')}`;
  const d20 = asset('C:/Program Files/Foundry Virtual Tabletop/resources/app/public/icons/svg/d20-grey.svg');
  const coin = { momentum: asset(`${root}/assets/momentum.svg`), threat: asset(`${root}/assets/threat.svg`) };
  // A dialog as core renders it; the footer is seated by the page script,
  // exactly as seatBracketFooter does after render.
  const dialog = (title, inner, buttons) => `
    <div class="application dialog"><header class="window-header">${title}</header>
      <section class="window-content"><form class="dialog-form standard-form">
        <div class="dialog-content standard-form">${inner}</div>
        <footer class="form-footer">${buttons.map(([a, l]) => `<button type="submit" data-action="${a}"><i class="fas fa-x"></i> ${l}</button>`).join('')}</footer>
      </form></section></div>`;
  const panes = [];
  for (const t of ['lcars-tng', 'lcars-fc']) {
    theme = t;
    const setupHtml = skin.bracketRollerHtml(build(baseState()), { title: 'Phaser Banks', phase: 'setup' });
    const rolledHtml = skin.bracketRollerHtml(build({ ...rolledState(), hasTalentReroll: true }), { title: 'Phaser Banks', phase: 'rolled', passed: true });
    panes.push([`${t} — setup`, dialog('Lt. Worf — Phaser Banks', setupHtml, [['roll', '🎲 Roll'], ['cancel', 'Cancel']])]);
    panes.push([`${t} — rolled`, dialog('Lt. Worf — Phaser Banks', rolledHtml, [['resolve', '⚡ Resolve HIT'], ['back', '← Setup'], ['reroll-all', 'Re-roll All 🚨'], ['cancel', 'Cancel']])]);
  }
  theme = 'lcars-tng';
  const page = `<!doctype html><meta charset="utf-8"><title>TNG roller</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.application{width:min-content;background:#0b0b0d;border:1px solid #333;border-radius:6px}
.window-header{padding:5px 10px;background:#1c1c20;font-size:12px;color:#ddd}
.dialog-form{display:flex;flex-direction:column}
h4{margin:0 0 4px;font-size:11px;color:#888}</style>
<div class="grid">${panes.map(([t, h]) => `<div><h4>${t}</h4>${h}</div>`).join('')}</div>
<script type="module">
const P = { "lcars-tng": ${JSON.stringify({ confirmPass: '#ff9966', addToRoll: '#9999ff', poolThreat: '#cc6666', edit: '#ffcc99', dim: '#5a5650' })},
            "lcars-fc": ${JSON.stringify({ confirmPass: '#ff9c33', addToRoll: '#9fb2e0', poolThreat: '#cf5a4e', edit: '#b5c3e8', dim: '#4a5060' })} };
document.querySelectorAll('img').forEach(i => {
  const s = i.getAttribute('src') ?? '';
  if (s.endsWith('d20-grey.svg')) i.src = ${JSON.stringify(d20)};
  else if (s.endsWith('momentum.svg')) i.src = ${JSON.stringify(coin.momentum)};
  else if (s.endsWith('threat.svg')) i.src = ${JSON.stringify(coin.threat)};
});
// seatBracketFooter, inlined (the module itself needs Foundry's game object).
document.querySelectorAll('.application').forEach(app => {
  const frame = app.querySelector('.sta2e-roller--tng'), footer = app.querySelector('.form-footer');
  const pal = P[frame.dataset.theme];
  app.classList.add('sta2e-roller-tbc');
  [...footer.querySelectorAll('button')].forEach((b, i) => {
    b.querySelectorAll('i').forEach(x => x.remove());
    b.textContent = b.textContent.replace(/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{26FF}]\\u{FE0F}?\\s?/gu, '').trim();
    const role = b.dataset.action === 'cancel' ? 'dim' : i === 0 ? 'confirmPass'
      : ({ post: 'addToRoll', 'reroll-all': 'poolThreat', back: 'edit' })[b.dataset.action] ?? 'edit';
    b.style.background = pal[role]; b.style.color = '#000';
    b.classList.add('tbr-fkey');
  });
  footer.classList.add('tbr-footer');
  frame.querySelector('.tbc-body').append(footer);
});
</script>`;
  fs.writeFileSync(out, page);
  console.log(`preview: ${out}`);
}

process.exit(failed ? 1 : 0);
