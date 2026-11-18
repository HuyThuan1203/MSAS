#!/usr/bin/env python3
"""Chromium offline document smoke; uses page.set_content to avoid file:// policy restrictions.
QA runner only. No browser fetch, external connection, or hosted API is needed.
"""
from __future__ import annotations
import asyncio,os,shutil
import json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=ROOT/'dist/MSAS_Standalone_Offline.html'
OUT=ROOT/'qa-artifacts'
async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    html=HTML.read_text('utf8')
    async with async_playwright() as p:
        executable=os.environ.get('MSAS_BROWSER_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
        browser=await p.chromium.launch(executable_path=executable if executable else None,args=['--no-sandbox'])
        try:
            for name,viewport in [('desktop',{'width':1440,'height':900}),('mobile',{'width':390,'height':844})]:
                page=await browser.new_page(viewport=viewport)
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
                assert (await page.locator('#feedMajorHigh').inner_text()).startswith('4,001.50')
                assert (await page.locator('#feedMajorLow').inner_text()).startswith('3,991.10')
                assert (await page.locator('#majorDirection').inner_text()).startswith('DOWN')
                await page.locator('#datasetSelect').select_option('xauusd-20250618')
                await page.wait_for_function('document.querySelector("#progressCount").textContent.includes("48")',timeout=12000)
                # Every price-action classification must be visible on the
                # correct CLOSED bar, without leaking an event from the future.
                for cutoff,expected in [(28,None),(29,'CISD'),(30,'S+'),(37,'C')]:
                    await page.locator('#scrubber').fill(str(cutoff))
                    await page.locator('#scrubber').dispatch_event('input')
                    hero=await page.locator('#hero').inner_text()
                    if expected is not None:
                        assert expected in hero or (expected=='C' and 'MSS' in hero),(cutoff,hero)
                    if cutoff==28:
                        # S+ at bar 30 and C at bar 37 cannot exist yet.
                        assert 'S+' not in await page.locator('#events').inner_text()
                    if cutoff==30:
                        assert (await page.locator('#majorDirection').inner_text()).startswith('UP')
                    if expected is not None:
                        assert await page.locator('#chartSignal').is_visible(), (cutoff,expected)
                        tag={'CISD':'CISD B','S+':'MSS S+','C':'MSS C'}[expected]
                        assert tag in await page.locator('#chartSignal').inner_text(), (cutoff,tag)
                    else:
                        assert not await page.locator('#chartSignal').is_visible()
                # Spy on actual canvas text to verify the signal is drawn at
                # its closed bar, not merely listed in the side panel.
                if name=='desktop':
                    await page.evaluate('''() => {
                      window.__signalDrawn=[];
                      const proto=CanvasRenderingContext2D.prototype;
                      const original=proto.fillText;
                      proto.fillText=function(value,...args){
                        if(/^MSS |^CISD /.test(String(value))) window.__signalDrawn.push(String(value));
                        return original.call(this,value,...args);
                      };
                    }''')
                    await page.locator('#scrubber').fill('37')
                    await page.locator('#scrubber').dispatch_event('input')
                    await page.wait_for_timeout(180)
                    drawn=await page.evaluate('window.__signalDrawn')
                    assert any('MSS S+' in label for label in drawn),drawn
                    assert any('MSS C' in label for label in drawn),drawn
                    assert any('CISD B' in label for label in drawn),drawn
                await page.locator('#scrubber').fill('47')
                await page.locator('#scrubber').dispatch_event('input')
                assert (await page.locator('#majorDirection').inner_text()).startswith('UP')
                assert await page.locator('#internalDirection').inner_text()=='UP'
                assert (await page.locator('#feedMajorHigh').inner_text()).startswith('3,396.648')
                assert (await page.locator('#feedMajorLow').inner_text()).startswith('3,373.545')
                signal=await page.locator('#events').inner_text()
                assert 'S+' in signal or 'CISD' in signal,signal
                assert 'LOCAL SWING' not in signal and 'INSIDE BAR' not in signal,signal
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
                await page.screenshot(path=str(OUT/f'xau-structural-{name}.png'),full_page=True)
                await page.locator('#languageSelect').select_option('vi')
                assert 'CẤU TRÚC CHÍNH' in await page.locator('#chartStructureSummary').inner_text()
                await page.locator('#languageSelect').select_option('en')
                # Built-in dataset is read from HTML. Import a small alternative file.
                await page.locator('#csvFile').set_input_files(str(ROOT/'fixtures/input_cases/case_insensitive_reordered.csv'))
                await page.wait_for_function('document.querySelector("#importToast").textContent.includes("Imported")',timeout=12000)
                assert await page.locator('#datasetSelect option').count()==5
                await page.screenshot(path=str(OUT/f'offline-{name}.png'),full_page=True)
                assert not requests,requests
                assert not errs,errs
                print('PASS',name,'offline HTML, XAU Major, languages, key feed, imported CSV, no network/runtime error')
                await page.close()
        finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
