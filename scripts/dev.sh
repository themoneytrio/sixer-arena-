#!/usr/bin/env bash
# One command to run the whole stack: Postgres → migrate → seed → all 3 apps.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# First run: create the backend .env from the committed template.
[ -f "$ROOT/apps/backend/.env" ] || cp "$ROOT/apps/backend/.env.example" "$ROOT/apps/backend/.env"

echo "▶ Postgres"
bash "$ROOT/scripts/dev-db.sh"

echo "▶ Migrate"
pnpm --dir "$ROOT/apps/backend" exec prisma migrate deploy

echo "▶ Seed (single cricket turf + a week of demo bookings)"
pnpm --dir "$ROOT/apps/backend" seed

echo "▶ Launching backend :4000 · consumer :5173 · owner :5174"
pnpm --dir "$ROOT" dev
