import {
  filterPlaylistsByCategory,
  normalizeCatalogArtistMetadata,
  normalizeCatalogPlaylistMetadata,
  paginateCatalogItems,
  type CatalogAdapter,
  type CatalogArtist,
  type CatalogCategory,
  type CatalogIdentifier,
  type CatalogPageRequest,
  type CatalogPlaylist,
  type CatalogRequestContext,
  type CatalogTrack,
} from "./catalog.ts";

const MOCK_PROVIDER = "stanzer_mock";

const categories: readonly CatalogCategory[] = Object.freeze([
  { id: "all", label: "All" },
  { id: "2000s-hip-hop", label: "2000s Hip-Hop" },
  { id: "2010s-hits", label: "2010s Hits" },
  { id: "afrobeats", label: "Afrobeats" },
  { id: "rnb-classics", label: "R&B Classics" },
  { id: "pop", label: "Pop" },
]);

const mockAvailability = Object.freeze({
  status: "available" as const,
  storefronts: Object.freeze(["mock"]),
  gameplayEnabled: false,
  reason: "Discovery preview only",
});

function artistId(id: string): CatalogIdentifier {
  return { provider: MOCK_PROVIDER, kind: "artist", id, storefront: "mock" };
}

function playlistId(id: string): CatalogIdentifier {
  return { provider: MOCK_PROVIDER, kind: "playlist", id, storefront: "mock" };
}

const artists: readonly CatalogArtist[] = Object.freeze([
  normalizeCatalogArtistMetadata({
    catalogId: artistId("wizkid"),
    name: "Wizkid",
    genres: ["Afrobeats", "R&B"],
    artwork: { palette: ["#351266", "#cb6cff"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogArtistMetadata({
    catalogId: artistId("burna-boy"),
    name: "Burna Boy",
    genres: ["Afrobeats", "Dancehall"],
    artwork: { palette: ["#34220d", "#f0a33a"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogArtistMetadata({
    catalogId: artistId("davido"),
    name: "Davido",
    genres: ["Afrobeats", "Pop"],
    artwork: { palette: ["#0e3f3a", "#37d4a5"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogArtistMetadata({
    catalogId: artistId("drake"),
    name: "Drake",
    genres: ["Hip-Hop", "R&B"],
    artwork: { palette: ["#192144", "#6687ff"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogArtistMetadata({
    catalogId: artistId("beyonce"),
    name: "Beyonce",
    genres: ["Pop", "R&B"],
    artwork: { palette: ["#3f171f", "#ff6c81"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogArtistMetadata({
    catalogId: artistId("taylor-swift"),
    name: "Taylor Swift",
    genres: ["Pop", "Singer-Songwriter"],
    artwork: { palette: ["#123c56", "#68c8e8"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogArtistMetadata({
    catalogId: artistId("kendrick-lamar"),
    name: "Kendrick Lamar",
    genres: ["Hip-Hop", "Rap"],
    artwork: { palette: ["#292929", "#b4d057"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogArtistMetadata({
    catalogId: artistId("rihanna"),
    name: "Rihanna",
    genres: ["Pop", "R&B"],
    artwork: { palette: ["#43132f", "#ff4ba5"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
]);

const playlists: readonly CatalogPlaylist[] = Object.freeze([
  normalizeCatalogPlaylistMetadata({
    catalogId: playlistId("2000s-hip-hop-heavyweights"),
    name: "2000s Hip-Hop Heavyweights",
    description: "Era-defining rap records built for a high-pressure run.",
    curatorName: "StanZer Preview",
    categoryIds: ["2000s-hip-hop"],
    trackCount: 48,
    artwork: { palette: ["#17202d", "#f0a13e"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogPlaylistMetadata({
    catalogId: playlistId("2010s-global-hits"),
    name: "2010s Global Hits",
    description: "The decade's biggest crossover records and radio staples.",
    curatorName: "StanZer Preview",
    categoryIds: ["2010s-hits", "pop"],
    trackCount: 60,
    artwork: { palette: ["#21124d", "#9d76ff"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogPlaylistMetadata({
    catalogId: playlistId("afrobeats-takeover"),
    name: "Afrobeats Takeover",
    description: "Contemporary anthems from Lagos, Accra, London, and beyond.",
    curatorName: "StanZer Preview",
    categoryIds: ["afrobeats"],
    trackCount: 52,
    artwork: { palette: ["#0a403d", "#35d39f"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogPlaylistMetadata({
    catalogId: playlistId("rnb-after-dark"),
    name: "R&B After Dark",
    description: "Slow jams, vocal classics, and unmistakable opening notes.",
    curatorName: "StanZer Preview",
    categoryIds: ["rnb-classics"],
    trackCount: 44,
    artwork: { palette: ["#41182f", "#ef5f9c"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogPlaylistMetadata({
    catalogId: playlistId("pop-main-stage"),
    name: "Pop Main Stage",
    description: "Instant hooks and arena-sized choruses across generations.",
    curatorName: "StanZer Preview",
    categoryIds: ["pop"],
    trackCount: 50,
    artwork: { palette: ["#17365c", "#55a9ff"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogPlaylistMetadata({
    catalogId: playlistId("2010s-rap-rivals"),
    name: "2010s Rap Rivals",
    description: "Chart leaders, deep cuts, and the decade's defining voices.",
    curatorName: "StanZer Preview",
    categoryIds: ["2010s-hits", "2000s-hip-hop"],
    trackCount: 54,
    artwork: { palette: ["#341735", "#d755df"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogPlaylistMetadata({
    catalogId: playlistId("afrobeats-foundations"),
    name: "Afrobeats Foundations",
    description: "Foundational records behind today's global sound.",
    curatorName: "StanZer Preview",
    categoryIds: ["afrobeats"],
    trackCount: 40,
    artwork: { palette: ["#42300d", "#f4c448"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
  normalizeCatalogPlaylistMetadata({
    catalogId: playlistId("rnb-icons"),
    name: "R&B Icons",
    description: "Signature voices and timeless records from R&B greats.",
    curatorName: "StanZer Preview",
    categoryIds: ["rnb-classics"],
    trackCount: 58,
    artwork: { palette: ["#3c1b19", "#d98365"], rightsStatus: "mock" },
    availability: mockAvailability,
  }),
]);

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function assertNotAborted(context?: CatalogRequestContext) {
  if (context?.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function includesQuery(values: readonly string[], query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  return values.some((value) => normalizeSearch(value).includes(normalizedQuery));
}

const emptyTracks: readonly CatalogTrack[] = Object.freeze([]);

export const mockCatalogAdapter: CatalogAdapter = Object.freeze({
  provider: MOCK_PROVIDER,
  displayName: "StanZer Preview Catalog",
  metadataRightsStatus: "mock",
  playbackEnabled: false,
  listCategories: () => categories,
  async searchArtists(query, page: CatalogPageRequest = {}, context) {
    assertNotAborted(context);
    const matches = artists.filter((artist) =>
      includesQuery([artist.name, ...artist.genres], query)
    );
    await Promise.resolve();
    assertNotAborted(context);
    return paginateCatalogItems(matches, page);
  },
  async searchPlaylists(
    query,
    categoryId,
    page: CatalogPageRequest = {},
    context
  ) {
    assertNotAborted(context);
    const categoryMatches = filterPlaylistsByCategory(playlists, categoryId);
    const matches = categoryMatches.filter((playlist) =>
      includesQuery(
        [playlist.name, playlist.description, playlist.curatorName],
        query
      )
    );
    await Promise.resolve();
    assertNotAborted(context);
    return paginateCatalogItems(matches, page);
  },
  async getArtistTracks(_artistId, page: CatalogPageRequest = {}, context) {
    assertNotAborted(context);
    return paginateCatalogItems(emptyTracks, page);
  },
  async getArtistAlbums(_artistId, page: CatalogPageRequest = {}, context) {
    assertNotAborted(context);
    return paginateCatalogItems([], page);
  },
  async getPlaylistTracks(_playlistId, page: CatalogPageRequest = {}, context) {
    assertNotAborted(context);
    return paginateCatalogItems(emptyTracks, page);
  },
});
