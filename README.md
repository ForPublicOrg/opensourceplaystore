# Open Source Play Store

**[opensourceplaystore.com](https://opensourceplaystore.com)**: a fast, static, login-free
"play store" for open-source Android apps. Anyone can list an app by linking its git repo;
downloads come straight from the project's own releases (GitHub or F-Droid); ratings are
GitHub stars and comments are the repo's own Discussions. See [DESIGN.md](DESIGN.md) for
the full product design.

- **No backend, no accounts, no tracking**: 100% static files. The one piece of shared
  state is an anonymous per-app download count in Firestore (see [Download counter](#download-counter)).
- **Fully usable with JavaScript disabled**: real download links and every sort order are
  baked into the HTML (stars · trending · most downloaded · just added · newest projects · updated ·
  maker · A–Z).
- **Kid-simple UX**: plain words at a grade-3 reading level, big tap targets, icon-and-word
  navigation, and one obvious action per page. See the UX system in [DESIGN.md](DESIGN.md).

## Repo layout

```
data/apps/<id>.json      one manifest per app; the only file publishers touch
data/categories.json     fixed category taxonomy
data/live.json           generated snapshot (stars, APK links, icons, screenshots)
data/star-history.json   generated daily star counts, last two weeks (what Trending ranks by)
data/downloads.json      generated snapshot of the download counts in Firestore
schema/app.schema.json   the manifest contract
scripts/validate.js      schema + duplicate + live-repo checks (zero-dep)
scripts/lib/icons.js     the site's icon set, inlined into every page as an SVG sprite
scripts/lib/stars.js     star history: records daily counts, works out the weekly gain
scripts/lib/app-icon.js  draws the PNG app icons (manifest, iPhone home screen) from the favicon
scripts/sync.js          fetches GitHub/F-Droid data + fastlane images -> live.json, star-history.json
scripts/downloads.js     fetches the download counts from Firestore -> downloads.json
scripts/discover.js      finds listable apps GitHub has and this catalog doesn't
scripts/setup-repo.js    one-time GitHub settings for unattended publishing
scripts/serve.js         tiny local preview server
build.js                 zero-dependency static site generator -> dist/
public/                  assets copied into dist/ (JS, CSS, the display font, favicon, manifest, CNAME, _headers)
public/sw.js             service worker: lets the installed app open pages without internet
firestore.rules          the download counter's only server-side logic: public reads, +1 writes
.github/workflows/       validate PRs · auto-merge publishes · deploy · daily sync
```

## Develop locally

Requires Node 18+ (no npm install; there are zero dependencies).

```bash
node scripts/sync.js     # optional: fetch live data (set GITHUB_TOKEN for higher limits)
node scripts/downloads.js  # optional: fetch the current download counts
node build.js            # generate the site into dist/
node scripts/serve.js    # preview at http://localhost:8080
```

`node scripts/validate.js` checks every manifest; add `--check-remote` to also verify
repos exist and releases carry APKs, on GitHub, GitLab, Codeberg or Bitbucket. Remote
checks cost two or three API calls per app, so CI narrows them to what a pull request
touched: `--only data/apps/foo.json`.

`sync.js` reads each repo from its own host. GitHub is asked with `GITHUB_TOKEN` when
set; GitLab, Codeberg and Bitbucket are asked anonymously, which is plenty for public
repos (Bitbucket allows 60 calls an hour, and has no stars or releases to read, so its
listings get their download from F-Droid).

## Growing the catalog

```bash
GITHUB_TOKEN=… node scripts/discover.js --set ai --out candidates.json
```

`discover.js` searches GitHub for app-shaped repositories, drops anything already listed,
archived, unlicensed, forked, or lacking an `.apk` in its recent releases, and prints what
survives. Query sets: `ai` (on-device models, assistants, OCR/speech), `topics` (the everyday
app categories), `recent` (young projects), `everyday` (the ordinary reasons people open a
phone, todo, pdf, alarm, recipes, budgets, sudoku), `niche` (ssh, mqtt, ham radio, obd2,
3D printing, self-hosted clients), or `all`. It deliberately does **not** write
manifests: the tagline and description are hand-written for every listing, in plain language,
which is the part that makes this catalog worth browsing.

## Going live (one-time setup)

1. Create a GitHub repository (e.g. `youruser/opensourceplaystore`) and push this project.
2. Set `registryRepo` in [site.config.json](site.config.json) to `youruser/opensourceplaystore`;
   this turns on one-click publishing, "Suggest an edit", and "Report listing" links.
3. **Hosting, any of:**
   - **Vercel** (current setup): import the repo; [vercel.json](vercel.json) already sets the
     build command, `dist` output, and cache/security headers. Optionally add a `GITHUB_TOKEN`
     env var so the build-time sync gets authenticated API limits. Add the custom domain
     `opensourceplaystore.com`.
   - **Cloudflare Pages**: build command `node scripts/sync.js && node build.js`, output `dist`.
   - **GitHub Pages**: Settings → Pages → Source: *GitHub Actions*. The included
     [deploy.yml](.github/workflows/deploy.yml) builds and deploys on every push;
     [public/CNAME](public/CNAME) already points at the domain.
4. Point the domain's DNS at your host (CNAME/A records per their docs).
5. The [sync workflow](.github/workflows/sync.yml) refreshes stars/downloads/screenshots
   once a day automatically. A catalog this size costs more API calls than one hourly
   quota allows, so a run refreshes the stalest entries first and stops cleanly when the
   quota is spent; the next run carries on from where it left off, and a few days of runs
   cover everything. Newly listed apps sort first, so they get their stars and download
   link on the very next sync (and on any deploy before that, since the host's build runs
   the sync too).

## Installing the site as an app

The site is an installable web app: [public/site.webmanifest](public/site.webmanifest),
PNG icons that `build.js` draws from the favicon into `dist/icons/`, and a service worker
([public/sw.js](public/sw.js)) that fetches every page from the network first and keeps the
last 50 for when there's no connection (anything else gets `/offline/`).
[public/js/install.js](public/js/install.js) offers the install only where the browser can do
it in one tap: an **Install app** button in the header on wide screens, and on phones a card
above the tab bar from a visitor's second page, never on an app's own page. The Help page
explains the browser-menu route for Firefox and Safari. The details are in
[DESIGN.md](DESIGN.md#the-site-as-an-app).

`localhost` counts as secure, so all of it works under `node scripts/serve.js`; Chrome's
DevTools (*Application → Manifest*) shows whether the page is installable. Installs belong to
one origin, so `opensourceplaystore.com` and `www.opensourceplaystore.com` are separate apps:
keep the apex as the primary domain. To retire the service worker, publish a `sw.js` that
calls `self.registration.unregister()`.

## Download counter

A tap on an app page's Download button adds one to that app's count in Cloud Firestore
(project `firestoreProject` in [site.config.json](site.config.json)). There is no server
and no Firebase SDK: [public/js/app.js](public/js/app.js) posts a
single `+1` straight to the Firestore REST API, signed out and without cookies, once per
app per browser per day. [firestore.rules](firestore.rules) is the whole server side:
anyone may read the counts, and the only write anyone may make is adding exactly one to
one app's `downloads/<app id>` document.

At build time [scripts/downloads.js](scripts/downloads.js) reads the counts back into
`data/downloads.json` (the daily sync also commits it, as a fallback snapshot), and
`build.js` uses it for the **Most downloaded** sort on every catalog page. If Firestore
can't be reached, the previous snapshot is used and the build carries on. Leave
`firestoreProject` empty to switch the counter off entirely.

**One-time setup:** create the Firestore database (*Build → Firestore Database → Create
database*, production mode), then publish the rules: paste [firestore.rules](firestore.rules)
into *Firestore → Rules → Publish*, or:

```bash
npx firebase-tools deploy --only firestore:rules
```

To test rule changes locally, `npx firebase-tools emulators:start --only firestore` serves
them on port 8085, and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 node scripts/downloads.js`
reads from it.

## How publishing works

The **Publish** page autofills the form from a pasted repo URL, builds the manifest JSON,
and opens GitHub's *create new file* page in this repo pre-filled; the publisher's own
GitHub login turns it into a fork + pull request. No account on this site is ever needed.

From there nobody has to do anything:

```
publisher opens a PR that adds data/apps/<id>.json
   -> validate.yml     schema + duplicates + live repo checks (contributor-facing)
   -> auto-merge.yml   the same checks, run from main's code, then squash-merges
   -> the host rebuilds from the push and the app is live
```

[auto-merge.yml](.github/workflows/auto-merge.yml) merges a pull request only when **every
single thing about it** is a brand-new app listing:

- every changed file is `added`; nothing modified, renamed or deleted;
- every path is `data/apps/<id>.json`, with `<id>` lowercase letters, numbers and dashes;
- at most 5 listings in one pull request, each a plain file (no symlinks) under 32 KB;
- `validate.js --check-remote --strict` passes: schema, no duplicate repo, the repo is
  public, not archived, carries a license, and the whole site still builds.

Anything else (a code change, a workflow change, an edit to a listing that already exists,
a repo that could not be verified) gets the `needs-review` label and a comment saying why,
and waits for a maintainer. `--strict` is what makes that call: warnings meaning *nobody
could confirm this* (repo archived, no license, not on a known code host, API
unreachable) become errors, while the ordinary "no `.apk` in the latest release" warning
does not, because F-Droid and download-page fallbacks are normal.

The workflow runs on `pull_request_target` (a fork's `pull_request` token cannot merge),
so it never checks out or runs the pull request's code. It checks out `main`, reads the
changed-file list from the API, and copies in the manifests only after their paths pass the
checks above. What it deliberately does *not* judge is taste: whether an app is worth
listing, and whether the URLs in a listing point somewhere sensible. Anyone can flag a bad
listing with **Report this listing**, and removing one is a normal (human-reviewed) PR.

### Turning it on

```bash
node scripts/setup-repo.js            # show what it would change
node scripts/setup-repo.js --apply    # allow auto-merge + squash, create the label
```

Add `--pages` if the site is hosted on GitHub Pages: merges made by the Actions bot don't
trigger push-triggered workflows, so the `PAGES_DEPLOY` variable tells
[auto-merge.yml](.github/workflows/auto-merge.yml) and [sync.yml](.github/workflows/sync.yml)
to dispatch [deploy.yml](.github/workflows/deploy.yml) explicitly. Vercel and Cloudflare
build from the push webhook and need nothing.

Leave branch protection off on `main` (or give GitHub Actions a bypass): the daily sync
bot pushes `data/live.json` straight to `main`, and a "require a pull request" rule blocks it.
The path guard in the workflow, not branch protection, is what keeps code changes out of
unattended merges.

Manifest fields are documented in [schema/app.schema.json](schema/app.schema.json). Notable
optional fields: `fdroid` (package id: enables a direct APK download via F-Droid when the
GitHub release has none), `download` (an official download page as a last-resort fallback),
and `status: "testing"` (marks an early version: the listing gets an "In testing" badge and appears
in the `/testing/` collection; prerelease-style release tags are badged automatically).
Icons and phone screenshots are auto-discovered from the repo's fastlane metadata
(`fastlane/metadata/android/en-US/images/…`): publishers who follow that standard get a
rich listing for free.
