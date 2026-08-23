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
scripts/discover.js      searches GitHub for listable apps not yet in the catalog (manual)
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
| Home | `/` | hero + search, category chips, 🔥 Popular (screenshot strip), 🚀 Trending, 🌱 Brand new (repo created in the last year, ≥20 stars), 💎 Hidden gems (20–1500 stars, active in last 6 months), ⭐ Top apps preview (12) → "Browse all" |
| All apps | `/apps/` | the full catalog: search box, sort tabs, 24-per-page numbered pagination — every sort × page is a pre-rendered static page with `rel=prev/next` |
| Category | `/category/<id>/` | same catalog treatment (sort tabs + pagination) scoped to a category |
| In testing | `/testing/` | virtual collection of apps whose makers flag them early (`status: "testing"`) or whose latest release is a prerelease (auto-detected) |
| App detail | `/app/<id>/` | hero (icon, name, tagline, ⭐, license, 🧪/💤 pills), Download + Share, screenshots (tap → in-page viewer), description, the 5 repo links, 🧭 More like this (category + shared tags), JSON-LD `SoftwareApplication`, report + edit links |
| Publish | `/publish/` | paste repo URL → autofill → category chips → "still in testing?" checkbox → checklist → GitHub handoff |
| Help | `/help/` | install-an-APK guide (4 steps) + FAQ (incl. what 🧪 In testing means) |
| About | `/about/` | how the site works, for skeptical parents and developers |
| 404 | `/404.html` | friendly, links back to browse |

Every page also carries a dismissible ⚠️ **keepandroidopen.org** banner (localStorage
dismiss, applied pre-paint) and — on pages without their own search box — a compact
header search that submits to `/apps/?q=…`. Phones get a 🔍 Search tab instead.

**Sort orders** (catalog + every category, all pre-rendered so sorting works without JS):
`⭐ Top` GitHub stars · `🆕 Just added` the listing's `added` date · `🌱 Brand new` the repo's
creation date · `🔄 Updated` latest release or push · `👤 Maker` owner A–Z (cards swap the
category tag for the maker's name) · `🔤 A–Z` name. The active order is spelled out in words
next to the count ("Youngest projects first — recently started"), because two of the tabs mean
"new" in different senses. Only `top` is indexable; the rest are `noindex,follow`.

**Search** is index-based: `build.js` emits `search-index.json` (~90 KB, name/tagline/
tags/owner/category/stars/icon per app), fetched once on first focus/keystroke.
Results are ranked (name-prefix > name > tags/owner/category > tagline > all-words)
and rendered client-side, capped at 60, with `?q=` deep links. Without JS the search
box is hidden and the paginated catalog does everything.

## UX system

- Visual language: **Apple "liquid glass"** — frosted translucent panels (`backdrop-filter` blur + saturate)
  floating over a colorful gradient mesh, hairline light borders, layered shadows. Solid-surface
  fallback via `@supports` for browsers without blur. (User-requested direction.)
- Nav: floating glass bottom tab bar on phones / glass top bar on desktop — `🏠 Home` `🔍 Search` `📤 Publish` `❓ Help` (+ theme toggle). No hamburger.
- One accent color (green gradient) reserved for the primary action on each page; amber only for genuine caution (install-guide warning step).
- Real screenshots and app icons are auto-discovered at sync time from each repo's fastlane
  metadata; a "🔥 Popular right now" strip on the home page showcases screenshot banners.
- **Screenshot viewer** (`public/js/lightbox.js`): tapping a screenshot enlarges it over the
  page — never a new tab. The picture flies out of the thumbnail and back into whichever one
  you're viewing when you close (the strip scrolls to match, and focus lands there too).
  Sideways swiping is native CSS scroll-snap, so it keeps platform momentum; dragging the
  picture down dismisses it, thinning the scrim as it follows your finger; pinch-to-zoom is
  left to the browser. Controls are one glass cluster — `‹ Picture 3 of 6 ●●●●● ›` — hard-coded
  light-on-dark because the scrim is dark in *both* themes. Opening pushes one history entry,
  so Back closes the viewer and a second Back leaves the page. Nothing required (closing,
  scroll unlock, focus return, landing on the right picture) depends on an animation or a
  `close` event firing — throttled timelines and browsers that skip the event must not be able
  to strand a visitor. Enhancement only: without JS the screenshots stay plain links to the
  images, and Back returns.
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

**Unattended merge.** A PR that only *adds* `data/apps/<id>.json` files (≤5 of them,
nothing else touched) is squash-merged by CI with no human in the loop, so publishing
takes minutes rather than a maintainer's attention. For that path the soft warnings
that mean *nobody could confirm this* — archived, no license, non-GitHub host,
API unreachable — are promoted to blocks (`--strict`); "no APK in latest release"
stays soft, since the F-Droid and download-page fallbacks are normal. Everything
else, including edits to an existing listing, is labelled `needs-review` and waits
for a person. The guard is a path allowlist in `.github/workflows/auto-merge.yml`,
which is also why that workflow never executes the PR's code.

## Performance budget

- First paint = one request: critical CSS inlined in every generated page (< ~10KB).
- JS per page, measured gzipped (what the host actually sends): home ≤4KB (search 2.6 + strips
  0.9), detail ≤9KB (app 1.6 + strips 0.9 + screenshot viewer 6.1, and the viewer is only
  loaded on pages that have screenshots), publish ≤5KB. Plain scripts, no framework. Raw file
  sizes run ~3× larger because this codebase comments heavily on purpose.
- Full-size screenshots are never fetched until the viewer opens, and then only the picture
  you're on plus its two neighbours. They reuse the thumbnails' URLs, so the cache serves them.
- Icons: publisher icon URL or GitHub avatar CDN fallback, `loading="lazy" decoding="async"` + explicit dimensions.
- Hosting: Cloudflare Pages primary (`_headers` cache control), GitHub Pages fallback (`CNAME` included).

## Catalog

1400+ apps across all 10 categories, grown by mining GitHub for open-source Android
projects that ship a real `.apk` in their releases. Listings are only written for repos
that are unarchived, carry a detected license, and are neither libraries, demos nor
mirrors. The 2026 sweep leaned into the AI wave — on-device LLM chats, offline
transcription and TTS, screen translators, phone-driving agents — alongside the
long-standing FOSS staples (LibreTube, KeePassDX, Obtainium, FairEmail, Jellyfin,
Unciv, Fossify, Rethink, Trail Sense …).

A later sweep filled the gaps that mining alone kept missing: the household-name
messengers and browsers (SimpleX, Element X, Bluesky, Cromite, Tuta), the emulators
and game ports people actually look for (PPSSPP, Dolphin, ScummVM, SuperTuxKart), and
whole domains no topic query reached — ham radio, OBD-II, 3D printing, birding,
accessibility, disaster alerts, recipes. Apps are turned away when the shipped binary
is not open source, when the interface exists only in a language the site does not
serve, when the project has been abandoned by its author, or when the app's purpose is
patching someone else's proprietary app.

## Later (v2)

"Choose your phone type" multi-APK picker · search-index sharding past ~700 apps ·
PWA/offline shell · GitLab/Codeberg autofill (schema already accepts their URLs) ·
VirusTotal soft-signal on APKs · emergency delist workflow · provenance line
("via PR #N by @user") · i18n.
