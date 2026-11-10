import { useRef } from "react";
import { X } from "lucide-react";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";

type MultiplayerAccessDialogProps = {
  onClose: () => void;
  onSignIn: () => void;
  onGuest: () => void;
};

export default function MultiplayerAccessDialog({
  onClose,
  onSignIn,
  onGuest,
}: MultiplayerAccessDialogProps) {
  const signInRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useAccessibleDialog<HTMLElement>({
    open: true,
    onClose,
    initialFocusRef: signInRef,
  });

  return (
    <div
      className="multiplayer-access-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="multiplayer-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="multiplayer-access-title"
        aria-describedby="multiplayer-access-description"
      >
        <button
          type="button"
          className="multiplayer-access-close"
          aria-label="Close multiplayer access"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
        <p className="eyebrow">Multiplayer</p>
        <h2 id="multiplayer-access-title">How do you want to play?</h2>
        <p id="multiplayer-access-description">
          Sign in to save your wins, stats, and achievements. Guest progress is temporary.
        </p>
        <div className="multiplayer-access-actions">
          <button ref={signInRef} type="button" className="primary-button" onClick={onSignIn}>
            Sign In / Create Account
          </button>
          <button type="button" className="secondary-button" onClick={onGuest}>
            Continue as Guest
          </button>
        </div>
      </section>
    </div>
  );
}
