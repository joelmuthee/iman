// Tag existing catalog items with gender (ladies/gents/'') using the worker's
// own caption heuristic + per-shortcode manual overrides, then publish.
// Usage: node tools/tag_gender.js [--dry]
const fs = require('fs');
const path = require('path');

const API = 'https://iman-high-street-api.stawisystems.workers.dev';
const TOKEN = fs.readFileSync(path.join(__dirname, '..', 'worker', '.admin-token'), 'utf8').trim();
const DRY = process.argv.includes('--dry');

const workerSrc = fs.readFileSync(path.join(__dirname, '..', 'worker', 'src', 'index.js'), 'utf8');
const start = workerSrc.indexOf('const TYPE_MAP');
const end = workerSrc.indexOf('// ---- IG response normalisers');
eval(workerSrc.slice(start, end));

// Manual overrides where the caption carries no reliable signal — assigned by
// looking at the actual product photos (contact sheet, 2026-06-11).
const OVERRIDES = {
  ig_DZYRtxMNgWb: 'ladies',  // pink blazer outfit on a woman
  ig_DYeYK_vt4bd: 'ladies',  // same pink Balmain blazer look
  ig_DXszn18CPqd: '',        // white sneakers, unisex
  ig_DXszII9CDk1: 'gents',   // navy Italian suit on a man
  ig_DXpTTn4jS46: 'gents',   // Zegna casual, man
  ig_DXlgWzzjUL1: 'gents',   // rugby polo, man
  ig_DXi2NdNDcbt: 'gents',   // brown brogues
  ig_DXi13p_DQpl: 'gents',   // green double-breast blazer, man
  ig_DXU1NWpjfKE: 'gents',   // green blazer, man
  ig_DXPefxyjexG: 'ladies',  // black top, woman
  ig_DXORNHVDVOL: 'ladies',  // white top, woman
  ig_DXNeDpdDndd: 'ladies',  // pink peplum top, woman
  ig_DWr2pWIDX6u: 'gents',   // neck ties
  ig_DWrrUQgjWC9: 'gents',   // tie
  ig_DWqqKZjjVg5: 'gents',   // official shirt + tie
  ig_DV_25ffDffw: 'gents',   // navy double-breast suit
  ig_DV_2bczDdrH: 'gents',   // tan blazer, man
  ig_DV_1uO6Db43: 'gents',   // navy suit, man
  ig_DV_zjX5jQ2K: 'gents',   // black oxfords
  ig_DV_bL0wDauE: 'gents',   // black boots
  ig_DVwwc1ejSys: 'gents',   // black derby shoes
  ig_DVoFF9IjbgG: 'ladies',  // navy pumps with gold tip (heels)
  ig_DUv9MAHjToZ: 'ladies',  // red knit top
  ig_DUI0ecgjagn: 'ladies',  // navy trouser suit on a woman
};

// Data fixes spotted on the same review pass:
// - phantom "S" size parsed from the possessive in "different colour's" (the
//   worker parser is patched; these two items were seeded before the fix)
// - the navy pumps are Heels, not Shoes
const STOCK_FIXES = { ig_DV_25ffDffw: { 'One Size': 1 }, ig_DV_2bczDdrH: { 'One Size': 1 } };
const CAT_FIXES = { ig_DVoFF9IjbgG: 'Heels' };

const feed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.tmp', 'feed_raw.json'), 'utf8'));
const capByCode = {};
feed.forEach(p => { capByCode[`ig_${p.shortcode}`] = p.caption || ''; });

(async () => {
  const H = { 'Authorization': `Bearer ${TOKEN}`, 'User-Agent': 'Mozilla/5.0 Chrome/124' };
  const data = await (await fetch(`${API}/api/bags?_=${Date.now()}`, { headers: H })).json();
  for (const bag of data.bags) {
    let g = OVERRIDES[bag.id];
    if (g === undefined) {
      const cap = capByCode[bag.id];
      g = cap !== undefined ? parseCaptionForBag(cap).gender : '';
    }
    if (g) bag.gender = g; else delete bag.gender;
    if (STOCK_FIXES[bag.id]) bag.stock = STOCK_FIXES[bag.id];
    if (CAT_FIXES[bag.id]) bag.category = CAT_FIXES[bag.id];
    console.log(`${(bag.gender || 'both').padEnd(7)} | ${bag.category.padEnd(12)} | ${bag.name.padEnd(26)} | ${Object.keys(bag.stock || {}).join(',')}`);
  }
  if (DRY) return;
  const res = await fetch(`${API}/api/bulk`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bags: data.bags, settings: data.settings, sets: data.sets || [], clients: data.clients || [] }),
  });
  console.log('publish:', res.status, await res.text());
})();
