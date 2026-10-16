// node tests/appearance-data.mjs
//
// Appearances: library normalisation, random picks, rule precedence across
// status and worn-item rules, baseline capture/restore, linked vs unlinked
// update shape, creation-time appearance, folder pairing and Visage import.
// appearance-data.js is a leaf with no imports, so it loads as-is.
import assert from 'node:assert/strict';
import {
  normalizeLibrary, normalizeState, pickLook, collectTriggers, matchRule,
  composeAppearance, visualUpdates, applyCreationAppearance, pairImages,
  classifyImage, looksFromVisage, nameKey, sameVisual, MODULE, STATE_FLAG,
  normalizeRing, ringUpdates, ringFromToken, normalizeLook, normalizeMimic, actorTraitNames, mayMimic, stateIsDressed,
  storeMimicInLibrary, rebaseVisual, ruleKey, findVersion,
} from '../scripts/appearance-data.js';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

const lib = normalizeLibrary({
  looks: [
    { id: 'duty', name: 'Duty', token: 't/duty.webp', portrait: 'p/duty.webp' },
    { id: 'ev',   name: 'EV Suit', token: 't/ev.webp', portrait: 'p/ev.webp', scale: 1.2 },
    { id: 'arm',  name: 'Armour', token: 't/arm.webp', portrait: '' },
    { id: 'dead', name: 'Fallen', token: 't/dead.webp', portrait: 'p/dead.webp' },
  ],
  randomize: true,
  rules: [
    { kind: 'status', match: 'dead', lookId: 'dead' },
    { kind: 'item', match: ' EV  suit ', lookId: 'ev' },
    { kind: 'item', match: 'Body Armor', lookId: 'arm', portrait: false },
    { kind: 'item', match: 'Ghost', lookId: 'missing' },
  ],
});
const current = { token: 't/proto.webp', portrait: 'p/actor.webp', scale: 1 };

await check('normalisation drops bad fields and keeps order', () => {
  const n = normalizeLibrary({ looks: [{ id: 'a', token: ' x.webp ' }, { id: 'a', token: 'y' }], defaultLookId: 'zzz', rules: [{ kind: 'weird' }] });
  assert.equal(n.looks.length, 2);
  assert.notEqual(n.looks[0].id, n.looks[1].id, 'duplicate ids re-rolled');
  assert.equal(n.looks[0].token, 'x.webp');
  assert.equal(n.defaultLookId, null, 'unknown default dropped');
  assert.equal(n.rules[0].kind, 'status');
  assert.equal(n.rules[0].portrait, true);
  assert.deepEqual(normalizeLibrary(null).looks, []);
});

await check('random pick only draws looks with token art, covers all', () => {
  const l = normalizeLibrary({ randomize: true, looks: [{ id: 'a', token: 'a' }, { id: 'b', portrait: 'b' }, { id: 'c', token: 'c' }] });
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(pickLook(l).id);
  assert.deepEqual([...seen].sort(), ['a', 'c']);
  assert.equal(pickLook(l, { rng: () => 0.9999 }).id, 'c');
});

await check('no randomize falls back to the default, else none', () => {
  const l = normalizeLibrary({ looks: [{ id: 'a', token: 'a' }], defaultLookId: 'a' });
  assert.equal(pickLook(l).id, 'a');
  assert.equal(pickLook(normalizeLibrary({ looks: [{ id: 'a', token: 'a' }] })), null);
});

await check('item rules match trimmed case-insensitive names, only while worn', () => {
  const carried = collectTriggers({ items: [{ name: 'ev suit', type: 'item', worn: false }] });
  assert.equal(matchRule(lib, carried), null, 'carried, not worn');
  const worn = collectTriggers({ items: [{ name: 'EV Suit', type: 'item', worn: true }] });
  assert.equal(matchRule(lib, worn).lookId, 'ev');
  const talent = collectTriggers({ items: [{ name: 'EV Suit', type: 'talent', worn: true }] });
  assert.equal(matchRule(lib, talent), null, 'non-wearable types ignored');
  assert.equal(nameKey('  Body   Armor '), 'body armor');
});

await check('first matching rule wins; dangling look ids are skipped', () => {
  const both = collectTriggers({ items: [{ name: 'Body Armor', type: 'armor', worn: true }, { name: 'EV Suit', type: 'item', worn: true }] });
  assert.equal(matchRule(lib, both).lookId, 'ev', 'suit listed above armour');
  const dead = collectTriggers({ statuses: ['dead'], items: [{ name: 'EV Suit', type: 'item', worn: true }] });
  assert.equal(matchRule(lib, dead).lookId, 'dead');
  const ghost = collectTriggers({ items: [{ name: 'Ghost', type: 'item', worn: true }] });
  assert.equal(matchRule(lib, ghost), null);
  const tk = collectTriggers({ conditions: ['destroyed'], defenseMode: 'evasive-action' });
  assert.ok(tk.status.has('destroyed') && tk.status.has('evasive-action'));
});

await check('rule override captures a baseline and restores it on clear', () => {
  const rule = matchRule(lib, collectTriggers({ items: [{ name: 'EV Suit', type: 'item', worn: true }] }));
  const on = composeAppearance({ library: lib, state: normalizeState(null), rule, current });
  assert.deepEqual(on.visual, { token: 't/ev.webp', portrait: 'p/ev.webp', scale: 1.2, ring: null, name: null });
  assert.equal(on.state.ruleLookId, 'ev');
  assert.deepEqual(on.state.baseline, { token: 't/proto.webp', portrait: 'p/actor.webp', scale: 1, ring: null, name: null });
  const off = composeAppearance({ library: lib, state: on.state, rule: null, current: on.visual });
  assert.deepEqual(off.visual, { token: 't/proto.webp', portrait: 'p/actor.webp', scale: 1, ring: null, name: null });
  assert.equal(off.state.baseline, null);
  assert.equal(off.state.ruleLookId, null);
  const idle = composeAppearance({ library: lib, state: off.state, rule: null, current });
  assert.equal(idle.visual, null, 'nothing to do once back to original');
});

await check('a chosen look sits under a rule and returns when it clears', () => {
  const picked = composeAppearance({ library: lib, state: normalizeState({ lookId: 'duty' }), rule: null, current });
  assert.equal(picked.visual.token, 't/duty.webp');
  const rule = matchRule(lib, collectTriggers({ statuses: ['dead'] }));
  const dead = composeAppearance({ library: lib, state: picked.state, rule, current: picked.visual });
  assert.equal(dead.visual.token, 't/dead.webp');
  assert.equal(dead.state.lookId, 'duty');
  const alive = composeAppearance({ library: lib, state: dead.state, rule: null, current: dead.visual });
  assert.equal(alive.visual.token, 't/duty.webp');
  assert.equal(alive.state.baseline.token, 't/proto.webp', 'baseline survives while a look is chosen');
});

await check('portrait:false rule keeps the chosen portrait; blank slots inherit', () => {
  const rule = matchRule(lib, collectTriggers({ items: [{ name: 'Body Armor', type: 'armor', worn: true }] }));
  const r = composeAppearance({ library: lib, state: normalizeState({ lookId: 'duty' }), rule, current });
  assert.equal(r.visual.token, 't/arm.webp');
  assert.equal(r.visual.portrait, 'p/duty.webp');
  const blank = composeAppearance({ library: lib, state: normalizeState({ lookId: 'arm' }), rule: null, current });
  assert.equal(blank.visual.portrait, 'p/actor.webp', 'portrait-less look falls back to baseline');
});

await check('deleted chosen look is forgotten', () => {
  const r = composeAppearance({ library: lib, state: normalizeState({ lookId: 'gone', baseline: current }), rule: null, current: {} });
  assert.equal(r.state.lookId, null);
  assert.equal(r.visual.token, 't/proto.webp');
});

await check('update shape: unlinked writes delta.img, linked writes actor.img', () => {
  const v = { token: 't/ev.webp', portrait: 'p/ev.webp', scale: 1.2 };
  const u = visualUpdates(v, { linked: false, currentScale: { scaleX: -1, scaleY: 1 } });
  assert.equal(u.token['delta.img'], 'p/ev.webp');
  assert.equal(u.token['texture.scaleX'], -1.2, 'mirror kept');
  assert.equal(u.actor, null);
  const l = visualUpdates(v, { linked: true });
  assert.equal(l.actor.img, 'p/ev.webp');
  assert.ok(!('delta.img' in l.token));
  assert.equal(visualUpdates({ token: 'a', portrait: null }, { linked: false }).token['delta.img'], null);
  assert.ok(sameVisual({ token: 'a', portrait: '', scale: 1 }, { token: 'a', portrait: null, scale: '1' }));
});

await check('creation: unlinked rolls a look, records prototype baseline', () => {
  const data = { actorLink: false, texture: { src: 't/proto.webp', scaleX: 1, scaleY: 1 } };
  assert.ok(applyCreationAppearance(data, lib, { rng: () => 0 }));
  assert.equal(data.texture.src, 't/duty.webp');
  assert.equal(data.delta.img, 'p/duty.webp');
  const st = data.flags[MODULE][STATE_FLAG];
  assert.equal(st.lookId, 'duty');
  assert.deepEqual(st.baseline, { token: 't/proto.webp', portrait: null, scale: 1, ring: null, name: null });
});

await check('creation: override restores the captured face and portrait', () => {
  const data = { actorLink: false, texture: { src: 'x' } };
  applyCreationAppearance(data, lib, { override: { state: { lookId: 'ev', baseline: current }, portrait: 'p/ev.webp' } });
  assert.equal(data.delta.img, 'p/ev.webp');
  assert.equal(data.flags[MODULE][STATE_FLAG].lookId, 'ev');
});

await check('creation: linked token wears what the actor wears, no portrait write', () => {
  const data = { actorLink: true, texture: { src: 't/proto.webp' } };
  assert.ok(applyCreationAppearance(data, lib, { actorState: { lookId: 'duty', ruleLookId: 'ev' } }));
  assert.equal(data.texture.src, 't/ev.webp');
  assert.equal(data.delta, undefined);
  const plain = { actorLink: true, texture: { src: 't/proto.webp' } };
  assert.equal(applyCreationAppearance(plain, lib, { actorState: null }), false);
});

await check('folder pairing by stem with keywords', () => {
  const looks = pairImages([
    'a/Klingon_03_token.webp', 'a/Klingon_03_portrait.webp',
    'a/Klingon-07-Token.png', 'a/Gorkon.webp', 'a/Martok bust.webp', 'a/readme.txt',
  ], { tokenKeywords: ['token'], portraitKeywords: ['portrait', 'bust'] });
  assert.equal(looks.length, 4);
  assert.deepEqual(looks[0], { name: 'Klingon 03', token: 'a/Klingon_03_token.webp', portrait: 'a/Klingon_03_portrait.webp' });
  assert.equal(looks[1].token, 'a/Klingon-07-Token.png');
  assert.equal(looks[1].portrait, '');
  assert.deepEqual(looks[2], { name: 'Gorkon', token: 'a/Gorkon.webp', portrait: 'a/Gorkon.webp' });
  assert.equal(looks[3].token, '');
  assert.equal(classifyImage('x/tokenring.webp'), null, 'keyword must be a whole word');
  assert.equal(classifyImage('x/Bob_portrait.webp'), 'portrait');
});

await check('Visage import maps label, texture, portrait, scale', () => {
  const looks = looksFromVisage({
    a: { label: 'EV', changes: { texture: { src: 't/ev.webp' }, portrait: 'p/ev.webp', scale: 1.5 } },
    b: { changes: { name: 'Disguise', texture: { src: 't/d.webp' } } },
    c: { label: 'Empty', changes: {} },
  });
  assert.equal(looks.length, 2);
  assert.deepEqual(looks[0], { name: 'EV', token: 't/ev.webp', portrait: 'p/ev.webp', scale: 1.5 });
  assert.equal(looks[1].name, 'Disguise');
  assert.equal(looksFromVisage([{ label: 'L', changes: { texture: { src: 'z' } } }]).length, 1);
});

await check('ring normalisation clamps and validates', () => {
  assert.equal(normalizeRing(null), null);
  const r = normalizeRing({ enabled: true, ringColor: '#FF9C00', backgroundColor: 'red', effects: -3, subjectScale: 0.2 });
  assert.deepEqual(r, { enabled: true, ringColor: '#ff9c00', backgroundColor: null, effects: 1, subjectScale: 1, subjectTexture: '' });
  const look = normalizeLook({ id: 'x', token: 't', ring: { enabled: false }, maker: { zoom: 2, src: 'p' } });
  assert.equal(look.ring.enabled, false);
  assert.deepEqual(look.maker, { zoom: 2, src: 'p' });
  assert.equal(normalizeLook({ maker: [1] }).maker, null);
});

await check('ring updates: enabled ring uses the token as subject; off writes only enabled', () => {
  const on = ringUpdates({ enabled: true, ringColor: '#112233', effects: 3, subjectScale: 1.1 }, 't/tok.webp');
  assert.deepEqual(on, {
    'ring.enabled': true, 'ring.colors.ring': '#112233', 'ring.colors.background': null,
    'ring.effects': 3, 'ring.subject.scale': 1.1, 'ring.subject.texture': 't/tok.webp',
  });
  assert.deepEqual(ringUpdates({ enabled: false }, 't'), { 'ring.enabled': false });
  assert.deepEqual(ringUpdates(null, 't'), {});
});

await check('dynamic ring look switches on, and Original switches it back off', () => {
  const l = normalizeLibrary({ looks: [{ id: 'r', token: 't/subj.webp', ring: { enabled: true, ringColor: '#ff9c00' } }] });
  const cur = { token: 't/proto.webp', portrait: null, scale: 1, ring: ringFromToken({ enabled: false }) };
  const on = composeAppearance({ library: l, state: normalizeState({ lookId: 'r' }), rule: null, current: cur });
  assert.equal(on.visual.ring.enabled, true);
  assert.equal(on.state.baseline.ring.enabled, false);
  const upd = visualUpdates(on.visual, { linked: false });
  assert.equal(upd.token['ring.enabled'], true);
  assert.equal(upd.token['ring.subject.texture'], 't/subj.webp');
  const off = composeAppearance({ library: l, state: { ...on.state, lookId: null }, rule: null, current: on.visual });
  assert.equal(off.visual.ring.enabled, false);
  assert.deepEqual(visualUpdates(off.visual, { linked: false }).token['ring.enabled'], false);
  assert.ok(!sameVisual(on.visual, off.visual), 'ring difference is a visual change');
});

await check('creation applies a look ring to nested data and records the prototype ring', () => {
  const l = normalizeLibrary({ randomize: true, looks: [{ id: 'r', token: 't/s.webp', ring: { enabled: true, backgroundColor: '#000000' } }] });
  const data = { actorLink: false, texture: { src: 't/p.webp' }, ring: { enabled: false, colors: {}, subject: { scale: 1 } } };
  applyCreationAppearance(data, l);
  assert.equal(data.ring.enabled, true);
  assert.equal(data.ring.subject.texture, 't/s.webp');
  assert.equal(data.ring.colors.background, '#000000');
  assert.equal(data.flags[MODULE][STATE_FLAG].baseline.ring.enabled, false);
});

await check('a look can rename the token, and Original restores the name', () => {
  const l = normalizeLibrary({ looks: [{ id: 'd', token: 't/dis.webp', tokenName: 'Ambassador Tal' }, { id: 'p', token: 't/plain.webp' }] });
  const cur = { token: 't/proto.webp', portrait: null, scale: 1, name: 'Odo' };
  const on = composeAppearance({ library: l, state: normalizeState({ lookId: 'd' }), rule: null, current: cur });
  assert.equal(on.visual.name, 'Ambassador Tal');
  assert.equal(on.state.baseline.name, 'Odo');
  assert.equal(visualUpdates(on.visual, { linked: false }).token.name, 'Ambassador Tal');
  const plain = composeAppearance({ library: l, state: { ...on.state, lookId: 'p' }, rule: null, current: on.visual });
  assert.equal(plain.visual.name, 'Odo', 'a look without a name puts the own name back');
  const off = composeAppearance({ library: l, state: { ...on.state, lookId: null }, rule: null, current: on.visual });
  assert.equal(off.visual.name, 'Odo');
  assert.ok(!sameVisual(on.visual, off.visual), 'a name change is a visual change');
  assert.equal(normalizeLook({ tokenName: '  X  ' }).tokenName, 'X');
});

await check('mimic copies another token wholesale, sits under rules and over the chosen look', () => {
  const l = normalizeLibrary({
    looks: [{ id: 'own', token: 't/own.webp', tokenName: 'Odo' }, { id: 'goo', token: 't/goo.webp', tokenName: 'Puddle' }],
    rules: [{ kind: 'status', match: 'dead', lookId: 'goo' }],
  });
  const mimic = normalizeMimic({ token: 't/kira.webp', portrait: 'p/kira.webp', scale: 1, ring: { enabled: true, ringColor: '#cc0000' }, tokenName: 'Major Kira', from: 'Major Kira' });
  const cur = { token: 't/own.webp', portrait: null, scale: 1, name: 'Odo' };
  const st = normalizeState({ lookId: 'own', mimic, baseline: { token: 't/proto.webp', name: 'Odo' } });
  assert.equal(st.mimic.from, 'Major Kira');
  const m = composeAppearance({ library: l, state: st, rule: null, current: cur });
  assert.deepEqual([m.visual.token, m.visual.portrait, m.visual.name, m.visual.ring.enabled], ['t/kira.webp', 'p/kira.webp', 'Major Kira', true]);
  const dead = composeAppearance({ library: l, state: st, rule: matchRule(l, collectTriggers({ statuses: ['dead'] })), current: m.visual });
  assert.deepEqual([dead.visual.token, dead.visual.name], ['t/goo.webp', 'Puddle'], 'a rule beats the disguise');
  const ended = composeAppearance({ library: l, state: { ...st, mimic: null }, rule: null, current: m.visual });
  assert.deepEqual([ended.visual.token, ended.visual.name], ['t/own.webp', 'Odo'], 'ending it returns to the chosen look');
  const bare = composeAppearance({ library: normalizeLibrary({}), state: normalizeState({ mimic }), rule: null, current: cur });
  assert.equal(bare.visual.token, 't/kira.webp', 'works with no looks at all');
  assert.equal(bare.state.baseline.name, 'Odo');
  const back = composeAppearance({ library: normalizeLibrary({}), state: { ...bare.state, mimic: null }, rule: null, current: bare.visual });
  assert.deepEqual([back.visual.token, back.visual.name, back.state.baseline], ['t/own.webp', 'Odo', null]);
  assert.equal(normalizeMimic({}), null);
});

await check('mimic access: GM always, trait by whole word, anyone, gm-only', () => {
  const traits = actorTraitNames({ items: [{ type: 'trait', name: 'Changeling (Founder)' }, { type: 'talent', name: 'Shapeshifter' }], traitsText: 'Bajoran, Security' });
  assert.deepEqual(traits, ['Changeling (Founder)', 'Bajoran', 'Security'], 'talents are not traits');
  const cfg = { access: 'trait', traits: ['Changeling', 'Shapeshifter'] };
  assert.equal(mayMimic({ ...cfg, actorTraits: traits }), true);
  assert.equal(mayMimic({ ...cfg, actorTraits: ['Unchangeling'] }), false, 'whole word only');
  assert.equal(mayMimic({ ...cfg, actorTraits: ['Human'] }), false);
  assert.equal(mayMimic({ ...cfg, isGM: true, actorTraits: [] }), true, 'GM always');
  assert.equal(mayMimic({ access: 'anyone', actorTraits: [] }), true);
  assert.equal(mayMimic({ access: 'gm', traits: ['Changeling'], actorTraits: traits }), false);
  assert.equal(mayMimic({ access: 'trait', traits: [], actorTraits: traits }), false, 'empty list allows nobody');
});

await check('a mimic survives the transporter: art, scale, ring, name and portrait', () => {
  const mimic = { token: 't/kira.webp', portrait: 'p/kira.webp', scale: 1.1, ring: { enabled: true, ringColor: '#cc0000' }, tokenName: 'Major Kira', from: 'Major Kira' };
  const captured = { state: { lookId: null, mimic, baseline: { token: 't/odo.webp', name: 'Odo', scale: 1 } }, portrait: 'p/kira.webp' };
  // buildSpawnTokenData has already set the buffer's display name — the actor's.
  const data = { actorLink: false, name: 'Odo', texture: { src: 't/odo.webp', scaleX: 1, scaleY: 1 }, ring: { enabled: false } };
  assert.ok(applyCreationAppearance(data, normalizeLibrary({}), { override: captured }));
  assert.equal(data.texture.src, 't/kira.webp');
  assert.equal(data.texture.scaleX, 1.1);
  assert.equal(data.name, 'Major Kira', 'the disguise keeps its name through the beam');
  assert.equal(data.ring.enabled, true);
  assert.equal(data.delta.img, 'p/kira.webp');
  const st = data.flags[MODULE][STATE_FLAG];
  assert.equal(st.mimic.from, 'Major Kira', 'still a mimic, so it can be ended');
  assert.equal(st.baseline.name, 'Odo', 'and ending it restores the own name');
});

await check('a linked character carries its mimic onto a new scene, even with no looks', () => {
  const actorState = { mimic: { token: 't/kira.webp', tokenName: 'Major Kira', from: 'Major Kira' }, baseline: { token: 't/odo.webp', name: 'Odo' } };
  const data = { actorLink: true, name: 'Odo', texture: { src: 't/odo.webp' } };
  assert.ok(applyCreationAppearance(data, normalizeLibrary({}), { actorState }));
  assert.equal(data.texture.src, 't/kira.webp');
  assert.equal(data.name, 'Major Kira');
  assert.equal(data.delta, undefined, 'a linked portrait lives on the actor, not the token');
  assert.ok(stateIsDressed(actorState));
  assert.ok(!stateIsDressed({ baseline: { token: 'x' } }));
});

await check('a restored pattern in a look (no mimic) keeps the look and its token name', () => {
  const lib = normalizeLibrary({ looks: [{ id: 'ev', token: 't/ev.webp', tokenName: 'Suited Crewman' }] });
  const data = { actorLink: false, name: 'Crewman', texture: { src: 't/proto.webp' } };
  applyCreationAppearance(data, lib, { override: { state: { lookId: 'ev', baseline: { token: 't/proto.webp', name: 'Crewman' } }, portrait: null } });
  assert.deepEqual([data.texture.src, data.name, data.delta.img], ['t/ev.webp', 'Suited Crewman', null]);
});

await check('a mimic can be stored as a look, once', () => {
  const lib = normalizeLibrary({ looks: [{ id: 'own', token: 't/odo.webp' }] });
  const mimic = { token: 't/kira.webp', portrait: 'p/kira.webp', scale: 1.1, ring: { enabled: true, ringColor: '#cc0000' }, tokenName: 'Major Kira', from: 'Major Kira' };
  const a = storeMimicInLibrary(lib, mimic);
  assert.equal(a.library.looks.length, 2);
  assert.deepEqual([a.look.name, a.look.token, a.look.portrait, a.look.scale, a.look.tokenName, a.look.ring.enabled],
    ['Major Kira', 't/kira.webp', 'p/kira.webp', 1.1, 'Major Kira', true]);
  assert.equal(lib.looks.length, 1, 'the input library is not mutated');
  const b = storeMimicInLibrary(a.library, mimic);
  assert.equal(b.look, null);
  assert.equal(b.duplicate.id, a.look.id, 'storing twice finds the first copy');
  assert.equal(b.library.looks.length, 2);
  assert.equal(storeMimicInLibrary(lib, null).look, null);
  // The stored look composes exactly like the mimic did.
  const v = composeAppearance({ library: a.library, state: normalizeState({ lookId: a.look.id }), rule: null, current: { token: 't/odo.webp', name: 'Odo' } }).visual;
  assert.deepEqual([v.token, v.name, v.scale], ['t/kira.webp', 'Major Kira', 1.1]);
  // A stored form is never rolled for a new token.
  const r = { ...a.library, randomize: true };
  for (let i = 0; i < 50; i++) assert.equal(pickLook(r).id, 'own');
  assert.equal(normalizeLook(a.look).mimicked, true, 'the mark survives normalisation');
});

await check('rebaseVisual follows only figures still on the old original', () => {
  const oldBase = { token: 'icons/svg/mystery-man.svg', portrait: 'icons/svg/mystery-man.svg', scale: 1, ring: null };
  const newBase = { token: 't/kira_token.webp', portrait: 'p/kira.webp', scale: 1.2, ring: { enabled: true, ringColor: '#ff0000' } };
  // Undressed, still on the default art: every slot follows.
  const a = rebaseVisual({ oldBase, newBase, current: { token: 'icons/svg/mystery-man.svg', scale: 1, ring: null } });
  assert.deepEqual([a.patch.token, a.patch.scale, a.patch.ring.enabled, 'portrait' in a.patch], ['t/kira_token.webp', 1.2, true, false]);
  assert.equal(a.baseline, null);
  // Undressed but re-skinned by hand: its token stays, its scale still follows.
  const b = rebaseVisual({ oldBase, newBase, current: { token: 't/other.webp', scale: 1 } });
  assert.deepEqual(b.patch, { scale: 1.2 });
  // Dressed: the remembered original is rewritten, nothing drawn now.
  const c = rebaseVisual({ oldBase, newBase, baseline: { token: 'icons/svg/mystery-man.svg', portrait: null, scale: 1, ring: null, name: 'Kira' } });
  assert.equal(c.patch, null);
  assert.deepEqual([c.baseline.token, c.baseline.portrait, c.baseline.scale, c.baseline.name], ['t/kira_token.webp', null, 1.2, 'Kira'],
    'a null baseline portrait is "use the actor" and is left alone');
  // Only the art changed: an enabled ring is not read as changed.
  const ring = { enabled: true, ringColor: '#00ff00' };
  const e = rebaseVisual({ oldBase: { ...oldBase, ring }, newBase: { ...oldBase, token: 't/new.webp', ring }, current: { token: 'icons/svg/mystery-man.svg', ring } });
  assert.deepEqual(e.patch, { token: 't/new.webp' });
  // A placed token's ring names its own art as the subject: it is re-pointed.
  const placed = { token: 'icons/svg/mystery-man.svg', ring: { ...ring, subjectTexture: 'icons/svg/mystery-man.svg' } };
  const g = rebaseVisual({ oldBase: { ...oldBase, ring }, newBase: { ...oldBase, token: 't/new.webp', ring }, current: placed });
  assert.deepEqual([g.patch.token, g.patch.ring.enabled, g.patch.ring.subjectTexture], ['t/new.webp', true, '']);
  // Nothing changed: nothing to do.
  const d = rebaseVisual({ oldBase, newBase: oldBase, current: { token: 'icons/svg/mystery-man.svg', scale: 1 } });
  assert.deepEqual([d.patch, d.baseline], [null, null]);
});

await check('baseMaker survives normalisation', () => {
  assert.deepEqual(normalizeLibrary({ baseMaker: { src: 'p/kira.webp', zoom: 1.1 } }).baseMaker, { src: 'p/kira.webp', zoom: 1.1 });
  assert.equal(normalizeLibrary({}).baseMaker, null);
});

// ── Per-look versions of a rule ──────────────────────────────────────────────

const vlib = normalizeLibrary({
  looks: [
    { id: 'dress', name: 'Dress', token: 't/dress.webp', portrait: 'p/dress.webp', scale: 0.9, ring: { enabled: false },
      versions: [
        { kind: 'status', match: 'dead', token: 't/dress-dead.webp' },
        { kind: 'item', match: 'ev suit', token: 't/dress-ev.webp', portrait: 'p/dress-ev.webp' },
        { kind: 'status', match: 'stun', token: 't/dress-stun.webp' },
        { kind: 'status', match: '', token: 'x' },
        { kind: 'status', match: 'dying' },
      ] },
    { id: 'duty', name: 'Duty', token: 't/duty.webp', portrait: 'p/duty.webp' },
    { id: 'dead', name: 'Fallen', token: 't/dead.webp', portrait: 'p/dead.webp', scale: 1.5, ring: { enabled: true, ringColor: '#ff0000' } },
    { id: 'ev', name: 'EV', token: 't/ev.webp', portrait: 'p/ev.webp' },
  ],
  baseVersions: [{ kind: 'status', match: 'dead', token: 't/orig-dead.webp', portrait: 'p/orig-dead.webp' }],
  rules: [
    { kind: 'status', match: 'dead', lookId: 'dead' },
    { kind: 'item', match: 'EV  Suit', lookId: 'ev', portrait: false },
    { kind: 'status', match: 'stun', lookId: 'dead' },
  ],
});
const vcur = { token: 't/proto.webp', portrait: 'p/actor.webp', scale: 1 };
const vrule = (k, m) => vlib.rules.find(r => r.kind === k && r.match === m);

await check('versions: normalisation drops empty and unmatched entries', () => {
  assert.deepEqual(vlib.looks[0].versions.map(ruleKey), ['status:dead', 'item:ev suit', 'status:stun']);
  assert.deepEqual(vlib.looks[1].versions, []);
  assert.equal(vlib.baseVersions.length, 1);
  assert.deepEqual(normalizeLibrary({}).baseVersions, []);
});

await check('versions: a look\'s own token replaces the rule look, empty portrait falls back to it', () => {
  const r = composeAppearance({ library: vlib, state: normalizeState({ lookId: 'dress' }), rule: vrule('status', 'dead'), current: vcur });
  assert.equal(r.visual.token, 't/dress-dead.webp');
  assert.equal(r.visual.portrait, 'p/dead.webp');
  // Framing comes from the worn look, not the rule look.
  assert.equal(r.visual.scale, 0.9);
  assert.equal(r.visual.ring.enabled, false);
  assert.equal(r.state.ruleLookId, 'dead');
  assert.equal(r.state.ruleKey, 'status:dead');
});

await check('versions: explicit portrait shows even when the rule leaves portraits alone', () => {
  const r = composeAppearance({ library: vlib, state: normalizeState({ lookId: 'dress' }), rule: vrule('item', 'EV  Suit'), current: vcur });
  assert.equal(r.visual.token, 't/dress-ev.webp');
  assert.equal(r.visual.portrait, 'p/dress-ev.webp');
});

await check('versions: a look without one shows the rule look as before', () => {
  const r = composeAppearance({ library: vlib, state: normalizeState({ lookId: 'duty' }), rule: vrule('status', 'dead'), current: vcur });
  assert.equal(r.visual.token, 't/dead.webp');
  assert.equal(r.visual.portrait, 'p/dead.webp');
  assert.equal(r.visual.scale, 1.5);
});

await check('versions: the Original\'s apply with no look on, but not under a mimic', () => {
  const r = composeAppearance({ library: vlib, state: normalizeState(null), rule: vrule('status', 'dead'), current: vcur });
  assert.equal(r.visual.token, 't/orig-dead.webp');
  assert.equal(r.visual.portrait, 'p/orig-dead.webp');
  const m = composeAppearance({ library: vlib, state: normalizeState({ mimic: { token: 't/odo.webp' } }), rule: vrule('status', 'dead'), current: vcur });
  assert.equal(m.visual.token, 't/dead.webp');
});

await check('versions: two rules sharing one look keep their own versions, including at creation', () => {
  const stun = composeAppearance({ library: vlib, state: normalizeState({ lookId: 'dress' }), rule: vrule('status', 'stun'), current: vcur });
  assert.equal(stun.visual.token, 't/dress-stun.webp');
  // A linked token placed while stunned re-finds the stun rule by key, not the dead rule by look.
  const data = { actorLink: true, texture: { src: 't/proto.webp' } };
  applyCreationAppearance(data, vlib, { actorState: stun.state });
  assert.equal(data.texture.src, 't/dress-stun.webp');
  // An old state with no ruleKey still resolves through the look id.
  const old = { actorLink: true, texture: { src: 't/proto.webp' } };
  applyCreationAppearance(old, vlib, { actorState: { lookId: 'dress', ruleLookId: 'dead' } });
  assert.equal(old.texture.src, 't/dress-dead.webp');
});

await check('versions: findVersion matches item rules by name key', () => {
  assert.equal(findVersion(vlib.looks[0], { kind: 'item', match: '  ev SUIT ' })?.token, 't/dress-ev.webp');
  assert.equal(findVersion(vlib.looks[1], vrule('status', 'dead')), null);
});

let failed = 0;
for (const [status, name, msg] of results) {
  if (status === 'FAIL') failed++;
  console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
