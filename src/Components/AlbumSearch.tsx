import { useState } from "react";
import type { FormEvent } from "react";
import type { SpotifyAlbum } from "../lib/spotifyApi";
import { searchSpotifyAlbums } from "../lib/spotifyApi";

type AlbumSearchProps = {
  onStartQuiz: (album: SpotifyAlbum) => void;
};

const ALBUMS_PER_PAGE = 12;
const MAX_VISIBLE_ALBUMS = 48;

function AlbumSearch({ onStartQuiz }: AlbumSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [visibleAlbumCount, setVisibleAlbumCount] = useState(ALBUMS_PER_PAGE);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const cappedAlbums = albums.slice(0, MAX_VISIBLE_ALBUMS);
  const visibleAlbums = cappedAlbums.slice(0, visibleAlbumCount);
  const hasMoreAlbums = visibleAlbums.length < cappedAlbums.length;

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (searchTerm.trim() === "" || isLoading) {
      return;
    }

    try {
      setIsLoading(true);
      setError("");
      setSubmittedSearch(searchTerm);
      setSelectedAlbum(null);
      setVisibleAlbumCount(ALBUMS_PER_PAGE);

      const results = await searchSpotifyAlbums(searchTerm);
      setAlbums(results);
    } catch (error) {
      console.error(error);
      setError("Could not search albums. Try again or search another album.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSelectAlbum(album: SpotifyAlbum) {
    setSelectedAlbum(album.id === selectedAlbum?.id ? null : album);
  }

  function handleViewMoreAlbums() {
    setVisibleAlbumCount((currentCount) =>
      Math.min(currentCount + ALBUMS_PER_PAGE, MAX_VISIBLE_ALBUMS, albums.length)
    );
  }

  return (
    <section className="album-search" id="album-search">
      <p className="eyebrow">Step one</p>
      <h2>Pick your battlefield</h2>

      <p className="section-sub">
        Search any album. Select one. TrackTest Arena will build the quiz.
      </p>

      <form className="search-box" onSubmit={handleSearch}>
        <input
          type="search"
          placeholder="Album or artist..."
          value={searchTerm}
          aria-label="Search for an album or artist"
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        <button type="submit" disabled={isLoading}>
          {isLoading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && <p className="search-result">{error}</p>}

      {submittedSearch && !error && !isLoading && albums.length === 0 && (
        <p className="search-result">
          Nothing found for: <strong>{submittedSearch}</strong>
        </p>
      )}

      {submittedSearch && !error && albums.length > 0 && (
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
