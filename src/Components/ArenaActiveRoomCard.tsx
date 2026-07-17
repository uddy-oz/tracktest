import type { ArenaRoom } from "../lib/arenaRooms";

type ArenaActiveRoomCardProps = {
  room: ArenaRoom;
  currentUserId?: string | null;
  onResume: () => void;
  onClose?: () => void;
  isClosing?: boolean;
  compact?: boolean;
};

function getModeLabel(room: ArenaRoom) {
  return room.mode === "group_lobby" ? "Group Lobby" : "Duel";
}

function getStatusLabel(room: ArenaRoom) {
  if (room.status === "active" && room.startedAt) {
    return "Active";
  }

  if (room.status === "starting") {
    return "Starting";
  }

  if (room.status === "waiting") {
    return "Waiting";
  }

  return room.status;
}

function ArenaActiveRoomCard({
  room,
  currentUserId,
  onResume,
  onClose,
  isClosing = false,
  compact = false,
}: ArenaActiveRoomCardProps) {
  const presentPlayers = room.players.filter(
    (player) =>
      !player.leftAt &&
      !["cancelled", "left", "forfeit"].includes(player.resultStatus)
  );
  const isHost = room.hostUserId === currentUserId;
  const canClose = isHost && ["waiting", "starting"].includes(room.status);

  return (
    <article className={`arena-active-room-card ${compact ? "compact" : ""}`}>
      {room.artworkUrl && <img src={room.artworkUrl} alt="" aria-hidden />}
      <div className="arena-active-room-main">
        <p className="eyebrow">Active {getModeLabel(room)} Room</p>
        <h2>{room.albumName}</h2>
        <p>{room.artistName}</p>
        <div className="arena-active-room-meta">
          <span>{getModeLabel(room)}</span>
          <span>{getStatusLabel(room)}</span>
          <span>
            {presentPlayers.length}/{room.maxPlayers} players
          </span>
          {room.isPrivate && <span>Private</span>}
        </div>
      </div>
      <div className="arena-active-room-actions">
        <button type="button" onClick={onResume}>
          Resume Room
        </button>
        {canClose && onClose && (
          <button
            type="button"
            className="secondary-button danger-button"
            disabled={isClosing}
            onClick={onClose}
          >
            {isClosing ? "Closing..." : "Close Room"}
          </button>
        )}
      </div>
    </article>
  );
}

export default ArenaActiveRoomCard;
