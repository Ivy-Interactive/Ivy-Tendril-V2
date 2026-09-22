// Dependency-free SVG charts for benchmark.md. Every chart is a self-contained SVG string that
// paints its own background, so it stays legible whatever page it is embedded in (GitHub renders
// markdown images as <img>, where the page's theme and the OS theme can disagree); a
// prefers-color-scheme block swaps to the dark token set when the viewer's scheme is dark.
//
// Colors follow the dataviz reference palette: V1 and V2 always take categorical slots 1 and 2
// (blue, orange) in every chart, so a reader who learned "V2 is orange" is never misled. Component
// stacks use slots 3 to 8 and never blue or orange, so a segment can not be mistaken for an app.
// Both sets were run through the palette validator in light and dark mode (all hard gates pass;
// the light component slots need a relief channel, which the markdown tables next to every chart
// and in-segment labels provide).
//
// Output is deterministic: coordinates are rounded to fixed precision and nothing depends on time,
// locale or iteration order of anything but the inputs.

export type SeriesKey = 'v1' | 'v2';

interface Tone {
  light: string;
  dark: string;
}

export const APP_COLORS: Readonly<Record<SeriesKey, Tone>> = {
  v1: { light: '#2a78d6', dark: '#3987e5' },
  v2: { light: '#eb6834', dark: '#d95926' },
};

/** Categorical slots 3..8 (aqua, yellow, magenta, green, violet, red). */
const COMPONENT_COLORS: readonly Tone[] = [
  { light: '#1baf7a', dark: '#199e70' },
  { light: '#eda100', dark: '#c98500' },
  { light: '#e87ba4', dark: '#d55181' },
  { light: '#008300', dark: '#008300' },
  { light: '#4a3aa7', dark: '#9085e9' },
  { light: '#e34948', dark: '#e66767' },
];
/** "Other" is not an identity, so it gets a neutral instead of a seventh hue. */
const OTHER_COLOR: Tone = { light: '#a9a79f', dark: '#5f5e59' };

export const MAX_COMPONENTS = COMPONENT_COLORS.length;

const INK = {
  light: { surface: '#fcfcfb', border: 'rgba(11,11,11,0.10)', t1: '#0b0b0b', t2: '#52514e', t3: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' },
  dark: { surface: '#1a1a19', border: 'rgba(255,255,255,0.10)', t1: '#ffffff', t2: '#c3c2b7', t3: '#898781', grid: '#2c2c2a', axis: '#383835' },
};

const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif`;

export const CHART_WIDTH = 760;
const PAD = 20;

// ---------------------------------------------------------------------------------------------
// Color helpers

function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * White or near-black, whichever has more contrast with a filled segment (the one place text sits
 * on color). Deliberately not the mode's ink: in dark mode that is white too, which fails on yellow.
 */
function onFill(fill: string): string {
  return contrast(fill, '#ffffff') >= contrast(fill, '#0b0b0b') ? '#ffffff' : '#0b0b0b';
}

function styleBlock(): string {
  const rules = (m: 'light' | 'dark') => {
    const k = INK[m];
    const r: string[] = [
      `.bg{fill:${k.surface};stroke:${k.border}}`,
      `.t1{fill:${k.t1}}`,
      `.t2{fill:${k.t2}}`,
      `.t3{fill:${k.t3}}`,
      `.grid{stroke:${k.grid}}`,
      `.axis{stroke:${k.axis}}`,
      `.ring{stroke:${k.surface}}`,
      `.gap{stroke:${k.surface}}`,
      `.lead{stroke:${k.t3}}`,
      `.wh{stroke:${k.t1}}`,
      `.hollow{fill:${k.surface};stroke:${k.t3}}`,
      `.halo{stroke:${k.surface};stroke-width:4px;stroke-linejoin:round;paint-order:stroke}`,
    ];
    for (const key of ['v1', 'v2'] as const) {
      const c = APP_COLORS[key][m];
      r.push(`.f-${key}{fill:${c}}`, `.s-${key}{stroke:${c}}`, `.o-${key}{fill:${k.surface};stroke:${c}}`);
    }
    COMPONENT_COLORS.forEach((t, i) => {
      r.push(`.f-c${i}{fill:${t[m]}}`, `.t-c${i}{fill:${onFill(t[m])}}`);
    });
    r.push(`.f-co{fill:${OTHER_COLOR[m]}}`, `.t-co{fill:${onFill(OTHER_COLOR[m])}}`);
    return r.join('');
  };
  return (
    `<style>svg{font-family:${FONT}}text{font-variant-numeric:tabular-nums}${rules('light')}` +
    `@media (prefers-color-scheme:dark){${rules('dark')}}</style>`
  );
}

// ---------------------------------------------------------------------------------------------
// Text measurement (approximate: Helvetica advance widths, scaled up a little so the wider
// system UI fonts still fit where the layout budgeted for them)

// prettier-ignore
const HELVETICA: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += c >= 32 && c <= 126 ? HELVETICA[c - 32]! : 600;
  }
  return (w / 1000) * size * (bold ? 1.14 : 1.08);
}

/** Greedy word wrap to `maxWidth`; a single word longer than the line is kept whole. */
export function wrapText(s: string, size: number, maxWidth: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function truncate(s: string, size: number, maxWidth: number, bold = false): string {
  if (textWidth(s, size, bold) <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && textWidth(`${out}\u2026`, size, bold) > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}\u2026`;
}

// ---------------------------------------------------------------------------------------------
// SVG primitives

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Fixed precision keeps the output byte-stable and small. */
function n(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
}

interface TextOpts {
  cls?: string;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  weight?: number;
}

function text(x: number, y: number, s: string, o: TextOpts = {}): string {
  const attrs = [`x="${n(x)}"`, `y="${n(y)}"`, `class="${o.cls ?? 't1'}"`, `font-size="${o.size ?? 12}"`];
  if (o.anchor && o.anchor !== 'start') attrs.push(`text-anchor="${o.anchor}"`);
  if (o.weight) attrs.push(`font-weight="${o.weight}"`);
  return `<text ${attrs.join(' ')}>${esc(s)}</text>`;
}

function line(x1: number, y1: number, x2: number, y2: number, cls: string, width = 1, extra = ''): string {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" class="${cls}" stroke-width="${width}"${extra}/>`;
}

/** Horizontal bar growing right from x0, 4px rounded data end, square at the baseline. */
function hbar(x0: number, y: number, w: number, h: number, cls: string, title?: string): string {
  const width = Math.max(w, 1);
  const r = Math.min(4, width / 2, h / 2);
  const xe = x0 + width;
  const d = `M${n(x0)},${n(y)}H${n(xe - r)}A${n(r)},${n(r)} 0 0 1 ${n(xe)},${n(y + r)}V${n(y + h - r)}A${n(r)},${n(r)} 0 0 1 ${n(xe - r)},${n(y + h)}H${n(x0)}Z`;
  return `<path d="${d}" class="${cls}">${title ? `<title>${esc(title)}</title>` : ''}</path>`;
}

// ---------------------------------------------------------------------------------------------
// Frame: background, title, subtitle, legend, footnote

export interface LegendItem {
  cls: string;
  label: string;
  kind: 'rect' | 'line' | 'dot';
}

interface FrameInput {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  footnote?: string;
}

interface Header {
  svg: string;
  /** y where the plot may start. */
  bottom: number;
}

function header(f: FrameInput): Header {
  const parts: string[] = [];
  let y = PAD + 12;
  for (const l of wrapText(f.title, 15, CHART_WIDTH - 2 * PAD)) {
    parts.push(text(PAD, y, l, { size: 15, weight: 600 }));
    y += 20;
  }
  if (f.subtitle) {
    for (const l of wrapText(f.subtitle, 12, CHART_WIDTH - 2 * PAD)) {
      parts.push(text(PAD, y - 2, l, { cls: 't2', size: 12 }));
      y += 16;
    }
  }
  if (f.legend?.length) {
    y += 6;
    let x = PAD;
    for (const it of f.legend) {
      const w = 14 + 6 + textWidth(it.label, 12) + 18;
      if (x > PAD && x + w > CHART_WIDTH - PAD) {
        x = PAD;
        y += 20;
      }
      if (it.kind === 'rect') parts.push(`<rect x="${n(x)}" y="${n(y - 9)}" width="12" height="12" rx="2" class="${it.cls}"/>`);
      else if (it.kind === 'dot') parts.push(`<circle cx="${n(x + 6)}" cy="${n(y - 3)}" r="5" class="${it.cls}" stroke-width="2"/>`);
      else parts.push(line(x, y - 3, x + 14, y - 3, it.cls, 2.5, ' stroke-linecap="round"'));
      parts.push(text(x + 20, y + 1, it.label, { cls: 't2', size: 12 }));
      x += w;
    }
    y += 10;
  }
  return { svg: parts.join(''), bottom: y + 8 };
}

function footer(footnote: string | undefined, y: number): { svg: string; bottom: number } {
  if (!footnote) return { svg: '', bottom: y };
  const parts: string[] = [];
  let yy = y + 6;
  for (const l of wrapText(footnote, 11, CHART_WIDTH - 2 * PAD)) {
    yy += 14;
    parts.push(text(PAD, yy, l, { cls: 't3', size: 11 }));
  }
  return { svg: parts.join(''), bottom: yy };
}

function wrapSvg(title: string, desc: string, height: number, body: string): string {
  const h = Math.ceil(height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${h}" viewBox="0 0 ${CHART_WIDTH} ${h}" role="img" aria-labelledby="t d">` +
    `<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>${styleBlock()}` +
    `<rect x="0.5" y="0.5" width="${CHART_WIDTH - 1}" height="${h - 1}" rx="8" class="bg"/>${body}</svg>\n`
  );
}

// ---------------------------------------------------------------------------------------------
// Scales and ticks

interface Scale {
  (v: number): number;
  ticks: number[];
  log: boolean;
  domain: [number, number];
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

function linearScale(max: number, r0: number, r1: number, count = 5, min = 0, exact = false): Scale {
  const hi = max > min ? max : min + 1;
  const step = niceStep(hi - min, count);
  const top = exact ? hi : Math.ceil(hi / step - 1e-9) * step;
  const bottom = Math.floor(min / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + (exact ? 1e-9 : step / 2); v += step) ticks.push(Math.round(v / step) * step);
  const f = ((v: number) => r0 + ((v - bottom) / (top - bottom)) * (r1 - r0)) as Scale;
  f.ticks = ticks;
  f.log = false;
  f.domain = [bottom, top];
  return f;
}

/** Largest 1, 2 or 5 x 10^k at or below x (down) or smallest at or above x (up). */
function nice125(x: number, dir: 'down' | 'up'): number {
  const e = Math.floor(Math.log10(x));
  const steps = [1, 2, 5, 10];
  const m = x / 10 ** e;
  if (dir === 'down') {
    const s = [...steps].reverse().find((k) => k <= m * (1 + 1e-9)) ?? 1;
    return Number((s * 10 ** e).toPrecision(12));
  }
  const s = steps.find((k) => k >= m * (1 - 1e-9)) ?? 10;
  return Number((s * 10 ** e).toPrecision(12));
}

function logScale(min: number, max: number, r0: number, r1: number): Scale {
  const lo = nice125(min, 'down');
  const hi = nice125(max, 'up');
  const top = hi > lo ? hi : lo * 10;
  const decades = Math.log10(top / lo);
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(top)); e++) {
    const base = 10 ** e;
    for (const k of decades <= 2.5 ? [1, 2, 5] : [1]) ticks.push(Number((k * base).toPrecision(12)));
  }
  const f = ((v: number) => r0 + ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(top) - Math.log10(lo))) * (r1 - r0)) as Scale;
  const inside = ticks.filter((t) => t >= lo * (1 - 1e-9) && t <= top * (1 + 1e-9));
  // The domain ends are labelled too, unless they would crowd a decade tick.
  for (const end of [lo, top]) if (!inside.some((t) => Math.abs(Math.log10(t / end)) < 0.2)) inside.push(end);
  f.ticks = [...new Set(inside)].sort((a, b) => a - b);
  f.log = true;
  f.domain = [lo, top];
  return f;
}

/** Axis tick text: up to 3 significant digits, thousands separators, no unit. */
export function tickLabel(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  let s: string;
  if (a >= 1000) s = Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  else if (a >= 1) s = String(Math.round(v * 100) / 100);
  else s = String(Number(v.toPrecision(3)));
  return s;
}

function chooseScale(values: number[], mode: 'auto' | 'linear' | 'log', r0: number, r1: number, count = 5): Scale {
  const pos = values.filter((v) => Number.isFinite(v) && v > 0);
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  const wantLog = mode === 'log' || (mode === 'auto' && pos.length >= 2 && Math.max(...pos) / Math.min(...pos) > 30);
  if (wantLog && pos.length) return logScale(Math.min(...pos), Math.max(...pos), r0, r1);
  return linearScale(max, r0, r1, count);
}

// ---------------------------------------------------------------------------------------------
// Grouped horizontal bars (V1 vs V2 per scenario or per dataset)

export interface BarValue {
  value: number;
  lo?: number;
  hi?: number;
  /** Label text at the bar end (defaults to format(value)). */
  label?: string;
}

export interface BarGroup {
  label: string;
  /** One entry per series, in series order; null draws a "no data" marker. */
  values: Array<BarValue | null>;
  /** Text shown in place of a missing bar (e.g. "timeout"). Per series. */
  missing?: Array<string | undefined>;
}

export interface GroupedBarOptions {
  title: string;
  subtitle?: string;
  series: Array<{ key: SeriesKey; label: string; tag: string }>;
  groups: BarGroup[];
  axisLabel: string;
  format: (v: number) => string;
  scale?: 'auto' | 'linear' | 'log';
  footnote?: string;
}

export function groupedBarChart(o: GroupedBarOptions): string {
  const h = header({ title: o.title, subtitle: o.subtitle, legend: o.series.map((s) => ({ cls: `f-${s.key}`, label: s.label, kind: 'rect' as const })) });
  const tagW = Math.max(...o.series.map((s) => textWidth(s.tag, 11))) + 10;
  const x0 = PAD + tagW;
  const labels = o.groups.flatMap((g) => g.values.map((v) => (v ? v.label ?? o.format(v.value) : '')));
  const missing = o.groups.flatMap((g) => (g.missing ?? []).map((m) => m ?? ''));
  const reserve = Math.min(170, Math.max(40, ...labels.map((l) => textWidth(l, 11.5) + 12), ...missing.map((m) => textWidth(m, 11) - 40)));
  const x1 = CHART_WIDTH - PAD - reserve;
  const all = o.groups.flatMap((g) => g.values.flatMap((v) => (v ? [v.value, v.hi ?? v.value] : [])));
  const scale = chooseScale(all, o.scale ?? 'auto', x0, x1);
  const BAR = 14;
  const parts: string[] = [];
  let y = h.bottom + 4;
  const plotTop = y;
  const marks: string[] = [];
  for (const g of o.groups) {
    marks.push(text(x0 + 2, y + 11, truncate(g.label, 12, CHART_WIDTH - x0 - PAD), { cls: 't1 halo', size: 12, weight: 500 }));
    y += 18;
    o.series.forEach((s, i) => {
      const v = g.values[i];
      marks.push(text(x0 - 8, y + BAR - 3, s.tag, { cls: 't2', size: 11, anchor: 'end' }));
      if (!v || !Number.isFinite(v.value)) {
        const msg = g.missing?.[i] ?? 'no data';
        marks.push(text(x0 + 4, y + BAR - 3, msg, { cls: 't2 halo', size: 11 }));
      } else {
        const base = scale.log ? scale(scale.domain[0]) : scale(0);
        const xe = scale(v.value);
        const lbl = v.label ?? o.format(v.value);
        marks.push(hbar(base, y, xe - base, BAR, `f-${s.key}`, `${s.label}: ${lbl}`));
        let labelX = xe + 6;
        if (v.lo !== undefined && v.hi !== undefined && Number.isFinite(v.lo) && Number.isFinite(v.hi) && v.hi > v.lo) {
          const a = scale(v.lo);
          const b = scale(v.hi);
          const cy = y + BAR / 2;
          marks.push(line(a, cy, b, cy, 'wh', 1.25, ' opacity="0.75"'));
          marks.push(line(a, cy - 3.5, a, cy + 3.5, 'wh', 1.25, ' opacity="0.75"'));
          marks.push(line(b, cy - 3.5, b, cy + 3.5, 'wh', 1.25, ' opacity="0.75"'));
          labelX = Math.max(labelX, b + 6);
        }
        marks.push(text(labelX, y + BAR - 3, lbl, { cls: 't1 halo', size: 11.5 }));
      }
      y += BAR + 3;
    });
    y += 11;
  }
  const plotBottom = y - 8;
  for (const t of scale.ticks) {
    const x = scale(t);
    parts.push(line(x, plotTop, x, plotBottom, 'grid'));
    parts.push(text(x, plotBottom + 15, tickLabel(t), { cls: 't2', size: 11, anchor: 'middle' }));
  }
  parts.push(line(scale(scale.domain[0]), plotTop, scale(scale.domain[0]), plotBottom, 'axis'));
  parts.push(...marks);
  parts.push(text((x0 + x1) / 2, plotBottom + 32, `${o.axisLabel}${scale.log ? ' (log scale)' : ''}`, { cls: 't2', size: 11.5, anchor: 'middle' }));
  const f = footer(o.footnote, plotBottom + 36);
  return wrapSvg(o.title, o.subtitle ?? o.title, f.bottom + PAD, h.svg + parts.join('') + f.svg);
}

// ---------------------------------------------------------------------------------------------
// Line chart over an ordinal x axis (scaling with dataset size, throughput vs concurrency)

export interface LinePoint {
  value: number;
  lo?: number;
  hi?: number;
}

export interface LineChartOptions {
  title: string;
  subtitle?: string;
  xLabels: string[];
  xSublabels?: string[];
  series: Array<{ key: SeriesKey; label: string; tag: string; values: Array<LinePoint | null> }>;
  yLabel: string;
  format: (v: number) => string;
  scale?: 'auto' | 'linear' | 'log';
  footnote?: string;
}

interface EndLabel {
  y: number;
  py: number;
  px: number;
  text: string;
}

/** Pushes colliding end labels apart (minimal symmetric displacement), keeping their order. */
function placeEndLabels(labels: EndLabel[], minGap: number, top: number, bottom: number): EndLabel[] {
  const sorted = [...labels].sort((a, b) => a.py - b.py);
  for (const l of sorted) l.y = l.py;
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      const d = b.y - a.y;
      if (d < minGap) {
        const push = (minGap - d) / 2;
        a.y -= push;
        b.y += push;
        moved = true;
      }
    }
    for (const l of sorted) l.y = Math.min(bottom, Math.max(top, l.y));
    if (!moved) break;
  }
  return sorted;
}

export function lineChart(o: LineChartOptions): string {
  const h = header({ title: o.title, subtitle: o.subtitle, legend: o.series.map((s) => ({ cls: `s-${s.key}`, label: s.label, kind: 'line' as const })) });
  const vals = o.series.flatMap((s) => s.values.flatMap((p) => (p ? [p.value, p.hi ?? p.value, p.lo ?? p.value] : [])));
  const plotTop = h.bottom + 18;
  const plotH = 210;
  const plotBottom = plotTop + plotH;
  const yScale = chooseScale(vals, o.scale ?? 'auto', plotBottom, plotTop, 4);
  const tickW = Math.max(...yScale.ticks.map((t) => textWidth(tickLabel(t), 11)));
  const x0 = PAD + tickW + 10;
  const endLabels = o.series.map((s) => {
    const last = [...s.values].reverse().find((p) => p !== null);
    return last ? `${s.tag} ${o.format(last.value)}` : '';
  });
  const x1 = CHART_WIDTH - PAD - Math.min(170, Math.max(60, ...endLabels.map((l) => textWidth(l, 11.5) + 22)));
  const nx = o.xLabels.length;
  const xAt = (i: number) => x0 + ((i + 0.5) * (x1 - x0)) / nx;
  const parts: string[] = [];
  parts.push(text(x0, plotTop - 10, `${o.yLabel}${yScale.log ? ' (log scale)' : ''}`, { cls: 't2', size: 11.5 }));
  for (const t of yScale.ticks) {
    const y = yScale(t);
    parts.push(line(x0, y, x1, y, t === yScale.domain[0] ? 'axis' : 'grid'));
    parts.push(text(x0 - 6, y + 4, tickLabel(t), { cls: 't2', size: 11, anchor: 'end' }));
  }
  o.xLabels.forEach((l, i) => {
    parts.push(text(xAt(i), plotBottom + 16, l, { cls: 't2', size: 11.5, anchor: 'middle' }));
    const sub = o.xSublabels?.[i];
    if (sub) parts.push(text(xAt(i), plotBottom + 30, sub, { cls: 't3', size: 11, anchor: 'middle' }));
  });
  const ends: Array<EndLabel & { key: SeriesKey }> = [];
  for (const s of o.series) {
    const pts = s.values.map((p, i) => (p && Number.isFinite(p.value) ? { x: xAt(i), y: yScale(p.value), p } : null));
    // Missing points break the line instead of bridging it, so a gap never looks like a trend.
    let run: string[] = [];
    const flush = () => {
      if (run.length > 1) parts.push(`<polyline points="${run.join(' ')}" fill="none" class="s-${s.key}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
      run = [];
    };
    for (const q of pts) {
      if (q) run.push(`${n(q.x)},${n(q.y)}`);
      else flush();
    }
    flush();
    for (const q of pts) {
      if (!q) continue;
      if (q.p.lo !== undefined && q.p.hi !== undefined && q.p.hi > q.p.lo) {
        parts.push(line(q.x, yScale(q.p.lo), q.x, yScale(q.p.hi), `s-${s.key}`, 1.5, ' opacity="0.55"'));
      }
    }
    for (const q of pts) {
      if (!q) continue;
      parts.push(`<circle cx="${n(q.x)}" cy="${n(q.y)}" r="4.5" class="f-${s.key} ring" stroke-width="2"><title>${esc(`${s.label}, ${o.xLabels[pts.indexOf(q)]}: ${o.format(q.p.value)}`)}</title></circle>`);
    }
    const last = [...pts].reverse().find((q) => q !== null);
    if (last) ends.push({ key: s.key, px: last.x, py: last.y, y: last.y, text: `${s.tag} ${o.format(last.p.value)}` });
  }
  const placed = placeEndLabels(ends, 15, plotTop, plotBottom);
  for (const e of placed) {
    const lx = x1 + 12;
    if (Math.abs(e.y - e.py) > 1) parts.push(line(e.px + 6, e.py, lx - 3, e.y, 'lead', 1));
    parts.push(text(lx, e.y + 4, e.text, { size: 11.5 }));
  }
  const f = footer(o.footnote, plotBottom + (o.xSublabels ? 34 : 20));
  return wrapSvg(o.title, o.subtitle ?? o.title, f.bottom + PAD, h.svg + parts.join('') + f.svg);
}

// ---------------------------------------------------------------------------------------------
// Time series (idle and desktop footprint over time)

export interface TimeSeriesOptions {
  title: string;
  subtitle?: string;
  /** Each series may hold several runs; the first is drawn strong, repeats lighter. */
  series: Array<{ key: SeriesKey; label: string; tag: string; runs: Array<Array<[number, number]>> }>;
  xLabel: string;
  yLabel: string;
  format: (v: number) => string;
  markers?: Array<{ x: number; label: string }>;
  footnote?: string;
}

export function timeSeriesChart(o: TimeSeriesOptions): string {
  const multiRun = o.series.some((s) => s.runs.length > 1);
  const legend: LegendItem[] = o.series.map((s) => ({ cls: `s-${s.key}`, label: s.label, kind: 'line' as const }));
  const h = header({ title: o.title, subtitle: o.subtitle, legend });
  const pts = o.series.flatMap((s) => s.runs.flat());
  const maxX = Math.max(1, ...pts.map((p) => p[0]));
  const maxY = Math.max(0, ...pts.map((p) => p[1]));
  const plotTop = h.bottom + 18;
  const plotBottom = plotTop + 210;
  const yScale = linearScale(maxY, plotBottom, plotTop, 4);
  const tickW = Math.max(...yScale.ticks.map((t) => textWidth(tickLabel(t), 11)));
  const x0 = PAD + tickW + 10;
  const endTexts = o.series.map((s) => {
    const lasts = s.runs.map((r) => r[r.length - 1]?.[1]).filter((v): v is number => v !== undefined);
    return lasts.length ? `${s.tag} ${o.format(medianOf(lasts))}` : '';
  });
  const x1 = CHART_WIDTH - PAD - Math.min(170, Math.max(60, ...endTexts.map((l) => textWidth(l, 11.5) + 22)));
  const xScale = linearScale(maxX, x0, x1, 6, 0, true);
  const parts: string[] = [];
  parts.push(text(x0, plotTop - 10, o.yLabel, { cls: 't2', size: 11.5 }));
  for (const t of yScale.ticks) {
    const y = yScale(t);
    parts.push(line(x0, y, x1, y, t === 0 ? 'axis' : 'grid'));
    parts.push(text(x0 - 6, y + 4, tickLabel(t), { cls: 't2', size: 11, anchor: 'end' }));
  }
  for (const t of xScale.ticks) {
    parts.push(text(xScale(t), plotBottom + 16, tickLabel(t), { cls: 't2', size: 11, anchor: 'middle' }));
  }
  parts.push(text((x0 + x1) / 2, plotBottom + 32, o.xLabel, { cls: 't2', size: 11.5, anchor: 'middle' }));
  for (const m of o.markers ?? []) {
    if (m.x < 0 || m.x > xScale.domain[1]) continue;
    const x = xScale(m.x);
    parts.push(line(x, plotTop, x, plotBottom, 'axis'));
    parts.push(text(x + 4, plotTop + 11, m.label, { cls: 't3 halo', size: 11 }));
  }
  // Repeat runs first so the strong first run is drawn on top of them.
  for (const pass of [1, 0]) {
    for (const s of o.series) {
      s.runs.forEach((r, ri) => {
        if ((ri === 0) !== (pass === 0) || r.length < 2) return;
        const d = r.map((p) => `${n(xScale(p[0]))},${n(yScale(p[1]))}`).join(' ');
        const style = ri === 0 ? ' stroke-width="2"' : ' stroke-width="1.5" opacity="0.4"';
        parts.push(`<polyline points="${d}" fill="none" class="s-${s.key}"${style} stroke-linejoin="round" stroke-linecap="round"/>`);
      });
    }
  }
  const ends: EndLabel[] = [];
  o.series.forEach((s, i) => {
    const r0 = s.runs[0];
    const last = r0?.[r0.length - 1];
    if (!last) return;
    const px = xScale(last[0]);
    const py = yScale(last[1]);
    parts.push(`<circle cx="${n(px)}" cy="${n(py)}" r="4.5" class="f-${s.key} ring" stroke-width="2"/>`);
    ends.push({ px, py, y: py, text: endTexts[i]! });
  });
  for (const e of placeEndLabels(ends, 15, plotTop, plotBottom)) {
    const lx = x1 + 12;
    if (Math.abs(e.y - e.py) > 1) parts.push(line(e.px + 6, e.py, lx - 3, e.y, 'lead', 1));
    parts.push(text(lx, e.y + 4, e.text, { size: 11.5 }));
  }
  const note = [multiRun ? 'Lighter lines are repeat runs; end labels give the median over runs of the last sample.' : '', o.footnote ?? ''].filter(Boolean).join(' ');
  const f = footer(note || undefined, plotBottom + 36);
  return wrapSvg(o.title, o.subtitle ?? o.title, f.bottom + PAD, h.svg + parts.join('') + f.svg);
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ---------------------------------------------------------------------------------------------
// Stacked horizontal bars (size and per-role memory breakdowns)

export interface StackedBarOptions {
  title: string;
  subtitle?: string;
  /** Segment keys in stacking order; a key named "other" is drawn neutral and last. */
  keys: Array<{ key: string; label: string }>;
  rows: Array<{ label: string; segments: Record<string, number>; totalLabel?: string }>;
  axisLabel: string;
  format: (v: number) => string;
  footnote?: string;
}

export function stackedBarChart(o: StackedBarOptions): string {
  const keys = [...o.keys.filter((k) => k.key !== 'other'), ...o.keys.filter((k) => k.key === 'other')];
  const cls = new Map<string, { fill: string; txt: string }>();
  keys.forEach((k, i) => {
    const other = k.key === 'other' || i >= MAX_COMPONENTS;
    cls.set(k.key, other ? { fill: 'f-co', txt: 't-co' } : { fill: `f-c${i}`, txt: `t-c${i}` });
  });
  const h = header({ title: o.title, subtitle: o.subtitle, legend: keys.map((k) => ({ cls: cls.get(k.key)!.fill, label: k.label, kind: 'rect' as const })) });
  const labelW = Math.min(200, Math.max(...o.rows.map((r) => textWidth(r.label, 12, true))) + 12);
  const x0 = PAD + labelW;
  const totals = o.rows.map((r) => keys.reduce((s, k) => s + Math.max(0, r.segments[k.key] ?? 0), 0));
  const totalLabels = o.rows.map((r, i) => r.totalLabel ?? o.format(totals[i]!));
  const x1 = CHART_WIDTH - PAD - Math.min(150, Math.max(...totalLabels.map((l) => textWidth(l, 11.5, true) + 12)));
  const scale = linearScale(Math.max(...totals, 0), x0, x1, 5);
  const BAR = 22;
  const parts: string[] = [];
  const marks: string[] = [];
  const plotTop = h.bottom + 6;
  let y = plotTop;
  o.rows.forEach((r, ri) => {
    marks.push(text(x0 - 10, y + BAR / 2 + 4, r.label, { size: 12, weight: 600, anchor: 'end' }));
    let x = scale(0);
    const present = keys.filter((k) => (r.segments[k.key] ?? 0) > 0);
    present.forEach((k, i) => {
      const v = r.segments[k.key]!;
      const w = scale(v) - scale(0);
      const c = cls.get(k.key)!;
      const isLast = i === present.length - 1;
      const title = `${r.label}, ${k.label}: ${o.format(v)}`;
      if (isLast) marks.push(hbar(x, y, w, BAR, c.fill, title));
      else marks.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(w, 1))}" height="${BAR}" class="${c.fill}"><title>${esc(title)}</title></rect>`);
      const lbl = o.format(v);
      // A lone segment's value is the total, which is already printed at the bar end.
      if (present.length > 1 && textWidth(lbl, 11) + 10 <= w - 2) marks.push(text(x + w / 2, y + BAR / 2 + 4, lbl, { cls: c.txt, size: 11, anchor: 'middle' }));
      // The 2px surface gap between touching segments is what separates them, not a border.
      if (!isLast) marks.push(line(x + w, y - 0.5, x + w, y + BAR + 0.5, 'gap', 2));
      x += w;
    });
    marks.push(text(x + 8, y + BAR / 2 + 4, totalLabels[ri]!, { cls: 't1 halo', size: 11.5, weight: 600 }));
    y += BAR + 14;
  });
  const plotBottom = y - 6;
  for (const t of scale.ticks) {
    const x = scale(t);
    parts.push(line(x, plotTop - 4, x, plotBottom, 'grid'));
    parts.push(text(x, plotBottom + 15, tickLabel(t), { cls: 't2', size: 11, anchor: 'middle' }));
  }
  parts.push(line(scale(0), plotTop - 4, scale(0), plotBottom, 'axis'));
  parts.push(...marks);
  parts.push(text((x0 + x1) / 2, plotBottom + 32, o.axisLabel, { cls: 't2', size: 11.5, anchor: 'middle' }));
  const f = footer(o.footnote, plotBottom + 36);
  return wrapSvg(o.title, o.subtitle ?? o.title, f.bottom + PAD, h.svg + parts.join('') + f.svg);
}

// ---------------------------------------------------------------------------------------------
// Advantage plot (headline): how many times better V2 is than V1, per metric, on a log axis
// centred on "equal", with the bootstrap CI as a whisker.

export interface AdvantageRow {
  label: string;
  /** Section heading row (no mark). */
  heading?: boolean;
  /** >1: V2 better by that factor; <1: V1 better by 1/x. */
  advantage?: number;
  lo?: number;
  hi?: number;
  /** Filled with the winner's color when significant; an open ring in that color when decided on too few runs to test; grey when no difference. */
  winner?: SeriesKey | null;
  /** The winner was decided by value on too few runs for a significance test. */
  untested?: boolean;
  valueText?: string;
}

export interface AdvantageOptions {
  title: string;
  subtitle?: string;
  rows: AdvantageRow[];
  labels: Record<SeriesKey, string>;
  footnote?: string;
}

function niceFactor(x: number): number {
  for (const f of [2, 5, 10, 20, 50, 100, 200, 500, 1000, 10000]) if (x <= f) return f;
  return 10 ** Math.ceil(Math.log10(x));
}

export function advantageChart(o: AdvantageOptions): string {
  const legend: LegendItem[] = [
    { cls: 'f-v1 ring', label: `${o.labels.v1} better`, kind: 'dot' },
    { cls: 'f-v2 ring', label: `${o.labels.v2} better`, kind: 'dot' },
    { cls: 'o-v2', label: 'too few runs to test', kind: 'dot' },
    { cls: 'hollow', label: 'no meaningful difference', kind: 'dot' },
  ];
  const h = header({ title: o.title, subtitle: o.subtitle, legend });
  const extent = Math.max(
    2,
    ...o.rows.flatMap((r) => [r.advantage, r.lo, r.hi].filter((v): v is number => v !== undefined && Number.isFinite(v) && v > 0).map((v) => Math.max(v, 1 / v))),
  );
  const M = niceFactor(extent * 1.05);
  // Row labels are indented 10px under their section heading; budget for it.
  const labelW = Math.min(340, Math.max(...o.rows.map((r) => textWidth(r.label, 12, !!r.heading) + (r.heading ? 0 : 10))) + 16);
  const valueW = Math.min(130, Math.max(60, ...o.rows.map((r) => textWidth(r.valueText ?? '', 11.5) + 14)));
  const x0 = PAD + labelW;
  const x1 = CHART_WIDTH - PAD - valueW;
  const lx = (v: number) => x0 + ((Math.log10(v) + Math.log10(M)) / (2 * Math.log10(M))) * (x1 - x0);
  const ROW = 24;
  const parts: string[] = [];
  const marks: string[] = [];
  const plotTop = h.bottom + 22;
  parts.push(text(lx(1) - 8, plotTop - 8, `\u2190 ${o.labels.v1} better`, { cls: 't2', size: 11.5, anchor: 'end' }));
  parts.push(text(lx(1) + 8, plotTop - 8, `${o.labels.v2} better \u2192`, { cls: 't2', size: 11.5 }));
  let y = plotTop;
  for (const r of o.rows) {
    const cy = y + ROW / 2;
    if (r.heading) {
      marks.push(text(PAD, cy + 8, r.label, { size: 12, weight: 700 }));
      y += ROW + 4;
      continue;
    }
    marks.push(text(PAD + 10, cy + 4, truncate(r.label, 12, labelW - 16), { size: 12 }));
    if (r.advantage !== undefined && Number.isFinite(r.advantage) && r.advantage > 0) {
      const clamp = (v: number) => Math.min(M, Math.max(1 / M, v));
      if (r.lo !== undefined && r.hi !== undefined && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo) {
        const a = lx(clamp(r.lo));
        const b = lx(clamp(r.hi));
        marks.push(line(a, cy, b, cy, 'wh', 1.5, ' opacity="0.7"'));
        marks.push(line(a, cy - 4, a, cy + 4, 'wh', 1.5, ' opacity="0.7"'));
        marks.push(line(b, cy - 4, b, cy + 4, 'wh', 1.5, ' opacity="0.7"'));
      }
      const cx = lx(clamp(r.advantage));
      const cl = r.winner ? (r.untested ? `o-${r.winner}` : `f-${r.winner} ring`) : 'hollow';
      marks.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="5.5" class="${cl}" stroke-width="2"><title>${esc(`${r.label}: ${r.valueText ?? ''}`)}</title></circle>`);
    }
    if (r.valueText) marks.push(text(x1 + 12, cy + 4, r.valueText, { size: 11.5 }));
    y += ROW;
  }
  const plotBottom = y + 2;
  const ticks: number[] = [];
  for (const f of [1000, 100, 10, 1]) if (f <= M) ticks.push(1 / f);
  for (const f of [10, 100, 1000]) if (f <= M) ticks.push(f);
  if (M < 10) ticks.push(1 / 2, 2);
  ticks.sort((a, b) => a - b);
  for (const t of [...new Set(ticks)]) {
    const x = lx(t);
    parts.push(line(x, plotTop, x, plotBottom, t === 1 ? 'axis' : 'grid', t === 1 ? 1.5 : 1));
    const f = t >= 1 ? t : 1 / t;
    parts.push(text(x, plotBottom + 15, t === 1 ? 'equal' : `${tickLabel(f)}x`, { cls: 't2', size: 11, anchor: 'middle' }));
  }
  parts.push(...marks);
  parts.push(text((x0 + x1) / 2, plotBottom + 32, 'times better (log scale); whisker = 95% bootstrap CI', { cls: 't2', size: 11.5, anchor: 'middle' }));
  const f = footer(o.footnote, plotBottom + 36);
  return wrapSvg(o.title, o.subtitle ?? o.title, f.bottom + PAD, h.svg + parts.join('') + f.svg);
}
