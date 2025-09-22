/**
 * Player Housing Customization
 *
 * - Adds a small customizable house near the player (no UI buttons).
 * - Keyboard controls:
 *    H -> cycle wall color
 *    K -> cycle roof style
 *
 * Exports: initPlayerHousingCustomization(THREE, { scene, playerModel, playerHousing })
 *
 * No top-level side-effects.
 */

export function initPlayerHousingCustomization(THREE, { scene, playerModel, playerHousing } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const root = new THREE.Group();
  root.name = 'player-housing-custom';
  let active = false;

  // Simple palette + roof styles
  const COLORS = [0xa0522d, 0x8b4513, 0xffd27f, 0x7fbf7f, 0xb0c4de];
  const ROOF_TYPES = ['gable', 'flat'];

  let colorIdx = 0;
  let roofIdx = 0;

  let wallsMesh = null;
  let roofMesh = null;
  let baseMesh = null;

  // Helpers
  function disposeMesh(m) {
    if (!m) return;
    try {
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) {
          m.material.forEach(mat => mat.dispose && mat.dispose());
        } else {
          m.material.dispose && m.material.dispose();
        }
      }
    } catch (e) {}
  }

  function removeAll() {
    while (root.children.length) {
      const c = root.children.pop();
      disposeMesh(c);
      // Three will take care of removing from scene when root removed
    }
  }

  function buildRoof(type) {
    if (roofMesh) {
      root.remove(roofMesh);
      disposeMesh(roofMesh);
      roofMesh = null;
    }

    if (type === 'gable') {
      // Use a pyramid-like roof (scaled cone with 4 segments) for a simple gable look
      const geo = new THREE.ConeGeometry(1.15, 0.7, 4);
      geo.rotateY(Math.PI / 4);
      roofMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }));
      roofMesh.position.y = 1.3;
    } else {
      // flat roof: thin box
      const geo = new THREE.BoxGeometry(1.9, 0.14, 1.6);
      roofMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }));
      roofMesh.position.y = 1.05;
    }
    roofMesh.receiveShadow = false;
    roofMesh.castShadow = true;
    root.add(roofMesh);
  }

  function build() {
    removeAll();

    // Base platform
    const baseGeo = new THREE.BoxGeometry(2.0, 0.06, 1.7);
    baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x5c3b2e, roughness: 0.8 }));
    baseMesh.position.y = 0.03;
    root.add(baseMesh);

    // Walls
    const wallGeo = new THREE.BoxGeometry(1.8, 1.2, 1.5);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS[colorIdx], roughness: 0.8 });
    wallsMesh = new THREE.Mesh(wallGeo, wallMat);
    wallsMesh.position.y = 0.6;
    wallsMesh.castShadow = true;
    wallsMesh.receiveShadow = true;
    root.add(wallsMesh);

    // Door (simple inset)
    const doorGeo = new THREE.BoxGeometry(0.4, 0.7, 0.02);
    const door = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ color: 0x2b160a }));
    door.position.set(0, 0.35, 0.76);
    root.add(door);

    // Roof
    buildRoof(ROOF_TYPES[roofIdx]);
  }

  function updatePosition() {
    try {
      if (playerHousing && playerHousing.root && playerHousing.root.position) {
        root.position.copy(playerHousing.root.position).add(new THREE.Vector3(2.4, 0, 0));
      } else {
        root.position.copy(playerModel.position).add(new THREE.Vector3(3, 0, 0));
      }
      root.position.y = Math.max(0, root.position.y);
    } catch (e) {}
  }

  function applyNextColor() {
    colorIdx = (colorIdx + 1) % COLORS.length;
    if (wallsMesh && wallsMesh.material) {
      wallsMesh.material.color.setHex(COLORS[colorIdx]);
      wallsMesh.material.needsUpdate = true;
    }
  }

  function applyNextRoof() {
    roofIdx = (roofIdx + 1) % ROOF_TYPES.length;
    buildRoof(ROOF_TYPES[roofIdx]);
  }

  function onKey(e) {
    if (!active) return;
    if (e.code === 'KeyH') {
      applyNextColor();
    } else if (e.code === 'KeyK') {
      applyNextRoof();
    }
  }

  // Public API
  function setActive(on) {
    if (on === active) return;
    active = !!on;
    if (active) {
      // ensure placed in scene
      if (!root.parent) scene.add(root);
      updatePosition();
      build();
      window.addEventListener('keydown', onKey);
    } else {
      window.removeEventListener('keydown', onKey);
      if (root.parent) root.parent.remove(root);
      removeAll();
    }
  }

  function update(delta) {
    if (!active) return;
    // gently bob the house for a subtle alive feel
    const t = performance.now() * 0.001;
    root.rotation.y = Math.sin(t * 0.2) * 0.02;
    updatePosition();
  }

  function dispose() {
    setActive(false);
    removeAll();
  }

  // return controller (no side-effects until setActive(true) called)
  return {
    setActive,
    update,
    dispose
  };
}
/**
 * features/playerHousingCustomization.js
 *
 * Lightweight player housing customization presets manager.
 * - No top-level side effects on import.
 * - Exports initPlayerHousingCustomization(...) which returns a controller object.
 *
 * Usage:
 *   const ctrl = initPlayerHousingCustomization(THREE, { scene, playerModel, playerHousing, toasts });
 *   ctrl.setActive(true);
 *
 * Keyboard (visible/verifiable changes):
 *   - H: cycle next preset
 *   - Shift+H: cycle previous preset
 *
 * Presets are stored in localStorage under "playerHousingPresets_v1".
 */

// export function initPlayerHousingCustomization(THREE, { scene, playerModel, playerHousing, toasts } = {}) {
//   const STORAGE_KEY = "playerHousingPresets_v1";
//   let active = false;
//   let presets = [];
//   let currentIndex = 0;
//   let pollInterval = null;
//   let pendingApply = null;

//   function _loadFromStorage() {
//     try {
//       const raw = localStorage.getItem(STORAGE_KEY);
//       if (!raw) return null;
//       const parsed = JSON.parse(raw);
//       if (Array.isArray(parsed) && parsed.length) return parsed;
//       return null;
//     } catch (e) {
//       return null;
//     }
//   }

//   function _saveToStorage() {
//     try {
//       localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
//     } catch (e) {
//       // ignore quota errors
//       console.warn("Failed to save housing presets", e);
//     }
//   }

//   function _defaultPresets() {
//     return [
//       { name: "Cottage (Red Roof)", color: 0xa05030, roof: "tile", scale: 1.0 },
//       { name: "Garden (Green)", color: 0x4caf50, roof: "shingle", scale: 1.0 },
//       { name: "Snow Cabin", color: 0xe0e8f0, roof: "snow", scale: 0.95 }
//     ];
//   }

//   function listPresets() {
//     return presets.map(p => p.name);
//   }

//   function _getMeshes(root) {
//     if (!root || !root.traverse) return [];
//     const out = [];
//     root.traverse((n) => {
//       if (n.isMesh) out.push(n);
//     });
//     return out;
//   }

//   function _setMeshColor(mesh, hex) {
//     if (!mesh || !mesh.material) return;
//     const apply = (mat) => {
//       if (mat && mat.color) {
//         mat.color.setHex(hex);
//       }
//       if (mat && mat.emissive) {
//         // small emissive tint for visibility
//         const emissive = (hex & 0xffffff) >> 2;
//         mat.emissive.setHex(Math.min(0xffffff, emissive));
//       }
//       if (typeof mat.needsUpdate !== "undefined") mat.needsUpdate = true;
//     };
//     if (Array.isArray(mesh.material)) {
//       mesh.material.forEach(apply);
//     } else {
//       apply(mesh.material);
//     }
//   }

//   function applyPreset(preset) {
//     if (!preset) return;
//     // If there's a housing controller API, prefer that (non-breaking)
//     try {
//       if (playerHousing && typeof playerHousing.applyCustomization === "function") {
//         playerHousing.applyCustomization(preset);
//         if (toasts && typeof toasts.show === "function") toasts.show(`Applied preset: ${preset.name}`);
//         return;
//       }
//       // Try setColor / setRoof style APIs
//       if (playerHousing && typeof playerHousing.setColor === "function") {
//         try { playerHousing.setColor(preset.color); } catch (e) {}
//       }
//       if (playerHousing && typeof playerHousing.setRoofVariant === "function" && preset.roof) {
//         try { playerHousing.setRoofVariant(preset.roof); } catch (e) {}
//       }

//       // If housing exposes a root Three.js Group, mutate visible mesh materials
//       const root = playerHousing && (playerHousing.root || playerHousing.group || playerHousing.object) ? (playerHousing.root || playerHousing.group || playerHousing.object) : null;
//       if (root) {
//         const meshes = _getMeshes(root);
//         meshes.forEach(m => _setMeshColor(m, preset.color));
//         // Apply a simple roof-variant visual: toggle children whose name includes "roof"
//         if (preset.roof) {
//           root.traverse(n => {
//             if (!n.isMesh) return;
//             const nm = (n.name || "").toLowerCase();
//             if (nm.includes("roof")) {
//               // store original visibility in userData for future toggles
//               n.userData.__lastVariant = preset.roof;
//               // subtle transform to indicate variant (small scale tweak)
//               n.scale.setScalar(preset.roof === "snow" ? 1.03 : 1.0);
//             }
//           });
//         }
//         // scale tweak
//         if (typeof preset.scale === "number") {
//           root.scale.setScalar(preset.scale);
//         }
//         if (toasts && typeof toasts.show === "function") toasts.show(`Applied preset: ${preset.name}`);
//         return;
//       }

//       // If no housing available yet, remember to apply later
//       pendingApply = preset;
//       console.info("Player housing not present yet; preset will be applied when available.");
//     } catch (e) {
//       console.error("applyPreset error", e);
//     }
//   }

//   function savePreset(name) {
//     const label = name && String(name).trim() ? String(name).trim() : `Preset ${presets.length + 1}`;
//     // Capture current visual state if possible
//     const sample = { name: label, color: 0xcccccc, roof: "tile", scale: 1.0 };
//     try {
//       if (playerHousing && typeof playerHousing.getCurrentCustomization === "function") {
//         const cur = playerHousing.getCurrentCustomization();
//         if (cur && typeof cur === "object") {
//           Object.assign(sample, cur);
//         }
//       } else {
//         const root = playerHousing && (playerHousing.root || playerHousing.group || playerHousing.object) ? (playerHousing.root || playerHousing.group || playerHousing.object) : null;
//         if (root) {
//           // pick first mesh color as representative
//           const meshes = _getMeshes(root);
//           for (const m of meshes) {
//             const mat = Array.isArray(m.material) ? m.material[0] : m.material;
//             if (mat && mat.color && typeof mat.color.getHex === "function") {
//               sample.color = mat.color.getHex();
//               break;
//             }
//           }
//           sample.scale = (typeof root.scale?.x === "number") ? root.scale.x : sample.scale;
//         }
//       }
//     } catch (e) {
//       // ignore
//     }
//     presets.push(sample);
//     _saveToStorage();
//     return sample;
//   }

//   function loadPresetByName(name) {
//     const p = presets.find(x => x.name === name) || presets[0] || null;
//     if (p) {
//       currentIndex = presets.indexOf(p);
//       applyPreset(p);
//     }
//     return p;
//   }

//   function cycleNext() {
//     if (!presets.length) return;
//     currentIndex = (currentIndex + 1) % presets.length;
//     applyPreset(presets[currentIndex]);
//   }

//   function cyclePrev() {
//     if (!presets.length) return;
//     currentIndex = (currentIndex - 1 + presets.length) % presets.length;
//     applyPreset(presets[currentIndex]);
//   }

//   function _ensurePresets() {
//     const stored = _loadFromStorage();
//     if (stored && Array.isArray(stored) && stored.length) {
//       presets = stored;
//     } else {
//       presets = _defaultPresets();
//       _saveToStorage();
//     }
//   }

//   function _pollForHousing() {
//     if (playerHousing) {
//       if (pendingApply) {
//         applyPreset(pendingApply);
//         pendingApply = null;
//       }
//       return;
//     }
//     if (window && window.playerHousing) {
//       playerHousing = window.playerHousing;
//       if (pendingApply) {
//         applyPreset(pendingApply);
//         pendingApply = null;
//       }
//     }
//   }

//   function _onKey(e) {
//     if (!active) return;
//     if (e.code === "KeyH") {
//       if (e.shiftKey) cyclePrev(); else cycleNext();
//     }
//     if (e.code === "KeyS" && e.shiftKey) {
//       // Shift+S saves a quick preset (no UI)
//       const p = savePreset(`Saved ${new Date().toISOString().slice(11,19)}`);
//       if (toasts && typeof toasts.show === "function") toasts.show(`Saved preset: ${p.name}`);
//       console.info("Saved housing preset", p);
//     }
//   }

//   function setPlayerHousing(ph) {
//     playerHousing = ph;
//     if (pendingApply) {
//       applyPreset(pendingApply);
//       pendingApply = null;
//     }
//   }

//   function setActive(on = true) {
//     active = !!on;
//     if (active) {
//       _ensurePresets();
//       // Try to apply first preset immediately for visible verification
//       if (presets.length) {
//         applyPreset(presets[0]);
//         currentIndex = 0;
//       }
//       // start polling for window.playerHousing if not provided
//       pollInterval = setInterval(_pollForHousing, 600);
//       window.addEventListener("keydown", _onKey);
//     } else {
//       if (pollInterval) {
//         clearInterval(pollInterval);
//         pollInterval = null;
//       }
//       window.removeEventListener("keydown", _onKey);
//     }
//   }

//   // Public API
//   return {
//     setActive,
//     savePreset,
//     loadPresetByName,
//     listPresets,
//     applyPreset,
//     setPlayerHousing,
//     getPresets: () => presets.slice(),
//   };
// }
