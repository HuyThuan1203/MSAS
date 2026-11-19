#!/usr/bin/env python3
"""Chromium offline document smoke; uses page.set_content to avoid file:// policy restrictions.
QA runner only. No browser fetch, external connection, or hosted API is needed.
"""
from __future__ import annotations
import asyncio,os,shutil
import json
from pathlib import Path
from playwright.async_api import async_playwright
from browser_smoke import assert_feed_primary_only, assert_no_panel_prices, chart_checks, chart_state, scrub
ROOT=Path(__file__).resolve().parents[1]
HTML=ROOT/'dist/MSAS_Standalone_Offline.html'
OUT=Path(os.environ.get('MSAS_QA_ARTIFACTS',str(ROOT/'qa-artifacts')))
async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    html=HTML.read_text('utf8')
    async with async_playwright() as p:
        executable=os.environ.get('MSAS_BROWSER_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
        browser=await p.chromium.launch(executable_path=executable if executable else None,args=['--no-sandbox'])
        try:
            for name,viewport in [('desktop',{'width':1280,'height':900}),('mobile',{'width':390,'height':844})]:
                page=await browser.new_page(viewport=viewport)
                await page.add_init_script('window.MSAS_DEBUG=true')
                errs=[]; requests=[]
                page.on('pageerror',lambda exc:errs.append(str(exc)))
                page.on('request',lambda req:requests.append(req.url))
                await page.set_content(html,wait_until='load',timeout=30000)
                assert await page.locator('meta[name="msas-version"]').get_attribute('content') == (ROOT/'VERSION').read_text().strip()
                await page.wait_for_function('document.querySelector("#progressCount").textContent.includes("40")',timeout=12000)
                assert await page.locator('#languageSelect').input_value()=='en'
                assert await page.locator('#datasetSelect option').count()==4
                assert await page.locator('#eventCount').inner_text() is not None
                # User screenshot 25/40 (21:00) must show the rolled Major pair,
                # rather than stale 4013.40/3995.80 levels.
                await page.locator('#datasetSelect').select_option('xauusd-sample')
                await page.locator('#scrubber').fill('24')
                await page.locator('#scrubber').dispatch_event('input')
                # V6 user amendment 2026-11-19: MH/ML prices are chart labels, not panel text.
                titles=[l['title'] for l in (await chart_state(page))['lines']]
                assert any(t.startswith('MH 4001.50') for t in titles),titles
                assert any(t.startswith('ML 3991.10') for t in titles),titles
                await assert_no_panel_prices(page,'xau-sample t=24')
                assert (await page.locator('#majorDirection').inner_text()).startswith('DOWN')
                await page.locator('#datasetSelect').select_option('xauusd-20250618')
                await page.wait_for_function('document.querySelector("#progressCount").textContent.includes("48")',timeout=12000)
                # Every price-action classification must be visible on the
                # correct CLOSED bar, without leaking an event from the future.
                for cutoff in (28,29,30,37):
                    await scrub(page,cutoff)
                    await assert_feed_primary_only(page,cutoff)
                    hero=await page.locator('#hero').inner_text()
                    if cutoff==28:
                        assert 'S+' not in await page.locator('#events').inner_text()
                        assert 'reversed UP' not in hero,hero   # S+ at bar 30 cannot exist yet
                    if cutoff==30:
                        assert 'Main trend reversed UP' in hero,hero
                        assert (await page.locator('#majorDirection').inner_text()).startswith('UP')
                        assert 'MSS S+' in await page.locator('#chartSignal').inner_text()
                    else:
                        assert not await page.locator('#chartSignal').is_visible(),cutoff
                # Chart behaviour on the vendored Lightweight Charts (offline, inlined).
                await chart_checks(page,name)
                await page.locator('#scrubber').fill('47')
                await page.locator('#scrubber').dispatch_event('input')
                assert (await page.locator('#majorDirection').inner_text()).startswith('UP')
                assert await page.locator('#internalDirection').inner_text()=='UP'
                titles=[l['title'] for l in (await chart_state(page))['lines']]
                assert any(t.startswith('MH 3396.648') for t in titles) and any(t.startswith('ML 3373.545') for t in titles),titles
                signal=await page.locator('#events').inner_text()
                assert 'Main trend' in signal or 'No earlier' in signal,signal
                await assert_feed_primary_only(page,'t=47')
                # JSON export must contain only data known in this replay
                # prefix and preserve both Main/Internal and S+/C/B audit.
                if name=='desktop':
                    async with page.expect_download() as download_info:
                        await page.locator('#exportAudit').click()
                    download=await download_info.value
                    report=json.loads(Path(await download.path()).read_text('utf8'))
                    assert report['last_closed_index']==47
                    assert report['main']['trend']=='up' and report['internal']['trend']=='up'
                    assert report['policy']['mssTolerance']==0
                    kinds={e['kind'] for e in report['events']}
                    assert {'major_reversal','mss_weak','cisd'} <= kinds,kinds
                    assert all(e['at']<=47 for e in report['events'])
                await page.screenshot(path=str(OUT/f'xau-structural-{name}-{viewport["width"]}.png'),full_page=True)
                await page.locator('#languageSelect').select_option('vi')
                assert 'CẤU TRÚC CHÍNH' in await page.locator('#chartStructureSummary').inner_text()
                await page.locator('#languageSelect').select_option('en')
                # Built-in dataset is read from HTML. Import a small alternative file.
                await page.locator('#csvFile').set_input_files(str(ROOT/'fixtures/input_cases/case_insensitive_reordered.csv'))
                await page.wait_for_function('document.querySelector("#importToast").textContent.includes("Imported")',timeout=12000)
                assert await page.locator('#datasetSelect option').count()==5
                await page.screenshot(path=str(OUT/f'offline-{name}-{viewport["width"]}.png'),full_page=True)
                assert not [r for r in requests if not r.startswith(('data:','about:'))],requests
                assert not errs,errs
                print('PASS',name,'offline HTML, XAU Major, languages, key feed, imported CSV, no network/runtime error')
                await page.close()
        finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
