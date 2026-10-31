import type { TrackTestStats, QuizResult } from "./stats";

export type DailyGoal = {
  id: string; title: string; description: string; progress: number; target: number;
  complete: boolean; mode: "Solo" | "Arena" | "Championship" | "Party";
  periodStart: string; periodEnd: string; available: boolean;
};

export function getDailyGoalFoundation(stats: TrackTestStats, now = new Date()): DailyGoal[] {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = start + 86400000;
  const period = { periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString() };
  const unique = new Map<string, QuizResult>();
  // A duplicate delivery cannot complete a goal twice. Ignore invalid/future records.
  for (const r of stats.quizResults) {
    if (typeof r.id !== "string" || !r.id || typeof r.datePlayed !== "string" || !Number.isFinite(Date.parse(r.datePlayed)) || Date.parse(r.datePlayed) > now.getTime()
      || !Number.isFinite(r.totalQuestions) || r.totalQuestions <= 0 || !Number.isInteger(r.totalQuestions)
      || !Number.isInteger(r.correctAnswers) || r.correctAnswers < 0 || r.correctAnswers > r.totalQuestions
      || (r.resultStatus && r.resultStatus !== "completed")) continue;
    if (!unique.has(r.id)) unique.set(r.id, r);
  }
  const solo = [...unique.values()].filter(r => !r.gameMode || r.gameMode === "single_player");
  const today = solo.filter(r => Date.parse(r.datePlayed) >= start && Date.parse(r.datePlayed) < end);
  const name = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
  const key = (r: QuizResult) => `${name(r.artistName)}\u0000${name(r.albumName)}`;
  const perfectAlbums = new Set(today.filter(r => r.correctAnswers === r.totalQuestions && name(r.albumName) && name(r.artistName)).map(key)).size;
  const fastPerfect = today.some(r => r.correctAnswers === r.totalQuestions && Number.isFinite(r.averageAnswerTime) && r.averageAnswerTime >= 0 && r.averageAnswerTime <= 3);
  let improved = false;
  for (const r of today) {
    if (!name(r.albumName) || !name(r.artistName) || !Number.isFinite(r.finalPoints) || r.finalPoints < 0) continue;
    const prior = solo.filter(p => key(p) === key(r) && Date.parse(p.datePlayed) < Date.parse(r.datePlayed) && Number.isFinite(p.finalPoints) && p.finalPoints >= 0);
    if (prior.length && r.finalPoints > Math.max(...prior.map(p => p.finalPoints))) improved = true;
  }
  const arenaWins = [...unique.values()].filter(r => Date.parse(r.datePlayed) >= start && Date.parse(r.datePlayed) < end
    && ["duel", "group_lobby"].includes(r.gameMode || "") && r.competitiveProgressionEligible === true && r.isWinner === true).length;
  return [
    { id: "five-perfect-albums", title: "Five Perfect Albums", description: "Today (UTC): finish 5 different albums with every answer correct.", progress: Math.min(5, perfectAlbums), target: 5, complete: perfectAlbums >= 5, mode: "Solo", available: true, ...period },
    { id: "fast-perfect-run", title: "Fast Perfect Run", description: "Today (UTC): finish a perfect Solo run averaging 3 seconds or less.", progress: Number(fastPerfect), target: 1, complete: fastPerfect, mode: "Solo", available: true, ...period },
    { id: "beat-album-best", title: "Beat Your Album Best", description: "Today (UTC): beat your best earlier score in the available history, not just replay an album.", progress: Number(improved), target: 1, complete: improved, mode: "Solo", available: true, ...period },
    { id: "win-arena-games", title: "Win Arena Games", description: "Today (UTC): win 3 eligible Duel or Group Lobby games.", progress: Math.min(3, arenaWins), target: 3, complete: arenaWins >= 3, mode: "Arena", available: true, ...period },
    { id: "win-championship", title: "Win a Championship", description: "Coming Soon. Championship goals are not available.", progress: 0, target: 1, complete: false, mode: "Championship", available: false, ...period },
  ];
}
