import type { StoredRun } from "./db.ts";

export interface DayRunSegment {
  endD: number;
  index: number;
  run: StoredRun;
}

/**
 * Rzeczywista rozpiętość próbek zjazdu na wspólnej osi dnia — bez pomijania
 * wyciągu. `distanceM` zjazdu liczy tylko część schodzącą (wyciąg jest w
 * `samples` na wykresie), więc os wykresu musi iść po próbkach, a nie po
 * `distanceM`, inaczej linia cofa się na granicy zjazdów.
 */
export function runSampleSpanM(run: StoredRun): number {
  const first = run.samples[0]?.cumDistM ?? 0;
  const last = run.samples[run.samples.length - 1]?.cumDistM ?? first;
  return Math.max(last - first, 0);
}

/** Granice segmentów na osi wykresu dnia (koniec każdego zjazdu). */
export function buildDayRunSegments(runs: StoredRun[]): DayRunSegment[] {
  const baseM = runs[0]?.samples[0]?.cumDistM ?? 0;
  return runs.map((run, index) => {
    const last = run.samples[run.samples.length - 1]?.cumDistM ?? baseM;
    return { endD: (last - baseM) / 1000, index, run };
  });
}
