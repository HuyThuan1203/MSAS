(function(){
'use strict';
// V6 user amendment 2026-11-19: the hand-drawn canvas chart is replaced by the
// vendored TradingView Lightweight Charts. This file is display only: it never
// computes market structure. It consumes AdvancedStructureEngine.replayAll()
// (computed once per dataset) and falls back to per-prefix analysis, and at
// replay index t it only reads frames/events/pivots known at t.
const E=window.MarketStructureEngine;
const ADV=window.AdvancedStructureEngine;
const I=window.MSASI18N;
const THEME=window.MSASChartTheme;
const LW=window.LightweightCharts;
if(!I||!THEME)throw Error('Missing MSAS UI localization or chart theme module.');
const $=id=>document.getElementById(id);
// Data is imported using the local MSAS API; offline standalone installs a same-origin browser adapter.
let datasetId='btcusd-sample', datasetDetails=null, fileWaiting=null;
const number=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const time=t=>String(t).slice(11,16);
const escaped=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S=THEME.lightweight.structure;
const VISIBLE_BARS=40,RIGHT_OFFSET=3;
let lang='en';
try{if(localStorage.getItem('msas-ui-language')==='vi')lang='vi';}catch(_){}
const t=(key,params={})=>I.text(key,lang,params);
if(!LW){const box=$('errorbox');box.textContent=t('chartLibMissing');box.classList.add('show');return;}
const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
const PLAY_ICON='<path d="m8 5 11 7-11 7z"/>';
const PAUSE_ICON='<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>';

let candles=[],bars=[],times=[],timeIndex=new Map(),current=0,view=null,playing=false,source='',speed=1,acc=0,lastFrame=0,request=null;
let replay=null,prefixCache=new Map(),byId=new Map(),primaryAll=[],markerSig='',scrubRaf=0,pendingScrub=null;
let layers={structure:true,inside:true,raw:false,diag:false};
let follow=true,dataLen=0,hoverIdx=null,feedSignature='';
let chart=null,series=null,lineMap=new Map(),lineLog=[],overlaySig='';

// ---------------------------------------------------------------- locale
function inferFrame(){return datasetDetails?.meta?.timeframe||'OHLC';}
function refreshStaticLocale(){
 document.documentElement.lang=lang;
 for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);
 for(const el of document.querySelectorAll('[data-i18n-title]'))el.title=t(el.dataset.i18nTitle);
 for(const el of document.querySelectorAll('[data-i18n-aria]'))el.setAttribute('aria-label',t(el.dataset.i18nAria));
 $('languageSelect').value=lang;
 $('chartBox').dataset.dropHint=t('dragHint');
 if(datasetDetails)$('canvasTimeframe').textContent=inferFrame()+' / '+t('closed');
 $('playText').textContent=t(playing?'pause':'play');
 $('play').setAttribute('aria-label',t(playing?'pause':'play'));
 if(datasetDetails){updateTop();updateFeed();syncChartLayers();}
}
function setLanguage(value){
 if(value!=='en'&&value!=='vi')return;
 lang=value;try{localStorage.setItem('msas-ui-language',value);}catch(_){}
 refreshStaticLocale();
 const select=$('datasetSelect');for(const option of select.options){
  option.textContent=option.dataset.rawName?.replace(/\(mẫu\)/i,lang==='en'?'(sample)':'(mẫu)')||option.textContent;
 }
}

// ---------------------------------------------------------------- engine view
// One view per replay index: {frame,events,pivots,zones}. Everything in it is known at `at`.
function prefixAnalysis(i){
 if(prefixCache.has(i))return prefixCache.get(i);
 const result=E.analyzePrefix(candles,i);
 result.advanced=ADV.analyzeAdvancedPrefix(candles,i,result);
 result.events=[...result.events,...result.advanced.events].sort((a,b)=>a.at-b.at);
 prefixCache.set(i,result);if(prefixCache.size>140)prefixCache.delete(prefixCache.keys().next().value);
 return result;
}
const PRIMARY_FALLBACK=new Set(I.PRIMARY_KINDS);
// Number of entries of a sorted array whose `key` is <= t (binary search, no per-step filtering).
function upTo(arr,key,t){let lo=0,hi=arr.length;while(lo<hi){const m=(lo+hi)>>1;if(arr[m][key]<=t)lo=m+1;else hi=m;}return lo;}
function getView(i){
 if(replay){
  return {frame:replay.frames[i],pivots:replay.pivots,np:upTo(replay.pivots,'recognizedAt',i),
          events:replay.events,ne:upTo(replay.events,'at',i),zones:replay.zones,
          primary:primaryAll.slice(0,upTo(primaryAll,'at',i)),source:'replayAll'};
 }
 // Fallback while replayAll is unavailable: causal per-prefix analysis, cached lazily.
 const a=prefixAnalysis(i),adv=a.advanced;
 const events=a.events.map(e=>PRIMARY_FALLBACK.has(e.kind)&&e.primary===undefined?{...e,primary:true}:e);
 const pivots=a.swings.map(s=>({id:s.id,type:s.type,index:s.index,price:s.price,recognizedAt:s.confirmedAt,status:s.status,rule:s.structStatus}));
 return {
  frame:{at:i,external:{...adv.external,provisionalHigh:null,provisionalLow:null},internal:adv.internal,active:{}},
  pivots,np:pivots.length,events,ne:events.length,zones:a.zones,primary:events.filter(I.isPrimary),source:'prefix-fallback'
 };
}
// Computed ONCE per dataset; returns null state when replayAll is unavailable.
function computeReplay(data){
 const fn=ADV&&ADV.replayAll;
 if(typeof fn!=='function')return {replay:null,byId:new Map(),primaryAll:[]};
 const r=fn.call(ADV,data);
 const pivots=[...r.pivots].sort((a,b)=>a.recognizedAt-b.recognizedAt||a.index-b.index);
 const events=[...r.events].sort((a,b)=>a.at-b.at);
 return {replay:{frames:r.frames,pivots,events,zones:r.zones||[]},byId:new Map(pivots.map(p=>[p.id,p])),primaryAll:events.filter(I.isPrimary)};
}
// frame.active carries pivot ids (or Levels); frame.external/internal carry Level objects.
function levelsOf(v){
 const f=v.frame,ex=f.external||{},inn=f.internal||{},act=f.active||{};
  const pick=(...cands)=>{
  for(const x of cands){let l=x;if(typeof x==='string'){l=byId.get(x);if(l&&l.recognizedAt>f.at)l=null;}if(l&&Number.isFinite(Number(l.price)))return l;}
  return null;
 };
 return {MH:pick(ex.majorHigh,act.MH),ML:pick(ex.majorLow,act.ML),
         iSH:pick(act.iSH,inn.protectedHigh,inn.internalHigh),iSL:pick(act.iSL,inn.protectedLow,inn.internalLow),
         pMH:pick(ex.provisionalHigh),pML:pick(ex.provisionalLow)};
}

// ---------------------------------------------------------------- time axis
function toSeconds(raw,prev){
 let v=String(raw).trim().replace(' ','T');
 if(/^\d{4}-\d{2}-\d{2}$/.test(v))v+='T00:00:00';
 if(!/(Z|[+-]\d\d:?\d\d)$/.test(v))v+='Z';
 const ms=Date.parse(v);
 const sec=Number.isFinite(ms)?Math.floor(ms/1000):(prev===undefined?0:prev+900);
 return prev!==undefined&&sec<=prev?prev+1:sec;
}
function priceDecimals(){
 let dec=2;
 for(const c of candles.slice(0,400))for(const k of ['open','high','low','close']){
  const s=String(+Number(c[k]).toFixed(6)),d=(s.split('.')[1]||'').length;if(d>dec)dec=d;
 }
 return Math.min(6,dec);
}

// ---------------------------------------------------------------- chart
function makeChart(){
 const L=THEME.lightweight;
 const line={color:'#506b7f',width:1,style:LW.LineStyle.Dashed,labelBackgroundColor:'#243746'};
 chart=LW.createChart($('chart'),{
  autoSize:true,
  layout:{background:{type:LW.ColorType.Solid,color:L.layout.background.color},textColor:L.layout.textColor,fontSize:11,
          fontFamily:'ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace'},
  grid:{vertLines:{visible:false},horzLines:{visible:false}},
  crosshair:{mode:LW.CrosshairMode.Normal,vertLine:line,horzLine:line},
  rightPriceScale:{borderColor:'#8396a8',autoScale:true,scaleMargins:{top:.12,bottom:.1}},
  timeScale:{borderColor:'#8396a8',timeVisible:true,secondsVisible:false,rightOffset:RIGHT_OFFSET,barSpacing:12,minBarSpacing:2,
             shiftVisibleRangeOnNewBar:false,fixLeftEdge:false,fixRightEdge:false},
  handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
  handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:{time:true,price:true}},
  kineticScroll:{mouse:true,touch:true}
 });
 series=chart.addCandlestickSeries({...L.series,priceLineVisible:true,priceLineStyle:LW.LineStyle.Dotted,priceLineColor:'#506b7f',lastValueVisible:true});
 chart.subscribeCrosshairMove(p=>{
  const idx=p&&p.time!==undefined?timeIndex.get(p.time):undefined;
  hoverIdx=idx!==undefined&&idx<=current?idx:null;
  updateLegend();
 });

 // Live-follow ends only on real user input (never on range comparisons), so a programmatic
 // range change or a fast replay step can neither drop nor force the follow state.
 const box=$('chartBox');
 const geometry=()=>{const r=$('chart').getBoundingClientRect(),ts=chart.timeScale();return {r,w:ts.width(),h:r.height-ts.height()};};
 let down=null,touch=null;
 box.addEventListener('wheel',()=>setFollow(false),{passive:true});
 box.addEventListener('pointerdown',e=>{
  if(e.target.closest&&e.target.closest('.go-live'))return;
  const g=geometry(),x=e.clientX-g.r.left,y=e.clientY-g.r.top;
  if(y>g.h){setFollow(false);return;}            // time axis drag/scale
  down=x<=g.w?{x:e.clientX,y:e.clientY}:null;       // price axis drag does not leave follow
 });
 box.addEventListener('pointermove',e=>{if(down&&(Math.abs(e.clientX-down.x)>3||Math.abs(e.clientY-down.y)>3)){down=null;setFollow(false);}});
 for(const ev of ['pointerup','pointercancel','pointerleave'])box.addEventListener(ev,()=>{down=null;});
 box.addEventListener('touchstart',e=>{touch=e.touches.length>1?{multi:true}:{x:e.touches[0].clientX};},{passive:true});
 box.addEventListener('touchmove',e=>{if(e.touches.length>1||(touch&&touch.x!==undefined&&Math.abs(e.touches[0].clientX-touch.x)>3))setFollow(false);},{passive:true});
 box.addEventListener('dblclick',()=>{setTimeout(goLive,0);});
 if(/[?&]debug=1/.test(location.search)||window.MSAS_DEBUG===true)window.MSASChartDebug={chart,get series(){return series;},state:debugState};
 requestAnimationFrame(overlayTick);
}
function liveRange(){return {from:current-(VISIBLE_BARS-1),to:current+RIGHT_OFFSET};}
function applyLive(){
 if(!chart)return;
 chart.timeScale().setVisibleLogicalRange(liveRange());
}
function setFollow(value){
 follow=!!value;$('goLive').hidden=follow;
 if(follow)applyLive();
}
function goLive(){
 if(!chart)return;
 chart.priceScale('right').applyOptions({autoScale:true});
 setFollow(true);applyLive();
}
function syncSeries(previous){
 const target=current+1;
 if(dataLen>0&&previous===current-1&&dataLen===previous+1)series.update(bars[current]);
 else series.setData(bars.slice(0,target));   // never more than candles[0..t]
 dataLen=target;
}
function lineSpecs(lv){
 const fp=x=>I.fmtLevel(x.price);
 const out=[];
 if(!layers.structure)return out;
 if(lv.MH)out.push({key:'MH',price:lv.MH.price,title:'MH '+fp(lv.MH),color:S.major,width:2,style:LW.LineStyle.Solid});
 if(lv.ML)out.push({key:'ML',price:lv.ML.price,title:'ML '+fp(lv.ML),color:S.majorLow,width:2,style:LW.LineStyle.Solid});
 if(lv.pMH)out.push({key:'pMH',price:lv.pMH.price,title:'MH? '+fp(lv.pMH),color:S.major,width:1,style:LW.LineStyle.Dashed});
 if(lv.pML)out.push({key:'pML',price:lv.pML.price,title:'ML? '+fp(lv.pML),color:S.majorLow,width:1,style:LW.LineStyle.Dashed});
 if(lv.iSH)out.push({key:'iSH',price:lv.iSH.price,title:'iSH',color:S.internal,width:1,style:LW.LineStyle.Dotted});
 if(lv.iSL)out.push({key:'iSL',price:lv.iSL.price,title:'iSL',color:S.internal,width:1,style:LW.LineStyle.Dotted});
 return out;
}
function syncLines(){
 const specs=lineSpecs(levelsOf(view)),keep=new Set(specs.map(s=>s.key));
 for(const [key,item] of [...lineMap]){
  const spec=specs.find(s=>s.key===key);
  if(!spec||spec.price!==item.spec.price||spec.title!==item.spec.title){series.removePriceLine(item.line);lineMap.delete(key);}
 }
 for(const spec of specs){
  if(lineMap.has(spec.key))continue;
  const line=series.createPriceLine({price:spec.price,color:spec.color,lineWidth:spec.width,lineStyle:spec.style,axisLabelVisible:true,title:spec.title});
  lineMap.set(spec.key,{line,spec});
 }
 lineLog=specs.map(s=>({key:s.key,title:s.title,price:s.price}));
 return keep;
}
function markerList(){
 const m=[];
 const at=i=>times[i];
 const pivotStructure=p=>!['inside_rejected','ambiguous','rejected'].includes(p.status);
 for(let k=0;k<view.np;k++){
  const p=view.pivots[k],sh=p.type==='SH';
  if(layers.structure&&pivotStructure(p))
   m.push({time:at(p.index),position:sh?'aboveBar':'belowBar',color:sh?S.sh:S.sl,shape:'circle',size:.55,text:''});
  else if(layers.raw&&!pivotStructure(p))
   m.push({time:at(p.index),position:sh?'aboveBar':'belowBar',color:S.reject,shape:'square',size:.45,text:p.status==='inside_rejected'?'IB':'?'});
 }
 for(let k=0;k<view.ne;k++){
  const ev=view.events[k];
  if(ev.at>current)continue;
  const d=ev.data||{},up=d.direction==='up';
  if(layers.structure&&ev.kind==='major_reversal'&&I.isPrimary(ev))
   m.push({time:at(ev.at),position:up?'belowBar':'aboveBar',color:up?S.up:S.down,shape:up?'arrowUp':'arrowDown',text:'S+'});
  if(layers.diag&&ev.kind==='mss_weak')
   m.push({time:at(ev.at),position:up?'aboveBar':'belowBar',color:S.diag,shape:'square',text:'MSS C'});
  if(layers.diag&&ev.kind==='cisd')
   m.push({time:at(ev.at),position:d.mainTrend==='down'?'belowBar':'aboveBar',color:'#425ca9',shape:'square',text:'CISD B'});
 }
 return m.sort((a,b)=>a.time-b.time);
}
function syncChartLayers(force=false){
 if(!chart||!view)return;
 syncLines();
 // setMarkers only when layers or the visible pivot/event counts change.
 const sig=[layers.structure,layers.raw,layers.diag,view.np,view.ne,view.source==='replayAll'?'':current].join('|');
 if(force||sig!==markerSig){markerSig=sig;series.setMarkers(markerList());}
 overlaySig='';
}
function debugState(){
 const rng=chart.timeScale().getVisibleLogicalRange();
 let data=null;try{data=series.data().map(d=>d.time);}catch(_){}
 const ts=chart.timeScale(),paneW=ts.width(),vis=[];
 for(let i=Math.max(0,current-120);i<=current;i++){const x=ts.timeToCoordinate(times[i]);if(x!==null&&x>=0&&x<=paneW)vis.push(i);}
 return {datasetId,visibleCount:vis.length,firstVisible:vis.length?vis[0]:null,current,follow,dataLen,visibleRange:rng,seriesTimes:data,lastTime:times[current],lines:lineLog.slice(),
         markers:markerList().map(m=>({time:m.time,text:m.text,shape:m.shape,position:m.position})),
         times:times.slice(0,current+1),source:view?.source,legend:$('chartLegend').innerText};
}

// Inside-bar mother zones are drawn on a transparent overlay aligned to the chart coordinates.
function overlayTick(){
 requestAnimationFrame(overlayTick);
 if(!chart||!view)return;
 const cv=$('zoneLayer'),box=$('chartBox'),w=box.clientWidth,h=box.clientHeight;
 const rng=chart.timeScale().getVisibleLogicalRange();
 const probe=bars[current]?series.priceToCoordinate(bars[current].close):null;
 const sig=[layers.inside,current,w,h,rng&&rng.from,rng&&rng.to,probe,view.zones.length].join('|');
 if(sig===overlaySig)return;
 overlaySig=sig;
 const dpr=Math.min(devicePixelRatio||1,2);
 if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);}
 const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 if(!layers.inside)return;
 const ts=chart.timeScale();
 const paneW=typeof ts.width==='function'?ts.width():w-70,paneH=h-(typeof ts.height==='function'?ts.height():28);
 ctx.save();ctx.beginPath();ctx.rect(0,0,paneW,paneH);ctx.clip();
 for(const z of view.zones){
  const m=z.mother,first=z.first??m+1;
  if(m==null||first>current||m>=current)continue;
  const last=Math.min(z.last??first,current);
  const x1=ts.timeToCoordinate(times[m]),x2=ts.timeToCoordinate(times[last]),xn=ts.timeToCoordinate(times[m+1]);
  if(x1===null||x2===null||xn===null)continue;
  const half=Math.max(2,(xn-x1)/2);
  const yHi=series.priceToCoordinate(candles[m].high),yLo=series.priceToCoordinate(candles[m].low);
  if(yHi===null||yLo===null)continue;
  const left=x1-half,width=x2-x1+2*half;
  ctx.fillStyle='rgba(188,127,55,.16)';ctx.fillRect(left,yHi,width,yLo-yHi);
  ctx.strokeStyle='rgba(132,92,49,.75)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
  ctx.strokeRect(left+.5,yHi+.5,width-1,yLo-yHi-1);ctx.setLineDash([]);
  ctx.font='bold 10px ui-monospace,monospace';ctx.fillStyle='#6b4c27';ctx.fillText('IB',left+3,Math.max(10,yHi-4));
 }
 ctx.restore();
}

// ---------------------------------------------------------------- panels
function structureDirection(trend,phase){
 const word=t(trend==='up'?'metaUp':trend==='down'?'metaDown':'metaUnknown');
 return word+' · '+I.phaseText(phase,lang);
}
function updateStructureSnapshot(){
 const f=view.frame,e=f.external||{},n=f.internal||{};
 for(const [name,obj] of [['major',e],['internal',n]]){
  $(name+'Strip').dataset.trend=obj.trend||'unknown';
  $(name+'Direction').textContent=structureDirection(obj.trend,obj.phase);
  const feed=name==='major'?'feedMajorTrend':'feedInternalTrend';
  $(feed).textContent=structureDirection(obj.trend,obj.phase);
  $(feed).dataset.trend=obj.trend||'unknown';
 }
}
function updateLegend(){
 const c=candles[hoverIdx!==null?hoverIdx:current];if(!c)return;
 for(const [id,k] of [['openVal','open'],['highVal','high'],['lowVal','low'],['closeVal','close']])$(id).textContent=number(c[k]);
 document.querySelector('#chartLegend .ohlc').dataset.dir=c.close>=c.open?'up':'down';
}
function updateTop(){
 const c=candles[current],delta=c.close-c.open,pct=c.open?delta/c.open*100:0;
 $('lastClose').textContent=number(c.close);$('lastDelta').textContent=(pct>=0?'+':'')+pct.toFixed(2)+'%';$('lastDelta').classList.toggle('negative',pct<0);
 updateLegend();
 $('dataDetails').textContent=t('metaCandles',{count:candles.length.toLocaleString('en-US')})+' · '+inferFrame()+(datasetDetails?.meta?.timezone?' · '+datasetDetails.meta.timezone:'')+(datasetDetails?.meta?.gaps?' · '+t('metaGap',{count:datasetDetails.meta.gaps}):'');
 updateStructureSnapshot();
 $('progressCount').textContent=(current+1)+' / '+candles.length;
 $('timeLabel').textContent=time(c.time);$('feedTime').textContent=c.time.slice(0,16);
}
function eventColor(ev){
 if(ev.kind==='major_reversal')return ev.data?.direction==='up'?'#55e4be':'#fa7989';
 if(ev.kind==='major_continuation')return '#80b7ff';
 return '#9bc4e6';
}
function updateFeed(animate=false){
 const feed=I.primaryFeed(view.primary,5),lead=feed.lead;
 const banner=$('chartSignal'),here=view.primary.filter(e=>e.at===current&&e.kind==='major_reversal');
 if(here.length){banner.classList.remove('hidden');banner.dataset.kind='major_reversal';banner.textContent=here.map(ev=>'MSS S+ · '+I.primaryText(ev,lang).title).join('  /  ');}
 else{banner.classList.add('hidden');banner.textContent='';banner.dataset.kind='none';}
 const hero=$('hero'),key=(lead?lead.id||lead.kind+'@'+lead.at:'none')+'|'+(lead?lead.at:'');
 if(key!==feedSignature){feedSignature=key;hero.classList.remove('event-in');void hero.offsetWidth;if(animate&&!reduced)hero.classList.add('event-in');}
 hero.style.setProperty('--accent',lead?eventColor(lead):'#8fa7b5');
 if(lead){
  const text=I.primaryText(lead,lang);
  $('heroCategory').innerHTML=escaped(I.eventLabel(lead.kind,lang))+' <b>'+escaped(time(candles[lead.at].time))+'</b>';
  $('heroTitle').textContent=text.title;$('heroDetail').textContent=text.detail;
  $('heroMeta').textContent=t('closeMeta',{time:time(candles[lead.at].time)});
 }else{
  $('heroCategory').innerHTML=escaped(t('noneCategory'))+' <b>'+escaped(t('noneCount'))+'</b>';
  $('heroTitle').textContent=t('noSignal');$('heroDetail').textContent=t('noSignalDetail');
  $('heroMeta').textContent=t('closeMeta',{time:time(candles[current].time)});
 }
 $('eventCount').textContent=t('eventCount',{count:feed.total});
 const root=$('events');
 if(!feed.history.length){root.innerHTML='<div class="empty">'+escaped(t('emptyEvents'))+'</div>';return;}
 root.innerHTML=feed.history.map(ev=>{
  const text=I.primaryText(ev,lang),when=time(candles[ev.at].time);
  return '<button type="button" class="signal-row" data-candle="'+ev.at+'" style="--accent:'+eventColor(ev)+'" title="'+escaped(t('jumpTo',{time:when}))+'">'+
   '<span class="mark"></span><span class="rowbody"><span class="minor"><span>'+escaped(I.eventLabel(ev.kind,lang))+'</span><time class="mono">'+escaped(when)+'</time></span>'+
   '<h4>'+escaped(text.title)+'</h4><p>'+escaped(text.detail)+'</p></span></button>';
 }).join('');
}

// ---------------------------------------------------------------- replay
function setError(message){$('errorbox').textContent=message||'';$('errorbox').classList.toggle('show',!!message);}
function schedule(){if(request===null)request=requestAnimationFrame(tick);}
function setPlaying(value){playing=!!value;lastFrame=0;acc=0;$('play').classList.toggle('running',playing);$('playText').textContent=t(playing?'pause':'play');$('playIcon').innerHTML=playing?PAUSE_ICON:PLAY_ICON;$('play').setAttribute('aria-label',t(playing?'pause':'play'));$('livePulse').classList.toggle('running',playing);if(playing)schedule();}
function stop(){setPlaying(false);}
function stepTo(index,{flash=false}={}){
 if(!candles.length)return;
 index=Math.max(0,Math.min(candles.length-1,Math.round(index)));
 const previous=current,changed=index!==current||dataLen===0;
 current=index;view=getView(current);hoverIdx=null;
 syncSeries(previous);syncChartLayers();
 if(follow)applyLive();
 $('scrubber').value=String(current);
 $('scrubber').style.setProperty('--pct',((candles.length>1?current/(candles.length-1):1)*100)+'%');
 updateTop();updateFeed(changed&&flash);
}
function tick(now){
 request=null;if(!lastFrame)lastFrame=now;
 const dt=Math.min(100,Math.max(0,now-lastFrame));lastFrame=now;
 if(playing){
  acc+=dt;const period=1200/speed;let safety=0;
  while(acc>=period&&current<candles.length-1&&safety++<30){acc-=period;stepTo(current+1,{flash:true});}
  if(current>=candles.length-1)setPlaying(false);
 }
 if(playing)schedule();
}
function loadDataset(payload, initialIndex=0){
 const data=payload.candles;
 if(!Array.isArray(data)||!data.length)throw Error(t('invalidCandles'));
 for(const c of data){for(const k of ['open','high','low','close']){if(!Number.isFinite(c[k]))throw Error(t('invalidOHLC'));}}
 const newTimes=[];for(const c of data)newTimes.push(toSeconds(c.time,newTimes[newTimes.length-1]));
 const computed=computeReplay(data);   // once per dataset; throws before any state is replaced
 stop();candles=data;datasetDetails=payload;datasetId=payload.dataset.id;source=payload.dataset.filename;
 times=newTimes;timeIndex=new Map(times.map((s,i)=>[s,i]));
 bars=data.map((c,i)=>({time:times[i],open:c.open,high:c.high,low:c.low,close:c.close}));
 replay=computed.replay;byId=computed.byId;primaryAll=computed.primaryAll;prefixCache=new Map();
 if(!chart)makeChart();
 const dec=priceDecimals();
 series.applyOptions({priceFormat:{type:'price',precision:dec,minMove:+(1/Math.pow(10,dec)).toFixed(dec)}});
 for(const item of lineMap.values())series.removePriceLine(item.line);lineMap=new Map();lineLog=[];
 series.setMarkers([]);markerSig='';
 dataLen=0;current=0;feedSignature='';hoverIdx=null;follow=true;$('goLive').hidden=true;
 chart.priceScale('right').applyOptions({autoScale:true});
 $('scrubber').max=String(candles.length-1);$('firstTime').textContent=time(candles[0].time);$('lastTime').textContent=time(candles.at(-1).time);
 $('canvasTimeframe').textContent=inferFrame()+' / '+t('closed');
 $('dataDetails').title=(payload.warnings||[]).join('\n');
 $('removeData').hidden=!!payload.dataset.builtin;
 setError('');
 stepTo(Math.min(initialIndex,candles.length-1));
}
async function apiJSON(path,options){
 const resp=window.MSASOfflineAPI ? await window.MSASOfflineAPI.fetch(path,options) : await fetch(path,options);
 let body;try{body=await resp.json()}catch(e){throw Error(t('invalidServer'));}
 if(!resp.ok){const err=new Error(body.error||t('requestFailed'));err.payload=body;throw err;}
 return body;
}
async function syncDatasetList(selectId){
 const result=await apiJSON('/api/datasets');const selector=$('datasetSelect');
 const chosen=selectId||selector.value||datasetId;
 selector.replaceChildren();
 for(const item of result.datasets){const opt=document.createElement('option');opt.value=item.id;opt.dataset.rawName=item.name;opt.textContent=item.name.replace(/\(mẫu\)/i,lang==='en'?'(sample)':'(mẫu)');selector.appendChild(opt);}
 selector.value=chosen;
 return result.datasets;
}
async function switchDataset(id,initialIndex=0){
 stop();setError('');
 $('datasetSelect').disabled=true;
 try{
  const payload=await apiJSON('/api/datasets/'+encodeURIComponent(id));
  loadDataset(payload,initialIndex);$('datasetSelect').value=id;
 }catch(err){setError(t('loadFailed',{message:I.serverError(err,lang)}));$('datasetSelect').value=datasetId;}
 finally{$('datasetSelect').disabled=false;}
}
function popupNotice(message,kind='success'){
 const node=$('importToast');node.textContent=message;node.dataset.kind=kind;node.classList.add('visible');
 clearTimeout(popupNotice.id);popupNotice.id=setTimeout(()=>node.classList.remove('visible'),6500);
}
function mappingDialog(payload){
 const columns=payload.columns||[];
 const guessed=payload.suggested||{};
 const preview=payload.preview||[];
 const dialog=$('columnDialog');
 $('mappingReason').textContent=lang==='vi'?(payload.error||t('mappingHint')):t(payload.code==='DATE_ORDER_REQUIRED'?'errorDate':'mappingHint');
 const fields=['timestamp','open','high','low','close','volume'];
 for(const field of fields){
  const select=$('col_'+field);select.replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent=t(field==='volume'?'noVolume':'chooseColumn');select.appendChild(empty);
  for(let i=0;i<columns.length;i++){
   const opt=document.createElement('option');opt.value=String(i);opt.textContent=(i+1)+'. '+(columns[i]||t('unnamedColumn'));select.appendChild(opt);
  }
  if(field==='timestamp'&&columns.length>5){
   for(let i=0;i<Math.min(3,columns.length-1);i++){
    const opt=document.createElement('option');opt.value=i+'+'+(i+1);opt.textContent=(i+1)+'+'+(i+2)+'. '+t('dateAndTime');select.appendChild(opt);
   }
  }
  if(guessed[field]!==undefined)select.value=String(guessed[field]);
 }
 const th=$('columnPreview');th.replaceChildren();
 const body=document.createElement('tbody');
 for(const row of preview.slice(0,3)){
  const tr=document.createElement('tr');for(const cell of row.slice(0,10)){const td=document.createElement('td');td.textContent=String(cell);tr.appendChild(td);}body.appendChild(tr);
 }
 th.appendChild(body);
 if(payload.code==='DATE_ORDER_REQUIRED'){$('dateOrder').value='DMY';}
 dialog.showModal();
}
async function importFile(file, mapping=null, dateOrder='auto'){
 if(!file)return;
 $('uploadData').disabled=true;
 try{
  const q=new URLSearchParams({filename:file.name, label:file.name.replace(/\.[^.]+$/, ''),date_order:dateOrder});
  if(mapping)q.set('mapping',JSON.stringify(mapping));
  const payload=await apiJSON('/api/import?'+q.toString(),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
  fileWaiting=null;$('columnDialog').open&&$('columnDialog').close();
  await syncDatasetList(payload.dataset.id);
  loadDataset(payload,0);
  popupNotice(t('imported',{name:file.name,count:payload.meta.rows,volume:t(payload.meta.volume_present?'volumeYes':'volumeNo')}));
  if(payload.meta.gaps)popupNotice(t('gapsWarning',{count:payload.meta.rows,gaps:payload.meta.gaps}),'warning');
 }catch(err){
  if(err.payload&&['NEEDS_MAPPING','DATE_ORDER_REQUIRED'].includes(err.payload.code)){
   fileWaiting=file;mappingDialog(err.payload);
  }else{
   const msg=t('uploadFailed',{name:file.name,message:I.serverError(err,lang)});
   setError(msg);popupNotice(msg,'error');
  }
 }finally{$('uploadData').disabled=false;}
}
$('play').addEventListener('click',()=>{if(playing){stop();return;}if(current>=candles.length-1)stepTo(0);setPlaying(true);});
$('restart').addEventListener('click',()=>{stop();stepTo(0);});
$('prev').addEventListener('click',()=>{stop();stepTo(current-1);});
$('next').addEventListener('click',()=>{stop();stepTo(current+1);});
$('scrubber').addEventListener('input',e=>{
 stop();pendingScrub=Number(e.target.value);
 if(!scrubRaf)scrubRaf=requestAnimationFrame(()=>{scrubRaf=0;const v=pendingScrub;pendingScrub=null;if(v!==null)stepTo(v);});
});
$('speed').addEventListener('change',e=>{speed=Number(e.target.value)||1;acc=0;lastFrame=0;if(playing)schedule();});
for(const [id,property] of [['toggleStructure','structure'],['toggleInside','inside'],['toggleRaw','raw'],['toggleDiag','diag']]){
 $(id).addEventListener('click',()=>{layers[property]=!layers[property];$(id).setAttribute('aria-pressed',String(layers[property]));syncChartLayers();});
}
$('goLive').addEventListener('click',goLive);
$('events').addEventListener('click',event=>{const row=event.target.closest('[data-candle]');if(!row)return;stop();stepTo(Number(row.dataset.candle),{flash:true});});
$('csvFile').addEventListener('change',evt=>{
 const file=evt.target.files?.[0];evt.target.value='';if(file)importFile(file);
});
$('uploadData').addEventListener('click',()=>$('csvFile').click());
$('datasetSelect').addEventListener('change',e=>switchDataset(e.target.value));
$('removeData').addEventListener('click',async()=>{
 if(!datasetId||datasetId.endsWith('-sample'))return;
 if(!window.confirm(t('confirmRemove')))return;
 try{await apiJSON('/api/datasets/'+encodeURIComponent(datasetId),{method:'DELETE'});await syncDatasetList('btcusd-sample');await switchDataset('btcusd-sample',15);popupNotice(t('importRemoved'));}
 catch(err){setError(err.message);}
});
// Share a point-in-time, closed-candle analysis report. No future candle data.
$('exportAudit').addEventListener('click',()=>{
 if(!candles.length||!view)return;
 const f=view.frame,events=view.events.slice(0,view.ne);
 const info={
  format:'msas-replay-snapshot-v2', analysis_version:'market_structure_advanced_v1_3',
  exported_at:new Date().toISOString(), offline:!!window.MSASOfflineAPI, market_data_source:source,
  dataset:datasetDetails?.dataset||null, metadata:datasetDetails?.meta||null,
  warnings:datasetDetails?.warnings||[], last_closed_index:current,
  last_closed_time:candles[current].time,
  candles:candles.slice(0,current+1),
  main:f.external, internal:f.internal, frame:f,
  acceptedPivots:view.pivots.slice(0,view.np),events,
  policy:{source:'ADV S3-14 + REV S3-8',majorSelection:'provisional',mssTolerance:0,noLookahead:true},
  note:'Replay pattern assessment. No financial advice; Main/Internal rules are provisional.'
 };
 const blob=new Blob([JSON.stringify(info,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);const link=document.createElement('a');
 link.href=url;link.download='MSAS_'+String(datasetId).replace(/[^a-z0-9_-]/gi,'_')+'_bar'+(current+1)+'.json';
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
 popupNotice(t('exportDone'));
});
$('helpData').addEventListener('click',()=>{$('helpDialog').showModal();});
$('closeHelp').addEventListener('click',()=>{$('helpDialog').close();});
$('cancelMap').addEventListener('click',()=>{$('columnDialog').close();fileWaiting=null;});
$('mappingForm').addEventListener('submit',event=>{
 event.preventDefault();
 const mapping={};for(const field of ['timestamp','open','high','low','close','volume']){const value=$('col_'+field).value;if(value)mapping[field]=value;}
 if(['timestamp','open','high','low','close'].some(k=>mapping[k]===undefined)){ $('mappingReason').textContent=t('mappingMissing');return; }
 $('columnDialog').close();if(fileWaiting)importFile(fileWaiting,mapping,$('dateOrder').value);
});
const chartBox=$('chartBox');
chartBox.addEventListener('dragover',evt=>{if([...evt.dataTransfer?.types||[]].includes('Files')){evt.preventDefault();chartBox.classList.add('dropping');}});
chartBox.addEventListener('dragleave',()=>chartBox.classList.remove('dropping'));
chartBox.addEventListener('drop',evt=>{evt.preventDefault();chartBox.classList.remove('dropping');const file=evt.dataTransfer?.files?.[0];if(file)importFile(file);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)stop();});
document.addEventListener('keydown',evt=>{
 if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement?.tagName))return;
 if(evt.key==='ArrowLeft'){evt.preventDefault();stop();stepTo(current-1);}else if(evt.key==='ArrowRight'){evt.preventDefault();stop();stepTo(current+1);}else if(evt.key===' '){evt.preventDefault();$('play').click();}else if(evt.key.toLowerCase()==='u'&&!evt.ctrlKey&&!evt.metaKey){$('csvFile').click();}
});
$('languageSelect').addEventListener('change',e=>setLanguage(e.target.value));
refreshStaticLocale();
(async()=>{
 try{await syncDatasetList('btcusd-sample');await switchDataset('btcusd-sample',15);}catch(err){setError(t('serverUnavailable',{message:I.serverError(err,lang)}));}
})();
})();
