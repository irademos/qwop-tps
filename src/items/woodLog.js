// A cut log — bark round the side, pale rings on its ends. The look of Town's felled trees'
// logs (townTrees.js), the wood stacked in the cart's bed (townCart.js) and a destroyed
// building's heap (src/environment/ruins.js). One geometry + materials shared by all of them.
//
// createWoodLog(r, len) → a mesh along +Y (its middle at the origin), radius r, length len
// WOOD_LOG_GEO / woodLogMaterials() — for code that scales its own meshes (the tree logs)

import * as THREE from 'three';

// Fresh-cut wood: rings on a pale face (the stump's top, the logs' ends)
const ringsTexture = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#5e4129';
  g.fillRect(0, 0, 64, 64);
  for (let r = 30; r > 0; r -= 3) {
    g.beginPath();
    g.arc(32, 32, r, 0, Math.PI * 2);
    g.fillStyle = r > 27 ? '#6b4a2f' : (r / 3) % 2 ? '#d9b57c' : '#c99f63';
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

export const WOOD_LOG_GEO = new THREE.CylinderGeometry(1, 1, 1, 10);
let mats = null;
// [bark, end, end] — a cylinder's side, top, bottom
export const woodLogMaterials = () => {
  if (!mats) {
    const bark = new THREE.MeshStandardMaterial({ color: 0x5e4129, roughness: 1 });
    const end = new THREE.MeshStandardMaterial({ map: ringsTexture(), roughness: 1 });
    mats = [bark, end, end];
  }
  return mats;
};

export const createWoodLog = (r = 0.18, len = 1.1) => {
  const mesh = new THREE.Mesh(WOOD_LOG_GEO, woodLogMaterials());
  mesh.scale.set(r, len, r);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};
