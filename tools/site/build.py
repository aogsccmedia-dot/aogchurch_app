#!/usr/bin/env python3
"""Build the static public pages.

Each page body lives in tools/site/pages/<name>.html. This script wraps it in the shared
<head>, header, menu and footer, inlines Lucide icons ({{i:name}} / {{arrow}}) and writes
public/<name>.html. Run it after editing any page:  python3 tools/site/build.py
"""
import hashlib
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent / "public"
SITE = "https://aogsccyouth.com"

SOCIALS = [
    ("YouTube", "youtube", "https://www.youtube.com/@aogsandtoncitychurchtv9989"),
    ("Instagram", "instagram", "https://www.instagram.com/aogsandtoncitychurch"),
    ("Facebook", "facebook", "https://www.facebook.com/AOGSandtonCity/"),
    ("TikTok", "tiktok", "https://www.tiktok.com/@aog.sandton.city"),
]

# Primary pages (header + menu), in order.
NAV = [
    ("/", "Home"),
    ("/about", "About"),
    ("/events", "Services &amp; events"),
    ("/get-involved", "Get involved"),
    ("/prayer", "Prayer"),
    ("/visit", "Visit &amp; contact"),
]
# Full menu (phone menu): includes the About sub-pages.
MENU = [NAV[0], NAV[1], ("/our-story", "Our story"), ("/beliefs", "What we believe")] + NAV[2:]
# Reading order for the "Previous / Next page" buttons at the bottom of content pages.
ORDER = [("/", "Home"), ("/about", "About us"), ("/our-story", "Our story"), ("/beliefs", "What we believe"), ("/events", "Services &amp; events"),
         ("/get-involved", "Get involved"), ("/prayer", "Prayer"), ("/visit", "Visit &amp; contact"), ("/join", "Join the church")]
LEGAL = [
    ("/privacy", "Privacy policy (POPIA)"),
    ("/data-protection", "Data protection &amp; PAIA"),
    ("/code-of-conduct", "Code of conduct"),
    ("/complaints", "Complaints policy"),
    ("/payments", "Event payments &amp; refunds"),
    ("/terms", "Terms of use"),
    ("/cookies", "Cookie policy"),
]

SPECULATION = json.dumps({
    "prerender": [{"where": {"and": [{"href_matches": "/*"}, {"not": {"href_matches": "/admin/*"}}, {"not": {"href_matches": "/api/*"}}]}, "eagerness": "moderate"}]
})


def ver(rel):
    """Short content hash so browsers always fetch the stylesheet/script version a page was built with."""
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()[:10]


def head(title, desc, canonical=None, noindex=False, extra=""):
    robots = '\n  <meta name="robots" content="noindex">' if noindex else '\n  <meta name="robots" content="index, follow, max-image-preview:large">'
    canon = f'\n  <link rel="canonical" href="{SITE}{canonical}">\n  <meta property="og:url" content="{SITE}{canonical}">' if canonical else ""
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{title}</title>
  <meta name="description" content="{desc}">
  <meta name="theme-color" content="#f6f1e8">{robots}{canon}
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="AOG SCC">
  <meta name="application-name" content="AOG Sandton City Church">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AOG Sandton City Church">
  <meta property="og:locale" content="en_ZA">
  <meta property="og:image:alt" content="AOG Sandton City Church, Woodmead, Sandton">
  <meta name="geo.region" content="ZA-GP">
  <meta name="geo.placename" content="Woodmead, Sandton">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <meta property="og:image" content="{SITE}/assets/og.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/assets/logo-192.png" type="image/png">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="preconnect" href="https://accounts.google.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;350;400;450;500&family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/base.css?v={ver('css/base.css')}">
  <link rel="stylesheet" href="/css/pages.css?v={ver('css/pages.css')}">
  <script src="/js/switch-boot.js?v={ver('js/switch-boot.js')}"></script>
  <script type="speculationrules">{SPECULATION}</script>{extra}
</head>'''


MENU_GROUPS = [
    ("Explore", [("/", "Home"), ("/about", "About us"), ("/our-story", "Our story"), ("/beliefs", "What we believe")]),
    ("Church life", [("/events", "Services &amp; events"), ("/get-involved", "Get involved"), ("/prayer", "Prayer"), ("/visit", "Visit &amp; contact")]),
    ("For you", [("/me", "My profile"), ("/me#complaints", "Raise a concern"), ("/#letter", "Weekly letter"), ("/app", "Get the app")]),
]


def header():
    primary = "".join(f'<a href="{h}">{t}</a>' for h, t in NAV[1:])
    groups = "".join(
        f'<div class="menu-group" style="--g:{gi}"><p class="menu-label">{label}</p>'
        + "".join(f'<a href="{h}" style="--i:{ii}">{t}</a>' for ii, (h, t) in enumerate(items))
        + "</div>" for gi, (label, items) in enumerate(MENU_GROUPS))
    socials = "".join(f'<a href="{u}" target="_blank" rel="noopener" aria-label="{n}">{{{{i:{ic}}}}}</a>' for n, ic, u in SOCIALS)
    return f'''
  <a class="sr-only" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap bar">
      <div class="header-left">
        <button class="icon-btn menu-btn" data-menu-open aria-label="Open menu" aria-expanded="false" aria-controls="menu"><span class="burger" aria-hidden="true"><i></i><i></i></span></button>
        <a class="brand" href="/" aria-label="AOG Sandton City Church home"><img src="/assets/logo-64.png" alt="" width="34" height="34"><span>Sandton City Church</span></a>
      </div>
      <nav class="main-nav" aria-label="Primary">{primary}</nav>
      <div class="header-actions"><span data-user-slot></span><a class="btn btn-gold" href="/join" data-join-cta><span>Join<span class="long"> church</span></span></a></div>
    </div>
    <div class="scroll-progress" aria-hidden="true"></div>
  </header>

  <div class="menu" id="menu" aria-hidden="true">
    <div class="menu-inner">
      <div class="bar">
        <a class="brand" href="/"><img src="/assets/logo-64.png" alt="" width="34" height="34"><span>Sandton City Church</span></a>
        <button class="icon-btn" data-menu-close aria-label="Close menu">{{{{i:x}}}}</button>
      </div>
      <nav class="menu-groups" aria-label="Main">{groups}</nav>
      <div class="menu-foot">
        <a class="btn btn-gold" href="/join" data-join-cta>Join the church {{{{arrow}}}}</a>
        <div class="social-row">{socials}</div>
        <span class="menu-addr">{{{{i:mapPin}}}} 17 Humber Street, Woodmead, Sandton</span>
      </div>
    </div>
  </div>
'''


def footer():
    li = lambda items: "".join(f'<li><a href="{h}">{t}</a></li>' for h, t in items)
    socials = "".join(f'<a href="{u}" target="_blank" rel="noopener" aria-label="{n}" title="{n}">{{{{i:{ic}}}}}</a>' for n, ic, u in SOCIALS)
    church = [("/about", "About us"), ("/our-story", "Our story"), ("/beliefs", "What we believe"), ("/events", "Services &amp; events"), ("/get-involved", "Get involved"), ("/visit", "Visit &amp; contact")]
    members = [("/join", "Join the church"), ("/me", "My profile"), ("/prayer", "Prayer requests"), ("/me#complaints", "Raise a concern"), ("/#letter", "Weekly letter"), ("/app", "Get the app")]
    return f'''
  <footer class="site-footer">
    <div class="wrap">
      <div class="foot-cta">
        <div><p class="eyebrow gold">There's a seat saved for you</p><h2>Come as you are this <span class="serif">Sunday.</span></h2></div>
        <div class="foot-cta-actions"><a class="btn btn-gold" href="/visit">Plan your visit {{{{arrow}}}}</a><a class="btn" href="/events">See services</a></div>
      </div>
      <div class="cols">
        <div class="foot-brand">
          <a class="brand" href="/"><img src="/assets/logo-64.png" alt="" width="34" height="34"><span>Sandton City Church</span></a>
          <p>A community-centred, Bible-based, Spirit-filled church. Part of the Assemblies of God family.</p>
          <address>{{{{i:mapPin}}}} <a href="https://maps.google.com/?q=17+Humber+Street,+Woodmead,+Sandton" target="_blank" rel="noopener">17 Humber Street, Woodmead, Sandton</a></address>
          <div class="social-row">{socials}</div>
        </div>
        <div><h4>Our church</h4><ul>{li(church)}</ul></div>
        <div><h4>Members</h4><ul>{li(members)}</ul></div>
        <div><h4>Policies &amp; compliance</h4><ul>{li(LEGAL)}</ul></div>
      </div>
      <div class="legal">
        <span>© <span id="year">2026</span> AOG Sandton City Church · POPIA compliant</span>
        <span class="legal-links"><button type="button" class="link-btn" data-cookie-settings>Cookie settings</button><a href="/data-protection#requests">Access to information (PAIA)</a><button type="button" class="link-btn" data-to-top>Back to top ↑</button></span>
      </div>
    </div>
  </footer>
'''


CHURCH = {
    "@type": "Church", "@id": f"{SITE}/#church",
    "name": "AOG Sandton City Church",
    "alternateName": ["Sandton City Church", "Assemblies of God Sandton City Church", "SCC", "SCC Youth", "AOG Sandton City"],
    "description": "A community-centred, Bible-based, Spirit-filled Assemblies of God church at 17 Humber Street, Woodmead, Sandton.",
    "url": f"{SITE}/", "logo": f"{SITE}/assets/logo-512.png",
    "image": [f"{SITE}/assets/og.jpg", f"{SITE}/assets/photos/congregation-1200.jpg", f"{SITE}/assets/photos/worship-1200.jpg"],
    "address": {"@type": "PostalAddress", "streetAddress": "17 Humber Street", "addressLocality": "Woodmead, Sandton", "addressRegion": "Gauteng", "addressCountry": "ZA"},
    "areaServed": ["Sandton", "Woodmead", "Johannesburg"],
    "hasMap": "https://maps.google.com/?q=17+Humber+Street,+Woodmead,+Sandton",
    "sameAs": [u for _, _, u in SOCIALS],
}
WEBSITE = {"@type": "WebSite", "@id": f"{SITE}/#website", "url": f"{SITE}/", "name": "Sandton City Church",
           "alternateName": ["AOG Sandton City Church", "SCC"], "publisher": {"@id": f"{SITE}/#church"}, "inLanguage": "en-ZA"}


def ld(*nodes):
    return '\n  <script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@graph": list(nodes)}) + "</script>"


def crumbs_ld(canonical, title):
    if not canonical or canonical == "/":
        return ""
    trail = [("/", "Home")]
    if canonical in ("/our-story", "/beliefs"):
        trail.append(("/about", "About us"))
    trail.append((canonical, title))
    return ld({"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i, "name": t, "item": f"{SITE}{h}"} for i, (h, t) in enumerate(trail, 1)]})


def pager(canonical):
    """Previous / next page buttons, so every content page leads somewhere."""
    paths = [h for h, _ in ORDER]
    if canonical not in paths or canonical == "/join":
        return ""
    i = paths.index(canonical)
    prev = ORDER[i - 1] if i > 0 else None
    nxt = ORDER[i + 1] if i + 1 < len(ORDER) else None
    def link(item, cls, label):
        return f'<a class="pager-link {cls}" href="{item[0]}"><span>{label}</span><b>{item[1]}</b></a>' if item else "<span></span>"
    return ('\n  <nav class="pager" aria-label="Keep exploring">\n    <div class="wrap">'
            + link(prev, "prev", "{{i:arrowLeft}} Previous") + link(nxt, "next", "Next {{i:arrowRight}}") + "</div>\n  </nav>\n")


TABBAR = """
  <nav class="tabbar" aria-label="Quick navigation">
    <a href="/">{{i:home}}<span>Home</span></a>
    <a href="/events">{{i:calendar}}<span>Events</span></a>
    <a href="/join" class="tab-join" data-join-cta data-tab-me>{{i:user}}<span>Join</span></a>
    <a href="/prayer">{{i:handHeart}}<span>Prayer</span></a>
    <button type="button" data-menu-open-tab aria-controls="menu">{{i:menu}}<span>More</span></button>
  </nav>
"""

C = "Sandton City Church"
T = f" · {C}"
PAGES = {
    "index": dict(title="AOG Sandton City Church · Church in Woodmead, Sandton", desc="AOG Sandton City Church: a community-centred, Bible-based, Spirit-filled church at 17 Humber Street, Woodmead, Sandton. Sunday services, youth ministry, events and a weekly letter.", canonical="/", scripts=["site.js", "auth.js", "pages.js", "word.js"],
                  extra='\n  <link rel="preload" as="image" href="/assets/photos/worship-1600.webp" type="image/webp">' + ld(CHURCH, WEBSITE)),
    "about": dict(title="About us" + T, crumb="About us", desc="Who we are: AOG Sandton City Church is an Assemblies of God family in Woodmead, Sandton — Bible-based, community-centred and Spirit-filled.", canonical="/about", scripts=["site.js", "auth.js", "pages.js", "programme.js"]),
    "our-story": dict(title="Our story" + T, crumb="Our story", desc="The story of AOG Sandton City Church: part of the worldwide Assemblies of God family, at home in Woodmead, Sandton, with a youth ministry on fire.", canonical="/our-story", scripts=["site.js", "auth.js", "pages.js"]),
    "beliefs": dict(title="What we believe" + T, crumb="What we believe", desc="What AOG Sandton City Church believes about the Bible, God, Jesus, salvation, the Holy Spirit, baptism, healing and the church.", canonical="/beliefs", scripts=["site.js", "auth.js", "pages.js"]),
    "events": dict(title="Services & events" + T, crumb="Services & events", desc="Sunday services and upcoming events at Sandton City Church, Woodmead. Register online, pay by EFT and add events to your calendar.", canonical="/events", scripts=["site.js", "auth.js", "pages.js", "programme.js"]),
    "get-involved": dict(title="Get involved" + T, crumb="Get involved", desc="Find your place on the team at Sandton City Church — worship, media, hospitality, kids, youth and more.", canonical="/get-involved", scripts=["site.js", "auth.js", "pages.js"]),
    "prayer": dict(title="Prayer requests" + T, crumb="Prayer", desc="Send a prayer request to Sandton City Church. Our prayer team will stand with you — anonymously if you prefer.", canonical="/prayer", scripts=["site.js", "auth.js", "pages.js", "wall.js"]),
    "visit": dict(title="Visit & contact" + T, crumb="Visit & contact", desc="Visit Sandton City Church at 17 Humber Street, Woodmead, Sandton. Directions, what to expect, and how to contact us.", canonical="/visit", scripts=["site.js", "auth.js", "pages.js"]),
    "join": dict(title="Join the church" + T, crumb="Join the church", desc="Join AOG Sandton City Church. Tell us a little about you and a leader will reach out personally.", canonical="/join", scripts=["site.js", "auth.js", "join.js"]),
    "event": dict(title="Event" + T, desc="Register for an upcoming service or event at Sandton City Church.", scripts=["site.js", "auth.js", "event.js"]),
    "me": dict(title="My profile" + T, body="portal", desc="Your profile, events and weekly letter settings.", noindex=True, scripts=["site.js", "auth.js", "me.js", "word.js", "programme.js"]),
    "privacy": dict(title="Privacy policy" + T, crumb="Privacy policy", desc="How AOG Sandton City Church handles your personal information under POPIA.", canonical="/privacy", scripts=["site.js", "auth.js"]),
    "terms": dict(title="Terms of use" + T, crumb="Terms of use", desc="The terms for using the Sandton City Church website, accounts and event registrations.", canonical="/terms", scripts=["site.js", "auth.js"]),
    "payments": dict(title="Event payments & refunds" + T, crumb="Event payments & refunds", desc="How EFT payments, proof of payment, verification and refunds work for Sandton City Church events.", canonical="/payments", scripts=["site.js", "auth.js"]),
    "cookies": dict(title="Cookie policy" + T, crumb="Cookie policy", desc="The cookies and on-device storage the Sandton City Church website uses, and how to change your choices.", canonical="/cookies", scripts=["site.js", "auth.js"]),
    "code-of-conduct": dict(title="Code of conduct" + T, crumb="Code of conduct", desc="How we treat one another at Sandton City Church: respect, honesty, safety, and keeping children and young people safe.", canonical="/code-of-conduct", scripts=["site.js", "auth.js"]),
    "complaints": dict(title="Complaints policy" + T, crumb="Complaints policy", desc="How to raise a complaint at Sandton City Church and what to expect: acknowledgement, a response within 7 working days, confidentiality.", canonical="/complaints", scripts=["site.js", "auth.js"]),
    "data-protection": dict(title="Data protection, POPIA & PAIA" + T, crumb="Data protection", desc="Sandton City Church's data protection standards: Information Officer, security, retention, breach notification and your POPIA/PAIA rights.", canonical="/data-protection", scripts=["site.js", "auth.js"]),
    "app": dict(title="Get the app" + T, crumb="Get the app", desc="Add Sandton City Church to your phone's home screen — iPhone, Android or computer.", canonical="/app", scripts=["site.js", "auth.js"]),
    "ticket": dict(title="Your ticket" + T, desc="Your digital ticket for an event at Sandton City Church.", noindex=True, scripts=["site.js", "auth.js", "ticket.js"]),
    "membership": dict(title="Your membership" + T, body="portal", desc="Confirm or manage your membership at Sandton City Church.", noindex=True, scripts=["site.js", "membership.js"]),
    "offline": dict(title="You're offline" + T, desc="You're offline.", noindex=True, scripts=["site.js"]),
    "404": dict(title="Page not found" + T, desc="Page not found.", noindex=True, scripts=["site.js", "auth.js"]),
}

ICON_SRC = (ROOT / "js/icons.js").read_text()
ICONS = dict(re.findall(r"^  (\w+): '(.*?)',$", ICON_SRC, re.M))
SVG = '<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{p}</svg>'


def icons(html):
    html = html.replace("{{arrow}}", SVG.format(cls="arr", p=ICONS["arrowRight"]))
    return re.sub(r"\{\{i:(\w+)\}\}", lambda m: SVG.format(cls="i", p=ICONS[m.group(1)]), html)


def legal_page(body):
    """Pages marked <!--LEGAL--> get an auto-generated 'On this page' index from their <h2 id> headings."""
    if "<!--LEGAL-->" not in body:
        return body
    toc = "".join(f'<a href="#{i}">{t}</a>' for i, t in re.findall(r'<h2 id="([\w-]+)">(.*?)</h2>', body))
    others = "".join(f'<a href="{h}">{t}</a>' for h, t in LEGAL)
    return body.replace("<!--LEGAL-->", f'<aside class="legal-nav"><p class="eyebrow">On this page</p><nav>{toc}</nav><p class="eyebrow">Policies</p><nav class="policy-links">{others}</nav></aside>')


def main():
    for name, o in PAGES.items():
        body = legal_page((HERE / "pages" / f"{name}.html").read_text())
        scripts = "\n".join(f'  <script type="module" src="/js/{s}?v={ver("js/" + s)}"></script>' for s in o["scripts"])
        extra = o.get("extra", "") + crumbs_ld(o.get("canonical"), o.get("crumb", ""))
        html = (head(o["title"].replace("&", "&amp;"), o["desc"], o.get("canonical"), o.get("noindex", False), extra) + (f'\n<body class="{o["body"]}">' if o.get("body") else "\n<body>") + header()
                + body.replace("  </main>\n", "  </main>\n" + pager(o.get("canonical")), 1) + footer() + TABBAR + scripts + "\n</body>\n</html>\n")
        (ROOT / f"{name}.html").write_text(icons(html))
        print("wrote", f"{name}.html")
    # The admin page isn't generated, but gets the same cache-busting versions.
    adm = ROOT / "admin/index.html"
    a = adm.read_text()
    a = re.sub(r'(href|src)="/(css/[\w.-]+\.css|js/[\w.-]+\.js)(\?v=\w+)?"', lambda m: f'{m.group(1)}="/{m.group(2)}?v={ver(m.group(2))}"', a)
    adm.write_text(a)
    pri = {"/": "1.0", "/events": "0.9", "/about": "0.8", "/visit": "0.8", "/join": "0.8"}
    urls = [o["canonical"] for o in PAGES.values() if o.get("canonical")]
    (ROOT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{SITE}{u}</loc><changefreq>weekly</changefreq><priority>{pri.get(u, '0.5')}</priority></url>\n" for u in urls) + "</urlset>\n")
    print("wrote sitemap.xml")


if __name__ == "__main__":
    main()
