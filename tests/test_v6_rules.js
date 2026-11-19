'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const E=require('../static/engine.js');
const A=require('../static/advanced_engine.js');

const bar=(open,high,low,close)=>({open,high,low,close,time:'2026-11-19T00:00:00Z'});
const simple=rows=>rows.map((x,i)=>({...bar(x[2]??(x[0]+x[1])/2,x[0],x[1],x[3]??(x[0]+x[1])/2),index:i,time:`2026-11-19T00:${String(i).padStart(2,'0')}:00Z`}));
const seed=(trend,high=110,low=90)=>{const s=A.makeState();s.external={trend,phase:'confirmed',
 majorHigh:{id:'SH-M',index:0,type:'SH',price:high,confirmedAt:0},
 majorLow:{id:'SL-M',index:0,type:'SL',price:low,confirmedAt:0},breakAt:null,breakLevel:null,
 provisionalHigh:null,provisionalLow:null};s.segmentStart=0;return s;};

// T01: strict SH is structural at its right closed bar without any SL.
{
 const c=simple([[10,5],[12,6],[11,7]]),before=E.analyzePrefix(c,1),after=E.analyzePrefix(c,2);
 assert.equal(before.detected.length,0);assert.equal(after.detected.length,1);
 assert.deepEqual([after.detected[0].id,after.detected[0].confirmedAt,after.detected[0].structConfirmedAt,after.detected[0].rule],['SH-1',2,2,'three_bar']);
}
// T02: strict SL mirror.
{
 const p=E.analyzePrefix(simple([[10,5],[9,3],[11,4]]));assert.deepEqual([p.detected[0].id,p.detected[0].confirmedAt],['SL-1',2]);
}
// T03: the right bar must be closed.
assert.equal(E.analyzePrefix(simple([[10,5],[12,6]]),1).swings.length,0);
// T04: equal highs are not a strict pivot.
assert(!E.analyzePrefix(simple([[10,5],[12,6],[12,7]])).swings.some(p=>p.type==='SH'));

// T05: an inside-child pivot stays rejected after the mother breaks.
{
 const c=simple([[105,95],[110,100],[108,102],[109,103],[107,104],[111,99]]);
 const p=E.analyzePrefix(c);const child=p.swings.find(x=>x.index===3&&x.type==='SH');
 assert(child&&child.status==='inside_rejected');assert.equal(child.structStatus,'rejected');
}
// T06: tied mother, upward breakout. It is a range breakout, not a mother SH
// and cannot establish/break Major while Main is still unknown.
{
 const c=simple([[105,95],[110,100],[110,101],[111,102,107,107]]),p=E.analyzePrefix(c);
 assert(p.events.some(e=>e.kind==='breakout'&&e.at===3&&e.data.direction==='up'));
 assert(!p.swings.some(x=>x.id==='SH-1'));
 assert(!A.replayAll(c).events.some(e=>e.primary));
}
// T06b: downward breakout with lower high recognizes the tied mother SH only
// when the breakout bar closes.
{
 const c=simple([[105,95],[110,100],[110,101],[109,99,104,104]]),p=E.analyzePrefix(c);
 const mother=p.swings.find(x=>x.id==='SH-1');
 assert(mother);assert.deepEqual([mother.rule,mother.confirmedAt,mother.structConfirmedAt],['inside_compressed',3,3]);
}
// T08: simultaneous high/low range breakout is explicitly both.
{
 const c=simple([[105,95],[110,100],[109,101],[111,99]]),p=E.analyzePrefix(c);
 assert(p.events.some(e=>e.kind==='breakout'&&e.data.direction==='both'));
 assert(!p.swings.some(x=>x.rule==='inside_compressed'));
}
// T08b: a consecutive cluster compares its mother with the last non-inside
// left bar, not the inside child immediately before that mother.
{
 const c=simple([[105,95],[110,90],[108,92],[111,91],[109,91],[112,93]]),p=E.analyzePrefix(c);
 assert(p.zones.some(z=>z.mother===3&&z.brokenAt===5),'breakout bar becomes the next mother');
 assert(!p.swings.some(x=>x.id==='SL-3'&&x.rule==='inside_compressed'),'inside left neighbour must be skipped');
}
// T08c: nested/consecutive clusters are causal. A both-side breakout creates
// no compressed pivot for the old cluster, but may mother the next cluster.
{
 const c=simple([[105,95],[110,90],[110,90],[111,89],[109,89],[112,93]]);
 const before=E.analyzePrefix(c,4),atBreak=E.analyzePrefix(c,5),full=A.replayAll(c);
 assert(!before.swings.some(x=>x.id==='SL-3'));
 assert(atBreak.swings.some(x=>x.id==='SL-3'&&x.rule==='inside_compressed'&&x.confirmedAt===5));
 assert(!atBreak.swings.some(x=>x.index===1&&x.rule==='inside_compressed'));
 assert.deepEqual(A.replayAll(c.slice(0,5)).pivots,full.pivots.filter(p=>p.recognizedAt<=4));
 assert.deepEqual(A.replayAll(c.slice(0,6)).pivots,full.pivots.filter(p=>p.recognizedAt<=5));
}

// T09: DOWN -> UP strong Close break is primary at this bar; breakout candle
// is represented by a provisional extreme, not a fabricated Major pivot.
{
 const s=seed('down');A.advance(s,0,bar(108,113,107,111));
 const ev=s.events.find(e=>e.kind==='major_reversal');assert(ev&&ev.at===0&&ev.primary&&ev.data.label==='S+');
 assert.equal(s.external.trend,'up');assert.equal(s.external.majorHigh,null);
 assert.deepEqual(s.external.provisionalHigh,{id:'PX-H-0',index:0,type:'SH',price:113,provisional:true,confirmedAt:null});
}
// T10: mirror.
{
 const s=seed('up');A.advance(s,0,bar(92,93,86,89));
 const ev=s.events.find(e=>e.kind==='major_reversal');assert(ev&&ev.primary&&ev.data.direction==='down');
 assert.equal(s.external.majorLow,null);assert.equal(s.external.provisionalLow.id,'PX-L-0');assert.equal(s.external.provisionalLow.price,86);
}
// T11: an Internal-only break never produces a primary event.
{
 const s=seed('up');s.internal={trend:'down',phase:'confirmed',internalHigh:{id:'SH-I',index:0,type:'SH',price:100,confirmedAt:0},
  internalLow:{id:'SL-I',index:0,type:'SL',price:95,confirmedAt:0},protectedHigh:{id:'SH-I',index:0,type:'SH',price:100,confirmedAt:0},
  protectedLow:null,pendingDirection:null,pendingBreakAt:null,confirmed:true};
 A.advance(s,0,bar(99,103,98,101));assert(s.events.some(e=>e.kind==='internal_reversal'&&!e.primary));assert(!s.events.some(e=>e.primary));
}
// T12: continuation is primary on the exact strict Close-break bar.
{
 const s=seed('up');A.advance(s,0,bar(109,112,108,111));
 assert(s.events.some(e=>e.kind==='major_continuation'&&e.at===0&&e.primary));
}
// T13: the new MH is adopted independently while ML remains unchanged.
{
 const s=seed('up');A.advance(s,0,bar(109,112,108,111));A.advance(s,1,bar(111,114,110,112));
 A.advance(s,2,bar(112,113,109,110),[{id:'SH-1',type:'SH',index:1,price:114,recognizedAt:2,status:'eligible',rule:'three_bar'}]);
 assert.equal(s.external.majorHigh.id,'SH-1');assert.equal(s.external.majorLow.id,'SL-M');assert.equal(s.external.phase,'awaiting_corrective_low');
 assert(s.events.some(e=>e.kind==='major_updated'&&e.at===2&&!e.primary));
}
// T14: initialization cannot assign an already violated MH. It remains
// pending behind PX until a later valid SH is recognized.
{
 const s=A.makeState(),rows=[100,100,100,95,115,121,120],pivots={
  2:[{id:'SH-1',type:'SH',index:1,price:110,recognizedAt:2}],
  3:[{id:'SL-2',type:'SL',index:2,price:90,recognizedAt:3}],
  4:[{id:'SH-3',type:'SH',index:3,price:112,recognizedAt:4}],
  5:[{id:'SL-4',type:'SL',index:4,price:100,recognizedAt:5}],
  6:[{id:'SH-5',type:'SH',index:5,price:125,recognizedAt:6}],
 };
 rows.forEach((close,at)=>A.advance(s,at,{close},pivots[at]||[]));
 const assignedAt5=s.roleChanges.filter(r=>r.at===5&&r.to==='major_high');
 assert.equal(assignedAt5.length,0);assert(s.events.some(e=>e.kind==='major_established'&&e.at===6));
 assert.equal(s.external.majorHigh.id,'SH-5');
}
// T15: mirrored initialization keeps an already violated ML pending.
{
 const s=A.makeState(),rows=[100,100,100,95,90,79,75],pivots={
  2:[{id:'SH-1',type:'SH',index:1,price:110,recognizedAt:2}],
  3:[{id:'SL-2',type:'SL',index:2,price:90,recognizedAt:3}],
  4:[{id:'SH-3',type:'SH',index:3,price:100,recognizedAt:4}],
  5:[{id:'SL-4',type:'SL',index:4,price:80,recognizedAt:5}],
  6:[{id:'SL-5',type:'SL',index:5,price:70,recognizedAt:6}],
 };
 rows.forEach((close,at)=>A.advance(s,at,{close},pivots[at]||[]));
 assert.equal(s.roleChanges.filter(r=>r.at===5&&r.to==='major_low').length,0);
 assert(s.events.some(e=>e.kind==='major_established'&&e.at===6));assert.equal(s.external.majorLow.id,'SL-5');
}
// BTC round-two regression: Close 73865.2 invalidates SH-22 before it can
// become MH, so bars 28/29 contain exactly one primary continuation.
{
 const file=path.resolve(__dirname,'../samples/BTCUSD_M15_sample.csv');
 const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/),headers=lines.shift().split(',').map(x=>x.toLowerCase());
 const candles=lines.map((line,index)=>{const out={index},cells=line.split(',');headers.forEach((h,i)=>out[h==='timestamp'?'time':h]=h==='timestamp'?cells[i]:Number(cells[i]));return out;});
 const replay=A.replayAll(candles),primary=replay.events.filter(e=>e.primary&&e.at>=28&&e.at<=29);
 assert.deepEqual(primary.map(e=>[e.kind,e.at,e.refs[0]]),[['major_continuation',28,'SH-16']]);
 assert.equal(replay.frames[28].external.majorHigh.id,'SH-16');assert.equal(replay.frames[29].external.majorHigh.id,'SH-16');
 assert.equal(replay.frames[28].external.provisionalHigh.id,'PX-H-28');
}
// T19: weak C and delivery B remain audit-only. Equality never breaks.
{
 const c=seed('down');A.advance(c,0,bar(108,112,107,109));
 assert(c.events.some(e=>e.kind==='mss_weak'&&!e.primary));assert.equal(c.external.trend,'down');
 const b=seed('down');A.advance(b,0,bar(108,109,107,107));A.advance(b,1,bar(107,111,106,109));
 assert(b.events.some(e=>e.kind==='cisd'));assert(b.events.filter(e=>e.kind==='cisd').every(e=>!e.primary));
 const eq=seed('down');A.advance(eq,0,bar(109,112,108,110));
 assert(!eq.events.some(e=>['major_reversal','major_continuation'].includes(e.kind)));assert.equal(eq.external.trend,'down');
}
for(const kind of ['major_established','major_continuation','major_reversal'])assert(A.replayAll(simple([[10,5],[12,6],[11,7]])).events.filter(e=>e.primary).every(e=>['major_established','major_continuation','major_reversal'].includes(e.kind)),kind);
console.log('PASS V6 T01-T15/T19 immediate pivots, nested Inside clusters, valid Major assignment, BTC continuation, primary policy and strict equality');
