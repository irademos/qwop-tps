// Blob shadows — a soft dark disc on the ground under each character. The cheap stand-in for
// real shadow maps on the "low" performance tier (bootstrapGameApp.js turns them on there via
// setBlobShadowsEnabled and off where the directional light casts real shadows).
//
// A blob is a child of the character container (so it comes and goes with the character), but
// its world matrix is rewritten in onBeforeRender: flat on the ground (getTerrainHeight) under
// the character, whatever the character's height or tilt, shrinking as the character rises.
import * as THREE from 'three';
import { getTerrainHeight } from './terrainHeight.js';

const GROUND_OFFSET = 0.03;      // lift above the ground to avoid z-fighting
const FADE_HEIGHT = 3;           // m above the ground at which the blob is smallest
const MIN_SCALE = 0.45;

let _texture = null;
let _material = null;
let _geometry = null;

function getTexture() {
  if (_texture) return _texture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _texture = new THREE.CanvasTexture(canvas);
  _texture.colorSpace = THREE.SRGBColorSpace;
  return _texture;
}

function getMaterial() {
  if (_material) return _material;
  _material = new THREE.MeshBasicMaterial({
    map: getTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
    visible: false, // off until setBlobShadowsEnabled(true)
  });
  return _material;
}

function getGeometry() {
  if (_geometry) return _geometry;
  _geometry = new THREE.PlaneGeometry(1, 1);
  _geometry.rotateX(-Math.PI / 2);
  return _geometry;
}

/** Shows / hides every blob shadow (one shared material). */
export function setBlobShadowsEnabled(enabled) {
  getMaterial().visible = !!enabled;
}

const _parentPos = new THREE.Vector3();
const _parentScale = new THREE.Vector3();

/**
 * Adds a blob shadow under `parent` (whose origin is at the character's feet).
 * @param {THREE.Object3D} parent
 * @param {number} diameter size of the disc in `parent`'s units (its world scale is applied)
 */
export function addBlobShadow(parent, diameter = 1) {
  const blob = new THREE.Mesh(getGeometry(), getMaterial());
  blob.name = 'BlobShadow';
  blob.matrixAutoUpdate = false;
  blob.matrixWorldAutoUpdate = false;
  blob.frustumCulled = false; // its matrixWorld is only set right before it is drawn
  blob.castShadow = false;
  blob.receiveShadow = false;
  blob.renderOrder = 1;
  blob.userData.isBlobShadow = true; // body fades (PlayerControls._applyBodyOpacity) skip it
  blob.onBeforeRender = () => {
    const p = blob.parent;
    if (!p) return;
    _parentPos.setFromMatrixPosition(p.matrixWorld);
    _parentScale.setFromMatrixScale(p.matrixWorld);
    let groundY = getTerrainHeight(_parentPos.x, _parentPos.z);
    if (!Number.isFinite(groundY)) groundY = _parentPos.y;
    const rise = Math.max(0, _parentPos.y - groundY);
    const s = diameter * Math.max(_parentScale.x, _parentScale.z) * Math.max(MIN_SCALE, 1 - (rise / FADE_HEIGHT) * (1 - MIN_SCALE));
    blob.matrixWorld.makeScale(s, 1, s);
    blob.matrixWorld.setPosition(_parentPos.x, groundY + GROUND_OFFSET, _parentPos.z);
  };
  parent.add(blob);
  return blob;
}
