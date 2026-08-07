/*
 * Shared by build.js (rendering) and scripts/validate.js (checking) so the
 * validator never warns about a link the build already puts right.
 * public/js/publish.js keeps its own copy — it runs in the browser, where
 * there is nothing to require from.
 */
'use strict';

/* Makers paste the link from their browser's address bar, which on every forge
   is a *page about* the file, not the file: github.com/o/r/blob/main/icon.png
   serves HTML, so the <img> renders as nothing. The link is right — only the
   host is wrong — so rewrite it to the raw file rather than dropping a listing's
   pictures on the floor. Anything unrecognised is passed through untouched. */
function rawImageUrl(url) {
  const gh = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+?)(?:\?.*)?$/);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}`;
  const gl = url.match(/^https:\/\/gitlab\.com\/(.+?)\/-\/blob\/(.+?)(?:\?.*)?$/);
  if (gl) return `https://gitlab.com/${gl[1]}/-/raw/${gl[2]}`;
  const cb = url.match(/^https:\/\/codeberg\.org\/([^/]+\/[^/]+)\/src\/(.+?)(?:\?.*)?$/);
  if (cb) return `https://codeberg.org/${cb[1]}/raw/${cb[2]}`;
  const bb = url.match(/^https:\/\/bitbucket\.org\/([^/]+\/[^/]+)\/src\/(.+?)(?:\?.*)?$/);
  if (bb) return `https://bitbucket.org/${bb[1]}/raw/${bb[2]}`;
  return url;
}

module.exports = { rawImageUrl };
