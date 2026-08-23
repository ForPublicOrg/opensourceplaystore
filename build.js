#!/usr/bin/env node
/*
 * Open Source Play Store — static site generator.
 * Zero dependencies: reads data/, writes dist/. Run: node build.js
 *
 * Every page is fully pre-rendered (works with JavaScript disabled).
 * CSS is inlined so first paint costs exactly one request.
 * GitHub data (stars, APK links) comes from data/live.json, produced by
 * scripts/sync.js — the browser never needs the GitHub API to browse.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rawImageUrl } = require('./scripts/lib/image-url');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

/* Script URLs carry a content hash (?v=abc123) so a browser's long-lived
   /js/* cache can never pair an old script with newer HTML — the URL
   changes whenever the file does. */
const assetHashes = new Map();
function versioned(urlPath) {
  if (!assetHashes.has(urlPath)) {
    const file = fs.readFileSync(path.join(ROOT, 'public', ...urlPath.split('/').filter(Boolean)));
    assetHashes.set(urlPath, crypto.createHash('sha256').update(file).digest('hex').slice(0, 8));
  }
  return `${urlPath}?v=${assetHashes.get(urlPath)}`;
}

/* ---------------- data ---------------- */

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'categories.json'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'site.css'), 'utf8');

const registryReady = !config.registryRepo.includes('YOUR_GITHUB_USERNAME');
const registryUrl = `https://github.com/${config.registryRepo}`;

let live = { fetchedAt: null, apps: {} };
try {
  live = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'live.json'), 'utf8'));
} catch {
  console.log('note: no data/live.json — building with fallback links (run scripts/sync.js for live data)');
}

const allApps = fs.readdirSync(path.join(ROOT, 'data', 'apps'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'apps', f), 'utf8')));

/* A repo whose owner deleted it (or went private) is flagged `missing` by
   scripts/sync.js. Every link on its page would be a 404 and its download
   button would go nowhere, so it is dropped from the build rather than
   shipped broken — the manifest stays in data/apps so the listing comes
   back by itself if the repo returns. */
const missingRepo = allApps.filter((a) => live.apps[a.id] && live.apps[a.id].missing);
const apps = allApps.filter((a) => !(live.apps[a.id] && live.apps[a.id].missing));
if (missingRepo.length) {
  console.log(`note: skipped ${missingRepo.length} listing(s) whose repo no longer exists: ${missingRepo.map((a) => a.id).join(', ')}`);
}

const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
const liveOf = (app) => live.apps[app.id] || {};

/* Fail fast, loudly and clearly, on data that would corrupt the build:
   ids become file paths, categories are dereferenced everywhere, and URL
   fields land in href attributes — the generator defends itself even if
   scripts/validate.js never ran (a javascript: URI must never reach a href). */
const SAFE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SAFE_URL = /^https:\/\//;
const REPO_URL = /^https:\/\/(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\/[^/\s]+\/[^/\s]+$/;
const seenIds = new Set();
for (const app of apps) {
  if (!SAFE_ID.test(app.id)) {
    throw new Error(`data/apps: app id "${app.id}" is not a safe slug (lowercase letters, numbers, dashes)`);
  }
  if (seenIds.has(app.id)) {
    throw new Error(`data/apps: duplicate app id "${app.id}" — two manifests would overwrite each other's page`);
  }
  seenIds.add(app.id);
  if (!catById[app.category]) {
    throw new Error(`data/apps/${app.id}.json: unknown category "${app.category}" — must be one of: ${categories.map((c) => c.id).join(', ')}`);
  }
  if (!REPO_URL.test(app.repo)) {
    throw new Error(`data/apps/${app.id}.json: repo must be an https URL on github.com, gitlab.com, codeberg.org or bitbucket.org`);
  }
  for (const field of ['website', 'download', 'icon']) {
    if (app[field] !== undefined && !SAFE_URL.test(app[field])) {
      throw new Error(`data/apps/${app.id}.json: ${field} must be an https:// URL`);
    }
  }
  for (const s of app.screenshots || []) {
    if (!SAFE_URL.test(s)) throw new Error(`data/apps/${app.id}.json: screenshots entries must be https:// URLs`);
  }
}
for (const cat of categories) {
  if (!SAFE_ID.test(cat.id)) throw new Error(`data/categories.json: unsafe category id "${cat.id}"`);
}

/* ---------------- helpers ---------------- */

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function githubSlug(repoUrl) {
  const m = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function ownerOf(app) {
  const l = liveOf(app);
  if (l.owner) return l.owner;
  const m = app.repo.match(/^https:\/\/[^/]+\/([^/]+)\//);
  return m ? m[1] : '';
}

function iconUrl(app, size) {
  if (app.icon) return rawImageUrl(app.icon);
  const l = liveOf(app);
  if (l.icon) return rawImageUrl(l.icon);
  const gh = githubSlug(app.repo);
  if (gh) return `https://github.com/${gh.split('/')[0]}.png?size=${size}`;
  return '/favicon.svg';
}

function screenshotsOf(app) {
  const shots = app.screenshots && app.screenshots.length
    ? app.screenshots
    : liveOf(app).screenshots || [];
  return shots.map(rawImageUrl);
}

function fmtStars(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}

/* App totals are shown as ever-growing "350+" style counts, never exact
   numbers that go stale the moment a listing merges. Tiny collections
   (<10) stay exact — "5+" would just look odd. */
function fmtCount(n) {
  if (n < 10) return String(n);
  const base = n < 100 ? Math.floor(n / 10) * 10 : Math.floor(n / 50) * 50;
  return `${base}+`;
}

function fmtSize(bytes) {
  return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1) + ' MB';
}

function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 90) return `${Math.round(m)} minutes ago`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)} hours ago`;
  const d = h / 24;
  if (d < 45) return `${Math.round(d)} days ago`;
  const mo = d / 30.4;
  if (mo < 18) return `${Math.round(mo)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}

/* "Last active" = the most recent sign of life, whichever it is. A repo can
   push code for years after its last tagged release (and, rarely, publish a
   release without a push showing), so taking releaseDate first would rank a
   still-active project by a date from several years ago. */
const lastActiveOf = (app) => {
  const l = liveOf(app);
  const dates = [l.releaseDate, l.pushedAt].filter(Boolean);
  return dates.length ? dates.sort().at(-1) : null;
};

/* "In testing": the maker says so in the manifest (status: "testing"), or the
   latest release is a GitHub prerelease / carries a prerelease-style tag. */
const PRERELEASE_RE = /(^|[^a-z])(alpha|beta|rc|pre|preview|dev|nightly|unstable|canary|snapshot|experimental)([^a-z]|$)/i;
function isTesting(app) {
  if (app.status === 'testing') return true;
  const l = liveOf(app);
  return l.prerelease === true || PRERELEASE_RE.test(l.releaseTag || '');
}

/* Virtual collection, browsable like a category at /testing/. */
const TESTING_CAT = {
  id: 'testing',
  name: 'In testing',
  emoji: '🧪',
  blurb: 'Early versions — help by trying them',
  hue: 55,
};

/* Catalog sort orders. Every order is pre-rendered as static pages, so
   sorting never needs JavaScript. ISO date strings compare lexicographically. */
const CMP = {
  top: (a, b) => (liveOf(b).stars ?? -1) - (liveOf(a).stars ?? -1) || a.name.localeCompare(b.name),
  new: (a, b) => String(b.added || '').localeCompare(String(a.added || '')) || CMP.top(a, b),
  fresh: (a, b) => String(liveOf(b).createdAt || '').localeCompare(String(liveOf(a).createdAt || '')) || CMP.top(a, b),
  updated: (a, b) => String(lastActiveOf(b) || '').localeCompare(String(lastActiveOf(a) || '')) || CMP.top(a, b),
  maker: (a, b) => ownerOf(a).localeCompare(ownerOf(b), 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name),
  az: (a, b) => a.name.localeCompare(b.name),
};

/* `note` explains the order in plain words — two of these tabs are about
   "new" in different senses, and the label alone can't carry that. */
const SORTS = [
  { id: 'top', emoji: '⭐', label: 'Top', note: 'Most GitHub stars first' },
  { id: 'new', emoji: '🆕', label: 'Just added', note: 'Newest listings on this site first' },
  { id: 'fresh', emoji: '🌱', label: 'Brand new', note: 'Youngest projects first — recently started' },
  { id: 'updated', emoji: '🔄', label: 'Updated', note: 'Worked on most recently first' },
  { id: 'maker', emoji: '👤', label: 'Maker', note: 'Grouped by who makes them, A–Z' },
  { id: 'az', emoji: '🔤', label: 'A–Z', note: 'By name, A to Z' },
];

const PER_PAGE = 24;

/* /apps/ · /apps/updated/2/ · /category/games/az/3/ · /testing/ */
function catalogUrl(catId, sortId, pageNum = 1) {
  const base = !catId ? '/apps/'
    : catId === TESTING_CAT.id ? '/testing/'
      : `/category/${catId}/`;
  return base + (sortId !== 'top' ? `${sortId}/` : '') + (pageNum > 1 ? `${pageNum}/` : '');
}

const sortedApps = [...apps].sort(CMP.top);

/* ---------------- page shell ---------------- */

const THEME_BOOT = `<script>(function(){var t;try{t=localStorage.getItem('osps-theme')}catch(e){}
if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
document.documentElement.setAttribute('data-theme',t);
try{if(localStorage.getItem('osps-banner')==='off')document.documentElement.setAttribute('data-banner','off')}catch(e){}})();</script>`;

/* Site-wide alert banner (keepandroidopen.org). Dismiss persists in localStorage;
   THEME_BOOT applies it before first paint so there is no flash. */
const BANNER = `<div class="site-banner" id="site-banner">
  <p><span aria-hidden="true">⚠️</span> Google is changing how Android installs apps — stores like this one are at risk. <a href="https://keepandroidopen.org/" rel="noopener">keepandroidopen.org</a></p>
  <button class="banner-close" id="banner-close" type="button" aria-label="Hide this message">✕</button>
</div>`;

const BANNER_JS = `<script>(function(){var b=document.getElementById('banner-close');if(!b)return;
b.addEventListener('click',function(){document.documentElement.setAttribute('data-banner','off');
try{localStorage.setItem('osps-banner','off')}catch(e){}
var n=document.querySelector('.site-header .logo');if(n)n.focus();});})();</script>`;

const THEME_TOGGLE = `<script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;
function cur(){return document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light'}
function draw(){b.textContent=cur()==='dark'?'☀️':'🌙';b.setAttribute('aria-label',cur()==='dark'?'Switch to light colors':'Switch to dark colors')}
b.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);
try{localStorage.setItem('osps-theme',n)}catch(e){}draw()});draw()})();</script>`;

/* Vercel Web Analytics. Served first-party from our own origin, cookieless,
   and no-op unless Analytics is enabled for the project in Vercel. Not run
   through versioned() — the path is provided by the platform, not public/. */
const ANALYTICS = '<script defer src="/_vercel/insights/script.js"></script>';

/* `key` is matched exactly against the page's `active` id — never derived
   from the href, so no substring surprises. The mobile Search tab shares the
   catalog's key on purpose: it opens /apps/, so it lights up there. */
const NAV_ITEMS = [
  { href: '/', emoji: '🏠', label: 'Home', key: 'home' },
  { href: '/apps/?focus=search', emoji: '🔍', label: 'Search', key: 'apps', tabOnly: true },
  { href: '/apps/', emoji: '📱', label: 'All apps', key: 'apps', navOnly: true },
  { href: '/publish/', emoji: '📤', label: 'Publish', key: 'publish' },
  { href: '/help/', emoji: '❓', label: 'Help', key: 'help' },
];

/* Compact search in the header for pages that have no search box of their own.
   /js/search.js fills the listbox as you type; Enter without a highlighted row
   falls back to the plain GET to /apps/?q=…, which applies the query there. */
const NAV_SEARCH = `<form class="nav-search" action="/apps/" role="search">
        <input type="search" name="q" placeholder="Search apps…" aria-label="Search apps" autocomplete="off"
               role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="nav-search-results">
        <div class="nav-results" id="nav-search-results" role="listbox" aria-label="Search results" hidden></div>
      </form>`;

function page({ title, description, urlPath, active, content, scripts = [], bodyAttrs = '', navSearch = true, head = '', image = '', analytics = false }) {
  const fullTitle = urlPath === '/' ? `${config.siteName} — ${config.tagline}` : `${title} · ${config.siteName}`;
  const canonical = config.baseUrl + urlPath;
  const current = (item) => (active && item.key === active ? ' aria-current="page"' : '');
  /* The header search needs the same script the hero box uses. Pages that
     already ship it (home, /apps/) render their own box instead. */
  const pageScripts = navSearch && scripts.indexOf('/js/search.js') === -1
    ? ['/js/search.js'].concat(scripts)
    : scripts;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#f6f8f6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1512" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
${image ? `<meta property="og:image" content="${esc(image)}">\n` : ''}${head ? head + '\n' : ''}${THEME_BOOT}
<noscript><style>.search-box,.nav-search{display:none}</style></noscript>
<style>${CSS}</style>
</head>
<body${bodyAttrs}>
${BANNER}
<header class="site-header">
  <div class="wrap">
    <a class="logo" href="/"><img src="/favicon.svg" alt="" width="34" height="34"> Open Source<br>Play Store</a>
    <nav class="top-nav" aria-label="Main">
      ${navSearch ? NAV_SEARCH : ''}
      ${NAV_ITEMS.filter((n) => !n.tabOnly).map((n) =>
        `<a class="nav-link" href="${n.href}"${current(n)}><span aria-hidden="true">${n.emoji}</span> ${n.label}</a>`
      ).join('\n      ')}
      <button class="theme-btn" id="theme-toggle" type="button" aria-label="Switch colors">🌙</button>
    </nav>
  </div>
</header>
<main class="wrap" id="main">
${content}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p class="footmark">© ${new Date().getFullYear()} ${esc(config.siteName)}${registryReady ? `&nbsp;·&nbsp;<a href="${esc(registryUrl)}" rel="noopener">Open source</a>` : ''}&nbsp;·&nbsp;<a class="athena-mark" href="https://tryathena.dev" rel="noopener"><img src="/athena.svg" alt="" width="18" height="18"> Built using Athena</a></p>
    <a href="/apps/">All apps</a>
    <a href="/about/">How this site works</a>
    <a href="/help/">Help</a>
    <a href="/publish/">Publish an app</a>
    <span>We don’t host apps — downloads come from each app’s own page.</span>
  </div>
</footer>
<nav class="tab-bar" aria-label="Quick tabs">
  ${NAV_ITEMS.filter((n) => !n.navOnly).map((n) =>
    `<a href="${n.href}"${current(n)}><span class="tab-emoji" aria-hidden="true">${n.emoji}</span>${n.label}</a>`
  ).join('\n  ')}
</nav>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
${THEME_TOGGLE}
${BANNER_JS}
${pageScripts.map((s) => `<script src="${versioned(s)}" defer></script>`).join('\n')}${analytics ? '\n' + ANALYTICS : ''}
</body>
</html>
`;
}

/* ---------------- components ---------------- */

function starsPillHtml(app, withId) {
  const l = liveOf(app);
  const id = withId ? ' id="stars-pill"' : '';
  if (typeof l.stars === 'number') {
    return `<span class="pill"${id}>⭐ ${fmtStars(l.stars)}${withId ? ' GitHub stars' : ''}</span>`;
  }
  return `<span class="pill"${id}>🆕 New${withId ? ' here' : ''}</span>`;
}

/* `maker: true` swaps the category tag for the maker's name — without it the
   maker sort just looks like a shuffled list. */
function appCard(app, opts = {}) {
  const cat = catById[app.category];
  const testing = isTesting(app) ? '<span class="pill warn">🧪 Testing</span>' : '';
  const tag = opts.maker
    ? `<span class="cat-tag"><span aria-hidden="true">👤</span> ${esc(ownerOf(app))}</span>`
    : `<span class="cat-tag"><span aria-hidden="true">${cat.emoji}</span> ${esc(cat.name)}</span>`;
  return `<a class="card" style="--cat:${cat.hue}" href="/app/${app.id}/">
  <img class="card-icon" src="${esc(iconUrl(app, 128))}" alt="" width="72" height="72" loading="lazy" decoding="async">
  <span class="card-name">${esc(app.name)}</span>
  <span class="card-tagline">${esc(app.tagline)}</span>
  <span class="card-meta">${starsPillHtml(app, false)}${testing}${tag}</span>
</a>`;
}

/* Section heading with an optional "See all" link on the right. */
function sectionHead(emoji, title, seeAllHref, seeAllLabel) {
  const link = seeAllHref
    ? `<a class="see-all" href="${seeAllHref}">${esc(seeAllLabel || 'See all')} →</a>` : '';
  return `<div class="section-head">
  <h2 class="section-title"><span aria-hidden="true">${emoji}</span> ${esc(title)}</h2>
  ${link}
</div>`;
}

/* Horizontal strip of compact cards, hidden while searching. */
function cardStrip(emoji, title, appsList, seeAllHref) {
  if (!appsList.length) return '';
  return `<section data-hide-on-search>
  ${sectionHead(emoji, title, seeAllHref)}
  <div class="card-strip">
${appsList.map((a) => appCard(a)).join('\n')}
  </div>
</section>`;
}

/* One tab per sort order — plain links to pre-rendered pages. */
function sortTabs(catId, activeId) {
  return `<nav class="sort-tabs" aria-label="Sort order">
  ${SORTS.map((s) =>
    `<a class="sort-tab" href="${catalogUrl(catId, s.id)}"${s.id === activeId ? ' aria-current="true"' : ''}><span aria-hidden="true">${s.emoji}</span> ${s.label}</a>`
  ).join('\n  ')}
</nav>`;
}

/* Numbered pagination: 1 2 … n-1 n n+1 … last, plus Previous/Next. */
function paginationNav(catId, sortId, cur, total) {
  if (total <= 1) return '';
  const url = (p) => catalogUrl(catId, sortId, p);
  const wanted = new Set([1, 2, cur - 1, cur, cur + 1, total - 1, total]);
  const parts = [];
  let prev = 0;
  for (let n = 1; n <= total; n++) {
    if (!wanted.has(n)) continue;
    if (n - prev > 1) parts.push('<span class="page-gap" aria-hidden="true">…</span>');
    parts.push(`<a class="page-link" href="${url(n)}"${n === cur ? ' aria-current="page"' : ''} aria-label="Page ${n}">${n}</a>`);
    prev = n;
  }
  return `<nav class="pagination" aria-label="More pages">
  ${cur > 1 ? `<a class="page-link page-step" rel="prev" href="${url(cur - 1)}">← Previous</a>` : ''}
  ${parts.join('\n  ')}
  ${cur < total ? `<a class="page-link page-step" rel="next" href="${url(cur + 1)}">Next →</a>` : ''}
</nav>`;
}

/* Search UI (hero variant) + the containers client-side results render into. */
function searchBox() {
  return `<div class="search-box" role="search" aria-label="Search apps">
    <span aria-hidden="true">🔍</span>
    <input id="search-input" type="search" placeholder="Search apps…" aria-label="Search for an app" autocomplete="off">
    <button class="search-clear" type="button" aria-label="Clear search">✕</button>
  </div>
  <p class="meta-line center" id="result-count" aria-live="polite"></p>`;
}

function searchResults() {
  return `<div class="grid" id="search-results" hidden></div>
<div class="empty-state" id="search-empty" hidden>
  <p class="big" aria-hidden="true">😢</p>
  <h2>No apps match</h2>
  <p class="muted">Try another word — or maybe you know an app we’re missing?</p>
  <a class="btn btn-primary" href="/publish/">📤 Add an app</a>
</div>`;
}

/* "Trending": loved apps that shipped something recently —
   stars damped by how long ago the last release (or push) happened. */
function trendingScore(app) {
  const l = liveOf(app);
  if (typeof l.stars !== 'number') return -1;
  const lastActive = lastActiveOf(app);
  if (!lastActive) return -1;
  const days = Math.max(0, (Date.now() - new Date(lastActive).getTime()) / 86400000);
  return Math.log10(l.stars + 1) / Math.sqrt(days + 2);
}

/* Big banner card with a real screenshot — used in the "Popular" strip. */
function featureCard(app) {
  const cat = catById[app.category];
  const shot = screenshotsOf(app)[0];
  return `<a class="feature-card" style="--cat:${cat.hue}" href="/app/${app.id}/">
  <img class="feature-shot" src="${esc(shot)}" alt="" loading="lazy" decoding="async">
  <span class="feature-body">
    <img class="feature-icon" src="${esc(iconUrl(app, 128))}" alt="" width="52" height="52" loading="lazy" decoding="async">
    <span>
      <span class="card-name">${esc(app.name)}</span>
      <span class="card-tagline">${esc(app.tagline)}</span>
    </span>
    ${starsPillHtml(app, false)}
  </span>
</a>`;
}

function categoryChips(activeId) {
  const cur = (isActive) => (isActive ? ' active" aria-current="page' : '');
  const all = `<a class="chip${cur(!activeId)}" href="/apps/">✨ All apps</a>`;
  const testing = `<a class="chip chip-cat${cur(activeId === TESTING_CAT.id)}" style="--cat:${TESTING_CAT.hue}" href="/testing/"><span aria-hidden="true">${TESTING_CAT.emoji}</span> ${esc(TESTING_CAT.name)}</a>`;
  return `<div class="chips">
  ${all}
  ${categories.map((c) =>
    `<a class="chip chip-cat${cur(activeId === c.id)}" style="--cat:${c.hue}" href="/category/${c.id}/"><span aria-hidden="true">${c.emoji}</span> ${esc(c.name)}</a>`
  ).join('\n  ')}
  ${testing}
</div>`;
}

function grid(appList, opts) {
  return `<div class="grid">
${appList.map((a) => appCard(a, opts)).join('\n')}
</div>`;
}

const syncedLine = live.fetchedAt
  ? `<p class="center meta-line">App info comes from GitHub — updated ${timeAgo(live.fetchedAt)}.</p>`
  : '';

/* ---------------- home ---------------- */

/* The catalog's founding import: hundreds of listings share the one date the
   site launched, so calling them "just added" weeks later says nothing about
   any of them. Only the OLDEST date can be that import — a later batch, however
   big, really was added later and belongs in the strip. */
const SEEDED_ON = (() => {
  const perDay = new Map();
  for (const a of apps) if (a.added) perDay.set(a.added, (perDay.get(a.added) || 0) + 1);
  if (!perDay.size) return new Set();
  const oldest = [...perDay.keys()].sort()[0];
  return perDay.get(oldest) > apps.length / 4 ? new Set([oldest]) : new Set();
})();

function homePage() {
  const popular = sortedApps.filter((a) => screenshotsOf(a).length > 0).slice(0, 8);
  const trending = [...apps]
    .filter((a) => trendingScore(a) > 0)
    .sort((a, b) => trendingScore(b) - trendingScore(a))
    .slice(0, 8);
  const trendIds = new Set(trending.map((a) => a.id));
  /* Hidden gems: solid but not famous (20–1500 stars), released in the last
     6 months, not already in Trending. Surfaces apps the star sort buries. */
  const HALF_YEAR = 183 * 86400000;
  const gems = [...apps]
    .filter((a) => {
      const stars = liveOf(a).stars;
      if (typeof stars !== 'number' || stars < 20 || stars >= 1500) return false;
      const act = lastActiveOf(a);
      return act && Date.now() - new Date(act).getTime() < HALF_YEAR && !trendIds.has(a.id);
    })
    .sort((a, b) => trendingScore(b) - trendingScore(a))
    .slice(0, 8);
  const shownIds = new Set([...trending, ...gems].map((a) => a.id));
  /* Just added: listings that went up on this site recently, however old the
     project behind them is. Every other strip ranks by the repo's own history,
     so a fresh listing of a long-running app had nowhere to appear. Empty
     strips render as nothing, so this disappears in a quiet month. */
  const TWO_MONTHS = 61 * 86400000;
  const justAdded = [...apps]
    .filter((a) => !shownIds.has(a.id) && a.added && !SEEDED_ON.has(a.added)
      && Date.now() - new Date(a.added).getTime() < TWO_MONTHS)
    .sort(CMP.new)
    .slice(0, 8);
  justAdded.forEach((a) => shownIds.add(a.id));
  /* Brand new: projects that only started in the last year and are already
     worth a look — the strip the "fresh" sort exists for. */
  const YEAR = 365 * 86400000;
  const QUARTER = 90 * 86400000;
  const brandNew = [...apps]
    .filter((a) => {
      const l = liveOf(a);
      if (shownIds.has(a.id) || !l.createdAt) return false;
      const age = Date.now() - new Date(l.createdAt).getTime();
      if (age >= YEAR) return false;
      /* A repo a few weeks old cannot have earned 20 stars yet, so the traction
         bar only applies once a project has had a quarter to earn them. */
      return age < QUARTER || (typeof l.stars === 'number' && l.stars >= 20);
    })
    .sort(CMP.fresh)
    .slice(0, 8);

  const content = `
<section class="hero">
  <h1>Free apps made by people, for people 💚</h1>
  <p>Every app here is <strong>open source</strong> — anyone can look inside and see exactly how it’s made. No account. No tricks.</p>
  ${searchBox()}
  <p class="meta-line center" data-hide-on-search>${fmtCount(apps.length)} apps in ${categories.length} categories · <a href="/apps/">browse them all</a></p>
</section>
${categoryChips(null)}
${popular.length ? `<section class="popular" data-hide-on-search>
  ${sectionHead('🔥', 'Popular right now', '/apps/')}
  <div class="feature-strip">
${popular.map(featureCard).join('\n')}
  </div>
</section>` : ''}
${cardStrip('🚀', 'Trending', trending, '/apps/updated/')}
${cardStrip('🆕', 'Just added', justAdded, '/apps/new/')}
${cardStrip('🌱', 'Brand new', brandNew, '/apps/fresh/')}
${cardStrip('💎', 'Hidden gems', gems)}
<section data-hide-on-search>
  ${sectionHead('⭐', 'Top apps', '/apps/', 'See all')}
  ${grid(sortedApps.slice(0, 12))}
  <p class="browse-all"><a class="btn btn-secondary" href="/apps/">Browse all apps →</a></p>
</section>
${searchResults()}
<section class="callout center" data-hide-on-search>
  <h2 style="margin-top:0">Made an app? Put it here! 📤</h2>
  <p>If your Android app is open source, listing it takes about 3 minutes. It’s free, forever.</p>
  <a class="btn btn-primary" href="/publish/">Publish your app</a>
</section>
${syncedLine}`;
  return page({
    title: config.siteName,
    description: 'Free, open-source Android apps. Download safely from each app’s own GitHub page. No account needed.',
    urlPath: '/',
    active: 'home',
    content,
    scripts: ['/js/search.js', '/js/strips.js'],
    navSearch: false,
    analytics: true,
  });
}

/* ---------------- catalog pages (/apps/ + /category/<id>/, sorted + paginated) ---------------- */

function catalogPage({ cat, sort, pageNum, pageApps, total, totalPages }) {
  const catId = cat ? cat.id : null;
  const isAll = !cat;
  const urlPath = catalogUrl(catId, sort.id, pageNum);
  const first = (pageNum - 1) * PER_PAGE + 1;
  const last = Math.min(total, pageNum * PER_PAGE);

  const heroTitle = isAll
    ? 'All apps'
    : `<span aria-hidden="true">${cat.emoji}</span> ${esc(cat.name)}`;
  const heroSub = isAll
    ? `${fmtCount(total)} free, open-source Android apps — and growing.`
    : `${esc(cat.blurb)} — ${total >= 10 ? `${fmtCount(total)} apps, ` : ''}all free and open source.`;

  const countText = (total <= PER_PAGE
    ? `${total === 1 ? '1 app' : `${fmtCount(total)} apps`}`
    : `Showing ${first}–${last}`) + ` · ${sort.note}`;

  const body = total === 0
    ? `<div class="empty-state">
  <p class="big" aria-hidden="true">${cat ? cat.emoji : '✨'}</p>
  <h2>No apps here yet</h2>
  <p class="muted">Be the first! Do you make an app like this, or know one?</p>
  <a class="btn btn-primary" href="/publish/">📤 Add an app</a>
</div>`
    : `<div data-hide-on-search>
  <div class="toolbar">
    ${sortTabs(catId, sort.id)}
    <p class="catalog-count">${countText}</p>
  </div>
  ${grid(pageApps, { maker: sort.id === 'maker' })}
  ${paginationNav(catId, sort.id, pageNum, totalPages)}
</div>`;

  const content = `
<section class="hero hero-compact">
  <h1>${heroTitle}</h1>
  <p>${heroSub}</p>
  ${isAll ? searchBox() : ''}
</section>
${categoryChips(catId)}
${body}
${isAll ? searchResults() : ''}
${syncedLine}`;

  const sortSuffix = {
    top: '',
    new: ' — newest listings',
    fresh: ' — newest projects',
    updated: ' — recently updated',
    maker: ' — by maker',
    az: ' — A to Z',
  }[sort.id];
  const pageSuffix = pageNum > 1 ? ` — page ${pageNum}` : '';
  let head = '';
  if (pageNum > 1) head += `<link rel="prev" href="${catalogUrl(catId, sort.id, pageNum - 1)}">`;
  if (pageNum < totalPages) head += `<link rel="next" href="${catalogUrl(catId, sort.id, pageNum + 1)}">`;
  /* Re-sorted listings are near-duplicates of the default order — keep them
     usable and crawlable but out of the index (standard faceted-nav handling). */
  if (sort.id !== 'top') head += '<meta name="robots" content="noindex,follow">';

  const baseDesc = isAll
    ? `Browse ${fmtCount(total)} free, open-source Android apps — sorted, searchable, no account needed.`
    : cat.id === TESTING_CAT.id
      ? 'Early open-source Android apps still in testing — try them and tell the makers what you find.'
      : `Free, open-source ${cat.name} apps for Android.`;

  return page({
    title: (isAll ? 'All apps' : cat.name) + sortSuffix + pageSuffix,
    description: baseDesc + (sortSuffix ? ` Sorted${sortSuffix.replace(' — ', ': ')}.` : '') + (pageNum > 1 ? ` Page ${pageNum} of ${totalPages}.` : ''),
    urlPath,
    active: isAll ? 'apps' : null,
    content,
    scripts: isAll ? ['/js/search.js', '/js/strips.js'] : ['/js/strips.js'],
    navSearch: !isAll,
    head,
  });
}

/* ---------------- app detail ---------------- */

const ANTI_LABELS = {
  ads: 'shows ads',
  tracking: 'may track how you use it',
  'nonfree-network': 'talks to services that aren’t open source',
  'nonfree-assets': 'contains art or files that aren’t open source',
};

/* "More like this": same category counts a lot, shared tags count more,
   a small star bonus breaks ties toward better-known apps. */
function similarApps(app) {
  const tags = new Set(app.tags || []);
  return sortedApps
    .map((other) => {
      if (other.id === app.id) return null;
      let score = other.category === app.category ? 2 : 0;
      for (const t of other.tags || []) if (tags.has(t)) score += 1.5;
      if (score === 0) return null;
      score += Math.log10((liveOf(other).stars ?? 0) + 1) / 4;
      return { other, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.other);
}

/* Rough mapping of our categories onto schema.org application categories. */
const LD_CATEGORY = {
  games: 'GameApplication',
  media: 'MultimediaApplication',
  social: 'SocialNetworkingApplication',
  tools: 'UtilitiesApplication',
  security: 'SecurityApplication',
  internet: 'CommunicationApplication',
  education: 'EducationalApplication',
  productivity: 'BusinessApplication',
  maps: 'TravelApplication',
  reading: 'ReferenceApplication',
};

function appPage(app) {
  const l = liveOf(app);
  const cat = catById[app.category];
  const gh = githubSlug(app.repo);
  const releasesUrl = gh ? `${app.repo}/releases` : app.repo;

  /* Download chain: baked APK -> manifest download url -> releases page. */
  let dlHref;
  let dlLabel;
  let dlKind;
  let dlSub = '';
  let dlNote = `This comes straight from ${esc(app.name)}’s own GitHub page — it’s free.`;
  if (l.apk) {
    dlHref = l.apk.url;
    dlLabel = '⬇️ Download the app (APK)';
    dlKind = 'apk';
    const fromFdroid = l.apk.source === 'fdroid';
    const bits = [
      l.releaseTag ? `Version ${esc(l.releaseTag)}` : null,
      l.apk.size ? fmtSize(l.apk.size) : null,
      l.releaseDate ? `updated ${timeAgo(l.releaseDate)}` : null,
      fromFdroid ? 'via F-Droid 💚' : null,
    ].filter(Boolean);
    dlSub = `<p class="center meta-line">${bits.join(' · ')}</p>`;
    if (fromFdroid) {
      dlNote = 'This download comes from F-Droid, a trusted library of free open-source apps.';
    }
  } else if (app.download) {
    dlHref = app.download;
    dlLabel = '⬇️ Get the app';
    dlKind = 'fallback';
    dlSub = '<p class="center meta-line">Opens the app’s own download page</p>';
  } else {
    dlHref = releasesUrl;
    dlLabel = '🔗 Get it from the app’s GitHub page';
    dlKind = 'fallback';
    dlSub = '<p class="center meta-line">Look for the file ending in <strong>.apk</strong></p>';
  }

  const licensePill = `<span class="pill">📜 ${esc(l.license || app.license)}</span>`;
  const archivedPill = l.archived
    ? '<span class="pill warn">💤 No longer updated</span>' : '';
  const testingPill = isTesting(app)
    ? '<a class="pill warn" href="/testing/">🧪 In testing</a>' : '';

  const antiHtml = (app.antiFeatures || []).length
    ? `<div class="callout warn"><strong>Heads up:</strong> the makers say this app ${app.antiFeatures.map((a) => esc(ANTI_LABELS[a] || a)).join(', and ')}.</div>`
    : '';

  const testingHtml = isTesting(app)
    ? '<div class="callout warn"><strong>🧪 Early version:</strong> this app is still being built and tested. Things may change or break — trying it and telling the makers what you find is a big help.</div>'
    : '';

  /* Each screenshot stays a real link to the image: with JavaScript off,
     tapping one opens it full size and Back returns here. lightbox.js
     intercepts the click and enlarges it in place instead. */
  const shots = screenshotsOf(app);
  const screenshotsHtml = shots.length
    ? `<h2>What it looks like</h2>
<div class="screenshots" data-lightbox="${esc(app.name)}">
${shots.map((s, i) => `  <a class="shot-link" href="${esc(s)}" aria-label="Picture ${i + 1} of ${shots.length} — see it bigger"><img src="${esc(s)}" alt="" loading="lazy" decoding="async"></a>`).join('\n')}
</div>` : '';

  const descHtml = app.description.split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim()).replaceAll('\n', '<br>')}</p>`).join('\n');

  const discussionsUrl = l.hasDiscussions ? `${app.repo}/discussions` : `${app.repo}/issues`;
  const licenseUrl = gh ? `${app.repo}?tab=License-1-ov-file` : app.repo;

  const links = [
    ['📄', 'See the code', 'How it’s made — every line is public', app.repo],
    ['💬', 'Questions & comments', 'Talk with the people who make it', discussionsUrl],
    ['🐛', 'Report a problem', 'Tell the makers something is broken', `${app.repo}/issues`],
    ['🕘', 'All versions', 'Older downloads and what changed', releasesUrl],
    ['📜', 'License', 'The rules for using and sharing it', licenseUrl],
  ];
  if (app.website) links.splice(1, 0, ['🌐', 'Website', 'The app’s own home page', app.website]);

  const ownerName = ownerOf(app);
  const updatedLine = [
    l.pushedAt ? `Last worked on ${timeAgo(l.pushedAt)}` : null,
    app.added ? `Listed here since ${app.added.slice(0, 4)}` : null,
    l.syncedAt ? `info updated ${timeAgo(l.syncedAt)}` : null,
  ].filter(Boolean).join(' · ');

  const adminLinks = registryReady ? `<p class="center meta-line">
  <a href="https://github.com/${config.registryRepo}/edit/${config.registryBranch}/data/apps/${app.id}.json" rel="noopener">✏️ Suggest an edit</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/${config.registryRepo}/issues/new?title=${encodeURIComponent(`Report listing: ${app.name} (${app.id})`)}&body=${encodeURIComponent('What is wrong with this listing?\n\n')}" rel="noopener">🚩 Report this listing</a>
</p>` : '';

  const similar = similarApps(app);
  const similarHtml = similar.length
    ? `<section>
  ${sectionHead('🧭', 'More like this', `/category/${cat.id}/`, `All ${esc(cat.name)}`)}
  ${grid(similar)}
</section>` : '';

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: app.name,
    description: app.tagline,
    url: `${config.baseUrl}/app/${app.id}/`,
    image: iconUrl(app, 192),
    operatingSystem: 'Android',
    applicationCategory: LD_CATEGORY[app.category] || 'MobileApplication',
    license: l.license || app.license,
    /* downloadUrl means a downloadable file — only claim it when we
       actually have a direct APK, not a releases/download HTML page. */
    ...(l.apk ? { downloadUrl: l.apk.url } : {}),
    sameAs: app.repo,
    isAccessibleForFree: true,
  };
  const ldScript = `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;

  const content = `
<p style="margin-top:14px"><a class="back-link" href="/apps/">← All apps</a></p>
<section class="app-hero">
  <img class="app-hero-icon" src="${esc(iconUrl(app, 192))}" alt="" width="96" height="96" decoding="async">
  <div>
    <h1>${esc(app.name)}</h1>
    <p class="tagline">${esc(app.tagline)}</p>
    <div class="badge-row">
      ${starsPillHtml(app, true)}
      ${licensePill}
      <a class="pill" href="/category/${cat.id}/"><span aria-hidden="true">${cat.emoji}</span> ${esc(cat.name)}</a>
      ${testingPill}
      ${archivedPill}
    </div>
  </div>
</section>
<p class="meta-line">Made by <a href="${esc(gh ? `https://github.com/${ownerName}` : app.repo)}" rel="noopener"><strong>${esc(ownerName)}</strong></a> · free &amp; open source ✅</p>
${testingHtml}
${antiHtml}
<div class="download-box">
  <div class="download-actions">
    <a class="btn btn-primary" id="download-btn" data-kind="${dlKind}" href="${esc(dlHref)}" rel="noopener">${dlLabel}</a>
    <button class="btn btn-secondary" id="share-btn" type="button" data-share-text="${esc(`${app.name} — ${app.tagline}`)}" hidden>📤 Share</button>
  </div>
  ${dlSub}
  <p class="download-note">${dlNote}
  <a href="/help/">Need help installing? →</a></p>
</div>
${screenshotsHtml}
<h2>About this app</h2>
${descHtml}
<h2>From the app’s home page</h2>
<ul class="links-list">
${links.map(([emoji, label, sub, href]) =>
    `  <li><a href="${esc(href)}" rel="noopener"><span class="link-emoji" aria-hidden="true">${emoji}</span><span>${label}<span class="link-sub">${sub}</span></span></a></li>`
  ).join('\n')}
</ul>
${similarHtml}
<p class="center meta-line">${updatedLine}</p>
${adminLinks}`;

  return page({
    title: app.name,
    description: `${app.name} — ${app.tagline}. Free and open source.`,
    urlPath: `/app/${app.id}/`,
    active: null,
    content,
    scripts: shots.length
      ? ['/js/app.js', '/js/strips.js', '/js/lightbox.js']
      : ['/js/app.js', '/js/strips.js'],
    bodyAttrs: gh ? ` data-github="${esc(gh)}"` : '',
    head: ldScript,
    image: iconUrl(app, 192),
  });
}

/* ---------------- publish ---------------- */

function publishPage() {
  const antiBoxes = Object.entries(ANTI_LABELS).map(([value, label]) =>
    `<label class="check-row"><input type="checkbox" name="antifeature" value="${value}"> It ${label}</label>`
  ).join('\n      ');

  const registryNote = registryReady ? '' : `
<div class="callout warn"><strong>🔧 A note for the person building this site:</strong> one-click publishing isn’t connected yet. Open <code>site.config.json</code> and set <code>registryRepo</code> to your GitHub repo. Until then, this form gives everyone copy-paste instructions instead.</div>`;

  const content = `
<section class="hero">
  <h1>Add your app 📤</h1>
  <p>Takes about 3 minutes. Free forever. You just need your app’s code on <strong>GitHub</strong> (public) and a free GitHub account.</p>
</section>
${registryNote}
<form id="publish-form" class="form-card" data-registry="${esc(config.registryRepo)}" data-branch="${esc(config.registryBranch)}" onsubmit="return false">
  <div class="form-field">
    <label for="f-repo">1. Where does your app’s code live?</label>
    <input type="url" id="f-repo" placeholder="https://github.com/you/your-app" autocomplete="off" aria-describedby="f-repo-error">
    <p class="field-error" id="f-repo-error" hidden></p>
    <p class="hint">Paste the link, then let us do the typing:</p>
    <button class="btn btn-secondary" id="fetch-btn" type="button">✨ Fill it in for me</button>
  </div>
  <div class="callout" id="checklist-box" hidden>
    <strong>Quick check:</strong>
    <ul class="checklist" id="checklist"></ul>
    <p class="hint">⚠ marks are okay — your app can still be listed.</p>
  </div>
  <div class="form-field">
    <label for="f-name">2. What’s it called?</label>
    <input type="text" id="f-name" maxlength="50" autocomplete="off" aria-describedby="f-name-error">
    <p class="field-error" id="f-name-error" hidden></p>
  </div>
  <div class="form-field">
    <label for="f-tagline">3. Say what it does — in one line</label>
    <input type="text" id="f-tagline" maxlength="80" placeholder="e.g. Watch videos without ads" aria-describedby="f-tagline-error">
    <p class="field-error" id="f-tagline-error" hidden></p>
  </div>
  <div class="form-field">
    <label for="f-description">4. Tell people more about it</label>
    <textarea id="f-description" maxlength="4000" aria-describedby="f-description-error"></textarea>
    <p class="field-error" id="f-description-error" hidden></p>
  </div>
  <div class="form-field">
    <label>5. Which group fits best?</label>
    <div class="cat-picker" id="f-category" role="radiogroup" aria-label="Category" aria-describedby="f-category-error">
      ${categories.map((c) =>
        `<label><input type="radio" name="category" value="${c.id}"><span aria-hidden="true">${c.emoji}</span> ${esc(c.name)}</label>`
      ).join('\n      ')}
    </div>
    <p class="field-error" id="f-category-error" hidden></p>
  </div>
  <div class="form-field">
    <label>6. Is it ready for everyone?</label>
    <label class="check-row"><input type="checkbox" id="f-testing"> 🧪 Not yet — it’s an early version, still in testing</label>
    <p class="hint">We’ll show a small “In testing” badge so people know what to expect. Easy to remove later.</p>
  </div>
  <details class="faq">
    <summary>Extras (icon, pictures, website…) — all optional</summary>
    <div class="form-field">
      <label for="f-icon">Icon link</label>
      <input type="url" id="f-icon" placeholder="https://… (a square picture)" aria-describedby="f-icon-error">
      <p class="field-error" id="f-icon-error" hidden></p>
      <p class="hint">Leave empty and we’ll use your GitHub picture.</p>
    </div>
    <div class="form-field">
      <label for="f-screenshots">Screenshot links — one per line</label>
      <textarea id="f-screenshots" placeholder="https://…&#10;https://…"></textarea>
    </div>
    <div class="form-field">
      <label for="f-website">Website</label>
      <input type="url" id="f-website" placeholder="https://…" aria-describedby="f-website-error">
      <p class="field-error" id="f-website-error" hidden></p>
    </div>
    <div class="form-field">
      <label for="f-download">Download page (if your APK isn’t in GitHub releases)</label>
      <input type="url" id="f-download" placeholder="https://…" aria-describedby="f-download-error">
      <p class="field-error" id="f-download-error" hidden></p>
    </div>
    <div class="form-field">
      <label for="f-tags">Search words, separated by commas</label>
      <input type="text" id="f-tags" placeholder="e.g. music, player, offline">
    </div>
    <div class="form-field">
      <label>Be honest — does your app have any of these?</label>
      ${antiBoxes}
      <p class="hint">Saying so builds trust. Most apps here have none.</p>
    </div>
  </details>
  <h2>How it will look</h2>
  <div class="grid" style="max-width:260px;padding-bottom:8px">
    <span class="card" id="preview-card">
      <img class="card-icon" src="/favicon.svg" data-fallback="/favicon.svg" alt="" width="64" height="64">
      <span class="card-name">Your app</span>
      <span class="card-tagline">One line about what it does</span>
      <span class="card-meta"><span class="pill">🆕 New</span><span class="pill warn" id="preview-testing" hidden>🧪 Testing</span></span>
    </span>
  </div>
  <div class="callout">
    <strong>What happens next?</strong> A page on <strong>GitHub.com</strong> opens with your app’s info already filled in.
    Just press GitHub’s green <em>“Propose new file”</em> button — that asks us to add your app.
    A robot checks it, and your app goes live. ✅
  </div>
  <button class="btn btn-primary btn-block" id="publish-btn" type="button">🚀 Publish on GitHub</button>
  <p class="center" style="margin-top:10px"><button class="btn btn-secondary" id="copy-btn" type="button">📋 Copy the app info instead</button></p>
  <div class="callout" id="after-publish" hidden>
    🎉 <strong>Almost done!</strong> Finish on the GitHub tab that just opened: press the green button there.
    A robot checks your app and adds it — that usually takes a few minutes.
  </div>
  <div id="copy-fallback" hidden>
    <div class="form-field" style="margin-top:14px">
      <label for="manifest-out">Your app’s info file</label>
      <textarea id="manifest-out" readonly rows="10"></textarea>
      <p class="hint">Save this as <code>data/apps/&lt;your-app-id&gt;.json</code> in the site’s GitHub repo and open a pull request.</p>
    </div>
  </div>
</form>
<noscript><div class="callout warn">This form needs JavaScript. You can still add your app: create a file under <code>data/apps/</code> in the site’s GitHub repo${registryReady ? ` — <a href="${esc(registryUrl)}" rel="noopener">open it here</a>` : ''}.</div></noscript>`;

  return page({
    title: 'Publish your app',
    description: 'List your open-source Android app in about 3 minutes. No account on this site — just your GitHub login.',
    urlPath: '/publish/',
    active: 'publish',
    content,
    scripts: ['/js/publish.js'],
  });
}

/* ---------------- help ---------------- */

function helpPage() {
  const content = `
<section class="hero">
  <h1>Help ❓</h1>
  <p>Everything you need to know, in plain words.</p>
</section>
<h2>How to install an app</h2>
<ol class="steps">
  <li><h3>Tap the big green Download button</h3><p>Your phone downloads a file ending in <strong>.apk</strong> — that file <em>is</em> the app.</p></li>
  <li><h3>Open the downloaded file</h3><p>Pull down from the top of the screen and tap the download. (Or find it in your <strong>Files</strong> app.)</p></li>
  <li><h3>Say yes to your phone’s question</h3><p>Your phone shows a caution message — <strong>that’s normal</strong> ✅. It appears for every app that doesn’t come from the Play Store. Tap <em>Settings</em>, turn on <em>“Allow from this source”</em>, then press back.</p></li>
  <li><h3>Tap Install</h3><p>🎉 All done! Open your new app from the home screen.</p></li>
</ol>
<div class="callout warn"><strong>Stay safe:</strong> only install apps from places you trust. Every app on this site shows its full source code — anyone in the world can check there’s nothing hidden. If something looks wrong, use the “Report” link on the app’s page.</div>
<h2>Questions people ask</h2>
<details class="faq"><summary>What’s an APK?</summary><p>It’s the file format Android apps come in — like <code>.exe</code> on Windows. When you download an APK and open it, your phone installs the app.</p></details>
<details class="faq"><summary>Is this safe?</summary><p>Every app here is <strong>open source</strong>: its full recipe (the code) is public. That means experts everywhere can check what it really does — the opposite of hidden. Downloads come straight from each app’s own GitHub page, not from us. Still, only install what you trust, and ask a grown-up if you’re not sure.</p></details>
<details class="faq"><summary>Why is everything free?</summary><p>These apps are made by people who share their work for everyone. Some accept donations — you’ll find that on their pages — but nothing here costs money.</p></details>
<details class="faq"><summary>What does the 🧪 “In testing” badge mean?</summary><p>The app’s makers are still building it. You can try it early and tell them what you find — that really helps them — but expect a few rough edges. Everything in testing lives on <a href="/testing/">one page</a>.</p></details>
<details class="faq"><summary>Where do the stars and comments come from?</summary><p>Straight from GitHub, the site where the apps are built. ⭐ stars show how many people bookmarked an app there. “Questions &amp; comments” takes you to the app’s own community.</p></details>
<details class="faq"><summary>The download button showed a page full of files — which one do I pick?</summary><p>Look for a file ending in <strong>.apk</strong>. If there are several, the one with <strong>arm64</strong> (or <strong>universal</strong>) in its name works on most phones.</p></details>
<details class="faq"><summary>I make an app — how do I put it here?</summary><p>Wonderful! <a href="/publish/">Go to the Publish page</a> — it takes about 3 minutes.</p></details>
<p><a href="/about/">Curious how this site works? →</a></p>`;

  return page({
    title: 'Help',
    description: 'How to install an APK on Android, step by step — plus answers to common questions.',
    urlPath: '/help/',
    active: 'help',
    content,
  });
}

/* ---------------- about ---------------- */

function aboutPage() {
  const content = `
<section class="hero">
  <h1>How this site works 💚</h1>
  <p>A free, open store for open-source Android apps — with no accounts and no servers.</p>
</section>
<h2>The whole trick, in three sentences</h2>
<p>1. Every app listing is a tiny public file in ${registryReady ? `<a href="${esc(registryUrl)}" rel="noopener">a GitHub repository</a>` : 'a GitHub repository'} — anyone can propose one, and a robot checks it.</p>
<p>2. Downloads come <strong>straight from each app’s own releases</strong> — we never host or change the files.</p>
<p>3. Stars and comments are the app’s real GitHub stars and discussions — we don’t invent our own.</p>
<h2>For grown-ups and developers</h2>
<p>This site is a <em>listing</em>, not an app store with review teams. We check automatically that a listed project exists, is public, and declares an open-source license — but <strong>we don’t audit code and we don’t scan APKs</strong>. The honest trust signal is the one open source has always had: the code is public, the community is public, and the download comes from the project itself.</p>
<p>Found something that shouldn’t be here? Every app page has a <strong>🚩 Report</strong> link — reports are public GitHub issues and removals are fast.</p>
<p>Want to list your app? It’s a 3-minute form: <a href="/publish/">Publish</a>. Updating a listing is a normal pull request.</p>
<h2>Fast by design</h2>
<p>The whole site is static files — no database, no tracking scripts, nothing between you and the apps. Pages are tiny and work even with JavaScript switched off.</p>`;

  return page({
    title: 'About',
    description: 'How the Open Source Play Store works: static site, GitHub-backed listings, downloads straight from each project.',
    urlPath: '/about/',
    active: 'help',
    content,
  });
}

/* ---------------- 404 ---------------- */

function notFoundPage() {
  const content = `
<div class="empty-state">
  <p class="big" aria-hidden="true">🕵️</p>
  <h1>We looked everywhere…</h1>
  <p class="muted">…but this page isn’t here. Maybe the app moved, or the link has a typo.</p>
  <p><a class="btn btn-primary" href="/">🏠 Back to all apps</a></p>
</div>`;
  return page({
    title: 'Page not found',
    description: 'This page does not exist.',
    urlPath: '/404.html',
    active: null,
    content,
  });
}

/* ---------------- sitemap, robots, index ---------------- */

function sitemap(catalogRoutes) {
  const urls = [
    '/', '/publish/', '/help/', '/about/',
    ...catalogRoutes,
    ...apps.map((a) => `/app/${a.id}/`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${config.baseUrl}${u}</loc></url>`).join('\n')}
</urlset>
`;
}

/* ---------------- write everything ---------------- */

function write(rel, content) {
  const file = path.join(DIST, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let pageCount = 0;

write('index.html', homePage());
pageCount++;

/* Catalog: /apps/ and every category, in every sort order, paginated. */
const catalogRoutes = [];
const catalogTargets = [
  { cat: null, list: apps },
  ...categories.map((cat) => ({ cat, list: apps.filter((a) => a.category === cat.id) })),
  { cat: TESTING_CAT, list: apps.filter(isTesting) },
];
for (const { cat, list } of catalogTargets) {
  for (const sort of SORTS) {
    const sorted = [...list].sort(CMP[sort.id]);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const urlPath = catalogUrl(cat && cat.id, sort.id, pageNum);
      /* Sitemap lists only the indexable default sort; re-sorts are noindex. */
      if (sort.id === 'top') catalogRoutes.push(urlPath);
      write(`${urlPath.slice(1)}index.html`, catalogPage({
        cat, sort, pageNum,
        pageApps: sorted.slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE),
        total: sorted.length,
        totalPages,
      }));
      pageCount++;
    }
  }
}

for (const app of apps) { write(`app/${app.id}/index.html`, appPage(app)); pageCount++; }
write('publish/index.html', publishPage());
write('help/index.html', helpPage());
write('about/index.html', aboutPage());
write('404.html', notFoundPage());
pageCount += 4;
write('sitemap.xml', sitemap(catalogRoutes));
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
write('index.json', JSON.stringify(
  sortedApps.map((a) => ({ id: a.id, name: a.name, repo: a.repo })), null, 1
));

/* Compact search index fetched on demand by /js/search.js (first keystroke). */
const searchIndex = {
  cats: Object.fromEntries(categories.map((c) => [c.id, { n: c.name, e: c.emoji, h: c.hue }])),
  apps: sortedApps.map((a) => ({
    id: a.id,
    n: a.name,
    t: a.tagline,
    c: a.category,
    s: liveOf(a).stars ?? null,
    i: iconUrl(a, 128),
    g: (a.tags || []).join(' ') + (isTesting(a) ? ' testing beta early' : ''),
    o: ownerOf(a),
    ...(isTesting(a) ? { x: 1 } : {}),
  })),
};
write('search-index.json', JSON.stringify(searchIndex));

/* copy public/ as-is (css is also inlined, but keep the file for reference) */
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

console.log(`Built ${pageCount} pages for ${apps.length} apps -> dist/`);
console.log(`search-index.json: ${(JSON.stringify(searchIndex).length / 1024).toFixed(1)} KB`);
if (!registryReady) {
  console.log('note: registryRepo is still a placeholder in site.config.json — publish/report/edit links are limited');
}
