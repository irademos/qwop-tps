import * as THREE from 'three';
import { LOBBY_ROOM_ID } from './peerConnection.js';
import { DUEL_LOCATION } from './duelMode.js';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';
import { swingCrossesBlade, PLAYER_BLOCK_MIN_ANGLE_DEG } from '../characters/EnemyPlayer.js';

// Multiplayer battles: Team Battle (two teams of 5, each team one character model),
// Free For All (10 fighters, everyone picks their own character) and Guns & Bombs (free
// for all with guns and bombs only — unlimited bullets and bombs, one shield each).
// Opened from the Multiplayer lobby (duelMode suspends its lobby while this runs).
//
// Party setup: whoever opens a mode is the host of a party. They invite online players
// (invite → join), everyone picks a side (Team Battle) or a character (Free For All), and
// the host presses Start. A solo host sits in the Firebase room `mm-<mode>` — that room
// is the matchmaking queue: on Start the host "pulls" queued players of the same mode
// into the battle (pull → pullOk), fills the rest up to MATCH_SIZE with bots and sends
// everyone `start` with the full roster. Parties with guests sit in `party-<hostId>`
// (not pullable); a battle runs in its own private room `match-<matchId>`.
//
// Battle: everyone spawns around DUEL_LOCATION (Guns & Bombs: scattered wider around
// GUNS_LOCATION) (teams in two lines facing each other,
// free-for-all in a ring), counts down "3 2 1 FIGHT!", then players move
// themselves (bots walk toward the closest enemy) and fight with swords only, MATCH_HEALTH health each. The host simulates the
// bots (EnemyPlayer AI) and decides the winner: the last team / fighter standing.
// Guns & Bombs: no swords. Whoever fires a bullet / throws a bomb detects its hits (the
// host for its bots) and sends `hit` / `botHit` with the damage; the victim's shield (held
// up and facing the shot) takes it instead. Bots keep their distance and shoot / lob bombs.
// Game access goes through `ctx` (built in bootstrapGameApp.js).
//
// Wire protocol: PeerJS messages of type 'match', each with a `key` (party key or matchId):
//   party:  invite {mode, name} · inviteCancel · decline · join {name, pick} · pick {pick}
//           party {mode, roster, teamChars} (host → guests) · leave
//   queue:  pull {mode, name} · pullOk {name, pick} · pullNo · pullCancel
//   battle: start {matchId, partyKey, mode, roster, teamChars}
//           state {sword, hand, blocking, pos, ry, hp, w} (~20 Hz, every human → every
//           human; w = 'gun' | 'shield' | null in Guns & Bombs)
//           bots {list} (~15 Hz, host → humans) · hit {dmg, dir, kind, src} (attacker →
//           victim; the host sends bot hits) · blocked · botHit {bot, dir, dmg, kind, src} /
//           botBlocked {bot} (human → host) · dead (the sender died)
//           · end {winnerTeam, winnerId, winnerName} (host) · leave (the sender left; the
//           host leaving ends the battle)
//           Guns & Bombs: shot {bot, o, d} (host: a bot fired; humans' bullets go out as
//           'projectile' messages) · bomb {bot?, o, t} (a bomb was thrown from o to t)

export const MATCH_MODES = { team: 'Team Battle', ffa: 'Free For All', guns: 'Guns & Bombs' };
// Every mode but Team Battle is everyone for themselves
const isFreeForAll = (mode) => mode !== 'team';
export const MATCH_CHARACTERS = {
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

const MATCH_SIZE = 10;                 // fighters per battle (humans + bots)
const TEAM_SIZE = MATCH_SIZE / 2;
const INVITE_TIMEOUT_MS = 30000;
const PULL_WAIT_MS = 2500;             // how long Start waits for queued players to answer
const PULLED_TIMEOUT_MS = 8000;        // pulled player gives up waiting for `start`
const STATE_SEND_MS = 50;
const BOT_SEND_MS = 66;
const HUMAN_TIMEOUT_MS = 10000;        // no messages this long → that player left
const COUNTDOWN_STEP_MS = 1000;
const END_BANNER_MS = 4000;
const TEAM_GAP = 10;                   // metres between the two team lines at "3"
const LINE_SPACING = 1.6;              // metres between teammates in a line
const FFA_RADIUS = 5;                  // free-for-all spawn ring
const BOT_RETARGET_MS = 400;
const BOT_ATTACKERS_PER_TARGET = 2;    // the rest of the bots on one target circle and wait
const BODY_CENTER_Y = 0.8;
const KEY_RE = /^[A-Za-z0-9_-]{1,100}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
// Guns & Bombs
const GUN_DAMAGE = 1;
const BOMB_DAMAGE = 2;
const SHIELD_ARC_DOT = 0.2;            // shot / blast from in front of the shield (cos of ~78°)
const BOT_SHIELD_HP = 4;               // a bot's one shield (the player's: GUNS_MATCH_SHIELD_HEALTH)
// Bots hold the gun or the shield, never both: shield up this long now and then (no
// shooting meanwhile), gun the rest of the time
const BOT_SHIELD_UP_MS = [1200, 2600];
const BOT_GUN_MS = [2500, 6000];
const BOT_SHIELD_CHANCE = 0.45;        // chance a gun spell ends with the shield going up
const BOT_RANGE = { min: 4.5, max: 9 }; // bots keep this far (m) from their target
const BOT_SHOT_RANGE = 16;
const BOT_SHOT_MS = [900, 1900];       // random gap between a bot's shots
const BOT_SHOT_SPREAD = 0.07;          // radians of aim error
const BOT_BOMB_RANGE = [3.5, 13];
const BOT_BOMB_MS = [5000, 9000];
const BOT_MUZZLE = new THREE.Vector3(0, 1.0, 0.75);   // model space
const randIn = ([a, b]) => a + Math.random() * (b - a);
// Where Guns & Bombs battles happen; fighters are scattered around it (each in its own
// slice of the ring, GUNS_SPAWN_RADIUS from the centre) — wider than the sword modes
export const GUNS_LOCATION = { x: -62.87, y: 2.98, z: 64.22, yaw: 0.05 };
const GUNS_SPAWN_RADIUS = [9, 20];
// Same "random" numbers on every client (seeded by the match id + the fighter's slot)
const seededRandom = (seedText) => {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};

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
const teamLabel = (charKey) => {
  const c = MATCH_CHARACTERS[charKey] || MATCH_CHARACTERS.antler;
  return `${c.emoji} ${c.team}`;
};

const _bladeOffsets = [
  new THREE.Vector3(0, 0, -0.1),
  new THREE.Vector3(0, 0, 0.3),
  new THREE.Vector3(0, 0, 0.65)
];
const _tmpV = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _tmpV3 = new THREE.Vector3();


export function createMatchMode(ctx) {
  // 'off' | 'setup' (party host) | 'starting' (host waiting on pulled players) | 'guest'
  // | 'pulled' (waiting for a host's `start`) | 'countdown' | 'fighting' | 'over'
  let phase = 'off';
  // Host: { key, mode, hostId, isHost: true, members: Map(id → {name, status, pick, timer}),
  //         myPick, teamChars }
  // Guest: { key, mode, hostId, hostName, isHost: false, roster, teamChars, myPick }
  let party = null;
  let starting = null;      // { matchId, asked: Set, replied: Set, accepted: [], openSlots, timer }
  let pulled = null;        // { matchId, hostId, hostName, timer }
  let pendingInvite = null; // { key, from, name, mode, timer }
  let match = null;
  let countdownTimers = [];

  const myId = () => ctx.getMultiplayer()?.getId?.() || null;
  const send = (peerId, payload) => ctx.getMultiplayer()?.sendTo?.(peerId, { type: 'match', ...payload });
  const joinRoom = (roomId) => { void ctx.getMultiplayer()?.joinRoom?.(roomId); };

  // ── DOM ──────────────────────────────────────────────────────────────────
  const setup = el('div', 'duel-lobby match-setup hidden');
  const setupPanel = el('div', 'duel-lobby-panel');
  const setupTitle = el('div', 'duel-lobby-title');
  const setupStatus = el('div', 'duel-lobby-status');
  const picks = el('div', 'match-picks');
  const membersTitle = el('div', 'match-section-title', 'Your party');
  const membersList = el('ul', 'duel-lobby-list match-members');
  const inviteTitle = el('div', 'match-section-title', 'Invite online players');
  const inviteList = el('ul', 'duel-lobby-list');
  const setupActions = el('div', 'duel-lobby-actions');
  const startBtn = el('button', 'arcade-button', '▶ Start Battle');
  const setupBackBtn = el('button', 'arcade-button arcade-secondary', '⬅ Back');
  setupActions.append(startBtn, setupBackBtn);
  setupPanel.append(setupTitle, setupStatus, picks, membersTitle, membersList, inviteTitle, inviteList, setupActions);
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

  const hud = el('div', 'duel-hud hidden');
  const hudText = el('div', 'duel-hud-vs');
  const leaveBtn = el('button', 'duel-forfeit-btn', 'Leave');
  hud.append(hudText, leaveBtn);

  const labelLayer = el('div', 'match-labels');

  document.body.append(setup, invitePrompt, banner, hud, labelLayer);

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

  // Free For All / Guns & Bombs fighter chooser: one card, swipe (or ‹ › / arrow keys)
  // through the roster — same as the Showdown character chooser; characters not yet
  // unlocked in Showdown are locked. Built once so the
  // slide-in animation and keyboard focus survive renderPicks rebuilding the panel.
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
    return Object.entries(peers)
      .filter(([id, peer]) => id !== selfId && peer?.roomId === `mm-${party.mode}`).length;
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
      setupStatus.textContent = `${queued} other player${queued === 1 ? '' : 's'} matchmaking ${label}. `
        + `Start fills open spots with them, then bots (${MATCH_SIZE} fighters).`;
    }
    startBtn.classList.toggle('hidden', !party.isHost);
    startBtn.disabled = phase !== 'setup';
    setupBackBtn.textContent = party.isHost ? '⬅ Back' : '⬅ Leave party';
    setupBackBtn.disabled = phase === 'starting' || phase === 'pulled';
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
    joinRoom(joinedCount() > 0 ? `party-${party.hostId}` : `mm-${party.mode}`);
  };

  const broadcastParty = () => {
    if (!party?.isHost) return;
    const roster = partyRoster();
    party.members.forEach((m, id) => {
      if (m.status === 'joined') {
        send(id, { op: 'party', key: party.key, mode: party.mode, roster, teamChars: party.teamChars });
      }
    });
  };

  const openSetup = (mode) => {
    const selfId = myId();
    if (phase !== 'off' || !MATCH_MODES[mode] || !selfId) return;
    if (!ctx.suspendLobby()) return;
    party = {
      key: `${selfId}-${Date.now().toString(36)}`,
      mode,
      hostId: selfId,
      hostName: ctx.getPlayerName(),
      isHost: true,
      members: new Map(),
      myPick: { side: 0, char: 'frog' },
      teamChars: ['antler', 'frog']
    };
    phase = 'setup';
    joinRoom(`mm-${mode}`);
    showSetup();
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
    send(peerId, { op: 'invite', key, mode: party.mode, name: ctx.getPlayerName() });
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
    const queued = Object.entries(peers)
      .filter(([id, peer]) => id !== selfId && peer?.roomId === `mm-${party.mode}` && !party.members.has(id))
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
      send(id, { op: 'pull', key: matchId, mode: party.mode, name: ctx.getPlayerName() });
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
      op: 'start', key: matchId, matchId, partyKey: party.key, mode: party.mode,
      roster, teamChars: party.teamChars
    };
    humans.forEach((h) => { if (h.id !== party.hostId) send(h.id, payload); });
    beginMatch({ matchId, mode: party.mode, hostId: party.hostId, roster, teamChars: party.teamChars });
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
    const { key, from, name, mode } = pendingInvite;
    hideInvitePrompt();
    if (phase === 'setup' && party?.isHost && joinedCount() === 0) {
      cancelInvites();
      party = null;
    } else if (phase !== 'off' || !ctx.suspendLobby()) {
      send(from, { op: 'decline', key, reason: 'busy' });
      return;
    }
    party = {
      key, mode, hostId: from, hostName: name, isHost: false,
      roster: [], teamChars: ['antler', 'frog'], myPick: { side: 0, char: 'frog' }
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
  const spawnPose = (entry, mode, matchId) => {
    if (mode === 'guns') {
      const loc = GUNS_LOCATION;
      const rand = seededRandom(`${matchId}:${entry.slot}`);
      const slice = (Math.PI * 2) / MATCH_SIZE;
      const angle = loc.yaw + (entry.slot + 0.25 + rand() * 0.5) * slice;
      // Neighbours alternate between the inner and outer half of the ring (never side by side)
      const [rMin, rMax] = GUNS_SPAWN_RADIUS;
      const half = (rMax - rMin) / 2;
      const radius = rMin + (entry.slot % 2) * half + rand() * half;
      const x = loc.x + Math.sin(angle) * radius;
      const z = loc.z + Math.cos(angle) * radius;
      return { x, z, yaw: Math.atan2(loc.x - x, loc.z - z) };
    }
    const loc = DUEL_LOCATION;
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
    return { x, z, yaw: Math.atan2(loc.x - x, loc.z - z) };
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

  function beginMatch({ matchId, mode, hostId, roster, teamChars }) {
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
    const guns = mode === 'guns';
    const now = Date.now();
    match = {
      matchId, mode, hostId, isHost,
      teamChars: Array.isArray(teamChars) ? teamChars.map((c) => (CHAR_KEYS.includes(c) ? c : 'antler')) : ['antler', 'frog'],
      combatants: new Map(),
      lastStateSentAt: 0,
      lastBotSentAt: 0,
      endTimer: null,
      myTeam: -1
    };
    for (const r of clean) {
      const c = {
        ...r,
        isSelf: r.id === selfId,
        alive: true,
        hp: ctx.matchHealth,
        lastHeardAt: now,
        enemy: null,
        sword: null,
        swordTarget: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), has: false },
        hand: new THREE.Vector3(0, 0.82, 0.5),
        blocking: false,
        label: null,
        targetId: null,
        retargetAt: 0,
        combat: null,
        // Guns & Bombs
        weapon: guns ? 'gun' : null,     // what they hold: 'gun' | 'shield' | null
        weaponUntil: 0,                  // host bots: when to reconsider gun / shield
        shieldHp: guns && r.bot ? BOT_SHIELD_HP : 0,
        gunMesh: null,
        shieldMesh: null,
        shotTarget: null,
        nextShotAt: Infinity,
        nextBombAt: Infinity
      };
      const pose = spawnPose(r, mode, matchId);
      const url = MATCH_CHARACTERS[r.char].url;
      if (c.isSelf) {
        match.myTeam = r.team;
        ctx.enterMatch({ ...pose, characterUrl: url, loadout: guns ? 'guns' : null });
      } else if (r.bot && isHost) {
        c.enemy = ctx.createBot({ x: pose.x, z: pose.z, yaw: pose.yaw, characterUrl: url, ranged: guns ? BOT_RANGE : null });
        if (c.enemy) c.enemy.stationary = true;
      } else {
        ctx.ensureRemoteModel(r.id, r.name, url, pose);
        if (!guns) {
          c.sword = ctx.createSwordMesh(url);
          if (c.sword) {
            c.sword.visible = false;
            ctx.scene.add(c.sword);
          }
        }
      }
      if (guns && !c.isSelf) attachGunGear(c);
      if (!c.isSelf) {
        c.label = el('div', `match-label match-label-team-${r.team}`);
        labelLayer.append(c.label);
      }
      match.combatants.set(r.id, c);
    }

    phase = 'countdown';
    document.body.classList.add('match-active');
    hud.classList.remove('hidden');
    leaveBtn.classList.remove('hidden');
    renderHud();
    const intro = mode === 'team'
      ? `You fight for the ${teamLabel(match.teamChars[match.myTeam] ?? 'antler')}`
      : mode === 'guns' ? 'Guns & bombs only · last one standing wins' : 'Last one standing wins';
    ['3', '2', '1'].forEach((text, i) => {
      countdownTimers.push(setTimeout(() => {
        if (phase === 'countdown') showBanner(text, `${MATCH_MODES[mode]} · ${intro}`);
      }, i * COUNTDOWN_STEP_MS));
    });
    countdownTimers.push(setTimeout(() => {
      if (phase !== 'countdown') return;
      phase = 'fighting';
      showBanner('FIGHT!');
      ctx.setControlsLocked(false);
      const fightAt = Date.now();
      match.combatants.forEach((c) => {
        if (!c.enemy) return;
        c.enemy.stationary = false;
        c.nextShotAt = fightAt + randIn([600, 2200]);
        c.nextBombAt = fightAt + randIn(BOT_BOMB_MS);
        c.weaponUntil = fightAt + randIn(BOT_GUN_MS);
      });
      countdownTimers.push(setTimeout(() => {
        if (phase === 'fighting') hideBanner();
      }, 800));
    }, 3 * COUNTDOWN_STEP_MS));
  }

  const humansExceptMe = () => {
    if (!match) return [];
    const out = [];
    match.combatants.forEach((c) => { if (!c.bot && !c.isSelf) out.push(c.id); });
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

  const renderHud = () => {
    if (!match) return;
    const all = [...match.combatants.values()];
    if (match.mode === 'team') {
      const alive = [0, 1].map((t) => all.filter((c) => c.team === t && c.alive).length);
      hudText.textContent = `${teamLabel(match.teamChars[0])} ${alive[0]}  vs  ${alive[1]} ${teamLabel(match.teamChars[1])}`;
    } else {
      const alive = all.filter((c) => c.alive).length;
      hudText.textContent = `${MATCH_MODES[match.mode]} · ${alive} left`;
    }
  };

  const renderLabel = (c) => {
    if (!c.label) return;
    c.label.textContent = c.alive ? `${c.name} ❤${Math.max(0, c.hp)}` : `💀 ${c.name}`;
    c.label.classList.toggle('match-label-dead', !c.alive);
  };

  // Someone is out (died, left or timed out)
  const markDead = (id) => {
    const c = match?.combatants.get(id);
    if (!c || !c.alive) return;
    c.alive = false;
    c.hp = 0;
    if (!c.isSelf && !c.enemy) {
      ctx.getRemoteModel(id)?.userData?.qwopRig?.glbCharacter?.playDeath?.();
      if (c.sword) c.sword.visible = false;
    }
    renderLabel(c);
    renderHud();
    if (match.isHost) checkWinner();
  };

  const applyBotDamage = (c, dir, dmg = 1) => {
    if (!c?.alive || !c.enemy || phase !== 'fighting') return;
    const killed = c.enemy.applyDamage(dmg);
    c.hp = c.enemy.hearts;
    renderLabel(c);
    _tmpV.set(dir?.x ?? 0, 0, dir?.z ?? 1);
    if (_tmpV.lengthSq() < 1e-6) _tmpV.set(0, 0, 1);
    _tmpV.normalize();
    c.enemy.applyDirectKnockback(killed
      ? { direction: _tmpV, horizSpeed: 10, upVelocity: 1, torqueMag: 60, ragdoll: true }
      : { direction: _tmpV, horizSpeed: 3, upVelocity: 0.2, torqueMag: 0, ragdoll: false });
    if (killed) markDead(c.id);
  };

  function checkWinner() {
    if (!match?.isHost || phase !== 'fighting') return;
    const alive = [...match.combatants.values()].filter((c) => c.alive);
    let result = null;
    if (match.mode === 'team') {
      const teams = new Set(alive.map((c) => c.team));
      if (teams.size <= 1) result = { winnerTeam: teams.size ? [...teams][0] : null };
    } else if (alive.length <= 1) {
      result = { winnerId: alive[0]?.id ?? null, winnerName: alive[0]?.name ?? null };
    }
    if (!result) return;
    broadcast({ op: 'end', ...result });
    showEnd(result);
  }

  function showEnd({ winnerTeam = null, winnerId = null, winnerName = null, reason = '' } = {}) {
    if (!match || phase === 'over') return;
    clearCountdown();
    phase = 'over';
    ctx.stopWalk();
    ctx.setControlsLocked(true);
    leaveBtn.classList.add('hidden');
    renderHud();
    if (reason) {
      showBanner('BATTLE OVER', reason);
    } else if (match.mode === 'team') {
      if (winnerTeam === 0 || winnerTeam === 1) {
        showBanner(`WINNER ${teamLabel(match.teamChars[winnerTeam])}`,
          winnerTeam === match.myTeam ? 'Your team wins!' : 'Your team lost');
      } else {
        showBanner('DRAW', 'Nobody is left standing');
      }
    } else if (winnerId) {
      const name = match.combatants.get(winnerId)?.name || cleanName(winnerName);
      showBanner(`WINNER ${name}`, winnerId === myId() ? 'You are the last one standing!' : '');
    } else {
      showBanner('DRAW', 'Nobody is left standing');
    }
    const finished = match;
    match.endTimer = setTimeout(() => {
      if (match !== finished) return;
      cleanupMatch();
      phase = 'off';
      joinRoom(LOBBY_ROOM_ID);
      ctx.resumeLobby();
    }, END_BANNER_MS);
  }

  function cleanupMatch() {
    clearCountdown();
    if (!match) return;
    clearTimeout(match.endTimer);
    match.combatants.forEach((c) => {
      if (c.enemy) c.enemy.destroy();
      if (c.sword) c.sword.parent?.remove(c.sword);
      if (!c.isSelf && !c.enemy) ctx.removeRemotePlayer(c.id);
      c.label?.remove();
    });
    match = null;
    hideBanner();
    hud.classList.add('hidden');
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

  // ── Guns & Bombs: gear, bullets, bombs ───────────────────────────────────
  // The gun and the one shield on another fighter, held like the local player holds them:
  // same models, on the same floating hand with the same hold offset / rotation, and both
  // hands on the grip (ctx.getWeaponGear — taken from the player's own Pistol / Shield)
  function attachGunGear(c) {
    const model = combatantModel(c);
    const gear = ctx.getWeaponGear?.();
    if (!model || !gear) return;
    // The weapon hand: the floating hand the player's Weapon attaches to (labels mirrored)
    const hand = c.enemy
      ? c.enemy._leftHandGroup
      : model.children.find((child) => child.userData?.proceduralHand === 'left');
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
    const alive = c.alive && phase !== 'off';
    const shieldUp = c.weapon === 'shield';
    if (c.gunMesh) c.gunMesh.visible = alive && c.weapon === 'gun';
    if (c.shieldMesh) c.shieldMesh.visible = alive && shieldUp;
    const grip = shieldUp ? c.gripShield : c.gripGun;
    if (c.enemy) {
      c.enemy.gripTarget = alive && grip ? grip : null;
    } else {
      const model = ctx.getRemoteModel(c.id);
      if (model && grip) model.userData.remoteHandTarget = grip;
    }
  };

  const posOf = (c) => combatantModel(c)?.position ?? null;
  // The shooter / thrower's game deals the damage: ours, or the host's for its bots
  const ownsAttacker = (a) => !!a && (a.isSelf || (a.bot && !!a.enemy));

  // A host bot's shield faces the shot / blast (humans check their own, in ctx.applyHit)
  const botShieldBlocks = (c, src) => {
    if (!c.enemy || c.weapon !== 'shield' || c.shieldHp <= 0 || !src) return false;
    const g = c.enemy.group;
    _tmpV.set(src.x - g.position.x, 0, src.z - g.position.z);
    if (_tmpV.lengthSq() < 1e-6) return true;
    _tmpV.normalize();
    _tmpV2.set(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
    return _tmpV2.dot(_tmpV) > SHIELD_ARC_DOT;
  };

  const damageBot = (c, dmg, dir, src) => {
    if (botShieldBlocks(c, src)) {
      c.shieldHp = Math.max(0, c.shieldHp - dmg);
      if (c.shieldHp <= 0) {
        // Broken: back to the gun for good
        c.weapon = 'gun';
        c.weaponUntil = Infinity;
      }
      ctx.onShieldHit?.(posOf(c));
      return;
    }
    applyBotDamage(c, dir, dmg);
  };

  // `attackerId`'s bullet / bomb reached `target`; only the attacker's game acts on it
  const rangedHit = (attackerId, target, dmg, dir, kind, src) => {
    if (!match || phase !== 'fighting' || !target?.alive) return;
    const attacker = match.combatants.get(attackerId);
    if (!ownsAttacker(attacker) || !isEnemyOf(attacker, target)) return;
    const len = Math.hypot(dir?.x ?? 0, dir?.z ?? 0);
    const d = len > 1e-4 ? [round3(dir.x / len), round3(dir.z / len)] : [0, 1];
    const s = src ? [round3(src.x), round3(src.z)] : null;
    if (target.isSelf) {
      ctx.applyHit(dmg, d, { kind, src: s });
    } else if (target.enemy) {
      damageBot(target, dmg, { x: d[0], z: d[1] }, src);
    } else if (target.bot) {
      send(match.hostId, { op: 'botHit', key: match.matchId, bot: target.id, dir: d, dmg, kind, src: s });
    } else {
      send(target.id, { op: 'hit', key: match.matchId, dmg, dir: d, kind, src: s });
      const model = posOf(target) && combatantModel(target);
      if (model) ctx.spawnBlood(_tmpV.copy(model.position).setY(model.position.y + BODY_CENTER_Y), model.position.y);
    }
  };

  // Everyone a bullet can stop at (projectiles.js); null outside Guns & Bombs
  const getShotTargets = () => {
    if (!match || match.mode !== 'guns') return null;
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

  // The local player threw a bomb (bootstrap's bomb release); false outside Guns & Bombs
  const throwLocalBomb = (origin, target) => {
    if (!match || match.mode !== 'guns' || phase !== 'fighting') return false;
    broadcast({ op: 'bomb', o: origin.toArray().map(round3), t: target.toArray().map(round3) });
    launchBomb(myId(), origin, target, false);
    return true;
  };

  // Host: a gun bot shoots / lobs a bomb at its target now and then
  const botMuzzle = new THREE.Vector3();
  const updateGunBot = (bot, targetModel, now) => {
    const g = bot.enemy.group;
    const dist = g.position.distanceTo(targetModel.position);
    // Gun or shield (never both)
    if (now >= bot.weaponUntil) {
      if (bot.weapon === 'gun' && bot.shieldHp > 0 && Math.random() < BOT_SHIELD_CHANCE) {
        bot.weapon = 'shield';
        bot.weaponUntil = now + randIn(BOT_SHIELD_UP_MS);
      } else {
        if (bot.weapon === 'shield') bot.nextShotAt = Math.max(bot.nextShotAt, now + 400);
        bot.weapon = 'gun';
        bot.weaponUntil = now + randIn(BOT_GUN_MS);
      }
    }
    if (bot.weapon !== 'gun') return;
    if (now >= bot.nextShotAt) {
      bot.nextShotAt = now + randIn(BOT_SHOT_MS);
      if (dist <= BOT_SHOT_RANGE) {
        g.updateMatrixWorld();
        botMuzzle.copy(BOT_MUZZLE);
        g.localToWorld(botMuzzle);
        const dir = _tmpV.copy(targetModel.position).setY(targetModel.position.y + BODY_CENTER_Y).sub(botMuzzle);
        if (dir.lengthSq() > 1e-4) {
          dir.normalize().applyAxisAngle(_yAxis, (Math.random() * 2 - 1) * BOT_SHOT_SPREAD);
          dir.y += (Math.random() * 2 - 1) * BOT_SHOT_SPREAD * 0.5;
          dir.normalize();
          ctx.spawnShot(botMuzzle, dir, bot.id);
          broadcast({ op: 'shot', bot: bot.id, o: botMuzzle.toArray().map(round3), d: dir.toArray().map(round3) });
        }
      }
    }
    if (now >= bot.nextBombAt) {
      bot.nextBombAt = now + randIn(BOT_BOMB_MS);
      if (dist >= BOT_BOMB_RANGE[0] && dist <= BOT_BOMB_RANGE[1]) {
        const origin = new THREE.Vector3(0, 1.6, 0.3);
        g.updateMatrixWorld();
        g.localToWorld(origin);
        const target = targetModel.position.clone();
        launchBomb(bot.id, origin, target, true);
        broadcast({ op: 'bomb', bot: bot.id, o: origin.toArray().map(round3), t: target.toArray().map(round3) });
      }
    }
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
      if (t.enemy.blocksSwing(swingDir, botPos)) return 'blocked';
      applyBotDamage(t, toTarget.clone().normalize());
      return 'hit';
    }
    if (t.blocking && t.sword?.visible) {
      _tmpV.set(0, 0, 1).applyQuaternion(t.sword.quaternion);
      if (swingCrossesBlade(swingDir, _tmpV, toTarget, PLAYER_BLOCK_MIN_ANGLE_DEG)) {
        send(t.id, { op: 'blocked', key: match.matchId });
        return 'blocked';
      }
    }
    const len = Math.hypot(toTarget.x, toTarget.z) || 1;
    send(t.id, { op: 'hit', key: match.matchId, dmg: 1, dir: [toTarget.x / len, toTarget.z / len] });
    ctx.spawnBlood(_tmpV.copy(model.position).setY(model.position.y + BODY_CENTER_Y), model.position.y);
    return 'hit';
  };

  const updateBots = (dt, now) => {
    const fighting = phase === 'fighting';
    const all = [...match.combatants.values()];
    const bots = all.filter((c) => c.enemy);
    // Targets: closest living enemy (re-picked a few times a second)
    for (const bot of bots) {
      if (!bot.alive) continue;
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
      if (!bot.alive || !bot.targetId) continue;
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
      if (!bot.enemy.rigidBody) continue; // faded out and destroyed
      if (!bot.alive) {
        bot.enemy.update(dt, null, null, false, false);
        continue;
      }
      const target = match.combatants.get(bot.targetId);
      const targetModel = target?.alive ? combatantModel(target) : null;
      const targetIsMe = !!target?.isSelf;
      bot.enemy.targetHitHandler = targetIsMe ? null : (m, swingDir) => resolveBotHit(bot, bot.targetId, swingDir);
      bot.enemy._onHitPlayer = targetIsMe ? (dir) => ctx.knockbackLocal(dir) : null;
      bot.enemy.update(dt, targetModel, targetIsMe ? ctx.getPlayerControls() : null, false,
        fighting && allowed.has(bot));
      if (match.mode === 'guns' && fighting && targetModel) updateGunBot(bot, targetModel, now);
    }
  };

  const botLocalSword = new THREE.Vector3();
  const botLocalQ = new THREE.Quaternion();
  const sendBots = () => {
    const list = [];
    match.combatants.forEach((c) => {
      if (!c.enemy) return;
      const g = c.enemy.group;
      const entry = {
        id: c.id,
        p: [round3(g.position.x), round3(g.position.y), round3(g.position.z)],
        r: round3(g.rotation.y),
        hp: c.hp,
        d: !c.alive,
        b: c.enemy.isBlocking()
      };
      if (match.mode === 'guns') {
        entry.sh = c.shieldHp;
        entry.w = c.weapon;
      }
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

  const updateRemoteCombatant = (c) => {
    const model = ctx.getRemoteModel(c.id);
    if (model) model.userData.remoteHandTarget = c.hand;
    if (!c.sword) return;
    c.sword.visible = !!(model && c.alive && c.swordTarget.has);
    if (c.sword.visible) {
      c.sword.position.copy(c.swordTarget.pos);
      model.updateMatrixWorld();
      model.localToWorld(c.sword.position);
      c.sword.quaternion.copy(model.quaternion).multiply(c.swordTarget.quat);
    }
  };

  const updateLabels = () => {
    const camera = ctx.camera;
    if (!camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    match.combatants.forEach((c) => {
      if (!c.label) return;
      const model = combatantModel(c);
      if (!model || (!c.alive && c.enemy && !c.enemy.group.parent)) {
        c.label.style.display = 'none';
        return;
      }
      _tmpV.copy(model.position);
      _tmpV.y += 1.45;
      _tmpV.project(camera);
      if (_tmpV.z < 0 || _tmpV.z > 1) {
        c.label.style.display = 'none';
        return;
      }
      c.label.style.display = 'block';
      c.label.style.left = `${(_tmpV.x * 0.5 + 0.5) * w}px`;
      c.label.style.top = `${(-_tmpV.y * 0.5 + 0.5) * h}px`;
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
        if (c.bot || c.isSelf) continue;
        const gone = (hasPeers && !peers[c.id]) || now - c.lastHeardAt > HUMAN_TIMEOUT_MS;
        if (!gone) continue;
        if (c.id === match.hostId) {
          showEnd({ reason: `${c.name} (the host) left` });
          return;
        }
        c.lastHeardAt = Infinity; // handled once
        markDead(c.id);
      }
    }

    if (me && phase !== 'over' && now - match.lastStateSentAt >= STATE_SEND_MS) {
      match.lastStateSentAt = now;
      const state = ctx.getLocalSwordState() || {};
      const model = ctx.getLocalPlayerModel();
      me.hp = Math.max(0, ctx.getLocalHealth());
      broadcast({
        op: 'state',
        sword: state.sword ?? null,
        hand: state.hand ?? null,
        blocking: !!state.blocking,
        pos: model ? [round3(model.position.x), round3(model.position.y), round3(model.position.z)] : null,
        ry: model ? round3(model.rotation.y) : null,
        hp: me.hp,
        w: match.mode === 'guns' ? ctx.getLocalWeapon?.() ?? null : undefined
      });
    }

    if (match.isHost) {
      updateBots(dt, now);
      if (match && now - match.lastBotSentAt >= BOT_SEND_MS) {
        match.lastBotSentAt = now;
        sendBots();
      }
    }
    if (!match) return;
    match.combatants.forEach((c) => {
      if (!c.isSelf && !c.enemy) updateRemoteCombatant(c);
      if (match.mode === 'guns' && !c.isSelf) updateGunGear(c);
      if (c.enemy && c.alive) c.hp = c.enemy.hearts;
      renderLabel(c);
    });
    updateLabels();
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
            if (c.enemy) applyBotDamage(c, dir);
            else if (c.bot) send(match.hostId, { op: 'botHit', key: match.matchId, bot: c.id, dir: [dir.x, dir.z] });
            else send(c.id, { op: 'hit', key: match.matchId, dmg: 1, dir: [dir.x, dir.z] });
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
      const model = combatantModel(c);
      if (!model) return;
      combat.position.copy(model.position);
      combat.center.copy(model.position);
      combat.center.y += BODY_CENTER_Y;
      const sword = c.enemy ? c.enemy._swordGroup : c.sword;
      combat.hasBlade = !!sword?.visible;
      if (combat.hasBlade) {
        _bladeOffsets.forEach((offset, i) => {
          combat.bladePoints[i].copy(offset).applyQuaternion(sword.quaternion).add(sword.position);
        });
        combat.bladeDir.set(0, 0, 1).applyQuaternion(sword.quaternion);
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
      switch (op) {
        case 'state': {
          applySwordState(c, data.sword, data.hand);
          c.blocking = !!data.blocking;
          if (match.mode === 'guns') c.weapon = data.w === 'gun' || data.w === 'shield' ? data.w : null;
          if (Number.isFinite(data.hp) && c.alive) c.hp = Math.max(0, Math.min(99, Math.round(data.hp)));
          if (isVec(data.pos, 3)) {
            ctx.setRemotePose(c.id, data.pos, Number.isFinite(data.ry) ? data.ry : null,
              c.name, MATCH_CHARACTERS[c.char].url);
          }
          return;
        }
        case 'bots': {
          if (peerId !== match.hostId || match.isHost || !Array.isArray(data.list)) return;
          for (const b of data.list.slice(0, MATCH_SIZE)) {
            const bot = typeof b?.id === 'string' ? match.combatants.get(b.id) : null;
            if (!bot?.bot) continue;
            if (isVec(b.p, 3)) {
              ctx.setRemotePose(bot.id, b.p, Number.isFinite(b.r) ? b.r : null,
                bot.name, MATCH_CHARACTERS[bot.char].url);
            }
            applySwordState(bot, b.s, b.h);
            bot.blocking = !!b.b;
            if (Number.isFinite(b.sh)) bot.shieldHp = Math.max(0, Math.round(b.sh));
            if (b.w === 'gun' || b.w === 'shield') bot.weapon = b.w;
            if (Number.isFinite(b.hp) && bot.alive) bot.hp = Math.max(0, Math.round(b.hp));
            if (b.d && bot.alive) markDead(bot.id);
          }
          return;
        }
        case 'hit': {
          if (phase !== 'fighting') return;
          const ranged = match.mode === 'guns' && (data.kind === 'gun' || data.kind === 'bomb');
          ctx.applyHit(
            Math.max(1, Math.min(2, Math.round(Number(data.dmg) || 1))),
            isVec(data.dir, 2) ? data.dir : null,
            ranged ? { kind: data.kind, src: isVec(data.src, 2) ? data.src : null } : undefined
          );
          return;
        }
        case 'shot': {
          if (match.mode !== 'guns' || peerId !== match.hostId || match.isHost) return;
          const bot = typeof data.bot === 'string' ? match.combatants.get(data.bot) : null;
          if (!bot?.bot || !isVec(data.o, 3) || !isVec(data.d, 3)) return;
          ctx.spawnShot(new THREE.Vector3().fromArray(data.o), new THREE.Vector3().fromArray(data.d), bot.id);
          return;
        }
        case 'bomb': {
          if (match.mode !== 'guns' || !isVec(data.o, 3) || !isVec(data.t, 3)) return;
          let throwerId = peerId;
          if (data.bot != null) {
            const bot = typeof data.bot === 'string' ? match.combatants.get(data.bot) : null;
            if (peerId !== match.hostId || !bot?.bot) return;
            throwerId = bot.id;
          }
          launchBomb(throwerId, new THREE.Vector3().fromArray(data.o), new THREE.Vector3().fromArray(data.t), true);
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
          if (match.mode === 'guns') {
            const dmg = data.kind === 'bomb' ? BOMB_DAMAGE : GUN_DAMAGE;
            const src = isVec(data.src, 2) ? { x: data.src[0], z: data.src[1] } : null;
            damageBot(bot, dmg, dir, src);
            return;
          }
          applyBotDamage(bot, dir);
          return;
        }
        case 'dead':
          markDead(peerId);
          return;
        case 'end':
          if (peerId !== match.hostId) return;
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
          markDead(peerId);
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
        pendingInvite = {
          key, from: peerId, name, mode,
          timer: setTimeout(() => {
            if (pendingInvite?.key === key) hideInvitePrompt();
          }, INVITE_TIMEOUT_MS)
        };
        inviteText.textContent = `${name} invites you to ${MATCH_MODES[mode]}!`;
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
        const self = party.roster.find((m) => m.id === myId());
        if (self) party.myPick = cleanPick(self.pick);
        renderSetup();
        return;
      }
      // ── Matchmaking queue ──
      case 'pull': {
        const ok = phase === 'setup' && party?.isHost && party.mode === data.mode && joinedCount() === 0;
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
        beginMatch({ matchId: key, mode: data.mode, hostId: peerId, roster: data.roster, teamChars: data.teamChars });
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
    throwLocalBomb,
    isGunsMatch: () => match?.mode === 'guns',
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
    // The local player died: tell everyone, keep watching until the battle ends
    onLocalDeath: () => {
      if (!match || (phase !== 'fighting' && phase !== 'countdown')) return;
      const selfId = myId();
      const me = match.combatants.get(selfId);
      if (!me?.alive) return;
      ctx.stopWalk();
      broadcast({ op: 'dead' });
      showBanner('ELIMINATED', 'Watching until the battle ends');
      markDead(selfId);
    }
  };
}
