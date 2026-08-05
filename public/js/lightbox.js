/* Screenshot viewer for app detail pages.

   Progressive enhancement only: the markup ships as plain links to the
   images, so with JavaScript off — or in a browser without <dialog> — a tap
   still opens the picture and Back returns to the listing. With JS, the tap
   is intercepted and the picture grows out of the thumbnail into a viewer
   over the page.

   What makes it feel right:
   - the picture flies out of the thumbnail you tapped, and back into the one
     you're looking at when you close (the strip scrolls to match)
   - swiping sideways is native scroll-snap, so it has real momentum
   - dragging the picture down dismisses it, following your finger
   - the enlarged images reuse the thumbnails' URLs, so they come out of the
     browser cache and appear instantly */
(function () {
  'use strict';

  var strip = document.querySelector('.screenshots');
  if (!strip) return;
  if (!window.HTMLDialogElement || !HTMLDialogElement.prototype.showModal) return;

  var links = [].slice.call(strip.querySelectorAll('a'));
  if (!links.length) return;

  var appName = strip.getAttribute('data-lightbox') || '';
  var last = links.length - 1;
  var EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';

  /* Read the motion preference every time rather than once at load, so
     changing it in the OS takes effect without a reload. */
  function calm() {
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function canAnimate() { return !calm() && !!document.body.animate; }

  var dialog = null;
  var track = null;
  var slides = [];
  var dots = [];
  var count = null;
  var prevBtn = null;
  var nextBtn = null;
  var closeBtn = null;
  var chrome = [];
  var index = 0;
  var opener = null;
  var pushed = false;
  var closing = false;
  var programmatic = false;
  var settle = null;
  var lockPad = '';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function button(cls, label, glyph) {
    var b = el('button', 'lightbox-btn ' + cls, glyph);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  }

  function currentImg() {
    return slides[index].firstChild;
  }

  /* ---- build (once, on first open) ---- */

  function build() {
    dialog = el('dialog', 'lightbox');
    dialog.setAttribute('aria-label', appName ? 'Pictures of ' + appName : 'Pictures');
    /* Focus lands on the dialog itself rather than the ✕ button: a screen
       reader announces what just opened, and sighted users don't get a
       focus ring they didn't ask for. Tab still reaches every control. */
    dialog.tabIndex = -1;

    track = el('div', 'lightbox-track');
    links.forEach(function (link, i) {
      var slide = el('div', 'lightbox-slide');
      var img = el('img');
      /* The source is held back rather than set here. `loading="lazy"` is no
         use inside a closed dialog — the browser may not fetch until the
         image is on screen, which is exactly when it is needed — and setting
         src eagerly would pull every full-size picture down on page load.
         hydrate() fills them in around whichever picture you are viewing;
         the URLs match the thumbnails, so they come out of the cache. */
      img.setAttribute('data-src', link.getAttribute('href'));
      img.alt = 'Picture ' + (i + 1) + ' of ' + links.length + (appName ? ' of ' + appName : '');
      img.decoding = 'async';
      img.draggable = false;
      /* A picture that won't load says so, rather than showing a broken
         icon in the middle of an otherwise empty screen. */
      img.addEventListener('error', function () {
        if (slide.querySelector('.lightbox-oops')) return;
        slide.appendChild(el('p', 'lightbox-oops', 'This picture didn’t load.'));
      });
      slide.appendChild(img);
      track.appendChild(slide);
      slides.push(slide);
    });
    dialog.appendChild(track);

    closeBtn = button('lightbox-close', 'Close', '✕');
    closeBtn.addEventListener('click', function () { requestClose(); });
    dialog.appendChild(closeBtn);
    chrome.push(closeBtn);

    /* One control cluster: ‹ Picture 2 of 6 ●●●●● ›. On wide screens CSS lifts the
       arrows out to the edges of the picture; on phones they stay in the bar
       where a thumb can reach them. */
    if (links.length > 1) {
      prevBtn = button('lightbox-prev', 'Previous picture', '‹');
      nextBtn = button('lightbox-next', 'Next picture', '›');
      prevBtn.addEventListener('click', function () { go(index - 1); });
      nextBtn.addEventListener('click', function () { go(index + 1); });

      var bar = el('div', 'lightbox-bar');
      count = el('p', 'lightbox-count');
      count.setAttribute('aria-live', 'polite');

      var dotRow = el('div', 'lightbox-dots');
      links.forEach(function (link, i) {
        var dot = button('lightbox-dot', 'Picture ' + (i + 1), '');
        dot.addEventListener('click', function () { go(i); });
        dotRow.appendChild(dot);
        dots.push(dot);
      });
      bar.appendChild(count);
      bar.appendChild(dotRow);

      /* The arrows sit beside the glass pill rather than inside it: a
         backdrop-filter would make the pill the containing block, and the
         wide-screen layout needs them fixed to the viewport edges. */
      var controls = el('div', 'lightbox-controls');
      controls.appendChild(prevBtn);
      controls.appendChild(bar);
      controls.appendChild(nextBtn);
      dialog.appendChild(controls);
      chrome.push(controls);
    }

    document.body.appendChild(dialog);

    /* Escape arrives as `cancel`; route it through the same path as ✕ so the
       history entry we pushed is always the one that gets popped. */
    dialog.addEventListener('cancel', function (e) {
      e.preventDefault();
      requestClose();
    });

    /* Tapping the space around a picture closes it, as photo viewers do. */
    track.addEventListener('click', function (e) {
      if (e.target === track || e.target.classList.contains('lightbox-slide')) requestClose();
    });

    dialog.addEventListener('keydown', function (e) {
      if (links.length < 2) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(last); }
    });

    /* Swiping scrolls the track natively; keep the chrome in step. */
    var tick = null;
    track.addEventListener('scroll', function () {
      if (programmatic || tick) return;
      tick = setTimeout(function () {
        tick = null;
        if (programmatic) return;
        var at = Math.round(track.scrollLeft / track.clientWidth);
        if (at !== index && at >= 0 && at <= last) { index = at; draw(); }
      }, 70);
    }, { passive: true });

    /* Rotating the phone changes the slide width, which would otherwise
       leave the track parked between two pictures. */
    var resized = null;
    window.addEventListener('resize', function () {
      if (!dialog.open) return;
      clearTimeout(resized);
      resized = setTimeout(function () {
        programmatic = true;
        track.scrollTo({ left: track.clientWidth * index, behavior: 'auto' });
        setTimeout(function () { programmatic = false; }, 60);
      }, 150);
    });

    dialog.addEventListener('close', cleanUp);
    dragToDismiss();
  }

  /* Load the picture you're on plus its neighbours, so a swipe either way
     lands on something already there. */
  function hydrate(i) {
    [i - 1, i, i + 1].forEach(function (j) {
      var at = j < 0 ? last : j > last ? 0 : j;
      var img = slides[at].firstChild;
      var src = img.getAttribute('data-src');
      if (src) { img.removeAttribute('data-src'); img.src = src; }
    });
  }

  function draw() {
    /* Only once the viewer is actually open — otherwise building it on page
       load would start pulling pictures nobody has asked to see. */
    if (dialog.open) hydrate(index);
    if (!count) return;
    count.textContent = 'Picture ' + (index + 1) + ' of ' + links.length;
    dots.forEach(function (dot, i) {
      dot.classList.toggle('is-current', i === index);
      dot.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
  }

  /* Moving past either end wraps around. Nothing is ever disabled: a button
     that switches to disabled while it holds focus drops the keyboard user
     back to the page body, and a dead end is a dead end. */
  function go(to) {
    var wrapped = to < 0 ? last : to > last ? 0 : to;
    if (wrapped === index) return;
    var jump = wrapped !== to || Math.abs(wrapped - index) > 1;
    index = wrapped;
    /* While we scroll on purpose, ignore what the scroll listener infers —
       mid-flight positions would otherwise clobber the index and make five
       fast taps land one picture along. */
    programmatic = true;
    clearTimeout(settle);
    settle = setTimeout(function () {
      programmatic = false;
      /* Smooth scrolling is animation-driven, and animations don't always
         run (throttled tabs, some webviews). If we never arrived, jump —
         the picture on screen must always match the counter. */
      if (Math.round(track.scrollLeft / track.clientWidth) !== index) {
        track.scrollLeft = track.clientWidth * index;
      }
    }, 420);
    track.scrollTo({
      left: track.clientWidth * wrapped,
      behavior: (calm() || jump) ? 'auto' : 'smooth',
    });
    draw();
  }

  /* ---- the flight between thumbnail and viewer ---- */

  /* Transform that would place `img` exactly over `rect`. Screenshots keep
     their aspect ratio, so a single scale factor is honest. */
  function flightFrom(img, rect) {
    var to = img.getBoundingClientRect();
    if (!to.width || !rect.width) return null;
    var scale = rect.width / to.width;
    var dx = (rect.left + rect.width / 2) - (to.left + to.width / 2);
    var dy = (rect.top + rect.height / 2) - (to.top + to.height / 2);
    return 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
  }

  function fadeChrome(from, to, delay) {
    chrome.forEach(function (node) {
      node.animate([{ opacity: from }, { opacity: to }], {
        duration: 200, delay: delay || 0, easing: 'ease-out', fill: 'backwards',
      });
    });
  }

  function open(i) {
    if (!dialog) build();
    if (closing) return;
    opener = links[i];
    index = i;
    dialog.showModal();
    /* clientWidth only means anything once the dialog is displayed. */
    track.scrollLeft = track.clientWidth * i;
    draw();
    /* Hiding the page's scrollbar would otherwise shift the layout behind
       the viewer by its width, which is visible for the moment the scrim
       fades in. */
    var gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) {
      lockPad = document.body.style.paddingRight;
      document.body.style.paddingRight = gap + 'px';
    }
    document.documentElement.classList.add('lightbox-open');
    dialog.focus({ preventScroll: true });

    if (canAnimate()) {
      var from = flightFrom(currentImg(), links[i].getBoundingClientRect());
      if (from) {
        var lift = currentImg().animate([{ transform: from }, { transform: 'none' }], {
          duration: 340, easing: EASE,
        });
        /* A running animation paints its first keyframe — thumbnail-sized —
           so if the timeline is throttled and never advances, the picture
           would sit there tiny. Cancelling after its due time drops the
           effect and leaves the real layout, animated or not. */
        setTimeout(function () { try { lift.cancel(); } catch (err) { /* over already */ } }, 400);
        fadeChrome(0, 1, 120);
      }
    }

    try {
      history.pushState({ osps: 'lightbox' }, '');
      pushed = true;
    } catch (e) { pushed = false; }
  }

  /* Closing always goes through history when we pushed an entry, so the
     stack never keeps a dead state behind the user. */
  function requestClose() {
    if (closing) return;
    if (pushed) history.back();
    else finish();
  }

  /* Fly back into whichever thumbnail the viewer is showing now, bringing
     the strip along so you land where you left off. */
  function finish() {
    if (!dialog.open) return;
    /* Bring the strip to the picture you're on, so the viewer collapses back
       into a thumbnail you can actually see. */
    var target = links[index];
    if (target !== opener) {
      target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    }
    if (!canAnimate()) { closeNow(); return; }

    var img = currentImg();
    var to = flightFrom(img, target.getBoundingClientRect());
    if (!to) { closeNow(); return; }

    closing = true;
    fadeChrome(1, 0, 0);
    var flight = img.animate(
      [{ transform: img.style.transform || 'none', opacity: 1 }, { transform: to, opacity: 0.9 }],
      { duration: 260, easing: EASE }
    );
    dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in' });

    /* Closing must never depend on the animation reporting back: a throttled
       or paused timeline (background tab, some embedded webviews) would
       otherwise leave the viewer stuck open over the page. Whichever comes
       first — the flight ending or the timer — closes it, exactly once. */
    var landed = false;
    function land() {
      if (landed) return;
      landed = true;
      closing = false;
      img.style.transform = '';
      closeNow();
    }
    flight.onfinish = flight.oncancel = land;
    setTimeout(land, 320);
  }

  /* Closing the page's scroll lock and handing focus back are not optional,
     so they never wait on the `close` event — not every browser fires it.
     Safe to run twice. */
  function closeNow() {
    if (dialog.open) dialog.close();
    cleanUp();
  }

  function cleanUp() {
    document.documentElement.classList.remove('lightbox-open');
    document.body.style.paddingRight = lockPad;
    lockPad = '';
    dialog.style.background = '';
    slides.forEach(function (s) { s.firstChild.style.transform = ''; });
    /* Focus follows the eye: it lands on the screenshot you were looking at,
       which is the one the strip has just scrolled to — not necessarily the
       one you opened. */
    if (opener) { links[index].focus({ preventScroll: true }); opener = null; }
  }

  /* ---- drag the picture away to dismiss ---- */

  function dragToDismiss() {
    var startX = 0, startY = 0, dy = 0, dragging = false, decided = false, id = null;
    var touching = 0;

    function abort() {
      dragging = false;
      decided = false;
      dialog.style.background = '';
      currentImg().style.transform = '';
    }

    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') touching++;
      /* A second finger means a pinch, not a drag: hand the gesture back to
         the browser so zooming still works. */
      if (touching > 1) { abort(); return; }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (closing) return;
      id = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dy = 0;
      dragging = true;
      decided = false;
    });

    track.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== id) return;
      var mx = e.clientX - startX;
      var my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) { dragging = false; return; } // sideways: let the track scroll
        if (Math.abs(my) < 8) return;
        decided = true;
        /* Throws if the pointer is already gone; the drag still works. */
        try { track.setPointerCapture(id); } catch (err) { /* fine */ }
      }
      dy = my;
      var img = currentImg();
      var shrink = Math.max(0.82, 1 - Math.abs(dy) / 1400);
      img.style.transform = 'translateY(' + dy + 'px) scale(' + shrink + ')';
      /* The scrim thins as the picture leaves, so the page reappears behind. */
      dialog.style.background = 'rgba(8, 14, 11, ' + Math.max(0, 0.82 - Math.abs(dy) / 500) + ')';
    });

    function release(e) {
      if (e.pointerType === 'touch') touching = Math.max(0, touching - 1);
      if (!dragging || (id !== null && e.pointerId !== id)) return;
      dragging = false;
      if (!decided) return;
      decided = false;
      var img = currentImg();
      if (Math.abs(dy) > 110) { requestClose(); return; }
      dialog.style.background = '';
      if (canAnimate()) {
        img.animate([{ transform: img.style.transform }, { transform: 'none' }],
          { duration: 260, easing: EASE });
      }
      img.style.transform = '';
    }

    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
  }

  window.addEventListener('popstate', function () {
    pushed = false;
    if (dialog && dialog.open) finish();
  });

  links.forEach(function (link, i) {
    link.addEventListener('click', function (e) {
      /* Leave modified clicks alone — people open images in new tabs. */
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      open(i);
    });
  });

  /* Built now rather than on first tap: the counter is a live region, and a
     live region that appears at the very moment its text changes goes
     unannounced in most screen readers. If anything here throws, the links
     are still ordinary links to the pictures. */
  try {
    build();
    draw();
  } catch (err) { /* the plain links keep working */ }
})();
