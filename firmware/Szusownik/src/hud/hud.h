#pragma once
#include <Arduino.h>

// HUD SSD1306 128x64 (I2C GPIO8/9). MVP1: tylko tekst — SPD / MAX dnia / TOTAL,
// separator x=87, prawy panel 40 px PUSTY. Bez REM, bez mapy, bez animacji.
class Hud {
 public:
  bool begin();
  void draw(float speedKmh, float maxDayKmh, float totalKm, float maxLastKmh,
            bool hasFix);
  // Ekran awaryjny przed deep sleep (Health). OLED trzyma obraz na 3V3,
  // więc komunikat zostaje widoczny także po uśpieniu ESP.
  void drawOverheat(float dieC, float airC);
};
