export interface DistanceAxis {
  domain: [number, number];
  ticks: number[];
}

export type DistanceDomain = [number, number];

/**
 * Minimalna szerokość widocznego okna w km — zabezpieczenie numeryczne przy
 * bardzo mocnym przybliżeniu, nie jest limitem produktowym.
 */
export const MIN_DOMAIN_KM = 0.0001;

const DEFAULT_EMPTY_DOMAIN: DistanceDomain = [0, 0.25];

/**
 * Dobór kroku ticków dystansu do szerokości widocznego okna. Drobne kroki
 * (0.05/0.1) są potrzebne przy mocnym przybliżeniu, żeby ticki nie znikały.
 * Progi dla szerszych okien zachowują dotychczasowe 0.25/0.5/1 km.
 */
export function getDistanceStep(spanKm: number): number {
  const span = Math.round(spanKm * 1000) / 1000;
  if (span < 0.3) return 0.05;
  if (span < 0.75) return 0.1;
  if (span < 2) return 0.25;
  if (span < 6) return 0.5;
  return 1;
}

function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function decimalsForStep(step: number): number {
  return String(step).split(".")[1]?.length ?? 0;
}

/** Pełny zakres od zera — używany dla nieprzybliżonego wykresu. */
export function getDistanceAxis(maxDistanceKm: number): DistanceAxis {
  if (!(maxDistanceKm > 0)) {
    return { domain: [...DEFAULT_EMPTY_DOMAIN], ticks: [...DEFAULT_EMPTY_DOMAIN] };
  }
  const step = getDistanceStep(maxDistanceKm);
  const maxTick = Math.max(step, Math.ceil(maxDistanceKm / step) * step);
  const decimals = decimalsForStep(step);
  const tickCount = Math.round(maxTick / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) =>
    roundTo(index * step, decimals),
  );

  return {
    domain: [0, maxTick],
    ticks,
  };
}

/**
 * Ticki dla dowolnego widocznego okna (po przybliżeniu). Domena zostaje
 * dokładnie taka, jak okno — nie rozciągamy jej do pełnego kroku.
 */
export function getDistanceAxisForDomain(minKm: number, maxKm: number): DistanceAxis {
  const span = maxKm - minKm;
  if (!(span > 0) || !Number.isFinite(span)) {
    return { domain: [minKm, maxKm], ticks: [] };
  }
  let step = getDistanceStep(span);
  let decimals = decimalsForStep(step);
  const buildTicks = (current: number, currentDecimals: number): number[] => {
    const first = Math.ceil(roundTo(minKm / current, 6));
    const last = Math.floor(roundTo(maxKm / current, 6));
    const ticks: number[] = [];
    for (let index = first; index <= last; index++) {
      ticks.push(roundTo(index * current, currentDecimals));
    }
    return ticks;
  };
  let ticks = buildTicks(step, decimals);
  // Przy bardzo mocnym przybliżeniu (brak limitu zoomu) zagęszczamy krok tak,
  // żeby ticki nie znikały całkowicie.
  for (let guard = 0; ticks.length < 2 && guard < 8; guard++) {
    step /= 5;
    decimals = decimalsForStep(step);
    ticks = buildTicks(step, decimals);
  }
  return { domain: [minKm, maxKm], ticks };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Porządkuje domenę i ogranicza ją do [0, dataMax]. */
export function clampDomain(domain: DistanceDomain, dataMax: number): DistanceDomain {
  const upper = Math.max(dataMax, 0);
  let [min, max] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  const span = clamp(max - min, Math.min(MIN_DOMAIN_KM, upper), upper);
  min = clamp(min, 0, Math.max(upper - span, 0));
  return [min, min + span];
}

/**
 * Zmienia szerokość okna o `factor` (<1 przybliża, >1 oddala), zakotwiczając
 * punkt `anchorFraction` (0..1) w miejscu. Ogranicza wynik do zakresu danych.
 */
export function zoomDomain(
  domain: DistanceDomain,
  dataMax: number,
  factor: number,
  anchorFraction: number,
): DistanceDomain {
  const upper = Math.max(dataMax, 0);
  const span = domain[1] - domain[0];
  if (!(span > 0) || !Number.isFinite(factor)) return clampDomain(domain, upper);
  const anchor = clamp(anchorFraction, 0, 1);
  const newSpan = clamp(span * factor, Math.min(MIN_DOMAIN_KM, upper), upper);
  const anchorPoint = domain[0] + span * anchor;
  const newMin = clamp(anchorPoint - newSpan * anchor, 0, Math.max(upper - newSpan, 0));
  return [newMin, newMin + newSpan];
}

/** Przesuwa okno o `deltaKm` (dodatnie = w stronę większego dystansu). */
export function panDomain(
  domain: DistanceDomain,
  dataMax: number,
  deltaKm: number,
): DistanceDomain {
  const upper = Math.max(dataMax, 0);
  const span = domain[1] - domain[0];
  const newMin = clamp(domain[0] + deltaKm, 0, Math.max(upper - span, 0));
  return [newMin, newMin + span];
}
