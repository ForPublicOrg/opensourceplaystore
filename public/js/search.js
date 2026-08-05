/* Site search (home + /apps/). Fetches /search-index.json on first use and
   renders ranked results client-side — no network per keystroke, no framework.
   Without JavaScript the search box is hidden (noscript style in <head>);
   the pre-rendered, paginated catalog remains fully browsable. */
(function () {
  'use strict';
  var input = document.getElementById('search-input');
  if (!input) return;
  var box = input.closest('.search-box');
  var clear = box.querySelector('.search-clear');
  var results = document.getElementById('search-results');
  var empty = document.getElementById('search-empty');
  var count = document.getElementById('result-count');
  var hideable = Array.prototype.slice.call(document.querySelectorAll('[data-hide-on-search]'));
  var MAX = 60;

  var index = null;
  var loading = null;
  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch('/search-index.json')
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { index = d; return d; })
        .catch(function () { loading = null; return null; });
    }
    return loading;
  }
  /* Warm the index as soon as the user shows intent. */
  input.addEventListener('focus', load, { once: true });

  function fmtStars(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  /* Lower score = better. Name prefix > name > tags/owner/category > tagline >
     all words present somewhere. Ties break toward more GitHub stars. */
  function rank(q, d) {
    var out = [];
    var words = q.split(/\s+/);
    for (var i = 0; i < d.apps.length; i++) {
      var a = d.apps[i];
      var n = a.n.toLowerCase();
      var t = (a.t || '').toLowerCase();
      var g = (a.g || '').toLowerCase();
      var o = (a.o || '').toLowerCase();
      var cn = d.cats[a.c] ? d.cats[a.c].n.toLowerCase() : '';
      var score = -1;
      if (n.slice(0, q.length) === q) score = 0;
      else if (n.indexOf(q) !== -1) score = 1;
      else if (g.indexOf(q) !== -1 || o.indexOf(q) !== -1 || cn.indexOf(q) !== -1) score = 2;
      else if (t.indexOf(q) !== -1) score = 3;
      else if (words.length > 1) {
        var hay = n + ' ' + t + ' ' + g + ' ' + o + ' ' + cn;
        var all = true;
        for (var w = 0; w < words.length; w++) {
          if (hay.indexOf(words[w]) === -1) { all = false; break; }
        }
        if (all) score = 4;
      }
      if (score >= 0) out.push([score, a.s || 0, a]);
    }
    out.sort(function (x, y) { return x[0] - y[0] || y[1] - x[1]; });
    return out.map(function (x) { return x[2]; });
  }

  /* Build a result card with the same structure/classes as server cards.
     DOM APIs + textContent only — index data never becomes HTML. */
  function card(a, cats) {
    var cat = cats[a.c] || { n: '', e: '', h: 145 };
    var el = document.createElement('a');
    el.className = 'card';
    el.href = '/app/' + encodeURIComponent(a.id) + '/';
    el.style.setProperty('--cat', cat.h);

    var img = document.createElement('img');
    img.className = 'card-icon';
    img.src = a.i;
    img.alt = '';
    img.width = 72; img.height = 72;
    img.loading = 'lazy'; img.decoding = 'async';
    el.appendChild(img);

    var name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = a.n;
    el.appendChild(name);

    var tag = document.createElement('span');
    tag.className = 'card-tagline';
    tag.textContent = a.t || '';
    el.appendChild(tag);

    var meta = document.createElement('span');
    meta.className = 'card-meta';
    var pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = typeof a.s === 'number' ? '⭐ ' + fmtStars(a.s) : '🆕 New';
    meta.appendChild(pill);
    if (a.x) {
      var tp = document.createElement('span');
      tp.className = 'pill warn';
      tp.textContent = '🧪 Testing';
      meta.appendChild(tp);
    }
    var ct = document.createElement('span');
    ct.className = 'cat-tag';
    ct.textContent = cat.e + ' ' + cat.n;
    meta.appendChild(ct);
    el.appendChild(meta);
    return el;
  }

  var seq = 0;
  function apply(raw) {
    var q = raw.trim().toLowerCase();
    var my = ++seq;
    box.classList.toggle('has-text', raw.length > 0);
    hideable.forEach(function (el) { el.hidden = !!q; });
    try {
      history.replaceState(null, '', q ? '?q=' + encodeURIComponent(q) : location.pathname);
    } catch (e) { /* file:// preview */ }

    if (!q) {
      if (results) { results.hidden = true; results.textContent = ''; }
      if (empty) empty.hidden = true;
      if (count) count.textContent = '';
      /* Strips were display:none while searching — recompute their fades. */
      if (window.ospsSyncStrips) window.ospsSyncStrips();
      return;
    }

    load().then(function (d) {
      if (my !== seq) return; /* a newer keystroke won */
      if (!d) {
        if (count) count.textContent = 'Search isn’t working right now — try the categories below.';
        hideable.forEach(function (el) { el.hidden = false; });
        return;
      }
      var matches = rank(q, d);
      var shown = matches.slice(0, MAX);
      results.textContent = '';
      for (var i = 0; i < shown.length; i++) results.appendChild(card(shown[i], d.cats));
      results.hidden = shown.length === 0;
      if (empty) empty.hidden = shown.length !== 0;
      if (count) {
        /* Always say something — the aria-live region must announce
           the no-results case too, not just leave silence. */
        count.textContent = matches.length === 0 ? 'No apps match'
          : matches.length === 1 ? '1 app found'
            : matches.length > MAX ? matches.length + ' apps found — showing the top ' + MAX
              : matches.length + ' apps found';
      }
    });
  }

  var debounce = null;
  input.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { apply(input.value); }, 120);
  });
  if (clear) {
    clear.addEventListener('click', function () {
      input.value = '';
      apply('');
      input.focus();
    });
  }

  /* "/" focuses search from anywhere on the page. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    input.focus();
  });

  var params = new URLSearchParams(location.search);
  var q0 = params.get('q');
  if (q0) { input.value = q0; apply(q0); }
  if (params.get('focus') === 'search' || location.hash === '#search') input.focus();
})();
