#!/usr/bin/env node
// generate-diagrams.mjs
//
// Deterministic Excalidraw diagram generator for foundry-capital-markets-router.
//
//   node generate-diagrams.mjs [--out <dir>] [--check]
//
//   --out <dir>   Output directory. Default: docs/diagrams
//   --check       Regenerate into memory and exit non-zero if the on-disk files
//                 differ. Lets CI assert the diagrams are in sync with this
//                 generator; the diagrams are source-controlled artefacts, not
//                 hand-edited drawings.
//
// Node built-ins only. No network. Byte-for-byte reproducible: all "random"
// element fields come from a counter-based PRNG with a fixed seed and `updated`
// is the constant 1, so re-running never produces a spurious diff.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DIAGRAMS } from './diagrams.mjs';

function parseArgs(argv) {
  const args = { out: 'docs/diagrams', check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--out requires a directory argument');
      }
      args.out = value;
      i += 1;
    } else if (a === '--check') {
      args.check = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

const USAGE = `Usage: node generate-diagrams.mjs [--out <dir>] [--check]

  --out <dir>   Output directory (default: docs/diagrams)
  --check       Verify on-disk files match the generator; exit 1 if not
  -h, --help    Show this message
`;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function render() {
  return DIAGRAMS.map(({ file, build }) => {
    const scene = build();
    const json = scene.toJSON();
    const b = scene.bounds();
    return {
      file,
      json,
      elementCount: scene.elements.length,
      bounds: b,
      hash: sha256(json),
    };
  });
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const outDir = resolve(process.cwd(), args.out);
  const rendered = render();

  if (args.check) {
    let drift = 0;
    for (const d of rendered) {
      const path = join(outDir, d.file);
      if (!existsSync(path)) {
        process.stderr.write(`MISSING  ${path}\n`);
        drift += 1;
        continue;
      }
      const onDisk = readFileSync(path, 'utf8');
      if (onDisk === d.json) {
        process.stdout.write(`ok       ${d.file}  ${d.hash.slice(0, 16)}\n`);
      } else {
        process.stderr.write(
          `DRIFT    ${d.file}\n  on disk:   ${sha256(onDisk)}\n  generated: ${d.hash}\n`,
        );
        drift += 1;
      }
    }
    if (drift > 0) {
      process.stderr.write(
        `\n${drift} diagram(s) out of sync. Re-run: node generate-diagrams.mjs --out ${args.out}\n`,
      );
      process.exit(1);
    }
    process.stdout.write('\nAll diagrams are in sync with the generator.\n');
    return;
  }

  mkdirSync(outDir, { recursive: true });
  for (const d of rendered) {
    writeFileSync(join(outDir, d.file), d.json, 'utf8');
    const { width, height, minX, minY } = d.bounds;
    process.stdout.write(
      `wrote ${d.file.padEnd(34)} ${String(d.elementCount).padStart(4)} elements  ` +
        `canvas ${Math.round(width)}x${Math.round(height)} ` +
        `(origin ${Math.round(minX)},${Math.round(minY)})  ${d.hash.slice(0, 16)}\n`,
    );
  }
  process.stdout.write(`\n${rendered.length} diagrams written to ${outDir}\n`);
}

main();
