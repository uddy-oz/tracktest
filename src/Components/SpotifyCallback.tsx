import { useEffect, useRef, useState } from "react";
import { getSpotifyAccessToken } from "../lib/spotifyAuth";

type SpotifyCallbackProps = {
  onSpotifyConnected: () => void;
};

function SpotifyCallback({ onSpotifyConnected }: SpotifyCallbackProps) {
  const [message, setMessage] = useState("Connecting to Spotify...");
  const hasHandledCallback = useRef(false);

  useEffect(() => {
    async function handleCallback() {
      if (hasHandledCallback.current) {
        return;
      }

      hasHandledCallback.current = true;

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const spotifyError = params.get("error");

      if (spotifyError) {
        setMessage(`Spotify login failed: ${spotifyError}`);
        return;
      }

      if (!code) {
        setMessage("No Spotify code found.");
        return;
      }

      try {
        await getSpotifyAccessToken(code);

        onSpotifyConnected();
        setMessage("Spotify connected successfully. Redirecting...");

        window.setTimeout(() => {
          window.location.replace("/");
        }, 500);
      } catch (error) {
        console.error("Spotify callback error:", error);

        if (error instanceof Error) {
          setMessage(`Spotify connection failed: ${error.message}`);
        } else {
          setMessage("Spotify connection failed.");
        }
      }
    }

    handleCallback();
  }, [onSpotifyConnected]);

  return (
    <main>
      <h1>{message}</h1>

      <button onClick={() => window.location.replace("/")}>
        Back to TrackTest
      </button>
    </main>
  );
}

export default SpotifyCallback;