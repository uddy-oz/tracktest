import type { User } from "@supabase/supabase-js";
import type { QuizResult, TrackTestStats } from "./stats";
import { getTrackTestStats } from "./stats";
import { supabase } from "./supabaseClient";

type CloudSaveResult = {
  ok: boolean;
  reason?: string;
};

type ArtistStatsRow = {
  quizzes_played: number;
  correct_answers: number;
  total_questions: number;
  total_points: number;
  best_score: number;
  average_answer_time: number;
};

type AlbumStatsRow = {
  times_played: number;
  best_score: number;
  best_accuracy: number;
};

function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions === 0) {
    return 0;
  }

  return Math.round((correctAnswers / totalQuestions) * 100);
}

function calculateWeightedAverage(
  previousAverage: number,
  previousCount: number,
  nextAverage: number,
  nextCount: number
) {
  if (previousCount === 0) {
    return nextAverage;
  }

  return (
    (previousAverage * previousCount + nextAverage * nextCount) /
    (previousCount + nextCount)
  );
}

async function ensureProfile(user: User) {
  if (!supabase) {
    return "Supabase is not configured yet.";
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  return error?.message || null;
}

async function saveArtistStats(user: User, result: QuizResult) {
  if (!supabase) {
    return "Supabase is not configured yet.";
  }

  const { data, error: fetchError } = await supabase
    .from("artist_stats")
    .select(
      "quizzes_played, correct_answers, total_questions, total_points, best_score, average_answer_time"
    )
    .eq("user_id", user.id)
    .eq("artist_name", result.artistName)
    .maybeSingle();

  if (fetchError) {
    return fetchError.message;
  }

  const existing = data as ArtistStatsRow | null;
  const previousQuestions = existing?.total_questions || 0;
  const nextCorrectAnswers =
    (existing?.correct_answers || 0) + result.correctAnswers;
  const nextTotalQuestions = previousQuestions + result.totalQuestions;
  const nextStats = {
    user_id: user.id,
    artist_name: result.artistName,
    quizzes_played: (existing?.quizzes_played || 0) + 1,
    correct_answers: nextCorrectAnswers,
    total_questions: nextTotalQuestions,
    accuracy: calculateAccuracy(nextCorrectAnswers, nextTotalQuestions),
    total_points: (existing?.total_points || 0) + result.finalPoints,
    best_score: Math.max(existing?.best_score || 0, result.finalPoints),
    average_answer_time: calculateWeightedAverage(
      existing?.average_answer_time || 0,
      previousQuestions,
      result.averageAnswerTime,
      result.totalQuestions
    ),
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("artist_stats")
    .upsert(nextStats, { onConflict: "user_id,artist_name" });

  return upsertError?.message || null;
}

async function saveAlbumStats(user: User, result: QuizResult) {
  if (!supabase) {
    return "Supabase is not configured yet.";
  }

  const { data, error: fetchError } = await supabase
    .from("album_stats")
    .select("times_played, best_score, best_accuracy")
    .eq("user_id", user.id)
    .eq("artist_name", result.artistName)
    .eq("album_name", result.albumName)
    .maybeSingle();

  if (fetchError) {
    return fetchError.message;
  }

  const existing = data as AlbumStatsRow | null;
  const nextStats = {
    user_id: user.id,
    album_name: result.albumName,
    artist_name: result.artistName,
    times_played: (existing?.times_played || 0) + 1,
    best_score: Math.max(existing?.best_score || 0, result.finalPoints),
    best_accuracy: Math.max(
      existing?.best_accuracy || 0,
      result.accuracyPercentage
    ),
    last_played_at: result.datePlayed,
  };

  const { error: upsertError } = await supabase
    .from("album_stats")
    .upsert(nextStats, { onConflict: "user_id,artist_name,album_name" });

  return upsertError?.message || null;
}

export async function saveQuizResultToCloud(
  user: User,
  result: QuizResult
): Promise<CloudSaveResult> {
  if (!supabase) {
    return { ok: false, reason: "Supabase is not configured yet." };
  }

  const profileError = await ensureProfile(user);

  if (profileError) {
    return { ok: false, reason: profileError };
  }

  const { error: resultError } = await supabase.from("quiz_results").insert({
    user_id: user.id,
    album_name: result.albumName,
    artist_name: result.artistName,
    total_questions: result.totalQuestions,
    correct_answers: result.correctAnswers,
    accuracy: result.accuracyPercentage,
    final_points: result.finalPoints,
    average_answer_time: result.averageAnswerTime,
    played_at: result.datePlayed,
  });

  if (resultError) {
    return { ok: false, reason: resultError.message };
  }

  const artistError = await saveArtistStats(user, result);

  if (artistError) {
    return { ok: false, reason: artistError };
  }

  const albumError = await saveAlbumStats(user, result);

  if (albumError) {
    return { ok: false, reason: albumError };
  }

  return { ok: true };
}

export async function syncLocalStatsToCloud(user: User) {
  const localStats = getTrackTestStats();

  for (const result of localStats.quizResults) {
    const saveResult = await saveQuizResultToCloud(user, result);

    if (!saveResult.ok) {
      return saveResult;
    }
  }

  return { ok: true };
}

export async function fetchUserStats(
  user: User
): Promise<{ data: TrackTestStats | null; error: string | null }> {
  if (!supabase) {
    return { data: null, error: "Supabase is not configured yet." };
  }

  const { data, error } = await supabase
    .from("quiz_results")
    .select("*")
    .eq("user_id", user.id)
    .order("played_at", { ascending: false });

  if (error) {
    return { data: null, error: error.message };
  }

  void data;

  return {
    data: null,
    error: "Cloud leaderboard rendering is not connected yet.",
  };
}
