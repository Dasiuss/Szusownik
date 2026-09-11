import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SzusownikBle } from "../lib/ble.ts";
import { parseDeviceCsv } from "../lib/csv.ts";
import { db } from "../lib/db.ts";
import { analyzeDay, type DayStats } from "../lib/runs.ts";
import { fmtClock, fmtDurSec, fmtKm, setDay } from "../lib/store.ts";

type LoadState =
  | { kind: "empty" }
  | { kind: "loading"; note: string }
  | { kind: "ready"; fileName: string; samples: number }
  | { kind: "error"; message: string };

export default function DayView() {
  const [state, setState] = useState<LoadState>({ kind: "empty" });
  const [day, setDayState] = useState<DayStats | null>(null);
  const [vol, setVol] = useState<{ low: number; high: number } | null>(null);
  const [volBusy, setVolBusy] = useState(false);
  const [volErr, setVolErr] = useState<string | null>(null);
  const bleVolRef = useRef<SzusownikBle | null>(null);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showDay(raw: string, label: string) {
    const samples = parseDeviceCsv(raw);
    const d = analyzeDay(samples);
    setDay(d);
    setDayState(d);
    setState({ kind: "ready", fileName: label, samples: samples.length });
  }

  // Ścieżka produkcyjna: BLE → tylko nowe pliki → IndexedDB → analiza.
  async function syncBle() {
    setState({ kind: "loading", note: "Łączenie z urządzeniem…" });
    try {
      const ble = new SzusownikBle();
      const done = await ble.syncNewFiles((p) =>
        setState({
          kind: "loading",
          note: `${p.file} — ramek: ${p.receivedFrames} (${p.fileIndex}/${p.fileCount})`,
        }),
      );
      if (done.length === 0) {
        setState({ kind: "error", message: "Brak nowych plików na urządzeniu." });
        return;
      }
      const latest = done[done.length - 1];
      const stored = await db.files.get(latest.name);
      if (!stored) throw new Error("Zapis do IndexedDB nie powiódł się");
      showDay(stored.raw, `${latest.name} (BLE, ${done.length} nowych)`);
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Ścieżka dev: rzeczywiste nagranie-fixture z karty SD (bez radia).
  async function loadFixture() {
    setState({ kind: "loading", note: "Wczytywanie fixture…" });
    try {
      const res = await fetch("fixtures/ride.csv");
      if (!res.ok) {
        throw new Error(
          "Brak pliku fixtures/ride.csv — skopiuj nagranie z karty SD (patrz fixtures/README.md)",
        );
      }
      const raw = await res.text();
      await db.files.put({
        name: "fixture-ride.csv",
        size: raw.length,
        receivedAt: new Date().toISOString(),
        userId: "local",
        raw,
      });
      showDay(raw, "ride.csv (fixture)");
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Głośność buzzera: połączenie BLE (osobne od sync), suwaki 0..100,
  // wysyłka z debounce 600 ms. Każde SETVOL gra feedback na urządzeniu.
  async function connectVolume() {
    setVolBusy(true);
    setVolErr(null);
    try {
      const ble = new SzusownikBle();
      const info = await ble.connect();
      bleVolRef.current = ble;
      if (typeof info.volLow === "number" && typeof info.volHigh === "number") {
        setVol({ low: info.volLow, high: info.volHigh });
      } else {
        setVol(await ble.getVolume());
      }
    } catch (e) {
      setVolErr(e instanceof Error ? e.message : String(e));
    } finally {
      setVolBusy(false);
    }
  }

  function disconnectVolume() {
    if (volTimer.current) clearTimeout(volTimer.current);
    bleVolRef.current?.disconnect();
    bleVolRef.current = null;
    setVol(null);
  }

  function changeVolume(which: "low" | "high", value: number) {
    setVol((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [which]: value };
      if (volTimer.current) clearTimeout(volTimer.current);
      volTimer.current = setTimeout(async () => {
        try {
          const v = await bleVolRef.current?.setVolume(which, value);
          if (v) setVol(v);
        } catch (e) {
          setVolErr(e instanceof Error ? e.message : String(e));
        }
      }, 600);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={syncBle}
        className="rounded-xl bg-sky-500 px-4 py-3 text-lg font-semibold text-white active:bg-sky-600"
      >
        Pobierz dane
      </button>
      <button onClick={loadFixture} className="text-sm text-slate-500 underline">
        wczytaj fixture (dev, bez BLE)
      </button>

      <div className="rounded-xl bg-slate-800 p-3">
        <div className="mb-2 text-sm font-semibold text-slate-200">Głośność pikania</div>
        {!vol ? (
          <button
            onClick={connectVolume}
            disabled={volBusy}
            className="rounded-lg bg-slate-600 px-3 py-2 text-sm font-semibold text-white active:bg-slate-500 disabled:opacity-50"
          >
            {volBusy ? "Łączenie…" : "Połącz i ustaw głośność"}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            {(
              [
                { key: "low", label: "Wolno (60 km/h)", hint: "feedback: 1× krótki" },
                { key: "high", label: "Szybko (120 km/h)", hint: "feedback: 1× długi + 2× krótki" },
              ] as const
            ).map((s) => (
              <label key={s.key} className="block">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-300">{s.label}</span>
                  <span className="font-bold text-white">{vol[s.key]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={vol[s.key]}
                  onChange={(e) => changeVolume(s.key, Number(e.target.value))}
                  className="w-full accent-sky-500"
                />
                <div className="text-xs text-slate-500">{s.hint}</div>
              </label>
            ))}
            <p className="text-xs text-slate-500">
              Pomiędzy 60 a 120 km/h głośność rośnie liniowo, powyżej 120 zostaje
              wartość ze 120.
            </p>
            <button onClick={disconnectVolume} className="text-sm text-slate-400 underline">
              rozłącz
            </button>
          </div>
        )}
        {volErr && <p className="mt-2 text-sm text-red-400">{volErr}</p>}
      </div>

      {state.kind === "loading" && <p className="text-slate-300">{state.note}</p>}
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
              const dur = (Date.parse(r.endT) - Date.parse(r.startT)) / 1000;
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
