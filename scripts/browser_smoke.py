#!/usr/bin/env python3
"""Optional Playwright E2E; starts Python server and tests real browser UI.

Dependencies (CI only): pip install -r requirements-qa.txt
                           python -m playwright install chromium
No external market API, accounts or network telemetry are accessed.
"""
from __future__ import annotations

import asyncio
import os
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
                for name, viewport in (("desktop", {"width": 1500, "height": 920}),
                                       ("mobile", {"width": 390, "height": 844})):
                    page = await browser.new_page(viewport=viewport, locale="en-US")
                    errors: list[str] = []
                    page.on("pageerror", lambda exc: errors.append(str(exc)))
                    response = await page.goto(base, wait_until="networkidle")
                    assert response is not None and response.status == 200
                    await page.wait_for_function("document.querySelector('#progressCount').textContent.includes('40')")
                    assert await page.locator("#languageSelect").input_value() == "en"
                    assert await page.locator(".chart-heading h2").inner_text() == "Market structure"
                    assert await page.locator(".stream-top h2").inner_text() == "Notifications"
                    assert await page.locator("#datasetSelect option").count() >= 4
                    pixel = await page.locator("#chart").evaluate("""canvas => {
                        const pixel = canvas.getContext('2d').getImageData(4,4,1,1).data;
                        return Array.from(pixel);
                    }""")
                    assert pixel == [198, 210, 223, 255], f"Unexpected background RGBA: {pixel}"
                    await page.locator("#datasetSelect").select_option("xauusd-sample")
                    # Dataset switching fetches candles asynchronously. The initial BTC
                    # sample also has 40 bars, so checking progressCount alone races on
                    # slower/mobile browser runners. Wait for the XAU final close.
                    await page.wait_for_function(
                        "document.querySelector('#lastClose')?.textContent.trim() === '3,991.30'",
                        timeout=12000,
                    )
                    await page.locator("#scrubber").fill("24")
                    await page.locator("#scrubber").dispatch_event("input")
                    assert (await page.locator("#majorDirection").inner_text()).startswith("DOWN")
                    assert (await page.locator("#feedMajorHigh").inner_text()).startswith("4,001.50")
                    assert (await page.locator("#feedMajorLow").inner_text()).startswith("3,991.10")
                    await page.locator("#datasetSelect").select_option("xauusd-20250618")
                    await page.wait_for_function("document.querySelector('#progressCount').textContent.includes('48')")
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
                    await page.screenshot(path=str(OUT / f"{name}-en.png"), full_page=True)
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
