import { Link, useParams } from "react-router-dom";
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
import { getDay } from "../lib/store.ts";

// Wykresy w funkcji DYSTANSU (nie czasu), osobne jeden pod drugim,
// wspólna oś dystansu (wymagania-PWA §5).
export default function RunView() {
  const { runId } = useParams();
  const day = getDay();
  const run = day?.runs.find((r) => r.id === runId);

  if (!run) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-slate-300">Brak danych zjazdu — wróć i pobierz dane.</p>
        <Link to="/" className="text-sky-400">
          ← Dzień
        </Link>
      </div>
    );
  }

  const d0 = run.samples[0].cumDistM;
  const data = run.samples.map((s) => ({
    d: (s.cumDistM - d0) / 1000, // km
    v: Math.round(s.speedSm * 10) / 10,
    g: Math.round(-s.gradeSm * 10) / 10, // dodatnie = w dół (przekrój stoku)
  }));
  const maxV = Math.ceil(run.maxSpeed / 10) * 10;
  const yMax = maxV > 100 ? 150 : 100;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sky-400">
        ← Dzień
      </Link>
      <div className="text-sm text-slate-300">
        Max {run.maxSpeed.toFixed(0)} km/h · {(run.distanceM / 1000).toFixed(2)} km ·
        nachylenie {run.maxGradeDown.toFixed(0)}°
      </div>

      <div>
        <div className="mb-1 text-sm text-slate-400">Prędkość [km/h]</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ left: -18, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="d" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} />
              <YAxis domain={[0, yMax]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                labelFormatter={(v) => `${Number(v).toFixed(2)} km`}
              />
              {yMax > 100 && <ReferenceArea y1={100} y2={150} fill="#ef4444" fillOpacity={0.12} />}
              <Line type="monotone" dataKey="v" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div className="mb-1 text-sm text-slate-400">Nachylenie w dół [°]</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ left: -18, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="d" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                labelFormatter={(v) => `${Number(v).toFixed(2)} km`}
              />
              <Area type="monotone" dataKey="g" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
