import { useEffect, useRef } from "react";
import type { ArenaBadge } from "../lib/badges";
import { sounds } from "../lib/sounds";
import BadgeEmblem from "./BadgeEmblem";

type BadgeEarnedPopupProps = {
  badge: ArenaBadge | null;
  onDone: () => void;
};

function BadgeEarnedPopup({ badge, onDone }: BadgeEarnedPopupProps) {
  const badgeId = badge?.id;
  const notified = useRef(new Set<string>());
  const completed = useRef(new Set<string>());
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!badgeId) {
      return;
    }
    if (completed.current.has(badgeId)) {
      const skipId = window.setTimeout(() => onDoneRef.current(), 0);
      return () => window.clearTimeout(skipId);
    }

    if (!notified.current.has(badgeId)) {
      notified.current.add(badgeId);
      sounds.achievement();
    }

    const timerId = window.setTimeout(() => {
      completed.current.add(badgeId);
      onDoneRef.current();
    }, 4200);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [badgeId]);

  if (!badge) {
    return null;
  }

  return (
    <aside
      key={badge.id}
      className={`badge-earned-popup badge-${badge.accent} badge-tier-${badge.tier.toLowerCase()}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <BadgeEmblem key={badge.id} badge={badge} />

      <div className="vault-reveal-copy">
        <span className="vault-reveal-eyebrow">Achievement Unlocked</span>
        <strong>{badge.title}</strong>
        <small>
          {badge.category} <span className="vault-reveal-tier">{badge.tier}</span>
        </small>
      </div>
    </aside>
  );
}

export default BadgeEarnedPopup;
