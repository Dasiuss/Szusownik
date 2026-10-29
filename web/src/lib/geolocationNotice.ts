/** Kody błędów `GeolocationPositionError` (te same w każdej przeglądarce). */
const PERMISSION_DENIED = 1;

/**
 * Komunikat mapy dla błędu GPS.
 *
 * Brak zgody to świadoma decyzja użytkownika — nie pokazujemy o tym alertu,
 * bo wraca przy każdym wejściu na mapę i nic nie wnosi. Inne błędy (brak
 * pozycji, timeout) nadal warto pokazać, bo są przejściowe.
 */
export function gpsNotice(errorCode: number | null): string | null {
  if (errorCode === null) return null;
  if (errorCode === PERMISSION_DENIED) return null;
  return "Nie udało się odczytać pozycji GPS.";
}
