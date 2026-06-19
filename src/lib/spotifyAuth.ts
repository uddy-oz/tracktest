const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;

function getRequiredEnv(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is missing from your environment variables.`);
  }

  return value;
}

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
  const safeClientId = getRequiredEnv(
    clientId,
    "VITE_SPOTIFY_CLIENT_ID"
  );

  const safeRedirectUri = getRequiredEnv(
    redirectUri,
    "VITE_SPOTIFY_REDIRECT_URI"
  );

  const codeVerifier = generateRandomString(64);
  const hashedVerifier = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hashedVerifier);

  localStorage.removeItem("spotify_access_token");
  localStorage.removeItem("spotify_code_verifier");
  localStorage.setItem("spotify_code_verifier", codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: safeClientId,
    scope: "user-read-private user-read-email",
    redirect_uri: safeRedirectUri,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  window.location.assign(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );
}

export async function getSpotifyAccessToken(code: string) {
  const safeClientId = getRequiredEnv(
    clientId,
    "VITE_SPOTIFY_CLIENT_ID"
  );

  const safeRedirectUri = getRequiredEnv(
    redirectUri,
    "VITE_SPOTIFY_REDIRECT_URI"
  );

  const codeVerifier = localStorage.getItem("spotify_code_verifier");

  if (!codeVerifier) {
    throw new Error("Missing Spotify code verifier. Start the login again.");
  }

  const body = new URLSearchParams({
    client_id: safeClientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: safeRedirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("Spotify token error:", data);
    throw new Error(
      data?.error_description || data?.error || "Failed to get Spotify access token."
    );
  }

  if (!data?.access_token) {
    throw new Error("Spotify did not return an access token.");
  }

  localStorage.setItem("spotify_access_token", data.access_token);
  localStorage.removeItem("spotify_code_verifier");

  return data.access_token;
}