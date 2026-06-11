# Iman High Street — project notes

Brand-new ladies fashion shop (plus some men's formal pieces), CBK Pension Towers, Ground Floor, Harambee Avenue, Nairobi. Onboarded 2026-06-11 as a **Ryker Luxury fork** (new-stock data model). Read `../CATALOG-STANDARDS.md` first; this file only locks the per-client decisions.

## Locked decisions — do not "helpfully" revert

1. **Data model: new-stock** (`stock: {size: qty}` + `sales: []`). Sells brand-new items.
2. **Tier: Basic / Shopfront (corrected 2026-06-11; was first recorded as Shop Records).** Client starts on the bottom package: catalog management only (IG sync, add/edit items, All items). Hidden, NOT removed, in `admin.html`: **Sell in store (POS), Sales, Inventory, Owed** (Shop Records 3k features) via `style="display:none"` on nav links + sections, plus the `#tierGateBasic` style block for the JS-rendered sale buttons (item-card Sell/Restock, bulk-bar "Sell to one customer"); WhatsApp Marketing, Clients, Insights, Daily report (5k+ features) stay hidden the same inline way. The worker still captures everything (`/api/track` → `stats`, full `sales[]`/`clients[]` schema). Upgrade to Shop Records = remove the POS/Sales/Inventory/Owed `display:none`s + delete `#tierGateBasic`; upgrade to 5k+ = remove the rest. Stock stays editable per size via the item edit form, so the owner can keep the public site accurate without the records UI.
3. **Primary CTA label: "Check availability"** with the WA icon, including on sold-out buttons (owner requirement, 2026-06-11: WhatsApp icon on every Enquire button including sold-out — the template already renders WA_SVG on both states; keep it that way).
4. **"View on IG" button: KEPT.** Feed is 117 photos vs 13 reels (photo-sourced).
5. **Enquire: one-tap wa.me + `/p/<id>` OG share page. NO Web Share / app-picker.**
6. **Categories:** Dresses, Suits, Blazers, Tops, Skirts, Trousers, Jeans, Shoes, Heels, Handbags, Accessories. Defined in three places that must stay in sync: worker `IMAN_CATEGORIES`/`coerceCategory` + both AI prompts, `admin.js` `SHOP_CATEGORIES`, `admin.html` category `<select>`.
7. **Size scales** (worker parser + admin stock grid + `main.js` `sizeGroup` groups):
   - Letters XS-5XL → "Clothing (S-XL)"
   - UK dress sizes 6-18 even (plain numbers) → "Dress size (UK)"
   - Suit sizes 34-58 even (plain numbers) → "Suit size"
   - EU shoe sizes stored as `EU35`..`EU46` → "Shoe size (EU)"
8. **Prices parse from captions** (`@21,000`, `30k`, "for 41,000"). Price ranges ("18k-20k", "between X to Y") → `price: 0` = "Price on request". `/api/ig-sync` accepts an optional `price` per item (this fork only).
9. **`/api/buyer` is neutralised** (acks `forwarded:false`, no GHL). Wire the client's own GHL locationId/formId only if they buy that feature.
10. **deriveBrand is type-first + brand-second, first-line scoped** (multi-item captions like "Balmain Blazer / Ysl skirt / Tube top" name from line 1). No leading-handle strip (feed-API captions have none).
11. **Ladies / Men filter (added 2026-06-11, owner ask).** Optional `item.gender` field: `'ladies'` / `'gents'` / absent = both. Public pill row `#genderPills` (Everyone / Ladies / Men) above the search row; `genderMatch()` in main.js also scopes the size dropdown pool. Admin: "Who is it for?" select (`#genderInput`) in the add/edit form + a per-row select in the IG-sync review list. Worker `parseCaptionForBag` auto-detects from caption words, category, and size scale (suit sizes 48-58 = gents, dress sizes 6-18 = ladies, EU shoe range high/low). All 46 seeded items were hand-verified against their photos; `tools/tag_gender.js` holds the per-item overrides.

## Infra

- Worker: `iman-high-street-api` → https://iman-high-street-api.stawisystems.workers.dev (account stawisystems, `58685495706b973821d77208248c66fc`)
- KV: `iman-high-street-bags` (`a028f431a48d48c79c014cc247fa00bf`, binding `BAGS`)
- Pages: project `iman-high-street`, **production branch `main`** → **https://iman.essenceautomations.com** (custom domain live 2026-06-11; proxied CNAME `iman` in the essenceautomations.com zone; iman-high-street.pages.dev still works underneath). `SITE` in the worker `/p/` route, `SHOP_URL` in admin.js and the OG/canonical URLs in index.html all point at the custom domain.
- Secrets set: `ADMIN_TOKEN` (in `worker/.admin-token`, gitignored), `MASTER_TOKEN` (fleet), `MASTER_PASSWORD` (fleet). `WASENDER_TOKEN` not set (daily report is Pro-tier; the cron no-ops).
- Owner login: `iman123` (client-side fallback + worker `FALLBACK_OWNER_PASSWORD`). Agency master works server-side.
- IG: @iman_high_street, **IG_USER_ID `51870726026`** (hard-coded in admin.js + worker ig-classify default)
- WhatsApp: 254720961246
- Deploy: `npx wrangler pages deploy . --project-name=iman-high-street --branch=main --commit-dirty=true`; worker via `npx wrangler deploy` in `worker/`. Bump `?v=` on `styles.css`/`admin.js`/`main.js` in BOTH html files on every change.

## Seed history

2026-06-11: seeded 46 items from the top 150 feed-API posts (`tools/pull_feed.py` → `tools/seed_catalog.js`, oldest-chunk-first through `/api/ig-sync`). Skipped: 74 empty captions, 6 SOLD, 24 no-product-name. 27/46 carry parsed prices. Caption-less posts are recoverable via the admin's "Check for new posts" (vision AI names them from the photo).
