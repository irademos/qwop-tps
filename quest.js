import * as THREE from "three";
import { CHARACTER_MOVEMENT } from "./characters/CharacterBase.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { FriendlyCharacter } from "./characters/FriendlyCharacter.js";
import { getTerrainHeight } from "./environment/water.js";

const QUEST_FRIEND_MODEL = "/models/cowboy.fbx";
const QUEST_FRIEND_SPAWN_MIN_DISTANCE = 18;
const QUEST_FRIEND_SPAWN_MAX_DISTANCE = 32;
const QUEST_FRIEND_REACH_DISTANCE = 4.5;
const QUEST_RETURN_DISTANCE = 6;
const QUEST_FOLLOW_STOP_DISTANCE = 2.2;
const QUEST_TRAIL_SEGMENT_LENGTH = 2.2;
const QUEST_TRAIL_SEGMENT_GAP = 1.4;
const QUEST_TRAIL_HEIGHT_OFFSET = 0.15;
const QUEST_TRAIL_MAX_SEGMENTS = 80;
const QUEST_TRAIL_COLOR = 0xffd84d;

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
    "Thank you for saving me! Can you show me the way back?"
  ],
  responses: [
    {
      label: "Follow me.",
      reply: "Lead the way!",
      onSelect: "startEscort"
    },
    {
      label: "I'll come back later.",
      reply: "Okay, I'll wait here and catch my breath."
    }
  ]
};

export class QuestManager {
  constructor({
    scene,
    getPlayerModel,
    attachPhysics,
    detachPhysics,
    adjustPlayerLevel
  }) {
    this.scene = scene;
    this.getPlayerModel = getPlayerModel;
    this.attachPhysics = attachPhysics;
    this.detachPhysics = detachPhysics;
    this.adjustPlayerLevel = adjustPlayerLevel;
    this.state = {
      status: "inactive",
      giver: null,
      giverPosition: null,
      friend: null,
      friendFollowing: false,
      trail: null,
      trailMode: null,
      pendingSpawn: false
    };
    this.deltaSeconds = 0;
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
  }

  acceptQuest(giver) {
    const playerModel = this.getPlayerModel?.();
    if (!giver || !playerModel) return;
    if (this.state.status !== "inactive") return;
    this.state.status = "searching";
    this.state.giver = giver;
    this.state.giverPosition = giver.model?.position?.clone?.() || null;
    this.spawnQuestFriend();
  }

  spawnQuestFriend() {
    const playerModel = this.getPlayerModel?.();
    if (this.state.pendingSpawn || !playerModel) return;
    this.state.pendingSpawn = true;
    const basePos = playerModel.position.clone();
    const angle = Math.random() * Math.PI * 2;
    const distance = QUEST_FRIEND_SPAWN_MIN_DISTANCE
      + Math.random() * (QUEST_FRIEND_SPAWN_MAX_DISTANCE - QUEST_FRIEND_SPAWN_MIN_DISTANCE);
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
    this.state.trailMode = "toGiver";
  }

  completeQuest() {
    this.state.status = "inactive";
    this.state.friendFollowing = false;
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
    this.adjustPlayerLevel?.(1);
    this.state.giver = null;
    this.state.giverPosition = null;
    this.state.friend = null;
  }

  update() {
    const playerModel = this.getPlayerModel?.();
    const quest = this.state;
    if (!quest || !playerModel) return;
    const friend = quest.friend;
    if (friend?.model) {
      friend.update(this.deltaSeconds);
    }

    if (quest.status === "searching" && friend?.model) {
      const distanceToFriend = playerModel.position.distanceTo(friend.model.position);
      this.updateQuestTrail(playerModel.position, friend.model.position);
      if (distanceToFriend <= QUEST_FRIEND_REACH_DISTANCE) {
        quest.status = "found";
        quest.trailMode = null;
        this.clearQuestTrail();
      }
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
    }
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
      const speed = CHARACTER_MOVEMENT.walkSpeed * 0.9;
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
