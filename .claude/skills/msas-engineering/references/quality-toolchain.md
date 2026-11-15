# MSAS quality toolchain (minimal core, optional integration)

## One command, no administrator and no pip requirements

From the project root, run `python scripts/qa_gate.py` using Python 3.10+.

The gate executes Python unittest, Python syntax compilation, and (if Node.js is installed) strict JS syntax and source/structure/translation regression. It prints `SKIP` instead of a misleading success when Node.js is missing. `--require-node` makes Node mandatory for CI.

For audit automation, add `--json-report qa-artifacts/qa-report.json`. `qa-artifacts/` is ignored by Git.

## Browser integration (optional on the local machine; CI required)

`python -m pip install -r requirements-qa.txt` and `python -m playwright install chromium`; then `python scripts/qa_gate.py --browser --require-node`.

The browser suite boots an isolated local server with a temporary port and data directory. It checks EN default/VI switch, canvas background `#c6d2df`, BTC/XAU navigation, playback speed bounds, upload without Volume, and JS page errors at desktop/mobile viewports. It does not use a cloud or trading API. Screenshots are saved to ignored `qa-artifacts/`.

## Docker / GitHub CI

`python scripts/qa_gate.py --docker --require-node` additionally builds a Docker image when Docker Engine is available. On GitHub Actions, Python 3.10/3.12, Node 20, Chromium UI smoke and Docker build/HTTP health are separate gates; failures must not be reported as PASS. Browser installation occurs on hosted GitHub CI runners, not the company laptop.

## Explicit boundaries

- The historical engine has a **provisional** same-type pivot resolution rule, separate from source-locked 3-bar swings and Inside Bar.
- The advanced Major/Internal engine is an **interpretation** that needs user-validated pivot fixtures, especially for reversal and role upgrades.
- The 48-bar BTCUSD and XAUUSD samples contain no certified trading decisions or ground-truth Major/Internal labels. Do not mark derived audit as ground truth.
- Do not publish original PowerPoint decks or non-approved private files to the public repository.
- Keep the legacy portable launcher and no-dependencies Python runtime available.
- Avoid automatically sending market datasets, identifiers, or user actions to analytics vendors.

## Development workflow

1. Keep new behavior in a narrow module. Confirm test evidence before modifying source-locked pivot logic.
2. Add a fixture for each bug or new market rule; assert exact event `at` close timestamp and non-lookahead.
3. Use `static/i18n.js` for every EN and VI visible label; do not translate by parsing Vietnamese audit strings.
4. Keep chart theme tokens in `static/chart-theme.js`; verify canvas colors pixel-exactly.
5. Run `python scripts/qa_gate.py --require-node` before commit, then validate browser and Docker in CI.
6. Save raw CSV verbatim; normalize without inventing Volume or missing candles; update hashes only for new approved data.
7. Publish via feature branch and PR. Do not force-push `main`; require CI green and review for algorithm changes.
