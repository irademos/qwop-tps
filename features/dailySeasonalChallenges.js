/**
 * features/dailySeasonalChallenges.js
 *
 * Exported: initDailySeasonalChallenges(THREE, { scene, playerModel, toasts, audioManager })
 *
 * Creates a small set of visible "daily challenge" markers near the player on init.
 * Markers bob/rotate and will trigger a single toast + optional SFX the first time
 * the player approaches each marker per-day. No side-effects at import time.
 */

export function initDailySeasonalChallenges(THREE, { scene, playerModel, toasts, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const ROOT_NAME = 'daily-seasonal-challenges';
  const group = new THREE.Group();
  group.name = ROOT_NAME;

  const markers = [];
  let active = false;

  // Determine "season" from month for simple thematic variation
  function getSeason() {
    const m = new Date().getMonth() + 1; // 1-12
    if (m === 12 || m <= 2) return 'winter';
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    return 'autumn';
  }

  function dayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  // persistent completed set per day (localStorage)
  const LS_KEY = 'daily_challenges_completed';
  function loadCompleted() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed;
    } catch (e) { return {}; }
  }
  function saveCompleted(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (e) {}
  }

  let completedMap = loadCompleted();

  // Create a simple sphere marker with a label texture
  function makeMarker(opts = {}) {
    const color = opts.color || 0x66ccff;
    const radius = opts.radius || 0.18;
    const geom = new THREE.SphereGeometry(radius, 12, 10);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.4,
      roughness: 0.5,
      metalness: 0.0,
      transparent: true,
      opacity: 0.95
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    mesh.userData = {
      baseY: 0,
      bobPhase: Math.random() * Math.PI * 2,
      label: opts.label || '',
      id: opts.id || `marker-${Math.random().toString(36).slice(2,8)}`
    };

    // small floating ring for visibility
    const ringGeom = new THREE.RingGeometry(radius + 0.02, radius + 0.04, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -radius - 0.01;
    mesh.add(ring);

    return mesh;
  }

  function generateMarkers() {
    // 3 markers arranged around player's initial position
    const seedPos = playerModel.position.clone();
    const season = getSeason();
    const labelsBySeason = {
      spring: ['Find Blossom','Collect Seeds','Help the Squirrel'],
      summer: ['Find Shells','Water the Plant','Catch a Breeze'],
      autumn: ['Collect Leaves','Rake Pile','Share a Scare'],
      winter: ['Light Lantern','Collect Snow','Warm the Fire']
    };
    const colorsBySeason = {
      spring: 0x88ff88,
      summer: 0xffdd66,
      autumn: 0xffaa66,
      winter: 0x88ccff
    };
    const colors = colorsBySeason[season] || 0x66ccff;
    const labels = labelsBySeason[season] || ['Daily Task A','Daily Task B','Daily Task C'];

    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + (Math.random() * 0.6 - 0.3);
      const r = 2 + Math.random() * 1.5;
      const pos = seedPos.clone().add(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
      pos.y = Math.max(seedPos.y, 0.2);

      const marker = makeMarker({
        color: colors,
        radius: 0.16,
        label: labels[i] || `Task ${i + 1}`,
        id: `daily-${dayKey()}-${i}`
      });
      marker.position.copy(pos);
      marker.userData.baseY = pos.y;
      marker.userData.label = labels[i];
      marker.userData.index = i;
      marker.userData.completed = !!(completedMap[dayKey()] && completedMap[dayKey()].includes(marker.userData.id));
      markers.push(marker);
      group.add(marker);
    }
  }

  generateMarkers();

  function tryPlaySFX() {
    try {
      audioManager?.playSFX?.('ui/quest-complete.ogg', 0.8);
    } catch (e) {
      // ignore missing assets or autoplay blocks
    }
  }

  function update(delta) {
    if (!active) return;
    if (!playerModel) return;
    const now = performance.now() / 1000;
    markers.forEach(m => {
      m.userData.bobPhase += delta * (0.8 + (m.userData.index * 0.05));
      const bob = Math.sin(m.userData.bobPhase) * 0.08;
      m.position.y = m.userData.baseY + bob;
      m.rotation.y += delta * 0.5;

      // proximity check
      const distSq = m.position.distanceToSquared(playerModel.position);
      const triggerRadiusSq = 2.0 * 2.0;
      if (distSq <= triggerRadiusSq && !m.userData.completed) {
        // Mark as completed for this day
        m.userData.completed = true;
        try {
          const dk = dayKey();
          completedMap = loadCompleted();
          if (!completedMap[dk]) completedMap[dk] = [];
          completedMap[dk].push(m.userData.id);
          saveCompleted(completedMap);
        } catch (e) {}

        // Show toast
        try {
          const lbl = m.userData.label || 'Daily Challenge';
          toasts?.show?.(`Daily: ${lbl}`);
        } catch (e) {}

        // Play sfx if available
        tryPlaySFX();
      }
    });
  }

  function setActive(on = true) {
    if (on === active) return;
    active = !!on;
    if (active) {
      if (!group.parent) scene.add(group);
    } else {
      try { if (group.parent) group.parent.remove(group); } catch (e) {}
    }
  }

  function dispose() {
    try {
      if (group.parent) group.parent.remove(group);
    } catch (e) {}
    markers.forEach(m => {
      try { m.geometry.dispose(); } catch (e) {}
      try { if (m.material && m.material.dispose) m.material.dispose(); } catch (e) {}
    });
    markers.length = 0;
  }

  return {
    name: ROOT_NAME,
    group,
    setActive,
    update,
    dispose
  };
}
