# TEST PLAN, OPEN DECISIONS & ACCEPTANCE

## Datasets and what they prove

| ID | Source | Purpose | Expected independent evidence |
|---|---|---|---|
| `btcusd-sample` | V4 original 40 bars | backward compatibility | existing baseline counters/alerts do not change |
| `xauusd-sample` | V4 original 40 bars without Volume | alternative naming, offset, session gap | no upload failure, no fabricated candles |
| `btcusd-20250618` | new 48 bars BTCUSD M15, June 18, UTC | same-day, two-market multi-source replay | 0 invalid OHLC/duplicate/missing intervals; source checksum |
| `xauusd-20250618` | new 48 bars XAUUSD M15, June 18, UTC | non-Volume XAU market | same validation; independent Swing/Major events |
| `ADV_SLIDE13_SYNTHETIC_V1` | human-designed synthetic accepted-pivot scenario | source qualitative slide-13 behavior | Main 4/3, local down, local reversal on break of protected 8, Main 14/13, reversal leaving new Major Low absent |

**Do not mistake `ADV_SLIDE13_SYNTHETIC_V1` for raw OHLC from the PPT.** It contains numeric stand-ins chosen to exercise state changes. Exact 1–14 price/time coordinates are not supplied in the slide file.

## Automated acceptance gates

| Gate | Expected | Checked by |
|---|---|---|
| D1 | Both new CSVs have 48 rows, 15-minute intervals, valid OHLC, no Volume | `tests/test_contracts.py`, importer tests |
| D2 | Canonical JSON conforms to schema, UTC open timestamps, source SHA matches raw | `tests/test_contracts.py` (stdlib), optional `jsonschema` verification |
| P1 | Legacy swing/inside behavior unchanged | `tests/test_source_cases.js`, `tests/test_sample_replay.js` |
| P2 | 3-bar/inside cannot access right unseen candle; event time no earlier than confirmation | existing source test + advanced 48-prefix test |
| A1 | Main up stays up while internal is down | synthetic fixture at 19 |
| A2 | Protected Internal SH is 8 even after weaker high 10 | synthetic fixture at 21 |
| A3 | Close breaking protected 8 produces pending Internal reversal, no Main reversal | synthetic fixture at 23 |
| A4 | After ordered HH+HL, internal reversal confirmed | synthetic fixture at 27 |
| A5 | Close breaks prior Major High, only **later validated** high becomes Major 14, opposite low 13 | synthetic fixture at 28–29 |
| A6 | Close breaks Major Low 13, external down, Major High 14, Major Low null | synthetic fixture at 34 |
| A7 | Mirrored down-to-up case and strict equality | `tests/test_advanced_structure.js` |
| I1 | UI loads 4 builtins and error-free drawing/notifications | Python HTTP tests; Chromium screenshot with mocked API responses |
| Q1 | No out-of-bound historical event in prefix and full-vs-prefix stability | `tests/test_advanced_structure.js` |

## Open questions for sign-off

1. **Major initialization:** When several same-kind local pivots precede the first four alternated accepted pivots, how exactly choose the first Major pair? V5: latest accepted trend pair (provisional).
2. **Protected Internal high/low:** Should the protected level update when there is only a smaller same-side high, or only after a fresh LL/HH? V5 retains the level protecting last progressed LL/HH to satisfy slide 13 (provisional).
3. **Reversal confirmation:** Must a trend switch be signaled immediately at close crossing protected level or only after new alternating HH/HL or LH/LL? V5 distinguishes pending trigger vs confirmed trend.
4. **Major new pivot:** Can the high/low be declared at candle-close breakout itself, or only when its Swing point passes the 3-bar + opposite-pair tests? V5 waits for accepted swing.
5. **Equal thresholds and one-tick tolerance:** The source does not mandate buffer; V5 uses strict >/< on numeric prices.
6. **Sideway:** PPT heading mentions it but provides no complete thresholds. V5 keeps `unknown` instead of inventing range logic.
7. **Nested Internal degrees / overlapping mother zones:** No complete rules in deck; not implemented.
8. **Validation source:** Provide either labeled timestamp+price for diagram 1–14 or a gold annotated OHLC slice for independent acceptance.

## Manual review required before production

A domain reviewer should compare every 1–14 state with the exact diagram and approve the provisional rules. Apply new fixtures after sign-off, rerun all tests, and increment `analysis_version`. This is a **pattern-recognition replay**, not a P&L backtest, trading signal or model risk approval.
