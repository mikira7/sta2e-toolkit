/**
 * sta2e-toolkit | webp-convert.js
 *
 * Re-encode PNG / JPEG art as WebP and save the copy beside the original, for
 * the Appearance Manager's "Convert to WebP" keys. Token and portrait art is
 * the bulk of a world's upload folder, and a PNG portrait is routinely several
 * times the size of the same picture as WebP.
 *
 * - **The original is never touched.** Foundry has no API to delete a file, and
 *   the caller only re-points paths it owns; anything else still using the old
 *   file keeps working.
 * - **A copy that is not smaller is not kept.** A heavily compressed JPEG can
 *   grow as WebP; that file is reported as skipped and its path left alone.
 * - Saved beside the source when that folder is writable (local data, a Forge
 *   Assets Library or S3 URL — `file-storage.js` resolves which), otherwise to
 *   `worlds/<world>/sta2e-tokens/`, with the same refused-upload fallback as the
 *   Token Maker.
 */

import { uploadFile, browseFolder, storageForFile } from "./file-storage.js";
import { webpFileNames, isWritableNextTo } from "./token-maker-compose.js";

const QUALITY = 0.92;

/** True for a path this converter will take — PNG or JPEG only. */
export function isConvertible(path) {
  return /\.(png|jpe?g)(?:[?#]|$)/i.test(String(path ?? ""));
}

async function _existing(where) {
  try {
    return ((await browseFolder(where))?.files ?? []).map(f => {
      const name = String(f).split(/[?#]/)[0].split("/").pop();
      try { return decodeURIComponent(name); } catch { return name; }
    });
  } catch { return []; }
}

/** Read the source and encode it — fetched as a blob so the canvas is never tainted. */
async function _encode(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`could not read ${src} (${res.status})`);
  const original = await res.blob();
  const bmp = await createImageBitmap(original);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise(r => c.toBlob(r, "image/webp", QUALITY));
  if (!blob) throw new Error("this browser could not encode WebP");
  return { blob, before: original.size };
}

/**
 * Save a WebP copy of `src`.
 *
 * @param {string} src
 * @returns {Promise<{path: string, before: number, after: number, skipped: string|null}>}
 *   `path` is the WebP copy, or `src` itself when skipped (with the reason).
 */
export async function saveAsWebp(src) {
  if (!isConvertible(src)) return { path: src, before: 0, after: 0, skipped: "not a PNG or JPEG" };
  const { blob, before } = await _encode(src);
  if (blob.size >= before) return { path: src, before, after: blob.size, skipped: "WebP would not be smaller" };

  const fallback = `worlds/${game.world.id}/sta2e-tokens`;
  const loc = storageForFile(src);
  const near = loc && isWritableNextTo(`${loc.target}/x`) ? loc : null;
  let where = near ?? fallback;
  let names = webpFileNames(src, await _existing(where), fallback, { forceFallback: !near });
  let path;
  try {
    path = await uploadFile(where, new File([blob], names.name, { type: "image/webp" }));
  } catch {
    if (names.fellBack) throw new Error("could not save — check file upload permissions");
    // The source's folder refused the write; use the world folder instead.
    where = fallback;
    names = webpFileNames(src, await _existing(fallback), fallback, { forceFallback: true });
    path = await uploadFile(where, new File([blob], names.name, { type: "image/webp" }));
  }
  return { path, before, after: blob.size, skipped: null };
}

/** "1.4 MB", "820 KB" */
export function formatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  return v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB` : `${Math.round(v / 1024)} KB`;
}
