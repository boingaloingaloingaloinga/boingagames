/* Settings menu (gear, top-right). */
document.addEventListener('DOMContentLoaded', function () {
  const gearBtn = document.getElementById('settingsGearBtn');
  const overlay = document.getElementById('settingsOverlay');
  const closeBtn = document.getElementById('settingsCloseBtn');
  const animToggle = document.getElementById('settingsAnimToggle');
  const titleInput = document.getElementById('settingsTitleInput');
  const faviconInput = document.getElementById('settingsFaviconInput');
  const layoutBtns = document.querySelectorAll('#settingsLayout button');

  // Reflect whatever was already applied (by js/early.js) in the UI
  animToggle.checked = localStorage.getItem('settings.animationsOff') === 'true';
  titleInput.value = localStorage.getItem('settings.tabTitle') || document.title;

  function openSettings() {
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeSettings() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  gearBtn.addEventListener('click', openSettings);
  closeBtn.addEventListener('click', closeSettings);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeSettings();
  });

  animToggle.addEventListener('change', function () {
    localStorage.setItem('settings.animationsOff', animToggle.checked);
    document.documentElement.classList.toggle('no-animations', animToggle.checked);
  });

  titleInput.addEventListener('input', function () {
    const val = titleInput.value.trim() || 'BoingaGames';
    document.title = val;
    localStorage.setItem('settings.tabTitle', val);
  });

  faviconInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      const dataUrl = ev.target.result;
      const link = document.querySelector('link[rel="icon"]');
      if (link) link.href = dataUrl;
      localStorage.setItem('settings.favicon', dataUrl);
    };
    reader.readAsDataURL(file);
  });

  // Game layout: new genre view or the classic single grid
  function showLayout() {
    const current = document.documentElement.getAttribute('data-layout');
    layoutBtns.forEach(b => b.classList.toggle('active', b.dataset.layout === current));
  }
  layoutBtns.forEach(b => b.addEventListener('click', function () {
    localStorage.setItem('settings.layout', b.dataset.layout);
    document.documentElement.setAttribute('data-layout', b.dataset.layout);
    document.dispatchEvent(new CustomEvent('boinga:layout'));
    showLayout();
  }));
  showLayout();
});
