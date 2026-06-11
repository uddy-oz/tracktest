import { useState } from "react";

const fakeAlbums = [
  {
    id: 1,
    title: "Take Care",
    artist: "Drake",
    year: "2011",
  },
  {
    id: 2,
    title: "Nothing Was The Same",
    artist: "Drake",
    year: "2013",
  },
  {
    id: 3,
    title: "Scorpion",
    artist: "Drake",
    year: "2018",
  },
];

type AlbumSearchProps = {
  onStartQuiz: (albumTitle: string) => void;
};

function AlbumSearch({ onStartQuiz }: AlbumSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState("");

  function handleSearch() {
    if (searchTerm.trim() === "") {
      return;
    }

    setSubmittedSearch(searchTerm);
    setSelectedAlbum("");
  }

  return (
    <section className="album-search">
      <h2>Choose an album</h2>

      <p>Search for an album and TrackTest will turn it into a quiz.</p>

      <div className="search-box">
        <input
          type="text"
          placeholder="Search for an album..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        <button onClick={handleSearch}>Search</button>
      </div>

      {submittedSearch && (
        <>
          <p className="search-result">
            Showing results for: <strong>{submittedSearch}</strong>
          </p>

          <div className="album-grid">
            {fakeAlbums.map((album) => (
              <button
                className="album-card"
                key={album.id}
                onClick={() => setSelectedAlbum(album.title)}
              >
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
      Selected album: <strong>{selectedAlbum}</strong>
    </p>

    <button onClick={() => onStartQuiz(selectedAlbum)}>Start Quiz</button>
  </div>
)}
    </section>
  );
}

export default AlbumSearch;