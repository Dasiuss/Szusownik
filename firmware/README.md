# firmware/ — kod urządzenia

Firmware dla ESP32-S3 (arduino-cli / Arduino, C++).

Moduły (`firmware/Szusownik/src/`):

- `config/` — piny, stałe, UUID BLE v1, logowanie z timestampem.
- `gnss/` — pomiar (NEO-M8N, NMEA, autokonfiguracja UBX, adaptacyjne próbkowanie).
- `storage/` — zapis surowego CSV na microSD, rotacja, FIFO, odczyt do BLE.
- `audio/` — buzzer piezo (LEDC, próg pikania 60..120 km/h, głośność adaptacyjna 60→120 km/h, NVS, SETVOL/SETFREQ/SETTIMING/SETMINBEEP z PWA).
- `hud/` — OLED (SPD/MAX/TOTAL, bez REM/mapy/animacji w MVP1).
- `baro/` — barometr BME280/BMP280 (I2C, wspólna magistrala z OLED), wysokość barometryczna.
- `ble/` — transfer BLE v1 (INFO/CTRL/DATA/STATUS) + CRC32.
- `health/` — monitoring termiki SoC (alarm >95 °C, deep sleep >100 °C; brak sprzętowego shutdownu na S3).
- `miniz/` — vendored kompresor DEFLATE (public domain, patch `TDEFL_LESS_MEMORY=1`).

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

**Barometr BME280 (I2C; piny SPI ignoruj; adres wykrywany: 0x76/0x77)**

| Moduł | ESP32 |
|-------|-------|
| SDA | GPIO8 |
| SCL | GPIO9 |

**Buzzer pasywny**

| Moduł | ESP32 |
|-------|-------|
| SIG | GPIO10 |

### Uwagi do firmware

- Potwierdzone na sprzęcie: flash **4 MB**, PSRAM **2 MB Quad** (FQBN jw.).
- GNSS po UART0 (`Serial0`), default **9600 baud**; firmware samo konfiguruje
  UBX (rate wg tabelki, 115200, zapis do flash) — patrz `src/gnss/`.
- Barometr **BME280** (adres `0x77`) dzieli magistralę I2C z OLED; wysokość
  barometryczna trafia do CSV (`altitude_baro`).
  Stary BMP280 też jest obsługiwany (detekcja po chip-ID).
- Moduł SD ma pin **CLK** (= SCK). Gdyby karta się nie inicjalizowała, zamień miejscami MOSI/MISO (GPIO3 ↔ GPIO2).
- Buzzer na GPIO10 sterowany LEDC (sygnał startowy = wzór 120 przy głośności 60).
- Termika: ESP32-S3 nie ma sprzętowego shutdownu. Moduł `health/` co 30 s czyta
  `temperatureRead()` (die, nie ambient); alarm buzzerem >95 °C, a >100 °C zamyka
  SD, rysuje ekran i wchodzi w deep sleep. Diagnostyka: `die=..C air=..C` w STATUS.
  Deep sleep nie odcina 3V3 (GNSS dalej pobiera) — OLED trzyma obraz po uśpieniu.

Kod w `Szusownik/` (MVP1: GPS+UBX, CSV, buzzer, OLED, BLE streaming — patrz moduły).

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
`src/storage/` (surowe CSV, rotacja: rolka na postoju + na sync),
`src/audio/` (buzzer, sygnał co 1 s), `src/hud/` (OLED: SPD/MAX/TOTAL),
`src/baro/` (BME280: wysokość barometryczna),
`src/health/` (termika SoC: alarm + deep sleep),
`src/ble/` (INFO/CTRL/DATA/STATUS; streaming ramek 244 B + miniz — etap 2).
