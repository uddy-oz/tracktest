import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  GUEST_DISPLAY_NAME_MAX_LENGTH,
  validateGuestDisplayName,
} from "../lib/authIdentity";

type GuestNameModalProps = {
  open: boolean;
  canDismiss: boolean;
  onClose: () => void;
  onSubmit: (displayName: string) => Promise<string>;
};

function GuestNameModal({
  open,
  canDismiss,
  onClose,
  onSubmit,
}: GuestNameModalProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open || !canDismiss) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canDismiss, onClose, open]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateGuestDisplayName(name);

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setIsSubmitting(true);
    setError("");
    const submitError = await onSubmit(validation.value);
    if (submitError) setError(submitError);
    setIsSubmitting(false);
  }

  return (
    <div
      className="guest-name-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (canDismiss && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="guest-name-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-name-title"
        aria-describedby="guest-name-description"
      >
        {canDismiss && (
          <button
            type="button"
            className="guest-name-close"
            aria-label="Close guest name setup"
            onClick={onClose}
          >
            X
          </button>
        )}
        <p className="eyebrow">Temporary player</p>
        <h2 id="guest-name-title">What should we call you?</h2>
        <p id="guest-name-description">
          This name will appear in rooms, scoreboards, and match results for
          this guest session.
        </p>

        <form className="guest-name-form" onSubmit={handleSubmit} noValidate>
          <label htmlFor="guest-display-name">Display name</label>
          <input
            ref={inputRef}
            id="guest-display-name"
            type="text"
            value={name}
            maxLength={GUEST_DISPLAY_NAME_MAX_LENGTH}
            placeholder="Enter your name"
            autoComplete="nickname"
            disabled={isSubmitting}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "guest-name-error" : "guest-name-help"}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError("");
            }}
          />
          <div className="guest-name-field-meta">
            <small id="guest-name-help">
              Letters, numbers, spaces, apostrophes, periods, and hyphens.
            </small>
            <small>{name.length}/{GUEST_DISPLAY_NAME_MAX_LENGTH}</small>
          </div>
          {error && (
            <p className="guest-name-error" id="guest-name-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="auth-primary-button"
            disabled={isSubmitting || !name.trim()}
          >
            {isSubmitting ? "Starting guest session..." : "Start Playing"}
          </button>
        </form>

        <p className="guest-name-privacy">
          Guest progress stays temporary. Create an account later to save
          badges, wins, and rank.
        </p>
      </section>
    </div>
  );
}

export default GuestNameModal;
