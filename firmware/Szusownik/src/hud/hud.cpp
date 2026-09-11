#include "hud.h"
#include "../config/pins.h"
#include "../config/config.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

static Adafruit_SSD1306 disp(128, 64, &Wire, -1);

bool Hud::begin() {
  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL, 400000);
  if (!disp.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) return false;
  disp.clearDisplay();
  disp.display();
  return true;
}

void Hud::draw(float speedKmh, float maxDayKmh, float totalKm, float maxLastKmh,
               bool hasFix) {
  // SPD: poniżej 5 km/h pokazuj max ostatniego zjazdu (stanie w miejscu / wyciąg).
  float shown = (speedKmh < SZ_SPD_STATIC_BELOW_KMH) ? maxLastKmh : speedKmh;
  if (shown < 0) shown = 0;
  if (shown > 999) shown = 999;
  float mx = maxDayKmh;
  if (mx < 0) mx = 0;
  if (mx > 999) mx = 999;
  char bSpd[8], bMax[8], bTot[16];
  snprintf(bSpd, sizeof(bSpd), "%3u", (unsigned)shown);
  snprintf(bMax, sizeof(bMax), "%3u", (unsigned)mx);
  snprintf(bTot, sizeof(bTot), "%.1f", totalKm);

  disp.clearDisplay();
  disp.setTextColor(SSD1306_WHITE);
  disp.setTextSize(1);
  disp.setCursor(1, 0);
  disp.print(F("SPD"));
  disp.setTextSize(3);
  disp.setCursor(1, 9);
  disp.print(bSpd);
  disp.setTextSize(1);
  disp.setCursor(62, 27);
  disp.print(F("MAX"));
  disp.setCursor(62, 35);
  disp.print(bMax);
  disp.setCursor(50, 48);
  disp.print(F("TOTAL"));
  disp.setCursor(62, 56);
  disp.print(bTot);
  disp.drawFastVLine(87, 0, 64, SSD1306_WHITE);
  if (!hasFix) {
    disp.setCursor(1, 56);
    disp.print(F("NO FIX"));
  }
  disp.display();
}
