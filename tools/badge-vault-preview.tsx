// Development-only design fixture. Not an application route or a production build entry.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import BadgeEarnedPopup from "../src/Components/BadgeEarnedPopup";
import BadgeGrid from "../src/Components/BadgeGrid";
import { getArenaBadges } from "../src/lib/badges";
import { createEmptyTrackTestStats } from "../src/lib/stats";
import "../src/index.css";

const stats = createEmptyTrackTestStats();
stats.overall.totalQuestionsAnswered = 78;
stats.overall.currentDailyStreak = 4;
stats.arena.wins = 4;
stats.arena.bestWinStreak = 2;
stats.arena.duelWins = 2;
stats.arena.cleanSheets = 1;
stats.albums.fixture = { albumName: "Design fixture", artistName: "Demo artist", timesPlayed: 3, bestScore: 8000, bestAccuracy: 100, lastPlayedDate: "2026-10-29" };
document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
export default function Preview() {
  const guestPreview = new URLSearchParams(location.search).get("guest") === "1";
  const [resetStreak, setResetStreak] = useState(false);
  const badges = getArenaBadges(guestPreview ? createEmptyTrackTestStats() : { ...stats,
    overall: { ...stats.overall, currentDailyStreak: resetStreak ? 0 : stats.overall.currentDailyStreak },
    achievementLedgerAvailable: true,
    achievementRecords: [{ badgeId: "seven-day-locked-in", awardedAt: null, provenance: "legacy_preserved" },
      { badgeId: "three-day-listener", awardedAt: null, provenance: "legacy_preserved" }],
  });
  const [queue, setQueue] = useState<typeof badges>([]);
  return <main style={{ maxWidth: 1240, margin: "auto", padding: "24px 16px" }}><p className="eyebrow">StanZer / Local design preview / Sample progress only</p><button className="secondary-button" onClick={() => setQueue(badges.filter(b => b.unlocked).slice(0,2))}>Preview unlock reveal</button><button className="secondary-button" onClick={() => setResetStreak(v => !v)}>{resetStreak ? "Restore sample streak" : "Simulate streak reset"}</button><BadgeGrid badges={badges} ownerId={guestPreview ? undefined : "design-preview-only"} /><BadgeEarnedPopup badge={queue[0] || null} onDone={() => setQueue(q => q.slice(1))} /></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
