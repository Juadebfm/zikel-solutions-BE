#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <PRISMA_SCHEMA_PATH>"
  echo "Example: $0 prisma/schema.prisma"
  exit 1
fi

SCHEMA_PATH="$1"

echo "== Prisma migrate status =="
npx prisma migrate status --schema "${SCHEMA_PATH}"

echo "== Prisma migrate deploy (staging dry run) =="
npx prisma migrate deploy --schema "${SCHEMA_PATH}"

echo "== Rollback simulation guidance =="
echo "1) Mark latest migration as rolled back (staging only):"
echo "   npx prisma migrate resolve --rolled-back <migration_name> --schema ${SCHEMA_PATH}"
echo "2) Re-apply migrations:"
echo "   npx prisma migrate deploy --schema ${SCHEMA_PATH}"
echo "3) Verify status:"
echo "   npx prisma migrate status --schema ${SCHEMA_PATH}"
