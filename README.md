# Zikel Solutions Backend

Production backend for a **multi-tenant care home management platform** built with Fastify, TypeScript, Prisma, and PostgreSQL.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Fastify 5.7 |
| Language | TypeScript 5.9 |
| ORM | Prisma 7.4 |
| Database | PostgreSQL (Neon) |
| Auth | JWT + Argon2id + MFA |
| Validation | Zod 4.3 |
| Email | Resend |
| File Storage | AWS S3 (presigned URLs) |
| Logging | Pino |
| API Docs | OpenAPI 3.0.3 / Swagger UI |
| Testing | Vitest |
| CI/CD | GitHub Actions |
| Hosting | Fly.io (Amsterdam) |
| Container | Docker (node:20-alpine) |

---

## Getting Started

### Prerequisites

- Node.js 20.x
- PostgreSQL database (or a [Neon](https://neon.tech) account)

### Installation

```bash
git clone https://github.com/Juadebfm/zikel-solutions-BE.git
cd zikel-solutions-BE
npm install
```

### Environment Setup

```bash
cp .env.example .env
```

Edit `.env` and configure the required variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Pooled PostgreSQL connection string |
| `DIRECT_URL` | No | Direct connection for migrations (bypasses PgBouncer) |
| `JWT_SECRET` | Yes | Min 32 chars (`openssl rand -hex 32`) |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins |
| `RESEND_API_KEY` | Prod only | Email provider API key |
| `RESEND_FROM_EMAIL` | Prod only | Sender email address |

See [.env.example](.env.example) for the full list of configuration options including AI, file uploads, security alerts, and Swagger settings.

### Database Setup

```bash
npm run db:migrate        # Run migrations (development)
npm run db:seed           # Seed initial data
npm run db:seed:izu-rich  # Seed rich test data (optional)
```

### Run

```bash
npm run dev       # Development (watch mode)
npm run build     # Compile TypeScript
npm start         # Production
```

The server starts at `http://localhost:3000`. API docs are available at `http://localhost:3000/docs` in development.

---

## Project Structure

```
src/
  config/
    env.ts                    # Zod environment validation
  lib/                        # Shared utilities
    prisma.ts                 # Prisma client + audit hooks
    errors.ts                 # HTTP error helper
    tokens.ts                 # JWT token utilities
    password.ts               # Argon2id + bcrypt hashing
    email.ts                  # Resend email service
    uploads.ts                # S3 presigned URL generation
    request-context.ts        # AsyncLocalStorage for request tracking
    tenant-context.ts         # Tenant isolation + resolution
    break-glass.ts            # Super-admin emergency access
    security-alert-pipeline.ts # Webhook dispatch for security events
    audit-metadata.ts         # Request context enrichment for audit logs
    sensitive-read-audit.ts   # Non-blocking read access logging
    webhook-signature.ts      # HMAC-SHA256 signing
    logger.ts                 # Pino logger
  middleware/
    rbac.ts                   # Role-based access control
    mfa.ts                    # MFA enforcement for privileged sessions
  modules/                    # Feature modules (routes + schema + service)
    auth/                     # Registration, login, OTP, MFA, tokens
    me/                       # Current user profile & sessions
    tenants/                  # Multi-tenant CRUD, memberships, invites
    care-groups/              # Org units grouping homes
    homes/                    # Care facilities
    employees/                # Staff management
    young-people/             # Residents (children in care)
    vehicles/                 # Fleet management
    tasks/                    # Task management + approval workflows
    forms/                    # Dynamic form templates
    uploads/                  # Direct-to-S3 file uploads
    daily-logs/               # Daily documentation
    roles/                    # Tenant-scoped custom roles
    summary/                  # Personal KPIs, todos, approvals
    dashboard/                # Aggregated stats + widgets
    announcements/            # System announcements + read receipts
    audit/                    # Audit logs, security alerts, break-glass
    ai/                       # AI-assisted guidance
    integrations/             # Inbound security alert webhooks
    help-center/              # Support tickets + FAQ articles
    notifications/            # Platform + tenant notifications with polling
    webhooks/                 # Tenant-configurable webhook management
    public/                   # Demo booking, waitlist, contact (no auth)
  openapi/
    shared.schemas.ts         # Registered JSON schemas (25+)
    tags.ts                   # OpenAPI tag definitions
  plugins/
    swagger.ts                # Swagger UI + OpenAPI spec
    auth.ts                   # JWT authentication
    cors.ts                   # CORS configuration
    helmet.ts                 # Security headers
    rate-limit.ts             # Rate limiting
  routes/
    index.ts                  # Module registration (/api/v1)
    health.ts                 # Health probes
  types/
    index.ts                  # Shared types (JwtPayload, responses)
  server.ts                   # Entry point
prisma/
  schema.prisma               # Database schema (31 models)
  migrations/                 # 22 migration files
  seed.ts                     # Base seed data
tests/                        # 18 Vitest test suites
scripts/                      # Seeding & operational scripts
docs/                         # Frontend integration guides
```

---

## API Overview

All API routes are prefixed with `/api/v1`. Health checks are at the root.

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Liveness probe |
| `/api/v1/auth` | Varies | Registration, login, OTP, MFA, token refresh |
| `/api/v1/me` | Yes | Current user profile, passwords, sessions |
| `/api/v1/tenants` | Yes | Tenant CRUD, memberships, invites |
| `/api/v1/care-groups` | Yes | Org unit management |
| `/api/v1/homes` | Yes | Care facility CRUD + sub-resources |
| `/api/v1/employees` | Yes | Staff management, DBS tracking |
| `/api/v1/young-people` | Yes | Resident profiles (contact, health, education) |
| `/api/v1/vehicles` | Yes | Fleet management, MOT/insurance tracking |
| `/api/v1/tasks` | Yes | Task management + approval workflows |
| `/api/v1/forms` | Yes | Dynamic form templates |
| `/api/v1/uploads` | Yes | Presigned URL sessions for S3 uploads |
| `/api/v1/daily-logs` | Yes | Daily documentation |
| `/api/v1/roles` | Yes | Tenant-scoped role management |
| `/api/v1/summary` | Yes | Personal KPIs, todos, approvals |
| `/api/v1/dashboard` | Yes | Aggregated stats + custom widgets |
| `/api/v1/announcements` | Yes | System announcements |
| `/api/v1/audit` | Yes | Audit logs, security alerts, break-glass |
| `/api/v1/ai` | Yes | AI-assisted guidance |
| `/api/v1/integrations` | HMAC | Inbound security alert webhooks |
| `/api/v1/help-center` | Yes | Support tickets + FAQ articles |
| `/api/v1/notifications` | Yes | Notification listing, read tracking, preferences, broadcast |
| `/api/v1/webhooks` | Yes | Webhook endpoint management + delivery logs |
| `/api/v1/public` | No | Demo booking, waitlist, contact |

### Response Envelope

All responses follow a standard envelope:

```json
// Success
{
  "success": true,
  "data": { ... },
  "meta": { "total": 50, "page": 1, "pageSize": 20, "totalPages": 3 }
}

// Error
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Resource not found." }
}
```

---

## Authentication & Authorization

### Auth Flow

1. **Register** (`POST /auth/register`) — Creates org + user, dispatches OTP email
2. **Verify OTP** (`POST /auth/verify-otp`) — 6-digit code, 10-minute expiry
3. **Login** (`POST /auth/login`) — Returns JWT access + refresh tokens
4. **Refresh** (`POST /auth/refresh`) — Rotate tokens before access token expires

### Onboarding Flows

| Flow | Description |
|------|-------------|
| **Care Home Owner** | Register with org details, verify OTP, land as `tenant_admin` |
| **Admin-Provisioned Staff** | Admin creates employee, staff activates via `POST /auth/staff-activate` |
| **Invite Link** | Staff clicks invite link, registers via `POST /auth/join-via-invite-link` |

### Roles

**Global roles**: `super_admin`, `admin`, `manager`, `staff`
**Tenant roles**: `tenant_admin`, `sub_admin`, `staff`

MFA is enforced for privileged sessions (`super_admin`, `tenant_admin`) on all mutation operations.

---

## Multi-Tenancy

- Every tenant-owned resource is scoped by `tenantId`
- JWT payload carries `tenantId` and `tenantRole`
- Cross-tenant access returns `404` (data leakage prevention)
- **Break-glass access**: Super-admins can override tenant scope for emergency debugging, with automatic expiry and immutable audit trail

---

## Security

- **JWT**: Short-lived access tokens (5m) + refresh tokens (12h) + idle timeout (15m)
- **Password policy**: 12+ chars, mixed case, number, special character
- **Password hashing**: Argon2id (64MB memory, timeCost 3) with legacy bcrypt support
- **Account lockout**: 5 failed login attempts triggers 30-minute lockout
- **Rate limiting**: Global 100 req/60s + stricter per-route limits on auth endpoints
- **Audit logging**: All operations tracked immutably with request context
- **Security alert pipeline**: HMAC-SHA256 signed webhook dispatch on anomalies (cross-tenant blocks, break-glass access, repeated auth failures)
- **Helmet**: Security headers on all responses
- **CORS**: Strict origin allowlist in production
- **TLS**: Enforced on database connections in staging/production

---

## Database

23 Prisma models across these domains:

| Domain | Models |
|--------|--------|
| Auth & Users | `User`, `RefreshToken`, `OtpCode` |
| Multi-Tenancy | `Tenant`, `TenantMembership`, `TenantInvite`, `TenantInviteLink` |
| Org Structure | `CareGroup`, `Home`, `Role` |
| People | `Employee`, `YoungPerson` |
| Operations | `Task`, `TaskReviewEvent`, `TaskReference`, `FormTemplate`, `Vehicle` |
| Files | `UploadedFile` |
| Communication | `Announcement`, `AnnouncementRead` |
| Analytics | `Widget` |
| Audit & Security | `AuditLog`, `SecurityAlertDelivery` |

### Migration Commands

```bash
npm run db:migrate          # Create + apply dev migration
npm run db:migrate:deploy   # Apply pending migrations (production)
npm run db:push             # Push schema directly (prototyping)
npm run db:studio           # Open Prisma Studio UI
```

---

## File Uploads

Direct-to-S3 upload flow (backend never handles file bytes):

1. **FE** requests a presigned PUT URL → `POST /api/v1/uploads/sessions`
2. **FE** uploads file directly to S3 using the presigned URL
3. **FE** marks upload complete → `POST /api/v1/uploads/:id/complete`
4. **FE** attaches `fileId` to tasks, signatures, or announcements

Supports S3-compatible providers (AWS S3, Cloudflare R2, Wasabi, MinIO).

---

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

18 test suites covering:
- Authentication & registration flows
- RBAC enforcement & tenant isolation
- CRUD operations across all entities
- Approval workflows & batch operations
- Security alert pipeline & webhook verification

---

## CI/CD

GitHub Actions pipeline (`.github/workflows/security-ci.yml`):
1. **Build & Test**: typecheck, lint, test
2. **Dependency Scan**: `npm audit` (high severity threshold)
3. **Secret Scan**: Gitleaks to detect hardcoded secrets

Triggered on PRs and pushes to `main`.

---

## Deployment

### Docker

```bash
docker build -t zikel-solutions-be .
docker run -p 3000:3000 --env-file .env zikel-solutions-be
```

Multi-stage build: Alpine base, non-root user, production dependencies only, built-in healthcheck.

### Fly.io

```bash
fly deploy
```

Configured for Amsterdam region, shared CPU (1 vCPU, 1GB RAM), auto-scaling with min 1 machine, forced HTTPS.

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run db:seed` | Base seed data |
| `npm run db:seed:izu-rich` | Rich test data (tenants, homes, employees, residents, tasks) |
| `npm run db:archive-probe-accounts` | Archive old probe/test accounts |

---

## Documentation

| Document | Description |
|----------|-------------|
| [FESpec.md](FESpec.md) | Frontend integration spec (auth flows, endpoint map, role matrix) |
| [docs/fe-guide-core-entities.md](docs/fe-guide-core-entities.md) | FE guide for Homes, Young People, Vehicles, Employees, Roles |
| [docs/FE_RBAC_UX_ENDPOINT_PLAYBOOK.md](docs/FE_RBAC_UX_ENDPOINT_PLAYBOOK.md) | RBAC capability matrix and UX flows |
| [docs/ACKNOWLEDGEMENTS_WORKFLOW_SPEC.md](docs/ACKNOWLEDGEMENTS_WORKFLOW_SPEC.md) | Approval/acknowledgement workflow spec |
| [form-designer.md](form-designer.md) | Form Designer feature spec |
| [taskplan.md](taskplan.md) | Task types and backend readiness |
| [security.md](security.md) | Security audit report |

---

## License

ISC
