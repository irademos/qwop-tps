# Sword Showdown — Codebase Guide for AI Agents

> **Maintenance rule for AI agents:** If your changes add/remove/rename source files, move logic between modules, introduce new architectural patterns, or add new env vars — update this file and `docs/AI_AGENT_GUIDE.md` in the same commit. Keep the "Common Task Locations" table and directory tree accurate. Stale docs cost more tokens than fresh ones.

## What This Is
A browser-based 3D sword-fighting game, **Sword Showdown**. The player's phone is the sword controller (gyro + joystick over PeerJS, `public/phone-sword.html`); the desktop/TV browser runs the game. Players fight waves of AI swordsmen and bomb throwers along a path through a static GLB map, stage by stage, collect coins and buy upgrades in the shop. Other players in the same room are visible (presence sync) and can be shot with the pistol. Sword Showdown is the only mode — the old RPG, horde, 3D painter, OSM map and NPC systems were removed. The repo name "qwop-tps" is historical.

## Tech Stack
| Layer | Technology |
|---|---|
| 3D Rendering | Three.js v0.176 (+ `three-mesh-bvh` for map raycasts) |
| Physics | Rapier3D (`@dimforge/rapier3d-compat`) |
| Multiplayer | Firebase Realtime Database (presence/signaling, shop stock) + PeerJS WebRTC (player presence + projectiles; phone controller link) |
| Map | Static GLB (`public/glb_map/map.glb`), height via BVH raycast |
| Build tool | Vite 6 |
| Deploy | Vercel (with `/api/turn-credentials` serverless function) |
| Auth | PIN-based (SHA-256 hashed, stored in Firebase + cookie) |

---

## Directory Structure

```
/
├── index.html                  # HTML shell — all UI/HUD elements defined here
├── app.js                      # JS entry point — calls bootstrapGameApp()
├── styles.css                  # All game CSS
├── vite.config.js              # Build config (manual chunks: three, rapier, firebase)
├── vercel.json                 # Deployment config (SPA rewrites, cache headers)
│
├── src/                        # ALL source code lives here
│   ├── bootstrap/
│   │   └── bootstrapGameApp.js # THE game orchestrator — init, GLB map, stages (`_ps*`), phone-sword link, shop/stats, networking, main loop (~5.5k lines)
│   │
│   ├── core/                   # Shared infrastructure (no game logic)
│   │   ├── appContext.js       # Dependency injection container (entities/systems/uiState/settings/debugFlags)
│   │   ├── exposeDebugGlobals.js # Mirrors appContext onto window.* for dev console
│   │   ├── firebase-init.js    # Firebase app init from VITE_* env vars; exports `db`
│   │   ├── externalDeps.js     # Lazy CDN loaders for PeerJS and NippleJS
│   │   └── utils.js            # Cookie get/set utilities
│   │
│   ├── player/
│   │   ├── playerProfile.js    # Firebase persistence — stats, inventory, PIN auth, Showdown leaderboard
│   │   └── healthUtils.js      # Health segment math — Showdown base/max segments, clamping, normalizing
│   │
│   ├── map/
│   │   └── spawnUtils.js       # getSpawnY / getSpawnPosition (terrain-aligned spawn height)
│   │
│   ├── environment/
│   │   └── terrainHeight.js    # Height resolver registry — the GLB map registers its BVH raycast; getTerrainHeight(x, z)
│   │
│   ├── combat/
│   │   ├── knockback.js        # Computes knockback impulse/motion vectors for hit reactions
│   │   ├── bloodEffect.js      # Blood spray/splat particles on damage (player + enemies); updateBloodEffects(dt) in game loop
│   │   ├── explosionEffect.js  # Bomb explosion VFX — flash, fireball, sparks, shockwave, scorch, smoke; updateExplosionEffects(dt) in game loop
│   │   └── playerBomb.js       # Player bombs — same flight/blast as a bomber's (shared helpers exported from BombThrowerEnemy.js)
│   │
│   ├── multiplayer/
│   │   └── peerConnection.js   # Multiplayer class — PeerJS WebRTC, Firebase signaling, star topology; messages: presence, projectile
│   │
│   ├── audio/
│   │   └── audioManager.js     # AudioManager — BGS loop, SFX playback/preload, footsteps, ouch vocals
│   │
│   ├── characters/
│   │   ├── CharacterBase.js    # Base class — model ref, health, velocity, animation mixer
│   │   ├── PlayerCharacter.js  # Local/remote player character (wraps createPlayerModel)
│   │   ├── EnemyPlayer.js      # AI swordsman (same GLB character, IK arms, foam sword)
│   │   ├── BombThrowerEnemy.js # AI bomber (same GLB character, Throw.fbx, bomb held in right hand)
│   │   └── merchant.js         # Shop catalog + per-room stock in Firebase (no NPC)
│   │
│   ├── controls/
│   │   ├── controls.js         # PlayerControls — keyboard/touch/joystick/gyro input, movement physics, camera, action buttons (block/fire, weapons, bubble, bomb)
│   │   ├── merchantPanel.js    # Shop UI — buy, coins, owned counts
│   │   └── settingsPanel.js    # Settings UI (character stats, multiplayer, display, sword gyro, about, account, developer) + leaderboard
│   │
│   ├── features/               # Lazy-load facade modules (enable Vite code splitting)
│   │   ├── audioFeature.js     # Creates the AudioManager
│   │   ├── combatFeature.js    # Re-exports projectiles; lazy-loads shield/pistol/foamSword
│   │   ├── persistenceFeature.js # Re-exports playerProfile
│   │   ├── uiPanelsFeature.js  # Settings panel + lazy-loaded shop panel/merchant
│   │   └── loadingState.js     # Shows/hides loading chips in UI corner during async loads
│   │
│   ├── items/
│   │   ├── weapon.js           # Weapon base class
│   │   ├── foamSword.js        # Sword — follows the phone-sword hand target
│   │   ├── shield.js           # Shield (upgradeable)
│   │   ├── pistol.js           # Pistol (ammo = "gun bullets")
│   │   └── projectiles.js      # Bullet spawning + update loop (hits remote players and enemies)
│   │
│   ├── models/
│   │   ├── playerModel.js      # Player group + floating hand targets; updateProceduralPlayerRig() moves hands, animates GLB character
│   │   ├── glbCharacterModel.js # Shared GLB character (gemhorn_rigged.glb): walk/idle clips, one-shot actions (playAction), arm IK toward floating hands, config
│   │   └── fluffyCharacter.ts  # Mixamo FBX → GLB world-space retargeter + fluffy fur/secondary motion (library)
│   │
│   └── physics/
│       └── rapierSafety.js     # Safe wrapper for world.removeRigidBody() (prevents double-remove crash)
│
├── api/
│   └── turn-credentials.js     # Returns TURN/STUN servers for WebRTC (Metered; STUN-only fallback)
│
├── public/                     # Static assets (served as-is)
│   ├── phone-sword.html        # Phone controller page (gyro sword, joystick, Block + action buttons) — connects to the game via PeerJS
│   ├── glb_map/map.glb         # The game world
│   ├── models/glb_characters/gemhorn_rigged.glb  # Player/enemy character
│   ├── models/animations/      # Walk, idle, throw, death FBX clips
│   ├── assets/audio/           # Songs, Showdown BGS loop, sword/bomb/bubble SFX, footsteps, ouch vocals
│   ├── assets/props/           # bomb.glb, road_light.glb
│   ├── assets/textures/sky/    # Skybox JPGs
│   ├── assets/ui/items/        # Shop/inventory icons
│   ├── credits.json            # Asset credits (Settings → About)
│   └── service-worker.js       # PWA offline caching
│
├── docs/
│   ├── AI_AGENT_GUIDE.md       # Quick-start for AI agents
│   └── asset-pipeline-compatibility.md  # glTF/FBX material + skinning notes
│
└── scripts/
    └── generate-asset-report.mjs  # Reports dist/ file sizes with gzip/brotli
```

---

## Key Architectural Patterns

### 1. `appContext` — Central Dependency Injection
Shared runtime state lives in **`src/core/appContext.js`** in typed buckets:
```js
appContext.entities   // otherPlayers, weapons
appContext.systems    // playerControls, rapierWorld, rbToMesh
appContext.uiState    // appState
appContext.settings   // user preferences, startupPhases
appContext.debugFlags // PERF, DEBUG_CONSOLE
```
`exposeDebugGlobals.js` mirrors these onto `window.*` (compat shims + dev console). New code should go through `appContext` rather than adding raw globals.

### 2. Feature Facade Pattern (`src/features/`)
Files in `features/` are **thin re-export + lazy-load wrappers** to enable Vite code splitting. `combatFeature.js` re-exports `projectiles.js` and lazy-loads the weapon modules (shield, pistol, foam sword); `uiPanelsFeature.js` lazy-loads the shop. When adding new heavy features, add a facade here.

### 3. Multiplayer: Star Topology
- Firebase Realtime Database = presence/signaling (and shop stock per room)
- PeerJS WebRTC = game traffic; only two message types: `presence` (position/animation/equipment) and `projectile` (pistol PvP)
- One peer elected "host"; all others connect to host (star), host re-broadcasts
- Topology mode configurable via `VITE_NETWORK_TOPOLOGY_MODE` env var
- The phone controller has its own PeerJS connection to the game (`_attachPhoneSwordConn` in `bootstrapGameApp.js`); TURN servers come from `/api/turn-credentials`

### 4. World: static GLB map
`bootstrapGameApp.js` loads `public/glb_map/map.glb`, builds a `three-mesh-bvh` BVH over it and registers a downward-raycast height resolver with `registerTerrainHeightResolver` (`src/environment/terrainHeight.js`). Everything that needs ground height (`getTerrainHeight`, `getSpawnY`) goes through that resolver.

### 5. Stages (`_ps*` in `bootstrapGameApp.js`)
Each stage picks the flattest direction from the start (`_psPickPathAngle`), places swordsmen, bombers and coins along it (`_psBuildStage`), then auto-walks the player between fights. Enemies (`EnemyPlayer`, `BombThrowerEnemy`) live in the `hordeEnemies` array (historical name).

### 6. GLB Character + IK Arms
Players and EnemyPlayers render `public/models/glb_characters/gemhorn_rigged.glb` (Mixamo skeleton). `fluffyCharacter.ts` retargets Mixamo FBX clips (walk/idle) onto it and adds fur; the clip drives everything **except** the arm chains. Arms are posed each frame by a stretchy two-bone IK (`GLBCharacter.solveArm`) toward invisible floating-hand groups, which are also the weapon attach points (`userData.proceduralHand` markers, preferred by `Weapon._getHandBone`). The GLB and clips face +Z (game forward) — no Y180 needed. Hand labels are mirrored: the `'right'` floating hand is at local +X, i.e. the anatomical left arm. On death, `GLBCharacter.playDeath()` plays `Flying Back Death.fbx` once over the whole body (IK suspended, hands follow the palms) until `revive()`; EnemyPlayer keeps its ragdoll during it, with knockback capped by `DEATH_KNOCKBACK_CAP`. Bomb blasts reuse the clip without dying: `EnemyPlayer.applyBlastKnockback()` (ragdoll + `playDeath()`, `revive()` in `_endRagdoll`, force/cap `BLAST_KNOCKBACK`) and `_blastPlayer()` in `bootstrapGameApp.js` for the local player. `BombThrowerEnemy` uses the same GLB with `armIK: false` (clips drive the arms, no floating hands): `playAction(glbCharacterConfig.throwClip)` plays `Throw.fbx` once and releases the bomb at `THROW_RELEASE_AT` of the clip; between throws a bomb mesh is snapped to the anatomical right palm (`getPalmWorldPosition('left')` — labels are mirrored). Blasts from other throwers play the death clip for `BLAST_STUN_MS`, then `revive()`.

### 7. PIN Auth
No OAuth. Player registers with name + numeric PIN. PIN is `SALT + SHA-256` hashed client-side via Web Crypto, stored in Firebase. Hash cached in cookie for auto-login.

---

## Entry Points & Boot Sequence

1. **`index.html`** — defines all DOM (HUD, overlays, login form)
2. **`app.js`** — waits for `DOMContentLoaded`, calls `bootstrapGameApp()`
3. **`src/bootstrap/bootstrapGameApp.js`** — initializes everything in order:
   - Three.js scene + renderer
   - Rapier physics world
   - Firebase + player profile load
   - GLB map + height resolver
   - Character spawning
   - Multiplayer (PeerJS) + phone controller link
   - Main animation/game loop (`requestAnimationFrame`)

---

## Environment Variables (`.env` / Vercel)
| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_*` | Firebase project config (apiKey, authDomain, databaseURL, etc.) |
| `VITE_NETWORK_TOPOLOGY_MODE` | `star` (default) or `mesh` for multiplayer |
| `VITE_METERED_API_KEY` | TURN credentials (Metered) — `api/turn-credentials.js` and `src/multiplayer/peerConnection.js` |

---

## Common Task Locations

| Task | File(s) |
|---|---|
| Change player stats (health segments, level/XP) | `src/player/healthUtils.js`; `statsState` / `appState` in `src/bootstrap/bootstrapGameApp.js` |
| Add a new weapon | `src/items/<weapon>.js`, register in `src/features/combatFeature.js` |
| Change movement/controls | `src/controls/controls.js` |
| Player/enemy character model, animation clips, arm IK, fur | `src/models/glbCharacterModel.js` (`glbCharacterConfig`), `src/models/fluffyCharacter.ts` |
| Where the hands go (sword/shield/gun grip, enemy swings) | `src/models/playerModel.js`, `src/items/foamSword.js`/`shield.js`/`pistol.js`, `src/characters/EnemyPlayer.js` |
| Add a new UI panel | `src/controls/`, lazy-load in `src/features/uiPanelsFeature.js` |
| World map / ground height | `public/glb_map/map.glb`; loaded + height resolver registered in `bootstrapGameApp.js`; `src/environment/terrainHeight.js`, `src/map/spawnUtils.js` |
| Firebase data structure | `src/player/playerProfile.js` (profiles, leaderboard), `src/characters/merchant.js` (room shop stock) |
| Multiplayer protocol | `src/multiplayer/peerConnection.js`, `src/bootstrap/bootstrapGameApp.js` |
| Sword Showdown bombs / bomber (blast damage/knockback, explosion VFX, throw clip, held bomb) | `src/characters/BombThrowerEnemy.js` (`_explodeBomb`, `_updateHeldBomb`, throw logic in `update`; shared helpers `blastEnemiesAt`/`computeBombLobVelocity`/`createBombMesh`/`spawnBombExplosion`), `src/combat/explosionEffect.js`, `EnemyPlayer.applyBlastKnockback`, `_blastPlayer` in `bootstrapGameApp.js` |
| Sword Showdown sword blocking (explicit block stance/button + directional rule: swing must cross the blade by > `BLOCK_MIN_ANGLE_DEG`=30°; player block is more forgiving: `PLAYER_BLOCK_MIN_ANGLE_DEG`=15°, `PLAYER_BLOCK_REACH`) | `swingCrossesBlade` / `EnemyPlayer.blocksSwing` in `src/characters/EnemyPlayer.js`; player's block in `EnemyPlayer._checkSwordHitOnTarget`; enemy's block in the phone-sword hit loop in `bootstrapGameApp.js` (swing direction from `_psw.tipHistory`) |
| Sword Showdown stage path (flattest-direction pick, enemy/coin placement, auto-walk) | `_psPickPathAngle` / `_psBuildStage` in `bootstrapGameApp.js`; auto-walk in the game loop (`_psAutoWalking`) |
| Damage hit effect (blood spray) | `src/combat/bloodEffect.js`; player trigger in `setStat` (`triggerPlayerHurtBlood`), enemies in `applyDamage` |
| Sword Showdown player bombs (💣 button, Throw.fbx, unequip/re-equip) | `src/combat/playerBomb.js` (flight/blast); `throwPlayerBomb`/`updatePlayerBombs` in `bootstrapGameApp.js` (count = `stats.bombs`, shop item `showdown_bomb`); button `psBombBtn` in `src/controls/controls.js` |
| Sword Showdown shop upgrades (heart/shield upgrade/bubble/bomb) | Catalog + purchase in `src/characters/merchant.js` (`unlimited` items); effects in `appState.applyShopUpgrade` (caps: `SHOWDOWN_MAX_HEALTH_SEGMENTS`=20 in `healthUtils.js`, also applies to level-ups; `SHOWDOWN_MAX_SHIELD_UPGRADES`=4 in `bootstrapGameApp.js`; `appState.isShopItemMaxed` → "MAX" in shop) + bubble system (`activatePlayerBubble`, `window.isPlayerBubbleActive`) in `bootstrapGameApp.js`; bubble button in `src/controls/controls.js`; enemy checks in `EnemyPlayer.js`/`BombThrowerEnemy.js`; auto-buy when out of bombs/bubbles/shield/gun/bullets = `psAutoBuyTick` (`PS_AUTO_BUY_ITEMS`, "Purchased …" toast via `showPickupToast` `options.text`) in `bootstrapGameApp.js`; shop coin balance + owned counts in `src/controls/merchantPanel.js` (`renderCoins`, `getOwnedCount`) |
| Sword Showdown health (5 segments at level 1, own max-health track, full health each session / stage start) | `SHOWDOWN_BASE_HEALTH_SEGMENTS` in `src/player/healthUtils.js`; `statsState.maxHealthSegments` is saved as the `showdownMaxHealthSegments` profile stat (`statsForSave` in `bootstrapGameApp.js`; older profiles fall back to their legacy `maxHealthSegments`); "never start dead" guard at the top of `_psStartStage` |
| Sword Showdown enemy difficulty per stage (swordsmen attacking at once: 1 for stages 1–7, up to 4; swing vs block/idle frequency) | `_psMaxAttackers` / `_psSwingChance` in `bootstrapGameApp.js` (attack slots in the game loop, `swingChance` passed in `_spawnHordeEnemy`); `EnemyPlayer.swingChance` used by `_decideNextPhase` in `src/characters/EnemyPlayer.js` |
| Sword Showdown kill counter (killed / total this stage) | `_psStageKills` / `_psStageTotal` / `_psUpdateKillHud` in `bootstrapGameApp.js` (`#ps-kill-counter`, `.ps-kill-counter` in `styles.css`) |
| Phone controller page (gyro sword + joystick, Block, bomb/gun/fire/shield/bubble/jump) | `public/phone-sword.html` (sends `gyro` packets with `joyAngle`/`joyForce`, `action` messages; shows host `status`); receiver `_attachPhoneSwordConn` / `_handlePhoneAction` in `bootstrapGameApp.js`; remote joystick also moves the player on desktop (`useJoystick` in `PlayerControls.processMovement`) |
| Audio | `src/audio/audioManager.js`, `public/assets/audio/`; Sword Showdown ambient loop = `SWORD_SHOWDOWN_BGS` in `bootstrapGameApp.js`; hurt vocals = `audioManager.playOuch(kind)` — ouch1 enemies via `playEnemyOuch()` (every 3rd or 4th hit across all enemies, `applyDamage`), ouch2 player hurt / ouch3 player death (`triggerPlayerHurtBlood`) |
| Add new 3D prop | Place GLB in `public/assets/props/`, load it from `bootstrapGameApp.js` (see `ROAD_LIGHT_MODEL_URL`) |
| Serverless API changes | `/api/turn-credentials.js` |

---

## Build & Dev

```bash
npm install          # Install dependencies
npm run dev          # Vite dev server at http://localhost:3000
npm run build        # Production build → dist/
```

Vite splits vendor chunks: `vendor-three`, `vendor-rapier`, `vendor-firebase`.

PWA service worker is at `public/service-worker.js` — update cache version when adding new static assets.
