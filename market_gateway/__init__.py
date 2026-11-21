"""MSAS optional market-data gateway (G0-G2): crypto spot via Binance and Bybit.

Standard library only. Provider adapters do transport + parsing; the manager
owns closed-candle finalization, dedupe, recovery, fallback lineage and the
event stream. Nothing here imports or calls the structure engines: only CLOSED
candles are handed to the browser, which runs the existing engines.
"""
