import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'frontend');
const outDir = path.join(repoRoot, 'dist');

const apiBase = (process.env.NORTHSTAR_API_BASE || '').trim();

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
      continue;
    }

    await fs.copyFile(srcPath, destPath);
  }
}

await fs.rm(outDir, { recursive: true, force: true });
await copyDir(srcDir, outDir);

// Overwrite runtime config in the deploy output.
// If NORTHSTAR_API_BASE isn't provided, keep the local default.
if (apiBase) {
  const configPath = path.join(outDir, 'utils', 'config.js');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const config = `window.__NORTHSTAR_CONFIG__ = window.__NORTHSTAR_CONFIG__ || {};\nwindow.__NORTHSTAR_CONFIG__.API_BASE = ${JSON.stringify(apiBase)};\n`;
  await fs.writeFile(configPath, config, 'utf8');
}

console.log('[build:vercel] Built static site to', outDir);
if (apiBase) console.log('[build:vercel] NORTHSTAR_API_BASE =', apiBase);
