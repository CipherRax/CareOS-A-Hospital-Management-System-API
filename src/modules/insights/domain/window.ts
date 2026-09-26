/** Shared window resolution for analytics/report endpoints. */

export interface ResolvedWindow {
  from: Date;
  to: Date;
}

export function resolveWindow(
  from?: Date,
  to?: Date,
  lookbackDays = 30,
): ResolvedWindow {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - lookbackDays * 86_400_000);
  return { from: fromDate, to: toDate };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}