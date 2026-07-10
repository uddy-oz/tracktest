const arenaModes = [
  {
    title: "Duel",
    label: "1v1",
    description: "Challenge one player head to head on one album.",
    accent: "duel",
  },
  {
    title: "Group Lobby",
    label: "3-10",
    description: "3 to 10 players compete on one album.",
    accent: "group",
  },
  {
    title: "Party Mode",
    label: "Host",
    description:
      "In person game where one host plays music and everyone answers on their phones.",
    accent: "party",
  },
  {
    title: "Championship",
    label: "Final",
    description: "Multi album tournament with one final winner.",
    accent: "championship",
  },
];

type ArenaPageProps = {
  onPlay: () => void;
};

function ArenaPage({ onPlay }: ArenaPageProps) {
  return (
    <section className="arena-page">
      <div className="arena-hero">
        <p className="eyebrow">TrackTest Arena</p>
        <h1>Arena Modes</h1>
        <p>
          The multiplayer wing is being built for duels, live rooms, parties,
          and championship runs.
        </p>
      </div>

      <div className="arena-status">
        <span>Coming Soon</span>
        <div>
          <h2>Arena is coming soon</h2>
          <p>
            Solo stats, badges, profiles, and leaderboards are laying the
            foundation before live rooms open.
          </p>
        </div>
      </div>

      <div className="arena-mode-grid">
        {arenaModes.map((mode) => (
          <article
            className={`arena-mode-card arena-mode-${mode.accent}`}
            key={mode.title}
          >
            <span className="arena-mode-label">{mode.label}</span>
            <h2>{mode.title}</h2>
            <p>{mode.description}</p>
            <strong>Coming soon</strong>
          </article>
        ))}
      </div>

      <button type="button" onClick={onPlay}>
        Back to Play
      </button>
    </section>
  );
}

export default ArenaPage;
