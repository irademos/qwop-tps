# Street Quest — Codebase Guide for AI Agents

## What This Is
A browser-based 3D multiplayer RPG. Players explore a procedurally extended real-world map (live OpenStreetMap data), fight monsters, complete quests, and interact with an AI NPC powered by Groq/Llama-3.1. The repo name "qwop-tps" is historical; the game is called **Street Quest**.

## Tech Stack
| Layer | Technology |
|---|---|
| 3D Rendering | Three.js v0.176 |
| Physics | Rapier3D (`@dimforge/rapier3d-compat`) |
| Multiplayer sync | Firebase Realtime Database (signaling) + PeerJS WebRTC |
| Map data | OpenStreetMap via Overpass API |
| AI NPC | Groq API (Llama 3.1) via `/api/llama` serverless function |
| Hand tracking | MediaPipe Tasks Vision |
| Build tool | Vite 6 |
| Deploy | Vercel (with `/api/` serverless functions) |
| Auth | PIN-based (SHA-256 hashed, stored in Firebase + cookie) |

---

## Directory Structure

```
/
├── index.html                  # HTML shell — all UI/HUD elements defined here
├── app.js                      # JS entry point — calls bootstrapGameApp()
├── styles.css                  # All game CSS (~50KB)
├── vite.config.js              # Build config (manual chunks: three, rapier, mediapipe, firebase)
├── vercel.json                 # Deployment config (SPA rewrites, cache headers)
│
├── src/                        # ALL source code lives here
│   ├── bootstrap/
│   │   └── bootstrapGameApp.js # THE game orchestrator — init + main game loop (~15k lines)
│   │
│   ├── core/                   # Shared infrastructure (no game logic)
│   │   ├── appContext.js       # Dependency injection container (entities/systems/uiState/settings/debugFlags)
│   │   ├── exposeDebugGlobals.js # Mirrors appContext onto window.* for dev console
│   │   ├── firebase-init.js    # Firebase app init from VITE_* env vars; exports `db`
│   │   ├── externalDeps.js     # Lazy CDN loaders for PeerJS and NippleJS
│   │   ├── ktx2Loader.js       # Shared KTX2Loader singleton for compressed textures
│   │   ├── requestQueue.js     # Async throttle/retry queue (used by Overpass API calls)
│   │   └── utils.js            # Cookie get/set utilities
│   │
│   ├── player/                 # Player-specific systems
│   │   ├── playerProfile.js    # Firebase persistence — stats, inventory, quests, PIN auth
│   │   ├── achievements.js     # Achievement tracking, claiming, merging state
│   │   ├── healthUtils.js      # Health segment math — base values, clamping, normalizing
│   │   ├── statSegments.js     # Hunger/magic/energy segment constants and clamping
│   │   ├── distanceUnits.js    # Miles vs. km preference; distance display formatting
│   │   ├── gravity.js          # Gravity constant and falling physics helpers
│   │   └── home.js             # Player home/cabin system — placement, bed sleep, storage
│   │
│   ├── npc/                    # NPC systems (friendly, enemy, quest)
│   │   ├── friendlyNpcManager.js  # Manages all friendly NPCs — wander, dialog, combat, Llama AI loop
│   │   ├── friendlyPersistence.js # Firebase read/write for friendly NPC states
│   │   ├── npcPersistence.js   # Base Firebase persistence for any NPC entity
│   │   ├── monsterPersistence.js  # Firebase read/write for monster HP/state
│   │   └── quest.js            # QuestManager class — tutorial quests, NPC spawns, XP rewards
│   │
│   ├── map/                    # Map data fetching and caching
│   │   ├── osmClient.js        # Fetches OSM data via Overpass API and MapTiler; throttle/retry
│   │   ├── osmGeoJson.js       # Converts raw Overpass XML/JSON to GeoJSON features
│   │   ├── idbCache.js         # IndexedDB tile cache (get/set/clear)
│   │   ├── tileCache.js        # Two-layer cache (in-memory + IndexedDB) for map tiles
│   │   ├── location.js         # GPS location provider; converts GPS coords to world space
│   │   └── spawnUtils.js       # Spawn point calculation, terrain-aligned Y positioning
│   │
│   ├── combat/                 # Combat utilities
│   │   ├── knockback.js        # Computes knockback impulse/motion vectors for hit reactions
│   │   └── pickupSpatialGrid.js # Spatial hash grid for fast nearby-item lookup (loot pickups)
│   │
│   ├── multiplayer/
│   │   └── peerConnection.js   # Multiplayer class — PeerJS WebRTC, Firebase signaling, star topology
│   │
│   ├── audio/
│   │   └── audioManager.js     # AudioManager class — spatial audio, BGS loops, SFX playback
│   │
│   ├── characters/             # Character classes (Three.js models + behavior)
│   │   ├── CharacterBase.js    # Base class — model ref, health, velocity, animation mixer
│   │   ├── CharacterSpawn.js   # Factory for creating character instances from loaded models
│   │   ├── PlayerCharacter.js  # Local player character (owned by PlayerControls)
│   │   ├── EnemyPlayer.js      # Remote multiplayer player character
│   │   ├── MonsterCharacter.js # Monster enemy — AI pathing, aggro, attack
│   │   ├── FriendlyCharacter.js # Friendly NPC — dialog, wander, combat assist
│   │   └── merchant.js         # Merchant NPC with shop inventory
│   │
│   ├── controls/               # Input handling and UI panels
│   │   ├── controls.js         # PlayerControls — keyboard/touch/joystick/hand input, movement physics, camera
│   │   ├── climb.js            # Climbing system — detects climbable surfaces
│   │   ├── craftPanel.js       # Crafting UI — recipes and crafting logic
│   │   ├── customize.js        # Character customization UI — skin, hats, shirts
│   │   ├── homeStoragePanel.js # Home storage chest UI
│   │   ├── llamaPanel.js       # UI panel for Llama AI NPC interaction
│   │   ├── merchantPanel.js    # Merchant shop UI — buy/sell
│   │   ├── popupDialog.js      # Generic popup dialog component
│   │   ├── settingsPanel.js    # Settings UI (graphics, audio, controls) + inventory panel
│   │   ├── speechCommands.js   # Web Speech API voice commands integration
│   │   └── spells.js           # Spell casting UI and spell effect logic
│   │
│   ├── environment/            # World/map rendering and environment systems
│   │   ├── MapLoader.ts        # Loads .mappack zip files (terrain mesh, grass, GLB objects)
│   │   ├── worldGeneration.js  # Procedural world generation — seeds terrain, places props
│   │   ├── mapRender.js        # Main map renderer — OSM data → 3D road/terrain meshes
│   │   ├── buildingsRender.js  # Renders OSM building footprints as 3D extruded geometry
│   │   ├── terrainHeight.js    # Terrain height field — stamp data per tile, height queries
│   │   ├── terrainStampDebugOverlay.js # Debug HUD for terrain stamp heatmap
│   │   ├── groundTiles.js      # Ground tile mesh generation
│   │   ├── mapView.js          # Overhead 2D minimap view
│   │   ├── nature.js           # Trees, rocks placement from OSM/procedural data
│   │   ├── animals.js          # Animal manager — deer, birds, crabs, fish, dogs with simple AI
│   │   ├── water.js            # Water mesh and depth queries (swimming)
│   │   ├── light_sources.js    # Dynamic light source registry — torch/lantern/campfire configs
│   │   ├── fire.js             # Campfire particle/mesh effect
│   │   ├── cabin.js            # Cabin prop placement and interaction
│   │   ├── tower.js            # Tower prop with climbable interior
│   │   ├── mushrooms.js        # Mushroom prop spawning and pickup
│   │   └── roadWidths.js       # OSM highway type → road width lookup table
│   │
│   ├── features/               # Lazy-load facade modules (enable Vite code splitting)
│   │   ├── audioFeature.js     # Re-exports AudioManager
│   │   ├── combatFeature.js    # Re-exports projectile/melee; lazy-loads special weapons
│   │   ├── persistenceFeature.js # Re-exports playerProfile + monsterPersistence
│   │   ├── mapFeature.js       # Lazy-loads mapView with transition timing
│   │   ├── uiPanelsFeature.js  # Lazy-loads crafting/merchant/customize/spells panels
│   │   └── loadingState.js     # Shows/hides loading chips in UI corner during async loads
│   │
│   ├── items/                  # Individual item/weapon implementations
│   │   ├── weapon.js           # Weapon base class
│   │   ├── melee.js            # ATTACKS registry, updateMeleeAttacks()
│   │   ├── projectiles.js      # Generic projectile spawning and update loop
│   │   ├── torch.js, lantern.js, apple.js, arrow.js, bow.js
│   │   ├── bed.js, craft_table.js, treasure_chest.js
│   │   └── (bazooka, bomb, foamSword, hammer, iceGun, pistol, shield, autumnSword)
│   │
│   ├── models/                 # 3D model loading
│   │   ├── monsterModel.js     # Loads/caches monster FBX models with animations
│   │   ├── playerModel.js      # Loads player FBX; updateProceduralPlayerRig() for IK hand positioning
│   │   └── handRotationDebug.js # Debug visualization for hand tracking rotation
│   │
│   ├── physics/
│   │   ├── rapierSafety.js     # Safe wrapper for world.removeRigidBody() (prevents double-remove crash)
│   │   └── staticBoxCollider.js # Creates/removes/syncs static box rigid bodies for scene props
│   │
│   ├── mediapipe/
│   │   ├── handTrackingManager.js # Main hand tracking — webcam, MediaPipe frame loop, gesture detection
│   │   └── mediapipeHelper.js  # Initializes HandLandmarker from local WASM models
│   │
│   └── workers/
│       └── osmWorker.js        # Web Worker — converts Overpass data to GeoJSON off main thread
│
├── api/                        # Vercel serverless functions
│   ├── llama.js                # Proxies to Groq (Llama 3.1) — builds RPG AI prompts, normalizes responses
│   └── overpass.js             # Overpass API proxy — rate limiting, dedup, 30s cache, endpoint rotation
│
├── public/                     # Static assets (served as-is)
│   ├── assets/audio/           # 150+ .ogg files (BGS loops + SFX)
│   ├── assets/props/           # 24 .glb weapon/furniture/tree models
│   ├── assets/textures/        # KTX2 PBR textures (grass, planks) + skybox JPGs
│   ├── assets/ui/items/        # PNG icons for inventory UI
│   ├── basis/                  # basis_transcoder.js + .wasm (KTX2 transcoding)
│   ├── map/map.mappack          # Pre-built map zip (default offline area)
│   ├── mediapipe/              # hand_landmarker.task + MediaPipe WASM binaries
│   ├── models/                 # FBX character models + animation FBXs + GLB accessories
│   └── service-worker.js       # PWA offline caching
│
├── docs/                       # Developer documentation
│   ├── asset-pipeline-compatibility.md  # glTF/FBX material + skinning notes
│   └── terrain-stamp-regression-checklist.md  # QA checklist for terrain stamping
│
└── scripts/                    # Node.js build/analysis scripts
    ├── extract-animations.mjs  # Extracts animation clips from FBX files
    └── generate-asset-report.mjs  # Reports dist/ file sizes with gzip/brotli
```

---

## Key Architectural Patterns

### 1. `appContext` — Central Dependency Injection
All shared runtime state lives in **`src/core/appContext.js`** in typed buckets:
```js
appContext.entities   // monsters[], animals[], weapons[], otherPlayers[]
appContext.systems    // playerControls, mapRenderer, rapierWorld, rbToMesh
appContext.uiState    // appState
appContext.settings   // user preferences
appContext.debugFlags // PERF, etc.
```
`exposeDebugGlobals.js` mirrors these onto `window.*` for browser console access. **Never use raw globals** — always go through `appContext`.

### 2. Feature Facade Pattern (`src/features/`)
Files in `features/` are **thin re-export + lazy-load wrappers** to enable Vite code splitting. For example, `combatFeature.js` re-exports the lightweight `melee.js`/`projectiles.js` APIs but lazy-loads heavy weapon modules (IceGun, Bazooka, Bow) on first use. When adding new heavy features, add a facade here.

### 3. Multiplayer: Star Topology
- Firebase Realtime Database = presence/signaling only
- PeerJS WebRTC = actual game state transport  
- One peer elected "host"; all others connect to host (star), host re-broadcasts
- Topology mode configurable via `VITE_NETWORK_TOPOLOGY_MODE` env var

### 4. Real-World Map Pipeline
```
GPS coords → osmClient.js (Overpass/MapTiler API)
          → osmWorker.js (Web Worker: XML/JSON → GeoJSON)
          → mapRender.js / buildingsRender.js (GeoJSON → Three.js meshes)
          → terrainHeight.js (stamp-based terrain height field)
```
Server-side Overpass proxy (`/api/overpass.js`) handles rate limiting, dedup, and endpoint rotation.

### 5. Terrain Stamp System (`src/environment/terrainHeight.js`)
Roads and buildings "stamp" the procedural terrain flat using priority-weighted influence. Stamps are stored per map tile and queried at runtime for physics height. See `docs/terrain-stamp-regression-checklist.md` for debugging.

### 6. AI NPC — Llama Loop
Every ~10 seconds, `friendlyNpcManager.js` sends NPC game state (HP, nearby entities, recent actions, current goal) to `/api/llama`, which calls Groq/Llama-3.1. The JSON response specifies `action` (move/attack/interact) and `speech`.

### 7. Custom Map Format (`.mappack`)
`MapLoader.ts` loads zipped map files containing:
- Terrain mesh + KTX2 splat textures
- Grass blade instance data
- Placed GLB scene objects

### 8. PIN Auth
No OAuth. Player registers with name + numeric PIN. PIN is `SALT + SHA-256` hashed client-side via Web Crypto, stored in Firebase. Hash cached in cookie for auto-login.

---

## Entry Points & Boot Sequence

1. **`index.html`** — defines all DOM (HUD, overlays, login form)
2. **`app.js`** — waits for `DOMContentLoaded`, calls `bootstrapGameApp()`
3. **`src/bootstrap/bootstrapGameApp.js`** — initializes everything in order:
   - Three.js scene + renderer
   - Rapier physics world
   - Firebase + player profile load
   - Map/OSM systems
   - Character spawning
   - Multiplayer (PeerJS)
   - Hand tracking (optional)
   - Main animation/game loop (`requestAnimationFrame`)

---

## Environment Variables (`.env` / Vercel)
| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_*` | Firebase project config (apiKey, authDomain, databaseURL, etc.) |
| `VITE_NETWORK_TOPOLOGY_MODE` | `star` (default) or `mesh` for multiplayer |
| `GROQ_API_KEY` | Used server-side in `/api/llama.js` |
| `MAPTILER_KEY` | Used in `src/map/osmClient.js` for MapTiler vector tiles |

---

## Common Task Locations

| Task | File(s) |
|---|---|
| Change player stats (health/hunger/magic) | `src/player/healthUtils.js`, `src/player/statSegments.js` |
| Add a new weapon | `src/items/<weapon>.js`, register in `src/features/combatFeature.js` |
| Modify NPC behavior | `src/npc/friendlyNpcManager.js` |
| Add a quest | `src/npc/quest.js` |
| Change movement/controls | `src/controls/controls.js` |
| Add a new UI panel | `src/controls/`, lazy-load in `src/features/uiPanelsFeature.js` |
| Modify map rendering | `src/environment/mapRender.js`, `src/environment/buildingsRender.js` |
| Change terrain generation | `src/environment/worldGeneration.js`, `src/environment/terrainHeight.js` |
| Firebase data structure | `src/player/playerProfile.js`, `src/npc/npcPersistence.js` |
| Multiplayer protocol | `src/multiplayer/peerConnection.js`, `src/bootstrap/bootstrapGameApp.js` |
| AI NPC prompt/behavior | `/api/llama.js` (server), `src/npc/friendlyNpcManager.js` (client) |
| Audio | `src/audio/audioManager.js`, `public/assets/audio/` |
| Add new 3D prop | Place GLB in `public/assets/props/`, load in relevant environment file |
| Serverless API changes | `/api/llama.js` or `/api/overpass.js` |

---

## Build & Dev

```bash
npm install          # Install dependencies
npm run dev          # Vite dev server at http://localhost:3000
npm run build        # Production build → dist/
```

Vite splits vendor chunks: `vendor-three`, `vendor-rapier`, `vendor-mediapipe`, `vendor-firebase`.

PWA service worker is at `public/service-worker.js` — update cache version when adding new static assets.
