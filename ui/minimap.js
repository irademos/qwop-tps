export function createMinimap({ size = 160, range = 60, container = (typeof document !== "undefined" ? document.body : null) } = {}) {
  if (typeof document === "undefined" || !container) {
    return { update() {}, destroy() {} };
  }

  // Inject scoped styles once
  const styleId = "fa-minimap-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .fa-minimap {
        position: fixed;
        top: 10px;
        right: 10px;
        width: ${size}px;
        height: ${size}px;
        background: rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        pointer-events: none;
        z-index: 1000;
        overflow: hidden;
      }
      .fa-minimap__canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `;
    document.head.appendChild(style);
  }

  const wrap = document.createElement("div");
  wrap.className = "fa-minimap";
  const canvas = document.createElement("canvas");
  canvas.className = "fa-minimap__canvas";
  const ctx = canvas.getContext("2d");

  // Handle HiDPI for crisp lines
  function setupCanvas() {
    const dpr = Math.max(1, Math.min(2, (window.devicePixelRatio || 1)));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupCanvas();
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  const half = size / 2;
  const gridStep = 10; // mini grid spacing in world units

  function drawGrid(scale) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    // Vertical lines
    for (let i = -range; i <= range; i += gridStep) {
      const x = half + i * scale;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    // Horizontal lines
    for (let j = -range; j <= range; j += gridStep) {
      const y = half + j * scale;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBorder() {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);
    ctx.restore();
  }

  function drawNorth() {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "bold 10px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", half, 12);
    ctx.restore();
  }

  function drawDot(x, y, color = "#4ea1ff", r = 3) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer(x, y, headingDeg = 0) {
    const angle = (-headingDeg * Math.PI) / 180; // canvas Y-down
    const sizeTri = 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "#2ecc71";
    ctx.beginPath();
    ctx.moveTo(0, -sizeTri);
    ctx.lineTo(sizeTri * 0.7, sizeTri);
    ctx.lineTo(-sizeTri * 0.7, sizeTri);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function worldToMini(wx, wz, px, pz, scale) {
    const x = half + (wx - px) * scale;
    const y = half + (wz - pz) * scale; // +Z downward for canvas
    return [x, y];
  }

  function update({ playerModel, otherPlayers = {}, monster = null, headingDeg = 0 } = {}) {
    if (!playerModel?.position) return;

    ctx.clearRect(0, 0, size, size);

    // Background
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    const px = playerModel.position.x;
    const pz = playerModel.position.z;
    const scale = half / range;

    drawGrid(scale);
    drawBorder();
    drawNorth();

    // Draw other players
    for (const p of Object.values(otherPlayers)) {
      const { model } = p || {};
      if (!model?.position) continue;
      const [mx, my] = worldToMini(model.position.x, model.position.z, px, pz, scale);
      if (mx < -10 || mx > size + 10 || my < -10 || my > size + 10) continue;
      drawDot(mx, my, "#4ea1ff", 3);
    }

    // Draw monster
    if (monster?.position) {
      const [mx, my] = worldToMini(monster.position.x, monster.position.z, px, pz, scale);
      if (mx >= -10 && mx <= size + 10 && my >= -10 && my <= size + 10) {
        drawDot(mx, my, "#ff5c5c", 4);
      }
    }

    // Draw player last
    drawPlayer(half, half, headingDeg);
  }

  function destroy() {
    if (wrap?.parentNode) wrap.parentNode.removeChild(wrap);
    window.removeEventListener("resize", onResize);
  }

  // Keep crisp if DPR changes
  const onResize = () => setupCanvas();
  window.addEventListener("resize", onResize);

  return { update, destroy };
}
