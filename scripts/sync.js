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

async function discoverImages(owner, name) {
  for (const base of FASTLANE_PATHS) {
    const listing = await gh(`https://api.github.com/repos/${owner}/${name}/contents/${base}`);
    if (listing.notFound || !Array.isArray(listing)) continue;
    const out = {};
    const icon = listing.find((f) => f.type === 'file' && /^icon\.(png|webp)$/i.test(f.name));
    if (icon && icon.download_url) out.icon = icon.download_url;
    const shotsDir = listing.find((f) => f.type === 'dir' && f.name === 'phoneScreenshots');
    if (shotsDir) {
      const shots = await gh(`https://api.github.com/repos/${owner}/${name}/contents/${shotsDir.path}`);
      if (Array.isArray(shots)) {
        out.screenshots = shots
          .filter((f) => f.type === 'file' && IMG_RE.test(f.name) && f.download_url)
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
          .slice(0, 6)
          .map((f) => f.download_url);
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
    pushedAt: repo.pushed_at,
    archived: !!repo.archived,
    hasDiscussions: !!repo.has_discussions,
    license: repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
      ? repo.license.spdx_id
      : null,
    syncedAt: new Date().toISOString(),
  };

  const release = await gh(`https://api.github.com/repos/${owner}/${name}/releases/latest`);
  if (!release.notFound && release.tag_name) {
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

  for (const file of files) {
    const app = JSON.parse(fs.readFileSync(path.join(APPS_DIR, file), 'utf8'));
    try {
      out.apps[app.id] = await syncApp(app);
      ok++;
      const e = out.apps[app.id];
      const extras = [
        e.apk ? `apk:${e.apk.source === 'fdroid' ? 'f-droid' : 'github'}` : 'no apk',
        e.icon ? 'icon' : null,
        e.screenshots ? `${e.screenshots.length} shots` : null,
      ].filter(Boolean).join('  ');
      console.log(`✓ ${app.id}  ⭐${e.stars ?? '-'}  ${extras}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${app.id}: ${e.message} (keeping previous data)`);
    }
  }

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
