// diagram-kit.mjs
//
// Deterministic Excalidraw element factory + layout helpers.
// Node built-ins only. No randomness, no clocks: every "random" field comes from a
// counter-based PRNG seeded with a fixed constant, and `updated` is the constant 1.

const PRNG_SEED = 0x5f3a91c7;
const UPDATED = 1;

/** Counter-based PRNG (splitmix32). Deterministic across runs and platforms. */
export function createRng(seed = PRNG_SEED) {
  let counter = seed >>> 0;
  return function next() {
    counter = (counter + 0x9e3779b9) >>> 0;
    let z = counter;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z % 2147483647;
  };
}

// ---------------------------------------------------------------------------
// Palette — Excalidraw standard swatches only.
// ---------------------------------------------------------------------------

export const C = {
  ink: '#1e1e1e',
  red: '#e03131',
  green: '#2f9e44',
  blue: '#1971c2',
  orange: '#f08c00',
  violet: '#9c36b5',
  transparent: 'transparent',
  bgRed: '#ffc9c9',
  bgGreen: '#b2f2bb',
  bgBlue: '#a5d8ff',
  bgYellow: '#ffec99',
  bgViolet: '#eebefa',
  white: '#ffffff',
};

// ---------------------------------------------------------------------------
// Type metrics
// ---------------------------------------------------------------------------

export const FONT = { hand: 1, helvetica: 2, mono: 3 };
export const LINE_HEIGHT = 1.25;
export const BOX_PAD = 16;

const CHAR_RATIO = { 1: 0.58, 2: 0.55, 3: 0.62 };

export function charWidth(fontSize, fontFamily = FONT.helvetica) {
  return fontSize * (CHAR_RATIO[fontFamily] ?? 0.55);
}

export function measureLine(line, fontSize, fontFamily = FONT.helvetica) {
  return line.length * charWidth(fontSize, fontFamily);
}

/** Greedy word wrap using the character-width estimator. Honours explicit \n. */
export function wrapText(text, fontSize, maxWidth, fontFamily = FONT.helvetica) {
  const cw = charWidth(fontSize, fontFamily);
  const maxChars = Math.max(1, Math.floor(maxWidth / cw));
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    if (paragraph.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (candidate.length <= maxChars) {
        line = candidate;
        continue;
      }
      if (line.length > 0) out.push(line);
      // Hard-break tokens longer than the line box (e.g. long identifiers).
      let rest = word;
      while (rest.length > maxChars) {
        out.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export function textBlockSize(lines, fontSize, fontFamily = FONT.helvetica) {
  const width = lines.reduce((m, l) => Math.max(m, measureLine(l, fontSize, fontFamily)), 0);
  return { width, height: lines.length * fontSize * LINE_HEIGHT };
}

// ---------------------------------------------------------------------------
// Layout: layer / column model
// ---------------------------------------------------------------------------

/**
 * A column ruler. Columns are computed once from a width + gap, never hand-placed.
 */
export function columns({ x = 0, count, width, gap }) {
  const cols = [];
  for (let i = 0; i < count; i += 1) cols.push({ x: x + i * (width + gap), width });
  return {
    cols,
    at: (i) => cols[i],
    span: (i, n) => ({ x: cols[i].x, width: n * width + (n - 1) * gap }),
    totalWidth: count * width + (count - 1) * gap,
  };
}

/** A vertical stack cursor. Rows advance by an explicit height + gap. */
export function stack(y, gap = 40) {
  let cursor = y;
  return {
    next(height) {
      const top = cursor;
      cursor += height + gap;
      return top;
    },
    skip(amount) {
      cursor += amount;
    },
    get y() {
      return cursor;
    },
  };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export class Scene {
  constructor({ name, seed = PRNG_SEED } = {}) {
    this.name = name;
    this.elements = [];
    this.rng = createRng(seed);
    this.idCounter = 0;
    this.byId = new Map();
  }

  id(prefix) {
    this.idCounter += 1;
    return `${prefix}-${String(this.idCounter).padStart(3, '0')}`;
  }

  base(type, props) {
    const el = {
      id: props.id,
      type,
      x: round(props.x),
      y: round(props.y),
      width: round(props.width),
      height: round(props.height),
      angle: 0,
      strokeColor: props.strokeColor ?? C.ink,
      backgroundColor: props.backgroundColor ?? C.transparent,
      fillStyle: props.fillStyle ?? 'solid',
      strokeWidth: props.strokeWidth ?? 2,
      strokeStyle: props.strokeStyle ?? 'solid',
      roughness: props.roughness ?? 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: props.roundness === undefined ? { type: 3 } : props.roundness,
      seed: this.rng(),
      versionNonce: this.rng(),
      version: 1,
      isDeleted: false,
      boundElements: props.boundElements ?? [],
      updated: UPDATED,
      link: null,
      locked: false,
    };
    this.elements.push(el);
    this.byId.set(el.id, el);
    return el;
  }

  /** Free-floating text. Width/height are derived from the estimator. */
  text(
    content,
    {
      x,
      y,
      width,
      fontSize = 16,
      fontFamily = FONT.helvetica,
      color = C.ink,
      align = 'left',
      id,
    } = {},
  ) {
    const maxWidth = width ?? measureLine(String(content).split('\n')[0], fontSize, fontFamily) + 1;
    const lines = wrapText(content, fontSize, maxWidth, fontFamily);
    const size = textBlockSize(lines, fontSize, fontFamily);
    const el = this.base('text', {
      id: id ?? this.id('txt'),
      x,
      y,
      width: width ?? size.width,
      height: size.height,
      strokeColor: color,
      backgroundColor: C.transparent,
      roundness: null,
      strokeWidth: 2,
    });
    Object.assign(el, {
      text: lines.join('\n'),
      originalText: String(content),
      fontSize,
      fontFamily,
      textAlign: align,
      verticalAlign: 'top',
      containerId: null,
      lineHeight: LINE_HEIGHT,
    });
    return el;
  }

  /**
   * Height a box needs for its title + body at a given width.
   * Layout code calls this before placing a row so siblings share a height.
   */
  static measure(spec, width) {
    const titleSize = spec.titleSize ?? 20;
    const bodySize = spec.bodySize ?? 16;
    const inner = width - 2 * BOX_PAD;
    let h = BOX_PAD * 2;
    if (spec.title) {
      const lines = wrapText(spec.title, titleSize, inner, spec.titleFamily ?? FONT.helvetica);
      h += lines.length * titleSize * LINE_HEIGHT;
    }
    if (spec.body) {
      const lines = wrapText(spec.body, bodySize, inner, spec.bodyFamily ?? FONT.helvetica);
      h += 10 + lines.length * bodySize * LINE_HEIGHT;
    }
    return Math.max(h, 64);
  }

  /**
   * A labelled box: rectangle + bound title text (+ optional free body text inside).
   */
  box(spec) {
    const {
      x,
      y,
      width,
      height,
      title,
      body,
      stroke = C.ink,
      background = C.transparent,
      fillStyle = 'solid',
      strokeStyle = 'solid',
      strokeWidth = 2,
      titleSize = 20,
      bodySize = 16,
      titleFamily = FONT.helvetica,
      bodyFamily = FONT.helvetica,
      titleColor,
      bodyColor,
    } = spec;

    const h = height ?? Scene.measure(spec, width);
    const rectId = this.id('box');
    const inner = width - 2 * BOX_PAD;

    const rect = this.base('rectangle', {
      id: rectId,
      x,
      y,
      width,
      height: h,
      strokeColor: stroke,
      backgroundColor: background,
      fillStyle,
      strokeStyle,
      strokeWidth,
      roundness: { type: 3 },
    });

    const titleLines = wrapText(title, titleSize, inner, titleFamily);
    const titleSizeBox = textBlockSize(titleLines, titleSize, titleFamily);
    const titleId = this.id('txt');
    const centred = !body;
    const titleY = centred ? y + (h - titleSizeBox.height) / 2 : y + BOX_PAD;

    const titleEl = this.base('text', {
      id: titleId,
      x: x + BOX_PAD,
      y: titleY,
      width: inner,
      height: titleSizeBox.height,
      strokeColor: titleColor ?? C.ink,
      backgroundColor: C.transparent,
      roundness: null,
    });
    Object.assign(titleEl, {
      text: titleLines.join('\n'),
      originalText: title,
      fontSize: titleSize,
      fontFamily: titleFamily,
      textAlign: 'center',
      verticalAlign: centred ? 'middle' : 'top',
      containerId: rectId,
      lineHeight: LINE_HEIGHT,
    });
    rect.boundElements.push({ type: 'text', id: titleId });

    if (body) {
      const bodyY = titleY + titleSizeBox.height + 10;
      this.text(body, {
        x: x + BOX_PAD,
        y: bodyY,
        width: inner,
        fontSize: bodySize,
        fontFamily: bodyFamily,
        color: bodyColor ?? C.ink,
        align: 'center',
      });
    }

    return { id: rectId, x, y, width, height: h, cx: x + width / 2, cy: y + h / 2 };
  }

  /**
   * A grouping frame: a rectangle with a label sitting on its top-left inside edge.
   * Groups are containers; children are placed inside them by the caller.
   */
  group(spec) {
    const {
      x,
      y,
      width,
      height,
      label,
      stroke = C.ink,
      background = C.transparent,
      fillStyle = 'solid',
      strokeStyle = 'solid',
      strokeWidth = 2,
      labelSize = 20,
      labelColor,
      sublabel,
      sublabelSize = 16,
    } = spec;

    const rectId = this.id('grp');
    this.base('rectangle', {
      id: rectId,
      x,
      y,
      width,
      height,
      strokeColor: stroke,
      backgroundColor: background,
      fillStyle,
      strokeStyle,
      strokeWidth,
      roundness: { type: 3 },
    });

    if (label) {
      const el = this.text(label, {
        x: x + BOX_PAD,
        y: y + 12,
        width: width - 2 * BOX_PAD,
        fontSize: labelSize,
        color: labelColor ?? stroke,
        align: 'left',
      });
      if (sublabel) {
        this.text(sublabel, {
          x: x + BOX_PAD,
          y: y + 12 + el.height + 4,
          width: width - 2 * BOX_PAD,
          fontSize: sublabelSize,
          color: labelColor ?? stroke,
          align: 'left',
        });
      }
    }

    return { id: rectId, x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
  }

  /** Anchor point on a box edge. */
  static anchor(b, side) {
    switch (side) {
      case 'left':
        return { x: b.x, y: b.y + b.height / 2 };
      case 'right':
        return { x: b.x + b.width, y: b.y + b.height / 2 };
      case 'top':
        return { x: b.x + b.width / 2, y: b.y };
      case 'bottom':
        return { x: b.x + b.width / 2, y: b.y + b.height };
      default:
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
  }

  static autoSides(a, b) {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    }
    return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  /**
   * A bound arrow between two boxes. Both endpoints are updated to reference it.
   */
  arrow(from, to, opts = {}) {
    const {
      color = C.ink,
      strokeWidth = 2,
      strokeStyle = 'solid',
      gap = 8,
      label,
      labelSize = 16,
      labelColor,
      labelWidth = 240,
      labelDx = 0,
      labelDy = 0,
      elbow = null, // 'h' | 'v' — route through one right angle
      endArrowhead = 'arrow',
      startArrowhead = null,
    } = opts;

    let [sSide, eSide] = opts.sides ?? Scene.autoSides(from, to);
    const start = Scene.anchor(from, sSide);
    const end = Scene.anchor(to, eSide);

    const off = (p, side, d) => {
      if (side === 'left') return { x: p.x - d, y: p.y };
      if (side === 'right') return { x: p.x + d, y: p.y };
      if (side === 'top') return { x: p.x, y: p.y - d };
      return { x: p.x, y: p.y + d };
    };
    const s = off(start, sSide, gap);
    const e = off(end, eSide, gap);

    const pts = [[0, 0]];
    if (sSide === eSide) {
      // Same-side connection: route out perpendicular, travel, and come back in.
      const detour = opts.detour ?? 70;
      const dir = sSide === 'left' || sSide === 'top' ? -1 : 1;
      const horiz = sSide === 'left' || sSide === 'right';
      const reach = dir * detour;
      if (horiz) {
        pts.push([reach, 0], [reach, e.y - s.y], [e.x - s.x, e.y - s.y]);
      } else {
        pts.push([0, reach], [e.x - s.x, reach], [e.x - s.x, e.y - s.y]);
      }
    } else {
      if (elbow === 'h') pts.push([e.x - s.x, 0]);
      if (elbow === 'v') pts.push([0, e.y - s.y]);
      pts.push([e.x - s.x, e.y - s.y]);
    }

    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const arrowId = this.id('arr');

    const el = this.base('arrow', {
      id: arrowId,
      x: s.x,
      y: s.y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      strokeColor: color,
      backgroundColor: C.transparent,
      strokeWidth,
      strokeStyle,
      roundness: { type: 2 },
    });
    Object.assign(el, {
      points: pts.map(([px, py]) => [round(px), round(py)]),
      lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap },
      endBinding: { elementId: to.id, focus: 0, gap },
      startArrowhead,
      endArrowhead,
      elbowed: false,
    });

    this.byId.get(from.id).boundElements.push({ type: 'arrow', id: arrowId });
    this.byId.get(to.id).boundElements.push({ type: 'arrow', id: arrowId });

    if (label) {
      // Anchor the label at the centroid of the routed polyline, so a detoured
      // arrow labels itself where it actually runs. `labelAt` overrides absolutely.
      const cxRel = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cyRel = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const mid = opts.labelAt ?? { x: s.x + cxRel, y: s.y + cyRel };
      const lines = wrapText(label, labelSize, labelWidth);
      const size = textBlockSize(lines, labelSize);
      this.text(label, {
        x: mid.x - labelWidth / 2 + labelDx,
        y: mid.y - size.height / 2 + labelDy,
        width: labelWidth,
        fontSize: labelSize,
        color: labelColor ?? color,
        align: 'center',
      });
    }

    return { id: arrowId };
  }

  /** Diagram title + one-sentence subtitle stating the conclusion. */
  header({ x, y, width, title, subtitle }) {
    const t = this.text(title, {
      x,
      y,
      width,
      fontSize: 28,
      color: C.ink,
      align: 'left',
    });
    const s = this.text(subtitle, {
      x,
      y: y + t.height + 10,
      width,
      fontSize: 20,
      color: C.blue,
      align: 'left',
    });
    return { height: t.height + 10 + s.height };
  }

  /** A legend. Every diagram must have one; colour without a key is decoration. */
  legend({ x, y, width, items, title = 'Legend — what the colours mean' }) {
    const rowH = 34;
    const swatch = 26;
    const height = 16 + 24 + 12 + items.length * rowH + 12;
    const frame = this.group({
      x,
      y,
      width,
      height,
      label: title,
      labelSize: 20,
      stroke: C.ink,
      background: C.white,
      strokeWidth: 2,
    });
    let cursor = y + 16 + 24 + 14;
    for (const item of items) {
      this.base('rectangle', {
        id: this.id('swa'),
        x: x + BOX_PAD,
        y: cursor,
        width: swatch,
        height: swatch,
        strokeColor: item.stroke ?? C.ink,
        backgroundColor: item.background ?? C.transparent,
        fillStyle: 'solid',
        strokeWidth: item.strokeWidth ?? 2,
        strokeStyle: item.strokeStyle ?? 'solid',
        roundness: { type: 3 },
      });
      this.text(item.text, {
        x: x + BOX_PAD + swatch + 12,
        y: cursor + 3,
        width: width - 2 * BOX_PAD - swatch - 12,
        fontSize: 16,
        color: C.ink,
        align: 'left',
      });
      cursor += rowH;
    }
    return frame;
  }

  bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of this.elements) {
      let x0 = el.x;
      let y0 = el.y;
      let x1 = el.x + el.width;
      let y1 = el.y + el.height;
      if (Array.isArray(el.points)) {
        // Linear elements store points relative to x/y and may run negative.
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
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  toDocument() {
    return {
      type: 'excalidraw',
      version: 2,
      source: 'https://github.com/briandenicola/foundry-capital-markets-router',
      elements: this.elements,
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      files: {},
    };
  }

  toJSON() {
    return `${JSON.stringify(this.toDocument(), null, 2)}\n`;
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export { round, UPDATED, PRNG_SEED };
