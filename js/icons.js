/* =====================================================================
   Built-in icons (no external icon font needed).
   Any <i class="fa-solid fa-NAME"> on the page is swapped for the SVG below
   automatically, and window.Icon('name') returns the SVG markup.
   To add one: add NAME: '<svg inner markup>' (24×24 grid, drawn with lines).
   ===================================================================== */
(function () {
  const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const P = d => `<path d="${d}"/>`;
  const ICONS = {
    // ---- interface ----
    'magnifying-glass': C(11, 11, 7) + P('M16.5 16.5L21 21'),
    'list': P('M9 6h12M9 12h12M9 18h12') + P('M4 6h.01M4 12h.01M4 18h.01'),
    'arrow-up-right-from-square': P('M14 4h6v6M20 4l-9 9') + P('M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
    'chevron-right': P('M9 6l6 6-6 6'),
    'chevron-left': P('M15 6l-6 6 6 6'),
    'border-all': '<rect x="4" y="4" width="16" height="16" rx="2"/>' + P('M12 4v16M4 12h16'),
    'clock-rotate-left': P('M3.5 12a8.5 8.5 0 1 0 2.5-6') + P('M3 4v5h5') + P('M12 8v4l3 2'),
    'user': C(12, 8, 4) + P('M4 21a8 8 0 0 1 16 0'),
    'user-group': C(9, 8, 3.5) + P('M2.5 20a6.5 6.5 0 0 1 13 0') + C(17, 9, 2.5) + P('M16 14.3a5 5 0 0 1 6 4.7'),
    'user-plus': C(10, 8, 4) + P('M2 21a8 8 0 0 1 12.5-6.6') + P('M19 14v6M16 17h6'),
    'right-from-bracket': P('M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4') + P('M15 8l4 4-4 4M9 12h10'),
    'pen': P('M4 20l1-4L16 5l3 3L8 19z') + P('M14 7l3 3'),
    'id-badge': '<rect x="5" y="3" width="14" height="18" rx="2"/>' + C(12, 10, 2.5) + P('M8.5 17a3.5 3.5 0 0 1 7 0'),
    'crown': P('M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z'),
    'comments': P('M4 4h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z') + P('M19 9h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-3a2 2 0 0 1-2-1.5'),
    'comment': P('M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'),
    'trash': P('M4 7h16M9 7V4h6v3') + P('M6 7l1 13h10l1-13') + P('M10 11v5M14 11v5'),
    'paper-plane': P('M21.5 2.5L11 13') + P('M21.5 2.5l-6.5 19-4-8.5-8.5-4z'),
    'image': '<rect x="3" y="4" width="18" height="16" rx="2"/>' + C(9, 10, 2) + P('M21 16l-5-5-9 9'),
    'flag': P('M5 21V4') + P('M5 4h12l-2 4 2 4H5'),
    'circle-info': C(12, 12, 9) + P('M12 11v6M12 7.5v.5'),
    'globe': C(12, 12, 9) + P('M3 12h18') + P('M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18'),
    'compress': P('M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'),
    'expand': P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
    'volume-high': P('M4 9h4l5-4v14l-5-4H4z') + P('M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11'),
    'volume-xmark': P('M4 9h4l5-4v14l-5-4H4z') + P('M17 9.5l5 5M22 9.5l-5 5'),
    'xmark': P('M6 6l12 12M18 6L6 18'),
    'grip': C(9, 7, 0.6) + C(15, 7, 0.6) + C(9, 12, 0.6) + C(15, 12, 0.6) + C(9, 17, 0.6) + C(15, 17, 0.6),
    // ---- genres ----
    'bolt': P('M13 2L4 14h7l-1 8 9-12h-7z'),
    'person-running': C(15, 4.5, 2) + P('M10 21l2.5-6-3-3 2.5-4.5 3 3h3.5') + P('M9.5 12.5L6 13l-2 2.5') + P('M14.5 15l3.5 1.5 1 3.5'),
    'compass': C(12, 12, 9) + P('M15.5 8.5l-2 5-5 2 2-5z'),
    'hat-wizard': P('M3 20h18') + P('M5.5 20L11 4l2 7 2-1 3.5 10') + P('M9 15h6'),
    'flag-checkered': P('M5 21V4') + P('M5 4h14v9H5') + P('M9.5 4v9M14 4v9M5 8.5h14'),
    'basketball': C(12, 12, 9) + P('M3 12h18M12 3v18') + P('M5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8'),
    'puzzle-piece': P('M4 7h3.5a2 2 0 1 1 4 0H15v3.5a2 2 0 1 1 0 4V18h-3.5a2 2 0 1 0-4 0H4v-3.5a2 2 0 1 0 0-4z'),
    'gamepad': P('M7 7h10a5 5 0 0 1 5 5v1a3.5 3.5 0 0 1-6.3 2.1L14.5 14h-5l-1.2 1.1A3.5 3.5 0 0 1 2 13v-1a5 5 0 0 1 5-5z') + P('M7.5 9.5v3.5M5.75 11.25h3.5') + C(16, 10.5, 0.6) + C(18, 12.5, 0.6),
    'mug-hot': P('M4 10h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z') + P('M16 11.5h1.5a2.5 2.5 0 0 1 0 5H16') + P('M8 3c-1 1.5 1 2 0 4M12 3c-1 1.5 1 2 0 4'),
    'crosshairs': C(12, 12, 7) + P('M12 2v5M12 17v5M2 12h5M17 12h5'),
    'hand-fist': P('M7 11V7a1.5 1.5 0 0 1 3 0v3M10 10V6a1.5 1.5 0 0 1 3 0v4M13 10V7a1.5 1.5 0 0 1 3 0v4') + P('M16 11a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-1.5A2.5 2.5 0 0 1 7.5 11H10'),
    'ghost': P('M5 21V10a7 7 0 0 1 14 0v11l-2.3-1.8L14.3 21 12 19.2 9.7 21l-2.4-1.8z') + C(9.5, 10, 0.7) + C(14.5, 10, 0.7),
    'chess-knight': P('M6 21h12') + P('M8 21l1-5c-2.5-1-3.5-3.5-1.5-6L12 4.5l1 2c3.5 1 5.5 4.5 4.5 9.5L17 21') + C(11.5, 9, 0.6),
    'store': P('M4 10v10h16V10') + P('M3 7l2-4h14l2 4c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3S3 8.7 3 7z') + P('M10 20v-5h4v5'),
    'hourglass-half': P('M6 3h12M6 21h12') + P('M7 3c0 5.5 5 6 5 9s-5 3.5-5 9M17 3c0 5.5-5 6-5 9s5 3.5 5 9') + P('M9 18h6'),
    'cubes': '<rect x="3.5" y="12.5" width="7.5" height="7.5" rx="1"/><rect x="13" y="12.5" width="7.5" height="7.5" rx="1"/><rect x="8.25" y="4" width="7.5" height="7.5" rx="1"/>',
    'music': P('M9 18V5l11-2v13') + C(6.5, 18, 2.5) + C(17.5, 16, 2.5),
    'floppy-disk': P('M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z') + P('M8 3v5h7V3M7 21v-7h10v7')
  };

  function svg(name) {
    const inner = ICONS[name];
    if (!inner) return '';
    return '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  function upgrade(el) {
    if (el.dataset.ico) return;
    const name = [...el.classList].find(c => c.startsWith('fa-') && c !== 'fa-solid' && c !== 'fa-regular');
    if (!name) return;
    const markup = svg(name.slice(3));
    if (!markup) return;
    el.dataset.ico = '1';
    el.classList.add('ico');
    el.innerHTML = markup;
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('i[class*="fa-"]')) upgrade(root);
    root.querySelectorAll && root.querySelectorAll('i[class*="fa-"]').forEach(upgrade);
  }

  new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) scan(n);
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => scan(document.body));

  window.Icon = svg;
})();
