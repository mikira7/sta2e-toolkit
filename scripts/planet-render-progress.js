/** A non-blocking, accessible progress display for saved planetary artwork. */
export function createPlanetRenderProgress(title) {
  if (!globalThis.document?.body) return { update() {}, complete() {}, fail() {} };
  let host = document.getElementById("sta2e-planet-render-progress");
  if (!host) {
    host = document.createElement("div"); host.id = "sta2e-planet-render-progress";
    host.style.cssText = "position:fixed;right:24px;bottom:24px;z-index:100000;display:grid;gap:10px;width:min(360px,calc(100vw - 48px));pointer-events:none";
    document.body.append(host);
  }
  const panel = document.createElement("section");
  panel.className = "sta2e-planet-render-progress";
  panel.style.cssText = "background:#101c2a;color:#e4edf6;border:1px solid #6099bd;border-radius:8px;padding:14px;box-shadow:0 4px 24px #0009;font:14px sans-serif";
  const heading = document.createElement("strong"); heading.textContent = title;
  const status = document.createElement("div"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  status.style.cssText = "margin:8px 0;color:#b5cada";
  const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:10px";
  const bar = document.createElement("progress"); bar.max = 100; bar.value = 0; bar.setAttribute("aria-label", title);
  bar.style.cssText = "width:100%;height:14px;accent-color:#6fc6ff";
  const percent = document.createElement("span"); percent.textContent = "0%"; percent.style.minWidth = "36px";
  row.append(bar, percent); panel.append(heading, status, row); host.append(panel);
  let current = 0, closed = false;
  const remove = () => { panel.remove(); if (!host.children.length) host.remove(); };
  const update = (value, detail) => {
    if (closed) return;
    current = Math.max(current, Math.min(99, Number(value) || 0));
    bar.value = current; percent.textContent = `${Math.floor(current)}%`;
    if (detail && status.textContent !== detail) status.textContent = detail;
  };
  update(0, "Preparing artwork…");
  return {
    update,
    complete() {
      if (closed) return; closed = true;
      bar.value = 100; percent.textContent = "100%"; status.textContent = "Artwork saved";
      setTimeout(remove, 900);
    },
    fail() {
      if (closed) return; closed = true;
      status.textContent = "Image generation failed"; panel.style.borderColor = "#dc7878";
      setTimeout(remove, 3500);
    },
  };
}
