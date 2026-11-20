// =====================================================================
//  SIMULATION: game state, the once-per-second economy, combat, faith,
//  trade, wonders, saving and loading. No drawing happens here;
//  scene.js and ui.js only read the state.
// =====================================================================
(function () {
  const D = window.GAME_DATA;
  const SAVE_KEY = 'hearthstead.save.v1';
  const RES = Object.keys(D.resources);
  const JOBS = Object.keys(D.jobs);
  const BLD = Object.keys(D.buildings);
  const ENEMIES = Object.keys(D.enemies);

  // ---------- small helpers ----------
  const rnd = Math.random;
  function rndRound(x) { const b = Math.floor(x); return b + (rnd() < x - b ? 1 : 0); }
  function arithSum(inc, n, m) { return ((m - n) * (n * inc + (m - 1) * inc)) / 2; }
  function largestUnder(fn, limit) {
    // Largest whole x with fn(x) <= limit (fn must grow with x).
    if (fn(1) > limit) return 0;
    let lo = 1, hi = 2;
    while (fn(hi) <= limit && hi < 1e9) { lo = hi; hi *= 2; }
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (fn(mid) <= limit) lo = mid; else hi = mid; }
    return lo;
  }
  const has = (s, id) => !!s.upg[id];
  const num = b => (b ? 1 : 0);

  // ---------- events ----------
  const listeners = [];
  function on(f) { listeners.push(f); }
  function emit(type, data) { for (const f of listeners) f(type, data); }
  function log(s, text, kind) {
    s.log.unshift({ t: Date.now(), text, kind: kind || '' });
    if (s.log.length > 60) s.log.length = 60;
    emit('log', { text, kind });
  }

  // ---------- new game ----------
  function newState() {
    const zero = keys => Object.fromEntries(keys.map(k => [k, 0]));
    return {
      v: 1,
      civName: 'Ashford',
      rulerName: 'Founder',
      res: zero(RES),
      bld: Object.assign(zero(BLD), { altar: 0 }),
      land: D.population.startLand,
      upg: {},
      units: zero(JOBS),
      ill: zero(JOBS),
      party: { soldier: 0, cavalry: 0, siege: 0 },
      zombies: 0, graves: 0, slain: 0, cats: 0, shades: 0,
      enemies: Object.assign(zero(ENEMIES), { esiege: 0 }),
      raid: { raiding: false, victory: false, epop: 0, loot: {}, last: '', targetMax: D.civSizes[0].id, esoldier: 0, efort: 0, news: '' },
      morale: 1,
      clicks: 0,
      attackCounter: 0,
      trader: { res: '', amt: 0, timer: 0, counter: 0, sub: 0 },
      wonder: { name: '', stage: 0, progress: 0, rushed: false },
      wonders: [],
      deities: [{ name: '', domain: '', maxDev: 0 }],
      throneCount: 0, walkRate: 0, cureCarry: 0, pestTimer: 0, gloryTimer: 0, graceCost: 1000,
      ach: {},
      log: [],
      spawnJob: 'unemployed',
      pace: 1, // game speed setting: 1 = classic pacing, up to 10
      sound: { mute: false, sfx: 0.6, music: 0.35 }, // volumes 0 to 1
      clock: 0, // game seconds this age (drives the seasons)
      seasonCfg: { show: true, play: false }, // seasons: looks on, gameplay effects off (classic)
      evt: { pending: null, cooldown: D.seasons.events.firstDelay, drought: 0, lessons: 0 },
      started: Date.now(),
      savedAt: Date.now(),
    };
  }

  // ---------- population ----------
  function housing(s) {
    const B = D.buildings, b = s.bld;
    return b.tent * B.tent.pop + b.hut * B.hut.pop + b.cottage * B.cottage.pop
      + b.house * (B.house.pop + 2 * num(has(s, 'tenements')) + 2 * num(has(s, 'slums')))
      + b.mansion * B.mansion.pop;
  }
  function pop(s) {
    let units = 0, sick = 0;
    for (const j of JOBS) { units += s.units[j]; sick += s.ill[j]; }
    const current = units + sick + s.party.soldier + s.party.cavalry;
    if (s.zombies > current) s.zombies = current;
    const living = Math.max(0, current - s.zombies);
    return { current, living, sick, healthy: units, limit: housing(s), zombies: s.zombies };
  }
  function civSize(n) {
    const sizes = D.civSizes;
    for (let i = sizes.length - 1; i >= 0; i--) if (n >= sizes[i].min) return Object.assign({ idx: i }, sizes[i]);
    return Object.assign({ idx: 0 }, sizes[0]);
  }
  function civTitle(s) {
    const p = pop(s);
    if (p.living === 0 && p.limit >= 1000) return 'Ghost Town';
    if (s.zombies >= 1000 && s.zombies >= 2 * p.living) return 'Necropolis';
    return civSize(p.living).name;
  }
  function sizeMaxPop(idx) {
    const sizes = D.civSizes;
    return idx + 1 < sizes.length ? sizes[idx + 1].min - 1 : Infinity;
  }

  function storage(s, r) {
    const base = D.baseStorage;
    if (r === 'food') return base + s.bld.barn * 200 * (has(s, 'granaries') ? 2 : 1);
    if (r === 'wood') return base + s.bld.woodstock * 200;
    if (r === 'stone') return base + s.bld.stonestock * 200;
    return Infinity;
  }
  function usedLand(s) { let n = s.bld.altar; for (const b of BLD) n += s.bld[b]; return n; }
  function freeLand(s) { return s.land - usedLand(s); }

  function jobLimit(s, job) {
    const J = D.jobs[job];
    if (J.limitBy) return s.bld[J.limitBy];
    if (J.perBuilding) { let n = 0; for (const b in J.perBuilding) n += s.bld[b] * J.perBuilding[b]; return n; }
    if (job === 'labourer') return s.wonder.stage === 1 ? Infinity : 0;
    return Infinity;
  }
  function jobTotal(s, job) { return s.units[job] + s.ill[job] + (s.party[job] || 0); }
  function jobUnlocked(s, job) {
    const J = D.jobs[job];
    if (job === 'labourer') return s.wonder.stage === 1;
    if (J.limitBy || J.perBuilding) return jobLimit(s, job) > 0 || jobTotal(s, job) > 0;
    return true;
  }

  function combatMod(s) {
    let m = 0;
    for (const id in D.upgrades) if (D.upgrades[id].combat && has(s, id)) m += D.upgrades[id].combat;
    return m;
  }
  function farmEfficiency(s) {
    let n = 0;
    for (const id in D.upgrades) if (D.upgrades[id].farm && has(s, id)) n++;
    return D.rates.farmer + D.rates.farmerPerUpgrade * n;
  }
  function deity(s) { return s.deities[0]; }
  function domain(s) { return deity(s).domain; }
  function devotion(s) { return s.bld.altar; }

  // ---------- requirements and costs ----------
  function meetsReq(s, req) {
    if (!req) return true;
    for (const k in req) {
      if (D.upgrades[k]) { if (!has(s, k)) return false; }
      else if (D.buildings[k]) { if (s.bld[k] < req[k]) return false; }
      else if (D.resources[k]) { if (s.res[k] < req[k]) return false; }
    }
    return true;
  }
  function buildingCost(s, id, n) {
    const c = D.buildings[id].cost;
    return typeof c === 'function' ? c(n === undefined ? s.bld[id] : n) : c;
  }
  function altarCost(s, n) {
    const a = D.altars[domain(s)];
    return a ? a.cost(n === undefined ? s.bld.altar : n) : null;
  }
  function canAfford(s, cost, qty) {
    if (!cost) return 0;
    if (qty === undefined) qty = Infinity;
    for (const r in cost) {
      if (!cost[r]) continue;
      qty = Math.min(qty, Math.floor(s.res[r] / cost[r]));
      if (qty <= 0) return 0;
    }
    return qty;
  }
  function pay(s, cost, qty) {
    if (qty === undefined) qty = 1;
    for (const r in cost) s.res[r] -= cost[r] * qty;
  }
  function wonderCount(s, r) { return s.wonders.filter(w => w.res === r).length; }
  function wonderBonus(s, r) { return 1 + wonderCount(s, r) * D.wonder.bonus; }
  function wonderCostMult(s) {
    let most = 0;
    for (const r of D.wonder.resources) most = Math.max(most, wonderCount(s, r));
    return Math.pow(1.5, most);
  }

  function adjustMorale(s, delta) {
    const p = pop(s);
    if (p.current <= 0) return;
    const f = p.living / p.current;
    s.morale += delta * f;
    s.morale = Math.max(1 - 0.5 * f, Math.min(1 + 0.5 * f, s.morale));
  }

  // ---------- clicking ----------
  function clickIncrement(s) {
    const army = s.units.soldier + s.units.cavalry;
    return 1 + 9 * num(has(s, 'civilservice')) + 40 * num(has(s, 'feudalism'))
      + num(has(s, 'serfs')) * Math.floor(Math.log(s.units.unemployed * 10 + 1))
      + num(has(s, 'nationalism')) * Math.floor(Math.log(army * 10 + 1));
  }
  function gather(s, r) {
    const R = D.resources[r];
    if (!R || !R.basic) return null;
    const amount = clickIncrement(s);
    s.res[r] = Math.min(storage(s, r), s.res[r] + amount);
    s.clicks++;
    let chance = D.clickSpecialChance;
    if (r === 'food' && has(s, 'flensing')) chance += 0.1;
    if (r === 'stone' && has(s, 'macerating')) chance += 0.1;
    let special = null;
    if (rnd() < chance) {
      const q = 1 + 9 * num(has(s, 'guilds'));
      s.res[R.special] += q;
      special = { res: R.special, amount: q };
      log(s, `Found ${q} ${D.resources[R.special].name.toLowerCase()} while ${R.activity}.`);
    }
    return { amount, special };
  }

  // ---------- recruiting ----------
  function workerCost(s, n, cur) {
    if (cur === undefined) cur = pop(s).living;
    return D.population.workerCost * n + arithSum(D.population.workerCostRise, cur, cur + n);
  }
  function maxRecruit(s) {
    const p = pop(s);
    const room = Math.max(0, p.limit - p.living);
    return Math.min(room, largestUnder(n => workerCost(s, n, p.living), s.res.food));
  }
  function spawn(s, n) {
    if (n < 0) { // dismiss idle citizens
      n = Math.min(-n, s.units.unemployed);
      s.units.unemployed -= n;
      s.zombies = Math.min(s.zombies, pop(s).current);
      return -n;
    }
    n = Math.min(n, maxRecruit(s));
    if (n <= 0) return 0;
    s.res.food -= workerCost(s, n);
    const job = ['farmer', 'woodcutter', 'miner'].includes(s.spawnJob) ? s.spawnJob : 'unemployed';
    s.units[job] += n;
    if (rnd() < D.population.catChance * (1 + num(has(s, 'lure')))) {
      s.cats++;
      log(s, 'A stray cat wandered in and decided to stay. 🐈', 'good');
    }
    return n;
  }

  // ---------- jobs ----------
  function canHire(s, job) {
    if (job === 'unemployed' || !jobUnlocked(s, job)) return 0;
    let n = s.units.unemployed;
    n = Math.min(n, jobLimit(s, job) - jobTotal(s, job));
    const cost = D.jobs[job].cost;
    if (cost) n = Math.min(n, canAfford(s, cost));
    return Math.max(0, n);
  }
  function setJob(s, job, delta) {
    if (job === 'unemployed') return 0;
    if (delta > 0) {
      const n = Math.min(delta, canHire(s, job));
      if (n <= 0) return 0;
      if (D.jobs[job].cost) pay(s, D.jobs[job].cost, n);
      s.units.unemployed -= n; s.units[job] += n;
      return n;
    }
    const n = Math.min(-delta, s.units[job]);
    s.units[job] -= n; s.units.unemployed += n;
    return -n;
  }

  // ---------- buildings ----------
  function buildingUnlocked(s, id) { return meetsReq(s, D.buildings[id].req); }
  function canBuild(s, id) {
    if (!buildingUnlocked(s, id)) return 0;
    const c = D.buildings[id].cost;
    if (typeof c === 'function') return canAfford(s, buildingCost(s, id)) > 0 ? 1 : 0;
    return canAfford(s, c);
  }
  function build(s, id, qty) {
    if (!buildingUnlocked(s, id)) return 0;
    let n = 0;
    const variable = typeof D.buildings[id].cost === 'function';
    if (variable) {
      while (n < qty && canAfford(s, buildingCost(s, id)) > 0) { pay(s, buildingCost(s, id)); s.bld[id]++; n++; }
    } else {
      n = Math.min(qty, canAfford(s, D.buildings[id].cost));
      if (n <= 0) return 0;
      pay(s, D.buildings[id].cost, n);
      s.bld[id] += n;
    }
    if (n > 0) afterBuild(s, id, n);
    return n;
  }
  function afterBuild(s, id, n) {
    if (id === 'graveyard') s.graves += D.buildings.graveyard.graves * n;
    if (id === 'temple' && has(s, 'aesthetics')) {
      const p = pop(s);
      if (p.living > 0) adjustMorale(s, (n * 25) / p.living);
    }
    const free = freeLand(s);
    if (free < 0) {
      log(s, 'Your people are suffering from overcrowding. Win more land in raids.', 'warn');
      adjustMorale(s, Math.max(n, -free) * -0.0025 * (has(s, 'codeoflaws') ? 0.5 : 1));
    }
  }
  function buildAltar(s) {
    const c = altarCost(s);
    if (!c || canAfford(s, c) < 1) return 0;
    pay(s, c);
    s.bld.altar++;
    const d = deity(s);
    if (d.maxDev < s.bld.altar) d.maxDev = s.bld.altar;
    afterBuild(s, 'altar', 1);
    return 1;
  }

  // ---------- upgrades ----------
  function upgradeVisible(s, id) {
    const U = D.upgrades[id];
    if (U.domain) return domain(s) === U.domain && devotion(s) >= U.devotion;
    return meetsReq(s, U.req);
  }
  function buyUpgrade(s, id) {
    if (has(s, id) || !upgradeVisible(s, id)) return false;
    const U = D.upgrades[id];
    if (canAfford(s, U.cost) < 1) return false;
    pay(s, U.cost);
    s.upg[id] = true;
    log(s, `Learned ${U.name}.`, 'good');
    emit('upgrade', { id });
    return true;
  }

  // ---------- faith ----------
  function nameDeity(s, name) {
    name = String(name || '').trim().slice(0, 40);
    if (!name) return false;
    const idx = s.deities.findIndex((d, i) => i > 0 && d.name === name);
    if (idx > 0) {
      // Returning to an old deity brings back its domain for free.
      const old = s.deities.splice(idx, 1)[0];
      s.deities[0] = old;
    } else {
      s.deities[0].name = name;
    }
    return true;
  }
  function selectDomain(s, dom) {
    if (domain(s) || !D.deity.domains[dom]) return false;
    if (s.res.piety < D.deity.domainCost) return false;
    s.res.piety -= D.deity.domainCost;
    s.deities[0].domain = dom;
    log(s, `${deity(s).name} is now worshipped as the god of ${D.deity.domains[dom].name}.`, 'good');
    return true;
  }
  function prayerVisible(s, id) {
    const P = D.prayers[id];
    return domain(s) === P.domain && devotion(s) >= P.devotion;
  }
  function iconoclasm(s, index) {
    if (index < 1 || index >= s.deities.length) return false;
    if (s.res.piety < D.deity.iconoclasmCost) return false;
    s.res.piety -= D.deity.iconoclasmCost;
    const gold = Math.floor(Math.pow(s.deities[index].maxDev, 1 / 1.25));
    s.res.gold += gold;
    log(s, `The old idols of ${s.deities[index].name} were melted down for ${gold} gold.`);
    s.deities.splice(index, 1);
    return true;
  }

  function killUnit(s, job, sickFirst) {
    if (!job) return 0;
    if (sickFirst && s.ill[job] > 0) s.ill[job]--;
    else if (s.units[job] > 0) s.units[job]--;
    else return 0;
    s.res.corpses += 1;
    if (has(s, 'book')) s.res.piety += 10;
    return 1;
  }
  // Pick a random healthy citizen at home, weighted by job size.
  function randomHealthyWorker(s) {
    let total = 0;
    for (const j of JOBS) total += s.units[j];
    if (total <= 0) return '';
    let roll = rnd() * total;
    for (const j of JOBS) { roll -= s.units[j]; if (roll < 0) return j; }
    return '';
  }

  const prayers = {
    smite(s) {
      let killed = 0;
      for (const k of ['barbarian', 'bandit', 'wolf']) {
        const n = Math.min(s.enemies[k], Math.floor(s.res.piety / 100));
        if (n <= 0) continue;
        s.res.piety -= n * 100; s.enemies[k] -= n; s.res.corpses += n; s.slain += n; killed += n;
        if (has(s, 'throne')) s.throneCount += n;
        if (has(s, 'book')) s.res.piety += n * 10;
      }
      if (killed) log(s, `Struck down ${killed} invader${killed > 1 ? 's' : ''}.`, 'good');
      return killed;
    },
    glory(s) {
      if (canAfford(s, D.prayers.glory.cost) < 1) return false;
      pay(s, D.prayers.glory.cost);
      s.gloryTimer = D.prayers.glory.seconds;
      log(s, 'Your warriors thirst for glory!', 'good');
      return true;
    },
    wickerman(s) {
      const job = randomHealthyWorker(s);
      if (!job || canAfford(s, D.prayers.wickerman.cost) < 1) return false;
      pay(s, D.prayers.wickerman.cost);
      s.units[job]--;
      const r = D.lootable[Math.floor(rnd() * D.lootable.length)];
      let q = Math.floor(rnd() * 1000);
      if (r === 'wood') q = q / 2 + 500;
      s.res[r] += q;
      log(s, `A ${D.jobs[job].name.toLowerCase()} was offered to the harvest. Gained ${Math.floor(q)} ${D.resources[r].name.toLowerCase()}.`);
      return true;
    },
    walk(s, delta) {
      if (delta === 0) s.walkRate = 0; else s.walkRate = Math.max(0, s.walkRate + delta);
      return true;
    },
    raiseDead(s, n) {
      n = Math.min(n, s.res.corpses);
      const cost = k => workerCost(s, k, s.zombies) / 5;
      n = Math.min(n, largestUnder(cost, s.res.piety));
      if (n <= 0) return 0;
      s.res.piety -= cost(n);
      s.zombies += n; s.units.unemployed += n; s.res.corpses -= n;
      log(s, n === 1 ? 'A corpse rises, ready to work.' : `${n} corpses rise, ready to work.`);
      return n;
    },
    summonShade(s) {
      if (s.slain <= 0 || canAfford(s, D.prayers.summonShade.cost) < 1) return 0;
      pay(s, D.prayers.summonShade.cost);
      const n = Math.ceil(s.slain / 4 + rnd() * s.slain / 4);
      s.slain -= n; s.shades += n;
      log(s, `${n} shades rise to defend you.`);
      return n;
    },
    pestControl(s) {
      if (canAfford(s, D.prayers.pestControl.cost) < 1) return false;
      pay(s, D.prayers.pestControl.cost);
      s.pestTimer = 10 * s.cats;
      log(s, 'The cats go hunting. The granary is safe.');
      return true;
    },
    grace(s) {
      if (s.res.piety < s.graceCost) return false;
      s.res.piety -= s.graceCost;
      s.graceCost = Math.floor(s.graceCost * 1.2);
      adjustMorale(s, 0.1);
      return true;
    },
  };
  function raiseDeadCost(s, n) { return workerCost(s, n, s.zombies) / 5; }

  // ---------- military ----------
  function moveToParty(s, unit, delta) {
    if (unit === 'siege') {
      if (delta > 0) {
        if (!has(s, 'standard') || !has(s, 'mathematics')) return 0;
        const n = Math.min(delta, canAfford(s, D.combat.siegeCost));
        if (n <= 0) return 0;
        pay(s, D.combat.siegeCost, n); s.party.siege += n; return n;
      }
      return 0;
    }
    if (!has(s, 'standard')) return 0;
    if (delta > 0) { const n = Math.min(delta, s.units[unit]); s.units[unit] -= n; s.party[unit] += n; return n; }
    const n = Math.min(-delta, s.party[unit]); s.party[unit] -= n; s.units[unit] += n; return -n;
  }
  function canRaid(s, targetIdx) {
    if (!has(s, 'standard') || s.raid.raiding) return false;
    if (s.party.soldier + s.party.cavalry <= 0) return false;
    const maxIdx = D.civSizes.findIndex(c => c.id === s.raid.targetMax);
    return targetIdx <= maxIdx;
  }
  function invade(s, targetIdx) {
    if (!canRaid(s, targetIdx)) return false;
    const size = D.civSizes[targetIdx];
    const R = s.raid;
    R.raiding = true; R.victory = false; R.last = size.id;
    let epop = sizeMaxPop(targetIdx) + 1;
    if (epop === Infinity) epop = size.min * 2;
    if (s.gloryTimer > 0) epop *= 2;
    R.epop = epop;
    R.esoldier = Math.floor(epop / 20 + Math.floor(rnd() * (epop / 5)));
    R.efort = Math.floor(rnd() * (epop / 5000));
    const baseLoot = epop / (1 + num(s.gloryTimer <= 0));
    R.loot = { land: Math.round(baseLoot * (1 + num(has(s, 'administration')))) };
    for (const r of D.lootable) R.loot[r] = Math.round(baseLoot * rnd());
    R.news = '';
    log(s, `Your raiding party marches on a ${size.name.toLowerCase()} defended by ${R.esoldier} soldiers.`);
    return true;
  }
  function resetRaid(s) {
    Object.assign(s.raid, { raiding: false, victory: false, epop: 0, loot: {}, last: '', esoldier: 0, efort: 0 });
  }
  function plunder(s) {
    const R = s.raid;
    if (!R.victory) return false;
    const idx = D.civSizes.findIndex(c => c.id === R.last);
    const maxIdx = D.civSizes.findIndex(c => c.id === R.targetMax);
    if (idx === maxIdx && maxIdx < D.civSizes.length - 1) R.targetMax = D.civSizes[maxIdx + 1].id;
    if (idx === D.civSizes.length - 1) s.ach.domination = true;
    adjustMorale(s, (idx + 1) / 100);
    if (has(s, 'lament')) s.attackCounter -= Math.ceil(R.epop / 2000);
    const parts = [];
    for (const k in R.loot) {
      const q = R.loot[k];
      if (!q) continue;
      if (k === 'land') { s.land += q; parts.push(`${fmt(q)} land`); }
      else { s.res[k] += q; parts.push(`${fmt(q)} ${D.resources[k].name.toLowerCase()}`); }
    }
    R.news = `${D.civSizes[idx].name} defeated! Plundered ${parts.join(', ') || 'nothing'}.`;
    log(s, R.news, 'good');
    const news = R.news;
    resetRaid(s);
    R.news = news;
    return true;
  }

  // Combatant helpers. Each wraps a count in the state so fights can be generic.
  function combatant(s, key) {
    const cm = combatMod(s);
    const C = D.combat;
    switch (key) {
      case 'soldier': return { key, player: true, type: 'infantry', eff: C.soldier + cm, get n() { return s.units.soldier; }, set n(v) { s.units.soldier = v; } };
      case 'cavalry': return { key, player: true, type: 'cavalry', eff: C.cavalry + cm, get n() { return s.units.cavalry; }, set n(v) { s.units.cavalry = v; } };
      case 'pSoldier': return { key, player: true, type: 'infantry', eff: C.soldier + cm, get n() { return s.party.soldier; }, set n(v) { s.party.soldier = v; } };
      case 'pCavalry': return { key, player: true, type: 'cavalry', eff: C.cavalry + cm, get n() { return s.party.cavalry; }, set n(v) { s.party.cavalry = v; } };
      case 'esoldier': return { key, player: false, type: 'infantry', eff: 0.05, get n() { return s.raid.esoldier; }, set n(v) { s.raid.esoldier = v; } };
      default: {
        const E = D.enemies[key];
        return { key, player: false, type: E.animal ? 'animal' : 'infantry', eff: E.eff, E, get n() { return s.enemies[key]; }, set n(v) { s.enemies[key] = v; } };
      }
    }
  }
  function casualtyMod(attacker, defender) {
    return (defender.type === 'cavalry' && attacker.type === 'infantry') ? D.combat.cavalryVsInfantry : 1;
  }
  function fight(s, A, B, playerDefending) {
    if (A.n <= 0 || B.n <= 0) return;
    const fortMod = playerDefending ? s.bld.fortification * D.combat.fortification : s.raid.efort * D.combat.fortification;
    const palMod = playerDefending && has(s, 'palisade') ? D.combat.palisade : 0;
    const aCas = Math.min(A.n, rndRound(casualtyMod(B, A) * B.n * B.eff));
    const bCas = Math.min(B.n, rndRound(casualtyMod(A, B) * A.n * (A.eff - palMod) * Math.max(1 - fortMod, 0)));
    A.n -= aCas; B.n -= bCas;
    const credit = A.player ? bCas : (B.player ? aCas : 0);
    s.slain += credit;
    if (has(s, 'throne')) s.throneCount += credit;
    s.res.corpses += aCas + bCas;
    if (has(s, 'book')) s.res.piety += (aCas + bCas) * 10;
  }
  function doSlaughter(s, A) {
    const E = A.E;
    const job = randomHealthyWorker(s);
    if (job) {
      if (rnd() < E.killExhaustion) A.n -= 1;
      s.units[job]--;
      if (!E.animal) s.res.corpses += 1;
      log(s, `A ${D.jobs[job].name.toLowerCase()} was ${E.animal ? 'eaten' : 'killed'} by ${E.name.toLowerCase()}.`, 'bad');
    } else {
      A.n -= Math.ceil(A.n * rnd() * E.killFatigue);
    }
  }
  function doLoot(s, A) {
    const E = A.E;
    const r = D.lootable[Math.floor(rnd() * D.lootable.length)];
    const q = Math.min(Math.floor(rnd() * 1000), Math.floor(s.res[r]));
    if (q > 0) log(s, `${E.name} stole ${q} ${D.resources[r].name.toLowerCase()}.`, 'bad');
    s.res[r] -= q;
    if (s.res[r] <= 0) A.n -= Math.ceil(A.n * rnd() * E.lootFatigue);
    A.n = Math.max(0, A.n - 1);
  }
  const SACKABLE = BLD.filter(b => !D.buildings[b].safe);
  function doSack(s, A) {
    const E = A.E;
    const b = SACKABLE[Math.floor(rnd() * SACKABLE.length)];
    if (s.bld[b] > 0) {
      s.bld[b]--;
      log(s, `A ${D.buildings[b].name.toLowerCase()} was ${b === 'fortification' ? 'damaged' : 'burned'} by ${E.name.toLowerCase()}.`, 'bad');
    } else {
      A.n -= Math.ceil(A.n * rnd() / 112);
    }
    A.n = Math.max(0, A.n - 1);
  }
  function mobWins(s, A) {
    const k = A.E.kind;
    if (k === 'slaughter') doSlaughter(s, A);
    else if (k === 'loot') doLoot(s, A);
    else { const h = rnd(); if (h < 0.3) doSlaughter(s, A); else if (h < 0.6) doLoot(s, A); else doSack(s, A); }
    if (A.n < 0) A.n = 0;
  }
  function enemiesAtHome(s) { return ENEMIES.reduce((n, k) => n + s.enemies[k], 0); }
  function spawnMob(s, kind, n) {
    const p = pop(s);
    if (n === undefined) n = Math.ceil(p.current * D.mobs.perPop * rnd());
    if (n <= 0) return 0;
    let siege = 0;
    if (!D.enemies[kind].animal) siege = Math.floor((rnd() * n) / 100);
    s.enemies[kind] += n;
    s.enemies.esiege += siege;
    const E = D.enemies[kind];
    log(s, `${E.icon} ${fmt(n)} ${n === 1 ? E.one : E.name.toLowerCase()} attacked${siege ? `, with ${siege} siege engines` : ''}!`, 'bad');
    emit('attack', { kind, n });
    return n;
  }
  function doMobs(s) {
    const p = pop(s);
    if (p.current > 0) s.attackCounter++;
    if (p.current > 0 && s.attackCounter > D.mobs.minGap && rnd() < D.mobs.chancePerSec) {
      s.attackCounter = 0;
      let kind = 'wolf';
      if (p.current >= D.mobs.barbarianPop) { const c = rnd(); if (c > 0.5) kind = 'barbarian'; else if (c > 0.2) kind = 'bandit'; }
      else if (p.current >= D.mobs.banditPop) { if (rnd() > 0.5) kind = 'bandit'; }
      spawnMob(s, kind);
    }
    for (const k of ENEMIES) {
      const A = combatant(s, k);
      if (A.n <= 0) continue;
      const defenders = ['soldier', 'cavalry'].map(d => combatant(s, d)).filter(d => d.n > 0);
      if (!defenders.length) { mobWins(s, A); continue; }
      for (const d of defenders) fight(s, A, d, true);
      if (A.n <= 0) log(s, `The ${D.enemies[k].name.toLowerCase()} were driven off.`, 'good');
    }
  }
  function doShades(s) {
    if (s.shades <= 0) return;
    for (const k of ENEMIES) {
      const n = Math.floor(Math.min(s.enemies[k] / 4, s.shades));
      s.shades -= n; s.enemies[k] -= n;
    }
    s.shades = Math.max(Math.floor(s.shades * D.combat.shadeFade), 0);
  }
  // Siege engines: half fire each second, at most 2 per target. Returns hits.
  function siegeVolley(count, targets, onMisfire) {
    const firing = Math.ceil(Math.min(count / 2, targets * 2));
    let hits = 0;
    for (let i = 0; i < firing; i++) {
      const roll = rnd();
      if (roll > 0.95) onMisfire();
      if (roll >= D.combat.siege) continue;
      hits++;
      if (targets - hits <= 0) break;
    }
    return hits;
  }
  function doEnemySiege(s) {
    if (s.enemies.esiege <= 0) return;
    const enemyFighters = enemiesAtHome(s) > 0;
    const myFighters = s.units.soldier + s.units.cavalry > 0;
    if (!enemyFighters && myFighters) {
      if (has(s, 'mathematics')) { log(s, `Captured ${s.enemies.esiege} enemy siege engines.`, 'good'); s.party.siege += s.enemies.esiege; }
      s.enemies.esiege = 0;
      return;
    }
    if (!enemyFighters) { s.enemies.esiege = 0; return; }
    const hits = siegeVolley(s.enemies.esiege, s.bld.fortification, () => { s.enemies.esiege--; });
    if (hits > 0) { s.bld.fortification = Math.max(0, s.bld.fortification - hits); log(s, 'Enemy siege engines damaged your fortifications.', 'bad'); }
  }
  function doRaid(s) {
    const R = s.raid;
    if (!R.raiding) return;
    const attackers = ['pSoldier', 'pCavalry'].map(k => combatant(s, k)).filter(c => c.n > 0);
    const defender = combatant(s, 'esoldier');
    if (attackers.length && defender.n <= 0) {
      R.efort = 0;
      if (!R.victory) { log(s, 'Raid victorious! Collect your plunder.', 'good'); s.ach.raider = true; emit('raidWon', {}); }
      R.victory = true;
    }
    if (!attackers.length && defender.n > 0) {
      log(s, 'Your raiding party was defeated.', 'bad');
      R.news = 'Your last raid was defeated.';
      const news = R.news; resetRaid(s); R.news = news;
      emit('raidLost', {});
      return;
    }
    for (const a of attackers) fight(s, a, defender, false);
    if (s.party.siege > 0 && R.efort > 0) {
      const hits = siegeVolley(s.party.siege, R.efort, () => { s.party.siege--; });
      R.efort = Math.max(0, R.efort - hits);
    }
  }

  // ---------- trade ----------
  function startTrader(s) {
    const T = D.trade;
    s.trader.sub = 0;
    s.trader.timer = T.stay + 5 * (num(has(s, 'currency')) + num(has(s, 'commerce')) + num(has(s, 'stay')));
    const ask = T.asks[Math.floor(rnd() * T.asks.length)];
    s.trader.res = ask.res;
    s.trader.amt = ask.amt * Math.ceil(rnd() * T.maxMult);
    log(s, `🐫 A merchant arrived wanting ${fmt(s.trader.amt)} ${D.resources[ask.res].name.toLowerCase()} for 1 gold.`);
    emit('trader', {});
  }
  function tickTraders(s) {
    const delay = 60 * (3 - num(has(s, 'currency')) - num(has(s, 'commerce')));
    const p = pop(s);
    if (p.current > 0) s.trader.counter++;
    if (p.current > 0 && s.trader.counter > delay) {
      if (rnd() * delay < 1 + 0.2 * num(has(s, 'comfort'))) { s.trader.counter = 0; startTrader(s); }
    }
    // The merchant's stay counts real seconds, so at higher game speeds they
    // still wait as long as at 1x (arrivals still speed up with the clock).
    if (s.trader.timer > 0 && ++s.trader.sub >= paceOf(s)) { s.trader.sub = 0; s.trader.timer--; }
  }
  function trade(s) {
    const T = s.trader;
    if (T.timer <= 0 || !T.res || s.res[T.res] < T.amt) return false;
    s.res[T.res] -= T.amt;
    s.res.gold += 1;
    log(s, `Traded ${fmt(T.amt)} ${D.resources[T.res].name.toLowerCase()} for 1 gold.`, 'good');
    return true;
  }
  function buy(s, r) {
    if (!has(s, 'trade') || s.res.gold < 1 || !D.trade.buy[r]) return false;
    s.res.gold -= 1;
    s.res[r] += D.trade.buy[r];
    return true;
  }

  // ---------- wonders ----------
  function haveWonderTech(s) { return has(s, 'architecture') && has(s, 'civilservice'); }
  function startWonder(s, name) {
    if (!haveWonderTech(s) || s.wonder.stage !== 0) return false;
    s.wonder.stage = 1;
    s.wonder.name = String(name || 'The Great Work').slice(0, 40);
    log(s, `Work begins on ${s.wonder.name}. Assign builders in the People tab.`, 'good');
    return true;
  }
  function rushWonder(s) {
    if (s.wonder.stage !== 1 || s.res.gold < D.wonder.rushGold) return false;
    s.res.gold -= D.wonder.rushGold;
    s.wonder.progress += 1 / wonderCostMult(s);
    s.wonder.rushed = true;
    s.ach.rushed = true;
    return true;
  }
  function wonderLimitedBy(s) {
    for (const r of D.wonder.resources) if (s.res[r] < 1) return r;
    return '';
  }
  function chooseWonderBonus(s, r) {
    if (s.wonder.stage !== 2 || !D.wonder.resources.includes(r)) return false;
    s.wonders.push({ name: s.wonder.name, res: r });
    log(s, `${s.wonder.name} grants a lasting +10% bonus to ${D.resources[r].name.toLowerCase()}.`, 'good');
    s.wonder.stage = 3; // finished: another wonder can be raised in a new age
    if (s.wonders.length >= 7) s.ach.seven = true;
    return true;
  }
  function doLabourers(s) {
    const W = s.wonder;
    if (W.stage !== 1) return;
    if (W.progress >= 100) {
      s.units.unemployed += s.units.labourer; s.ill.unemployed += s.ill.labourer;
      s.units.labourer = 0; s.ill.labourer = 0;
      W.stage = 2;
      s.ach.wonder = true;
      if (s.clicks <= 22) s.ach.neverclick = true;
      log(s, `${W.name} is complete! Choose which resource it blesses.`, 'good');
      emit('wonderDone', {});
      return;
    }
    let prod = s.units.labourer;
    for (const r of D.wonder.resources) prod = Math.min(prod, s.res[r]);
    if (prod <= 0) return;
    for (const r of D.wonder.resources) { s.res[r] -= prod; flow(s, r, 0, prod); }
    W.progress += prod / (D.wonder.unitsPerPercent * wonderCostMult(s));
  }

  // ---------- population upkeep ----------
  function doStarve(s, offline) {
    if (s.res.food < 0 && has(s, 'waste')) {
      const eaten = Math.min(s.res.corpses, -s.res.food);
      s.res.corpses -= eaten; s.res.food += eaten;
    }
    if (s.res.food >= 0) return;
    s.res.food = 0;
    if (offline) return;
    const p = pop(s);
    let n = Math.min(Math.ceil(p.living / 1000), p.living), died = 0;
    for (let i = 0; i < n; i++) {
      let target = '', sick = false;
      for (const j of D.starveOrder) if (s.ill[j] > 0) { target = j; sick = true; break; }
      if (!target) for (const j of D.starveOrder) if (s.units[j] > 0) { target = j; break; }
      if (target) died += killUnit(s, target, sick);
      else if (s.party.cavalry > 0) { s.party.cavalry--; s.res.corpses++; died++; }
      else if (s.party.soldier > 0) { s.party.soldier--; s.res.corpses++; died++; }
    }
    if (died) log(s, died === 1 ? 'A citizen starved to death. Get more farmers working!' : `${died} citizens starved to death.`, 'bad');
    adjustMorale(s, -0.01);
  }
  function spreadPlague(s, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      const j = randomHealthyWorker(s);
      if (!j) break;
      s.units[j]--; s.ill[j]++; got++;
    }
    return got;
  }
  function doHealers(s, p) {
    const healers = s.units.healer + s.cats * num(has(s, 'companion'));
    s.cureCarry += healers * D.rates.healer * s.morale;
    s.cureCarry = Math.min(s.cureCarry, p.sick);
    while (s.cureCarry >= 1 && s.res.herbs >= 1) {
      const j = D.patientOrder.find(k => s.ill[k] > 0);
      if (!j) break;
      s.ill[j]--; s.units[j]++;
      s.cureCarry--; s.res.herbs--;
    }
  }
  function doPlague(s) {
    const sickJobs = D.patientOrder.filter(k => s.ill[k] > 0);
    if (!sickJobs.length) return;
    const j = sickJobs[Math.floor(rnd() * sickJobs.length)];
    const roll = 100 * rnd() + 1;
    if (roll <= 5) { killUnit(s, j, true); log(s, `A sick ${D.jobs[j].name.toLowerCase()} died.`, 'bad'); }
    else if (roll > 99.9) { if (spreadPlague(s, 1)) log(s, 'The sickness spread to someone new.', 'warn'); }
  }
  function doCorpses(s) {
    if (s.res.corpses <= 0) return;
    if (50 * rnd() * (1 + num(has(s, 'feast'))) >= 1) return;
    const p = pop(s);
    const n = spreadPlague(s, Math.floor((p.living / 100) * rnd()));
    if (n > 0) { log(s, `${n} citizen${n > 1 ? 's' : ''} fell sick from the unburied dead. Build an herbalist and graveyards.`, 'warn'); emit('sick', { n }); }
    if (rnd() < 0.5) s.res.corpses -= 1;
  }
  function doGraveyards(s) {
    const n = Math.min(s.units.cleric, s.res.corpses, s.graves);
    if (n > 0) { s.res.corpses -= n; s.graves -= n; }
  }
  function tickWalk(s) {
    const p = pop(s);
    if (s.walkRate > p.healthy) s.walkRate = p.healthy;
    for (let i = 0; i < s.walkRate; i++) { const j = randomHealthyWorker(s); if (!j) break; s.units[j]--; }
  }

  // ---------- production ----------
  // Steady production and use of a resource this tick, for the top bar (display only).
  // Only resources something eats every second get an entry: food (everyone), skins and ore
  // (tanners, blacksmiths) and the wonder's materials (builders).
  function flow(s, r, made, used) {
    if (!s._flow) return;
    const f = s._flow[r] || (s._flow[r] = { in: 0, out: 0 });
    f.in += made; f.out += used;
  }
  function production(s, p) {
    const m = s.morale, u = s.units, R = D.rates;
    // Seasons (js/seasons.js): both are exactly 1 unless season effects are turned on.
    const seasonFarm = Seasons.farmMult(s), seasonWork = Seasons.workMult(s);
    const millMod = p.current > 0 ? p.living / p.current : 1;
    // Farmers
    let food = u.farmer * (1 + farmEfficiency(s) * m) * (s.pestTimer > 0 ? 1.01 : 1)
      * wonderBonus(s, 'food') * (1 + s.walkRate / 120) * (1 + s.bld.mill * millMod * R.millBonus) * seasonFarm * seasonWork;
    s.res.food += food - p.living * D.population.eats;
    flow(s, 'food', food, p.living * D.population.eats);
    if (has(s, 'skinning') && u.farmer > 0) {
      const chance = (D.clickSpecialChance + 0.1 * num(has(s, 'flensing'))) * (1 + num(has(s, 'butchering')) * u.farmer / 15) * wonderBonus(s, 'skins');
      s.res.skins += rndRound(chance);
      flow(s, 'skins', chance, 0); // average, since the real gain is random
    }
    // Woodcutters
    s.res.wood += u.woodcutter * R.woodcutter * m * wonderBonus(s, 'wood') * seasonWork;
    if (has(s, 'harvesting') && u.woodcutter > 0) {
      s.res.herbs += rndRound(D.clickSpecialChance * (1 + num(has(s, 'gardening')) * u.woodcutter / 5) * wonderBonus(s, 'herbs'));
    }
    // Miners
    s.res.stone += u.miner * R.miner * m * wonderBonus(s, 'stone') * seasonWork;
    if (has(s, 'prospecting') && u.miner > 0) {
      const chance = (D.clickSpecialChance + 0.1 * num(has(s, 'macerating'))) * (1 + num(has(s, 'extraction')) * u.miner / 5) * wonderBonus(s, 'ore');
      s.res.ore += rndRound(chance);
      flow(s, 'ore', chance, 0);
    }
    // Blacksmiths and tanners
    const ore = Math.min(s.res.ore, u.blacksmith * R.blacksmith * m);
    s.res.ore -= ore; s.res.metal += ore * wonderBonus(s, 'metal');
    flow(s, 'ore', 0, ore);
    const skins = Math.min(s.res.skins, u.tanner * R.tanner * m);
    s.res.skins -= skins; s.res.leather += skins * wonderBonus(s, 'leather');
    flow(s, 'skins', 0, skins);
    // Priests
    s.res.piety += u.cleric * (R.cleric * (1 + num(has(s, 'writing'))))
      * (1 + num(has(s, 'secrets')) * (1 - 100 / (s.bld.graveyard + 100))) * m * wonderBonus(s, 'piety');
  }
  function clampStorage(s) {
    for (const r of ['food', 'wood', 'stone']) {
      const cap = storage(s, r);
      if (s.res[r] > cap) {
        // Remember what spilled over, so the top bar can still show the real rate when storage is full.
        if (s._over) s._over[r] = (s._over[r] || 0) + s.res[r] - cap;
        s.res[r] = cap;
      }
    }
    for (const r of RES) if (s.res[r] < 0) s.res[r] = 0;
  }

  function checkAchievements(s) {
    const p = pop(s), A = s.ach;
    const size = civSize(p.living);
    if (size.idx > 0) A['size_' + size.id] = true;
    if (s.party.siege > 0) A.engineer = true;
    if (p.living > 0 && s.morale <= 0.5) A.hated = true;
    if (p.living > 0 && s.morale >= 1.5) A.loved = true;
    if (s.cats >= 1) A.cat = true;
    if (s.cats >= 10) A.glaring = true;
    if (s.cats >= 100) A.clowder = true;
    if (p.sick > p.healthy && p.sick > 0) A.plagued = true;
    if (p.living === 0 && p.limit >= 1000) A.ghostTown = true;
    const dom = domain(s);
    if (dom) A[dom] = true;
    if (A.battle && A.fields && A.underworld && A.cats) A.fullHouse = true;
    if (s.res.gold > 0) A.merchant = true;
  }

  // One second of game time.
  function tick(s, offline) {
    const before = Object.assign({}, s.res);
    s._over = {};
    s._flow = {};
    const p = pop(s);
    production(s, p);
    doStarve(s, offline);
    clampStorage(s);
    if (!offline) {
      doMobs(s);
      doShades(s);
      doEnemySiege(s);
      doRaid(s);
      doPlague(s);
      doCorpses(s);
      tickWalk(s);
      tickTraders(s);
    }
    if (s.pestTimer > 0) s.pestTimer--;
    if (s.gloryTimer > 0) s.gloryTimer--;
    if (s.graceCost > 1000) s.graceCost = Math.floor(s.graceCost - 1);
    doGraveyards(s);
    doHealers(s, pop(s));
    if (s.throneCount >= 100) {
      const t = Math.floor(s.throneCount / 100);
      s.bld.temple += t; s.throneCount = 0;
      log(s, `Trophies of the slain raised ${t} new shrine${t > 1 ? 's' : ''}.`, 'good');
    }
    doLabourers(s);
    clampStorage(s);
    checkAchievements(s);
    s.clock = (s.clock || 0) + 1;
    Seasons.tick(s, offline);
    // Per-second change of each resource, for the top bar.
    const net = {};
    // Per-second change of each resource, counting what overflowed full storage.
    for (const r of RES) net[r] = s.res[r] - before[r] + (s._over[r] || 0);
    s._over = null;
    s._net = net;
  }

  // ---------- new age (prestige reset) ----------
  function canNewAge(s) { return has(s, 'worship') || s.wonder.stage === 3; }
  function newAge(s) {
    const n = newState();
    const old = s.deities.slice();
    if (!old[0].maxDev) old.shift();
    n.deities = [{ name: '', domain: '', maxDev: 0 }].concat(old);
    n.wonders = s.wonders.slice();
    n.cats = s.cats;
    n.ach = Object.assign({}, s.ach);
    n.civName = s.civName; n.rulerName = s.rulerName;
    n.pace = s.pace;
    n.sound = Object.assign({}, s.sound);
    n.seasonCfg = Object.assign({}, s.seasonCfg);
    return n;
  }

  // ---------- save / load ----------
  function serialize(s) {
    s.savedAt = Date.now();
    const copy = Object.assign({}, s);
    delete copy._net; delete copy._over; delete copy._flow;
    return JSON.stringify(copy);
  }
  function revive(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || data.v !== 1 || !data.res || !data.units) throw new Error('Not a Hearthstead save');
    const base = newState();
    const s = Object.assign(base, data);
    for (const k of ['res', 'bld', 'units', 'ill', 'party', 'enemies', 'raid', 'trader', 'wonder', 'seasonCfg', 'evt']) s[k] = Object.assign(newState()[k], data[k]);
    if (!Array.isArray(s.deities) || !s.deities.length) s.deities = [{ name: '', domain: '', maxDev: 0 }];
    s.pace = paceOf(s);
    s.sound = Object.assign(newState().sound, data.sound);
    s.clock = Math.max(0, Math.floor(Number(s.clock) || 0));
    s.seasonCfg.show = s.seasonCfg.show !== false; s.seasonCfg.play = s.seasonCfg.play === true;
    return s;
  }
  function saveLocal(s) { try { localStorage.setItem(SAVE_KEY, serialize(s)); return true; } catch (e) { return false; } }
  function loadLocal() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? revive(raw) : null; } catch (e) { return null; }
  }
  function clearLocal() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
  function exportString(s) { return btoa(unescape(encodeURIComponent(serialize(s)))); }
  function importString(str) { return revive(decodeURIComponent(escape(atob(str.trim())))); }

  // Game speed. 1 is the classic pacing; at N the game clock runs N ticks
  // per real second (production, wonders, merchants, attacks, timers).
  const PACE_MAX = 10;
  function paceOf(s) {
    const p = Math.round(Number(s && s.pace));
    return p >= 1 ? Math.min(p, PACE_MAX) : 1;
  }
  function setPace(s, p) { s.pace = paceOf({ pace: p }); return s.pace; }

  // Time away: the economy keeps running, but nobody starves, gets sick or
  // is attacked while you're gone. `seconds` is real time; the cap is too.
  function catchUp(s, seconds) {
    seconds = Math.floor(Math.min(seconds, D.offlineCapHours * 3600));
    if (seconds < 2) return null;
    const before = Object.assign({}, s.res, { pop: pop(s).living });
    s.walkRate = 0;
    const ticks = seconds * paceOf(s);
    for (let i = 0; i < ticks; i++) tick(s, true);
    return { seconds, before, after: Object.assign({}, s.res, { pop: pop(s).living }) };
  }

  // ---------- number formatting (shared with the UI) ----------
  function fmt(n) {
    if (n === Infinity) return '∞';
    if (!isFinite(n)) return '0';
    const a = Math.abs(n);
    if (a >= 1e6) {
      const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
      let i = 0, v = a;
      while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
      return (n < 0 ? '-' : '') + v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0) + units[i];
    }
    if (a >= 100 || Number.isInteger(n)) return Math.floor(n).toLocaleString('en-US');
    return n.toFixed(a < 10 ? 1 : 0);
  }

  window.Sim = {
    D, RES, JOBS, BLD, ENEMIES,
    newState, pop, civSize, civTitle, sizeMaxPop, storage, freeLand, usedLand, housing,
    jobLimit, jobTotal, jobUnlocked, combatMod, farmEfficiency, deity, domain, devotion,
    meetsReq, buildingCost, altarCost, canAfford, wonderBonus, wonderCostMult, wonderLimitedBy, haveWonderTech,
    clickIncrement, gather, workerCost, maxRecruit, spawn, canHire, setJob,
    buildingUnlocked, canBuild, build, buildAltar, upgradeVisible, buyUpgrade, has,
    nameDeity, selectDomain, prayerVisible, prayers, raiseDeadCost, iconoclasm,
    moveToParty, canRaid, invade, plunder, enemiesAtHome, spawnMob,
    trade, buy, startTrader, startWonder, rushWonder, chooseWonderBonus,
    canNewAge, newAge, tick, catchUp, adjustMorale, log, on, emit, fmt,
    paceOf, setPace, PACE_MAX,
    saveLocal, loadLocal, clearLocal, exportString, importString, serialize, revive,
  };
})();
