// render-svg.mjs
//
// Renders an Excalidraw scene document to a standalone SVG.
//
// Why this exists rather than a committed PNG: a raster export is a binary blob that nothing can
// check against its source, so it rots silently the moment the generator changes. An SVG produced
// from the same element array is diffable, byte-for-byte reproducible, and can be drift-checked in
// CI exactly like the .excalidraw files. It also renders natively in GitHub markdown with the text
// still selectable and searchable.
//
// This is a faithful renderer for the subset of Excalidraw this repository's generator emits:
// rectangles, text, and bound arrows. It is deliberately not a general Excalidraw renderer -- if a
// diagram starts using an element type that is not handled here, rendering fails loudly rather
// than dropping the element and producing a picture that quietly omits part of the system.
//
// Node built-ins only. No network, no clock, no randomness.

import { FONT, LINE_HEIGHT } from './diagram-kit.mjs';

const PADDING = 40;

// Excalidraw's own font stacks, with web-safe fallbacks so the file renders identically on a
// machine that has none of them installed. Metrics are approximated by diagram-kit's estimator,
// which is what laid the scene out, so the fallbacks must stay in the same width class.
const FONT_STACK = {
  [FONT.hand]: "Excalifont, Virgil, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  [FONT.helvetica]: "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif",
  [FONT.mono]: "ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace",
};

// Ascent as a fraction of font size, and the resulting baseline offset inside a line box of
// height fontSize * LINE_HEIGHT. Text sits vertically centred in its line box.
const ASCENT = 0.8;

const CORNER_RADIUS = 10;
const ARROWHEAD_LENGTH = 16;
const ARROWHEAD_ANGLE = Math.PI / 7;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(n) {
  // Two decimals is the precision the generator already rounds to. Keeping the same precision
  // here is what makes the SVG output stable across runs and platforms.
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function dashArray(strokeStyle, strokeWidth) {
  if (strokeStyle === 'dashed') return `${num(strokeWidth * 4)} ${num(strokeWidth * 4)}`;
  if (strokeStyle === 'dotted') return `${num(strokeWidth * 0.5)} ${num(strokeWidth * 3)}`;
  return null;
}

function strokeAttrs(el) {
  const out = [`stroke="${escapeXml(el.strokeColor)}"`, `stroke-width="${num(el.strokeWidth)}"`];
  const dash = dashArray(el.strokeStyle, el.strokeWidth);
  if (dash) out.push(`stroke-dasharray="${dash}"`);
  out.push('stroke-linecap="round"', 'stroke-linejoin="round"');
  return out.join(' ');
}

function cornerRadius(el) {
  if (!el.roundness) return 0;
  // Excalidraw's adaptive radius: a quarter of the shorter side, capped.
  return Math.min(32, Math.min(el.width, el.height) * 0.25);
}

function renderRectangle(el) {
  const fill =
    !el.backgroundColor || el.backgroundColor === 'transparent' ? 'none' : el.backgroundColor;
  const r = cornerRadius(el);
  return (
    `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.width)}" height="${num(el.height)}"` +
    (r > 0 ? ` rx="${num(r)}" ry="${num(r)}"` : '') +
    ` fill="${escapeXml(fill)}" ${strokeAttrs(el)} />`
  );
}

function renderText(el) {
  const lines = String(el.text).split('\n');
  const lineHeight = el.fontSize * (el.lineHeight ?? LINE_HEIGHT);
  // Centre each line in its box, then drop to the baseline.
  const firstBaseline = el.y + (lineHeight - el.fontSize) / 2 + el.fontSize * ASCENT;

  let anchor = 'start';
  let x = el.x;
  if (el.textAlign === 'center') {
    anchor = 'middle';
    x = el.x + el.width / 2;
  } else if (el.textAlign === 'right') {
    anchor = 'end';
    x = el.x + el.width;
  }

  const spans = lines
    .map((line, i) => {
      const y = firstBaseline + i * lineHeight;
      // An empty line still advances the cursor; emitting a tspan for it keeps the line index
      // and the visual position in agreement.
      return `<tspan x="${num(x)}" y="${num(y)}">${escapeXml(line)}</tspan>`;
    })
    .join('');

  return (
    `<text font-family="${escapeXml(FONT_STACK[el.fontFamily] ?? FONT_STACK[FONT.helvetica])}"` +
    ` font-size="${num(el.fontSize)}" fill="${escapeXml(el.strokeColor)}"` +
    ` text-anchor="${anchor}" style="white-space:pre">${spans}</text>`
  );
}

/** Absolute points of a linear element. */
function absolutePoints(el) {
  return el.points.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
}

/**
 * Path through the points, with the interior corners rounded. The generator routes elbowed
 * arrows through right angles; rounding them is what makes the SVG look like the Excalidraw
 * source rather than a wiring schematic.
 */
function polylinePath(pts) {
  if (pts.length < 2) return '';
  const parts = [`M ${num(pts[0].x)} ${num(pts[0].y)}`];

  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];

    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    // Never round away more than half of either adjoining segment.
    const r = Math.min(CORNER_RADIUS, inLen / 2, outLen / 2);

    if (r < 0.5 || inLen === 0 || outLen === 0) {
      parts.push(`L ${num(cur.x)} ${num(cur.y)}`);
      continue;
    }

    const start = {
      x: cur.x + ((prev.x - cur.x) / inLen) * r,
      y: cur.y + ((prev.y - cur.y) / inLen) * r,
    };
    const end = {
      x: cur.x + ((next.x - cur.x) / outLen) * r,
      y: cur.y + ((next.y - cur.y) / outLen) * r,
    };
    parts.push(`L ${num(start.x)} ${num(start.y)}`);
    parts.push(`Q ${num(cur.x)} ${num(cur.y)} ${num(end.x)} ${num(end.y)}`);
  }

  const last = pts[pts.length - 1];
  parts.push(`L ${num(last.x)} ${num(last.y)}`);
  return parts.join(' ');
}

/** Two strokes forming an open arrowhead at `tip`, pointing away from `from`. */
function arrowhead(tip, from, el) {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  if (!Number.isFinite(angle)) return '';
  const barb = (sign) => {
    const a = angle + sign * (Math.PI - ARROWHEAD_ANGLE);
    return {
      x: tip.x + Math.cos(a) * ARROWHEAD_LENGTH,
      y: tip.y + Math.sin(a) * ARROWHEAD_LENGTH,
    };
  };
  const b1 = barb(1);
  const b2 = barb(-1);
  return (
    `<path d="M ${num(b1.x)} ${num(b1.y)} L ${num(tip.x)} ${num(tip.y)} ` +
    `L ${num(b2.x)} ${num(b2.y)}" fill="none" stroke="${escapeXml(el.strokeColor)}" ` +
    `stroke-width="${num(el.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" />`
  );
}

function renderArrow(el) {
  const pts = absolutePoints(el);
  if (pts.length < 2) return '';

  const out = [
    `<path d="${polylinePath(pts)}" fill="none" ${strokeAttrs(el)} />`,
  ];

  // Arrowheads are drawn solid even on a dashed shaft; a dashed arrowhead reads as a rendering
  // fault rather than a line style.
  if (el.endArrowhead === 'arrow') {
    out.push(arrowhead(pts[pts.length - 1], pts[pts.length - 2], el));
  }
  if (el.startArrowhead === 'arrow') {
    out.push(arrowhead(pts[0], pts[1], el));
  }
  return out.join('');
}

function renderElement(el) {
  switch (el.type) {
    case 'rectangle':
      return renderRectangle(el);
    case 'text':
      return renderText(el);
    case 'arrow':
    case 'line':
      return renderArrow(el);
    default:
      throw new Error(
        `render-svg: unsupported element type "${el.type}" (id ${el.id}). ` +
          'Add a renderer for it rather than letting the SVG silently omit part of the diagram.',
      );
  }
}

/** Bounds over the rendered geometry, matching Scene.bounds(). */
function bounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    let x0 = el.x;
    let y0 = el.y;
    let x1 = el.x + el.width;
    let y1 = el.y + el.height;
    if (Array.isArray(el.points)) {
      const xs = el.points.map((p) => el.x + p[0]);
      const ys = el.points.map((p) => el.y + p[1]);
      x0 = Math.min(...xs);
      x1 = Math.max(...xs);
      y0 = Math.min(...ys);
      y1 = Math.max(...ys);
    }
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Render an Excalidraw document (as produced by Scene.toDocument()) to an SVG string.
 */
export function renderSvg(doc, { title } = {}) {
  const elements = doc.elements.filter((el) => !el.isDeleted);
  if (elements.length === 0) throw new Error('render-svg: scene has no elements');

  const b = bounds(elements);
  const x = b.minX - PADDING;
  const y = b.minY - PADDING;
  const width = b.maxX - b.minX + PADDING * 2;
  const height = b.maxY - b.minY + PADDING * 2;
  const background = doc.appState?.viewBackgroundColor ?? '#ffffff';

  const body = elements.map(renderElement).join('\n');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="${num(x)} ${num(y)} ${num(width)} ${num(height)}">\n` +
    (title ? `<title>${escapeXml(title)}</title>\n` : '') +
    `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" ` +
    `fill="${escapeXml(background)}" />\n` +
    `${body}\n` +
    '</svg>\n'
  );
}

export { FONT_STACK };
