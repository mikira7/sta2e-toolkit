// node tests/roller-skins.mjs [--preview out.html]
//
// The era skins for the Adv. Dice Roller dialog (roller-skin.js): TNG / First
// Contact, TOS, TMP Console, TMP Monitor, ENT, Klingon and Romulan. The dialog content is the REAL buildDialogContent from
// npc-roller.js, lifted out of the source and run in a vm with its helpers
// stubbed (the pattern tests/ground-melee-vfx.mjs uses), in the setup and the
// rolled phase. Checks that the shared body pass keeps every id, class, data-*
// and wiring-toggled display the content had, that no square corners, LCARS
// font or accent-color survive, that die pips are left alone, that each era
// gets its own frame and footer slot, and that themes without a skin
// (Starfleet Blue) keep the plain dialog. The Romulan scroll cues
// (wireRollerScroll) are driven against a small DOM stub.
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
const { getLcTokens, getActiveLcThemeKey, isEntTheme, isKlingonTheme, isRomulanTheme } = await import('../scripts/lcars-theme.js');
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
  getActiveLcThemeKey, isEntTheme, isKlingonTheme, isRomulanTheme,
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
    klingon: 'klingon', romulan: 'romulan', blue: null };
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
  assert.match(out, /<div class="tbr-screen"><div id="x"><\/div><\/div>\s*<div class="tbr-keys" data-roller-keys><\/div>/);
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
  assert.equal(/max-height|overflow/.test(tag), false, 'the frame\'s screen scrolls, not the content');
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

check('Klingon: the scope frame, head code and lamp, keys slot, phosphor by state', () => withTheme('klingon', () => {
  const out = skin.skinRollerHtml('<div id="x"></div>', { title: '⚔ Disruptor Cannons', phase: 'setup' });
  assert.match(out, /class="sta2e-roller sta2e-roller--klingon sta2e-task-card sta2e-task-card--klingon tkc"/);
  assert.match(out, /data-theme="klingon"/);
  assert.match(out, /--tkc-c:#6fd24a;/);
  assert.match(out, /<div class="tkc-title">Disruptor Cannons<\/div>/);
  assert.match(out, /<span class="tkc-code">Setup<\/span>/);
  assert.match(out, /class="tkc-tri"/);
  assert.equal((out.match(/class="tkc-scope/g) ?? []).length, 1, 'one scope for the whole content');
  assert.match(out, /<div class="tkc-scope tbr-screen"><div id="x"><\/div><\/div>/);
  assert.match(out, /class="tkc-actions tbr-keys" data-roller-keys/);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: true }), /--tkc-c:#ffd84a;[\s\S]*tkc-code">Rolled</);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: false }), /--tkc-c:#ff5a40;/);
}));

check('Romulan: the Raptor Wing frame, wings and code, a wrapped screen, keys slot, colour by state', () => withTheme('romulan', () => {
  const out = skin.skinRollerHtml('<div id="x"></div>', { title: '⚔ Disruptor Bank', phase: 'setup' });
  assert.match(out, /class="sta2e-roller sta2e-roller--romulan sta2e-task-card sta2e-task-card--romulan trw"/);
  assert.match(out, /data-theme="romulan"/);
  assert.match(out, /--trw-c:#22aa44;/);
  assert.match(out, /<div class="trw-title">Disruptor Bank<\/div>/);
  assert.match(out, /<div class="trw-code">Setup<\/div>/);
  assert.equal((out.match(/class="trw-wing/g) ?? []).length, 2);
  assert.match(out, /<div class="trw-scrollwrap">\s*<div class="trw-screen tbr-screen"><div id="x"><\/div><\/div>\s*<\/div>/);
  assert.match(out, /class="trw-actions tbr-keys" data-roller-keys/);
  assert.ok(out.indexOf('tbr-keys') > out.indexOf('trw-scrollwrap'), 'the keys sit outside the scrolling screen');
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: true }), /--trw-c:#d8c050;[\s\S]*trw-code">Rolled</);
  assert.match(skin.skinRollerHtml('', { phase: 'rolled', passed: false }), /--trw-c:#ff4a5a;/);
}));

check('Romulan scroll cues: a jump strip from the captions, the more chip, fades by scroll position', () => {
  // A small DOM: enough of Element for wireRollerScroll, with layout faked
  // from a per-element top and the screen's scroll metrics.
  class El {
    constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentElement = null;
      this.dataset = {}; this.attrs = {}; this.listeners = {}; this.style = { setProperty: (k, v) => { this.style[k] = v; } };
      this.className = ''; this.textContent = ''; this._top = 0; }
    get classList() { const el = this; return {
      contains: c => el.className.split(/\s+/).includes(c),
      toggle: (c, on) => { const set = new Set(el.className.split(/\s+/).filter(Boolean)); on ? set.add(c) : set.delete(c); el.className = [...set].join(' '); },
    }; }
    append(...kids) { for (const k of kids) { k.parentElement = this; this.children.push(k); } }
    prepend(k) { k.parentElement = this; this.children.unshift(k); }
    setAttribute(k, v) { this.attrs[k] = v; }
    toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
    hasAttribute(k) { return k in this.attrs; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    fire(t, ev = {}) { for (const fn of this.listeners[t] ?? []) fn(ev); }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
    matches(sel) {
      if (sel === '.tbr-screen') return this.classList.contains('tbr-screen');
      if (sel === '.tbr-head') return this.classList.contains('tbr-head');
      if (sel === 'button') return this.tagName === 'BUTTON';
      if (sel === ':scope > span') return false;
      return false;
    }
    querySelector(sel) {
      if (sel === ':scope > span') return this.children.find(c => c.tagName === 'SPAN') ?? null;
      return this.all().find(e => e.matches(sel)) ?? null;
    }
    querySelectorAll(sel) { return this.all().filter(e => e.matches(sel)); }
    get offsetHeight() { return this.classList.contains('tbr-jump') ? 24 : 0; }
    getBoundingClientRect() { const sc = this._screen; return { top: this === sc ? 0 : this._top - (sc?.scrollTop ?? 0) }; }
  }
  const doc = { createElement: tag => new El(tag, doc) };
  const mk = (tag, cls, parent) => { const e = doc.createElement(tag); e.className = cls; parent?.append(e); return e; };
  const frame = mk('div', 'sta2e-roller sta2e-roller--romulan');
  frame.dataset.phase = 'setup';
  const wrap = mk('div', 'trw-scrollwrap', frame);
  const screen = mk('div', 'trw-screen tbr-screen', wrap);
  Object.assign(screen, { scrollTop: 0, clientHeight: 300, scrollHeight: 1000, scrollTo({ top }) { this.scrollTop = top; this.fire('scroll'); } });
  const body = mk('div', '', screen);
  const tops = [10, 200, 420, 640, 860];
  const names = ['Subcmdr. Tal', 'Officer Advantages', 'Dice Pool', 'Ship Pool', 'Task Options'];
  for (const [i, top] of tops.entries()) {
    const head = mk('div', 'tbr-head', body);
    if (i === 3) { const sp = mk('span', '', head); sp.textContent = 'Ship Pool'; head.textContent = 'Ship PoolManage'; }
    else head.textContent = names[i];
    head._top = top;
  }
  for (const e of [frame, ...frame.all()]) e._screen = screen;

  skin.wireRollerScroll(frame);
  const jump = screen.children[0];
  assert.equal(jump.className, 'tbr-jump', 'the strip is the first thing on the screen');
  const keys = jump.children;
  assert.deepEqual(keys.map(k => k.textContent), names, 'one key per caption, the Ship Pool key without its Manage text');
  assert.ok(keys[0].classList.contains('is-on'), 'the first section is lit');
  const more = wrap.children.at(-1);
  assert.equal(more.className, 'tbr-more');
  assert.equal(more.textContent, '▼ 3 more', 'three captions below the fold');
  assert.ok(wrap.hasAttribute('data-down') && !wrap.hasAttribute('data-up'));

  keys[2].closest = () => keys[2];
  jump.fire('click', { target: keys[2] });
  assert.equal(screen.scrollTop, 420 - 24 - 4, 'a jump key scrolls its caption under the strip');
  assert.ok(wrap.hasAttribute('data-up'));
  assert.ok(keys[2].classList.contains('is-on') && !keys[0].classList.contains('is-on'));

  screen.scrollTop = 700; screen.fire('scroll');
  assert.ok(!wrap.hasAttribute('data-down'), 'no fade at the bottom once scrolled to the end');
  assert.ok(keys[4].classList.contains('is-on'), 'at the end the last section is lit');

  skin.wireRollerScroll(frame);
  assert.equal(screen.children.filter(c => c.className === 'tbr-jump').length, 1, 'wiring twice adds nothing');

  const rolled = mk('div', 'sta2e-roller');
  rolled.dataset.phase = 'rolled';
  const w2 = mk('div', '', rolled);
  const s2 = mk('div', 'tbr-screen', w2);
  Object.assign(s2, { scrollTop: 0, clientHeight: 300, scrollHeight: 300, scrollTo() {} });
  for (const e of [rolled, ...rolled.all()]) e._screen = s2;
  skin.wireRollerScroll(rolled);
  assert.equal(s2.children.length, 0, 'no jump strip in the rolled phase');
  assert.ok(!w2.hasAttribute('data-down'), 'nothing to scroll, no fade');
});

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
  assert.match(skin.footerKeyStyle('klingon', 'roll', 0), /^--k:#ffd84a;.*color:#1a0200;$/, 'Klingon main is the gold plate');
  assert.match(skin.footerKeyStyle('klingon', 'reroll-all', 2), /^--k:#ff5a40;/, 'Klingon re-roll all is red');
  assert.match(skin.footerKeyStyle('klingon', 'cancel', 0), /^--k:#7a5040;.*color:#ffe6dc;$/, 'Klingon cancel is the dim plate, light ink');
  assert.deepEqual(skin.footerKeyClasses('klingon'), ['tbr-fkey', 'tkc-key']);
  assert.match(skin.footerKeyStyle('romulan', 'roll', 0), /^--k:#5cf09a;/, 'Romulan main is the jade key');
  assert.match(skin.footerKeyStyle('romulan', 'reroll-all', 2), /^--k:#ff4a5a;/, 'Romulan re-roll all is red');
  assert.match(skin.footerKeyStyle('romulan', 'cancel', 0), /^--k:#3e5c48;/, 'Romulan cancel is the dim key');
  assert.deepEqual(skin.footerKeyClasses('romulan'), ['tbr-fkey', 'trw-key']);
  assert.equal(skin.footerKeyStyle('blue', 'roll', 0), '');
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

check('under Klingon a crit die is gold (the primary is the complication red) and a success the scope green', () => {
  const critStars = h => [...h.matchAll(/color:\s*([^;"]+);"?>★★/g)].map(m => m[1].trim());
  withTheme('klingon', () => {
    const stars = critStars(build(rolledState()));
    assert.ok(stars.length > 0, 'the rolled dialog draws a crit');
    assert.deepEqual([...new Set(stars)], ['#ffd84a']);
    // A success is the scope's phosphor, not the token olive (#886600).
    const html = build(rolledState());
    assert.equal(/color:#886600;[^"]*"[^>]*>s*d/.test(html), false, 'no success die left in the olive');
    assert.match(html, /#6fd24a/);
  });
});

check('under Romulan a crit die is gold (the primary is the success green) and a success the bright jade', () => {
  const critStars = h => [...h.matchAll(/color:\s*([^;"]+);"?>★★/g)].map(m => m[1].trim());
  withTheme('romulan', () => {
    const stars = critStars(build(rolledState()));
    assert.ok(stars.length > 0, 'the rolled dialog draws a crit');
    assert.deepEqual([...new Set(stars)], ['#d8c050']);
    assert.match(build(rolledState()), /#5cf09a/);
  });
});

check('themes without a skin keep the plain dialog', () => {
  for (const t of ['blue']) {
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
    'tmp-monitor.css', 'task-card-ent.css', 'roller.css', 'roller-tng.css', 'roller-tos.css', 'roller-tmp.css', 'roller-ent.css',
    'task-card-klingon.css', 'roller-klingon.css', 'task-card-romulan.css', 'roller-romulan.css']
    .map(f => fs.readFileSync(`${root}/styles/${f}`, 'utf8')).join('\n')
    .replace(/url\("\.\.\/fonts\/(tng|tmp|ent|klingon|romulan)\/([^"]+)"\)/g,
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
  for (const t of ['lcars-tng', 'lcars-fc', 'tos-panel', 'tmp-console', 'tmp-monitor', 'ent-panel', 'klingon', 'romulan']) {
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
.application{display:flex;flex-flow:column nowrap;overflow:hidden;max-height:calc(100vh - 32px);width:min-content;background:#0b0b0d;border:1px solid #333;border-radius:6px}
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
