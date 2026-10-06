import { supabase } from "./supabaseClient";

export const MULTIPLAYER_LEADERBOARD_CATEGORIES = [
  "most_wins",
  "best_win_rate",
  "fastest_players",
  "longest_win_streak",
  "most_clean_sheets",
  "most_rounds_won",
  "duel_wins",
  "group_lobby_wins",
  "matches_played",
] as const;

export type MultiplayerLeaderboardCategory =
  (typeof MULTIPLAYER_LEADERBOARD_CATEGORIES)[number];

export type MultiplayerLeaderboardEntry = {
  rank: number;
  userId: string;
  playerName: string;
  username: string | null;
  value: number;
  matchesPlayed: number;
  wins: number;
  roundsWon: number;
  isCurrentUser: boolean;
  totalCount: number;
};

export type MultiplayerLeaderboardSummary = Record<
  MultiplayerLeaderboardCategory,
  MultiplayerLeaderboardEntry[]
>;

type LeaderboardRow = {
  rank: number | string;
  user_id: string;
  player_name: string | null;
  username: string | null;
  value: number | string | null;
  matches_played: number | null;
  wins: number | null;
  rounds_won: number | null;
  is_current_user: boolean | null;
  total_count: number | string | null;
};

export const MULTIPLAYER_CATEGORY_LABELS: Record<
  MultiplayerLeaderboardCategory,
  string
> = {
  most_wins: "Most Wins",
  best_win_rate: "Best Win Rate",
  fastest_players: "Fastest Players",
  longest_win_streak: "Longest Win Streak",
  most_clean_sheets: "Most Clean Sheets",
  most_rounds_won: "Most Rounds Won",
  duel_wins: "Duel Wins",
  group_lobby_wins: "Group Lobby Wins",
  matches_played: "Matches Played",
};

export function createEmptyMultiplayerSummary(): MultiplayerLeaderboardSummary {
  return MULTIPLAYER_LEADERBOARD_CATEGORIES.reduce(
    (summary, category) => {
      summary[category] = [];
      return summary;
    },
    {} as MultiplayerLeaderboardSummary
  );
}

export async function fetchMultiplayerLeaderboardSummary() {
  if (!supabase) {
    return { data: null, error: "Supabase is not configured yet." };
  }

  const { data, error } = await supabase.rpc(
    "get_multiplayer_leaderboard_summary",
    { page_size: 10 }
  );

  if (error) {
    return { data: null, error: error.message };
  }

  const summary = createEmptyMultiplayerSummary();
  const response = (data || {}) as Record<string, LeaderboardRow[]>;

  for (const category of MULTIPLAYER_LEADERBOARD_CATEGORIES) {
    summary[category] = (response[category] || []).map(mapLeaderboardRow);
  }

  return { data: summary, error: null };
}

export async function fetchMultiplayerLeaderboardPage(
  category: MultiplayerLeaderboardCategory,
  offset: number,
  limit = 30
) {
  if (!supabase) {
    return { data: null, error: "Supabase is not configured yet." };
  }

  const { data, error } = await supabase.rpc("get_multiplayer_leaderboard", {
    category,
    page_size: limit,
    page_offset: offset,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: ((data || []) as LeaderboardRow[]).map(mapLeaderboardRow),
    error: null,
  };
}

export function formatMultiplayerLeaderboardValue(
  category: MultiplayerLeaderboardCategory,
  value: number
) {
  if (category === "best_win_rate") return `${value.toFixed(1)}%`;
  if (category === "fastest_players") return `${value.toFixed(2)}s`;
  return value.toLocaleString();
}

function mapLeaderboardRow(row: LeaderboardRow): MultiplayerLeaderboardEntry {
  return {
    rank: Number(row.rank),
    userId: row.user_id,
    playerName: row.player_name || row.username || "Unknown Player",
    username: row.username,
    value: Number(row.value || 0),
    matchesPlayed: row.matches_played || 0,
    wins: row.wins || 0,
    roundsWon: row.rounds_won || 0,
    isCurrentUser: Boolean(row.is_current_user),
    totalCount: Number(row.total_count || 0),
  };
}
