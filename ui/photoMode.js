/**
 * Photo Mode UI
 * - Adds a small 📷 button and H keyboard shortcut to hide HUD elements for clean screenshots.
 * - No side effects on import; call createPhotoMode() once after the app UI exists.
 */
export function createPhotoMode({ bindKey = "KeyH" } = {}) {
  if (typeof document === "undefined") {
    return { destroy() {}, setHidden() {} };
  }

  // Inject scoped styles
  const style = document.createElement("style");
  style.setAttribute("data-pm-style", "true");
  style.textContent = `
    .pm-toggle {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 10010;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.35);
      backdrop-filter: blur(4px);
      user-select: none;
      -webkit-user-select: none;
    }
    .pm-toggle:hover { background: rgba(0, 0, 0, 0.75); }
    .pm-toggle.pm-active { background: rgba(0, 128, 255, 0.85); }

    /* Hide common HUD/UI while in photo mode; scoped via .pm-hidden on <body> */
    .pm-hidden #action-buttons,
    .pm-hidden #health-bar,
    .pm-hidden #settings-button,
    .pm-hidden #settings-overlay,
    .pm-hidden .crosshair,
    .pm-hidden #game-over-overlay,
    .pm-hidden #console-log,
    .pm-hidden #toggle-console,
    .pm-hidden #ping-display,
    .pm-hidden #connected-players-list,
    .pm-hidden #connection-errors-list,
    .pm-hidden #version-badge {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  // Create toggle button
  const btn = document.createElement("button");
  btn.className = "pm-toggle";
  btn.title = "Photo Mode (H)";
  btn.textContent = "📷";
  document.body.appendChild(btn);

  const isTextInput = () => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      el.isContentEditable === true
    );
  };

  function setHidden(nextHidden) {
    document.body.classList.toggle("pm-hidden", !!nextHidden);
    btn.classList.toggle("pm-active", !!nextHidden);
  }

  function toggle() {
    const willHide = !document.body.classList.contains("pm-hidden");
    setHidden(willHide);
  }

  const onKeyDown = (e) => {
    if (e.code !== bindKey) return;
    if (isTextInput()) return;
    e.preventDefault();
    toggle();
  };

  btn.addEventListener("click", toggle);
  window.addEventListener("keydown", onKeyDown);

  return {
    setHidden,
    destroy() {
      btn.removeEventListener("click", toggle);
      window.removeEventListener("keydown", onKeyDown);
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      if (style.parentNode) style.parentNode.removeChild(style);
      document.body.classList.remove("pm-hidden");
    }
  };
}
