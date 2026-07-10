import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  createDuelRoom,
  fetchOpenDuelRooms,
  joinDuelRoom,
  type ArenaRoom,
} from "../lib/arenaRooms";
import type { UserProfile } from "../lib/profiles";
import { searchSpotifyAlbums, type SpotifyAlbum } from "../lib/spotifyApi";

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

  useEffect(() => {
    if (isDuelOpen) {
      void loadOpenRooms();
    }
  }, [isDuelOpen]);

  async function loadOpenRooms() {
    setIsLoadingRooms(true);
    const { rooms: nextRooms, error } = await fetchOpenDuelRooms();

    setRooms(nextRooms);
    setMessage(error || "");
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
      await loadOpenRooms();
    }

    setMessage(error || "");
    setIsCreatingRoom(false);
  }

  async function handleJoinRoom(room: ArenaRoom) {
    if (!session?.user) {
      onLogin();
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
      await loadOpenRooms();
    }

    setMessage(error || "");
  }

  function getHostName(room: ArenaRoom) {
    const hostPlayer = room.players.find(
      (player) => player.userId === room.hostUserId
    );

    return hostPlayer?.displayName || hostPlayer?.username || "Arena host";
  }

  function renderDuelLobby() {
    if (activeRoom) {
      const isHost = activeRoom.hostUserId === session?.user.id;
      const hostPlayer = activeRoom.players.find(
        (player) => player.userId === activeRoom.hostUserId
      );
      const guestPlayer = activeRoom.players.find(
        (player) => player.userId !== activeRoom.hostUserId
      );

      return (
        <section className="duel-room-screen">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setActiveRoom(null)}
          >
            Back to Duel Lobby
          </button>

          <div className="duel-room-hero">
            {activeRoom.artworkUrl && (
              <img src={activeRoom.artworkUrl} alt="" aria-hidden />
            )}
            <div>
              <p className="eyebrow">Duel Room</p>
              <h2>{activeRoom.albumName}</h2>
              <p>{activeRoom.artistName}</p>
              <span>Waiting to start</span>
            </div>
          </div>

          <div className="duel-player-grid">
            <div className="duel-player-card">
              <span>Host</span>
              <strong>{hostPlayer?.displayName || "Arena host"}</strong>
              {hostPlayer?.username && <p>@{hostPlayer.username}</p>}
            </div>
            <div className="duel-player-card">
              <span>Joined Player</span>
              <strong>{guestPlayer?.displayName || "Waiting for rival"}</strong>
              {guestPlayer?.username && <p>@{guestPlayer.username}</p>}
            </div>
          </div>

          {isHost && (
            <button type="button" className="duel-start-button" disabled>
              Start Duel
            </button>
          )}
          <p className="arena-note">
            Gameplay start is coming next. This room confirms create and join
            flow only.
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
            <button type="button" className="secondary-button" onClick={loadOpenRooms}>
              Refresh
            </button>
          </div>

          {isLoadingRooms ? (
            <p className="empty-stats">Loading open rooms...</p>
          ) : rooms.length > 0 ? (
            <div className="duel-room-list">
              {rooms.map((room) => (
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
                    disabled={!session || room.players.length >= room.maxPlayers}
                  >
                    Join Room
                  </button>
                </article>
              ))}
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
