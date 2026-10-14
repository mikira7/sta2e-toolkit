/**
 * sta2e-toolkit | file-storage.js
 *
 * Where to read and write files, for every hosting setup — not just a local
 * install. Core's FilePicker takes a storage SOURCE beside each path, and
 * hard-coding "data" (as the module did everywhere) fails three ways:
 *
 *   The Forge   user files live in the Assets Library, source "forgevtt", and
 *               come back as https://assets.forge-vtt.com/<account>/<key> URLs.
 *   S3          a world can store on a bucket, source "s3" plus a `bucket`
 *               option; files are bucket URLs (`FilePicker.matchS3URL`).
 *   no "data"   a host may switch local storage off entirely, which core's own
 *               picker handles by falling back to `game.data.files.storages[0]`.
 *
 * So a path is resolved to {source, target, options} here, once, and the
 * callers keep passing plain paths and URLs around. A leaf with no imports.
 */

const FORGE_PREFIX = "https://assets.forge-vtt.com/";

function _FP() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
}

/** True when the world is hosted on The Forge. */
export function onTheForge() {
  return typeof ForgeVTT !== "undefined" && !!ForgeVTT?.usingTheForge;
}

function _storages() {
  return game.data?.files?.storages ?? ["data"];
}

/**
 * Where files the module CREATES should go: the Forge Assets Library on The
 * Forge, otherwise the local data folder, otherwise the first S3 bucket.
 * @returns {{source: string, options: object}}
 */
export function writeStorage() {
  if (onTheForge()) return { source: "forgevtt", options: {} };
  const storages = _storages();
  if (storages.includes("data")) return { source: "data", options: {} };
  if (storages.includes("s3")) return { source: "s3", options: { bucket: game.data.files.s3?.buckets?.[0] ?? null } };
  return { source: storages[0] ?? "data", options: {} };
}

/**
 * Turn a stored path or URL into the folder it lives in, as something the
 * FilePicker can write to — or null when nothing may be written there (a URL
 * on some other host, a Forge Bazaar asset, a data: URI).
 *
 * @param {string} path  A file path or URL
 * @returns {{source: string, target: string, options: object}|null}
 */
export function storageForFile(path) {
  const clean = String(path ?? "").split(/[?#]/)[0];
  const dirOf = (key) => {
    let k = key;
    try { k = decodeURIComponent(k); } catch { /* keep as is */ }
    const i = k.lastIndexOf("/");
    return i < 0 ? "" : k.slice(0, i);
  };
  if (!clean || clean.startsWith("data:") || clean.startsWith("blob:")) return null;

  // The Forge: https://assets.forge-vtt.com/<account>/<key>. Writing to the same
  // key lands in the CURRENT user's library, which is where a GM's own art lives.
  if (clean.startsWith(FORGE_PREFIX)) {
    if (!onTheForge()) return null;
    const rest = clean.slice(FORGE_PREFIX.length);
    const slash = rest.indexOf("/");
    const account = slash < 0 ? rest : rest.slice(0, slash);
    if (account === "bazaar" || slash < 0) return null;   // shared content, not ours
    return { source: "forgevtt", target: dirOf(rest.slice(slash + 1)), options: {} };
  }

  // S3 buckets core knows about.
  const s3 = _FP().matchS3URL?.(clean);
  if (s3?.groups) return { source: "s3", target: dirOf(s3.groups.key), options: { bucket: s3.groups.bucket } };

  // Any other URL is someone else's server.
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;

  // A relative path: the local data folder, or the Forge library.
  const { source, options } = writeStorage();
  return { source, target: dirOf(clean.replace(/^\/+/, "")), options };
}

/** createDirectory, one level at a time — core will not create parents. */
async function _ensureDirectory(source, target, options) {
  const FP = _FP();
  const parts = String(target ?? "").split("/").filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    try { await FP.createDirectory(source, parts.slice(0, i).join("/"), options); }
    catch { /* exists, or the upload below reports why */ }
  }
}

/**
 * Upload a file. `where` is a folder path in the default write storage, or a
 * resolved `{source, target, options}` from `storageForFile`.
 * @returns {Promise<string>}  The path or URL to store and load the file by
 */
export async function uploadFile(where, file) {
  const loc = typeof where === "string" ? { ...writeStorage(), target: where } : where;
  await _ensureDirectory(loc.source, loc.target, loc.options);
  const result = await _FP().upload(loc.source, loc.target, file, loc.options ?? {}, { notify: false });
  if (!result?.path) throw new Error("upload refused");
  return result.path;
}

/**
 * Browse a folder. `where` is a folder path or URL, or a resolved location.
 * A bare path is tried in the local data folder first and then in the Forge
 * library, because a folder picked on The Forge may be in either.
 * @returns {Promise<{files: string[], dirs: string[], loc: object}|null>}
 *   `loc` is where it was found, so a recursive walk can stay in that storage.
 */
export async function browseFolder(where) {
  const FP = _FP();
  let candidates;
  if (typeof where === "object" && where) candidates = [where];
  else {
    const dir = String(where ?? "").replace(/\/+$/, "");
    const loc = storageForFile(`${dir}/x`);
    if (!loc) return null;
    candidates = [loc];
    if (onTheForge() && loc.source === "forgevtt" && !/^https?:/i.test(dir)) {
      candidates.unshift({ source: "data", target: loc.target, options: {} });
    }
  }
  let lastErr = null;
  for (const loc of candidates) {
    try {
      const res = await FP.browse(loc.source, loc.target, loc.options ?? {});
      if (res) return { files: res.files ?? [], dirs: res.dirs ?? [], loc };
    } catch (err) { lastErr = err; }
  }
  if (lastErr) throw lastErr;
  return null;
}

/** Folder entries (`dirs`) come back as keys for some storages and URLs for
 *  others; this keeps a recursive walk in the storage it started in. */
export function childLocation(parent, dir) {
  const loc = storageForFile(`${String(dir).replace(/\/+$/, "")}/x`);
  if (loc && /^https?:/i.test(dir)) return loc;
  return { source: parent.source, target: String(dir).replace(/\/+$/, ""), options: parent.options ?? {} };
}
