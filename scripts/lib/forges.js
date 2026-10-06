/*
 * The code hosts a listing's repo can live on, and what this site needs from
 * each: where its web pages are (build.js) and how to read its API
 * (scripts/sync.js and scripts/validate.js).
 *
 * GitHub's API code stays in sync.js and validate.js, where it grew up with
 * its quota handling. The adapters here cover GitLab, Codeberg and Bitbucket
 * and answer in one shape, so the callers treat every host alike:
 *
 *   repo()        -> { notFound } or { stars, owner, createdAt, pushedAt,
 *                    archived, private, license, licenseUrl, avatar,
 *                    hasIssues, issuesUrl }
 *   release()     -> { tag, date, prerelease, apks: [{ name, url, size }] } or null
 *   listDir(path) -> [{ name, path, type: 'file' | 'dir', symlink, size, download_url }] or null
 *
 * Zero dependencies.
 */
'use strict';

const HOSTS = {
  'github.com': { id: 'github', label: 'GitHub', releases: '/releases', issues: '/issues' },
  // GitLab dropped its old unscoped routes: /owner/name/releases now sends visitors to a sign-in page.
  'gitlab.com': { id: 'gitlab', label: 'GitLab', releases: '/-/releases', issues: '/-/issues' },
  'codeberg.org': { id: 'codeberg', label: 'Codeberg', releases: '/releases', issues: '/issues' },
  /* Bitbucket has no releases, its Downloads page needs a paid plan, and its
     issue tracker is retired (the API answers 410 Gone; has_issues lingers). */
  'bitbucket.org': { id: 'bitbucket', label: 'Bitbucket', releases: null, issues: null },
};

const REPO_RE = /^https:\/\/(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\/([^/\s]+)\/([^/\s]+)$/;

/* { id, label, host, owner, name, repo, releases, issues } for a manifest's
   repo URL, or null for anything that is not a repo on a known host. */
function forgeOf(repoUrl) {
  const m = String(repoUrl).match(REPO_RE);
  if (!m) return null;
  const [, host, owner, name] = m;
  return { ...HOSTS[host], host, owner, name, repo: repoUrl };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A JSON getter for one host: { notFound: true } on a 404, an Error on any
   other failure. GitLab and Bitbucket both answer 429 with a Retry-After; a
   short one is waited out, but Bitbucket's anonymous allowance is 60 calls an
   hour, so a long one fails fast and the caller keeps its previous data. */
function jsonGetter(userAgent, label) {
  return async function get(url, opts = {}, attempt = 0) {
    const headers = { 'User-Agent': userAgent, Accept: 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method: opts.body ? 'POST' : 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 404) return { notFound: true };
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt;
      if (wait <= 60000) {
        await sleep(wait);
        return get(url, opts, attempt + 1);
      }
    }
    if (!res.ok) throw new Error(`${label} API ${res.status} for ${url}`);
    return res.json();
  };
}

/* Codeberg sends local times ("2020-06-03T00:36:04+02:00") and GitLab adds
   milliseconds. build.js orders apps by comparing these as strings, so every
   date is stored the way GitHub writes them: UTC, to the second. */
function utc(date) {
  if (!date) return null;
  const t = new Date(date);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Anything that ends up in an href or src must be https, whatever an API says.
const https = (url) => (typeof url === 'string' && /^https:\/\//.test(url) ? url : undefined);

const LICENSE_FILE_RE = /^(licen[cs]e|copying)(\.(md|txt|rst))?$/i;

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

const isApk = (s) => typeof s === 'string' && /\.apk$/i.test(s.split(/[?#]/)[0]);

/* Releases arrive newest first. Like GitHub's /releases/latest, prefer the
   newest proper release and settle for a prerelease only when that is all
   there is, so an app in testing still gets a real APK link. */
const pickRelease = (releases) => releases.find((r) => !r.prerelease) || releases[0] || null;

/* GitLab names licences by their lowercase licensee keys ("apache-2.0",
   "gpl-3.0+"). GitHub reports the same detector's SPDX ids, so map them back:
   most are just the key in capitals. */
const SPDX_CASE = {
  'apache-2.0': 'Apache-2.0',
  'artistic-2.0': 'Artistic-2.0',
  'blueoak-1.0.0': 'BlueOak-1.0.0',
  'bsd-2-clause': 'BSD-2-Clause',
  'bsd-2-clause-patent': 'BSD-2-Clause-Patent',
  'bsd-3-clause': 'BSD-3-Clause',
  'bsd-3-clause-clear': 'BSD-3-Clause-Clear',
  'bsd-4-clause': 'BSD-4-Clause',
  'lppl-1.3c': 'LPPL-1.3c',
  'mulanpsl-2.0': 'MulanPSL-2.0',
  'postgresql': 'PostgreSQL',
  'unlicense': 'Unlicense',
  'vim': 'Vim',
  'zlib': 'Zlib',
};
function spdxOf(key) {
  if (!key || key === 'other' || key === 'no-license') return null;
  const orLater = key.endsWith('+');
  const base = orLater ? key.slice(0, -1) : key;
  const id = SPDX_CASE[base] || base.toUpperCase();
  return orLater ? `${id}-or-later` : id;
}

/* ---------------- GitLab ---------------- */

function gitlab(forge, get) {
  const fullPath = `${forge.owner}/${forge.name}`;
  const api = `https://gitlab.com/api/v4/projects/${encodeURIComponent(fullPath)}`;
  let project = null;

  return {
    async repo() {
      project = await get(`${api}?license=true`);
      if (project.notFound) return project;
      /* Anonymous REST answers leave out `archived` (only signed-in callers
         get the full project), but GraphQL tells anyone about a public one. */
      const gql = await get('https://gitlab.com/api/graphql', {
        body: {
          query: 'query($path: ID!) { project(fullPath: $path) { archived issuesEnabled } }',
          variables: { path: fullPath },
        },
      });
      const more = (gql && gql.data && gql.data.project) || {};
      const ns = project.namespace || {};
      return {
        stars: project.star_count,
        owner: ns.full_path || forge.owner,
        createdAt: utc(project.created_at),
        pushedAt: utc(project.last_activity_at),
        archived: !!more.archived,
        private: project.visibility !== undefined && project.visibility !== 'public',
        license: spdxOf(project.license && project.license.key),
        licenseUrl: https(project.license_url),
        // A project's own avatar is usually the app's logo; the group's is the next best thing.
        avatar: https(project.avatar_url) || (ns.avatar_url ? https(new URL(ns.avatar_url, 'https://gitlab.com').href) : undefined),
        hasIssues: more.issuesEnabled === false ? false : undefined,
      };
    },

    async release() {
      const list = await get(`${api}/releases?per_page=5`);
      if (!Array.isArray(list)) return null;
      const releases = list.filter((r) => !r.upcoming_release).map((r) => ({
        tag: r.tag_name,
        date: utc(r.released_at),
        prerelease: false, // GitLab has no such flag; build.js still badges beta-style tags
        apks: gitlabApks(r, project && project.id),
      }));
      return pickRelease(releases);
    },

    async listDir(dir) {
      if (!project || !project.default_branch) return null;
      const list = await get(`${api}/repository/tree?path=${encodeURIComponent(dir)}&per_page=100`);
      if (!Array.isArray(list)) return null;
      const raw = `${forge.repo}/-/raw/${encodePath(project.default_branch)}/`;
      return list.map((e) => ({
        name: e.name,
        path: e.path,
        type: e.type === 'tree' ? 'dir' : 'file',
        symlink: e.mode === '120000', // git's own file mode says so outright
        download_url: raw + encodePath(e.path),
      }));
    },
  };
}

/* A GitLab release carries its files two ways: as asset links, or (the older
   habit, still common) as uploads linked from the release notes. Uploads only
   download from the project-id route; the /owner/name/uploads/… link in the
   notes now answers 404 to anyone signed out. */
function gitlabApks(release, projectId) {
  const apks = [];
  for (const link of (release.assets && release.assets.links) || []) {
    const url = https(link.url);
    if (!url || !(isApk(link.name) || isApk(url))) continue;
    apks.push({ name: isApk(link.name) ? link.name : fileName(url), url });
  }
  if (projectId) {
    const UPLOAD_RE = /\/uploads\/([0-9a-f]{32})\/([^\s)"'<>]+?\.apk)(?=[\s)"'<>]|$)/gi;
    for (const [, hash, file] of String(release.description || '').matchAll(UPLOAD_RE)) {
      const url = `https://gitlab.com/-/project/${projectId}/uploads/${hash}/${file}`;
      if (!apks.some((a) => a.url === url)) apks.push({ name: fileName(url), url });
    }
  }
  return apks;
}

function fileName(url) {
  const last = url.split(/[?#]/)[0].split('/').pop();
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/* ---------------- Codeberg (Forgejo) ---------------- */

function codeberg(forge, get) {
  const api = `https://codeberg.org/api/v1/repos/${forge.owner}/${forge.name}`;

  const listing = (list) => list
    .filter((e) => e.type === 'file' || e.type === 'dir' || e.type === 'symlink')
    .map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type === 'dir' ? 'dir' : 'file',
      symlink: e.type === 'symlink', // Forgejo names symlinks as such, unlike GitHub
      size: e.size,
      download_url: e.download_url,
      html_url: e.html_url,
    }));

  return {
    async repo() {
      const r = await get(api);
      if (r.notFound) return r;
      /* Forgejo does not detect licences, so look for the file itself: the
         licence link can point at it, and its absence is worth a warning. */
      const root = await get(`${api}/contents`);
      const licenseFile = Array.isArray(root)
        ? listing(root).find((e) => e.type === 'file' && LICENSE_FILE_RE.test(e.name))
        : null;
      const tracker = r.external_tracker && https(r.external_tracker.external_tracker_url);
      return {
        stars: r.stars_count,
        owner: r.owner ? r.owner.login : forge.owner,
        createdAt: utc(r.created_at),
        pushedAt: utc(r.updated_at),
        archived: !!r.archived,
        private: !!r.private,
        license: null,
        licenseUrl: licenseFile ? https(licenseFile.html_url) : undefined,
        avatar: https(r.avatar_url) || (r.owner ? https(r.owner.avatar_url) : undefined),
        hasIssues: r.has_issues === false ? false : undefined,
        issuesUrl: r.has_issues !== false ? tracker : undefined,
      };
    },

    async release() {
      const list = await get(`${api}/releases?limit=5`);
      if (!Array.isArray(list)) return null;
      const releases = list.filter((r) => !r.draft).map((r) => ({
        tag: r.tag_name,
        date: utc(r.published_at),
        prerelease: !!r.prerelease,
        apks: (r.assets || [])
          .filter((a) => isApk(a.name) && https(a.browser_download_url))
          .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
      }));
      return pickRelease(releases);
    },

    async listDir(dir) {
      const list = await get(`${api}/contents/${encodePath(dir)}`);
      return Array.isArray(list) ? listing(list) : null;
    },
  };
}

/* ---------------- Bitbucket ---------------- */

/* Bitbucket has no stars, no archiving and no releases, and lets anonymous
   callers make only 60 API calls an hour, so this stops at what the repo
   itself says: that it exists, who owns it, when it last changed, whether it
   carries a licence. The download comes from F-Droid when there is one. */
function bitbucket(forge, get) {
  const api = `https://api.bitbucket.org/2.0/repositories/${forge.owner}/${forge.name}`;
  return {
    async repo() {
      const r = await get(api);
      if (r.notFound) return r;
      const branch = r.mainbranch && r.mainbranch.name;
      const root = branch ? await get(`${api}/src/${encodePath(branch)}/?pagelen=100`) : null;
      const licenseFile = root && Array.isArray(root.values)
        ? root.values.find((e) => e.type === 'commit_file' && LICENSE_FILE_RE.test(e.path))
        : null;
      return {
        owner: r.workspace ? r.workspace.slug : forge.owner,
        createdAt: utc(r.created_on),
        pushedAt: utc(r.updated_on),
        archived: false,
        private: !!r.is_private,
        license: null,
        licenseUrl: licenseFile ? `${forge.repo}/src/${encodePath(branch)}/${encodePath(licenseFile.path)}` : undefined,
        avatar: r.links && r.links.avatar ? https(r.links.avatar.href) : undefined,
      };
    },
    async release() {
      return null;
    },
    async listDir() {
      return null;
    },
  };
}

const ADAPTERS = { gitlab, codeberg, bitbucket };

/* The API adapter for a non-GitHub forge (see the top of this file). */
function hostApi(forge, userAgent) {
  const make = ADAPTERS[forge.id];
  return make ? make(forge, jsonGetter(userAgent, forge.label)) : null;
}

module.exports = { forgeOf, hostApi };
