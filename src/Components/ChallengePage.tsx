import { useEffect, useState } from "react";
import type { SpotifyAlbum } from "../lib/spotifyApi";
import { fetchChallenge, startChallenge, type SoloChallenge } from "../lib/soloChallenges";
import { sounds } from "../lib/sounds";
import Quiz from "./Quiz";

export default function ChallengePage({ id, signedIn, onSignIn, onGuest, onHome, onStartAlbum, onLeaveArena }: {
  id: string;
  signedIn: boolean;
  onSignIn: () => void;
  onGuest: () => void;
  onHome: () => void;
  onStartAlbum: (album: SpotifyAlbum) => Promise<void>;
  onLeaveArena: () => Promise<boolean>;
}) {
  const [invitation, setInvitation] = useState<SoloChallenge | null | undefined>();
  const [error, setError] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchChallenge(id).then(
      (result) => { if (!cancelled) setInvitation(result); },
      () => { if (!cancelled) setError("Could not load this challenge. Try again."); }
    );
    return () => { cancelled = true; };
  }, [id, loadRevision]);

  async function begin() {
    sounds.prime();
    setBusy(true);
    setError("");
    try {
      if (await onLeaveArena()) setAttemptId(await startChallenge(id));
    } catch {
      setError("Could not start this challenge. It may have expired, or you may have reached the daily limit.");
    } finally {
      setBusy(false);
    }
  }

  if (invitation && attemptId && signedIn) {
    return (
      <Quiz key={attemptId} selectedAlbum={invitation.album} user={null} canShare
        onChallengeGuest={onGuest} replay={{challenge: invitation, attemptId}}
        onRestartApp={() => setAttemptId("")} onStartAlbum={onStartAlbum} onHome={onHome} />
    );
  }

  return (
    <main className="quiz solo-challenge-invite">
      <p className="eyebrow">Shareable Challenge</p>
      {invitation && (
        <>
          <div className="solo-challenge-album">
            {invitation.album.imageUrl && <img className="quiz-album-cover" src={invitation.album.imageUrl} alt="" />}
            <div>
              <h1>{invitation.album.title}</h1>
              <p>{invitation.album.artist}</p>
            </div>
          </div>
          <div className="solo-challenge-target">
            <p className="eyebrow">Score to beat</p>
            <strong className="solo-challenge-points">{invitation.score.toLocaleString()}</strong>
            <p>{invitation.playerName} scored {invitation.correct} of {invitation.questionCount} correct.</p>
          </div>
          <p className="solo-challenge-note">Scores are unverified. Challenge replays don't count toward Solo progression, Daily Goals, achievements, or global leaderboards.</p>
          <p className="solo-challenge-note">Expires <time dateTime={invitation.expiresAt}>{new Date(invitation.expiresAt).toLocaleString()}</time></p>
          <div className="solo-postgame-actions">
            {signedIn
              ? <button type="button" disabled={busy} onClick={() => void begin()}>{busy ? "Starting..." : "Play Challenge"}</button>
              : <>
                  <button type="button" onClick={onSignIn}>Sign In / Create Account</button>
                  <button type="button" className="secondary-button" onClick={onGuest}>Continue as Guest</button>
                </>}
          </div>
        </>
      )}
      {invitation === null && <h1>Challenge unavailable</h1>}
      {invitation === null && <p>This link is invalid or has expired.</p>}
      {invitation === undefined && !error && <p role="status">Loading challenge...</p>}
      {error && <p role="alert">{error}</p>}
      {error && !invitation && <button type="button" onClick={() => { setError(""); setLoadRevision(value => value + 1); }}>Try Again</button>}
      <button type="button" className="secondary-button solo-challenge-home" onClick={onHome}>Back to Home</button>
    </main>
  );
}
