# Open Source Play Store

**[opensourceplaystore.com](https://opensourceplaystore.com)** — a fast, static, login-free
"play store" for open-source Android apps. Anyone can list an app by linking its git repo;
downloads come straight from the project's own releases (GitHub or F-Droid); ratings are
GitHub stars and comments are the repo's own Discussions. See [DESIGN.md](DESIGN.md) for
the full product design.

- **No backend, no accounts, no tracking** — 100% static files.
- **Fully usable with JavaScript disabled** — real download links are baked into the HTML.
- **Kid-simple UX** — Apple-glass look, emoji navigation, grade-3 reading level.

## Repo layout

```
data/apps/<id>.json      one manifest per app — the only file publishers touch
data/categories.json     fixed category taxonomy
data/live.json           generated snapshot (stars, APK links, icons, screenshots)
schema/app.schema.json   the manifest contract
scripts/validate.js      schema + duplicate + live-repo checks (zero-dep)
scripts/sync.js          fetches GitHub/F-Droid data + fastlane images -> live.json
scripts/serve.js         tiny local preview server
build.js                 zero-dependency static site generator -> dist/
public/                  assets copied into dist/ (JS, favicon, CNAME, _headers)
.github/workflows/       validate PRs · deploy Pages · 6-hourly data sync
```

## Develop locally

Requires Node 18+ (no npm install — there are zero dependencies).

```bash
node scripts/sync.js     # optional: fetch live data (set GITHUB_TOKEN for higher limits)
node build.js            # generate the site into dist/
node scripts/serve.js    # preview at http://localhost:8080
```

`node scripts/validate.js` checks every manifest; add `--check-remote` to also verify
repos exist and releases carry APKs.

## Going live (one-time setup)

1. Create a GitHub repository (e.g. `youruser/opensourceplaystore`) and push this project.
2. Set `registryRepo` in [site.config.json](site.config.json) to `youruser/opensourceplaystore`
   — this turns on one-click publishing, "Suggest an edit", and "Report listing" links.
3. **Hosting, any of:**
   - **Vercel** (current setup): import the repo — [vercel.json](vercel.json) already sets the
     build command, `dist` output, and cache/security headers. Optionally add a `GITHUB_TOKEN`
     env var so the build-time sync gets authenticated API limits. Add the custom domain
     `opensourceplaystore.com`.
   - **Cloudflare Pages**: build command `node scripts/sync.js && node build.js`, output `dist`.
   - **GitHub Pages**: Settings → Pages → Source: *GitHub Actions*. The included
     [deploy.yml](.github/workflows/deploy.yml) builds and deploys on every push;
     [public/CNAME](public/CNAME) already points at the domain.
4. Point the domain's DNS at your host (CNAME/A records per their docs).
5. The [sync workflow](.github/workflows/sync.yml) refreshes stars/downloads/screenshots
   every 6 hours automatically.

## How publishing works

The **Publish** page autofills the form from a pasted repo URL, builds the manifest JSON,
and opens GitHub's *create new file* page in this repo pre-filled — the publisher's own
GitHub login turns it into a fork + pull request. [validate.yml](.github/workflows/validate.yml)
checks the PR automatically (schema, duplicates, repo exists & is public); merging publishes
on the next deploy. No account on this site is ever needed.

Manifest fields are documented in [schema/app.schema.json](schema/app.schema.json). Notable
optional fields: `fdroid` (package id — enables a direct APK download via F-Droid when the
GitHub release has none) and `download` (an official download page as a last-resort fallback).
Icons and phone screenshots are auto-discovered from the repo's fastlane metadata
(`fastlane/metadata/android/en-US/images/…`) — publishers who follow that standard get a
rich listing for free.
