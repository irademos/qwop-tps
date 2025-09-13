export function createPauseUI({ onToggle } = {}) {
  if (typeof document === "undefined") {
    return { button: null, overlay: null, setPaused() {} };
  }

  // Inject scoped styles once
  const styleId = "fai-pause-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .fai-pause-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }
      .fai-pause-overlay.hidden { display: none; }
      .fai-pause-overlay__text {
        color: #fff;
        font-family: 'Press Start 2P', monospace;
        font-size: 32px;
        letter-spacing: 2px;
        text-shadow: 0 2px 6px rgba(0,0,0,0.8);
        text-align: center;
        user-select: none;
      }
      .fai-pause-overlay__sub {
        margin-top: 12px;
        font-size: 12px;
        opacity: 0.85;
      }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement("div");
  overlay.className = "fai-pause-overlay hidden";
  const textWrap = document.createElement("div");
  const title = document.createElement("div");
  const sub = document.createElement("div");
  title.className = "fai-pause-overlay__text";
  sub.className = "fai-pause-overlay__text fai-pause-overlay__sub";
  title.textContent = "PAUSED";
  sub.textContent = "Click Resume to continue";
  textWrap.appendChild(title);
  textWrap.appendChild(sub);
  overlay.appendChild(textWrap);
  document.body.appendChild(overlay);

  const container = document.getElementById("action-buttons") || document.body;
  let button = document.getElementById("pause-button");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.id = "pause-button";
    button.className = "action-button pause-button";
    button.textContent = "Pause";
    container.appendChild(button);
  }

  let paused = false;
  function setPaused(p) {
    paused = !!p;
    button.textContent = paused ? "Resume" : "Pause";
    overlay.classList.toggle("hidden", !paused);
    if (typeof onToggle === "function") onToggle(paused);
  }

  button.addEventListener("click", () => setPaused(!paused));

  return { button, overlay, setPaused };
}
