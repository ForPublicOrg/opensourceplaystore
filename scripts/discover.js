#!/usr/bin/env node
/*
 * Finds open-source Android apps that are missing from data/apps/.
 *
 * Searches GitHub for app-shaped repositories, throws away everything that
 * isn't a real, installable, listable app, and prints what's left so a human
 * can write manifests for the good ones. It never writes to data/apps/ —
 * listings are hand-written on purpose (tagline and description are the
 * whole point of this site).
 *
 * Usage:
 *   node scripts/discover.js                     # every query set
 *   node scripts/discover.js --set ai            # ai | topics | recent
 *   node scripts/discover.js --min-stars 50
 *   node scripts/discover.js --out candidates.json
 *
 * Set GITHUB_TOKEN (search allows 30 req/min authenticated, 10 anonymous).
 *
 * Zero dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'data', 'apps');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const SET = argOf('--set', 'all');
const MIN_STARS = Number(argOf('--min-stars', 15));
const OUT = argOf('--out', null);

const HEADERS = {
  'User-Agent': 'opensourceplaystore-discover',
  Accept: 'application/vnd.github+json',
};
if (process.env.GITHUB_TOKEN) HEADERS.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

/* Query sets. "ai" tracks the on-device/assistant wave, "topics" walks the
   everyday app categories, "recent" catches young projects of any kind. */
const QUERY_SETS = {
  ai: [
    'topic:android topic:llm', 'topic:android topic:ai', 'topic:android-app topic:ai',
    'topic:android topic:chatgpt', 'topic:android topic:ollama', 'topic:android topic:openai',
    'topic:android topic:gemini', 'topic:android topic:whisper', 'topic:android topic:mcp',
    'topic:android topic:speech-recognition', 'topic:android topic:ocr', 'topic:android topic:tts',
    'topic:android topic:machine-learning', 'topic:android topic:translation',
    'topic:android topic:ai-assistant', 'topic:android topic:stable-diffusion',
    'topic:llm topic:kotlin', 'topic:ai topic:jetpack-compose',
  ],
  topics: [
    'topic:android topic:music-player stars:>25', 'topic:android topic:video-player stars:>40',
    'topic:android topic:reader stars:>25', 'topic:android topic:notes stars:>25',
    'topic:android topic:launcher stars:>40', 'topic:android topic:keyboard stars:>25',
    'topic:android topic:camera stars:>25', 'topic:android topic:gallery stars:>30',
    'topic:android topic:file-manager stars:>25', 'topic:android topic:rss stars:>25',
    'topic:android topic:podcast stars:>20', 'topic:android topic:torrent stars:>25',
    'topic:android topic:vpn stars:>40', 'topic:android topic:password-manager stars:>25',
    'topic:android topic:calendar stars:>25', 'topic:android topic:weather stars:>25',
    'topic:android topic:maps stars:>25', 'topic:android topic:game stars:>60',
    'topic:android topic:education stars:>25', 'topic:android topic:habit-tracker',
    'topic:android topic:fitness stars:>20', 'topic:android topic:finance stars:>25',
    'topic:android topic:messenger stars:>40', 'topic:android topic:self-hosted stars:>40',
    'topic:android topic:accessibility stars:>25', 'topic:wear-os stars:>25',
  ],
  recent: [
    'topic:android-app created:>2025-01-01 stars:>25', 'topic:android created:>2025-06-01 stars:>40',
    'topic:android-app pushed:>2026-04-01 stars:>60', 'topic:fdroid stars:>25',
    'topic:material-you stars:>40', 'topic:foss topic:android stars:>40',
    'topic:privacy topic:android stars:>40', 'topic:compose-multiplatform stars:>80',
  ],
};

/* Repos that are about apps rather than being one: course material, samples,
   libraries, wrappers. Cheap keyword filters catch most of them. */
const NOT_AN_APP = /(awesome|cheat ?sheet|tutorial|course|sample|example|demo app|boilerplate|template|library|-sdk|sdk-|plugin|gradle|starter|roadmap|interview|docs|documentation|wrapper|binding|framework|toolkit|component|ui-kit)/i;
const NOT_AN_APP_NAME = /(awesome|sample|demo|example|tutorial|template|boilerplate|library|sdk|plugin|starter|kit|docs|test)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 403 || res.status === 429) { await sleep(20000); continue; } // rate limited
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
    return res.json();
  }
  return null;
}

function listedRepos() {
  const seen = new Set();
  for (const file of fs.readdirSync(APPS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const app = JSON.parse(fs.readFileSync(path.join(APPS_DIR, file), 'utf8'));
    seen.add(app.repo.toLowerCase());
  }
  return seen;
}

/* An app nobody can install isn't a listing. Accept the repo only if one of
   its recent releases carries an .apk — the same thing the site's download
   button needs. */
async function apkRelease(fullName) {
  const releases = await gh(`https://api.github.com/repos/${fullName}/releases?per_page=4`);
  if (!Array.isArray(releases)) return null;
  for (const release of releases) {
    if (release.draft) continue;
    const apk = (release.assets || []).find((a) => a.name.toLowerCase().endsWith('.apk'));
    if (apk) {
      return {
        apk: apk.name,
        releaseTag: release.tag_name,
        releaseDate: release.published_at,
        prerelease: !!release.prerelease,
      };
    }
  }
  return null;
}

async function main() {
  const queries = SET === 'all'
    ? Object.values(QUERY_SETS).flat()
    : QUERY_SETS[SET];
  if (!queries) {
    console.error(`Unknown --set "${SET}". Try: ${Object.keys(QUERY_SETS).join(', ')}, all`);
    process.exit(1);
  }

  const listed = listedRepos();
  const found = new Map();

  for (const query of queries) {
    const url = `https://api.github.com/search/repositories?q=${
      encodeURIComponent(`${query} fork:false archived:false`)}&sort=stars&order=desc&per_page=100`;
    let items = [];
    try {
      const data = await gh(url);
      items = (data && data.items) || [];
    } catch (e) {
      console.error(`! ${query}: ${e.message}`);
    }
    let kept = 0;
    for (const repo of items) {
      const url = `https://github.com/${repo.full_name}`;
      if (listed.has(url.toLowerCase()) || found.has(repo.full_name)) continue;
      if (repo.archived || repo.fork || repo.is_template) continue;
      if (repo.stargazers_count < MIN_STARS || !repo.description) continue;
      if (NOT_AN_APP.test(`${repo.name} ${repo.description}`) || NOT_AN_APP_NAME.test(repo.name)) continue;
      /* No licence means the site can't show one, and the schema requires it. */
      const license = repo.license && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null;
      if (!license) continue;
      found.set(repo.full_name, {
        repo: url,
        name: repo.name,
        description: repo.description,
        stars: repo.stargazers_count,
        license,
        language: repo.language,
        topics: repo.topics || [],
        createdAt: repo.created_at,
        pushedAt: repo.pushed_at,
        website: repo.homepage || null,
      });
      kept++;
    }
    console.log(`${String(items.length).padStart(3)} hits, +${kept}  ${query}`);
    await sleep(2200); // search allows 30 req/min authenticated
  }

  console.log(`\n${found.size} repos not yet listed. Checking releases for APKs…`);
  const candidates = [];
  const list = [...found.values()];
  const CONCURRENCY = 8;
  const queue = [...list];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const candidate = queue.shift();
      if (!candidate) return;
      try {
        const release = await apkRelease(candidate.repo.replace('https://github.com/', ''));
        if (release) candidates.push({ ...candidate, ...release });
      } catch { /* a candidate we can't check is a candidate we skip */ }
    }
  }));

  candidates.sort((a, b) => b.stars - a.stars);
  console.log(`${candidates.length} of them ship an .apk:\n`);
  for (const c of candidates) {
    console.log([
      c.repo.replace('https://github.com/', '').padEnd(45),
      `⭐${c.stars}`.padEnd(8),
      c.license.padEnd(14),
      `born ${c.createdAt.slice(0, 7)}`,
      c.prerelease ? 'prerelease' : '',
      `\n    ${c.description.slice(0, 120)}`,
    ].join(' '));
  }

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(candidates, null, 1) + '\n');
    console.log(`\nWrote ${candidates.length} candidates -> ${OUT}`);
  }
  console.log('\nWrite a manifest for the ones worth listing (see schema/app.schema.json),');
  console.log('then run: node scripts/validate.js');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
