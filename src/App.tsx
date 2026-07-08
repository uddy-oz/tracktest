import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Navbar from "./Components/Navbar";
import Hero from "./Components/Hero";
import AlbumSearch from "./Components/AlbumSearch";
import Quiz from "./Components/Quiz";
import SpotifyCallback from "./Components/SpotifyCallback";
import Leaderboard from "./Components/Leaderboard";
import AuthPage from "./Components/AuthPage";
import { supabase } from "./lib/supabaseClient";
import { ensureUserProfile, type UserProfile } from "./lib/profiles";
import { getTrackTestStats, setTrackTestStats } from "./lib/stats";
import type { SpotifyAlbum } from "./lib/spotifyApi";

type AppView = "play" | "leaderboard" | "auth";

function App() {
  const [activeView, setActiveView] = useState<AppView>("play");
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [isQuizStarted, setIsQuizStarted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

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

    async function loadProfile() {
      if (!session?.user) {
        setProfile(null);
        setIsProfileLoading(false);
        return;
      }

      setIsProfileLoading(true);

      const { profile: nextProfile, error } = await ensureUserProfile(
        session.user
      );

      if (!isActive) {
        return;
      }

      if (error) {
        console.error("Could not load profile:", error);
      }

      setProfile(nextProfile);
      setIsProfileLoading(false);
    }

    void loadProfile();

    return () => {
      isActive = false;
    };
  }, [session]);

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

  async function logoutSupabase() {
    const localStatsSnapshot = getTrackTestStats();

    if (!supabase) {
      setSession(null);
      setProfile(null);
      setTrackTestStats(localStatsSnapshot);
      return;
    }

    await supabase.auth.signOut({ scope: "local" });
    setSession(null);
    setProfile(null);
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
        session={session}
        profile={profile}
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
    </>
  );
}

export default App;
