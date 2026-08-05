/* Instant search on the home page. Filters the pre-rendered cards — no network. */
(function () {
  'use strict';
  var input = document.getElementById('search-input');
  if (!input) return;
  var box = input.closest('.search-box');
  var clear = box.querySelector('.search-clear');
  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-search]'));
  var empty = document.getElementById('search-empty');
  var count = document.getElementById('result-count');

  var staticSections = Array.prototype.slice.call(document.querySelectorAll('[data-hide-on-search]'));

  function apply(q) {
    q = q.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      var hit = !q || card.getAttribute('data-search').indexOf(q) !== -1;
      card.hidden = !hit;
      if (hit) shown++;
    });
    staticSections.forEach(function (el) { el.hidden = !!q; });
    if (empty) empty.hidden = !q || shown !== 0;
    if (count) {
      count.textContent = q ? shown + (shown === 1 ? ' app found' : ' apps found') : '';
    }
    box.classList.toggle('has-text', q.length > 0);
    var url = q ? '?q=' + encodeURIComponent(q) : location.pathname;
    try { history.replaceState(null, '', url); } catch (e) { /* file:// preview */ }
  }

  input.addEventListener('input', function () { apply(input.value); });
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
})();

/* Horizontal strips (Popular / Trending / Recently added) always fade their
   right edge in CSS. The left edge only fades in once a strip has actually
   been scrolled — otherwise the first card would look dimmed from the start. */
(function () {
  'use strict';
  var strips = document.querySelectorAll('.feature-strip, .card-strip');
  Array.prototype.forEach.call(strips, function (el) {
    function sync() { el.classList.toggle('can-scroll-left', el.scrollLeft > 8); }
    el.addEventListener('scroll', sync, { passive: true });
    sync();
  });
})();
