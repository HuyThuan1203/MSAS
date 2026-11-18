#!/usr/bin/env python3
"""Record actual MSAS offline Chromium interactions + screenshots for QA evidence.
No network: set_content() embeds the self-contained built HTML; generated CSV
is synthetic. Screenshots/screenshots metadata reflect real browser element text.
"""
from __future__ import annotations
import asyncio, hashlib, json, os, shutil
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'qa-artifacts'/'evidence'
HTML=ROOT/'dist/MSAS_Standalone_Offline.html'

async def capture(page,name,records):
    await page.screenshot(path=str(OUT/f'{name}.png'),full_page=False)
    records.append({'step':name,'main':await page.locator('#majorDirection').inner_text(),
      'internal':await page.locator('#internalDirection').inner_text(),
      'major_high':await page.locator('#feedMajorHigh').inner_text(),
      'major_low':await page.locator('#feedMajorLow').inner_text(),
      'events':(await page.locator('#events').inner_text())[:500],
      'candle':await page.locator('#progressCount').inner_text(),
      'language':await page.locator('#languageSelect').input_value(),
      'screenshot_sha256':hashlib.sha256((OUT/f'{name}.png').read_bytes()).hexdigest()})

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    html=HTML.read_text('utf-8')
    async with async_playwright() as p:
        exe=os.environ.get('MSAS_BROWSER_EXECUTABLE') or shutil.which('chromium')
        browser=await p.chromium.launch(executable_path=exe if exe else None,args=['--no-sandbox'])
        ctx=await browser.new_context(viewport={'width':1500,'height':920},record_video_dir=str(OUT),record_video_size={'width':1280,'height':720},locale='en-US',accept_downloads=True)
        page=await ctx.new_page()
        errs=[];req=[]
        page.on('pageerror',lambda e:errs.append(str(e)))
        page.on('request',lambda r:req.append(r.url))
        records=[]
        try:
            await page.set_content(html,wait_until='load')
            await page.wait_for_function('document.querySelector("#progressCount").textContent.includes("40")')
            await page.locator('#datasetSelect').select_option('xauusd-20250618')
            await page.wait_for_function('document.querySelector("#progressCount").textContent.includes("48")')
            for n,label in [(28,'00-pre-break'),(29,'01-cisd-b'),(30,'02-strong-mss-splus'),(37,'03-weak-mss-c'),(43,'04-major-update'),(47,'05-final-xau')]:
                await page.locator('#scrubber').fill(str(n))
                await page.locator('#scrubber').dispatch_event('input')
                await page.wait_for_timeout(550)
                await capture(page,label,records)
            assert records[-1]['major_high'].startswith('3,396.648')
            assert records[-1]['major_low'].startswith('3,373.545')
            assert records[-1]['main'].startswith('UP')
            assert records[-1]['internal'].startswith('UP')
            await page.locator('#languageSelect').select_option('vi')
            await page.wait_for_timeout(550)
            await capture(page,'06-language-vi',records)
            await page.locator('#languageSelect').select_option('en')
            sample=ROOT/'fixtures/generated/random-0005_inside.csv'
            assert sample.exists()
            await page.locator('#csvFile').set_input_files(str(sample))
            await page.wait_for_function('document.querySelector("#importToast").textContent.includes("Imported")',timeout=10000)
            await page.locator('#scrubber').fill('127')
            await page.locator('#scrubber').dispatch_event('input')
            await page.wait_for_timeout(450)
            await capture(page,'07-random-csv-imported',records)
            # Exercise playback visibly, do not claim simulated screen recording.
            await page.locator('#restart').click()
            await page.locator('#speed').select_option('8')
            await page.locator('#play').click()
            await page.wait_for_timeout(1600)
            await page.locator('#play').click()
            await capture(page,'08-playback',records)
            assert not errs,errs
            assert not req,req
        finally:
            video=page.video
            await page.close()
            await ctx.close()
            if video:
                dest=OUT/'real-ui-interaction.webm'
                await video.save_as(str(dest))
            await browser.close()
        report={'method':'Real Chromium automation; set_content of standalone HTML','browser_requests':req,'page_errors':errs,
          'sample':'XAUUSD 48 real bars + synthetic random-0005 (128 bars)',
          'screenshots':records,'video_path':'real-ui-interaction.webm',
          'not_networked':True,'not_human_oracle':True}
        (OUT/'browser-evidence.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
        print('PASS real offline browser evidence:',len(records),'snapshots; network requests',len(req),'JS errors',len(errs))

if __name__=='__main__':asyncio.run(main())
