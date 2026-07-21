type HeroProps = {
  onStartPlaying: () => void;
  onViewLeaderboard: () => void;
};

const MARQUEE_ITEMS = [
  "Five-second clips",
  "Prove you're a superfan",
  "Guess the track",
  "Challenge your friends",
  "Master your favourite albums",
];

function Hero({ onStartPlaying, onViewLeaderboard }: HeroProps) {
  const marqueeContent = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];

  return (
    <>
      <main className="hero">
        <div className="hero-glow" aria-hidden />
        <span className="sparkle s1" aria-hidden>
          *
        </span>
        <span className="sparkle s2" aria-hidden>
          *
        </span>
        <span className="sparkle s3" aria-hidden>
          *
        </span>
        <span className="sparkle s4" aria-hidden>
          *
        </span>

        <p className="eyebrow reveal d1">StanZer</p>

        <h1 className="hero-title">
          <span className="reveal d2">Prove you're</span>
          <span className="reveal d3">
            <em>a superfan.</em>
          </span>
        </h1>

        <p className="subtitle reveal d4">
          Five-second clips. Ten seconds to answer. Every point counts.
        </p>

        <div className="hero-buttons reveal d5">
          <button type="button" onClick={onStartPlaying}>
            Start Playing
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onViewLeaderboard}
          >
            Leaderboard
          </button>
        </div>
      </main>

      <div className="marquee" aria-hidden>
        <div className="marquee-track">
          {marqueeContent.map((item, index) => (
            <span key={index}>
              {item} <b>*</b>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

export default Hero;
