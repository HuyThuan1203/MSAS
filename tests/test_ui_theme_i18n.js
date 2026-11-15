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
assert(js.includes('ctx.fillStyle=THEME.background;ctx.fillRect(0,0,w,h);'));
assert(!js.includes("ctx.fillStyle='#0d1822';ctx.fillRect(0,0,w,h);"));
assert(!js.includes('ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.fillStyle'));
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
const expected=['start','inside','breakout','swing','replace','pair','classification','trend','major_established','major_continuation','major_updated','major_reversal','internal_established','internal_reversal','internal_confirmed'];
for(const kind of expected) assert(observedKinds.has(kind),`Event kind not exercised: ${kind}`);
console.log(`PASS chart theme / EN + VI keys / ${total} translated events across ${observedKinds.size} kinds`);
