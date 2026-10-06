/* Installing the site as an app. Optional like every script here: the site
   works the same without it.
   1. Registers the service worker (/sw.js): pages you have opened keep
      working without internet, and the rest say so kindly.
   2. Browsers that can install a site in one tap (Chrome, Edge, Samsung
      Internet, Brave…) announce it with `beforeinstallprompt`. Only then do
      the install buttons appear: in the header on wide screens, and on the
      Help page. Firefox and Safari install from their own menus, which the
      Help page explains.
   3. On phones, a card above the tab bar offers it once someone has looked
      around (from their second page, never the first). build.js leaves the
      card off app pages, where "Install" would read as the app's own
      Download button, and off the publish form. "Not now" puts it away for
      a month. */
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* blocked, or no https */ });
    });
  }

  /* Already open as the installed app. */
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* Pages opened in this browser, counted only as far as the card cares. */
  var views = Number(read('osps-views')) || 0;
  if (views < 2) save('osps-views', String(++views));

  var MONTH = 30 * 864e5;
  var card = document.getElementById('install-card');
  var buttons = document.querySelectorAll('[data-install]');
  var offer = null;

  function show(on) {
    for (var i = 0; i < buttons.length; i++) buttons[i].hidden = !on;
    if (!on) closeCard();
  }

  function closeCard() {
    if (!card || card.hidden) return;
    var hadFocus = card.contains(document.activeElement);
    card.hidden = true;
    if (hadFocus) {
      var logo = document.querySelector('.site-header .logo');
      if (logo) logo.focus({ preventScroll: true });
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); /* our buttons instead of the browser's own bar */
    offer = e;
    show(true);
    var snoozed = Date.now() - (Number(read('osps-install')) || 0) < MONTH;
    if (card && views >= 2 && !snoozed) card.hidden = false;
  });

  window.addEventListener('appinstalled', function () {
    offer = null;
    show(false);
    toast('Installed. Look for it with your other apps.');
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-install], #install-yes, #install-no');
    if (!el) return;
    if (el.id === 'install-no') {
      save('osps-install', String(Date.now()));
      closeCard();
      return;
    }
    if (!offer) return;
    var o = offer;
    offer = null; /* each offer can be shown once; the next page brings a new one */
    show(false);
    o.prompt();
    o.userChoice.then(function (choice) {
      if (choice.outcome !== 'accepted') save('osps-install', String(Date.now()));
    }, function () { /* the browser withdrew it */ });
  });
})();
