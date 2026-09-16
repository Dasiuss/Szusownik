import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon.tsx";
import { formatDayLabel, formatDistance, getAllRuns, statsFromRuns } from "../lib/data.ts";
import { useDevice } from "../lib/device.tsx";
import type { StoredRun } from "../lib/db.ts";

export default function HistoryView() {
  const device = useDevice();
  const [runs, setRuns] = useState<StoredRun[]>([]);

  useEffect(() => {
    let active = true;
    getAllRuns().then((nextRuns) => {
      if (active) setRuns(nextRuns);
    });
    return () => {
      active = false;
    };
  }, [device.dataRevision]);

  const groups = useMemo(() => {
    const grouped = new Map<string, StoredRun[]>();
    for (const run of runs) {
      const day = grouped.get(run.dayKey) ?? [];
      day.push(run);
      grouped.set(run.dayKey, day);
    }
    return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [runs]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Twoje dane</span>
          <h1>Historia</h1>
          <p className="page-subtitle">Każdy zjazd zostaje na swoim miejscu.</p>
        </div>
        <span className="history-count"><strong>{runs.length}</strong> zjazdów</span>
      </header>

      {groups.length === 0 ? (
        <div className="empty-card empty-card-large">
          <div className="empty-icon"><Icon name="archive" size={28} /></div>
          <h3>Historia jest pusta</h3>
          <p>Połącz urządzenie, żeby zapisać pierwszy dzień na tej liście.</p>
          <Link className="button button-dark" to="/"><Icon name="activity" size={18} /> Wróć do dzisiaj</Link>
        </div>
      ) : (
        <div className="history-list">
          {groups.map(([dayKey, dayRuns], index) => {
            const stats = statsFromRuns(dayRuns);
            const best = [...dayRuns].sort((a, b) => b.maxSpeed - a.maxSpeed)[0];
            return (
              <Link className="day-card" key={dayKey} to={`/dzien/${dayKey}`}>
                <div className="day-card-header">
                  <div>
                    <span className="eyebrow">{index === 0 ? "Ostatnia aktywność" : "Dzień"}</span>
                    <h2>{capitalize(formatDayLabel(dayKey, true))}</h2>
                  </div>
                  <Icon name="chevron" size={20} />
                </div>
                <div className="day-card-summary">
                  <span><b>{stats.maxSpeed.toFixed(0)}</b> km/h max</span>
                  <span><b>{formatDistance(stats.downhillM)}</b> w dół</span>
                  <span><b>{dayRuns.length}</b> {dayRuns.length === 1 ? "zjazd" : "zjazdów"}</span>
                </div>
                {best && (
                  <div className="day-card-footer">
                    <span><Icon name="gauge" size={15} /> Najlepszy: {best.label ?? "zjazd"}</span>
                    <span>{best.demo ? "Demo" : `${best.samples.length} próbek`}</span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
