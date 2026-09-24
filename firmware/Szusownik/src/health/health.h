#pragma once
#include <Arduino.h>

class Storage;
class Beeper;
class Hud;
class Baro;

// Monitoring zdrowia urzadzenia (MVP: termika SoC). ESP32-S3 nie ma
// sprzetowego shutdownu, wiec ochrona jest programowa: okresowy odczyt
// temperatureRead() z glownej petli (millis, bez taskow/ISR).
//   - po SZ_HEALTH_WARN_CONFIRM kolejnych odczytach >= WARN: kazdy kolejny
//     odczyt >= WARN daje alarm buzzerem (nieblokujacy),
//   - przy >= CRIT: zamkniecie SD, ekran z obiema temperaturami, blokujacy
//     alarm i deep sleep (grzanie ustaje; OLED trzyma obraz na 3V3).
// Histereza (SZ_HEALTH_HYST_C) zeruje licznik po ostygnięciu.
class Health {
 public:
  void begin(Storage* storage, Beeper* beeper, Hud* hud, Baro* baro);
  void tick(unsigned long nowMs);

 private:
  Storage* storage_ = nullptr;
  Beeper* beeper_ = nullptr;
  Hud* hud_ = nullptr;
  Baro* baro_ = nullptr;
  unsigned long nextCheck_ = 0;
  uint8_t overCount_ = 0;
};
