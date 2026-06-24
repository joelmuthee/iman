# Fleet rollout: collapse the manual add-item form + the WhatsApp Marketing
# section into mobile-safe <details> toggles. Hard assertions abort on any
# structural mismatch so a divergent shop fails loudly instead of shipping broken.
#
# Usage: python collapse_rollout.py <shop_dir> <pill_text_hex>
#   pill_text_hex: dark text for light accents (#1c1208) or #ffffff for dark accents.
import io, re, sys

shop = sys.argv[1]
PILLTEXT = sys.argv[2]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ---------- admin.html ----------
hp = f"{shop}/admin.html"
h = io.open(hp, encoding="utf-8").read()

def sub1(pattern, repl, label, flags=0):
    global h
    new, n = re.subn(pattern, repl, h, flags=flags)
    assert n == 1, f"{shop}: '{label}' matched {n} (need 1)"
    h = new

# already done? bail
assert 'id="manualEntry"' not in h, f"{shop}: already has manualEntry — skipping"

# 1. manual divider -> details + gold-pill summary (handle any divider class / markup)
PILL = ('<details class="manual-entry" id="manualEntry">\n'
        '    <summary class="manual-entry-divider" id="manualEntryDivider">\n'
        '      <span class="me-row"><span class="me-pill"><svg class="me-plus" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add an item manually</span></span>\n'
        '    </summary>')
sub1(r'<div class="(?:manual-entry-divider|manual-divider|form-or-divider)" id="manualEntryDivider">.*?</div>',
     lambda m: PILL, "manual divider", flags=re.DOTALL)

# 2. close the manual-entry <details> after the Save/Cancel actions row
sub1(r'(id="cancelBtn"[^>]*>Cancel edit</button>\s*\n\s*</div>)(\s*\n\s*</div>)',
     lambda m: m.group(1) + "\n    </details>" + m.group(2), "manual details close")

# 3. WhatsApp Marketing section -> collapsible (h2 becomes the summary)
sub1(r'(<section class="dash" id="broadcastDash">\s*\n\s*)<h2 class="dash-title">WhatsApp Marketing</h2>',
     lambda m: m.group(1) + '<details class="dash-collapse" id="broadcastCollapse">\n    <summary class="dash-summary"><h2 class="dash-title">WhatsApp Marketing</h2></summary>',
     "broadcast summary")
# close before </section>: shops with a mobile stepper end on the stepper div;
# the localStorage exception (Panache) + Bonnie have no stepper, ending on the
# broadcastStatus <p>. Try the stepper close first, fall back to the <p> close.
_n1 = len(re.findall(r'id="broadcastStepper"[^>]*></div>\s*\n\s*</div>\s*\n\s*</section>', h))
if _n1 == 1:
    sub1(r'(id="broadcastStepper"[^>]*></div>\s*\n\s*</div>)(\s*\n\s*</section>)',
         lambda m: m.group(1) + "\n    </details>" + m.group(2), "broadcast details close (stepper)")
else:
    sub1(r'(id="broadcastStatus"[^>]*></p>\s*\n\s*</div>)(\s*\n\s*</section>)',
         lambda m: m.group(1) + "\n    </details>" + m.group(2), "broadcast details close (no-stepper)")

io.open(hp, "w", encoding="utf-8", newline="\n").write(h)
print(f"{shop}: admin.html ok")

# ---------- styles.css ----------
cp = f"{shop}/styles.css"
c = io.open(cp, encoding="utf-8").read()
assert ".me-pill" not in c, f"{shop}: CSS already has .me-pill"
CSS = '''

/* ===== Collapsible admin sections (mobile-safe) — fleet rollout 2026-06-11 =====
   Manual add-item form + WhatsApp Marketing collapse into native <details>.
   CRITICAL: a <summary> with display:flex breaks native <details> toggling in
   Safari / mobile WebKit, so summaries stay display:block (flex on inner .me-row)
   AND the toggles are JS-driven (preventDefault + flip .open) — see admin.js. */
.manual-entry { margin: 14px 0 0; }
summary.manual-entry-divider { display: block; list-style: none; cursor: pointer; user-select: none; margin: 10px 0; }
summary.manual-entry-divider::-webkit-details-marker { display: none; }
summary.manual-entry-divider::marker { content: ""; }
.manual-entry .me-row { display: flex; align-items: center; gap: 12px; }
.manual-entry .me-row::before, .manual-entry .me-row::after { content: ""; flex: 1; height: 1px; background: var(--line, #e5e0d5); }
.manual-entry .me-pill {
  display: inline-flex; align-items: center; gap: 9px; white-space: nowrap;
  background: var(--gold); color: PILLTEXT;
  padding: 12px 24px; border-radius: 999px;
  font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: 0 3px 12px rgba(0,0,0,0.16);
  transition: transform 0.18s, box-shadow 0.18s, filter 0.18s;
}
.manual-entry .me-plus { transition: transform 0.2s ease; }
.manual-entry[open] .me-plus { transform: rotate(45deg); }
summary.manual-entry-divider:hover .me-pill { transform: translateY(-1px); box-shadow: 0 5px 16px rgba(0,0,0,0.22); filter: brightness(0.96); }
summary.manual-entry-divider:active .me-pill { transform: translateY(0); }

.dash-collapse { margin: 0; }
summary.dash-summary { display: block; list-style: none; cursor: pointer; user-select: none; position: relative; }
summary.dash-summary::-webkit-details-marker { display: none; }
summary.dash-summary::marker { content: ""; }
summary.dash-summary .dash-title { margin-bottom: 0; padding-right: 28px; }
.dash-collapse[open] summary.dash-summary .dash-title { margin-bottom: 18px; }
summary.dash-summary::after { content: "\\203A"; position: absolute; right: 2px; top: 6px; font-size: 24px; line-height: 1; color: var(--gold-deep, var(--gold)); transform: rotate(90deg); transition: transform 0.18s ease; }
.dash-collapse[open] summary.dash-summary::after { transform: rotate(-90deg); }
'''.replace("PILLTEXT", PILLTEXT)
io.open(cp, "w", encoding="utf-8", newline="\n").write(c + CSS)
print(f"{shop}: styles.css ok")

# ---------- admin.js ----------
jp = f"{shop}/admin.js"
j = io.open(jp, encoding="utf-8").read()
assert "getElementById('manualEntry')" not in j, f"{shop}: admin.js already wired"

def jsub(pattern, repl, label, need=1, flags=0):
    global j
    new, n = re.subn(pattern, repl, j, flags=flags)
    assert n == need, f"{shop}: JS '{label}' matched {n} (need {need})"
    j = new

# auto-open on edit, re-collapse on reset (Ryker-fork uses `manualDivider`)
jsub(r"(if \(manualDivider\) manualDivider\.style\.display = 'none';)",
     lambda m: m.group(1) + "\n  { const _me = document.getElementById('manualEntry'); if (_me) _me.open = true; }",
     "editItem auto-open")
jsub(r"(if \(manualDivider\) manualDivider\.style\.display = '';)",
     lambda m: m.group(1) + "\n  { const _me = document.getElementById('manualEntry'); if (_me) _me.open = false; }",
     "resetForm re-collapse")
# reveal auto-filled fields after an IG quick-add fetch
jsub(r"(status\.className = 'ig-quick-status ok';)",
     lambda m: "{ const _me = document.getElementById('manualEntry'); if (_me) _me.open = true; }\n    " + m.group(1),
     "ig-fetch auto-open", need=1)

# mobile-safe JS-driven toggles + nav auto-opens, appended at EOF
j = j.rstrip() + '''

// ===== Mobile-safe collapsible toggles (fleet rollout 2026-06-11) =====
// Drive each <details> from JS (preventDefault + flip .open). A <summary> with
// display:flex breaks native <details> toggling in Safari / mobile WebKit; JS
// ownership sidesteps it. See CATALOG-STANDARDS.md.
(function () {
  var manualEntry = document.getElementById('manualEntry');
  var manualSummary = document.getElementById('manualEntryDivider');
  if (manualSummary) manualSummary.addEventListener('click', function (e) { e.preventDefault(); if (manualEntry) manualEntry.open = !manualEntry.open; });
  var addLink = document.querySelector('.admin-nav a[href="#addForm"]');
  if (addLink) addLink.addEventListener('click', function () { if (manualEntry) manualEntry.open = true; });

  var broadcastCollapse = document.getElementById('broadcastCollapse');
  var broadcastSummary = broadcastCollapse ? broadcastCollapse.querySelector('summary.dash-summary') : null;
  if (broadcastSummary) broadcastSummary.addEventListener('click', function (e) { e.preventDefault(); broadcastCollapse.open = !broadcastCollapse.open; });
  var bcLink = document.querySelector('.admin-nav a[href="#broadcastDash"]');
  if (bcLink) bcLink.addEventListener('click', function () { if (broadcastCollapse) broadcastCollapse.open = true; });
})();
'''
io.open(jp, "w", encoding="utf-8", newline="\n").write(j)
print(f"{shop}: admin.js ok")
print(f"{shop}: DONE")
