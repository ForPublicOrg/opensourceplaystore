#!/usr/bin/env node
/*
 * Fetches the download counts that visitors' browsers keep in Firestore
 * (public/js/app.js writes them, firestore.rules guards them) and writes
 * the snapshot to data/downloads.json. build.js bakes it into the pages: the
 * "Most downloaded" sort order, and the running total on the About page.
 *
 * Zero dependencies and no credentials: plain REST, because the counts are
 * public by design (the rules let anyone read them).
 *
 * Tolerant like sync.js: if Firestore can't be reached, the previous snapshot
 * stays and the build carries on with it. This script never fails a deploy.
 *
 * FIRESTORE_EMULATOR_HOST=localhost:8085 points it at a local emulator.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'downloads.json');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

async function main() {
  const project = config.firestoreProject;
  if (!project) {
    console.log('downloads: no firestoreProject in site.config.json; skipped');
    return;
  }
  const host = process.env.FIRESTORE_EMULATOR_HOST
    ? `http://${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'https://firestore.googleapis.com';
  const collection = `${host}/v1/projects/${project}/databases/(default)/documents/downloads`;

  /* One read per counted app, 300 to a page. The total is summed over every
     document, including apps that have since left the catalog: their
     downloads still happened here. */
  const apps = {};
  let total = 0;
  let pageToken = '';
  do {
    const url = `${collection}?pageSize=300&mask.fieldPaths=count`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ')}`);
    const body = await res.json();
    for (const doc of body.documents || []) {
      const field = doc.fields && doc.fields.count;
      const n = Number(field && (field.integerValue ?? field.doubleValue));
      if (!Number.isFinite(n) || n <= 0) continue;
      apps[doc.name.split('/').pop()] = n;
      total += n;
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);

  /* Sorted keys keep the committed file's diffs readable. */
  const sorted = Object.fromEntries(Object.keys(apps).sort().map((id) => [id, apps[id]]));
  fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), total, apps: sorted }, null, 1) + '\n');
  console.log(`downloads: ${total.toLocaleString('en-US')} downloads across ${Object.keys(apps).length} apps -> data/downloads.json`);
}

main().catch((err) => {
  console.log(`downloads: could not fetch counts (${err.message}); keeping the previous snapshot`);
});
