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
    .replace(/feat\./g, " ")
    .replace(/ft\./g, " ")
    .replace(/featuring/g, " ")
    .replace(/with/g, " ")
    .replace(/&/g, " ")
    .replace(/deluxe/g, " ")
    .replace(/explicit/g, " ")
    .replace(/clean/g, " ")
    .replace(/remastered/g, " ")
    .replace(/bonus track/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(text: string) {
  return cleanText(text)
    .split(" ")
    .filter((word) => word.length > 1);
}

function wordOverlapScore(target: string, result: string) {
  const targetWords = getWords(target);
  const resultWords = getWords(result);

  if (targetWords.length === 0 || resultWords.length === 0) {
    return 0;
  }

  const matchingWords = targetWords.filter((word) => resultWords.includes(word));

  return matchingWords.length / targetWords.length;
}

function isArtistMatch(resultArtist: string, targetArtist: string) {
  const cleanResultArtist = cleanText(resultArtist);
  const cleanTargetArtist = cleanText(targetArtist);

  if (!cleanResultArtist || !cleanTargetArtist) {
    return false;
  }

  if (cleanResultArtist === cleanTargetArtist) {
    return true;
  }

  if (cleanResultArtist.includes(cleanTargetArtist)) {
    return true;
  }

  if (cleanTargetArtist.includes(cleanResultArtist)) {
    return true;
  }

  return wordOverlapScore(cleanTargetArtist, cleanResultArtist) >= 0.75;
}

function isTrackMatch(resultTrack: string, targetTrack: string) {
  const cleanResultTrack = cleanText(resultTrack);
  const cleanTargetTrack = cleanText(targetTrack);

  if (!cleanResultTrack || !cleanTargetTrack) {
    return false;
  }

  if (cleanResultTrack === cleanTargetTrack) {
    return true;
  }

  if (cleanResultTrack.includes(cleanTargetTrack)) {
    return true;
  }

  if (cleanTargetTrack.includes(cleanResultTrack)) {
    return true;
  }

  return wordOverlapScore(cleanTargetTrack, cleanResultTrack) >= 0.8;
}

function scoreResult(
  song: ITunesPreview,
  artistName: string,
  trackName: string,
  albumTitle: string
) {
  const resultTrack = song.trackName || "";
  const resultArtist = song.artistName || "";
  const resultAlbum = song.collectionName || "";

  let score = 0;

  if (isTrackMatch(resultTrack, trackName)) {
    score += 100;
  }

  if (isArtistMatch(resultArtist, artistName)) {
    score += 80;
  }

  const cleanTargetAlbum = cleanText(albumTitle);
  const cleanResultAlbum = cleanText(resultAlbum);

  if (cleanTargetAlbum && cleanResultAlbum === cleanTargetAlbum) {
    score += 40;
  }

  if (
    cleanTargetAlbum &&
    cleanResultAlbum &&
    cleanResultAlbum.includes(cleanTargetAlbum)
  ) {
    score += 25;
  }

  return score;
}

function getITunesSearchUrl(searchTerm: string, country: string) {
  const baseUrl = import.meta.env.PROD
    ? "/itunes/search"
    : "https://itunes.apple.com/search";

  return (
    `${baseUrl}?term=${encodeURIComponent(searchTerm)}` +
    `&media=music&entity=song&limit=25&country=${country}`
  );
}

export async function searchITunesPreview(
  artistName: string,
  trackName: string,
  albumTitle = ""
): Promise<ITunesPreview | null> {
  const countries = ["US", "GB", "CA", "NG"];

  const searchTerms = [
    `${artistName} ${trackName} ${albumTitle}`,
    `${artistName} ${trackName}`,
    `${trackName} ${artistName}`,
  ];

  try {
    for (const country of countries) {
      for (const searchTerm of searchTerms) {
        const response = await fetch(getITunesSearchUrl(searchTerm, country));

        if (!response.ok) {
          console.error("iTunes request failed:", response.status, searchTerm);
          continue;
        }

        const data: ITunesSearchResponse = await response.json();

        const possibleMatches = data.results
          .filter((song) => song.previewUrl)
          .filter((song) => isArtistMatch(song.artistName || "", artistName))
          .filter((song) => isTrackMatch(song.trackName || "", trackName))
          .map((song) => ({
            song,
            score: scoreResult(song, artistName, trackName, albumTitle),
          }))
          .sort((a, b) => b.score - a.score);

        const bestMatch = possibleMatches[0];

        if (bestMatch && bestMatch.score >= 160) {
          console.log("Accepted iTunes preview:", {
            country,
            searchTerm,
            spotifyArtist: artistName,
            spotifyTrack: trackName,
            spotifyAlbum: albumTitle,
            matchedArtist: bestMatch.song.artistName,
            matchedTrack: bestMatch.song.trackName,
            matchedAlbum: bestMatch.song.collectionName,
            score: bestMatch.score,
          });

          return bestMatch.song;
        }
      }
    }

    console.log("Rejected iTunes preview. No safe match found:", {
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