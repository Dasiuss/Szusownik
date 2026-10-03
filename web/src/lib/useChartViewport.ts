import { useCallback, useEffect, useState } from "react";
import { clampDomain, type DistanceDomain } from "./chart.ts";

/**
 * Wspólny widoczny zakres osi X (dystans) dla wykresów w danym widoku.
 * Wejście w widok zawsze startuje od pełnego zakresu danych (brak persystencji);
 * gdy dane dojdą asynchronicznie, zakres się resetuje do nowego maksimum.
 */
export function useChartViewport(dataMaxKm: number) {
  const safeMax = Math.max(dataMaxKm, 0);
  const [domain, setDomain] = useState<DistanceDomain>(() => [0, safeMax]);

  useEffect(() => {
    setDomain([0, Math.max(dataMaxKm, 0)]);
  }, [dataMaxKm]);

  const reset = useCallback(() => setDomain([0, Math.max(dataMaxKm, 0)]), [dataMaxKm]);

  const apply = useCallback(
    (next: DistanceDomain) => setDomain(clampDomain(next, Math.max(dataMaxKm, 0))),
    [dataMaxKm],
  );

  return { domain, apply, reset };
}
