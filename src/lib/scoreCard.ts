export const STANZER_SHARE_URL = "https://stanzer.app";
export const STANZER_SCORE_WORDMARK = "/stanzer-wordmark-dark.svg";

export type ScoreCardResult = {
  mode: "Solo" | "Duel" | "Group Lobby" | "Play With Friends" | "Party Mode";
  album: string;
  artist: string;
  score: number;
  unit: "points" | "round points";
  detail?: string;
  playerName?: string;
};

const shareText = (value: string, limit: number) =>
  Array.from(value.trim().replace(/\s+/g, " ")).slice(0, limit).join("");

export function scoreInviteTitle(name?: string) {
  return `${shareText(name ?? "", 48) || "Guest Player"} challenged you`;
}

export function scoreShareLink(result: ScoreCardResult, origin = STANZER_SHARE_URL) {
  const url = new URL("/play", origin);
  url.search = new URLSearchParams({
    album: shareText(result.album, 240),
    from: shareText(result.playerName ?? "", 48) || "Guest Player",
    score: String(result.score),
    unit: result.unit === "round points" ? "round" : "pts",
  }).toString();
  return url.href;
}

export function readScoreInvite(search: string) {
  const params = new URLSearchParams(search);
  const album = shareText(params.get("album") ?? "", 240);
  const rawScore = params.get("score") ?? "";
  const score = /^\d{1,12}$/.test(rawScore) ? Number(rawScore) : null;
  return album ? {
    album,
    title: params.has("from") ? scoreInviteTitle(params.get("from") ?? "") : null,
    score: score?.toLocaleString("en-US") ?? null,
    unit: params.get("unit") === "round" ? "round points" : "points",
  } : null;
}

export function formatScoreCardText(result: ScoreCardResult) {
  return `I scored ${result.score.toLocaleString("en-US")} ${result.unit} on ${result.album} by ${result.artist} in StanZer ${result.mode}.`;
}

export async function createScoreCard(result: ScoreCardResult): Promise<Blob> {
  const logo = new Image();
  logo.src = STANZER_SCORE_WORDMARK;
  await logo.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Image creation is unavailable."));
  const accent = {"Solo":"#5de3ef","Duel":"#ff73b0","Group Lobby":"#5de3ef","Play With Friends":"#5de3ef","Party Mode":"#c9f574"}[result.mode];
  const backdrop = ctx.createLinearGradient(0, 0, 1200, 675);
  backdrop.addColorStop(0, "#101325");
  backdrop.addColorStop(1, "#101f24");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, 1200, 675);
  ctx.strokeStyle = "#29374a";
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, 1136, 611);
  ctx.fillStyle = accent;
  ctx.fillRect(32, 32, 1136, 6);
  // A decorative equalizer, not a visualization of the underlying clip.
  ctx.globalAlpha = 0.36;
  [30, 58, 90, 50, 128, 168, 88, 134, 64, 110, 52, 28].forEach((height, index) => {
    ctx.fillRect(800 + index * 26, 299 - height / 2, 10, height);
  });
  ctx.globalAlpha = 1;

  function label(text: string, size: number, weight: number, color: string, x: number, y: number, width: number) {
    ctx!.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx!.fillStyle = color;
    const glyphs = Array.from(text.replace(/\s+/g, " ").trim());
    if (ctx!.measureText(glyphs.join("")).width > width) {
      while (glyphs.length && ctx!.measureText(glyphs.join("") + "...").width > width) glyphs.pop();
      glyphs.push("...");
    }
    ctx!.fillText(glyphs.join(""), x, y, width);
  }

  ctx.drawImage(logo, 74, 53, 285, 96);
  label(result.mode.toUpperCase(), 25, 750, accent, 74, 202, 850);
  label(result.score.toLocaleString("en-US"), 136, 800, "#f7f9ff", 65, 365, 710);
  label(result.unit.toUpperCase(), 28, 750, accent, 75, 417, 990);
  label(result.album, 42, 750, "#f7f9ff", 74, 514, 1052);
  label(result.artist, 29, 500, "#c6d0e2", 74, 560, 1052);
  label(result.detail || "", 22, 600, "#c6d0e2", 74, 611, 650);

  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not export image.")),
    "image/png"
  ));
}
