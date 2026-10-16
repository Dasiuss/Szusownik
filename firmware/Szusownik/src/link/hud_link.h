#pragma once
#include <Arduino.h>

#include "../core/espnow_packet.h"

// Wejście do nadajnika HUD (zbierane w głównej pętli z GNSS i statystyk).
struct HudInput {
  bool fix = false;
  float speedKmh = 0.0f;
  uint16_t maxDayKmh = 0;
  int16_t heading = 0;
  float totalKm = 0.0f;
  int32_t latE7 = 0;
  int32_t lonE7 = 0;
  uint8_t segmentIndex = 255;  // HUD_SEGMENT_NONE — bieżący odcinek trasy
};

// Wynik ostatniego parowania (raportowany do PWA).
enum class HudPairResult : uint8_t {
  None = 0,    // brak odpowiedzi — nie znaleziono Huda
  Ok,          // dokładnie jeden — zapisany w NVS
  TooMany,     // więcej niż jeden — nie parujemy
  Error,       // nie udało się postawić radia
};

// Nadajnik ESP-NOW do HudRekaw (kanał HUD_LINK_CHANNEL).
//
// Radio jest DOMYŚLNIE WYŁĄCZONE (esp_wifi_stop). Otwieramy je na krótkie okno
// tylko po to, żeby wysłać zaległe pakiety, po czym gasimy je po sprzętowym ACK
// unicastu (albo po HUD_TX_ACK_GRACE_MS). Okres okien: w statystykach `S` co
// HUD_SEND_TELEMETRY_MS, w mapie `L` co HUD_SEND_LOCATION_MS. Gdy łącze nie jest
// potwierdzone (brak niedawnego ACK), nadajemy nie częściej niż HUD_SEND_BACKOFF_MS.
//
// Adresat jest zawsze unicastem do MAC-a Huda z NVS — dzięki temu dwa zestawy na
// stoku się nie mieszają. Jedyne użycie broadcastu to prośba o parowanie `P`
// (Szusownik nie zna jeszcze MAC-a). Dostępność Huda dajemy z ACK-a unicastu;
// heartbeat został usunięty.
//
// Trasa (blob z protocol/route-v1.json, tożsamość = CRC32) leci chunkami `R`
// w jednym oknie, każdy następny po ACK poprzedniego (HUD_ROUTE_CHUNK_ACK_TIMEOUT_MS).
// Po ostatnim chunku radio zostaje włączone i czekamy na jawne potwierdzenie `K`
// od Huda (HUD_ROUTE_CONFIRM_TIMEOUT_MS), do HUD_ROUTE_MAX_CYCLES prób.
class HudLink {
 public:
  bool begin();
  bool ready() const { return ready_; }

  // Parowanie (wołane z PWA przez BLE): czyści zapisany MAC i uruchamia okno
  // parowania (broadcast `P`, zbieranie odpowiedzi `Q`).
  void requestPairing();
  bool paired() const { return peerValid_; }
  const uint8_t* peerMac() const { return peerValid_ ? peerMac_ : nullptr; }
  // Jednorazowy odczyt wyniku parowania (dla raportu w BLE).
  bool takePairResult(HudPairResult& out);

  void setRoute(const uint8_t* data, uint16_t len, uint32_t crc);
  void tick(unsigned long nowMs, const HudInput& in, bool paused);
  // Wywoływane z callbacku odbioru ESP-NOW (kontekst taska WiFi): tylko
  // dekoduje pakiet i wrzuca zdarzenie do pierścienia `rxQ_`. Stan gry zmienia
  // wyłącznie pętla główna (drainRxEvents), więc nie ma współdzielonych pól.
  void handlePacket(const uint8_t* mac, const uint8_t* data, size_t len);
  // Wywoływane z callbacku wysyłki ESP-NOW (kontekst taska WiFi). `unicast`
  // pochodzi z adresu docelowego pakietu, nie z globalnej flagi.
  void onSent(bool ok, bool unicast);

 private:
  enum class Phase : uint8_t { Idle, Tx, Route, Confirm, Pair };

  // Zdarzenie z callbacku odbioru (type = 'Q' albo 'K').
  struct RxEvent {
    uint8_t type;
    uint8_t mac[6];  // nadawca (src_addr ESP-NOW)
    uint32_t crc;    // dla 'K'
  };
  static constexpr uint8_t kRxSlots = 8;

  bool radioOn();
  void radioOff();
  bool addPeerMac(const uint8_t* mac);
  bool sendToPeer(const uint8_t* data, size_t len);
  bool sendBroadcast(const uint8_t* data, size_t len);
  void pushRxEvent(uint8_t type, const uint8_t* mac, uint32_t crc);
  void drainRxEvents();
  void applyRxEvent(const RxEvent& ev);
  void noteAck();
  int inflightCount();
  bool takeAckFailed();
  bool linkRecent(unsigned long now);
  void openTelemetryWindow(unsigned long now, const HudInput& in);
  void sendTelemetry(unsigned long now, const HudInput& in);
  bool sendLocation(unsigned long now, uint8_t mode);
  void serviceRoute(unsigned long now);
  void servicePairing(unsigned long now);
  void startRoute(unsigned long now);
  void endRouteTransfer(unsigned long now);
  bool peerLinked(unsigned long now);
  bool routeConfirmed() const;
  bool routeWantsSend(unsigned long now);
  void scheduleNextWindow(unsigned long now);
  void loadPeer();
  void savePeer();
  void clearPeer();

  bool ready_ = false;
  bool radio_ = false;
  bool paused_ = false;
  // Diagnostyka 4A: radio włączamy i gasimy co okno telemetrii, więc nie
  // logujemy każdego przełączenia (byłby szum). Mierzymy koszt przełączenia
  // związanego z pauzą na transfer BLE: `logRadioOn_` przechwytuje czas
  // najbliższego radioOn() po wznowieniu.
  bool logRadioOn_ = false;
  uint8_t peerMac_[6] = {0};
  bool peerValid_ = false;
  volatile bool haveAck_ = false;
  volatile unsigned long lastAckMs_ = 0;
  // Stan wspoldzielony z callbackiem wysylki (task Wi-Fi) — chroniony stateMux_.
  volatile int inflight_ = 0;
  volatile bool ackFailed_ = false;
  // Wspolny spinlock dla: licznikow wysylki, znacznika ACK-a i pierscienia
  // zdarzen odbioru (callback <-> petla glowna).
  portMUX_TYPE stateMux_ = portMUX_INITIALIZER_UNLOCKED;
  // Pierscien zdarzen odbioru z callbacku (patrz handlePacket).
  RxEvent rxQ_[kRxSlots];
  volatile uint8_t rxHead_ = 0;
  volatile uint8_t rxTail_ = 0;

  Phase phase_ = Phase::Idle;
  unsigned long nextWindowMs_ = 0;
  unsigned long ackDeadlineMs_ = 0;
  bool forceWindow_ = false;

  uint8_t seqS_ = 0;
  uint8_t seqL_ = 0;
  uint8_t seqR_ = 0;
  uint8_t seqP_ = 0;
  uint8_t mode_ = HUD_MODE_STATS;
  int lastMode_ = -1;
  bool modeChanged_ = false;
  unsigned long lastSMs_ = 0;
  unsigned long lastLMs_ = 0;
  bool haveFix_ = false;
  int32_t lastLatE7_ = 0;
  int32_t lastLonE7_ = 0;
  int16_t lastHeading_ = -1;
  uint8_t lastSegmentIndex_ = HUD_SEGMENT_NONE;

  // Trasa do przekazania + stan potwierdzenia z Huda (`K`).
  const uint8_t* routeData_ = nullptr;
  uint16_t routeLen_ = 0;
  uint32_t routeCrc_ = 0;
  uint8_t routeChunk_ = 0;
  uint8_t routeChunkCount_ = 0;
  uint8_t routeCycle_ = 0;
  unsigned long lastRouteAttemptMs_ = 0;
  unsigned long chunkDeadlineMs_ = 0;
  unsigned long confirmStartMs_ = 0;
  uint32_t confirmedCrc_ = 0;
  bool confirmedValid_ = false;

  // Parowanie.
  bool pairRequested_ = false;
  unsigned long pairStartMs_ = 0;
  unsigned long pairReqMs_ = 0;
  uint8_t pairCount_ = 0;  // 0 = brak, 1 = dokładnie jeden, 2 = więcej niż jeden
  uint8_t pairFound_[6] = {0};
  bool pairResultReady_ = false;
  HudPairResult pairResult_ = HudPairResult::None;
};
