features/birdNPC.js has been added. Suggested additional files you may want to add
to make the bird feature fully verifiable and optionally richer:

- assets/audio/ambient/bird_chirp.ogg
  - Short chirp sound played occasionally by the bird. Place under
    assets/audio/ambient/ to match audioManager.playSFX() calls.

- (optional) assets/textures/bird_sprite.png
  - Small sprite used for billboards or UI diagnostics if you prefer 2D visuals.

- (optional) tests/features/birdNPC.test.js
  - Lightweight unit test that imports createBirdNPC and verifies the returned
    API (setActive/update/dispose) and that update() is a no-op when inactive.

- (optional) docs/birdNPC_usage.md
  - Small usage notes for designers: how to tune radius/speed/footer notes.

Notes:
- No changes to app.js are required: app.js already lazy-loads and initializes
  features/birdNPC.js (initBirdNPC), so the bird will appear without adding UI.
- If you want chirps audible locally, add the bird_chirp.ogg asset at the path
  above. If the asset is missing the code already guards against errors.

If you'd like, I can:
- Add a placeholder test file (tests/features/birdNPC.test.js).
- Add a tiny no-op .ogg placeholder text file to avoid missing-asset logs.
- Patch app.js to make bird activation configurable from settings (no UI change).

Tell me which of the optional items you want created and I will add them.
