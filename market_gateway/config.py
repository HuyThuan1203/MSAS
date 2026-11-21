"""MSAS runtime configuration: one JSON file plus environment overrides.

Lookup order (later wins):
  1. DEFAULTS below (real-time OFF, so tests/CI/offline never touch the network)
  2. ``msas.config.json`` at the repository root (created by ``python build.py``
     from ``msas.config.example.json``), or the file named by MSAS_CONFIG
  3. environment: MSAS_REALTIME=true|false, MSAS_DATA_DIR, HOST, PORT
  4. command-line flags of ``run.py`` (passed in as ``overrides``)
"""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path

from . import timeframes as T

ROOT = Path(__file__).resolve().parents[1]
CONFIG_FILE = ROOT / 'msas.config.json'
EXAMPLE_FILE = ROOT / 'msas.config.example.json'

DEFAULTS = {
    'server': {'host': '127.0.0.1', 'port': 8080, 'open_browser': True},
    'realtime': {
        'enabled': False,
        'default_provider': 'binance',
        'fallback_providers': ['bybit'],
        'fallback_after_failures': 5,
        'poll_seconds': 2.0,
        'history_limit': 500,
        'max_subscriptions': 16,
        'idle_release_minutes': 10,
        'request_timeout_seconds': 10,
        'simulator': False,   # offline synthetic test feed; never used as fallback
        'autostart': [{'provider': 'binance', 'symbol': 'BTCUSDT', 'timeframes': ['M1', 'M15']}],
    },
    'storage': {
        # Relative paths are resolved against the repository root.
        'data_dir': 'market_data',
        'retention_days': 30,
        'retention_days_by_timeframe': {'D1': 3650, 'W1': 3650, 'MN1': 3650},
        'cleanup_interval_minutes': 60,
    },
}

TRUE = {'1', 'true', 'yes', 'on'}
FALSE = {'0', 'false', 'no', 'off'}


def parse_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in TRUE:
        return True
    if text in FALSE:
        return False
    raise ValueError(f'Expected true/false, got {value!r}')


def _merge(base: dict, extra: dict) -> dict:
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _merge(base[key], value)
        else:
            base[key] = value
    return base


def load(path: str | os.PathLike | None = None, overrides: dict | None = None, env=os.environ) -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    file = Path(path or env.get('MSAS_CONFIG') or CONFIG_FILE)
    if file.is_file():
        _merge(cfg, json.loads(file.read_text(encoding='utf-8')))
    if env.get('MSAS_REALTIME'):
        cfg['realtime']['enabled'] = parse_bool(env['MSAS_REALTIME'])
    if env.get('MSAS_DATA_DIR'):
        cfg['storage']['data_dir'] = env['MSAS_DATA_DIR']
    if env.get('HOST'):
        cfg['server']['host'] = env['HOST']
    if env.get('PORT'):
        cfg['server']['port'] = int(env['PORT'])
    _merge(cfg, overrides or {})
    validate(cfg)
    cfg['_config_file'] = str(file) if file.is_file() else None
    return cfg


def validate(cfg: dict) -> None:
    rt, st = cfg['realtime'], cfg['storage']
    rt['enabled'] = parse_bool(rt['enabled'])
    if float(rt['poll_seconds']) < 0.5:
        raise ValueError('realtime.poll_seconds must be >= 0.5 (provider rate limits)')
    if not 50 <= int(rt['history_limit']) <= 1000:
        raise ValueError('realtime.history_limit must be between 50 and 1000')
    if int(st['retention_days']) < 1:
        raise ValueError('storage.retention_days must be >= 1')
    for tf, days in st.get('retention_days_by_timeframe', {}).items():
        T.check(tf)
        if int(days) < 1:
            raise ValueError(f'retention for {tf} must be >= 1 day')
    for item in rt.get('autostart', []):
        for tf in item.get('timeframes', []):
            T.check(tf)


def data_dir(cfg: dict) -> Path:
    p = Path(cfg['storage']['data_dir'])
    return (p if p.is_absolute() else ROOT / p).resolve()
