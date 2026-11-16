#!/usr/bin/env node
// Shrinks a map editor .mappack (or loose .glb files) for phones:
//   - textures: resized to at most --texture-size (default 512) and re-encoded as WebP
//     (EXT_texture_webp — three's GLTFLoader reads it natively; still plain images, so the
//     load-time art-style pass in src/environment/artStyle.js keeps working on them)
//   - geometry: dedup / prune / weld, then meshopt compression with quantization
//     (EXT_meshopt_compression — MapLoader.ts sets the MeshoptDecoder)
//   - no polygon simplification: the models are already low poly, and it would spoil their look
// Everything else in the pack (map.json, terrain.bin, the KTX2 terrain textures…) is copied as is.
//
// Usage:
//   node scripts/optimize-mappack.mjs public/mappacks/island_town.mappack            # in place
//   node scripts/optimize-mappack.mjs in.mappack -o out.mappack --texture-size 1024
//   node scripts/optimize-mappack.mjs some/folder/of/glbs -o optimized/              # loose GLBs
// Run it on a pack every time it is exported from the editor. Optimizing an already optimized
// pack is harmless (it is skipped per model when it wouldn't get smaller).

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, resample, textureCompress, meshopt, unpartition } from '@gltf-transform/functions';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const out = opt('-o', null);
const textureSize = Number(opt('--texture-size', 512));
const quality = Number(opt('--quality', 85));
const input = args[0];
if (!input) {
  console.error('usage: node scripts/optimize-mappack.mjs <pack.mappack | folder> [-o out] [--texture-size 512] [--quality 85]');
  process.exit(1);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function optimizeGlb(bytes) {
  const doc = await io.readBinary(new Uint8Array(bytes));
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    resample(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [textureSize, textureSize],
      quality,
    }),
    unpartition(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  return Buffer.from(await io.writeBinary(doc));
}

async function optimizeEntry(name, bytes) {
  try {
    const smaller = await optimizeGlb(bytes);
    if (smaller.length >= bytes.length) return { bytes, note: 'kept (no gain)' };
    return { bytes: smaller, note: `${kb(bytes.length)} → ${kb(smaller.length)}` };
  } catch (err) {
    return { bytes, note: `kept (failed: ${err.message})` };
  }
}

const stat = fs.statSync(input);
if (stat.isDirectory()) {
  const dest = out || input;
  fs.mkdirSync(dest, { recursive: true });
  let before = 0, after = 0;
  for (const f of fs.readdirSync(input).filter((f) => f.toLowerCase().endsWith('.glb'))) {
    const bytes = fs.readFileSync(path.join(input, f));
    const r = await optimizeEntry(f, bytes);
    fs.writeFileSync(path.join(dest, f), r.bytes);
    before += bytes.length; after += r.bytes.length;
    console.log(`  ${f}: ${r.note}`);
  }
  console.log(`GLBs: ${kb(before)} → ${kb(after)}`);
} else {
  const srcBuf = fs.readFileSync(input);
  const zip = await JSZip.loadAsync(srcBuf);
  const outZip = new JSZip();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) { outZip.folder(name); continue; }
    let bytes = await entry.async('nodebuffer');
    if (name.toLowerCase().endsWith('.glb')) {
      const r = await optimizeEntry(name, bytes);
      bytes = r.bytes;
      console.log(`  ${name}: ${r.note}`);
    }
    // the editor's runtime copy isn't read by the game; keep it so the pack round-trips
    outZip.file(name, bytes, { date: entry.date });
  }
  const outBuf = await outZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  const dest = out || input;
  fs.writeFileSync(dest, outBuf);
  console.log(`${path.basename(input)}: ${kb(srcBuf.length)} → ${kb(outBuf.length)} (${dest})`);
}
