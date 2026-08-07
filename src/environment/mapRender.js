import * as THREE from "three";

export function createMapRenderer({ scene } = {}) {
  const group = new THREE.Group();
  group.name = "osm-highways-disabled";
  scene?.add(group);

  function updateTileHighways() {
    // Road rendering is intentionally disabled; OSM highway data should not
    // create any road meshes in the world.
    return null;
  }

  function removeTile() {}

  function clearTiles() {}

  function setResolution() {}

  function setBrightness() {}

  function dispose() {
    group.clear();
    scene?.remove(group);
  }

  return {
    group,
    updateTileHighways,
    removeTile,
    clearTiles,
    setResolution,
    setBrightness,
    dispose
  };
}
