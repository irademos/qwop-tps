#!/usr/bin/env node
// Shrinks the Mixamo clip library (public/models/animations/animations.glb, exported from
// Blender — one action per clip, each on its own armature):
//   - resample: drops keyframes that the ones either side of them already give (Mixamo bakes
//     every bone on every frame)
//   - prune: drops unused data, keeping the leaf bones (HeadTop_End…)
//   - meshopt: compresses the keyframes (EXT_meshopt_compression, rotations quantized —
//     fluffyCharacter.ts' loader sets the MeshoptDecoder)
// Action names, bone names and armatures are kept as they are, so the loader finds the clips
// the same way.
//
// Usage (run it after every Blender export; in place unless -o is given):
//   npm run optimize:animations
//   node scripts/optimize-animations.mjs in.glb -o out.glb

import fs from 'node:fs';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, meshopt } from '@gltf-transform/functions';

const args = process.argv.slice(2);
const oi = args.indexOf('-o');
const out = oi >= 0 ? args.splice(oi, 2)[1] : null;
const input = args[0] || 'public/models/animations/animations.glb';
const target = out || input;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const before = fs.statSync(input).size;
const doc = await io.read(input);
doc.setLogger(new Logger(Logger.Verbosity.ERROR));
const names = doc.getRoot().listAnimations().map(a => a.getName());
await doc.transform(
  resample(),
  prune({ keepLeaves: true, keepAttributes: true }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
const after = doc.getRoot().listAnimations().map(a => a.getName());
if (after.join('|') !== names.join('|')) throw new Error('animations changed: ' + after.join(', '));
await io.write(target, doc);
const size = fs.statSync(target).size;
console.log(`${input} → ${target}: ${(before / 1024).toFixed(0)} KB → ${(size / 1024).toFixed(0)} KB`);
console.log('clips:', names.join(', '));
