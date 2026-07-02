# TrackTest

https://tracktest-xwee.vercel.app


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

Clone the repository:

```bash
git clone https://github.com/uddy-oz/tracktest.git