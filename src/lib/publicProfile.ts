import type { User } from "@supabase/supabase-js";
import { fetchCloudBadgeStats } from "./cloudBadgeStats";
import { supabase } from "./supabaseClient";
import { fetchProfileDisplayInfo, type ProfileDisplayInfo } from "./profiles";
import {
  getTrackTestStats,
  type AlbumStats,
  type ArtistStats,
  type QuizResult,
  type TrackTestStats,
} from "./stats";

export type PublicProfileStatsSource = "cloud" | "localFallback";

export type CurrentUserProfileStats = {
  displayInfo: ProfileDisplayInfo;
  stats: TrackTestStats;
  source: PublicProfileStatsSource;
  error: string | null;
};

export type PublicProfileStats = {
  displayInfo: ProfileDisplayInfo | null;
  stats: TrackTestStats | null;
  error: string | null;
  notFound: boolean;
};

type PublicProfileSummaryRow = {
  user_id: string;
  display_name: string | null;
  username: string | null;
  total_quizzes_played: number | null;
  total_correct_answers: number | null;
  total_questions_answered: number | null;
  overall_accuracy: number | null;
  total_points: number | null;
  best_score: number | null;
  average_answer_time: number | null;
  current_daily_streak: number | null;
  last_played_date: string | null;
};

type PublicQuizResultRow = {
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

type PublicArtistRow = {
  artist_name: string;
  quizzes_played: number | null;
  correct_answers: number | null;
  total_questions: number | null;
  accuracy: number | null;
  total_points: number | null;
  best_score: number | null;
};

type PublicAlbumRow = {
  album_name: string;
  artist_name: string;
  times_played: number | null;
  best_score: number | null;
  best_accuracy: number | null;
  last_played_at?: string | null;
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

export async function fetchPublicProfileByUsername(
  usernameInput: string
): Promise<PublicProfileStats> {
  if (!supabase) {
    return {
      displayInfo: null,
      stats: null,
      error: "Supabase is not configured yet.",
      notFound: false,
    };
  }

  const username = usernameInput.trim().toLowerCase();
  const { data: summary, error: summaryError } = await supabase
    .from("public_profile_summary")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (summaryError) {
    return {
      displayInfo: null,
      stats: null,
      error: summaryError.message,
      notFound: false,
    };
  }

  if (!summary) {
    return {
      displayInfo: null,
      stats: null,
      error: null,
      notFound: true,
    };
  }

  const summaryRow = summary as PublicProfileSummaryRow;
  const [recentResults, artistStats, albumStats] = await Promise.all([
    supabase
      .from("public_profile_recent_results")
      .select(
        "id, album_name, artist_name, total_questions, correct_answers, accuracy, final_points, average_answer_time, played_at"
      )
      .eq("username", username)
      .order("played_at", { ascending: false })
      .limit(100),
    supabase
      .from("public_profile_artist_stats")
      .select(
        "artist_name, quizzes_played, correct_answers, total_questions, accuracy, total_points, best_score"
      )
      .eq("username", username)
      .order("total_points", { ascending: false })
      .limit(100),
    supabase
      .from("public_profile_album_stats")
      .select(
        "album_name, artist_name, times_played, best_score, best_accuracy, last_played_at"
      )
      .eq("username", username)
      .order("best_score", { ascending: false })
      .limit(100),
  ]);

  const firstError = recentResults.error || artistStats.error || albumStats.error;

  if (firstError) {
    return {
      displayInfo: mapPublicDisplayInfo(summaryRow),
      stats: null,
      error: firstError.message,
      notFound: false,
    };
  }

  return {
    displayInfo: mapPublicDisplayInfo(summaryRow),
    stats: buildPublicTrackTestStats(
      summaryRow,
      (recentResults.data || []) as PublicQuizResultRow[],
      (artistStats.data || []) as PublicArtistRow[],
      (albumStats.data || []) as PublicAlbumRow[]
    ),
    error: null,
    notFound: false,
  };
}

function buildPublicTrackTestStats(
  summary: PublicProfileSummaryRow,
  quizRows: PublicQuizResultRow[],
  artistRows: PublicArtistRow[],
  albumRows: PublicAlbumRow[]
): TrackTestStats {
  const quizResults = quizRows.map(mapPublicQuizResult);

  return {
    version: 1,
    quizResults,
    overall: {
      totalQuizzesPlayed: summary.total_quizzes_played || 0,
      totalCorrectAnswers: summary.total_correct_answers || 0,
      totalQuestionsAnswered: summary.total_questions_answered || 0,
      overallAccuracy: summary.overall_accuracy || 0,
      totalPoints: summary.total_points || 0,
      bestScore: summary.best_score || 0,
      averageAnswerTime: summary.average_answer_time || 0,
      currentDailyStreak: summary.current_daily_streak || 0,
      lastPlayedDate: summary.last_played_date || "",
    },
    artists: Object.fromEntries(
      artistRows.map((artist) => [
        normalizeKey(artist.artist_name),
        mapPublicArtist(artist),
      ])
    ),
    albums: Object.fromEntries(
      albumRows.map((album) => [
        normalizeKey(`${album.artist_name}-${album.album_name}`),
        mapPublicAlbum(album),
      ])
    ),
  };
}

function mapPublicDisplayInfo(row: PublicProfileSummaryRow): ProfileDisplayInfo {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name || row.username || "Unknown Player",
  };
}

function mapPublicQuizResult(row: PublicQuizResultRow): QuizResult {
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

function mapPublicArtist(row: PublicArtistRow): ArtistStats {
  return {
    artistName: row.artist_name,
    quizzesPlayed: row.quizzes_played || 0,
    correctAnswers: row.correct_answers || 0,
    totalQuestions: row.total_questions || 0,
    accuracy: row.accuracy || 0,
    totalPoints: row.total_points || 0,
    bestScore: row.best_score || 0,
  };
}

function mapPublicAlbum(row: PublicAlbumRow): AlbumStats {
  return {
    albumName: row.album_name,
    artistName: row.artist_name,
    timesPlayed: row.times_played || 0,
    bestScore: row.best_score || 0,
    bestAccuracy: row.best_accuracy || 0,
    lastPlayedDate: row.last_played_at
      ? row.last_played_at.slice(0, 10)
      : "",
  };
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
