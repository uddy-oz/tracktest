const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;

function generateRandomString(length: number) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let text = "";

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}

async function sha256(plainText: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);

  return window.crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binaryString = "";

  bytes.forEach((byte) => {
    binaryString += String.fromCharCode(byte);
  });

  return btoa(binaryString)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function redirectToSpotifyLogin() {
  const codeVerifier = generateRandomString(64);
  const hashedVerifier = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hashedVerifier);

  localStorage.setItem("spotify_code_verifier", codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "user-read-private",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function getSpotifyAccessToken(code: string) {
  const codeVerifier = localStorage.getItem("spotify_code_verifier");

  if (!codeVerifier) {
    throw new Error("Missing Spotify code verifier.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error("Failed to get Spotify access token.");
  }

  const data = await response.json();

  localStorage.setItem("spotify_access_token", data.access_token);

  return data.access_token;
}