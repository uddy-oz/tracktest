import { getTrackTestStats } from "../lib/stats";

type LeaderboardProps = {
  onPlay: () => void;
};

function formatNumber(value: number) {
  return value.toLocaleString();
}

function formatSeconds(value: number) {
  return `${value.toFixed(1)}s`;
}

function Leaderboard({ onPlay }: LeaderboardProps) {
  const stats = getTrackTestStats();
  const artists = Object.values(stats.artists);
  const albums = Object.values(stats.albums);
  const mostPlayedArtist = [...artists].sort(
    (a, b) => b.quizzesPlayed - a.quizzesPlayed
  )[0];
  const bestArtistAccuracy = [...artists]
    .filter((artist) => artist.totalQuestions > 0)
    .sort((a, b) => b.accuracy - a.accuracy || b.totalPoints - a.totalPoints)[0];
  const bestAlbumScore = [...albums].sort(
    (a, b) => b.bestScore - a.bestScore
  )[0];
  const recentResults = stats.quizResults.slice(0, 5);

  return (
    <section className="leaderboard-page">
      <div className="leaderboard-header">
        <p className="eyebrow">TrackTest Arena</p>
        <h1>Your Local Stats</h1>
        <p>
          A local leaderboard foundation for artist mastery, album runs, streaks,
          and future Arena rankings.
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
          <strong>{stats.overall.currentDailyStreak} days</strong>
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
          <h2>Most Played Artist</h2>
          {mostPlayedArtist ? (
            <p>
              <strong>{mostPlayedArtist.artistName}</strong>
              <span>{mostPlayedArtist.quizzesPlayed} quizzes played</span>
            </p>
          ) : (
            <p>Play a quiz to start building artist stats.</p>
          )}
        </div>

        <div className="leaderboard-panel">
          <h2>Best Artist Accuracy</h2>
          {bestArtistAccuracy ? (
            <p>
              <strong>{bestArtistAccuracy.artistName}</strong>
              <span>
                {bestArtistAccuracy.accuracy}% accuracy over{" "}
                {bestArtistAccuracy.totalQuestions} questions
              </span>
            </p>
          ) : (
            <p>Artist accuracy will appear after your first quiz.</p>
          )}
        </div>

        <div className="leaderboard-panel">
          <h2>Best Album Score</h2>
          {bestAlbumScore ? (
            <p>
              <strong>{bestAlbumScore.albumName}</strong>
              <span>
                {formatNumber(bestAlbumScore.bestScore)} points by{" "}
                {bestAlbumScore.artistName}
              </span>
            </p>
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
    </section>
  );
}

export default Leaderboard;
