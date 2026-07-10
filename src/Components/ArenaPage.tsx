import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  activateDuelRoom,
  createDuelRoom,
  fetchArenaRoom,
  fetchOpenDuelRooms,
  finishDuelRoom,
  joinDuelRoom,
  markPlayerReady,
  saveDuelPlayerResult,
  type ArenaRoom,
  type DuelQuizQuestion,
} from "../lib/arenaRooms";
import type { UserProfile } from "../lib/profiles";
import {
  getSpotifyAlbumTracks,
  searchSpotifyAlbums,
  type SpotifyAlbum,
  type SpotifyTrack,
} from "../lib/spotifyApi";

const arenaModes = [
  {
    title: "Duel",
    label: "1v1",
    description: "Challenge one player head to head on one album.",
    accent: "duel",
    enabled: true,
  },
  {
    title: "Group Lobby",
    label: "3-10",
    description: "3 to 10 players compete on one album.",
    accent: "group",
    enabled: false,
  },
  {
    title: "Party Mode",
    label: "Host",
    description:
      "In person game where one host plays music and everyone answers on their phones.",
    accent: "party",
    enabled: false,
  },
  {
    title: "Championship",
    label: "Final",
    description: "Multi album tournament with one final winner.",
    accent: "championship",
    enabled: false,
  },
];

const ALBUMS_PER_PAGE = 8;
const QUESTION_TIME_SECONDS = 10;
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 12;

type ArenaPageProps = {
  session: Session | null;
  profile: UserProfile | null;
  onPlay: () => void;
  onLogin: () => void;
};

function ArenaPage({ session, profile, onPlay, onLogin }: ArenaPageProps) {
  const [isDuelOpen, setIsDuelOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [rooms, setRooms] = useState<ArenaRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<ArenaRoom | null>(null);
  const [message, setMessage] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [duelQuestionIndex, setDuelQuestionIndex] = useState(0);
  const [duelScore, setDuelScore] = useState(0);
  const [duelCorrectAnswers, setDuelCorrectAnswers] = useState(0);
  const [duelAnswerTimes, setDuelAnswerTimes] = useState<number[]>([]);
  const [duelTimeRemaining, setDuelTimeRemaining] = useState(QUESTION_TIME_SECONDS);
  const [duelSelectedAnswer, setDuelSelectedAnswer] = useState("");
  const [isDuelFinished, setIsDuelFinished] = useState(false);
  const [isPreparingDuel, setIsPreparingDuel] = useState(false);

  useEffect(() => {
    if (isDuelOpen) {
      void loadOpenRooms();
    }
  }, [isDuelOpen]);

  useEffect(() => {
    if (!activeRoom || activeRoom.status !== "active" || isDuelFinished) {
      return;
    }

    setDuelTimeRemaining(QUESTION_TIME_SECONDS);
    setDuelSelectedAnswer("");
  }, [activeRoom?.id, activeRoom?.status, duelQuestionIndex, isDuelFinished]);

  useEffect(() => {
    if (
      !activeRoom ||
      activeRoom.status !== "active" ||
      isDuelFinished ||
      duelSelectedAnswer
    ) {
      return;
    }

    const timerId = window.setInterval(() => {
      setDuelTimeRemaining((currentTime) => Math.max(0, currentTime - 1));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [activeRoom, duelSelectedAnswer, isDuelFinished]);

  useEffect(() => {
    if (
      !activeRoom ||
      activeRoom.status !== "active" ||
      isDuelFinished ||
      duelSelectedAnswer ||
      duelTimeRemaining > 0
    ) {
      return;
    }

    handleDuelAnswer("");
  }, [activeRoom, duelSelectedAnswer, duelTimeRemaining, isDuelFinished]);

  function shuffleArray<T>(array: T[]) {
    return [...array].sort(() => Math.random() - 0.5);
  }

  function getQuestionCount(totalPlayableTracks: number) {
    return Math.min(
      MAX_QUESTIONS,
      Math.max(MIN_QUESTIONS, Math.floor(totalPlayableTracks / 2) + 1)
    );
  }

  function buildDuelQuestions(tracks: SpotifyTrack[]): DuelQuizQuestion[] {
    const questionCount = getQuestionCount(tracks.length);
    const quizTracks = shuffleArray(tracks).slice(0, questionCount);

    return quizTracks.map((correctTrack) => {
      const wrongOptions = shuffleArray(
        tracks.filter((track) => track.id !== correctTrack.id)
      ).slice(0, 3);

      return {
        correctTrack,
        options: shuffleArray([correctTrack, ...wrongOptions]),
      };
    });
  }

  function getPointsForAnswer(isCorrect: boolean, remainingSeconds: number) {
    if (!isCorrect) {
      return 0;
    }

    return 500 + Math.floor(500 * (remainingSeconds / QUESTION_TIME_SECONDS));
  }

  async function loadOpenRooms(showErrors = true) {
    setIsLoadingRooms(true);
    const { rooms: nextRooms, error } = await fetchOpenDuelRooms();

    setRooms(nextRooms);
    if (showErrors) {
      setMessage(error || "");
    }
    setIsLoadingRooms(false);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!searchTerm.trim() || isSearching) {
      return;
    }

    setIsSearching(true);
    setMessage("");
    setSelectedAlbum(null);

    try {
      const results = await searchSpotifyAlbums(searchTerm);
      setAlbums(results.slice(0, ALBUMS_PER_PAGE));
    } catch (error) {
      console.error(error);
      setMessage("Could not search albums. Try another album or artist.");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleCreateRoom() {
    if (!session?.user) {
      onLogin();
      return;
    }

    if (!selectedAlbum || isCreatingRoom) {
      return;
    }

    setIsCreatingRoom(true);
    setMessage("");

    const { room, error } = await createDuelRoom({
      album: selectedAlbum,
      user: session.user,
      profile,
    });

    if (room) {
      setActiveRoom(room);
      await loadOpenRooms(false);
    }

    setMessage(error || (room ? "Duel room created." : "Failed to create room."));
    setIsCreatingRoom(false);
  }

  async function handleJoinRoom(room: ArenaRoom) {
    if (!session?.user) {
      onLogin();
      return;
    }

    const isAlreadyInRoom = room.players.some(
      (player) => player.userId === session.user.id
    );

    if (isAlreadyInRoom) {
      const { room: freshRoom, error } = await fetchArenaRoom(room.id);

      setActiveRoom(freshRoom || room);
      setMessage(error || "Entered room.");
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      setMessage("Room full.");
      return;
    }

    setMessage("");
    const { room: joinedRoom, error } = await joinDuelRoom({
      room,
      user: session.user,
      profile,
    });

    if (joinedRoom) {
      setActiveRoom(joinedRoom);
      await loadOpenRooms(false);
    }

    setMessage(error || (joinedRoom ? "Joined room." : "Failed to join room."));
  }

  async function refreshActiveRoom() {
    if (!activeRoom) {
      return;
    }

    const { room, error } = await fetchArenaRoom(activeRoom.id);

    if (room) {
      setActiveRoom(room);
    }

    setMessage(error || "Room refreshed.");
  }

  async function handleReadyForDuel() {
    if (!session?.user || !activeRoom) {
      return;
    }

    setIsPreparingDuel(true);
    setMessage("");

    const readyResult = await markPlayerReady(activeRoom.id, session.user);

    if (readyResult.error) {
      setMessage(readyResult.error);
      setIsPreparingDuel(false);
      return;
    }

    const { room: freshRoom, error } = await fetchArenaRoom(activeRoom.id);

    if (!freshRoom) {
      setMessage(error || "Could not refresh room.");
      setIsPreparingDuel(false);
      return;
    }

    const allPlayersReady =
      freshRoom.players.length >= 2 &&
      freshRoom.players.every((player) => player.isReady);

    if (allPlayersReady && freshRoom.quizQuestions.length === 0) {
      try {
        const tracks = await getSpotifyAlbumTracks(freshRoom.albumId);

        if (tracks.length < MIN_QUESTIONS) {
          setMessage("Not enough playable tracks for a Duel.");
          setIsPreparingDuel(false);
          return;
        }

        const questions = buildDuelQuestions(tracks);
        const activatedRoom = await activateDuelRoom(freshRoom.id, questions);

        setActiveRoom(activatedRoom.room || freshRoom);
        setMessage(activatedRoom.error || "Both players ready. Duel started.");
      } catch (loadError) {
        console.error(loadError);
        setMessage("Could not prepare Duel questions.");
      } finally {
        setIsPreparingDuel(false);
      }
      return;
    }

    setActiveRoom(freshRoom);
    setMessage("Ready. Waiting for opponent.");
    setIsPreparingDuel(false);
  }

  async function finishDuel({
    finalScore,
    correctAnswers,
    answerTimes,
  }: {
    finalScore: number;
    correctAnswers: number;
    answerTimes: number[];
  }) {
    if (!activeRoom || !session?.user) {
      return;
    }

    const averageAnswerTime =
      answerTimes.length > 0
        ? answerTimes.reduce((total, answerTime) => total + answerTime, 0) /
          answerTimes.length
        : 0;

    const result = await saveDuelPlayerResult({
      roomId: activeRoom.id,
      user: session.user,
      finalScore,
      correctAnswers,
      totalQuestions: activeRoom.quizQuestions.length,
      averageAnswerTime,
    });

    const { room } = await fetchArenaRoom(activeRoom.id);

    if (room) {
      const hasEveryoneFinished =
        room.players.length >= 2 &&
        room.players.every((player) => player.finishedAt);

      if (hasEveryoneFinished && room.status !== "finished") {
        await finishDuelRoom(room.id);
        const refreshedRoom = await fetchArenaRoom(room.id);
        setActiveRoom(refreshedRoom.room || room);
      } else {
        setActiveRoom(room);
      }
    }

    setMessage(result.error || "Duel complete. Waiting for opponent to finish.");
    setIsDuelFinished(true);
  }

  function handleDuelAnswer(answer: string) {
    if (!activeRoom || isDuelFinished || duelSelectedAnswer) {
      return;
    }

    const question = activeRoom.quizQuestions[duelQuestionIndex];

    if (!question) {
      return;
    }

    const isCorrect = answer === question.correctTrack.name;
    const points = getPointsForAnswer(isCorrect, duelTimeRemaining);
    const answerTime = QUESTION_TIME_SECONDS - duelTimeRemaining;
    const nextScore = duelScore + points;
    const nextCorrectAnswers = duelCorrectAnswers + (isCorrect ? 1 : 0);
    const nextAnswerTimes = [...duelAnswerTimes, answerTime];

    setDuelSelectedAnswer(answer || "Timed out");
    setDuelScore(nextScore);
    setDuelCorrectAnswers(nextCorrectAnswers);
    setDuelAnswerTimes(nextAnswerTimes);

    window.setTimeout(() => {
      if (duelQuestionIndex >= activeRoom.quizQuestions.length - 1) {
        void finishDuel({
          finalScore: nextScore,
          correctAnswers: nextCorrectAnswers,
          answerTimes: nextAnswerTimes,
        });
        return;
      }

      setDuelQuestionIndex((currentIndex) => currentIndex + 1);
    }, 900);
  }

  function resetDuelLocalState() {
    setDuelQuestionIndex(0);
    setDuelScore(0);
    setDuelCorrectAnswers(0);
    setDuelAnswerTimes([]);
    setDuelTimeRemaining(QUESTION_TIME_SECONDS);
    setDuelSelectedAnswer("");
    setIsDuelFinished(false);
  }

  function getHostName(room: ArenaRoom) {
    const hostPlayer = room.players.find(
      (player) => player.userId === room.hostUserId
    );

    return hostPlayer?.displayName || hostPlayer?.username || "Arena host";
  }

  function renderDuelLobby() {
    if (activeRoom) {
      const hostPlayer = activeRoom.players.find(
        (player) => player.userId === activeRoom.hostUserId
      );
      const guestPlayer = activeRoom.players.find(
        (player) => player.userId !== activeRoom.hostUserId
      );
      const currentPlayer = activeRoom.players.find(
        (player) => player.userId === session?.user.id
      );
      const bothPlayersFinished =
        activeRoom.players.length >= 2 &&
        activeRoom.players.every((player) => player.finishedAt);
      const question = activeRoom.quizQuestions[duelQuestionIndex];

      if (bothPlayersFinished) {
        const sortedPlayers = [...activeRoom.players].sort(
          (a, b) => b.finalScore - a.finalScore
        );
        const isDraw =
          sortedPlayers.length >= 2 &&
          sortedPlayers[0].finalScore === sortedPlayers[1].finalScore;

        return (
          <section className="duel-room-screen">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setActiveRoom(null);
                resetDuelLocalState();
              }}
            >
              Back to Duel Lobby
            </button>
            <div className="duel-results-card">
              <p className="eyebrow">Duel Results</p>
              <h2>{isDraw ? "Draw" : `${sortedPlayers[0].displayName} wins`}</h2>
              <div className="duel-player-grid">
                {activeRoom.players.map((player) => {
                  const accuracy =
                    player.totalQuestions > 0
                      ? Math.round(
                          (player.correctAnswers / player.totalQuestions) * 100
                        )
                      : 0;

                  return (
                    <div className="duel-player-card" key={player.id}>
                      <span>{player.userId === activeRoom.hostUserId ? "Host" : "Player"}</span>
                      <strong>{player.displayName}</strong>
                      <p>
                        {player.finalScore.toLocaleString()} pts - {accuracy}%
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      }

      if (activeRoom.status === "active" && question) {
        if (currentPlayer?.finishedAt || isDuelFinished) {
          return (
            <section className="duel-room-screen">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refreshActiveRoom()}
              >
                Refresh Results
              </button>
              <div className="duel-results-card">
                <p className="eyebrow">Duel Submitted</p>
                <h2>Waiting for opponent to finish.</h2>
                <p className="arena-note">
                  Your score: {duelScore.toLocaleString()} points.
                </p>
              </div>
            </section>
          );
        }

        return (
          <section className="duel-room-screen duel-game-screen">
            <div className="duel-room-hero">
              {activeRoom.artworkUrl && (
                <img src={activeRoom.artworkUrl} alt="" aria-hidden />
              )}
              <div>
                <p className="eyebrow">Duel Active</p>
                <h2>{activeRoom.albumName}</h2>
                <p>
                  Question {duelQuestionIndex + 1} of{" "}
                  {activeRoom.quizQuestions.length}
                </p>
                <span>Time: {duelTimeRemaining}s</span>
              </div>
            </div>

            {question.correctTrack.previewUrl ? (
              <audio
                controls
                src={question.correctTrack.previewUrl}
                className="audio-preview"
              >
                Your browser does not support the audio element.
              </audio>
            ) : (
              <p className="preview-unavailable">
                Audio preview unavailable. Answer from the options.
              </p>
            )}

            <div className="song-options">
              {question.options.map((option) => (
                <button
                  type="button"
                  className={`song-button ${
                    duelSelectedAnswer === option.name ? "selected-song" : ""
                  } ${
                    duelSelectedAnswer &&
                    option.name === question.correctTrack.name
                      ? "correct-song"
                      : ""
                  }`}
                  key={option.id}
                  disabled={Boolean(duelSelectedAnswer)}
                  onClick={() => handleDuelAnswer(option.name)}
                >
                  {option.name}
                </button>
              ))}
            </div>

            <p className="score score-live">
              Duel score: {duelScore.toLocaleString()}
            </p>
          </section>
        );
      }

      return (
        <section className="duel-room-screen">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setActiveRoom(null)}
          >
            Back to Duel Lobby
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void refreshActiveRoom()}
          >
            Refresh Room
          </button>

          <div className="duel-room-hero">
            {activeRoom.artworkUrl && (
              <img src={activeRoom.artworkUrl} alt="" aria-hidden />
            )}
            <div>
              <p className="eyebrow">Duel Room</p>
              <h2>{activeRoom.albumName}</h2>
              <p>{activeRoom.artistName}</p>
              <span>
                {activeRoom.status === "active" ? "Active" : "Waiting to start"}
              </span>
            </div>
          </div>

          <div className="duel-player-grid">
            <div className="duel-player-card">
              <span>Host</span>
              <strong>{hostPlayer?.displayName || "Arena host"}</strong>
              {hostPlayer?.username && <p>@{hostPlayer.username}</p>}
              {hostPlayer?.isReady && <small>Ready</small>}
            </div>
            <div className="duel-player-card">
              <span>Joined Player</span>
              <strong>{guestPlayer?.displayName || "Waiting for rival"}</strong>
              {guestPlayer?.username && <p>@{guestPlayer.username}</p>}
              {guestPlayer?.isReady && <small>Ready</small>}
            </div>
          </div>

          {currentPlayer && !currentPlayer.isReady && (
            <button
              type="button"
              className="duel-start-button"
              disabled={activeRoom.players.length < 2 || isPreparingDuel}
              onClick={() => void handleReadyForDuel()}
            >
              {isPreparingDuel ? "Preparing..." : "Ready"}
            </button>
          )}
          {currentPlayer?.isReady && <p className="arena-note">You are ready.</p>}
          <p className="arena-note">
            Both players must press Ready. When both are ready, the same shared
            question set starts for everyone.
          </p>
        </section>
      );
    }

    return (
      <section className="duel-lobby">
        <div className="duel-builder">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Create Duel</p>
              <h2>Pick an album</h2>
            </div>
            <span>1v1 lobby</span>
          </div>

          {!session && (
            <p className="arena-note">
              Log in to create or join Duel rooms.
            </p>
          )}

          <form className="search-box" onSubmit={handleSearch}>
            <input
              type="search"
              placeholder="Album or artist..."
              value={searchTerm}
              aria-label="Search for a Duel album"
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? "Searching..." : "Search"}
            </button>
          </form>

          {albums.length > 0 && (
            <div className="duel-album-grid">
              {albums.map((album) => (
                <button
                  type="button"
                  className={`duel-album-card ${
                    selectedAlbum?.id === album.id ? "selected" : ""
                  }`}
                  onClick={() => setSelectedAlbum(album)}
                  key={album.id}
                >
                  {album.imageUrl && (
                    <img src={album.imageUrl} alt={`${album.title} cover`} />
                  )}
                  <span>
                    <strong>{album.title}</strong>
                    <small>{album.artist}</small>
                  </span>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className="duel-create-button"
            disabled={!selectedAlbum || isCreatingRoom || !session}
            onClick={handleCreateRoom}
          >
            {isCreatingRoom ? "Creating..." : "Create Duel Room"}
          </button>
        </div>

        <div className="duel-open-rooms">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Open Duel Rooms</p>
              <h2>Waiting Rooms</h2>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void loadOpenRooms()}
            >
              Refresh Rooms
            </button>
          </div>

          {isLoadingRooms ? (
            <p className="empty-stats">Loading open rooms...</p>
          ) : rooms.length > 0 ? (
            <div className="duel-room-list">
              {rooms.map((room) => {
                const isAlreadyInRoom = Boolean(
                  session?.user &&
                    room.players.some((player) => player.userId === session.user.id)
                );
                const isFull = room.players.length >= room.maxPlayers;
                const actionLabel = !session
                  ? "Login to Join"
                  : isAlreadyInRoom
                    ? "Enter Room"
                    : isFull
                      ? "Room Full"
                      : "Join Room";

                return (
                  <article className="duel-room-card" key={room.id}>
                    {room.artworkUrl && (
                      <img src={room.artworkUrl} alt="" aria-hidden />
                    )}
                    <div>
                      <strong>{room.albumName}</strong>
                      <span>{room.artistName}</span>
                      <small>Host: {getHostName(room)}</small>
                    </div>
                    <span className="duel-room-status">{room.status}</span>
                    <span className="duel-room-count">
                      {room.players.length}/{room.maxPlayers}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleJoinRoom(room)}
                      disabled={!session || (isFull && !isAlreadyInRoom)}
                    >
                      {actionLabel}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="empty-stats">
              No open Duel rooms yet. Create the first one.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="arena-page">
      <div className="arena-hero">
        <p className="eyebrow">TrackTest Arena</p>
        <h1>Arena Modes</h1>
        <p>
          The multiplayer wing is being built for duels, live rooms, parties,
          and championship runs.
        </p>
      </div>

      <div className="arena-status">
        <span>{isDuelOpen ? "Lobby Foundation" : "Coming Soon"}</span>
        <div>
          <h2>{isDuelOpen ? "Duel lobbies are live" : "Arena is coming soon"}</h2>
          <p>
            {isDuelOpen
              ? "Create or join a waiting Duel room. Gameplay starts in a later pass."
              : "Solo stats, badges, profiles, and leaderboards are laying the foundation before live rooms open."}
          </p>
        </div>
      </div>

      <div className="arena-mode-grid">
        {arenaModes.map((mode) => {
          const isDuel = mode.title === "Duel";

          return (
            <button
              type="button"
              className={`arena-mode-card arena-mode-${mode.accent} ${
                isDuelOpen && isDuel ? "active" : ""
              }`}
              key={mode.title}
              onClick={() => {
                if (isDuel) {
                  setIsDuelOpen(true);
                }
              }}
              disabled={!mode.enabled}
            >
              <span className="arena-mode-label">{mode.label}</span>
              <h2>{mode.title}</h2>
              <p>{mode.description}</p>
              <strong>{mode.enabled ? "Open Lobby" : "Coming soon"}</strong>
            </button>
          );
        })}
      </div>

      {message && <p className="arena-message">{message}</p>}
      {isDuelOpen && renderDuelLobby()}

      <button type="button" onClick={onPlay}>
        Back to Play
      </button>
    </section>
  );
}

export default ArenaPage;
