feat: add renderer info badge overlay showing GPU and draw call/triangle counts.
feat: auto-pause gameplay on tab blur/hidden with a small on-screen badge indicator.
feat: add ground click ripple visual effect (click/tap to see expanding ring)
feat: add Pause/Resume UI button with overlay; freezes physics/animation and resumes cleanly.
feat: improve rendering quality and responsiveness (setPixelRatio + window resize handling).
feat: add live ping display in Settings overlay with periodic RTT measurement between peers.
feat: add in-game FPS overlay (bottom-right) for immediate performance visibility.
feat: add in-game Controls Help overlay ("? Help" button) with scoped styles, initialized once from app.js.
feat: add subtle ground grid helper for immediate world orientation.
feat: add in-game screenshot button (📸) to action bar; downloads a PNG of the current frame
feat: add Day/Night toggle button (🌗) to switch scene lighting and sky.
fix: initialize day/night toggle after lights are created to avoid undefined references and ensure it works on load.
feat: add on-screen compass HUD showing camera heading (top-center).
feat: add position/heading HUD (bottom-left), updates each frame.
feat: add K hotkey to instantly download a screenshot of the current view.
feat: add fullscreen toggle button to action bar (enter/exit fullscreen).
feat: add live connection indicator (peers count and average ping) to HUD, initialized from app.js after scene setup.
- feat: Add Settings toggle to switch renderer pixel ratio (Performance mode 1x vs device), persisted via cookie.
- feat: add in-game Health HUD percentage label with low-health pulse.
- feat: add in-game minimap overlay displaying player, peers, and monster.
- feat: add in-game FOV slider in Settings overlay; persisted to cookie and updates camera live.
- feat: add scoped in-game toast notifications (welcome banner) initialized from app.js after scene setup.
feat: add on-screen HUD version badge (top-left) showing app version.
feat: add click-driven confetti bursts (tap/click to spawn colorful falling pieces), initialized in app.js.
feat: add in-game Session Timer HUD (bottom-right) that pauses with the game.
feat: ESC key toggles Pause overlay (and toast), pausing controls and session timer.
feat: add "Copy Position" button in Settings to copy current coordinates to clipboard.
feat: add in-game Quick Actions bar (Box spawn + Burst toggle).
feat: dynamic browser title shows player name, peers, and live ping.
