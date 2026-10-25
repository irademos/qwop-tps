// Town mode's tuning constants and small helpers, shared by the townMode*.js modules
// (see townMode.js for how the town is put together).

import * as THREE from 'three';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';

// ── Layout ──
// The town's area of the island (world m, the houses are around (−44, −48)), the wider area the
// townsfolk (and the bandits, camped far out) walk, and a point on the town's road (stage 3's
// route runs through town) that the walkable area is grown from
export const TOWN_BOUNDS = { minX: -90, maxX: -4, minZ: -94, maxZ: -8 };
export const NAV_BOUNDS = { minX: -98, maxX: 42, minZ: -100, maxZ: 32 };
export const NAV_CELL = 1.25;
export const NAV_START = { x: -24.9, z: -31.5 };
export const BUILDING_RE = /house|building|cabin/i;
export const TREE_RE = /tree/i;
// Where each house model's front door is (its own frame — the GLB's axes): the wall it's in
// ('+x' / '-x' / '+z' / '-z'), how far along that wall from its middle (`at`, -1 … 1 of the
// half width: x along a ±z wall, z along a ±x wall) and how far the door sits in from the
// model's bounds on that side (`inset`, of the half depth: steps, a porch, overhangs stick out
// past it — measured by a ray at door height). A door in an angled wall gives its spot (`point`,
// [x, z] of the half width / depth from the middle) and the way out (`normal`, [x, z]) instead.
// The shops are entered there. Walking in: across a line DOOR_ENTER_PAST out from the door spot
// outside (`out` m from the door, past a roof overhang — see HOUSE_DOOR_MAX_OUT), or with `enter`
// within that many m of the spot.
export const HOUSE_DOORS = {
  'medieval_building_002.glb': { side: '-x', at: 0.35, inset: 0.65 },
  'medieval_building_004.glb': { side: '+z', at: 0.45, inset: 0.38 },
  'medieval_building_005.glb': { side: '+x', at: 0.36, inset: 0.55 },
  // (the door in the back corner wall — the front one's up a flight of stairs)
  'fantasy_house.glb': { point: [0.53, -0.5], normal: [1, -1] },
  'fantasy_house (1).glb': { side: '+z', at: 0, inset: 0.48, out: 0.3, enter: 0.2 },
};
export const HOUSE_DOOR_OUT = 0.45;         // m out from the door: the door spot outside (on the top step)…
export const HOUSE_DOOR_MAX_OUT = 3.5;      // …or further out (up to this), past a roof overhang the height ray lands on
export const HOUSE_DOOR_STEP = 0.5;         // m above the lowest ground in front of the door the spot may stand (porch steps)
export const DOOR_ENTER_PAST = 0.1;         // m out past the door spot: the line where walking toward the house goes in…
export const DOOR_ENTER_HALF_WIDTH = 0.6;   // …this far to either side of the door
export const TREE_TRUNK_RADIUS = 0.6;
// ── Clock ── (an hour = 20 s, a day = 8 min)
export const MINUTES_PER_SEC = 3;
export const START_MINUTES = 8 * 60;
export const NIGHT_FROM_H = 21;
export const NIGHT_TO_H = 5.5;
// At night the player takes a lantern out (bootstrapGameApp.js) once this far from the nearest
// house (m, past its edge), and puts it away again back within LANTERN_PUT_AWAY_DIST
export const LANTERN_DIST = 12;
export const LANTERN_PUT_AWAY_DIST = 9;
// Town's lights (townLights.js): the map's road lamps glow at night, and the nearest of them
// and the campfires get one of TOWN_LIGHT_SLOTS real point lights (each costs every lit
// material per pixel, so not one a lamp); the fires' are lit by day too, dimmer
export const TOWN_LIGHT_SLOTS = 4;
export const TOWN_LIGHT_MAX_DIST = 70;      // m from the player: no light for a spot further than this
export const TOWN_LIGHT_FADE_S = 0.6;       // s a slot takes to fade in / out when it moves to another spot
export const TOWN_LAMP_LIGHT = Object.freeze({ color: 0xfff1c1, intensity: 2.6, distance: 26, decay: 0.6 });
export const TOWN_FIRE_LIGHT = Object.freeze({ color: 0xff9440, intensity: 3.2, distance: 18, decay: 0.7, y: 0.6, day: 0.3 });
export const TOWN_FIRE_GLOW_NIGHT = 2.6;    // × the campfire's ground glow at night
// ── People ──
export const TOWN_MAX_BODIES = 12;   // townsfolk drawn at once (the nearest)
export const BODY_DIST = 42;                // m — drawn within this…
export const BODY_RELEASE_DIST = 48;        // …and put away past this
export const LABEL_DIST = 7;                // m — name tags show this close
export const CAMERA_CLEAR_DIST = 1.8;       // m — no name tag / bubble on someone this close to the camera
export const WALK_SPEED = 1.25;             // m/s
export const RUN_SPEED = 3.6;               // m/s (fleeing, guards answering a crime)
export const TALK_RANGE = 2.4;              // m — 💬 shows for townsfolk this close
export const BUBBLE_S = 3.6;                // s a speech bubble stays up
export const PLAYER_PUSH_DIST = 0.55;       // m — townsfolk step out of the player's way
export const NEEDS = { energyDrain: 1 / 420, sleepGain: 1 / 80, hungerRate: 1 / 300, socialRate: 1 / 260 };
export const WORK_PAY = 1;                  // coins a guard / the sheriff earns per stint of work
export const GIFT_COINS = 5;                // 🪙 Give
export const FRIEND_ATTITUDE = 0.55;        // friends don't tell the guards what they saw
export const NEWCOMER_DELAY_S = [45, 100];  // s until someone moves in after a death (only into a free house)
export const DEAD_BODY_S = 5;               // s a body lies there before it's taken away

// ── Law ──
export const WITNESS_DIST = 22;             // m — townsfolk who see a crime this close report it
export const LAW_SIGHT = 28;                // m — guards keep track of a wanted player this close
export const ENGAGE_DIST = 9;               // m — a guard who sees the player this close draws its sword
export const DISENGAGE_DIST = 30;           // m — a fighter further away goes back to running after them
export const HEAT_DECAY_S = 12;             // s unseen per star lost
export const HOSTILE_CALM_S = 15;           // s without being hit before a townsperson who fought back calms down
export const GIVE_UP_DIST = 5;              // m — 🙌 Give up when a guard fighter is this close
export const FINE_PER_STAR = 15;            // coins
export const JAIL_S = 30;                   // s in the cell (or pay bail)
export const BAIL = 20;                     // coins
export const KO_COIN_SHARE = 0.1;           // share of coins lost when knocked out (not wanted)

// ── Economy ──
// What a stint of work makes: [good, min, max]
export const PRODUCE = { woodcutter: ['wood', 2, 3], farmer: ['crops', 2, 4], fisher: ['fish', 1, 3] };
export const MERCHANT_START_CASH = 60;      // coins the merchant starts out with
export const FIREWOOD_CHANCE = 0.35;        // a townsperson buying food takes some firewood home too
export const MARKET_HOURS = [7, 20];
export const TRADE_DIST = 3.4;              // m from the shop's back counter (the wizard's stall) for its buttons (🛒 Shop / 💰 Sell, 🔮 Wizard)
// The rooms (townRooms.js): two of the town's houses are the shop and the jail (the sheriff's
// office and a cell), the rest homes; walking in through a door puts you inside its room — the
// shop's shop.glb, the jail's and the homes' home_interior.glb — each far off the island and
// under the seabed, out of sight: a grid
// from ROOMS_ORIGIN (world m: the middle of the first room's floor), ROOM_SPACING apart (further
// than anyone sees across — WITNESS_DIST / LAW_SIGHT), every room's floor its own ground
export const ROOMS_ORIGIN = { x: -250, y: -40, z: -40 };
export const ROOM_SPACING = 32;
export const ROOM_COLUMNS = 6;
export const DOOR_DIST = 0.4;               // m from a door outside: stepped away from it after coming out
export const DOOR_ENTER_DIST = 0.2;         // m from a door with no house (an open spot) where walking toward it goes in
export const HOME_VISIT_CHANCE = 0.2;       // a stroll in the day: a while at home instead
export const SHOP_BROWSE_CHANCE = 0.12;     // a townsperson's decision: a look round the shop's gear
export const CHEST_PRICE = 30;              // the shop's mystery chest
export const CHOP_HITS = 3;                 // sword hits on a tree per 🪵
export const TREE_WOOD = 3;                 // 🪵 a tree gives before it needs to grow back…
export const TREE_REGROW_S = 40;            // …one per this many seconds
export const CHOP_REACH = 0.85;             // m from the sword tip to the trunk
export const CROP_REGROW_S = 70;            // s until a picked crop is back
export const PICK_DIST = 1.6;               // m — 🌾 Pick near a ripe crop
// The wizard's stall (townStalls.js 'wizard', the wizard townsperson behind it): out in the woods
export const WIZARD_STALL_DIST = [30, 75];  // m from the middle of town
export const WIZARD_HUT_DIST = 4;           // m from the stall: where the wizard sleeps (his tent)
// Farming (townFarming.js): the farmers' fields can be bought (at the field, no talk needed);
// seeds from the shop are planted anywhere — a dirt pile that grows one veg in a town day, or
// in VEG_WET_S once the hose has soaked it
export const FIELD_PRICE = 100;             // coins (to the field's farmer)
export const FIELD_ACT_DIST = 4.5;          // m from a field's middle: 🌱 Buy this field
export const VEG_DRY_S = 480;               // s for a seed to grow unwatered (a town day: 1440 min / MINUTES_PER_SEC)
export const VEG_WET_S = 40;                // s while its soil is wet
export const VEG_MAX = 24;                  // seeds planted at once
export const VEG_PICK_DIST = 1.4;           // m — 🥕 Pick your veg
export const VEG_GAP = 0.6;                 // m between dirt piles
export const SEEDS_MAX = 30;
export const SOIL_DRY_S = 60;               // s a soaked dirt pile stays wet
export const WATER_SOAK_S = 1.2;            // s of hose on a pile to soak it
export const HOSE_LENGTH = 16;              // m the hose reaches from the tap
export const HOSE_GRAB_DIST = 1.8;          // m from the tap: 🚿 Grab the hose
export const HOSE_SPEED = 6.5;              // m/s the water leaves the nozzle
export const HOSE_SPLASH_R = 0.55;          // m round where the water lands: the dirt piles there get it
// Fishing (townFishing.js): the rod is bought at the shop and held like the sword; swing
// it forward to cast, wait for a bite, pull it back to hook the fish, then wear it out — pull
// when it tires, ease off while it runs — and crank the reel to bring it in
export const FISH_SPOT_RADIUS = 6;          // m — fish from this close to the fishing spot (one for now)
export const FISH_CAST_DIST = [3, 9];       // m — the gentlest cast … the hardest
export const FISH_CAST_REACH = 10;          // m — the water searched for where the bobber lands
export const FISH_GESTURE_S = 0.25;         // s — a cast / pull is the rod tip's travel within this
export const FISH_CAST_SWING = [0.7, 2];    // m forward: a cast … full power
export const FISH_PULL_SWING = 0.55;        // m back / up: a pull
export const FISH_SETTLE_S = 0.9;           // s after a cast (its follow-through) before a pull counts
export const FISH_WAIT_S = [4, 11];         // s until a bite
export const FISH_NIBBLE_CHANCE = 0.55;     // a nibble first (pulling on it scares the fish off)
export const FISH_NIBBLE_S = 1.4;
export const FISH_HOOK_S = 1.1;             // s to pull after the bobber goes under
// How hard a hooked fish fights: pulls = good pulls to tire it out, n = fish it's worth
export const FISH_SIZES = [
  { label: 'a little one', pulls: 1, n: 1, w: 5 },
  { label: 'a fine fish', pulls: 2, n: 1, w: 4 },
  { label: 'a big one', pulls: 3, n: 2, w: 2 },
];
export const FISH_RUN_S = [1.3, 2.6];       // s it swims off, pulling line out…
export const FISH_TIRED_S = 1.5;            // …then tires at the surface: the moment to pull
export const FISH_RUN_SPEED = 1.1;          // m/s of line it takes while running
export const FISH_PULL_KEEP = 0.6;          // a good pull brings it in to this share of the line out
export const FISH_REEL_M = 0.7;             // m of line wound in per turn of the reel
export const FISH_TENSION_PER_TURN = 0.4;   // reeling against a running fish strains the line…
export const FISH_PULL_TENSION = 0.45;      // …so does pulling on it
export const FISH_TENSION_DECAY = 0.3;      // per s
export const FISH_LINE_MAX = 14;            // m — it takes all the line: gone
export const FISH_LAND_DIST = 1.4;          // m — reeled in this close: landed
export const FISH_KEY_REEL = 1.6;           // turns / s holding R (no phone)
export const FISH_CANCEL_DIST = 1.2;        // m — walking off reels in
export const FISH_HINT_AFTER = 3;           // mistakes (scared off, too slow, snapped, lost) before the HUD says Pull / Reel in

// Canoe (townCanoe.js): moored by the fishing spot; standing in it the oar comes out (held by
// its handle, pointing down — the phone up holds it straight down) and the blade moving through
// the water beside the hull pushes it the other way — off its side, so it turns too: paddling
// on the left goes forward and a little right, on the right a little left, a stroke forward
// backs it up (weaker)
export const CANOE_BOARD_DIST = 3;          // m from its middle: 🛶 Get in
export const CANOE_SHORE_DIST = 4;          // m — 🛶 Get out with dry ground this close
export const CANOE_STAND_Z = -0.35;         // m along it (bow = +): where the player stands
export const CANOE_MIN_DEPTH = 0.25;        // m of water it needs under it (else it runs aground)
export const CANOE_PADDLE_PUSH = 6.5;       // per s: the push from the blade's speed past the canoe…
export const CANOE_PADDLE_BACK = 0.6;       // …a stroke forward (backing up) this much as hard…
export const CANOE_PADDLE_TURN = 0.29;      // …and how much of its turning moment turns it
export const CANOE_BLADE_DEPTH = 0.12;      // m under the water: the blade's full bite (a quarter just at the surface)
export const CANOE_BLADE_MAX_SPEED = 20;    // m/s — only a jump in the oar's pose (not a stroke) is this fast
export const CANOE_STROKE_SPEED = 2;        // m/s — the push grows by its own size per this much stroke speed
export const CANOE_DRAG = 0.3;              // per s, along it
export const CANOE_SIDE_DRAG = 3.5;         // per s, sideways (the hull won't slide)
export const CANOE_TURN_DRAG = 1.8;         // per s
export const CANOE_MAX_SPEED = 30;          // m/s
export const CANOE_STEER_ACCEL = 5;         // m/s² — no gyro: the joystick / WASD paddle for you (back: CANOE_PADDLE_BACK as hard)…
export const CANOE_STEER_TURN = 4;          // rad/s² — …and turn it
export const CANOE_BOB = 0.015;             // m up and down on the water

// ── Reactions ──
export const ATTITUDE_FADE = 0.004;         // per second, toward 0 (fondness fades at half the rate)
export const GRUDGE_ATTITUDE = -0.5;        // won't trade with the player, steps aside from them
export const FRIEND_DISCOUNT = 0.15;        // friends pay this much less at the shop (and get more)
export const AVOID_DIST = 4.5;              // m
export const RALLY_DIST = 15;               // m — the brave this close (family: further) come to help
export const RALLY_MAX = 2;
export const VENDETTA_SIGHT = 9;            // m — the family of someone the player killed attacks on sight
export const FOLLOW_ATTITUDE = 0.8;         // fond enough to come along (🤝 Join me)
export const MAX_FOLLOWERS = 2;
export const FOLLOW_GAP = 2.2;              // m behind the player
export const FOLLOW_HELP_DIST = 12;         // m — a follower takes on hostiles this close to the player
export const FOLLOW_HIT_S = 1.8;            // s between a follower's blows
export const BRAWL_HIT_S = [1.0, 1.7];      // s between blows when townsfolk fight each other
export const BRAWL_REACH = 1.3;             // m
export const MUG_CHANCE = 0.3;              // a drifter out at night goes after someone (per decision)
export const OUTLAW_S = 120;                // s someone seen attacking / robbing is wanted
export const NPC_JAIL_S = 90;               // s an arrested townsperson spends in the cell

// ── Law (more) ──
export const BRIBE = 35;                    // coins
export const BRIBE_ODDS = 0.5;              // when no officer near likes the player
export const LOCK_SLIP_S = 10;              // s added to the sentence by a slipped lockpick
export const WAKE_HOUR = 7;                 // sleeping it off: out at this hour
export const CAMP_DIST = [80, 120];         // m from the middle of town to the bandit camp
export const CAMP_WARN_DIST = 30;           // m from the camp: the gang warns the player off…
export const CAMP_ATTACK_DIST = 15;         // …inside this, draws swords (a standoff, no attacks yet)…
export const CAMP_GRACE_S = 30;             // …and after this long there, fights (armed) or robs them (unarmed)
export const CAMP_REMIND_S = 7;             // s between the countdown's reminders
export const CAMP_DEFENDERS = 3;            // bandits who draw / fight at once
export const CAMP_ROB = 12;                 // coins taken off an unarmed trespasser
export const CAMP_CHASE_DIST = 34;          // m from the camp: the gang gives up the chase
export const BANDIT_RETURN_S = [180, 300];  // s until a beaten bandit's place in the gang is filled
export const BANDIT_CAMP_R = 7;             // m they loiter around the camp
export const RAID_TAKE = 2;                 // crops a raider takes
// Night raids (townBandits.js): every night the gang comes into town — breaking into houses (the
// player's too, now and then: its chest), robbing whoever's out, stripping the fields
export const NIGHT_RAID_HOURS = [22, 4];    // the raid sets off at the first, nobody starts anything new after the second
export const NIGHT_RAID_ACTS = 2;           // break-ins / robberies / fields each raider does in a night
export const NIGHT_RAID_STAY = 1;           // bandits (the chief first) who stay to watch the camp
export const RAID_PLAYER_HOUSE_CHANCE = 0.35; // a night a player's (bought) house is one of the break-ins
export const BURGLE_S = [4, 7];             // s a burglar spends inside
export const BURGLE_SHARE = 0.3;            // of a townsperson's money a break-in takes…
export const BURGLE_MAX = 15;               // …at most
export const BURGLE_CHEST_SHARE = 0.35;     // of the coins in the player's chest…
export const BURGLE_CHEST_MAX = 60;         // …at most
export const BURGLE_GOODS = 3;              // goods taken out of it
export const RAID_NOTICE_DIST = 7;          // m — a raider who sees the player this close goes for them (armed) or robs them
export const NIGHT_ROB = 10;                // coins a raider takes off an unarmed player…
export const NIGHT_ROB_EVERY_S = 60;        // …at most once in this long
// The gang grows as the days go on (newcomers at the camp)
export const GANG_GROW_EVERY_DAYS = 1;      // one more bandit every this many days…
export const GANG_MAX = 10;                 // …up to this many
// The sheriff's thanks: the morning after the player beats bandits at night, he comes over with a
// reward (a job ready to be paid — townMissions.js 'nightThanks'); he also asks an armed player
// to stand watch some nights (job 'nightWatch')
export const NIGHT_KILL_REWARD = 15;        // coins a bandit beaten at night (the chief: double)
export const SHERIFF_SEEK_S = 120;          // s the sheriff looks for the player before leaving it to them (❓ / ❗ stays)
export const NIGHT_WATCH_KILLS = [2, 4];    // bandits to beat for 'nightWatch'
export const NIGHT_WATCH_PER_KILL = 18;     // its reward a bandit
export const NIGHT_WATCH_CHANCE = 0.3;      // a round of new jobs (JOB_REFRESH_S): the sheriff asks

// ── Missions ──
export const JOB_REFRESH_S = 120;           // s between new jobs being handed out
export const ACT_DIST = 2.4;                // m — a job's 📦 / 💰 near its townsperson
export const KID_FOUND_DIST = 2.5;          // m
export const KID_HOME_DIST = 3;             // m from their door to count as home
export const KID_WITH_PLAYER_DIST = 10;     // m — and the player with them (walked home, not gone home alone)
export const RAID_HOUR = 22;                // a guarded field is raided at this hour

// ── Homes (townHomes.js) ── one resident to a house: the townsfolk and the players together
// fill the houses; each player has a house kept for them (bought before it's theirs)
export const HOUSE_PRICE = 100;             // coins for the player's house
export const MIN_TOWNSFOLK = 6;             // a player moving in never pushes the town below this (FOUNDING_ROLES' first ones)
export const BAG_MAX = 15;                  // goods the player can carry (the rest stays in the chest at home)
export const WALLET_MAX = 150;              // coins in the player's wallet (more stays on the ground / in the chest)
export const LOCKPICK_MAX = 3;              // lock-picks carried (single use)
// The jail (townRooms.js ROOM_TYPES.jail — home_interior.glb with a cell of bars and the
// sheriff's desk) is one of the town's houses
export const KNOCK_S = 2.2;                 // s from a knock to an answer
export const KNOCK_AGAIN_S = 20;            // s before the same door can be knocked on again
export const INVITE_S = 90;                 // s an invitation in stands
export const COME_OUT_S = 25;               // s a townsperson who came to the door stays out
export const DOOR_ACT_DIST = 1.6;           // m from a locked door outside: its buttons (knock / pick / buy)
export const FEED_SHOW_MS = 7500;           // ms a feed line stays on screen (then in the 🔔 list)
export const FEED_MAX_SHOWN = 2;            // feed lines on screen at once (the rest wait their turn)
export const FEED_LOG_MAX = 30;             // feed lines kept for the 🔔 list
export const BED_ACT_DIST = 2.0;            // m from the bedside in the player's home: 😴 Sleep till night / morning
export const CHEST_ACT_DIST = 1.7;          // m from the chest in the player's home: 📦 Chest

export const SAVE_EVERY_S = 20;
export const SAVE_PREFIX = 'town_';
// ── Shared town (Multiplayer) ──
export const NET_SEND_S = 0.25;             // townsfolk positions (host → everyone, a claimant → host)
export const NET_WORLD_S = 1;               // the clock + the market's stock
export const NET_FULL_S = 15;               // the whole town (late joiners, a new host)
export const NET_JOIN_TIMEOUT_S = 20;       // no shared town by then: a town of your own
export const NET_CLAIM_TIMEOUT_S = 10;      // a claimant not heard from: the host takes them back
export const NET_CLAIM_GRACE_S = 3;         // s a fresh claim / release waits on the host's word
export const BOUNTY_PER_STAR = 10;          // coins for bringing a wanted player down
export const PVP_CREDIT_S = 6;              // s a player's blow counts as what brought us down
export const MP_SAVE_PREFIX = 'town_mp_';   // + profile key + room: a player's own things in a shared town

export const _v = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _UP = new THREE.Vector3(0, 1, 0);
export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
export const rand = (a, b) => a + Math.random() * (b - a);
export const pickOf = (list) => list[Math.floor(Math.random() * list.length)];
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const angleLerp = (a, b, t) => {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
};
// Hour h in [a, b) — b may pass midnight
export const inHours = (h, hours) => (hours[0] < hours[1] ? h >= hours[0] && h < hours[1] : h >= hours[0] || h < hours[1]);
export const heightScale = (url) => glbCharacterConfig.heightScaleByUrl[url] ?? 1;
