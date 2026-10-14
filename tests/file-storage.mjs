// node tests/file-storage.mjs
//
// Storage resolution for saved images: a local install, The Forge's Assets
// Library and an S3 bucket each need a different FilePicker source. The
// FilePicker and the ForgeVTT global are stubbed; file-storage.js is a leaf.
import assert from 'node:assert/strict';

const calls = [];
let browseImpl = async () => ({ files: [], dirs: [] });
const FP = {
  matchS3URL(url) {
    const ep = globalThis.game.data.files.s3?.endpoint;
    if (!ep) return null;
    return url.match(new RegExp(`^${ep.protocol}//(?<bucket>.*).${ep.host}/(?<key>.*)`));
  },
  async createDirectory(source, target, options) { calls.push(['mkdir', source, target, options?.bucket ?? null]); },
  async upload(source, target, file, body) {
    calls.push(['upload', source, target, file.name, body?.bucket ?? null]);
    return { path: source === 'forgevtt' ? `https://assets.forge-vtt.com/acct1/${target}/${file.name}` : `${target}/${file.name}` };
  },
  async browse(source, target, options) { calls.push(['browse', source, target]); return browseImpl(source, target, options); },
};
globalThis.foundry = { applications: { apps: { FilePicker: { implementation: FP } } } };

function setup({ forge = false, storages = ['data', 'public'], s3 = null } = {}) {
  calls.length = 0;
  globalThis.game = { data: { files: { storages, s3 } } };
  if (forge) globalThis.ForgeVTT = { usingTheForge: true };
  else delete globalThis.ForgeVTT;
}

const { writeStorage, storageForFile, uploadFile, browseFolder, childLocation } = await import('../scripts/file-storage.js');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

await check('local install writes to data, beside a relative portrait', () => {
  setup();
  assert.deepEqual(writeStorage(), { source: 'data', options: {} });
  assert.deepEqual(storageForFile('worlds/w/art/My%20Face.webp'), { source: 'data', target: 'worlds/w/art', options: {} });
});

await check('foreign URLs, data: and blob: URIs are never written beside', () => {
  setup();
  assert.equal(storageForFile('https://example.com/a/b.png'), null);
  assert.equal(storageForFile('data:image/png;base64,AAAA'), null);
  assert.equal(storageForFile('https://assets.forge-vtt.com/acct1/a/b.png'), null, 'Forge URL off the Forge');
});

await check('on The Forge, writes go to the Assets Library', () => {
  setup({ forge: true });
  assert.equal(writeStorage().source, 'forgevtt');
  assert.deepEqual(storageForFile('https://assets.forge-vtt.com/acct1/tokens/crew/kira.webp?x=1'),
    { source: 'forgevtt', target: 'tokens/crew', options: {} });
  assert.equal(storageForFile('https://assets.forge-vtt.com/bazaar/modules/x/a.png'), null, 'Bazaar is read-only');
});

await check('S3 portraits resolve to their bucket and key', () => {
  setup({ storages: ['data', 's3'], s3: { endpoint: { protocol: 'https:', host: 's3.example.com' }, buckets: ['b1'] } });
  assert.deepEqual(storageForFile('https://b1.s3.example.com/art/crew/face.png'),
    { source: 's3', target: 'art/crew', options: { bucket: 'b1' } });
});

await check('with no local storage, writes fall back to the first S3 bucket', () => {
  setup({ storages: ['s3'], s3: { endpoint: { protocol: 'https:', host: 's3.example.com' }, buckets: ['b1', 'b2'] } });
  assert.deepEqual(writeStorage(), { source: 's3', options: { bucket: 'b1' } });
});

await check('uploadFile creates each parent folder and returns the stored path', async () => {
  setup({ forge: true });
  const path = await uploadFile('worlds/w/sta2e-tokens', { name: 't.webp' });
  assert.equal(path, 'https://assets.forge-vtt.com/acct1/worlds/w/sta2e-tokens/t.webp');
  assert.deepEqual(calls.filter(c => c[0] === 'mkdir').map(c => c[2]), ['worlds', 'worlds/w', 'worlds/w/sta2e-tokens']);
  assert.ok(calls.every(c => c[1] === 'forgevtt'));
});

await check('uploadFile passes the S3 bucket through', async () => {
  setup({ storages: ['data', 's3'], s3: { endpoint: { protocol: 'https:', host: 's3.example.com' }, buckets: ['b1'] } });
  await uploadFile(storageForFile('https://b1.s3.example.com/art/face.png'), { name: 't.webp' });
  assert.deepEqual(calls.at(-1), ['upload', 's3', 'art', 't.webp', 'b1']);
});

await check('on The Forge a bare folder is browsed in data first, then the library', async () => {
  setup({ forge: true });
  browseImpl = async (source) => { if (source === 'data') throw new Error('nope'); return { files: ['https://assets.forge-vtt.com/acct1/art/a.png'], dirs: ['art/sub'] }; };
  const res = await browseFolder('art');
  assert.deepEqual(calls.map(c => c[1]), ['data', 'forgevtt']);
  assert.equal(res.loc.source, 'forgevtt');
  assert.deepEqual(childLocation(res.loc, 'art/sub'), { source: 'forgevtt', target: 'art/sub', options: {} });
  browseImpl = async () => ({ files: [], dirs: [] });
});

let failed = 0;
for (const [status, name, msg] of results) {
  console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ''}`);
  if (status === 'FAIL') failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
