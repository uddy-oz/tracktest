import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  fetchGlobalLeaderboard,
  type GlobalLeaderboardData,
} from "../lib/globalLeaderboard";
import { fetchCloudBadgeStats } from "../lib/cloudBadgeStats";
import BadgeGrid from "./BadgeGrid";
import { getArenaBadges, getRecentUnlockedBadge } from "../lib/badges";
import { getDailyGoalFoundation, type DailyGoal } from "../lib/dailyGoals";
import PlayerIdentityBadges from "./PlayerIdentityBadges";
import {
  getCompactPlayerBadges,
  getRankFormBadge,
  type CompactPlayerBadge,
} from "../lib/playerIdentity";
import { clearTrackTestStats, getTrackTestStats } from "../lib/stats";

type LeaderboardProps = {
  onPlay: () => void;
  session: Session | null;
  onOpenProfile: (username: string) => void;
  progressionRevision?: number;
};

type LeaderboardTab = "global" | "myStats";
const LEADERBOARD_SECTION_LIMIT = 6;
const RECENT_RESULTS_LIMIT = 5;

function formatNumber(value: number) {
  return value.toLocaleString();
}

function formatSeconds(value: number) {
  return `${value.toFixed(1)}s`;
}

function formatStreak(days: number) {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getRankingClass(index: number) {
  const rank = index + 1;

  if (rank === 1) return "rank-first";
  if (rank === 2) return "rank-second";
  if (rank === 3) return "rank-third";
  if (rank <= 5) return "rank-top-five";
  return "rank-top-ten";
}

function getLeaderboardRowClass(
  index: number,
  userId: string,
  currentUserId?: string
) {
  return `leaderboard-list-row ${getRankingClass(index)} ${
    userId === currentUserId ? "leaderboard-current-user" : ""
  }`;
}

function PlayerLabel({
  playerName,
  username,
  badges = [],
  onOpenProfile,
}: {
  playerName: string;
  username: string | null;
  badges?: CompactPlayerBadge[];
  onOpenProfile?: (username: string) => void;
}) {
  const label = username ? `${playerName} (@${username})` : playerName;
  const nameContent =
    username && onOpenProfile ? (
      <button
        type="button"
        className="player-profile-link"
        onClick={() => onOpenProfile(username)}
      >
        {label}
      </button>
    ) : (
      <span>{label}</span>
    );

  return (
    <span className="player-label">
      {nameContent}
      <PlayerIdentityBadges badges={badges} compact />
    </span>
  );
}

function LimitNote({
  total,
  limit,
  label,
}: {
  total: number;
  limit: number;
  label: string;
}) {
  if (total <= limit) {
    return null;
  }

  return <p className="leaderboard-limit-note">{label}</p>;
}

function Leaderboard({
  onPlay,
  session,
  onOpenProfile,
  progressionRevision = 0,
}: LeaderboardProps) {
  const [activeTab, setActiveTab] = useState<LeaderboardTab>("global");
  const [stats, setStats] = useState(getTrackTestStats);
  const [globalData, setGlobalData] = useState<GlobalLeaderboardData | null>(
    null
  );
  const [globalError, setGlobalError] = useState("");
  const [isGlobalLoading, setIsGlobalLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadGlobalLeaderboard() {
      setIsGlobalLoading(true);
      setGlobalError("");

      const [{ data, error }, cloudStats] = await Promise.all([
        fetchGlobalLeaderboard(),
        session?.user
          ? fetchCloudBadgeStats(session.user)
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (!isActive) {
        return;
      }

      setGlobalData(data);
      setGlobalError(error || "");
      setStats(cloudStats.data || getTrackTestStats());
      setIsGlobalLoading(false);
    }

    void loadGlobalLeaderboard();

    return () => {
      isActive = false;
    };
  }, [progressionRevision, session?.user]);

  const artists = Object.values(stats.artists);
  const albums = Object.values(stats.albums);
  const topArtists = [...artists]
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        b.accuracy - a.accuracy ||
        b.quizzesPlayed - a.quizzesPlayed
    )
    .slice(0, LEADERBOARD_SECTION_LIMIT);
  const topAlbums = [...albums]
    .sort(
      (a, b) =>
        b.bestScore - a.bestScore ||
        b.bestAccuracy - a.bestAccuracy ||
        b.timesPlayed - a.timesPlayed
    )
    .slice(0, LEADERBOARD_SECTION_LIMIT);
  const recentResults = stats.quizResults.slice(0, RECENT_RESULTS_LIMIT);
  const badges = getArenaBadges(stats);
  const recentBadge = getRecentUnlockedBadge(badges);
  const playerBadges = getCompactPlayerBadges(stats, badges);
  const dailyGoals = getDailyGoalFoundation(stats);

  function handleClearStats() {
    const shouldClear = window.confirm(
      "Clear all local StanZer stats on this device?"
    );

    if (!shouldClear) {
      return;
    }

    clearTrackTestStats();
    setStats(getTrackTestStats());
  }

  return (
    <section className="leaderboard-page">
      <div className="leaderboard-header">
        <p className="eyebrow">StanZer</p>
        <h1>{activeTab === "global" ? "Global Arena" : "Your Local Stats"}</h1>
        <p>
          Public Arena rankings use cloud quiz results and profile names. Emails
          are never shown here.
        </p>
        <p className="cloud-sync-message">
          {session
            ? "Signed in. Your completed cloud-saved quizzes can appear in Global Arena."
            : "Log in to save your stats across devices. Local stats are stored on this browser."}
        </p>

        <div className="leaderboard-tabs" role="tablist">
          <button
            type="button"
            className={activeTab === "global" ? "active" : ""}
            onClick={() => setActiveTab("global")}
          >
            Global Arena
          </button>
          <button
            type="button"
            className={activeTab === "myStats" ? "active" : ""}
            onClick={() => setActiveTab("myStats")}
          >
            My Stats
          </button>
        </div>

        <button type="button" onClick={onPlay}>
          Back Home
        </button>
      </div>

      {activeTab === "global" ? (
        <GlobalArena
          data={globalData}
          error={globalError}
          isLoading={isGlobalLoading}
          onOpenProfile={onOpenProfile}
          currentUserId={session?.user.id}
        />
      ) : (
        <MyStats
          stats={stats}
          topArtists={topArtists}
          topAlbums={topAlbums}
          recentResults={recentResults}
          artistTotalCount={artists.length}
          albumTotalCount={albums.length}
          recentTotalCount={stats.quizResults.length}
          badges={badges}
          recentBadge={recentBadge}
          playerBadges={playerBadges}
          dailyGoals={dailyGoals}
          onClearStats={handleClearStats}
        />
      )}
    </section>
  );
}

function GlobalArena({
  data,
  error,
  isLoading,
  onOpenProfile,
  currentUserId,
}: {
  data: GlobalLeaderboardData | null;
  error: string;
  isLoading: boolean;
  onOpenProfile: (username: string) => void;
  currentUserId?: string;
}) {
  if (isLoading) {
    return <p className="empty-stats">Loading StanZer rankings...</p>;
  }

  if (error) {
    return <p className="empty-stats">StanZer rankings unavailable: {error}</p>;
  }

  if (!data) {
    return <p className="empty-stats">No StanZer leaderboard data yet.</p>;
  }

  return (
    <>
      <div className="leaderboard-sections global-leaderboard-sections">
        <div className="leaderboard-panel leaderboard-panel-overall">
          <h2>Overall Points</h2>
          {data.overallPoints.length > 0 ? (
            <div className="leaderboard-list">
              {data.overallPoints.map((entry, index) => (
                <div
                  className={getLeaderboardRowClass(
                    index,
                    entry.userId,
                    currentUserId
                  )}
                  key={entry.userId}
                >
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>
                      <PlayerLabel
                        playerName={entry.playerName}
                        username={entry.username}
                        onOpenProfile={onOpenProfile}
                        badges={
                          getRankFormBadge(index + 1)
                            ? [getRankFormBadge(index + 1)!]
                            : []
                        }
                      />
                    </strong>
                    <span>{entry.quizzesPlayed} quizzes played</span>
                  </div>
                  <span>{formatNumber(entry.totalPoints)} pts</span>
                  <span>{entry.averageAccuracy}% avg</span>
                </div>
              ))}
            </div>
          ) : (
            <p>No cloud quiz scores yet.</p>
          )}
        </div>

        <div className="leaderboard-panel leaderboard-panel-accuracy">
          <h2>Best Accuracy</h2>
          {data.bestAccuracy.length > 0 ? (
            <div className="leaderboard-list">
              {data.bestAccuracy.map((entry, index) => (
                <div
                  className={getLeaderboardRowClass(
                    index,
                    entry.userId,
                    currentUserId
                  )}
                  key={entry.userId}
                >
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>
                      <PlayerLabel
                        playerName={entry.playerName}
                        username={entry.username}
                        onOpenProfile={onOpenProfile}
                        badges={
                          getRankFormBadge(index + 1)
                            ? [getRankFormBadge(index + 1)!]
                            : []
                        }
                      />
                    </strong>
                    <span>
                      {entry.quizzesPlayed} quizzes, {entry.totalQuestions} questions
                    </span>
                  </div>
                  <span>{entry.accuracy}%</span>
                  <span>{formatNumber(entry.totalPoints)} pts</span>
                </div>
              ))}
            </div>
          ) : (
            <p>Players need at least 3 quizzes and 20 questions to qualify.</p>
          )}
        </div>

        <div className="leaderboard-panel leaderboard-panel-albums">
          <h2>Best Album Scores</h2>
          {data.bestAlbumScores.length > 0 ? (
            <div className="leaderboard-list">
              {data.bestAlbumScores
                .slice(0, LEADERBOARD_SECTION_LIMIT)
                .map((entry, index) => (
                <div
                  className={getLeaderboardRowClass(
                    index,
                    entry.userId,
                    currentUserId
                  )}
                  key={`${entry.userId}-${entry.artistName}-${entry.albumName}`}
                >
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>{entry.albumName}</strong>
                    <span>
                      {entry.artistName} -{" "}
                      <PlayerLabel
                        playerName={entry.playerName}
                        username={entry.username}
                        onOpenProfile={onOpenProfile}
                        badges={
                          getRankFormBadge(index + 1)
                            ? [getRankFormBadge(index + 1)!]
                            : []
                        }
                      />
                    </span>
                  </div>
                  <span>{formatNumber(entry.bestScore)} pts</span>
                  <span>{entry.bestAccuracy}%</span>
                </div>
              ))}
              <LimitNote
                total={data.bestAlbumScores.length}
                limit={LEADERBOARD_SECTION_LIMIT}
                label={`Showing top ${LEADERBOARD_SECTION_LIMIT}`}
              />
            </div>
          ) : (
            <p>Album records will appear after cloud-saved quizzes.</p>
          )}
        </div>

        <div className="leaderboard-panel leaderboard-panel-artists">
          <h2>Artist Masters</h2>
          {data.artistMasters.length > 0 ? (
            <div className="leaderboard-list">
              {data.artistMasters
                .slice(0, LEADERBOARD_SECTION_LIMIT)
                .map((entry, index) => (
                <div
                  className={getLeaderboardRowClass(
                    index,
                    entry.userId,
                    currentUserId
                  )}
                  key={`${entry.userId}-${entry.artistName}`}
                >
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>{entry.artistName}</strong>
                    <span>
                      <PlayerLabel
                        playerName={entry.playerName}
                        username={entry.username}
                        onOpenProfile={onOpenProfile}
                        badges={
                          getRankFormBadge(index + 1)
                            ? [getRankFormBadge(index + 1)!]
                            : []
                        }
                      />
                    </span>
                  </div>
                  <span>{formatNumber(entry.totalPoints)} pts</span>
                  <span>{entry.accuracy}%</span>
                </div>
              ))}
              <LimitNote
                total={data.artistMasters.length}
                limit={LEADERBOARD_SECTION_LIMIT}
                label={`Showing top ${LEADERBOARD_SECTION_LIMIT}`}
              />
            </div>
          ) : (
            <p>Artist mastery rankings will appear after cloud stats save.</p>
          )}
        </div>
      </div>

      <div className="recent-results">
        <h2>Recent Perfect Runs</h2>
        {data.recentPerfectRuns.length > 0 ? (
          <div className="results-table">
            {data.recentPerfectRuns
              .slice(0, RECENT_RESULTS_LIMIT)
              .map((entry) => (
              <div
                className={`result-row ${
                  entry.userId === currentUserId
                    ? "leaderboard-current-user"
                    : ""
                }`}
                key={entry.id}
              >
                <div>
                  <strong>{entry.albumName}</strong>
                  <span>
                    {entry.artistName} -{" "}
                    <PlayerLabel
                      playerName={entry.playerName}
                      username={entry.username}
                      onOpenProfile={onOpenProfile}
                      badges={[]}
                    />
                  </span>
                </div>
                <span>{formatNumber(entry.finalPoints)} pts</span>
                <span>{formatDate(entry.playedAt)}</span>
              </div>
            ))}
            <LimitNote
              total={data.recentPerfectRuns.length}
              limit={RECENT_RESULTS_LIMIT}
              label={`Showing latest ${RECENT_RESULTS_LIMIT}`}
            />
          </div>
        ) : (
          <p className="empty-stats">No perfect runs have hit the Arena yet.</p>
        )}
      </div>
    </>
  );
}

function MyStats({
  stats,
  topArtists,
  topAlbums,
  recentResults,
  artistTotalCount,
  albumTotalCount,
  recentTotalCount,
  badges,
  recentBadge,
  playerBadges,
  dailyGoals,
  onClearStats,
}: {
  stats: ReturnType<typeof getTrackTestStats>;
  topArtists: ReturnType<typeof getTrackTestStats>["artists"][string][];
  topAlbums: ReturnType<typeof getTrackTestStats>["albums"][string][];
  recentResults: ReturnType<typeof getTrackTestStats>["quizResults"];
  artistTotalCount: number;
  albumTotalCount: number;
  recentTotalCount: number;
  badges: ReturnType<typeof getArenaBadges>;
  recentBadge: ReturnType<typeof getRecentUnlockedBadge>;
  playerBadges: CompactPlayerBadge[];
  dailyGoals: DailyGoal[];
  onClearStats: () => void;
}) {
  return (
    <>
      <section className="player-identity-panel">
        <div>
          <p className="eyebrow">Player Identity</p>
          <h2>Arena Identity Badges</h2>
          <p>
            Up to three compact badges can sit beside your username: player tier,
            current form, and active streak.
          </p>
        </div>
        <PlayerIdentityBadges badges={playerBadges} />
      </section>

      <BadgeGrid badges={badges} recentBadge={recentBadge} />

      <section className="daily-goals-panel">
        <div className="badge-section-header">
          <div>
            <p className="eyebrow">Daily Goals</p>
            <h2>Goal Foundation</h2>
          </div>
          <span>Frontend-ready</span>
        </div>

        <div className="daily-goal-list">
          {dailyGoals.map((goal) => {
            const progress = Math.min(
              100,
              Math.round((goal.progress / goal.target) * 100)
            );

            return (
              <article
                className={`daily-goal ${goal.complete ? "complete" : ""}`}
                key={goal.id}
              >
                <div>
                  <strong>{goal.title}</strong>
                  <span>
                    {goal.mode} - {goal.description}
                  </span>
                </div>
                <div className="badge-progress">
                  <div>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <small>
                    {goal.progress} / {goal.target}
                  </small>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="leaderboard-grid">
        <div className="stat-card">
          <span>Total Points</span>
          <strong>{formatNumber(stats.overall.totalPoints)}</strong>
        </div>

        <div className="stat-card">
          <span>Current Streak</span>
          <strong>{formatStreak(stats.overall.currentDailyStreak)}</strong>
        </div>

        <div className="stat-card">
          <span>Best Quiz Score</span>
          <strong>{formatNumber(stats.overall.bestScore)}</strong>
        </div>

        <div className="stat-card">
          <span>Overall Accuracy</span>
          <strong>{stats.overall.overallAccuracy}%</strong>
        </div>

        <div className="stat-card">
          <span>Quizzes Played</span>
          <strong>{stats.overall.totalQuizzesPlayed}</strong>
        </div>

        <div className="stat-card">
          <span>Average Answer Time</span>
          <strong>{formatSeconds(stats.overall.averageAnswerTime)}</strong>
        </div>
      </div>

      <div className="leaderboard-sections">
        <div className="leaderboard-panel">
          <h2>Artist Mastery</h2>
          {topArtists.length > 0 ? (
            <div className="leaderboard-list">
              {topArtists.map((artist, index) => (
                <div className="leaderboard-list-row" key={artist.artistName}>
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>{artist.artistName}</strong>
                    <span>{artist.quizzesPlayed} quizzes played</span>
                  </div>
                  <span>{artist.accuracy}%</span>
                  <span>{formatNumber(artist.totalPoints)} pts</span>
                </div>
              ))}
              <LimitNote
                total={artistTotalCount}
                limit={LEADERBOARD_SECTION_LIMIT}
                label={`Showing top ${LEADERBOARD_SECTION_LIMIT}`}
              />
            </div>
          ) : (
            <p>Play a quiz to start building artist stats.</p>
          )}
        </div>

        <div className="leaderboard-panel">
          <h2>Album Records</h2>
          {topAlbums.length > 0 ? (
            <div className="leaderboard-list">
              {topAlbums.map((album, index) => (
                <div
                  className="leaderboard-list-row"
                  key={`${album.artistName}-${album.albumName}`}
                >
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>{album.albumName}</strong>
                    <span>{album.artistName}</span>
                  </div>
                  <span>{formatNumber(album.bestScore)} pts</span>
                  <span>{album.bestAccuracy}%</span>
                </div>
              ))}
              <LimitNote
                total={albumTotalCount}
                limit={LEADERBOARD_SECTION_LIMIT}
                label={`Showing top ${LEADERBOARD_SECTION_LIMIT}`}
              />
            </div>
          ) : (
            <p>Album scores will appear after your first quiz.</p>
          )}
        </div>
      </div>

      <div className="recent-results">
        <h2>Recent Quiz Results</h2>

        {recentResults.length > 0 ? (
          <div className="results-table">
            {recentResults.map((result) => (
              <div className="result-row" key={result.id}>
                <div>
                  <strong>{result.albumName}</strong>
                  <span>{result.artistName}</span>
                </div>
                <span>{formatNumber(result.finalPoints)} pts</span>
                <span>{result.accuracyPercentage}%</span>
              </div>
            ))}
            <LimitNote
              total={recentTotalCount}
              limit={RECENT_RESULTS_LIMIT}
              label={`Showing latest ${RECENT_RESULTS_LIMIT}`}
            />
          </div>
        ) : (
          <p className="empty-stats">
            Finish a quiz and your first local result will show here.
          </p>
        )}
      </div>

      <button
        type="button"
        className="clear-stats-button"
        onClick={onClearStats}
      >
        Clear Local Stats
      </button>
    </>
  );
}

export default Leaderboard;
