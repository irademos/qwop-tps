Summary
-------

features/lanternLightPuddles.js has been added and implements a
lazy-loadable controller that spawns soft ground "light puddles" under
lanterns. No additional code changes are required: app.js already
contains a lazy dynamic-import and initialization (initLanternLightPuddles)
that wires this module exactly once after the scene is ready.

Files you added (present / OK)
- features/lanternLightPuddles.js
- app.js (already imports the module via dynamic import)

No other files required
-----------------------
You do NOT need to add or modify other files to make the puddles visible.
The existing code path in app.js:

  const mod = await import('./features/lanternLightPuddles.js');
  lanternLightPuddlesController = mod.initLanternLightPuddles(THREE, {
    scene,
    lanternController: lanternMinigameController,
    dynamicWind: typeof dynamicWind !== 'undefined' ? dynamicWind : window.dynamicWind
  });

will initialize the system exactly once. The module is conservative:
- it looks for lanterns exposed by lanternController.lanterns,
- or scene objects named / userData flagged as lanterns,
so it will create puddles whenever lanterns are present.

How to verify locally
---------------------
Start a simple static server from your project root and open http://localhost:8000:

```bash
python3 -m http.server 8000
```

Or (alternative):

```bash
npx http-server -p 8080
```

Then open the page, load the scene, and trigger/observe lantern releases (e.g. the lantern minigame or spawn lantern objects).
Inspect window.lanternLightPuddlesController (dev console) to confirm presence and call update/setActive/destroy.

Notes / Next steps suggestions (optional)
- If lanterns are created by a heavy lazy module, ensure the lantern controller exposes a lanterns[] array or userData markers so puddles attach reliably.
- Consider exposing a debug flag to temporarily render puddle bounds for tuning.
- If you want, I can add a tiny automated smoke-test that spawns a temporary lantern at runtime to immediately verify puddles are created (no UI added). Ask and I'll provide a small patch.
