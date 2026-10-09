#pragma once
#include <Arduino.h>

class Link;

// Serwer HTTP (podgląd stanu) + ArduinoOTA + /update. Wymaga WiFi (SoftAP lub
// sieci z secrets.h).
class Web {
 public:
  void begin(Link* link);
  void poll();

 private:
  Link* link_ = nullptr;
  bool mdnsStarted_ = false;
  void handleRoot();
};
