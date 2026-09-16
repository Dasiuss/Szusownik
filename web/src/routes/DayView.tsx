import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../components/Icon.tsx";
import { formatClock, formatDayLabel, formatDistance, formatDuration, formatFileSize, getRunsForDay, localDayKey, statsFromRuns } from "../lib/data.ts";
import { useDevice } from "../lib/device.tsx";
import type { StoredRun } from "../lib/db.ts";
import type { Run } from "../lib/runs.ts";

export default function DayView() {
  const { dayKey: routeDayKey } = useParams();
  const todayKey = localDayKey(new Date().toISOString());
  const selectedDayKey = routeDayKey ?? todayKey;
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [loading, setLoading] = useState(true);
  const device = useDevice();

  useEffect(() => {
    let active = true;
    setLoading(true);
    getRunsForDay(selectedDayKey)
      .then((nextRuns) => {
        if (active) setRuns(nextRuns);
      })
      .catch(() => {
        if (active) setRuns([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedDayKey, device.dataRevision]);

  const stats = useMemo(() => statsFromRuns(runs), [runs]);
  const isToday = selectedDayKey === todayKey;
  const dateLabel = formatDayLabel(selectedDayKey, !isToday);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Aktywność</span>
          <h1>{isToday ? "Dzisiaj" : dateLabel}</h1>
          <p className="page-subtitle">Twoje zjazdy, bez zbędnego szukania.</p>
        </div>
        <DeviceStatus state={device.state} />
      </header>

      {isToday && <SyncCard />}
      {device.error && <div className="alert-card alert-card-error"><Icon name="x" size={18} /><span>{device.error}</span></div>}

      {loading ? (
        <div className="loading-card"><span className="spinner" /> Wczytuję aktywność…</div>
      ) : (
        <>
          <section className="stats-section" aria-label="Podsumowanie aktywności">
            <div className="speed-card">
              <div className="card-kicker"><Icon name="gauge" size={17} /> Najlepszy wynik</div>
              <div className="speed-value">{stats.maxSpeed.toFixed(0)}<small>km/h</small></div>
              <div className="speed-caption">Najwyższa prędkość w tej aktywności</div>
            </div>
            <div className="metrics-grid">
              <MetricCard icon="mountain" label="Dystans w dół" value={formatDistance(stats.downhillM)} />
              <MetricCard icon="play" label="Zjazdy" value={String(stats.runs.length)} />
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Aktywność dnia</span>
                <h2>{stats.runs.length ? `${stats.runs.length} ${stats.runs.length === 1 ? "zjazd" : "zjazdy"}` : "Brak zjazdów"}</h2>
              </div>
              {isToday && <Link className="text-link" to="/historia">Historia <Icon name="chevron" size={16} /></Link>}
            </div>
            {stats.runs.length > 0 ? (
              <div className="run-list">
                {stats.runs.map((run, index) => {
                  const stored = runs[index];
                  return stored ? <RunCard key={run.id} run={run} stored={stored} index={index} /> : null;
                })}
              </div>
            ) : (
              <EmptyActivity isToday={isToday} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SyncCard() {
  const { state, pendingFiles, progress, downloadPending, connectAndCheck } = useDevice();
  const totalSize = pendingFiles.reduce((sum, file) => sum + file.size, 0);
  const busy = state === "connecting" || state === "checking" || state === "downloading";

  if (pendingFiles.length > 0) {
    return (
      <section className="sync-card sync-card-ready">
        <div className="sync-icon"><Icon name="download" size={22} /></div>
        <div className="sync-copy">
          <span className="eyebrow">Nowe na urządzeniu</span>
          <h2>{pendingFiles.length} {pendingFiles.length === 1 ? "zjazd czeka" : "zjazdy czekają"}</h2>
          <p>{formatFileSize(totalSize)} do pobrania. Dane pojawią się tutaj po synchronizacji.</p>
        </div>
        <button className="button button-primary sync-action" onClick={() => void downloadPending()}>
          <Icon name="download" size={18} /> Pobierz dane
        </button>
      </section>
    );
  }

  if (state === "downloading") {
    return (
      <section className="sync-card sync-card-progress">
        <div className="sync-icon"><span className="spinner spinner-light" /></div>
        <div className="sync-copy">
          <span className="eyebrow">Synchronizacja w toku</span>
          <h2>Pobieram Twoje zjazdy</h2>
          <p>{progress ? `${progress.file} · ramka ${progress.receivedFrames} · plik ${progress.fileIndex}/${progress.fileCount}` : "Przygotowuję transfer…"}</p>
        </div>
      </section>
    );
  }

  if (state === "connecting" || state === "checking") {
    return (
      <section className="sync-card sync-card-progress">
        <div className="sync-icon"><span className="spinner spinner-light" /></div>
        <div className="sync-copy">
          <span className="eyebrow">Urządzenie</span>
          <h2>{state === "connecting" ? "Łączę z Szusownikiem" : "Sprawdzam nowe zjazdy"}</h2>
          <p>{state === "connecting" ? "Wybierz urządzenie w oknie Chrome." : "Jeszcze chwila, przeglądam kartę pamięci."}</p>
        </div>
      </section>
    );
  }

  if (state === "connected") return null;

  return (
    <section className="sync-card sync-card-connect">
      <div className="sync-icon"><Icon name="bluetooth" size={22} /></div>
      <div className="sync-copy">
        <span className="eyebrow">Szusownik</span>
        <h2>Gotowy na nowy zjazd?</h2>
        <p>Połącz urządzenie, a od razu sprawdzę, co czeka na pobranie.</p>
      </div>
      <button className="button button-dark sync-action" onClick={() => void connectAndCheck()} disabled={busy}>
        <Icon name="bluetooth" size={18} /> Połącz urządzenie
      </button>
    </section>
  );
}

function DeviceStatus({ state }: { state: string }) {
  const connected = state === "connected" || state === "checking" || state === "downloading";
  return (
    <span className={`status-pill${connected ? " status-pill-connected" : ""}`}>
      <span className="status-dot" /> {connected ? "Połączono" : "Offline"}
    </span>
  );
}

function MetricCard({ icon, label, value }: { icon: "mountain" | "play"; label: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="metric-icon"><Icon name={icon} size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RunCard({ run, stored, index }: { run: Run; stored: StoredRun; index: number }) {
  const title = stored.label ?? `Zjazd ${index + 1}`;
  return (
    <Link className="run-card" to={`/zjazd/${encodeURIComponent(run.id)}`}>
      <div className="run-card-topline">
        <div className="run-title-wrap">
          <span className="run-number">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong>{title}</strong>
            <span className="run-time">{formatClock(run.startT)}–{formatClock(run.endT)} · {formatDuration(run.startT, run.endT)}</span>
          </div>
        </div>
        <Icon name="chevron" size={19} />
      </div>
      <div className="run-card-stats">
        <span><b>{run.maxSpeed.toFixed(0)}</b> km/h</span>
        <span><b>{formatDistance(run.distanceM)}</b></span>
        <span><b>{run.maxGradeDown.toFixed(0)}°</b> nachyl.</span>
      </div>
    </Link>
  );
}

function EmptyActivity({ isToday }: { isToday: boolean }) {
  return (
    <div className="empty-card">
      <div className="empty-icon"><Icon name="mountain" size={28} /></div>
      <h3>{isToday ? "Ten dzień dopiero się zaczyna" : "Brak zapisanych zjazdów"}</h3>
      <p>{isToday ? "Po synchronizacji urządzenia Twoje wyniki pojawią się tutaj." : "Wybierz inny dzień z historii."}</p>
    </div>
  );
}
