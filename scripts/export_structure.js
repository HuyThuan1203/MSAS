#!/usr/bin/env node
'use strict';
/* Export an auditable, closed-candle-only timeline from a canonical dataset.
 * Usage: node scripts/export_structure.js samples/normalized/BTCUSD_...json audits/...
 */
const fs=require('node:fs'),path=require('node:path');
const legacy=require('../static/engine.js'),advanced=require('../static/advanced_engine.js');
if(process.argv.length!==4){console.error('Usage: node scripts/export_structure.js <canonical_json> <output_json>');process.exit(2)}
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!Array.isArray(input.candles)||!input.candles.length)throw Error('Missing canonical candle array');
const candles=input.candles;
const last=candles.length-1;
const b=legacy.analyzePrefix(candles,last),a=advanced.analyzeAdvancedPrefix(candles,last,b);
const availability=t=>{const open=new Date(candles[t].time).getTime();const interval=input.metadata.expected_interval_seconds;return Number.isFinite(open)&&Number.isFinite(interval)?new Date(open+interval*1000).toISOString():null;};
const timeline=[];
for(let t=0;t<candles.length;t++){
 const bb=legacy.analyzePrefix(candles,t),aa=advanced.analyzeAdvancedPrefix(candles,t,bb);
 timeline.push({at:t,time:candles[t].time,available_at_utc:availability(t),localTrend:bb.trend,
  external:aa.external,internal:aa.internal,mss:aa.mss,cisd:aa.cisd,
  eventsAt:aa.events.filter(e=>e.at===t),confirmedPivots:bb.confirmed.filter(p=>p.structConfirmedAt===t).map(p=>p.id)});
}
const report={schema_version:'1.0.0',analysis_version:'market_structure_advanced_v1_2',
 source_dataset_id:input.dataset_id,source_sha256:input.metadata.sha256,
 is_synthetic:input.metadata.is_synthetic,source_timeframe:input.timeframe,
 model_provenance:{ppt:['Cau_truc_nang_cao_-_Final.pptx','Mau_hinh_xac_nhan_ao_chieu_-_Final.pptx'],policy:'mixed source-locked/provisional',volume_used:false,mss_tolerance:0},
 summary:{bars:candles.length,localSwingCount:b.swings.length,acceptedStructuralSwingCount:b.confirmed.length,
  localTrendAtEnd:b.trend,externalTrendAtEnd:a.external.trend,internalTrendAtEnd:a.internal.trend,
  mssStrongCount:a.events.filter(e=>e.kind==='major_reversal').length,
  mssWeakCount:a.events.filter(e=>e.kind==='mss_weak').length,
  cisdCount:a.events.filter(e=>e.kind==='cisd').length,events:a.events.length},
 pivots:b.swings.map(p=>({id:p.id,index:p.index,time:candles[p.index].time,type:p.type,price:p.price,
  confirmed_at:p.confirmedAt,structure_confirmed_at:p.structConfirmedAt,
  validity:p.status,structural_status:p.structStatus,comparison:p.comp,zone_id:p.zoneId})),
 external:a.external,internal:a.internal,mss:a.mss,cisd:a.cisd,role_changes:a.roleChanges,
 events:a.events.map(e=>({...e,bar_open_time_utc:candles[e.at].time,available_at_utc:availability(e.at)})),timeline};
fs.mkdirSync(path.dirname(process.argv[3]),{recursive:true});
fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log('Wrote',process.argv[3],`(${candles.length} closed candles, ${a.events.length} major/internal events)`);
