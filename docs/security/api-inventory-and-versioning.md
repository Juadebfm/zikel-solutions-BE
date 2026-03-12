# API Inventory and Versioning

## Versioning Strategy

- Active API namespace: `/api/v1/*`.
- Health probes are intentionally outside version scope: `/health`.
- Unknown/deprecated paths are denied by centralized 404 handler with sanitized response.

## Inventory (v1)

- Auth: `/api/v1/auth/*`
- Me: `/api/v1/me/*`
- Public forms: `/api/v1/public/*`
- AI assistant: `/api/v1/ai/*`
- Summary: `/api/v1/summary/*`
- Dashboard: `/api/v1/dashboard/*`
- Tenants and memberships: `/api/v1/tenants/*`
- Care groups: `/api/v1/care-groups/*`
- Homes: `/api/v1/homes/*`
- Employees: `/api/v1/employees/*`
- Young people: `/api/v1/young-people/*`
- Vehicles: `/api/v1/vehicles/*`
- Tasks: `/api/v1/tasks/*`
- Announcements: `/api/v1/announcements/*`
- Audit: `/api/v1/audit/*`

## Change Control

- New endpoints require route schema + validation + authz + audit considerations.
- Deprecated endpoints must be removed from router registration and OpenAPI tags.
- Every release includes regression checks for route availability and unauthorized access denial.
