# Sword Showdown — Codebase Guide for AI Agents

> **Maintenance rule for AI agents:** this file is the short overview; the detail lives in `docs/` (index below). When your change adds / removes / renames source files, moves logic between modules, adds a pattern, a feature or an env var, update the doc that covers it **in the same commit**: the area's row in `docs/areas/*.md` (or a new row), `docs/codebase-map.md` for files, `docs/architecture.md` for patterns — and this file only if the overview, the index or a rule here changes. Keep this file short: details go in `docs/`. Stale docs cost more tokens than fresh ones.

## What this is
A browser-based 3D sword-fighting game, **Sword Showdown** (the repo name "qwop-tps" is historical). The player's **phone is the sword controller** (gyro + joystick over PeerJS, `public/phone-sword.html`); the desktop / TV / phone browser runs the game (or "Use This Device" makes the game's own phone the sword). An installable PWA that plays offline once cached. Modes, picked on the start screen (a guest plays without signing in; signed in = PIN auth, saves in Firebase):

- **Tutorial** — scripted lessons (blocking, bombs, bow, wand…); "Start Game" until finished.
- **Showdown** — single player, stage by stage along island paths: waves of swordsmen / bombers / wand casters / archers, a boss that talks first, a village between stages (shop, characters, campfire), the story of Pemberton (final boss, stage 11), then **open roam** with quests and a pirate-ship **voyage**.
- **Endless** — Showdown's waves with no end while auto-walking every stage route; best kills per device / profile.
- **Classic** — Wii Sports Resort–style: Miis, swordsmen only, 3 hearts, Block only.
- **Town** — a living town (Brindlewick) on the island: ~18 townsfolk with homes, jobs, needs and a day / night clock; an economy of wood / fish / veg; fishing, chopping, farming, cooking, the cart / canoe / broom; crime, wanted stars and jail; bandits and the nightly defense; quest **jobs** made of reusable beats; a **shared Town** for up to 12 players.
- **Story** — one player on Tree Island (washed up, the Crow, the sacred tree…); an engine running chapter data, reusing Town's systems.
- **Multiplayer** — a lobby, 1v1 duels, Team Battle (5 v 5) / Free For All with bots, matchmaking and arena pickups, as Survival or Most Kills.

The whole game in detail: [`docs/game-overview.md`](docs/game-overview.md).

## Tech stack
| Layer | Technology |
|---|---|
| 3D rendering | Three.js v0.176 (+ `three-mesh-bvh` for map raycasts) |
| Physics | Rapier3D (`@dimforge/rapier3d` — its `.wasm` streamed as a file: `src/physics/rapier.js` + `rapierWasmShim` in `vite.config.js`; import `RAPIER` from `src/physics/rapier.js`) |
| Multiplayer | Firebase Realtime Database (lobby / presence / signalling, shop stock, Town rooms) + PeerJS WebRTC (Multiplayer, a shared Town, and separately the phone controller link) |
| Map | Map-editor `.mappack` (`public/mappacks/island_town.mappack`, `src/map/MapLoader.ts` + `jszip`, KTX2 via `public/basis/`) for every mode but Classic (`public/glb_map/map.glb`); ground height via BVH raycasts |
| Build / deploy | Vite 6 / Vercel (+ the `/api/turn-credentials` serverless function) |
| Auth | PIN-based (SHA-256 hashed, Firebase + cookie); guest play saves nothing |

## Layout (the essentials — every file: [`docs/codebase-map.md`](docs/codebase-map.md))
```
index.html, styles.css, app.js     # DOM for all HUD / overlays · all CSS (tokens + shared components on top) · entry → bootstrapGameApp()
vite.config.js, vercel.json        # build (chunks, Rapier wasm shim, offline manifest, version.json) · deploy
src/bootstrap/bootstrapGameApp.js  # THE orchestrator (~14k lines): init, maps, stages (_ps*), phone link, stats / shop, networking, the game loop
src/core/          # infrastructure only — appContext (DI), firebase-init, offline cache, update banner, install prompt, wake lock
src/controls/      # PlayerControls (input, movement, camera, on-screen buttons), settings panel, shop panel, gyro hint
src/characters/    # EnemyPlayer (swordsman AI), BombThrowerEnemy, boss fighters (pembertonBoss.js), stage bosses' talk, giant, merchant catalog
src/models/        # GLB characters, Mixamo clip retargeting + IK arms (glbCharacterModel.js, fluffyCharacter.ts), player rig
src/items/         # weapons (sword / bow / shield / wand / rod / oar), projectiles, props (canoe, cart, broom, lantern, fish, veg…)
src/combat/        # bombs, blasts, blood / explosion / impact effects, hit feel, combo meter, sword combos + trail, death carry
src/environment/   # ground height registry, map collision, obstacles / trunks, art style, shadows, birds, eye fish, ruins
src/map/           # MapLoader (mappacks), stage routes, spawn
src/village/       # Showdown's village between stages (+ open roam)
src/tutorial/      # the scripted tutorial + its overlay
src/multiplayer/   # peer connection, duel lobby, battles (matchMode), pickups, matchConfig (roster / arena)
src/town/          # Town: townMode.js installs townX.js modules on the shared state `T`; beats/ + quests/ = jobs data
src/story/         # Story engine (storyMode.js) + chapter data (chapter1.js), its characters / props
src/quest/         # the shared quest runner + talks (Town's jobs, Story's chapters)
src/audio/         # audio manager, UI sounds, text to speech
src/endless/, src/dev/, src/player/, src/physics/, src/features/  # Endless chooser · dev free roam · profile / health maths · Rapier · lazy facades
public/            # phone-sword.html, mappacks, GLB characters / props / clips, audio, icons, service worker
docs/              # this guide's detail (below)
```

## Key patterns (in full: [`docs/architecture.md`](docs/architecture.md))
1. **`appContext`** (`src/core/appContext.js`) — shared runtime state in typed buckets (`entities`, `systems`, `uiState`, `settings`, `debugFlags`), mirrored onto `window.*` for the dev console. New code goes through it, not new globals.
2. **Code splitting** — `src/features/` facades lazy-load heavy pieces. **Modes load on first use:** Town (+ townNet, diving, the sea start and Story — `src/town/townModules.js`), Multiplayer (`duelMode.js` + `matchMode.js`) and the tutorial are separate chunks (`MODE_MODULES` / `_loadModeModules` before `_startMode` in `bootstrapGameApp.js`, prefetched at idle). Until made, `town` / `story` / `seaStart` / `townNet` / `_townDive` / `duelMode` / `matchMode` / `showdownTutorial` are `null` — **guard every use with `?.`**, and never import those modules statically from the main chunk (shared constants go in a small module like `matchConfig.js`).
3. **The game loop** — `animate()` in `bootstrapGameApp.js` calls its parts in order (`_framePhysicsSync`, `_framePickups`, `_frameSwordGyro`, `_frameSwordHits`, `_frameStage`, `_frameTownCamera`, `_framePvpCamera`, `_frameJump`, `_frameHorde`, `_frameNetwork`, defined just before it). Put new per-frame work in a part, not inline — `animate()` must stay well under V8's ~60 KB bytecode limit for optimisation. Reuse scratch vectors in per-frame code instead of `new THREE.Vector3()` / `.clone()`.
4. **Context objects** — big subsystems (town, story, village, tutorial, duel, match, sea start) get a `ctx` of callbacks from `bootstrapGameApp.js` and touch the game only through it. Town's modules each `installTownX(T, ctx)` onto one shared state object `T`.
5. **Multiplayer** — peers exist only in Multiplayer and a shared Town (`multiplayer` is `null` elsewhere — guard it). Firebase = presence / rooms / signalling; PeerJS star topology with a host per room; message types `presence`, `projectile`, `duel`, `match`, `town`. Battle / shared-town hosts simulate bots / townsfolk.
6. **World** — `MAPS` / `_setActiveMap` in `bootstrapGameApp.js` (island mappack for all modes but Classic); every ground-height query goes through the resolver registry in `src/environment/terrainHeight.js`; Tree Island streams in from the sea, no map switch.
7. **Characters** — one Mixamo skeleton for every GLB character; clips from `animations.glb` drive the body, a two-bone IK drives the arms to floating hands (the weapon attach points). Hand labels are mirrored (`'right'` = anatomical left).
8. **UI** — one dark-glass design system in `styles.css` (tokens on `:root`, shared `ui-*` panel / button / chip classes); emoji in the DOM are drawn as icons by `public/assets/ui/icons/pixelIcons.js`. Minimal on-screen text; emoji only where it is the content.
9. **Auth / saves** — guests save nothing: guard every profile write on `profileNameKey`. Town / Endless set the real gear / coins aside (`_saveAside`) while they run.

## Entry & boot
`index.html` → `app.js` → `bootstrapGameApp()`: scene + renderer, Rapier (its `.wasm` starts downloading as the code loads — `_rapierReady`), Firebase + profile, the default map (not waited on — `_defaultMapReady`), the player, the phone link, then the game loop. A mode picked on the start screen loads its map and (if lazy) its code, then starts.

## Environment Variables (`.env` / Vercel)
| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_*` | Firebase project config (apiKey, authDomain, databaseURL, etc.) |
| `VITE_NETWORK_TOPOLOGY_MODE` | `star` (default) or `mesh` for multiplayer |
| `VITE_METERED_API_KEY` | TURN credentials (Metered) — `api/turn-credentials.js` and `src/multiplayer/peerConnection.js` |

## Where to look — `docs/`
| Doc | What's in it |
|---|---|
| [`docs/areas/player.md`](docs/areas/player.md) | Character models / clips / IK, movement, roll, climbing, swimming, art style, player stats |
| [`docs/areas/combat.md`](docs/areas/combat.md) | Sword blocking / swings / combos, bow, bombs, wand + mana, hit reactions and effects, ranged turns, parries, camera auto-aim |
| [`docs/areas/phone-controls.md`](docs/areas/phone-controls.md) | Phone controller page, gyro maths + calibration, sensitivity, on-screen gear buttons, phone aiming, "move your phone" hint, wake lock |
| [`docs/areas/showdown.md`](docs/areas/showdown.md) | Stages + routes, the village, shop, characters / bosses / Pemberton, open roam, voyage, Endless, Classic, start screen + tutorial, pause |
| [`docs/areas/multiplayer.md`](docs/areas/multiplayer.md) | Lobby + duels, battles, pickups, protocol, stats + leaderboards, Firebase layout |
| [`docs/areas/town.md`](docs/areas/town.md) | Town mode core: layout, townsfolk, economy, rooms, homes, law, bandits + raids, the shared town, the book, lights, lantern, voices, HUD |
| [`docs/areas/town-activities.md`](docs/areas/town-activities.md) | Fishing, trees, farming, diving, canoe, cart, broom, chickens, octopus, ruins, the guest's sea start |
| [`docs/areas/town-quests.md`](docs/areas/town-quests.md) | Quest runner + beats, the first day, job branches (wizard, fisher…), night defense, job songs, guidance markers |
| [`docs/areas/story-and-islands.md`](docs/areas/story-and-islands.md) | Story mode, Tree Island streaming, the giant |
| [`docs/areas/world.md`](docs/areas/world.md) | Maps / ground height, shadows + the moving sun, birds, eye fish, road lights, adding props |
| [`docs/areas/app.md`](docs/areas/app.md) | Settings panel, UI look, audio, offline PWA, update banner, install prompt, dev tools, serverless API |
| [`docs/architecture.md`](docs/architecture.md) | The key patterns above in full |
| [`docs/codebase-map.md`](docs/codebase-map.md) | Every file and what it holds |
| [`docs/game-overview.md`](docs/game-overview.md) | The whole game described in detail |
| `docs/asset-pipeline-compatibility.md`, `docs/archive/` | glTF / FBX notes; retired code kept for reference |

Find a feature fast: `grep -n "<keyword>" docs/areas/*.md` — each row names the functions / constants / files.

## Rules
- Don't bypass `appContext` with new `window.*` globals; don't add game logic to `src/core/` (infrastructure only).
- Don't import heavy modules at the top level — use a facade (`src/features/`) or the lazy mode groups; guard the lazy mode objects with `?.`.
- Keep per-frame work allocation-free and out of `animate()` itself (see Key patterns 3).
- Import Rapier from `src/physics/rapier.js`, never from `@dimforge/rapier3d` directly.
- Guard profile writes on `profileNameKey` (guests save nothing).
- New UI uses the `ui-*` classes and tokens in `styles.css`, not new colours / fonts.
- Bump `?v=` on a GLB's URL when the file changes (they're cached for a year); run `npm run optimize:mappack` / `optimize:animations` after editor / Blender exports.
- Don't modify `public/service-worker.js`'s caching without checking `src/core/offlineCache.js` and the offline manifest in `vite.config.js`.

## Build & Dev

```bash
npm install          # Install dependencies
npm run dev          # Vite dev server at http://localhost:3000
npm run build        # Production build → dist/
```

Vite splits vendor chunks: `vendor-three`, `vendor-rapier` (the JS glue — Rapier's `.wasm` is its own asset), `vendor`; the mode chunks `townModules` / `duelMode` / `matchMode` / `showdownTutorial` load on first use.

PWA service worker: `public/service-worker.js` caches `offline-<build id>` from the build's `offline-manifest.json` — new static assets are picked up by the next build automatically (unless matched by `OFFLINE_SKIP` in `vite.config.js`).

### Headless browser testing (Playwright / the pre-installed Chromium)

- **No phone popup under automation:** the phone link / QR popup never comes up by itself when `navigator.webdriver` is true (Playwright) or the URL has `?noPhonePopup` (`PHONE_SWORD_AUTO_POPUP` in `bootstrapGameApp.js`), so screenshots aren't covered by it — don't dismiss it. Add `?phonePopup` to test the popup itself (Settings → Show Phone QR Code opens it either way).
- **Known artifact — ignore it:** in headless Chromium (SwiftShader software GL) the skybox renders as big flat **dark-blue and grey triangles** across the sky when the camera faces some directions. It happens with every scene object hidden and at the island's spawn too, so it is the headless renderer, not the map, a mesh or your change. Don't debug it.
- **Build without a `.env`:** Firebase throws at boot without a database URL. Build with fake values and serve `dist/` statically: `VITE_FIREBASE_DATABASE_URL=https://fake-test-default-rtdb.firebaseio.com VITE_FIREBASE_PROJECT_ID=fake-test VITE_FIREBASE_API_KEY=x VITE_FIREBASE_APP_ID=1:1:web:1 npx vite build --outDir <scratch>/dist`, then `python3 -m http.server 4173 -d <scratch>/dist`. Network errors (Firebase, PeerJS CDN) in the console are expected; Town falls back to "just you". Launch with `--use-gl=swiftshader --enable-unsafe-swiftshader`.
- **Getting into Town:** the page opens as a guest on the start screen; click `[data-arcade-town]` (or, with the sea start turned back on, set `seaStart.debug().boat` to `x = -71, z = -102` until `seaStart.interactLabel() === 'Get out'`, then `seaStart.interact()`); wait for `town.isActive() && town.debug().T.ready`. Then `town.debug().ctx.teleport(x, z, yaw)` moves the player, `town.debug().T.acts` lists the interact buttons (`a.onClick()`), and `window.playerControls.yaw` turns the camera (set it every frame for a while — other code resets it).
- Software rendering is slow: loads that take a second on a GPU (a mappack, a big GLB) can take 20–30 s, so wait on a condition, not a fixed sleep.
