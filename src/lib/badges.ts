import type { TrackTestStats } from "./stats";

export type BadgeCategory =
  | "Skill"
  | "Artist Mastery"
  | "Daily Streak"
  | "Winning Streak"
  | "Arena 1v1"
  | "Arena Lobby"
  | "Party Mode"
  | "Championship";

export type BadgeTier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Legendary";

export type BadgeIcon =
  | "checkRing"
  | "diamond"
  | "bolt"
  | "record"
  | "crown"
  | "discs"
  | "calendar"
  | "flame"
  | "trophy"
  | "shield"
  | "star"
  | "clutch"
  | "swords"
  | "users"
  | "party"
  | "comeback"
  | "target"
  | "headphones"
  | "stack"
  | "key";

export type ArenaBadge = {
  id: string;
  title: string;
  description: string;
  category: BadgeCategory;
  tier: BadgeTier;
  unlocked: boolean;
  unlockedAt?: string;
  progress?: number;
  target?: number;
  icon: BadgeIcon;
  accent: string;
};

const FUTURE_ARENA_BADGES: ArenaBadge[] = [
  {
    id: "back-to-back-champion",
    title: "Back to Back Champion",
    description: "Win 2 championship or lobby games in a row.",
    category: "Winning Streak",
    tier: "Gold",
    unlocked: false,
    progress: 0,
    target: 2,
    icon: "trophy",
    accent: "amber",
  },
  {
    id: "three-peat",
    title: "Three Peat",
    description: "Win 3 championship or lobby games in a row.",
    category: "Winning Streak",
    tier: "Platinum",
    unlocked: false,
    progress: 0,
    target: 3,
    icon: "crown",
    accent: "violet",
  },
  {
    id: "arena-dynasty",
    title: "Arena Dynasty",
    description: "Win 5 championship or lobby games in a row.",
    category: "Winning Streak",
    tier: "Legendary",
    unlocked: false,
    progress: 0,
    target: 5,
    icon: "shield",
    accent: "gold",
  },
  {
    id: "first-1v1-win",
    title: "First 1v1 Win",
    description: "Win your first Arena 1v1 match.",
    category: "Arena 1v1",
    tier: "Bronze",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "swords",
    accent: "cyan",
  },
  {
    id: "close-call",
    title: "Close Call",
    description: "Win an Arena 1v1 by a razor-thin margin.",
    category: "Arena 1v1",
    tier: "Silver",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "target",
    accent: "silver",
  },
  {
    id: "dominant-duel",
    title: "Dominant Duel",
    description: "Win a 1v1 by a commanding score gap.",
    category: "Arena 1v1",
    tier: "Gold",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "shield",
    accent: "gold",
  },
  {
    id: "first-lobby-win",
    title: "First Lobby Win",
    description: "Win your first Arena Lobby.",
    category: "Arena Lobby",
    tier: "Bronze",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "users",
    accent: "cyan",
  },
  {
    id: "lobby-sweeper",
    title: "Lobby Sweeper",
    description: "Beat a full Arena Lobby.",
    category: "Arena Lobby",
    tier: "Platinum",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "crown",
    accent: "violet",
  },
  {
    id: "party-starter",
    title: "Party Starter",
    description: "Host your first Party Mode room.",
    category: "Party Mode",
    tier: "Bronze",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "party",
    accent: "magenta",
  },
  {
    id: "room-controller",
    title: "Room Controller",
    description: "Run a Party Mode game with 10 or more players.",
    category: "Party Mode",
    tier: "Gold",
    unlocked: false,
    progress: 0,
    target: 10,
    icon: "users",
    accent: "amber",
  },
  {
    id: "championship-winner",
    title: "Championship Winner",
    description: "Win a Championship Mode event.",
    category: "Championship",
    tier: "Gold",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "trophy",
    accent: "amber",
  },
  {
    id: "clutch-player",
    title: "Clutch Player",
    description: "Win a Championship from behind in the final album round.",
    category: "Championship",
    tier: "Platinum",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "clutch",
    accent: "rose",
  },
  {
    id: "comeback-king",
    title: "Comeback King",
    description: "Come from behind and win a multi-album Championship.",
    category: "Championship",
    tier: "Legendary",
    unlocked: false,
    progress: 0,
    target: 1,
    icon: "comeback",
    accent: "gold",
  },
];

export function getArenaBadges(stats: TrackTestStats) {
  const perfectRun = stats.quizResults.find(
    (result) => result.accuracyPercentage === 100
  );
  const quickHandsResult = stats.quizResults.find(
    (result) => result.accuracyPercentage >= 80 && result.averageAnswerTime <= 3
  );
  const speedDemonResult = stats.quizResults.find(
    (result) => result.accuracyPercentage >= 90 && result.averageAnswerTime <= 2
  );
  const bestAlbumAccuracy = Math.max(
    0,
    ...Object.values(stats.albums).map((album) => album.bestAccuracy)
  );
  const maxAlbumPlays = Math.max(
    0,
    ...Object.values(stats.albums).map((album) => album.timesPlayed)
  );
  const albumEntries = Object.values(stats.albums);
  const albumCount = albumEntries.length;
  const perfectAlbumCount = albumEntries.filter(
    (album) => album.bestAccuracy >= 100
  ).length;
  const maxAlbumsByArtist = Math.max(
    0,
    ...Object.values(
      albumEntries.reduce<Record<string, number>>((counts, album) => {
        const artistKey = album.artistName.toLowerCase().trim();
        counts[artistKey] = (counts[artistKey] || 0) + 1;
        return counts;
      }, {})
    )
  );
  const masteredArtist = Object.values(stats.artists).find(
    (artist) => artist.quizzesPlayed >= 3 && artist.accuracy >= 85
  );
  const artistCount = Object.keys(stats.artists).length;
  const dailyStreak = stats.overall.currentDailyStreak;
  const totalPerfectRuns = stats.quizResults.filter(
    (result) => result.accuracyPercentage === 100
  ).length;
  const currentPerfectRunStreak = stats.quizResults.reduce((streak, result, index) => {
    if (index > 0 && streak !== index) {
      return streak;
    }

    return result.accuracyPercentage === 100 ? streak + 1 : streak;
  }, 0);
  const bestAccuracy = Math.max(
    0,
    ...stats.quizResults.map((result) => result.accuracyPercentage)
  );

  const badges: ArenaBadge[] = [
    {
      id: "first-track",
      title: "First Track",
      description: "Complete your first Single Player quiz.",
      category: "Skill",
      tier: "Bronze",
      unlocked: stats.overall.totalQuizzesPlayed >= 1,
      unlockedAt: stats.quizResults.at(-1)?.datePlayed,
      progress: Math.min(stats.overall.totalQuizzesPlayed, 1),
      target: 1,
      icon: "headphones",
      accent: "bronze",
    },
    {
      id: "perfect-run",
      title: "Perfect Run",
      description: "Finish a quiz with every answer correct.",
      category: "Skill",
      tier: "Gold",
      unlocked: Boolean(perfectRun),
      unlockedAt: perfectRun?.datePlayed,
      progress: perfectRun ? 1 : 0,
      target: 1,
      icon: "checkRing",
      accent: "gold",
    },
    {
      id: "flawless-album",
      title: "Flawless Album",
      description: "Score 100% on any album quiz.",
      category: "Skill",
      tier: "Platinum",
      unlocked: bestAlbumAccuracy >= 100,
      progress: Math.min(bestAlbumAccuracy, 100),
      target: 100,
      icon: "diamond",
      accent: "cyan",
    },
    {
      id: "quick-hands",
      title: "Quick Hands",
      description: "Average 3 seconds or faster with at least 80% accuracy.",
      category: "Skill",
      tier: "Silver",
      unlocked: Boolean(quickHandsResult),
      unlockedAt: quickHandsResult?.datePlayed,
      progress: quickHandsResult
        ? 3
        : Math.max(0, 3 - stats.overall.averageAnswerTime),
      target: 3,
      icon: "bolt",
      accent: "yellow",
    },
    {
      id: "speed-demon",
      title: "Speed Demon",
      description: "Score at least 90% with a 2 second average answer time.",
      category: "Skill",
      tier: "Platinum",
      unlocked: Boolean(speedDemonResult),
      unlockedAt: speedDemonResult?.datePlayed,
      progress: speedDemonResult
        ? 2
        : Math.max(0, 2 - stats.overall.averageAnswerTime),
      target: 2,
      icon: "bolt",
      accent: "yellow",
    },
    {
      id: "accuracy-specialist",
      title: "Accuracy Specialist",
      description: "Hit 90% or better on any quiz.",
      category: "Skill",
      tier: "Silver",
      unlocked: bestAccuracy >= 90,
      progress: Math.min(bestAccuracy, 90),
      target: 90,
      icon: "target",
      accent: "silver",
    },
    {
      id: "perfect-five",
      title: "Perfect Five",
      description: "Earn 5 perfect quiz runs.",
      category: "Skill",
      tier: "Legendary",
      unlocked: totalPerfectRuns >= 5,
      progress: Math.min(totalPerfectRuns, 5),
      target: 5,
      icon: "checkRing",
      accent: "gold",
    },
    {
      id: "album-scholar",
      title: "Album Scholar",
      description: "Earn perfect scores on 5 different albums.",
      category: "Skill",
      tier: "Platinum",
      unlocked: perfectAlbumCount >= 5,
      progress: Math.min(perfectAlbumCount, 5),
      target: 5,
      icon: "stack",
      accent: "cyan",
    },
    {
      id: "untouchable",
      title: "Untouchable",
      description: "Complete 3 perfect quizzes in a row.",
      category: "Skill",
      tier: "Legendary",
      unlocked: currentPerfectRunStreak >= 3,
      progress: Math.min(currentPerfectRunStreak, 3),
      target: 3,
      icon: "shield",
      accent: "gold",
    },
    {
      id: "album-demon",
      title: "Album Demon",
      description: "Play the same album 3 times and chase its best score.",
      category: "Skill",
      tier: "Gold",
      unlocked: maxAlbumPlays >= 3,
      progress: Math.min(maxAlbumPlays, 3),
      target: 3,
      icon: "record",
      accent: "violet",
    },
    {
      id: "replay-king",
      title: "Replay King",
      description: "Play the same album 5 times.",
      category: "Skill",
      tier: "Silver",
      unlocked: maxAlbumPlays >= 5,
      progress: Math.min(maxAlbumPlays, 5),
      target: 5,
      icon: "record",
      accent: "violet",
    },
    {
      id: "album-collector",
      title: "Album Collector",
      description: "Play 10 different albums.",
      category: "Skill",
      tier: "Gold",
      unlocked: albumCount >= 10,
      progress: Math.min(albumCount, 10),
      target: 10,
      icon: "stack",
      accent: "amber",
    },
    {
      id: "fifty-questions",
      title: "Fifty Questions",
      description: "Answer 50 total questions.",
      category: "Skill",
      tier: "Bronze",
      unlocked: stats.overall.totalQuestionsAnswered >= 50,
      progress: Math.min(stats.overall.totalQuestionsAnswered, 50),
      target: 50,
      icon: "star",
      accent: "bronze",
    },
    {
      id: "hundred-question-club",
      title: "100 Question Club",
      description: "Answer 100 total questions across TrackTest Arena.",
      category: "Skill",
      tier: "Bronze",
      unlocked: stats.overall.totalQuestionsAnswered >= 100,
      progress: Math.min(stats.overall.totalQuestionsAnswered, 100),
      target: 100,
      icon: "star",
      accent: "bronze",
    },
    {
      id: "five-hundred-questions",
      title: "500 Questions",
      description: "Answer 500 total questions.",
      category: "Skill",
      tier: "Gold",
      unlocked: stats.overall.totalQuestionsAnswered >= 500,
      progress: Math.min(stats.overall.totalQuestionsAnswered, 500),
      target: 500,
      icon: "star",
      accent: "gold",
    },
    {
      id: "one-thousand-questions",
      title: "1,000 Questions",
      description: "Answer 1,000 total questions.",
      category: "Skill",
      tier: "Legendary",
      unlocked: stats.overall.totalQuestionsAnswered >= 1000,
      progress: Math.min(stats.overall.totalQuestionsAnswered, 1000),
      target: 1000,
      icon: "crown",
      accent: "gold",
    },
    {
      id: "artist-master",
      title: "Artist Master",
      description: "Reach 85% accuracy across 3 quizzes for one artist.",
      category: "Artist Mastery",
      tier: "Gold",
      unlocked: Boolean(masteredArtist),
      progress: masteredArtist
        ? 3
        : Math.max(
            0,
            ...Object.values(stats.artists).map((artist) => artist.quizzesPlayed)
          ),
      target: 3,
      icon: "crown",
      accent: "amber",
    },
    {
      id: "discography-demon",
      title: "Discography Demon",
      description: "Build stats for 5 different artists.",
      category: "Artist Mastery",
      tier: "Platinum",
      unlocked: artistCount >= 5,
      progress: Math.min(artistCount, 5),
      target: 5,
      icon: "discs",
      accent: "magenta",
    },
    {
      id: "deep-discography",
      title: "Deep Discography",
      description: "Play 3 different albums by the same artist.",
      category: "Artist Mastery",
      tier: "Silver",
      unlocked: maxAlbumsByArtist >= 3,
      progress: Math.min(maxAlbumsByArtist, 3),
      target: 3,
      icon: "discs",
      accent: "silver",
    },
    {
      id: "five-artist-club",
      title: "Five Artist Club",
      description: "Build stats for 5 different artists.",
      category: "Artist Mastery",
      tier: "Silver",
      unlocked: artistCount >= 5,
      progress: Math.min(artistCount, 5),
      target: 5,
      icon: "headphones",
      accent: "cyan",
    },
    {
      id: "ten-artist-club",
      title: "Ten Artist Club",
      description: "Build stats for 10 different artists.",
      category: "Artist Mastery",
      tier: "Gold",
      unlocked: artistCount >= 10,
      progress: Math.min(artistCount, 10),
      target: 10,
      icon: "crown",
      accent: "amber",
    },
    {
      id: "album-specialist",
      title: "Album Specialist",
      description: "Play one album 5 times with 85% or better best accuracy.",
      category: "Artist Mastery",
      tier: "Gold",
      unlocked: albumEntries.some(
        (album) => album.timesPlayed >= 5 && album.bestAccuracy >= 85
      ),
      progress: Math.min(maxAlbumPlays, 5),
      target: 5,
      icon: "record",
      accent: "gold",
    },
    {
      id: "three-day-listener",
      title: "3 Day Listener",
      description: "Play on 3 consecutive days.",
      category: "Daily Streak",
      tier: "Bronze",
      unlocked: dailyStreak >= 3,
      progress: Math.min(dailyStreak, 3),
      target: 3,
      icon: "calendar",
      accent: "bronze",
    },
    {
      id: "seven-day-locked-in",
      title: "7 Day Locked In",
      description: "Play on 7 consecutive days.",
      category: "Daily Streak",
      tier: "Silver",
      unlocked: dailyStreak >= 7,
      progress: Math.min(dailyStreak, 7),
      target: 7,
      icon: "flame",
      accent: "silver",
    },
    {
      id: "thirty-day-arena-regular",
      title: "30 Day Arena Regular",
      description: "Play on 30 consecutive days.",
      category: "Daily Streak",
      tier: "Legendary",
      unlocked: dailyStreak >= 30,
      progress: Math.min(dailyStreak, 30),
      target: 30,
      icon: "flame",
      accent: "gold",
    },
    {
      id: "fourteen-day-music-run",
      title: "14 Day Music Run",
      description: "Play on 14 consecutive days.",
      category: "Daily Streak",
      tier: "Gold",
      unlocked: dailyStreak >= 14,
      progress: Math.min(dailyStreak, 14),
      target: 14,
      icon: "calendar",
      accent: "amber",
    },
    {
      id: "hundred-day-legend",
      title: "100 Day Legend",
      description: "Play on 100 consecutive days.",
      category: "Daily Streak",
      tier: "Legendary",
      unlocked: dailyStreak >= 100,
      progress: Math.min(dailyStreak, 100),
      target: 100,
      icon: "flame",
      accent: "gold",
    },
    ...FUTURE_ARENA_BADGES,
  ];

  return badges;
}

export function getRecentUnlockedBadge(badges: ArenaBadge[]) {
  return badges
    .filter((badge) => badge.unlocked)
    .sort((a, b) => {
      const dateA = a.unlockedAt ? new Date(a.unlockedAt).getTime() : 0;
      const dateB = b.unlockedAt ? new Date(b.unlockedAt).getTime() : 0;

      return dateB - dateA;
    })[0];
}
