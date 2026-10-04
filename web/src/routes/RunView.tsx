import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartZoomSurface } from "../components/ChartZoomSurface.tsx";
import { Icon } from "../components/Icon.tsx";
import { QualityIndicators } from "../components/QualityIndicators.tsx";
import { getDistanceAxis, getDistanceAxisForDomain } from "../lib/chart.ts";
import { deleteRun, formatClock, formatDayLabel, formatDistance, formatDuration, getAllRuns, getRunsForDay, renameRun, runNumbers } from "../lib/data.ts";
import { db, type StoredRun } from "../lib/db.ts";
import { DIFFICULTY_COLORS } from "../lib/mapData.ts";
import {
  previousRidesForSequence,
  routeHistories,
  routeSequenceKey,
  type PreviousRide,
  type RouteSequenceItem,
  type RunRouteRecord,
} from "../lib/routeMatching.ts";
import { QUALITY_ANALYSIS_VERSION } from "../lib/runs.ts";
import { useChartViewport } from "../lib/useChartViewport.ts";

export default function RunView() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState<StoredRun | null>(null);
  const [runNumber, setRunNumber] = useState<number | null>(null);
  const [records, setRecords] = useState<RunRouteRecord[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState("");
  const decodedRunId = runId ? decodeURIComponent(runId) : undefined;

  useEffect(() => {
    let active = true;
    if (!decodedRunId) {
      setLoading(false);
      return;
    }
    void (async () => {
      const stored = await db.runs.get(decodedRunId);
      if (!active) return;
      const valid = stored?.analysisVersion === QUALITY_ANALYSIS_VERSION ? stored : null;
      setRun(valid);
      setLabel(stored?.label ?? "");
      if (valid) {
        const dayRuns = await getRunsForDay(valid.dayKey);
        if (!active) return;
        setRunNumber(runNumbers(dayRuns).get(valid.id) ?? null);
      }
      const all = await getAllRuns();
      if (!active) return;
      setRecords(all.map((record) => ({
        id: record.id,
        startT: record.startT,
        routeSpans: record.routeSpans ?? [],
        routeSequence: record.routeSequence ?? [],
      })));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [decodedRunId]);

  const sequence = useMemo(() => run?.routeSequence ?? [], [run]);
  const sequenceKey = routeSequenceKey(sequence);
  const prevSameSequence = useMemo(
    () => (run ? previousRidesForSequence(records, sequence, run.id) : []),
    [records, sequence, run],
  );
  const routeGroups = useMemo(
    () => (run ? routeHistories(records, sequence, run.id).filter((group) => group.rideCount > 0) : []),
    [records, sequence, run],
  );

  function toggleExpanded(key: string): void {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  }

  async function saveLabel() {
    if (!run) return;
    await renameRun(run.id, label);
    setRun({ ...run, label: label.trim() ? label.trim().slice(0, 40) : undefined });
    setEditingLabel(false);
  }

  async function removeRun() {
    if (!run || !window.confirm("Usunąć ten zjazd z historii?")) return;
    await deleteRun(run.id);
    navigate(`/dzien/${run.dayKey}`, { replace: true });
  }

  const chartData = useMemo(() => {
    if (!run || run.samples.length === 0) return [];
    const firstDistance = run.samples[0]?.cumDistM ?? 0;
    return run.samples.map((sample) => ({
      d: (sample.cumDistM - firstDistance) / 1000,
      v: Math.round(sample.speedSm * 10) / 10,
      h: Math.round(sample.altSm * 10) / 10,
    }));
  }, [run]);

  const dataMaxKm = chartData.length > 0 ? chartData[chartData.length - 1].d : 0;
  const axisMaxKm = getDistanceAxis(dataMaxKm).domain[1];
  const { domain, apply, reset } = useChartViewport(axisMaxKm);
  const distanceAxis = useMemo(
    () => getDistanceAxisForDomain(domain[0], domain[1]),
    [domain],
  );

  if (loading) return <div className="loading-card"><span className="spinner" /> Wczytuję zjazd…</div>;

  if (!run) {
    return (
      <div className="empty-card empty-card-large">
        <div className="empty-icon"><Icon name="x" size={28} /></div>
        <h3>Nie znaleziono tego zjazdu</h3>
        <p>Być może został usunięty z lokalnej historii.</p>
        <Link className="button button-dark" to="/"><Icon name="activity" size={18} /> Wróć do dzisiaj</Link>
      </div>
    );
  }

  const yMax = run.rawMaxSpeed > 100 ? 150 : 100;
  const altitudeDomain = getAltitudeDomain(chartData);

  return (
    <div className="page-stack detail-page">
      <div className="detail-back-row">
        <Link className="back-link" to={`/dzien/${run.dayKey}`}><Icon name="chevron" size={18} /> {capitalize(formatDayLabel(run.dayKey))}</Link>
        {run.demo && <span className="demo-badge">Demo</span>}
      </div>

      <header className="detail-header">
        <div>
          <span className="eyebrow">{formatClock(run.startT)} · {formatDuration(run.startT, run.endT)}</span>
          {run.label ? (
            <>
              <h1>{run.label}</h1>
              {sequence.length > 0 && <SequenceChips sequence={sequence} />}
            </>
          ) : sequence.length > 0 ? (
            <h1 className="route-title">
              {sequence.map((item, index) => (
                <Fragment key={`${item.key}-${index}`}>
                  {index > 0 && <span className="rt-arrow">→</span>}
                  <span className="rt-num" style={{ color: routeColor(item.difficulty) }}>{item.label}</span>
                </Fragment>
              ))}
            </h1>
          ) : (
            <h1>{runNumber ? `Zjazd ${runNumber}` : "Zjazd"}</h1>
          )}
          <p className="page-subtitle">{formatDayLabel(run.dayKey, true)}</p>
        </div>
        <button aria-label="Usuń zjazd" className="icon-button icon-button-danger" onClick={() => void removeRun()}><Icon name="trash" size={19} /></button>
      </header>

      <div className="detail-actions">
        {editingLabel ? (
          <form className="label-form" onSubmit={(event) => { event.preventDefault(); void saveLabel(); }}>
            <input autoFocus maxLength={40} onChange={(event) => setLabel(event.target.value)} placeholder="Np. Najlepszy stok" value={label} />
            <button aria-label="Zapisz nazwę" className="icon-button icon-button-dark" type="submit"><Icon name="check" size={18} /></button>
            <button aria-label="Anuluj" className="icon-button" onClick={() => setEditingLabel(false)} type="button"><Icon name="x" size={18} /></button>
          </form>
        ) : (
          <button className="button button-soft" onClick={() => setEditingLabel(true)}><Icon name="edit" size={17} /> {run.label ? "Zmień nazwę" : "Nadaj nazwę"}</button>
        )}
      </div>

      <section className="detail-metrics">
        <div className="confirmed-speed-metric">
          <span>Max prędkość</span>
          <strong>{run.confirmedMaxSpeed === null ? "—" : <>{run.confirmedMaxSpeed.toFixed(0)}<small> km/h</small></>}</strong>
          {run.confirmedQuality && <QualityIndicators quality={run.confirmedQuality} />}
        </div>
        <div><span>Dystans</span><strong>{formatDistance(run.distanceM)}</strong></div>
        <div><span>Max nachylenie</span><strong>{run.maxGradeDown.toFixed(0)}<small>°</small></strong></div>
      </section>

      {(run.confirmedMaxSpeed === null || run.rawMaxSpeed > run.confirmedMaxSpeed) && (
        <section className="raw-peak-card" aria-label="Surowe maksimum prędkości">
          <div>
            <span>Surowe maksimum</span>
            <strong>{run.rawMaxSpeed.toFixed(0)}<small> km/h</small></strong>
          </div>
          <QualityIndicators quality={run.rawMaxQuality} />
        </section>
      )}

      <section className="chart-card">
        <div className="chart-heading">
          <div><span className="eyebrow">Profil prędkości</span><h2>Gdzie pojechałeś najszybciej?</h2></div>
          <span className="chart-legend legend-speed"><i /> prędkość</span>
        </div>
        <ChartZoomSurface className="chart-wrap" dataMaxKm={axisMaxKm} domain={domain} onDomainChange={apply} onReset={reset}>
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="#dbe5e8" strokeDasharray="3 3" />
              <XAxis allowDataOverflow axisLine={false} dataKey="d" domain={domain} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#71858a", fontSize: 11 }} tickFormatter={formatDistanceTick} tickLine={false} ticks={distanceAxis.ticks} type="number" />
              <YAxis axisLine={false} domain={[0, yMax]} tick={{ fill: "#71858a", fontSize: 11 }} tickLine={false} tickMargin={4} width={48} />
              <Tooltip animationDuration={80} contentStyle={{ background: "#17363b", border: 0, borderRadius: 10, color: "#fff" }} labelFormatter={(value) => `${Number(value).toFixed(2)} km`} offset={24} />
              {yMax > 100 && <ReferenceArea fill="#f5a276" fillOpacity={0.2} y1={100} y2={150} />}
              <Line dataKey="v" dot={false} isAnimationActive={false} stroke="#ee6b4a" strokeWidth={2.5} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartZoomSurface>
        <div className="chart-axis-label">Dystans [km]</div>
      </section>

      <section className="chart-card">
        <div className="chart-heading">
          <div><span className="eyebrow">Profil wysokości</span><h2>Wysokość na trasie</h2></div>
          <span className="chart-legend legend-altitude"><i /> wysokość</span>
        </div>
        <ChartZoomSurface className="chart-wrap" dataMaxKm={axisMaxKm} domain={domain} onDomainChange={apply} onReset={reset}>
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="#dbe5e8" strokeDasharray="3 3" />
              <XAxis allowDataOverflow axisLine={false} dataKey="d" domain={domain} interval="preserveStartEnd" minTickGap={18} tick={{ fill: "#71858a", fontSize: 11 }} tickFormatter={formatDistanceTick} tickLine={false} ticks={distanceAxis.ticks} type="number" />
              <YAxis axisLine={false} domain={altitudeDomain} tick={{ fill: "#71858a", fontSize: 11 }} tickLine={false} tickMargin={4} width={48} />
              <Tooltip animationDuration={80} contentStyle={{ background: "#17363b", border: 0, borderRadius: 10, color: "#fff" }} labelFormatter={(value) => `${Number(value).toFixed(2)} km`} offset={24} />
              <Area dataKey="h" fill="#78b99b" fillOpacity={0.28} isAnimationActive={false} stroke="#358866" strokeWidth={2} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartZoomSurface>
        <div className="chart-axis-label">Dystans [km] · wysokość [m]</div>
      </section>

      {sequence.length > 0 && (
        <section className="prev-section" aria-label="Poprzednie przejazdy">
          <div className="prev-heading">
            <div><span className="eyebrow">Historia tras</span><h2>Poprzednie przejazdy</h2></div>
          </div>

          {prevSameSequence.length > 0 && (
            <RouteHistoryCard
              heading={
                <>
                  {sequence.map((item, index) => (
                    <Fragment key={`${item.key}-${index}`}>
                      {index > 0 && <span className="group-arrow">→</span>}
                      <span className="route-chip" style={{ background: routeColor(item.difficulty) }}>{item.label}</span>
                    </Fragment>
                  ))}
                  <span className="route-group-name">Cała sekwencja</span>
                </>
              }
              rideCount={prevSameSequence.length}
              bestDurationS={Math.min(...prevSameSequence.map((ride) => ride.durationS))}
              maxSpeed={prevSameSequence.reduce((max, ride) => Math.max(max, ride.maxSpeed), 0)}
              rides={prevSameSequence}
              expanded={Boolean(expanded[`seq:${sequenceKey}`])}
              onToggle={() => toggleExpanded(`seq:${sequenceKey}`)}
            />
          )}

          {routeGroups.map((group) => (
            <RouteHistoryCard
              key={group.route.key}
              heading={
                <>
                  <span className="route-chip" style={{ background: routeColor(group.route.difficulty) }}>{group.route.label}</span>
                  <span className="route-group-name">Trasa</span>
                </>
              }
              rideCount={group.rideCount}
              bestDurationS={group.bestDurationS}
              maxSpeed={group.maxSpeed}
              rides={group.rides}
              expanded={Boolean(expanded[group.route.key])}
              onToggle={() => toggleExpanded(group.route.key)}
            />
          ))}

          {prevSameSequence.length === 0 && routeGroups.length === 0 && (
            <div className="prev-empty">Brak wcześniejszych przejazdów tymi trasami.</div>
          )}
        </section>
      )}
    </div>
  );
}

const PREVIEW_RIDES = 3;

interface RouteHistoryCardProps {
  heading: ReactNode;
  rideCount: number;
  bestDurationS: number | null;
  maxSpeed: number;
  rides: PreviousRide[];
  expanded: boolean;
  onToggle: () => void;
}

function RouteHistoryCard({ heading, rideCount, bestDurationS, maxSpeed, rides, expanded, onToggle }: RouteHistoryCardProps) {
  const shown = expanded ? rides : rides.slice(0, PREVIEW_RIDES);
  return (
    <div className="route-group">
      <div className="route-group-head">{heading}</div>
      <div className="route-group-stats">
        <span><b>{rideCount}</b> {rideWord(rideCount)}</span>
        <span>najlepszy <b>{bestDurationS === null ? "—" : formatSeconds(bestDurationS)}</b></span>
        <span>max <b>{maxSpeed.toFixed(0)}</b> km/h</span>
      </div>
      <ul className="ride-list">
        {shown.map((ride) => (
          <li className="ride-item" key={ride.runId}>
            <Link className="ride-row" to={`/zjazd/${encodeURIComponent(ride.runId)}`}>
              <span className="ride-when">
                {formatRideWhen(ride.startT)}
                <small>Odcinek {formatRideDistance(ride.distanceM)}</small>
              </span>
              <span className="ride-metric"><b>{ride.maxSpeed.toFixed(0)}<small> km/h</small></b><i>{formatSeconds(ride.durationS)}</i></span>
              <span className="ride-chev">›</span>
            </Link>
          </li>
        ))}
      </ul>
      {rides.length > PREVIEW_RIDES && (
        <button className="show-all" type="button" onClick={onToggle}>
          {expanded ? "Zwiń" : `Pokaż wszystkie (${rides.length})`}
        </button>
      )}
    </div>
  );
}

function SequenceChips({ sequence }: { sequence: RouteSequenceItem[] }) {
  return (
    <div className="route-line">
      <span className="route-line-label">Trasy</span>
      {sequence.map((item, index) => (
        <Fragment key={`${item.key}-${index}`}>
          {index > 0 && <span className="route-arrow">→</span>}
          <span className="route-chip" style={{ background: routeColor(item.difficulty) }}>{item.label}</span>
        </Fragment>
      ))}
    </div>
  );
}

function routeColor(difficulty: string): string {
  return DIFFICULTY_COLORS[difficulty] ?? DIFFICULTY_COLORS.unknown;
}

function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function formatRideWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${time}`;
}

function formatRideDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function rideWord(count: number): string {
  if (count === 1) return "przejazd";
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return "przejazdy";
  return "przejazdów";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
