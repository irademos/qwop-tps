const DEFAULT_PERF_PROFILE = {
  maxConcurrentSFX: 12,
  footstepCooldownMs: 220,
  footstepMinIntervalMs: 300,
  preloadCommonSFX: true
};

const LOW_END_PERF_PROFILE = {
  maxConcurrentSFX: 5,
  footstepCooldownMs: 320,
  footstepMinIntervalMs: 420,
  preloadCommonSFX: true
};

// Distance falloff for sounds with a place in the world (playSFX's `at`, townsfolk's speech):
// full volume within `ref` m of the listener, then ref / (ref + rolloff·(d − ref)), faded to
// nothing by `max` m
export const DISTANCE_FALLOFF = { ref: 3, rolloff: 0.6, max: 40 };
export function distanceGain(d, { ref = DISTANCE_FALLOFF.ref, rolloff = DISTANCE_FALLOFF.rolloff, max = DISTANCE_FALLOFF.max } = {}) {
  if (!Number.isFinite(d) || d <= ref) return 1;
  if (d >= max) return 0;
  const g = ref / (ref + rolloff * (d - ref));
  const edge = 1 - Math.max(0, (d - max * 0.7) / (max * 0.3)); // (eased out over the last 30 %)
  return g * edge;
}

const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'click'];
// Events that count as a user gesture for starting <audio> (Safari doesn't take touchstart / pointerdown)
const MEDIA_GESTURE_EVENTS = ['click', 'touchend', 'keydown'];
// A tiny silent WAV, played once inside a gesture to unlock the music element
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

// Named one-shot sounds (public/assets/audio/SFX/Foley/) — audioManager.playSound(name, opts):
// [file, default volume, cooldown ms (repeats closer than that are dropped)]
export const GAME_SOUNDS = {
  coin: ['coin_jingle_small.ogg', 0.45, 70],        // coins gained (pickups, rewards, gifts)
  chestPrize: ['gem_collect.ogg', 0.5, 300],         // a mystery / hidden chest's prize
  buy: ['coin_jingle_small.ogg', 0.6, 120],          // a purchase
  doorOpen: ['creaky_door_short.ogg', 0.45, 400],    // Town: walking in through a door
  doorClose: ['door_close.ogg', 0.45, 400],          // Town: walking out of a room
  knock: ['door_knock.ogg', 0.6, 600],               // Town: knocking on a door
  unlock: ['lock_unlock.ogg', 0.6, 300],             // a lock picked / jail let out
  locked: ['lock_quick.ogg', 0.55, 500],             // a locked door tried / a slipped pick
  eat: ['munching_food.ogg', 0.6, 400],              // eating food
  drink: ['drink_slurp.ogg', 0.55, 400],             // a potion
  splash: ['water_splashing.ogg', 0.45, 300],        // a fish landed / stepping into the canoe
  wood: ['wood_small_gather.ogg', 0.55, 150],        // a log split for wood / gathering
  match: ['light_match.ogg', 0.5, 600],              // cooking started over the fire
  book: ['map_open.ogg', 0.5, 300],                  // Town book opened
  equip: ['weapon_equip.ogg', 0.4, 120],             // bow / shield out
  pickup: ['weapon_pick_up.ogg', 0.5, 120],          // a battle pickup
  swing: ['swipe.ogg', 0.28, 220],                   // a sword swing
  roll: ['whoosh_1.ogg', 0.5, 200],                  // a dodge roll
  twang: ['elastic_twang.ogg', 0.45, 80],            // the bow loosing an arrow
  thud: ['harsh_thud.ogg', 0.7, 400],                // a tree hitting the ground
  clang: ['metal_clang.ogg', 0.5, 120],              // a shield taking a hit
  punch: ['punch.ogg', 0.55, 150],                   // townsfolk brawling
};

export class AudioManager {
  constructor(options = {}) {
    this.background = null;
    this.currentBGSPath = null;

    this.footsteps = [
      'SFX/Footsteps/Dirt/Dirt Walk 1.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 2.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 3.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 4.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 5.ogg'
    ];
    this.ouchSounds = [
      'NPC Sounds/ouch1.ogg',
      'NPC Sounds/ouch2.ogg',
      'NPC Sounds/ouch3.ogg'
    ];

    this.bufferCache = new Map();
    this.pendingLoads = new Map();
    this.soundCooldowns = new Map();
    this.activeSFXNodes = new Set();
    this.lastFootstepAt = 0;

    this.context = null;
    this.masterGain = null;
    this.sfxGain = null;

    const inferredLowEnd =
      options.lowEndMode ??
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    this.performanceProfile = inferredLowEnd ? LOW_END_PERF_PROFILE : DEFAULT_PERF_PROFILE;

    if (options.performanceProfile) {
      this.performanceProfile = {
        ...this.performanceProfile,
        ...options.performanceProfile
      };
    }

    this.masterVolume = options.masterVolume ?? 1;
    this.sfxVolume = options.sfxVolume ?? 1.0;
    this.musicVolume = options.musicVolume ?? 0.05;
    this.voiceVolume = options.voiceVolume ?? 0.5;

    // The listener (setListener, every frame): where sounds are heard from (the player) and
    // the camera's right, for left / right panning
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0, set: false };

    // Browsers block an AudioContext created before a user gesture, so the
    // context (and the SFX preload, which needs it to decode) waits for the
    // first click/tap/key press.
    this._unlockListener = () => this.unlock();
    for (const type of UNLOCK_EVENTS) {
      window.addEventListener(type, this._unlockListener, { capture: true, passive: true });
    }

    // Stage songs play on one <audio> element (getMusicElement). Stages often start without a
    // click on the game page (the phone's interact button, auto-continued dialogue), and Safari
    // only lets an element start playing inside a gesture — so the element is played once
    // (silently) on the first gesture, which unlocks it for later songs; a song that was still
    // blocked is retried on the next gesture.
    this.musicElement = new Audio();
    this.musicElement.preload = 'auto';
    this._musicUnlocked = false;
    this._musicRetry = false;
    this._mediaGestureListener = () => this._onMediaGesture();
    for (const type of MEDIA_GESTURE_EVENTS) {
      window.addEventListener(type, this._mediaGestureListener, { capture: true, passive: true });
    }
  }

  /** The <audio> element for stage songs (unlocked on the first user gesture). */
  getMusicElement() {
    return this.musicElement;
  }

  /** Play the music element; if the browser blocks it, try again on the next user gesture. */
  playMusic() {
    const el = this.musicElement;
    const attempt = el.play();
    if (!attempt?.catch) return;
    attempt.then(() => { this._musicRetry = false; }).catch((err) => {
      if (err?.name === 'NotAllowedError') this._musicRetry = true;
      else console.warn('Music play failed', err);
    });
  }

  _onMediaGesture() {
    const el = this.musicElement;
    if (this._musicRetry) { this._musicRetry = false; this.playMusic(); return; }
    if (this._musicUnlocked) return;
    this._musicUnlocked = true;
    if (el.getAttribute('src')) return; // (a song is already on it)
    el.src = SILENT_WAV;
    const attempt = el.play();
    attempt?.then?.(() => { if (el.src === SILENT_WAV) el.pause(); }).catch(() => { this._musicUnlocked = false; });
  }

  /** Stop the music element (and forget a blocked song waiting for a gesture). */
  stopMusic() {
    this._musicRetry = false;
    this.musicElement.pause();
  }

  unlock() {
    if (this._unlocked) return;
    this._unlocked = true;
    for (const type of UNLOCK_EVENTS) {
      window.removeEventListener(type, this._unlockListener, { capture: true });
    }
    this.resumeAudioContext();
    if (this.performanceProfile.preloadCommonSFX) {
      this.preloadCommonSFX();
    }
  }

  ensureAudioContext() {
    if (this.context) return;
    // No gesture yet: creating the context now would just trigger the autoplay warning.
    if (!this._unlocked && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    this.context = new Ctx();
    this.masterGain = this.context.createGain();
    this.sfxGain = this.context.createGain();

    this.masterGain.connect(this.context.destination);
    this.sfxGain.connect(this.masterGain);

    this.masterGain.gain.value = this.masterVolume;
    this.sfxGain.gain.value = this.sfxVolume;
  }

  async resumeAudioContext() {
    this.ensureAudioContext();
    if (this.context?.state === 'suspended') {
      try {
        await this.context.resume();
      } catch (err) {
        console.warn('AudioContext resume failed', err);
      }
    }
  }

  // Little synthesised sounds with no sample of their own: 'bowDraw' (the string creaking back)
  // and 'bowRelease' (the twang + the arrow's whoosh)
  playSynth(kind, volume = 1) {
    this.ensureAudioContext();
    const ctx = this.context;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1, volume));
    out.connect(this.sfxGain);
    const noise = (seconds) => {
      const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      return src;
    };
    if (kind === 'bowDraw') {
      // a soft rising creak: band-passed noise, its pitch climbing, a slow tremble
      const src = noise(0.8);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 9;
      band.frequency.setValueAtTime(380, t);
      band.frequency.linearRampToValueAtTime(900, t + 0.75);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.12);
      g.gain.linearRampToValueAtTime(0.12, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      src.connect(band).connect(g).connect(out);
      src.start(t);
      src.stop(t + 0.82);
    } else if (kind === 'bowRelease') {
      // the twang: a plucked low note dropping in pitch
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, t);
      osc.frequency.exponentialRampToValueAtTime(95, t + 0.25);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(og).connect(out);
      osc.start(t);
      osc.stop(t + 0.32);
      // the whoosh: high-passed noise, a quick swell
      const src = noise(0.35);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.Q.value = 0.8;
      hp.frequency.setValueAtTime(2400, t);
      hp.frequency.exponentialRampToValueAtTime(900, t + 0.3);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.33);
      src.connect(hp).connect(ng).connect(out);
      src.start(t);
      src.stop(t + 0.35);
    } else if (kind === 'comboWhoosh' || kind === 'comboReady') {
      // comboWhoosh: a big sword whoosh (swordCombo.js' combo attacks) — band-passed noise
      // sweeping down; comboReady: a short bright chime (two notes up)
      if (kind === 'comboWhoosh') {
        const src = noise(0.55);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 1.2;
        band.frequency.setValueAtTime(3200, t);
        band.frequency.exponentialRampToValueAtTime(500, t + 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
        src.connect(band).connect(g).connect(out);
        src.start(t);
        src.stop(t + 0.55);
      } else {
        [880, 1320].forEach((f, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = f;
          const og = ctx.createGain();
          const t0 = t + i * 0.08;
          og.gain.setValueAtTime(0.0001, t0);
          og.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
          og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
          osc.connect(og).connect(out);
          osc.start(t0);
          osc.stop(t0 + 0.32);
        });
      }
    }
    setTimeout(() => { try { out.disconnect(); } catch (_) { /* ignore */ } }, 1200);
  }

  setMasterVolume(value) {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.masterGain) {
      this.masterGain.gain.value = this.masterVolume;
    }
    this._applyBGSVolume();
  }

  setSFXVolume(value) {
    this.sfxVolume = Math.max(0, Math.min(1, value));
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.sfxVolume;
    }
    this._applyBGSVolume();
  }

  // Ambient BGS loops follow the SFX slider (not music), like the Web Audio SFX
  // they sit alongside, scaled by the per-loop volumeScale from playBGS().
  _applyBGSVolume() {
    if (!this.background) return;
    const volume = this.masterVolume * this.sfxVolume * (this.bgsVolumeScale ?? 1);
    this.background.volume = Math.max(0, Math.min(1, volume));
  }

  setVoiceVolume(value) {
    this.voiceVolume = Math.max(0, Math.min(1, value));
  }

  /** Where sounds are heard from: `pos` (the player), panned by `rightX` / `rightZ` (the camera's right). */
  setListener(pos, rightX = 1, rightZ = 0) {
    const l = this.listener;
    l.x = pos.x; l.y = pos.y; l.z = pos.z;
    const len = Math.hypot(rightX, rightZ) || 1;
    l.rx = rightX / len; l.rz = rightZ / len;
    l.set = true;
  }

  /** Metres from the listener to `pos` (0 before the first setListener). */
  distanceTo(pos) {
    const l = this.listener;
    if (!l.set || !pos) return 0;
    return Math.hypot(pos.x - l.x, (pos.y ?? l.y) - l.y, pos.z - l.z);
  }

  /** Volume multiplier for a sound at `pos` (distanceGain; `falloff` overrides its ref / rolloff / max). */
  gainAt(pos, falloff) {
    return pos ? distanceGain(this.distanceTo(pos), falloff) : 1;
  }

  // Left / right pan (−1 … 1) for a sound at `pos`: the side of the camera it's on, softened
  _panAt(pos) {
    const l = this.listener;
    if (!l.set || !pos) return 0;
    const dx = pos.x - l.x;
    const dz = pos.z - l.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return 0;
    return Math.max(-1, Math.min(1, ((dx * l.rx + dz * l.rz) / d) * Math.min(1, d / 4))) * 0.7;
  }

  setMusicVolume(value) {
    this.musicVolume = Math.max(0, Math.min(1, value));
    if (this.phoneSwordAudio) {
      this.phoneSwordAudio.volume = this.musicVolume;
    }
  }

  async preloadCommonSFX() {
    const common = [
      ...this.footsteps,
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Unsheath 1.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Sheath 1.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg',
      'SFX/Explosions/Explosion 1.ogg',
      'SFX/Spells/Spell Impact 1.ogg',
      'SFX/Spells/Waterspray 1.ogg',
      ...this.ouchSounds,
      ...['coin', 'swing', 'roll', 'twang', 'clang'].map((n) => `SFX/Foley/${GAME_SOUNDS[n][0]}`)
    ];
    await Promise.allSettled(common.map(path => this.loadBuffer(path)));
  }

  async loadBuffer(path) {
    if (this.bufferCache.has(path)) {
      return this.bufferCache.get(path);
    }

    if (this.pendingLoads.has(path)) {
      return this.pendingLoads.get(path);
    }

    const loadPromise = (async () => {
      this.ensureAudioContext();
      if (!this.context) return null;

      try {
        const response = await fetch(`assets/audio/${path}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${path}: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
        this.bufferCache.set(path, audioBuffer);
        return audioBuffer;
      } catch (err) {
        console.warn('Failed to load/decode SFX', path, err);
        return null;
      } finally {
        this.pendingLoads.delete(path);
      }
    })();

    this.pendingLoads.set(path, loadPromise);
    return loadPromise;
  }

  // volumeScale multiplies the SFX volume for this loop (e.g. 0.5 = half as loud).
  playBGS(name, { volumeScale = 1 } = {}) {
    const path = `assets/audio/BGS Loops/${name}`;
    this.bgsVolumeScale = volumeScale;

    if (!this.background) {
      this.background = new Audio(path);
      this.background.loop = true;
      this._applyBGSVolume();
    } else {
      this._applyBGSVolume();
      if (this.currentBGSPath === path) {
        if (this.background.paused) {
          this.background.play().catch(err => console.error('BGS resume failed', err));
        }
        return;
      }
      this.background.pause();
      this.background.src = path;
      this.background.currentTime = 0;
    }

    this.currentBGSPath = path;
    this.background.play().catch(err => console.error('BGS play failed', err));
  }

  canPlaySound(key, cooldownMs) {
    if (!cooldownMs) return true;
    const now = performance.now();
    const last = this.soundCooldowns.get(key) ?? 0;
    if (now - last < cooldownMs) {
      return false;
    }
    this.soundCooldowns.set(key, now);
    return true;
  }

  cleanupEndedNode(entry) {
    if (!entry) return;
    this.activeSFXNodes.delete(entry);
  }

  // A GAME_SOUNDS sound: opts { volume (× its default), at, falloff, cooldownMs }
  playSound(name, { volume = 1, at = null, falloff, cooldownMs } = {}) {
    const def = GAME_SOUNDS[name];
    if (!def) return null;
    const [file, vol, cd] = def;
    return this.playSFX(`SFX/Foley/${file}`, vol * volume, { cooldownKey: `snd-${name}`, cooldownMs: cooldownMs ?? cd, at, falloff });
  }

  async playSFX(path, volume = 0.7, options = {}) {
    const {
      cooldownKey,
      cooldownMs = 0,
      bypassConcurrencyLimit = false,
      // where the sound comes from (a world position): quieter with distance from the listener,
      // panned to its side; `falloff` = distanceGain options
      at = null,
      falloff
    } = options;

    if (at) {
      volume *= this.gainAt(at, falloff);
      if (volume < 0.01) return null;
    }

    if (cooldownKey && !this.canPlaySound(cooldownKey, cooldownMs)) {
      return null;
    }

    if (
      !bypassConcurrencyLimit &&
      this.activeSFXNodes.size >= (this.performanceProfile.maxConcurrentSFX ?? DEFAULT_PERF_PROFILE.maxConcurrentSFX)
    ) {
      return null;
    }

    await this.resumeAudioContext();
    const buffer = await this.loadBuffer(path);
    if (!buffer || !this.context || !this.sfxGain) {
      return null;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.context.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, volume));

    source.connect(gainNode);
    const pan = at ? this._panAt(at) : 0;
    if (pan && this.context.createStereoPanner) {
      const panner = this.context.createStereoPanner();
      panner.pan.value = pan;
      gainNode.connect(panner);
      panner.connect(this.sfxGain);
    } else {
      gainNode.connect(this.sfxGain);
    }

    const entry = { source, gainNode };
    this.activeSFXNodes.add(entry);

    source.onended = () => this.cleanupEndedNode(entry);

    source.start(0);
    return source;
  }

  // Hurt vocals (NPC Sounds/ouch1-3), played at ~50% of the SFX volume:
  //   'enemy'       → ouch1 (enemy swordsmen and bombers)
  //   'player'      → ouch2 (local player hurt)
  //   'playerDeath' → ouch3 (local player dies)
  // cooldownKey is per character so several enemies hit together can each
  // cry out, but one can't stack.
  playOuch(kind = 'enemy', cooldownKey = `ouch-${kind}`, volume = 0.5, at = null) {
    const index = kind === 'player' ? 1 : kind === 'playerDeath' ? 2 : 0;
    return this.playSFX(this.ouchSounds[index], volume, { cooldownKey, cooldownMs: 150, at });
  }

  // Called on every enemy hit (any enemy). Only every 3rd or 4th hit
  // (randomly chosen each cycle) actually cries out with ouch1.
  playEnemyOuch(cooldownKey, at = null) {
    this.enemyHurtCount = (this.enemyHurtCount ?? 0) + 1;
    this.enemyOuchAt ??= 3 + Math.floor(Math.random() * 2);
    if (this.enemyHurtCount < this.enemyOuchAt) return null;
    this.enemyHurtCount = 0;
    this.enemyOuchAt = 3 + Math.floor(Math.random() * 2);
    return this.playOuch('enemy', cooldownKey, 0.5, at);
  }

  playFootstepAt(entityId, volume = 0.3) {
    const now = performance.now();
    const minInterval = this.performanceProfile.footstepMinIntervalMs ?? 0;
    if (minInterval > 0 && now - this.lastFootstepAt < minInterval) {
      return;
    }
    this.lastFootstepAt = now;

    const clip = this.footsteps[Math.floor(Math.random() * this.footsteps.length)];
    this.playSFX(clip, volume, {
      cooldownKey: `footstep:${entityId}`,
      cooldownMs: this.performanceProfile.footstepCooldownMs
    });
  }
}
