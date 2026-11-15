(function(){
'use strict';
const E=window.MarketStructureEngine;
const ADV=window.AdvancedStructureEngine;
const I=window.MSASI18N;
const THEME=window.MSASChartTheme;
if(!I||!THEME)throw Error('Missing MSAS UI localization or chart theme module.');
const $=id=>document.getElementById(id);
// Price data comes from the local HTTP API (Python Portable or Docker), never from an embedded CSV.
let datasetId='btcusd-sample', datasetDetails=null, fileWaiting=null;
const number=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const compact=n=>Math.round(n).toLocaleString('en-US');
const time=t=>String(t).slice(11,16);
const escaped=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PALETTE={up:THEME.candles.up.body,down:THEME.candles.down.body,line:'#285ba6',mother:'#9e7134',raw:'#475d70'};
let lang='en';
try{if(localStorage.getItem('msas-ui-language')==='vi')lang='vi';}catch(_){}
const t=(key,params={})=>I.text(key,lang,params);
const eventText=ev=>I.eventText(ev,lang);
const eventLabel=kind=>I.eventLabel(kind,lang);
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
 if(datasetDetails){updateTop();updateFeed(false);}
 if(hover!==null)$('tooltip').classList.add('hidden');
 schedule();
}
function setLanguage(value){
 if(value!=='en'&&value!=='vi')return;
 lang=value;try{localStorage.setItem('msas-ui-language',value);}catch(_){}
 refreshStaticLocale();
 const select=$('datasetSelect');for(const option of select.options){
  option.textContent=option.dataset.rawName?.replace(/\(mẫu\)/i,lang==='en'?'(sample)':'(mẫu)')||option.textContent;
 }
}
const PRIORITY={major_reversal:16,major_updated:15,major_continuation:14,internal_reversal:13,internal_confirmed:12,major_established:11,internal_established:10,trend:8,pair:7,classification:6,replace:5,breakout:4,swing:3,inside:2,start:1};
const PLAY_ICON='<path d="m8 5 11 7-11 7z"/>';
const PAUSE_ICON='<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>';
const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
let candles=[],analysis=null,current=0,playing=false,source='',speed=1,acc=0,lastFrame=0,request=null;
let cache=new Map(),hover=null,geo=null,transition=null;
let layers={structure:true,inside:true,raw:false};
let feedSignature='',sourceMetaLine='';
const ease=x=>1-Math.pow(1-Math.max(0,Math.min(1,x)),3);
const lerp=(a,b,t)=>a+(b-a)*t;
function severity(ev){
 if(ev.kind==='swing'&&ev.severity==='error')return '#f87988';
 if(ev.kind==='swing'&&ev.severity==='neutral')return '#9cabb8';
 if(ev.kind==='major_reversal')return '#f87988';
 if(ev.kind.startsWith('major_'))return '#80b7ff';
 if(ev.kind.startsWith('internal_'))return '#e8bc82';
 if(ev.kind==='trend')return ev.data?.direction==='down'?'#f87988':ev.data?.direction==='up'?'#46e2bd':'#a7b4d6';
 if(ev.kind==='inside'||ev.kind==='replace'||ev.kind==='breakout')return '#edc185';
 if(ev.kind==='pair'||ev.kind==='classification')return '#55dfc3';
 if(ev.kind==='swing')return '#95b5ff';
 return '#95afc0';
}
function currentEventList(){return analysis.events.filter(ev=>ev.at===current).sort((a,b)=>(PRIORITY[b.kind]||0)-(PRIORITY[a.kind]||0));}
function getAnalysis(i){
 if(cache.has(i))return cache.get(i);
 const result=E.analyzePrefix(candles,i);
 const advanced=ADV.analyzeAdvancedPrefix(candles,i,result);
 result.advanced=advanced;
 result.events=[...result.events,...advanced.events].sort((a,b)=>a.at-b.at);
 cache.set(i,result);if(cache.size>140)cache.delete(cache.keys().next().value);
 return result;
}
function setError(message){$('errorbox').textContent=message||'';$('errorbox').classList.toggle('show',!!message);}
function inferFrame(){return datasetDetails?.meta?.timeframe||'OHLC';}
function rangeFor(index){let lo=Infinity,hi=-Infinity;const from=Math.max(0,index-79);for(let i=from;i<=index;i++){lo=Math.min(lo,candles[i].low);hi=Math.max(hi,candles[i].high);}const s=Math.max(1,hi-lo);return {min:lo-s*.14,max:hi+s*.14};}
function scaleAt(now){if(!transition)return rangeFor(current);const f=reduced?1:ease((now-transition.started)/transition.duration);return {min:lerp(transition.from.min,transition.to.min,f),max:lerp(transition.from.max,transition.to.max,f)};}
function schedule(){if(request===null)request=requestAnimationFrame(tick);}
function setPlaying(value){playing=!!value;lastFrame=0;acc=0;$('play').classList.toggle('running',playing);$('playText').textContent=t(playing?'pause':'play');$('playIcon').innerHTML=playing?PAUSE_ICON:PLAY_ICON;$('play').setAttribute('aria-label',t(playing?'pause':'play'));$('livePulse').classList.toggle('running',playing);if(playing)schedule();}
function stop(){setPlaying(false);}
function stepTo(index,{animate=true,flash=false}={}){
 if(!candles.length)return;
 index=Math.max(0,Math.min(candles.length-1,Math.round(index)));
 const changed=index!==current;
 const now=performance.now();
 const oldScale=scaleAt(now);
 const oldConfirmed=new Set(analysis?.confirmed.map(p=>p.id)||[]);
 const previous=current;
 current=index;analysis=getAnalysis(current);
 hover=null;$('tooltip').classList.add('hidden');
 const per=1200/speed;
 const d=animate&&!reduced?Math.min(480,Math.max(68,per*.52)):0;
 transition=changed&&d>0?{
  started:now,duration:d,from:oldScale,to:rangeFor(current),
  added:new Set(analysis.confirmed.filter(p=>!oldConfirmed.has(p.id)).map(p=>p.id)),
  newest:current,previous,flash
 }:null;
 $('scrubber').value=String(current);
 $('scrubber').style.setProperty('--pct',((candles.length>1?current/(candles.length-1):1)*100)+'%');
 updateTop();updateFeed(changed&&flash);
 schedule();
}
function updateTop(){
 const c=candles[current],delta=c.close-c.open,pct=c.open?delta/c.open*100:0;
 $('lastClose').textContent=number(c.close);$('lastDelta').textContent=(pct>=0?'+':'')+pct.toFixed(2)+'%';$('lastDelta').classList.toggle('negative',pct<0);
 const inspected=hover!==null&&hover<=current?candles[hover]:c;
 for(const [id,k] of [['openVal','open'],['highVal','high'],['lowVal','low'],['closeVal','close']])$(id).textContent=number(inspected[k]);
 const ext=analysis.advanced.external,int=analysis.advanced.internal;
 const titleDirection=x=>t(x==='up'?'metaUp':x==='down'?'metaDown':'metaUnknown');
 const sourceLine=t('metaCandles',{count:candles.length.toLocaleString('en-US')})+' · '+inferFrame()+(datasetDetails?.meta?.timezone?' · '+datasetDetails.meta.timezone:'')+(datasetDetails?.meta?.gaps?' · '+t('metaGap',{count:datasetDetails.meta.gaps}):'');
 $('dataDetails').textContent=sourceLine+' · '+t('metaMain')+': '+titleDirection(ext.trend)+' / '+t('metaInternal')+': '+titleDirection(int.trend)+(int.pendingDirection?' ('+t('metaPending')+')':'');
 $('progressCount').textContent=(current+1)+' / '+candles.length;
 $('timeLabel').textContent=time(c.time);$('feedTime').textContent=c.time.slice(0,16);
}
function updateFeed(animate){
 const atNow=currentEventList(),lead=atNow[0]||null;
 const her=$('hero');
 const key=(lead?lead.kind+'|'+lead.title:'none')+'|'+current;
 if(key!==feedSignature){
  feedSignature=key;her.classList.remove('event-in');void her.offsetWidth;if(animate)her.classList.add('event-in');
 }
 const mainColor=lead?severity(lead):'#8fa7b5';her.style.setProperty('--accent',mainColor);
 $('heroCategory').innerHTML=lead?(escaped(eventLabel(lead.kind))+' <b>'+escaped(t('atCandle',{count:atNow.length}))+'</b>'):escaped(t('noneCategory'))+' <b>'+escaped(t('noneCount'))+'</b>';
 const leadTranslated=lead?eventText(lead):null;
 $('heroTitle').textContent=leadTranslated?.title||t('noSignal');
 $('heroDetail').textContent=leadTranslated?.detail||t('noSignalDetail');
 $('heroMeta').textContent=t('closeMeta',{time:time(candles[lead?lead.at:current].time)});
 const history=[...analysis.events].filter(ev=>ev!==lead).sort((a,b)=>b.at-a.at || (PRIORITY[b.kind]||0)-(PRIORITY[a.kind]||0)).slice(0,4);
 $('eventCount').textContent=t('eventCount',{count:analysis.events.length});
 const root=$('events');
 if(!history.length){root.innerHTML='<div class="empty">'+escaped(t('emptyEvents'))+'</div>';return;}
 root.innerHTML=history.map(ev=>{
  const color=severity(ev);
  const localized=eventText(ev);
  return '<button type="button" class="signal-row" data-candle="'+ev.at+'" style="--accent:'+color+'" title="'+escaped(t('jumpTo',{time:time(candles[ev.at].time)}))+'">'+
   '<span class="mark"></span><span class="rowbody"><span class="minor"><span>'+escaped(eventLabel(ev.kind))+'</span><time class="mono">'+escaped(time(candles[ev.at].time))+'</time></span>'+
   '<h4>'+escaped(localized.title)+'</h4><p>'+escaped(localized.detail)+'</p></span></button>';
 }).join('');
}
function measure(){
 const canvas=$('chart'),r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.max(0,r.width),h=Math.max(0,r.height);
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);return {ctx,w,h};
}
function draw(now=performance.now()){
 if(!candles.length||!analysis)return;
 const {ctx,w,h}=measure();if(w<80||h<100)return;
 const left=w<480?17:27,right=w<480?74:92,top=37,bottom=h-52,innerW=w-left-right,innerH=bottom-top;
 const maxWindow=w<380?16:w<610?20:w<860?45:80;
 const count=Math.min(candles.length,maxWindow),first=Math.max(0,Math.min(candles.length-count,current-count+4));
 const step=innerW/count,barWidth=Math.max(1,Math.min(17,step*.63));
 const xAt=i=>left+(i-first+.5)*step;
 const {min,max}=scaleAt(now),yAt=v=>top+(max-v)/(max-min)*innerH;
 const tr=transition,p=tr?Math.max(0,Math.min(1,(now-tr.started)/tr.duration)):1,k=ease(p);
 geo={left,right,top,bottom,w,h,innerW,innerH,step,first,count,xAt,yAt};
 ctx.fillStyle=THEME.background;ctx.fillRect(0,0,w,h);
 const ticks=Math.max(1,Math.ceil(85/Math.max(step,1)));
 ctx.font='10px ui-monospace, monospace';
 for(let i=first;i<first+count;i+=ticks){const x=xAt(i);ctx.fillStyle='#385064';ctx.textAlign='center';ctx.fillText(time(candles[i].time),x,h-27);}
 for(let i=0;i<=5;i++){
  const y=top+(bottom-top)*i/5,value=max-(max-min)*i/5;
  ctx.textAlign='left';ctx.fillStyle='#425669';ctx.fillText(compact(value),left+innerW+9,y+3);
 }
 if(current<candles.length-1){
  const nextX=Math.min(left+innerW,xAt(current)+step*.5),remain=Math.max(0,left+innerW-nextX);
  if(remain>0){
   ctx.fillStyle='rgba(48,73,91,.11)';ctx.fillRect(nextX,top,remain,innerH);
   ctx.strokeStyle='rgba(50,69,81,.5)';ctx.lineWidth=.8;ctx.setLineDash([3,6]);ctx.beginPath();ctx.moveTo(nextX,top);ctx.lineTo(nextX,bottom);ctx.stroke();ctx.setLineDash([]);
  }
 }
 if(layers.inside){
  for(const z of analysis.zones){if(z.last<first)continue;const mother=candles[z.mother];
   const x1=Math.max(left,xAt(z.mother)-step*.49),x2=Math.min(left+innerW,xAt(z.last)+step*.49);
   const y1=yAt(mother.high),y2=yAt(mother.low);
   if(x2<=x1||y2<=y1)continue;
   ctx.fillStyle='rgba(188,127,55,.12)';ctx.fillRect(x1,y1,x2-x1,y2-y1);
   ctx.strokeStyle='rgba(132,92,49,.7)';ctx.lineWidth=.9;ctx.setLineDash([4,5]);
   for(const y of [y1,y2]){ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();}ctx.setLineDash([]);
   ctx.textAlign='left';ctx.font='bold 10px ui-monospace,monospace';ctx.fillStyle='#6b4c27';ctx.fillText('IB '+time(mother.time),x1+4,Math.max(top+12,y1-7));
  }
 }
 // Advanced levels are drawn only when known from CLOSED candles.
 if(layers.structure&&analysis.advanced){
  const {external:ex,internal:inn}=analysis.advanced;
  const marked=[
   {p:ex.majorHigh,label:'MH',color:'#205a9b',dash:[7,4],alpha:.86},
   {p:ex.majorLow,label:'ML',color:'#077f68',dash:[7,4],alpha:.86},
   {p:inn.protectedHigh||inn.internalHigh,label:'iSH',color:'#835c23',dash:[3,7],alpha:.76},
   {p:inn.protectedLow||inn.internalLow,label:'iSL',color:'#835c23',dash:[3,7],alpha:.76}
  ];
  const usedY=[];
  for(const m of marked){
   if(!m.p)continue;
   const yy=yAt(m.p.price);
   if(yy<top||yy>bottom||usedY.some(v=>Math.abs(v-yy)<12))continue;
   usedY.push(yy);ctx.save();ctx.globalAlpha=m.alpha;ctx.strokeStyle=m.color;ctx.lineWidth=1;
   ctx.setLineDash(m.dash);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(left+innerW,yy);ctx.stroke();ctx.setLineDash([]);
   ctx.fillStyle=m.color;ctx.font='bold 10px ui-monospace,monospace';ctx.textAlign='right';
   ctx.fillText(m.label,left+innerW-5,yy-5);ctx.restore();
  }
 }
 const accepted=analysis.confirmed;
 if(layers.structure&&accepted.length>1){
  ctx.save();ctx.beginPath();ctx.rect(left,top,innerW,innerH);ctx.clip();
  ctx.beginPath();let drawn=false;
  for(let i=0;i<accepted.length;i++){
   const node=accepted[i],x=xAt(node.index),y=yAt(node.price);
   if(i===0){ctx.moveTo(x,y);drawn=true;continue;}
   if(tr&&tr.added.has(node.id)){
    const last=accepted[i-1],xx=lerp(xAt(last.index),x,k),yy=lerp(yAt(last.price),y,k);
    ctx.lineTo(xx,yy);
    if(k<1){drawn=true;break;}
   }else ctx.lineTo(x,y);
  }
  if(drawn){ctx.strokeStyle='#265dd4';ctx.lineWidth=2.3;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();}
  ctx.restore();
 }
 for(let i=first;i<=Math.min(current,first+count-1);i++){
  const c=candles[i],x=xAt(i),up=c.close>=c.open,style=up?THEME.candles.up:THEME.candles.down;
  const newest=tr&&i===tr.newest&&tr.previous!==tr.newest;
  ctx.save();if(newest){ctx.globalAlpha=.18+.82*k;ctx.translate(0,(1-k)*4);}
  // Wick: opaque black regardless of candle direction (while fully revealed).
  ctx.save();ctx.globalAlpha*=style.wickOpacity;ctx.strokeStyle=style.wick;
  ctx.lineWidth=Math.max(1,Math.min(1.6,barWidth*.115));ctx.beginPath();ctx.moveTo(x,yAt(c.high));ctx.lineTo(x,yAt(c.low));ctx.stroke();ctx.restore();
  const yt=yAt(Math.max(c.open,c.close)),yb=yAt(Math.min(c.open,c.close)),bodyHeight=Math.max(1.8,yb-yt);
  ctx.save();ctx.globalAlpha*=style.bodyOpacity;ctx.fillStyle=style.body;ctx.fillRect(x-barWidth/2,yt,barWidth,bodyHeight);ctx.restore();
  ctx.save();ctx.globalAlpha*=style.borderOpacity;ctx.strokeStyle=style.border;ctx.lineWidth=.95;
  ctx.strokeRect(x-barWidth/2,yt,barWidth,bodyHeight);ctx.restore();
  ctx.restore();
 }
 if(layers.structure||layers.raw){
  const labels=[];
  for(const s of analysis.swings){if(s.index<first||s.index>=first+count)continue;
   const x=xAt(s.index),y=yAt(s.price);
   if(layers.raw){ctx.save();ctx.strokeStyle=s.status==='inside_rejected'?'#ac4b47':PALETTE.raw;ctx.lineWidth=1.15;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.stroke();if(s.status!=='eligible'){ctx.beginPath();ctx.moveTo(x-3.5,y-3.5);ctx.lineTo(x+3.5,y+3.5);ctx.moveTo(x+3.5,y-3.5);ctx.lineTo(x-3.5,y+3.5);ctx.stroke();}ctx.restore();}
   if(!layers.structure||!['confirmed','pending'].includes(s.structStatus))continue;
   const full=s.structStatus==='confirmed',col=!full?'#647a8a':s.type==='SH'?'#2859aa':'#0b7866';
   ctx.save();const newAccepted=tr&&tr.added.has(s.id);if(newAccepted)ctx.globalAlpha=.3+.7*k;
   ctx.fillStyle=full?col:THEME.background;ctx.strokeStyle=col;ctx.lineWidth=1.5;
   ctx.beginPath();ctx.arc(x,y,full?4.3:3.4,0,Math.PI*2);ctx.fill();ctx.stroke();
   const label=full?(s.comp||s.type):s.type+'?';ctx.font='bold 10px ui-sans-serif,sans-serif';
   const ww=ctx.measureText(label).width+16,hh=20;
   const posX=Math.max(left+ww/2,Math.min(left+innerW-ww/2,x));
   let posY=Math.max(top+5,Math.min(bottom-hh-5,y+(s.type==='SH'?-34:16)));
   for(let j=0;j<7;j++){if(!labels.some(b=>posX-ww/2<b.x+b.w+2&&posX+ww/2>b.x-2&&posY<b.y+b.h+3&&posY+hh>b.y-3))break;posY+=s.type==='SH'?-22:22;posY=Math.max(top+3,Math.min(bottom-hh-3,posY));}
   labels.push({x:posX-ww/2,y:posY,w:ww,h:hh});
   ctx.strokeStyle=col;ctx.globalAlpha*=.43;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(posX,posY+(s.type==='SH'?hh:0));ctx.stroke();ctx.globalAlpha=newAccepted?.3+.7*k:1;
   ctx.fillStyle=full?'#edf4fb':'#f1f5f8';ctx.strokeStyle=col;ctx.lineWidth=.75;ctx.beginPath();ctx.roundRect(posX-ww/2,posY,ww,hh,5);ctx.fill();ctx.stroke();
   ctx.textAlign='center';ctx.fillStyle=full?'#21364a':'#4c6373';ctx.fillText(label,posX,posY+14);ctx.restore();
  }
 }
 // Connect the live event to its actual historical pivot; this is a visual pulse only.
 if(tr&&tr.flash&&p<1){
  const ev=currentEventList()[0];
  if(ev&&ev.pivotIndex!==null&&ev.pivotIndex!==undefined&&ev.pivotIndex>=first){
   const focus=analysis.swings.find(s=>s.index===ev.pivotIndex);
   if(focus){ctx.save();ctx.globalAlpha=(1-k)*.8;ctx.strokeStyle=severity(ev);ctx.lineWidth=2;
    ctx.shadowColor=severity(ev);ctx.shadowBlur=15;
    ctx.beginPath();ctx.arc(xAt(focus.index),yAt(focus.price),9+k*22,0,Math.PI*2);ctx.stroke();ctx.restore();}
  }
 }
 const last=candles[current],x=xAt(current),valueY=yAt(last.close),positive=last.close>=last.open,col=positive?'#285c85':'#2c7b3f';
 ctx.strokeStyle=col;ctx.lineWidth=.9;ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(x+barWidth/2+3,valueY);ctx.lineTo(left+innerW,valueY);ctx.stroke();ctx.setLineDash([]);
 const pillY=Math.max(top+10,Math.min(bottom-11,valueY));ctx.fillStyle=positive?'#245779':'#2f7b40';ctx.beginPath();ctx.roundRect(left+innerW+3,pillY-12,right-8,24,5);ctx.fill();
 ctx.textAlign='left';ctx.fillStyle='#ffffff';ctx.font='bold 10px ui-monospace,monospace';ctx.fillText(last.close.toLocaleString('en-US',{maximumFractionDigits:1}),left+innerW+8,pillY+4);
 if(tr&&tr.flash&&tr.previous!==tr.newest){
  const xnow=xAt(current),glow=1-k;
  ctx.strokeStyle='rgba(26,111,87,'+(glow*.55)+')';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(xnow,yAt(last.close),7+(1-glow)*17,0,Math.PI*2);ctx.stroke();
 }
 // Time passes continuously between CLOSED bars. The scan cursor is time-only:
 // no OHLC from the next candle is revealed until that candle closes.
 if(playing&&current<candles.length-1){
  const fraction=Math.max(0,Math.min(1,acc/(1200/speed)));
  const marker=lerp(xAt(current),xAt(current+1),fraction);
  ctx.save();ctx.globalAlpha=.65;ctx.strokeStyle='#276a64';ctx.lineWidth=1;
  ctx.shadowColor='#2e716c';ctx.shadowBlur=9;
  ctx.beginPath();ctx.moveTo(marker,top);ctx.lineTo(marker,bottom);ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle='#286b63';ctx.beginPath();ctx.arc(marker,bottom+3,2.4,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 if(hover!==null&&hover<=current&&hover>=first){const xh=xAt(hover);ctx.setLineDash([3,5]);ctx.strokeStyle='#506b7f';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(xh,top);ctx.lineTo(xh,bottom);ctx.stroke();ctx.setLineDash([]);}
}
function tick(now){
 request=null;if(!lastFrame)lastFrame=now;
 const dt=Math.min(100,Math.max(0,now-lastFrame));lastFrame=now;
 if(playing){
  acc+=dt;const period=1200/speed;
  let safety=0;
  while(acc>=period&&current<candles.length-1&&safety++<30){acc-=period;stepTo(current+1,{animate:true,flash:true});}
  if(current>=candles.length-1){setPlaying(false);}
 }
 draw(now);
 const animating=transition&&now<transition.started+transition.duration;
 if(playing||animating)schedule();else transition=null;
}
function loadDataset(payload, initialIndex=0){
 const data=payload.candles;
 if(!Array.isArray(data)||!data.length)throw Error(t('invalidCandles'));
 for(const c of data){for(const k of ['open','high','low','close']){if(!Number.isFinite(c[k]))throw Error(t('invalidOHLC'));}}
 stop();candles=data;datasetDetails=payload;datasetId=payload.dataset.id;source=payload.dataset.filename;
 cache=new Map();current=0;analysis=getAnalysis(0);transition=null;lastFrame=0;feedSignature='';hover=null;
 $('scrubber').max=String(candles.length-1);$('firstTime').textContent=time(candles[0].time);$('lastTime').textContent=time(candles.at(-1).time);
 $('canvasTimeframe').textContent=inferFrame()+' / '+t('closed');
 sourceMetaLine='';
 $('dataDetails').title=(payload.warnings||[]).join('\n');
 $('removeData').hidden=!!payload.dataset.builtin;
 setError('');
 stepTo(Math.min(initialIndex,candles.length-1),{animate:false});
}
async function apiJSON(path,options){
 const resp=await fetch(path,{cache:'no-store',...options});
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
function updateTooltip(evt){
 if(hover===null||hover>current){$('tooltip').classList.add('hidden');return;}
 const c=candles[hover],tip=$('tooltip');
 tip.innerHTML='<header class="mono">'+escaped(c.time.slice(0,16))+'</header><div class="tip-rows"><span>'+escaped(t('tooltipOpen'))+'</span><b class="mono">'+number(c.open)+'</b><span>'+escaped(t('tooltipHigh'))+'</span><b class="mono">'+number(c.high)+'</b><span>'+escaped(t('tooltipLow'))+'</span><b class="mono">'+number(c.low)+'</b><span>'+escaped(t('tooltipClose'))+'</span><b class="mono">'+number(c.close)+'</b>'+(c.volume===null||c.volume===undefined?'':'<span>'+escaped(t('tooltipVolume'))+'</span><b class="mono">'+number(c.volume)+'</b>')+'</div>';
 tip.classList.remove('hidden');const r=$('chartBox').getBoundingClientRect();tip.style.left=Math.max(8,Math.min(r.width-194,evt.clientX-r.left+15))+'px';tip.style.top=Math.max(8,Math.min(r.height-205,evt.clientY-r.top-53))+'px';
}
$('play').addEventListener('click',()=>{if(playing){stop();return;}if(current>=candles.length-1)stepTo(0,{animate:false});setPlaying(true);});
$('restart').addEventListener('click',()=>{stop();stepTo(0);});
$('prev').addEventListener('click',()=>{stop();stepTo(current-1);});
$('next').addEventListener('click',()=>{stop();stepTo(current+1);});
$('scrubber').addEventListener('input',e=>{stop();stepTo(Number(e.target.value),{animate:true});});
$('speed').addEventListener('change',e=>{speed=Number(e.target.value)||1;acc=0;lastFrame=0;if(playing)schedule();});
for(const [id,property] of [['toggleStructure','structure'],['toggleInside','inside'],['toggleRaw','raw']]){
 $(id).addEventListener('click',()=>{layers[property]=!layers[property];$(id).setAttribute('aria-pressed',String(layers[property]));schedule();});
}
$('events').addEventListener('click',event=>{const row=event.target.closest('[data-candle]');if(!row)return;stop();stepTo(Number(row.dataset.candle),{animate:true,flash:true});});
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
$('chart').addEventListener('mousemove',evt=>{
 if(!geo)return;const r=$('chart').getBoundingClientRect(),idx=Math.floor((evt.clientX-r.left-geo.left)/geo.step)+geo.first;
 hover=idx<geo.first||idx>current||idx>=geo.first+geo.count?null:idx;
 if(hover===null)$('tooltip').classList.add('hidden');else updateTooltip(evt);
 updateTop();schedule();
});
$('chart').addEventListener('mouseleave',()=>{hover=null;$('tooltip').classList.add('hidden');updateTop();schedule();});
$('chart').addEventListener('click',evt=>{if(!geo)return;const r=$('chart').getBoundingClientRect();stop();stepTo(Math.floor((evt.clientX-r.left-geo.left)/geo.step)+geo.first);});
window.addEventListener('resize',schedule);
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
