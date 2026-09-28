#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export $(grep -E '^TEST_DATABASE_URL=' .env | xargs)
export DATABASE_URL="$TEST_DATABASE_URL"
npx drizzle-kit push --force
