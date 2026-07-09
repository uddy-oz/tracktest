import type { User } from "@supabase/supabase-js";
import { fetchCloudBadgeStats } from "./cloudBadgeStats";
import { fetchProfileDisplayInfo, type ProfileDisplayInfo } from "./profiles";
import { getTrackTestStats, type TrackTestStats } from "./stats";

export type PublicProfileStatsSource = "cloud" | "localFallback";

export type CurrentUserProfileStats = {
  displayInfo: ProfileDisplayInfo;
  stats: TrackTestStats;
  source: PublicProfileStatsSource;
  error: string | null;
};

export async function fetchCurrentUserProfileStats(
  user: User
): Promise<CurrentUserProfileStats> {
  const [displayInfo, cloudStats] = await Promise.all([
    fetchProfileDisplayInfo(user.id, "Unknown Player"),
    fetchCloudBadgeStats(user),
  ]);

  if (cloudStats.data && !cloudStats.error) {
    return {
      displayInfo,
      stats: cloudStats.data,
      source: "cloud",
      error: null,
    };
  }

  return {
    displayInfo,
    stats: getTrackTestStats(),
    source: "localFallback",
    error: cloudStats.error || "Cloud stats are unavailable.",
  };
}

export async function fetchPublicProfileDisplayInfo(userId: string) {
  return fetchProfileDisplayInfo(userId, "Unknown Player");
}
