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
  artistName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  trackCount?: number;
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

type ITunesSearchResponse = {
  resultCount: number;
  results: ITunesAlbum[];
};

type ITunesLookupResponse = {
  resultCount: number;
  results: ITunesTrack[];
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

function isRealQuizAlbum(album: ITunesAlbum) {
  const title = cleanText(album.collectionName || "");
  const trackCount = album.trackCount || 0;

  if (!album.collectionId || !album.collectionName) {
    return false;
  }

  if (title.includes("single")) {
    return false;
  }

  if (trackCount > 0 && trackCount < 4) {
    return false;
  }

  return true;
}

function scoreAlbum(album: ITunesAlbum, query: string) {
  const queryText = cleanText(query);
  const albumTitle = cleanText(album.collectionName || "");
  const artistName = cleanText(album.artistName || "");
  const trackCount = album.trackCount || 0;
  const queryWords = getWords(query);

  let score = 0;

  if (artistName === queryText) {
    score += 100;
  }

  if (artistName.includes(queryText)) {
    score += 80;
  }

  if (albumTitle === queryText) {
    score += 90;
  }

  if (albumTitle.includes(queryText)) {
    score += 70;
  }

  queryWords.forEach((word) => {
    if (artistName.includes(word)) {
      score += 20;
    }

    if (albumTitle.includes(word)) {
      score += 15;
    }
  });

  if (trackCount >= 10) {
    score += 35;
  } else if (trackCount >= 7) {
    score += 25;
  } else if (trackCount >= 4) {
    score += 10;
  }

  if (albumTitle.includes("single")) {
    score -= 200;
  }

  if (trackCount > 0 && trackCount < 4) {
    score -= 150;
  }

  return score;
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

export async function searchSpotifyAlbums(query: string): Promise<SpotifyAlbum[]> {
  const countries = ["US", "NG", "GB", "CA", "ZA"];
  const rankedAlbums: RankedAlbum[] = [];

  for (const country of countries) {
    const params = new URLSearchParams({
      term: query,
      media: "music",
      entity: "album",
      limit: "50",
      country,
    });

    const response = await fetch(
      `${getITunesBaseUrl("search")}?${params.toString()}`
    );

    if (!response.ok) {
      console.error("iTunes album search failed:", response.status, country);
      continue;
    }

    const data: ITunesSearchResponse = await response.json();

    data.results
      .filter(isRealQuizAlbum)
      .forEach((album) => {
        rankedAlbums.push({
          album: {
            id: makeAlbumId(country, album.collectionId as number),
            title: album.collectionName || "Unknown album",
            artist: album.artistName || "Unknown artist",
            year: album.releaseDate?.slice(0, 4) || "Unknown year",
            imageUrl: album.artworkUrl100
              ? improveArtworkUrl(album.artworkUrl100)
              : "",
          },
          score: scoreAlbum(album, query),
        });
      });
  }

  const sortedAlbums = rankedAlbums
    .sort((a, b) => b.score - a.score)
    .map((item) => item.album);

  return removeDuplicateAlbums(sortedAlbums).slice(0, 9);
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

  const response = await fetch(
    `${getITunesBaseUrl("lookup")}?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error("Failed to get album tracks.");
  }

  const data: ITunesLookupResponse = await response.json();

  return data.results
    .filter(
      (item) =>
        item.wrapperType === "track" &&
        item.kind === "song" &&
        item.trackId &&
        item.trackName &&
        item.previewUrl
    )
    .map((track) => ({
      id: `itunes-${track.trackId}`,
      name: track.trackName as string,
      previewUrl: track.previewUrl as string,
    }));
}