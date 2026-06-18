export type ITunesPreview = {
  trackName: string;
  artistName: string;
  collectionName?: string;
  previewUrl?: string;
};

type ITunesSearchResponse = {
  results: ITunesPreview[];
};

function cleanText(text: string) {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/feat\./g, "featuring")
    .replace(/ft\./g, "featuring")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getMatchScore(song: ITunesPreview, artistName: string, trackName: string) {
  const songTrack = cleanText(song.trackName);
  const targetTrack = cleanText(trackName);

  const songArtist = cleanText(song.artistName);
  const targetArtist = cleanText(artistName);

  let score = 0;

  if (songTrack === targetTrack) score += 100;
  if (songTrack.includes(targetTrack) || targetTrack.includes(songTrack)) score += 50;
  if (songArtist.includes(targetArtist) || targetArtist.includes(songArtist)) score += 30;

  return score;
}

export async function searchITunesPreview(
  artistName: string,
  trackName: string
): Promise<ITunesPreview | null> {
  const searchTerm = `${artistName} ${trackName}`;

  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}` +
    `&media=music&entity=song&limit=25&country=US`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error("iTunes request failed:", response.status);
      return null;
    }

    const data: ITunesSearchResponse = await response.json();

    const songsWithPreview = data.results.filter((song) => song.previewUrl);

    if (songsWithPreview.length === 0) {
      return null;
    }

    const rankedSongs = songsWithPreview
      .map((song) => ({
        song,
        score: getMatchScore(song, artistName, trackName),
      }))
      .sort((a, b) => b.score - a.score);

    const bestMatch = rankedSongs[0];

    if (!bestMatch || bestMatch.score < 50) {
      return null;
    }

    return bestMatch.song;
  } catch (error) {
    console.error("Could not fetch iTunes preview:", error);
    return null;
  }
}