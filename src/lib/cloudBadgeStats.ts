import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import {
  buildArenaProgress,
  type AlbumStats,
  type ArtistStats,
  type GameMode,
  type QuizResult,
  type TrackTestStats,
} from "./stats";

type QuizResultRow = {
  id: string;
  album_name: string;
  artist_name: string;
  total_questions: number;
  correct_answers: number;
  accuracy: number;
  final_points: number;
  average_answer_time: number;
  played_at: string;
  game_mode?: string | null;
  is_private?: boolean | null;
  is_winner?: boolean | null;
  was_host?: boolean | null;
  player_count?: number | null;
  placement?: number | null;
  score_margin?: number | null;
  result_status?: string | null;
};

export async function fetchCloudBadgeStats(user: User) {
  if (!supabase) {
    return { data: null, error: "Supabase is not configured yet." };
  }

  const result = await supabase
    .from("quiz_results")
    .select(
      "id, album_name, artist_name, total_questions, correct_answers, accuracy, final_points, average_answer_time, played_at, game_mode, is_private, is_winner, was_host, player_count, placement, score_margin, result_status"
    )
    .eq("user_id", user.id)
    .order("played_at", { ascending: false });

  if (!result.error) {
    return {
      data: buildTrackTestStats((result.data || []) as QuizResultRow[]),
      error: null,
    };
  }

  // Keep cloud stats readable while the progression migration is being
  // deployed. Legacy rows are treated as Single Player results.
  const legacyResult = await supabase
    .from("quiz_results")
    .select(
      "id, album_name, artist_name, total_questions, correct_answers, accuracy, final_points, average_answer_time, played_at"
    )
    .eq("user_id", user.id)
    .order("played_at", { ascending: false });

  if (legacyResult.error) {
    return { data: null, error: result.error.message };
  }

  return {
    data: buildTrackTestStats((legacyResult.data || []) as QuizResultRow[]),
    error: null,
  };
}

function buildTrackTestStats(quizRows: QuizResultRow[]): TrackTestStats {
  const quizResults = quizRows.map(mapQuizResult);
  const totalQuestionsAnswered = quizResults.reduce(
    (total, result) => total + result.totalQuestions,
    0
  );
  const totalCorrectAnswers = quizResults.reduce(
    (total, result) => total + result.correctAnswers,
    0
  );
  const totalAnswerTime = quizResults.reduce(
    (total, result) => total + result.averageAnswerTime * result.totalQuestions,
    0
  );

  return {
    version: 1,
    quizResults,
    overall: {
      totalQuizzesPlayed: quizResults.length,
      totalCorrectAnswers,
      totalQuestionsAnswered,
      overallAccuracy: calculateAccuracy(totalCorrectAnswers, totalQuestionsAnswered),
      totalPoints: quizResults.reduce(
        (total, result) => total + result.finalPoints,
        0
      ),
      bestScore: Math.max(0, ...quizResults.map((result) => result.finalPoints)),
      averageAnswerTime:
        totalQuestionsAnswered > 0 ? totalAnswerTime / totalQuestionsAnswered : 0,
      currentDailyStreak: calculateCurrentDailyStreak(quizResults),
      lastPlayedDate: getLastPlayedDateKey(quizResults),
    },
    artists: buildArtistStats(quizResults),
    albums: buildAlbumStats(quizResults),
    arena: buildArenaProgress(quizResults),
  };
}

function mapQuizResult(row: QuizResultRow): QuizResult {
  return {
    id: row.id,
    albumName: row.album_name,
    artistName: row.artist_name,
    totalQuestions: row.total_questions,
    correctAnswers: row.correct_answers,
    accuracyPercentage: Number(row.accuracy),
    finalPoints: row.final_points,
    averageAnswerTime: Number(row.average_answer_time),
    datePlayed: row.played_at,
    gameMode: normalizeGameMode(row.game_mode),
    isPrivate: Boolean(row.is_private),
    isWinner: Boolean(row.is_winner),
    wasHost: Boolean(row.was_host),
    playerCount: row.player_count || 0,
    placement: row.placement ?? null,
    scoreMargin: row.score_margin || 0,
    resultStatus: row.result_status || "completed",
  };
}

function buildArtistStats(results: QuizResult[]) {
  const artists: Record<string, ArtistStats> = {};

  for (const result of results) {
    const key = normalizeKey(result.artistName);
    const artist = artists[key] || {
      artistName: result.artistName,
      quizzesPlayed: 0,
      correctAnswers: 0,
      totalQuestions: 0,
      accuracy: 0,
      totalPoints: 0,
      bestScore: 0,
    };

    artist.quizzesPlayed += 1;
    artist.correctAnswers += result.correctAnswers;
    artist.totalQuestions += result.totalQuestions;
    artist.accuracy = calculateAccuracy(
      artist.correctAnswers,
      artist.totalQuestions
    );
    artist.totalPoints += result.finalPoints;
    artist.bestScore = Math.max(artist.bestScore, result.finalPoints);
    artists[key] = artist;
  }

  return artists;
}

function buildAlbumStats(results: QuizResult[]) {
  const albums: Record<string, AlbumStats> = {};

  for (const result of results) {
    const key = normalizeKey(`${result.artistName}-${result.albumName}`);
    const album = albums[key] || {
      albumName: result.albumName,
      artistName: result.artistName,
      timesPlayed: 0,
      bestScore: 0,
      bestAccuracy: 0,
      lastPlayedDate: "",
    };

    album.timesPlayed += 1;
    album.bestScore = Math.max(album.bestScore, result.finalPoints);
    album.bestAccuracy = Math.max(
      album.bestAccuracy,
      result.accuracyPercentage
    );
    album.lastPlayedDate = album.lastPlayedDate || result.datePlayed.slice(0, 10);
    albums[key] = album;
  }

  return albums;
}

function normalizeGameMode(value: string | null | undefined): GameMode {
  if (
    value === "duel" ||
    value === "group_lobby" ||
    value === "party_mode" ||
    value === "championship"
  ) {
    return value;
  }

  return "single_player";
}

function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions === 0) {
    return 0;
  }

  return Math.round((correctAnswers / totalQuestions) * 100);
}

function calculateCurrentDailyStreak(results: QuizResult[]) {
  const playedDays = new Set(
    results.map((result) => getDateKey(new Date(result.datePlayed)))
  );
  const today = getDateKey();
  const yesterday = getDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  let cursor =
    playedDays.has(today) || !playedDays.has(yesterday)
      ? new Date()
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
  let streak = 0;

  while (playedDays.has(getDateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return streak;
}

function getLastPlayedDateKey(results: QuizResult[]) {
  const latestResult = results[0];

  return latestResult ? getDateKey(new Date(latestResult.datePlayed)) : "";
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
