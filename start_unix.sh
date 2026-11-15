#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose up --build -d
printf 'Open http://localhost:8080 in your browser.\n'
