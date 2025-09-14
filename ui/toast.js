/**
 * Lightweight toast notification manager.
 * - No side effects on import; DOM is touched only when createToastManager() is called.
 * - Styles are injected once and scoped via class names.
 */
export function createToastManager({
  containerId = "fa-toast-container",
  styleId = "fa-toast-style",
  maxToasts = 4,
  position = "bottom" // "bottom" | "top"
} = {}) {
  if (typeof document === "undefined") {
    return { show() {}, destroy() {} };
  }

  // Inject scoped styles once
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .fa-toast-container {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        ${position === "top" ? "top: 16px;" : "bottom: 16px;"}
        z-index: 2147483000;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
      }
      .fa-toast {
        pointer-events: auto;
        background: rgba(0,0,0,0.78);
        color: #fff;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif;
        font-size: 14px;
        line-height: 1.3;
        padding: 10px 14px;
        border-radius: 10px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.08);
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: min(92vw, 520px);
        backdrop-filter: blur(4px);
        transform: translateY(8px);
        opacity: 0;
        transition: opacity 180ms ease, transform 180ms ease;
      }
      .fa-toast--in {
        transform: translateY(0);
        opacity: 1;
      }
      .fa-toast__msg { white-space: pre-wrap; }
      .fa-toast__close {
        margin-left: 6px;
        background: transparent;
        border: none;
        color: #fff;
        opacity: 0.8;
        cursor: pointer;
        padding: 4px;
        font-size: 16px;
        line-height: 1;
      }
      .fa-toast--info { border-color: #4ea1ff66; }
      .fa-toast--success { border-color: #2ecc7166; }
      .fa-toast--warn { border-color: #f1c40f66; }
      .fa-toast--error { border-color: #e74c3c66; }
    `;
    document.head.appendChild(style);
  }

  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    container.className = "fa-toast-container";
    document.body.appendChild(container);
  }

  const active = new Set();

  function show(message, { duration = 2500, type = "info" } = {}) {
    if (!message) return;

    // Enforce max visible toasts
    if (active.size >= maxToasts) {
      const first = active.values().next().value;
      if (first) close(first);
    }

    const el = document.createElement("div");
    el.className = `fa-toast fa-toast--${type}`;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    const msgEl = document.createElement("div");
    msgEl.className = "fa-toast__msg";
    msgEl.textContent = message;

    const closeBtn = document.createElement("button");
    closeBtn.className = "fa-toast__close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.textContent = "×";

    el.appendChild(msgEl);
    el.appendChild(closeBtn);

    container.appendChild(el);
    active.add(el);

    // Animate in
    requestAnimationFrame(() => {
      el.classList.add("fa-toast--in");
    });

    let hideTimer = null;
    const scheduleHide = () => {
      if (duration > 0) {
        hideTimer = setTimeout(() => close(el), duration);
      }
    };
    scheduleHide();

    // Interactions
    closeBtn.addEventListener("click", () => close(el));
    el.addEventListener("mouseenter", () => {
      if (hideTimer) clearTimeout(hideTimer);
    });
    el.addEventListener("mouseleave", scheduleHide);

    return el;
  }

  function close(el) {
    if (!el || !active.has(el)) return;
    active.delete(el);
    el.classList.remove("fa-toast--in");
    el.addEventListener("transitionend", () => {
      if (el.parentNode === container) container.removeChild(el);
    }, { once: true });
  }

  function destroy() {
    active.forEach(close);
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    active.clear();
  }

  return { show, destroy };
}
