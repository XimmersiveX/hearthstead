// =====================================================================
//  MAIN: starts the game, runs the loop, connects scene + UI + sim.
// =====================================================================
(function () {
  const D = window.GAME_DATA;
  let state = Sim.loadLocal();
  let awayInfo = null;
  const firstVisit = !state;
  if (state) awayInfo = Sim.catchUp(state, (Date.now() - state.savedAt) / 1000);
  else state = Sim.newState();

  const rest = n => (n === Infinity ? 1e12 : n);
  const actions = {
    build(id, n) {
      const got = Sim.build(state, id, rest(n));
      if (got) Sound.play('build');
      if (got) Sim.log(state, `Built ${got} ${D.buildings[id].name.toLowerCase()}${got > 1 ? 's' : ''}.`);
    },
    spawn(n) {
      const got = Sim.spawn(state, n === Infinity ? 1e12 : n);
      if (got > 0) Sound.play('recruit');
      if (got > 0) Sim.log(state, `${got} new citizen${got > 1 ? 's' : ''} joined ${state.civName}.`, 'good');
    },
    setJob(job, n) { Sim.setJob(state, job, n === Infinity ? 1e12 : n === -Infinity ? -1e12 : n); },
    buyUpgrade(id) { if (Sim.buyUpgrade(state, id)) Sound.play('learn'), UI.toast(`📜 Learned <b>${D.upgrades[id].name}</b>`, 'good'); },
    nameDeity(name) { if (Sim.nameDeity(state, name)) Sound.play('learn'), UI.toast(`🙏 Your people now worship <b>${name}</b>`, 'good'); },
    selectDomain(d) { Sim.selectDomain(state, d); },
    buildAltar() { const before = state.bld.altar; Sim.buildAltar(state); if (state.bld.altar > before) Sound.play('build'); },
    pray(id, n) {
      const P = Sim.prayers[id];
      if (!P || !Sim.prayerVisible(state, id)) return;
      if (id === 'walk') P(state, n);
      else if (id === 'raiseDead') P(state, n === Infinity ? 1e12 : n);
      else P(state);
    },
    iconoclasm(i) { Sim.iconoclasm(state, i); },
    party(unit, n) { Sim.moveToParty(state, unit, n === Infinity ? 1e12 : n === -Infinity ? -1e12 : n); },
    invade(i) { Sim.invade(state, i); },
    plunder() { if (Sim.plunder(state)) Sound.play('coin'), UI.toast(`⚔️ ${state.raid.news}`, 'good', 6000); },
    trade() { const g = state.res.gold; Sim.trade(state); if (state.res.gold > g) Sound.play('coin'); },
    buy(r) { const g = state.res.gold; Sim.buy(state, r); if (state.res.gold < g) Sound.play('coin'); },
    startWonder(name) { const had = state.wonder.stage; Sim.startWonder(state, name); if (state.wonder.stage !== had) Sound.play('build'); },
    rushWonder() { Sim.rushWonder(state); },
    wonderBonus(r) { Sim.chooseWonderBonus(state, r); },
    save() { Sim.saveLocal(state); },
    setSound(patch) { state.sound = Sound.setSettings(Object.assign({}, state.sound, patch)); Sim.saveLocal(state); return state.sound; },
    setPace(p) { Sim.setPace(state, p); Sim.saveLocal(state); },
    setSeasons(patch) { Seasons.setCfg(state, patch); Sim.saveLocal(state); },
    eventChoice(i) { const msg = Seasons.choose(state, i); if (msg) Sound.play('learn'); return msg; },
    importSave(code) { replaceState(Sim.importString(code)); },
    newAge() { replaceState(Sim.newAge(state)); Sim.log(state, 'A new age dawns.', 'good'); Sound.play('newAge'); },
    wipe() { Sim.clearLocal(); replaceState(Sim.newState()); },
  };

  function replaceState(s) {
    state = s;
    Scene.setState(state);
    UI.setState(state);
    Sound.setSettings(state.sound);
    Sim.saveLocal(state);
    UI.refresh();
  }

  // ---------- gathering by hand ----------
  function gather(res, x, y) {
    const got = Sim.gather(state, res);
    if (!got) return;
    const R = D.resources[res];
    if (x === undefined) { const c = Scene.zoneCenter(res); x = c.x + (Math.random() - 0.5) * 60; y = c.y; }
    Sound.play(res);
    Scene.floatText(x, y, `+${Sim.fmt(got.amount)} ${R.icon}`, R.color);
    if (got.special) {
      const S = D.resources[got.special.res];
      Sound.play('find');
      Scene.floatText(x + 30, y - 22, `+${got.special.amount} ${S.icon}`, S.color);
    }
    UI.refresh();
  }
  // Gather on pointerdown, like tapping the picture: every tap counts at once, even fast taps
  // alternating between buttons or with two thumbs. (A click needs press and release on the same
  // button, so quick taps that slid or overlapped were being dropped on phones.)
  const bar = document.getElementById('gatherBar');
  bar.addEventListener('pointerdown', e => {
    if (e.button > 0) return; // left mouse button or a touch only
    const b = e.target.closest('[data-res]');
    if (!b) return;
    e.preventDefault(); // no focus, text selection or delayed click from this tap
    gather(b.dataset.res);
    b.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: 120 });
  });
  // Keyboard (Enter/Space on a focused button) still works through click; pointer clicks are already counted above.
  bar.addEventListener('click', e => {
    if (e.detail !== 0) return;
    const b = e.target.closest('[data-res]');
    if (b) gather(b.dataset.res);
  });
  // Desktop: hide or show the gather buttons; remembered apart from the save.
  function setGatherHidden(hide) {
    if (hide) document.documentElement.dataset.gather = 'hidden'; else delete document.documentElement.dataset.gather;
    try { if (hide) localStorage.setItem('hearthstead.gather', 'hidden'); else localStorage.removeItem('hearthstead.gather'); } catch (e) { /* ignore */ }
  }
  // (guarded: a page from an older version may not have these buttons yet)
  document.getElementById('gatherHide')?.addEventListener('click', () => setGatherHidden(true));
  document.getElementById('gatherShow')?.addEventListener('click', () => setGatherHidden(false));
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') UI.closeModal();
    if (e.key === '1') gather('food');
    if (e.key === '2') gather('wood');
    if (e.key === '3') gather('stone');
  });

  // ---------- events from the simulation ----------
  Sim.on((type, d) => {
    switch (type) {
      case 'attack': Sound.play('horn'); UI.toast(`⚠️ <b>${D.enemies[d.kind].name} attack!</b> ${Sim.fmt(d.n)} of them.`, 'bad', 6000); break;
      case 'trader': Sound.play('trader'); UI.toast('🐫 A merchant has arrived. Quick, they won\'t stay long.', 'warn', 5000); break;
      case 'raidWon': Sound.play('fanfare'); UI.toast('⚔️ <b>Raid victorious!</b> Collect your plunder.', 'good', 5000); break;
      case 'raidLost': Sound.play('defeat'); UI.toast('💀 Your raiding party was defeated.', 'bad', 5000); break;
      case 'wonderDone': Sound.play('wonder'); UI.toast('🏛️ <b>Your wonder is complete!</b>', 'good', 8000); break;
      case 'event': Sound.play('event'); if (!UI.modalOpen()) UI.showEvent(); break;
      case 'sick': Sound.play('sick'); UI.toast(`🤒 ${d.n} citizens fell sick.`, 'warn', 4000); break;
    }
  });

  // ---------- start up ----------
  Sound.setSettings(state.sound);
  Scene.init(document.getElementById('scene'), state, { onGather: gather });
  UI.init(state, actions);
  Scene.sync();
  UI.refresh();
  if (awayInfo && awayInfo.seconds > 60) UI.showAway(awayInfo);
  else if (firstVisit) UI.showHelp();

  // ---------- main loop ----------
  // The economy runs in whole one-second ticks, like a clock. The pace
  // setting (1x to 10x) runs that clock faster.
  let last = performance.now(), acc = 0, uiT = 0, syncT = 0, saveT = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 5) {
      // The tab was asleep: catch up like offline progress.
      Sound.hush(true);
      const info = Sim.catchUp(state, dt);
      Sound.hush(false);
      if (info && info.seconds > 60) UI.showAway(info);
      dt = 0;
    }
    acc += dt * Sim.paceOf(state);
    let ticked = false;
    while (acc >= 1) { Sim.tick(state, false); acc -= 1; ticked = true; }
    Scene.update(Math.min(dt, 0.1));
    uiT += dt; syncT += dt; saveT += dt;
    if (ticked || uiT > 0.5) { uiT = 0; UI.refresh(); }
    if (syncT > 0.5) { syncT = 0; Scene.sync(); }
    if (saveT > 10) { saveT = 0; Sim.saveLocal(state); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const saveNow = () => Sim.saveLocal(state);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);
  window.addEventListener('beforeunload', saveNow);

  // Handy for testing in the browser console (F12).
  window.game = { get state() { return state; }, Sim, Scene, UI };
})();
