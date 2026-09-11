# firmware/ — kod urządzenia

Firmware dla ESP32-S3 (arduino-cli / Arduino, C++).

Moduły:

- `gnss/` — pomiar (u-blox, adaptacyjne próbkowanie, prędkość z Dopplera).
- `storage/` — zapis surowego CSV na microSD.
- `audio/` — buzzer piezo (sygnały prędkości/rekordu).
- `ble/` — transfer BLE do PWA.

## Połączenia (pinout)

ESP32-S3-Zero (Waveshare). Uwagi do pinów: **GPIO21** = dioda RGB (nie używać),
**GPIO0** = BOOT, **GPIO33–37** niewyprowadzone (Octal PSRAM). **TX = GPIO43**, **RX = GPIO44**.

### Magistrale zasilania (wspólne szyny na stripboardzie)

| Szyna | Zasilanie z ESP32 | Do czego |
|-------|-------------------|----------|
| **3,3 V** | pin **3V3** | GNSS VCC · SD `3,3V` · OLED VCC · baro `3,3V` · buzzer VCC |
| **GND** | pin **GND** | GND wszystkich modułów + ESP32 |

### Podłączenia modułów (pin po pinie)

**GNSS (NEO-M8N)**

| Moduł | ESP32 |
|-------|-------|
| TX | **GPIO44 (RX)** — UART0 |
| RX | **GPIO43 (TX)** — UART0 |

**microSD (adapter SPI)**

| Moduł | ESP32 |
|-------|-------|
| CS | GPIO1 |
| MISO | GPIO2 |
| MOSI | GPIO3 |
| CLK (SCK) | GPIO4 |

**OLED 0,96" SSD1306 (adres I2C: 0x3C)**

| Moduł | ESP32 |
|-------|-------|
| SDA | GPIO8 |
| SCL | GPIO9 |

**Barometr (piny SPI ignoruj)**

| Moduł | ESP32 |
|-------|-------|
| SDA | GPIO8 |
| SCL | GPIO9 |

**Buzzer pasywny**

| Moduł | ESP32 |
|-------|-------|
| SIG | GPIO10 |

### Uwagi do firmware

- GNSS po UART0 (`Serial0`), default **9600 baud**; pod 10 Hz podbij do 115200/230400.
- OLED + baro na wspólnej I2C; adres baro **0x76** lub **0x77**.
- Moduł SD ma pin **CLK** (= SCK). Gdyby karta się nie inicjalizowała, zamień miejscami MOSI/MISO (GPIO3 ↔ GPIO2).
- Buzzer sterowany PWM (LEDC) na GPIO10.

Tutaj powstaje projekt arduino-cli (scaffold w `Szusownik/`).

## Budowanie (arduino-cli, bez VS Code / PlatformIO)

Wymagane: `arduino-cli`, core `esp32:esp32 >= 3.3` oraz biblioteki
`TinyGPSPlus`, `Adafruit GFX`, `Adafruit SSD1306`, `Adafruit BusIO`,
`NimBLE-Arduino` (instalacja: `arduino-cli lib install TinyGPSPlus
"Adafruit GFX Library" "Adafruit SSD1306" "Adafruit BusIO" NimBLE-Arduino`).

Waveshare S3-Zero nie ma osobnego wpisu w core — używamy generycznego
`esp32s3` (potwierdzone na sprzęcie: flash 4 MB, PSRAM 2 MB Quad, USB-CDC na boot):

```powershell
arduino-cli compile --fqbn "esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc" firmware/Szusownik
arduino-cli upload -p COMx --fqbn "esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc" firmware/Szusownik
arduino-cli monitor -p COMx -c baudrate=115200
```

Struktura: `Szusownik.ino` + `src/config/` (piny, stałe, UUID BLE v1),
`src/gnss/` (NEO-M8N, NMEA, adaptacyjne próbkowanie ±3 km/h),
`src/storage/` (surowe CSV, rotacja ~5 zjazdów + na sync),
`src/audio/` (buzzer, sygnał co 1 s), `src/hud/` (OLED: SPD/MAX/TOTAL),
`src/ble/` (INFO/CTRL/DATA/STATUS; streaming ramek 244 B + miniz — etap 2).
