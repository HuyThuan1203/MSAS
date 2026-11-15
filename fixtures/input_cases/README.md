# Adapter input fixtures (all synthetic)

These files test the **parser/normalizer**, not trading labels. No price information here is from a market provider.

| File | Expected outcome | Purpose |
|---|---|---|
| `case_insensitive_reordered.csv` | ACCEPT; 4 candles; header mapping, Volume=null | reordered mixed-case columns |
| `headerless_five_columns.csv` | ACCEPT; 4 candles; position mapping, Volume=null | no header positional fallback |
| `gap_m15.csv` | ACCEPT; 4 candles and 1 interval warning | warn but do not fill a missing candle |
| `invalid_ohlc.csv` | REJECT `INVALID_OHLC` | High below Close/Open |
| `duplicate_timestamp.csv` | REJECT `INVALID_TIMESTAMPS` | duplicate timestamp |
| `mixed_timezone.csv` | REJECT `INVALID_DATA` | mixed offset-aware/naive timestamps |

Fixture prices are synthetic and must never be used as a market-backtest sample.
