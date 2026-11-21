import type { SupabaseLiveLocation, SupabaseProfile } from "./database.types.ts";

export const LIVE_LOCATION_SEND_INTERVAL_MS = 10_000;
export const LIVE_LOCATION_MAX_AGE_MS = 60 * 60 * 1_000;
export const LIVE_LOCATION_AGE_LABEL_DELAY_MS = 3 * 60 * 1_000;

export type ProfileRow = SupabaseProfile;
export type LiveLocationRow = SupabaseLiveLocation;

export interface GpsLocationFix {
  latitude: number;
  longitude: number;
  accuracyM: number;
  timestamp: number;
}

export interface VisiblePeerLocation {
  userId: string;
  displayName: string;
  coordinate: [number, number];
  accuracyM: number;
  recordedAt: number;
  ageLabel: string | null;
  color: string;
}

const PEER_COLORS = ["#be123c", "#7c3aed", "#0f766e", "#c2410c", "#1d4ed8", "#a16207"];

function hashUserId(userId: string): number {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function formatLocationAgeLabel(recordedAt: string, now: number): string | null {
  const timestamp = Date.parse(recordedAt);
  if (!Number.isFinite(timestamp)) return null;

  const ageMs = now - timestamp;
  if (ageMs < LIVE_LOCATION_AGE_LABEL_DELAY_MS || ageMs > LIVE_LOCATION_MAX_AGE_MS) return null;

  return `${Math.floor(ageMs / 60_000)} min temu`;
}

export function filterVisiblePeerLocations(
  locations: LiveLocationRow[],
  profiles: ProfileRow[],
  currentUserId: string,
  now: number,
): VisiblePeerLocation[] {
  const profilesById = new Map(profiles.map((profile) => [profile.user_id, profile]));

  return locations.flatMap((location) => {
    if (location.user_id === currentUserId) return [];
    const profile = profilesById.get(location.user_id);
    if (!profile?.share_enabled) return [];

    const recordedAt = Date.parse(location.recorded_at);
    const ageMs = now - recordedAt;
    if (!Number.isFinite(recordedAt) || ageMs < 0 || ageMs > LIVE_LOCATION_MAX_AGE_MS) return [];
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return [];

    return [{
      userId: location.user_id,
      displayName: profile.display_name,
      coordinate: [location.longitude, location.latitude] as [number, number],
      accuracyM: location.accuracy_m,
      recordedAt,
      ageLabel: formatLocationAgeLabel(location.recorded_at, now),
      color: PEER_COLORS[hashUserId(location.user_id) % PEER_COLORS.length],
    }];
  }).sort((a, b) => a.displayName.localeCompare(b.displayName, "pl"));
}

/** Sends the first fix immediately, then keeps only the newest fix until the 10 s window opens. */
export class LatestLocationThrottle<T> {
  private lastSentAt: number | null = null;
  private latestValue: T | undefined;
  private hasLatestValue = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly send: (value: T) => void;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(
    send: (value: T) => void,
    intervalMs = LIVE_LOCATION_SEND_INTERVAL_MS,
    now: () => number = Date.now,
  ) {
    this.send = send;
    this.intervalMs = intervalMs;
    this.now = now;
  }

  push(value: T): void {
    this.latestValue = value;
    this.hasLatestValue = true;

    if (this.lastSentAt === null) {
      this.flush();
      return;
    }

    const remainingMs = this.intervalMs - (this.now() - this.lastSentAt);
    if (remainingMs <= 0) {
      this.flush();
      return;
    }

    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, remainingMs);
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.latestValue = undefined;
    this.hasLatestValue = false;
  }

  private flush(): void {
    if (!this.hasLatestValue) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;

    const value = this.latestValue as T;
    this.latestValue = undefined;
    this.hasLatestValue = false;
    this.lastSentAt = this.now();
    this.send(value);
  }
}
