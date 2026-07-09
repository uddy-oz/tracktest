import type { ArenaBadge } from "../lib/badges";

type BadgeCardProps = {
  badge: ArenaBadge;
};

const iconSymbols: Record<ArenaBadge["icon"], string> = {
  checkRing: "✓",
  diamond: "◆",
  bolt: "↯",
  record: "◉",
  crown: "♕",
  discs: "◎",
  calendar: "□",
  flame: "▲",
  trophy: "♛",
  shield: "⬟",
  star: "✦",
  clutch: "◇",
  swords: "×",
  users: "●",
  party: "✧",
  comeback: "↺",
  target: "⊙",
};

function BadgeCard({ badge }: BadgeCardProps) {
  const progress =
    badge.progress !== undefined && badge.target
      ? Math.min(100, Math.round((badge.progress / badge.target) * 100))
      : badge.unlocked
        ? 100
        : 0;

  return (
    <article
      className={`badge-card badge-${badge.accent} badge-tier-${badge.tier.toLowerCase()} ${
        badge.unlocked ? "badge-unlocked" : "badge-locked"
      }`}
    >
      <div className="badge-topline">
        <span>{badge.category}</span>
        <strong>{badge.tier}</strong>
      </div>

      <div className={`badge-icon badge-icon-${badge.icon}`} aria-hidden="true">
        <span>{iconSymbols[badge.icon]}</span>
      </div>

      <div className="badge-copy">
        <h3>{badge.title}</h3>
        <p>{badge.description}</p>
      </div>

      {badge.target && (
        <div className="badge-progress" aria-label={`${progress}% complete`}>
          <div>
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            {badge.unlocked
              ? "Unlocked"
              : `${badge.progress || 0} / ${badge.target}`}
          </small>
        </div>
      )}
    </article>
  );
}

export default BadgeCard;
