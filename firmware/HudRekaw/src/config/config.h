#pragma once
// HudRekaw v1 — ESP8266 + ST7789 240x240 ("rękaw"). Odbiornik ESP-NOW od
// Szusownika; rysuje mapę z pozycją (postój/wolno) albo statystyki (w ruchu).
// Pinout i decyzje: docs/hud-rekaw.md. Ten nagłówek jest czysty (bez Arduino.h),
// żeby korzystała z niego też czysta logika w src/core/ (testy hostowe).

#include "./hud_protocol.h"

#define HUDREKAW_VERSION "v1"
#define HUDREKAW_DEVICE_NAME "hud-rekaw"
#define HUDREKAW_AP_SSID "HudRekaw"
#define HUDREKAW_AP_PASSWORD "hudrekaw"

// ST7789 (GeekMagic SmallTV / SmallTV-Ultra).
static const int8_t TFT_CS_PIN = -1;
static const int8_t TFT_DC_PIN = 0;
static const int8_t TFT_RST_PIN = 2;
static const int8_t TFT_BL_PIN = 5;
static const uint32_t TFT_SPI_HZ = 40000000;
static const int16_t TFT_WIDTH = 240;
static const int16_t TFT_HEIGHT = 240;

// Paleta RGB565.
static const uint16_t COLOR_BG = 0x0000;
static const uint16_t COLOR_WHITE = 0xFFFF;
static const uint16_t COLOR_GRAY = 0x39E7;
static const uint16_t COLOR_DARK = 0x2124;
static const uint16_t COLOR_CYAN = 0x07FF;
static const uint16_t COLOR_GREEN = 0x07E0;
static const uint16_t COLOR_ORANGE = 0xFD20;
static const uint16_t COLOR_MAGENTA = 0xF81F;
static const uint16_t COLOR_VIOLET = 0x901A;
static const uint16_t COLOR_YELLOW = 0xFFE0;
static const uint16_t COLOR_RED = 0xF800;

// Paleta mapy (advanced/black rysowany na biało, by był widoczny na tle).
static const uint16_t COLOR_NOVICE = 0x07E0;
static const uint16_t COLOR_EASY = 0x04DF;
static const uint16_t COLOR_INTERMEDIATE = 0xF800;
static const uint16_t COLOR_ADVANCED = 0xFFFF;
static const uint16_t COLOR_FREERIDE = 0xFFE0;
static const uint16_t COLOR_UNKNOWN = 0x7BEF;
static const uint16_t COLOR_SNOWPARK = 0xF81F;
static const uint16_t COLOR_CONNECTION = 0x7BEF;
static const uint16_t COLOR_LIFT = 0xFD20;
static const uint16_t COLOR_RIDER = 0x001F;
// Trasa nawigacyjna: niebieski "jak Google Maps" (#1A73E8).
static const uint16_t COLOR_ROUTE = 0x1B9D;

// Czas i budżety (ms).
static const unsigned long NET_ATTEMPT_TIMEOUT_MS = 12000;
static const unsigned long NET_SEARCH_INTERVAL_MS = 30000;
static const unsigned long LINK_TIMEOUT_MS = 3000;
static const unsigned long RENDER_MIN_INTERVAL_MS = 50;

// Martwa strefa przerysowania mapy: rysujemy dopiero, gdy rower przesunął się
// o >= MAP_REDRAW_MOVE_M albo kurs zmienił się o >= MAP_REDRAW_BEARING_DEG.
// Zoom/fisheye i zmiana trybu wymuszają przerysowanie niezależnie od tego.
static const float MAP_REDRAW_MOVE_M = 5.0f;
static const int16_t MAP_REDRAW_BEARING_DEG = 8;

// Układ mapy (piksele / metry).
static const int16_t MAP_RIDER_X = 120;
static const int16_t MAP_RIDER_Y = 190;
static const uint16_t MAP_VIEW_METERS[5] = {250, 500, 1000, 2000, 4000};
static const uint8_t MAP_VIEW_COUNT = 5;
static const uint8_t MAP_MAX_LABELS = 16;
static const uint16_t MAP_MAX_CANDIDATES = 220;
static const float MAP_METERS_PER_DEG_LAT = 110540.0f;
