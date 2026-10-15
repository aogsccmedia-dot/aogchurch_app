#!/usr/bin/env python3
"""Build FreeCreator Online (public/freecreator/app) from the desktop app's source (../scc-presenter).

The desktop app's own screens (control, shared, web outputs) are copied as they are; the only changes are:
  - absolute paths point at /freecreator/app/...
  - the control screen loads web-bridge.js (the browser version of the desktop bridge) first
  - output / stage windows get their live feed and media from the control window (BroadcastChannel + opener)
  - the AI fallbacks (no network needed) are extracted from src/main/ai.js into ai-local.js
Run:  python3 tools/freecreator/sync.py [path-to-scc-presenter]
"""
import re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "scc-presenter"
OUT = ROOT / "public" / "freecreator" / "app"
BASE = "/freecreator/app"

for sub in ("control", "shared", "web"):
    if (OUT / sub).exists(): shutil.rmtree(OUT / sub)
shutil.copytree(SRC / "src" / "shared", OUT / "shared")
shutil.copytree(SRC / "src" / "renderer" / "control", OUT / "control", ignore=shutil.ignore_patterns("mock.js"))
shutil.copytree(SRC / "src" / "renderer" / "web", OUT / "web", ignore=shutil.ignore_patterns("remote.*", "index.html"))

def rewrite(p: Path):
    s = p.read_text()
    for d in ("control", "shared", "web", "live"):
        s = s.replace(f'"/{d}/', f'"{BASE}/{d}/')
    p.write_text(s)
for p in list(OUT.rglob("*.html")) + list(OUT.rglob("*.js")) + list(OUT.rglob("*.css")):
    rewrite(p)
    t = p.read_text()
    p.write_text(t.replace("SCC Presenter", "FreeCreator"))   # the product's public name

# The control screen: the browser bridge first, and the page lives at /freecreator/app/
idx = (OUT / "control" / "index.html").read_text()
idx = idx.replace('<span class="name">Presenter</span>', '<span class="name">FreeCreator</span>').replace('<div class="boot-name">Presenter</div>', '<div class="boot-name">FreeCreator</div>')
idx = idx.replace("<title>SCC Presenter</title>", "<title>FreeCreator Online · Sandton City Church</title>")
(OUT / "index.html").write_text(idx)
(OUT / "control" / "index.html").unlink()

# control.js: no dev mock; media from the browser's own library
c = (OUT / "control" / "control.js").read_text()
c = c.replace('if (!window.scc) await import("./mock.js");', 'if (!window.scc) await import("../web-bridge.js");')
c = c.replace("const mediaUrl = (id) => `/media/${encodeURIComponent(id)}`;", "const mediaUrl = (id) => window.__fcMediaUrl?.(id) || \"\";")
# Shared church library: when someone else in the church changes a song or show, show it here straight away.
c += '\naddEventListener("fc:lib-changed", async () => { await reload(["songs", "shows"]); renderAll(); });\n'
(OUT / "control" / "control.js").write_text(c)

# Output / stage windows: live state from the control window
(OUT / "web" / "live.js").write_text('''// FreeCreator Online: output and stage windows follow the control window (same browser, BroadcastChannel).
export function subscribe(cb) {
  const ch = new BroadcastChannel("freecreator-live");
  ch.onmessage = (e) => { if (e.data?.type === "state") cb(e.data.state); };
  ch.postMessage({ type: "hello" });
  return () => ch.close();
}
export const mediaUrl = (id) => { try { return window.opener?.__fcMediaUrl?.(id) || window.__fcMediaUrl?.(id) || ""; } catch { return ""; } };
''')

# AI fallbacks without node
ai = (SRC / "src" / "main" / "ai.js").read_text()
topics = ai[ai.index("// Built-in topic list"):ai.index("export const PROVIDERS")]
fallbacks = ai[ai.index("// ── Built-in fallbacks"):]
(OUT / "ai-local.js").write_text('// Built-in AI fallbacks (no network), copied from the desktop app.\n'
    'import { parseLyrics, songToText, dedupeSections } from "./shared/lyrics.js";\n'
    'import { parseReference, formatReference } from "./shared/scripture.js";\n\n' + topics + "\n" + fallbacks)
print("FreeCreator Online built from", SRC)
