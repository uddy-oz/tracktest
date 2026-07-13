import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Navbar from "./Components/Navbar";
import HomePage from "./Components/HomePage";
import SinglePlayerPage from "./Components/SinglePlayerPage";
import Quiz from "./Components/Quiz";
import SpotifyCallback from "./Components/SpotifyCallback";
import Leaderboard from "./Components/Leaderboard";
import AuthPage from "./Components/AuthPage";
import ProfilePage from "./Components/ProfilePage";
import ArenaPage from "./Components/ArenaPage";
import { supabase } from "./lib/supabaseClient";
import { getArenaBadges } from "./lib/badges";
import { fetchCloudBadgeStats } from "./lib/cloudBadgeStats";
import { getCompactPlayerBadges, type CompactPlayerBadge } from "./lib/playerIdentity";
import { ensureUserProfile, type UserProfile } from "./lib/profiles";
import { getTrackTestStats, setTrackTestStats } from "./lib/stats";
import type { SpotifyAlbum } from "./lib/spotifyApi";

type AppView = "home" | "play" | "leaderboard" | "multiplayer" | "auth" | "profile";

function getProfileUsernameFromPath() {
  const match = window.location.pathname.match(/^\/profile\/([^/]+)\/?$/);

  return match ? decodeURIComponent(match[1]).toLowerCase() : null;
}

function getArenaInviteCodeFromPath() {
  const match = window.location.pathname.match(/^\/multiplayer\/invite\/([^/]+)\/?$/);

  return match ? decodeURIComponent(match[1]).toUpperCase() : null;
}

function getInitialView(): AppView {
  if (getProfileUsernameFromPath()) {
    return "profile";
  }

  switch (window.location.pathname) {
    case "/play":
      return "play";
    case "/leaderboard":
      return "leaderboard";
    case "/multiplayer":
    case "/arena":
      return "multiplayer";
    case "/login":
    case "/auth":
      return "auth";
    case "/profile":
      return "profile";
    default:
      if (getArenaInviteCodeFromPath()) {
        return "multiplayer";
      }

      return "home";
  }
}

function App() {
  const [activeView, setActiveView] = useState<AppView>(getInitialView);
  const [publicProfileUsername, setPublicProfileUsername] = useState<
    string | null
  >(getProfileUsernameFromPath);
  const [arenaInviteCode, setArenaInviteCode] = useState<string | null>(
    getArenaInviteCodeFromPath
  );
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
    function handlePopState() {
      const username = getProfileUsernameFromPath();
      const inviteCode = getArenaInviteCodeFromPath();

      setSelectedAlbum(null);
      setIsQuizStarted(false);
      setPublicProfileUsername(username);
      setArenaInviteCode(inviteCode);
      setActiveView(username ? "profile" : inviteCode ? "multiplayer" : getInitialView());
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
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
    window.history.pushState({}, "", "/play");
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setActiveView("play");
    setSelectedAlbum(album);
    setIsQuizStarted(true);
  }

  function restartApp() {
    window.history.pushState({}, "", "/play");
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setActiveView("play");
    setSelectedAlbum(null);
    setIsQuizStarted(false);
  }

  function showHome() {
    window.history.pushState({}, "", "/");
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView("home");
  }

  function showPlay() {
    restartApp();
  }

  function showLeaderboard() {
    window.history.pushState({}, "", "/leaderboard");
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView("leaderboard");
  }

  function showMultiplayer() {
    window.history.pushState({}, "", "/multiplayer");
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView("multiplayer");
  }

  function showAuth() {
    window.history.pushState({}, "", "/login");
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView("auth");
  }

  function showProfile() {
    if (profile?.username) {
      showPublicProfile(profile.username);
      return;
    }

    window.history.pushState({}, "", "/profile");
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView(session ? "profile" : "auth");
  }

  function showPublicProfile(username: string) {
    const normalizedUsername = username.toLowerCase();

    window.history.pushState(
      {},
      "",
      `/profile/${encodeURIComponent(normalizedUsername)}`
    );
    setPublicProfileUsername(normalizedUsername);
    setArenaInviteCode(null);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView("profile");
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
        onShowHome={showHome}
        onShowAuth={showAuth}
        onLogout={logoutSupabase}
        onShowPlay={showPlay}
        onShowLeaderboard={showLeaderboard}
        onShowMultiplayer={showMultiplayer}
        onShowProfile={showProfile}
        session={session}
        profile={profile}
        identityBadges={identityBadges}
        activeView={activeView}
      />

      {activeView === "home" && (
        <HomePage
          session={session}
          profile={profile}
          identityBadges={identityBadges}
          onSinglePlayer={showPlay}
          onMultiplayer={showMultiplayer}
          onLeaderboard={showLeaderboard}
          onProfile={showProfile}
        />
      )}

      {activeView === "play" && !isQuizStarted && (
        <SinglePlayerPage
          session={session}
          profile={profile}
          identityBadges={identityBadges}
          onStartQuiz={startQuiz}
        />
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
        <Leaderboard
          onPlay={showHome}
          session={session}
          onOpenProfile={showPublicProfile}
        />
      )}

      {activeView === "multiplayer" && (
        <ArenaPage
          session={session}
          profile={profile}
          onHome={showHome}
          onLogin={showAuth}
          inviteCode={arenaInviteCode}
          onInviteHandled={() => {
            window.history.pushState({}, "", "/multiplayer");
            setArenaInviteCode(null);
          }}
        />
      )}

      {activeView === "auth" && (
        <AuthPage
          session={session}
          profile={profile}
          isProfileLoading={isProfileLoading}
          onProfileSaved={setProfile}
          onPlay={showHome}
        />
      )}

      {activeView === "profile" && (
        <ProfilePage
          session={session}
          profile={profile}
          identityBadges={identityBadges}
          publicUsername={publicProfileUsername}
          onShowAuth={showAuth}
          onPlay={showHome}
          onBackToLeaderboard={showLeaderboard}
        />
      )}
    </>
  );
}

export default App;
