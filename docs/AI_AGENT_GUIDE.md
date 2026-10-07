# Sword Showdown — AI Agent Quick-Start Guide

> **Maintenance rule:** When you add/remove/rename files, change module responsibilities, or alter the boot sequence, update this file and `CLAUDE.md` in the same commit. Accurate docs save tokens on every future task.

**Game name:** Sword Showdown (repo name `qwop-tps` is historical)  
**Type:** Browser-based 3D sword-fighting game; your phone is the sword (gyro controller via PeerJS). Modes: Tutorial, Showdown (single player), Classic (Wii-style Showdown: Miis, 3 hearts, Block only) and Multiplayer (lobby + 1v1 sword duels, Team Battle 5v5, Free For All and Guns & Bombs with matchmaking + bots).  
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
| All CSS | `styles.css` — design tokens on `:root` + shared panel / button (primary, secondary, ghost) / chip components at the top; reuse the `ui-*` classes and tokens for new UI |
| Serverless function (Vercel) | `api/turn-credentials.js` |
| Static assets | `public/` (GLB map, character, clips, audio) |
| Build | `npm run dev` (port 3000) · `npm run build` |

**Rule:** Prefer `appContext.entities`, `.systems`, `.uiState`, `.settings`, `.debugFlags` over new raw globals.

---

## Tech Stack (one-liner each)

- **Rendering:** Three.js v0.176 (+ `three-mesh-bvh` for map raycasts)
- **Physics:** Rapier3D (`@dimforge/rapier3d-compat`)
- **Multiplayer:** Multiplayer mode only (Showdown is single player). Firebase (`peers` = lobby list, `rooms` = lobby / private duel rooms / `mm-<mode>` matchmaking queue / `party-<hostId>` / `match-<matchId>`, shop stock) + PeerJS WebRTC; messages: `presence`, `projectile`, `duel`, `match`
- **World:** static GLB map (`public/glb_map/map.glb`)
- **Auth:** PIN → SHA-256 → Firebase + cookie (no OAuth); the app opens as a guest (unless a stored PIN auto-logs in); "Sign In" on the start screen reloads to the login form (`sq:showLogin` sessionStorage flag); guest = random name, `profileNameKey` null, nothing saved (guard profile writes on `profileNameKey`)
- **Build:** Vite 6, deployed on Vercel

---

## Source Directory Map

```
src/
  bootstrap/    bootstrapGameApp.js       ← game init, GLB map, stages (_ps*), phone link, shop/stats, rAF loop
  core/         appContext, exposeDebugGlobals, firebase-init, externalDeps (PeerJS/NippleJS CDN), utils (cookies)
  player/       playerProfile (Firebase stats/inventory/PIN/leaderboard), healthUtils
  map/          spawnUtils
  environment/  terrainHeight (height resolver registry), mapCollision (bullet / bomb segment raycast vs the map BVH), artStyle (load-time texture pass that matches characters/props to the map's look), blobShadows (cheap disc shadows under characters on the low performance tier)
  combat/       knockback, bloodEffect (damage blood spray), bulletImpact (sparks + dust where a bullet hits the map), explosionEffect (bomb explosion + smoke), playerBomb (player bombs), heartBubbles (Showdown heart bubbles), comboMeter (Showdown combo HUD; Classic "N-hit Combo!"), deathCarry (Showdown death: frog men carry the player off)
  multiplayer/  peerConnection (rooms, joinRoom, destroy), duelMode (lobby, challenges, duels, temp find-location), matchMode (Team Battle / Free For All / Guns & Bombs: parties, matchmaking, bots, battles)
  audio/        audioManager
  characters/   CharacterBase, PlayerCharacter, EnemyPlayer (swordsman), BombThrowerEnemy (bomber), merchant (shop catalog/stock)
  controls/     PlayerControls (controls.js), merchantPanel (shop UI), settingsPanel
  features/     Lazy-load facades for code splitting (audio, combat, persistence, uiPanels, loadingState)
  items/        weapon.js + foamSword (sword.glb via swordModel.js), shield, pistol + projectiles.js
  village/      villageMode (Showdown hub between stages: stall shop + mystery chest, character pick, time of day, arrow to the next stage (calibration popup before each stage))
  tutorial/     showdownTutorial (scripted tutorial steps), tutorialOverlay (panel, arrows/bars, button ring)
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
| Sword model / grip placement / brightness (variants: `default` = sword.glb, `wii` = wii_sword.glb + Mii ball hands) | `src/items/swordModel.js` (`SWORD_VARIANTS`, `swordVariantForCharacter`, `SWORD_BRIGHTNESS`) |
| Where hands go (sword/shield/gun grip) | `src/models/playerModel.js` (`updateProceduralPlayerRig`), `src/items/foamSword.js`, `shield.js`, `pistol.js` (gun hands + gun follow the aim pitch from `getAimDirection`, `GUN_AIM_*`); enemies: `src/characters/EnemyPlayer.js` |
| New UI panel | `src/controls/<panel>.js` + lazy-load in `src/features/uiPanelsFeature.js` |
| Settings panel (Profile stats, Multiplayer status, Display incl. Camera: First Person View / Hide Body toggles, eye + body opacity + FOV sliders, Copy Values, Sword Gyro, About + Clear Cache & Reload, Account delete) | `src/controls/settingsPanel.js`; stats = `appState.getProfileStats` + `_psStats` / `_classicStats` in `bootstrapGameApp.js`, `normalizeStageStats` / `saveClassicStats` in `src/player/playerProfile.js`; camera = `PlayerControls.cameraConfig` (`sq:firstPersonCam`) in `src/controls/controls.js` |
| Art style unifier (character textures matched to the map, shared grade) | `src/environment/artStyle.js` (`artStyleConfig`) |
| Character shadows (sun shadow box follows the player, map receives but doesn't cast; low tier = blob shadows) | `SHADOW_LIGHT_OFFSET` / `SHADOW_HALF_SIZE`, `applyRendererPerformanceSettings` + light follow before `renderer.render` in `bootstrapGameApp.js`; `src/environment/blobShadows.js` |
| World map / ground height | `public/glb_map/map.glb`; loaded in `bootstrapGameApp.js`; `src/environment/terrainHeight.js`, `src/map/spawnUtils.js` |
| Firebase data shape | `src/player/playerProfile.js`, `src/characters/merchant.js` (room shop stock) |
| Multiplayer protocol | `src/multiplayer/peerConnection.js`, `src/bootstrap/bootstrapGameApp.js` |
| Multiplayer mode (lobby of everyone online, challenge → private duel room, sword-only duels, best of 3 rounds (`DUEL_ROUNDS`, draw replays the round), 3-2-1-FIGHT then both auto-walk in (`startWalkIn`, stop at `DUEL_WALK_STOP_DIST`), 8 health segments every round (`DUEL_HEALTH_SEGMENTS` → `duelMaxHealthOverride`, never saved), WINNER banner, forfeit; temporary "Find Location" + "Copy location information" for picking the duel spot) | Lobby/duel state machine + DOM in `src/multiplayer/duelMode.js` (`DUEL_LOCATION` = where duels happen — paste the copied JSON there; `.duel-*` in `styles.css`); game side = `duelCtx` / `startMultiplayerMode` + duel sword hit check (`getOpponentCombat`) in the phone-sword loop of `bootstrapGameApp.js`; rooms / `joinRoom` / `destroy` in `src/multiplayer/peerConnection.js`; opponent grip IK = `userData.remoteHandTarget` in `updateRemotePlayerRig` (`src/models/playerModel.js`) |
| Sword Showdown village (between stages, replaces the old stage screen: built around the player — market stall + merchant (wizard) with items on the counter (life potion = refill health 30🪙, mana potion = coming soon, bomb, bullets, gun, shield, heart / shield upgrades, bubble), mystery treasure chest (`TREASURE_CHEST_PRICE`=50, weighted random prize), unlocked characters idling (tap → it walks over and swaps with the player), floating ☀️ 🎲 🌙 (next stage's time of day, previewed), arrow along the next stage's path (tap → the sword calibration popup `#phone-sword-connect-calib` must be okayed (`confirmStart` → `_requireSwordCalibration`), then the stage starts + STAGE N banner); after a stage win it is built a little way ahead (`_psShowVillage(…, { approach: true })` → `enter({ center })`, `PS_VILLAGE_APPROACH_DISTS`) and the player walks in under the STAGE COMPLETE! banner with the normal follow camera (the village camera + UI take over on arrival); tap / click walks the player over and focuses the camera; ⬅ Lobby top left, ⬅ Village bottom middle (`.village-back-bottom`, panel moved up by `.village-focused`); counter items stand on `COUNTER_SURFACE_Y`; buy card above the selected item, ‹ › / swipe / arrow keys) | `src/village/villageMode.js` (`createVillage`: layout `LAYOUT`, counter items `SHOP_ITEMS`, prop scales `VILLAGE_PROP_SCALE` / `MARKET_STALL_SIZE` / potion offsets / `TREASURE_CHEST_SCALE`, camera `VILLAGE_FOV` / `setView`; DOM `.village-*` + `body.village-mode` in `styles.css`); game side = `villageCtx` (`villageShop`, `_openTreasureChest`, `VILLAGE_ITEM_TEXT`) + `_psShowVillage` / `_psPreviewTime` / `village.update` in the game loop in `bootstrapGameApp.js`; `_psStartStage(…, { pathAngle, inPlace })`; life potion = `life_potion` in `src/characters/merchant.js` + `appState.applyShopUpgrade`; GLBs `public/assets/props/market_stall.glb` / `life_potion.glb` / `mana_potion.glb` / `treasure_chest.glb` |
| Sword Showdown characters (stage enemies (and bombers, from stage 3) are frog men plus characters unlocked so far; the last enemy of each stage is a boss of a locked non-frog character (any character once all are unlocked) with `PS_BOSS_HEARTS`=3+ hearts (+1 every `PS_BOSS_HEARTS_EVERY` stages), beating it unlocks that character; start unlocked = `PS_START_CHARACTERS` frog only; pick who to play as in the village (tap an idling character)) | `_psChars` / `_psPickBoss` / `_psStageBoss` / `_psEnemyCharacterPool` / `_psBossHearts` in `bootstrapGameApp.js` (queue items carry `characterUrl` / `boss`; boss line built in `_psShowVillage`, character pick = `characters` in `villageCtx` / `pickCharacter` in `src/village/villageMode.js`); saved in localStorage `ps_chars_<key>` + `profiles/<key>/phoneSwordStats/characters` (`saveShowdownCharacters` / `loadShowdownCharacters` in `src/player/playerProfile.js`); roster = `MATCH_CHARACTERS` in `src/multiplayer/matchMode.js`; Tutorial/Multiplayer reset to the frog man and day lighting in `_resetForMenu` (outside Showdown stages it is always day — `getAutoMode` returns day) (also the `createPlayerModel` default) |
| Classic mode (Wii Sports Resort style Showdown: Miis only — player + enemies (`CLASSIC_MII_URLS` = Mii entries of `MATCH_CHARACTERS`), enemies get random names (`CLASSIC_NAMES`) shown as a name tag (yellow triangle, hearts + name) on the closest living enemy only; swordsmen only — no bombers, bosses, coins, heart bubbles, blood, XP or shop items/auto-buy; `CLASSIC_HEARTS`=3 hits per stage (enemy `swordDamage` 1, via `duelMaxHealthOverride`); Block is the only button (no joystick, jump, bomb/bubble/gun/shield — phone gets `blockOnly`); always day; stage screen = "Stage N" + stage name banner (`CLASSIC_STAGE_NAMES`) with OK / Recalibrate Sword / Back, then "Ready" → "Go!"; HUD = hearts bottom left, Score % (enemies defeated) bottom right, "N-hit Combo!" every 5th hit bottom middle; own stage progress) | `_classicMode` (declared at the top of `initCore`), `_setClassicMode` / `startClassicMode` / `_classicShowStageOverlay` / `_classicReadyGo` / `_psShowStageScreen` (stage screen for the current mode) in `bootstrapGameApp.js` (Classic branches in `_psBuildStage`, `_psStartStage`, the win/kill code and phone/joystick/jump handlers); `#classic-stage-overlay` / `#classic-callout` / `#classic-hearts` / `#classic-score` in `index.html`, `.classic-*` + `body.classic-mode` / `body.classic-playing` (hide the rest of the HUD) in `styles.css`; name tag = `nameTag` option / `_drawNameTag` / `setTargeted` in `src/characters/EnemyPlayer.js`; `setBloodEnabled` in `src/combat/bloodEffect.js`; `comboMeter.setClassic` in `src/combat/comboMeter.js`; stage saved in localStorage `ps_classic_stage_<key>` + `profiles/<key>/classicStats/currentStage` (`saveClassicStage` / `loadClassicStage` in `src/player/playerProfile.js`); phone `body.block-only` in `public/phone-sword.html` |
| Multiplayer battles: Team Battle (2 teams of 5, each team one character — pumpkin / antler / frog / gemhorn / wizard / tree / mii1, host picks with 🔄, players pick a side) and Free For All (10 fighters, everyone picks a character — also Guns & Bombs — with a swipeable card: swipe / ‹ › / arrow keys, `charChooser`; only characters unlocked in Showdown — `matchCtx.getUnlockedCharacters` = `_psChars.unlocked` — the rest show a lock; Team Battle is not locked); host invites online players (invite → join), a solo host sits in room `mm-<mode>` = the matchmaking queue, Start pulls queued players (pull → pullOk) and fills to `MATCH_SIZE`=10 with bots, private room `match-<matchId>`, spawn around `DUEL_LOCATION` (team lines / FFA ring; Guns & Bombs scattered 9–20 m around `GUNS_LOCATION`, `GUNS_SPAWN_RADIUS`), 8 health, auto-walk to the closest enemy (`MATCH_REENGAGE_DIST`), last team / fighter standing wins | Party/queue/battle state machine + DOM in `src/multiplayer/matchMode.js` (`MATCH_CHARACTERS`, `buildRoster`, `spawnPose`, host bot AI `updateBots` / `resolveBotHit`, `.match-*` in `styles.css`); game side = `matchCtx` in `bootstrapGameApp.js` (bots = `EnemyPlayer` with `characterUrl` / `swordDamage` / `showHealthBar` / `targetHitHandler`, host only; other clients see them as remote models); lobby buttons + `suspend`/`resume` in `duelMode.js`; sword hits on duel/battle opponents go through `_getPvpTargets` in the phone-sword loop; character swap = `setPlayerCharacterUrl` in `src/models/playerModel.js` |
| Multiplayer Guns & Bombs (free for all, 10 fighters, no swords: gun with unlimited bullets (`pistol.infiniteAmmo`), unlimited bombs (lobbed at the closest opponent, `GUNS_BOMB_AIM_RANGE`), one shield each (`GUNS_MATCH_SHIELD_HEALTH`, blocks shots / blasts from in front); shooter / thrower detects hits (host for bots) → `hit` / `botHit` with `kind` + `src`, `GUN_DAMAGE`=1 / `BOMB_DAMAGE`=2; bots = ranged `EnemyPlayer` (`ranged` {min,max}) that shoot (`BOT_SHOT_*`) and lob bombs (`BOT_BOMB_*`) and switch between gun and a `BOT_SHIELD_HP` shield (`BOT_SHIELD_UP_MS` / `BOT_GUN_MS`, never both, no shooting while it is up); auto-walk stops at shooting range `GUNS_WALK_STOP_DIST`) | `MATCH_MODES.guns` + the Guns & Bombs section (`attachGunGear` — other fighters hold the gun / shield like the player: real model clones on the weapon floating hand with `Weapon.getHoldPose`, both hands on `Pistol` / `Shield.getGripTarget` (`EnemyPlayer.gripTarget` for host bots, `remoteHandTarget` otherwise) via `matchCtx.getWeaponGear` / `rangedHit` / `getShotTargets` / `bombTargetsFor` / `throwLocalBomb` / `updateGunBot`) in `src/multiplayer/matchMode.js`; game side = `matchCtx.startGunsLoadout` / `endGunsLoadout` (real pistol / shield set aside, nothing saved — `persistInventory` skips while `_gunsMatch`), `_mpSwordOnly`, `spawnPistolBullet`, `releasePlayerBomb`, shield check in `duelCtx.applyHit` in `bootstrapGameApp.js`; bullets hit fighters via `updateProjectiles({ pvpTargets })` in `src/items/projectiles.js`; per-bomb blast targets = `playerBombs.throw(o, t, { getBlastTargets })` in `src/combat/playerBomb.js`; `body.guns-match` (bomb + gun/shield buttons) in `styles.css`; no sword button = `appState.isSwordAllowed` in `PlayerControls.refreshActionButtons` |
| Start screen ("Start Game" = tutorial until `profiles/<key>/tutorialCompleted`; then Tutorial / Showdown / Classic / Multiplayer) + Sword Showdown tutorial (QR setup, hit past blocks, block swings, deflect a bomb, coins/auto-buy/bomb throw, shield, bubble, gun; player can't die, every step skippable) | `createArcadeOverlay` (`chooseMode`, `showStartScreen`, `setModeHandler`) + `tutorialCtx` / `startTutorialMode` / `_resetForMenu` in `bootstrapGameApp.js`; steps in `src/tutorial/showdownTutorial.js`; panel/arrows/button ring in `src/tutorial/tutorialOverlay.js` (`.tutorial-*` in `styles.css`); enemy hooks `EnemyPlayer.script` / `stationary` / `swordBounces`, `BombThrowerEnemy.throwsHeld` / `aimAt` / `stationary`; flag via `saveTutorialCompleted` / `hasCompletedTutorial` in `src/player/playerProfile.js`; phone button ring = `highlight` in the phone `status` message (`public/phone-sword.html`) |
| Audio | `src/audio/audioManager.js` + `public/assets/audio/` |
| New 3D prop | GLB → `public/assets/props/` + load from `bootstrapGameApp.js` |
| Serverless API | `api/turn-credentials.js` |
| Sword Showdown bombs / bomber (blast damage/knockback, explosion VFX, throw clip, held bomb) | `src/characters/BombThrowerEnemy.js` (`_explodeBomb`, `_updateHeldBomb`, throw logic in `update`; shared helpers `blastEnemiesAt`/`computeBombLobVelocity`/`createBombMesh`/`spawnBombExplosion`), `src/combat/explosionEffect.js`, `EnemyPlayer.applyBlastKnockback`, `_blastPlayer` in `bootstrapGameApp.js` |
| Sword Showdown sword blocking (explicit block stance/button + directional rule: swing must cross the blade by > `BLOCK_MIN_ANGLE_DEG`=30°; player block is more forgiving: `PLAYER_BLOCK_MIN_ANGLE_DEG`=15°, `PLAYER_BLOCK_REACH`) | `swingCrossesBlade` / `EnemyPlayer.blocksSwing` in `src/characters/EnemyPlayer.js`; player's block in `EnemyPlayer._checkSwordHitOnTarget`; enemy's block in the phone-sword hit loop in `bootstrapGameApp.js` (swing direction from `_psw.tipHistory`) |
| Sword Showdown stage path (flattest-direction pick, enemy/coin placement, auto-walk; from the village the player first walks `PS_VILLAGE_EXIT_DIST` m out before the stage's enemies/coins begin — `lead` of `_psBuildStage`) | `_psPickPathAngle` / `_psBuildStage` in `bootstrapGameApp.js`; auto-walk in the game loop (`_psAutoWalking`) |
| Death in Showdown / Classic (GAME OVER text only — no backdrop, no Continue prompt — then back to the village / Classic stage screen via `_psRestartCurrentStage`; Showdown first has two frog men walk in, lift the body (arm IK to grip points) and carry it off screen while the camera holds a framed view; enemies hold their attacks while the player is dead) | `showGameOver` / `hideGameOver` (timers cancelled on hide) in `bootstrapGameApp.js`; `#game-over-overlay` in `index.html` / `styles.css`; carry = `src/combat/deathCarry.js` (`createDeathCarry`, `deathCarry.update` after `village.update` in the game loop, `cancel` in `_resetForMenu`) |
| Showdown stage win (STAGE COMPLETE! + unlocked character as a banner over the world, no backdrop — `.ps-win-banner`; Classic keeps the full-screen STAGE CLEAR!) | `_psShowWin` + the win detection in the game loop of `bootstrapGameApp.js`; `.ps-win-*` in `styles.css` |
| Damage hit effect (blood spray) | `src/combat/bloodEffect.js`; player trigger in `setStat` (`triggerPlayerHurtBlood`), enemies in `applyDamage` |
| Bullets / bombs stopped by the map (buildings / walls / ground) + bullet impact sparks | `raycastMapSegment` in `src/environment/mapCollision.js` (meshes registered with `registerMapMeshes` in `bootstrapGameApp.js`), called per bullet in `updateProjectiles` (`src/items/projectiles.js`) and per bomb in `src/combat/playerBomb.js` / `BombThrowerEnemy._updateBombs`; effect `src/combat/bulletImpact.js` |
| Sword Showdown player bombs (💣 button, Throw.fbx, unequip/re-equip) | `src/combat/playerBomb.js` (flight/blast); `throwPlayerBomb`/`updatePlayerBombs` in `bootstrapGameApp.js` (count = `stats.bombs`, shop item `showdown_bomb`); button `psBombBtn` in `src/controls/controls.js` |
| Sword Showdown shop upgrades (heart/shield upgrade/bubble/bomb/life potion) | Catalog + purchase in `src/characters/merchant.js` (`unlimited` items); effects in `appState.applyShopUpgrade` (caps: `SHOWDOWN_MAX_HEALTH_SEGMENTS`=20 in `healthUtils.js`, also applies to level-ups; `SHOWDOWN_MAX_SHIELD_UPGRADES`=4 in `bootstrapGameApp.js`; `appState.isShopItemMaxed` → "MAX" in shop) + bubble system (`activatePlayerBubble`, `window.isPlayerBubbleActive`) in `bootstrapGameApp.js`; bubble button in `src/controls/controls.js`; enemy checks in `EnemyPlayer.js`/`BombThrowerEnemy.js`; auto-buy when out of bombs/bubbles/shield/gun/bullets = `psAutoBuyTick` (`PS_AUTO_BUY_ITEMS`, "Purchased …" toast via `showPickupToast` `options.text`) in `bootstrapGameApp.js`; shop coin balance + owned counts in `src/controls/merchantPanel.js` (`renderCoins`, `getOwnedCount`) |
| Sword Showdown health (5 segments at level 1, own max-health track, full health each session / stage start) | `SHOWDOWN_BASE_HEALTH_SEGMENTS` in `src/player/healthUtils.js`; `statsState.maxHealthSegments` is saved as the `showdownMaxHealthSegments` profile stat (`statsForSave` in `bootstrapGameApp.js`; older profiles fall back to their legacy `maxHealthSegments`); "never start dead" guard at the top of `_psStartStage` |
| Sword Showdown enemy difficulty per stage (enemy count: 15 at stage 1, +1/stage; hearts: all 1 at stage 1, more 2–3 heart enemies later — `_psEnemyCount` / `_psHeartsForStage`; swordsmen attacking at once: 1 for stages 1–7, up to 4; swing vs block/idle frequency) | `_psMaxAttackers` / `_psSwingChance` in `bootstrapGameApp.js` (attack slots in the game loop, `swingChance` passed in `_spawnHordeEnemy`); `EnemyPlayer.swingChance` used by `_decideNextPhase` in `src/characters/EnemyPlayer.js` |
| Sword Showdown kill counter (killed / total this stage) | `_psStageKills` / `_psStageTotal` / `_psUpdateKillHud` in `bootstrapGameApp.js` (`#ps-kill-counter`, `.ps-kill-counter` in `styles.css`) |
| Sword Showdown enemy swing telegraph (blade glows yellow + pulses faster during the wind-up, red during the swing) | `_buildSwingGlow` / `_updateSwingGlow` + `SWING_GLOW_*` in `src/characters/EnemyPlayer.js` |
| Sword Showdown heart bubbles (around the middle of each stage's path, more on later stages; drift in front of the player, sword poke pops for +1 health) | `src/combat/heartBubbles.js`; count `_psHeartBubbleCount`, spawned in `_psBuildStage`, popped by `_popHeartBubbles` after the phone-sword loop in `bootstrapGameApp.js` (`_frameBladePoints`) |
| Sword Showdown combo meter (consecutive sword hits; being hurt, pressing Block or a blocked swing ends it and pays that many coins; also paid on stage clear) | `src/combat/comboMeter.js` (`#combo-meter`, `.combo-*` in `styles.css`); `comboMeter` in `bootstrapGameApp.js` (`hit` in the phone-sword hit loop, `end` in `triggerPlayerHurtBlood` / block toggle / blocked swing / win) |
| Phone controller page (gyro sword + joystick, Block, bomb/gun/fire/shield/bubble/jump) | `public/phone-sword.html` (sends `gyro` packets with `joyAngle`/`joyForce`, `action` messages; shows host `status`); receiver `_attachPhoneSwordConn` / `_handlePhoneAction` in `bootstrapGameApp.js`; remote joystick also moves the player on desktop (`useJoystick` in `PlayerControls.processMovement`) |
| Sword gyro orientation + calibration (quaternions: device = Rz(α)·Rx(β)·Ry(γ), sword = earth→game(D·D0⁻¹) · neutral offsets `phoneSwordConfig`, sensitivity scales the rotation angle; yaw auto-recentre during calm moments — auto-walk with no enemy near / duel walk-in, not swinging or blocking, blade roughly upright — pulls `phoneSwordCalib.yawDrift` toward forward, faster the longer since the last manual calibration; adaptive one-euro smoothing `PSW_SMOOTH_*` — heavy when still, near passthrough on fast swings) | `_pswDeviceQuat` / `_pswEarthToGame` / `PSW_YAW_RECENTER_*` / `PSW_SMOOTH_*` + the phone-sword gyro loop in `bootstrapGameApp.js`; manual calibration `window.phoneSwordRecalibrate` / calib presets (`_resetSwordCalibDrift`) |
| Sword gyro sensitivity ("Use This Device" — game screen is also the sword, amplified — and QR phone) + on-screen touch controls (full-width Block/Fire bar at the bottom, joystick/buttons above it) | `window.phoneSwordLocalSensitivity` / `window.phoneSwordPhoneSensitivity` (QR phone) (defaults `PHONE_SWORD_LOCAL_SENSITIVITY_DEFAULT`=2 / `PHONE_SWORD_PHONE_SENSITIVITY_DEFAULT`=1, sliders in Settings → Sword Gyro in `src/controls/settingsPanel.js`, saved as `localStorage` `sq:swordLocalSensitivity` / `sq:swordPhoneSensitivity`; hit detection tuning = `window.phoneSwordSwingCfg` defaults only (the old `sq:swordSwingCfg` override is removed on load); all mode-independent — Showdown, tutorial and Multiplayer) + `phoneSwordGyro.localDevice` (local `deviceorientation` handler, scaled rotation in the phone-sword gyro loop) in `bootstrapGameApp.js`; `refreshActionButtons` / `layoutMobileActionButtons` (`body.mobile-block-bar`) in `src/controls/controls.js`, `body.mobile-block-bar` rules in `styles.css` |
| Audio | `src/audio/audioManager.js`, `public/assets/audio/`; Sword Showdown ambient loop = `SWORD_SHOWDOWN_BGS` in `bootstrapGameApp.js`; hurt vocals = `audioManager.playOuch(kind)` — ouch1 enemies via `playEnemyOuch()` (every 3rd or 4th hit across all enemies, `applyDamage`), ouch2 player hurt / ouch3 player death (`triggerPlayerHurtBlood`) |

---

## Key Patterns to Know

**Feature facades** (`src/features/`): thin wrappers that re-export lightweight APIs and `import()` heavy modules lazily. When adding a heavy new feature, add a facade here to keep the initial bundle small.

**World:** `bootstrapGameApp.js` loads the GLB map, builds a BVH and registers a raycast height resolver with `registerTerrainHeightResolver`; `getTerrainHeight` / `getSpawnY` use it.

**Stages:** `_psPickPathAngle` picks the flattest direction, `_psBuildStage` places enemies and coins along it, and the player auto-walks between fights. Enemies live in the `hordeEnemies` array (historical name).

**Character arms (GLB + IK):** Players use `frog_man.glb` (`glbCharacterConfig.frogManUrl`) by default; EnemyPlayers cycle `pumpkin.glb` / `antler_guy.glb` / `frog_man.glb` / `gemhorn_rigged.glb` / `wizard.glb` / `tree_creature.glb` per spawn (`url` option of `createGLBCharacterInstance`; same Mixamo skeleton). Mixamo FBX clips animate everything except the arm chains (Shoulder→Hand); each frame the arms are solved with a stretchy two-bone IK toward invisible "floating hand" groups, which are also the weapon attach points (marked with `userData.proceduralHand`). Frame order: `setMoving` → `animate` → `solveArm` per hand → `stepFluff`. Floating-hand labels are mirrored: `'right'` sits at local +X = the character's anatomical left arm. `playDeath()` plays the flying-back death clip once (arms included, IK off) until `revive()` — used by the local player on death/respawn and by EnemyPlayer (ragdoll stays on; dead-enemy knockback capped by `DEATH_KNOCKBACK_CAP` in `EnemyPlayer.js`). The Sword Showdown bomb thrower (`BombThrowerEnemy.js`) uses the same GLB with `armIK: false` (clips drive the arms): `playAction(glbCharacterConfig.throwClip)` plays `Throw.fbx` once and the bomb is released at `THROW_RELEASE_AT` of the clip; between throws a bomb is held on the anatomical right palm (`getPalmWorldPosition('left')`). **Mii characters** (`mii1.glb`, future `mii2.glb`…, detected by `isMiiCharacterUrl`) have no shoulders/arms/hands: `solveArm` is a no-op, `getPalmWorldPosition` returns a point beside the body (`palmFallback`), and they hold the Wii sword (`wii_sword.glb`), whose instances carry two brown ball hands on the handle (`createSwordModelInstance({ characterUrl })` in `swordModel.js` — used by `FoamSword` (swaps with the player's character), `EnemyPlayer._buildSword` and `createSwordMesh` for duel/battle opponents).

**Start screen + tutorial:** "Start Game" runs the tutorial until `profiles/<key>/tutorialCompleted` is set; then the start screen offers Tutorial / Showdown / Classic / Multiplayer (auth resolves at login so the game loads behind the start screen; picks go through `setModeHandler`, queued if the game isn't ready; `arcadeOverlay.showStartScreen`). The ⚙️ settings button is layered above the start screen, stage overlay and Multiplayer lobby, shown once `body.settings-ready` is set. `src/tutorial/showdownTutorial.js` scripts enemies via `EnemyPlayer.script` and the bomber's `throwsHeld` / `aimAt`, and reaches the game only through `tutorialCtx` in `bootstrapGameApp.js`.

**Multiplayer (lobby + duels):** only in Multiplayer mode — `startMultiplayer`/`stopMultiplayer` in `bootstrapGameApp.js` create/destroy the `Multiplayer` instance, so `multiplayer` is `null` in Showdown/tutorial. Firebase `peers` = who's online (lobby list), `rooms` = `lobby` or `duel-<challengeId>` (`joinRoom`). `src/multiplayer/duelMode.js` runs the lobby, challenges (PeerJS `duel` messages via `sendTo`) and the duel (sword only, best of 3 rounds with 8 health each, 3-2-1-FIGHT, both walk in toward each other, attacker-detected hits, `dead {round}` scores the round, WINNER banner, back to lobby); it reaches the game through `duelCtx`. Duel spot = `DUEL_LOCATION` in `duelMode.js`. The lobby's Team Battle / Free For All / Guns & Bombs buttons hand over to `src/multiplayer/matchMode.js` (lobby `suspend`/`resume`): party setup with invites and side/character picks, Start pulls players waiting in `mm-<mode>`, bots fill up to 10 (host-simulated `EnemyPlayer`s), battle in `match-<matchId>` around `DUEL_LOCATION`, last team / fighter standing wins; game access via `matchCtx`. Guns & Bombs swaps the sword for a gun (unlimited bullets), unlimited bombs and one shield (`matchCtx.startGunsLoadout`, never saved); whoever fires / throws detects the hits (host for bots) and sends `hit` / `botHit`. The phone controller has its own PeerJS link.

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
6. Phone controller link (peer multiplayer starts only in Multiplayer mode)
7. `requestAnimationFrame` loop starts

---

## What NOT to Do

- Don't bypass `appContext` with `window.*` globals in new code
- Don't import heavy modules at top level — use the facade pattern (`src/features/`)
- Don't modify `public/service-worker.js` cache list without bumping the cache version
- Don't add game logic to `src/core/` (infrastructure only)
