import { useState } from "react";
import type { SpotifyAlbum } from "../lib/spotifyApi";
import { searchSpotifyAlbums } from "../lib/spotifyApi";

type AlbumSearchProps = {
  onStartQuiz: (album: SpotifyAlbum) => void;
};

function AlbumSearch({ onStartQuiz }: AlbumSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
 const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSearch() {
    if (searchTerm.trim() === "") {
      return;
    }

    try {
      setIsLoading(true);
      setError("");
      setSubmittedSearch(searchTerm);
      setSelectedAlbum(null);

      const results = await searchSpotifyAlbums(searchTerm);
      setAlbums(results);
    } catch (error) {
      console.error(error);
      setError("Could not search albums. Try again or search another album.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="album-search">
      <h2>Choose an album</h2>

      <p>Search for an album and TrackTest Arena will turn it into a quiz.</p>

      <div className="search-box">
        <input
          type="text"
          placeholder="Search for an album..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        <button onClick={handleSearch}>
          {isLoading ? "Searching..." : "Search"}
        </button>
      </div>

      {error && <p className="search-result">{error}</p>}

      {submittedSearch && !error && (
        <>
          <p className="search-result">
            Showing results for: <strong>{submittedSearch}</strong>
          </p>

          <div className="album-grid">
            {albums.map((album) => (
              <button
                className="album-card"
                key={album.id}
                onClick={() => setSelectedAlbum(album)}
              >
                {album.imageUrl && (
                  <img
                    className="album-cover"
                    src={album.imageUrl}
                    alt={`${album.title} cover`}
                  />
                )}

                <h3>{album.title}</h3>
                <p>{album.artist}</p>
                <span>{album.year}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {selectedAlbum && (
  <div className="selected-album">
    <p>
      Selected album: <strong>{selectedAlbum.title}</strong>
    </p>

    <button onClick={() => onStartQuiz(selectedAlbum)}>
      Start Quiz
    </button>
  </div>
)}
    </section>
  );
}

export default AlbumSearch;
