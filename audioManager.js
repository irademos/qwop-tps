const DEFAULT_PERF_PROFILE = {
  maxConcurrentSFX: 12,
  footstepCooldownMs: 220,
  attackCooldownMs: 120,
  preloadCommonSFX: true
};

const LOW_END_PERF_PROFILE = {
  maxConcurrentSFX: 5,
  footstepCooldownMs: 320,
  attackCooldownMs: 180,
  preloadCommonSFX: true
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
    this.attacks = [
      'SFX/Chopping and Mining/chop 3.ogg',
      'SFX/Chopping and Mining/mine 3.ogg',
      'SFX/Chopping and Mining/mine 5.ogg',
      'SFX/Spells/Spell Impact 3.ogg'
    ];

    this.bufferCache = new Map();
    this.pendingLoads = new Map();
    this.soundCooldowns = new Map();
    this.activeSFXNodes = new Set();

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
    this.sfxVolume = options.sfxVolume ?? 0.8;

    if (this.performanceProfile.preloadCommonSFX) {
      this.preloadCommonSFX();
    }
  }

  ensureAudioContext() {
    if (this.context) return;
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
  }

  setSFXVolume(value) {
    this.sfxVolume = Math.max(0, Math.min(1, value));
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.sfxVolume;
    }
  }

  async preloadCommonSFX() {
    const common = [...this.footsteps, ...this.attacks];
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

  playBGS(name) {
    const path = `assets/audio/BGS Loops/${name}`;

    if (!this.background) {
      this.background = new Audio(path);
      this.background.loop = true;
      this.background.volume = 0.5;
    } else {
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

  playAttack() {
    const clip = this.attacks[Math.floor(Math.random() * this.attacks.length)];
    this.playSFX(clip, 0.6, {
      cooldownKey: 'attack',
      cooldownMs: this.performanceProfile.attackCooldownMs
    });
  }

  playFootstep() {
    const clip = this.footsteps[Math.floor(Math.random() * this.footsteps.length)];
    this.playSFX(clip, 0.4, {
      cooldownKey: 'footstep',
      cooldownMs: this.performanceProfile.footstepCooldownMs
    });
  }
}
