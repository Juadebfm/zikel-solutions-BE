# Role and Permission Matrix

## Roles

- `super_admin`: platform operator across tenants.
- `tenant_admin`: full admin within one tenant.
- `sub_admin`: delegated admin within one tenant.
- `staff`: least-privilege operational user.

## Permission Matrix

| Capability | super_admin | tenant_admin | sub_admin | staff |
|---|---|---|---|---|
| Provision tenant (`POST /api/v1/tenants`) | Yes | No | No | No |
| List/update tenant memberships | Yes | No | No | No |
| Invite tenant admin | Yes | No | No | No |
| Invite sub-admin/staff | Yes | Yes | Yes (staff only) | No |
| Switch tenant context | Yes | Yes (member only) | Yes (member only) | Yes (member only) |
| Read tenant audit logs | Yes (with active tenant scope / break-glass) | Yes | Yes | No |
| Break-glass tenant switch (`POST /api/v1/audit/break-glass/access`) | Yes | No | No | No |
| Create/update/delete care groups, homes, employees, young people | Yes (global role + scoped membership) | Yes | Yes | Read-only or self-scoped only |
| Create/update/delete vehicles | Yes | Yes | Yes | No |
| Create/update/delete tasks | Yes | Yes | Yes | Self-scoped only |
| Approve tasks | Yes | Yes | Yes | No |
| Toggle AI access (`PATCH /api/v1/ai/access/:userId`) | Yes | Yes (within tenant) | Yes (within tenant) | No |

## Enforcement Notes

- Global role checks are enforced at route layer (`requireRole`) and tenant membership checks are enforced in services (`requireTenantContext`).
- All privileged mutations emit `AuditLog` events with actor, action, target, and metadata.
- Staff-level access in task endpoints is constrained to ownership (`createdById`) or assignment (`assigneeId`).
