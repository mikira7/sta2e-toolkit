import { getLcTokens } from "./lcars-theme.js";
import { clampHudPos, clampHudElement, onViewportResize } from "./hud-position.js";
import { SHAKE_PRESETS, previewCanvasShake, broadcastCanvasShake, broadcastStopCanvasShake } from "./scene-effects.js";
import { CONSOLE_LOCATIONS_FLAG, getConsoleLocations, saveConsoleLocation, updateConsoleLocation,
  removeConsoleLocation, triggerConsoleEffects, stopConsoleEffects } from "./console-effects.js";
import { pickConsolePosition, cancelConsolePick, showConsoleMarkers, clearConsoleMarkers } from "./console-effects-picker.js";
import { COOLANT_LEAK_FLAG, getCoolantLeak, setCoolantLeakConfig, startCoolantLeak, stopCoolantLeak, clearCoolantLeakSource } from "./coolant-leak.js";

// Each effect gets its own icon tile and controls builder.
const EFFECTS = [
  { id: "shake", label: "Canvas Shake", icon: "fas fa-house-crack", build: "_buildShakeControls" },
  { id: "electric", label: "Electrical", icon: "fas fa-bolt", build: "_buildConsoleControls", kind: "electric" },
  { id: "explosion", label: "Explosion", icon: "fas fa-explosion", build: "_buildConsoleControls", kind: "explosion" },
  { id: "coolant", label: "Coolant Leak", icon: "fas fa-smog", build: "_buildCoolantControls" },
];

/** Floating GM console with an expandable icon tile for each canvas effect. */
export class SceneEffectsPanel {
  constructor() {
    this._el = null;
    this._visible = false;
    this._consoleViews = [];
    this._showMarkers = false;
    this._placing = false;
  }

  toggle() { this._visible ? this.hide() : this.show(); }
  hide() {
    if (this._el) this._el.style.display = "none";
    this._visible = false;
    cancelConsolePick();
    clearConsoleMarkers();
  }
  show() {
    if (!game.user?.isGM) return;
    if (!this._el) this._build();
    this._el.style.display = "flex";
    this._visible = true;
    this._refreshConsoles();
    clampHudElement(this._el);
  }

  _build() {
    const LC = getLcTokens();
    const el = document.createElement("div");
    el.id = "sta2e-scene-effects-panel";
    el.style.cssText = `position:fixed;z-index:9998;display:flex;flex-direction:column;width:320px;
      background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};border-left:4px solid ${LC.primary};
      border-radius:2px;box-shadow:0 4px 20px #000c;font-family:${LC.font};`;
    const posKey = `sta2e-toolkit.sceneEffectsPanelPos-${game.user.id}`;
    let pos;
    try { pos = JSON.parse(localStorage.getItem(posKey)); } catch {}
    el.style.left = `${Number.isFinite(pos?.x) ? pos.x : 220}px`;
    el.style.top = `${Number.isFinite(pos?.y) ? pos.y : 160}px`;

    const header = document.createElement("div");
    header.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:5px 8px;
      background:${LC.primary};color:${LC.bg};cursor:grab;font-size:11px;font-weight:bold;`;
    const title = document.createElement("span");
    title.textContent = "SCENE EFFECTS";
    const close = document.createElement("button");
    close.textContent = "×";
    close.title = "Close Scene Effects";
    close.style.cssText = "width:24px;background:transparent;border:0;color:inherit;cursor:pointer;";
    close.addEventListener("click", () => this.hide());
    header.append(title, close);
    el.append(header);

    const body = document.createElement("div");
    body.style.cssText = `padding:10px;display:flex;flex-direction:column;gap:8px;background:${LC.panel};max-height:70vh;overflow:auto;font-size:12px;`;
    const grid = document.createElement("div");
    grid.setAttribute("aria-label", "Scene effects");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;";
    body.append(grid);
    const tiles = [];
    for (const effect of EFFECTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = `${effect.label} — open controls`;
      button.setAttribute("aria-label", effect.label);
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", `sta2e-scene-effect-${effect.id}`);
      button.dataset.effect = effect.id;
      button.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
        min-height:68px;padding:8px 4px;background:${LC.bg};border:1px solid ${LC.borderDim};
        border-radius:3px;color:${LC.textDim};cursor:pointer;font-family:inherit;line-height:1.2;`;
      const icon = document.createElement("i");
      icon.className = effect.icon;
      icon.setAttribute("aria-hidden", "true");
      icon.style.fontSize = "22px";
      const label = document.createElement("span");
      label.textContent = effect.label;
      label.style.cssText = "font-size:10px;white-space:normal;";
      button.append(icon, label);
      grid.append(button);

      const controls = document.createElement("div");
      controls.id = `sta2e-scene-effect-${effect.id}`;
      controls.setAttribute("role", "region");
      controls.setAttribute("aria-label", `${effect.label} controls`);
      controls.style.cssText = `display:none;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid ${LC.borderDim};`;
      this[effect.build](controls, LC, effect);
      body.append(controls);
      tiles.push({ button, controls });
      button.addEventListener("click", () => {
        if (this._placing) cancelConsolePick();
        const open = button.getAttribute("aria-expanded") !== "true";
        this._activeEffect = open ? effect.id : null;
        for (const tile of tiles) {
          const selected = open && tile.button === button;
          tile.button.setAttribute("aria-expanded", String(selected));
          tile.button.style.borderColor = selected ? LC.primary : LC.borderDim;
          tile.button.style.color = selected ? LC.primary : LC.textDim;
          tile.controls.style.display = selected ? "flex" : "none";
        }
        clampHudElement(el);
        this._refreshConsoles();
      });
    }
    el.append(body);
    document.body.append(el);
    this._el = el;
    Hooks.on("canvasReady", () => this._refreshConsoles());
    Hooks.on("canvasTearDown", () => { cancelConsolePick(); clearConsoleMarkers(); });
    Hooks.on("updateScene", (scene, changes) => {
      const flags = changes.flags?.["sta2e-toolkit"];
      const locationsChanged = [CONSOLE_LOCATIONS_FLAG, COOLANT_LEAK_FLAG].some(key =>
        (flags && (key in flags || `-=${key}` in flags)) || `flags.sta2e-toolkit.${key}` in changes);
      if (scene.id === canvas.scene?.id && locationsChanged) this._refreshConsoles();
    });
    const savePos = p => localStorage.setItem(posKey, JSON.stringify(p));
    onViewportResize(() => this._el, savePos);
    header.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      header.setPointerCapture(event.pointerId);
      const start = { x: event.clientX, y: event.clientY, left: parseInt(el.style.left), top: parseInt(el.style.top) };
      const move = e => {
        const p = clampHudPos(el, start.left + e.clientX - start.x, start.top + e.clientY - start.y);
        el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
      };
      const up = () => {
        header.removeEventListener("pointermove", move);
        header.removeEventListener("pointerup", up);
        header.removeEventListener("pointercancel", up);
        savePos(clampHudElement(el));
      };
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", up);
      header.addEventListener("pointercancel", up);
    });
  }

  _buildShakeControls(body, LC) {
    const heading = document.createElement("strong");
    heading.textContent = "CANVAS SHAKE";
    const hint = document.createElement("div");
    hint.textContent = "Shake Everyone affects everyone viewing your scene. Preview affects only your canvas.";
    hint.style.color = LC.textDim;
    body.append(heading, hint);

    const fields = {};
    const row = (labelText, input) => {
      const label = document.createElement("label");
      label.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
      const text = document.createElement("span");
      text.textContent = labelText;
      input.style.cssText = `width:120px;background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};padding:3px;`;
      label.append(text, input);
      body.append(label);
    };
    const mode = document.createElement("select");
    for (const [value, label] of [["impact", "Bridge impact"], ["earthquake", "Earthquake"]]) {
      const option = document.createElement("option");
      option.value = value; option.textContent = label; mode.append(option);
    }
    fields.mode = mode;
    row("Shake style", mode);
    for (const [key, label, min, max, step] of [
      ["strength", "Strength (px)", 1, 40, 1],
      ["duration", "Duration (sec)", 0.2, 30, 0.1],
      ["frequency", "Frequency (Hz)", 4, 40, 1],
    ]) {
      const input = document.createElement("input");
      input.type = "number"; input.min = min; input.max = max; input.step = step;
      fields[key] = input;
      row(label, input);
    }
    const applyPreset = () => {
      const preset = SHAKE_PRESETS[mode.value];
      for (const [key, value] of Object.entries(preset)) fields[key].value = value;
    };
    mode.addEventListener("change", applyPreset);
    applyPreset();
    const options = () => Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
    this._shakeOptions = options;
    for (const [label, action, color] of [
      ["Preview locally", () => previewCanvasShake(options()), LC.secondary],
      ["Shake Everyone", () => broadcastCanvasShake(options()), LC.primary],
      ["Stop for Everyone", broadcastStopCanvasShake, LC.red ?? LC.primary],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.style.cssText = `padding:6px;background:${LC.bg};border:1px solid ${color};color:${color};cursor:pointer;font-family:inherit;`;
      button.addEventListener("click", () => {
        if (action() === false) ui.notifications.warn("Open a scene canvas to use Scene Effects.");
      });
      body.append(button);
    }
  }

  _refreshConsoles() {
    for (const refresh of this._consoleViews) refresh();
    showConsoleMarkers(this._visible && this._showMarkers && ["electric", "explosion"].includes(this._activeEffect));
  }

  _buildCoolantControls(body, LC) {
    const heading=document.createElement("strong");heading.textContent="WARP CORE COOLANT LEAK";
    const hint=document.createElement("div");
    hint.textContent="Place a source, then Start for Everyone. The cold vapor plume keeps flowing until stopped, including after a reload or returning to this scene.";
    hint.style.color=LC.textDim;
    const status=document.createElement("div"), source=document.createElement("div");
    status.style.cssText=`font-weight:bold;color:${LC.secondary};`;
    source.style.cssText=`font-size:11px;color:${LC.textDim};`;
    body.append(heading,hint,status,source);
    const fields={};
    const viewRow=document.createElement("label"),viewCaption=document.createElement("span"),view=document.createElement("select");
    viewRow.style.cssText="display:flex;justify-content:space-between;align-items:center;gap:8px;";
    viewCaption.textContent="Map view";
    view.style.cssText=`padding:3px;background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};`;
    for(const [value,label]of [["top-down","Top down"],["isometric","Isometric"]]) {
      const option=document.createElement("option");option.value=value;option.textContent=label;view.append(option);
    }
    view.addEventListener("change",async()=>{
      try {await setCoolantLeakConfig({projection:view.value});this._refreshConsoles();}
      catch(error){ui.notifications.error(error.message);}
    });
    fields.projection=view;viewRow.append(viewCaption,view);body.append(viewRow);
    for(const [key,label,value,min,max,step] of [
      ["size","Plume size (scene px)",80,20,400,5],
      ["density","Vapor density",1,.25,2,.05],
      ["speed","Flow speed",1,.2,3,.1],
      ["angle","Direction (degrees)",0,0,360,1],
    ]) {
      const row=document.createElement("label"),caption=document.createElement("span"),input=document.createElement("input");
      row.style.cssText="display:flex;justify-content:space-between;align-items:center;gap:8px;";
      caption.textContent=label;input.type="number";input.value=value;input.min=min;input.max=max;input.step=step;
      input.style.cssText=`width:75px;padding:3px;background:${LC.bg};color:${LC.text};border:1px solid ${LC.border};`;
      input.addEventListener("change",async()=>{
        try { await setCoolantLeakConfig({[key]:input.value});this._refreshConsoles(); }
        catch(error) {ui.notifications.error(error.message);}
      });
      fields[key]=input;row.append(caption,input);body.append(row);
    }
    const directionHint=document.createElement("div");
    directionHint.textContent="0° up · 90° right · 180° down · 270° left";
    directionHint.style.cssText=`font-size:10px;color:${LC.textDim};`;body.append(directionHint);
    const makeButton=(icon,label,action)=>{
      const button=this._consoleButton(icon,label,action,LC),text=document.createElement("span");
      text.textContent=` ${label}`;button.append(text);body.append(button);return button;
    };
    const place=makeButton("fas fa-crosshairs","Place / move leak source",async()=>{
      if(this._placing)return;
      if(!canvas?.ready || !canvas.scene){ui.notifications.warn("Open a scene first.");return;}
      const scene=canvas.scene;this._placing=true;this._refreshConsoles();
      try {
        const point=await pickConsolePosition({label:"coolant leak source"});
        if(point && canvas.scene?.id===scene.id)await setCoolantLeakConfig(point,scene);
      } finally {this._placing=false;this._refreshConsoles();}
    });
    const cancel=makeButton("fas fa-xmark","Cancel placement",cancelConsolePick);
    const start=makeButton("fas fa-play","Start for Everyone",()=>startCoolantLeak());
    const stop=makeButton("fas fa-stop","Stop for Everyone",()=>stopCoolantLeak());
    const clear=makeButton("fas fa-trash","Remove saved source",()=>clearCoolantLeakSource());
    const refresh=()=>{
      const state=getCoolantLeak(),ready=canvas?.ready,placed=Number.isFinite(state.x)&&Number.isFinite(state.y);
      status.textContent=`${canvas?.scene?.name??"No scene"} · ${state.active?"LEAKING":"STOPPED"}`;
      source.textContent=placed?`Source: ${Math.round(state.x)}, ${Math.round(state.y)}`:"No source placed on this scene.";
      for(const [key,input]of Object.entries(fields)){input.value=state[key];input.disabled=!ready;}
      place.disabled=this._placing||!ready;cancel.style.display=this._placing?"":"none";
      start.disabled=!ready||!placed||state.active;stop.disabled=!ready||!state.active;clear.disabled=!ready||!placed;
    };
    this._consoleViews.push(refresh);refresh();
  }

  _consoleButton(iconClass, label, action, LC) {
    const button = document.createElement("button");
    button.type = "button"; button.title = label; button.setAttribute("aria-label", label);
    button.style.cssText = `padding:5px;min-width:28px;background:${LC.bg};border:1px solid ${LC.border};color:${LC.primary};cursor:pointer;font-family:inherit;`;
    const icon = document.createElement("i"); icon.className = iconClass; icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await action(); }
      catch (error) { ui.notifications.error(error.message ?? "Console effect failed."); }
      finally { button.disabled = false; this._refreshConsoles(); }
    });
    return button;
  }

  _buildConsoleControls(body, LC, effect) {
    const heading = document.createElement("strong");
    heading.textContent = effect.kind === "electric" ? "CONSOLE ELECTRICAL BURSTS" : "CONSOLE EXPLOSIONS";
    const hint = document.createElement("div");
    hint.textContent = "Save console positions on this scene, then fire individual consoles or several random ones. Effects play for everyone viewing this scene.";
    hint.style.color = LC.textDim;
    body.append(heading, hint);
    const field = (text, input) => {
      const label = document.createElement("label"), caption = document.createElement("span");
      label.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;";
      caption.textContent = text; label.append(caption, input); body.append(label); return input;
    };
    const number = (value, min, max, step = 1) => {
      const input = document.createElement("input");
      input.type = "number"; input.value = value; input.min = min; input.max = max; input.step = step;
      input.style.cssText = `width:65px;background:${LC.bg};border:1px solid ${LC.border};color:${LC.text};padding:3px;`;
      return input;
    };
    const duration = field("Burst duration (sec)", number(2.5, 0.4, 6, 0.1));
    const count = field("Random consoles", number(2, 1, 16));
    const shake = document.createElement("input"); shake.type = "checkbox"; shake.checked = true;
    field("Include canvas shake", shake);
    const shakeHint = document.createElement("div");
    shakeHint.textContent = "Shake strength and duration use the Canvas Shake settings.";
    shakeHint.style.cssText = `font-size:10px;color:${LC.textDim};`; body.append(shakeHint);
    const mixed = document.createElement("input"); mixed.type = "checkbox";
    field("Mix sparks & explosions for random", mixed);
    const markers = document.createElement("input"); markers.type = "checkbox";
    field("Show saved locations (GM only)", markers);
    markers.addEventListener("change", () => { this._showMarkers = markers.checked; this._refreshConsoles(); });
    const options = () => ({ kind: effect.kind, duration: duration.value, shake: shake.checked,
      shakeOptions: this._shakeOptions?.() ?? SHAKE_PRESETS.impact });

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;gap:6px;";
    const add = this._consoleButton("fas fa-location-dot", "Add console: click on the canvas", async () => {
      if (this._placing) return;
      if (!canvas?.ready || !canvas.scene) { ui.notifications.warn("Open a scene first."); return; }
      const scene = canvas.scene;
      this._placing = true; this._refreshConsoles();
      try {
        showConsoleMarkers(true);
        const point = await pickConsolePosition();
        if (point && canvas.scene?.id === scene.id) await saveConsoleLocation({ ...point, size: (canvas.grid?.size ?? 100) * 0.6 }, scene);
      } finally { this._placing = false; this._refreshConsoles(); }
    }, LC);
    const addLabel = document.createElement("span"); addLabel.textContent = " Add console"; add.append(addLabel);
    const cancel = this._consoleButton("fas fa-xmark", "Cancel canvas placement", cancelConsolePick, LC);
    toolbar.append(add, cancel); body.append(toolbar);

    const sceneName = document.createElement("div"), list = document.createElement("div");
    sceneName.style.cssText = `font-size:11px;color:${LC.secondary};`;
    const sizeHint = document.createElement("div");
    sizeHint.textContent = "Console name · burst size in scene pixels";
    sizeHint.style.cssText = `font-size:10px;color:${LC.textDim};`;
    list.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    body.append(sceneName, sizeHint, list);
    const refresh = () => {
      markers.checked = this._showMarkers;
      add.disabled = this._placing || !canvas?.ready;
      cancel.style.display = this._placing ? "" : "none";
      const scene = canvas?.scene, locations = canvas?.ready ? getConsoleLocations(scene) : [];
      sceneName.textContent = `${scene?.name ?? "No scene"} · ${locations.length} consoles`;
      list.replaceChildren();
      if (!locations.length) {
        const empty = document.createElement("div"); empty.textContent = "No saved consoles. Use Add console to place one.";
        empty.style.color = LC.textDim; list.append(empty);
      }
      locations.forEach((location, index) => {
        const item = document.createElement("div");
        item.style.cssText = `padding:6px;border:1px solid ${LC.borderDim};display:flex;flex-direction:column;gap:5px;`;
        const nameRow = document.createElement("div"), name = document.createElement("input"), size = number(location.size, 10, 600);
        nameRow.style.cssText = "display:flex;align-items:center;gap:5px;";
        const indexLabel = document.createElement("span"); indexLabel.textContent = `${index + 1}.`;
        name.type = "text"; name.value = location.label; name.maxLength = 60;
        name.setAttribute("aria-label", `Console ${index + 1} name`);
        name.style.cssText = `min-width:0;flex:1;background:${LC.bg};color:${LC.text};border:1px solid ${LC.borderDim};padding:3px;`;
        size.title = "Burst size in scene pixels"; size.setAttribute("aria-label", `${location.label} burst size in scene pixels`);
        const saveField = async patch => {
          try { await updateConsoleLocation(location.id, patch, scene); this._refreshConsoles(); }
          catch (error) { ui.notifications.error(error.message); }
        };
        name.addEventListener("change", () => saveField({ label: name.value }));
        size.addEventListener("change", () => saveField({ size: size.value }));
        nameRow.append(indexLabel, name, size);
        const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:5px;align-items:center;";
        const currentScene = () => canvas?.ready && canvas.scene?.id === scene.id;
        actions.append(
          this._consoleButton(effect.icon, `Play ${effect.label} at ${location.label} for everyone`, () => {
            if (currentScene()) triggerConsoleEffects({ ...options(), ids: [location.id] });
          }, LC),
          this._consoleButton("fas fa-eye", `Preview ${location.label} locally`, () => {
            if (currentScene()) triggerConsoleEffects({ ...options(), ids: [location.id], preview: true });
          }, LC),
          this._consoleButton("fas fa-crosshairs", `Move ${location.label}: click on the canvas`, async () => {
            if (!currentScene() || this._placing) return;
            this._placing = true; this._refreshConsoles();
            try {
              showConsoleMarkers(true);
              const point = await pickConsolePosition();
              if (point && currentScene()) await updateConsoleLocation(location.id, point, scene);
            } finally { this._placing = false; this._refreshConsoles(); }
          }, LC),
          this._consoleButton("fas fa-trash", `Remove saved location ${location.label}`, async () => {
            await removeConsoleLocation(location.id, scene); this._refreshConsoles();
          }, LC),
        );
        const coordinates = document.createElement("span");
        coordinates.textContent = `${Math.round(location.x)}, ${Math.round(location.y)}`;
        coordinates.style.cssText = `margin-left:auto;font-size:10px;color:${LC.textDim};`; actions.append(coordinates);
        item.append(nameRow, actions); list.append(item);
      });
    };
    this._consoleViews.push(refresh); refresh();
    for (const [icon, label, action] of [
      ["fas fa-dice", "Fire random consoles", () => triggerConsoleEffects({ ...options(), count: count.value, kind: mixed.checked ? "mixed" : effect.kind })],
      ["fas fa-eye", "Preview random locally", () => triggerConsoleEffects({ ...options(), count: count.value, kind: mixed.checked ? "mixed" : effect.kind, preview: true })],
      ["fas fa-stop", "Stop effects & shake for everyone", stopConsoleEffects],
    ]) {
      const button = this._consoleButton(icon, label, action, LC);
      const text = document.createElement("span"); text.textContent = ` ${label}`; button.append(text); body.append(button);
    }
  }
}
