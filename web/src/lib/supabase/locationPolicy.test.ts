import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LatestLocationThrottle,
  filterVisiblePeerLocations,
  formatLocationAgeLabel,
  type LiveLocationRow,
  type ProfileRow,
} from "./locationPolicy.ts";

const baseTime = Date.parse("2026-11-02T12:00:00.000Z");

function location(userId: string, recordedAt: number): LiveLocationRow {
  return {
    user_id: userId,
    latitude: 46.9667,
    longitude: 11.0078,
    accuracy_m: 8,
    recorded_at: new Date(recordedAt).toISOString(),
  };
}

function profile(userId: string, shareEnabled = true): ProfileRow {
  return { user_id: userId, display_name: userId, share_enabled: shareEnabled };
}

describe("formatLocationAgeLabel", () => {
  it("hides age labels until the third minute and then shows whole minutes", () => {
    expect(formatLocationAgeLabel(new Date(baseTime - 179_999).toISOString(), baseTime)).toBeNull();
    expect(formatLocationAgeLabel(new Date(baseTime - 180_000).toISOString(), baseTime)).toBe("3 min temu");
    expect(formatLocationAgeLabel(new Date(baseTime - 239_999).toISOString(), baseTime)).toBe("3 min temu");
  });

  it("does not create an age label for future or invalid timestamps", () => {
    expect(formatLocationAgeLabel(new Date(baseTime + 1).toISOString(), baseTime)).toBeNull();
    expect(formatLocationAgeLabel("invalid", baseTime)).toBeNull();
  });
});

describe("filterVisiblePeerLocations", () => {
  it("returns only enabled, fresh locations belonging to other users", () => {
    const rows = [
      location("self", baseTime),
      location("fresh", baseTime - 60_000),
      location("hour-old", baseTime - 3_600_000),
      location("expired", baseTime - 3_600_001),
      location("future", baseTime + 1),
      location("sharing-off", baseTime),
      location("no-profile", baseTime),
    ];
    const profiles = [
      profile("self"),
      profile("fresh"),
      profile("hour-old"),
      profile("expired"),
      profile("future"),
      profile("sharing-off", false),
    ];

    expect(filterVisiblePeerLocations(rows, profiles, "self", baseTime).map(({ userId }) => userId))
      .toEqual(["fresh", "hour-old"]);
  });
});

describe("LatestLocationThrottle", () => {
  afterEach(() => vi.useRealTimers());

  it("sends the first fix immediately and coalesces early fixes to the latest", () => {
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
    const send = vi.fn();
    const throttle = new LatestLocationThrottle(send);

    throttle.push("first");
    vi.advanceTimersByTime(2_000);
    throttle.push("intermediate");
    vi.advanceTimersByTime(5_000);
    throttle.push("latest");

    expect(send.mock.calls).toEqual([["first"]]);
    vi.advanceTimersByTime(3_000);
    expect(send.mock.calls).toEqual([["first"], ["latest"]]);
    throttle.dispose();
  });

  it("never sends fixes more frequently than the configured ten-second window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
    const send = vi.fn();
    const throttle = new LatestLocationThrottle(send);

    throttle.push("first");
    vi.advanceTimersByTime(9_999);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    throttle.push("second");

    expect(send.mock.calls).toEqual([["first"], ["second"]]);
    throttle.dispose();
  });
});
