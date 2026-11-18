# MSAS repo instructions (Claude Code / local agent)

Read `.claude/skills/msas-engineering/SKILL.md` before implementing market structure, dataset importer, UI or CI changes.

- **Source of truth:** original PPT-defined rules are described, with provenance, in `docs/advanced/SOURCE_TRACEABILITY.md`. Do not claim unsupported behaviors as source-backed.
- **Separation:** `app/importer.py` (normalize), `static/engine.js` (3-bar/Inside Bar), `static/advanced_engine.js` (provisional Major/Internal), `static/i18n.js` (display translation), `static/chart-theme.js` (palette), `static/studio.js` (display only).
- **No lookahead:** event `at` is the closed right-hand candle, not the pivot center. Preserve metadata, raw source hashes and timeline tests.
- **No silent fixes:** price/time ambiguities require mapping or explicit errors. Missing Volume is null, not 0.
- **Visible UI:** EN is default, VI is selectable. The chart canvas is solid `#c6d2df`, no grid; up white body 100%, down `#66bb6a` 90%, black borders 60%, black wicks 100%.
- **Testing:** run `python scripts/qa_gate.py --require-node` where Node is installed. Browser CI smoke and Docker health gates required before production claims. Record gaps rather than unsupported PASS.
- **Public repo safety:** never include raw confidential files, credentials, local artifacts, or source PPT binaries without explicit authorization. Keep repository scope only.

- **V5.1 active Major selection:** consult `docs/advanced/MAJOR_PIVOT_SELECTION.md`. Do not promote a weaker, more recent SH in place of a stronger confirmed candidate after a Close breakout. Validate exact pivot index/time and active Major/Internal status at every replay prefix. This policy remains provisional without user-labeled OHLC ground truth.

- **V5.2 MSS/CISD:** Read `docs/advanced/MSS_CISD_RULEBOOK.md` and the user's reversal PPT slides 3-8 before editing reversal labels. `S+` uses strict Close vs active opposing MH/ML (zero tolerance) and flips Main immediately. Wick-only `C` and delivery change `B` are NOT Major reversals. Only closed bars; do not backdate events.
- **Review:** Test two directions, multiple same-direction clusters, equality, no-lookahead, all four approved datasets, EN/VI chart labels, high-level notifications, Windows checkout and Docker CI.

- **Stress QA:** after any structural rule change, run `python scripts/qa_gate.py --stress --require-node` and inspect `qa-artifacts/stress-dashboard.html`. Never call provisional Major/Internal policies source-certified based only on randomized test PASS. Source traceability: `docs/quality/STRESS_QA_PLAN.md`. Synthetic CSVs are not training or ground truth labels. The user-approved XAU MH/ML regression remains mandatory.


- **V5.4 rolling Major regression:** always run `tests/test_major_rolling_reversal.js` and read `docs/advanced/MAJOR_PIVOT_SELECTION.md`. XAU40 at 25/40 requires DOWN, MH 4001.50 and ML 3991.10; XAU48 final requires MH 3396.648 and ML 3373.545. No-lookahead and S+ Close-only/tolerance=0 are hard gates. Do not fake an event time or force a second crossing. The corrective-pair selection remains provisional.
- **UI:** show BOTH MSS and CISD on the actual closed-bar chart (not just in the notification feed) and never drop coincident C+B; CI checks actual canvas text and in-chart signal indicator.
