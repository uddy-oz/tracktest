import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { QrCode, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";
import { captureAnalytics } from "../lib/analytics";
import "./RoomInviteQr.css";

type Props = { url: string; mode: "friends" | "party"; inline?: boolean };

function InviteQrImage({ url, className }: { url: string; className: string }) {
  return <QRCodeSVG className={className} value={url} size={512} marginSize={4}
    bgColor="#ffffff" fgColor="#000000" title="StanZer room invitation" />;
}

function InviteDisplay({ url, mode, onClose }: Props & { onClose: () => void }) {
  const titleId = useId();
  const ref = useAccessibleDialog<HTMLElement>({ open: true, onClose });

  return createPortal(
    <div className="multiplayer-access-backdrop room-invite-qr-backdrop">
      <section ref={ref} className="multiplayer-access-dialog room-invite-qr-dialog"
        role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <h2 id={titleId}>{mode === "party" ? "Join Party Mode" : "Join Play With Friends"}</h2>
          <button type="button" className="secondary-button" onClick={onClose} aria-label="Close invitation QR code">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <p>Scan with your phone camera to open the room invitation.</p>
        <InviteQrImage url={url} className="room-invite-qr-code" />
        <a href={url} className="secondary-button room-invite-qr-link" target="_blank" rel="noopener noreferrer">
          Open invitation link
        </a>
      </section>
    </div>,
    document.body,
  );
}

export default function RoomInviteQr({ url, mode, inline }: Props) {
  const [open, setOpen] = useState(false);
  if (inline) return <InviteQrImage url={url} className="party-waiting-qr-code" />;
  return (
    <>
      <button type="button" className="secondary-button room-invite-qr-trigger" onClick={() => {
        captureAnalytics("room_invite_qr_opened", { mode });
        setOpen(true);
      }}>
        <QrCode size={17} aria-hidden="true" /> {mode === "party" ? "Enlarge QR" : "Show QR Code"}
      </button>
      {open && <InviteDisplay url={url} mode={mode} onClose={() => setOpen(false)} />}
    </>
  );
}
