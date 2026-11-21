"""Closed-candle storage in one shared, human-browsable folder.

Layout (``storage.data_dir``, default ``<repo>/market_data``)::

    market_data/
      README.md                         generated description of this folder
      uploads/                          files imported through the UI
      live/<provider>/<SYMBOL>/<TF>/
          series.json                   source identity + latest lineage
          YYYY-MM-DD.csv                closed candles opened on that UTC day

Rows are append-only. A provider correction of an already stored candle is a
new row with ``revision`` + 1 (last revision wins on load), so the audit trail
is never rewritten. One ``SeriesStore`` instance (and lock) exists per folder,
so two subscriptions that resolve to the same venue series never interleave.
Retention deletes whole day files older than N days, inside ``live/`` only.
"""
from __future__ import annotations

import csv
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import timeframes as T

DAY_FILE = re.compile(r'^(\d{4})-(\d{2})-(\d{2})\.csv$')
COLUMNS = ['open_time_utc', 'open_ms', 'open', 'high', 'low', 'close', 'volume', 'revision', 'received_at_utc']
VALUE_KEYS = ('open', 'high', 'low', 'close', 'volume')

README = """# MSAS market data folder

Everything MSAS downloads or imports is stored here. Safe to inspect; delete a
folder to drop its data (it is re-downloaded from the provider when needed).

- `live/<provider>/<SYMBOL>/<TF>/YYYY-MM-DD.csv` - CLOSED candles only, one file
  per UTC day of the candle open time. `series.json` holds the source identity.
- `uploads/` - files imported with "+ Import" in the UI.

Retention: day files older than `storage.retention_days` (per timeframe override
`storage.retention_days_by_timeframe`) are deleted automatically by the server.
Configure in `msas.config.json` at the repository root.
"""


def ensure_layout(root: Path) -> None:
    (root / 'live').mkdir(parents=True, exist_ok=True)
    (root / 'uploads').mkdir(parents=True, exist_ok=True)
    readme = root / 'README.md'
    if not readme.exists():
        readme.write_text(README, encoding='utf-8')


class SeriesStore:
    def __init__(self, root: Path, provider: str, symbol: str, tf: str):
        self.dir = Path(root) / 'live' / provider / symbol / T.check(tf)
        self.tf = tf
        self.lock = threading.Lock()
        self._latest: dict[int, dict] | None = None   # open_ms -> last stored revision row

    def _read_all(self) -> dict[int, dict]:
        rows: dict[int, dict] = {}
        if not self.dir.is_dir():
            return rows
        for path in sorted(p for p in self.dir.iterdir() if DAY_FILE.match(p.name)):
            with path.open(newline='', encoding='utf-8') as fh:
                for r in csv.DictReader(fh):
                    try:
                        ms = int(r['open_ms'])
                        rec = {'open_ms': ms, 'open': float(r['open']), 'high': float(r['high']),
                               'low': float(r['low']), 'close': float(r['close']),
                               'volume': None if r['volume'] == '' else float(r['volume']),
                               'revision': int(r['revision'])}
                    except (KeyError, TypeError, ValueError):
                        continue   # damaged row: skip, never guess
                    if ms not in rows or rec['revision'] >= rows[ms]['revision']:
                        rows[ms] = rec
        return rows

    def load(self, limit: int) -> list[dict]:
        with self.lock:
            if self._latest is None:
                self._latest = self._read_all()
            return [dict(self._latest[k]) for k in sorted(self._latest)][-limit:]

    def append(self, records: list[dict]) -> list[dict]:
        """Append rows not already stored with identical values. Returns the
        rows actually written (a changed value is written as revision+1)."""
        with self.lock:
            if self._latest is None:
                self._latest = self._read_all()
            todo = []
            for rec in records:
                old = self._latest.get(rec['open_ms'])
                if old and all(old[k] == rec[k] for k in VALUE_KEYS):
                    continue
                rec = dict(rec, revision=(old['revision'] + 1) if old else max(1, int(rec.get('revision', 1))))
                self._latest[rec['open_ms']] = rec
                todo.append(rec)
            if not todo:
                return []
            self.dir.mkdir(parents=True, exist_ok=True)
            received = datetime.now(timezone.utc).isoformat(timespec='seconds')
            by_day: dict[str, list[dict]] = {}
            for rec in todo:
                by_day.setdefault(T.day(rec['open_ms']), []).append(rec)
            for d, items in by_day.items():
                path = self.dir / f'{d}.csv'
                new = not path.exists() or path.stat().st_size == 0
                with path.open('a', newline='', encoding='utf-8') as fh:
                    w = csv.writer(fh, lineterminator='\n')
                    if new:
                        w.writerow(COLUMNS)
                    for r in items:
                        w.writerow([T.iso(r['open_ms']), r['open_ms'], repr(r['open']), repr(r['high']), repr(r['low']),
                                    repr(r['close']), '' if r['volume'] is None else repr(r['volume']),
                                    r['revision'], received])
            return todo

    def forget(self, before_ms: int) -> None:
        """Drop the in-memory index for rows removed by retention."""
        with self.lock:
            if self._latest:
                for k in [k for k in self._latest if k < before_ms]:
                    del self._latest[k]

    def write_meta(self, meta: dict) -> None:
        with self.lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self.dir / f'series.json.{os.getpid()}.{threading.get_ident()}.tmp'
            tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding='utf-8')
            os.replace(tmp, self.dir / 'series.json')


def _inside(path: Path, root_real: Path) -> bool:
    """Canonical containment: resolves symlinks AND Windows junctions."""
    try:
        return Path(os.path.realpath(path)).is_relative_to(root_real)
    except (OSError, ValueError):
        return False


def cleanup(root: Path, retention_days: int, by_tf: dict | None = None, now: float | None = None) -> list[Path]:
    """Delete ``live/<provider>/<SYMBOL>/<TF>/YYYY-MM-DD.csv`` older than the window.

    Fail-closed: a folder or file is skipped unless its canonical path equals
    the expected path under the canonical ``<root>/live`` (so symlinks and
    junctions pointing elsewhere are never followed). Empty folders are
    removed with ``rmdir`` only. Returns the deleted files.
    """
    live = Path(root) / 'live'
    if not live.is_dir() or live.is_symlink():
        return []
    live_real = Path(os.path.realpath(live))
    today = datetime.fromtimestamp(now if now is not None else time.time(), tz=timezone.utc).date()
    deleted: list[Path] = []
    for tf_dir in live.glob('*/*/*'):
        rel = tf_dir.relative_to(live)
        if tf_dir.name not in T.TIMEFRAMES or not tf_dir.is_dir():
            continue
        if any((live / Path(*rel.parts[:i + 1])).is_symlink() for i in range(len(rel.parts))):
            continue
        if Path(os.path.realpath(tf_dir)) != live_real / rel:   # junction / reparse point
            continue
        keep = int((by_tf or {}).get(tf_dir.name, retention_days))
        cutoff = today - timedelta(days=keep)
        for f in tf_dir.iterdir():
            m = DAY_FILE.match(f.name)
            if not m or f.is_symlink() or not f.is_file():
                continue
            if Path(os.path.realpath(f)) != live_real / rel / f.name:
                continue
            try:
                file_day = datetime(int(m[1]), int(m[2]), int(m[3])).date()
            except ValueError:
                continue
            if file_day < cutoff:
                f.unlink()
                deleted.append(f)
    # Remove folders that are now completely empty (rmdir refuses non-empty ones).
    for pattern in ('*/*/*', '*/*', '*'):
        for d in sorted(live.glob(pattern), reverse=True):
            if d.is_dir() and not d.is_symlink() and _inside(d, live_real) and not any(d.iterdir()):
                d.rmdir()
    return deleted
