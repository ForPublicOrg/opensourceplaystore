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

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

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

const apps = fs.readdirSync(path.join(ROOT, 'data', 'apps'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'apps', f), 'utf8')));

const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
const liveOf = (app) => live.apps[app.id] || {};

/* Fail fast, loudly and clearly, on data that would corrupt the build:
   ids become file paths, categories are dereferenced everywhere. */
const SAFE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
for (const app of apps) {
  if (!SAFE_ID.test(app.id)) {
    throw new Error(`data/apps: app id "${app.id}" is not a safe slug (lowercase letters, numbers, dashes)`);
  }
  if (!catById[app.category]) {
    throw new Error(`data/apps/${app.id}.json: unknown category "${app.category}" — must be one of: ${categories.map((c) => c.id).join(', ')}`);
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
  if (app.icon) return app.icon;
  const l = liveOf(app);
  if (l.icon) return l.icon;
  const gh = githubSlug(app.repo);
  if (gh) return `https://github.com/${gh.split('/')[0]}.png?size=${size}`;
  return '/favicon.svg';
}

function screenshotsOf(app) {
  if (app.screenshots && app.screenshots.length) return app.screenshots;
  return liveOf(app).screenshots || [];
}

function fmtStars(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
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

/* Sort: most-starred first, apps without data last (alphabetical inside groups). */
const sortedApps = [...apps].sort((a, b) => {
  const sa = liveOf(a).stars ?? -1;
  const sb = liveOf(b).stars ?? -1;
  return sb - sa || a.name.localeCompare(b.name);
});

/* ---------------- page shell ---------------- */

const THEME_BOOT = `<script>(function(){var t;try{t=localStorage.getItem('osps-theme')}catch(e){}
if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
document.documentElement.setAttribute('data-theme',t);})();</script>`;

const THEME_TOGGLE = `<script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;
function cur(){return document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light'}
function draw(){b.textContent=cur()==='dark'?'☀️':'🌙';b.setAttribute('aria-label',cur()==='dark'?'Switch to light colors':'Switch to dark colors')}
b.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);
try{localStorage.setItem('osps-theme',n)}catch(e){}draw()});draw()})();</script>`;

const NAV_ITEMS = [
  { href: '/', emoji: '🏠', label: 'Home' },
  { href: '/?focus=search', emoji: '🔍', label: 'Search', tabOnly: true },
  { href: '/publish/', emoji: '📤', label: 'Publish' },
  { href: '/help/', emoji: '❓', label: 'Help' },
];

function page({ title, description, urlPath, active, content, scripts = [], bodyAttrs = '' }) {
  const fullTitle = urlPath === '/' ? `${config.siteName} — ${config.tagline}` : `${title} · ${config.siteName}`;
  const canonical = config.baseUrl + urlPath;
  const current = (href) => (href === '/' ? active === 'home' : active && href.includes(active))
    ? ' aria-current="page"' : '';

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
${THEME_BOOT}
<style>${CSS}</style>
</head>
<body${bodyAttrs}>
<header class="site-header">
  <div class="wrap">
    <a class="logo" href="/"><img src="/favicon.svg" alt="" width="34" height="34"> Open Source<br>Play Store</a>
    <nav class="top-nav" aria-label="Main">
      ${NAV_ITEMS.filter((n) => !n.tabOnly).map((n) =>
        `<a class="nav-link" href="${n.href}"${current(n.href)}><span aria-hidden="true">${n.emoji}</span> ${n.label}</a>`
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
    <p class="footmark">© 2026 ${esc(config.siteName)}${registryReady ? `&nbsp;·&nbsp;<a href="${esc(registryUrl)}" rel="noopener">Open source</a>` : ''}&nbsp;·&nbsp;<a class="athena-mark" href="https://tryathena.dev" rel="noopener"><img src="/athena.svg" alt="" width="18" height="18"> Built using Athena</a></p>
    <a href="/about/">How this site works</a>
    <a href="/help/">Help</a>
    <a href="/publish/">Publish an app</a>
    <span>We don’t host apps — downloads come from each app’s own page.</span>
  </div>
</footer>
<nav class="tab-bar" aria-label="Main">
  ${NAV_ITEMS.map((n) =>
    `<a href="${n.href}"${current(n.href)}><span class="tab-emoji" aria-hidden="true">${n.emoji}</span>${n.label}</a>`
  ).join('\n  ')}
</nav>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
${THEME_TOGGLE}
${scripts.map((s) => `<script src="${s}" defer></script>`).join('\n')}
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

function appCard(app, searchable = true) {
  const cat = catById[app.category];
  const searchText = [app.name, app.tagline, cat.name, ownerOf(app), ...(app.tags || [])]
    .join(' ').toLowerCase();
  const searchAttr = searchable ? ` data-search="${esc(searchText)}"` : '';
  return `<a class="card" style="--cat:${cat.hue}" href="/app/${app.id}/"${searchAttr}>
  <img class="card-icon" src="${esc(iconUrl(app, 128))}" alt="" width="72" height="72" loading="lazy" decoding="async">
  <span class="card-name">${esc(app.name)}</span>
  <span class="card-tagline">${esc(app.tagline)}</span>
  <span class="card-meta">${starsPillHtml(app, false)}<span class="cat-tag"><span aria-hidden="true">${cat.emoji}</span> ${esc(cat.name)}</span></span>
</a>`;
}

/* Horizontal strip of compact cards, hidden while searching. */
function cardStrip(emoji, title, appsList) {
  if (!appsList.length) return '';
  return `<section data-hide-on-search>
  <h2 class="section-title"><span aria-hidden="true">${emoji}</span> ${esc(title)}</h2>
  <div class="card-strip">
${appsList.map((a) => appCard(a, false)).join('\n')}
  </div>
</section>`;
}

/* "Trending": loved apps that shipped something recently —
   stars damped by how long ago the last release (or push) happened. */
function trendingScore(app) {
  const l = liveOf(app);
  if (typeof l.stars !== 'number') return -1;
  const lastActive = l.releaseDate || l.pushedAt;
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
  const all = `<a class="chip${activeId ? '' : ' active'}" href="/">✨ All apps</a>`;
  return `<div class="chips">
  ${all}
  ${categories.map((c) =>
    `<a class="chip chip-cat${activeId === c.id ? ' active' : ''}" style="--cat:${c.hue}" href="/category/${c.id}/"><span aria-hidden="true">${c.emoji}</span> ${esc(c.name)}</a>`
  ).join('\n  ')}
</div>`;
}

function grid(appList) {
  return `<div class="grid">
${appList.map((a) => appCard(a, true)).join('\n')}
</div>`;
}

const syncedLine = live.fetchedAt
  ? `<p class="center meta-line">App info comes from GitHub — updated ${timeAgo(live.fetchedAt)}.</p>`
  : '';

/* ---------------- home ---------------- */

function homePage() {
  const content = `
<section class="hero">
  <h1>Free apps made by people, for people 💚</h1>
  <p>Every app here is <strong>open source</strong> — anyone can look inside and see exactly how it’s made. No account. No ads from us. No tricks.</p>
  <div class="search-box">
    <span aria-hidden="true">🔍</span>
    <input id="search-input" type="search" placeholder="Search for an app…" aria-label="Search for an app" autocomplete="off">
    <button class="search-clear" type="button" aria-label="Clear search">✕</button>
  </div>
  <p class="meta-line" id="result-count" aria-live="polite"></p>
</section>
${categoryChips(null)}
${(() => {
    const popular = sortedApps.filter((a) => screenshotsOf(a).length > 0).slice(0, 6);
    if (!popular.length) return '';
    return `<section class="popular" data-hide-on-search>
  <h2 class="section-title"><span aria-hidden="true">🔥</span> Popular right now</h2>
  <div class="feature-strip">
${popular.map(featureCard).join('\n')}
  </div>
</section>`;
  })()}
${cardStrip('🚀', 'Trending', [...apps]
    .filter((a) => trendingScore(a) > 0)
    .sort((a, b) => trendingScore(b) - trendingScore(a))
    .slice(0, 8))}
${cardStrip('🆕', 'Recently added', [...apps]
    .sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')) || a.name.localeCompare(b.name))
    .slice(0, 8))}
<h2 class="section-title" data-hide-on-search><span aria-hidden="true">✨</span> All apps</h2>
${grid(sortedApps)}
<div class="empty-state" id="search-empty" hidden>
  <p class="big" aria-hidden="true">😢</p>
  <h2>No apps match</h2>
  <p class="muted">Try another word — or maybe you know an app we’re missing?</p>
  <a class="btn btn-primary" href="/publish/">📤 Add an app</a>
</div>
<section class="callout center">
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
    scripts: ['/js/search.js'],
  });
}

/* ---------------- category pages ---------------- */

function categoryPage(cat) {
  const list = sortedApps.filter((a) => a.category === cat.id);
  const body = list.length
    ? grid(list)
    : `<div class="empty-state">
  <p class="big" aria-hidden="true">${cat.emoji}</p>
  <h2>No apps here yet</h2>
  <p class="muted">Be the first! Do you make an app like this, or know one?</p>
  <a class="btn btn-primary" href="/publish/">📤 Add an app</a>
</div>`;
  const content = `
<section class="hero">
  <h1><span aria-hidden="true">${cat.emoji}</span> ${esc(cat.name)}</h1>
  <p>${esc(cat.blurb)} — ${list.length === 1 ? '1 app' : `${list.length} apps`}, all free and open source.</p>
</section>
${categoryChips(cat.id)}
${body}
${syncedLine}`;
  return page({
    title: cat.name,
    description: `Free, open-source ${cat.name} apps for Android.`,
    urlPath: `/category/${cat.id}/`,
    active: null,
    content,
  });
}

/* ---------------- app detail ---------------- */

const ANTI_LABELS = {
  ads: 'shows ads',
  tracking: 'may track how you use it',
  'nonfree-network': 'talks to services that aren’t open source',
  'nonfree-assets': 'contains art or files that aren’t open source',
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

  const antiHtml = (app.antiFeatures || []).length
    ? `<div class="callout warn"><strong>Heads up:</strong> the makers say this app ${app.antiFeatures.map((a) => esc(ANTI_LABELS[a] || a)).join(', and ')}.</div>`
    : '';

  const shots = screenshotsOf(app);
  const screenshotsHtml = shots.length
    ? `<h2>What it looks like</h2>
<div class="screenshots">
${shots.map((s, i) => `  <img src="${esc(s)}" alt="Screenshot ${i + 1} of ${esc(app.name)}" loading="lazy" decoding="async">`).join('\n')}
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

  const content = `
<p style="margin-top:18px"><a href="/">← All apps</a></p>
<section class="app-hero">
  <img class="app-hero-icon" src="${esc(iconUrl(app, 192))}" alt="" width="96" height="96" decoding="async">
  <div>
    <h1>${esc(app.name)}</h1>
    <p class="tagline">${esc(app.tagline)}</p>
    <div class="badge-row">
      ${starsPillHtml(app, true)}
      ${licensePill}
      <a class="pill" href="/category/${cat.id}/"><span aria-hidden="true">${cat.emoji}</span> ${esc(cat.name)}</a>
      ${archivedPill}
    </div>
  </div>
</section>
<p class="meta-line">Made by <a href="${esc(gh ? `https://github.com/${ownerName}` : app.repo)}" rel="noopener"><strong>${esc(ownerName)}</strong></a> · free &amp; open source ✅</p>
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
<p class="center meta-line">${updatedLine}</p>
${adminLinks}`;

  return page({
    title: app.name,
    description: `${app.name} — ${app.tagline}. Free and open source.`,
    urlPath: `/app/${app.id}/`,
    active: null,
    content,
    scripts: ['/js/app.js'],
    bodyAttrs: gh ? ` data-github="${esc(gh)}"` : '',
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
      <span class="card-meta"><span class="pill">🆕 New</span></span>
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
    We’ll check your app automatically — most apps appear within a day.
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

function sitemap() {
  const urls = [
    '/', '/publish/', '/help/', '/about/',
    ...categories.map((c) => `/category/${c.id}/`),
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

write('index.html', homePage());
for (const cat of categories) write(`category/${cat.id}/index.html`, categoryPage(cat));
for (const app of apps) write(`app/${app.id}/index.html`, appPage(app));
write('publish/index.html', publishPage());
write('help/index.html', helpPage());
write('about/index.html', aboutPage());
write('404.html', notFoundPage());
write('sitemap.xml', sitemap());
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
write('index.json', JSON.stringify(
  sortedApps.map((a) => ({ id: a.id, name: a.name, repo: a.repo })), null, 1
));

/* copy public/ as-is (css is also inlined, but keep the file for reference) */
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

const pageCount = 7 + categories.length + apps.length;
console.log(`Built ${pageCount} pages for ${apps.length} apps -> dist/`);
if (!registryReady) {
  console.log('note: registryRepo is still a placeholder in site.config.json — publish/report/edit links are limited');
}
