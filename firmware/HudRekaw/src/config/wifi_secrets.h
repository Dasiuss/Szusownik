#pragma once
#include <Arduino.h>

// Wspólne wciągnięcie sekretów WiFi/OTA z fallbackiem. secrets.h leży w katalogu
// szkicu (firmware/HudRekaw/, gitignored); szablon to secrets.example.h.
#if __has_include("../../secrets.h")
#include "../../secrets.h"
#else
#warning "secrets.h not found; copy firmware/HudRekaw/secrets.example.h to secrets.h"
#define WIFI_NETWORK_COUNT 0
#define OTA_PASSWORD "hud-ota"
static const char* WIFI_SSIDS[1] = {""};
static const char* WIFI_PASSES[1] = {""};
#endif
