#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v conda-lock >/dev/null 2>&1; then
  echo "conda-lock is required. Install with: conda install -c conda-forge conda-lock" >&2
  exit 1
fi

conda-lock lock \
  -f water_rights_ci.yml \
  -p linux-64 \
  --kind explicit \
  --filename-template "ci/water_rights_ci-{platform}.lock" \
  --mamba

conda-lock lock \
  -f water_rights.yml \
  -p linux-64 \
  --kind explicit \
  --filename-template "ci/water_rights-{platform}.lock" \
  --mamba

echo "Updated ci/water_rights_ci-linux-64.lock and ci/water_rights-linux-64.lock"
