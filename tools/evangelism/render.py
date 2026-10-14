#!/usr/bin/env python3
"""Renders the evangelism pamphlet: a vector A4 PDF (sharp at any size), 600 dpi PNG pages for printing,
and small WebP previews for reading online. Usage: python3 tools/evangelism/render.py"""
import asyncio, pathlib
from PIL import Image
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parents[1] / "public" / "assets" / "evangelism"
OUT.mkdir(parents=True, exist_ok=True)
src = (HERE / "pamphlet.html").read_text().replace("{{QR}}", (HERE / "qr.svg").read_text())
tmp = HERE / "_render.html"; tmp.write_text(src)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        await pg.goto(tmp.as_uri()); await pg.wait_for_timeout(600)
        await pg.pdf(path=str(OUT / "good-news-pamphlet.pdf"), format="A4", print_background=True, prefer_css_page_size=True)
        # 600 dpi: A4 is 794 × 1123 CSS px at 96 dpi → scale 6.25 = 4961 × 7016 px per page.
        for scale, suffix in ((6.25, "600dpi"), (1.6, "web")):
            ctx = await b.new_context(viewport={"width": 794, "height": 1123}, device_scale_factor=scale)
            q = await ctx.new_page(); await q.goto(tmp.as_uri()); await q.wait_for_timeout(600)
            for i, el in enumerate(await q.query_selector_all(".page"), 1):
                png = OUT / f"good-news-{i}-{suffix}.png"
                await el.screenshot(path=str(png))
                im = Image.open(png).convert("RGB")
                if suffix == "web":
                    im.save(png.with_suffix(".webp"), "WEBP", quality=84, method=6); png.unlink()
                else:   # print copy: 600 dpi JPEG at top quality (far smaller than PNG, no visible loss)
                    im.save(png.with_suffix(".jpg"), "JPEG", quality=95, subsampling=0, optimize=True, dpi=(600, 600)); png.unlink()
            await ctx.close()
        await b.close()
    tmp.unlink()
    for f in sorted(OUT.iterdir()): print(f.name, f.stat().st_size // 1024, "KB")

asyncio.run(main())
