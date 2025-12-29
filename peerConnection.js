import { db } from './firebase-init.js';
import {
  ref,
  set,
  remove,
  onValue,
  get,
  onDisconnect
} from 'firebase/database';

export class Multiplayer {
  constructor(playerName, onPeerData) {
    this.connections = {};
    this.onPeerData = onPeerData;
    this.playerName = playerName;
    this.isHost = false;
    this.currentHostId = null;
    this.onHostChange = null;
    
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

        // The latest joined player becomes the host
        const hostPeerId = validPeerIds[0];
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

      // Add to connected players list
      const list = document.getElementById('connected-players-list');
      const item = document.createElement('li');
      item.id = `peer-${conn.peer}`;


      // Wait for name to come through "presence"
      item.textContent = `Connected to (waiting...)`;
      if (!this.connections[conn.peer]) {
        this.connections[conn.peer] = {};
      }
      this.connections[conn.peer].listItem = item;
      list.appendChild(item);

      // Setup basic ping test
      const pingStart = Date.now();
      conn.send({ type: "ping" });

      conn.on('data', data => {
        if (data.type === "pong") {
          const rtt = Date.now() - pingStart;
          document.getElementById("ping-display").textContent = rtt;
        }
      });

      // Reply to ping
      conn.on('data', data => {
        if (data.type === "ping") {
          conn.send({ type: "pong" });
        }
      });
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

        delete this.connections[conn.peer];
        const item = document.getElementById(`peer-${conn.peer}`);
        if (item) item.remove();
      });

      conn.on('error', err => {
        console.error('Peer error:', err);
        const errList = document.getElementById('connection-errors-list');
        const item = document.createElement('li');
        item.textContent = `❌ ${conn.peer || 'Unknown peer'}: ${err.message}`;
        errList.appendChild(item);
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
      conn.on('data', data => this.onPeerData(conn.peer, data));
  
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
    });
  
    conn.on('close', () => {
      delete this.connections[conn.peer];
    });
  
    conn.on('error', err => {
      console.error('Peer error:', err);
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
}
