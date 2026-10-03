#include <catch_amalgamated.hpp>

#include <fstream>
#include <iterator>
#include <vector>

#include "ble/crc32.h"

TEST_CASE("CRC32: znany wektor kontrolny") {
  const char* text = "123456789";
  const uint32_t crc = szCrc32Final(szCrc32Update(SZ_CRC32_INIT, reinterpret_cast<const uint8_t*>(text), 9));
  REQUIRE(crc == 0xCBF43926u);
}

TEST_CASE("CRC32: realne nagranie zgadza sie z goldenem z urzadzenia") {
  // Uruchamiane z katalogu repo (patrz run.ps1).
  std::ifstream file("test data/20260926_181420.csv", std::ios::binary);
  REQUIRE(file.good());
  const std::vector<uint8_t> data((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());

  const uint32_t crc = szCrc32Final(szCrc32Update(SZ_CRC32_INIT, data.data(), data.size()));
  REQUIRE(data.size() == 216651u);          // raw z linii "BLE done"
  REQUIRE(crc == 0xCF1B7DB8u);              // crc=CF1B7DB8 z urzadzenia
}
