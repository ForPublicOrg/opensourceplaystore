/* Site search. Fetches /search-index.json on first use and ranks results
   client-side — no network per keystroke, no framework.

   One index and one ranker feed two front-ends:
     • the hero/catalog box (#search-input, on / and /apps/) swaps the page
       body for a grid of matches;
     • the compact header box (.nav-search, on every other page) drops a live
       listbox of matches under the input.

   Without JavaScript both are hidden (noscript style in <head>); the
   pre-rendered, paginated catalog remains fully browsable. */
(function () {
  'use strict';
  var heroInput = document.getElementById('search-input');
  var navForm = document.querySelector('.nav-search');
  if (!heroInput && !navForm) return;

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

  function appHref(a) { return '/app/' + encodeURIComponent(a.id) + '/'; }

  /* Type-as-you-search on both front-ends: one shared debounce delay. */
  function onType(el, fn) {
    var timer = null;
    el.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { fn(el.value); }, 120);
    });
  }

  /* ---------------- hero / catalog: results replace the page body ---------------- */

  function heroSearch(input) {
    var box = input.closest('.search-box');
    var clear = box.querySelector('.search-clear');
    var results = document.getElementById('search-results');
    var empty = document.getElementById('search-empty');
    var count = document.getElementById('result-count');
    var hideable = Array.prototype.slice.call(document.querySelectorAll('[data-hide-on-search]'));

    /* Warm the index as soon as the user shows intent. */
    input.addEventListener('focus', load, { once: true });

    /* Build a result card with the same structure/classes as server cards.
       DOM APIs + textContent only — index data never becomes HTML. */
    function card(a, cats) {
      var cat = cats[a.c] || { n: '', e: '', h: 145 };
      var el = document.createElement('a');
      el.className = 'card';
      el.href = appHref(a);
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

    onType(input, apply);
    if (clear) {
      clear.addEventListener('click', function () {
        input.value = '';
        apply('');
        input.focus();
      });
    }

    var params = new URLSearchParams(location.search);
    var q0 = params.get('q');
    if (q0) { input.value = q0; apply(q0); }
    if (params.get('focus') === 'search' || location.hash === '#search') input.focus();
  }

  /* ---------------- header: live listbox under the input ---------------- */

  function navSearch(form) {
    var field = form.querySelector('input[type="search"]');
    var panel = form.querySelector('.nav-results');
    if (!field || !panel) return;
    var NAV_MAX = 8;
    var rows = [];   /* the options currently in the panel, in visual order */
    var active = -1; /* index into rows, or -1 for "nothing highlighted" */
    var seq = 0;
    var holding = false; /* a pointer is down inside the panel — don't close yet */

    field.addEventListener('focus', load, { once: true });

    function close() {
      panel.hidden = true;
      panel.textContent = '';
      rows = [];
      active = -1;
      field.setAttribute('aria-expanded', 'false');
      field.removeAttribute('aria-activedescendant');
    }

    function highlight(i) {
      if (rows[active]) {
        rows[active].removeAttribute('data-active');
        rows[active].setAttribute('aria-selected', 'false');
      }
      active = i;
      if (!rows[i]) { field.removeAttribute('aria-activedescendant'); return; }
      rows[i].setAttribute('data-active', '');
      rows[i].setAttribute('aria-selected', 'true');
      field.setAttribute('aria-activedescendant', rows[i].id);
      if (rows[i].scrollIntoView) rows[i].scrollIntoView({ block: 'nearest' });
    }

    /* Every option is a real link, so clicking, middle-clicking and
       "open in new tab" all behave the way they look like they should. */
    function option(href, i) {
      var el = document.createElement('a');
      el.className = 'nav-result';
      el.id = 'nav-result-' + i;
      el.href = href;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      el.addEventListener('mouseenter', function () { highlight(i); });
      return el;
    }

    function appRow(a, i) {
      var el = option(appHref(a), i);

      var img = document.createElement('img');
      img.src = a.i;
      img.alt = '';
      img.width = 40; img.height = 40;
      img.loading = 'lazy'; img.decoding = 'async';
      el.appendChild(img);

      var text = document.createElement('span');
      text.className = 'nav-result-text';
      var name = document.createElement('span');
      name.className = 'nav-result-name';
      name.textContent = a.n;
      text.appendChild(name);
      var tag = document.createElement('span');
      tag.className = 'nav-result-tag';
      tag.textContent = a.t || '';
      text.appendChild(tag);
      el.appendChild(text);

      if (typeof a.s === 'number') {
        var stars = document.createElement('span');
        stars.className = 'nav-result-stars';
        stars.textContent = '⭐ ' + fmtStars(a.s);
        el.appendChild(stars);
      }
      return el;
    }

    function note(text) {
      var p = document.createElement('p');
      p.className = 'nav-note';
      p.textContent = text;
      return p;
    }

    function render(raw) {
      var q = raw.trim().toLowerCase();
      var my = ++seq;
      if (!q) { close(); return; }

      load().then(function (d) {
        if (my !== seq) return; /* a newer keystroke won */
        panel.textContent = '';
        rows = [];
        active = -1;
        field.removeAttribute('aria-activedescendant');

        if (!d) {
          panel.appendChild(note('Search isn’t working right now.'));
        } else {
          var matches = rank(q, d);
          var shown = matches.slice(0, NAV_MAX);
          for (var i = 0; i < shown.length; i++) {
            var el = appRow(shown[i], i);
            rows.push(el);
            panel.appendChild(el);
          }
          if (!matches.length) {
            panel.appendChild(note('No apps match — try another word.'));
          } else if (matches.length > shown.length) {
            var all = option('/apps/?q=' + encodeURIComponent(q), shown.length);
            all.className = 'nav-result nav-result-all';
            all.textContent = 'See all ' + matches.length + ' matches →';
            rows.push(all);
            panel.appendChild(all);
          }
        }

        panel.scrollTop = 0;
        panel.hidden = false;
        field.setAttribute('aria-expanded', 'true');
      });
    }

    onType(field, render);
    /* Coming back to a box that still has text re-opens what it had. */
    field.addEventListener('focus', function () {
      if (panel.hidden && field.value.trim()) render(field.value);
    });

    field.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (panel.hidden || !rows.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlight((active + 1) % rows.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight(active <= 0 ? rows.length - 1 : active - 1);
      } else if (e.key === 'Enter' && rows[active]) {
        /* Enter on a highlighted app opens it; otherwise the form submits
           to /apps/?q=… and the catalog page takes over. */
        e.preventDefault();
        rows[active].click();
      }
    });

    panel.addEventListener('pointerdown', function () { holding = true; });
    document.addEventListener('pointerup', function () { holding = false; });
    document.addEventListener('pointerdown', function (e) {
      if (!form.contains(e.target)) close();
    });
    /* Tabbing or clicking away closes it — but not while a click on a result
       is still in flight, which would delete the link before it navigates. */
    form.addEventListener('focusout', function () {
      setTimeout(function () {
        if (!holding && !form.contains(document.activeElement)) close();
      }, 0);
    });
  }

  if (heroInput) heroSearch(heroInput);
  if (navForm) navSearch(navForm);

  /* "/" focuses whichever search box this page has. */
  var focusTarget = heroInput || (navForm && navForm.querySelector('input[type="search"]'));
  if (focusTarget) {
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      focusTarget.focus();
    });
  }
})();
