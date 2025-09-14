export function createVersionBadge({
  version = "",
  position = "bottom-right",
  container = (typeof document !== "undefined" ? document.body : null),
} = {}) {
  if (typeof document === "undefined" || !container) {
    return { setVersion() {}, destroy() {} };
  }

  // Inject scoped styles once
  const styleId = "fa-version-badge-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .fa-version-badge {
        position: fixed;
        z-index: 9999;
        pointer-events: none;
        font-family: "Press Start 2P", system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        font-size: 10px;
        line-height: 1;
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
        padding: 4px 6px;
        border-radius: 4px;
        letter-spacing: 0.5px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      }
      .fa-version-badge.pos-br { right: 8px; bottom: 8px; }
      .fa-version-badge.pos-bl { left: 8px; bottom: 8px; }
      .fa-version-badge.pos-tr { right: 8px; top: 8px; }
      .fa-version-badge.pos-tl { left: 8px; top: 8px; }
    `;
    document.head.appendChild(style);
  }

  const posClass = ({
    "bottom-right": "pos-br",
    "bottom-left": "pos-bl",
    "top-right": "pos-tr",
    "top-left": "pos-tl",
  }[position] || "pos-br");

  const el = document.createElement("div");
  el.className = `fa-version-badge ${posClass}`;
  el.textContent = version ? `v ${version}` : "v";

  container.appendChild(el);

  return {
    setVersion(v) {
      el.textContent = v ? `v ${v}` : "v";
    },
    destroy() {
      el.remove();
    }
  };
}
