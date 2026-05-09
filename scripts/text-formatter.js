/**
 * sta2e-toolkit | text-formatter.js
 * Small utility for repairing hard-wrapped PDF/book text.
 */

function localize(key) {
  return game.i18n.localize(`STA2E.TextFormatter.${key}`);
}

/**
 * Collapse hard-wrapped lines within each paragraph while preserving blank-line
 * paragraph breaks.
 *
 * @param {string} text
 * @param {{ joiner?: string }} options
 * @returns {string}
 */
export function cleanHardWrappedParagraphs(text, { joiner = "  " } = {}) {
  if (typeof text !== "string") return "";

  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map(paragraph => paragraph
      .split("\n")
      .map(line => line.trim().replace(/[ \t]+/g, " "))
      .filter(Boolean)
      .join(joiner)
      .trim())
    .filter(Boolean)
    .join("\n\n");
}

function buildContent() {
  const inputLabel = localize("InputLabel");
  const outputLabel = localize("OutputLabel");
  const doubleSpaceLabel = localize("DoubleSpaceLabel");
  const clearLabel = localize("ClearButton");
  const copyLabel = localize("CopyButton");

  return `
    <form class="sta2e-text-formatter" style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:260px;">
        <label style="display:flex;flex-direction:column;gap:4px;min-width:0;">
          <span style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;">${inputLabel}</span>
          <textarea name="source" spellcheck="true" aria-label="${inputLabel}" style="height:250px;resize:vertical;"></textarea>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;min-width:0;">
          <span style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;">${outputLabel}</span>
          <textarea name="output" readonly aria-label="${outputLabel}" style="height:250px;resize:vertical;"></textarea>
        </label>
      </div>
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
        <label style="display:flex;align-items:center;gap:6px;margin:0;">
          <input type="checkbox" name="doubleSpace" checked />
          <span>${doubleSpaceLabel}</span>
        </label>
        <div style="display:flex;gap:6px;">
          <button type="button" class="sta2e-text-formatter-clear">
            <i class="fas fa-eraser"></i> ${clearLabel}
          </button>
          <button type="button" class="sta2e-text-formatter-copy">
            <i class="fas fa-copy"></i> ${copyLabel}
          </button>
        </div>
      </div>
    </form>
  `;
}

async function copyText(text, output) {
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_err) {
    output?.focus();
    output?.select();
    try { return document.execCommand("copy"); }
    catch { return false; }
  }
}

function wireFormatterDialog(dlg) {
  const el = dlg.element;
  const source = el.querySelector("[name=source]");
  const output = el.querySelector("[name=output]");
  const doubleSpace = el.querySelector("[name=doubleSpace]");
  const clearButton = el.querySelector(".sta2e-text-formatter-clear");
  const copyButton = el.querySelector(".sta2e-text-formatter-copy");

  const update = () => {
    const joiner = doubleSpace?.checked ? "  " : " ";
    output.value = cleanHardWrappedParagraphs(source?.value ?? "", { joiner });
  };

  source?.addEventListener("input", update);
  doubleSpace?.addEventListener("change", update);
  clearButton?.addEventListener("click", () => {
    if (source) source.value = "";
    if (output) output.value = "";
    source?.focus();
  });
  copyButton?.addEventListener("click", async () => {
    update();
    const copied = await copyText(output?.value ?? "", output);
    const message = copied ? localize("Copied") : localize("CopyFailed");
    ui.notifications?.[copied ? "info" : "warn"]?.(message);
  });

  requestAnimationFrame(() => source?.focus());
  update();
}

export async function openTextFormatter() {
  return foundry.applications.api.DialogV2.wait({
    window: { title: localize("Title"), resizable: true },
    position: { width: 820, height: "auto" },
    content: buildContent(),
    rejectClose: false,
    buttons: [
      {
        action: "close",
        label: localize("CloseButton"),
        icon: "fas fa-times",
        default: true,
      },
    ],
    render: (_event, dlg) => wireFormatterDialog(dlg),
  });
}
