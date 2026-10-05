# Sword Showdown — Codebase Guide for AI Agents

> **Maintenance rule for AI agents:** If your changes add/remove/rename source files, move logic between modules, introduce new architectural patterns, or add new env vars — update this file and `docs/AI_AGENT_GUIDE.md` in the same commit. Keep the "Common Task Locations" table and directory tree accurate. Stale docs cost more tokens than fresh ones.

## What This Is
A browser-based 3D sword-fighting game, **Sword Showdown**. The player's phone is the sword controller (gyro + joystick over PeerJS, `public/phone-sword.html`); the desktop/TV browser runs the game. Players fight waves of AI swordsmen and bomb throwers along a path through a static GLB map, stage by stage, collect coins and buy upgrades in the shop. Showdown is single player; **Classic** is a Wii Sports Resort–style take on it (Miis only, swordsmen only, 3 hearts per stage, Block is the only button, minimal HUD). **Multiplayer** mode is a lobby of everyone online where you challenge another player to a 1v1 sword duel in a private room, or start a **Team Battle** (5 v 5) / **Free For All** (10 fighters) with invited players, matchmaking players and bots (guns, bombs, bubbles and shields off). The old RPG, horde, 3D painter, OSM map and NPC systems were removed. The repo name "qwop-tps" is historical.

## Tech Stack
| Layer | Technology |
|---|---|
| 3D Rendering | Three.js v0.176 (+ `three-mesh-bvh` for map raycasts) |
| Physics | Rapier3D (`@dimforge/rapier3d-compat`) |
| Multiplayer | Firebase Realtime Database (lobby/presence/signaling, shop stock) + PeerJS WebRTC (Multiplayer mode only: duel challenges, battle parties/matchmaking, presence, sword state; separately the phone controller link) |
| Map | Static GLB (`public/glb_map/map.glb`), height via BVH raycast |
| Build tool | Vite 6 |
| Deploy | Vercel (with `/api/turn-credentials` serverless function) |
| Auth | PIN-based (SHA-256 hashed, stored in Firebase + cookie); guest play saves nothing |

---

## Directory Structure

```
/
├── index.html                  # HTML shell — all UI/HUD elements defined here
├── app.js                      # JS entry point — calls bootstrapGameApp()
├── styles.css                  # All game CSS — design tokens (:root) + shared panel/button/chip components at the top
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
│   │   ├── playerProfile.js    # Firebase persistence — stats, inventory, PIN auth, Showdown leaderboard, Classic stage + stats
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
│   │   ├── bloodEffect.js      # Blood spray/splat particles on damage (player + enemies); updateBloodEffects(dt) in game loop; setBloodEnabled (off in Classic)
│   │   ├── explosionEffect.js  # Bomb explosion VFX — flash, fireball, sparks, shockwave, scorch, smoke; updateExplosionEffects(dt) in game loop
│   │   ├── playerBomb.js       # Player bombs — same flight/blast as a bomber's (shared helpers exported from BombThrowerEnemy.js)
│   │   ├── heartBubbles.js     # Showdown heart bubbles — float mid-stage, drift in front of the player, sword poke pops for +1 health
│   │   └── comboMeter.js       # Showdown combo meter HUD — consecutive hits, cashed out as coins when it ends; Classic: "N-hit Combo!" every 5th hit
│   │
│   ├── multiplayer/
│   │   ├── peerConnection.js   # Multiplayer class — PeerJS WebRTC, Firebase signaling, rooms (lobby / duel-<id> / mm-<mode> / party-<id> / match-<id>, joinRoom, destroy); messages: presence, projectile, duel, match
│   │   ├── duelMode.js         # Multiplayer mode: lobby screen (+ Team Battle / Free For All buttons), challenges, duel lifecycle (countdown/winner), temp find-location tool — game access via a ctx from bootstrapGameApp.js
│   │   └── matchMode.js        # Team Battle / Free For All: party setup + invites, matchmaking queue, bots (host-simulated EnemyPlayers), battle lifecycle — game access via matchCtx
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
│   │   └── settingsPanel.js    # Settings UI (profile + stats, multiplayer, display + camera, sword gyro, about + clear cache, account) + leaderboard
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
│   │   ├── foamSword.js        # Sword — follows the phone-sword hand target (model from swordModel.js, procedural foam sword fallback)
│   │   ├── swordModel.js       # sword.glb / wii_sword.glb loader (translation stripped, fitted to grip origin / blade +Z) for player + enemy swords; per-variant grip placement, Mii ball hands, brightness
│   │   ├── shield.js           # Shield (upgradeable)
│   │   ├── pistol.js           # Pistol (ammo = "gun bullets")
│   │   └── projectiles.js      # Bullet spawning + update loop (hits remote players and enemies)
│   │
│   ├── tutorial/
│   │   ├── showdownTutorial.js # Scripted Sword Showdown tutorial (steps, enemy scripting, completion) — game access via a ctx from bootstrapGameApp.js
│   │   └── tutorialOverlay.js  # Tutorial DOM: instruction panel, screen-space swipe arrows / block bars, HUD button ring
│   │
│   ├── models/
│   │   ├── playerModel.js      # Player group + floating hand targets; updateProceduralPlayerRig() moves hands, animates GLB character
│   │   ├── glbCharacterModel.js # Shared GLB character (pumpkin.glb / antler_guy.glb / frog_man.glb / gemhorn_rigged.glb / wizard.glb / mii1.glb, cached per `url`): walk/idle clips, one-shot actions (playAction), arm IK toward floating hands, config
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
│   ├── models/glb_characters/pumpkin.glb         # Pumpkin (Multiplayer roster; Showdown unlock)
│   ├── models/glb_characters/antler_guy.glb      # Antler guy (Multiplayer roster; Showdown unlock)
│   ├── models/glb_characters/frog_man.glb        # Frog man (default player character; Showdown's base enemy)
│   ├── models/glb_characters/gemhorn_rigged.glb  # Enemy character (tutorial bomb throwers; Showdown unlock)
│   ├── models/glb_characters/wizard.glb          # Wizard character (Multiplayer roster; Showdown unlock)
│   ├── models/glb_characters/mii1.glb            # Mii character — no arms, holds the Wii sword (Multiplayer roster; Showdown unlock)
│   ├── models/animations/      # Walk, idle, throw, death FBX clips
│   ├── assets/audio/           # Songs, Showdown BGS loop, sword/bomb/bubble SFX, footsteps, ouch vocals
│   ├── assets/props/           # bomb.glb, road_light.glb, sword.glb, wii_sword.glb (Mii sword)
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

### 3. Multiplayer: lobby + duel rooms (Multiplayer mode only)
- Peer multiplayer only exists in Multiplayer mode: `startMultiplayer` / `stopMultiplayer` in `bootstrapGameApp.js` create/destroy the `Multiplayer` instance (Showdown and the tutorial are single player; `multiplayer` is `null` there — guard every use)
- Firebase Realtime Database = `peers/<id>` ({name, roomId}) lists everyone online (the lobby list), `rooms/<roomId>/<id>` drives who connects to whom; the shop stock is global (`merchantInventory`)
- Rooms: everyone starts in `lobby`; a duel moves both players to `duel-<challengeId>` (`joinRoom`) and back afterwards. Battles: a solo party host waits in `mm-<mode>` (the matchmaking queue), a party with guests in `party-<hostId>`, the battle itself in `match-<matchId>`
- PeerJS WebRTC message types: `presence` (position/animation/equipment), `projectile`, `duel` (`op`: challenge/accept/decline/cancel/state/hit/blocked/dead/leave — see `duelMode.js`), `match` (party/queue/battle ops — see the header of `matchMode.js`). Game traffic is sent only to the duel opponent / the other battle players (`sendTo`, `_netRecipients`); presence from anyone else is ignored
- Battles: the host (whoever pressed Start) simulates the bots and decides the winner; bot state is broadcast (`bots`), humans hit bots via `botHit` to the host. The host leaving ends the battle
- Duel hits: the attacker's sword check detects the hit and sends `hit`; the victim applies the damage and sends `dead` when it dies
- One peer per room elected "host"; others connect to it (star)
- Topology mode configurable via `VITE_NETWORK_TOPOLOGY_MODE` env var
- The phone controller has its own PeerJS connection to the game (`_attachPhoneSwordConn` in `bootstrapGameApp.js`); TURN servers come from `/api/turn-credentials`

### 4. World: static GLB map
`bootstrapGameApp.js` loads `public/glb_map/map.glb`, builds a `three-mesh-bvh` BVH over it and registers a downward-raycast height resolver with `registerTerrainHeightResolver` (`src/environment/terrainHeight.js`). Everything that needs ground height (`getTerrainHeight`, `getSpawnY`) goes through that resolver.

### 5. Stages (`_ps*` in `bootstrapGameApp.js`)
Each stage picks the flattest direction from the start (`_psPickPathAngle`), places swordsmen, bombers and coins along it (`_psBuildStage`), then auto-walks the player between fights. Enemies (`EnemyPlayer`, `BombThrowerEnemy`) live in the `hordeEnemies` array (historical name).

### 6. GLB Character + IK Arms
Players render `public/models/glb_characters/frog_man.glb` (`glbCharacterConfig.frogManUrl`) by default (Showdown lets them pick an unlocked character, Multiplayer battles a roster character); EnemyPlayers without a `characterUrl` cycle through `pumpkin.glb`, `antler_guy.glb` (`glbCharacterConfig.antlerGuyUrl`), `frog_man.glb` (`glbCharacterConfig.frogManUrl`), `gemhorn_rigged.glb` (`glbCharacterConfig.url`, the default) and `wizard.glb` (`glbCharacterConfig.wizardUrl`) per spawn (Showdown stages pass one) — all share the Mixamo skeleton, picked with the `url` option of `createGLBCharacterInstance`. Per-model fluffy overrides live in `glbCharacterConfig.fluffyByUrl` (the pumpkin, antler guy, frog man and wizard have `shells: 0` — bouncy motion, no shell fur). `fluffyCharacter.ts` retargets Mixamo FBX clips (walk/idle) onto it and adds fur; the clip drives everything **except** the arm chains. Arms are posed each frame by a stretchy two-bone IK (`GLBCharacter.solveArm`) toward invisible floating-hand groups, which are also the weapon attach points (`userData.proceduralHand` markers, preferred by `Weapon._getHandBone`). The GLB and clips face +Z (game forward) — no Y180 needed. Hand labels are mirrored: the `'right'` floating hand is at local +X, i.e. the anatomical left arm. On death, `GLBCharacter.playDeath()` plays `Flying Back Death.fbx` once over the whole body (IK suspended, hands follow the palms) until `revive()`; EnemyPlayer keeps its ragdoll during it, with knockback capped by `DEATH_KNOCKBACK_CAP`. Bomb blasts reuse the clip without dying: `EnemyPlayer.applyBlastKnockback()` (ragdoll + `playDeath()`, `revive()` in `_endRagdoll`, force/cap `BLAST_KNOCKBACK`) and `_blastPlayer()` in `bootstrapGameApp.js` for the local player. `BombThrowerEnemy` uses the same GLB with `armIK: false` (clips drive the arms, no floating hands): `playAction(glbCharacterConfig.throwClip)` plays `Throw.fbx` once and releases the bomb at `THROW_RELEASE_AT` of the clip; between throws a bomb mesh is snapped to the anatomical right palm (`getPalmWorldPosition('left')` — labels are mirrored). Blasts from other throwers play the death clip for `BLAST_STUN_MS`, then `revive()`.

**Mii characters** (`mii1.glb`, later `mii2.glb`… — `isMiiCharacterUrl` matches `/miiN.glb`) have no shoulders, arms or hands. `_buildArm` finds no chains, so `solveArm` leaves the floating hands where the game put them and `getPalmWorldPosition` returns a point beside the body (`palmFallback`, bomber / player bomb). Their hands are drawn by the sword: a Mii holds the Wii sword (`wii_sword.glb`, `SWORD_VARIANTS.wii` in `swordModel.js`) whose instances carry two brown ball hands on the handle. `createSwordModelInstance({ characterUrl })` picks the variant (`swordVariantForCharacter`); `FoamSword` swaps its model when the player's character changes, `EnemyPlayer._buildSword` uses the enemy's character, and `createSwordMesh(characterUrl)` (duel / battle opponents) the opponent's. New Mii: add the GLB, a `glbCharacterConfig` url and a `MATCH_CHARACTERS` entry.

### 7. Start screen + tutorial
After login the start screen shows only **Start Game** (runs the tutorial) until the profile has `tutorialCompleted: true`; after that it shows **Tutorial**, **Showdown**, **Classic** and **Multiplayer**. Auth resolves as soon as the player is logged in, so the game (and the settings panel) loads behind the start screen; a mode picked before it's ready is queued and started when `setModeHandler` is set (the auto phone-QR popup is deferred until a mode is picked, `autoShowPhoneSwordQr`). When the tutorial finishes, `arcadeOverlay.showStartScreen()` brings the start screen back and the mode handler starts the next mode in the running game. The ⚙️ settings button (`#settings-button`) sits above the start screen, the stage overlay and the Multiplayer lobby (z-index in `styles.css`), hidden until `body.settings-ready` (set once `initSettingsPanel` has run). The tutorial script (`src/tutorial/showdownTutorial.js`) drives enemies through `EnemyPlayer.script` (`passive` / `block` / `windup`) and the bomber's `throwsHeld` / `aimAt`, and touches the game only through `tutorialCtx` in `bootstrapGameApp.js`. While it runs, health never drops (`localHealth` setter), auto-buy is paused (it buys scripted), and tutorial enemies drop no coins and don't count as kills (`_tutorial`).

### 8. UI design system (`styles.css`)
Every screen — start screen, settings / shop / leaderboard (`.settings-shell`), stage screens, phone QR / calibration popups, Multiplayer lobby / battles, tutorial, game over, HUD — shares one dark glass look. The top of `styles.css` holds the **tokens** on `:root` (`--font-ui` Inter / `--font-display` Outfit, loaded from Google Fonts in `index.html`; `--surface*`, `--border*`, `--text*`, gold `--accent*`, status colours, `--radius-*`, `--shadow-*`, `--menu-bg` for full-screen menus, `--scrim` for modal backdrops) and three **shared components** applied by grouped selectors: **panel** (`.ui-panel`, `.arcade-shell`, `.settings-shell`, `.duel-lobby-panel`, `.ps-stage-inner`, phone popups…), **button** — gold primary (`.ui-btn`, `.arcade-button`, `.settings-button`, `.ps-stage-ok-btn`…), glass secondary (`.ui-btn-secondary`, `.arcade-secondary`, …) and ghost (`.ui-btn-ghost`, `.arcade-guest`, back buttons) — and **chip** (`.ui-chip`, settings / leaderboard tabs, stage time picker, stage character chooser arrows; selected = `.is-active` / `.active`). New UI: use the `ui-*` classes (or add the new class to the matching group) and the tokens, not new colours / fonts. HUD elements are `--surface-hud` pills without `backdrop-filter` (it would re-blur the 3D view every frame). Classic keeps its Wii-style lettering (stage banner, Ready/Go!, combo) but uses the shared panel/buttons. `public/phone-sword.html` repeats the tokens it needs in its own `:root`.

### 9. PIN Auth
No OAuth. Player registers with name + numeric PIN. PIN is `SALT + SHA-256` hashed client-side via Web Crypto, stored in Firebase. Hash cached in cookie for auto-login.

**Guest play:** "Play Without Signing In" on the login form (`data-arcade-guest` in `createArcadeOverlay`) skips auth with a random name (`randomGuestName`) and an in-memory profile (`buildGuestProfile`, all modes offered). `initCore` then has `isGuest` true and `profileNameKey` null — every profile save (`saveStats*` wrappers, stage/characters/tutorial/phoneSwordStats, localStorage `ps_*` keys) is skipped when the key is null, `playerName` isn't stored, and renaming only changes the session name. Guard new profile writes on `profileNameKey`.

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
   - Phone controller link (PeerJS); peer multiplayer starts only when Multiplayer mode is picked
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
| Sword model (sword.glb, or wii_sword.glb + ball hands for Mii characters; per-variant fit length / grip offset/rotation/scale / hands = `SWORD_VARIANTS`, brightness = `SWORD_BRIGHTNESS` (texture as emissive), metalness capped `SWORD_METALNESS`; bump `?v=` in `SWORD_MODEL_URL` / `WII_SWORD_MODEL_URL` when a GLB changes) | `src/items/swordModel.js`; used by `FoamSword.load` (`src/items/foamSword.js`) and `EnemyPlayer._buildSword` |
| Where the hands go (sword/shield/gun grip, enemy swings) | `src/models/playerModel.js`, `src/items/foamSword.js`/`shield.js`/`pistol.js` (gun hands + gun follow the aim pitch from `getAimDirection`, `GUN_AIM_*`), `src/characters/EnemyPlayer.js` |
| Add a new UI panel | `src/controls/`, lazy-load in `src/features/uiPanelsFeature.js` |
| Settings panel tabs: Profile (name + stats from `appState.getProfileStats` — Showdown `phoneSwordStats` {kills, deaths, highestStage ≥ currentStage via `normalizeStageStats`}, Classic `classicStats` {kills, deaths, highestStage}, level/XP/coins, max hearts, shield upgrades, bombs/bubbles, characters; Showdown leaderboard), Multiplayer (connection/room/ping/players, only live in Multiplayer mode), Display (audio, performance, gyro camera, high contrast, Camera: First Person View + Hide Body toggles, eye height / eye forward / first- and third-person body opacity / FOV sliders + Copy Values/Reset), Sword Gyro, About (credits + Clear Cache & Reload = Cache Storage + service worker), Account (delete, also clears the `ps_*` localStorage keys) | `src/controls/settingsPanel.js`; stats in `bootstrapGameApp.js` (`_psStats` / `_classicStats`, deaths counted in `showGameOver`), `src/player/playerProfile.js` (`normalizeStageStats`, `saveClassicStats`); camera = `PlayerControls.cameraConfig` / `setCameraConfig` (`CAMERA_CONFIG_DEFAULTS` {firstPerson, eyeHeight, eyeForward, hideBody, firstPersonOpacity, thirdPersonOpacity, fov}, saved as `sq:firstPersonCam`; normal view = `DEFAULT_CAMERA_*`; body fade = `_applyBodyOpacity`) in `src/controls/controls.js` |
| World map / ground height | `public/glb_map/map.glb`; loaded + height resolver registered in `bootstrapGameApp.js`; `src/environment/terrainHeight.js`, `src/map/spawnUtils.js` |
| Firebase data structure | `src/player/playerProfile.js` (profiles, leaderboard), `src/characters/merchant.js` (room shop stock) |
| Multiplayer protocol | `src/multiplayer/peerConnection.js`, `src/bootstrap/bootstrapGameApp.js` |
| Sword Showdown bombs / bomber (blast damage/knockback, explosion VFX, throw clip, held bomb) | `src/characters/BombThrowerEnemy.js` (`_explodeBomb`, `_updateHeldBomb`, throw logic in `update`; shared helpers `blastEnemiesAt`/`computeBombLobVelocity`/`createBombMesh`/`spawnBombExplosion`), `src/combat/explosionEffect.js`, `EnemyPlayer.applyBlastKnockback`, `_blastPlayer` in `bootstrapGameApp.js` |
| Sword Showdown sword blocking (explicit block stance/button + directional rule: swing must cross the blade by > `BLOCK_MIN_ANGLE_DEG`=30°; player block is more forgiving: `PLAYER_BLOCK_MIN_ANGLE_DEG`=15°, `PLAYER_BLOCK_REACH`) | `swingCrossesBlade` / `EnemyPlayer.blocksSwing` in `src/characters/EnemyPlayer.js`; player's block in `EnemyPlayer._checkSwordHitOnTarget`; enemy's block in the phone-sword hit loop in `bootstrapGameApp.js` (swing direction from `_psw.tipHistory`); swings/lunge ignored while blocking and for `PSW_BLOCK_TOGGLE_IGNORE_S` after Block is pressed/released (stance flip isn't a swing) |
| Fighter spacing (too close to land a swing) | Enemies step back below `TOO_CLOSE_DIST` until `CHASE_RANGE` apart (`_makingSpace` in `EnemyPlayer.update`); duel: local player steps back below `DUEL_MIN_SPACING` in the duel block of the game loop in `bootstrapGameApp.js` |
| Sword Showdown stage path (flattest-direction pick, enemy/coin placement, auto-walk) | `_psPickPathAngle` / `_psBuildStage` in `bootstrapGameApp.js`; auto-walk in the game loop (`_psAutoWalking`) |
| Damage hit effect (blood spray) | `src/combat/bloodEffect.js`; player trigger in `setStat` (`triggerPlayerHurtBlood`), enemies in `applyDamage` |
| Sword Showdown player bombs (💣 button, Throw.fbx, unequip/re-equip) | `src/combat/playerBomb.js` (flight/blast); `throwPlayerBomb`/`updatePlayerBombs` in `bootstrapGameApp.js` (count = `stats.bombs`, shop item `showdown_bomb`); button `psBombBtn` in `src/controls/controls.js` |
| Sword Showdown shop upgrades (heart/shield upgrade/bubble/bomb) | Catalog + purchase in `src/characters/merchant.js` (`unlimited` items); effects in `appState.applyShopUpgrade` (caps: `SHOWDOWN_MAX_HEALTH_SEGMENTS`=20 in `healthUtils.js`, also applies to level-ups; `SHOWDOWN_MAX_SHIELD_UPGRADES`=4 in `bootstrapGameApp.js`; `appState.isShopItemMaxed` → "MAX" in shop) + bubble system (`activatePlayerBubble`, `window.isPlayerBubbleActive`) in `bootstrapGameApp.js`; bubble button in `src/controls/controls.js`; enemy checks in `EnemyPlayer.js`/`BombThrowerEnemy.js`; auto-buy when out of bombs/bubbles/shield/gun/bullets = `psAutoBuyTick` (`PS_AUTO_BUY_ITEMS`, "Purchased …" toast via `showPickupToast` `options.text`) in `bootstrapGameApp.js`; shop coin balance + owned counts in `src/controls/merchantPanel.js` (`renderCoins`, `getOwnedCount`) |
| Sword Showdown health (5 segments at level 1, own max-health track, full health each session / stage start) | `SHOWDOWN_BASE_HEALTH_SEGMENTS` in `src/player/healthUtils.js`; `statsState.maxHealthSegments` is saved as the `showdownMaxHealthSegments` profile stat (`statsForSave` in `bootstrapGameApp.js`; older profiles fall back to their legacy `maxHealthSegments`); "never start dead" guard at the top of `_psStartStage` |
| Sword Showdown enemy difficulty per stage (enemy count: 15 at stage 1, +1/stage; hearts: all 1 at stage 1, more 2–3 heart enemies later — `_psEnemyCount` / `_psHeartsForStage`; swordsmen attacking at once: 1 for stages 1–7, up to 4; swing vs block/idle frequency) | `_psMaxAttackers` / `_psSwingChance` in `bootstrapGameApp.js` (attack slots in the game loop, `swingChance` passed in `_spawnHordeEnemy`); `EnemyPlayer.swingChance` used by `_decideNextPhase` in `src/characters/EnemyPlayer.js` |
| Sword Showdown kill counter (killed / total this stage) | `_psStageKills` / `_psStageTotal` / `_psUpdateKillHud` in `bootstrapGameApp.js` (`#ps-kill-counter`, `.ps-kill-counter` in `styles.css`) |
| Sword Showdown enemy swing telegraph (blade glows yellow + pulses faster during the wind-up, red during the swing) | `_buildSwingGlow` / `_updateSwingGlow` + `SWING_GLOW_*` in `src/characters/EnemyPlayer.js` |
| Sword Showdown heart bubbles (around the middle of each stage's path, more on later stages; drift in front of the player, sword poke pops for +1 health) | `src/combat/heartBubbles.js`; count `_psHeartBubbleCount`, spawned in `_psBuildStage`, popped by `_popHeartBubbles` after the phone-sword loop in `bootstrapGameApp.js` (`_frameBladePoints`) |
| Sword Showdown combo meter (consecutive sword hits; being hurt, pressing Block or a blocked swing ends it and pays that many coins; also paid on stage clear) | `src/combat/comboMeter.js` (`#combo-meter`, `.combo-*` in `styles.css`); `comboMeter` in `bootstrapGameApp.js` (`hit` in the phone-sword hit loop, `end` in `triggerPlayerHurtBlood` / block toggle / blocked swing / win) |
| Phone controller page (gyro sword + joystick, Block, bomb/gun/fire/shield/bubble/jump) | `public/phone-sword.html` (sends `gyro` packets with `joyAngle`/`joyForce`, `action` messages; shows host `status`); receiver `_attachPhoneSwordConn` / `_handlePhoneAction` in `bootstrapGameApp.js`; remote joystick also moves the player on desktop (`useJoystick` in `PlayerControls.processMovement`) |
| Sword gyro orientation + calibration (quaternions: device = Rz(α)·Rx(β)·Ry(γ), sword = earth→game(D·D0⁻¹) · neutral offsets `phoneSwordConfig`, sensitivity scales the rotation angle; yaw auto-recentre during calm moments — auto-walk with no enemy near / duel walk-in, not swinging or blocking, blade roughly upright — pulls `phoneSwordCalib.yawDrift` toward forward, faster the longer since the last manual calibration; adaptive one-euro smoothing `PSW_SMOOTH_*` — heavy when still, near passthrough on fast swings) | `_pswDeviceQuat` / `_pswEarthToGame` / `PSW_YAW_RECENTER_*` / `PSW_SMOOTH_*` + the phone-sword gyro loop in `bootstrapGameApp.js`; manual calibration `window.phoneSwordRecalibrate` / calib presets (`_resetSwordCalibDrift`) |
| Sword gyro sensitivity ("Use This Device" — game screen is also the sword, amplified — and QR phone) + on-screen touch controls (full-width Block/Fire bar at the bottom, joystick/buttons above it) | `window.phoneSwordLocalSensitivity` / `window.phoneSwordPhoneSensitivity` (QR phone) (defaults `PHONE_SWORD_LOCAL_SENSITIVITY_DEFAULT`=2 / `PHONE_SWORD_PHONE_SENSITIVITY_DEFAULT`=1, sliders in Settings → Sword Gyro in `src/controls/settingsPanel.js`, saved as `localStorage` `sq:swordLocalSensitivity` / `sq:swordPhoneSensitivity`; hit detection tuning = `window.phoneSwordSwingCfg` defaults only (the old `sq:swordSwingCfg` override is removed on load); all mode-independent — Showdown, tutorial and Multiplayer) + `phoneSwordGyro.localDevice` (local `deviceorientation` handler, scaled rotation in the phone-sword gyro loop) in `bootstrapGameApp.js`; `refreshActionButtons` / `layoutMobileActionButtons` (`body.mobile-block-bar`) in `src/controls/controls.js`, `body.mobile-block-bar` rules in `styles.css` |
| Gun / shield aim from the phone gyro (neutral = phone pose when the weapon is picked up or the sword recalibrated; rotation taken in that pose's game frame like the sword, so it never flips; phone yaw = amplified offset + continuous turn past a dead zone (hold the phone turned to spin round); phone tilt = amplified aim pitch; Showdown camera auto-aim pauses meanwhile) | `_updateWeaponGyroAim` / `WEAPON_AIM_*` in `bootstrapGameApp.js` (sets `playerControls.yaw` + `playerControls.weaponAimPitch`); `PlayerControls.getAimDirection` / camera pitch follow (`WEAPON_AIM_CAMERA_FOLLOW`) in `src/controls/controls.js`; arms + gun pitch in `src/items/pistol.js` |
| Stage screen Back button (→ start screen) | `#ps-stage-back` in `index.html`, handler next to `_resetForMenu` in `bootstrapGameApp.js`, `.ps-stage-back-btn` in `styles.css` |
| Start screen ("Start Game" = tutorial until `profiles/<key>/tutorialCompleted`; then Tutorial / Showdown / Classic / Multiplayer) + Sword Showdown tutorial (QR setup, hit past blocks, block swings, deflect a bomb, coins/auto-buy/bomb throw, shield, bubble, gun; player can't die, every step skippable) | `createArcadeOverlay` (`chooseMode`, `showStartScreen`, `setModeHandler`) + `tutorialCtx` / `startTutorialMode` / `_resetForMenu` in `bootstrapGameApp.js`; steps in `src/tutorial/showdownTutorial.js`; panel/arrows/button ring in `src/tutorial/tutorialOverlay.js` (`.tutorial-*` in `styles.css`); enemy hooks `EnemyPlayer.script` / `stationary` / `swordBounces`, `BombThrowerEnemy.throwsHeld` / `aimAt` / `stationary`; flag via `saveTutorialCompleted` / `hasCompletedTutorial` in `src/player/playerProfile.js`; phone button ring = `highlight` in the phone `status` message (`public/phone-sword.html`) |
| Audio | `src/audio/audioManager.js`, `public/assets/audio/`; Sword Showdown ambient loop = `SWORD_SHOWDOWN_BGS` in `bootstrapGameApp.js`; hurt vocals = `audioManager.playOuch(kind)` — ouch1 enemies via `playEnemyOuch()` (every 3rd or 4th hit across all enemies, `applyDamage`), ouch2 player hurt / ouch3 player death (`triggerPlayerHurtBlood`) |
| UI look (colours, fonts, radii, shadows; shared panel / button / chip styles) | Tokens on `:root` + shared component groups at the top of `styles.css`; fonts link in `index.html`; phone controller tokens in `public/phone-sword.html` `:root` |
| Add new 3D prop | Place GLB in `public/assets/props/`, load it from `bootstrapGameApp.js` (see `ROAD_LIGHT_MODEL_URL`) |
| Multiplayer mode (lobby of everyone online, challenge → private duel room, sword-only duels, best of 3 rounds (`DUEL_ROUNDS`, draw replays the round), 3-2-1-FIGHT then both auto-walk in (`startWalkIn`, stop at `DUEL_WALK_STOP_DIST`), 8 health segments every round (`DUEL_HEALTH_SEGMENTS` → `duelMaxHealthOverride`, never saved), WINNER banner, forfeit; temporary "Find Location" + "Copy location information" for picking the duel spot) | Lobby/duel state machine + DOM in `src/multiplayer/duelMode.js` (`DUEL_LOCATION` = where duels happen — paste the copied JSON there; `.duel-*` in `styles.css`); game side = `duelCtx` / `startMultiplayerMode` + duel sword hit check (`getOpponentCombat`) in the phone-sword loop of `bootstrapGameApp.js`; rooms / `joinRoom` / `destroy` in `src/multiplayer/peerConnection.js`; opponent grip IK = `userData.remoteHandTarget` in `updateRemotePlayerRig` (`src/models/playerModel.js`) |
| Sword Showdown characters (stage enemies (and bombers, from stage 3) are frog men plus characters unlocked so far; the last enemy of each stage is a boss of a locked non-frog character (any character once all are unlocked) with `PS_BOSS_HEARTS`=3+ hearts (+1 every `PS_BOSS_HEARTS_EVERY` stages), beating it unlocks that character; start unlocked = `PS_START_CHARACTERS` frog only; pick who to play as on the stage screen with the swipeable chooser — ‹ › / swipe / arrow keys, landing on an unlocked character selects it) | `_psChars` / `_psPickBoss` / `_psStageBoss` / `_psEnemyCharacterPool` / `_psBossHearts` in `bootstrapGameApp.js` (queue items carry `characterUrl` / `boss`; chooser + boss line built in `_psShowStageOverlay`, `#ps-stage-boss` / `#ps-stage-chars` in `index.html`, `.ps-stage-char-*` in `styles.css`); saved in localStorage `ps_chars_<key>` + `profiles/<key>/phoneSwordStats/characters` (`saveShowdownCharacters` / `loadShowdownCharacters` in `src/player/playerProfile.js`); roster = `MATCH_CHARACTERS` in `src/multiplayer/matchMode.js`; Tutorial/Multiplayer reset to the frog man and day lighting in `_resetForMenu` (outside Showdown stages it is always day — `getAutoMode` returns day) (also the `createPlayerModel` default) |
| Classic mode (Wii Sports Resort style Showdown: Miis only — player + enemies (`CLASSIC_MII_URLS` = Mii entries of `MATCH_CHARACTERS`), enemies get random names (`CLASSIC_NAMES`) shown as a name tag (yellow triangle, hearts + name) on the closest living enemy only; swordsmen only — no bombers, bosses, coins, heart bubbles, blood, XP or shop items/auto-buy; `CLASSIC_HEARTS`=3 hits per stage (enemy `swordDamage` 1, via `duelMaxHealthOverride`); Block is the only button (no joystick, jump, bomb/bubble/gun/shield — phone gets `blockOnly`); always day; stage screen = "Stage N" + stage name banner (`CLASSIC_STAGE_NAMES`) with OK / Recalibrate Sword / Back, then "Ready" → "Go!"; HUD = hearts bottom left, Score % (enemies defeated) bottom right, "N-hit Combo!" every 5th hit bottom middle; own stage progress) | `_classicMode` (declared at the top of `initCore`), `_setClassicMode` / `startClassicMode` / `_classicShowStageOverlay` / `_classicReadyGo` / `_psShowStageScreen` (stage screen for the current mode) in `bootstrapGameApp.js` (Classic branches in `_psBuildStage`, `_psStartStage`, the win/kill code and phone/joystick/jump handlers); `#classic-stage-overlay` / `#classic-callout` / `#classic-hearts` / `#classic-score` in `index.html`, `.classic-*` + `body.classic-mode` / `body.classic-playing` (hide the rest of the HUD) in `styles.css`; name tag = `nameTag` option / `_drawNameTag` / `setTargeted` in `src/characters/EnemyPlayer.js`; `setBloodEnabled` in `src/combat/bloodEffect.js`; `comboMeter.setClassic` in `src/combat/comboMeter.js`; stage saved in localStorage `ps_classic_stage_<key>` + `profiles/<key>/classicStats/currentStage` (`saveClassicStage` / `loadClassicStage` in `src/player/playerProfile.js`); phone `body.block-only` in `public/phone-sword.html` |
| Multiplayer battles: Team Battle (2 teams of 5, each team one character — pumpkin / antler / frog / gemhorn / wizard / mii1, host picks with 🔄, players pick a side) and Free For All (10 fighters, everyone picks a character); host invites online players (invite → join), a solo host sits in room `mm-<mode>` = the matchmaking queue, Start pulls queued players (pull → pullOk) and fills to `MATCH_SIZE`=10 with bots, private room `match-<matchId>`, spawn around `DUEL_LOCATION` (team lines / FFA ring), 8 health, auto-walk to the closest enemy (`MATCH_REENGAGE_DIST`), last team / fighter standing wins | Party/queue/battle state machine + DOM in `src/multiplayer/matchMode.js` (`MATCH_CHARACTERS`, `buildRoster`, `spawnPose`, host bot AI `updateBots` / `resolveBotHit`, `.match-*` in `styles.css`); game side = `matchCtx` in `bootstrapGameApp.js` (bots = `EnemyPlayer` with `characterUrl` / `swordDamage` / `showHealthBar` / `targetHitHandler`, host only; other clients see them as remote models); lobby buttons + `suspend`/`resume` in `duelMode.js`; sword hits on duel/battle opponents go through `_getPvpTargets` in the phone-sword loop; character swap = `setPlayerCharacterUrl` in `src/models/playerModel.js` |
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
