import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";

export class Spaceship {
  constructor(scene, world, rbToMesh) {
    this.scene = scene;
    this.world = world;
    this.rbToMesh = rbToMesh;
    this.mesh = null;
    this.body = null;
    this.occupant = null; // PlayerControls instance
    this.mountOffset = new THREE.Vector3(0, 1, 0);
    this.locked = false;
    this.halfHeight = 0;
    this.wings = [];
    this.thrusterGroup = null;
    this.fireSprite = null;
    this.smokeSprite = null;
    this.thrusting = false;
    this.type = 'spaceship';
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('/assets/props/mother_spaceship.glb');
    const ship = gltf.scene;
    const scale = 0.7;
    ship.scale.set(scale, scale, scale);
    ship.position.set(1, 5, 20);

    // Add mesh and update transforms
    this.mesh = ship;
    this.scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);

    // Find wings for wind-force calculations
    this.wings = [];
    this.mesh.traverse((child) => {
      if (child.isMesh && /wing/i.test(child.name)) {
        this.wings.push(child);
      }
    });

    // Compute world-space AABB
    const bbox = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    // Store size and center offset for camera calculations
    this.boundingSize = size.clone();
    this.boundingCenterOffset = new THREE.Vector3().subVectors(center, ship.position);

    // Create physics body centered on mesh
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(ship.position.x, ship.position.y, ship.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5)
      .setGravityScale(1.6);
    this.body = this.world.createRigidBody(rbDesc);

    // Build a triangle-mesh collider from the spaceship geometry so the
    // collider matches the visible model and leaves the doorway open.
    const vertices = [];
    const indices = [];
    let indexOffset = 0;
    const v = new THREE.Vector3();

    ship.updateMatrixWorld(true);
    ship.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const pos = child.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(child.matrixWorld);
        v.sub(center);
        vertices.push(v.x, v.y, v.z);
      }

      const geomIndex = child.geometry.index;
      if (geomIndex) {
        for (let i = 0; i < geomIndex.count; i++) {
          indices.push(geomIndex.array[i] + indexOffset);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          indices.push(i + indexOffset);
        }
      }
      indexOffset += pos.count;
    });

    const offset = new THREE.Vector3().subVectors(center, ship.position);
    const colDesc = RAPIER.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices)
    )
      .setTranslation(offset.x, offset.y, offset.z)
      .setRestitution(0)
      .setFriction(1);
    this.world.createCollider(colDesc, this.body);

    // Add a dense collider at the bottom of the ship so the center of
    // mass lies below the geometric center.  This makes the ship more
    // stable while falling and encourages it to remain upright instead
    // of flipping onto its back.
    const ballastHeight = size.y * 0.2;
    const ballastDesc = RAPIER.ColliderDesc.cuboid(
      size.x * 0.2,
      ballastHeight * 0.5,
      size.z * 0.2
    )
      .setTranslation(
        offset.x,
        offset.y - size.y * 0.5 + ballastHeight * 0.5,
        offset.z
      )
      .setDensity(30);
    this.world.createCollider(ballastDesc, this.body);

    // Register with global rigid-body map so physics sync updates the mesh
    this.rbToMesh?.set(this.body, this.mesh);

    // Mount point on top of the box
    this.mountOffset.set(0, size.y * 0.5 - 2, 0);
    this.halfHeight = size.y * 0.5;

    this.createThrusterEffects(size);
  }

  createThrusterEffects(size) {
    // Create simple radial textures for fire and smoke using canvas
    const createRadialTexture = (inner, outer) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.height = 64;
      const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, inner);
      grd.addColorStop(1, outer);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(canvas);
    };

    this.thrusterGroup = new THREE.Group();
    this.thrusterGroup.position.set(0, 0, -size.z * 0.5);
    this.mesh.add(this.thrusterGroup);

    const fireTex = createRadialTexture('rgba(255,255,0,1)', 'rgba(255,0,0,0)');
    const smokeTex = createRadialTexture('rgba(80,80,80,0.5)', 'rgba(80,80,80,0)');

    this.fireSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: fireTex, transparent: true, blending: THREE.AdditiveBlending })
    );
    this.smokeSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false })
    );

    this.fireSprite.scale.set(8, 8, 8);
    this.smokeSprite.scale.set(12, 12, 12);
    this.smokeSprite.position.z -= 2.5;

    this.thrusterGroup.add(this.smokeSprite);
    this.thrusterGroup.add(this.fireSprite);
    this.thrusterGroup.visible = false;
  }

  update() {
    if (this.occupant) {
      const top = this.mesh.position.clone().add(this.mountOffset);
      const player = this.occupant.playerModel;
      player.position.copy(top);
      if (this.occupant.body) {
        this.occupant.body.setTranslation(top, true);
        this.occupant.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    if (this.body) {
      const vel = this.body.linvel();
      const speed = Math.hypot(vel.x, vel.y, vel.z);
      const onGround = this.body.translation().y - this.halfHeight <= 0.05;
      if (onGround && speed < 0.1) {
        if (!this.locked) {
          this.locked = true;
          this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          this.body.sleep();
        }
      } else if (this.locked && speed > 0.1) {
        this.locked = false;
        this.body.wakeUp();
      }
      this.autoStabilizeAndDrift();

    }

    // this.applyWindForces();
  }

  autoStabilizeAndDrift() {
    if (!this.body) return;
    const rot = this.body.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const dt = this.world?.integrationParameters?.dt ?? 1 / 60;

    // Level the ship toward world-up
    const worldUp = new THREE.Vector3(0, 1, 0);
    const levelAxis = new THREE.Vector3().crossVectors(up, worldUp);
    const levelAmount = levelAxis.length();
    if (levelAmount > 0.0001) {
      levelAxis.normalize();
      let strength = 5 * this.body.mass() * dt;
      if (this.thrusting) strength *= 2;
      const torque = levelAxis.multiplyScalar(strength);
      this.body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
    }

    // Apply yaw torque based on roll (downward wing)
    if (Math.abs(right.y) > 0.01) {
      let yawStrength = 2 * this.body.mass() * dt;
      if (this.thrusting) yawStrength *= 2;
      const yawTorque = -right.y * yawStrength;
      this.body.applyTorqueImpulse({ x: 0, y: yawTorque, z: 0 }, true);
    }

    // Lateral movement based on roll
    const lateral = new THREE.Vector3(up.x, 0, up.z);
    if (lateral.lengthSq() > 1e-5) {
      lateral.normalize();
      let forceMag = this.thrusting ? 40 : 20;
      const force = lateral.multiplyScalar(forceMag);
      this.body.applyTorqueImpulse({ x: force.x, y: force.y, z: force.z }, true);
    }

    // Forward/backward movement based on pitch
    const planarForward = new THREE.Vector3(forward.x, 0, forward.z);
    if (planarForward.lengthSq() > 1e-5) {
      planarForward.normalize();
      if (forward.y < -0.01) {
        let forceMag = Math.abs(forward.y) * (this.thrusting ? 40 : 20);
        const force = planarForward.clone().multiplyScalar(forceMag);
        this.body.applyTorqueImpulse({ x: force.x, y: force.y, z: force.z }, true);
      } else if (forward.y > 0.01 && !this.thrusting) {
        const vel = this.body.linvel();
        const velVec = new THREE.Vector3(vel.x, 0, vel.z);
        if (velVec.dot(planarForward) <= 0) {
          let forceMag = forward.y * 20;
          const force = planarForward.clone().multiplyScalar(-forceMag);
          this.body.applyTorqueImpulse({ x: force.x, y: force.y, z: force.z }, true);
        }
      }
    }
  }

  applyWindForces() {
    if (!this.body || this.wings.length === 0) return;

    const linvel = this.body.linvel();
    const velocity = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const speed = velocity.length();
    if (speed < 0.1) return;

    const dt = this.world?.integrationParameters?.dt ?? 1 / 60;
    const windDir = velocity.clone().normalize();
    const bodyPos = this.body.translation();
    const shipPos = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z);
    const forceCoeff = 0.001;

    for (const wing of this.wings) {
      const wingPos = wing.getWorldPosition(new THREE.Vector3());
      const wingQuat = wing.getWorldQuaternion(new THREE.Quaternion());
      const wingNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(wingQuat).normalize();
      const facing = windDir.dot(wingNormal);
      if (Math.abs(facing) < 0.01) continue;

      const forceMag = -facing * speed * speed * forceCoeff;
      const force = wingNormal.clone().multiplyScalar(forceMag);

      const impulse = force.clone().multiplyScalar(dt);
      this.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

      const r = wingPos.sub(shipPos);
      const torque = r.clone().cross(force).multiplyScalar(dt);
      this.body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
    }
  }

  tryMount(playerControls) {
    if (this.occupant || !playerControls?.playerModel || !this.mesh) return;
    const dist = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (dist < 10) {
      this.occupant = playerControls;
      playerControls.vehicle = this;
    }
  }

  applyInput(input) {
    if (!this.body || !this.mesh) return;
    this.thrusting = input.thrust;
    const rotationStrength = 15;

    // Handle rotation using Rapier torque impulses.  Apply torque along the
    // ship's local axes so the direction of rotation always matches the
    // ship's current forward orientation.  Also wake the body if it was
    // previously put to sleep while sitting on the ground.
    if (input.yaw !== 0 || input.pitch !== 0) {
      if (this.locked) {
        this.locked = false;
        this.body.wakeUp();
      }

      const dt = this.world?.integrationParameters?.dt ?? 1 / 60;
      const torqueImpulse = rotationStrength * this.body.mass() * dt;

      // Determine the ship's local axes in world space.
      const rot = this.body.rotation();
      const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);

      const torque = new THREE.Vector3();
      torque.add(right.clone().multiplyScalar(-input.pitch * torqueImpulse));
      torque.add(up.clone().multiplyScalar(input.yaw * torqueImpulse));

      this.body.applyTorqueImpulse(
        { x: torque.x, y: torque.y, z: torque.z },
        true
      );
    }

    // Apply forward thrust along the ship's current forward direction.
    // The rigid body representing the ship is extremely heavy because its
    // mass is derived from the large triangle-mesh collider.  Using a small
    // constant impulse therefore has almost no visible effect.  Scale the
    // impulse by the body's mass and timestep so activating thrust produces a
    // noticeable forward acceleration regardless of the ship's weight.
    if (input.thrust) {
      if (this.locked) {
        this.locked = false;
        this.body.wakeUp();
      }

      // Determine the ship's forward direction in world space.
      const forward = new THREE.Vector3(0, 0, 1);
      const rot = this.body.rotation();
      forward.applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));

      // Compute an impulse that results in a reasonable acceleration.  Use the
      // physics timestep if available (defaulting to 60 Hz) so the result is
      // frame-rate independent.
      const dt = this.world?.integrationParameters?.dt ?? 1 / 60;
      const acceleration = 10; // units per second squared
      const impulseMagnitude = 4 * this.body.mass() * acceleration * dt;

      this.body.applyImpulse(
        {
          x: forward.x * impulseMagnitude,
          y: forward.y * impulseMagnitude,
          z: forward.z * impulseMagnitude,
        },
        true
      );

      if (this.thrusterGroup) {
        this.thrusterGroup.visible = true;
      }
    } else if (this.thrusterGroup) {
      this.thrusterGroup.visible = false;
    }
  }

  dismount() {
    if (!this.occupant) return;
    const playerControls = this.occupant;
    let top = new THREE.Vector3();
    if (this.mesh) {
      this.mesh.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(this.mesh);
      top.set(
        (bbox.min.x + bbox.max.x) / 2,
        bbox.max.y + 4,
        (bbox.min.z + bbox.max.z) / 2
      );
    }
    if (playerControls.playerModel) {
      playerControls.playerModel.position.copy(top);
    }
    if (playerControls.body) {
      playerControls.body.setTranslation(top, true);
      if (this.body) {
        const vel = this.body.linvel();
        playerControls.body.setLinvel(vel, true);
      }
    }
    playerControls.deployParachute?.();
    playerControls.vehicle = null;
    this.occupant = null;
  }
}
