import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseAuth } from "./auth.tsx";
import {
  filterVisiblePeerLocations,
  LatestLocationThrottle,
  LIVE_LOCATION_MAX_AGE_MS,
  type GpsLocationFix,
  type LiveLocationRow,
  type ProfileRow,
  type VisiblePeerLocation,
} from "./locationPolicy.ts";
import { fetchLiveLocationSnapshot, saveLiveLocation } from "./liveLocations.ts";

const REFRESH_INTERVAL_MS = 10_000;
const EMPTY_SNAPSHOT = { locations: [] as LiveLocationRow[], profiles: [] as ProfileRow[] };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLiveLocations(now: number): {
  peers: VisiblePeerLocation[];
  error: string | null;
  reportGpsFix(fix: GpsLocationFix): void;
} {
  const { user, profile, signingOut, error: authError } = useSupabaseAuth();
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [syncError, setSyncError] = useState<string | null>(null);
  const latestFixRef = useRef<GpsLocationFix | null>(null);
  const writerRef = useRef<LatestLocationThrottle<GpsLocationFix> | null>(null);

  useEffect(() => {
    if (!user) {
      setSnapshot(EMPTY_SNAPSHOT);
      setSyncError(null);
      return undefined;
    }

    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (!navigator.onLine || refreshing) return;
      refreshing = true;
      try {
        const nextSnapshot = await fetchLiveLocationSnapshot(Date.now());
        if (active) {
          setSnapshot(nextSnapshot);
          setSyncError(null);
        }
      } catch (caught) {
        if (active) setSyncError(errorMessage(caught));
      } finally {
        refreshing = false;
      }
    };
    const refreshWhenOnline = () => { void refresh(); };

    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    window.addEventListener("online", refreshWhenOnline);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", refreshWhenOnline);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !profile?.share_enabled || signingOut) {
      writerRef.current?.dispose();
      writerRef.current = null;
      return undefined;
    }

    let active = true;
    const writer = new LatestLocationThrottle<GpsLocationFix>((fix) => {
      void saveLiveLocation(user.id, fix)
        .then(() => { if (active) setSyncError(null); })
        .catch((caught: unknown) => { if (active) setSyncError(errorMessage(caught)); });
    });
    writerRef.current = writer;

    const latestFix = latestFixRef.current;
    if (latestFix && Date.now() - latestFix.timestamp <= LIVE_LOCATION_MAX_AGE_MS && latestFix.timestamp <= Date.now()) {
      writer.push(latestFix);
    }

    return () => {
      active = false;
      writer.dispose();
      if (writerRef.current === writer) writerRef.current = null;
    };
  }, [user?.id, profile?.share_enabled, signingOut]);

  const reportGpsFix = useCallback((fix: GpsLocationFix) => {
    latestFixRef.current = fix;
    writerRef.current?.push(fix);
  }, []);

  const peers = useMemo(() => {
    if (!user) return [];
    return filterVisiblePeerLocations(snapshot.locations, snapshot.profiles, user.id, now);
  }, [now, snapshot.locations, snapshot.profiles, user?.id]);

  return { peers, error: syncError ?? authError, reportGpsFix };
}
