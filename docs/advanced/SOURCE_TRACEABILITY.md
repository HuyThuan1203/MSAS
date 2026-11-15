# SOURCE TRACEABILITY — ADVANCED MARKET STRUCTURE

**Canonical source:** `docs/advanced/Cau_truc_nang_cao_-_Final.pptx` (14 slides, provided by user). **Other sources:** `docs/source_ppt/` for basic Swing / Inside Bar. **As-of:** 2026-11-15. This is a *project-specific market-structure model*, not a trading strategy or a universal definition of Dow theory.

**Legend:** S = directly stated or illustrated in PPT; I = implementation interpretation that requires approval; U = unresolved by the source.

| Slide | Source definition / illustration | Provenance | Model behavior / acceptance |
|---|---|---|---|
| 1 | Scope: major/internal, structural reversals and uncertain structure (sideway mentioned) | S | Layers are separated; no numerical sideway criterion supplied |
| 2 | Up / down trend sketches | S | Trend is a structural state, not a candle color |
| 3 | Up reversal: created HH, failed HL, **Close breaks prior Swing Low**. Down reversal symmetric on prior Swing High | S | Compare **CLOSE**, strictly, against the active protected structural level |
| 4 | Major swings emerge among many local swings | S | Local accepted swings do not automatically become Major |
| 5 | Numbered 1–2–3–4: HH at 4 vs 2, HL at 3 vs 1; 4/3 Major | S | First up Major pair can be 4/3; selecting it from a raw CSV requires a pivot policy |
| 6 | Wave 4–5–6–7–8–9 within Main 3–4. Its LH/LL is local down, not main down | S | `external.trend` remains up while `internal.trend` can be down |
| 7 | Break 8 -> end local down; break 9 -> continuation local down; break 4 -> continuation main up; break 3 -> main reversal down | S | Thresholds tracked separately; breaches evaluated at candle close (per slide 14) |
| 8 | Labels Major High/Low and Internal SH/SL; roles change over time | S | Store role-change log, never erase a historical pivot |
| 9 | At phase after point 6, Major 4/3, Internal 6/5 | S | `internalHigh` / `internalLow` are dynamic |
| 10 | At phase after 9, Major still 4/3, Internal 8/9; 5–7 become ordinary swings | S | Previous internal marks demoted to historical Swing roles |
| 11 | After break of 4 and valid new swing, Major becomes 10/9; old 1–4 are historical evidence but no longer current confirmation thresholds | S | Roll Major on validated new pivot and preceding opposing pivot |
| 12 | Unlabeled numerical challenge 1–14 | S | Only *qualitative* structural chart, no OHLC or precise pivot times |
| 13 | Internal down 4–11 ends when 12 breaks 8; internal up confirmed by 9–13 HH/HL; 14 breaks Major High 4, 14/13 become Major; Close later breaks 13 -> main down, Major High 14 and **new Major Low not yet known** | S | Golden fixture with explicit synthetic values, not claimed numerical reproduction |
| 14 | Algorithm: initialize Major using alternating eligible pivots; outside Major boundary by Close => continuation or reversal; inside => update Internal; if insufficient evidence => Unknown | S | State machine phases and change events; source of Close rule |

## Critical design distinctions

1. **Inside Bar breakout** (basic PPT) uses a closed bar's `High > motherHigh` or `Low < motherLow` (wick crossing). **Market structure break** (advanced slides 3 and 14) uses `Close > structuralHigh` or `Close < structuralLow`. Do not conflate these operators.
2. **Last local SH** is not always the **protected high** that confirms reversal: slide 13 says point **12 must break point 8** even though point 10 is a newer, lower high. This implementation retains the last SH preceding a fresh LL as `protectedHigh`; symmetrical `protectedLow` for uptrends. That retention rule is **I**, motivated by the source example, and needs more labeled fixtures.
3. `internal.trend=up` while `confirmed=false` is a *transitional* reversal signaled by Close crossing a protected level. `confirmed=true` requires eligible HH+HL (or LH+LL) in a subsequent ordered set of swings. Distinguish a trigger from confirmed structure.
4. When main up breaks a Major High, do **not** instantly relabel that candle as Major High. Mark the continuation at Close and wait until the new high has been accepted as an opposing-paired swing. The new Major Low is its most recent accepted preceding opposite low. This linkage is **I** based on slides 11, 13–14; source provides no fully specified re-pivoting algorithm.
5. On reversal down below Major Low, keep the previous Major High; set `majorLow:null`, phase `awaiting_major_low`, until a new eligible low is confirmed. Symmetric for down-to-up reversal (slides 3, 13–14).
6. Equal structural boundaries do not count as breaks in this implementation (**I**, strict comparator chosen to match earlier Inside Bar equality semantics; not explicit for advanced structure).

## Explicit source gaps / required decisions

- **U:** No objective numerical criteria for *sideway*. `unknown` must NOT be relabeled sideway.
- **U:** Complete procedure to choose Major among candidate pivots in real OHLC (multiple same-kind pivots, equal extremes, nested structures, session gaps). V5 inherits the V4 **provisional strongest-extreme tie-break**, rather than silently claiming this is source-mandated.
- **U:** Nested / multi-degree Internal hierarchy, higher timeframe arbitration, and volatility-dependent threshold.
- **U:** Whether closing prices must pass a level by a tick/buffer; strict comparison is a documented default, not a validated strategy rule.
- **U:** PPT line plots lack original underlying OHLC rows and candle close timestamps, so exact numeric 1–14 replication cannot be verified.
- **U:** No execution / entry / stop / risk / trade P&L rules. Do not use as a profit backtest.
- **U:** What qualifies as a final confirmed local reversal versus merely breaking a protected level is only exemplified, not fully formalized for all pivot configurations; V5 uses an explicit provisional ordered HH+HL/LH+LL condition.

## Source policy & required human sign-off

`ADV:S3-14` rules are locked; implementation interpretations `I` are exposed in outputs under `model_provenance.policy="provisional"`. Before trading production, supply candle-index labels for SH/SL, 1–14 Major/Internal role timeline, reversal/continuation close times, and expected gray cases to ratify assumptions. No model-produced label is a ground-truth annotation.
