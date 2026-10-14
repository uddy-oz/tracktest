type GuestBadgeProps = {
  compact?: boolean;
};

function GuestBadge({ compact = false }: GuestBadgeProps) {
  return (
    <span
      className={`guest-player-badge ${compact ? "compact" : ""}`}
      title="Temporary guest account"
    >
      Guest
    </span>
  );
}

export default GuestBadge;
