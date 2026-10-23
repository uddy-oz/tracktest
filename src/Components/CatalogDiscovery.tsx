import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type {
  CatalogAdapter,
  CatalogAlbum,
  CatalogArtist,
  CatalogPage,
  CatalogPlaylist,
  CatalogTrack,
} from "../lib/catalog";
import {
  createAppleMusicCatalogAdapter,
  withCatalogConfigurationFallback,
} from "../lib/appleMusicCatalogAdapter";
import { isAppleMusicCatalogEnabled } from "../lib/catalogFeatureFlags";
import { mockCatalogAdapter } from "../lib/mockCatalogAdapter";

type DiscoveryMode = "artists" | "playlists";
type DiscoveryItem = CatalogArtist | CatalogPlaylist;

type CatalogDiscoveryProps = {
  mode: DiscoveryMode;
  adapter?: CatalogAdapter;
};

type LoadItemsOptions = {
  append?: boolean;
  cursor?: string | null;
};

const DISCOVERY_PAGE_SIZE = 6;
const DETAIL_PAGE_SIZE = 12;
const defaultAdapter = isAppleMusicCatalogEnabled
  ? withCatalogConfigurationFallback(createAppleMusicCatalogAdapter())
  : mockCatalogAdapter;

function isPlaylist(item: DiscoveryItem): item is CatalogPlaylist {
  return item.catalogId.kind === "playlist";
}

function getArtworkStyle(item: DiscoveryItem) {
  const palette = item.artwork.palette || ["#261744", "#7c5cff"];
  return {
    "--catalog-accent-start": palette[0],
    "--catalog-accent-end": palette[1],
  } as CSSProperties;
}

function CatalogDiscovery({
  mode,
  adapter = defaultAdapter,
}: CatalogDiscoveryProps) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [items, setItems] = useState<readonly DiscoveryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedItem, setSelectedItem] = useState<DiscoveryItem | null>(null);
  const [detailTracks, setDetailTracks] = useState<readonly CatalogTrack[]>([]);
  const [detailAlbums, setDetailAlbums] = useState<readonly CatalogAlbum[]>([]);
  const [detailTotal, setDetailTotal] = useState(0);
  const [detailNextCursor, setDetailNextCursor] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const requestSequenceRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const detailSequenceRef = useRef(0);
  const detailAbortControllerRef = useRef<AbortController | null>(null);

  const categories = useMemo(() => adapter.listCategories(), [adapter]);

  const loadItems = useCallback(
    async ({ append = false, cursor = null }: LoadItemsOptions = {}) => {
      abortControllerRef.current?.abort();
      detailAbortControllerRef.current?.abort();
      const controller = new AbortController();
      const sequence = ++requestSequenceRef.current;
      abortControllerRef.current = controller;

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setItems([]);
        setSelectedItem(null);
      }
      setError("");

      try {
        let page: CatalogPage<DiscoveryItem>;
        if (mode === "artists") {
          page = await adapter.searchArtists(
            submittedQuery,
            { cursor, limit: DISCOVERY_PAGE_SIZE },
            { signal: controller.signal }
          );
        } else {
          page = await adapter.searchPlaylists(
            submittedQuery,
            activeCategory,
            { cursor, limit: DISCOVERY_PAGE_SIZE },
            { signal: controller.signal }
          );
        }

        if (sequence !== requestSequenceRef.current) return;
        setItems((current) =>
          append ? [...current, ...page.items] : page.items
        );
        setNextCursor(page.nextCursor);
        setTotal(page.total);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        console.error("Catalog discovery failed:", loadError);
        if (sequence === requestSequenceRef.current) {
          setError("Discovery is temporarily unavailable. Try again.");
        }
      } finally {
        if (sequence === requestSequenceRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    }, [activeCategory, adapter, mode, submittedQuery]
  );

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadItems(), 0);
    return () => {
      window.clearTimeout(loadTimer);
      abortControllerRef.current?.abort();
    };
  }, [loadItems]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  }

  function handleCategoryChange(categoryId: string) {
    setActiveCategory(categoryId);
  }

  const loadDetails = useCallback(
    async (item: DiscoveryItem, cursor: string | null = null, append = false) => {
      detailAbortControllerRef.current?.abort();
      const controller = new AbortController();
      const sequence = ++detailSequenceRef.current;
      detailAbortControllerRef.current = controller;
      setSelectedItem(item);
      setIsDetailLoading(true);
      setDetailError("");
      if (!append) {
        setDetailTracks([]);
        setDetailAlbums([]);
      }

      try {
        if (isPlaylist(item)) {
          const tracks = await adapter.getPlaylistTracks(item.catalogId, {
            cursor,
            limit: DETAIL_PAGE_SIZE,
          }, { signal: controller.signal });
          if (sequence !== detailSequenceRef.current) return;
          setDetailTracks((current) =>
            append ? [...current, ...tracks.items] : tracks.items
          );
          setDetailTotal(tracks.total);
          setDetailNextCursor(tracks.nextCursor);
        } else {
          const [tracks, albums] = await Promise.all([
            adapter.getArtistTracks(item.catalogId, {
              cursor,
              limit: DETAIL_PAGE_SIZE,
            }, { signal: controller.signal }),
            append
              ? Promise.resolve(null)
              : adapter.getArtistAlbums(
                  item.catalogId,
                  { limit: 6 },
                  { signal: controller.signal }
                ),
          ]);
          if (sequence !== detailSequenceRef.current) return;
          setDetailTracks((current) =>
            append ? [...current, ...tracks.items] : tracks.items
          );
          if (albums) setDetailAlbums(albums.items);
          setDetailTotal(tracks.total);
          setDetailNextCursor(tracks.nextCursor);
        }
      } catch (detailLoadError) {
        if (
          detailLoadError instanceof DOMException &&
          detailLoadError.name === "AbortError"
        ) {
          return;
        }
        console.error("Catalog details failed:", detailLoadError);
        if (sequence === detailSequenceRef.current) {
          setDetailError("Details are temporarily unavailable. Try again.");
        }
      } finally {
        if (sequence === detailSequenceRef.current) setIsDetailLoading(false);
      }
    },
    [adapter]
  );

  function formatDuration(durationMs: number | null) {
    if (durationMs === null) return "";
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.floor((durationMs % 60_000) / 1_000);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  const title = mode === "artists" ? "Choose an artist" : "Choose a playlist";
  const description =
    mode === "artists"
      ? "Explore artists across genres before full-discography quizzes arrive."
      : "Browse curated eras and genres built for future shared quiz runs.";

  return (
    <section className="catalog-discovery" aria-labelledby="catalog-discovery-title">
      <div className="catalog-discovery-heading">
        <div>
          <p className="eyebrow">Discovery preview</p>
          <h3 id="catalog-discovery-title">{title}</h3>
          <p>{description}</p>
        </div>
        <span className="catalog-coming-soon">Gameplay coming soon</span>
      </div>

      <p className="catalog-provider-note">
        {adapter.metadataRightsStatus === "mock"
          ? "Preview catalog data. Connect Apple Music server credentials to test real metadata."
          : "Apple Music metadata is used when configured; mock data remains available otherwise. Audio and gameplay are disabled."}
      </p>

      <form className="catalog-discovery-search" onSubmit={handleSearch}>
        <label htmlFor={`catalog-${mode}-search`} className="sr-only">
          Search {mode}
        </label>
        <input
          id={`catalog-${mode}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={mode === "artists" ? "Search artists..." : "Search playlists..."}
        />
        <button type="submit" disabled={isLoading}>
          Search
        </button>
      </form>

      {mode === "playlists" && (
        <div className="catalog-category-filter" aria-label="Playlist categories">
          {categories.map((category) => (
            <button
              type="button"
              key={category.id}
              className={activeCategory === category.id ? "is-active" : ""}
              aria-pressed={activeCategory === category.id}
              onClick={() => handleCategoryChange(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="catalog-state catalog-state-error" role="alert">
          <strong>Could not load discovery.</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void loadItems()}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !error && (
        <div className="catalog-discovery-grid" aria-label={`Loading ${mode}`}>
          {Array.from({ length: 6 }, (_, index) => (
            <div className="catalog-discovery-card is-loading" key={index} aria-hidden>
              <span className="catalog-artwork" />
              <span className="skeleton-line skeleton-line-title" />
              <span className="skeleton-line" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="catalog-state">
          <strong>No matches found.</strong>
          <span>Try another name, era, or genre.</span>
        </div>
      )}

      {!isLoading && !error && items.length > 0 && (
        <>
          <div className="catalog-result-summary" aria-live="polite">
            <span>
              {submittedQuery ? `Results for "${submittedQuery}"` : "Featured discovery"}
            </span>
            <strong>
              {items.length} of {total}
            </strong>
          </div>

          <div className="catalog-discovery-grid">
            {items.map((item) => (
              <article
                className="catalog-discovery-card"
                key={`${item.catalogId.provider}:${item.catalogId.id}`}
                style={getArtworkStyle(item)}
              >
                <div className="catalog-artwork" aria-hidden>
                  {item.artwork.url ? (
                    <img
                      src={item.artwork.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span>{item.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="catalog-card-copy">
                  <span className="catalog-card-type">
                    {isPlaylist(item) ? "Playlist" : "Artist"}
                  </span>
                  <h4>{item.name}</h4>
                  {isPlaylist(item) ? (
                    <>
                      <p>{item.description}</p>
                      <small>
                        {item.curatorName}
                        {item.trackCount !== null ? ` | ${item.trackCount} tracks` : ""}
                      </small>
                    </>
                  ) : (
                    <p>
                      {item.genres.length > 0
                        ? item.genres.join(" | ")
                        : "Genre unavailable"}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="catalog-detail-action"
                  onClick={() => void loadDetails(item)}
                  aria-expanded={selectedItem?.catalogId.id === item.catalogId.id}
                >
                  {isPlaylist(item) ? "View tracks" : "View catalog"}
                </button>
              </article>
            ))}
          </div>

          {nextCursor && (
            <button
              type="button"
              className="view-more-albums catalog-load-more"
              disabled={isLoadingMore}
              onClick={() => void loadItems({ append: true, cursor: nextCursor })}
            >
              {isLoadingMore ? "Loading..." : "View more"}
            </button>
          )}

          {selectedItem && (
            <section className="catalog-detail-panel" aria-live="polite">
              <div className="catalog-detail-heading">
                <div>
                  <span className="catalog-card-type">
                    {isPlaylist(selectedItem) ? "Playlist tracks" : "Artist catalog"}
                  </span>
                  <h4>{selectedItem.name}</h4>
                  <p>
                    {isDetailLoading && detailTracks.length === 0
                      ? "Loading catalog details..."
                      : `${detailTracks.length} of ${detailTotal} tracks shown`}
                  </p>
                </div>
                <button
                  type="button"
                  className="catalog-detail-close"
                  onClick={() => setSelectedItem(null)}
                  aria-label="Close catalog details"
                >
                  Close
                </button>
              </div>

              {detailError && (
                <div className="catalog-state catalog-state-error" role="alert">
                  <strong>Could not load details.</strong>
                  <span>{detailError}</span>
                  <button type="button" onClick={() => void loadDetails(selectedItem)}>
                    Retry
                  </button>
                </div>
              )}

              {!detailError && !isDetailLoading && detailTracks.length === 0 && (
                <div className="catalog-state">
                  <strong>No track metadata available.</strong>
                  <span>This source is still discovery-only.</span>
                </div>
              )}

              {detailTracks.length > 0 && (
                <ol className="catalog-track-list">
                  {detailTracks.map((track, index) => (
                    <li key={`${track.catalogId.provider}:${track.catalogId.id}`}>
                      <span className="catalog-track-number">{index + 1}</span>
                      <span className="catalog-track-copy">
                        <strong>{track.name}</strong>
                        <small>{track.artistName}</small>
                      </span>
                      <span className="catalog-track-duration">
                        {formatDuration(track.durationMs)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {detailNextCursor && (
                <button
                  type="button"
                  className="view-more-albums catalog-load-more"
                  disabled={isDetailLoading}
                  onClick={() =>
                    void loadDetails(selectedItem, detailNextCursor, true)
                  }
                >
                  {isDetailLoading ? "Loading..." : "View more tracks"}
                </button>
              )}

              {!isPlaylist(selectedItem) && detailAlbums.length > 0 && (
                <div className="catalog-collection-section">
                  <h5>Collections</h5>
                  <div className="catalog-collection-grid">
                    {detailAlbums.map((album) => (
                      <article key={`${album.catalogId.provider}:${album.catalogId.id}`}>
                        {album.artwork.url ? (
                          <img
                            src={album.artwork.url}
                            alt={`${album.name} artwork`}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span aria-hidden>{album.name.slice(0, 2).toUpperCase()}</span>
                        )}
                        <strong>{album.name}</strong>
                        <small>
                          {album.releaseDate?.slice(0, 4) || "Release date unavailable"}
                        </small>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              <p className="catalog-rights-note">
                Discovery only. StanZer does not download, cache, or play audio from this source.
              </p>
            </section>
          )}
        </>
      )}
    </section>
  );
}

export default CatalogDiscovery;
