import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ProfileCharts } from "../components/ProfileCharts.tsx";
import { Icon } from "../components/Icon.tsx";
import { getDistanceAxis } from "../lib/chart.ts";
import { buildDayProfile } from "../lib/chartSeries.ts";
import { buildDayRunSegments, runSampleSpanM } from "../lib/dayChart.ts";
import { formatDayLabel, formatDistance, formatDuration, getRunsForDay } from "../lib/data.ts";
import { useDevice } from "../lib/device.tsx";
import type { StoredRun } from "../lib/db.ts";
import { useChartViewport } from "../lib/useChartViewport.ts";

const TraceMap = lazy(() => import("../components/TraceMap.tsx"));

export default function DaySummaryView() {
  const { dayKey } = useParams();
  const device = useDevice();
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!dayKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getRunsForDay(dayKey)
      .then((nextRuns) => {
        if (active) setRuns(nextRuns);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dayKey, device.dataRevision]);

  const chronologicalRuns = useMemo(
    () => [...runs].sort((a, b) => Date.parse(a.startT) - Date.parse(b.startT)),
    [runs],
  );
  const segments = useMemo(() => buildDayRunSegments(chronologicalRuns), [chronologicalRuns]);
  const chartData = useMemo(() => buildDayProfile(chronologicalRuns), [chronologicalRuns]);
  const dataMaxKm = segments.length > 0 ? segments[segments.length - 1].endD : 0;
  const axisMaxKm = getDistanceAxis(dataMaxKm).domain[1];
  const { domain, apply, reset } = useChartViewport(axisMaxKm);
  const [highlight, setHighlight] = useState<{ lat: number; lon: number } | null>(null);

  const handleHighlight = useCallback((point: { lat: number; lon: number } | null) => {
    setHighlight((current) => {
      if (!point) return current === null ? current : null;
      if (current && current.lat === point.lat && current.lon === point.lon) return current;
      return point;
    });
  }, []);
  const confirmedSpeeds = runs.flatMap((run) =>
    run.confirmedMaxSpeed === null ? [] : [run.confirmedMaxSpeed],
  );
  const maxConfirmedSpeed = confirmedSpeeds.length > 0 ? Math.max(...confirmedSpeeds) : null;
  const maxRawSpeed = runs.reduce((max, run) => Math.max(max, run.rawMaxSpeed), 0);
  const distanceM = runs.reduce((sum, run) => sum + run.distanceM, 0);
  const maxGradeDown = runs.reduce((max, run) => Math.max(max, run.maxGradeDown), 0);

  if (loading) return <div className="loading-card"><span className="spinner" /> Wczytuję dzień…</div>;

  if (!dayKey || runs.length === 0) {
    return (
      <div className="empty-card empty-card-large">
        <div className="empty-icon"><Icon name="mountain" size={28} /></div>
        <h3>Brak danych tego dnia</h3>
        <Link className="button button-dark" to={dayKey ? `/dzien/${dayKey}` : "/"}>Wróć do dnia</Link>
      </div>
    );
  }

  const speedMaxKmh = maxRawSpeed > 100 ? 150 : 100;
  const boundaries = segments.slice(0, -1).map((segment) => ({ endD: segment.endD, id: segment.run.id }));
  const startT = chronologicalRuns[0]?.startT ?? runs[0].startT;
  const endT = chronologicalRuns.at(-1)?.endT ?? runs[0].endT;

  return (
    <div className="page-stack detail-page">
      <div className="detail-back-row">
        <Link className="back-link" to={`/dzien/${dayKey}`}><Icon name="chevron" size={18} /> {capitalize(formatDayLabel(dayKey))}</Link>
        <span className="demo-badge">{runs.length} zjazdów</span>
      </div>

      <header className="detail-header">
        <div>
          <span className="eyebrow">{formatClockRange(startT, endT)} · {formatDuration(startT, endT)}</span>
          <h1>Cały dzień</h1>
          <p className="page-subtitle">Połączony profil wszystkich zjazdów</p>
        </div>
      </header>

      <section className="detail-metrics">
        <div><span>Max prędkość</span><strong>{maxConfirmedSpeed === null ? "—" : maxConfirmedSpeed.toFixed(0)}<small> km/h</small></strong></div>
        <div><span>Dystans</span><strong>{formatDistance(distanceM)}</strong></div>
        <div><span>Max nachylenie</span><strong>{maxGradeDown.toFixed(0)}<small>°</small></strong></div>
      </section>

      <Suspense fallback={<div className="trace-map-loading" aria-hidden="true" />}>
        <TraceMap ariaLabel="Mapa dnia" highlight={highlight} traces={chronologicalRuns.map((run) => run.samples)} />
      </Suspense>

      <ProfileCharts
        axisMaxKm={axisMaxKm}
        data={chartData}
        domain={domain}
        eyebrow="Profil całego dnia"
        onDomainChange={apply}
        onHighlight={handleHighlight}
        onReset={reset}
        segments={boundaries}
        speedMaxKmh={speedMaxKmh}
        title="Prędkość, wysokość i przyspieszenie"
      />

      <section className="run-segments-card" aria-label="Podział trasy na zjazdy">
        <div className="run-segments-heading">
          <div><span className="eyebrow">Podział trasy</span><h2>Kliknij zjazd, aby otworzyć szczegóły</h2></div>
        </div>
        <div className="run-segments-scroll">
          <div className="run-segments">
            {segments.map((segment) => (
              <Link
                className="run-segment"
                key={segment.run.id}
                style={{ flexGrow: Math.max(runSampleSpanM(segment.run), 1) }}
                to={`/zjazd/${encodeURIComponent(segment.run.id)}`}
              >
                <strong>Zjazd {segment.index + 1}</strong>
                <span>{formatClock(segment.run.startT)} · {formatDistance(segment.run.distanceM)}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function formatClockRange(startT: string, endT: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  return `${new Date(startT).toLocaleTimeString("pl-PL", options)}–${new Date(endT).toLocaleTimeString("pl-PL", options)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", hour12: false });
}
