import * as THREE from 'three';
import { LOBBY_ROOM_ID } from './peerConnection.js';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';
import { swingCrossesBlade, PLAYER_BLOCK_MIN_ANGLE_DEG } from '../characters/EnemyPlayer.js';
import { createMatchPickups, PICKUP_TYPES } from './matchPickups.js';
import { createBossFighter } from '../characters/pembertonBoss.js';

// Multiplayer battles: Team Battle (two teams of 5, each team one character model) and
// Free For All (10 fighters, everyone picks their own character), each played with one of
// two rules (MATCH_RULES):
//   • Survival  — no respawns: the last team / fighter standing wins.
//   • Most Kills — everyone respawns RESPAWN_MS after dying (with a short spawn bubble);
//     when the clock (KILLS_MATCH_MS) runs out or someone reaches KILL_TARGET, the most
//     kills wins (Team Battle: the team's total; Free For All: the best kill / death ratio).
// Everyone starts with the sword only; pickups scattered around the arena
// (src/multiplayer/matchPickups.js) give guns, bullets, shields, bombs, magic wands, mana,
// hearts, life potions and bubbles. Opened from the Multiplayer lobby (duelMode suspends
// its lobby while this runs).
//
// Party setup: whoever opens a mode is the host of a party. They pick the rule, invite
// online players (invite → join), everyone picks a side (Team Battle) or a character (Free
// For All), and the host presses Start. A solo host sits in the Firebase room
// `mm-<mode>-<rule>` — that room is the matchmaking queue: on Start the host "pulls"
// queued players of the same mode + rule into the battle (pull → pullOk), fills the rest
// up to MATCH_SIZE with bots and sends everyone `start` with the full roster. Parties with
// guests sit in `party-<hostId>` (not pullable); a battle runs in its own private room
// `match-<matchId>`.
//
// Battle: everyone spawns around ARENA_LOCATION (teams in two lines facing each other,
// free-for-all in a ring), counts down "3 2 1 FIGHT!", then players move themselves (bots
// walk toward the closest enemy), MATCH_HEALTH health each. The host simulates the bots
// (EnemyPlayer AI + the Showdown boss fighter logic, createBossFighter in pembertonBoss.js:
// sword spells, then gun / shield / wand spells with what they've picked up, bombs lobbed
// from a distance, a bubble after a hit), owns the pickups and the score, and decides the
// winner. Bots grab every kind of pickup they need, going out of their way for one nearby
// (`loadout`: bullets, shield strength, mana, bombs, bubbles — used up as they fight).
// Sword hits: the attacker detects them. Bullets / bombs: whoever fires / throws detects
// the hits (the host for its bots) and sends `hit` / `botHit` with the damage; the victim's
// shield (held up and facing the shot) takes it instead, a bubble ignores it. Magic blasts:
// every client spawns them and each checks only itself (+ the host its bots).
// Kill credit: every hit names its attacker (`by`); the victim's `dead` names the last one,
// the host counts it and sends `kill` with the scores.
// Game access goes through `ctx` (built in bootstrapGameApp.js).
//
// Wire protocol: PeerJS messages of type 'match', each with a `key` (party key or matchId):
//   party:  invite {mode, rule, name} · inviteCancel · decline · join {name, pick}
//           pick {pick} · party {mode, rule, roster, teamChars} (host → guests) · leave
//   queue:  pull {mode, rule, name} · pullOk {name, pick} · pullNo · pullCancel
//   battle: start {matchId, partyKey, mode, rule, roster, teamChars}
//           state {sword, hand, blocking, pos, ry, hp, w, bu} (~20 Hz, every human → every
//           human; w = 'sword' | 'wand' | 'gun' | 'shield' | null, bu = bubble up)
//           bots {list} (~15 Hz, host → humans; each {id, p, r, hp, d, b, pr, w, s?, h?} —
//           w = the bot's weapon, pr = bubble up) · hit {dmg, dir, kind, src, by} (attacker →
//           victim; the host sends bot hits with `by`) · blocked · botHit {bot, dir, dmg,
//           kind, src} / botBlocked {bot} (human → host) · dead {by, kind} (the sender died)
//           · kill {v, by, k, sc} (host: v was killed by `by` with k; sc = [[id, kills,
//           deaths]…]) · respawn {pos: [x, z, yaw], bot?} (the sender / a host bot is back)
//           · bomb {bot?, o, t} (a bomb was thrown from o to t) · magic {bot?, o, f, l, e}
//           (the sender / a host bot cast a blast) · shot {bot, o, d} (host: a bot fired a
//           bullet from o along d) · take {pid} (human → host: I'm standing on that pickup)
//           · taken {pid, by, r} (host: pickup pid went to `by`, back in r ms)
//           · end {winnerTeam, winnerId, winnerName, sc} (host) · leave (the sender left;
//           the host leaving ends the battle). Humans' bullets go out as 'projectile' messages.

export const MATCH_MODES = { team: 'Team Battle', ffa: 'Free For All' };
export const MATCH_RULES = {
  survival: { label: 'Survival', icon: '🛡️', blurb: 'No respawns · last one standing wins' },
  kills: { label: 'Most Kills', icon: '💀', blurb: 'Respawn after every death · most kills wins' }
};
// Free For All Most Kills is won on kill / death ratio (deaths count as at least 1)
const KD_BLURB = 'Respawn after every death · best K/D wins';
const ruleBlurb = (rule, mode) => (rule === 'kills' && isFreeForAll(mode) ? KD_BLURB : MATCH_RULES[rule].blurb);
const kdRatio = (c) => c.kills / Math.max(1, c.deaths);
const formatKd = (c) => kdRatio(c).toFixed(2).replace(/\.?0+$/, '');
const DEFAULT_RULE = 'survival';
const cleanRule = (rule) => (MATCH_RULES[rule] ? rule : DEFAULT_RULE);
const isFreeForAll = (mode) => mode !== 'team';
export const MATCH_CHARACTERS = {
  villageBoy: { label: 'Village Boy', team: 'Village Boys', emoji: '👦', url: glbCharacterConfig.villageBoyUrl },
  antler: { label: 'Antler Guy', team: 'Antlers', emoji: '🦌', url: glbCharacterConfig.antlerGuyUrl },
  frog: { label: 'Frog Man', team: 'Frogs', emoji: '🐸', url: glbCharacterConfig.frogManUrl },
  gemhorn: { label: 'Gemhorn', team: 'Gemhorns', emoji: '💎', url: glbCharacterConfig.url },
  pumpkin: { label: 'Pumpkin', team: 'Pumpkins', emoji: '🎃', url: glbCharacterConfig.pumpkinUrl },
  wizard: { label: 'Wizard', team: 'Wizards', emoji: '🧙', url: glbCharacterConfig.wizardUrl },
  tree: { label: 'Tree Creature', team: 'Trees', emoji: '🌳', url: glbCharacterConfig.treeCreatureUrl },
  mii1: { label: 'Mii', team: 'Miis', emoji: '🙂', url: glbCharacterConfig.mii1Url },
  // story: not won from a Showdown boss — unlocked by the (future) story mode; locked
  // everywhere (Team Battle included) until then, and never given to bots
  villager: { label: 'Villager', team: 'Villagers', emoji: '🧑‍🌾', url: glbCharacterConfig.villagerUrl, story: true }
};
const CHAR_KEYS = Object.keys(MATCH_CHARACTERS);
const BOT_CHAR_KEYS = CHAR_KEYS.filter((k) => !MATCH_CHARACTERS[k].story);

// Where battles happen (island town mappack; the same spot as duels — DUEL_LOCATION in
// duelMode.js). Fighters start around it; pickups and respawns spread wider (never in the
// sea). Paste Settings → Dev → Free Roam → "Copy location" here to move it.
export const ARENA_LOCATION = { x: -39.53, y: 0, z: -44.59, yaw: 0.84 };

const MATCH_SIZE = 10;                 // fighters per battle (humans + bots)
const TEAM_SIZE = MATCH_SIZE / 2;
const INVITE_TIMEOUT_MS = 30000;
const PULL_WAIT_MS = 2500;             // how long Start waits for queued players to answer
const PULLED_TIMEOUT_MS = 8000;        // pulled player gives up waiting for `start`
const STATE_SEND_MS = 50;
const BOT_SEND_MS = 66;
const HUMAN_TIMEOUT_MS = 10000;        // no messages this long → that player left
const COUNTDOWN_STEP_MS = 1000;
const RESULTS_MS = 12000;              // results screen, then back to the lobby
const TEAM_GAP = 14;                   // metres between the two team lines at "3"
const LINE_SPACING = 2;                // metres between teammates in a line
const FFA_RADIUS = 8;                  // free-for-all spawn ring
const RESPAWN_RADIUS = [5, 18];        // respawn spots (m from the arena centre)
const PICKUP_RADIUS = [3, 19];         // where pickups are scattered
const PICKUP_TOUCH = 1.25;             // stand this close to a pickup to take it
const TAKE_RETRY_MS = 600;
const BOT_RETARGET_MS = 400;
const BOT_ATTACKERS_PER_TARGET = 2;    // the rest of the bots on one target circle and wait
const BODY_CENTER_Y = 0.8;
const KEY_RE = /^[A-Za-z0-9_-]{1,100}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const PID_RE = /^p\d{1,3}$/;
// Most Kills
const KILLS_MATCH_MS = 3 * 60 * 1000;
const KILL_TARGET = { team: 30, ffa: 15 };
const RESPAWN_MS = 4000;
const SPAWN_PROTECT_MS = 2500;         // spawn bubble after a respawn
const LAST_HIT_CREDIT_MS = 10000;      // a death credits the last hit this recent
// Ranged damage (bullets / bombs from pickups)
const GUN_DAMAGE = 1;
const BOMB_DAMAGE = 2;
// Bots: fight with what they pick up (createBossFighter), go for pickups they need this near
const BOT_SWORD_MS = [4000, 7500];     // each sword spell before a gun / shield / wand one
const BOT_WAND_RANGE = { min: 4.5, max: 10 };
const BOT_SEEK_RADIUS = 9;
const BOT_SHIELD_BLOCKS = 3;           // a picked-up shield stops this many hits
const BOT_WANTS_AMMO_BELOW = 20;
const BOT_WANTS_BOMBS_BELOW = 4;
const BOT_WANTS_BUBBLES_BELOW = 2;
const randIn = ([a, b]) => a + Math.random() * (b - a);

const KIND_ICONS = { sword: '⚔️', gun: '🔫', bomb: '💣', fire: '🔥', ice: '❄️' };
const cleanKind = (k) => (KIND_ICONS[k] ? k : 'sword');

const BOT_NAMES = ['Bruno', 'Kira', 'Otto', 'Mira', 'Rex', 'Juno', 'Pip', 'Zara', 'Hugo', 'Nell'];

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const cleanName = (name, fallback = 'Player') => (typeof name === 'string' && name.trim() ? name.slice(0, 40) : fallback);
const cleanPick = (pick) => ({
  side: pick?.side === 1 ? 1 : 0,
  char: CHAR_KEYS.includes(pick?.char) ? pick.char : 'antler'
});
const round3 = (v) => Math.round(v * 1000) / 1000;
const teamChar = (charKey) => MATCH_CHARACTERS[charKey] || MATCH_CHARACTERS.antler;
const teamLabel = (charKey) => {
  const c = teamChar(charKey);
  return `${c.emoji} ${c.team}`;
};
const formatClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const _bladeOffsets = [
  new THREE.Vector3(0, 0, -0.1),
  new THREE.Vector3(0, 0, 0.3),
  new THREE.Vector3(0, 0, 0.65)
];
const _tmpV = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpV3 = new THREE.Vector3();


export function createMatchMode(ctx) {
  // 'off' | 'setup' (party host) | 'starting' (host waiting on pulled players) | 'guest'
  // | 'pulled' (waiting for a host's `start`) | 'countdown' | 'fighting' | 'over'
  let phase = 'off';
  // Host: { key, mode, rule, hostId, isHost: true, members: Map(id → {name, status, pick, timer}),
  //         myPick, teamChars }
  // Guest: { key, mode, rule, hostId, hostName, isHost: false, roster, teamChars, myPick }
  let party = null;
  let starting = null;      // { matchId, asked: Set, replied: Set, accepted: [], openSlots, timer }
  let pulled = null;        // { matchId, hostId, hostName, timer }
  let pendingInvite = null; // { key, from, name, mode, rule, timer }
  let match = null;
  let countdownTimers = [];

  const myId = () => ctx.getMultiplayer()?.getId?.() || null;
  const send = (peerId, payload) => ctx.getMultiplayer()?.sendTo?.(peerId, { type: 'match', ...payload });
  const joinRoom = (roomId) => { void ctx.getMultiplayer()?.joinRoom?.(roomId); };
  const queueRoom = (mode, rule) => `mm-${mode}-${rule}`;

  const pickups = createMatchPickups({
    scene: ctx.scene,
    getGroundY: (x, z) => ctx.getGroundY(x, z),
    isBlocked: (x, z) => !!ctx.isBlocked?.(x, z)
  });

  // ── DOM ──────────────────────────────────────────────────────────────────
  const setup = el('div', 'duel-lobby match-setup hidden');
  const setupPanel = el('div', 'duel-lobby-panel');
  const setupTitle = el('div', 'duel-lobby-title');
  const setupStatus = el('div', 'duel-lobby-status');
  const rulePicker = el('div', 'match-rules');
  const picks = el('div', 'match-picks');
  const membersTitle = el('div', 'match-section-title', 'Your party');
  const membersList = el('ul', 'duel-lobby-list match-members');
  const inviteTitle = el('div', 'match-section-title', 'Invite online players');
  const inviteList = el('ul', 'duel-lobby-list');
  const setupActions = el('div', 'duel-lobby-actions');
  const startBtn = el('button', 'arcade-button', '▶ Start Battle');
  const setupBackBtn = el('button', 'arcade-button arcade-secondary', '⬅ Back');
  setupActions.append(startBtn, setupBackBtn);
  setupPanel.append(setupTitle, setupStatus, rulePicker, picks, membersTitle, membersList, inviteTitle, inviteList, setupActions);
  setup.append(setupPanel);

  const invitePrompt = el('div', 'match-invite hidden');
  const inviteText = el('div', 'duel-prompt-text');
  const inviteActions = el('div', 'duel-lobby-actions');
  const inviteAcceptBtn = el('button', 'arcade-button', '✅ Join');
  const inviteDeclineBtn = el('button', 'arcade-button arcade-secondary', 'Decline');
  inviteActions.append(inviteAcceptBtn, inviteDeclineBtn);
  invitePrompt.append(inviteText, inviteActions);

  const banner = el('div', 'duel-banner hidden');
  const bannerTitle = el('div', 'duel-banner-title');
  const bannerSub = el('div', 'duel-banner-sub');
  banner.append(bannerTitle, bannerSub);

  // Battle HUD: scoreboard bar (top centre), your score / standings under it, kill feed
  const hud = el('div', 'match-hud hidden');
  const hudBar = el('div', 'match-hud-bar');
  const leaveBtn = el('button', 'match-leave-btn', '✕');
  leaveBtn.title = 'Leave the battle';
  leaveBtn.setAttribute('aria-label', 'Leave the battle');
  const hudSide = [0, 1].map((t) => {
    const box = el('div', `match-hud-team match-hud-team-${t}`);
    const emoji = el('span', 'match-hud-emoji');
    const name = el('span', 'match-hud-name');
    const score = el('span', 'match-hud-score');
    if (t === 0) box.append(emoji, name, score);
    else box.append(score, name, emoji);
    return { box, emoji, name, score };
  });
  const hudCenter = el('div', 'match-hud-center');
  const hudClock = el('div', 'match-hud-clock');
  const hudMode = el('div', 'match-hud-mode');
  hudCenter.append(hudClock, hudMode);
  hudBar.append(leaveBtn, hudSide[0].box, hudCenter, hudSide[1].box);
  const hudSub = el('div', 'match-hud-sub');
  hud.append(hudBar, hudSub);

  const feed = el('div', 'match-feed');
  // "💀 You eliminated X" pop (centre, under the crosshair area)
  const killPop = el('div', 'match-kill-pop hidden');

  const results = el('div', 'match-results hidden');
  const resultsPanel = el('div', 'match-results-panel');
  const resultsTitle = el('div', 'match-results-title');
  const resultsSub = el('div', 'match-results-sub');
  const resultsTable = el('div', 'match-results-table');
  const resultsActions = el('div', 'duel-lobby-actions');
  const resultsBackBtn = el('button', 'arcade-button', 'Back to Lobby');
  resultsActions.append(resultsBackBtn);
  resultsPanel.append(resultsTitle, resultsSub, resultsTable, resultsActions);
  results.append(resultsPanel);

  const labelLayer = el('div', 'match-labels');

  document.body.append(setup, invitePrompt, banner, hud, feed, killPop, results, labelLayer);

  const showBanner = (title, sub = '') => {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
    banner.classList.remove('hidden');
    bannerTitle.style.animation = 'none';
    void bannerTitle.offsetWidth;
    bannerTitle.style.animation = '';
  };
  const hideBanner = () => banner.classList.add('hidden');

  const flashStatus = (text) => {
    setupStatus.textContent = text;
    clearTimeout(flashStatus.timer);
    flashStatus.timer = setTimeout(renderSetup, 2500);
  };

  // ── Party setup screen ───────────────────────────────────────────────────
  const peerRoomStatus = (peer) => {
    const room = peer?.roomId;
    if (room === LOBBY_ROOM_ID) return 'lobby';
    if (typeof room === 'string' && (room.startsWith('mm-') || room.startsWith('party-'))) return 'queued';
    return 'busy';
  };

  const partyRoster = () => {
    if (!party) return [];
    if (!party.isHost) return party.roster;
    const roster = [{ id: party.hostId, name: ctx.getPlayerName(), pick: party.myPick, host: true }];
    party.members.forEach((m, id) => {
      if (m.status === 'joined') roster.push({ id, name: m.name, pick: m.pick });
    });
    return roster;
  };
  const joinedCount = () => {
    if (!party?.isHost) return 0;
    let n = 0;
    party.members.forEach((m) => { if (m.status === 'joined') n += 1; });
    return n;
  };

  const pickButton = (label, selected, onClick) => {
    const btn = el('button', `match-pick-btn${selected ? ' match-pick-selected' : ''}`, label);
    btn.addEventListener('click', onClick);
    return btn;
  };

  // Free For All fighter chooser: one card, swipe (or ‹ › / arrow keys) through the roster —
  // same as the Showdown character chooser; characters not yet unlocked in Showdown are
  // locked. Built once so the slide-in animation and keyboard focus survive renderPicks
  // rebuilding the panel.
  const charChooser = (() => {
    const root = el('div', 'match-char-chooser');
    root.tabIndex = 0;
    const prev = el('button', 'ui-btn-secondary match-char-nav', '‹');
    const next = el('button', 'ui-btn-secondary match-char-nav', '›');
    prev.type = 'button';
    next.type = 'button';
    prev.setAttribute('aria-label', 'Previous character');
    next.setAttribute('aria-label', 'Next character');
    const card = el('div', 'match-char-card');
    const emoji = el('div', 'match-char-emoji');
    const name = el('div', 'match-char-name');
    const dots = el('div', 'match-char-dots');
    card.append(emoji, name, dots);
    root.append(prev, card, next);
    // Characters still locked in Showdown show a lock and can't be picked (Team Battle
    // isn't affected — it doesn't use this chooser)
    const isUnlocked = (k) => (ctx.getUnlockedCharacters?.() ?? CHAR_KEYS).includes(k);
    let current = CHAR_KEYS[0];   // the card being shown (may be locked)
    let picked = null;            // the pick it was last synced to
    let isDisabled = false;
    let slideDir = 0;
    const draw = () => {
      const c = MATCH_CHARACTERS[current];
      const unlocked = isUnlocked(current);
      emoji.textContent = unlocked ? c.emoji : '🔒';
      name.textContent = unlocked ? c.label : `${c.label} — ${c.story ? 'story mode' : 'locked'}`;
      card.classList.toggle('locked', !unlocked);
      card.title = unlocked ? '' : c.story ? 'Unlocked in Story mode (coming soon)' : 'Unlock this character in Showdown';
      prev.disabled = isDisabled;
      next.disabled = isDisabled;
      root.classList.toggle('is-disabled', isDisabled);
      dots.replaceChildren(...CHAR_KEYS.map((k) => {
        const d = el('span', 'match-char-dot');
        d.classList.toggle('active', k === current);
        d.classList.toggle('locked', !isUnlocked(k));
        return d;
      }));
      if (slideDir) {
        card.classList.remove('slide-left', 'slide-right');
        void card.offsetWidth; // restart the slide-in animation
        card.classList.add(slideDir > 0 ? 'slide-left' : 'slide-right');
        slideDir = 0;
      }
    };
    const render = (pickKey, disabled) => {
      isDisabled = disabled;
      // Follow the pick when it changes (new party); otherwise keep showing a locked card
      if (pickKey !== picked) {
        picked = pickKey;
        current = CHAR_KEYS.includes(pickKey) ? pickKey : CHAR_KEYS[0];
      }
      draw();
    };
    const step = (dir) => {
      if (isDisabled) return;
      const i = CHAR_KEYS.indexOf(current);
      current = CHAR_KEYS[(i + dir + CHAR_KEYS.length) % CHAR_KEYS.length];
      slideDir = dir;
      if (isUnlocked(current) && current !== picked) {
        picked = current;
        setMyPick({ char: current });
      } else {
        draw();
      }
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    });
    let swipeX = null;
    card.addEventListener('pointerdown', (e) => { swipeX = e.clientX; card.setPointerCapture?.(e.pointerId); });
    card.addEventListener('pointerup', (e) => {
      if (swipeX === null) return;
      const dx = e.clientX - swipeX;
      swipeX = null;
      if (Math.abs(dx) > 30) step(dx < 0 ? 1 : -1);
    });
    card.addEventListener('pointercancel', () => { swipeX = null; });
    return { root, render };
  })();

  // Survival / Most Kills: the host picks, guests see it
  const renderRules = () => {
    rulePicker.innerHTML = '';
    if (!party) return;
    const editable = party.isHost && phase === 'setup';
    Object.entries(MATCH_RULES).forEach(([key, rule]) => {
      const selected = party.rule === key;
      const btn = el('button', `match-rule${selected ? ' is-active' : ''}`);
      btn.type = 'button';
      btn.disabled = !editable && !selected;
      btn.classList.toggle('is-readonly', !editable);
      btn.append(el('span', 'match-rule-icon', rule.icon), el('span', 'match-rule-label', rule.label),
        el('span', 'match-rule-blurb', ruleBlurb(key, party.mode)));
      if (editable) btn.addEventListener('click', () => setRule(key));
      rulePicker.append(btn);
    });
  };

  const renderPicks = () => {
    const chooserFocus = charChooser.root.contains(document.activeElement) ? document.activeElement : null;
    picks.innerHTML = '';
    if (!party) return;
    const roster = partyRoster();
    const selfId = myId();
    const locked = phase !== 'setup' && phase !== 'guest';
    if (party.mode === 'team') {
      [0, 1].forEach((side) => {
        const charKey = party.teamChars[side];
        const card = el('div', `match-team-card match-team-${side}${party.myPick.side === side ? ' match-pick-selected' : ''}`);
        const head = el('div', 'match-team-head', teamLabel(charKey));
        if (party.isHost && !locked) {
          const cycle = el('button', 'match-mini-btn', '🔄');
          cycle.title = 'Change this team\'s character';
          cycle.addEventListener('click', () => cycleTeamChar(side));
          head.append(cycle);
        }
        card.append(head);
        const names = roster.filter((m) => cleanPick(m.pick).side === side);
        const list = el('div', 'match-team-names');
        names.forEach((m) => list.append(el('div', 'match-team-name', m.id === selfId ? `${m.name} (you)` : m.name)));
        const bots = Math.max(0, TEAM_SIZE - names.length);
        if (bots > 0) list.append(el('div', 'match-team-name match-muted', `+ up to ${bots} more (random players / bots)`));
        card.append(list);
        if (party.myPick.side !== side && !locked) {
          card.append(pickButton('Join this side', false, () => setMyPick({ side })));
        } else if (party.myPick.side === side) {
          card.append(el('div', 'match-muted', 'Your side'));
        }
        picks.append(card);
      });
    } else {
      const row = el('div', 'match-char-row');
      row.append(el('div', 'match-section-title', 'Pick your fighter'), charChooser.root);
      charChooser.render(cleanPick(party.myPick).char, locked);
      picks.append(row);
      chooserFocus?.focus?.({ preventScroll: true });
    }
  };

  const renderMembers = () => {
    membersList.innerHTML = '';
    if (!party) return;
    const selfId = myId();
    const roster = partyRoster();
    roster.forEach((m) => {
      const row = el('li', `duel-lobby-row${m.id === selfId ? ' duel-lobby-row-self' : ''}`);
      const pick = cleanPick(m.pick);
      const suffix = isFreeForAll(party.mode)
        ? ` ${MATCH_CHARACTERS[pick.char].emoji}`
        : ` · ${teamLabel(party.teamChars[pick.side])}`;
      row.append(el('span', 'duel-lobby-name', `${m.name}${m.id === selfId ? ' (you)' : ''}${suffix}`));
      row.append(el('span', 'duel-lobby-badge duel-status-lobby', m.host ? 'Host' : 'Joined'));
      membersList.append(row);
    });
    if (party.isHost) {
      party.members.forEach((m) => {
        if (m.status !== 'invited') return;
        const row = el('li', 'duel-lobby-row');
        row.append(el('span', 'duel-lobby-name', m.name));
        row.append(el('span', 'duel-lobby-badge duel-status-queued', 'Invited…'));
        membersList.append(row);
      });
    }
  };

  const renderInvites = () => {
    inviteList.innerHTML = '';
    const show = !!party?.isHost && phase === 'setup';
    inviteTitle.classList.toggle('hidden', !show);
    inviteList.classList.toggle('hidden', !show);
    if (!show) return;
    const selfId = myId();
    const peers = ctx.getMultiplayer()?.getOnlinePeers?.() || {};
    const entries = Object.entries(peers)
      .filter(([id, peer]) => id !== selfId && peer && typeof peer.name === 'string')
      .filter(([id]) => party.members.get(id)?.status !== 'joined')
      .sort(([, a], [, b]) => a.name.localeCompare(b.name));
    const partyFull = 1 + party.members.size >= MATCH_SIZE;
    for (const [peerId, peer] of entries) {
      const status = peerRoomStatus(peer);
      const invited = party.members.get(peerId)?.status === 'invited';
      const row = el('li', 'duel-lobby-row');
      row.append(el('span', 'duel-lobby-name', peer.name));
      const label = { lobby: 'In lobby', queued: 'Matchmaking', busy: 'Busy' }[status];
      row.append(el('span', `duel-lobby-badge duel-status-${status === 'busy' ? 'dueling' : status}`, label));
      const btn = el('button', 'duel-challenge-btn', invited ? 'Invited…' : '✉️ Invite');
      btn.disabled = invited || status === 'busy' || partyFull;
      btn.addEventListener('click', () => invite(peerId, peer.name));
      row.append(btn);
      row.classList.toggle('duel-lobby-row-available', !btn.disabled);
      inviteList.append(row);
    }
    if (!entries.length) inviteList.append(el('li', 'duel-lobby-empty', 'Nobody else is online'));
  };

  const queuedCount = () => {
    if (!party) return 0;
    const selfId = myId();
    const peers = ctx.getMultiplayer()?.getOnlinePeers?.() || {};
    const room = queueRoom(party.mode, party.rule);
    return Object.entries(peers).filter(([id, peer]) => id !== selfId && peer?.roomId === room).length;
  };

  function renderSetup() {
    if (!party || (phase !== 'setup' && phase !== 'starting' && phase !== 'guest' && phase !== 'pulled')) return;
    const label = MATCH_MODES[party.mode];
    setupTitle.textContent = party.isHost ? label : `${label} — ${party.hostName}'s party`;
    if (phase === 'starting') {
      setupStatus.textContent = 'Finding matchmaking players…';
    } else if (phase === 'pulled') {
      setupStatus.textContent = `Joining ${pulled?.hostName || 'a'} battle…`;
    } else if (phase === 'guest') {
      setupStatus.textContent = `Waiting for ${party.hostName} to start…`;
    } else {
      const queued = queuedCount();
      setupStatus.textContent = `${queued} other player${queued === 1 ? '' : 's'} matchmaking ${label} · `
        + `${MATCH_RULES[party.rule].label}. Start fills open spots with them, then bots (${MATCH_SIZE} fighters).`;
    }
    startBtn.classList.toggle('hidden', !party.isHost);
    startBtn.disabled = phase !== 'setup';
    setupBackBtn.textContent = party.isHost ? '⬅ Back' : '⬅ Leave party';
    setupBackBtn.disabled = phase === 'starting' || phase === 'pulled';
    renderRules();
    renderPicks();
    renderMembers();
    renderInvites();
  }

  const showSetup = () => {
    setup.classList.remove('hidden');
    renderSetup();
  };
  const hideSetup = () => setup.classList.add('hidden');

  // ── Host: party management ───────────────────────────────────────────────
  const syncHostRoom = () => {
    if (!party?.isHost) return;
    joinRoom(joinedCount() > 0 ? `party-${party.hostId}` : queueRoom(party.mode, party.rule));
  };

  const broadcastParty = () => {
    if (!party?.isHost) return;
    const roster = partyRoster();
    party.members.forEach((m, id) => {
      if (m.status === 'joined') {
        send(id, { op: 'party', key: party.key, mode: party.mode, rule: party.rule, roster, teamChars: party.teamChars });
      }
    });
  };

  const openSetup = (mode, rule = DEFAULT_RULE) => {
    const selfId = myId();
    if (phase !== 'off' || !MATCH_MODES[mode] || !selfId) return;
    if (!ctx.suspendLobby()) return;
    party = {
      key: `${selfId}-${Date.now().toString(36)}`,
      mode,
      rule: cleanRule(rule),
      hostId: selfId,
      hostName: ctx.getPlayerName(),
      isHost: true,
      members: new Map(),
      myPick: { side: 0, char: 'villageBoy' },
      teamChars: ['antler', 'frog']
    };
    phase = 'setup';
    joinRoom(queueRoom(mode, party.rule));
    showSetup();
  };

  const setRule = (rule) => {
    if (phase !== 'setup' || !party?.isHost || !MATCH_RULES[rule] || party.rule === rule) return;
    party.rule = rule;
    syncHostRoom();
    broadcastParty();
    renderSetup();
  };

  const invite = (peerId, name) => {
    if (phase !== 'setup' || !party?.isHost || party.members.has(peerId)) return;
    if (1 + party.members.size >= MATCH_SIZE) return;
    const key = party.key;
    party.members.set(peerId, {
      name: cleanName(name),
      status: 'invited',
      pick: null,
      timer: setTimeout(() => {
        const m = party?.key === key ? party.members.get(peerId) : null;
        if (m?.status !== 'invited') return;
        send(peerId, { op: 'inviteCancel', key });
        party.members.delete(peerId);
        renderSetup();
        flashStatus(`${m.name} didn't answer`);
      }, INVITE_TIMEOUT_MS)
    });
    send(peerId, { op: 'invite', key, mode: party.mode, rule: party.rule, name: ctx.getPlayerName() });
    renderSetup();
  };

  const cancelInvites = () => {
    if (!party?.isHost) return;
    party.members.forEach((m, id) => {
      clearTimeout(m.timer);
      if (m.status === 'invited') {
        send(id, { op: 'inviteCancel', key: party.key });
        party.members.delete(id);
      }
    });
  };

  // Leave the party screen (host: disband; guest: leave the host's party)
  const leaveParty = () => {
    if (!party) return;
    if (party.isHost) {
      cancelInvites();
      party.members.forEach((m, id) => send(id, { op: 'leave', key: party.key }));
    } else {
      send(party.hostId, { op: 'leave', key: party.key });
    }
    party = null;
  };

  const cycleTeamChar = (side) => {
    if (phase !== 'setup' || !party?.isHost) return;
    const other = party.teamChars[1 - side];
    let idx = CHAR_KEYS.indexOf(party.teamChars[side]);
    // (story characters only once unlocked)
    const unlocked = ctx.getUnlockedCharacters?.() ?? [];
    const allowed = (k) => k !== other && (!MATCH_CHARACTERS[k].story || unlocked.includes(k));
    do { idx = (idx + 1) % CHAR_KEYS.length; } while (!allowed(CHAR_KEYS[idx]));
    party.teamChars[side] = CHAR_KEYS[idx];
    broadcastParty();
    renderSetup();
  };

  const setMyPick = (change) => {
    if (!party || (phase !== 'setup' && phase !== 'guest')) return;
    party.myPick = { ...party.myPick, ...change };
    if (party.isHost) broadcastParty();
    else send(party.hostId, { op: 'pick', key: party.key, pick: party.myPick });
    renderSetup();
  };

  const backToLobby = (flash) => {
    hideSetup();
    phase = 'off';
    party = null;
    joinRoom(LOBBY_ROOM_ID);
    ctx.resumeLobby(flash);
  };

  setupBackBtn.addEventListener('click', () => {
    if (phase !== 'setup' && phase !== 'guest') return;
    leaveParty();
    backToLobby();
  });

  // ── Host: Start (pull queued players, fill with bots) ────────────────────
  startBtn.addEventListener('click', () => {
    if (phase !== 'setup' || !party?.isHost) return;
    cancelInvites();
    const selfId = myId();
    const openSlots = MATCH_SIZE - 1 - joinedCount();
    const matchId = `${selfId}-${Date.now().toString(36)}`;
    const peers = ctx.getMultiplayer()?.getOnlinePeers?.() || {};
    const room = queueRoom(party.mode, party.rule);
    const queued = Object.entries(peers)
      .filter(([id, peer]) => id !== selfId && peer?.roomId === room && !party.members.has(id))
      .sort(([, a], [, b]) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      .map(([id]) => id);
    starting = { matchId, asked: new Set(), replied: new Set(), accepted: [], openSlots, timer: null };
    phase = 'starting';
    renderSetup();
    if (openSlots <= 0 || !queued.length) {
      finishStart();
      return;
    }
    queued.forEach((id) => {
      starting.asked.add(id);
      send(id, { op: 'pull', key: matchId, mode: party.mode, rule: party.rule, name: ctx.getPlayerName() });
    });
    starting.timer = setTimeout(finishStart, PULL_WAIT_MS);
  });

  function finishStart() {
    if (phase !== 'starting' || !starting || !party?.isHost) return;
    clearTimeout(starting.timer);
    const { matchId, accepted } = starting;
    starting.asked.forEach((id) => {
      if (!accepted.some((a) => a.id === id)) send(id, { op: 'pullCancel', key: matchId });
    });
    const humans = [...partyRoster(), ...accepted].slice(0, MATCH_SIZE);
    const roster = buildRoster(party.mode, humans, party.teamChars);
    const payload = {
      op: 'start', key: matchId, matchId, partyKey: party.key, mode: party.mode, rule: party.rule,
      roster, teamChars: party.teamChars
    };
    humans.forEach((h) => { if (h.id !== party.hostId) send(h.id, payload); });
    beginMatch({ matchId, mode: party.mode, rule: party.rule, hostId: party.hostId, roster, teamChars: party.teamChars });
  }

  const buildRoster = (mode, humans, teamChars) => {
    const roster = [];
    let botIndex = 0;
    const botName = () => `Bot ${BOT_NAMES[botIndex % BOT_NAMES.length]}`;
    if (mode === 'team') {
      const sides = [[], []];
      humans.forEach((h) => sides[cleanPick(h.pick).side].push(h));
      // Balance: nobody past TEAM_SIZE on a side
      while (sides[0].length > TEAM_SIZE) sides[1].push(sides[0].pop());
      while (sides[1].length > TEAM_SIZE) sides[0].push(sides[1].pop());
      [0, 1].forEach((team) => {
        for (let slot = 0; slot < TEAM_SIZE; slot++) {
          const h = sides[team][slot];
          if (h) roster.push({ id: h.id, name: h.name, team, char: teamChars[team], slot, bot: false });
          else {
            roster.push({ id: `bot${botIndex}`, name: botName(), team, char: teamChars[team], slot, bot: true });
            botIndex += 1;
          }
        }
      });
    } else {
      for (let slot = 0; slot < MATCH_SIZE; slot++) {
        const h = humans[slot];
        if (h) roster.push({ id: h.id, name: h.name, team: -1, char: cleanPick(h.pick).char, slot, bot: false });
        else {
          const char = BOT_CHAR_KEYS[Math.floor(Math.random() * BOT_CHAR_KEYS.length)];
          roster.push({ id: `bot${botIndex}`, name: botName(), team: -1, char, slot, bot: true });
          botIndex += 1;
        }
      }
    }
    return roster;
  };

  // ── Invites (receiving side) ─────────────────────────────────────────────
  const hideInvitePrompt = () => {
    if (pendingInvite) clearTimeout(pendingInvite.timer);
    pendingInvite = null;
    invitePrompt.classList.add('hidden');
  };

  // Free to take an invite: idle in the lobby, or alone on our own party screen
  const canTakeInvite = () => {
    if (pendingInvite) return false;
    if (phase === 'off') return ctx.isLobbyIdle();
    return phase === 'setup' && party?.isHost && joinedCount() === 0;
  };

  inviteAcceptBtn.addEventListener('click', () => {
    if (!pendingInvite) return;
    const { key, from, name, mode, rule } = pendingInvite;
    hideInvitePrompt();
    if (phase === 'setup' && party?.isHost && joinedCount() === 0) {
      cancelInvites();
      party = null;
    } else if (phase !== 'off' || !ctx.suspendLobby()) {
      send(from, { op: 'decline', key, reason: 'busy' });
      return;
    }
    party = {
      key, mode, rule, hostId: from, hostName: name, isHost: false,
      roster: [], teamChars: ['antler', 'frog'], myPick: { side: 0, char: 'villageBoy' }
    };
    phase = 'guest';
    joinRoom(`party-${from}`);
    send(from, { op: 'join', key, name: ctx.getPlayerName(), pick: party.myPick });
    showSetup();
  });
  inviteDeclineBtn.addEventListener('click', () => {
    if (!pendingInvite) return;
    send(pendingInvite.from, { op: 'decline', key: pendingInvite.key });
    hideInvitePrompt();
  });

  // ── Battle ───────────────────────────────────────────────────────────────
  const facingCentre = (x, z) => Math.atan2(ARENA_LOCATION.x - x, ARENA_LOCATION.z - z);

  const spawnPose = (entry) => {
    const loc = ARENA_LOCATION;
    const yaw = Number.isFinite(loc.yaw) ? loc.yaw : 0;
    if (entry.team === 0 || entry.team === 1) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const along = (entry.team === 0 ? -1 : 1) * TEAM_GAP / 2;
      const lateral = (entry.slot - (TEAM_SIZE - 1) / 2) * LINE_SPACING;
      return {
        x: loc.x + fx * along + rx * lateral,
        z: loc.z + fz * along + rz * lateral,
        yaw: entry.team === 0 ? yaw : yaw + Math.PI
      };
    }
    const angle = (entry.slot / MATCH_SIZE) * Math.PI * 2;
    const x = loc.x + Math.sin(angle) * FFA_RADIUS;
    const z = loc.z + Math.cos(angle) * FFA_RADIUS;
    return { x, z, yaw: facingCentre(x, z) };
  };

  // Most Kills respawn: the candidate spot furthest from the closest living enemy
  const respawnPose = (c) => {
    const enemies = [];
    match.combatants.forEach((o) => {
      if (!o.alive || !isEnemyOf(c, o)) return;
      const p = posOf(o);
      if (p) enemies.push(p);
    });
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = randIn(RESPAWN_RADIUS);
      const x = ARENA_LOCATION.x + Math.sin(a) * r;
      const z = ARENA_LOCATION.z + Math.cos(a) * r;
      if (ctx.isBlocked?.(x, z)) continue;
      let score = 100;
      for (const p of enemies) score = Math.min(score, Math.hypot(p.x - x, p.z - z));
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    if (!best) return spawnPose(c);
    return { x: best.x, z: best.z, yaw: facingCentre(best.x, best.z) };
  };

  const sanitizeRoster = (roster) => {
    if (!Array.isArray(roster) || roster.length > MATCH_SIZE) return null;
    const seen = new Set();
    const out = [];
    for (const r of roster) {
      if (!r || typeof r.id !== 'string' || !ID_RE.test(r.id) || seen.has(r.id)) return null;
      seen.add(r.id);
      out.push({
        id: r.id,
        name: cleanName(r.name, r.bot ? 'Bot' : 'Player'),
        team: r.team === 0 || r.team === 1 ? r.team : -1,
        char: CHAR_KEYS.includes(r.char) ? r.char : 'antler',
        slot: Number.isInteger(r.slot) ? Math.max(0, Math.min(MATCH_SIZE - 1, r.slot)) : 0,
        bot: !!r.bot
      });
    }
    return out;
  };

  const clearCountdown = () => {
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [];
  };

  function beginMatch({ matchId, mode, rule, hostId, roster, teamChars }) {
    const selfId = myId();
    const clean = sanitizeRoster(roster);
    if (!clean || !clean.some((r) => r.id === selfId && !r.bot)) return;
    clearTimeout(pulled?.timer);
    pulled = null;
    starting = null;
    party = null;
    hideSetup();
    hideInvitePrompt();
    joinRoom(`match-${matchId}`);

    const isHost = hostId === selfId;
    const now = Date.now();
    match = {
      matchId, mode, rule: cleanRule(rule), hostId, isHost,
      teamChars: Array.isArray(teamChars) ? teamChars.map((c) => (CHAR_KEYS.includes(c) ? c : 'antler')) : ['antler', 'frog'],
      combatants: new Map(),
      lastStateSentAt: 0,
      lastBotSentAt: 0,
      endTimer: null,
      endsAt: Infinity,
      myTeam: -1,
      takeSentAt: new Map(),
      hudKey: ''
    };
    for (const r of clean) {
      const c = {
        ...r,
        isSelf: r.id === selfId,
        alive: true,
        left: false,
        hp: ctx.matchHealth,
        lastHeardAt: now,
        enemy: null,
        sword: null,
        wandMesh: null,
        bubbleMesh: null,
        swordTarget: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), has: false },
        hand: new THREE.Vector3(0, 0.82, 0.5),
        blocking: false,
        weapon: 'sword',                 // 'sword' | 'wand' | 'gun' | 'shield' | null
        bubble: false,
        label: null,
        targetId: null,
        retargetAt: 0,
        combat: null,
        shotTarget: null,
        gunMesh: null,
        shieldMesh: null,
        gearTried: false,
        kills: 0,
        deaths: 0,
        lastHitBy: null,
        lastHitKind: 'sword',
        lastHitAt: 0,
        respawnAt: 0,
        protectedUntil: 0,
        fighter: null,                   // host bots: createBossFighter
        loadout: null,                   // host bots: what they've picked up (newBotLoadout)
        seek: null                       // host bots: the pickup they're going for
      };
      const pose = spawnPose(r);
      const url = MATCH_CHARACTERS[r.char].url;
      if (c.isSelf) {
        match.myTeam = r.team;
        ctx.enterMatch({ ...pose, characterUrl: url });
      } else if (r.bot && isHost) {
        c.enemy = ctx.createBot({ x: pose.x, z: pose.z, yaw: pose.yaw, characterUrl: url });
        if (c.enemy) {
          c.enemy.stationary = true;
          setupBot(c);
        }
      } else {
        ctx.ensureRemoteModel(r.id, r.name, url, pose);
        c.sword = ctx.createSwordMesh(url);
        if (c.sword) {
          c.sword.visible = false;
          ctx.scene.add(c.sword);
        }
        c.wandMesh = ctx.createWandMesh?.() || null;
        if (c.wandMesh) {
          c.wandMesh.visible = false;
          ctx.scene.add(c.wandMesh);
        }
      }
      if (!c.isSelf) {
        c.label = makeLabel(c);
        labelLayer.append(c.label.root);
      }
      match.combatants.set(r.id, c);
    }
    pickups.build(matchId, ARENA_LOCATION, { rMin: PICKUP_RADIUS[0], rMax: PICKUP_RADIUS[1] });

    phase = 'countdown';
    document.body.classList.add('match-active');
    hud.classList.remove('hidden');
    leaveBtn.classList.remove('hidden');
    feed.replaceChildren();
    renderHud(true);
    const ruleInfo = MATCH_RULES[match.rule];
    const intro = mode === 'team'
      ? `You fight for the ${teamLabel(match.teamChars[match.myTeam] ?? 'antler')}`
      : ruleBlurb(match.rule, mode);
    const sub = `${MATCH_MODES[mode]} · ${ruleInfo.label} · ${intro}`;
    ['3', '2', '1'].forEach((text, i) => {
      countdownTimers.push(setTimeout(() => {
        if (phase === 'countdown') showBanner(text, sub);
      }, i * COUNTDOWN_STEP_MS));
    });
    countdownTimers.push(setTimeout(() => {
      if (phase !== 'countdown') return;
      phase = 'fighting';
      if (match.rule === 'kills') match.endsAt = Date.now() + KILLS_MATCH_MS;
      showBanner('FIGHT!', 'Grab the pickups around the arena');
      ctx.setControlsLocked(false);
      match.combatants.forEach((c) => {
        if (c.enemy) c.enemy.stationary = false;
      });
      renderHud(true);
      countdownTimers.push(setTimeout(() => {
        if (phase === 'fighting' && match?.combatants.get(myId())?.alive) hideBanner();
      }, 1100));
    }, 3 * COUNTDOWN_STEP_MS));
  }

  const humansExceptMe = () => {
    if (!match) return [];
    const out = [];
    match.combatants.forEach((c) => { if (!c.bot && !c.isSelf && !c.left) out.push(c.id); });
    return out;
  };
  const broadcast = (payload) => {
    if (!match) return;
    humansExceptMe().forEach((id) => send(id, { key: match.matchId, ...payload }));
  };

  const isEnemyOf = (a, b) => a !== b && (isFreeForAll(match.mode) || a.team !== b.team);

  const combatantModel = (c) => {
    if (!c) return null;
    if (c.isSelf) return ctx.getLocalPlayerModel();
    if (c.enemy) return c.enemy.group;
    return ctx.getRemoteModel(c.id);
  };
  const posOf = (c) => combatantModel(c)?.position ?? null;

  // ── HUD: scoreboard, standings, kill feed, labels ────────────────────────
  const teamKills = (team) => {
    let n = 0;
    match.combatants.forEach((c) => { if (c.team === team) n += c.kills; });
    return n;
  };
  // Free For All Most Kills ranks by K/D (then kills); everything else by kills
  const byKd = () => match.rule === 'kills' && isFreeForAll(match.mode);
  const standings = () => [...match.combatants.values()]
    .sort((a, b) => (byKd() ? kdRatio(b) - kdRatio(a) : 0)
      || (b.kills - a.kills) || (a.deaths - b.deaths) || (Number(b.alive) - Number(a.alive)));

  function renderHud(force = false) {
    if (!match) return;
    const all = [...match.combatants.values()];
    const kills = match.rule === 'kills';
    const me = match.combatants.get(myId());
    let clock;
    if (phase === 'countdown') clock = kills ? formatClock(KILLS_MATCH_MS) : 'READY';
    else if (phase === 'over') clock = 'END';
    else if (kills) clock = formatClock(match.endsAt - Date.now());
    else clock = `${all.filter((c) => c.alive).length} left`;
    const key = [clock, phase, ...all.map((c) => `${c.alive ? 1 : 0}${c.kills}.${c.deaths}`)].join('|');
    if (!force && key === match.hudKey) return;
    match.hudKey = key;
    hudClock.textContent = clock;
    hudClock.classList.toggle('is-urgent', kills && phase === 'fighting' && match.endsAt - Date.now() < 30000);
    const target = KILL_TARGET[match.mode];
    hudMode.textContent = kills
      ? `${MATCH_RULES.kills.label} · ${byKd() ? `best K/D · ends at ${target} kills` : `first to ${target}`}`
      : `${MATCH_RULES.survival.label} · ${MATCH_MODES[match.mode]}`;
    if (match.mode === 'team') {
      hudBar.classList.add('is-team');
      [0, 1].forEach((t) => {
        const c = teamChar(match.teamChars[t]);
        const side = hudSide[t];
        side.box.classList.remove('hidden');
        side.box.classList.toggle('is-mine', match.myTeam === t);
        side.emoji.textContent = c.emoji;
        side.name.textContent = c.team;
        side.score.textContent = String(kills ? teamKills(t) : all.filter((x) => x.team === t && x.alive).length);
      });
    } else {
      hudBar.classList.remove('is-team');
      hudSide.forEach((s) => s.box.classList.add('hidden'));
    }
    // Under the bar: your kills / deaths, and (Free For All) the top three
    hudSub.replaceChildren();
    if (me) {
      const ranked = standings();
      const rank = ranked.indexOf(me) + 1;
      const mine = el('span', 'match-hud-chip is-self');
      mine.append(el('b', null, 'You'), document.createTextNode(` ${me.kills} K · ${me.deaths} D${byKd() ? ` · ${formatKd(me)} K/D` : ''}`));
      if (match.mode !== 'team') mine.append(el('span', 'match-hud-rank', `#${rank}`));
      hudSub.append(mine);
      if (match.mode !== 'team') {
        ranked.slice(0, 3).forEach((c, i) => {
          if (c === me) return;
          const chip = el('span', 'match-hud-chip');
          chip.append(el('span', 'match-hud-rank', `#${i + 1}`), document.createTextNode(` ${c.name} ${byKd() ? formatKd(c) : c.kills}`));
          chip.classList.toggle('is-dead', !c.alive);
          hudSub.append(chip);
        });
      }
    }
  }

  const showKillPop = (victimName) => {
    killPop.textContent = `💀 You eliminated ${victimName}`;
    killPop.classList.remove('hidden', 'is-in');
    void killPop.offsetWidth;
    killPop.classList.add('is-in');
    clearTimeout(showKillPop.timer);
    showKillPop.timer = setTimeout(() => killPop.classList.add('hidden'), 1800);
  };

  const nameClass = (c) => `match-feed-name team-${c?.team ?? -1}${c?.isSelf ? ' is-self' : ''}`;
  const addFeed = (victimId, byId, kind) => {
    if (!match) return;
    const victim = match.combatants.get(victimId);
    if (!victim) return;
    const killer = byId ? match.combatants.get(byId) : null;
    const row = el('div', 'match-feed-row');
    if (killer?.isSelf || victim.isSelf) row.classList.add('is-mine');
    if (killer && killer !== victim) row.append(el('span', nameClass(killer), killer.name));
    row.append(el('span', 'match-feed-icon', killer ? KIND_ICONS[cleanKind(kind)] : '💀'));
    row.append(el('span', nameClass(victim), victim.name));
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => row.classList.add('is-fading'), 5200);
    setTimeout(() => row.remove(), 6000);
  };

  function makeLabel(c) {
    const root = el('div', `match-label match-label-team-${c.team}${c.bot ? ' is-bot' : ''}`);
    const name = el('span', 'match-label-name', c.name);
    const bar = el('span', 'match-label-hp');
    const fill = el('i');
    bar.append(fill);
    root.append(name, bar);
    return { root, name, fill, key: '' };
  }

  const renderLabel = (c) => {
    if (!c.label) return;
    const key = `${c.alive ? 1 : 0}:${c.hp}`;
    if (key === c.label.key) return;
    c.label.key = key;
    c.label.name.textContent = c.alive ? c.name : `💀 ${c.name}`;
    c.label.fill.style.width = `${Math.round((Math.max(0, c.hp) / ctx.matchHealth) * 100)}%`;
    c.label.root.classList.toggle('match-label-dead', !c.alive);
    c.label.root.classList.toggle('is-low', c.alive && c.hp <= ctx.matchHealth * 0.3);
  };

  // ── Kills, deaths, respawns ──────────────────────────────────────────────
  // Remember who hit `c` last (kill credit)
  const noteHit = (c, byId, kind) => {
    if (!c || !byId || byId === c.id) return;
    c.lastHitBy = byId;
    c.lastHitKind = cleanKind(kind);
    c.lastHitAt = Date.now();
  };
  const creditOf = (c) => (c.lastHitBy && Date.now() - c.lastHitAt < LAST_HIT_CREDIT_MS
    ? { by: c.lastHitBy, kind: c.lastHitKind } : { by: null, kind: null });

  const scoresPayload = () => [...match.combatants.values()].map((c) => [c.id, c.kills, c.deaths]);
  const applyScores = (sc) => {
    if (!Array.isArray(sc)) return;
    for (const row of sc.slice(0, MATCH_SIZE)) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      const c = match.combatants.get(row[0]);
      if (!c) continue;
      if (Number.isFinite(row[1])) c.kills = Math.max(0, Math.min(999, Math.round(row[1])));
      if (Number.isFinite(row[2])) c.deaths = Math.max(0, Math.min(999, Math.round(row[2])));
    }
  };

  // Host: count a death (and the kill, when an enemy did it), tell everyone
  const recordKill = (victim, byId, kind) => {
    victim.deaths += 1;
    const killer = byId ? match.combatants.get(byId) : null;
    const credited = killer && isEnemyOf(killer, victim) ? killer : null;
    if (credited) credited.kills += 1;
    const k = cleanKind(kind);
    addFeed(victim.id, credited?.id ?? null, k);
    broadcast({ op: 'kill', v: victim.id, by: credited?.id ?? null, k, sc: scoresPayload() });
    if (credited?.isSelf) showKillPop(victim.name);
  };

  // Someone is out (died, left or timed out)
  const markDead = (id, { by = null, kind = null, left = false } = {}) => {
    const c = match?.combatants.get(id);
    if (!c) return;
    if (left) c.left = true;
    if (!c.alive) return;
    c.alive = false;
    c.hp = 0;
    if (!c.isSelf && !c.enemy) {
      ctx.getRemoteModel(id)?.userData?.qwopRig?.glbCharacter?.playDeath?.();
      if (c.sword) c.sword.visible = false;
      if (c.wandMesh) c.wandMesh.visible = false;
    }
    if (match.rule === 'kills' && !c.left && (c.isSelf || (match.isHost && c.enemy))) {
      c.respawnAt = Date.now() + RESPAWN_MS;
    }
    if (match.isHost && phase === 'fighting' && !left) recordKill(c, by, kind);
    renderLabel(c);
    renderHud();
    if (match.isHost && match.rule === 'survival') checkSurvivalWinner();
  };

  const reviveCombatant = (c, pose) => {
    c.alive = true;
    c.hp = ctx.matchHealth;
    c.respawnAt = 0;
    c.lastHitBy = null;
    if (c.label) c.label.key = '';
    if (!c.isSelf && !c.enemy) {
      ctx.ensureRemoteModel(c.id, c.name, MATCH_CHARACTERS[c.char].url, pose);
      ctx.reviveRemoteModel(c.id);
    }
    renderLabel(c);
    renderHud();
  };

  const respawnSelf = (c) => {
    const pose = respawnPose(c);
    ctx.respawnLocal(pose, SPAWN_PROTECT_MS);
    reviveCombatant(c, pose);
    broadcast({ op: 'respawn', pos: [round3(pose.x), round3(pose.z), round3(pose.yaw)] });
    hideBanner();
  };

  const respawnBot = (c) => {
    const pose = respawnPose(c);
    c.enemy?.destroy();
    c.enemy = ctx.createBot({ x: pose.x, z: pose.z, yaw: pose.yaw, characterUrl: MATCH_CHARACTERS[c.char].url });
    c.protectedUntil = Date.now() + SPAWN_PROTECT_MS;
    c.targetId = null;
    if (c.enemy) setupBot(c); // (back with the sword only)
    reviveCombatant(c, pose);
    broadcast({ op: 'respawn', bot: c.id, pos: [round3(pose.x), round3(pose.z), round3(pose.yaw)] });
  };

  // (src: where a bullet / bomb / blast came from; else the attacker's position)
  const applyBotDamage = (c, dir, dmg = 1, byId = null, kind = 'sword', src = null) => {
    if (!c?.alive || !c.enemy || phase !== 'fighting') return;
    if (Date.now() < c.protectedUntil) return; // spawn bubble
    // Its shield (facing the attacker) or bubble stops it
    const from = src ? _tmpV3.set(src.x, 0, src.z) : posOf(match.combatants.get(byId));
    const guard = c.fighter?.guardKind(from) ?? null;
    if (guard) {
      botGuarded(c, guard);
      c.enemy.applyBlockImpact?.();
      return;
    }
    noteHit(c, byId, kind);
    let killed = false;
    const fromPos = from ? from.clone() : undefined;
    for (let i = 0; i < Math.max(1, dmg) && !killed; i++) killed = c.enemy.applyDamage(1, fromPos);
    c.hp = c.enemy.hearts;
    renderLabel(c);
    _tmpV.set(dir?.x ?? 0, 0, dir?.z ?? 1);
    if (_tmpV.lengthSq() < 1e-6) _tmpV.set(0, 0, 1);
    _tmpV.normalize();
    const big = killed || kind === 'bomb' || kind === 'fire';
    c.enemy.applyDirectKnockback(big
      ? { direction: _tmpV, horizSpeed: killed ? 10 : 7, upVelocity: 1, torqueMag: 60, ragdoll: killed }
      : { direction: _tmpV, horizSpeed: 3, upVelocity: 0.2, torqueMag: 0, ragdoll: false });
    if (killed) markDead(c.id, creditOf(c));
  };

  function checkSurvivalWinner() {
    if (!match?.isHost || phase !== 'fighting') return;
    const alive = [...match.combatants.values()].filter((c) => c.alive);
    let result = null;
    if (match.mode === 'team') {
      const teams = new Set(alive.map((c) => c.team));
      if (teams.size <= 1) result = { winnerTeam: teams.size ? [...teams][0] : null };
    } else if (alive.length <= 1) {
      result = { winnerId: alive[0]?.id ?? null, winnerName: alive[0]?.name ?? null };
    }
    if (result) finishMatch(result);
  }

  // Host (Most Kills): time's up, or someone reached the target
  function checkKillsWinner(now) {
    if (!match?.isHost || phase !== 'fighting' || match.rule !== 'kills') return;
    const target = KILL_TARGET[match.mode];
    let result = null;
    if (match.mode === 'team') {
      const k = [teamKills(0), teamKills(1)];
      if (now >= match.endsAt || Math.max(...k) >= target) {
        result = { winnerTeam: k[0] === k[1] ? null : (k[0] > k[1] ? 0 : 1) };
      }
    } else {
      const ranked = standings();
      const top = ranked[0];
      const mostKills = Math.max(0, ...ranked.map((c) => c.kills));
      if (top && (now >= match.endsAt || mostKills >= target)) {
        const tie = ranked[1] && Math.abs(kdRatio(ranked[1]) - kdRatio(top)) < 1e-9 && ranked[1].kills === top.kills;
        result = tie || top.kills === 0 ? { winnerId: null } : { winnerId: top.id, winnerName: top.name };
      }
    }
    if (result) finishMatch(result);
  }

  const finishMatch = (result) => {
    broadcast({ op: 'end', ...result, sc: scoresPayload() });
    showEnd(result);
  };

  // Results card: winner + everyone's kills / deaths
  const renderResults = ({ winnerTeam = null, winnerId = null, winnerName = null, reason = '' }) => {
    const me = match.combatants.get(myId());
    let title;
    let sub = '';
    let mood = 'draw';
    if (reason) {
      title = 'BATTLE OVER';
      sub = reason;
    } else if (match.mode === 'team') {
      if (winnerTeam === 0 || winnerTeam === 1) {
        const won = winnerTeam === match.myTeam;
        mood = won ? 'win' : 'lose';
        title = won ? 'VICTORY' : 'DEFEAT';
        sub = `${teamLabel(match.teamChars[winnerTeam])} win${match.rule === 'kills' ? ` ${teamKills(winnerTeam)} – ${teamKills(1 - winnerTeam)}` : ''}`;
      } else {
        title = 'DRAW';
        sub = match.rule === 'kills' ? 'Both teams tied on kills' : 'Nobody is left standing';
      }
    } else if (winnerId) {
      const name = match.combatants.get(winnerId)?.name || cleanName(winnerName);
      const won = winnerId === myId();
      mood = won ? 'win' : 'lose';
      title = won ? 'VICTORY' : `${name} WINS`;
      sub = match.rule === 'kills'
        ? `${won ? 'You' : name} got the best K/D (${formatKd(match.combatants.get(winnerId) ?? { kills: 0, deaths: 0 })})`
        : `${won ? 'You are' : `${name} is`} the last one standing`;
    } else {
      title = 'DRAW';
      sub = match.rule === 'kills' ? 'Tied on K/D' : 'Nobody is left standing';
    }
    results.dataset.mood = mood;
    resultsTitle.textContent = title;
    resultsSub.textContent = `${MATCH_MODES[match.mode]} · ${MATCH_RULES[match.rule].label}${sub ? ` — ${sub}` : ''}`;
    resultsTable.replaceChildren();
    resultsTable.classList.toggle('has-kd', byKd());
    const head = el('div', 'match-results-row is-head');
    head.append(el('span', null, '#'), el('span', null, 'Fighter'), el('span', null, 'K'), el('span', null, 'D'));
    if (byKd()) head.append(el('span', null, 'K/D'));
    resultsTable.append(head);
    const ranked = match.mode === 'team'
      ? standings().sort((a, b) => (a.team === match.myTeam ? -1 : 0) - (b.team === match.myTeam ? -1 : 0))
      : standings();
    ranked.forEach((c, i) => {
      const row = el('div', `match-results-row team-${c.team}`);
      row.classList.toggle('is-self', c === me);
      row.classList.toggle('is-winner', c.id === winnerId || (winnerTeam != null && c.team === winnerTeam));
      const status = c.left ? ' (left)' : (match.rule === 'survival' && c.alive ? ' 🏅' : '');
      const name = el('span', 'match-results-name');
      name.append(el('span', 'match-results-emoji', MATCH_CHARACTERS[c.char].emoji),
        document.createTextNode(`${c.name}${c === me ? ' (you)' : ''}${c.bot ? ' 🤖' : ''}${status}`));
      row.append(el('span', 'match-results-rank', String(i + 1)), name,
        el('span', 'match-results-num', String(c.kills)), el('span', 'match-results-num', String(c.deaths)));
      if (byKd()) row.append(el('span', 'match-results-num', formatKd(c)));
      resultsTable.append(row);
    });
    results.classList.remove('hidden');
  };

  const returnToLobby = () => {
    if (!match) return;
    cleanupMatch();
    phase = 'off';
    joinRoom(LOBBY_ROOM_ID);
    ctx.resumeLobby();
  };
  resultsBackBtn.addEventListener('click', () => { if (phase === 'over') returnToLobby(); });

  // Multiplayer leaderboard: the local player's win / loss (none for a draw or a battle cut
  // short) and their kills / deaths this battle
  const recordResult = ({ winnerTeam = null, winnerId = null, reason = '' }) => {
    const me = match?.combatants.get(myId());
    if (!me) return;
    let won = false;
    let lost = false;
    if (!reason) {
      if (match.mode === 'team') {
        if (winnerTeam === 0 || winnerTeam === 1) { won = winnerTeam === match.myTeam; lost = !won; }
      } else if (winnerId) {
        won = winnerId === me.id;
        lost = !won;
      }
    }
    ctx.recordMultiplayerResult?.({ won, lost, kills: me.kills, deaths: me.deaths });
  };

  function showEnd(result = {}) {
    if (!match || phase === 'over') return;
    clearCountdown();
    phase = 'over';
    ctx.stopWalk();
    ctx.setControlsLocked(true);
    leaveBtn.classList.add('hidden');
    hideBanner();
    killPop.classList.add('hidden');
    feed.replaceChildren();
    renderHud(true);
    renderResults(result);
    recordResult(result);
    const finished = match;
    let left = Math.round(RESULTS_MS / 1000);
    const tick = () => {
      if (match !== finished) return;
      resultsBackBtn.textContent = `Back to Lobby (${left})`;
      if (left <= 0) {
        returnToLobby();
        return;
      }
      left -= 1;
      match.endTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  function cleanupMatch() {
    clearCountdown();
    if (!match) return;
    clearTimeout(match.endTimer);
    match.combatants.forEach((c) => {
      if (c.enemy) c.enemy.destroy();
      if (c.sword) c.sword.parent?.remove(c.sword);
      if (c.wandMesh) c.wandMesh.parent?.remove(c.wandMesh);
      if (c.bubbleMesh) {
        c.bubbleMesh.parent?.remove(c.bubbleMesh);
        c.bubbleMesh.geometry.dispose();
        c.bubbleMesh.material.dispose();
      }
      if (!c.isSelf && !c.enemy) ctx.removeRemotePlayer(c.id);
      c.label?.root.remove();
    });
    match = null;
    pickups.clear();
    hideBanner();
    hud.classList.add('hidden');
    results.classList.add('hidden');
    feed.replaceChildren();
    killPop.classList.add('hidden');
    document.body.classList.remove('match-active');
    ctx.leaveMatch();
  }

  leaveBtn.addEventListener('click', () => {
    if (!match || (phase !== 'countdown' && phase !== 'fighting')) return;
    broadcast({ op: 'leave' });
    cleanupMatch();
    phase = 'off';
    joinRoom(LOBBY_ROOM_ID);
    ctx.resumeLobby('You left the battle');
  });

  // ── Gear on other fighters (gun / shield / wand / bubble) ────────────────
  // The gun and shield on another human, held like the local player holds them: same
  // models, on the same floating hand with the same hold offset / rotation, and both hands
  // on the grip (ctx.getWeaponGear — taken from the player's own Pistol / Shield)
  function attachGunGear(c) {
    c.gearTried = true;
    const model = combatantModel(c);
    const gear = ctx.getWeaponGear?.();
    if (!model || !gear) {
      c.gearTried = false; // (models still loading: try again later)
      return;
    }
    // The weapon hand: the floating hand the player's Weapon attaches to (labels mirrored)
    const hand = model.children.find((child) => child.userData?.proceduralHand === 'left');
    const place = (mesh, kind) => {
      if (!mesh) return null;
      const g = gear[kind];
      mesh.position.copy(g.offset);
      if (!hand) mesh.position.add(g.grip);
      mesh.quaternion.copy(g.quaternion);
      mesh.visible = false;
      (hand || model).add(mesh);
      return mesh;
    };
    c.gripGun = gear.gun.grip.clone();
    c.gripShield = gear.shield.grip.clone();
    c.gunMesh = place(gear.gun.createMesh(), 'gun');
    c.shieldMesh = place(gear.shield.createMesh(), 'shield');
  }

  const updateGunGear = (c) => {
    if (!c.gearTried && (c.weapon === 'gun' || c.weapon === 'shield')) attachGunGear(c);
    const alive = c.alive && phase !== 'off';
    if (c.gunMesh) c.gunMesh.visible = alive && c.weapon === 'gun';
    if (c.shieldMesh) c.shieldMesh.visible = alive && c.weapon === 'shield';
    const grip = c.weapon === 'shield' ? c.gripShield : c.weapon === 'gun' ? c.gripGun : null;
    const model = ctx.getRemoteModel(c.id);
    if (model && grip && alive) model.userData.remoteHandTarget = grip;
  };

  const updateBubble = (c, on) => {
    if (on && !c.bubbleMesh) {
      c.bubbleMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 24, 16),
        new THREE.MeshPhongMaterial({
          color: 0x7fd8ff, emissive: 0x1a5f8a, specular: 0xffffff, shininess: 90,
          transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide
        })
      );
      c.bubbleMesh.renderOrder = 10;
      ctx.scene.add(c.bubbleMesh);
    }
    if (!c.bubbleMesh) return;
    const pos = posOf(c);
    c.bubbleMesh.visible = !!(on && pos && c.alive);
    if (c.bubbleMesh.visible) c.bubbleMesh.position.copy(pos).setY(pos.y + 0.85);
  };

  // `attackerId`'s bullet / bomb reached `target`; only the attacker's game acts on it
  const ownsAttacker = (a) => !!a && (a.isSelf || (a.bot && !!a.enemy));
  const rangedHit = (attackerId, target, dmg, dir, kind, src) => {
    if (!match || phase !== 'fighting' || !target?.alive) return;
    const attacker = match.combatants.get(attackerId);
    if (!ownsAttacker(attacker) || !isEnemyOf(attacker, target)) return;
    const len = Math.hypot(dir?.x ?? 0, dir?.z ?? 0);
    const d = len > 1e-4 ? [round3(dir.x / len), round3(dir.z / len)] : [0, 1];
    const s = src ? [round3(src.x), round3(src.z)] : null;
    if (target.isSelf) {
      noteHit(target, attackerId, kind);
      ctx.applyHit(dmg, d, { kind, src: s });
    } else if (target.enemy) {
      applyBotDamage(target, { x: d[0], z: d[1] }, dmg, attackerId, kind, src);
    } else if (target.bot) {
      send(match.hostId, { op: 'botHit', key: match.matchId, bot: target.id, dir: d, dmg, kind, src: s });
    } else {
      send(target.id, { op: 'hit', key: match.matchId, dmg, dir: d, kind, src: s, by: attackerId });
      const model = combatantModel(target);
      if (model) ctx.spawnBlood(_tmpV.copy(model.position).setY(model.position.y + BODY_CENTER_Y), model.position.y);
    }
  };

  // Everyone a bullet can stop at (projectiles.js); null outside a battle
  const getShotTargets = () => {
    if (!match || phase === 'off') return null;
    const out = [];
    match.combatants.forEach((c) => {
      if (!c.alive) return;
      const pos = posOf(c);
      if (!pos) return;
      c.shotTarget ??= {
        id: c.id,
        position: null,
        onHit: (shooterId, dir) => {
          const shooter = match?.combatants.get(shooterId);
          rangedHit(shooterId, c, GUN_DAMAGE, dir, 'gun', shooter ? posOf(shooter) : null);
        }
      };
      c.shotTarget.position = pos;
      out.push(c.shotTarget);
    });
    return out;
  };

  // Who a bomb thrown by `throwerId` can blast (blastEnemiesAt targets; never the thrower)
  const bombTargetsFor = (throwerId) => () => {
    if (!match) return [];
    const out = [];
    match.combatants.forEach((c) => {
      if (c.id === throwerId || !c.alive) return;
      const model = combatantModel(c);
      if (!model) return;
      out.push({
        group: model,
        isDead: false,
        applyDamage: () => false,
        applyBlastKnockback: ({ direction }) => {
          // Blast came from the bomb's side of the target (for the shield check)
          const src = _tmpV3.copy(model.position).sub(direction);
          rangedHit(throwerId, c, BOMB_DAMAGE, direction, 'bomb', src);
        }
      });
    });
    return out;
  };

  const launchBomb = (throwerId, origin, target, keepHeld) => {
    ctx.launchBomb(origin, target, bombTargetsFor(throwerId), keepHeld);
  };

  // The local player threw a bomb (bootstrap's bomb release); false outside a battle
  const throwLocalBomb = (origin, target) => {
    if (!match || phase !== 'fighting') return false;
    broadcast({ op: 'bomb', o: origin.toArray().map(round3), t: target.toArray().map(round3) });
    launchBomb(myId(), origin, target, false);
    return true;
  };

  // ── Magic blasts ─────────────────────────────────────────────────────────
  // The local player cast `blast` (side 'match', caster = our id): show it to everyone
  const onLocalCast = (blast) => {
    if (!match || phase !== 'fighting' || !blast) return;
    broadcast({
      op: 'magic',
      o: blast.origin.toArray().map(round3),
      f: blast.forward.toArray().map(round3),
      l: blast.line.toArray().map(round3),
      e: blast.element === 'ice' ? 'ice' : 'fire'
    });
  };

  // Targets of a battle blast (magicBlast.js): every client checks only itself, the host
  // also its bots; the other fighters just stop it ("ghost" targets, no damage)
  const getMagicTargets = (blast) => {
    if (!match || phase !== 'fighting') return [];
    const caster = match.combatants.get(blast.caster);
    if (!caster) return [];
    const out = [];
    match.combatants.forEach((c) => {
      if (!c.alive || !isEnemyOf(caster, c)) return;
      const model = combatantModel(c);
      if (!model) return;
      if (c.isSelf) {
        const t = ctx.getLocalBlastTarget();
        out.push({
          center: t.center.copy(model.position).setY(model.position.y + 0.5),
          radius: t.radius,
          blocks: t.blocks,
          onHit: (b) => {
            noteHit(c, caster.id, b.element);
            t.onHit(b);
          }
        });
      } else if (c.enemy) {
        out.push({
          center: c.enemy.getCenterWorldPos(),
          radius: (c.enemy.bodyHitRadius ?? 0.45) * 0.9,
          blocks: (b) => !!c.enemy.blocksBlast?.(b),
          onBlocked: () => c.enemy.applyBlockImpact?.(),
          onHit: (b) => {
            const dir = b.forward;
            applyBotDamage(c, dir, ctx.magicDamage[b.element] ?? 1, caster.id, b.element);
            if (b.element === 'ice' && c.alive) c.enemy.freeze?.(ctx.magicFreezeSeconds());
          }
        });
      } else {
        out.push({
          center: _tmpV2.copy(model.position).setY(model.position.y + 0.5).clone(),
          radius: 0.42,
          onHit: () => {}
        });
      }
    });
    return out;
  };

  // ── Pickups ──────────────────────────────────────────────────────────────
  // Host: `takerId` stands on pickup `pid`
  const hostTake = (takerId, pid) => {
    const p = pickups.get(pid);
    const taker = match?.combatants.get(takerId);
    if (!p || !taker?.alive || phase !== 'fighting' || !pickups.isAvailable(pid)) return;
    const pos = posOf(taker);
    if (!pos || Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z) > PICKUP_TOUCH + 2) return; // (lag slack)
    const r = PICKUP_TYPES[p.type].respawnMs;
    pickups.setTaken(pid, Date.now() + r);
    broadcast({ op: 'taken', pid, by: takerId, r });
    givePickup(taker, p.type);
  };

  const givePickup = (c, type) => {
    if (c.isSelf) {
      ctx.applyPickup(type);
    } else if (c.enemy && c.loadout) {
      const L = c.loadout;
      const B = ctx.botLoadout;
      if (type === 'heart') c.enemy.hearts = Math.min(c.enemy.maxHearts, c.enemy.hearts + B.heartPickup);
      else if (type === 'potion') c.enemy.hearts = c.enemy.maxHearts;
      else if (type === 'bomb') L.bombs += B.bombPickup;
      else if (type === 'bubble') L.bubbles += 1;
      else if (type === 'gun') {
        L.ammo += B.gunAmmo + (L.gun ? 0 : L.ammoBank);
        if (!L.gun) L.ammoBank = 0;
        L.gun = true;
      } else if (type === 'ammo') {
        if (L.gun) L.ammo += B.ammoPickup;
        else L.ammoBank += B.ammoPickup;
      } else if (type === 'shield') {
        L.shield = true;
        L.shieldBlocks = BOT_SHIELD_BLOCKS;
      } else if (type === 'wand') {
        L.wand = true;
        L.mana = B.maxMana;
      } else if (type === 'mana') {
        L.mana = Math.min(B.maxMana, L.mana + B.manaPickup);
      }
      c.hp = c.enemy.hearts;
      syncBotGear(c);
      renderLabel(c);
    }
  };

  // Whether a host bot could use pickup `pk` now
  const botWants = (c, pk) => {
    const L = c.loadout;
    const B = ctx.botLoadout;
    if (!L || !c.enemy) return false;
    switch (pk.type) {
      case 'heart':
      case 'potion': return c.enemy.hearts < c.enemy.maxHearts;
      case 'gun': return !L.gun || L.ammo < BOT_WANTS_AMMO_BELOW;
      case 'ammo': return L.gun ? L.ammo < BOT_WANTS_AMMO_BELOW : L.ammoBank < BOT_WANTS_AMMO_BELOW;
      case 'shield': return !L.shield;
      case 'wand': return !L.wand || L.mana < B.maxMana / 2;
      case 'mana': return L.wand && L.mana < B.maxMana;
      case 'bomb': return L.bombs < BOT_WANTS_BOMBS_BELOW;
      case 'bubble': return L.bubbles < BOT_WANTS_BUBBLES_BELOW;
      default: return false;
    }
  };

  const updatePickups = (dt, now) => {
    pickups.update(dt, now);
    if (phase !== 'fighting') return;
    const me = match.combatants.get(myId());
    if (me?.alive) {
      const pos = posOf(me);
      const p = pos && pickups.findTouching(pos, PICKUP_TOUCH, now);
      if (p) {
        if (match.isHost) hostTake(me.id, p.id);
        else if (now - (match.takeSentAt.get(p.id) ?? 0) > TAKE_RETRY_MS) {
          match.takeSentAt.set(p.id, now);
          send(match.hostId, { op: 'take', key: match.matchId, pid: p.id });
        }
      }
    }
    if (!match.isHost) return;
    match.combatants.forEach((c) => {
      if (!c.enemy || !c.alive) return;
      const p = pickups.findTouching(c.enemy.group.position, PICKUP_TOUCH, now, (pk) => botWants(c, pk));
      if (p) hostTake(c.id, p.id);
    });
  };

  // ── Host: bots ───────────────────────────────────────────────────────────
  // A bot's swing reached someone other than the host player: block check, then damage
  const resolveBotHit = (bot, targetId, swingDir) => {
    const t = match?.combatants.get(targetId);
    if (!t?.alive || phase !== 'fighting') return null;
    const botPos = bot.enemy.group.position;
    const model = combatantModel(t);
    if (!model) return null;
    const toTarget = _tmpV2.subVectors(model.position, botPos).setY(0);
    if (t.enemy) {
      if (t.enemy.blocksSwing(swingDir, botPos)) {
        const guard = t.fighter?.guardKind(botPos);
        if (guard) botGuarded(t, guard);
        return 'blocked';
      }
      applyBotDamage(t, toTarget.clone().normalize(), 1, bot.id, 'sword');
      return 'hit';
    }
    if (t.bubble) return 'blocked';
    const blade = t.weapon === 'wand' ? t.wandMesh : t.sword;
    if (t.blocking && blade?.visible) {
      _tmpV.set(0, 0, 1).applyQuaternion(blade.quaternion);
      if (swingCrossesBlade(swingDir, _tmpV, toTarget, PLAYER_BLOCK_MIN_ANGLE_DEG)) {
        send(t.id, { op: 'blocked', key: match.matchId });
        return 'blocked';
      }
    }
    const len = Math.hypot(toTarget.x, toTarget.z) || 1;
    send(t.id, { op: 'hit', key: match.matchId, dmg: 1, dir: [toTarget.x / len, toTarget.z / len], kind: 'sword', by: bot.id });
    ctx.spawnBlood(_tmpV.copy(model.position).setY(model.position.y + BODY_CENTER_Y), model.position.y);
    return 'hit';
  };

  // A host bot's gear: what it has picked up (and not used up yet) → its boss fighter
  const newBotLoadout = () => ({
    gun: false, ammo: 0, ammoBank: 0,
    shield: false, shieldBlocks: 0,
    wand: false, mana: 0,
    bombs: 0, bubbles: 0
  });
  const syncBotGear = (c) => {
    const L = c.loadout;
    if (!L || !c.fighter) return;
    if (L.gun && L.ammo <= 0) L.gun = false;
    if (L.shield && L.shieldBlocks <= 0) L.shield = false;
    c.fighter.setGear({
      gun: L.gun,
      shield: L.shield,
      wand: L.wand && L.mana >= ctx.botLoadout.manaCost,
      bombs: L.bombs > 0,
      bubble: L.bubbles > 0
    });
  };
  // Its shield / bubble stopped something (a shield wears out)
  const botGuarded = (c, kind) => {
    if (kind !== 'shield' || !c.loadout) return;
    c.loadout.shieldBlocks -= 1;
    syncBotGear(c);
  };
  const botTargetModel = (c) => {
    if (!match || phase !== 'fighting' || !c.alive) return null;
    const t = match.combatants.get(c.targetId);
    return t?.alive ? combatantModel(t) : null;
  };
  const vecMsg = (v) => v.toArray().map(round3);
  // Host: a new bot EnemyPlayer (start / respawn) gets its fighter and an empty loadout
  function setupBot(c) {
    c.loadout = newBotLoadout();
    c.seek = null;
    const enemy = c.enemy;
    c.fighter = createBossFighter({
      enemy,
      name: c.name,
      hud: false,
      glow: false,
      swordMs: BOT_SWORD_MS,
      wandRange: BOT_WAND_RANGE,
      gear: {},
      getTarget: () => botTargetModel(c),
      getWeaponGear: () => ctx.getWeaponGear?.() ?? null,
      fireBullet: (origin, dir) => {
        if (!match || phase !== 'fighting' || c.loadout.ammo <= 0) return;
        c.loadout.ammo -= 1;
        ctx.spawnShot(origin, dir, c.id);
        broadcast({ op: 'shot', bot: c.id, o: vecMsg(origin), d: vecMsg(dir) });
        syncBotGear(c);
      },
      throwBomb: (origin, target) => {
        if (!match || phase !== 'fighting' || c.loadout.bombs <= 0) return;
        c.loadout.bombs -= 1;
        launchBomb(c.id, origin, target, true);
        broadcast({ op: 'bomb', bot: c.id, o: vecMsg(origin), t: vecMsg(target) });
        syncBotGear(c);
      },
      onShieldBlock: (pos, kind) => botGuarded(c, kind),
      useBubble: () => {
        if (c.loadout.bubbles <= 0) return false;
        c.loadout.bubbles -= 1;
        syncBotGear(c);
        return true;
      }
    });
    // Its wand spells (the fighter's wand spell → EnemyPlayer's casting AI)
    enemy.onCast = ({ origin, forward, line, element }) => {
      const cost = ctx.botLoadout.manaCost;
      if (!match || phase !== 'fighting' || !c.alive || c.loadout.mana < cost) return;
      c.loadout.mana -= cost;
      ctx.spawnMagic({ origin, forward, line, element, caster: c.id });
      broadcast({ op: 'magic', bot: c.id, o: vecMsg(origin), f: vecMsg(forward), l: vecMsg(line), e: element === 'ice' ? 'ice' : 'fire' });
      syncBotGear(c);
    };
  }

  // A pickup a bot wants near it, closer than its target: it heads there on its way
  // (EnemyPlayer.chaseVia — it still faces / fights its target once that's in reach)
  const updateBotSeek = (bot, targetModel, now) => {
    const pos = bot.enemy.group.position;
    const targetD = targetModel ? pos.distanceTo(targetModel.position) : Infinity;
    let best = null;
    let bestD = Math.min(BOT_SEEK_RADIUS, targetD);
    for (const pk of pickups.list) {
      if (!pickups.isAvailable(pk.id, now) || !botWants(bot, pk)) continue;
      const d = Math.hypot(pk.pos.x - pos.x, pk.pos.z - pos.z);
      if (d < bestD) { bestD = d; best = pk; }
    }
    bot.seek = best;
    bot.enemy.chaseVia = best
      ? (from, to, out) => (bot.seek && pickups.isAvailable(bot.seek.id) ? out.set(bot.seek.pos.x, from.y, bot.seek.pos.z) : null)
      : null;
  };

  const updateBots = (dt, now) => {
    const fighting = phase === 'fighting';
    const all = [...match.combatants.values()];
    const bots = all.filter((c) => c.bot);
    // Most Kills: bots back on their feet
    if (fighting && match.rule === 'kills') {
      for (const bot of bots) {
        if (!bot.alive && !bot.left && bot.respawnAt && now >= bot.respawnAt) respawnBot(bot);
      }
    }
    // Targets: closest living enemy (re-picked a few times a second)
    for (const bot of bots) {
      if (!bot.alive || !bot.enemy) continue;
      const cur = match.combatants.get(bot.targetId);
      if (!cur?.alive || now - bot.retargetAt > BOT_RETARGET_MS) {
        bot.retargetAt = now;
        let best = null;
        let bestD = Infinity;
        for (const c of all) {
          if (!c.alive || !isEnemyOf(bot, c)) continue;
          const m = combatantModel(c);
          if (!m) continue;
          const d = m.position.distanceToSquared(bot.enemy.group.position);
          if (d < bestD) { bestD = d; best = c; }
        }
        bot.targetId = best?.id ?? null;
      }
    }
    // Attack slots: the closest BOT_ATTACKERS_PER_TARGET bots on each target swing
    const byTarget = new Map();
    for (const bot of bots) {
      if (!bot.alive || !bot.targetId || !bot.enemy) continue;
      if (!byTarget.has(bot.targetId)) byTarget.set(bot.targetId, []);
      byTarget.get(bot.targetId).push(bot);
    }
    const allowed = new Set();
    byTarget.forEach((list, targetId) => {
      const m = combatantModel(match.combatants.get(targetId));
      if (!m) return;
      list.sort((a, b) => a.enemy.group.position.distanceToSquared(m.position)
        - b.enemy.group.position.distanceToSquared(m.position));
      list.slice(0, BOT_ATTACKERS_PER_TARGET).forEach((b) => allowed.add(b));
    });
    for (const bot of bots) {
      if (!bot.enemy?.rigidBody) continue; // faded out and destroyed
      if (!bot.alive) {
        bot.enemy.update(dt, null, null, false, false);
        bot.fighter?.update(); // (puts its gun / shield away)
        continue;
      }
      const target = match.combatants.get(bot.targetId);
      const targetModel = target?.alive ? combatantModel(target) : null;
      const targetIsMe = !!target?.isSelf;
      bot.enemy.targetHitHandler = targetIsMe ? null : (m, swingDir) => resolveBotHit(bot, bot.targetId, swingDir);
      bot.enemy._onHitPlayer = targetIsMe ? (dir) => {
        noteHit(target, bot.id, 'sword');
        ctx.knockbackLocal(dir);
      } : null;
      if (fighting) updateBotSeek(bot, targetModel, now);
      bot.enemy.update(dt, targetModel, targetIsMe ? ctx.getPlayerControls() : null, false,
        fighting && allowed.has(bot));
      bot.fighter?.update();
    }
  };

  const botLocalSword = new THREE.Vector3();
  const botLocalQ = new THREE.Quaternion();
  const sendBots = (now) => {
    const list = [];
    match.combatants.forEach((c) => {
      if (!c.bot || !c.enemy) return;
      const g = c.enemy.group;
      const entry = {
        id: c.id,
        p: [round3(g.position.x), round3(g.position.y), round3(g.position.z)],
        r: round3(g.rotation.y),
        hp: c.hp,
        d: !c.alive,
        b: c.enemy.isBlocking(),
        pr: now < c.protectedUntil || c.fighter?.isBubbleUp() ? 1 : 0,
        w: c.alive ? (c.fighter?.getPhase() ?? 'sword') : null
      };
      const sg = c.enemy._swordGroup;
      if (sg?.visible && c.alive) {
        g.updateMatrixWorld();
        botLocalSword.copy(sg.position);
        g.worldToLocal(botLocalSword);
        botLocalQ.copy(g.quaternion).invert().multiply(sg.quaternion);
        entry.s = { p: botLocalSword.toArray().map(round3), q: botLocalQ.toArray().map(round3) };
        const h = c.enemy._rightHandGroup.position;
        entry.h = [round3(h.x), round3(h.y), round3(h.z)];
      }
      list.push(entry);
    });
    broadcast({ op: 'bots', list });
  };

  // ── Remote combatants (other humans; bots on non-host clients) ───────────
  const applySwordState = (c, sword, hand) => {
    if (sword && isVec(sword.p, 3) && isVec(sword.q, 4)) {
      c.swordTarget.pos.fromArray(sword.p);
      c.swordTarget.quat.fromArray(sword.q).normalize();
      c.swordTarget.has = true;
    } else {
      c.swordTarget.has = false;
    }
    if (isVec(hand, 3)) c.hand.fromArray(hand);
  };

  const placeAtSword = (mesh, model, c) => {
    mesh.position.copy(c.swordTarget.pos);
    model.updateMatrixWorld();
    model.localToWorld(mesh.position);
    mesh.quaternion.copy(model.quaternion).multiply(c.swordTarget.quat);
  };

  const updateRemoteCombatant = (c) => {
    const model = ctx.getRemoteModel(c.id);
    if (model) model.userData.remoteHandTarget = c.hand;
    const show = !!(model && c.alive && c.swordTarget.has);
    const wand = c.weapon === 'wand' && !!c.wandMesh;
    if (c.sword) {
      c.sword.visible = show && !wand;
      if (c.sword.visible) placeAtSword(c.sword, model, c);
    }
    if (c.wandMesh) {
      c.wandMesh.visible = show && wand;
      if (c.wandMesh.visible) placeAtSword(c.wandMesh, model, c);
    }
  };

  const updateLabels = () => {
    const camera = ctx.camera;
    if (!camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    match.combatants.forEach((c) => {
      if (!c.label) return;
      const root = c.label.root;
      const model = combatantModel(c);
      if (!model || (!c.alive && c.enemy && !c.enemy.group.parent) || c.left) {
        root.style.display = 'none';
        return;
      }
      _tmpV.copy(model.position);
      _tmpV.y += 1.55;
      _tmpV.project(camera);
      if (_tmpV.z < 0 || _tmpV.z > 1) {
        root.style.display = 'none';
        return;
      }
      root.style.display = 'flex';
      root.style.left = `${(_tmpV.x * 0.5 + 0.5) * w}px`;
      root.style.top = `${(-_tmpV.y * 0.5 + 0.5) * h}px`;
    });
  };

  // ── Per-frame ────────────────────────────────────────────────────────────
  const update = (dt) => {
    if (!match || (phase !== 'countdown' && phase !== 'fighting' && phase !== 'over')) return;
    const now = Date.now();
    const selfId = myId();
    const me = match.combatants.get(selfId);

    // Players who left (gone from the lobby list or silent): out of the battle
    if (phase !== 'over') {
      const peers = ctx.getMultiplayer()?.getOnlinePeers?.();
      const hasPeers = peers && Object.keys(peers).length > 0;
      for (const c of match.combatants.values()) {
        if (c.bot || c.isSelf || c.left) continue;
        const gone = (hasPeers && !peers[c.id]) || now - c.lastHeardAt > HUMAN_TIMEOUT_MS;
        if (!gone) continue;
        if (c.id === match.hostId) {
          showEnd({ reason: `${c.name} (the host) left` });
          return;
        }
        markDead(c.id, { left: true });
      }
    }

    // Most Kills: our own respawn
    if (phase === 'fighting' && me && !me.alive && me.respawnAt) {
      if (now >= me.respawnAt) respawnSelf(me);
      else {
        const killer = me.lastHitBy ? match.combatants.get(me.lastHitBy) : null;
        bannerSub.textContent = `${killer ? `${KIND_ICONS[me.lastHitKind]} by ${killer.name} · ` : ''}respawning in ${Math.ceil((me.respawnAt - now) / 1000)}`;
      }
    }

    if (me && phase !== 'over' && now - match.lastStateSentAt >= STATE_SEND_MS) {
      match.lastStateSentAt = now;
      const state = ctx.getLocalSwordState() || {};
      const model = ctx.getLocalPlayerModel();
      if (me.alive) me.hp = Math.max(0, ctx.getLocalHealth());
      broadcast({
        op: 'state',
        sword: state.sword ?? null,
        hand: state.hand ?? null,
        blocking: !!state.blocking,
        pos: model ? [round3(model.position.x), round3(model.position.y), round3(model.position.z)] : null,
        ry: model ? round3(model.rotation.y) : null,
        hp: me.hp,
        w: ctx.getLocalWeapon?.() ?? null,
        bu: ctx.isBubbleActive?.() ? 1 : 0
      });
    }

    if (match.isHost) {
      updateBots(dt, now);
      if (match && now - match.lastBotSentAt >= BOT_SEND_MS) {
        match.lastBotSentAt = now;
        sendBots(now);
      }
      checkKillsWinner(now);
    }
    if (!match) return;
    updatePickups(dt, now);
    match.combatants.forEach((c) => {
      if (!c.isSelf && !c.enemy) {
        updateRemoteCombatant(c);
        updateGunGear(c);
      }
      if (c.enemy && c.alive) c.hp = c.enemy.hearts;
      if (!c.isSelf) updateBubble(c, c.bubble || (c.enemy && now < c.protectedUntil));
      renderLabel(c);
    });
    updateLabels();
    renderHud();
  };

  // Enemies the local sword can hit this frame (bootstrap's phone-sword hit loop)
  const getEnemyCombatants = () => {
    if (phase !== 'fighting' || !match) return [];
    const me = match.combatants.get(myId());
    if (!me?.alive) return [];
    const out = [];
    match.combatants.forEach((c) => {
      if (!c.alive || !isEnemyOf(me, c)) return;
      if (!c.combat) {
        c.combat = {
          id: c.id,
          position: new THREE.Vector3(),
          center: new THREE.Vector3(),
          bladePoints: _bladeOffsets.map(() => new THREE.Vector3()),
          bladeDir: new THREE.Vector3(),
          hasBlade: false,
          blocking: false,
          ownBlood: !!c.enemy, // EnemyPlayer.applyDamage sprays its own blood
          blocksSwing: c.enemy ? (swingDir, attackerPos) => c.enemy.blocksSwing(swingDir, attackerPos) : null,
          onHit: (dmg, dir) => {
            if (!match || phase !== 'fighting') return;
            if (c.enemy) applyBotDamage(c, dir, 1, myId(), 'sword');
            else if (c.bot) send(match.hostId, { op: 'botHit', key: match.matchId, bot: c.id, dir: [dir.x, dir.z] });
            else send(c.id, { op: 'hit', key: match.matchId, dmg: 1, dir: [dir.x, dir.z], kind: 'sword' });
          },
          onBlocked: () => {
            if (!match || phase !== 'fighting') return;
            if (c.enemy) c.enemy.applySwordBounce();
            else if (c.bot) send(match.hostId, { op: 'botBlocked', key: match.matchId, bot: c.id });
            else send(c.id, { op: 'blocked', key: match.matchId });
          }
        };
      }
      const combat = c.combat;
      combat.blocksSwing = c.enemy ? (swingDir, attackerPos) => c.enemy.blocksSwing(swingDir, attackerPos) : null;
      combat.ownBlood = !!c.enemy;
      const model = combatantModel(c);
      if (!model) return;
      combat.position.copy(model.position);
      combat.center.copy(model.position);
      combat.center.y += BODY_CENTER_Y;
      const blade = c.enemy ? c.enemy._swordGroup : (c.wandMesh?.visible ? c.wandMesh : c.sword);
      combat.hasBlade = !!blade?.visible;
      if (combat.hasBlade) {
        _bladeOffsets.forEach((offset, i) => {
          combat.bladePoints[i].copy(offset).applyQuaternion(blade.quaternion).add(blade.position);
        });
        combat.bladeDir.set(0, 0, 1).applyQuaternion(blade.quaternion);
      }
      combat.blocking = c.enemy ? c.enemy.isBlocking() : c.blocking;
      out.push(combat);
    });
    return out;
  };

  // ── Messages ─────────────────────────────────────────────────────────────
  const handleMessage = (peerId, data) => {
    const { op, key } = data || {};
    if (typeof op !== 'string' || typeof key !== 'string' || !KEY_RE.test(key)) return;
    if (typeof peerId !== 'string' || !ID_RE.test(peerId)) return;

    // Battle traffic
    if (match && key === match.matchId) {
      const c = match.combatants.get(peerId);
      if (!c || c.bot || c.isSelf) return;
      if (c.lastHeardAt !== Infinity) c.lastHeardAt = Date.now();
      const fromHost = peerId === match.hostId && !match.isHost;
      // A host bot named in a message from the host
      const hostBot = (id) => {
        const b = fromHost && typeof id === 'string' ? match.combatants.get(id) : null;
        return b?.bot ? b : null;
      };
      const pose3 = (v) => (isVec(v, 3) ? { x: v[0], z: v[1], yaw: v[2] } : null);
      switch (op) {
        case 'state': {
          if (c.left) return;
          applySwordState(c, data.sword, data.hand);
          c.blocking = !!data.blocking;
          c.weapon = ['sword', 'wand', 'gun', 'shield'].includes(data.w) ? data.w : null;
          c.bubble = !!data.bu;
          if (Number.isFinite(data.hp) && c.alive) c.hp = Math.max(0, Math.min(99, Math.round(data.hp)));
          if (isVec(data.pos, 3)) {
            ctx.setRemotePose(c.id, data.pos, Number.isFinite(data.ry) ? data.ry : null,
              c.name, MATCH_CHARACTERS[c.char].url);
          }
          return;
        }
        case 'bots': {
          if (!fromHost || !Array.isArray(data.list)) return;
          for (const b of data.list.slice(0, MATCH_SIZE)) {
            const bot = hostBot(b?.id);
            if (!bot) continue;
            if (isVec(b.p, 3)) {
              ctx.setRemotePose(bot.id, b.p, Number.isFinite(b.r) ? b.r : null,
                bot.name, MATCH_CHARACTERS[bot.char].url);
            }
            applySwordState(bot, b.s, b.h);
            bot.blocking = !!b.b;
            bot.bubble = !!b.pr;
            bot.weapon = ['sword', 'wand', 'gun', 'shield'].includes(b.w) ? b.w : 'sword';
            if (Number.isFinite(b.hp) && bot.alive) bot.hp = Math.max(0, Math.round(b.hp));
            if (b.d && bot.alive) markDead(bot.id);
            else if (!b.d && !bot.alive && match.rule === 'kills' && isVec(b.p, 3)) {
              // (missed its respawn message)
              reviveCombatant(bot, { x: b.p[0], z: b.p[2], yaw: Number.isFinite(b.r) ? b.r : 0 });
            }
          }
          return;
        }
        case 'hit': {
          if (phase !== 'fighting') return;
          const me = match.combatants.get(myId());
          if (!me?.alive) return;
          const kind = cleanKind(data.kind);
          const ranged = kind === 'gun' || kind === 'bomb';
          noteHit(me, hostBot(data.by)?.id ?? peerId, kind);
          ctx.applyHit(
            Math.max(1, Math.min(3, Math.round(Number(data.dmg) || 1))),
            isVec(data.dir, 2) ? data.dir : null,
            ranged ? { kind, src: isVec(data.src, 2) ? data.src : null } : undefined
          );
          return;
        }
        case 'bomb': {
          if (!isVec(data.o, 3) || !isVec(data.t, 3)) return;
          let throwerId = peerId;
          if (data.bot != null) {
            const bot = hostBot(data.bot);
            if (!bot) return;
            throwerId = bot.id;
          }
          launchBomb(throwerId, new THREE.Vector3().fromArray(data.o), new THREE.Vector3().fromArray(data.t), true);
          return;
        }
        case 'magic': {
          // (a host bot's, or the sender's own)
          const caster = data.bot != null ? hostBot(data.bot) : c;
          if (phase !== 'fighting' || !caster?.alive) return;
          if (!isVec(data.o, 3) || !isVec(data.f, 3) || !isVec(data.l, 3)) return;
          ctx.spawnMagic({
            origin: new THREE.Vector3().fromArray(data.o),
            forward: new THREE.Vector3().fromArray(data.f),
            line: new THREE.Vector3().fromArray(data.l),
            element: data.e === 'ice' ? 'ice' : 'fire',
            caster: caster.id
          });
          return;
        }
        case 'shot': {
          // A host bot's bullet (the host deals its damage)
          const bot = hostBot(data.bot);
          if (phase !== 'fighting' || !bot?.alive || !isVec(data.o, 3) || !isVec(data.d, 3)) return;
          ctx.spawnShot(new THREE.Vector3().fromArray(data.o), new THREE.Vector3().fromArray(data.d).normalize(), bot.id);
          return;
        }
        case 'blocked':
          ctx.onSwingBlocked();
          return;
        case 'botHit':
        case 'botBlocked': {
          if (!match.isHost || phase !== 'fighting' || !c.alive) return;
          const bot = typeof data.bot === 'string' ? match.combatants.get(data.bot) : null;
          if (!bot?.enemy || !bot.alive || !isEnemyOf(c, bot)) return;
          if (op === 'botBlocked') {
            bot.enemy.applySwordBounce();
            return;
          }
          const dir = isVec(data.dir, 2) ? new THREE.Vector3(data.dir[0], 0, data.dir[1]) : null;
          const kind = data.kind === 'gun' || data.kind === 'bomb' ? data.kind : 'sword';
          const dmg = kind === 'bomb' ? BOMB_DAMAGE : kind === 'gun' ? GUN_DAMAGE : 1;
          const src = kind !== 'sword' && isVec(data.src, 2) ? { x: data.src[0], z: data.src[1] } : null;
          applyBotDamage(bot, dir, dmg, peerId, kind, src);
          return;
        }
        case 'dead': {
          const by = typeof data.by === 'string' && match.combatants.has(data.by) ? data.by : null;
          markDead(peerId, { by, kind: data.kind });
          return;
        }
        case 'kill': {
          if (!fromHost) return;
          applyScores(data.sc);
          const v = typeof data.v === 'string' ? match.combatants.get(data.v) : null;
          if (!v) return;
          const by = typeof data.by === 'string' && match.combatants.has(data.by) ? data.by : null;
          addFeed(v.id, by, data.k);
          if (by === myId()) showKillPop(v.name);
          if (!v.isSelf) markDead(v.id);
          renderHud(true);
          return;
        }
        case 'respawn': {
          if (match.rule !== 'kills' || phase !== 'fighting') return;
          const pose = pose3(data.pos);
          if (!pose) return;
          const who = data.bot != null ? hostBot(data.bot) : c;
          if (!who || who.alive || who.left) return;
          reviveCombatant(who, pose);
          return;
        }
        case 'take': {
          if (!match.isHost || typeof data.pid !== 'string' || !PID_RE.test(data.pid)) return;
          hostTake(peerId, data.pid);
          return;
        }
        case 'taken': {
          if (!fromHost || typeof data.pid !== 'string' || !PID_RE.test(data.pid)) return;
          const p = pickups.get(data.pid);
          if (!p) return;
          const r = Number.isFinite(data.r) ? Math.max(1000, Math.min(120000, data.r)) : PICKUP_TYPES[p.type].respawnMs;
          pickups.setTaken(p.id, Date.now() + r);
          if (data.by === myId() && match.combatants.get(myId())?.alive) ctx.applyPickup(p.type);
          return;
        }
        case 'end':
          if (!fromHost) return;
          applyScores(data.sc);
          showEnd({
            winnerTeam: data.winnerTeam === 0 || data.winnerTeam === 1 ? data.winnerTeam : null,
            winnerId: typeof data.winnerId === 'string' ? data.winnerId : null,
            winnerName: data.winnerName
          });
          return;
        case 'leave':
          if (peerId === match.hostId) {
            showEnd({ reason: `${c.name} (the host) left` });
            return;
          }
          c.lastHeardAt = Infinity;
          markDead(peerId, { left: true });
          return;
        default:
          return;
      }
    }

    switch (op) {
      // ── Receiving an invite ──
      case 'invite': {
        const mode = MATCH_MODES[data.mode] ? data.mode : null;
        if (!mode) return;
        if (!canTakeInvite()) {
          send(peerId, { op: 'decline', key, reason: 'busy' });
          return;
        }
        const name = cleanName(data.name, 'Someone');
        const rule = cleanRule(data.rule);
        pendingInvite = {
          key, from: peerId, name, mode, rule,
          timer: setTimeout(() => {
            if (pendingInvite?.key === key) hideInvitePrompt();
          }, INVITE_TIMEOUT_MS)
        };
        inviteText.textContent = `${name} invites you to ${MATCH_MODES[mode]} · ${MATCH_RULES[rule].icon} ${MATCH_RULES[rule].label}!`;
        invitePrompt.classList.remove('hidden');
        return;
      }
      case 'inviteCancel':
        if (pendingInvite?.key === key && pendingInvite.from === peerId) hideInvitePrompt();
        return;
      // ── Host side of the party ──
      case 'decline': {
        const m = party?.isHost && party.key === key ? party.members.get(peerId) : null;
        if (!m || m.status !== 'invited') return;
        clearTimeout(m.timer);
        party.members.delete(peerId);
        renderSetup();
        flashStatus(data.reason === 'busy' ? `${m.name} is busy` : `${m.name} declined`);
        return;
      }
      case 'join': {
        const m = party?.isHost && party.key === key ? party.members.get(peerId) : null;
        if (!m || m.status !== 'invited' || phase !== 'setup') {
          send(peerId, { op: 'leave', key });
          return;
        }
        clearTimeout(m.timer);
        m.status = 'joined';
        m.name = cleanName(data.name, m.name);
        m.pick = cleanPick(data.pick);
        syncHostRoom();
        broadcastParty();
        renderSetup();
        return;
      }
      case 'pick': {
        const m = party?.isHost && party.key === key ? party.members.get(peerId) : null;
        if (!m || m.status !== 'joined') return;
        m.pick = cleanPick(data.pick);
        broadcastParty();
        renderSetup();
        return;
      }
      case 'leave': {
        if (party?.isHost && party.key === key) {
          const m = party.members.get(peerId);
          if (!m) return;
          clearTimeout(m.timer);
          party.members.delete(peerId);
          syncHostRoom();
          broadcastParty();
          renderSetup();
          flashStatus(`${m.name} left the party`);
        } else if (party && !party.isHost && party.key === key && peerId === party.hostId) {
          backToLobby(`${party.hostName} closed the party`);
        }
        return;
      }
      // ── Guest side of the party ──
      case 'party': {
        if (phase !== 'guest' || party?.key !== key || peerId !== party.hostId) return;
        if (!Array.isArray(data.roster)) return;
        party.roster = data.roster.slice(0, MATCH_SIZE)
          .filter((m) => m && typeof m.id === 'string')
          .map((m) => ({ id: m.id, name: cleanName(m.name), pick: cleanPick(m.pick), host: !!m.host }));
        if (Array.isArray(data.teamChars) && data.teamChars.length === 2) {
          party.teamChars = data.teamChars.map((c) => (CHAR_KEYS.includes(c) ? c : 'antler'));
        }
        party.rule = cleanRule(data.rule);
        const self = party.roster.find((m) => m.id === myId());
        if (self) party.myPick = cleanPick(self.pick);
        renderSetup();
        return;
      }
      // ── Matchmaking queue ──
      case 'pull': {
        const ok = phase === 'setup' && party?.isHost && party.mode === data.mode
          && party.rule === cleanRule(data.rule) && joinedCount() === 0;
        if (!ok) {
          send(peerId, { op: 'pullNo', key });
          return;
        }
        cancelInvites();
        const hostName = cleanName(data.name, 'Someone');
        pulled = {
          matchId: key,
          hostId: peerId,
          hostName: `${hostName}'s`,
          timer: setTimeout(() => {
            if (phase === 'pulled' && pulled?.matchId === key) {
              pulled = null;
              phase = 'setup';
              renderSetup();
            }
          }, PULLED_TIMEOUT_MS)
        };
        phase = 'pulled';
        send(peerId, { op: 'pullOk', key, name: ctx.getPlayerName(), pick: party.myPick });
        renderSetup();
        return;
      }
      case 'pullOk':
      case 'pullNo': {
        if (phase !== 'starting' || starting?.matchId !== key || !starting.asked.has(peerId)) {
          // Answered after Start went ahead without them: let them go back to their setup
          if (op === 'pullOk') send(peerId, { op: 'pullCancel', key });
          return;
        }
        starting.replied.add(peerId);
        if (op === 'pullOk') {
          if (starting.accepted.length < starting.openSlots) {
            starting.accepted.push({ id: peerId, name: cleanName(data.name), pick: cleanPick(data.pick) });
          } else {
            send(peerId, { op: 'pullCancel', key });
          }
        }
        if (starting.replied.size >= starting.asked.size) finishStart();
        return;
      }
      case 'pullCancel':
        if (phase === 'pulled' && pulled?.matchId === key && pulled.hostId === peerId) {
          clearTimeout(pulled.timer);
          pulled = null;
          phase = 'setup';
          renderSetup();
        }
        return;
      case 'start': {
        const fromHost = (phase === 'guest' && party?.hostId === peerId && data.partyKey === party.key)
          || (phase === 'pulled' && pulled?.hostId === peerId && data.matchId === pulled.matchId);
        if (!fromHost || data.matchId !== key || !MATCH_MODES[data.mode]) return;
        beginMatch({
          matchId: key, mode: data.mode, rule: data.rule, hostId: peerId,
          roster: data.roster, teamChars: data.teamChars
        });
        return;
      }
      default:
    }
  };

  // ── Public API ───────────────────────────────────────────────────────────
  // Leave everything (Multiplayer mode is closing)
  const exit = () => {
    if (pendingInvite) send(pendingInvite.from, { op: 'decline', key: pendingInvite.key });
    hideInvitePrompt();
    if (match) {
      if (phase !== 'over') broadcast({ op: 'leave' });
      cleanupMatch();
    }
    if (pulled) {
      clearTimeout(pulled.timer);
      pulled = null;
    }
    if (starting) {
      clearTimeout(starting.timer);
      starting.asked.forEach((id) => send(id, { op: 'pullCancel', key: starting.matchId }));
      starting = null;
    }
    leaveParty();
    hideSetup();
    phase = 'off';
  };

  const onPeersChange = () => {
    const peers = ctx.getMultiplayer()?.getOnlinePeers?.() || {};
    if (!Object.keys(peers).length) return;
    if (party?.isHost) {
      let changed = false;
      party.members.forEach((m, id) => {
        if (peers[id]) return;
        clearTimeout(m.timer);
        party.members.delete(id);
        changed = true;
      });
      if (changed) {
        syncHostRoom();
        broadcastParty();
      }
    } else if (party && phase === 'guest' && !peers[party.hostId]) {
      backToLobby(`${party.hostName} went offline`);
      return;
    }
    if (pendingInvite && !peers[pendingInvite.from]) hideInvitePrompt();
    renderSetup();
  };

  return {
    openSetup,
    exit,
    update,
    handleMessage,
    onPeersChange,
    getEnemyCombatants,
    getShotTargets,
    getMagicTargets,
    onLocalCast,
    throwLocalBomb,
    // In a battle (countdown / fighting / result)
    isInMatch: () => !!match,
    isFighting: () => phase === 'fighting',
    // Human battle participants (presence + game traffic go to them)
    getPeerIds: () => humansExceptMe(),
    acceptsPresenceFrom: (peerId) => !!match?.combatants.get(peerId) && !match.combatants.get(peerId).bot,
    getCharacterUrl: (peerId) => {
      const c = match?.combatants.get(peerId);
      return c ? MATCH_CHARACTERS[c.char].url : null;
    },
    // The local player died: tell everyone (with who did it); Survival: watch until the
    // battle ends, Most Kills: back in RESPAWN_MS
    onLocalDeath: () => {
      if (!match || (phase !== 'fighting' && phase !== 'countdown')) return;
      const selfId = myId();
      const me = match.combatants.get(selfId);
      if (!me?.alive) return;
      ctx.stopWalk();
      const credit = creditOf(me);
      broadcast({ op: 'dead', by: credit.by, kind: credit.kind });
      const killer = credit.by ? match.combatants.get(credit.by) : null;
      const byText = killer ? `${KIND_ICONS[cleanKind(credit.kind)]} by ${killer.name}` : '';
      showBanner('ELIMINATED', match.rule === 'kills'
        ? `${byText ? `${byText} · ` : ''}respawning in ${Math.ceil(RESPAWN_MS / 1000)}`
        : `${byText ? `${byText} · ` : ''}watching until the battle ends`);
      markDead(selfId, credit);
    }
  };
}
