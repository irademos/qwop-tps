export class AudioManager {
  constructor() {
    this.background = null;
    this.lastFootstep = 0;
    this.footsteps = [
      'SFX/Footsteps/Dirt/Dirt Walk 1.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 2.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 3.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 4.ogg',
      'SFX/Footsteps/Dirt/Dirt Walk 5.ogg'
    ];
    this.attacks = [
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 1.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 2.ogg',
      'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 3.ogg'
    ];
    this.pendingBackground = null;
    this._backgroundUnlockHandler = null;
    this._backgroundUnlockEvents = ['pointerdown', 'touchstart', 'keydown'];
  }

  playBGS(name) {
    if (this.background) {
      this.background.pause();
    }
    this._resetBackgroundUnlock();
    const path = `assets/audio/BGS Loops/${name}`;
    this.background = new Audio(path);
    this.background.loop = true;
    this.background.volume = 0.5;
    const playPromise = this.background.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.then(() => {
        this.pendingBackground = null;
      }).catch((err) => {
        if (this._isAutoplayBlocked(err)) {
          console.info('Background music will start after the first user interaction.');
          this.pendingBackground = this.background;
          this._awaitUserInteractionForBackground();
        } else {
          console.error('BGS play failed', err);
        }
      });
    }
  }

  playSFX(path, volume = 0.7) {
    const audio = new Audio(`assets/audio/${path}`);
    audio.volume = volume;
    audio.play();
    return audio;
  }

  playAttack() {
    const clip = this.attacks[Math.floor(Math.random() * this.attacks.length)];
    this.playSFX(clip, 0.6);
  }

  playFootstep() {
    const now = performance.now();
    if (now - this.lastFootstep < 400) return;
    this.lastFootstep = now;
    const clip = this.footsteps[Math.floor(Math.random() * this.footsteps.length)];
    this.playSFX(clip, 0.4);
  }

  _isAutoplayBlocked(err) {
    if (!err) return false;
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return true;
    return typeof err.message === 'string' && err.message.includes('NotAllowedError');
  }

  _awaitUserInteractionForBackground() {
    if (typeof document === 'undefined' || this._backgroundUnlockHandler) {
      return;
    }
    const handler = () => {
      const pending = this.pendingBackground;
      this._resetBackgroundUnlock();
      if (pending) {
        pending.play().catch(err => console.error('BGS play failed after user interaction', err));
      }
    };
    this._backgroundUnlockHandler = handler;
    const options = { once: true };
    this._backgroundUnlockEvents.forEach(event => {
      document.addEventListener(event, handler, options);
    });
  }

  _resetBackgroundUnlock() {
    if (typeof document !== 'undefined' && this._backgroundUnlockHandler) {
      this._backgroundUnlockEvents.forEach(event => {
        document.removeEventListener(event, this._backgroundUnlockHandler);
      });
    }
    this._backgroundUnlockHandler = null;
    this.pendingBackground = null;
  }
}
