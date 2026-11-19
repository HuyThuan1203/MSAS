'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const theme=require('../static/chart-theme.js');
const I=require('../static/i18n.js');
const E=require('../static/engine.js');
const A=require('../static/advanced_engine.js');
assert.equal(theme.background.toLowerCase(),'#c6d2df');
assert.equal(theme.grid,false);
assert.deepEqual(theme.candles.up,{body:'#ffffff',bodyOpacity:1,border:'#000000',borderOpacity:.6,wick:'#000000',wickOpacity:1});
assert.deepEqual(theme.candles.down,{body:'#66bb6a',bodyOpacity:.9,border:'#000000',borderOpacity:.6,wick:'#000000',wickOpacity:1});
assert.equal(I.text('chartTitle'),'Market structure');
assert.equal(I.text('chartTitle','vi'),'Biểu đồ cấu trúc');
const html=fs.readFileSync(path.join(root,'static/index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'static/studio.js'),'utf8');
assert.match(html,/<html lang="en">/);
assert.match(html,/<option value="en" selected>EN<\/option>/);
assert.match(html,/<option value="vi">VI<\/option>/);
// V6 user amendment 2026-11-19: the hand-drawn canvas background/crosshair assertions are replaced
// by the equivalent Lightweight Charts theme checks (background, hidden grid, candle colours).
const L=theme.lightweight;
assert.deepEqual(L.layout.background,{type:'solid',color:'#c6d2df'});
assert.deepEqual(L.grid,{vertLines:{visible:false},horzLines:{visible:false}});
assert.equal(L.series.upColor,'rgba(255,255,255,1)');
assert.equal(L.series.downColor,'rgba(102,187,106,0.9)');
assert.equal(L.series.borderUpColor,'rgba(0,0,0,0.6)');
assert.equal(L.series.borderDownColor,'rgba(0,0,0,0.6)');
assert.equal(L.series.wickUpColor,'rgba(0,0,0,1)');
assert.equal(L.series.wickDownColor,'rgba(0,0,0,1)');
assert(js.includes('LW.createChart(')&&js.includes('addCandlestickSeries({...L.series'),'studio.js must build the chart from the theme tokens');
assert(js.includes('vertLines:{visible:false},horzLines:{visible:false}'),'grid must stay hidden');
assert(!js.includes('ctx.fillStyle=THEME.background')&&!js.includes('drawImage'),'no hand-drawn candle canvas');
assert(!/candles\.slice\(0,\s*current\s*\+\s*2/.test(js),'series data must never include a future bar');
assert(js.includes('series.setData(bars.slice(0,target))')&&js.includes('const target=current+1;'),'series data is candles[0..t] only');
assert(js.includes('VISIBLE_BARS=40'),'rolling window is 40 bars');
// V6 user amendment 2026-11-19: structure values live on the chart only, panels show trend state only.
for(const id of ['majorHighValue','majorLowValue','internalHighValue','internalLowValue','feedMajorHigh','feedMajorLow','feedInternalHigh','feedInternalLow'])
 assert(!html.includes('id="'+id+'"')&&!js.includes("'"+id+"'")&&!js.includes("$('"+id+"')"),'panel price row still present: '+id);
assert(!/structure-pivots|snapshot-pivots/.test(html),'pivot rows must not be rendered');
const css=fs.readFileSync(path.join(root,'static/studio.css'),'utf8');
assert(!/\.structure-pivots,\.snapshot-pivots,\.snapshot-internal\{display:none/.test(css),'old display:none hack must be gone');
assert(js.includes("title:'MH '")||js.includes("title:'MH '+fp"),'MH label on chart');
assert(js.includes("'MH? '")&&js.includes("'ML? '"),'provisional break labels on chart');
assert(!js.includes('subscribeVisibleLogicalRangeChange')&&!js.includes('ignoreUntil'),'follow-live must use input events, not range comparison');
assert(/debug=1/.test(js)&&js.includes('MSAS_DEBUG'),'debug hook must be gated');
assert(js.includes("pointerdown")&&js.includes("touchmove")&&js.includes("'wheel'"),'user input events end follow-live');
// Vendored chart library: offline, version pinned, licence kept, loaded before studio.js.
const vendor='static/vendor/lightweight-charts-4.2.3.standalone.production.js';
assert(fs.existsSync(path.join(root,vendor)),'vendored Lightweight Charts missing');
assert(fs.existsSync(path.join(root,'static/vendor/LICENSE-lightweight-charts.txt')),'Lightweight Charts licence missing');
assert(html.indexOf('/vendor/lightweight-charts-4.2.3.standalone.production.js')>0&&html.indexOf('/vendor/')<html.indexOf('/studio.js'));
assert(!/<script[^>]+src="https?:/.test(html),'no CDN script at runtime');
assert(/Charts by TradingView/.test(html)&&/tradingview\.com/.test(html),'TradingView attribution');
for(const id of ['goLive','toggleDiag','chartLegend','openVal','highVal','lowVal','closeVal','zoneLayer'])assert(html.includes('id="'+id+'"'),'missing '+id);
for(const match of html.matchAll(/data-i18n(?:-(?:aria|title))?="([^"]+)"/g)){
 assert(match[1] in I.UI.en,`EN key missing: ${match[1]}`);
 assert(match[1] in I.UI.vi,`VI key missing: ${match[1]}`);
}
const observedKinds=new Set();let total=0;
function check(e){
 observedKinds.add(e.kind);total++;
 assert(e.data && typeof e.data==='object',`Missing structured event data ${e.kind}@${e.at}`);
 const en=I.eventText(e,'en'),vi=I.eventText(e,'vi');
 assert(typeof en.title==='string'&&en.title.length>2,`EN title missing: ${e.kind}`);
 assert(typeof en.detail==='string'&&en.detail.length>8,`EN detail missing: ${e.kind}`);
 assert(!/[À-ỹ]/.test(en.title+' '+en.detail),`Vietnamese leaked in EN event ${e.kind}: ${en.title}`);
 assert(!/(undefined|\bNaN\b|\[object Object\])/.test(en.title+' '+en.detail),`Broken EN interpolation ${e.kind}: ${JSON.stringify(en)}`);
 assert(vi.title===e.title&&vi.detail===e.detail,`Vietnamese audit changed ${e.kind}`);
 assert(I.eventLabel(e.kind,'en')!=='EVENT',`EN category missing: ${e.kind}`);
 assert(I.eventLabel(e.kind,'vi')!=='EVENT',`VI category missing: ${e.kind}`);
}
for(const name of ['BTCUSD_M15_sample.csv','XAUUSD_M15_10Hours.csv']){
 const raw=fs.readFileSync(path.join(root,'samples',name),'utf8').trim().split(/\r?\n/);
 const heads=raw.shift().split(',').map(x=>x.toLowerCase());
 const c=raw.map((line,index)=>{const parts=line.split(','),row={index};for(let i=0;i<heads.length;i++){row[heads[i]]=['timestamp','time'].includes(heads[i])?parts[i]:Number(parts[i]);}row.time=row.timestamp;return row;});
 const b=E.analyzePrefix(c,c.length-1),a=A.analyzeAdvancedPrefix(c,c.length-1,b);
 for(const ev of [...b.events,...a.events])check(ev);
}
for(const sym of ['BTCUSD','XAUUSD']){
 const c=JSON.parse(fs.readFileSync(path.join(root,`samples/normalized/${sym}_M15_12h_2025-06-18_UTC.json`),'utf8')).candles;
 const b=E.analyzePrefix(c,c.length-1),a=A.analyzeAdvancedPrefix(c,c.length-1,b);
 for(const ev of [...b.events,...a.events])check(ev);
}
const f=JSON.parse(fs.readFileSync(path.join(root,'fixtures/advanced_slide13_synthetic.json'),'utf8'));
const fake=Array.from({length:f.bars},(_,i)=>({index:i,time:new Date(Date.UTC(2025,5,18,6,i*15)).toISOString(),close:f.close_overrides[i]??f.default_close}));
for(const ev of A.analysisFromAccepted(fake,f.pivots,f.bars-1).events)check(ev);
for(const ev of A.analysisFromAccepted(fake.map(x=>({...x,close:220-x.close})),f.pivots.map(p=>({...p,id:p.id.replace(/^SH/,'TMP').replace(/^SL/,'SH').replace(/^TMP/,'SL'),type:p.type==='SH'?'SL':'SH',price:220-p.price})),f.bars-1).events)check(ev);
// V6 user amendment 2026-11-19: the V6 engine no longer emits the 'pair' feed event (opposite-swing pairing is
// not a notification any more); its translation stays in i18n for old snapshots but is not required here.
const expected=['start','inside','breakout','swing','replace','classification','trend','major_established','major_continuation','major_updated','major_reversal','internal_established','internal_reversal','internal_confirmed'];
for(const kind of expected) assert(observedKinds.has(kind),`Event kind not exercised: ${kind}`);
// V6 notifications: primary events only, hero + de-duplicated history (max 5).
{
 const c=JSON.parse(fs.readFileSync(path.join(root,'samples/normalized/XAUUSD_M15_12h_2025-06-18_UTC.json'),'utf8')).candles;
 const b=E.analyzePrefix(c,c.length-1),a=A.analyzeAdvancedPrefix(c,c.length-1,b);
 const all=[...b.events,...a.events];
 assert(all.some(e=>!I.isPrimary(e)),'sample must contain non-primary events to prove filtering');
 const feed=I.primaryFeed(all,5);
 assert(feed.lead&&I.isPrimary(feed.lead)&&feed.history.every(I.isPrimary));
 assert(feed.history.length<=5);
 for(const e of [feed.lead,...feed.history])assert(I.PRIMARY_KINDS.includes(e.kind),'non-primary leaked: '+e.kind);
 const rev=all.filter(e=>e.kind==='major_reversal').pop();
 assert(rev,'sample has an S+ reversal');
 const en=I.primaryText(rev,'en');
 assert.match(en.title,/^Main trend reversed (UP|DOWN)$/);
 // V6 user amendment 2026-11-19: feed text is level-free; prices appear on the chart only.
 assert.match(en.detail,/^Close crossed (above the Major High|below the Major Low)$/);
 assert(!/\d{3,}/.test(en.title+en.detail),'no price in feed text');
 const vi=I.primaryText(rev,'vi');
 assert.match(vi.title,/^Xu hướng chính đảo chiều (TĂNG|GIẢM)$/);
 assert.equal(I.primaryText({kind:'major_reversal',at:5,data:{direction:'down',close:3990.7,brokenLevel:3991.1}},'en').detail,'Close crossed below the Major Low');
 for(const lang of ['en','vi'])for(const ev of [rev,{kind:'major_established',at:1,data:{direction:'up',majorHigh:4001.5,majorLow:3991.1}},{kind:'major_continuation',at:2,data:{direction:'down',close:3990.7,brokenLevel:3991.1}}]){const x=I.primaryText(ev,lang);assert(!/\d{3,}|\b(MH|ML|iSH|iSL)\b/.test(x.title+' '+x.detail),'level leaked in '+lang+': '+x.detail);}
 assert.equal(I.primaryText({kind:'major_established',at:5,data:{direction:'up',majorHigh:4001.5,majorLow:3991.1}},'en').title,'Main trend confirmed UP');
 // explicit primary flag wins; missing flag falls back to the three Main-trend kinds
 assert.equal(I.isPrimary({kind:'swing',primary:true}),true);
 assert.equal(I.isPrimary({kind:'major_reversal',primary:false}),false);
 assert.equal(I.isPrimary({kind:'major_continuation'}),true);
 for(const k of ['swing','inside','internal_reversal','mss_weak','cisd','major_updated'])assert.equal(I.isPrimary({kind:k}),false,k);
 const dup=[1,2,3,4,5,6,7,8].map(i=>({id:'e'+i,at:i,kind:'major_continuation',data:{direction:'down',close:3990-i,brokenLevel:3991.1}}));
 assert.equal(I.primaryFeed(dup,5).total,1,'identical continuation events collapse');
 const many=[1,2,3,4,5,6,7,8].map(i=>({id:'m'+i,at:i,kind:'major_reversal',data:{direction:i%2?'up':'down',close:i,brokenLevel:100+i}}));
 assert.equal(I.primaryFeed(many,5).history.length,5);
 assert.equal(I.primaryFeed(many,5).lead.at,8);
 assert.equal(I.phaseText('pending_confirmation','en'),'awaiting confirmation');
 assert.equal(I.phaseText('confirmed','en'),'confirmed');
 assert(!/[À-ỹ]/.test(I.phaseText('awaiting_major_high','en')));
}
console.log(`PASS chart theme / EN + VI keys / ${total} translated events across ${observedKinds.size} kinds`);
