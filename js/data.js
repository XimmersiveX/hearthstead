// =====================================================================
//  GAME CONTENT
//  All the numbers and names for the game live here, so you can tweak
//  balance without touching the game code. The game "ticks" once per
//  second, so every rate below is "per second".
// =====================================================================
window.GAME_DATA = {
  title: 'Hearthstead',

  // ---------------------------------------------------------------
  //  Resources
  // ---------------------------------------------------------------
  resources: {
    food:    { name: 'Food',    icon: '🌾', color: '#f2c94c', basic: true, special: 'skins', verb: 'Harvest', activity: 'harvesting' },
    wood:    { name: 'Wood',    icon: '🪵', color: '#c58a4f', basic: true, special: 'herbs', verb: 'Chop',    activity: 'woodcutting' },
    stone:   { name: 'Stone',   icon: '🪨', color: '#b8c0c8', basic: true, special: 'ore',   verb: 'Quarry',  activity: 'quarrying' },
    skins:   { name: 'Skins',   icon: '🦊', color: '#e0975a' },
    herbs:   { name: 'Herbs',   icon: '🌿', color: '#7fd17a' },
    ore:     { name: 'Ore',     icon: '⛰️', color: '#a0a8c0' },
    leather: { name: 'Leather', icon: '🧥', color: '#c9874a' },
    metal:   { name: 'Metal',   icon: '🔩', color: '#d0d8e8' },
    piety:   { name: 'Faith',   icon: '✨', color: '#ffe38a', safe: true },
    gold:    { name: 'Gold',    icon: '🪙', color: '#ffd700', safe: true },
    corpses: { name: 'Corpses', icon: '⚰️', color: '#9a8f99', safe: true },
  },
  // Resources that bandits can steal and raids can plunder.
  lootable: ['food', 'wood', 'stone', 'skins', 'herbs', 'ore', 'leather', 'metal'],

  baseStorage: 200,          // food / wood / stone each start with room for 200
  clickSpecialChance: 0.1,   // 10% chance of a special resource on each click

  // ---------------------------------------------------------------
  //  Settlement size titles (by living population)
  // ---------------------------------------------------------------
  civSizes: [
    { min: 0,      name: 'Thorp',        id: 'thorp' },
    { min: 20,     name: 'Hamlet',       id: 'hamlet' },
    { min: 60,     name: 'Village',      id: 'village' },
    { min: 200,    name: 'Small Town',   id: 'smallTown' },
    { min: 2000,   name: 'Large Town',   id: 'largeTown' },
    { min: 5000,   name: 'Small City',   id: 'smallCity' },
    { min: 10000,  name: 'Large City',   id: 'largeCity' },
    { min: 20000,  name: 'Metropolis',   id: 'metropolis' },
    { min: 50000,  name: 'Small Nation', id: 'smallNation' },
    { min: 100000, name: 'Nation',       id: 'nation' },
    { min: 200000, name: 'Large Nation', id: 'largeNation' },
    { min: 500000, name: 'Empire',       id: 'empire' },
  ],

  // ---------------------------------------------------------------
  //  Population
  // ---------------------------------------------------------------
  population: {
    workerCost: 20,       // food per new citizen...
    workerCostRise: 0.01, // ...plus 0.01 food for every citizen you already have
    eats: 1,              // food eaten by each living citizen per second
    startLand: 1000,      // every building uses one plot of land
    catChance: 0.01,      // chance a stray cat turns up when you recruit
  },

  // ---------------------------------------------------------------
  //  Buildings. cost(n) is used when the price changes with how many
  //  you own (n = how many you already have).
  // ---------------------------------------------------------------
  buildings: {
    tent:      { name: 'Tent',          icon: '⛺', group: 'Housing', cost: { wood: 2, skins: 2 },  pop: 1, desc: '+1 max population.' },
    hut:       { name: 'Wooden Hut',    icon: '🛖', group: 'Housing', cost: { wood: 20, skins: 1 }, pop: 3, desc: '+3 max population.' },
    cottage:   { name: 'Cottage',       icon: '🏡', group: 'Housing', req: { masonry: true }, cost: { wood: 10, stone: 30 }, pop: 6, desc: '+6 max population.' },
    house:     { name: 'House',         icon: '🏠', group: 'Housing', req: { construction: true }, cost: { wood: 30, stone: 70 }, pop: 10, desc: '+10 max population (+2 each from Tenements and Slums).' },
    mansion:   { name: 'Manor',         icon: '🏰', group: 'Housing', req: { architecture: true }, cost: { wood: 200, stone: 200, leather: 20 }, pop: 50, desc: '+50 max population.' },

    barn:      { name: 'Barn',          icon: '🏚️', group: 'Storage', cost: { wood: 100 }, desc: '+200 food storage (+400 with Grain Silos).' },
    woodstock: { name: 'Woodpile',      icon: '🪓', group: 'Storage', cost: { wood: 100 }, desc: '+200 wood storage.' },
    stonestock:{ name: 'Stone Yard',    icon: '🧱', group: 'Storage', cost: { wood: 100 }, desc: '+200 stone storage.' },

    tannery:   { name: 'Tannery',       icon: '🪣', group: 'Workshops', req: { masonry: true }, cost: { wood: 30, stone: 70, skins: 2 }, desc: 'Room for 1 tanner.' },
    smithy:    { name: 'Forge',         icon: '⚒️', group: 'Workshops', req: { masonry: true }, cost: { wood: 30, stone: 70, ore: 2 }, desc: 'Room for 1 blacksmith.' },
    apothecary:{ name: 'Herbalist',     icon: '⚗️', group: 'Workshops', req: { masonry: true }, cost: { wood: 30, stone: 70, herbs: 2 }, desc: 'Room for 1 healer.' },
    temple:    { name: 'Shrine',        icon: '⛩️', group: 'Workshops', req: { masonry: true }, cost: { wood: 30, stone: 120 }, desc: 'Room for 1 priest.' },
    graveyard: { name: 'Graveyard',     icon: '🪦', group: 'Workshops', req: { masonry: true }, cost: { wood: 50, stone: 200, herbs: 50 }, graves: 100, safe: true, desc: 'Holds 100 graves. Priests bury the dead here.' },
    mill:      { name: 'Windmill',      icon: '🌬️', group: 'Workshops', req: { wheel: true },
                 cost: n => ({ wood: 100 * (n + 1) * Math.pow(1.05, n), stone: 100 * (n + 1) * Math.pow(1.05, n) }),
                 desc: 'Each windmill makes farmers 0.5% more productive.' },

    barracks:  { name: 'Barracks',      icon: '🛡️', group: 'Military', req: { masonry: true }, cost: { food: 20, wood: 60, stone: 120, metal: 10 }, desc: 'Room for 10 soldiers.' },
    stable:    { name: 'Stable',        icon: '🐎', group: 'Military', req: { horseback: true }, cost: { food: 60, wood: 60, stone: 120, leather: 10 }, desc: 'Room for 10 riders.' },
    fortification: { name: 'Fortification', icon: '🏯', group: 'Military', req: { architecture: true },
                 cost: n => ({ stone: 100 * (n + 1) * Math.pow(1.05, n) }),
                 desc: 'Each one cuts the damage attackers do by 1%.' },
  },

  // Altars only appear once you have chosen a domain for your deity.
  // Each altar adds 1 devotion.
  altars: {
    battle:     { cost: n => ({ stone: 200, piety: 200, metal: 50 + 50 * n }) },
    fields:     { cost: n => ({ stone: 200, piety: 200, food: 500 + 250 * n, wood: 500 + 250 * n }) },
    underworld: { cost: n => ({ stone: 200, piety: 200, corpses: 1 + n }) },
    cats:       { cost: n => ({ stone: 200, piety: 200, herbs: 100 + 50 * n }) },
  },

  // ---------------------------------------------------------------
  //  Jobs. "limitBy" means you need that building for each worker.
  // ---------------------------------------------------------------
  jobs: {
    unemployed: { name: 'Idle',        icon: '🧍', color: '#bfb3a0', desc: 'Not doing much of anything.' },
    farmer:     { name: 'Farmer',      icon: '🧑‍🌾', color: '#f2c94c', desc: 'Grows food. Each makes 1.2 food/s at first, more with upgrades.' },
    woodcutter: { name: 'Woodcutter',  icon: '🪓', color: '#c58a4f', desc: 'Cuts 0.5 wood/s.' },
    miner:      { name: 'Miner',       icon: '⛏️', color: '#b8c0c8', desc: 'Quarries 0.2 stone/s.' },
    tanner:     { name: 'Tanner',      icon: '🧥', color: '#e0975a', limitBy: 'tannery', desc: 'Turns 0.5 skins/s into leather.' },
    blacksmith: { name: 'Blacksmith',  icon: '⚒️', color: '#d0d8e8', limitBy: 'smithy', desc: 'Turns 0.5 ore/s into metal.' },
    healer:     { name: 'Healer',      icon: '🩺', color: '#7fd17a', limitBy: 'apothecary', desc: 'Cures the sick, using 1 herb each.' },
    cleric:     { name: 'Priest',      icon: '🙏', color: '#ffe38a', limitBy: 'temple', desc: 'Makes 0.05 faith/s and buries the dead.' },
    labourer:   { name: 'Builder',     icon: '👷', color: '#ff9a4a', desc: 'Builds your wonder from every kind of resource.' },
    soldier:    { name: 'Soldier',     icon: '🗡️', color: '#ff6b6b', military: true, cost: { leather: 10, metal: 10 }, perBuilding: { barracks: 10 }, desc: 'Defends the town. Can join raids.' },
    cavalry:    { name: 'Rider',       icon: '🏇', color: '#ff8fb0', military: true, cost: { food: 20, leather: 20 }, perBuilding: { stable: 10 }, desc: 'Hits harder than soldiers but suffers against infantry.' },
  },
  // Order in which hunger claims people (sick first, then in this order).
  starveOrder: ['unemployed', 'blacksmith', 'tanner', 'miner', 'woodcutter', 'cleric', 'cavalry', 'soldier', 'healer', 'labourer', 'farmer'],
  // Order in which healers treat the sick.
  patientOrder: ['healer', 'cleric', 'farmer', 'soldier', 'cavalry', 'labourer', 'woodcutter', 'miner', 'tanner', 'blacksmith', 'unemployed'],

  rates: {
    farmer: 0.2,       // bonus efficiency (base output is 1 + this)
    farmerPerUpgrade: 0.1,
    woodcutter: 0.5,
    miner: 0.2,
    tanner: 0.5,
    blacksmith: 0.5,
    healer: 0.1,
    cleric: 0.05,
    millBonus: 1 / 200,
  },

  // ---------------------------------------------------------------
  //  Combat
  // ---------------------------------------------------------------
  combat: {
    soldier: 0.05, cavalry: 0.08, siege: 0.1,
    siegeCost: { wood: 200, leather: 50, metal: 50 },
    fortification: 0.01, palisade: 0.01,
    cavalryVsInfantry: 1.5,  // riders take 50% more losses from foot soldiers
    shadeFade: 0.95,
  },
  enemies: {
    wolf:      { name: 'Wolves',     one: 'wolf',      icon: '🐺', eff: 0.05, kind: 'slaughter', animal: true, killExhaustion: 0.5, killFatigue: 1 },
    bandit:    { name: 'Bandits',    one: 'bandit',    icon: '🥷', eff: 0.07, kind: 'loot', lootFatigue: 1 / 8 },
    barbarian: { name: 'Barbarians', one: 'barbarian', icon: '🪓', eff: 0.09, kind: 'havoc', lootFatigue: 1 / 24, killFatigue: 1 / 3, killExhaustion: 1 },
  },
  mobs: {
    minGap: 300,        // seconds of peace before an attack can happen
    chancePerSec: 1 / 600,
    perPop: 1 / 50,     // up to 1 attacker per 50 people
    banditPop: 1000,
    barbarianPop: 10000,
  },

  // ---------------------------------------------------------------
  //  Trade
  // ---------------------------------------------------------------
  trade: {
    baseDelay: 180,     // seconds; each trade upgrade cuts 60
    stay: 12,           // seconds a merchant waits; +5 per upgrade
    asks: [
      { res: 'food', amt: 5000 }, { res: 'wood', amt: 5000 }, { res: 'stone', amt: 5000 },
      { res: 'skins', amt: 500 }, { res: 'herbs', amt: 500 }, { res: 'ore', amt: 500 },
      { res: 'leather', amt: 250 }, { res: 'metal', amt: 250 },
    ],
    maxMult: 20,        // asks for 1x to 20x the amounts above
    buy: { food: 5000, wood: 5000, stone: 5000, skins: 500, herbs: 500, ore: 500, leather: 250, metal: 250 },
  },

  // ---------------------------------------------------------------
  //  Wonders
  // ---------------------------------------------------------------
  wonder: {
    resources: ['food', 'wood', 'stone', 'skins', 'herbs', 'ore', 'leather', 'metal', 'piety'],
    unitsPerPercent: 1000000, // resources of each type per 1% of progress
    rushGold: 100,            // spend 100 gold for +1% progress
    bonus: 0.1,               // each finished wonder gives +10% of its resource
  },

  // ---------------------------------------------------------------
  //  Faith
  // ---------------------------------------------------------------
  deity: {
    domainCost: 500,
    iconoclasmCost: 1000,
    domains: {
      battle:     { name: 'War',      icon: '⚔️', desc: 'Stronger armies, smiting invaders, glory in battle.' },
      fields:     { name: 'Harvest',  icon: '🌾', desc: 'Richer fields, offerings and sacrifice.' },
      underworld: { name: 'the Dead', icon: '💀', desc: 'Raise the dead and call on restless shades.' },
      cats:       { name: 'the Hearth', icon: '🐈', desc: 'Cats, comfort and good fortune.' },
    },
  },

  // ---------------------------------------------------------------
  //  Upgrades.  req: other upgrades or buildings you need first.
  //  tab: which tab it shows in ('tech' by default).
  // ---------------------------------------------------------------
  upgrades: {
    skinning:    { name: 'Skinning',        cost: { skins: 10 }, desc: 'Farmers sometimes bring back skins.' },
    harvesting:  { name: 'Foraging',        cost: { herbs: 10 }, desc: 'Woodcutters sometimes bring back herbs.' },
    prospecting: { name: 'Prospecting',     cost: { ore: 10 },   desc: 'Miners sometimes bring back ore.' },
    masonry:     { name: 'Masonry',         cost: { wood: 100, stone: 100 }, desc: 'Unlocks stone buildings and new upgrades.' },
    domestication:{ name: 'Animal Pens',    req: { masonry: true }, cost: { leather: 20 }, desc: 'Farmers +0.1 food each.', farm: 1 },
    ploughshares:{ name: 'Iron Ploughs',    req: { masonry: true }, cost: { metal: 20 }, desc: 'Farmers +0.1 food each.', farm: 1 },
    irrigation:  { name: 'Irrigation',      req: { masonry: true }, cost: { wood: 500, stone: 200 }, desc: 'Farmers +0.1 food each.', farm: 1 },
    granaries:   { name: 'Grain Silos',     req: { masonry: true }, cost: { wood: 1000, stone: 1000 }, desc: 'Barns hold twice as much food.' },
    weaponry:    { name: 'Sharpened Steel', req: { masonry: true }, cost: { wood: 500, metal: 500 }, desc: 'Soldiers and riders fight 1% better.', combat: 0.01 },
    shields:     { name: 'Hide Shields',    req: { masonry: true }, cost: { wood: 500, leather: 500 }, desc: 'Soldiers and riders fight 1% better.', combat: 0.01 },
    horseback:   { name: 'Horse Taming',    req: { masonry: true }, cost: { food: 500, wood: 500 }, desc: 'Unlocks stables.' },
    wheel:       { name: 'The Wheel',       req: { masonry: true }, cost: { wood: 500, stone: 500 }, desc: 'Unlocks windmills.' },
    writing:     { name: 'Writing',         req: { masonry: true }, cost: { skins: 500 }, desc: 'Priests make twice as much faith.' },
    construction:{ name: 'Construction',    req: { masonry: true }, cost: { wood: 1000, stone: 1000 }, desc: 'Unlocks houses and new upgrades.' },
    tenements:   { name: 'Tenements',       req: { construction: true }, cost: { food: 200, wood: 500, stone: 500 }, desc: 'Houses hold 2 more people.' },
    butchering:  { name: 'Butchery',        req: { construction: true, skinning: true }, cost: { leather: 40 }, desc: 'More farmers find more skins.' },
    gardening:   { name: 'Herb Gardens',    req: { construction: true, harvesting: true }, cost: { herbs: 40 }, desc: 'More woodcutters find more herbs.' },
    extraction:  { name: 'Deep Shafts',     req: { construction: true, prospecting: true }, cost: { metal: 40 }, desc: 'More miners find more ore.' },
    palisade:    { name: 'Palisade',        req: { construction: true }, cost: { wood: 2000, stone: 1000 }, desc: 'Attackers do 1% less damage.' },
    administration:{ name: 'Administration',req: { writing: true }, cost: { stone: 1000, skins: 1000 }, desc: 'Raids win twice as much land.' },
    codeoflaws:  { name: 'Code of Laws',    req: { writing: true }, cost: { stone: 1000, skins: 1000 }, desc: 'Overcrowding hurts morale half as much.' },
    mathematics: { name: 'Mathematics',     req: { writing: true }, cost: { herbs: 1000, piety: 1000 }, desc: 'Build siege engines. Capture enemy ones.' },
    aesthetics:  { name: 'Aesthetics',      req: { writing: true }, cost: { piety: 5000 }, desc: 'Building shrines raises morale.' },
    architecture:{ name: 'Architecture',    req: { construction: true }, cost: { wood: 10000, stone: 10000 }, desc: 'Unlocks manors, fortifications and new upgrades.' },
    slums:       { name: 'Slums',           req: { architecture: true }, cost: { food: 500, wood: 1000, stone: 1000 }, desc: 'Houses hold 2 more people.' },
    flensing:    { name: 'Flensing Knives', req: { architecture: true }, cost: { metal: 1000 }, desc: 'Skins turn up more often.' },
    macerating:  { name: 'Ore Crushing',    req: { architecture: true }, cost: { leather: 500, stone: 500 }, desc: 'Ore turns up more often.' },
    croprotation:{ name: 'Crop Rotation',   req: { architecture: true }, cost: { herbs: 5000, piety: 1000 }, desc: 'Farmers +0.1 food each.', farm: 1 },
    selectivebreeding:{ name: 'Selective Breeding', req: { architecture: true }, cost: { skins: 5000, piety: 1000 }, desc: 'Farmers +0.1 food each.', farm: 1 },
    fertilisers: { name: 'Fertilisers',     req: { architecture: true }, cost: { ore: 5000, piety: 1000 }, desc: 'Farmers +0.1 food each.', farm: 1 },
    civilservice:{ name: 'Civil Service',   req: { architecture: true }, cost: { piety: 5000 }, desc: 'Each click gathers 9 more.' },
    feudalism:   { name: 'Feudalism',       req: { civilservice: true }, cost: { piety: 10000 }, desc: 'Each click gathers 40 more.' },
    guilds:      { name: 'Guilds',          req: { civilservice: true }, cost: { piety: 10000 }, desc: 'Clicks find 10× as many special resources.' },
    serfs:       { name: 'Serfs',           req: { civilservice: true }, cost: { piety: 20000 }, desc: 'Idle citizens add to every click.' },
    nationalism: { name: 'Nationalism',     req: { civilservice: true }, cost: { piety: 50000 }, desc: 'Soldiers at home add to every click.' },

    worship:     { name: 'Worship',         tab: 'faith', req: { temple: 1 }, cost: { piety: 1000 }, desc: 'Name a deity for your people to worship.' },
    standard:    { name: 'War Banner',      tab: 'war', req: { barracks: 1 }, cost: { leather: 1000, metal: 1000 }, desc: 'Lets you form a raiding party.' },
    trade:       { name: 'Trading Post',    tab: 'trade', req: { gold: 1 }, cost: { gold: 1 }, desc: 'Buy goods from merchants with gold.' },
    currency:    { name: 'Coinage',         tab: 'trade', req: { trade: true }, cost: { ore: 1000, gold: 10 }, desc: 'Merchants come more often and stay longer.' },
    commerce:    { name: 'Commerce',        tab: 'trade', req: { currency: true }, cost: { piety: 10000, gold: 100 }, desc: 'Merchants come more often and stay longer.' },

    // Blessings: unlock once your deity has enough devotion (number of altars).
    lure:      { name: 'Saucer of Milk',    tab: 'faith', domain: 'cats', devotion: 10, cost: { piety: 1000 }, desc: 'Cats turn up more often.' },
    companion: { name: 'Purring Comfort',   tab: 'faith', domain: 'cats', devotion: 30, cost: { piety: 1000 }, desc: 'Cats help heal the sick.' },
    comfort:   { name: 'Hearthfire Glow',   tab: 'faith', domain: 'cats', devotion: 50, cost: { piety: 5000 }, desc: 'Merchants come a little more often.' },
    blessing:  { name: 'Bountiful Earth',   tab: 'faith', domain: 'fields', devotion: 10, cost: { piety: 1000 }, desc: 'Farmers +0.1 food each.', farm: 1 },
    waste:     { name: 'Nothing Wasted',    tab: 'faith', domain: 'fields', devotion: 30, cost: { piety: 1000 }, desc: 'When food runs out, people eat the dead.' },
    stay:      { name: 'Warm Welcome',      tab: 'faith', domain: 'fields', devotion: 50, cost: { piety: 5000 }, desc: 'Merchants stay longer.' },
    riddle:    { name: 'Blessed Blades',    tab: 'faith', domain: 'battle', devotion: 10, cost: { piety: 1000 }, desc: 'Soldiers and riders fight 1% better.', combat: 0.01 },
    throne:    { name: 'Hall of Trophies',  tab: 'faith', domain: 'battle', devotion: 30, cost: { piety: 1000 }, desc: 'Every 100 enemies slain raises a free shrine.' },
    lament:    { name: 'Dreaded Name',      tab: 'faith', domain: 'battle', devotion: 50, cost: { piety: 5000 }, desc: 'Winning raids delays the next attack on you.' },
    book:      { name: 'Rites of Passing',  tab: 'faith', domain: 'underworld', devotion: 10, cost: { piety: 1000 }, desc: '+10 faith whenever anyone dies.' },
    feast:     { name: 'Carrion Birds',     tab: 'faith', domain: 'underworld', devotion: 30, cost: { piety: 1000 }, desc: 'Corpses spread sickness half as often.' },
    secrets:   { name: 'Whispering Tombs',  tab: 'faith', domain: 'underworld', devotion: 50, cost: { piety: 5000 }, desc: 'Graveyards make priests more faithful.' },
  },

  // Prayers: repeatable powers from your deity.
  prayers: {
    smite:       { name: 'Strike Down',     domain: 'battle', devotion: 20, desc: 'Kill invaders at 100 faith each.' },
    glory:       { name: 'Call to Glory',   domain: 'battle', devotion: 40, cost: { piety: 1000 }, seconds: 180, desc: 'For 3 minutes, raids face twice the defenders and give twice the loot.' },
    wickerman:   { name: 'Harvest Offering',domain: 'fields', devotion: 20, cost: { wood: 500 }, desc: 'Sacrifice one citizen for a windfall of a random resource.' },
    walk:        { name: 'Tread the Furrows', domain: 'fields', devotion: 40, desc: 'Each step sacrifices 1 citizen per second but boosts food by 1/120 each.' },
    raiseDead:   { name: 'Raise the Dead',  domain: 'underworld', devotion: 20, desc: 'Turn corpses into workers that need no food or homes.' },
    summonShade: { name: 'Call the Shades', domain: 'underworld', devotion: 40, cost: { piety: 1000 }, desc: 'The souls of slain enemies fight invaders for you.' },
    pestControl: { name: 'Mouse Hunt',      domain: 'cats', devotion: 20, cost: { piety: 100 }, desc: 'Your cats guard the grain (+1% food) for 10 seconds per cat.' },
    grace:       { name: 'Grace',           domain: 'cats', devotion: 40, desc: 'Raise morale. Costs 20% more each time, easing back over time.' },
  },

  // ---------------------------------------------------------------
  //  Achievements
  // ---------------------------------------------------------------
  achievements: {
    raider:     { name: 'Raider',       desc: 'Win a raid.' },
    engineer:   { name: 'Engineer',     desc: 'Own a siege engine.' },
    domination: { name: 'Domination',   desc: 'Defeat the largest possible enemy.' },
    hated:      { name: 'Hated',        desc: 'Morale drops to 50% or lower.' },
    loved:      { name: 'Loved',        desc: 'Morale reaches 150%.' },
    cat:        { name: 'Cat!',         desc: 'Find a cat.' },
    glaring:    { name: 'Glaring',      desc: 'Own 10 cats.' },
    clowder:    { name: 'Clowder',      desc: 'Own 100 cats.' },
    plagued:    { name: 'Plagued',      desc: 'Have more sick people than healthy ones.' },
    ghostTown:  { name: 'Ghost Town',   desc: 'Have room for 1,000 and nobody left alive.' },
    battle:     { name: 'War',          desc: 'Worship a deity of War.' },
    fields:     { name: 'Harvest',      desc: 'Worship a deity of the Harvest.' },
    underworld: { name: 'the Dead',     desc: 'Worship a deity of the Dead.' },
    cats:       { name: 'Hearth',       desc: 'Worship a deity of the Hearth.' },
    fullHouse:  { name: 'Full House',   desc: 'Worship all four kinds of deity.' },
    wonder:     { name: 'Wonder',       desc: 'Finish a wonder.' },
    seven:      { name: 'Seven!',       desc: 'Finish seven wonders.' },
    merchant:   { name: 'Merchant',     desc: 'Earn gold.' },
    rushed:     { name: 'Rushed',       desc: 'Hurry a wonder with gold.' },
    neverclick: { name: 'Neverclick',   desc: 'Finish a wonder with 22 clicks or fewer.' },
  },

  // ---------------------------------------------------------------
  //  Seasons and choice events (js/seasons.js)
  //  The look of the seasons is on by default and changes nothing in
  //  play. The gameplay effects below only apply when the player turns
  //  on "Season effects and events" in the menu.
  // ---------------------------------------------------------------
  seasons: {
    length: 180,  // game seconds per season (3 minutes at 1x speed)
    list: [
      { id: 'spring', name: 'Spring', icon: '🌸', farm: 1.0, note: 'Farms grow at the normal rate.' },
      { id: 'summer', name: 'Summer', icon: '☀️', farm: 1.2, note: 'Long days: farms grow 20% more.' },
      { id: 'autumn', name: 'Autumn', icon: '🍂', farm: 1.5, note: 'The big harvest: farms grow 50% more.' },
      { id: 'winter', name: 'Winter', icon: '❄️', farm: 0.6, note: 'Frozen fields: farms grow 40% less. Store food in autumn.' },
    ],
    events: {
      firstDelay: 300,   // game seconds before the first event can happen
      minGap: 300,       // and at least this long between events
      chance: 1 / 120,   // chance per second once the gap has passed
      minPop: 5,         // needs at least this many people
      decideWithin: 120, // game seconds to decide before the cautious choice is made for you
      droughtSeconds: 90,  // farms make half while a drought lasts
      droughtMult: 0.5,
      lessonSeconds: 180,  // a scholar's lessons last this long...
      lessonMult: 1.25,    // ...and farmers, woodcutters and miners work 25% faster
    },
  },

  offlineCapHours: 8,
};
