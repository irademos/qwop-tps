import * as THREE from "three";

const DEFAULT_ELEVATION = 0.0;
const DEFAULT_REPEAT_METERS = 10;

const textureLoader = new THREE.TextureLoader();

function loadGroundTexture(url) {
  const texture = textureLoader.load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

const groundTexture = loadGroundTexture(
  "/assets/textures/forrest_ground_01_4k.blend/textures/forrest_ground_01_diff_4k.jpg"
);

export function createMapGround({
  scene,
  elevation = DEFAULT_ELEVATION,
  repeatMeters = DEFAULT_REPEAT_METERS
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    map: groundTexture,
    roughness: 0.9,
    metalness: 0.02
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = "osm-ground";
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = elevation;
  mesh.receiveShadow = true;
  mesh.visible = false;
  scene?.add(mesh);

  function update(bounds, { widthMeters, heightMeters, paddingMeters = 0 } = {}) {
    if (!bounds) {
      mesh.visible = false;
      return;
    }

    const width = Math.max(1, (widthMeters ?? 1) + paddingMeters * 2);
    const height = Math.max(1, (heightMeters ?? widthMeters ?? 1) + paddingMeters * 2);

    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    mesh.geometry = new THREE.PlaneGeometry(width, height, 1, 1);
    mesh.position.set(0, elevation, 0);

    const repeatX = Math.max(1, width / repeatMeters);
    const repeatY = Math.max(1, height / repeatMeters);
    groundTexture.repeat.set(repeatX, repeatY);

    mesh.visible = true;
  }

  function dispose() {
    mesh.geometry?.dispose?.();
    material.dispose();
    groundTexture.dispose();
    scene?.remove(mesh);
  }

  return {
    mesh,
    update,
    dispose
  };
}
