export function createDamageFlash({
  color = "rgba(255,0,0,0.4)",
  fadeSpeed = 2.5,
  zIndex = 10000
} = {}) {
  if (typeof document === "undefined") {
    return { trigger() {}, update() {}, destroy() {} };
  }

  const el = document.createElement("div");
  el.className = "ui-damage-flash";
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    background: color,
    mixBlendMode: "multiply",
    opacity: "0",
    transition: "none",
    zIndex: String(zIndex)
  });
  document.body.appendChild(el);

  let opacity = 0;

  return {
    trigger(strength = 1) {
      const clamped = Math.max(0, Math.min(1, strength));
      opacity = Math.max(opacity, clamped);
      el.style.opacity = opacity.toFixed(3);
    },
    update(dt = 0.016) {
      if (opacity <= 0) return;
      opacity = Math.max(0, opacity - fadeSpeed * dt);
      el.style.opacity = opacity.toFixed(3);
    },
    element: el,
    destroy() {
      el.remove();
    }
  };
}
