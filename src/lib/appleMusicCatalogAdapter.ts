import {
  normalizeCatalogAlbumMetadata,
  normalizeCatalogArtistMetadata,
  normalizeCatalogPlaylistMetadata,
  normalizeCatalogTrackMetadata,
  type CatalogAdapter,
  type CatalogAlbum,
  type CatalogArtist,
  type CatalogCategory,
  type CatalogIdentifier,
  type CatalogPage,
  type CatalogPageRequest,
  type CatalogPlaylist,
  type CatalogRequestContext,
  type CatalogTrack,
} from "./catalog.ts";
import { mockCatalogAdapter } from "./mockCatalogAdapter.ts";

const APPLE_PROVIDER = "apple_music";
const CACHE_TTL_MS = 5 * 60 * 1000;

const APPLE_CATEGORIES: readonly CatalogCategory[] = Object.freeze([
  { id: "all", label: "Featured" },
  { id: "editorial", label: "Apple Music" },
  { id: "90s-hits", label: "90s" },
  { id: "2000s-hip-hop", label: "2000s Hip-Hop" },
  { id: "2010s-hits", label: "2010s" },
  { id: "2020s-hits", label: "2020s" },
  { id: "afrobeats", label: "Afrobeats" },
  { id: "rnb-classics", label: "R&B Classics" },
  { id: "pop", label: "Pop" },
]);

type CatalogPagePayload<T> = {
  items?: readonly T[];
  nextCursor?: string | null;
  total?: number;
};

type CacheEntry = {
  expiresAt: number;
  value: CatalogPage<unknown>;
};

export class CatalogConfigurationError extends Error {
  constructor(message = "Apple Music catalog is not configured.") {
    super(message);
    this.name = "CatalogConfigurationError";
  }
}

function inferStorefront() {
  if (typeof navigator === "undefined") return "us";
  const locale = navigator.languages?.[0] || navigator.language || "en-US";
  const region = locale.match(/[-_]([A-Za-z]{2})\b/)?.[1];
  return region?.toLowerCase() || "us";
}

function normalizePage<TInput, TOutput>(
  payload: CatalogPagePayload<TInput>,
  normalize: (item: TInput) => TOutput
): CatalogPage<TOutput> {
  const items = Object.freeze((payload.items || []).map(normalize));
  return Object.freeze({
    items,
    nextCursor:
      typeof payload.nextCursor === "string" ? payload.nextCursor : null,
    total:
      typeof payload.total === "number" && payload.total >= items.length
        ? payload.total
        : items.length,
  });
}

function assertAppleIdentifier(identifier: CatalogIdentifier, kind: CatalogIdentifier["kind"]) {
  if (identifier.provider !== APPLE_PROVIDER || identifier.kind !== kind) {
    throw new Error(`Expected an Apple Music ${kind} identifier.`);
  }
}

export function createAppleMusicCatalogAdapter(options: {
  storefront?: string;
  fetcher?: typeof fetch;
  now?: () => number;
} = {}): CatalogAdapter {
  const storefront = (options.storefront || inferStorefront()).toLowerCase();
  const fetcher = options.fetcher || fetch;
  const now = options.now || Date.now;
  const cache = new Map<string, CacheEntry>();

  async function request<TInput, TOutput>(
    action: string,
    parameters: Record<string, string | null | undefined>,
    normalize: (item: TInput) => TOutput,
    context?: CatalogRequestContext
  ) {
    const search = new URLSearchParams({ action, storefront });
    Object.entries(parameters).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const url = `/api/apple-music-catalog?${search}`;
    const cached = cache.get(url);
    if (cached && cached.expiresAt > now()) {
      return cached.value as CatalogPage<TOutput>;
    }

    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: context?.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 503 && payload?.code === "APPLE_MUSIC_NOT_CONFIGURED") {
      throw new CatalogConfigurationError();
    }
    if (!response.ok) {
      throw new Error(payload?.error || "Catalog metadata is unavailable.");
    }
    if (!Array.isArray(payload?.items)) {
      throw new CatalogConfigurationError(
        "Apple Music catalog endpoint is unavailable in this environment."
      );
    }

    const normalized = normalizePage(payload, normalize);
    cache.set(url, {
      expiresAt: now() + CACHE_TTL_MS,
      value: normalized as CatalogPage<unknown>,
    });
    return normalized;
  }

  function pageParameters(page: CatalogPageRequest = {}) {
    return {
      cursor: page.cursor || null,
      limit: String(page.limit || 6),
    };
  }

  return Object.freeze({
    provider: APPLE_PROVIDER,
    displayName: "Apple Music Catalog",
    metadataRightsStatus: "restricted" as const,
    playbackEnabled: false,
    listCategories: () => APPLE_CATEGORIES,
    searchArtists(query, page = {}, context) {
      return request<CatalogArtist, CatalogArtist>(
        "search-artists",
        { q: query, ...pageParameters(page) },
        normalizeCatalogArtistMetadata,
        context
      );
    },
    searchPlaylists(query, categoryId, page = {}, context) {
      return request<CatalogPlaylist, CatalogPlaylist>(
        "search-playlists",
        { q: query, category: categoryId || "all", ...pageParameters(page) },
        normalizeCatalogPlaylistMetadata,
        context
      );
    },
    getArtistTracks(artistId, page = {}, context) {
      assertAppleIdentifier(artistId, "artist");
      return request<CatalogTrack, CatalogTrack>(
        "artist-tracks",
        { id: artistId.id, ...pageParameters(page) },
        normalizeCatalogTrackMetadata,
        context
      );
    },
    getArtistAlbums(artistId, page = {}, context) {
      assertAppleIdentifier(artistId, "artist");
      return request<CatalogAlbum, CatalogAlbum>(
        "artist-albums",
        { id: artistId.id, ...pageParameters(page) },
        normalizeCatalogAlbumMetadata,
        context
      );
    },
    getPlaylistTracks(playlistId, page = {}, context) {
      assertAppleIdentifier(playlistId, "playlist");
      return request<CatalogTrack, CatalogTrack>(
        "playlist-tracks",
        { id: playlistId.id, ...pageParameters(page) },
        normalizeCatalogTrackMetadata,
        context
      );
    },
  });
}

export function withCatalogConfigurationFallback(
  primary: CatalogAdapter,
  fallback: CatalogAdapter = mockCatalogAdapter
): CatalogAdapter {
  function useFallback<T>(primaryRequest: () => Promise<T>, fallbackRequest: () => Promise<T>) {
    return primaryRequest().catch((error) => {
      if (error instanceof CatalogConfigurationError) return fallbackRequest();
      throw error;
    });
  }

  return Object.freeze({
    ...primary,
    displayName: `${primary.displayName} (mock fallback available)`,
    searchArtists: (query, page, context) =>
      useFallback(
        () => primary.searchArtists(query, page, context),
        () => fallback.searchArtists(query, page, context)
      ),
    searchPlaylists: (query, category, page, context) =>
      useFallback(
        () => primary.searchPlaylists(query, category, page, context),
        () => fallback.searchPlaylists(query, category, page, context)
      ),
    getArtistTracks: (id, page, context) =>
      id.provider === fallback.provider
        ? fallback.getArtistTracks(id, page, context)
        : useFallback(
            () => primary.getArtistTracks(id, page, context),
            () => fallback.getArtistTracks(id, page, context)
          ),
    getArtistAlbums: (id, page, context) =>
      id.provider === fallback.provider
        ? fallback.getArtistAlbums(id, page, context)
        : useFallback(
            () => primary.getArtistAlbums(id, page, context),
            () => fallback.getArtistAlbums(id, page, context)
          ),
    getPlaylistTracks: (id, page, context) =>
      id.provider === fallback.provider
        ? fallback.getPlaylistTracks(id, page, context)
        : useFallback(
            () => primary.getPlaylistTracks(id, page, context),
            () => fallback.getPlaylistTracks(id, page, context)
          ),
  });
}

