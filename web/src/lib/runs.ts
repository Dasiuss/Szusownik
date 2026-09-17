import type { Sample } from "./csv.ts";
import { gradeDeg, haversineM, movingAvg } from "./geo.ts";

export interface EnrichedSample extends Sample {
  distM: number; // dystans od poprzedniej próbki
  cumDistM: number; // dystans skumulowany w pliku
  speedSm: number; // prędkość wygładzona MA3
  altSm: number; // wysokość wygładzona MA5
  gradeSm: number; // nachylenie wygładzone (stopnie, ujemne = w dół)
}

export interface Run {
  id: string;
  startT: string;
  endT: string;
  samples: EnrichedSample[];
  distanceM: number; // suma odcinków zjazdu
  maxSpeed: number; // max z surowej (niewygładzonej) prędkości
  maxGradeDown: number; // max |nachylenie w dół| w stopniach
}

export interface DayStats {
  downhillM: number; // suma dystansów zjazdów (bez podjazdów)
  maxSpeed: number;
  runs: Run[];
}

/** Wzbogaca próbki: dystanse + wygładzanie (wysokość MA5, prędkość MA3,
 *  nachylenie na oknie ~15 m + MA3). Surowe pola zostają nietknięte. */
export function enrich(samples: Sample[]): EnrichedSample[] {
  const distM = new Array<number>(samples.length).fill(0);
  const cum: number[] = new Array<number>(samples.length).fill(0);
  for (let i = 1; i < samples.length; i++) {
    const d = haversineM(samples[i - 1].lat, samples[i - 1].lon, samples[i].lat, samples[i].lon);
    distM[i] = d < 200 ? d : 0; // odrzuć skoki (tunel / zgubiony fix)
    cum[i] = cum[i - 1] + distM[i];
  }
  const altSm = movingAvg(samples.map((s) => s.alt), 5);
  const speedSm = movingAvg(samples.map((s) => s.speed), 3);
  const gradeSm = movingAvg(gradeDeg(altSm, cum, 15), 3);
  return samples.map((s, i) => ({
    ...s,
    distM: distM[i],
    cumDistM: cum[i],
    speedSm: speedSm[i],
    altSm: altSm[i],
    gradeSm: gradeSm[i],
  }));
}

const UPHILL_CUT_GAIN_M = 5;
const UPHILL_TREND_EPSILON_M = 0.05;

/**
 * Cięcie na zjazdy v1: ciągły ruch W GÓRĘ osiągający co najmniej 5 m
 * rozdziela dwa zjazdy (wymagania-PWA §6). Wysokość jest już wygładzona,
 * więc próg dotyczy skumulowanego wzrostu, a epsilon tylko trendu między próbkami.
 * Próg jest wykrywany na końcu podjazdu, ale granica trafia na jego początek,
 * dzięki czemu poprzedni zjazd kończy się przed wyciągiem.
 */
export function splitRuns(enriched: EnrichedSample[], uphillGainM = UPHILL_CUT_GAIN_M): Run[] {
  const cuts: number[] = [0];
  let climbStart = -1;
  let waitingForDescent = false;
  for (let i = 1; i < enriched.length; i++) {
    const dt = (Date.parse(enriched[i].t) - Date.parse(enriched[i - 1].t)) / 1000;
    if (dt < 0 || dt >= 3600) {
      climbStart = -1;
      waitingForDescent = false;
      continue;
    }
    if (dt === 0) continue;

    const altDelta = enriched[i].altSm - enriched[i - 1].altSm;
    if (waitingForDescent) {
      if (altDelta < -UPHILL_TREND_EPSILON_M) waitingForDescent = false;
      else continue;
    }

    if (altDelta > UPHILL_TREND_EPSILON_M) {
      if (climbStart < 0) climbStart = i - 1;
      const climbGain = enriched[i].altSm - enriched[climbStart].altSm;
      if (climbGain >= uphillGainM) {
        if (climbStart > cuts[cuts.length - 1]) cuts.push(climbStart);
        climbStart = -1;
        waitingForDescent = true;
      }
    } else if (altDelta < -UPHILL_TREND_EPSILON_M) {
      climbStart = -1;
    }
  }
  cuts.push(enriched.length);
  const runs: Run[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const part = enriched.slice(cuts[k], cuts[k + 1]);
    if (part.length < 2) continue;
    let distanceM = 0;
    let maxSpeed = 0;
    let maxGradeDown = 0;
    for (const s of part) {
      distanceM += s.distM;
      if (s.speed > maxSpeed) maxSpeed = s.speed;
      if (-s.gradeSm > maxGradeDown) maxGradeDown = -s.gradeSm;
    }
    runs.push({
      id: `zjazd-${k + 1}`,
      startT: part[0].t,
      endT: part[part.length - 1].t,
      samples: part,
      distanceM,
      maxSpeed,
      maxGradeDown,
    });
  }
  return runs;
}

export function analyzeDay(samples: Sample[]): DayStats {
  const enriched = enrich(samples);
  const runs = splitRuns(enriched);
  return {
    downhillM: runs.reduce((a, r) => a + r.distanceM, 0),
    maxSpeed: runs.reduce((a, r) => Math.max(a, r.maxSpeed), 0),
    runs,
  };
}
