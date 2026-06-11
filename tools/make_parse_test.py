import io, json
src = io.open('worker/src/index.js', encoding='utf-8').read()
start = src.find('const TYPE_MAP')
end = src.find('// Is this caption plausibly a product post?')
tests = [
 "Blazer @21,000\nSkirt @21,000\nTop 2,500",
 "D&G pure leather ladies sneakers available \n@22,000 last price\nSizes 36-43",
 "C L block heels\n@23,000\n37, 38,39,40,41,42",
 "Balmain Blazer 21,000\nYsl skirt  21,000\nTube top 2,500",
 "Pure Italian leather bags ranging between 35,000 to 51,000\nWe negotiate Prices, not quality.",
 "Ferragamo bag\n@51,000",
 "Ysl skirt available @21,000\nSize s,m,l,xl,xxl",
 "Suit available in size 8 to 14\n@48,000",
 "Navy pin stripes suit @30,000\nSizes 48-58",
 "Top available in white, black and peach @14,000. Sizes s-2xl",
 "Stretchy red dress, size 12/14\n@17,000",
 "Stretch suit\nSize 10-16\n46,000",
 "Italian suit available for 41,000",
 "Tie available for 2,500 fixed price.\nPerfect for your white n blue shirts.",
 "Italian leather Shoes on sale 12,000 only. Down from 20,000. Select sizes",
 "Crossed jeans available\nSizes 6-14",
 "Pure leather\nSizes 35-42\n@21,800",
 "Stretchy Elegant trouser suit available in sizes 40-46\n@42,000",
 "Available in sizes 6 to 14\n@19,000",
 "A Cate Middleton kinda outfit",
]
harness = src[start:end] + '\nconst tests = ' + json.dumps(tests) + ''';
for (const t of tests) {
  const r = parseCaptionForBag(t);
  console.log(JSON.stringify({cap: t.slice(0,42).replace(/\\n/g," / "), name: r.name, cat: r.category, price: r.price, stock: Object.keys(r.stock).join(",")}));
}
'''
io.open('.tmp/parse_test.js', 'w', encoding='utf-8').write(harness)
print('written')
