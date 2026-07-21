# StanZer

**Prove you're a superfan.**

[Open the live app](https://tracktest-xwee.vercel.app)

StanZer is a competitive music quiz game built around real albums. Search for an artist or album, identify tracks from five second clips, and turn every run into points, badges, rankings, and multiplayer bragging rights.

## Game Modes

- **Single Player:** Master your favourite albums, build stats, and unlock achievements.
- **Duel:** Challenge one player on a shared, synchronized album quiz.
- **Group Lobby:** Compete with a live room of players on the same questions and clips.
- **Party Mode:** Play Kahoot-style with audio on the host device and answers on every player's phone.

## Highlights

- Smart album and artist search backed by iTunes data
- Five second clips and ten seconds to answer
- Speed-based scoring, streaks, perfect runs, and achievement badges
- Local progress for guests and Supabase cloud progress for signed-in players
- Public player profiles and Global Arena rankings
- Public rooms, private invite links, rematches, room recovery, and forfeits
- Responsive dark purple game interface for desktop and mobile

## Tech Stack

- React 19
- TypeScript
- Vite
- Supabase Auth and Postgres
- iTunes Search and Lookup APIs
- CSS
- Vercel

## Run Locally

```bash
git clone https://github.com/uddy-oz/tracktest.git
cd tracktest
npm install
```

Create a `.env.local` file with your public Supabase project values:

```env
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Never use a Supabase service role key in frontend environment variables.

Start the development server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```
