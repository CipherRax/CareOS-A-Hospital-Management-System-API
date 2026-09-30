/**
 * Chart geometry and data hygiene, with no dependency on the PDF library.
 *
 * Two things are being defended here, and both come from the same failure mode:
 * a chart that looks authoritative but is not true. The P9 work made the same
 * argument in a different medium — a mean that hides one request unacknowledged
 * for forty minutes is a *wrong* number, not a coarse one.
 *
 *  1. Missing data must be visible. A chart with no usable points renders the
 *     words "no data", never an empty plot area. An empty axis grid reads as
 *     "every value is zero", which is a materially different claim.
 *  2. Dropped data must be disclosed. Non-finite values (NaN from a divide, ±∞
 *     from a bad backfill) and values removed by a cap are *counted* and
 *     reported under the chart, because a clinical report that silently omits
 *     a data point is not a report.
 *
 * Bars encode magnitude by length, so their axis always includes zero —
 * truncating a bar axis is the original sin of chart-drawing. Lines encode
 * trend by position, so their axis follows the data range; forcing a line chart
 * of 90–100ms latencies down to a 0-based axis would flatten the signal the
 * chart exists to show.
 */
import type { PdfChartPoint } from './pdf-document';

export const DEFAULT_MAX_BARS = 60;
export const DEFAULT_MAX_POINTS = 200;

export interface PreparedSeries {
  /** Usable points, in input order. */
  points: PdfChartPoint[];
  /** Points handed in, before any filtering. */
  total: number;
  /** Points rejected because the value was not a finite number. */
  omittedInvalid: number;
  /** Points rejected because they exceeded the cap. */
  omittedByCap: number;
}

/**
 * Coerce raw chart input into a series we can draw, accounting for everything
 * we throw away.
 *
 * Numeric strings are accepted (`"12"` → 12) because report builders routinely
 * reach values through `String()` on their way to a document; refusing to draw
 * a chart over a formatting accident is a worse failure than drawing it. Blank
 * labels become positional labels so an unlabelled bar is still identifiable.
 */
export function prepareSeries(
  input: ReadonlyArray<{ label: unknown; value: unknown }>,
  cap: number = DEFAULT_MAX_BARS,
): PreparedSeries {
  const points: PdfChartPoint[] = [];
  let omittedInvalid = 0;
  const safeCap = Math.max(1, Math.floor(Number.isFinite(cap) ? cap : DEFAULT_MAX_BARS));
  let omittedByCap = 0;

  input.forEach((entry, index) => {
    const rawLabel = entry?.label;
    const label =
      typeof rawLabel === 'string' && rawLabel.trim() !== ''
        ? rawLabel.trim()
        : `#${index + 1}`;
    const value = toFiniteNumber(entry?.value);
    if (value === null) {
      omittedInvalid += 1;
      return;
    }
    if (points.length >= safeCap) {
      omittedByCap += 1;
      return;
    }
    points.push({ label, value });
  });

  return { points, total: input.length, omittedInvalid, omittedByCap };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface PlotBox {
  x: number;
  y: number;
  width: number;
  height: number;
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
}

export interface ChartGeometry {
  /** Where to draw, after padding. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  /** Axis bounds, always spanning every plotted value. */
  yMin: number;
  yMax: number;
  /** Round tick values for the y axis, ascending. */
  ticks: number[];
  /** y coordinate of value 0, for drawing a zero line. */
  zeroY: number;
}

const DEFAULT_PADDING = { top: 8, right: 8, bottom: 26, left: 44 };

function innerBox(box: PlotBox): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
} {
  const padding = { ...DEFAULT_PADDING, ...box.padding };
  const left = box.x + padding.left;
  const top = box.y + padding.top;
  const width = Math.max(0, box.width - padding.left - padding.right);
  const height = Math.max(0, box.height - padding.top - padding.bottom);
  return { left, top, right: left + width, bottom: top + height, width, height };
}

/** Map a value to a y coordinate. Exported so the renderer and the tests agree. */
export function valueToY(
  geometry: Pick<ChartGeometry, 'yMin' | 'yMax' | 'top' | 'bottom'>,
  value: number,
): number {
  const span = geometry.yMax - geometry.yMin;
  if (span === 0) return geometry.bottom;
  const ratio = (value - geometry.yMin) / span;
  return geometry.bottom - ratio * (geometry.bottom - geometry.top);
}

/**
 * Geometry for a bar chart, or `null` when there is nothing to draw. A `null`
 * return is a distinct state from a zero-height box on purpose: the renderer
 * must print "no data" rather than draw an empty grid.
 */
export function barGeometry(points: PdfChartPoint[], box: PlotBox): ChartGeometry | null {
  if (points.length === 0) return null;
  const inner = innerBox(box);
  if (inner.width <= 0 || inner.height <= 0) return null;

  // Bars encode magnitude by length, so zero is always on the axis.
  const values = points.map((p) => p.value);
  const yMin = Math.min(0, ...values);
  const yMax = Math.max(0, ...values);
  const [ticks, yMinT, yMaxT] = axisBounds(yMin, yMax);
  const geometry: ChartGeometry = {
    ...inner,
    yMin: yMinT,
    yMax: yMaxT,
    ticks,
    zeroY: valueToY(
      { yMin: yMinT, yMax: yMaxT, top: inner.top, bottom: inner.bottom },
      0,
    ),
  };
  return geometry;
}

export interface BarMark {
  point: PdfChartPoint;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarChartGeometry extends ChartGeometry {
  marks: BarMark[];
  /** Gaps kept between bars, as a fraction of the slot width. */
  gapRatio: number;
}

export const BAR_GAP_RATIO = 0.3;
const MIN_VISIBLE_BAR = 0.75;
/** Upper bound on y-axis ticks, so a pathological value range cannot spin. */
const MAX_TICKS = 200;

export function barChartGeometry(
  points: PdfChartPoint[],
  box: PlotBox,
): BarChartGeometry | null {
  const geometry = barGeometry(points, box);
  if (!geometry) return null;

  const slot = geometry.width / points.length;
  const barWidth = Math.max(1, slot * (1 - BAR_GAP_RATIO));
  const marks: BarMark[] = points.map((point, index) => {
    const valueY = valueToY(geometry, point.value);
    const rawHeight = Math.abs(valueY - geometry.zeroY);
    // A non-zero value must never render as an invisible sliver: a reader
    // cannot distinguish "tiny" from "absent" on a 0.4pt bar.
    const height = point.value === 0 ? 0 : Math.max(MIN_VISIBLE_BAR, rawHeight);
    // PDF y grows downward, so a positive value's bar extends upward from the
    // zero line and a negative value's bar extends downward. The rect's `y` is
    // always the smaller of the two coordinates, so a negative bar has to start
    // at the zero line — anchoring it at its own value would draw it detached
    // from the axis. The floor case keeps that direction, otherwise a small
    // negative value would be nudged above the zero line and read as positive.
    const above = valueY <= geometry.zeroY;
    const y =
      height === 0
        ? geometry.zeroY
        : rawHeight >= height
          ? above
            ? valueY
            : geometry.zeroY
          : geometry.zeroY + (above ? -height : height);
    return {
      point,
      x: geometry.left + index * slot + (slot - barWidth) / 2,
      y,
      width: barWidth,
      height,
    };
  });

  return { ...geometry, marks, gapRatio: BAR_GAP_RATIO };
}

export interface LineChartGeometry extends ChartGeometry {
  /** Plot-area points in draw order, or empty when there is nothing to plot. */
  path: Array<{ x: number; y: number; point: PdfChartPoint }>;
}

/**
 * Geometry for a line chart, or `null` when there is nothing to draw.
 *
 * Unlike bars, the axis follows the data range (padded) rather than including
 * zero, so a 90–100ms series keeps its shape instead of flattening onto the
 * baseline.
 */
export function lineChartGeometry(
  points: PdfChartPoint[],
  box: PlotBox,
): LineChartGeometry | null {
  if (points.length === 0) return null;
  const inner = innerBox(box);
  if (inner.width <= 0 || inner.height <= 0) return null;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin;
  // A flat series has no trend to show, so give it a band to sit in rather
  // than dividing by zero or collapsing onto the axis.
  const pad = span === 0 ? (rawMin === 0 ? 1 : Math.abs(rawMin) * 0.1) : 0;
  const [ticks, yMin, yMax] = axisBounds(rawMin - pad, rawMax + pad);

  const geometry: ChartGeometry = { ...inner, yMin, yMax, ticks, zeroY: 0 };
  const slot = points.length === 1 ? 0 : geometry.width / (points.length - 1);
  const path = points.map((point, index) => ({
    x:
      points.length === 1
        ? geometry.left + geometry.width / 2
        : geometry.left + index * slot,
    y: valueToY(geometry, point.value),
    point,
  }));

  return { ...geometry, zeroY: valueToY(geometry, 0), path };
}

/**
 * Round tick values spanning [min, max].
 *
 * Steps are snapped to 1/2/5×10ⁿ so axis labels are readable numbers rather
 * than 3.3333. The loop is bounded because a pathological step (denormal range,
 * huge magnitudes) would otherwise spin.
 */
export function axisBounds(
  min: number,
  max: number,
  target = 5,
): [number[], number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [[], 0, 1];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);

  if (lo === hi) {
    if (lo === 0) return [[0, 1], 0, 1];
    const pad = Math.abs(lo) * 0.5;
    lo -= pad;
    hi += pad;
  }

  const step = niceStep((hi - lo) / Math.max(1, target - 1));
  if (!(step > 0) || !Number.isFinite(step)) return [[lo, hi], lo, hi];

  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const decimals = Math.min(12, Math.max(0, -Math.floor(Math.log10(step))));
  const ticks: number[] = [];
  // Bounded: a denormal or astronomically large range would otherwise spin here
  // and produce a meaningless axis. Truncating is the right failure — a short
  // axis — rather than a hang.
  for (let i = 0; i < MAX_TICKS; i += 1) {
    const value = niceMin + i * step;
    if (value > niceMax + step * 1e-9) break;
    ticks.push(Number(value.toFixed(decimals)));
  }
  if (ticks.length < 2) return [[niceMin, niceMax], niceMin, niceMax];
  return [ticks, ticks[0] as number, ticks[ticks.length - 1] as number];
}

function niceStep(range: number): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  const nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return nice * 10 ** exponent;
}
