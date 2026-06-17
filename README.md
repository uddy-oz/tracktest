# TrackTest

TrackTest is a music quiz web app that turns real albums into interactive song guessing games.

Users can connect their Spotify account, search for an album, choose an album, and play a quiz generated from real track data. The app uses Spotify for album metadata and track lists, then uses iTunes previews to provide playable 30 second audio clips when available.

## Features

- Spotify login with OAuth
- Real album search using the Spotify Web API
- Album cover display
- Quiz generation from real album track lists
- 30 second audio previews using the iTunes Search API
- Multiple choice song guessing
- Score tracking
- Correct and wrong answer feedback
- Restart quiz and choose another album flow

## Tech Stack

- React
- TypeScript
- Vite
- Spotify Web API
- iTunes Search API
- CSS
- Git and GitHub

## How It Works

1. The user logs in with Spotify.
2. The user searches for an album.
3. Spotify returns matching albums with cover art and metadata.
4. The user selects an album.
5. Spotify provides the track list for that album.
6. TrackTest builds a quiz from the album tracks.
7. iTunes previews are used to play short audio clips.
8. The user guesses the correct song and receives score feedback.

## Running Locally

Here is how to get the app running on your machine. It needs Node and a Spotify app for login.

1. Clone the repository and move into the folder:

```bash
git clone https://github.com/uddy-oz/tracktest.git
cd tracktest
```

2. Install dependencies:

```bash
npm install
```

3. Create a Spotify developer app and note the Client ID. In the Spotify app settings add the Redirect URI `http://localhost:5173/callback`.

4. Create a file named `.env` in the project root and add these variables:

```env
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
VITE_SPOTIFY_REDIRECT_URI=http://localhost:5173/callback
```

Replace `your_spotify_client_id_here` with the Client ID from your Spotify app.

5. Start the dev server:

```bash
npm run dev
```

6. Open the URL printed by Vite in your browser, usually `http://localhost:5173`.

Notes:

- The app uses Vite to serve modules and environment variables. Opening `index.html` directly will not work.
- You only need a Spotify Client ID. The app uses the client side PKCE flow and stores tokens in localStorage for search and previews.
- To build a production bundle run `npm run build` then `npm run preview` to preview the build locally.
