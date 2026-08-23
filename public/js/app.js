/* App detail page enhancements. Everything here is optional:
   the page fully works without JS (real links are baked into the HTML).
   1. Share button — native share sheet on phones, copy-link + toast elsewhere.
   2. Silent refresh of stars + APK link from the GitHub API (1h localStorage cache).
      Any failure is swallowed: the baked-in data stays. */
(function () {
  'use strict';

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  var canShare = !!(navigator.share || (navigator.clipboard && navigator.clipboard.writeText));
  var shareBtn = document.getElementById('share-btn');
  if (shareBtn && canShare) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', function () {
      var data = {
        title: document.title,
        text: shareBtn.getAttribute('data-share-text') || '',
        url: location.href,
      };
      if (navigator.share) {
        navigator.share(data).catch(function () { /* user closed the sheet */ });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(location.href).then(
          function () { toast('Link copied! 📋'); },
          function () { toast('Could not copy — the link is in the address bar'); }
        );
      }
    });
  }

  var repo = document.body.getAttribute('data-github');
  if (!repo) return;

  function fmtStars(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function pickApk(assets) {
    var apks = (assets || []).filter(function (a) {
      return a.name.toLowerCase().endsWith('.apk');
    });
    if (!apks.length) return null;
    function score(a) {
      var n = a.name.toLowerCase();
      if (n.indexOf('universal') !== -1 || n.indexOf('-all') !== -1 || n.indexOf('_all') !== -1) return 0;
      if (n.indexOf('arm64') !== -1 || n.indexOf('v8a') !== -1) return 1;
      if (n.indexOf('armeabi') !== -1 || n.indexOf('v7a') !== -1) return 3;
      if (n.indexOf('x86') !== -1) return 4;
      return 2;
    }
    return apks.sort(function (a, b) { return score(a) - score(b); })[0];
  }

  function update(d) {
    var pill = document.getElementById('stars-pill');
    if (pill && typeof d.stars === 'number') {
      pill.textContent = '⭐ ' + fmtStars(d.stars) + ' GitHub stars';
    }
    var btn = document.getElementById('download-btn');
    if (btn && d.apkUrl) {
      btn.href = d.apkUrl;
      if (btn.getAttribute('data-kind') === 'fallback') {
        btn.textContent = '⬇️ Download the app (APK)';
        btn.setAttribute('data-kind', 'apk');
      }
    }
  }

  /* The cache key includes the baked-in download link: when a redeploy ships a
     newer release URL, old cached entries stop matching and can never overwrite
     the fresh link with a stale one (that bug shipped a v1.0 APK from a v2.0 page). */
  var dlBtn = document.getElementById('download-btn');
  var KEY = 'osps:' + repo + ':' + (dlBtn ? dlBtn.getAttribute('href') : '');
  try { localStorage.removeItem('osps:' + repo); } catch (e) { /* legacy key */ }
  var TTL = 60 * 60 * 1000;
  try {
    var cached = JSON.parse(localStorage.getItem(KEY));
    if (cached && Date.now() - cached.t < TTL) { update(cached.d); return; }
  } catch (e) { /* no cache */ }

  function get(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; });
  }

  Promise.all([
    get('https://api.github.com/repos/' + repo),
    get('https://api.github.com/repos/' + repo + '/releases/latest'),
  ]).then(function (results) {
    var info = results[0];
    var release = results[1];
    if (!info) return;
    var d = { stars: info.stargazers_count };
    var apk = release && pickApk(release.assets);
    if (apk) d.apkUrl = apk.browser_download_url;
    try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* full */ }
    update(d);
  }).catch(function () { /* offline or rate-limited — baked-in data stays */ });
})();
