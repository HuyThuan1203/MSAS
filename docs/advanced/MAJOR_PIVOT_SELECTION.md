# MSAS V5.5 — Real-time swing confirmation and immediate Major update (user rules 2026-11-21)

These rules supersede the V5.4 selection policy below where they conflict. They come from the user's explicit instruction of 2026-11-21 (real-time feed, closed candles only), not from a new slide.

1. **No lookahead, streaming.** Every decision is taken on the candle that closes it. Analysing a prefix equals analysing the truncated series; earlier prefixes never change (`tests/test_major_rolling_reversal.js`, `test_mss_cisd.js`, stress QA no-lookahead).
2. **ISB breakout before a swing is valid** (`static/engine.js`). If the candle after the center is an Inside Bar of the center (the center is the mother), nothing is known until a later candle breaks the mother range. SH is valid only if that breakout candle's High is below the SH (it broke the low side); otherwise the candidate is `isb_rejected`. SL symmetric. If the left neighbour is an inside child, the comparison uses its mother's range. The swing event time is the breakout candle.
3. **Causal SH/SL alternation.** A same-type swing with no opposite swing in between is `ignored` if it is not more extreme (e.g. a lower SH in a falling leg with no SL yet), or supersedes the previous one **at its own confirmation candle** (`supersededAt`). `analyzePrefix().accepted` is the causal log consumed by `advanced_engine.js`; `confirmed` is the current path only.
4. **Immediate Major update** (`rollMajorOnSwing`). Main UP: a confirmed SH strictly above the active MH (or above the broken level while MH is pending after S+) becomes MH on that candle, and ML moves to the latest accepted SL preceding it. Main DOWN symmetric. A Close beyond MH is no longer required for this roll; a corrective swing after the new edge is no longer awaited (V5.4 XAU48 policy retired). If the active MH/ML is superseded by a more extreme same-leg pivot, the role follows the replacement.
5. Unchanged: S+ is a strict Close beyond the active opposing Major (tol 0); C (wick) and B (CISD) never flip Main.

## V5.5 regression values (engine outputs, replacing the V5.4 table where different)

| Case | Index (UTC) | Main | MH | ML | Why |
|---|---:|---|---|---|---|
| XAU40 | 18 (19:30) | DOWN | SH-14 4001.5 | SL-17 3991.1 | SL-17 confirmed at 18 → immediate roll (V5.4: index 19) |
| XAU40 | 23 (20:45) | DOWN | SH-18 3996.5 | SL-21 3991.0 | SL-21 < ML 3991.1; right candle 22 is inside, known when 23 breaks it |
| XAU40 screenshot | 24 (21:00) | DOWN | SH-18 3996.5 | SL-21 3991.0 | **differs from the V5.4 pinned 4001.5 / 3991.1 — needs user confirmation** |
| XAU40 | 36 (00:45) | — | — | — | SH-34 rejected: inside bar 35 broken upward |
| XAU48 | 35 (14:45) | UP | SH-34 3396.648 | SL-31 3384.648 | SH-34 above MH → ML = preceding SL |
| XAU48 | 37 (15:15) | DOWN (S+) | SH-34 3396.648 | pending | Close 3382.348 < ML 3384.648 |
| XAU48 final | 47 | DOWN | SH-34 3396.648 | SL-37 3373.545 | user-annotated MH/ML values preserved; Main is DOWN (V5.4 said UP) |


---

# MSAS V5.4 — Closed-price Major rolling and structure checkpoints

**Sources:** `Cau_truc_nang_cao_-_Final.pptx`, slides 5–7, 11, 13–14; `Mau_hinh_xac_nhan_ao_chieu_-_Final (1).pptx`, slides 2–4 and 8. The source PPTs are user-provided but are not published in this public repository. **Scope:** replay and pattern classification; NOT an entry/exit signal.

## What the slides explicitly require (S)

1. Local SH/SL are produced from *three CLOSED candles*. A pivot is not knowable on its center candle and cannot become structural until its eligibility is confirmed.
2. Main/External and Internal directions are distinct. Major High/Low must be updated as validated structure changes; they are NOT static levels and not necessarily the most recent two local swings.
3. A main reversal MSS **S+** is confirmed on the **current** closed candle when `Close > active Major High` in Main DOWN, or `Close < active Major Low` in Main UP. Tolerance is exactly **0**; equality does not cross. The previous candle's Close is not an extra condition from the slides.
4. A wick-only excursion **C** leaves Main unchanged; CISD **B** is a delivery early-warning and does not change Main.
5. On an S+ reversal, retain the opposing Major point and mark the newly needed Major as **not confirmed**. Do not invent a new pivot on the break candle.

## Deterministic implementation (I, provisional where the slides are incomplete)

- Read the *active* Major before a candle is processed. Evaluate the current Close against the opposing boundary first. This prevents a newly assigned boundary whose previous Close was already outside from suppressing an S+.
- Once a same-direction Close extension has been observed **since the current pair became effective**, a new Major pair may be promoted only after eligible **structurally confirmed** SH/SL candidates are known. Do not require a second artificial crossing of the old Major if a Close has already established the extension.
- For Main DOWN, prefer a new **lower SL** and the latest eligible **lower SH** preceding that low. A wick higher than the protected Major High cannot replace it as a bearish Lower High.
- For Main UP, a new **higher SH** and an eligible **corrective SL** following it may replace the current bounds. This is required by the user's XAUUSD 48-bar annotated example. Other valid pairing candidates and multiple nested degrees remain an unresolved policy.
- Only append role changes at actual structural confirmation; record the earlier original pivot time separately. The chart may anchor the label at that earlier candle *after the role becomes known*, never in the preceding replay prefix.
- The original three-bar/Inside-Bar implementation in `static/engine.js` remains unchanged. The rules above live only in `static/advanced_engine.js`, with source/assumption trace in `docs/advanced/MSS_CISD_RULEBOOK.md`.

## Repeatable evidence: the user-reported failure and protected baseline

| Case | Closed replay index | Main | Active MH | Active ML | First knowable update |
|---|---:|---|---|---|---|
| XAU40 prior pair | 15 (18:45 UTC) | DOWN | SH-9, 4013.40 | SL-12, 3995.80 | index 15 |
| **XAU40 corrected pair** | **19 (19:45 UTC)** | **DOWN** | **SH-14, 4001.50** | **SL-17, 3991.10** | **index 19**, after structural SL-17 accepted |
| **XAU40 user screenshot** | **24 (21:00 UTC; 25/40)** | **DOWN** | **4001.50** | **3991.10** | no later valid CLOSE-confirmed roll by index 24 |
| XAU48 protected user annotation | 40 (16:00 UTC) | UP | SH-34, 3396.648 | SL-37, 3373.545 | index 40, after SL-37 structural confirmation |
| XAU48 final | 47 (17:45 UTC) | UP | 3396.648 | 3373.545 | unchanged from index 40 |

At XAU40 index 24 there is another eligible local SL at 3991.00, but the current Close is 3991.30, which is not below the active 3991.10 Major Low. A low wick alone is not the same as close-confirmed continuation.

These are **engine outputs checked against the screenshots and numeric CSVs**. The user's annotated XAU48 MH/ML pair is user-confirmed; the exact XAU40 replacement pair is a deterministic *implementation interpretation* of the screenshot's request to roll the bounds, and remains open for user sign-off.

## Acceptance gates

- `node tests/test_major_rolling_reversal.js` (XAU40/48, zero tolerance, reversal both ways, all 88 causal prefixes).
- `node tests/test_major_selection.js` (user-reviewed XAU48 pivot IDs and times).
- `node tests/test_mss_cisd.js` (source-defined S+/C/B behavior).
- `python scripts/qa_gate.py --stress --require-node` and `python scripts/offline_smoke.py` (Chromium; preserves all chart labels and EN/VI).
- CI checks `dist/MSAS_Standalone_Offline.html` is *regenerated byte-for-byte* from its canonical modules so users don't receive stale standalone builds.

**Not certified:** uniqueness of Major selection among complex competing pivots, multi-degree Internal nested structures, or quantitative pattern accuracy on markets without independently labeled truth.
