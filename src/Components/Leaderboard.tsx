import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  fetchGlobalLeaderboard,
  type GlobalLeaderboardData,
} from "../lib/globalLeaderboard";
import { clearTrackTestStats, getTrackTestStats } from "../lib/stats";

type LeaderboardProps = {
  onPlay: () => void;
  session: Session | null;
};

type LeaderboardTab = "global" | "myStats";

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

function playerLabel(playerName: string, username: string | null) {
  return username ? `${playerName} (@${username})` : playerName;
}

function Leaderboard({ onPlay, session }: LeaderboardProps) {
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

      const { data, error } = await fetchGlobalLeaderboard();

      if (!isActive) {
        return;
      }

      setGlobalData(data);
      setGlobalError(error || "");
      setIsGlobalLoading(false);
    }

    void loadGlobalLeaderboard();

    return () => {
      isActive = false;
    };
  }, []);

  const artists = Object.values(stats.artists);
  const albums = Object.values(stats.albums);
  const topArtists = [...artists]
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        b.accuracy - a.accuracy ||
        b.quizzesPlayed - a.quizzesPlayed
    )
    .slice(0, 5);
  const topAlbums = [...albums]
    .sort(
      (a, b) =>
        b.bestScore - a.bestScore ||
        b.bestAccuracy - a.bestAccuracy ||
        b.timesPlayed - a.timesPlayed
    )
    .slice(0, 5);
  const recentResults = stats.quizResults.slice(0, 5);

  function handleClearStats() {
    const shouldClear = window.confirm(
      "Clear all local TrackTest Arena stats on this device?"
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
        <p className="eyebrow">TrackTest Arena</p>
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
          Back to Play
        </button>
      </div>

      {activeTab === "global" ? (
        <GlobalArena
          data={globalData}
          error={globalError}
          isLoading={isGlobalLoading}
        />
      ) : (
        <MyStats
          stats={stats}
          topArtists={topArtists}
          topAlbums={topAlbums}
          recentResults={recentResults}
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
}: {
  data: GlobalLeaderboardData | null;
  error: string;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="empty-stats">Loading Global Arena...</p>;
  }

  if (error) {
    return <p className="empty-stats">Global Arena unavailable: {error}</p>;
  }

  if (!data) {
    return <p className="empty-stats">No global leaderboard data yet.</p>;
  }

  return (
    <>
      <div className="leaderboard-sections global-leaderboard-sections">
        <div className="leaderboard-panel">
          <h2>Overall Points</h2>
          {data.overallPoints.length > 0 ? (
            <div className="leaderboard-list">
              {data.overallPoints.map((entry, index) => (
                <div className="leaderboard-list-row" key={entry.userId}>
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>{playerLabel(entry.playerName, entry.username)}</strong>
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

        <div className="leaderboard-panel">
          <h2>Best Accuracy</h2>
          {data.bestAccuracy.length > 0 ? (
            <div className="leaderboard-list">
              {data.bestAccuracy.map((entry, index) => (
                <div className="leaderboard-list-row" key={entry.userId}>
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>{playerLabel(entry.playerName, entry.username)}</strong>
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

        <div className="leaderboard-panel">
          <h2>Best Album Scores</h2>
          {data.bestAlbumScores.length > 0 ? (
            <div className="leaderboard-list">
              {data.bestAlbumScores.map((entry, index) => (
                <div
                  className="leaderboard-list-row"
                  key={`${entry.userId}-${entry.artistName}-${entry.albumName}`}
                >
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>{entry.albumName}</strong>
                    <span>
                      {entry.artistName} - {playerLabel(entry.playerName, entry.username)}
                    </span>
                  </div>
                  <span>{formatNumber(entry.bestScore)} pts</span>
                  <span>{entry.bestAccuracy}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p>Album records will appear after cloud-saved quizzes.</p>
          )}
        </div>

        <div className="leaderboard-panel">
          <h2>Artist Masters</h2>
          {data.artistMasters.length > 0 ? (
            <div className="leaderboard-list">
              {data.artistMasters.map((entry, index) => (
                <div
                  className="leaderboard-list-row"
                  key={`${entry.userId}-${entry.artistName}`}
                >
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <strong>{entry.artistName}</strong>
                    <span>{playerLabel(entry.playerName, entry.username)}</span>
                  </div>
                  <span>{formatNumber(entry.totalPoints)} pts</span>
                  <span>{entry.accuracy}%</span>
                </div>
              ))}
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
            {data.recentPerfectRuns.map((entry) => (
              <div className="result-row" key={entry.id}>
                <div>
                  <strong>{entry.albumName}</strong>
                  <span>
                    {entry.artistName} - {playerLabel(entry.playerName, entry.username)}
                  </span>
                </div>
                <span>{formatNumber(entry.finalPoints)} pts</span>
                <span>{formatDate(entry.playedAt)}</span>
              </div>
            ))}
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
  onClearStats,
}: {
  stats: ReturnType<typeof getTrackTestStats>;
  topArtists: ReturnType<typeof getTrackTestStats>["artists"][string][];
  topAlbums: ReturnType<typeof getTrackTestStats>["albums"][string][];
  recentResults: ReturnType<typeof getTrackTestStats>["quizResults"];
  onClearStats: () => void;
}) {
  return (
    <>
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
