import { ChevronLeft, ChevronRight, Play, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { captureAnalytics } from "../lib/analytics";
import { discoveryPlayPath } from "../lib/featuredDiscovery";
import { approvedDailyArtistPhotos, approvedDailyCoverIds } from "../lib/dailyPickCatalog";
import { dailyPickHash, formatDailyPickCountdown, getDailyPicks } from "../lib/dailyPicks";
import { lookupSharedAlbum } from "../lib/spotifyApi";
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

const coverCache = new Map<string, string>();
const localCoverIds = new Set<string>(import.meta.env.DEV
  ? (import.meta.env.VITE_LOCAL_DAILY_COVER_IDS ?? "").split(",").map((id: string) => id.trim())
  : []);
const motif = (key: string) => dailyPickHash(key) % 8 + 1;

function ApprovedCover({ id }: { id: string }) {
  const target = useRef<HTMLSpanElement>(null);
  const [cover, setCover] = useState(() => coverCache.get(id) ?? "");
  useEffect(() => {
    if (coverCache.has(id)) return;
    const controller = new AbortController();
    const load = () => {
      void lookupSharedAlbum(id, controller.signal).then(album => {
        if (controller.signal.aborted || !album?.imageUrl) return;
        const url = new URL(album.imageUrl);
        if (url.protocol !== "https:" || !url.hostname.endsWith(".mzstatic.com")) return;
        const square = url.href.replace(/600x600(?=bb)/, "400x400");
        coverCache.set(id, square);
        setCover(square);
      }).catch(() => {});
    };
    const observer = typeof IntersectionObserver !== "undefined" && target.current
      ? new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { observer?.disconnect(); load(); }
      }, { rootMargin: "120px" }) : null;
    if (observer && target.current) observer.observe(target.current);
    else load();
    return () => { observer?.disconnect(); controller.abort(); };
  }, [id]);
  return <span ref={target} className="daily-cover-slot">{cover &&
    <img src={cover} alt="" decoding="async" loading="lazy" width={400} height={400} onError={() => setCover("")} />}
  </span>;
}

function ArtistPhoto({ artist }: { artist: string }) {
  const [failed, setFailed] = useState(false);
  const image = Object.hasOwn(approvedDailyArtistPhotos, artist) && approvedDailyArtistPhotos[artist];
  return image && !failed ? <img src={image} alt="" width={64} height={64} decoding="async"
    loading="lazy" onError={() => setFailed(true)} /> : null;
}

export default function HomeDiscovery({ navigate, now, synced }: Props & { now: Date; synced: boolean }) {
  const { albums, artists, day, endsAt } = getDailyPicks(now);
  const shelf = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const list = shelf.current;
    if (!list) return;
    function update() {
      if (!list) return;
      setEdges({
        start: list.scrollLeft <= 1,
        end: list.scrollLeft + list.clientWidth >= list.scrollWidth - 1,
      });
    }
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, []);
  function scrollPicks(direction: number) {
    const list = shelf.current;
    if (!list) return;
    list.scrollBy({
      left: direction * list.clientWidth * .8,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }
  useEffect(() => captureAnalytics("discovery_viewed", { surface: "daily_picks" }, `daily-picks:${day}`), [day]);
  return (
    <section className="home-discovery" aria-labelledby="daily-picks">
      <div className="home-discovery-heading">
        <h2 id="daily-picks">Daily Picks</h2>
        <div className="daily-picks-controls">
          <span title={synced ? "Rotates at midnight UTC" : "Offline estimate; rotates at midnight UTC"}>
            Next in {formatDailyPickCountdown(now, endsAt)}
          </span>
          <button type="button" aria-label="Previous Daily Picks" aria-controls="daily-picks-carousel"
            disabled={edges.start} onClick={() => scrollPicks(-1)}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Next Daily Picks" aria-controls="daily-picks-carousel"
            disabled={edges.end} onClick={() => scrollPicks(1)}><ChevronRight size={18} /></button>
        </div>
      </div>
      <ul className="home-discovery-albums" id="daily-picks-carousel" ref={shelf} aria-labelledby="daily-picks">
        {albums.map(album => (
          <li key={album.id}>
            <button type="button" className="home-discovery-album"
              aria-label={`Play ${album.title} by ${album.artist}`}
              onClick={() => navigate(discoveryPlayPath(album.title, "daily_picks", album.id))}>
              <span className="home-discovery-art" data-edition={motif(album.id)} aria-hidden="true">
                {(approvedDailyCoverIds.has(album.id) || localCoverIds.has(album.id)) && <ApprovedCover id={album.id} />}
              </span>
              <span className="daily-pick-details">
                <strong>{album.title}</strong>
                <span>{album.artist}</span>
                <span className="daily-pick-play"><Play size={15} fill="currentColor" aria-hidden="true" /></span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <h2 id="explore-artists">Explore Artists</h2>
      <ul className="home-discovery-artists" aria-labelledby="explore-artists">
        {artists.map(({artist, genre}) => (
          <li key={artist}>
            <button type="button" className="secondary-button" onClick={() => navigate(discoveryPlayPath(artist, "artist"))}>
              <span className="home-artist-avatar" data-edition={motif(artist)} aria-hidden="true">
                {artist.split(" ").slice(0, 2).map(word => word[0]).join("")}
                <ArtistPhoto artist={artist} />
              </span>
              <strong>{artist}</strong><small>{genre}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
