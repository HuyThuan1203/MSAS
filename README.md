# Market Structure Studio V5 — Advanced Major / Internal

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
