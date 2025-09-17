Changes introduced
- Added a lightweight "ready beacon" (effects/readyBeacon.js): a small pulsing orb that follows the player and is lazy-loaded by the main entry.
- The beacon is initialized exactly once after playerModel is ready and updates each frame.
- No new persistent UI buttons were added (complies with mobile-first guardrails); the feature is visual and non-intrusive.

How to verify
1) Start a simple HTTP server at project root and open the site.
2) The beacon appears as a small pulsing orb above the player once the scene loads.

Suggested quick commands
```bash
python3 -m http.server 8000
xdg-open http://localhost:8000
```
