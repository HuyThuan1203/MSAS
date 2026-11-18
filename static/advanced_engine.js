/* Advanced structure overlay V1: major/external and minor/internal structural roles.
 * Sources: Cau_truc_nang_cao_-_Final.pptx slides 3-14.
 * This module consumes pre-confirmed alternating pivots from engine.js and CLOSED candles.
 * It does not alter raw 3-bar pivot detection, mother zones, or their audit semantics.
 * Assumptions which are not fully specified by slides are documented in docs/advanced/.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.AdvancedStructureEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VALID_TRENDS=new Set(['unknown','up','down']);
// PPT 'Mau_hinh_xac_nhan_ao_chieu_-_Final' slide 8: zero tolerance.
// A wick only is a weak MSS attempt (C); only a CLOSE strictly beyond the
// active Major confirms MSS S+ and reverses the main trend.
const MSS_TOLERANCE=0;
const level=p=>p?{id:p.id,index:p.index,type:p.type,price:p.price,confirmedAt:p.structConfirmedAt??p.confirmedAt??null}:null;
const latest=(pivots,type)=>{for(let i=pivots.length-1;i>=0;i--)if(pivots[i].type===type)return pivots[i];return null;};
const earlierOpposite=(pivots,p)=>{for(let i=pivots.length-1;i>=0;i--){const q=pivots[i];if(q.type!==p.type&&q.index<p.index)return q;}return null;};
function pairTrend(pivots){
 const hs=pivots.filter(p=>p.type==='SH'),ls=pivots.filter(p=>p.type==='SL');
 if(hs.length<2||ls.length<2)return 'unknown';
 const H=hs.at(-1).price-hs.at(-2).price,L=ls.at(-1).price-ls.at(-2).price;
 if(H>0&&L>0)return 'up';if(H<0&&L<0)return 'down';return 'unknown';
}
function makeState(){return {
 at:-1,previousClose:null,history:[],events:[],roleChanges:[],closed:[],
 mss:{tolerance:MSS_TOLERANCE,last:null,lastWeak:null,weakAttempt:null},
 cisd:{reference:null,last:null,emitted:[]},
 external:{trend:'unknown',phase:'uninitialized',majorHigh:null,majorLow:null,breakAt:null,breakLevel:null},
 internal:{trend:'unknown',phase:'uninitialized',internalHigh:null,internalLow:null,protectedHigh:null,protectedLow:null,pendingDirection:null,pendingBreakAt:null,confirmed:false},
 segmentStart:-1
};}
function log(s,at,kind,layer,title,detail,refs=[],source='ADV:S14',severity='info',data=null){
 const ev={id:`${kind}:${at}:${s.events.length}`,at,kind,layer,title,detail,severity,source,refs,data};
 s.events.push(ev);return ev;
}
function changeRole(s,at,p,from,to,reason){if(!p)return; s.roleChanges.push({at,pivot_id:p.id,pivot_index:p.index,from,to,reason});}
function clearInternal(s){s.internal={trend:'unknown',phase:'collecting',internalHigh:null,internalLow:null,protectedHigh:null,protectedLow:null,pendingDirection:null,pendingBreakAt:null,confirmed:false};}
function validInternalPivots(s){
 const ext=s.external;
 if(!ext.majorHigh||!ext.majorLow)return [];
 const lo=ext.majorLow.price,hi=ext.majorHigh.price;
 return s.history.filter(p=>p.index>s.segmentStart && p.price>=lo && p.price<=hi);
}
function protectedLevel(pivots,direction){
 // A local downtrend reverses against the HIGH preceding the latest genuine LL.
 // It is not necessarily the latest SH (slide 13: point 12 must break 8, not 10).
 // Symmetric for an uptrend: use the low preceding its latest HH.
 const kind=direction==='down'?'SL':'SH',reverse=direction==='down'?'SH':'SL';
 const same=pivots.filter(p=>p.type===kind);
 if(same.length<2)return null;
 for(let i=same.length-1;i>0;i--){
  const progressed=direction==='down'?same[i].price<same[i-1].price:same[i].price>same[i-1].price;
  if(!progressed)continue;
  const before=pivots.filter(p=>p.type===reverse && p.index<same[i].index).at(-1);
  if(before)return level(before);
 }
 return null;
}
function refreshInternal(s,at){
 const set=validInternalPivots(s),prevHigh=s.internal.internalHigh,prevLow=s.internal.internalLow;
 s.internal.internalHigh=level(latest(set,'SH'));
 s.internal.internalLow=level(latest(set,'SL'));
 if(prevHigh?.id!==s.internal.internalHigh?.id){
  if(prevHigh)changeRole(s,at,prevHigh,'internal_sh','historical_swing','newer_internal_high');
  if(s.internal.internalHigh)changeRole(s,at,s.internal.internalHigh,'confirmed_swing','internal_sh','latest_internal_high');
 }
 if(prevLow?.id!==s.internal.internalLow?.id){
  if(prevLow)changeRole(s,at,prevLow,'internal_sl','historical_swing','newer_internal_low');
  if(s.internal.internalLow)changeRole(s,at,s.internal.internalLow,'confirmed_swing','internal_sl','latest_internal_low');
 }
 const direction=pairTrend(set);
 // Protected levels are retained through a pullback. A weaker intermediate high
 // does not supersede the high protecting the last lower low (ADV slide 13).
 if(s.internal.trend==='down')s.internal.protectedHigh=protectedLevel(set,'down');
 if(s.internal.trend==='up')s.internal.protectedLow=protectedLevel(set,'up');
 if(s.internal.pendingDirection){
  const newHigh=latest(set,'SH'),newLow=latest(set,'SL');
  const confirmedSequence=s.internal.pendingDirection==='up' ?
    (newHigh && newLow && newHigh.index>=s.internal.pendingBreakAt && newLow.index>newHigh.index) :
    (newLow && newHigh && newLow.index>=s.internal.pendingBreakAt && newHigh.index>newLow.index);
  if(direction===s.internal.pendingDirection && confirmedSequence){
   s.internal.trend=direction;s.internal.confirmed=true;s.internal.phase='confirmed';
   s.internal.protectedHigh=protectedLevel(set,'down');s.internal.protectedLow=protectedLevel(set,'up');
   s.internal.pendingDirection=null;s.internal.pendingBreakAt=null;
   log(s,at,'internal_confirmed','internal','Internal '+(direction==='up'?'TĂNG':'GIẢM')+' đã xác nhận',
      'Cặp HH+HL hoặc LH+LL của các Swing Internal đã xác nhận hướng mới.',
      [s.internal.internalHigh?.id,s.internal.internalLow?.id].filter(Boolean),'ADV:S13-14','success',{direction});
  }
 }else if(s.internal.trend==='unknown'&&direction!=='unknown'){
  s.internal.trend=direction;s.internal.confirmed=true;s.internal.phase='confirmed';
  s.internal.protectedHigh=protectedLevel(set,'down');s.internal.protectedLow=protectedLevel(set,'up');
  log(s,at,'internal_established','internal','Nhận diện Internal '+(direction==='up'?'TĂNG':'GIẢM'),
      'Các Swing nằm trong biên Major đáp ứng '+(direction==='up'?'HH+HL':'LH+LL')+'; không thay đổi xu hướng Major.',
      [s.internal.internalHigh?.id,s.internal.internalLow?.id].filter(Boolean),'ADV:S6-7','info',{direction});
 }
}
function setMajor(s,at,trend,high,low,reason){
 const e=s.external;
 if(e.majorHigh&&e.majorHigh.id!==high?.id)changeRole(s,at,e.majorHigh,'major_high','historical_major','major_rolled');
 if(e.majorLow&&e.majorLow.id!==low?.id)changeRole(s,at,e.majorLow,'major_low','historical_major','major_rolled');
 e.trend=trend;e.phase='confirmed';e.majorHigh=level(high);e.majorLow=level(low);e.breakAt=null;e.breakLevel=null;
 if(high)changeRole(s,at,high,'confirmed_swing','major_high',reason);
 if(low)changeRole(s,at,low,'confirmed_swing','major_low',reason);
 s.segmentStart=trend==='up'?high.index:low.index;
 clearInternal(s);
}
function initialize(s,at){
 if(s.external.phase!=='uninitialized')return;
 const trend=pairTrend(s.history);
 if(trend==='unknown')return;
 const edge=latest(s.history,trend==='up'?'SH':'SL');
 const opposite=earlierOpposite(s.history,edge);
 if(!opposite)return;
 const H=trend==='up'?edge:opposite,L=trend==='up'?opposite:edge;
 setMajor(s,at,trend,H,L,'initial_major_pair');
 log(s,at,'major_established','external','Khởi tạo cấu trúc chính '+(trend==='up'?'TĂNG':'GIẢM'),
     `Major High ${H.price}; Major Low ${L.price}. Xác định từ Swing đã được chấp nhận theo HH+HL / LH+LL.`,
     [H.id,L.id],'ADV:S5,S14','success',{direction:trend,majorHigh:H.price,majorLow:L.price});
}
/** Choose the strongest ALREADY CONFIRMED structural extreme of the pending
 * break wave, not the last swing to happen to confirm after a Close breakout.
 * A major role is assigned only at `at`, never at the historical pivot time.
 * Slide 11/13: major expansion 10/9 or 14/13; source does not fully specify
 * competing pivot tie-breaks, so this remains an explicit provisional policy.
 */
function pendingMajorPair(s,direction){
 const e=s.external,kind=direction==='up'?'SH':'SL';
 if(e.breakAt===null||e.breakLevel===null)return null;
 const anchor=direction==='up'?(e.majorHigh?.index??s.segmentStart-1):(e.majorLow?.index??s.segmentStart-1);
 const eligible=s.history.filter(p=>p.type===kind&&p.index>anchor&&
  (direction==='up'?p.price>e.breakLevel:p.price<e.breakLevel));
 // An accepted extreme may be known BEFORE the Close crosses the old Major
 // boundary. Prefer the strongest price across the wave, not the latest pivot.
 eligible.sort((a,b)=>direction==='up'?b.price-a.price||a.index-b.index:a.price-b.price||a.index-b.index);
 for(const extreme of eligible){
  // If the new extreme was already confirmed BEFORE the closing breakout,
  // the protected counter-extreme can form AFTER it but BEFORE the breakout.
  // XAU source user annotation: MH SH-34 followed by corrective ML SL-37.
  // Otherwise use the latest preceding opposite pivot (PPT 14/13 case).
  const opposites=s.history.filter(p=>p.type!==kind && p.index>anchor);
  const follow=opposites.filter(p=>p.index>extreme.index && p.index<=e.breakAt);
  follow.sort((a,b)=>direction==='up'?a.price-b.price||a.index-b.index:b.price-a.price||a.index-b.index);
  const opposite=follow[0]||earlierOpposite(s.history,extreme);
  if(opposite){
   return direction==='up'?{high:extreme,low:opposite}:{high:opposite,low:extreme};
  }
 }
 return null;
}
/** Most recent candle cluster moving in the OLD main trend, within the latest
 * eligible swing wave. The Open of its FIRST candle is the CISD reference.
 * The wave boundary uses confirmed opposite swing evidence only, never future
 * pivots. See REV slides 5-8; the exact wave-boundary tie-break is provisional.
 */
function lastOldDirectionCluster(s,at,trend){
 const oldBearish=trend==='down';
 const oppositeType=oldBearish?'SH':'SL';
 const opposite=s.history.filter(p=>p.type===oppositeType).at(-1);
 const waveStart=Math.max(0,s.segmentStart,opposite?.index??0);
 const oldDirection=c=>c && Number.isFinite(c.open)&&
    (oldBearish?c.close<c.open:c.close>c.open);
 let end=-1;
 for(let i=at-1;i>=waveStart;i--){if(oldDirection(s.closed[i])){end=i;break;}}
 if(end<0)return null;
 let start=end;
 while(start-1>=waveStart&&oldDirection(s.closed[start-1]))start--;
 return {direction:trend,startIndex:start,endIndex:end,open:s.closed[start].open,
         waveStartIndex:waveStart,opposingSwingId:opposite?.id??null};
}
function scanReversalSignals(s,at,bar,previousMajor){
 const {trend,majorHigh,majorLow}=previousMajor;
 if(!['up','down'].includes(trend)||!Number.isFinite(bar.open))return;
 const isDown=trend==='down';
 const threshold=isDown?majorHigh:majorLow;
 if(threshold&&Number.isFinite(isDown?bar.high:bar.low)){
  // C: only wick crosses the Major boundary; the body stays inside it.
  const wickBreak=isDown?bar.high>threshold.price+MSS_TOLERANCE:bar.low<threshold.price-MSS_TOLERANCE;
  const bodyInside=isDown?bar.open<=threshold.price && bar.close<threshold.price:
                           bar.open>=threshold.price && bar.close>threshold.price;
  const weak=wickBreak&&bodyInside;
  const key=trend+':'+threshold.id;
  if(weak&&s.mss.weakAttempt!==key){
   const direction=isDown?'up':'down';
   const ev=log(s,at,'mss_weak','external','MSS C · nỗ lực đảo chiều yếu',
      `Râu nến vượt ${isDown?'Major High':'Major Low'} ${threshold.price}, nhưng Close ${bar.close} trở lại biên. Main ${trend==='up'?'TĂNG':'GIẢM'} giữ nguyên.`,
      [threshold.id],'REV:S4,S8','warning',
      {label:'C',direction,mainTrend:trend,close:bar.close,wick:isDown?bar.high:bar.low,
       brokenLevel:threshold.price,majorPivotId:threshold.id,confirmed:false,tolerance:MSS_TOLERANCE});
   s.mss.lastWeak={at,label:'C',eventId:ev.id,majorPivotId:threshold.id};
  }
  s.mss.weakAttempt=weak?key:null;
 }else s.mss.weakAttempt=null;
 // B: this candle must oppose the old direction; a close through the FIRST
 // old-direction candle's Open of the LAST contiguous group is required.
 const ref=lastOldDirectionCluster(s,at,trend);
 s.cisd.reference=ref;
 if(!ref)return;
 const reversesDelivery=isDown?bar.close>bar.open:bar.close<bar.open;
 const crossed=isDown?bar.close>ref.open+MSS_TOLERANCE:bar.close<ref.open-MSS_TOLERANCE;
 const key=trend+':'+ref.startIndex;
 if(reversesDelivery&&crossed&&!s.cisd.emitted.includes(key)){
  const direction=isDown?'up':'down';
  const ev=log(s,at,'cisd','delivery','CISD B · thay đổi hành vi giá',
    `Close ${bar.close} vượt Open ${ref.open} của nến đầu cụm ${trend==='down'?'GIẢM':'TĂNG'} cuối cùng. Đây chỉ là tín hiệu sớm; Major vẫn ${trend==='up'?'TĂNG':'GIẢM'}.`,
    [],'REV:S5-S8','warning',
    {label:'B',direction,mainTrend:trend,close:bar.close,referenceOpen:ref.open,
     referenceStartIndex:ref.startIndex,referenceEndIndex:ref.endIndex,
     waveStartIndex:ref.waveStartIndex,confirmed:false,tolerance:MSS_TOLERANCE});
  s.cisd.emitted.push(key);
  s.cisd.last={at,label:'B',eventId:ev.id,referenceOpen:ref.open,
                referenceStartIndex:ref.startIndex,majorDirectionUnchanged:true};
 }
}
function cross(prev,now,threshold,direction){
 if(threshold===null||threshold===undefined)return false;
 return direction==='up'?(now>threshold&&(prev===null||prev<=threshold)):(now<threshold&&(prev===null||prev>=threshold));
}
function advance(s,at,candleOrClose,newlyConfirmed=[]){
 // Numeric close-only synthetic fixtures are supported for structural tests.
 // They cannot generate candle-shape (C) or Open/Close (B) labels.
 const raw=typeof candleOrClose==='number'?{close:candleOrClose}:candleOrClose;
 const close=raw?.close;
 if(!Number.isFinite(close))throw Error('Giá đóng cửa phải hữu hạn.');
 const bar={open:Number.isFinite(raw.open)?raw.open:null,
            high:Number.isFinite(raw.high)?raw.high:null,
            low:Number.isFinite(raw.low)?raw.low:null,close};
 s.closed.push(bar);
 if(at!==s.at+1)throw Error('Phải xử lý từng nến đã đóng theo thứ tự, không bỏ qua hoặc quay ngược.');
 const prev=s.previousClose,external=s.external,internal=s.internal;
 const majorBefore={trend:external.trend,majorHigh:external.majorHigh,majorLow:external.majorLow};
 // Price breaches are evaluated against levels known BEFORE the current candle closed.
 if(external.trend!=='unknown'){
  const h=external.majorHigh,l=external.majorLow;
  if(external.trend==='up'&&l&&cross(prev,close,l.price,'down')){
   const oldLow=l;
   changeRole(s,at,l,'major_low','broken_major_low','external_reversal');
   external.trend='down';external.phase='awaiting_major_low';external.majorLow=null;
   external.breakAt=at;external.breakLevel=oldLow.price;
   s.segmentStart=at;clearInternal(s);
   log(s,at,'major_reversal','external','Cấu trúc chính đảo chiều TĂNG → GIẢM',
       `Giá đóng ${close} thấp hơn Major Low ${oldLow.price}; giữ Major High ${h?.price??'chưa có'}, Major Low mới chờ xác nhận.`,
       [h?.id,oldLow.id].filter(Boolean),'ADV:S3,S7,S13-14;REV:S3,S8','error',
       {label:'S+',direction:'down',close,brokenLevel:oldLow.price,retainedLevel:h?.price??null,
        majorPivotId:oldLow.id,confirmed:true,tolerance:MSS_TOLERANCE});
  }else if(external.trend==='down'&&h&&cross(prev,close,h.price,'up')){
   const oldHigh=h;
   changeRole(s,at,h,'major_high','broken_major_high','external_reversal');
   external.trend='up';external.phase='awaiting_major_high';external.majorHigh=null;
   external.breakAt=at;external.breakLevel=oldHigh.price;
   s.segmentStart=at;clearInternal(s);
   log(s,at,'major_reversal','external','Cấu trúc chính đảo chiều GIẢM → TĂNG',
       `Giá đóng ${close} cao hơn Major High ${oldHigh.price}; giữ Major Low ${l?.price??'chưa có'}, Major High mới chờ xác nhận.`,
       [oldHigh.id,l?.id].filter(Boolean),'ADV:S3,S7,S14;REV:S3,S8','success',
       {label:'S+',direction:'up',close,brokenLevel:oldHigh.price,retainedLevel:l?.price??null,
        majorPivotId:oldHigh.id,confirmed:true,tolerance:MSS_TOLERANCE});
  }else if(external.phase==='confirmed'&&h&&l){
   if(external.trend==='up'&&cross(prev,close,h.price,'up')){
    external.phase='awaiting_major_high';external.breakAt=at;external.breakLevel=h.price;
    clearInternal(s);
    log(s,at,'major_continuation','external','Cấu trúc chính tiếp diễn TĂNG',
        `Close ${close} > Major High ${h.price}. Chờ Swing High mới hợp lệ để cập nhật cặp Major.`,[h.id],'ADV:S7,S11,S14','success',{direction:'up',close,brokenLevel:h.price});
   }else if(external.trend==='down'&&cross(prev,close,l.price,'down')){
    external.phase='awaiting_major_low';external.breakAt=at;external.breakLevel=l.price;
    clearInternal(s);
    log(s,at,'major_continuation','external','Cấu trúc chính tiếp diễn GIẢM',
        `Close ${close} < Major Low ${l.price}. Chờ Swing Low mới hợp lệ để cập nhật cặp Major.`,[l.id],'ADV:S7,S14','success',{direction:'down',close,brokenLevel:l.price});
   }else if(internal.confirmed && internal.internalHigh && internal.internalLow){
    if(internal.trend==='down'&&cross(prev,close,(internal.protectedHigh||internal.internalHigh).price,'up')){
     const threshold=internal.protectedHigh||internal.internalHigh;
     internal.trend='up';internal.pendingDirection='up';internal.pendingBreakAt=at;internal.confirmed=false;internal.phase='pending_confirmation';
     log(s,at,'internal_reversal','internal','Internal GIẢM → TĂNG (chờ xác nhận)',
         `Giá đóng ${close} phá Internal SH ${threshold.price}. Major ${external.trend==='up'?'TĂNG':'GIẢM'} chưa thay đổi; chờ HH+HL xác nhận.`,
         [threshold.id],'ADV:S7,S13-14','warning',{direction:'up',majorDirection:external.trend,close,brokenLevel:threshold.price});
    }else if(internal.trend==='up'&&cross(prev,close,(internal.protectedLow||internal.internalLow).price,'down')){
     const threshold=internal.protectedLow||internal.internalLow;
     internal.trend='down';internal.pendingDirection='down';internal.pendingBreakAt=at;internal.confirmed=false;internal.phase='pending_confirmation';
     log(s,at,'internal_reversal','internal','Internal TĂNG → GIẢM (chờ xác nhận)',
         `Giá đóng ${close} phá Internal SL ${threshold.price}. Major ${external.trend==='up'?'TĂNG':'GIẢM'} chưa thay đổi; chờ LH+LL xác nhận.`,
         [threshold.id],'ADV:S7,S14','warning',{direction:'down',majorDirection:external.trend,close,brokenLevel:threshold.price});
    }
   }
  }
 }
 // A confirmed S+ takes priority over weak C / early B on this same candle.
 // C and B never switch external.trend and never create Major pivots.
 if(majorBefore.trend!=='unknown'&&external.trend!==majorBefore.trend){
  const ev=s.events.find(e=>e.at===at&&e.kind==='major_reversal');
  s.mss.last={at,label:'S+',direction:external.trend,eventId:ev?.id??null,
              brokenLevel:ev?.data?.brokenLevel??null};
  s.mss.weakAttempt=null;s.cisd.reference=null;
 }else{
  scanReversalSignals(s,at,bar,majorBefore);
 }
 // Only pivots which are structurally confirmed by THIS closed candle may enter the ledger.
 for(const p of newlyConfirmed){
  if(p.structConfirmedAt!==at)throw Error(`Swing ${p.id} được cung cấp sai thời điểm xác nhận.`);
  if(p.index>=at)throw Error('Swing chỉ hợp lệ khi nến phía sau đã đóng.');
  if(!['SH','SL'].includes(p.type)||!Number.isFinite(p.price))throw Error('Swing không hợp lệ.');
  if(s.history.some(x=>x.id===p.id))throw Error('Pivot ID đã tồn tại.');
  s.history.push({id:p.id,index:p.index,type:p.type,price:p.price,structConfirmedAt:at});
 }
 // Init when the local accepted swing history is sufficient.
 initialize(s,at);
 if(external.phase==='awaiting_major_high'&&external.breakAt!==null){
  const pair=pendingMajorPair(s,'up');
  if(pair){
   setMajor(s,at,'up',pair.high,pair.low,'strongest_confirmed_major_break_wave');
   log(s,at,'major_updated','external','Đã cập nhật Major High / Major Low',
       `Major High ${pair.high.price}; Major Low ${pair.low.price}. Cặp đỉnh/đáy mạnh nhất đã xác nhận cho nhịp phá Major; không chọn cực trị chỉ vì xuất hiện gần nhất.`,
       [pair.high.id,pair.low.id],'ADV:S11,S13-14','success',{direction:'up',majorHigh:pair.high.price,majorLow:pair.low.price,
        majorHighIndex:pair.high.index,majorLowIndex:pair.low.index,selection:'strongest_confirmed_wave_provisional'});
  }
 }else if(external.phase==='awaiting_major_low'&&external.breakAt!==null){
  const pair=pendingMajorPair(s,'down');
  if(pair){
   setMajor(s,at,'down',pair.high,pair.low,'strongest_confirmed_major_break_wave');
   log(s,at,'major_updated','external','Đã cập nhật Major High / Major Low',
       `Major High ${pair.high.price}; Major Low ${pair.low.price}. Cặp đỉnh/đáy mạnh nhất đã xác nhận cho nhịp phá Major; không chọn cực trị chỉ vì xuất hiện gần nhất.`,
       [pair.high.id,pair.low.id],'ADV:S11,S13-14','success',{direction:'down',majorHigh:pair.high.price,majorLow:pair.low.price,
        majorHighIndex:pair.high.index,majorLowIndex:pair.low.index,selection:'strongest_confirmed_wave_provisional'});
  }
 }
 if(external.phase==='confirmed')refreshInternal(s,at);
 s.at=at;s.previousClose=close;
 if(!VALID_TRENDS.has(external.trend)||!VALID_TRENDS.has(s.internal.trend))throw Error('Xu hướng không hợp lệ.');
 return s;
}
function analysisFromAccepted(candles,accepted,upto){
 if(!Array.isArray(candles)||!candles.length)throw Error('Không có nến đã đóng.');
 const end=upto===undefined?candles.length-1:Math.min(candles.length-1,Math.max(0,upto));
 const grouped=new Map();
 for(const p of accepted){
  const at=p.structConfirmedAt;
  if(at===null||at===undefined||at>end)continue;
  if(!Number.isInteger(at)||at<=p.index||at<0)throw Error('Thời điểm xác nhận Swing không hợp lệ.');
  if(!grouped.has(at))grouped.set(at,[]);
  grouped.get(at).push(p);
 }
 const state=makeState();
 for(let t=0;t<=end;t++)advance(state,t,candles[t],grouped.get(t)||[]);
 return {end,external:state.external,internal:state.internal,
         mss:{tolerance:MSS_TOLERANCE,last:state.mss.last,lastWeak:state.mss.lastWeak},
         cisd:{reference:state.cisd.reference,last:state.cisd.last},
         events:state.events,roleChanges:state.roleChanges,
         acceptedCount:state.history.length,policy:{source:'ADV PPT S3-S14',majorSelection:'strongest-confirmed-extreme-in-closed-break-wave (provisional)',
            initialMajor:'latest confirmed trend pair',closeBreak:'strict',tolerance:0,
            mssSource:'REV S3-S4,S8',cisdSource:'REV S5-S8',
            cisdWaveBoundary:'latest eligible opposite pivot (provisional)',noLookahead:true},
         _state:state};
}
function analyzeAdvancedPrefix(candles,upto,base){
 const end=upto===undefined?candles.length-1:Math.min(candles.length-1,Math.max(0,upto));
 if(!base){
  const L=(typeof require==='function' ? require('./engine.js') :
    (typeof globalThis!=='undefined'?globalThis.MarketStructureEngine:null));
  if(!L)throw Error('Yêu cầu MarketStructureEngine để tính Swing nguồn.');
  base=L.analyzePrefix(candles,end);
 }
 return analysisFromAccepted(candles,base.confirmed,end);
}
return {makeState,advance,analysisFromAccepted,analyzeAdvancedPrefix,pairTrend,lastOldDirectionCluster,MSS_TOLERANCE};
});

