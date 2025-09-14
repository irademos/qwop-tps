export function createQuickActionsBar({
  onSpawn,
  onBurstStart,
  onBurstStop,
  position = "bottom-right"
} = {}) {
  if (typeof document === "undefined") {
    return { setBurstActive() {}, destroy() {} };
  }

  const styleId = "qact-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.qact-bar{position:fixed;z-index:2000;display:flex;gap:8px;padding:8px;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.3);pointer-events:auto}
.qact-pos-br{right:12px;bottom:92px}
.qact-btn{font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Arial,sans-serif;color:#fff;background:#2b2f3a;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 12px;cursor:pointer;transition:transform .08s ease,background .2s ease,border-color .2s ease;user-select:none}
.qact-btn:hover{background:#374055}
.qact-btn:active{transform:translateY(1px)}
.qact-btn[aria-pressed="true"]{background:#1f6feb;border-color:#2f81f7}
@media (hover:none){.qact-btn{padding:12px 14px;font-size:14px}}
`;
    document.head.appendChild(style);
  }

  const container = document.createElement("div");
  container.className = "qact-bar qact-pos-br";

  const spawnBtn = document.createElement("button");
  spawnBtn.className = "qact-btn";
  spawnBtn.type = "button";
  spawnBtn.textContent = "Box";
  spawnBtn.title = "Spawn a physics box (B)";
  spawnBtn.addEventListener("click", () => {
    if (typeof onSpawn === "function") onSpawn();
  });

  const burstBtn = document.createElement("button");
  burstBtn.className = "qact-btn";
  burstBtn.type = "button";
  burstBtn.textContent = "Burst";
  burstBtn.title = "Toggle burst fire (hold N)";
  burstBtn.setAttribute("aria-pressed", "false");

  let burstActive = false;
  function setBurstActive(next) {
    const active = !!next;
    burstActive = active;
    burstBtn.setAttribute("aria-pressed", active ? "true" : "false");
  }

  burstBtn.addEventListener("click", () => {
    const next = !burstActive;
    setBurstActive(next);
    if (next) {
      if (typeof onBurstStart === "function") onBurstStart();
    } else {
      if (typeof onBurstStop === "function") onBurstStop();
    }
  });

  container.appendChild(spawnBtn);
  container.appendChild(burstBtn);
  document.body.appendChild(container);

  return {
    setBurstActive,
    destroy() {
      container.remove();
    }
  };
}
