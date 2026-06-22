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

type ITunesSearchResponse = {
  resultCount: number;
  results: ITunesAlbum[];
};

type ITunesLookupResponse = {
  resultCount: number;
  results: ITunesTrack[];
};

function getITunesBaseUrl(path: "search" | "lookup") {
  return import.meta.env.PROD
    ? `/itunes/${path}`
    : `https://itunes.apple.com/${path}`;
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
  const countries = ["US", "GB", "CA", "NG"];
  const allAlbums: SpotifyAlbum[] = [];

  for (const country of countries) {
    const params = new URLSearchParams({
      term: query,
      media: "music",
      entity: "album",
      limit: "12",
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

    const albums = data.results
      .filter((album) => album.collectionId)
      .map((album) => ({
        id: makeAlbumId(country, album.collectionId as number),
        title: album.collectionName || "Unknown album",
        artist: album.artistName || "Unknown artist",
        year: album.releaseDate?.slice(0, 4) || "Unknown year",
        imageUrl: album.artworkUrl100
          ? improveArtworkUrl(album.artworkUrl100)
          : "",
      }));

    allAlbums.push(...albums);
  }

  return removeDuplicateAlbums(allAlbums).slice(0, 9);
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