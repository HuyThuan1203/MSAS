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
 segmentStart:-1,majorRoleAt:-1
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
 const e=s.external,oldHighId=e.majorHigh?.id,oldLowId=e.majorLow?.id;
 if(e.majorHigh&&e.majorHigh.id!==high?.id)changeRole(s,at,e.majorHigh,'major_high','historical_major','major_rolled');
 if(e.majorLow&&e.majorLow.id!==low?.id)changeRole(s,at,e.majorLow,'major_low','historical_major','major_rolled');
 e.trend=trend;e.phase='confirmed';e.majorHigh=level(high);e.majorLow=level(low);e.breakAt=null;e.breakLevel=null;
 if(high&&high.id!==oldHighId)changeRole(s,at,high,'confirmed_swing','major_high',reason);
 if(low&&low.id!==oldLowId)changeRole(s,at,low,'confirmed_swing','major_low',reason);
 s.segmentStart=trend==='up'?high.index:low.index;
 s.majorRoleAt=at;
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
/** Major update on a newly CONFIRMED swing (user rule 2026-11-21; ADV slide 11).
 * Main UP: an accepted SH strictly above the active Major High (or above the
 * broken level while the new MH is still unknown after S+) immediately becomes
 * the Major High, and the Major Low moves to the latest accepted SL preceding
 * that SH (the low the new leg started from). Main DOWN is symmetric.
 * Runs at the candle that confirms the swing; never earlier, never later.
 */
function rollMajorOnSwing(s,at,p){
 const e=s.external;
 if(e.trend!=='up'&&e.trend!=='down')return false;
 const up=e.trend==='up';
 if(p.type!==(up?'SH':'SL'))return false;
 const edge=up?(e.majorHigh?e.majorHigh.price:e.breakLevel):(e.majorLow?e.majorLow.price:e.breakLevel);
 if(edge===null||edge===undefined)return false;
 if(!(up?p.price>edge+MSS_TOLERANCE:p.price<edge-MSS_TOLERANCE))return false;
 const opposite=s.history.filter(q=>q.type!==p.type&&q.index<p.index).at(-1);
 const keep=up?e.majorLow:e.majorHigh;
 if(!opposite&&!keep)return false;
 const high=up?p:(opposite||keep),low=up?(opposite||keep):p;
 const wasPending=e.phase!=='confirmed';
 setMajor(s,at,e.trend,high,low,'swing_outside_major');
 log(s,at,'major_updated','external','Đã cập nhật Major High / Major Low',
     up?`Swing High ${p.price} đã xác nhận nằm ngoài Major High ${edge}: Major High → ${high.price}; Major Low dời về Swing Low liền trước ${low.price}.`:
        `Swing Low ${p.price} đã xác nhận nằm ngoài Major Low ${edge}: Major Low → ${low.price}; Major High dời về Swing High liền trước ${high.price}.`,
     [high.id,low.id],'ADV:S11,S13-14;USER:2026-11-21','success',
     {direction:e.trend,majorHigh:high.price,majorLow:low.price,majorHighIndex:high.index,majorLowIndex:low.index,
      previousEdge:edge,afterPending:wasPending,selection:'confirmed_swing_outside_major'});
 return true;
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
  // REV slide 4 / MSS_CISD_RULEBOOK: C needs Close strictly back inside
  // (Close < MH in Main DOWN). Close exactly on the level is neither S+ nor C.
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
/** S+ : strict Close beyond the ACTIVE opposing Major (tolerance 0).
 * Main UP and Close < Major Low -> DOWN (retain MH, ML pending); symmetric.
 * Returns true when Main was reversed on this candle.
 */
function strictReversal(s,at,close){
 const external=s.external,h=external.majorHigh,l=external.majorLow;
 if(external.trend==='up'&&l&&close<l.price-MSS_TOLERANCE){
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
  return true;
 }
 if(external.trend==='down'&&h&&close>h.price+MSS_TOLERANCE){
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
  return true;
 }
 return false;
}
function cross(prev,now,threshold,direction){
 if(threshold===null||threshold===undefined)return false;
 return direction==='up'?(now>threshold&&(prev===null||prev<=threshold)):(now<threshold&&(prev===null||prev>=threshold));
}
function advance(s,at,candleOrClose,newlyConfirmed=[],supersededIds=[]){
 // Numeric close-only synthetic fixtures are supported for structural tests.
 // They cannot generate candle-shape (C) or Open/Close (B) labels.
 const raw=typeof candleOrClose==='number'?{close:candleOrClose}:candleOrClose;
 const close=raw?.close;
 if(!Number.isFinite(close))throw Error('Giá đóng cửa phải hữu hạn.');
 const bar={open:Number.isFinite(raw.open)?raw.open:null,
            high:Number.isFinite(raw.high)?raw.high:null,
            low:Number.isFinite(raw.low)?raw.low:null,close};
 if(at!==s.at+1)throw Error('Phải xử lý từng nến đã đóng theo thứ tự, không bỏ qua hoặc quay ngược.');
 // Validate every input BEFORE any state mutation (state stays reusable on error).
 const superseded=new Set(supersededIds);
 for(const id of superseded)if(!s.history.some(x=>x.id===id))throw Error(`Swing ${id} bị thay thế nhưng chưa từng được chấp nhận.`);
 const seen=new Set();
 for(const p of newlyConfirmed){
  if(p.structConfirmedAt!==at)throw Error(`Swing ${p.id} được cung cấp sai thời điểm xác nhận.`);
  if(p.index>=at)throw Error('Swing chỉ hợp lệ khi nến phía sau đã đóng.');
  if(!['SH','SL'].includes(p.type)||!Number.isFinite(p.price))throw Error('Swing không hợp lệ.');
  if(seen.has(p.id)||(s.history.some(x=>x.id===p.id)&&!superseded.has(p.id)))throw Error('Pivot ID đã tồn tại.');
  seen.add(p.id);
 }
 s.closed.push(bar);
 const prev=s.previousClose,external=s.external,internal=s.internal;
 const majorBefore={trend:external.trend,majorHigh:external.majorHigh,majorLow:external.majorLow};
 // Price breaches are evaluated against levels known BEFORE the current candle closed.
 if(external.trend!=='unknown'){
  const h=external.majorHigh,l=external.majorLow;
  if(strictReversal(s,at,close)){
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
 // Same-leg replacements known at THIS candle (engine.js alternation): the
 // superseded pivot leaves the ledger now, never retroactively.
 for(const id of superseded)s.history.splice(s.history.findIndex(x=>x.id===id),1);
 // Only pivots which are structurally confirmed by THIS closed candle may enter the ledger.
 const added=[];
 for(const p of newlyConfirmed){
  const q={id:p.id,index:p.index,type:p.type,price:p.price,structConfirmedAt:at};
  s.history.push(q);added.push(q);
 }
 // Init when the local accepted swing history is sufficient.
 initialize(s,at);
 // Update Major immediately on each newly confirmed swing outside it.
 for(const q of added)rollMajorOnSwing(s,at,q);
 // An active Major pivot replaced by a more extreme pivot of the SAME leg
 // (and not already rolled above) follows that replacement: it is the same
 // swing, now known to extend further.
 for(const key of ['majorHigh','majorLow']){
  const m=external[key];
  if(!m||!superseded.has(m.id))continue;
  const r=added.find(q=>q.type===m.type);
  if(!r)continue;
  changeRole(s,at,m,key==='majorHigh'?'major_high':'major_low','historical_major','same_leg_replaced');
  changeRole(s,at,r,'confirmed_swing',key==='majorHigh'?'major_high':'major_low','same_leg_replaced');
  external[key]=level(r);
 }
 // MSS_CISD_RULEBOOK: a candle's Close is judged against the Major that was
 // active BEFORE that candle. A pair that becomes active on this candle (roll
 // or initialization) is first tested by the NEXT closed candle.
 if(external.phase==='confirmed')refreshInternal(s,at);
 s.at=at;s.previousClose=close;
 if(!VALID_TRENDS.has(external.trend)||!VALID_TRENDS.has(s.internal.trend))throw Error('Xu hướng không hợp lệ.');
 return s;
}
function analysisFromAccepted(candles,accepted,upto){
 if(!Array.isArray(candles)||!candles.length)throw Error('Không có nến đã đóng.');
 const end=upto===undefined?candles.length-1:Math.min(candles.length-1,Math.max(0,upto));
 const grouped=new Map(),removed=new Map();
 for(const p of accepted){
  const at=p.structConfirmedAt;
  if(at===null||at===undefined||at>end)continue;
  if(!Number.isInteger(at)||at<=p.index||at<0)throw Error('Thời điểm xác nhận Swing không hợp lệ.');
  if(!grouped.has(at))grouped.set(at,[]);
  grouped.get(at).push(p);
  const gone=p.supersededAt;
  if(gone!==null&&gone!==undefined&&gone<=end){
   if(!Number.isInteger(gone)||gone<=at)throw Error('Thời điểm thay thế Swing không hợp lệ.');
   if(!removed.has(gone))removed.set(gone,[]);
   removed.get(gone).push(p.id);
  }
 }
 const state=makeState();
 for(let t=0;t<=end;t++)advance(state,t,candles[t],grouped.get(t)||[],removed.get(t)||[]);
 return {end,external:state.external,internal:state.internal,
         mss:{tolerance:MSS_TOLERANCE,last:state.mss.last,lastWeak:state.mss.lastWeak},
         cisd:{reference:state.cisd.reference,last:state.cisd.last},
         events:state.events,roleChanges:state.roleChanges,
         acceptedCount:state.history.length,policy:{source:'ADV PPT S3-S14',majorSelection:'confirmed swing outside Major -> new edge + preceding opposite swing (user rule 2026-11-21)',
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
 // `accepted` is the causal log (incl. later-superseded pivots with their
 // supersededAt); `confirmed` alone would rewrite history at earlier prefixes.
 if(!Array.isArray(base.accepted)){
  const L=(typeof require==='function' ? require('./engine.js') :
    (typeof globalThis!=='undefined'?globalThis.MarketStructureEngine:null));
  if(!L)throw Error('Thiếu nhật ký Swing nhân quả (accepted).');
  base=L.analyzePrefix(candles,end);
 }
 return analysisFromAccepted(candles,base.accepted,end);
}
return {makeState,advance,analysisFromAccepted,analyzeAdvancedPrefix,pairTrend,lastOldDirectionCluster,MSS_TOLERANCE};
});

