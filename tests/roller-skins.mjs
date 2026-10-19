// node tests/roller-skins.mjs [--preview out.html]
//
// The era skins for the Adv. Dice Roller dialog (roller-skin.js): TNG / First
// Contact, TOS, TMP Console, TMP Monitor and ENT. The dialog content is the REAL buildDialogContent from
// npc-roller.js, lifted out of the source and run in a vm with its helpers
// stubbed (the pattern tests/ground-melee-vfx.mjs uses), in the setup and the
// rolled phase. Checks that the shared body pass keeps every id, class, data-*
// and wiring-toggled display the content had, that no square corners, LCARS
// font or accent-color survive, that die pips are left alone, that each era
// gets its own frame and footer slot, and that themes without a skin
// (Starfleet Blue, Klingon, Romulan) keep the plain dialog.
//
// --preview writes a page rendering both phases in every skinned era against the real stylesheets, with the footer seated as it is after render.
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
const { getLcTokens, getActiveLcThemeKey, isEntTheme, isKlingonTheme } = await import('../scripts/lcars-theme.js');
const skin = await import('../scripts/roller-skin.js');

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
  // A one-line const ends on its own line; a block one at the first `};`.
  const line = src.slice(i, src.indexOf('\n', i));
  if (line.trimEnd().endsWith(';')) return line;
  return src.slice(i, src.indexOf('\n};\n', i) + 4);
};

const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });
const context = vm.createContext({
  LC, game: globalThis.game, console, Math, Number, String, Object, Array, JSON,
  getActiveLcThemeKey, isEntTheme, isKlingonTheme,
  isSkinnedRoller: skin.isSkinnedRoller,
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
// render trips over it, and render again. A const is loaded as a property of the
// context's global: a `const` declared by one vm script is not reliably visible
// to a function compiled in another (critDieColour could not see ENT_CRIT_GOLD).
const build = state => {
  for (let tries = 0; tries < 40; tries++) {
    try { return context.build(state, systems, depts, null); }
    catch (err) {
      const name = err?.name === 'ReferenceError'
        ? String(err.message).match(/^(\w+) is not defined/)?.[1] : null;
      if (!name) throw err;
      const isFn = new RegExp(`^(export )?function ${name}\\(`, 'm').test(src);
      vm.runInContext(isFn ? fnSrc(name) : constSrc(name).replace(/^const /, 'globalThis.'), context);
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

const withTheme = (t, fn) => { const was = theme; theme = t; try { return fn(); } finally { theme = was; } };

// ── The shared body pass ─────────────────────────────────────────────────────
for (const [label, make] of [['setup', baseState], ['rolled', rolledState]]) {
  const raw = build(make());
  const body = skin.rollerBodyHtml(raw);
  check(`${label}: content builds with bare section headers`, () => {
    assert.ok(raw.includes('sta2e-npc-roller'));
    assert.match(raw, /<div class="tbr-head">/);
  });
  check(`${label}: every id, data-* value and content class survives the pass`, () => {
    assert.deepEqual(attrs(body, 'id'), attrs(raw, 'id'));
    assert.deepEqual(attrs(body, 'data-[a-z-]+'), attrs(raw, 'data-[a-z-]+'));
    assert.deepEqual(classes(body), classes(raw));
  });
  check(`${label}: wiring-toggled display survives`, () => {
    const count = h => (h.match(/display:\s*none/g) ?? []).length;
    assert.equal(count(body), count(raw));
  });
  check(`${label}: no square corners, LCARS font or accent-color left inline`, () => {
    assert.equal(/border-radius\s*:\s*(?!50%)/i.test(body), false, body.match(/.{60}border-radius\s*:\s*(?!50%).{30}/)?.[0]);
    assert.equal(/font-family[^;"]*Arial Narrow/i.test(body), false);
    assert.equal(/accent-color/i.test(body), false);
  });
}

check('setup: fields, plates, notes and checkbox accents', () => {
  const body = skin.rollerBodyHtml(build(baseState()));
  assert.match(body, /<select class="tbr-ctl" id="officer-attr"/);
  assert.match(body, /<input class="tbr-ctl" id="difficulty"/);
  assert.match(body, /class="tbr-plate"/);
  assert.match(body, /id="complication-range"[^>]*style="--tbr-a:/);
  assert.match(body, /id="has-focus"[^>]*style="--tbr-a:/);
  assert.match(body, /class="tbr-note"/, 'the breach banner is a note');
});

check('setup: buttons become keys carrying their own accent', () => {
  const st = { ...baseState(), tsChoice: 'system', tsSystem: 'weapons' };
  const body = skin.rollerBodyHtml(build(st));
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
  const body = skin.rollerBodyHtml(build(st));
  assert.equal(/sta2e-die-pip[^>]*tbr-key|tbr-key[^>]*sta2e-die-pip/.test(body), false);
  assert.match(body, /class="tbr-key reroll-arm-btn"/);
});

check('decorative emoji are dropped, functional glyphs kept', () => {
  assert.equal(skin.rollerBodyHtml('<div>⚔ Phaser ★★ ✗ → ▶</div>'), '<div>Phaser ★★ ✗ → ▶</div>');
});

// ── Frames ───────────────────────────────────────────────────────────────────
check('which skin each theme wears', () => {
  const want = { 'lcars-tng': 'tng', 'lcars-fc': 'tng', 'tos-panel': 'tos',
    'tmp-console': 'tmp', 'tmp-monitor': 'tmpmon', 'ent-panel': 'ent',
    blue: null, klingon: null, romulan: null };
  for (const [t, s] of Object.entries(want)) {
    withTheme(t, () => {
      assert.equal(skin.rollerSkin(), s, t);
      assert.equal(skin.isSkinnedRoller(), s !== null, t);
    });
  }
});

check('TNG: the bracket frame, its keys slot, colour by state', () => {
  const out = skin.skinRollerHtml('<div id="x"></div>', { title: 'Phaser Banks', phase: 'setup' });
  assert.match(out, /class="sta2e-roller sta2e-roller--tng tbc"/);
  assert.match(out, /data-phase="setup"/);
  assert.match(out, /class="tbc-top"/);
  assert.match(out, /class="tbc-bot"/);
  assert.match(out, /<div class="tbc-body" data-roller-keys><div id="x"><\/div><\/div>/);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: true }), /--tbc-c:#48c76b/);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: false }), /--tbc-c:#cc6666/);
});

check('First Contact takes the bracket frame with its own palette', () => withTheme('lcars-fc', () => {
  const out = skin.skinRollerHtml('<div></div>', { title: 'x' });
  assert.match(out, /data-theme="lcars-fc"/);
  assert.match(out, /--tbc-c:#6a86cc/);
}));

check('TOS: housing, header lamps, one CRT, strut, keys slot', () => withTheme('tos-panel', () => {
  const out = skin.skinRollerHtml('<div id="x"></div>', { title: '⚔ Phaser Banks', phase: 'setup' });
  assert.match(out, /class="sta2e-roller sta2e-roller--tos sta2e-task-card--tos"/);
  assert.equal(/sta2e-task-card[" ]/.test(out), false, 'not .sta2e-task-card: task-card.css would reach the buttons');
  assert.match(out, /<div class="tct-title">Phaser Banks<small>Adv\. Dice Roller · Setup<\/small>/);
  assert.equal((out.match(/class="tct-crt/g) ?? []).length, 1);
  assert.match(out, /<div class="tct-crt tbr-screen"><div id="x"><\/div><\/div>/);
  assert.match(out, /class="tct-strut"/);
  assert.match(out, /class="tct-sect tbr-keys" data-roller-keys/);
  const lamps = h => [...h.matchAll(/tct-lamp--(\w+)/g)].map(m => m[1]).join(',');
  assert.equal(lamps(out), 'a,off,off');
  assert.equal(lamps(skin.skinRollerHtml('', { phase: 'rolled', passed: true })), 'g,off,a');
  assert.equal(lamps(skin.skinRollerHtml('', { phase: 'rolled', passed: false })), 'r,off,a');
}));

check('the content root loses its own fill, so each frame\'s screen shows', () => {
  const body = skin.rollerBodyHtml(build(baseState()));
  const tag = body.match(/<div id="sta2e-npc-roller"[^>]*>/)?.[0];
  assert.ok(tag);
  assert.equal(/background/.test(tag), false, tag);
  assert.match(tag, /max-height:/, 'its scrolling stays');
});

check('TMP Console: the card\'s panel, plate and tag, one monitor, key bed', () => withTheme('tmp-console', () => {
  const out = skin.skinRollerHtml('<div id="x"></div>', { title: 'Phaser Banks', phase: 'setup' });
  assert.match(out, /class="sta2e-roller sta2e-roller--tmp sta2e-task-card sta2e-task-card--tmp"/);
  assert.match(out, /data-theme="tmp-console"/);
  assert.match(out, /class="tmc-plate"/);
  assert.match(out, /<span class="tmc-tag">Setup<\/span>/);
  assert.equal(/tmc-code|tmc-ticks/.test(out), false);
  assert.match(out, /--tmc-plate:#e9c83a;/);
  assert.equal((out.match(/class="tmc-scr/g) ?? []).length, 1);
  assert.match(out, /<div class="tmc-scr tbr-screen" style="--tmc-s:#00aef0;"><div id="x"><\/div><\/div>/);
  assert.match(out, /class="tmc-bed tbr-keys" data-roller-keys/);
  const fail = skin.skinRollerHtml('', { phase: 'rolled', passed: false });
  assert.match(fail, /--tmc-plate:#c8312a;/);
  assert.match(fail, /--tmc-s:#ed2f76;/);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: true }), /--tmc-s:#00d27a;/);
}));

check('TMP Monitor: the same markup with the monitor modifier, code tab and ticks', () => withTheme('tmp-monitor', () => {
  const out = skin.skinRollerHtml('', { title: 'Phaser Banks', phase: 'setup' });
  assert.match(out, /class="sta2e-roller sta2e-roller--tmpmon sta2e-task-card sta2e-task-card--tmp sta2e-task-card--tmpmon"/);
  assert.match(out, /data-theme="tmp-monitor"/);
  assert.match(out, /<span class="tmc-code">SET<\/span>/);
  assert.match(out, /class="tmc-ticks"/);
  assert.equal(/tmc-plate"|tmc-tag/.test(out), false);
  assert.match(out, /--tmm-tab:#00aef0;/);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: true }), /<span class="tmc-code">OK<\/span>/);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: false }), /<span class="tmc-code">NEG<\/span>/);
}));

check('ENT: the touchscreen frame, head tab and foot, keys slot, colour by state', () => withTheme('ent-panel', () => {
  const out = skin.skinRollerHtml('<div id="x"></div>', { title: 'Phaser Banks', phase: 'setup' });
  assert.match(out, /class="sta2e-roller sta2e-roller--ent sta2e-task-card sta2e-task-card--ent tec"/);
  assert.match(out, /data-theme="ent-panel"/);
  assert.match(out, /--tec-c:#7aaec4;/);
  assert.match(out, /<div class="tec-in">/);
  assert.match(out, /<div class="tec-title">Phaser Banks<\/div>/);
  assert.match(out, /<span class="tec-tab">Setup<\/span>/);
  assert.match(out, /<div class="tec-body tbr-screen"><div id="x"><\/div><\/div>/);
  assert.match(out, /class="tec-actions tbr-keys" data-roller-keys/);
  assert.match(out, /class="tec-foot"><span>Adv\. Dice Roller<\/span>/);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: true }), /--tec-c:#a7d46c;[\s\S]*tec-tab">Rolled</);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: false }), /--tec-c:#e0533a;/);
}));

check('footer keys: main action, cancel and the rest per era', () => {
  assert.match(skin.footerKeyStyle('tng', 'roll', 0), /background:#ff9966;color:#000000;/);
  assert.match(skin.footerKeyStyle('tng', 'cancel', 1), /background:#5a5650;color:#f2f2f2;/);
  assert.match(skin.footerKeyStyle('tng', 'cancel', 0), /#5a5650/, 'cancel is dim even first');
  assert.match(skin.footerKeyStyle('tos', 'resolve', 0), /#40cc30/, 'main is the green key');
  assert.match(skin.footerKeyStyle('tos', 'reroll-all', 2), /#e83020/, 're-roll all is red');
  assert.match(skin.footerKeyStyle('tos', 'post', 1), /#e8c030/, 'a second post is amber');
  assert.match(skin.footerKeyStyle('tos', 'cancel', 3), /#666666/, 'cancel is grey');
  assert.match(skin.footerKeyStyle('tmp', 'roll', 0), /#2fbf70/, 'TMP main is the green lens');
  assert.match(skin.footerKeyStyle('tmp', 'reroll-all', 2), /#ed2f76/, 'TMP re-roll all is magenta');
  assert.match(skin.footerKeyStyle('tmp', 'cancel', 1), /#45443e/, 'TMP cancel is the unlit lens');
  assert.equal(skin.footerKeyStyle('tmpmon', 'roll', 0), 'background:#00d27a;border-color:#00d27a;color:#000000;');
  assert.equal(skin.footerKeyStyle('tmpmon', 'cancel', 1), 'background:transparent;border-color:#2a6a80;color:#2a6a80;');
  assert.deepEqual(skin.footerKeyClasses('tmp'), ['tbr-fkey', 'tmc-key', 'tmc-key--big']);
  assert.deepEqual(skin.footerKeyClasses('tmpmon'), ['tbr-fkey', 'tmc-key', 'tmc-key--big']);
  assert.deepEqual(skin.footerKeyClasses('tng'), ['tbr-fkey']);
  assert.match(skin.footerKeyStyle('ent', 'roll', 0), /^--k:#a7d46c;/, 'ENT main is the green tab');
  assert.match(skin.footerKeyStyle('ent', 'reroll-all', 2), /^--k:#e0533a;/, 'ENT re-roll all is red');
  assert.match(skin.footerKeyStyle('ent', 'cancel', 1), /^--k:#5e7f8f;/, 'ENT cancel is slate');
  assert.deepEqual(skin.footerKeyClasses('ent'), ['tbr-fkey', 'tec-key']);
  assert.equal(skin.footerKeyStyle('klingon', 'roll', 0), '');
});

check('a crit die is gold under ENT, whose primary is the grey of a miss', () => {
  const critStars = h => [...h.matchAll(/color:\s*([^;"]+);"?>★★/g)].map(m => m[1].trim());
  withTheme('ent-panel', () => {
    const stars = critStars(build(rolledState()));
    assert.ok(stars.length > 0, 'the rolled dialog draws a crit');
    assert.deepEqual([...new Set(stars)], ['#f0b400']);
  });
  const tngStars = critStars(build(rolledState()));
  assert.deepEqual([...new Set(tngStars)], [getLcTokens().primary], 'other eras keep their primary');
});

check('a crit die is gold under Klingon, whose primary is the red of a complication', () => {
  const critStars = h => [...h.matchAll(/color:\s*([^;"]+);"?>★★/g)].map(m => m[1].trim());
  withTheme('klingon', () => {
    const stars = critStars(build(rolledState()));
    assert.ok(stars.length > 0, 'the rolled dialog draws a crit');
    assert.deepEqual([...new Set(stars)], ['#ffd84a']);
  });
});

check('themes without a skin keep the plain dialog', () => {
  for (const t of ['blue', 'klingon', 'romulan']) {
    withTheme(t, () => {
      const raw = build(baseState());
      assert.equal(raw.includes('tbr-head'), false, t);
      assert.equal(skin.skinRollerHtml(raw, { title: 'x' }), raw, t);
    });
  }
});

// ── Optional preview page ────────────────────────────────────────────────────
const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  const out = path.resolve(process.argv[pi + 1]);
  const css = ['chat-card.css', 'task-card.css', 'task-card-tng.css', 'task-card-tos.css', 'task-card-tmp.css',
    'tmp-monitor.css', 'task-card-ent.css', 'roller-tng.css', 'roller-tos.css', 'roller-tmp.css', 'roller-ent.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/(tng|tmp|ent)\/([^"]+)"\)/g,
      (_, d, f) => `url("data:font/woff2;base64,${fs.readFileSync(`${root}/fonts/${d}/${f}`).toString('base64')}")`);
  const asset = f => `data:image/svg+xml;base64,${fs.readFileSync(f).toString('base64')}`;
  const d20 = asset('C:/Program Files/Foundry Virtual Tabletop/resources/app/public/icons/svg/d20-grey.svg');
  const coin = { momentum: asset(`${root}/assets/momentum.svg`), threat: asset(`${root}/assets/threat.svg`) };
  // A dialog as core renders it. Each footer key carries the style
  // footerKeyStyle gives it; the page script seats the footer as
  // seatRollerFooter does (the module itself needs Foundry's game object).
  const dialog = (skinName, title, inner, buttons) => `
    <div class="application dialog" data-skin="${skinName}"><header class="window-header">${title}</header>
      <section class="window-content"><form class="dialog-form standard-form">
        <div class="dialog-content standard-form">${inner}</div>
        <footer class="form-footer">${buttons.map(([a, l], i) => `<button type="submit" data-action="${a}" data-paint="${skin.footerKeyStyle(skinName, a, i)}" data-classes="${skin.footerKeyClasses(skinName).join(' ')}"><i class="fas fa-x"></i> ${l}</button>`).join('')}</footer>
      </form></section></div>`;
  const panes = [];
  for (const t of ['lcars-tng', 'lcars-fc', 'tos-panel', 'tmp-console', 'tmp-monitor', 'ent-panel']) {
    withTheme(t, () => {
      const s = skin.rollerSkin();
      const setupHtml = skin.skinRollerHtml(build(baseState()), { title: 'Phaser Banks', phase: 'setup' });
      const rolledHtml = skin.skinRollerHtml(build({ ...rolledState(), hasTalentReroll: true }), { title: 'Phaser Banks', phase: 'rolled', passed: true });
      panes.push([`${t} — setup`, dialog(s, 'Lt. Worf — Phaser Banks', setupHtml, [['roll', 'Roll'], ['cancel', 'Cancel']])]);
      panes.push([`${t} — rolled`, dialog(s, 'Lt. Worf — Phaser Banks', rolledHtml, [['resolve', 'Resolve HIT'], ['back', '← Setup'], ['reroll-all', 'Re-roll All'], ['cancel', 'Cancel']])]);
    });
  }
  const page = `<!doctype html><meta charset="utf-8"><title>Roller skins</title><style>${css}
body{background:#15151a;margin:0;padding:16px;font-family:sans-serif;color:#ccc}
.grid{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.application{width:min-content;background:#0b0b0d;border:1px solid #333;border-radius:6px}
.window-header{padding:5px 10px;background:#1c1c20;font-size:12px;color:#ddd}
.dialog-form{display:flex;flex-direction:column}
h4{margin:0 0 4px;font-size:11px;color:#888}</style>
<div class="grid">${panes.map(([t, h]) => `<div><h4>${t}</h4>${h}</div>`).join('')}</div>
<script type="module">
document.querySelectorAll('img').forEach(i => {
  const s = i.getAttribute('src') ?? '';
  if (s.endsWith('d20-grey.svg')) i.src = ${JSON.stringify(d20)};
  else if (s.endsWith('momentum.svg')) i.src = ${JSON.stringify(coin.momentum)};
  else if (s.endsWith('threat.svg')) i.src = ${JSON.stringify(coin.threat)};
});
document.querySelectorAll('.application').forEach(app => {
  const slot = app.querySelector('[data-roller-keys]'), footer = app.querySelector('.form-footer');
  app.classList.add('sta2e-roller-win', 'sta2e-roller-win--' + app.dataset.skin);
  footer.querySelectorAll('button').forEach(b => {
    b.querySelectorAll('i').forEach(x => x.remove());
    b.setAttribute('style', b.dataset.paint);
    b.classList.add(...b.dataset.classes.split(' '));
  });
  footer.classList.add('tbr-footer');
  slot.append(footer);
});
</script>`;
  fs.writeFileSync(out, page);
  console.log(`preview: ${out}`);
}

process.exit(failed ? 1 : 0);
