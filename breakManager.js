import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';


// BreakManager handles swapping intact meshes with fractured versions
// and tracking health of destructible objects. Chunk pieces are added to
// a Rapier physics world so they can react semi-realistically after
// destruction.
export class BreakManager {
  constructor(scene, world = null) {
    this.scene = scene;
    this.world = world;
    this.registry = new Map(); // id -> { object, health, fractureScene }
    this.activeChunks = [];
  }

  setWorld(world) {
    this.world = world;
  }

  // Register a destructible object. `data` expects:
  // { id, health, fractureScene, bbox, center }
  register(object, data) {
    const id = data.id;
    const bbox = data.bbox || new THREE.Box3().setFromObject(object);
    const center = data.center || bbox.getCenter(new THREE.Vector3());
    this.registry.set(id, {
      object,
      health: data.health ?? 100,
      fractureScene: data.fractureScene,
      bbox,
      center
    });
  }

  // Apply damage to an object. Once health <= 0 the object is replaced with its chunks.
  onHit(id, damage = 10, impulse = new THREE.Vector3()) {
    const entry = this.registry.get(id);
    if (!entry || !this.world) return;
    entry.health -= damage;
    console.log(`🛢️ ${id} health: ${entry.health}`);
    if (entry.health > 0) return;

    const { object, fractureScene } = entry;
    this.registry.delete(id);
    if (!fractureScene) return;

    // Remove the intact mesh
    if (object.parent) {
      object.parent.remove(object);
    }

    // Clone chunk scene and convert meshes into independent physics bodies
    const chunksGroup = fractureScene.clone(true);
    chunksGroup.position.copy(object.position);
    chunksGroup.rotation.copy(object.rotation);
    chunksGroup.scale.copy(object.scale);
    this.scene.add(chunksGroup);
    chunksGroup.updateMatrixWorld(true);

    const chunkMeshes = [];
    chunksGroup.traverse(child => {
      if (child.isMesh) {
        chunkMeshes.push(child);
      }
    });

      

    for (const mesh of chunkMeshes) {
      // Detach mesh to the scene root so physics can control it
      this.scene.attach(mesh);

      // Build a simple box body using the mesh's bounding box
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = bbox.getSize(new THREE.Vector3());
      const half = { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
      const rbDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
        .setRotation({
          x: mesh.quaternion.x,
          y: mesh.quaternion.y,
          z: mesh.quaternion.z,
          w: mesh.quaternion.w,
        })
        .setLinearDamping(0.02)
        .setAngularDamping(0.02);
      const rb = this.world.createRigidBody(rbDesc);

      const colDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setRestitution(0.2)
        .setFriction(0.6);
      this.world.createCollider(colDesc, rb);

      rb.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

      this.activeChunks.push({ mesh, rb });
    }

    // Remove the now-empty container group
    this.scene.remove(chunksGroup);
  }

  update() {
    if (!this.world) return;
    for (const { mesh, rb } of this.activeChunks) {
      const t = rb.translation();
      const r = rb.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
