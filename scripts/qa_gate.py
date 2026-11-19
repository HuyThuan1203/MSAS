#!/usr/bin/env python3
"""Single MSAS quality gate: stdlib local tests, optional browser and Docker.

Local (Python 3.10+, no admin or pip): python scripts/qa_gate.py
On CI: python scripts/qa_gate.py --browser --require-node
Docker requires a working Docker daemon: --docker
This command has no installation side effects; a failing/missing gate is explicit.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
NODE_SUITES = (
    "tests/test_source_cases.js",
    "tests/test_sample_replay.js",
    "tests/test_advanced_structure.js",
    "tests/test_major_selection.js",
    "tests/test_major_rolling_reversal.js",
    "tests/test_mss_cisd.js",
    "tests/test_immediate_swings.js",
    "tests/test_v6_rules.js",
    "tests/test_v6_causal_stream.js",
    "tests/test_v6_perf.js",
    "tests/test_ui_theme_i18n.js",
)


def run(label: str, argv: list[str], timeout: int = 120) -> dict:
    started = time.monotonic()
    try:
        completed = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True,
                                   encoding="utf-8", errors="replace",
                                   timeout=timeout, check=False)
        detail = ((completed.stdout or "") + (completed.stderr or "")).strip()
        status = "PASS" if completed.returncode == 0 else "FAIL"
        if detail:
            print(detail[-2500:])
        print(f"[{status}] {label} ({time.monotonic() - started:.2f}s)")
        return {"name": label, "status": status, "exit_code": completed.returncode}
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"[FAIL] {label}: {exc}")
        return {"name": label, "status": "FAIL", "error": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-node", action="store_true",
                        help="Fail if Node.js is not installed (recommended in CI)")
    parser.add_argument("--browser", action="store_true",
                        help="Run optional Playwright Chromium UI test against localhost server")
    parser.add_argument("--docker", action="store_true",
                        help="Build Docker image (requires Docker daemon)")
    parser.add_argument("--stress", action="store_true",
                        help="Run deterministic synthetic market/regression test and create report")
    parser.add_argument("--stress-cases", type=int, default=360,
                        help="Number of generated random OHLC scenarios (default 360)")
    parser.add_argument("--stress-bars", type=int, default=128,
                        help="Candles in each generated scenario (default 128)")
    parser.add_argument("--stress-seed", type=int, default=20261118,
                        help="Fixed random seed (default 20261118)")
    parser.add_argument("--json-report", type=Path, help="Write machine-readable QA report")
    args = parser.parse_args()
    results: list[dict] = []
    results.append(run("Python unittest: data/API/schema", [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"]))
    results.append(run("Python compile: backend and tests", [sys.executable, "-m", "compileall", "-q", "app", "scripts", "tests"]))
    node = shutil.which("node")
    if node:
        for file in sorted((ROOT / "static").glob("*.js")):
            results.append(run(f"Syntax {file.name}", [node, "--check", str(file)]))
        for suite in NODE_SUITES:
            results.append(run(suite, [node, suite]))
    else:
        status = "FAIL" if args.require_node else "SKIP"
        print(f"[{status}] Node.js not available; JS regression suite not executed")
        results.append({"name": "Node.js regression suite", "status": status,
                        "reason": "Optional for local runtime, required for full CI"})
    if args.stress:
        if not node:
            results.append({"name":"Deterministic market stress", "status":"FAIL", "reason":"Node.js required for stress"})
        else:
            results.append(run("Deterministic synthetic OHLC stress / S+ C B / no-lookahead",
                [node,"scripts/qa/stress_qa.js",f"--cases={args.stress_cases}",
                 f"--bars={args.stress_bars}",f"--seed={args.stress_seed}",
                 "--out=qa-artifacts/stress-report.json"],timeout=150))
            results.append(run("Generate reproducible stress dashboard and ledger",
                [sys.executable,"scripts/qa/report_stress.py",
                 "--report","qa-artifacts/stress-report.json",
                 "--output","qa-artifacts/stress-dashboard.html"],timeout=30))
    if args.browser:
        results.append(run("Playwright browser UI + API integration",
                           [sys.executable, "scripts/browser_smoke.py"], timeout=150))
    if args.docker:
        docker = shutil.which("docker")
        if docker:
            results.append(run("Docker build", [docker, "build", "-t", "msas:quality-gate", "."], timeout=240))
        else:
            print("[FAIL] Docker not installed")
            results.append({"name": "Docker build", "status": "FAIL", "reason": "Docker not installed"})
    report = {"tool": "msas-qa-gate", "version": "1.0", "checks": results,
              "summary": {name: sum(x["status"] == name for x in results)
                          for name in ("PASS", "FAIL", "SKIP")}}
    if args.json_report:
        args.json_report.parent.mkdir(parents=True, exist_ok=True)
        args.json_report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("RESULT", report["summary"])
    return int(report["summary"]["FAIL"] != 0)


if __name__ == "__main__":
    raise SystemExit(main())
