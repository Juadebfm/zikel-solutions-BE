/**
 * OpenAPI tag definitions — one tag per API module.
 * Registered in the swagger plugin; used on every route schema.
 */
export const TAGS = [
  {
    name: 'Health',
    description: 'Liveness and readiness probes used by platform health checks.',
  },
  {
    name: 'Auth',
    description:
      'Authentication and session management — 4-step register, OTP verification, login, logout, and current-user.',
  },
  {
    name: 'Public',
    description:
      'Public website endpoints for demo booking, waitlist signup, and contact messages.',
  },
  {
    name: 'AI',
    description: 'AI-assisted guidance endpoints with safe fallback responses.',
  },
  {
    name: 'Summary',
    description:
      'My Summary page — personal KPI stats, to-do list, approval queue, and today\'s provisions grouped by home.',
  },
  {
    name: 'Tenants',
    description: 'Multi-tenant provisioning and membership management for organizations.',
  },
  {
    name: 'Care Groups',
    description: 'Top-level organisational units that group one or more care homes.',
  },
  {
    name: 'Homes',
    description: 'Individual care homes belonging to a care group.',
  },
  {
    name: 'Employees',
    description: 'Staff and managers assigned to homes.',
  },
  {
    name: 'Young People',
    description: 'Young people in care, associated with a specific home.',
  },
  {
    name: 'Vehicles',
    description: 'Fleet vehicles tracked with MOT/service due dates.',
  },
  {
    name: 'Tasks',
    description: 'Assignable tasks with priority, status, and optional assignment to a young person.',
  },
  {
    name: 'Uploads',
    description:
      'Direct-to-storage upload sessions for signatures and document attachments, with signed upload/download URLs.',
  },
  {
    name: 'Announcements',
    description: 'System-wide announcements; pinnable, with optional expiry.',
  },
  {
    name: 'Dashboard',
    description: 'Aggregated summary data for the main dashboard view.',
  },
  {
    name: 'Audit',
    description: 'Read-only audit log for auth events, permission changes, and destructive actions.',
  },
  {
    name: 'Integrations',
    description: 'Inbound and outbound integration endpoints (webhooks and connector targets).',
  },
  {
    name: 'Help Center',
    description: 'Support tickets and FAQ articles for platform help.',
  },
  {
    name: 'Notifications',
    description: 'Platform and tenant-level notifications with polling and read tracking.',
  },
  {
    name: 'Webhooks',
    description: 'Tenant-configurable webhook endpoint management and delivery logs.',
  },
  {
    name: 'Reports',
    description:
      'Operational and regulatory evidence packs (Reg 44 / Reg 45) with export support.',
  },
  {
    name: 'Safeguarding',
    description:
      'Safeguarding chronologies and intelligence endpoints with evidence-linked timelines.',
  },
] as const;

export type TagName = (typeof TAGS)[number]['name'];
