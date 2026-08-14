#!/usr/bin/env node
// validate.mjs
//
// Structural validation for generated .excalidraw files.
//
//   node validate.mjs <dir>
//
// Asserts, per diagram:
//   a) every containerId references an existing element
//   b) every arrow startBinding/endBinding elementId references an existing element
//   c) every bound text/arrow is listed in its container's boundElements
//   d) no two non-container rectangles overlap
//   e) no element has NaN/undefined in x, y, width, height
//   f) every text label fits its container's width given the width estimator
// Plus: minimum font sizes for projector legibility, and determinism markers.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { charWidth, wrapText, LINE_HEIGHT, BOX_PAD } from './diagram-kit.mjs';

const MIN_BODY_FONT = 16;
const MIN_SIBLING_GAP = 40;

function isFinitePositive(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

function contains(outer, inner) {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height &&
    (outer.width > inner.width || outer.height > inner.height)
  );
}

function validate(file, doc) {
  const errors = [];
  const warnings = [];
  const els = doc.elements;
  const byId = new Map(els.map((e) => [e.id, e]));

  // --- (e) numeric sanity -------------------------------------------------
  for (const e of els) {
    for (const k of ['x', 'y', 'width', 'height']) {
      if (!isFinitePositive(e[k])) {
        errors.push(`(e) ${e.id} [${e.type}] has non-finite ${k}: ${e[k]}`);
      }
    }
    if (e.width < 0 || e.height < 0) {
      errors.push(`(e) ${e.id} [${e.type}] has negative size ${e.width}x${e.height}`);
    }
    if (e.updated !== 1) {
      errors.push(`(det) ${e.id} has updated=${e.updated}, expected the fixed constant 1`);
    }
    for (const k of [
      'id', 'type', 'angle', 'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth',
      'strokeStyle', 'roughness', 'opacity', 'groupIds', 'frameId', 'seed', 'versionNonce',
      'version', 'isDeleted', 'boundElements', 'updated', 'locked',
    ]) {
      if (!(k in e)) errors.push(`(schema) ${e.id} [${e.type}] missing required property "${k}"`);
    }
    if (!('roundness' in e)) errors.push(`(schema) ${e.id} missing roundness`);
    if (!('link' in e)) errors.push(`(schema) ${e.id} missing link`);
  }

  // --- (a) containerId ----------------------------------------------------
  for (const e of els) {
    if (e.type !== 'text') continue;
    if (e.containerId === null || e.containerId === undefined) continue;
    if (!byId.has(e.containerId)) {
      errors.push(`(a) text ${e.id} has containerId ${e.containerId} which does not exist`);
    }
  }

  // --- (b) arrow bindings -------------------------------------------------
  for (const e of els) {
    if (e.type !== 'arrow') continue;
    for (const side of ['startBinding', 'endBinding']) {
      const b = e[side];
      if (!b) {
        warnings.push(`(b) arrow ${e.id} has no ${side}`);
        continue;
      }
      if (!byId.has(b.elementId)) {
        errors.push(`(b) arrow ${e.id} ${side} -> ${b.elementId} which does not exist`);
      }
    }
    if (!Array.isArray(e.points) || e.points.length < 2) {
      errors.push(`(b) arrow ${e.id} has fewer than two points`);
    }
  }

  // --- (c) reciprocal boundElements ---------------------------------------
  const listed = (containerId, kind, id) => {
    const c = byId.get(containerId);
    if (!c) return false;
    return (c.boundElements ?? []).some((b) => b.id === id && b.type === kind);
  };
  for (const e of els) {
    if (e.type === 'text' && e.containerId) {
      if (!listed(e.containerId, 'text', e.id)) {
        errors.push(`(c) container ${e.containerId} does not list bound text ${e.id}`);
      }
    }
    if (e.type === 'arrow') {
      for (const side of ['startBinding', 'endBinding']) {
        const b = e[side];
        if (b && !listed(b.elementId, 'arrow', e.id)) {
          errors.push(`(c) ${b.elementId} does not list bound arrow ${e.id} (${side})`);
        }
      }
    }
  }
  // and the reverse direction: everything listed must exist
  for (const e of els) {
    for (const b of e.boundElements ?? []) {
      if (!byId.has(b.id)) {
        errors.push(`(c) ${e.id} lists boundElement ${b.id} which does not exist`);
      }
    }
  }

  // --- (d) rectangle overlap ----------------------------------------------
  const rects = els.filter((e) => e.type === 'rectangle');
  const containersSet = new Set();
  for (const a of rects) {
    for (const b of rects) {
      if (a === b) continue;
      if (contains(a, b)) containersSet.add(a.id);
    }
  }
  const leaves = rects.filter((r) => !containersSet.has(r.id));
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      if (overlaps(leaves[i], leaves[j])) {
        errors.push(
          `(d) leaf rectangles overlap: ${leaves[i].id} ` +
            `(${leaves[i].x},${leaves[i].y} ${leaves[i].width}x${leaves[i].height}) and ` +
            `${leaves[j].id} (${leaves[j].x},${leaves[j].y} ${leaves[j].width}x${leaves[j].height})`,
        );
      }
    }
  }
  // sibling clearance: leaves sharing a parent container should be >= 40px apart
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      if (overlaps(a, b)) continue;
      const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
      const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
      const gap = Math.max(dx, dy);
      if (gap < MIN_SIBLING_GAP - 0.5 && gap >= 0) {
        // only complain when the two boxes actually share a band (i.e. are visual siblings)
        const bandX = a.x < b.x + b.width && b.x < a.x + a.width;
        const bandY = a.y < b.y + b.height && b.y < a.y + a.height;
        if (bandX || bandY) {
          // Legend key swatches are intentionally dense; they are a key, not content.
          const isSwatch = (r) => r.width <= 32 && r.height <= 32;
          if (!isSwatch(a) && !isSwatch(b)) {
            warnings.push(
              `(d) siblings ${a.id} and ${b.id} are only ${gap.toFixed(1)}px apart (want >= ${MIN_SIBLING_GAP})`,
            );
          }
        }
      }
    }
  }

  // --- (g) free body text must not spill out of the box it sits in --------
  for (const t of els) {
    if (t.type !== 'text' || t.containerId) continue;
    for (const r of leaves) {
      const insideX = t.x >= r.x - 1 && t.x + t.width <= r.x + r.width + 1;
      const startsInside = t.y >= r.y - 1 && t.y <= r.y + r.height;
      if (insideX && startsInside) {
        const th = t.text.split('\n').length * t.fontSize * LINE_HEIGHT;
        if (t.y + th > r.y + r.height + 1) {
          errors.push(
            `(g) free text ${t.id} overflows the bottom of box ${r.id} by ` +
              `${(t.y + th - r.y - r.height).toFixed(0)}px: "${t.text.split('\n')[0].slice(0, 50)}"`,
          );
        }
      }
    }
  }

  // --- (h) a leaf box must never straddle a group border ------------------
  const containerRects = rects.filter((r) => containersSet.has(r.id));
  for (const leaf of leaves) {
    for (const c of containerRects) {
      if (overlaps(leaf, c) && !contains(c, leaf)) {
        errors.push(`(h) box ${leaf.id} straddles the border of group ${c.id}`);
      }
    }
  }

  // --- (f) text fits ------------------------------------------------------
  for (const e of els) {
    if (e.type !== 'text') continue;
    const family = e.fontFamily ?? 2;
    const cw = charWidth(e.fontSize, family);
    const longest = e.text.split('\n').reduce((m, l) => Math.max(m, l.length * cw), 0);

    if (e.containerId) {
      const c = byId.get(e.containerId);
      if (c && c.type !== 'arrow') {
        const avail = c.width - 2 * BOX_PAD;
        if (longest > avail + 0.5) {
          errors.push(
            `(f) bound text ${e.id} needs ${longest.toFixed(0)}px but container ${c.id} offers ${avail.toFixed(0)}px: "${e.text.split('\n')[0].slice(0, 60)}"`,
          );
        }
        const lines = e.text.split('\n').length;
        const th = lines * e.fontSize * LINE_HEIGHT;
        if (th > c.height - 8) {
          errors.push(
            `(f) bound text ${e.id} needs ${th.toFixed(0)}px height, container ${c.id} is ${c.height}px`,
          );
        }
      }
    } else if (longest > e.width + 0.5) {
      errors.push(
        `(f) free text ${e.id} needs ${longest.toFixed(0)}px but declares width ${e.width}: "${e.text.split('\n')[0].slice(0, 60)}"`,
      );
    }

    // Wrapping must be idempotent: re-wrapping must not produce more lines.
    const rewrapped = wrapText(e.text, e.fontSize, e.width, family);
    if (rewrapped.length > e.text.split('\n').length) {
      errors.push(`(f) text ${e.id} would re-wrap to more lines than it declares`);
    }

    if (e.fontSize < MIN_BODY_FONT) {
      errors.push(`(legibility) text ${e.id} fontSize ${e.fontSize} < ${MIN_BODY_FONT}`);
    }
    if (e.lineHeight !== LINE_HEIGHT) {
      errors.push(`(schema) text ${e.id} lineHeight ${e.lineHeight} != ${LINE_HEIGHT}`);
    }
  }

  // --- diagram-level requirements -----------------------------------------
  const texts = els.filter((e) => e.type === 'text');
  if (!texts.some((t) => t.fontSize >= 28)) {
    errors.push('(title) no element at title size (>= 28) — every diagram needs a title');
  }
  if (!texts.some((t) => /Conclusion:/.test(t.originalText ?? ''))) {
    errors.push('(subtitle) no one-sentence subtitle stating the conclusion');
  }
  if (!texts.some((t) => /^Legend/.test(t.originalText ?? ''))) {
    errors.push('(legend) no legend — colour without a stated meaning is decoration');
  }

  return { file, errors, warnings, elementCount: els.length };
}

function main() {
  const dir = resolve(process.cwd(), process.argv[2] ?? 'out');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.excalidraw'))
    .sort();
  if (files.length === 0) {
    process.stderr.write(`No .excalidraw files in ${dir}\n`);
    process.exit(1);
  }

  let failed = 0;
  let totalWarn = 0;
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`FAIL ${f}: not valid JSON — ${err.message}\n`);
      failed += 1;
      continue;
    }
    const r = validate(f, doc);
    const bounds = doc.elements.reduce(
      (acc, e) => {
        const xs = Array.isArray(e.points) ? e.points.map((p) => e.x + p[0]) : [e.x, e.x + e.width];
        const ys = Array.isArray(e.points) ? e.points.map((p) => e.y + p[1]) : [e.y, e.y + e.height];
        return {
          minX: Math.min(acc.minX, ...xs),
          minY: Math.min(acc.minY, ...ys),
          maxX: Math.max(acc.maxX, ...xs),
          maxY: Math.max(acc.maxY, ...ys),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const dims = `${Math.round(bounds.maxX - bounds.minX)} x ${Math.round(bounds.maxY - bounds.minY)}`;
    if (r.errors.length === 0) {
      process.stdout.write(
        `PASS ${f.padEnd(34)} ${String(r.elementCount).padStart(4)} elements  canvas ${dims}` +
          `${r.warnings.length ? `  (${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''})` : ''}\n`,
      );
    } else {
      failed += 1;
      process.stdout.write(`FAIL ${f.padEnd(34)} ${r.errors.length} error(s)\n`);
      for (const e of r.errors.slice(0, 40)) process.stdout.write(`       ${e}\n`);
      if (r.errors.length > 40) process.stdout.write(`       … ${r.errors.length - 40} more\n`);
    }
    for (const w of r.warnings.slice(0, 20)) process.stdout.write(`  warn ${w}\n`);
    totalWarn += r.warnings.length;
  }

  process.stdout.write(
    `\n${files.length - failed}/${files.length} diagrams valid, ${totalWarn} warning(s).\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
