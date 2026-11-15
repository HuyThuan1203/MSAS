"""Deterministic, inspectable adapter for heterogeneous CLOSED OHLC input.

Provider-column detection is separate from the unchanged market-structure engine.
It never fabricates volume, timezone, missing candles, or intrabar paths.
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import unicodedata
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZipFile, BadZipFile

MAX_ROWS = 25000
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
SUPPORTED = {'.csv', '.tsv', '.txt', '.json', '.jsonl', '.xlsx'}

ALIASES = {
    'timestamp': {'timestamp','time','datetime','datetimestamp','dateandtime','opentime','candleopentime','starttime','unixtime','epochtime','timeutc','timestamputc','datetimeutc','dateutc','t','timeopen','timeopenutc'},
    'date': {'date','day','tradedate','tradingdate','ngay'},
    'clock': {'clock','hourofday','timeofday','hour','gio'},
    'open': {'open','o','opening','openprice','priceopen','openingprice','op','giamo','giamocua'},
    'high': {'high','h','max','highest','highprice','pricehigh','highestprice','hi','giacao','giacaonhat'},
    'low': {'low','l','min','lowest','lowprice','pricelow','lowestprice','lo','giathap','giathapnhat'},
    'close': {'close','c','closing','last','closeprice','priceclose','closingprice','lastprice','cl','giadong','giadongcua'},
    'volume': {'volume','vol','v','volumes','tickvol','tickvolume','tickvolumes','realvolume','tradevolume','tradingvolume','qty','quantity','khoiluong'},
}

class DataError(ValueError):
    def __init__(self, message: str, code: str = 'INVALID_DATA', **details: Any):
        super().__init__(message)
        self.code = code
        self.details = details

    def as_payload(self) -> dict:
        return {'error': str(self), 'code': self.code, **self.details}


def canonical(value: Any) -> str:
    x = unicodedata.normalize('NFKD', str(value)).lower()
    x = ''.join(ch for ch in x if not unicodedata.combining(ch))
    return re.sub(r'[^a-z0-9]', '', x)


def alias_for(name: str) -> str | None:
    key = canonical(name)
    for kind, names in ALIASES.items():
        if key in names:
            return kind
    # common variants with units appended, e.g. OPEN_BTCUSD or Close USD
    for kind in ('open', 'high', 'low', 'close', 'volume'):
        if key.startswith(kind) and (key[len(kind):] in ('usd', 'usdt', 'price', 'value')):
            return kind
    return None


def decode(raw: bytes) -> tuple[str, str]:
    if not raw:
        raise DataError('Tệp rỗng.')
    for codec in ('utf-8-sig', 'utf-16', 'cp1252'):
        try:
            return raw.decode(codec), codec
        except UnicodeError:
            pass
    raise DataError('Không đọc được mã hóa văn bản (UTF-8/UTF-16/Windows-1252).')


def parse_delimited(raw: bytes) -> tuple[list[list[Any]], list[str]]:
    text, encoding = decode(raw)
    text = text.lstrip('\ufeff')
    if '\x00' in text:
        raise DataError('Tệp chứa ký tự nhị phân, không phải CSV/TSV hợp lệ.')
    sample = '\n'.join([x for x in text.splitlines() if x.strip()][:12])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
        delim = dialect.delimiter
    except csv.Error:
        counts = {d: sum(x.count(d) for x in sample.splitlines()) for d in (',',';','\t','|')}
        delim = max(counts, key=counts.get)
    rows = [list(row) for row in csv.reader(io.StringIO(text, newline=''), delimiter=delim, skipinitialspace=True)]
    rows = [[str(v).strip() for v in row] for row in rows if any(str(v).strip() for v in row)]
    if not rows:
        raise DataError('Tệp không chứa hàng dữ liệu.')
    warnings = [f'Mã hóa {encoding}; phân cách {repr(delim)}.']
    return rows, warnings


def parse_json_table(raw: bytes, ext: str) -> tuple[list[list[Any]], list[str]]:
    text, encoding = decode(raw)
    try:
        if ext == '.jsonl':
            body = [json.loads(s) for s in text.splitlines() if s.strip()]
        else:
            body = json.loads(text)
    except ValueError as exc:
        raise DataError(f'JSON không hợp lệ: {exc}') from exc
    if isinstance(body, dict):
        for key in ('candles', 'data', 'rows', 'result', 'prices', 'history'):
            if isinstance(body.get(key), list):
                body = body[key]
                break
    if not isinstance(body, list) or not body:
        raise DataError('JSON phải là mảng bản ghi OHLC, hoặc object chứa data/candles/rows[].')
    if not all(isinstance(item, dict) for item in body):
        raise DataError('Mỗi mục trong JSON phải là object chứa dữ liệu nến.')
    fields = list(dict.fromkeys(k for row in body for k in row.keys()))
    rows = [fields] + [[row.get(k, '') for k in fields] for row in body]
    return rows, [f'JSON ({encoding}), {len(body)} bản ghi.']


def excel_table(raw: bytes) -> tuple[list[list[Any]], list[str]]:
    """Read common XLSX sheet cells without a dependency or executing formulas/macros."""
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    try:
        with ZipFile(io.BytesIO(raw)) as z:
            names = set(z.namelist())
            sheets = sorted((k for k in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', k)), key=lambda x: int(re.search(r'sheet(\d+)', x).group(1)))
            if not sheets:
                raise DataError('XLSX không chứa worksheet được hỗ trợ.')
            for key in [sheets[0], 'xl/sharedStrings.xml']:
                if key in names and z.getinfo(key).file_size > 35 * 1024 * 1024:
                    raise DataError('Worksheet hoặc sharedStrings quá lớn (giới hạn 35 MB).')
            shared = []
            if 'xl/sharedStrings.xml' in names:
                root = ET.fromstring(z.read('xl/sharedStrings.xml'))
                for si in root.findall(ns+'si'):
                    shared.append(''.join(t.text or '' for t in si.iter(ns+'t')))
            root = ET.fromstring(z.read(sheets[0]))
            rows = []
            for r in root.iter(ns+'row'):
                values: dict[int, Any] = {}
                for c in r.findall(ns+'c'):
                    cell_ref = c.attrib.get('r','')
                    m = re.match(r'([A-Z]+)', cell_ref)
                    if not m:
                        continue
                    col = 0
                    for ch in m.group(1):
                        col = col*26+(ord(ch)-64)
                    col -= 1
                    if col > 255:
                        continue
                    typ = c.attrib.get('t', '')
                    if typ == 'inlineStr':
                        val = ''.join(t.text or '' for t in c.iter(ns+'t'))
                    else:
                        node = c.find(ns+'v')
                        val = (node.text or '') if node is not None else ''
                        if typ == 's' and str(val).isdigit():
                            ix = int(val)
                            val = shared[ix] if ix < len(shared) else val
                    values[col] = val
                if values:
                    rows.append([values.get(i,'') for i in range(max(values)+1)])
                if len(rows) > MAX_ROWS + 25:
                    raise DataError(f'Vượt giới hạn {MAX_ROWS:,} nến trong demo.')
            return rows, [f'XLSX: đọc worksheet {Path(sheets[0]).name}; không chạy công thức.']
    except BadZipFile as exc:
        raise DataError('XLSX không hợp lệ (không phải ZIP spreadsheet).') from exc
    except ET.ParseError as exc:
        raise DataError('XLSX có XML không hợp lệ.') from exc


def is_timestamp(value: Any) -> bool:
    try:
        parse_timestamp(value)
        return True
    except ValueError:
        return False


def parse_timestamp(value: Any, date_order: str = 'auto') -> datetime:
    s = str(value).strip()
    if not s:
        raise ValueError('Timestamp trống')
    if re.fullmatch(r'\d{14}',s):
        return datetime.strptime(s,'%Y%m%d%H%M%S')
    if re.fullmatch(r'\d{8}',s):
        return datetime.strptime(s,'%Y%m%d')
    if re.fullmatch(r'\d{10}(?:\.\d+)?', s) or re.fullmatch(r'\d{13}', s):
        epoch = float(s)/(1000 if len(s.split('.')[0]) == 13 else 1)
        try:
            return datetime.fromtimestamp(epoch, timezone.utc)
        except (OverflowError,OSError) as exc:
            raise ValueError('Timestamp epoch nằm ngoài phạm vi') from exc
    if re.fullmatch(r'\d{5}(?:\.\d+)?', s) and 20000 < float(s) < 100000:
        return datetime(1899,12,30)+timedelta(days=float(s))
    val = s.strip('"').replace(' UTC', '+00:00')
    if val.endswith('Z'):
        val = val[:-1]+'+00:00'
    val = re.sub(r'^(\d{4})[./](\d\d?)[./](\d\d?)', lambda m:f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}', val)
    # ISO timestamps may carry explicit timezone. Do not convert their displayed timezone.
    try:
        result = datetime.fromisoformat(val)
        if not (1970 <= result.year <= 2200):
            raise ValueError('Năm ngoài giới hạn 1970–2200')
        return result
    except ValueError:
        pass
    m = re.match(r'^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(.*)$', val)
    if m:
        a,b,y,ending = int(m[1]),int(m[2]),int(m[3]),m[4]
        if a > 12 and b <= 12:
            dayfirst = True
        elif b > 12 and a <= 12:
            dayfirst = False
        elif date_order == 'DMY':
            dayfirst = True
        elif date_order == 'MDY':
            dayfirst = False
        else:
            raise ValueError('Ngày/tháng mơ hồ: chọn DMY hoặc MDY')
        result = datetime.fromisoformat(f'{y:04d}-{(b if dayfirst else a):02d}-{(a if dayfirst else b):02d}'+ending)
        return result
    raise ValueError(f'Timestamp không nhận diện được: {s[:70]}')


def parse_number(value: Any) -> float:
    if isinstance(value, bool):
        raise ValueError('Không phải số')
    if isinstance(value, (float,int)):
        result=float(value)
    else:
        s=str(value).strip().replace('\u00a0','').replace(' ','').replace("'",'')
        if not s or s.lower() in {'null','none','n/a','nan','-'}:
            raise ValueError('Giá trị trống / NA')
        if ',' in s and '.' in s:
            if s.rfind(',')>s.rfind('.'):
                s=s.replace('.','').replace(',','.')
            else:
                s=s.replace(',','')
        elif ',' in s:
            s=s.replace(',','.')
        result=float(s)
    if not math.isfinite(result):
        raise ValueError('Giá trị không hữu hạn')
    return result


def choose_columns(rows: list[list[Any]], forced: dict | None) -> tuple[list[str], list[list[Any]], dict, bool, list[str]]:
    # Locate the header or first data row after metadata/comment preamble.
    header_at = None
    first_data = None
    warnings = []
    for i, row in enumerate(rows[:24]):
        if len(row)<5: continue
        known={alias_for(str(cell)) for cell in row if alias_for(str(cell))}
        if len(known.intersection({'open','high','low','close'})) >= 2 or (('timestamp' in known or 'date' in known) and len(known)>=3):
            header_at = i
            break
        if is_timestamp(row[0]) and sum(1 for c in row[1:6] if _try_number(c)) >= 4:
            first_data=i
            break
        if len(row)>=6 and re.fullmatch(r'\d{4}[./-]\d{2}[./-]\d{2}',str(row[0]).strip()) and re.fullmatch(r'\d{1,2}:\d{2}(:\d{2})?',str(row[1]).strip()) and sum(_try_number(c) for c in row[2:6]) >=4:
            first_data=i
            break
    if header_at is not None:
        cols = [str(c).strip() for c in rows[header_at]]
        data = rows[header_at+1:]
        if header_at: warnings.append(f'Bỏ qua {header_at} dòng metadata phía trên tên cột.')
        has_header = True
    elif first_data is not None:
        cols = [f'Cột {i+1}' for i in range(max(len(row) for row in rows[first_data:first_data+5]))]
        data = rows[first_data:]
        if first_data: warnings.append(f'Bỏ qua {first_data} dòng metadata phía trên dữ liệu.')
        has_header = False
    else:
        ix=next((i for i,row in enumerate(rows[:24]) if len(row)>=5),None)
        if ix is None:
            raise DataError('Không tìm thấy bảng có tối thiểu 5 cột OHLC.')
        cols=[str(c).strip() for c in rows[ix]]
        data=rows[ix+1:]
        has_header=True
        warnings.append('Tên cột không theo quy ước phổ biến; cần kiểm tra ánh xạ.')
    if not data:
        raise DataError('Không có dòng nến bên dưới phần tên cột.')
    detected: dict[str,int|str] = {}
    for i,col in enumerate(cols):
        key=alias_for(col) if has_header else None
        if key and key not in detected:
            detected[key]=i
    if 'date' in detected and 'clock' in detected:
        detected['timestamp']=f"{detected['date']}+{detected['clock']}"
    elif 'date' in detected and 'timestamp' in detected:
        # Provider exports often use DATE and TIME as separate columns.
        sample = data[0]
        time_cell=str(sample[detected['timestamp']]).strip() if len(sample)>detected['timestamp'] else ''
        if re.fullmatch(r'\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?',time_cell):
            detected['timestamp']=f"{detected['date']}+{detected['timestamp']}"
    elif 'timestamp' not in detected and 'date' in detected:
        detected['timestamp']=detected['date']
    # Positional FALLBACK only for standard 5/6 columns, or explicit 2-column date+clock pattern.
    missing = set(('timestamp','open','high','low','close'))-set(detected)
    if missing and not forced:
        n=len(cols)
        example=data[0]
        split = n in (6,7) and len(example)>5 and re.fullmatch(r'\d{4}[./-]\d\d[./-]\d\d',str(example[0]).strip()) and re.fullmatch(r'\d{1,2}:\d\d(?::\d\d)?',str(example[1]).strip())
        if len(missing)>=4 and n in (5,6,7):
            base=2 if split else 1
            if n in ((6,7) if split else (5,6)):
                detected={'timestamp':('0+1' if split else 0),'open':base,'high':base+1,'low':base+2,'close':base+3}
                if n>base+4: detected['volume']=base+4
                warnings.append('Ánh xạ theo VỊ TRÍ cột (giả định thứ tự chuẩn Time–O–H–L–C), vì tên cột không đủ rõ.')
                missing.clear()
    if forced:
        try:
            normalized={key:(str(v) if isinstance(v,str) and '+' in v else int(v)) for key,v in forced.items() if key in ('timestamp','open','high','low','close','volume') and v not in (None,'')}
            if all(k in normalized for k in ('timestamp','open','high','low','close')):
                detected=normalized
                missing.clear()
                warnings.append('Đã dùng ánh xạ cột do người dùng xác nhận.')
        except (TypeError,ValueError):
            pass
    if missing:
        raise DataError('Không đủ thông tin xác định cột: '+', '.join(sorted(missing))+'. Hãy chọn ánh xạ thủ công.',code='NEEDS_MAPPING',columns=cols,preview=[list(map(str,r)) for r in data[:3]],suggested=detected)
    used=[]
    for field in ('timestamp','open','high','low','close','volume'):
        if field not in detected:continue
        ids=str(detected[field]).split('+')
        for x in ids:
            if not x.isdigit() or int(x)>=len(cols):
                raise DataError('Ánh xạ '+field+' vượt phạm vi cột.',code='NEEDS_MAPPING',columns=cols,preview=[list(map(str,r)) for r in data[:3]],suggested=detected)
            used.append(int(x))
    if len(used)!=len(set(used)):
        raise DataError('Một cột đang được dùng cho nhiều trường OHLC.',code='NEEDS_MAPPING',columns=cols,preview=[list(map(str,r)) for r in data[:3]],suggested=detected)
    return cols,data,detected,has_header,warnings


def _try_number(x: Any) -> bool:
    try:
        parse_number(x)
        return True
    except (ValueError, TypeError):
        return False


def normalize(raw: bytes, filename: str, mapping: dict | None = None, date_order: str = 'auto') -> dict:
    if len(raw)>MAX_UPLOAD_BYTES:
        raise DataError('File vượt quá 12 MB. Hãy chia bộ dữ liệu thành các phần nhỏ hơn.',code='TOO_LARGE')
    ext=Path(filename).suffix.lower()
    if ext not in SUPPORTED:
        raise DataError('Định dạng chưa hỗ trợ. Dùng CSV, TSV, TXT, JSON/JSONL hoặc XLSX.')
    if ext=='.xlsx':
        rows, notices=excel_table(raw)
    elif ext in ('.json','.jsonl'):
        rows,notices=parse_json_table(raw,ext)
    else:
        rows,notices=parse_delimited(raw)
    cols,data,found,has_header,warnings=choose_columns(rows,mapping)
    notices.extend(warnings)
    if len(data)>MAX_ROWS:
        raise DataError(f'Tệp có {len(data):,} dòng, vượt giới hạn {MAX_ROWS:,} nến hiện tại.',code='TOO_MANY_ROWS')
    candles=[]
    timestamps=[]
    for ix,row in enumerate(data):
        line=ix+ (2 if has_header else 1)
        if not any(str(v).strip() for v in row): continue
        try:
            spec=str(found['timestamp']).split('+')
            tsraw=' '.join(str(row[int(k)]) for k in spec)
            moment=parse_timestamp(tsraw,date_order)
        except (IndexError,ValueError) as exc:
            if 'mơ hồ' in str(exc):
                raise DataError('Thời gian không rõ thứ tự ngày/tháng tại dòng '+str(line)+'. Chọn DMY hoặc MDY.',code='DATE_ORDER_REQUIRED',columns=cols,preview=[list(map(str,r)) for r in data[:3]],suggested=found) from exc
            raise DataError(f'Timestamp không hợp lệ tại dòng dữ liệu {line}: {exc}') from exc
        values={}
        for field in ('open','high','low','close','volume'):
            if field not in found:
                values[field]=None
                continue
            try:
                cell=row[int(found[field])]
                if field=='volume' and (cell is None or str(cell).strip() in ('','null','None')):
                    values[field]=None
                else:
                    values[field]=parse_number(cell)
            except (ValueError,IndexError,TypeError) as exc:
                raise DataError(f'Giá trị {field.upper()} không hợp lệ tại dòng dữ liệu {line}: {exc}') from exc
        o,h,l,c=(values[k] for k in ('open','high','low','close'))
        if l > min(o,c) or max(o,c)>h:
            raise DataError(f'OHLC không nhất quán tại dòng dữ liệu {line}: Low ≤ Open/Close ≤ High không đúng.',code='INVALID_OHLC')
        if values['volume'] is not None and values['volume']<0:
            raise DataError(f'Volume âm tại dòng dữ liệu {line}.')
        candles.append({'time':moment.isoformat(sep=' '),'source_time':tsraw.strip(),'open':o,'high':h,'low':l,'close':c,'volume':values['volume'],'index':len(candles)})
        timestamps.append(moment)
    if not candles:
        raise DataError('Không có nến hợp lệ.')
    if len(candles)<3:
        notices.append('Chưa đủ 3 nến để nhận diện Swing High/Low.')
    # Compare absolute instants when timezone is provided. Never silently assign a timezone.
    try:
        delta=[(timestamps[i]-timestamps[i-1]).total_seconds() for i in range(1,len(timestamps))]
    except TypeError as exc:
        raise DataError('Timestamp đang trộn giá trị có và không có múi giờ. Cần chuẩn hóa nguồn dữ liệu.') from exc
    if delta and all(x < 0 for x in delta):
        candles.reverse();timestamps.reverse()
        for i,c in enumerate(candles): c['index']=i
        notices.append('Nguồn sắp xếp thời gian giảm dần; đã ĐẢO toàn bộ thứ tự nến để replay tiến lên.')
        delta=[-d for d in delta[::-1]]
    if any(d<=0 for d in delta):
        raise DataError('Timestamp trùng hoặc thứ tự thời gian không tăng. Không tự ý sắp xếp lại các dòng lộn xộn.',code='INVALID_TIMESTAMPS')
    positive=delta
    period=Counter(round(x) for x in positive).most_common(1)[0][0] if positive else 0
    gaps=sum(1 for d in positive if round(d)!=period) if period else 0
    if gaps: notices.append(f'Có {gaps} khoảng thời gian lệch nhịp chuẩn; giữ nguyên dữ liệu, không tạo nến giả.')
    if 'volume' not in found: notices.append('Không có Volume: bỏ qua; nhận diện chỉ dùng OHLC.')
    if len(candles)>3000: notices.append('Dữ liệu dài; replay theo tiền tố có thể chậm ở những mốc cuối.')
    tz = timestamps[0].strftime('%z') if timestamps[0].tzinfo is not None else ''
    timezone_label = 'UTC'+tz[:3]+':'+tz[3:] if tz else None
    if period and period%86400==0: frame=f'D{period//86400}'
    elif period and period%3600==0: frame=f'H{period//3600}'
    elif period and period%60==0: frame=f'M{period//60}'
    else: frame='OHLC'
    return {
        'candles':candles,
        'meta':{'source':filename,'rows':len(candles),'volume_present':any(c['volume'] is not None for c in candles),
                'columns':cols,'mapping':found,'mapping_mode':('manual' if mapping else ('position' if any('VỊ TRÍ' in m for m in notices) else 'header')),
                'timeframe':frame,'timezone':timezone_label,'interval_seconds':period,'gaps':gaps,'first_time':candles[0]['time'],'last_time':candles[-1]['time']},
        'warnings':notices,
    }
