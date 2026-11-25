import { catalogAlbums, catalogArtists, catalogOrigin, catalogPaths, catalogSlug } from "../src/lib/publicCatalog.ts";
import { approvedDailyCoverIds } from "../src/lib/dailyPickCatalog.ts";
import { discoveryPlayPath } from "../src/lib/featuredDiscovery.ts";

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
type Artist = typeof catalogArtists[number];
type Album = Artist["albums"][number];
const play = (album: Album, source: "artist_page" | "album_page") => escape(discoveryPlayPath(album.title, source, album.id));
const covers = (album: Album) => `<span class="catalog-art" data-motif="${Number(album.id.split(":").at(-1)) % 4}" aria-hidden="true"${approvedDailyCoverIds.has(album.id) ? ` data-cover="${escape(album.id)}"` : ""}><svg viewBox="0 0 32 32" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="16" cy="16" r="13"/><circle cx="16" cy="16" r="8"/><circle cx="16" cy="16" r="2"/></svg></span>`;
const newestFirst = (a: Album, b: Album) => b.year - a.year || a.title.localeCompare(b.title, "en");
const releaseCard = (album: Album, caption: string, source?: "artist_page" | "album_page") =>
  `<li data-catalog-item>${covers(album)}<div class="catalog-card-info"><a class="catalog-release-title" href="${album.path}">${escape(album.title)}</a><p>${escape(caption)}</p></div>${source ? `<a class="catalog-button catalog-card-play" href="${play(album, source)}">Play<span class="catalog-sr"> ${escape(album.title)}</span></a>` : ""}</li>`;
const releaseList = (albums: readonly Album[], source: "artist_page" | "album_page") => `<ul class="catalog-list catalog-cards">${albums.map(album => releaseCard(album, String(album.year), source)).join("")}</ul>`;
const titleBlock = (eyebrow: string, title: string, detail: string, extra = "") =>
  `<section class="catalog-heading"><p class="catalog-eyebrow">${escape(eyebrow)}</p><h1>${escape(title)}</h1><p>${escape(detail)}</p>${extra}</section>`;
const breadcrumbs = (current: string, parents: { label: string; path: string }[]) =>
  `<nav class="catalog-crumbs" aria-label="Breadcrumb"><ol>${parents.map(parent =>
    `<li><a href="${parent.path}">${escape(parent.label)}</a></li>`).join("")}<li aria-current="page">${escape(current)}</li></ol></nav>`;
const genres = [...new Set(catalogArtists.map(artist => artist.genre))];
const initials = (name: string) => name.split(" ").slice(0, 2).map(word => [...word][0]).join("");
const genreDirectory = (artists: boolean) =>
  `<div class="catalog-filters" hidden>
  <label>Search <input type="search" placeholder="${artists ? "Artist name" : "Album or artist"}"></label>
  <label><span id="catalog-genre-label">Genre</span><select aria-labelledby="catalog-genre-label"><option value="">All genres</option>${genres.map(genre =>
    `<option value="${catalogSlug(genre)}">${escape(genre)}</option>`).join("")}</select></label></div>
  <p class="catalog-filter-status" role="status" hidden></p>` +
  `<nav class="catalog-genres" aria-label="Browse by genre">${genres.map(genre =>
    `<a href="#${catalogSlug(genre)}">${escape(genre)}</a>`).join("")}</nav>` +
  genres.map(genre => {
    const entries = artists
      ? catalogArtists.filter(artist => artist.genre === genre).sort((a, b) => a.name.localeCompare(b.name, "en")).map(artist =>
        `<li data-catalog-item><span class="catalog-artist-mark" aria-hidden="true">${escape(initials(artist.name))}</span><div class="catalog-card-info"><a class="catalog-release-title" href="${artist.path}">${escape(artist.name)}</a><p>${artist.albums.length} releases</p></div></li>`)
      : catalogAlbums.filter(entry => entry.artist.genre === genre).sort((a, b) => newestFirst(a.album, b.album)).map(({artist, album}) =>
        releaseCard(album, `${artist.name} · ${album.year}`));
    return `<section class="catalog-genre" data-catalog-genre="${catalogSlug(genre)}"><h2 id="${catalogSlug(genre)}">${escape(genre)}</h2><ul class="catalog-list catalog-cards">${entries.join("")}</ul></section>`;
  }).join("");

export function catalogDocument(path: string) {
  const artist = catalogArtists.find(a => a.path === path);
  const entry = catalogAlbums.find(a => a.album.path === path);
  let title: string, description: string, content: string, surface = "", albumId = "";
  if (artist) {
    title = `${artist.name} Album Quizzes | StanZer`;
    description = `Explore ${artist.name}'s curated ${artist.genre} releases and choose an exact edition to play in StanZer's music quiz.`;
    surface = "artist_page";
    content = breadcrumbs(artist.name, [{ label: "Artists", path: "/artists" }]) +
      `<div class="catalog-artist-hero"><span class="catalog-artist-mark" aria-hidden="true">${escape(initials(artist.name))}</span>${titleBlock(artist.genre, artist.name, `${artist.albums.length} curated releases`)}</div>` +
      `<h2>Albums, EPs &amp; other releases</h2>${releaseList([...artist.albums].sort(newestFirst), "artist_page")}<p><a class="catalog-secondary" href="${escape(discoveryPlayPath(artist.name, "artist_page"))}">Search for more releases</a></p>`;
  } else if (entry) {
    const { album, artist } = entry;
    title = `${album.title} by ${artist.name} | StanZer Album Quiz`;
    description = `Test your knowledge of ${album.title}, the ${album.year} release by ${artist.name}, in StanZer's Single Player music quiz.`;
    surface = "album_page"; albumId = album.id;
    const related = artist.albums.filter(a => a.id !== album.id).sort(newestFirst);
    content = breadcrumbs(album.title, [{ label: "Artists", path: "/artists" }, { label: artist.name, path: artist.path }]) +
      `<div class="catalog-album-hero">${covers(album)}${titleBlock(`${artist.genre} · ${album.year}`, album.title, artist.name,
      `<a class="catalog-button catalog-primary" href="${play(album, "album_page")}">Start Quiz</a> <a class="catalog-secondary" href="${artist.path}">Explore ${escape(artist.name)}</a>`)}</div>` +
      (related.length ? `<h2>More from ${escape(artist.name)}</h2>${releaseList(related, "album_page")}` : "");
  } else if (path === "/artists" || path === "/albums") {
    const artists = path === "/artists";
    title = `${artists ? "Explore Artists" : "Explore Albums"} | StanZer`;
    description = artists ? "Browse curated artists and find releases to play in StanZer's music quiz." :
      "Find a curated album and put your track knowledge to the test in StanZer.";
    content = titleBlock("StanZer discovery", artists ? "Explore Artists" : "Explore Albums",
      `${artists ? catalogArtists.length + " artists" : catalogAlbums.length + " curated releases"} · ${genres.length} genres`) + genreDirectory(artists);
  } else {
    title = "Catalog page not found | StanZer";
    description = "This artist or album is not in the StanZer curated catalog.";
    content = titleBlock("404", "Catalog page not found", description, '<a class="catalog-button" href="/artists">Explore Artists</a>');
  }
  const valid = catalogPaths.includes(path);
  return {
    status: valid ? 200 : 404,
    head: `<title>${escape(title)}</title><meta name="description" content="${escape(description)}">
    ${valid ? `<link rel="canonical" href="${catalogOrigin}${path}"><meta property="og:url" content="${catalogOrigin}${path}">` : '<meta name="robots" content="noindex">'}
    <meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
    <meta property="og:type" content="website"><meta property="og:site_name" content="StanZer"><meta property="og:image" content="${catalogOrigin}/catalog-social.png">
    <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="StanZer music quizzes">
    <meta name="twitter:card" content="summary_large_image">`,
    body: `<header class="catalog-nav"><div><a class="catalog-brand" href="/" aria-label="StanZer home"><img src="/stanzer-wordmark-dark.svg" alt="" width="128" height="43"></a><button type="button" class="catalog-menu" aria-label="Navigation menu" aria-expanded="false" aria-controls="catalog-links" hidden><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><nav id="catalog-links" aria-label="Primary navigation"><a href="/">Home</a><a href="/play">Single Player</a><a href="/leaderboard">Leaderboard</a><a href="/multiplayer">Multiplayer</a><a href="/artists"${path.startsWith("/artists") ? ' aria-current="page"' : ""}>Artists</a><a href="/albums"${path.startsWith("/albums") ? ' aria-current="page"' : ""}>Albums</a><button class="catalog-theme" type="button" hidden>Switch theme</button></nav></div></header>
    <main class="catalog-main" data-surface="${surface}" data-album-id="${albumId}">${content}</main>`,
  };
}

export const catalogSitemap = () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/play", "/multiplayer", ...catalogPaths].map(path => `<url><loc>${catalogOrigin}${path}</loc></url>`).join("")}</urlset>\n`;
export const catalogRobots = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /multiplayer/invite/\nDisallow: /challenge/\nSitemap: ${catalogOrigin}/sitemap.xml\n`;
