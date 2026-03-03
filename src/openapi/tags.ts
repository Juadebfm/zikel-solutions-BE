/**
 * OpenAPI tag definitions — one tag per API module.
 * Registered in the swagger plugin; used on every route schema.
 */
export const TAGS = [
  {
    name: 'Health',
    description: 'Liveness and readiness probes used by Fly.io health checks.',
  },
  {
    name: 'Auth',
    description:
      'Authentication and session management — register, login, OTP verification, token refresh, logout, and current-user.',
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
] as const;

export type TagName = (typeof TAGS)[number]['name'];
