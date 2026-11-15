# Major High / Major Low selection — V5.1 review ledger

**Status: IMPLEMENTATION POLICY (provisional).** Source references: advanced PPT slides 5, 7, 11, 13 and 14. This is a market-structure study, not a trading strategy.

## Rules explicitly established by PPT

1. Use accepted alternating SH/SL to establish Major structure: HH+HL means Main UP; LH+LL means Main DOWN. Do not confuse local vs main trend.
2. In an UP Major, keep MH/ML as the effective structural thresholds while Internal waves fluctuate inside. A Close past Major High means Main continuation; a Close past Major Low means Main reversal. Down Major is symmetrical.
3. Major roles change **only when justified**. Slide 11 replaces 4/3 by 10/9; slide 13 replaces 4/3 by 14/13 after a confirmed breakthrough. A reversal from UP to DOWN keeps 14 as Major High and leaves the new Major Low unformed (`null`).
4. Break of an Inside Bar mother range uses wick High/Low; break of Major structure uses **Close**. Never backdate knowledge before the confirming candle closes.

## V5.1 correction: strongest eligible extreme in a close-breaking wave

Previous V5: after a Close crossed the old Major boundary, the first *newly confirmed* swing was selected as Major. This could ignore a more extreme previously confirmed swing in the same move and **move Major High lower**.

V5.1: on/after a Close break, scan eligible, structurally confirmed pivots in the current move (after prior Major or after the reversal trigger); choose the highest SH for an UP breakout or lowest SL for a DOWN breakout. If multiple prices tie, prefer the earlier pivot index. If the new extreme was confirmed before the breakout, pair it with the strongest confirmed corrective opposite pivot formed after the extreme and before the breakout; otherwise pair with the latest preceding accepted opposite pivot. The Major role is assigned at the actual later closed candle (`at`); its historical pivot (`index`) remains unchanged. This policy extends the qualitative slides to numerical CSV and remains **provisional**.

### Reproducible observed example: XAUUSD M15, 2025-06-18

- Before bar 43 (16:45 UTC), the provisional engine's current Major pair is `SH-30 @ 3389.645` / `SL-27 @ 3378.745`.
- Bar 43 CLOSE = `3392.535`, strictly above previous Major High `3389.645`: Main UP continuation.
- `SH-34 @ 3396.648` (14:30 UTC) is already confirmed by bar 38, higher than old Major High. It is stronger than the subsequent `SH-44 @ 3394.498`.
- The selected confirmed corrective opposite pivot is `SL-37 @ 3373.545` (15:15 UTC), the corrective low after SH34 before breakout. Both MH and ML are displayed in the snapshot and anchored on the chart, with role assignment at bar 43, not retrospectively at 34/37.
- At bar 47 Main = UP and Internal = UP (as identified at bar 46) with the confirmed base inputs used here. Unknown is **not** sideways.

### BTCUSD M15, 2025-06-18

- At final bar 47: Main UP, Major High `SH-33 @ 105348.75` (14:15 UTC), Major Low `SL-30 @ 103837.75` (13:30 UTC). Internal UNKNOWN; local internal SH/SL still shown as available.

## Known unresolved policy questions

- A synthetic PPT illustration is not OHLC ground truth. Exact screenshot-marked pivot candle indexes were not exported as certified labels. The above is a source-informed candidate; **do not claim an exact match to user-drawn marks until those indexes/prices are checked independently**.
- The PPT does not say whether a candidate preceding opposite pivot that was transiently close-broken before promotion should be disqualified. That case must be labeled and explicitly decided before final model acceptance.
- The same policy has not been benchmarked on long histories, nested structures, or exchange-specific session rules; do not infer that 48-bar acceptance proves production readiness.
- A new accepted same-kind pivot that is a weaker high/lower low is Internal/history rather than automatically rolling the Major label.

## Test cases

- `node tests/test_major_selection.js` checks sample regression, role timestamps, both source decks' synthetic 1–14 sequence and full-prefix determinism.
- `node tests/test_advanced_structure.js` checks current slide-13 fixtures and mirrored reversal.
- `python scripts/qa_gate.py --require-node`, GitHub Playwright E2E and Docker health gates must pass before merging into main.
