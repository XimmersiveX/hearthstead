// =====================================================================
//  SEASONS AND CHOICE EVENTS
//  A spring / summer / autumn / winter cycle that runs on the game clock
//  (so the speed setting speeds it up), and random events that ask the
//  player to choose.
//
//  Two settings, saved with the game (state.seasonCfg):
//    show: the village picture changes with the season and the top bar
//          shows the season and year. On by default. Looks only.
//    play: seasonal farming and choice events. Off by default. When it is
//          off, every multiplier here is exactly 1 and no events happen,
//          so the game plays like the classic original.
//  Numbers live in data.js under `seasons`.
// =====================================================================
(function () {
  const D = window.GAME_DATA;
  const S = D.seasons, E = S.events;

  function cfg(s) { return s.seasonCfg || { show: true, play: false }; }
  function playing(s) { return !!cfg(s).play; }

  // Where we are in the year. frac is how far through the season (0..1).
  function info(s) {
    const c = Math.max(0, s.clock || 0);
    const whole = Math.floor(c / S.length);
    const idx = whole % S.list.length;
    return Object.assign({ idx, year: Math.floor(whole / S.list.length) + 1, frac: (c % S.length) / S.length }, S.list[idx]);
  }

  // Multiplier on what farmers grow (not on what people eat).
  function farmMult(s) {
    if (!playing(s)) return 1;
    let m = info(s).farm;
    if (s.evt && s.evt.drought > 0) m *= E.droughtMult;
    return m;
  }
  // Multiplier on farmers, woodcutters and miners (a scholar's lessons).
  function workMult(s) {
    if (!playing(s)) return 1;
    return s.evt && s.evt.lessons > 0 ? E.lessonMult : 1;
  }

  // ---------- the events ----------
  const living = s => Sim.pop(s).living;
  // Costs grow with the settlement but never past 60% of what storage holds,
  // so a choice is always reachable.
  const capped = (s, r, n) => Math.max(1, Math.ceil(Math.min(n, Sim.storage(s, r) * 0.6)));
  function room(s) { const p = Sim.pop(s); return Math.max(0, p.limit - p.living); }

  const EVENTS = {
    drought: {
      icon: '🌵', title: 'Drought', seasons: ['spring', 'summer'], weight: 3,
      text: () => 'No rain for weeks. The wells are low and the young crops are wilting.',
      choices: [
        {
          label: 'Dig new wells',
          cost: s => ({ wood: capped(s, 'wood', 20 + living(s)), stone: capped(s, 'stone', 20 + living(s)) }),
          effect: () => 'The fields stay watered.',
          apply: () => 'New wells were dug. The fields stay green.',
        },
        {
          label: 'Wait for rain',
          effect: () => `Farms grow half as much for ${E.droughtSeconds} seconds.`,
          apply: s => { s.evt.drought = E.droughtSeconds; return 'The people wait for rain while the crops wilt.'; },
        },
      ],
    },
    refugees: {
      icon: '🧳', title: 'Refugees at the gate', seasons: ['autumn', 'winter', 'spring', 'summer'], weight: 3,
      setup: s => ({ n: Math.max(2, Math.ceil(living(s) * 0.1)) }),
      text: (s, ev) => `${ev.n} people fleeing hard times ask to settle in ${s.civName}. They are hungry and have nothing.`,
      choices: [
        {
          label: 'Take them in',
          cost: (s, ev) => ({ food: capped(s, 'food', 5 * Math.min(ev.n, Math.max(1, room(s)))) }),
          can: s => room(s) > 0,
          why: 'No room in your housing.',
          effect: (s, ev) => { const k = Math.min(ev.n, room(s)); return k < ev.n ? `${k} of them join as idle citizens (room for no more).` : `${k} join as idle citizens.`; },
          apply: (s, ev) => {
            const k = Math.min(ev.n, room(s));
            s.units.unemployed += k;
            return `${k} refugee${k > 1 ? 's' : ''} joined ${s.civName}.`;
          },
        },
        {
          label: 'Turn them away',
          effect: () => 'Your people feel a little ashamed (morale drops slightly).',
          apply: s => { Sim.adjustMorale(s, -0.02); return 'The refugees were turned away.'; },
        },
      ],
    },
    festival: {
      icon: '🎉', title: 'A festival?', seasons: ['autumn', 'spring'], weight: 2,
      text: s => info(s).id === 'autumn' ? 'The harvest is in, and your people want a feast to celebrate it.' : 'Spring has come, and your people want to dance around the maypole.',
      choices: [
        {
          label: 'Hold the festival',
          cost: s => ({ food: capped(s, 'food', 20 + 3 * living(s)) }),
          effect: () => 'Morale rises.',
          apply: s => { Sim.adjustMorale(s, 0.08); return 'The festival was a joy. Morale is up.'; },
        },
        {
          label: 'Not this year',
          effect: () => 'Morale drops slightly.',
          apply: s => { Sim.adjustMorale(s, -0.02); return 'There was no festival this year. People grumbled.'; },
        },
      ],
    },
    fire: {
      icon: '🔥', title: 'Fire!', seasons: ['summer', 'winter', 'autumn', 'spring'], weight: 2,
      can: s => burnable(s).length > 0,
      text: () => 'A fire has broken out among the houses and is spreading fast.',
      choices: [
        {
          label: 'Fight it',
          cost: s => ({ wood: Math.max(1, Math.ceil(s.res.wood * 0.2)) }),
          effect: () => 'Everyone forms a bucket line. Nothing burns, but scorched timber is lost (20% of your wood).',
          apply: () => 'The fire was put out. Nothing was lost but timber.',
        },
        {
          label: 'Let it burn out',
          effect: () => 'Up to 3 buildings may burn down.',
          apply: s => {
            const n = 1 + Math.floor(Math.random() * 3);
            const lost = [];
            for (let i = 0; i < n; i++) {
              const list = burnable(s);
              if (!list.length) break;
              const b = list[Math.floor(Math.random() * list.length)];
              s.bld[b]--;
              lost.push(D.buildings[b].name.toLowerCase());
            }
            return lost.length ? `The fire burned down: ${lost.join(', ')}.` : 'The fire burned itself out.';
          },
        },
      ],
    },
    scholar: {
      icon: '📚', title: 'A travelling scholar', seasons: ['spring', 'summer', 'autumn', 'winter'], weight: 2,
      text: () => 'A scholar on the road asks for room and board, and offers to teach your workers in return.',
      choices: [
        {
          label: 'Host the scholar',
          cost: s => ({ food: capped(s, 'food', 30 + 2 * living(s)), wood: capped(s, 'wood', 20 + living(s)) }),
          effect: () => `Farmers, woodcutters and miners work ${Math.round((E.lessonMult - 1) * 100)}% faster for ${E.lessonSeconds} seconds.`,
          apply: s => { s.evt.lessons = E.lessonSeconds; return 'The scholar is teaching your workers better ways.'; },
        },
        {
          label: 'Send them on',
          effect: () => 'Nothing happens.',
          apply: () => 'The scholar went on their way.',
        },
      ],
    },
  };
  function burnable(s) {
    return Object.keys(D.buildings).filter(b => s.bld[b] > 0 && !D.buildings[b].safe && b !== 'fortification');
  }

  // ---------- each game second ----------
  function tick(s, offline) {
    const ev = s.evt;
    if (ev.drought > 0) ev.drought--;
    if (ev.lessons > 0) ev.lessons--;
    const C = cfg(s);
    // A new season begins.
    if (!offline && (C.show || C.play) && s.clock > 0 && s.clock % S.length === 0) {
      const se = info(s);
      Sim.log(s, `${se.icon} ${se.name} has come${se.idx === 0 ? ` (year ${se.year})` : ''}.${C.play ? ' ' + se.note : ''}`);
      Sim.emit('season', se);
    }
    if (offline || !C.play) return;
    if (ev.pending) {
      ev.pending.ttl--;
      if (ev.pending.ttl <= 0) {
        const def = EVENTS[ev.pending.id];
        const msg = choose(s, def ? def.choices.length - 1 : 0, true);
        if (msg) Sim.log(s, `Nobody decided in time. ${msg}`, 'warn');
      }
      return;
    }
    if (ev.cooldown > 0) { ev.cooldown--; return; }
    if (living(s) < E.minPop || Math.random() >= E.chance) return;
    start(s);
  }

  function start(s, id) {
    const se = info(s).id;
    if (!id) {
      const pool = Object.keys(EVENTS).filter(k => EVENTS[k].seasons.includes(se) && (!EVENTS[k].can || EVENTS[k].can(s)));
      let total = pool.reduce((n, k) => n + EVENTS[k].weight, 0), roll = Math.random() * total;
      for (const k of pool) { roll -= EVENTS[k].weight; if (roll < 0) { id = k; break; } }
      if (!id) return false;
    }
    const def = EVENTS[id];
    s.evt.pending = Object.assign({ id, ttl: E.decideWithin }, def.setup ? def.setup(s) : {});
    Sim.log(s, `${def.icon} ${def.title}: a decision is needed.`, 'warn');
    Sim.emit('event', { id });
    return true;
  }

  // What the UI shows for the pending event.
  function view(s) {
    const ev = s.evt && s.evt.pending;
    if (!ev) return null;
    const def = EVENTS[ev.id];
    if (!def) return null;
    return {
      icon: def.icon, title: def.title, text: def.text(s, ev), ttl: ev.ttl,
      choices: def.choices.map(c => {
        const cost = c.cost ? c.cost(s, ev) : null;
        const allowed = !c.can || c.can(s, ev);
        const affordable = !cost || Sim.canAfford(s, cost) >= 1;
        return { label: c.label, cost, effect: c.effect(s, ev), ok: allowed && affordable, why: !allowed ? (c.why || '') : !affordable ? 'Not enough resources.' : '' };
      }),
    };
  }

  // Make a choice. Returns the result text, or '' if it wasn't possible.
  function choose(s, i, forced) {
    const ev = s.evt && s.evt.pending;
    if (!ev) return '';
    const def = EVENTS[ev.id];
    const c = def && def.choices[i];
    if (!c) { s.evt.pending = null; return ''; }
    const cost = c.cost ? c.cost(s, ev) : null;
    if (!forced) {
      if (c.can && !c.can(s, ev)) return '';
      if (cost && Sim.canAfford(s, cost) < 1) return '';
    }
    if (cost) {
      if (Sim.canAfford(s, cost) < 1) return '';
      for (const r in cost) s.res[r] -= cost[r];
    }
    const msg = c.apply(s, ev);
    s.evt.pending = null;
    s.evt.cooldown = E.minGap;
    if (!forced) Sim.log(s, `${def.icon} ${msg}`, 'good');
    return msg;
  }

  function setCfg(s, patch) {
    s.seasonCfg = Object.assign({ show: true, play: false }, s.seasonCfg, patch);
    s.seasonCfg.show = !!s.seasonCfg.show; s.seasonCfg.play = !!s.seasonCfg.play;
    if (!s.seasonCfg.play) {
      // Back to the classic game straight away: no events, no lingering effects.
      s.evt.pending = null; s.evt.drought = 0; s.evt.lessons = 0;
      s.evt.cooldown = Math.max(s.evt.cooldown, E.firstDelay);
    }
    return s.seasonCfg;
  }

  // Effects the player can see right now (for the top bar tooltip).
  function activeNotes(s) {
    if (!playing(s)) return [];
    const out = [info(s).note];
    if (s.evt.drought > 0) out.push(`Drought: farms grow half as much (${s.evt.drought}s left).`);
    if (s.evt.lessons > 0) out.push(`Scholar's lessons: workers ${Math.round((E.lessonMult - 1) * 100)}% faster (${s.evt.lessons}s left).`);
    return out;
  }

  window.Seasons = { info, farmMult, workMult, tick, start, view, choose, setCfg, activeNotes, playing, EVENTS };
})();
