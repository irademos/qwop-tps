export function createAutoPauseManager({ onPauseChange } = {}) {
  if (typeof document === "undefined") {
    return { setPaused() {}, destroy() {}, isPaused() { return false; } };
  }

  let paused = !!document.hidden;

  // Inject scoped styles once
  const STYLE_ID = "apm-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .apm-badge {
        position: fixed;
        bottom: 12px;
        right: 12px;
        background: rgba(0,0,0,0.6);
        color: #fff;
        padding: 6px 10px;
        border-radius: 6px;
        font: 600 12px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,Cantarell,"Noto Sans",sans-serif;
        z-index: 2147483647;
        backdrop-filter: blur(4px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        pointer-events: none;
        letter-spacing: 0.3px;
      }
      .apm-hidden { display: none; }
    `;
    document.head.appendChild(style);
  }

  // Create small badge to indicate paused state
  const badge = document.createElement("div");
  badge.className = "apm-badge apm-hidden";
  badge.textContent = "⏸ Paused";
  document.body.appendChild(badge);

  function updateBadge() {
    if (paused) {
      badge.classList.remove("apm-hidden");
    } else {
      badge.classList.add("apm-hidden");
    }
  }

  function emit() {
    if (typeof onPauseChange === "function") onPauseChange(paused);
  }

  function setPaused(next) {
    const np = !!next;
    if (np === paused) return;
    paused = np;
    updateBadge();
    emit();
  }

  // Event handlers
  const onVisibility = () => setPaused(document.hidden);
  const onBlur = () => { if (!document.hidden) setPaused(true); };
  const onFocus = () => setPaused(false);

  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);

  // Initialize from current state
  updateBadge();
  if (paused) emit();

  return {
    setPaused,
    isPaused: () => paused,
    destroy() {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
    }
  };
}
