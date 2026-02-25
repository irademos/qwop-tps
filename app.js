import { bootstrapGameApp } from './app/bootstrapGameApp.js';

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await bootstrapGameApp();
  } catch (error) {
    console.error('Fatal error while bootstrapping game app:', error);
  }
});
