/**
 * VFX broadcast diagnostics.
 *
 * Every receive-side bail in the VFX path used to be a silent `return` — scene
 * mismatch, canvas not ready, no Sequencer, token not on this client's canvas.
 * That made one class of bug report impossible to answer: when a player says
 * they did not see an animation, there was no way to tell "the message never
 * arrived" from "it arrived and was dropped for a reason".
 *
 * This module is the trace. `vfxDrop` records why a message was discarded (to
 * the console only when the GM has turned the client setting on), and
 * `noteVfxReceived` counts what did land, which is what the `vfxPing`
 * self-test in main.js reports back.
 *
 * A LEAF: it imports nothing. The VFX renderers are on the per-frame critical
 * path and several of them (`scene-warp.js` most of all) are deliberately
 * import-free so the weapon-firing path can consult them without a cycle —
 * anything they are allowed to call has to be at least as light.
 */

const MODULE = "sta2e-toolkit";
const DEBUG_SETTING = "vfxDebugLogging";

// ── Debug toggle ─────────────────────────────────────────────────────────────

// Memoised for the same reason `cachedSetting` in starfield-common.js is: the
// drop sites sit inside per-frame renderers, and a settings lookup per dropped
// message per frame is a real cost for a value that changes about never.
// Cleared wholesale on `updateSetting` by `registerVfxDiagnostics()`.
let _debugCache = null;

/** Is VFX drop logging switched on for this client? */
export function vfxDebugEnabled() {
  if (_debugCache !== null) return _debugCache;
  try {
    _debugCache = game.settings.get(MODULE, DEBUG_SETTING) === true;
  } catch {
    // Called before settings register — don't cache that, so the real value is
    // picked up as soon as it exists.
    return false;
  }
  return _debugCache;
}

let _hookId = null;

/** Wire the memo invalidation. Call once from main.js init. */
export function registerVfxDiagnostics() {
  if (_hookId !== null) return;
  _hookId = Hooks.on("updateSetting", () => { _debugCache = null; });
}

// ── Drop tracing ─────────────────────────────────────────────────────────────

/**
 * Record that an inbound VFX message was discarded.
 *
 * `reason` is a short stable slug (`scene-mismatch`, `canvas-not-ready`,
 * `bad-coords`, `token-not-on-canvas`, `sequencer-missing`) so a support
 * conversation can ask for one string rather than a screenshot of a console.
 * Never throws: a diagnostic that can break the thing it is diagnosing is
 * worse than no diagnostic.
 */
export function vfxDrop(action, reason, detail = null) {
  try {
    _drops.set(reason, (_drops.get(reason) ?? 0) + 1);
    if (!vfxDebugEnabled()) return;
    console.debug(`STA2e Toolkit | VFX dropped [${action}] — ${reason}`, detail ?? "");
  } catch { /* diagnostics must never break the caller */ }
}

// ── Counters ─────────────────────────────────────────────────────────────────

const _received = new Map();
const _drops = new Map();

/** Count one inbound VFX message that this client accepted. */
export function noteVfxReceived(action) {
  try {
    _received.set(action, (_received.get(action) ?? 0) + 1);
  } catch { /* as above */ }
}

/**
 * This client's tallies, for the `vfxPong` reply. Plain objects rather than
 * Maps because the payload crosses a socket.
 */
export function vfxCounters() {
  return {
    received: Object.fromEntries(_received),
    dropped: Object.fromEntries(_drops),
  };
}

/** Reset both tallies. Exposed for a clean self-test run. */
export function resetVfxCounters() {
  _received.clear();
  _drops.clear();
}
