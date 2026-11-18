# MSAS V5.3 — Deterministic, source-traced QA and video evidence

**Reference materials:** original user-provided *Cấu trúc nến và Swing points*; *Ví dụ swing vô hiệu do Inside Bar*; *Cấu trúc nâng cao – Final* (ADV, 14 slides); *Mẫu hình xác nhận đảo chiều – Final* (REV, 8 slides). **Never publish the original PPT binary files** to the public repository. Canonical terminology: MSS S+, weak attempt C, early CISD B, Major (Main/External), Internal, swing eligibility, Close.

## 1. QA hierarchy — what can be proved

| Class | What is checked | Independent oracle / evidence | Result meaning |
|---|---|---|---|
| **Source-locked** | 3-bar closed SH/SL, mother Inside Bar invalidation, confirmed Close vs Major, S+/C/B and zero tolerance, HH/HL/LH/LL classifications | Explicit PPT slide conditions; standalone test cases | PASS means these conditions hold in tested cases |
| **Model invariants** | Event at valid CLOSED bar, confirmed pivots not future, no future events/role changes, strict OHLC validation | Recompute every sampled prefix independently and compare to full-history prefix | PASS means causal consistency, not market accuracy |
| **User-annotated** | XAUUSD 48-bar final MH SH34 3396.648 / ML SL37 3373.545; Main UP/Internal UP | Original screenshot + `tests/test_major_selection.js` and Chromium | PASS for **this** labeled sample only |
| **Provisional implementation** | Competing Major pivot selection; protected Internal and multi-wave split; Open-inside condition for C | Consistency / mutation regressions, not an authoritative PPT oracle | **REVIEW**, even when tests don't fail |
| **Source not given** | Exact OHLC for PPT diagram 1–14, nested waves, historical tick buffers, competing nested Major wave thresholds | No matching human-labeled candles | **NOT VERIFIED**; do not claim PASS |

## 2. Data generation and replay

- `scripts/qa/stress_qa.js`: self-contained Node.js Xorshift32 generator. Seed and scenario ID determine the **same CSV candles** on Windows, Linux and CI. Uses 4-decimal synthetic OHLC, 15-minute UTC timestamps and `Volume:null`. Each candle satisfies `low <= min(open,close) <= max(open,close) <= high`; never fills missing real candles.
- 12 regimes, balanced by index: `up`, `down`, `range`, `volatile`, `whipsaw`, `inside`, `spike`, `gaps` (price gaps, not missing timestamps), `plateau`, `reversal`, `squeeze`, `mixed`.
- Default: **360 scenarios × 128 candles = 46,080 synthetic OHLC** (plus **960 source-oracle trials** for S+/C/B, mirrored directions, equality and multi-cluster reference).
- Mandatory `assert` checks from source rules: confirmed Swing timing and strict neighbors; Close S+ vs opposing Major (prior candle position NOT required); C wick and Close inside; B Close through the first Open of last same-direction cluster; forward-only timeline; no lookahead of events/roles and dynamic Major/Internal levels; no fabricated pending Major pivot.
- `tests/test_random_import_contract.py`: 96 valid varied CSV inputs (uppercase/lowercase, reordered columns, absent/empty Volume) and 72 invalid price/timestamp cases. `tests/test_generated_fixture_manifest.py`: SHA-256 and importer checks on 24 deterministic CSV fixtures, two per regime.
- `fixtures/generated/manifest.json` tags **every file** `is_synthetic:true`, stores per-file source hash, base seed and source generator. This is *not* a gold-labeled trend benchmark.
- `scripts/qa/report_stress.py`: self-contained HTML report, CSV per-case ledger, Markdown summary. `stress-report.json` stores all seeds/conditions, counter totals, per-case states, source vs provisional caveats and representative unresolved case IDs.

## 3. Independent acceptance gates

| Gate | Must hold |
|---|---|
| Source S+/C/B | Both directions, strict threshold, equality no break, S+ changes Main immediately; C/B do not change Main; opposite Major retained and new opposing pivot pending after S+ |
| CISD multi-cluster | Reference is FIRST Open of LAST consecutive old-direction group; previous groups must not override it |
| Causality | An event at `t` never appears before `t`; structural role and pivot `confirmedAt` never future; replay prefix matches full history for sampled cutoffs |
| Structural role | Main and Internal are independent; pending MH/ML is `null` after S+, retained old threshold during continuation pending; source annotation XAU remains unchanged |
| Data contracts | 4 real sample datasets preserve raw SHA; 24 synthetic CSV fixtures load without Volume; invalid OHLC/duplicate time fails rather than auto-correcting |
| Presentation | Chromium desktop/mobile: theme, EN/VI, dynamic Major status, S+/C/B on chart, CSV upload, offline HTML has no HTTP request |
| Delivery | Linux Python 3.10/3.12, Node source + stress, Windows `autocrlf` provenance, Chromium, Docker build and health all pass CI before claiming green release |

`policyGaps.alreadyOutsideAfterRoleAssignment` is retained in the JSON for backwards
compatibility with old QA tooling, but in V5.4 these cases are **covered
regressions**, not unresolved policy gaps: the independent oracle asserts the
current CLOSED price strictly beyond the active opposing Major produces S+.
The historical crossing-only guard missed these situations; the corrected
engine no longer requires a second crossing. This is separate from the
**still-provisional** pairing of the next Major from competing confirmed swings.
See `tests/test_major_rolling_reversal.js` for the user-supplied XAU40/48
replay checkpoints and source-guided no-lookahead contract.

## 4. One-command local and CI

```powershell
python scripts/qa_gate.py --require-node --stress --stress-cases 360 --stress-bars 128 --stress-seed 20261118 --json-report qa-artifacts/full-gate.json
# or higher volume, deterministic:
node scripts/qa/stress_qa.js --cases=1200 --bars=128 --seed=20261119 --out=qa-artifacts/stress-secondary.json
python scripts/qa/report_stress.py --report qa-artifacts/stress-report.json --output qa-artifacts/stress-dashboard.html
```

On every push/PR the GitHub workflow runs two deterministic seeds plus original QA. Every Sunday at 03:21 UTC it runs **1200 cases per seed**. `workflow_dispatch` allows manual selection of a stress-case count (120 / 360 / 1200). The job saves `stress-report.json`, a second seed, filterable HTML, CSV, Markdown and representative synthetic samples in GitHub **workflow artifacts**, not by modifying runtime data in the repository. The source code and 24 representative fixtures remain in Git.

## 5. Video evidence (5–10 minutes)

`python scripts/qa/capture_evidence.py` captures *real* Chromium UI state and screenshots from a standalone offline HTML built by `scripts/build_standalone.py`. It visits XAU bars with B, S+, C, Major updates and the final confirmed XAU state, switches EN/VI and imports synthetic CSV. Its JSON manifest records exactly observed UI labels plus screenshot SHA-256; it explicitly asserts zero HTTP requests/JS page errors. Browser automation in local sandbox uses `page.set_content` because `file://` and localhost navigation can be restricted by host policies; CI additionally runs regular browser E2E.

`python scripts/qa/render_evidence_video.py --report qa-artifacts/stress-report.json` creates an approximately **6–8 minute** H264/AAC MP4 with **Vietnamese generated narration**, 11 documented chapters, real screenshot evidence, and an explicitly designated **short real browser recording**, plus a manifest with video and report hashes. It is an **edited QA walkthrough**, not a continuous 7-minute live screen recording, and should never be described otherwise.

Optional QA-only dependencies (never required for the app or normal stress tests): Python Pillow, Playwright/Chromium, FFmpeg and eSpeak voice. GitHub Actions manual **Run workflow** installs these on an isolated runner and uploads the resulting video and manifest. Media is not stored as a large blob in Git; see `qa-artifacts/` ignored by Git.

## 6. Limits and next validation requests

- Random inputs check **logical self-consistency and source-defined branch behavior**, **not precision, recall or financial prediction quality**. No market-trading accuracy percentage is inferred.
- The PPT example 1–14 does not include machine-readable OHLC/tick times for every point. A synthetic fixture proves a qualitative state transition, **not** pixel-to-price truth for the illustration.
- Multiple levels of nested Internal waves and competing Major candidates remain implementation policies requiring examples signed off by the user. A successful test with 46,080 random candles **does not approve these rules**.
- CI's 128-candle case size is not a performance benchmark for the application's accepted maximum of 25k candles.
- If any gate fails, archive seed, case ID, first offending closed candle and error stack; **never alter a sample hash to make tests pass, never auto-merge a failed gate**, and do not hide REVIEW states.
