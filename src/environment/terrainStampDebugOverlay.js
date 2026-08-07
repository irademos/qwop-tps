import * as THREE from 'three';
import { getTerrainStampDebugSample } from './terrainHeight.js';

const DEFAULT_STATE = {
  enabled: false,
  showHeatmap: true,
  sampleRadiusMeters: 10,
  sampleSpacingMeters: 2,
  sampleStepMeters: 0.5
};

export function createTerrainStampDebugOverlay({ scene, getTargetPosition } = {}) {
  const state = { ...DEFAULT_STATE };

  const root = document.createElement('div');
  root.id = 'terrain-stamp-debug-overlay';
  root.style.position = 'fixed';
  root.style.right = '12px';
  root.style.bottom = '12px';
  root.style.padding = '10px 12px';
  root.style.background = 'rgba(0, 0, 0, 0.66)';
  root.style.border = '1px solid rgba(255,255,255,0.25)';
  root.style.borderRadius = '8px';
  root.style.color = '#fff';
  root.style.fontFamily = 'monospace';
  root.style.fontSize = '12px';
  root.style.lineHeight = '1.35';
  root.style.zIndex = '10000';
  root.style.display = 'none';
  root.style.pointerEvents = 'none';
  document.body.appendChild(root);

  const heatmapGeometry = new THREE.BufferGeometry();
  const heatmapMaterial = new THREE.PointsMaterial({
    size: 0.8,
    vertexColors: true,
    opacity: 0.85,
    transparent: true,
    depthWrite: false
  });
  const heatmapPoints = new THREE.Points(heatmapGeometry, heatmapMaterial);
  heatmapPoints.visible = false;
  heatmapPoints.renderOrder = 10;
  scene?.add(heatmapPoints);

  const positions = [];
  const colors = [];
  const tempColor = new THREE.Color();

  const toColor = (intensity) => {
    const t = Math.min(Math.max(intensity, 0), 1);
    return tempColor.setHSL((1 - t) * 0.66, 1, 0.5);
  };

  const buildHeatmap = (center) => {
    positions.length = 0;
    colors.length = 0;
    const radius = Math.max(2, state.sampleRadiusMeters);
    const spacing = Math.max(1, state.sampleSpacingMeters);
    for (let dx = -radius; dx <= radius; dx += spacing) {
      for (let dz = -radius; dz <= radius; dz += spacing) {
        if (Math.hypot(dx, dz) > radius) continue;
        const x = center.x + dx;
        const z = center.z + dz;
        const sample = getTerrainStampDebugSample(x, z, { sampleStepMeters: state.sampleStepMeters });
        if (!sample) continue;
        const influence = sample.stampInfluence?.normalized ?? 0;
        const color = toColor(influence);
        positions.push(x, sample.stampedHeight + 0.08, z);
        colors.push(color.r, color.g, color.b);
      }
    }
    heatmapGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    heatmapGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    heatmapGeometry.computeBoundingSphere();
  };

  const updateText = (position, sample) => {
    if (!sample) {
      root.textContent = 'terrain debug: no sample';
      return;
    }
    const strongest = sample.stampInfluence?.strongest;
    root.textContent = [
      `Terrain stamp debug`,
      `world x,z: ${position.x.toFixed(2)}, ${position.z.toFixed(2)}`,
      `sampled groundY: ${sample.stampedHeight.toFixed(3)}m (base ${sample.baseHeight.toFixed(3)}m)`,
      `slope angle: ${sample.slopeAngleDeg.toFixed(2)}° (grad ${sample.slopeGradient.toFixed(3)})`,
      `influence: ${(sample.stampInfluence?.normalized ?? 0).toFixed(3)} (${sample.stampInfluence?.appliedCount ?? 0} stamps)`,
      strongest
        ? `strongest stamp: #${strongest.stampId} ${strongest.stampType} p${strongest.priority} i=${strongest.influence.toFixed(3)}`
        : 'strongest stamp: none'
    ].join('\n');
  };

  const setEnabled = (enabled) => {
    state.enabled = Boolean(enabled);
    root.style.display = state.enabled ? 'block' : 'none';
    heatmapPoints.visible = state.enabled && state.showHeatmap;
  };

  const update = () => {
    if (!state.enabled) return;
    const position = getTargetPosition?.();
    if (!position) return;
    const sample = getTerrainStampDebugSample(position.x, position.z, { sampleStepMeters: state.sampleStepMeters });
    updateText(position, sample);
    if (state.showHeatmap) {
      buildHeatmap(position);
      heatmapPoints.visible = true;
    } else {
      heatmapPoints.visible = false;
    }
  };

  const dispose = () => {
    root.remove();
    scene?.remove(heatmapPoints);
    heatmapGeometry.dispose();
    heatmapMaterial.dispose();
  };

  return {
    setEnabled,
    setOptions(options = {}) {
      if (typeof options.showHeatmap === 'boolean') state.showHeatmap = options.showHeatmap;
      if (Number.isFinite(options.sampleRadiusMeters)) state.sampleRadiusMeters = Math.max(2, options.sampleRadiusMeters);
      if (Number.isFinite(options.sampleSpacingMeters)) state.sampleSpacingMeters = Math.max(1, options.sampleSpacingMeters);
      if (Number.isFinite(options.sampleStepMeters)) state.sampleStepMeters = Math.max(0.1, options.sampleStepMeters);
      heatmapPoints.visible = state.enabled && state.showHeatmap;
    },
    getState() {
      return { ...state };
    },
    update,
    dispose
  };
}
