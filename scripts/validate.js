#!/usr/bin/env node
/*
 * Validates every app manifest in data/apps/.
 * Zero dependencies — hand-coded checks mirroring schema/app.schema.json.
 *
 * Usage:
 *   node scripts/validate.js                 # offline checks (schema, duplicates)
 *   node scripts/validate.js --check-remote  # + live checks (repo exists, is public,
 *                                            #   has license and APK release; the icon
 *                                            #   and screenshots are real, light pictures)
 *   node scripts/validate.js --check-remote --only data/apps/foo.json [more.json …]
 *                                            #   run the live checks on these manifests
 *                                            #   only (the offline checks always cover
 *                                            #   every file — duplicates need them to)
 *   node scripts/validate.js --check-remote --strict --only data/apps/foo.json
 *                                            #   also fail on "a human should look at
 *                                            #   this" warnings — used by auto-merge
 *
 * Exit code 0 = all good, 1 = at least one error. Warnings never fail the run
 * unless --strict says otherwise.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { rawImageUrl } = require('./lib/image-url');

const ROOT = path.join(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'data', 'apps');

const CATEGORIES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'categories.json'), 'utf8')
).map((c) => c.id);

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO_RE = /^https:\/\/(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\/[^/\s]+\/[^/\s]+$/;
const HTTPS_RE = /^https:\/\//;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ANTI_FEATURES = ['ads', 'tracking', 'nonfree-network', 'nonfree-assets'];
const KNOWN_FIELDS = [
  'id', 'name', 'tagline', 'description', 'repo', 'category', 'license',
  'icon', 'screenshots', 'website', 'download', 'fdroid', 'added', 'tags', 'antiFeatures',
  'status',
];

// Warnings that mean "nobody could confirm this listing is fine" — in --strict
// mode they become errors, so the auto-merge workflow leaves the PR for a human.
// "no-apk" is deliberately not here: F-Droid and download-page fallbacks are normal.
// Nor is "big-image": a heavy screenshot is worth saying out loud, but it is a
// real picture of a real app and no reason to hold up a listing.
const STRICT_BLOCKING = new Set([
  'remote-skipped', 'unreachable', 'unverified', 'archived', 'no-license', 'releases-unchecked',
  'not-an-image',
]);

// Above this, a screenshot costs more to load than the page around it. Phone
// screenshots leave plenty of room: a 1080x2400 PNG is normally 200-500 KB.
const BIG_IMAGE_BYTES = 1024 * 1024;

function fmtBytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function isString(v) {
  return typeof v === 'string';
}

function checkManifest(fileName, app) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  const unknown = Object.keys(app).filter((k) => !KNOWN_FIELDS.includes(k));
  if (unknown.length) err(`unknown fields: ${unknown.join(', ')}`);

  for (const field of ['id', 'name', 'tagline', 'description', 'repo', 'category', 'license']) {
    if (!isString(app[field]) || app[field].length === 0) {
      err(`missing or empty required field "${field}"`);
    }
  }
  if (errors.length) return errors; // no point pattern-checking absent fields

  if (!ID_RE.test(app.id) || app.id.length > 50) {
    err(`id "${app.id}" must be lowercase letters/numbers/dashes, max 50 chars`);
  }
  if (fileName !== `${app.id}.json`) {
    err(`filename must match the id: expected "${app.id}.json", got "${fileName}"`);
  }
  if (app.name.length > 50) err('name is longer than 50 characters');
  if (app.tagline.length > 80) err('tagline is longer than 80 characters');
  if (app.description.length < 20) err('description is shorter than 20 characters');
  if (app.description.length > 4000) err('description is longer than 4000 characters');
  if (!REPO_RE.test(app.repo) || app.repo.endsWith('.git')) {
    err(`repo "${app.repo}" must look like https://github.com/owner/name (GitHub, GitLab, Codeberg or Bitbucket; no trailing slash or .git)`);
  }
  if (!CATEGORIES.includes(app.category)) {
    err(`category "${app.category}" is not one of: ${CATEGORIES.join(', ')}`);
  }
  if (app.license.length > 40) err('license is longer than 40 characters');

  if (app.icon !== undefined && (!isString(app.icon) || !HTTPS_RE.test(app.icon) || app.icon.length > 300)) {
    err('icon must be an https URL (max 300 chars)');
  }
  if (app.website !== undefined && (!isString(app.website) || !HTTPS_RE.test(app.website) || app.website.length > 300)) {
    err('website must be an https URL (max 300 chars)');
  }
  if (app.download !== undefined && (!isString(app.download) || !HTTPS_RE.test(app.download) || app.download.length > 300)) {
    err('download must be an https URL (max 300 chars)');
  }
  if (app.added !== undefined && (!isString(app.added) || !DATE_RE.test(app.added))) {
    err('added must be a date like 2026-08-05');
  }
  if (app.screenshots !== undefined) {
    if (!Array.isArray(app.screenshots) || app.screenshots.length > 8 ||
        app.screenshots.some((s) => !isString(s) || !HTTPS_RE.test(s) || s.length > 300)) {
      err('screenshots must be a list of up to 8 https URLs');
    }
  }
  if (app.fdroid !== undefined && (!isString(app.fdroid) || !/^[A-Za-z0-9_.]+$/.test(app.fdroid) || app.fdroid.length > 100)) {
    err('fdroid must be a package id like org.example.app');
  }
  if (app.tags !== undefined) {
    if (!Array.isArray(app.tags) || app.tags.length > 10 ||
        app.tags.some((t) => !isString(t) || t.length === 0 || t.length > 30)) {
      err('tags must be a list of up to 10 short words');
    }
  }
  if (app.antiFeatures !== undefined) {
    if (!Array.isArray(app.antiFeatures) || app.antiFeatures.some((a) => !ANTI_FEATURES.includes(a))) {
      err(`antiFeatures entries must be from: ${ANTI_FEATURES.join(', ')}`);
    }
  }
  if (app.status !== undefined && app.status !== 'testing') {
    err('status can only be "testing" — leave it out once the app is stable');
  }
  return errors;
}

async function checkRemote(app, errors, warn) {
  const m = app.repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!m) {
    warn('remote-skipped', 'remote checks currently only cover GitHub repos — skipped');
    return;
  }
  const headers = {
    'User-Agent': 'opensourceplaystore-validator',
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers });
  } catch (e) {
    warn('unreachable', `could not reach the GitHub API (${e.message}) — remote checks skipped`);
    return;
  }
  if (res.status === 404) {
    errors.push('repo does not exist on GitHub (or is private)');
    return;
  }
  if (!res.ok) {
    warn('unverified', `could not verify repo (GitHub API returned HTTP ${res.status})`);
    return;
  }
  const repo = await res.json();
  if (repo.private) errors.push('repo is private — only public repos can be listed');
  if (repo.archived) warn('archived', 'repo is archived — consider whether it should be listed');
  if (!repo.license) warn('no-license', 'GitHub detects no license file in the repo');

  try {
    const rel = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/releases/latest`, { headers });
    let hasApk = false;
    if (rel.ok) {
      const release = await rel.json();
      hasApk = (release.assets || []).some((a) => a.name.toLowerCase().endsWith('.apk'));
    }
    if (!hasApk) {
      // The site's real fallback chain: F-Droid, then the download URL, then the releases page.
      const fallback = app.fdroid
        ? `the Download button will use F-Droid (${app.fdroid})`
        : app.download
          ? 'the Download button will use the listed download page'
          : 'the Download button will fall back to the releases page';
      warn('no-apk', `no .apk asset in the latest GitHub release — ${fallback}`);
    }
  } catch (e) {
    warn('releases-unchecked', `could not check releases (${e.message})`);
  }
}

/* A link to a web page about a picture, and a 6 MB picture, both sail through
   every offline check: the manifest is valid and the URL is https. One shows as
   blank space, the other takes seconds to appear on a phone. Only the server can
   tell us which we have, so ask it — against the same URL build.js will render,
   so a pasted github.com/…/blob/… link is judged on where it actually resolves. */
async function checkImages(app, warn) {
  const links = [];
  if (app.icon) links.push(['icon', app.icon]);
  (app.screenshots || []).forEach((s, i) => links.push([`screenshot ${i + 1}`, s]));

  for (const [label, listed] of links) {
    const url = rawImageUrl(listed);
    const via = url === listed ? '' : ` (resolves to ${url})`;
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'opensourceplaystore-validator' } });
    } catch (e) {
      warn('image-unchecked', `${label}: could not load it (${e.message})`);
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      warn('not-an-image', `${label}: nothing there (HTTP ${res.status})${via} — the listing will show blank space`);
      continue;
    }
    if (!res.ok) {
      // Plenty of hosts refuse HEAD outright; that is about them, not the picture.
      warn('image-unchecked', `${label}: the server answered HTTP ${res.status}, so it could not be checked`);
      continue;
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!type.startsWith('image/')) {
      warn('not-an-image', `${label}: serves ${type || 'no content type'}, not a picture${via} — the listing will show blank space. Link straight to the image file`);
      continue;
    }
    const size = Number(res.headers.get('content-length'));
    if (size > BIG_IMAGE_BYTES) {
      warn('big-image', `${label}: ${fmtBytes(size)} — anything over ${fmtBytes(BIG_IMAGE_BYTES)} is slow on a phone. Please scale it to the phone's own screen size, or save it as JPEG or WebP`);
    }
  }
}

// `--only a.json b.json` — every non-flag argument that follows, until the next flag.
function parseOnly(argv) {
  const at = argv.indexOf('--only');
  if (at === -1) return null;
  const picked = new Set();
  for (let i = at + 1; i < argv.length && !argv[i].startsWith('--'); i++) {
    picked.add(path.basename(argv[i]));
  }
  return picked;
}

async function main() {
  const remote = process.argv.includes('--check-remote');
  const strict = process.argv.includes('--strict');
  const only = parseOnly(process.argv);
  const files = fs.readdirSync(APPS_DIR).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.error('No manifests found in data/apps/');
    process.exit(1);
  }
  if (only) {
    const missing = [...only].filter((f) => !files.includes(f));
    if (missing.length) {
      console.error(`--only names manifests that are not in data/apps/: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  let failed = false;
  let remoteChecked = 0;
  const seenRepos = new Map(); // lowercased repo URL -> first file that used it

  for (const file of files) {
    const errors = [];
    const warnings = []; // { code, message }
    const warn = (code, message) => warnings.push({ code, message });
    let app;
    try {
      app = JSON.parse(fs.readFileSync(path.join(APPS_DIR, file), 'utf8'));
    } catch (e) {
      console.error(`✗ ${file}: not valid JSON — ${e.message}`);
      failed = true;
      continue;
    }

    errors.push(...checkManifest(file, app));

    if (isString(app.repo)) {
      const key = app.repo.toLowerCase();
      if (seenRepos.has(key)) {
        errors.push(`duplicate: ${seenRepos.get(key)} already lists this repo`);
      } else {
        seenRepos.set(key, file);
      }
    }

    const wantRemote = remote && (!only || only.has(file));
    if (wantRemote && errors.length === 0) {
      await checkRemote(app, errors, warn);
      await checkImages(app, warn);
      remoteChecked++;
    }

    // In --strict mode the "could not confirm this" warnings are errors, so a
    // listing nobody has looked at never merges on its own.
    const blocking = strict && wantRemote ? warnings.filter((w) => STRICT_BLOCKING.has(w.code)) : [];
    for (const w of blocking) errors.push(`a human should look at this one: ${w.message}`);

    if (errors.length) {
      failed = true;
      console.error(`✗ ${file}`);
      for (const e of errors) console.error(`    error: ${e}`);
    } else {
      console.log(`✓ ${file}`);
    }
    for (const w of warnings) {
      if (!blocking.includes(w)) console.log(`    warning: ${w.message}`);
    }
  }

  const scope = remote
    ? ` (${remoteChecked} also checked against the live repo${strict ? ', strictly' : ''})`
    : '';
  console.log(`\n${files.length} manifest(s) checked${scope}${failed ? ' — FAILED' : ', all good'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
