/* The site's icon set: one family of 24×24 stroke icons drawn for this
   project, so every glyph shares a stroke weight, corner radius and optical
   size. They ship as an inline SVG sprite (one <symbol> each) at the top of
   every page and are referenced with <use>, which lets client-side code
   (search results, the screenshot viewer) draw the same icons as the build.

   Rules for adding one: keep the drawing inside the 2–22 box, no strokes
   thinner than the shared width (set in CSS, not here), round caps and
   joins, and no fills unless the icon is a "solid" variant. */
'use strict';

const ICONS = {
  /* navigation */
  home: '<path d="M3 11 12 3.5 21 11"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v4a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 3.8"/><path d="M12 17.2h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',

  /* actions */
  download: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M4 20h16"/>',
  share: '<path d="M12 3.5v11"/><path d="m8 7.5 4-4 4 4"/><path d="M5 11.5v7A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-7"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  pencil: '<path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17z"/><path d="m14.5 8 3 3"/>',
  flag: '<path d="M5 21V3.5"/><path d="M5 4h12.5l-2.2 4.5 2.2 4.5H5"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  'arrow-up-right': '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-down': '<path d="m5 9 7 7 7-7"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/>',
  dots: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',

  /* status */
  star: '<path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z"/>',
  'star-solid': '<path fill="currentColor" stroke="none" d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.5l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9z"/>',
  alert: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 9.5v4.5"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/>',
  flask: '<path d="M9 3.5h6"/><path d="M10 3.5v6.2L4.6 19a1.4 1.4 0 0 0 1.3 2h12.2a1.4 1.4 0 0 0 1.3-2L14 9.7V3.5"/><path d="M7.5 15h9"/>',
  archive: '<path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h14a1.5 1.5 0 0 1 1.5 1.5V8H3.5z"/><path d="M5 8v10.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V8"/><path d="M10 12h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  'search-off': '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/><path d="m8.5 8.5 5 5M13.5 8.5l-5 5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  heart: '<path d="M12 20.5s-8-4.8-8-10.4A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 8 2.7c0 5.6-8 10.4-8 10.4z"/>',

  /* the app's own links */
  code: '<path d="m8 8-4.5 4L8 16"/><path d="m16 8 4.5 4L16 16"/><path d="m14 4-4 16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18"/>',
  chat: '<path d="M21 11.8a8.2 8.2 0 0 1-12.2 7.2L3 21l1.6-5.4A8.2 8.2 0 1 1 21 11.8z"/>',
  bug: '<path d="M8 8.5a4 4 0 0 1 8 0"/><path d="M6 12.5V15a6 6 0 0 0 12 0v-2.5a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3z"/><path d="M12 9.5V21"/><path d="M6 13H3M21 13h-3M7 19l-2.5 1.5M17 19l2.5 1.5M8.5 5 7 3M15.5 5 17 3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>',
  scale: '<path d="M12 3.5v17"/><path d="M8 20.5h8"/><path d="M4.5 7.5h15"/><path d="m6.5 7.5-3 7.5a3.2 3.2 0 0 0 6 0l-3-7.5"/><path d="m17.5 7.5-3 7.5a3.2 3.2 0 0 0 6 0l-3-7.5"/>',

  /* categories */
  gamepad: '<path d="M8 6h8a6 6 0 0 1 6 6.4l-.5 4.5a2.6 2.6 0 0 1-4.7 1.3L15 16H9l-1.8 2.2a2.6 2.6 0 0 1-4.7-1.3L2 12.4A6 6 0 0 1 8 6z"/><path d="M7 11h4M9 9v4"/><path d="M15.5 10.5h.01M18 12.5h.01"/>',
  play: '<path d="M7 4.5v15L19.5 12z"/>',
  wrench: '<path d="M20.5 8.1A5 5 0 0 1 13.4 13L6.8 19.6a1.7 1.7 0 0 1-2.4-2.4L11 10.6A5 5 0 0 1 15.9 3.5l.7 3.9z"/>',
  shield: '<path d="M12 3 4.5 5.8v5.4c0 4.5 3.2 8.2 7.5 9.8 4.3-1.6 7.5-5.3 7.5-9.8V5.8z"/><path d="m9 12 2 2 4-4"/>',
  'book-open': '<path d="M12 7c-1.6-1.3-3.7-1.7-6.5-1.7H3v13.2h2.5c2.8 0 4.9.4 6.5 1.7 1.6-1.3 3.7-1.7 6.5-1.7H21V5.3h-2.5C15.7 5.3 13.6 5.7 12 7z"/><path d="M12 7v13.2"/>',
  book: '<path d="M4 5a2.5 2.5 0 0 1 2.5-2.5H20v19H6.5A2.5 2.5 0 0 1 4 19z"/><path d="M4 19a2.5 2.5 0 0 1 2.5-2.5H20"/>',
  'check-square': '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  'map-pin': '<path d="M12 21.5s-7-6-7-11.5a7 7 0 0 1 14 0c0 5.5-7 11.5-7 11.5z"/><circle cx="12" cy="10" r="2.5"/>',
};

/* One <symbol> per icon, hidden; place once near the top of <body>. */
function sprite() {
  /* Hidden by size, not display:none — some engines refuse to draw a <use>
     whose symbol lives in a display:none document fragment. */
  return '<svg class="sprite" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'
    + Object.entries(ICONS).map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`).join('')
    + '</svg>';
}

/* Inline reference. Decorative by default (aria-hidden); pass a label to
   make an icon meaningful on its own (an icon-only button, say). */
function icon(name, { cls = '', label = '' } = {}) {
  if (!ICONS[name]) throw new Error(`icons.js: unknown icon "${name}"`);
  const a11y = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
  return `<svg class="ic${cls ? ' ' + cls : ''}"${a11y}><use href="#i-${name}"/></svg>`;
}

module.exports = { ICONS, sprite, icon };
