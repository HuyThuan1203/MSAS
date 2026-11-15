# Structured events and replay contract (V2)

## Inputs

`Timestamp,Open,High,Low,Close,Volume` with exactly one CLOSED OHLC candle per row, strictly increasing open timestamps; timestamps are left as provided, no assumed timezone. Analyse data separately by instrument and timeframe; CSV alone does not contain these two identifiers.

## Local pivot record

| Field | Meaning |
|---|---|
| `index` | Index of the candidate center candle, zero-based |
| `type` | `SH` or `SL` |
| `price` | Center candle High for SH, Low for SL |
| `confirmedAt` | Index of RIGHT candle; only when it closes is the candidate known |
| `status` | `eligible`, `inside_rejected` or `ambiguous` |
| `zoneId` | Mother containment zone index when rejected, else `null` |
| `structStatus` | `pending`, `confirmed`, `superseded`, `rejected` under current policy |
| `structConfirmedAt` | Index at which the opposite eligible swing was first accepted; `null` if not yet accepted |
| `comp` | SH, SL, HH, HL, LH, LL, EQH, EQL; only set for structurally accepted pivots |

NOTE: The `structStatus` progression is a V2 working interpretation, not fully specified by the user's slides. Do not present these implementation labels as source-mandated behavior.

## Event record

```json
{
  "at": 21,
  "kind": "breakout",
  "title": "...",
  "detail": "...",
  "severity": "success",
  "pivotIndex": null
}
```

`at` refers to the index of the candle that has just CLOSED when the event is emitted, never the pivot's original index. `pivotIndex` may refer to an earlier center candle. Do not confuse `severity:success` with a profitable move; it is only a presentation category inherited from the demo.

## Event classes

- `start`: first candle observed, no 3-bar pivot possible.
- `inside`: first or continuing child in an active mother range.
- `breakout`: strictly crosses mother boundary by High or Low on a closed candle; wick crossing counts.
- `swing`: a strict three-bar local candidate was recognized; details distinguish eligible, inside-rejected and ambiguous.
- `replace`: candidate of same type superseded or ignored under the provisional extreme-pivot policy.
- `pair`: opposing eligible pivot accepted and previous candidate structurally accepted under provisional policy.
- `classification`: a structurally accepted point was compared to its previous accepted same-type point.
- `trend`: after two accepted highs and two accepted lows, HH+HL or LH+LL is established; unknown when conflicting.

## Notification presentation guidelines

- Use exactly one signal-stream panel with a prominent latest event and no more than four compact historical lines; the chart remains dominant.
- Show the event's **candle-close timestamp**, the event classification and the causal reason. Do not display a generic unqualified `BUY`/`SELL` notification.
- For an ordinary candle with no event: show `No new structural event`; do not repeat the last event as NEW.
- Distinguish replay from live exchange data (`REPLAY`, not streaming market prices).
- Keep inside events in warm amber; local highs/lows neutral/blue; inside-invalid red; structural pair green; `unknown` desaturated/gray.
- Use prefix computations on every replay step. CSS/canvas motion must not imply actual intrabar OHLC path.

## Model state vs viewport convention

There are two distinct gray notions:

1. `unknown trend`: the analysis cannot classify structure from available eligible SH/SL. State is unknown, not automatically sideways.
2. `future gray mask`: timestamps beyond the current playback index have not been disclosed to the user. This is a visualization constraint, not a market forecast.

## Consistency checks

For every index `t`:

- Output of `analyzePrefix(fullCSV,t)` matches `analyzePrefix(fullCSV.slice(0,t+1))`.
- `swing.confirmedAt <= t` for every visible local pivot.
- `swing.structConfirmedAt <= t` for every displayed structurally accepted pivot.
- `event.at <= t` for all visible events.
- A previous `inside_rejected` never becomes eligible after boundary break.

These are executable invariants, and can be used to generate a Remotion animation once the structural acceptance policy is signed off.
