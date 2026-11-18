## Reproducible random OHLC QA and evidence video (V5.3)

The **production app remains lightweight**: stress tests do not run during replay
or send imported OHLC to a service. Instead `qa_gate.py --stress` invokes a
fully local Node test driver, and GitHub Actions runs it on every push/PR and
weekly. Generated data is SYNTHETIC, not exchange candles or human-labeled
trading ground truth. Use the `--seed` option to reproduce any reported case.

```powershell
# Local, no administrator or Docker required (Node.js is needed for QA only)
python scripts/qa_gate.py --stress --stress-cases 360 --stress-bars 128 --stress-seed 20261118 --require-node --json-report qa-artifacts/full-gate.json
# Evidence: qa-artifacts/stress-report.json, stress-dashboard.html, stress-ledger.csv, stress-summary.md
```

The default stress run generates **360 × 128** valid M15 OHLC candles across
12 regimes, plus deterministic two-way S+/C/B source-oracle cases. The
`fixtures/generated/` folder contains **24 CSV samples** (two of each regime)
for manual upload, with reproducible SHA-256 manifest; these are **not**
pre-labeled external market-structure examples.

To render the optional 5–10 minute narrated evidence video, install only on a
QA workstation (not needed by users of MSAS): Pillow, Playwright + Chromium,
FFmpeg and eSpeak Vietnamese. Then run `python scripts/qa/capture_evidence.py`
and `python scripts/qa/render_evidence_video.py`. The browser capture is real
Chromium, not a simulated chart. An edited QA walkthrough is not a seven-minute
continuous real-time screen recording.

GitHub Actions → `MSAS validation and Docker build` → **Run workflow** generates
QA artifacts and the narrated video; ordinary push/PR runs the whole stress
suite but does not spend resources generating a long video. Weekly scheduled
checks run an expanded 1200-case test per seed. See
`docs/quality/STRESS_QA_PLAN.md` for source-to-test mapping, limitations,
release gates and unresolved boundary cases.

# Market Structure Studio V5.2 — MSS / CISD Structural Replay

**Scope:** deterministic, closed-candle market-structure study for replay/backtesting **pattern detection**. No exchange integration, BUY/SELL recommendation, or P&L inference. V5 extends V4 with major/external structure and minor/internal structure based on the new 14-slide user PPT. The original 3-candle/Inside-Bar detection semantics remain unchanged; its same-kind pivot selection is still provisional. The V5 UI localizes structured events independently of the detection logic.

## Quick start (Windows, Python 3.10, no administrator)

From the extracted V5 project root (the folder containing `app/server.py`):

```powershell
$env:HOST="127.0.0.1"
$env:PORT="8081"
$env:DATA_DIR="$PWD\data"
& "C:\Program Files\Python310\python.exe" .\app\server.py
```

Open `http://127.0.0.1:8081`. Docker users: `docker compose up --build -d` and open `http://127.0.0.1:8080` (after verifying the port is free). See `docs/advanced/WINDOWS_PORTABLE_UPGRADE.md` to keep the previous V4 installation/data safe.

## Windows: `test_manifest_and_canonical` fails after clone

If the error says `534d598a... != ecdfecbb...` on BTCUSD, Windows Git
converted the original raw CSV from LF to CRLF during checkout. The app's
price rows have **not** thereby changed, but the raw-file SHA-256 contract
must remain strict. This repository includes `.gitattributes` with
`samples/raw/*.csv -text` to preserve exact file bytes on **new clones**.

For a clone that already contains the converted files, first make sure you
have no personal edits under `samples/raw/`, then run from the repo root:

```powershell
git pull --ff-only
git status --short -- samples/raw/
# The next command DISCARDs edits to the two bundled raw sample files only.
git restore --source=HEAD --worktree -- samples/raw/
& "C:\Program Files\Python310\python.exe" scripts/qa_gate.py
```

**Do not replace the SHA-256 hashes in manifests to silence the failure.**
Do not run `git reset --hard`, which could discard unrelated work.
`qa_gate.py` is a *test runner*, not the app server. To open the chart,
use the `app/server.py` command in Quick start and navigate to port 8081.

## Theme, language and quality tools

- **Default language:** English (EN), with Vietnamese (VI) selector at the top of the chart. The selected language is remembered in the browser; a fresh browser defaults to EN. All visible event categories/details are translated from structured event fields.
- **Exact candle theme:** canvas `#c6d2df` (solid, grid disabled); bullish body `#ffffff` at 100%, bearish body `#66bb6a` at 90%; both borders `#000000` at 60%; both wicks `#000000` at 100%. Defined in `static/chart-theme.js`.
- **One-command QA:** `python scripts/qa_gate.py` runs Python data/API/schema tests and, when Node is present, JS syntax, source/PPT, Major/Internal and EN/VI/theme regression. To require Node in development: `python scripts/qa_gate.py --require-node`.
- **Browser QA:** Optional Playwright suite is documented in `docs/quality/QUALITY_TOOLCHAIN.md` and runs in GitHub Actions, not required on the company laptop. GitHub CI also builds the Docker image and checks the health endpoint.
- **Agent Skill:** `.claude/skills/msas-engineering/SKILL.md` plus `CLAUDE.md` provide traceable conventions for Claude Code/VSCode; users can package the Skill for other assistants.
- **VSCode:** `.vscode/tasks.json` supplies local run/QA/Docker tasks, `launch.json` supplies debugger config, and `extensions.json` recommends optional extensions (not automatically installed).

## V5.2 — Close-confirmed MSS, candle-wick C, early CISD B

The implementation in `static/advanced_engine.js` follows the user's reversal-decision PPT
**Mau_hinh_xac_nhan_ao_chieu_-_Final**, slides 3-8, and the existing
advanced structure PPT slides 3-14. The rule-by-slide matrix and unresolved choices
are in [`docs/advanced/MSS_CISD_RULEBOOK.md`](docs/advanced/MSS_CISD_RULEBOOK.md).

- **S+**: a closed candle's Close breaks the active opposite Major boundary in
  the direction opposite the current Main trend (`Close > MH` when Main DOWN,
  `Close < ML` when Main UP). Strong confirmed MSS: switch Main at this close,
  keep the opposite Major, mark newly needed pivot `Not confirmed`.
- **C**: a candle's wick pierces the same opposite Major level but its body
  closes back inside; Main is **unchanged**. C is weak reversal effort, **not**
  confirmation. This distinction uses **High/Low and Close**, not Close alone.
- **B (CISD)**: the counter-trend candle Close strictly crosses the Open of
  the first candle in the final contiguous old-direction candle group in the
  active wave. Early behavior change, NOT a confirmed structure reversal.
- **Tolerance = 0** for S+, C, B; equality cannot trigger a crossing.
- The chart shows only active MH/ML and material `S+`, `C`, `B` labels. The
  notification stream is a short high-level event feed; raw Swing/Inside Bar
  details remain in chart and exported JSON, not every notification.
- The **Main / Internal** state and current MH / ML / iSH / iSL are recomputed
  at each **closed** candle. No lookahead; unformed levels remain null.

The Major selection policy from V5.1 and the precise wave-boundary tie-break
for CISD remain **provisional**. They have reproducible tests, not universal
financial-market certification. The two 48-candle CSVs are price examples,
**not human-labeled trading decisions**. Canonical datasets and raw hashes are
unchanged; the analysis/audit version is `market_structure_advanced_v1_2`.

### One-file offline demo — no Docker, Python or network needed by the recipient

`dist/MSAS_Standalone_Offline.html` includes the current engine, EN/VI UI,
all four approved demo datasets, local file import/mapping and JSON export.
It works in a current Chromium-based browser without sending input data to a
remote server. XLSX uses its built-in first-sheet reader; timestamps/columns
which cannot be inferred safely must be confirmed by the user.

To rebuild the standalone HTML from the repository modules:

```powershell
& "C:\Program Files\Python310\python.exe" scripts/build_standalone.py
```

To run test suites without Docker:

```powershell
& "C:\Program Files\Python310\python.exe" scripts/qa_gate.py
node tests/test_mss_cisd.js
node tests/test_major_selection.js
```

Playwright is optional locally (`python scripts/offline_smoke.py` after QA
requirements/Chromium install); GitHub CI runs it on its own hosted runner.
Docker health and Windows LF/CRLF source-integrity checks remain in CI.

## V5.1 — Major/Internal status and pivot-anchored chart labels

- The **Main / Major** and **Internal** trend states are always visible at each CLOSED candle, even if that candle triggers no new event. Distinguish UP, DOWN and UNKNOWN; an awaiting/pending level is never fabricated.
- The notification panel also shows the current Major High/Low and Internal SH/SL with exact historical pivot timestamp and price. Horizontal MH/ML levels start from their pivot candles; markers are rendered on those candles only after the Major role was established.
- **Provisional Major selection fix**: after a Close break of an established Major boundary, choose the strongest already structurally confirmed SH/SL of the breaking wave, not merely the latest confirmed Swing. This fixes the regression where XAUUSD SH44 (3394.498) incorrectly displaced stronger confirmed SH34 (3396.648). The paired corrective Low under this provisional policy is SL37 (3373.545); this is a derived engine output, NOT user-certified annotation from the PPT diagram.
- A historical pivot may become Major only when its role is known: event `at` is never backdated to its original pivot index. `analysis_version` is now `market_structure_advanced_v1_1`. Canonical dataset schema stays v1.0.0. Both audit files have been regenerated; original raw CSVs are unchanged.
- Run `node tests/test_major_selection.js` and `python scripts/qa_gate.py --require-node`, then verify Chromium+Docker CI. See `docs/advanced/MAJOR_PIVOT_SELECTION.md` for source/assumptions and unresolved cases.

## What changed in V5

- Four built-in datasets instead of two. Two new 48-bar UTC files have exact raw copies under `samples/raw/`, normalized forms and immutable metadata under `samples/normalized/`.
- `static/advanced_engine.js` provides separate `external` and `internal` states, dynamic major/internal levels, protection levels, pending vs confirmed reversals, role-change audit and close-triggered alerts. **Data-dependent labels are provisional and subject to human approval.**
- V4 UI remains **one chart + one notification stream**; Major / Internal horizontal levels and new notifications are displayed inside the same panels; no extra dashboard cards.
- `schemas/*.schema.json` defines canonical dataset, advanced event and state shapes. `fixtures/advanced_slide13_synthetic.json` is a golden qualitative test with invented prices clearly marked `is_synthetic`.
- `audits/*.audit.json` contains explicit per-candle state chronology for both new 48-bar datasets; input SHA-256 and model version are recorded.

## Entry points by responsibility

| File | Responsibility |
|---|---|
| `app/importer.py` | Map arbitrary provider column names, normalize time and validate OHLC/Volume |
| `app/server.py` | Portable Python + Docker HTTP API / upload / dataset storage |
| `static/engine.js` | V4 source-locked local swings and Inside Bar; keep behavior stable |
| `static/advanced_engine.js` | V5 major/internal state machine; edit for approved advanced rule changes only |
| `static/studio.js` | Canvas chart, alerts and replay; presentation only |
| `static/chart-theme.js` | Exact candle palette; zero grids |
| `static/i18n.js` | EN / VI dictionary and event localization |
| `static/studio.css`, `static/index.html` | Layout and styles |
| `samples/raw` | Original user CSV files, never overwrite |
| `samples/normalized` | Canonical CSV/JSON and provenance manifests |
| `fixtures/` | Explicit expected behavior for synthetic tests |
| `schemas/` | Versioned JSON contracts |
| `audits/` | Immutable captured engine outputs at each closed candle |
| `docs/advanced/` | Slide-to-rule trace, design assumptions, acceptance/migration |

## Test / regenerate

```bash
python -m unittest discover -s tests -v
python scripts/build_canonical_samples.py
node tests/test_source_cases.js
node tests/test_sample_replay.js
node tests/test_advanced_structure.js
node scripts/export_structure.js samples/normalized/BTCUSD_M15_12h_2025-06-18_UTC.json audits/BTCUSD_M15_12h_2025-06-18_UTC.audit.json
```

Node.js is an **optional development dependency** for advanced tests and JSON audit generation, not a runtime dependency. `python -m unittest` and the web server only need Python standard library. UI browser tests run against a temporary real local server in GitHub Actions with Playwright/Chromium. This container runtime cannot access Docker Engine, so an actual image build is **not verified locally**; check GitHub Actions results before claiming Docker PASS.

## Boundaries and open policy

See `docs/advanced/SOURCE_TRACEABILITY.md`, `ARCHITECTURE_AND_DATA_CONTRACT.md`, and `TEST_PLAN_AND_DECISIONS.md`. Critical unresolved items: precise major-pivot tie-break, complete reversal confirmation across all structures, non-contiguous/nested structures, trading sessions and sideway definition. An unknown structure is not sideway. Treat all accepted structural pivots as **derived estimates**, not gold labels unless a human has reviewed them.

## Clone from GitHub and verify container

```powershell
git clone https://github.com/HuyThuan1203/MSAS.git
cd MSAS
git status
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://127.0.0.1:8080/api/health
Start-Process http://127.0.0.1:8080
```

Stop without deleting uploaded datasets: `docker compose down`. If port 8080 is already used by the old portable server, change the left-hand port mapping to `127.0.0.1:8081:8080` in `compose.yaml` and use `http://127.0.0.1:8081`.

GitHub Actions checks Python 3.10/3.12, Node-based source/advanced/theme/EN-VI tests, Chromium E2E at desktop/mobile sizes, and Docker build + health check. A successful remote CI is needed before claiming the Docker image builds on your machine.

### Source and data boundaries

The repository includes the two user-supplied 48-bar UTC sample files, their exact canonical output, importer edge-case fixtures, and versioned engine audits. Original PowerPoint files and preview screenshots are **not** published: redistributing the source decks requires separate authorization. Rule traceability is available in `docs/advanced/SOURCE_TRACEABILITY.md`. Market-structure classifications beyond closed-candle local pivots use **provisional** policies and are not trading instructions.
