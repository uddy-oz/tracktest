import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize, Minimize, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";
import "./PartyStage.css";

type Player = { id: string; name: string; detail: string };
type Props = {
  phase: "waiting" | "preparing" | "countdown" | "answering" | "reveal" | "finished";
  album: string; artist: string; code?: string; invite?: string;
  question: number; total: number; seconds: number;
  answered: number; competitors: number; playing: boolean;
  answer?: string; winner?: string; players: Player[];
  muted: boolean; onMute: () => void; onClose: () => void;
  onStart?: () => void; startDisabled?: boolean; audioNeedsAttention?: boolean;
};

export default function PartyStage(stage: Props) {
  const title = useId();
  const surface = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  const dialog = useAccessibleDialog<HTMLElement>({ open: true, onClose: stage.onClose });
  const waiting = stage.phase === "waiting";
  const finished = stage.phase === "finished";
  const reveal = stage.phase === "reveal";
  const standings = reveal || finished;
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === surface.current) await document.exitFullscreen();
      else if (surface.current?.requestFullscreen) await surface.current.requestFullscreen();
      else throw new Error();
      setNotice("");
    } catch {
      setNotice("Fullscreen unavailable. Stage view is still open.");
    }
  }

  return createPortal(
    <div ref={surface} className="party-stage-shell">
      <section ref={dialog} className="party-stage" role="dialog" aria-modal="true" aria-labelledby={title}>
        <header className="party-stage-header">
          <img src="/stanzer-wordmark-dark.svg" alt="StanZer" />
          <div className="party-stage-controls">
            {waiting && stage.onStart && <button type="button" disabled={stage.startDisabled} onClick={stage.onStart}>Start Game</button>}
            <button type="button" onClick={stage.onMute} aria-pressed={stage.muted} aria-label="Mute sound effects" title="Mute sound effects">
              {stage.muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            </button>
            <button type="button" onClick={() => void toggleFullscreen()} aria-label="Toggle fullscreen" title="Toggle fullscreen">
              <Maximize className="party-stage-expand" aria-hidden /><Minimize className="party-stage-shrink" aria-hidden />
            </button>
            <button type="button" onClick={stage.onClose} aria-label="Close Stage Mode" title="Close Stage Mode"><X aria-hidden /></button>
          </div>
        </header>
        {notice && <p role="status" className="party-stage-note">{notice}</p>}
        {stage.audioNeedsAttention && <p role="status" className="party-stage-note">Host audio needs attention. Close Stage Mode to retry from the host controls.</p>}
        <div className={waiting || standings ? "party-stage-content party-stage-split" : "party-stage-content"}>
          <div className="party-stage-main">
            <p className="party-stage-kicker">{waiting || finished ? "Party Mode" : `Question ${stage.question} of ${stage.total}`}</p>
            <h1 id={title}>{waiting ? stage.album : finished ? stage.winner || "Party complete" :
              reveal ? stage.answer || "Round complete" :
                stage.phase === "countdown" ? "Get ready" : stage.phase === "answering" ? "Name that track" : "Preparing audio"}</h1>
            {waiting ? <>
              <p>{stage.artist}</p>
              {stage.invite && <QRCodeSVG className="party-stage-qr" value={stage.invite} size={512} marginSize={4}
                bgColor="#fff" fgColor="#000" title="Party Mode invitation" />}
              {stage.code && <p className="party-stage-code">Room code <strong data-long-code={stage.code.length > 8}>{stage.code}</strong></p>}
            </> : finished ? <Trophy className="party-stage-trophy" aria-hidden /> : <>
              {reveal ? <p>Round reveal · {stage.seconds}s</p> : <>
                {(stage.phase === "countdown" || stage.phase === "answering") &&
                  <p className="party-stage-clock" aria-label={`${stage.seconds} seconds remaining`}>{stage.seconds}</p>}
                <div className="party-stage-wave" data-playing={stage.playing} aria-hidden="true">
                  {[38, 62, 48, 82, 55, 92, 62, 75, 42, 58, 32].map((height, i) =>
                    <span key={i} style={{ height: `${height}%`, animationDelay: `${i * -80}ms` }} />)}
                </div>
                <p><strong>{stage.answered}</strong> of {stage.competitors} players answered</p>
              </>}
            </>}
          </div>
          {(waiting || standings) && <section className="party-stage-roster" aria-label={waiting ? "Connected players" : "Standings"}>
            <h2>{waiting ? `Players · ${stage.players.length}` : "Standings"}</h2>
            <ol>{stage.players.map((player, index) => <li key={player.id}>
              {standings && <span className="party-stage-rank">{index + 1}</span>}
              <strong>{player.name}</strong><span>{player.detail}</span>
            </li>)}</ol>
          </section>}
        </div>
      </section>
    </div>, document.body,
  );
}
