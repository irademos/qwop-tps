# Maintainer Notes — Wandering Deer Toggle

- What I changed:
  - Added a lazy-loaded "Wandering Deer" toggle button into the existing Actions sheet.
  - The toggle imports ./features/wanderingDeer.js only when first enabled (code-splitting).
  - The change is initialized exactly once inside app.js after scene and playerModel are ready.

- UX guardrails:
  - No new persistent buttons were added — the feature lives inside the Actions sheet (mobile-first).
  - The Actions button (⋯) remains the single visible floating action on small screens.

- Files modified:
  - app.js (added lazy-loaded deer toggle)
  - README.md (one-line changelog)
  - github.sha (updated commit message)

- How to verify locally:
  1. Serve the project root and open in a browser.
  2. Open the Actions (⋯) sheet and click "Deer" to lazy-load and toggle wandering deer ambient.

- Suggested quick test command:
  - python3 -m http.server 8000

- Commit message:
  feat: ambient: add wandering deer toggle
