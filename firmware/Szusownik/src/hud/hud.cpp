#include "hud.h"
#include "../config/pins.h"
#include "../config/config.h"
#include "../core/hud_format.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

static Adafruit_SSD1306 disp(128, 64, &Wire, -1);

namespace {
// Dwie kolumny: lewa (max/hero + dystans), prawa (czas, SPEED/SPD, MAX DNIA/max, WYSOKOSC).
constexpr int16_t LEFT_X = 1;
constexpr int16_t RIGHT_X = 76;
constexpr int16_t TIME_RIGHT_X = 97;  // "HH:MM" (5 znakow) wyrownane do x=127
constexpr int16_t ROUTE_TEXT_Y = 48;  // rozmiar 2 (16 px) zajmuje y=48..63
}  // namespace

bool Hud::begin() {
  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL, 400000);
  if (!disp.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) return false;
  disp.clearDisplay();
  disp.display();
  return true;
}

void Hud::draw(const HudData& d) {
  char time[8];
  char spd[8];
  char dist[8];
  char alt[8];
  char spdLine[12];
  char maxPair[16];

  core::formatLocalHm(d.utcHour, d.utcMinute, SZ_HUD_TZ_OFFSET_MIN, time, sizeof(time));
  core::formatUint(spd, sizeof(spd), d.speedKmh, 999);
  core::formatTenthsKm(dist, sizeof(dist), d.totalKm);
  core::formatMeters(alt, sizeof(alt), d.altitudeM);
  core::formatMaxPair(maxPair, sizeof(maxPair), d.maxRunKmh, d.maxDayKmh);
  snprintf(spdLine, sizeof(spdLine), "SPD %s", spd);

  const bool route = d.routeLine != nullptr && d.routeLine[0] != '\0';

  disp.clearDisplay();
  disp.setTextColor(SSD1306_WHITE);

  if (route) {
    // --- tryb trasy: "MAX" = para (zjazd / dzien) jako bohater, reszta size 1 ---
    disp.setTextSize(1);
    disp.setCursor(LEFT_X, 0);
    disp.print(F("MAX"));
    disp.setTextSize(2);
    disp.setCursor(LEFT_X, 8);
    disp.print(maxPair);  // rozmiar 2, y=8..23

    disp.setTextSize(1);
    disp.setCursor(LEFT_X, 24);
    disp.print(F("DYSTANS"));
    disp.setCursor(LEFT_X, 32);
    disp.print(dist);
    disp.print(F("km"));

    // prawa kolumna (czas, SPD/NO FIX, WYSOKOSC)
    disp.setCursor(TIME_RIGHT_X, 0);
    disp.print(time);
    disp.setCursor(RIGHT_X, 8);
    if (d.hasFix) {
      disp.print(spdLine);
    } else {
      disp.print(F("NO FIX"));
    }
    disp.setCursor(RIGHT_X, 24);
    disp.print(F("WYSOKOSC"));
    disp.setCursor(RIGHT_X, 32);
    disp.print(alt);

    // dolna linia trasy: rozmiar 2, bez separatora
    disp.setTextSize(2);
    disp.setCursor(LEFT_X, ROUTE_TEXT_Y);
    disp.print(d.routeLine);
    disp.display();
    return;
  }

  // --- pelny ekran statystyk (bez trasy) ---
  char hero[8];
  char maxDay[8];
  core::formatUint(hero, sizeof(hero), d.maxRunKmh, 999);
  core::formatUint(maxDay, sizeof(maxDay), d.maxDayKmh, 999);

  disp.setTextSize(1);
  disp.setCursor(LEFT_X, 0);
  disp.print(F("MAX ZJAZDU"));
  disp.setTextSize(3);
  disp.setCursor(LEFT_X, 8);
  disp.print(hero);

  disp.setTextSize(1);
  disp.setCursor(LEFT_X, 40);
  disp.print(F("DYSTANS"));
  disp.setTextSize(2);
  disp.setCursor(LEFT_X, 48);
  disp.print(dist);
  disp.setTextSize(1);
  disp.setCursor(LEFT_X + 48, 56);
  disp.print(F("km"));

  // prawa kolumna
  disp.setCursor(TIME_RIGHT_X, 0);
  disp.print(time);
  if (!d.hasFix) {
    disp.setCursor(RIGHT_X, 16);
    disp.print(F("NO FIX"));
  } else {
    disp.setCursor(RIGHT_X, 16);
    disp.print(F("SPEED"));
    disp.setCursor(RIGHT_X, 24);
    disp.print(spd);
  }
  disp.setCursor(RIGHT_X, 32);
  disp.print(F("MAX DNIA"));
  disp.setCursor(RIGHT_X, 40);
  disp.print(maxDay);
  disp.setCursor(RIGHT_X, 48);
  disp.print(F("WYSOKOSC"));
  disp.setCursor(RIGHT_X, 56);
  disp.print(alt);

  disp.display();
}

void Hud::drawOverheat(float dieC, float airC) {
  char bDie[20], bAir[20];
  snprintf(bDie, sizeof(bDie), "die  %.1f C", dieC);
  snprintf(bAir, sizeof(bAir), "air  %.1f C", airC);

  disp.clearDisplay();
  disp.setTextColor(SSD1306_WHITE);
  disp.setTextSize(1);
  disp.setCursor(1, 0);
  disp.print(F("!! PRZEGRZANIE !!"));
  disp.setCursor(1, 18);
  disp.print(bDie);
  disp.setCursor(1, 30);
  disp.print(bAir);
  disp.setCursor(1, 46);
  disp.print(F("-> deep sleep"));
  disp.display();
}
