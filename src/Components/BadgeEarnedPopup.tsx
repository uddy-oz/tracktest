import { useEffect } from "react";
import type { ArenaBadge } from "../lib/badges";
import { sounds } from "../lib/sounds";

type BadgeEarnedPopupProps = {
  badge: ArenaBadge | null;
  onDone: () => void;
};

const iconSymbols: Record<ArenaBadge["icon"], string> = {
  checkRing: "OK",
  diamond: "<>",
  bolt: "Z",
  record: "O",
  crown: "W",
  discs: "OO",
  calendar: "[]",
  flame: "^",
  trophy: "T",
  shield: "H",
  star: "*",
  clutch: "<",
  swords: "X",
  users: "U",
  party: "+",
  comeback: "R",
  target: "@",
  headphones: "HP",
  stack: "III",
  key: "K",
};

function BadgeEarnedPopup({ badge, onDone }: BadgeEarnedPopupProps) {
  useEffect(() => {
    if (!badge) {
      return;
    }

    sounds.achievement();

    const timerId = window.setTimeout(onDone, 4200);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [badge, onDone]);

  if (!badge) {
    return null;
  }

  return (
    <aside
      className={`badge-earned-popup badge-${badge.accent} badge-tier-${badge.tier.toLowerCase()}`}
      aria-live="polite"
    >
      <div className={`badge-earned-popup-icon badge-icon-${badge.icon}`}>
        <span>{iconSymbols[badge.icon]}</span>
      </div>

      <div>
        <span>Achievement Unlocked</span>
        <strong>{badge.title}</strong>
        <small>
          {badge.category} - {badge.tier}
        </small>
      </div>
    </aside>
  );
}

export default BadgeEarnedPopup;
