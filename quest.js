import * as THREE from "three";
import { CHARACTER_MOVEMENT } from "./characters/CharacterBase.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { FriendlyCharacter } from "./characters/FriendlyCharacter.js";
import { getTerrainHeight } from "./environment/water.js";
import { ATTACKS } from "./items/melee.js";

const QUEST_FRIEND_MODEL = "/models/cowboy.fbx";
const QUEST_FRIEND_SPAWN_MIN_DISTANCE = 18;
const QUEST_FRIEND_SPAWN_MAX_DISTANCE = 32;
const QUEST_FRIEND_REACH_DISTANCE = 4.5;
const QUEST_FRIEND_APPROACH_STOP_DISTANCE = 5.5;
const QUEST_FRIEND_APPROACH_SPEED_MULTIPLIER = 1.25;
const QUEST_DISTANCE_SPAWN_MIN_TRAVEL = 45;
const QUEST_DISTANCE_SPAWN_MAX_TRAVEL = 105;
const QUEST_DISTANCE_MAX_STEP = 14;
const QUEST_DISTANCE_MAX_SPEED = 20;
const QUEST_VIEW_APPROACH_MIN_DISTANCE = 12;
const QUEST_VIEW_APPROACH_MAX_DISTANCE = 20;
const QUEST_RETURN_DISTANCE = 6;
const QUEST_FOLLOW_STOP_DISTANCE = 2.2;
const QUEST_LEAD_PLAYER_DISTANCE = 10;
const QUEST_LEAD_REACH_DISTANCE = 2.4;
const QUEST_LEAD_MUSHROOM_DISTANCE = 1.8;
const QUEST_FIGHT_DISENGAGE_DISTANCE = 14;
const QUEST_TRAIL_SEGMENT_LENGTH = 2.2;
const QUEST_TRAIL_SEGMENT_GAP = 1.4;
const QUEST_TRAIL_HEIGHT_OFFSET = 0.15;
const QUEST_TRAIL_MAX_SEGMENTS = 80;
const QUEST_TRAIL_COLOR = 0xffd84d;
const QUEST_FIND_FRIEND_XP = 25;
const QUEST_FRIEND_MONSTER_BONUS_XP = 50;
const QUEST_MUSHROOM_XP = 15;
const QUEST_RETURN_FRIEND_XP = 50;

const QUEST_OFFER_DIALOGUE = {
  blocks: [
    "Can you help me?",
    "My friend went out to fight zombies and hasn't returned. Can you find them?"
  ],
  responses: [
    {
      label: "I'll help find them.",
      reply: "Thank you! I'll wait right here.",
      onSelect: "acceptQuest"
    },
    {
      label: "Not right now.",
      reply: "I understand. Stay safe out there."
    }
  ]
};

const QUEST_FRIEND_DIALOGUE = {
  blocks: [
    "Thanks for saving me!",
    "Do you want to fight zombies, collect mushrooms, or head back to my friend?"
  ],
  responses: [
    {
      label: "Fight zombies.",
      reply: "Let's hunt some zombies together.",
      onSelect: "fightZombies"
    },
    {
      label: "Collect mushrooms.",
      reply: "I'll guide us to the closest mushrooms.",
      onSelect: "collectMushrooms"
    },
    {
      label: "Return to your friend.",
      reply: "Let's get back to them.",
      onSelect: "returnToFriend"
    },
    {
      label: "Maybe later.",
      reply: "No worries. I'll wait here."
    }
  ]
};

export class QuestManager {
  constructor({
    scene,
    getPlayerModel,
    attachPhysics,
    detachPhysics,
    addXp,
    getMonsterXpForLevel
  }) {
    this.scene = scene;
    this.getPlayerModel = getPlayerModel;
    this.attachPhysics = attachPhysics;
    this.detachPhysics = detachPhysics;
    this.addXp = addXp;
    this.getMonsterXpForLevel = getMonsterXpForLevel;
    this.state = {
      status: "inactive",
      giver: null,
      giverPosition: null,
      friend: null,
      friendFollowing: false,
      trail: null,
      trailMode: null,
      pendingSpawn: false,
      friendMode: "idle",
      friendTarget: null,
      friendTargetType: null
    };
    this.deltaSeconds = 0;
    this.travelSpawn = {
      active: false,
      progress: 0,
      nextDistance: 0,
      lastPlayerPosition: null,
      spawnMode: "search"
    };
  }

  setDeltaSeconds(deltaSeconds) {
    this.deltaSeconds = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
  }

  getQuestFriend() {
    return this.state.friend;
  }

  isQuestFriend(friendly) {
    return this.state.friend === friendly;
  }

  isFriendActive() {
    return !!this.state.friend && this.state.status !== "inactive";
  }

  shouldOfferQuest(friendly) {
    if (!friendly) return false;
    if (this.isQuestFriend(friendly)) return false;
    return this.state.status === "inactive";
  }

  getDialogueForFriendly(friendly, dialoguePool) {
    if (this.isQuestFriend(friendly)) {
      return QUEST_FRIEND_DIALOGUE;
    }
    if (this.shouldOfferQuest(friendly)) {
      return QUEST_OFFER_DIALOGUE;
    }
    if (!Array.isArray(dialoguePool) || dialoguePool.length === 0) {
      return null;
    }
    return dialoguePool[Math.floor(Math.random() * dialoguePool.length)];
  }

  handleDialogueOption(option, giver) {
    if (!option || !option.onSelect) return;
    if (option.onSelect === "acceptQuest") {
      this.acceptQuest(giver);
    }
    if (option.onSelect === "startEscort") {
      this.startQuestEscort();
    }
    if (option.onSelect === "returnToFriend") {
      this.startQuestEscort();
    }
    if (option.onSelect === "fightZombies") {
      this.startQuestFriendlyLead("monster");
    }
    if (option.onSelect === "collectMushrooms") {
      this.startQuestFriendlyLead("mushroom");
    }
  }

  acceptQuest(giver) {
    const playerModel = this.getPlayerModel?.();
    if (!giver || !playerModel) return;
    if (this.state.status !== "inactive") return;
    this.state.status = "searching";
    this.state.giver = giver;
    this.state.giverPosition = giver.model?.position?.clone?.() || null;
    this.state.friendMode = "idle";
    this.state.friendTarget = null;
    this.state.friendTargetType = null;
    this.startQuestDistanceSpawn("search");
  }

  getNextQuestSpawnDistance() {
    return QUEST_DISTANCE_SPAWN_MIN_TRAVEL
      + Math.random() * (QUEST_DISTANCE_SPAWN_MAX_TRAVEL - QUEST_DISTANCE_SPAWN_MIN_TRAVEL);
  }

  isPlayerTravelAnimationActive() {
    const action = this.getPlayerModel?.()?.userData?.currentAction;
    return action === "walk" || action === "run";
  }

  startQuestDistanceSpawn(mode = "search") {
    const playerModel = this.getPlayerModel?.();
    this.travelSpawn.active = true;
    this.travelSpawn.progress = 0;
    this.travelSpawn.nextDistance = this.getNextQuestSpawnDistance();
    this.travelSpawn.lastPlayerPosition = playerModel?.position?.clone?.() || null;
    this.travelSpawn.spawnMode = mode;
  }

  stopQuestDistanceSpawn() {
    this.travelSpawn.active = false;
    this.travelSpawn.progress = 0;
    this.travelSpawn.nextDistance = 0;
    this.travelSpawn.lastPlayerPosition = null;
  }

  updateQuestDistanceSpawn(playerModel) {
    if (!this.travelSpawn.active || !playerModel || this.state.pendingSpawn || this.state.friend) {
      return;
    }
    if (!this.travelSpawn.lastPlayerPosition) {
      this.travelSpawn.lastPlayerPosition = playerModel.position.clone();
      return;
    }
    const frameDistance = playerModel.position.distanceTo(this.travelSpawn.lastPlayerPosition);
    this.travelSpawn.lastPlayerPosition.copy(playerModel.position);
    if (!this.isPlayerTravelAnimationActive()) return;
    if (!Number.isFinite(frameDistance) || frameDistance <= 0 || frameDistance > QUEST_DISTANCE_MAX_STEP) return;
    const speed = this.deltaSeconds > 0 ? frameDistance / this.deltaSeconds : 0;
    if (Number.isFinite(speed) && speed > QUEST_DISTANCE_MAX_SPEED) return;
    this.travelSpawn.progress += frameDistance;
    if (this.travelSpawn.progress < this.travelSpawn.nextDistance) return;
    const mode = this.travelSpawn.spawnMode || "search";
    this.stopQuestDistanceSpawn();
    this.spawnQuestFriend(mode);
  }

  spawnQuestFriend(mode = "search") {
    const playerModel = this.getPlayerModel?.();
    if (this.state.pendingSpawn || !playerModel) return;
    this.state.pendingSpawn = true;
    const basePos = playerModel.position.clone();
    const angle = Math.random() * Math.PI * 2;
    const isViewMode = mode === "view";
    const minDistance = isViewMode ? QUEST_VIEW_APPROACH_MIN_DISTANCE : QUEST_FRIEND_SPAWN_MIN_DISTANCE;
    const maxDistance = isViewMode ? QUEST_VIEW_APPROACH_MAX_DISTANCE : QUEST_FRIEND_SPAWN_MAX_DISTANCE;
    const distance = minDistance + Math.random() * (maxDistance - minDistance);
    const spawnPos = new THREE.Vector3(
      basePos.x + Math.cos(angle) * distance,
      basePos.y,
      basePos.z + Math.sin(angle) * distance
    );
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    if (Number.isFinite(terrainHeight)) {
      spawnPos.y = terrainHeight + 0.5;
    }
    loadMonsterModel(QUEST_FRIEND_MODEL, (data) => {
      try {
        const questFriend = new FriendlyCharacter(data);
        questFriend.id = `quest-friend-${Date.now()}`;
        questFriend.modelPath = QUEST_FRIEND_MODEL;
        questFriend.type = QUEST_FRIEND_MODEL;
        questFriend.model.userData.hideInMapView = true;
        questFriend.model.userData.isQuestFriend = true;
        questFriend.setNoticeRadius(0);
        questFriend.setWanderRadius(0);
        questFriend.setEngageRadius(0);
        questFriend.setDisengageRadius(0);
        questFriend.setLevel(1, { preserveHealth: false });
        questFriend.resetHealth();
        questFriend.setPosition(spawnPos.x, spawnPos.y, spawnPos.z);
        questFriend.setHomePosition(spawnPos.clone());
        this.scene?.add(questFriend.model);
        this.attachPhysics?.(questFriend);
        this.state.friend = questFriend;
        this.state.trailMode = "toFriend";
        if (isViewMode) {
          questFriend.model.userData.approachToPlayer = true;
          questFriend.model.userData.questApproachMode = "view";
        } else {
          questFriend.model.userData.approachToPlayer = true;
          questFriend.model.userData.questApproachMode = "search";
        }
      } finally {
        this.state.pendingSpawn = false;
      }
    });
  }

  startQuestEscort() {
    if (this.state.status !== "found" && this.state.status !== "searching") {
      return;
    }
    if (!this.state.friend || !this.state.giverPosition) return;
    this.state.status = "escorting";
    this.state.friendFollowing = true;
    this.state.friendMode = "idle";
    this.state.friendTarget = null;
    this.state.friendTargetType = null;
    this.state.trailMode = "toGiver";
  }

  completeQuest() {
    this.state.status = "inactive";
    this.state.friendFollowing = false;
    this.state.friendMode = "idle";
    this.state.friendTarget = null;
    this.state.friendTargetType = null;
    this.state.trailMode = null;
    this.clearQuestTrail();
    const friend = this.state.friend;
    if (friend?.body) {
      const vel = friend.body.linvel();
      friend.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
    }
    if (friend?.model) {
      friend.model.removeFromParent?.();
      this.scene?.remove(friend.model);
    }
    this.detachPhysics?.(friend);
    this.addXp?.(QUEST_RETURN_FRIEND_XP);
    this.state.giver = null;
    this.state.giverPosition = null;
    this.state.friend = null;
    this.stopQuestDistanceSpawn();
  }

  handleMushroomCollected(pickup) {
    if (!pickup) return;
    if (this.state.status !== "found") return;
    if (this.state.friendTargetType !== "mushroom") return;
    if (this.state.friendTarget !== pickup) return;
    this.addXp?.(QUEST_MUSHROOM_XP);
    this.setQuestFriendIdle(this.state.friend);
  }

  update() {
    const playerModel = this.getPlayerModel?.();
    const quest = this.state;
    if (!quest || !playerModel) return;
    const friend = quest.friend;

    this.updateQuestDistanceSpawn(playerModel);

    if (quest.status === "searching" && friend?.model) {
      const distanceToFriend = playerModel.position.distanceTo(friend.model.position);
      this.updateQuestTrail(playerModel.position, friend.model.position);
      this.updateQuestFriendApproach(friend);
      if (distanceToFriend <= QUEST_FRIEND_REACH_DISTANCE) {
        quest.status = "found";
        quest.friendMode = "idle";
        quest.friendTarget = null;
        quest.friendTargetType = null;
        quest.trailMode = null;
        this.clearQuestTrail();
        this.addXp?.(QUEST_FIND_FRIEND_XP);
      }
      friend.update(this.deltaSeconds);
      return;
    }

    if (quest.status === "escorting" && friend?.model && quest.giverPosition) {
      const giverTarget = quest.giver?.model?.position ?? quest.giverPosition;
      this.updateQuestTrail(playerModel.position, giverTarget);
      this.updateQuestFriendFollow(friend);
      const playerNearGiver = playerModel.position.distanceTo(giverTarget) <= QUEST_RETURN_DISTANCE;
      const friendNearGiver = friend.model.position.distanceTo(giverTarget) <= QUEST_RETURN_DISTANCE;
      if (playerNearGiver && friendNearGiver) {
        this.completeQuest();
      }
      friend.update(this.deltaSeconds);
      return;
    }

    if (quest.status === "found" && friend?.model) {
      this.updateQuestFriendApproach(friend);
      this.updateQuestFriendActivity(friend);
      return;
    }
  }

  updateQuestFriendApproach(friend) {
    if (!friend?.body || !friend?.model?.userData?.approachToPlayer) return;
    const playerModel = this.getPlayerModel?.();
    if (!playerModel) return;
    const toPlayer = playerModel.position.clone().sub(friend.model.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const vel = friend.body.linvel();
    if (distance <= QUEST_FRIEND_APPROACH_STOP_DISTANCE) {
      friend.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      friend.model.userData.approachToPlayer = false;
      return;
    }
    const direction = toPlayer.normalize();
    const speed = CHARACTER_MOVEMENT.runSpeed * QUEST_FRIEND_APPROACH_SPEED_MULTIPLIER;
    friend.setDirection(direction);
    friend.body.setLinvel({ x: direction.x * speed, y: vel.y, z: direction.z * speed }, true);
    const angle = Math.atan2(direction.x, direction.z);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    friend.body.setRotation(rot, true);
    friend.playAnimation("Run", 0.2);
  }

  updateQuestFriendFollow(friend) {
    const playerModel = this.getPlayerModel?.();
    if (!friend?.body || !playerModel) return;
    const toPlayer = playerModel.position.clone().sub(friend.model.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const vel = friend.body.linvel();
    if (distance > QUEST_FOLLOW_STOP_DISTANCE) {
      const direction = toPlayer.normalize();
      const speed = CHARACTER_MOVEMENT.runSpeed * 0.85;
      friend.setDirection(direction);
      friend.body.setLinvel({ x: direction.x * speed, y: vel.y, z: direction.z * speed }, true);
      const angle = Math.atan2(direction.x, direction.z);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      friend.body.setRotation(rot, true);
      friend.playAnimation("Walk", 0.2);
    } else {
      friend.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      friend.playAnimation("Idle", 0.2);
    }
  }

  updateQuestFriendActivity(friend) {
    if (!friend?.body) return;
    const mode = this.state.friendMode || "idle";
    if (mode === "leading") {
      const target = this.state.friendTarget;
      const targetType = this.state.friendTargetType;
      const targetPosition = this.getQuestTargetPosition(target, targetType);
      if (!targetPosition) {
        this.setQuestFriendIdle(friend);
        return;
      }
      const reachDistance = targetType === "mushroom"
        ? QUEST_LEAD_MUSHROOM_DISTANCE
        : QUEST_LEAD_REACH_DISTANCE;
      const reached = this.updateQuestFriendLeadMode(friend, targetPosition, reachDistance);
      friend.update(this.deltaSeconds);
      if (reached) {
        if (targetType === "monster") {
          this.state.friendMode = "fighting";
          this.state.friendTarget = target;
          this.state.friendTargetType = "monster";
          friend.attackDamage = ATTACKS.mutantPunch.damage;
        } else {
          this.setQuestFriendIdle(friend);
        }
      }
      return;
    }

    if (mode === "fighting") {
      const target = this.state.friendTarget;
      if (!this.isValidQuestTarget(target, "monster")) {
        this.setQuestFriendIdle(friend);
        return;
      }
      const distanceToTarget = friend.model.position.distanceTo(target.model.position);
      if (distanceToTarget > QUEST_FIGHT_DISENGAGE_DISTANCE || target.isDead) {
        this.setQuestFriendIdle(friend);
        return;
      }
      friend.updateCombatAI(this.deltaSeconds, target, [target], (hitTarget, info) => {
        if (!hitTarget?.model || hitTarget.isDead) return;
        const died = hitTarget.applyDamage?.(friend.attackDamage) ?? false;
        if (info?.strength && hitTarget.applyKnockback) {
          hitTarget.applyKnockback({ direction: info.direction, strength: info.strength });
        }
        if (died) {
          const targetLevel = Number.isFinite(hitTarget.level) ? hitTarget.level : 1;
          const baseXp = this.getMonsterXpForLevel?.(targetLevel) ?? 0;
          this.addXp?.(baseXp + QUEST_FRIEND_MONSTER_BONUS_XP);
          this.setQuestFriendIdle(friend);
        }
      });
      return;
    }

    this.setQuestFriendIdle(friend);
  }

  setQuestFriendIdle(friend) {
    if (friend?.body) {
      const vel = friend.body.linvel();
      friend.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
    }
    friend?.playAnimation?.("Idle", 0.2);
    friend?.update?.(this.deltaSeconds);
    this.state.friendMode = "idle";
    this.state.friendTarget = null;
    this.state.friendTargetType = null;
  }

  getQuestTargetPosition(target, targetType) {
    if (targetType === "monster") {
      if (!this.isValidQuestTarget(target, targetType)) return null;
      return target.model.position.clone();
    }
    if (targetType === "mushroom") {
      if (!target?.mesh || !target.mesh.visible) return null;
      return target.mesh.position.clone();
    }
    return null;
  }

  isValidQuestTarget(target, targetType) {
    if (targetType === "monster") {
      return !!(target?.model && !target.isDead);
    }
    return false;
  }

  updateQuestFriendLeadMode(friend, targetPosition, reachDistance) {
    const playerModel = this.getPlayerModel?.();
    if (!playerModel || !friend?.body || !targetPosition) return false;
    const toPlayer = playerModel.position.clone().sub(friend.model.position);
    toPlayer.y = 0;
    const distanceToPlayer = toPlayer.length();
    const vel = friend.body.linvel();
    if (distanceToPlayer > QUEST_LEAD_PLAYER_DISTANCE) {
      const direction = toPlayer.normalize();
      const angle = Math.atan2(direction.x, direction.z);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      friend.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      friend.body.setRotation(rot, true);
      friend.playAnimation("Idle", 0.2);
      return false;
    }

    const toTarget = targetPosition.clone().sub(friend.model.position);
    toTarget.y = 0;
    const distanceToTarget = toTarget.length();
    if (distanceToTarget <= reachDistance) {
      friend.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      friend.playAnimation("Idle", 0.2);
      return true;
    }
    const direction = toTarget.normalize();
    const speed = CHARACTER_MOVEMENT.runSpeed * 0.8;
    friend.setDirection(direction);
    friend.body.setLinvel({ x: direction.x * speed, y: vel.y, z: direction.z * speed }, true);
    const angle = Math.atan2(direction.x, direction.z);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    friend.body.setRotation(rot, true);
    friend.playAnimation("Walk", 0.2);
    return false;
  }

  startQuestFriendlyLead(targetType) {
    if (this.state.status !== "found") return;
    const friend = this.state.friend;
    if (!friend?.model) return;
    let target = null;
    if (targetType === "monster") {
      target = this.getClosestMonster(friend.model.position);
    }
    if (targetType === "mushroom") {
      target = this.getClosestMushroom(friend.model.position);
    }
    if (!target) {
      this.setQuestFriendIdle(friend);
      return;
    }
    if (targetType === "mushroom") {
      this.state.status = "searching";
      this.state.friendMode = "idle";
      this.state.friendTarget = null;
      this.state.friendTargetType = null;
      if (friend?.model) {
        friend.model.removeFromParent?.();
        this.scene?.remove(friend.model);
      }
      this.detachPhysics?.(friend);
      this.state.friend = null;
      this.startQuestDistanceSpawn("view");
      this.clearQuestTrail();
      return;
    }
    this.state.friendMode = "leading";
    this.state.friendTarget = target;
    this.state.friendTargetType = targetType;
  }

  getClosestMonster(position) {
    if (!position) return null;
    const monsters = Array.isArray(window.monsters) ? window.monsters : [];
    let closest = null;
    let closestDistance = Infinity;
    monsters.forEach((monster) => {
      if (!monster?.model || monster.isDead) return;
      const dist = position.distanceTo(monster.model.position);
      if (dist < closestDistance) {
        closestDistance = dist;
        closest = monster;
      }
    });
    return closest;
  }

  getClosestMushroom(position) {
    if (!position) return null;
    const pickups = Array.isArray(window.mushroomPickups) ? window.mushroomPickups : [];
    let closest = null;
    let closestDistance = Infinity;
    pickups.forEach((pickup) => {
      if (!pickup?.mesh || !pickup.mesh.visible) return;
      const dist = position.distanceTo(pickup.mesh.position);
      if (dist < closestDistance) {
        closestDistance = dist;
        closest = pickup;
      }
    });
    return closest;
  }

  updateQuestTrail(start, end) {
    if (!start || !end) return;
    const direction = new THREE.Vector3().subVectors(end, start);
    const distance = direction.length();
    if (distance < 0.5) {
      this.clearQuestTrail();
      return;
    }
    if (!this.state.trail) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.LineBasicMaterial({ color: QUEST_TRAIL_COLOR, transparent: true, opacity: 0.9 });
      const line = new THREE.LineSegments(geometry, material);
      line.frustumCulled = false;
      this.scene?.add(line);
      this.state.trail = { geometry, material, line };
    }

    const normalized = direction.normalize();
    const segmentSpan = QUEST_TRAIL_SEGMENT_LENGTH + QUEST_TRAIL_SEGMENT_GAP;
    const segmentCount = Math.min(
      QUEST_TRAIL_MAX_SEGMENTS,
      Math.max(1, Math.floor(distance / segmentSpan))
    );
    const positions = [];
    for (let i = 0; i < segmentCount; i += 1) {
      const segmentStart = i * segmentSpan;
      const segmentEnd = Math.min(segmentStart + QUEST_TRAIL_SEGMENT_LENGTH, distance);
      const startPoint = start.clone().addScaledVector(normalized, segmentStart);
      const endPoint = start.clone().addScaledVector(normalized, segmentEnd);
      const startHeight = getTerrainHeight(startPoint.x, startPoint.z);
      const endHeight = getTerrainHeight(endPoint.x, endPoint.z);
      if (Number.isFinite(startHeight)) {
        startPoint.y = startHeight + QUEST_TRAIL_HEIGHT_OFFSET;
      }
      if (Number.isFinite(endHeight)) {
        endPoint.y = endHeight + QUEST_TRAIL_HEIGHT_OFFSET;
      }
      positions.push(
        startPoint.x, startPoint.y, startPoint.z,
        endPoint.x, endPoint.y, endPoint.z
      );
    }
    const geometry = this.state.trail.geometry;
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    this.state.trail.line.visible = true;
  }

  clearQuestTrail() {
    const trail = this.state?.trail;
    if (!trail) return;
    trail.line.visible = false;
  }
}

export { QUEST_FRIEND_DIALOGUE, QUEST_OFFER_DIALOGUE };
