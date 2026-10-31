import { supabase } from "./supabaseClient";
import { parseAchievementState } from "./achievementRecords";

export async function fetchAchievementState(userId: string, reconcileOwner = false) {
  if (!supabase) return { records: [], available: false };
  const { data, error } = reconcileOwner
    ? await supabase.rpc("sync_my_achievements")
    : await supabase.rpc("get_achievement_state", { target_user_id: userId });
  if (error) return { records: [], available: false };
  return parseAchievementState(data, userId);
}
