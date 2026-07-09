export type SpotifyAlbum = {
  id: string;
  title: string;
  artist: string;
  year: string;
  imageUrl: string;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  previewUrl: string | null;
};

type ITunesAlbum = {
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

type ITunesArtist = {
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

function getITunesBaseUrl(path: "search" | "lookup") {
  if (!import.meta.env.PROD) {
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

function isSearchableAlbum(album: ITunesAlbum) {
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

  return true;
}

function isLikelyNoiseAlbum(album: ITunesAlbum) {
  const combinedText = cleanText(
    `${album.collectionName || ""} ${album.artistName || ""}`
  );
  const noiseTerms = [
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

  return noiseTerms.some((term) => combinedText.includes(term));
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

function scoreArtist(artist: ITunesArtist, query: string) {
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

function scoreAlbum(album: ITunesAlbum, query: string, matchedArtistName = "") {
  const queryText = cleanText(query);
  const albumTitle = cleanText(album.collectionName || "");
  const artistName = cleanText(album.artistName || "");
  const matchedArtist = cleanText(matchedArtistName);
  const trackCount = album.trackCount || 0;
  const queryWords = getWords(query);
  const titleWords = getWords(album.collectionName || "");

  let score = 0;

  if (artistName === queryText) {
    score += 240;
  }

  if (artistName.includes(queryText)) {
    score += 150;
  }

  if (queryText.includes(artistName) && artistName.length > 1) {
    score += 120;
  }

  if (matchedArtist && isSameArtistName(artistName, matchedArtist)) {
    score += 180;
  }

  if (albumTitle === queryText) {
    score += 170;
  }

  if (albumTitle.includes(queryText)) {
    score += 120;
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

  if (albumTitle.includes("single")) {
    score -= 55;
  }

  if (isLikelyNoiseAlbum(album)) {
    score -= 220;
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

function removeDuplicateAlbums(albums: SpotifyAlbum[]) {
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
  country: string
): Promise<RankedAlbum[]> {
  const params = new URLSearchParams({
    term: query,
    media: "music",
    entity: "album",
    limit: "100",
    country,
  });

  const searchUrl = `${getITunesBaseUrl("search")}?${params.toString()}`;

  console.log("Album search URL:", searchUrl);

  const response = await fetch(searchUrl);

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

async function searchBestArtist(query: string, country: string) {
  const params = new URLSearchParams({
    term: query,
    media: "music",
    entity: "musicArtist",
    limit: "10",
    country,
  });
  const searchUrl = `${getITunesBaseUrl("search")}?${params.toString()}`;

  console.log("Artist search URL:", searchUrl);

  const response = await fetch(searchUrl);

  if (!response.ok) {
    console.error("iTunes artist search failed:", response.status, country);
    return null;
  }

  const data: ITunesArtistSearchResponse = await response.json();
  const rankedArtists = data.results
    .filter((artist) => artist.artistId && artist.artistName)
    .map((artist) => ({
      artist,
      score: scoreArtist(artist, query),
    }))
    .sort((a, b) => b.score - a.score);

  return rankedArtists[0]?.score > 60 ? rankedArtists[0].artist : null;
}

async function lookupArtistAlbums(
  query: string,
  country: string,
  artist: ITunesArtist
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

  const response = await fetch(lookupUrl);

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
      score: scoreAlbum(album, query, artist.artistName || "") + 120,
    }));
}

export async function searchSpotifyAlbums(query: string): Promise<SpotifyAlbum[]> {
  const countries = ["US", "NG", "GB", "CA", "ZA"];
  const rankedAlbums: RankedAlbum[] = [];

  for (const country of countries) {
    rankedAlbums.push(...(await searchDirectAlbums(query, country)));

    const bestArtist = await searchBestArtist(query, country);

    if (bestArtist) {
      rankedAlbums.push(...(await lookupArtistAlbums(query, country, bestArtist)));
    }
  }

  const sortedAlbums = rankedAlbums
    .sort((a, b) => b.score - a.score)
    .map((item) => item.album);

  return removeDuplicateAlbums(sortedAlbums).slice(0, 50);
}

export async function getSpotifyAlbumTracks(
  albumId: string
): Promise<SpotifyTrack[]> {
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
