// BLE v1 Szusownika — szkielet pod fazę C (integracja).
// UUID muszą być IDENTYCZNE z firmware/src/config/config.h.
export const SZ_UUID_SVC = "3f9a0001-7c4e-4b2a-9e11-000000000001";
export const SZ_UUID_INFO = "3f9a0002-7c4e-4b2a-9e11-000000000002";
export const SZ_UUID_CTRL = "3f9a0003-7c4e-4b2a-9e11-000000000003";
export const SZ_UUID_DATA = "3f9a0004-7c4e-4b2a-9e11-000000000004";
export const SZ_UUID_STAT = "3f9a0005-7c4e-4b2a-9e11-000000000005";

export const SZ_BLE_FRAME = 244;
export const SZ_BLE_HEADER = 4;
export const SZ_BLE_PAYLOAD = 240;
export const SZ_BLE_ACK_BLOCK = 32;

/** Pełny transfer (lista → ROTATE → START_FILE → ramki → CRC → IndexedDB)
 *  powstanie w fazie C. PWA: Web Bluetooth, Chrome/Android. */
export class SzusownikBle {
  async connect(): Promise<void> {
    throw new Error("Transfer BLE — faza C (jeszcze niezaimplementowane)");
  }
}
