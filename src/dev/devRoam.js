import * as THREE from 'three';
import {
  loadDraftRoutes, saveDraftRoutes, formatRoutes,
} from '../map/stageRoutes.js';

// Dev tool (Settings → Dev → Free Roam): walk the active map freely with a panel to
//  - copy the current location ({x, y, z, yaw} — for DUEL_LOCATION / GUNS_LOCATION), and
//  - record Showdown stage routes: per stage, the village spot then the waypoints, kept as a
//    draft in localStorage (src/map/stageRoutes.js) and copied as text to paste into
//    STAGE_ROUTES.
// The routes are drawn in the world while roaming (and on demand: setRoutesVisible).
// Game access goes through `ctx` (built in bootstrapGameApp.js):
//   scene, getPlayerPose() → {x, y, z, yaw}, getGroundY(x, z), getMapKey(), onExit()

const LINE_LIFT = 0.25;       // m above the ground
const LINE_SAMPLE_STEP = 2;   // m between ground samples along a route line
const COLOR_CURRENT = 0xffc94a;
const COLOR_OTHER = 0x8ab4ff;
const COLOR_START = 0x4ade80;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    area.remove();
    return ok;
  }
};

const makeLabel = (text, color) => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 40px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(text, 64, 32);
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.2, 0.6, 1);
  sprite.renderOrder = 999;
  return sprite;
};

export function createDevRoam(ctx) {
  let active = false;
  let routesVisible = false;
  let mapKey = null;
  let routes = [];
  let stage = 1;

  // ── DOM ──
  const panel = el('div', 'dev-roam ui-panel hidden');
  const title = el('div', 'dev-roam-title', '🧭 Free Roam (dev)');
  const coords = el('div', 'dev-roam-coords');
  const copyLocBtn = el('button', 'ui-btn ui-btn-secondary', '📋 Copy location');

  const routeTitle = el('div', 'dev-roam-subtitle', 'Showdown stage route');
  const stageRow = el('div', 'dev-roam-row');
  const prevBtn = el('button', 'ui-btn ui-btn-secondary dev-roam-step', '‹');
  const stageLabel = el('div', 'dev-roam-stage');
  const nextBtn = el('button', 'ui-btn ui-btn-secondary dev-roam-step', '›');
  stageRow.append(prevBtn, stageLabel, nextBtn);
  const hint = el('div', 'dev-roam-hint');
  const editRow = el('div', 'dev-roam-row');
  const addBtn = el('button', 'ui-btn', '➕ Add point');
  const undoBtn = el('button', 'ui-btn ui-btn-secondary', '↩ Undo');
  const clearBtn = el('button', 'ui-btn ui-btn-secondary', '🗑 Clear');
  editRow.append(addBtn, undoBtn, clearBtn);
  const copyRow = el('div', 'dev-roam-row');
  const goBtn = el('button', 'ui-btn ui-btn-secondary', '📍 Go to start');
  const copyAllBtn = el('button', 'ui-btn ui-btn-secondary', '📋 Copy all routes');
  copyRow.append(goBtn, copyAllBtn);
  const exitBtn = el('button', 'ui-btn ui-btn-ghost', '⬅ Exit Free Roam');
  const output = el('textarea', 'dev-roam-output hidden');
  output.readOnly = true;
  panel.append(title, coords, copyLocBtn, routeTitle, stageRow, hint, editRow, copyRow, output, exitBtn);
  document.body.append(panel);

  // ── World markers ──
  const markers = new THREE.Group();
  markers.name = 'devStageRoutes';
  const disposeMarkers = () => {
    markers.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
    markers.clear();
  };
  const groundY = (x, z) => {
    const y = ctx.getGroundY(x, z);
    return Number.isFinite(y) ? y : 0;
  };
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6);
  postGeo.translate(0, 1.2, 0);

  const rebuildMarkers = () => {
    disposeMarkers();
    if (!active && !routesVisible) return;
    routes.forEach((route, i) => {
      const pts = route?.points;
      if (!pts?.length) return;
      const current = active && i === stage - 1;
      const color = current ? COLOR_CURRENT : COLOR_OTHER;
      // Line along the ground through the points
      const linePts = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k];
        linePts.push(new THREE.Vector3(a.x, groundY(a.x, a.z) + LINE_LIFT, a.z));
        const b = pts[k + 1];
        if (!b) break;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        for (let d = LINE_SAMPLE_STEP; d < len; d += LINE_SAMPLE_STEP) {
          const x = a.x + (b.x - a.x) * (d / len);
          const z = a.z + (b.z - a.z) * (d / len);
          linePts.push(new THREE.Vector3(x, groundY(x, z) + LINE_LIFT, z));
        }
      }
      if (linePts.length > 1) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(linePts),
          new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: current ? 1 : 0.6 })
        );
        line.renderOrder = 998;
        markers.add(line);
      }
      // A post at every point (green = the village / start), the stage number over the start
      pts.forEach((p, k) => {
        const post = new THREE.Mesh(postGeo, new THREE.MeshBasicMaterial({
          color: k === 0 ? COLOR_START : color,
          transparent: true,
          opacity: current ? 0.95 : 0.55,
        }));
        post.position.set(p.x, groundY(p.x, p.z), p.z);
        markers.add(post);
      });
      const label = makeLabel(`S${i + 1}`, current ? COLOR_CURRENT : COLOR_START);
      label.position.set(pts[0].x, groundY(pts[0].x, pts[0].z) + 4, pts[0].z);
      markers.add(label);
    });
  };

  const currentRoute = () => routes[stage - 1]?.points ?? [];
  const save = () => {
    // Trim trailing empty stages
    while (routes.length && !routes[routes.length - 1]?.points?.length) routes.pop();
    saveDraftRoutes(mapKey, routes);
  };
  const render = () => {
    const pts = currentRoute();
    stageLabel.textContent = `Stage ${stage} · ${pts.length} point${pts.length === 1 ? '' : 's'}`;
    hint.textContent = pts.length === 0
      ? 'Stand where this stage\'s village goes and Add point.'
      : pts.length === 1
        ? 'Village set. Now add the waypoints the player walks through; the last is the stage end.'
        : 'Last point = stage end (the next village goes just past it).';
    undoBtn.disabled = pts.length === 0;
    clearBtn.disabled = pts.length === 0;
    goBtn.disabled = pts.length === 0;
    rebuildMarkers();
  };
  const flash = (button, text) => {
    const prev = button.textContent;
    button.textContent = text;
    setTimeout(() => { button.textContent = prev; }, 1500);
  };

  prevBtn.addEventListener('click', () => { stage = Math.max(1, stage - 1); render(); });
  nextBtn.addEventListener('click', () => { stage += 1; render(); });
  addBtn.addEventListener('click', () => {
    const { x, z } = ctx.getPlayerPose();
    while (routes.length < stage) routes.push(null);
    const pts = routes[stage - 1]?.points ?? [];
    routes[stage - 1] = { points: [...pts, { x, z }] };
    save();
    render();
  });
  undoBtn.addEventListener('click', () => {
    const pts = currentRoute();
    if (!pts.length) return;
    routes[stage - 1] = pts.length > 1 ? { points: pts.slice(0, -1) } : null;
    save();
    render();
  });
  clearBtn.addEventListener('click', () => {
    if (!currentRoute().length) return;
    if (!window.confirm(`Clear stage ${stage}'s route?`)) return;
    routes[stage - 1] = null;
    save();
    render();
  });
  goBtn.addEventListener('click', () => {
    const [start] = currentRoute();
    if (start) ctx.teleport(start.x, start.z);
  });
  copyAllBtn.addEventListener('click', async () => {
    const text = formatRoutes(mapKey, routes);
    const ok = await copyText(text);
    flash(copyAllBtn, ok ? '✅ Copied!' : '❌ Copy failed');
    if (!ok) { output.value = text; output.classList.remove('hidden'); }
  });
  copyLocBtn.addEventListener('click', async () => {
    const text = JSON.stringify(ctx.getPlayerPose());
    const ok = await copyText(text);
    flash(copyLocBtn, ok ? '✅ Copied!' : '❌ Copy failed');
    if (!ok) { output.value = text; output.classList.remove('hidden'); }
  });
  exitBtn.addEventListener('click', () => ctx.onExit());

  const reloadRoutes = () => {
    mapKey = ctx.getMapKey();
    routes = mapKey ? loadDraftRoutes(mapKey) : [];
  };

  return {
    isActive: () => active,
    enter() {
      reloadRoutes();
      active = true;
      output.classList.add('hidden');
      panel.classList.remove('hidden');
      document.body.classList.add('dev-roam-mode');
      if (!markers.parent) ctx.scene.add(markers);
      render();
    },
    exit() {
      if (!active) return;
      active = false;
      panel.classList.add('hidden');
      document.body.classList.remove('dev-roam-mode');
      rebuildMarkers();
    },
    // Draw the draft routes in the world outside Free Roam too (Settings → Dev)
    setRoutesVisible(on) {
      routesVisible = !!on;
      reloadRoutes();
      if (!markers.parent) ctx.scene.add(markers);
      rebuildMarkers();
    },
    // Re-read the draft (e.g. after it was discarded or the map changed)
    refresh() {
      reloadRoutes();
      if (active) render();
      else rebuildMarkers();
    },
    update() {
      if (!active) return;
      const p = ctx.getPlayerPose();
      coords.textContent = `x ${p.x}  y ${p.y}  z ${p.z}  yaw ${p.yaw}`;
    },
  };
}
