#pragma once
// Szusownik v1 — pinout ESP32-S3-Zero (Waveshare). SSOT: firmware/README.md
// GPIO21 = dioda RGB (nie używać). GPIO0 = BOOT. GPIO33-37 niewyprowadzone.

static const int PIN_GNSS_RX = 44;  // UART0 RX <- TX modułu GNSS
static const int PIN_GNSS_TX = 43;  // UART0 TX -> RX modułu GNSS

static const int PIN_SD_CS   = 1;
static const int PIN_SD_MISO = 2;
static const int PIN_SD_MOSI = 3;
static const int PIN_SD_SCK  = 4;  // na module opisany jako CLK

static const int PIN_OLED_SDA = 8;
static const int PIN_OLED_SCL = 9;
static const uint8_t OLED_I2C_ADDR = 0x3C;

// Barometr BME280/BMP280 dzieli magistrale I2C z OLED (adres wykrywany: 0x76/0x77).
static const int PIN_BARO_SDA = 8;
static const int PIN_BARO_SCL = 9;

static const int PIN_BUZZER = 10;  // pasywny piezo
