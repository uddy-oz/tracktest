import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { clearTrackTestStats, getTrackTestStats } from "../lib/stats";

type LeaderboardProps = {
  onPlay: () => void;
  session: Session | null;
};

function formatNumber(value: number) {
  return value.toLocaleString();
}

function formatSeconds(value: number) {
  return `${value.toFixed(1)}s`;
}

function formatStreak(days: number) {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function Leaderboard({ onPlay, session }: LeaderboardProps) {
  const [stats, setStats] = useState(getTrackTestStats);
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
        <h1>Your Local Stats</h1>
        <p>
          A local leaderboard foundation for artist mastery, album runs, streaks,
          and future Arena rankings.
        </p>
        <p className="cloud-sync-message">
          {session
            ? "Signed in. Cloud sync coming next."
            : "Log in to save your stats across devices. Local stats are stored on this browser."}
        </p>
        <button type="button" onClick={onPlay}>
          Back to Play
        </button>
      </div>

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
        onClick={handleClearStats}
      >
        Clear Local Stats
      </button>
    </section>
  );
}

export default Leaderboard;
