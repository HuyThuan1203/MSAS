# MSAS real-time gateway — G0–G2 (crypto spot: Binance, Bybit)

Implements stages G0–G2 of `MSAS_MULTIMARKET_REALTIME_ARCHITECTURE.md` (design
handoff of 2026-11-21) with the least invasive integration. Status per item at
the end. FX/XAU, US and Vietnam equities (G3–G5) are **not** implemented.

## Run

```text
python build.py                    # once per clone: config, data folder, offline HTML, self-test
python run.py                      # web UI + live data (per msas.config.json)
python run.py --realtime false     # replay / import only, no network at all
python run.py --port 9000 --data-dir D:/msas_data --retention-days 14 --no-browser
```

Precedence: flags > environment (`MSAS_REALTIME`, `MSAS_DATA_DIR`, `HOST`,
`PORT`) > `msas.config.json` > defaults. Without a config file real-time is
**off** (CI, Docker and `python app/server.py` never touch the network unless
told to). `msas.config.json` is git-ignored; `msas.config.example.json` is the
documented template.

## Data folder (`storage.data_dir`, default `<repo>/market_data`)

```text
market_data/
  README.md
  uploads/                                   files imported with "+ Import"
  live/<provider>/<SYMBOL>/<TF>/
      series.json                            source identity, lineage, closed rule
      YYYY-MM-DD.csv                         CLOSED candles opened that UTC day
```

* Append-only rows: `open_time_utc, open_ms, open, high, low, close, volume,
  revision, received_at_utc`. A provider correction is a new row with
  `revision+1`; the last revision wins on load. Nothing is rewritten.
* Retention: day files older than `retention_days` (default 30; per timeframe
  `retention_days_by_timeframe`, default 3650 for D1/W1/MN1) are deleted at
  start-up and every `cleanup_interval_minutes`. Only files named exactly
  `YYYY-MM-DD.csv` below `live/` are deleted; empty folders are removed with
  `rmdir` (never recursive). Uploads are never auto-deleted.
* Separate providers are separate folders: a fallback never appends Bybit
  candles to a Binance series.

## Closed-candle rule (no lookahead)

A candle is **closed** only when the *provider's own server clock*
(`/api/v3/time`, `/v5/market/time`) is at or past the candle's exclusive end.
The local clock only sizes backfill requests. Only closed candles reach the
browser's candle array and therefore the unchanged engines; the forming candle
is sent as `candle.partial` and drawn as an outlined "LIVE" ghost.

Transport is REST polling (`realtime.poll_seconds`, default 2 s) with the Python
standard library — no WebSocket client dependency. Latency for a new closed
candle is therefore ≤ poll interval + request time.

## Timeframes

`M1 M3 M5 M15 M30 H1 H2 H4 H6 H12 D1 W1 MN1` (1m … 1 day = "24h", 1 week,
1 month). Daily/weekly/monthly candles follow the exchange's UTC alignment
(weeks open Monday 00:00 UTC, months on day 1).

## Recovery and fallback (section 9 of the design)

| Layer | Trigger | Action | New lineage? |
|---|---|---|---|
| L0 | transient error (network, 5xx, 429) | exponential backoff 2..60 s with jitter, status RECONNECTING | no |
| L1 | closes missed while disconnected | same-provider REST backfill, replayed in order, page by page | no |
| — | provider has no candle for an interval | `gap.detected`, status GAP, nothing fabricated | no |
| L3 | `fallback_after_failures` errors, or a permanent error (e.g. HTTP 451 region block, bad symbol) | next provider in `default_provider + fallback_providers`; fresh history; `source.changed` | **yes** |

A series never falls back to the synthetic `simulated` provider.

## HTTP API (added; existing routes unchanged)

| Method / path | Purpose |
|---|---|
| `GET /api/live/config` | `{enabled:false}` when off; providers, timeframes, storage, series |
| `POST /api/live/subscriptions` | body `{provider, symbol, timeframe}` → status view (idempotent) |
| `GET /api/live/history?subscription_id=` | closed candles in the importer payload shape + `live` block |
| `GET /api/live/events?subscription_id=&after=` | SSE from a cursor (`after` = snapshot `last_event_id`; browser reconnects send `Last-Event-ID`). Missed events are replayed from a 5,000-event ring; if not replayable, or the cursor belongs to another server process, a `resync` event is sent. Types: `feed.status`, `history.reset`, `candle.partial`, `candle.closed`, `candle.corrected`, `gap.detected`, `source.changed`, `resync`. Max 20 listeners per series. |
| `GET /api/live/status?subscription_id=` | health, lineage, rows, gaps, partial, storage path |
| `DELETE /api/live/subscriptions/{id}` | release (autostart series are config-managed) |

Events carry `event_schema: "msas.live.v1"`, a monotonic `id`, the server
process `boot` id, `lineage_id`, source identity and UTC candle open/end
timestamps. The browser discards events whose `boot` or `lineage_id` differs
from its snapshot and reloads instead; every open/resync has a generation
number so late responses of an earlier request are ignored.

Independent review (Codex, 2026-11-21) found 2 P0 + 8 P1 issues in the first
version (clock sampled after the data, retention following links, snapshot→SSE
loss, silent queue overflow, MN1/local-clock backfill, late gap fills, worker
death on unexpected errors, SSE listener leaks, two writers on one folder);
all are fixed and pinned by `tests/test_live_gateway_review.py`. Two earlier
review suggestions on MSS labels were rejected because they contradict
`MSS_CISD_RULEBOOK.md`.

## UI

The DATA selector gets a "Live market data" group (configured series), and a
compact bar: provider, symbol, timeframe, **Open live**, status pill
(LIVE / BACKFILLING / RECONNECTING / SOURCE CHANGED / GAP / OFFLINE / ERROR).
When the server runs with real-time on, the first configured series opens
automatically; samples and imports remain available for logic testing.
Scrubbing back in history works while live; double-click returns to follow mode.
Analyses of earlier candles are cached and never recomputed when a new candle
arrives — the past cannot change.

## Testing ("no god view")

* `tests/test_live_gateway.py` — offline fake exchange: closed vs partial by
  server clock, duplicate polls, disconnect backfill, provider gap, correction
  revision, fallback lineage, permanent-error fallback, restart dedupe,
  retention, config precedence, disabled API.
* `scripts/live_causal_check.js <series dir>` — replays stored real candles one
  by one and fails if anything at bar *t* depends on later candles.
  `tests/test_stream_causal.js` runs it on the 4 bundled real datasets and on a
  negative fixture (the old repaint bug) that must be detected.
* `realtime.simulator: true` adds a synthetic accelerated feed for UI checks
  without network. It is labelled SIMULATED FEED and is not market data.

## Status of this delivery

| Item | Status |
|---|---|
| Gateway, Binance + Bybit adapters, store, retention, SSE, UI, build/run | implemented |
| Gateway unit + review regression tests (28) + stream causality + QA gate + stress | PASS locally |
| Live UI end-to-end (simulated feed, Chromium pane) | PASS locally |
| Adapters against the real Binance/Bybit endpoints | **NOT VERIFIED here** (outbound requests were blocked in the authoring environment); parsing follows the documented payloads. Verify with `python run.py`, then `node scripts/live_causal_check.js market_data/live/binance/BTCUSDT/M1` |
| Docker image | `Dockerfile` must add `COPY market_gateway/ ./market_gateway/` for live data; without it the server runs replay-only (handled gracefully) |
| Offline single-file smoke (Playwright) | NOT VERIFIED locally (Chromium not installed); runs in CI |
| WebSocket streaming, G3–G5 markets, SQLite store | not implemented (REST polling + CSV day files chosen for zero dependencies and an inspectable folder) |
