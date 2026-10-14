export type SpotifyAlbum = {
  id: string;
  title: string;
  artist: string;
  year: string;
  imageUrl: string;
};

export type SpotifyArtist = {
  id: string;
  name: string;
  genre: string;
  imageUrl: string;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  previewUrl: string | null;
};

export type ITunesAlbum = {
  wrapperType?: string;
  collectionType?: string;
  collectionId?: number;
  collectionName?: string;
  artistId?: number;
  artistName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  trackCount?: number;
};

export type ITunesArtist = {
  wrapperType?: string;
  artistType?: string;
  artistId?: number;
  artistName?: string;
  primaryGenreName?: string;
};

type ITunesTrack = {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  previewUrl?: string;
};

type RankedAlbum = {
  album: SpotifyAlbum;
  score: number;
};

type ITunesAlbumSearchResponse = {
  resultCount: number;
  results: ITunesAlbum[];
};

type ITunesArtistSearchResponse = {
  resultCount: number;
  results: ITunesArtist[];
};

type ITunesLookupResponse = {
  resultCount: number;
  results: Array<ITunesTrack | ITunesAlbum | ITunesArtist>;
};

type CachedValue<T> = {
  value: T;
  expiresAt: number;
};

type RequestOptions = {
  signal?: AbortSignal;
};

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const ALBUM_TRACK_CACHE_TTL_MS = 30 * 60 * 1000;
const albumSearchCache = new Map<string, CachedValue<SpotifyAlbum[]>>();
const albumSearchRequests = new Map<string, Promise<SpotifyAlbum[]>>();
const artistSearchCache = new Map<string, CachedValue<SpotifyArtist[]>>();
const artistSearchRequests = new Map<string, Promise<SpotifyArtist[]>>();
const albumTrackCache = new Map<string, CachedValue<SpotifyTrack[]>>();
const albumTrackRequests = new Map<string, Promise<SpotifyTrack[]>>();

function normalizeCacheKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCachedValue<T>(cache: Map<string, CachedValue<T>>, key: string) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", handleAbort);
    });
  });
}

function getITunesBaseUrl(path: "search" | "lookup") {
  if (!import.meta.env?.PROD) {
    return `https://itunes.apple.com/${path}`;
  }

  if (path === "search") {
    return "/api/itunes-search";
  }

  return "/api/itunes-lookup";
}

function makeAlbumId(country: string, collectionId: number) {
  return `itunes:${country}:${collectionId}`;
}

function parseAlbumId(albumId: string) {
  const parts = albumId.split(":");

  if (parts.length === 3 && parts[0] === "itunes") {
    return {
      country: parts[1],
      collectionId: parts[2],
    };
  }

  return {
    country: "US",
    collectionId: albumId,
  };
}

function improveArtworkUrl(url: string) {
  return url.replace("100x100bb", "600x600bb");
}

function cleanText(text: string) {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(text: string) {
  return cleanText(text)
    .split(" ")
    .filter((word) => word.length > 1);
}

export function isSearchableAlbum(album: ITunesAlbum) {
  if (!album.collectionId || !album.collectionName) {
    return false;
  }

  if (album.wrapperType !== "collection") {
    return false;
  }

  if (album.collectionType && album.collectionType !== "Album") {
    return false;
  }

  if ((album.trackCount || 0) < 1) {
    return false;
  }

  const title = cleanText(album.collectionName);
  const isExplicitSingle = /(?:^| )single$/.test(title);

  if (isExplicitSingle && (album.trackCount || 0) <= 3) {
    return false;
  }

  return true;
}

const ALBUM_NOISE_TERMS = [
  "karaoke",
  "instrumental",
  "tribute",
  "piano",
  "lullaby",
  "cover",
  "covers",
  "made famous by",
  "scary hours instrumental",
  "music box",
  "workout",
];

function isLikelyNoiseAlbum(album: ITunesAlbum) {
  const combinedText = cleanText(
    `${album.collectionName || ""} ${album.artistName || ""}`
  );

  return ALBUM_NOISE_TERMS.some((term) => combinedText.includes(term));
}

function isSameArtistName(artistName: string, targetArtistName: string) {
  const cleanArtistName = cleanText(artistName);
  const cleanTargetArtistName = cleanText(targetArtistName);

  return (
    cleanArtistName === cleanTargetArtistName ||
    cleanArtistName.includes(cleanTargetArtistName) ||
    cleanTargetArtistName.includes(cleanArtistName)
  );
}

export function scoreArtist(artist: ITunesArtist, query: string) {
  const queryText = cleanText(query);
  const artistName = cleanText(artist.artistName || "");
  const queryWords = getWords(query);

  let score = 0;

  if (artist.wrapperType === "artist") {
    score += 20;
  }

  if (artist.artistType === "Artist") {
    score += 20;
  }

  if (artistName === queryText) {
    score += 220;
  } else if (artistName.includes(queryText)) {
    score += 130;
  } else if (queryText.includes(artistName) && artistName.length > 1) {
    score += 100;
  }

  queryWords.forEach((word) => {
    if (artistName.split(" ").includes(word)) {
      score += 30;
    } else if (artistName.includes(word)) {
      score += 14;
    }
  });

  return score;
}

export function scoreAlbum(
  album: ITunesAlbum,
  query: string,
  matchedArtistName = ""
) {
  const queryText = cleanText(query);
  const albumTitle = cleanText(album.collectionName || "");
  const artistName = cleanText(album.artistName || "");
  const matchedArtist = cleanText(matchedArtistName);
  const trackCount = album.trackCount || 0;
  const queryWords = getWords(query);
  const titleWords = getWords(album.collectionName || "");

  let score = 0;

  if (artistName === queryText) {
    score += 220;
  }

  if (artistName.includes(queryText)) {
    score += 120;
  }

  if (queryText.includes(artistName) && artistName.length > 1) {
    score += 120;
  }

  if (matchedArtist && isSameArtistName(artistName, matchedArtist)) {
    score += 100;
  }

  if (albumTitle === queryText) {
    score += 600;
  }

  if (albumTitle.includes(queryText)) {
    score += 180;
  }

  if (queryText.includes(albumTitle) && albumTitle.length > 1) {
    score += 85;
  }

  queryWords.forEach((word) => {
    if (artistName.includes(word)) {
      score += 28;
    }

    if (albumTitle.includes(word)) {
      score += 24;
    }
  });

  if (
    queryWords.length > 1 &&
    queryWords.every(
      (word) => artistName.includes(word) || albumTitle.includes(word)
    )
  ) {
    score += 280;
  }

  if (
    queryWords.length > 0 &&
    queryWords.every((word) => artistName.split(" ").includes(word))
  ) {
    score += 70;
  }

  if (
    queryWords.length > 0 &&
    queryWords.every((word) => titleWords.includes(word))
  ) {
    score += 70;
  }

  if (trackCount >= 10) {
    score += 55;
  } else if (trackCount >= 7) {
    score += 40;
  } else if (trackCount >= 4) {
    score += 18;
  } else if (trackCount > 0) {
    score -= 45;
  }

  if (
    isLikelyNoiseAlbum(album) &&
    !ALBUM_NOISE_TERMS.some((term) => queryText.includes(term))
  ) {
    score -= 600;
  }

  return score;
}

function mapAlbum(country: string, album: ITunesAlbum): SpotifyAlbum {
  return {
    id: makeAlbumId(country, album.collectionId as number),
    title: album.collectionName || "Unknown album",
    artist: album.artistName || "Unknown artist",
    year: album.releaseDate?.slice(0, 4) || "Unknown year",
    imageUrl: album.artworkUrl100 ? improveArtworkUrl(album.artworkUrl100) : "",
  };
}

function isPreviewTrack(item: ITunesTrack | ITunesAlbum | ITunesArtist): item is ITunesTrack {
  return (
    item.wrapperType === "track" &&
    "kind" in item &&
    item.kind === "song" &&
    Boolean(item.trackId) &&
    Boolean(item.trackName) &&
    Boolean(item.previewUrl)
  );
}

export function removeDuplicateAlbums(albums: SpotifyAlbum[]) {
  const seenAlbums = new Set<string>();

  return albums.filter((album) => {
    const albumKey = `${cleanText(album.title)}-${cleanText(album.artist)}-${album.year}`;

    if (seenAlbums.has(albumKey)) {
      return false;
    }

    seenAlbums.add(albumKey);
    return true;
  });
}

async function searchDirectAlbums(
  query: string,
  country: string,
  signal?: AbortSignal
): Promise<RankedAlbum[]> {
  const params = new URLSearchParams({
    term: query,
    media: "music",
    entity: "album",
    limit: "50",
    country,
  });

  const searchUrl = `${getITunesBaseUrl("search")}?${params.toString()}`;

  console.log("Album search URL:", searchUrl);

  const response = await fetch(searchUrl, { signal });

  if (!response.ok) {
    console.error("iTunes album search failed:", response.status, country);
    return [];
  }

  const data: ITunesAlbumSearchResponse = await response.json();

  return data.results.filter(isSearchableAlbum).map((album) => ({
    album: mapAlbum(country, album),
    score: scoreAlbum(album, query),
  }));
}

async function searchArtistsByCountry(
  query: string,
  country: string,
  signal?: AbortSignal,
  limit = 20
) {
  const params = new URLSearchParams({
    term: query,
    media: "music",
    entity: "musicArtist",
    limit: String(limit),
    country,
  });
  const searchUrl = `${getITunesBaseUrl("search")}?${params.toString()}`;

  console.log("Artist search URL:", searchUrl);

  const response = await fetch(searchUrl, { signal });

  if (!response.ok) {
    console.error("iTunes artist search failed:", response.status, country);
    return [];
  }

  const data: ITunesArtistSearchResponse = await response.json();
  return data.results
    .filter((artist) => artist.artistId && artist.artistName)
    .map((artist) => ({
      artist,
      score: scoreArtist(artist, query),
    }))
    .filter((item) => item.score >= 60)
    .sort((a, b) => b.score - a.score);
}

async function searchBestArtist(
  query: string,
  country: string,
  signal?: AbortSignal
) {
  const rankedArtists = await searchArtistsByCountry(query, country, signal, 5);
  return rankedArtists[0]?.artist || null;
}

async function lookupArtistAlbums(
  query: string,
  country: string,
  artist: ITunesArtist,
  signal?: AbortSignal
): Promise<RankedAlbum[]> {
  if (!artist.artistId) {
    return [];
  }

  const params = new URLSearchParams({
    id: String(artist.artistId),
    entity: "album",
    limit: "100",
    country,
  });
  const lookupUrl = `${getITunesBaseUrl("lookup")}?${params.toString()}`;

  console.log("Artist albums lookup URL:", lookupUrl);

  const response = await fetch(lookupUrl, { signal });

  if (!response.ok) {
    console.error("iTunes artist albums lookup failed:", response.status, country);
    return [];
  }

  const data: ITunesLookupResponse = await response.json();

  return data.results
    .filter((item): item is ITunesAlbum => "collectionId" in item)
    .filter(isSearchableAlbum)
    .map((album) => ({
      album: mapAlbum(country, album),
      score: scoreAlbum(album, query, artist.artistName || "") + 40,
    }));
}

async function searchAlbumsUncached(
  query: string,
  signal?: AbortSignal
): Promise<SpotifyAlbum[]> {
  const countries = ["US", "NG", "GB", "CA", "ZA"];
  const countryResults = await Promise.all(
    countries.map(async (country) => {
      const [directAlbums, bestArtist] = await Promise.all([
        searchDirectAlbums(query, country, signal),
        searchBestArtist(query, country, signal),
      ]);
      const artistAlbums = bestArtist
        ? await lookupArtistAlbums(query, country, bestArtist, signal)
        : [];
      return [...directAlbums, ...artistAlbums];
    })
  );
  const rankedAlbums = countryResults.flat().filter((item) => item.score >= 60);

  const sortedAlbums = rankedAlbums
    .sort((a, b) => b.score - a.score)
    .map((item) => item.album);

  return removeDuplicateAlbums(sortedAlbums).slice(0, 50);
}

function mapArtist(artist: ITunesArtist): SpotifyArtist {
  return {
    id: `itunes-artist:${artist.artistId}`,
    name: artist.artistName || "Unknown artist",
    genre: artist.primaryGenreName || "Genre unavailable",
    imageUrl: "",
  };
}

function removeDuplicateArtists(
  artists: Array<{ artist: ITunesArtist; score: number }>
) {
  const bestByName = new Map<
    string,
    { artist: ITunesArtist; score: number }
  >();

  artists.forEach((item) => {
    const key = cleanText(item.artist.artistName || "");
    const current = bestByName.get(key);
    if (!current || item.score > current.score) bestByName.set(key, item);
  });

  return [...bestByName.values()]
    .sort((a, b) => b.score - a.score)
    .map((item) => mapArtist(item.artist))
    .slice(0, 12);
}

async function searchArtistsUncached(
  query: string,
  signal?: AbortSignal
): Promise<SpotifyArtist[]> {
  const countries = ["US", "NG", "GB", "CA", "ZA"];
  const countryResults = await Promise.all(
    countries.map((country) => searchArtistsByCountry(query, country, signal))
  );
  return removeDuplicateArtists(countryResults.flat());
}

export async function searchSpotifyAlbums(
  query: string,
  options: RequestOptions = {}
): Promise<SpotifyAlbum[]> {
  const normalizedQuery = normalizeCacheKey(query);
  if (normalizedQuery.length < 2) return [];

  const cached = getCachedValue(albumSearchCache, normalizedQuery);
  if (cached) return withAbort(Promise.resolve(cached), options.signal);

  let request = albumSearchRequests.get(normalizedQuery);
  if (!request) {
    const startedAt = performance.now();
    request = searchAlbumsUncached(normalizedQuery)
      .then((albums) => {
        albumSearchCache.set(normalizedQuery, {
          value: albums,
          expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        });
        console.info(
          `[STANZER_PERF] album search "${normalizedQuery}" ${Math.round(performance.now() - startedAt)}ms`
        );
        return albums;
      })
      .finally(() => albumSearchRequests.delete(normalizedQuery));
    albumSearchRequests.set(normalizedQuery, request);
  }

  return withAbort(request, options.signal);
}

export async function searchSpotifyArtists(
  query: string,
  options: RequestOptions = {}
): Promise<SpotifyArtist[]> {
  const normalizedQuery = normalizeCacheKey(query);
  if (normalizedQuery.length < 2) return [];

  const cached = getCachedValue(artistSearchCache, normalizedQuery);
  if (cached) return withAbort(Promise.resolve(cached), options.signal);

  let request = artistSearchRequests.get(normalizedQuery);
  if (!request) {
    const startedAt = performance.now();
    request = searchArtistsUncached(normalizedQuery)
      .then((artists) => {
        artistSearchCache.set(normalizedQuery, {
          value: artists,
          expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        });
        console.info(
          `[STANZER_PERF] artist search "${normalizedQuery}" ${Math.round(performance.now() - startedAt)}ms`
        );
        return artists;
      })
      .finally(() => artistSearchRequests.delete(normalizedQuery));
    artistSearchRequests.set(normalizedQuery, request);
  }

  return withAbort(request, options.signal);
}

export async function getSpotifyAlbumTracks(
  albumId: string,
  options: RequestOptions = {}
): Promise<SpotifyTrack[]> {
  const cacheKey = normalizeCacheKey(albumId);
  const cached = getCachedValue(albumTrackCache, cacheKey);
  if (cached) return withAbort(Promise.resolve(cached), options.signal);

  let request = albumTrackRequests.get(cacheKey);
  if (request) return withAbort(request, options.signal);

  const startedAt = performance.now();
  request = loadSpotifyAlbumTracks(albumId)
    .then((tracks) => {
      albumTrackCache.set(cacheKey, {
        value: tracks,
        expiresAt: Date.now() + ALBUM_TRACK_CACHE_TTL_MS,
      });
      console.info(
        `[STANZER_PERF] album lookup ${albumId} ${Math.round(performance.now() - startedAt)}ms`
      );
      return tracks;
    })
    .finally(() => albumTrackRequests.delete(cacheKey));
  albumTrackRequests.set(cacheKey, request);
  return withAbort(request, options.signal);
}

async function loadSpotifyAlbumTracks(albumId: string): Promise<SpotifyTrack[]> {
  const { country, collectionId } = parseAlbumId(albumId);

  const params = new URLSearchParams({
    id: collectionId,
    entity: "song",
    country,
  });

  const lookupUrl = `${getITunesBaseUrl("lookup")}?${params.toString()}`;

  console.log("Album tracks lookup URL:", lookupUrl);

  const response = await fetch(lookupUrl);

  if (!response.ok) {
    throw new Error("Failed to get album tracks.");
  }

  const data: ITunesLookupResponse = await response.json();

  return data.results
    .filter(isPreviewTrack)
    .map((track) => ({
      id: `itunes-${track.trackId}`,
      name: track.trackName as string,
      previewUrl: track.previewUrl as string,
    }));
}

export function prefetchSpotifyAlbumTracks(albumId: string) {
  void getSpotifyAlbumTracks(albumId).catch(() => {
    // Selection prefetch is opportunistic; Start/Create surfaces real failures.
  });
}
