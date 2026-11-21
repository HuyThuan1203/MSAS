"""Provider adapters: transport + parsing only (no engine access).

Closed-candle rule: a candle is CLOSED only when the provider's own server
clock is at or past the candle's exclusive end. Local clocks are never used to
finalize a candle. Hosts are fixed per adapter; only an allow-listed symbol
pattern is interpolated into the query (no user-supplied URLs).
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable

from . import timeframes as T

SYMBOL = re.compile(r'^[A-Z0-9]{2,20}$')


class ProviderError(Exception):
    """``permanent`` = entitlement/region/symbol problem: retrying the same
    provider will not help, so the manager may fall back immediately."""

    def __init__(self, message: str, permanent: bool = False, status: int | None = None):
        super().__init__(message)
        self.permanent = permanent
        self.status = status


@dataclass(frozen=True)
class Bar:
    open_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float | None
    closed: bool


def http_get_json(url: str, timeout: float) -> object:
    req = urllib.request.Request(url, headers={'User-Agent': 'msas-market-gateway/1.0', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        # 429/418 rate limit and 5xx are transient; other 4xx (incl. 451
        # restricted region, 400 bad symbol) are permanent for this provider.
        transient = exc.code in (418, 429) or exc.code >= 500
        raise ProviderError(f'HTTP {exc.code} from {urllib.parse.urlsplit(url).netloc}', permanent=not transient, status=exc.code) from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise ProviderError(f'Network error: {exc}') from None


class Provider:
    id = ''
    name = ''
    venue = ''
    base = ''
    intervals: dict[str, str] = {}
    max_limit = 1000

    def __init__(self, fetch: Callable[[str, float], object] = http_get_json, timeout: float = 10):
        self.fetch = fetch
        self.timeout = timeout

    def capabilities(self) -> dict:
        return {'id': self.id, 'name': self.name, 'venue': self.venue, 'asset_class': 'crypto_spot',
                'price_basis': 'last_trade', 'volume_kind': 'base_asset_traded', 'calendar': 'crypto_24_7',
                'timeframes': [tf for tf in T.TIMEFRAMES if tf in self.intervals], 'required_secrets': []}

    def _get(self, path: str, params: dict) -> object:
        return self.fetch(self.base + path + '?' + urllib.parse.urlencode(params), self.timeout)

    def check_symbol(self, symbol: str) -> str:
        symbol = str(symbol).upper()
        if not SYMBOL.fullmatch(symbol):
            raise ProviderError(f'Invalid symbol {symbol!r}', permanent=True)
        return symbol

    def server_time_ms(self) -> int:
        raise NotImplementedError

    def klines(self, symbol: str, tf: str, limit: int, start_ms: int | None = None,
               now_ms: int | None = None) -> list[Bar]:
        """Bars ascending. ``closed`` is decided with a provider clock sampled
        BEFORE the bars were fetched (``now_ms``, else fetched first): a later
        clock must never finalize an earlier, possibly partial snapshot."""
        raise NotImplementedError

    @staticmethod
    def _parse(rows, tf: str, now: int) -> list[Bar]:
        try:
            bars = [Bar(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]),
                        now >= T.end_ms(tf, int(r[0]))) for r in rows]
        except (TypeError, ValueError, IndexError, KeyError) as exc:
            raise ProviderError(f'Malformed kline payload: {exc}') from None
        return sorted(bars, key=lambda b: b.open_ms)


class BinanceSpot(Provider):
    id, name, venue, base = 'binance', 'Binance Spot', 'BINANCE', 'https://api.binance.com'
    intervals = {'M1': '1m', 'M3': '3m', 'M5': '5m', 'M15': '15m', 'M30': '30m', 'H1': '1h', 'H2': '2h',
                 'H4': '4h', 'H6': '6h', 'H12': '12h', 'D1': '1d', 'W1': '1w', 'MN1': '1M'}

    def server_time_ms(self) -> int:
        try:
            return int(self._get('/api/v3/time', {})['serverTime'])
        except (TypeError, KeyError, ValueError) as exc:
            raise ProviderError(f'Malformed time payload: {exc}') from None

    def klines(self, symbol, tf, limit, start_ms=None, now_ms=None):
        params = {'symbol': self.check_symbol(symbol), 'interval': self.intervals[T.check(tf)],
                  'limit': max(1, min(self.max_limit, int(limit)))}
        if start_ms is not None:
            params['startTime'] = int(start_ms)   # oldest-first from startTime
        now = self.server_time_ms() if now_ms is None else int(now_ms)
        rows = self._get('/api/v3/klines', params)
        # [openTime, open, high, low, close, volume, closeTime, ...]
        return self._parse(rows if isinstance(rows, list) else None, tf, now)


class BybitSpot(Provider):
    id, name, venue, base = 'bybit', 'Bybit Spot', 'BYBIT', 'https://api.bybit.com'
    intervals = {'M1': '1', 'M3': '3', 'M5': '5', 'M15': '15', 'M30': '30', 'H1': '60', 'H2': '120',
                 'H4': '240', 'H6': '360', 'H12': '720', 'D1': 'D', 'W1': 'W', 'MN1': 'M'}

    def _check(self, body):
        if not isinstance(body, dict) or body.get('retCode') != 0:
            msg = body.get('retMsg') if isinstance(body, dict) else 'bad payload'
            raise ProviderError(f'Bybit error: {msg}', permanent=True)
        return body

    def server_time_ms(self) -> int:
        body = self._check(self._get('/v5/market/time', {}))
        try:
            return int(body.get('time') or int(body['result']['timeNano']) // 1_000_000)
        except (TypeError, KeyError, ValueError) as exc:
            raise ProviderError(f'Malformed time payload: {exc}') from None

    def klines(self, symbol, tf, limit, start_ms=None, now_ms=None):
        params = {'category': 'spot', 'symbol': self.check_symbol(symbol), 'interval': self.intervals[T.check(tf)],
                  'limit': max(1, min(self.max_limit, int(limit)))}
        if start_ms is not None:
            # Bybit returns the NEWEST `limit` bars inside [start, end]; bound the
            # window so a gap backfill gets the bars right after `start`.
            params['start'] = int(start_ms)
            if tf in T.FIXED_MS:
                params['end'] = int(start_ms) + params['limit'] * T.FIXED_MS[tf] - 1
        now = self.server_time_ms() if now_ms is None else int(now_ms)
        body = self._check(self._get('/v5/market/kline', params))
        # result.list: [startTime, open, high, low, close, volume, turnover], newest FIRST
        return self._parse((body.get('result') or {}).get('list'), tf, now)


class SimulatedFeed(Provider):
    """Offline test feed: deterministic SYNTHETIC candles with an accelerated
    server clock (``speed`` x real time). Not market data; only offered when
    realtime.simulator is true. Used to exercise the live UI without network."""
    id, name, venue, base = 'simulated', 'Simulated feed (synthetic, offline test)', 'SIM', 'sim://'
    intervals = {tf: tf for tf in ('M1', 'M5', 'M15')}
    speed = 30.0
    _epoch_real = None
    _epoch_server = None

    def capabilities(self) -> dict:
        cap = super().capabilities()
        cap.update(asset_class='synthetic', price_basis='synthetic', synthetic=True)
        return cap

    def server_time_ms(self) -> int:
        import time as _t
        cls = SimulatedFeed
        if cls._epoch_real is None:
            cls._epoch_real = _t.time()
            cls._epoch_server = int(cls._epoch_real * 1000) - 600 * 60_000  # 600 minutes of history
        return int(cls._epoch_server + (_t.time() - cls._epoch_real) * 1000 * self.speed)

    @staticmethod
    def _ohlc(open_ms: int, tf: str) -> tuple:
        import random as _r
        step = T.FIXED_MS[tf]
        n = open_ms // step
        rng = _r.Random(n * 7919 + len(tf))
        price = 100 + 8 * __import__('math').sin(n / 37) + 3 * __import__('math').sin(n / 7.3)
        o = round(price + rng.uniform(-0.6, 0.6), 2)
        c = round(price + rng.uniform(-1.4, 1.4), 2)
        h = round(max(o, c) + rng.uniform(0, 1.2), 2)
        l = round(min(o, c) - rng.uniform(0, 1.2), 2)
        return o, h, l, c, round(rng.uniform(1, 9), 3)

    def klines(self, symbol, tf, limit, start_ms=None, now_ms=None):
        self.check_symbol(symbol)
        now = self.server_time_ms() if now_ms is None else int(now_ms)
        step = T.FIXED_MS[T.check(tf)]
        cur = now // step * step
        opens = [cur - i * step for i in range(int(limit) - 1, -1, -1)]
        if start_ms is not None:
            first = -(-int(start_ms) // step) * step
            opens = [t for t in range(first, cur + step, step)][:int(limit)]
        bars = []
        for t in opens:
            o, h, l, c, v = self._ohlc(t, tf)
            closed = now >= T.end_ms(tf, t)
            if not closed:  # reveal the forming candle progressively, never its final values early
                f = (now - t) / step
                c = round(o + (c - o) * f, 2)
                h, l = max(o, c, o + (h - max(o, c)) * f), min(o, c, o - (min(o, c) - l) * f)
                v = round(v * f, 3)
            bars.append(Bar(t, o, h, l, c, v, closed))
        return bars


PROVIDERS = {cls.id: cls for cls in (BinanceSpot, BybitSpot, SimulatedFeed)}
REAL_PROVIDERS = ('binance', 'bybit')
