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
      let sprite = '', sc = 1.25, sign = '';
      const seed = Math.floor(r() * 1000);
      if (l.role === 'temple' && b.temple > 0) { sprite = stage >= 4 ? 'greatTemple' : stage >= 3 ? 'temple' : 'shrine'; sc = stage >= 4 ? 1.05 : 1.1; }
      else if (l.role === 'barn' && b.barn > 0) sprite = 'barn';
      else if (l.role === 'barn' && b.woodstock > 0) sprite = 'woodpile';
      else if (l.role === 'yard' && (b.woodstock > 0 || b.stonestock > 0)) sprite = 'yard';
      else if (l.role === 'work' && works.length) {
        // In the city the trades move into proper shopfronts with a hanging sign.
        const w = works.shift();
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
      items.push({ sprite, x: l.x, y: l.y, s: sc, seed, sign, city: stage >= 4, wall: TOWN_WALLS[seed % TOWN_WALLS.length], roof: TOWN_ROOFS[(seed >> 3) % TOWN_ROOFS.length] });
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
    if (key !== planKey) { planKey = key; plan = makePlan(s, st); }
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
  const JOB_ZONES = {
    farmer: () => ({ x: 0.04 + Math.random() * 0.33, y: 0.84 + Math.random() * 0.13 }),
    woodcutter: () => ({ x: 0.04 + Math.random() * 0.22, y: 0.62 + Math.random() * 0.14 }),
    miner: () => ({ x: 0.79 + Math.random() * 0.18, y: 0.64 + Math.random() * 0.12 }),
    soldier: () => ({ x: 0.70 + Math.random() * 0.08, y: 0.60 + Math.random() * 0.3 }),
    cavalry: () => ({ x: 0.70 + Math.random() * 0.08, y: 0.60 + Math.random() * 0.3 }),
  };
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
    // Decide how many of each job to show.
    const counts = {};
    let assigned = 0;
    for (const j of Sim.JOBS) {
      const n = s.units[j] + (s.ill[j] || 0);
      counts[j] = total > 0 ? Math.round((n / total) * want) : 0;
      assigned += counts[j];
    }
    while (assigned > want) { const j = Sim.JOBS.find(k => counts[k] > 0); counts[j]--; assigned--; }
    const have = {};
    for (const p of people) have[p.job] = (have[p.job] || 0) + 1;
    for (const j of Sim.JOBS) {
      let diff = (counts[j] || 0) - (have[j] || 0);
      while (diff > 0) {
        const start = villageSpot();
        people.push({ job: j, x: start.x, y: start.y, tx: start.x, ty: start.y, wait: Math.random() * 3, phase: Math.random() * 6, color: D.jobs[j].color });
        diff--;
      }
      while (diff < 0) { const i = people.findIndex(p => p.job === j); if (i < 0) break; people.splice(i, 1); diff++; }
    }
  }
  function updatePeople(dt) {
    for (const p of people) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      if (d < 0.004) {
        p.wait -= dt;
        if (p.wait <= 0) {
          const atWork = p.atWork;
          const z = JOB_ZONES[p.job];
          const next = (!atWork && z) ? z() : villageSpot();
          p.atWork = !atWork && !!z;
          p.tx = next.x; p.ty = next.y; p.wait = 2 + Math.random() * 4;
        }
      } else {
        const sp = 0.035 * dt;
        p.x += (dx / d) * Math.min(sp, d); p.y += (dy / d) * Math.min(sp, d);
        p.phase += dt * 9;
      }
    }
  }
  function syncFoes() {
    const s = state;
    const want = [];
    for (const k of Sim.ENEMIES) for (let i = 0; i < Math.min(12, Math.ceil(Math.log2(s.enemies[k] + 1) * 2)); i++) want.push(k);
    while (foes.length > want.length) foes.pop();
    for (let i = 0; i < want.length; i++) {
      if (!foes[i] || foes[i].kind !== want[i]) foes[i] = { kind: want[i], x: 1.02 + Math.random() * 0.05, y: 0.6 + Math.random() * 0.32, phase: Math.random() * 6 };
    }
  }
  function updateFoes(dt) {
    for (const f of foes) {
      const target = 0.6 + Math.sin(t * 0.7 + f.y * 20) * 0.04;
      if (f.x > target) f.x -= 0.05 * dt;
      f.phase += dt * 10;
    }
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
    const tr = seeded(3), ta = seeded(11);
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 7; i++) {
        const x = W * (0.01 + i * 0.038 + tr() * 0.02 + (row % 2) * 0.015);
        const y = H * (0.5 + row * 0.075);
        let shade = row % 2 ? L.tree2 : L.tree1;
        const turn = ta(), leaf = AUTUMN_LEAVES[Math.floor(ta() * AUTUMN_LEAVES.length)];
        if (L.autumn > 0 && turn < 0.6) shade = mixHex(row % 2 ? LOOKS.autumn.tree2 : LOOKS.autumn.tree1, leaf, L.autumn);
        drawTree(x, y, u * (1.2 + tr() * 0.4), shade, turn < 0.5 ? L.bloom : 0, L.snow);
      }
    }

    // fields
    const fy0 = H * ZONES.food.y0, fx1 = W * ZONES.food.x1;
    rect(0, fy0, fx1, H - fy0, L.soil);
    const sway = Math.sin(t * 1.5) * u * 0.08;
    for (let row = 0; row < 5; row++) {
      const y = fy0 + (row + 0.7) * (H - fy0) / 5.4;
      for (let x = u * 0.6; x < fx1 - u * 0.4; x += u * 0.55) {
        ctx.strokeStyle = row % 2 ? L.stalkA : L.stalkB; ctx.lineWidth = Math.max(1, u * 0.12);
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
    for (const p of people) drawables.push({ y: p.y, fn: () => drawPerson(W * p.x, H * p.y, u * 1.15, (state.ill[p.job] > 0 && p.phase % 7 < 1) ? '#9acd32' : p.color, p.phase) });
    for (const f of foes) drawables.push({ y: f.y, fn: () => (f.kind === 'wolf' ? drawWolf(W * f.x, H * f.y, u, f.phase, -1) : drawPerson(W * f.x, H * f.y, u, f.kind === 'barbarian' ? '#7a1010' : '#3a3a3a', f.phase, true)) });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.fn();

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
      ctx.fillStyle = `rgba(230,230,230,${0.35 * p.life / 3})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, u * (0.25 + (3 - p.life) * 0.2), 0, Math.PI * 2); ctx.fill();
    }

    // merchant camel at the road on the left
    if (s.trader.timer > 0) {
      const cx = W * 0.27, cy = H * (ROAD_Y + 0.02);
      ctx.font = `${Math.round(u * 1.8)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🐫', cx, cy);
    }

    drawWeather(u);

    // night tint
    if (sky.day < 0.4) rect(0, 0, W, H, `rgba(10,15,40,${(0.4 - sky.day) * 0.9})`);
    drawLights(sky.day);

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

  function setState(s) { state = s; people.length = 0; foes.length = 0; planKey = ''; plan = null; shownClock = -1; weather.length = 0; }

  window.Scene = {
    init, update, setState, floatText,
    sync() { syncPeople(); syncFoes(); },
    zoneCenter(z) { const Z = ZONES[z]; return { x: W * (Z.x0 + Z.x1) / 2, y: H * (Z.y0 + Z.y1) / 2 }; },
  };
})();
