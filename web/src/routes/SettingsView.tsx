import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon.tsx";
import {
  SZ_FREQ_LONG_DEFAULT,
  SZ_FREQ_MAX_HZ,
  SZ_FREQ_MIN_HZ,
  SZ_FREQ_SHORT_DEFAULT,
  SZ_FREQ_STEP_HZ,
  SZ_VOL_HIGH_DEFAULT,
  SZ_VOL_LOW_DEFAULT,
} from "../lib/ble.ts";
import { useDevice } from "../lib/device.tsx";
import type { Freq, Volume } from "../lib/ble.ts";

export default function SettingsView() {
  const device = useDevice();
  const [volume, setVolume] = useState<Volume | null>(null);
  const [frequency, setFrequency] = useState<Freq | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frequencyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (device.state !== "connected") {
      setVolume(null);
      setFrequency(null);
      return;
    }
    let active = true;
    setSettingsBusy(true);
    setSettingsError(null);
    async function loadSettings() {
      const nextVolume = await device.getVolume();
      let nextFrequency: Freq | null = null;
      try {
        nextFrequency = await device.getFrequency();
      } catch {
        nextFrequency = null;
      }
      return { nextVolume, nextFrequency };
    }
    loadSettings()
      .then(({ nextVolume, nextFrequency }) => {
        if (!active) return;
        setVolume(nextVolume);
        setFrequency(nextFrequency);
      })
      .catch((caught) => {
        if (active) setSettingsError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (active) setSettingsBusy(false);
      });
    return () => {
      active = false;
    };
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

  const connected = device.state === "connected" || device.state === "checking" || device.state === "downloading";

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Połączenie i ustawienia</span>
          <h1>Urządzenie</h1>
          <p className="page-subtitle">Jedno połączenie. Wszystko pod ręką.</p>
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

      {(settingsError || device.error) && <div className="alert-card alert-card-error"><Icon name="x" size={18} /><span>{settingsError ?? device.error}</span></div>}

      <section className="settings-section">
        <div className="section-heading"><div><span className="eyebrow">Feedback na stoku</span><h2>Dźwięk</h2></div><span className="section-status">{settingsBusy ? "Wczytuję…" : connected ? "Zapisuje się automatycznie" : "Połącz urządzenie"}</span></div>
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
          </div> : <p className="settings-locked">{connected ? "To urządzenie wymaga firmware 1.2+, żeby ustawiać częstotliwość." : "Suwaki pojawią się po połączeniu z urządzeniem."}</p>}
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
