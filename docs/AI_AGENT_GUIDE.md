# Sword Showdown — AI Agent Quick-Start Guide

> **Maintenance rule:** When you add/remove/rename files, change module responsibilities, or alter the boot sequence, update this file and `CLAUDE.md` in the same commit. Accurate docs save tokens on every future task.

**Game name:** Sword Showdown (repo name `qwop-tps` is historical)  
**Type:** Browser-based 3D sword-fighting game; your phone is the sword (gyro controller via PeerJS). Sword Showdown is the only mode.  
**Deep reference:** `CLAUDE.md` at repo root (architecture, patterns, full directory tree)

---

## 30-Second Orientation

| What | Where |
|---|---|
| All source code | `src/` |
| Game orchestrator / main loop / stages | `src/bootstrap/bootstrapGameApp.js` (~5.5k lines) |
| Phone controller page | `public/phone-sword.html` |
| Shared runtime state (DI container) | `src/core/appContext.js` |
| HTML shell + all HUD elements | `index.html` |
| All CSS | `styles.css` |
| Serverless function (Vercel) | `api/turn-credentials.js` |
| Static assets | `public/` (GLB map, character, clips, audio) |
| Build | `npm run dev` (port 3000) · `npm run build` |

**Rule:** Prefer `appContext.entities`, `.systems`, `.uiState`, `.settings`, `.debugFlags` over new raw globals.

---

## Tech Stack (one-liner each)

- **Rendering:** Three.js v0.176 (+ `three-mesh-bvh` for map raycasts)
- **Physics:** Rapier3D (`@dimforge/rapier3d-compat`)
- **Multiplayer:** Firebase (signaling/presence, shop stock) + PeerJS WebRTC (star topology — one host, others connect to it); messages: `presence`, `projectile`
- **World:** static GLB map (`public/glb_map/map.glb`)
- **Auth:** PIN → SHA-256 → Firebase + cookie (no OAuth)
- **Build:** Vite 6, deployed on Vercel

---

## Source Directory Map

```
src/
  bootstrap/    bootstrapGameApp.js       ← game init, GLB map, stages (_ps*), phone link, shop/stats, rAF loop
  core/         appContext, exposeDebugGlobals, firebase-init, externalDeps (PeerJS/NippleJS CDN), utils (cookies)
  player/       playerProfile (Firebase stats/inventory/PIN/leaderboard), healthUtils
  map/          spawnUtils
  environment/  terrainHeight (height resolver registry)
  combat/       knockback, bloodEffect (damage blood spray), explosionEffect (bomb explosion + smoke), playerBomb (player bombs)
  multiplayer/  peerConnection
  audio/        audioManager
  characters/   CharacterBase, PlayerCharacter, EnemyPlayer (swordsman), BombThrowerEnemy (bomber), merchant (shop catalog/stock)
  controls/     PlayerControls (controls.js), merchantPanel (shop UI), settingsPanel
  features/     Lazy-load facades for code splitting (audio, combat, persistence, uiPanels, loadingState)
  items/        weapon.js + foamSword, shield, pistol + projectiles.js
  models/       playerModel, glbCharacterModel (GLB character + arm IK), fluffyCharacter.ts (Mixamo retarget + fur)
  physics/      rapierSafety
```

---

## Common Task → File Lookup

| Task | Primary file(s) |
|---|---|
| Player stats (health segments, level/XP, coins) | `src/player/healthUtils.js`; `statsState` / `appState` in `src/bootstrap/bootstrapGameApp.js` |
| Add weapon | `src/items/<weapon>.js` + register in `src/features/combatFeature.js` |
| Movement / camera / input / action buttons | `src/controls/controls.js` |
| Player / enemy / bomb-thrower character model, clips, arm IK, fur | `src/models/glbCharacterModel.js` (`glbCharacterConfig`), `src/models/fluffyCharacter.ts` |
| Where hands go (sword/shield/gun grip) | `src/models/playerModel.js` (`updateProceduralPlayerRig`), `src/items/foamSword.js`, `shield.js`, `pistol.js`; enemies: `src/characters/EnemyPlayer.js` |
| New UI panel | `src/controls/<panel>.js` + lazy-load in `src/features/uiPanelsFeature.js` |
| World map / ground height | `public/glb_map/map.glb`; loaded in `bootstrapGameApp.js`; `src/environment/terrainHeight.js`, `src/map/spawnUtils.js` |
| Firebase data shape | `src/player/playerProfile.js`, `src/characters/merchant.js` (room shop stock) |
| Multiplayer protocol | `src/multiplayer/peerConnection.js`, `src/bootstrap/bootstrapGameApp.js` |
| Audio | `src/audio/audioManager.js` + `public/assets/audio/` |
| New 3D prop | GLB → `public/assets/props/` + load from `bootstrapGameApp.js` |
| Serverless API | `api/turn-credentials.js` |
| Sword Showdown bombs / bomber (blast damage/knockback, explosion VFX, throw clip, held bomb) | `src/characters/BombThrowerEnemy.js` (`_explodeBomb`, `_updateHeldBomb`, throw logic in `update`; shared helpers `blastEnemiesAt`/`computeBombLobVelocity`/`createBombMesh`/`spawnBombExplosion`), `src/combat/explosionEffect.js`, `EnemyPlayer.applyBlastKnockback`, `_blastPlayer` in `bootstrapGameApp.js` |
| Sword Showdown sword blocking (explicit block stance/button + directional rule: swing must cross the blade by > `BLOCK_MIN_ANGLE_DEG`=30°; player block is more forgiving: `PLAYER_BLOCK_MIN_ANGLE_DEG`=15°, `PLAYER_BLOCK_REACH`) | `swingCrossesBlade` / `EnemyPlayer.blocksSwing` in `src/characters/EnemyPlayer.js`; player's block in `EnemyPlayer._checkSwordHitOnTarget`; enemy's block in the phone-sword hit loop in `bootstrapGameApp.js` (swing direction from `_psw.tipHistory`) |
| Sword Showdown stage path (flattest-direction pick, enemy/coin placement, auto-walk) | `_psPickPathAngle` / `_psBuildStage` in `bootstrapGameApp.js`; auto-walk in the game loop (`_psAutoWalking`) |
| Damage hit effect (blood spray) | `src/combat/bloodEffect.js`; player trigger in `setStat` (`triggerPlayerHurtBlood`), enemies in `applyDamage` |
| Sword Showdown player bombs (💣 button, Throw.fbx, unequip/re-equip) | `src/combat/playerBomb.js` (flight/blast); `throwPlayerBomb`/`updatePlayerBombs` in `bootstrapGameApp.js` (count = `stats.bombs`, shop item `showdown_bomb`); button `psBombBtn` in `src/controls/controls.js` |
| Sword Showdown shop upgrades (heart/shield upgrade/bubble/bomb) | Catalog + purchase in `src/characters/merchant.js` (`unlimited` items); effects in `appState.applyShopUpgrade` (caps: `SHOWDOWN_MAX_HEALTH_SEGMENTS`=20 in `healthUtils.js`, also applies to level-ups; `SHOWDOWN_MAX_SHIELD_UPGRADES`=4 in `bootstrapGameApp.js`; `appState.isShopItemMaxed` → "MAX" in shop) + bubble system (`activatePlayerBubble`, `window.isPlayerBubbleActive`) in `bootstrapGameApp.js`; bubble button in `src/controls/controls.js`; enemy checks in `EnemyPlayer.js`/`BombThrowerEnemy.js`; auto-buy when out of bombs/bubbles/shield/gun/bullets = `psAutoBuyTick` (`PS_AUTO_BUY_ITEMS`, "Purchased …" toast via `showPickupToast` `options.text`) in `bootstrapGameApp.js`; shop coin balance + owned counts in `src/controls/merchantPanel.js` (`renderCoins`, `getOwnedCount`) |
| Sword Showdown health (3 segments at level 1, own max-health track, full health each session / stage start) | `SHOWDOWN_BASE_HEALTH_SEGMENTS` in `src/player/healthUtils.js`; `statsState.maxHealthSegments` is saved as the `showdownMaxHealthSegments` profile stat (`statsForSave` in `bootstrapGameApp.js`; older profiles fall back to their legacy `maxHealthSegments`); "never start dead" guard at the top of `_psStartStage` |
| Sword Showdown kill counter (killed / total this stage) | `_psStageKills` / `_psStageTotal` / `_psUpdateKillHud` in `bootstrapGameApp.js` (`#ps-kill-counter`, `.ps-kill-counter` in `styles.css`) |
| Phone controller page (gyro sword + joystick, Block, bomb/gun/fire/shield/bubble/jump) | `public/phone-sword.html` (sends `gyro` packets with `joyAngle`/`joyForce`, `action` messages; shows host `status`); receiver `_attachPhoneSwordConn` / `_handlePhoneAction` in `bootstrapGameApp.js`; remote joystick also moves the player on desktop (`useJoystick` in `PlayerControls.processMovement`) |
| Audio | `src/audio/audioManager.js`, `public/assets/audio/`; Sword Showdown ambient loop = `SWORD_SHOWDOWN_BGS` in `bootstrapGameApp.js`; hurt vocals = `audioManager.playOuch(kind)` — ouch1 enemies via `playEnemyOuch()` (every 3rd or 4th hit across all enemies, `applyDamage`), ouch2 player hurt / ouch3 player death (`triggerPlayerHurtBlood`) |

---

## Key Patterns to Know

**Feature facades** (`src/features/`): thin wrappers that re-export lightweight APIs and `import()` heavy modules lazily. When adding a heavy new feature, add a facade here to keep the initial bundle small.

**World:** `bootstrapGameApp.js` loads the GLB map, builds a BVH and registers a raycast height resolver with `registerTerrainHeightResolver`; `getTerrainHeight` / `getSpawnY` use it.

**Stages:** `_psPickPathAngle` picks the flattest direction, `_psBuildStage` places enemies and coins along it, and the player auto-walks between fights. Enemies live in the `hordeEnemies` array (historical name).

**Character arms (GLB + IK):** Players and EnemyPlayers use `gemhorn_rigged.glb`. Mixamo FBX clips animate everything except the arm chains (Shoulder→Hand); each frame the arms are solved with a stretchy two-bone IK toward invisible "floating hand" groups, which are also the weapon attach points (marked with `userData.proceduralHand`). Frame order: `setMoving` → `animate` → `solveArm` per hand → `stepFluff`. Floating-hand labels are mirrored: `'right'` sits at local +X = the character's anatomical left arm. `playDeath()` plays the flying-back death clip once (arms included, IK off) until `revive()` — used by the local player on death/respawn and by EnemyPlayer (ragdoll stays on; dead-enemy knockback capped by `DEATH_KNOCKBACK_CAP` in `EnemyPlayer.js`). The Sword Showdown bomb thrower (`BombThrowerEnemy.js`) uses the same GLB with `armIK: false` (clips drive the arms): `playAction(glbCharacterConfig.throwClip)` plays `Throw.fbx` once and the bomb is released at `THROW_RELEASE_AT` of the clip; between throws a bomb is held on the anatomical right palm (`getPalmWorldPosition('left')`).

**Multiplayer star topology:** Firebase = signaling/presence. PeerJS WebRTC carries player presence and projectiles; the phone controller has its own PeerJS link. One host elected; all clients connect to host; host re-broadcasts.

---

## Environment Variables

| Variable | Used in |
|---|---|
| `VITE_FIREBASE_*` | `src/core/firebase-init.js` |
| `VITE_NETWORK_TOPOLOGY_MODE` | `src/multiplayer/peerConnection.js` (`star`\|`mesh`) |
| `VITE_METERED_API_KEY` | `api/turn-credentials.js`, `src/multiplayer/peerConnection.js` (TURN credentials) |

---

## Boot Sequence

`index.html` → `app.js` → `bootstrapGameApp.js`:
1. Three.js scene + renderer
2. Rapier physics world
3. Firebase + player profile
4. GLB map + height resolver
5. Character spawning
6. Multiplayer (PeerJS) + phone controller link
7. `requestAnimationFrame` loop starts

---

## What NOT to Do

- Don't bypass `appContext` with `window.*` globals in new code
- Don't import heavy modules at top level — use the facade pattern (`src/features/`)
- Don't modify `public/service-worker.js` cache list without bumping the cache version
- Don't add game logic to `src/core/` (infrastructure only)
