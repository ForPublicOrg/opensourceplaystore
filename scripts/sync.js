#!/usr/bin/env node
/*
 * Fetches live GitHub data (stars, latest release, APK asset, discussions flag)
 * for every app in data/apps/ and writes the snapshot to data/live.json.
 *
 * The build bakes this snapshot into the static HTML, so visitors never need
 * to call the GitHub API just to browse or download. Run it on a schedule
 * (see .github/workflows/sync.yml) or manually before a local build.
 *
 * Zero dependencies. Authenticated when GITHUB_TOKEN is set (5000 req/h),
 * anonymous otherwise (60 req/h — fine for small catalogs).
 *
 * Tolerant by design: on any per-app failure the previous snapshot entry is
 * kept, so a rate-limited or offline run never erases good data.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'data', 'apps');
const LIVE_FILE = path.join(ROOT, 'data', 'live.json');

/* How many apps are fetched at once. Authenticated runs have 5,000 req/h to
   spend; anonymous ones only 60, so they go one at a time and simply cover
   fewer apps before the previous snapshot takes over. */
const CONCURRENCY = process.env.GITHUB_TOKEN ? 6 : 1;

const HEADERS = {
  'User-Agent': 'opensourceplaystore-sync',
  Accept: 'application/vnd.github+json',
};
if (process.env.GITHUB_TOKEN) HEADERS.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

/* Pick the APK most phones want: universal builds first, then arm64, else the first one. */
function pickApk(apks) {
  if (apks.length === 0) return null;
  const score = (a) => {
    const n = a.name.toLowerCase();
    if (n.includes('universal') || n.includes('-all') || n.includes('_all')) return 0;
    if (n.includes('arm64') || n.includes('v8a')) return 1;
    if (n.includes('armeabi') || n.includes('v7a')) return 3;
    if (n.includes('x86')) return 4;
    return 2;
  };
  return [...apks].sort((a, b) => score(a) - score(b))[0];
}

async function gh(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

/* Direct APK from F-Droid when the GitHub release has none.
   F-Droid hosts stable APK URLs: /repo/<package>_<versionCode>.apk */
async function fdroidApk(packageId) {
  const res = await fetch(`https://f-droid.org/api/v1/packages/${packageId}`, {
    headers: { 'User-Agent': HEADERS['User-Agent'] },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const vc = data.suggestedVersionCode;
  if (!vc) return null;
  const pkg = (data.packages || []).find((p) => p.versionCode === vc);
  return {
    name: `${packageId}_${vc}.apk`,
    url: `https://f-droid.org/repo/${packageId}_${vc}.apk`,
    source: 'fdroid',
    versionName: pkg ? pkg.versionName : null,
  };
}

/* Auto-discover the real app icon and phone screenshots from the repo's
   fastlane metadata (the standard layout most FOSS Android apps use). */
const FASTLANE_PATHS = [
  'fastlane/metadata/android/en-US/images',
  'fastlane/metadata/android/en/images',
  'metadata/en-US/images',
];
const IMG_RE = /\.(png|jpe?g|webp)$/i;

/* Plenty of repos keep their real pictures in an assets folder and put git
   symlinks in the fastlane tree. GitHub lists those as ordinary files, and
   raw.githubusercontent serves a symlink's target *path as plain text* — so
   baking that URL into a page gives a broken image (Obtainium, PodAura and
   friends all do this). Anything far too small to be a picture is treated as
   a suspect and checked properly. */
const SYMLINK_MAX = 1024;

/* A symlink blob is one line holding a relative path. Resolve it against the
   file's own directory to get the URL of the picture it points at. */
async function followSymlink(file) {
  try {
    const res = await fetch(file.download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    if (!res.ok) return null;
    const target = (await res.text()).trim();
    if (!target || /\s/.test(target) || !IMG_RE.test(target)) return null;
    return new URL(target, file.download_url).toString();
  } catch {
    return null;
  }
}

async function servesAnImage(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': HEADERS['User-Agent'] } });
    return res.ok && (res.headers.get('content-type') || '').startsWith('image/');
  } catch {
    return false;
  }
}

/* Returns a URL that really serves a picture, or null. Ordinary files are
   trusted on their blob size alone, so the common case costs no requests. */
async function pictureUrl(file) {
  if (!file || !file.download_url) return null;
  if (file.size > SYMLINK_MAX) return file.download_url;
  const url = (await followSymlink(file)) || file.download_url;
  return (await servesAnImage(url)) ? url : null;
}

async function discoverImages(owner, name) {
  for (const base of FASTLANE_PATHS) {
    const listing = await gh(`https://api.github.com/repos/${owner}/${name}/contents/${base}`);
    if (listing.notFound || !Array.isArray(listing)) continue;
    const out = {};
    const icon = listing.find((f) => f.type === 'file' && /^icon\.(png|webp)$/i.test(f.name));
    if (icon) {
      const url = await pictureUrl(icon);
      if (url) out.icon = url;
    }
    const shotsDir = listing.find((f) => f.type === 'dir' && f.name === 'phoneScreenshots');
    if (shotsDir) {
      const shots = await gh(`https://api.github.com/repos/${owner}/${name}/contents/${shotsDir.path}`);
      if (Array.isArray(shots)) {
        const candidates = shots
          .filter((f) => f.type === 'file' && IMG_RE.test(f.name) && f.download_url)
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
          .slice(0, 6);
        const urls = [];
        for (const shot of candidates) {
          const url = await pictureUrl(shot);
          if (url) urls.push(url);
        }
        if (urls.length) out.screenshots = urls;
      }
    }
    if (out.icon || (out.screenshots && out.screenshots.length)) return out;
  }
  return {};
}

async function syncApp(app) {
  const m = app.repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!m) return { skipped: 'not a GitHub repo' };
  const [, owner, name] = m;

  const repo = await gh(`https://api.github.com/repos/${owner}/${name}`);
  if (repo.notFound) return { missing: true, syncedAt: new Date().toISOString() };

  const entry = {
    stars: repo.stargazers_count,
    owner: repo.owner ? repo.owner.login : owner,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    archived: !!repo.archived,
    hasDiscussions: !!repo.has_discussions,
    license: repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
      ? repo.license.spdx_id
      : null,
    syncedAt: new Date().toISOString(),
  };

  /* /releases/latest never returns prereleases — if an app only has
     prereleases (common while in testing), fall back to the release list
     so early apps still get a real APK link and a prerelease flag. */
  let release = await gh(`https://api.github.com/repos/${owner}/${name}/releases/latest`);
  if (release.notFound) {
    const list = await gh(`https://api.github.com/repos/${owner}/${name}/releases?per_page=5`);
    release = (Array.isArray(list) && list.find((r) => !r.draft)) || { notFound: true };
  }
  if (!release.notFound && release.tag_name) {
    if (release.prerelease) entry.prerelease = true;
    entry.releaseTag = release.tag_name;
    entry.releaseDate = release.published_at;
    const apks = (release.assets || [])
      .filter((a) => a.name.toLowerCase().endsWith('.apk'))
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    const best = pickApk(apks);
    if (best) entry.apk = best;
    if (apks.length > 1) entry.apkCount = apks.length;
  }

  // No APK on GitHub? Try F-Droid for a real, direct download.
  if (!entry.apk && app.fdroid) {
    try {
      const apk = await fdroidApk(app.fdroid);
      if (apk) {
        entry.apk = apk;
        if (apk.versionName && !entry.releaseTag) entry.releaseTag = apk.versionName;
      }
    } catch { /* keep fallback chain */ }
  }

  // Real icon + screenshots from the repo's fastlane metadata, if it has any.
  try {
    const images = await discoverImages(owner, name);
    if (images.icon) entry.icon = images.icon;
    if (images.screenshots && images.screenshots.length) entry.screenshots = images.screenshots;
  } catch { /* icons/screenshots are optional */ }

  return entry;
}

async function main() {
  const files = fs.readdirSync(APPS_DIR).filter((f) => f.endsWith('.json')).sort();
  let previous = { apps: {} };
  try {
    previous = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  } catch {
    /* first run */
  }

  const out = { fetchedAt: new Date().toISOString(), apps: { ...previous.apps } };
  let ok = 0;
  let failed = 0;

  /* Each app costs 3–5 API calls, so a catalog of several hundred takes far
     too long one at a time. A small worker pool keeps the whole run to a few
     minutes while staying well inside GitHub's concurrency comfort zone. */
  const queue = [...files];
  async function worker() {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      const app = JSON.parse(fs.readFileSync(path.join(APPS_DIR, file), 'utf8'));
      try {
        const entry = await syncApp(app);
        out.apps[app.id] = entry;
        ok++;
        const extras = [
          entry.apk ? `apk:${entry.apk.source === 'fdroid' ? 'f-droid' : 'github'}` : 'no apk',
          entry.icon ? 'icon' : null,
          entry.screenshots ? `${entry.screenshots.length} shots` : null,
        ].filter(Boolean).join('  ');
        console.log(`✓ ${app.id}  ⭐${entry.stars ?? '-'}  ${extras}`);
      } catch (e) {
        failed++;
        console.error(`✗ ${app.id}: ${e.message} (keeping previous data)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Drop entries for apps that no longer exist in the catalog.
  for (const id of Object.keys(out.apps)) {
    if (!files.includes(`${id}.json`)) delete out.apps[id];
  }

  fs.writeFileSync(LIVE_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`\nSynced ${ok}/${files.length} apps${failed ? ` (${failed} failed, previous data kept)` : ''} -> data/live.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
