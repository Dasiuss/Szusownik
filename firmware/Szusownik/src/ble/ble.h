#pragma once
#include <Arduino.h>
#include "../miniz/miniz_tdef.h"
#include "../config/route_protocol.h"

class Storage;
class Beeper;

// BLE v1 Szusownika (NimBLE): lista plików + transfer do PWA.
// Transport z docs/ble-transfer.md: zlib/DEFLATE (miniz, strumieniowo z SD),
// ramki 244 B (seq LE + 240 B payload), skumulowany ACK co 32, NACK,
// okno 128, pacing 4 ms, timeout 500 ms / retry 3, end marker, CRC32.
// Profil ZAMROŻONY — zmiana tylko po benchmarku.
class BleFiles {
 public:
  void begin(Storage* storage);
  void setBeeper(Beeper* b) { beeper_ = b; }
  void poll();
  bool busy() const { return transferring_; }
  String lastError() const { return lastError_; }
  uint16_t mtu() const { return mtu_; }  // ostatnio wynegocjowane MTU (0 = brak)

  // Trasa nawigacyjna trzymana w RAM (SSOT: protocol/route-v1.json).
  const uint8_t* routeRaw() const { return routeRaw_; }
  uint16_t routeRawLen() const { return routeRawLen_; }
  uint32_t routeVersion() const { return routeCrc_; }  // tożsamość = CRC32 bloba
  // Lokalne wyczyszczenie trasy (dotarcie do celu): pusty blob + odświeżenie INFO.
  void clearRoute();
  // Wywoływane z callbacku charakterystyki trasy (host task NimBLE): kopiuje
  // porcję [offset,totalLen] do bufora stagingu i ustawia flagę commitu.
  void onRouteWrite(const uint8_t* data, size_t len);

 private:
  Storage* storage_ = nullptr;
  Beeper* beeper_ = nullptr;
  bool transferring_ = false;
  String activeFile_;
  String lastError_;
  // stan streamingu (ciężkie bufory w PSRAM, nie w DRAM!)
  tdefl_compressor* comp_ = nullptr;
  uint8_t (*window_)[244] = nullptr;
  uint16_t* windowLen_ = nullptr;
  bool compActive_ = false;
  uint32_t nextSeq_ = 0;       // następny numer ramki do wysłania
  uint32_t oldestUnacked_ = 0;  // najstarsza niepotwierdzona ramka
  uint32_t endSeq_ = 0;         // seq end markera
  bool endSent_ = false;
  bool inputEof_ = false;
  bool compFinished_ = false;
  uint32_t rawBytes_ = 0;
  uint32_t compBytes_ = 0;  // bajty payloadu (bez nagłówków)
  uint32_t frameCount_ = 0;
  uint32_t fileCrc_ = 0;
  unsigned long lastProgressMs_ = 0;
  unsigned long lastNotifyMs_ = 0;
  uint8_t ackRetries_ = 0;
  uint32_t replayPos_ = 0;
  bool replaying_ = false;
  // Statystyki transferu (do logu done/abort): ile razy wznawiano i ile razy
  // zadzialal timeout ACK. Pomagaja ocenic jakosc lacza bez sledzenia konsoli.
  uint32_t replays_ = 0;
  uint32_t ackTimeouts_ = 0;
  uint16_t mtu_ = 0;
  uint8_t inBuf_[512];
  size_t inLen_ = 0;
  size_t inPos_ = 0;
  // Staging ramki: mieści częściową ramkę + cały output kompresora (256 B),
  // bo emitFrame() przy pacingu nie kopiuje danych i nie wolno ich zgubić.
  uint8_t pend_[512];
  size_t pendLen_ = 0;

  // Trasa: `routeRaw_` to zatwierdzony blob (RAM), `routeStage_` to bufor
  // składania porcji z charakterystyki. Komit w pętli głównej (poza taskiem
  // NimBLE), z walidacją CRC.
  uint8_t routeRaw_[ROUTE_MAX_BLOB];
  uint16_t routeRawLen_ = 0;
  uint32_t routeCrc_ = 0;
  uint16_t routePoints_ = 0;
  uint8_t routeStage_[ROUTE_MAX_BLOB];
  uint16_t routeStageLen_ = 0;
  uint16_t routeStageTotal_ = 0;
  volatile bool routeCommitPending_ = false;

  void commitRoute();

  bool allocStreamMem();
  void handleCommand(const String& cmd);
  void refreshInfo();
  void reportVolume();
  void reportFreq();
  void reportTiming();
  void reportMinBeep();
  void setStatus(const String& s);
  bool startStream(const String& name);
  void abortStream(const String& reason);
  void finishStream();
  void pumpStream();
  // Zwraca false, gdy pacing 4 ms zabrania wysyłki w tej chwili.
  bool emitFrame(const uint8_t* payload, size_t len);
  void sendEndMarker();
  void onAck(uint32_t n);
  void onNack(uint32_t e);
  void replayFrom(uint32_t seq);
  void dryRun(const String& name);
};
