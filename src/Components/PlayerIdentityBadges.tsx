import type { CompactPlayerBadge } from "../lib/playerIdentity";

type PlayerIdentityBadgesProps = {
  badges: CompactPlayerBadge[];
  compact?: boolean;
};

function PlayerIdentityBadges({ badges, compact = false }: PlayerIdentityBadgesProps) {
  if (badges.length === 0) {
    return null;
  }

  return (
    <span className={`player-identity-badges ${compact ? "compact" : ""}`}>
      {badges.slice(0, 3).map((badge) => (
        <span
          className={`player-identity-badge identity-${badge.kind} ${
            badge.tier ? `identity-tier-${badge.tier.toLowerCase()}` : ""
          }`}
          title={badge.title}
          key={badge.id}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

export default PlayerIdentityBadges;
