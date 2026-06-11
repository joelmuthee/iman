# One-shot re-verticalisation of worker/src/index.js (Ryker menswear -> Iman
# High Street women's fashion). Every replacement asserts exactly one hit
# before any write, so a drifted source aborts cleanly.
import io, sys

PATH = "worker/src/index.js"
src = io.open(PATH, encoding="utf-8").read()
edits = []

def rep(old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"ABORT: anchor '{label}' matched {n} times (need 1)", file=sys.stderr)
        sys.exit(1)
    edits.append((old, new, label))

# ---- 1. Drop the old menswear brand array (TYPE_MAP/BRAND_LIST already inserted above it)
OLD_ARRAY_START = 'const MENSWEAR_BRANDS = [\n  // Sneakers — specific models first'
OLD_ARRAY_END = '  // Generic "shoes" last — only used if no other footwear type matched\n  [/\\bshoes?\\b/,       null,                 "Shoes"],\n];\n'
i0 = src.find(OLD_ARRAY_START)
i1 = src.find(OLD_ARRAY_END)
if i0 < 0 or i1 < 0:
    print("ABORT: MENSWEAR_BRANDS block anchors missing", file=sys.stderr)
    sys.exit(1)
old_array = src[i0:i1 + len(OLD_ARRAY_END)]
rep(old_array, "", "menswear array removal")

# ---- 2. deriveBrand — type-first + brand-second, NO leading-handle strip
OLD_DERIVE = '''function deriveBrand(caption) {
  let text = (caption || "").toLowerCase().trim();
  text = text.replace(/^[a-z0-9._]+ /, "");  // strip leading "username "
  const padded = " " + text + " ";
  for (const [key, name, cat] of MENSWEAR_BRANDS) {
    if (key instanceof RegExp) {
      if (key.test(padded)) return [name, cat];
    } else if (padded.includes(key)) {
      return [name, cat];
    }
  }
  return [null, null];
}'''
NEW_DERIVE = '''function deriveBrand(caption) {
  // NO leading-handle strip here: feed-API captions (/api/v1/feed/user/) carry
  // no handle prefix, so stripping would eat the first real product word. The
  // handle strip belongs only on embed-page captions (admin quick-add, client-side).
  const padded = " " + (caption || "").toLowerCase().trim() + " ";
  let typeLabel = null, category = null, brand = null;
  for (const [key, label, cat] of TYPE_MAP) {
    if (key instanceof RegExp ? key.test(padded) : padded.includes(key)) {
      typeLabel = label; category = cat; break;
    }
  }
  for (const [key, name] of BRAND_LIST) {
    if (key instanceof RegExp ? key.test(padded) : padded.includes(key)) { brand = name; break; }
  }
  if (!typeLabel && !brand) return [null, null];
  const name = brand && typeLabel ? `${brand} ${typeLabel}` : (typeLabel || brand);
  return [name, category];
}'''
rep(OLD_DERIVE, NEW_DERIVE, "deriveBrand")

# ---- 3. parseCaptionForBag — Iman sizes (letters, UK dress 6-18, EU shoe 35-46,
#         suit 44-58) + price parsing (this account lists prices in captions)
OLD_PARSE_START = '// Ryker is NEW-STOCK — captions like "Sizes M, L, XL" or "S/M/L/XL" mean the'
OLD_PARSE_END = '''  return {
    name: brand,
    category: category || null,
    stock,
    description: "Premium menswear, hand-selected. Photographed exactly as it is. Pick your size below to enquire.",
  };
}'''
p0 = src.find(OLD_PARSE_START)
p1 = src.find(OLD_PARSE_END)
if p0 < 0 or p1 < 0:
    print("ABORT: parseCaptionForBag anchors missing", file=sys.stderr)
    sys.exit(1)
old_parse = src[p0:p1 + len(OLD_PARSE_END)]
NEW_PARSE = '''// Iman is NEW-STOCK. Captions on this account: "Ysl skirt available @21,000 /
// Size s,m,l,xl,xxl", "Sizes 6-14", "37, 38,39,40,41,42", "Sizes 48-58" (suits).
// Default qty=1 per detected size; owner adjusts in admin.
// Returns { name, category, stock: { sz: qty }, price, description }.
function parseCaptionForBag(caption) {
  const text = (caption || "").trim();
  const lower = text.toLowerCase();
  const cleaned = text.split(/whatsapp|whastup|wa\\.me|0\\d{8,}/i)[0].trim().replace(/[.\\s]+$/, "");
  let [name, category] = deriveBrand(caption);
  if (!name) {
    const first = cleaned.split(/\\.\\.|\\.\\s|,|\\n|·/)[0].trim();
    name = first ? first.slice(0, 60).replace(/\\b\\w/g, c => c.toUpperCase()) : "New Item";
  }

  const stock = {};

  // Strip price tokens BEFORE size scanning so "@21,000" can't bleed a "21"
  // into the size detection.
  const noPrices = lower.replace(/\\d{1,3}(?:[,. ]\\d{3})+/g, " ").replace(/\\b\\d{1,3}k\\b/g, " ");
  const padded = " " + noPrices.replace(/[,/&|·]+/g, " ").replace(/\\s+/g, " ") + " ";

  // --- Letter sizes: XS..5XL, "2xl" variant, and ranges ("s-2xl", "s to xxl") ---
  const LETTERS = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
  const normLetter = (t) => { t = t.toUpperCase(); return t === "2XL" ? "XXL" : t === "XXXL" ? "3XL" : t; };
  const letterRange = noPrices.match(/\\b(xs|s|m|l|xl|xxl|2xl|xxxl|3xl)\\s*(?:-|–|to)\\s*(xs|s|m|l|xl|xxl|2xl|xxxl|3xl)\\b/);
  if (letterRange) {
    const a = LETTERS.indexOf(normLetter(letterRange[1]));
    const b = LETTERS.indexOf(normLetter(letterRange[2]));
    if (a >= 0 && b >= a) for (let i = a; i <= b; i++) stock[LETTERS[i]] = 1;
  } else {
    for (const sz of ["XS", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL", "S", "M", "L", "XL"]) {
      const re = new RegExp(`(?:^|\\\\s|[^a-z0-9])${sz.toLowerCase()}(?=$|\\\\s|[^a-z0-9])`);
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
  const addSuit = (n) => { if (n >= 44 && n <= 58 && n % 2 === 0) stock[String(n)] = 1; };
  let m;
  const ranges = [];
  const rangeRe = /\\b(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\b/g;
  while ((m = rangeRe.exec(noPrices)) !== null) ranges.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
  for (const [a, b] of ranges) {
    if (b < a || b - a > 24) continue;
    if (isFoot && a >= 35 && b <= 46) { for (let n = a; n <= b; n++) addShoe(n); }
    else if (a >= 6 && b <= 18) { for (let n = a; n <= b; n++) addDress(n); }
    else if (isSuit && a >= 44 && b <= 58) { for (let n = a; n <= b; n++) addSuit(n); }
    else if (a >= 35 && b <= 46) { for (let n = a; n <= b; n++) addShoe(n); }
  }
  if (!ranges.length) {
    const numRe = /(?<![0-9])(\\d{1,2})(?![0-9])/g;
    while ((m = numRe.exec(padded)) !== null) {
      const n = parseInt(m[1], 10);
      if (isFoot) addShoe(n);
      if (n >= 6 && n <= 18) addDress(n);
      else if (isSuit) addSuit(n);
      else if (!isFoot && n >= 35 && n <= 46) addShoe(n);
    }
  }

  if (!Object.keys(stock).length) stock["One Size"] = 1;

  // --- Price: "@21,000", "for 41,000", "27 000", "12.000", "30k". A RANGE
  // ("18k-20k", "between 35,000 to 51,000") means per-piece pricing -> 0
  // so the site shows "Price on request".
  let price = 0;
  const priceRange = /(?:between|ranging|ranges?\\s+(?:from|between))\\b/.test(lower)
    || /\\d[\\d,. ]*\\s*(?:-|to)\\s*\\d{1,3}(?:[,.]\\d{3}|k\\b)/.test(lower);
  if (!priceRange) {
    const pm = lower.match(/(\\d{1,3}(?:[,. ]\\d{3})+)/) || lower.match(/\\b(\\d{2,3})k\\b/);
    if (pm) {
      const tok = pm[1];
      const n = /k$/i.test(pm[0]) && tok.length <= 3 ? parseInt(tok, 10) * 1000 : parseInt(tok.replace(/[,. ]/g, ""), 10);
      if (n >= 500 && n <= 500000) price = n;
    }
  }

  return {
    name,
    category: category || null,
    stock,
    price,
    description: "Brand new, hand-picked for you. Photographed exactly as it is. Pick your size below and ask for it on WhatsApp.",
  };
}'''
rep(old_parse, NEW_PARSE, "parseCaptionForBag")

# ---- 4. looksLikeProduct
OLD_LOOKS = '''function looksLikeProduct(caption) {
  if (!caption) return false;
  const lower = caption.toLowerCase();
  // Size signal (apparel letter, jeans waist number, or UK shoe size)
  if (/(?:^|\\s|[,/|·])(?:xs|s|m|l|xl|xxl|3xl|4xl|5xl)(?:$|\\s|[,/|·])/i.test(" " + lower + " ")) return true;
  if (/\\b(?:uk\\s*\\d{1,2}|\\d{1,2}\\s*uk|size\\s+\\d{2,})\\b/i.test(lower)) return true;
  if (/\\bsizes?\\s*[:\\-]?\\s*/i.test(lower)) return true;
  for (const [key] of MENSWEAR_BRANDS) {
    if (key instanceof RegExp ? key.test(lower) : lower.includes(key)) return true;
  }
  return false;
}'''
NEW_LOOKS = '''function looksLikeProduct(caption) {
  if (!caption) return false;
  const lower = caption.toLowerCase();
  // Size signal (letter sizes, dress sizes "6-14", EU shoe sizes "36-43")
  if (/(?:^|\\s|[,/|·])(?:xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\\s|[,/|·])/i.test(" " + lower + " ")) return true;
  if (/\\bsizes?\\s*[:\\-]?\\s*\\d/i.test(lower)) return true;
  if (/\\bsizes?\\s+(?:range|xs|s|m|l|xl)/i.test(lower)) return true;
  for (const [key] of TYPE_MAP) {
    if (key instanceof RegExp ? key.test(lower) : lower.includes(key)) return true;
  }
  for (const [key] of BRAND_LIST) {
    if (key instanceof RegExp ? key.test(lower) : lower.includes(key)) return true;
  }
  return false;
}'''
rep(OLD_LOOKS, NEW_LOOKS, "looksLikeProduct")

# ---- 5. Vision prompt
v0 = src.find("const prompt = `You sort Instagram posts from Ryker Luxury")
v_end_marker = '{"is_product":true|false,"name":"<brand+model or New Item>","category":"<exactly one from the list>","reason":"<3-6 words>"}`;'
v1 = src.find(v_end_marker)
if v0 < 0 or v1 < 0:
    print("ABORT: vision prompt anchors missing", file=sys.stderr)
    sys.exit(1)
old_vision = src[v0:v1 + len(v_end_marker)]
NEW_VISION = '''const prompt = `You sort Instagram posts from Iman High Street, a Nairobi shop selling brand-new women's fashion (dresses, suits, blazers, heels, leather handbags) plus some formal pieces for men (suits, ties, leather shoes). You're given ONE photo + ONE caption. Decide:
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
{"is_product":true|false,"name":"<brand+item or New Item>","category":"<exactly one from the list>","reason":"<3-6 words>"}`;'''
rep(old_vision, NEW_VISION, "vision prompt")

# ---- 6. Text prompt
t0 = src.find("const prompt = `You sort Instagram posts from Ryker Luxury")
t0 = src.find("const prompt = `You sort Instagram posts from Ryker Luxury", v1)  # second occurrence
t_end_marker = 'Caption: """${trimmed}"""`;'
t1 = src.find(t_end_marker)
if t0 < 0 or t1 < 0 or t1 < t0:
    print("ABORT: text prompt anchors missing", file=sys.stderr)
    sys.exit(1)
old_text = src[t0:t1 + len(t_end_marker)]
NEW_TEXT = '''const prompt = `You sort Instagram posts from Iman High Street, a Nairobi shop selling brand-new women's fashion (dresses, suits, blazers, heels, leather handbags) plus some formal pieces for men (suits, ties, leather shoes). Each post is either ONE specific product (or one stocked SKU) listed for sale, OR a non-product post.

Reply with strict minified JSON only, no prose, no code fences.

Schema:
{"is_product": true|false, "name": "<short brand + item OR generic descriptor>", "category": "<exactly one of: Dresses, Suits, Blazers, Tops, Skirts, Trousers, Jeans, Shoes, Heels, Handbags, Accessories>", "reason": "<3-6 words>"}

Rules:
- is_product = true when the caption mentions a fashion item and at least one size signal ("Sizes 6-14", "s,m,l,xl", "37,38,39", "Sizes 48-58") OR a price ("@21,000") OR a known brand.
- is_product = false for shop intros, owner/customer photos, throwbacks, marketing banners, holiday greetings, generic "DM us" posts with no specific product.
- Decode shorthand: "Ysl" = YSL; "D&G" = Dolce & Gabbana; "Ferragammo" = Ferragamo (typo); "C L" at the start of a shoe caption = Christian Louboutin.
- name MUST be brand+item when known ("YSL Skirt", "Balmain Suit"). Strip prices, sizes, phone numbers, hashtags. If brand unknown but item type clear, name = generic description (e.g. "Stretchy Red Dress", "Block Heels"). If truly unknown, name = "New Item".
- category: match to the EXACT list. Heeled footwear is Heels, never Shoes. Any bag is Handbags. Matched sets are Suits; a lone blazer is Blazers.

Caption: """${trimmed}"""`;'''
rep(old_text, NEW_TEXT, "text prompt")

# ---- 7. Category set + coerce
OLD_COERCE_START = "// Ryker stocks men's clothing + footwear only. Coerce any AI-suggested category"
OLD_COERCE_END = '''  // Don't invent — return null so the owner picks
  return null;
}'''
c0 = src.find(OLD_COERCE_START)
c1 = src.find(OLD_COERCE_END)
if c0 < 0 or c1 < 0:
    print("ABORT: coerce anchors missing", file=sys.stderr)
    sys.exit(1)
old_coerce = src[c0:c1 + len(OLD_COERCE_END)]
NEW_COERCE = '''// Iman stocks women's fashion + formal pieces. Coerce any AI-suggested
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
  if (/^((skirt|trouser|stretch)\\s*suits?|suits?|two[\\s-]?piece(\\s*sets?)?)$/i.test(lower)) return "Suits";
  if (/^(blazers?|jackets?|coats?)$/i.test(lower)) return "Blazers";
  if (/^(tops?|blouses?|tube\\s*tops?|t[\\s-]?shirts?|tees?|polos?|shirts?|camis(oles?)?)$/i.test(lower)) return "Tops";
  if (/^skirts?$/i.test(lower)) return "Skirts";
  if (/^(trousers?|pants?|khakis?|chinos?|slacks?)$/i.test(lower)) return "Trousers";
  if (/^(jeans?|denim)$/i.test(lower)) return "Jeans";
  if (/^(heels?|stilettos?|wedges?|pumps?|block\\s*heels?)$/i.test(lower)) return "Heels";
  if (/^(shoes?|sneakers?|trainers?|loafers?|sandals?|boots?|flats?|moccasins?)$/i.test(lower)) return "Shoes";
  if (/^(hand\\s?bags?|bags?|tote(\\s*bags?)?|clutch(es)?|cross\\s*body(\\s*bags?)?|purses?|sling\\s*bags?|hobos?)$/i.test(lower)) return "Handbags";
  if (/^(accessor(y|ies)|(neck|power|bow)?\\s*ties?|belts?|scar(f|ves)|jewell?ery)$/i.test(lower)) return "Accessories";
  // Don't invent — return null so the owner picks
  return null;
}'''
rep(old_coerce, NEW_COERCE, "coerce + category set")

# ---- 8. Shop name, share page, passwords, buyer proxy, defaults
rep('''const SHOP_NAME = "Ryker Luxury";              // per-fork: shop's display name''',
    '''const SHOP_NAME = "Iman High Street";          // per-fork: shop's display name''',
    "SHOP_NAME")
rep('      const SITE = "https://rykerluxury.co.ke";',
    '      const SITE = "https://iman-high-street.pages.dev";',
    "share page SITE")
rep('<meta property="og:site_name" content="Ryker Luxury">',
    '<meta property="og:site_name" content="Iman High Street">',
    "share og:site_name")
rep('''const desc = esc((item.description || "Premium menswear in Nairobi. Tap to view and enquire on WhatsApp.").slice(0, 160));''',
    '''const desc = esc((item.description || "Brand new women's fashion in Nairobi. Tap to view and ask on WhatsApp.").slice(0, 160));''',
    "share desc")
rep('<title>${title} · Ryker Luxury</title>',
    '<title>${title} · Iman High Street</title>',
    "share title")
rep('Opening Ryker Luxury…', 'Opening Iman High Street…', "share body")
rep('      const FALLBACK_OWNER_PASSWORD = "ryker123";',
    '      const FALLBACK_OWNER_PASSWORD = "iman123";',
    "check-password fallback")
rep('        else ok = current === "ryker123";',
    '        else ok = current === "iman123";',
    "set-password fallback")
rep('''      const { name, phone, notes, bag_name, bag_price, captchaV3 } = body;
      if (!name && !phone) return json({ error: "name or phone required" }, 400);
      const fd = new FormData();
      fd.append("formData", JSON.stringify({
        first_name: name || "",
        phone: phone || "",
        multi_line_280v: [notes, bag_name && `Item: ${bag_name} (Ksh ${bag_price})`].filter(Boolean).join(" | "),
      }));
      fd.append("locationId", "aTZHRdo8ius6WBzGQ5GD");
      fd.append("formId", "BWrG36c6p56ATDThPdN7");
      fd.append("eventData", JSON.stringify({ source: "rykerluxury-admin", type: "page-visit", domain: "rykerluxury.github.io" }));
      if (captchaV3) fd.append("captchaV3", captchaV3);
      try {
        const r = await fetch("https://backend.leadconnectorhq.com/forms/submit", {
          method: "POST",
          headers: {
            "Origin": "https://link.essenceautomations.com",
            "Referer": "https://link.essenceautomations.com/widget/form/BWrG36c6p56ATDThPdN7",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          body: fd,
        });
        const text = await r.text().catch(() => "");
        return json({ ok: r.ok, status: r.status, body: text.slice(0, 200) });
      } catch (err) { return json({ ok: false, error: err.message }, 502); }''',
    '''      const { name, phone } = body;
      if (!name && !phone) return json({ error: "name or phone required" }, 400);
      // GHL forwarding is a paid feature this client doesn't have yet. Ack
      // without forwarding (privacy: never post buyers to another client's
      // CRM). The admin records every sale + buyer to KV regardless. When the
      // client upgrades, wire their own GHL locationId/formId here.
      return json({ ok: true, forwarded: false });''',
    "buyer proxy neutralised")
rep('const userIdQ = url.searchParams.get("user_id") || "47659611317";',
    'const userIdQ = url.searchParams.get("user_id") || "51870726026";',
    "ig-classify default user id")
rep('          if (!category) category = "Shirts"; // safest default for menswear if all signals failed',
    '          if (!category) category = "Dresses"; // safest default for this shop if all signals failed',
    "discover category fallback")
rep('        const category = coerceCategory(it.category) || "Shirts";',
    '        const category = coerceCategory(it.category) || "Dresses";',
    "ig-sync category fallback")
# ---- 9. ig-sync: new description default + accept optional caption-parsed
#         price (this shop posts prices in captions)
rep('''        const bag = {
          id,
          name: (it.name || "New Item").slice(0, 80),
          category,
          description: it.description || "Premium menswear, hand-selected. Photographed exactly as it is. Pick your size below to enquire.",
          price: 0,''',
    '''        const priceN = parseInt(it.price, 10);
        const bag = {
          id,
          name: (it.name || "New Item").slice(0, 80),
          category,
          description: it.description || "Brand new, hand-picked for you. Photographed exactly as it is. Pick your size below and ask for it on WhatsApp.",
          price: !isNaN(priceN) && priceN > 0 ? priceN : 0,''',
    "ig-sync description + optional price")

# ---- 10. /api/bulk: empty-publish guard (MANDATORY per standards; Ryker lacked it)
rep('''      if (!Array.isArray(body.bags)) return json({ error: "bags must be array" }, 400);
      const payload = {''',
    '''      if (!Array.isArray(body.bags)) return json({ error: "bags must be array" }, 400);
      // Empty-publish guard: a stray test call with bags:[] would silently wipe
      // the live catalogue (no KV history). Explicit force:true required.
      if (body.bags.length === 0 && body.force !== true) {
        return json({ error: "refusing to publish an empty catalogue; pass force:true if intentional" }, 400);
      }
      const payload = {''',
    "bulk empty-publish guard")

for old, new, label in edits:
    src = src.replace(old, new, 1)
    print(f"ok: {label}")

io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)
print("written.")
