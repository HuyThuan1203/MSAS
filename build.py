#!/usr/bin/env python3
"""One-shot setup for a fresh clone of MSAS.

    python build.py            # install deps, create config + data folder, self-test
    python build.py --run      # ... then start the server (python run.py)
    python build.py --qa       # also install optional browser-QA tools (Playwright + Chromium)

Idempotent: never overwrites an existing msas.config.json or market data.
The runtime itself is Python standard library only; requirements.txt lists any
runtime packages (currently none), requirements-qa.txt the optional QA tools.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MIN_PY = (3, 10)


def step(title: str) -> None:
    print(f'\n== {title}', flush=True)


def requirements(path: Path) -> list[str]:
    if not path.is_file():
        return []
    return [l.strip() for l in path.read_text(encoding='utf-8').splitlines() if l.strip() and not l.lstrip().startswith('#')]


def pip_install(path: Path) -> None:
    pkgs = requirements(path)
    if not pkgs:
        print(f'{path.name}: nothing to install')
        return
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(path)], check=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Set up MSAS on this machine.')
    ap.add_argument('--qa', action='store_true', help='install optional browser QA tools (Playwright + Chromium)')
    ap.add_argument('--run', action='store_true', help='start the server when setup succeeds')
    ap.add_argument('--skip-tests', action='store_true', help='skip the offline self-test')
    a = ap.parse_args(argv)

    step('Python')
    if sys.version_info < MIN_PY:
        print(f'Python {MIN_PY[0]}.{MIN_PY[1]}+ required, found {sys.version.split()[0]}')
        return 1
    print(sys.executable, sys.version.split()[0])

    step('Python packages')
    pip_install(ROOT / 'requirements.txt')
    if a.qa:
        pip_install(ROOT / 'requirements-qa.txt')
        subprocess.run([sys.executable, '-m', 'playwright', 'install', 'chromium'], check=True)

    step('Configuration')
    cfg_file = ROOT / 'msas.config.json'
    if cfg_file.exists():
        print(f'keep existing {cfg_file.name}')
    else:
        shutil.copyfile(ROOT / 'msas.config.example.json', cfg_file)
        print(f'created {cfg_file.name} (real-time ON; edit it or use "python run.py --realtime false")')

    sys.path.insert(0, str(ROOT))
    from market_gateway import config as C
    from market_gateway.store import ensure_layout
    cfg = C.load(cfg_file)

    step('Data folder')
    root = C.data_dir(cfg)
    ensure_layout(root)
    print(f'{root}  (live/, uploads/; retention {cfg["storage"]["retention_days"]} days)')

    step('Node.js (optional: structure tests and offline smoke)')
    node = shutil.which('node')
    print(node or 'not found - the app runs without it; install Node 18+ to run the JS test suite')

    step('Offline single-file HTML')
    subprocess.run([sys.executable, str(ROOT / 'scripts' / 'build_standalone.py')], check=True)

    if not a.skip_tests:
        step('Self-test (offline, no network)')
        r = subprocess.run([sys.executable, '-m', 'unittest', '-q', 'tests.test_live_gateway'], cwd=ROOT)
        if r.returncode:
            print('Self-test FAILED')
            return r.returncode

    step('Done')
    print('Start:  python run.py                 (real-time per msas.config.json)')
    print('        python run.py --realtime false  (replay/import only)')
    if a.run:
        return subprocess.run([sys.executable, str(ROOT / 'run.py')]).returncode
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
