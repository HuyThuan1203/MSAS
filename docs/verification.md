# Verification record — local tests (2026-11-15)

## Completed

- Original 40-bar BTCUSD and second 40-bar XAUUSD loaded with the adaptive backend. XAUUSD lowercase `open/high/low/close`, UTC offset, no Volume and one irregular time interval are handled without editing source CSV.
- 16 unit cases cover header aliases/case, arbitrary header field order, positional headerless input, date+time split, volume optional, semicolon decimal comma, UTF16, descending source, gaps, JSON/JSONL, XLSX, manual mapping, ambiguous DD/MM vs MM/DD, invalid OHLC and duplicate times.
- 6 HTTP integration tests cover two samples, API status, uploading, deleting, mapping failure and successful explicit mapping, server path guard and no saving of rejected OHLC. Total: **22 Python tests PASS**.
- Original PPT fixture test: M1→M5 OHLC, strict 3-bar confirmation, mother containment and breakout, invalid swing retention and no-pair pending behavior. **PASS**.
- Engine regression: 40 prefixes of BTCUSD produce identical summary, trend and event records to V4 even when Volume is absent from the canonical normalized input. **PASS**.
- Replay causality: automated `tests/test_sample_replay.js` verifies all 40 closed-candle prefixes for both CSV inputs have event times ≤ observed index; prefix and truncated-dataset analysis match. **PASS**.
- Browser: Chromium canvas renders BTCUSD and XAUUSD; dataset switching, seeking, speeds, 8× playback, upload of lowercase/no-Volume sample, custom unknown-header manual mapping and subsequent deletion. No page JavaScript errors in these checks. Browser network navigation is blocked in this execution sandbox, so the HTML/JS was loaded directly into Chromium and the fetch API bridged to the running local server; network/API responses and UI logic were real, but this is not an end-to-end Docker deployment test.
- Docker Compose YAML parsed successfully; Dockerfile and Compose files have been authored.

## Not yet verified

- Running a container with `docker compose up --build` was not possible because no Docker/Podman daemon or CLI is available in this environment. Actual runtime acceptance on Docker Desktop is still required.
- Large-CSV performance above several thousand bars is not certified, despite a 25,000-row import bound.
- The numbered charts in the PPT extension do not supply raw OHLC tables, so exact point-to-point parity for their image-only pivots cannot be independently proved.
- No profit/loss, strategy execution, order routing, exchange websockets, live tick capture, BOS/CHoCH or internal/external structure are implemented.

## Sample final states

| Series | Rows | Local swings | Inside-rejected | Provisional structure-confirmed | Replaced | Events | End state |
|---|---:|---:|---:|---:|---:|---:|---|
| BTCUSD user-provided sample | 40 | 17 | 1 | 11 | 4 | 52 | Up: HH + HL |
| XAUUSD new user file | 40 | 17 | 0 | 14 | 2 | 56 | Unknown: Vùng xám |

The labels `BTCUSD` and `XAUUSD` are the source dataset names used by the requester, not claims that the CSV itself encodes an exchange, symbol or quote currency.
