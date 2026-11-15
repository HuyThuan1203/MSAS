# MSAS repo instructions (Claude Code / local agent)

Read `.claude/skills/msas-engineering/SKILL.md` before implementing market structure, dataset importer, UI or CI changes.

- **Source of truth:** original PPT-defined rules are described, with provenance, in `docs/advanced/SOURCE_TRACEABILITY.md`. Do not claim unsupported behaviors as source-backed.
- **Separation:** `app/importer.py` (normalize), `static/engine.js` (3-bar/Inside Bar), `static/advanced_engine.js` (provisional Major/Internal), `static/i18n.js` (display translation), `static/chart-theme.js` (palette), `static/studio.js` (display only).
- **No lookahead:** event `at` is the closed right-hand candle, not the pivot center. Preserve metadata, raw source hashes and timeline tests.
- **No silent fixes:** price/time ambiguities require mapping or explicit errors. Missing Volume is null, not 0.
- **Visible UI:** EN is default, VI is selectable. The chart canvas is solid `#c6d2df`, no grid; up white body 100%, down `#66bb6a` 90%, black borders 60%, black wicks 100%.
- **Testing:** run `python scripts/qa_gate.py --require-node` where Node is installed. Browser CI smoke and Docker health gates required before production claims. Record gaps rather than unsupported PASS.
- **Public repo safety:** never include raw confidential files, credentials, local artifacts, or source PPT binaries without explicit authorization. Keep repository scope only.
