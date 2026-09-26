import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon.tsx";
import {
  SZ_FREQ_LONG_DEFAULT,
  SZ_FREQ_MAX_HZ,
  SZ_FREQ_MIN_HZ,
  SZ_FREQ_SHORT_DEFAULT,
  SZ_FREQ_STEP_HZ,
  SZ_MAX_BEEP_KMH,
  SZ_MIN_BEEP_DEFAULT_KMH,
  SZ_MIN_BEEP_KMH,
  SZ_MIN_BEEP_STEP_KMH,
  SZ_TIMING_GAP_DEFAULT_MS,
  SZ_TIMING_GAP_MAX_MS,
  SZ_TIMING_GAP_MIN_MS,
  SZ_TIMING_GAP_STEP_MS,
  SZ_TIMING_INTERVAL_DEFAULT_MS,
  SZ_TIMING_INTERVAL_MAX_MS,
  SZ_TIMING_INTERVAL_MIN_MS,
  SZ_TIMING_INTERVAL_STEP_MS,
  SZ_TIMING_LONG_DEFAULT_MS,
  SZ_TIMING_LONG_MAX_MS,
  SZ_TIMING_LONG_MIN_MS,
  SZ_TIMING_LONG_STEP_MS,
  SZ_TIMING_SHORT_DEFAULT_MS,
  SZ_TIMING_SHORT_MAX_MS,
  SZ_TIMING_SHORT_MIN_MS,
  SZ_TIMING_SHORT_STEP_MS,
  SZ_VOL_HIGH_DEFAULT,
  SZ_VOL_LOW_DEFAULT,
} from "../lib/ble.ts";
import { useDevice } from "../lib/device.tsx";
import type { Freq, Timing, Volume } from "../lib/ble.ts";
import { clearPwaData } from "../lib/reset.ts";
import { formatBuildTime, PWA_BUILD_TIME } from "../lib/version.ts";

export default function SettingsView() {
  const device = useDevice();
  const [volume, setVolume] = useState<Volume | null>(null);
  const [frequency, setFrequency] = useState<Freq | null>(null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [minBeepKmh, setMinBeepKmh] = useState<number | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frequencyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minBeepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const info = device.info;
    if (device.state !== "connected" || !info) {
      setVolume(null);
      setFrequency(null);
      setTiming(null);
      setMinBeepKmh(null);
      return;
    }
    setSettingsError(null);
    setVolume({ low: info.volLow, high: info.volHigh });
    setFrequency({ short: info.freqShort, long: info.freqLong });
    setTiming({ short: info.beepShortMs, long: info.beepLongMs, gap: info.beepGapMs, interval: info.signalGapMs });
    setMinBeepKmh(info.minBeepKmh);
  }, [device.state, device.info]);

  function changeVolume(which: "low" | "high", value: number) {
    setVolume((current) => current ? { ...current, [which]: value } : current);
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => {
      void device.setVolume(which, value)
        .then(setVolume)
        .catch((caught) => setSettingsError(caught instanceof Error ? caught.message : String(caught)));
    }, 600);
  }

  function changeFrequency(which: "short" | "long", value: number) {
    setFrequency((current) => current ? { ...current, [which]: value } : current);
    if (frequencyTimer.current) clearTimeout(frequencyTimer.current);
    frequencyTimer.current = setTimeout(() => {
      void device.setFrequency(which, value)
        .then(setFrequency)
        .catch((caught) => setSettingsError(caught instanceof Error ? caught.message : String(caught)));
    }, 600);
  }

  function testVolume(which: "low" | "high", value: number) {
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    void device.setVolume(which, value)
      .then(setVolume)
      .catch((caught) => setSettingsError(caught instanceof Error ? caught.message : String(caught)));
  }

  function testFrequency(which: "short" | "long", value: number) {
    if (frequencyTimer.current) clearTimeout(frequencyTimer.current);
    void device.setFrequency(which, value)
      .then(setFrequency)
      .catch((caught) => setSettingsError(caught instanceof Error ? caught.message : String(caught)));
  }

  function changeTiming(which: keyof Timing, value: number) {
    setTiming((current) => current ? { ...current, [which]: value } : current);
    if (timingTimer.current) clearTimeout(timingTimer.current);
    timingTimer.current = setTimeout(() => {
      void device.setTiming(which, value)
        .then(setTiming)
        .catch((caught) => setSettingsError(caught instanceof Error ? caught.message : String(caught)));
    }, 600);
  }

  function testTiming(which: keyof Timing, value: number) {
    if (timingTimer.current) clearTimeout(timingTimer.current);
    void device.setTiming(which, value)
      .then(setTiming)
      .catch((caught) => setSettingsError(caught instanceof Error ? caught.message : String(caught)));
  }

  function changeMinBeepKmh(value: number) {
    setMinBeepKmh(value);
    if (minBeepTimer.current) clearTimeout(minBeepTimer.current);
    minBeepTimer.current = setTimeout(() => {
      void device.setMinBeepKmh(value)
        .then(setMinBeepKmh)
        .catch((caught) => setSettingsError(caught instanceof Error ? caught.message : String(caught)));
    }, 600);
  }

  function testMinBeepKmh(value: number) {
    if (minBeepTimer.current) clearTimeout(minBeepTimer.current);
    void device.setMinBeepKmh(value)
      .then(setMinBeepKmh)
      .catch((caught) => setSettingsError(caught instanceof Error ? caught.message : String(caught)));
  }

  async function resetVolume() {
    if (!volume) return;
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    setSettingsBusy(true);
    setSettingsError(null);
    try {
      await device.setVolume("low", SZ_VOL_LOW_DEFAULT);
      setVolume(await device.setVolume("high", SZ_VOL_HIGH_DEFAULT));
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function resetFrequency() {
    if (!frequency) return;
    if (frequencyTimer.current) clearTimeout(frequencyTimer.current);
    setSettingsBusy(true);
    setSettingsError(null);
    try {
      await device.setFrequency("short", SZ_FREQ_SHORT_DEFAULT);
      setFrequency(await device.setFrequency("long", SZ_FREQ_LONG_DEFAULT));
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function resetTiming() {
    if (!timing) return;
    if (timingTimer.current) clearTimeout(timingTimer.current);
    setSettingsBusy(true);
    setSettingsError(null);
    try {
      await device.setTiming("short", SZ_TIMING_SHORT_DEFAULT_MS);
      await device.setTiming("long", SZ_TIMING_LONG_DEFAULT_MS);
      await device.setTiming("gap", SZ_TIMING_GAP_DEFAULT_MS);
      setTiming(await device.setTiming("interval", SZ_TIMING_INTERVAL_DEFAULT_MS));
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function resetMinBeepKmh() {
    if (minBeepKmh === null) return;
    if (minBeepTimer.current) clearTimeout(minBeepTimer.current);
    setSettingsBusy(true);
    setSettingsError(null);
    try {
      setMinBeepKmh(await device.setMinBeepKmh(SZ_MIN_BEEP_DEFAULT_KMH));
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSettingsBusy(false);
    }
  }

  function armDataReset() {
    setResetError(null);
    setResetArmed(true);
  }

  async function resetPwaData() {
    if (resetBusy) return;
    for (const timer of [volumeTimer, frequencyTimer, timingTimer, minBeepTimer]) {
      if (timer.current) clearTimeout(timer.current);
    }
    setResetBusy(true);
    setResetError(null);
    try {
      device.disconnect();
      await clearPwaData();
      window.location.reload();
    } catch (caught) {
      setResetBusy(false);
      setResetError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function dismissError() {
    setSettingsError(null);
    device.clearError();
  }

  const connected = device.state === "connected" || device.state === "checking" || device.state === "downloading";

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Połączenie i ustawienia</span>
          <h1>Urządzenie</h1>
        </div>
        <span className={`status-pill${connected ? " status-pill-connected" : ""}`}><span className="status-dot" /> {connected ? "Połączono" : "Offline"}</span>
      </header>

      {!connected ? (
        <section className="device-connect-card">
          <div className="device-illustration"><Icon name="bluetooth" size={30} /></div>
          <div>
            <span className="eyebrow">Szusownik</span>
            <h2>Połącz urządzenie</h2>
            <p>Po połączeniu sprawdzę nowe pliki i odblokuję ustawienia dźwięku.</p>
          </div>
          <button className="button button-dark" disabled={device.state === "connecting"} onClick={() => void device.connectAndCheck()}>
            {device.state === "connecting" ? <><span className="spinner spinner-light" /> Łączę…</> : <><Icon name="bluetooth" size={18} /> Połącz</>}
          </button>
        </section>
      ) : (
        <section className="device-info-card">
          <div className="device-info-main"><div className="connected-mark"><Icon name="check" size={18} /></div><div><strong>Szusownik</strong><span>Połączenie aktywne</span></div></div>
          <div className="device-info-values"><span>FW <b>{device.info?.fw ?? "—"}</b></span><span>Plików <b>{device.info?.files.length ?? 0}</b></span></div>
          <button className="button button-ghost" onClick={device.disconnect}>Rozłącz</button>
        </section>
      )}

      {device.pendingFiles.length > 0 && (
        <Link className="mini-sync-link" to="/"><Icon name="download" size={18} /><span><strong>{device.pendingFiles.length} nowych plików</strong><small>Przejdź do Dzisiaj, żeby je pobrać</small></span><Icon name="chevron" size={18} /></Link>
      )}

      {(settingsError || device.error) && (
        <div className="alert-card alert-card-error">
          <Icon name="x" size={18} />
          <span>{settingsError ?? device.error}</span>
          <button className="alert-card-close" type="button" aria-label="Zamknij" onClick={dismissError}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <section className="settings-section">
        <div className="section-heading"><div><span className="eyebrow">Feedback na stoku</span><h2>Dźwięk</h2></div><span className="section-status">{settingsBusy ? "Zapisuję…" : connected ? "Zapisuje się automatycznie" : "Połącz urządzenie"}</span></div>
        <div className="settings-card">
         <div className="settings-card-heading"><div className="settings-icon settings-icon-coral"><Icon name="gauge" size={19} /></div><div><h3>Głośność pikania</h3><p>Ustaw poziom dla wolnej i szybkiej jazdy.</p></div><button className="button button-ghost settings-reset" disabled={!volume || settingsBusy} onClick={() => void resetVolume()} type="button"><Icon name="refresh" size={14} /> Reset</button></div>
         {volume ? <div className="sliders">
             <SoundSlider label="Wolno" hint="60 km/h" value={volume.low} min={0} max={100} onChange={(value) => changeVolume("low", value)} onPreview={(value) => testVolume("low", value)} suffix="%" />
             <SoundSlider label="Szybko" hint="120 km/h" value={volume.high} min={0} max={100} onChange={(value) => changeVolume("high", value)} onPreview={(value) => testVolume("high", value)} suffix="%" />
          </div> : <p className="settings-locked">Suwaki pojawią się po połączeniu z urządzeniem.</p>}
        </div>

        <div className="settings-card">
         <div className="settings-card-heading"><div className="settings-icon settings-icon-green"><Icon name="activity" size={19} /></div><div><h3>Częstotliwość tonu</h3><p>Dopasuj brzmienie krótkiego i długiego sygnału.</p></div><button className="button button-ghost settings-reset" disabled={!frequency || settingsBusy} onClick={() => void resetFrequency()} type="button"><Icon name="refresh" size={14} /> Reset</button></div>
         {frequency ? <div className="sliders">
             <SoundSlider label="Ton krótki" hint="podgląd na urządzeniu" value={frequency.short} min={SZ_FREQ_MIN_HZ} max={SZ_FREQ_MAX_HZ} step={SZ_FREQ_STEP_HZ} onChange={(value) => changeFrequency("short", value)} onPreview={(value) => testFrequency("short", value)} suffix=" Hz" />
             <SoundSlider label="Ton długi" hint="podgląd na urządzeniu" value={frequency.long} min={SZ_FREQ_MIN_HZ} max={SZ_FREQ_MAX_HZ} step={SZ_FREQ_STEP_HZ} onChange={(value) => changeFrequency("long", value)} onPreview={(value) => testFrequency("long", value)} suffix=" Hz" />
           </div> : <p className="settings-locked">Suwaki pojawią się po połączeniu z urządzeniem.</p>}
         </div>

         <div className="settings-card">
          <div className="settings-card-heading"><div className="settings-icon settings-icon-coral"><Icon name="activity" size={19} /></div><div><h3>Czasy sygnału</h3><p>Każdy klik odtwarza trzy sygnały 120 km/h.</p></div><button className="button button-ghost settings-reset" disabled={!timing || settingsBusy} onClick={() => void resetTiming()} type="button"><Icon name="refresh" size={14} /> Reset</button></div>
          {timing ? <div className="sliders">
              <SoundSlider label="Krótkie piknięcie" hint="długość tonu" value={timing.short} min={SZ_TIMING_SHORT_MIN_MS} max={SZ_TIMING_SHORT_MAX_MS} step={SZ_TIMING_SHORT_STEP_MS} onChange={(value) => changeTiming("short", value)} onPreview={(value) => testTiming("short", value)} suffix=" ms" />
              <SoundSlider label="Długie piknięcie" hint="długość tonu" value={timing.long} min={SZ_TIMING_LONG_MIN_MS} max={SZ_TIMING_LONG_MAX_MS} step={SZ_TIMING_LONG_STEP_MS} onChange={(value) => changeTiming("long", value)} onPreview={(value) => testTiming("long", value)} suffix=" ms" />
              <SoundSlider label="Przerwa w sygnale" hint="między piknięciami" value={timing.gap} min={SZ_TIMING_GAP_MIN_MS} max={SZ_TIMING_GAP_MAX_MS} step={SZ_TIMING_GAP_STEP_MS} onChange={(value) => changeTiming("gap", value)} onPreview={(value) => testTiming("gap", value)} suffix=" ms" />
              <SoundSlider label="Przerwa między sygnałami" hint="między wzorami 120 km/h" value={timing.interval} min={SZ_TIMING_INTERVAL_MIN_MS} max={SZ_TIMING_INTERVAL_MAX_MS} step={SZ_TIMING_INTERVAL_STEP_MS} onChange={(value) => changeTiming("interval", value)} onPreview={(value) => testTiming("interval", value)} suffix=" ms" />
           </div> : <p className="settings-locked">Suwaki pojawią się po połączeniu z urządzeniem.</p>}
          </div>

          <div className="settings-card">
           <div className="settings-card-heading"><div className="settings-icon settings-icon-green"><Icon name="gauge" size={19} /></div><div><h3>Minimalna prędkość pikania</h3><p>Poniżej wybranego progu urządzenie zachowuje ciszę.</p></div><button className="button button-ghost settings-reset" disabled={minBeepKmh === null || settingsBusy} onClick={() => void resetMinBeepKmh()} type="button"><Icon name="refresh" size={14} /> Reset</button></div>
           {minBeepKmh !== null ? <div className="sliders">
               <SoundSlider label="Próg pikania" hint="wzór sygnału pozostaje bez zmian" value={minBeepKmh} min={SZ_MIN_BEEP_KMH} max={SZ_MAX_BEEP_KMH} step={SZ_MIN_BEEP_STEP_KMH} onChange={changeMinBeepKmh} onPreview={testMinBeepKmh} suffix=" km/h" />
            </div> : <p className="settings-locked">Suwaki pojawią się po połączeniu z urządzeniem.</p>}
          </div>
        </section>

        <section className="settings-section settings-danger-section">
          <div className="section-heading"><div><span className="eyebrow">Dane aplikacji</span><h2>Reset PWA</h2></div></div>
          <div className="settings-meta"><span>Wersja PWA</span><b>{formatBuildTime(PWA_BUILD_TIME)}</b></div>
          <div className="settings-card settings-danger-card">
            <div className="settings-card-heading"><div className="settings-icon settings-icon-danger"><Icon name="trash" size={19} /></div><div><h3>Wyczyść dane PWA</h3><p>Usuwa zapisane pliki, zjazdy, cache mapy i ustawienia tej aplikacji.</p></div></div>
            {!resetArmed ? (
              <button className="button button-danger settings-danger-button" type="button" onClick={armDataReset}>
                <Icon name="trash" size={16} /> Wyczyść dane PWA
              </button>
            ) : (
              <div className="settings-danger-confirm">
                <strong>To usunie wszystkie lokalne dane.</strong>
                <p>Nie będzie można ich odzyskać. Urządzenie BLE zostanie rozłączone, a aplikacja uruchomi się jak przy pierwszym wejściu.</p>
                <div className="settings-danger-actions">
                  <button className="button button-ghost" type="button" onClick={() => setResetArmed(false)} disabled={resetBusy}>Anuluj</button>
                  <button className="button button-danger" type="button" onClick={() => void resetPwaData()} disabled={resetBusy}>
                    {resetBusy ? <><span className="spinner spinner-light" /> Czyszczę…</> : "Tak, usuń wszystko"}
                  </button>
                </div>
              </div>
            )}
            {resetError && <div className="settings-danger-error"><Icon name="x" size={16} /> {resetError}</div>}
          </div>
        </section>
    </div>
  );
}

function SoundSlider({ label, hint, value, min, max, step = 1, suffix, onChange, onPreview }: { label: string; hint: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void; onPreview?: (value: number) => void }) {
  const pointerStartValue = useRef<number | null>(null);

  return (
    <label className="sound-slider">
      <span className="slider-label"><span>{label}<small>{hint}</small></span><strong>{value}{suffix}</strong></span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerCancel={() => { pointerStartValue.current = null; }}
        onPointerDown={(event) => { pointerStartValue.current = Number(event.currentTarget.value); }}
        onPointerUp={(event) => {
          const start = pointerStartValue.current;
          pointerStartValue.current = null;
          if (start !== null && start === Number(event.currentTarget.value)) onPreview?.(start);
        }}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}
