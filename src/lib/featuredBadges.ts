import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

const FEATURED_BADGES_STORAGE_KEY = "tracktest_arena_featured_badges_v1";
const MAX_FEATURED_BADGES = 6;

type FeaturedBadgeStore = Record<string, string[]>;

export function sanitizeFeaturedBadgeIds(
  badgeIds: string[],
  unlockedBadgeIds: Set<string>
) {
  const selected = new Set<string>();

  badgeIds.forEach((badgeId) => {
    if (selected.size < MAX_FEATURED_BADGES && unlockedBadgeIds.has(badgeId)) {
      selected.add(badgeId);
    }
  });

  return [...selected];
}

export function getLocalFeaturedBadgeIds(username?: string | null) {
  if (!username) {
    return [];
  }

  try {
    const storedValue = localStorage.getItem(FEATURED_BADGES_STORAGE_KEY);

    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue) as FeaturedBadgeStore;
    const badgeIds = parsedValue[username.toLowerCase()];

    return Array.isArray(badgeIds) ? badgeIds.slice(0, MAX_FEATURED_BADGES) : [];
  } catch (error) {
    console.error("Could not load featured badges:", error);
    return [];
  }
}

export function setLocalFeaturedBadgeIds(
  username: string | null | undefined,
  badgeIds: string[]
) {
  if (!username) {
    return;
  }

  try {
    const storedValue = localStorage.getItem(FEATURED_BADGES_STORAGE_KEY);
    const parsedValue = storedValue
      ? (JSON.parse(storedValue) as FeaturedBadgeStore)
      : {};
    const normalizedUsername = username.toLowerCase();

    if (badgeIds.length === 0) {
      delete parsedValue[normalizedUsername];
    } else {
      parsedValue[normalizedUsername] = badgeIds.slice(0, MAX_FEATURED_BADGES);
    }

    localStorage.setItem(
      FEATURED_BADGES_STORAGE_KEY,
      JSON.stringify(parsedValue)
    );
  } catch (error) {
    console.error("Could not save featured badges:", error);
  }
}

export async function fetchCurrentUserFeaturedBadgeIds(
  user: User,
  username?: string | null
) {
  if (!supabase) {
    return {
      badgeIds: getLocalFeaturedBadgeIds(username),
      error: "Supabase is not configured yet.",
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("featured_badge_ids")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return {
      badgeIds: getLocalFeaturedBadgeIds(username),
      error: error.message,
    };
  }

  const badgeIds = Array.isArray(data?.featured_badge_ids)
    ? data.featured_badge_ids
    : getLocalFeaturedBadgeIds(username);

  return {
    badgeIds,
    error: null,
  };
}

export async function saveCurrentUserFeaturedBadgeIds({
  user,
  username,
  badgeIds,
}: {
  user: User;
  username?: string | null;
  badgeIds: string[];
}) {
  setLocalFeaturedBadgeIds(username, badgeIds);

  if (!supabase) {
    return { error: "Supabase is not configured yet. Saved locally." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      featured_badge_ids: badgeIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  return { error: error?.message || null };
}
