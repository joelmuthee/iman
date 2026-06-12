// Iman High Street API Worker
// Public:   GET  /api/bags          → { bags, settings }
//           GET  /img/:name         → image binary
// Admin:    POST /api/bulk          → replace { bags, settings }
//           POST /api/image         → upload image → { path }
//           POST /api/buyer         → forward buyer to GHL

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });

const isAuthed = (req, env) => {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  return env.ADMIN_TOKEN && auth.slice(7).trim() === env.ADMIN_TOKEN.trim();
};

// Master token = billing/agency only. Controls the suspend flag. The shop's
// ADMIN_TOKEN can NOT flip suspend, so the owner can't reactivate themselves.
const isMaster = (req, env) => {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  return env.MASTER_TOKEN && auth.slice(7).trim() === env.MASTER_TOKEN.trim();
};

// When the store is suspended (billing kill-switch), the owner keeps READ access
// to the admin but every WRITE is frozen. MASTER (agency) can still write so the
// store can be maintained while suspended. Returns a 403 Response when the caller
// is blocked, or null when the write may proceed. Authoritative gate: the admin
// UI also blocks these, but this is the real lock the owner can't bypass.
const suspendBlock = async (req, env) => {
  if (isMaster(req, env)) return null;
  if ((await env.BAGS.get("suspended")) === "1") {
    return json({ error: "account suspended; contact billing to restore the store" }, 403);
  }
  return null;
};

// SHA-256 hex helper for the owner password flow (Web Crypto, available in
// Workers). Used by /api/check-password and /api/set-password.
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const b64ToBytes = b64 => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// Decode HTML entities IG slathers across og:description and the embed Caption
// div. Named entities + decimal (&#064;) + hex (&#x40;). Per CATALOG-STANDARDS
// "Instagram quick-add — Caption pre-processing" rules. Mostly cosmetic for
// ryker (new-stock model, no @<price> parser) but keeps descriptions clean.
const decodeEntities = (s) => (s || "")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));

// ---- Caption → brand/category heuristics for IG bulk-sync ----
// Iman High Street is brand-new women's fashion (dresses, suits, blazers,
// heels, leather handbags) plus some formal pieces (ties, men's suits).
// Brands here span product types (YSL skirts, Balmain blazers, Ferragamo
// bags AND belts), so unlike the menswear template we detect TYPE first
// (drives the category) and BRAND second (decorates the name).
const TYPE_MAP = [
  // Suits — specific before generic
  ["skirt suit",        "Skirt Suit",   "Suits"],
  ["trouser suit",      "Trouser Suit", "Suits"],
  ["stretch suit",      "Stretch Suit", "Suits"],
  [/\bsuits?\b/,        "Suit",         "Suits"],
  // Blazers ("Blazes" is a recurring caption typo on this account)
  [/\bblaze[rs]?s?\b/,  "Blazer",       "Blazers"],
  // Dresses
  [/\bdress(es)?\b/,    "Dress",        "Dresses"],
  [/\bgowns?\b/,        "Gown",         "Dresses"],
  // Skirts
  [/\bskirts?\b/,       "Skirt",        "Skirts"],
  // Tops
  ["tube top",          "Tube Top",     "Tops"],
  [/\bblouses?\b/,      "Blouse",       "Tops"],
  [/\bt[\s-]?shirts?\b/,"T-Shirt",      "Tops"],
  [/\btees?\b/,         "T-Shirt",      "Tops"],
  [/\bpolos?\b/,        "Polo",         "Tops"],
  [/\bshirts?\b/,       "Shirt",        "Tops"],
  [/\btops?\b/,         "Top",          "Tops"],
  // Bottoms
  [/\bjeans?\b/,        "Jeans",        "Jeans"],
  [/\btrousers?\b/,     "Trousers",     "Trousers"],
  [/\bpants?\b/,        "Pants",        "Trousers"],
  [/\bkhakis?\b/,       "Khakis",       "Trousers"],
  // Footwear — heels get their own category on a women's shop
  [/\bheels?\b/,        "Heels",        "Heels"],
  [/\bstilettos?\b/,    "Stilettos",    "Heels"],
  [/\bwedges?\b/,       "Wedges",       "Heels"],
  [/\bsneakers?\b/,     "Sneakers",     "Shoes"],
  [/\btrainers?\b/,     "Sneakers",     "Shoes"],
  [/\bloafers?\b/,      "Loafers",      "Shoes"],
  [/\bsandals?\b/,      "Sandals",      "Shoes"],
  [/\bboots?\b/,        "Boots",        "Shoes"],
  [/\bshoes?\b/,        "Shoes",        "Shoes"],
  // Bags
  [/\bhandbags?\b/,     "Handbag",      "Handbags"],
  [/\btote\s?bags?\b/,  "Tote Bag",     "Handbags"],
  [/\bclutch(es)?\b/,   "Clutch",       "Handbags"],
  [/\bcross\s?body\b/,  "Crossbody Bag","Handbags"],
  [/\bbags?\b/,         "Bag",          "Handbags"],
  [/\bpurses?\b/,       "Purse",        "Handbags"],
  // Accessories
  [/\b(neck|power|bow)\s?ties?\b/, "Tie", "Accessories"],
  [/\bties?\b/,         "Tie",          "Accessories"],
  [/\bbelts?\b/,        "Belt",         "Accessories"],
  [/\bscar(f|ves)\b/,   "Scarf",        "Accessories"],
];
const BRAND_LIST = [
  ["ysl",               "YSL"],
  ["saint laurent",     "YSL"],
  ["balmain",           "Balmain"],
  ["d&g",               "D&G"],
  ["dolce",             "D&G"],
  ["ferragamo",         "Ferragamo"],
  ["ferragammo",        "Ferragamo"],   // recurring caption spelling
  ["zegna",             "Zegna"],
  ["gucci",             "Gucci"],
  ["louis vuitton",     "Louis Vuitton"],
  [/\blv\b/,            "Louis Vuitton"],
  ["prada",             "Prada"],
  ["chanel",            "Chanel"],
  ["dior",              "Dior"],
  ["versace",           "Versace"],
  ["fendi",             "Fendi"],
  ["hermes",            "Hermes"],
  ["valentino",         "Valentino"],
  ["jimmy choo",        "Jimmy Choo"],
  ["louboutin",         "Christian Louboutin"],
  ["armani",            "Armani"],
  ["hugo boss",         "Hugo Boss"],
  ["tom ford",          "Tom Ford"],
  ["gianfranco",        "Gianfranco Ferre"],
];

function deriveBrand(caption) {
  // NO leading-handle strip here: feed-API captions (/api/v1/feed/user/) carry
  // no handle prefix, so stripping would eat the first real product word. The
  // handle strip belongs only on embed-page captions (admin quick-add, client-side).
  // Multi-item captions are common here ("Balmain Blazer 21,000 / Ysl skirt
  // 21,000 / Tube top 2,500" across lines). The FIRST line names the item the
  // post is about, so type + brand resolve from the first line when it carries
  // a type; the whole caption is only the fallback scope.
  const whole = " " + (caption || "").toLowerCase().trim() + " ";
  const first = " " + (caption || "").toLowerCase().trim().split(/\n/)[0] + " ";
  const findType = (scope) => {
    for (const [key, label, cat] of TYPE_MAP) {
      if (key instanceof RegExp ? key.test(scope) : scope.includes(key)) return [label, cat];
    }
    return [null, null];
  };
  const findBrand = (scope) => {
    for (const [key, name] of BRAND_LIST) {
      if (key instanceof RegExp ? key.test(scope) : scope.includes(key)) return name;
    }
    return null;
  };
  let [typeLabel, category] = findType(first);
  let scope = first;
  if (!typeLabel) { [typeLabel, category] = findType(whole); scope = whole; }
  const brand = findBrand(scope);
  if (!typeLabel && !brand) return [null, null];
  const name = brand && typeLabel ? `${brand} ${typeLabel}` : (typeLabel || brand);
  return [name, category];
}

// Iman is NEW-STOCK. Captions on this account: "Ysl skirt available @21,000 /
// Size s,m,l,xl,xxl", "Sizes 6-14", "37, 38,39,40,41,42", "Sizes 48-58" (suits).
// Default qty=1 per detected size; owner adjusts in admin.
// Returns { name, category, stock: { sz: qty }, price, description }.
function parseCaptionForBag(caption) {
  const text = (caption || "").trim();
  const lower = text.toLowerCase();
  const cleaned = text.split(/whatsapp|whastup|wa\.me|0\d{8,}/i)[0].trim().replace(/[.\s]+$/, "");
  let [name, category] = deriveBrand(caption);
  if (!name) {
    const first = cleaned.split(/\.\.|\.\s|,|\n|·/)[0].trim();
    name = first ? first.slice(0, 60).replace(/\b\w/g, c => c.toUpperCase()) : "New Item";
  }

  const stock = {};

  // Strip price tokens BEFORE size scanning so "@21,000" can't bleed a "21"
  // into the size detection. Possessives ("colour's") must not read as size S.
  const noPrices = lower.replace(/\d{1,3}(?:[,. ]\d{3})+/g, " ").replace(/\b\d{1,3}k\b/g, " ").replace(/'s\b/g, " ");
  const padded = " " + noPrices.replace(/[,/&|·]+/g, " ").replace(/\s+/g, " ") + " ";

  // --- Letter sizes: XS..5XL, "2xl" variant, and ranges ("s-2xl", "s to xxl") ---
  const LETTERS = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
  const normLetter = (t) => { t = t.toUpperCase(); return t === "2XL" ? "XXL" : t === "XXXL" ? "3XL" : t; };
  const letterRange = noPrices.match(/\b(xs|s|m|l|xl|xxl|2xl|xxxl|3xl)\s*(?:-|–|to)\s*(xs|s|m|l|xl|xxl|2xl|xxxl|3xl)\b/);
  if (letterRange) {
    const a = LETTERS.indexOf(normLetter(letterRange[1]));
    const b = LETTERS.indexOf(normLetter(letterRange[2]));
    if (a >= 0 && b >= a) for (let i = a; i <= b; i++) stock[LETTERS[i]] = 1;
  } else {
    for (const sz of ["XS", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL", "S", "M", "L", "XL"]) {
      const re = new RegExp(`(?:^|\\s|[^a-z0-9])${sz.toLowerCase()}(?=$|\\s|[^a-z0-9])`);
      if (re.test(padded)) stock[normLetter(sz)] = 1;
    }
  }

  // --- Numeric sizes: three scales, told apart by value + context ---
  //   6-18 even  = UK women's dress sizes (dresses, suits, skirts, tops)
  //   35-46      = EU shoe sizes (footwear context wins) -> stored as EU<n>
  //   44-58 even = suit sizes when the caption reads suit/blazer
  const isFoot = /heels?|stilettos?|wedges?|sneakers?|trainers?|loafers?|sandals?|boots?|shoes?/i.test(text)
    || /^(Shoes|Heels)$/.test(category || "");
  const isSuit = /suits?|blaze[rs]/i.test(lower);
  const addShoe = (n) => { if (n >= 35 && n <= 46) stock[`EU${n}`] = 1; };
  const addDress = (n) => { if (n >= 6 && n <= 18 && n % 2 === 0) stock[String(n)] = 1; };
  const addSuit = (n) => { if (n >= 34 && n <= 58 && n % 2 === 0) stock[String(n)] = 1; };
  let m;
  const ranges = [];
  const rangeRe = /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/g;
  while ((m = rangeRe.exec(noPrices)) !== null) ranges.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
  for (const [a, b] of ranges) {
    if (b < a || b - a > 24) continue;
    if (isFoot && a >= 35 && b <= 46) { for (let n = a; n <= b; n++) addShoe(n); }
    else if (a >= 6 && b <= 18) { for (let n = a; n <= b; n++) addDress(n); }
    else if (isSuit && a >= 34 && b <= 58) { for (let n = a; n <= b; n++) addSuit(n); }
    else if (a >= 35 && b <= 46) { for (let n = a; n <= b; n++) addShoe(n); }
  }
  if (!ranges.length) {
    const numRe = /(?<![0-9])(\d{1,2})(?![0-9])/g;
    while ((m = numRe.exec(padded)) !== null) {
      const n = parseInt(m[1], 10);
      if (isFoot) addShoe(n);
      if (n >= 6 && n <= 18) addDress(n);
      else if (isSuit) addSuit(n);
      else if (!isFoot && n >= 35 && n <= 46) addShoe(n);
    }
  }

  // Footwear with real EU sizes: drop stray letter-size hits (e.g. the "L" in
  // "C L block heels") — a heel post never sells letter sizes alongside EU.
  if (isFoot && Object.keys(stock).some(k => k.startsWith("EU"))) {
    for (const k of Object.keys(stock)) if (LETTERS.includes(k)) delete stock[k];
  }

  if (!Object.keys(stock).length) stock["One Size"] = 1;

  // --- Who it's for: '' = both. Explicit words win; otherwise the category
  // and size scale decide (suit sizes 48-58 read as gents, dress sizes 6-18
  // as ladies, EU shoe range high vs low). Owner can override in admin.
  let gender = "";
  const sizeKeys = Object.keys(stock);
  const euSizes = sizeKeys.filter(k => k.startsWith("EU")).map(k => parseInt(k.slice(2), 10));
  if (/ladies|ladys?\b|\bwomen\b|\bwoman\b|\bgirls?\b|\bher\b/i.test(text)) gender = "ladies";
  else if (/\bgents?\b|gentlem[ae]n|\bmen'?s\b|for men\b|\bhim\b/i.test(text)) gender = "gents";
  else if (/^(Dresses|Skirts|Heels|Handbags)$/.test(category || "")) gender = "ladies";
  else if (sizeKeys.some(k => /^(48|5[02468])$/.test(k))) gender = "gents";
  else if (sizeKeys.some(k => /^(6|8|10|12|14|16|18)$/.test(k))) gender = "ladies";
  else if (euSizes.length && Math.max(...euSizes) >= 44) gender = "gents";
  else if (euSizes.length && Math.max(...euSizes) <= 42) gender = "ladies";

  // --- Price: "@21,000", "for 41,000", "27 000", "12.000", "30k". A RANGE
  // ("18k-20k", "between 35,000 to 51,000") means per-piece pricing -> 0
  // so the site shows "Price on request".
  let price = 0;
  const priceRange = /(?:between|ranging|ranges?\s+(?:from|between))\b/.test(lower)
    || /\d[\d,. ]*\s*(?:-|to)\s*\d{1,3}(?:[,.]\d{3}|k\b)/.test(lower);
  if (!priceRange) {
    const pm = lower.match(/(\d{1,3}(?:[,. ]\d{3})+)/) || lower.match(/\b(\d{2,3})k\b/);
    if (pm) {
      const tok = pm[1];
      const n = /k$/i.test(pm[0]) && tok.length <= 3 ? parseInt(tok, 10) * 1000 : parseInt(tok.replace(/[,. ]/g, ""), 10);
      if (n >= 500 && n <= 500000) price = n;
    }
  }

  // No "Pick your size below" in the default copy: most posts don't carry
  // configured sizes, so buyers just tap Check availability and say their
  // size in the WhatsApp chat (bags and accessories have no size at all).
  const sized = !/^(Handbags|Accessories)$/.test(category || "");
  const description = sized
    ? "Brand new, hand-picked for you. Photographed exactly as it is. Tap Check availability and tell us your size on WhatsApp."
    : "Brand new, hand-picked for you. Photographed exactly as it is. Tap Check availability to ask for it on WhatsApp.";
  return {
    name,
    category: category || null,
    stock,
    price,
    gender,
    description,
  };
}

// Is this caption plausibly a product post?
function looksLikeProduct(caption) {
  if (!caption) return false;
  const lower = caption.toLowerCase();
  // Size signal (letter sizes, dress sizes "6-14", EU shoe sizes "36-43")
  if (/(?:^|\s|[,/|·])(?:xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[,/|·])/i.test(" " + lower + " ")) return true;
  if (/\bsizes?\s*[:\-]?\s*\d/i.test(lower)) return true;
  if (/\bsizes?\s+(?:range|xs|s|m|l|xl)/i.test(lower)) return true;
  for (const [key] of TYPE_MAP) {
    if (key instanceof RegExp ? key.test(lower) : lower.includes(key)) return true;
  }
  for (const [key] of BRAND_LIST) {
    if (key instanceof RegExp ? key.test(lower) : lower.includes(key)) return true;
  }
  return false;
}

// ---- IG response normalisers (module-level so endpoints share them) ----
function extractFromTimelineNode(node) {
  const shortcode = node.shortcode || node.code;
  let imageUrls = [];
  const children = node.edge_sidecar_to_children?.edges || [];
  if (children.length) {
    imageUrls = children.map(({ node: c }) => c.display_url || c.image_versions2?.candidates?.[0]?.url).filter(Boolean);
  } else if (node.display_url) {
    imageUrls = [node.display_url];
  } else if (node.image_versions2?.candidates?.length) {
    imageUrls = [node.image_versions2.candidates[0].url];
  }
  const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || node.caption?.text || "";
  return {
    shortcode,
    imageUrl: imageUrls[0],
    imageUrls,
    caption,
    isCarousel: imageUrls.length > 1,
    postUrl: `https://www.instagram.com/p/${shortcode}/`,
    takenAt: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : (node.taken_at ? new Date(node.taken_at * 1000).toISOString() : null),
  };
}

function extractFromFeedItem(m) {
  const carousel = m.carousel_media || [];
  let imageUrls = [];
  if (carousel.length) {
    imageUrls = carousel.map(c => c.image_versions2?.candidates?.[0]?.url).filter(Boolean);
  } else if (m.image_versions2?.candidates?.length) {
    imageUrls = [m.image_versions2.candidates[0].url];
  }
  const shortcode = m.code;
  const caption = m.caption?.text || "";
  return {
    shortcode,
    imageUrl: imageUrls[0],
    imageUrls,
    caption,
    isCarousel: imageUrls.length > 1,
    postUrl: `https://www.instagram.com/p/${shortcode}/`,
    takenAt: m.taken_at ? new Date(m.taken_at * 1000).toISOString() : null,
  };
}

// 3-tier IG feed pull: embedded timeline → GraphQL pagination → /api/v1/feed/user/.
// Always prefer user_id over username — username triggers a rate-limited profile call.
async function fetchIgFeed({ username, userId: directUserId, count = 50, maxId = "" } = {}) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://www.instagram.com/${username || ""}/`,
  };
  let userId, user = null, profile = null;
  if (directUserId) {
    userId = directUserId;
    profile = { id: userId, username: username || null };
  } else {
    const pRes = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, { headers });
    if (!pRes.ok) return { error: `profile lookup ${pRes.status}` };
    const pData = await pRes.json();
    user = pData?.data?.user;
    if (!user?.id) return { error: "user id not found" };
    userId = user.id;
    profile = {
      id: userId,
      username: user.username,
      fullName: user.full_name,
      biography: user.biography,
      profilePicUrl: user.profile_pic_url_hd || user.profile_pic_url,
      followers: user.edge_followed_by?.count,
    };
  }
  const qsTail = `?count=${count}${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ""}`;
  let items = [];
  let moreAvailable = false;
  let nextMaxId = null;
  const embedded = user?.edge_owner_to_timeline_media;
  if (!maxId && embedded?.edges?.length) {
    items = embedded.edges.map(({ node }) => extractFromTimelineNode(node)).filter(it => it.imageUrl);
    moreAvailable = !!embedded.page_info?.has_next_page;
    nextMaxId = embedded.page_info?.end_cursor || null;
  }
  if (items.length < count && (maxId || moreAvailable || directUserId)) {
    const cursor = maxId || nextMaxId;
    const variables = encodeURIComponent(JSON.stringify({ id: userId, first: count, after: cursor || null }));
    const gqlRes = await fetch(`https://www.instagram.com/graphql/query/?query_hash=003056d32c2554def87228bc3fd9668a&variables=${variables}`, { headers });
    if (gqlRes.ok) {
      const gData = await gqlRes.json();
      const media = gData?.data?.user?.edge_owner_to_timeline_media;
      if (media?.edges?.length) {
        items = items.concat(media.edges.map(({ node }) => extractFromTimelineNode(node)).filter(it => it.imageUrl));
        moreAvailable = !!media.page_info?.has_next_page;
        nextMaxId = media.page_info?.end_cursor || null;
      }
    }
  }
  if (!items.length) {
    let fRes = await fetch(`https://www.instagram.com/api/v1/feed/user/${userId}/${qsTail}`, { headers });
    if (!fRes.ok) fRes = await fetch(`https://i.instagram.com/api/v1/feed/user/${userId}/${qsTail}`, { headers });
    if (!fRes.ok) return { error: `feed fetch ${fRes.status}`, profile };
    const fData = await fRes.json();
    items = (fData.items || []).map(extractFromFeedItem).filter(it => it.imageUrl);
    moreAvailable = !!fData.more_available;
    nextMaxId = fData.next_max_id || null;
  }
  return { profile, items, count: items.length, more_available: moreAvailable, next_max_id: nextMaxId };
}

// Base64-encode a Uint8Array in chunks (avoids call-stack overflow on large images).
function arrayToB64(buf) {
  let s = "";
  const CHUNK = 8192;
  for (let i = 0; i < buf.length; i += CHUNK) {
    s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// Vision-model classifier — Llama 3.2 11B Vision sees the photo so it can
// distinguish polos vs t-shirts vs shirts, sneakers vs boots vs formal shoes.
// Returns { is_product, name, category, reason, via } or { _debug } on failure.
async function classifyPostWithVision(env, caption, imageUrl) {
  if (!env.AI || !imageUrl) return null;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return { _debug: `img fetch ${imgRes.status}` };
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const trimmed = (caption || "").replace(/\s+/g, " ").slice(0, 400);
    const prompt = `You sort Instagram posts from Iman High Street, a Nairobi shop selling brand-new women's fashion (dresses, suits, blazers, heels, leather handbags) plus some formal pieces for men (suits, ties, leather shoes). You're given ONE photo + ONE caption. Decide:
1. Is this a single product (one specific item or one stocked SKU) for sale? (is_product true|false)
2. What brand / item is it? (name, short, e.g. "YSL Skirt", "Balmain Blazer", "Ferragamo Bag", or "New Item" if unknown)
3. What category? Pick EXACTLY one from this list, never invent another:
   Dresses, Suits, Blazers, Tops, Skirts, Trousers, Jeans, Shoes, Heels, Handbags, Accessories

Category guide (look carefully):
- Dresses: one-piece dresses and gowns, any length.
- Suits: matched sets, skirt suits, trouser suits, men's two-piece suits.
- Blazers: a blazer or jacket sold on its own (not as a matched set).
- Tops: blouses, tube tops, shirts, t-shirts, polos, camisoles.
- Skirts: a skirt on its own.
- Trousers: pants, khakis, office trousers (NOT denim).
- Jeans: denim trousers, any wash.
- Heels: block heels, stilettos, wedges, pumps, any heeled shoe.
- Shoes: flat or low footwear, sneakers, loafers, sandals, boots, men's leather shoes.
- Handbags: handbags, totes, clutches, crossbody bags, purses.
- Accessories: ties, bow ties, belts, scarves, jewellery.

is_product=false ONLY for: shop intros, marketing banners, owner photos, customer photos, throwbacks, holiday greetings, "DM us" announcements without a specific item.

Caption: """${trimmed}"""

Reply with strict minified JSON, no prose, no code fences:
{"is_product":true|false,"name":"<brand+item or New Item>","category":"<exactly one from the list>","reason":"<3-6 words>"}`;
    const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      prompt,
      image: Array.from(imgBytes),
      max_tokens: 220,
      temperature: 0.1,
    });
    let parsed = null;
    if (result?.response && typeof result.response === "object") {
      parsed = result.response;
    } else {
      let text = "";
      if (typeof result?.response === "string") text = result.response;
      else if (typeof result?.description === "string") text = result.description;
      else if (typeof result === "string") text = result;
      text = text.trim();
      if (text) {
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) {
          try { parsed = JSON.parse(m[0]); } catch (_) {}
        }
      }
    }
    if (!parsed) return { _debug: "could not parse vision output", raw: JSON.stringify(result).slice(0, 400) };
    return {
      is_product: !!(parsed.is_product ?? parsed.is_shoe ?? parsed.is_item),
      name: parsed.name || null,
      category: parsed.category || null,
      reason: parsed.reason || "",
      via: "vision",
    };
  } catch (err) {
    return { _debug: `vision throw: ${err.message}` };
  }
}

// Text-only LLM classifier — fallback when vision call fails. Best for decoding
// caption shorthand (brand names) when the photo can't carry the call.
async function classifyPostWithAi(env, caption) {
  if (!env.AI || !caption) return null;
  const trimmed = caption.replace(/\s+/g, " ").slice(0, 400);
  const prompt = `You sort Instagram posts from Iman High Street, a Nairobi shop selling brand-new women's fashion (dresses, suits, blazers, heels, leather handbags) plus some formal pieces for men (suits, ties, leather shoes). Each post is either ONE specific product (or one stocked SKU) listed for sale, OR a non-product post.

Reply with strict minified JSON only, no prose, no code fences.

Schema:
{"is_product": true|false, "name": "<short brand + item OR generic descriptor>", "category": "<exactly one of: Dresses, Suits, Blazers, Tops, Skirts, Trousers, Jeans, Shoes, Heels, Handbags, Accessories>", "reason": "<3-6 words>"}

Rules:
- is_product = true when the caption mentions a fashion item and at least one size signal ("Sizes 6-14", "s,m,l,xl", "37,38,39", "Sizes 48-58") OR a price ("@21,000") OR a known brand.
- is_product = false for shop intros, owner/customer photos, throwbacks, marketing banners, holiday greetings, generic "DM us" posts with no specific product.
- Decode shorthand: "Ysl" = YSL; "D&G" = Dolce & Gabbana; "Ferragammo" = Ferragamo (typo); "C L" at the start of a shoe caption = Christian Louboutin.
- name MUST be brand+item when known ("YSL Skirt", "Balmain Suit"). Strip prices, sizes, phone numbers, hashtags. If brand unknown but item type clear, name = generic description (e.g. "Stretchy Red Dress", "Block Heels"). If truly unknown, name = "New Item".
- category: match to the EXACT list. Heeled footwear is Heels, never Shoes. Any bag is Handbags. Matched sets are Suits; a lone blazer is Blazers.

Caption: """${trimmed}"""`;
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 160,
    });
    const text = (result?.response || "").trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return {
      is_product: !!(parsed.is_product ?? parsed.is_shoe ?? parsed.is_item),
      name: parsed.name || null,
      category: parsed.category || null,
      reason: parsed.reason || "",
    };
  } catch (_) {
    return null;
  }
}

// Iman stocks women's fashion + formal pieces. Coerce any AI-suggested
// category outside the allowed list to the closest legal option or null.
const IMAN_CATEGORIES = new Set([
  "Dresses","Suits","Blazers","Tops","Skirts","Trousers","Jeans",
  "Shoes","Heels","Handbags","Accessories",
]);
function coerceCategory(c) {
  if (!c) return null;
  const raw = String(c).trim();
  if (IMAN_CATEGORIES.has(raw)) return raw;
  const lower = raw.toLowerCase();
  if (/^(dress(es)?|gowns?)$/i.test(lower)) return "Dresses";
  if (/^((skirt|trouser|stretch)\s*suits?|suits?|two[\s-]?piece(\s*sets?)?)$/i.test(lower)) return "Suits";
  if (/^(blazers?|jackets?|coats?)$/i.test(lower)) return "Blazers";
  if (/^(tops?|blouses?|tube\s*tops?|t[\s-]?shirts?|tees?|polos?|shirts?|camis(oles?)?)$/i.test(lower)) return "Tops";
  if (/^skirts?$/i.test(lower)) return "Skirts";
  if (/^(trousers?|pants?|khakis?|chinos?|slacks?)$/i.test(lower)) return "Trousers";
  if (/^(jeans?|denim)$/i.test(lower)) return "Jeans";
  if (/^(heels?|stilettos?|wedges?|pumps?|block\s*heels?)$/i.test(lower)) return "Heels";
  if (/^(shoes?|sneakers?|trainers?|loafers?|sandals?|boots?|flats?|moccasins?)$/i.test(lower)) return "Shoes";
  if (/^(hand\s?bags?|bags?|tote(\s*bags?)?|clutch(es)?|cross\s*body(\s*bags?)?|purses?|sling\s*bags?|hobos?)$/i.test(lower)) return "Handbags";
  if (/^(accessor(y|ies)|(neck|power|bow)?\s*ties?|belts?|scar(f|ves)|jewell?ery)$/i.test(lower)) return "Accessories";
  // Don't invent — return null so the owner picks
  return null;
}

// ---- Daily closing report (WhatsApp via WaSender) ----
// Once a day the scheduled() cron reads the day's sales + insights from KV,
// builds a plain-language summary, and WhatsApps it to the owner. Config lives
// in its OWN KV key "reportcfg" = { phone, enabled } — never in "data" (which
// is public via /api/bags). WaSender token is a worker secret WASENDER_TOKEN.
const SHOP_NAME = "Iman High Street";          // per-fork: shop's display name
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;      // Africa/Nairobi = UTC+3, no DST

// EAT calendar date (YYYY-MM-DD) for an epoch-ms instant
const eatDateKey = (ms) => new Date(ms + EAT_OFFSET_MS).toISOString().slice(0, 10);
const fmtKshReport = (n) => "Ksh " + Number(n || 0).toLocaleString("en-US");

// WaSender wants a bare MSISDN. Storage may be 07.., 7.., +254.., 254..
function waNormPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "254" + d.slice(1);
  else if (d.startsWith("7") || d.startsWith("1")) d = "254" + d;
  return d;
}

// Build the owner's report text for "today" (EAT) from the data + stats blobs.
function buildDailyReport(data, stats, nowMs) {
  const today = eatDateKey(nowMs);
  const bags = Array.isArray(data.bags) ? data.bags : [];
  let count = 0, units = 0, revenue = 0, cash = 0, mpesa = 0;
  const perItem = {};
  for (const b of bags) {
    for (const s of (b.sales || [])) {
      if (!s || !s.soldAt || eatDateKey(Date.parse(s.soldAt)) !== today) continue;
      const qty = Number(s.qty) || 1;
      const amt = (Number(s.salePrice) || 0) * qty;
      count++; units += qty; revenue += amt;
      if (s.paymentMethod === "mpesa") mpesa += amt; else cash += amt;
      perItem[b.name] = (perItem[b.name] || 0) + qty;
    }
  }
  const low = [];
  for (const b of bags) {
    const st = b.stock && typeof b.stock === "object" ? b.stock : null;
    if (!st || !Object.keys(st).length) continue;
    const total = Object.values(st).reduce((a, n) => a + (Number(n) || 0), 0);
    if (total >= 1 && total <= 3) low.push(`${b.name} (${total} left)`);
  }
  const topItems = Object.entries(perItem).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, q]) => `${n} x${q}`);
  const noRes = (stats && stats.searchNoResults) || {};
  const wanted = Object.entries(noRes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

  const L = [`*${SHOP_NAME} — today's report*`, today, ""];
  if (count === 0) {
    L.push("No sales recorded today yet.");
  } else {
    L.push(`🧾 ${count} ${count === 1 ? "sale" : "sales"} · ${units} ${units === 1 ? "item" : "items"}`);
    L.push(`💰 ${fmtKshReport(revenue)}`);
    L.push(`   💵 Cash ${fmtKshReport(cash)} · 📱 M-Pesa ${fmtKshReport(mpesa)}`);
    if (topItems.length) L.push(`🔥 Top: ${topItems.join(", ")}`);
  }
  if (low.length) { L.push(""); L.push(`📦 Low stock: ${low.slice(0, 5).join(", ")}`); }
  if (wanted.length) { L.push(""); L.push(`🔎 Searched but not found: ${wanted.join(", ")}`); }
  return L.join("\n");
}

async function sendViaWaSender(env, phone, text) {
  const token = (env.WASENDER_TOKEN || "").trim();
  if (!token) return { ok: false, error: "WASENDER_TOKEN not set" };
  const to = waNormPhone(phone);
  if (!to) return { ok: false, error: "no phone" };
  try {
    const r = await fetch("https://wasenderapi.com/api/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ to, text }),
    });
    const body = await r.text().catch(() => "");
    return { ok: r.ok, status: r.status, body: body.slice(0, 300) };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function runDailyReport(env, force) {
  let cfg;
  try { cfg = JSON.parse(await env.BAGS.get("reportcfg")) || {}; } catch { cfg = {}; }
  if (!force && !cfg.enabled) return { ok: false, skipped: "disabled" };
  if (!cfg.phone) return { ok: false, skipped: "no phone" };
  let data, stats;
  try { data = JSON.parse(await env.BAGS.get("data")) || {}; } catch { data = {}; }
  try { stats = JSON.parse(await env.BAGS.get("stats")) || {}; } catch { stats = {}; }
  return await sendViaWaSender(env, cfg.phone, buildDailyReport(data, stats, Date.now()));
}

// ---- IG auto-sync (cron) ----
// Same pipeline as the admin's "Check for new posts" widget, minus the human
// review step: fetch the feed, AI-classify (heuristic + vision + text), parse
// name/category/sizes/price/gender from the caption, download the cover image
// into KV, prepend to the catalog. Runs every morning so new IG posts appear
// on the site by themselves; the owner can still edit/delete from the admin.
// Caps at AUTOSYNC_MAX_ITEMS per run to stay inside the free tier's ~50
// subrequests per invocation (feed + 2 AI calls per candidate + 1 image fetch
// + 2 KV puts per item) — a backlog simply drains over consecutive mornings.
// Kill switch: KV key `autosync` = {"enabled":false}. Suspended shops skip.
const IG_AUTOSYNC_USER_ID = "51870726026"; // @iman_high_street
const API_ORIGIN = "https://iman-high-street-api.stawisystems.workers.dev";
const AUTOSYNC_MAX_ITEMS = 5;

async function runIgAutoSync(env) {
  if ((await env.BAGS.get("suspended")) === "1") return { ok: false, skipped: "suspended" };
  let cfg;
  try { cfg = JSON.parse(await env.BAGS.get("autosync")) || {}; } catch { cfg = {}; }
  if (cfg.enabled === false) return { ok: false, skipped: "disabled" };

  const existingRaw = await env.BAGS.get("data");
  const data = existingRaw ? JSON.parse(existingRaw) : { bags: [], settings: {} };
  const existingIds = new Set((data.bags || []).map(b => b.id));

  const feed = await fetchIgFeed({ userId: IG_AUTOSYNC_USER_ID, count: 24 });
  if (!feed.items) return { ok: false, error: feed.error || "feed empty" };

  // A few extra candidates beyond the cap so non-product posts don't eat the run.
  const fresh = feed.items
    .filter(it => it.imageUrl && it.shortcode && !existingIds.has(`ig_${it.shortcode}`))
    .slice(0, AUTOSYNC_MAX_ITEMS + 3);

  const newBags = [];
  const skipped = [];
  for (const it of fresh) {
    if (newBags.length >= AUTOSYNC_MAX_ITEMS) break;
    const heuristic = looksLikeProduct(it.caption);
    const [vision, text] = await Promise.all([
      classifyPostWithVision(env, it.caption, it.imageUrl),
      classifyPostWithAi(env, it.caption),
    ]);
    const visionOk = vision && !vision._debug;
    const isProduct = heuristic || (visionOk && vision.is_product) || (text && text.is_product);
    if (!isProduct) { skipped.push({ shortcode: it.shortcode, reason: "not a product" }); continue; }

    // Same name/category resolution order as /api/ig-discover.
    const sug = parseCaptionForBag(it.caption);
    const looksLikeFragment = (n) => !n || /^(size|sizes|tn|hh|nb)$/i.test(String(n).trim());
    let name = sug.name;
    if (text?.is_product && !looksLikeFragment(text.name) && text.name !== "New Item") {
      name = text.name.trim();
    } else if (visionOk && vision.is_product && !looksLikeFragment(vision.name) && vision.name !== "New Item") {
      name = vision.name.trim();
    }
    let category = coerceCategory(sug.category);
    if (visionOk && vision.is_product && vision.category) {
      const c = coerceCategory(vision.category);
      if (c) category = c;
    } else if (text?.is_product && text.category) {
      const c = coerceCategory(text.category);
      if (c) category = c;
    }
    if (!category) category = "Dresses";

    // Cover image only on auto-sync (cheapest safe budget); the owner can add
    // carousel extras from the admin's edit form whenever they want.
    try {
      const r = await fetch(it.imageUrl);
      if (!r.ok) throw new Error(`image fetch ${r.status}`);
      const b64 = arrayToB64(new Uint8Array(await r.arrayBuffer()));
      const fname = `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      await env.BAGS.put(`img:${fname}`, b64);
      await env.BAGS.put(`mime:${fname}`, "image/jpeg");

      const stock = Object.keys(sug.stock || {}).length ? sug.stock : { "One Size": 1 };
      const bag = {
        id: `ig_${it.shortcode}`,
        name: (name || "New Item").slice(0, 80),
        category,
        description: sug.description,
        price: sug.price > 0 ? sug.price : 0,
        stock,
        sales: [],
        image: `${API_ORIGIN}/img/${fname}`,
        createdAt: it.takenAt || new Date().toISOString(),
        instagramUrl: `https://www.instagram.com/p/${it.shortcode}/`,
        autoSynced: true,
      };
      if (sug.gender === "ladies" || sug.gender === "gents") bag.gender = sug.gender;
      newBags.push(bag);
      existingIds.add(bag.id);
    } catch (e) {
      skipped.push({ shortcode: it.shortcode, reason: e.message });
    }
  }

  if (newBags.length) {
    data.bags = newBags.concat(data.bags);
    await env.BAGS.put("data", JSON.stringify(data));
  }
  return { ok: true, added: newBags.length, names: newBags.map(b => b.name), skipped };
}

export default {
  // Cloudflare Cron Triggers (see wrangler.toml [triggers]).
  //   "0 6 * * *"  = 09:00 EAT → IG auto-sync (new posts add themselves)
  //   "0 17 * * *" = 20:00 EAT → daily WhatsApp report (no-ops unless enabled)
  async scheduled(event, env, ctx) {
    if (event.cron === "0 6 * * *") {
      ctx.waitUntil(runIgAutoSync(env));
      return;
    }
    ctx.waitUntil(runDailyReport(env, false));
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    // Public: catalog data
    if (request.method === "GET" && path === "/api/bags") {
      const raw = await env.BAGS.get("data");
      const data = raw ? JSON.parse(raw) : { bags: [], settings: {} };
      // Billing kill-switch: stored in its own KV key so the owner's admin
      // publishes (which only write "data") can never clear it.
      data.suspended = (await env.BAGS.get("suspended")) === "1";
      // PRIVACY: strip buyer PII (sales[].buyerName/buyerPhone/notes, soldTo) for
      // unauthed callers. The storefront only reads sold/price/salePrice/sales.length,
      // never buyer details. The admin sends a Bearer token and gets the full data.
      const admin = isAuthed(request, env);
      if (!admin && Array.isArray(data.bags)) {
        data.bags = data.bags.map(b => {
          if (!b || typeof b !== "object") return b;
          let nb = b;
          if ("soldTo" in nb) { const { soldTo, ...r } = nb; nb = r; }
          if (Array.isArray(nb.sales)) nb = { ...nb, sales: nb.sales.map(s => {
            if (!s || typeof s !== "object") return s;
            const { buyerName, buyerPhone, notes, name, phone, buyer, ...keep } = s;
            return keep;
          }) };
          return nb;
        });
      }
      // The manually-added clients list is owner-only CRM data (names + phones) —
      // never expose it publicly. Admin (Bearer) keeps it for the Clients tab.
      if (!admin && data.clients) delete data.clients;
      return json(data, 200, admin ? { "Cache-Control": "no-store" } : { "Cache-Control": "public, max-age=10" });
    }

    // Billing only: flip the suspend flag. Authed by MASTER_TOKEN (not the shop admin token).
    if (request.method === "POST" && path === "/api/suspend") {
      if (!isMaster(request, env)) return json({ error: "unauthorized" }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const suspended = !!body.suspended;
      await env.BAGS.put("suspended", suspended ? "1" : "0");
      return json({ ok: true, suspended });
    }

    // Public: serve images
    const imgMatch = path.match(/^\/img\/(.+)$/);
    if (request.method === "GET" && imgMatch) {
      const name = decodeURIComponent(imgMatch[1]);
      const b64 = await env.BAGS.get(`img:${name}`);
      if (!b64) return new Response("Not found", { status: 404, headers: CORS });
      const mime = (await env.BAGS.get(`mime:${name}`)) || "image/jpeg";
      return new Response(b64ToBytes(b64), {
        status: 200,
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable", ...CORS },
      });
    }

    // Per-item share page for WhatsApp/social link previews. The catalog Enquire
    // link ends with `${API_BASE}/p/<id>`; WhatsApp crawls this HTML, reads the OG
    // tags, and renders a preview card with the product photo + name + price.
    // A bare image URL doesn't preview reliably; an OG-tagged page always does.
    if (request.method === "GET" && path.startsWith("/p/")) {
      const SITE = "https://iman.essenceautomations.com";
      const esc = (s) => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const id = decodeURIComponent(path.slice(3));
      const raw = await env.BAGS.get("data");
      const bags = raw ? (JSON.parse(raw).bags || []) : [];
      const item = bags.find(b => b.id === id);
      if (!item) return Response.redirect(SITE + "/#shop", 302);
      const img = item.image || (item.images && item.images[0]) || `${SITE}/images/og-image.jpg`;
      const mime = /\.png$/i.test(img) ? "image/png" : /\.webp$/i.test(img) ? "image/webp" : "image/jpeg";
      const price = item.price > 0 ? ` · Ksh ${Number(item.price).toLocaleString("en-US")}` : "";
      const title = esc(item.name + price);
      const desc = esc((item.description || "Brand new ladies and men's fashion in Nairobi. Tap to view and ask on WhatsApp.").slice(0, 160));
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Iman High Street">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:secure_url" content="${esc(img)}">
<meta property="og:image:type" content="${mime}">
<meta property="og:image:width" content="1080">
<meta property="og:image:height" content="1080">
<meta property="og:url" content="${SITE}/#shop">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:image" content="${esc(img)}">
<title>${title} · Iman High Street</title>
<meta http-equiv="refresh" content="0; url=${SITE}/#shop">
</head><body style="font-family:system-ui;background:#0d0a07;color:#e8dcc4;text-align:center;padding:40px">Opening Iman High Street…</body></html>`;
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
    }

    if (path === "/api/health") return json({ ok: true, time: new Date().toISOString() });

    // Owner password — check via worker so the same flow works on every device.
    // Owner password stored as SHA-256 hex in KV "adminpass"; empty KV → fall
    // back to FALLBACK_OWNER_PASSWORD so a fresh install can sign in. Master
    // logins (MASTER_PASSWORD / MASTER_TOKEN) ALWAYS work for agency recovery.
    if (request.method === "POST" && path === "/api/check-password") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const pw = String(body.password || "");
      if (!pw) return json({ ok: false, source: null });
      const mp = (env.MASTER_PASSWORD || "").trim();
      const mt = (env.MASTER_TOKEN || "").trim();
      if ((mp && pw === mp) || (mt && pw === mt)) return json({ ok: true, source: "master" });
      const stored = await env.BAGS.get("adminpass");
      const hashHex = await sha256Hex(pw);
      if (stored) {
        return json({ ok: stored === hashHex, source: stored === hashHex ? "owner" : null });
      }
      const FALLBACK_OWNER_PASSWORD = "iman123";
      return json({ ok: pw === FALLBACK_OWNER_PASSWORD, source: pw === FALLBACK_OWNER_PASSWORD ? "owner" : null });
    }

    if (request.method === "POST" && path === "/api/set-password") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const current = String(body.current || "");
      const next = String(body.next || "");
      if (!next || next.length < 8) return json({ error: "new password must be at least 8 characters" }, 400);
      const mp = (env.MASTER_PASSWORD || "").trim();
      const mt = (env.MASTER_TOKEN || "").trim();
      let ok = (mp && current === mp) || (mt && current === mt);
      if (!ok) {
        const stored = await env.BAGS.get("adminpass");
        const curHash = await sha256Hex(current);
        if (stored) ok = stored === curHash;
        else ok = current === "iman123";
      }
      if (!ok) return json({ error: "current password is wrong" }, 401);
      await env.BAGS.put("adminpass", await sha256Hex(next));
      return json({ ok: true });
    }

    // Buyer → GHL proxy
    if (request.method === "POST" && path === "/api/buyer") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const { name, phone } = body;
      if (!name && !phone) return json({ error: "name or phone required" }, 400);
      // GHL forwarding is a paid feature this client doesn't have yet. Ack
      // without forwarding (privacy: never post buyers to another client's
      // CRM). The admin records every sale + buyer to KV regardless. When the
      // client upgrades, wire their own GHL locationId/formId here.
      return json({ ok: true, forwarded: false });
    }

    // ---- Insights: site-wide event tracking (aggregated in KV) ----
    // Public visitors POST events here; the admin reads the aggregate back.
    // Unlike the old per-browser localStorage counters, this sums every
    // visitor on every device into one shared tally under the "stats" key.
    const TRACK_METRICS = new Set(["itemViews", "itemEnquiries", "itemWishlist", "itemIgClicks", "searchNoResults"]);
    if (request.method === "POST" && path === "/api/track") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const metric = String(body.metric || "");
      const key = String(body.key || "").slice(0, 80).trim();
      if (!TRACK_METRICS.has(metric) || !key) return json({ error: "bad metric/key" }, 400);
      // KV read-modify-write. Low-traffic shop, so the occasional lost
      // concurrent increment is acceptable; KV has no atomic counter.
      let stats;
      try { stats = JSON.parse(await env.BAGS.get("stats")) || {}; } catch { stats = {}; }
      stats[metric] = stats[metric] || {};
      // Cap free-text search keys so a bot can't bloat the blob unbounded.
      if (metric === "searchNoResults" && !(key in stats[metric]) && Object.keys(stats[metric]).length >= 800) {
        return json({ ok: true, capped: true });
      }
      stats[metric][key] = (stats[metric][key] || 0) + 1;
      stats._lastUpdated = new Date().toISOString();
      await env.BAGS.put("stats", JSON.stringify(stats));
      return json({ ok: true });
    }

    // Admin: read aggregated site-wide insights
    if (request.method === "GET" && path === "/api/insights") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      let stats;
      try { stats = JSON.parse(await env.BAGS.get("stats")) || {}; } catch { stats = {}; }
      return json(stats);
    }

    // Admin: reset aggregated insights (clears the shop-wide tally)
    if (request.method === "POST" && path === "/api/insights-reset") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const blocked = await suspendBlock(request, env); if (blocked) return blocked;
      await env.BAGS.put("stats", JSON.stringify({ _lastUpdated: new Date().toISOString() }));
      return json({ ok: true });
    }

    // Daily report config — owner sets their phone + on/off. Stored in its own
    // KV key (NOT "data"), so it's never exposed by the public /api/bags.
    if (path === "/api/report-config") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      if (request.method === "GET") {
        let cfg; try { cfg = JSON.parse(await env.BAGS.get("reportcfg")) || {}; } catch { cfg = {}; }
        return json({ phone: cfg.phone || "", enabled: !!cfg.enabled });
      }
      if (request.method === "POST") {
        const blocked = await suspendBlock(request, env); if (blocked) return blocked;
        let body; try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
        const cfg = { phone: String(body.phone || "").trim(), enabled: !!body.enabled };
        await env.BAGS.put("reportcfg", JSON.stringify(cfg));
        return json({ ok: true, ...cfg });
      }
    }

    // Owner-triggered "send a test report right now" (also used to preview copy).
    // Admin: run the IG auto-sync on demand (same code the morning cron runs).
    if (request.method === "POST" && path === "/api/autosync-run") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const blocked = await suspendBlock(request, env); if (blocked) return blocked;
      const res = await runIgAutoSync(env);
      return json(res, res.ok ? 200 : 400);
    }

    if (request.method === "POST" && path === "/api/report-test") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const blocked = await suspendBlock(request, env); if (blocked) return blocked;
      const res = await runDailyReport(env, true);
      return json(res, res.ok ? 200 : 400);
    }

    // Admin: replace all data
    if (request.method === "POST" && path === "/api/bulk") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const blocked = await suspendBlock(request, env); if (blocked) return blocked;
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      if (!Array.isArray(body.bags)) return json({ error: "bags must be array" }, 400);
      // Empty-publish guard: a stray test call with bags:[] would silently wipe
      // the live catalogue (no KV history). Explicit force:true required.
      if (body.bags.length === 0 && body.force !== true) {
        return json({ error: "refusing to publish an empty catalogue; pass force:true if intentional" }, 400);
      }
      const payload = {
        bags: body.bags,
        settings: body.settings || {},
      };
      if (Array.isArray(body.sets)) payload.sets = body.sets;
      if (Array.isArray(body.clients)) payload.clients = body.clients;
      await env.BAGS.put("data", JSON.stringify(payload));
      return json({ ok: true, count: body.bags.length, sets: payload.sets?.length || 0 });
    }

    // Admin: upload image
    if (request.method === "POST" && path === "/api/image") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const blocked = await suspendBlock(request, env); if (blocked) return blocked;
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const { base64, ext } = body;
      if (!base64) return json({ error: "base64 required" }, 400);
      const safeExt = (ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const name = `item_${Date.now()}.${safeExt}`;
      const mime = safeExt === "png" ? "image/png" : safeExt === "webp" ? "image/webp" : "image/jpeg";
      await env.BAGS.put(`img:${name}`, base64);
      await env.BAGS.put(`mime:${name}`, mime);
      return json({ path: `/img/${name}`, name });
    }

    // ---- IG quick-add: server-side fetch of an Instagram public post ----
    // Lets the admin paste an IG URL and auto-fill the form (name, image, caption).
    // We can't fetch IG from a browser due to CORS; the Worker is server-side so it can.
    if (request.method === "GET" && path === "/api/ig-fetch") {
      const igUrl = url.searchParams.get("url");
      if (!igUrl) return json({ error: "url required" }, 400);

      // Accept all IG public URL shapes that carry a shortcode:
      //   /p/<code>/         photo posts
      //   /reel/<code>/      single reel
      //   /reels/<code>/     plural — some share sheets emit this
      //   /tv/<code>/        IGTV
      //   /share/reel/<code>/, /share/p/<code>/   share-sheet shortlinks
      const m = igUrl.match(/instagram\.com\/(?:share\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
      if (!m) return json({ error: "not an Instagram post URL" }, 400);
      const code = m[1];

      const headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      };

      try {
        let caption = "", imageUrl = "", imageUrls = [];

        // Try the embed page first (designed to be embeddable, more bot-friendly)
        const embedRes = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, { headers });
        if (embedRes.ok) {
          const html = await embedRes.text();
          const img = html.match(/<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src=["']([^"']+)["']/i)
            || html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
          if (img) imageUrl = img[1].replace(/&amp;/g, "&");
          const capDiv = html.match(/<div[^>]+class=["'][^"']*Caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
          if (capDiv) caption = decodeEntities(capDiv[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
          if (!caption) {
            const desc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
            if (desc) caption = decodeEntities(desc[1]);
          }
        }

        // Try the GraphQL-ish JSON endpoint for the full post data (gives all carousel images)
        // This URL works for some public posts — IG has been gradually restricting it.
        try {
          const jsonRes = await fetch(`https://www.instagram.com/p/${code}/?__a=1&__d=dis`, {
            headers: { ...headers, "X-IG-App-ID": "936619743392459" },
          });
          if (jsonRes.ok) {
            const text = await jsonRes.text();
            if (text.trim().startsWith("{")) {
              const data = JSON.parse(text);
              const media = data?.graphql?.shortcode_media || data?.items?.[0] || data?.shortcode_media;
              if (media) {
                // Carousel — sidecar children each have image_versions2 / display_url
                const children = media.edge_sidecar_to_children?.edges?.map(e => e.node) || media.carousel_media || [];
                if (children.length) {
                  imageUrls = children.map(c =>
                    c.display_url
                    || c.image_versions2?.candidates?.[0]?.url
                  ).filter(Boolean);
                }
                // Single-image post — display_url
                if (!imageUrls.length) {
                  const single = media.display_url || media.image_versions2?.candidates?.[0]?.url;
                  if (single) imageUrls = [single];
                }
                // Caption
                if (!caption) {
                  const cap = media.edge_media_to_caption?.edges?.[0]?.node?.text
                    || media.caption?.text;
                  if (cap) caption = cap;
                }
              }
            }
          }
        } catch (_) { /* fall through to whatever we got from embed */ }

        // Final fallback: the public post page OG tags
        if (!imageUrl && !imageUrls.length) {
          const pageRes = await fetch(`https://www.instagram.com/p/${code}/`, { headers });
          if (pageRes.ok) {
            const html = await pageRes.text();
            const img = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
            const desc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
            if (img) imageUrl = img[1].replace(/&amp;/g, "&");
            if (desc && !caption) {
              caption = decodeEntities(desc[1]);
              const m1 = caption.match(/^"(.+)"\s*-\s*@/s);
              if (m1) caption = m1[1];
            }
          }
        }

        // Normalize: prefer the JSON-derived list (full carousel) over the single embed cover
        if (!imageUrls.length && imageUrl) imageUrls = [imageUrl];
        if (!imageUrls.length) return json({ error: "Instagram blocked the request. Paste images manually instead." }, 502);

        return json({
          code,
          imageUrl: imageUrls[0],
          imageUrls,
          caption,
          postUrl: `https://www.instagram.com/p/${code}/`,
          isCarousel: imageUrls.length > 1,
        });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // ---- IG image proxy: pipe an IG CDN image through the worker so the admin
    //      can download it without hitting CORS (IG CDN doesn't send ACAO).
    if (request.method === "GET" && path === "/api/ig-proxy") {
      const target = url.searchParams.get("url");
      if (!target) return json({ error: "url required" }, 400);
      try {
        const u = new URL(target);
        if (!/cdninstagram\.com$|fbcdn\.net$/.test(u.hostname)) {
          return json({ error: "host not allowed" }, 400);
        }
        const res = await fetch(target, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer": "https://www.instagram.com/",
          },
        });
        if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);
        return new Response(res.body, {
          headers: {
            "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // ---- IG feed: server-side profile-feed pull ----
    // GET /api/ig-feed?username=...&user_id=...&count=50&max_id=...
    if (request.method === "GET" && path === "/api/ig-feed") {
      const username = url.searchParams.get("username");
      const count = Math.min(parseInt(url.searchParams.get("count") || "50", 10), 100);
      const maxId = url.searchParams.get("max_id") || "";
      const directUserId = url.searchParams.get("user_id") || "";
      if (!username && !directUserId) return json({ error: "username or user_id required" }, 400);
      try {
        const result = await fetchIgFeed({ username, userId: directUserId, count, maxId });
        return json(result, result.error ? 502 : 200);
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // One-time Llama vision license acceptance. CF Workers AI requires
    // calling the model with prompt='agree' once to accept the EULA before
    // any further inference works.
    if (request.method === "GET" && path === "/api/ig-accept-license") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      try {
        const r = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { prompt: "agree", max_tokens: 8 });
        return json({ ok: true, response: r });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // Debug: classify a single IG shortcode through both vision + text models.
    // GET /api/ig-classify?shortcode=...&caption=... (caption optional, admin auth)
    if (request.method === "GET" && path === "/api/ig-classify") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const sc = url.searchParams.get("shortcode");
      const capOverride = url.searchParams.get("caption");
      const userIdQ = url.searchParams.get("user_id") || "51870726026";
      if (!sc) return json({ error: "shortcode required" }, 400);
      try {
        const feed = await fetchIgFeed({ userId: userIdQ, count: 50 });
        const found = (feed.items || []).find(i => i.shortcode === sc);
        const imageUrl = found?.imageUrl || null;
        const caption = capOverride || found?.caption || "";
        const vision = await classifyPostWithVision(env, caption, imageUrl);
        const text = await classifyPostWithAi(env, caption);
        const heuristic = parseCaptionForBag(caption);
        return json({ shortcode: sc, caption, imageUrl, vision, text_only: text, heuristic });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // ---- IG sync: discover new posts (admin preview) ----
    // GET /api/ig-discover?user_id=...&limit=20  (or username=...)
    // Returns up to `limit` posts whose ig_<shortcode> isn't already in the
    // catalog, each with a suggested name/category/stock from the hybrid
    // vision + text + heuristic classifier. No images downloaded yet.
    if (request.method === "GET" && path === "/api/ig-discover") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const username = url.searchParams.get("username");
      const directUserId = url.searchParams.get("user_id");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
      if (!username && !directUserId) return json({ error: "username or user_id required" }, 400);

      try {
        const existingRaw = await env.BAGS.get("data");
        const existing = existingRaw ? JSON.parse(existingRaw) : { bags: [] };
        const existingIds = new Set((existing.bags || []).map(b => b.id));

        const feedData = await fetchIgFeed({ username, userId: directUserId, count: 50 });
        if (!feedData.items) return json({ error: feedData.error || "feed empty" }, 502);

        const fresh = feedData.items.filter(it => !existingIds.has(`ig_${it.shortcode}`)).slice(0, limit * 2);
        const classified = await Promise.all(fresh.map(async (it) => {
          const heuristic = looksLikeProduct(it.caption);
          const [vision, text] = await Promise.all([
            classifyPostWithVision(env, it.caption, it.imageUrl),
            classifyPostWithAi(env, it.caption),
          ]);
          const visionOk = vision && !vision._debug;
          const isProduct = heuristic || (visionOk && vision.is_product) || (text && text.is_product);
          if (!isProduct) return null;
          const heuristicSuggestion = parseCaptionForBag(it.caption);

          // Name: text LLM is best at brand shorthand. Strip caption-fragment
          // names like bare "Size" or "Polo" if they slip through.
          const looksLikeFragment = (n) => !n || /^(size|sizes|tn|hh|nb)$/i.test(String(n).trim());
          let name = heuristicSuggestion.name;
          if (text?.is_product && !looksLikeFragment(text.name) && text.name !== "New Item") {
            name = text.name.trim();
          } else if (visionOk && vision.is_product && !looksLikeFragment(vision.name) && vision.name !== "New Item") {
            name = vision.name.trim();
          } else if (visionOk && vision.is_product && vision.name === "New Item") {
            name = "New Item";
          }

          // Category: vision wins (it sees the photo — best at polos vs tshirts
          // vs shirts). Text LLM second. Heuristic last. Coerce through the
          // allowed-categories whitelist so we never publish a phantom filter.
          let category = coerceCategory(heuristicSuggestion.category);
          if (visionOk && vision.is_product && vision.category) {
            const c = coerceCategory(vision.category);
            if (c) category = c;
          } else if (text?.is_product && text.category) {
            const c = coerceCategory(text.category);
            if (c) category = c;
          }
          if (!category) category = "Dresses"; // safest default for this shop if all signals failed

          const reason = visionOk ? vision.reason : (text?.reason || (heuristic ? "matched product heuristic" : ""));
          let classifier = "heuristic";
          if (visionOk && text) classifier = "vision+text";
          else if (visionOk) classifier = "vision";
          else if (text) classifier = "text";

          return {
            ...it,
            suggested: {
              name,
              category,
              stock: heuristicSuggestion.stock,
              gender: heuristicSuggestion.gender || "",
              description: heuristicSuggestion.description,
            },
            ai_reason: reason,
            classifier,
          };
        }));
        const candidates = classified.filter(Boolean).slice(0, limit);

        return json({
          count: candidates.length,
          scanned: fresh.length,
          items: candidates,
          profile: feedData.profile,
          ai_enabled: !!env.AI,
        });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // ---- IG sync: commit approved posts ----
    // POST /api/ig-sync (auth) body: { items: [{ shortcode, name, category, stock, description, imageUrls, takenAt }] }
    // Downloads each item's images directly from IG CDN, uploads to KV, and
    // prepends new-stock bag objects to the catalog. Ryker schema:
    //   { id: 'ig_<shortcode>', name, category, description, price: 0,
    //     stock: { sz: qty, ... }, sales: [], image, images?, createdAt,
    //     instagramUrl }
    if (request.method === "POST" && path === "/api/ig-sync") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const blocked = await suspendBlock(request, env); if (blocked) return blocked;
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return json({ error: "items required" }, 400);

      const existingRaw = await env.BAGS.get("data");
      const data = existingRaw ? JSON.parse(existingRaw) : { bags: [], settings: {} };
      const existingIds = new Set(data.bags.map(b => b.id));

      const added = [];
      const errors = [];
      const newBags = [];

      for (const it of items) {
        const id = `ig_${it.shortcode}`;
        if (existingIds.has(id)) { errors.push({ shortcode: it.shortcode, reason: "already in catalog" }); continue; }
        const urls = (it.imageUrls || []).slice(0, 4);
        if (!urls.length) { errors.push({ shortcode: it.shortcode, reason: "no images" }); continue; }
        const uploaded = [];
        for (const u of urls) {
          try {
            const r = await fetch(u);
            if (!r.ok) throw new Error(`fetch ${r.status}`);
            const buf = new Uint8Array(await r.arrayBuffer());
            const b64 = arrayToB64(buf);
            const name = `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
            await env.BAGS.put(`img:${name}`, b64);
            await env.BAGS.put(`mime:${name}`, "image/jpeg");
            uploaded.push(`${url.origin}/img/${name}`);
          } catch (e) {
            errors.push({ shortcode: it.shortcode, reason: `image fetch: ${e.message}` });
          }
        }
        if (!uploaded.length) continue;

        // Normalise stock — strip any sizes the admin set to 0 or null, default
        // to { "One Size": 1 } if nothing valid came through.
        let stock = {};
        if (it.stock && typeof it.stock === "object") {
          for (const [k, v] of Object.entries(it.stock)) {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) stock[k] = n;
          }
        }
        if (!Object.keys(stock).length) stock["One Size"] = 1;

        const category = coerceCategory(it.category) || "Dresses";

        const priceN = parseInt(it.price, 10);
        const bag = {
          id,
          name: (it.name || "New Item").slice(0, 80),
          category,
          description: it.description || "Brand new, hand-picked for you. Photographed exactly as it is. Tap Check availability to ask for it on WhatsApp.",
          price: !isNaN(priceN) && priceN > 0 ? priceN : 0,
          stock,
          sales: [],
          image: uploaded[0],
          createdAt: it.takenAt || new Date().toISOString(),
          instagramUrl: `https://www.instagram.com/p/${it.shortcode}/`,
        };
        if (uploaded.length > 1) bag.images = uploaded;
        if (it.gender === "ladies" || it.gender === "gents") bag.gender = it.gender;
        newBags.push(bag);
        added.push({ shortcode: it.shortcode, id });
        existingIds.add(id);
      }

      // Newest first — prepend to the catalog
      data.bags = newBags.concat(data.bags);
      await env.BAGS.put("data", JSON.stringify(data));
      return json({ ok: true, added: added.length, errors, items: added });
    }

    return json({ error: "not found" }, 404);
  },
};
