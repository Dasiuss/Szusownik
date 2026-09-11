// Geometria i wygładzanie (defaulty z wymagania-PWA §6, konfigurowalne).

const R_EARTH_M = 6371000;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(a));
}

/** Średnia ruchoma. Okno 1 = brak wygładzania. */
export function movingAvg(xs: number[], window: number): number[] {
  if (window <= 1) return xs.slice();
  const out = new Array<number>(xs.length);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= window) sum -= xs[i - window];
    out[i] = sum / Math.min(i + 1, window);
  }
  return out;
}

/** Nachylenie w stopniach z Δh/Δd dla każdego punktu (okno ~15 m dystansu). */
export function gradeDeg(altSm: number[], cumDistM: number[], windowM = 15): number[] {
  const out = new Array<number>(altSm.length).fill(0);
  for (let i = 0; i < altSm.length; i++) {
    let j = i;
    while (j > 0 && cumDistM[i] - cumDistM[j - 1] < windowM) j--;
    const dd = cumDistM[i] - cumDistM[j];
    out[i] = dd > 0.5 ? (Math.atan2(altSm[i] - altSm[j], dd) * 180) / Math.PI : 0;
  }
  return out;
}
