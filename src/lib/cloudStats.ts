import type { User } from "@supabase/supabase-js";
import type { QuizResult, TrackTestStats } from "./stats";
import { getTrackTestStats } from "./stats";
import { supabase } from "./supabaseClient";

export async function saveQuizResultToCloud(
  user: User,
  result: QuizResult
) {
  void user;
  void result;

  if (!supabase) {
    return { ok: false, reason: "Supabase is not configured yet." };
  }

  return {
    ok: false,
    reason: "Cloud quiz saving needs Supabase tables and RLS policies first.",
  };
}

export async function syncLocalStatsToCloud(user: User) {
  void user;

  if (!supabase) {
    return { ok: false, reason: "Supabase is not configured yet." };
  }

  const localStats = getTrackTestStats();
  void localStats;

  return {
    ok: false,
    reason: "Cloud sync needs Supabase tables and RLS policies first.",
  };
}

export async function fetchUserStats(
  user: User
): Promise<{ data: TrackTestStats | null; error: string | null }> {
  void user;

  if (!supabase) {
    return { data: null, error: "Supabase is not configured yet." };
  }

  return {
    data: null,
    error: "Cloud stats fetching needs Supabase tables and RLS policies first.",
  };
}
