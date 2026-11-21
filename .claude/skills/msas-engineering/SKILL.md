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

Run `python scripts/qa_gate.py --stress --require-node` before promoting market-structure changes. Review `qa-artifacts/stress-dashboard.html`, failures/seeds, independent strict Close and wick oracles, and the `policyGaps.alreadyOutsideAfterRoleAssignment` count which V5.4 treats as a **covered Close-only regression**, not an unresolved gap. Competing Major pivots still require human review. The weekly GitHub job executes two seeds and publishes artifacts. Long QA videos are rendered only when explicitly dispatched.


## V5.5 real-time confirmation (user 2026-11-21, overrides V5.4 where they conflict)

ISB breakout is required when the right candle is inside the swing candle; SH/SL alternate causally with `supersededAt` (consume `analyzePrefix().accepted`, never re-derive history from the final path); a confirmed swing outside the active Major rolls MH/ML on that candle (new edge + preceding opposite swing). See the V5.5 section of `docs/advanced/MAJOR_PIVOT_SELECTION.md`.

## V5.4 pinned corrective examples (historical; XAU40 values superseded by V5.5)

Read `docs/advanced/MAJOR_PIVOT_SELECTION.md`. In XAU40 at 21:00 the post-break Major rolls from 4013.4/3995.8 to 4001.5/3991.1 once lower LH/LL are confirmed. In user-annotated XAU48 the latest MH/ML remain 3396.648/3373.545. A Close outside the currently active opposing Major triggers S+ immediately with tol=0, even if previous Close was outside that newly active threshold. Preserve separately the confirmation time and the pivot's original index. Render MSS S+, MSS C, CISD B on the candles, including coincident B+C. Require all regression gates and HTML byte-for-byte CI reproduction.
