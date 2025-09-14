export function createSessionTimer({ position = "bottom-right" } = {}) {
  if (typeof document === "undefined") {
    return { setPaused() {}, destroy() {} };
  }

  const POS_CLASS = {
    "bottom-right": "fa-session-timer--bottom-right",
    "bottom-left": "fa-session-timer--bottom-left",
    "top-right": "fa-session-timer--top-right",
    "top-left": "fa-session-timer--top-left",
  }[position] || "fa-session-timer--bottom-right";

  const STYLE_ID = "fa-session-timer-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .fa-session-timer {
        position: fixed;
        z-index: 10000;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Press Start 2P", sans-serif;
        font-size: 12px;
        line-height: 1;
        color: #e6f3ff;
        background: rgba(0, 0, 0, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 8px 10px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        backdrop-filter: blur(2px);
        user-select: none;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fa-session-timer--bottom-right { bottom: 12px; right: 12px; }
      .fa-session-timer--bottom-left  { bottom: 12px; left: 12px; }
      .fa-session-timer--top-right    { top: 12px; right: 12px; }
      .fa-session-timer--top-left     { top: 12px; left: 12px; }
      .fa-session-timer__dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #2ecc71;
        box-shadow: 0 0 6px rgba(46, 204, 113, 0.9);
      }
      .fa-session-timer--paused .fa-session-timer__dot {
        background: #ff9f43;
        box-shadow: 0 0 6px rgba(255, 159, 67, 0.9);
      }
      .fa-session-timer__label {
        opacity: 0.8;
        margin-right: 4px;
        letter-spacing: 0.02em;
      }
      .fa-session-timer__time {
        font-weight: 600;
        letter-spacing: 0.04em;
      }
    `;
    document.head.appendChild(style);
  }

  const el = document.createElement("div");
  el.className = `fa-session-timer ${POS_CLASS}`;
  el.innerHTML = `
    <span class="fa-session-timer__dot"></span>
    <span class="fa-session-timer__label">Session</span>
    <span class="fa-session-timer__time">00:00</span>
  `;
  document.body.appendChild(el);

  const timeEl = el.querySelector(".fa-session-timer__time");

  let paused = false;
  let start = performance.now();
  let pausedSince = 0;
  let pausedAccum = 0;

  function fmt(ms) {
    const total = Math.floor(ms / 1000);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

  function update() {
    const now = performance.now();
    const effectivePausedAccum = paused ? (pausedAccum + (now - pausedSince)) : pausedAccum;
    const elapsed = Math.max(0, now - start - effectivePausedAccum);
    timeEl.textContent = fmt(elapsed);
    el.classList.toggle("fa-session-timer--paused", paused);
  }

  const interval = setInterval(update, 500);
  update();

  function setPaused(p) {
    if (p === paused) return;
    const now = performance.now();
    if (p) {
      pausedSince = now;
    } else {
      pausedAccum += now - pausedSince;
      pausedSince = 0;
    }
    paused = p;
    update();
  }

  function destroy() {
    clearInterval(interval);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  return { setPaused, destroy };
}
