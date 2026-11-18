#!/usr/bin/env python3
"""Deterministically build one self-contained/offline HTML from canonical MSAS source.

No npm, pip, cloud service, external network or admin privileges required.
Only the 4 explicitly approved bundled sample datasets are embedded.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'app'))
from importer import normalize

BUILTINS=[
 ('btcusd-sample','BTCUSD · M15 (mẫu)','samples/BTCUSD_M15_sample.csv'),
 ('xauusd-sample','XAUUSD · M15 (mẫu)','samples/XAUUSD_M15_10Hours.csv'),
 ('btcusd-20250618','BTCUSD · M15 · 18/06/2025 UTC','samples/raw/BTCUSD_M15_12h_2025-06-18_UTC.csv'),
 ('xauusd-20250618','XAUUSD · M15 · 18/06/2025 UTC','samples/raw/XAUUSD_M15_12h_2025-06-18_UTC.csv'),
]
JS=['chart-theme.js','i18n.js','engine.js','advanced_engine.js','studio.js']

def build() -> str:
    content=(ROOT/'static/index.html').read_text(encoding='utf8')
    style=(ROOT/'static/studio.css').read_text(encoding='utf8')
    tag='<link href="/studio.css" rel="stylesheet"/>'
    if content.count(tag)!=1:raise RuntimeError('Expected one local stylesheet link')
    content=content.replace(tag,'<style>\n'+style+'\n</style>')
    bundled=[]
    for dataset_id,name,rel in BUILTINS:
        f=ROOT/rel
        parsed=normalize(f.read_bytes(),f.name)
        bundled.append({'id':dataset_id,'name':name,'filename':f.name,
                        'payload':{'candles':parsed['candles'],'meta':parsed['meta'],'warnings':parsed['warnings']}})
    # Escaping < makes it impossible for a dataset filename/string to terminate
    # its enclosing script tag in an HTML document.
    json_data=json.dumps(bundled,separators=(',',':'),ensure_ascii=False).replace('<','\\u003c')
    prefix=("<script>window.MSAS_BUNDLED_DATASETS="+json_data+";</script>\n"
            +"<script>\n"+(ROOT/'scripts/offline_adapter.js').read_text('utf8')+"\n</script>\n")
    marker='<script defer="" src="/chart-theme.js"></script>'
    if content.count(marker)!=1:raise RuntimeError('Expected chart theme script')
    content=content.replace(marker,prefix+marker)
    for name in JS:
        marker=f'<script defer="" src="/{name}"></script>'
        if content.count(marker)!=1:raise RuntimeError('Missing static script: '+name)
        src=(ROOT/'static'/name).read_text('utf8')
        if re.search(r'</script\s*>',src,re.IGNORECASE):raise RuntimeError('Unsafe literal script terminator in '+name)
        content=content.replace(marker,f'<script data-module="{name}">\n{src}\n</script>')
    assert '<script defer=' not in content
    assert 'href="/studio.css"' not in content
    assert 'window.MSAS_BUNDLED_DATASETS=' in content
    return content

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'dist/MSAS_Standalone_Offline.html')
    args=parser.parse_args()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    content=build()
    args.output.write_text(content,encoding='utf8')
    print(f'Built {args.output} ({len(content.encode("utf8"))} bytes; {len(BUILTINS)} bundled samples; 100% local)')
