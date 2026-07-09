import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Navbar from "./Components/Navbar";
import Hero from "./Components/Hero";
import AlbumSearch from "./Components/AlbumSearch";
import Quiz from "./Components/Quiz";
import SpotifyCallback from "./Components/SpotifyCallback";
import Leaderboard from "./Components/Leaderboard";
import AuthPage from "./Components/AuthPage";
import ProfilePage from "./Components/ProfilePage";
import { supabase } from "./lib/supabaseClient";
import { getArenaBadges } from "./lib/badges";
import { fetchCloudBadgeStats } from "./lib/cloudBadgeStats";
import { getCompactPlayerBadges, type CompactPlayerBadge } from "./lib/playerIdentity";
import { ensureUserProfile, type UserProfile } from "./lib/profiles";
import { getTrackTestStats, setTrackTestStats } from "./lib/stats";
import type { SpotifyAlbum } from "./lib/spotifyApi";

type AppView = "play" | "leaderboard" | "auth" | "profile";

function App() {
  const [activeView, setActiveView] = useState<AppView>("play");
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [isQuizStarted, setIsQuizStarted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [identityBadges, setIdentityBadges] = useState<
    CompactPlayerBadge[] | null
  >(null);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadIdentityBadges() {
      if (!session?.user) {
        const localStats = getTrackTestStats();
        setIdentityBadges(
          getCompactPlayerBadges(localStats, getArenaBadges(localStats))
        );
        return;
      }

      setIdentityBadges(null);

      const { data, error } = await fetchCloudBadgeStats(session.user);

      if (error || !data) {
        console.error("Could not load cloud badge stats:", error);
        const localStats = getTrackTestStats();
        setIdentityBadges(
          getCompactPlayerBadges(localStats, getArenaBadges(localStats))
        );
        return;
      }

      setIdentityBadges(getCompactPlayerBadges(data, getArenaBadges(data)));
    }

    async function loadAccountData() {
      if (!session?.user) {
        setProfile(null);
        setIsProfileLoading(false);
        await loadIdentityBadges();
        return;
      }

      setIsProfileLoading(true);

      const profileResult = await ensureUserProfile(session.user);
      await loadIdentityBadges();

      if (!isActive) {
        return;
      }

      if (profileResult.error) {
        console.error("Could not load profile:", profileResult.error);
      }

      setProfile(profileResult.profile);
      setIsProfileLoading(false);
    }

    void loadAccountData();

    return () => {
      isActive = false;
    };
  }, [session]);

  async function refreshIdentityBadges() {
    if (!session?.user) {
      const localStats = getTrackTestStats();
      setIdentityBadges(
        getCompactPlayerBadges(localStats, getArenaBadges(localStats))
      );
      return;
    }

    const { data, error } = await fetchCloudBadgeStats(session.user);

    if (error || !data) {
      console.error("Could not refresh cloud badge stats:", error);
      const localStats = getTrackTestStats();
      setIdentityBadges(
        getCompactPlayerBadges(localStats, getArenaBadges(localStats))
      );
      return;
    }

    setIdentityBadges(getCompactPlayerBadges(data, getArenaBadges(data)));
  }

  function startQuiz(album: SpotifyAlbum) {
    setActiveView("play");
    setSelectedAlbum(album);
    setIsQuizStarted(true);
  }

  function restartApp() {
    setActiveView("play");
    setSelectedAlbum(null);
    setIsQuizStarted(false);
  }

  function showPlay() {
    restartApp();
  }

  function scrollToAlbumSearch() {
    const searchSection = document.getElementById("album-search");
    const searchInput = searchSection?.querySelector("input");

    searchSection?.scrollIntoView({ behavior: "smooth" });
    searchInput?.focus({ preventScroll: true });
  }

  function showLeaderboard() {
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView("leaderboard");
  }

  function showAuth() {
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView("auth");
  }

  function showProfile() {
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView(session ? "profile" : "auth");
  }

  async function logoutSupabase() {
    const localStatsSnapshot = getTrackTestStats();

    if (!supabase) {
      setSession(null);
      setProfile(null);
      setIdentityBadges(null);
      setTrackTestStats(localStatsSnapshot);
      return;
    }

    await supabase.auth.signOut({ scope: "local" });
    setSession(null);
    setProfile(null);
    setIdentityBadges(null);
    setTrackTestStats(localStatsSnapshot);
  }

  if (window.location.pathname === "/callback") {
    return (
      <SpotifyCallback
        onSpotifyConnected={() => undefined}
      />
    );
  }

  return (
    <>
      <Navbar
        onShowAuth={showAuth}
        onLogout={logoutSupabase}
        onShowPlay={showPlay}
        onShowLeaderboard={showLeaderboard}
        onShowProfile={showProfile}
        session={session}
        profile={profile}
        identityBadges={identityBadges}
        activeView={activeView}
      />

      {activeView === "play" && !isQuizStarted && (
        <>
          <Hero
            onStartPlaying={scrollToAlbumSearch}
            onViewLeaderboard={showLeaderboard}
          />
          <AlbumSearch onStartQuiz={startQuiz} />
        </>
      )}

      {activeView === "play" && isQuizStarted && selectedAlbum && (
        <Quiz
          selectedAlbum={selectedAlbum}
          onRestartApp={restartApp}
          onStatsUpdated={refreshIdentityBadges}
          user={session?.user || null}
        />
      )}

      {activeView === "leaderboard" && (
        <Leaderboard onPlay={showPlay} session={session} />
      )}

      {activeView === "auth" && (
        <AuthPage
          session={session}
          profile={profile}
          isProfileLoading={isProfileLoading}
          onProfileSaved={setProfile}
          onPlay={showPlay}
        />
      )}

      {activeView === "profile" && (
        <ProfilePage
          session={session}
          profile={profile}
          identityBadges={identityBadges}
          onShowAuth={showAuth}
          onPlay={showPlay}
        />
      )}
    </>
  );
}

export default App;
