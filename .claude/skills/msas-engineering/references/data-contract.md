# MARKET STRUCTURE V5 — ARCHITECTURE / DATA CONTRACT

## Data flow and ownership

```
Provider file (original raw; do not mutate)
    └── app/importer.py (type/header/timezone/ordering/OHLC validation)
          └── Canonical CLOSED candle API / JSON / CSV
                ├── static/engine.js             [3-bar Swing + Inside Bar + provisional alternation]
                └── static/advanced_engine.js    [Major + Internal + Close-break state]
                      ├── static/studio.js       [ONLY presentation / replay]
                      └── scripts/export_structure.js [reproducible audit timeline]
```

**Module ownership / change boundaries:**

| Area | Single source of truth | Changes must preserve |
|---|---|---|
| Input formats | `app/importer.py` | Canonical OHLC + warnings, no fabricated Volume/time/candle |
| Basic Swing | `static/engine.js` | three-closed-bar logic, strict local comparison, mother containment, no lookahead |
| Major/Internal roles | `static/advanced_engine.js` | strict close break, role ledger, no guessing pending major |
| Presentation | `static/studio.js`, `.css`, `.html` | no future-data display and no mutation of analysis results |
| Contract | `schemas/*.schema.json` | versioning, explicit NULL and timestamp semantics |
| Ground truth | `fixtures/` annotated expected events | `is_synthetic` and provenance always retained |

## Canonical dataset (stable v1.0.0)

`dataset.schema.json` and `samples/normalized/{SYMBOL}_...json` are authoritative for exchange-independent batch work. Flat CSV form uses columns `timestamp_utc,open,high,low,close,volume` in that order; the volume cell is blank when absent. In JSON, use `volume: null`. Both formats are examples; the ingestion adapter still accepts provider-specific header aliases and positional input.

- Timezone: explicit **UTC** for the two new real samples. Use ISO 8601, e.g. `2025-06-18T06:00:00Z`. Preserve raw timestamp in `source_time`.
- `timestamp_role: candle_open`: a timestamp is **interpreted as candle open time for this canonical data contract**; the provider did NOT explicitly verify that role (`timestamp_role_verified:false` in manifest). If the provider uses close-time stamps, do not apply the assumption without remapping. For the current source assumption, an M15 bar becomes observable to the strategy only **after** that bar closes. A replay event's `at` is the closed bar **index**, not a wall-clock second. Do not conflate the open-time label with `confirmedAt`. Audit timelines explicitly include `available_at_utc = bar_open_utc + 900 seconds` based on the assumed M15 cadence, rather than claiming the displayed chart label was a close timestamp.
- `index`: integer zero-based (0..n−1), stable within the dataset.
- Price values: floating numbers for visualization/comparisons; the original CSV is retained byte-for-byte and the normalized CSV retains decimal text. No currency/symbol inference from price values alone.
- `symbol` & `timeframe`: metadata supplied by filename/source context and explicitly set; do not derive from price pattern.
- `provider: unspecified`: trading venue is unknown and must not be invented.
- `Volume` absent is not zero. Volume is neither required nor consulted by the present structure engine.
- `source_sha256`: SHA-256 of the original raw dataset; detects accidental modification. Manifest records row counts, intervals, missing timestamps and unknown metadata.
- No filled session gaps. Broken/corrupt candle rows fail validation rather than being fixed silently.

## Engine object contract

### Local Swing (V4, backward-compatible)

`{id,type,index,price,confirmedAt,status,structStatus,structConfirmedAt,comp,zoneId}`. `status` is `eligible`, `inside_rejected`, or `ambiguous`. `structStatus` is `pending`, `confirmed`, `superseded`, or `rejected` under **provisional** pairing. A local Swing only becomes eligible after the right-side candle closes; a structurally confirmed Swing requires its opposite accepted turn to appear.

### Advanced snapshot (V5)

```json
{
  "end": 29,
  "external": {
    "trend": "up",
    "phase": "confirmed",
    "majorHigh": {"id":"SH-27","index":27,"type":"SH","price":132,"confirmedAt":29},
    "majorLow": {"id":"SL-25","index":25,"type":"SL","price":112,"confirmedAt":27},
    "breakAt": null,
    "breakLevel": null
  },
  "internal": {
    "trend":"unknown", "phase":"collecting", "internalHigh":null,
    "internalLow":null,"protectedHigh":null,"protectedLow":null,
    "pendingDirection":null,"pendingBreakAt":null,"confirmed":false
  },
  "events":[],"roleChanges":[],"acceptedCount":14,
  "policy":{"source":"ADV PPT S3-S14","majorSelection":"provisional","noLookahead":true}
}
```

`majorHigh/majorLow=null`: point has not formed, NOT an error. Maintain `roleChanges[]` as an append-only audit; past Major points remain historically important without being current levels. `phase` differentiates `confirmed`, `awaiting_major_high`, `awaiting_major_low`, and `uninitialized`.

**Causal rule:** a price break at candle index `t` is observed at that **close**. A Swing centered at index `i` is locally known no earlier than `i+1`, and structurally accepted no earlier than `structConfirmedAt`; never backdate a structural role assignment. Draw states from `analyzeAdvancedPrefix(candles,t,localResult)` only, not from final state filtered for display.

### Advanced events

`{id,at,kind,layer,title,detail,severity,source,refs}`. `source` is PPT slide reference, e.g. `ADV:S13-14`. `at` is a candle index, `refs` contains referenced pivot IDs. Events have no direct BUY/SELL meaning. `advanced_event.schema.json` constrains event kinds.

### Audit

`scripts/export_structure.js` exports an immutable full-prefix timeline for each dataset, with base raw Swing evidence, advanced event sequence and role-change history. `audits/` contains both user-supplied new CSV sample audits. These are **outputs of the provisional engine**, not human-verified answer keys.

## Compatibility / change policy

- Backward-compatible: V4 `engine.js` and its existing tests remain unchanged. Advanced engine is a separate module. Do not edit baseline rule behavior to make new sample tests pass.
- `DATA_DIR` points to uploaded datasets in portable Python mode; Docker stores uploads in a named volume. Do not overwrite or auto-delete user data when upgrading.
- Keep `schema_version` for data and `analysis_version` for algorithm separate. A changed semantic rule requires **analysis version bump and new fixtures**, even if JSON fields do not change.
- New schema fields should be optional or behind a major schema version; keep previous audit exports available. Never rewrite old event times after a policy change.
- Input limit and runtime characteristics remain those of the original app (12 MB / 25k rows; the prefix-based GUI can slow down on long histories). **V5 has been tested thoroughly on 40/48-bar samples, not benchmarked for 25k candles.**
