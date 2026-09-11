import { useState } from "react";
import { Link } from "react-router-dom";
import { parseDeviceCsv } from "../lib/csv.ts";
import { db } from "../lib/db.ts";
import { analyzeDay } from "../lib/runs.ts";
import { fmtClock, fmtDurSec, fmtKm, setDay } from "../lib/store.ts";

type LoadState =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "ready"; fileName: string; samples: number }
  | { kind: "error"; message: string };

export default function DayView() {
  const [state, setState] = useState<LoadState>({ kind: "empty" });
  const [day, setDayState] = useState(() => null as ReturnType<typeof analyzeDay> | null);

  async function loadFixture() {
    setState({ kind: "loading" });
    try {
      // Faza B: rzeczywiste nagranie-fixture. Faza C: podmiana na transfer BLE.
      const res = await fetch("fixtures/ride.csv");
      if (!res.ok) {
        throw new Error(
          "Brak pliku fixtures/ride.csv — skopiuj nagranie z karty SD (patrz fixtures/README.md)",
        );
      }
      const raw = await res.text();
      const samples = parseDeviceCsv(raw);
      await db.files.put({
        name: "fixture-ride.csv",
        size: raw.length,
        receivedAt: new Date().toISOString(),
        userId: "local",
        raw,
      });
      const d = analyzeDay(samples);
      setDay(d);
      setDayState(d);
      setState({ kind: "ready", fileName: "ride.csv", samples: samples.length });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={loadFixture}
        className="rounded-xl bg-sky-500 px-4 py-3 text-lg font-semibold text-white active:bg-sky-600"
      >
        Pobierz dane
      </button>

      {state.kind === "loading" && <p className="text-slate-300">Wczytywanie…</p>}
      {state.kind === "error" && <p className="text-red-400">{state.message}</p>}
      {state.kind === "ready" && (
        <p className="text-sm text-slate-400">
          {state.fileName} · {state.samples} próbek
        </p>
      )}

      {day && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-800 p-3">
              <div className="text-xs text-slate-400">Dystans w dół</div>
              <div className="text-2xl font-bold">{fmtKm(day.downhillM)}</div>
            </div>
            <div className="rounded-xl bg-slate-800 p-3">
              <div className="text-xs text-slate-400">Max prędkość</div>
              <div className="text-2xl font-bold">{day.maxSpeed.toFixed(0)} km/h</div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {day.runs.map((r, i) => {
              const dur =
                (Date.parse(r.endT) - Date.parse(r.startT)) / 1000;
              return (
                <Link
                  key={r.id}
                  to={`/zjazd/${r.id}`}
                  className="rounded-xl bg-slate-800 p-3 active:bg-slate-700"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">Zjazd {i + 1}</span>
                    <span className="text-sm text-slate-400">
                      {fmtClock(r.startT)}–{fmtClock(r.endT)} · {fmtDurSec(dur)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-slate-300">
                    {r.maxSpeed.toFixed(0)} km/h · {fmtKm(r.distanceM)} · nachylenie{" "}
                    {r.maxGradeDown.toFixed(0)}°
                  </div>
                </Link>
              );
            })}
            {day.runs.length === 0 && (
              <p className="text-slate-400">Nie wykryto zjazdów w tym pliku.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
