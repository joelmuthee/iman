// Re-sort the catalog so bags are newest IG post first (same order as IG feed).
// createdAt = takenAt (IG post date) for all ig-synced items.
// Usage: node tools/sort_catalog.js
const fs = require('fs');
const path = require('path');

const API = 'https://iman-high-street-api.stawisystems.workers.dev';
const TOKEN = fs.readFileSync(path.join(__dirname, '..', 'worker', '.admin-token'), 'utf8').trim();

(async () => {
  const r = await fetch(API + '/api/bags');
  const data = await r.json();
  const bags = data.bags;
  console.log(`fetched ${bags.length} bags`);

  bags.sort((a, b) => {
    const ta = a.createdAt || '';
    const tb = b.createdAt || '';
    return tb.localeCompare(ta);
  });

  console.log('top 5 after sort:');
  bags.slice(0, 5).forEach(b => console.log(`  ${b.name} | ${b.createdAt}`));
  console.log('bottom 5 after sort:');
  bags.slice(-5).forEach(b => console.log(`  ${b.name} | ${b.createdAt}`));

  const wr = await fetch(API + '/api/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: JSON.stringify({ bags, settings: data.settings }),
  });
  const wb = await wr.json().catch(() => ({}));
  console.log('bulk write: HTTP ' + wr.status, JSON.stringify(wb));
})();
