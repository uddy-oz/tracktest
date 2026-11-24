import { Play, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { captureAnalytics } from "../lib/analytics";
import { discoveryPlayPath, featuredAlbums, featuredArtists } from "../lib/featuredDiscovery";
import "./HomeDiscovery.css";

type Props = { navigate: (path: string) => void };

export function HomeDiscoverySearch({ navigate }: Props) {
  const [query, setQuery] = useState("");
  return (
      <form className="home-discovery-search" role="search" onSubmit={event => {
        event.preventDefault();
        const term = query.trim().slice(0, 240);
        if (term.length >= 2) navigate(discoveryPlayPath(term, "home_search"));
      }}>
        <Search size={18} aria-hidden="true" />
        <input type="search" aria-label="Search albums or artists" placeholder="Search albums or artists" value={query} onChange={event => setQuery(event.target.value)} />
        <button type="submit">Search</button>
      </form>
  );
}

export default function HomeDiscovery({ navigate }: Props) {
  useEffect(() => captureAnalytics("discovery_viewed", { surface: "home_feature" }, "home-discovery"), []);
  return (
    <section className="home-discovery" aria-labelledby="featured-albums">
      <div className="home-discovery-heading">
        <h2 id="featured-albums">Featured Albums</h2>
        <span>Staff picks</span>
      </div>
      <ul className="home-discovery-albums">
        {featuredAlbums.map((album, index) => (
          <li key={album.id}>
            <button type="button" className="home-discovery-album" data-tone={album.tone}
              onClick={() => navigate(discoveryPlayPath(album.title, "home_feature", album.id))}>
              <span className="home-discovery-art" data-edition={index + 1}>
                <span className="home-discovery-edition" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span>{album.genre}</span>
                <Play size={16} fill="currentColor" aria-hidden="true" />
              </span>
              <strong>{album.title}</strong>
              <span>{album.artist}</span>
            </button>
          </li>
        ))}
      </ul>
      <h2 id="explore-artists">Explore Artists</h2>
      <ul className="home-discovery-artists" aria-labelledby="explore-artists">
        {featuredArtists.map(([artist, genre], index) => (
          <li key={artist}>
            <button type="button" className="secondary-button" onClick={() => navigate(discoveryPlayPath(artist, "artist"))}>
              <span className="home-artist-avatar" data-edition={index + 1} aria-hidden="true">
                {artist.split(" ").slice(0, 2).map(word => word[0]).join("")}
              </span>
              <strong>{artist}</strong><small>{genre}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
