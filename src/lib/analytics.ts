import { parseSharedAlbumId } from "./albumShareId.ts";

const choices = {
  mode: ["solo", "friends", "party", "duel", "group"],
  source: ["score_share", "direct", "whatsapp", "discord", "instagram", "tiktok", "reddit", "email", "handshake", "other"],
  medium: ["social", "email", "messaging", "referral", "other"],
  campaign: ["handshake", "launch", "score_share", "other"],
  outcome: ["playing", "failed", "timeout", "blocked", "stalled", "audio_skipped", "abandoned", "completed", "forfeit"],
  method: ["copy", "download", "native"],
  goal: ["warm-up", "sharp-ears", "bring-the-competition", "sweep"],
  surface: ["daily_picks", "home_feature", "home_search", "artist", "search", "score_share"],
  lookup: ["exact", "fallback"],
} as const;
type ChoiceProps = { [Key in keyof typeof choices]?: (typeof choices)[Key][number] };
type EventProps = ChoiceProps & { album_id?: string; artist_id?: string; run_id?: string; startup_ms?: number; after_countdown_ms?: number };
type EventName = "visit" | "game_started" | "game_finished" | "room_created" | "room_joined" |
  "rematch" | "daily_goal" | "score_share_opened" | "score_share_action" | "score_link_viewed" | "audio_playback" |
  "discovery_viewed" | "album_selected" | "album_lookup";
type PlayerKind = "registered" | "guest" | "signed_out";

export function analyticsProperties(input: EventProps) {
  const output: Record<string, string | number> = {};
  for (const key of Object.keys(choices) as (keyof ChoiceProps)[]) {
    const value = input[key];
    if (value && (choices[key] as readonly string[]).includes(value)) output[key] = value;
  }
  if (input.album_id && parseSharedAlbumId(input.album_id)) output.album_id = input.album_id;
  if (input.artist_id && /^[1-9]\d{0,15}$/.test(input.artist_id)) output.artist_id = input.artist_id;
  if (input.run_id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.run_id)) output.run_id = input.run_id;
  for (const key of ["startup_ms", "after_countdown_ms"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 60000) output[key] = Math.round(value);
  }
  return output;
}

export function campaignProperties(search: string): ChoiceProps {
  const params = new URLSearchParams(search);
  function bucket<Key extends "source" | "medium" | "campaign">(key: Key): (typeof choices)[Key][number] | undefined {
    const raw = params.get(`utm_${key}`)?.toLowerCase();
    return raw ? ((choices[key] as readonly string[]).includes(raw) ? raw as (typeof choices)[Key][number] : "other") : undefined;
  }
  return {
    source: params.get("source") === "score_share" ? "score_share" : bucket("source"),
    medium: bucket("medium"), campaign: bucket("campaign"),
  };
}

let playerKind: PlayerKind = "signed_out";
let excludedAccount = false;
let acquisition: ChoiceProps | undefined;
const seen = new Set<string>();
const prefix = "stanzer.analytics.";

export function analyticsAvailable() {
  const env = import.meta.env;
  return Boolean(env && typeof window !== "undefined" &&
    ((env.DEV && env.VITE_ANALYTICS_LOCAL_TEST === "true" && ["127.0.0.1", "localhost"].includes(window.location.hostname)) ||
    (env.PROD && env.VITE_ENABLE_PRODUCT_ANALYTICS === "true" && window.location.origin === "https://stanzer.app")));
}

export function analyticsConsent() {
  try {
    return localStorage.getItem(prefix + "consent") === "yes";
  } catch {
    return false;
  }
}

export function setAnalyticsConsent(allow: boolean) {
  try {
    localStorage.setItem(prefix + "consent", allow ? "yes" : "no");
    if (allow) captureAnalytics("visit", {}, "page");
    else {
      for (const key of ["browser", "recent_events", "first_game_day"]) localStorage.removeItem(prefix + key);
      sessionStorage.removeItem(prefix + "campaign");
      acquisition = undefined;
      seen.clear();
    }
    return analyticsConsent();
  } catch {
    return false;
  }
}

export function setAnalyticsIdentity(kind: PlayerKind, exclude = false) {
  playerKind = kind;
  excludedAccount = exclude;
}

export function captureAnalytics(event: EventName, props: EventProps = {}, dedupKey?: string, persist = false) {
  try {
    const env = import.meta.env;
    if (!analyticsAvailable() || !analyticsConsent()) return;
    const localTest = env.DEV && env.VITE_ANALYTICS_LOCAL_TEST === "true" && ["127.0.0.1", "localhost"].includes(window.location.hostname);
    if ((!localTest && (!env.PROD || env.VITE_ENABLE_PRODUCT_ANALYTICS !== "true" ||
        window.location.origin !== "https://stanzer.app" || navigator.webdriver)) ||
        navigator.doNotTrack === "1" || localStorage.getItem(prefix + "disabled") === "1" ||
        (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl || excludedAccount) return;
    const key = env.VITE_POSTHOG_KEY;
    const host = env.VITE_POSTHOG_HOST;
    if (!localTest && (!/^phc_[A-Za-z0-9]+$/.test(key ?? "") ||
        !["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host))) return;
    const dedup = dedupKey && `${event}:${dedupKey}`;
    if (dedup && seen.has(dedup)) return;
    if (dedup && persist) {
      const prior = JSON.parse(localStorage.getItem(prefix + "recent_events") ?? "[]") as string[];
      if (prior.includes(dedup)) return;
      localStorage.setItem(prefix + "recent_events", JSON.stringify([...prior.slice(-255), dedup]));
    }
    if (dedup) {
      if (seen.size >= 512) seen.clear();
      seen.add(dedup);
    }
    let distinctId = localStorage.getItem(prefix + "browser");
    if (!distinctId || !/^[0-9a-f-]{36}$/.test(distinctId)) {
      distinctId = crypto.randomUUID();
      localStorage.setItem(prefix + "browser", distinctId);
    }
    const incoming = campaignProperties(window.location.search);
    if (incoming.source || incoming.medium || incoming.campaign) {
      acquisition = incoming;
      sessionStorage.setItem(prefix + "campaign", JSON.stringify(analyticsProperties(incoming)));
    }
    acquisition ??= JSON.parse(sessionStorage.getItem(prefix + "campaign") ?? "{}") as ChoiceProps;
    const agent = navigator.userAgent;
    const browser = /Firefox\/|FxiOS\//.test(agent) ? "firefox" : /Chrome\/|CriOS\/|Chromium\//.test(agent)
      ? "chromium" : /Safari\//.test(agent) ? "safari" : "other";
    const properties = {
      ...analyticsProperties({ ...acquisition, ...props }), player_kind: playerKind, browser,
      environment: localTest ? "test" : "production", $process_person_profile: false, $geoip_disable: true,
    };
    if (event === "game_started") {
      const today = new Date().toISOString().slice(0, 10);
      const firstGameDay = localStorage.getItem(prefix + "first_game_day") ?? today;
      localStorage.setItem(prefix + "first_game_day", firstGameDay);
      Object.assign(properties, { player_status: firstGameDay === today ? "new" : "returning" });
    }
    if (localTest) {
      window.dispatchEvent(new CustomEvent("stanzer:analytics-test", { detail: { event, distinct_id: distinctId, properties } }));
      return;
    }
    void fetch(`${host}/i/v0/e/`, {
      method: "POST", body: JSON.stringify({ api_key: key, event, distinct_id: distinctId, properties }),
      headers: { "Content-Type": "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics must not affect gameplay, including when browser storage is disabled.
  }
}

export function newAnalyticsRunId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}:${performance.now()}`;
  }
}

export function analyticsArenaMode(room: {mode: string; unifiedFriends?: boolean}): EventProps["mode"] {
  return room.mode === "party_mode" ? "party" : room.unifiedFriends ? "friends" : room.mode === "duel" ? "duel" : "group";
}
