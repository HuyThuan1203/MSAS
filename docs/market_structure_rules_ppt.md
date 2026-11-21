# Market Structure Rule Ledger (PPT-locked) -- V2

## Source IDs

- A = `Cau_truc_nen_va_Swing_points.pptx`, nine slides.
- B = `Vi_du_ve_swing_point_vo_hieu_do_Inside_Bar.pptx`, three slides.
- Interpretation categories: **S** = directly supported by slide text/notes, **I** = engineering interpretation explicitly marked as provisional, **U** = undefined in the supplied slides. The examples in images have no downloadable OHLC table, so their exact numerical pivots are NOT independently reproduced.

## Canonical order of decision making

1. (S A2/A9) Consume CLOSED candle for a single instrument/timeframe. Validate `Low <= min(Open,Close) <= max(Open,Close) <= High`. Never infer High/Low order within a bar.
2. (S A4) At candle index `t>=2`, inspect the three CLOSED bars `(t-2,t-1,t)`. If `high[t-1]>high[t-2]` and `high[t-1]>high[t]`, emit an SH candidate at index `t-1` but **known only at t**. Analogous strict low inequalities for SL.
3. (S A6/A7; A6/A7 speaker notes) Track whether the candidate pivot at `t-1` lies in an active mother-candle containment sequence. A child has `High<=mother.High` and `Low>=mother.Low`. Keep original mother's bounds through repeated inside bars.
4. (S A6/A7 speaker notes) Count a breakout only after a CLOSED bar exhibits `High>mother.High OR Low<mother.Low`. Touching equality is still inside. Previously invalidated pivots remain invalid after breakout.
5. (S A7; B2/B3) A local SH/SL is not sufficient for structure. An opposite-side eligible swing is necessary; candidate turns without such an opposite swing are moved to a later point. A later point of the SAME kind is not automatically enough for a fully valid structural zigzag. Preserve distinct local confirmation and structural acceptance timestamps.
6. (I) The V2 demo uses a pragmatic provisional policy for same-type consecutive eligible candidates: keep the more extreme of two SH (higher) or SL (lower), mark the other superseded; mark the final unmatched one pending; confirm the prior opposite candidate when a new eligible candidate of the other type is recognized. **The slides do not provide complete tie-break or recurrence logic. Approval required before production.**
6b. (User rule 2026-11-21, supersedes the opposite-swing wait of step 6) A swing is confirmed at its right candle; if that candle is an Inside Bar of the swing candle, only when a later candle breaks the mother range, and only if the breakout does not exceed the swing extreme (else `isb_rejected`). A left neighbour inside a mother is compared through the mother's range. Same-type swings are resolved causally: a weaker one is `ignored`, a stronger one supersedes the previous at its own confirmation candle (`supersededAt`). See `docs/advanced/MAJOR_PIVOT_SELECTION.md` V5.5.
7. (S A5/A9) Compare the two most recent eligible high pivots (HH/LH) and the two most recent eligible low pivots (HL/LL) **on the same timeframe**. Up requires HH+HL; down requires LH+LL; otherwise show unspecified/gray state. Do not call it a range without a range criterion.
8. (S A9) Scope state to `(symbol,timeframe,candle_open_timestamp)` and preserve both `pivot_time` and `local_confirmation_time` in audit output.

## Slide-by-slide map

| Slide | Grounded knowledge | Implementation implication |
|---|---|---|
| A1 | Prioritize market structure from OHLC, inspired by Dow peaks and troughs | Not a strategy or trading signal |
| A2 | Candle body and upper/lower wick, green bullish / red bearish | Body `abs(C-O)`; top wick `H-max(O,C)`; bottom wick `min(O,C)-L` |
| A3 | Timeframe aggregation M1 to M5; actual worked M5 O=100 H=105 L=97 C=98, despite first M1 up | Never assume a higher-timeframe candle has the same direction as component candles; unclosed values are mutable |
| A4 | Three-candle swing with strict high/low comparison; point at t4 only known after t5 closes | No look-ahead or premature marker |
| A5 | Dow-like HH/HL and LH/LL pairs, same timeframe | Compare two valid highs and two valid lows; never apply classic Dow index confirmation by implication |
| A6 | Inside child swing points do not count; mother's boundary persists | Record rejected status and source mother |
| A7 | With no valid opposite low between highs, move to the following high | Do not connect every local pivot |
| A8 | Image compares raw and corrected structure after filtering | Illustration ONLY, no numeric acceptance test possible |
| A9 | Receive closed bars, filter, classify, return unclear if incomplete/conflicting | Status and event record with close timestamp; internal/external/sideways left for later |
| B1 | Intro to invalid pivots | General scope only |
| B2 | Example 1: SH point 1 invalid if mother suppresses following SL; SH shifted to point 2 after mother boundary breakout. SH point 3 is local maximum but lacks following eligible SL, so move to next | Must track successor validity; cannot label SH final on 3-candle test alone |
| B3 | Example 2: SL point 1 shifted to point 2 for lack of following SH. SL point 3 invalid because SH point 4 belongs inside candle 3; SL should move to point 5 | Symmetric high/low correction; reject inside successor; pair-based acceptance |

## Critical distinctions

- `local_swing`: strict 3-bar condition. This is a candidate, not a guaranteed structural turn.
- `inside_rejected`: raw pivot's **center candle** belongs to the known mother-child sequence. This is an explicit programmatic interpretation of slide A6; cases of nested/noncontiguous mother regions need separately approved fixtures.
- `structure_pending`: eligible raw turn with no accepted opposing turn yet.
- `structure_confirmed`: V2 **provisional** policy accepted the alternating turn. This is an internal engine label, not proof of a trading strategy.
- `structure_superseded`: a same-direction raw pivot was bypassed under the V2 policy. The *general need to move an invalid point* comes from B2/B3, but the *more extreme tie-break* is an interpretation.
- `HH/HL/LH/LL`: classification is based on accepted turns. Equal highs/lows are NOT HH/HL/LH/LL; the demo's EQH/EQL vocabulary is an extension, not defined by the slides.
- `GRAY ZONE`: internal structure unknown due to insufficient/inconsistent evidence; DIFFERENT from the visually gray unobserved future area.
- `wick breakout`: the source allows High/Low crossing on a candle that has closed; **not** a requirement that Close crosses the boundary.

## Source examples: avoid inventing coordinates

### B slide 2 -- points 1, 2, 3

- Observation: a wide bar associated with point 1 contains subsequent bars, preventing a valid opposite SL; point 1 is not the final SH.
- Correct handling: wait for a qualifying successor after the breakout, then move the working SH to point 2.
- Further correction: point 3 is visually a three-bar maximum but cannot become accepted without a subsequent eligible SL. Later SH replaces it.
- Limit: screenshots provide labeled *conceptual* points; the exact OHLC and timing are not supplied. Do not assign synthetic prices to those labeled screenshot points.

### B slide 3 -- points 1, 2, 3, 4, 5

- Observation: point 1 SL lacks eligible subsequent SH and moves to SL point 2.
- Observation: point 3 SL has following SH at point 4, but that SH is contained inside mother range of point 3 and is invalid.
- Correct handling: SL point 3 cannot be accepted via invalid SH point 4; move to point 5.
- Limit: screenshot has no original OHLC table or candle-closure timestamps.

### A slide 4 -- exact numeric test

- highs `[103,108,105,112,109,111]`, lows `[99,102,100,106,104,107]`.
- local SH at t2 known at t3; SL at t3 known at t4; SH at t4 known at t5; SL at t5 known at t6.
- This exact table is reproduced in `scripts/test_source_cases.js`.

### A slide 3 -- exact numeric aggregation test

- Five M1 examples: `(100,104,99,103)`, `(103,105,102,104)`, `(104,104,100,101)`, `(101,102,98,99)`, `(99,100,97,98)`.
- Aggregate M5 `(O,H,L,C)=(100,105,97,98)`; first M1 up but M5 down.
- Tested in `scripts/test_source_cases.js`.

## Explicitly unresolved by source (must not silently fill)

1. Internal vs external structure; degree/timeframe of swings.
2. When to call a market range/sideway and when to exit it.
3. Exact logic for consecutive same-kind swing candidates: selection priority, equal extremes, and acceptance conditions.
4. Outside bars simultaneously qualifying as both 3-bar high and low (OHLC has no intrabar path).
5. Revised and missing candles, gap acceptance, duplicate timestamps, session boundaries and data contract.
6. Repeated nested mother zones, complex patterns with noncontiguous containment or overlapping mother candidates.
7. Whether to use wick or Close for **trend breakout** / BOS/CHoCH, which are not defined in the PPT.
8. Trading/execution/risk rules, volume confirmation, multi-timeframe reconciliation.

## Data and UI conventions -- not PPT rules

- The supplied sample has 40 rows from 2026-11-11 00:00 to 09:45 with 15-minute timestamps; no symbol, exchange, quote currency or timezone. Do not label it BTC/USD based only on price levels.
- HTML speed 0.25x to 8x controls replay time **per CLOSED bar**, not the exchange sampling timeframe.
- Canvas animation is cosmetic fade/scale interpolation after the next closed candle is accepted; it does NOT simulate an intrabar price path. Labels and event timestamps are calculated only from the closed-data prefix.
- Future prices must never be rendered under a partially observed chart region.
- Notifications say REPLAY (not real-time exchange prices). A replay event is emitted when the associated closed candle is reached, never earlier.

## Acceptance gates

- Gate G1: all input numeric checks pass; preserve source rows; timestamp monotonic.
- Gate G2: strict right-side confirmation for A4; exact A3 M5 example.
- Gate G3: inclusive mother containment; breakout strict; invalid pivots stay rejected after breaking (A6/7).
- Gate G4: valid opposite-side turn checked as in B2/B3, any same-direction resolution clearly marked provisional.
- Gate G5: HH+HL/LH+LL only with adequate accepted pivots; otherwise gray (A5/9).
- Gate G6: full-prefix no lookahead for all timestamps and events.
- Gate G7: V2 app checked at slow+fast playback, manual seek, pause, natively on desktop/mobile, no script errors.

Use the original deck screenshots for qualitative point-number comparisons. Do not claim 100% alignment with B2/B3 screenshots until OHLC fixtures from the exact illustrated chart have been supplied and human-checked.
