# Open Source Play Store — Design

**opensourceplaystore.com** — a static, login-free "play store" for open-source Android apps.
Anyone can list an app by linking its git repo. Downloads come from the project's own
GitHub Releases. Ratings are GitHub stars. Comments are the repo's own Discussions/Issues.

## Product principles

1. **No backend, no accounts, no tracking.** 100% static files. Publishing rides on
   GitHub's own login and pull-request flow.
2. **Fast everywhere.** Pre-rendered HTML for every page, inlined CSS, no framework,
   system fonts, lazy images. The site is fully usable with JavaScript disabled.
3. **Simple enough for a 10-year-old.** Emoji + word navigation, grade-3 reading level,
   one big obvious action per page, no jargon ("the app's home page", not "repository"),
   no dead ends — every empty state suggests the next tap.
4. **Quick publishing, honest trust signals.** Light automated validation only (schema,
   repo exists & public, no duplicates). In place of review: visible license, stars,
   owner name, last-updated date, anti-feature disclosures, and a one-tap report link.

## Architecture

```
data/apps/<id>.json      one hand-written manifest per app   (the only thing publishers touch)
data/categories.json     fixed category taxonomy (10 categories, emoji + word)
data/live.json           GENERATED snapshot: stars, latest release, APK url, per app
schema/app.schema.json   manifest contract (mirrored by scripts/validate.js, zero-dep)
scripts/validate.js      offline schema checks + optional --check-remote (CI on PRs)
scripts/sync.js          fetches GitHub data for all apps -> data/live.json (cron Action, ~6h)
build.js                 zero-dependency static site generator -> dist/
public/                  static assets copied as-is (JS, favicon, _headers, CNAME...)
```

**Key resolution (from the design panel):** nothing the browser renders by default
depends on a live GitHub API call. `scripts/sync.js` runs on a schedule with an
authenticated token (5,000 req/h) and bakes stars, latest release, and the actual APK
`href` into the static HTML. A visible "Updated <time> ago" line discloses freshness.
Client-side JS *may* silently refresh stars/APK link on a detail page view
(localStorage cache, 1h TTL) as progressive enhancement — never required, never an
error if it fails. The unauthenticated 60 req/h/IP limit is therefore irrelevant to
browsing.

**Download fallback chain (never a dead end):**
1. `.apk` asset from the latest GitHub release (baked by sync; refreshed client-side) —
   prefer `universal`/`all` builds, then `arm64-v8a`, else the first `.apk`.
2. The manifest's optional `download` URL (official download page — e.g. VLC, OsmAnd).
3. The repo's releases page ("Get it from the app's GitHub page").

**Publishing (no backend):** the publish form autofills from a pasted repo URL
(one user-initiated API call), shows a live checklist (repo public ✓ / license ✓ /
APK in release ✓⚠), builds the manifest JSON, then opens GitHub's *create new file*
page pre-filled (`/new/main?filename=data/apps/<id>.json&value=…`) — GitHub turns that
into a fork + pull request under the publisher's own account. CI validates; merging
publishes. "Suggest an edit" on each listing reuses the same trick with GitHub's edit
URL. "Report this app" opens a pre-filled issue on the site repo (the moderation queue).

## Pages

| Page | Path | Notes |
|---|---|---|
| Home / browse | `/` | hero, always-visible search, category chips, then four sections: 🔥 Popular (screenshot banner strip, by stars), 🚀 Trending (stars damped by days since last release), 🆕 Recently added, ✨ All apps grid (pre-rendered; JS only filters; strips hide while searching) |
| Category | `/category/<id>/` | pre-rendered filtered grid, empty state links to Publish |
| App detail | `/app/<id>/` | hero (icon, name, tagline, ⭐, license pill), big Download button, Share button (native share sheet on phones, copy-link toast on desktop), screenshots, description, the 5 repo links (Source / Problems / Questions / Versions / License), owner line, report + edit links |
| Publish | `/publish/` | paste repo URL → autofill → category chips → checklist → GitHub handoff |
| Help | `/help/` | install-an-APK guide (4 steps, reframed "unknown sources" warning) + FAQ |
| About | `/about/` | how the site works, for skeptical parents and developers |
| 404 | `/404.html` | friendly, links back to browse |

## UX system

- Visual language: **Apple "liquid glass"** — frosted translucent panels (`backdrop-filter` blur + saturate)
  floating over a colorful gradient mesh, hairline light borders, layered shadows. Solid-surface
  fallback via `@supports` for browsers without blur. (User-requested direction.)
- Nav: floating glass bottom tab bar on phones / glass top bar on desktop — `🏠 Home` `🔍 Search` `📤 Publish` `❓ Help` (+ theme toggle). No hamburger.
- One accent color (green gradient) reserved for the primary action on each page; amber only for genuine caution (install-guide warning step).
- Real screenshots and app icons are auto-discovered at sync time from each repo's fastlane
  metadata; a "🔥 Popular right now" strip on the home page showcases screenshot banners.
- Downloads are always direct APKs when at all possible: GitHub release asset first, then
  **F-Droid** (via the optional `fdroid` manifest field), then the `download` URL, then the releases page.
- Cards: big tap targets (whole card ≥ 88px), icon, name, tagline, `⭐ 12k` pill (or `🆕 New`), category emoji. Grid 2-col phones → 5-col desktop.
- Base font 18px, form inputs ≥16px, line-height 1.5+, WCAG AA contrast both themes, dark mode = `prefers-color-scheme` default + persisted toggle.
- Stars are always called "GitHub stars", never "rating". Buttons are verbs.
- Real URLs for every state (`?q=` for search); back button always works.

## Validation tiers (CI on every listing PR)

Hard block: invalid JSON/schema, bad category, malformed repo URL, id ≠ filename,
duplicate id or repo, repo missing/private. Soft warn (mergeable, one-glance label):
no APK in latest release, no license detected, archived repo. Same checks runnable
locally: `node scripts/validate.js [--check-remote]`.

## Performance budget

- First paint = one request: critical CSS inlined in every generated page (< ~10KB).
- JS per page: home ≤10KB (search/filter), detail ≤4KB (live refresh), publish ≤8KB (autofill + JSON), all plain ES modules, no framework.
- Icons: publisher icon URL or GitHub avatar CDN fallback, `loading="lazy" decoding="async"` + explicit dimensions.
- Hosting: Cloudflare Pages primary (`_headers` cache control), GitHub Pages fallback (`CNAME` included).

## Seeded catalog

18 well-known FOSS apps across all 10 categories (NewPipe, Signal, Bitwarden, Termux,
Thunderbird, AntennaPod, Aegis, Organic Maps, Mindustry, Shattered Pixel Dungeon,
AnkiDroid, Kiwix, Element, VLC, Fossify Gallery, OsmAnd, Joplin, KOReader). All repo
slugs verified live; 5 use the `download` fallback because their GitHub releases carry
no APK.

## Later (v2)

"Choose your phone type" multi-APK picker · search-index sharding past ~700 apps ·
PWA/offline shell · GitLab/Codeberg autofill (schema already accepts their URLs) ·
VirusTotal soft-signal on APKs · emergency delist workflow · provenance line
("via PR #N by @user") · i18n.
