"""Local-first Docker web server for replaying multiple OHLC datasets.

Standard-library only. No third-party account, exchange or external API required.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from importer import DataError, MAX_UPLOAD_BYTES, SUPPORTED, normalize

BASE = Path(__file__).resolve().parent.parent
STATIC = BASE / 'static'
SAMPLES = BASE / 'samples'
DATA = Path(os.environ.get('DATA_DIR', str(BASE/'data'))).resolve()
DATA.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get('PORT','8080'))
HOST = os.environ.get('HOST','127.0.0.1')

BUILTIN = {
    'btcusd-sample': ('BTCUSD · M15 (mẫu)', SAMPLES/'BTCUSD_M15_sample.csv'),
    'xauusd-sample': ('XAUUSD · M15 (mẫu)', SAMPLES/'XAUUSD_M15_10Hours.csv'),
    'btcusd-20250618': ('BTCUSD · M15 · 18/06/2025 UTC', SAMPLES/'raw/BTCUSD_M15_12h_2025-06-18_UTC.csv'),
    'xauusd-20250618': ('XAUUSD · M15 · 18/06/2025 UTC', SAMPLES/'raw/XAUUSD_M15_12h_2025-06-18_UTC.csv'),
}
ID_PATTERN = re.compile(r'^[a-f0-9]{32}$')


def safe_name(name: str) -> str:
    # Filename only, never allow paths and control characters.
    name = name.replace('\\','/').split('/')[-1].strip()
    name = ''.join(ch for ch in name if ch.isprintable() and ch not in '\r\n\x00')
    return name[:160] or 'uploaded.csv'


def dataset_meta(dataset_id: str):
    if dataset_id in BUILTIN:
        title, path = BUILTIN[dataset_id]
        return {'id':dataset_id,'name':title,'filename':path.name,'builtin':True,'path':path,'mapping':None,'date_order':'auto'}
    if not ID_PATTERN.fullmatch(dataset_id):
        return None
    file = DATA / (dataset_id + '.json')
    if not file.exists():
        return None
    try:
        info=json.loads(file.read_text('utf-8'))
        ext=info.get('extension','')
        if ext not in SUPPORTED: return None
        raw=DATA/(dataset_id+ext)
        if not raw.is_file(): return None
        return {'id':dataset_id,'name':info['name'],'filename':info['filename'],'builtin':False,'path':raw,'mapping':info.get('mapping'),'date_order':info.get('date_order','auto'),'created_at':info.get('created_at')}
    except (ValueError,KeyError,TypeError):
        return None


def datasets():
    results=[]
    for name in BUILTIN:
        m=dataset_meta(name)
        results.append({k:v for k,v in m.items() if k not in ('path','mapping')})
    for file in DATA.glob('*.json'):
        m=dataset_meta(file.stem)
        if m: results.append({k:v for k,v in m.items() if k not in ('path','mapping')})
    return results


class Handler(BaseHTTPRequestHandler):
    server_version='MarketStructureStudio/5.0'
    def log_message(self, fmt, *args):
        print('%s %s' % (self.address_string(),fmt%args),file=sys.stderr,flush=True)

    def reply_json(self, status: int, data):
        payload=json.dumps(data,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path=urlparse(self.path).path
        try:
            if path=='/api/health':
                return self.reply_json(200,{'ok':True,'service':'market-structure','version':'5.0.0-provisional','schema_version':'1.0.0','datasets':len(datasets())})
            if path=='/api/datasets':
                return self.reply_json(200,{'datasets':datasets()})
            if path.startswith('/api/datasets/'):
                dataset_id=path.removeprefix('/api/datasets/')
                m=dataset_meta(dataset_id)
                if not m: return self.reply_json(404,{'error':'Không tìm thấy bộ dữ liệu.'})
                output=normalize(m['path'].read_bytes(),m['filename'],mapping=m.get('mapping'),date_order=m.get('date_order','auto'))
                output['dataset']={k:v for k,v in m.items() if k not in ('path','mapping')}
                return self.reply_json(200,output)
            if path.startswith('/api/'):
                return self.reply_json(404,{'error':'API không tồn tại.'})
            return self.send_static(path)
        except DataError as exc:
            return self.reply_json(422,exc.as_payload())
        except Exception as exc:
            print('SERVER GET ERROR:',repr(exc),file=sys.stderr,flush=True)
            return self.reply_json(500,{'error':'Lỗi máy chủ khi đọc dữ liệu.'})

    def do_POST(self):
        parsed=urlparse(self.path)
        if parsed.path!='/api/import':
            return self.reply_json(404,{'error':'API không tồn tại.'})
        try:
            declared=int(self.headers.get('Content-Length','-1'))
            if declared<0 or declared>MAX_UPLOAD_BYTES:
                return self.reply_json(413,{'error':'File quá lớn hoặc thiếu Content-Length (giới hạn 12 MB).','code':'TOO_LARGE'})
            raw=self.rfile.read(declared)
            qs=parse_qs(parsed.query)
            name=safe_name(qs.get('filename',['uploaded.csv'])[0])
            if Path(name).suffix.lower() not in SUPPORTED:
                return self.reply_json(422,{'error':'Chỉ hỗ trợ CSV, TXT, TSV, JSON, JSONL hoặc XLSX.','code':'UNSUPPORTED'})
            map_str=qs.get('mapping',[''])[0]
            mapping=json.loads(map_str) if map_str else None
            if mapping is not None and not isinstance(mapping,dict):
                raise DataError('Ánh xạ cột phải là JSON object.')
            date_order=qs.get('date_order',['auto'])[0]
            if date_order not in ('auto','DMY','MDY'):
                raise DataError('date_order không hợp lệ.')
            result=normalize(raw,name,mapping=mapping,date_order=date_order)
            identifier=uuid.uuid4().hex
            ext=Path(name).suffix.lower()
            label=qs.get('label',[''])[0].strip()[:90] or Path(name).stem[:90]
            metadata={'name':label,'filename':name,'extension':ext,'mapping':mapping,'date_order':date_order,
                      'created_at':datetime.now(timezone.utc).isoformat()}
            raw_file=DATA/(identifier+ext)
            meta_file=DATA/(identifier+'.json')
            raw_file.write_bytes(raw)
            try:
                meta_file.write_text(json.dumps(metadata,ensure_ascii=False),encoding='utf-8')
            except Exception:
                raw_file.unlink(missing_ok=True)
                raise
            result['dataset']={'id':identifier,'name':label,'filename':name,'builtin':False}
            return self.reply_json(201,result)
        except DataError as exc:
            return self.reply_json(422,exc.as_payload())
        except (ValueError,TypeError) as exc:
            return self.reply_json(422,{'error':'Dữ liệu yêu cầu không hợp lệ: '+str(exc),'code':'BAD_REQUEST'})
        except Exception as exc:
            print('SERVER POST ERROR:',repr(exc),file=sys.stderr,flush=True)
            return self.reply_json(500,{'error':'Lỗi máy chủ trong quá trình nhập tệp.'})

    def do_DELETE(self):
        path=urlparse(self.path).path
        if not path.startswith('/api/datasets/'):
            return self.reply_json(404,{'error':'API không tồn tại.'})
        identifier=path.removeprefix('/api/datasets/')
        m=dataset_meta(identifier)
        if not m: return self.reply_json(404,{'error':'Không tìm thấy bộ dữ liệu.'})
        if m['builtin']: return self.reply_json(403,{'error':'Không thể xóa dữ liệu mẫu tích hợp.'})
        try:
            m['path'].unlink(missing_ok=True)
            (DATA/(identifier+'.json')).unlink(missing_ok=True)
            return self.reply_json(200,{'deleted':identifier})
        except OSError:
            return self.reply_json(500,{'error':'Không thể xóa tệp đã lưu.'})

    def send_static(self,path):
        relative = 'index.html' if path in ('/','') else path.lstrip('/')
        target=(STATIC/relative).resolve()
        if not target.is_relative_to(STATIC.resolve()) or not target.is_file():
            return self.reply_json(404,{'error':'Không tìm thấy trang.'})
        content=target.read_bytes()
        mime = 'text/javascript' if target.suffix.lower()=='.js' else mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        if mime.startswith('text/') or target.suffix.lower() in ('.js','.json'):
            mime += '; charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(content)))
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.end_headers()
        self.wfile.write(content)

if __name__=='__main__':
    server=ThreadingHTTPServer((HOST,PORT),Handler)
    print(f'Market Structure available at http://{HOST}:{PORT}',flush=True)
    try: server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt: pass
    finally: server.server_close()
