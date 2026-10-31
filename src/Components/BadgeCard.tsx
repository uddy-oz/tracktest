import type { ArenaBadge } from "../lib/badges";
import BadgeEmblem from "./BadgeEmblem";
import { BadgeCheck, Clock3, Crosshair, LockKeyhole, Sparkles } from "lucide-react";
import { badgeProgress, badgeProgressLabel, badgeStateLabel, isBadgeUnavailable } from "../lib/badgeVault";

type BadgeCardProps = {
  badge: ArenaBadge;
  onSelect?: (badge: ArenaBadge) => void;
  highlight?: "tracked" | "collection";
};

function BadgeCard({ badge, onSelect, highlight }: BadgeCardProps) {
  const progress = badgeProgress(badge);
  const StateIcon = isBadgeUnavailable(badge) ? Clock3 : badge.unlocked ? BadgeCheck : LockKeyhole;

  return (
    <article
      className={`badge-card badge-${badge.accent} badge-tier-${badge.tier.toLowerCase()} ${
        badge.unlocked ? "badge-unlocked" : "badge-locked"
      } ${isBadgeUnavailable(badge) ? "badge-unavailable" : ""} ${highlight ? `badge-highlight-${highlight}` : ""} ${onSelect ? "badge-card-clickable" : ""}`}
      role={onSelect ? "button" : undefined}
      aria-label={
        onSelect
          ? `${badge.title}, ${badge.tier}, ${badgeStateLabel(badge)}. Open details.`
          : undefined
      }
      tabIndex={onSelect ? 0 : undefined}
      onClick={() => onSelect?.(badge)}
      onKeyDown={(event) => {
        if (!onSelect) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(badge);
        }
      }}
    >
      <div className="badge-topline">
        <span>{badge.category}</span>
        <strong>{badge.tier}</strong>
      </div>

      <BadgeEmblem badge={badge} />

      <div className="badge-copy">
        <h3>{badge.title}</h3>
        <p>{badge.description}</p>
      </div>

      <span className="badge-state" aria-hidden="true">
        <StateIcon size={13} />{badgeStateLabel(badge)}
        {highlight && <span className="vault-card-highlight">{highlight === "tracked" ? <Crosshair size={12} /> : <Sparkles size={12} />}{highlight === "tracked" ? "Tracking" : "Highlight"}</span>}
      </span>

      {badge.target && (
        <div className="badge-progress" aria-label={`${progress}% complete`}>
          <div>
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            {badgeProgressLabel(badge)}
          </small>
        </div>
      )}
    </article>
  );
}

export default BadgeCard;
