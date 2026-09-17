import { useEffect, useMemo, useState } from "react";
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
import { Icon } from "../components/Icon.tsx";
import { deleteRun, formatClock, formatDayLabel, formatDistance, formatDuration, renameRun } from "../lib/data.ts";
import { db, type StoredRun } from "../lib/db.ts";

export default function RunView() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState<StoredRun | null>(null);
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
    db.runs.get(decodedRunId).then((stored) => {
      if (!active) return;
      setRun(stored ?? null);
      setLabel(stored?.label ?? "");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [decodedRunId]);

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

  const yMax = run.maxSpeed > 100 ? 150 : 100;

  return (
    <div className="page-stack detail-page">
      <div className="detail-back-row">
        <Link className="back-link" to={`/dzien/${run.dayKey}`}><Icon name="chevron" size={18} /> {capitalize(formatDayLabel(run.dayKey))}</Link>
        {run.demo && <span className="demo-badge">Demo</span>}
      </div>

      <header className="detail-header">
        <div>
          <span className="eyebrow">{formatClock(run.startT)} · {formatDuration(run.startT, run.endT)}</span>
          <h1>{run.label ?? "Zjazd"}</h1>
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
        <div><span>Max prędkość</span><strong>{run.maxSpeed.toFixed(0)}<small> km/h</small></strong></div>
        <div><span>Dystans</span><strong>{formatDistance(run.distanceM)}</strong></div>
        <div><span>Max nachylenie</span><strong>{run.maxGradeDown.toFixed(0)}<small>°</small></strong></div>
      </section>

      <section className="chart-card">
        <div className="chart-heading">
          <div><span className="eyebrow">Profil prędkości</span><h2>Gdzie pojechałeś najszybciej?</h2></div>
          <span className="chart-legend legend-speed"><i /> prędkość</span>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={chartData} margin={{ left: -16, right: 8, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="#dbe5e8" strokeDasharray="3 3" />
              <XAxis axisLine={false} dataKey="d" tick={{ fill: "#71858a", fontSize: 11 }} tickFormatter={(value: number) => value.toFixed(1)} tickLine={false} />
              <YAxis axisLine={false} domain={[0, yMax]} tick={{ fill: "#71858a", fontSize: 11 }} tickLine={false} width={32} />
              <Tooltip animationDuration={80} contentStyle={{ background: "#17363b", border: 0, borderRadius: 10, color: "#fff" }} labelFormatter={(value) => `${Number(value).toFixed(2)} km`} offset={24} />
              {yMax > 100 && <ReferenceArea fill="#f5a276" fillOpacity={0.2} y1={100} y2={150} />}
              <Line dataKey="v" dot={false} isAnimationActive={false} stroke="#ee6b4a" strokeWidth={2.5} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-axis-label">Dystans [km]</div>
      </section>

      <section className="chart-card">
        <div className="chart-heading">
          <div><span className="eyebrow">Profil wysokości</span><h2>Wysokość na trasie</h2></div>
          <span className="chart-legend legend-altitude"><i /> wysokość</span>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={chartData} margin={{ left: -16, right: 8, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="#dbe5e8" strokeDasharray="3 3" />
              <XAxis axisLine={false} dataKey="d" tick={{ fill: "#71858a", fontSize: 11 }} tickFormatter={(value: number) => value.toFixed(1)} tickLine={false} />
              <YAxis axisLine={false} tick={{ fill: "#71858a", fontSize: 11 }} tickLine={false} width={32} />
              <Tooltip animationDuration={80} contentStyle={{ background: "#17363b", border: 0, borderRadius: 10, color: "#fff" }} labelFormatter={(value) => `${Number(value).toFixed(2)} km`} offset={24} />
              <Area dataKey="h" fill="#78b99b" fillOpacity={0.28} isAnimationActive={false} stroke="#358866" strokeWidth={2} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-axis-label">Dystans [km] · wysokość [m]</div>
      </section>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
