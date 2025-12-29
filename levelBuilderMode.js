import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export class LevelBuilder {
  constructor({ scene, camera, renderer }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.loader = new GLTFLoader();
    this.assets = {};
    this.objects = [];
    this.propUrls = {};
    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selected = null;

    this._setupUI();
    this.mode = 'translate';

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.enabled = false;
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;
    this.scene.add(this.transformControls);
  }

  _setupUI() {
    this.sidebar = document.getElementById('level-builder-sidebar');
    if (!this.sidebar) {
      this.sidebar = document.createElement('div');
      this.sidebar.id = 'level-builder-sidebar';
      document.body.appendChild(this.sidebar);
    }

    this.sidebar.innerHTML = `
      <select id="prop-select"><option value="">Add Prop...</option></select>
      <select id="scene-prop-select"><option value="">Select Prop...</option></select>
      <div id="mode-controls">
        <button data-mode="translate">⇄</button>
        <button data-mode="rotate">⟳</button>
        <button data-mode="scale">⤢</button>
      </div>
      <div>
        <label>Health <input id="prop-health" type="number" value="100" /></label>
      </div>
      <div>
        <label>Tags <input id="prop-tags" type="text" value="prop" /></label>
      </div>
      <div>
        <button id="delete-prop">Delete Prop</button>
      </div>
      <div>
        <button id="download-level">Download JSON</button>
        <button id="upload-level">Upload JSON</button>
        <input type="file" id="upload-input" accept="application/json" style="display:none" />
      </div>
    `;
    this.sidebar.classList.add('hidden');

    this.propSelect = this.sidebar.querySelector('#prop-select');
    this.sceneSelect = this.sidebar.querySelector('#scene-prop-select');
    this.healthInput = this.sidebar.querySelector('#prop-health');
    this.tagsInput = this.sidebar.querySelector('#prop-tags');
    this.deleteBtn = this.sidebar.querySelector('#delete-prop');

    this.modeControls = this.sidebar.querySelector('#mode-controls');
    this.modeControls.querySelectorAll('button[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode;
        this.transformControls.setMode(this.mode);
      });
    });

    this.propSelect.addEventListener('change', () => {
      if (this.propSelect.value) {
        this.spawnProp(this.propSelect.value);
        this.propSelect.value = '';
      }
    });

    this.sceneSelect.addEventListener('change', () => {
      const id = this.sceneSelect.value;
      const obj = this.objects.find(o => o.userData.id === id);
      if (obj) this.selectObject(obj);
    });

    this.healthInput.addEventListener('input', () => {
      if (this.selected) {
        this.selected.userData.meta.health = parseInt(this.healthInput.value) || 0;
      }
    });

    this.tagsInput.addEventListener('input', () => {
      if (this.selected) {
        this.selected.userData.tags = this.tagsInput.value
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
      }
    });

    this.deleteBtn.addEventListener('click', () => {
      if (!this.selected) return;
      this.scene.remove(this.selected);
      this.objects = this.objects.filter(o => o !== this.selected);
      this._removeObjectOption(this.selected);
      this.selected = null;
      this.sceneSelect.value = '';
      this.transformControls.detach();
      this.transformControls.enabled = false;
      this.transformControls.visible = false;
    });

    this.sidebar.querySelector('#download-level').addEventListener('click', () => this.downloadJSON());
    const uploadBtn = this.sidebar.querySelector('#upload-level');
    const uploadInput = this.sidebar.querySelector('#upload-input');
    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const data = JSON.parse(ev.target.result);
        this.loadJSON(data);
      };
      reader.readAsText(file);
    });

    const propFiles = [
      'building3_big_chunks',
      'building3_big_intact',
      'rock_band_poster_plane_002_chunks',
      'rock_band_poster_plane_002_intact',
      'rootnode_003_chunks',
      'rootnode_003_intact',
      'rootnode_007_chunks',
      'rootnode_007_intact',
      'node_001_chunks',
      'rootnode_001_chunks',
      'rootnode_005_chunks',
      'rootnode_chunks',
      'node_001_intact',
      'rootnode_001_intact',
      'rootnode_005_intact',
      'rootnode_intact',
      'node_chunks',
      'rootnode_002_chunks',
      'rootnode_006_chunks',
      'stop_sign_chunks',
      'node_intact',
      'rootnode_002_intact',
      'rootnode_006_intact',
      'stop_sign_intact'
    ];
    propFiles.forEach(name => {
      const url = `/assets/props/${name}.glb`;
      this.propUrls[name] = url;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      this.propSelect.appendChild(opt);
    });
  }

  enable() {
    if (this.active) return;
    this.active = true;
    this.sidebar.classList.remove('hidden');
    this.modeControls?.classList.remove('hidden');
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.transformControls.enabled = true;
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.sidebar.classList.add('hidden');
    this.modeControls?.classList.add('hidden');
    this.selected = null;
    this.transformControls.detach();
    this.transformControls.enabled = false;
    this.transformControls.visible = false;
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
  }

  toggle() {
    if (this.active) this.disable(); else this.enable();
  }

  _centerObject(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const pivot = new THREE.Object3D();
    obj.position.sub(center);
    pivot.add(obj);
    obj.traverse(c => (c.userData.parentProp = pivot));
    return pivot;
  }

  spawnProp(name) {
    const url = this.propUrls[name];
    if (!url) return;
    const create = scene => {
      const raw = scene.clone(true);
      const obj = this._centerObject(raw);
      obj.position.set(0, 0, 0);
      obj.userData.asset = name;
      obj.userData.id = `${name}_${Date.now()}`;
      obj.userData.tags = ['prop'];
      obj.userData.meta = { health: 100, fractureId: '' };
      this.scene.add(obj);
      this.objects.push(obj);
      this._addObjectOption(obj);
      this.selectObject(obj);
    };
    if (this.assets[name]) {
      create(this.assets[name]);
    } else {
      this.loader.load(url, gltf => {
        this.assets[name] = gltf.scene;
        create(this.assets[name]);
      });
    }
  }

  selectObject(obj) {
    this.selected = obj;
    this.transformControls.attach(obj);
    this.transformControls.setMode(this.mode);
    this.transformControls.enabled = true;
    this.transformControls.visible = true;
    this.healthInput.value = obj.userData.meta.health || 0;
    this.tagsInput.value = (obj.userData.tags || []).join(', ');
    if (this.sceneSelect) {
      this.sceneSelect.value = obj.userData.id;
    }
  }

  _onPointerDown = event => {
    if (!this.active) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    this.objects.forEach(o => o.traverse(c => { if (c.isMesh) meshes.push(c); }));
    const intersects = this.raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
      const root = intersects[0].object.userData.parentProp || intersects[0].object;
      this.selectObject(root);
    } else {
      this.selected = null;
      this.transformControls.detach();
      this.transformControls.enabled = false;
      this.transformControls.visible = false;
      if (this.sceneSelect) this.sceneSelect.value = '';
    }
  };

  update() {
    if (this.selected && this.gizmo) {
      const box = new THREE.Box3().setFromObject(this.selected);
      const center = box.getCenter(new THREE.Vector3());
      center.project(this.camera);
      const x = (center.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-center.y * 0.5 + 0.5) * window.innerHeight;
      this.gizmo.style.left = `${x}px`;
      this.gizmo.style.top = `${y}px`;
    }
  }

  downloadJSON() {
    const assets = {};
    Object.keys(this.propUrls).forEach(name => {
      assets[name] = `/assets/props/${name}.glb`;
    });
    const instances = this.objects.map(obj => {
      const pos = obj.position;
      const rotQ = obj.quaternion.clone();
      const convertQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      const qManifest = convertQ.clone().invert().multiply(rotQ);
      const euler = new THREE.Euler().setFromQuaternion(qManifest, 'XYZ');
      return {
        id: obj.userData.id,
        asset: obj.userData.asset,
        position: [pos.x, -pos.z, pos.y],
        rotationEuler: [euler.x, euler.y, euler.z],
        scale: [obj.scale.x, obj.scale.z, obj.scale.y],
        tags: obj.userData.tags || [],
        meta: {
          health: obj.userData.meta.health || 0,
          fractureId: obj.userData.meta.fractureId || ''
        }
      };
    });
    const data = { version: 1, assets, instances };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async loadJSON(manifest) {
    const entries = Object.entries(manifest.assets || {});
    const promises = entries.map(([name, path]) => {
      if (this.assets[name]) return Promise.resolve();
      return new Promise(resolve => {
        this.loader.load(path, gltf => {
          this.assets[name] = gltf.scene;
          this.propUrls[name] = path;
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          this.propSelect.appendChild(opt);
          resolve();
        });
      });
    });
    await Promise.all(promises);

    (manifest.instances || []).forEach(inst => {
      const src = this.assets[inst.asset];
      if (!src) return;
      const raw = src.clone(true);
      const obj = this._centerObject(raw);
      const pos = inst.position || [0, 0, 0];
      obj.position.set(pos[0], pos[2], -pos[1]);
      const r = inst.rotationEuler || [0, 0, 0];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'));
      const convertQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      q.premultiply(convertQ);
      obj.quaternion.copy(q);
      if (Array.isArray(inst.scale)) {
        obj.scale.set(inst.scale[0], inst.scale[2], inst.scale[1]);
      } else if (typeof inst.scale === 'number') {
        obj.scale.setScalar(inst.scale);
      }
      obj.userData.asset = inst.asset;
      obj.userData.id = inst.id;
      obj.userData.tags = inst.tags || [];
      obj.userData.meta = inst.meta || {};
      this.scene.add(obj);
      this.objects.push(obj);
      this._addObjectOption(obj);
    });
  }

  _addObjectOption(obj) {
    if (!this.sceneSelect) return;
    const opt = document.createElement('option');
    opt.value = obj.userData.id;
    opt.textContent = obj.userData.id;
    this.sceneSelect.appendChild(opt);
  }

  _removeObjectOption(obj) {
    if (!this.sceneSelect) return;
    const opt = Array.from(this.sceneSelect.options).find(o => o.value === obj.userData.id);
    if (opt) opt.remove();
  }

  // TransformControls handles dragging internally; no manual event handlers needed.
}

