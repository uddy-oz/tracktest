export type YouTubeVideo = {
  videoId: string;
  title: string;
};

export async function searchYouTubeVideo(query: string): Promise<YouTubeVideo | null> {
  const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing YouTube API key.");
  }

  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: "1",
    key: apiKey,
  });

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error("Failed to search YouTube.");
  }

  const data = await response.json();

  const firstVideo = data.items?.[0];

  if (!firstVideo) {
    return null;
  }

  return {
    videoId: firstVideo.id.videoId,
    title: firstVideo.snippet.title,
  };
}