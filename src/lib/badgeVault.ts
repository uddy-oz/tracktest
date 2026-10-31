import type { ArenaBadge } from "./badges";
export const BADGE_TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Legendary"] as const;
export const BADGE_CATEGORIES = ["Skill", "Artist Mastery", "Daily Streak", "Winning Streak", "Arena 1v1", "Arena Lobby", "Party Mode", "Championship"] as const;
export type VaultStatus = "all" | "unlocked" | "locked" | "progress" | "complete" | "unavailable";
export type VaultSort = "collection" | "newest" | "closest" | "tier" | "alphabetical";
export function badgeUnavailableReason(badge: ArenaBadge) {
  if (badge.unlocked) return null;
  if (badge.category === "Championship") return "Championship gameplay is coming later.";
  if (badge.id === "party-starter" && !badge.trackingAvailable) return "Host achievement tracking requires the achievement ledger migration.";
  return null;
}
export function isBadgeUnavailable(badge: ArenaBadge) { return Boolean(badgeUnavailableReason(badge)); }
export function badgeProgress(badge: ArenaBadge) {
  if (badge.unlocked) return 100;
  if (isBadgeUnavailable(badge)) return 0;
  if (["quick-hands", "speed-demon"].includes(badge.id)) return 0;
  const value = Number.isFinite(badge.progress) ? Math.max(0, badge.progress!) : 0;
  const target = Number.isFinite(badge.target) && badge.target! > 0 ? badge.target! : 1;
  // Composite conditions must also pass before a numerical threshold means completion.
  return Math.min(99, Math.floor(value / target * 100));
}
export function badgeStateLabel(badge: ArenaBadge) { return badge.category === "Championship" ? (badge.unlocked ? "Legacy unlocked / Coming Soon" : "Coming Soon") : badge.unlocked ? "Unlocked" : isBadgeUnavailable(badge) ? "Unavailable" : "Locked"; }
export function achievableCollection(badges: ArenaBadge[]) {
  const available = badges.filter(b => b.category !== "Championship" && !isBadgeUnavailable(b));
  const unlocked = available.filter(b => b.unlocked).length;
  return { unlocked, total: available.length, completion: available.length ? Math.round(unlocked / available.length * 100) : 0 };
}
export function badgeProgressLabel(badge: ArenaBadge) {
  if (badge.unlocked) return "Completed";
  if (isBadgeUnavailable(badge)) return "Tracking unavailable";
  if (["quick-hands", "speed-demon", "artist-master", "album-specialist"].includes(badge.id)) return "Multiple requirements - see details";
  return `${Number.isFinite(badge.progress) ? Math.max(0, badge.progress!) : 0} / ${badge.target || 1}`;
}
export function selectVaultBadges(badges: ArenaBadge[], options: { category?: string; tier?: string; status?: VaultStatus; sort?: VaultSort; search?: string }) {
  const query = options.search?.trim().toLowerCase() || "";
  return badges.filter(b => (!options.category || b.category === options.category) && (!options.tier || b.tier === options.tier)
    && (!query || `${b.title} ${b.description}`.toLowerCase().includes(query))
    && (!options.status || options.status === "all"
      || (["unlocked", "complete"].includes(options.status) && b.unlocked)
      || (options.status === "locked" && !b.unlocked && !isBadgeUnavailable(b))
      || (options.status === "progress" && !b.unlocked && !isBadgeUnavailable(b) && badgeProgress(b) > 0)
      || (options.status === "unavailable" && isBadgeUnavailable(b))))
    .sort((a,b) => {
      if (options.sort === "collection") return Number(b.unlocked)-Number(a.unlocked) || Number(isBadgeUnavailable(a))-Number(isBadgeUnavailable(b)) || BADGE_TIERS.indexOf(b.tier)-BADGE_TIERS.indexOf(a.tier) || a.title.localeCompare(b.title);
      if (options.sort === "closest") {
        const state = (x: ArenaBadge) => isBadgeUnavailable(x) ? 2 : x.unlocked ? 1 : 0;
        return state(a)-state(b) || badgeProgress(b)-badgeProgress(a) || a.title.localeCompare(b.title);
      }
      if (options.sort === "tier") return BADGE_TIERS.indexOf(b.tier)-BADGE_TIERS.indexOf(a.tier) || a.title.localeCompare(b.title);
      if (options.sort === "newest") {
        const date = (b: ArenaBadge) => b.awardProvenance === "server_verified" && b.unlockedAt && Number.isFinite(Date.parse(b.unlockedAt)) ? Date.parse(b.unlockedAt) : 0;
        return date(b)-date(a) || a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
}
const trackingKey = (id: string) => `stanzer.badge-vault.tracked.v1:${id}`;
export function readTrackedBadge(userId: string | undefined, badges: ArenaBadge[]) {
  if (!userId) return null;
  try { const id=localStorage.getItem(trackingKey(userId)); return badges.some(b=>b.id===id && !b.unlocked && !isBadgeUnavailable(b)) ? id : null; } catch { return null; }
}
export function writeTrackedBadge(userId: string | undefined, id: string | null) {
  if (!userId) return false;
  try { if(id) localStorage.setItem(trackingKey(userId),id); else localStorage.removeItem(trackingKey(userId)); return true; } catch { return false; }
}
