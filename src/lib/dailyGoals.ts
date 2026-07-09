import type { TrackTestStats } from "./stats";

export type DailyGoal = {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  complete: boolean;
  mode: "Solo" | "Arena" | "Championship" | "Party";
};

export function getDailyGoalFoundation(stats: TrackTestStats): DailyGoal[] {
  const perfectRuns = stats.quizResults.filter(
    (result) => result.accuracyPercentage === 100
  ).length;
  const fastestPerfectRun = stats.quizResults.find(
    (result) =>
      result.accuracyPercentage === 100 && result.averageAnswerTime <= 3
  );
  const improvedAlbumScores = Object.values(stats.albums).filter(
    (album) => album.timesPlayed >= 2
  ).length;

  return [
    {
      id: "five-perfect-albums",
      title: "Five Perfect Albums",
      description: "Get 100% on 5 album quizzes.",
      progress: Math.min(perfectRuns, 5),
      target: 5,
      complete: perfectRuns >= 5,
      mode: "Solo",
    },
    {
      id: "fast-perfect-run",
      title: "Fast Perfect Run",
      description: "Get 100% with a 3 second or faster average answer time.",
      progress: fastestPerfectRun ? 1 : 0,
      target: 1,
      complete: Boolean(fastestPerfectRun),
      mode: "Solo",
    },
    {
      id: "beat-album-best",
      title: "Beat Your Album Best",
      description: "Replay an album and beat your previous best score.",
      progress: Math.min(improvedAlbumScores, 1),
      target: 1,
      complete: improvedAlbumScores >= 1,
      mode: "Solo",
    },
    {
      id: "win-arena-games",
      title: "Win Arena Games",
      description: "Future goal: win Arena 1v1 or Lobby games.",
      progress: 0,
      target: 3,
      complete: false,
      mode: "Arena",
    },
    {
      id: "win-championship",
      title: "Win a Championship",
      description: "Future goal: win a multi-album Championship.",
      progress: 0,
      target: 1,
      complete: false,
      mode: "Championship",
    },
  ];
}
