import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import BadgeCard from "./BadgeCard";
import PlayerIdentityBadges from "./PlayerIdentityBadges";
import { getArenaBadges, type ArenaBadge } from "../lib/badges";
import {
  calculatePlayerTier,
  getCompactPlayerBadges,
  type CompactPlayerBadge,
} from "../lib/playerIdentity";
import {
  fetchCurrentUserProfileStats,
  type PublicProfileStatsSource,
} from "../lib/publicProfile";
import {
  getProfileDisplayLabel,
  type ProfileDisplayInfo,
  type UserProfile,
} from "../lib/profiles";
import { getTrackTestStats, type TrackTestStats } from "../lib/stats";

type ProfilePageProps = {
  session: Session | null;
  profile: UserProfile | null;
  identityBadges: CompactPlayerBadge[] | null;
  onShowAuth: () => void;
  onPlay: () => void;
};

type ProfileState = {
  displayInfo: ProfileDisplayInfo | null;
  stats: TrackTestStats;
  source: PublicProfileStatsSource;
  error: string | null;
};

const SECTION_LIMIT = 6;
const RECENT_LIMIT = 5;

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

function getShowcaseBadges(badges: ArenaBadge[]) {
  const tierRank: Record<ArenaBadge["tier"], number> = {
    Bronze: 1,
    Silver: 2,
    Gold: 3,
    Platinum: 4,
    Legendary: 5,
  };
  const priorityIds = [
    "perfect-run",
    "flawless-album",
    "perfect-five",
    "speed-demon",
    "album-demon",
    "artist-master",
    "discography-demon",
    "thirty-day-arena-regular",
  ];
  const prioritySet = new Set(priorityIds);
  const unlocked = badges
    .filter((badge) => badge.unlocked)
    .sort((a, b) => {
      const priorityA = prioritySet.has(a.id) ? 1 : 0;
      const priorityB = prioritySet.has(b.id) ? 1 : 0;

      return (
        priorityB - priorityA ||
        tierRank[b.tier] - tierRank[a.tier] ||
        priorityIds.indexOf(a.id) - priorityIds.indexOf(b.id)
      );
    });
  const selected = new Map<string, ArenaBadge>();

  unlocked.forEach((badge) => {
    if (selected.size < SECTION_LIMIT) {
      selected.set(badge.id, badge);
    }
  });

  priorityIds.forEach((id) => {
    const badge = badges.find((item) => item.id === id);

    if (badge && selected.size < SECTION_LIMIT) {
      selected.set(badge.id, badge);
    }
  });

  return [...selected.values()];
}

function ProfilePage({
  session,
  profile,
  identityBadges,
  onShowAuth,
  onPlay,
}: ProfilePageProps) {
  const [profileState, setProfileState] = useState<ProfileState>(() => ({
    displayInfo: null,
    stats: getTrackTestStats(),
    source: "localFallback",
    error: null,
  }));
  const [isLoading, setIsLoading] = useState(Boolean(session?.user));

  useEffect(() => {
    let isActive = true;

    async function loadProfile() {
      if (!session?.user) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const nextProfileState = await fetchCurrentUserProfileStats(session.user);

      if (!isActive) {
        return;
      }

      setProfileState(nextProfileState);
      setIsLoading(false);
    }

    void loadProfile();

    return () => {
      isActive = false;
    };
  }, [session]);

  const badges = useMemo(
    () => getArenaBadges(profileState.stats),
    [profileState.stats]
  );
  const playerBadges = identityBadges || getCompactPlayerBadges(profileState.stats, badges);
  const showcaseBadges = getShowcaseBadges(badges);
  const tier = calculatePlayerTier(badges);
  const unlockedBadgeCount = badges.filter((badge) => badge.unlocked).length;
  const topArtists = Object.values(profileState.stats.artists)
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        b.accuracy - a.accuracy ||
        b.quizzesPlayed - a.quizzesPlayed
    )
    .slice(0, SECTION_LIMIT);
  const topAlbums = Object.values(profileState.stats.albums)
    .sort(
      (a, b) =>
        b.bestScore - a.bestScore ||
        b.bestAccuracy - a.bestAccuracy ||
        b.timesPlayed - a.timesPlayed
    )
    .slice(0, SECTION_LIMIT);
  const recentResults = profileState.stats.quizResults.slice(0, RECENT_LIMIT);
  const displayName =
    profile?.displayName ||
    profileState.displayInfo?.displayName ||
    getProfileDisplayLabel(profile, session?.user.email);
  const username = profile?.username || profileState.displayInfo?.username;

  if (!session) {
    return (
      <section className="profile-page">
        <div className="profile-empty">
          <p className="eyebrow">Player Profile</p>
          <h1>Log in to view your Arena profile</h1>
          <p>
            Profiles use your saved cloud stats, badges, and username so they
            stay consistent across devices.
          </p>
          <div className="profile-actions">
            <button type="button" onClick={onShowAuth}>
              Login
            </button>
            <button type="button" className="secondary-button" onClick={onPlay}>
              Back to Play
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (profile && !profile.username) {
    return (
      <section className="profile-page">
        <div className="profile-empty">
          <p className="eyebrow">Profile Setup</p>
          <h1>Choose your Arena username</h1>
          <p>
            Add a username before your profile becomes leaderboard-ready.
          </p>
          <button type="button" onClick={onShowAuth}>
            Set Username
          </button>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="profile-page">
        <p className="empty-stats">Loading Arena profile...</p>
      </section>
    );
  }

  return (
    <section className="profile-page">
      <div className="profile-hero">
        <div>
          <p className="eyebrow">Player Profile</p>
          <h1>{displayName}</h1>
          <div className="profile-handle-row">
            {username && <p className="profile-handle">@{username}</p>}
            <PlayerIdentityBadges badges={playerBadges} />
          </div>
        </div>

        <div className="profile-tier-card">
          <span>General Tier</span>
          <strong>{tier.tier}</strong>
          <small>{formatNumber(tier.badgeScore)} badge score</small>
        </div>
      </div>

      {profileState.source === "localFallback" && profileState.error && (
        <p className="profile-source-note">
          Cloud profile stats could not load, so this view is showing local stats
          from this browser.
        </p>
      )}

      <div className="leaderboard-grid profile-stats-grid">
        <div className="stat-card">
          <span>Total Points</span>
          <strong>{formatNumber(profileState.stats.overall.totalPoints)}</strong>
        </div>
        <div className="stat-card">
          <span>Best Quiz Score</span>
          <strong>{formatNumber(profileState.stats.overall.bestScore)}</strong>
        </div>
        <div className="stat-card">
          <span>Quizzes Played</span>
          <strong>{profileState.stats.overall.totalQuizzesPlayed}</strong>
        </div>
        <div className="stat-card">
          <span>Overall Accuracy</span>
          <strong>{profileState.stats.overall.overallAccuracy}%</strong>
        </div>
        <div className="stat-card">
          <span>Average Answer Time</span>
          <strong>{formatSeconds(profileState.stats.overall.averageAnswerTime)}</strong>
        </div>
        <div className="stat-card">
          <span>Current Daily Streak</span>
          <strong>{formatStreak(profileState.stats.overall.currentDailyStreak)}</strong>
        </div>
      </div>

      <section className="badge-section profile-showcase">
        <div className="badge-section-header">
          <div>
            <p className="eyebrow">Badge Showcase</p>
            <h2>Featured Achievements</h2>
          </div>
          <span>
            {unlockedBadgeCount} of {badges.length} unlocked
          </span>
        </div>

        {showcaseBadges.length > 0 ? (
          <div className="badge-grid profile-showcase-grid">
            {showcaseBadges.map((badge) => (
              <BadgeCard badge={badge} key={badge.id} />
            ))}
          </div>
        ) : (
          <p className="empty-stats">
            Finish quizzes to start filling your badge showcase.
          </p>
        )}
      </section>

      <div className="leaderboard-sections profile-sections">
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
            <p>Play a quiz to start building artist mastery.</p>
          )}
        </div>

        <div className="leaderboard-panel">
          <h2>Best Album Scores</h2>
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
            <p>Album records appear after you complete quizzes.</p>
          )}
        </div>
      </div>

      <div className="recent-results profile-recent-results">
        <h2>Recent Quiz Results</h2>
        {recentResults.length > 0 ? (
          <div className="results-table">
            {recentResults.map((result) => (
              <div className="result-row" key={result.id}>
                <div>
                  <strong>{result.albumName}</strong>
                  <span>
                    {result.artistName} - {formatDate(result.datePlayed)}
                  </span>
                </div>
                <span>{formatNumber(result.finalPoints)} pts</span>
                <span>{result.accuracyPercentage}%</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-stats">
            Your latest quiz results will appear here.
          </p>
        )}
      </div>
    </section>
  );
}

export default ProfilePage;
