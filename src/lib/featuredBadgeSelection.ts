export function sanitizeFeaturedBadgeIds(badgeIds: string[], unlockedBadgeIds: Set<string>) {
  const selected = new Set<string>();
  badgeIds.forEach(badgeId => {
    if (selected.size < 6 && unlockedBadgeIds.has(badgeId)) selected.add(badgeId);
  });
  return [...selected];
}
