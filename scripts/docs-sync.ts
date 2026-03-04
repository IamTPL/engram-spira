#!/usr/bin/env bun
/**
 * docs-sync.ts
 * Copies documentation source files into apps/web/public/docs/
 * so Vite can serve them as static assets.
 *
 * Run: bun run docs:sync
 */

import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

interface SyncEntry {
  src: string;
  dest: string;
}

const FILES: SyncEntry[] = [
  {
    src: 'docs/srs/srs.md',
    dest: 'apps/web/public/docs/srs/srs.md',
  },
  // Add more doc files here as needed, e.g.:
  // { src: 'docs/architecture/adr.md', dest: 'apps/web/public/docs/adr/adr.md' },
];

let ok = 0;
let fail = 0;

for (const { src, dest } of FILES) {
  const srcPath = resolve(ROOT, src);
  const destPath = resolve(ROOT, dest);

  const srcFile = Bun.file(srcPath);
  if (!(await srcFile.exists())) {
    console.error(`  ❌ Source not found: ${src}`);
    fail++;
    continue;
  }

  mkdirSync(dirname(destPath), { recursive: true });
  await Bun.write(destPath, srcFile);
  console.log(`  ✅ Synced: ${src} → ${dest}`);
  ok++;
}

console.log(`\ndocs:sync complete — ${ok} file(s) synced, ${fail} error(s).`);
if (fail > 0) process.exit(1);
