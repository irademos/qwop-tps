import * as THREE from 'three';

// Town canoe paddle: a procedural oar built like the wand / fishing rod — origin at the grip —
// but pointing the other way, along −Z: held as the sword weapon in oar form (FoamSword.oar),
// the phone held straight up holds the oar straight down, by its handle, the blade in the water.
// The top hand is on the grip (the origin, the T-handle just above it), the other hand lower
// down the shaft (OAR_SUPPORT_AT); the blade's middle is the `oar-blade` object (townCanoe.js
// reads where it is and how fast it moves through the water), its end `oar-tip`.

const SHAFT_COLOR = 0x9a6a3c;
const BLADE_COLOR = 0xb98250;
const GRIP_COLOR = 0x5b3a1e;

const SHAFT_LENGTH = 1.3;      // m from the grip to the blade's throat
const BLADE_LENGTH = 0.45;
const BLADE_WIDTH = 0.18;
const BLADE_THICK = 0.014;
export const OAR_SUPPORT_AT = 0.55; // m down the shaft from the grip: the lower hand
export const OAR_HAND_OUT = 0.3;    // m out to the side the blade's on: the top hand (FoamSword.oarLean)
export const OAR_BLADE_AT = SHAFT_LENGTH + BLADE_LENGTH / 2; // m down from the grip: the blade's middle

const along = (geometry) => geometry.rotateX(Math.PI / 2); // cylinder axis Y → Z
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.02, ...extra });

/** A new oar model (grip at the origin, blade along −Z; its `oar-blade` / `oar-tip` objects). */
export function createOarModel() {
  const group = new THREE.Group();
  group.name = 'oar';

  // T-handle just above the top hand
  const tBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 8).rotateZ(Math.PI / 2), std(GRIP_COLOR));
  tBar.position.z = 0.07;
  const neck = new THREE.Mesh(along(new THREE.CylinderGeometry(0.016, 0.017, 0.07, 8)), std(GRIP_COLOR));
  neck.position.z = 0.035;
  // The shaft, down to the blade
  const shaft = new THREE.Mesh(along(new THREE.CylinderGeometry(0.017, 0.019, SHAFT_LENGTH, 10)), std(SHAFT_COLOR, { roughness: 0.6 }));
  shaft.position.z = -SHAFT_LENGTH / 2;
  // The throat (shaft → blade) and the blade itself, flat across X
  const throat = new THREE.Mesh(new THREE.BoxGeometry(BLADE_WIDTH * 0.5, BLADE_THICK * 1.6, 0.12), std(BLADE_COLOR));
  throat.position.z = -SHAFT_LENGTH - 0.04;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(BLADE_WIDTH, BLADE_THICK, BLADE_LENGTH), std(BLADE_COLOR));
  blade.position.z = -SHAFT_LENGTH - BLADE_LENGTH / 2;
  // (a rounded end)
  const end = new THREE.Mesh(new THREE.CylinderGeometry(BLADE_WIDTH / 2, BLADE_WIDTH / 2, BLADE_THICK, 14, 1, false, 0, Math.PI), std(BLADE_COLOR));
  end.rotation.y = Math.PI / 2;
  end.position.z = -SHAFT_LENGTH - BLADE_LENGTH;
  group.add(tBar, neck, shaft, throat, blade, end);

  const mid = new THREE.Object3D();
  mid.name = 'oar-blade';
  mid.position.z = -SHAFT_LENGTH - BLADE_LENGTH * 0.55;
  const tip = new THREE.Object3D();
  tip.name = 'oar-tip';
  tip.position.z = -SHAFT_LENGTH - BLADE_LENGTH - BLADE_WIDTH / 2;
  group.add(mid, tip);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}
