"""Live subscription manager: finalization, dedupe, recovery, fallback, events.

One worker thread per subscription (bounded by realtime.max_subscriptions).
``Series.step()`` performs exactly one bootstrap or poll iteration and is what
the unit tests drive directly, without threads or network.

Concurrency: network I/O runs WITHOUT the series lock; every state change and
every snapshot runs WITH it, so a snapshot is always one consistent
(lineage, candles, last_event_id) triple. Events go to a bounded replay ring:
a client connects with ``after=<last_event_id of its snapshot>`` and receives
exactly the events it has not seen, or a reset when the ring no longer has them.

Fallback policy (architecture doc section 9):
  L0  transient error  -> exponential backoff + jitter, same provider
  L1  missed closes    -> same-provider REST backfill from a cursor, paged,
                          sized by the PROVIDER clock (works for MN1 too)
  L3  provider down / permanent error (region block, bad symbol)
                       -> next real provider with a NEW lineage and fresh
                          history; candles of different venues are never mixed.
"""
from __future__ import annotations

import collections
import itertools
import math
import queue
import random
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import config as C
from . import timeframes as T
from .adapters import PROVIDERS, REAL_PROVIDERS, Bar, ProviderError
from .store import SeriesStore, cleanup, ensure_layout

SCHEMA = 'msas.live.v1'
MEMORY_FACTOR = 4          # keep up to history_limit * 4 closed candles in memory
REPLAY_EVENTS = 5000       # replay ring per series
MAX_LISTENERS = 20         # SSE clients per series
QUEUE_SIZE = 2000
VALUE_KEYS = ('open', 'high', 'low', 'close', 'volume')
BOOT_ID = __import__('uuid').uuid4().hex[:12]   # changes on every server process start
LINEAGE_SEQ = itertools.count(1)   # unique even when the clock does not advance


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def valid_ohlc(b) -> bool:
    vals = (b.open, b.high, b.low, b.close)
    return all(math.isfinite(v) for v in vals) and b.low <= min(b.open, b.close) <= max(b.open, b.close) <= b.high


def rec_of(b: Bar) -> dict:
    return {'open_ms': b.open_ms, 'open': b.open, 'high': b.high, 'low': b.low, 'close': b.close,
            'volume': b.volume, 'revision': 1}


class Listener:
    def __init__(self):
        self.queue: queue.Queue = queue.Queue(maxsize=QUEUE_SIZE)
        self.overflow = False   # set when an event could not be queued -> client must resync


class Series:
    def __init__(self, mgr: 'LiveManager', provider_id: str, symbol: str, tf: str, autostart: bool = False):
        self.mgr = mgr
        self.requested_provider = provider_id
        self.symbol = symbol
        self.tf = T.check(tf)
        self.id = f'{provider_id}:{symbol}:{tf}'
        self.autostart = autostart
        self.lock = threading.RLock()
        self.listeners: set[Listener] = set()
        self.ring: collections.deque = collections.deque(maxlen=REPLAY_EVENTS)
        self.seq = 0
        self.failures = 0
        self.next_due = 0.0
        self.last_listener_seen = time.monotonic()
        self.stopped = threading.Event()
        self.thread: threading.Thread | None = None
        self.status = 'connecting'
        self.detail = ''
        with self.lock:
            self._use_provider(provider_id, reason=None)

    # ---- identity (call with lock held) ----------------------------------
    def _use_provider(self, provider_id: str, reason: str | None) -> None:
        self.provider = self.mgr.make_provider(provider_id)
        self.store = self.mgr.store_for(provider_id, self.symbol, self.tf)
        stamp = '' if provider_id == self.requested_provider and reason is None else f'#{time.time_ns()}.{next(LINEAGE_SEQ)}'
        self.lineage_id = f'{provider_id}|{self.provider.venue}|spot|{self.symbol}|last_trade|{self.tf}{stamp}'
        self.candles: list[dict] = []
        self.partial: dict | None = None
        self.gaps = 0
        self.bootstrapped = False
        self.status, self.detail = 'connecting', reason or ''

    def source(self) -> dict:
        return {'provider': self.provider.id, 'venue': self.provider.venue, 'feed': 'spot', 'symbol': self.symbol,
                'timeframe': self.tf, 'price_basis': 'last_trade', 'volume_kind': 'base_asset_traded'}

    # ---- events -----------------------------------------------------------
    def _emit(self, typ: str, **body) -> dict:
        with self.lock:
            self.seq += 1
            ev = {'event_schema': SCHEMA, 'id': self.seq, 'boot': BOOT_ID, 'type': typ, 'subscription_id': self.id,
                  'lineage_id': self.lineage_id, 'source': self.source(), 'received_at_utc': utc_now_iso(), **body}
            self.ring.append(ev)
            for lst in list(self.listeners):
                try:
                    lst.queue.put_nowait(ev)
                except queue.Full:
                    lst.overflow = True   # never drop silently: that client resyncs
            return ev

    def _set_status(self, status: str, detail: str = '') -> None:
        with self.lock:
            if status != self.status or detail != self.detail:
                self.status, self.detail = status, detail
                self._emit('feed.status', status=status, detail=detail)

    def ui_candle(self, rec: dict, index: int) -> dict:
        t = T.iso(rec['open_ms'])
        return {'time': t, 'source_time': t, 'open': rec['open'], 'high': rec['high'], 'low': rec['low'],
                'close': rec['close'], 'volume': rec['volume'], 'index': index}

    def _candle_event(self, typ: str, rec: dict, index: int, closed: bool) -> None:
        self._emit(typ, closed=closed, revision=rec.get('revision', 1),
                   timestamps={'candle_open_utc': T.iso(rec['open_ms']),
                               'candle_end_exclusive_utc': T.iso(T.end_ms(self.tf, rec['open_ms']))},
                   candle=self.ui_candle(rec, index))

    def listen(self, after: int | None) -> Listener:
        """Register atomically and replay everything after ``after``."""
        with self.lock:
            if self.stopped.is_set():
                raise KeyError(self.id)
            if len(self.listeners) >= MAX_LISTENERS:
                raise OverflowError('too many listeners for this subscription')
            lst = Listener()
            if after is not None and after > self.seq:
                lst.overflow = True           # cursor from an earlier server process -> reset
            elif after is not None and after < self.seq:
                oldest = self.ring[0]['id'] if self.ring else self.seq + 1
                if after + 1 < oldest:
                    lst.overflow = True       # history no longer replayable -> reset
                else:
                    for ev in self.ring:
                        if ev['id'] > after:
                            lst.queue.put_nowait(ev)
            self.listeners.add(lst)
            return lst

    def unlisten(self, lst: Listener) -> None:
        with self.lock:
            self.listeners.discard(lst)
            self.last_listener_seen = time.monotonic()

    # ---- one iteration ------------------------------------------------------
    def step(self) -> None:
        try:
            if not self.bootstrapped:
                self._bootstrap()
            else:
                self._poll()
            self.failures = 0
            self.next_due = time.monotonic() + float(self.mgr.rt['poll_seconds'])
        except ProviderError as exc:
            self._on_error(exc)
        except Exception as exc:  # malformed payload, disk error...: never kill the worker
            self._on_error(ProviderError(f'{type(exc).__name__}: {exc}'))

    def _on_error(self, exc: ProviderError) -> None:
        self.failures += 1
        limit = int(self.mgr.rt['fallback_after_failures'])
        if exc.permanent or self.failures >= limit:
            if self._fallback(str(exc)):
                return
        delay = min(60.0, 2.0 ** min(self.failures, 6)) * random.uniform(0.8, 1.2)
        self.next_due = time.monotonic() + delay
        self._set_status('reconnecting' if self.bootstrapped else 'error', f'{exc} (retry in {delay:.0f}s)')

    def _fallback(self, reason: str) -> bool:
        order = [self.mgr.rt['default_provider']] + list(self.mgr.rt.get('fallback_providers', []))
        # Only real providers; a real series never falls back to synthetic data.
        order = [p for i, p in enumerate(order) if p in REAL_PROVIDERS and p not in order[:i]]
        candidates = [p for p in order if p != self.provider.id and self.tf in PROVIDERS[p].intervals]
        if not candidates or self.provider.id not in REAL_PROVIDERS:
            return False
        with self.lock:
            previous, old = self.lineage_id, self.provider.id
            self._use_provider(candidates[0], reason=f'fallback from {old}: {reason}')
            self.failures = 0
            self.next_due = time.monotonic()
            self._emit('source.changed', previous_lineage=previous, new_lineage=self.lineage_id, reason=reason,
                       action='reload_history')
            self.status = ''   # force the status event below
            self._set_status('source_changed', f'Using {self.provider.name}; history reloaded as a new series')
        return True

    def _bootstrap(self) -> None:
        self._set_status('backfilling')
        limit = int(self.mgr.rt['history_limit'])
        provider = self.provider
        now = provider.server_time_ms()                       # clock BEFORE the data
        bars = provider.klines(self.symbol, self.tf, limit, now_ms=now)
        # Stored rows the provider clock has not closed yet (clock skew, copied
        # folders) are not trusted: only candles closed by the provider's own
        # time are ever handed to the engines.
        stored = [r for r in self.store.load(limit) if T.end_ms(self.tf, r['open_ms']) <= now]
        with self.lock:
            if provider is not self.provider:                 # provider switched meanwhile
                return
            fresh = [rec_of(b) for b in bars if b.closed and valid_ohlc(b)]
            written = {r['open_ms']: r for r in self.store.append(fresh)}
            merged = {r['open_ms']: r for r in stored}
            for r in fresh:
                old = merged.get(r['open_ms'])
                merged[r['open_ms']] = written.get(r['open_ms']) or old or r
            self.candles = [merged[k] for k in sorted(merged)][-limit:]
            self._recount_gaps()
            live = [b for b in bars if not b.closed]
            self.partial = rec_of(live[-1]) if live else None
            self.bootstrapped = True
            self._emit('history.reset', rows=len(self.candles), gaps=self.gaps)
            self._set_status('live' if not self.gaps else 'gap',
                             f'{self.gaps} gap(s) in provider history' if self.gaps else '')
        self.store.write_meta({'folder': f'{provider.id}/{self.symbol}/{self.tf}', 'lineage_id': self.lineage_id,
                               **self.source(), 'updated_at_utc': utc_now_iso(),
                               'closed_rule': 'provider server time (sampled before fetch) >= candle end'})

    def _recount_gaps(self) -> None:
        c = self.candles
        self.gaps = sum(1 for a, b in zip(c, c[1:]) if b['open_ms'] != T.end_ms(self.tf, a['open_ms']))

    def _poll(self) -> None:
        provider = self.provider
        now = provider.server_time_ms()                       # clock BEFORE the data
        with self.lock:
            # Cursor: re-read the last few closed candles (corrections) and
            # everything after them; page until the provider has no more.
            start = self.candles[-3]['open_ms'] if len(self.candles) >= 3 else None
        bars: list[Bar] = []
        if start is None:
            bars = provider.klines(self.symbol, self.tf, 3, now_ms=now)
        else:
            for page_no in range(50):
                page = provider.klines(self.symbol, self.tf, provider.max_limit, start_ms=start, now_ms=now)
                bars.extend(page)
                if page_no == 0 and len(page) >= provider.max_limit:
                    self._set_status('backfilling', 'catching up after a disconnect')
                if len(page) < provider.max_limit or not page:
                    break
                nxt = T.end_ms(self.tf, page[-1].open_ms)
                if nxt <= start or nxt > now:
                    break
                start = nxt
        with self.lock:
            if provider is not self.provider:
                return
            self._apply(bars)
            if self.status in ('backfilling', 'reconnecting', 'connecting', 'error', 'source_changed'):
                self._set_status('live' if not self.gaps else 'gap')

    def _apply(self, bars: list[Bar]) -> None:  # lock held
        index_of = {r['open_ms']: i for i, r in enumerate(self.candles)}
        partial = None
        inserted = False
        for b in sorted({b.open_ms: b for b in bars}.values(), key=lambda x: x.open_ms):
            if not valid_ohlc(b):
                self._emit('feed.status', status=self.status, detail=f'invalid OHLC from provider at {T.iso(b.open_ms)} ignored')
                continue
            rec = rec_of(b)
            if not b.closed:
                partial = rec
                continue
            last = self.candles[-1]['open_ms'] if self.candles else None
            if last is None or b.open_ms > last:
                if last is not None and b.open_ms != T.end_ms(self.tf, last):
                    self.gaps += 1
                    self._emit('gap.detected', missing_from_utc=T.iso(T.end_ms(self.tf, last)), next_open_utc=T.iso(b.open_ms))
                written = self.store.append([rec])
                rec = written[0] if written else rec
                self.candles.append(rec)
                index_of[rec['open_ms']] = len(self.candles) - 1
                self._candle_event('candle.closed', rec, len(self.candles) - 1, True)
            elif b.open_ms in index_of:
                i = index_of[b.open_ms]
                if any(self.candles[i][k] != rec[k] for k in VALUE_KEYS):
                    written = self.store.append([rec])
                    rec = written[0] if written else dict(rec, revision=self.candles[i]['revision'] + 1)
                    self.candles[i] = rec
                    self._candle_event('candle.corrected', rec, i, True)
            elif self.candles and b.open_ms > self.candles[0]['open_ms']:
                # Late fill of an earlier gap: indexes shift, so the browser
                # must reload the snapshot (never shift indexes silently).
                self.store.append([rec])
                self.candles.append(rec)
                self.candles.sort(key=lambda r: r['open_ms'])
                index_of = {r['open_ms']: i for i, r in enumerate(self.candles)}
                inserted = True
            # older than the in-memory window or duplicate: ignore
        if inserted:
            self._recount_gaps()
            self._emit('history.reset', rows=len(self.candles), gaps=self.gaps, reason='late candle filled a gap')
        if partial != self.partial:
            self.partial = partial
            if partial is None:
                self._emit('candle.partial', closed=False, candle=None)
            else:
                self._candle_event('candle.partial', partial, len(self.candles), False)
        cap = int(self.mgr.rt['history_limit']) * MEMORY_FACTOR
        if len(self.candles) > cap:
            # Trimming re-indexes the window: announce it so the UI reloads the
            # snapshot and recomputes structure on the new window from scratch.
            self.candles = self.candles[-int(self.mgr.rt['history_limit']):]
            self._recount_gaps()
            self._emit('history.reset', rows=len(self.candles), gaps=self.gaps, reason='memory window trimmed')

    # ---- views ---------------------------------------------------------------
    def snapshot(self) -> dict:
        with self.lock:
            candles = [self.ui_candle(r, i) for i, r in enumerate(self.candles)]
            label = T.LABELS[self.tf]
            meta = {'source': f'{self.provider.name} {self.symbol}', 'rows': len(candles),
                    'volume_present': any(c['volume'] is not None for c in candles),
                    'timeframe': self.tf, 'timezone': 'UTC',
                    'interval_seconds': (T.FIXED_MS.get(self.tf, 0) // 1000), 'gaps': self.gaps,
                    'first_time': candles[0]['time'] if candles else None,
                    'last_time': candles[-1]['time'] if candles else None,
                    'provider': self.provider.id, 'venue': self.provider.venue, 'symbol': self.symbol,
                    'lineage_id': self.lineage_id, 'live': True}
            warnings = []
            if self.gaps:
                warnings.append(f'{self.gaps} gap(s): provider has no candle for some intervals; nothing was fabricated.')
            return {'candles': candles, 'meta': meta, 'warnings': warnings,
                    'dataset': {'id': 'live:' + self.id, 'name': f'{self.symbol} · {label} · {self.provider.name} · LIVE',
                                'filename': f'{self.provider.id}_{self.symbol}_{self.tf}', 'builtin': True, 'live': True},
                    'live': self.status_view()}

    def status_view(self) -> dict:
        with self.lock:
            return {'subscription_id': self.id, 'boot': BOOT_ID, 'lineage_id': self.lineage_id, 'status': self.status, 'detail': self.detail,
                    'provider': self.provider.id, 'symbol': self.symbol, 'timeframe': self.tf,
                    'bootstrapped': self.bootstrapped, 'closed_rows': len(self.candles), 'gaps': self.gaps,
                    'last_event_id': self.seq,
                    'partial': self.ui_candle(self.partial, len(self.candles)) if self.partial else None,
                    'listeners': len(self.listeners), 'autostart': self.autostart,
                    'storage': str(self.store.dir.relative_to(self.mgr.root)).replace('\\', '/')}

    # ---- worker ----------------------------------------------------------------
    def run(self) -> None:
        idle = float(self.mgr.rt['idle_release_minutes']) * 60
        while not self.stopped.is_set():
            try:
                if self.listeners:
                    self.last_listener_seen = time.monotonic()
                elif not self.autostart and time.monotonic() - self.last_listener_seen > idle:
                    self.mgr.release(self.id)
                    break
                wait = self.next_due - time.monotonic()
                if wait > 0:
                    self.stopped.wait(min(wait, 1.0))
                    continue
                self.step()
            except Exception as exc:   # last-resort guard: report and keep the worker alive
                self.next_due = time.monotonic() + 30
                try:
                    self._set_status('error', f'worker error: {type(exc).__name__}: {exc}')
                except Exception:
                    pass


class LiveManager:
    def __init__(self, cfg: dict, fetch=None, start_threads: bool = True):
        self.cfg = cfg
        self.rt = cfg['realtime']
        self.st = cfg['storage']
        self.root = C.data_dir(cfg)
        ensure_layout(self.root)
        self.fetch = fetch
        self.start_threads = start_threads
        self.series: dict[str, Series] = {}
        self.stores: dict[tuple, SeriesStore] = {}
        self.lock = threading.RLock()
        self.stopped = threading.Event()
        self.last_cleanup: list[str] = []

    def make_provider(self, provider_id: str):
        if provider_id not in PROVIDERS:
            raise ProviderError(f'Unknown provider {provider_id!r}', permanent=True)
        kwargs = {'timeout': float(self.rt['request_timeout_seconds'])}
        if self.fetch:
            kwargs['fetch'] = self.fetch
        return PROVIDERS[provider_id](**kwargs)

    def store_for(self, provider: str, symbol: str, tf: str) -> SeriesStore:
        """One store (one writer lock) per venue series folder."""
        with self.lock:
            key = (provider, symbol, tf)
            if key not in self.stores:
                self.stores[key] = SeriesStore(self.root, provider, symbol, tf)
            return self.stores[key]

    def allowed(self) -> list[str]:
        return list(REAL_PROVIDERS) + (['simulated'] if self.rt.get('simulator') else [])

    def providers(self) -> list[dict]:
        return [PROVIDERS[p]().capabilities() for p in self.allowed()]

    def subscribe(self, provider: str, symbol: str, tf: str, autostart: bool = False) -> Series:
        provider = provider or self.rt['default_provider']
        if provider not in self.allowed():
            raise ValueError(f'Unknown provider {provider!r}')
        symbol = PROVIDERS[provider]().check_symbol(symbol)
        T.check(tf)
        if tf not in PROVIDERS[provider].intervals:
            raise ValueError(f'{provider} does not offer {tf}')
        key = f'{provider}:{symbol}:{tf}'
        with self.lock:
            if key in self.series:
                s = self.series[key]
                s.autostart = s.autostart or autostart
                s.last_listener_seen = time.monotonic()
                return s
            if len(self.series) >= int(self.rt['max_subscriptions']):
                raise ValueError(f'Too many live subscriptions (max {self.rt["max_subscriptions"]})')
            s = Series(self, provider, symbol, tf, autostart)
            self.series[key] = s
        if self.start_threads:
            s.thread = threading.Thread(target=s.run, name=f'live-{key}', daemon=True)
            s.thread.start()
        return s

    def get(self, key: str) -> Series | None:
        return self.series.get(key)

    def release(self, key: str) -> None:
        with self.lock:
            s = self.series.pop(key, None)
        if s:
            s.stopped.set()
            s._set_status('offline', 'subscription released')

    def run_cleanup(self) -> list[Path]:
        deleted = cleanup(self.root, int(self.st['retention_days']), self.st.get('retention_days_by_timeframe'))
        self.last_cleanup = [str(p.relative_to(self.root)) for p in deleted]
        return deleted

    def _cleanup_loop(self) -> None:
        period = max(1.0, float(self.st['cleanup_interval_minutes'])) * 60
        while not self.stopped.is_set():
            try:
                self.run_cleanup()
            except OSError as exc:
                print('market_data cleanup failed:', exc, flush=True)
            self.stopped.wait(period)

    def start(self) -> None:
        if self.start_threads:
            threading.Thread(target=self._cleanup_loop, name='market-data-retention', daemon=True).start()
        for item in self.rt.get('autostart', []):
            for tf in item.get('timeframes', []):
                try:
                    self.subscribe(item.get('provider') or self.rt['default_provider'], item['symbol'], tf, autostart=True)
                except (ValueError, ProviderError) as exc:
                    print('autostart skipped:', item, tf, exc, flush=True)

    def stop(self) -> None:
        self.stopped.set()
        for key in list(self.series):
            self.release(key)

    def public_config(self) -> dict:
        return {'enabled': True, 'default_provider': self.rt['default_provider'],
                'fallback_providers': self.rt.get('fallback_providers', []),
                'providers': self.providers(), 'timeframes': [{'id': tf, 'label': T.LABELS[tf]} for tf in T.TIMEFRAMES],
                'autostart': self.rt.get('autostart', []), 'poll_seconds': self.rt['poll_seconds'],
                'storage': {'data_dir': str(self.root), 'retention_days': self.st['retention_days'],
                            'retention_days_by_timeframe': self.st.get('retention_days_by_timeframe', {})},
                'series': [s.status_view() for s in list(self.series.values())]}
