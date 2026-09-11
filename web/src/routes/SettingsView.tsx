import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SzusownikBle } from "../lib/ble.ts";

// Ustawienia urządzenia — niezależne od dnia/aktywności.
// Docelowo tu trafią kolejne opcje (progi, interwały, tryb stokowy).
export default function SettingsView() {
  const [vol, setVol] = useState<{ low: number; high: number } | null>(null);
  const [volBusy, setVolBusy] = useState(false);
  const [volErr, setVolErr] = useState<string | null>(null);
  const bleVolRef = useRef<SzusownikBle | null>(null);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      <Link to="/" className="text-sky-400">
        ← Dzień
      </Link>

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
    </div>
  );
}
