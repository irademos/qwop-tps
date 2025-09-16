/**
 * ai/companionSpirit.js
 *
 * Lightweight companion "spirit" orb that follows the player.
 * - No top-level side-effects on import.
 * - Small, GPU-friendly geometry and material.
 * - Exposes createCompanionSpirit(THREE, { scene, playerModel, audioManager })
 *
 * Usage:
 *   const companion = createCompanionSpirit(THREE, { scene, playerModel, audioManager });
 *   companion.setActive(true);
 *   // each frame: companion.update(delta);
 *   companion.destroy(); // when cleaning up
 */

export function createCompanionSpirit(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) {
    throw new Error('THREE is required by createCompanionSpirit');
  }

  let group = null;
  let orb = null;
  let glow = null;
  let active = false;
  let time = 0;

  function create() {
    group = new THREE.Group();
    // Simple emissive orb
    const geom = new THREE.SphereGeometry(0.12, 12, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x88eeff,
      emissive: 0x66bbff,
      emissiveIntensity: 1.2,
      roughness: 0.6,
      metalness: 0.0
    });
    orb = new THREE.Mesh(geom, mat);
    orb.castShadow = false;
    orb.receiveShadow = false;
    group.add(orb);

    // subtle larger transparent glow mesh
    const glowGeom = new THREE.SphereGeometry(0.26, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x88eeff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    glow = new THREE.Mesh(glowGeom, glowMat);
    group.add(glow);

    group.userData.isCompanion = true;
    return group;
  }

  function setActive(next) {
    const should = !!next;
    if (should === active) return;
    active = should;
    if (active) {
      if (!group) create();
      scene.add(group);
      // Place immediately near player
      update(0);
    } else {
      if (group) {
        scene.remove(group);
      }
    }
  }

  function update(dt) {
    if (!active || !group || !playerModel) return;
    time += dt;
    // hover offset in front-right of player
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerModel.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(playerModel.quaternion).normalize();
    const base = playerModel.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    const orbitRadius = 0.6;
    const x = Math.sin(time * 1.2) * orbitRadius;
    const z = Math.cos(time * 1.2) * (orbitRadius * 0.6);
    const bob = Math.sin(time * 3.0) * 0.08;
    const pos = base.clone().add(right.multiplyScalar(x)).add(forward.multiplyScalar(z));
    pos.y += bob;
    group.position.lerp(pos, Math.min(1, dt * 8));
    group.rotation.y = time * 0.6;
    if (orb) orb.rotation.x = time * 1.1;

    // subtle pulse
    const scale = 1 + Math.sin(time * 4.0) * 0.03;
    group.scale.setScalar(scale);
  }

  function destroy() {
    if (group) {
      scene.remove(group);
    }
    if (orb && orb.geometry) orb.geometry.dispose();
    if (orb && orb.material) orb.material.dispose();
    if (glow && glow.geometry) glow.geometry.dispose();
    if (glow && glow.material) glow.material.dispose();
    group = null;
    orb = null;
    glow = null;
    active = false;
  }

  return {
    setActive,
    update,
    destroy
  };
}
