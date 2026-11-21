#!/usr/bin/env python3
"""Start MSAS: web UI + (optional) real-time market data.

    python run.py                      # uses msas.config.json (created by build.py)
    python run.py --realtime false     # replay/import only, no network
    python run.py --port 9000 --no-browser
    python run.py --data-dir D:/msas_data --retention-days 14

Settings precedence: flags > environment (MSAS_REALTIME, MSAS_DATA_DIR, HOST,
PORT) > msas.config.json > built-in defaults.
"""
from __future__ import annotations

import argparse
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'app'))

from market_gateway import config as C  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Run MSAS (market-structure replay + live data).')
    ap.add_argument('--config', help='path to a config JSON (default: msas.config.json)')
    ap.add_argument('--realtime', type=C.parse_bool, metavar='true|false', help='fetch live market data')
    ap.add_argument('--host')
    ap.add_argument('--port', type=int)
    ap.add_argument('--data-dir', help='shared folder for live data and uploads')
    ap.add_argument('--retention-days', type=int, help='delete live day files older than N days')
    ap.add_argument('--no-browser', action='store_true', help='do not open the browser')
    a = ap.parse_args(argv)

    over: dict = {'server': {}, 'realtime': {}, 'storage': {}}
    if a.realtime is not None: over['realtime']['enabled'] = a.realtime
    if a.host: over['server']['host'] = a.host
    if a.port: over['server']['port'] = a.port
    if a.data_dir: over['storage']['data_dir'] = a.data_dir
    if a.retention_days: over['storage']['retention_days'] = a.retention_days
    if a.no_browser: over['server']['open_browser'] = False
    cfg = C.load(a.config, over)
    if not cfg['_config_file']:
        print('No msas.config.json found: using defaults (real-time OFF). Run "python build.py" to create one.')

    import server  # app/server.py

    def ready(url: str) -> None:
        if cfg['server']['open_browser']:
            threading.Timer(1.0, lambda: webbrowser.open(url.replace('0.0.0.0', '127.0.0.1'))).start()

    server.serve(cfg, on_ready=ready)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
