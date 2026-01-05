import { db } from './firebase-init.js';
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
  'monster',
  'inventoryDrop',
  'dropPickup',
  'grab',
  'grabMove'
]);

export class Multiplayer {
  constructor(playerName, onPeerData) {
    this.connections = {};
    this.onPeerData = onPeerData;
    this.playerName = playerName;
    this.isHost = false;
    this.currentHostId = null;
    this.onHostChange = null;
    this.onConnectionError = null;
    this.onPingUpdate = null;
    this.lastPingMs = null;
    this.lastPingAt = null;
    this.lastError = null;
    
    this.initPeer(); // Start async setup
  }

  async initPeer() {
    // Fetch TURN credentials
    const response = await fetch(`https://multiplayer-game.metered.live/api/v1/turn/credentials?apiKey=${import.meta.env.VITE_METERED_API_KEY}`);
    const dynamic = await response.json();
  
    // Select only the first two TURN entries (after filtering out STUNs, just in case)
    const turnServers = dynamic.filter(server => server.urls.startsWith("turn")).slice(0, 2);
  
    const iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      ...turnServers
    ];
  
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

      onValue(ref(db, `rooms/${assignedRoom}`), async snapshot => {
        const roomPeersObj = snapshot.val() || {};
        const allPeerIds = Object.keys(roomPeersObj);

        // Get all active peers
        const peersSnapshot = await get(ref(db, 'peers'));
        const activePeers = peersSnapshot.exists() ? peersSnapshot.val() : {};

        // Filter for only currently active peer IDs
        const validPeerIds = allPeerIds.filter(pid => activePeers[pid]);

        // Sort by join timestamp so the most recent becomes host
        validPeerIds.sort((a, b) => {
          return activePeers[b]?.timestamp - activePeers[a]?.timestamp;
        });

        console.log("My ID:", this.id);
        console.log("Valid Peers (more recent first):", validPeerIds);

        // Keep existing host if still connected; otherwise pick the most recent join.
        const currentHostStillValid = this.currentHostId && validPeerIds.includes(this.currentHostId);
        const hostPeerId = currentHostStillValid ? this.currentHostId : validPeerIds[0];
        const previousHostId = this.currentHostId;
        this.currentHostId = hostPeerId;
        this.isHost = (hostPeerId === this.id);

        if (this.isHost) {
          console.log("👑 I am the host player");
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

        // Connect to any valid peers we haven't yet connected to
        for (const peerId of validPeerIds) {
          if (peerId !== this.id && !this.connections[peerId]) {
            this.connectToPeer(peerId);
            console.log("Connected to peer:", peerId);
          }
        }
      });

    });

    this.peer.on('connection', conn => {
      this.setupConnection(conn);
    });

    this.peer.on('call', call => {
      call.answer(); // no stream sent

      call.on('stream', remoteStream => {
        this.handleIncomingVoice(call.peer, remoteStream);
      });

      call.on('close', () => {
        if (this.voiceAudios?.[call.peer]) {
          this.voiceAudios[call.peer].audio.pause();
          delete this.voiceAudios[call.peer];
        }
      });

      call.on('error', err => {
        console.error('Peer error:', err);
        this.recordError(err);
      });

    });
 
    onValue(ref(db, 'peers'), snapshot => {
      const peers = snapshot.val() || {};
    });
  }

  connectToPeer(peerId) {
    const conn = this.peer.connect(peerId);
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
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
        const interval = setInterval(async () => {
          // PeerJS sometimes delays access to the connection internals
          const pc = conn._pc || conn.peerConnection || conn._connection?.peerConnection;
          if (!pc) {
            console.warn("RTCPeerConnection not ready for", conn.peer);
            return;
          }
          if (pc && pc.connectionState === 'connected') {
            clearInterval(interval);
  
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
        }, 1000);
      } catch (err) {
        console.warn(`Could not access RTCPeerConnection for peer ${conn.peer}`, err);
      }

      this.startPingLoop(conn);
    });
  
    conn.on('close', () => {
      this.stopPingLoop(conn.peer);
      delete this.connections[conn.peer];
    });
  
    conn.on('error', err => {
      console.error('Peer error:', err);
      this.recordError(err);
    });
  }

  startVoice(stream) {
    for (const peerId in this.connections) {
      const conn = this.connections[peerId];
      if (!conn.callActive) {
        const call = this.peer.call(peerId, stream);
        conn.callActive = true;
      }
    }
  }
  
  stopVoice() {
    for (const peerId in this.voiceAudios || {}) {
      const { audio, stream } = this.voiceAudios[peerId];
      if (audio) {
        audio.pause();
        audio.srcObject = null;
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    }
    this.voiceAudios = {};
  } 

  handleIncomingVoice(peerId, stream) {
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.playsInline = true; // iOS-specific

    // Ensure audio can play (especially on mobile)
    audio.onloadedmetadata = () => {
      audio.play().catch(err => {
        console.warn(`Audio play failed for ${peerId}:`, err);
      });
    };

    // Prevent memory leaks from duplicates
    if (this.voiceAudios?.[peerId]?.audio) {
      this.voiceAudios[peerId].audio.pause();
      this.voiceAudios[peerId].audio.srcObject = null;
    }

    this.voiceAudios = this.voiceAudios || {};
    this.voiceAudios[peerId] = { audio, stream };
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
      if (typeof existing.once === 'function') {
        existing.once('open', () => existing.send(data));
        return;
      }
    }

    try {
      const conn = this.peer.connect(peerId);
      this.setupConnection(conn);
      if (typeof conn.once === 'function') {
        conn.once('open', () => conn.send(data));
      }
    } catch (err) {
      console.warn(`Failed to send direct message to ${peerId}:`, err);
    }
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
