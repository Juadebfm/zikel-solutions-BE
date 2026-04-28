#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <BASE_URL> <ADMIN_ACCESS_TOKEN>"
  echo "Example: $0 https://your-backend.onrender.com <jwt>"
  exit 1
fi

BASE_URL="${1%/}"
TOKEN="$2"

echo "1) health endpoint"
curl -fsS "${BASE_URL}/health" >/dev/null
echo "ok"

echo "2) tenants endpoint (admin auth)"
TENANTS_CODE="$(curl -sS -o /tmp/prod_tenants.json -w '%{http_code}' \
  -H "Authorization: Bearer ${TOKEN}" \
  "${BASE_URL}/api/v1/tenants?page=1&pageSize=1")"
[[ "${TENANTS_CODE}" == "200" ]] || { echo "Expected 200, got ${TENANTS_CODE}"; exit 1; }
echo "ok"

echo "3) vehicles endpoint available"
VEHICLES_CODE="$(curl -sS -o /tmp/prod_vehicles.json -w '%{http_code}' \
  -H "Authorization: Bearer ${TOKEN}" \
  "${BASE_URL}/api/v1/vehicles?page=1&pageSize=1")"
[[ "${VEHICLES_CODE}" == "200" ]] || { echo "Expected 200, got ${VEHICLES_CODE}"; exit 1; }
echo "ok"

echo "4) tasks endpoint available"
TASKS_CODE="$(curl -sS -o /tmp/prod_tasks.json -w '%{http_code}' \
  -H "Authorization: Bearer ${TOKEN}" \
  "${BASE_URL}/api/v1/tasks?page=1&pageSize=1")"
[[ "${TASKS_CODE}" == "200" ]] || { echo "Expected 200, got ${TASKS_CODE}"; exit 1; }
echo "ok"

echo "5) audit endpoint available"
AUDIT_CODE="$(curl -sS -o /tmp/prod_audit.json -w '%{http_code}' \
  -H "Authorization: Bearer ${TOKEN}" \
  "${BASE_URL}/api/v1/audit?page=1&pageSize=1")"
[[ "${AUDIT_CODE}" == "200" ]] || { echo "Expected 200, got ${AUDIT_CODE}"; exit 1; }
echo "ok"

echo "Production verification completed successfully."
