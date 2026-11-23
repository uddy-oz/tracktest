import { useState } from "react";
import { createPortal } from "react-dom";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";
import type { SpotifyAlbum } from "../lib/spotifyApi";
import AlbumSearch from "./AlbumSearch";

type SoloAlbumPickerProps = {
  onClose: () => void;
  onStartAlbum: (album: SpotifyAlbum) => Promise<void>;
};

export default function SoloAlbumPicker({ onClose, onStartAlbum }: SoloAlbumPickerProps) {
  const [starting, setStarting] = useState(false);
  const dialogRef = useAccessibleDialog<HTMLElement>({
    open: true,
    onClose: () => {
      if (!starting) onClose();
    },
  });

  async function startAlbum(album: SpotifyAlbum) {
    setStarting(true);
    try {
      await onStartAlbum(album);
    } finally {
      setStarting(false);
    }
  }

  return createPortal(
    <div className="multiplayer-access-backdrop">
      <section
        ref={dialogRef}
        className="multiplayer-access-dialog solo-album-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="solo-album-picker-title"
      >
        <header className="solo-album-picker-header">
          <h2 id="solo-album-picker-title">Choose Another Album</h2>
          <button type="button" className="secondary-button" disabled={starting} onClick={onClose}>
            Cancel
          </button>
        </header>
        <AlbumSearch onStartQuiz={startAlbum} compact inPicker starting={starting} />
      </section>
    </div>,
    document.body
  );
}
