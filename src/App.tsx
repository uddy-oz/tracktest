import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import Navbar from "./Components/Navbar";
import HomePage from "./Components/HomePage";
import type { AuthPageMode } from "./Components/AuthPage";
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
import {
  clearGuestName,
  createGuestName,
  getGuestName,
  isAnonymousUser,
  rememberGuestName,
} from "./lib/authIdentity";

const SinglePlayerPage = lazy(() => import("./Components/SinglePlayerPage"));
const Quiz = lazy(() => import("./Components/Quiz"));
const SpotifyCallback = lazy(() => import("./Components/SpotifyCallback"));
const Leaderboard = lazy(() => import("./Components/Leaderboard"));
const AuthPage = lazy(() => import("./Components/AuthPage"));
const ProfilePage = lazy(() => import("./Components/ProfilePage"));
const ArenaPage = lazy(() => import("./Components/ArenaPage"));

type AppView = "home" | "play" | "leaderboard" | "multiplayer" | "auth" | "profile";

const AUTH_RETURN_STORAGE_KEY = "stanzer.auth.returnPath";

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

function getAuthModeFromPath(): AuthPageMode {
  switch (window.location.pathname) {
    case "/signup":
      return "signup";
    case "/forgot-password":
      return "forgot";
    case "/reset-password":
      return "reset";
    case "/settings":
      return "settings";
    default:
      return "login";
  }
}

function getAuthPath(mode: AuthPageMode) {
  switch (mode) {
    case "signup":
      return "/signup";
    case "forgot":
      return "/forgot-password";
    case "reset":
      return "/reset-password";
    case "settings":
      return "/settings";
    default:
      return "/login";
  }
}

function isSafeInternalPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("://");
}

function RouteLoadingState() {
  return (
    <main className="route-loading-state" aria-busy="true">
      <span className="auth-loading-dot" aria-hidden="true" />
      <p>Loading this part of StanZer...</p>
    </main>
  );
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
    case "/signup":
    case "/forgot-password":
    case "/reset-password":
    case "/settings":
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
  const [authMode, setAuthMode] = useState<AuthPageMode>(getAuthModeFromPath);
  const [publicProfileUsername, setPublicProfileUsername] = useState<
    string | null
  >(getProfileUsernameFromPath);
  const [arenaInviteCode, setArenaInviteCode] = useState<string | null>(
    getArenaInviteCodeFromPath
  );
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [isQuizStarted, setIsQuizStarted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(Boolean(supabase));
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

  const startGuestSession = useCallback(async () => {
    if (!supabase) {
      return "Supabase is not configured yet.";
    }

    if (session?.user && !isAnonymousUser(session.user)) {
      showMultiplayer();
      return "";
    }

    const guestName = getGuestName(session?.user) || createGuestName();
    rememberGuestName(guestName);

    const { data, error } = await supabase.auth.signInAnonymously({
      options: {
        data: {
          guest_name: guestName,
          display_name: guestName,
        },
      },
    });

    if (error || !data.user) {
      clearGuestName();
      return error?.message || "Could not start a guest session.";
    }

    navigateToInternalPath(
      window.sessionStorage.getItem(AUTH_RETURN_STORAGE_KEY) || "/multiplayer"
    );
    window.sessionStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
    return "";
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

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setIsAuthLoading(false);

      if (event === "PASSWORD_RECOVERY") {
        window.history.replaceState({}, "", "/reset-password");
        setAuthMode("reset");
        setPublicProfileUsername(null);
        setArenaInviteCode(null);
        setActiveView("auth");
      }
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
      setAuthMode(getAuthModeFromPath());
      setActiveView(username ? "profile" : inviteCode ? "multiplayer" : getInitialView());
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const pageLabel =
      activeView === "play"
        ? "Single Player"
        : activeView === "multiplayer"
          ? "Multiplayer"
          : activeView === "leaderboard"
            ? "Leaderboard"
            : activeView === "profile"
              ? "Player Profile"
              : activeView === "auth"
                ? authMode === "signup"
                  ? "Create Account"
                  : authMode === "forgot" || authMode === "reset"
                    ? "Password Recovery"
                    : authMode === "settings"
                      ? "Account Settings"
                      : "Log In"
                : "Prove you're a superfan";

    document.title = `${pageLabel} | StanZer`;
  }, [activeView, authMode]);

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

      if (isAnonymousUser(session.user)) {
        setIdentityBadges([]);
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

      if (isAnonymousUser(session.user)) {
        const guestName = getGuestName(session.user) || createGuestName();
        rememberGuestName(guestName);
        setProfile({
          id: session.user.id,
          email: null,
          username: guestName,
          displayName: guestName,
        });
        setIdentityBadges([]);
        setIsProfileLoading(false);
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
    const refreshId = window.setTimeout(() => {
      void refreshActiveArenaRoom();
    }, 0);

    return () => window.clearTimeout(refreshId);
  }, [activeView, refreshActiveArenaRoom]);

  const refreshIdentityBadges = useCallback(async () => {
    if (!session?.user) {
      const localStats = getTrackTestStats();
      setIdentityBadges(
        getCompactPlayerBadges(localStats, getArenaBadges(localStats))
      );
      setProgressionRevision((revision) => revision + 1);
      return;
    }

    if (isAnonymousUser(session.user)) {
      setIdentityBadges([]);
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
  }, [session?.user]);

  useEffect(() => {
    function refreshProgressionOnFocus() {
      void refreshIdentityBadges();
    }

    window.addEventListener("focus", refreshProgressionOnFocus);

    return () => window.removeEventListener("focus", refreshProgressionOnFocus);
  }, [refreshIdentityBadges]);

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

  function showAuth(mode: AuthPageMode = "login", returnPath = "") {
    if (returnPath && isSafeInternalPath(returnPath)) {
      window.sessionStorage.setItem(AUTH_RETURN_STORAGE_KEY, returnPath);
    } else if (activeView !== "auth") {
      window.sessionStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
    }

    window.history.pushState({}, "", getAuthPath(mode));
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setAuthMode(mode);
    setActiveView("auth");
  }

  function showSettings() {
    showAuth("settings", session ? "" : "/settings");
  }

  function navigateToInternalPath(path: string, replace = true) {
    const safePath = isSafeInternalPath(path) ? path : "/";

    if (replace) {
      window.history.replaceState({}, "", safePath);
    } else {
      window.history.pushState({}, "", safePath);
    }

    const username = getProfileUsernameFromPath();
    const inviteCode = getArenaInviteCodeFromPath();

    setPublicProfileUsername(username);
    setArenaInviteCode(inviteCode);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setAuthMode(getAuthModeFromPath());
    setActiveView(
      username ? "profile" : inviteCode ? "multiplayer" : getInitialView()
    );
  }

  function handleAuthenticated() {
    if (authMode === "settings") {
      navigateToInternalPath("/settings");
      return;
    }

    const returnPath = window.sessionStorage.getItem(AUTH_RETURN_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
    navigateToInternalPath(returnPath || "/");
  }

  function showProfile() {
    if (session?.user && isAnonymousUser(session.user)) {
      showAuth("signup");
      return;
    }
    if (profile?.username) {
      showPublicProfile(profile.username);
      return;
    }

    window.history.pushState({}, "", "/profile");
    setPublicProfileUsername(null);
    setArenaInviteCode(null);
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    if (session) {
      setActiveView("profile");
    } else {
      showAuth("login", "/profile");
    }
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
    clearGuestName();
    setSession(null);
    setProfile(null);
    setIdentityBadges(null);
    setTrackTestStats(localStatsSnapshot);
  }

  if (window.location.pathname === "/callback") {
    return (
      <Suspense fallback={<RouteLoadingState />}>
        <SpotifyCallback onSpotifyConnected={() => undefined} />
      </Suspense>
    );
  }

  if (isAuthLoading) {
    return (
      <main className="app-loading-screen" aria-busy="true">
        <span className="app-loading-mark" aria-hidden="true">S</span>
        <p>Loading your StanZer session...</p>
      </main>
    );
  }

  const isPasswordRecovery = activeView === "auth" && authMode === "reset";
  const isGuestSession = isAnonymousUser(session?.user);
  const mustCompleteUsername =
    Boolean(session?.user) &&
    !isGuestSession &&
    !isProfileLoading &&
    !hasCompleteUsername(profile) &&
    !isPasswordRecovery;

  return (
    <>
      <Navbar
        onShowHome={showHome}
        onShowAuth={() => showAuth("login")}
        onShowSettings={showSettings}
        onLogout={logoutSupabase}
        onShowPlay={showPlay}
        onShowLeaderboard={showLeaderboard}
        onShowMultiplayer={showMultiplayer}
        onShowProfile={showProfile}
        session={session}
        profile={profile}
        identityBadges={identityBadges}
        isGuest={isGuestSession}
        activeView={activeView}
      />

      <Suspense fallback={<RouteLoadingState />}>
        {mustCompleteUsername && (
        <AuthPage
          mode="profile"
          session={session}
          profile={profile}
          isProfileLoading={isProfileLoading}
          onNavigate={showAuth}
          onAuthenticated={handleAuthenticated}
          onProfileSaved={setProfile}
          onLogout={logoutSupabase}
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
          user={isGuestSession ? null : session?.user || null}
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
          onLogin={() => showAuth("login", window.location.pathname)}
          onGuest={startGuestSession}
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
          mode={authMode}
          session={session}
          profile={profile}
          isProfileLoading={isProfileLoading}
          onNavigate={showAuth}
          onAuthenticated={handleAuthenticated}
          onProfileSaved={setProfile}
          onLogout={logoutSupabase}
          onPlay={showHome}
          onGuest={startGuestSession}
          onProgressReset={refreshIdentityBadges}
        />
      )}

        {!mustCompleteUsername && activeView === "profile" && (
        <ProfilePage
          session={session}
          profile={profile}
          identityBadges={identityBadges}
          publicUsername={publicProfileUsername}
          onShowAuth={() => showAuth("login", window.location.pathname)}
          onPlay={showHome}
          onBackToLeaderboard={showLeaderboard}
          progressionRevision={progressionRevision}
        />
        )}
      </Suspense>
    </>
  );
}

export default App;
