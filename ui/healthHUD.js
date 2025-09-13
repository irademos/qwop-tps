export function createHealthHUD() {
  if (typeof document === "undefined") {
    return { update() {}, destroy() {} };
  }

  const bar = document.getElementById("health-bar");
  if (!bar) return { update() {}, destroy() {} };

  // Inject scoped styles once
  const styleId = "fa-health-hud-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.fa-health-label{
  position:absolute;
  left:50%;
  top:50%;
  transform:translate(-50%,-50%);
  pointer-events:none;
  color:#fff;
  font-family:'Press Start 2P', system-ui, monospace;
  font-size:12px;
  letter-spacing:0.5px;
  text-shadow:0 1px 0 #000, 0 0 6px rgba(255,0,0,0);
  user-select:none;
}
.fa-health-label.fa-health-low{
  animation:fa-health-pulse 1s infinite;
}
@keyframes fa-health-pulse{
  0%{ text-shadow:0 0 4px rgba(255,0,0,0.3); transform:translate(-50%,-50%) scale(1); }
  50%{ text-shadow:0 0 10px rgba(255,0,0,0.9); transform:translate(-50%,-50%) scale(1.06); }
  100%{ text-shadow:0 0 4px rgba(255,0,0,0.3); transform:translate(-50%,-50%) scale(1); }
}`;
    document.head.appendChild(style);
  }

  // Ensure label container positioning
  if (!bar.style.position) {
    bar.style.position = "relative";
  }

  const label = document.createElement("div");
  label.className = "fa-health-label";
  label.textContent = "100%";
  bar.appendChild(label);

  function update(health) {
    const val = Math.max(0, Math.min(100, Math.round(health ?? 0)));
    label.textContent = `${val}%`;
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(val));
    if (val <= 30) {
      label.classList.add("fa-health-low");
    } else {
      label.classList.remove("fa-health-low");
    }
  }

  function destroy() {
    if (label.parentNode) label.parentNode.removeChild(label);
  }

  return { update, destroy };
}
