# Adapter contract — reusable across OHLC providers

## Scope

Normalize closed-candle OHLC from multiple file/header conventions to a single bar schema used by the unchanged structural engine. The adapter is **not** an LLM making probabilistic guesses; it is deterministic, auditable and stops when required information is ambiguous.

## API

`GET /api/health` → health. `GET /api/datasets` → list. `GET /api/datasets/{id}` → normalized bars, metadata and warnings. `POST /api/import?filename=...&label=...&mapping=...&date_order=...` with raw bytes in the body → validates and persists dataset; status 201, else 422 with structured `code`/`error` and mapping suggestions. `DELETE /api/datasets/{id}` removes imported data only. No endpoint executes trades or fetches market prices.

Canonical candle:

```json
{"index": 0, "time": "2026-11-11 15:00:00+00:00", "source_time": "2026-11-11 15:00:00+00:00", "open": 4022.4, "high": 4023.5, "low": 4022.1, "close": 4023.5, "volume": null}
```

`time` is normalized to ISO wall time with its source UTC offset preserved if supplied; `source_time` is the original provider field. A missing timezone stays unspecified. `volume` is numeric when present or null when missing; **null is not zero volume**.

`meta` reports `rows`, `columns`, `mapping`, `mapping_mode`, `volume_present`, `timeframe`, `timezone`, `gaps` and first/last timestamp. Positional mapping requires the conventional `Time, O,H,L,C[,V]` order and is explicitly disclosed. When headers are ambiguous or required fields cannot be verified, a manual mapping dialog is shown. A selected manual mapping is persisted with the uploaded raw file so the dataset can be reproduced on restart.

## Validation

- `Low ≤ min(Open,Close) ≤ max(Open,Close) ≤ High`; all prices finite.
- Nonnegative Volume if supplied; Volume not mandatory.
- All timestamps strictly increasing (or entirely decreasing, in which case reverse and notify); reject mixed order or duplicates.
- Preserve timezone offsets, don't invent missing sessions or price continuity across candles.
- Most frequent time interval is used for a display label, not forced across gap periods. Gap-adjacent bars are still neighbors under the V4 engine; the PPT leaves missing-session policy unresolved and users should interpret gap-spanning patterns cautiously.
- Excel: first standard worksheet with stored cell values; formulas are not evaluated; first-sheet source metadata is reported.
- `date_order` must be specified for ambiguous slash/dot day/month values. No silent US-vs-EU assumption.
- File extensions supported: CSV/TSV/TXT, JSON/JSONL records, XLSX; binary XLS/malformed archives not supported.
- Maximum input: 12 MB and 25,000 rows. Long datasets may have delayed replay recomputations; no HFT/large-scale streaming throughput claim.

## Provenance boundaries

The two supplied PowerPoints provide structural rules, but **do not define** CSV header matching, optional Volume semantics, missing-bar handling, datetime parsing or CSV provider formats. These are engineering design choices of the Docker application and must not be represented as rules inferred from the PPT.

`static/engine.js` is the V4 structure algorithm minus its old strict CSV parser; the results for all 40 BTC sample prefixes are asserted identical to V4. Engine tie-break policy for consecutive same-kind swings remains a provisional implementation choice.

## Timestamp convention

The CSV timestamp is treated as the **provider's bar timestamp**, usually the **opening time** of the candle. Events are emitted only after the right-hand candle is completely available (the replay consumes closed bars), but the UI's displayed timestamp refers to that candle's input timestamp rather than a computed wall-clock close timestamp. If a provider labels candles by close time, its semantics must be supplied explicitly before translating event timestamps into exchange close times.
