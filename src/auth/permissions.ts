/**
 * Permission catalog — single source of truth for tenant-scoped capabilities.
 *
 * - Each permission is a stable string id (`<resource>:<action>`) stored in
 *   Role.permissions[] in the database.
 * - Routes declare what they need via `requirePermission(...)` middleware.
 * - System roles (Owner, Admin, Care Worker, Read-Only) are pre-seeded bundles
 *   of these permissions; tenant admins can build custom roles by mixing them.
 *
 * Adding a new permission:
 *   1. Add it to `Permissions` below with a one-line description.
 *   2. Add it to the appropriate system-role bundles in `SYSTEM_ROLE_PERMISSIONS`.
 *   3. Use it in route middleware: `requirePermission(P.CARE_LOGS_WRITE)`.
 */

export const Permissions = {
  // ── Employees / staff ──────────────────────────────────────────────────────
  EMPLOYEES_READ: 'employees:read', // View employee list and profiles
  EMPLOYEES_WRITE: 'employees:write', // Create or update employee records
  EMPLOYEES_DEACTIVATE: 'employees:deactivate', // Soft-delete / deactivate employees
  EMPLOYEES_INVITE: 'employees:invite', // Send staff onboarding invitations

  // ── Homes ──────────────────────────────────────────────────────────────────
  HOMES_READ: 'homes:read',
  HOMES_WRITE: 'homes:write',

  // ── Care groups ────────────────────────────────────────────────────────────
  CARE_GROUPS_READ: 'care_groups:read',
  CARE_GROUPS_WRITE: 'care_groups:write',

  // ── Young people (residents) ───────────────────────────────────────────────
  YOUNG_PEOPLE_READ: 'young_people:read',
  YOUNG_PEOPLE_WRITE: 'young_people:write',
  YOUNG_PEOPLE_SENSITIVE_READ: 'young_people:sensitive_read', // Restricted/confidential records

  // ── Tasks / care logs ──────────────────────────────────────────────────────
  TASKS_READ: 'tasks:read',
  TASKS_WRITE: 'tasks:write',
  TASKS_APPROVE: 'tasks:approve', // Approve daily-log / IOI submissions
  CARE_LOGS_READ: 'care_logs:read',
  CARE_LOGS_WRITE: 'care_logs:write',

  // ── Safeguarding ───────────────────────────────────────────────────────────
  SAFEGUARDING_READ: 'safeguarding:read',
  SAFEGUARDING_WRITE: 'safeguarding:write',
  SAFEGUARDING_ESCALATE: 'safeguarding:escalate', // Acknowledge / resolve risk alerts

  // ── Reports & exports ──────────────────────────────────────────────────────
  REPORTS_READ: 'reports:read',
  REPORTS_EXPORT: 'reports:export',

  // ── Audit log ──────────────────────────────────────────────────────────────
  AUDIT_READ: 'audit:read',

  // ── Tenant settings ────────────────────────────────────────────────────────
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',

  // ── Members / membership management ────────────────────────────────────────
  MEMBERS_READ: 'members:read',
  MEMBERS_WRITE: 'members:write', // Invite, role-change, suspend, revoke

  // ── Roles & permissions (custom role builder) ──────────────────────────────
  ROLES_READ: 'roles:read',
  ROLES_WRITE: 'roles:write',

  // ── Billing ────────────────────────────────────────────────────────────────
  BILLING_READ: 'billing:read',
  BILLING_WRITE: 'billing:write',

  // ── AI assistant ───────────────────────────────────────────────────────────
  AI_USE: 'ai:use',
  AI_ADMIN: 'ai:admin', // Manage AI access for staff

  // ── Announcements ──────────────────────────────────────────────────────────
  ANNOUNCEMENTS_READ: 'announcements:read',
  ANNOUNCEMENTS_WRITE: 'announcements:write',

  // ── Vehicles ───────────────────────────────────────────────────────────────
  VEHICLES_READ: 'vehicles:read',
  VEHICLES_WRITE: 'vehicles:write',

  // ── Help center / support tickets ──────────────────────────────────────────
  HELP_CENTER_ADMIN: 'help_center:admin', // Manage FAQ, tickets, support content
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const ALL_PERMISSIONS: Permission[] = Object.values(Permissions);

// ── System roles (seeded per-tenant on creation; tenants cannot delete) ──────

export const SYSTEM_ROLE_NAMES = ['Owner', 'Admin', 'Care Worker', 'Read-Only'] as const;
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleName, Permission[]> = {
  // Owner: full power. Cannot be reduced.
  Owner: [...ALL_PERMISSIONS],

  // Admin: everything except billing-write and ownership transfer (which
  // does not exist as a permission yet — owner-only by hardcoded check).
  Admin: ALL_PERMISSIONS.filter((p) => p !== Permissions.BILLING_WRITE),

  // Care Worker: day-to-day frontline staff.
  'Care Worker': [
    Permissions.EMPLOYEES_READ,
    Permissions.HOMES_READ,
    Permissions.CARE_GROUPS_READ,
    Permissions.YOUNG_PEOPLE_READ,
    Permissions.TASKS_READ,
    Permissions.TASKS_WRITE,
    Permissions.CARE_LOGS_READ,
    Permissions.CARE_LOGS_WRITE,
    Permissions.SAFEGUARDING_READ,
    Permissions.ANNOUNCEMENTS_READ,
    Permissions.VEHICLES_READ,
    Permissions.AI_USE,
  ],

  // Read-Only: pure observer (auditor, regulator, parent portal etc.).
  'Read-Only': [
    Permissions.EMPLOYEES_READ,
    Permissions.HOMES_READ,
    Permissions.CARE_GROUPS_READ,
    Permissions.YOUNG_PEOPLE_READ,
    Permissions.TASKS_READ,
    Permissions.CARE_LOGS_READ,
    Permissions.SAFEGUARDING_READ,
    Permissions.ANNOUNCEMENTS_READ,
    Permissions.VEHICLES_READ,
    Permissions.REPORTS_READ,
  ],
};
