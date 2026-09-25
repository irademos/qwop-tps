const DEFAULT_PERF_PROFILE = {
  maxConcurrentSFX: 12,
  footstepCooldownMs: 220,
  footstepMinIntervalMs: 300,
  attackCooldownMs: 120,
  preloadCommonSFX: true
};

const LOW_END_PERF_PROFILE = {
  maxConcurrentSFX: 5,
  footstepCooldownMs: 320,
  footstepMinIntervalMs: 420,
  attackCooldownMs: 180,
  preloadCommonSFX: true
};

const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'click'];

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
    this.attacks = [
      'SFX/Chopping and Mining/chop 3.ogg',
      'SFX/Chopping and Mining/mine 3.ogg',
      'SFX/Chopping and Mining/mine 5.ogg',
      'SFX/Spells/Spell Impact 3.ogg'
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
    this.loopingSFX = new Map();
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
    this.musicVolume = options.musicVolume ?? 0;

    // Browsers block an AudioContext created before a user gesture, so the
    // context (and the SFX preload, which needs it to decode) waits for the
    // first click/tap/key press.
    this._unlockListener = () => this.unlock();
    for (const type of UNLOCK_EVENTS) {
      window.addEventListener(type, this._unlockListener, { capture: true, passive: true });
    }
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

  setPerformanceProfile(profile = {}) {
    this.performanceProfile = {
      ...this.performanceProfile,
      ...profile
    };
  }

  setLowEndMode(enabled) {
    this.performanceProfile = enabled ? { ...LOW_END_PERF_PROFILE } : { ...DEFAULT_PERF_PROFILE };
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

  setMusicVolume(value) {
    this.musicVolume = Math.max(0, Math.min(1, value));
    if (this.phoneSwordAudio) {
      this.phoneSwordAudio.volume = this.musicVolume;
    }
  }

  async preloadCommonSFX() {
    const common = [
      ...this.footsteps,
      ...this.attacks,
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Unsheath 1.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Sheath 1.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 1.ogg',
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Attack 2.ogg',
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Blocked 1.ogg',
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Take Out 1.ogg',
      'SFX/Attacks/Bow Attacks Hits and Blocks/Bow Put Away 1.ogg',
      'SFX/Doors Gates and Chests/Door Open 1.ogg',
      'SFX/Spells/Waterspray 1.ogg',
      'SFX/Torch/Light Torch 1.ogg',
      'SFX/Torch/Torch Attack Strike 1.ogg',
      'SFX/Torch/Torch Loop.ogg',
      'NPC Sounds/friendly_sound_1.ogg',
      'NPC Sounds/friendly_sound_2.ogg',
      'NPC Sounds/friendly_sound_3.ogg',
      'NPC Sounds/friendly_sound_4.ogg',
      'NPC Sounds/zombie_sound_1.ogg',
      'NPC Sounds/zombie_sound_2.ogg',
      'NPC Sounds/merchant_loop.ogg',
      ...this.ouchSounds
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

  pauseBGS() {
    this.background?.pause();
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

  async playSFX(path, volume = 0.7, options = {}) {
    const {
      cooldownKey,
      cooldownMs = 0,
      bypassConcurrencyLimit = false
    } = options;

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
    gainNode.connect(this.sfxGain);

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
  playOuch(kind = 'enemy', cooldownKey = `ouch-${kind}`, volume = 0.5) {
    const index = kind === 'player' ? 1 : kind === 'playerDeath' ? 2 : 0;
    return this.playSFX(this.ouchSounds[index], volume, { cooldownKey, cooldownMs: 150 });
  }

  // Called on every enemy hit (any enemy). Only every 3rd or 4th hit
  // (randomly chosen each cycle) actually cries out with ouch1.
  playEnemyOuch(cooldownKey) {
    this.enemyHurtCount = (this.enemyHurtCount ?? 0) + 1;
    this.enemyOuchAt ??= 3 + Math.floor(Math.random() * 2);
    if (this.enemyHurtCount < this.enemyOuchAt) return null;
    this.enemyHurtCount = 0;
    this.enemyOuchAt = 3 + Math.floor(Math.random() * 2);
    return this.playOuch('enemy', cooldownKey);
  }

  playAttack() {
    const clip = this.attacks[Math.floor(Math.random() * this.attacks.length)];
    this.playSFX(clip, 0.6, {
      cooldownKey: 'attack',
      cooldownMs: this.performanceProfile.attackCooldownMs
    });
  }

  playFootstep() {
    const now = performance.now();
    const minInterval = this.performanceProfile.footstepMinIntervalMs ?? 0;
    if (minInterval > 0 && now - this.lastFootstepAt < minInterval) {
      return;
    }
    this.lastFootstepAt = now;

    const clip = this.footsteps[Math.floor(Math.random() * this.footsteps.length)];
    this.playSFX(clip, 0.4, {
      cooldownKey: 'footstep',
      cooldownMs: this.performanceProfile.footstepCooldownMs
    });
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

  startLoopingSFX(loopId, path, volume = 0.35) {
    if (!loopId || !path) return;
    if (this.loopingSFX.has(loopId)) return;
    this.resumeAudioContext().then(async () => {
      const buffer = await this.loadBuffer(path);
      if (!buffer || !this.context || !this.sfxGain || this.loopingSFX.has(loopId)) {
        return;
      }
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gainNode = this.context.createGain();
      gainNode.gain.value = Math.max(0, Math.min(1, volume));
      source.connect(gainNode);
      gainNode.connect(this.sfxGain);

      this.loopingSFX.set(loopId, { source, gainNode });
      source.start(0);
    });
  }

  stopLoopingSFX(loopId) {
    const entry = this.loopingSFX.get(loopId);
    if (!entry) return;
    try {
      entry.source.stop(0);
    } catch {}
    this.loopingSFX.delete(loopId);
  }

  setLoopingSFXVolume(loopId, volume = 0) {
    const entry = this.loopingSFX.get(loopId);
    if (!entry?.gainNode) return;
    entry.gainNode.gain.value = Math.max(0, Math.min(1, volume));
  }
}
