#!/usr/bin/env node
// Shrinks the Mixamo clip library (public/models/animations/animations.glb, exported from
// Blender — one action per clip, each on its own armature):
//   - resample: drops keyframes that the ones either side of them already give (Mixamo bakes
//     every bone on every frame)
//   - prune: drops unused data, keeping the leaf bones (HeadTop_End…) and the skins — the
//     armatures have no meshes, so a plain prune drops their skins, and without one three's
//     GLTFLoader doesn't make the joints Bones: the clip loader then finds no bones (T-pose)
//   - meshopt: compresses the keyframes (EXT_meshopt_compression, rotations quantized —
//     fluffyCharacter.ts' loader sets the MeshoptDecoder). Not gltf-transform's meshopt(): its
//     reorder / quantize steps prune with the defaults afterwards, dropping the skins too
// Action names, bone names and armatures are kept as they are, so the loader finds the clips
// the same way.
//
// Usage (run it after every Blender export; in place unless -o is given):
//   npm run optimize:animations
//   node scripts/optimize-animations.mjs in.glb -o out.glb

import fs from 'node:fs';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { NodeIO, Logger, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { resample, prune, quantize } from '@gltf-transform/functions';

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
const root = doc.getRoot();
const names = root.listAnimations().map(a => a.getName());
const skins = root.listSkins().length;
const pruneTypes = Object.values(PropertyType).filter(t => t !== PropertyType.SKIN && t !== PropertyType.NODE);
await doc.transform(
  resample({ cleanup: false }),
  prune({ propertyTypes: pruneTypes, keepLeaves: true, keepAttributes: true }),
  quantize({ cleanup: false }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
const after = root.listAnimations().map(a => a.getName());
if (after.join('|') !== names.join('|')) throw new Error('animations changed: ' + after.join(', '));
if (root.listSkins().length !== skins) throw new Error(`skins dropped: ${skins} → ${root.listSkins().length}`);
await io.write(target, doc);
const size = fs.statSync(target).size;
console.log(`${input} → ${target}: ${(before / 1024).toFixed(0)} KB → ${(size / 1024).toFixed(0)} KB`);
console.log('clips:', names.join(', '));
