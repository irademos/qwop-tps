import { getCookie, setCookie } from "../utils.js";

export function createResolutionToggle({ renderer, container = (typeof document !== "undefined" ? document.getElementById("settings-panel") : null) } = {}) {
  if (typeof document === "undefined" || !renderer || !container) {
    return { destroy() {} };
  }

  // Inject scoped styles once
  const styleId = "fa-res-toggle-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .fa-res-toggle { margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.25); border-radius: 6px; }
      .fa-res-toggle__label { color: #fff; font-family: system-ui, sans-serif; font-size: 14px; display: flex; align-items: center; gap: 8px; }
      .fa-res-toggle__hint { display:block; color:#ccc; font-size:12px; margin-top:4px; }
    `;
    document.head.appendChild(style);
  }

  const wrapper = document.createElement("div");
  wrapper.className = "fa-res-toggle";

  const label = document.createElement("label");
  label.className = "fa-res-toggle__label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "fa-perf-pr";

  const span = document.createElement("span");
  span.textContent = "Performance mode (1x resolution)";

  const hint = document.createElement("small");
  hint.className = "fa-res-toggle__hint";
  hint.textContent = "Reduces GPU load on high-DPI screens. Toggle takes effect immediately.";

  label.appendChild(checkbox);
  label.appendChild(span);
  wrapper.appendChild(label);
  wrapper.appendChild(hint);
  container.appendChild(wrapper);

  const applyPixelRatio = (perf) => {
    const pr = perf ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  // Initialize from cookie
  const perfMode = getCookie("renderPerfMode") === "true";
  checkbox.checked = perfMode;
  applyPixelRatio(perfMode);

  checkbox.addEventListener("change", () => {
    const perf = checkbox.checked;
    setCookie("renderPerfMode", String(perf));
    applyPixelRatio(perf);
  });

  return {
    destroy() {
      wrapper.remove();
    }
  };
}
