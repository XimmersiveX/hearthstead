// Installing Hearthstead as an app (see manifest.json and sw.js).
// Chrome/Edge/Android fire 'beforeinstallprompt' when the app can be installed; we keep it
// so the Menu's "Install app" button can open the real install dialog. iPhone/iPad Safari
// has no such event, so the UI shows Share → Add to Home Screen steps instead.
(function () {
  let deferred = null;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const changed = () => window.dispatchEvent(new Event('install-change'));
  function installed() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || navigator.standalone === true;
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; changed(); });
  window.addEventListener('appinstalled', () => { deferred = null; try { localStorage.setItem('hearthstead.installHint', 'done'); } catch (err) { /* ignore */ } changed(); });
  async function prompt() {
    if (!deferred) return 'unavailable';
    const e = deferred; deferred = null;
    e.prompt();
    let outcome = 'dismissed';
    try { outcome = (await e.userChoice).outcome; } catch (err) { /* ignore */ }
    changed();
    return outcome; // 'accepted' or 'dismissed'
  }
  window.Install = { ios, android, installed, canPrompt: () => !!deferred, prompt };
})();
