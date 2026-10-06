/* GitHub star history, the data behind "Trending".

   data/star-history.json holds one snapshot of every app's star count per
   UTC day, for the last two weeks. scripts/sync.js adds to it on every run;
   build.js compares an app's count today with its count a week earlier.
   GitHub's API only ever says how many stars a repo has *now*, so this file
   is the only way to know how many it gained.

   One day per line, so a sync commit changes a line or two instead of
   rewriting the whole file. */
'use strict';

const KEEP_DAYS = 15;
const WEEK = 7;
/* Two counts closer together than this say too little about a whole week,
   so a listing younger than that waits before it can trend. */
const MIN_SPAN = 3;

const dayOf = (iso) => String(iso).slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

/* Files each app's count under the UTC day it was fetched. An entry that
   sync.js kept from an earlier run (its fetch failed this time) lands on
   its own, older day rather than posing as today's count. A later run on
   the same day overwrites the earlier one. */
function recordStars(history, liveApps) {
  const days = { ...((history && history.days) || {}) };
  const touched = new Set();
  for (const [id, entry] of Object.entries(liveApps)) {
    if (!entry || typeof entry.stars !== 'number' || !entry.syncedAt) continue;
    const day = dayOf(entry.syncedAt);
    if (!touched.has(day)) {
      days[day] = { ...days[day] };
      touched.add(day);
    }
    days[day][id] = entry.stars;
  }
  const newest = Object.keys(days).sort().at(-1);
  const kept = {};
  for (const day of Object.keys(days).sort()) {
    if (daysBetween(day, newest) < KEEP_DAYS) kept[day] = days[day];
  }
  return { days: kept };
}

/* Stars gained over the past week, as of the app's latest sync:
   { gain, before } where `before` is the count the gain is measured from,
   or null while there is too little history. The baseline is the newest
   count at least a week old; a gap in the history, or a listing younger
   than a week, is scaled to a seven-day rate. */
function weeklyGain(history, id, stars, syncedAt) {
  if (typeof stars !== 'number' || !syncedAt || !history || !history.days) return null;
  const today = dayOf(syncedAt);
  const usable = Object.keys(history.days).sort()
    .filter((day) => typeof history.days[day][id] === 'number' && daysBetween(day, today) >= MIN_SPAN);
  if (!usable.length) return null;
  const from = usable.filter((day) => daysBetween(day, today) >= WEEK).at(-1) || usable[0];
  const before = history.days[from][id];
  return { gain: Math.round((stars - before) * WEEK / daysBetween(from, today)), before };
}

function formatHistory(history) {
  const lines = Object.keys(history.days).sort().map((day) => {
    const snap = history.days[day];
    const sorted = Object.fromEntries(Object.keys(snap).sort().map((id) => [id, snap[id]]));
    return `  ${JSON.stringify(day)}: ${JSON.stringify(sorted)}`;
  });
  return `{\n "days": {\n${lines.join(',\n')}\n }\n}\n`;
}

module.exports = { recordStars, weeklyGain, formatHistory };
