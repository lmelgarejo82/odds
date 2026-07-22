export type OuMetrics = Readonly<{ over25: number; under25: number }>;

export function immutableSnapshot<T extends object>(snapshot: T): Readonly<T> {
  return Object.freeze({ ...snapshot });
}

export function separateSides(metrics: OuMetrics): { over: number; under: number } {
  return { over: metrics.over25, under: metrics.under25 };
}
