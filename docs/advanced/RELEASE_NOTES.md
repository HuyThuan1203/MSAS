# V5.0.0-provisional — release notes

- **Added** `static/advanced_engine.js`: separate Main and Internal structural states, dynamic high/low levels, protected internal level, pending/confirmed roles, close-triggered reversal and continuation.
- **Preserved** V4's `static/engine.js` unchanged. Its 3-bar/Inside Bar/same-kind provisional pivot policy is not silently re-trained.
- **Added** new user BTCUSD and XAUUSD 48-candle UTC M15 inputs; untouched raw copies, 6-column canonical CSV with optional Volume, JSON canonical candles, SHA-256 manifest and event audits.
- **Added** validation schemas, independent source trace, synthetic 1–14 conceptual case, mirrored bearish case, tests for no future, strict comparisons, protected level and two market sources.
- **Updated** single chart + single event stream to show Main / Internal states and dashed levels; no branding/dashboard cards.
- **Updated** Python server with 4 built-in sample choices. Existing uploaded data directory remains separately managed and is not edited by release packaging.
- **Runtime**: Python 3.10+ standard-library web server; optional Docker; optional Node for tests/export. This release is **not an approved live trading system**.
- **Acceptance**: Python and Node tests; browser presentation exercised with mocked API data. Docker daemon deployment and production-scale performance are not certified.
- **Open decisions**: exact major pivot selection, complex internal degrees, sideway criteria, buffer/tick semantics, true chart candle annotations for slide 13. See `TEST_PLAN_AND_DECISIONS.md`.
