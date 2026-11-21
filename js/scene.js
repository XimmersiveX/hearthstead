// =====================================================================
//  SCENE: the little 2D village drawn on a <canvas>. Everything is
//  drawn in code (no image files). Click the fields, the forest or the
//  quarry to gather by hand.
// =====================================================================
(function () {
  let canvas, ctx, state, W = 0, H = 0, dpr = 1, onGather = null;
  let t = 0;                 // seconds since start (animation clock)
  let hover = '';            // which gather zone the pointer is over
  const floats = [];         // floating "+1" texts
  const people = [];         // walking villagers
  const foes = [];           // visible attackers
  const smoke = [];

  // ---------- seeded random so the layout stays put ----------
  function seeded(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Zones in 0..1 coordinates of the canvas.
  const ZONES = {
    wood:  { x0: 0.0,  x1: 0.27, y0: 0.40, y1: 0.80, label: '🪵 Chop wood' },
    stone: { x0: 0.76, x1: 1.0,  y0: 0.30, y1: 0.78, label: '🪨 Quarry stone' },
    food:  { x0: 0.0,  x1: 0.40, y0: 0.80, y1: 1.0,  label: '🌾 Harvest food' },
  };
  function zoneAt(px, py) {
    const x = px / W, y = py / H;
    for (const k of ['food', 'wood', 'stone']) {
      const z = ZONES[k];
      if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return k;
    }
    return '';
  }

  // ---------- town plan: the settlement grows in stages ----------
  // Instead of piling up one sprite per building, the town follows a
  // fixed street plan. Each stage (camp, hamlet, village, town, city)
  // opens more lots and redraws every home in a better style, so the
  // picture improves as it grows and stops at a finished city.
  const STAGES = [
    { id: 'camp', min: 0 },
    { id: 'hamlet', min: 20 },
    { id: 'village', min: 60 },
    { id: 'town', min: 200 },
    { id: 'city', min: 2000 },
  ];
  const FULL_POP = 20000; // the city is complete from here on
  function stageOf(pop) {
    let i = 0;
    while (i < STAGES.length - 1 && pop >= STAGES[i + 1].min) i++;
    const lo = Math.max(1, STAGES[i].min), hi = i < STAGES.length - 1 ? STAGES[i + 1].min : FULL_POP;
    const k = i === 0 ? pop / STAGES[1].min : Math.log(Math.max(pop, lo) / lo) / Math.log(hi / lo);
    return { stage: i, k: Math.max(0, Math.min(1, k)) };
  }

  // Lots in 0..1 canvas coordinates: (x, y) is the bottom centre.
  // st = the stage the lot opens at. Roles fall back to a home when
  // the matching building isn't owned.
  const LOTS = [
    // back row, behind the back lane
    { x: 0.355, y: 0.645, role: 'home', st: 3, wonderSpot: true },
    { x: 0.400, y: 0.645, role: 'home', st: 3, wonderSpot: true },
    { x: 0.447, y: 0.645, role: 'home', st: 2 },
    { x: 0.540, y: 0.650, role: 'temple', st: 2 },
    { x: 0.633, y: 0.645, role: 'home', st: 2 },
    { x: 0.680, y: 0.645, role: 'home', st: 3 },
    { x: 0.727, y: 0.645, role: 'grave', st: 3 },
    // north side of the main street
    { x: 0.347, y: 0.765, role: 'barn', st: 1 },
    { x: 0.395, y: 0.765, role: 'yard', st: 2 },
    { x: 0.442, y: 0.765, role: 'home', st: 1 },
    { x: 0.489, y: 0.765, role: 'home', st: 1, prime: true },
    { x: 0.591, y: 0.765, role: 'home', st: 1, prime: true },
    { x: 0.638, y: 0.765, role: 'home', st: 2 },
    { x: 0.686, y: 0.765, role: 'work', st: 2 },
    { x: 0.733, y: 0.768, role: 'barracks', st: 3 },
    // south side of the main street
    { x: 0.426, y: 0.900, role: 'home', st: 2 },
    { x: 0.473, y: 0.900, role: 'home', st: 1 },
    { x: 0.607, y: 0.900, role: 'home', st: 2 },
    { x: 0.654, y: 0.900, role: 'work', st: 3 },
    { x: 0.700, y: 0.900, role: 'home', st: 3 },
    { x: 0.747, y: 0.903, role: 'stable', st: 3 },
    // outside the east gate, below the quarry (city only)
    { x: 0.835, y: 0.905, role: 'home', st: 4 },
    { x: 0.882, y: 0.905, role: 'home', st: 4 },
    { x: 0.929, y: 0.905, role: 'home', st: 4 },
    { x: 0.976, y: 0.905, role: 'home', st: 4 },
  ];
  const PLAZA = { x: 0.54, y: 0.835, rx: 0.052, ry: 0.042 };
  const ROAD_Y = 0.797;
  // Home styles, worst to best, with the housing you need to own for each.
  const HOMES = [['tent', 0], ['hut', 1], ['cottage', 2], ['house', 3], ['townhouse', 3], ['manor', 4]];
  const TOWN_WALLS = ['#ece2cd', '#e6d2ab', '#ecd6ca', '#dcd7cb', '#e9dcbb', '#d9c9b4'];
  const TOWN_ROOFS = ['#9c4a32', '#7a3d2a', '#4f6688', '#8a5a3a', '#5d6b7a', '#a35d3c'];

  let plan = null, planKey = '';
  function bestHousing(b) { return b.mansion > 0 ? 4 : b.house > 0 ? 3 : b.cottage > 0 ? 2 : b.hut > 0 ? 1 : 0; }
  function makePlan(s, st) {
    const b = s.bld, stage = st.stage, items = [];
    const r = seeded(41);
    const P = { stage, k: st.k, items, wall: 0, carts: 0 };
    const top = bestHousing(b);
    const home = want => { let i = Math.min(want, HOMES.length - 1); while (i > 0 && HOMES[i][1] > top) i--; return HOMES[i][0]; };

    if (stage === 0) {
      // A ring of tents (or huts) round a campfire.
      const n = Math.max(1, Math.min(7, (b.tent || 0) + (b.hut || 0)));
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (0.15 + 0.7 * (n === 1 ? 0.5 : i / (n - 1)));
        items.push({ sprite: b.hut > i ? 'hut' : 'tent', x: PLAZA.x + Math.cos(a) * 0.07, y: PLAZA.y - 0.02 - Math.sin(a) * 0.075 + (i % 2) * 0.01, s: 1.25, seed: i });
      }
      items.push({ sprite: 'campfire', x: PLAZA.x, y: PLAZA.y + 0.01, s: 1.1 });
      items.sort((a, c) => a.y - c.y);
      return P;
    }

    // Which lots are open: all earlier stages' lots, plus a growing share of this stage's.
    const open = LOTS.filter(l => l.st < stage);
    const fresh = LOTS.filter(l => l.st === stage)
      .sort((a, c) => Math.hypot(a.x - PLAZA.x, a.y - PLAZA.y) - Math.hypot(c.x - PLAZA.x, c.y - PLAZA.y));
    const share = stage >= 4 ? 0.25 + 0.75 * st.k : 0.35 + 0.65 * st.k;
    open.push(...fresh.slice(0, Math.ceil(fresh.length * share)));

    const wonder = (s.wonder.stage > 0 || s.wonders.length) && stage >= 2;
    const works = ['smithy', 'tannery', 'apothecary'].filter(w => b[w] > 0);
    for (const l of open) {
      if (wonder && l.wonderSpot) continue;
      let sprite = '', sc = 1.25, sign = '', trade = '';
      const seed = Math.floor(r() * 1000);
      if (l.role === 'temple' && b.temple > 0) { sprite = stage >= 4 ? 'greatTemple' : stage >= 3 ? 'temple' : 'shrine'; sc = stage >= 4 ? 1.05 : 1.1; }
      else if (l.role === 'barn' && b.barn > 0) sprite = 'barn';
      else if (l.role === 'barn' && b.woodstock > 0) sprite = 'woodpile';
      else if (l.role === 'yard' && (b.woodstock > 0 || b.stonestock > 0)) sprite = 'yard';
      else if (l.role === 'work' && works.length) {
        // In the city the trades move into proper shopfronts with a hanging sign.
        const w = works.shift();
        trade = w;
        if (stage >= 4) { sprite = 'townhouse'; sign = { smithy: '#5a5a62', tannery: '#c07a3a', apothecary: '#3f7a3a' }[w]; }
        else sprite = w;
      }
      else if (l.role === 'barracks' && b.barracks > 0) sprite = 'barracks';
      else if (l.role === 'stable' && b.stable > 0) sprite = 'stable';
      else if (l.role === 'grave' && b.graveyard > 0) sprite = 'graveyard';
      if (!sprite) {
        // Homes: the style follows the stage. Newer, outer lots are a step behind.
        const want = stage === 1 ? 1 : stage === 2 ? 2 : stage === 3 ? (l.st < 3 ? 3 : 2) : (l.st === 4 ? 3 : l.prime && b.mansion > 0 && st.k > 0.3 ? 5 : 4);
        sprite = home(want);
        if (sprite === 'manor') sc = 1.05;
      }
      items.push({ sprite, x: l.x, y: l.y, s: sc, seed, sign, trade, city: stage >= 4, wall: TOWN_WALLS[seed % TOWN_WALLS.length], roof: TOWN_ROOFS[(seed >> 3) % TOWN_ROOFS.length] });
    }
    if (wonder) items.push({ sprite: 'wonder', x: 0.382, y: 0.632, s: 1.1 });
    if (b.altar > 0 && stage >= 2) items.push({ sprite: 'altar', x: 0.585, y: 0.69, s: 1.0 });

    // The square in the middle.
    if (stage <= 2) items.push({ sprite: 'well', x: PLAZA.x, y: PLAZA.y + 0.01, s: 1.1 });
    else items.push({ sprite: stage >= 4 ? 'fountain2' : 'fountain', x: PLAZA.x, y: PLAZA.y + 0.012, s: 1.15 });
    if (stage >= 3) {
      items.push({ sprite: 'stall', x: PLAZA.x - 0.042, y: PLAZA.y + 0.022, s: 1.1, seed: 0 });
      items.push({ sprite: 'stall', x: PLAZA.x + 0.042, y: PLAZA.y + 0.022, s: 1.1, seed: 1 });
    }
    if (stage === 2) for (const dx of [-0.035, 0.035]) items.push({ sprite: 'flowers', x: PLAZA.x + dx, y: PLAZA.y + 0.03, s: 1 });

    // Street lamps and trees (town and city).
    if (stage >= 3) {
      const lampX = stage >= 4 ? [0.418, 0.662, 0.466, 0.614, 0.37, 0.71, 0.758] : [0.418, 0.466, 0.614, 0.662];
      const nL = stage >= 4 ? Math.max(4, Math.ceil(lampX.length * (0.4 + 0.6 * st.k))) : lampX.length;
      lampX.slice(0, nL).forEach((x, i) => items.push({ sprite: 'lamp', x, y: ROAD_Y + 0.028, s: 1, seed: i }));
    }
    if (stage >= 4) {
      const trees = [[0.468, 0.868], [0.612, 0.868], [0.394, 0.84], [0.662, 0.84], [0.54, 0.99], [0.708, 0.84], [0.346, 0.84], [0.47, 0.995], [0.61, 0.995]];
      const nT = Math.max(2, Math.ceil(trees.length * (0.3 + 0.7 * st.k)));
      trees.slice(0, nT).forEach(([x, y], i) => items.push({ sprite: 'roundTree', x, y, s: 1, seed: i }));
    }

    // Outside the east gate: gardens, then an orchard, then a suburb.
    if (stage >= 2) {
      items.push({ sprite: 'garden', x: 0.86, y: 0.965, s: 1.35, seed: 0 });
      if (stage === 2) items.push({ sprite: 'garden', x: 0.93, y: 0.9, s: 1.35, seed: 1 });
      const orchard = stage >= 4 ? [[0.81, 0.99], [0.905, 0.995], [0.97, 0.99]]
        : stage >= 3 ? [[0.82, 0.88], [0.87, 0.875], [0.92, 0.88], [0.97, 0.875], [0.92, 0.96], [0.97, 0.955]] : [[0.97, 0.94]];
      orchard.forEach(([x, y], i) => items.push({ sprite: 'roundTree', x, y, s: 0.95, seed: i + 3 }));
    }

    // Walls: a palisade once you have the upgrade, stone with fortifications.
    if (b.fortification > 0 && stage >= 3) P.wall = 2;
    else if ((s.upg.palisade || b.fortification > 0) && stage >= 2) P.wall = 1;
    if (P.wall) {
      items.push({ sprite: 'gate', x: 0.312, y: ROAD_Y + 0.014, s: 1.15, kind: P.wall });
      items.push({ sprite: 'gate', x: 0.768, y: ROAD_Y + 0.014, s: 1.15, kind: P.wall });
    }
    P.carts = stage >= 4 ? 2 : stage >= 3 ? 1 : 0;
    items.sort((a, c) => a.y - c.y);
    return P;
  }
  function getPlan() {
    const s = state, b = s.bld;
    const st = stageOf(Sim.pop(s).living);
    const key = [st.stage, Math.round(st.k * 20), bestHousing(b), b.temple > 0, b.barn > 0, b.woodstock > 0, b.stonestock > 0,
      b.smithy > 0, b.tannery > 0, b.apothecary > 0, b.barracks > 0, b.stable > 0, b.graveyard > 0, b.altar > 0,
      b.fortification > 0, !!s.upg.palisade, s.wonder.stage, s.wonders.length].join(',');
    if (key !== planKey) {
      planKey = key; plan = makePlan(s, st);
      // Work spots for the villagers: forge, tannery, herbalist, temple, barracks, stable, wonder.
      plan.spots = {};
      for (const it of plan.items) {
        const k = it.trade || { shrine: 'temple', temple: 'temple', greatTemple: 'temple' }[it.sprite] || it.sprite;
        if (!plan.spots[k]) plan.spots[k] = { x: it.x, y: it.y };
      }
    }
    return plan;
  }

  // ---------- drawing helpers ----------
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function poly(pts, c, stroke) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath(); ctx.fillStyle = c; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function circle(x, y, r, c) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
  function shadow(x, y, w) {
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(x, y, w * 0.6, w * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Sprites: (x, y) is the bottom centre, u is the size unit.
  const SPRITES = {
    tent(x, y, u) {
      shadow(x, y, u * 1.2);
      poly([x - u * 0.7, y, x, y - u * 1.0, x + u * 0.7, y], '#d9c08a', '#8a6f45');
      poly([x - u * 0.15, y, x, y - u * 0.5, x + u * 0.15, y], '#5a4426');
    },
    hut(x, y, u) {
      shadow(x, y, u * 1.4);
      rect(x - u * 0.6, y - u * 0.7, u * 1.2, u * 0.7, '#9b6a3c');
      poly([x - u * 0.8, y - u * 0.65, x, y - u * 1.35, x + u * 0.8, y - u * 0.65], '#c9a75a', '#7d6230');
      rect(x - u * 0.15, y - u * 0.4, u * 0.3, u * 0.4, '#4a2f18');
    },
    cottage(x, y, u, o) {
      shadow(x, y, u * 1.6);
      rect(x - u * 0.75, y - u * 0.85, u * 1.5, u * 0.85, '#d8d0c0');
      poly([x - u * 0.9, y - u * 0.8, x, y - u * 1.5, x + u * 0.9, y - u * 0.8], (o && o.roof) || '#a5523a', 'rgba(0,0,0,.35)');
      rect(x + u * 0.35, y - u * 1.45, u * 0.18, u * 0.4, '#7a6a5a');
      rect(x - u * 0.15, y - u * 0.45, u * 0.3, u * 0.45, '#5a3a20');
      rect(x - u * 0.6, y - u * 0.65, u * 0.28, u * 0.22, '#ffe7a0');
    },
    house(x, y, u, o) {
      shadow(x, y, u * 2);
      rect(x - u * 0.95, y - u * 1.3, u * 1.9, u * 1.3, (o && o.wall) || '#e6dccb');
      rect(x - u * 0.95, y - u * 1.3, u * 1.9, u * 0.08, '#8c6b4a');
      poly([x - u * 1.1, y - u * 1.25, x, y - u * 2.0, x + u * 1.1, y - u * 1.25], (o && o.roof) || '#7a3d2a', 'rgba(0,0,0,.35)');
      rect(x + u * 0.45, y - u * 2.0, u * 0.22, u * 0.5, '#7a6a5a');
      rect(x - u * 0.18, y - u * 0.55, u * 0.36, u * 0.55, '#5a3a20');
      rect(x - u * 0.75, y - u * 1.0, u * 0.3, u * 0.25, '#ffe7a0');
      rect(x + u * 0.45, y - u * 1.0, u * 0.3, u * 0.25, '#ffe7a0');
    },
    mansion(x, y, u) {
      shadow(x, y, u * 3);
      rect(x - u * 1.5, y - u * 1.6, u * 3, u * 1.6, '#cfc6b8');
      rect(x - u * 1.7, y - u * 2.2, u * 0.6, u * 2.2, '#bdb3a3');
      rect(x + u * 1.1, y - u * 2.2, u * 0.6, u * 2.2, '#bdb3a3');
      poly([x - u * 1.8, y - u * 2.2, x - u * 1.4, y - u * 2.8, x - u * 1.0, y - u * 2.2], '#3d5a8a');
      poly([x + u * 1.0, y - u * 2.2, x + u * 1.4, y - u * 2.8, x + u * 1.8, y - u * 2.2], '#3d5a8a');
      poly([x - u * 1.2, y - u * 1.6, x, y - u * 2.3, x + u * 1.2, y - u * 1.6], '#4a6a9a');
      rect(x - u * 0.25, y - u * 0.7, u * 0.5, u * 0.7, '#4a2f18');
      for (const dx of [-0.9, -0.5, 0.3, 0.7]) rect(x + u * dx, y - u * 1.25, u * 0.22, u * 0.3, '#ffe7a0');
    },
    barn(x, y, u) {
      shadow(x, y, u * 2);
      rect(x - u * 0.95, y - u * 1.1, u * 1.9, u * 1.1, '#a8322a');
      poly([x - u * 1.05, y - u * 1.05, x - u * 0.6, y - u * 1.6, x + u * 0.6, y - u * 1.6, x + u * 1.05, y - u * 1.05], '#6e2a22');
      rect(x - u * 0.4, y - u * 0.75, u * 0.8, u * 0.75, '#f1e3c8');
      ctx.strokeStyle = '#a8322a'; ctx.lineWidth = Math.max(1, u * 0.08);
      ctx.beginPath(); ctx.moveTo(x - u * 0.4, y - u * 0.75); ctx.lineTo(x + u * 0.4, y); ctx.moveTo(x + u * 0.4, y - u * 0.75); ctx.lineTo(x - u * 0.4, y); ctx.stroke();
    },
    woodpile(x, y, u) {
      shadow(x, y, u * 1.4);
      for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
        circle(x - u * 0.55 + (i + row * 0.5) * u * 0.36, y - u * 0.18 - row * u * 0.3, u * 0.17, '#8a5a30');
        circle(x - u * 0.55 + (i + row * 0.5) * u * 0.36, y - u * 0.18 - row * u * 0.3, u * 0.09, '#d9a46a');
      }
    },
    stonepile(x, y, u) {
      shadow(x, y, u * 1.4);
      poly([x - u * 0.7, y, x - u * 0.5, y - u * 0.45, x - u * 0.1, y - u * 0.5, x, y], '#9aa2aa');
      poly([x - u * 0.2, y, x + u * 0.05, y - u * 0.7, x + u * 0.45, y - u * 0.6, x + u * 0.7, y], '#b8c0c8');
      poly([x - u * 0.35, y - u * 0.4, x - u * 0.15, y - u * 0.85, x + u * 0.2, y - u * 0.7, x + u * 0.1, y - u * 0.4], '#c8d0d8');
    },
    smithy(x, y, u) {
      shadow(x, y, u * 1.8);
      rect(x - u * 0.85, y - u * 0.95, u * 1.7, u * 0.95, '#6c6a68');
      poly([x - u, y - u * 0.9, x, y - u * 1.4, x + u, y - u * 0.9], '#3e3a38');
      rect(x + u * 0.4, y - u * 1.6, u * 0.28, u * 0.7, '#4a4644');
      rect(x - u * 0.3, y - u * 0.55, u * 0.6, u * 0.55, (Math.sin(t * 6) > 0) ? '#ff8a3d' : '#ffb347');
    },
    tannery(x, y, u) {
      shadow(x, y, u * 1.8);
      rect(x - u * 0.8, y - u * 0.8, u * 1.6, u * 0.8, '#b08a5a');
      poly([x - u * 0.95, y - u * 0.75, x, y - u * 1.25, x + u * 0.95, y - u * 0.75], '#6a4a2a');
      rect(x + u * 0.9, y - u * 0.9, u * 0.05, u * 0.9, '#5a3a20');
      rect(x + u * 0.95, y - u * 0.85, u * 0.35, u * 0.5, '#e0975a');
    },
    apothecary(x, y, u) {
      shadow(x, y, u * 1.6);
      rect(x - u * 0.7, y - u * 0.85, u * 1.4, u * 0.85, '#b9cfa6');
      poly([x - u * 0.85, y - u * 0.8, x, y - u * 1.35, x + u * 0.85, y - u * 0.8], '#3f7a3a');
      circle(x, y - u * 0.5, u * 0.18, '#7fd17a');
    },
    temple(x, y, u) {
      shadow(x, y, u * 2.4);
      rect(x - u * 1.2, y - u * 0.25, u * 2.4, u * 0.25, '#d8d0c0');
      for (const dx of [-0.95, -0.45, 0.05, 0.55]) rect(x + u * dx, y - u * 1.35, u * 0.35, u * 1.1, '#eee6d6');
      rect(x - u * 1.2, y - u * 1.5, u * 2.4, u * 0.2, '#d8d0c0');
      poly([x - u * 1.3, y - u * 1.5, x, y - u * 2.1, x + u * 1.3, y - u * 1.5], '#e8dfcf', '#a89f8f');
      circle(x, y - u * 1.75, u * 0.12, '#ffe38a');
    },
    barracks(x, y, u) {
      shadow(x, y, u * 2.2);
      rect(x - u * 1.1, y - u * 1.0, u * 2.2, u * 1.0, '#7b6a58');
      for (let i = 0; i < 5; i++) rect(x - u * 1.1 + i * u * 0.5, y - u * 1.2, u * 0.25, u * 0.2, '#7b6a58');
      rect(x - u * 0.2, y - u * 0.6, u * 0.4, u * 0.6, '#3a2a1a');
      rect(x + u * 0.8, y - u * 1.9, u * 0.05, u * 0.9, '#3a2a1a');
      poly([x + u * 0.85, y - u * 1.9, x + u * 1.35, y - u * 1.75, x + u * 0.85, y - u * 1.6], '#c0392b');
    },
    stable(x, y, u, o) {
      shadow(x, y, u * 2);
      rect(x - u * 1.0, y - u * 0.8, u * 2.0, u * 0.8, o && o.city ? '#c9bda6' : '#9b6a3c');
      poly([x - u * 1.1, y - u * 0.75, x, y - u * 1.2, x + u * 1.1, y - u * 0.75], o && o.city ? '#7a3d2a' : '#c9a75a');
      for (const dx of [-0.75, -0.15, 0.45]) rect(x + u * dx, y - u * 0.55, u * 0.35, u * 0.55, '#4a2f18');
    },
    graveyard(x, y, u) {
      rect(x - u * 1.0, y - u * 0.05, u * 2.0, u * 0.05, '#5a4a3a');
      for (const dx of [-0.7, -0.2, 0.3, 0.75]) {
        rect(x + u * dx - u * 0.12, y - u * 0.5, u * 0.24, u * 0.5, '#8a8f99');
        circle(x + u * dx, y - u * 0.5, u * 0.12, '#8a8f99');
      }
    },
    altar(x, y, u) {
      shadow(x, y, u * 1.2);
      rect(x - u * 0.5, y - u * 0.5, u * 1.0, u * 0.5, '#b8b0a0');
      rect(x - u * 0.6, y - u * 0.6, u * 1.2, u * 0.12, '#d8d0c0');
      const f = 0.8 + 0.2 * Math.sin(t * 8 + x);
      poly([x - u * 0.15, y - u * 0.6, x, y - u * (0.6 + 0.5 * f), x + u * 0.15, y - u * 0.6], '#ffb347');
    },
    // ----- town and city pieces -----
    townhouse(x, y, u, o) {
      const hw = u * 0.82, h = u * 2.25, wall = o.wall || '#e9dfcb', roof = o.roof || '#7a3d2a';
      shadow(x, y, u * 1.9);
      rect(x - hw, y - h, hw * 2, h, wall);
      rect(x + hw - u * 0.2, y - h, u * 0.2, h, 'rgba(0,0,0,.10)');
      rect(x - hw, y - u * 0.98, hw * 2, u * 0.08, '#8c6b4a');
      rect(x - hw - u * 0.04, y - h, hw * 2 + u * 0.08, u * 0.09, '#8c6b4a');
      poly([x - hw - u * 0.14, y - h + u * 0.04, x - hw + u * 0.3, y - h - u * 0.72, x + hw - u * 0.3, y - h - u * 0.72, x + hw + u * 0.14, y - h + u * 0.04], roof);
      rect(x - u * 0.16, y - h - u * 0.55, u * 0.32, u * 0.3, wall);
      poly([x - u * 0.22, y - h - u * 0.52, x, y - h - u * 0.72, x + u * 0.22, y - h - u * 0.52], roof);
      rect(x - u * 0.08, y - h - u * 0.48, u * 0.16, u * 0.18, '#ffe7a0');
      rect(x + hw * 0.5, y - h - u * 0.92, u * 0.2, u * 0.5, '#7a6a5a');
      for (const dx of [-0.52, 0.22]) for (const dy of [1.95, 1.4]) {
        rect(x + u * dx, y - u * dy, u * 0.3, u * 0.34, '#ffe7a0');
        rect(x + u * dx - u * 0.03, y - u * dy + u * 0.34, u * 0.36, u * 0.05, '#8c6b4a');
      }
      rect(x - u * 0.6, y - u * 0.72, u * 0.5, u * 0.42, '#ffe7a0');
      rect(x - u * 0.62, y - u * 0.8, u * 0.54, u * 0.1, roof);
      rect(x + u * 0.12, y - u * 0.68, u * 0.34, u * 0.68, '#5a3a20');
      rect(x + u * 0.08, y - u * 0.04, u * 0.42, u * 0.06, '#9a8f80');
      if (o.sign) {
        rect(x - hw - u * 0.3, y - u * 1.12, u * 0.42, u * 0.05, '#3a2a1a');
        rect(x - hw - u * 0.28, y - u * 1.07, u * 0.34, u * 0.3, o.sign);
        rect(x - hw - u * 0.22, y - u * 1.0, u * 0.22, u * 0.16, 'rgba(255,255,255,.35)');
      }
    },
    manor(x, y, u, o) {
      const hw = u * 1.15, h = u * 2.1, wall = '#d9d1c2', roof = '#41608f';
      shadow(x, y, u * 2.6);
      rect(x - hw, y - h, hw * 2, h, wall);
      rect(x + hw - u * 0.22, y - h, u * 0.22, h, 'rgba(0,0,0,.10)');
      poly([x - hw - u * 0.12, y - h + u * 0.04, x - hw + u * 0.45, y - h - u * 0.8, x + hw - u * 0.45, y - h - u * 0.8, x + hw + u * 0.12, y - h + u * 0.04], roof);
      // corner tower
      const tx = x - hw + u * 0.05;
      rect(tx - u * 0.36, y - h - u * 0.75, u * 0.72, h + u * 0.75, '#cbc2b2');
      poly([tx - u * 0.48, y - h - u * 0.72, tx, y - h - u * 1.85, tx + u * 0.48, y - h - u * 0.72], roof);
      rect(tx - u * 0.02, y - h - u * 2.2, u * 0.04, u * 0.4, '#3a2a1a');
      poly([tx + u * 0.02, y - h - u * 2.2, tx + u * 0.02 + u * 0.38 * (0.8 + 0.2 * Math.sin(t * 3 + x)), y - h - u * 2.08, tx + u * 0.02, y - h - u * 1.96], '#c0392b');
      rect(tx - u * 0.12, y - h - u * 0.3, u * 0.24, u * 0.36, '#ffe7a0');
      for (const dx of [-0.35, 0.15, 0.62]) for (const dy of [1.75, 1.15]) rect(x + u * dx, y - u * dy, u * 0.26, u * 0.36, '#ffe7a0');
      rect(x - u * 0.05, y - u * 0.75, u * 0.5, u * 0.75, '#4a2f18');
      circle(x + u * 0.2, y - u * 0.75, u * 0.25, '#4a2f18');
      rect(x - u * 0.2, y - u * 0.05, u * 0.8, u * 0.07, '#9a8f80');
    },
    shrine(x, y, u) {
      shadow(x, y, u * 1.6);
      rect(x - u * 0.8, y - u * 0.18, u * 1.6, u * 0.18, '#cfc6b4');
      for (const dx of [-0.6, 0.38]) rect(x + u * dx, y - u * 1.05, u * 0.22, u * 0.87, '#eee6d6');
      rect(x - u * 0.38, y - u * 1.0, u * 0.76, u * 0.82, '#d8cfbd');
      rect(x - u * 0.16, y - u * 0.55, u * 0.32, u * 0.37, '#5a3a20');
      rect(x - u * 0.75, y - u * 1.18, u * 1.5, u * 0.15, '#d8d0c0');
      poly([x - u * 0.85, y - u * 1.18, x, y - u * 1.6, x + u * 0.85, y - u * 1.18], '#e8dfcf', '#a89f8f');
      circle(x, y - u * 1.35, u * 0.08, '#ffe38a');
    },
    greatTemple(x, y, u) {
      shadow(x, y, u * 4.4);
      // dome behind the portico
      const dome = plan && plan.k >= 0.99 ? '#e3c25a' : '#e9e1d0';
      circle(x, y - u * 2.3, u * 1.05, dome);
      rect(x - u * 1.05, y - u * 2.3, u * 2.1, u * 0.4, dome);
      ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.beginPath(); ctx.arc(x + u * 0.3, y - u * 2.3, u * 0.75, -Math.PI / 2, 0); ctx.lineTo(x + u * 0.3, y - u * 2.3); ctx.fill();
      rect(x - u * 0.05, y - u * 3.75, u * 0.1, u * 0.45, '#c9a74a');
      circle(x, y - u * 3.75, u * 0.14, '#ffd54a');
      // steps and portico
      rect(x - u * 2.1, y - u * 0.16, u * 4.2, u * 0.16, '#cfc6b4');
      rect(x - u * 1.9, y - u * 0.32, u * 3.8, u * 0.16, '#ddd5c4');
      rect(x - u * 1.7, y - u * 0.44, u * 3.4, u * 0.12, '#e6dece');
      rect(x - u * 1.5, y - u * 1.75, u * 3.0, u * 1.31, '#d6cdb9');
      for (let i = 0; i < 6; i++) {
        const cx = x - u * 1.5 + u * 0.12 + i * u * 0.535;
        rect(cx, y - u * 1.75, u * 0.26, u * 1.31, '#f3ede0');
        rect(cx + u * 0.18, y - u * 1.75, u * 0.08, u * 1.31, 'rgba(0,0,0,.08)');
        rect(cx - u * 0.04, y - u * 1.8, u * 0.34, u * 0.08, '#e6dece');
      }
      rect(x - u * 0.24, y - u * 1.1, u * 0.48, u * 0.66, '#5a3a20');
      rect(x - u * 1.65, y - u * 2.05, u * 3.3, u * 0.3, '#e6dece');
      rect(x - u * 1.65, y - u * 1.82, u * 3.3, u * 0.05, '#c9a74a');
      poly([x - u * 1.78, y - u * 2.05, x, y - u * 2.75, x + u * 1.78, y - u * 2.05], '#efe8da', '#a89f8f');
      circle(x, y - u * 2.3, u * 0.16, '#ffd54a');
    },
    yard(x, y, u) {
      SPRITES.woodpile(x - u * 0.45, y - u * 0.02, u * 0.85);
      SPRITES.stonepile(x + u * 0.5, y, u * 0.8);
      ctx.strokeStyle = '#7a5a36'; ctx.lineWidth = Math.max(1, u * 0.07);
      ctx.beginPath(); ctx.moveTo(x - u * 1.0, y - u * 0.35); ctx.lineTo(x - u * 1.0, y); ctx.lineTo(x + u * 1.05, y); ctx.lineTo(x + u * 1.05, y - u * 0.35);
      ctx.moveTo(x - u * 1.0, y - u * 0.22); ctx.lineTo(x - u * 0.9, y - u * 0.22); ctx.moveTo(x + u * 0.95, y - u * 0.22); ctx.lineTo(x + u * 1.05, y - u * 0.22);
      ctx.stroke();
    },
    campfire(x, y, u) {
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; circle(x + Math.cos(a) * u * 0.35, y + Math.sin(a) * u * 0.12, u * 0.09, '#8a8f95'); }
      rect(x - u * 0.3, y - u * 0.1, u * 0.6, u * 0.1, '#6a4426');
      const f = 0.75 + 0.25 * Math.sin(t * 9) + 0.1 * Math.sin(t * 23);
      poly([x - u * 0.22, y - u * 0.05, x - u * 0.05, y - u * 0.75 * f, x + u * 0.03, y - u * 0.35, x + u * 0.12, y - u * 0.9 * f, x + u * 0.22, y - u * 0.05], '#ff9a3d');
      poly([x - u * 0.1, y - u * 0.05, x + u * 0.02, y - u * 0.45 * f, x + u * 0.12, y - u * 0.05], '#ffe08a');
    },
    well(x, y, u) {
      shadow(x, y, u * 1.2);
      ctx.fillStyle = '#9aa0a6'; ctx.beginPath(); ctx.ellipse(x, y - u * 0.25, u * 0.5, u * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      rect(x - u * 0.5, y - u * 0.25, u, u * 0.25, '#8a9096');
      ctx.fillStyle = '#3a4a5a'; ctx.beginPath(); ctx.ellipse(x, y - u * 0.27, u * 0.36, u * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      rect(x - u * 0.45, y - u * 1.0, u * 0.08, u * 0.75, '#6a4426');
      rect(x + u * 0.37, y - u * 1.0, u * 0.08, u * 0.75, '#6a4426');
      poly([x - u * 0.62, y - u * 0.95, x, y - u * 1.3, x + u * 0.62, y - u * 0.95], '#8a5a30');
      rect(x - u * 0.02, y - u * 0.95, u * 0.04, u * 0.4, '#3a2a1a');
      rect(x - u * 0.1, y - u * 0.6, u * 0.2, u * 0.16, '#7a5a36');
    },
    fountain(x, y, u) {
      shadow(x, y, u * 1.9);
      ctx.fillStyle = '#b8b2a6'; ctx.beginPath(); ctx.ellipse(x, y - u * 0.3, u * 0.95, u * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      rect(x - u * 0.95, y - u * 0.3, u * 1.9, u * 0.3, '#a8a296');
      ctx.fillStyle = '#6fa8d0'; ctx.beginPath(); ctx.ellipse(x, y - u * 0.32, u * 0.8, u * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      rect(x - u * 0.1, y - u * 1.0, u * 0.2, u * 0.7, '#c8c2b6');
      ctx.fillStyle = '#c8c2b6'; ctx.beginPath(); ctx.ellipse(x, y - u * 1.0, u * 0.32, u * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      fountainJets(x, y - u * 1.05, u, 0.55);
    },
    fountain2(x, y, u) {
      shadow(x, y, u * 2.4);
      ctx.fillStyle = '#c4beb2'; ctx.beginPath(); ctx.ellipse(x, y - u * 0.32, u * 1.2, u * 0.36, 0, 0, Math.PI * 2); ctx.fill();
      rect(x - u * 1.2, y - u * 0.32, u * 2.4, u * 0.32, '#b0aa9e');
      rect(x - u * 1.2, y - u * 0.36, u * 2.4, u * 0.06, '#d6d0c4');
      ctx.fillStyle = '#6fa8d0'; ctx.beginPath(); ctx.ellipse(x, y - u * 0.36, u * 1.02, u * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      rect(x - u * 0.12, y - u * 1.2, u * 0.24, u * 0.85, '#d6d0c4');
      ctx.fillStyle = '#d6d0c4'; ctx.beginPath(); ctx.ellipse(x, y - u * 1.2, u * 0.5, u * 0.14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6fa8d0'; ctx.beginPath(); ctx.ellipse(x, y - u * 1.22, u * 0.4, u * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      rect(x - u * 0.07, y - u * 1.75, u * 0.14, u * 0.55, '#d6d0c4');
      circle(x, y - u * 1.8, u * 0.12, '#c9a74a');
      fountainJets(x, y - u * 1.85, u, 0.65);
      fountainJets(x, y - u * 1.2, u * 1.4, 0.25);
    },
    stall(x, y, u, o) {
      const c = (o.seed || 0) % 2 ? '#c0392b' : '#2f6fa3';
      rect(x - u * 0.55, y - u * 0.9, u * 0.07, u * 0.9, '#6a4426');
      rect(x + u * 0.48, y - u * 0.9, u * 0.07, u * 0.9, '#6a4426');
      rect(x - u * 0.55, y - u * 0.45, u * 1.1, u * 0.3, '#9b6a3c');
      for (let i = 0; i < 4; i++) circle(x - u * 0.38 + i * u * 0.25, y - u * 0.5, u * 0.1, ['#e8c45a', '#d9534f', '#8fc45a', '#e0975a'][(i + (o.seed || 0)) % 4]);
      for (let i = 0; i < 5; i++) poly([x - u * 0.65 + i * u * 0.26, y - u * 0.9, x - u * 0.55 + i * u * 0.26, y - u * 1.2, x - u * 0.29 + i * u * 0.26, y - u * 1.2, x - u * 0.39 + i * u * 0.26, y - u * 0.9], i % 2 ? '#f1e8d6' : c);
    },
    flowers(x, y, u) {
      ctx.fillStyle = '#4f7f3a'; ctx.beginPath(); ctx.ellipse(x, y - u * 0.1, u * 0.45, u * 0.14, 0, 0, Math.PI * 2); ctx.fill();
      const cols = ['#f2c94c', '#e86a8a', '#ffffff', '#c387e0'];
      for (let i = 0; i < 7; i++) circle(x - u * 0.35 + i * u * 0.12, y - u * 0.14 - (i % 2) * u * 0.06, u * 0.06, cols[i % 4]);
    },
    garden(x, y, u, o, L) {
      L = L || CLASSIC;
      const snow = Math.min(0.85, (L.snow || 0) * 0.85);
      rect(x - u * 1.3, y - u * 0.7, u * 2.6, u * 0.7, mixHex(L.soil || '#8a6a3a', '#eef2f6', snow));
      for (let r = 0; r < 3; r++) for (let i = 0; i < 7; i++) {
        const cx = x - u * 1.1 + i * u * 0.37, cy = y - u * 0.55 + r * u * 0.22;
        circle(cx, cy, u * 0.1, mixHex(r % 2 ? '#5f9a3e' : '#7cb850', '#e8eef2', snow));
      }
      ctx.strokeStyle = '#7a5a36'; ctx.lineWidth = Math.max(1, u * 0.05);
      ctx.strokeRect(x - u * 1.3, y - u * 0.7, u * 2.6, u * 0.7);
    },
    lamp(x, y, u) {
      rect(x - u * 0.04, y - u * 1.4, u * 0.08, u * 1.4, '#3a3632');
      rect(x - u * 0.1, y - u * 0.06, u * 0.2, u * 0.06, '#3a3632');
      rect(x - u * 0.13, y - u * 1.62, u * 0.26, u * 0.26, '#3a3632');
      rect(x - u * 0.09, y - u * 1.58, u * 0.18, u * 0.18, '#ffe7a0');
      poly([x - u * 0.16, y - u * 1.62, x, y - u * 1.76, x + u * 0.16, y - u * 1.62], '#3a3632');
      lights.push({ x, y: y - u * 1.49, r: u * 1.6 });
    },
    roundTree(x, y, u, o, L) {
      L = L || CLASSIC;
      const snow = L.snow || 0, bare = Math.min(1, snow * 1.2);
      shadow(x, y, u * 1.2);
      rect(x - u * 0.08, y - u * 0.9, u * 0.16, u * 0.9, '#5a3a20');
      if (bare > 0.02) {
        ctx.strokeStyle = '#5a3a20'; ctx.lineWidth = Math.max(1, u * 0.06);
        ctx.beginPath();
        ctx.moveTo(x, y - u * 0.8); ctx.lineTo(x - u * 0.45, y - u * 1.45);
        ctx.moveTo(x, y - u * 0.9); ctx.lineTo(x + u * 0.4, y - u * 1.55);
        ctx.moveTo(x, y - u * 0.9); ctx.lineTo(x + u * 0.02, y - u * 1.75);
        ctx.stroke();
      }
      let leaf = mixHex('#4f8f43', AUTUMN_LEAVES[(o.seed || 0) % AUTUMN_LEAVES.length], L.autumn || 0);
      if ((L.bloom || 0) > 0 && (o.seed || 0) % 2 === 0) leaf = mixHex('#4f8f43', '#f4b3cd', L.bloom);
      ctx.globalAlpha = 1 - bare;
      if (ctx.globalAlpha > 0.01) {
        circle(x - u * 0.32, y - u * 1.2, u * 0.42, leaf);
        circle(x + u * 0.3, y - u * 1.25, u * 0.42, leaf);
        circle(x, y - u * 1.55, u * 0.48, leaf);
        circle(x - u * 0.1, y - u * 1.3, u * 0.36, 'rgba(255,255,255,.10)');
      }
      ctx.globalAlpha = 1;
      if (snow > 0.02) {
        ctx.globalAlpha = Math.min(1, snow);
        for (const [dx, dy] of [[-0.42, -1.48], [0.38, -1.57], [0.02, -1.77]]) circle(x + u * dx, y + u * dy, u * 0.1, '#f4f8fc');
        ctx.globalAlpha = 1;
      }
    },
    gate(x, y, u, o) {
      const stone = o.kind === 2;
      const tw = u * (stone ? 0.75 : 0.6), th = u * (stone ? 2.6 : 2.0);
      shadow(x, y, u * 1.8);
      if (stone) {
        rect(x - tw, y - th, tw * 2, th, '#a3a7ab');
        rect(x + tw - u * 0.2, y - th, u * 0.2, th, 'rgba(0,0,0,.12)');
        for (let i = 0; i < 4; i++) rect(x - tw + i * tw * 0.55, y - th - u * 0.25, tw * 0.32, u * 0.25, '#a3a7ab');
        rect(x - u * 0.38, y - u * 1.0, u * 0.76, u * 1.0, '#3a3530');
        circle(x, y - u * 1.0, u * 0.38, '#3a3530');
        rect(x - u * 0.1, y - th + u * 0.45, u * 0.2, u * 0.35, '#2a2a2a');
        if (plan && plan.stage >= 4) {
          rect(x - u * 0.03, y - th - u * 1.1, u * 0.06, u * 0.9, '#3a2a1a');
          const wv = Math.sin(t * 3 + x) * u * 0.08;
          poly([x + u * 0.03, y - th - u * 1.1, x + u * 0.6, y - th - u * 1.0 + wv, x + u * 0.03, y - th - u * 0.75], '#c0392b');
        }
      } else {
        for (const dx of [-tw, tw - u * 0.16]) rect(x + dx, y - th, u * 0.16, th, '#7a4f2a');
        rect(x - tw, y - th + u * 0.3, tw * 2, u * 0.5, '#8a5a30');
        poly([x - tw - u * 0.15, y - th + u * 0.3, x, y - th - u * 0.3, x + tw + u * 0.15, y - th + u * 0.3], '#6a4426');
      }
    },
    wonder(x, y, u) {
      const s = state;
      const done = s.wonder.stage >= 2 || (s.wonder.stage === 0 && s.wonders.length);
      const k = done ? 1 : Math.max(0.12, Math.min(1, s.wonder.progress / 100));
      const tiers = 5, built = k * tiers;
      shadow(x, y, u * 5.6);
      for (let i = 0; i < tiers; i++) {
        const f = Math.min(1, built - i);
        if (f <= 0) break;
        const w = u * (2.6 - i * 0.42), h = u * 0.95 * f, by = y - i * u * 0.95;
        rect(x - w, by - h, w * 2, h, i % 2 ? '#e2d3a8' : '#d8c896');
        rect(x + w - u * 0.25, by - h, u * 0.25, h, 'rgba(0,0,0,.10)');
        rect(x - w, by - h, w * 2, u * 0.07, '#efe3bf');
        rect(x - u * 0.32, by - h, u * 0.64, h, '#c9b47e');
        for (let j = 0; j < 4 * f; j++) rect(x - u * 0.32, by - j * u * 0.22 - u * 0.06, u * 0.64, u * 0.04, '#b39d68');
      }
      const topY = y - Math.min(built, tiers) * u * 0.95;
      if (done) {
        rect(x - u * 0.55, topY - u * 0.8, u * 1.1, u * 0.8, '#efe3bf');
        poly([x - u * 0.65, topY - u * 0.8, x, topY - u * 1.5, x + u * 0.65, topY - u * 0.8], '#ffd54a');
        lights.push({ x, y: topY - u * 1.1, r: u * 2.4, gold: true });
      } else {
        // scaffolding and a crane on the unfinished top
        ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = Math.max(1, u * 0.06);
        ctx.beginPath();
        const sw = u * (2.6 - Math.floor(built) * 0.42);
        for (let i = 0; i <= 4; i++) { const sx = x - sw + i * sw / 2; ctx.moveTo(sx, topY + u * 0.9); ctx.lineTo(sx, topY - u * 0.7); }
        ctx.moveTo(x - sw, topY - u * 0.2); ctx.lineTo(x + sw, topY - u * 0.2);
        ctx.moveTo(x + sw * 0.6, topY - u * 0.7); ctx.lineTo(x + sw * 0.6, topY - u * 2.0); ctx.lineTo(x - sw * 0.3, topY - u * 2.0);
        ctx.stroke();
        const sway = Math.sin(t * 0.8) * u * 0.1;
        ctx.beginPath(); ctx.moveTo(x - sw * 0.1, topY - u * 2.0); ctx.lineTo(x - sw * 0.1 + sway, topY - u * 1.2); ctx.stroke();
        rect(x - sw * 0.1 + sway - u * 0.15, topY - u * 1.2, u * 0.3, u * 0.22, '#b8a070');
      }
    },
  };

  function drawTree(x, y, u, shade, bloom, snow) {
    rect(x - u * 0.08, y - u * 0.5, u * 0.16, u * 0.5, '#5a3a20');
    poly([x - u * 0.5, y - u * 0.4, x, y - u * 1.5, x + u * 0.5, y - u * 0.4], shade);
    poly([x - u * 0.4, y - u * 0.8, x, y - u * 1.9, x + u * 0.4, y - u * 0.8], shade);
    if (bloom > 0.02) {
      ctx.globalAlpha = Math.min(1, bloom);
      for (const [dx, dy] of [[-0.2, -0.6], [0.18, -0.95], [-0.08, -1.3], [0.22, -0.55], [0.05, -1.6]]) circle(x + u * dx, y + u * dy, u * 0.08, '#f7c6d9');
      ctx.globalAlpha = 1;
    }
    if (snow > 0.02) {
      ctx.globalAlpha = Math.min(1, snow);
      poly([x - u * 0.2, y - u * 1.4, x, y - u * 1.92, x + u * 0.2, y - u * 1.4, x, y - u * 1.5], '#f4f8fc');
      poly([x - u * 0.42, y - u * 0.45, x - u * 0.28, y - u * 0.8, x - u * 0.1, y - u * 0.62], '#f4f8fc');
      ctx.globalAlpha = 1;
    }
  }

  function drawPerson(x, y, u, color, phase, enemy) {
    const step = Math.sin(phase) * u * 0.12;
    ctx.strokeStyle = enemy ? '#2a0a0a' : '#2a1a10';
    ctx.lineWidth = Math.max(1, u * 0.09);
    ctx.beginPath();
    ctx.moveTo(x, y - u * 0.35); ctx.lineTo(x - step, y);
    ctx.moveTo(x, y - u * 0.35); ctx.lineTo(x + step, y);
    ctx.stroke();
    rect(x - u * 0.13, y - u * 0.75, u * 0.26, u * 0.42, color);
    circle(x, y - u * 0.88, u * 0.13, enemy ? '#c08870' : '#f0c8a0');
  }
  function drawWolf(x, y, u, phase, dir) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
    const st = Math.sin(phase) * u * 0.1;
    rect(-u * 0.4, -u * 0.45, u * 0.75, u * 0.25, '#5a5a62');
    rect(-u * 0.35 + st, -u * 0.22, u * 0.08, u * 0.22, '#4a4a52');
    rect(u * 0.2 - st, -u * 0.22, u * 0.08, u * 0.22, '#4a4a52');
    poly([u * 0.3, -u * 0.5, u * 0.6, -u * 0.38, u * 0.3, -u * 0.25], '#5a5a62');
    poly([-u * 0.4, -u * 0.42, -u * 0.65, -u * 0.55, -u * 0.4, -u * 0.32], '#5a5a62');
    ctx.restore();
  }

  // ---------- seasons (looks only; see js/seasons.js) ----------
  // CLASSIC is the original picture, used when "Show the seasons" is off.
  const CLASSIC = { sky: 0, hills: '#5f8a4a', mTop: '#78a956', mBot: '#5c8f40', soil: '#8a6a3a', stalkA: '#e8c45a', stalkB: '#d9b247', stalkH: 0.55, tree1: '#3a7d3f', tree2: '#2f6b34', autumn: 0, snow: 0, bloom: 0 };
  const LOOKS = {
    spring: { sky: 0, hills: '#6a9a4e', mTop: '#88c060', mBot: '#69a247', soil: '#7a5a32', stalkA: '#9ad66a', stalkB: '#7cc455', stalkH: 0.3, tree1: '#4a9149', tree2: '#3a7d3f', autumn: 0, snow: 0, bloom: 1 },
    summer: { sky: 0, hills: '#5f8a4a', mTop: '#78a956', mBot: '#5c8f40', soil: '#8a6a3a', stalkA: '#cfc552', stalkB: '#bdb846', stalkH: 0.5, tree1: '#3a7d3f', tree2: '#2f6b34', autumn: 0, snow: 0, bloom: 0 },
    autumn: { sky: 0.1, hills: '#8c8a46', mTop: '#a9a457', mBot: '#8c8a40', soil: '#8a6a3a', stalkA: '#e8c45a', stalkB: '#d9b247', stalkH: 0.6, tree1: '#3a7d3f', tree2: '#2f6b34', autumn: 1, snow: 0, bloom: 0 },
    winter: { sky: 0.35, hills: '#c9d1da', mTop: '#e8eef4', mBot: '#cfd8e1', soil: '#d8dee5', stalkA: '#9a8a6a', stalkB: '#8a7a5a', stalkH: 0.12, tree1: '#2f5f3e', tree2: '#284f34', autumn: 0, snow: 1, bloom: 0 },
  };
  const AUTUMN_LEAVES = ['#d9822b', '#e0a83a', '#b9512c', '#c96a2a'];
  const hexCache = {};
  function hexRgb(h) {
    if (!hexCache[h]) hexCache[h] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    return hexCache[h];
  }
  function mixHex(a, b, k) {
    if (k <= 0) return a;
    if (k >= 1) return b;
    const A = hexRgb(a), B = hexRgb(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
  }
  let shownClock = -1; // eases toward the game clock so season changes fade in smoothly
  function seasonLook(dt) {
    const s = state;
    if (!s.seasonCfg || !s.seasonCfg.show || !window.Seasons) { shownClock = -1; return CLASSIC; }
    const target = s.clock || 0;
    if (shownClock < 0 || Math.abs(target - shownClock) > 30) shownClock = target;
    else shownClock += (target - shownClock) * Math.min(1, dt * 2);
    const len = Sim.D.seasons.length, list = Sim.D.seasons.list;
    const whole = Math.floor(shownClock / len), frac = (shownClock % len) / len;
    const cur = LOOKS[list[whole % list.length].id], next = LOOKS[list[(whole + 1) % list.length].id];
    // Hold each season's look, then blend into the next over its last 20%.
    let k = Math.max(0, (frac - 0.8) / 0.2);
    k = k * k * (3 - 2 * k);
    const out = {};
    for (const key in cur) out[key] = typeof cur[key] === 'number' ? cur[key] + (next[key] - cur[key]) * k : mixHex(cur[key], next[key], k);
    return out;
  }

  // Snow on roofs: each roof as triangles [left eave x, y, apex x, y, right eave x, y] in sprite units.
  const ROOFS = {
    tent: [[-0.7, 0, 0, -1.0, 0.7, 0]],
    hut: [[-0.8, -0.65, 0, -1.35, 0.8, -0.65]],
    cottage: [[-0.9, -0.8, 0, -1.5, 0.9, -0.8]],
    house: [[-1.1, -1.25, 0, -2.0, 1.1, -1.25]],
    mansion: [[-1.2, -1.6, 0, -2.3, 1.2, -1.6], [-1.8, -2.2, -1.4, -2.8, -1.0, -2.2], [1.0, -2.2, 1.4, -2.8, 1.8, -2.2]],
    smithy: [[-1, -0.9, 0, -1.4, 1, -0.9]],
    tannery: [[-0.95, -0.75, 0, -1.25, 0.95, -0.75]],
    apothecary: [[-0.85, -0.8, 0, -1.35, 0.85, -0.8]],
    temple: [[-1.3, -1.5, 0, -2.1, 1.3, -1.5]],
    stable: [[-1.1, -0.75, 0, -1.2, 1.1, -0.75]],
    shrine: [[-0.85, -1.18, 0, -1.6, 0.85, -1.18]],
    greatTemple: [[-1.78, -2.05, 0, -2.75, 1.78, -2.05]],
    manor: [[-1.58, -2.82, -1.1, -3.95, -0.62, -2.82]],
    well: [[-0.62, -0.95, 0, -1.3, 0.62, -0.95]],
  };
  // Hipped roofs: [half width, wall height, roof rise, inset] in sprite units.
  const TRAPS = { townhouse: [0.82, 2.25, 0.72, 0.3], manor: [1.15, 2.1, 0.8, 0.45] };
  function snowCap(sprite, x, y, u, amt) {
    ctx.globalAlpha = Math.min(1, amt);
    const c = '#f4f8fc';
    if (sprite === 'barn') poly([x - u * 0.8, y - u * 1.38, x - u * 0.6, y - u * 1.63, x + u * 0.6, y - u * 1.63, x + u * 0.8, y - u * 1.38, x + u * 0.2, y - u * 1.46, x - u * 0.3, y - u * 1.42], c);
    else if (sprite === 'barracks') rect(x - u * 1.12, y - u * 1.06, u * 2.24, u * 0.12, c);
    if (TRAPS[sprite]) {
      const [hw, h, rise, inset] = TRAPS[sprite].map(v => v * u), top = y - h - rise;
      poly([x - hw + inset, top - u * 0.04, x + hw - inset, top - u * 0.04, x + hw - inset * 0.3, top + rise * 0.45, x + u * 0.2, top + rise * 0.28, x - hw + inset * 0.4, top + rise * 0.5], c);
    }
    if (sprite === 'greatTemple') { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y - u * 3.18, u * 0.62, u * 0.2, 0, Math.PI, 0); ctx.fill(); }
    if (sprite === 'stall') rect(x - u * 0.65, y - u * 1.24, u * 1.3, u * 0.08, c);
    if (sprite === 'barn' || sprite === 'barracks') { /* handled above */ }
    else if (ROOFS[sprite]) {
      for (const r of ROOFS[sprite]) {
        const [lx, ly, ax, ay, rx, ry] = r.map(v => v * u);
        const f = 0.5, g = 0.38;
        poly([
          x + ax, y + ay - u * 0.05,
          x + ax + (rx - ax) * f, y + ay + (ry - ay) * f,
          x + ax + (rx - ax) * 0.25, y + ay + (ry - ay) * g,
          x + ax, y + ay + (ry - ay) * f * 0.85,
          x + ax + (lx - ax) * 0.3, y + ay + (ly - ay) * g,
          x + ax + (lx - ax) * f, y + ay + (ly - ay) * f,
        ], c);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Falling snow, autumn leaves and spring petals (positions in 0..1 of the canvas).
  const weather = [];
  function updateWeather(dt, L) {
    const spawn = (rate, make) => { let n = rate * dt; while (n > 0) { if (Math.random() < n) weather.push(make()); n -= 1; } };
    if (weather.length < 160) {
      spawn(L.snow * 45, () => ({ kind: 'snow', x: Math.random() * 1.1 - 0.05, y: -0.02, vx: 0.01, vy: 0.05 + Math.random() * 0.05, ph: Math.random() * 6, size: 0.06 + Math.random() * 0.08, land: 2 }));
      spawn(L.autumn * 7, () => ({ kind: 'leaf', x: 0.02 + Math.random() * 0.27, y: 0.38 + Math.random() * 0.2, vx: 0.015 + Math.random() * 0.02, vy: 0.03 + Math.random() * 0.02, ph: Math.random() * 6, color: AUTUMN_LEAVES[Math.floor(Math.random() * AUTUMN_LEAVES.length)], land: 0.62 + Math.random() * 0.33 }));
      spawn(L.bloom * 4, () => ({ kind: 'petal', x: 0.02 + Math.random() * 0.27, y: 0.38 + Math.random() * 0.2, vx: 0.025 + Math.random() * 0.02, vy: 0.02 + Math.random() * 0.015, ph: Math.random() * 6, land: 0.62 + Math.random() * 0.33 }));
    }
    for (let i = weather.length - 1; i >= 0; i--) {
      const w = weather[i];
      w.ph += dt * 2;
      w.x += (w.vx + Math.sin(w.ph) * 0.02) * dt;
      w.y += w.vy * dt;
      if (w.y > w.land || w.y > 1.02 || w.x > 1.05) weather.splice(i, 1);
    }
  }
  function drawWeather(u) {
    for (const w of weather) {
      const x = W * w.x, y = H * w.y;
      if (w.kind === 'snow') circle(x, y, u * w.size, 'rgba(255,255,255,.85)');
      else if (w.kind === 'petal') circle(x, y, u * 0.09, '#f7c6d9');
      else {
        ctx.save(); ctx.translate(x, y); ctx.rotate(w.ph * 1.5);
        rect(-u * 0.12, -u * 0.06, u * 0.24, u * 0.12, w.color);
        ctx.restore();
      }
    }
  }

  // ---------- villagers ----------
  function villageSpot() {
    const P = plan, R = Math.random();
    if (!P || P.stage === 0) { const a = Math.random() * Math.PI * 2; return { x: PLAZA.x + Math.cos(a) * 0.05, y: PLAZA.y + 0.02 + Math.sin(a) * 0.03 }; }
    if (R < 0.45) return { x: 0.34 + Math.random() * 0.4, y: ROAD_Y - 0.008 + Math.random() * 0.025 };
    if (R < 0.75) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 0.8; return { x: PLAZA.x + Math.cos(a) * PLAZA.rx * d, y: PLAZA.y + Math.sin(a) * PLAZA.ry * d + 0.01 }; }
    if (R < 0.88 && P.stage >= 2) return { x: PLAZA.x - 0.006 + Math.random() * 0.012, y: 0.68 + Math.random() * 0.1 };
    if (P.stage >= 3) return { x: R < 0.94 ? PLAZA.x - 0.006 + Math.random() * 0.012 : 0.36 + Math.random() * 0.37, y: R < 0.94 ? 0.86 + Math.random() * 0.12 : 0.675 + Math.random() * 0.015 };
    return { x: 0.36 + Math.random() * 0.36, y: ROAD_Y + Math.random() * 0.02 };
  }
  function syncPeople() {
    const s = state, D = Sim.D;
    const total = Sim.pop(s).living;
    const want = Math.min(48, total);
    // Decide how many of each job to show. Shares follow the square root of
    // each job's headcount, so a huge farming workforce doesn't crowd the
    // forest and quarry off the screen, and any staffed job is always seen.
    const counts = {}, n = {}, w = {};
    let wsum = 0;
    for (const j of Sim.JOBS) {
      n[j] = s.units[j] + (s.ill[j] || 0);
      w[j] = Math.sqrt(n[j]);
      wsum += w[j];
    }
    const MIN = { farmer: 3, woodcutter: 3, miner: 3 };
    let assigned = 0;
    for (const j of Sim.JOBS) {
      counts[j] = wsum > 0 ? Math.round((w[j] / wsum) * want) : 0;
      if (n[j] > 0) counts[j] = Math.max(counts[j], Math.min(n[j], MIN[j] || 1));
      assigned += counts[j];
    }
    // Trim any overshoot from the biggest groups first.
    while (assigned > want) {
      const j = Sim.JOBS.reduce((a, k) => (counts[k] > counts[a] ? k : a), Sim.JOBS[0]);
      counts[j]--; assigned--;
    }
    const have = {};
    for (const p of people) have[p.job] = (have[p.job] || 0) + 1;
    for (const j of Sim.JOBS) {
      let diff = (counts[j] || 0) - (have[j] || 0);
      while (diff > 0) {
        const start = villageSpot();
        people.push({ job: j, x: start.x, y: start.y, tx: start.x, ty: start.y, wait: Math.random() * 3, phase: Math.random() * 6, seed: Math.random(), color: D.jobs[j].color });
        diff--;
      }
      while (diff < 0) {
        const i = people.findIndex(p => p.job === j); if (i < 0) break;
        const q = people[i]; if (q.tree) q.tree.by = null;
        people.splice(i, 1); diff++;
      }
      // Show the sick among them: pale green and slow.
      const mine = people.filter(p => p.job === j), sick = n[j] > 0 ? Math.round(mine.length * (s.ill[j] || 0) / n[j]) : 0;
      mine.forEach((p, i) => { p.sick = i < Math.max(sick, s.ill[j] > 0 && mine.length ? 1 : 0); });
    }
  }
  // ---------- life: people at work, events and celebrations ----------
  // Everything here only reads the game state; it never changes it.
  let lastL = CLASSIC, dayNow = 1;
  const sparks = [];   // small particles: wood chips, forge sparks, water, fireworks
  function spark(x, y, vx, vy, c, life, size, grav) {
    if (sparks.length > 220) return null;
    const p = { x, y, vx, vy, c, life, max: life, size: size || 1, grav: grav === undefined ? 1 : grav };
    sparks.push(p);
    return p;
  }
  function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.vy += 0.5 * p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) sparks.splice(i, 1);
    }
  }
  function drawSparks(u, sky) {
    for (const p of sparks) {
      if (!!p.sky !== !!sky) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.5));
      circle(W * p.x, H * p.y, Math.max(1, u * 0.06 * p.size), p.c);
    }
    ctx.globalAlpha = 1;
  }

  // The forest as data, so woodcutters can fell trees and they grow back.
  let forest = null;
  function makeForest() {
    const tr = seeded(3), ta = seeded(11), out = [];
    for (let row = 0; row < 4; row++) for (let i = 0; i < 7; i++) {
      const x = 0.01 + i * 0.038 + tr() * 0.02 + (row % 2) * 0.015, y = 0.5 + row * 0.075;
      const turn = ta(), leaf = AUTUMN_LEAVES[Math.floor(ta() * AUTUMN_LEAVES.length)];
      out.push({ x, y, sc: 1.2 + tr() * 0.4, row, turn, leaf, st: 'up', k: 1, dir: 1, timer: 0, by: null });
    }
    return out;
  }
  function updateForest(dt) {
    for (const tr of forest) {
      if (tr.st === 'fall') { tr.k += dt / 1.3; if (tr.k >= 1) { tr.st = 'log'; tr.timer = 9; } }
      else if (tr.st === 'log') { tr.timer -= dt; if (tr.timer <= 0) { tr.st = 'stump'; tr.timer = 18; } }
      else if (tr.st === 'stump') { tr.timer -= dt; if (tr.timer <= 0) { tr.st = 'grow'; tr.k = 0.15; } }
      else if (tr.st === 'grow') { tr.k += dt / 30; if (tr.k >= 1) { tr.st = 'up'; tr.k = 1; } }
    }
  }
  function drawForest(L, u) {
    for (const tr of forest) {
      const x = W * tr.x, y = H * tr.y, su = u * tr.sc;
      let shade = tr.row % 2 ? L.tree2 : L.tree1;
      if (L.autumn > 0 && tr.turn < 0.6) shade = mixHex(tr.row % 2 ? LOOKS.autumn.tree2 : LOOKS.autumn.tree1, tr.leaf, L.autumn);
      const bloom = tr.turn < 0.5 ? L.bloom : 0;
      if (tr.st === 'up' || tr.st === 'grow') drawTree(x, y, su * (tr.st === 'grow' ? tr.k : 1), shade, bloom, L.snow);
      else {
        rect(x - su * 0.1, y - su * 0.16, su * 0.2, su * 0.16, '#6a4426');
        ctx.fillStyle = '#c9a070'; ctx.beginPath(); ctx.ellipse(x, y - su * 0.16, su * 0.1, su * 0.04, 0, 0, Math.PI * 2); ctx.fill();
        if (tr.st === 'fall') {
          ctx.save(); ctx.translate(x, y - su * 0.15); ctx.rotate(tr.dir * tr.k * tr.k * Math.PI / 2);
          drawTree(0, su * 0.15, su, shade, bloom, L.snow);
          ctx.restore();
        } else if (tr.st === 'log') {
          const fade = Math.min(1, tr.timer / 3);
          ctx.globalAlpha = fade;
          rect(x + (tr.dir > 0 ? su * 0.1 : -su * 1.5), y - su * 0.18, su * 1.4, su * 0.16, '#6a4426');
          ctx.fillStyle = '#c9a070'; ctx.beginPath(); ctx.ellipse(x + (tr.dir > 0 ? su * 0.1 : -su * 0.1), y - su * 0.1, su * 0.05, su * 0.08, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // Where each kind of worker goes, and what they do there.
  function hasWork(job) {
    const night = dayNow < 0.22;
    if (night && ['farmer', 'woodcutter', 'miner', 'labourer', 'tanner'].includes(job)) return false;
    return job !== 'unemployed';
  }
  function workSpot(p) {
    const P = plan, sp = (P && P.spots) || {}, r = Math.random;
    switch (p.job) {
      case 'farmer': return { x: 0.04 + r() * 0.33, y: 0.85 + r() * 0.12, act: lastL.autumn > 0.5 ? 'reap' : 'hoe', face: r() < 0.5 ? -1 : 1 };
      case 'woodcutter': {
        const free = forest.filter(tr => tr.st === 'up' && !tr.by && tr.row >= 1);
        if (!free.length) return { x: 0.05 + r() * 0.2, y: 0.66 + r() * 0.1, act: 'chop', face: 1 };
        const tr = free[Math.floor(r() * free.length)], side = r() < 0.5 ? -1 : 1;
        tr.by = p; p.tree = tr;
        return { x: tr.x + side * 0.011, y: tr.y + 0.006, act: 'chop', face: -side };
      }
      case 'miner': return { x: 0.8 + r() * 0.15, y: 0.7 + r() * 0.06, act: 'pick', face: r() < 0.6 ? 1 : -1 };
      case 'cleric': return sp.temple ? { x: sp.temple.x + (r() - 0.5) * 0.04, y: sp.temple.y + 0.02 + r() * 0.01, act: 'pray', face: 1 } : null;
      case 'blacksmith': return sp.smithy ? { x: sp.smithy.x + 0.018, y: sp.smithy.y + 0.014, act: 'hammer', face: -1, wait: 8 } : null;
      case 'tanner': return sp.tannery ? { x: sp.tannery.x + 0.02, y: sp.tannery.y + 0.014, act: 'scrape', face: -1, wait: 8 } : null;
      case 'healer': {
        const ill = people.filter(q => q.sick && !q.atWork);
        if (ill.length) { const q = ill[Math.floor(r() * ill.length)]; return { x: q.x + 0.01, y: q.y + 0.002, act: 'tend', face: -1 }; }
        return sp.apothecary ? { x: sp.apothecary.x + 0.018, y: sp.apothecary.y + 0.014, act: 'tend', face: -1 } : null;
      }
      case 'labourer': {
        const s = state;
        if (sp.wonder && s.wonder.stage === 1) { p.carry = true; return { x: sp.wonder.x + (r() - 0.5) * 0.09, y: sp.wonder.y + 0.012, act: 'hammer', face: r() < 0.5 ? -1 : 1 }; }
        return null;
      }
      case 'soldier': return sp.barracks ? { x: sp.barracks.x - 0.03 + r() * 0.04, y: sp.barracks.y + 0.03, act: 'drill', face: -1, wait: 10 } : null;
      case 'cavalry': return sp.stable ? { x: sp.stable.x - 0.04 + r() * 0.05, y: sp.stable.y + 0.03, act: 'ride', face: -1 } : null;
    }
    return null;
  }
  function nextTarget(p) {
    if (p.tree) {
      // A few strokes, then sometimes the tree comes down.
      const down = forest.filter(tr => tr.st !== 'up').length;
      if (p.atWork && p.arrived && down < 5 && Math.random() < 0.45) { p.tree.st = 'fall'; p.tree.k = 0; p.tree.dir = -p.face; }
      p.tree.by = null; p.tree = null;
    }
    p.carry = false;
    if (!p.atWork && hasWork(p.job)) {
      const w = workSpot(p);
      if (w) {
        p.tx = w.x; p.ty = w.y; p.act = w.act; p.wface = w.face || 1; p.atWork = true;
        p.wait = w.wait || 5 + Math.random() * 6;
        return;
      }
    }
    p.atWork = false; p.act = ''; p.carry = false;
    const v = villageSpot();
    p.tx = v.x; p.ty = v.y; p.wait = 2 + Math.random() * 4;
  }
  function updatePeople(dt) {
    const fighters = foes.length > 0;
    for (const p of people) {
      if (fighters && (p.job === 'soldier' || p.job === 'cavalry')) {
        // Go and meet the attackers.
        let best = null, bd = 9;
        for (const f of foes) { const d = Math.abs(f.x - p.x) + Math.abs(f.y - p.y); if (d < bd) { bd = d; best = f; } }
        if (best) { p.mode = 'fight'; p.tx = best.x - 0.014 - (p.seed % 0.01); p.ty = best.y + (p.seed % 0.02) - 0.01; p.wface = 1; }
      } else if (p.mode === 'fight') { p.mode = ''; p.atWork = false; p.wait = 0; }
      if (p.mode === 'bucket' && !fire) { p.mode = ''; p.atWork = false; p.wait = 0; }
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      if (d < 0.004) {
        p.arrived = true;
        if (p.mode === 'fight' || p.mode === 'bucket') continue;
        p.wait -= dt * (p.sick ? 0.5 : 1);
        if (p.wait <= 0) { p.arrived = false; nextTarget(p); }
      } else {
        p.arrived = false;
        const sp = (p.mode === 'fight' || p.mode === 'bucket' ? 0.07 : p.job === 'cavalry' ? 0.05 : 0.035) * (p.sick ? 0.45 : 1) * dt;
        p.x += (dx / d) * Math.min(sp, d); p.y += (dy / d) * Math.min(sp, d);
        p.phase += dt * 9;
        if (Math.abs(dx) > 0.002) p.face = dx > 0 ? 1 : -1;
      }
    }
  }

  // A swing that eases up and snaps down; also tells us when the blow lands.
  function swing(p, rate) {
    const c = (t * rate + p.seed) % 1;
    const hit = p.lastC !== undefined && p.lastC < 0.55 && c >= 0.55;
    p.lastC = c;
    const k = c < 0.55 ? c / 0.55 : 1 - (c - 0.55) / 0.45;
    return { k: k * k * (3 - 2 * k), hit };
  }
  function limb(x0, y0, a, len, f) { return [x0 + Math.cos(a) * len * f, y0 + Math.sin(a) * len]; }
  function line(x0, y0, x1, y1, c, w) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }

  function drawHorse(x, y, u, f, phase, moving) {
    const st = moving ? Math.sin(phase) * u * 0.12 : 0;
    ctx.save(); ctx.translate(x, y); ctx.scale(f, 1);
    rect(-u * 0.5, -u * 0.72, u * 0.95, u * 0.36, '#7a4a2a');
    rect(u * 0.35, -u * 1.0, u * 0.2, u * 0.4, '#7a4a2a');
    rect(u * 0.4, -u * 1.06, u * 0.32, u * 0.18, '#6a3a20');
    rect(-u * 0.62, -u * 0.7, u * 0.14, u * 0.35, '#3a2414');
    for (const [lx, s2] of [[-0.42, 1], [-0.28, -1], [0.22, -1], [0.34, 1]]) rect(u * lx + st * s2 * 0.5, -u * 0.38, u * 0.08, u * 0.38, '#5a3418');
    ctx.restore();
  }

  function drawFigure(p, u) {
    const x = W * p.x, y = H * p.y;
    const working = p.atWork && p.arrived && p.act;
    const fighting = p.mode === 'fight' && p.arrived;
    const f = working || fighting || p.mode === 'bucket' ? p.wface : (p.face || 1);
    const party = celebration && !p.atWork && p.mode !== 'fight' ? Math.abs(Math.sin(t * 7 + p.seed * 20)) * u * 0.18 : 0;
    let by = y - party;
    const lw = Math.max(1, u * 0.09);
    if (p.job === 'cavalry') {
      drawHorse(x, y, u * 1.05, f, p.phase, !p.arrived);
      by = y - u * 0.55;
    }
    const skin = p.sick ? '#b5cc84' : '#f0c8a0';
    const kneel = working && p.act === 'tend';
    // legs
    if (p.job !== 'cavalry') {
      const step = !p.arrived ? Math.sin(p.phase) * u * 0.12 : 0;
      if (kneel) { line(x, by - u * 0.22, x + f * u * 0.15, by, '#2a1a10', lw); by += u * 0.12; }
      else { ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x, by - u * 0.35); ctx.lineTo(x - step, by); ctx.moveTo(x, by - u * 0.35); ctx.lineTo(x + step, by); ctx.stroke(); }
    }
    rect(x - u * 0.13, by - u * 0.75, u * 0.26, u * 0.42, p.color);
    circle(x, by - u * 0.88, u * 0.13, skin);
    if (p.job === 'cleric') rect(x - u * 0.15, by - u * 0.42, u * 0.3, u * 0.1, '#fff3c4');
    if (p.job === 'soldier' || p.job === 'cavalry') { ctx.fillStyle = '#8a9098'; ctx.beginPath(); ctx.arc(x, by - u * 0.9, u * 0.15, Math.PI, 0); ctx.fill(); }
    const sx = x + f * u * 0.06, sy = by - u * 0.66;
    if (p.carry && !p.arrived) { rect(x - u * 0.2, by - u * 1.25, u * 0.4, u * 0.25, '#d8c896'); line(x - u * 0.1, by - u * 1.0, x - u * 0.12, by - u * 0.7, '#2a1a10', lw); return; }
    if (dayNow < 0.3 && p.job === 'soldier' && !fighting) {
      // night watch with a torch
      line(sx, sy, sx + f * u * 0.2, sy - u * 0.35, '#5a3a20', lw);
      const fl = 0.8 + 0.2 * Math.sin(t * 13 + p.seed * 9);
      circle(sx + f * u * 0.22, sy - u * 0.42, u * 0.09 * fl, '#ffb347');
      if (p.seed < 0.5) lights.push({ x: sx + f * u * 0.22, y: sy - u * 0.42, r: u * 1.1, soft: true });
      return;
    }
    if (fighting) {
      const sw = swing(p, 1.6);
      const a = -1.6 + sw.k * 2.0;
      const [hx, hy] = limb(sx, sy, a, u * 0.36, f);
      line(sx, sy, hx, hy, '#2a1a10', lw);
      const [tx2, ty2] = limb(hx, hy, a - 0.3, u * 0.5, f);
      line(hx, hy, tx2, ty2, p.job === 'cavalry' ? '#c9ced6' : '#dfe4ea', Math.max(1, u * 0.07));
      if (sw.hit && Math.random() < 0.7) for (let i = 0; i < 4; i++) spark(tx2 / W, ty2 / H, (Math.random() - 0.5) * 0.06, -Math.random() * 0.05, '#fff6c0', 0.3, 0.8, 0.5);
      return;
    }
    if (p.mode === 'bucket' && p.arrived) {
      const sw = swing(p, 0.9);
      const a = -0.2 - sw.k * 1.2;
      const [hx, hy] = limb(sx, sy, a, u * 0.38, f);
      line(sx, sy, hx, hy, '#2a1a10', lw);
      rect(hx - u * 0.1, hy - u * 0.05, u * 0.2, u * 0.18, '#7a5a36');
      if (sw.hit && fire) for (let i = 0; i < 6; i++) spark(hx / W, hy / H, f * (0.04 + Math.random() * 0.05), -0.08 - Math.random() * 0.05, '#8fc6ee', 0.8, 0.9, 1.2);
      return;
    }
    if (!working) {
      line(sx, sy, sx + f * u * 0.05, sy + u * 0.3, '#2a1a10', lw);
      return;
    }
    const tool = '#6a4426', metal = '#b8c0c8';
    switch (p.act) {
      case 'hoe': case 'reap': {
        const sw = swing(p, p.act === 'reap' ? 0.9 : 0.6);
        const a = p.act === 'reap' ? 0.1 + sw.k * 1.0 : -0.9 + sw.k * 1.9;
        const [hx, hy] = limb(sx, sy, a, u * 0.34, f);
        line(sx, sy, hx, hy, '#2a1a10', lw);
        if (p.act === 'hoe') {
          const [ex, ey] = limb(hx, hy, a + 0.5, u * 0.38, f);
          line(hx, hy, ex, ey, tool, lw);
          line(ex, ey, ex + f * u * 0.02, ey + u * 0.12, metal, lw * 1.3);
          if (sw.hit) for (let i = 0; i < 3; i++) spark(ex / W, (ey + u * 0.12) / H, (Math.random() - 0.5) * 0.03, -0.03, lastL.soil || '#8a6a3a', 0.5, 1);
        } else {
          ctx.strokeStyle = metal; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(hx + f * u * 0.12, hy, u * 0.14, f > 0 ? -1.4 : 1.7, f > 0 ? 1.0 : 4.5); ctx.stroke();
          if (sw.hit) spark(hx / W, hy / H, f * 0.02, -0.03, lastL.stalkA || '#e8c45a', 0.6, 1);
        }
        break;
      }
      case 'chop': case 'pick': {
        const sw = swing(p, p.act === 'chop' ? 0.75 : 0.65);
        const a = -2.0 + sw.k * 2.3;
        const [hx, hy] = limb(sx, sy, a, u * 0.34, f);
        line(sx, sy, hx, hy, '#2a1a10', lw);
        const [ex, ey] = limb(hx, hy, a, u * 0.42, f);
        line(hx, hy, ex, ey, tool, lw);
        if (p.act === 'chop') rect(ex - u * 0.08, ey - u * 0.08, u * 0.16, u * 0.16, metal);
        else { const [px1, py1] = limb(ex, ey, a + 1.4, u * 0.18, f); const [px2, py2] = limb(ex, ey, a - 1.4, u * 0.18, f); line(px1, py1, px2, py2, metal, lw); }
        if (sw.hit) {
          const c = p.act === 'chop' ? '#d9a46a' : '#c8d0d8';
          for (let i = 0; i < 4; i++) spark(ex / W, ey / H, f * (0.01 + Math.random() * 0.03), -0.04 - Math.random() * 0.03, c, 0.6, 1);
        }
        break;
      }
      case 'hammer': {
        if (p.job === 'blacksmith') { rect(x + f * u * 0.25 - u * 0.15, by - u * 0.42, u * 0.3, u * 0.12, '#3a3a40'); rect(x + f * u * 0.25 - u * 0.06, by - u * 0.3, u * 0.12, u * 0.3, '#3a3a40'); }
        const sw = swing(p, 1.1);
        const a = -1.5 + sw.k * 1.9;
        const [hx, hy] = limb(sx, sy, a, u * 0.32, f);
        line(sx, sy, hx, hy, '#2a1a10', lw);
        const [ex, ey] = limb(hx, hy, a, u * 0.2, f);
        line(hx, hy, ex, ey, tool, lw);
        rect(ex - u * 0.07, ey - u * 0.05, u * 0.14, u * 0.1, '#5a5a62');
        if (sw.hit) {
          const c = p.job === 'blacksmith' ? '#ffb347' : '#d8c896';
          for (let i = 0; i < (p.job === 'blacksmith' ? 6 : 3); i++) spark(ex / W, ey / H, (Math.random() - 0.5) * 0.08, -0.03 - Math.random() * 0.05, c, 0.45, 0.8);
        }
        break;
      }
      case 'scrape': {
        rect(x + f * u * 0.35 - u * 0.2, by - u * 0.95, u * 0.04, u * 0.95, tool);
        rect(x + f * u * 0.35 + u * 0.16, by - u * 0.95, u * 0.04, u * 0.95, tool);
        rect(x + f * u * 0.35 - u * 0.17, by - u * 0.85, u * 0.34, u * 0.5, '#c98d58');
        const k = Math.sin(t * 3 + p.seed * 10);
        const [hx, hy] = [sx + f * u * 0.28, sy + u * 0.05 + k * u * 0.12];
        line(sx, sy, hx, hy, '#2a1a10', lw);
        break;
      }
      case 'pray': {
        const lift = Math.sin(t * 1.5 + p.seed * 5) * u * 0.05;
        line(sx - u * 0.06, sy, sx - u * 0.2, sy - u * 0.38 + lift, '#2a1a10', lw);
        line(sx + u * 0.06, sy, sx + u * 0.2, sy - u * 0.38 + lift, '#2a1a10', lw);
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 2 + p.seed * 7);
        ctx.strokeStyle = '#ffe38a'; ctx.lineWidth = Math.max(1, u * 0.05);
        ctx.beginPath(); ctx.ellipse(x, by - u * 1.12, u * 0.16, u * 0.05, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'tend': {
        const k = Math.sin(t * 2 + p.seed * 10);
        line(sx, sy, sx + f * u * 0.3, sy + u * 0.15 + k * u * 0.05, '#2a1a10', lw);
        if (Math.random() < 0.02) spark((sx + f * u * 0.3) / W, sy / H, 0, -0.03, '#7fd17a', 0.9, 0.9, 0);
        break;
      }
      case 'drill': {
        // All soldiers lift their spears in time.
        const k = Math.max(0, Math.sin(t * 2.2)) * u * 0.25;
        line(sx, sy, sx + f * u * 0.16, sy + u * 0.05 - k, '#2a1a10', lw);
        line(sx + f * u * 0.16, by - u * 0.1 - k, sx + f * u * 0.16, by - u * 1.55 - k, tool, lw);
        poly([sx + f * u * 0.1, by - u * 1.55 - k, sx + f * u * 0.16, by - u * 1.75 - k, sx + f * u * 0.22, by - u * 1.55 - k], metal);
        break;
      }
      default:
        line(sx, sy, sx + f * u * 0.25, sy - u * 0.05, '#2a1a10', lw);
    }
  }

  // Attackers: they stop at the gate if there are defenders, otherwise march in.
  function syncFoes() {
    const s = state;
    const want = [];
    for (const k of Sim.ENEMIES) for (let i = 0; i < Math.min(12, Math.ceil(Math.log2(s.enemies[k] + 1) * 2)); i++) want.push(k);
    while (foes.length > want.length) foes.pop();
    for (let i = 0; i < want.length; i++) {
      if (!foes[i] || foes[i].kind !== want[i]) foes[i] = { kind: want[i], x: 1.02 + Math.random() * 0.08, y: 0.78 + Math.random() * 0.12, phase: Math.random() * 6, seed: Math.random() };
    }
  }
  function updateFoes(dt) {
    const defended = people.some(p => p.job === 'soldier' || p.job === 'cavalry');
    for (const f of foes) {
      const target = (defended ? 0.8 : 0.62) + Math.sin(f.seed * 40) * 0.02;
      f.moving = f.x > target;
      if (f.moving) { f.x -= 0.05 * dt; f.phase += dt * 10; }
    }
  }
  function drawFoe(f, u) {
    const x = W * f.x, y = H * f.y;
    if (f.kind === 'wolf') {
      const lunge = f.moving ? 0 : Math.max(0, Math.sin(t * 5 + f.seed * 20)) * u * 0.15;
      drawWolf(x - lunge, y, u, f.phase, -1);
      return;
    }
    drawPerson(x, y, u, f.kind === 'barbarian' ? '#7a1010' : '#3a3a3a', f.phase, true);
    if (f.kind === 'bandit') rect(x - u * 0.15, y - u * 0.93, u * 0.3, u * 0.08, '#1a1a1a');
    const sw = f.moving ? { k: 0.3 } : swing(f, 1.3);
    const a = -1.7 + sw.k * 2.0, sx = x - u * 0.06, sy = y - u * 0.66;
    const [hx, hy] = limb(sx, sy, a, u * 0.34, -1);
    line(sx, sy, hx, hy, '#2a0a0a', Math.max(1, u * 0.09));
    const [ex, ey] = limb(hx, hy, a, u * 0.45, -1);
    line(hx, hy, ex, ey, '#6a4426', Math.max(1, u * 0.08));
    if (f.kind === 'barbarian') rect(ex - u * 0.1, ey - u * 0.1, u * 0.2, u * 0.2, '#9aa2aa');
  }

  // A fire among the houses (the "fire" event), or set by barbarians.
  let fire = null;
  function startFire(src) {
    const homes = (plan ? plan.items : []).filter(b => CHIMNEYS[b.sprite] && b.sprite !== 'campfire');
    if (!homes.length) return;
    const h = homes.sort((a, b) => Math.abs(a.x - PLAZA.x) - Math.abs(b.x - PLAZA.x))[Math.min(homes.length - 1, 1 + Math.floor(Math.random() * 4))];
    fire = { item: h, k: 0, out: false, src };
    // The nearest villagers form a bucket line.
    const helpers = people.filter(p => !['soldier', 'cavalry'].includes(p.job))
      .sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y)).slice(0, 6);
    helpers.forEach((p, i) => {
      if (p.tree) { p.tree.by = null; p.tree = null; }
      const side = i % 2 ? 1 : -1;
      p.mode = 'bucket'; p.atWork = false; p.carry = false;
      p.tx = h.x + side * (0.03 + Math.floor(i / 2) * 0.014); p.ty = Math.min(0.99, h.y + 0.02 + (i % 3) * 0.008); p.wface = -side;
    });
  }
  function updateFire(dt) {
    if (!fire) return;
    if (fire.out) { fire.k -= dt / 6; if (fire.k <= 0) fire = null; return; }
    fire.k = Math.min(1, fire.k + dt / 2);
  }
  function drawFire(u) {
    if (!fire) return;
    const it = fire.item, bu = u * it.s, x = W * it.x, y = H * it.y;
    const top = { cottage: 1.4, house: 1.9, townhouse: 2.8, smithy: 1.3 }[it.sprite] || 1.5;
    const k = Math.max(0, fire.k);
    if (Math.random() < 0.5 * k + 0.2) smoke.push({ x: x + (Math.random() - 0.5) * bu, y: y - top * bu, life: 3, dark: true });
    for (let i = 0; i < 5; i++) {
      const fx = x + (i - 2) * bu * 0.3, fl = (0.6 + 0.4 * Math.sin(t * 11 + i * 2.1)) * k;
      poly([fx - bu * 0.18, y - top * bu * 0.75, fx, y - top * bu * 0.75 - bu * 0.9 * fl, fx + bu * 0.18, y - top * bu * 0.75], i % 2 ? '#ff8a3d' : '#ffb347');
      poly([fx - bu * 0.08, y - top * bu * 0.75, fx, y - top * bu * 0.75 - bu * 0.5 * fl, fx + bu * 0.08, y - top * bu * 0.75], '#ffe08a');
    }
    lights.push({ x, y: y - top * bu, r: bu * 3 * k, gold: true });
  }

  // The merchant's wagon rolls in while a trader is in town.
  let wagon = null;
  function updateWagon(dt) {
    const here = state.trader.timer > 0;
    if (here && !wagon) wagon = { x: -0.06, dir: 1 };
    if (!wagon) return;
    if (!here) wagon.dir = -1;
    const stop = 0.262;
    if (wagon.dir > 0 && wagon.x < stop) wagon.x = Math.min(stop, wagon.x + 0.06 * dt);
    if (wagon.dir < 0) { wagon.x -= 0.07 * dt; if (wagon.x < -0.1) wagon = null; }
  }
  function drawWagon(u) {
    const w = wagon, x = W * w.x, y = H * (ROAD_Y + 0.016), f = w.dir;
    const moving = !(w.dir > 0 && w.x >= 0.261);
    const wob = moving ? Math.sin(t * 10) * u * 0.04 : 0;
    ctx.save(); ctx.translate(x, y); ctx.scale(f, 1);
    // horse
    rect(u * 0.95, -u * 0.95, u * 0.85, u * 0.36, '#e6dccb');
    rect(u * 1.7, -u * 1.25, u * 0.24, u * 0.45, '#e6dccb');
    rect(u * 1.78, -u * 1.3, u * 0.3, u * 0.2, '#d8ccb6');
    rect(u * 1.0, -u * 0.6, u * 0.09, u * 0.6 + wob, '#b8ab94'); rect(u * 1.65, -u * 0.6, u * 0.09, u * 0.6 - wob, '#b8ab94');
    // wagon and canvas cover
    rect(-u * 1.1, -u * 0.85, u * 2.0, u * 0.5, '#7a4f2a');
    ctx.fillStyle = '#f1e8d6'; ctx.beginPath(); ctx.moveTo(-u * 1.05, -u * 0.85); ctx.quadraticCurveTo(-u * 0.1, -u * 2.2, u * 0.85, -u * 0.85); ctx.fill();
    for (let i = 0; i < 3; i++) rect(-u * 0.75 + i * u * 0.55, -u * 1.55 + Math.abs(i - 1) * u * 0.25, u * 0.12, u * (0.7 - Math.abs(i - 1) * 0.25), '#c0392b');
    rect(u * 0.85, -u * 0.6, u * 0.2, u * 0.05, '#3a2a1a');
    for (const wx of [-0.75, 0.55]) { circle(u * wx, -u * 0.28, u * 0.28, '#4a3020'); circle(u * wx, -u * 0.28, u * 0.1, '#8a6a4a'); }
    ctx.restore();
    if (!moving) {
      // goods set out, and the merchant calling to passers-by
      rect(x + f * u * 1.2, y - u * 0.3, u * 0.35, u * 0.3, '#9b6a3c');
      rect(x + f * u * 1.65, y - u * 0.25, u * 0.3, u * 0.25, '#b08a5a');
      circle(x + f * u * 1.37, y - u * 0.38, u * 0.1, '#e8c45a');
      const mx = x - f * u * 1.4, bob = Math.abs(Math.sin(t * 3)) * u * 0.05;
      drawPerson(mx, y, u * 1.1, '#8e44ad', 0, false);
      rect(mx - u * 0.22, y - u * 1.15 - bob, u * 0.44, u * 0.1, '#5b2c6f');
      rect(mx - u * 0.12, y - u * 1.32 - bob, u * 0.24, u * 0.2, '#5b2c6f');
    }
  }

  // Travellers waiting at the west gate during the refugee and scholar events.
  const visitors = [];
  function syncVisitors() {
    const ev = state.evt && state.evt.pending;
    const kind = ev && (ev.id === 'refugees' || ev.id === 'scholar') ? ev.id : '';
    const waiting = visitors.filter(v => !v.leaving);
    if (kind && !waiting.length) {
      const n = kind === 'refugees' ? 5 : 1;
      for (let i = 0; i < n; i++) visitors.push({ kind, x: -0.03 - i * 0.02, y: ROAD_Y + 0.005 + (i % 2) * 0.012, tx: 0.24 - i * 0.022, phase: Math.random() * 6, seed: Math.random(), pop: Sim.pop(state).living });
    }
    if (!kind && waiting.length) {
      // Taken in if the town grew since they arrived; otherwise they move on.
      const grew = Sim.pop(state).living > waiting[0].pop || waiting[0].kind === 'scholar';
      waiting.forEach((v, i) => { v.leaving = true; v.tx = grew ? PLAZA.x - 0.02 + i * 0.01 : -0.1; });
    }
  }
  function updateVisitors(dt) {
    for (let i = visitors.length - 1; i >= 0; i--) {
      const v = visitors[i], d = v.tx - v.x;
      if (Math.abs(d) > 0.003) { v.x += Math.sign(d) * Math.min(Math.abs(d), 0.03 * dt); v.phase += dt * 8; v.face = Math.sign(d); }
      else if (v.leaving) visitors.splice(i, 1);
    }
  }
  function drawVisitor(v, u) {
    const x = W * v.x, y = H * v.y;
    drawPerson(x, y, u * (v.kind === 'refugees' && v.seed < 0.3 ? 0.8 : 1.05), v.kind === 'scholar' ? '#4b3b8f' : '#8a7a62', v.phase, false);
    if (v.kind === 'refugees') rect(x - (v.face || 1) * u * 0.32, y - u * 0.8, u * 0.24, u * 0.3, '#a08060');
    else { rect(x + u * 0.1, y - u * 0.62, u * 0.22, u * 0.16, '#c0392b'); rect(x - u * 0.16, y - u * 1.08, u * 0.32, u * 0.08, '#2c2357'); }
  }

  // Celebrations: wonders, raids won, festivals and new ages.
  let celebration = null;
  function celebrate(kind, secs) { celebration = { kind, t: secs || 25 }; }
  function updateCelebration(dt) {
    if (!celebration) return;
    celebration.t -= dt;
    if (celebration.t <= 0) { celebration = null; return; }
    if (Math.random() < dt * 2.2) {
      const x = 0.36 + Math.random() * 0.36, y = 0.12 + Math.random() * 0.25;
      const cols = ['#ffd54a', '#ff6b6b', '#7fd1ff', '#9dff8a', '#ff9af0', '#ffffff'];
      const c = cols[Math.floor(Math.random() * cols.length)], c2 = cols[Math.floor(Math.random() * cols.length)];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2, sp = 0.05 + Math.random() * 0.04;
        const fw = spark(x, y, Math.cos(a) * sp * 0.55, Math.sin(a) * sp, i % 3 ? c : c2, 1.3 + Math.random() * 0.5, 1.4, 0.12);
        if (fw) fw.sky = true;
      }
    }
  }
  function drawBunting(u) {
    if (!celebration) return;
    const cols = ['#c0392b', '#f2c94c', '#2f6fa3', '#27ae60', '#ffffff'];
    for (const [x0, x1, y0, sag] of [[0.44, 0.64, 0.74, 0.03], [0.36, 0.5, 0.76, 0.02], [0.58, 0.72, 0.76, 0.02]]) {
      ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) { const k = i / 20, x = W * (x0 + (x1 - x0) * k), y = H * (y0 + Math.sin(k * Math.PI) * sag); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      for (let i = 1; i < 20; i++) {
        const k = i / 20, x = W * (x0 + (x1 - x0) * k), y = H * (y0 + Math.sin(k * Math.PI) * sag), wv = Math.sin(t * 4 + i) * u * 0.04;
        poly([x - u * 0.12, y, x + wv, y + u * 0.3, x + u * 0.12, y], cols[i % cols.length]);
      }
    }
  }

  // Small animals: the town's cats and birds overhead.
  const critters = [];
  function syncCritters() {
    const cats = Math.min(3, state.cats || 0);
    const have = critters.filter(c => c.kind === 'cat');
    while (have.length < cats) { const v = villageSpot(); const c = { kind: 'cat', x: v.x, y: v.y, tx: v.x, ty: v.y, wait: Math.random() * 4, color: ['#e0975a', '#5a5a62', '#f1e8d6'][have.length % 3] }; critters.push(c); have.push(c); }
    while (have.length > cats) critters.splice(critters.indexOf(have.pop()), 1);
  }
  let birds = null;
  function updateCritters(dt) {
    for (const c of critters) {
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      if (d < 0.003) { c.wait -= dt; if (c.wait <= 0) { const v = villageSpot(); c.tx = v.x; c.ty = v.y; c.wait = 3 + Math.random() * 8; } }
      else { const sp = 0.04 * dt; c.x += dx / d * Math.min(sp, d); c.y += dy / d * Math.min(sp, d); c.face = Math.sign(dx) || 1; }
    }
    if (!birds && dayNow > 0.45 && lastL.snow < 0.5 && Math.random() < dt / 25) birds = { x: -0.05, y: 0.1 + Math.random() * 0.15, n: 3 + Math.floor(Math.random() * 4) };
    if (birds) { birds.x += 0.04 * dt; if (birds.x > 1.1) birds = null; }
  }
  function drawCat(c, u) {
    const x = W * c.x, y = H * c.y, f = c.face || 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(f, 1);
    rect(-u * 0.22, -u * 0.22, u * 0.36, u * 0.14, c.color);
    rect(u * 0.1, -u * 0.32, u * 0.14, u * 0.14, c.color);
    poly([u * 0.1, -u * 0.32, u * 0.13, -u * 0.4, u * 0.16, -u * 0.32], c.color);
    poly([u * 0.18, -u * 0.32, u * 0.21, -u * 0.4, u * 0.24, -u * 0.32], c.color);
    ctx.strokeStyle = c.color; ctx.lineWidth = Math.max(1, u * 0.05);
    ctx.beginPath(); ctx.moveTo(-u * 0.22, -u * 0.2); ctx.quadraticCurveTo(-u * 0.38, -u * 0.3, -u * 0.32, -u * 0.45); ctx.stroke();
    rect(-u * 0.18, -u * 0.08, u * 0.05, u * 0.08, c.color); rect(u * 0.06, -u * 0.08, u * 0.05, u * 0.08, c.color);
    ctx.restore();
  }
  function drawBirds(u) {
    if (!birds) return;
    ctx.strokeStyle = 'rgba(40,40,50,.7)'; ctx.lineWidth = Math.max(1, u * 0.05);
    for (let i = 0; i < birds.n; i++) {
      const x = W * (birds.x - i * 0.018), y = H * (birds.y + Math.abs(i - birds.n / 2) * 0.012), fl = Math.sin(t * 8 + i) * u * 0.1;
      ctx.beginPath(); ctx.moveTo(x - u * 0.2, y - fl); ctx.lineTo(x, y); ctx.lineTo(x + u * 0.2, y - fl); ctx.stroke();
    }
  }

  // Watch the game's own events to start scenes.
  let lastPending = '', lastMorale = 1;
  function watchState() {
    const s = state, ev = s.evt && s.evt.pending, id = ev ? ev.id : '';
    if (id === 'fire' && !fire) startFire('event');
    if (lastPending === 'fire' && id !== 'fire' && fire && fire.src === 'event') fire.out = true;
    if (lastPending === 'festival' && id !== 'festival' && s.morale > lastMorale + 0.03) celebrate('festival', 30);
    if (s.enemies.barbarian > 0 && !fire) startFire('raid');
    if (fire && fire.src === 'raid' && !s.enemies.barbarian) fire.out = true;
    lastPending = id; lastMorale = s.morale;
    syncVisitors();
    syncCritters();
  }
  function onSimEvent(type, d) {
    if (type === 'wonderDone') celebrate('wonder', 40);
    else if (type === 'raidWon') celebrate('raid', 20);
    else if (type === 'log' && d && /new age dawns/i.test(d.text || '')) celebrate('age', 40);
  }

  // ---------- streets, walls, carts and lights ----------
  const CHIMNEYS = { cottage: [0.44, -1.5], house: [0.56, -2.05], townhouse: [0.51, -3.2], smithy: [0.54, -1.65], campfire: [0, -0.9] };
  const GLOWS = { cottage: 0.6, house: 0.9, townhouse: 1.4, manor: 1.3, hut: 0.4, smithy: 0.3, greatTemple: 1.2, temple: 1.0 };
  const lights = []; // lamp glows collected while drawing, lit up at night
  function fountainJets(x, y, u, size) {
    ctx.strokeStyle = 'rgba(190,225,250,.85)'; ctx.lineWidth = Math.max(1, u * 0.06);
    for (let i = 0; i < 4; i++) {
      const dir = i < 2 ? -1 : 1, spread = (i % 2 ? 0.55 : 0.85) * size;
      const bob = 1 + 0.08 * Math.sin(t * 6 + i);
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + dir * u * spread * 0.4, y - u * size * bob, x + dir * u * spread * 1.1, y + u * size * 0.95);
      ctx.stroke();
    }
    circle(x, y - u * 0.05, u * 0.07, 'rgba(220,240,255,.9)');
  }

  // Road colours by stage, faded toward snow in winter.
  function roadColors(stage, L) {
    const base = stage >= 4 ? ['#cdc5b4', '#a99f8d'] : stage >= 3 ? ['#bfae8e', '#9a8a6c'] : ['#b49a6c', '#9a8058'];
    const k = Math.min(0.7, (L.snow || 0) * 0.7);
    return base.map(c => mixHex(c, '#eef2f6', k));
  }
  function band(x0, y0, x1, y1, w, c) {
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineCap = 'butt';
  }
  function drawStreets(P, u, L) {
    const st = P.stage;
    if (st === 0) {
      // trodden ground round the fire
      ctx.fillStyle = mixHex('#a08a5a', '#eef2f6', Math.min(0.7, (L.snow || 0) * 0.7));
      ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.ellipse(W * PLAZA.x, H * (PLAZA.y + 0.005), W * 0.06, H * 0.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      return;
    }
    const [fill, edge] = roadColors(st, L);
    const ry = H * ROAD_Y, mw = H * (st >= 3 ? 0.034 : st === 2 ? 0.028 : 0.02);
    const x0 = st === 1 ? W * 0.31 : 0, x1 = st === 1 ? W * 0.72 : st >= 3 ? W * 1.01 : W * 0.79;
    const lanes = [[x0, ry, x1, ry, mw]];
    if (st >= 2) lanes.push([W * PLAZA.x, ry, W * PLAZA.x, H * 0.655, H * 0.026]);
    if (st >= 3) {
      lanes.push([W * PLAZA.x, ry, W * PLAZA.x, H * 1.02, H * 0.03]);
      lanes.push([W * 0.335, H * 0.682, W * 0.745, H * 0.682, H * 0.022]);
    }
    if (st >= 2) ctx.globalAlpha = 1; else ctx.globalAlpha = 0.75;
    for (const l of lanes) band(l[0], l[1], l[2], l[3], l[4] + Math.max(2, u * 0.12), edge);
    for (const l of lanes) band(l[0], l[1], l[2], l[3], l[4], fill);
    ctx.globalAlpha = 1;
    // the square
    const px = W * PLAZA.x, py = H * PLAZA.y, rx = W * PLAZA.rx * (st >= 3 ? 1 : 0.75), ryy = H * PLAZA.ry * (st >= 3 ? 1 : 0.75);
    ctx.fillStyle = edge; ctx.beginPath(); ctx.ellipse(px, py, rx + u * 0.12, ryy + u * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(px, py, rx, ryy, 0, 0, Math.PI * 2); ctx.fill();
    if (st >= 3) {
      // cobbles / paving pattern
      ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(px, py, rx * i / 4, ryy * i / 4, 0, 0, Math.PI * 2); ctx.stroke(); }
      for (let x = (x0 % (u * 0.6)); x < x1; x += u * 0.6) { ctx.beginPath(); ctx.moveTo(x, ry - mw / 2 + 2); ctx.lineTo(x - u * 0.15, ry + mw / 2 - 2); ctx.stroke(); }
    }
    if (st >= 4) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, u * 0.05);
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x0, ry + s * mw / 2); ctx.lineTo(x1, ry + s * mw / 2); ctx.stroke(); }
      ctx.fillStyle = 'rgba(201,167,74,.35)';
      ctx.beginPath(); ctx.ellipse(px, py, rx * 0.5, ryy * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // The town wall along the back and down both sides, behind the houses.
  const WALL_PATH = [[0.312, ROAD_Y - 0.02], [0.326, 0.6], [0.754, 0.6], [0.768, ROAD_Y - 0.02]];
  function drawWall(P, u, L) {
    const stone = P.wall === 2, h = u * (stone ? 1.35 : 0.85);
    const pts = WALL_PATH.map(([x, y]) => [W * x, H * y]);
    if (stone) {
      ctx.fillStyle = '#9ea3a8';
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      for (const p of pts.slice().reverse()) ctx.lineTo(p[0], p[1] - h);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pts[1][0], pts[1][1] - h * 0.5); ctx.lineTo(pts[2][0], pts[2][1] - h * 0.5); ctx.stroke();
      // merlons along the top
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay), n = Math.floor(len / (u * 0.55));
        for (let j = 0; j < n; j += 1) {
          const f = j / n, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
          if (j % 2 === 0) rect(x - u * 0.13, y - h - u * 0.25, u * 0.26, u * 0.26, '#9ea3a8');
        }
      }
      if ((L.snow || 0) > 0.02) {
        ctx.globalAlpha = Math.min(1, L.snow); ctx.strokeStyle = '#f4f8fc'; ctx.lineWidth = Math.max(2, u * 0.12);
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1] - h); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1] - h); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // towers at the back corners (and two more in the city)
      const towers = [[0.326, 0.6], [0.754, 0.6]];
      if (P.stage >= 4 && P.k > 0.55) towers.push([0.44, 0.6], [0.64, 0.6]);
      for (const [tx, ty] of towers) {
        const x = W * tx, y = H * ty + u * 0.1, w = u * 0.6, th = h + u * 1.0;
        rect(x - w, y - th, w * 2, th, '#a8adb2');
        rect(x + w - u * 0.18, y - th, u * 0.18, th, 'rgba(0,0,0,.12)');
        for (let i = 0; i < 3; i++) rect(x - w + i * w * 0.75, y - th - u * 0.24, w * 0.45, u * 0.24, '#a8adb2');
        rect(x - u * 0.08, y - th + u * 0.35, u * 0.16, u * 0.3, '#2a2a2a');
        if (P.stage >= 4) {
          poly([x - w - u * 0.08, y - th, x, y - th - u * 1.05, x + w + u * 0.08, y - th], '#41608f');
          if ((L.snow || 0) > 0.02) { ctx.globalAlpha = Math.min(1, L.snow); poly([x - w * 0.5, y - th - u * 0.5, x, y - th - u * 1.05, x + w * 0.5, y - th - u * 0.5], '#f4f8fc'); ctx.globalAlpha = 1; }
        }
      }
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay), n = Math.floor(len / (u * 0.24));
        for (let j = 0; j <= n; j++) {
          const f = j / n, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, sh = h * (0.9 + ((j * 7) % 3) * 0.06);
          rect(x - u * 0.1, y - sh, u * 0.2, sh, j % 2 ? '#8a5a30' : '#7a4f2a');
          poly([x - u * 0.1, y - sh, x, y - sh - u * 0.18, x + u * 0.1, y - sh], j % 2 ? '#8a5a30' : '#7a4f2a');
        }
      }
    }
  }

  // Carts that trundle along the main street (town and city).
  const carts = [{ x: 0.36, dir: 1, sp: 0.018, c: '#9b6a3c' }, { x: 0.7, dir: -1, sp: 0.014, c: '#7a5a3a' }];
  function updateCarts(dt) {
    for (const c of carts) {
      c.x += c.dir * c.sp * dt;
      if (c.x > 0.75) c.dir = -1;
      if (c.x < 0.29) c.dir = 1;
    }
  }
  function drawCart(c, u) {
    const x = W * c.x, y = H * (ROAD_Y + (c.dir > 0 ? 0.008 : -0.004));
    ctx.save(); ctx.translate(x, y); ctx.scale(c.dir, 1);
    const wob = Math.sin(t * 10 + c.x * 50) * u * 0.04;
    // horse
    rect(u * 0.55, -u * 0.85, u * 0.75, u * 0.32, '#7a4a2a');
    rect(u * 1.2, -u * 1.1, u * 0.22, u * 0.42, '#7a4a2a');
    rect(u * 1.28, -u * 1.15, u * 0.28, u * 0.18, '#6a3a20');
    rect(u * 0.6, -u * 0.53, u * 0.08, u * 0.53 + wob, '#5a3a20');
    rect(u * 1.15, -u * 0.53, u * 0.08, u * 0.53 - wob, '#5a3a20');
    // cart
    rect(-u * 0.75, -u * 0.8, u * 1.25, u * 0.45, c.c);
    rect(-u * 0.75, -u * 0.95, u * 1.25, u * 0.15, '#e8c45a');
    rect(0.4 * u, -u * 0.6, u * 0.3, u * 0.05, '#5a3a20');
    circle(-u * 0.15, -u * 0.25, u * 0.25, '#4a3020');
    circle(-u * 0.15, -u * 0.25, u * 0.1, '#8a6a4a');
    ctx.restore();
  }

  // Lamp and wonder glow after the night tint.
  function drawLights(day) {
    const night = Math.max(0, Math.min(1, (0.45 - day) / 0.3));
    if (night <= 0) { lights.length = 0; return; }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, l.gold ? `rgba(255,214,90,${0.45 * night})` : `rgba(255,200,110,${(l.soft ? 0.22 : 0.5) * night})`);
      g.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = g; ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    ctx.restore();
    lights.length = 0;
  }

  // ---------- main draw ----------
  function skyColors(grey) {
    const day = (Math.sin(t / 240 * Math.PI * 2) + 1) / 2; // 4 minute day
    const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
    const rgb = (c, g) => `rgb(${mix(c, [150, 156, 166], g).map(Math.round).join(',')})`;
    return {
      day,
      top: rgb(mix([24, 30, 64], [96, 160, 220], day), (grey || 0) * day),
      bottom: rgb(mix([70, 60, 90], [200, 220, 235], day), (grey || 0) * day),
    };
  }

  function draw(L) {
    if (!W || !H) return;
    const s = state;
    const u = Math.max(8, Math.min(W / 48, H / 22));
    const sky = skyColors(L.sky);
    dayNow = sky.day; lastL = L;
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    g.addColorStop(0, sky.top); g.addColorStop(1, sky.bottom);
    rect(0, 0, W, H, g);

    // sun / moon
    const ang = t / 240 * Math.PI * 2;
    const sx = W * (0.5 + 0.42 * Math.cos(ang - Math.PI / 2 + Math.PI)), sy = H * (0.42 - 0.32 * Math.sin(ang));
    if (sky.day > 0.35) circle(W * 0.18 + (1 - sky.day) * W * 0.5, H * 0.12 + (1 - sky.day) * H * 0.2, u * 1.2, '#fff3b0');
    else circle(W * 0.8, H * 0.12, u * 0.9, '#e8e8f0');
    void sx; void sy;

    // far mountains
    const ridge = [0, 0.45, 0.12, 0.28, 0.25, 0.4, 0.4, 0.24, 0.55, 0.42, 0.7, 0.26, 0.85, 0.36, 1, 0.22];
    poly([0, H * 0.45, W * 0.12, H * 0.28, W * 0.25, H * 0.4, W * 0.4, H * 0.24, W * 0.55, H * 0.42, W * 0.7, H * 0.26, W * 0.85, H * 0.36, W, H * 0.22, W, H * 0.5, 0, H * 0.5], '#6a7a8e');
    if (L.snow > 0.02) { // snow caps on the peaks
      ctx.globalAlpha = Math.min(1, L.snow);
      for (const i of [2, 6, 10]) {
        const px = ridge[i], py = ridge[i + 1], f = 0.35;
        const lx = px + (ridge[i - 2] - px) * f, ly = py + (ridge[i - 1] - py) * f;
        const rx = px + (ridge[i + 2] - px) * f, ry = py + (ridge[i + 3] - py) * f;
        poly([W * px, H * py, W * rx, H * ry, W * (px + rx) / 2, H * (py + ry) / 2 + H * 0.01, W * px, H * (py + Math.min(ly, ry)) / 2 + H * 0.02, W * (px + lx) / 2, H * (py + ly) / 2 + H * 0.012, W * lx, H * ly], '#f4f8fc');
      }
      ctx.globalAlpha = 1;
    }
    // hills
    ctx.fillStyle = L.hills;
    ctx.beginPath(); ctx.moveTo(0, H * 0.5);
    for (let i = 0; i <= 20; i++) ctx.lineTo(W * i / 20, H * (0.46 + 0.03 * Math.sin(i * 1.3)));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    // meadow
    const mg = ctx.createLinearGradient(0, H * 0.5, 0, H);
    mg.addColorStop(0, L.mTop); mg.addColorStop(1, L.mBot);
    rect(0, H * 0.52, W, H * 0.48, mg);

    // quarry cliff
    const qx = W * ZONES.stone.x0;
    poly([qx, H * 0.78, qx + W * 0.03, H * 0.42, W * 0.86, H * 0.32, W, H * 0.30, W, H * 0.78], '#8d949c');
    poly([qx + W * 0.05, H * 0.76, qx + W * 0.07, H * 0.52, W * 0.9, H * 0.46, W * 0.97, H * 0.6, W * 0.96, H * 0.76], '#a8b0b8');
    for (let i = 0; i < 5; i++) poly([W * (0.8 + i * 0.035), H * 0.76, W * (0.81 + i * 0.035), H * 0.71, W * (0.83 + i * 0.035), H * 0.76], '#6f777f');

    // forest
    drawForest(L, u);

    // fields
    const fy0 = H * ZONES.food.y0, fx1 = W * ZONES.food.x1;
    const dry = s.evt && s.evt.drought > 0 ? 0.65 : 0;
    rect(0, fy0, fx1, H - fy0, mixHex(L.soil, '#a8916a', dry));
    const sway = Math.sin(t * 1.5) * u * 0.08;
    for (let row = 0; row < 5; row++) {
      const y = fy0 + (row + 0.7) * (H - fy0) / 5.4;
      for (let x = u * 0.6; x < fx1 - u * 0.4; x += u * 0.55) {
        ctx.strokeStyle = mixHex(row % 2 ? L.stalkA : L.stalkB, '#b59a5a', dry); ctx.lineWidth = Math.max(1, u * 0.12);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sway, y - u * L.stalkH); ctx.stroke();
      }
    }

    // windmills on the field edge
    for (let i = 0; i < Math.min(3, s.bld.mill); i++) {
      const mx = W * (0.08 + i * 0.12), my = fy0 - u * 0.2;
      poly([mx - u * 0.4, my, mx - u * 0.25, my - u * 2.2, mx + u * 0.25, my - u * 2.2, mx + u * 0.4, my], '#e0d6c4');
      ctx.save(); ctx.translate(mx, my - u * 2.0); ctx.rotate(t * 1.2 + i);
      for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); rect(-u * 0.1, 0, u * 0.2, u * 1.5, '#8a6a4a'); rect(-u * 0.25, u * 0.4, u * 0.5, u * 1.0, '#f0e8d8'); }
      ctx.restore();
    }

    // streets and the square
    const P = getPlan();
    drawStreets(P, u, L);

    // buildings and people, depth-sorted by y
    const drawables = [];
    if (P.wall) drawables.push({ y: 0.6, fn: () => drawWall(P, u, L) });
    if (sky.day < 0.45) for (const b of P.items) if (GLOWS[b.sprite]) lights.push({ x: W * b.x, y: H * b.y - GLOWS[b.sprite] * u * b.s, r: u * b.s * 1.3, soft: true });
    for (const b of P.items) drawables.push({ y: b.y, fn: () => {
      const bu = u * b.s;
      SPRITES[b.sprite](W * b.x, H * b.y, bu, b, L);
      if (L.snow > 0.02) snowCap(b.sprite, W * b.x, H * b.y, bu, L.snow);
    } });
    for (let i = 0; i < P.carts; i++) { const c = carts[i]; drawables.push({ y: ROAD_Y + (c.dir > 0 ? 0.008 : -0.004), fn: () => drawCart(c, u) }); }
    const night = sky.day < 0.22;
    people.forEach((p, i) => {
      // Late at night most townsfolk are indoors; the watch and the workers still out are shown.
      if (night && !celebration && !p.atWork && !p.mode && p.job !== 'soldier' && i % 3) return;
      drawables.push({ y: p.y, fn: () => drawFigure(p, u * 1.15) });
    });
    for (const f of foes) drawables.push({ y: f.y, fn: () => drawFoe(f, u) });
    for (const v of visitors) drawables.push({ y: v.y, fn: () => drawVisitor(v, u) });
    for (const c of critters) if (!night) drawables.push({ y: c.y, fn: () => drawCat(c, u) });
    if (wagon) drawables.push({ y: ROAD_Y + 0.016, fn: () => drawWagon(u) });
    // The market: a stallholder behind each stall.
    if (P.stage >= 3 && !night) for (const dx of [-0.042, 0.042]) {
      const mx = PLAZA.x + dx, my = PLAZA.y + 0.012;
      drawables.push({ y: my, fn: () => { drawPerson(W * mx, H * my - Math.abs(Math.sin(t * 2 + dx * 50)) * u * 0.06, u * 1.05, dx < 0 ? '#2f6fa3' : '#c0392b', 0, false); } });
    }
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.fn();
    drawFire(u);
    drawBunting(u);
    drawSparks(u);

    // chimney smoke from homes
    if (Math.random() < 0.15) {
      const homes = P.items.filter(b => CHIMNEYS[b.sprite]);
      if (homes.length) {
        const h = homes[Math.floor(Math.random() * homes.length)], [cx, cy] = CHIMNEYS[h.sprite];
        smoke.push({ x: W * h.x + cx * u * h.s, y: H * h.y + cy * u * h.s, life: 3 });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      ctx.fillStyle = p.dark ? `rgba(60,55,55,${0.45 * p.life / 3})` : `rgba(230,230,230,${0.35 * p.life / 3})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, u * (0.25 + (3 - p.life) * 0.2), 0, Math.PI * 2); ctx.fill();
    }

    drawBirds(u);
    drawWeather(u);

    // night tint
    if (sky.day < 0.4) rect(0, 0, W, H, `rgba(10,15,40,${(0.4 - sky.day) * 0.9})`);
    drawLights(sky.day);
    drawSparks(u, true);

    // hover highlight and labels
    if (hover) {
      const z = ZONES[hover];
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.strokeRect(W * z.x0 + 3, H * z.y0 + 3, W * (z.x1 - z.x0) - 6, H * (z.y1 - z.y0) - 6);
      ctx.setLineDash([]);
      ctx.font = `600 ${Math.round(Math.max(12, u * 0.75))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const lx = W * (z.x0 + z.x1) / 2, ly = H * z.y0 + u * 1.2;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const w = ctx.measureText(z.label).width + 16;
      ctx.fillRect(lx - w / 2, ly - u * 0.8, w, u * 1.1);
      ctx.fillStyle = '#fff'; ctx.fillText(z.label, lx, ly);
    }

    // floating texts
    ctx.textAlign = 'center';
    for (const f of floats) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.font = `700 ${Math.round(Math.max(13, u * 0.8))}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function update(dt) {
    t += dt;
    for (let i = floats.length - 1; i >= 0; i--) { floats[i].y -= 40 * dt; floats[i].life -= dt * 0.9; if (floats[i].life <= 0) floats.splice(i, 1); }
    for (let i = smoke.length - 1; i >= 0; i--) { smoke[i].y -= 14 * dt; smoke[i].x += 6 * dt; smoke[i].life -= dt; if (smoke[i].life <= 0) smoke.splice(i, 1); }
    updatePeople(dt);
    updateFoes(dt);
    updateCarts(dt);
    updateForest(dt);
    updateSparks(dt);
    updateFire(dt);
    updateWagon(dt);
    updateVisitors(dt);
    updateCritters(dt);
    updateCelebration(dt);
    const L = seasonLook(dt);
    if (L === CLASSIC) weather.length = 0; else updateWeather(dt, L);
    draw(L);
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.floor(r.width)); H = Math.max(1, Math.floor(r.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function floatText(x, y, text, color) {
    floats.push({ x, y, text, color: color || '#fff', life: 1.4 });
    if (floats.length > 30) floats.shift();
  }

  function init(el, s, opts) {
    state = s; onGather = opts.onGather;
    canvas = document.createElement('canvas');
    el.appendChild(canvas);
    ctx = canvas.getContext('2d');
    forest = makeForest();
    Sim.on(onSimEvent);
    resize();
    new ResizeObserver(resize).observe(el);
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      hover = zoneAt(e.clientX - r.left, e.clientY - r.top);
      canvas.style.cursor = hover ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerleave', () => { hover = ''; });
    canvas.addEventListener('pointerdown', e => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const z = zoneAt(x, y);
      if (z && onGather) onGather(z, x, y);
    });
  }

  function setState(s) {
    state = s; people.length = 0; foes.length = 0; planKey = ''; plan = null; shownClock = -1; weather.length = 0;
    fire = null; wagon = null; visitors.length = 0; critters.length = 0; celebration = null; sparks.length = 0;
    if (forest) for (const tr of forest) { tr.st = 'up'; tr.k = 1; tr.by = null; }
  }

  window.Scene = {
    init, update, setState, floatText,
    sync() { syncPeople(); syncFoes(); watchState(); },
    zoneCenter(z) { const Z = ZONES[z]; return { x: W * (Z.x0 + Z.x1) / 2, y: H * (Z.y0 + Z.y1) / 2 }; },
  };
})();
