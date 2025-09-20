# furnitureSnapHUD integration notes

- Status: features/furnitureSnapHUD.js is present and ready.
- No additional project files are required to wire it: app.js already lazy-imports
  `./features/furnitureSnapHUD.js` and initializes the HUD when the furniture
  rotation snap controller is created.

How to verify locally:
- Start a simple static server and open http://localhost:8000
  ```bash
  python3 -m http.server 8000
  ```

Optional follow-ups you may add to the repo (not required):
- tests/features/furnitureSnapHUD.test.js — small DOM test to assert HUD shows angle.
- docs/ui.md — document scoped HUD classes for design/system.
- accessibility: a small ARIA/live region for announcing angle changes.
