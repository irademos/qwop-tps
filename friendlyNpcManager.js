import * as THREE from "three";
import { loadMonsterModel } from "./models/monsterModel.js";
import { FriendlyCharacter } from "./characters/FriendlyCharacter.js";
import { createLightSource, LIGHT_SOURCE_CONFIGS } from "./light_sources.js";
import { createStaticBoxColliderForObject, syncStaticBoxColliderForObject } from "./physics/staticBoxCollider.js";
import {
  initFriendlyPersistence,
  loadFriendliesSnapshot,
  subscribeFriendlyUpdates,
  persistFriendlyState,
  setFriendlyPersistenceHost,
  removeFriendlyRecord
} from "./friendlyPersistence.js";
import { BASE_HEALTH_SEGMENTS, getMaxHealthSegments, normalizeHealthSegments } from "./healthUtils.js";
import { createCharacterSpawner } from "./characters/CharacterSpawn.js";

const FRIENDLY_MODELS = [
  "/models/cowboy.fbx"
];
const LLAMA_ID = "friendly:llama";
const LLAMA_NAME = "Llama";
const LLAMA_MODEL = "/models/Chimpanzee.fbx";
const LLAMA_DECISION_INTERVAL_MS = 10_000;
const LLAMA_REQUEST_TIMEOUT_MS = 5_000;
const LLAMA_ACTION_DURATION_MS = 6_000;
const LLAMA_SPEECH_MAX_CHARS = 96;
const LLAMA_PROMPT_NEARBY_RADIUS = 32;
const LLAMA_DRIFT_STOP_DISTANCE = 3.25;
const LLAMA_ALLOWED_ACTION_TYPES = new Set(['move', 'attack', 'equip', 'jump', 'interact', 'fly', 'shield']);
const LLAMA_ALLOWED_DIRECTIONS = new Set(['north', 'south', 'east', 'west']);
const LLAMA_MAX_ACTIONS = 2;
const LLAMA_TEXT_FIELD_MAX_CHARS = 80;
const LLAMA_HISTORY_LIMIT = 5;
const LLAMA_GOAL_INTERVAL_TURNS = 5;
const LLAMA_GOAL_HISTORY_LIMIT = 8;
const LLAMA_FOOD_INTERACT_DISTANCE = 1.1;
const LLAMA_MAX_HUNGER_SEGMENTS = 40;
const LLAMA_FOOD_RECOVERY = Object.freeze({
  mushroom: { health: 1, hunger: 3 },
  apple: { health: 1, hunger: 2 },
  meat: { health: 4, hunger: 16 }
});
const FRIENDLY_MAX_ACTIVE = 6;
const FRIENDLY_ACTIVE_RADIUS = 360;
const FRIENDLY_PLAYER_SPAWN_BLOCK_RADIUS = 32;
const FRIENDLY_NOTICE_RADIUS = 10;
const FRIENDLY_WANDER_RADIUS = 4;
const FRIENDLY_ENGAGE_RADIUS = 5;
const FRIENDLY_DISENGAGE_RADIUS = 8;
const FRIENDLY_ANIM_MIN_INTERVAL_MS = 150;
const FRIENDLY_AI_MAX_DELTA_SECONDS = 0.5;
const FRIENDLY_BASE_HEALTH = BASE_HEALTH_SEGMENTS;
const FRIENDLY_GROUND_OFFSET = 0.9;

const FRIENDLY_LEVEL_WEIGHTS = [
  { level: 1, weight: 0.55 },
  { level: 2, weight: 0.25 },
  { level: 3, weight: 0.15 },
  { level: 4, weight: 0.05 }
];

export function createFriendlyNpcManager({
  scene,
  playerModel,
  otherPlayers,
  attachPhysics,
  detachPhysics,
  getTerrainHeight,
  liftPositionToBuildingTop,
  isHost = false,
  debug = false,
  onSpawnEvent,
  onBeforeSpawn,
  onRemoteSpawnRequest,
  getMonsters,
  getFoodPickups,
  onFoodPickupCollected,
  onMonsterHit
} = {}) {
  const friendlies = [];
  const records = new Map();
  const spawning = new Set();
  let snapshotLoaded = false;
  let persistenceEnabled = true;
  let unsubscribeUpdates = null;
  let currentHost = !!isHost;
  let spawnedCount = 0;
  let llamaRequestInFlight = false;
  let llamaLastRequestAt = 0;
  let llamaDecision = null;
  let llamaActionStartedAt = 0;
  let llamaActionTargetId = null;
  let llamaTurnNumber = 0;
  let llamaCurrentGoal = null;
  const llamaGoalHistory = [];
  const llamaRecentHistory = [];
  const llamaNearbyTargets = new Map();
  const getSpawnNearPlayerPosition = (position) => {
    return getSpawnPosition(position);
  };

  const characterSpawner = createCharacterSpawner({
    getPlayerPosition: () => playerModel?.position?.clone?.() ?? null,
    getSpawnPosition: getSpawnNearPlayerPosition
  });

  const recordGpsTravel = (sample) => {
    characterSpawner.recordGpsTravel(sample);
  };


  const isLlamaId = (id) => id === LLAMA_ID;

  const sanitizeLlamaSpeech = (text) => {
    if (typeof text !== "string") return "";
    return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, LLAMA_SPEECH_MAX_CHARS);
  };

  const getLlamaSpawnPosition = () => {
    const base = playerModel?.position?.clone?.() || new THREE.Vector3(0, 0, 0);
    const angle = Math.random() * Math.PI * 2;
    const offset = new THREE.Vector3(Math.sin(angle) * 3, 0, Math.cos(angle) * 3);
    const resolved = resolveFriendlyPosition(base.clone().add(offset));
    return resolved || base.add(offset);
  };

  const createLlamaRecord = (position = getLlamaSpawnPosition()) => {
    const pos = resolveFriendlyPosition(position) || position || new THREE.Vector3(0, 0, 0);
    const angle = Math.random() * Math.PI * 2;
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    return {
      id: LLAMA_ID,
      type: LLAMA_MODEL,
      npcKind: 'llama',
      name: LLAMA_NAME,
      hp: FRIENDLY_BASE_HEALTH,
      level: 1,
      alive: true,
      pos: { x: pos.x, y: pos.y, z: pos.z },
      rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      llamaSpeech: 'Ready to grind XP.',
      llamaInventory: {},
      llamaHunger: LLAMA_MAX_HUNGER_SEGMENTS,
      llamaMaxHunger: LLAMA_MAX_HUNGER_SEGMENTS,
      updatedAt: Date.now(),
      version: Date.now()
    };
  };

  const ensureLlamaRecord = () => {
    if (!currentHost) return;
    const existing = records.get(LLAMA_ID);
    const shouldRespawn = !existing || existing.alive === false || (Number.isFinite(existing.hp) && existing.hp <= 0);
    if (!shouldRespawn) return;
    const respawnNear = getLlamaSpawnPosition();
    const record = createLlamaRecord(respawnNear);
    records.set(LLAMA_ID, record);
  };

  const createLlamaSpeechBubble = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, 2.85, 0);
    sprite.scale.set(2.8, 0.7, 1);
    sprite.visible = false;
    sprite.userData = { canvas, context, texture, text: '', visibleUntil: 0 };
    return sprite;
  };

  const setLlamaSpeech = (friendly, speech, { durationMs = 11_000 } = {}) => {
    if (!friendly?.model) return;
    const text = sanitizeLlamaSpeech(speech);
    if (!text) return;
    let bubble = friendly.model.userData.llamaSpeechBubble;
    if (!bubble) {
      bubble = createLlamaSpeechBubble();
      friendly.model.userData.llamaSpeechBubble = bubble;
      friendly.model.add(bubble);
    }
    const { canvas, context, texture } = bubble.userData;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(12, 18, 28, 0.78)';
    context.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect?.(10, 16, canvas.width - 20, canvas.height - 32, 20);
    if (!context.roundRect) {
      context.rect(10, 16, canvas.width - 20, canvas.height - 32);
    }
    context.fill();
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = 'bold 30px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const words = text.split(' ');
    const lines = [];
    let line = '';
    words.forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (context.measureText(test).width > canvas.width - 64 && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    const visibleLines = lines.slice(0, 3);
    const startY = canvas.height / 2 - (visibleLines.length - 1) * 18;
    visibleLines.forEach((lineText, index) => context.fillText(lineText, canvas.width / 2, startY + index * 36));
    texture.needsUpdate = true;
    bubble.visible = true;
    bubble.userData.text = text;
    bubble.userData.visibleUntil = Date.now() + durationMs;
    friendly.model.userData.llamaSpeech = text;
    friendly.model.userData.llamaSpeechAt = Date.now();
  };

  const updateLlamaSpeechBubble = (friendly) => {
    const bubble = friendly?.model?.userData?.llamaSpeechBubble;
    if (!bubble) return;
    bubble.visible = Date.now() <= (bubble.userData.visibleUntil || 0);
  };


  const normalizeLlamaInventory = (inventory) => {
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return {};
    return Object.entries(inventory).reduce((result, [itemId, entry]) => {
      const id = sanitizeLlamaActionField(itemId, 80);
      if (!id) return result;
      const count = Math.max(0, Math.floor(Number(entry?.count ?? entry)) || 0);
      if (!count) return result;
      result[id] = {
        count,
        type: sanitizeLlamaActionField(entry?.type || '', 24)
      };
      return result;
    }, {});
  };

  const getLlamaInventory = (llama) => {
    if (!llama?.model?.userData) return {};
    const normalized = normalizeLlamaInventory(llama.model.userData.llamaInventory);
    llama.model.userData.llamaInventory = normalized;
    return normalized;
  };

  const getLlamaHunger = (llama) => Math.max(0, Math.min(
    Number.isFinite(llama?.model?.userData?.llamaMaxHunger) ? llama.model.userData.llamaMaxHunger : LLAMA_MAX_HUNGER_SEGMENTS,
    Number.isFinite(llama?.model?.userData?.llamaHunger) ? llama.model.userData.llamaHunger : LLAMA_MAX_HUNGER_SEGMENTS
  ));

  const setLlamaHunger = (llama, value) => {
    if (!llama?.model?.userData) return;
    const maxHunger = Number.isFinite(llama.model.userData.llamaMaxHunger)
      ? llama.model.userData.llamaMaxHunger
      : LLAMA_MAX_HUNGER_SEGMENTS;
    llama.model.userData.llamaMaxHunger = maxHunger;
    llama.model.userData.llamaHunger = Math.max(0, Math.min(maxHunger, Math.round(Number(value) || 0)));
  };

  const addLlamaInventoryItem = (llama, itemId, amount = 1, type = '') => {
    const id = sanitizeLlamaActionField(itemId, 80);
    const count = Math.max(1, Math.floor(Number(amount) || 1));
    if (!id || !llama?.model?.userData) return null;
    const inventory = getLlamaInventory(llama);
    const current = inventory[id] || { count: 0, type: sanitizeLlamaActionField(type, 24) };
    inventory[id] = {
      ...current,
      count: Math.max(0, Math.floor(current.count || 0)) + count,
      type: sanitizeLlamaActionField(type || current.type || '', 24)
    };
    llama.model.userData.llamaInventory = inventory;
    return id;
  };

  const removeLlamaInventoryItem = (llama, itemId, amount = 1) => {
    const id = sanitizeLlamaActionField(itemId, 80);
    if (!id || !llama?.model?.userData) return;
    const inventory = getLlamaInventory(llama);
    const current = inventory[id];
    if (!current) return;
    const nextCount = Math.max(0, Math.floor(current.count || 0) - Math.max(1, Math.floor(Number(amount) || 1)));
    if (nextCount > 0) {
      inventory[id] = { ...current, count: nextCount };
    } else {
      delete inventory[id];
    }
    llama.model.userData.llamaInventory = inventory;
  };

  const getLlamaFoodRecovery = (type, collected = {}) => {
    const fallback = LLAMA_FOOD_RECOVERY[type] || { health: 0, hunger: 0 };
    return {
      health: Number.isFinite(collected.healthGain) ? collected.healthGain : fallback.health,
      hunger: Number.isFinite(collected.hungerGain) ? collected.hungerGain : fallback.hunger
    };
  };

  const maybeLlamaEatCollectedFood = (llama, itemId, type, collected = {}) => {
    if (!llama?.model || !itemId) return false;
    const maxHealth = Math.max(1, Number(llama.maxHealth || FRIENDLY_BASE_HEALTH));
    const maxHunger = Number.isFinite(llama.model.userData.llamaMaxHunger)
      ? llama.model.userData.llamaMaxHunger
      : LLAMA_MAX_HUNGER_SEGMENTS;
    llama.model.userData.llamaMaxHunger = maxHunger;
    const currentHunger = getLlamaHunger(llama);
    if ((llama.health || 0) >= maxHealth && currentHunger >= maxHunger) return false;
    const recovery = getLlamaFoodRecovery(type, collected);
    removeLlamaInventoryItem(llama, itemId, 1);
    if (recovery.health > 0) {
      llama.health = Math.min(maxHealth, Math.max(0, Number(llama.health || 0)) + recovery.health);
      llama.model.userData.health = llama.health;
      llama.updateHealthBarTexture?.();
      llama.showHealthBar?.();
    }
    if (recovery.hunger > 0) {
      setLlamaHunger(llama, currentHunger + recovery.hunger);
    }
    return true;
  };

  const summarizeLlamaInventory = (llama) => Object.entries(getLlamaInventory(llama))
    .map(([itemId, entry]) => `${itemId} x${entry.count}`)
    .slice(0, 8);

  const getAllPlayersForLlama = () => [
    { id: 'host', name: 'Host player', model: playerModel, level: 1, hp: FRIENDLY_BASE_HEALTH },
    ...Object.entries(otherPlayers || {}).map(([id, player]) => ({
      id,
      name: player?.name || 'Player',
      model: player?.model,
      level: Number.isFinite(player?.level) ? player.level : 1,
      hp: Number.isFinite(player?.health) ? player.health : FRIENDLY_BASE_HEALTH
    }))
  ].filter((entry) => entry.model?.position);

  const describeDirection = (from, to) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.abs(dx) > Math.abs(dz)) return dx >= 0 ? 'east' : 'west';
    return dz >= 0 ? 'south' : 'north';
  };

  const getPickupPosition = (pickup) => {
    const source = pickup?.mesh || pickup;
    if (source?.getWorldPosition) return source.getWorldPosition(new THREE.Vector3());
    return (pickup?.position || pickup?.mesh?.position || null)?.clone?.() || null;
  };

  const collectFoodTargetsForLlama = (llama, origin) => {
    if (typeof getFoodPickups !== 'function') return [];
    return (getFoodPickups() || []).map((entry, index) => {
      const pickup = entry?.pickup || entry;
      const position = entry?.position?.clone?.() || getPickupPosition(pickup);
      if (!pickup || !position) return null;
      const type = sanitizeLlamaActionField(entry?.type || pickup?.id || 'food', 24) || 'food';
      const id = sanitizeLlamaActionField(entry?.id, 60) || `food:${type}:${index}`;
      return {
        type,
        id,
        pickup,
        position,
        distance: origin.distanceTo(position)
      };
    }).filter(Boolean).filter((entry) => entry.distance <= LLAMA_PROMPT_NEARBY_RADIUS);
  };

  const getLlamaActionSignature = (actions = []) => actions
    .map((action) => {
      if (!action?.type) return '';
      if (action.type === 'move') return `${action.type}:${action.direction || (Array.isArray(action.vector) ? action.vector.map((n) => Math.round(n * 10) / 10).join(',') : '')}`;
      return `${action.type}:${action.targetId || action.item || ''}`;
    })
    .filter(Boolean)
    .join(' > ');

  const rememberLlamaHistory = (entry) => {
    llamaRecentHistory.push({ ...entry, turn: llamaTurnNumber });
    while (llamaRecentHistory.length > LLAMA_HISTORY_LIMIT) llamaRecentHistory.shift();
  };

  const finishLlamaGoal = (status, note = '') => {
    if (!llamaCurrentGoal) return;
    llamaGoalHistory.push({ ...llamaCurrentGoal, status, note, endedTurn: llamaTurnNumber });
    while (llamaGoalHistory.length > LLAMA_GOAL_HISTORY_LIMIT) llamaGoalHistory.shift();
    llamaCurrentGoal = null;
  };

  const updateLatestLlamaOutcome = (outcome) => {
    const latest = llamaRecentHistory[llamaRecentHistory.length - 1];
    if (latest) latest.outcome = outcome;
  };

  const collectLlamaNearby = (llama) => {
    if (!llama?.model?.position) return [];
    const origin = llama.model.position;
    const nearby = [];
    const monsters = typeof getMonsters === 'function' ? (getMonsters() || []) : [];
    monsters.forEach((monster) => {
      if (!monster?.model?.position || monster.isDead) return;
      const distance = origin.distanceTo(monster.model.position);
      if (distance > LLAMA_PROMPT_NEARBY_RADIUS) return;
      nearby.push({
        type: 'Monster',
        id: monster.id || null,
        distance: Math.round(distance),
        direction: describeDirection(origin, monster.model.position),
        level: Number.isFinite(monster.level) ? monster.level : 1,
        hp: Number.isFinite(monster.health) ? monster.health : null
      });
    });
    getAllPlayersForLlama().forEach((player) => {
      const distance = origin.distanceTo(player.model.position);
      if (distance > LLAMA_PROMPT_NEARBY_RADIUS) return;
      nearby.push({
        type: 'Player (ally - do not attack)',
        id: player.id,
        distance: Math.round(distance),
        direction: describeDirection(origin, player.model.position),
        level: player.level,
        hp: player.hp
      });
    });
    llamaNearbyTargets.clear();
    collectFoodTargetsForLlama(llama, origin).forEach((food) => {
      llamaNearbyTargets.set(food.id, food);
      nearby.push({
        type: `Food:${food.type}`,
        id: food.id,
        distance: Math.round(food.distance),
        direction: describeDirection(origin, food.position),
        level: null,
        hp: null
      });
    });
    nearby.sort((a, b) => a.distance - b.distance);
    return nearby.slice(0, 10);
  };

  const sanitizeLlamaActionField = (value, maxChars = LLAMA_TEXT_FIELD_MAX_CHARS) => {
    if (typeof value !== 'string') return '';
    return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
  };

  const normalizeLlamaAction = (action) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
    const type = sanitizeLlamaActionField(action.type || action.action, 20).toLowerCase();
    if (!LLAMA_ALLOWED_ACTION_TYPES.has(type)) return null;

    if (type === 'move') {
      const direction = sanitizeLlamaActionField(action.direction, 12).toLowerCase();
      if (LLAMA_ALLOWED_DIRECTIONS.has(direction)) return { type, direction };
      if (Array.isArray(action.vector) && action.vector.length >= 3) {
        const vector = action.vector.slice(0, 3).map(Number);
        if (vector.every(Number.isFinite) && vector.some((value) => Math.abs(value) > 0.0001)) {
          return { type, vector };
        }
      }
      return null;
    }

    if (type === 'attack') {
      const targetId = sanitizeLlamaActionField(action.targetId || action.target);
      return targetId ? { type, targetId } : { type };
    }

    if (type === 'equip') {
      const item = sanitizeLlamaActionField(action.item || action.target, 40);
      if (!item) return null;
      return { type, item };
    }

    if (type === 'interact') {
      const targetId = sanitizeLlamaActionField(action.targetId || action.target);
      if (!targetId) return null;
      return { type, targetId };
    }

    return { type };
  };

  const normalizeLlamaDecision = (raw) => {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const actions = Array.isArray(source.actions)
      ? source.actions
      : (source.action ? [{ ...source, type: source.action }] : []);
    const normalized = actions
      .map(normalizeLlamaAction)
      .filter(Boolean)
      .slice(0, LLAMA_MAX_ACTIONS);
    const spell = sanitizeLlamaActionField(source.spell, 20).toLowerCase();
    if ((spell === 'fly' || spell === 'shield') && normalized.length < LLAMA_MAX_ACTIONS) {
      normalized.push({ type: spell });
    }
    return {
      speak: sanitizeLlamaSpeech(source.speak || source.say || source.message || 'Still hunting XP.'),
      behaviorMode: sanitizeLlamaActionField(source.behaviorMode || source.mode, 24).toLowerCase(),
      goal: sanitizeLlamaActionField(
        typeof source.goal === 'string' ? source.goal : (source.goal?.text || source.nextGoal || ''),
        120
      ),
      actions: normalized
    };
  };

  const requestLlamaDecision = (llama) => {
    if (!currentHost || llamaRequestInFlight || !llama?.model || llama.isDead) return;
    const now = Date.now();
    if (now - llamaLastRequestAt < LLAMA_DECISION_INTERVAL_MS) return;
    llamaRequestInFlight = true;
    llamaLastRequestAt = now;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLAMA_REQUEST_TIMEOUT_MS);
    const nextTurn = llamaTurnNumber + 1;
    const payload = {
      history: llamaRecentHistory,
      currentGoal: llamaCurrentGoal,
      goalHistory: llamaGoalHistory,
      turnNumber: nextTurn,
      shouldSetGoal: ((nextTurn - 1) % LLAMA_GOAL_INTERVAL_TURNS) === 0,
      state: {
        hp: llama.health,
        maxHp: llama.maxHealth,
        hunger: getLlamaHunger(llama),
        maxHunger: Number.isFinite(llama.model.userData.llamaMaxHunger) ? llama.model.userData.llamaMaxHunger : LLAMA_MAX_HUNGER_SEGMENTS,
        inventory: summarizeLlamaInventory(llama),
        magic: Number.isFinite(llama.model.userData.magic) ? llama.model.userData.magic : 30,
        level: llama.level,
        equipped: llama.model.userData.llamaEquipped || 'sword',
        nearby: collectLlamaNearby(llama),
        position: {
          x: Math.round(llama.model.position.x * 100) / 100,
          y: Math.round(llama.model.position.y * 100) / 100,
          z: Math.round(llama.model.position.z * 100) / 100
        }
      }
    };
    fetch('/api/llama', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`Groq llama status ${response.status}`))))
      .then((data) => {
        console.log('[Llama] decision response', data);
        const decision = normalizeLlamaDecision(data?.decision || data);
        llamaTurnNumber = nextTurn;
        if (payload.shouldSetGoal && decision.goal) {
          finishLlamaGoal('failed', 'replaced by a new 5-turn goal');
          llamaCurrentGoal = { text: decision.goal, startedTurn: llamaTurnNumber, status: 'active' };
        }
        llamaDecision = decision;
        llamaActionStartedAt = 0;
        llamaActionTargetId = null;
        rememberLlamaHistory({
          speak: decision.speak,
          behaviorMode: decision.behaviorMode || 'unspecified',
          actions: decision.actions,
          actionSignature: getLlamaActionSignature(decision.actions),
          goal: llamaCurrentGoal?.text || null,
          outcome: 'started'
        });
        setLlamaSpeech(llama, decision.speak || 'For XP and survival!');
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('Llama Groq decision failed:', error);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        llamaRequestInFlight = false;
      });
  };

  const getClosestPlayerForLlama = (llama) => {
    if (!llama?.model?.position) return null;
    let closest = null;
    let closestDistance = Infinity;
    getAllPlayersForLlama().forEach((player) => {
      const distance = llama.model.position.distanceTo(player.model.position);
      if (distance < closestDistance) {
        closest = player;
        closestDistance = distance;
      }
    });
    return closest ? { ...closest, distance: closestDistance } : null;
  };

  const getMonsterForLlamaAction = (llama, action = {}) => {
    const monsters = typeof getMonsters === 'function' ? (getMonsters() || []) : [];
    const requestedId = typeof action.targetId === 'string' ? action.targetId : (typeof action.target === 'string' ? action.target : null);
    if (requestedId) {
      const exact = monsters.find((monster) => monster?.id === requestedId && !monster.isDead && monster.model?.position);
      if (exact) return exact;
    }
    let closest = null;
    let closestDistance = Infinity;
    monsters.forEach((monster) => {
      if (!monster?.model?.position || monster.isDead) return;
      const distance = llama.model.position.distanceTo(monster.model.position);
      if (distance < closestDistance) {
        closest = monster;
        closestDistance = distance;
      }
    });
    return closest;
  };

  const moveLlama = (llama, direction, delta) => {
    if (!llama?.model) return;
    const dir = direction?.clone?.() || new THREE.Vector3();
    dir.y = 0;
    if (dir.lengthSq() <= 0.0001) return;
    dir.normalize();
    llama.setDirection(dir);
    llama.setHorizontalMovement?.(dir, 3.2, delta, { resolveGroundY: getTerrainHeight, groundOffset: FRIENDLY_GROUND_OFFSET });
    llama.faceDirection?.(dir);
    llama.playAnimation('Run', 0.15);
    llama.update(delta);
  };

  const directionFromAction = (action = {}) => {
    const text = `${action.direction || ''} ${action.target || ''}`.toLowerCase();
    if (text.includes('north')) return new THREE.Vector3(0, 0, -1);
    if (text.includes('south')) return new THREE.Vector3(0, 0, 1);
    if (text.includes('east')) return new THREE.Vector3(1, 0, 0);
    if (text.includes('west')) return new THREE.Vector3(-1, 0, 0);
    if (Array.isArray(action.vector) && action.vector.length >= 3) {
      const [x, y, z] = action.vector;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return new THREE.Vector3(x, y, z);
    }
    return null;
  };

  const idleDriftLlama = (llama, delta) => {
    const closest = getClosestPlayerForLlama(llama);
    if (!closest?.model?.position || !llama?.model?.position) {
      llama.update(delta);
      return;
    }
    const toPlayer = closest.model.position.clone().sub(llama.model.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    if (distance <= LLAMA_DRIFT_STOP_DISTANCE || distance <= 0.0001) {
      llama.body?.setLinvel?.({ x: 0, y: 0, z: 0 }, true);
      llama.playAnimation('Idle', 0.2);
      llama.update(delta);
      return;
    }
    moveLlama(llama, toPlayer, delta);
  };

  const executeLlamaDecision = (llama, delta, context = {}) => {
    updateLlamaSpeechBubble(llama);
    requestLlamaDecision(llama);
    if (!llamaDecision?.actions?.length) {
      idleDriftLlama(llama, delta);
      return;
    }
    const now = Date.now();
    if (!llamaActionStartedAt) {
      llamaActionStartedAt = now;
    }
    if (now - llamaActionStartedAt > LLAMA_ACTION_DURATION_MS) {
      updateLatestLlamaOutcome(`timed out during ${llamaDecision.actions[0]?.type || 'action'}`);
      llamaDecision.actions.shift();
      llamaActionStartedAt = 0;
      llamaActionTargetId = null;
      if (!llamaDecision.actions.length) {
        idleDriftLlama(llama, delta);
      }
      return;
    }

    const action = llamaDecision.actions[0];
    if (!action) {
      idleDriftLlama(llama, delta);
      return;
    }

    if (action.type === 'move') {
      const direction = directionFromAction(action) || (() => {
        const closest = getClosestPlayerForLlama(llama);
        return closest?.model?.position ? closest.model.position.clone().sub(llama.model.position) : new THREE.Vector3(0, 0, 1);
      })();
      moveLlama(llama, direction, delta);
      return;
    }

    if (action.type === 'attack') {
      const monster = llamaActionTargetId
        ? (typeof getMonsters === 'function' ? (getMonsters() || []) : []).find((entry) => entry?.id === llamaActionTargetId)
        : getMonsterForLlamaAction(llama, action);
      if (!monster?.model || monster.isDead) {
        llamaDecision.actions.shift();
        llamaActionStartedAt = 0;
        llamaActionTargetId = null;
        idleDriftLlama(llama, delta);
        return;
      }
      llamaActionTargetId = monster.id || null;
      llama.updateCombatAI(delta, { id: monster.id, model: monster.model, entity: monster }, [{ id: monster.id, model: monster.model, entity: monster }], (monsterTarget, hitContext = {}) => {
        const entity = monsterTarget?.entity;
        if (!entity?.model || entity.isDead) return;
        const damage = Number.isFinite(hitContext.damage) ? Math.max(1, Math.round(hitContext.damage)) : llama.attackDamage;
        const killed = entity.applyDamage?.(damage, { attackTypes: hitContext.attackTypes || ['llama', 'melee'] });
        context.onMonsterHit?.(entity, { damage, killed: !!killed, sourceId: LLAMA_ID, attackTypes: hitContext.attackTypes || ['llama', 'melee'] });
        updateLatestLlamaOutcome(`hit monster for ${damage}`);
        if (killed) {
          window.onMonsterKill?.(entity, { withFriend: true });
          updateLatestLlamaOutcome('completed attack: monster defeated');
          finishLlamaGoal('completed', 'defeated a monster');
        }
      }, context);
      return;
    }

    if (action.type === 'interact') {
      const foodTarget = llamaNearbyTargets.get(action.targetId);
      if (!foodTarget?.pickup || !foodTarget.position) {
        llamaDecision.actions.shift();
        llamaActionStartedAt = 0;
        updateLatestLlamaOutcome('failed interact: target unavailable');
        idleDriftLlama(llama, delta);
        return;
      }
      const toFood = foodTarget.position.clone().sub(llama.model.position);
      toFood.y = 0;
      if (toFood.length() > LLAMA_FOOD_INTERACT_DISTANCE) {
        moveLlama(llama, toFood, delta);
        return;
      }
      const collected = typeof onFoodPickupCollected === 'function'
        ? onFoodPickupCollected(foodTarget, llama.model.position.clone(), llama)
        : false;
      const wasCollected = !!(collected?.collected ?? collected);
      if (wasCollected) {
        const itemId = addLlamaInventoryItem(
          llama,
          collected?.itemId || foodTarget.pickup?.id || foodTarget.type,
          collected?.amount || 1,
          foodTarget.type
        );
        const ateImmediately = maybeLlamaEatCollectedFood(llama, itemId, foodTarget.type, collected);
        persistFriendlyState(llama, { force: true });
        if (ateImmediately) setLlamaSpeech(llama, `Ate ${foodTarget.type} to recover.`);
      }
      llamaDecision.actions.shift();
      llamaActionStartedAt = 0;
      updateLatestLlamaOutcome(wasCollected ? `collected ${foodTarget.type}` : `failed to collect ${foodTarget.type}`);
      if (wasCollected) finishLlamaGoal('completed', `collected ${foodTarget.type}`);
      idleDriftLlama(llama, delta);
      return;
    }

    if (action.type === 'equip') {
      llama.model.userData.llamaEquipped = sanitizeLlamaSpeech(action.item || action.target || 'sword') || 'sword';
      llamaDecision.actions.shift();
      llamaActionStartedAt = 0;
      idleDriftLlama(llama, delta);
      return;
    }

    if (action.type === 'jump') {
      llama.body?.applyImpulse?.({ x: 0, y: 4.5, z: 0 }, true);
      llama.playAnimation('JumpAttack', 0.1);
      llama.update(delta);
      llamaDecision.actions.shift();
      llamaActionStartedAt = 0;
      return;
    }

    if (action.type === 'fly' || action.type === 'shield') {
      llama.model.userData[`llamaSpell_${action.type}`] = Date.now() + 10_000;
      llamaDecision.actions.shift();
      llamaActionStartedAt = 0;
      idleDriftLlama(llama, delta);
      return;
    }

    idleDriftLlama(llama, delta);
  };

  const refreshSpawnCounterFromRecords = () => {
    let maxSpawnedId = 0;
    records.forEach((record, recordId) => {
      const slotId = record?.id || recordId;
      const match = typeof slotId === "string" ? slotId.match(/^friendly:distance:(\d+)$/) : null;
      if (!match) return;
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value)) {
        maxSpawnedId = Math.max(maxSpawnedId, value);
      }
    });
    spawnedCount = maxSpawnedId;
  };

  const removeFriendlyById = (friendlyId) => {
    if (!friendlyId || isLlamaId(friendlyId)) return false;
    records.delete(friendlyId);
    removeFriendlyRecord(friendlyId);
    const index = friendlies.findIndex(entry => entry?.id === friendlyId);
    if (index >= 0) {
      cleanupFriendly(friendlies[index]);
      friendlies.splice(index, 1);
      window.friendlies = friendlies;
      return true;
    }
    return true;
  };

  const dropFurthestFriendlyRecord = (originPosition) => {
    if (!originPosition || records.size < FRIENDLY_MAX_ACTIVE) return;
    let furthestId = null;
    let furthestDistance = -Infinity;
    records.forEach((record, id) => {
      if (isLlamaId(id)) return;
      const pos = record?.pos;
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
      const distance = originPosition.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z));
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestId = id;
      }
    });
    if (!furthestId) return;

    records.delete(furthestId);
    removeFriendlyRecord(furthestId);

    const index = friendlies.findIndex(entry => entry?.id === furthestId);
    if (index >= 0) {
      cleanupFriendly(friendlies[index]);
      friendlies.splice(index, 1);
      window.friendlies = friendlies;
    }
  };
  const maybeSpawnFromDistance = () => {
    if (!playerModel) return;
    const spawnEvent = characterSpawner.getSpawnEvent();
    if (!spawnEvent?.position) return;

    const currentPos = playerModel.position.clone();
    const playerIsNearFriendly = Array.from(records.values()).some((record) => {
      if (!record?.alive) return false;
      const pos = record?.pos;
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
        return false;
      }
      const friendlyPosition = new THREE.Vector3(pos.x, pos.y, pos.z);
      return currentPos.distanceTo(friendlyPosition) <= FRIENDLY_PLAYER_SPAWN_BLOCK_RADIUS;
    });
    if (playerIsNearFriendly) return;

    if (spawnEvent.type !== 'friendly') {
      void onBeforeSpawn?.(1, spawnEvent.position);
      onSpawnEvent?.(spawnEvent);
      return;
    }

    void onBeforeSpawn?.(1, spawnEvent.position);
    dropFurthestFriendlyRecord(currentPos);
    spawnedCount += 1;
    const slotId = `friendly:distance:${spawnedCount}`;
    const level = getRandomLevel();
    const hp = getHealthForLevel(level);
    const modelPath = getRandomFriendlyModel();
    const angle = Math.random() * Math.PI * 2;
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    const record = {
      id: slotId,
      type: modelPath,
      hp,
      level,
      alive: true,
      pos: { x: spawnEvent.position.x, y: spawnEvent.position.y, z: spawnEvent.position.z },
      rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
    };
    records.set(slotId, record);
  };

  const spawnFriendlyAt = (position) => {
    if (!position) return null;
    const resolved = resolveFriendlyPosition(position);
    if (!resolved) return null;
    dropFurthestFriendlyRecord(playerModel?.position?.clone?.() || resolved);
    spawnedCount += 1;
    const slotId = `friendly:distance:${spawnedCount}`;
    const level = getRandomLevel();
    const hp = getHealthForLevel(level);
    const modelPath = getRandomFriendlyModel();
    const angle = Math.random() * Math.PI * 2;
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    const record = {
      id: slotId,
      type: modelPath,
      hp,
      level,
      alive: true,
      pos: { x: resolved.x, y: resolved.y, z: resolved.z },
      rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
    };
    records.set(slotId, record);
    return slotId;
  };



  const maybeRequestSpawnFromDistance = () => {
    if (!playerModel) return;
    const spawnEvent = characterSpawner.getSpawnEvent();
    if (!spawnEvent?.position) return;
    onRemoteSpawnRequest?.(spawnEvent);
  };

  const setHost = (nextHost) => {
    currentHost = !!nextHost;
    setFriendlyPersistenceHost(nextHost);
    if (currentHost) {
      characterSpawner.reset();
    }
  };

  const getRandomFriendlyModel = () => {
    const index = Math.floor(Math.random() * FRIENDLY_MODELS.length);
    return FRIENDLY_MODELS[index];
  };

  const getRandomLevel = () => {
    const totalWeight = FRIENDLY_LEVEL_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
    let pick = Math.random() * totalWeight;
    for (const entry of FRIENDLY_LEVEL_WEIGHTS) {
      pick -= entry.weight;
      if (pick <= 0) {
        return entry.level;
      }
    }
    return FRIENDLY_LEVEL_WEIGHTS[0]?.level ?? 1;
  };

const getHealthForLevel = (level) => {
    const clampedLevel = Math.max(1, Math.round(level || 1));
    return getMaxHealthSegments(clampedLevel);
  };

  const getSpawnPosition = (position) => {
    const spawnPos = position.clone();
    const terrainHeight = getTerrainHeight?.(spawnPos.x, spawnPos.z);
    spawnPos.y = Number.isFinite(terrainHeight) ? terrainHeight + FRIENDLY_GROUND_OFFSET : spawnPos.y;
    liftPositionToBuildingTop?.(spawnPos, FRIENDLY_GROUND_OFFSET);
    return spawnPos;
  };

  const resolveFriendlyPosition = (position) => {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
      return null;
    }
    const resolvedPosition = new THREE.Vector3(
      position.x,
      Number.isFinite(position.y) ? position.y : 0,
      position.z
    );
    const terrainHeight = getTerrainHeight?.(resolvedPosition.x, resolvedPosition.z);
    if (Number.isFinite(terrainHeight)) {
      resolvedPosition.y = terrainHeight + FRIENDLY_GROUND_OFFSET;
    }
    liftPositionToBuildingTop?.(resolvedPosition, FRIENDLY_GROUND_OFFSET);
    return resolvedPosition;
  };

  const cleanupFriendly = (friendly) => {
    if (!friendly) return;
    const roadLight = friendly.model?.userData?.roadLight;
    if (roadLight?.model?.parent) {
      roadLight.model.parent.remove(roadLight.model);
    }
    if (friendly.model?.userData) {
      friendly.model.userData.roadLight = null;
      friendly.model.userData.roadLightPending = false;
      friendly.model.userData.roadLightToken = null;
    }
    friendly.model?.userData?.mixer?.stopAllAction?.();
    if (friendly.model?.parent) {
      friendly.model.parent.remove(friendly.model);
    }
    detachPhysics?.(friendly);
    if (friendly.model?.userData?.rb) {
      friendly.model.userData.rb = null;
    }
    friendly.model = null;
  };

  const getRoadLightPosition = (basePosition) => {
    const lightPosition = basePosition.clone().add(new THREE.Vector3(2.5, 0, 2));
    const terrainHeight = getTerrainHeight?.(lightPosition.x, lightPosition.z);
    lightPosition.y = Number.isFinite(terrainHeight) ? terrainHeight + 0.1 : basePosition.y;
    liftPositionToBuildingTop?.(lightPosition, 0.3);
    return lightPosition;
  };

  const ensureFriendlyRoadLight = (friendly, basePosition) => {
    if (!friendly?.model || !scene) return;
    if (friendly.model.userData.roadLight || friendly.model.userData.roadLightPending) {
      return;
    }
    const token = Symbol("friendlyRoadLight");
    friendly.model.userData.roadLightToken = token;
    friendly.model.userData.roadLightPending = true;
    const lightPosition = getRoadLightPosition(basePosition);
    createLightSource(LIGHT_SOURCE_CONFIGS.roadLight, lightPosition)
      .then((lightSource) => {
        if (!friendly.model || friendly.model.userData.roadLightToken !== token) return;
        friendly.model.userData.roadLight = lightSource;
        friendly.model.userData.roadLightPending = false;
        scene.add(lightSource.model);
        lightSource.collider = createStaticBoxColliderForObject(lightSource.model, {
          friction: 0.9,
          restitution: 0.02,
          halfExtents: new THREE.Vector3(0.35, 1.8, 0.35),
          centerOffset: new THREE.Vector3(0, 1.8, 0),
          useObjectPosition: true
        });
      })
      .catch((error) => {
        console.warn("Failed to load friendly road light:", error);
      })
      .finally(() => {
        if (friendly.model?.userData?.roadLightToken === token) {
          friendly.model.userData.roadLightPending = false;
        }
      });
  };

  const syncFriendlyRoadLight = (friendly, basePosition) => {
    if (!friendly?.model) return;
    const roadLight = friendly.model.userData.roadLight;
    if (!roadLight?.model) return;
    roadLight.model.position.copy(getRoadLightPosition(basePosition));
    syncStaticBoxColliderForObject(roadLight.collider);
  };

  const setFriendlyForSlot = (slotId, friendly) => {
    const existingIndex = friendlies.findIndex(entry => entry.id === slotId);
    if (existingIndex >= 0) {
      friendlies[existingIndex] = friendly;
    } else {
      friendlies.push(friendly);
    }
    window.friendlies = friendlies;
  };

  const spawnFriendly = (record, existing = null) => {
    const slotId = record.id;
    if (!slotId || spawning.has(slotId)) return;
    const modelPath = record.type || record.modelPath || getRandomFriendlyModel();
    spawning.add(slotId);
    loadMonsterModel(modelPath, data => {
      try {
        const friendly = new FriendlyCharacter(data);
        friendly.id = slotId;
        friendly.modelPath = modelPath;
        friendly.type = modelPath;
        if (isLlamaId(slotId) || record.npcKind === 'llama') {
          friendly.name = LLAMA_NAME;
          friendly.model.userData.npcKind = 'llama';
          friendly.model.userData.displayName = LLAMA_NAME;
          friendly.model.userData.llamaEquipped = record.llamaEquipped || 'sword';
          friendly.model.userData.llamaInventory = normalizeLlamaInventory(record.llamaInventory);
          friendly.model.userData.llamaMaxHunger = Number.isFinite(record.llamaMaxHunger) ? record.llamaMaxHunger : LLAMA_MAX_HUNGER_SEGMENTS;
          setLlamaHunger(friendly, Number.isFinite(record.llamaHunger) ? record.llamaHunger : friendly.model.userData.llamaMaxHunger);
          friendly.enableDanceWhileEngaged = false;
          friendly.alwaysShowHealthBar = true;
        }
        if (Number.isFinite(record.version)) {
          friendly.version = record.version;
        }
        friendly.model.userData.approachToPlayer = false;
        friendly.model.userData.hideInMapView = true;
        friendly.setNoticeRadius(FRIENDLY_NOTICE_RADIUS);
        friendly.setWanderRadius(FRIENDLY_WANDER_RADIUS);
        friendly.setEngageRadius(FRIENDLY_ENGAGE_RADIUS);
        friendly.setDisengageRadius(FRIENDLY_DISENGAGE_RADIUS);
        friendly.lastAIUpdateMs = 0;
        const level = Number.isFinite(record.level) ? record.level : (isLlamaId(slotId) ? 1 : getRandomLevel());
        friendly.setLevel(level, { preserveHealth: false });
        friendly.resetHealth();

        if (Number.isFinite(record.hp)) {
          friendly.health = normalizeHealthSegments(record.hp, friendly.level);
          friendly.model.userData.health = friendly.health;
        }
        if (record.alive === false || (Number.isFinite(record.hp) && record.hp <= 0)) {
          friendly.markDead();
        }

        const position = record.pos;
        if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
          friendly.setPosition(position.x, position.y, position.z);
        }
        const rotation = record.rot;
        if (rotation && Number.isFinite(rotation.x) && Number.isFinite(rotation.y)
          && Number.isFinite(rotation.z) && Number.isFinite(rotation.w)) {
          friendly.model.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        }
        friendly.setHomePosition(friendly.model.position.clone());
        if (isLlamaId(slotId)) {
          setLlamaSpeech(friendly, record.llamaSpeech || 'Ready to grind XP.');
        } else {
          ensureFriendlyRoadLight(friendly, friendly.model.position.clone());
        }
        cleanupFriendly(existing);
        scene?.add(friendly.model);
        attachPhysics?.(friendly);
        if (rotation && friendly.body) {
          friendly.body.setRotation(rotation, true);
        }
        setFriendlyForSlot(slotId, friendly);
      } finally {
        spawning.delete(slotId);
      }
    });
  };

  const syncFriendlyFromRecord = (friendly, record, applyTransform) => {
    if (!friendly?.model || !record) return;
    const position = applyTransform ? record.pos : null;
    const rotation = applyTransform ? record.rot : null;
    const resolvedPosition = applyTransform ? resolveFriendlyPosition(position) : null;
    if (resolvedPosition) {
      friendly.model.position.copy(resolvedPosition);
      friendly.body?.setTranslation({ x: resolvedPosition.x, y: resolvedPosition.y, z: resolvedPosition.z }, true);
      friendly.setHomePosition(friendly.model.position);
      if (!isLlamaId(friendly.id)) {
        syncFriendlyRoadLight(friendly, friendly.model.position.clone());
      }
    }
    if (rotation && Number.isFinite(rotation.x) && Number.isFinite(rotation.y)
      && Number.isFinite(rotation.z) && Number.isFinite(rotation.w)) {
      friendly.model.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      friendly.body?.setRotation(rotation, true);
    }
    if (isLlamaId(friendly.id)) {
      if (record.llamaSpeech && record.llamaSpeech !== friendly.model.userData.llamaSpeech) {
        setLlamaSpeech(friendly, record.llamaSpeech);
      }
      friendly.model.userData.llamaInventory = normalizeLlamaInventory(record.llamaInventory);
      friendly.model.userData.llamaMaxHunger = Number.isFinite(record.llamaMaxHunger) ? record.llamaMaxHunger : LLAMA_MAX_HUNGER_SEGMENTS;
      setLlamaHunger(friendly, Number.isFinite(record.llamaHunger) ? record.llamaHunger : friendly.model.userData.llamaMaxHunger);
    }
    friendly.applyPersistedState?.({
      hp: record.hp,
      alive: record.alive,
      level: record.level,
      version: record.version
    });
  };

  const updateActiveFriendlies = (applyTransform) => {
    if (!playerModel) return;
    const activeEntries = [];
    records.forEach((record, id) => {
      if (!record?.pos) return;
      const pos = record.pos;
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
      const dist = playerModel.position.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z));
      if (isLlamaId(id) || dist <= FRIENDLY_ACTIVE_RADIUS) {
        activeEntries.push({ id, record, dist });
      }
    });
    activeEntries.sort((a, b) => a.dist - b.dist);
    const llamaEntries = activeEntries.filter((entry) => isLlamaId(entry.id));
    const limitedEntries = [
      ...llamaEntries,
      ...activeEntries.filter((entry) => !isLlamaId(entry.id)).slice(0, FRIENDLY_MAX_ACTIVE)
    ];
    const activeIds = new Set(limitedEntries.map(entry => entry.id));

    for (let i = friendlies.length - 1; i >= 0; i -= 1) {
      const friendly = friendlies[i];
      if (!friendly || !activeIds.has(friendly.id)) {
        cleanupFriendly(friendly);
        friendlies.splice(i, 1);
      }
    }
    window.friendlies = friendlies;

    limitedEntries.forEach(({ record, id }) => {
      const existing = friendlies.find(entry => entry.id === id);
      if (!existing) {
        spawnFriendly(record);
      } else if (applyTransform) {
        syncFriendlyFromRecord(existing, record, true);
      }
    });
  };

  const applyIncomingRecords = (incoming, { applyTransform = false, syncExisting = true } = {}) => {
    Object.entries(incoming || {}).forEach(([id, record]) => {
      if (!record) return;
      const slotId = record.id || id;
      if (!slotId) return;
      const incomingVersion = Number.isFinite(record.version) ? record.version : null;
      const existing = records.get(slotId);
      const existingVersion = Number.isFinite(existing?.version) ? existing.version : -Infinity;
      if (incomingVersion != null && incomingVersion < existingVersion) {
        return;
      }
      const merged = { ...existing, ...record, id: slotId };
      if (applyTransform) {
        const resolvedPosition = resolveFriendlyPosition(merged.pos);
        if (resolvedPosition) {
          const priorY = Number.isFinite(merged.pos?.y) ? merged.pos.y : null;
          merged.pos = { x: resolvedPosition.x, y: resolvedPosition.y, z: resolvedPosition.z };
          if (currentHost && priorY != null && Math.abs(priorY - resolvedPosition.y) > 1e-3) {
            const entity = {
              id: slotId,
              type: merged.type,
              modelPath: merged.modelPath || merged.type,
              version: Number.isFinite(merged.version) ? merged.version : 0,
              health: Number.isFinite(merged.hp) ? merged.hp : 0,
              level: Number.isFinite(merged.level) ? merged.level : 1,
              isDead: merged.alive === false,
              model: {
                position: resolvedPosition,
                quaternion: merged.rot || { x: 0, y: 0, z: 0, w: 1 }
              }
            };
            persistFriendlyState(entity);
          }
        }
      }
      records.set(slotId, merged);
      const existingFriendly = friendlies.find(entry => entry.id === slotId);
      if (existingFriendly && syncExisting) {
        syncFriendlyFromRecord(existingFriendly, merged, applyTransform);
      }
    });
    refreshSpawnCounterFromRecords();
  };

  const onRoomReady = async ({ roomId, isHost: nextHost } = {}) => {
    if (!roomId) {
      persistenceEnabled = false;
      snapshotLoaded = true;
      return;
    }
    initFriendlyPersistence({
      roomId,
      isHost: nextHost,
      debug
    });
    currentHost = !!nextHost;
    setFriendlyPersistenceHost(currentHost);
    snapshotLoaded = false;
    try {
      const snapshot = await loadFriendliesSnapshot();
      applyIncomingRecords(snapshot, { applyTransform: true, syncExisting: !currentHost });
      snapshotLoaded = true;
      if (unsubscribeUpdates) {
        unsubscribeUpdates();
      }
      unsubscribeUpdates = subscribeFriendlyUpdates(recordsUpdate => {
        applyIncomingRecords(recordsUpdate, { applyTransform: true, syncExisting: !currentHost });
      });
    } catch (err) {
      console.warn('Failed to load friendly snapshot', err);
      snapshotLoaded = true;
    }
  };

  const update = ({ delta, isHost: hostOverride } = {}) => {
    const isHostNow = hostOverride ?? currentHost;
    if (!snapshotLoaded) return;
    const nowMs = Date.now();
    if (isHostNow) {
      ensureLlamaRecord();
      maybeSpawnFromDistance();
    } else {
      maybeRequestSpawnFromDistance();
    }
    updateActiveFriendlies(!isHostNow);
    const monsters = typeof getMonsters === 'function' ? (getMonsters() || []) : [];
    const aiContext = { onMonsterHit };
    friendlies.forEach((friendly) => {
      if (!friendly?.model) return;
      const lastUpdate = friendly.lastAIUpdateMs ?? 0;
      if (isHostNow) {
        if (isLlamaId(friendly.id) && friendly.isDead) {
          const respawn = getLlamaSpawnPosition();
          friendly.setLevel(1, { preserveHealth: false });
          friendly.resetHealth();
          friendly.setPosition(respawn.x, respawn.y, respawn.z);
          friendly.syncBodyFromTransform?.();
          friendly.setHomePosition(respawn.clone());
          setLlamaSpeech(friendly, 'Back to level 1. XP grind resumes.');
        }
        if (nowMs - lastUpdate > FRIENDLY_ANIM_MIN_INTERVAL_MS) {
          const elapsedSeconds = Math.max(0, (nowMs - lastUpdate) / 1000);
          const aiDeltaSeconds = Math.min(
            FRIENDLY_AI_MAX_DELTA_SECONDS,
            lastUpdate > 0 ? elapsedSeconds : (Number.isFinite(delta) ? delta : 0)
          );
          friendly.lastAIUpdateMs = nowMs;
          if (isLlamaId(friendly.id)) {
            executeLlamaDecision(friendly, aiDeltaSeconds, aiContext);
          } else {
            friendly.updateAI(aiDeltaSeconds, playerModel, otherPlayers, monsters, aiContext);
          }
        }
        persistFriendlyState(friendly);
      } else {
        updateLlamaSpeechBubble(friendly);
        friendly.update(delta);
      }
    });
  };

  return {
    friendlies,
    setHost,
    recordGpsTravel,
    onRoomReady,
    update,
    removeFriendlyById,
    spawnFriendlyAt
  };
}
