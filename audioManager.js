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
  }

  playBGS(name) {
    if (this.background) {
      this.background.pause();
    }
    const path = `assets/audio/BGS Loops/${name}`;
    this.background = new Audio(path);
    this.background.loop = true;
    this.background.volume = 0.5;
    this.background.play().catch(err => console.error('BGS play failed', err));
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
}
