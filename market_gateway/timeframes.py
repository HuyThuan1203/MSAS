"""Canonical MSAS timeframes and UTC candle boundaries.

Times are integer milliseconds since the epoch, UTC. A candle is identified by
its OPEN time; its end is exclusive. Weekly candles open Monday 00:00 UTC and
monthly candles on the first day of the month 00:00 UTC (Binance/Bybit spot).
"""
from __future__ import annotations

from datetime import datetime, timezone

MINUTE = 60_000
FIXED_MS = {
    'M1': MINUTE, 'M3': 3 * MINUTE, 'M5': 5 * MINUTE, 'M15': 15 * MINUTE, 'M30': 30 * MINUTE,
    'H1': 60 * MINUTE, 'H2': 120 * MINUTE, 'H4': 240 * MINUTE, 'H6': 360 * MINUTE, 'H12': 720 * MINUTE,
    'D1': 1440 * MINUTE, 'W1': 7 * 1440 * MINUTE,
}
TIMEFRAMES = list(FIXED_MS) + ['MN1']
LABELS = {'M1': '1m', 'M3': '3m', 'M5': '5m', 'M15': '15m', 'M30': '30m', 'H1': '1h', 'H2': '2h', 'H4': '4h',
          'H6': '6h', 'H12': '12h', 'D1': '1D (24h)', 'W1': '1W', 'MN1': '1M (month)'}
INTRADAY = {tf for tf in TIMEFRAMES if tf not in ('D1', 'W1', 'MN1')}


def check(tf: str) -> str:
    if tf not in TIMEFRAMES:
        raise ValueError(f'Unsupported timeframe {tf!r}; use one of {", ".join(TIMEFRAMES)}')
    return tf


def end_ms(tf: str, open_ms: int) -> int:
    """Exclusive end of the candle that opens at ``open_ms``."""
    if tf != 'MN1':
        return open_ms + FIXED_MS[check(tf)]
    d = datetime.fromtimestamp(open_ms / 1000, tz=timezone.utc)
    nxt = d.replace(year=d.year + (d.month == 12), month=d.month % 12 + 1, day=1,
                    hour=0, minute=0, second=0, microsecond=0)
    return int(nxt.timestamp() * 1000)


def iso(ms: int) -> str:
    """Same text format as app/importer.py: 'YYYY-MM-DD HH:MM:SS+00:00'."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat(sep=' ')


def day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d')
