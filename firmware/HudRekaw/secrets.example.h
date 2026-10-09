#pragma once

// Copy this file to firmware/HudRekaw/secrets.h (untracked, see .gitignore) and
// fill in your own networks. HudRekaw tries them in order until one connects.
//
//   copy firmware\HudRekaw\secrets.example.h firmware\HudRekaw\secrets.h
//
// Uwaga: gdy HudRekaw połączy się z routerem, przechodzi na kanał routera i
// traci łączność z Szusownikiem (który nadaje na kanale HUD_LINK_CHANNEL = 1).
// Docelowo/testowo trzymamy HudRekaw poza zasięgiem tych sieci, żeby został na
// kanale 1. Kanału nie ustawia się tutaj — bierze się z protokołu HUD.

#define WIFI_NETWORK_COUNT 2

static const char *WIFI_SSIDS[WIFI_NETWORK_COUNT] = {
    "MyNetwork2G",
    "AnotherNetwork",
};

static const char *WIFI_PASSES[WIFI_NETWORK_COUNT] = {
    "password1",
    "password2",
};

// Password for ArduinoOTA and the web /update page (user: admin).
#define OTA_PASSWORD "hud-ota"
