import type { ArenaBadge, BadgeTier } from "./badges";
import type { TrackTestStats } from "./stats";

export type CompactBadgeKind = "tier" | "form" | "dailyStreak" | "winningStreak";

export type CompactPlayerBadge = {
  id: string;
  label: string;
  title: string;
  kind: CompactBadgeKind;
  tier?: PlayerTier;
};

export type PlayerTier =
  | "Newcomer"
  | "Bronze"
  | "Silver"
  | "Gold"
  | "Platinum"
  | "Legendary";

const tierScores: Record<BadgeTier, number> = {
  Bronze: 10,
  Silver: 20,
  Gold: 35,
  Platinum: 55,
  Legendary: 90,
};

export function calculateBadgeScore(badges: ArenaBadge[]) {
  return badges.reduce((score, badge) => {
    if (!badge.unlocked) {
      return score;
    }

    return score + tierScores[badge.tier];
  }, 0);
}

export function calculatePlayerTier(
  badges: ArenaBadge[],
  stats?: TrackTestStats
) {
  const badgeScore = calculateBadgeScore(badges);
  const totalPoints = stats?.overall.totalPoints || 0;

  if (badgeScore >= 550 || totalPoints >= 500_000) {
    return { tier: "Legendary" as const, badgeScore };
  }

  if (badgeScore >= 360 || totalPoints >= 200_000) {
    return { tier: "Platinum" as const, badgeScore };
  }

  if (badgeScore >= 220 || totalPoints >= 75_000) {
    return { tier: "Gold" as const, badgeScore };
  }

  if (badgeScore >= 120 || totalPoints >= 25_000) {
    return { tier: "Silver" as const, badgeScore };
  }

  if (badgeScore >= 10 || totalPoints > 0) {
    return { tier: "Bronze" as const, badgeScore };
  }

  return { tier: "Newcomer" as const, badgeScore };
}

export function getCurrentFormBadge(stats: TrackTestStats): CompactPlayerBadge | null {
  const recentResults = stats.quizResults.slice(0, 5);

  if (recentResults.length < 3) {
    return null;
  }

  const recentAccuracy =
    recentResults.reduce((total, result) => total + result.accuracyPercentage, 0) /
    recentResults.length;
  const recentAverageTime =
    recentResults.reduce((total, result) => total + result.averageAnswerTime, 0) /
    recentResults.length;

  if (recentAccuracy >= 95 && recentAverageTime <= 4) {
    return {
      id: "arena-threat",
      label: "Threat",
      title: "Arena Threat",
      kind: "form",
    };
  }

  if (recentAccuracy >= 85) {
    return {
      id: "hot-form",
      label: "Hot",
      title: "Hot Form",
      kind: "form",
    };
  }

  return null;
}

export function getActiveDailyStreakBadge(
  stats: TrackTestStats
): CompactPlayerBadge | null {
  if (!isDailyStreakAlive(stats) || stats.overall.currentDailyStreak < 2) {
    return null;
  }

  if (stats.overall.currentDailyStreak >= 7) {
    return {
      id: "active-seven-day-locked-in",
      label: "7 Day",
      title: "7 Day Locked In",
      kind: "dailyStreak",
    };
  }

  if (stats.overall.currentDailyStreak >= 3) {
    return {
      id: "active-daily-streak",
      label: "Daily",
      title: "Daily Streak Active",
      kind: "dailyStreak",
    };
  }

  return null;
}

export function getCompactPlayerBadges(
  stats: TrackTestStats,
  badges: ArenaBadge[]
) {
  const { tier } = calculatePlayerTier(badges, stats);
  const compactBadges: CompactPlayerBadge[] = [
    {
      id: `tier-${tier.toLowerCase()}`,
      label: tier,
      title: `${tier} Player Tier`,
      kind: "tier",
      tier,
    },
  ];
  const formBadge = getCurrentFormBadge(stats);
  const activeStreakBadge = getActiveDailyStreakBadge(stats);

  if (formBadge) {
    compactBadges.push(formBadge);
  }

  if (activeStreakBadge) {
    compactBadges.push(activeStreakBadge);
  }

  return compactBadges.slice(0, 3);
}

export function getRankFormBadge(rank: number): CompactPlayerBadge | null {
  if (rank === 1) {
    return {
      id: "top-one",
      label: "Top 1",
      title: "Top ranked Arena form",
      kind: "form",
    };
  }

  if (rank <= 3) {
    return {
      id: "top-five",
      label: "Top 5",
      title: "Top 5 Arena form",
      kind: "form",
    };
  }

  if (rank <= 10) {
    return {
      id: "top-ten",
      label: "Top 10",
      title: "Top 10 Arena form",
      kind: "form",
    };
  }

  return null;
}

function isDailyStreakAlive(stats: TrackTestStats) {
  const lastPlayedDate = stats.overall.lastPlayedDate;

  if (!lastPlayedDate) {
    return false;
  }

  const today = getLocalDateKey();
  const yesterday = getLocalDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

  return lastPlayedDate === today || lastPlayedDate === yesterday;
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
