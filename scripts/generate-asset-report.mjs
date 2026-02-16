import { promises as fs } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const distDir = path.resolve('dist');
const reportJsonPath = path.join(distDir, 'asset-report.json');
const reportMarkdownPath = path.join(distDir, 'asset-report.md');

const TARGET_EXTENSIONS = new Set(['.js', '.css', '.json', '.glb']);

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
};

const walk = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      return [fullPath];
    })
  );
  return files.flat();
};

const toRelativeDistPath = (filePath) => path.relative(distDir, filePath).replaceAll('\\\\', '/');

const main = async () => {
  try {
    await fs.access(distDir);
  } catch {
    console.error('dist directory not found. Run `vite build` first.');
    process.exitCode = 1;
    return;
  }

  const allFiles = await walk(distDir);
  const reportEntries = [];

  for (const filePath of allFiles) {
    const extension = path.extname(filePath).toLowerCase();
    if (!TARGET_EXTENSIONS.has(extension)) continue;

    const buffer = await fs.readFile(filePath);
    reportEntries.push({
      file: toRelativeDistPath(filePath),
      extension,
      rawBytes: buffer.length,
      gzipBytes: gzipSync(buffer, { level: 9 }).length,
      brotliBytes: brotliCompressSync(buffer).length
    });
  }

  reportEntries.sort((a, b) => b.rawBytes - a.rawBytes);

  const totals = reportEntries.reduce(
    (acc, entry) => {
      acc.rawBytes += entry.rawBytes;
      acc.gzipBytes += entry.gzipBytes;
      acc.brotliBytes += entry.brotliBytes;
      return acc;
    },
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 }
  );

  const report = {
    generatedAt: new Date().toISOString(),
    files: reportEntries,
    totals
  };

  const markdownLines = [
    '# Build Asset Report',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    `Total tracked files: ${reportEntries.length}`,
    `- Raw: ${formatBytes(totals.rawBytes)}`,
    `- Gzip: ${formatBytes(totals.gzipBytes)}`,
    `- Brotli: ${formatBytes(totals.brotliBytes)}`,
    '',
    '| File | Raw | Gzip | Brotli |',
    '| --- | ---: | ---: | ---: |'
  ];

  for (const entry of reportEntries) {
    markdownLines.push(
      `| ${entry.file} | ${formatBytes(entry.rawBytes)} | ${formatBytes(entry.gzipBytes)} | ${formatBytes(entry.brotliBytes)} |`
    );
  }

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(reportMarkdownPath, `${markdownLines.join('\n')}\n`, 'utf8');

  console.log(`Asset report written: ${path.relative(process.cwd(), reportJsonPath)}`);
  console.log(`Asset report written: ${path.relative(process.cwd(), reportMarkdownPath)}`);
};

await main();
