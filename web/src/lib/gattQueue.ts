/**
 * Serializuje operacje asynchroniczne: kolejna startuje dopiero po zakończeniu
 * poprzedniej. Używane dla WSZYSTKICH operacji GATT na jednym urządzeniu
 * (INFO/STATUS/CTRL/ROUTE).
 *
 * Dlaczego: Web Bluetooth na części implementacji (Chrome) potrafi odrzucić
 * operację komunikatem `NotSupportedError: GATT operation failed for unknown
 * reason`, gdy odczyt i zapis na tym samym urządzeniu są w locie jednocześnie
 * (np. odpytywanie STATUS w trakcie zapisu potwierdzenia ACK). Jedna kolejka
 * usuwa nakładanie i daje jedno miejsce na diagnostykę/logi.
 *
 * Kolejka nie zmienia logiki protokołu — tylko porządkuje dostęp do GATT.
 * Błąd pojedynczej operacji wraca do wywołującego, ale nie blokuje następnych.
 */
export class GattQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(op: () => Promise<T>): Promise<T> {
    // `.then(op, op)` startuje op niezależnie od tego, czy poprzednia
    // operacja się powiodła — jeden błąd nie może zatrzymać kolejki.
    const result = this.tail.then(op, op);
    // Ogon kolejki zawsze się "wyzerowuje", więc odrzucenie op nie zatruwa
    // łańcucha (wywołujący i tak dostaje `result`).
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
