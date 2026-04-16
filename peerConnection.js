import { db } from './firebase-init.js';
import { loadPeerJs } from './externalDeps.js';
import {
  ref,
  set,
  remove,
  onValue,
  get,
  onDisconnect
} from 'firebase/database';

const VALID_MESSAGE_TYPES = new Set([
  'presence',
  'entityControl',
  'entityStates',
  'entitySnapshot',
  'entityStateRequest',
  'projectile',
  'inventoryThrowProjectile',
  'monster',
  'attackMonster',
  'inventoryDrop',
  'inventoryWorldDrop',
  'inventoryWeaponDrop',
  'dropPickup',
  'dropWorldPickup',
  'dropWeaponPickup',
  'grab',
  'grabMove'
]);
const MAX_PENDING_PAYLOADS = 75;
const COALESCED_PAYLOAD_TYPES = new Set(['entitySnapshot', 'entityStates']);

export class Multiplayer {
  constructor(playerName, onPeerData) {
    this.connections = {};
    this.pendingConnections = new Set();
    this.pendingPayloads = new Map();
    this.pendingConnectionRetries = new Map();
    this.failedConnectionAt = new Map();
    this.onPeerData = onPeerData;
    this.playerName = playerName;
    this.isHost = false;
    this.currentHostId = null;
    this.lastHostLogId = null;
    this.lastPeerLogKey = '';
    this.lastPeerLogAt = 0;
    this.lastValidPeerSetKey = '';
    this.lastOrderedPeerIds = [];
    this.onHostChange = null;
    this.onConnectionError = null;
    this.onPingUpdate = null;
    this.lastPingMs = null;
    this.lastPingAt = null;
    this.lastError = null;
    this.peersCache = {};
    this.unsubscribePeersListener = null;
    this.unsubscribeRoomListener = null;
    this.hostRecalcTimer = null;
    this.roomPeerIds = [];
    
    this.initPeer(); // Start async setup
  }

  async initPeer() {
    let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    const fetchTimeoutMs = 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      // Fetch TURN credentials
      const response = await fetch(
        `https://multiplayer-game.metered.live/api/v1/turn/credentials?apiKey=${import.meta.env.VITE_METERED_API_KEY}`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        throw new Error(`TURN credential fetch failed with status ${response.status}`);
      }
      const dynamic = await response.json();
      if (!Array.isArray(dynamic)) {
        throw new Error('TURN credential response was not an array');
      }

      // Select only the first two TURN entries (after filtering out STUNs, just in case)
      const turnServers = dynamic.filter(server => server.urls.startsWith("turn")).slice(0, 2);
      if (turnServers.length > 0) {
        iceServers = [...iceServers, ...turnServers];
      }
    } catch (err) {
      console.warn('Failed to fetch TURN credentials. Falling back to STUN only.', err);
      this.recordError(err);
    } finally {
      clearTimeout(timeoutId);
    }
  
    const Peer = await loadPeerJs();

    this.peer = new Peer({
      config: { iceServers }
    });

    this.peer.on('open', async id => {
      this.id = id;

      const roomsRef = ref(db, 'rooms');
      const snapshot = await get(roomsRef);

      let assignedRoom = null;
      let roomIndex = 0;

      if (snapshot.exists()) {
        const rooms = snapshot.val();
        for (const roomName in rooms) {
          const peersInRoom = Object.keys(rooms[roomName]);
          if (peersInRoom.length < 20) {
            assignedRoom = roomName;
            console.log("Entered room: ", assignedRoom)
            break;
          }
          roomIndex++;
        }
      }

      if (!assignedRoom) {
        assignedRoom = `room-${roomIndex}`;
      }

      const roomRef = ref(db, `rooms/${assignedRoom}/${id}`);
      this.roomId = assignedRoom;
      await remove(roomRef);
      await set(roomRef, true);

      const peerRef = ref(db, `peers/${id}`);
      await remove(peerRef);
      await set(peerRef, {
        name: this.playerName,
        roomId: assignedRoom,
        timestamp: Date.now()
      });

      // Setup server-side disconnection cleanup
      onDisconnect(roomRef).remove();
      onDisconnect(peerRef).remove();

      // Still use beforeunload for graceful exit (optional)
      window.addEventListener('beforeunload', () => {
        remove(roomRef);
        remove(peerRef);
      });

      this.attachPeersListener();
      this.attachRoomListener(assignedRoom);

      if (typeof this.onReady === 'function') {
        try {
          this.onReady({ roomId: assignedRoom, peerId: id });
        } catch (err) {
          console.warn('onReady callback failed:', err);
        }
      }

    });

    // Voice calls are disabled; only data connections are handled.
    this.peer.on('connection', conn => {
      this.setupConnection(conn);
    });

    this.peer.on('disconnected', () => {
      this.resetRealtimeListeners();
    });
    this.peer.on('close', () => {
      this.resetRealtimeListeners();
    });
  }

  attachPeersListener() {
    if (this.unsubscribePeersListener) {
      this.unsubscribePeersListener();
      this.unsubscribePeersListener = null;
    }
    this.unsubscribePeersListener = onValue(ref(db, 'peers'), snapshot => {
      this.peersCache = snapshot.val() || {};
      this.scheduleHostRecalculation();
    });
  }

  attachRoomListener(roomId) {
    if (!roomId) return;
    if (this.unsubscribeRoomListener) {
      this.unsubscribeRoomListener();
      this.unsubscribeRoomListener = null;
    }
    this.unsubscribeRoomListener = onValue(ref(db, `rooms/${roomId}`), snapshot => {
      const roomPeersObj = snapshot.val() || {};
      this.roomPeerIds = Object.keys(roomPeersObj);
      this.scheduleHostRecalculation();
    });
  }

  scheduleHostRecalculation() {
    if (this.hostRecalcTimer) return;
    this.hostRecalcTimer = setTimeout(() => {
      this.hostRecalcTimer = null;
      this.recalculateHostAndPeers();
    }, 25);
  }

  recalculateHostAndPeers() {
    const activePeers = this.peersCache || {};
    const allPeerIds = this.roomPeerIds || [];
    const validPeerIds = allPeerIds.filter(pid => activePeers[pid]);
    const validPeerSetKey = validPeerIds.slice().sort().join(',');
    const previousHostId = this.currentHostId;
    const hostStillValid = previousHostId && validPeerIds.includes(previousHostId);

    let orderedPeerIds = this.lastOrderedPeerIds;
    let hasPeerSetChanged = validPeerSetKey !== this.lastValidPeerSetKey;
    if (hasPeerSetChanged || !hostStillValid) {
      orderedPeerIds = [...validPeerIds].sort((a, b) => {
        const timestampA = activePeers[a]?.timestamp ?? 0;
        const timestampB = activePeers[b]?.timestamp ?? 0;
        if (timestampA !== timestampB) {
          return timestampA - timestampB;
        }
        return a.localeCompare(b);
      });
      this.lastOrderedPeerIds = orderedPeerIds;
      this.lastValidPeerSetKey = validPeerSetKey;
    }

    const peerLogKey = `${this.id}|${orderedPeerIds.join(',')}`;
    const nowMs = Date.now();
    if (peerLogKey !== this.lastPeerLogKey || nowMs - this.lastPeerLogAt > 10000) {
      console.log("My ID:", this.id);
      console.log("Valid Peers (oldest first):", orderedPeerIds);
      this.lastPeerLogKey = peerLogKey;
      this.lastPeerLogAt = nowMs;
    }

    let hostPeerId = hostStillValid ? previousHostId : null;
    if (!hostPeerId && orderedPeerIds.length > 0) {
      hostPeerId = orderedPeerIds[0];
    }

    this.currentHostId = hostPeerId;
    this.isHost = (hostPeerId === this.id);

    if (this.isHost && this.lastHostLogId !== this.id) {
      console.log("👑 I am the host player");
      this.lastHostLogId = this.id;
    }
    if (previousHostId !== hostPeerId && hostPeerId) {
      console.log("Host selected (stable):", hostPeerId);
    }

    if (previousHostId !== hostPeerId && typeof this.onHostChange === 'function') {
      try {
        this.onHostChange({
          previousHostId,
          newHostId: hostPeerId,
          isCurrentHost: this.isHost
        });
      } catch (err) {
        console.warn('Host change callback failed:', err);
      }
    }

    for (const peerId of orderedPeerIds) {
      if (peerId !== this.id && !this.connections[peerId] && this.shouldAttemptConnection(peerId)) {
        this.connectToPeer(peerId);
      }
    }
  }

  resetRealtimeListeners() {
    if (this.unsubscribeRoomListener) {
      this.unsubscribeRoomListener();
      this.unsubscribeRoomListener = null;
    }
    if (this.unsubscribePeersListener) {
      this.unsubscribePeersListener();
      this.unsubscribePeersListener = null;
    }
    if (this.hostRecalcTimer) {
      clearTimeout(this.hostRecalcTimer);
      this.hostRecalcTimer = null;
    }
  }

  async clearServerState() {
    const targets = ['rooms', 'peers', 'sessions'];
    const results = await Promise.all(
      targets.map(async (path) => {
        try {
          await remove(ref(db, path));
          return { path, ok: true };
        } catch (error) {
          console.warn(`Failed to clear ${path}:`, error);
          return { path, ok: false, error };
        }
      })
    );
    const cleared = results.filter(result => result.ok).map(result => result.path);
    const failed = results
      .filter(result => !result.ok)
      .map(result => ({ path: result.path, error: result.error }));
    return { cleared, failed };
  }

  connectToPeer(peerId) {
    if (this.pendingConnections.has(peerId)) {
      return;
    }
    if (!this.peer || this.peer.destroyed) {
      console.warn('Peer connection not ready for', peerId);
      return;
    }
    const conn = this.peer.connect(peerId);
    if (!conn) {
      console.warn('Failed to create peer connection for', peerId);
      this.failedConnectionAt.set(peerId, Date.now());
      return;
    }
    this.pendingConnections.add(peerId);
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    if (!conn || typeof conn.on !== 'function') {
      console.warn('Invalid peer connection', conn);
      if (conn?.peer) {
        this.pendingConnections.delete(conn.peer);
        this.failedConnectionAt.set(conn.peer, Date.now());
      }
      return;
    }
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      this.pendingConnections.delete(conn.peer);
      this.failedConnectionAt.delete(conn.peer);
      if (this.pendingConnectionRetries.has(conn.peer)) {
        clearTimeout(this.pendingConnectionRetries.get(conn.peer));
        this.pendingConnectionRetries.delete(conn.peer);
      }
      console.log("Connected to peer:", conn.peer);
      const queuedPayloads = this.pendingPayloads.get(conn.peer);
      if (queuedPayloads?.length) {
        queuedPayloads.forEach(payload => conn.send(payload));
        this.pendingPayloads.delete(conn.peer);
      }
      conn.on('data', data => {
        const isObjectPayload = data && typeof data === 'object' && !Array.isArray(data);
        if (!isObjectPayload) {
          console.warn('Dropping non-object peer payload', data);
          return;
        }
        if (data?.type === 'ping') {
          conn.send({ type: 'pong', ts: data.ts || Date.now() });
          return;
        }
        if (data?.type === 'pong') {
          const sentAt = data.ts || this.pendingPings?.[conn.peer];
          if (sentAt) {
            const rtt = Date.now() - sentAt;
            this.lastPingMs = rtt;
            this.lastPingAt = Date.now();
            this.onPingUpdate?.(rtt);
          }
          return;
        }
        if (typeof data.type !== 'string' || !VALID_MESSAGE_TYPES.has(data.type)) {
          console.warn('Dropping unknown peer payload type', data);
          return;
        }
        this.onPeerData(conn.peer, data);
      });
  
      // Attempt to access the internal peer connection
      try {
        conn.statsIntervalId = setInterval(async () => {
          try {
            // PeerJS sometimes delays access to the connection internals
            const pc = conn._pc || conn.peerConnection || conn._connection?.peerConnection;
            if (!pc) {
              console.warn("RTCPeerConnection not ready for", conn.peer);
              return;
            }
            if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
              clearInterval(conn.statsIntervalId);
              conn.statsIntervalId = null;
              return;
            }
            if (pc.connectionState === 'connected') {
              clearInterval(conn.statsIntervalId);
              conn.statsIntervalId = null;
  
              const stats = await pc.getStats();
              stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                  console.log(`🎯 Connected to peer ${conn.peer}`);
                  console.log('Selected candidate pair:');
                  console.log(`🔹 Local: ${report.localCandidateId}`);
                  console.log(`🔸 Remote: ${report.remoteCandidateId}`);
                }
              });
            }
          } catch (err) {
            clearInterval(conn.statsIntervalId);
            conn.statsIntervalId = null;
            console.warn(`Could not access RTCPeerConnection stats for peer ${conn.peer}`, err);
          }
        }, 1000);
      } catch (err) {
        console.warn(`Could not access RTCPeerConnection for peer ${conn.peer}`, err);
      }

      this.startPingLoop(conn);
    });
  
    conn.on('close', () => {
      this.stopPingLoop(conn.peer);
      if (conn.statsIntervalId) {
        clearInterval(conn.statsIntervalId);
        conn.statsIntervalId = null;
      }
      delete this.connections[conn.peer];
      this.pendingConnections.delete(conn.peer);
      this.pendingPayloads.delete(conn.peer);
      if (this.pendingConnectionRetries.has(conn.peer)) {
        clearTimeout(this.pendingConnectionRetries.get(conn.peer));
        this.pendingConnectionRetries.delete(conn.peer);
      }
    });
  
    conn.on('error', err => {
      console.error('Peer error:', err);
      this.recordError(err);
      if (conn.statsIntervalId) {
        clearInterval(conn.statsIntervalId);
        conn.statsIntervalId = null;
      }
      if (conn?.peer) {
        this.pendingConnections.delete(conn.peer);
        this.failedConnectionAt.set(conn.peer, Date.now());
        this.pendingPayloads.delete(conn.peer);
        if (this.pendingConnectionRetries.has(conn.peer)) {
          clearTimeout(this.pendingConnectionRetries.get(conn.peer));
          this.pendingConnectionRetries.delete(conn.peer);
        }
      }
    });
  }

  shouldAttemptConnection(peerId) {
    if (!peerId) return false;
    if (this.pendingConnections.has(peerId)) return false;
    const lastFailedAt = this.failedConnectionAt.get(peerId) || 0;
    const now = Date.now();
    return now - lastFailedAt > 5000;
  }

  send(data) {
    Object.values(this.connections).forEach(conn => {
      if (conn && typeof conn.send === 'function') {
        if (conn.open) {
          conn.send(data);
        } else if (typeof conn.once === 'function') {
          conn.once('open', () => conn.send(data));
        } else {
          console.warn("Invalid connection object", conn);
        }
      }
    });
  }

  getId() {
    return this.id;
  }

  getHostId() {
    return this.currentHostId;
  }

  sendTo(peerId, data) {
    if (!peerId || peerId === this.id) return;
    const existing = this.connections[peerId];
    if (existing && typeof existing.send === 'function') {
      if (existing.open) {
        existing.send(data);
        return;
      }
      this.enqueuePendingPayload(peerId, data);
      return;
    }

    try {
      if (this.pendingConnections.has(peerId)) {
        this.enqueuePendingPayload(peerId, data);
        return;
      }
      if (!this.shouldAttemptConnection(peerId)) {
        this.enqueuePendingPayload(peerId, data);
        this.scheduleConnectionRetry(peerId);
        return;
      }
      if (!this.peer || this.peer.destroyed) {
        console.warn('Peer connection not ready for', peerId);
        return;
      }
      const conn = this.peer.connect(peerId);
      this.setupConnection(conn);
      this.enqueuePendingPayload(peerId, data);
    } catch (err) {
      console.warn(`Failed to send direct message to ${peerId}:`, err);
    }
  }

  enqueuePendingPayload(peerId, data) {
    if (!this.pendingPayloads.has(peerId)) {
      this.pendingPayloads.set(peerId, []);
    }
    const queue = this.pendingPayloads.get(peerId);
    if (data?.type && COALESCED_PAYLOAD_TYPES.has(data.type)) {
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (queue[i]?.type === data.type) {
          queue.splice(i, 1);
        }
      }
    }
    queue.push(data);
    if (queue.length > MAX_PENDING_PAYLOADS) {
      const dropCount = queue.length - MAX_PENDING_PAYLOADS;
      queue.splice(0, dropCount);
      console.warn(
        `Pending payload queue exceeded ${MAX_PENDING_PAYLOADS}; dropped ${dropCount} oldest messages for peer ${peerId}.`
      );
    }
  }

  scheduleConnectionRetry(peerId) {
    if (!peerId || this.pendingConnectionRetries.has(peerId)) return;
    const lastFailedAt = this.failedConnectionAt.get(peerId) || 0;
    const now = Date.now();
    const delayMs = Math.max(0, 5000 - (now - lastFailedAt));
    const timeoutId = setTimeout(() => {
      this.pendingConnectionRetries.delete(peerId);
      if (!this.pendingPayloads.get(peerId)?.length) {
        return;
      }
      if (!this.shouldAttemptConnection(peerId)) {
        this.scheduleConnectionRetry(peerId);
        return;
      }
      this.connectToPeer(peerId);
    }, delayMs);
    this.pendingConnectionRetries.set(peerId, timeoutId);
  }

  recordError(err) {
    const message = err?.message || String(err || 'Unknown error');
    this.lastError = {
      message,
      timestamp: Date.now()
    };
    if (typeof this.onConnectionError === 'function') {
      this.onConnectionError(this.lastError);
    }
  }

  startPingLoop(conn) {
    if (!conn || !conn.peer) return;
    if (!this.pendingPings) {
      this.pendingPings = {};
    }
    this.stopPingLoop(conn.peer);
    const intervalId = setInterval(() => {
      if (!conn.open) return;
      const ts = Date.now();
      this.pendingPings[conn.peer] = ts;
      conn.send({ type: 'ping', ts });
    }, 8000);
    conn.pingIntervalId = intervalId;
  }

  stopPingLoop(peerId) {
    const conn = this.connections?.[peerId];
    if (conn?.pingIntervalId) {
      clearInterval(conn.pingIntervalId);
      conn.pingIntervalId = null;
    }
    if (this.pendingPings?.[peerId]) {
      delete this.pendingPings[peerId];
    }
  }

  reconnect() {
    this.resetRealtimeListeners();
    this.attachPeersListener();
    this.attachRoomListener(this.roomId);
    if (this.peer?.disconnected) {
      try {
        this.peer.reconnect();
      } catch (err) {
        this.recordError(err);
      }
      return;
    }
    if (this.peer?.destroyed) {
      this.recordError(new Error('Peer connection was destroyed.'));
      return;
    }
    Object.keys(this.connections).forEach(peerId => {
      try {
        this.connectToPeer(peerId);
      } catch (err) {
        this.recordError(err);
      }
    });
  }
}
