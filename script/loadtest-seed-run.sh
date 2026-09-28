#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export $(grep -E '^(TEST_DATABASE_URL|JWT_SECRET)=' .env | xargs)
export DATABASE_URL="$TEST_DATABASE_URL"
npx tsx script/loadtest-seed.ts
