/* The two boinga.gifs in the header drop in and bounce into place when the page loads.
 * Every so often (1 in 100 visits) one of them misses, falls all the way down to the
 * bottom of the screen, and bounces back up to its spot.
 * Add #boingafall to the address to see the rare fall on purpose. */
(function () {
  const root = document.documentElement;
  const gifs = [...document.querySelectorAll('.boinga-gif')];
  const done = () => root.classList.remove('boinga-intro');
  if (!gifs.length || root.classList.contains('no-animations') || !Element.prototype.animate ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }

  const forceFall = location.hash === '#boingafall';
  const fallIndex = forceFall || Math.random() < 0.01 ? Math.floor(Math.random() * gifs.length) : -1;

  // A drop from `h` px above, with a couple of shrinking bounces and a little squash on landing.
  function dropFrames(h) {
    const b1 = Math.min(70, h * 0.22), b2 = Math.min(26, h * 0.08);
    return [
      { transform: `translateY(${-h}px) scale(1, 1)`, easing: 'cubic-bezier(.5,0,1,1)' },
      { transform: 'translateY(0) scale(1.18, .8)', offset: 0.46, easing: 'cubic-bezier(0,0,.4,1)' },
      { transform: `translateY(${-b1}px) scale(.95, 1.06)`, offset: 0.64, easing: 'cubic-bezier(.6,0,1,1)' },
      { transform: 'translateY(0) scale(1.1, .9)', offset: 0.8, easing: 'cubic-bezier(0,0,.4,1)' },
      { transform: `translateY(${-b2}px) scale(1, 1)`, offset: 0.9, easing: 'cubic-bezier(.6,0,1,1)' },
      { transform: 'translateY(0) scale(1, 1)' }
    ];
  }

  function intro() {
    done();
    gifs.forEach((img, i) => {
      const top = img.getBoundingClientRect().bottom + window.scrollY;
      const anim = img.animate(dropFrames(Math.max(140, top + 20)), { duration: 1100, delay: i * 180, fill: 'backwards' });
      if (i === fallIndex) anim.onfinish = () => setTimeout(() => fall(img), 700);
    });
  }

  // The rare one: tumble down to the bottom of the screen, bounce there, then spring back up.
  function fall(img) {
    if (root.classList.contains('no-animations')) return;
    const r = img.getBoundingClientRect();
    const d = Math.max(120, window.innerHeight - r.bottom - 14);
    img.classList.add('falling');
    const a = img.animate([
      { transform: 'translateY(0) rotate(0deg)', easing: 'cubic-bezier(.3,0,.4,0)' },
      { transform: 'translateY(-26px) rotate(-10deg)', offset: 0.08, easing: 'cubic-bezier(.55,0,1,1)' },
      { transform: `translateY(${d}px) rotate(200deg) scale(1.2,.8)`, offset: 0.36, easing: 'cubic-bezier(0,0,.45,1)' },
      { transform: `translateY(${d - 60}px) rotate(250deg)`, offset: 0.44, easing: 'cubic-bezier(.55,0,1,1)' },
      { transform: `translateY(${d}px) rotate(330deg) scale(1.12,.88)`, offset: 0.52, easing: 'cubic-bezier(0,0,.45,1)' },
      { transform: `translateY(${d - 14}px) rotate(355deg)`, offset: 0.57, easing: 'cubic-bezier(.55,0,1,1)' },
      { transform: `translateY(${d}px) rotate(360deg) scale(1.25,.75)`, offset: 0.64, easing: 'cubic-bezier(.1,.6,.3,1)' },
      // big boing back up past its spot...
      { transform: 'translateY(-60px) rotate(720deg) scale(.9,1.12)', offset: 0.86, easing: 'cubic-bezier(.55,0,1,1)' },
      // ...and lands where it belongs
      { transform: 'translateY(0) rotate(720deg) scale(1.15,.85)', offset: 0.95, easing: 'ease-out' },
      { transform: 'translateY(0) rotate(720deg) scale(1,1)' }
    ], { duration: 2600 });
    a.onfinish = () => img.classList.remove('falling');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', intro); else intro();
  window.addEventListener('hashchange', () => { if (location.hash === '#boingafall') fall(gifs[Math.floor(Math.random() * gifs.length)]); });
})();
