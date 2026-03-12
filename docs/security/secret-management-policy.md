# Secret and Configuration Security Policy

## Rules

- No secrets in git (`.env.example` contains placeholders only).
- Runtime secrets are injected via environment/secret manager per environment.
- Dev/staging/prod use isolated credentials and isolated data stores.
- Rotation cadence:
  - JWT secrets: at least quarterly or immediately on compromise.
  - API keys (email/AI): at least quarterly or per provider policy.
  - DB credentials: at least quarterly and on personnel/incident events.

## Startup Guardrails

- Env validation fails fast if mandatory security vars are missing or malformed.
- In staging/production:
  - DB URLs must enforce TLS (`sslmode=require`).
  - Public URLs and CORS origins must be `https://`.
  - CORS wildcard (`*`) is disallowed.
- AI cannot run with `AI_ENABLED=true` unless `AI_API_KEY` is present.

## CI Controls

- Gitleaks scan (`.github/workflows/security-ci.yml`) blocks pushes with exposed secrets.
- `npm audit --audit-level=high` in CI blocks known high-risk dependency vulnerabilities.
