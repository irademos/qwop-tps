# Street Quest — AI Agent Quick-Start Guide

> **Maintenance rule:** When you add/remove/rename files, change module responsibilities, or alter the boot sequence, update this file and `CLAUDE.md` in the same commit. Accurate docs save tokens on every future task.

**Game name:** Street Quest (repo name `qwop-tps` is historical)  
**Type:** Browser-based 3D multiplayer RPG  
**Deep reference:** `CLAUDE.md` at repo root (architecture, patterns, full directory tree)

---

## 30-Second Orientation

| What | Where |
|---|---|
| All source code | `src/` |
| Game orchestrator / main loop | `src/bootstrap/bootstrapGameApp.js` (~15k lines) |
| Shared runtime state (DI container) | `src/core/appContext.js` |
| HTML shell + all HUD elements | `index.html` |
| All CSS | `styles.css` |
| Serverless functions (Vercel) | `api/llama.js`, `api/overpass.js` |
| Static assets | `public/` |
| Build | `npm run dev` (port 3000) · `npm run build` |

**Rule:** Never use raw globals. Always read/write through `appContext.entities`, `.systems`, `.uiState`, `.settings`, `.debugFlags`.

---

## Tech Stack (one-liner each)

- **Rendering:** Three.js v0.176
- **Physics:** Rapier3D (`@dimforge/rapier3d-compat`)
- **Multiplayer:** Firebase (signaling/presence) + PeerJS WebRTC (star topology — one host, others connect to it)
- **Map data:** OpenStreetMap via Overpass API → Web Worker → Three.js meshes
- **AI NPC:** Groq/Llama-3.1 via `/api/llama` (called every ~10s by `src/npc/friendlyNpcManager.js`)
- **Auth:** PIN → SHA-256 → Firebase + cookie (no OAuth)
- **Build:** Vite 6, deployed on Vercel

---

## Source Directory Map

```
src/
  bootstrap/    bootstrapGameApp.js       ← game init + rAF loop
  core/         appContext, firebase, utils, requestQueue
  player/       stats, health, achievements, home, auth
  npc/          friendlyNpcManager, quest, persistence
  map/          osmClient, osmGeoJson, tileCache, location, spawnUtils
  combat/       knockback, pickupSpatialGrid, bloodEffect (damage blood spray), explosionEffect (bomb explosion + smoke), playerBomb (Sword Showdown player bombs)
  multiplayer/  peerConnection
  audio/        audioManager
  characters/   CharacterBase, PlayerCharacter, EnemyPlayer, MonsterCharacter, FriendlyCharacter, merchant
  controls/     PlayerControls (controls.js), all UI panels
  environment/  MapLoader, mapRender, buildingsRender, terrainHeight, worldGeneration, nature, animals, water
  features/     Lazy-load facades for code splitting (combatFeature, uiPanelsFeature, etc.)
  items/        weapon.js + melee.js + projectiles.js + per-weapon files
  models/       monsterModel, playerModel, glbCharacterModel (GLB character + arm IK), fluffyCharacter.ts (Mixamo retarget + fur)
  physics/      rapierSafety, staticBoxCollider
  mediapipe/    handTrackingManager, mediapipeHelper
  workers/      osmWorker (Web Worker)
```

---

## Common Task → File Lookup

| Task | Primary file(s) |
|---|---|
| Player stats (HP/hunger/magic) | `src/player/healthUtils.js`, `src/player/statSegments.js` |
| Add weapon | `src/items/<weapon>.js` + register in `src/features/combatFeature.js` |
| NPC behavior / AI loop | `src/npc/friendlyNpcManager.js` |
| Add quest | `src/npc/quest.js` |
| Movement / camera / input | `src/controls/controls.js` |
| Player / enemy / bomb-thrower character model, clips, arm IK, fur | `src/models/glbCharacterModel.js` (`glbCharacterConfig`), `src/models/fluffyCharacter.ts` |
| Where hands go (sword/shield/gun grip) | `src/models/playerModel.js` (`updateProceduralPlayerRig`), `src/items/foamSword.js`, `shield.js`, `pistol.js`; enemies: `src/characters/EnemyPlayer.js` |
| New UI panel | `src/controls/<panel>.js` + lazy-load in `src/features/uiPanelsFeature.js` |
| Map / road rendering | `src/environment/mapRender.js`, `buildingsRender.js` |
| Terrain generation | `src/environment/worldGeneration.js`, `terrainHeight.js` |
| Firebase data shape | `src/player/playerProfile.js`, `src/npc/npcPersistence.js` |
| Multiplayer protocol | `src/multiplayer/peerConnection.js` |
| AI NPC prompt | `api/llama.js` (server) + `src/npc/friendlyNpcManager.js` (client) |
| Audio | `src/audio/audioManager.js` + `public/assets/audio/` |
| New 3D prop | GLB → `public/assets/props/` + load in relevant `src/environment/` file |
| Serverless API | `api/llama.js` or `api/overpass.js` |
| Sword Showdown player bombs (💣 button, throw clip, re-equip) | `src/combat/playerBomb.js`; `throwPlayerBomb`/`updatePlayerBombs` in `src/bootstrap/bootstrapGameApp.js`; `psBombBtn` in `src/controls/controls.js` |
| Sword Showdown shop upgrades (heart, shield upgrade, bubble, bomb) | Catalog + purchase in `src/characters/merchant.js`; effects in `appState.applyShopUpgrade` (caps: `SHOWDOWN_MAX_HEALTH_SEGMENTS`=20 in `healthUtils.js`, also limits level-ups; `SHOWDOWN_MAX_SHIELD_UPGRADES`=4 in `bootstrapGameApp.js`; `appState.isShopItemMaxed` → "MAX" in shop) and the bubble system (`activatePlayerBubble`) in `src/bootstrap/bootstrapGameApp.js`; bubble button in `src/controls/controls.js`; auto-buy when out of bombs/bubbles/shield/gun/bullets = `psAutoBuyTick` (`PS_AUTO_BUY_ITEMS`) in `bootstrapGameApp.js`; shop coin/owned display in `src/controls/merchantPanel.js` (`renderCoins`, `getOwnedCount`) |
| Terrain stamp debugging | `src/environment/terrainHeight.js` + `docs/terrain-stamp-regression-checklist.md` |

---

## Key Patterns to Know

**Feature facades** (`src/features/`): thin wrappers that re-export lightweight APIs and `import()` heavy modules lazily. When adding a heavy new feature, add a facade here to keep the initial bundle small.

**Map pipeline:** GPS → `osmClient.js` → `osmWorker.js` (Web Worker) → `mapRender.js`/`buildingsRender.js` → `terrainHeight.js` stamps

**Terrain stamps:** Roads/buildings flatten the procedural terrain via priority-weighted stamps stored per tile. Query height at runtime via `terrainHeight.js`.

**Character arms (GLB + IK):** Players and EnemyPlayers use `gemhorn_rigged.glb`. Mixamo FBX clips animate everything except the arm chains (Shoulder→Hand); each frame the arms are solved with a stretchy two-bone IK toward invisible "floating hand" groups, which are also the weapon attach points (marked with `userData.proceduralHand`). Frame order: `setMoving` → `animate` → `solveArm` per hand → `stepFluff`. Floating-hand labels are mirrored: `'right'` sits at local +X = the character's anatomical left arm. `playDeath()` plays the flying-back death clip once (arms included, IK off) until `revive()` — used by the local player on death/respawn and by EnemyPlayer (ragdoll stays on; dead-enemy knockback capped by `DEATH_KNOCKBACK_CAP` in `EnemyPlayer.js`). The Sword Showdown bomb thrower (`BombThrowerEnemy.js`) uses the same GLB with `armIK: false` (clips drive the arms): `playAction(glbCharacterConfig.throwClip)` plays `Throw.fbx` once and the bomb is released at `THROW_RELEASE_AT` of the clip; between throws a bomb is held on the anatomical right palm (`getPalmWorldPosition('left')`).

**Multiplayer star topology:** Firebase = signaling only. PeerJS WebRTC carries actual game state. One host elected; all clients connect to host; host re-broadcasts.

---

## Environment Variables

| Variable | Used in |
|---|---|
| `VITE_FIREBASE_*` | `src/core/firebase-init.js` |
| `VITE_NETWORK_TOPOLOGY_MODE` | `src/multiplayer/peerConnection.js` (`star`\|`mesh`) |
| `GROQ_API_KEY` | `api/llama.js` (server-side only) |
| `MAPTILER_KEY` | `src/map/osmClient.js` |

---

## Boot Sequence

`index.html` → `app.js` → `bootstrapGameApp.js`:
1. Three.js scene + renderer
2. Rapier physics world
3. Firebase + player profile
4. Map/OSM systems
5. Character spawning
6. Multiplayer (PeerJS)
7. Hand tracking (optional)
8. `requestAnimationFrame` loop starts

---

## What NOT to Do

- Don't bypass `appContext` with `window.*` globals in new code
- Don't import heavy modules at top level — use the facade pattern (`src/features/`)
- Don't modify `public/service-worker.js` cache list without bumping the cache version
- Don't add game logic to `src/core/` (infrastructure only)
