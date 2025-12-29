import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BreakManager } from './breakManager.js';

// LevelLoader loads a manifest describing assets and instances. It also
// registers destructible objects with BreakManager so they can be swapped at
// runtime when destroyed.
export class LevelLoader {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.assets = new Map();
    this.breakManager = options.breakManager || new BreakManager(scene);
  }

  async loadManifest(url) {
    const res = await fetch(url);
    const manifest = await res.json();
    await this._loadAssets(manifest.assets);
    this._createInstances(manifest.instances);
    return manifest;
  }

  async _loadAssets(assetMap) {
    const entries = Object.entries(assetMap || {});
    const promises = entries.map(async ([id, path]) => {
      const gltf = await this.loader.loadAsync(path);
      this.assets.set(id, gltf.scene);
    });
    await Promise.all(promises);
  }

  _createInstances(instances = []) {
    instances.forEach(inst => {
      const src = this.assets.get(inst.asset);
      if (!src) return;
      const obj = src.clone(true);

      // Instance transforms are exported from Blender in Z-up coordinates.
      // Convert position and rotation to Three.js's Y-up system.
      const pos = new THREE.Vector3().fromArray(inst.position || [0, 0, 0]);
      pos.set(pos.x, pos.z, -pos.y);

      const r = inst.rotationEuler || [0, 0, 0];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'));
      const convertQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      q.premultiply(convertQ);

      obj.position.copy(pos);
      obj.quaternion.copy(q);

      // Scale may be a scalar, vector, or provided via meta.scaleVec for non-uniform scaling
      let scaleArr = null;
      if (Array.isArray(inst.scale)) {
        scaleArr = inst.scale;
      } else if (inst.meta && Array.isArray(inst.meta.scaleVec)) {
        scaleArr = inst.meta.scaleVec;
      } else if (typeof inst.scale === 'number') {
        obj.scale.setScalar(inst.scale);
      }
      if (scaleArr) {
        const s = new THREE.Vector3().fromArray(scaleArr);
        // Reorder axes to match the Y-up system
        obj.scale.set(s.x, s.z, s.y);
      }

      obj.userData.id = inst.id;
      obj.userData.tags = inst.tags || [];
      obj.userData.meta = inst.meta || {};

      this.scene.add(obj);
      obj.updateMatrixWorld(true);

      if (inst.meta && inst.meta.fractureId) {
        const fractureScene = this.assets.get(inst.meta.fractureId);
        const bbox = new THREE.Box3().setFromObject(obj);
        const center = bbox.getCenter(new THREE.Vector3());
        this.breakManager.register(obj, {
          id: inst.id,
          health: inst.meta.health,
          fractureScene,
          bbox,
          center
        });
      }
    });
  }

  // Convenience hook to forward hit events to the break manager
  onHit(id, damage, impulse) {
    this.breakManager.onHit(id, damage, impulse);
  }
}
