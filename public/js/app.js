/* App detail page enhancements. Everything here is optional:
   the page fully works without JS (real links are baked into the HTML).
   1. Share button — native share sheet on phones, copy-link + toast elsewhere.
   2. Download counter — a tap on Download adds one to the app's count in Firestore.
   3. Silent refresh of stars + APK link from the GitHub API (1h localStorage cache).
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
          function () { toast('Link copied'); },
          function () { toast('Could not copy — the link is in the address bar'); }
        );
      }
    });
  }

  /* Once per app per browser per day, so a double tap or a retried download
     counts once. Only the app's id is sent — no cookies, nothing about the
     visitor — and firestore.rules makes "+1 to one app" the only write anyone
     can make. Plain REST, not the ~100 KB Firebase SDK. A string body goes as
     text/plain (Google's API reads the JSON anyway): a simple CORS request, no
     preflight, and keepalive delivers it even when the tap opens another page. */
  var dl = document.getElementById('download-btn');
  var db = dl && dl.getAttribute('data-db');
  if (db && window.fetch) {
    var appId = dl.getAttribute('data-app');
    var docs = 'projects/' + db + '/databases/(default)/documents';
    var api = 'https://firestore.googleapis.com/v1/' + docs;

    /* The "N downloads" tag in the header: hidden at build time until the
       first download, shown as soon as there is a number. Counts only ever
       grow, so a smaller number is a stale one and is ignored. */
    var countEl = document.getElementById('dl-count');
    var shown = countEl ? Number(countEl.textContent.replace(/,/g, '')) || 0 : 0;
    function showDownloads(n) {
      var pill = document.getElementById('dl-pill');
      if (!pill || !(n > 0) || n < shown) return;
      shown = n;
      countEl.textContent = n.toLocaleString('en-US');
      document.getElementById('dl-word').textContent = n === 1 ? 'download' : 'downloads';
      pill.hidden = false;
    }

    var counted = false;
    var countDownload = function () {
      if (counted) return;
      counted = true;
      var seen = {};
      try { seen = JSON.parse(localStorage.getItem('osps-dl')) || {}; } catch (e) { /* none yet */ }
      var now = Date.now();
      if (now - (seen[appId] || 0) < 864e5) return;
      for (var id in seen) if (now - seen[id] >= 864e5) delete seen[id];
      seen[appId] = now;
      try { localStorage.setItem('osps-dl', JSON.stringify(seen)); } catch (e) { /* private mode */ }
      /* Tick the tag up right away — the database agrees a moment later. */
      showDownloads(shown + 1);
      fetch(api + ':commit', {
        method: 'POST',
        keepalive: true,
        credentials: 'omit',
        body: JSON.stringify({ writes: [{
          update: { name: docs + '/downloads/' + appId, fields: {} },
          updateMask: { fieldPaths: [] },
          updateTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }],
        }] }),
      }).catch(function () { /* offline or over quota — the download goes on */ });
    };
    dl.addEventListener('click', countDownload);
    /* Middle-click opens a new tab without firing click. */
    dl.addEventListener('auxclick', function (e) { if (e.button === 1) countDownload(); });

    /* The page was built up to a few hours ago; fetch today's count. A plain
       GET with no headers is a simple CORS request, and 404 just means none yet. */
    fetch(api + '/downloads/' + appId + '?mask.fieldPaths=count', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) {
        var f = doc && doc.fields && doc.fields.count;
        if (f) showDownloads(Number(f.integerValue));
      })
      .catch(function () { /* offline — the baked-in count stays */ });
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
    var count = document.getElementById('stars-count');
    var pill = document.getElementById('stars-pill');
    if (typeof d.stars === 'number') {
      if (count) {
        count.textContent = fmtStars(d.stars);
      } else if (pill) {
        /* The page said "New here" — the app has stars now. */
        var use = pill.querySelector('use');
        if (use) use.setAttribute('href', '#i-star-solid');
        var text = pill.lastChild;
        if (text && text.nodeType === 3) text.textContent = '';
        count = document.createElement('span');
        count.id = 'stars-count';
        count.textContent = fmtStars(d.stars);
        pill.appendChild(count);
        pill.appendChild(document.createTextNode('\u00a0GitHub stars'));
      }
    }
    var btn = document.getElementById('download-btn');
    if (btn && d.apkUrl) {
      btn.href = d.apkUrl;
      if (btn.getAttribute('data-kind') === 'fallback') {
        /* The button was pointing at a page; now it is a real file. */
        var label = btn.querySelector('span');
        if (label) label.textContent = 'Download the app';
        var glyph = btn.querySelector('use');
        if (glyph) glyph.setAttribute('href', '#i-download');
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
