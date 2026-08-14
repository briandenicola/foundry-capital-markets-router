#!/usr/bin/env node
// Generates TypeScript types for the web UI from the C# decision library.
//
// The UI's types are generated rather than hand-written because hand-written types drift, and
// drift surfaces on stage. Fcmr.Router.Decisions is the single source of truth for the decision
// record and its enumerations, so the types are derived from the C# rather than inferred from the
// JSON examples in contracts/ -- inference from an example cannot tell an optional field from one
// that merely happened to be null in the sample.
//
// Usage:
//   node scripts/generate-api-types.mjs            write src/webui/src/api/types.generated.ts
//   node scripts/generate-api-types.mjs --check    exit 1 if the file is stale (CI gate)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, 'src', 'Fcmr.Router.Decisions');
const outputPath = join(repoRoot, 'src', 'webui', 'src', 'api', 'types.generated.ts');

// Records whose shape is part of the HTTP surface. Anything not listed here stays server-side;
// exporting the whole assembly would leak internal types into the client contract.
const EXPORTED_RECORDS = [
  'RoutingDecision',
  'TierCandidate',
  'PolicyExclusion',
  'PolicySet',
  'PolicySetFieldChange',
];

const EXPORTED_ENUMS = [
  'ModelTier',
  'RoutingOutcome',
  'ModelVendor',
  'ServingMode',
  'DataClassification',
  'PolicyExclusionKind',
];

const PRIMITIVES = {
  string: 'string',
  int: 'number',
  double: 'number',
  decimal: 'number',
  bool: 'boolean',
  DateTimeOffset: 'string',
};

function readSources() {
  return readdirSync(sourceDir)
    .filter((f) => f.endsWith('.cs'))
    .map((f) => readFileSync(join(sourceDir, f), 'utf8'))
    .join('\n');
}

function stripComments(src) {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function parseEnums(src) {
  const enums = new Map();
  const re = /public enum (\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const members = body
      .split(',')
      .map((v) => v.trim().split('=')[0].trim())
      .filter((v) => v.length > 0 && /^\w+$/.test(v));
    enums.set(name, members);
  }
  return enums;
}

function parseRecords(src) {
  const records = new Map();
  // Records here are simple property bags; the body is matched up to the first closing brace at
  // column 0, which holds because the assembly deliberately contains no nested types.
  const re = /public sealed record (\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const props = [];
    const propRe = /public (required )?([\w<>,.?\s]+?)\s+(\w+)\s*\{\s*get;/g;
    let p;
    while ((p = propRe.exec(body)) !== null) {
      const [, required, rawType, propName] = p;
      props.push({ name: propName, required: Boolean(required), csharpType: rawType.trim() });
    }
    records.set(name, props);
  }
  return records;
}

function mapType(csharpType, enums) {
  let type = csharpType.trim();
  let nullable = false;

  if (type.endsWith('?')) {
    nullable = true;
    type = type.slice(0, -1).trim();
  }

  let ts;
  const list = type.match(/^IReadOnlyList<(.+)>$/) || type.match(/^IReadOnlySet<(.+)>$/);
  const dict = type.match(/^IReadOnlyDictionary<(.+?),\s*(.+)>$/);

  if (list) {
    ts = `${mapType(list[1], enums).ts}[]`;
  } else if (dict) {
    const key = mapType(dict[1], enums).ts;
    const value = mapType(dict[2], enums).ts;
    ts = `Partial<Record<${key}, ${value}>>`;
  } else if (PRIMITIVES[type]) {
    ts = PRIMITIVES[type];
  } else if (enums.has(type)) {
    ts = type;
  } else {
    ts = type;
  }

  return { ts, nullable };
}

function camel(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function generate() {
  const src = stripComments(readSources());
  const enums = parseEnums(src);
  const records = parseRecords(src);

  const missingEnums = EXPORTED_ENUMS.filter((e) => !enums.has(e));
  const missingRecords = EXPORTED_RECORDS.filter((r) => !records.has(r));
  if (missingEnums.length || missingRecords.length) {
    throw new Error(
      `Expected types were not found in the C# source: ${[...missingEnums, ...missingRecords].join(', ')}. ` +
        'Either the type was renamed or the parser needs updating.',
    );
  }

  const lines = [];
  lines.push('// GENERATED FILE -- DO NOT EDIT.');
  lines.push('//');
  lines.push('// Source: src/Fcmr.Router.Decisions/*.cs');
  lines.push('// Regenerate: node scripts/generate-api-types.mjs');
  lines.push('// CI asserts this file is in sync via: node scripts/generate-api-types.mjs --check');
  lines.push('');

  for (const name of EXPORTED_ENUMS) {
    const members = enums.get(name);
    lines.push(`export type ${name} =`);
    lines.push(members.map((v) => `  | '${v}'`).join('\n') + ';');
    lines.push('');
    lines.push(`export const ${name}Values: readonly ${name}[] = [`);
    lines.push(members.map((v) => `  '${v}',`).join('\n'));
    lines.push('] as const;');
    lines.push('');
  }

  for (const name of EXPORTED_RECORDS) {
    lines.push(`export interface ${name} {`);
    for (const prop of records.get(name)) {
      const { ts, nullable } = mapType(prop.csharpType, enums);
      // A nullable C# property becomes an optional TypeScript property that may also be null:
      // the wire format carries an explicit null, and collapsing that to `undefined` would hide
      // the difference between "refused, so no vendor" and "field absent".
      const optional = nullable || !prop.required;
      lines.push(`  ${camel(prop.name)}${optional ? '?' : ''}: ${ts}${nullable ? ' | null' : ''};`);
    }
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const generated = generate();

  if (check) {
    if (!existsSync(outputPath)) {
      console.error('FAIL: types.generated.ts is missing. Run: node scripts/generate-api-types.mjs');
      process.exit(1);
    }
    const current = readFileSync(outputPath, 'utf8');
    if (current !== generated) {
      console.error('FAIL: types.generated.ts is stale relative to the C# source.');
      console.error('Run: node scripts/generate-api-types.mjs');
      process.exit(1);
    }
    console.log('PASS: generated API types are in sync with the C# source.');
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated, 'utf8');
  console.log(`Wrote ${outputPath}`);
}

main();
