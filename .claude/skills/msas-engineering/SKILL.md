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
3. Major/Internal: `static/advanced_engine.js`. Maintain external and internal trend, independent levels and historical roles. A close crossing the active Major level differs from wick crossing a mother range; do not conflate. The V5.1 **provisional** post-break selection rule scans confirmed eligible extremes in the wave rather than blindly choosing the latest pivot; consult `docs/advanced/MAJOR_PIVOT_SELECTION.md` before edits.
4. Output contract: `schemas/`, `audits/`, `fixtures/`; preserve source timestamps, event `at`, affected pivots and rule traceability. Synthetic PPT tests are **not** live-market ground truth.
5. Presentation: `static/studio.js`, `static/index.html`, `static/studio.css`, `static/chart-theme.js`, `static/i18n.js`. One chart + one notification stream. At **every closed candle**, show the current Main/Internal direction and current Major High/Low with pivot time/price; show `Not confirmed` for missing levels. Anchor MH/ML to the actual pivot candles only after role assignment. EN default, VI selectable; never generate English by regex-parsing Vietnamese text.

## Exact chart tokens

- Canvas solid `#c6d2df`, grid disabled.
- Up candle body `#ffffff` at 100%; down body `#66bb6a` at 90%.
- Both borders black at 60%; both wicks black at 100%.
- Replay animation is presentation-only. Do not reveal future OHLC values or infer intrabar paths.

## Test and acceptance

Run `python scripts/qa_gate.py --require-node` (or omit `--require-node` on a Python-only workstation). For browser integration, use `python scripts/qa_gate.py --browser --require-node` after installing `requirements-qa.txt` and Chromium; CI includes browser tests on GitHub runners. For Docker run `docker compose up --build -d`, then inspect `/api/health`. Report unavailable gates as `SKIP` or `NOT VERIFIED`; never claim all PASS from static checks.

Every structural modification requires: (a) a source slide or explicitly approved policy, (b) a fixture and causal-prefix test, (c) independent review of benchmark datasets and output schemas. Prefer feature branches and PRs; use a direct main update only when the repository owner explicitly requests it. Preserve unchanged source data and record a reviewable commit.

## Public repository safety

Publish only user-authorized project code, samples and rules. Do not publish source PPT binaries, proprietary company code, secrets, WSL/venv files, user paths, data storage volumes, or local QA logs/screenshots. Keep runtime free of analytics vendor integrations and do not transmit imported market data to third parties without explicit authorization.
