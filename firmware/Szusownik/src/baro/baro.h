#pragma once
#include <Arduino.h>

// Barometr BME280 / BMP280 (I2C, wspolna magistrala z OLED GPIO8/9).
// Wlasny minimalny driver: detekcja po chip-ID (0xD0), tylko cisnienie +
// temperatura. Temperatura jest wewnetrzna (struktury czujnika) i sluzy
// do kompensacji cisnienia; dodatkowo logowana diagnostycznie w STATUS
// (SZ_DEBUG_STATUS) jako "air" — do kontroli termiki obudowy.
// Referencje: Bosch BME280/BMP280 datasheet (kompensacja T/P identyczna).
class Baro {
 public:
  bool begin();  // Wire musi byc zainicjowany (robi to hud.begin()).
  bool present() const { return present_; }
  bool valid() const { return valid_; }  // czy jest jakikolwiek poprawny odczyt
  const char* typeName() const { return typeName_; }
  uint8_t address() const { return addr_; }

  // Wymuszony pomiar (forced mode). Przy bledzie zwraca false, ale zostawia
  // ostatnie poprawne wartosci (pressurePa_/tempC_), wiec altitudeM() nie
  // skacze do zera przy chwilowym bledzie I2C.
  bool read();
  float pressurePa() const { return pressurePa_; }
  float tempC() const { return tempC_; }

  // Wysokosc barometryczna ze standardowej atmosfery (ref. 1013,25 hPa).
  // Do detekcji wyciagu/rotacji (liczy sie zmiana, nie wartosc absolutna).
  float altitudeM() const;

 private:
  bool writeReg(uint8_t reg, uint8_t val);
  bool readRegs(uint8_t reg, uint8_t* buf, uint8_t len);
  bool readCalibration();

  bool present_ = false;
  bool valid_ = false;
  uint8_t addr_ = 0;
  const char* typeName_ = "brak";
  bool isBme_ = false;
  float pressurePa_ = 0.0f;
  float tempC_ = 0.0f;
  int32_t tFine_ = 0;

  // Kalibracja T/P (0x88..0x9F).
  uint16_t digT1_ = 0;
  int16_t digT2_ = 0, digT3_ = 0;
  uint16_t digP1_ = 0;
  int16_t digP2_ = 0, digP3_ = 0, digP4_ = 0, digP5_ = 0;
  int16_t digP6_ = 0, digP7_ = 0, digP8_ = 0, digP9_ = 0;
};
