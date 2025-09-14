export function createRendererInfoBadge({ renderer, updateInterval = 1000 } = {}) {
  if (typeof document === "undefined" || !renderer) {
    return { element: null, destroy() {}, setVisible() {} };
  }

  // Scoped styles
  const style = document.createElement("style");
  style.textContent = `
.rf-renderer-badge{position:fixed;right:10px;bottom:10px;z-index:9999;background:rgba(0,0,0,.6);color:#eee;font:12px/1.4 monospace;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px 10px;pointer-events:auto;user-select:none;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.rf-renderer-badge:hover{background:rgba(0,0,0,.75);color:#fff}
.rf-renderer-badge .rf-title{font-weight:bold;color:#9cd1ff;margin-bottom:4px}
.rf-renderer-badge .rf-row{display:flex;gap:6px;white-space:nowrap}
.rf-renderer-badge .rf-k{opacity:.8}
.rf-renderer-badge .rf-v{opacity:1}
`;
  document.head.appendChild(style);

  // UI
  const el = document.createElement("div");
  el.className = "rf-renderer-badge";

  const title = document.createElement("div");
  title.className = "rf-title";
  title.textContent = "Renderer";

  const row1 = document.createElement("div"); row1.className = "rf-row";
  const row2 = document.createElement("div"); row2.className = "rf-row";
  const row3 = document.createElement("div"); row3.className = "rf-row";

  const k1 = document.createElement("span"); k1.className = "rf-k"; k1.textContent = "GPU:";
  const v1 = document.createElement("span"); v1.className = "rf-v";
  const k2 = document.createElement("span"); k2.className = "rf-k"; k2.textContent = "Draw calls:";
  const v2 = document.createElement("span"); v2.className = "rf-v";
  const k3 = document.createElement("span"); k3.className = "rf-k"; k3.textContent = "Triangles:";
  const v3 = document.createElement("span"); v3.className = "rf-v";

  row1.append(k1, v1);
  row2.append(k2, v2);
  row3.append(k3, v3);

  el.append(title, row1, row2, row3);
  document.body.appendChild(el);

  let interval = null;

  function updateOnce() {
    try {
      const gl = renderer.getContext();
      let gpu = "";
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      }
      v1.textContent = String(gpu || "Unknown");

      const info = renderer.info;
      v2.textContent = String(info.render.calls);
      v3.textContent = String(info.render.triangles);
    } catch (_) {
      // ignore errors silently to avoid UI spam
    }
  }

  updateOnce();
  interval = setInterval(updateOnce, updateInterval);

  function setVisible(show) {
    el.style.display = show ? "block" : "none";
  }

  function destroy() {
    if (interval) clearInterval(interval);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (style && style.parentNode) style.parentNode.removeChild(style);
  }

  return { element: el, destroy, setVisible };
}
