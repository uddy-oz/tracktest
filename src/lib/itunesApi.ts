export type ITunesPreview = {
  previewUrl: string;
};

export async function searchITunesPreview(
  artist: string,
  trackName: string
): Promise<ITunesPreview | null> {
  const query = `${artist} ${trackName}`;

  const params = new URLSearchParams({
    term: query,
    media: "music",
    entity: "song",
    limit: "5",
  });

  const response = await fetch(
    `https://itunes.apple.com/search?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error("Failed to search iTunes previews.");
  }

  const data = await response.json();

  const matchingTrack = data.results?.find((result: any) => {
    const resultArtist = result.artistName?.toLowerCase() || "";
    const resultTrack = result.trackName?.toLowerCase() || "";

    return (
      resultArtist.includes(artist.toLowerCase()) &&
      resultTrack.includes(trackName.toLowerCase())
    );
  });

  const fallbackTrack = data.results?.[0];

  const selectedTrack = matchingTrack || fallbackTrack;

  if (!selectedTrack?.previewUrl) {
    return null;
  }

  return {
    previewUrl: selectedTrack.previewUrl,
  };
}
