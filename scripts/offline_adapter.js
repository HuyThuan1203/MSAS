/*
 * MSAS Standalone — local-only API adapter.
 * Retains the source-locked structure engines; replaces Python storage/ingestion
 * only. No network, eval, third-party analytics or persistent file access.
 * Date-order/mapping ambiguity results in a user-facing mapping dialog.
 */
(function(root){
'use strict';
const MAX_BYTES=12*1024*1024, MAX_ROWS=25000;
const SUPPORTED=new Set(['.csv','.tsv','.txt','.json','.jsonl','.xlsx']);
const aliases={
 timestamp:'timestamp time datetime datetimestamp dateandtime opentime candleopentime starttime unixtime epochtime timeutc timestamputc datetimeutc dateutc t timeopen timeopenutc',
 date:'date day tradedate tradingdate ngay',clock:'clock hourofday timeofday hour gio',
 open:'open o opening openprice priceopen openingprice op giamo giamocua',
 high:'high h max highest highprice pricehigh highestprice hi giacao giacaonhat',
 low:'low l min lowest lowprice pricelow lowestprice lo giathap giathapnhat',
 close:'close c closing last closeprice priceclose closingprice lastprice cl giadong giadongcua',
 volume:'volume vol v volumes tickvol tickvolume tickvolumes realvolume tradevolume tradingvolume qty quantity khoiluong'
};
const aliasLookup=new Map();for(const [kind,names] of Object.entries(aliases))for(const name of names.split(' '))aliasLookup.set(name,kind);
const canonical=s=>String(s??'').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const alias=name=>{const key=canonical(name);if(aliasLookup.has(key))return aliasLookup.get(key);for(const k of ['open','high','low','close','volume'])if(key.startsWith(k)&&['usd','usdt','price','value'].includes(key.slice(k.length)))return k;return null;};
const error=(message,code='INVALID_DATA',props={})=>Object.assign(new Error(message),{code,...props});
function decode(bytes){if(!bytes.length)throw error('Empty file.');if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes.subarray(2));if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be').decode(bytes.subarray(2));let str;try{str=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(_){str=new TextDecoder('windows-1252').decode(bytes);}return str.charCodeAt(0)===65279?str.slice(1):str;}
function chooseDelimiter(text){const lines=text.split(/\r?\n/).filter(Boolean).slice(0,12);const chars=[',',';','\t','|'];let scores=chars.map(ch=>{const parts=lines.map(line=>{let n=0,q=false;for(let i=0;i<line.length;i++){if(line[i]==='"'){if(q&&line[i+1]==='"')i++;else q=!q;}else if(!q&&line[i]===ch)n++;}return n;});const nonzero=parts.filter(n=>n>0);return nonzero.length?nonzero.length*100 + nonzero.reduce((a,b)=>a+b,0) - (Math.max(...nonzero)-Math.min(...nonzero))*10:-Infinity;});const i=scores.indexOf(Math.max(...scores));return chars[i];}
function delimited(text){if(text.includes('\0'))throw error('Binary content is not a supported delimited file.');const delim=chooseDelimiter(text),out=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
 else if(ch===delim&&!quoted){row.push(cell.trim());cell='';}
 else if((ch==='\r'||ch==='\n')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(v=>v!==''))out.push(row);row=[];cell='';}
 else cell+=ch;
 }
 if(quoted)throw error('Unclosed quoted CSV cell.');row.push(cell.trim());if(row.some(v=>v!==''))out.push(row);
 if(!out.length)throw error('No data rows found.');return {rows:out,warnings:['Delimiter: '+(delim==='\t'?'TAB':delim)]};
}
function jsonTable(text,ext){let body;try{body=ext==='.jsonl'?text.split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s)):JSON.parse(text);}catch(e){throw error('Invalid JSON: '+e.message);}
 if(body&&!Array.isArray(body)&&typeof body==='object')for(const k of ['candles','data','rows','result','prices','history'])if(Array.isArray(body[k])){body=body[k];break;}
 if(!Array.isArray(body)||!body.length||!body.every(x=>x&&typeof x==='object'&&!Array.isArray(x)))throw error('JSON must be an array of candle objects, or an object with data/candles/rows[].');
 const fields=[...new Set(body.flatMap(x=>Object.keys(x)))];return {rows:[fields,...body.map(o=>fields.map(k=>o[k]??''))],warnings:['JSON records: '+body.length]};
}
const dataView=(bytes)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
async function unzipXlsx(bytes){
 const dv=dataView(bytes);let eocd=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-66000);i--)if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw error('Invalid XLSX ZIP archive.');const total=dv.getUint16(eocd+10,true),offset=dv.getUint32(eocd+16,true);
 const files=new Map();let ptr=offset;
 for(let i=0;i<total;i++){
  if(ptr+46>bytes.length||dv.getUint32(ptr,true)!==0x02014b50)throw error('Corrupted XLSX directory.');
  const method=dv.getUint16(ptr+10,true),size=dv.getUint32(ptr+20,true),uncompressed=dv.getUint32(ptr+24,true),nameLen=dv.getUint16(ptr+28,true),extraLen=dv.getUint16(ptr+30,true),commentLen=dv.getUint16(ptr+32,true),local=dv.getUint32(ptr+42,true);
  const name=new TextDecoder().decode(bytes.subarray(ptr+46,ptr+46+nameLen));files.set(name,{method,size,uncompressed,local});ptr+=46+nameLen+extraLen+commentLen;
 }
 async function read(name){const f=files.get(name);if(!f)return null;if(f.uncompressed>35*1024*1024)throw error('XLSX sheet/sharedStrings exceeds 35 MB limit.','TOO_LARGE');
  const l=f.local;if(dv.getUint32(l,true)!==0x04034b50)throw error('Invalid ZIP entry.');const start=l+30+dv.getUint16(l+26,true)+dv.getUint16(l+28,true);
  const compressed=bytes.slice(start,start+f.size);if(f.method===0)return new TextDecoder().decode(compressed);
  if(f.method!==8||!('DecompressionStream' in root))throw error('XLSX decompression is not supported by this browser. Try current Chrome/Edge or export CSV.','UNSUPPORTED');
  try{return new TextDecoder().decode(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());}catch(e){throw error('Cannot decompress XLSX: '+e.message);}
 }
 const sheets=[...files.keys()].filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a,b)=>Number(a.match(/sheet(\d+)/)[1])-Number(b.match(/sheet(\d+)/)[1]));
 if(!sheets.length)throw error('XLSX has no supported worksheet.');
 const xml=new DOMParser(),parse=s=>{const d=xml.parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw error('Invalid XLSX XML.');return d;};
 const strings=[];const shared=await read('xl/sharedStrings.xml');if(shared){const d=parse(shared);for(const si of d.getElementsByTagName('si'))strings.push([...si.getElementsByTagName('t')].map(t=>t.textContent).join(''));}
 const doc=parse(await read(sheets[0]));const rows=[];
 for(const r of doc.getElementsByTagName('row')){
  const v=[];for(const c of r.children){if(c.localName!=='c')continue;const m=(c.getAttribute('r')||'').match(/^([A-Z]+)/i);if(!m)continue;let col=0;for(const letter of m[1].toUpperCase())col=col*26+letter.charCodeAt(0)-64;col--;if(col>255)continue;
   let val='';const type=c.getAttribute('t'),value=[...c.children].find(x=>x.localName==='v');
   if(type==='inlineStr')val=[...c.getElementsByTagName('t')].map(t=>t.textContent||'').join('');
   else {val=value?.textContent??'';if(type==='s')val=strings[Number(val)]??val;}
   v[col]=val;
  }
  if(v.some(x=>x!==undefined&&String(x).trim()))rows.push(Array.from({length:v.length},(_,i)=>v[i]??''));
  if(rows.length>MAX_ROWS+25)throw error('XLSX exceeds 25,000 candle limit.','TOO_MANY_ROWS');
 }
 if(!rows.length)throw error('XLSX worksheet is empty.');return {rows,warnings:['XLSX first worksheet: '+sheets[0]+'. Formula cells use cached values only.']};
}
function num(value){if(typeof value==='boolean'||value===null||value===undefined)throw Error('Empty/invalid number');let s=String(value).trim().replace(/[\u00a0 '\u202f]/g,'');if(!s||/^(null|none|n\/a|nan|-)$/i.test(s))throw Error('Empty/NA numeric field');if(s.includes('.')&&s.includes(',')){s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');}else if(s.includes(','))s=s.replace(',','.');const n=Number(s);if(!Number.isFinite(n))throw Error('Non-finite number '+String(value));return n;}
const pad=(n,l=2)=>String(n).padStart(l,'0');
function parseTimestamp(raw,dateOrder='auto'){
 const s=String(raw??'').trim();if(!s)throw Error('Empty timestamp');let shown,epoch,zone=null;
 if(/^\d{13}$/.test(s)||/^\d{10}(?:\.\d+)?$/.test(s)){epoch=Number(s)*(s.length===13?1:1000);const d=new Date(epoch);if(!Number.isFinite(d.getTime()))throw Error('Invalid UNIX timestamp');shown=d.toISOString().replace('T',' ').replace('Z','+00:00');zone='UTC+00:00';}
 else if(/^\d{14}$/.test(s)){shown=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+' '+s.slice(8,10)+':'+s.slice(10,12)+':'+s.slice(12,14);}
 else if(/^\d{8}$/.test(s)){shown=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6)+' 00:00:00';}
 else if(/^\d{5}(?:\.\d+)?$/.test(s)&&Number(s)>20000&&Number(s)<100000){shown=new Date(Date.UTC(1899,11,30)+Number(s)*86400000).toISOString().replace('T',' ').replace('Z','');}
 else {let m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(.*)$/);if(m){const a=Number(m[1]),b=Number(m[2]),y=m[3];let dayfirst;
   if(a>12&&b<=12)dayfirst=true;else if(b>12&&a<=12)dayfirst=false;else if(dateOrder==='DMY')dayfirst=true;else if(dateOrder==='MDY')dayfirst=false;else throw error('Ambiguous day/month. Choose DMY or MDY.','DATE_ORDER_REQUIRED');
   shown=y+'-'+pad(dayfirst?b:a)+'-'+pad(dayfirst?a:b)+(m[4]||'');
  }else shown=s.replace(/^(\d{4})[./](\d\d?)[./](\d\d?)/,(_,y,mo,da)=>`${y}-${pad(mo)}-${pad(da)}`);
  shown=shown.replace(/ UTC$/i,'+00:00').replace(/Z$/,'+00:00').replace('T',' ');
 }
 // JS Date.parse() treats naive ISO strings as local time; here they must
 // remain timezone-unassigned. Use UTC only as a neutral ordering coordinate.
 const m=shown.match(/^(\d{4})-(\d\d?)-(\d\d?)(?:[ T](\d\d?):(\d\d)(?::(\d\d)(?:\.(\d+))?)?)?([+-]\d\d:\d\d)?$/);
 if(!m)throw Error('Unsupported timestamp '+s.slice(0,50));
 const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]),h=Number(m[4]||0),minute=Number(m[5]||0),second=Number(m[6]||0),ms=Number(('0.'+(m[7]||'0')))*1000;
 if(y<1970||y>2200||month<1||month>12||day<1||day>31||h>23||minute>59||second>59)throw Error('Timestamp outside valid ranges');
 const utc=Date.UTC(y,month-1,day,h,minute,second,ms);const check=new Date(utc);if(check.getUTCFullYear()!==y||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw Error('Invalid calendar date');
 let absolute=utc;const tail=m[8];if(tail){const sign=tail[0]==='+'?1:-1;const offH=Number(tail.slice(1,3)),offM=Number(tail.slice(4));if(offH>23||offM>59)throw Error('Invalid time offset');absolute-=(sign*(offH*60+offM))*60000;zone='UTC'+tail;}
 return {absolute,shown:shown.replace(/^(\d{4}-\d{2}-\d{2})$/, '$1 00:00:00'),zone};
}
function chooseColumns(rows,mapping){let header=-1,start=-1;const warnings=[];
 for(let i=0;i<Math.min(rows.length,24);i++){const row=rows[i];if(row.length<5)continue;const known=new Set(row.map(alias).filter(Boolean));if(['open','high','low','close'].filter(v=>known.has(v)).length>=2||(known.has('timestamp')||known.has('date'))&&known.size>=3){header=i;break;}
  try{parseTimestamp(row[0]);if(row.slice(1,6).filter(x=>{try{num(x);return true;}catch(e){return false;}}).length>=4){start=i;break;}}catch(e){if(/^\d{1,2}[./-]\d{1,2}[./-]\d{4}/.test(String(row[0]))&&row.slice(1,6).filter(x=>{try{num(x);return true}catch(e){return false}}).length>=4){start=i;break;}}
  if(row.length>=6 && /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(String(row[0])) && /^\d{1,2}:\d{2}/.test(String(row[1]))) {start=i;break;}
 }
 let cols,data,hasHeader;
 if(header>=0){cols=rows[header].map(String);data=rows.slice(header+1);hasHeader=true;if(header)warnings.push('Skipped '+header+' metadata rows.');}
 else if(start>=0){cols=Array.from({length:Math.max(...rows.slice(start,start+5).map(r=>r.length))},(_,i)=>'Column '+(i+1));data=rows.slice(start);hasHeader=false;if(start)warnings.push('Skipped '+start+' metadata rows.');}
 else {const i=rows.slice(0,24).findIndex(row=>row.length>=5);if(i<0)throw error('No OHLC table (need at least 5 columns).');cols=rows[i].map(String);data=rows.slice(i+1);hasHeader=true;warnings.push('Unrecognized headers: confirm mapping.');}
 if(!data.length)throw error('No candle rows below header.');
 let detected={};if(hasHeader)cols.forEach((name,i)=>{const field=alias(name);if(field&&detected[field]===undefined)detected[field]=i;});
 if(detected.date!==undefined&&detected.clock!==undefined)detected.timestamp=detected.date+'+'+detected.clock;
 else if(detected.date!==undefined&&detected.timestamp!==undefined){const sample=data[0]?.[detected.timestamp];if(/^\d{1,2}:\d\d/.test(String(sample)))detected.timestamp=detected.date+'+'+detected.timestamp;}
 else if(detected.timestamp===undefined&&detected.date!==undefined)detected.timestamp=detected.date;
 const required=['timestamp','open','high','low','close'];
 const missing=required.filter(x=>detected[x]===undefined);
 if(missing.length>=4&&!mapping){const n=cols.length,first=data[0];const split=(n===6||n===7)&&/^\d{4}[./-]\d\d[./-]\d\d$/.test(String(first[0]))&&/^\d{1,2}:\d{2}/.test(String(first[1]));const base=split?2:1;
  if((split&&[6,7].includes(n))||(!split&&[5,6].includes(n))){detected={timestamp:split?'0+1':0,open:base,high:base+1,low:base+2,close:base+3};if(n>base+4)detected.volume=base+4;warnings.push('Positional mapping (Time-O-H-L-C); verify provider order.');}
 }
 if(mapping){const newMap={};for(const k of ['timestamp','open','high','low','close','volume'])if(mapping[k]!==undefined&&mapping[k]!==null&&mapping[k]!=='')newMap[k]=String(mapping[k]);if(required.every(k=>newMap[k]!==undefined)){detected=newMap;warnings.push('User-confirmed mapping.');}}
 const preview=data.slice(0,3).map(row=>row.map(String));const props={columns:cols,preview,suggested:detected};
 if(required.some(k=>detected[k]===undefined))throw error('Column mapping required.','NEEDS_MAPPING',props);
 const ids=[];for(const key of [...required,'volume'])if(detected[key]!==undefined){for(const id of String(detected[key]).split('+')){if(!/^\d+$/.test(id)||Number(id)>=cols.length)throw error('Invalid mapping index.','NEEDS_MAPPING',props);ids.push(Number(id));}}
 if(new Set(ids).size!==ids.length)throw error('OHLC fields cannot share a column.','NEEDS_MAPPING',props);
 return {cols,data,detected,hasHeader,warnings};
}
function normalize(rows,filename,mapping,dateOrder,warnings=[]){
 const {cols,data,detected,hasHeader,warnings:mapWarnings}=chooseColumns(rows,mapping);warnings=[...warnings,...mapWarnings];if(data.length>MAX_ROWS)throw error('Dataset contains more than 25,000 candles.','TOO_MANY_ROWS');
 const candles=[],times=[];
 for(let i=0;i<data.length;i++){
  const row=data[i];if(!row.some(v=>String(v??'').trim()))continue;
  const field=(key)=>row[Number(detected[key])];
  let ts,parsed;try{ts=String(detected.timestamp).split('+').map(k=>String(row[Number(k)]??'')).join(' ').trim();parsed=parseTimestamp(ts,dateOrder);}catch(e){if(e.code==='DATE_ORDER_REQUIRED')throw error('Ambiguous day/month at row '+(i+1)+'. Choose DMY or MDY.','DATE_ORDER_REQUIRED',{columns:cols,preview:data.slice(0,3),suggested:detected});throw error('Invalid timestamp at row '+(i+1)+': '+e.message);}
  const price={};for(const k of ['open','high','low','close','volume']){if(detected[k]===undefined){price[k]=null;continue;}const value=field(k);if(k==='volume'&&(value===null||value===undefined||String(value).trim()===''||/^null$/i.test(String(value)))){price.volume=null;continue;}try{price[k]=num(value);}catch(e){throw error('Invalid '+k.toUpperCase()+' at row '+(i+1)+': '+e.message);}}
  if(price.low>Math.min(price.open,price.close)||Math.max(price.open,price.close)>price.high)throw error('Invalid OHLC at row '+(i+1)+' (require Low <= Open/Close <= High).','INVALID_OHLC');
  if(price.volume!==null&&price.volume<0)throw error('Negative volume at row '+(i+1));
  candles.push({time:parsed.shown,source_time:ts,open:price.open,high:price.high,low:price.low,close:price.close,volume:price.volume,index:candles.length});times.push(parsed);
 }
 if(!candles.length)throw error('No valid candles.');
 if(candles.length<3)warnings.push('Fewer than three candles: swings cannot yet be confirmed.');
 let zone=times[0].zone;for(const tm of times)if((tm.zone===null)!==(zone===null))throw error('Mixed timezone-aware and naive timestamps; normalize your source.');
 let deltas=times.slice(1).map((x,i)=>x.absolute-times[i].absolute);if(deltas.length&&deltas.every(x=>x<0)){candles.reverse();times.reverse();candles.forEach((c,i)=>c.index=i);warnings.push('Source was reverse chronological; rows reversed.');deltas=deltas.reverse().map(x=>-x);}
 if(deltas.some(x=>x<=0))throw error('Duplicate/out-of-order timestamps; rows were not silently sorted.','INVALID_TIMESTAMPS');
 const counts=new Map();for(const d of deltas){counts.set(d,(counts.get(d)||0)+1);}const period=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||0;
 const gaps=deltas.filter(d=>period&&d!==period).length;if(gaps)warnings.push(gaps+' irregular time gaps; no synthetic candles added.');if(detected.volume===undefined)warnings.push('Volume absent: structure engine uses OHLC only.');if(candles.length>3000)warnings.push('Long dataset: replay analysis may be slow.');
 const frame=period&&period%86400000===0?'D'+(period/86400000):period&&period%3600000===0?'H'+period/3600000:period&&period%60000===0?'M'+period/60000:'OHLC';
 return {candles,meta:{source:filename,rows:candles.length,volume_present:candles.some(c=>c.volume!==null),columns:cols,mapping:detected,mapping_mode:mapping?'manual':warnings.some(x=>x.includes('Positional'))?'position':'header',timeframe:frame,timezone:zone,interval_seconds:period/1000,gaps,first_time:candles[0].time,last_time:candles[candles.length-1].time},warnings};
}
const originals=new Map(); // Raw files are never uploaded: storage stays inside this page session.
const builtin=(root.MSAS_BUNDLED_DATASETS||[]).map(item=>{const payload=item.payload;payload.dataset={id:item.id,name:item.name,filename:item.filename,builtin:true};originals.set(item.id,payload);return payload.dataset;});
let counter=0;
async function loadFile(file,mapping,dateOrder){if(!file)throw error('Select a file first.');if(file.size>MAX_BYTES)throw error('File exceeds 12 MB.','TOO_LARGE');const ext=(file.name.match(/\.[^.]+$/)||[''])[0].toLowerCase();if(!SUPPORTED.has(ext))throw error('Only CSV, TSV, TXT, JSON, JSONL or XLSX are supported.','UNSUPPORTED');
 const bytes=new Uint8Array(await file.arrayBuffer());let tab;if(ext==='.xlsx')tab=await unzipXlsx(bytes);else if(ext==='.json'||ext==='.jsonl')tab=jsonTable(decode(bytes),ext);else tab=delimited(decode(bytes));return normalize(tab.rows,file.name,mapping,dateOrder,tab.warnings);
}
const api={
 async fetch(path,options={}){
  try{
   const url=new URL(path,'https://msas.invalid'),p=url.pathname,method=(options.method||'GET').toUpperCase();let result,status=200;
   if(method==='GET'&&p==='/api/datasets'){result={datasets:[...builtin,...[...originals.entries()].filter(([id])=>!builtin.some(b=>b.id===id)).map(([id,data])=>data.dataset)]};}
   else if(method==='GET'&&p.startsWith('/api/datasets/')){result=originals.get(decodeURIComponent(p.split('/').at(-1)));if(!result)throw error('Dataset not found.','NOT_FOUND');}
   else if(method==='DELETE'&&p.startsWith('/api/datasets/')){const id=decodeURIComponent(p.split('/').at(-1));if(builtin.some(d=>d.id===id))throw error('Built-in sample cannot be deleted.');if(!originals.delete(id))throw error('Dataset not found.','NOT_FOUND');result={deleted:id};}
   else if(method==='POST'&&p==='/api/import'){const file=options.body,mapping=url.searchParams.has('mapping')?JSON.parse(url.searchParams.get('mapping')):null,dateOrder=url.searchParams.get('date_order')||'auto';result=await loadFile(file,mapping,dateOrder);const id='local-'+Date.now().toString(36)+'-'+(++counter).toString(36);result.dataset={id,name:(url.searchParams.get('label')||file.name.replace(/\.[^.]+$/,'')).slice(0,90),filename:file.name,builtin:false};originals.set(id,result);status=201;}
   else throw error('Unsupported local endpoint.','NOT_FOUND');
   return {ok:true,status,json:async()=>result};
  }catch(e){const status=e.code==='NOT_FOUND'?404:e.code==='TOO_LARGE'?413:422;return {ok:false,status,json:async()=>({error:e.message||String(e),code:e.code||'INVALID_DATA',columns:e.columns,preview:e.preview,suggested:e.suggested})};}
 },
 get datasetCount(){return originals.size},
 info(){return {offline:true,persistent:false,version:'5.2.0-standalone'};}
};
root.MSASOfflineAPI=api;
})(window);
