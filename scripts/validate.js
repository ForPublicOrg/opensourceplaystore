#!/usr/bin/env node
/*
 * Validates every app manifest in data/apps/.
 * Zero dependencies — hand-coded checks mirroring schema/app.schema.json.
 *
 * Usage:
 *   node scripts/validate.js                 # offline checks (schema, duplicates)
 *   node scripts/validate.js --check-remote  # + live GitHub checks (repo exists,
 *                                            #   is public, has license and APK release)
 *
 * Exit code 0 = all good, 1 = at least one error. Warnings never fail the run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

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
];

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
  return errors;
}

async function checkRemote(app, errors, warnings) {
  const m = app.repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!m) {
    warnings.push('remote checks currently only cover GitHub repos — skipped');
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
    warnings.push(`could not reach the GitHub API (${e.message}) — remote checks skipped`);
    return;
  }
  if (res.status === 404) {
    errors.push('repo does not exist on GitHub (or is private)');
    return;
  }
  if (!res.ok) {
    warnings.push(`could not verify repo (GitHub API returned HTTP ${res.status})`);
    return;
  }
  const repo = await res.json();
  if (repo.private) errors.push('repo is private — only public repos can be listed');
  if (repo.archived) warnings.push('repo is archived — consider whether it should be listed');
  if (!repo.license) warnings.push('GitHub detects no license file in the repo');

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
      warnings.push(`no .apk asset in the latest GitHub release — ${fallback}`);
    }
  } catch (e) {
    warnings.push(`could not check releases (${e.message})`);
  }
}

async function main() {
  const remote = process.argv.includes('--check-remote');
  const files = fs.readdirSync(APPS_DIR).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.error('No manifests found in data/apps/');
    process.exit(1);
  }

  let failed = false;
  const seenRepos = new Map(); // lowercased repo URL -> first file that used it

  for (const file of files) {
    const errors = [];
    const warnings = [];
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

    if (remote && errors.length === 0) {
      await checkRemote(app, errors, warnings);
    }

    if (errors.length) {
      failed = true;
      console.error(`✗ ${file}`);
      for (const e of errors) console.error(`    error: ${e}`);
    } else {
      console.log(`✓ ${file}`);
    }
    for (const w of warnings) console.log(`    warning: ${w}`);
  }

  console.log(`\n${files.length} manifest(s) checked${failed ? ' — FAILED' : ', all good'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
