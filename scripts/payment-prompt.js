/**
 * sta2e-toolkit | payment-prompt.js
 * Interactive dialog for mixing Momentum and Threat to pay costs.
 */

import { getLcTokens } from "./lcars-theme.js";

const MODULE_DIR = "modules/sta2e-toolkit";

export class PaymentPrompt extends Application {
  constructor(totalCost, options = {}) {
    super(options);
    this.totalCost = totalCost;
    
    // Track what is currently placed in each slot. null = empty
    this.slots = new Array(totalCost).fill(null);
    this.resolvePromise = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "sta2e-payment-prompt",
      template: null, // We build our own HTML in render
      title: "Select Payment Resources",
      width: 400,
      height: "auto",
      resizable: false,
      classes: ["sta2e-payment-prompt"]
    });
  }

  /**
   * Prompts the user and returns a promise.
   * Resolves to { momentumSpent, threatAdded } or null if cancelled.
   */
  static async promptCost(totalCost) {
    return new Promise((resolve) => {
      const prompt = new PaymentPrompt(totalCost);
      prompt.resolvePromise = resolve;
      prompt.render(true);
    });
  }

  async close(options = {}) {
    if (this.resolvePromise) {
      this.resolvePromise(null); // Resolve to null if window is closed without paying
      this.resolvePromise = null;
    }
    return super.close(options);
  }

  getData() {
    return {
      cost: this.totalCost,
    };
  }

  _renderInner(data) {
    const LC = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });

    const html = document.createElement("div");
    html.style.padding = "10px";
    html.style.fontFamily = LC.font;
    html.style.background = LC.bg;
    html.style.color = LC.text;

    // Header
    html.innerHTML = `
      <div style="text-align: center; margin-bottom: 20px;">
        <h3 style="color:${LC.primary}; margin: 0;">Payment Required: ${this.totalCost}</h3>
        <p style="font-size: 0.85em; color:${LC.textDim}; margin: 5px 0 0 0;">Drag Momentum or Threat into the slots.</p>
      </div>
      
      <div style="display:flex; justify-content: space-around; margin-bottom: 30px;">
        <!-- Source Coins -->
        <div style="text-align:center;">
          <div style="font-size: 0.7em; letter-spacing: 1px; color:${LC.textDim}; margin-bottom: 5px;">MOMENTUM</div>
          <img src="${MODULE_DIR}/assets/momentum.svg" class="sta2e-coin-source" data-type="momentum" draggable="true" 
               style="width: 60px; height: 60px; cursor: grab; filter: drop-shadow(0 0 4px ${LC.primary});" />
        </div>
        <div style="text-align:center;">
          <div style="font-size: 0.7em; letter-spacing: 1px; color:${LC.textDim}; margin-bottom: 5px;">THREAT</div>
          <img src="${MODULE_DIR}/assets/threat.svg" class="sta2e-coin-source" data-type="threat" draggable="true" 
               style="width: 60px; height: 60px; cursor: grab; filter: drop-shadow(0 0 4px ${LC.red});" />
        </div>
      </div>

      <div style="text-align:center; margin-bottom: 15px;">
        <div style="font-size: 0.7em; letter-spacing: 1px; color:${LC.textDim}; margin-bottom: 5px;">COST ALLOCATION</div>
        <div class="sta2e-slots-container" style="display:flex; justify-content:center; gap: 10px; flex-wrap:wrap;">
          ${this.slots.map((_, i) => `
            <div class="sta2e-coin-slot" data-index="${i}" 
                 style="width: 60px; height: 60px; border-radius: 50%;
                        background-image: url('data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'512\\' height=\\'512\\' viewBox=\\'0 0 512 512\\'%3E%3Ccircle cx=\\'256\\' cy=\\'256\\' r=\\'240\\' fill=\\'none\\' stroke=\\'%23aaaaaa\\' stroke-width=\\'15\\' stroke-dasharray=\\'120 30\\'/%3E%3C/svg%3E');
                        background-size: cover; display:flex; align-items:center; justify-content:center;
                        cursor: pointer;">
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Action Buttons -->
      <div style="display:flex; gap: 10px; margin-top: 20px;">
        <button class="sta2e-btn-pay" disabled
                style="flex:1; background:${LC.panel}; color:${LC.textDim}; border: 1px solid ${LC.borderDim}; cursor: not-allowed; text-transform:uppercase; font-weight:bold; letter-spacing:1px; padding: 8px;">
          Pay Cost
        </button>
        <button class="sta2e-btn-cancel"
                style="flex:1; background:transparent; color:${LC.textBright}; border: 1px solid ${LC.borderDim}; cursor: pointer; text-transform:uppercase; font-weight:bold; letter-spacing:1px; padding: 8px;">
          Cancel
        </button>
      </div>
    `;

    this._bindInteractions(html, LC);

    return $(html);
  }

  _bindInteractions(html, LC) {
    const slotsContainer = html.querySelector(".sta2e-slots-container");
    const payBtn = html.querySelector(".sta2e-btn-pay");
    const cancelBtn = html.querySelector(".sta2e-btn-cancel");

    // Drag setup from sources
    const sources = html.querySelectorAll(".sta2e-coin-source");
    sources.forEach(src => {
      src.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", e.target.dataset.type);
        e.target.style.opacity = "0.5";
      });
      src.addEventListener("dragend", (e) => {
        e.target.style.opacity = "1";
      });
    });

    // Drop setup for slots
    const slotElements = html.querySelectorAll(".sta2e-coin-slot");
    slotElements.forEach(slot => {
      // Allow dragover
      slot.addEventListener("dragover", (e) => {
        e.preventDefault(); 
        slot.style.filter = "brightness(1.5)";
      });
      slot.addEventListener("dragleave", (e) => {
        slot.style.filter = "none";
      });
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        slot.style.filter = "none";
        const type = e.dataTransfer.getData("text/plain");
        if (type !== "momentum" && type !== "threat") return;

        const idx = parseInt(slot.dataset.index, 10);
        this.slots[idx] = type;
        this._updateSlotVisuals(slotElements, LC);
        this._checkValidity(payBtn, LC);
      });

      // Click to remove
      slot.addEventListener("click", () => {
        const idx = parseInt(slot.dataset.index, 10);
        if (this.slots[idx] !== null) {
          this.slots[idx] = null;
          this._updateSlotVisuals(slotElements, LC);
          this._checkValidity(payBtn, LC);
        }
      });
    });

    payBtn.addEventListener("click", () => {
      const momentumSpent = this.slots.filter(s => s === "momentum").length;
      const threatAdded = this.slots.filter(s => s === "threat").length;
      
      if (this.resolvePromise) {
        this.resolvePromise({ momentumSpent, threatAdded });
        this.resolvePromise = null;
      }
      this.close();
    });

    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  _updateSlotVisuals(slotElements, LC) {
    slotElements.forEach((slot, i) => {
      const type = this.slots[i];
      if (type === "momentum") {
        slot.innerHTML = `<img src="${MODULE_DIR}/assets/momentum.svg" style="width:100%;height:100%; border-radius:50%; filter: drop-shadow(0 0 2px ${LC.primary}); pointer-events:none;" />`;
        slot.style.backgroundImage = "none";
      } else if (type === "threat") {
        slot.innerHTML = `<img src="${MODULE_DIR}/assets/threat.svg" style="width:100%;height:100%; border-radius:50%; filter: drop-shadow(0 0 2px ${LC.red}); pointer-events:none;" />`;
        slot.style.backgroundImage = "none";
      } else {
        slot.innerHTML = "";
        slot.style.backgroundImage = `url('data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'512\\' height=\\'512\\' viewBox=\\'0 0 512 512\\'%3E%3Ccircle cx=\\'256\\' cy=\\'256\\' r=\\'240\\' fill=\\'none\\' stroke=\\'%23aaaaaa\\' stroke-width=\\'15\\' stroke-dasharray=\\'120 30\\'/%3E%3C/svg%3E')`;
      }
    });
  }

  _checkValidity(payBtn, LC) {
    const isFull = this.slots.every(s => s !== null);
    if (isFull) {
      payBtn.disabled = false;
      payBtn.style.background = LC.primary;
      payBtn.style.color = "#000";
      payBtn.style.cursor = "pointer";
    } else {
      payBtn.disabled = true;
      payBtn.style.background = LC.panel;
      payBtn.style.color = LC.textDim;
      payBtn.style.cursor = "not-allowed";
    }
  }
}
