import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { SpotifyAlbum, SpotifyArtist } from "../lib/spotifyApi";
import {
  prefetchSpotifyAlbumTracks,
  searchSpotifyAlbums,
  searchSpotifyArtists,
} from "../lib/spotifyApi";

type AlbumSearchProps = {
  onStartQuiz: (album: SpotifyAlbum) => void;
  compact?: boolean;
};

const ALBUMS_PER_PAGE = 12;
const MAX_VISIBLE_ALBUMS = 48;
const SEARCH_DEBOUNCE_MS = 450;
type SearchMode = "albums" | "artists";

function AlbumSearch({ onStartQuiz, compact = false }: AlbumSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [artists, setArtists] = useState<SpotifyArtist[]>([]);
  const [searchMode, setSearchMode] = useState<SearchMode>("albums");
  const [visibleAlbumCount, setVisibleAlbumCount] = useState(ALBUMS_PER_PAGE);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const searchRequestRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);

  const cappedAlbums = albums.slice(0, MAX_VISIBLE_ALBUMS);
  const visibleAlbums = cappedAlbums.slice(0, visibleAlbumCount);
  const hasMoreAlbums = visibleAlbums.length < cappedAlbums.length;

  const runSearch = useCallback(async (rawQuery: string, mode = searchMode) => {
    const query = rawQuery.trim();
    if (query.length < 2) {
      return;
    }

    searchRequestRef.current?.abort();
    const controller = new AbortController();
    const sequence = ++searchSequenceRef.current;
    searchRequestRef.current = controller;
    try {
      setIsLoading(true);
      setError("");
      setSubmittedSearch(query);
      setVisibleAlbumCount(ALBUMS_PER_PAGE);

      if (mode === "artists") {
        const results = await searchSpotifyArtists(query, {
          signal: controller.signal,
        });
        if (sequence === searchSequenceRef.current) {
          setArtists(results);
          setAlbums([]);
        }
      } else {
        const results = await searchSpotifyAlbums(query, {
          signal: controller.signal,
        });
        if (sequence === searchSequenceRef.current) {
          setAlbums(results);
          setArtists([]);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error(error);
      setError(
        mode === "artists"
          ? "Could not search artists. Try again."
          : "Could not search albums. Try again or search another album."
      );
    } finally {
      if (sequence === searchSequenceRef.current) setIsLoading(false);
    }
  }, [searchMode]);

  useEffect(() => {
    const query = searchTerm.trim();
    if (query.length < 2) return;

    const debounceId = window.setTimeout(() => {
      void runSearch(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(debounceId);
  }, [runSearch, searchTerm]);

  useEffect(
    () => () => {
      searchRequestRef.current?.abort();
    },
    []
  );

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(searchTerm);
  }

  function handleSearchModeChange(mode: SearchMode) {
    if (mode === searchMode) return;
    searchRequestRef.current?.abort();
    searchSequenceRef.current += 1;
    setSearchMode(mode);
    setAlbums([]);
    setArtists([]);
    setSelectedAlbum(null);
    setSubmittedSearch("");
    setError("");
    setIsLoading(false);
  }

  function handleExploreArtist(artist: SpotifyArtist) {
    setSearchMode("albums");
    setSearchTerm(artist.name);
    setSelectedAlbum(null);
    void runSearch(artist.name, "albums");
  }

  function handleSelectAlbum(album: SpotifyAlbum) {
    setSelectedAlbum(album.id === selectedAlbum?.id ? null : album);
    prefetchSpotifyAlbumTracks(album.id);
  }

  function handleViewMoreAlbums() {
    setVisibleAlbumCount((currentCount) =>
      Math.min(currentCount + ALBUMS_PER_PAGE, MAX_VISIBLE_ALBUMS, albums.length)
    );
  }

  return (
    <section
      className={`album-search ${compact ? "album-search-compact" : ""}`}
      id="album-search"
    >
      <p className="eyebrow">Start a new run</p>
      <h2>Choose an album</h2>

      <p className="section-sub">
        Find an album or explore an artist's available releases.
      </p>

      <div className="music-search-tabs" role="tablist" aria-label="Music search category">
        <button
          type="button"
          role="tab"
          aria-selected={searchMode === "albums"}
          className={searchMode === "albums" ? "is-active" : ""}
          onClick={() => handleSearchModeChange("albums")}
        >
          Albums &amp; EPs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={searchMode === "artists"}
          className={searchMode === "artists" ? "is-active" : ""}
          onClick={() => handleSearchModeChange("artists")}
        >
          Artists
        </button>
        <button type="button" role="tab" aria-selected="false" disabled>
          Playlists
          <small>Later</small>
        </button>
      </div>

      <form className="search-box" onSubmit={handleSearch}>
        <input
          type="search"
          placeholder={
            searchMode === "artists" ? "Search artists..." : "Album or artist..."
          }
          value={searchTerm}
          aria-label={
            searchMode === "artists" ? "Search for an artist" : "Search for an album or artist"
          }
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        <button type="submit" disabled={isLoading}>
          {isLoading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && <p className="search-result">{error}</p>}

      {isLoading && albums.length === 0 && artists.length === 0 && (
        <div className="album-grid album-grid-loading" aria-label="Loading albums">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="album-card album-card-skeleton" key={index} aria-hidden>
              <span className="skeleton-cover" />
              <span className="skeleton-line skeleton-line-title" />
              <span className="skeleton-line" />
            </div>
          ))}
        </div>
      )}

      {submittedSearch && !error && !isLoading && albums.length === 0 && artists.length === 0 && (
        <p className="search-result">
          No matching {searchMode === "artists" ? "artists" : "albums or EPs"} found for:{" "}
          <strong>{submittedSearch}</strong>
        </p>
      )}

      {searchMode === "albums" && submittedSearch && !error && albums.length > 0 && (
        <>
          <p className="search-result">
            Showing results for: <strong>{submittedSearch}</strong>
          </p>
          <p className="album-result-count">
            Showing {visibleAlbums.length} of {cappedAlbums.length} results
          </p>

          <div className="album-grid">
            {visibleAlbums.map((album, index) => (
              <button
                type="button"
                className={`album-card ${
                  selectedAlbum?.id === album.id ? "selected-card" : ""
                }`}
                style={{ animationDelay: `${index * 60}ms` }}
                key={album.id}
                onClick={() => handleSelectAlbum(album)}
                aria-pressed={selectedAlbum?.id === album.id}
              >
                <span className="card-check" aria-hidden>
                  OK
                </span>

                {album.imageUrl && (
                  <span className="album-cover-frame">
                    <img
                      className="album-cover"
                      src={album.imageUrl}
                      alt={`${album.title} cover`}
                      loading="lazy"
                    />
                  </span>
                )}

                <h3>{album.title}</h3>
                <p>{album.artist}</p>
                <span className="album-year">{album.year}</span>
              </button>
            ))}
          </div>

          {hasMoreAlbums && (
            <button
              type="button"
              className="view-more-albums"
              onClick={handleViewMoreAlbums}
            >
              View more albums
            </button>
          )}
        </>
      )}

      {searchMode === "artists" && submittedSearch && !error && artists.length > 0 && (
        <>
          <p className="search-result">
            Artists matching: <strong>{submittedSearch}</strong>
          </p>
          <div className="artist-search-grid">
            {artists.map((artist) => (
              <article className="artist-search-card" key={artist.id}>
                {artist.imageUrl ? (
                  <img src={artist.imageUrl} alt="" aria-hidden loading="lazy" />
                ) : (
                  <span className="artist-image-fallback" aria-hidden>
                    {artist.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div>
                  <h3>{artist.name}</h3>
                  <p>{artist.genre}</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleExploreArtist(artist)}
                >
                  Explore albums
                </button>
              </article>
            ))}
          </div>
          <p className="artist-search-note">
            Artist quizzes are not enabled yet. Explore an artist to choose an album.
          </p>
        </>
      )}

      {selectedAlbum && (
        <div className="start-bar">
          {selectedAlbum.imageUrl && (
            <img src={selectedAlbum.imageUrl} alt="" aria-hidden />
          )}

          <div className="start-bar-info">
            <strong>{selectedAlbum.title}</strong>
            <span>{selectedAlbum.artist}</span>
          </div>

          <button type="button" onClick={() => onStartQuiz(selectedAlbum)}>
            Start Quiz
          </button>
        </div>
      )}
    </section>
  );
}

export default AlbumSearch;
