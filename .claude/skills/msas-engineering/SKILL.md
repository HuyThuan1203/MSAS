---
name: msas-engineering
description: Maintain, implement, test and audit the MSAS market-structure replay application. Use for OHLC datasets and ingestion, strict three-bar Swing/Inside Bar detection, PPT-backed Major/Internal structure, source traceability, EN/VI UI, candle rendering theme, GitHub CI, or Docker/portable build and verification. Always distinguish source-backed market rules from provisional policies and preserve closed-candle no-lookahead.
---

# MSAS engineering workflow

## Read before implementation

Read `CLAUDE.md`, `docs/advanced/SOURCE_TRACEABILITY.md`, `docs/advanced/ARCHITECTURE_AND_DATA_CONTRACT.md`, `docs/advanced/TEST_PLAN_AND_DECISIONS.md`, and `docs/quality/QUALITY_TOOLCHAIN.md` from the repository. The repository rulebook takes precedence over generic trading heuristics.

## Modules and boundaries

1. Data source ingestion: `app/importer.py`; preserve exact raw data, inspect provider columns without case sensitivity, keep `Volume` optional/null, validate OHLC and timestamps, require mapping for ambiguity. Never invent data rows.
2. Local swings and mother/inside: `static/engine.js`. Three CLOSED bars, strictly higher/lower center; center known only after right bar closes. Inside-child pivots are rejected and stay rejected after breakout. Current same-type tie-break is provisional.
3. Major/Internal: `static/advanced_engine.js`. Maintain external and internal trend, independent levels and historical roles. A close crossing the active Major level differs from wick crossing a mother range; do not conflate.
4. Output contract: `schemas/`, `audits/`, `fixtures/`; preserve source timestamps, event `at`, affected pivots and rule traceability. Synthetic PPT tests are **not** live-market ground truth.
5. Presentation: `static/studio.js`, `static/index.html`, `static/studio.css`, `static/chart-theme.js`, `static/i18n.js`. One chart + one notification stream. EN default, VI selectable; never generate English by regex-parsing Vietnamese text.

## Exact chart tokens

- Canvas solid `#c6d2df`, grid disabled.
- Up candle body `#ffffff` at 100%; down body `#66bb6a` at 90%.
- Both borders black at 60%; both wicks black at 100%.
- Replay animation is presentation-only. Do not reveal future OHLC values or infer intrabar paths.

## Test and acceptance

Run `python scripts/qa_gate.py --require-node` (or omit `--require-node` on a Python-only workstation). For browser integration, use `python scripts/qa_gate.py --browser --require-node` after installing `requirements-qa.txt` and Chromium; CI includes browser tests on GitHub runners. For Docker run `docker compose up --build -d`, then inspect `/api/health`. Report unavailable gates as `SKIP` or `NOT VERIFIED`; never claim all PASS from static checks.

Every structural modification requires: (a) a source slide or explicitly approved policy, (b) a fixture and causal-prefix test, (c) independent review of benchmark datasets and output schemas. Avoid replacing existing data with a new file or modifying `main` directly; use a feature branch and PR.

## Public repository safety

Publish only user-authorized project code, samples and rules. Do not publish source PPT binaries, proprietary company code, secrets, WSL/venv files, user paths, data storage volumes, or local QA logs/screenshots. Keep runtime free of analytics vendor integrations and do not transmit imported market data to third parties without explicit authorization.

## V5.2 reversal interpretation and regression

Read `docs/advanced/MSS_CISD_RULEBOOK.md` for user-defined REV slides 3-8. Use only active Major levels known at candle CLOSE. `S+`=strict Close beyond opposing Major, immediate Main reversal; `C`=wick-only attempted breach with Close inside (no trend flip); `B`=CISD Close across the Open of the first candle of the final old-direction group (early warning only). All tolerances 0. Do not conflate these events with Internal trend, do not invent new MH/ML without accepted Swing. Add causal tests in `tests/test_mss_cisd.js` and inspect current Main/Internal readout and event labels in both EN/VI.

## Reproducible randomized QA

Run `python scripts/qa_gate.py --stress --require-node` before promoting market-structure changes. Review `qa-artifacts/stress-dashboard.html`, failures/seeds, independent strict Close and wick oracles, and `policyGaps` which are unresolved, not PASS. The weekly GitHub job executes two seeds and publishes artifacts. Long QA videos are rendered only when explicitly dispatched.
