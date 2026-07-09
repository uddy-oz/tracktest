import BadgeCard from "./BadgeCard";
import type { ArenaBadge, BadgeCategory } from "../lib/badges";

type BadgeGridProps = {
  badges: ArenaBadge[];
  recentBadge?: ArenaBadge;
};

const categoryOrder: BadgeCategory[] = [
  "Skill",
  "Artist Mastery",
  "Daily Streak",
  "Winning Streak",
  "Arena 1v1",
  "Arena Lobby",
  "Party Mode",
  "Championship",
];

function BadgeGrid({ badges, recentBadge }: BadgeGridProps) {
  const unlockedCount = badges.filter((badge) => badge.unlocked).length;

  return (
    <section className="badge-section">
      <div className="badge-section-header">
        <div>
          <p className="eyebrow">Arena Achievements</p>
          <h2>Badge Collection</h2>
        </div>
        <span>
          {unlockedCount} / {badges.length} unlocked
        </span>
      </div>

      {recentBadge && (
        <div className="badge-earned">
          <span>Badge earned</span>
          <strong>{recentBadge.title}</strong>
          <small>{recentBadge.tier} achievement unlocked</small>
        </div>
      )}

      {categoryOrder.map((category) => {
        const categoryBadges = badges.filter(
          (badge) => badge.category === category
        );

        if (categoryBadges.length === 0) {
          return null;
        }

        return (
          <div className="badge-category" key={category}>
            <h3>{category}</h3>
            <div className="badge-grid">
              {categoryBadges.map((badge) => (
                <BadgeCard badge={badge} key={badge.id} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default BadgeGrid;
