import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import BadgeCard from "./BadgeCard";
import PlayerIdentityBadges from "./PlayerIdentityBadges";
import { getArenaBadges, type ArenaBadge } from "../lib/badges";
import {
  fetchCurrentUserFeaturedBadgeIds,
  saveCurrentUserFeaturedBadgeIds,
  sanitizeFeaturedBadgeIds,
} from "../lib/featuredBadges";
import {
  calculatePlayerTier,
  getCompactPlayerBadges,
  type CompactPlayerBadge,
} from "../lib/playerIdentity";
import {
  fetchCurrentUserProfileStats,
  fetchPublicProfileByUsername,
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
  publicUsername?: string | null;
  onShowAuth: () => void;
  onPlay: () => void;
  onBackToLeaderboard: () => void;
};

type ProfileState = {
  displayInfo: ProfileDisplayInfo | null;
  stats: TrackTestStats;
  featuredBadgeIds: string[];
  source: PublicProfileStatsSource;
  error: string | null;
  notFound: boolean;
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
  publicUsername = null,
  onShowAuth,
  onPlay,
  onBackToLeaderboard,
}: ProfilePageProps) {
  const [profileState, setProfileState] = useState<ProfileState>(() => ({
    displayInfo: null,
    stats: getTrackTestStats(),
    featuredBadgeIds: [],
    source: "localFallback",
    error: null,
    notFound: false,
  }));
  const [isLoading, setIsLoading] = useState(
    Boolean(session?.user || publicUsername)
  );
  const [isEditingFeaturedBadges, setIsEditingFeaturedBadges] = useState(false);
  const [featuredBadgeDraft, setFeaturedBadgeDraft] = useState<string[]>([]);
  const [featuredBadgeMessage, setFeaturedBadgeMessage] = useState("");
  const [isBadgeCollectionVisible, setIsBadgeCollectionVisible] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<ArenaBadge | null>(null);
  const isPublicProfile = Boolean(publicUsername);

  useEffect(() => {
    let isActive = true;

    async function loadProfile() {
      if (publicUsername) {
        setIsLoading(true);
        const publicProfileState = await fetchPublicProfileByUsername(
          publicUsername
        );

        if (!isActive) {
          return;
        }

        setProfileState({
          displayInfo: publicProfileState.displayInfo,
          stats: publicProfileState.stats || getTrackTestStats(),
          featuredBadgeIds: publicProfileState.featuredBadgeIds,
          source: "cloud",
          error: publicProfileState.error,
          notFound: publicProfileState.notFound,
        });
        setIsLoading(false);
        return;
      }

      if (!session?.user) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const nextProfileState = await fetchCurrentUserProfileStats(session.user);
      const featuredBadgeResult = await fetchCurrentUserFeaturedBadgeIds(
        session.user,
        nextProfileState.displayInfo.username
      );

      if (!isActive) {
        return;
      }

      setProfileState({
        ...nextProfileState,
        featuredBadgeIds: featuredBadgeResult.badgeIds,
        notFound: false,
      });
      setIsLoading(false);
    }

    void loadProfile();

    return () => {
      isActive = false;
    };
  }, [publicUsername, session]);

  const badges = useMemo(
    () => getArenaBadges(profileState.stats),
    [profileState.stats]
  );
  const playerBadges =
    !isPublicProfile && identityBadges
      ? identityBadges
      : getCompactPlayerBadges(profileState.stats, badges);
  const tier = calculatePlayerTier(badges);
  const unlockedBadges = badges.filter((badge) => badge.unlocked);
  const unlockedBadgeIds = new Set(unlockedBadges.map((badge) => badge.id));
  const customFeaturedBadgeIds = sanitizeFeaturedBadgeIds(
    profileState.featuredBadgeIds,
    unlockedBadgeIds
  );
  const showcaseBadges =
    customFeaturedBadgeIds.length > 0
      ? customFeaturedBadgeIds
          .map((badgeId) => badges.find((badge) => badge.id === badgeId))
          .filter((badge): badge is ArenaBadge => Boolean(badge))
      : getShowcaseBadges(badges);
  const unlockedBadgeCount = unlockedBadges.length;
  const artistStats = Object.values(profileState.stats.artists);
  const albumStats = Object.values(profileState.stats.albums);
  const hasStats = profileState.stats.overall.totalQuizzesPlayed > 0;
  const topArtists = artistStats
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        b.accuracy - a.accuracy ||
        b.quizzesPlayed - a.quizzesPlayed
    )
    .slice(0, SECTION_LIMIT);
  const topAlbums = albumStats
    .sort(
      (a, b) =>
        b.bestScore - a.bestScore ||
        b.bestAccuracy - a.bestAccuracy ||
        b.timesPlayed - a.timesPlayed
    )
    .slice(0, SECTION_LIMIT);
  const recentResults = profileState.stats.quizResults.slice(0, RECENT_LIMIT);
  const displayName =
    (isPublicProfile ? null : profile?.displayName) ||
    profileState.displayInfo?.displayName ||
    (isPublicProfile
      ? "Unknown Player"
      : getProfileDisplayLabel(profile, session?.user.email));
  const username =
    (isPublicProfile ? null : profile?.username) ||
    profileState.displayInfo?.username ||
    publicUsername;
  const isOwnProfile = Boolean(
    session?.user &&
      username &&
      profile?.username &&
      username.toLowerCase() === profile.username.toLowerCase()
  );

  function startEditingFeaturedBadges() {
    setFeaturedBadgeDraft(customFeaturedBadgeIds);
    setFeaturedBadgeMessage("");
    setIsEditingFeaturedBadges(true);
  }

  function toggleFeaturedBadge(badgeId: string) {
    setFeaturedBadgeDraft((currentBadgeIds) => {
      if (currentBadgeIds.includes(badgeId)) {
        return currentBadgeIds.filter((currentBadgeId) => currentBadgeId !== badgeId);
      }

      if (currentBadgeIds.length >= SECTION_LIMIT) {
        return currentBadgeIds;
      }

      return [...currentBadgeIds, badgeId];
    });
  }

  async function saveFeaturedBadges(nextBadgeIds = featuredBadgeDraft) {
    if (!session?.user) {
      return;
    }

    const sanitizedBadgeIds = sanitizeFeaturedBadgeIds(
      nextBadgeIds,
      unlockedBadgeIds
    );
    const { error } = await saveCurrentUserFeaturedBadgeIds({
      user: session.user,
      username,
      badgeIds: sanitizedBadgeIds,
    });

    setProfileState((currentProfileState) => ({
      ...currentProfileState,
      featuredBadgeIds: sanitizedBadgeIds,
    }));
    setFeaturedBadgeDraft(sanitizedBadgeIds);
    setFeaturedBadgeMessage(
      error
        ? "Saved locally. Run the featured badges SQL to sync publicly."
        : "Featured badges saved."
    );
    setIsEditingFeaturedBadges(false);
  }

  function clearFeaturedBadges() {
    void saveFeaturedBadges([]);
  }

  function getBadgeProgressLabel(badge: ArenaBadge) {
    if (!badge.target) {
      return badge.unlocked ? "Unlocked" : "Locked";
    }

    return badge.unlocked
      ? "Unlocked"
      : `${badge.progress || 0} / ${badge.target}`;
  }

  function getBadgeProgressPercent(badge: ArenaBadge) {
    if (!badge.target) {
      return badge.unlocked ? 100 : 0;
    }

    return Math.min(100, Math.round(((badge.progress || 0) / badge.target) * 100));
  }

  if (!session && !isPublicProfile) {
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

  if (!isPublicProfile && profile && !profile.username) {
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

  if (isPublicProfile && profileState.notFound) {
    return (
      <section className="profile-page">
        <div className="profile-empty">
          <p className="eyebrow">Public Profile</p>
          <h1>Profile not found</h1>
          <p>
            No Arena player exists with the username @{publicUsername}.
          </p>
          <button type="button" onClick={onBackToLeaderboard}>
            Back to Leaderboard
          </button>
        </div>
      </section>
    );
  }

  if (isPublicProfile && profileState.error) {
    return (
      <section className="profile-page">
        <div className="profile-empty">
          <p className="eyebrow">Public Profile</p>
          <h1>Profile unavailable</h1>
          <p>{profileState.error}</p>
          <button type="button" onClick={onBackToLeaderboard}>
            Back to Leaderboard
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="profile-page">
      <div className="profile-hero">
        <div>
          <p className="eyebrow">
            {isPublicProfile ? "Public Profile" : "Player Profile"}
          </p>
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

      {!isPublicProfile && profileState.source === "localFallback" && profileState.error && (
        <p className="profile-source-note">
          Cloud profile stats could not load, so this view is showing local stats
          from this browser.
        </p>
      )}

      <section className="profile-overview-section">
        <div className="profile-section-header">
          <div>
            <p className="eyebrow">Player Overview</p>
            <h2>Career Stats</h2>
          </div>
          <span>{profileState.source === "cloud" ? "Cloud stats" : "Local fallback"}</span>
        </div>

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
      </section>

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
        {isOwnProfile && unlockedBadgeCount > 0 && (
          <div className="featured-badge-actions">
            <button type="button" onClick={startEditingFeaturedBadges}>
              Edit Featured Badges
            </button>
            {customFeaturedBadgeIds.length > 0 && (
              <button
                type="button"
                className="secondary-button"
                onClick={clearFeaturedBadges}
              >
                Use Default
              </button>
            )}
          </div>
        )}
        {featuredBadgeMessage && (
          <p className="featured-badge-message">{featuredBadgeMessage}</p>
        )}
        {isEditingFeaturedBadges && (
          <div className="featured-badge-editor">
            <div className="profile-panel-heading">
              <div>
                <p className="eyebrow">Unlocked Badges</p>
                <h2>Choose up to 6</h2>
              </div>
              <span>{featuredBadgeDraft.length} / 6 selected</span>
            </div>
            <div className="featured-badge-picker">
              {unlockedBadges.map((badge) => {
                const isSelected = featuredBadgeDraft.includes(badge.id);
                const isDisabled =
                  !isSelected && featuredBadgeDraft.length >= SECTION_LIMIT;

                return (
                  <button
                    type="button"
                    className={`featured-badge-option ${
                      isSelected ? "selected" : ""
                    }`}
                    disabled={isDisabled}
                    onClick={() => toggleFeaturedBadge(badge.id)}
                    key={badge.id}
                  >
                    <strong>{badge.title}</strong>
                    <span>{badge.category} - {badge.tier}</span>
                  </button>
                );
              })}
            </div>
            <div className="featured-badge-actions">
              <button type="button" onClick={() => void saveFeaturedBadges()}>
                Save Featured Badges
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsEditingFeaturedBadges(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showcaseBadges.length > 0 ? (
          <div className="badge-grid profile-showcase-grid">
            {showcaseBadges.map((badge) => (
              <BadgeCard
                badge={badge}
                key={badge.id}
                onSelect={setSelectedBadge}
              />
            ))}
          </div>
        ) : (
          <p className="empty-stats">
            {isPublicProfile
              ? "This player has not unlocked featured achievements yet."
              : "Finish quizzes to start filling your badge showcase."}
          </p>
        )}

        <div className="profile-collection-toggle">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setIsBadgeCollectionVisible((isVisible) => !isVisible)}
          >
            {isBadgeCollectionVisible ? "Hide Badge Collection" : "View All Badges"}
          </button>
        </div>
      </section>

      {isBadgeCollectionVisible && (
        <section className="badge-section profile-badge-collection">
          <div className="badge-section-header">
            <div>
              <p className="eyebrow">Badge Collection</p>
              <h2>All Achievements</h2>
            </div>
            <span>
              {unlockedBadgeCount} / {badges.length}
            </span>
          </div>

          <div className="badge-grid profile-showcase-grid">
            {badges.map((badge) => (
              <BadgeCard
                badge={badge}
                key={badge.id}
                onSelect={setSelectedBadge}
              />
            ))}
          </div>
        </section>
      )}

      <div className="leaderboard-sections profile-sections">
        <div className="leaderboard-panel">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Artist Mastery</p>
              <h2>Top Artists</h2>
            </div>
            {artistStats.length > SECTION_LIMIT && <span>Showing top 6</span>}
          </div>
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
            <p>
              {isPublicProfile
                ? "This player has not built artist mastery yet."
                : "Play a quiz to start building artist mastery."}
            </p>
          )}
        </div>

        <div className="leaderboard-panel">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Album Records</p>
              <h2>Best Album Scores</h2>
            </div>
            {albumStats.length > SECTION_LIMIT && <span>Showing top 6</span>}
          </div>
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
            <p>
              {isPublicProfile
                ? "This player has not set album records yet."
                : "Album records appear after you complete quizzes."}
            </p>
          )}
        </div>
      </div>

      <div className="recent-results profile-recent-results">
        <div className="profile-panel-heading">
          <div>
            <p className="eyebrow">Recent Quiz Results</p>
            <h2>Latest Runs</h2>
          </div>
          {profileState.stats.quizResults.length > RECENT_LIMIT && (
            <span>Showing latest 5</span>
          )}
        </div>
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
            {hasStats
              ? "Recent quiz history is still warming up."
              : isPublicProfile
                ? "This player has not completed a cloud-saved quiz yet."
                : "Your latest quiz results will appear here."}
          </p>
        )}
      </div>

      {selectedBadge && (
        <div
          className="badge-detail-overlay"
          role="presentation"
          onClick={() => setSelectedBadge(null)}
        >
          <section
            className={`badge-detail-modal badge-${selectedBadge.accent}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="badge-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="badge-detail-close"
              onClick={() => setSelectedBadge(null)}
              aria-label="Close badge details"
            >
              X
            </button>
            <p className="eyebrow">Badge Details</p>
            <h2 id="badge-detail-title">{selectedBadge.title}</h2>
            <div className="badge-detail-meta">
              <span>{selectedBadge.tier}</span>
              <span>{selectedBadge.category}</span>
              <span>{selectedBadge.unlocked ? "Unlocked" : "Locked"}</span>
            </div>
            <p>{selectedBadge.description}</p>
            <div
              className="badge-progress badge-detail-progress"
              aria-label={`${getBadgeProgressPercent(selectedBadge)}% complete`}
            >
              <div>
                <span
                  style={{ width: `${getBadgeProgressPercent(selectedBadge)}%` }}
                />
              </div>
              <small>{getBadgeProgressLabel(selectedBadge)}</small>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default ProfilePage;
