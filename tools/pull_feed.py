# Pull iman_high_street's IG feed via /api/v1/feed/user/<id>/ (the feed API,
# NOT the grid), paginated with next_max_id. Saves raw items to
# .tmp/feed_raw.json and the last cursor to .tmp/feed_cursor.json.
#
# Usage:
#   python pull_feed.py              # fresh pull, cap 150 (default)
#   python pull_feed.py --cap 1200   # fresh pull, cap 1200
#   python pull_feed.py --resume     # continue from saved cursor, append, cap 900
#   python pull_feed.py --resume --cap 400  # continue, pull up to 400 new posts
import json, os, sys, time, urllib.request, urllib.error

USER_ID = "51870726026"
RESUME = '--resume' in sys.argv
cap_idx = next((i for i, a in enumerate(sys.argv) if a == '--cap'), -1)
CAP = int(sys.argv[cap_idx + 1]) if cap_idx > -1 else (900 if RESUME else 150)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.instagram.com/iman_high_street/",
}

FEED_PATH = ".tmp/feed_raw.json"
CURSOR_PATH = ".tmp/feed_cursor.json"

def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def extract(m):
    carousel = m.get("carousel_media") or []
    if carousel:
        urls = [c.get("image_versions2", {}).get("candidates", [{}])[0].get("url") for c in carousel]
        urls = [u for u in urls if u]
    else:
        cands = m.get("image_versions2", {}).get("candidates") or []
        urls = [cands[0]["url"]] if cands else []
    return {
        "shortcode": m.get("code"),
        "imageUrl": urls[0] if urls else None,
        "imageUrls": urls,
        "caption": (m.get("caption") or {}).get("text") or "",
        "isCarousel": len(urls) > 1,
        "mediaType": m.get("media_type"),
        "takenAt": m.get("taken_at"),
        "postUrl": f"https://www.instagram.com/p/{m.get('code')}/",
    }

# Load existing data + cursor when resuming
existing = []
existing_codes = set()
max_id = ""

if RESUME:
    if os.path.exists(FEED_PATH):
        existing = json.load(open(FEED_PATH, encoding="utf-8"))
        existing_codes = {p["shortcode"] for p in existing if p.get("shortcode")}
        print(f"loaded {len(existing)} existing posts from {FEED_PATH}")
    if os.path.exists(CURSOR_PATH):
        c = json.load(open(CURSOR_PATH, encoding="utf-8"))
        max_id = c.get("next_max_id", "")
        print(f"resuming from cursor: {max_id[:20]}...")
    else:
        print("warning: no cursor file found — starting from most recent posts", file=sys.stderr)

new_items, page = [], 0
last_saved_max_id = ""

while len(new_items) < CAP:
    tail = "?count=33" + (f"&max_id={max_id}" if max_id else "")
    try:
        data = get(f"https://www.instagram.com/api/v1/feed/user/{USER_ID}/{tail}")
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on page {page} — saving cursor and stopping", file=sys.stderr)
        break
    except Exception as e:
        print(f"error on page {page}: {e} — saving cursor and stopping", file=sys.stderr)
        break

    batch = [extract(m) for m in data.get("items", [])]
    if RESUME:
        batch = [b for b in batch if b.get("shortcode") not in existing_codes]
        existing_codes.update(b["shortcode"] for b in batch if b.get("shortcode"))
    new_items.extend(batch)

    last_saved_max_id = data.get("next_max_id", "")
    more = data.get("more_available", False)
    label = f"+{len(batch)} new" if RESUME else f"+{len(batch)}"
    print(f"page {page}: {label} (running total {len(new_items)}) more={more}")

    if not more or not last_saved_max_id:
        print("no more pages available")
        break
    max_id = last_saved_max_id
    page += 1
    time.sleep(2)

# Save cursor so the next --resume can continue from here
if last_saved_max_id:
    json.dump({"next_max_id": last_saved_max_id}, open(CURSOR_PATH, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"cursor saved to {CURSOR_PATH}")

new_items = new_items[:CAP]
all_items = existing + new_items
with open(FEED_PATH, "w", encoding="utf-8") as f:
    json.dump(all_items, f, ensure_ascii=False, indent=1)
print(f"saved {len(all_items)} total posts ({len(new_items)} new) to {FEED_PATH}")
