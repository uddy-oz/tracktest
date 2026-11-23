import { useState } from "react";
import type { SpotifyAlbum } from "../lib/spotifyApi";
import { createChallenge, type ChallengeQuestion } from "../lib/soloChallenges";

export default function ChallengeShare({ album, score, correct, questions, canCreate, onGuest }: {
  album: SpotifyAlbum;
  score: number;
  correct: number;
  questions: ChallengeQuestion[];
  canCreate: boolean;
  onGuest: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsGuest, setNeedsGuest] = useState(false);
  const [message, setMessage] = useState("");

  async function create() {
    if (!canCreate) {
      setNeedsGuest(true);
      return;
    }
    setMessage("");
    setBusy(true);
    try {
      const id = await createChallenge(album, score, correct, questions);
      setUrl(new URL(`/challenge/${id}`, window.location.origin).href);
    } catch {
      setMessage("Could not create a challenge. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "StanZer Challenge", text: `Can you beat my ${score.toLocaleString()} points on ${album.title}?`, url });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("Sharing was unavailable. Copy the link instead.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied.");
    } catch {
      setMessage("Copy the link from the field below.");
    }
  }

  return (
    <section className="solo-challenge-share" aria-label="Share a challenge">
      {!url && <button type="button" className="secondary-button" disabled={busy} onClick={() => void create()}>
        {busy ? "Creating challenge..." : "Challenge a Friend"}
      </button>}
      {needsGuest && !canCreate && (
        <p>Keep these results and <button type="button" className="secondary-button" onClick={onGuest}>Continue as Guest</button> to share.</p>
      )}
      {url && (
        <>
          <p>Anyone with this link can play for 7 days. Scores are unverified.</p>
          <input type="url" readOnly aria-label="Challenge link" value={url} onFocus={(event) => event.currentTarget.select()} />
          <div className="solo-postgame-actions">
            {typeof navigator.share === "function" && <button type="button" onClick={() => void share()}>Share Challenge</button>}
            <button type="button" className="secondary-button" onClick={() => void copy()}>Copy Link</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void create()}>
              {busy ? "Creating challenge..." : "Create New Link"}
            </button>
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
