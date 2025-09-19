Integration note: furnitureRotationHotkeys

- The file features/furnitureRotationHotkeys.js is sufficient as provided.
- No additional files are required to integrate it: app.js already lazy-loads and initializes
  the hotkeys during the furniture placement preview flow (it imports
  ./features/furnitureRotationHotkeys.js and calls initFurnitureRotationHotkeys).
- Optional additions (not required):
  - If you want explicit unit tests or stories, add tests/ or stories/ entries.
  - If you want a small debug UI for toggling the hotkeys, add a lightweight UI module
    (but per UX guardrails we avoid adding permanent buttons).
  
How to verify quickly:
- Run the app in the browser, open the furniture placement preview (P) and press [ and ] to rotate,
  press K to cycle modes. Console/toasts will show the active mode.
