import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Icon } from "../components/Icon.tsx";
import { getDistanceAxis } from "../lib/chart.ts";
import { formatDayLabel, formatDistance, formatDuration, getRunsForDay } from "../lib/data.ts";
import { useDevice } from "../lib/device.tsx";
import type { StoredRun } from "../lib/db.ts";

interface ChartPoint {
  d: number;
  v: number;
  h: number;
}

interface RunSegment {
  endD: number;
  index: number;
  run: StoredRun;
}

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
  const segments = useMemo(() => buildRunSegments(chronologicalRuns), [chronologicalRuns]);
  const chartData = useMemo(() => buildChartData(chronologicalRuns), [chronologicalRuns]);
  const maxSpeed = runs.reduce((max, run) => Math.max(max, run.maxSpeed), 0);
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

  const yMax = maxSpeed > 100 ? 150 : 100;
  const altitudeDomain = getAltitudeDomain(chartData);
  const distanceAxis = getDistanceAxis((segments.at(-1)?.endD ?? 0));
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
        <div><span>Max prędkość</span><strong>{maxSpeed.toFixed(0)}<small> km/h</small></strong></div>
        <div><span>Dystans</span><strong>{formatDistance(distanceM)}</strong></div>
        <div><span>Max nachylenie</span><strong>{maxGradeDown.toFixed(0)}<small>°</small></strong></div>
      </section>

      <section className="chart-card">
        <div className="chart-heading">
          <div><span className="eyebrow">Profil całego dnia</span><h2>Prędkość na wszystkich zjazdach</h2></div>
          <span className="chart-legend legend-speed"><i /> prędkość</span>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="#dbe5e8" strokeDasharray="3 3" />
              <XAxis axisLine={false} dataKey="d" domain={distanceAxis.domain} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#71858a", fontSize: 11 }} tickFormatter={formatDistanceTick} tickLine={false} ticks={distanceAxis.ticks} type="number" />
              <YAxis axisLine={false} domain={[0, yMax]} tick={{ fill: "#71858a", fontSize: 11 }} tickLine={false} tickMargin={4} width={48} />
              <Tooltip animationDuration={80} contentStyle={{ background: "#17363b", border: 0, borderRadius: 10, color: "#fff" }} labelFormatter={(value) => `${Number(value).toFixed(2)} km`} offset={24} />
              {yMax > 100 && <ReferenceArea fill="#f5a276" fillOpacity={0.2} y1={100} y2={150} />}
              {segments.slice(0, -1).map((segment) => <ReferenceLine key={`speed-${segment.run.id}`} stroke="#8fb7ac" strokeDasharray="4 4" x={segment.endD} />)}
              <Line dataKey="v" dot={false} isAnimationActive={false} stroke="#ee6b4a" strokeWidth={2.5} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-axis-label">Dystans [km]</div>
      </section>

      <section className="chart-card">
        <div className="chart-heading">
          <div><span className="eyebrow">Profil wysokości całego dnia</span><h2>Wysokość na wszystkich zjazdach</h2></div>
          <span className="chart-legend legend-altitude"><i /> wysokość</span>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="#dbe5e8" strokeDasharray="3 3" />
              <XAxis axisLine={false} dataKey="d" domain={distanceAxis.domain} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#71858a", fontSize: 11 }} tickFormatter={formatDistanceTick} tickLine={false} ticks={distanceAxis.ticks} type="number" />
              <YAxis axisLine={false} domain={altitudeDomain} tick={{ fill: "#71858a", fontSize: 11 }} tickLine={false} tickMargin={4} width={48} />
              <Tooltip animationDuration={80} contentStyle={{ background: "#17363b", border: 0, borderRadius: 10, color: "#fff" }} labelFormatter={(value) => `${Number(value).toFixed(2)} km`} offset={24} />
              {segments.slice(0, -1).map((segment) => <ReferenceLine key={`altitude-${segment.run.id}`} stroke="#8fb7ac" strokeDasharray="4 4" x={segment.endD} />)}
              <Area dataKey="h" fill="#78b99b" fillOpacity={0.28} isAnimationActive={false} stroke="#358866" strokeWidth={2} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-axis-label">Dystans [km] · wysokość [m]</div>
      </section>

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
                style={{ flexGrow: Math.max(segment.run.distanceM, 1) }}
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

function buildRunSegments(runs: StoredRun[]): RunSegment[] {
  let distanceOffsetM = 0;
  return runs.map((run, index) => {
    distanceOffsetM += run.distanceM;
    return { endD: distanceOffsetM / 1000, index, run };
  });
}

function buildChartData(runs: StoredRun[]): ChartPoint[] {
  const points: ChartPoint[] = [];
  let distanceOffsetM = 0;
  for (const run of runs) {
    const firstDistance = run.samples[0]?.cumDistM ?? 0;
    for (const sample of run.samples) {
      points.push({
        d: (distanceOffsetM + sample.cumDistM - firstDistance) / 1000,
        v: Math.round(sample.speedSm * 10) / 10,
        h: Math.round(sample.altSm * 10) / 10,
      });
    }
    distanceOffsetM += run.distanceM;
  }
  return points;
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

function formatDistanceTick(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function getAltitudeDomain(data: Array<{ h: number }>): [number, number] {
  const values = data.map((point) => point.h);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, 1);
  return [Math.floor((min - padding) * 10) / 10, Math.ceil((max + padding) * 10) / 10];
}
