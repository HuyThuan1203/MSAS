/* MSAS live controller: transport + lifecycle only, no market-structure logic.
 *
 * Snapshot (/api/live/history, carries last_event_id) -> studio.load(); then an
 * EventSource opened FROM THAT CURSOR (?after=last_event_id), so no event is lost
 * between snapshot and stream; browser reconnects resume via Last-Event-ID.
 *   candle.closed     -> studio.appendClosed(candle)   (exact next index only)
 *   candle.partial    -> studio.setPartial(candle|null) (chart ghost, never analysed)
 *   candle.corrected  -> studio.correct(candle)        (recompute from that index)
 *   history.reset / source.changed / resync / lineage mismatch / missed index
 *                     -> reload snapshot and reopen the stream from its cursor
 *   feed.status       -> status pill (separate from structural notifications)
 * Every open/resync carries a generation number; late responses of an older
 * generation are discarded. Offline HTML or realtime=false: `ready` -> null.
 */
(function(){
'use strict';
const I=window.MSASI18N;
const S=()=>window.MSASStudio;
const $=id=>document.getElementById(id);
const lang=()=>($('languageSelect')?.value==='vi'?'vi':'en');
const t=(k,p={})=>I.text(k,lang(),p);
let cfg=null,es=null,key=null,lineage=null,boot=null,status='offline',detail='',storage='',gen=0;
const opened=new Set();

async function getJSON(path,options){
 const r=await fetch(path,options);let body;try{body=await r.json();}catch(_){throw Error('Invalid server response');}
 if(!r.ok){const e=Error(body.error||('HTTP '+r.status));e.payload=body;throw e;}
 return body;
}
function label(k){
 const [p,sym,tf]=k.split(':');
 const tfl=(cfg?.timeframes||[]).find(x=>x.id===tf)?.label||tf;
 const pn=(cfg?.providers||[]).find(x=>x.id===p)?.name||p;
 return sym+' · '+tfl+' · '+pn+' · LIVE';
}
function configuredKeys(){
 const keys=[];
 for(const s of cfg?.series||[])keys.push(s.subscription_id);
 for(const a of cfg?.autostart||[])for(const tf of a.timeframes||[])keys.push((a.provider||cfg.default_provider)+':'+String(a.symbol).toUpperCase()+':'+tf);
 for(const k of opened)keys.push(k);
 return [...new Set(keys)];
}
function decorate(select){
 select.querySelector('optgroup[data-live]')?.remove();
 if(!cfg?.enabled)return;
 const group=document.createElement('optgroup');group.dataset.live='1';group.label=t('liveGroup');
 for(const k of configuredKeys()){const o=document.createElement('option');o.value='live:'+k;o.textContent=label(k);group.appendChild(o);}
 select.insertBefore(group,select.firstChild);
}
function setStatus(s,d=''){
 status=s||status;detail=d||'';
 const pill=$('liveStatus');if(!pill)return;
 pill.hidden=!key;pill.dataset.status=status;
 pill.textContent=t('live_'+status)||status.toUpperCase();
 pill.title=[detail,storage?t('liveStorage',{path:storage}):''].filter(Boolean).join('\n');
}
function stopStream(){if(es){es.close();es=null;}}
async function snapshot(k,g){
 // A brand-new subscription first backfills; wait (bounded) for its history.
 for(let i=0;i<60;i++){
  const p=await getJSON('/api/live/history?subscription_id='+encodeURIComponent(k));
  if(g!==gen)return null;
  if(p.live.bootstrapped&&p.candles.length>=1)return p;
  setStatus(p.live.status,p.live.detail);
  await new Promise(r=>setTimeout(r,750));
  if(g!==gen)return null;
 }
 throw Error('Timed out waiting for live history');
}
async function sync(k,g){
 stopStream();
 const p=await snapshot(k,g);
 if(!p||g!==gen)return;                         // superseded by a newer open/resync
 lineage=p.live.lineage_id;boot=p.live.boot;storage=p.live.storage||'';
 S().load(p);
 setStatus(p.live.status,p.live.detail);
 connect(k,g,p.live.last_event_id);
}
function resync(){
 if(!key)return;
 const g=++gen,k=key;
 sync(k,g).catch(err=>{if(g===gen)setStatus('error',err.message);});
}
function connect(k,g,after){
 const src=new EventSource('/api/live/events?subscription_id='+encodeURIComponent(k)+'&after='+encodeURIComponent(after));
 es=src;
 // Events of another server process (restart) or lineage never touch this snapshot.
 const on=(type,fn)=>src.addEventListener(type,e=>{if(g!==gen||es!==src)return;let ev;try{ev=JSON.parse(e.data);}catch(_){return;}
  if(ev.boot&&ev.boot!==boot)return resync();fn(ev);});
 src.onerror=()=>{if(g===gen&&es===src)setStatus('reconnecting');};  // EventSource retries with Last-Event-ID
 on('feed.status',ev=>setStatus(ev.status,ev.detail));
 on('candle.partial',ev=>{if(ev.lineage_id===lineage)S().setPartial(ev.candle||null);});
 on('candle.closed',ev=>{
  if(ev.lineage_id!==lineage)return resync();
  if(S().appendClosed(ev.candle)==='resync')resync();
 });
 on('candle.corrected',ev=>{if(ev.lineage_id!==lineage||S().correct(ev.candle)==='resync')resync();});
 on('gap.detected',ev=>setStatus('gap',ev.missing_from_utc?('missing from '+ev.missing_from_utc):''));
 on('history.reset',()=>resync());
 on('resync',()=>resync());
 on('source.changed',ev=>{S().popupNotice(t('liveSourceChanged'),'warning');setStatus('source_changed',ev.reason||'');resync();});
}
function close(){
 gen++;stopStream();
 key=null;lineage=null;setStatus('offline');
}
async function open(k){
 close();
 const g=gen;
 const [provider,symbol,timeframe]=String(k).split(':');
 const view=await getJSON('/api/live/subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({provider,symbol,timeframe})});
 if(g!==gen)return;
 key=view.subscription_id;opened.add(key);storage=view.storage||'';
 setStatus(view.status,view.detail);
 await sync(key,g);
}
function buildBar(){
 const anchor=$('datasetSelect');if(!anchor||$('liveBar'))return;
 const bar=document.createElement('span');bar.id='liveBar';bar.className='live-bar';
 const prov=document.createElement('select');prov.id='liveProvider';prov.setAttribute('aria-label','Provider');
 for(const p of cfg.providers){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;prov.appendChild(o);}
 prov.value=cfg.providers.some(p=>p.id===cfg.default_provider)?cfg.default_provider:cfg.providers[0]?.id;
 const sym=document.createElement('input');sym.id='liveSymbol';sym.value=(cfg.autostart?.[0]?.symbol||'BTCUSDT').toUpperCase();
 sym.maxLength=20;sym.spellcheck=false;sym.setAttribute('aria-label','Symbol');sym.size=9;
 const tf=document.createElement('select');tf.id='liveTimeframe';tf.setAttribute('aria-label','Timeframe');
 const fillTf=()=>{const allowed=new Set(cfg.providers.find(p=>p.id===prov.value)?.timeframes||[]);const keep=tf.value||'M15';tf.replaceChildren();
  for(const x of cfg.timeframes)if(allowed.has(x.id)){const o=document.createElement('option');o.value=x.id;o.textContent=x.label;tf.appendChild(o);}
  tf.value=[...tf.options].some(o=>o.value===keep)?keep:(tf.options[0]?.value||'');};
 prov.addEventListener('change',fillTf);fillTf();
 const go=document.createElement('button');go.type='button';go.className='upload-btn';go.id='liveOpen';
 go.addEventListener('click',()=>{
  const symbol=sym.value.trim().toUpperCase();
  if(!/^[A-Z0-9]{2,20}$/.test(symbol)){S().setError(t('liveFailed',{message:'symbol'}));return;}
  const k=prov.value+':'+symbol+':'+tf.value;opened.add(k);
  const select=$('datasetSelect');decorate(select);select.value='live:'+k;
  select.dispatchEvent(new Event('change'));
 });
 const pill=document.createElement('span');pill.id='liveStatus';pill.className='live-status mono';pill.hidden=true;pill.setAttribute('role','status');
 bar.append(prov,sym,tf,go,pill);
 anchor.insertAdjacentElement('afterend',bar);
 relabel();
 $('languageSelect')?.addEventListener('change',relabel);
}
function relabel(){
 const go=$('liveOpen');if(go)go.textContent=t('liveConnect');
 const sel=$('datasetSelect');if(sel&&cfg?.enabled){const v=sel.value;decorate(sel);sel.value=v;}
 setStatus(status,detail);
}
const ready=(async()=>{
 if(window.MSASOfflineAPI)return null;
 try{
  cfg=await getJSON('/api/live/config');
  if(!cfg.enabled)return null;
  buildBar();
  return configuredKeys()[0]||null;
 }catch(_){return null;}
})();
window.MSASLive={ready,open,close,decorate,status:()=>({key,lineage,status,detail,generation:gen})};
})();
