"""Local-first web server for replaying OHLC datasets and (optionally) live market data.

Standard-library only. Real-time data is OFF unless enabled in msas.config.json,
MSAS_REALTIME=true or ``python run.py --realtime true``; replay of samples and
imported files never needs the network.
"""
from __future__ import annotations

import json
import mimetypes
import os
import queue
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
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))
try:
    from market_gateway import config as gateway_config  # noqa: E402
except ImportError:  # image/package without the optional gateway: replay only
    gateway_config = None


def _default_config() -> dict:
    if gateway_config:
        return gateway_config.load()
    return {'server': {'host': os.environ.get('HOST', '127.0.0.1'), 'port': int(os.environ.get('PORT', '8080'))},
            'realtime': {'enabled': False}, 'storage': {'retention_days': 30}}


def _uploads_dir(cfg: dict) -> Path:
    if os.environ.get('DATA_DIR'):
        return Path(os.environ['DATA_DIR']).resolve()
    if gateway_config:
        return (gateway_config.data_dir(cfg) / 'uploads').resolve()
    return (BASE / 'data').resolve()


STATIC = BASE / 'static'
SAMPLES = BASE / 'samples'
CONFIG = _default_config()
# Imported files: DATA_DIR (Docker) or <market_data>/uploads. The legacy
# <repo>/data folder stays readable so earlier imports keep working.
DATA = _uploads_dir(CONFIG)
DATA.mkdir(parents=True, exist_ok=True)
LEGACY_DATA = (BASE / 'data').resolve()
PORT = int(CONFIG['server']['port'])
HOST = CONFIG['server']['host']
LIVE = None  # market_gateway.manager.LiveManager when real-time is enabled


def configure(cfg: dict) -> None:
    """Apply a configuration loaded by run.py (flags already merged)."""
    global CONFIG, DATA, PORT, HOST
    CONFIG = cfg
    DATA = _uploads_dir(cfg)
    DATA.mkdir(parents=True, exist_ok=True)
    PORT, HOST = int(cfg['server']['port']), cfg['server']['host']


def data_dirs() -> list[Path]:
    return [DATA] + ([LEGACY_DATA] if LEGACY_DATA != DATA and LEGACY_DATA.is_dir() else [])

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
    folder = next((d for d in data_dirs() if (d / (dataset_id + '.json')).exists()), None)
    if folder is None:
        return None
    file = folder / (dataset_id + '.json')
    try:
        info=json.loads(file.read_text('utf-8'))
        ext=info.get('extension','')
        if ext not in SUPPORTED: return None
        raw=folder/(dataset_id+ext)
        if not raw.is_file(): return None
        return {'id':dataset_id,'name':info['name'],'filename':info['filename'],'builtin':False,'path':raw,'meta_file':file,'mapping':info.get('mapping'),'date_order':info.get('date_order','auto'),'created_at':info.get('created_at')}
    except (ValueError,KeyError,TypeError):
        return None


def public(m: dict) -> dict:
    return {k:v for k,v in m.items() if k not in ('path','mapping','meta_file')}


def datasets():
    results=[]
    for name in BUILTIN:
        results.append(public(dataset_meta(name)))
    seen=set()
    for folder in data_dirs():
        for file in folder.glob('*.json'):
            m=dataset_meta(file.stem)
            if m and m['id'] not in seen:
                seen.add(m['id']);results.append(public(m))
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

    # ---- live market data (optional) -------------------------------------
    def live_series(self, qs):
        key=(qs.get('subscription_id') or [''])[0]
        s=LIVE.get(key) if LIVE else None
        if not s: self.reply_json(404,{'error':'Unknown live subscription.','code':'NO_SUBSCRIPTION'})
        return s

    def live_get(self, path, qs):
        if path=='/api/live/config':
            if not LIVE:
                return self.reply_json(200,{'enabled':False,'reason':'Real-time data is disabled (realtime.enabled=false). Start with: python run.py --realtime true'})
            return self.reply_json(200,LIVE.public_config())
        if not LIVE:
            return self.reply_json(503,{'error':'Real-time data is disabled.','code':'REALTIME_DISABLED'})
        if path=='/api/live/series':
            return self.reply_json(200,{'series':[s.status_view() for s in list(LIVE.series.values())]})
        if path=='/api/live/history':
            s=self.live_series(qs)
            return s and self.reply_json(200,s.snapshot())
        if path=='/api/live/status':
            s=self.live_series(qs)
            return s and self.reply_json(200,s.status_view())
        if path=='/api/live/events':
            s=self.live_series(qs)
            return s and self.stream_events(s,qs)
        return self.reply_json(404,{'error':'API không tồn tại.'})

    def stream_events(self, s, qs):
        """Server-Sent Events from a cursor: `after` (query) or Last-Event-ID
        (browser reconnect). Missed events are replayed from the series ring;
        if they are no longer available a `resync` event tells the client to
        reload the snapshot. Ends when the series is released."""
        cursor=self.headers.get('Last-Event-ID') or (qs.get('after') or [''])[0]
        try: after=int(cursor) if cursor!='' else None
        except ValueError: after=None
        try:
            lst=s.listen(after)
        except OverflowError as exc:
            return self.reply_json(429,{'error':str(exc),'code':'TOO_MANY_LISTENERS'})
        except KeyError:
            return self.reply_json(404,{'error':'Unknown live subscription.','code':'NO_SUBSCRIPTION'})
        try:
            self.send_response(200)
            self.send_header('Content-Type','text/event-stream; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Connection','keep-alive')
            self.end_headers()
            self.wfile.write(b'retry: 3000\n\n');self.wfile.flush()
            while not LIVE.stopped.is_set() and not s.stopped.is_set():
                if lst.overflow:
                    self.wfile.write(b'event: resync\ndata: {"type":"resync","reason":"events not replayable"}\n\n');self.wfile.flush()
                    return
                try:
                    ev=lst.queue.get(timeout=15)
                    msg='id: %d\nevent: %s\ndata: %s\n\n'%(ev['id'],ev['type'],json.dumps(ev,ensure_ascii=False,allow_nan=False))
                except queue.Empty:
                    msg=': keep-alive\n\n'
                self.wfile.write(msg.encode('utf-8'));self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError,OSError):
            pass
        finally:
            s.unlisten(lst)

    def do_GET(self):
        parsed=urlparse(self.path);path=parsed.path
        try:
            if path.startswith('/api/live/'):
                return self.live_get(path,parse_qs(parsed.query))
            if path=='/api/health':
                return self.reply_json(200,{'ok':True,'service':'market-structure','version':'5.5.0','schema_version':'1.0.0','datasets':len(datasets()),
                                            'realtime':bool(LIVE),'live_series':len(LIVE.series) if LIVE else 0})
            if path=='/api/datasets':
                return self.reply_json(200,{'datasets':datasets()})
            if path.startswith('/api/datasets/'):
                dataset_id=path.removeprefix('/api/datasets/')
                m=dataset_meta(dataset_id)
                if not m: return self.reply_json(404,{'error':'Không tìm thấy bộ dữ liệu.'})
                output=normalize(m['path'].read_bytes(),m['filename'],mapping=m.get('mapping'),date_order=m.get('date_order','auto'))
                output['dataset']=public(m)
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
        if parsed.path=='/api/live/subscriptions':
            if not LIVE:
                return self.reply_json(503,{'error':'Real-time data is disabled.','code':'REALTIME_DISABLED'})
            try:
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=4096: raise ValueError('body required (max 4 KB)')
                body=json.loads(self.rfile.read(n))
                s=LIVE.subscribe(str(body.get('provider') or ''),str(body.get('symbol') or ''),str(body.get('timeframe') or ''))
                return self.reply_json(201,s.status_view())
            except Exception as exc:  # ValueError / ProviderError / JSON errors: client input
                return self.reply_json(422,{'error':str(exc),'code':'BAD_SUBSCRIPTION'})
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
        if path.startswith('/api/live/subscriptions/'):
            key=unquote(path.removeprefix('/api/live/subscriptions/'))
            if not LIVE or not LIVE.get(key): return self.reply_json(404,{'error':'Unknown live subscription.'})
            if LIVE.get(key).autostart: return self.reply_json(403,{'error':'Autostart subscriptions are managed in msas.config.json.'})
            LIVE.release(key)
            return self.reply_json(200,{'released':key})
        if not path.startswith('/api/datasets/'):
            return self.reply_json(404,{'error':'API không tồn tại.'})
        identifier=path.removeprefix('/api/datasets/')
        m=dataset_meta(identifier)
        if not m: return self.reply_json(404,{'error':'Không tìm thấy bộ dữ liệu.'})
        if m['builtin']: return self.reply_json(403,{'error':'Không thể xóa dữ liệu mẫu tích hợp.'})
        try:
            m['path'].unlink(missing_ok=True)
            m['meta_file'].unlink(missing_ok=True)
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

def serve(cfg: dict | None = None, on_ready=None) -> None:
    """Start the HTTP server; start the live gateway when realtime.enabled."""
    global LIVE
    if cfg is not None:
        configure(cfg)
    server=ThreadingHTTPServer((HOST,PORT),Handler)
    server.daemon_threads=True
    url=f'http://{HOST}:{PORT}'
    print(f'Market Structure available at {url}',flush=True)
    if CONFIG['realtime']['enabled']:
        from market_gateway.manager import LiveManager
        LIVE=LiveManager(CONFIG)
        LIVE.start()
        print(f'Real-time data ON  -> {LIVE.root} (retention {CONFIG["storage"]["retention_days"]} days)',flush=True)
    else:
        print('Real-time data OFF (replay/import only). Enable: python run.py --realtime true',flush=True)
    if on_ready: on_ready(url)
    try: server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt: pass
    finally:
        if LIVE: LIVE.stop()
        server.server_close()


if __name__=='__main__':
    serve()
