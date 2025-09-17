Status: companionOrb module added and wired

- No additional files need to be added.
- app.js already lazy-loads ./features/companionOrb.js and inserts a "Companion" toggle button into the Actions sheet.
- The module exports createCompanionOrb(THREE, { scene, playerModel, audioManager }) and matches the usage in app.js.
- UX guardrails respected: toggle is inside the Actions sheet (no extra persistent buttons).

If you'd like, I can:
- Add a tiny unit/integration test for the factory (new file).
- Add a small README update or changelog entry (edit README.md).

Recommended commit message:
feat: add companion orb module and wire lazy-loaded toggle
