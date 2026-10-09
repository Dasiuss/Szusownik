#pragma once
#include <stdint.h>

// Czysta matematyka widoku mapy (projekcja, kolory, układ labeli). Bez
// Arduino.h — testy hostowe. Renderowanie (Adafruit) jest w src/display/.

struct MapLabelBox {
  int16_t x = 0;
  int16_t y = 0;
  int16_t width = 0;
  int16_t height = 0;
  uint16_t nameOffset = 0;
  uint8_t nameLength = 0;
  uint8_t textSize = 1;
  uint16_t color = 0;
  int32_t distanceSq = 0;
};

// Rzutuje punkt mapy (east/north w metrach) na ekran z rybim okiem. Wynik jest
// przycięty do zakresu rysowania. cos/sin to obrót wg bearingu trasy.
void mapProjectPoint(int16_t east, int16_t north, float riderEast, float riderNorth, float cosBearing,
                     float sinBearing, uint16_t fisheyeRadius, float fisheyeK, int16_t* outX,
                     int16_t* outY);

// Kolor trasy/ulicy wg rodzaju i trudności (RGB565).
uint16_t mapWayColor(uint8_t kind, uint8_t difficulty);

// Czy prostokąt labela nachodzi na któryś z już położonych.
bool mapLabelOverlaps(const MapLabelBox& label, const MapLabelBox* placed, int placedCount);

// Sortowanie labeli-kandydatów rosnąco po distanceSq (najbliższe pierwsze).
void mapSortLabelsByDistance(MapLabelBox* labels, int count);
