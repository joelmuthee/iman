// Seed the Iman High Street catalog from .tmp/feed_raw.json (already pulled
// from the IG feed API, newest-first, cap 150). Reuses the WORKER's own
// caption parser by slicing it from worker/src/index.js, so seed-time and
// sync-time classification can never drift.
//
// Rules (per onboarding brief + CATALOG-STANDARDS):
// - skip captions that don't yield a real product name (no TYPE_MAP match)
// - skip captions marked SOLD / SOLD OUT
// - strip em/en dashes from anything user-facing
// - chunk /api/ig-sync so each call stays under the worker's ~50-subrequest
//   cap (each image = 1 fetch + 2 KV puts), oldest chunk first so the
//   prepend-per-call keeps the catalog newest-first overall
//
// Usage: node tools/seed_catalog.js [--dry] [--max-images N]
const fs = require('fs');
const path = require('path');

const API = 'https://iman-high-street-api.stawisystems.workers.dev';
const TOKEN = fs.readFileSync(path.join(__dirname, '..', 'worker', '.admin-token'), 'utf8').trim();
const DRY = process.argv.includes('--dry');
const maxImgIdx = process.argv.indexOf('--max-images');
const MAX_IMAGES = maxImgIdx > -1 ? parseInt(process.argv[maxImgIdx + 1], 10) : 4;
const IMAGES_PER_CALL = 12;   // 12 imgs * 3 subrequests = 36, safe under ~50
const ITEMS_PER_CALL = 7;

// ---- lift the parser out of the worker source ----
const workerSrc = fs.readFileSync(path.join(__dirname, '..', 'worker', 'src', 'index.js'), 'utf8');
const start = workerSrc.indexOf('const TYPE_MAP');
const end = workerSrc.indexOf('// ---- IG response normalisers');
if (start < 0 || end < 0) throw new Error('parser anchors not found in worker source');
eval(workerSrc.slice(start, end)); // defines TYPE_MAP, BRAND_LIST, deriveBrand, parseCaptionForBag, looksLikeProduct

const stripDashes = s => String(s || '').replace(/\s*[—–]\s*/g, ', ');

const feed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.tmp', 'feed_raw.json'), 'utf8'));
const seen = new Set();
const seedItems = [];
const skipped = { empty: 0, sold: 0, noName: 0, noImage: 0, dup: 0 };

for (const post of feed) {
  const cap = (post.caption || '').trim();
  if (!post.shortcode || seen.has(post.shortcode)) { skipped.dup++; continue; }
  seen.add(post.shortcode);
  if (!cap) { skipped.empty++; continue; }
  if (/\bsold(?:\s*out)?\b/i.test(cap)) { skipped.sold++; continue; }
  if (!post.imageUrls || !post.imageUrls.length) { skipped.noImage++; continue; }
  const parsed = parseCaptionForBag(cap);
  // "real name" gate: the caption must name a product type we recognise.
  // First-segment fallback names ("Available In Sizes 6 To 14") don't count.
  if (!parsed.category) { skipped.noName++; continue; }
  seedItems.push({
    shortcode: post.shortcode,
    name: stripDashes(parsed.name),
    category: parsed.category,
    stock: parsed.stock,
    price: parsed.price || 0,
    description: stripDashes(parsed.description),
    imageUrls: post.imageUrls.slice(0, MAX_IMAGES),
    takenAt: post.takenAt ? new Date(post.takenAt * 1000).toISOString() : null,
  });
}

const totalImages = seedItems.reduce((s, it) => s + it.imageUrls.length, 0);
console.log(`feed posts: ${feed.length}`);
console.log(`skipped: ${JSON.stringify(skipped)}`);
console.log(`seeding: ${seedItems.length} items, ${totalImages} images (~${totalImages * 2} KV writes)`);
const catCount = {};
seedItems.forEach(it => { catCount[it.category] = (catCount[it.category] || 0) + 1; });
console.log('categories:', JSON.stringify(catCount));
const priced = seedItems.filter(i => i.price > 0).length;
console.log(`with price: ${priced}/${seedItems.length}`);

if (DRY) {
  seedItems.slice(0, 30).forEach(it =>
    console.log(`- ${it.name} | ${it.category} | ${it.price} | ${Object.keys(it.stock).join(',')} | ${it.imageUrls.length} img`));
  process.exit(0);
}

// ---- chunk: items <= 7 AND images <= 12 per call ----
const chunks = [];
let cur = [], curImgs = 0;
for (const it of seedItems) {
  if (cur.length && (cur.length >= ITEMS_PER_CALL || curImgs + it.imageUrls.length > IMAGES_PER_CALL)) {
    chunks.push(cur); cur = []; curImgs = 0;
  }
  cur.push(it); curImgs += it.imageUrls.length;
}
if (cur.length) chunks.push(cur);
console.log(`${chunks.length} ig-sync calls (oldest chunk first)`);

(async () => {
  let added = 0, errs = [];
  // seedItems is newest-first; the worker PREPENDS each call, so push the
  // OLDEST chunk first and the final catalog reads newest-first.
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const res = await fetch(`${API}/api/ig-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ items: chunk }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      console.error(`chunk ${i} FAILED: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
      errs.push({ chunk: i, status: res.status, body });
      // KV write quota (1101) or rate limit: stop rather than burn the day's quota
      if (res.status === 429 || JSON.stringify(body).includes('1101')) break;
    } else {
      added += body.added;
      if (body.errors && body.errors.length) errs.push(...body.errors);
      console.log(`chunk ${i}: +${body.added} (total ${added})${body.errors.length ? ' errors: ' + JSON.stringify(body.errors) : ''}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`DONE: ${added} items seeded, ${errs.length} errors`);
  if (errs.length) fs.writeFileSync(path.join(__dirname, '..', '.tmp', 'seed_errors.json'), JSON.stringify(errs, null, 1));
})();
