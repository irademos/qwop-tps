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
// past it — measured by a ray at door height). The shops are entered there. `enter` = how near
// the door spot walking toward the house goes in (m; default DOOR_ENTER_DIST) — wider for the
// deeply set-in doors, which the player would otherwise climb the front wall trying to reach.
export const HOUSE_DOORS = {
  'medieval_building_002.glb': { side: '-x', at: 0.35, inset: 0.65, enter: 1.2 },
  'medieval_building_004.glb': { side: '+z', at: 0.45, inset: 0.38, enter: 1.2 },
  'medieval_building_005.glb': { side: '+x', at: 0.36, inset: 0.55, enter: 1.2 },
  'fantasy_house.glb': { side: '+z', at: 0.3, inset: 0.63, enter: 1.2 },
  'fantasy_house (1).glb': { side: '+z', at: 0, inset: 0.48 },
};
export const HOUSE_DOOR_OUT = 0.45;         // m out from the door: the door spot outside (on the top step)…
export const HOUSE_DOOR_MAX_OUT = 3.5;      // …or further out (up to this), past a roof overhang the height ray lands on
export const HOUSE_DOOR_STEP = 0.5;         // m above the lowest ground in front of the door the spot may stand (porch steps)
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
export const NEWCOMER_DELAY_S = [45, 100];  // s until someone moves in after a death
export const FOUNDING_HOUSEHOLDS = 9;       // houses the founding townsfolk share (families)
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
export const TRADE_DIST = 3.4;              // m from a shop's back counter for its buttons (🧺 Goods / 💰 Sell, ⚔️ Weapons)
// The rooms (townRooms.js): two of the town's houses are the goods shop and the weapon shop, the
// rest homes; walking in through a door puts you inside its room — the shops' shop.glb, the
// homes' home_interior.glb — each far off the island and under the seabed, out of sight: a grid
// from ROOMS_ORIGIN (world m: the middle of the first room's floor), ROOM_SPACING apart (further
// than anyone sees across — WITNESS_DIST / LAW_SIGHT), every room's floor its own ground
export const ROOMS_ORIGIN = { x: -250, y: -40, z: -40 };
export const ROOM_SPACING = 32;
export const ROOM_COLUMNS = 6;
export const DOOR_DIST = 0.4;               // m from a door outside: stepped away from it after coming out
export const DOOR_ENTER_DIST = 0.2;         // m from a door outside where walking toward the house goes in (HOUSE_DOORS `enter` per model)
export const HOME_VISIT_CHANCE = 0.2;       // a stroll in the day: a while at home instead
export const SHOP_BROWSE_CHANCE = 0.12;     // a townsperson's decision: a look round the weapon shop
export const CHEST_PRICE = 30;              // the weapon shop's mystery chest
export const CHOP_HITS = 3;                 // sword hits on a tree per 🪵
export const TREE_WOOD = 3;                 // 🪵 a tree gives before it needs to grow back…
export const TREE_REGROW_S = 40;            // …one per this many seconds
export const CHOP_REACH = 0.85;             // m from the sword tip to the trunk
export const CROP_REGROW_S = 70;            // s until a picked crop is back
export const PICK_DIST = 1.6;               // m — 🌾 Pick near a ripe crop
// Fishing (townFishing.js): the rod is bought at the weapon shop and held like the sword; swing
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

// ── Reactions ──
export const ATTITUDE_FADE = 0.004;         // per second, toward 0 (fondness fades at half the rate)
export const GRUDGE_ATTITUDE = -0.5;        // won't trade with the player, steps aside from them
export const FRIEND_DISCOUNT = 0.15;        // friends pay this much less at the goods shop (and get more)
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
export const RAID_CHANCE = 0.35;            // a bandit's night decision: raid a field…
export const BANDIT_MUG_CHANCE = 0.2;       // …or rob someone
export const RAID_TAKE = 2;                 // crops a raider takes

// ── Missions ──
export const JOB_REFRESH_S = 120;           // s between new jobs being handed out
export const ACT_DIST = 2.4;                // m — a job's 📦 / 💰 near its townsperson
export const KID_FOUND_DIST = 2.5;          // m
export const KID_HOME_DIST = 3;             // m from their door to count as home
export const KID_WITH_PLAYER_DIST = 10;     // m — and the player with them (walked home, not gone home alone)
export const RAID_HOUR = 22;                // a guarded field is raided at this hour

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
