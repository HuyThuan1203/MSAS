# Market Structure Studio — Docker

Web application for replaying **closed-candle OHLC** and inspecting Swing High/Low, the project-specific mother/Inside Bar filter, accepted structural pivots, HH/HL/LH/LL and causal event notifications. Preserves the compact V4 interface: **one chart + one notification stream**.

**No exchange connection or trading execution.** This is a historical-market-structure replay/backtest *of pattern detection*, not a P&L/strategy backtest.

## Start on Windows (Docker Desktop), macOS or Linux

1. Install and start Docker Desktop (Windows/macOS) or Docker Engine + Compose plugin (Linux).
2. Extract the complete ZIP to a local folder. Keep `Dockerfile`, `compose.yaml`, `app/`, `static/`, `samples/` together.
3. Open Terminal/PowerShell in that folder and run:

   ```bash
   docker compose up --build -d
   ```
4. Open **http://localhost:8080** in Chrome or Edge. On Windows you can alternatively double-click `start_windows.bat` (Docker Desktop must already be running).
5. From the **DỮ LIỆU** selector, switch between built-in `BTCUSD · M15 (mẫu)` and `XAUUSD · M15 (mẫu)`; click **+ Nạp file** or drag a file onto the chart to add your own dataset.

To view logs: `docker compose logs -f market-structure`.
To stop without removing imported data: `docker compose down`.
To update after editing source: `docker compose up --build -d`.

If host port 8080 is in use, change `127.0.0.1:8080:8080` to `127.0.0.1:8081:8080` in `compose.yaml` and open `http://localhost:8081`.

### Data persistence

Imported files are stored in Docker's named volume `market_structure_storage`, and persist across `docker compose down` / rebuild. **Do not** run `docker compose down -v` unless you want to delete all imported files. Uploaded data remains on your local Docker host; no third-party API or cloud upload is used by this app.

The default port is bound to **localhost only**. This application has no login/authentication. Do not expose its port to the Internet without adding authentication and access controls.

## Data ingestion: no fixed BTC-specific columns

Accepted: `.csv`, `.tsv`, `.txt`, `.json`, `.jsonl`, `.xlsx` (common worksheet format). Maximum upload: **12 MB**, max **25,000 candles** per dataset. Volume is **optional** and is not used in Swing/Inside Bar logic.

The adapter determines columns in this order:

1. Identify column headers without case sensitivity (`Open`, `open`, `OPEN`, `openingPrice`, `price_open`, `HIGH`, `Low`, `Close`, `tickvol`, etc.), including reordered OHLC columns.
2. Handle a separate `Date` + `Time` pair, offsets such as `+00:00`, ISO dates, common provider timestamp formats, Unix seconds/milliseconds, common Excel dates. Never invent a timezone.
3. With **no descriptive headers** and five/six columns, try the conventional position order: `timestamp,open,high,low,close[,volume]`. This positional assumption is flagged in metadata; a valid OHLC inequality cannot always distinguish swapped Open/Close.
4. If the format does not permit a safe mapping, prompt you to **select the five columns** manually. Ambiguous DD/MM vs MM/DD dates likewise require a user choice.
5. Reject broken OHLC, duplicate timestamps, mixed timezone semantics and arbitrarily scrambled rows with an actionable error. Entire descending histories can be reversed with a warning. Missing time intervals are reported and **not** filled with fabricated candles. Because the PPT does not prescribe treatment of missing sessions, the current structure engine treats consecutive *observed rows* as neighbors even across a reported gap; this limitation must be reviewed for real-session backtests.

The server returns canonical `time,open,high,low,close,volume` values; `volume:null` means absent. The market-structure engine (`static/engine.js`) receives those canonical candles only, and is independent of source file types or column names.

## Replay controls

- Play/pause, prior/next/first candle and timeline scrub.
- Playback speed `0.25x`, `0.5x`, `1x`, `2x`, `4x`, `8x`.
- Structure, Inside Bar and candidate layers can be toggled separately.
- Notifications refer to **closed candles**, not a streaming price feed. Gray future area hides unseen candles.
- Keyboard: arrows to move a candle, Space to play/pause, `U` to open the file picker (when not typing in an input).
- Imported datasets can be deleted with the small **×** button. Built-in samples cannot be deleted.

## Source-aligned recognition rules

The same source-locked engine from the V4 demo is retained. On each closed-bar prefix:

- Three-candle SH: middle High strictly higher than both adjacent Highs; SL symmetric for lows. A candidate is known only when the **right** candle has closed.
- Inside Bar: child High ≤ mother High and child Low ≥ mother Low. Preserve mother range through consecutive contained bars; breakout requires a later **closed** candle with High > mother High or Low < mother Low. Previously invalidated pivots stay invalid.
- A local swing does not automatically become a structural pivot: an accepted opposing swing is required. The demo's same-kind pivot tie-break (keep stronger extreme) is **provisional** pending approval against the original PPT screenshots with source OHLC.
- Classify HH/HL/LH/LL from eligible/accepted pivots, up on HH+HL, down on LH+LL, otherwise **Vùng xám – Chưa xác định**. Do not invent sideway, internal/external, BOS/CHoCH or trade signals.

See `docs/market_structure_rules_ppt.md` (two PPT traceability), `docs/event_schema.md` and `docs/ingestion_contract.md`.

## Tests (developers)

The Docker image requires **only Python 3.12 standard library**. The tests below can run locally with Python 3.12+; the source-rule test additionally requires Node.js (not required to run the app):

```bash
python -m unittest discover -s tests -v
node tests/test_source_cases.js
node tests/test_sample_replay.js
```

The original two training PPT files are included under `docs/source_ppt/`. There are two reproducible sample audit logs in `docs/*audit.json`, with status and timestamps for each pivot and event, plus canonicalized JSON samples. Check `docs/verification.md` for tested and untested conditions.

## Folder layout

```text
Dockerfile              Python 3.12 slim, non-root execution, health check
compose.yaml            localhost:8080 and persistent Docker volume
app/importer.py         provider-agnostic normalization and validation
app/server.py           HTTP API, dataset storage and static file server
static/index.html       single chart + notification panel
static/studio.css       visual design, responsive rules
static/studio.js        display, animation, replay, source switching, mapping UI
static/engine.js        shared structural-recognition rules (no CSV parser)
samples/                original BTCUSD and uploaded XAUUSD data
tests/                  22 Python tests + slide-source Node test
docs/                   source trace, event contract, adapter contract, sample audits
```

**Note:** This package's backend, APIs and browser UI were exercised directly in the development environment. The environment used to produce it had no Docker daemon, so an actual `docker compose build/up` execution was **not** possible here; verify it on your installed Docker Desktop before declaring deployment acceptance.
