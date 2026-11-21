"""Regressions for the independent review of the live gateway (2026-11-21).

Each test reproduces a reviewer trace that broke an invariant before the fix.
Offline only (fake exchange from test_live_gateway).
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_live_gateway import FakeExchange, M1, T0, drain, manager  # noqa: E402
from market_gateway import timeframes as T  # noqa: E402
from market_gateway.adapters import BinanceSpot  # noqa: E402
from market_gateway.store import cleanup  # noqa: E402


class ClockMovesDuringFetch(FakeExchange):
    """Server time is sampled, then the market moves past the candle end
    before the kline payload is produced (reviewer P0 trace)."""

    def __call__(self, url, timeout):
        out = super().__call__(url, timeout)
        if '/time' in url:
            self.now += 5          # 5 ms later the kline request is served
        return out


class TestReviewFindings(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fx = FakeExchange()
        for i in range(10):
            self.fx.add(i, 100 + i, 101 + i, 99 + i, 100.5 + i)
        self.fx.now = T0 + 9 * M1 + 20_000

    def tearDown(self):
        self.tmp.cleanup()

    def test_p0_clock_sampled_before_data(self):
        fx = ClockMovesDuringFetch()
        for i in range(3):
            fx.add(i, 10, 11, 9, 10.5)
        fx.now = T0 + 3 * M1 - 1          # 1 ms before candle 2 closes
        bars = BinanceSpot(fetch=fx).klines('BTCUSDT', 'M1', 10)
        self.assertFalse(bars[-1].closed, 'a later clock must not finalize an earlier snapshot')

    def test_p1_monthly_backfill_uses_cursor(self):
        fx = FakeExchange()
        months = [int(datetime(2026, m, 1, tzinfo=timezone.utc).timestamp() * 1000) for m in range(1, 13)]
        for i, ms in enumerate(months[:7]):
            fx.candles[ms] = (100 + i, 101 + i, 99 + i, 100.5 + i, 1.0)
        fx.now = months[3] + 1              # Jan..Mar closed, Apr forming
        m = manager(self.tmp.name, fx)
        s = m.subscribe('binance', 'BTCUSDT', 'MN1')
        s.step()
        self.assertEqual(len(s.candles), 3)
        fx.now = months[6] + 1              # back in July: Apr, May, Jun closed
        q = s.listen(None).queue
        s.step()
        got = [e['candle']['time'][:7] for e in drain(q) if e['type'] == 'candle.closed']
        self.assertEqual(got, ['2026-04', '2026-05', '2026-06'])
        self.assertEqual(s.gaps, 0)

    def test_p1_late_gap_fill_forces_reset(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        hidden = self.fx.candles.pop(T0 + 7 * M1)
        s.step()
        self.assertEqual(s.gaps, 1)
        q = s.listen(None).queue
        self.fx.candles[T0 + 7 * M1] = hidden
        s.step()
        types = [e['type'] for e in drain(q)]
        self.assertIn('history.reset', types)
        self.assertEqual(s.gaps, 0)
        self.assertEqual(len(s.candles), 9)

    def test_p1_correction_deep_in_window(self):
        for i in range(10, 80):
            self.fx.add(i, 100, 101, 99, 100.5)
        self.fx.now = T0 + 79 * M1 + 1
        m = manager(self.tmp.name, self.fx, history_limit=100)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        s.step()
        q = s.listen(None).queue
        # correction of the candle 70 positions back is returned by a full re-read
        self.fx.candles[T0 + 5 * M1] = (105, 120, 104, 106, 3.0)
        s.provider.klines(s.symbol, s.tf, 100)          # warm path unchanged
        bars = s.provider.klines(s.symbol, s.tf, 100, now_ms=self.fx.now)
        with s.lock:
            s._apply(bars)
        corr = [e for e in drain(q) if e['type'] == 'candle.corrected']
        self.assertEqual(len(corr), 1)
        self.assertEqual(corr[0]['candle']['index'], 5)

    def test_p1_replay_from_snapshot_cursor(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        s.step()
        snap = s.snapshot()
        cursor = snap['live']['last_event_id']
        self.fx.now = T0 + 10 * M1 + 1                    # closes while no client listens
        s.step()
        lst = s.listen(cursor)                           # client connects afterwards
        closed = [e for e in drain(lst.queue) if e['type'] == 'candle.closed']
        self.assertEqual([e['candle']['index'] for e in closed], [len(snap['candles'])])

    def test_p1_unreplayable_cursor_and_overflow_force_resync(self):
        import market_gateway.manager as M
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        s.step()
        self.assertTrue(s.listen(s.seq + 50).overflow, 'cursor of a previous server process must force a resync')
        s.ring.clear()
        self.assertTrue(s.listen(0).overflow, 'cursor older than the ring must force a resync')
        lst = s.listen(None)
        old = M.QUEUE_SIZE
        try:
            for _ in range(lst.queue.maxsize + 1):
                s._emit('feed.status', status='live', detail='x')
        finally:
            M.QUEUE_SIZE = old
        self.assertTrue(lst.overflow, 'a full queue must never drop events silently')

    def test_p1_listener_limit_and_released_series(self):
        import market_gateway.manager as M
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        for _ in range(M.MAX_LISTENERS):
            s.listen(None)
        with self.assertRaises(OverflowError):
            s.listen(None)
        m.release(s.id)
        with self.assertRaises(KeyError):
            s.listen(None)

    def test_p1_fallback_shares_store_with_native_subscription(self):
        m = manager(self.tmp.name, self.fx, fallback_after_failures=1)
        native = m.subscribe('bybit', 'BTCUSDT', 'M1')
        native.step()
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        self.fx.down['api.binance.com'] = 0
        s.step()                                         # falls back to bybit
        del self.fx.down['api.binance.com']
        s.step()
        self.assertIs(s.store, native.store, 'one writer per venue folder')
        files = list((m.root / 'live' / 'bybit' / 'BTCUSDT' / 'M1').glob('*.csv'))
        rows = sum(len(f.read_text().splitlines()) - 1 for f in files)
        self.assertEqual(rows, 9, 'no duplicate rows from two subscriptions')

    def test_stored_rows_not_closed_by_provider_clock_are_dropped(self):
        m = manager(self.tmp.name, self.fx)
        future = {'open_ms': T0 + 30 * M1, 'open': 1.0, 'high': 2.0, 'low': 0.5, 'close': 1.5, 'volume': 1.0, 'revision': 1}
        m.store_for('binance', 'BTCUSDT', 'M1').append([future])
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        s.step()
        self.assertEqual(s.candles[-1]['open_ms'], T0 + 8 * M1, 'a stored candle from the provider future must not be analysed')

    def test_p2_partial_cleared(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        s.step()
        self.assertIsNotNone(s.partial)
        q = s.listen(None).queue
        self.fx.now = T0 + 10 * M1 + 1                    # candle 9 closed, no newer candle exists
        s.step()
        self.assertIsNone(s.partial)
        self.assertTrue(any(e['type'] == 'candle.partial' and e['candle'] is None for e in drain(q)))

    def test_p2_unique_lineage_on_fast_fallbacks(self):
        m = manager(self.tmp.name, self.fx)
        s = m.subscribe('binance', 'BTCUSDT', 'M1')
        seen = set()
        for _ in range(4):
            s._fallback('test')
            seen.add(s.lineage_id)
        self.assertEqual(len(seen), 4)


class TestRetentionLinks(unittest.TestCase):
    def _link(self, link: Path, target: Path) -> bool:
        try:
            os.symlink(target, link, target_is_directory=True)
            return True
        except (OSError, NotImplementedError):
            pass
        if os.name == 'nt':   # junction needs no privilege
            r = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(target)], capture_output=True)
            return r.returncode == 0
        return False

    def test_p0_cleanup_never_follows_links_outside(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, outside = Path(tmp) / 'md', Path(tmp) / 'outside'
            (root / 'live' / 'binance' / 'BTCUSDT').mkdir(parents=True)
            outside.mkdir()
            old = (datetime(2026, 11, 21, tzinfo=timezone.utc) - timedelta(days=90)).strftime('%Y-%m-%d') + '.csv'
            victim = outside / old
            victim.write_text('do not delete')
            if not self._link(root / 'live' / 'binance' / 'BTCUSDT' / 'M1', outside):
                self.skipTest('cannot create a symlink or junction here')
            deleted = cleanup(root, 30, now=datetime(2026, 11, 21, tzinfo=timezone.utc).timestamp())
            self.assertEqual(deleted, [])
            self.assertTrue(victim.exists(), 'retention deleted a file outside market_data/live')


if __name__ == '__main__':
    unittest.main()
