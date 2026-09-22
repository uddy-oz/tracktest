import { supabase } from "./supabaseClient";

export async function resetCurrentUserProgress() {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { data, error } = await supabase.rpc("reset_my_stanzer_progress");

  return {
    reset: data === true,
    error: error?.message || null,
  };
}
