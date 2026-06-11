# Re-verticalise admin.js (Ryker menswear -> Iman High Street women's fashion).
# Exact-match assertions before any write.
import io, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

p = "admin.js"
src = io.open(p, encoding="utf-8").read()
edits = []

def rep(old, new, n=1):
    c = src.count(old)
    if c != n:
        print(f"ABORT: '{old[:70]}' matched {c}, want {n}", file=sys.stderr)
        sys.exit(1)
    edits.append((old, new, n))

rep("// Ryker Luxury Admin", "// Iman High Street Admin")
rep("const ADMIN_PASSWORD = 'ryker123';", "const ADMIN_PASSWORD = 'iman123';")
rep("const API_BASE = 'https://rykerluxury-api.stawisystems.workers.dev';",
    "const API_BASE = 'https://iman-high-street-api.stawisystems.workers.dev';")
rep("const ADMIN_TOKEN = atob('cnlrZXItYWRtaW4tdG9rZW4tMjAyNi1zZWN1cmU=');",
    "const ADMIN_TOKEN = atob('aW1hbi1hZG1pbi01MTkwOGJjZjNiZmViYTg5YWEyNjY5Y2I=');")
rep("const SHOP_URL = 'https://rykerluxury.co.ke'; // public storefront — used in WhatsApp messages to clients",
    "const SHOP_URL = 'https://iman-high-street.pages.dev'; // public storefront — used in WhatsApp messages to clients")
rep("'ryker_auth'", "'iman_auth'", 4)

# genDescription: women's fashion catMap + ungendered, dash-free copy
rep("""  const catMap = {
    Tshirts: 'tee', Shirts: 'shirt', Polos: 'polo', Jeans: 'jeans', Shorts: 'shorts',
    Joggers: 'joggers', Tracksuits: 'tracksuit', Hoodies: 'hoodie', Jackets: 'jacket', Suits: 'suit',
    Shoes: 'pair of shoes', Sneakers: 'pair of sneakers', Boots: 'pair of boots',
    Caps: 'cap', Belts: 'belt', Watches: 'watch', Jewellery: 'piece', Rings: 'ring', Chains: 'chain', Earrings: 'earrings', Accessories: 'piece',
  };""",
    """  const catMap = {
    Dresses: 'dress', Suits: 'suit', Blazers: 'blazer', Tops: 'top', Skirts: 'skirt',
    Trousers: 'pair of trousers', Jeans: 'pair of jeans', Shoes: 'pair of shoes',
    Heels: 'pair of heels', Handbags: 'bag', Accessories: 'piece',
  };""")
rep("""  const openers = [
    `Sharp ${color || 'premium'} ${type} — made for the man who doesn't settle.`,
    `A clean ${color || 'quality'} ${type} that earns its place in any rotation.`,
    `${color ? color.charAt(0).toUpperCase() + color.slice(1) : 'Premium'} ${type}, new stock. Built to last, styled to stand out.`,
  ];""",
    """  const openers = [
    `Elegant ${color || 'quality'} ${type}, made to turn heads.`,
    `A classy ${color || 'beautiful'} ${type} that earns its place in your wardrobe.`,
    `${color ? color.charAt(0).toUpperCase() + color.slice(1) : 'Beautiful'} ${type}, brand new in. Quality you can feel.`,
  ];""")
rep("""    `Pick up at Legend Valley Business Park, Gitanga Road or we deliver.`,""",
    """    `Pick up at CBK Pension Towers, Harambee Avenue or we deliver.`,""")

# Client re-contact + broadcast + reminders + sign-offs
rep("""  const msg = `Hi ${first}! Thanks for shopping with Ryker Luxury. Fresh pieces just landed. Browse what's new here: ${SHOP_URL}""",
    """  const msg = `Hi ${first}! Thanks for shopping with Iman High Street. Fresh pieces just landed. Browse what's new here: ${SHOP_URL}""")
rep("Ryker Luxury 🤍`;", "Iman High Street 🤍`;", 2)
rep("    ? `A friendly reminder about your balance on the item you took from Ryker Luxury:`",
    "    ? `A friendly reminder about your balance on the item you took from Iman High Street:`")
rep("    : `A friendly reminder about the ${n} items you took from Ryker Luxury that still have a balance:`;",
    "    : `A friendly reminder about the ${n} items you took from Iman High Street that still have a balance:`;")
rep("  return `${greet}It's Ryker Luxury, ${subject || 'fresh stock just landed'}.${itemsBlock}\\n\\nTap to browse: ${SHOP_URL}",
    "  return `${greet}It's Iman High Street, ${subject || 'fresh stock just landed'}.${itemsBlock}\\n\\nTap to browse: ${SHOP_URL}")
rep("const BC_PROG_KEY = 'ryker_bcprog';", "const BC_PROG_KEY = 'iman_bcprog';")
rep("const INSIGHTS_KEY = 'ryker_analytics';", "const INSIGHTS_KEY = 'iman_analytics';")
rep("const IG_USER_ID = '47659611317';", "const IG_USER_ID = '51870726026';")
rep("const MENSWEAR_CATEGORIES = ['Tshirts', 'Shirts', 'Polos', 'Jeans', 'Shorts', 'Joggers', 'Tracksuits', 'Hoodies', 'Jackets', 'Suits', 'Shoes', 'Sneakers', 'Boots', 'Caps'];",
    "const SHOP_CATEGORIES = ['Dresses', 'Suits', 'Blazers', 'Tops', 'Skirts', 'Trousers', 'Jeans', 'Shoes', 'Heels', 'Handbags', 'Accessories'];")
rep("const catOpts = MENSWEAR_CATEGORIES.map(c =>", "const catOpts = SHOP_CATEGORIES.map(c =>")
rep("    // Ryker is NEW-STOCK: stock is { \"M\":1, \"L\":1, \"XL\":1 } etc. Show every",
    "    // Iman is NEW-STOCK: stock is { \"M\":1, \"L\":1, \"XL\":1 } etc. Show every")

# Receipt
rep("    `*Ryker Luxury* receipt`,", "    `*Iman High Street* receipt`,")
rep("  lines.push(`Thank you for shopping with us. Legend Valley Business Park, Gitanga Road, Nairobi.`);",
    "  lines.push(`Thank you for shopping with us. CBK Pension Towers, Ground Floor, Harambee Avenue, Nairobi.`);")
rep('      <div class="rcpt-head">Ryker Luxury</div>', '      <div class="rcpt-head">Iman High Street</div>')
rep('      <div class="rcpt-sub">Legend Valley Business Park, Gitanga Road, Nairobi<br>0714 672 436</div>',
    '      <div class="rcpt-sub">CBK Pension Towers, Ground Floor, Harambee Avenue, Nairobi<br>0720 961 246</div>')

for old, new, n in edits:
    src = src.replace(old, new)
    print(f"ok: {old[:58]!r}")

io.open(p, "w", encoding="utf-8", newline="\n").write(src)
print("written.")
