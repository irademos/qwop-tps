# Terrain stamping regression checklist

This checklist targets regressions introduced by terrain stamping around roads/buildings and slope transitions.

## Deterministic repro scene

Use the built-in repro helper to jump to a deterministic seed + location with mixed roads/buildings on varied hills:

```js
window.loadTerrainStampRegressionScene();
```

This does the following:
- Forces terrain seed: `terrain-stamp-regression-v1`
- Sets debug location to `lat=37.7749, lon=-122.4194`
- Enables terrain stamp debug overlay + heatmap

## Debug instrumentation

Enable / control the terrain stamping debug HUD:

```js
window.setTerrainStampDebugOverlay(true, {
  showHeatmap: true,
  sampleRadiusMeters: 10,
  sampleSpacingMeters: 2,
  sampleStepMeters: 0.5
});
```

HUD fields:
- **sampled groundY**: stamped height at player XY
- **slope angle**: local terrain slope from neighboring samples
- **influence**: normalized stamp influence at sample point
- **strongest stamp**: dominant stamp id/type/priority/influence

Heatmap colors:
- Blue = low stamp influence
- Red = high stamp influence

## Expected tolerances

Use these thresholds when validating:

- **Player vertical jitter** on walk/run over stamped transitions: `<= 0.08m peak-to-peak`
- **Player sink depth** below stamped terrain while grounded: `<= 0.04m`
- **Monster sink depth** while pathing over transition edges: `<= 0.06m`
- **Bomb ground placement error** on slopes at detonation frame: `<= 0.10m`
- **Arrow stick/drop placement error** on slopes: `<= 0.10m`
- **Allowed slope** for stable walk/chase behavior: `<= 32°` (warn above)

## Manual validation checklist

### 1) Player walk/jump across flat → falloff → unstamped terrain
- [ ] Start from stamped road/building-adjacent flat ground.
- [ ] Walk across falloff edge into unstamped terrain.
- [ ] Repeat while sprinting and while jump-landing at the edge.
- [ ] Verify no snapping, pogo jitter, or visible foot sink beyond tolerance.

### 2) Monster chase across falloff zones
- [ ] Pull one monster aggro and kite across stamped falloff transitions.
- [ ] Repeat at multiple approach angles (parallel and perpendicular to road/building edge).
- [ ] Verify monster capsule stays grounded and doesn't tunnel/sink.

### 3) Bomb detonation on sloped ground
- [ ] Throw bomb to land and detonate on mild slope (~10-20°).
- [ ] Repeat on steeper slope (~20-32°).
- [ ] Verify visual detonation origin and damage area sit on ground (no deep embed / floating).

### 4) Arrow stick/drop behavior on slopes
- [ ] Fire arrows into slope surfaces at shallow and steep approach angles.
- [ ] Confirm stick orientation follows surface and drop behavior remains terrain-aligned.
- [ ] Verify no sudden teleport or clipping beneath stamped terrain.

### 5) Spawn/drop placement around road/building edges
- [ ] Place/drop items near road shoulders and building polygon boundaries.
- [ ] Validate spawn Y resolves to stamped surface and remains stable after physics settle.
- [ ] Spot-check apples/loot around transition edges for sink/floating.

## Quick scripted spot checks (console)

```js
// Sample current player point
(() => {
  const p = window.player?.position;
  if (!p || !window.getTerrainStampDebugSample) return null;
  return window.getTerrainStampDebugSample(p.x, p.z, { sampleStepMeters: 0.5 });
})();
```

```js
// Toggle overlay quickly
window.setTerrainStampDebugOverlay(false);
window.setTerrainStampDebugOverlay(true, { showHeatmap: true });
```
