# BOM — lista podzespołów (MVP)

Bez konkretnych marek/modeli (poza wskazanymi wymaganiami).

| Lp. | Podzespół | Wymagania / uwagi |
|----|-----------|-------------------|
| 1 | **MCU ESP32-S3** (np. ESP32-S3-Zero) | dual-core 240 MHz, **z PSRAM** (min. 2 MB), WiFi + BLE 5, USB-C |
| 2 | **Moduł GNSS** (u-blox) | **≥10 Hz**, multi-GNSS, konfigurowalny rate, prędkość z Dopplera, UART; antena ceramiczna/patch z widokiem nieba |
| 3 | **Czytnik microSD** (SPI) | |
| 4 | **Karta microSD** | np. 8–32 GB |
| 5 | **Buzzer piezo (pasywny)** | mały, sterowany PWM (ton + głośność) |
| 6 | **Wyświetlacz OLED 0,96"** | |
| 7 | **Power bank** | min. **5000 mAh**, **tryb low-current**, USB-C |
| 8 | **Kabel USB-C** | power bank → MCU; odporny na zimno, odpowiednia długość |
| 9 | **Płytka prototypowa (perfboard) lub PCB** | do montażu i lutowania |
| 10 | **Przewody/złącza** | połączenia UART/SPI/I2C, koszulki termokurczliwe |
| 11 | **Obudowa na kask** | pudełko (druk 3D lub gotowe) + bezpieczne/łamliwe mocowanie |
| 12 | **Materiały montażowe** | rzepy, taśmy |

**Roadmapa (nie MVP):** IMU (MPU-6xxx / ICM-xxx).
