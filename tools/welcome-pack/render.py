# Builds public/assets/welcome-pack.pdf from pack.html (A4 landscape). Run: python3 tools/welcome-pack/render.py
import asyncio, pathlib
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).parent
OUT = HERE.parent.parent / "public" / "assets" / "welcome-pack.pdf"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.goto((HERE / "pack.html").as_uri()); await pg.wait_for_timeout(800)
        await pg.pdf(path=str(OUT), width="297mm", height="210mm", print_background=True, prefer_css_page_size=True)
        await b.close()
    print("wrote", OUT, OUT.stat().st_size // 1024, "KB")
asyncio.run(main())

# The in-app viewer (/welcome-pack) shows each page as an image, so it opens instantly on any phone or the installed app.
import subprocess, tempfile, glob
from PIL import Image
pages = OUT.parent / "welcome-pack"; pages.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as t:
    subprocess.run(["pdftoppm", "-r", "150", "-png", str(OUT), f"{t}/p"], check=True)
    for i, f in enumerate(sorted(glob.glob(f"{t}/p-*.png")), 1):
        im = Image.open(f).convert("RGB"); im.thumbnail((1600, 1600)); im.save(pages / f"page-{i}.webp", "WEBP", quality=82)
print("wrote page images to", pages)
