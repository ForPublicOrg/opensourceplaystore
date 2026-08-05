/* Edge fades for horizontal scrollers (strips, chips, screenshots).
   CSS ships a right-edge fade by default (the no-JS state); here we track
   scroll position so the fade only shows where there is more to see:
   .can-scroll-left — content hidden to the left, fade the left edge
   .at-end          — nothing more to the right, unfade the right edge */
(function () {
  'use strict';
  var strips = Array.prototype.slice.call(
    document.querySelectorAll('.feature-strip, .card-strip, .screenshots, .chips')
  );
  if (!strips.length) return;

  function sync(el) {
    /* A strip hidden by search (display:none) measures 0×0 — computing
       state from that would stamp a bogus permanent .at-end. Skip it;
       search.js pings us again when the strip is visible. */
    if (el.clientWidth === 0) return;
    el.classList.toggle('can-scroll-left', el.scrollLeft > 8);
    el.classList.toggle('at-end', el.scrollLeft >= el.scrollWidth - el.clientWidth - 8);
  }

  function syncAll() { strips.forEach(sync); }

  strips.forEach(function (el) {
    el.addEventListener('scroll', function () { sync(el); }, { passive: true });
  });
  syncAll();

  var resizeT = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(syncAll, 150);
  }, { passive: true });

  /* Lets search.js recompute fades after it un-hides sections. */
  window.ospsSyncStrips = syncAll;
})();
