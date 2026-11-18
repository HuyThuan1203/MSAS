#!/usr/bin/env python3
"""Build an offline, evidence-linked QA report from the deterministic stress JSON.

No third-party dependencies. A PASS means tested assertions passed, NOT that
provisional Major/Internal policy equals human-labeled market ground truth.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
TRACE_MATRIX=[
    ('BASIC: 3 closed bars', 'Swing High/Low strict neighbor rule; no lookahead', 'source-backed', 'tests/test_source_cases.js; stress pivot assertions'),
    ('BASIC: Inside Bar', 'Mother containment and permanently invalid pivots', 'source-backed', 'tests/test_source_cases.js; tests/test_sample_replay.js'),
    ('ADV S5', 'HH/HL or LH/LL initial Major', 'source-backed core; pivot choice provisional', 'tests/test_advanced_structure.js; test_major_selection.js'),
    ('ADV S6-S8', 'Main vs Internal independence, level candidates', 'source-backed; role selection provisional', 'tests/test_advanced_structure.js; stress prefix assertions'),
    ('ADV S9-S11', 'Major/Internal roles change when confirmed', 'source-backed; tie-break provisional', 'tests/test_advanced_structure.js; role log prefix assertions'),
    ('ADV S13', 'Internal trend may change while Main stays; new Major pending', 'qualitative, numeric sample synthetic', 'fixtures/advanced_slide13_synthetic.json'),
    ('ADV S14', 'Close-only structural break + pending role', 'source-backed; rolling-pair choice provisional', 'stress crossing oracle; test_major_selection.js'),
    ('REV S3/S8', 'S+ strict closed-price reversal, tolerance=0', 'source-backed', 'targeted two-way S+ and streaming oracle'),
    ('REV S4/S8', 'C wick-only attempt, main unchanged', 'source-backed; opening-body criterion provisional', 'targeted C + sampled event oracle'),
    ('REV S5-S6', 'B early delivery change, single/multi-candle last run', 'source-backed; wave segmentation provisional', 'targeted B and source checks'),
    ('REV S7', 'Use LAST bearish/bullish candle group', 'source-backed; wave boundary provisional', 'targeted dual-group B oracle'),
    ('REV S8', 'Opposite Major retained after S+, other pending', 'source-backed', 'targeted S+ and state invariants'),
    ('USER XAU annotation', 'MH=3396.648, ML=3373.545 at final close', 'user-annotated sample', 'tests/test_major_selection.js; browser_smoke.py'),
    ('PPT numeric prices', 'Exact unprovided OHLC diagram coordinates', 'NOT VERIFIED', 'requires labeled original bars'),
]
STYLE='''
:root{color-scheme:dark;font-family:Inter,Arial,sans-serif;--bg:#0a111c;--card:#162331;--line:#263c4d;--fg:#e3edf3;--muted:#9fb1c0;--green:#57dbab;--red:#ff7777;--gold:#deb86b}*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);margin:0;padding:38px}header{max-width:1240px;margin:auto}h1{font-size:34px;margin-bottom:9px}h2{margin:32px 0 14px}p{line-height:1.55;color:var(--muted)}.tag{display:inline-block;border-radius:30px;padding:5px 12px;background:#26493f;color:var(--green);font-size:13px;font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}.metric{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:17px}.metric b{display:block;font-size:28px;font-variant-numeric:tabular-nums}.metric small{display:block;color:var(--muted);margin-top:8px}.wrap{max-width:1240px;margin:auto}.muted{color:var(--muted)}.amber{color:var(--gold)}.ok{color:var(--green)}.warn{color:var(--gold)}table{width:100%;border-collapse:collapse;font-size:13px;background:var(--card)}th,td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#203243;color:#c8ddec;position:sticky;top:0}input,select{background:#172c3b;border:1px solid var(--line);color:var(--fg);padding:10px;border-radius:8px;margin-bottom:12px}input{width:300px}code{color:#c0e6eb}.foot{padding:25px 0}details{margin:12px 0}summary{cursor:pointer;color:var(--green)}.panel{padding:17px;background:var(--card);border:1px solid var(--line);border-radius:12px}
'''

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--report',default='qa-artifacts/stress-report.json')
    parser.add_argument('--output',default='qa-artifacts/stress-dashboard.html')
    ns=parser.parse_args()
    src=ROOT/ns.report;out=ROOT/ns.output
    r=json.loads(src.read_text(encoding='utf-8'))
    out.parent.mkdir(parents=True,exist_ok=True)
    cases=r.get('cases',[]);coverage=r.get('coverage',{});labels=coverage.get('labels',{})
    rows=[]
    for case in cases:
        kinds=case['eventCounts'];rows.append('<tr data-type="'+html.escape(case['type'])+'"><td>'+html.escape(case['id'])+'</td><td>'+html.escape(case['type'])+'</td><td>'+str(case['seed'])+'</td><td>'+str(case['bars'])+'</td><td>'+str(case['swings'])+'</td><td>'+html.escape(case['finalMain'])+'</td><td>'+html.escape(case['finalInternal'])+'</td><td>'+str(kinds.get('major_reversal',0))+'</td><td>'+str(kinds.get('mss_weak',0))+'</td><td>'+str(kinds.get('cisd',0))+'</td><td>'+str(case['prefixCount'])+'</td></tr>')
    mat=[]
    for slide,rule,status,proof in TRACE_MATRIX:
        css='ok' if status.startswith('source-backed') or status.startswith('user') else 'warn'
        if status=='NOT VERIFIED':css='amber'
        mat.append('<tr><td>'+html.escape(slide)+'</td><td>'+html.escape(rule)+'</td><td class="'+css+'">'+html.escape(status)+'</td><td>'+html.escape(proof)+'</td></tr>')
    gaps=r.get('policyGaps',{})
    m={'cases':len(cases),'bars':sum(x['bars'] for x in cases),'targeted':r.get('targeted',{}).get('cases',0),'assertions':r.get('assertions',0),'S+':labels.get('S+',0),'C':labels.get('C',0),'B':labels.get('B',0)}
    tile=''.join(f'<div class="metric"><b>{v:,}</b><small>{html.escape(k)}</small></div>' for k,v in m.items())
    gaps_examples=''.join('<tr><td>'+html.escape(str(x['caseId']))+'</td><td>'+str(x['at'])+'</td><td>'+str(x['trend'])+'</td><td>'+str(x['previousClose'])+'</td><td>'+str(x['close'])+'</td><td>'+str(x['majorThreshold'])+'</td></tr>' for x in gaps.get('examples',[]))
    case_rows=''.join(rows)
    script='''function filterRows(){let q=document.getElementById('f').value.toLowerCase(),mode=document.getElementById('m').value;for(let row of document.querySelectorAll('#cases tbody tr'))row.hidden=!(row.textContent.toLowerCase().includes(q)&&(mode==='all'||row.dataset.type===mode));}'''
    html_doc='''<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MSAS reproducible QA evidence</title><style>'''+STYLE+'''</style></head><body><header><span class="tag">'''+html.escape(r['status'])+''' · Deterministic synthetic test</span><h1>MSAS — Stress &amp; Source Trace QA</h1><p>Seed <code>'''+str(r['seed'])+'''</code> · 12 randomized market regimes · synthetic OHLC, NOT trading ground truth · source REV S3–8, ADV S5–14</p><div class="grid">'''+tile+'''</div></header><div class="wrap"><h2>What a PASS actually means</h2><div class="panel"><p>Strict source-backed boundary checks, no-lookahead event chronology, pivot validity, symmetric S+/C/B test oracles and input validation were run. This does <b>not</b> independently certify the provisional selection of Major or Internal pivots across arbitrary markets.</p><p><strong>V5.4 edge-case coverage:</strong> <span class="amber">'''+str(gaps.get('alreadyOutsideAfterRoleAssignment',0))+''' observations had a Close beyond an active opposing Major with the prior Close already outside. They are now asserted by the independent zero-tolerance S+ oracle; this count records coverage, not a known failure. The Major-pair tie-break itself remains provisional.</span></p></div><h2>Slide-to-test matrix</h2><table><thead><tr><th>Source</th><th>Required behavior</th><th>Evidence class</th><th>Automated gate</th></tr></thead><tbody>'''+''.join(mat)+'''</tbody></table><h2>Random-case ledger (filterable)</h2><input id="f" oninput="filterRows()" placeholder="Search ID, seed, trend…"><select id="m" onchange="filterRows()"><option value="all">All regimes</option>'''+''.join(f'<option value="{x}">{x}</option>' for x in r['config']['randomGenerativeModes'])+'''</select><table id="cases"><thead><tr><th>Case</th><th>Regime</th><th>Seed</th><th>Bars</th><th>Swings</th><th>Main</th><th>Internal</th><th>S+</th><th>C</th><th>B</th><th>Prefixes</th></tr></thead><tbody>'''+case_rows+'''</tbody></table><h2>Closed-price edge cases — regression evidence</h2><details><summary>Show examples (independent Close oracle verified; Major pairing still provisional)</summary><table><thead><tr><th>Case</th><th>Bar</th><th>Main</th><th>Prev Close</th><th>Close</th><th>Major threshold</th></tr></thead><tbody>'''+gaps_examples+'''</tbody></table></details><h2>Reproduce exactly</h2><div class="panel"><code>node scripts/qa/stress_qa.js --cases='''+str(r['config']['cases'])+''' --bars='''+str(r['config']['bars'])+''' --seed='''+str(r['seed'])+''' --out=qa-artifacts/stress-report.json</code><p>Run <code>python scripts/qa_gate.py --require-node</code> for source tests and data/API assertions. The fixtures are deterministic and explicitly marked synthetic. Timestamps and source SHA-256 are preserved in fixed sample regression.</p></div><p class="foot">Raw evidence SHA-256: <code>'''+hashlib.sha256(src.read_bytes()).hexdigest()+'''</code> · No network or third-party data was used.</p></div><script>'''+script+'''</script></body></html>'''
    out.write_text(html_doc,encoding='utf-8')
    with (out.parent/'stress-ledger.csv').open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['id','seed','type','bars','swings','finalMain','finalInternal','prefixCount','S+','C','B']);writer.writeheader()
        for c in cases:
            writer.writerow({**{k:c[k] for k in ('id','seed','type','bars','swings','finalMain','finalInternal','prefixCount')},'S+':c['eventCounts'].get('major_reversal',0),'C':c['eventCounts'].get('mss_weak',0),'B':c['eventCounts'].get('cisd',0)})
    summary=f'''# MSAS stress QA — {r['status']}\n\n- Seed: `{r['seed']}` (reproducible)\n- Random cases: **{m['cases']}** × {r['config']['bars']} candles = **{m['bars']:,}** synthetic candles\n- Targeted two-way S+/C/B cases: **{m['targeted']}**\n- Assertions completed: **{m['assertions']:,}**\n- S+: {m['S+']:,}, C: {m['C']:,}, B: {m['B']:,} (total **synthetic events**, not true-positive accuracy)\n- Previously missed Close-only cases now covered: **{gaps.get('alreadyOutsideAfterRoleAssignment',0)} observations** where previous Close was already outside. Provisional pivot pairing still needs human labels.\n- Source-backed and provisional judgments detailed in `stress-dashboard.html` and `docs/quality/STRESS_QA_PLAN.md`.\n- Not covered as ground truth: exact price coordinates of PPT illustrative diagrams, all nested Major/Internal policies, arbitrary provider data.\n\n## Reproduce\n\n`node scripts/qa/stress_qa.js --cases={r['config']['cases']} --bars={r['config']['bars']} --seed={r['seed']} --out=qa-artifacts/stress-report.json`\n'''
    (out.parent/'stress-summary.md').write_text(summary,encoding='utf-8')
    print('QA report created:',out,'cases:',len(cases),'status:',r['status'])
    return 0 if r['status']=='PASS' else 1

if __name__=='__main__':raise SystemExit(main())
