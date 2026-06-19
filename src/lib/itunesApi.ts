export type ITunesPreview = {
  trackName: string;
  artistName: string;
  collectionName?: string;
  previewUrl?: string;
};

export type ITunesTrackPreview = {
  id: string;
  name: string;
  previewUrl: string;
};

type ITunesSearchResponse = {
  resultCount: number;
  results: ITunesPreview[];
};

type ITunesAlbumResult = {
  wrapperType?: string;
  collectionType?: string;
  collectionId?: number;
  artistName?: string;
  collectionName?: string;
};

type ITunesLookupTrack = {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  previewUrl?: string;
};

type ITunesAlbumSearchResponse = {
  resultCount: number;
  results: ITunesAlbumResult[];
};

type ITunesLookupResponse = {
  resultCount: number;
  results: ITunesLookupTrack[];
};

function getITunesBaseUrl(path: "search" | "lookup") {
  return import.meta.env.PROD
    ? `/itunes/${path}`
    : `https://itunes.apple.com/${path}`;
}

function cleanText(text: string) {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/deluxe/g, "")
    .replace(/expanded/g, "")
    .replace(/edition/g, "")
    .replace(/version/g, "")
    .replace(/explicit/g, "")
    .replace(/clean/g, "")
    .replace(/remastered/g, "")
    .replace(/anniversary/g, "")
    .replace(/feat\./g, "")
    .replace(/ft\./g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreAlbumResult(
  album: ITunesAlbumResult,
  artistName: string,
  albumTitle: string
) {
  const targetArtist = cleanText(artistName);
  const targetAlbum = cleanText(albumTitle);

  const resultArtist = cleanText(album.artistName || "");
  const resultAlbum = cleanText(album.collectionName || "");

  let score = 0;

  if (resultAlbum === targetAlbum) score += 100;
  if (resultAlbum.includes(targetAlbum)) score += 60;
  if (targetAlbum.includes(resultAlbum)) score += 40;

  if (resultArtist === targetArtist) score += 60;
  if (resultArtist.includes(targetArtist)) score += 40;
  if (targetArtist.includes(resultArtist)) score += 25;

  return score;
}

function scoreTrackResult(
  song: ITunesPreview,
  artistName: string,
  trackName: string,
  albumTitle = ""
) {
  const targetTrack = cleanText(trackName);
  const resultTrack = cleanText(song.trackName || "");

  const targetArtist = cleanText(artistName);
  const resultArtist = cleanText(song.artistName || "");

  const targetAlbum = cleanText(albumTitle);
  const resultAlbum = cleanText(song.collectionName || "");

  let score = 0;

  if (resultTrack === targetTrack) score += 100;
  if (resultTrack.includes(targetTrack)) score += 60;
  if (targetTrack.includes(resultTrack)) score += 40;

  if (resultArtist === targetArtist) score += 60;
  if (resultArtist.includes(targetArtist)) score += 40;
  if (targetArtist.includes(resultArtist)) score += 25;

  if (targetAlbum && resultAlbum === targetAlbum) score += 40;
  if (targetAlbum && resultAlbum.includes(targetAlbum)) score += 25;

  return score;
}

export async function searchITunesAlbumTracks(
  artistName: string,
  albumTitle: string
): Promise<ITunesTrackPreview[]> {
  const countries = ["US", "CA", "GB"];
  const searchTerms = [
    `${artistName} ${albumTitle}`,
    `${albumTitle} ${artistName}`,
    albumTitle,
  ];

  try {
    for (const country of countries) {
      for (const searchTerm of searchTerms) {
        const searchUrl =
          `${getITunesBaseUrl("search")}?term=${encodeURIComponent(searchTerm)}` +
          `&media=music&entity=album&limit=10&country=${country}`;

        const searchResponse = await fetch(searchUrl);

        if (!searchResponse.ok) {
          continue;
        }

        const searchData: ITunesAlbumSearchResponse =
          await searchResponse.json();

        const albumMatches = searchData.results
          .filter((album) => album.collectionId)
          .map((album) => ({
            album,
            score: scoreAlbumResult(album, artistName, albumTitle),
          }))
          .sort((a, b) => b.score - a.score);

        const bestAlbum = albumMatches[0];

        if (!bestAlbum || !bestAlbum.album.collectionId || bestAlbum.score < 50) {
          continue;
        }

        const lookupUrl =
          `${getITunesBaseUrl("lookup")}?id=${bestAlbum.album.collectionId}` +
          `&entity=song&country=${country}`;

        const lookupResponse = await fetch(lookupUrl);

        if (!lookupResponse.ok) {
          continue;
        }

        const lookupData: ITunesLookupResponse = await lookupResponse.json();

        const tracks = lookupData.results
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

        if (tracks.length >= 4) {
          console.log("Using iTunes album tracks:", {
            artistName,
            albumTitle,
            country,
            matchedAlbum: bestAlbum.album.collectionName,
            trackCount: tracks.length,
          });

          return tracks;
        }
      }
    }

    return [];
  } catch (error) {
    console.error("Could not search iTunes album tracks:", error);
    return [];
  }
}

export async function searchITunesPreview(
  artistName: string,
  trackName: string,
  albumTitle = ""
): Promise<ITunesPreview | null> {
  const searchTerms = [
    `${artistName} ${trackName} ${albumTitle}`,
    `${artistName} ${trackName}`,
    `${trackName} ${artistName}`,
  ];

  try {
    for (const searchTerm of searchTerms) {
      const url =
        `${getITunesBaseUrl("search")}?term=${encodeURIComponent(searchTerm)}` +
        "&media=music&entity=song&limit=25&country=US";

      const response = await fetch(url);

      if (!response.ok) {
        console.error("iTunes request failed:", response.status);
        continue;
      }

      const data: ITunesSearchResponse = await response.json();

      const songsWithPreview = data.results.filter((song) => song.previewUrl);

      if (songsWithPreview.length === 0) {
        continue;
      }

      const rankedSongs = songsWithPreview
        .map((song) => ({
          song,
          score: scoreTrackResult(song, artistName, trackName, albumTitle),
        }))
        .sort((a, b) => b.score - a.score);

      console.log("iTunes preview match:", {
        searchTerm,
        bestMatch: rankedSongs[0],
      });

      return rankedSongs[0].song;
    }

    console.log("No iTunes preview found for:", {
      artistName,
      trackName,
      albumTitle,
    });

    return null;
  } catch (error) {
    console.error("Could not fetch iTunes preview:", error);
    return null;
  }
}