import * as THREE from "three";
import { loadMonsterModel } from "./models/monsterModel.js";
import { FriendlyCharacter } from "./characters/FriendlyCharacter.js";
import { getTerrainHeight } from "./environment/terrainHeight.js";

const QUEST_FRIEND_MODEL = "/models/cowboy.fbx";
const QUEST_FRIEND_SPAWN_RADIUS_MIN = 3;
const QUEST_FRIEND_SPAWN_RADIUS_MAX = 6;
const QUEST_FIRST_GPS_TARGET_METERS = 30;
const QUEST_FIRST_GPS_XP = 60;
const QUEST_SECOND_MUSHROOM_TARGET = 1;
const QUEST_SECOND_MUSHROOM_XP = 35;
const QUEST_FRIEND_WANDER_RADIUS = 5;
const QUEST_FRIEND_ENGAGE_RADIUS = 5;
const QUEST_FRIEND_DISENGAGE_RADIUS = 8;
const QUEST_FRIEND_FOLLOW_DISTANCE = 3;
const QUEST_FRIEND_FOLLOW_START_DISTANCE = 4.5;

const TUTORIAL_QUESTS = [
  {
    id: "gps-walk-30m",
    title: "Walk 30 meters",
    description: "Move your GPS location at least 30 meters in the real world.",
    faq: "You have to physically move in the real world. The circle around your character is a bounding bubble tied to your real GPS position. Come on, get up off your couch and go for a walk. Welcome to Street Quest!"
  },
  {
    id: "collect-mushroom-1",
    title: "Collect 1 mushroom",
    description: "Pick up 1 mushroom so you can practice interacting with nearby items.",
    faq: "Walk up to a mushroom and press interact. If none are nearby, move around a little and look for them on the ground."
  }
];

const distanceMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const hasValidFix = (fix) => Number.isFinite(fix?.lat) && Number.isFinite(fix?.lon);

export class QuestManager {
  constructor({ scene, getPlayerModel, attachPhysics, detachPhysics, addXp }) {
    this.scene = scene;
    this.getPlayerModel = getPlayerModel;
    this.attachPhysics = attachPhysics;
    this.detachPhysics = detachPhysics;
    this.addXp = addXp;
    this.state = {
      friend: null,
      pendingSpawn: false,
      deltaSeconds: 0,
      shouldFollowPlayer: false,
      acceptedQuestIds: [],
      completedQuestIds: [],
      gpsQuestStartFix: null,
      gpsQuestDistanceMeters: 0,
      mushroomCount: 0
    };
    this.onQuestStateChange = null;
  }

  setQuestStateChangeListener(listener) {
    this.onQuestStateChange = typeof listener === "function" ? listener : null;
  }

  getPersistentState() {
    return {
      acceptedQuestIds: [...this.state.acceptedQuestIds],
      completedQuestIds: [...this.state.completedQuestIds]
    };
  }

  hydratePersistentState(savedState) {
    const accepted = Array.isArray(savedState?.acceptedQuestIds)
      ? savedState.acceptedQuestIds.filter((id) => typeof id === "string" && id.trim())
      : [];
    const completed = Array.isArray(savedState?.completedQuestIds)
      ? savedState.completedQuestIds.filter((id) => typeof id === "string" && id.trim())
      : [];
    const acceptedSet = new Set(accepted);
    completed.forEach((id) => acceptedSet.add(id));
    this.state.acceptedQuestIds = Array.from(acceptedSet);
    this.state.completedQuestIds = Array.from(new Set(completed));
  }

  notifyQuestStateChanged() {
    if (!this.onQuestStateChange) return;
    this.onQuestStateChange(this.getPersistentState());
  }

  setDeltaSeconds(deltaSeconds) {
    this.state.deltaSeconds = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  }

  getQuestFriend() {
    return this.state.friend;
  }

  isQuestFriend(friendly) {
    return this.state.friend === friendly;
  }

  isFriendActive() {
    return Boolean(this.getActiveQuest());
  }

  shouldOfferQuest(friendly) {
    return this.isQuestFriend(friendly);
  }

  ensureQuestFriendSpawned() {
    if (this.state.friend?.isDead || !this.state.friend?.model) {
      this.detachPhysics?.(this.state.friend);
      this.state.friend = null;
    }
    if (this.state.friend || this.state.pendingSpawn) return;
    this.state.pendingSpawn = true;

    const angle = Math.random() * Math.PI * 2;
    const radius = QUEST_FRIEND_SPAWN_RADIUS_MIN
      + Math.random() * (QUEST_FRIEND_SPAWN_RADIUS_MAX - QUEST_FRIEND_SPAWN_RADIUS_MIN);
    const spawnX = Math.cos(angle) * radius;
    const spawnZ = Math.sin(angle) * radius;
    const terrainHeight = getTerrainHeight(spawnX, spawnZ);
    const spawnY = Number.isFinite(terrainHeight) ? terrainHeight + 0.5 : 0.5;

    loadMonsterModel(QUEST_FRIEND_MODEL, (data) => {
      try {
        const questFriend = new FriendlyCharacter(data);
        questFriend.id = "quest-friendly-tutorial";
        questFriend.modelPath = QUEST_FRIEND_MODEL;
        questFriend.type = QUEST_FRIEND_MODEL;
        questFriend.model.userData.hideInMapView = true;
        questFriend.model.userData.isQuestFriend = true;
        questFriend.enableDanceWhileEngaged = false;
        questFriend.setNoticeRadius(10);
        questFriend.setWanderRadius(QUEST_FRIEND_WANDER_RADIUS);
        questFriend.setEngageRadius(QUEST_FRIEND_ENGAGE_RADIUS);
        questFriend.setDisengageRadius(QUEST_FRIEND_DISENGAGE_RADIUS);
        questFriend.setFollowTarget(null);
        questFriend.setLevel(1, { preserveHealth: false });
        questFriend.resetHealth();
        questFriend.setPosition(spawnX, spawnY, spawnZ);
        questFriend.setHomePosition(new THREE.Vector3(spawnX, spawnY, spawnZ));
        this.scene?.add(questFriend.model);
        this.attachPhysics?.(questFriend);
        this.state.friend = questFriend;
      } finally {
        this.state.pendingSpawn = false;
      }
    });
  }

  getCurrentSuggestedQuest() {
    return TUTORIAL_QUESTS.find((quest) => !this.state.completedQuestIds.includes(quest.id)) || null;
  }

  getActiveQuest() {
    const suggested = this.getCurrentSuggestedQuest();
    if (!suggested) return null;
    return this.state.acceptedQuestIds.includes(suggested.id) ? suggested : null;
  }

  getDialogueForFriendly(friendly, dialoguePool) {
    if (!this.isQuestFriend(friendly)) {
      if (!Array.isArray(dialoguePool) || dialoguePool.length === 0) {
        return null;
      }
      return dialoguePool[Math.floor(Math.random() * dialoguePool.length)];
    }

    const quest = this.getCurrentSuggestedQuest();
    if (!quest) {
      return {
        blocks: [
          "You finished every tutorial quest in my queue.",
          "Nice work, adventurer. Keep exploring Street Quest!"
        ],
        responses: [
          {
            label: "No thanks, see you later.",
            reply: "See you out there."
          }
        ]
      };
    }

    const questAccepted = this.state.acceptedQuestIds.includes(quest.id);
    const progressText = this.getQuestProgressText(quest.id);
    const intro = quest.id === "gps-walk-30m"
      ? "Welcome to Street Quest! First quest: move your GPS location 30 meters. You have to physically move in the real world. The circle around your character is a bounding bubble tied to your real GPS location. Come on, get up off your couch and go for a walk."
      : `Next quest: ${quest.title}.`;

    return {
      blocks: [intro, `${quest.description} ${progressText}`.trim()],
      responses: [
        {
          label: questAccepted ? "I already accepted it" : "Accept quest",
          reply: questAccepted ? "You're already on it. Keep going!" : `Awesome. ${quest.title} is now in your quest list.`,
          onSelect: "acceptTutorialQuest"
        },
        {
          label: "FAQ",
          reply: quest.faq,
          onSelect: "tutorialFaq"
        },
        {
          label: "No thanks, see you later.",
          reply: "No worries. Come back anytime.",
          onSelect: "declineTutorialQuest"
        },
        ...(this.state.shouldFollowPlayer ? [
          {
            label: "why are you following me?",
            reply: "I’m scared of the zombies out there, so I feel safer sticking close to you.",
            onSelect: "askWhyFollowing"
          },
          {
            label: "stop following me",
            reply: "Okay, I’ll stay here and keep watch.",
            onSelect: "stopFollowingQuestFriend"
          }
        ] : [])
      ]
    };
  }

  handleDialogueOption(option) {
    if (!option?.onSelect) return;
    if (option.onSelect === "acceptTutorialQuest") {
      this.acceptSuggestedQuest();
      return;
    }
    if (option.onSelect === "stopFollowingQuestFriend") {
      this.state.shouldFollowPlayer = false;
      this.state.friend?.setFollowTarget(null);
    }
  }

  acceptSuggestedQuest() {
    const quest = this.getCurrentSuggestedQuest();
    if (!quest) return;
    if (!this.state.acceptedQuestIds.includes(quest.id)) {
      this.state.acceptedQuestIds.push(quest.id);
      this.notifyQuestStateChanged();
    }
    this.state.shouldFollowPlayer = true;
    this.state.friend?.setFollowTarget(this.getPlayerModel?.(), {
      followDistance: QUEST_FRIEND_FOLLOW_DISTANCE,
      followStartDistance: QUEST_FRIEND_FOLLOW_START_DISTANCE
    });
    if (quest.id === "gps-walk-30m") {
      const latestFix = window.latestLocation;
      this.state.gpsQuestStartFix = hasValidFix(latestFix) ? { lat: latestFix.lat, lon: latestFix.lon } : null;
      this.state.gpsQuestDistanceMeters = 0;
    }
  }

  getQuestProgressText(questId) {
    if (questId === "gps-walk-30m") {
      const moved = Math.floor(this.state.gpsQuestDistanceMeters);
      return `(${moved}/${QUEST_FIRST_GPS_TARGET_METERS} m)`;
    }
    if (questId === "collect-mushroom-1") {
      return `(${this.state.mushroomCount}/${QUEST_SECOND_MUSHROOM_TARGET})`;
    }
    return "";
  }

  completeQuest(questId, xpReward) {
    if (this.state.completedQuestIds.includes(questId)) return;
    this.state.completedQuestIds.push(questId);
    this.notifyQuestStateChanged();
    this.addXp?.(xpReward);
  }

  handleMushroomCollected() {
    const activeQuest = this.getActiveQuest();
    if (!activeQuest || activeQuest.id !== "collect-mushroom-1") return;
    this.state.mushroomCount += 1;
    if (this.state.mushroomCount >= QUEST_SECOND_MUSHROOM_TARGET) {
      this.completeQuest("collect-mushroom-1", QUEST_SECOND_MUSHROOM_XP);
    }
  }

  updateGpsQuestProgress() {
    const activeQuest = this.getActiveQuest();
    if (!activeQuest || activeQuest.id !== "gps-walk-30m") return;

    const latestFix = window.latestLocation;
    if (!hasValidFix(latestFix)) return;

    if (!hasValidFix(this.state.gpsQuestStartFix)) {
      this.state.gpsQuestStartFix = { lat: latestFix.lat, lon: latestFix.lon };
      this.state.gpsQuestDistanceMeters = 0;
      return;
    }

    const moved = distanceMeters(
      this.state.gpsQuestStartFix.lat,
      this.state.gpsQuestStartFix.lon,
      latestFix.lat,
      latestFix.lon
    );
    this.state.gpsQuestDistanceMeters = Math.max(0, moved);

    if (moved >= QUEST_FIRST_GPS_TARGET_METERS) {
      this.completeQuest("gps-walk-30m", QUEST_FIRST_GPS_XP);
    }
  }

  getQuestLog() {
    return this.state.acceptedQuestIds.map((questId) => {
      const quest = TUTORIAL_QUESTS.find((entry) => entry.id === questId);
      if (!quest) return null;
      const completed = this.state.completedQuestIds.includes(questId);
      return {
        id: quest.id,
        title: quest.title,
        description: quest.description,
        completed,
        progress: this.getQuestProgressText(quest.id)
      };
    }).filter(Boolean);
  }

  update() {
    this.ensureQuestFriendSpawned();
    const friend = this.state.friend;
    const playerModel = this.getPlayerModel?.();
    if (friend?.model && playerModel) {
      if (this.state.shouldFollowPlayer) {
        friend.setFollowTarget(playerModel, {
          followDistance: QUEST_FRIEND_FOLLOW_DISTANCE,
          followStartDistance: QUEST_FRIEND_FOLLOW_START_DISTANCE
        });
      } else {
        friend.setFollowTarget(null);
      }
      friend.updateAI(this.state.deltaSeconds, playerModel, {});
    }
    this.updateGpsQuestProgress();
  }
}
