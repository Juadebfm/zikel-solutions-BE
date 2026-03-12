#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <BASE_URL> [ACCESS_TOKEN]"
  echo "Example: $0 https://zikel-solutions-be.onrender.com <jwt>"
  exit 1
fi

BASE_URL="${1%/}"
ACCESS_TOKEN="${2:-}"

echo "== Health =="
curl --max-time 15 -fsS "${BASE_URL}/health" >/dev/null
echo "ok"

echo "== Unknown endpoint returns 404 =="
UNKNOWN_CODE="$(curl --max-time 15 -sS -o /tmp/security_unknown.json -w '%{http_code}' "${BASE_URL}/api/v1/not-a-real-route")"
[[ "${UNKNOWN_CODE}" == "404" ]] || { echo "Expected 404 for unknown route, got ${UNKNOWN_CODE}"; exit 1; }
echo "ok"

echo "== Auth input validation =="
VALIDATION_CODE="$(curl --max-time 15 -sS -o /tmp/security_validation.json -w '%{http_code}' \
  -X POST "${BASE_URL}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  --data '{"email":"bad","password":"short"}')"
if [[ "${VALIDATION_CODE}" != "422" && "${VALIDATION_CODE}" != "400" ]]; then
  echo "Expected 400/422 for invalid register payload, got ${VALIDATION_CODE}"
  exit 1
fi
echo "ok"

if [[ -n "${ACCESS_TOKEN}" ]]; then
  echo "== Authz guard check =="
  FORBIDDEN_CODE="$(curl --max-time 15 -sS -o /tmp/security_forbidden.json -w '%{http_code}' \
    -X POST "${BASE_URL}/api/v1/tenants" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"name":"forbidden-check","country":"UK"}')"
  if [[ "${FORBIDDEN_CODE}" != "403" && "${FORBIDDEN_CODE}" != "401" ]]; then
    echo "Expected 401/403 for forbidden privileged action, got ${FORBIDDEN_CODE}"
    exit 1
  fi
  echo "ok"
fi

echo "Security smoke checks passed."
