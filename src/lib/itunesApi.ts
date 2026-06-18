export type ITunesPreview = {
  trackName: string;
  artistName: string;
  collectionName?: string;
  previewUrl?: string;
};

type ITunesSearchResponse = {
  resultCount: number;
  results: ITunesPreview[];
};

function cleanText(text: string) {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/feat\./g, "")
    .replace(/ft\./g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreResult(song: ITunesPreview, artistName: string, trackName: string) {
  const targetTrack = cleanText(trackName);
  const resultTrack = cleanText(song.trackName || "");

  const targetArtist = cleanText(artistName);
  const resultArtist = cleanText(song.artistName || "");

  let score = 0;

  if (resultTrack === targetTrack) score += 100;
  if (resultTrack.includes(targetTrack)) score += 60;
  if (targetTrack.includes(resultTrack)) score += 40;
  if (resultArtist.includes(targetArtist)) score += 30;
  if (targetArtist.includes(resultArtist)) score += 20;

  return score;
}

export async function searchITunesPreview(
  artistName: string,
  trackName: string,
  albumTitle = ""
): Promise<ITunesPreview | null> {
  const searchTerm = `${artistName} ${trackName} ${albumTitle}`;

  const baseUrl = import.meta.env.PROD
    ? "/itunes/search"
    : "https://itunes.apple.com/search";

  const url =
    `${baseUrl}?term=${encodeURIComponent(searchTerm)}` +
    "&media=music&entity=song&limit=25&country=US";

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error("iTunes request failed:", response.status);
      return null;
    }

    const data: ITunesSearchResponse = await response.json();

    const songsWithPreview = data.results.filter((song) => song.previewUrl);

    if (songsWithPreview.length === 0) {
      console.log("No iTunes preview found for:", searchTerm);
      return null;
    }

    const rankedSongs = songsWithPreview
      .map((song) => ({
        song,
        score: scoreResult(song, artistName, trackName),
      }))
      .sort((a, b) => b.score - a.score);

    console.log("iTunes preview match:", {
      searchTerm,
      bestMatch: rankedSongs[0],
    });

    return rankedSongs[0].song;
  } catch (error) {
    console.error("Could not fetch iTunes preview:", error);
    return null;
  }
}