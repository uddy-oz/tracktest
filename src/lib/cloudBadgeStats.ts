import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { AlbumStats, ArtistStats, QuizResult, TrackTestStats } from "./stats";

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
};

type ArtistStatsRow = {
  artist_name: string;
  quizzes_played: number;
  correct_answers: number;
  total_questions: number;
  accuracy: number;
  total_points: number;
  best_score: number;
};

type AlbumStatsRow = {
  album_name: string;
  artist_name: string;
  times_played: number;
  best_score: number;
  best_accuracy: number;
  last_played_at: string;
};

export async function fetchCloudBadgeStats(user: User) {
  if (!supabase) {
    return { data: null, error: "Supabase is not configured yet." };
  }

  const [quizResults, artistStats, albumStats] = await Promise.all([
    supabase
      .from("quiz_results")
      .select(
        "id, album_name, artist_name, total_questions, correct_answers, accuracy, final_points, average_answer_time, played_at"
      )
      .eq("user_id", user.id)
      .order("played_at", { ascending: false }),
    supabase
      .from("artist_stats")
      .select(
        "artist_name, quizzes_played, correct_answers, total_questions, accuracy, total_points, best_score"
      )
      .eq("user_id", user.id),
    supabase
      .from("album_stats")
      .select(
        "album_name, artist_name, times_played, best_score, best_accuracy, last_played_at"
      )
      .eq("user_id", user.id),
  ]);

  const firstError = quizResults.error || artistStats.error || albumStats.error;

  if (firstError) {
    return { data: null, error: firstError.message };
  }

  return {
    data: buildTrackTestStats(
      (quizResults.data || []) as QuizResultRow[],
      (artistStats.data || []) as ArtistStatsRow[],
      (albumStats.data || []) as AlbumStatsRow[]
    ),
    error: null,
  };
}

function buildTrackTestStats(
  quizRows: QuizResultRow[],
  artistRows: ArtistStatsRow[],
  albumRows: AlbumStatsRow[]
): TrackTestStats {
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
    artists: Object.fromEntries(
      artistRows.map((artist) => [normalizeKey(artist.artist_name), mapArtist(artist)])
    ),
    albums: Object.fromEntries(
      albumRows.map((album) => [
        normalizeKey(`${album.artist_name}-${album.album_name}`),
        mapAlbum(album),
      ])
    ),
  };
}

function mapQuizResult(row: QuizResultRow): QuizResult {
  return {
    id: row.id,
    albumName: row.album_name,
    artistName: row.artist_name,
    totalQuestions: row.total_questions,
    correctAnswers: row.correct_answers,
    accuracyPercentage: row.accuracy,
    finalPoints: row.final_points,
    averageAnswerTime: row.average_answer_time,
    datePlayed: row.played_at,
  };
}

function mapArtist(row: ArtistStatsRow): ArtistStats {
  return {
    artistName: row.artist_name,
    quizzesPlayed: row.quizzes_played,
    correctAnswers: row.correct_answers,
    totalQuestions: row.total_questions,
    accuracy: row.accuracy,
    totalPoints: row.total_points,
    bestScore: row.best_score,
  };
}

function mapAlbum(row: AlbumStatsRow): AlbumStats {
  return {
    albumName: row.album_name,
    artistName: row.artist_name,
    timesPlayed: row.times_played,
    bestScore: row.best_score,
    bestAccuracy: row.best_accuracy,
    lastPlayedDate: getDateKey(new Date(row.last_played_at)),
  };
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
