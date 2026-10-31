import type { ArenaBadge } from "./badges";

export type AchievementRecord = {
  badgeId: string;
  awardedAt: string | null;
  provenance: "server_verified" | "legacy_preserved";
};
export function parseAchievementState(value: unknown, expectedUserId: string) {
  if (!value || typeof value !== "object") return { records: [] as AchievementRecord[], available: false };
  const state = value as { schemaVersion?: number; userId?: string; records?: unknown };
  // A reconcile response can arrive after the authenticated account has changed.
  if (state.schemaVersion !== 1 || state.userId !== expectedUserId || !Array.isArray(state.records)) {
    return { records: [] as AchievementRecord[], available: false };
  }
  return { records: parseAchievementRecords(state.records), available: true };
}

export function parseAchievementRecords(value: unknown): AchievementRecord[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<string, AchievementRecord>();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.badgeId !== "string" || !["server_verified", "legacy_preserved"].includes(String(r.provenance))) continue;
    const date = r.provenance === "server_verified" && typeof r.awardedAt === "string" && Number.isFinite(Date.parse(r.awardedAt)) ? r.awardedAt : null;
    if (r.provenance === "server_verified" && !date) continue;
    const record: AchievementRecord = { badgeId: r.badgeId, awardedAt: date, provenance: r.provenance as AchievementRecord["provenance"] };
    if (!records.has(record.badgeId) || (records.get(record.badgeId)?.provenance === "legacy_preserved" && record.provenance === "server_verified")) records.set(record.badgeId, record);
  }
  return [...records.values()];
}

export function mergeAchievementRecords(badges: ArenaBadge[], records: AchievementRecord[]): ArenaBadge[] {
  const byId = new Map(parseAchievementRecords(records).map(r => [r.badgeId, r]));
  return badges.map(badge => {
    const award = byId.get(badge.id);
    return award ? { ...badge, unlocked: true, unlockedAt: award.awardedAt || undefined, awardProvenance: award.provenance } : badge;
  });
}

const legacyKey = (userId: string) => `stanzer.achievement-preservation.v1:${userId}`;
export function readPreservedAchievements(userId: string): AchievementRecord[] {
  try {
    // Browser observations never become server-verified records, even if storage is edited.
    return parseAchievementRecords(JSON.parse(localStorage.getItem(legacyKey(userId)) || "[]"))
      .map(r => ({ ...r, awardedAt: null, provenance: "legacy_preserved" }));
  } catch { return []; }
}
export function preserveObservedAchievements(userId: string, badges: ArenaBadge[]) {
  const previous = readPreservedAchievements(userId);
  const combined = parseAchievementRecords([...previous, ...badges.filter(b => b.unlocked).map(b => ({ badgeId: b.id, awardedAt: null, provenance: "legacy_preserved" }))]);
  try { localStorage.setItem(legacyKey(userId), JSON.stringify(combined)); } catch { /* Cloud awards remain authoritative if local storage is unavailable. */ }
  return combined;
}

export function achievementDateLabel(badge: ArenaBadge) {
  if (badge.awardProvenance === "server_verified" && badge.unlockedAt && Number.isFinite(Date.parse(badge.unlockedAt))) {
    return `Awarded ${new Date(badge.unlockedAt).toLocaleString()}`;
  }
  return badge.awardProvenance === "legacy_preserved" ? "Legacy achievement preserved. Original unlock date is unknown." : "Unlock date not recorded.";
}
