#!/usr/bin/env bun
/**
 * erd-export.ts
 * Exports the Mermaid ERD diagram to SVG using the Kroki API.
 * No local Chrome or Docker required — uses the public Kroki.io rendering service.
 *
 * Run: bun run docs:erd
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const ERD_DIR = join(ROOT, 'docs', 'erd');
const ERD_SOURCE = join(ERD_DIR, 'erd.mmd');
const ERD_OUTPUT = join(ERD_DIR, 'erd.svg');
const DEST_DIR = join(ROOT, 'apps', 'web', 'public', 'docs', 'erd');
const DEST_FILE = join(DEST_DIR, 'erd.svg');

if (!existsSync(ERD_SOURCE)) {
  console.error(`❌ ERD source not found: ${ERD_SOURCE}`);
  process.exit(1);
}

console.log('\n🔧 Exporting ERD diagram via Kroki API...');

const mermaidSource = readFileSync(ERD_SOURCE, 'utf-8');

// Kroki accepts POST with JSON body
const response = await fetch('https://kroki.io/mermaid/svg', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: mermaidSource,
});

if (!response.ok) {
  const err = await response.text();
  console.error(`❌ Kroki API error (${response.status}): ${err}`);
  process.exit(1);
}

const svg = await response.text();
writeFileSync(ERD_OUTPUT, svg, 'utf-8');
console.log(`  ✅ Generated: docs/erd/erd.svg`);

console.log('\n📁 Copying SVG to frontend public directory...');
mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(ERD_OUTPUT, DEST_FILE);
console.log(`  ✅ erd.svg → public/docs/erd/erd.svg`);

console.log('\n✨ ERD export complete!\n');
