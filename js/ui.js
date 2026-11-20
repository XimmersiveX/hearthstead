// =====================================================================
//  UI: top bar, side panel tabs, alerts, menus and messages.
//  The panel is rebuilt as HTML text and then "patched" into the page,
//  so buttons stay put (and clickable) while numbers tick.
// =====================================================================
(function () {
  const D = window.GAME_DATA;
  const $ = sel => document.querySelector(sel);
  const fmt = n => Sim.fmt(n);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let state, actions, tab = 'build';

  // ---------- tiny DOM patcher ----------
  function morph(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b.cloneNode(true)); return; }
    if (a.nodeType === 3) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    if (a.nodeType !== 1) return;
    for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    if (a.nodeName === 'BUTTON' || a.nodeName === 'INPUT' || a.nodeName === 'SELECT') a.disabled = b.hasAttribute('disabled');
    if (a.nodeName === 'SELECT') { morphChildren(a, b); const sel = b.querySelector('option[selected]'); if (sel && document.activeElement !== a) a.value = sel.value; return; }
    if (a.nodeName === 'INPUT') return; // keep what the player typed
    morphChildren(a, b);
  }
  function morphChildren(a, b) {
    const bc = Array.from(b.childNodes);
    for (let i = 0; i < bc.length; i++) {
      const ac = a.childNodes[i];
      if (!ac) a.appendChild(bc[i].cloneNode(true)); else morph(ac, bc[i]);
    }
    while (a.childNodes.length > bc.length) a.removeChild(a.lastChild);
  }
  function patch(el, html) {
    const tmp = document.createElement(el.nodeName);
    tmp.innerHTML = html;
    morphChildren(el, tmp);
  }

  // ---------- bottom-table layout: sections side by side ----------
  // In the "table" controls layout (wide screens), each section of a tab
  // (Housing, Storage, ...) becomes a block of tiles that fills downward
  // and then across, so the whole tab fits the wide panel without scrolling.
  let dockRows = 2;
  // The table look (any screen size): framed sections, stats in the rail. Phones get it too, in the drawer.
  function dockMode() {
    return document.documentElement.dataset.look !== 'classic';
  }
  const wideScreen = () => window.matchMedia('(min-width: 801px)').matches;
  // Small icons for section titles, tinted in the section's colour (drawn as a CSS mask).
  const SEC_ICONS = [
    [/housing/, 'M12 3 2 12h3v8h5v-5h4v5h5v-8h3z'],
    [/storage/, 'M3 4h18v5H3zM4 10h16v10H4zm5 2v2h6v-2z'],
    [/workshop/, 'M3 6h14c0 3-2 5-5 5v2h2l3 5H5l3-5h2v-2H8C5 11 3 9 3 6zm15 0h3v2h-3z'],
    [/primary|gather/, 'M11 3h2v19h-2zM6 5c3 0 5.5 2 6 5-3.5 0-6-2-6-5zm12 0c0 3-2.5 5-6 5 .5-3 3-5 6-5zM6 11c3 0 5.5 2 6 5-3.5 0-6-2-6-5zm12 0c0 3-2.5 5-6 5 .5-3 3-5 6-5z'],
    [/trades|craft/, 'M2 4h12v5H2zM6 9h3v13H6zM15 4.5 21 6v3l-6-1.5z'],
    [/health|heal/, 'M9.5 2h5v7.5H22v5h-7.5V22h-5v-7.5H2v-5h7.5z'],
    [/military|defen/, 'M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z'],
    [/job/, 'M12 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 21c0-4.5 3-8 7-8s7 3.5 7 8z'],
    [/learned/, 'M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z'],
    [/available|skill/, 'M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3zm3 5v2h8V8zm0 4v2h8v-2z'],
    [/faith|pray|bless|god|deity/, 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z'],
    [/raid|target/, 'M5 2h2v20H5zM8 3h11l-3 4 3 4H8z'],
    [/merchant|gold|trade/, 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12z'],
    [/wonder/, 'M12 2 3 7h18zM5 9h3v9H5zm5.5 0h3v9h-3zM16 9h3v9h-3zM3 19h18v3H3z'],
  ];
  function secIcon(title) {
    const t = (title || '').toLowerCase();
    const hit = SEC_ICONS.find(([re]) => re.test(t));
    const d = hit ? hit[1] : 'M12 3l9 9-9 9-9-9z';
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='${d}'/></svg>`)}")`;
  }
  function regroup(tmp) {
    const groups = [];
    let cur = null;
    for (const k of Array.from(tmp.childNodes)) {
      if (k.nodeType !== 1) continue;
      const isTitle = k.classList.contains('section-title');
      if (isTitle || !cur) { cur = { title: null, items: [] }; groups.push(cur); }
      if (isTitle) cur.title = k; else cur.items.push(k);
    }
    const isCard = n => n.classList.contains('card');
    // Things before the first heading: loose bits go in a full-width strip, tiles in their own block.
    if (groups.length && !groups[0].title && groups[0].items.some(isCard) && !groups[0].items.every(isCard)) {
      const g = groups.shift();
      groups.unshift({ title: null, items: g.items.filter(n => !isCard(n)) }, { title: null, items: g.items.filter(isCard) });
    }
    tmp.textContent = '';
    let carry = null, secN = 0;
    groups.forEach((g, i) => {
      const next = groups[i + 1];
      // A heading with nothing under it (like "Land") rides along in the next heading.
      if (g.title && !g.items.length && next && next.title) { carry = g.title; return; }
      if (carry && g.title) {
        const sp = document.createElement('span');
        sp.className = 'carried';
        sp.textContent = Array.from(carry.children).map(c => c.textContent).join(': ');
        g.title.appendChild(sp);
        carry = null;
      }
      const sec = document.createElement('div');
      if (g.items.some(isCard)) {
        const cols = Math.ceil(g.items.length / dockRows);
        sec.className = 'sec cols' + (g.title ? '' : ' notitle');
        // each titled section gets its own colour (title marker, tile edges, top of its frame)
        const hue = g.title ? `;--sec:var(--sec-${(secN++ % 5) + 1});--ico:${secIcon(g.title.textContent)}` : '';
        sec.setAttribute('style', `--cols:${cols}${hue}`);
      } else sec.className = 'sec wide';
      if (g.title) sec.appendChild(g.title);
      g.items.forEach(n => sec.appendChild(n));
      tmp.appendChild(sec);
    });
  }
  // How many rows of tiles fit in the panel at its current height.
  function measureRows() {
    const el = $('#tabBody'), body = $('#panelBody');
    const first = el.querySelector('.sec.cols');
    if (!first) return dockRows;
    let tileH = 0;
    el.querySelectorAll('.sec.cols:not(.notitle) > .card').forEach(c => { tileH = Math.max(tileH, c.offsetHeight); });
    if (!tileH) el.querySelectorAll('.sec.cols > .card').forEach(c => { tileH = Math.max(tileH, c.offsetHeight); });
    if (!tileH) return dockRows;
    const titled = el.querySelector('.sec.cols:not(.notitle) > .section-title');
    const top = first.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    const cs = getComputedStyle(first); // each section is a framed tray: leave room for its padding and border
    const frame = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((t, k) => t + (parseFloat(cs[k]) || 0), 0);
    const avail = body.clientHeight - top - 6 - frame - (titled ? titled.offsetHeight + 5 : 0);
    return Math.max(1, Math.min(8, Math.floor((avail + 5) / (tileH + 5))));
  }
  // While the player is scrolling the panel (wheel, scrollbar drag, touch), hold off re-drawing it,
  // so a re-draw never lands in the middle of a smooth scroll. It catches up a moment later.
  let scrollingUntil = 0;
  const panelScrolling = () => performance.now() < scrollingUntil;
  function markScrolling() { scrollingUntil = performance.now() + 450; }
  // Rows are re-fitted only when something that decides the fit changes (tab, layout, panel size,
  // number of tiles), not every tick, so a tile growing a line (e.g. "Max (10)") can't reshuffle
  // every section under the mouse.
  let rowsKey = '';
  function patchTab(force) {
    const el = $('#tabBody'), body = $('#panelBody');
    if (!force && panelScrolling()) return;
    const dock = dockMode();
    el.classList.toggle('docked', dock);
    for (let pass = 0; pass < 2; pass++) {
      const tmp = document.createElement('div');
      tmp.innerHTML = TABS[tab]();
      if (dock) { regroup(tmp); el.style.setProperty('--rows', dockRows); }
      const top = body.scrollTop;
      morphChildren(el, tmp);
      if (body.scrollTop !== top) body.scrollTop = top; // keep the player's place
      if (!dock || !wideScreen() || getDock() !== 'bottom') break; // row fitting only matters for the bottom panel
      const key = [tab, getLook(), getDock(), body.clientWidth, body.clientHeight, el.querySelectorAll('.card').length, $('#hintCard').offsetHeight].join('|');
      if (key === rowsKey) break;
      const r = measureRows();
      if (r === dockRows) { rowsKey = key; break; }
      dockRows = r;
    }
  }

  // ---------- shared bits ----------
  function costHtml(cost, qty) {
    if (!cost) return '';
    qty = qty || 1;
    return Object.keys(cost).filter(r => cost[r]).map(r => {
      const need = cost[r] * qty, short = state.res[r] < need;
      // Hovering shows the resource's name instantly (see initTips); the less familiar ones also show it inline.
      const R = D.resources[r], name = R.name.toLowerCase();
      return `<span class="${short ? 'short' : ''}" data-tip="${R.name}" data-res="${r}" data-each="${need}"><i class="ci">${R.icon}</i> ${fmt(Math.ceil(need))}${R.basic ? '' : ` <small class="cn">${name}</small>`}</span>`;
    }).join('');
  }
  const btn = (act, label, enabled, extra) => `<button class="btn small ${extra && extra.cls || ''}" data-act="${act}"${extra && extra.data ? ' ' + extra.data : ''}${enabled ? '' : ' disabled'}>${label}</button>`;
  const ghost = (act, label, enabled, data) => btn(act, label, enabled, { cls: 'ghost', data });

  // ---------- top bar ----------
  const SHOW_ALWAYS = ['food', 'wood', 'stone'];
  const NO_RATE = ['gold']; // nothing makes these over time
  function renderChips() {
    const s = state, net = s._net || {};
    let html = '';
    const p = Sim.pop(s);
    html += `<div class="chip big"><span class="ico">👥</span><div class="col"><div class="line"><span class="num">${fmt(p.living)}</span><span class="cap">/ ${fmt(p.limit)}</span></div><div class="line"><span class="rate">${moraleLabel(s)}</span></div></div></div>`;
    for (const r of Sim.RES) {
      const R = D.resources[r];
      if (!SHOW_ALWAYS.includes(r) && s.res[r] < 1 && !(r === 'piety' && s.bld.temple > 0)) continue;
      const cap = Sim.storage(s, r);
      const rate = (net[r] || 0) * Sim.paceOf(s); // per real second
      // Resources something eats every second show made / used; the rest show the net change.
      const F = (s._flow || {})[r], used = F ? F.out * Sim.paceOf(s) : 0, made = F ? F.in * Sim.paceOf(s) : 0;
      const split = used >= 0.005;
      // One net figure with a trend arrow: ▲ gaining, ▼ losing, ▶ holding steady. Made / used is in the tooltip.
      const flat = Math.abs(rate) < 0.005;
      // Always show a rate (grey ▶ 0/s when nothing's happening) so the chips never change size and the bar doesn't jump.
      const rateTxt = flat ? '▶ 0/s' : `${rate > 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(rate))}/s`;
      const tip = `data-tip="${R.name}"${split ? ` data-tip2="making ${fmt(made)}/s · using ${fmt(used)}/s"` : ''}`;
      const rateCls = flat ? 'flat' : rate > 0 ? 'pos' : 'neg';
      const danger = r === 'food' && rate < 0 && s.res.food < -rate * 20;
      if (R.basic) {
        const pct = Math.min(100, (s.res[r] / cap) * 100);
        html += `<div class="chip big${danger ? ' danger' : ''}${pct >= 99.9 ? ' full' : ''}" ${tip}><span class="ico">${R.icon}</span><div class="col">`
          + `<div class="line"><span class="num">${fmt(Math.floor(s.res[r]))}</span><span class="cap">/ ${fmt(cap)}</span></div>`
          + `<div class="line"><span class="rate ${rateCls}">${rateTxt || '&nbsp;'}</span></div>`
          + `<div class="bar"><i style="width:${pct}%;background:${R.color}"></i></div></div></div>`;
      } else {
        // Gold only comes from trading and raids, never per second, so its chip has no rate line.
        const norate = NO_RATE.includes(r);
        html += `<div class="chip${norate ? ' norate' : ''}" ${tip}><span class="ico">${R.icon}</span><span class="num">${fmt(Math.floor(s.res[r]))}</span>${norate ? '' : `<span class="rate ${rateCls}">${rateTxt}</span>`}</div>`;
      }
    }
    patch($('#resChips'), html);
    $('#civName').textContent = s.civName;
    $('#civSize').textContent = `${Sim.civTitle(s)} · ruled by ${s.rulerName}`;
    renderSeason();
  }
  // Season and year in the top bar (when either season setting is on).
  function renderSeason() {
    const s = state, C = s.seasonCfg, el = $('#seasonTag');
    if (!C.show && !C.play) { if (el.innerHTML) el.innerHTML = ''; return; }
    const se = Seasons.info(s);
    const fx = Seasons.playing(s) && (s.evt.drought > 0 || s.evt.lessons > 0)
      ? ` <span class="fx">${s.evt.drought > 0 ? '🌵' : ''}${s.evt.lessons > 0 ? '📚' : ''}</span>` : '';
    const html = `${se.icon} ${se.name} · Year ${se.year}${fx}`;
    if (el.innerHTML !== html) el.innerHTML = html;
    const notes = Seasons.activeNotes(s);
    const left = Math.ceil((1 - se.frac) * D.seasons.length / Sim.paceOf(s));
    const tip = `${se.name}, year ${se.year}. About ${left}s until ${D.seasons.list[(se.idx + 1) % 4].name.toLowerCase()}.` + (notes.length ? '\n' + notes.join('\n') : '\nSeason effects are off (Menu → Seasons).');
    if (el.title !== tip) el.title = tip;
  }
  function moraleLabel(s) {
    const m = s.morale;
    if (Sim.pop(s).living < 1) return 'Nobody yet';
    if (m > 1.4) return '😁 Ecstatic';
    if (m > 1.2) return '🙂 Happy';
    if (m > 0.8) return '😐 Content';
    if (m > 0.6) return '🙁 Unhappy';
    return '😠 Angry';
  }

  // ---------- tabs ----------
  function tabsAvailable() {
    const s = state;
    const t = [['build', '🏗️', 'Build'], ['people', '👥', 'People'], ['tech', '📜', 'Learn']];
    if (s.bld.temple > 0 || Sim.has(s, 'worship') || s.deities.length > 1) t.push(['faith', '🙏', 'Faith']);
    if (s.bld.barracks > 0 || s.bld.stable > 0 || Sim.enemiesAtHome(s) > 0 || s.units.soldier > 0) t.push(['war', '⚔️', 'War']);
    if (s.res.gold > 0 || s.trader.timer > 0 || Sim.has(s, 'trade') || Sim.haveWonderTech(s) || s.wonders.length) t.push(['trade', '🪙', 'Trade']);
    return t;
  }
  function renderTabs() {
    const s = state;
    const list = tabsAvailable();
    if (!list.some(x => x[0] === tab)) tab = 'build';
    const dots = {
      war: Sim.enemiesAtHome(s) > 0 || s.raid.victory,
      trade: s.trader.timer > 0,
      people: s.units.unemployed > 0 && Sim.pop(s).living > 0,
    };
    patch($('#tabs'), list.map(([id, ico, label]) => `<button class="tab-btn${id === tab ? ' active' : ''}" data-tab="${id}"><span class="t-ico">${ico}</span> <span class="t-lbl">${label}</span>${dots[id] && id !== tab ? '<span class="dot"></span>' : ''}</button>`).join(''));
  }

  // ---------- population stats under the tab rail (bottom-table layout only) ----------
  function railStats() {
    if (!dockMode()) return '';
    const s = state, p = Sim.pop(s);
    const row = (ico, k, v, cls, tip) => `<div class="rs${cls ? ' ' + cls : ''}" data-tip="${k}"${tip ? ` data-tip2="${tip}"` : ''}><span class="rs-k"><span class="rs-i">${ico}</span><span class="rs-l">${k}</span><span class="rs-s">${({ Population: 'Pop.', Corpses: 'Dead' })[k] || k}</span></span><b>${v}</b></div>`;
    const free = Sim.freeLand(s);
    // the rail is narrow: big numbers get shortened (124,161 → 124.2K); hover a row for exact figures
    const k = n => {
      const a = Math.abs(n);
      if (a < 1e4 || a >= 1e6) return fmt(n);
      return a < 999500 ? (n / 1000).toFixed(a < 1e5 ? 1 : 0) + 'K' : (n / 1e6).toFixed(2) + 'M';
    };
    return row('👥', 'Population', `${k(p.living)}<small> / ${k(p.limit)}</small>`, p.living > p.limit ? 'warn' : '', `${fmt(p.living)} of ${fmt(p.limit)} housing`)
      + row('🗺️', 'Land', `${k(free)}<small> / ${k(s.land)}</small>`, free < 0 ? 'bad' : '',
        free < 0 ? 'Built on more land than you own: overcrowding hurts morale. Win land by raiding.' : `${fmt(free)} free of ${fmt(s.land)} land`)
      + row('💤', 'Idle', k(s.units.unemployed), s.units.unemployed > 0 ? 'hi' : '')
      + row('🤒', 'Sick', k(p.sick), p.sick ? 'warn' : '')
      + row('💀', 'Corpses', k(s.res.corpses), s.res.corpses > 0 ? 'warn' : '')
      + row('🪦', 'Graves', k(s.graves), '')
      + (s.zombies ? row('🧟', 'Undead', k(s.zombies), '') : '')
      + row('🐈', 'Cats', k(s.cats), '');
  }

  // ---------- hint card for new players ----------
  function hint() {
    const s = state, p = Sim.pop(s);
    if (p.limit === 0) {
      if (s.res.skins < 2) return 'Tap the <b>fields</b>, <b>forest</b> and <b>quarry</b> (or the buttons below them). Each tap has a small chance to find <b>skins 🦊</b>. You need 2 wood and 2 skins for your first <b>Tent</b>.';
      return 'You have enough to raise a <b>Tent ⛺</b>. Build one in the Build tab so someone can move in.';
    }
    if (p.living === 0) return 'Your tent is ready. Gather <b>20 food</b>, then recruit your first citizen in the <b>People</b> tab.';
    if (s.units.farmer === 0) return 'Every citizen eats <b>1 food per second</b>. Make some of them <b>farmers</b> (each grows 1.2) in the People tab before you run out.';
    if (!Sim.has(s, 'masonry') && p.living >= 5) return 'Save up 100 wood and 100 stone to learn <b>Masonry</b> in the Learn tab. It unlocks cottages, workshops and shrines.';
    return '';
  }

  // ---------- BUILD tab ----------
  function buildCard(id) {
    const s = state, B = D.buildings[id];
    const cost = Sim.buildingCost(s, id);
    const variable = typeof B.cost === 'function';
    const max = Sim.canBuild(s, id);
    let acts = btn('build', '+1', max >= 1, { data: `data-id="${id}" data-n="1"` });
    if (!variable) {
      acts += ghost('build', '+10', max >= 10, `data-id="${id}" data-n="10"`);
      acts += ghost('build', '+100', max >= 100, `data-id="${id}" data-n="100"`);
      acts += ghost('build', `Max (${fmt(max)})`, max >= 1, `data-id="${id}" data-n="max"`);
    } else {
      acts += ghost('build', '+10', max >= 1, `data-id="${id}" data-n="10"`);
    }
    return `<div class="card"><div class="big">${B.icon}</div><div class="name">${B.name}<span class="owned">${s.bld[id] ? fmt(s.bld[id]) : ''}</span></div><div></div>`
      + `<div class="desc" title="${esc(B.desc)}">${B.desc}</div><div class="cost">${costHtml(cost)}</div><div class="acts">${acts}</div></div>`;
  }
  function renderBuild() {
    const s = state;
    const free = Sim.freeLand(s);
    // In the bottom-table layout, free land is shown in the tab rail instead (see railStats).
    let html = dockMode() ? '' : `<div class="section-title"><span>Land</span><span>${fmt(Math.max(0, free))} free of ${fmt(s.land)}</span></div>`;
    if (free < 0) html += `<div class="card plain"><span class="note" style="color:var(--warn)">You've built on more land than you own. Overcrowding hurts morale. Win land by raiding.</span></div>`;
    const groups = {};
    for (const id of Sim.BLD) {
      if (!Sim.buildingUnlocked(s, id)) continue;
      (groups[D.buildings[id].group] = groups[D.buildings[id].group] || []).push(id);
    }
    for (const g of ['Housing', 'Storage', 'Workshops', 'Military']) {
      if (!groups[g]) continue;
      html += `<div class="section-title"><span>${g}</span></div>` + groups[g].map(buildCard).join('');
    }
    const locked = Sim.BLD.filter(id => !Sim.buildingUnlocked(s, id)).length;
    if (locked) html += `<p class="note">${locked} more buildings unlock as you learn new skills.</p>`;
    return html;
  }

  // ---------- PEOPLE tab ----------
  function jobEffect(job) {
    const s = state, u = s.units, R = D.rates;
    const m = s.morale * Sim.paceOf(s); // rates shown per real second
    switch (job) {
      case 'farmer': return u.farmer ? `+${fmt(u.farmer * (1 + Sim.farmEfficiency(s) * m) * Sim.wonderBonus(s, 'food') * (1 + s.bld.mill * R.millBonus) * Seasons.farmMult(s) * Seasons.workMult(s))} food/s` : '';
      case 'woodcutter': return u.woodcutter ? `+${fmt(u.woodcutter * R.woodcutter * m * Sim.wonderBonus(s, 'wood') * Seasons.workMult(s))} wood/s` : '';
      case 'miner': return u.miner ? `+${fmt(u.miner * R.miner * m * Sim.wonderBonus(s, 'stone') * Seasons.workMult(s))} stone/s` : '';
      case 'tanner': return u.tanner ? (s.res.skins >= 1 ? `${fmt(u.tanner * R.tanner * m)} skins → leather /s` : 'Waiting for skins') : '';
      case 'blacksmith': return u.blacksmith ? (s.res.ore >= 1 ? `${fmt(u.blacksmith * R.blacksmith * m)} ore → metal /s` : 'Waiting for ore') : '';
      case 'healer': return u.healer ? (Sim.pop(s).sick ? (s.res.herbs >= 1 ? `Treating the sick` : 'Out of herbs!') : 'Nobody is sick') : '';
      case 'cleric': return u.cleric ? `+${fmt(u.cleric * R.cleric * (1 + (Sim.has(s, 'writing') ? 1 : 0)) * m * Sim.wonderBonus(s, 'piety'))} faith/s` : '';
      case 'labourer': { const low = Sim.wonderLimitedBy(s); return u.labourer ? (low ? `Stalled: out of ${D.resources[low].name.toLowerCase()}` : `Building ${esc(s.wonder.name)}`) : ''; }
      default: return '';
    }
  }
  function jobCard(job) {
    const s = state, J = D.jobs[job];
    const lim = Sim.jobLimit(s, job);
    const total = Sim.jobTotal(s, job);
    const hire = Sim.canHire(s, job);
    const have = s.units[job];
    const eff = jobEffect(job);
    const sick = s.ill[job] ? ` <span class="sub">(${fmt(s.ill[job])} sick)</span>` : '';
    const away = s.party[job] ? ` <span class="sub">(${fmt(s.party[job])} raiding)</span>` : '';
    const d = `data-job="${job}"`;
    return `<div class="card job"><div class="big">${J.icon}</div><div><div class="name">${J.name}<span class="owned">${have || lim !== Infinity ? fmt(have) + (lim === Infinity ? '' : ` / ${fmt(lim)}`) : ''}</span>${sick}${away}</div>`
      + `<div class="desc" style="grid-column:auto" title="${esc(J.desc)}">${J.desc}</div>${J.cost ? `<div class="cost">Each: ${costHtml(J.cost)}</div>` : ''}${eff ? `<div class="effect${/Waiting|Out|Stalled/.test(eff) ? ' off' : ''}" style="grid-column:auto">${eff}</div>` : ''}</div>`
      + `<div class="stepper s100"><button data-act="job" ${d} data-n="-1"${have ? '' : ' disabled'}>−1</button><button data-act="job" ${d} data-n="-10"${have ? '' : ' disabled'}>−10</button>`
      + `<button data-act="job" ${d} data-n="-100"${have ? '' : ' disabled'}>−100</button><button data-act="job" ${d} data-n="-max"${have ? '' : ' disabled'}>−all</button>`
      + `<button data-act="job" ${d} data-n="1"${hire >= 1 ? '' : ' disabled'}>+1</button><button data-act="job" ${d} data-n="10"${hire >= 1 ? '' : ' disabled'}>+10</button>`
      + `<button data-act="job" ${d} data-n="100"${hire >= 1 ? '' : ' disabled'}>+100</button>`
      + `<button data-act="job" ${d} data-n="max"${hire >= 1 ? '' : ' disabled'}>+all</button></div></div>`;
    void total;
  }
  function renderPeople() {
    const s = state, p = Sim.pop(s);
    const max = Sim.maxRecruit(s);
    const c1 = Sim.workerCost(s, 1);
    // In the bottom-table layout these numbers live in the tab rail instead (see railStats).
    let html = dockMode() ? '' : `<div class="stat-grid">
      <div class="stat"><div class="k">Population</div><div class="v">${fmt(p.living)} / ${fmt(p.limit)}</div></div>
      <div class="stat"><div class="k">Idle</div><div class="v">${fmt(s.units.unemployed)}</div></div>
      <div class="stat"><div class="k">Sick</div><div class="v" style="${p.sick ? 'color:var(--warn)' : ''}">${fmt(p.sick)}</div></div>
      <div class="stat"><div class="k">Corpses</div><div class="v">${fmt(s.res.corpses)}</div></div>
      <div class="stat"><div class="k">Empty graves</div><div class="v">${fmt(s.graves)}</div></div>
      <div class="stat"><div class="k">${s.zombies ? 'Undead' : 'Cats'}</div><div class="v">${fmt(s.zombies ? s.zombies : s.cats)}${s.zombies && s.cats ? ` · 🐈 ${fmt(s.cats)}` : ''}</div></div>
    </div>`;
    html += `<div class="card"><div class="big">🧑</div><div class="name">Recruit citizens</div><div></div>`
      + `<div class="desc">Costs ${fmt(c1)} food each, rising slightly as you grow. Needs room in your housing.</div>`
      + `<div class="acts">${btn('spawn', '+1', max >= 1, { data: 'data-n="1"' })}${ghost('spawn', '+10', max >= 10, 'data-n="10"')}${ghost('spawn', '+100', max >= 100, 'data-n="100"')}${ghost('spawn', `Max (${fmt(max)})`, max >= 1, 'data-n="max"')}</div>`
      + `<div class="acts"><span class="note">New citizens become:</span> <select class="textin" id="spawnJob">${['unemployed', 'farmer', 'woodcutter', 'miner'].map(j => `<option value="${j}"${s.spawnJob === j ? ' selected' : ''}>${D.jobs[j].icon} ${D.jobs[j].name}</option>`).join('')}</select>`
      + `${ghost('spawn', 'Dismiss 1 idle', s.units.unemployed > 0, 'data-n="-1"')}</div></div>`;
    // Jobs come in groups; any job not listed here lands in the last group.
    const groups = [['Primary', ['farmer', 'woodcutter', 'miner']], ['Trades', ['tanner', 'blacksmith', 'labourer']], ['Faith &amp; health', ['cleric', 'healer']], ['Military', ['soldier', 'cavalry']]];
    const placed = new Set(groups.flatMap(g => g[1]));
    groups[groups.length - 1][1].push(...Sim.JOBS.filter(j => j !== 'unemployed' && !placed.has(j)));
    let firstGroup = true;
    for (const [title, jobs] of groups) {
      const open = jobs.filter(j => Sim.jobUnlocked(s, j));
      if (!open.length) continue;
      html += `<div class="section-title"><span>${title}</span>${firstGroup ? `<span>${fmt(s.units.unemployed)} idle</span>` : ''}</div>` + open.map(jobCard).join('');
      firstGroup = false;
    }
    const lockedJobs = Sim.JOBS.filter(j => j !== 'unemployed' && !Sim.jobUnlocked(s, j)).map(j => D.jobs[j].name);
    if (lockedJobs.length) html += `<p class="note">More jobs unlock with buildings: ${lockedJobs.join(', ')}.</p>`;
    return html;
  }

  // ---------- LEARN tab ----------
  function upgradeCard(id) {
    const s = state, U = D.upgrades[id];
    const ok = Sim.canAfford(s, U.cost) >= 1;
    return `<div class="card"><div class="big">📜</div><div class="name">${U.name}</div><div>${btn('upgrade', 'Learn', ok, { data: `data-id="${id}"` })}</div>`
      + `<div class="desc" title="${esc(U.desc)}">${U.desc}</div><div class="cost">${costHtml(U.cost)}</div></div>`;
  }
  function renderTech() {
    const s = state;
    const avail = Object.keys(D.upgrades).filter(id => !(D.upgrades[id].tab) && !Sim.has(s, id) && Sim.upgradeVisible(s, id));
    avail.sort((a, b) => (Sim.canAfford(s, D.upgrades[b].cost) >= 1) - (Sim.canAfford(s, D.upgrades[a].cost) >= 1));
    let html = `<div class="section-title"><span>Available</span><span>${avail.length}</span></div>`;
    html += avail.length ? avail.map(upgradeCard).join('') : '<p class="note">Nothing new to learn right now. New ideas appear as you build and learn.</p>';
    const learned = Object.keys(D.upgrades).filter(id => Sim.has(s, id));
    if (learned.length) html += `<div class="section-title"><span>Learned</span><span>${learned.length}</span></div><div>${learned.map(id => `<span class="tag learned" title="${esc(D.upgrades[id].desc)}">✓ ${D.upgrades[id].name}</span>`).join('')}</div>`;
    return html;
  }

  // ---------- FAITH tab ----------
  function prayerCard(id) {
    const s = state, P = D.prayers[id];
    if (!Sim.prayerVisible(s, id)) return `<div class="card locked"><div class="big">🔒</div><div class="name">${P.name}</div><div></div><div class="desc">Needs ${P.devotion} devotion. ${P.desc}</div></div>`;
    let acts = '', extra = '';
    switch (id) {
      case 'smite': { const n = Sim.enemiesAtHome(s); acts = btn('pray', `Strike (${fmt(n)} invaders)`, n > 0 && s.res.piety >= 100, { data: 'data-id="smite"' }); extra = '100 ✨ per invader'; break; }
      case 'glory': acts = btn('pray', s.gloryTimer > 0 ? `Active: ${s.gloryTimer}s` : 'Call to Glory', s.gloryTimer <= 0 && s.res.piety >= 1000, { data: 'data-id="glory"' }); extra = costHtml(P.cost); break;
      case 'wickerman': acts = btn('pray', 'Make the offering', Sim.pop(s).healthy > 0 && s.res.wood >= 500, { data: 'data-id="wickerman"' }); extra = costHtml(P.cost) + '<span>🧑 1 citizen</span>'; break;
      case 'walk': acts = btn('pray', '+1 per second', Sim.pop(s).healthy > s.walkRate, { data: 'data-id="walk" data-n="1"' }) + ghost('pray', 'Stop', s.walkRate > 0, 'data-id="walk" data-n="0"'); extra = `Now: <b>${s.walkRate}</b> per second`; break;
      case 'raiseDead': acts = btn('pray', '+1', s.res.corpses >= 1 && s.res.piety >= Sim.raiseDeadCost(s, 1), { data: 'data-id="raiseDead" data-n="1"' }) + ghost('pray', '+100', s.res.corpses >= 1, 'data-id="raiseDead" data-n="100"') + ghost('pray', 'Max', s.res.corpses >= 1, 'data-id="raiseDead" data-n="max"'); extra = `Next costs ${fmt(Sim.raiseDeadCost(s, 1))} ✨ and 1 ⚰️ · ${fmt(s.zombies)} undead`; break;
      case 'summonShade': acts = btn('pray', 'Call the Shades', s.slain > 0 && s.res.piety >= 1000, { data: 'data-id="summonShade"' }); extra = costHtml(P.cost) + ` · ${fmt(s.slain)} enemies slain · ${fmt(s.shades)} shades`; break;
      case 'pestControl': acts = btn('pray', s.pestTimer > 0 ? `Hunting: ${s.pestTimer}s` : 'Send the cats', s.res.piety >= 100 && s.cats > 0, { data: 'data-id="pestControl"' }); extra = costHtml(P.cost) + ` · ${fmt(s.cats)} cats`; break;
      case 'grace': acts = btn('pray', 'Grace', s.res.piety >= s.graceCost, { data: 'data-id="grace"' }); extra = `<span>✨ ${fmt(s.graceCost)}</span>`; break;
    }
    return `<div class="card"><div class="big">🕯️</div><div class="name">${P.name}</div><div></div><div class="desc">${P.desc}</div><div class="cost">${extra}</div><div class="acts">${acts}</div></div>`;
  }
  function renderFaith() {
    const s = state, d = Sim.deity(s), dom = d.domain;
    let html = '';
    if (!Sim.has(s, 'worship')) {
      html += `<div class="section-title"><span>Faith</span></div><p class="note">Priests in your shrines make faith ✨ and bury the dead in graveyards. Gather 1,000 faith to choose a deity.</p>`;
      if (Sim.upgradeVisible(s, 'worship')) html += upgradeCard('worship');
    } else if (!d.name) {
      html += `<div class="section-title"><span>Name your deity</span></div><div class="card plain"><p class="note">Which god will your people follow?</p><div class="row"><input class="textin" id="deityName" maxlength="40" placeholder="${esc(s.rulerName)}">${btn('nameDeity', 'Worship', true)}</div>`
        + (s.deities.length > 1 ? `<p class="note">Choosing the name of an old deity brings back its domain for free.</p>` : '') + '</div>';
    } else if (!dom) {
      html += `<div class="section-title"><span>${esc(d.name)}</span></div><p class="note">Choose what ${esc(d.name)} is the god of. This costs ${D.deity.domainCost} ✨ and can't be changed this age.</p>`;
      for (const k in D.deity.domains) {
        const Dm = D.deity.domains[k];
        html += `<div class="card"><div class="big">${Dm.icon}</div><div class="name">God of ${Dm.name}</div><div>${btn('domain', 'Choose', s.res.piety >= D.deity.domainCost, { data: `data-id="${k}"` })}</div><div class="desc">${Dm.desc}</div></div>`;
      }
    } else {
      const Dm = D.deity.domains[dom];
      html += `<div class="card plain"><div class="name" style="font-size:16px">${Dm.icon} ${esc(d.name)}, god of ${Dm.name}</div><div class="note">Devotion <b>${Sim.devotion(s)}</b> (from altars) · best ever <b>${d.maxDev}</b></div></div>`;
      const ac = Sim.altarCost(s);
      html += `<div class="card"><div class="big">🔥</div><div class="name">Altar<span class="owned">${s.bld.altar || ''}</span></div><div>${btn('altar', 'Build', Sim.canAfford(s, ac) >= 1)}</div><div class="desc">+1 devotion. Devotion unlocks blessings and prayers.</div><div class="cost">${costHtml(ac)}</div></div>`;
      html += `<div class="section-title"><span>Blessings</span></div>`;
      for (const id in D.upgrades) {
        const U = D.upgrades[id];
        if (U.domain !== dom) continue;
        if (Sim.has(s, id)) html += `<div class="card plain"><span class="tag learned">✓ ${U.name}</span> <span class="note">${U.desc}</span></div>`;
        else if (Sim.upgradeVisible(s, id)) html += upgradeCard(id);
        else html += `<div class="card locked"><div class="big">🔒</div><div class="name">${U.name}</div><div></div><div class="desc">Needs ${U.devotion} devotion. ${U.desc}</div></div>`;
      }
      html += `<div class="section-title"><span>Prayers</span></div>`;
      for (const id in D.prayers) if (D.prayers[id].domain === dom) html += prayerCard(id);
    }
    if (s.deities.length > 1) {
      html += `<div class="section-title"><span>Gods of past ages</span></div>`;
      s.deities.slice(1).forEach((od, i) => {
        const Dm = D.deity.domains[od.domain];
        html += `<div class="card"><div class="big">${Dm ? Dm.icon : '❔'}</div><div class="name">${esc(od.name)}</div><div>${ghost('iconoclasm', 'Melt idols', s.res.piety >= D.deity.iconoclasmCost, `data-i="${i + 1}"`)}</div><div class="desc">${Dm ? 'God of ' + Dm.name : 'No domain'} · best devotion ${od.maxDev}. Melting their idols costs ${fmt(D.deity.iconoclasmCost)} ✨ and gives ${fmt(Math.floor(Math.pow(od.maxDev, 0.8)))} 🪙.</div></div>`;
      });
    }
    return html;
  }

  // ---------- WAR tab ----------
  function renderWar() {
    const s = state, R = s.raid;
    let html = '';
    const foes = Sim.ENEMIES.filter(k => s.enemies[k] > 0);
    if (foes.length || s.enemies.esiege) {
      html += `<div class="card plain" style="border-color:var(--bad)"><div class="name" style="color:#ffb0b0">Under attack!</div><div>${foes.map(k => `<span class="tag">${D.enemies[k].icon} ${fmt(s.enemies[k])} ${D.enemies[k].name.toLowerCase()}</span>`).join('')}${s.enemies.esiege ? `<span class="tag">🛞 ${fmt(s.enemies.esiege)} siege engines</span>` : ''}</div>`
        + `<p class="note">Soldiers and riders at home fight them off. Undefended, ${foes.includes('wolf') ? 'wolves eat your people' : 'they kill, steal and burn'}.</p></div>`;
    }
    const cm = Sim.combatMod(s);
    html += `<div class="stat-grid">
      <div class="stat"><div class="k">Soldiers home</div><div class="v">${fmt(s.units.soldier)}</div></div>
      <div class="stat"><div class="k">Riders home</div><div class="v">${fmt(s.units.cavalry)}</div></div>
      <div class="stat"><div class="k">Strength</div><div class="v">+${Math.round(cm * 100)}%</div></div>
      <div class="stat"><div class="k">Fortifications</div><div class="v">${fmt(s.bld.fortification)}</div></div>
      <div class="stat"><div class="k">Palisade</div><div class="v">${Sim.has(s, 'palisade') ? 'Yes' : 'No'}</div></div>
      <div class="stat"><div class="k">Enemies slain</div><div class="v">${fmt(s.slain)}</div></div>
    </div><p class="note">Hire soldiers and riders in the People tab. Attacks start once you've been around a while: wolves first, bandits once you pass 1,000 people, barbarians past 10,000.</p>`;
    if (!Sim.has(s, 'standard')) {
      html += `<div class="section-title"><span>Raiding</span></div>`;
      html += Sim.upgradeVisible(s, 'standard') ? upgradeCard('standard') : '<p class="note">Build barracks, then raise a War Banner to send raiding parties for land and plunder.</p>';
      return html;
    }
    html += `<div class="section-title"><span>Raiding party</span></div>`;
    const partyRow = (unit, label, icon) => {
      const home = s.units[unit], away = s.party[unit];
      return `<div class="card job"><div class="big">${icon}</div><div><div class="name">${label}</div><div class="note">${fmt(home)} at home</div></div>`
        + `<div class="stepper"><button data-act="party" data-u="${unit}" data-n="-max"${away && !R.raiding ? '' : ' disabled'}>−all</button><button data-act="party" data-u="${unit}" data-n="-1"${away && !R.raiding ? '' : ' disabled'}>−1</button>`
        + `<span class="n">${fmt(away)}</span><button data-act="party" data-u="${unit}" data-n="1"${home && !R.raiding ? '' : ' disabled'}>+1</button><button data-act="party" data-u="${unit}" data-n="10"${home && !R.raiding ? '' : ' disabled'}>+10</button><button data-act="party" data-u="${unit}" data-n="max"${home && !R.raiding ? '' : ' disabled'}>+all</button></div></div>`;
    };
    html += partyRow('soldier', 'Soldiers', '🗡️') + partyRow('cavalry', 'Riders', '🏇');
    if (Sim.has(s, 'mathematics')) {
      html += `<div class="card"><div class="big">🛞</div><div class="name">Siege engines<span class="owned">${fmt(s.party.siege)}</span></div><div>${btn('party', 'Build', Sim.canAfford(s, D.combat.siegeCost) >= 1, { data: 'data-u="siege" data-n="1"' })}</div><div class="desc">Knock down enemy fortifications during raids.</div><div class="cost">${costHtml(D.combat.siegeCost)}</div></div>`;
    }
    if (R.raiding) {
      const size = D.civSizes.find(c => c.id === R.last);
      html += `<div class="card plain" style="border-color:var(--accent)"><div class="name">Raiding a ${size ? size.name.toLowerCase() : 'settlement'}</div>`
        + (R.victory
          ? `<p class="note">Victory! The spoils await.</p>${btn('plunder', 'Plunder!', true, { cls: 'wide' })}`
          : `<p class="note">Enemy soldiers left: <b>${fmt(R.esoldier)}</b>${R.efort ? ` · fortifications: <b>${fmt(R.efort)}</b>` : ''}</p>`)
        + '</div>';
    } else {
      if (R.news) html += `<p class="note">${esc(R.news)}</p>`;
      html += `<div class="section-title"><span>Targets</span></div><div class="acts" style="display:flex;flex-wrap:wrap;gap:6px">`;
      const maxIdx = D.civSizes.findIndex(c => c.id === R.targetMax);
      D.civSizes.forEach((c, i) => {
        if (i > maxIdx + 1) return;
        html += ghost('invade', c.name, Sim.canRaid(s, i), `data-i="${i}"`);
      });
      html += `</div><p class="note">Beat the largest target you're allowed to unlock the next size. Winning brings land, goods and morale.</p>`;
    }
    return html;
  }

  // ---------- TRADE tab ----------
  function renderTrade() {
    const s = state, T = s.trader;
    let html = `<div class="section-title"><span>Merchants</span></div>`;
    if (T.timer > 0) {
      const R = D.resources[T.res];
      html += `<div class="card"><div class="big">🐫</div><div class="name">A merchant is here<span class="sub">${T.timer}s left</span></div><div>${btn('trade', 'Trade', s.res[T.res] >= T.amt)}</div>`
        + `<div class="desc">Wants ${R.icon} <b>${fmt(T.amt)}</b> ${R.name.toLowerCase()} for 🪙 1 gold.</div></div>`;
    } else {
      html += `<p class="note">Merchants pass through every few minutes and stay only briefly. They pay in gold.</p>`;
    }
    for (const id of ['trade', 'currency', 'commerce']) if (!Sim.has(s, id) && Sim.upgradeVisible(s, id)) html += upgradeCard(id);
    if (Sim.has(s, 'trade')) {
      html += `<div class="section-title"><span>Buy with gold</span><span>🪙 ${fmt(s.res.gold)}</span></div><div style="display:flex;flex-wrap:wrap;gap:6px">`;
      for (const r in D.trade.buy) html += ghost('buy', `${D.resources[r].icon} ${fmt(D.trade.buy[r])}`, s.res.gold >= 1, `data-r="${r}"`);
      html += `</div><p class="note">Each costs 1 gold.</p>`;
    }
    // Wonders
    html += `<div class="section-title"><span>Wonder</span></div>`;
    const W = s.wonder;
    if (!Sim.haveWonderTech(s) && !s.wonders.length) {
      html += `<p class="note">Learn <b>Architecture</b> and <b>Civil Service</b> to raise a wonder.</p>`;
    } else if (W.stage === 0 && Sim.haveWonderTech(s)) {
      html += `<div class="card plain"><p class="note">A wonder takes builders and a steady supply of every resource, and grants a lasting +10% bonus to one of them.</p><div class="row"><input class="textin" id="wonderName" maxlength="40" placeholder="The Great Work">${btn('startWonder', 'Begin', true)}</div></div>`;
    } else if (W.stage === 1) {
      const low = Sim.wonderLimitedBy(s);
      html += `<div class="card plain"><div class="name">${esc(W.name)}</div><div class="progress"><i style="width:${Math.min(100, W.progress)}%"></i></div>`
        + `<div class="note">${W.progress.toFixed(4)}% · ${fmt(s.units.labourer)} builders${low ? ` · <span style="color:var(--warn)">stalled by low ${D.resources[low].name.toLowerCase()}</span>` : ''}</div>`
        + `<p class="note">Each builder uses 1 of every resource per second. Assign builders in the People tab.</p>`
        + `<div class="row">${btn('rushWonder', `Hurry (+1%) for 🪙 ${D.wonder.rushGold}`, s.res.gold >= D.wonder.rushGold)}</div></div>`;
    } else if (W.stage === 2) {
      html += `<div class="card plain"><div class="name">${esc(W.name)} is complete!</div><p class="note">Choose the resource it blesses forever (+10%):</p><div style="display:flex;flex-wrap:wrap;gap:6px">`
        + D.wonder.resources.map(r => ghost('wonderBonus', `${D.resources[r].icon} ${D.resources[r].name}`, true, `data-r="${r}"`)).join('') + '</div></div>';
    } else if (W.stage === 3) {
      html += `<p class="note">${esc(W.name)} stands complete. Start a <b>New Age</b> from the menu to raise another.</p>`;
    }
    if (s.wonders.length) html += `<div>${s.wonders.map(w => `<span class="tag">🏛️ ${esc(w.name)}: +10% ${D.resources[w.res].name.toLowerCase()}</span>`).join('')}</div>`;
    return html;
  }

  const TABS = { build: renderBuild, people: renderPeople, tech: renderTech, faith: renderFaith, war: renderWar, trade: renderTrade };

  // ---------- alerts over the scene ----------
  function renderAlerts() {
    const s = state;
    let html = '';
    const n = Sim.enemiesAtHome(s);
    if (n > 0) {
      const kinds = Sim.ENEMIES.filter(k => s.enemies[k] > 0).map(k => `${D.enemies[k].icon} ${fmt(s.enemies[k])} ${D.enemies[k].name.toLowerCase()}`).join(', ');
      html += `<div class="alert bad">⚠️ Attack: ${kinds}</div>`;
    }
    if (s.trader.timer > 0) {
      const R = D.resources[s.trader.res];
      html += `<div class="alert gold">🐫 Merchant wants ${R.icon} ${fmt(s.trader.amt)} for 🪙 1 (${s.trader.timer}s)<button class="btn small" data-act="trade"${s.res[s.trader.res] >= s.trader.amt ? '' : ' disabled'}>Trade</button></div>`;
    }
    const ev = Seasons.view(s);
    if (ev) html += `<div class="alert gold">${ev.icon} ${ev.title} (${Math.ceil(ev.ttl / Sim.paceOf(s))}s to decide)<button class="btn small" data-act="event">Decide</button></div>`;
    if (s.raid.victory) html += `<div class="alert gold">⚔️ Raid won!<button class="btn small" data-act="plunder">Plunder</button></div>`;
    if (s.wonder.stage === 2) html += `<div class="alert gold">🏛️ ${esc(s.wonder.name)} is complete. Choose its blessing in the Trade tab.</div>`;
    patch($('#alerts'), html);
  }

  function renderLog() {
    const s = state;
    const now = Date.now();
    const ago = t => { const sec = Math.floor((now - t) / 1000); return sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`; };
    patch($('#log'), s.log.slice(0, 40).map(l => `<li class="${l.kind}"><span class="tm">${ago(l.t)}</span>${esc(l.text)}</li>`).join(''));
  }

  function renderGatherAmounts() {
    const inc = Sim.clickIncrement(state);
    for (const r of ['food', 'wood', 'stone']) {
      const el = document.getElementById('gAmt-' + r);
      const full = state.res[r] >= Sim.storage(state, r);
      el.textContent = full ? 'storage full' : `+${fmt(inc)}`;
    }
  }

  // ---------- messages ----------
  function toast(text, kind, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = text;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms || 3200);
  }
  function openModal(html, peek) { $('#modalBody').innerHTML = html; $('#modal').classList.toggle('peek', !!peek); $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').classList.remove('peek'); }

  // ---------- installing as an app (js/install.js) ----------
  async function installApp() {
    if (Install.installed()) { toast('📲 Hearthstead is already installed.', 'good'); return; }
    if (Install.canPrompt()) {
      const r = await Install.prompt();
      if (r === 'accepted') toast('📲 Installing Hearthstead. Look for it with your apps.', 'good', 5000);
      return;
    }
    showInstallHelp();
  }
  function showInstallHelp() {
    let steps;
    if (Install.ios) steps = `<ol><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow pointing up).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`;
    else if (Install.android) steps = `<ol><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Install app</b> (on some phones it says <b>Add to Home screen</b>), then <b>Install</b>.</li></ol><p class="note">If neither shows up, reload the page once and try again.</p>`;
    else steps = `<ol><li>In <b>Chrome</b> or <b>Edge</b>, click the install icon at the right end of the address bar,</li><li>or open the browser's <b>⋮</b> / <b>…</b> menu and choose <b>Install Hearthstead</b> (Chrome: <b>Cast, save and share → Install page as app</b>).</li></ol>`;
    openModal(`<h2>📲 Install Hearthstead</h2><p>Install it to play full screen from your home screen, even offline. Your save stays the same.</p>${steps}<div class="row"><button class="btn" data-menu="close">Got it</button></div>`);
  }
  // A one-time hint on phones, after a minute of play.
  function hideInstallHint() { const h = document.getElementById('installHint'); if (h) h.remove(); }
  function scheduleInstallHint() {
    let seen = false;
    try { seen = !!localStorage.getItem('hearthstead.installHint'); } catch (e) { seen = true; }
    if (seen || !window.Install || Install.installed() || !/^https?:$/.test(location.protocol)) return;
    if (!window.matchMedia('(max-width: 800px), (pointer: coarse)').matches) return;
    const show = () => {
      if (Install.installed() || document.getElementById('installHint')) return;
      if (!$('#modal').classList.contains('hidden')) { setTimeout(show, 10000); return; } // wait until no box is open
      try { localStorage.setItem('hearthstead.installHint', 'shown'); } catch (e) { /* ignore */ }
      const el = document.createElement('div');
      el.id = 'installHint';
      el.innerHTML = `<span>📲 Play full screen, even offline.</span><button class="btn small" data-menu="hintInstall">Install</button><button class="btn small ghost" data-menu="hintLater" aria-label="Not now">Not now</button>`;
      el.addEventListener('click', e => { const b = e.target.closest('[data-menu]'); if (b) handleMenu(b.dataset.menu, b); });
      document.body.appendChild(el);
    };
    setTimeout(show, 60000);
  }

  function showMenu() {
    const canAge = Sim.canNewAge(state);
    openModal(`<h2>☰ Menu</h2><div class="menu-list">
      <button class="btn ghost" data-menu="help">❓ How to play</button>
      <button class="btn ghost" data-menu="ach">🏆 Achievements</button>
      <button class="btn ghost" data-menu="log">📜 Chronicle</button>
      <button class="btn ghost" data-menu="rename">✏️ Rename settlement or ruler</button>
      <button class="btn ghost" data-menu="sound">${state.sound.mute ? '🔇' : '🔊'} Sound${state.sound.mute ? ' (muted)' : ''}</button>
      <button class="btn ghost" data-menu="seasons">🍂 Seasons: ${seasonsLabel()}</button>
      <button class="btn ghost" data-menu="theme">🖌️ Theme: ${(THEMES.find(x => x[0] === getTheme()) || THEMES[0])[1]}</button>
      <button class="btn ghost" data-menu="look">🎨 Controls layout: ${(LAYOUTS.find(x => x[0] === getLayout()) || LAYOUTS[0])[1]}</button>
      <button class="btn ghost" data-menu="pace">⏩ Game speed: ${paceLabel(state.pace)}</button>
      ${window.Install && !Install.installed() ? '<button class="btn ghost" data-menu="install">📲 Install app</button>' : ''}
      <button class="btn ghost" data-menu="save">💾 Save now</button>
      <button class="btn ghost" data-menu="export">📤 Export save</button>
      <button class="btn ghost" data-menu="import">📥 Import save</button>
      <button class="btn ghost" data-menu="newage"${canAge ? '' : ' disabled'}>🌅 Begin a New Age${canAge ? '' : ' (after Worship or a wonder)'}</button>
      <button class="btn danger" data-menu="wipe">🗑️ Erase everything</button>
      <button class="btn" data-menu="close">Close</button></div>`);
  }
  // Colour themes (css/themes.css). A display choice, stored apart from the save.
  // [id, name, description, swatch colours: background, panel, tile, accent, highlight]
  const THEMES = [
    ['hearth', 'Hearth', 'Warm charcoal, soft amber; easiest at night (default)', ['#1e1c1a', '#2d2a26', '#e2dbcf', '#cc9a5e', '#93b38d']],
    ['village', 'Village', 'Colours from the village: forest, wheat and sky', ['#1a2218', '#273325', '#e4e1cc', '#d6b25c', '#8fb8d6']],
    ['slate', 'Slate', 'Cool blue-grey, calm and neutral', ['#242a33', '#323944', '#dbe1ea', '#86a6c6', '#8cc2cf']],
    ['moss', 'Moss', 'Soft grey-green, very gentle contrast', ['#23292a', '#313939', '#dcdcc9', '#a7bf82', '#86c0a6']],
    ['graphite', 'Graphite', 'Plain neutral grey with a steel-blue accent', ['#1d1f22', '#2a2e32', '#d8dadc', '#82a5c9', '#74b6ae']],
    ['portal', 'Games Portal', 'Indigo and violet, like the portal', ['#0f1020', '#1d2040', '#eceefe', '#7c5cff', '#22d3ee']],
  ];
  function getTheme() { return document.documentElement.dataset.theme || 'hearth'; }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('hearthstead.theme', t); } catch (e) { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#000';
  }
  function showThemes() {
    const cur = getTheme();
    openModal(`<h2>🖌️ Theme</h2><p class="note">Click one to try it. The game keeps running behind this box so you can compare.</p><div class="theme-list">`
      + THEMES.map(([id, name, desc, sw]) => `<button class="btn ghost theme-opt${id === cur ? ' on' : ''}" data-menu="setTheme" data-theme="${id}"><span class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</span><span class="tn"><b>${name}${id === cur ? ' ✓' : ''}</b><small>${desc}</small></span></button>`).join('')
      + `</div><div class="row"><button class="btn" data-menu="close">Done</button></div>`, true);
  }
  // The controls layout is a display choice, stored apart from the save.
  function getLook() { return document.documentElement.dataset.look === 'classic' ? 'classic' : 'table'; }
  // Controls layouts: the table panel docked bottom / left / right, or the classic side panel.
  const LAYOUTS = [
    ['bottom', 'Bottom', 'Wide panel along the bottom (drag its top edge to resize)'],
    ['left', 'Left side', 'Tall panel on the left (drag its edge to resize)'],
    ['right', 'Right side', 'Tall panel on the right (drag its edge to resize)'],
    ['classic', 'Classic', 'The original narrow side panel'],
  ];
  function getDock() { const d = document.documentElement.dataset.dock; return d === 'left' || d === 'right' ? d : 'bottom'; }
  function getLayout() { return getLook() === 'classic' ? 'classic' : getDock(); }
  function setLayout(id) {
    if (id === 'classic') setLook('classic');
    else {
      setLook('table');
      document.documentElement.dataset.dock = id;
      try { localStorage.setItem('hearthstead.dock', id); } catch (e) { /* ignore */ }
    }
    window.dispatchEvent(new Event('resize')); // the village picture refits to the new space
  }
  function showLayouts() {
    const cur = getLayout();
    openModal(`<h2>🎨 Controls layout</h2><p class="note">Click one to try it. Wide screens only; phones always use the pull-up drawer.</p><div class="theme-list">`
      + LAYOUTS.map(([id, name, desc]) => `<button class="btn ghost theme-opt${id === cur ? ' on' : ''}" data-menu="setLayout" data-layout="${id}"><span class="tn"><b>${name}${id === cur ? ' ✓' : ''}</b><small>${desc}</small></span></button>`).join('')
      + `</div><div class="row"><button class="btn" data-menu="close">Done</button></div>`, true);
  }
  function setLook(l) {
    document.documentElement.dataset.look = l;
    try { localStorage.setItem('hearthstead.look', l); } catch (e) { /* ignore */ }
  }
  // Drag the grip on top of the bottom panel to make it taller or shorter.
  // The height is a display choice, stored apart from the save.
  // Instant hover tips for anything with data-tip (resource icons in costs and the top bar).
  // One floating box, styled like the Chronicle. Follows re-renders: it re-checks on every mouse move.
  function initTips() {
    const tip = document.createElement('div');
    tip.id = 'tip'; tip.className = 'hidden';
    document.body.appendChild(tip);
    let cur = null;
    let timer = 0;
    const hide = () => { cur = null; tip.classList.add('hidden'); };
    const show = el => {
      cur = el;
      tip.innerHTML = `<b>${esc(el.dataset.tip)}</b>${el.dataset.tip2 ? `<small>${esc(el.dataset.tip2)}</small>` : ''}`;
      tip.classList.remove('hidden');
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.bottom + 6;
      if (y + h > window.innerHeight - 4) y = r.top - h - 6;
      x = Math.max(4, Math.min(window.innerWidth - w - 4, x));
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    };
    document.addEventListener('mousemove', e => {
      if (timer) return; // a tap-tip is showing
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (!el) { if (cur) hide(); return; }
      if (el !== cur) show(el);
    });
    document.addEventListener('mouseleave', hide);
    document.addEventListener('scroll', () => { if (!timer) hide(); }, true);
    // Phones: tap an icon to see its name for a moment.
    document.addEventListener('pointerdown', e => {
      clearTimeout(timer); timer = 0;
      const el = e.pointerType !== 'mouse' && e.target.closest && e.target.closest('[data-tip]');
      if (!el) { hide(); return; }
      show(el);
      timer = setTimeout(() => { timer = 0; hide(); }, 1600);
    });
  }
  function initDockGrip() {
    const grip = $('#dockGrip'), root = document.documentElement;
    if (!grip) return;
    let dragging = false;
    const side = () => getDock() !== 'bottom';
    // Bottom dock: drag sets the height. Left/right dock: drag sets the width.
    const setH = (y, x) => {
      if (side()) {
        const w = Math.round(Math.max(300, Math.min(window.innerWidth * 0.6, getDock() === 'left' ? x : window.innerWidth - x)));
        root.style.setProperty('--dock-w', w + 'px');
        return w;
      }
      const h = Math.round(Math.max(150, Math.min(window.innerHeight * 0.75, window.innerHeight - y)));
      root.style.setProperty('--dock-h', h + 'px');
      return h;
    };
    const key = () => side() ? 'hearthstead.dockW' : 'hearthstead.dockH';
    const prop = () => side() ? '--dock-w' : '--dock-h';
    grip.addEventListener('pointerdown', e => { dragging = true; grip.classList.add('drag'); grip.setPointerCapture(e.pointerId); e.preventDefault(); });
    grip.addEventListener('pointermove', e => { if (dragging) setH(e.clientY, e.clientX); });
    const end = e => {
      if (!dragging) return;
      dragging = false; grip.classList.remove('drag');
      try { localStorage.setItem(key(), setH(e.clientY, e.clientX)); } catch (err) { /* ignore */ }
      window.dispatchEvent(new Event('resize'));
      refresh();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => {
      root.style.removeProperty(prop());
      try { localStorage.removeItem(key()); } catch (err) { /* ignore */ }
      window.dispatchEvent(new Event('resize'));
      refresh();
    });
  }
  function paceLabel(p) { p = Sim.paceOf({ pace: p }); return p === 1 ? '1× (classic)' : `${p}×`; }
  function showPace() {
    const p = Sim.paceOf(state);
    openModal(`<h2>⏩ Game speed</h2>
      <p>1× is the classic pace, meant to be played slowly over many sessions. Higher speeds run the whole game clock faster: production, wonder building, merchant visits, and also hunger, raids and attacks.</p>
      <div class="pace-row"><input type="range" id="paceSlider" min="1" max="${Sim.PACE_MAX}" step="1" value="${p}" aria-label="Game speed"><b id="paceVal">${paceLabel(p)}</b></div>
      <p class="note">Time away is caught up at the speed you have set.</p>
      <div class="row"><button class="btn ghost" data-menu="paceReset">Back to classic (1×)</button><button class="btn" data-menu="close">Done</button></div>`);
  }
  function seasonsLabel() {
    const C = state.seasonCfg;
    return C.play ? 'look + effects and events' : C.show ? 'look only (classic play)' : 'off';
  }
  function showSeasons() {
    const C = state.seasonCfg;
    openModal(`<h2>🍂 Seasons</h2>
      <p>Spring, summer, autumn and winter each last ${Math.round(D.seasons.length / 60)} minutes at 1× (less at higher game speeds).</p>
      <label class="chk-row"><input type="checkbox" id="seaShow"${C.show ? ' checked' : ''}><span><b>Show the seasons</b><br><span class="note">The village changes with the season (blossom, golden fields, falling leaves, snow) and the top bar shows the season and year. Looks only: nothing about play changes.</span></span></label>
      <label class="chk-row"><input type="checkbox" id="seaPlay"${C.play ? ' checked' : ''}><span><b>Season effects and events</b><br><span class="note">Farms grow ${D.seasons.list.map(x => `${Math.round(x.farm * 100)}% in ${x.name.toLowerCase()}`).join(', ')}. Other jobs stay steady. Now and then something happens and you choose what to do: a drought, refugees, a festival, a fire, a travelling scholar. Off means the classic game.</span></span></label>
      <div class="row"><button class="btn" data-menu="close">Done</button></div>`);
  }
  function showEvent() {
    const ev = Seasons.view(state);
    if (!ev) { closeModal(); return; }
    openModal(`<h2>${ev.icon} ${ev.title}</h2><p>${esc(ev.text)}</p>`
      + ev.choices.map((c, i) => `<div class="evt-choice"><button class="btn${i ? ' ghost' : ''}" data-menu="evtChoice" data-i="${i}"${c.ok ? '' : ' disabled'}>${c.label}</button>`
        + `${c.cost ? `<div class="cost">${costHtml(c.cost)}</div>` : ''}<div class="note">${esc(c.effect)}</div>${c.why ? `<div class="why">${esc(c.why)}</div>` : ''}</div>`).join('')
      + `<p class="note">If nobody decides within ${Math.ceil(ev.ttl / Sim.paceOf(state))}s, the last choice is made for you.</p>`
      + `<div class="row"><button class="btn ghost" data-menu="close">Decide later</button></div>`);
  }
  function modalOpen() { return !$('#modal').classList.contains('hidden'); }
  const pct = v => `${Math.round(v * 100)}%`;
  function showSound() {
    const S = state.sound;
    openModal(`<h2>🔊 Sound</h2>
      <p>Every sound is made in code as you play. The music is a slow loop that writes its own tune.</p>
      <div class="snd-row"><label for="sndMute">Mute all</label><input type="checkbox" id="sndMute"${S.mute ? ' checked' : ''}></div>
      <div class="snd-row"><label for="sndSfx">Effects</label><input type="range" id="sndSfx" min="0" max="100" step="5" value="${Math.round(S.sfx * 100)}"><b id="sndSfxVal">${pct(S.sfx)}</b></div>
      <div class="snd-row"><label for="sndMusic">Music</label><input type="range" id="sndMusic" min="0" max="100" step="5" value="${Math.round(S.music * 100)}"><b id="sndMusicVal">${pct(S.music)}</b></div>
      <p class="note">Hear a sample:</p>
      <div class="row"><button class="btn ghost" data-menu="sndTry" data-fx="build">🔨 Build</button><button class="btn ghost" data-menu="sndTry" data-fx="horn">📯 Raid horn</button><button class="btn ghost" data-menu="sndTry" data-fx="newAge">🔔 New age</button></div>
      <div class="row"><button class="btn" data-menu="close">Done</button></div>`);
  }
  function renderMute() {
    const b = $('#muteBtn'); if (!b) return;
    const m = state.sound.mute;
    b.textContent = m ? '🔇' : '🔊';
    b.classList.toggle('muted', m);
    b.title = m ? 'Sound off (click to turn on)' : 'Sound on (click to mute)';
    b.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  }
  function showHelp() {
    openModal(`<h2>🏡 ${D.title}</h2>
      <p>Grow a settlement from a lone tent into an empire.</p>
      <h3>Getting started</h3>
      <ul>
        <li><b>Click</b> the fields, forest and quarry (or the buttons) to gather food, wood and stone. Each click can turn up <b>skins, herbs or ore</b>.</li>
        <li>Build a <b>Tent</b> (2 wood, 2 skins) so someone has a home, then <b>recruit</b> citizens with food in the People tab.</li>
        <li>Every citizen eats <b>1 food per second</b>. A farmer grows 1.2, so keep plenty of farmers. If food runs out, people starve.</li>
        <li>Put the rest to work cutting wood and mining stone. Storage is capped, so build barns, woodpiles and stone yards.</li>
      </ul>
      <h3>Growing</h3>
      <ul>
        <li>Learn <b>Masonry</b> to unlock cottages, tanneries, forges, herbalists, shrines, barracks and graveyards.</li>
        <li>Tanners turn skins into leather, blacksmiths turn ore into metal. Learn Skinning, Foraging and Prospecting so workers find special resources on their own.</li>
        <li>The dead leave corpses, and corpses spread sickness. Priests bury them in graveyards; healers cure the sick using herbs.</li>
        <li>Morale (top left) speeds up or slows down all work. Starvation and overcrowding hurt it; winning raids helps.</li>
      </ul>
      <h3>Later</h3>
      <ul>
        <li><b>Faith:</b> priests make faith. Worship a deity, pick its domain and build altars for devotion, which unlocks blessings and prayers.</li>
        <li><b>War:</b> wolves, bandits and barbarians attack as you grow. Soldiers defend; raise a War Banner to raid neighbours for land and plunder.</li>
        <li><b>Trade:</b> merchants visit and pay gold. Gold buys goods and hurries wonders.</li>
        <li><b>Seasons</b> change the look of the village. In the menu you can also turn on season effects on farming, and events where you choose what to do.</li>
        <li><b>Wonders</b> give a permanent +10% bonus. Afterwards you can begin a <b>New Age</b>, keeping your past gods, wonders, cats and achievements.</li>
      </ul>
      <p class="note">The game saves itself every 10 seconds. While you're away (up to ${D.offlineCapHours} hours) your people keep working, but nobody starves, sickens or gets attacked.</p>
      <div class="row"><button class="btn" data-menu="close">Let's go</button></div>`);
  }
  function showAchievements() {
    const s = state;
    const items = [];
    D.civSizes.slice(1).forEach(c => items.push({ name: c.name, desc: `Reach ${fmt(c.min)} people.`, got: !!s.ach['size_' + c.id] }));
    for (const id in D.achievements) items.push(Object.assign({ got: !!s.ach[id] }, D.achievements[id]));
    const got = items.filter(i => i.got).length;
    openModal(`<h2>🏆 Achievements (${got}/${items.length})</h2><div class="ach-grid">${items.map(i => `<div class="ach${i.got ? ' got' : ''}"><b>${i.got ? '🏆' : '🔒'} ${i.name}</b>${i.desc}</div>`).join('')}</div>
      <p class="note">Clicks so far: ${fmt(s.clicks)}</p><div class="row"><button class="btn" data-menu="close">Close</button></div>`);
  }
  function showLog() {
    openModal(`<h2>📜 Chronicle</h2><ul style="list-style:none;padding:0">${state.log.map(l => `<li class="${l.kind}" style="padding:2px 0">${esc(l.text)}</li>`).join('') || '<li>Nothing has happened yet.</li>'}</ul><div class="row"><button class="btn" data-menu="close">Close</button></div>`);
  }
  function showRename() {
    openModal(`<h2>✏️ Names</h2><p class="note">Settlement</p><input class="textin" id="inCiv" maxlength="40" value="${esc(state.civName)}" style="width:100%">
      <p class="note">Ruler</p><input class="textin" id="inRuler" maxlength="40" value="${esc(state.rulerName)}" style="width:100%">
      <div class="row"><button class="btn" data-menu="doRename">Save</button><button class="btn ghost" data-menu="close">Cancel</button></div>`);
  }
  function showExport() {
    const code = Sim.exportString(state);
    openModal(`<h2>📤 Export save</h2><p>Copy this code, or download it as a file. Use <b>Import</b> on another browser or device to continue there.</p>
      <textarea readonly id="exportBox">${code}</textarea>
      <div class="row"><button class="btn" data-menu="copy">Copy</button><button class="btn ghost" data-menu="download">Download file</button><button class="btn ghost" data-menu="close">Close</button></div>`);
  }
  function showImport() {
    openModal(`<h2>📥 Import save</h2><p>Paste a save code, or choose a save file. This replaces your current game.</p>
      <textarea id="importBox" placeholder="Paste code here"></textarea>
      <div class="row"><input type="file" id="importFile" accept=".txt,text/plain"></div>
      <p id="importErr" class="note" style="color:var(--bad)"></p>
      <div class="row"><button class="btn" data-menu="doImport">Import</button><button class="btn ghost" data-menu="close">Cancel</button></div>`);
    $('#importFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) f.text().then(t => { $('#importBox').value = t.trim(); });
    });
  }
  function showNewAge() {
    openModal(`<h2>🌅 Begin a New Age?</h2><p>Your settlement starts over from nothing. You keep your <b>gods of past ages</b>, your <b>wonders</b> and their bonuses, your <b>cats</b> and your <b>achievements</b>.</p>
      <p class="note">Gods who earned at least one devotion are remembered; you can worship them again by name, or melt their idols for gold.</p>
      <div class="row"><button class="btn" data-menu="doNewAge">Begin anew</button><button class="btn ghost" data-menu="close">Not yet</button></div>`);
  }
  function showWipe() {
    openModal(`<h2>🗑️ Erase everything?</h2><p>This deletes your save completely, including past ages, wonders and achievements. It can't be undone.</p>
      <div class="row"><button class="btn danger" data-menu="doWipe">Erase</button><button class="btn ghost" data-menu="close">Cancel</button></div>`);
  }
  function showAway(info) {
    const h = Math.floor(info.seconds / 3600), m = Math.floor((info.seconds % 3600) / 60);
    const lines = Sim.RES.map(r => {
      const d = info.after[r] - info.before[r];
      return Math.abs(d) >= 1 ? `<li>${D.resources[r].icon} ${D.resources[r].name}: ${d > 0 ? '+' : ''}${fmt(Math.round(d))}</li>` : '';
    }).join('');
    openModal(`<h2>👋 Welcome back</h2><p>You were away for ${h ? h + 'h ' : ''}${m}m. Your people kept working:</p>
      <ul>${lines || '<li>Nothing much changed.</li>'}</ul><div class="row"><button class="btn" data-menu="close">Continue</button></div>`);
  }

  // ---------- actions from panel buttons ----------
  function parseN(v, max) {
    if (v === 'max') return Infinity;
    if (v === '-max') return -Infinity;
    return Number(v) || 0;
    void max;
  }
  // Clicking a greyed-out button (say +100 when you can only afford 40) flashes whatever
  // you're short of in that card's cost line, or gives the button a little shake if it isn't
  // a material (no idle workers, no room). Disabled buttons let clicks through to the card (CSS).
  function nudgeDisabled(e) {
    const card = e.target.closest('.card');
    if (!card) return;
    const b = Array.from(card.querySelectorAll('button[data-act]:disabled')).find(x => {
      const r = x.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (!b) return;
    const raw = b.dataset.n, n = raw === undefined || /max/.test(raw) ? 1 : Number(raw);
    if (n < 0) return; // removing never costs anything
    const short = Array.from(card.querySelectorAll('.cost [data-res]'))
      .filter(x => state.res[x.dataset.res] < Number(x.dataset.each) * n);
    if (short.length) {
      short.forEach(x => x.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.18)', background: 'var(--bad)', color: 'var(--bg)', offset: 0.25 },
        { transform: 'scale(1)', background: 'var(--bad)', color: 'var(--bg)', offset: 0.55 },
        { transform: 'scale(1)' },
      ], { duration: 900, easing: 'ease-out' }));
    } else {
      b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
        { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320 });
    }
  }
  function handleAct(el) {
    const a = el.dataset.act, s = state;
    switch (a) {
      case 'build': actions.build(el.dataset.id, parseN(el.dataset.n)); break;
      case 'spawn': actions.spawn(parseN(el.dataset.n)); break;
      case 'job': actions.setJob(el.dataset.job, parseN(el.dataset.n)); break;
      case 'upgrade': actions.buyUpgrade(el.dataset.id); break;
      case 'nameDeity': { const v = ($('#deityName').value || '').trim() || s.rulerName; actions.nameDeity(v); break; }
      case 'domain': actions.selectDomain(el.dataset.id); break;
      case 'altar': actions.buildAltar(); break;
      case 'pray': actions.pray(el.dataset.id, el.dataset.n === undefined ? undefined : parseN(el.dataset.n)); break;
      case 'iconoclasm': actions.iconoclasm(Number(el.dataset.i)); break;
      case 'party': actions.party(el.dataset.u, parseN(el.dataset.n)); break;
      case 'invade': actions.invade(Number(el.dataset.i)); break;
      case 'plunder': actions.plunder(); break;
      case 'trade': actions.trade(); break;
      case 'buy': actions.buy(el.dataset.r); break;
      case 'startWonder': actions.startWonder(($('#wonderName').value || '').trim() || 'The Great Work'); break;
      case 'rushWonder': actions.rushWonder(); break;
      case 'wonderBonus': actions.wonderBonus(el.dataset.r); break;
      case 'event': showEvent(); break;
    }
    refresh();
  }
  function handleMenu(m, el) {
    switch (m) {
      case 'close': closeModal(); break;
      case 'help': showHelp(); break;
      case 'install': closeModal(); installApp(); break;
      case 'hintInstall': hideInstallHint(); installApp(); break;
      case 'hintLater': hideInstallHint(); break;
      case 'ach': showAchievements(); break;
      case 'log': showLog(); break;
      case 'rename': showRename(); break;
      case 'doRename':
        state.civName = ($('#inCiv').value || '').trim().slice(0, 40) || state.civName;
        state.rulerName = ($('#inRuler').value || '').trim().slice(0, 40) || state.rulerName;
        closeModal(); refresh(); break;
      case 'sound': showSound(); break;
      case 'sndTry': if (el) Sound.preview(el.dataset.fx); break;
      case 'pace': showPace(); break;
      case 'theme': showThemes(); break;
      case 'setTheme': setTheme(el.dataset.theme); showThemes(); refresh(); break;
      case 'look': showLayouts(); break;
      case 'setLayout': setLayout(el.dataset.layout); showLayouts(); refresh(); break;
      case 'seasons': showSeasons(); break;
      case 'evtChoice': {
        const msg = actions.eventChoice(Number(el.dataset.i));
        if (msg) { closeModal(); toast(msg, 'good', 5000); refresh(); } else showEvent();
        break;
      }
      case 'paceReset': actions.setPace(1); $('#paceSlider').value = 1; $('#paceVal').textContent = paceLabel(1); refresh(); break;
      case 'save': actions.save(); closeModal(); toast('💾 Game saved', 'good'); break;
      case 'export': showExport(); break;
      case 'copy': {
        const box = $('#exportBox'); box.select();
        (navigator.clipboard ? navigator.clipboard.writeText(box.value) : Promise.reject()).then(() => toast('📋 Copied', 'good'), () => { document.execCommand('copy'); toast('📋 Copied', 'good'); });
        break;
      }
      case 'download': {
        const blob = new Blob([$('#exportBox').value], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `hearthstead-save-${new Date().toISOString().slice(0, 10)}.txt`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      case 'import': showImport(); break;
      case 'doImport':
        try { actions.importSave($('#importBox').value); closeModal(); toast('📥 Save imported', 'good'); }
        catch (e) { $('#importErr').textContent = "That doesn't look like a Hearthstead save code."; }
        break;
      case 'newage': showNewAge(); break;
      case 'doNewAge': actions.newAge(); closeModal(); toast('🌅 A new age begins.', 'good', 5000); break;
      case 'wipe': showWipe(); break;
      case 'doWipe': actions.wipe(); closeModal(); showHelp(); break;
    }
  }

  // ---------- setup ----------
  function init(s, act) {
    state = s; actions = act;
    $('#panel').addEventListener('click', e => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; $('#panelBody').scrollTop = 0; scrollingUntil = 0; refresh(); setDrawer(true); return; }
      const el = e.target.closest('[data-act]');
      if (el && !el.disabled) { scrollingUntil = 0; handleAct(el); } // a click shows its result right away
      else if (!el) nudgeDisabled(e);
    });
    $('#alerts').addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && !el.disabled) handleAct(el); });
    $('#panel').addEventListener('change', e => {
      if (e.target.id === 'spawnJob') { state.spawnJob = e.target.value; }
    });
    $('#panel').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'deityName') handleAct({ dataset: { act: 'nameDeity' } });
      if (e.target.id === 'wonderName') handleAct({ dataset: { act: 'startWonder' } });
    });
    $('#menuBtn').addEventListener('click', showMenu);
    for (const ev of ['wheel', 'scroll', 'touchmove']) $('#panelBody').addEventListener(ev, markScrolling, { passive: true });
    $('#panelBody').addEventListener('pointerdown', e => { if (e.target === $('#panelBody')) markScrolling(); }); // scrollbar drag
    scheduleInstallHint();
    $('#muteBtn').addEventListener('click', () => { actions.setSound({ mute: !state.sound.mute }); renderMute(); });
    $('#modal').addEventListener('change', e => {
      if (e.target.id === 'sndMute') { actions.setSound({ mute: e.target.checked }); renderMute(); }
      if (e.target.id === 'seaShow') { actions.setSeasons({ show: e.target.checked }); refresh(); }
      if (e.target.id === 'seaPlay') { actions.setSeasons({ play: e.target.checked }); refresh(); }
    });
    $('#modal').addEventListener('click', e => {
      const b = e.target.closest('[data-menu]');
      if (b && !b.disabled) handleMenu(b.dataset.menu, b);
      else if (e.target.id === 'modal') closeModal();
    });
    $('#modal').addEventListener('input', e => {
      if (e.target.id === 'sndSfx' || e.target.id === 'sndMusic') {
        const key = e.target.id === 'sndSfx' ? 'sfx' : 'music';
        const S = actions.setSound({ [key]: e.target.value / 100 });
        $(`#${e.target.id}Val`).textContent = pct(S[key]);
        if (key === 'sfx') Sound.play('build');
        return;
      }
      if (e.target.id !== 'paceSlider') return;
      actions.setPace(e.target.value);
      $('#paceVal').textContent = paceLabel(state.pace);
      refresh();
    });
    initDockGrip();
    initTips();
    window.addEventListener('resize', () => refresh());
    $('#drawerToggle').addEventListener('click', () => setDrawer(!$('#panel').classList.contains('open')));
    if (window.matchMedia('(max-width: 800px)').matches) setDrawer(false); else document.body.classList.remove('drawer-open');
  }
  function setState(s) { state = s; }
  function setDrawer(open) {
    if (!window.matchMedia('(max-width: 800px)').matches) open = true;
    $('#panel').classList.toggle('open', open);
    document.body.classList.toggle('drawer-open', open && window.matchMedia('(max-width: 800px)').matches);
  }

  function refresh() {
    renderMute();
    renderChips();
    renderTabs();
    patch($('#railStats'), railStats());
    patch($('#hintCard'), hint());
    patchTab();
    renderAlerts();
    renderLog();
    renderGatherAmounts();
  }

  window.UI = { init, setState, refresh, toast, showHelp, showAway, closeModal, setDrawer, showEvent, modalOpen };
})();
