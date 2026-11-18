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
