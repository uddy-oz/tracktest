import { analyticsAvailable, analyticsConsent, captureAnalytics, setAnalyticsIdentity } from "./lib/analytics";
import { canLoadDiscoveryArtwork, resolveDiscoveryArtwork } from "./lib/discoveryArtwork";

const html = document.documentElement;
const themeButton = document.querySelector<HTMLButtonElement>(".catalog-theme");
const logo = document.querySelector<HTMLImageElement>(".catalog-brand img");
function applyTheme(theme: string) {
  html.dataset.theme = theme;
  if (logo) logo.src = `/stanzer-wordmark-${theme}.svg`;
  if (themeButton) themeButton.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}
let savedTheme: string | null = null;
try { savedTheme = localStorage.getItem("stanzer.theme"); } catch { /* Browser storage can be disabled. */ }
applyTheme(savedTheme === "light" ? "light" : "dark");
if (themeButton) {
  themeButton.hidden = false;
  themeButton.onclick = () => {
    const theme = html.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try { localStorage.setItem("stanzer.theme", theme); } catch { /* Preference remains local to this page. */ }
  };
}

const menu = document.querySelector<HTMLButtonElement>(".catalog-menu");
if (menu) {
  menu.hidden = false;
  document.querySelector(".catalog-nav")?.setAttribute("data-enhanced", "");
  menu.onclick = () => menu.setAttribute("aria-expanded", String(menu.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
      menu.setAttribute("aria-expanded", "false");
      menu.focus();
    }
  });
}

const filters = document.querySelector<HTMLElement>(".catalog-filters");
const query = filters?.querySelector("input");
const genre = filters?.querySelector("select");
const status = document.querySelector<HTMLElement>(".catalog-filter-status");
if (filters && query && genre && status) {
  const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const groups = [...document.querySelectorAll<HTMLElement>("[data-catalog-genre]")].map(section => ({
    section,
    items: [...section.querySelectorAll<HTMLElement>("[data-catalog-item]")].map(item => ({ item, text: normalize(item.textContent ?? "") })),
  }));
  const jumps = document.querySelector<HTMLElement>(".catalog-genres");
  const update = () => {
    const terms = normalize(query.value.trim()).split(/\s+/);
    let count = 0;
    for (const { section, items } of groups) {
      const matchesGenre = !genre.value || genre.value === section.dataset.catalogGenre;
      for (const { item, text } of items) {
        item.hidden = !matchesGenre || !terms.every(term => text.includes(term));
        if (!item.hidden) count++;
      }
      section.hidden = items.every(({item}) => item.hidden);
    }
    const filtered = Boolean(query.value.trim() || genre.value);
    if (jumps) jumps.hidden = filtered;
    status.hidden = !filtered;
    status.textContent = count ? `${count} ${count === 1 ? "result" : "results"}` : "No matches. Try another search or genre.";
  };
  filters.hidden = false;
  query.addEventListener("input", update);
  genre.addEventListener("change", update);
  update();
}

const { surface, albumId } = document.querySelector<HTMLElement>(".catalog-main")?.dataset ?? {};
if ((surface === "artist_page" || surface === "album_page") && analyticsAvailable() && analyticsConsent()) {
  void Promise.all([import("./lib/supabaseClient"), import("./lib/authIdentity")]).then(async ([{ supabase }, { isAnonymousUser }]) => {
    const session = await supabase?.auth.getSession();
    if (session?.error) return;
    const user = session?.data.session?.user;
    setAnalyticsIdentity(user ? isAnonymousUser(user) ? "guest" : "registered" : "signed_out",
      user?.app_metadata.analytics_excluded === true);
    captureAnalytics("discovery_viewed", { surface, album_id: albumId || undefined }, "catalog-page");
  }).catch(() => { /* Do not track when identity cannot be resolved. */ });
}

for (const slot of document.querySelectorAll<HTMLElement>("[data-cover]")) {
  const id = slot.dataset.cover;
  if (!id || !canLoadDiscoveryArtwork(id)) continue;
  const controller = new AbortController();
  window.addEventListener("pagehide", () => controller.abort(), { once: true });
  const load = () => {
    void resolveDiscoveryArtwork(id, controller.signal).then(url => {
      if (!url || controller.signal.aborted) return;
      const image = new Image();
      image.alt = ""; image.decoding = "async";
      image.onload = () => { if (!controller.signal.aborted) slot.replaceChildren(image); };
      image.src = url;
    }).catch(() => { /* Original artwork stays visible. */ });
  };
  if (typeof IntersectionObserver === "undefined") load();
  else {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { observer.disconnect(); load(); }
    });
    observer.observe(slot);
  }
}
