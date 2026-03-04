#!/usr/bin/env bun
/**
 * docs-export.ts
 * Fully automated C4 diagram pipeline:
 *   1. Structurizr CLI: workspace.dsl → .puml files
 *   2. PlantUML Docker: .puml files → .svg files
 *   3. Copy & rename SVGs → apps/web/public/docs/c4/
 *
 * Run: bun run docs:export
 * Requires: Docker
 */

import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DSL_DIR = join(ROOT, 'docs', 'c4');
const EXPORT_DIR = join(DSL_DIR, '.export_tmp');
const DEST_DIR = join(ROOT, 'apps', 'web', 'public', 'docs', 'c4');

async function cleanExportDir() {
  // The temp folder is created by Docker containers running as root.
  // rmSync lacks permission to delete it, so we use a Docker container to clean it.
  await run('docker', [
    'run', '--rm',
    '-v', `${DSL_DIR}:/workspace`,
    'alpine',
    'sh', '-c', 'rm -rf /workspace/.export_tmp',
  ]).catch(() => {}); // ignore if it doesn't exist
}

// Mapping: Structurizr view key → destination filename
const SVG_MAP: Record<string, string> = {
  'structurizr-Context.svg':      '01_context.svg',
  'structurizr-Containers.svg':   '02_container.svg',
  'structurizr-APIComponents.svg': '03_component_api.svg',
  'structurizr-SPAComponents.svg': '04_component_spa.svg',
};

async function run(cmd: string, args: string[]): Promise<void> {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  const proc = Bun.spawn([cmd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  if (exitCode !== 0) {
    console.error(stderr);
    throw new Error(`Command failed with exit code ${exitCode}`);
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────
console.log('\n🔧 Preparing export directories...');
await cleanExportDir();
mkdirSync(DEST_DIR, { recursive: true });

// ── Step 1: Export .puml from workspace.dsl ────────────────────────────────
console.log('\n📐 Step 1: Structurizr CLI → PlantUML (.puml)');
await run('docker', [
  'run', '--rm',
  '-v', `${DSL_DIR}:/workspace`,
  '-v', `${EXPORT_DIR}:/export`,
  'structurizr/cli',
  'export',
  '-workspace', '/workspace/workspace.dsl',
  '-format', 'plantuml',
  '-output', '/export',
]);

// ── Step 2: Convert .puml → .svg using PlantUML ───────────────────────────
console.log('\n🎨 Step 2: PlantUML → SVG');

const diagramNames = Object.keys(SVG_MAP).map(n => n.replace('.svg', '.puml'));
for (const pumlFile of diagramNames) {
  const pumlPath = join(EXPORT_DIR, pumlFile);
  if (!existsSync(pumlPath)) {
    console.warn(`  ⚠️  ${pumlFile} not found — skipping`);
    continue;
  }
  await run('docker', [
    'run', '--rm',
    '-v', `${EXPORT_DIR}:/work`,
    'plantuml/plantuml:latest',
    '-tsvg',
    `/work/${pumlFile}`,
  ]);
}

// ── Step 3: Rename & copy SVGs into the frontend ──────────────────────────
console.log('\n📁 Step 3: Copy SVGs → apps/web/public/docs/c4/');

let copied = 0;
for (const [src, dest] of Object.entries(SVG_MAP)) {
  const srcPath = join(EXPORT_DIR, src);
  const destPath = join(DEST_DIR, dest);
  if (!existsSync(srcPath)) {
    console.warn(`  ⚠️  ${src} not found — skipping`);
    continue;
  }
  copyFileSync(srcPath, destPath);
  console.log(`  ✅ ${src} → public/docs/c4/${dest}`);
  copied++;
}

// ── Cleanup ────────────────────────────────────────────────────────────────
console.log('\n🧹 Cleaning up temp folder...');
await cleanExportDir();

console.log(`\n✨ Done — ${copied}/4 diagrams exported to apps/web/public/docs/c4/\n`);
if (copied < 4) process.exit(1);
