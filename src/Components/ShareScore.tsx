import { useEffect, useState } from "react";
import { Copy, Download, Share2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";
import { createScoreCard, formatScoreCardText, scoreInviteTitle, scoreShareLink, type ScoreCardResult } from "../lib/scoreCard";

const fileName = "stanzer-score.png";

function ScoreDialog({result, onClose}: {result: ScoreCardResult; onClose: () => void}) {
  const dialogRef = useAccessibleDialog<HTMLElement>({open: true, onClose});
  const [card, setCard] = useState<{url: string; file: File} | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const link = scoreShareLink(result, import.meta.env.DEV ? window.location.origin : undefined);
  const title = scoreInviteTitle(result.playerName);
  useEffect(() => {
    let cancelled = false;
    let url = "";
    void createScoreCard(result).then(blob => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setCard({url, file: new File([blob], fileName, {type:"image/png"})});
    }).catch(() => {
      if (!cancelled) {
        setFailed(true);
        setMessage("Could not generate an image. You can still copy the StanZer link.");
      }
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [result]);

  async function share() {
    if (!navigator.share) return;
    const text = formatScoreCardText(result);
    try {
      const payload = {title, text, url: link};
      const filePayload = card ? {...payload, files: [card.file]} : null;
      await navigator.share(filePayload && navigator.canShare?.(filePayload) ? filePayload : payload);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage("Sharing was unavailable. Download the card or copy the link instead.");
      }
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Album link copied.");
    } catch {
      setMessage("Copy the link from the field below.");
    }
  }

  return createPortal(
    <div className="multiplayer-access-backdrop">
      <section ref={dialogRef} className="multiplayer-access-dialog score-share-dialog"
        role="dialog" aria-modal="true" aria-labelledby="score-share-title">
        <header className="score-share-header">
          <h2 id="score-share-title">Share My Score</h2>
          <button type="button" className="secondary-button" onClick={onClose} aria-label="Close" title="Close">
            <X size={20} aria-hidden />
          </button>
        </header>
        <p className="score-share-invite-title">{title}</p>
        {card && <img className="score-share-image" src={card.url} alt={formatScoreCardText(result)} />}
        {!card && !failed && <p role="status">Preparing your score card...</p>}
        <div className="score-share-actions">
          {card && <a href={card.url} download={fileName} className="secondary-button"><Download size={18} aria-hidden /> Download PNG</a>}
          {typeof navigator.share === "function" && (
            <button type="button" onClick={() => void share()}><Share2 size={18} aria-hidden /> Share</button>
          )}
          <button type="button" className="secondary-button" onClick={() => void copy()}><Copy size={18} aria-hidden /> Copy Link</button>
        </div>
        <input className="score-share-link" aria-label="Single Player album link" value={link} readOnly onFocus={event => event.currentTarget.select()} />
        {message && <p role="status">{message}</p>}
      </section>
    </div>,
    document.body
  );
}

export default function ShareScore({result}: {result: ScoreCardResult}) {
  const [selected, setSelected] = useState<ScoreCardResult | null>(null);
  return (
    <>
      <button type="button" className="secondary-button" onClick={() => setSelected(result)}>
        <Share2 size={18} aria-hidden /> Share My Score
      </button>
      {selected && <ScoreDialog result={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
