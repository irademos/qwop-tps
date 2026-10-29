import { AudioManager } from '../audio/audioManager.js';

export function createAudioManager(options = {}) {
  return new AudioManager(options);
}
