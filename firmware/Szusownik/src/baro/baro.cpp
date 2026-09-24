#include "baro.h"
#include "../config/pins.h"
#include "../config/log.h"
#include <Wire.h>
#include <math.h>

// Rejestry BME280/BMP280.
static const uint8_t REG_CHIP_ID = 0xD0;
static const uint8_t REG_RESET = 0xE0;
static const uint8_t REG_CALIB = 0x88;  // 24 B: T1..T3, P1..P9
static const uint8_t REG_CTRL_HUM = 0xF2;
static const uint8_t REG_CTRL_MEAS = 0xF4;
static const uint8_t REG_CONFIG = 0xF5;
static const uint8_t REG_DATA = 0xF7;  // press[3], temp[3], hum[2]

static const uint8_t CHIP_ID_BMP280 = 0x58;
static const uint8_t CHIP_ID_BME280 = 0x60;

bool Baro::writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr_);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool Baro::readRegs(uint8_t reg, uint8_t* buf, uint8_t len) {
  Wire.beginTransmission(addr_);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr_, len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

bool Baro::begin() {
  Wire.begin(PIN_BARO_SDA, PIN_BARO_SCL, 400000);

  const uint8_t cand[] = {0x76, 0x77};
  for (uint8_t i = 0; i < 2 && !present_; i++) {
    addr_ = cand[i];
    uint8_t id = 0;
    if (!readRegs(REG_CHIP_ID, &id, 1)) continue;
    if (id == CHIP_ID_BMP280) {
      present_ = true;
      isBme_ = false;
      typeName_ = "BMP280";
    } else if (id == CHIP_ID_BME280) {
      present_ = true;
      isBme_ = true;
      typeName_ = "BME280";
    }
  }
  if (!present_) {
    typeName_ = "brak";
    return false;
  }
  if (!readCalibration()) {
    present_ = false;
    typeName_ = "brak";
    return false;
  }
  writeReg(REG_CONFIG, 0x00);                 // t_sb 0.5 ms, IIR off
  if (isBme_) writeReg(REG_CTRL_HUM, 0x01);   // osrs_h x1 (przed ctrl_meas)
  return true;
}

bool Baro::readCalibration() {
  uint8_t b[24];
  if (!readRegs(REG_CALIB, b, sizeof(b))) return false;
  digT1_ = (uint16_t)(b[0] | (b[1] << 8));
  digT2_ = (int16_t)(b[2] | (b[3] << 8));
  digT3_ = (int16_t)(b[4] | (b[5] << 8));
  digP1_ = (uint16_t)(b[6] | (b[7] << 8));
  digP2_ = (int16_t)(b[8] | (b[9] << 8));
  digP3_ = (int16_t)(b[10] | (b[11] << 8));
  digP4_ = (int16_t)(b[12] | (b[13] << 8));
  digP5_ = (int16_t)(b[14] | (b[15] << 8));
  digP6_ = (int16_t)(b[16] | (b[17] << 8));
  digP7_ = (int16_t)(b[18] | (b[19] << 8));
  digP8_ = (int16_t)(b[20] | (b[21] << 8));
  digP9_ = (int16_t)(b[22] | (b[23] << 8));
  return true;
}

bool Baro::read() {
  if (!present_) return false;
  if (isBme_) writeReg(REG_CTRL_HUM, 0x01);  // BME280: ctrl_hum resetuje sie w forced
  // forced mode, osrs_t x1, osrs_p x1
  if (!writeReg(REG_CTRL_MEAS, (1 << 5) | (1 << 2) | 0x01)) return false;
  delay(10);  // ~9,3 ms dla T+P x1
  uint8_t d[8];
  if (!readRegs(REG_DATA, d, sizeof(d))) return false;

  int32_t adcP = ((int32_t)d[0] << 12) | ((int32_t)d[1] << 4) | (d[2] >> 4);
  int32_t adcT = ((int32_t)d[3] << 12) | ((int32_t)d[4] << 4) | (d[5] >> 4);

  // Temperatura (BMP280 i BME280 identycznie); t_fine do kompensacji cisnienia.
  int32_t var1 = ((((adcT >> 3) - ((int32_t)digT1_ << 1))) * ((int32_t)digT2_)) >> 11;
  int32_t var2 =
      (((((adcT >> 4) - ((int32_t)digT1_)) * ((adcT >> 4) - ((int32_t)digT1_))) >> 12) *
       ((int32_t)digT3_)) >>
      14;
  tFine_ = var1 + var2;
  tempC_ = (float)((tFine_ * 5 + 128) >> 8) / 100.0f;

  // Cisnienie w Q24.8 (Pa); wynik /256 -> Pa.
  int64_t pv1 = ((int64_t)tFine_) - 128000;
  int64_t pv2 = pv1 * pv1 * (int64_t)digP6_;
  pv2 = pv2 + ((pv1 * (int64_t)digP5_) << 17);
  pv2 = pv2 + (((int64_t)digP4_) << 35);
  pv1 = ((pv1 * pv1 * (int64_t)digP3_) >> 8) + ((pv1 * (int64_t)digP2_) << 12);
  pv1 = (((((int64_t)1) << 47) + pv1)) * ((int64_t)digP1_) >> 33;
  if (pv1 == 0) return false;
  int64_t p = 1048576 - adcP;
  p = (((p << 31) - pv2) * 3125) / pv1;
  pv1 = (((int64_t)digP9_) * (p >> 13) * (p >> 13)) >> 25;
  pv2 = (((int64_t)digP8_) * p) >> 19;
  p = ((p + pv1 + pv2) >> 8) + (((int64_t)digP7_) << 4);
  pressurePa_ = (float)p / 256.0f;
  valid_ = true;
  return true;
}

float Baro::altitudeM() const {
  if (pressurePa_ <= 0.0f) return 0.0f;
  return 44330.0f * (1.0f - powf(pressurePa_ / 101325.0f, 1.0f / 5.255f));
}
