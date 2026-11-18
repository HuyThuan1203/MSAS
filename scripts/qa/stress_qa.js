#!/usr/bin/env node
/* Deterministic MSAS randomized and source-based QA. No external dependencies.
 * Generated OHLC is SYNTHETIC, not labeled exchange ground truth.
 * Sources: ADV slides 5-14; REV slides 3-8; basic Swing/Inside PPT.
 * Oracle checks are separate comparisons against rules, not engine self-counts.
 */
'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const assert=require('node:assert/strict');
const E=require('../../static/engine.js'), A=require('../../static/advanced_engine.js');
const ROOT=path.resolve(__dirname,'../..');
const cfg={cases:240,bars:96,seed:20261118,out:'qa-artifacts/stress-report.json',emitFixtures:null,fixtures:16,prefixes:9};
for(let i=2;i<process.argv.length;i++){
 const m=process.argv[i].match(/^--(cases|bars|seed|out|emit-fixtures|fixtures|prefixes)=(.*)$/);
 if(!m)throw Error('Unknown argument: '+process.argv[i]);
 const key=m[1]==='emit-fixtures'?'emitFixtures':m[1];
 cfg[key]=['out','emitFixtures'].includes(key)?m[2]:Number(m[2]);
}
if(!Number.isInteger(cfg.cases)||cfg.cases<12||cfg.cases>4000||!Number.isInteger(cfg.bars)||cfg.bars<16||cfg.bars>600||!Number.isInteger(cfg.seed)||!Number.isInteger(cfg.fixtures)||cfg.fixtures<0||cfg.fixtures>100||!Number.isInteger(cfg.prefixes)||cfg.prefixes<2||cfg.prefixes>30)throw Error('Invalid QA parameters');
const TYPES=['up','down','range','volatile','whipsaw','inside','spike','gaps','plateau','reversal','squeeze','mixed'];
function rng(seed){let x=seed>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
const decimal=n=>Math.round(n*10000)/10000;
const choose=(r,n)=>Math.floor(r()*n);
function generate(index){
 const type=TYPES[index%TYPES.length],seed=(cfg.seed+(index+1)*2654435761)>>>0,r=rng(seed);
 const start=100+(index%9)*20,arr=[];let price=start;
 for(let i=0;i<cfg.bars;i++){
  let volatility=type==='volatile'?2.9:type==='squeeze'?.12:type==='plateau'?.45:1;
  let drift=type==='up'?.48:type==='down'?-.48:type==='reversal'?(i<cfg.bars/2?-.7:.8):type==='mixed'?(Math.floor(i/15)%2?-.55:.55):0;
  const offset=(r()-.5)*2.2*volatility;
  let open=decimal(price+(type==='gaps'&&i%13===0?(r()-.5)*4.4:0));
  let close=decimal(open+drift+offset);
  if(type==='plateau'&&i%7===0)close=open;
  let wick=volatility*(.2+r()*1.8);
  let high=decimal(Math.max(open,close)+wick*(.4+r()));
  let low=decimal(Math.min(open,close)-wick*(.4+r()));
  if(type==='spike'&&i%17===11){if(r()<.5)high=decimal(high+9);else low=decimal(low-9);}
  if(type==='inside'&&i%6>=1&&i%6<=3&&arr.length){
   const mother=arr[i-(i%6)];
   const center=(mother.high+mother.low)/2;
   const range=(mother.high-mother.low)*(.05+.05*r());
   open=decimal(center+(r()-.5)*range);close=decimal(center+(r()-.5)*range);
   high=decimal(Math.min(mother.high,Math.max(open,close)+range));
   low=decimal(Math.max(mother.low,Math.min(open,close)-range));
  }
  if(type==='squeeze'&&i>12&&i%19===0)high=decimal(high+4.5);
  assert(low<=Math.min(open,close)&&high>=Math.max(open,close)&&low<=high,'bad generated OHLC');
  arr.push({index:i,time:new Date(Date.UTC(2025,5,18,6,0)+i*900000).toISOString().replace('.000Z','Z'),open,high,low,close,volume:null});
  price=close;
 }
 return {id:`random-${String(index).padStart(4,'0')}`,seed,type,synthetic:true,candles:arr};
}
let assertions=0;
function check(cond,label){assert(cond,label);assertions++;}
function equal(a,b,label){assert.deepStrictEqual(a,b,label);assertions++;}
function refCheckEvent(e,b){
 const d=e.data||{};
 if(e.kind==='major_reversal'){
  check(d.label==='S+'&&d.confirmed===true&&d.tolerance===0,'REV 3,8 S+ contract');
  check(d.direction==='up'?b.close>d.brokenLevel:b.close<d.brokenLevel,'REV S+ strict Close');
 }
 if(e.kind==='mss_weak'){
  check(d.label==='C'&&d.confirmed===false&&d.tolerance===0,'REV 4,8 C contract');
  check(d.direction==='up'?b.high>d.brokenLevel&&b.open<=d.brokenLevel&&b.close<d.brokenLevel:
    b.low<d.brokenLevel&&b.open>=d.brokenLevel&&b.close>d.brokenLevel,'REV C wick/body');
 }
 if(e.kind==='cisd'){
  check(d.label==='B'&&d.confirmed===false&&d.tolerance===0,'REV 5-8 B contract');
  check(d.mainTrend==='down'?b.close>b.open&&b.close>d.referenceOpen:
    b.close<b.open&&b.close<d.referenceOpen,'REV B strict Close through cluster Open');
 }
 if(e.kind==='major_continuation')check(d.direction==='up'?b.close>d.brokenLevel:b.close<d.brokenLevel,'ADV 7,14 continuation by Close');
 if(e.kind==='internal_reversal')check(d.direction==='up'?b.close>d.brokenLevel:b.close<d.brokenLevel,'ADV 7,13 internal by Close');
}
function stateInvariant(state,limit){
 const ext=state.external,inn=state.internal;
 check(['up','down','unknown'].includes(ext.trend),'valid Main enum');
 check(['up','down','unknown'].includes(inn.trend),'valid Internal enum');
 if(ext.phase==='awaiting_major_high')check(ext.trend==='up'&&(ext.majorHigh===null||ext.majorHigh.price===ext.breakLevel),'pending MH: null after S+ or retained after continuation');
 if(ext.phase==='awaiting_major_low')check(ext.trend==='down'&&(ext.majorLow===null||ext.majorLow.price===ext.breakLevel),'pending ML: null after S+ or retained after continuation');
 for(const p of [ext.majorHigh,ext.majorLow,inn.internalHigh,inn.internalLow,inn.protectedHigh,inn.protectedLow]){
  if(!p)continue;
  check(p.index>=0&&p.index<=limit&&Number.isFinite(p.price),'known pivot valid');
  check(p.confirmedAt===null||p.confirmedAt<=limit,'pivot not confirmed in future');
 }
 check(state.events.every(e=>e.at<=limit),'no future event');
 check(state.roleChanges.every(e=>e.at<=limit&&e.pivot_index<=e.at),'no future role change');
}
function extractPrefix(state){return {external:state.external,internal:state.internal,events:state.events,roles:state.roleChanges};}
function checkCase(x){
 const assertionsBefore=assertions;
 const bars=x.candles,n=bars.length;
 const base=E.analyzePrefix(bars,n-1),full=A.analyzeAdvancedPrefix(bars,n-1,base);
 check(full.policy.noLookahead&&full.policy.tolerance===0&&A.MSS_TOLERANCE===0,'no lookahead / zero tolerance');
 stateInvariant(full,n-1);
 for(const p of base.confirmed){
  check(p.index>=1&&p.index<n-1&&p.confirmedAt>=p.index+1&&p.structConfirmedAt>=p.index+1,'3-bar closed swing timing');
  const c=bars[p.index];
  check(p.type==='SH'?p.price===c.high&&c.high>bars[p.index-1].high&&c.high>bars[p.index+1].high:
    p.price===c.low&&c.low<bars[p.index-1].low&&c.low<bars[p.index+1].low,'3-bar strict neighbor comparator');
 }
 for(const e of full.events){check(e.at>=0&&e.at<n,'event candle exists');refCheckEvent(e,bars[e.at]);}
 // Independent strict-Close oracle for S+: the source uses the current
 // ACTIVE Major and zero tolerance, without a second previous-close crossing.
 // Prior-close-outside events are recorded as regression coverage (not PASS
 // by themselves), because old code could miss exactly these reversals.
 const grouped=new Map();for(const p of base.confirmed){if(!grouped.has(p.structConfirmedAt))grouped.set(p.structConfirmedAt,[]);grouped.get(p.structConfirmedAt).push(p);}
 const stream=A.makeState();
 for(let t=0;t<n;t++){
  const before=stream.external;
  const outside=(before.trend==='down'&&before.majorHigh&&bars[t].close>before.majorHigh.price) ||
                 (before.trend==='up'&&before.majorLow&&bars[t].close<before.majorLow.price);
  const threshold=before.trend==='down'?before.majorHigh?.price:before.majorLow?.price;
  const previous=stream.previousClose;
  const crossed=outside&&(previous===null|| (before.trend==='down'?previous<=threshold:previous>=threshold));
  if(outside&&!crossed){policyGaps.alreadyOutsideAfterRoleAssignment++;if(policyGaps.examples.length<12)policyGaps.examples.push({caseId:x.id,at:t,trend:before.trend,previousClose:previous,close:bars[t].close,majorThreshold:threshold});}
  const expectedDirection=before.trend==='down'?'up':'down';
  const oldEventCount=stream.events.length;
  A.advance(stream,t,bars[t],grouped.get(t)||[]);
  const newStrong=stream.events.slice(oldEventCount).filter(e=>e.kind==='major_reversal');
  check(Boolean(outside)===Boolean(newStrong.length),`REV S3/S8 missed/false S+ ${x.id} at ${t}: expectedCloseOutside=${!!outside} actual=${newStrong.length}, prior=${before.trend} close=${bars[t].close}`);
  if(outside){equal(newStrong[0].data.direction,expectedDirection,'S+ flip direction');check(stream.external.trend===expectedDirection,'S+ changes main');}
 }
 const indices=new Set([0,1,2,3,Math.floor(n/4),Math.floor(n/2),Math.floor(n*3/4),n-2,n-1]);
 const rand=rng(x.seed^0x9e3779b9);for(let j=0;j<cfg.prefixes;j++)indices.add(choose(rand,n));
 const fullEvents=full.events,fullRoles=full.roleChanges;
 for(const i of Array.from(indices).sort((a,b)=>a-b)){
  const prefix=bars.slice(0,i+1),p0=E.analyzePrefix(prefix,i),p1=A.analyzeAdvancedPrefix(prefix,i,p0);
  equal(p1.events,fullEvents.filter(e=>e.at<=i),`events no-lookahead ${x.id} at ${i}`);
  equal(p1.roleChanges,fullRoles.filter(e=>e.at<=i),`roles no-lookahead ${x.id} at ${i}`);
  stateInvariant(p1,i);
 }
 return {id:x.id,seed:x.seed,type:x.type,bars:n,swings:base.confirmed.length,finalMain:full.external.trend,finalInternal:full.internal.trend,
   eventCounts:full.events.reduce((out,e)=>(out[e.kind]=(out[e.kind]||0)+1,out),{}),prefixCount:indices.size,checks:assertions-assertionsBefore};
}
const bar=(open,close,high=Math.max(open,close),low=Math.min(open,close))=>({open,close,high,low});
function major(trend,H,L){const s=A.makeState();s.external={trend,phase:'confirmed',majorHigh:{id:'SH-REF',index:0,type:'SH',price:H,confirmedAt:0},majorLow:{id:'SL-REF',index:0,type:'SL',price:L,confirmedAt:0},breakAt:null,breakLevel:null};s.segmentStart=0;return s;}
function mirrored(bars,K=400){return bars.map(c=>bar(decimal(K-c.open),decimal(K-c.close),decimal(K-c.low),decimal(K-c.high)));}
function targeted(seed,n){
 const assertionsBefore=assertions;
 const r=rng(seed),out={cases:0,assertions:0,labels:{'S+':0,C:0,B:0},equality:0,mirror:0,multiCluster:0};
 for(let i=0;i<n;i++){
  const H=decimal(120+r()*40),L=decimal(H-30-r()*6),K=400;
  const rise=bar(decimal(H-2),decimal(H+1.1+r()),decimal(H+2.5),decimal(H-3));
  const fall=mirrored([rise],K)[0];
  for(const [direction,bar0,high,low] of [['down',rise,H,L],['up',fall,decimal(K-L),decimal(K-H)]]){
   const s=major(direction,high,low);A.advance(s,0,bar0);
   const e=s.events.filter(e=>e.kind==='major_reversal');
   equal(e.length,1,'S+ exactly one');equal(e[0].data.label,'S+','S+ label');
   equal(s.external.trend,direction==='down'?'up':'down','S+ flips immediately');
   check(s.external.phase===(direction==='down'?'awaiting_major_high':'awaiting_major_low'),'S+ pending');
   check((direction==='down'?s.external.majorHigh:s.external.majorLow)===null,'new pivot not invented');
   check((direction==='down'?s.external.majorLow:s.external.majorHigh).price===low || (direction==='up'&&s.external.majorHigh.price===high),'retained opposite');
   refCheckEvent(e[0],bar0);out.labels['S+']++;out.cases++;if(direction==='up')out.mirror++;
  }
  const weak=bar(decimal(H-3),decimal(H-2),decimal(H+1+r()),decimal(H-4));
  for(const [direction,b,high,low] of [['down',weak,H,L],['up',mirrored([weak],K)[0],decimal(K-L),decimal(K-H)]]){
   const s=major(direction,high,low);A.advance(s,0,b);
   equal(s.events.filter(e=>e.kind==='mss_weak').length,1,'C detected');
   equal(s.external.trend,direction,'C must not flip');
   check(!s.events.some(e=>e.kind==='major_reversal'),'C not S+');
   refCheckEvent(s.events.find(e=>e.kind==='mss_weak'),b);out.labels.C++;out.cases++;
  }
  const eq=bar(decimal(H-2),H,decimal(H+1.2),decimal(H-3));
  for(const [direction,b,high,low] of [['down',eq,H,L],['up',mirrored([eq],K)[0],decimal(K-L),decimal(K-H)]]){
   const s=major(direction,high,low);A.advance(s,0,b);
   check(!s.events.some(e=>['major_reversal','mss_weak'].includes(e.kind)),`strict equality is not S+/C: ${direction} H=${high} L=${low} close=${b.close} events=${JSON.stringify(s.events)}`);
   equal(s.external.trend,direction,'equality unchanged');out.equality++;out.cases++;
  }
  // Last of TWO bearish groups, not first. Both are within an established DOWN trend.
  const bearish=[bar(109,106,109.5,105),bar(106,103,106.5,102),bar(103,105,106,102),
    bar(108,104,109,103),bar(104,101,105,100),bar(101,110,111,100)];
  for(const [direction,bars,high,low,expectedRef] of [['down',bearish,150,70,108],['up',mirrored(bearish,K),decimal(K-70),decimal(K-150),decimal(K-108)]]){
   const s=major(direction,high,low);bars.forEach((b,t)=>A.advance(s,t,b));
   const events=s.events.filter(e=>e.kind==='cisd');
   equal(events.length,1,'B last cluster once');
   equal(events[0].at,5,'B on last close');
   equal(events[0].data.referenceStartIndex,3,'B selects final group');
   equal(events[0].data.referenceOpen,expectedRef,'B cluster Open');
   equal(s.external.trend,direction,'B does not flip');refCheckEvent(events[0],bars[5]);
   out.labels.B++;out.multiCluster++;out.cases++;
  }
 }
 out.assertions=assertions-assertionsBefore;
 return out;
}
function csvOf(x){return 'Timestamp,Open,High,Low,Close\n'+x.candles.map(b=>`${b.time},${b.open},${b.high},${b.low},${b.close}`).join('\n')+'\n';}
function outputJson(filename,obj){const target=path.resolve(ROOT,filename);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(obj,null,2)+'\n');}
const policyGaps={alreadyOutsideAfterRoleAssignment:0,status:'regression_covered',examples:[]};
const started=Date.now();const report={tool:'msas-deterministic-stress-qa',version:'1.0.0',source:'REV slides 3-8; ADV slides 5-14; Basic Swing/Inside slides',
  synthetic:true,seed:cfg.seed,config:{cases:cfg.cases,bars:cfg.bars,prefixes:cfg.prefixes,randomGenerativeModes:TYPES},
  status:'RUNNING',cases:[],coverage:{labels:{'S+':0,C:0,B:0},main:{up:0,down:0,unknown:0},internal:{up:0,down:0,unknown:0},modes:{}},errors:[],
  oracle:{sourceLocked:['strict three-closed-bar pivot','Inside Bar invalidation retained','S+ Close across opposing Major','C wick only, no trend switch','B last bearish/bullish cluster Open','tolerance=0','no future knowledge'],
          provisional:['Major candidate tie-break','Internal protected level/wave segmentation','C body-open requirement'],unverified:['exact PPT numeric 1-14 OHLC prices not supplied']} };
try{
 const target=targeted(cfg.seed^0x55aa33,Math.max(20,Math.ceil(cfg.cases/3)));
 report.targeted=target;Object.assign(report.coverage.labels,target.labels);
 const all=[];for(let i=0;i<cfg.cases;i++){
  const x=generate(i);const result=checkCase(x);all.push(result);
  report.coverage.modes[x.type]=(report.coverage.modes[x.type]||0)+1;
  report.coverage.main[result.finalMain]++;report.coverage.internal[result.finalInternal]++;
  for(const [k,n] of Object.entries(result.eventCounts))if(k==='major_reversal'||k==='mss_weak'||k==='cisd'){
   report.coverage.labels[k==='major_reversal'?'S+':k==='mss_weak'?'C':'B']+=n;
  }
  report.cases.push(result);
 }
 check(report.coverage.modes&&Object.keys(report.coverage.modes).length===12,'coverage 12 regimes');
 check(report.coverage.labels['S+']>=target.labels['S+']&&report.coverage.labels.C>=target.labels.C&&report.coverage.labels.B>=target.labels.B,'source label coverage');
 if(cfg.emitFixtures){
  const dir=path.resolve(ROOT,cfg.emitFixtures);fs.mkdirSync(dir,{recursive:true});const manifest=[];
  for(let i=0;i<Math.min(cfg.fixtures,cfg.cases);i++){
   const x=generate(i),file=`${x.id}_${x.type}.csv`,content=csvOf(x);
   fs.writeFileSync(path.join(dir,file),content);manifest.push({id:x.id,filename:file,type:x.type,seed:x.seed,bars:x.candles.length,sha256:crypto.createHash('sha256').update(content).digest('hex'),is_synthetic:true});
  }
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({producer:'scripts/qa/stress_qa.js',generator_version:1,seed:cfg.seed,synthetic:true,not_ground_truth:true,files:manifest},null,2)+'\n');
  report.sampleManifest=path.relative(ROOT,dir).replaceAll('\\','/');
 }
 report.policyGaps=policyGaps;report.assertions=assertions;report.status='PASS';report.finishedUtc=new Date().toISOString();report.durationMs=Date.now()-started;
 console.log('PASS deterministic-stress-qa',JSON.stringify({cases:cfg.cases,targeted:target.cases,assertions,coverage:report.coverage.labels,policyGaps:policyGaps.alreadyOutsideAfterRoleAssignment,durationMs:report.durationMs}));
}catch(err){
 report.policyGaps=policyGaps;report.status='FAIL';report.errors.push({message:String(err),stack:err.stack});report.assertions=assertions;report.finishedUtc=new Date().toISOString();report.durationMs=Date.now()-started;
 console.error('FAIL deterministic-stress-qa',err.stack||String(err));
}
outputJson(cfg.out,report);if(report.status!=='PASS')process.exitCode=1;
