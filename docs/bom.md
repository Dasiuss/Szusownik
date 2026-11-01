# BOM — lista podzespołów (MVP)

Bez konkretnych marek/modeli (poza wskazanymi wymaganiami).

| Lp. | Podzespół | Wymagania / uwagi |
|----|-----------|-------------------|
| 1 | **MCU ESP32-S3** (np. ESP32-S3-Zero) | dual-core 240 MHz, **z PSRAM** (min. 2 MB), WiFi + BLE 5, USB-C; potwierdzone na sztuce: flash 4 MB, PSRAM 2 MB Quad |
| 2 | **Moduł GNSS** (u-blox) | **≥10 Hz**, multi-GNSS, konfigurowalny rate, prędkość z Dopplera, UART; antena ceramiczna/patch z widokiem nieba |
| 3 | **Czytnik microSD** (SPI) | |
| 4 | **Karta microSD** | np. 8–32 GB |
| 5 | **Buzzer piezo (pasywny)** | mały, sterowany PWM (ton + głośność) |
| 6 | **Wyświetlacz OLED 0,96"** | |
| 7 | **Barometr BME280 (I2C)** | wymagany w zestawie MVP; wysokość z GNSS ma zbyt małą dokładność pionową do wiarygodnej fuzji wysokości i analizy zjazdów. Firmware rozpoznaje też BMP280, ale rekomendowany jest BME280. |
| 8 | **Power bank** | min. **5000 mAh**, **tryb low-current**, USB-C |
| 9 | **Kabel USB-C** | power bank → MCU; odporny na zimno, odpowiednia długość |
| 10 | **Płytka prototypowa (perfboard) lub PCB** | do montażu i lutowania |
| 11 | **Przewody/złącza** | połączenia UART/SPI/I2C, koszulki termokurczliwe |
| 12 | **Obudowa na kask** | pudełko (druk 3D lub gotowe) + bezpieczne/łamliwe mocowanie |
| 13 | **Materiały montażowe** | rzepy, taśmy |

## Opcjonalny moduł zewnętrzny: HudRekaw

HudRekaw jest osobnym, opcjonalnym wyświetlaczem. Nie należy do wymaganego
zestawu MVP Szusownika.

| Podzespół | Wymagania / uwagi |
|---|---|
| **ESP8266 (ESP-12F / NodeMCU)** | flash 4 MB |
| **Wyświetlacz ST7789** | 1,54", 240×240; moduł GeekMagic SmallTV / SmallTV-Ultra |

IMU pozostaje poza BOM-em MVP; kandydatów i pozostałą roadmapę opisuje
`docs/koncepcja.md`.
