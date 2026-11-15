#!/usr/bin/env python3
"""Build a reviewable text-only publication manifest; never touches git or secrets."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRS = {'.git', '__pycache__', 'qa-artifacts', 'node_modules', '.venv', 'venv', '.pytest_cache', '.mypy_cache'}
BLOCK_EXT = {'.pptx', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.key', '.pfx', '.pem', '.pyc', '.sqlite', '.db'}
BLOCK_NAMES = {'.env', '.env.local', '.env.production', 'credentials.json', 'secrets.json'}
ALLOW_EXT = {'.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.js', '.py', '.css', '.html', '.sh', '.bat', '.toml'}
ALLOW_NAMES = {'Dockerfile', 'VERSION', '.gitignore', '.dockerignore', '.gitkeep'}


def create_manifest():
    result = []
    for candidate in ROOT.rglob('*'):
        if not candidate.is_file():
            continue
        relative = candidate.relative_to(ROOT).as_posix()
        if any(part in EXCLUDED_DIRS for part in candidate.parts):
            continue
        if any(part.startswith('.env') for part in candidate.parts):
            continue
        if candidate.name in BLOCK_NAMES or candidate.suffix.lower() in BLOCK_EXT:
            continue
        if candidate.suffix.lower() not in ALLOW_EXT and candidate.name not in ALLOW_NAMES:
            raise ValueError('Not on publication text allowlist: ' + relative)
        content = candidate.read_bytes()
        if b'\x00' in content:
            raise ValueError('Binary content is not allowed: ' + relative)
        text = content.decode('utf-8')
        if '-----BEGIN ' + 'PRIVATE KEY-----' in text or ('github' + '_pat_') in text:
            raise ValueError('Sensitive marker encountered in: ' + relative)
        result.append({'path': relative, 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)})
    return sorted(result, key=lambda record: record['path'])


if __name__ == '__main__':
    data = create_manifest()
    print(json.dumps({'files': len(data), 'total_bytes': sum(x['bytes'] for x in data), 'manifest': data}, indent=2))
