Suggested additions (optional)
- assets/audio/ambient/bird_chirp.ogg
  Reason: short chirp SFX used by features/birdNPC.js when audioManager.playSFX is available.
- assets/audio/ambient/bird_flap.ogg
  Reason: optional wing-flap SFX for richer feedback.
- assets/models/bird_simple.glb
  Reason: higher-fidelity bird model (GLB) to replace procedural mesh if desired.
- features/birdFlocking.js
  Reason: future module to add flocking / group behaviour (code-split and lazy-load).
- features/birdPerch.js
  Reason: optional perch & interaction system so birds can land on world objects.

Notes:
- None of these files are required for the current bird NPC to function; the NPC uses a simple procedural mesh and will work without extra assets.
- If you add audio files, place them under assets/audio/... so AudioManager.playSFX('ambient/bird_chirp.ogg') resolves correctly.
