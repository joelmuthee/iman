# Pull iman_high_street's IG feed via /api/v1/feed/user/<id>/ (the feed API,
# NOT the grid), paginated with next_max_id, capped at 150 posts. Saves raw
# items to .tmp/feed_raw.json. Falls back to the catalog worker's /api/ig-feed
# (Tier-1 IP) if Instagram rate-limits this machine.
import json, sys, time, urllib.request

USER_ID = "51870726026"
CAP = 150
HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.instagram.com/iman_high_street/",
}

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
        "mediaType": m.get("media_type"),  # 1=photo 2=video/reel 8=carousel
        "takenAt": m.get("taken_at"),
        "postUrl": f"https://www.instagram.com/p/{m.get('code')}/",
    }

items, max_id, page = [], "", 0
while len(items) < CAP:
    tail = f"?count=33" + (f"&max_id={max_id}" if max_id else "")
    try:
        data = get(f"https://www.instagram.com/api/v1/feed/user/{USER_ID}/{tail}")
    except Exception as e:
        print(f"direct feed failed on page {page}: {e}", file=sys.stderr)
        sys.exit(2)
    batch = [extract(m) for m in data.get("items", [])]
    items.extend(batch)
    print(f"page {page}: +{len(batch)} (total {len(items)}) more={data.get('more_available')}")
    if not data.get("more_available") or not data.get("next_max_id"):
        break
    max_id = data["next_max_id"]
    page += 1
    time.sleep(2)

items = items[:CAP]
with open(".tmp/feed_raw.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=1)
print(f"saved {len(items)} items to .tmp/feed_raw.json")
