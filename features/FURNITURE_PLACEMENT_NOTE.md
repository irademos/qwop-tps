No additional files are required to wire up features/furniturePlacement.js.

Reason:
- app.js already lazy-loads and initializes ./features/furniturePlacement.js once the scene and playerModel are ready.
- The furniture placement module is self-contained and uses keyboard controls (P/L/R/F); no UI buttons were added per UX guardrails.

If you want changes (e.g. enable/disable by default, update toasts, or update ai_meta/readme), please add the specific files you want edited to the chat (for example: ai_meta/next_run.md, ai_meta/log.md, README.md, or app.js).
