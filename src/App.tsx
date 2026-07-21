import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  cancelDuelRoom,
  fetchCurrentDuelRoom,
  isArenaRoomRecoverableForUser,
  type ArenaRoom,
} from "./lib/arenaRooms";
import { supabase } from "./lib/supabaseClient";
import { getArenaBadges } from "./lib/badges";
import { fetchCloudBadgeStats } from "./lib/cloudBadgeStats";
import { getCompactPlayerBadges, type CompactPlayerBadge } from "./lib/playerIdentity";
import { ensureUserProfile, validateUsername, type UserProfile } from "./lib/profiles";
import { getTrackTestStats, setTrackTestStats } from "./lib/stats";
import type { SpotifyAlbum } from "./lib/spotifyApi";

type AppView = "home" | "play" | "leaderboard" | "multiplayer" | "auth" | "profile";

function hasCompleteUsername(profile: UserProfile | null) {
  return Boolean(profile?.username && validateUsername(profile.username).ok);
}

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
  const [activeArenaRoom, setActiveArenaRoom] = useState<ArenaRoom | null>(null);
  const [progressionRevision, setProgressionRevision] = useState(0);
  const arenaRecoveryGenerationRef = useRef(0);

  const refreshActiveArenaRoom = useCallback(async () => {
    const recoveryGeneration = ++arenaRecoveryGenerationRef.current;

    if (!session?.user) {
      setActiveArenaRoom(null);
      return null;
    }

    const { room, error } = await fetchCurrentDuelRoom(session.user);

    if (error) {
      console.error("Could not load active Arena room:", error);
    }

    if (recoveryGeneration !== arenaRecoveryGenerationRef.current) {
      return room;
    }

    setActiveArenaRoom(
      isArenaRoomRecoverableForUser(room, session.user.id) ? room : null
    );
    return room;
  }, [session?.user]);

  const handleArenaRoomChange = useCallback(
    (room: ArenaRoom | null) => {
      arenaRecoveryGenerationRef.current += 1;
      setActiveArenaRoom(
        isArenaRoomRecoverableForUser(room, session?.user.id) ? room : null
      );
    },
    [session?.user.id]
  );

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

  useEffect(() => {
    void refreshActiveArenaRoom();
  }, [activeView, refreshActiveArenaRoom]);

  useEffect(() => {
    function refreshProgressionOnFocus() {
      void refreshIdentityBadges();
    }

    window.addEventListener("focus", refreshProgressionOnFocus);

    return () => window.removeEventListener("focus", refreshProgressionOnFocus);
  }, [session?.user.id]);

  async function refreshIdentityBadges() {
    if (!session?.user) {
      const localStats = getTrackTestStats();
      setIdentityBadges(
        getCompactPlayerBadges(localStats, getArenaBadges(localStats))
      );
      setProgressionRevision((revision) => revision + 1);
      return;
    }

    const { data, error } = await fetchCloudBadgeStats(session.user);

    if (error || !data) {
      console.error("Could not refresh cloud badge stats:", error);
      const localStats = getTrackTestStats();
      setIdentityBadges(
        getCompactPlayerBadges(localStats, getArenaBadges(localStats))
      );
      setProgressionRevision((revision) => revision + 1);
      return;
    }

    setIdentityBadges(getCompactPlayerBadges(data, getArenaBadges(data)));
    setProgressionRevision((revision) => revision + 1);
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

  async function closeActiveArenaRoom(roomId?: string) {
    const targetRoomId = roomId || activeArenaRoom?.id;

    if (!targetRoomId) {
      return "";
    }

    const { error } = await cancelDuelRoom(targetRoomId);
    await refreshActiveArenaRoom();

    return error || "";
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

  const mustCompleteUsername =
    Boolean(session?.user) && !isProfileLoading && !hasCompleteUsername(profile);

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

      {mustCompleteUsername && (
        <AuthPage
          session={session}
          profile={profile}
          isProfileLoading={isProfileLoading}
          onProfileSaved={setProfile}
          onPlay={showHome}
        />
      )}

      {!mustCompleteUsername && activeView === "home" && (
        <HomePage
          session={session}
          profile={profile}
          identityBadges={identityBadges}
          activeArenaRoom={activeArenaRoom}
          onSinglePlayer={showPlay}
          onMultiplayer={showMultiplayer}
          onLeaderboard={showLeaderboard}
          onProfile={showProfile}
          onResumeArenaRoom={showMultiplayer}
          onCloseArenaRoom={closeActiveArenaRoom}
          progressionRevision={progressionRevision}
        />
      )}

      {!mustCompleteUsername && activeView === "play" && !isQuizStarted && (
        <SinglePlayerPage
          session={session}
          profile={profile}
          identityBadges={identityBadges}
          onStartQuiz={startQuiz}
        />
      )}

      {!mustCompleteUsername && activeView === "play" && isQuizStarted && selectedAlbum && (
        <Quiz
          selectedAlbum={selectedAlbum}
          onRestartApp={restartApp}
          onStatsUpdated={refreshIdentityBadges}
          user={session?.user || null}
        />
      )}

      {!mustCompleteUsername && activeView === "leaderboard" && (
        <Leaderboard
          onPlay={showHome}
          session={session}
          onOpenProfile={showPublicProfile}
          progressionRevision={progressionRevision}
        />
      )}

      {!mustCompleteUsername && activeView === "multiplayer" && (
        <ArenaPage
          session={session}
          profile={profile}
          onHome={showHome}
          onLogin={showAuth}
          inviteCode={arenaInviteCode}
          recoveredRoom={activeArenaRoom}
          onArenaRoomChange={handleArenaRoomChange}
          onProgressionUpdated={refreshIdentityBadges}
          onInviteHandled={() => {
            window.history.pushState({}, "", "/multiplayer");
            setArenaInviteCode(null);
          }}
        />
      )}

      {!mustCompleteUsername && activeView === "auth" && (
        <AuthPage
          session={session}
          profile={profile}
          isProfileLoading={isProfileLoading}
          onProfileSaved={setProfile}
          onPlay={showHome}
        />
      )}

      {!mustCompleteUsername && activeView === "profile" && (
        <ProfilePage
          session={session}
          profile={profile}
          identityBadges={identityBadges}
          publicUsername={publicProfileUsername}
          onShowAuth={showAuth}
          onPlay={showHome}
          onBackToLeaderboard={showLeaderboard}
          progressionRevision={progressionRevision}
        />
      )}
    </>
  );
}

export default App;
