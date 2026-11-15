/* Bilingual display layer: numerical/structural calculations remain language-neutral.
 * Default is EN, VI is selectable. Engines retain their legacy Vietnamese audit texts
 * for compatibility and also emit structured data so English never parses Vietnamese.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.MSASI18N=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const UI={
 en:{
  data:'DATA',chooseDataset:'Select dataset',connecting:'Connecting…',upload:'+ Import',uploadTitle:'Import CSV, TSV, TXT, JSON or XLSX',removeTitle:'Remove imported dataset',chartTitle:'Market structure',loading:'Loading data…',indicators:'INDICATORS',structure:'Structure',inside:'Inside bar',candidates:'Candidates',timeline:'Replay timeline',replaySpeed:'SPEED',play:'Play',pause:'Pause',firstCandle:'First candle',previousCandle:'Previous candle',nextCandle:'Next candle',closed:'CLOSED CANDLES',notifications:'Notifications',updatedOnClose:'Updated after each candle closes',candleClose:'LAST CLOSED CANDLE',latestEvents:'RECENT EVENTS',awaiting:'AWAITING DATA',noneCategory:'CANDLE CLOSED',noneCount:'NO NEW SIGNAL',noSignal:'No new structural event',noSignalDetail:'The candle has closed. No new Swing or market-structure change has been confirmed.',closeMeta:'CLOSED CANDLE {time}',eventCount:'{count} events',atCandle:'{count} ON THIS CANDLE',emptyEvents:'No previous structural events. Move forward to see events when candles close.',jumpTo:'Jump to {time}',replay:'REPLAY',chartAria:'Candlestick chart and market-structure overlays',feedAria:'Replay event notifications',timeframeAria:'Replay timeline',mappingTitle:'Confirm column mapping',mappingReason:'Could not identify the source columns with confidence.',timestamp:'Timestamp',volumeOptional:'Volume (optional)',dateOrder:'Date format',dateAuto:'Auto-detect',dateDMY:'DD/MM/YYYY',dateMDY:'MM/DD/YYYY',mappingPreview:'Preview of the first three rows · verify column assignments before applying',cancel:'Cancel',applyMapping:'Apply mapping',noVolume:'(No volume)',chooseColumn:'-- Select a column --',unnamedColumn:'(unnamed)',dateAndTime:'Date + time',dragHint:'Drop a data file to import',loadingDataset:'Loading dataset',metaCandles:'{count} candles',metaGap:'{count} irregular interval(s)',metaMain:'Main',metaInternal:'Internal',metaPending:'pending confirmation',metaUp:'UP',metaDown:'DOWN',metaUnknown:'UNKNOWN',imported:'Imported {name} · {count} candles · {volume} volume.',volumeYes:'with',volumeNo:'without',gapsWarning:'Imported {count} candles. {gaps} irregular time interval(s); no synthetic candles were created.',loadFailed:'Could not open dataset: {message}',uploadFailed:'Could not import {name}: {message}',serverUnavailable:'Cannot connect to the application server: {message}',invalidServer:'The server returned an invalid response.',requestFailed:'The request failed.',invalidCandles:'No valid candles in this dataset.',invalidOHLC:'Invalid normalized OHLC data.',importRemoved:'Imported dataset removed.',confirmRemove:'Remove the selected imported dataset? The original file on your computer will not be affected.',mappingMissing:'Choose Timestamp, Open, High, Low and Close before continuing.',mappingHint:'Confirm the source columns to avoid incorrectly assigning prices.',fileNotRecognized:'Input could not be validated. Check the file, column mapping, timestamp or OHLC values.',errorMapping:'Column mapping is required.',errorDate:'Ambiguous date order. Select DMY or MDY.',errorOHLC:'OHLC values are inconsistent. Check the affected source row.',errorTimes:'Timestamps are duplicated or not in ascending order.',errorLarge:'File exceeds the allowed size or row limit.',errorUnsupported:'Unsupported input format.',errorGeneral:'Unable to process the input. Check source file and format.',tooltipOpen:'Open',tooltipHigh:'High',tooltipLow:'Low',tooltipClose:'Close',tooltipVolume:'Volume'
 },
 vi:{
  data:'DỮ LIỆU',chooseDataset:'Chọn bộ dữ liệu',connecting:'Đang kết nối…',upload:'+ Nạp file',uploadTitle:'Nạp CSV, TSV, TXT, JSON hoặc XLSX',removeTitle:'Xóa bộ dữ liệu đã nhập',chartTitle:'Biểu đồ cấu trúc',loading:'Đang tải dữ liệu…',indicators:'CHỈ BÁO',structure:'Cấu trúc',inside:'Inside bar',candidates:'Ứng viên',timeline:'Thanh thời gian phát lại',replaySpeed:'TỐC ĐỘ',play:'Phát',pause:'Dừng',firstCandle:'Nến đầu tiên',previousCandle:'Nến trước',nextCandle:'Nến tiếp theo',closed:'NẾN ĐÃ ĐÓNG',notifications:'Thông báo',updatedOnClose:'Cập nhật khi nến đóng',candleClose:'MỐC NẾN ĐÃ ĐÓNG',latestEvents:'SỰ KIỆN GẦN ĐÂY',awaiting:'ĐANG CHỜ DỮ LIỆU',noneCategory:'NẾN ĐÃ ĐÓNG',noneCount:'CHƯA CÓ TÍN HIỆU',noSignal:'Chưa có tín hiệu cấu trúc mới',noSignalDetail:'Nến đã đóng. Không phát sinh Swing hoặc thay đổi cấu trúc mới tại thời điểm này.',closeMeta:'NẾN {time} ĐÃ ĐÓNG',eventCount:'{count} sự kiện',atCandle:'{count} TẠI NẾN NÀY',emptyEvents:'Chưa có sự kiện cấu trúc trước đó. Tiến thêm nến để quan sát diễn biến.',jumpTo:'Chuyển đến {time}',replay:'PHÁT LẠI',chartAria:'Biểu đồ nến và cấu trúc thị trường',feedAria:'Thông báo sự kiện phát lại',timeframeAria:'Thanh thời gian phát lại',mappingTitle:'Xác nhận ánh xạ cột',mappingReason:'Không thể tự nhận diện tên cột một cách chắc chắn.',timestamp:'Thời gian',volumeOptional:'Volume (tùy chọn)',dateOrder:'Thứ tự ngày/tháng',dateAuto:'Tự nhận diện',dateDMY:'DD/MM/YYYY',dateMDY:'MM/DD/YYYY',mappingPreview:'Xem trước ba hàng đầu · đối chiếu cột trước khi áp dụng',cancel:'Hủy',applyMapping:'Áp dụng ánh xạ',noVolume:'(Không có Volume)',chooseColumn:'-- Chọn cột --',unnamedColumn:'(không tên)',dateAndTime:'Ngày + giờ',dragHint:'Thả file dữ liệu để nạp',loadingDataset:'Đang tải dữ liệu',metaCandles:'{count} nến',metaGap:'{count} khoảng lệch nhịp',metaMain:'Chính',metaInternal:'Phụ',metaPending:'chờ xác nhận',metaUp:'TĂNG',metaDown:'GIẢM',metaUnknown:'CHƯA RÕ',imported:'Đã nạp {name} · {count} nến · {volume} Volume.',volumeYes:'có',volumeNo:'không có',gapsWarning:'Đã nạp {count} nến. Có {gaps} khoảng lệch nhịp; không tạo nến giả.',loadFailed:'Không thể mở dữ liệu: {message}',uploadFailed:'Không thể nạp {name}: {message}',serverUnavailable:'Không kết nối được máy chủ: {message}',invalidServer:'Máy chủ trả về dữ liệu không hợp lệ.',requestFailed:'Yêu cầu thất bại.',invalidCandles:'Nguồn dữ liệu không có nến hợp lệ.',invalidOHLC:'OHLC không hợp lệ sau chuẩn hóa.',importRemoved:'Đã xóa bộ dữ liệu đã nạp.',confirmRemove:'Xóa bộ dữ liệu đã chọn? File gốc trên máy không bị ảnh hưởng.',mappingMissing:'Cần chọn đủ Timestamp, Open, High, Low và Close.',mappingHint:'Hãy xác nhận ánh xạ cột để tránh chọn nhầm giá.',fileNotRecognized:'Không thể kiểm tra dữ liệu. Hãy kiểm tra file, ánh xạ cột, timestamp hoặc OHLC.',errorMapping:'Cần xác nhận ánh xạ cột.',errorDate:'Ngày tháng không rõ thứ tự. Chọn DMY hoặc MDY.',errorOHLC:'Dữ liệu OHLC không nhất quán. Kiểm tra dòng nguồn.',errorTimes:'Timestamp bị trùng hoặc không tăng.',errorLarge:'File vượt giới hạn dung lượng hoặc số nến.',errorUnsupported:'Định dạng chưa hỗ trợ.',errorGeneral:'Không thể xử lý dữ liệu. Kiểm tra nguồn và định dạng.',tooltipOpen:'Open',tooltipHigh:'High',tooltipLow:'Low',tooltipClose:'Close',tooltipVolume:'Volume'
 }
};
// Current-state labels live outside the event translator, so a candle without
// an event still reports both structure layers and the exact active pivots.
Object.assign(UI.en,{
 majorLabel:'MAIN / MAJOR',internalLabel:'INTERNAL',currentStatus:'STRUCTURE AT THIS CANDLE CLOSE',
 majorHighLabel:'Major High',majorLowLabel:'Major Low',notConfirmed:'Not confirmed',
 statePending:'Pending new Major pivot',stateConfirmed:'Confirmed',statusAt:'at {time}',
});
Object.assign(UI.vi,{
 majorLabel:'CẤU TRÚC CHÍNH',internalLabel:'CẤU TRÚC PHỤ',currentStatus:'TRẠNG THÁI SAU NẾN ĐÃ ĐÓNG',
 majorHighLabel:'Đỉnh quan trọng',majorLowLabel:'Đáy quan trọng',notConfirmed:'Chưa xác nhận',
 statePending:'Chờ Major mới',stateConfirmed:'Đã xác nhận',statusAt:'lúc {time}',
});
const KIND={
 en:{major_established:'MAIN · ESTABLISHED',major_continuation:'MAIN · CONTINUATION',major_reversal:'MAIN · REVERSAL',major_updated:'MAIN · LEVELS UPDATED',internal_established:'INTERNAL · IDENTIFIED',internal_reversal:'INTERNAL · REVERSAL',internal_confirmed:'INTERNAL · CONFIRMED',start:'REPLAY STARTED',inside:'INSIDE BAR',breakout:'MOTHER RANGE BREAK',swing:'LOCAL SWING',replace:'SWING REPLACEMENT',pair:'OPPOSITE SWING',classification:'STRUCTURE',trend:'TREND CHANGE'},
 vi:{major_established:'CHÍNH · KHỞI TẠO',major_continuation:'CHÍNH · TIẾP DIỄN',major_reversal:'CHÍNH · ĐẢO CHIỀU',major_updated:'CHÍNH · MAJOR CẬP NHẬT',internal_established:'PHỤ · NHẬN DIỆN',internal_reversal:'PHỤ · ĐẢO CHIỀU',internal_confirmed:'PHỤ · XÁC NHẬN',start:'KHỞI TẠO',inside:'INSIDE BAR',breakout:'PHÁ BIÊN',swing:'SWING CỤC BỘ',replace:'DỜI SWING',pair:'XÁC NHẬN CẶP',classification:'CẤU TRÚC',trend:'ĐỔI XU HƯỚNG'}
};
function text(key,lang='en',params={}){
 let tmpl=(UI[lang]||UI.en)[key]??UI.en[key]??key;
 return tmpl.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(_,k)=>String(params[k]??''));
}
function fmt(num){return Number(num).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6});}
function dir(d){return d==='up'?'UP':d==='down'?'DOWN':'UNKNOWN';}
function eventLabel(kind,lang='en'){return (KIND[lang]||KIND.en)[kind]||'EVENT';}
function eventText(e,lang='en'){
 if(lang==='vi')return {title:e.title,detail:e.detail};
 const d=e.data||{}, price=x=>x==null?'pending':fmt(x),up=d.direction==='up',direction=dir(d.direction);
 switch(e.kind){
 case 'start':return {title:'Replay initialized',detail:'The first candle has closed. Three candles are required to identify the first local swing.'};
 case 'inside':return d.phase==='continue'?
  {title:'Inside bar continues',detail:`Original mother range at ${d.motherTime}: ${price(d.low)}–${price(d.high)} remains active.`}:
  {title:'Inside bar detected',detail:`Candle ${d.candleTime} is within the ${d.motherTime} mother range [${price(d.low)}, ${price(d.high)}].`};
 case 'breakout':return {title:`Mother range broken ${d.direction==='up'?'↑':d.direction==='down'?'↓':'↕'}`,detail:`Candle ${d.candleTime} crossed the ${d.direction==='up'?'upper':d.direction==='down'?'lower':'upper and lower'} boundary of the ${d.motherTime} mother candle. Previously rejected swings stay invalid.`};
 case 'swing':return {title:`Local Swing ${d.type==='SH'?'High':'Low'} · ${d.pivotTime}`,detail:`Price ${price(d.price)}; candidate known when the ${d.confirmationTime} candle closed. ${d.status==='inside_rejected'?`REJECTED: the pivot lies inside the ${d.motherTime} mother range.`:d.status==='ambiguous'?'AMBIGUOUS: the same bar qualifies as SH and SL; OHLC does not reveal intrabar order.':'Inside-bar filter passed; waiting for an eligible opposing pivot.'}`};
 case 'replace':return d.action==='ignore'?
  {title:`Skipped competing ${d.type}`,detail:`A stronger ${d.type} already exists at ${d.previousTime}; no eligible opposing swing has appeared.`}:
  {title:`Replaced ${d.type} candidate`,detail:`The ${d.previousTime} pivot was replaced by the ${d.newTime} pivot with a more extreme ${d.type==='SH'?'high':'low'}, before an eligible opposing swing.`};
 case 'pair':return {title:`${d.previousType} confirmed by opposite swing`,detail:`${d.previousType} at ${d.previousTime} was structurally accepted when the opposing ${d.oppositeType} at ${d.oppositeTime} was identified.`};
 case 'classification':return {title:`Classified ${d.classification} · ${d.pivotTime}`,detail:`${d.type} ${price(d.price)} compared against ${price(d.previousPrice)} at ${d.previousTime}.`};
 case 'trend':return {title:d.direction==='up'?'UP structure confirmed':d.direction==='down'?'DOWN structure confirmed':'Structure returned to UNKNOWN',detail:d.direction==='up'?'Latest accepted pivots satisfy HH + HL.':d.direction==='down'?'Latest accepted pivots satisfy LH + LL.':'The latest pivot pairs are not aligned; do not infer a sideways market.'};
 case 'major_established':return {title:`Main ${direction} structure established`,detail:`Major High ${price(d.majorHigh)}; Major Low ${price(d.majorLow)}. Based on accepted alternating swings and HH+HL / LH+LL.`};
 case 'major_continuation':return {title:`Main ${direction} continuation`,detail:`Close ${price(d.close)} crossed ${up?'above Major High':'below Major Low'} ${price(d.brokenLevel)}. Waiting for an eligible new swing before updating the Major pair.`};
 case 'major_reversal':return {title:`Main structure reversed to ${direction}`,detail:`Close ${price(d.close)} crossed ${up?'above Major High':'below Major Low'} ${price(d.brokenLevel)}. Retained Major ${up?'Low':'High'}: ${price(d.retainedLevel)}; new Major ${up?'High':'Low'} is pending.`};
 case 'major_updated':return {title:'Major High / Low updated',detail:`Major High ${price(d.majorHigh)}; Major Low ${price(d.majorLow)}. Levels use the strongest already confirmed eligible swing of the break wave and its confirmed corrective or preceding opposite pivot.`};
 case 'internal_established':return {title:`Internal ${direction} structure identified`,detail:`Accepted internal pivots satisfy ${up?'HH + HL':'LH + LL'} inside the Major range; main trend is unchanged.`};
 case 'internal_reversal':return {title:`Internal reversal to ${direction} · pending`,detail:`Close ${price(d.close)} crossed ${up?'Internal SH':'Internal SL'} ${price(d.brokenLevel)}. Main ${dir(d.majorDirection)} is unchanged; waiting for ${up?'HH + HL':'LH + LL'} confirmation.`};
 case 'internal_confirmed':return {title:`Internal ${direction} structure confirmed`,detail:'An eligible sequence of internal pivots confirms HH + HL or LH + LL in the new direction.'};
 default:return {title:'Structural event',detail:`Event recorded at closed candle ${e.at}. See the event audit for technical details.`};
 }
}
function serverError(error,lang='en'){
 const code=error?.payload?.code;
 const known={NEEDS_MAPPING:'errorMapping',DATE_ORDER_REQUIRED:'errorDate',INVALID_OHLC:'errorOHLC',INVALID_TIMESTAMPS:'errorTimes',TOO_LARGE:'errorLarge',TOO_MANY_ROWS:'errorLarge',UNSUPPORTED:'errorUnsupported'};
 if(lang==='en')return text(known[code]||'errorGeneral','en')+(code?` [${code}]`:'');
 return error?.message||text(known[code]||'errorGeneral','vi');
}
return {UI,KIND,text,eventLabel,eventText,serverError};
});
