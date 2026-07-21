import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AlbumSearch from "./AlbumSearch";
import PlayerIdentityBadges from "./PlayerIdentityBadges";
import { getArenaBadges } from "../lib/badges";
import { fetchCloudBadgeStats } from "../lib/cloudBadgeStats";
import {
  calculatePlayerTier,
  getCompactPlayerBadges,
  type CompactPlayerBadge,
} from "../lib/playerIdentity";
import { getProfileDisplayLabel, type UserProfile } from "../lib/profiles";
import type { SpotifyAlbum } from "../lib/spotifyApi";
import { getTrackTestStats, type TrackTestStats } from "../lib/stats";

type SinglePlayerPageProps = {
  session: Session | null;
  profile: UserProfile | null;
  identityBadges: CompactPlayerBadge[] | null;
  onStartQuiz: (album: SpotifyAlbum) => void;
};

function formatNumber(value: number) {
  return value.toLocaleString();
}

function formatSeconds(value: number) {
  return `${value.toFixed(1)}s`;
}

function SinglePlayerPage({
  session,
  profile,
  identityBadges,
  onStartQuiz,
}: SinglePlayerPageProps) {
  const [stats, setStats] = useState<TrackTestStats>(() => getTrackTestStats());
  const [statsSource, setStatsSource] = useState<"cloud" | "local">("local");

  useEffect(() => {
    let isActive = true;

    async function loadStats() {
      if (!session?.user) {
        setStats(getTrackTestStats());
        setStatsSource("local");
        return;
      }

      const { data } = await fetchCloudBadgeStats(session.user).catch(() => ({
        data: null,
      }));

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
    }

    void loadStats();

    return () => {
      isActive = false;
    };
  }, [session?.user]);

  const badges = useMemo(() => getArenaBadges(stats), [stats]);
  const tier = calculatePlayerTier(badges, stats).tier;
  const playerBadges = identityBadges || getCompactPlayerBadges(stats, badges);
  const displayName = session
    ? getProfileDisplayLabel(profile, session.user.email)
    : "Guest Player";
  const username = profile?.username ? `@${profile.username}` : "Local run";
  const recentResults = stats.quizResults.slice(0, 3);

  return (
    <main className="single-player-page">
      <section className="single-player-hero">
        <div>
          <p className="eyebrow">Single Player</p>
          <h1>Pick your battlefield</h1>
          <p>
            Search an album, start a synced countdown, and build your solo
            record one five-second clip at a time.
          </p>
        </div>

        <aside className="single-player-card">
          <div className="home-player-topline">
            <span>Solo Career</span>
            <strong>{statsSource === "cloud" ? "Cloud" : "Local"}</strong>
          </div>
          <h2>{displayName}</h2>
          <p>{username}</p>
          <PlayerIdentityBadges badges={playerBadges} />
          <div className="home-player-stats single-player-stats">
            <span>
              Tier
              <strong>{tier}</strong>
            </span>
            <span>
              Total Points
              <strong>{formatNumber(stats.overall.totalPoints)}</strong>
            </span>
            <span>
              Best Quiz
              <strong>{formatNumber(stats.overall.bestScore)}</strong>
            </span>
            <span>
              Accuracy
              <strong>{stats.overall.overallAccuracy}%</strong>
            </span>
            <span>
              Avg Time
              <strong>{formatSeconds(stats.overall.averageAnswerTime)}</strong>
            </span>
            <span>
              Daily Streak
              <strong>{stats.overall.currentDailyStreak} days</strong>
            </span>
          </div>
        </aside>
      </section>

      <section className="single-player-shell">
        <div className="single-player-search-panel">
          <AlbumSearch onStartQuiz={onStartQuiz} compact />
        </div>

        <aside className="single-player-side-panel">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Recent Results</p>
              <h2>Last Runs</h2>
            </div>
          </div>

          {recentResults.length > 0 ? (
            <div className="home-list">
              {recentResults.map((result) => (
                <div className="home-list-row" key={result.id}>
                  <span>
                    <strong>{result.albumName}</strong>
                    <small>
                      {result.artistName} - {result.correctAnswers}/
                      {result.totalQuestions} correct
                    </small>
                  </span>
                  <b>{formatNumber(result.finalPoints)}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-stats">
              Your recent album runs will show up here after a quiz.
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}

export default SinglePlayerPage;
