/* Runs in <head> before the page draws, so saved settings apply with no flash. */
(function () {
  try {
    var savedTitle = localStorage.getItem('settings.tabTitle');
    if (savedTitle) document.title = savedTitle;

    var savedFavicon = localStorage.getItem('settings.favicon');
    if (savedFavicon) {
      var link = document.querySelector('link[rel="icon"]');
      if (link) link.href = savedFavicon;
    }

    if (localStorage.getItem('settings.animationsOff') === 'true') {
      document.documentElement.classList.add('no-animations');
    }

    // 'genres' (new) or 'classic' (the old single grid)
    var layout = localStorage.getItem('settings.layout') === 'classic' ? 'classic' : 'genres';
    document.documentElement.setAttribute('data-layout', layout);

    // 'compact' (new) or 'original' header
    var header = localStorage.getItem('settings.header') === 'original' ? 'original' : 'compact';
    document.documentElement.setAttribute('data-header', header);
  } catch (e) {}
})();
