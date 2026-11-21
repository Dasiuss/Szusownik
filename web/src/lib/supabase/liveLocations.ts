import { supabase } from "./client.ts";
import {
  LIVE_LOCATION_MAX_AGE_MS,
  type GpsLocationFix,
  type LiveLocationRow,
  type ProfileRow,
} from "./locationPolicy.ts";

export async function saveLiveLocation(userId: string, fix: GpsLocationFix): Promise<void> {
  if (
    !Number.isFinite(fix.timestamp)
    || !Number.isFinite(fix.latitude)
    || !Number.isFinite(fix.longitude)
    || !Number.isFinite(fix.accuracyM)
  ) {
    throw new Error("Odrzucono nieprawidłowy odczyt GPS.");
  }

  const { error } = await supabase.from("live_locations").upsert({
    user_id: userId,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy_m: fix.accuracyM,
    recorded_at: new Date(fix.timestamp).toISOString(),
  }, { onConflict: "user_id" });

  if (error) throw error;
}

export async function fetchLiveLocationSnapshot(now: number): Promise<{
  locations: LiveLocationRow[];
  profiles: ProfileRow[];
}> {
  const cutoff = new Date(now - LIVE_LOCATION_MAX_AGE_MS).toISOString();
  const [locationsResult, profilesResult] = await Promise.all([
    supabase
      .from("live_locations")
      .select("user_id, latitude, longitude, accuracy_m, recorded_at")
      .gte("recorded_at", cutoff),
    supabase
      .from("profiles")
      .select("user_id, display_name, share_enabled")
      .eq("share_enabled", true),
  ]);

  if (locationsResult.error) throw locationsResult.error;
  if (profilesResult.error) throw profilesResult.error;

  return {
    locations: (locationsResult.data ?? []) as LiveLocationRow[],
    profiles: (profilesResult.data ?? []) as ProfileRow[],
  };
}

export async function deleteLiveLocation(userId: string): Promise<void> {
  const { error } = await supabase.from("live_locations").delete().eq("user_id", userId);
  if (error) throw error;
}
