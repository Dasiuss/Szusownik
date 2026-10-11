#pragma once
#include <Arduino.h>

// HUD SSD1306 128x64 (I2C GPIO8/9). Jeden autonomiczny ekran statystyk:
//  - bez trasy: lewa kolumna MAX ZJAZDU (hero) + DYSTANS, prawa czas lokalny
//    (bez etykiety), SPEED, MAX DNIA, WYSOKOSC;
//  - z trasa (PWA wyslala trase): "MAX" = para zjazd / dzien (bohater, size 2),
//    DYSTANS i prawa kolumna (czas, SPD/NO FIX, WYSOKOSC) schodza do size 1, a
//    dolna linia (size 2, bez separatora) pokazuje kolejne odcinki od biezacego,
//    laczone "->". Bez trasy caly ekran to statystyki. Bez mapy, bitmap i animacji.
//
// Font Adafruit GFX jest ASCII: brak polskich znakow ("WYSOKOSC"). Nazwy
// odcinkow skraca core::formatRouteLabel (<=6 znakow, dluzsze 3+'.'+2).
struct HudData {
  float speedKmh = 0.0f;   // biezaca predkosc (slot SPEED / "SPD n")
  float maxRunKmh = 0.0f;  // hero: max zjazdu (live w zjezdzie, zamrozony na wyciagu)
  float maxDayKmh = 0.0f;  // max dnia (od wlaczenia)
  float totalKm = 0.0f;    // dystans dnia (od wlaczenia)
  float altitudeM = 0.0f;  // wysokosc z fuzji baro+GPS (m)
  int utcHour = -1;        // UTC z GNSS; render dolicza SZ_HUD_TZ_OFFSET_MIN
  int utcMinute = 0;       // -1 godzina => czas nieznany ("--:--")
  bool hasFix = false;
  const char* routeLine = nullptr;  // nullptr = brak trasy; np. "1->Gai.gl"
};

class Hud {
 public:
  bool begin();
  void draw(const HudData& data);
  // Ekran awaryjny przed deep sleep (Health). OLED trzyma obraz na 3V3,
  // więc komunikat zostaje widoczny także po uśpieniu ESP.
  void drawOverheat(float dieC, float airC);
};
