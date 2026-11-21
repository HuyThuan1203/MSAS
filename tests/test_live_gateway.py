"""Offline tests for the optional live gateway (no network).

A FakeExchange answers Binance/Bybit REST URLs with documented payload shapes
and a controllable SERVER clock, so closed-candle finalization, dedupe, gap
backfill, corrections, fallback lineage and retention are exercised
deterministically. Real provider behaviour still needs a live run (see
scripts/live_causal_check.js); these tests do not claim it.
"""
from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from market_gateway import config as C  # noqa: E402
from market_gateway import timeframes as T  # noqa: E402
from market_gateway.adapters import BinanceSpot, BybitSpot, ProviderError  # noqa: E402
from market_gateway.manager import LiveManager  # noqa: E402
from market_gateway.store import SeriesStore, cleanup  # noqa: E402

M1 = T.FIXED_MS['M1']
T0 = int(datetime(2026, 11, 21, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)


class FakeExchange:
    """candles: {open_ms: (o,h,l,c,v)}; now: server ms; down: set of hosts failing."""

    def __init__(self):
        self.candles: dict[int, tuple] = {}
        self.now = T0
        self.down: dict[str, int] = {}   # host -> HTTP status (0 = network error)
        self.calls: list[str] = []

    def add(self, i, o, h, l, c, v=1.0):
        self.candles[T0 + i * M1] = (o, h, l, c, v)

    def __call__(self, url, timeout):
        self.calls.append(url)
        u = urllib.parse.urlsplit(url)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.netloc in self.down:
            raise ProviderError('down', permanent=self.down[u.netloc] in (451, 400), status=self.down[u.netloc] or None)
        visible = sorted(k for k in self.candles if k <= self.now)   # nothing from the future
        if u.path == '/api/v3/time':
            return {'serverTime': self.now}
        if u.path == '/v5/market/time':
            return {'retCode': 0, 'result': {'timeNano': str(self.now * 1_000_000)}, 'time': self.now}
        start = int(q.get('startTime') or q.get('start') or 0)
        rows = [k for k in visible if k >= start][-int(q['limit']):] if not start else [k for k in visible if k >= start][:int(q['limit'])]
        if u.path == '/api/v3/klines':
            return [[k, *map(str, self.candles[k][:4]), str(self.candles[k][4]), k + M1 - 1, '0', 1, '0', '0', '0'] for k in rows]
        if u.path == '/v5/market/kline':
            return {'retCode': 0, 'result': {'list': [[str(k), *map(str, self.candles[k])] for k in reversed(rows)]}}
        raise AssertionError(url)


def manager(tmp, fake, **rt):
    cfg = C.load(Path(tmp) / 'none.json', {'realtime': {'enabled': True, 'autostart': [], 'history_limit': 50, **rt},
                                          'storage': {'data_dir': str(Path(tmp) / 'md')}}, env={})
    return LiveManager(cfg, fetch=fake, start_threads=False)


def drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


class TestAdapters(unittest.TestCase):
    def test_binance_closed_uses_server_clock(self):
        fx = FakeExchange()
        for i in range(3):
            fx.add(i, 10, 11, 9, 10.5)
        fx.now = T0 + 2 * M1 + 30_000          # candle 2 is still forming
        bars = BinanceSpot(fetch=fx).klines('BTCUSDT', 'M1', 10)
        self.assertEqual([b.closed for b in bars], [True, True, False])
        fx.now = T0 + 3 * M1                   # exactly at the end -> closed
        self.assertTrue(BinanceSpot(fetch=fx).klines('BTCUSDT', 'M1', 10)[-1].closed)

    def test_bybit_desc_order_and_closed(self):
        fx = FakeExchange()
        for i in range(3):
            fx.add(i, 10 + i, 11 + i, 9 + i, 10.5 + i)
        fx.now = T0 + 2 * M1 + 1
        bars = BybitSpot(fetch=fx).klines('BTCUSDT', 'M1', 10)
        self.assertEqual([b.open_ms for b in bars], [T0, T0 + M1, T0 + 2 * M1])
        self.assertEqual([b.closed for b in bars], [True, True, False])

    def test_symbol_allowlist(self):
        with self.assertRaises(ProviderError):
            BinanceSpot(fetch=FakeExchange()).klines('BTC/USDT&x=1', 'M1', 5)

    def test_month_boundary(self):
        jan = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
        self.assertEqual(T.iso(T.end_ms('MN1', jan)), '2026-02-01 00:00:00+00:00')


class TestManager(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fx = FakeExchange()
        for i in range(10):
            self.fx.add(i, 100 + i, 101 + i, 99 + i, 100.5 + i)
        self.fx.now = T0 + 9 * M1 + 20_000     # 9 closed candles, #9 forming

    def tearDown(self):
        self.tmp.cleanup()

    def test_partial_is_chart_only_and_close_emitted_once(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        q = s.listen(None).queue
        s.step()
        self.assertEqual(len(s.candles), 9)
        self.assertEqual(s.partial['open_ms'], T0 + 9 * M1)
        snap = s.snapshot()
        self.assertEqual(len(snap['candles']), 9, 'partial candle must not be in the closed array')
        self.assertEqual(snap['candles'][-1]['time'], T.iso(T0 + 8 * M1))
        self.fx.candles[T0 + 9 * M1] = (109, 112, 108, 111, 1.0)   # partial updates
        s.step()
        self.fx.now = T0 + 10 * M1 + 1                             # candle 9 closes
        s.step(); s.step()                                          # duplicate poll
        evs = drain(q)
        closed = [e for e in evs if e['type'] == 'candle.closed']
        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0]['candle']['index'], 9)
        self.assertEqual(closed[0]['candle']['high'], 112)
        self.assertTrue(any(e['type'] == 'candle.partial' for e in evs))
        ids = [e['id'] for e in evs]
        self.assertEqual(ids, sorted(ids), 'event ids are monotonic')

    def test_disconnect_backfills_missed_closes_in_order(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1'); q = s.listen(None).queue
        s.step()
        self.fx.down['api.binance.com'] = 0
        s.step()
        self.assertEqual(s.status, 'reconnecting')
        for i in range(10, 14):
            self.fx.add(i, 120, 121, 119, 120.5)
        self.fx.now = T0 + 14 * M1 + 5
        del self.fx.down['api.binance.com']
        s.step()
        got = [e['candle']['index'] for e in drain(q) if e['type'] == 'candle.closed']
        self.assertEqual(got, [9, 10, 11, 12, 13])
        self.assertEqual(s.status, 'live')
        self.assertEqual(s.gaps, 0)

    def test_provider_gap_is_reported_not_fabricated(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1'); q = s.listen(None).queue
        s.step()
        self.fx.add(11, 130, 131, 129, 130.5)                       # minute 10 never exists
        del self.fx.candles[T0 + 9 * M1]
        self.fx.now = T0 + 12 * M1
        s.step()
        evs = drain(q)
        self.assertTrue(any(e['type'] == 'gap.detected' for e in evs))
        self.assertEqual([c['open_ms'] for c in s.candles[-2:]], [T0 + 8 * M1, T0 + 11 * M1])

    def test_correction_is_a_new_revision(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1'); q = s.listen(None).queue
        s.step()
        self.fx.candles[T0 + 8 * M1] = (108, 115, 107, 109, 2.0)
        s.step()
        corr = [e for e in drain(q) if e['type'] == 'candle.corrected']
        self.assertEqual(len(corr), 1)
        self.assertEqual(corr[0]['revision'], 2)
        rows = SeriesStore(m.root, 'binance', 'BTCUSDT', 'M1').load(100)
        self.assertEqual(rows[-1]['high'], 115)
        self.assertEqual(rows[-1]['revision'], 2)

    def test_fallback_creates_new_lineage_and_fresh_history(self):
        m = manager(self.tmp.name, self.fx, fallback_after_failures=2)
        s = m.subscribe('binance', 'BTCUSDT', 'M1'); q = s.listen(None).queue
        s.step()
        old = s.lineage_id
        self.fx.down['api.binance.com'] = 0
        s.step(); s.step()                                           # 2 failures -> fallback
        evs = drain(q)
        changed = [e for e in evs if e['type'] == 'source.changed']
        self.assertEqual(len(changed), 1)
        self.assertEqual(changed[0]['previous_lineage'], old)
        self.assertNotEqual(s.lineage_id, old)
        self.assertEqual(s.provider.id, 'bybit')
        self.assertEqual(s.candles, [], 'Binance candles must not be carried into the Bybit series')
        s.step()
        self.assertEqual(len(s.candles), 9)
        self.assertTrue((m.root / 'live' / 'bybit' / 'BTCUSDT' / 'M1').is_dir())
        self.assertIn('history.reset', [e['type'] for e in drain(q)])

    def test_permanent_error_falls_back_immediately(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        self.fx.down['api.binance.com'] = 451                        # restricted region
        s.step()
        self.assertEqual(s.provider.id, 'bybit')

    def test_malformed_payload_does_not_kill_worker(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        good = self.fx
        s.provider.fetch = lambda url, timeout: [['bad']] if 'klines' in url else good(url, timeout)
        s.step()
        self.assertEqual(s.status, 'error')
        self.assertEqual(s.failures, 1)
        s.provider.fetch = good
        s.next_due = 0
        s.step()
        self.assertEqual(s.status, 'live')

    def test_restart_reuses_stored_candles(self):
        m = manager(self.tmp.name, self.fx)
        m.subscribe('binance', 'BTCUSDT', 'M1').step()
        m2 = manager(self.tmp.name, self.fx)
        s2 = m2.subscribe('binance', 'BTCUSDT', 'M1'); s2.step()
        self.assertEqual(len(s2.candles), 9)
        files = list((m2.root / 'live' / 'binance' / 'BTCUSDT' / 'M1').glob('*.csv'))
        lines = sum(len(f.read_text().splitlines()) - 1 for f in files)
        self.assertEqual(lines, 9, 'restart must not duplicate stored rows')

    def test_subscription_validation(self):
        m = manager(self.tmp.name, self.fx, max_subscriptions=1)
        with self.assertRaises(ValueError):
            m.subscribe('nope', 'BTCUSDT', 'M1')
        with self.assertRaises(ValueError):
            m.subscribe('binance', 'BTCUSDT', 'M7')
        m.subscribe('binance', 'BTCUSDT', 'M1')
        with self.assertRaises(ValueError):
            m.subscribe('binance', 'ETHUSDT', 'M1')


class TestRetentionAndConfig(unittest.TestCase):
    def test_retention_deletes_only_old_day_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            m1 = root / 'live' / 'binance' / 'BTCUSDT' / 'M1'
            d1 = root / 'live' / 'binance' / 'BTCUSDT' / 'D1'
            for d in (m1, d1):
                d.mkdir(parents=True)
            now = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)
            for back in (0, 29, 30, 31, 45):
                name = (now - timedelta(days=back)).strftime('%Y-%m-%d') + '.csv'
                (m1 / name).write_text('x')
                (d1 / name).write_text('x')
            (m1 / 'series.json').write_text('{}')
            (m1 / 'notes.txt').write_text('keep me')
            deleted = cleanup(root, 30, {'D1': 3650}, now=now.timestamp())
            left = sorted(p.name for p in m1.iterdir())
            self.assertEqual(len(deleted), 2)                       # day 31 and 45 only
            self.assertIn((now - timedelta(days=30)).strftime('%Y-%m-%d') + '.csv', left)
            self.assertIn('notes.txt', left)
            self.assertEqual(len(list(d1.glob('*.csv'))), 5, 'D1 override keeps 10 years')

    def test_realtime_flag_and_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / 'c.json'
            f.write_text(json.dumps({'realtime': {'enabled': True}}))
            self.assertTrue(C.load(f, env={})['realtime']['enabled'])
            self.assertFalse(C.load(f, env={'MSAS_REALTIME': 'false'})['realtime']['enabled'])
            self.assertFalse(C.load(f, {'realtime': {'enabled': False}}, env={})['realtime']['enabled'])
            self.assertFalse(C.load(Path(tmp) / 'missing.json', env={})['realtime']['enabled'], 'default OFF')
            with self.assertRaises(ValueError):
                C.load(f, {'storage': {'retention_days': 0}}, env={})

    def test_server_reports_disabled_without_network(self):
        import threading
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer
        sys.path.insert(0, str(ROOT / 'app'))
        import server
        self.assertIsNone(server.LIVE)
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{httpd.server_address[1]}'
        try:
            with urllib.request.urlopen(base + '/api/live/config', timeout=5) as r:
                self.assertFalse(json.loads(r.read())['enabled'])
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(base + '/api/live/history?subscription_id=x', timeout=5)
            self.assertEqual(ctx.exception.code, 503)
            with urllib.request.urlopen(base + '/api/health', timeout=5) as r:
                self.assertFalse(json.loads(r.read())['realtime'])
        finally:
            httpd.shutdown(); httpd.server_close()


if __name__ == '__main__':
    unittest.main()
