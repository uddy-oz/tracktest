import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getArenaBadges } from "../lib/badges";
import { fetchCloudBadgeStats } from "../lib/cloudBadgeStats";
import { getDailyGoalFoundation } from "../lib/dailyGoals";
import { fetchGlobalLeaderboard } from "../lib/globalLeaderboard";
import {
  calculatePlayerTier,
  getCompactPlayerBadges,
  type CompactPlayerBadge,
} from "../lib/playerIdentity";
import { getProfileDisplayLabel, type UserProfile } from "../lib/profiles";
import type { ArenaRoom } from "../lib/arenaRooms";
import { getTrackTestStats, type TrackTestStats } from "../lib/stats";
import ArenaActiveRoomCard from "./ArenaActiveRoomCard";
import PlayerIdentityBadges from "./PlayerIdentityBadges";

type HomePageProps = {
  session: Session | null;
  profile: UserProfile | null;
  identityBadges: CompactPlayerBadge[] | null;
  activeArenaRoom: ArenaRoom | null;
  onSinglePlayer: () => void;
  onMultiplayer: () => void;
  onLeaderboard: () => void;
  onProfile: () => void;
  onResumeArenaRoom: () => void;
  onCloseArenaRoom: (roomId: string) => Promise<string>;
};

function formatNumber(value: number) {
  return value.toLocaleString();
}

function formatDate(value: string) {
  if (!value) {
    return "Recently";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function HomePage({
  session,
  profile,
  identityBadges,
  activeArenaRoom,
  onSinglePlayer,
  onMultiplayer,
  onLeaderboard,
  onProfile,
  onResumeArenaRoom,
  onCloseArenaRoom,
}: HomePageProps) {
  const [stats, setStats] = useState<TrackTestStats>(() => getTrackTestStats());
  const [statsSource, setStatsSource] = useState<"cloud" | "local">("local");
  const [globalRank, setGlobalRank] = useState<number | null>(null);
  const [arenaMessage, setArenaMessage] = useState("");
  const [isClosingArenaRoom, setIsClosingArenaRoom] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadHomeData() {
      if (!session?.user) {
        setStats(getTrackTestStats());
        setStatsSource("local");
        setGlobalRank(null);
        return;
      }

      const [{ data }, leaderboardResult] = await Promise.all([
        fetchCloudBadgeStats(session.user).catch(() => ({ data: null })),
        fetchGlobalLeaderboard().catch(() => ({ data: null })),
      ]);

      if (!isActive) {
        return;
      }

      if (data) {
        setStats(data);
        setStatsSource("cloud");
      } else {
        setStats(getTrackTestStats());
        setStatsSource("local");
      }

      const rankIndex =
        leaderboardResult.data?.overallPoints.findIndex(
          (entry) => entry.userId === session.user.id
        ) ?? -1;

      setGlobalRank(rankIndex >= 0 ? rankIndex + 1 : null);
    }

    void loadHomeData();

    return () => {
      isActive = false;
    };
  }, [session?.user]);

  const badges = useMemo(() => getArenaBadges(stats), [stats]);
  const playerBadges =
    identityBadges || getCompactPlayerBadges(stats, badges);
  const tier = calculatePlayerTier(badges).tier;
  const featuredBadges = badges
    .filter((badge) => badge.unlocked)
    .slice(0, 3);
  const dailyGoals = getDailyGoalFoundation(stats).slice(0, 3);
  const recentResults = stats.quizResults.slice(0, 3);
  const displayName = session
    ? getProfileDisplayLabel(profile, session.user.email)
    : "Guest Player";
  const username = profile?.username ? `@${profile.username}` : "Local profile";

  async function handleCloseArenaRoom() {
    if (!activeArenaRoom) {
      return;
    }

    setIsClosingArenaRoom(true);
    const error = await onCloseArenaRoom(activeArenaRoom.id);
    setArenaMessage(error || "Arena room closed.");
    setIsClosingArenaRoom(false);
  }

  return (
    <main className="home-dashboard">
      <section className="home-hero-panel">
        <div>
          <p className="eyebrow">TrackTest Arena</p>
          <h1>Do you really know your albums?</h1>
          <p>
            Build your solo record, unlock badges, and step into Duel rooms when
            you are ready to prove it against another player.
          </p>
          <div className="hero-buttons">
            <button type="button" onClick={onSinglePlayer}>
              Start Single Player
            </button>
            <button type="button" className="secondary-button" onClick={onMultiplayer}>
              Enter Multiplayer
            </button>
          </div>
        </div>

        <aside className="home-player-card">
          <div className="home-player-topline">
            <span>Player Career</span>
            <strong>{statsSource === "cloud" ? "Cloud" : "Local"}</strong>
          </div>
          <h2>{displayName}</h2>
          <p>{username}</p>
          <PlayerIdentityBadges badges={playerBadges} />
          <div className="home-tier-row">
            <span>{tier}</span>
            <button type="button" className="secondary-button" onClick={onProfile}>
              View Profile
            </button>
          </div>
          <div className="home-player-stats">
            <span>
              Total Points
              <strong>{formatNumber(stats.overall.totalPoints)}</strong>
            </span>
            <span>
              Overall Rank
              <strong>{globalRank ? `#${globalRank}` : "Unranked"}</strong>
            </span>
            <span>
              Daily Streak
              <strong>{stats.overall.currentDailyStreak} days</strong>
            </span>
            <span>
              Best Score
              <strong>{formatNumber(stats.overall.bestScore)}</strong>
            </span>
          </div>
        </aside>
      </section>

      {activeArenaRoom && (
        <section className="home-active-room">
          <ArenaActiveRoomCard
            room={activeArenaRoom}
            currentUserId={session?.user.id}
            onResume={onResumeArenaRoom}
            onClose={() => void handleCloseArenaRoom()}
            isClosing={isClosingArenaRoom}
            compact
          />
          {arenaMessage && <p className="arena-message">{arenaMessage}</p>}
        </section>
      )}

      <section className="home-mode-grid">
        <article className="home-mode-card home-mode-solo">
          <span>Solo Career</span>
          <h2>Single Player</h2>
          <p>Play album quizzes, build stats, unlock badges.</p>
          <button type="button" onClick={onSinglePlayer}>
            Start Single Player
          </button>
        </article>

        <article className="home-mode-card home-mode-arena">
          <span>Head to Head</span>
          <h2>Multiplayer / Arena</h2>
          <p>Challenge players in Duel rooms and future lobbies.</p>
          <button type="button" onClick={onMultiplayer}>
            Enter Multiplayer
          </button>
        </article>
      </section>

      <section className="home-dashboard-grid">
        <article className="home-panel">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Recent Results</p>
              <h2>Last Sessions</h2>
            </div>
          </div>
          {recentResults.length > 0 ? (
            <div className="home-list">
              {recentResults.map((result) => (
                <div className="home-list-row" key={result.id}>
                  <span>
                    <strong>{result.albumName}</strong>
                    <small>{result.artistName} - {formatDate(result.datePlayed)}</small>
                  </span>
                  <b>{formatNumber(result.finalPoints)}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-stats">Play your first album quiz to start a record.</p>
          )}
        </article>

        <article className="home-panel">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Featured Badges</p>
              <h2>Unlocked</h2>
            </div>
          </div>
          {featuredBadges.length > 0 ? (
            <div className="home-badge-strip">
              {featuredBadges.map((badge) => (
                <span className={`home-badge-pill badge-${badge.accent}`} key={badge.id}>
                  <strong>{badge.title}</strong>
                  <small>{badge.tier}</small>
                </span>
              ))}
            </div>
          ) : (
            <p className="empty-stats">Badges unlock as your quiz record grows.</p>
          )}
        </article>

        <article className="home-panel">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Daily Goals</p>
              <h2>Today</h2>
            </div>
          </div>
          <div className="home-list">
            {dailyGoals.map((goal) => (
              <div className="home-list-row" key={goal.id}>
                <span>
                  <strong>{goal.title}</strong>
                  <small>{goal.description}</small>
                </span>
                <b>{goal.progress}/{goal.target}</b>
              </div>
            ))}
          </div>
        </article>

        <article className="home-panel home-global-preview">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Global Arena</p>
              <h2>Public Rankings</h2>
            </div>
          </div>
          <p>
            Cloud-saved quizzes feed the public leaderboard. Keep climbing from
            solo albums into Duel rooms.
          </p>
          <button type="button" className="secondary-button" onClick={onLeaderboard}>
            View Leaderboard
          </button>
        </article>
      </section>
    </main>
  );
}

export default HomePage;
