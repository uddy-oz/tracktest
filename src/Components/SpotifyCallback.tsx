import { useEffect, useState } from "react";
import { getSpotifyAccessToken } from "../lib/spotifyAuth";

type SpotifyCallbackProps = {
  onSpotifyConnected: () => void;
};

function SpotifyCallback({ onSpotifyConnected }: SpotifyCallbackProps) {
  const [message, setMessage] = useState("Connecting to Spotify...");

  useEffect(() => {
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (!code) {
        setMessage("No Spotify code found.");
        return;
      }

      try {
        await getSpotifyAccessToken(code);
        onSpotifyConnected();
        setMessage("Spotify connected successfully.");
      } catch (error) {
        console.error(error);
        setMessage("Spotify connection failed.");
      }
    }

    handleCallback();
  }, [onSpotifyConnected]);

  return (
    <main>
      <h1>{message}</h1>

      <button onClick={() => (window.location.href = "/")}>
        Back to TrackTest
      </button>
    </main>
  );
}

export default SpotifyCallback;