#!/usr/bin/env python3
"""Optional Playwright E2E; starts Python server and tests real browser UI.

Dependencies (CI only): pip install -r requirements-qa.txt
                           python -m playwright install chromium
No external market API, accounts or network telemetry are accessed.
"""
from __future__ import annotations

import asyncio
import math
import os
import re
from pathlib import Path
import socket
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen

try:
    from playwright.async_api import async_playwright
except ImportError as error:
    raise SystemExit("Install optional Playwright via pip install -r requirements-qa.txt") from error

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("MSAS_QA_ARTIFACTS", str(ROOT / "qa-artifacts")))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


PRIMARY_LABELS = ("MAIN · ESTABLISHED", "MAIN · CONTINUATION", "MSS · S+ STRONG")


async def chart_state(page) -> dict:
    return await page.evaluate("""() => {
        const s = window.MSASChartDebug.state();
        return {current: s.current, follow: s.follow, dataLen: s.dataLen, range: s.visibleRange,
                seriesTimes: s.seriesTimes, lastTime: s.lastTime, lines: s.lines, markers: s.markers,
                times: s.times, legend: s.legend, visibleCount: s.visibleCount,
                firstVisible: s.firstVisible, datasetId: s.datasetId};
    }""")


def visible_bars(state: dict) -> int:
    """Bars whose centre is inside the pane (computed by the page from timeScale().timeToCoordinate)."""
    return state["visibleCount"]


async def wait_dataset(page, dataset_id: str) -> None:
    await page.wait_for_function(
        f"window.MSASChartDebug && window.MSASChartDebug.state().datasetId === '{dataset_id}'", timeout=12000)
    await page.wait_for_timeout(100)


PRICE = re.compile(r"\d{4}\.\d")
LEVEL_WORDS = re.compile(r"\b(MH|ML|iSH|iSL)\b")


async def assert_no_panel_prices(page, where) -> None:
    """User rule: MH/ML/iSH/iSL values exist on the chart only, never in hero, feed or structure panels."""
    for selector in ("#hero", "#events", "#structureSnapshot", "#chartStructureSummary"):
        text = await page.locator(selector).inner_text()
        assert not PRICE.search(text) and not LEVEL_WORDS.search(text), (where, selector, text)


async def scrub(page, index: int) -> None:
    await page.locator("#scrubber").fill(str(index))
    await page.locator("#scrubber").dispatch_event("input")
    await page.wait_for_timeout(120)


async def assert_feed_primary_only(page, where: str) -> None:
    labels = await page.locator(".signal-row .minor > span:first-child").all_inner_texts()
    assert all(label in PRIMARY_LABELS for label in labels), (where, labels)
    hero = await page.locator("#heroCategory").inner_text()
    assert hero.startswith(PRIMARY_LABELS) or hero.startswith("MAIN TREND"), (where, hero)
    assert len(labels) <= 5, (where, labels)
    await assert_no_panel_prices(page, where)
    text = (await page.locator("#events").inner_text()) + (await page.locator("#hero").inner_text())
    for banned in ("LOCAL SWING", "INSIDE BAR", "CISD", "MSS · C", "INTERNAL ·", "LEVELS UPDATED"):
        assert banned not in text, (where, banned, text)


async def chart_checks(page, name: str, dataset: str = "xauusd-20250618", bars: int = 48) -> None:
    """V6 user amendment 2026-11-19: TradingView Lightweight Charts behaviour.

    Needs the 48-bar XAU 2025-06-18 dataset: S+ at bar 30, CISD B at 29, C at 37."""
    await page.locator("#datasetSelect").select_option("xauusd-sample")
    await wait_dataset(page, "xauusd-sample")
    await scrub(page, 24)
    st = await chart_state(page)
    assert st["lines"], "precondition: XAU sample at 24 has chart levels"
    await page.locator("#datasetSelect").select_option(dataset)
    await wait_dataset(page, dataset)
    st = await chart_state(page)
    assert st["lines"] == [] and st["markers"] == [] and st["current"] == 0 and st["dataLen"] == 1, ("stale after switch", st)
    await page.wait_for_function(f"document.querySelector('#progressCount').textContent.includes('{bars}')", timeout=12000)
    assert await page.locator("#chart canvas").count() >= 1, "Lightweight Charts canvas missing"
    pixel = await page.evaluate("""() => Array.from(window.MSASChartDebug.chart.takeScreenshot()
                                   .getContext('2d').getImageData(4, 4, 1, 1).data)""")
    assert pixel == [198, 210, 223, 255], f"Unexpected chart background RGBA: {pixel}"
    # --- rolling 40-bar window, no future candle
    await scrub(page, 10)
    st = await chart_state(page)
    assert st["follow"] and st["dataLen"] == 11, st["dataLen"]
    if st["seriesTimes"] is None:
        print("NOT VERIFIED: series.data() unavailable; used dataLen only")
    else:
        assert len(st["seriesTimes"]) == 11 and max(st["seriesTimes"]) == st["times"][10], "future bar in series data"
    await scrub(page, 39)
    st = await chart_state(page)
    assert visible_bars(st) == 40 and st["firstVisible"] == 0, st   # scrub 39 still shows bar 0
    await scrub(page, 40)
    st = await chart_state(page)
    assert visible_bars(st) == 40 and st["firstVisible"] == 1, st   # scrub 40 rolled bar 0 out
    await scrub(page, 47)
    st = await chart_state(page)
    assert visible_bars(st) == 40, (visible_bars(st), st["range"])
    assert st["range"]["to"] - st["range"]["from"] < 45, st["range"]
    if st["seriesTimes"] is not None:
        assert len(st["seriesTimes"]) == 48 and st["seriesTimes"][-1] == st["lastTime"]
    # --- structure on the chart, panels only carry trend state
    titles = [line["title"] for line in st["lines"]]
    assert any(t.startswith("MH 3396.648") for t in titles) and any(t.startswith("ML 3373.545") for t in titles), titles
    panels = (await page.locator("#structureSnapshot").inner_text()) + (await page.locator("#chartStructureSummary").inner_text())
    assert not PRICE.search(panels) and not LEVEL_WORDS.search(panels), panels
    await assert_no_panel_prices(page, "t=47")
    assert "confirmed" in panels or "awaiting" in panels or "collecting" in panels, panels
    # --- S+ marker on its closed bar; C/B only in the Diagnostics layer
    await scrub(page, 30)
    st = await chart_state(page)
    assert any(m["text"] == "S+" and m["time"] == st["times"][30] for m in st["markers"]), st["markers"]
    assert not any(m["text"] in ("MSS C", "CISD B") for m in st["markers"]), "diagnostics must be hidden by default"
    assert "MSS S+" in await page.locator("#chartSignal").inner_text()
    await assert_feed_primary_only(page, "t=30")
    await scrub(page, 28)
    st = await chart_state(page)
    assert not any(m["text"] == "S+" for m in st["markers"]), "S+ leaked before its bar"
    await scrub(page, 37)
    await page.locator("#toggleDiag").click()
    st = await chart_state(page)
    texts = {m["text"] for m in st["markers"]}
    assert {"S+", "MSS C", "CISD B"} <= texts, texts
    await page.locator("#toggleDiag").click()
    st = await chart_state(page)
    assert not any(m["text"] in ("MSS C", "CISD B") for m in st["markers"])
    await assert_feed_primary_only(page, "t=37")
    # --- interactions: wheel zoom at cursor, drag pan, Go to live, double click, hover legend
    await scrub(page, 47)
    await page.locator("#chart").scroll_into_view_if_needed()
    box = await page.locator("#chart").bounding_box()
    cx, cy = box["x"] + box["width"] * .5, box["y"] + box["height"] * .5
    base = (await chart_state(page))["range"]
    assert not await page.locator("#goLive").is_visible()
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, -500)
    await page.wait_for_timeout(400)
    st = await chart_state(page)
    assert not st["follow"], "wheel zoom must stop live-follow"
    assert (st["range"]["to"] - st["range"]["from"]) < (base["to"] - base["from"]) - 1, (base, st["range"])
    assert await page.locator("#goLive").is_visible()
    zoomed = st["range"]
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + box["width"] * .35, cy, steps=12)
    await page.mouse.up()
    await page.wait_for_timeout(500)
    st = await chart_state(page)
    assert st["range"]["from"] < zoomed["from"] - 1, ("drag pan", zoomed, st["range"])
    await page.mouse.move(cx, cy)
    await page.wait_for_timeout(150)
    legend = await page.locator("#chartLegend").inner_text()
    assert all(token in legend for token in ("O", "H", "L", "C")), legend
    for ident in ("openVal", "highVal", "lowVal", "closeVal"):
        assert await page.locator(f"#{ident}").inner_text() != "--"
    await page.locator("#goLive").click()
    await page.wait_for_timeout(500)
    st = await chart_state(page)
    assert st["follow"] and visible_bars(st) == 40, (st["follow"], st["range"])
    await page.mouse.wheel(0, -300)
    await page.wait_for_timeout(300)
    assert not (await chart_state(page))["follow"]
    await page.mouse.dblclick(cx, cy)
    await page.wait_for_timeout(500)
    st = await chart_state(page)
    assert st["follow"] and visible_bars(st) == 40, ("dblclick live", st["range"])
    # --- a user drag while playing at 8x must not be snapped back by the next replay step
    await scrub(page, 20)
    await page.locator("#speed").select_option("8")
    await page.locator("#play").click()
    await page.wait_for_timeout(200)
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + box["width"] * .3, cy, steps=8)
    await page.mouse.up()
    await page.wait_for_timeout(100)
    cur_after_drag = (await chart_state(page))["current"]
    await page.wait_for_timeout(700)
    st = await chart_state(page)
    assert not st["follow"], "drag while playing must leave follow"
    assert st["current"] >= cur_after_drag
    assert st["range"]["from"] < st["current"] - 40, ("snapped back to live", st["current"], st["range"])
    if await page.locator("#play").inner_text() != "Play":
        await page.locator("#play").click()
    await page.locator("#speed").select_option("1")
    await page.locator("#goLive").click()
    await page.wait_for_timeout(300)
    # --- follow-live rolls with the replay index
    await scrub(page, 41)
    st = await chart_state(page)
    assert visible_bars(st) == 40 and st["firstVisible"] == 1 and st["range"]["from"] > 0, st
    # --- EN / VI
    await page.locator("#languageSelect").select_option("vi")
    assert "CẤU TRÚC CHÍNH" in await page.locator("#chartStructureSummary").inner_text()
    hero_vi = await page.locator("#hero").inner_text()
    assert "Xu hướng chính" in hero_vi or "Chưa có" in hero_vi, hero_vi
    await page.locator("#languageSelect").select_option("en")
    hero_en = await page.locator("#hero").inner_text()
    assert "Main trend" in hero_en or "No Main trend" in hero_en, hero_en
    print(f"PASS {name} chart: Lightweight Charts, 40-bar window, no future bar, zoom/pan/go-live, markers, panels")


async def main() -> None:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "HOST": "127.0.0.1", "PORT": str(port), "DATA_DIR": str(OUT / "data")}
    OUT.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen([sys.executable, "app/server.py"], cwd=ROOT,
                               env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError("Server exited before health readiness")
            try:
                with urlopen(base + "/api/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                await asyncio.sleep(.15)
        else:
            raise RuntimeError("Server health timed out")
        async with async_playwright() as p:
            executable = os.environ.get("MSAS_BROWSER_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")
            browser = await p.chromium.launch(executable_path=executable if executable else None, args=["--no-sandbox"])
            try:
                for name, viewport in (("desktop", {"width": 1280, "height": 900}),
                                       ("mobile", {"width": 390, "height": 844})):
                    page = await browser.new_page(viewport=viewport, locale="en-US")
                    await page.add_init_script("window.MSAS_DEBUG = true")
                    errors: list[str] = []
                    page.on("pageerror", lambda exc: errors.append(str(exc)))
                    response = await page.goto(base, wait_until="networkidle")
                    assert response is not None and response.status == 200
                    await page.wait_for_function("document.querySelector('#progressCount').textContent.includes('40')")
                    assert await page.locator("#languageSelect").input_value() == "en"
                    assert await page.locator(".chart-heading h2").inner_text() == "Market structure"
                    assert await page.locator(".stream-top h2").inner_text() == "Notifications"
                    assert await page.locator("#datasetSelect option").count() >= 4
                    await page.locator("#datasetSelect").select_option("xauusd-sample")
                    # Dataset switching fetches candles asynchronously. The initial BTC
                    # sample also has 40 bars, so checking progressCount alone races on
                    # slower/mobile browser runners. switchDataset() starts at
                    # the FIRST XAU candle (Close 4023.50), not the last candle.
                    await page.wait_for_function(
                        "document.querySelector('#lastClose')?.textContent.trim() === '4,023.50'",
                        timeout=12000,
                    )
                    await page.locator("#scrubber").fill("24")
                    await page.locator("#scrubber").dispatch_event("input")
                    assert (await page.locator("#majorDirection").inner_text()).startswith("DOWN")
                    # V6 user amendment 2026-11-19: MH/ML prices are chart labels, not panel text.
                    chart_lines = [line["title"] for line in (await chart_state(page))["lines"]]
                    assert any(t.startswith("MH 4001.50") for t in chart_lines), chart_lines
                    assert any(t.startswith("ML 3991.10") for t in chart_lines), chart_lines
                    assert "4,001.50" not in await page.locator("#structureSnapshot").inner_text()
                    await chart_checks(page, name)
                    await page.locator("#scrubber").fill("30")
                    await page.locator("#scrubber").dispatch_event("input")
                    assert "MSS S+" in (await page.locator("#chartSignal").inner_text())
                    await page.locator("#scrubber").fill("47")
                    await page.locator("#scrubber").dispatch_event("input")
                    assert await page.locator("#progressCount").inner_text() == "48 / 48"
                    english = await page.locator("#heroDetail").inner_text()
                    assert not any(ch in english for ch in "áàêịộđườ"), english
                    await page.locator("#languageSelect").select_option("vi")
                    assert await page.locator(".chart-heading h2").inner_text() == "Biểu đồ cấu trúc"
                    assert await page.locator(".stream-top h2").inner_text() == "Thông báo"
                    await page.locator("#languageSelect").select_option("en")
                    assert await page.locator(".chart-heading h2").inner_text() == "Market structure"
                    await page.locator("#restart").click()
                    await page.locator("#speed").select_option("0.25")
                    await page.locator("#play").click()
                    await page.wait_for_timeout(380)
                    assert await page.locator("#progressCount").inner_text() == "1 / 48"
                    await page.locator("#speed").select_option("8")
                    await page.wait_for_timeout(850)
                    assert await page.locator("#progressCount").inner_text() != "1 / 48"
                    await page.locator("#play").click()
                    if name == "desktop":
                        fixture = ROOT / "fixtures/input_cases/case_insensitive_reordered.csv"
                        await page.locator("#csvFile").set_input_files(str(fixture))
                        await page.wait_for_function("document.querySelector('#importToast').textContent.includes('Imported')", timeout=10000)
                        assert await page.locator("#datasetSelect").input_value() not in ("btcusd-sample", "xauusd-20250618")
                    await page.screenshot(path=str(OUT / f"{name}-{viewport['width']}-en.png"), full_page=True)
                    assert not errors, errors
                    print(f"PASS {name}: bilingual UI, canvas color, dataset import, replay, no console errors")
                    await page.close()
            finally:
                await browser.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


if __name__ == "__main__":
    asyncio.run(main())
