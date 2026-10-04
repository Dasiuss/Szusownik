import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon } from "./components/Icon.tsx";
import { ensureLocalData, ensureRouteMatchingBackfill } from "./lib/data.ts";
import { loadCachedSkiData, loadSkiData } from "./lib/mapData.ts";
import { DeviceProvider } from "./lib/device.tsx";

export default function App() {
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  async function boot() {
    setBootError(null);
    try {
      // Trasy z cache od razu — dopasowanie liczone przy materializacji.
      loadCachedSkiData();
      await ensureLocalData();
      setReady(true);
      // Odświeżenie cache w tle; jeśli OSM dotarło dopiero teraz, dorabiamy
      // dopasowanie raz. Odświeżenie istniejącego cache nie przelicza zjazdów.
      void loadSkiData()
        .then(() => ensureRouteMatchingBackfill())
        .catch(() => undefined);
    } catch (caught) {
      setBootError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    void boot();
  }, []);

  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="boot-mark"><Icon name="mountain" size={28} /></div>
        {bootError ? (
          <div className="boot-error">
            <strong>Nie udało się przygotować danych</strong>
            <span>{bootError}</span>
            <button className="button button-primary" onClick={() => void boot()}>Spróbuj ponownie</button>
          </div>
        ) : (
          <span className="boot-label">Przygotowuję Twoje przejazdy…</span>
        )}
      </div>
    );
  }

  return (
    <DeviceProvider>
      <div className="app-shell">
        <main className={`app-main${location.pathname === "/mapa" ? " app-main-map" : ""}`}>
          <div className="page-container">
            <Outlet />
          </div>
        </main>
        <nav className="bottom-nav" aria-label="Główna nawigacja">
          <NavItem to="/" end icon="activity" label="Dzisiaj" />
          <NavItem to="/historia" icon="archive" label="Historia" />
          <NavItem to="/mapa" icon="map" label="Mapa" />
          <NavItem to="/urzadzenie" icon="settings" label="Urządzenie" />
        </nav>
      </div>
    </DeviceProvider>
  );
}

function NavItem({ to, end, icon, label }: { to: string; end?: boolean; icon: "activity" | "archive" | "map" | "settings"; label: string }) {
  return (
    <NavLink className={({ isActive }) => `nav-item${isActive ? " nav-item-active" : ""}`} end={end} to={to}>
      <Icon name={icon} size={21} />
      <span>{label}</span>
    </NavLink>
  );
}
