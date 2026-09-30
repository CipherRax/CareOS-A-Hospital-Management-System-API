import {
  axisBounds,
  barChartGeometry,
  barGeometry,
  lineChartGeometry,
  prepareSeries,
  valueToY,
} from '../../../src/jobs/pdf/pdf-charts';

const BOX = { x: 0, y: 0, width: 400, height: 200 };

describe('prepareSeries', () => {
  it('keeps finite points and counts the rest', () => {
    const prepared = prepareSeries([
      { label: 'a', value: 1 },
      { label: 'b', value: Number.NaN },
      { label: 'c', value: 3 },
      { label: 'd', value: Number.POSITIVE_INFINITY },
      { label: 'e', value: null },
    ]);
    expect(prepared.points).toEqual([
      { label: 'a', value: 1 },
      { label: 'c', value: 3 },
    ]);
    // The whole point: a dropped point is a reported number, not a silent gap.
    expect(prepared.total).toBe(5);
    expect(prepared.omittedInvalid).toBe(3);
    expect(prepared.omittedByCap).toBe(0);
  });

  it('coerces numeric strings, because a String() on the way to a document is not a reason to draw nothing', () => {
    const prepared = prepareSeries([
      { label: 'a', value: '12' },
      { label: 'b', value: ' 3.5 ' },
      { label: 'c', value: 'not a number' },
      { label: 'd', value: '' },
    ]);
    expect(prepared.points).toEqual([
      { label: 'a', value: 12 },
      { label: 'b', value: 3.5 },
    ]);
    expect(prepared.omittedInvalid).toBe(2);
  });

  it('labels a blank category positionally so an unlabelled bar stays identifiable', () => {
    const prepared = prepareSeries([
      { label: '', value: 1 },
      { label: '   ', value: 2 },
    ]);
    expect(prepared.points.map((p) => p.label)).toEqual(['#1', '#2']);
  });

  it('caps the series and reports how many were withheld', () => {
    const input = Array.from({ length: 10 }, (_, i) => ({ label: `p${i}`, value: i }));
    const prepared = prepareSeries(input, 4);
    expect(prepared.points).toHaveLength(4);
    expect(prepared.omittedByCap).toBe(6);
    expect(prepared.omittedInvalid).toBe(0);
    // Cap is applied after validity, so a cap never hides an invalid value.
    expect(prepared.total).toBe(10);
  });

  it('treats a zero cap as one rather than dropping everything', () => {
    expect(prepareSeries([{ label: 'a', value: 1 }], 0).points).toHaveLength(1);
  });

  it('survives a hostile input shape', () => {
    const prepared = prepareSeries([
      null as unknown as { label: string; value: unknown },
      undefined as unknown as { label: string; value: unknown },
      { label: 'ok', value: 7 },
    ]);
    expect(prepared.points).toEqual([{ label: 'ok', value: 7 }]);
    expect(prepared.omittedInvalid).toBe(2);
  });
});

describe('axisBounds', () => {
  it('snaps to readable 1/2/5 steps', () => {
    const [ticks, min, max] = axisBounds(0, 97);
    expect(ticks.every((t) => Number.isFinite(t))).toBe(true);
    // Readable numbers, not 19.4 / 38.8 / 58.2.
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(min).toBe(0);
    expect(max).toBe(100);
  });

  it('uses a round fractional step rather than floating point noise', () => {
    // 0..1 across a 5-tick target picks a 0.2 step. What matters is that every
    // label is a number a person would write, not 0.30000000000000004.
    const [ticks] = axisBounds(0, 1);
    expect(ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(ticks.every((t) => String(t).length <= 4)).toBe(true);
  });

  it('gives an all-zero series a real band so it is not drawn on the axis', () => {
    const [ticks, min, max] = axisBounds(0, 0);
    expect(min).toBe(0);
    expect(max).toBe(1);
    expect(ticks).toEqual([0, 1]);
  });

  it('spreads a flat non-zero series around its value', () => {
    const [, min, max] = axisBounds(5, 5);
    expect(min).toBeLessThan(5);
    expect(max).toBeGreaterThan(5);
  });

  it('orders a reversed range and spans both', () => {
    const [, min, max] = axisBounds(10, 2);
    expect(min).toBeLessThanOrEqual(2);
    expect(max).toBeGreaterThanOrEqual(10);
  });

  it('terminates on a pathological range instead of spinning', () => {
    const [ticks] = axisBounds(0, Number.MAX_VALUE);
    expect(ticks.length).toBeLessThanOrEqual(200);
  });

  it('degrades rather than throwing on non-finite input', () => {
    expect(axisBounds(Number.NaN, 5)).toEqual([[], 0, 1]);
  });
});

describe('valueToY', () => {
  it('inverts: larger values sit higher (smaller y in PDF space)', () => {
    const geometry = { yMin: 0, yMax: 10, top: 0, bottom: 100 };
    expect(valueToY(geometry, 0)).toBe(100);
    expect(valueToY(geometry, 10)).toBe(0);
    expect(valueToY(geometry, 5)).toBe(50);
  });

  it('maps a zero-span axis to the baseline rather than dividing by zero', () => {
    const geometry = { yMin: 3, yMax: 3, top: 10, bottom: 50 };
    expect(valueToY(geometry, 3)).toBe(50);
  });
});

describe('barGeometry', () => {
  it('returns null for no data, which the renderer turns into a stated "no data"', () => {
    expect(barGeometry([], BOX)).toBeNull();
  });

  it('returns null for a box with no room', () => {
    expect(
      barGeometry([{ label: 'a', value: 1 }], { ...BOX, width: 0, height: 0 }),
    ).toBeNull();
  });

  it('always includes zero, so bar length is comparable across charts', () => {
    // Truncating a bar axis is the original sin of chart drawing.
    const geometry = barGeometry([{ label: 'a', value: 90 }], BOX);
    expect(geometry?.yMin).toBe(0);
  });

  it('keeps zero in range for an all-negative series', () => {
    const geometry = barGeometry([{ label: 'a', value: -5 }], BOX);
    expect(geometry?.yMax).toBe(0);
  });
});

describe('barChartGeometry', () => {
  it('draws no bar for an exact zero, so zero is not confused with a tiny value', () => {
    const geometry = barChartGeometry([{ label: 'a', value: 0 }], BOX);
    expect(geometry?.marks[0]?.height).toBe(0);
  });

  it('gives a small non-zero value a visible bar', () => {
    const geometry = barChartGeometry([{ label: 'a', value: 0.0001 }], BOX);
    const mark = geometry?.marks[0];
    expect(mark?.height).toBeGreaterThan(0);
  });

  it('keeps a tiny negative bar below the zero line, not above it', () => {
    // The sign bug this guards: flooring a negative bar's height without
    // respecting direction would place it over the axis and read as positive.
    const geometry = barChartGeometry([{ label: 'a', value: -0.0001 }], BOX);
    expect(geometry?.marks[0]?.y).toBeGreaterThanOrEqual(geometry?.zeroY ?? 0);
  });

  it('hangs a negative bar downward from the zero line', () => {
    // PDF y grows downward, so a negative bar's rect starts at the zero line
    // and extends below it. Anchoring it at its own value would draw it
    // detached from the axis.
    const geometry = barChartGeometry([{ label: 'a', value: -10 }], BOX);
    const mark = geometry?.marks[0];
    expect(mark?.y).toBeCloseTo(geometry?.zeroY ?? 0, 6);
    expect((mark?.y ?? 0) + (mark?.height ?? 0)).toBeGreaterThan(geometry?.zeroY ?? 0);
  });

  it('lifts a positive bar upward from the zero line', () => {
    const geometry = barChartGeometry([{ label: 'a', value: 10 }], BOX);
    const mark = geometry?.marks[0];
    expect((mark?.y ?? 0) + (mark?.height ?? 0)).toBeCloseTo(geometry?.zeroY ?? 0, 6);
    expect(mark?.y).toBeLessThan(geometry?.zeroY ?? 0);
  });

  it('scales a taller value to a taller bar', () => {
    const geometry = barChartGeometry(
      [
        { label: 'small', value: 1 },
        { label: 'big', value: 100 },
      ],
      BOX,
    );
    const small = geometry?.marks[0]?.height ?? 0;
    const big = geometry?.marks[1]?.height ?? 0;
    expect(big).toBeGreaterThan(small);
  });

  it('spaces bars evenly across the plot with a gap between them', () => {
    const geometry = barChartGeometry(
      [
        { label: 'a', value: 1 },
        { label: 'b', value: 2 },
        { label: 'c', value: 3 },
      ],
      BOX,
    );
    const marks = geometry?.marks ?? [];
    expect(marks).toHaveLength(3);
    expect(marks[1]!.x).toBeGreaterThan(marks[0]!.x);
    expect(marks[2]!.x).toBeGreaterThan(marks[1]!.x);
    for (const mark of marks) expect(mark.width).toBeLessThan(geometry!.width / 3);
  });

  it('produces a bar no wider than a pixel for a very long series', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({ label: `p${i}`, value: i }));
    const geometry = barChartGeometry(points, BOX);
    for (const mark of geometry?.marks ?? [])
      expect(mark.width).toBeGreaterThanOrEqual(1);
  });
});

describe('lineChartGeometry', () => {
  it('returns null for no data', () => {
    expect(lineChartGeometry([], BOX)).toBeNull();
  });

  it('follows the data range instead of forcing a zero baseline', () => {
    // A 90-100ms series flattened onto a 0-based axis would lose the signal
    // the chart exists to show, so the axis hugs the data.
    const geometry = lineChartGeometry(
      [
        { label: 'a', value: 90 },
        { label: 'b', value: 100 },
      ],
      BOX,
    );
    expect(geometry?.yMin).toBe(90);
    expect(geometry?.yMax).toBe(100);
  });

  it('gives a flat series a band so it is not drawn on a collapsed axis', () => {
    const geometry = lineChartGeometry(
      [
        { label: 'a', value: 7 },
        { label: 'b', value: 7 },
      ],
      BOX,
    );
    expect(geometry?.yMin).toBeLessThan(7);
    expect(geometry?.yMax).toBeGreaterThan(7);
  });

  it('spaces points evenly and returns one point per input', () => {
    const geometry = lineChartGeometry(
      [
        { label: 'a', value: 1 },
        { label: 'b', value: 2 },
        { label: 'c', value: 3 },
      ],
      BOX,
    );
    const path = geometry?.path ?? [];
    expect(path).toHaveLength(3);
    expect(path[1]!.x - path[0]!.x).toBeCloseTo(path[2]!.x - path[1]!.x, 6);
  });

  it('centres a single point instead of dividing by a zero width', () => {
    const geometry = lineChartGeometry([{ label: 'only', value: 5 }], BOX);
    const only = geometry?.path[0];
    expect(only).toBeDefined();
    expect(only!.x).toBeCloseTo(geometry!.left + geometry!.width / 2, 6);
  });
});
