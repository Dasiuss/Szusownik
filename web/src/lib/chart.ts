export interface DistanceAxis {
  domain: [number, number];
  ticks: number[];
}

export function getDistanceAxis(maxDistanceKm: number): DistanceAxis {
  const step = maxDistanceKm < 2 ? 0.25 : maxDistanceKm < 6 ? 0.5 : 1;
  const maxTick = Math.max(step, Math.ceil(maxDistanceKm / step) * step);
  const tickCount = Math.round(maxTick / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) =>
    Number((index * step).toFixed(2)),
  );

  return {
    domain: [0, maxTick],
    ticks,
  };
}
