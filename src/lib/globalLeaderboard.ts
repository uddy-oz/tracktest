import { supabase } from "./supabaseClient";

export type OverallPointsEntry = {
  userId: string;
  playerName: string;
  username: string | null;
  totalPoints: number;
  quizzesPlayed: number;
  bestScore: number;
  averageAccuracy: number;
};

export type BestAccuracyEntry = {
  userId: string;
  playerName: string;
  username: string | null;
  accuracy: number;
  totalQuestions: number;
  quizzesPlayed: number;
  totalPoints: number;
};

export type BestAlbumScoreEntry = {
  userId: string;
  playerName: string;
  username: string | null;
  albumName: string;
  artistName: string;
  bestScore: number;
  bestAccuracy: number;
};

export type ArtistMasterEntry = {
  userId: string;
  playerName: string;
  username: string | null;
  artistName: string;
  quizzesPlayed: number;
  accuracy: number;
  totalPoints: number;
  bestScore: number;
};

export type PerfectRunEntry = {
  id: string;
  userId: string;
  playerName: string;
  username: string | null;
  albumName: string;
  artistName: string;
  totalQuestions: number;
  finalPoints: number;
  playedAt: string;
};

export type GlobalLeaderboardData = {
  overallPoints: OverallPointsEntry[];
  bestAccuracy: BestAccuracyEntry[];
  bestAlbumScores: BestAlbumScoreEntry[];
  artistMasters: ArtistMasterEntry[];
  recentPerfectRuns: PerfectRunEntry[];
};

type OverallPointsRow = {
  user_id: string;
  player_name: string | null;
  username: string | null;
  total_points: number | null;
  quizzes_played: number | null;
  best_score: number | null;
  average_accuracy: number | null;
};

type BestAccuracyRow = {
  user_id: string;
  player_name: string | null;
  username: string | null;
  accuracy: number | null;
  total_questions: number | null;
  quizzes_played: number | null;
  total_points: number | null;
};

type BestAlbumScoreRow = {
  user_id: string;
  player_name: string | null;
  username: string | null;
  album_name: string;
  artist_name: string;
  best_score: number | null;
  best_accuracy: number | null;
};

type ArtistMasterRow = {
  user_id: string;
  player_name: string | null;
  username: string | null;
  artist_name: string;
  quizzes_played: number | null;
  accuracy: number | null;
  total_points: number | null;
  best_score: number | null;
};

type PerfectRunRow = {
  id: string;
  user_id: string;
  player_name: string | null;
  username: string | null;
  album_name: string;
  artist_name: string;
  total_questions: number | null;
  final_points: number | null;
  played_at: string;
};

export async function fetchGlobalLeaderboard() {
  if (!supabase) {
    return {
      data: null,
      error: "Supabase is not configured yet.",
    };
  }

  const [
    overallPointsResult,
    bestAccuracyResult,
    bestAlbumScoresResult,
    artistMastersResult,
    recentPerfectRunsResult,
  ] = await Promise.all([
    supabase
      .from("global_overall_points")
      .select("*")
      .order("total_points", { ascending: false })
      .limit(10),
    supabase
      .from("global_best_accuracy")
      .select("*")
      .order("accuracy", { ascending: false })
      .order("total_questions", { ascending: false })
      .limit(10),
    supabase
      .from("global_album_scores")
      .select("*")
      .order("best_score", { ascending: false })
      .order("best_accuracy", { ascending: false })
      .limit(10),
    supabase
      .from("global_artist_masters")
      .select("*")
      .order("total_points", { ascending: false })
      .order("accuracy", { ascending: false })
      .limit(10),
    supabase
      .from("global_perfect_runs")
      .select("*")
      .order("played_at", { ascending: false })
      .limit(10),
  ]);

  const firstError =
    overallPointsResult.error ||
    bestAccuracyResult.error ||
    bestAlbumScoresResult.error ||
    artistMastersResult.error ||
    recentPerfectRunsResult.error;

  if (firstError) {
    return {
      data: null,
      error: firstError.message,
    };
  }

  return {
    data: {
      overallPoints: (overallPointsResult.data || []).map(mapOverallPoints),
      bestAccuracy: (bestAccuracyResult.data || []).map(mapBestAccuracy),
      bestAlbumScores: (bestAlbumScoresResult.data || []).map(
        mapBestAlbumScore
      ),
      artistMasters: (artistMastersResult.data || []).map(mapArtistMaster),
      recentPerfectRuns: (recentPerfectRunsResult.data || []).map(
        mapPerfectRun
      ),
    },
    error: null,
  };
}

function getPlayerName(row: { player_name: string | null }) {
  return row.player_name || "Unknown Player";
}

function mapOverallPoints(row: OverallPointsRow): OverallPointsEntry {
  return {
    userId: row.user_id,
    playerName: getPlayerName(row),
    username: row.username,
    totalPoints: row.total_points || 0,
    quizzesPlayed: row.quizzes_played || 0,
    bestScore: row.best_score || 0,
    averageAccuracy: row.average_accuracy || 0,
  };
}

function mapBestAccuracy(row: BestAccuracyRow): BestAccuracyEntry {
  return {
    userId: row.user_id,
    playerName: getPlayerName(row),
    username: row.username,
    accuracy: row.accuracy || 0,
    totalQuestions: row.total_questions || 0,
    quizzesPlayed: row.quizzes_played || 0,
    totalPoints: row.total_points || 0,
  };
}

function mapBestAlbumScore(row: BestAlbumScoreRow): BestAlbumScoreEntry {
  return {
    userId: row.user_id,
    playerName: getPlayerName(row),
    username: row.username,
    albumName: row.album_name,
    artistName: row.artist_name,
    bestScore: row.best_score || 0,
    bestAccuracy: row.best_accuracy || 0,
  };
}

function mapArtistMaster(row: ArtistMasterRow): ArtistMasterEntry {
  return {
    userId: row.user_id,
    playerName: getPlayerName(row),
    username: row.username,
    artistName: row.artist_name,
    quizzesPlayed: row.quizzes_played || 0,
    accuracy: row.accuracy || 0,
    totalPoints: row.total_points || 0,
    bestScore: row.best_score || 0,
  };
}

function mapPerfectRun(row: PerfectRunRow): PerfectRunEntry {
  return {
    id: row.id,
    userId: row.user_id,
    playerName: getPlayerName(row),
    username: row.username,
    albumName: row.album_name,
    artistName: row.artist_name,
    totalQuestions: row.total_questions || 0,
    finalPoints: row.final_points || 0,
    playedAt: row.played_at,
  };
}
