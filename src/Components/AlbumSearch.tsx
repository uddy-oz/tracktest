import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import type { SpotifyAlbum, SpotifyArtist } from "../lib/spotifyApi";
import {
  lookupSharedAlbum,
  prefetchSpotifyAlbumTracks,
  searchSpotifyAlbums,
  searchSpotifyArtists,
} from "../lib/spotifyApi";
import { isCatalogDiscoveryEnabled } from "../lib/catalogFeatureFlags";
import { captureAnalytics } from "../lib/analytics";
import type { DiscoverySurface } from "../lib/featuredDiscovery";

const CatalogDiscovery = lazy(() => import("./CatalogDiscovery"));

type AlbumSearchProps = {
  onStartQuiz: (album: SpotifyAlbum, surface?: DiscoverySurface) => void;
  compact?: boolean;
  inPicker?: boolean;
  starting?: boolean;
  initialQuery?: string;
  initialAlbumId?: string;
  surface?: DiscoverySurface;
};

const ALBUMS_PER_PAGE = 12;
const MAX_VISIBLE_ALBUMS = 48;
const SEARCH_DEBOUNCE_MS = 450;
type SearchMode = "albums" | "artists" | "playlists";

function AlbumSearch({ onStartQuiz, compact = false, inPicker = false, starting = false, initialQuery = "", initialAlbumId, surface = "search" }: AlbumSearchProps) {
  const [searchTerm, setSearchTerm] = useState(initialQuery);
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
  const initialLookupHandled = useRef(false);
  const [exactUnavailable, setExactUnavailable] = useState(false);

  const cappedAlbums = albums.slice(0, MAX_VISIBLE_ALBUMS);
  const visibleAlbums = cappedAlbums.slice(0, visibleAlbumCount);
  const hasMoreAlbums = visibleAlbums.length < cappedAlbums.length;
  const isDiscoveryMode =
    !inPicker && isCatalogDiscoveryEnabled &&
    (searchMode === "artists" || searchMode === "playlists");

  const runSearch = useCallback(async (rawQuery: string, mode = searchMode) => {
    const query = rawQuery.trim();
    if (query.length < 2 && !(mode === "albums" && initialAlbumId && query === initialQuery)) {
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
        const isExactLookup = Boolean(initialAlbumId && query === initialQuery && !initialLookupHandled.current);
        const exact = isExactLookup && initialAlbumId
          ? await lookupSharedAlbum(initialAlbumId, controller.signal).catch(() => null)
          : null;
        if (controller.signal.aborted) return;
        if (isExactLookup) {
          initialLookupHandled.current = true;
          setExactUnavailable(!exact);
          captureAnalytics("album_lookup", {surface, album_id: initialAlbumId, lookup: exact ? "exact" : "fallback"});
          if (exact) {
            setSelectedAlbum(exact);
            captureAnalytics("album_selected", {surface, album_id: exact.id, artist_id: exact.artistId});
          }
        }
        const results = exact ? [exact] : await searchSpotifyAlbums(query, {
          signal: controller.signal,
        });
        if (sequence === searchSequenceRef.current) {
          setAlbums(results);
          setArtists([]);
        }
      }
    } catch (error) {
      if (sequence !== searchSequenceRef.current || controller.signal.aborted) return;
      console.error(error);
      setError(
        mode === "artists"
          ? "Could not search artists. Try again."
          : "Could not search albums. Try again or search another album."
      );
    } finally {
      if (sequence === searchSequenceRef.current) setIsLoading(false);
    }
  }, [searchMode, initialAlbumId, initialQuery, surface]);

  useEffect(() => {
    if (isDiscoveryMode) return;
    const query = searchTerm.trim();
    if (query.length < 2 && !(searchMode === "albums" && initialAlbumId && query === initialQuery)) return;

    const debounceId = window.setTimeout(() => {
      void runSearch(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(debounceId);
  }, [isDiscoveryMode, runSearch, searchTerm, searchMode, initialAlbumId, initialQuery]);

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
    if (!inPicker && selectedAlbum?.id !== album.id) captureAnalytics("album_selected", {surface, album_id: album.id, artist_id: album.artistId});
    setSelectedAlbum(album.id === selectedAlbum?.id ? null : album);
    prefetchSpotifyAlbumTracks(album.id);
  }

  function handleViewMoreAlbums() {
    setVisibleAlbumCount((currentCount) =>
      Math.min(currentCount + ALBUMS_PER_PAGE, MAX_VISIBLE_ALBUMS, albums.length)
    );
  }

  const startBar = selectedAlbum && (
    <div className={`start-bar${initialAlbumId ? " discovery-start-bar" : ""}`}>
      {selectedAlbum.imageUrl && <img src={selectedAlbum.imageUrl} alt="" aria-hidden decoding="async" />}
      <div className="start-bar-info"><strong>{selectedAlbum.title}</strong><span>{selectedAlbum.artist}</span></div>
      <button type="button" disabled={starting} onClick={() => onStartQuiz(selectedAlbum, inPicker ? undefined : surface)}>
        {starting ? "Starting..." : "Start Quiz"}
      </button>
    </div>
  );

  return (
    <section
      className={`album-search ${compact ? "album-search-compact" : ""}`}
      id="album-search"
    >
      {!inPicker && <><p className="eyebrow">
        {isDiscoveryMode ? "StanZer discovery" : "Start a new run"}
      </p>
      <h2>{isDiscoveryMode ? "Explore future modes" : initialAlbumId && selectedAlbum ? "Ready to play" : "Choose an album"}</h2></>}
      {initialAlbumId && startBar}
      {exactUnavailable && searchTerm.trim() === initialQuery && searchMode === "albums" &&
        <p role="status">This exact edition is unavailable. Choose another result below or try a different search.</p>}

      <p className="section-sub">
        {isDiscoveryMode
          ? "Browse future quiz sources without changing your current game."
          : "Find an album or explore an artist's available releases."}
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
        {!inPicker && <button
          type="button"
          role="tab"
          aria-selected={searchMode === "playlists"}
          className={searchMode === "playlists" ? "is-active" : ""}
          disabled={!isCatalogDiscoveryEnabled}
          onClick={() => handleSearchModeChange("playlists")}
        >
          Playlists
          <small>{isCatalogDiscoveryEnabled ? "Preview" : "Later"}</small>
        </button>}
      </div>

      {!isDiscoveryMode && (
        <form className="search-box" onSubmit={handleSearch}>
          <input
            type="search"
            placeholder={
              searchMode === "artists" ? "Search artists..." : "Album or artist..."
            }
            value={searchTerm}
            aria-label={
              searchMode === "artists"
                ? "Search for an artist"
                : "Search for an album or artist"
            }
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          <button type="submit" disabled={isLoading}>
            {isLoading ? "Searching..." : "Search"}
          </button>
        </form>
      )}

      {!isDiscoveryMode && error && <p className="search-result" role="alert">{error}</p>}

      {!isDiscoveryMode && isLoading && albums.length === 0 && artists.length === 0 && (
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

      {!isDiscoveryMode && submittedSearch && !error && !isLoading && albums.length === 0 && artists.length === 0 && (
        <p className="search-result" role="status">
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
                      decoding="async"
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
                  <img
                    src={artist.imageUrl}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                  />
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

      {isDiscoveryMode && (
        <Suspense
          fallback={
            <div className="catalog-state catalog-discovery-loading" role="status">
              <strong>Loading discovery...</strong>
            </div>
          }
        >
          <CatalogDiscovery
            key={searchMode}
            mode={searchMode === "playlists" ? "playlists" : "artists"}
          />
        </Suspense>
      )}

      {!initialAlbumId && startBar}
    </section>
  );
}

export default AlbumSearch;
