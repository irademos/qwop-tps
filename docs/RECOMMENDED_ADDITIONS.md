# Recommended files to add (optional)

Short answer: No additional files are required for the ambient sounds feature you added.
- ui/ambientSounds.js (present)
- audioManager.js (present)
- styles.css (present)
- app.js already dynamically imports and wires the ambient toggle.

Optional additions (only if you want tweaks or extra polish):
- README.md — add a one-line changelog entry if you want the feature recorded.
- assets/audio/ambient/birds_loop.ogg — ensure the audio asset exists at this path or adjust ui/ambientSounds.js to the actual filename.
- app.js — if you want UI label/ARIA tweaks for the Actions sheet or a "tap to enable audio" hint to improve reliability on mobile.
- audioManager.js — add a stopBGS() helper to provide a clear API to stop background music centrally (not required for the current ambient controller).

If you'd like, I can:
- Add a scoped CSS rule for the ambient toggle in styles.css to better match your Actions sheet.
- Implement stopBGS() in audioManager.js and wire it from ui/ambientSounds.js.
- Update README.md with a one-line changelog and a commit message suggestion.

Tell me which (if any) optional edits you want and I'll produce precise SEARCH/REPLACE edits.
