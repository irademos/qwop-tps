import * as THREE from 'three';
import { LOBBY_ROOM_ID } from './peerConnection.js';

// Multiplayer mode: a lobby of everyone online (the `peers` list the Multiplayer class keeps
// from Firebase) where you challenge a player to a 1v1 sword duel. A duel moves both players
// into their own private room at DUEL_LOCATION, locks guns/bombs/bubbles/shields, counts
// "3 2 1 FIGHT!" and ends when one of them dies ("WINNER <name>"), then both go back to the
// lobby. Game access goes through `ctx` (built in bootstrapGameApp.js).
//
// Wire protocol: PeerJS messages of type 'duel' sent straight to the other player (sendTo):
//   challenge {challengeId, name, location} · accept {challengeId, name} · decline · cancel
//   state {sword: {p, q}, hand, blocking}  (~20 Hz, sword pose in the sender's model space)
//   hit {dmg, dir} (the attacker detects hits, the victim applies them) · blocked · dead · leave

// Where duels happen: paste the output of the lobby's "Copy location information" here.
// null → the map origin.
export const DUEL_LOCATION = null;

const DUEL_DEFAULT_LOCATION = { x: 0, z: 0, yaw: 0 };
const DUEL_START_GAP = 4;              // metres between the two players at "3"
const CHALLENGE_TIMEOUT_MS = 30000;
const STATE_SEND_MS = 50;
const OPPONENT_TIMEOUT_MS = 10000;     // no messages this long → the opponent left
const WINNER_BANNER_MS = 3500;
const COUNTDOWN_STEP_MS = 1000;
const CHALLENGE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    area.remove();
    return ok;
  }
};

export function createDuelMode(ctx) {
  // 'off' | 'lobby' | 'roam' (find location) | 'countdown' | 'fighting' | 'over'
  let phase = 'off';
  let outgoing = null;   // { challengeId, to, name, timer }
  let incoming = null;   // { challengeId, from, name, location, timer }
  let duel = null;       // { challengeId, roomId, opponentId, opponentName, lastHeardAt }
  let lastStateSentAt = 0;
  let countdownTimers = [];
  let remoteSword = null;
  const remoteSwordTarget = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), has: false };
  let remoteBlocking = false;
  const remoteHandTarget = new THREE.Vector3(0, 0.82, 0.5);

  // ── DOM ──────────────────────────────────────────────────────────────────
  const lobby = el('div', 'duel-lobby hidden');
  const lobbyPanel = el('div', 'duel-lobby-panel');
  const lobbyTitle = el('div', 'duel-lobby-title', 'Multiplayer Lobby');
  const lobbyStatus = el('div', 'duel-lobby-status');
  const lobbyList = el('ul', 'duel-lobby-list');
  const lobbyActions = el('div', 'duel-lobby-actions');
  const findLocationBtn = el('button', 'arcade-button arcade-secondary', '📍 Find Location');
  const backBtn = el('button', 'arcade-button arcade-secondary', '⬅ Back');
  lobbyActions.append(findLocationBtn, backBtn);
  const prompt = el('div', 'duel-prompt hidden');
  const promptText = el('div', 'duel-prompt-text');
  const promptActions = el('div', 'duel-lobby-actions');
  const acceptBtn = el('button', 'arcade-button', '⚔️ Accept');
  const declineBtn = el('button', 'arcade-button arcade-secondary', 'Decline');
  const cancelBtn = el('button', 'arcade-button arcade-secondary', 'Cancel');
  promptActions.append(acceptBtn, declineBtn, cancelBtn);
  prompt.append(promptText, promptActions);
  lobbyPanel.append(lobbyTitle, lobbyStatus, lobbyList, prompt, lobbyActions);
  lobby.append(lobbyPanel);

  const roamPanel = el('div', 'duel-roam hidden');
  const roamCoords = el('div', 'duel-roam-coords');
  const copyBtn = el('button', 'arcade-button', '📋 Copy location information');
  const roamBackBtn = el('button', 'arcade-button arcade-secondary', '⬅ Back to Lobby');
  roamPanel.append(roamCoords, copyBtn, roamBackBtn);

  const banner = el('div', 'duel-banner hidden');
  const bannerTitle = el('div', 'duel-banner-title');
  const bannerSub = el('div', 'duel-banner-sub');
  banner.append(bannerTitle, bannerSub);

  const hud = el('div', 'duel-hud hidden');
  const hudVs = el('div', 'duel-hud-vs');
  const forfeitBtn = el('button', 'duel-forfeit-btn', 'Forfeit');
  hud.append(hudVs, forfeitBtn);

  document.body.append(lobby, roamPanel, banner, hud);

  const showBanner = (title, sub = '') => {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
    banner.classList.remove('hidden');
    // restart the pop-in animation
    bannerTitle.style.animation = 'none';
    void bannerTitle.offsetWidth;
    bannerTitle.style.animation = '';
  };
  const hideBanner = () => banner.classList.add('hidden');

  const myId = () => ctx.getMultiplayer()?.getId?.() || null;
  const send = (peerId, payload) => ctx.getMultiplayer()?.sendTo?.(peerId, { type: 'duel', ...payload });

  // ── Lobby list ───────────────────────────────────────────────────────────
  const peerStatus = (peer) => {
    if (!peer) return 'offline';
    if (peer.roomId === LOBBY_ROOM_ID) return 'lobby';
    if (typeof peer.roomId === 'string' && peer.roomId.startsWith('duel-')) return 'dueling';
    return 'playing';
  };
  const STATUS_LABELS = { lobby: 'In lobby', dueling: 'Dueling', playing: 'Playing', offline: 'Offline' };

  const renderLobby = () => {
    if (phase !== 'lobby') return;
    const mp = ctx.getMultiplayer();
    const selfId = myId();
    lobbyStatus.textContent = selfId ? 'Tap a player to challenge them to a duel' : 'Connecting…';
    const peers = mp?.getOnlinePeers?.() || {};
    const entries = Object.entries(peers)
      .filter(([, peer]) => peer && typeof peer.name === 'string');
    if (selfId && !peers[selfId]) {
      entries.push([selfId, { name: ctx.getPlayerName(), roomId: LOBBY_ROOM_ID, timestamp: 0 }]);
    }
    entries.sort(([idA, a], [idB, b]) => {
      if (idA === selfId) return -1;
      if (idB === selfId) return 1;
      return a.name.localeCompare(b.name);
    });
    lobbyList.innerHTML = '';
    if (!selfId) {
      entries.length = 0;
      lobbyList.append(el('li', 'duel-lobby-empty', `${ctx.getPlayerName()} (you) — connecting…`));
    }
    for (const [peerId, peer] of entries) {
      const isSelf = peerId === selfId;
      const status = peerStatus(peer);
      const row = el('li', 'duel-lobby-row');
      const name = el('span', 'duel-lobby-name', isSelf ? `${peer.name} (you)` : peer.name);
      const badge = el('span', `duel-lobby-badge duel-status-${status}`, STATUS_LABELS[status]);
      row.append(name, badge);
      if (!isSelf) {
        const btn = el('button', 'duel-challenge-btn', outgoing?.to === peerId ? 'Waiting…' : '⚔️ Challenge');
        btn.disabled = status !== 'lobby' || !!outgoing || !!incoming;
        btn.addEventListener('click', () => challenge(peerId, peer.name));
        row.append(btn);
        row.classList.toggle('duel-lobby-row-available', !btn.disabled);
      } else {
        row.classList.add('duel-lobby-row-self');
      }
      lobbyList.append(row);
    }
    if (selfId && entries.length <= 1) {
      lobbyList.append(el('li', 'duel-lobby-empty', 'Nobody else is online yet'));
    }
  };

  const renderPrompt = () => {
    if (incoming) {
      promptText.textContent = `${incoming.name} challenges you to a duel!`;
      acceptBtn.classList.remove('hidden');
      declineBtn.classList.remove('hidden');
      cancelBtn.classList.add('hidden');
      prompt.classList.remove('hidden');
    } else if (outgoing) {
      promptText.textContent = `Waiting for ${outgoing.name} to accept…`;
      acceptBtn.classList.add('hidden');
      declineBtn.classList.add('hidden');
      cancelBtn.classList.remove('hidden');
      prompt.classList.remove('hidden');
    } else {
      prompt.classList.add('hidden');
    }
    renderLobby();
  };

  const flashLobbyStatus = (text) => {
    lobbyStatus.textContent = text;
    clearTimeout(flashLobbyStatus.timer);
    flashLobbyStatus.timer = setTimeout(renderLobby, 2500);
  };

  // ── Challenges ───────────────────────────────────────────────────────────
  const clearOutgoing = () => {
    if (outgoing) clearTimeout(outgoing.timer);
    outgoing = null;
  };
  const clearIncoming = () => {
    if (incoming) clearTimeout(incoming.timer);
    incoming = null;
  };

  const challenge = (peerId, name) => {
    const selfId = myId();
    if (phase !== 'lobby' || !selfId || outgoing || incoming) return;
    const challengeId = `${selfId}-${Date.now().toString(36)}`;
    const location = DUEL_LOCATION || DUEL_DEFAULT_LOCATION;
    outgoing = {
      challengeId,
      to: peerId,
      name,
      location,
      timer: setTimeout(() => {
        if (outgoing?.challengeId !== challengeId) return;
        send(peerId, { op: 'cancel', challengeId });
        clearOutgoing();
        renderPrompt();
        flashLobbyStatus(`${name} didn't answer`);
      }, CHALLENGE_TIMEOUT_MS)
    };
    send(peerId, { op: 'challenge', challengeId, name: ctx.getPlayerName(), location });
    renderPrompt();
  };

  acceptBtn.addEventListener('click', () => {
    if (!incoming) return;
    const { challengeId, from, name, location } = incoming;
    clearIncoming();
    renderPrompt();
    send(from, { op: 'accept', challengeId, name: ctx.getPlayerName() });
    startDuel({ challengeId, opponentId: from, opponentName: name, location, side: 1 });
  });
  declineBtn.addEventListener('click', () => {
    if (!incoming) return;
    send(incoming.from, { op: 'decline', challengeId: incoming.challengeId });
    clearIncoming();
    renderPrompt();
  });
  cancelBtn.addEventListener('click', () => {
    if (!outgoing) return;
    send(outgoing.to, { op: 'cancel', challengeId: outgoing.challengeId });
    clearOutgoing();
    renderPrompt();
  });

  // ── Remote sword ─────────────────────────────────────────────────────────
  const ensureRemoteSword = () => {
    if (remoteSword) return remoteSword;
    remoteSword = ctx.createSwordMesh();
    if (remoteSword) {
      remoteSword.visible = false;
      ctx.scene.add(remoteSword);
    }
    return remoteSword;
  };
  const disposeRemoteSword = () => {
    if (!remoteSword) return;
    remoteSword.parent?.remove(remoteSword);
    remoteSword = null;
    remoteSwordTarget.has = false;
    remoteBlocking = false;
  };

  // ── Duel lifecycle ───────────────────────────────────────────────────────
  const clearCountdown = () => {
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [];
  };

  const startDuel = ({ challengeId, opponentId, opponentName, location, side }) => {
    const roomId = `duel-${challengeId}`;
    duel = { challengeId, roomId, opponentId, opponentName, lastHeardAt: Date.now() };
    phase = 'countdown';
    lobby.classList.add('hidden');
    hideBanner();
    void ctx.getMultiplayer()?.joinRoom?.(roomId);

    // Face each other across the duel spot: challenger (side 0) behind the centre facing
    // along the location's yaw, the accepter in front facing back.
    const loc = location && Number.isFinite(location.x) && Number.isFinite(location.z)
      ? location
      : DUEL_DEFAULT_LOCATION;
    const yaw = Number.isFinite(loc.yaw) ? loc.yaw : 0;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const offset = (side === 0 ? -1 : 1) * DUEL_START_GAP / 2;
    const x = loc.x + fx * offset;
    const z = loc.z + fz * offset;
    ctx.enterDuel({ x, z, yaw: side === 0 ? yaw : yaw + Math.PI });
    hudVs.textContent = `${ctx.getPlayerName()} vs ${opponentName}`;
    forfeitBtn.classList.remove('hidden');
    hud.classList.remove('hidden');
    ensureRemoteSword();

    ['3', '2', '1'].forEach((text, i) => {
      countdownTimers.push(setTimeout(() => {
        if (phase === 'countdown') showBanner(text);
      }, i * COUNTDOWN_STEP_MS));
    });
    countdownTimers.push(setTimeout(() => {
      if (phase !== 'countdown') return;
      phase = 'fighting';
      showBanner('FIGHT!');
      ctx.setControlsLocked(false);
      countdownTimers.push(setTimeout(() => {
        if (phase === 'fighting') hideBanner();
      }, 800));
    }, 3 * COUNTDOWN_STEP_MS));
  };

  const endDuel = (winnerName, sub = '') => {
    if (!duel || phase === 'over') return;
    clearCountdown();
    phase = 'over';
    forfeitBtn.classList.add('hidden');
    ctx.setControlsLocked(true);
    showBanner(`WINNER ${winnerName}`, sub);
    const finished = duel;
    setTimeout(() => {
      if (duel !== finished) return;
      returnToLobby();
    }, WINNER_BANNER_MS);
  };

  const returnToLobby = () => {
    clearCountdown();
    const opponentId = duel?.opponentId;
    duel = null;
    hideBanner();
    hud.classList.add('hidden');
    disposeRemoteSword();
    if (opponentId) ctx.removeRemotePlayer(opponentId);
    ctx.leaveDuel();
    void ctx.getMultiplayer()?.joinRoom?.(LOBBY_ROOM_ID);
    showLobby();
  };

  const opponentName = () => duel?.opponentName || 'Opponent';

  forfeitBtn.addEventListener('click', () => {
    if (!duel || (phase !== 'countdown' && phase !== 'fighting')) return;
    send(duel.opponentId, { op: 'leave', challengeId: duel.challengeId });
    endDuel(opponentName(), `${ctx.getPlayerName()} forfeited`);
  });

  // ── Lobby / roam screens ─────────────────────────────────────────────────
  const showLobby = () => {
    phase = 'lobby';
    roamPanel.classList.add('hidden');
    lobby.classList.remove('hidden');
    ctx.setControlsLocked(true);
    renderPrompt();
  };

  findLocationBtn.addEventListener('click', () => {
    if (phase !== 'lobby') return;
    if (outgoing) {
      send(outgoing.to, { op: 'cancel', challengeId: outgoing.challengeId });
      clearOutgoing();
    }
    if (incoming) {
      send(incoming.from, { op: 'decline', challengeId: incoming.challengeId });
      clearIncoming();
    }
    phase = 'roam';
    lobby.classList.add('hidden');
    roamPanel.classList.remove('hidden');
    ctx.spawnForRoam();
    ctx.setControlsLocked(false);
  });
  roamBackBtn.addEventListener('click', () => {
    if (phase === 'roam') showLobby();
  });
  copyBtn.addEventListener('click', async () => {
    const pose = ctx.getPlayerPose();
    const text = JSON.stringify(pose);
    const ok = await copyText(text);
    copyBtn.textContent = ok ? '✅ Copied!' : '❌ Copy failed';
    if (!ok) roamCoords.textContent = text;
    setTimeout(() => { copyBtn.textContent = '📋 Copy location information'; }, 1500);
  });
  backBtn.addEventListener('click', () => {
    if (phase !== 'lobby') return;
    exit();
    ctx.onExit();
  });

  // ── Public API ───────────────────────────────────────────────────────────
  const enter = () => {
    if (phase !== 'off') return;
    document.body.classList.add('multiplayer-mode');
    ctx.startMultiplayer();
    showLobby();
  };

  const exit = () => {
    if (phase === 'off') return;
    if (outgoing) send(outgoing.to, { op: 'cancel', challengeId: outgoing.challengeId });
    if (incoming) send(incoming.from, { op: 'decline', challengeId: incoming.challengeId });
    if (duel) send(duel.opponentId, { op: 'leave', challengeId: duel.challengeId });
    clearOutgoing();
    clearIncoming();
    clearCountdown();
    const opponentId = duel?.opponentId;
    duel = null;
    phase = 'off';
    disposeRemoteSword();
    if (opponentId) ctx.removeRemotePlayer(opponentId);
    lobby.classList.add('hidden');
    roamPanel.classList.add('hidden');
    hud.classList.add('hidden');
    hideBanner();
    document.body.classList.remove('multiplayer-mode');
    ctx.setControlsLocked(false);
    // Let the goodbye messages flush before the peer is torn down
    setTimeout(() => {
      if (phase === 'off') ctx.stopMultiplayer();
    }, 300);
  };

  const handleMessage = (peerId, data) => {
    const { op, challengeId } = data || {};
    // challengeId ends up in a Firebase path (the duel room), so keep it to [A-Za-z0-9_-]
    if (typeof op !== 'string' || typeof challengeId !== 'string' || !CHALLENGE_ID_RE.test(challengeId)) return;
    const fromOpponent = duel && peerId === duel.opponentId && challengeId === duel.challengeId;
    if (fromOpponent) duel.lastHeardAt = Date.now();

    switch (op) {
      case 'challenge': {
        const name = typeof data.name === 'string' ? data.name.slice(0, 40) : 'Someone';
        if (phase !== 'lobby' || incoming || outgoing) {
          send(peerId, { op: 'decline', challengeId, reason: 'busy' });
          return;
        }
        incoming = {
          challengeId,
          from: peerId,
          name,
          location: data.location,
          timer: setTimeout(() => {
            if (incoming?.challengeId !== challengeId) return;
            clearIncoming();
            renderPrompt();
          }, CHALLENGE_TIMEOUT_MS)
        };
        renderPrompt();
        return;
      }
      case 'cancel':
        if (incoming?.challengeId === challengeId) {
          clearIncoming();
          renderPrompt();
          flashLobbyStatus('The challenge was cancelled');
        } else if (fromOpponent && phase === 'countdown') {
          // Accepted after the challenger had already given up
          returnToLobby();
          flashLobbyStatus('The challenge was cancelled');
        }
        return;
      case 'decline':
        if (outgoing?.challengeId === challengeId) {
          const name = outgoing.name;
          clearOutgoing();
          renderPrompt();
          flashLobbyStatus(data.reason === 'busy' ? `${name} is busy` : `${name} declined`);
        }
        return;
      case 'accept':
        if (outgoing?.challengeId === challengeId && outgoing.to === peerId && phase === 'lobby') {
          const { name, location } = outgoing;
          clearOutgoing();
          prompt.classList.add('hidden');
          startDuel({ challengeId, opponentId: peerId, opponentName: name, location, side: 0 });
        } else {
          send(peerId, { op: 'cancel', challengeId });
        }
        return;
      default:
        break;
    }
    if (!fromOpponent) return;
    switch (op) {
      case 'state': {
        const p = data.sword?.p;
        const q = data.sword?.q;
        if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
          && Array.isArray(q) && q.length === 4 && q.every(Number.isFinite)) {
          remoteSwordTarget.pos.fromArray(p);
          remoteSwordTarget.quat.fromArray(q).normalize();
          remoteSwordTarget.has = true;
        }
        if (Array.isArray(data.hand) && data.hand.length === 3 && data.hand.every(Number.isFinite)) {
          remoteHandTarget.fromArray(data.hand);
        }
        remoteBlocking = !!data.blocking;
        return;
      }
      case 'hit':
        if (phase !== 'fighting') return;
        ctx.applyHit(
          Math.max(1, Math.min(4, Math.round(Number(data.dmg) || 1))),
          Array.isArray(data.dir) ? data.dir : null
        );
        return;
      case 'blocked':
        ctx.onSwingBlocked();
        return;
      case 'dead':
        ctx.getRemoteModel(duel.opponentId)?.userData?.qwopRig?.glbCharacter?.playDeath?.();
        endDuel(ctx.getPlayerName());
        return;
      case 'leave':
        endDuel(ctx.getPlayerName(), `${opponentName()} left the duel`);
        return;
      default:
    }
  };

  const update = () => {
    if (phase === 'roam') {
      const pose = ctx.getPlayerPose();
      roamCoords.textContent = `x ${pose.x}  y ${pose.y}  z ${pose.z}  yaw ${pose.yaw}`;
    }
    if (!duel || (phase !== 'countdown' && phase !== 'fighting')) return;

    const now = Date.now();
    const peers = ctx.getMultiplayer()?.getOnlinePeers?.();
    const opponentGone = peers && Object.keys(peers).length > 0 && !peers[duel.opponentId];
    if (opponentGone || now - duel.lastHeardAt > OPPONENT_TIMEOUT_MS) {
      endDuel(ctx.getPlayerName(), `${opponentName()} disconnected`);
      return;
    }

    if (now - lastStateSentAt >= STATE_SEND_MS) {
      lastStateSentAt = now;
      const state = ctx.getLocalSwordState();
      if (state) send(duel.opponentId, { op: 'state', challengeId: duel.challengeId, ...state });
    }

    const model = ctx.getRemoteModel(duel.opponentId);
    if (model) model.userData.remoteHandTarget = remoteHandTarget;
    if (ensureRemoteSword()) {
      remoteSword.visible = !!(model && remoteSwordTarget.has);
      if (remoteSword.visible) {
        remoteSword.position.copy(remoteSwordTarget.pos);
        model.localToWorld(remoteSword.position);
        remoteSword.quaternion.copy(model.quaternion).multiply(remoteSwordTarget.quat);
      }
    }
  };

  // Opponent's body + blade for the local sword hit check (null outside a fight)
  const _bladeOffsets = [
    new THREE.Vector3(0, 0, -0.1),
    new THREE.Vector3(0, 0, 0.3),
    new THREE.Vector3(0, 0, 0.65)
  ];
  const _combat = {
    center: new THREE.Vector3(),
    position: new THREE.Vector3(),
    bladePoints: _bladeOffsets.map(() => new THREE.Vector3()),
    bladeDir: new THREE.Vector3(),
    blocking: false,
    hasBlade: false
  };
  const getOpponentCombat = () => {
    if (phase !== 'fighting' || !duel) return null;
    const model = ctx.getRemoteModel(duel.opponentId);
    if (!model) return null;
    _combat.position.copy(model.position);
    _combat.center.copy(model.position);
    _combat.center.y += 0.8;
    _combat.hasBlade = !!(remoteSword?.visible);
    if (_combat.hasBlade) {
      _bladeOffsets.forEach((offset, i) => {
        _combat.bladePoints[i].copy(offset).applyQuaternion(remoteSword.quaternion).add(remoteSword.position);
      });
      _combat.bladeDir.set(0, 0, 1).applyQuaternion(remoteSword.quaternion);
    }
    _combat.blocking = remoteBlocking;
    return _combat;
  };

  return {
    enter,
    exit,
    update,
    handleMessage,
    getOpponentCombat,
    isActive: () => phase !== 'off',
    isInDuel: () => !!duel && (phase === 'countdown' || phase === 'fighting' || phase === 'over'),
    isFighting: () => phase === 'fighting',
    getOpponentId: () => duel?.opponentId || null,
    acceptsPresenceFrom: (peerId) => !!duel && peerId === duel.opponentId,
    sendHit: (dmg, dir) => {
      if (phase !== 'fighting' || !duel) return;
      send(duel.opponentId, { op: 'hit', challengeId: duel.challengeId, dmg, dir: [dir.x, dir.z] });
    },
    sendBlocked: () => {
      if (phase !== 'fighting' || !duel) return;
      send(duel.opponentId, { op: 'blocked', challengeId: duel.challengeId });
    },
    // The local player died in a duel: tell the opponent, they win
    onLocalDeath: () => {
      if (!duel || phase !== 'fighting') return;
      send(duel.opponentId, { op: 'dead', challengeId: duel.challengeId });
      endDuel(opponentName());
    },
    onPeersChange: () => {
      if (phase === 'lobby') renderLobby();
    }
  };
}
