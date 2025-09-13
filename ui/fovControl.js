import { getCookie, setCookie } from "../utils.js";

export function createFovControl({
  camera,
  container = (typeof document !== "undefined" ? document.getElementById("settings-panel") : null),
  min = 50,
  max = 110,
  step = 1
} = {}) {
  if (typeof document === "undefined" || !camera || !container) {
    return { destroy() {} };
  }

  // Inject scoped styles once
  const styleId = "fa-fov-control-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .fa-fov-control{display:flex;align-items:center;gap:8px;margin-top:12px}
      .fa-fov-control__label{font-size:12px;opacity:.9;min-width:48px}
      .fa-fov-control__slider{flex:1}
      .fa-fov-control__value{font-weight:bold;min-width:3ch;text-align:right}
    `;
    document.head.appendChild(style);
  }

  // UI elements
  const wrap = document.createElement("div");
  wrap.className = "fa-fov-control";

  const label = document.createElement("label");
  label.className = "fa-fov-control__label";
  label.textContent = "FOV";

  const valueEl = document.createElement("span");
  valueEl.className = "fa-fov-control__value";

  const input = document.createElement("input");
  input.type = "range";
  input.className = "fa-fov-control__slider";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);

  // Load saved value or use current camera.fov
  const saved = Number(getCookie("cameraFov"));
  const initial = Number.isFinite(saved) && saved >= min && saved <= max ? saved : camera.fov || 75;
  input.value = String(initial);
  valueEl.textContent = String(Math.round(initial));

  // Apply immediately in case it differs
  if (camera.fov !== initial) {
    camera.fov = initial;
    camera.updateProjectionMatrix();
  }

  input.addEventListener("input", () => {
    const v = Number(input.value);
    valueEl.textContent = String(Math.round(v));
    camera.fov = v;
    camera.updateProjectionMatrix();
    setCookie("cameraFov", v);
  });

  wrap.appendChild(label);
  wrap.appendChild(input);
  wrap.appendChild(valueEl);
  container.appendChild(wrap);

  return {
    destroy() {
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }
  };
}
