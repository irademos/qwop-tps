/**
 * Creates a "Copy Position" button inside the Settings panel.
 * No side effects on import; call createShareLocationButton(...) to add it.
 */
export function createShareLocationButton({ playerModel, camera } = {}) {
  if (typeof document === "undefined") {
    return { destroy() {} };
  }
  const panel = document.getElementById("settings-panel");
  if (!panel) {
    return { destroy() {} };
  }

  // Scoped styles
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    .sharepos-button {
      margin-top: 8px;
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid #2b6cb0;
      background: linear-gradient(180deg, #319795, #2c7a7b);
      color: #fff;
      font-family: inherit;
      font-size: 14px;
      cursor: pointer;
      transition: transform 0.06s ease, filter 0.2s ease, opacity 0.2s ease;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .sharepos-button:hover { filter: brightness(1.05); }
    .sharepos-button:active { transform: translateY(1px) scale(0.99); }
    .sharepos-button[disabled] { opacity: 0.7; cursor: default; }
  `;
  document.head.appendChild(styleEl);

  const btn = document.createElement("button");
  btn.className = "sharepos-button";
  btn.type = "button";
  btn.textContent = "Copy Position";

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  btn.addEventListener("click", async () => {
    const p = playerModel?.position;
    if (!p) return;
    const text = `x:${p.x.toFixed(2)} y:${p.y.toFixed(2)} z:${p.z.toFixed(2)}`;
    const original = btn.textContent;
    btn.disabled = true;
    const ok = await copyText(text);
    btn.textContent = ok ? "Copied!" : "Copy failed";
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1200);
  });

  panel.appendChild(btn);

  return {
    destroy() {
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    }
  };
}
