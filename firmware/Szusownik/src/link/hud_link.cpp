#include "hud_link.h"

#include <Preferences.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <math.h>
#include <string.h>

#include "../config/config.h"
#include "../config/log.h"
#include "../core/route.h"

namespace {

const uint8_t kBroadcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

HudLink* g_hudSelf = nullptr;
Preferences g_hudPrefs;

// ESP32 (core 3.x): callback odbioru ma sygnaturę z esp_now_recv_info_t*.
void onHudRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (g_hudSelf != nullptr) {
    g_hudSelf->handlePacket(info != nullptr ? info->src_addr : nullptr, data,
                            static_cast<size_t>(len));
  }
}

void onHudSent(const esp_now_send_info_t* info, esp_now_send_status_t status) {
  if (g_hudSelf == nullptr) return;
  // Broadcast nie ma ACK-a. Rozpoznajemy go po adresie docelowym pakietu, a nie
  // po globalnej fladze — inaczej opozniony callback broadcastu moglby zostac
  // policzony jako ACK kolejnego unicastu.
  const bool unicast = info != nullptr && info->des_addr != nullptr &&
                       memcmp(info->des_addr, kBroadcast, 6) != 0;
  g_hudSelf->onSent(status == ESP_NOW_SEND_SUCCESS, unicast);
}

}  // namespace

bool HudLink::begin() {
  g_hudSelf = this;
  loadPeer();
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();  // bez asocjacji — tylko ESP-NOW na stałym kanale
  // Jednorazowa inicjalizacja: doprowadzamy sterownik do stanu "gotowy, PHY off",
  // żeby kolejne radioOn()/radioOff() były tanim przełączeniem (patrz docs).
  if (!radioOn()) {
    SZ_LOGE("HUD esp-now init fail");
    return false;
  }
  radioOff();
  ready_ = true;
  SZ_LOGIF("HUD esp-now ready ch=%d paired=%d", HUD_LINK_CHANNEL, peerValid_ ? 1 : 0);
  return true;
}

bool HudLink::radioOn() {
  if (radio_) return true;
  esp_wifi_start();
  if (esp_now_init() != ESP_OK) {
    SZ_LOGE("HUD esp-now init fail");
    return false;
  }
  esp_now_register_send_cb(onHudSent);
  esp_now_register_recv_cb(onHudRecv);
  addPeerMac(kBroadcast);
  if (peerValid_) addPeerMac(peerMac_);
  esp_wifi_set_channel(HUD_LINK_CHANNEL, WIFI_SECOND_CHAN_NONE);
  portENTER_CRITICAL(&stateMux_);
  inflight_ = 0;
  ackFailed_ = false;
  portEXIT_CRITICAL(&stateMux_);
  radio_ = true;
  return true;
}

void HudLink::radioOff() {
  if (!radio_) return;
  esp_now_deinit();
  esp_wifi_stop();
  radio_ = false;
  portENTER_CRITICAL(&stateMux_);
  inflight_ = 0;
  portEXIT_CRITICAL(&stateMux_);
}

bool HudLink::addPeerMac(const uint8_t* mac) {
  esp_now_peer_info_t peer;
  memset(&peer, 0, sizeof(peer));
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = HUD_LINK_CHANNEL;
  peer.encrypt = false;
  peer.ifidx = WIFI_IF_STA;
  return esp_now_add_peer(&peer) == ESP_OK;
}

bool HudLink::sendToPeer(const uint8_t* data, size_t len) {
  if (!radio_ || !peerValid_) return false;
  // Licznik zwiększamy PRZED esp_now_send: callback (task Wi-Fi) może odpalić
  // się natychmiast i zdążyć zdekrementować przed tym zapisem.
  portENTER_CRITICAL(&stateMux_);
  inflight_++;
  portEXIT_CRITICAL(&stateMux_);
  if (esp_now_send(peerMac_, data, len) != ESP_OK) {
    portENTER_CRITICAL(&stateMux_);
    if (inflight_ > 0) inflight_--;
    ackFailed_ = true;
    portEXIT_CRITICAL(&stateMux_);
    return false;
  }
  return true;
}

bool HudLink::sendBroadcast(const uint8_t* data, size_t len) {
  if (!radio_) return false;
  portENTER_CRITICAL(&stateMux_);
  inflight_++;
  portEXIT_CRITICAL(&stateMux_);
  if (esp_now_send(kBroadcast, data, len) != ESP_OK) {
    portENTER_CRITICAL(&stateMux_);
    if (inflight_ > 0) inflight_--;
    portEXIT_CRITICAL(&stateMux_);
    return false;
  }
  return true;
}

void HudLink::onSent(bool ok, bool unicast) {
  portENTER_CRITICAL(&stateMux_);
  if (inflight_ > 0) inflight_--;
  if (unicast) {
    if (ok) {
      haveAck_ = true;
      lastAckMs_ = millis();
    } else {
      ackFailed_ = true;
    }
  }
  portEXIT_CRITICAL(&stateMux_);
}

void HudLink::noteAck() {
  portENTER_CRITICAL(&stateMux_);
  haveAck_ = true;
  lastAckMs_ = millis();
  portEXIT_CRITICAL(&stateMux_);
}

int HudLink::inflightCount() {
  portENTER_CRITICAL(&stateMux_);
  const int count = inflight_;
  portEXIT_CRITICAL(&stateMux_);
  return count;
}

bool HudLink::takeAckFailed() {
  portENTER_CRITICAL(&stateMux_);
  const bool failed = ackFailed_;
  ackFailed_ = false;
  portEXIT_CRITICAL(&stateMux_);
  return failed;
}

bool HudLink::linkRecent(unsigned long now) {
  portENTER_CRITICAL(&stateMux_);
  const bool recent = haveAck_ && (now - lastAckMs_) <= HUD_LINK_TIMEOUT_MS;
  portEXIT_CRITICAL(&stateMux_);
  return recent;
}

void HudLink::pushRxEvent(uint8_t type, const uint8_t* mac, uint32_t crc) {
  portENTER_CRITICAL(&stateMux_);
  const uint8_t next = static_cast<uint8_t>((rxHead_ + 1) % kRxSlots);
  if (next != rxTail_) {  // pełny pierścień: gubimy (trasa i tak wróci w kolejnym oknie)
    rxQ_[rxHead_].type = type;
    memcpy(rxQ_[rxHead_].mac, mac, 6);
    rxQ_[rxHead_].crc = crc;
    rxHead_ = next;
  }
  portEXIT_CRITICAL(&stateMux_);
}

void HudLink::drainRxEvents() {
  for (;;) {
    RxEvent event;
    portENTER_CRITICAL(&stateMux_);
    if (rxTail_ == rxHead_) {
      portEXIT_CRITICAL(&stateMux_);
      return;
    }
    event = rxQ_[rxTail_];
    rxTail_ = static_cast<uint8_t>((rxTail_ + 1) % kRxSlots);
    portEXIT_CRITICAL(&stateMux_);
    applyRxEvent(event);
  }
}

void HudLink::applyRxEvent(const RxEvent& ev) {
  if (ev.type == static_cast<uint8_t>(HUD_PKT_PAIR_RESP)) {
    // Liczymy tylko w trakcie okna zbierania: spóźniona/obca odpowiedź 'Q'
    // (zdarzenie czeka w pierścieniu) nie może zawyżyć wyniku kolejnego parowania.
    if (phase_ != Phase::Pair) return;
    // Deduplikacja po MAC-u nadawcy: 0 = brak, 1 = dokładnie jeden, 2 = więcej.
    if (pairCount_ == 0) {
      memcpy(pairFound_, ev.mac, 6);
      pairCount_ = 1;
    } else if (memcmp(pairFound_, ev.mac, 6) != 0) {
      pairCount_ = 2;
    }
    return;
  }
  if (ev.type == static_cast<uint8_t>(HUD_PKT_ROUTE_CONFIRM)) {
    // Potwierdzenie liczy się tylko od sparowanego Huda — po sparowaniu innego
    // urządzenia stary CRC nie może zablokować wysyłki bieżącej trasy.
    if (!hudConfirmFromPeer(ev.mac, peerMac_, peerValid_)) return;
    confirmedCrc_ = ev.crc;
    confirmedValid_ = true;
    noteAck();
  }
}

bool HudLink::peerLinked(unsigned long now) {
  return peerValid_ && linkRecent(now);
}

bool HudLink::routeConfirmed() const {
  return confirmedValid_ && hudRouteConfirmed(confirmedCrc_, routeCrc_);
}

void HudLink::scheduleNextWindow(unsigned long now) {
  nextWindowMs_ = now + hudWindowPeriodMs(peerLinked(now), mode_);
}

void HudLink::setRoute(const uint8_t* data, uint16_t len, uint32_t crc) {
  if (routeData_ == data && routeLen_ == len && routeCrc_ == crc) return;
  routeData_ = data;
  routeLen_ = len;
  routeCrc_ = crc;
  routeChunk_ = 0;
  routeChunkCount_ = hudRouteChunkCount(len);  // nowa trasa może być krótsza
  routeCycle_ = 0;
  lastRouteAttemptMs_ = 0;  // nowa trasa: wyślij od razu, bez progu odstępu
  if (phase_ == Phase::Route || phase_ == Phase::Confirm) {
    // Przerwij bieżący transfer — dalej leci już nowy blob (inna długość i CRC),
    // a stary `routeChunkCount_`/offset nie opisuje tej trasy.
    radioOff();
    phase_ = Phase::Idle;
  }
  forceWindow_ = true;
}

void HudLink::requestPairing() {
  clearPeer();
  pairRequested_ = true;
}

bool HudLink::takePairResult(HudPairResult& out) {
  if (!pairResultReady_) return false;
  pairResultReady_ = false;
  out = pairResult_;
  return true;
}

void HudLink::handlePacket(const uint8_t* mac, const uint8_t* data, size_t len) {
  // Callback odbioru ESP-NOW (task Wi-Fi): tylko dekodujemy i wrzucamy zdarzenie
  // do pierścienia. Wszystkie pola stanu zmienia pętla główna (drainRxEvents),
  // więc nie ma współdzielonych pól między taskami.
  if (data == nullptr || mac == nullptr) return;
  const uint8_t type = data[0];
  if (type == static_cast<uint8_t>(HUD_PKT_PAIR_RESP)) {
    HudPairResponse resp;
    if (decodeHudPairResponse(data, len, resp) == 0) return;
    pushRxEvent(type, mac, 0);
  } else if (type == static_cast<uint8_t>(HUD_PKT_ROUTE_CONFIRM)) {
    HudRouteConfirm confirm;
    if (decodeHudRouteConfirm(data, len, confirm) == 0) return;
    pushRxEvent(type, mac, confirm.crc);
  }
}

void HudLink::tick(unsigned long nowMs, const HudInput& in, bool paused) {
  if (!ready_) return;

  // Zdarzenia z callbacku odbioru (odpowiedzi 'Q' na 'P' i potwierdzenia 'K')
  // rozbieramy tutaj — cały stan gry zmienia wyłącznie pętla główna.
  drainRxEvents();

  if (paused) {
    // Transfer BLE ma priorytet — nie zabieramy wspólnego radia.
    if (radio_) radioOff();
    phase_ = Phase::Idle;
    paused_ = true;
    return;
  }
  if (paused_) {
    paused_ = false;
    forceWindow_ = true;  // wznów bez czekania na koniec okresu
  }

  mode_ = hudModeForSpeed(in.speedKmh);
  modeChanged_ = static_cast<int>(mode_) != lastMode_;
  lastMode_ = mode_;
  lastSegmentIndex_ = in.segmentIndex;
  if (modeChanged_) forceWindow_ = true;

  if (in.fix) {
    if (!haveFix_) forceWindow_ = true;  // pierwszy fix: pokaż mapę od razu
    haveFix_ = true;
    lastLatE7_ = in.latE7;
    lastLonE7_ = in.lonE7;
    lastHeading_ = in.heading;
  }

  if (pairRequested_) {
    pairRequested_ = false;
    pairStartMs_ = nowMs;
    pairReqMs_ = 0;
    pairCount_ = 0;
    radioOff();
    if (!radioOn()) {
      pairResult_ = HudPairResult::Error;
      pairResultReady_ = true;
      scheduleNextWindow(nowMs);
      return;
    }
    phase_ = Phase::Pair;
  }

  switch (phase_) {
    case Phase::Idle:
      if (forceWindow_ || static_cast<long>(nowMs - nextWindowMs_) >= 0) {
        forceWindow_ = false;
        if (routeWantsSend(nowMs)) {
          startRoute(nowMs);
        } else {
          openTelemetryWindow(nowMs, in);
        }
      }
      break;

    case Phase::Tx:
      // Gasimy radio, gdy tylko wysyłka dostanie ACK (albo po marginesie).
      if (inflightCount() == 0 || static_cast<long>(nowMs - ackDeadlineMs_) >= 0) {
        radioOff();
        phase_ = Phase::Idle;
        scheduleNextWindow(nowMs);
      }
      break;

    case Phase::Route:
      serviceRoute(nowMs);
      break;

    case Phase::Confirm:
      if (routeConfirmed()) {
        endRouteTransfer(nowMs);
      } else if (nowMs - confirmStartMs_ >= HUD_ROUTE_CONFIRM_TIMEOUT_MS) {
        routeCycle_++;
        if (routeCycle_ < HUD_ROUTE_MAX_CYCLES) {
          routeChunk_ = 0;
          phase_ = Phase::Route;
        } else {
          endRouteTransfer(nowMs);
        }
      }
      break;

    case Phase::Pair:
      servicePairing(nowMs);
      break;
  }
}

void HudLink::openTelemetryWindow(unsigned long nowMs, const HudInput& in) {
  if (!peerValid_ || !radioOn()) {
    scheduleNextWindow(nowMs);
    return;
  }
  bool sent = false;
  if (mode_ == HUD_MODE_MAP) {
    if (haveFix_ && (modeChanged_ || nowMs - lastLMs_ >= HUD_SEND_LOCATION_MS)) {
      sent |= sendLocation(nowMs, HUD_MODE_MAP);
    }
  } else {
    if (modeChanged_ && haveFix_) sent |= sendLocation(nowMs, HUD_MODE_STATS);
    sendTelemetry(nowMs, in);
    sent = true;
  }
  modeChanged_ = false;

  if (!sent) {
    radioOff();
    scheduleNextWindow(nowMs);
    return;
  }
  ackDeadlineMs_ = nowMs + HUD_TX_ACK_GRACE_MS;
  phase_ = Phase::Tx;
}

void HudLink::sendTelemetry(unsigned long nowMs, const HudInput& in) {
  HudTelemetry t;
  const float speed = in.speedKmh > 0.0f ? in.speedKmh : 0.0f;
  t.speedKmh = static_cast<uint16_t>(lroundf(speed));
  t.navAngle = in.heading;
  t.averageKmh = in.maxDayKmh;
  t.remaining = 0;  // REM — na razie stałe
  t.totalTenthsKm = hudTenthsKm(in.totalKm);
  t.frame = true;
  t.segmentIndex = in.segmentIndex;

  uint8_t packet[HUD_PKT_TELEMETRY_SIZE];
  if (encodeHudTelemetry(packet, sizeof(packet), seqS_++, t)) {
    sendToPeer(packet, HUD_PKT_TELEMETRY_SIZE);
  }
  lastSMs_ = nowMs;
}

bool HudLink::sendLocation(unsigned long nowMs, uint8_t mode) {
  HudLocation loc;
  loc.mode = mode;
  loc.zoom = HUD_LOCATION_ZOOM;
  loc.latE7 = lastLatE7_;
  loc.lonE7 = lastLonE7_;
  loc.heading = lastHeading_;
  loc.fisheye = HUD_FISHEYE;
  loc.segmentIndex = haveFix_ ? lastSegmentIndex_ : HUD_SEGMENT_NONE;

  uint8_t packet[HUD_PKT_LOCATION_SIZE];
  if (!encodeHudLocation(packet, sizeof(packet), seqL_++, loc)) return false;
  if (!sendToPeer(packet, HUD_PKT_LOCATION_SIZE)) return false;
  lastLMs_ = nowMs;
  return true;
}

bool HudLink::routeWantsSend(unsigned long nowMs) {
  if (!peerValid_ || routeData_ == nullptr || routeLen_ == 0) return false;
  if (routeConfirmed()) return false;
  if (!peerLinked(nowMs)) return false;
  if (lastRouteAttemptMs_ != 0 && nowMs - lastRouteAttemptMs_ < SZ_HUD_ROUTE_RESEND_MS) {
    return false;
  }
  return true;
}

void HudLink::startRoute(unsigned long nowMs) {
  if (!radioOn()) {
    scheduleNextWindow(nowMs);
    return;
  }
  routeChunkCount_ = hudRouteChunkCount(routeLen_);
  routeChunk_ = 0;
  routeCycle_ = 0;
  lastRouteAttemptMs_ = nowMs;
  chunkDeadlineMs_ = 0;
  (void)takeAckFailed();  // świeży burst: nie dziedziczymy błędu z telemetrii
  phase_ = Phase::Route;
}

void HudLink::serviceRoute(unsigned long nowMs) {
  if (inflightCount() > 0) {
    // Czekamy na ACK ostatniego chunku; brak w HUD_ROUTE_CHUNK_ACK_TIMEOUT_MS
    // oznacza, że Hud przestał odpowiadać — przerywamy transfer.
    if (nowMs - chunkDeadlineMs_ < HUD_ROUTE_CHUNK_ACK_TIMEOUT_MS) return;
    endRouteTransfer(nowMs);
    return;
  }
  if (takeAckFailed()) {
    endRouteTransfer(nowMs);
    return;
  }
  if (routeChunk_ >= routeChunkCount_) {
    confirmStartMs_ = nowMs;  // cały burst wysłany — czekamy na `K` z CRC
    phase_ = Phase::Confirm;
    return;
  }

  const uint16_t offset = static_cast<uint16_t>(routeChunk_) * HUD_ROUTE_CHUNK_BYTES;
  const uint16_t payloadLen = hudRouteChunkLen(routeLen_, routeChunk_);
  if (payloadLen == 0) {
    // Trasa została podmieniona na krótszą w trakcie transferu — przerwij, żeby
    // nie odczytać danych spoza bloba (i nie zawinąć `routeLen_ - offset`).
    endRouteTransfer(nowMs);
    return;
  }
  uint8_t packet[HUD_PKT_ROUTE_SIZE];
  const size_t len = encodeHudRouteChunk(packet, sizeof(packet), seqR_++, routeChunk_,
                                         routeChunkCount_, routeLen_, routeCrc_,
                                         routeData_ + offset, payloadLen);
  if (len == 0 || !sendToPeer(packet, len)) {
    endRouteTransfer(nowMs);
    return;
  }
  routeChunk_++;
  chunkDeadlineMs_ = nowMs;
}

void HudLink::endRouteTransfer(unsigned long nowMs) {
  radioOff();
  phase_ = Phase::Idle;
  lastRouteAttemptMs_ = nowMs;
  scheduleNextWindow(nowMs);
}

void HudLink::servicePairing(unsigned long nowMs) {
  if (nowMs - pairReqMs_ >= HUD_PAIR_REQ_MS) {
    uint8_t packet[HUD_PKT_PAIR_REQ_SIZE];
    if (encodeHudPairRequest(packet, sizeof(packet), seqP_++)) {
      sendBroadcast(packet, HUD_PKT_PAIR_REQ_SIZE);
    }
    pairReqMs_ = nowMs;
  }
  if (nowMs - pairStartMs_ < HUD_PAIR_COLLECT_MS) return;

  radioOff();
  phase_ = Phase::Idle;
  if (pairCount_ == 0) {
    pairResult_ = HudPairResult::None;
  } else if (pairCount_ == 1) {
    memcpy(peerMac_, pairFound_, 6);
    peerValid_ = true;
    // Nowy Hud nie potwierdził jeszcze żadnej trasy — stary CRC unieważniamy.
    confirmedValid_ = false;
    confirmedCrc_ = 0;
    savePeer();
    pairResult_ = HudPairResult::Ok;
    forceWindow_ = true;  // natychmiast unicast, żeby Hud oznaczył się jako sparowany
  } else {
    pairResult_ = HudPairResult::TooMany;
  }
  pairResultReady_ = true;
  scheduleNextWindow(nowMs);
  SZ_LOGIF("HUD parowanie done result=%d", static_cast<int>(pairResult_));
}

void HudLink::loadPeer() {
  g_hudPrefs.begin("hudlink", true);
  if (g_hudPrefs.getBytesLength("mac") == 6) {
    g_hudPrefs.getBytes("mac", peerMac_, 6);
    peerValid_ = true;
  }
  g_hudPrefs.end();
}

void HudLink::savePeer() {
  g_hudPrefs.begin("hudlink", false);
  g_hudPrefs.putBytes("mac", peerMac_, 6);
  g_hudPrefs.end();
}

void HudLink::clearPeer() {
  g_hudPrefs.begin("hudlink", false);
  g_hudPrefs.remove("mac");
  g_hudPrefs.end();
  peerValid_ = false;
  portENTER_CRITICAL(&stateMux_);
  haveAck_ = false;
  portEXIT_CRITICAL(&stateMux_);
  // Bieżący transfer trasy nie ma już odbiorcy.
  confirmedValid_ = false;
  confirmedCrc_ = 0;
  if (phase_ == Phase::Route || phase_ == Phase::Confirm) {
    radioOff();
    phase_ = Phase::Idle;
  }
  memset(peerMac_, 0, sizeof(peerMac_));
}
