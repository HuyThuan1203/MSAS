# MSAS — Reversal semantics: MSS S+, weak C, early CISD B (V5.2)

**Canonical source**: user-supplied `Mau_hinh_xac_nhan_ao_chieu_-_Final (1).pptx`, 8 slides (18 November 2026 task). The slide deck **is not published** to this public GitHub repository. Companion: `Cau_truc_nang_cao_-_Final.pptx` slides 3–14; Basic: 3-bar Swing and Inside Bar PPTs. **This is structural replay only**, not a trading strategy, forecast or entry/exit recommendation.

**Evidence status:** `S` = explicit slide text/diagram; `I` = operational interpretation, needs confirmation on labeled candles; `U` = unresolved.

| Source slide | Meaning | Code check | Status |
|---|---|---|---|
| REV 2 | Swing reversal after HH fails HL then Close below prior Swing Low, or reverse after LL fails LH; Close matters as well as wick | Main structure from accepted pivots and Close breaks | S |
| REV 3 | MSS confirmed in falling main structure when candle body closes above nearest Major High; S+ strong reversal | `Close > active MH`, immediate Main UP | S |
| REV 4 | High passes MH, but body closes inside/below; wick-rejection C; current trend unchanged | `High > MH`, `Open <= MH`, `Close < MH` under Main DOWN | S + I (body Open check) |
| REV 5 | CISD B only early evidence, no confirmed Swing structure reversal; ignore Swing for price-delivery check | Counter-trend Close through prior red candle Open | S |
| REV 6 | CISD can reference single candle or bearish *group*: Open of FIRST bearish candle | last contiguous same-color old-direction group | S |
| REV 7 | When multiple bearish groups within last down wave, reference the LAST group | use latest contiguous bearish group in eligible active wave | S; exact wave segmentation I |
| REV 8 | Process valid swings and CLOSED OHLC; Main DOWN: Check MH; Main UP: check ML; strong MSS S+ for strict Close cross; C wick cross/close inside; B Close across last group's first Open, mirrored in UP main | `MSS_TOLERANCE=0`, mirror logic and independent event kinds | S |
| ADV 5–14 | Major/External pivots and Internal levels evolve as Swing acceptance changes; no artificial pivot on current breakout bar | role ledger, pending new Major, no-lookahead | S + I (strongest-extreme selection policy) |

## Deterministic signal contract

Evaluate each **closed** candle at index `at` against the **active Major before that candle**. Price tolerance is **exactly 0**; equality does not breach any threshold. Source breakout candle High/Low may cross with wick; a confirmed *structure reversal* requires **Close**. Inside Bar mother-range break is a different existing rule and remains based on High/Low.

| Current Main | Event | Required exact condition | Confirmed Main result |
|---|---|---|---|
| DOWN | S+ | `close > majorHigh.price` | UP immediately; keep Major Low, Major High `null` pending Swing |
| UP | S+ | `close < majorLow.price` | DOWN immediately; keep Major High, Major Low `null` pending Swing |
| DOWN | C | `high > majorHigh.price && open <= majorHigh.price && close < majorHigh.price` | Remains DOWN |
| UP | C | `low < majorLow.price && open >= majorLow.price && close > majorLow.price` | Remains UP |
| DOWN | B | Green candle (`close > open`) and `close > referenceOpen` | Remains DOWN |
| UP | B | Bearish candle (`close < open`) and `close < referenceOpen` | Remains UP |

**C Body check is interpretive:** The phrase 'rút râu, thân đóng vào trong' implies the body has not established outside acceptance; open and Close inside is used to avoid mislabeling an outside-opening candle as a wick-only attempt. Strict wick cross, strict Close check. Consecutive repeated wick attempts on the same level are deduplicated while consecutive.

**CISD reference wave implementation**: Within the latest old-direction wave bounded by the most recent accepted opposite Swing (or current structurally known segment if none), pick the **last** contiguous run of candles whose Close–Open points in the old Main direction; use the **Open of that run's first candle**. Only one B is emitted per trend/reference group. This definition of wave *boundary* is not fully specified by REV slides; therefore its segmentation/tie-break is **provisional**, not source-certified.

**Temporal rules:** A Swing centered at `i` cannot become locally known before right-hand candle `i+1` closes, nor may Major roles be assigned before that Swing is structurally confirmed. Event `at` is the candle closing index at which it is knowable, never the historical pivot index. Only labels for events at or before the current replay candle may be drawn. User-confirmed XAU sample (48 M15 bars) remains MH=3396.648 (14:30 UTC), ML=3373.545 (15:15 UTC) at last candle, with Main UP/Internal UP.

## Presentation and event priority

- On chart, only the active Major High/Low, Internal status, and confirmed Swing structure; show labels **S+**, **C**, **B** on their closed source candles, not on later bars or hidden future.
- Persistent status (both chart rail and notification side): Main UP/DOWN/UNKNOWN, Internal UP/DOWN/UNKNOWN; actual MH/ML and iSH/iSL with pivot prices/time or `Not confirmed`/`Chưa xác nhận`.
- Notification feed: show only **major reversal S+**, weak C, early B, Major confirmed/updated/continuation, Internal reversal/confirmation. Exclude raw Swing and Inside Bar spam; those remain available on chart / JSON.
- When C and B coincide, preserve both structured events in audit; show no more than four recent high-level events, prioritize stronger signals for main hero.
- English is default, Vietnamese switch from `static/i18n.js`, no hardcoded translated strategy logic.

## QA evidence and limitations

- `tests/test_mss_cisd.js`: synthetic two-way DOWN→UP and UP→DOWN cases, strong S+ vs wick-only C vs delivery B; two bearish groups choose last; equality at Major no flip; numeric-close legacy fixtures cannot fabricate Open/High/Low; no lookahead; four independent 40/48-bar datasets.
- `tests/test_major_selection.js`: user-reviewed XAU extreme/paired low and prefix causal consistency.
- `scripts/offline_smoke.py`: offline HTML Chromium desktop/mobile, EN/VI and user-provided CSV import, no network; GitHub Actions performs browser test.
- `scripts/export_structure.js`: auditable timeline, analysis version `market_structure_advanced_v1_2`, `model_provenance.mss_tolerance=0`.
- Data examples have no independent certified S+/C/B ground-truth labels. Their automated PASS checks internal causality, stable semantics and contracts, NOT source-image price-perfect alignment.
- `U`: how to delimit nested waves after ambiguous/multiple swing confirmations; time-of-day market sessions; same-candle open outside then close inside/at boundary; arbitrary number of substructures; how to choose strongest eligible Major candidate after competing swings. No unsupported blanket PASS for these edge cases.

**Changes require** a source slide or approved interpretation, unit/prefix fixture, schema check, EN/VI test, and green Linux+Windows+Docker+Chromium workflow before claiming a release.
