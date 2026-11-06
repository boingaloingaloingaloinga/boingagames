/* Themes (incl. limited-time Halloween). applyTheme(name) is global so secret codes can use it. */
const themesSection = document.getElementById('themes');
const toggleThemesBtn = document.getElementById('toggle-themes-btn');
const backgroundUpload = document.getElementById('background-upload');
const xpWindow = document.getElementById('xp-window');

/* ---------- Halloween (limited-time) ---------- */
const HALLOWEEN_UNLOCKED_KEY = 'halloween.unlocked';
const HALLOWEEN_AUTO_YEAR_KEY = 'halloween.autoYear';
const halloweenBtn = document.getElementById('halloween-theme-btn');
const HALLOWEEN_QUOTE = '"BOOingaloingaloingaloinga.."';
let playHalloweenIntro = false; // set to true right before applyTheme('halloween') to play the lightning

function isHalloweenWindow(date) {
  return date.getMonth() === 9 && (date.getDate() === 30 || date.getDate() === 31);
}

function showHalloweenButton() {
  halloweenBtn.hidden = false;
  const mh = themesSection.style.maxHeight;
  if (mh && mh !== '0px') themesSection.style.maxHeight = themesSection.scrollHeight + 'px';
}

function playLightning() {
  // Skip if animations are off in Settings, or the OS asks for reduced motion
  if (document.documentElement.classList.contains('no-animations')) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const w = window.innerWidth, h = window.innerHeight;

  // Build a jagged bolt from the top of the screen
  let x = w * (0.2 + Math.random() * 0.6), y = 0;
  const pts = [[x, y]];
  while (y < h * 0.75) {
    y += 25 + Math.random() * 45;
    x += (Math.random() - 0.5) * 90;
    pts.push([x, y]);
  }
  const toStr = (arr) => arr.map(p => p[0].toFixed(0) + ',' + p[1].toFixed(0)).join(' ');

  // One fork branching off the middle of the bolt
  const forkStart = pts[Math.floor(pts.length / 2)];
  const dir = Math.random() < 0.5 ? -1 : 1;
  const branch = [forkStart];
  let bx = forkStart[0], by = forkStart[1];
  for (let i = 0; i < 5; i++) {
    by += 20 + Math.random() * 30;
    bx += dir * (15 + Math.random() * 35);
    branch.push([bx, by]);
  }

  const el = document.createElement('div');
  el.className = 'hw-lightning';
  el.innerHTML =
    '<div class="hw-flash"></div>' +
    '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<polyline class="hw-bolt" points="' + toStr(pts) + '"/>' +
    '<polyline class="hw-bolt hw-bolt-branch" points="' + toStr(branch) + '"/>' +
    '</svg>';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

function startHalloween() {
  const intro = playHalloweenIntro;
  playHalloweenIntro = false;

  document.body.classList.add('halloween');

  // Load the spooky title font only when needed
  if (!document.getElementById('halloween-font')) {
    const l = document.createElement('link');
    l.id = 'halloween-font';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Creepster&display=swap';
    document.head.appendChild(l);
  }

  const quote = document.querySelector('p.quote');
  if (quote) {
    if (!quote.dataset.orig) quote.dataset.orig = quote.textContent;
    quote.textContent = HALLOWEEN_QUOTE;
  }

  if (!document.getElementById('halloweenFX')) {
    const web = (cls) =>
      '<svg class="hw-web ' + cls + '" viewBox="0 0 120 120" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1">' +
      '<path d="M0 0 L120 0 M0 0 L110 55 M0 0 L85 85 M0 0 L55 110 M0 0 L0 120"/>' +
      '<path d="M30 0 Q13 13 0 30 M60 0 Q27 27 0 60 M90 0 Q40 40 0 90 M120 0 Q54 54 0 120"/></svg>';

    const fx = document.createElement('div');
    fx.id = 'halloweenFX';
    fx.innerHTML =
      '<div class="hw-fog"></div><div class="hw-vignette"></div>' +
      web('hw-web-tl') + web('hw-web-tr') +
      '<div class="hw-spider"><span class="hw-thread"></span><span class="hw-bug">🕷️</span></div>';
    document.body.appendChild(fx);
  }

  if (intro) playLightning();
}

function clearHalloween() {
  document.body.classList.remove('halloween');
  const fx = document.getElementById('halloweenFX');
  if (fx) fx.remove();
  const quote = document.querySelector('p.quote');
  if (quote && quote.dataset.orig) quote.textContent = quote.dataset.orig;
}

function checkHalloween() {
  const now = new Date();
  if (!isHalloweenWindow(now)) return;
  const year = String(now.getFullYear());
  try {
    localStorage.setItem(HALLOWEEN_UNLOCKED_KEY, 'true');   // permanent unlock
    showHalloweenButton();
    if (localStorage.getItem(HALLOWEEN_AUTO_YEAR_KEY) !== year) {
      localStorage.setItem(HALLOWEEN_AUTO_YEAR_KEY, year); // only auto-activate once per year
      localStorage.setItem('selectedTheme', 'halloween');
      playHalloweenIntro = true;                           // lightning on auto-activation
      applyTheme('halloween');
    }
  } catch (e) {}
}

toggleThemesBtn.addEventListener('click', () => {
  if (themesSection.style.maxHeight === '0px' || themesSection.style.maxHeight === '') {
    themesSection.style.maxHeight = themesSection.scrollHeight + 'px';
    toggleThemesBtn.textContent = '-';
  } else {
    themesSection.style.maxHeight = '0';
    toggleThemesBtn.textContent = '+';
  }
});

function applyTheme(theme) {
  // Reset properties that individual themes might set, so switching
  // away from "space" (transparent + background-clip: text) or a
  // fixed image background doesn't leak into the next theme.
  document.body.style.backgroundSize = '';
  document.body.style.backgroundAttachment = '';
  document.body.style.backgroundClip = '';
  document.body.style.webkitBackgroundClip = '';
  xpWindow.style.display = 'none';
  clearHalloween();

  switch (theme) {
    case 'default':
      document.body.style.background = 'linear-gradient(to right, #1e1e2f, #3a3b5b)';
      document.body.style.color = '#ffcc00';
      break;
    case 'blossom':
      document.body.style.background = 'linear-gradient(to right, #ffafcc, #ffcad4)';
      document.body.style.color = '#880e4f';
      break;
    case 'iridium':
      document.body.style.background = 'linear-gradient(to right, #333, #666)';
      document.body.style.color = '#ddd';
      break;
    case 'sunset':
      document.body.style.background = 'linear-gradient(to right, #ff7e5f, #feb47b)';
      document.body.style.color = '#4b2e05';
      break;
    case 'forest':
      document.body.style.background = 'linear-gradient(to right, #228B22, #014421)';
      document.body.style.color = '#90EE90';
      break;
    case 'ocean':
      document.body.style.background = 'linear-gradient(to right, #064273, #76b6c4)';
      document.body.style.color = '#e6f6fb';
      break;
    case 'volcano':
      document.body.style.background = 'linear-gradient(to right, #823661, #4E2728)';
      document.body.style.color = '#1da2d8';
      break;
    case 'cotton':
      document.body.style.background = 'linear-gradient(to right, #E9B7CE, #D3F3F1)';
      document.body.style.color = '#DCD9E2';
      break;
    case 'flame':
      document.body.style.background = 'linear-gradient(to right, #e9d022, #e60b09)';
      document.body.style.color = '#e60b09';
      break;
    case 'meadow':
      document.body.style.background = 'linear-gradient(to right, #56AB2F, #A8E063)';
      document.body.style.color = '#56AB2F';
      break;
    case 'aurora':
      document.body.style.background = 'linear-gradient(to right, #2E1A47, #16A085)';
      document.body.style.color = '#2E1A47';
      break;
    case 'yinyang':
      document.body.style.background = 'linear-gradient(to right, #E6DADA, #274046)';
      document.body.style.color = '#E6DADA';
      break;
    case 'desert':
      document.body.style.background = 'linear-gradient(to right, #FCEABB, #E1B850)';
      document.body.style.color = '#E1B850';
      break;
    case 'mist':
      document.body.style.background = 'linear-gradient(to right, #757F9A, #D7DDE8)';
      document.body.style.color = '#757F9A';
      break;
    case 'space':
      document.body.style.background = 'url("space.gif") repeat';
      document.body.style.backgroundSize = '100% 120%';
      document.body.style.backgroundAttachment = 'fixed';
      document.body.style.color = 'transparent';
      document.body.style.backgroundClip = 'text';
      document.body.style.webkitBackgroundClip = 'text';
      break;
    case 'george':
      document.body.style.background = 'url("georgebg.jpg")';
      document.body.style.backgroundSize = '100% 120%';
      document.body.style.backgroundAttachment = 'fixed';
      break;
    case 'xp':
      document.body.style.background = 'url("xp.png")';
      document.body.style.backgroundSize = '100% 120%';
      document.body.style.backgroundAttachment = 'fixed';
      break;
    case 'james':
      document.body.style.background = 'url("james.jpg")';
      document.body.style.backgroundSize = '100% 120%';
      document.body.style.backgroundAttachment = 'fixed';
      break;
    case 'halloween':
      document.body.style.background = 'linear-gradient(to bottom, #07030d 0%, #1d0a2e 55%, #3b1204 100%)';
      document.body.style.backgroundAttachment = 'fixed';
      document.body.style.color = '#ff7518';
      startHalloween();
      break;
    case 'custom': {
      const savedCustomBackground = localStorage.getItem('customBackground');
      if (savedCustomBackground) {
        document.body.style.background = `url('${savedCustomBackground}') no-repeat center center fixed`;
        document.body.style.backgroundSize = '100% 120%';
      }
      break;
    }
  }
}

document.querySelectorAll('.theme-btn').forEach(button => {
  button.addEventListener('click', () => {
    const theme = button.getAttribute('data-theme');
    if (theme === 'halloween') playHalloweenIntro = true;
    localStorage.setItem('selectedTheme', theme);
    applyTheme(theme);
  });
});

backgroundUpload.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    clearHalloween();
    const dataUrl = e.target.result;
    document.body.style.background = `url('${dataUrl}') no-repeat center center fixed`;
    document.body.style.backgroundSize = '100% 120%';
    localStorage.setItem('customBackground', dataUrl);
    localStorage.setItem('selectedTheme', 'custom');
  };
  reader.readAsDataURL(file);
});

if (localStorage.getItem(HALLOWEEN_UNLOCKED_KEY) === 'true') showHalloweenButton();

const savedTheme = localStorage.getItem('selectedTheme');
if (savedTheme) {
  applyTheme(savedTheme);
}

checkHalloween();                    // auto-activate on first visit in the window
setInterval(checkHalloween, 30000);  // catches midnight if the tab is already open
window.applyTheme = applyTheme;
